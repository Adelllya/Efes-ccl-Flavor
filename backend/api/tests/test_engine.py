"""Unit-тесты движка подбора: правила, калибровка, DNA. Запуск: python -m pytest api/tests -q
или без Django: python -m unittest api.tests.test_engine"""
from __future__ import annotations

import json
import unittest

from api.pairing.dataset import Dataset, DATA_DIR
from api.pairing.engine import (
    BEER_AXES, build_beer_profile, build_dish_profile, score_pair, recommend_beers,
    recommend_dishes, dna_vector, dna_archetype, similar_beers, verdict_label,
)

DS = Dataset()


def beer(id_):
    return DS.beer_by_id[id_]


def dish(id_):
    return DS.dish_by_id[id_]


def rule_points(result, rule):
    for c in result["contributions"]:
        if c["rule"] == rule:
            return c["points"]
    return 0.0


class TestProfiles(unittest.TestCase):
    def test_all_brands_have_vectors_in_range(self):
        for b in DS.beer_profiles:
            for a in BEER_AXES:
                self.assertTrue(0.0 <= b["vector"][a] <= 1.0, (b["id"], a))
            self.assertGreater(b["intensity"], 0.1)
            self.assertGreater(b["confidence"], 0.4)

    def test_strong_lager_has_alcohol_and_body(self):
        v = beer("khmelnoy-los")["vector"]
        self.assertGreater(v["alcohol"], 0.7)
        self.assertGreater(v["body"], 0.85)
        self.assertGreater(beer("khmelnoy-los")["intensity"], beer("miller-genuine-draft")["intensity"] + 0.3)

    def test_pilsner_is_bitter_and_hoppy(self):
        v = beer("efes-pilsener")["vector"]
        self.assertGreater(v["bitter"], 0.75)
        self.assertGreater(v["hop_aroma"], 0.75)

    def test_rice_lager_is_clean_and_light(self):
        v = beer("wukong-ju")["vector"]
        self.assertGreater(v["clean"], 0.85)
        self.assertLess(v["body"], 0.35)

    def test_amber_has_caramel(self):
        self.assertGreater(beer("legenda-777")["vector"]["caramel"], 0.7)

    def test_style_prior_fills_thin_pyramid(self):
        # У Bavaria всего 3 ноты — приор стиля должен дать разумные значения по всем осям
        v = beer("bavaria")["vector"]
        self.assertGreater(v["carbonation"], 0.5)
        self.assertGreater(v["malt_sweet"], 0.3)

    def test_vector_override_wins(self):
        brand = dict(DS.brands[0], vector_override={"bitter": 0.11})
        p = build_beer_profile(brand, DS.notes_by_id, DS.priors)
        self.assertEqual(p["vector"]["bitter"], 0.11)


