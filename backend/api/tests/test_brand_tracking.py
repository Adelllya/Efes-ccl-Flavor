"""Аналитика бренда: трекинг показов (api/views_tracking.py), сводка (api/views_brand.py), доступ (api/auth.py brand_only),
демо-поток (seed_brand_demo). Документация — docs/EFES_ANALYTICS.md.

Запуск: .venv/bin/python manage.py test api.tests.test_brand_tracking
Данные движка — настоящие data/*.json: id напитков и блюд тесты выбирают из каталога сами (без data/drinks.json
тесты пропускаются). Математику сводки проверяем на вручную собранных списках с заранее посчитанными ответами.
"""
from __future__ import annotations

import io
import json
import os
import tempfile
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest import mock, skipUnless

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api import views_brand as B
from api import views_tracking as T
from api.models import (MenuEvent, PairingAction, PairingImpression, PairingReview, TrackingRate, Venue, VenueAccount,
                        VenueMenuItem)
from api.pairing import engine_v2 as E
from api.pairing.dataset_v2 import get_dataset

DS = get_dataset(str(settings.FLAVOR_DATA_DIR))
HAS_DATA = bool(DS.drinks) and bool(DS.dish_by_id)
TRACK = "/api/v2/track/"
OVERVIEW = "/api/brand/overview/"
BRAND_TOKEN = "test-brand-token-9c1e44"
EXPORT = Path(settings.BASE_DIR).parent / "data" / "brand_demo_overview.json"
CONTRACT_KEYS = {"period", "demo", "has_demo_data", "totals", "efes", "policy_effect", "trend", "skus", "competitors",
                 "dishes", "venues", "actions", "reviews", "notes"}


def _efes(raw) -> bool:
    return E.is_efes_relation(raw.get("efes_relation"), DS.params)


def _pick_drinks():
    """E1 — Efes с legacy_brand_id (для MenuEvent), E2 — другой Efes; O1, O2 — не Efes из разных категорий."""
    if not HAS_DATA:
        return None, None, None, None
    efes = sorted((d for d in DS.drinks if _efes(d)), key=lambda d: d["id"])
    e1 = next(d for d in efes if d.get("legacy_brand_id"))
    e2 = next(d for d in efes if d["id"] != e1["id"])
    others = sorted((d for d in DS.drinks if not _efes(d)), key=lambda d: d["id"])
    o1 = others[0]
    o2 = next(d for d in others if d["category"] != o1["category"])
    return e1["id"], e2["id"], o1["id"], o2["id"]


E1, E2, O1, O2 = _pick_drinks()
DISHES = sorted(DS.dish_by_id)[:2] if HAS_DATA else ["", ""]
D1, D2 = DISHES


def _aware(day: date, hour: int = 20, minute: int = 0) -> datetime:
    return timezone.make_aware(datetime.combine(day, time(hour, minute)), timezone.get_current_timezone())


def _list_event(**over):
    ev = {"type": "list", "list_id": str(uuid.uuid4()), "source": "pair", "dish_id": D1, "tab": "best",
          "venue": None, "table": None, "occasion": None, "locale": "ru", "session": "guest-session-0001",
          "engine": E.ENGINE_VERSION, "calibration": None,
          "items": [{"drink_id": E1, "rank": 1, "score": 80}, {"drink_id": O1, "rank": 2, "score": 82},
                    {"drink_id": O2, "rank": 3, "score": 60}]}
    ev.update(over)
    return ev


def _action_event(**over):
    ev = {"type": "action", "kind": "expand_why", "list_id": None, "drink_id": E1, "dish_id": D1, "venue": None,
          "session": "guest-session-0001", "price": None}
    ev.update(over)
    return ev


class _EnvMixin:
    def setUp(self):
        env = mock.patch.dict(os.environ)   # всё, что тест положит в окружение, откатится
        env.start()
        self.addCleanup(env.stop)
        for key in ("FT_PROXY_HOPS", "FT_BRAND_TOKEN", "FT_ADMIN_TOKEN"):
            os.environ.pop(key, None)
        self.client = APIClient()


# ───────────────────────────────  трекинг  ───────────────────────────────────

