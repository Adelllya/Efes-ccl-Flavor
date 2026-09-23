"""Демо-поток для дашборда бренда: списки подбора, посчитанные НАСТОЯЩИМ движком v2, и действия гостей.

    python manage.py seed_brand_demo                          # 1500 списков за 30 дней по 2026-09-22
    python manage.py seed_brand_demo --clear --lists 3000 --days 60 --seed 7 --to 2026-10-31
    python manage.py seed_brand_demo --clear --export ../data/brand_demo_overview.json

Честность: каждая строка помечена is_demo=True, настоящие записи (is_demo=False) команда не читает и не трогает;
--clear удаляет только демо. Движок, каталог, блюда и порядок выдачи — настоящие (dataset_v2 + engine_v2.recommend,
та же политика partner_order и та же диверсификация, что в SPA). Выдумано всё про гостей: сколько их, какие блюда
они открывают, когда приходят, что раскрывают и что «заказывают» — это вероятности ниже, а не измерения.
Дашборд показывает такие данные только с demo=1 и с плашкой «Демо-данные».

Демо-заведения — аккаунты seed_saas (…@demo.flavortree.kz), если они есть: их карта (сорта и цены) задаёт пул
напитков и цены «заказов». Нет заведений — только списки с сайта (source=pair, без заведения).

--export PATH пишет /api/brand/overview/?demo=1 за [--to − days + 1, --to] в JSON (data/brand_demo_overview.json —
демо фронтенда без бэкенда). Детерминировано при одинаковых --seed, --to, данных и версии движка.
Собирать файл — во временной базе, не в рабочей (docs/EFES_ANALYTICS.md):
    FT_SQLITE_PATH=/tmp/brand_demo.sqlite3 python manage.py migrate
    FT_SQLITE_PATH=/tmp/brand_demo.sqlite3 python manage.py seed_saas --events 0
    FT_SQLITE_PATH=/tmp/brand_demo.sqlite3 python manage.py seed_brand_demo --clear --export ../data/brand_demo_overview.json
"""
from __future__ import annotations

import json
import random
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from api import views_brand as B
from api import views_tracking as T
from api.models import PairingAction, PairingImpression, Venue
from api.pairing import engine_v2 as E

DEFAULT_TO = "2026-09-22"
DEFAULT_SEED = 2026

# ── допущения генератора (не измерения) ─────────────────────────────────────
# Относительная популярность блюд в барах и пабах Казахстана — экспертная прикидка для демо. Остальные блюда
# каталога получают DISH_BASE_WEIGHT, чтобы длинный хвост тоже встречался.
DISH_WEIGHTS: Dict[str, float] = {
    "shashlyk": 10, "burger": 7, "buffalo-wings": 6, "fries": 6, "garlic-croutons": 6, "beshbarmak": 5,
    "manty": 5, "plov": 5, "lagman": 5, "sushi": 5, "pizza-pepperoni": 5, "salted-nuts": 5, "kazy": 4,
    "samsa": 4, "bbq-wings": 4, "shashlyk-chicken": 4, "cheeseburger": 4, "shawarma": 4, "caesar-salad": 4,
    "philadelphia-roll": 4, "nachos": 4, "kurt": 3, "vobla": 3, "calamari-rings": 3, "mozzarella-sticks": 3,
    "cheese-plate": 3, "cold-cuts": 3, "pizza-margherita": 3, "bratwurst": 3, "steak": 3, "lyulya-kebab": 3,
    "pelmeni": 3, "khinkali": 3, "chebureki": 3, "kuyrdak": 3, "zhaya": 2, "baursaki": 2, "crayfish-boiled": 2,
    "pork-knuckle": 2, "ribeye-steak": 2, "fish-and-chips": 2, "bbq-ribs": 2, "pretzel": 2, "currywurst": 2,
    "garlic-shrimp": 2, "ramen": 2, "tom-yum": 1, "pad-thai": 1,
}
DISH_BASE_WEIGHT = 0.4
WEEKDAY_WEIGHTS = (0.8, 0.85, 0.9, 1.0, 1.35, 1.45, 1.1)            # пн … вс
HOURS_VENUE = {12: .5, 13: .6, 14: .5, 15: .3, 16: .3, 17: .5, 18: .9, 19: 1.3, 20: 1.5, 21: 1.4, 22: 1.1, 23: .7}
HOURS_WEB = {9: .2, 10: .3, 11: .4, 12: .6, 13: .6, 14: .5, 15: .4, 16: .4, 17: .6, 18: .9, 19: 1.1, 20: 1.2,
             21: 1.0, 22: .7, 23: .4}