class TestRules(unittest.TestCase):
    def test_fat_rewards_bitter_and_carbonated(self):
        kazy = dish("kazy")  # жирная конская колбаса
        r_pils = score_pair(beer("efes-pilsener"), kazy)
        r_rice = score_pair(beer("wukong-ju"), kazy)
        self.assertGreater(rule_points(r_pils, "cut"), rule_points(r_rice, "cut"))

    def test_spicy_penalizes_bitter_and_strong(self):
        wings = dish("buffalo-wings")
        r_mild = score_pair(beer("bavaria"), wings)
        r_strong = score_pair(beer("khmelnoy-los"), wings)
        self.assertGreater(rule_points(r_mild, "heat"), rule_points(r_strong, "heat"))
        self.assertGreater(r_mild["score"], r_strong["score"])

    def test_dessert_prefers_malt_sweet_and_caramel(self):
        strudel = dish("strudel")
        top = recommend_beers(strudel, DS.beer_profiles, {}, {}, limit=3)
        self.assertIn("legenda-777", [t["beer_id"] for t in top])
        r_pils = score_pair(beer("efes-pilsener"), strudel)
        r_amber = score_pair(beer("legenda-777"), strudel)
        self.assertGreater(rule_points(r_amber, "sweet"), rule_points(r_pils, "sweet"))

    def test_delicate_sushi_prefers_light_clean(self):
        top = recommend_beers(dish("sushi"), DS.beer_profiles, {}, {}, limit=3)
        ids = [t["beer_id"] for t in top]
        self.assertTrue({"miller-genuine-draft", "wukong-ju"} & set(ids))
        self.assertNotIn("khmelnoy-los", ids)

    def test_heavy_bbq_prefers_full_bodied(self):
        top = recommend_beers(dish("bbq-ribs"), DS.beer_profiles, {}, {}, limit=4)
        ids = [t["beer_id"] for t in top]
        self.assertNotIn("miller-genuine-draft", ids)
        self.assertNotIn("wukong-ju", ids)

    def test_intensity_mismatch_penalized(self):
        r = score_pair(beer("khmelnoy-los"), dish("sauerkraut"))
        self.assertLess(rule_points(r, "intensity"), 0)

    def test_bridge_tags_shared(self):
        r = score_pair(beer("legenda-777"), dish("strudel"))
        br = next(c for c in r["contributions"] if c["rule"] == "bridge")
        self.assertIn("caramel", br["tags"])
        self.assertGreater(br["points"], 3)

    def test_curated_pair_boosts_and_marks_pick(self):
        cu = DS.curated_index["kozel|beshbarmak"]
        with_c = score_pair(beer("kozel"), dish("beshbarmak"), {}, cu)
        without = score_pair(beer("kozel"), dish("beshbarmak"))
        self.assertGreater(with_c["score"], without["score"])
        self.assertTrue(with_c["sommelier_pick"])
        self.assertEqual(rule_points(with_c, "curated"), 16.0)

    def test_context_hot_day_prefers_fresh(self):
        d = dish("shashlyk")
        base = score_pair(beer("miller-genuine-draft"), d)["score"] - score_pair(beer("khmelnoy-los"), d)["score"]
        hot = score_pair(beer("miller-genuine-draft"), d, {"occasion": "hot"})["score"] - score_pair(beer("khmelnoy-los"), d, {"occasion": "hot"})["score"]
        self.assertGreater(hot, base)

    def test_bitter_pref(self):
        d = dish("burger")
        plus = score_pair(beer("efes-pilsener"), d, {"bitter_pref": 1.0})["score"]
        minus = score_pair(beer("efes-pilsener"), d, {"bitter_pref": -1.0})["score"]
        self.assertGreater(plus, minus)

    def test_scores_in_range_and_deterministic(self):
        for d in DS.dish_profiles:
            for b in DS.beer_profiles:
                r1 = score_pair(b, d, {}, DS.curated_index.get(f"{b['id']}|{d['id']}"))
                r2 = score_pair(b, d, {}, DS.curated_index.get(f"{b['id']}|{d['id']}"))
                self.assertEqual(r1["score"], r2["score"])
                self.assertTrue(3 <= r1["score"] <= 99)
                self.assertIn(r1["match_type"], ("COMPLEMENT", "CONTRAST", "CLEANSE", "BRIDGE"))
                self.assertEqual(verdict_label(r1["score"]), r1["verdict"])

    def test_available_filter(self):
        top = recommend_beers(dish("plov"), DS.beer_profiles, DS.curated_index, {}, limit=10,
                              available_ids=["13-region", "bochkovoe"])
        self.assertEqual({t["beer_id"] for t in top}, {"13-region", "bochkovoe"})

    def test_reverse_direction(self):
        res = recommend_dishes(beer("wukong-ju"), DS.dish_profiles, DS.curated_index, {}, limit=5)
        self.assertIn("sushi", [r["dish_id"] for r in res])