@skipUnless(HAS_DATA, "нет data/drinks.json или data/dishes_v2.json")
class TrackTests(_EnvMixin, TestCase):
    def post(self, body, **extra):
        return self.client.post(TRACK, body, format="json", **extra)

    def test_list_writes_one_row_per_drink(self):
        ev = _list_event()
        r = self.post(ev)
        self.assertEqual(r.status_code, 202, r.content)
        self.assertEqual(r.json(), {"ok": True, "accepted": 1})
        rows = list(PairingImpression.objects.order_by("rank"))
        self.assertEqual([x.drink_id for x in rows], [E1, O1, O2])
        self.assertEqual({str(x.list_id) for x in rows}, {ev["list_id"]})
        for x in rows:
            raw = DS.drink_raw_by_id[x.drink_id]
            self.assertEqual(x.category, raw["category"])
            self.assertEqual(x.archetype, raw["style"]["archetype"])
            self.assertEqual(x.efes, _efes(raw))
            self.assertFalse(x.is_demo)
            self.assertEqual((x.dish_id, x.source, x.tab, x.locale), (D1, "pair", "best", "ru"))
            self.assertEqual(x.engine_version, E.ENGINE_VERSION)

    def test_no_raw_session_or_ip_stored(self):
        self.post(_list_event(session="raw-session-SECRET"), REMOTE_ADDR="203.0.113.77")
        self.post(_action_event(session="raw-session-SECRET"), REMOTE_ADDR="203.0.113.77")
        for obj in list(PairingImpression.objects.all()) + list(PairingAction.objects.all()):
            dump = json.dumps({f.name: str(getattr(obj, f.attname)) for f in obj._meta.fields})
            self.assertNotIn("raw-session-SECRET", dump)
            self.assertNotIn("203.0.113.77", dump)
            self.assertEqual(len(obj.session_hash), 64)
            self.assertEqual(obj.session_hash, T.session_hash("raw-session-SECRET"))
            self.assertEqual(obj.ip_hash, T._hmac("ip", "203.0.113.77"))
            self.assertNotEqual(obj.session_hash, obj.ip_hash)

    def test_forwarded_for_trusted_only_with_proxy_hops(self):
        self.post(_list_event(), REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="1.1.1.1, 198.51.100.9")
        self.assertEqual(PairingImpression.objects.first().ip_hash, T._hmac("ip", "10.0.0.1"))
        os.environ["FT_PROXY_HOPS"] = "1"
        self.post(_list_event(), REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="1.1.1.1, 198.51.100.9")
        self.assertEqual(PairingImpression.objects.order_by("-id").first().ip_hash, T._hmac("ip", "198.51.100.9"))

    def test_client_flags_are_ignored(self):
        """efes, category, archetype, honest_rank и is_demo от клиента не принимаются — только из drinks.json."""
        items = [{"drink_id": O1, "rank": 1, "score": 90, "efes": True, "category": "beer", "archetype": "x",
                  "honest_rank": 7},
                 {"drink_id": E1, "rank": 2, "score": 70, "efes": False, "category": "wine"}]
        r = self.post(_list_event(items=items, is_demo=True, efes=True))
        self.assertEqual(r.status_code, 202)
        o1 = PairingImpression.objects.get(drink_id=O1)
        e1 = PairingImpression.objects.get(drink_id=E1)
        self.assertFalse(o1.efes)
        self.assertEqual(o1.category, DS.drink_raw_by_id[O1]["category"])
        self.assertEqual(o1.honest_rank, 1)
        self.assertTrue(e1.efes)
        self.assertEqual(e1.category, DS.drink_raw_by_id[E1]["category"])
        self.assertFalse(PairingImpression.objects.filter(is_demo=True).exists())
        self.post({"events": [_action_event(drink_id=O1, efes=True, is_demo=True)]})
        a = PairingAction.objects.get()
        self.assertFalse(a.efes)
        self.assertFalse(a.is_demo)

    def test_honest_rank_counts_strictly_higher_scores(self):
        items = [{"drink_id": E1, "rank": 1, "score": 80}, {"drink_id": O1, "rank": 2, "score": 82},
                 {"drink_id": O2, "rank": 3, "score": 82}, {"drink_id": E2, "rank": 4, "score": 70}]
        self.post(_list_event(items=items))
        got = dict(PairingImpression.objects.values_list("drink_id", "honest_rank"))
        self.assertEqual(got, {E1: 3, O1: 1, O2: 1, E2: 4})
        self.assertEqual(T.honest_ranks([5, 5, 5]), [1, 1, 1])
        self.assertEqual(T.honest_ranks([90, 3, 50]), [1, 3, 2])

    def test_unknown_drinks_dropped_and_honest_rank_among_known(self):
        items = [{"drink_id": "no-such-drink-zz", "rank": 1, "score": 95}, {"drink_id": E1, "rank": 2, "score": 70},
                 {"drink_id": O1, "rank": 3, "score": 75}]
        r = self.post(_list_event(items=items))
        self.assertEqual(r.json()["accepted"], 1)
        rows = {x.drink_id: x for x in PairingImpression.objects.all()}
        self.assertEqual(set(rows), {E1, O1})
        self.assertEqual((rows[E1].rank, rows[E1].honest_rank), (2, 2))    # место как показано, честное — среди известных
        self.assertEqual((rows[O1].rank, rows[O1].honest_rank), (3, 1))
        r = self.post(_list_event(items=[{"drink_id": "no-such-drink-zz", "rank": 1, "score": 95}]))
        self.assertEqual((r.status_code, r.json()["accepted"]), (202, 0))
        self.assertEqual(PairingImpression.objects.count(), 2)

    def test_duplicates_dropped(self):
        items = [{"drink_id": E1, "rank": 1, "score": 80}, {"drink_id": E1, "rank": 2, "score": 80},
                 {"drink_id": O1, "rank": 3, "score": 70}]
        ev = _list_event(items=items)
        self.assertEqual(self.post(ev).json()["accepted"], 1)
        self.assertEqual(list(PairingImpression.objects.filter(drink_id=E1).values_list("rank", flat=True)), [1])
        # тот же list_id повторно (ретрай клиента) и дважды в одной пачке — ничего нового
        self.assertEqual(self.post(ev).json()["accepted"], 0)
        again = _list_event()
        self.assertEqual(self.post({"events": [again, again]}).json()["accepted"], 1)
        self.assertEqual(PairingImpression.objects.count(), 2 + 3)

    def test_venue_known_unknown(self):
        venue = Venue.objects.create(name="Тест-бар", address="-", venue_type="BAR", slug="test-bar", city="Алматы")
        self.post(_list_event(venue="test-bar", table=7, source="venue_menu", tab=None))
        row = PairingImpression.objects.get(drink_id=E1)
        self.assertEqual((row.venue_id, row.table_number, row.tab), (venue.id, 7, ""))
        PairingImpression.objects.all().delete()
        r = self.post(_list_event(venue="no-such-venue", table=3))
        self.assertEqual(r.status_code, 202)
        row = PairingImpression.objects.get(drink_id=E1)
        self.assertEqual((row.venue_id, row.table_number), (None, None))

    def test_batch_with_actions(self):
        venue = Venue.objects.create(name="Тест-бар", address="-", venue_type="BAR", slug="test-bar")
        VenueMenuItem.objects.create(venue=venue, kind="BEER", ref_slug=E1, price=Decimal("1500"))
        lst = _list_event(venue="test-bar")
        body = {"events": [lst,
                           _action_event(kind="order_intent", list_id=lst["list_id"], venue="test-bar", price=1500),
                           _action_event(kind="open_drink", drink_id=O1, price=999),
                           _action_event(kind="review", drink_id="no-such-drink-zz")]}
        r = self.post(body)
        self.assertEqual(r.status_code, 202)
        self.assertEqual(r.json()["accepted"], 3)             # действие с неизвестным напитком не записано
        order = PairingAction.objects.get(kind="order_intent")
        self.assertEqual((order.venue_id, order.price, order.efes, str(order.list_id)),
                         (venue.id, Decimal("1500.00"), True, lst["list_id"]))
        opened = PairingAction.objects.get(kind="open_drink")
        self.assertIsNone(opened.price)                       # цена имеет смысл только у «Заказать»
        self.assertFalse(opened.efes)

    def test_order_price_comes_from_menu_not_client(self):
        """Цену «Заказать» сервер берёт из карты заведения; присланная клиентом (хоть 99 999 999) игнорируется."""
        bar = Venue.objects.create(name="Бар", address="-", venue_type="BAR", slug="real-bar")
        legacy = DS.drink_raw_by_id[E1]["legacy_brand_id"]
        VenueMenuItem.objects.create(venue=bar, kind="BEER", ref_slug=legacy, price=Decimal("1350"))  # slug v1
        VenueMenuItem.objects.create(venue=bar, kind="BEER", ref_slug=O1, price=Decimal("900"), is_available=False)
        def order(**kw):
            return _action_event(**{"kind": "order_intent", "venue": "real-bar", "price": 99999999, **kw})
        r = self.post({"events": [order(drink_id=E1), order(drink_id=E2), order(drink_id=O1),
                                  order(drink_id=E1, venue=None)]})
        self.assertEqual((r.status_code, r.json()["accepted"]), (202, 4), r.content)
        got = sorted((a.drink_id, a.venue_id is not None, a.price) for a in PairingAction.objects.all())
        self.assertEqual(got, sorted([(E1, True, Decimal("1350.00")),    # по legacy_brand_id позиции карты
                                      (E2, True, None),                  # напитка нет в карте
                                      (O1, True, None),                  # позиция в стоп-листе
                                      (E1, False, None)]))               # без заведения цены нет
        os.environ["FT_BRAND_TOKEN"] = BRAND_TOKEN
        b = self.client.get(OVERVIEW, {"days": "1"}, HTTP_X_BRAND_TOKEN=BRAND_TOKEN).json()
        e1 = next(s for s in b["skus"] if s["drink_id"] == E1)
        self.assertEqual((e1["orders"], e1["order_kzt"]), (2, 1350.0))
        self.assertTrue(any("по цене позиции в карте" in n and "не по цене из браузера" in n for n in b["notes"]))

    def test_text_plain_beacon(self):
        r = self.client.post(TRACK, json.dumps({"events": [_list_event()]}), content_type="text/plain")
        self.assertEqual(r.status_code, 202, r.content)
        self.assertEqual(PairingImpression.objects.count(), 3)
        # так шлёт браузер: Blob type 'text/plain;charset=UTF-8' (core/track-v2.service.ts), кириллица в теле
        lst = _list_event(venue="нет-такого")
        body = {"events": [lst, _action_event(kind="order_intent", list_id=lst["list_id"], price=1600)]}
        r = self.client.post(TRACK, json.dumps(body, ensure_ascii=False).encode("utf-8"),
                             content_type="text/plain;charset=UTF-8")
        self.assertEqual((r.status_code, r.json()), (202, {"ok": True, "accepted": 2}), r.content)

    def test_bad_bodies_400(self):
        bad_items = lambda **kw: _list_event(items=[{"drink_id": E1, "rank": 1, "score": 80, **kw}])  # noqa: E731
        cases = {
            "array body": [_list_event()],
            "empty": {},
            "events not list": {"events": "x"},
            "events empty": {"events": []},
            "too many events": {"events": [_action_event() for _ in range(21)]},
            "event not object": {"events": [1]},
            "unknown type": _list_event(type="impression"),
            "bad list_id": _list_event(list_id="not-a-uuid"),
            "list_id number": _list_event(list_id=12),
            "missing list_id": _list_event(list_id=None),
            "bad source": _list_event(source="email"),
            "unknown dish": _list_event(dish_id="no-such-dish-zz"),
            "bad tab": _list_event(tab="dessert"),
            "bad occasion": _list_event(occasion="wedding"),
            "bad locale": _list_event(locale="de"),
            "missing session": _list_event(session=None),
            "short session": _list_event(session="abc"),
            "session with spaces": _list_event(session="a b c d e f g h"),
            "items empty": _list_event(items=[]),
            "items too long": _list_event(items=[{"drink_id": E1, "rank": i, "score": 50} for i in range(1, 12)]),
            "item not object": _list_event(items=["x"]),
            "score low": bad_items(score=2),
            "score high": bad_items(score=100),
            "score float": bad_items(score=80.5),
            "score bool": bad_items(score=True),
            "rank zero": bad_items(rank=0),
            "rank missing": _list_event(items=[{"drink_id": E1, "score": 80}]),
            "drink id missing": _list_event(items=[{"rank": 1, "score": 80}]),
            "duplicate rank": _list_event(items=[{"drink_id": E1, "rank": 1, "score": 80},
                                                 {"drink_id": O1, "rank": 1, "score": 70}]),
            "table zero": _list_event(table=0),
            "venue number": _list_event(venue=5),
            "bad engine": _list_event(engine="2.2.1; drop"),
            "pool low": _list_event(pool_best_other=2),
            "pool high": _list_event(pool_best_other=100),
            "pool text": _list_event(pool_best_other="80x"),
            "pool bool": _list_event(pool_best_other=True),
            "action bad kind": _action_event(kind="purchase"),
            "action no drink": _action_event(drink_id=None),
            "action unknown dish": _action_event(dish_id="no-such-dish-zz"),
            "three sessions": {"events": [_list_event(session=f"guest-session-000{i}") for i in range(3)]},
        }
        for name, body in cases.items():
            with self.subTest(name):
                r = self.post(body)
                self.assertEqual(r.status_code, 400, (name, r.content))
        r = self.post({"events": [_list_event(), _list_event(score=None, locale="xx")]})
        self.assertEqual((r.status_code, r.json()["index"], r.json()["field"]), (400, 1, "locale"))
        self.assertEqual(PairingImpression.objects.count(), 0)   # пачка с ошибкой не пишется целиком
        self.assertEqual(self.client.post(TRACK, "{oops", content_type="application/json").status_code, 400)

    def test_custom_dish_and_optional_fields(self):
        r = self.post(_list_event(dish_id="custom", tab=None, occasion="party", locale="kk", calibration="cal-2026.09"))
        self.assertEqual(r.status_code, 202)
        row = PairingImpression.objects.get(drink_id=E1)
        self.assertEqual((row.dish_id, row.occasion, row.locale, row.calibration_version),
                         ("custom", "party", "kk", "cal-2026.09"))

    def test_rate_limit_per_session(self):
        with mock.patch.dict(T.RATE_LIMITS, {"session_hash": ((60, 3),)}):
            for _ in range(2):
                self.assertEqual(self.post(_list_event()).status_code, 202)
            self.assertEqual(self.post(_action_event()).status_code, 202)          # список и действие — по событию
            r = self.post(_list_event())
            self.assertEqual(r.status_code, 429)
            self.assertIn("Retry-After", r)
            # другой гость с того же IP — свой лимит
            self.assertEqual(self.post(_list_event(session="other-guest-0002")).status_code, 202)
            # пачка, которая перелезает через лимит, отклоняется целиком
            r = self.post({"events": [_list_event(session="third-guest-0003") for _ in range(4)]})
            self.assertEqual(r.status_code, 429)

    def test_pool_best_other(self):
        """Лучший не-Efes всего пула: поля нет — неизвестно (None), null — конкурентов в пуле нет (0), число —
        не ниже лучшего показанного не-Efes (пул содержит показанные напитки)."""
        only_efes = [{"drink_id": E1, "rank": 1, "score": 80}, {"drink_id": E2, "rank": 2, "score": 70}]
        cases = [({}, None), ({"pool_best_other": None, "items": only_efes}, 0), ({"pool_best_other": 85}, 85),
                 ({"pool_best_other": 50}, 82), ({"pool_best_other": None}, 82), ({"pool_best_other": "84"}, 84)]
        for over, want in cases:
            with self.subTest(over):
                ev = _list_event(**over)
                self.assertEqual(self.post(ev).status_code, 202)
                got = set(PairingImpression.objects.filter(list_id=ev["list_id"]).values_list("pool_best_other",
                                                                                               flat=True))
                self.assertEqual(got, {want})

    def test_rate_limit_per_ip_and_demo_rows_do_not_count(self):
        PairingImpression.objects.create(
            list_id=uuid.uuid4(), source="pair", dish_id=D1, rank=1, honest_rank=1, drink_id=E1, category="beer",
            efes=True, score=80, session_hash=T.session_hash("guest-session-0001"), ip_hash=T._hmac("ip", "127.0.0.1"),
            is_demo=True)
        with mock.patch.dict(T.RATE_LIMITS, {"ip_hash": ((60, 2),)}):
            self.assertEqual(self.post(_list_event(session="guest-aaaa-0001")).status_code, 202)
            self.assertEqual(self.post(_list_event(session="guest-bbbb-0002")).status_code, 202)
            self.assertEqual(self.post(_list_event(session="guest-cccc-0003")).status_code, 429)

    def test_ipv6_limited_per_64(self):
        """Адреса одной сети /64 делят лимит (их абонент меняет бесплатно); другая /64 — свой лимит."""
        self.assertEqual(T.ip_bucket("2001:db8::2bb"), "2001:db8::/64")
        self.assertEqual(T.ip_bucket("::ffff:203.0.113.5"), "203.0.113.5")
        self.assertEqual(T.ip_bucket("203.0.113.5"), "203.0.113.5")
        self.assertEqual(T.ip_bucket("unknown"), "unknown")
        with mock.patch.dict(T.RATE_LIMITS, {"ip_hash": ((60, 2),)}):
            for addr, code in (("2001:db8::1", 202), ("2001:db8::ffff:2", 202), ("2001:db8::3", 429),
                               ("2001:db8:0:1::1", 202)):
                with self.subTest(addr):
                    r = self.post(_list_event(session=f"g-{addr.replace(':', '-')}-x"), REMOTE_ADDR=addr)
                    self.assertEqual(r.status_code, code)
        self.assertEqual(set(PairingImpression.objects.values_list("ip_hash", flat=True)),
                         {T._hmac("ip", "2001:db8::/64"), T._hmac("ip", "2001:db8:0:1::/64")})

    def test_attempts_count_even_when_nothing_is_written(self):
        """Лимит адреса — по присланным событиям: пачка, которая ничего не записала, и тело с ошибкой тоже
        тратят его."""
        unknown = [{"drink_id": "no-such-drink-zz", "rank": 1, "score": 90}]
        with mock.patch.dict(T.RATE_LIMITS, {"ip_hash": ((60, 4),)}):
            r = self.post({"events": [_list_event(items=unknown), _list_event(items=unknown)]})
            self.assertEqual((r.status_code, r.json()["accepted"]), (202, 0))
            self.assertEqual(self.post(_list_event(source="email")).status_code, 400)
            self.assertEqual(self.client.post(TRACK, "{oops", content_type="application/json").status_code, 400)
            self.assertEqual(self.post(_list_event()).status_code, 429)
        self.assertEqual(PairingImpression.objects.count(), 0)
        # адрес: 2 + 1 + 1 + 1 (и отклонённая попытка тоже); общий поток — только прошедшие проверку события (2)
        self.assertEqual(dict(TrackingRate.objects.values_list("key", "n")),
                         {T._hmac("ip", "127.0.0.1"): 5, T.GLOBAL_KEY: 2})

    def test_global_cap(self):
        with mock.patch.dict(T.RATE_LIMITS, {"global": ((60, 3),)}):
            for i, code in enumerate((202, 202, 202, 429)):
                r = self.post(_list_event(session=f"guest-glob-000{i}"), REMOTE_ADDR=f"198.51.100.{i + 1}")
                self.assertEqual(r.status_code, code)
            self.assertIn("Retry-After", r)

    def test_sessions_per_batch_and_query_count(self):
        """Пачка из 20 событий двух сессий: ограниченное число запросов к базе, сколько бы сессий ни было."""
        events = [_list_event(session="guest-session-000" + str(i % 2),
                              items=[{"drink_id": "no-such-drink-zz", "rank": 1, "score": 90}]) for i in range(20)]
        with CaptureQueriesContext(connection) as ctx:
            r = self.post({"events": events})
        self.assertEqual((r.status_code, r.json()["accepted"]), (202, 0))
        self.assertLessEqual(len(ctx.captured_queries), 25, [q["sql"] for q in ctx.captured_queries])
        events = [_list_event(session=f"guest-session-{i:04d}") for i in range(3)]
        r = self.post({"events": events})
        self.assertEqual((r.status_code, r.json()["field"]), (400, "session"))

    def test_oversized_body_413(self):
        body = json.dumps({"events": [_list_event()], "pad": "x" * (T.MAX_BODY_BYTES + 1)})
        r = self.client.post(TRACK, body, content_type="application/json")
        self.assertEqual(r.status_code, 413)
        self.assertEqual(PairingImpression.objects.count(), 0)
        self.assertFalse(TrackingRate.objects.exists())                 # тело даже не разбирали

    def test_menu_event_session_stored_as_tracking_hash(self):
        """Старый /api/track/ (views_saas) больше не хранит сырой id гостя в событиях меню — только HMAC трекинга."""
        Venue.objects.create(name="Бар", address="-", venue_type="BAR", slug="real-bar")
        self.client.post("/api/track/", {"venue": "real-bar", "kind": "ORDER_INTENT", "beer": E1,
                                         "session": "raw-guest-SECRET-1"}, format="json")
        ev = MenuEvent.objects.get()
        self.assertEqual(ev.session_key, T.session_hash("raw-guest-SECRET-1"))
        self.assertNotIn("SECRET", ev.session_key)