LOCALES = (("ru", .80), ("kk", .12), ("en", .08))
OCCASIONS = ((None, .55), ("meal", .12), ("evening", .10), ("party", .08), ("hot", .05), ("gourmet", .04),
             ("aperitif", .03), ("non_alcoholic", .03))
EXTRA_TABS = (("beer", .40), ("na", .15), ("wine", .15), ("cider", .12), ("cocktail", .12), ("spirit", .06))
P_VENUE_SESSION = 0.45        # сессия началась со скана QR в заведении (если демо-заведения есть)
P_VENUE_PAIR_PAGE = 0.35      # гость из заведения открыл ещё и страницу подбора
P_ONLY_VENUE = 0.85           # на странице подбора оставил фильтр «только в этом заведении» (по умолчанию включён)
P_EXTRA_DISH = (0.35, 0.12)   # второе и третье блюдо в сессии
P_EXTRA_TAB = 0.30            # после «Лучшее» открыл ещё одну вкладку
P_EXPAND_WHY, P_OPEN_DRINK = 0.22, 0.08
# Действие review не генерируем: SPA его пока не шлёт, и в настоящем потоке счётчик будет 0 — демо не должно
# показывать метрику, которую настоящий поток не собирает.
P_ORDER_VENUE_MENU = 0.18     # «Заказать» в шторке блюда меню заведения
RANK_PICK = (0.55, 0.25, 0.12, 0.05, 0.03)                         # на какое место кликают
TOP_PAIR, TOP_VENUE_MENU = 5, 3                                    # как в SPA: pair-results и шторка меню


def _pick(rnd: random.Random, options: Sequence[Tuple[Any, float]]) -> Any:
    values, weights = zip(*options)
    return rnd.choices(values, weights=weights, k=1)[0]


class _Venue:
    """Демо-заведение: пул напитков из его карты, цены, блюда меню, столы."""

    def __init__(self, venue: Venue, refs: Dict[str, str], dish_ids: set):
        self.venue = venue
        self.prices: Dict[str, Decimal] = {}
        dishes: List[str] = []
        for item in venue.menu_items.filter(is_available=True).order_by("kind", "sort_order", "ref_slug"):
            if item.kind == "BEER" and item.ref_slug in refs:
                self.prices.setdefault(refs[item.ref_slug], item.price)
            elif item.kind == "DISH" and item.ref_slug in dish_ids and item.ref_slug not in dishes:
                dishes.append(item.ref_slug)
        if not self.prices:          # карты нет — как views_engine_v2: сорта заведения (v1)
            for slug in sorted(b.slug or str(b.id) for b in venue.brands.all()):
                if slug in refs:
                    self.prices.setdefault(refs[slug], None)
        self.drink_ids = sorted(self.prices)
        self.dishes = dishes
        self.tables = sorted(venue.qrcodes.values_list("table_number", flat=True)) or [1]


