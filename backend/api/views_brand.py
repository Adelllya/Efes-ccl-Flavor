"""Аналитика бренда (Efes): как портфель проявляет себя в настоящем подборе (docs/EFES_ANALYTICS.md).

GET /api/brand/overview/?days=30&venue=<slug>&city=<город>&demo=0|1&to=YYYY-MM-DD
    Доступ: FT_BRAND_TOKEN (`Authorization: Bearer …` или `X-Brand-Token: …`) или сотрудник Django (api/auth.py).
    days 1…365 (30); to — последний день периода, MIN_TO…завтра (по умолчанию сегодня; для demo=1 — день последней
    демо-записи); demo=0 — только настоящие события, demo=1 — только демо (seed_brand_demo); venue/city — фильтр.

Источники: PairingImpression / PairingAction (POST /api/v2/track/), намерения заказа из меню заведения
(MenuEvent ORDER_INTENT, beer = ref_slug позиции карты → напиток через id или legacy_brand_id; только при показанном
списке той же сессии, см. _orders), опубликованные отзывы (PairingReview). Наружу — только агрегаты.

Честность метрик (главное, что надо понимать, читая цифры):
  * «как показано» (top1_share_shown) — Efes стоял первым в списке, который видел гость. Сюда входит политика
    tie-window: напиток Efes, уступающий лучшему не больше partner_tie_window (2) баллов, ставится первым.
  * «по честному баллу» (top1_share_honest) — балл лучшего Efes строго выше, чем у лучшего конкурента: и среди
    показанных, и во всём пуле кандидатов (pool_best_other — окно может вытеснить равного или более сильного
    конкурента из короткого списка). Ничья с конкурентом Efes в зачёт не идёт.
  * policy_effect — списки, где Efes первый только благодаря политике (показан первым, но конкурент по баллу не
    хуже — в списке или в пуле). Для корректных клиентов shown = honest + policy_effect.
  * contested — списки, где конкурент вообще был (в списке или в пуле); остальные — «без конкурентов», там 1-е
    место не результат сравнения (обычно карта заведения только из Efes).
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from django.conf import settings
from django.db.models import Case, CharField, Count, F, IntegerField, Max, Min, Q, Sum, Value, When
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .auth import brand_only
from .models import (MenuEvent, PairingAction, PairingImpression, PairingReview, Venue, VenueAccount,
                     VenueMenuItem)
from .pairing import engine_v2 as E
from .pairing.dataset_v2 import DatasetV2, get_dataset
from .views_saas import _int
from .views_tracking import session_hash

DEFAULT_DAYS, MAX_DAYS = 30, 365
MIN_TO = date(2020, 1, 1)             # ?to= раньше — 400 (и ни одной записи раньше проекта всё равно нет)
DEMO_BANNER = "Демо-данные: сгенерированы движком на тестовом потоке, не реальные гости"
# Заведения seed_saas (демо-аккаунты): карта и цены выдуманы. В настоящих цифрах заказы там не считаются (ни action,
# ни MenuEvent), а строки заведений помечены is_demo_venue — даже если нажимали настоящие гости (жюри по QR).
DEMO_ACCOUNT_SUFFIX = "@demo.flavortree.kz"
# «Заказать» в меню заведения шлёт и MenuEvent, и action order_intent — это одно нажатие.
ORDER_MATCH_WINDOW = timedelta(minutes=30)
_HEX64 = re.compile(r"[0-9a-f]{64}")


def _ds() -> DatasetV2:
    return get_dataset(str(getattr(settings, "FLAVOR_DATA_DIR", "")) or None)


def _share(part: int, whole: int) -> float:
    return round(part / whole, 4) if whole else 0.0


def _avg(total: float, n: int, digits: int = 1) -> Optional[float]:
    return round(total / n, digits) if n else None


def _pct(x: float) -> str:
    return f"{x * 100:.1f}".replace(".", ",") + " %"


def _plural(n: int, one: str, few: str, many: str) -> str:
    """1 список · 2 списка · 5 списков."""
    m10, m100 = n % 10, n % 100
    return one if m10 == 1 and m100 != 11 else few if 2 <= m10 <= 4 and not 12 <= m100 <= 14 else many


def _drink_name(ds: DatasetV2, drink_id: str) -> str:
    raw = ds.drink_raw_by_id.get(drink_id) or ds.archetype_raw_by_id.get(drink_id) or {}
    return raw.get("display_name") or raw.get("name") or raw.get("label_ru") or drink_id


def _dish_name(ds: DatasetV2, dish_id: str) -> str:
    if dish_id == "custom":
        return "Своё блюдо"
    raw = ds.dish_raw_by_id.get(dish_id) or {}
    return raw.get("display_name") or raw.get("name") or dish_id


def _is_efes(ds: DatasetV2, drink_id: str) -> bool:
    raw = ds.drink_raw_by_id.get(drink_id)
    return bool(raw) and E.is_efes_relation(raw.get("efes_relation"), ds.params)


def demo_venue_ids() -> set:
    return set(VenueAccount.objects.filter(email__iendswith=DEMO_ACCOUNT_SUFFIX).values_list("venue_id", flat=True))


def ref_to_drink(ds: DatasetV2) -> Dict[str, str]:
    """ref_slug позиции карты (id напитка v2 или slug сорта v1) → id напитка в drinks.json."""
    out = {d["id"]: d["id"] for d in ds.drinks}
    for d in ds.drinks:
        legacy = d.get("legacy_brand_id")
        if legacy and legacy not in out:
            out[legacy] = d["id"]
    return out


def period_bounds(days: int, to_date: date) -> Tuple[date, datetime, datetime]:
    """[from 00:00, to+1 00:00) в часовом поясе проекта (Asia/Almaty)."""
    tz = timezone.get_current_timezone()
    from_date = to_date - timedelta(days=days - 1)
    start = timezone.make_aware(datetime.combine(from_date, time.min), tz)
    end = timezone.make_aware(datetime.combine(to_date + timedelta(days=1), time.min), tz)
    return from_date, start, end


def city_venue_ids(city: str) -> List[Any]:
    """Заведения города без учёта регистра. Не venue__city__iexact: в SQLite он не сворачивает кириллицу."""
    key = city.strip().casefold()
    return [vid for vid, c in Venue.objects.values_list("id", "city") if (c or "").strip().casefold() == key]


def latest_demo_date() -> Optional[date]:
    ts = PairingImpression.objects.filter(is_demo=True).order_by("-created_at").values_list("created_at", flat=True).first()
    return timezone.localtime(ts).date() if ts else None


_I = IntegerField()
_C = CharField()


def _flag(cond: Q) -> Max:
    return Max(Case(When(cond, then=Value(1)), default=Value(0), output_field=_I))


def _text(cond: Q, field: str) -> Max:
    return Max(Case(When(cond, then=F(field)), default=Value(""), output_field=_C))


def _menu_session_hash(key: str) -> str:
    """MenuEvent.session_key: с этой версии /api/track/ пишет туда HMAC трекинга, в старых строках — сырой id."""
    return key if _HEX64.fullmatch(key) else session_hash(key)


def _orders(ds: DatasetV2, actions, *, demo: bool, venue: Optional[Venue], city_ids: Optional[List[Any]], start,
            end, demo_ids: set) -> Tuple[List[Tuple[str, Any, Decimal, datetime]], Dict[str, int]]:
    """Намерения заказа за период: (drink_id, venue_id, цена, когда).

    1. action order_intent (POST /api/v2/track/). Цену сервер взял из карты заведения при записи; без заведения
       или позиции в карте — 0 ₸ (нажатие считается, сумма — нет).
    2. MenuEvent ORDER_INTENT из меню заведения (старый POST /api/track/: без лимитов, цена от клиента). Считается,
       только если (а) это не то же нажатие, что пришло action'ом, (б) у той же сессии в этом заведении есть
       показанный список за ORDER_MATCH_WINDOW до нажатия, (в) такой же заказ (сессия × напиток × заведение) ещё
       не засчитан в пределах окна. Цена — позиции карты заведения, цену из события не берём.
    В настоящих цифрах (demo=False) заказы в демо-заведениях не считаются: карта и цены там выдуманы."""
    out: List[Tuple[str, Any, Decimal, datetime]] = []
    tracked: Dict[Tuple[str, str, Any], List[datetime]] = defaultdict(list)
    info = {"menu_events": 0, "menu_duplicates": 0, "menu_unmatched": 0, "menu_repeats": 0, "menu_unmapped": 0,
            "menu_unpriced": 0, "demo_venue_orders": 0}
    for drink_id, venue_id, price, ts, s_hash in (actions.filter(kind="order_intent").order_by("created_at")
                                                  .values_list("drink_id", "venue_id", "price", "created_at",
                                                               "session_hash")):
        tracked[(s_hash, drink_id, venue_id)].append(ts)
        if not demo and venue_id in demo_ids:
            info["demo_venue_orders"] += 1
            continue
        out.append((drink_id, venue_id, price or Decimal("0"), ts))
    if demo:
        return out, info      # у MenuEvent нет флага демо: в демо-режиме заказы только из seed_brand_demo

    events = MenuEvent.objects.filter(kind="ORDER_INTENT", created_at__gte=start, created_at__lt=end)
    if venue is not None:
        events = events.filter(venue=venue)
    if city_ids is not None:
        events = events.filter(venue_id__in=city_ids)
    rows = list(events.order_by("created_at").values_list("beer_slug", "venue_id", "created_at", "session_key"))
    if not rows:
        return out, info
    venue_ids = {r[1] for r in rows}
    # показанные списки тех же заведений (настоящие): сессия × заведение → когда показан
    shown_lists: Dict[Tuple[str, Any], List[datetime]] = defaultdict(list)
    for s_hash, venue_id, ts in (PairingImpression.objects.filter(
            is_demo=False, venue_id__in=venue_ids, created_at__gte=start - ORDER_MATCH_WINDOW, created_at__lt=end)
            .order_by().values("list_id", "session_hash", "venue_id").annotate(ts=Min("created_at"))
            .values_list("session_hash", "venue_id", "ts")):
        shown_lists[(s_hash, venue_id)].append(ts)
    card = {(vid, ref): price for vid, ref, price in VenueMenuItem.objects.filter(
        kind="BEER", venue_id__in=venue_ids).values_list("venue_id", "ref_slug", "price")}
    refs = ref_to_drink(ds)
    counted: Dict[Tuple[str, str, Any], List[datetime]] = defaultdict(list)
    for beer_slug, venue_id, ts, session in rows:
        drink_id = refs.get(beer_slug)
        if not drink_id:
            info["menu_unmapped"] += 1
            continue
        s_hash = _menu_session_hash(session) if session else ""
        key = (s_hash, drink_id, venue_id)
        candidates = tracked.get(key) or [] if s_hash else []
        match = next((i for i, t in enumerate(candidates) if abs(t - ts) <= ORDER_MATCH_WINDOW), None)
        if match is not None:
            candidates.pop(match)               # это нажатие уже пришло как action order_intent
            if venue_id not in demo_ids:
                info["menu_duplicates"] += 1
            continue
        if venue_id in demo_ids:
            info["demo_venue_orders"] += 1
            continue
        if not s_hash or not any(ts - ORDER_MATCH_WINDOW <= t <= ts + timedelta(minutes=1)
                                 for t in shown_lists.get((s_hash, venue_id), ())):
            info["menu_unmatched"] += 1          # списка этой сессии в заведении не было: не наш клиент или подделка
            continue
        if any(abs(t - ts) <= ORDER_MATCH_WINDOW for t in counted[key]):
            info["menu_repeats"] += 1            # повторное нажатие того же заказа
            continue
        counted[key].append(ts)
        price = card.get((venue_id, beer_slug))
        if price is None:
            info["menu_unpriced"] += 1          # позиции уже нет в карте: заказ считаем, сумму — нет
        out.append((drink_id, venue_id, price or Decimal("0"), ts))
        info["menu_events"] += 1
    return out, info


def compute_overview(*, days: int = DEFAULT_DAYS, to_date: Optional[date] = None, demo: bool = False,
                     venue: Optional[Venue] = None, city: str = "", ds: Optional[DatasetV2] = None) -> Dict[str, Any]:
    """Сводка для дашборда бренда. Используется и эндпоинтом, и seed_brand_demo --export."""
    ds = ds or _ds()
    tz = timezone.get_current_timezone()
    to_date = to_date or timezone.localdate()
    from_date, start, end = period_bounds(days, to_date)
    city_ids = city_venue_ids(city) if (city or "").strip() else None
    demo_ids = demo_venue_ids()

    def scoped(qs):
        qs = qs.filter(is_demo=demo, created_at__gte=start, created_at__lt=end)
        if venue is not None:
            qs = qs.filter(venue=venue)
        if city_ids is not None:
            qs = qs.filter(venue_id__in=city_ids)
        return qs

    imp = scoped(PairingImpression.objects.all())
    act = scoped(PairingAction.objects.all())

    # ── один проход по спискам: SQL группирует строки показа в списки, Python складывает ──
    per_list = (imp.order_by().values("list_id", "dish_id", "venue_id", "source").annotate(
        ts=Min("created_at"), n=Count("id"), n_efes=Count("id", filter=Q(efes=True)),
        top_efes=_flag(Q(rank=1, efes=True)), top_cat=_text(Q(rank=1), "category"),
        h1_other_drink=_text(Q(honest_rank=1, efes=False), "drink_id"),
        top3_efes=_flag(Q(rank__lte=3, efes=True)),
        best=Max("score"),
        best_efes=Max(Case(When(efes=True, then=F("score")), default=None, output_field=_I)),
        best_other=Max(Case(When(efes=False, then=F("score")), default=None, output_field=_I)),
        pool_other=Max("pool_best_other"),
    ).values_list("list_id", "dish_id", "venue_id", "source", "ts", "n", "n_efes", "top_efes", "top_cat",
                  "h1_other_drink", "top3_efes", "best", "best_efes", "best_other", "pool_other"))
    # победитель честного списка для таблицы SKU: Efes с честным местом 1, стоявший выше (ничья двух Efes — одному)
    honest_leader: Dict[Any, str] = {}
    for list_id, drink_id in imp.filter(efes=True, honest_rank=1).order_by("list_id", "rank").values_list(
            "list_id", "drink_id"):
        honest_leader.setdefault(list_id, drink_id)

    lists = impressions = efes_impressions = 0
    shown = honest = promoted = ties = hidden = top3 = pool_unknown = 0
    efes_lists = efes_best_sum = leader_sum = 0
    contested = Counter()                                        # списки с конкурентом (в списке или в пуле)
    trend: Dict[date, List[int]] = defaultdict(lambda: [0, 0, 0])
    dishes: Dict[str, Dict[str, Any]] = {}
    venues: Dict[Any, Counter] = defaultdict(Counter)
    sources: Dict[str, List[int]] = defaultdict(lambda: [0, 0, 0])
    competitors: Counter = Counter()
    sku_honest: Counter = Counter()
    for (list_id, dish_id, venue_id, source, ts, n, n_efes, top_efes, top_cat, h1_other_drink, top3_efes, best,
         best_efes, best_other, pool_other) in per_list:
        rival = max(best_other or 0, pool_other or 0) or None    # лучший конкурент: показанный или из пула
        has_efes = best_efes is not None
        is_honest = has_efes and (rival is None or best_efes > rival)
        is_promoted = bool(top_efes) and has_efes and rival is not None and rival >= best_efes
        lists += 1
        impressions += n
        efes_impressions += n_efes
        shown += top_efes
        honest += is_honest
        promoted += is_promoted
        ties += bool(is_promoted and rival == best_efes)         # Efes и конкурент с одинаковым баллом
        hidden += bool(is_promoted and (best_other is None or best_other < best_efes))   # сильный конкурент не показан
        pool_unknown += pool_other is None
        top3 += top3_efes
        if has_efes:                                             # разрыв с лидером — по одним и тем же спискам
            efes_lists += 1
            efes_best_sum += best_efes
            leader_sum += max(best, pool_other or 0)
        if is_honest and list_id in honest_leader:
            sku_honest[honest_leader[list_id]] += 1
        if rival is not None:
            contested.update(lists=1, shown=top_efes, honest=is_honest, top3=top3_efes, impressions=n, efes=n_efes)
        day = trend[timezone.localtime(ts, tz).date()]
        day[0] += 1
        day[1] += top_efes
        day[2] += is_honest
        d = dishes.setdefault(dish_id, {"lists": 0, "shown": 0, "honest": 0, "rivals": Counter()})
        d["lists"] += 1
        d["shown"] += top_efes
        d["honest"] += is_honest
        if h1_other_drink:
            d["rivals"][h1_other_drink] += 1
        if venue_id is not None:
            venues[venue_id].update(lists=1, shown=top_efes, honest=is_honest, contested=rival is not None,
                                    c_shown=bool(top_efes and rival is not None),
                                    c_honest=bool(is_honest and rival is not None))
        src = sources[source]
        src[0] += 1
        src[1] += top_efes
        src[2] += is_honest
        if top_cat and not top_efes:
            competitors[top_cat] += 1

    sessions = imp.order_by().values("session_hash").distinct().count()

    # ── заказы, действия, отзывы ──
    orders, order_info = _orders(ds, act, demo=demo, venue=venue, city_ids=city_ids, start=start, end=end,
                                 demo_ids=demo_ids)
    efes_orders = [o for o in orders if _is_efes(ds, o[0])]
    orders_by_day: Counter = Counter()
    orders_by_drink: Dict[str, List[Any]] = defaultdict(lambda: [0, Decimal("0")])
    orders_by_venue: Dict[Any, List[Any]] = defaultdict(lambda: [0, Decimal("0")])
    for drink_id, venue_id, price, ts in efes_orders:
        orders_by_day[timezone.localtime(ts, tz).date()] += 1
        orders_by_drink[drink_id][0] += 1
        orders_by_drink[drink_id][1] += price
        if venue_id is not None:
            orders_by_venue[venue_id][0] += 1
            orders_by_venue[venue_id][1] += price

    action_counts = {kind: 0 for kind, _ in PairingAction.KIND_CHOICES}
    for kind, n in act.order_by().values("kind").annotate(n=Count("id")).values_list("kind", "n"):
        action_counts[kind] = n
    action_counts["order_intent"] = len(orders)
    opens = dict(act.filter(kind="open_drink").order_by().values("drink_id").annotate(n=Count("id"))
                 .values_list("drink_id", "n"))

    review_rows: List[Tuple[str, int, int]] = []
    if not demo:        # отзывы — только настоящие: у PairingReview нет демо-записей
        reviews = PairingReview.objects.filter(status="published", created_at__gte=start, created_at__lt=end)
        if venue is not None:
            reviews = reviews.filter(venue=venue)
        if city_ids is not None:
            reviews = reviews.filter(venue_id__in=city_ids)
        review_rows = list(reviews.order_by().values("drink_id").annotate(n=Count("id"), s=Sum("rating"))
                           .values_list("drink_id", "n", "s"))
    rev = {"efes": [0, 0], "others": [0, 0]}
    review_by_drink: Dict[str, Tuple[int, int]] = {}
    for drink_id, n, s in review_rows:
        side = rev["efes" if _is_efes(ds, drink_id) else "others"]
        side[0] += n
        side[1] += s or 0
        review_by_drink[drink_id] = (n, s or 0)

    # ── SKU портфеля: все напитки Efes из каталога, даже если их ни разу не показали ──
    sku_stats = {row[0]: row[1:] for row in imp.filter(efes=True).order_by().values("drink_id").annotate(
        n=Count("id"), top1=Count("id", filter=Q(rank=1)), score_sum=Sum("score"))
        .values_list("drink_id", "n", "top1", "score_sum")}
    skus = []
    for raw in ds.drinks:
        if not E.is_efes_relation(raw.get("efes_relation"), ds.params):
            continue
        drink_id = raw["id"]
        n, top1, score_sum = sku_stats.get(drink_id, (0, 0, 0))
        n_orders, kzt = orders_by_drink.get(drink_id, (0, Decimal("0")))
        r_n, r_s = review_by_drink.get(drink_id, (0, 0))
        skus.append({
            "drink_id": drink_id, "name": _drink_name(ds, drink_id), "impressions": n, "top1": top1,
            "top1_honest": sku_honest.get(drink_id, 0), "opens": opens.get(drink_id, 0), "orders": n_orders,
            "order_kzt": round(float(kzt), 2), "avg_score": _avg(score_sum or 0, n),
            "review_mean": _avg(r_s, r_n, 2), "review_n": r_n,
        })
    skus.sort(key=lambda s: (-s["impressions"], -s["orders"], -s["review_n"], s["name"], s["drink_id"]))

    labels = ds.params.get("labels", {}).get("category", {})
    competitors_out = [{"category": c, "label": labels.get(c, c), "top1": n, "share": _share(n, lists)}
                       for c, n in sorted(competitors.items(), key=lambda kv: (-kv[1], kv[0]))]

    dishes_out = []
    for dish_id, d in dishes.items():
        rival = None
        if d["rivals"]:
            rival_id = sorted(d["rivals"].items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
            raw = ds.drink_raw_by_id.get(rival_id) or {}
            rival = {"drink_id": rival_id, "name": _drink_name(ds, rival_id), "category": raw.get("category") or ""}
        dishes_out.append({"dish_id": dish_id, "name": _dish_name(ds, dish_id), "lists": d["lists"],
                           "efes_top1_share": _share(d["shown"], d["lists"]),
                           "efes_top1_share_honest": _share(d["honest"], d["lists"]),
                           "top_competitor": rival})
    dishes_out.sort(key=lambda x: (-x["lists"], x["dish_id"]))

    venue_ids = set(venues) | set(orders_by_venue)
    venue_objs = {v.id: v for v in Venue.objects.filter(id__in=venue_ids)} if venue_ids else {}
    venues_out = []
    for vid in venue_ids:
        v = venue_objs.get(vid)
        if v is None:
            continue
        c = venues.get(vid) or Counter()
        n_orders, kzt = orders_by_venue.get(vid, (0, Decimal("0")))
        venues_out.append({"slug": v.slug or str(v.id), "name": v.name, "city": v.city, "lists": c["lists"],
                           "efes_top1_share": _share(c["shown"], c["lists"]),
                           "efes_top1_share_honest": _share(c["honest"], c["lists"]),
                           "contested_lists": c["contested"],
                           "contested_top1_share_shown": _share(c["c_shown"], c["contested"]),
                           "contested_top1_share_honest": _share(c["c_honest"], c["contested"]),
                           "is_demo_venue": vid in demo_ids,
                           "orders": n_orders, "order_kzt": round(float(kzt), 2)})
    venues_out.sort(key=lambda x: (-x["lists"], -x["orders"], x["slug"]))

    trend_out = []
    for i in range(days):
        day = from_date + timedelta(days=i)
        n_lists, n_shown, n_honest = trend.get(day, (0, 0, 0))
        trend_out.append({"date": day.isoformat(), "lists": n_lists, "efes_top1_shown": n_shown,
                          "efes_top1_honest": n_honest, "orders": orders_by_day.get(day, 0)})

    window = ds.params["recommend"]["partner_tie_window"]
    policy_note = (f"Баллы честные и от бренда не зависят. Политика показа: если напиток Efes уступает лучшему "
                   f"не больше {E.fmt_num(window)} балла, он ставится первым. «Как показано» включает этот эффект, "
                   f"«по честному баллу» — нет: Efes засчитывается, только если его балл строго выше, чем у лучшего "
                   f"конкурента и в показанном списке, и во всём пуле кандидатов, из которого список собран.")
    if pool_unknown:
        policy_note += (f" У {pool_unknown} {_plural(pool_unknown, 'списка', 'списков', 'списков')} от старых версий "
                        f"приложения пула нет — там сравнение только с показанным списком.")
    body = {
        "period": {"days": days, "from": from_date.isoformat(), "to": to_date.isoformat()},
        "demo": demo,
        "has_demo_data": PairingImpression.objects.filter(is_demo=True).exists(),
        "totals": {"lists": lists, "impressions": impressions, "sessions": sessions,
                   "venues": len([v for v in venues if v is not None]), "dishes": len(dishes)},
        "efes": {
            "top1_share_shown": _share(shown, lists),
            "top1_share_honest": _share(honest, lists),
            "top3_share": _share(top3, lists),
            "impression_share": _share(efes_impressions, impressions),
            # оба средних — по одним и тем же спискам (где есть Efes); лидер — лучший балл списка или пула
            "avg_score_efes_top": _avg(efes_best_sum, efes_lists),
            "avg_score_best": _avg(leader_sum, efes_lists),
            "avg_score_gap": _avg(leader_sum - efes_best_sum, efes_lists),
            "lists_with_efes": efes_lists,
        },
        "policy_effect": {"lists_where_efes_promoted_to_top1": promoted, "share": _share(promoted, lists),
                          "note": policy_note, "window": window,
                          # сверх контракта: из них ничьих по баллу (Efes не уступал, но и не выигрывал) и списков,
                          # где равный или более сильный конкурент в показанный список не попал
                          "ties": ties, "hidden_competitor": hidden, "lists_without_pool": pool_unknown},
        "trend": trend_out,
        "skus": skus,
        "competitors": competitors_out,
        "dishes": dishes_out,
        "venues": venues_out,
        "actions": action_counts,
        "reviews": {"efes_mean": _avg(rev["efes"][1], rev["efes"][0], 2), "efes_n": rev["efes"][0],
                    "others_mean": _avg(rev["others"][1], rev["others"][0], 2), "others_n": rev["others"][0]},
        # сверх контракта: где Efes действительно соревновался и откуда пришли списки
        "contested": {"lists": contested["lists"],
                      "top1_share_shown": _share(contested["shown"], contested["lists"]),
                      "top1_share_honest": _share(contested["honest"], contested["lists"]),
                      "top3_share": _share(contested["top3"], contested["lists"]),
                      "impression_share": _share(contested["efes"], contested["impressions"])},
        "by_source": {src: {"lists": v[0], "top1_share_shown": _share(v[1], v[0]),
                            "top1_share_honest": _share(v[2], v[0])} for src, v in sorted(sources.items())},
    }
    body["notes"] = _notes(body, demo=demo, order_info=order_info)
    return body


def _notes(body: Dict[str, Any], *, demo: bool, order_info: Dict[str, int]) -> List[str]:
    """Пояснения к цифрам для «Как считаем»: только то, что зависит от данных периода, и названиями разделов
    страницы (определения, плашку демо и пустые отзывы страница пишет сама)."""
    notes: List[str] = []
    lists = body["totals"]["lists"]
    if demo:
        notes.append(f"{DEMO_BANNER}. Списки посчитаны настоящим движком v2 по настоящему каталогу, но гости, "
                     "популярность блюд, клики и заказы заданы вероятностями генератора, а карта и цены "
                     "демо-заведений выдуманы. Это иллюстрация того, как будет выглядеть отчёт, а не результат.")
        if not body["has_demo_data"]:
            notes.append("Демо-поток на сервере ещё не собран.")
    if not lists:
        notes.append("За период нет показанных списков — доли равны 0, это не «0 % у Efes», а отсутствие данных.")
    else:
        c, p = body["contested"], body["policy_effect"]
        closed = lists - c["lists"]
        if closed:
            of_lists = _plural(lists, "списка", "списков", "списков")
            notes.append(f"{closed} из {lists} {of_lists} ({_pct(closed / lists)}) были без конкурентов: ни в "
                         f"списке, ни среди кандидатов, из которых он собран (карта заведения, фильтр «только в этом "
                         f"заведении»), не было напитков не из портфеля Efes. Там 1-е место не результат сравнения. "
                         f"В списках с конкурентами Efes первый в "
                         f"{_pct(c['top1_share_shown'])} как показано и {_pct(c['top1_share_honest'])} по честному "
                         f"баллу.")
        if p["hidden_competitor"]:
            n_hidden = p["hidden_competitor"]
            notes.append(f"В {n_hidden} {_plural(n_hidden, 'списке', 'списках', 'списках')} окно подняло Efes, а "
                         f"равный или более сильный конкурент в короткий показанный список не попал. Они учтены как "
                         f"эффект окна, а не как честная победа.")
    notes.append("Заказы — нажатия «Заказать» (намерение, а не чек). Сумму в ₸ сервер считает по цене позиции в карте "
                 "заведения, а не по цене из браузера; без заведения или позиции в карте нажатие считается, сумма — "
                 "нет. В разделах «По дням», «Портфель по SKU» и «Заведения» — только напитки Efes, в «Что делают "
                 "гости со списком» — все напитки.")
    if order_info.get("menu_duplicates"):
        notes.append("Нажатия «Заказать» из меню заведения, пришедшие двумя путями, посчитаны один раз: "
                     f"{order_info['menu_duplicates']}.")
    skipped = order_info.get("menu_unmatched", 0) + order_info.get("menu_repeats", 0)
    if skipped:
        notes.append(f"Не учтены {skipped} {_plural(skipped, 'нажатие', 'нажатия', 'нажатий')} «Заказать» из меню "
                     f"заведения: у этой сессии не было показанного в заведении списка или такой же заказ уже засчитан "
                     f"за последние 30 минут.")
    if order_info.get("demo_venue_orders"):
        notes.append(f"Не учтены {order_info['demo_venue_orders']} "
                     f"{_plural(order_info['demo_venue_orders'], 'нажатие', 'нажатия', 'нажатий')} «Заказать» в "
                     f"демо-заведениях: карта и цены там выдуманы. Сами показы списков там настоящие, такие заведения "
                     f"помечены «демо-заведение».")
    return notes


# ────────────────────────────────  эндпоинт  ─────────────────────────────────

@api_view(["GET"])
@brand_only
def overview(request):
    q = request.query_params
    days = _int((q.get("days") or str(DEFAULT_DAYS)).strip(), 1, MAX_DAYS)
    if days is None:
        return Response({"detail": f"days — целое 1…{MAX_DAYS}", "field": "days"}, status=status.HTTP_400_BAD_REQUEST)
    demo_raw = (q.get("demo") or "0").strip().lower()
    if demo_raw not in ("0", "1", "true", "false"):
        return Response({"detail": "demo — 0 или 1", "field": "demo"}, status=status.HTTP_400_BAD_REQUEST)
    demo = demo_raw in ("1", "true")
    to_date = None
    if q.get("to"):
        try:
            to_date = date.fromisoformat(q.get("to").strip())
        except ValueError:
            return Response({"detail": "to — дата YYYY-MM-DD", "field": "to"}, status=status.HTTP_400_BAD_REQUEST)
        if not MIN_TO <= to_date <= timezone.localdate() + timedelta(days=1):   # за краями дат — OverflowError
            return Response({"detail": f"to — дата с {MIN_TO.isoformat()} по завтрашний день", "field": "to"},
                            status=status.HTTP_400_BAD_REQUEST)
    elif demo:
        to_date = latest_demo_date()          # демо собрано на фиксированную дату — показываем его окно целиком
    venue = None
    slug = (q.get("venue") or "").strip()
    if slug:
        venue = Venue.objects.filter(slug=slug).first()
        if venue is None:
            return Response({"detail": "Заведение не найдено", "field": "venue"}, status=status.HTTP_404_NOT_FOUND)
    city = (q.get("city") or "").strip()[:100]
    body = compute_overview(days=days, to_date=to_date, demo=demo, venue=venue, city=city)
    return Response(body, headers={"Cache-Control": "private, no-store"})