# ───────────────────────────────  доступ  ─────────────────────────────────────

class BrandAuthTests(_EnvMixin, TestCase):
    def setUp(self):
        super().setUp()
        os.environ["FT_BRAND_TOKEN"] = BRAND_TOKEN

    def test_no_credentials_401(self):
        r = self.client.get(OVERVIEW)
        self.assertEqual(r.status_code, 401)
        self.assertIn("flavor-tree-brand", r["WWW-Authenticate"])

    def test_wrong_token_403(self):
        self.assertEqual(self.client.get(OVERVIEW, HTTP_AUTHORIZATION="Bearer nope").status_code, 403)
        self.assertEqual(self.client.get(OVERVIEW, HTTP_X_BRAND_TOKEN="nope").status_code, 403)
        self.assertEqual(self.client.get(OVERVIEW, HTTP_AUTHORIZATION=f"Basic {BRAND_TOKEN}").status_code, 403)

    def test_token_both_headers(self):
        self.assertEqual(self.client.get(OVERVIEW, HTTP_AUTHORIZATION=f"Bearer {BRAND_TOKEN}").status_code, 200)
        self.assertEqual(self.client.get(OVERVIEW, HTTP_X_BRAND_TOKEN=BRAND_TOKEN).status_code, 200)

    def test_sommelier_token_is_not_brand_token(self):
        os.environ["FT_ADMIN_TOKEN"] = "sommelier-token-1234"
        self.assertEqual(self.client.get(OVERVIEW, HTTP_X_ADMIN_TOKEN="sommelier-token-1234").status_code, 401)
        self.assertEqual(self.client.get(OVERVIEW, HTTP_AUTHORIZATION="Bearer sommelier-token-1234").status_code, 403)
        # и наоборот: токен бренда не открывает служебный API сомелье
        self.assertEqual(self.client.get("/api/admin/brands/", HTTP_AUTHORIZATION=f"Bearer {BRAND_TOKEN}").status_code,
                         403)

    def test_staff_passes_regular_user_does_not(self):
        User = get_user_model()
        staff = User.objects.create_user("staff", password="x-pass-123", is_staff=True)
        plain = User.objects.create_user("plain", password="x-pass-123")
        self.client.force_login(plain)
        self.assertEqual(self.client.get(OVERVIEW).status_code, 403)
        self.client.force_login(staff)
        self.assertEqual(self.client.get(OVERVIEW).status_code, 200)

    def test_no_token_configured(self):
        os.environ.pop("FT_BRAND_TOKEN")
        self.assertEqual(self.client.get(OVERVIEW, HTTP_AUTHORIZATION="Bearer anything").status_code, 403)
        with override_settings(DEBUG=True), self.assertLogs("api.auth", level="WARNING"):
            self.assertEqual(self.client.get(OVERVIEW).status_code, 200)

    def test_bad_params(self):
        h = {"HTTP_X_BRAND_TOKEN": BRAND_TOKEN}
        after_tomorrow = (timezone.localdate() + timedelta(days=2)).isoformat()
        for q in ("days=0", "days=366", "days=abc", "demo=2", "to=2026-13-01", "days=30&to=0001-01-01",
                  "to=9999-12-31", "to=2019-12-31", f"to={after_tomorrow}"):
            with self.subTest(q):
                r = self.client.get(f"{OVERVIEW}?{q}", **h)
                self.assertEqual(r.status_code, 400)
                self.assertIn(r.json()["field"], ("days", "demo", "to"))
        self.assertEqual(self.client.get(f"{OVERVIEW}?venue=no-such-venue", **h).status_code, 404)
        self.assertEqual(self.client.get(f"{OVERVIEW}?days=365&to={B.MIN_TO.isoformat()}", **h).status_code, 200)


