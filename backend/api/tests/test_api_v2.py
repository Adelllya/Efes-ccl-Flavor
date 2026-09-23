"""API движка v2 (api/views_engine_v2.py): каталог, подбор, вкладки, объяснение, политика Efes.

Запуск: python manage.py test api.tests.test_api_v2
Работает на data/*.json. Если каталога напитков (data/drinks.json) нет — тесты подбора пропускаются.
"""
from __future__ import annotations

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Venue, VenueMenuItem
from api.pairing import engine_v2 as E
from api.pairing.dataset_v2 import get_dataset


class ApiV2Base(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ds = get_dataset()
        cls.window = cls.ds.params["recommend"]["partner_tie_window"]

    def setUp(self):
        self.c = APIClient()
        if not self.ds.drinks:
            self.skipTest("data/drinks.json нет")

    def get(self, url, **params):
        r = self.c.get(url, params)
        self.assertEqual(r.status_code, 200, (url, r.content[:300]))
        return r.json()


class TestMetaAndCatalog(ApiV2Base):
    def test_meta(self):
        j = self.get("/api/v2/meta/")
        self.assertEqual(j["engine"], E.ENGINE_VERSION)
        self.assertEqual(j["drinks"], len(self.ds.drinks))
        self.assertGreater(j["drinks"] - j["drinks_efes"], 0)
        self.assertIn(E.fmt_num(self.window), j["policy"]["note"])
        self.assertTrue(all(c["n"] > 0 for c in j["categories"]))

    def test_drinks_filter_and_search(self):
        j = self.get("/api/v2/drinks/", category="cider", limit=500)
        self.assertTrue(j["results"])
        self.assertTrue(all(d["category"] == "cider" for d in j["results"]))
        j = self.get("/api/v2/drinks/", efes=1, limit=500)
        self.assertTrue(all(E.is_efes_relation(d["efes_relation"], self.ds.params) for d in j["results"]))
        name = self.ds.drinks[0]["name"]
        j = self.get("/api/v2/drinks/", q=name[:5])
        self.assertIn(self.ds.drinks[0]["id"], [d["id"] for d in j["results"]] or [self.ds.drinks[0]["id"]])

    def test_drink_detail_and_404(self):
        d = self.ds.drinks[0]
        j = self.get(f"/api/v2/drinks/{d['id']}/")
        self.assertEqual(j["drink"]["id"], d["id"])
        self.assertTrue(j["best_dishes"])
        scores = [x["score"] for x in j["best_dishes"]]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertEqual(self.c.get("/api/v2/drinks/no-such-drink/").status_code, 404)


class TestPairing(ApiV2Base):
    DISHES = ("beshbarmak", "kazy", "plov", "lagman-spicy", "sushi", "chak-chak", "steak", "shashlyk")

    def dishes(self):
        return [d for d in self.DISHES if d in self.ds.dish_by_id]

    def test_scores_are_honest_and_order_respects_window(self):
        """Порядок: выше может оказаться только Efes и только если отстаёт не больше чем на window."""
        for dish in self.dishes():
            j = self.get(f"/api/v2/pairing/dish/{dish}/", top=0)
            items = j["items"]
            for i, a in enumerate(items):
                for b in items[i + 1:]:
                    if a["score"] < b["score"]:
                        self.assertTrue(a["efes_partner"] and not b["efes_partner"], (dish, a["drink_id"], b["drink_id"]))
                        self.assertLessEqual(b["score"] - a["score"], self.window, (dish, a["drink_id"], b["drink_id"]))
            # балл в выдаче = балл полного разбора той же пары (никаких надбавок за бренд)
            for it in items[:3]:
                ex = self.get("/api/v2/pairing/explain/", drink=it["drink_id"], dish=dish)
                self.assertEqual(ex["score"], it["score"], (dish, it["drink_id"]))

    def test_best_partner_is_top_efes(self):
        for dish in self.dishes():
            j = self.get(f"/api/v2/pairing/dish/{dish}/")
            bp = j["best_partner"]
            efes_scores = []
            for c in j["categories"]:
                for x in c["items"]:
                    if x["efes_partner"]:
                        efes_scores.append(x["score"])
            if bp:
                self.assertTrue(bp["efes_partner"])
                self.assertGreaterEqual(bp["score"], max(efes_scores) if efes_scores else 0)

    def test_tabs_one_per_category(self):
        j = self.get("/api/v2/pairing/dish/beshbarmak/")
        cats = [c["category"] for c in j["categories"]]
        self.assertEqual(len(cats), len(set(cats)))
        for c in j["categories"]:
            self.assertTrue(all(x["category"] == c["category"] for x in c["items"]))
            self.assertEqual(c["best"]["drink_id"], c["items"][0]["drink_id"])

    def test_non_alcoholic_filter(self):
        j = self.get("/api/v2/pairing/dish/beshbarmak/", occasion="non_alcoholic", top=0)
        limit = self.ds.params["vetoes"]["V7"]["max_abv"]
        self.assertTrue(j["items"])
        self.assertTrue(all(x["abv"] <= limit for x in j["items"]))

    def test_categories_filter(self):
        j = self.get("/api/v2/pairing/dish/plov/", categories="wine,tea", top=10)
        self.assertTrue(all(x["category"] in ("wine", "tea") for x in j["items"]))

    def test_custom_dish_and_bad_body(self):
        r = self.c.post("/api/v2/pairing/recommend/",
                        {"dish": {"name": "Острые крылья", "vector": {"heat": 0.8, "fat": 0.7, "salt": 0.6, "weight": 0.5}},
                         "context": {"harsh_tol": "sensitive"}}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["items"])
        self.assertEqual(self.c.post("/api/v2/pairing/recommend/", ["x"], format="json").status_code, 400)
        self.assertEqual(self.c.post("/api/v2/pairing/recommend/", {}, format="json").status_code, 400)
        self.assertEqual(self.c.get("/api/v2/pairing/dish/no-such-dish/").status_code, 404)

    def test_venue_filter(self):
        venue = Venue.objects.create(name="Тестовый бар", address="—", venue_type="BAR", slug="test-bar-v2")
        legacy = [d for d in self.ds.drinks if d.get("legacy_brand_id")][:2]
        plain = [d for d in self.ds.drinks if not d.get("legacy_brand_id")][:1]
        for d in legacy:     # позиция карты по старому slug сорта
            VenueMenuItem.objects.create(venue=venue, kind="BEER", ref_slug=d["legacy_brand_id"], price=1000)
        for d in plain:      # и по id напитка v2
            VenueMenuItem.objects.create(venue=venue, kind="BEER", ref_slug=d["id"], price=1500)
        allowed = {d["id"] for d in legacy + plain}
        j = self.get("/api/v2/pairing/dish/beshbarmak/", venue="test-bar-v2", top=0)
        self.assertTrue(j["items"])
        self.assertTrue({x["drink_id"] for x in j["items"]} <= allowed)


class TestLocales(ApiV2Base):
    """?locale=kk|en меняет только слова: напитки, порядок, баллы, вето — те же, что на русском."""

    def test_scores_identical_texts_translated(self):
        for dish in ("beshbarmak", "lagman-spicy", "chak-chak", "sushi"):
            if dish not in self.ds.dish_by_id:
                continue
            ru = self.get(f"/api/v2/pairing/dish/{dish}/", top=0)
            for loc in ("kk", "en"):
                other = self.get(f"/api/v2/pairing/dish/{dish}/", top=0, locale=loc)
                self.assertEqual([(x["drink_id"], x["score"], x["vetoes"]) for x in ru["items"]],
                                 [(x["drink_id"], x["score"], x["vetoes"]) for x in other["items"]], (dish, loc))
                texts_ru = [m["text"] for x in ru["items"][:5] for m in x["reasons"]]
                texts_loc = [m["text"] for x in other["items"][:5] for m in x["reasons"]]
                self.assertNotEqual(texts_ru, texts_loc, (dish, loc))

    def test_unknown_locale_falls_back_to_russian(self):
        ru = self.get("/api/v2/pairing/dish/plov/")
        xx = self.get("/api/v2/pairing/dish/plov/", locale="de")
        self.assertEqual(ru["items"][0]["reasons"], xx["items"][0]["reasons"])
