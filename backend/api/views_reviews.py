"""Отзывы гостей о парах напиток × блюдо: оценки, метки, текст, «умная» обработка (docs/REVIEWS.md).

Публичное (без авторизации):
  POST /api/v2/reviews/                       создать или обновить свой отзыв: одна запись на сессию гостя и пару
  GET  /api/v2/reviews/pair/?drink=&dish=     сводка пары + последние опубликованные отзывы с текстом
                                              (своё блюдо: dish=custom&dish_name=…)
  GET  /api/v2/reviews/drink/<id>/            сводка напитка по всем блюдам, частые метки, последние тексты
Кабинет заведения (Authorization: Bearer <api_token>, как views_saas):
  GET  /api/cabinet/reviews/?days=            отзывы в заведении: сводка по парам, метки, пары «на доработку»
Сомелье (FT_ADMIN_TOKEN или сотрудник Django — api/auth.py):
  GET  /api/v2/reviews/moderation/?status=    очередь: на проверке и спам (status=pending|spam|hidden|published|all)
  POST /api/v2/reviews/<uuid>/moderate/       {"status": "published" | "pending" | "hidden" | "spam"}

Что НЕ храним: IP, имена, телефоны, e-mail. IP и id сессии — только HMAC с солью из SECRET_KEY (лимиты и «одна
оценка на пару»); телефоны и e-mail в тексте заменяются на «[скрыто]» до записи; User-Agent — только класс «ос/браузер».
Лимиты считаются по базе (записи за минуту и за час), внешний кэш не нужен.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import secrets
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import review_ai
from . import reviews_logic as L
from .auth import sommelier_only
from .models import PairingReview, ScanEvent, Venue
from .pairing import engine_v2 as E
from .pairing.dataset_v2 import DatasetV2, get_dataset
from .views_saas import _account, _bad_body, _body, _int, _unauth

logger = logging.getLogger(__name__)

STATUSES = ("published", "pending", "hidden", "spam")
STATUS_LABELS = {"published": "опубликован", "pending": "на проверке", "hidden": "скрыт", "spam": "спам"}
LOCALES = ("ru", "kk", "en")

# Лимиты записи (создание или правка), окна в секундах. Сессия — «один гость»; IP шире в 2 раза: за одним IP сидит
# Wi-Fi бара или мобильный NAT оператора, и соседей по столу из-за одного любителя кнопок блокировать нельзя.
RATE_LIMITS: Dict[str, Tuple[Tuple[int, int], ...]] = {
    "session_hash": ((60, 5), (3600, 30)),
    "ip_hash": ((60, 10), (3600, 60)),
}
MIN_EDIT_INTERVAL_S = 3       # правка того же отзыва не чаще раза в 3 с
MAX_AI_RUNS = 3               # ИИ разбирает текст одного отзыва не больше 3 раз (стоимость; дальше — модератор)
VERIFY_WINDOW_H = 12          # «из заведения»: скан QR той же сессией в этом заведении за последние 12 ч
LOW_RATED_MEAN = 3.0          # кабинет: пара «на доработку», если сжатая средняя ≤ 3.0 или гости ниже ожидания движка
PUBLIC_LIMIT, PUBLIC_LIMIT_MAX = 5, 20
MOD_LIMIT, MOD_LIMIT_MAX = 50, 200
_SESSION_RX = re.compile(r"[A-Za-z0-9_\-]{8,64}")


class _Invalid(Exception):
    def __init__(self, detail: str, field: str):
        super().__init__(detail)
        self.detail, self.field = detail, field


# ─────────────────────────────  вспомогательное  ─────────────────────────────

def _ds() -> DatasetV2:
    return get_dataset(str(getattr(settings, "FLAVOR_DATA_DIR", "")) or None)


def _hmac(purpose: str, value: str) -> str:
    """HMAC-SHA256 с солью из SECRET_KEY; разные «назначения» — разные соли (IP и сессия не сопоставимы).
    Сменили SECRET_KEY — старые хеши больше не совпадут: лимиты и «одна оценка на пару» начнутся заново."""
    salt = hashlib.sha256(f"flavor-tree/reviews/{purpose}/".encode() + str(settings.SECRET_KEY).encode()).digest()
    return hmac.new(salt, value.encode("utf-8"), hashlib.sha256).hexdigest()


def _client_ip(request) -> str:
    """REMOTE_ADDR; за обратным прокси — FT_PROXY_HOPS=N: берём N-й адрес с конца X-Forwarded-For
    (его дописал наш прокси, а не клиент). Без настройки заголовку не верим."""
    hops = _int(os.environ.get("FT_PROXY_HOPS", "0").strip() or "0", 0, 5) or 0
    if hops:
        parts = [p.strip() for p in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return request.META.get("REMOTE_ADDR") or "unknown"


def _drink_raw(ds: DatasetV2, drink_id: str) -> Optional[Dict[str, Any]]:
    return ds.drink_raw_by_id.get(drink_id) or ds.archetype_raw_by_id.get(drink_id)


def _drink_name(ds: DatasetV2, drink_id: str) -> str:
    raw = _drink_raw(ds, drink_id) or {}
    return raw.get("display_name") or raw.get("name") or raw.get("label_ru") or drink_id


def _dish_name(ds: DatasetV2, dish_id: str, custom_name: str = "") -> str:
    if dish_id == "custom":
        return custom_name or "Своё блюдо"
    raw = ds.dish_raw_by_id.get(dish_id) or {}
    return raw.get("display_name") or raw.get("name") or dish_id


def _engine_score(ds: DatasetV2, drink_id: str, dish_id: str, memo: Dict[Tuple[str, str], Optional[int]]) -> Optional[int]:
    """Балл движка для пары в нейтральном контексте — основа ожидания в звёздах (reviews_logic.star_prior)."""
    key = (drink_id, dish_id)
    if key not in memo:
        drink = ds.drink_by_id.get(drink_id) or ds.archetype_by_id.get(drink_id)
        dish = ds.dish_by_id.get(dish_id)
        score = None
        if drink and dish:
            try:
                score = int(E.score_pair(drink, dish, {}, ds.params, ds.classic_index, False)["score"])
            except Exception:  # noqa: BLE001 — сводка отзывов не должна падать из-за данных движка
                logger.exception("reviews: движок не посчитал пару %s × %s", drink_id, dish_id)
        memo[key] = score
    return memo[key]


def _aggregate_for(ds: DatasetV2, drink_id: str, dish_id: str, rows: List[Dict[str, Any]], memo) -> Dict[str, Any]:
    score = _engine_score(ds, drink_id, dish_id, memo)
    agg = L.aggregate(rows, L.star_prior(score))
    agg["engine_score"] = score
    return agg


def _pair_aggregate(ds: DatasetV2, drink_id: str, dish_id: str, key: str, memo) -> Dict[str, Any]:
    rows = list(PairingReview.objects.filter(drink_id=drink_id, dish_key=key, status="published")
                .values("rating", "verified", "helpful", "chips"))
    return _aggregate_for(ds, drink_id, dish_id, rows, memo)


def _date(dt) -> str:
    return timezone.localtime(dt).date().isoformat() if dt else ""


def _public(r: PairingReview, ds: DatasetV2) -> Dict[str, Any]:
    """Отзыв для всех: без хешей, стола, устройства и точного времени (только дата)."""
    return {
        "id": str(r.id), "drink_id": r.drink_id, "drink_name": _drink_name(ds, r.drink_id),
        "dish_id": r.dish_id, "dish_name": _dish_name(ds, r.dish_id, r.dish_name),
        "rating": r.rating, "chips": list(r.chips or []), "text": r.text,
        "summary": r.ai_summary_ru or None, "aspects": list(r.ai_aspects or []),
        "helpful": r.helpful, "verified": r.verified, "locale": r.locale, "date": _date(r.created_at),
    }


def _own(r: PairingReview, ds: DatasetV2) -> Dict[str, Any]:
    """Отзыв для его автора: плюс статус, контекст и то, что он сам прислал (стол, балл, повод)."""
    return {
        **_public(r, ds),
        "status": r.status, "status_label": STATUS_LABELS[r.status],
        "venue": (r.venue.slug if r.venue_id and r.venue else None), "table": r.table_number,
        "score_shown": r.score_shown, "ctx": r.ctx, "engine_version": r.engine_version,
        "calibration_version": r.calibration_version or None,
        "created_at": r.created_at.isoformat(), "updated_at": r.updated_at.isoformat(),
    }


def _moderation_item(r: PairingReview, ds: DatasetV2) -> Dict[str, Any]:
    """Всё, что нужно модератору, кроме хешей."""
    venue = r.venue if r.venue_id else None
    return {
        **_own(r, ds),
        "venue_name": venue.name if venue else None,
        "ua_short": r.ua_short, "heuristics": r.heuristics, "edit_count": r.edit_count,
        "moderated_at": r.moderated_at.isoformat() if r.moderated_at else None,
        "ai": {"sentiment": r.ai_sentiment, "aspects": list(r.ai_aspects or []), "summary_ru": r.ai_summary_ru,
               "flags": r.ai_flags, "model": r.ai_model or None,
               "analyzed_at": r.ai_analyzed_at.isoformat() if r.ai_analyzed_at else None, "error": r.ai_error or None},
    }


def _limit(value, default: int, hi: int) -> int:
    n = _int(value if value not in (None, "") else str(default), 1, hi)
    return default if n is None else n


def _too_many(field: str, value: str, now, exclude_pk=None) -> Optional[int]:
    """Секунд до освобождения места в окне, если лимит исчерпан; None — можно писать.
    Правка своей же записи не занимает новое место: её строку из подсчёта исключаем."""
    for window, limit in RATE_LIMITS[field]:
        qs = PairingReview.objects.filter(**{field: value, "updated_at__gte": now - timedelta(seconds=window)})
        if exclude_pk is not None:
            qs = qs.exclude(pk=exclude_pk)
        if qs.count() >= limit:
            oldest = qs.order_by("updated_at").values_list("updated_at", flat=True).first()
            return max(1, int(window - (now - oldest).total_seconds()) + 1) if oldest else window
    return None


def _too_fast(retry: int) -> Response:
    return Response({"detail": "Слишком много оценок подряд — попробуйте чуть позже", "retry_after": retry},
                    status=status.HTTP_429_TOO_MANY_REQUESTS, headers={"Retry-After": str(retry)})


# ───────────────────────────────  разбор запроса  ────────────────────────────

def _parse(ds: DatasetV2, data: Dict[str, Any]) -> Dict[str, Any]:
    drink_id = data.get("drink_id", data.get("drink"))
    if not isinstance(drink_id, str) or not drink_id.strip():
        raise _Invalid("Нужен drink_id — id напитка из каталога", "drink_id")
    drink_id = drink_id.strip()
    if not _drink_raw(ds, drink_id):
        raise _Invalid("Неизвестный напиток", "drink_id")

    dish_id = data.get("dish_id", data.get("dish"))
    if not isinstance(dish_id, str) or not dish_id.strip():
        raise _Invalid("Нужен dish_id — id блюда из каталога или custom", "dish_id")
    dish_id = dish_id.strip()
    dish_name = ""
    if dish_id == "custom":
        raw_name = data.get("dish_name")
        dish_name = L.clean_dish_name(raw_name) if isinstance(raw_name, str) else ""
        if len(dish_name) < 2:
            raise _Invalid("Для своего блюда нужно название (dish_name)", "dish_name")
    elif dish_id not in ds.dish_by_id:
        raise _Invalid("Неизвестное блюдо", "dish_id")

    rating = _int(data.get("rating"), 1, 5)
    if rating is None:
        raise _Invalid("Оценка — целое число от 1 до 5", "rating")

    helpful = data.get("helpful")
    if helpful is not None and not isinstance(helpful, bool):
        raise _Invalid("helpful — true, false или null", "helpful")

    raw_chips = data.get("chips")
    raw_chips = [] if raw_chips is None else raw_chips
    if not isinstance(raw_chips, list) or not all(isinstance(c, str) for c in raw_chips):
        raise _Invalid("chips — список id меток", "chips")
    unknown = [c for c in raw_chips if c not in L.REVIEW_CHIPS]
    if unknown:
        raise _Invalid(f"Неизвестная метка: {unknown[0][:40]}", "chips")
    picked = set(raw_chips)
    chips = [c for c in L.CHIP_IDS if c in picked]

    raw_text = data.get("text")
    raw_text = "" if raw_text is None else raw_text
    if not isinstance(raw_text, str):
        raise _Invalid("text — строка", "text")
    text = L.normalize_space(raw_text)
    if len(text) > L.MAX_TEXT:
        raise _Invalid(f"Текст длиннее {L.MAX_TEXT} символов", "text")

    session = data.get("session")
    session = session.strip() if isinstance(session, str) else ""
    venue_slug = data.get("venue")
    venue_slug = venue_slug.strip() if isinstance(venue_slug, str) else ""
    return {
        "drink_id": drink_id, "dish_id": dish_id, "dish_name": dish_name, "dish_key": L.dish_key(dish_id, dish_name),
        "rating": rating, "helpful": helpful, "chips": chips, "text": text,
        "locale": data.get("locale") if data.get("locale") in LOCALES else "ru",
        "session": session if _SESSION_RX.fullmatch(session) else "",
        "venue_slug": venue_slug[:80], "table": _int(data.get("table"), 1, 100000),
        "score_shown": _int(data.get("score_shown"), 0, 100), "ctx": L.clean_ctx(data.get("ctx")),
    }


# ───────────────────────────────  публичное  ────────────────────────────────

@api_view(["POST"])
def reviews_create(request):
    """Создать или обновить отзыв. Одна запись на (сессия, напиток, блюдо): повторная отправка заменяет оценку,
    метки и текст. Без текста — публикуется сразу; с текстом — ИИ-разбор (если настроен) или ручная проверка."""
    data = _body(request)
    if data is None:
        return _bad_body()
    ds = _ds()
    try:
        form = _parse(ds, data)
    except _Invalid as exc:
        return Response({"detail": exc.detail, "field": exc.field}, status=status.HTTP_400_BAD_REQUEST)

    now = timezone.now()
    generated = not form["session"]
    session = form["session"] or secrets.token_urlsafe(18)
    session_hash, ip_hash = _hmac("session", session), _hmac("ip", _client_ip(request))
    existing = PairingReview.objects.filter(session_hash=session_hash, drink_id=form["drink_id"],
                                            dish_key=form["dish_key"]).select_related("venue").first()
    if existing and existing.updated_at > now - timedelta(seconds=MIN_EDIT_INTERVAL_S):
        return _too_fast(MIN_EDIT_INTERVAL_S)
    for field, value in (("session_hash", session_hash), ("ip_hash", ip_hash)):
        retry = _too_many(field, value, now, existing.pk if existing else None)
        if retry:
            return _too_fast(retry)

    # где гость: заведение по slug (пустой slug в filter не передаём — см. views_saas.track)
    venue = Venue.objects.filter(slug=form["venue_slug"], is_active=True).first() if form["venue_slug"] else None
    verified = bool(venue) and not generated and ScanEvent.objects.filter(
        venue=venue, session_key=session, created_at__gte=now - timedelta(hours=VERIFY_WINDOW_H)).exists()

    # текст: личные данные маскируем ДО записи, дальше работаем только с маскированным
    text, _ = L.mask_pii(form["text"])
    text_changed = existing is None or text != existing.text
    moderated_out = bool(existing and existing.moderated_at and existing.status in ("hidden", "spam"))
    old_chips = list(existing.chips or []) if existing else []
    old_aspects = list(existing.ai_aspects or []) if existing and existing.text else []

    ai_result: Optional[Dict[str, Any]] = None
    ai_attempted = False
    edit_count = existing.edit_count if existing else 0
    if text and text_changed:
        heur = L.analyze_text(text)
        if review_ai.enabled() and edit_count < MAX_AI_RUNS:
            ai_attempted = True
            edit_count += 1
            ai_result = review_ai.analyze(text, {
                "drink": _drink_name(ds, form["drink_id"]), "dish": _dish_name(ds, form["dish_id"], form["dish_name"]),
                "rating": form["rating"], "chips": form["chips"], "locale": form["locale"]})
        new_status = L.decide_status(True, heur, ai_result, ai_attempted)
        if moderated_out and new_status == "published":
            new_status = "pending"      # модератор уже скрывал этот отзыв — новый текст снова смотрит человек
    elif text:
        heur, new_status = existing.heuristics, existing.status          # текст тот же — решение не меняется
    else:
        heur, new_status = {}, (existing.status if moderated_out else "published")

    if text and not text_changed:
        new_aspects = old_aspects
    elif ai_result and ai_result.get("ok"):
        new_aspects = list(ai_result["aspects"])
    else:
        new_aspects = []

    def fill(r: PairingReview) -> None:
        r.drink_id, r.dish_id, r.dish_name, r.dish_key = form["drink_id"], form["dish_id"], form["dish_name"], form["dish_key"]
        r.rating, r.helpful, r.chips, r.text, r.locale = form["rating"], form["helpful"], form["chips"], text, form["locale"]
        r.venue = venue or (r.venue if r.venue_id else None)
        r.table_number = form["table"] if venue else (r.table_number if r.venue_id else None)
        r.verified = bool(r.verified) or verified
        r.session_hash, r.ip_hash = session_hash, ip_hash
        r.ua_short = L.ua_family(request.META.get("HTTP_USER_AGENT", ""))
        r.engine_version = E.ENGINE_VERSION
        r.calibration_version = str((ds.calibration or {}).get("version") or "")[:40]
        r.score_shown, r.ctx = form["score_shown"], form["ctx"]
        r.status, r.heuristics, r.edit_count = new_status, heur, edit_count
        if text and not text_changed:
            return                                        # разбор прежнего текста остаётся в силе
        r.ai_sentiment, r.ai_aspects, r.ai_summary_ru, r.ai_flags = None, [], "", {}
        r.ai_model, r.ai_analyzed_at, r.ai_error = "", None, ""
        if not text:
            return
        if ai_result and ai_result.get("ok"):
            r.ai_sentiment, r.ai_aspects, r.ai_summary_ru = ai_result["sentiment"], new_aspects, ai_result["summary_ru"]
            r.ai_flags = {**ai_result["flags"], "other_dish": ai_result["other_dish"]}
            r.ai_model, r.ai_analyzed_at = ai_result["model"][:60], now
        elif ai_result:
            r.ai_model, r.ai_error = ai_result.get("model", "")[:60], ai_result["error"][:200]
        else:
            r.ai_error = "limit" if review_ai.enabled() else "not_configured"

    created = False
    for attempt in range(2):
        try:
            with transaction.atomic():
                review = (PairingReview.objects.select_for_update().filter(pk=existing.pk).first()
                          if existing else None)
                created = review is None
                review = review or PairingReview()
                fill(review)
                review.save()
            break
        except IntegrityError:
            # тот же гость прислал ту же пару параллельно: вторая запись становится правкой первой
            existing = PairingReview.objects.filter(session_hash=session_hash, drink_id=form["drink_id"],
                                                    dish_key=form["dish_key"]).first()
            if attempt or not existing:
                raise

    memo: Dict[Tuple[str, str], Optional[int]] = {}
    body = {
        "review": _own(review, ds),
        "created": created,
        "status": review.status,
        "pending": review.status != "published",
        "applied_prefs": L.applied_prefs(form["chips"], new_aspects, old_chips, old_aspects),
        "aggregate": _pair_aggregate(ds, form["drink_id"], form["dish_id"], form["dish_key"], memo),
        "message": ("Спасибо! Оценка учтена." if review.status == "published"
                    else "Спасибо! Отзыв сохранён, текст посмотрит модератор."),
    }
    if generated:
        body["session"] = session      # клиент без своей сессии получает её, чтобы потом править этот же отзыв
    return Response(body, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(["GET"])
def reviews_pair(request):
    """Сводка пары + последние опубликованные отзывы с текстом."""
    ds = _ds()
    q = request.query_params
    drink_id, dish_id = (q.get("drink") or "").strip(), (q.get("dish") or "").strip()
    if not drink_id or not dish_id:
        return Response({"detail": "Нужны drink и dish"}, status=status.HTTP_400_BAD_REQUEST)
    if not _drink_raw(ds, drink_id):
        return Response({"detail": "Напиток не найден"}, status=status.HTTP_404_NOT_FOUND)
    dish_name = ""
    if dish_id == "custom":
        dish_name = L.clean_dish_name(q.get("dish_name") or "")
        if len(dish_name) < 2:
            return Response({"detail": "Для своего блюда нужно dish_name"}, status=status.HTTP_400_BAD_REQUEST)
    elif dish_id not in ds.dish_by_id:
        return Response({"detail": "Блюдо не найдено"}, status=status.HTTP_404_NOT_FOUND)
    key = L.dish_key(dish_id, dish_name)
    limit = _limit(q.get("limit"), PUBLIC_LIMIT, PUBLIC_LIMIT_MAX)
    latest = (PairingReview.objects.filter(drink_id=drink_id, dish_key=key, status="published")
              .exclude(text="").order_by("-created_at")[:limit])
    return Response({
        "drink_id": drink_id, "drink_name": _drink_name(ds, drink_id),
        "dish_id": dish_id, "dish_name": _dish_name(ds, dish_id, dish_name),
        "aggregate": _pair_aggregate(ds, drink_id, dish_id, key, {}),
        "reviews": [_public(r, ds) for r in latest],
        "engine": E.ENGINE_VERSION,
    })


def _grouped(ds: DatasetV2, rows: List[Dict[str, Any]], memo) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Опубликованные отзывы → сводки по парам (напиток × блюдо) и общая сводка (ожидание — среднее ожиданий пар)."""
    groups: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault((row["drink_id"], row["dish_key"]), []).append(row)
    pairs, priors = [], []
    for (drink_id, key), items in groups.items():
        dish_id, dish_name = items[0]["dish_id"], items[0]["dish_name"]
        agg = _aggregate_for(ds, drink_id, dish_id, items, memo)
        priors.append((agg["n"], agg["expected"]))
        pairs.append({"drink_id": drink_id, "drink_name": _drink_name(ds, drink_id), "dish_id": dish_id,
                      "dish_name": _dish_name(ds, dish_id, dish_name), "aggregate": agg})
    pairs.sort(key=lambda p: (-p["aggregate"]["n"], p["drink_id"], p["dish_id"], p["dish_name"]))
    overall = L.aggregate(rows, L.combined_prior(priors))
    return pairs, overall