# ───────────────────────────────  математика сводки  ─────────────────────────

TO = date(2026, 9, 20)
DAY1, DAY2, DAY3 = TO - timedelta(days=4), TO - timedelta(days=3), TO - timedelta(days=2)


def _make_list(items, *, dish, day, venue=None, session="s1", demo=False, source="pair", hour=20, pool=None):
    """Список напрямую в базу — той же функцией, что и эндпоинт (факты о напитках — из drinks.json).
    pool — лучший балл не-Efes всего пула кандидатов (0 — их нет, None — клиент не прислал)."""
    form = {"list_id": uuid.uuid4(), "source": source, "dish_id": dish, "tab": "best", "occasion": "", "locale": "ru",
            "table": None, "engine": E.ENGINE_VERSION, "calibration": "", "pool_best_other": pool,
            "items": [{"drink_id": d, "rank": i + 1, "score": s, **T.drink_facts(DS, d)} for i, (d, s) in enumerate(items)]}
    rows = T.impressions_for_list(form, venue=venue, session_hash=T.session_hash(session), ip_hash="ip",
                                  created_at=_aware(day, hour), is_demo=demo)
    PairingImpression.objects.bulk_create(rows)
    return form["list_id"]


def _action(kind, drink, *, day, venue=None, session="s1", price=None, demo=False, hour=20, minute=5):
    return PairingAction.objects.create(kind=kind, drink_id=drink, dish_id=D1, venue=venue, efes=_efes(DS.drink_raw_by_id[drink]),
                                        price=price, session_hash=T.session_hash(session), ip_hash="ip", is_demo=demo,
                                        created_at=_aware(day, hour, minute))


