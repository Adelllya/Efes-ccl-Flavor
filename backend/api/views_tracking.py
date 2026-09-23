"""Трекинг подбора для аналитики бренда: что движок показал гостю и что гость с этим сделал (docs/EFES_ANALYTICS.md).

Публичное (без авторизации):
  POST /api/v2/track/    одно событие или пачка {"events": [...]} (до 20) → 202 {"ok": true, "accepted": n}

  list    — гостю показали список: {"type": "list", "list_id": uuid, "source": pair|venue_menu|ai, "dish_id",
            "tab", "venue", "table", "occasion", "locale", "session", "engine", "calibration",
            "items": [{"drink_id", "rank", "score"}, … до 10],
            "pool_best_other": лучший балл не-Efes во всём пуле кандидатов до окна и диверсификации | null (в пуле
            ни одного не-Efes); поля нет — клиент старый, пул неизвестен}  → по строке PairingImpression на напиток
  action  — гость что-то сделал: {"type": "action", "kind": open_drink|expand_why|order_intent|review,
            "list_id", "drink_id", "dish_id", "venue", "session"}  → PairingAction

Клиенту не верим: категорию, архетип и принадлежность к портфелю Efes берём из data/drinks.json (dataset_v2),
честное место (honest_rank = 1 + сколько напитков в том же списке со строго большим баллом) считаем сами,
цену «Заказать» берём из карты заведения (VenueMenuItem), а не из запроса («price» от клиента игнорируется),
неизвестные напитки отбрасываем, неизвестное заведение → venue = null (без 4xx: не подсказываем, какие slug есть).
Повтор того же list_id ничего не пишет; один напиток в списке учитывается один раз.

Что НЕ храним: IP, имена, телефоны, e-mail. Сессия и IP — только HMAC с солью из SECRET_KEY (своё «назначение»:
с хешами отзывов не сопоставимы; id сессии трекинга клиент заводит отдельно от id гостя в отзывах).

Лимиты — по базе, внешний кэш не нужен: адрес (IPv6 — сеть /64) и общий поток считаются по ПРИСЛАННЫМ событиям
(TrackingRate: пустые, повторные и ошибочные запросы тоже тратят лимит), сессия — по записанным. В пачке не больше
MAX_SESSIONS сессий, тело — не больше MAX_BODY_BYTES (413).
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import re
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Tuple

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, F, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.exceptions import ParseError, UnsupportedMediaType
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import PairingAction, PairingImpression, TrackingRate, Venue, VenueMenuItem
from .pairing import engine_v2 as E
from .pairing.dataset_v2 import DatasetV2, get_dataset
from .views_engine_v2 import OCCASIONS
from .views_saas import _bad_body, _body, _int

SOURCES = ("pair", "venue_menu", "ai")
# Вкладки подбора — как TAB_GROUPS во frontend/src/app/core/data-v2.service.ts (категории нужны seed_brand_demo)
TAB_GROUPS: Dict[str, Tuple[str, ...]] = {
    "beer": ("beer", "radler"),
    "na": ("na_beer", "kvass", "lemonade", "soda", "dairy", "tea", "coffee", "water"),
    "cider": ("cider",),
    "wine": ("wine", "sparkling", "fortified"),
    "cocktail": ("cocktail",),
    "spirit": ("spirit", "liqueur"),
}
TABS = ("best",) + tuple(TAB_GROUPS)
ACTION_KINDS = tuple(k for k, _ in PairingAction.KIND_CHOICES)
LOCALES = ("ru", "kk", "en")

MAX_BATCH = 20                 # событий в одном запросе
MAX_ITEMS = 10                 # напитков в одном списке
MAX_RANK = 50                  # место в показанном списке (гость мог долистать «ещё»)
SCORE_MIN, SCORE_MAX = 3, 99   # диапазон балла движка v2
MAX_TABLE = 100000
MAX_BODY_BYTES = 64 * 1024     # 20 списков по 10 напитков — около 20 КБ; больше честному клиенту не нужно
MAX_SESSIONS = 2               # сессий в одной пачке: браузер шлёт одну свою (2 — если id сменился посреди пачки)
# Лимиты в событиях (список = одно событие, сколько бы в нём ни было напитков), окна в секундах.
#   session_hash — записанные события одной сессии (сессию выбирает клиент, так что это защита от сбоев, не от атак);
#   ip_hash      — ПРИСЛАННЫЕ события с одного адреса, IPv6 — с сети /64. Шире сессии в 10 раз: за одним адресом —
#                  Wi-Fi бара или мобильный NAT оператора;
#   global       — присланные события со всех адресов вместе (прошедшие лимит адреса): потолок на случай, когда
#                  адресов у атакующего много (ботнет, чужой сайт, который шлёт события браузерами посетителей).
RATE_LIMITS: Dict[str, Tuple[Tuple[int, int], ...]] = {
    "session_hash": ((60, 60), (3600, 600)),
    "ip_hash": ((60, 600), (3600, 6000)),
    "global": ((60, 3000),),
}
GLOBAL_KEY = "global"
_SESSION_RX = re.compile(r"[A-Za-z0-9_\-]{8,64}")
_VERSION_RX = re.compile(r"[0-9A-Za-z._+\-]{1,40}")
_SLUG_RX = re.compile(r"[A-Za-z0-9][A-Za-z0-9_\-]{0,79}")


class _Invalid(Exception):
    def __init__(self, detail: str, field: str, index: Optional[int] = None):
        super().__init__(detail)
        self.detail, self.field, self.index = detail, field, index


class _TextJSONParser(JSONParser):
    """navigator.sendBeacon на другой домен без preflight умеет только text/plain — внутри тот же JSON."""
    media_type = "text/plain"


# ─────────────────────────────  вспомогательное  ─────────────────────────────

def _ds() -> DatasetV2:
    return get_dataset(str(getattr(settings, "FLAVOR_DATA_DIR", "")) or None)


def _hmac(purpose: str, value: str) -> str:
    """HMAC-SHA256 с солью из SECRET_KEY (как views_reviews._hmac, но своё пространство: хеши трекинга и отзывов
    не сопоставить между собой). Сменили SECRET_KEY — старые хеши больше не совпадут, лимиты начнутся заново."""
    salt = hashlib.sha256(f"flavor-tree/tracking/{purpose}/".encode() + str(settings.SECRET_KEY).encode()).digest()
    return hmac.new(salt, value.encode("utf-8"), hashlib.sha256).hexdigest()


def session_hash(session: str) -> str:
    return _hmac("session", session)


def _client_ip(request) -> str:
    """REMOTE_ADDR; за обратным прокси — FT_PROXY_HOPS=N: берём N-й адрес с конца X-Forwarded-For
    (его дописал наш прокси, а не клиент). Без настройки заголовку не верим."""
    hops = _int(os.environ.get("FT_PROXY_HOPS", "0").strip() or "0", 0, 5) or 0
    if hops:
        parts = [p.strip() for p in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return request.META.get("REMOTE_ADDR") or "unknown"


def ip_bucket(ip: str) -> str:
    """Адрес для лимита: IPv4 — как есть; IPv6 — сеть /64 (её целиком выдают одному абоненту, и адрес внутри неё
    меняется бесплатно); IPv4 внутри IPv6 (::ffff:a.b.c.d) — как IPv4. Не адрес — строка как есть."""
    try:
        addr = ipaddress.ip_address(ip.strip())
    except ValueError:
        return ip
    if addr.version == 6:
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        return str(ipaddress.ip_network(f"{addr}/64", strict=False))
    return str(addr)


def drink_refs(ds: DatasetV2, drink_id: str) -> List[str]:
    """Под какими ref_slug напиток может стоять в карте заведения: id в drinks.json и slug сорта v1
    (legacy_brand_id)."""
    refs = [drink_id]
    legacy = (ds.drink_raw_by_id.get(drink_id) or {}).get("legacy_brand_id")
    if legacy and legacy != drink_id:
        refs.append(str(legacy))
    return refs


def menu_prices(ds: DatasetV2, pairs: Iterable[Tuple[Any, str]],
                available_only: bool = True) -> Dict[Tuple[Any, str], Decimal]:
    """Цена напитка в карте заведения: {(venue_id, drink_id): цена позиции VenueMenuItem (kind=BEER)}.
    Цену «Заказать» сервер берёт отсюда, клиенту не верит. Нет позиции (или она в стоп-листе) — нет ключа."""
    want = {(v, d): drink_refs(ds, d) for v, d in pairs if v is not None and d}
    if not want:
        return {}
    items = VenueMenuItem.objects.filter(kind="BEER", venue_id__in={v for v, _ in want},
                                         ref_slug__in={r for refs in want.values() for r in refs})
    if available_only:
        items = items.filter(is_available=True)
    by_ref = {(vid, ref): price for vid, ref, price in items.values_list("venue_id", "ref_slug", "price")}
    out: Dict[Tuple[Any, str], Decimal] = {}
    for (vid, drink_id), refs in want.items():
        price = next((by_ref[(vid, r)] for r in refs if (vid, r) in by_ref), None)   # id v2 важнее slug v1
        if price is not None:
            out[(vid, drink_id)] = price
    return out


def drink_facts(ds: DatasetV2, drink_id: str) -> Optional[Dict[str, Any]]:
    """Что сервер знает о напитке из data/drinks.json: категория, архетип, Efes. None — такого id нет."""
    raw = ds.drink_raw_by_id.get(drink_id)
    if raw is None:
        return None
    style = raw.get("style") if isinstance(raw.get("style"), dict) else {}
    return {
        "category": str(raw.get("category") or "")[:20],
        "archetype": str(style.get("archetype") or "")[:60],
        "efes": E.is_efes_relation(raw.get("efes_relation"), ds.params),
    }


def honest_ranks(scores: List[int]) -> List[int]:
    """Место по баллу: 1 + сколько баллов в списке строго больше. Равные баллы делят место."""
    return [1 + sum(1 for other in scores if other > s) for s in scores]


def _str(value: Any, field: str, index: int, required: bool = True, max_len: int = 80) -> str:
    if value is None or value == "":
        if required:
            raise _Invalid(f"Нужно поле {field}", field, index)
        return ""
    if not isinstance(value, str) or len(value.strip()) > max_len:
        raise _Invalid(f"{field} — строка до {max_len} символов", field, index)
    return value.strip()


def _choice(value: Any, allowed: Iterable[str], field: str, index: int, required: bool = False) -> str:
    if value is None or value == "":
        if required:
            raise _Invalid(f"Нужно поле {field}: " + ", ".join(allowed), field, index)
        return ""
    if value not in tuple(allowed):
        raise _Invalid(f"{field}: " + ", ".join(allowed), field, index)
    return value


def _uuid(value: Any, field: str, index: int, required: bool) -> Optional[uuid.UUID]:
    if value is None or value == "":
        if required:
            raise _Invalid(f"Нужно поле {field} (uuid)", field, index)
        return None
    if isinstance(value, str):
        try:
            return uuid.UUID(value.strip())
        except ValueError:
            pass
    raise _Invalid(f"{field} — uuid", field, index)


def _dish(ds: DatasetV2, value: Any, index: int, required: bool) -> str:
    dish_id = _str(value, "dish_id", index, required)
    if dish_id and dish_id != "custom" and dish_id not in ds.dish_by_id:
        raise _Invalid("Неизвестное блюдо: id из dishes_v2 или custom", "dish_id", index)
    return dish_id


def _session(value: Any, index: int) -> str:
    if not isinstance(value, str) or not _SESSION_RX.fullmatch(value.strip()):
        raise _Invalid("session — случайный id гостя: 8–64 символа A–Z, a–z, 0–9, _ и -", "session", index)
    return value.strip()


def _venue_slug(value: Any, index: int) -> str:
    """Slug заведения. Неизвестный slug ошибкой не считаем (venue станет null), но мусор вместо строки — 400."""
    if value is None or value == "":
        return ""
    if not isinstance(value, str):
        raise _Invalid("venue — slug заведения или null", "venue", index)
    slug = value.strip()
    return slug if _SLUG_RX.fullmatch(slug) else ""


# ───────────────────────────────  разбор события  ─────────────────────────────

def parse_list(ds: DatasetV2, ev: Dict[str, Any], index: int = 0) -> Dict[str, Any]:
    """Событие «список показан» → поля строк PairingImpression. Неизвестные напитки отбрасываются (dropped)."""
    list_id = _uuid(ev.get("list_id"), "list_id", index, required=True)
    source = _choice(ev.get("source"), SOURCES, "source", index, required=True)
    dish_id = _dish(ds, ev.get("dish_id"), index, required=True)
    tab = _choice(ev.get("tab"), TABS, "tab", index)
    occasion = _choice(ev.get("occasion"), OCCASIONS, "occasion", index)
    locale = _choice(ev.get("locale"), LOCALES, "locale", index) or "ru"
    session = _session(ev.get("session"), index)
    venue_slug = _venue_slug(ev.get("venue"), index)
    table = ev.get("table")
    if table is not None and _int(table, 1, MAX_TABLE) is None:
        raise _Invalid(f"table — целое 1…{MAX_TABLE} или null", "table", index)
    engine = _str(ev.get("engine"), "engine", index, required=False, max_len=20)
    calibration = _str(ev.get("calibration"), "calibration", index, required=False, max_len=40)
    for name, value in (("engine", engine), ("calibration", calibration)):
        if value and not _VERSION_RX.fullmatch(value):
            raise _Invalid(f"{name} — строка версии", name, index)
    # лучший не-Efes во всём пуле кандидатов: null — в пуле их нет (храним 0), поля нет — пул неизвестен (None)
    pool_best: Optional[int] = None
    if "pool_best_other" in ev:
        raw_pool = ev.get("pool_best_other")
        pool_best = 0 if raw_pool is None else _int(raw_pool, SCORE_MIN, SCORE_MAX)
        if pool_best is None:
            raise _Invalid(f"pool_best_other — целое {SCORE_MIN}…{SCORE_MAX} или null", "pool_best_other", index)

    raw_items = ev.get("items")
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= MAX_ITEMS:
        raise _Invalid(f"items — от 1 до {MAX_ITEMS} напитков", "items", index)
    items: List[Dict[str, Any]] = []
    ranks = set()
    for it in raw_items:
        if not isinstance(it, dict):
            raise _Invalid("items[] — объекты {drink_id, rank, score}", "items", index)
        drink_id = it.get("drink_id")
        if not isinstance(drink_id, str) or not drink_id.strip() or len(drink_id.strip()) > 80:
            raise _Invalid("items[].drink_id — id напитка", "items.drink_id", index)
        rank = _int(it.get("rank"), 1, MAX_RANK)
        if rank is None:
            raise _Invalid(f"items[].rank — целое 1…{MAX_RANK}", "items.rank", index)
        if rank in ranks:
            raise _Invalid("items[].rank — места в списке не повторяются", "items.rank", index)
        ranks.add(rank)
        score = _int(it.get("score"), SCORE_MIN, SCORE_MAX)
        if score is None:
            raise _Invalid(f"items[].score — целое {SCORE_MIN}…{SCORE_MAX}", "items.score", index)
        items.append({"drink_id": drink_id.strip(), "rank": rank, "score": score})

    # неизвестные напитки отбрасываем; один напиток в списке — один раз (берём верхнее место)
    kept: List[Dict[str, Any]] = []
    seen = set()
    for it in sorted(items, key=lambda x: x["rank"]):
        facts = drink_facts(ds, it["drink_id"])
        if facts is None or it["drink_id"] in seen:
            continue
        seen.add(it["drink_id"])
        kept.append({**it, **facts})
    if pool_best is not None:     # пул содержит и показанные напитки: его лучший не-Efes не ниже показанного
        pool_best = max([pool_best] + [it["score"] for it in kept if not it["efes"]])
    return {
        "type": "list", "list_id": list_id, "source": source, "dish_id": dish_id, "tab": tab, "occasion": occasion,
        "locale": locale, "session": session, "venue_slug": venue_slug, "table": _int(table, 1, MAX_TABLE),
        "engine": engine, "calibration": calibration, "items": kept, "dropped": len(items) - len(kept),
        "pool_best_other": pool_best,
    }


def parse_action(ds: DatasetV2, ev: Dict[str, Any], index: int = 0) -> Dict[str, Any]:
    """Событие «действие гостя». Неизвестный напиток — событие отбрасывается (drink = None), это не ошибка.
    «price» от клиента не читаем: цену «Заказать» эндпоинт берёт из карты заведения (menu_prices)."""
    kind = _choice(ev.get("kind"), ACTION_KINDS, "kind", index, required=True)
    list_id = _uuid(ev.get("list_id"), "list_id", index, required=False)
    drink_id = _str(ev.get("drink_id"), "drink_id", index, required=True)
    dish_id = _dish(ds, ev.get("dish_id"), index, required=False)
    session = _session(ev.get("session"), index)
    venue_slug = _venue_slug(ev.get("venue"), index)
    return {
        "type": "action", "kind": kind, "list_id": list_id, "drink_id": drink_id, "dish_id": dish_id,
        "session": session, "venue_slug": venue_slug, "price": None, "facts": drink_facts(ds, drink_id),
    }


# ───────────────────────────────  запись (общая с seed_brand_demo)  ──────────

def impressions_for_list(form: Dict[str, Any], *, venue: Optional[Venue], session_hash: str, ip_hash: str,
                         created_at: datetime, is_demo: bool = False) -> List[PairingImpression]:
    """Строки показа для разобранного списка. honest_rank — по баллам внутри списка (сервер, не клиент)."""
    items = form["items"]
    honest = honest_ranks([it["score"] for it in items])
    return [PairingImpression(
        list_id=form["list_id"], source=form["source"], venue=venue,
        table_number=form["table"] if venue else None, dish_id=form["dish_id"], tab=form["tab"],
        occasion=form["occasion"], locale=form["locale"], rank=it["rank"], honest_rank=h,
        drink_id=it["drink_id"], category=it["category"], archetype=it["archetype"], efes=it["efes"],
        score=it["score"], pool_best_other=form.get("pool_best_other"), session_hash=session_hash, ip_hash=ip_hash,
        engine_version=form["engine"], calibration_version=form["calibration"],
        is_demo=is_demo, created_at=created_at,
    ) for it, h in zip(items, honest)]


def action_row(form: Dict[str, Any], *, venue: Optional[Venue], session_hash: str, ip_hash: str,
               created_at: datetime, is_demo: bool = False) -> Optional[PairingAction]:
    """Строка действия. form["price"] — цена из карты заведения (эндпоинт и seed_brand_demo ставят её сами)."""
    facts = form["facts"]
    if facts is None:
        return None
    return PairingAction(
        kind=form["kind"], list_id=form["list_id"], drink_id=form["drink_id"], dish_id=form["dish_id"], venue=venue,
        efes=facts["efes"], price=form["price"], session_hash=session_hash, ip_hash=ip_hash,
        is_demo=is_demo, created_at=created_at,
    )


def _charge(key: str, n: int, now) -> Optional[int]:
    """+n присланных событий к ключу (HMAC адреса или GLOBAL_KEY) в текущей минуте. Вернуть Retry-After, если лимит
    ключа превышен, иначе None. Попытка засчитывается и тогда, когда запрос потом ничего не запишет."""
    limits = RATE_LIMITS[GLOBAL_KEY if key == GLOBAL_KEY else "ip_hash"]
    minute = now.replace(second=0, microsecond=0)
    if not TrackingRate.objects.filter(key=key, minute=minute).update(n=F("n") + n):
        try:
            with transaction.atomic():
                TrackingRate.objects.create(key=key, minute=minute, n=n)
        except IntegrityError:                     # параллельный запрос успел создать строку этой минуты
            TrackingRate.objects.filter(key=key, minute=minute).update(n=F("n") + n)
        else:                                      # новая минута ключа — заодно убираем строки старше всех окон
            longest = max(w for lims in RATE_LIMITS.values() for w, _ in lims)
            TrackingRate.objects.filter(minute__lt=minute - timedelta(seconds=longest)).delete()
    longest = max(w for w, _ in limits)
    rows = list(TrackingRate.objects.filter(key=key, minute__gt=now - timedelta(seconds=longest + 60))
                .values_list("minute", "n"))
    for window, limit in limits:
        if _window_sum(rows, now, window) > limit:
            return min(window, 600)
    return None


def _window_sum(rows: List[Tuple[datetime, int]], now, window: int) -> float:
    """Скользящее окно по минутным счётчикам: минуты целиком внутри окна — полностью, самая старая, которую окно
    режет, — пропорционально (иначе на стыке минут проходило бы вдвое больше лимита)."""
    start = now - timedelta(seconds=window)
    total = 0.0
    for minute, n in rows:
        stop = minute + timedelta(seconds=60)
        if stop <= start:
            continue
        total += n if minute >= start else n * (stop - start).total_seconds() / 60
    return total


def _session_retry(new_by_session: Dict[str, int], now) -> Optional[int]:
    """Лимит сессии — по записанным событиям (список — одно событие, действие — одно): два запроса на сессию."""
    limits = RATE_LIMITS["session_hash"]
    since = now - timedelta(seconds=max(w for w, _ in limits))
    for value, new in new_by_session.items():
        base = {"session_hash": value, "is_demo": False, "created_at__gte": since}
        lists = PairingImpression.objects.filter(**base).aggregate(**{
            f"w{w}": Count("list_id", distinct=True, filter=Q(created_at__gte=now - timedelta(seconds=w)))
            for w, _ in limits})
        acts = PairingAction.objects.filter(**base).aggregate(**{
            f"w{w}": Count("id", filter=Q(created_at__gte=now - timedelta(seconds=w))) for w, _ in limits})
        for window, limit in limits:
            if (lists[f"w{window}"] or 0) + (acts[f"w{window}"] or 0) + new > limit:
                return min(window, 600)
    return None


def _too_many(retry: int) -> Response:
    return Response({"detail": "Слишком много событий подряд — попробуйте чуть позже", "retry_after": retry},
                    status=status.HTTP_429_TOO_MANY_REQUESTS, headers={"Retry-After": str(retry)})


def _content_length(request) -> int:
    try:
        return int(request.META.get("CONTENT_LENGTH") or 0)
    except (TypeError, ValueError):
        return 0


# ───────────────────────────────  эндпоинт  ────────────────────────────────

@api_view(["POST"])
@authentication_classes([])            # публичный: без сессии Django нет и CSRF-проверки для вошедших сотрудников
@permission_classes([AllowAny])
@parser_classes([JSONParser, _TextJSONParser])
def track(request):
    """Показы и действия гостя. 202 {"ok": true, "accepted": n}: n — сколько событий записано
    (список, где не осталось известных напитков, повтор list_id и действие с неизвестным напитком — не считаются).
    Порядок: размер тела (413) → лимит адреса по присланным событиям (429) → проверка (400) → лимит сессий → общий."""
    if _content_length(request) > MAX_BODY_BYTES:
        return Response({"detail": f"Тело запроса больше {MAX_BODY_BYTES // 1024} КБ", "field": "events"},
                        status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    now = timezone.now()
    ip_hash = _hmac("ip", ip_bucket(_client_ip(request)))
    parse_error: Optional[Exception] = None
    try:
        data = _body(request)
    except (ParseError, UnsupportedMediaType) as exc:
        data, parse_error = None, exc
    raw_events = data.get("events") if isinstance(data, dict) and "events" in data else None
    attempted = min(len(raw_events), MAX_BATCH) if isinstance(raw_events, list) and raw_events else 1
    retry = _charge(ip_hash, attempted, now)
    if retry:
        return _too_many(retry)
    if parse_error is not None:
        raise parse_error                           # DRF ответит 400 / 415, как и без лимита
    if data is None or not data:
        return _bad_body()
    if "events" in data:
        events = raw_events
        if not isinstance(events, list) or not 1 <= len(events) <= MAX_BATCH:
            return Response({"detail": f"events — список из 1…{MAX_BATCH} событий", "field": "events"},
                            status=status.HTTP_400_BAD_REQUEST)
    else:
        events = [data]

    ds = _ds()
    forms: List[Dict[str, Any]] = []
    try:
        for i, ev in enumerate(events):
            if not isinstance(ev, dict):
                raise _Invalid("Событие — JSON-объект", "events", i)
            kind = ev.get("type")
            if kind == "list":
                forms.append(parse_list(ds, ev, i))
            elif kind == "action":
                forms.append(parse_action(ds, ev, i))
            else:
                raise _Invalid("type: list или action", "type", i)
    except _Invalid as exc:
        body = {"detail": exc.detail, "field": exc.field}
        if "events" in data:
            body["index"] = exc.index
        return Response(body, status=status.HTTP_400_BAD_REQUEST)

    hashes = {f["session"]: session_hash(f["session"]) for f in forms}
    if len(hashes) > MAX_SESSIONS:
        return Response({"detail": f"В одной пачке — события не больше чем {MAX_SESSIONS} сессий", "field": "session"},
                        status=status.HTTP_400_BAD_REQUEST)
    new_by_session: Dict[str, int] = {}
    for f in forms:
        new_by_session[hashes[f["session"]]] = new_by_session.get(hashes[f["session"]], 0) + 1
    retry = _session_retry(new_by_session, now) or _charge(GLOBAL_KEY, len(forms), now)
    if retry:
        return _too_many(retry)

    slugs = {f["venue_slug"] for f in forms if f["venue_slug"]}
    venues = {v.slug: v for v in Venue.objects.filter(slug__in=slugs, is_active=True)} if slugs else {}
    # цена «Заказать» — из карты заведения (в наличии); без заведения или позиции в карте — null
    prices = menu_prices(ds, [(venues[f["venue_slug"]].id, f["drink_id"]) for f in forms
                              if f["type"] == "action" and f["kind"] == "order_intent" and f["facts"]
                              and f["venue_slug"] in venues])
    list_ids = [f["list_id"] for f in forms if f["type"] == "list"]
    known_lists = set(PairingImpression.objects.filter(list_id__in=list_ids).order_by()
                      .values_list("list_id", flat=True).distinct()) if list_ids else set()

    impressions: List[PairingImpression] = []
    actions: List[PairingAction] = []
    accepted = 0
    for f in forms:
        venue = venues.get(f["venue_slug"])
        common = {"venue": venue, "session_hash": hashes[f["session"]], "ip_hash": ip_hash, "created_at": now}
        if f["type"] == "list":
            if f["list_id"] in known_lists or not f["items"]:
                continue                     # повтор того же списка или ни одного известного напитка
            known_lists.add(f["list_id"])
            impressions.extend(impressions_for_list(f, **common))
            accepted += 1
        else:
            price = prices.get((venue.id, f["drink_id"])) if venue is not None and f["kind"] == "order_intent" else None
            row = action_row({**f, "price": price}, **common)
            if row is not None:
                actions.append(row)
                accepted += 1
    with transaction.atomic():
        if impressions:
            # ignore_conflicts: тот же список прислали параллельно — вторая копия молча не пишется
            PairingImpression.objects.bulk_create(impressions, ignore_conflicts=True)
        if actions:
            PairingAction.objects.bulk_create(actions)
    return Response({"ok": True, "accepted": accepted}, status=status.HTTP_202_ACCEPTED)