_ROW_FIELDS = ("drink_id", "dish_id", "dish_key", "dish_name", "rating", "verified", "helpful", "chips")


@api_view(["GET"])
def reviews_drink(request, drink_id):
    """Сводка напитка по всем блюдам: общая оценка, частые метки, лучшие/худшие блюда, последние тексты."""
    ds = _ds()
    if not _drink_raw(ds, drink_id):
        return Response({"detail": "Напиток не найден"}, status=status.HTTP_404_NOT_FOUND)
    published = PairingReview.objects.filter(drink_id=drink_id, status="published")
    pairs, overall = _grouped(ds, list(published.values(*_ROW_FIELDS)), {})
    limit = _limit(request.query_params.get("limit"), PUBLIC_LIMIT, PUBLIC_LIMIT_MAX)
    return Response({
        "drink_id": drink_id, "drink_name": _drink_name(ds, drink_id),
        "aggregate": overall,
        "top_chips": overall["chips"][:5],
        "by_dish": [{k: v for k, v in p.items() if k not in ("drink_id", "drink_name")} for p in pairs],
        "reviews": [_public(r, ds) for r in published.exclude(text="").order_by("-created_at")[:limit]],
    })


# ────────────────────────────────  кабинет  ─────────────────────────────────

@api_view(["GET"])
def cabinet_reviews(request):
    """Отзывы гостей в своём заведении: сводка, пары, метки, «что поправить». Чужие заведения не видны.
    Текст — только опубликованный; стол и точное время не показываем (гостя по ним легко узнать)."""
    account = _account(request)
    if not account:
        return _unauth()
    venue, ds = account.venue, _ds()
    history = account.limits["history_days"]
    days = _int(request.query_params.get("days") or str(history))
    days = max(1, min(history if days is None else days, history))
    qs = PairingReview.objects.filter(venue=venue, created_at__gte=timezone.now() - timedelta(days=days))
    by_status = {row["status"]: row["n"] for row in qs.values("status").annotate(n=Count("id"))}
    published = qs.filter(status="published")
    pairs, overall = _grouped(ds, list(published.values(*_ROW_FIELDS)), {})
    low = [p for p in pairs if p["aggregate"]["enough"] and (
        (p["aggregate"]["mean"] is not None and p["aggregate"]["mean"] <= LOW_RATED_MEAN)
        or (p["aggregate"]["disagreement"] or {}).get("direction") == "lower")]
    low.sort(key=lambda p: (p["aggregate"]["mean"] if p["aggregate"]["mean"] is not None else 5, -p["aggregate"]["n"]))
    return Response({
        "venue": {"slug": venue.slug or str(venue.id), "name": venue.name},
        "days": days,
        "summary": {
            "published": by_status.get("published", 0), "pending": by_status.get("pending", 0),
            "hidden": by_status.get("hidden", 0) + by_status.get("spam", 0),
            "verified": published.filter(verified=True).count(),
            "with_text": published.exclude(text="").count(),
        },
        "aggregate": overall,
        "pairs": pairs,
        "low_rated": low,
        "chips": overall["chips"],
        "reviews": [_public(r, ds) for r in published.exclude(text="").order_by("-created_at")[:10]],
    })