def _menu_event(venue, beer, *, day, session="", price=0, kind="ORDER_INTENT", hour=20, minute=0):
    ev = MenuEvent.objects.create(venue=venue, kind=kind, dish_slug=D1, beer_slug=beer, price=Decimal(price),
                                  session_key=session)
    MenuEvent.objects.filter(pk=ev.pk).update(created_at=_aware(day, hour, minute))


def _review(drink, rating, *, status="published", n=[0]):
    n[0] += 1
    r = PairingReview.objects.create(drink_id=drink, dish_id=D1, dish_key=D1, rating=rating, status=status,
                                     session_hash=f"h{n[0]}", ip_hash="ip")
    PairingReview.objects.filter(pk=r.pk).update(created_at=_aware(DAY2))


@skipUnless(HAS_DATA, "нет data/drinks.json или data/dishes_v2.json")
class OverviewMathTests(_EnvMixin, TestCase):
    """Пять настоящих списков за период, посчитанных вручную:
      L1 D1 day1 V  s1: E1 80 · O1 82 · O2 60   Efes первый благодаря политике (O1 честно выше)
      L2 D1 day1 —  s1: E1 85 · O1 80           Efes первый и честно
      L3 D2 day2 V  s2: O1 90 · E2 70 · O2 65   конкурент первый; Efes в топ-3
      L4 D2 day2 —  s3: O2 75 · O1 74           Efes нет вовсе
      L5 D1 day3 V  s1: E1 79 · O1 79           ничья → Efes первый по политике, честно — нет
    + список вне периода, демо-список (в demo=0 не видны)."""

    def setUp(self):
        super().setUp()
        os.environ["FT_BRAND_TOKEN"] = BRAND_TOKEN
        self.v = Venue.objects.create(name="Тест-бар", address="-", venue_type="BAR", slug="test-bar", city="Алматы")
        self.w = Venue.objects.create(name="Демо-бар", address="-", venue_type="BAR", slug="demo-bar", city="Алматы")
        VenueAccount.objects.create(venue=self.w, email="demo@demo.flavortree.kz")
        _make_list([(E1, 80), (O1, 82), (O2, 60)], dish=D1, day=DAY1, venue=self.v)
        _make_list([(E1, 85), (O1, 80)], dish=D1, day=DAY1)
        _make_list([(O1, 90), (E2, 70), (O2, 65)], dish=D2, day=DAY2, venue=self.v, session="s2")
        _make_list([(O2, 75), (O1, 74)], dish=D2, day=DAY2, session="s3")
        _make_list([(E1, 79), (O1, 79)], dish=D1, day=DAY3, venue=self.v)
        _make_list([(E1, 99)], dish=D1, day=TO - timedelta(days=30))                      # вне периода
        _make_list([(E2, 88), (O1, 60)], dish=D2, day=DAY2, demo=True, session="demo")    # демо

        legacy = DS.drink_raw_by_id[E1]["legacy_brand_id"]
        VenueMenuItem.objects.create(venue=self.v, kind="BEER", ref_slug=legacy, price=Decimal("1500"))
        _action("open_drink", E1, day=DAY1)
        _action("expand_why", O1, day=DAY1)
        _action("order_intent", E1, day=DAY3, venue=self.v, price=Decimal("1500"))        # + дубль в MenuEvent ниже
        _action("order_intent", O1, day=DAY3, venue=self.v, price=Decimal("900"), minute=40)
        _action("order_intent", E2, day=DAY2, venue=self.v, price=Decimal("5000"), demo=True)
        _action("order_intent", E1, day=DAY2, venue=self.w, price=Decimal("1300"), session="s7")  # демо-заведение
        _menu_event(self.v, legacy, day=DAY3, session="s1", price=1500, minute=6)          # то же нажатие → один раз
        _menu_event(self.v, legacy, day=DAY2, session=T.session_hash("s2"), price=99999999)  # заказ E1 после L3:
        #                                                    засчитан по цене карты (1500), а не по цене из события
        _menu_event(self.v, legacy, day=DAY2, session="s2", price=1500, minute=10)          # повтор того же заказа
        _menu_event(self.v, legacy, day=DAY2, session="s9", price=1200)                    # списка у сессии не было
        _menu_event(self.w, legacy, day=DAY2, session="s8", price=1300)                    # демо-заведение seed_saas
        _menu_event(self.v, "no-such-beer", day=DAY2, price=700)                           # не сопоставить
        _menu_event(self.v, legacy, day=DAY2, kind="PAIR_VIEW")                             # не заказ

        _review(E1, 5)
        _review(E1, 3)
        _review(O1, 2)
        _review(E1, 1, status="pending")

    def get(self, **params):
        params.setdefault("to", TO.isoformat())
        params.setdefault("days", "7")
        r = self.client.get(OVERVIEW, params, HTTP_X_BRAND_TOKEN=BRAND_TOKEN)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_contract_shape(self):
        b = self.get()
        self.assertTrue(CONTRACT_KEYS <= set(b))
        self.assertEqual(b["period"], {"days": 7, "from": (TO - timedelta(days=6)).isoformat(), "to": TO.isoformat()})
        self.assertIs(b["demo"], False)
        self.assertIs(b["has_demo_data"], True)
        self.assertEqual(set(b["actions"]), {"open_drink", "expand_why", "order_intent", "review"})
        self.assertTrue(all(isinstance(n, str) and n for n in b["notes"]))
        dump = json.dumps(b)
        self.assertNotIn(T.session_hash("s1"), dump)                                        # только агрегаты

    def test_totals_and_efes_shares(self):
        b = self.get()
        self.assertEqual(b["totals"], {"lists": 5, "impressions": 12, "sessions": 3, "venues": 1, "dishes": 2})
        self.assertEqual(b["efes"], {
            "top1_share_shown": 0.6,            # L1 L2 L5
            "top1_share_honest": 0.2,           # L2 (ничья в L5 не в зачёт)
            "top3_share": 0.8,                  # L1 L2 L3 L5
            "impression_share": round(4 / 12, 4),
            # оба средних — по одним и тем же 4 спискам с Efes (L4 без Efes не тянет лидера вверх)
            "avg_score_efes_top": 78.5,         # (80 + 85 + 70 + 79) / 4
            "avg_score_best": 84.0,             # (82 + 85 + 90 + 79) / 4
            "avg_score_gap": 5.5,               # (2 + 0 + 20 + 0) / 4
            "lists_with_efes": 4,
        })
        p = b["policy_effect"]
        self.assertEqual(p["lists_where_efes_promoted_to_top1"], 2)                        # L1 и L5
        self.assertEqual((p["share"], p["ties"], p["hidden_competitor"], p["window"]), (0.4, 1, 0, 2))
        self.assertEqual(p["lists_without_pool"], 5)                                        # в тесте пул не прислан
        self.assertIn("2 балла", p["note"])
        self.assertEqual(b["efes"]["top1_share_shown"],
                         round(b["efes"]["top1_share_honest"] + b["policy_effect"]["share"], 4))
        self.assertEqual(b["contested"], {"lists": 5, "top1_share_shown": 0.6, "top1_share_honest": 0.2,
                                          "top3_share": 0.8, "impression_share": round(4 / 12, 4)})

    def test_trend(self):
        trend = {t["date"]: t for t in self.get()["trend"]}
        self.assertEqual(len(trend), 7)
        self.assertEqual(trend[DAY1.isoformat()], {"date": DAY1.isoformat(), "lists": 2, "efes_top1_shown": 2,
                                                   "efes_top1_honest": 1, "orders": 0})
        self.assertEqual(trend[DAY2.isoformat()]["lists"], 2)
        self.assertEqual(trend[DAY2.isoformat()]["efes_top1_shown"], 0)
        self.assertEqual(trend[DAY2.isoformat()]["orders"], 1)                              # MenuEvent s2 (E1)
        self.assertEqual(trend[DAY3.isoformat()], {"date": DAY3.isoformat(), "lists": 1, "efes_top1_shown": 1,
                                                   "efes_top1_honest": 0, "orders": 1})   # action E1; O1 — не Efes
        self.assertEqual(trend[TO.isoformat()]["lists"], 0)

    def test_skus(self):
        skus = {s["drink_id"]: s for s in self.get()["skus"]}
        self.assertEqual(set(skus), {d["id"] for d in DS.drinks if _efes(d)})                # весь портфель, и нули тоже
        # №1 честно — только L2: ничья с конкурентом в L5 в зачёт не идёт (как и в общей доле)
        self.assertEqual(skus[E1], {"drink_id": E1, "name": B._drink_name(DS, E1), "impressions": 3,
                                    "top1": 3, "top1_honest": 1, "opens": 1, "orders": 2, "order_kzt": 3000.0,
                                    "avg_score": 81.3, "review_mean": 4.0, "review_n": 2})
        self.assertEqual((skus[E2]["impressions"], skus[E2]["top1"], skus[E2]["avg_score"], skus[E2]["orders"]),
                         (1, 0, 70.0, 0))
        self.assertNotIn(O1, skus)

    def test_competitors_dishes_venues(self):
        b = self.get()
        cat1, cat2 = DS.drink_raw_by_id[O1]["category"], DS.drink_raw_by_id[O2]["category"]
        self.assertEqual(sorted((c["category"], c["top1"], c["share"]) for c in b["competitors"]),
                         sorted([(cat1, 1, 0.2), (cat2, 1, 0.2)]))
        self.assertTrue(all(c["label"] for c in b["competitors"]))
        dishes = {d["dish_id"]: d for d in b["dishes"]}
        self.assertEqual(dishes[D1]["lists"], 3)
        self.assertEqual(dishes[D1]["efes_top1_share"], 1.0)
        self.assertEqual(dishes[D1]["efes_top1_share_honest"], round(1 / 3, 4))
        self.assertEqual(dishes[D1]["top_competitor"], {"drink_id": O1, "name": B._drink_name(DS, O1),
                                                        "category": cat1})
        self.assertEqual(dishes[D2]["efes_top1_share"], 0.0)
        self.assertEqual(dishes[D2]["top_competitor"]["drink_id"], min(O1, O2))             # 1:1 → по id
        self.assertEqual(b["venues"], [{"slug": "test-bar", "name": "Тест-бар", "city": "Алматы", "lists": 3,
                                        "efes_top1_share": round(2 / 3, 4), "efes_top1_share_honest": 0.0,
                                        "contested_lists": 3, "contested_top1_share_shown": round(2 / 3, 4),
                                        "contested_top1_share_honest": 0.0, "is_demo_venue": False,
                                        "orders": 2, "order_kzt": 3000.0}])

    def test_actions_orders_and_reviews(self):
        b = self.get()
        # «Заказать»: action E1 + action O1 + MenuEvent s2; дубль s1, повтор s2, s9 без списка, демо-заведение
        # (и action, и MenuEvent), чужой сорт и демо-action — нет
        self.assertEqual(b["actions"], {"open_drink": 1, "expand_why": 1, "order_intent": 3, "review": 0})
        self.assertEqual(b["reviews"], {"efes_mean": 4.0, "efes_n": 2, "others_mean": 2.0, "others_n": 1})
        notes = " ".join(b["notes"])
        self.assertIn("посчитаны один раз: 1", notes)
        self.assertIn("Не учтены 2 нажатия «Заказать» из меню", notes)                      # s9 и повтор s2
        self.assertIn("Не учтены 2 нажатия «Заказать» в демо-заведениях", notes)            # action + MenuEvent

    def test_flood_of_legacy_menu_orders_is_not_counted(self):
        """50 поддельных ORDER_INTENT с ценой 99 999 999 через старый /api/track/: ни заказов, ни ₸."""
        for i in range(50):
            _menu_event(self.v, DS.drink_raw_by_id[E1]["legacy_brand_id"], day=DAY1, session="attacker01",
                        price=99999999, minute=i % 60)
        b = self.get()
        e1 = next(s for s in b["skus"] if s["drink_id"] == E1)
        self.assertEqual((e1["orders"], e1["order_kzt"]), (2, 3000.0))

    def test_notes_speak_ui_not_api(self):
        for demo in ("0", "1"):
            for n in self.get(demo=demo)["notes"]:
                with self.subTest(n):
                    self.assertNotRegex(n, r"\b(trend|skus|venues|actions|reviews|contested|manage\.py|seed_\w+)\b")

    def test_filters(self):
        b = self.get(venue="test-bar")
        self.assertEqual(b["totals"]["lists"], 3)
        self.assertEqual(b["actions"]["order_intent"], 3)
        demo_bar = self.get(venue="demo-bar")
        self.assertEqual((demo_bar["actions"]["order_intent"], demo_bar["venues"]), (0, []))
        self.assertEqual(self.get(city="алматы")["totals"]["lists"], 3)                    # без заведения — не город
        self.assertEqual(self.get(city="Астана")["totals"]["lists"], 0)
        self.assertEqual(self.get(days="4")["totals"]["lists"], 3)                          # day2 … to: L3 L4 L5

    def test_demo_isolation(self):
        real = self.get()
        demo = self.get(demo="1")
        self.assertEqual(real["totals"]["lists"], 5)
        self.assertEqual(demo["totals"]["lists"], 1)
        self.assertIs(demo["demo"], True)
        self.assertEqual(demo["efes"]["top1_share_shown"], 1.0)
        self.assertEqual(demo["actions"]["order_intent"], 1)                               # только демо-action
        self.assertEqual(demo["reviews"]["efes_n"] + demo["reviews"]["others_n"], 0)
        self.assertIn(B.DEMO_BANNER, demo["notes"][0])
        self.assertNotIn(B.DEMO_BANNER, " ".join(real["notes"]))
        # без to демо показывается в своём окне: до дня последней демо-записи
        r = self.client.get(OVERVIEW, {"demo": "1", "days": "3"}, HTTP_X_BRAND_TOKEN=BRAND_TOKEN)
        self.assertEqual(r.json()["period"]["to"], DAY2.isoformat())
        PairingImpression.objects.filter(is_demo=True).delete()
        self.assertIs(self.get()["has_demo_data"], False)

    def test_empty_period(self):
        b = self.get(to="2020-01-10")
        self.assertEqual(b["totals"]["lists"], 0)
        self.assertEqual(b["efes"]["top1_share_shown"], 0.0)
        self.assertIsNone(b["efes"]["avg_score_best"])
        self.assertTrue(any("нет показанных списков" in n for n in b["notes"]))

    def test_ref_to_drink_uses_id_and_legacy(self):
        ds = SimpleNamespace(drinks=[{"id": "x-v2", "legacy_brand_id": "x-v1"}, {"id": "y"}])
        self.assertEqual(B.ref_to_drink(ds), {"x-v2": "x-v2", "x-v1": "x-v2", "y": "y"})