class Command(BaseCommand):
    help = "Демо-поток для аналитики бренда (is_demo=True): настоящий движок v2, выдуманные гости"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=30, help="Длина периода, дней (30)")
        parser.add_argument("--lists", type=int, default=1500, help="Сколько показанных списков сгенерировать (1500)")
        parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help=f"Seed генератора ({DEFAULT_SEED})")
        parser.add_argument("--to", default=DEFAULT_TO, help=f"Последний день периода YYYY-MM-DD ({DEFAULT_TO})")
        parser.add_argument("--clear", action="store_true", help="Сначала удалить прежние демо-записи (только is_demo)")
        parser.add_argument("--export", metavar="PATH", help="Записать /api/brand/overview/?demo=1 в JSON")

    def handle(self, *args, **opts):
        days, n_lists = opts["days"], opts["lists"]
        if not 1 <= days <= B.MAX_DAYS:
            raise CommandError(f"--days: 1…{B.MAX_DAYS}")
        if n_lists < 0:
            raise CommandError("--lists ≥ 0")
        try:
            to_date = date.fromisoformat(opts["to"])
        except ValueError:
            raise CommandError("--to: дата YYYY-MM-DD")
        if not B.MIN_TO <= to_date <= date(2100, 12, 31):
            raise CommandError(f"--to: дата с {B.MIN_TO.isoformat()} по 2100-12-31")

        demo_rows = PairingImpression.objects.filter(is_demo=True)
        if opts["clear"]:
            n_imp, _ = demo_rows.delete()
            n_act, _ = PairingAction.objects.filter(is_demo=True).delete()
            self.stdout.write(self.style.WARNING(f"Удалено демо-записей: показов {n_imp}, действий {n_act}"))
        elif n_lists and demo_rows.exists():
            raise CommandError("Демо уже есть — добавьте --clear, чтобы пересобрать (настоящие данные не тронутся)")

        ds = T._ds()
        if not ds.guest_drink_profiles or not ds.dish_by_id:
            raise CommandError("Нет data/drinks.json или data/dishes_v2.json — движку нечего считать")

        if n_lists:
            made, n_actions, venues = self._generate(ds, n_lists, days, to_date, random.Random(opts["seed"]))
            where = ", ".join(v.venue.slug for v in venues) or "без заведений (seed_saas не запускали)"
            self.stdout.write(self.style.SUCCESS(
                f"Демо: {made} списков, {n_actions} действий за {days} дн. по {to_date} (seed {opts['seed']}); "
                f"заведения: {where}"))

        if opts["export"]:
            body = B.compute_overview(days=days, to_date=to_date, demo=True, ds=ds)
            path = Path(opts["export"])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            e = body["efes"]
            self.stdout.write(self.style.SUCCESS(
                f"Экспорт: {path} — {body['totals']['lists']} списков; Efes №1 как показано "
                f"{e['top1_share_shown']:.1%}, по честному баллу {e['top1_share_honest']:.1%}"))

    # ── генерация ──────────────────────────────────────────────────────────────
    def _generate(self, ds, n_lists: int, days: int, to_date: date, rnd: random.Random):
        tz = timezone.get_current_timezone()
        refs = B.ref_to_drink(ds)
        dish_ids = sorted(ds.dish_by_id)
        demo_ids = B.demo_venue_ids()
        venues = [_Venue(v, refs, set(dish_ids)) for v in
                  Venue.objects.filter(id__in=demo_ids, is_active=True).order_by("slug")]
        venues = [v for v in venues if v.drink_ids and v.dishes]
        day_options = [(to_date - timedelta(days=i), WEEKDAY_WEIGHTS[(to_date - timedelta(days=i)).weekday()])
                       for i in range(days - 1, -1, -1)]
        _, _, end = B.period_bounds(days, to_date)
        dish_weights = [(d, DISH_WEIGHTS.get(d, DISH_BASE_WEIGHT)) for d in dish_ids]
        calibration = str((ds.calibration or {}).get("version") or "")[:40]
        memo: Dict[Tuple[Any, ...], Tuple[List[Dict[str, Any]], int]] = {}

        def shown(dish_id: str, occasion: Optional[str], tab: Optional[str], pool_ids: Optional[Tuple[str, ...]],
                  top: int) -> Tuple[List[Dict[str, Any]], int]:
            """Список, который увидел бы гость: engine_v2.recommend над пулом SPA (guest_drink_profiles), и лучший
            не-Efes всего пула кандидатов (0 — их нет), как его шлёт SPA (pool_best_other)."""
            key = (dish_id, occasion, tab, pool_ids, top)
            if key not in memo:
                ctx = {"occasion": occasion} if occasion else {}
                cats = T.TAB_GROUPS.get(tab or "")
                args = (ds.dish_by_id[dish_id], ds.guest_drink_profiles, ctx)
                kw = {"params": ds.params, "classics": ds.classic_index, "categories": cats,
                      "venue_drink_ids": pool_ids, "explain": False}
                rec = E.recommend(*args, top_n=top, **kw)
                pool = E.recommend(*args, top_n=0, **kw)["items"]
                memo[key] = ([{"drink_id": r["drink_id"], "rank": i + 1, "score": int(r["score"])}
                              for i, r in enumerate(rec["items"])],
                             max((int(r["score"]) for r in pool if not r["efes_partner"]), default=0))
            return memo[key]

        impressions: List[PairingImpression] = []
        actions: List[PairingAction] = []
        made = 0
        while made < n_lists:
            day = _pick(rnd, day_options)
            vs: Optional[_Venue] = rnd.choices(venues, weights=[len(v.tables) for v in venues], k=1)[0] \
                if venues and rnd.random() < P_VENUE_SESSION else None
            hours = HOURS_VENUE if vs else HOURS_WEB
            ts = timezone.make_aware(datetime.combine(day, time(_pick(rnd, list(hours.items())),
                                                                rnd.randrange(60), rnd.randrange(60))), tz)
            session = f"demo{rnd.getrandbits(64):016x}"
            s_hash = T.session_hash(session)
            ip_hash = T._hmac("ip", f"demo-ip-{rnd.randrange(900)}")
            locale = _pick(rnd, LOCALES)
            table = rnd.choice(vs.tables) if vs else None
            plan: List[Tuple[str, str, Optional[str], Optional[str], Optional[Tuple[str, ...]], int]] = []
            n_dishes = 1 + sum(rnd.random() < p for p in P_EXTRA_DISH)
            if vs:                               # QR в заведении: шторки блюд меню (топ-3 из карты)
                for _ in range(n_dishes):
                    dish = _pick(rnd, [(d, DISH_WEIGHTS.get(d, DISH_BASE_WEIGHT)) for d in vs.dishes])
                    plan.append(("venue_menu", dish, None, None, tuple(vs.drink_ids), TOP_VENUE_MENU))
                if rnd.random() < P_VENUE_PAIR_PAGE:
                    only = tuple(vs.drink_ids) if rnd.random() < P_ONLY_VENUE else None
                    plan.append(("pair", plan[0][1], "best", None, only, TOP_PAIR))
            else:                                # сайт: «Лучшее» к блюду и иногда ещё одна вкладка
                occasion = _pick(rnd, OCCASIONS)
                for _ in range(n_dishes):
                    dish = _pick(rnd, dish_weights)
                    plan.append(("pair", dish, "best", occasion, None, TOP_PAIR))
                    if rnd.random() < P_EXTRA_TAB:
                        plan.append(("pair", dish, _pick(rnd, EXTRA_TABS), occasion, None, TOP_PAIR))

            rows: List[Tuple[Dict[str, Any], datetime]] = []
            for source, dish, tab, occasion, pool_ids, top in plan:
                items, pool_best = shown(dish, occasion, tab, pool_ids, top)
                ts += timedelta(seconds=rnd.randint(40, 240))
                if not items:
                    continue                     # пустая вкладка: SPA её не показывает — и мы не пишем
                form = {
                    "type": "list", "list_id": uuid.UUID(int=rnd.getrandbits(128), version=4), "source": source,
                    "dish_id": dish, "tab": tab or "", "occasion": occasion or "", "locale": locale,
                    "session": session, "venue_slug": vs.venue.slug if vs else "", "table": table,
                    "engine": E.ENGINE_VERSION, "calibration": calibration,
                    "items": [{**it, **T.drink_facts(ds, it["drink_id"])} for it in items],
                    "pool_best_other": pool_best,
                }
                rows.append((form, ts))
            if not rows:
                continue
            overflow = rows[-1][1] + timedelta(minutes=5) - end   # сессия не выходит за последний день периода
            shift = overflow if overflow > timedelta(0) else timedelta(0)
            for form, ts_list in rows:
                if made >= n_lists:
                    break
                ts_list -= shift
                common = {"venue": vs.venue if vs else None, "session_hash": s_hash, "ip_hash": ip_hash,
                          "is_demo": True}
                impressions.extend(T.impressions_for_list(form, created_at=ts_list, **common))
                for kind, drink_id, price in self._actions(rnd, form, vs):
                    act = {"type": "action", "kind": kind, "list_id": form["list_id"], "drink_id": drink_id,
                           "dish_id": form["dish_id"], "session": session, "venue_slug": form["venue_slug"],
                           "price": price, "facts": T.drink_facts(ds, drink_id)}
                    row = T.action_row(act, created_at=ts_list + timedelta(seconds=rnd.randint(8, 150)), **common)
                    if row is not None:
                        actions.append(row)
                made += 1

        with transaction.atomic():
            PairingImpression.objects.bulk_create(impressions, batch_size=2000)
            PairingAction.objects.bulk_create(actions, batch_size=2000)
        return made, len(actions), venues

    @staticmethod
    def _actions(rnd: random.Random, form: Dict[str, Any], vs: Optional[_Venue]):
        """Что гость сделал со списком: вероятности генератора, не измерения."""
        items = form["items"]

        def by_rank(candidates):
            weights = [RANK_PICK[min(it["rank"], len(RANK_PICK)) - 1] for it in candidates]
            return rnd.choices(candidates, weights=weights, k=1)[0]

        out = []
        if form["source"] == "venue_menu":
            # в шторке меню есть только «Заказать»; цена — из карты заведения
            if vs and rnd.random() < P_ORDER_VENUE_MENU:
                orderable = [it for it in items if it["drink_id"] in vs.prices]
                if orderable:
                    it = by_rank(orderable)
                    out.append(("order_intent", it["drink_id"], vs.prices[it["drink_id"]]))
            return out
        if rnd.random() < P_EXPAND_WHY:
            out.append(("expand_why", by_rank(items)["drink_id"], None))
        if rnd.random() < P_OPEN_DRINK:
            out.append(("open_drink", by_rank(items)["drink_id"], None))
        return out