# ────────────────────────────────  модерация  ───────────────────────────────

@api_view(["GET"])
@sommelier_only
def moderation_queue(request):
    """Очередь сомелье: по умолчанию «на проверке» и «спам», свежие первыми."""
    ds = _ds()
    q = request.query_params
    wanted = (q.get("status") or "queue").strip()
    qs = PairingReview.objects.select_related("venue").order_by("-created_at")
    if wanted == "queue":
        qs = qs.filter(status__in=("pending", "spam"))
    elif wanted in STATUSES:
        qs = qs.filter(status=wanted)
    elif wanted != "all":
        return Response({"detail": "status: queue, all или " + ", ".join(STATUSES)}, status=status.HTTP_400_BAD_REQUEST)
    limit = _limit(q.get("limit"), MOD_LIMIT, MOD_LIMIT_MAX)
    offset = _int(q.get("offset") or "0", 0, 10 ** 6) or 0
    counts = {row["status"]: row["n"] for row in PairingReview.objects.values("status").annotate(n=Count("id"))}
    return Response({
        "status": wanted, "count": qs.count(), "offset": offset, "limit": limit,
        "counts": {s: counts.get(s, 0) for s in STATUSES},
        "results": [_moderation_item(r, ds) for r in qs[offset:offset + limit]],
    })


@api_view(["POST"])
@sommelier_only
def moderate(request, review_id):
    """Решение модератора: published / pending / hidden / spam. Правка гостем после hidden/spam снова уходит на проверку."""
    data = _body(request)
    if data is None:
        return _bad_body()
    new_status = data.get("status")
    if new_status not in STATUSES:
        return Response({"detail": "status: " + ", ".join(STATUSES)}, status=status.HTTP_400_BAD_REQUEST)
    review = PairingReview.objects.select_related("venue").filter(pk=review_id).first()
    if not review:
        return Response({"detail": "Отзыв не найден"}, status=status.HTTP_404_NOT_FOUND)
    review.status, review.moderated_at = new_status, timezone.now()
    review.save(update_fields=["status", "moderated_at"])
    return Response({"ok": True, "review": _moderation_item(review, _ds())})