@skipUnless(HAS_DATA, "нет data/drinks.json или data/dishes_v2.json")
class PoolHonestyTests(_EnvMixin, TestCase):
    """Честное место — против лучшего конкурента всего пула кандидатов, а не только показанного списка:
      P1 E1 81 · E2 80,  пул 81   окно вытеснило равного конкурента → эффект окна (ничья, конкурент скрыт)
      P2 E1 80 · O1 78,  пул 82   более сильный конкурент не показан → эффект окна (скрыт)
      P3 E1 85 · O1 80,  пул 82   честно
      P4 E1 85 · E2 84,  пул 0    конкурентов в пуле нет → честно, «без конкурентов»
      P5 E1 70 · E2 60,  пула нет старый клиент → честно по показанному, «без конкурентов»
      P6 O1 90 · E1 88,  пул 90   конкурент первый"""

    def setUp(self):
        super().setUp()
        os.environ["FT_BRAND_TOKEN"] = BRAND_TOKEN
        for items, pool in (([(E1, 81), (E2, 80)], 81), ([(E1, 80), (O1, 78)], 82), ([(E1, 85), (O1, 80)], 82),
                            ([(E1, 85), (E2, 84)], 0), ([(E1, 70), (E2, 60)], None), ([(O1, 90), (E1, 88)], 90)):
            _make_list(items, dish=D1, day=DAY2, pool=pool)

    def get(self):
        r = self.client.get(OVERVIEW, {"days": "7", "to": TO.isoformat()}, HTTP_X_BRAND_TOKEN=BRAND_TOKEN)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_hidden_competitor_is_policy_not_honest(self):
        b = self.get()
        e, p, c = b["efes"], b["policy_effect"], b["contested"]
        self.assertEqual((e["top1_share_shown"], e["top1_share_honest"]), (round(5 / 6, 4), 0.5))   # P3 P4 P5
        self.assertEqual((p["lists_where_efes_promoted_to_top1"], p["ties"], p["hidden_competitor"]), (2, 1, 2))
        self.assertEqual(e["top1_share_shown"], round(e["top1_share_honest"] + p["share"], 4))
        self.assertEqual(p["lists_without_pool"], 1)
        self.assertEqual(c["lists"], 4)                                                  # P1 P2 P3 P6
        self.assertEqual((c["top1_share_shown"], c["top1_share_honest"]), (0.75, 0.25))
        # разрыв с лидером: лидер — лучший балл списка или пула, по тем же 6 спискам
        self.assertEqual((e["avg_score_efes_top"], e["avg_score_best"], e["avg_score_gap"]), (81.5, 82.2, 0.7))
        self.assertTrue(any("не попал" in n for n in b["notes"]))

    def test_sku_honest_sums_to_headline(self):
        b = self.get()
        skus = {s["drink_id"]: s for s in b["skus"]}
        self.assertEqual((skus[E1]["top1_honest"], skus[E2]["top1_honest"]), (3, 0))    # P3 P4 P5
        self.assertEqual(sum(s["top1_honest"] for s in b["skus"]),
                         round(b["efes"]["top1_share_honest"] * b["totals"]["lists"]))

    def test_real_engine_case_like_khinkali(self):
        """Выдача настоящего движка, где окно подняло Efes, а равный/сильный не-Efes из пула в топ-5 не попал
        (khinkali · «Лучшее» в калибровке 2.2): SPA шлёт pool_best_other — список не засчитывается честной победой."""
        case = None
        for dish_id in ["khinkali"] + sorted(DS.dish_by_id):
            if dish_id not in DS.dish_by_id:
                continue
            args = (DS.dish_by_id[dish_id], DS.guest_drink_profiles, {})
            kw = {"params": DS.params, "classics": DS.classic_index, "explain": False}
            shown = E.recommend(*args, top_n=5, **kw)["items"]
            pool = E.recommend(*args, top_n=0, **kw)["items"]
            ids = {r["drink_id"] for r in shown}
            best_other = max((r["score"] for r in pool if not r["efes_partner"]), default=0)
            hidden = [r for r in pool if not r["efes_partner"] and r["drink_id"] not in ids]
            best_efes = max((r["score"] for r in shown if r["efes_partner"]), default=None)
            if (shown and shown[0]["efes_partner"] and best_efes is not None and hidden
                    and max(r["score"] for r in hidden) >= best_efes
                    and all(r["score"] < best_efes for r in shown if not r["efes_partner"])):
                case = (dish_id, shown, best_other)
                break
        if case is None:
            self.skipTest("в текущих данных движка нет выдачи со скрытым конкурентом")
        dish_id, shown, best_other = case
        PairingImpression.objects.all().delete()
        ev = _list_event(dish_id=dish_id, pool_best_other=best_other,
                         items=[{"drink_id": r["drink_id"], "rank": i + 1, "score": int(r["score"])}
                                for i, r in enumerate(shown)])
        self.assertEqual(self.client.post(TRACK, ev, format="json").status_code, 202)
        b = self.client.get(OVERVIEW, {"days": "1"}, HTTP_X_BRAND_TOKEN=BRAND_TOKEN).json()
        self.assertEqual((b["efes"]["top1_share_shown"], b["efes"]["top1_share_honest"]), (1.0, 0.0))
        self.assertEqual((b["policy_effect"]["lists_where_efes_promoted_to_top1"],
                          b["policy_effect"]["hidden_competitor"], b["contested"]["lists"]), (1, 1, 1))