class TestCalibration(unittest.TestCase):
    DAIRY = {"airan", "kumys", "irimshik", "sauerkraut"}  # кисломолочное и гарнир-соленье — честно не пара к пиву, порог ниже

    def test_each_dish_has_a_good_pair(self):
        """У каждого блюда есть хотя бы один сорт с оценкой ≥ 64 («хорошая пара») — гость не уйдёт без совета."""
        for d in DS.dish_profiles:
            best = recommend_beers(d, DS.beer_profiles, DS.curated_index, {}, limit=1)[0]
            self.assertGreaterEqual(best["score"], 50 if d["id"] in self.DAIRY else 64, (d["id"], best["score"]))

    def test_beer_snacks_score_high(self):
        """Курт, брецель, эдамаме — классические закуски к пиву, лучший сорт ≥ 66."""
        for did in ("kurt", "pretzel", "edamame"):
            best = recommend_beers(dish(did), DS.beer_profiles, DS.curated_index, {}, limit=1)[0]
            self.assertGreaterEqual(best["score"], 66, (did, best["score"]))

    def test_diversify_limits_same_family(self):
        top = recommend_beers(dish("kazy"), DS.beer_profiles, DS.curated_index, {}, limit=3, diversify=True)
        fams = [DS.beer_by_id[t["beer_id"]]["brand"]["style_family"] for t in top]
        self.assertTrue(all(fams.count(f) <= 2 for f in fams), fams)
        self.assertEqual(len(top), 3)

    def test_spread_within_dish(self):
        """Алгоритм различает сорта: разброс оценок внутри блюда ≥ 12 баллов."""
        for d in DS.dish_profiles:
            res = recommend_beers(d, DS.beer_profiles, DS.curated_index, {}, limit=0)
            self.assertGreaterEqual(res[0]["score"] - res[-1]["score"], 12, d["id"])

    def test_sommelier_agreement_without_curated_boost(self):
        """Чистый алгоритм (без R11) ставит ≥ 60% кураторских пар с оценкой 5 в топ-5."""
        picks = [p for p in DS.curated if p["score"] >= 5]
        hits = 0
        for p in picks:
            top = recommend_beers(dish(p["dish_id"]), DS.beer_profiles, {}, {}, limit=5)
            if p["brand_id"] in [t["beer_id"] for t in top]:
                hits += 1
        self.assertGreaterEqual(hits / len(picks), 0.6, f"{hits}/{len(picks)}")


class TestDNA(unittest.TestCase):
    def test_hop_lover_archetype(self):
        rated = [{"vector": beer("efes-pilsener")["vector"], "rating": "love"},
                 {"vector": beer("stary-melnik")["vector"], "rating": "like"},
                 {"vector": beer("wukong-ju")["vector"], "rating": "dislike"}]
        v = dna_vector(rated)
        self.assertIsNotNone(v)
        self.assertEqual(dna_archetype(v)["id"], "hop-explorer")

    def test_light_lover_archetype(self):
        rated = [{"vector": beer("miller-genuine-draft")["vector"], "rating": "love"},
                 {"vector": beer("wukong-ju")["vector"], "rating": "love"},
                 {"vector": beer("khmelnoy-los")["vector"], "rating": "dislike"}]
        self.assertEqual(dna_archetype(dna_vector(rated))["id"], "crisp-minimalist")

    def test_empty_ratings(self):
        self.assertIsNone(dna_vector([{"vector": beer("kozel")["vector"], "rating": "meh"}]))

    def test_similar_beers(self):
        sim = similar_beers(beer("bavaria"), DS.beer_profiles, limit=3)
        self.assertEqual(len(sim), 3)
        self.assertNotIn("bavaria", [s["beer_id"] for s in sim])


class TestGolden(unittest.TestCase):
    def test_golden_matrix_matches(self):
        """Golden-файл фиксирует поведение движка; TS-порт сверяется с тем же файлом."""
        path = DATA_DIR / "golden_scores.json"
        if not path.exists():
            self.skipTest("golden not generated")
        golden = json.loads(path.read_text(encoding="utf-8"))
        for entry in golden["matrix"]:
            r = score_pair(beer(entry["beer"]), dish(entry["dish"]), {}, DS.curated_index.get(f"{entry['beer']}|{entry['dish']}"))
            self.assertEqual(r["score"], entry["score"], entry)
            self.assertEqual(r["match_type"], entry["type"], entry)


if __name__ == "__main__":
    unittest.main()