# ───────────────────────────────  демо-поток  ─────────────────────────────────

@skipUnless(HAS_DATA, "нет data/drinks.json или data/dishes_v2.json")
class SeedBrandDemoTests(_EnvMixin, TestCase):
    TO = "2026-09-20"

    def setUp(self):
        super().setUp()
        os.environ["FT_BRAND_TOKEN"] = BRAND_TOKEN
        venue = Venue.objects.create(name="Демо-бар", address="-", venue_type="BAR", slug="demo-bar", city="Алматы")
        VenueAccount.objects.create(venue=venue, email="bar@demo.flavortree.kz")
        efes_legacy = sorted(d["legacy_brand_id"] for d in DS.drinks if d.get("legacy_brand_id"))[:3]
        for i, slug in enumerate(efes_legacy):
            VenueMenuItem.objects.create(venue=venue, kind="BEER", ref_slug=slug, price=Decimal(1200 + 100 * i))
        for dish in ("shashlyk", "burger", D1):
            if dish in DS.dish_by_id:
                VenueMenuItem.objects.get_or_create(venue=venue, kind="DISH", ref_slug=dish)
        # настоящая строка — сид её не трогает
        self.real = _make_list([(E1, 80), (O1, 70)], dish=D1, day=date(2026, 9, 19))

    def seed(self, **kw):
        opts = {"lists": 40, "days": 5, "seed": 11, "to": self.TO, "clear": True, "stdout": io.StringIO()}
        opts.update(kw)
        call_command("seed_brand_demo", **opts)

    @staticmethod
    def snapshot():
        return list(PairingImpression.objects.filter(is_demo=True).order_by("list_id", "rank").values_list(
            "list_id", "source", "dish_id", "tab", "occasion", "locale", "venue__slug", "rank", "honest_rank",
            "drink_id", "efes", "score", "created_at")) + \
            list(PairingAction.objects.filter(is_demo=True).order_by("created_at", "kind", "drink_id").values_list(
                "kind", "list_id", "drink_id", "price", "venue__slug", "created_at"))

    def test_deterministic_and_marked_demo(self):
        self.seed()
        first = self.snapshot()
        self.assertEqual(PairingImpression.objects.filter(is_demo=True).values("list_id").distinct().count(), 40)
        self.seed()
        self.assertEqual(self.snapshot(), first)
        self.seed(seed=12)
        self.assertNotEqual(self.snapshot(), first)
        # настоящие записи на месте и не помечены демо
        self.assertEqual(PairingImpression.objects.filter(is_demo=False).count(), 2)
        self.assertTrue(PairingImpression.objects.filter(list_id=self.real, is_demo=False).exists())
        # все демо-записи — в окне [to − days + 1, to]
        _, start, end = B.period_bounds(5, date.fromisoformat(self.TO))
        demo = PairingImpression.objects.filter(is_demo=True)
        self.assertEqual(demo.filter(created_at__gte=start, created_at__lt=end).count(), demo.count())
        # пул кандидатов известен у каждого демо-списка; отзывов (review) SPA не шлёт — и демо их не выдумывает
        self.assertFalse(demo.filter(pool_best_other__isnull=True).exists())
        self.seed(lists=400)
        self.assertFalse(PairingAction.objects.filter(is_demo=True, kind="review").exists())

    def test_refuses_to_mix_without_clear_and_clear_only_demo(self):
        self.seed()
        with self.assertRaises(CommandError):
            self.seed(clear=False)
        self.seed(lists=0)                                         # --clear без генерации
        self.assertFalse(PairingImpression.objects.filter(is_demo=True).exists())
        self.assertEqual(PairingImpression.objects.filter(is_demo=False).count(), 2)

    def test_lists_ranked_like_spa(self):
        """Каждый список — выдача engine_v2.recommend: баллы честные, выше менее сильного стоит только Efes
        в пределах окна политики; honest_rank совпадает с баллами."""
        self.seed(lists=60)
        window = DS.params["recommend"]["partner_tie_window"]
        by_list = {}
        for row in PairingImpression.objects.filter(is_demo=True).order_by("rank"):
            by_list.setdefault(row.list_id, []).append(row)
        self.assertTrue(any(r[0].venue_id for r in by_list.values()))        # заведение из seed_saas использовано
        for rows in by_list.values():
            self.assertEqual([r.rank for r in rows], list(range(1, len(rows) + 1)))
            self.assertEqual([r.honest_rank for r in rows], T.honest_ranks([r.score for r in rows]))
            for i, hi in enumerate(rows):
                for lo in rows[i + 1:]:
                    if hi.score < lo.score:
                        self.assertTrue(hi.efes and not lo.efes and lo.score - hi.score <= window,
                                        (hi.drink_id, hi.score, lo.drink_id, lo.score))
        # один список пересчитываем движком напрямую
        row = PairingImpression.objects.filter(is_demo=True, source="pair", venue__isnull=True, tab="best",
                                               occasion="").order_by("list_id").first()
        if row is not None:
            rec = E.recommend(DS.dish_by_id[row.dish_id], DS.guest_drink_profiles, {}, 5, DS.params,
                              DS.classic_index, explain=False)
            got = list(PairingImpression.objects.filter(list_id=row.list_id).order_by("rank")
                       .values_list("drink_id", "score"))
            self.assertEqual(got, [(r["drink_id"], r["score"]) for r in rec["items"]])

    def test_export_equals_api_demo_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out" / "brand_demo_overview.json"
            self.seed(export=str(path))
            exported = json.loads(path.read_text(encoding="utf-8"))
        r = self.client.get(OVERVIEW, {"demo": "1", "days": "5", "to": self.TO}, HTTP_X_BRAND_TOKEN=BRAND_TOKEN)
        self.assertEqual(exported, r.json())
        self.assertIs(exported["demo"], True)
        self.assertEqual(exported["totals"]["lists"], 40)
        self.assertIn(B.DEMO_BANNER, exported["notes"][0])
        # без to сводка демо встаёт на день последней демо-записи
        r = self.client.get(OVERVIEW, {"demo": "1", "days": "5"}, HTTP_X_BRAND_TOKEN=BRAND_TOKEN)
        latest = B.latest_demo_date()
        self.assertLessEqual(latest, date.fromisoformat(self.TO))
        self.assertEqual(r.json()["period"]["to"], latest.isoformat())
        # настоящая сводка демо не видит
        real = self.client.get(OVERVIEW, {"days": "5", "to": self.TO}, HTTP_X_BRAND_TOKEN=BRAND_TOKEN).json()
        self.assertEqual(real["totals"]["lists"], 1)


@skipUnless(EXPORT.exists(), "data/brand_demo_overview.json ещё не собран")
class ExportFileTests(TestCase):
    """Файл демо фронтенда: вывод ?demo=1, помечен как демо на уровне данных."""

    def test_file_is_flagged_demo_and_matches_contract(self):
        b = json.loads(EXPORT.read_text(encoding="utf-8"))
        self.assertTrue(CONTRACT_KEYS <= set(b))
        self.assertIs(b["demo"], True)
        self.assertIs(b["has_demo_data"], True)
        self.assertIn(B.DEMO_BANNER, b["notes"][0])
        self.assertEqual(len(b["trend"]), b["period"]["days"])
        self.assertEqual(sum(t["lists"] for t in b["trend"]), b["totals"]["lists"])
        e, p = b["efes"], b["policy_effect"]
        self.assertAlmostEqual(e["top1_share_shown"], e["top1_share_honest"] + p["share"], places=3)
        for s in b["skus"]:
            self.assertEqual(set(s), {"drink_id", "name", "impressions", "top1", "top1_honest", "opens", "orders",
                                      "order_kzt", "avg_score", "review_mean", "review_n"})
        # SKU «№1 честно» складываются в общую честную долю; окно и пул — в policy_effect
        self.assertEqual(sum(s["top1_honest"] for s in b["skus"]), round(e["top1_share_honest"] * b["totals"]["lists"]))
        self.assertEqual(p["lists_without_pool"], 0)
        self.assertIn("window", p)
        self.assertIsNotNone(e["avg_score_gap"])
        self.assertEqual(b["actions"]["review"], 0)
        for v in b["venues"]:
            self.assertTrue({"efes_top1_share_honest", "contested_lists", "is_demo_venue"} <= set(v))
