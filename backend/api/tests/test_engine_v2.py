"""Unit-тесты движка подбора v2 (Django не нужен).

Запуск: cd backend && .venv/bin/python -m unittest api.tests.test_engine_v2
(также подхватывается `manage.py test api.tests`).

Основной набор данных — прототип docs/research/engine_v2_prototype.py в формате контракта (dataset_v2.prototype_dataset):
он стабилен и не зависит от файлов других потоков. Тесты файлов data/*.json пропускаются, если файла нет.
"""
from __future__ import annotations

import io
import json
import tokenize
import unittest
from pathlib import Path

from api.pairing import engine_v2 as E
from api.pairing.dataset_v2 import load_dataset, load_prototype_module, prototype_dataset

P = E.default_params()
PDS = prototype_dataset()
MOD = load_prototype_module()
REPO = Path(__file__).resolve().parents[3]
GOLDEN = REPO / "data" / "golden_v2.json"

# Намеренные отличия от прототипа (score v2 при данных и параметрах прототипа), см. docstring engine_v2.py.
DOCUMENTED_DEVIATIONS = {
    # R16 ограничен clamp(−12, +10) по спецификации §4.2; прототип даёт meal = −14 без ограничения → 39.
    ("beshbarmak", "old_fashioned"): 41,
}
# Пары матрицы, где v2 отличается от прототипа на 1 из-за округления (half-up вместо банковского round):
ROUNDING_CELLS = {("chocolate-fondant", "gin_tonic"),   # raw = 40.5 ровно: round() → 40, floor(x+0.5) → 41
                  ("chocolate-fondant", "soda_water")}  # R2 = 2.835: round(·,2) → 2.83, r2 → 2.84


def need_proto(test):
    return unittest.skipIf(PDS is None, "engine_v2_prototype.py не найден")(test)


def points(result, rule):
    return E.fsum(c["points"] for c in result["components"] if c["rule"] == rule)


def has_rule(result, rule):
    return any(c["rule"] == rule for c in result["components"])


def mk_drink(id="x", category="beer", abv=5.0, ibu=None, tags=None, origin=None, efes="none", family=None, **axes):
    sens = {a: 0.0 for a in E.DRINK_AXES}
    sens.update(body=0.4, aroma_intensity=0.4, serve_temp=6)
    sens.update(axes)
    return {"id": id, "name": id, "category": category, "abv": abv, "ibu": ibu, "sensory": sens,
            "aroma_tags": tags or {}, "origin_affinity": origin or [], "efes_relation": efes,
            "style": {"archetype": id, "family": family or category.upper()}}


def mk_dish(id="d", tags=None, cuisine=None, dessert=False, acid_type="none", **axes):
    vec = {a: 0.0 for a in E.DISH_AXES}
    vec["weight"] = 0.5
    vec.update(axes)
    return {"id": id, "name": id, "vector": vec, "tags": tags or {}, "cuisine": cuisine or [], "is_dessert": dessert,
            "acid_type": acid_type}


def score(bid, did, ctx=None, classics=True, params=None):
    return E.score_pair(PDS.archetype_by_id[bid], PDS.dish_by_id[did], ctx or {}, params or P,
                        PDS.classic_index if classics else None)


def eval_pairs(ds, classics):
    """Критерии §7 (как scripts/engine_eval_v2.py): ранг внутри категории среди архетипов (соревновательный)."""
    passed, fails = 0, []
    for t in ds.tests["pairs"]:
        ctx = dict(t.get("ctx") or {})
        b, d = ds.archetype_by_id[t["drink"]], ds.dish_by_id[t["dish"]]
        s = E.score_pair(b, d, ctx, ds.params, classics, explain=False)
        peers = [x for x in ds.archetype_profiles if x["category"] == b["category"]]
        rank = 1 + sum(1 for x in peers if x["id"] != b["id"]
                       and E.score_pair(x, d, ctx, ds.params, classics, explain=False)["score"] > s["score"])
        vetoed = any(v in E.CAP_VETOES for v in s["vetoes"])
        sc = s["score"]
        ok = {"top3": rank <= 3 and sc >= 70, "good": sc >= 60 and not vetoed,
              "bad": sc <= 57 and (rank > 3 or len(peers) <= 3), "avoid": sc <= 35 and vetoed}[t["expect"]]
        passed += ok
        if not ok:
            fails.append((t["id"], t["dish"], t["drink"], sc, rank))
    o_ok = 0
    for o in ds.tests["ordinals"]:
        sa = E.score_pair(ds.archetype_by_id[o["a"]], ds.dish_by_id[o["dish"]], o["ctx"], ds.params, classics)["score"]
        sb = E.score_pair(ds.archetype_by_id[o["b"]], ds.dish_by_id[o["dish"]], o["ctx"], ds.params, classics)["score"]
        o_ok += (sa - sb) >= o["min_gap"]
    return passed, fails, o_ok


# ─────────────────────────────────────────────────────────────────────────────
class TestParityHelpers(unittest.TestCase):
    """Численные помощники совпадают с JS (значения сверены с node)."""

    def test_r2_is_floor_half_up_on_binary_value(self):
        self.assertEqual(E.r2(0.125), 0.13)
        self.assertEqual(E.r2(2.675), 2.68)
        self.assertEqual(E.r2(-1.005), -1.0)
        self.assertEqual(E.r2(-0.004), 0.0)
        self.assertEqual(E.r2(-0.006), -0.01)

    def test_round_half_up_matches_floor_x_plus_half(self):
        self.assertEqual(E.round_half_up(40.5), 41)      # Python round(40.5) = 40
        self.assertEqual(E.round_half_up(-0.5), 0)
        self.assertEqual(E.round_half_up(0.49999999999999994), 1)  # как Math.floor(x + 0.5), не Math.round

    def test_fsum_is_naive(self):
        self.assertEqual(E.fsum([0.1] * 10), 0.9999999999999999)  # sum() в 3.12+ даёт 1.0

    def test_formatting(self):
        self.assertEqual(E.fmt_num(5.0), "5")
        self.assertEqual(E.fmt_num(4.4), "4.4")
        self.assertEqual(E.fmt_num(8.45), "8.5")
        self.assertEqual(E.fmt2(0.125), "0.13")   # "%.2f" % 0.125 == "0.12" — поэтому только через r2
        self.assertEqual(E.fmt2(0.3), "0.30")
        self.assertEqual(E.tpl("{a}-{b}-{c}", {"a": 1, "b": "x"}), "1-x-{c}")

    def test_engine_source_has_no_python_only_numerics(self):
        src = (Path(E.__file__)).read_text(encoding="utf-8")
        toks = list(tokenize.generate_tokens(io.StringIO(src).readline))
        bad = []
        for i, t in enumerate(toks[:-1]):
            if t.type == tokenize.NAME and t.string in ("round", "sum") and toks[i + 1].string == "(":
                if i == 0 or toks[i - 1].string not in (".", "def"):
                    bad.append((t.start[0], t.string))
            if t.type == tokenize.NAME and t.string == "fsum" and i > 1 and toks[i - 1].string == "." and toks[i - 2].string == "math":
                bad.append((t.start[0], "math.fsum"))
        self.assertEqual(bad, [], "в engine_v2.py запрещены round()/sum()/math.fsum — используйте r2/round_half_up/fsum")

    def test_burn_breakpoints(self):
        self.assertEqual(E.burn(6.9), 0.0)
        self.assertEqual(E.burn(7), 0.0)
        self.assertAlmostEqual(E.burn(12), 0.3)
        self.assertAlmostEqual(E.burn(22), 0.6)
        self.assertEqual(E.burn(40), 1.0)
        self.assertEqual(E.burn(58), 1.0)
        if MOD is not None:
            for abv in (0, 5, 7, 8.4, 9.5, 12, 13.5, 17, 20, 22, 24, 30, 40, 46, 58):
                self.assertEqual(E.burn(abv), MOD.burn(abv), abv)


# ─────────────────────────────────────────────────────────────────────────────
@need_proto
class TestReproducesPrototype(unittest.TestCase):
    def test_68_pairs_within_one_point(self):
        for dish_id, drink_id, _exp in MOD.TESTS:
            ctx = {"occasion": "meal"} if drink_id == "old_fashioned" else {}
            proto = MOD.score_pair(MOD.DRINK_BY_ID[drink_id], MOD.DISH_BY_ID[dish_id], ctx, True)["score"]
            v2 = score(drink_id, dish_id, ctx)["score"]
            if (dish_id, drink_id) in DOCUMENTED_DEVIATIONS:
                self.assertEqual(v2, DOCUMENTED_DEVIATIONS[(dish_id, drink_id)], (dish_id, drink_id, proto))
            else:
                self.assertLessEqual(abs(v2 - proto), 1, (dish_id, drink_id, proto, v2))

    def test_full_matrix_components_and_vetoes_match(self):
        diffs = set()
        for d in MOD.DISHES:
            for b in MOD.DRINKS:
                for use_c in (True, False):
                    p = MOD.score_pair(b, d, {}, use_c)
                    r = score(b["id"], d["id"], classics=use_c)
                    self.assertEqual([c[0] for c in p["contribs"]], [c["rule"] for c in r["components"]], (d["id"], b["id"]))
                    for pc, rc in zip(p["contribs"], r["components"]):
                        self.assertLessEqual(abs(pc[1] - rc["points"]), 0.0100001, (d["id"], b["id"], pc, rc))
                    self.assertEqual(sorted(v.split("_")[0] for v in p["vetoes"]), sorted(r["vetoes"]))
                    self.assertLessEqual(abs(p["score"] - r["score"]), 1)
                    if p["score"] != r["score"]:
                        diffs.add((d["id"], b["id"]))
        self.assertTrue(diffs <= ROUNDING_CELLS, diffs - ROUNDING_CELLS)

    def test_pass_criteria_65_of_68_and_12_ordinals(self):
        passed, fails, o_ok = eval_pairs(PDS, PDS.classic_index)
        self.assertGreaterEqual(passed, 65, fails)
        self.assertEqual(o_ok, 12)
        passed_nc, fails_nc, o_ok_nc = eval_pairs(PDS, None)
        self.assertGreaterEqual(passed_nc, 65, fails_nc)   # спецификация: 65/68 без R20
        self.assertEqual(o_ok_nc, 12)

    def test_known_borderline_fails_are_the_spec_ones(self):
        _, fails, _ = eval_pairs(PDS, PDS.classic_index)
        self.assertLessEqual({(f[1], f[2]) for f in fails}, {("oysters-raw", "dry_stout"), ("cheese-aged", "peated_whisky")})


# ─────────────────────────────────────────────────────────────────────────────
@need_proto
class TestDeterminismAndRanges(unittest.TestCase):
    RULE_RANGES = {r: (P[r]["min"], P[r]["max"]) for r in ("R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10",
                                                          "R11", "R12", "R14", "R16")}

    def test_deterministic(self):
        for did in ("beshbarmak", "lagman-spicy", "steak", "sushi"):
            for bid in ("czech_dark", "ayran", "cabernet", "rice_lager"):
                a = json.dumps(score(bid, did, {"occasion": "meal", "bitter_pref": 0.3}), ensure_ascii=False, sort_keys=True)
                b = json.dumps(score(bid, did, {"occasion": "meal", "bitter_pref": 0.3}), ensure_ascii=False, sort_keys=True)
                self.assertEqual(a, b)
        r1 = E.recommend(PDS.dish_by_id["plov"], PDS.archetypes, {}, 5, P, PDS.classics)
        r2 = E.recommend(PDS.dish_by_id["plov"], list(reversed(PDS.archetypes)), {}, 5, P, PDS.classics)
        self.assertEqual([x["drink_id"] for x in r1["items"]], [x["drink_id"] for x in r2["items"]])

    def test_ranges_over_matrix(self):
        for d in PDS.dish_profiles:
            for b in PDS.archetype_profiles:
                r = E.score_pair(b, d, {}, P, PDS.classic_index)
                self.assertTrue(3 <= r["score"] <= 99)
                for k in ("W_B", "F_B", "W_D", "F_D", "fit"):
                    self.assertTrue(0.0 <= r[k] <= 1.0, (k, r[k]))
                for c in r["components"]:
                    lo, hi = self.RULE_RANGES.get(c["rule"], (-100, 100))
                    self.assertTrue(lo - 1e-9 <= c["points"] <= hi + 1e-9, (d["id"], b["id"], c))
                    if c["rule"] == "R13":
                        self.assertTrue(0 <= c["points"] <= P["R13"]["points"])
                    if c["rule"] == "R20":
                        self.assertEqual(c["points"], P["R20"]["bonus"])
                for c in r["mechanisms"]:
                    self.assertGreaterEqual(abs(c["points"]), P["mechanisms"]["min_abs"])
                self.assertLessEqual(len(r["reasons"]), 3)
                self.assertEqual([c["points"] for c in r["reasons"]], sorted([c["points"] for c in r["reasons"]], reverse=True))
                for w in r["warnings"]:
                    self.assertTrue(w["family"] == "veto" or w["points"] < 0)
                if r["capped"] and r["score"] <= 35:
                    self.assertEqual(r["band"], "avoid")
                if not r["capped"]:
                    self.assertNotEqual(r["band"], "avoid")

    def test_explain_false_same_numbers(self):
        for bid in ("czech_pale_premium", "port", "kumys"):
            for did in ("kazy", "chak-chak", "ramen"):
                a, b = score(bid, did), E.score_pair(PDS.archetype_by_id[bid], PDS.dish_by_id[did], {}, P, PDS.classic_index, explain=False)
                self.assertEqual(a["score"], b["score"])
                self.assertEqual([c["points"] for c in a["components"]], [c["points"] for c in b["components"]])

    def test_texts_filled_and_russian(self):
        for d in PDS.dish_profiles:
            for bid in ("czech_pale_premium", "cabernet", "ayran", "whisky_neat", "aperol_spritz"):
                r = E.score_pair(PDS.archetype_by_id[bid], d, {"occasion": "meal", "bitter_pref": -0.5, "dna": {"bitter": 0.5}}, P, PDS.classic_index)
                for c in r["components"] + r["warnings"]:
                    self.assertTrue(c["text"], c)
                    self.assertNotIn("{", c["text"], c)
                    self.assertRegex(c["text"], "[а-яА-ЯёЁ]")

    def test_ate_slots_use_real_numbers(self):
        r = score("czech_pale_premium", "kazy")
        r6 = next(c for c in r["components"] if c["rule"] == "R6")
        self.assertIn("40 IBU", r6["text"])            # IBU напитка
        self.assertIn("вяленого", r6["text"])          # источник соли блюда (тег cured)
        r = score("whisky_neat", "lagman-spicy")
        self.assertIn("40 %", next(w["text"] for w in r["warnings"] if w["rule"] == "V3"))
        r = score("czech_dark", "beshbarmak")
        self.assertIn("0.31 ↔ 0.29", next(c["text"] for c in r["components"] if c["rule"] == "R1"))


# ─────────────────────────────────────────────────────────────────────────────
@need_proto
class TestVetoes(unittest.TestCase):
    def test_v1_overpower(self):
        r = score("barleywine", "caprese")
        self.assertIn("V1", r["vetoes"])
        self.assertLessEqual(r["score"], 35)
        self.assertEqual(r["band"], "avoid")
        self.assertEqual(r["warnings"][0]["rule"], "V1")
        self.assertEqual(r["match_type"], "penalty")

    def test_v1_strong_cheese_exception(self):
        r = score("imperial_stout", "kazy")
        self.assertNotIn("V1", r["vetoes"])

    def test_v2_dry_vs_dessert_and_contrast_exception(self):
        self.assertIn("V2", score("brut_sparkling", "chak-chak")["vetoes"])
        r = score("double_ipa_85", "cheesecake")
        self.assertNotIn("V2", r["vetoes"])
        self.assertEqual(next(c for c in r["components"] if c["rule"] == "R4")["family"], "contrast")

    def test_v3_fire_and_heat_lover_lifts_it(self):
        self.assertIn("V3", score("whisky_neat", "lagman-spicy")["vetoes"])
        self.assertNotIn("V3", score("whisky_neat", "lagman-spicy", {"heat_lover": True})["vetoes"])

    def test_v4_v5(self):
        self.assertIn("V4", score("cabernet", "salmon-grilled")["vetoes"])
        self.assertIn("V5", score("cask_strength_whisky", "beef-tartare")["vetoes"])

    def test_v6_caps_at_50(self):
        r = score("soda_water", "lagman-spicy", params=E.merge_params(P, {"score.base": 90}))
        self.assertIn("V6", r["vetoes"])
        self.assertEqual(r["score"], 50)
        self.assertGreater(r["raw"], 50)

    def test_v7_non_alcoholic(self):
        plain = score("kvass_sour", "okroshka")
        na = score("kvass_sour", "okroshka", {"non_alcoholic": True})
        self.assertTrue(na["excluded"])
        self.assertIn("V7", na["vetoes"])
        self.assertEqual(na["score"], plain["score"])          # балл честный, только исключение из выдачи
        self.assertFalse(score("kvass_sour", "okroshka", {"non_alcoholic": True, "non_alcoholic_max_abv": 1.5})["excluded"])
        self.assertFalse(score("ayran", "okroshka", {"occasion": "non_alcoholic"})["excluded"])
        res = E.recommend(PDS.dish_by_id["okroshka"], PDS.archetypes, {"occasion": "non_alcoholic"}, 5, P, PDS.classics)
        self.assertTrue(res["items"])
        for it in res["items"]:
            self.assertLessEqual(it["abv"], 0.5)
        self.assertIn("kvass_sour", res["excluded_non_alcoholic"])
        self.assertIn("kumys", res["excluded_non_alcoholic"])


# ─────────────────────────────────────────────────────────────────────────────
class TestRuleDirections(unittest.TestCase):
    """Направление каждого правила на сконструированных парах (знаки — из литературы, §7.4 п.2)."""

    def sp(self, drink, dish, ctx=None, params=None, classics=None):
        return E.score_pair(drink, dish, ctx or {}, params or P, classics)

    def test_r1_loud_drink_penalized_and_fit(self):
        dish = mk_dish(fat=0.6, weight=0.5, salt=0.4, umami=0.4)
        quiet = mk_drink(bitter=0.2, aroma_intensity=0.3, carbonation=0.6)
        loud = mk_drink(bitter=1.0, aroma_intensity=1.0, roast=0.9, carbonation=0.6)
        rq, rl = self.sp(quiet, dish), self.sp(loud, dish)
        self.assertGreater(points(rq, "R1"), points(rl, "R1"))
        self.assertLess(rl["fit"], rq["fit"])
        self.assertLess(rl["fit"], 1.0)

    def test_r2_cut(self):
        dish = mk_dish(fat=0.8, weight=0.7)
        self.assertGreater(points(self.sp(mk_drink(tannin=0.6), dish), "R2"), points(self.sp(mk_drink(), dish), "R2"))
        fizzy = mk_drink(carbonation=1.0)
        self.assertGreater(points(self.sp(fizzy, mk_dish(fat=0.8)), "R2"), points(self.sp(fizzy, mk_dish(fat=0.8, cream=0.9)), "R2"))
        self.assertFalse(has_rule(self.sp(fizzy, mk_dish(fat=0.1, weight=0.2)), "R2"))

    def test_r3_heat(self):
        dish = mk_dish(heat=0.8, salt=0.3, fat=0.4)
        milk = mk_drink(category="dairy", abv=0, dairy=0.8, serve_temp=5)
        water = mk_drink(category="water", abv=0, serve_temp=12, body=0.1)
        spirit = mk_drink(category="spirit", abv=40, bitter=0.2)
        dipa = mk_drink(abv=8.4, bitter=1.0, ibu=85)
        self.assertGreater(points(self.sp(milk, dish), "R3"), points(self.sp(water, dish), "R3"))
        self.assertLess(points(self.sp(spirit, dish), "R3"), 0)
        base = points(self.sp(dipa, dish), "R3")
        self.assertLess(base, 0)
        self.assertGreater(points(self.sp(dipa, dish, {"heat_lover": True}), "R3"), base)
        sens = points(self.sp(dipa, dish, {"harsh_tol": "sensitive"}), "R3")
        tol = points(self.sp(dipa, dish, {"harsh_tol": "tolerant"}), "R3")
        self.assertLessEqual(sens, base)
        self.assertGreater(tol, base)
        self.assertFalse(has_rule(self.sp(dipa, mk_dish(heat=0.1)), "R3"))

    def test_r4_sweet(self):
        dessert = mk_dish(sweet=0.8, fat=0.4, dessert=True, tags={"chocolate": 1.0})
        sweet = mk_drink(category="fortified", abv=18, sweet=0.9)
        dry = mk_drink(category="wine", abv=12, sweet=0.05, acid=0.8)
        self.assertGreater(points(self.sp(sweet, dessert), "R4"), 0)
        self.assertLess(points(self.sp(dry, dessert), "R4"), 0)
        self.assertGreater(points(self.sp(mk_drink(sweet=0.3, roast=0.9), dessert), "R4"),
                           points(self.sp(mk_drink(sweet=0.3), dessert), "R4"))
        beer = mk_drink(bitter=0.9, sweet=0.2, aroma_intensity=0.8, abv=8)
        cocktail = mk_drink(category="cocktail", bitter=0.9, sweet=0.2, aroma_intensity=0.8, abv=8)
        rb, rc = self.sp(beer, mk_dish(sweet=0.8, dessert=True)), self.sp(cocktail, mk_dish(sweet=0.8, dessert=True))
        fam = {r: next(c["family"] for c in x["components"] if c["rule"] == "R4") for r, x in (("b", rb), ("c", rc))}
        if abs(rb["dF"]) < P["R4"]["contrast_dF"]:
            self.assertEqual(fam["b"], "contrast")
        self.assertNotEqual(fam["c"], "contrast")     # контраст DIPA ↔ десерт — только пиво

    def test_r5_acid(self):
        sour = mk_dish(sour=0.6, salt=0.2)
        self.assertGreater(points(self.sp(mk_drink(acid=0.8), sour), "R5"), 0)
        self.assertLess(points(self.sp(mk_drink(acid=0.1, carbonation=0.1), sour), "R5"), 0)
        flat = mk_drink(acid=0.3, carbonation=0.2)
        self.assertLess(points(self.sp(flat, mk_dish(sour=0.6, acid_type="vinegar")), "R5"), points(self.sp(flat, sour), "R5"))
        self.assertLess(points(self.sp(mk_drink(acid=0.8, sweet=0.9), sour), "R5"), points(self.sp(mk_drink(acid=0.8), sour), "R5"))

    def test_r6_salt(self):
        salty = mk_dish(salt=0.8, weight=0.6, fat=0.2, protein=0.2)
        self.assertGreater(points(self.sp(mk_drink(bitter=0.6), salty), "R6"), points(self.sp(mk_drink(bitter=0.1), salty), "R6"))
        spirit = mk_drink(category="spirit", abv=45)
        self.assertLess(points(self.sp(spirit, salty), "R6"), 0)
        shielded = mk_dish(salt=0.8, weight=0.6, fat=0.9, protein=0.9)
        self.assertGreater(points(self.sp(spirit, shielded), "R6"), points(self.sp(spirit, salty), "R6"))
        snack, heavy = mk_dish(salt=0.8, weight=0.3), mk_dish(salt=0.8, weight=0.6)   # снэк-бонус: лёгкая солёная закуска
        beer = mk_drink(bitter=0.4, carbonation=0.6)
        self.assertGreater(points(self.sp(beer, snack), "R6"), points(self.sp(beer, heavy), "R6"))
        self.assertEqual(next(c["key"] for c in self.sp(mk_drink(bitter=0.1, carbonation=0.9, acid=0.1), snack)["components"] if c["rule"] == "R6"), "clean_carb")

    def test_r7_umami(self):
        plain_umami = mk_dish(umami=0.8, salt=0.2, sour=0.1)
        tannic = mk_drink(category="wine", abv=13, tannin=0.8, bitter=0.3)
        self.assertLess(points(self.sp(tannic, plain_umami), "R7"), 0)
        self.assertLess(points(self.sp(tannic, plain_umami, {"harsh_tol": 1.4}), "R7"), points(self.sp(tannic, plain_umami), "R7"))
        salted = mk_dish(umami=0.8, salt=0.6)
        self.assertGreater(points(self.sp(mk_drink(bitter=0.5, acid=0.4), salted), "R7"), 0)

    def test_r8_tannin_protein(self):
        wine = mk_drink(category="wine", abv=13, tannin=0.8)
        self.assertGreater(points(self.sp(wine, mk_dish(protein=0.9, fat=0.6)), "R8"), 0)
        self.assertLess(points(self.sp(wine, mk_dish(protein=0.8, fat=0.7, fish_oil=0.9)), "R8"), 0)
        self.assertLess(points(self.sp(wine, mk_dish(protein=0.2, green_iron=0.8)), "R8"), 0)
        self.assertFalse(has_rule(self.sp(mk_drink(tannin=0.2), mk_dish(protein=0.9)), "R8"))

    def test_r9_fresh(self):
        raw = mk_dish(fresh=0.9, salt=0.3, weight=0.2)
        clean = mk_drink(carbonation=0.9, aroma_intensity=0.2, acid=0.4, body=0.3, abv=4)
        heavy = mk_drink(roast=0.9, body=0.9, abv=10, bitter=0.8, aroma_intensity=0.8)
        self.assertGreater(points(self.sp(clean, raw), "R9"), 0)
        self.assertLess(points(self.sp(heavy, raw), "R9"), 0)

    def test_r10_r11_r12_bridges(self):
        crust = mk_dish(maillard=0.8, fat=0.5)
        self.assertGreater(points(self.sp(mk_drink(tags={"caramel": 0.8}), crust), "R10"), 0)
        self.assertEqual(points(self.sp(mk_drink(), crust), "R10"), 0)
        smoky = mk_dish(smoke=0.8, fat=0.5)
        self.assertGreater(points(self.sp(mk_drink(smoke=0.8), smoky), "R11"), points(self.sp(mk_drink(), smoky), "R11"))
        tagged = mk_dish(tags={"bread": 1.0, "citrus": 1.0, "herbal": 1.0, "warmth": 1.0})
        r = self.sp(mk_drink(tags={"bread": 1.0, "citrus": 1.0, "herbal": 1.0}), tagged)
        self.assertEqual(points(r, "R12"), 8.0)        # потолок +8
        self.assertFalse(has_rule(self.sp(mk_drink(tags={"warmth": 1.0}), tagged), "R12"))   # теги-оси не мост

    def test_r13_both_principles(self):
        dish = mk_dish(fat=0.8, weight=0.6, maillard=0.8, salt=0.4, umami=0.4)
        r = self.sp(mk_drink(bitter=0.45, carbonation=0.6, tags={"caramel": 0.8}, ibu=35), dish)
        self.assertTrue(has_rule(r, "R13"))

    def test_r14_same_on_same(self):
        bitter_dish = mk_dish(bitter=0.8)
        self.assertLess(points(self.sp(mk_drink(bitter=0.9), bitter_dish), "R14"), 0)
        sweet_main = mk_dish(sweet=0.6)
        cocktail = mk_drink(category="cocktail", abv=15, sweet=0.7)
        self.assertLessEqual(points(self.sp(cocktail, sweet_main), "R14"), -6)

    def test_r15_regional(self):
        dish = mk_dish(cuisine=["kazakh"])
        self.assertEqual(points(self.sp(mk_drink(origin=["kazakh"]), dish), "R15"), 4)
        self.assertFalse(has_rule(self.sp(mk_drink(origin=["german"]), dish), "R15"))

    def test_r16_occasions(self):
        dish = mk_dish(fat=0.5)
        spirit = mk_drink(category="spirit", abv=40, body=0.6, aroma_intensity=0.8)
        lager = mk_drink(carbonation=0.7, acid=0.3, abv=4.5, aroma_intensity=0.3, bitter=0.3)
        port = mk_drink(category="fortified", abv=20, sweet=0.8, body=0.9)
        self.assertEqual(points(self.sp(spirit, dish, {"occasion": "meal"}), "R16"), P["R16"]["min"])   # clamp −12
        self.assertGreater(points(self.sp(lager, dish, {"occasion": "meal"}), "R16"), 0)
        self.assertGreater(points(self.sp(lager, dish, {"occasion": "hot"}), "R16"), points(self.sp(spirit, dish, {"occasion": "hot"}), "R16"))
        self.assertGreater(points(self.sp(spirit, dish, {"occasion": "evening"}), "R16"), points(self.sp(lager, dish, {"occasion": "evening"}), "R16"))
        self.assertGreater(points(self.sp(lager, dish, {"occasion": "party"}), "R16"), points(self.sp(spirit, dish, {"occasion": "party"}), "R16"))
        self.assertGreater(points(self.sp(spirit, dish, {"occasion": "gourmet"}), "R16"), points(self.sp(lager, dish, {"occasion": "gourmet"}), "R16"))
        self.assertGreater(points(self.sp(lager, dish, {"occasion": "aperitif"}), "R16"), points(self.sp(port, dish, {"occasion": "aperitif"}), "R16"))
        self.assertGreater(points(self.sp(port, dish, {"occasion": "dessert"}), "R16"), points(self.sp(lager, dish, {"occasion": "dessert"}), "R16"))
        self.assertFalse(has_rule(self.sp(lager, dish, {"occasion": "non_alcoholic"}), "R16"))

    def test_r17_personal(self):
        dish = mk_dish(fat=0.5)
        hoppy = mk_drink(bitter=0.9)
        self.assertGreater(points(self.sp(hoppy, dish, {"bitter_pref": 1}), "R17_bitter"), 0)
        self.assertLess(points(self.sp(hoppy, dish, {"bitter_pref": -1}), "R17_bitter"), 0)
        sweet = mk_drink(sweet=0.9)
        self.assertGreater(points(self.sp(sweet, dish, {"sweet_pref": 1}), "R17_sweet"), 0)
        self.assertLess(points(self.sp(sweet, dish, {"sweet_pref": -1}), "R17_sweet"), 0)
        dna_close = dict(hoppy["sensory"], serve_temp=70)       # serve_temp в косинус не входит
        self.assertGreater(points(self.sp(hoppy, dish, {"dna": dna_close}), "R17_dna"), 0)
        self.assertLess(points(self.sp(hoppy, dish, {"dna": {"sweet": 1.0, "dairy": 1.0}}), "R17_dna"), 0)
        dna = E.dna_vector([{"drink": hoppy, "rating": "love"}, {"drink": sweet, "rating": "dislike"}])
        self.assertEqual(set(dna), set(P["R17"]["dna"]["axes"]))

    def test_r18_temperature_perception(self):
        warm_bitter = mk_drink(bitter=0.6, sweet=0.4, serve_temp=18)
        off = E.derived(warm_bitter, None, P)["F_B"]
        on = E.derived(warm_bitter, None, E.merge_params(P, {"R18.enabled": True}))["F_B"]
        self.assertGreater(on, off)
        dish = mk_dish(sweet=0.6, dessert=True)
        self.assertNotEqual(self.sp(warm_bitter, dish, {"temperature_perception": True})["core"], self.sp(warm_bitter, dish)["core"])

    def test_r20_classic(self):
        drink, dish = mk_drink(id="stout"), mk_dish(id="oyster", fresh=0.5)
        classics = [{"dish": "oyster", "drink": "stout", "bonus": 8, "source": {"title": "BA chart 14"}}]
        with_c, without = self.sp(drink, dish, classics=classics), self.sp(drink, dish)
        self.assertTrue(with_c["classic"])
        self.assertFalse(without["classic"])
        self.assertEqual(points(with_c, "R20"), 8)
        self.assertAlmostEqual(with_c["core"] - without["core"], 8, places=6)
        low = self.sp(drink, dish, classics=[dict(classics[0], bonus=5)])
        self.assertEqual(points(low, "R20"), 5)                      # бонус записи — потолок
        self.assertIn("BA chart 14", next(c["text"] for c in with_c["components"] if c["rule"] == "R20"))

    def test_override_and_dilution(self):
        base = mk_drink(bitter=0.2)
        self.assertEqual(E.drink_vector(dict(base, vector_override={"bitter": 0.7}))["v"]["bitter"], 0.7)
        cocktail = mk_drink(category="cocktail", abv=30)
        cocktail["abv_after_dilution"] = 20
        prof = E.drink_vector(cocktail)
        self.assertEqual(prof["abv"], 20)
        self.assertEqual(prof["v"]["alcohol"], 0.5)
        short = {"id": "p", "cat": "beer", "abv": 5.0, "carb": 0.6, "aroma": 0.3, "temp": 5, "bitter": 0.2}
        v = E.drink_vector(short)["v"]
        self.assertEqual((v["carbonation"], v["aroma_intensity"], v["serve_temp"], v["alcohol"]), (0.6, 0.3, 5.0, 0.125))


# ─────────────────────────────────────────────────────────────────────────────
@need_proto
class TestEfesPolicy(unittest.TestCase):
    W = P["recommend"]["partner_tie_window"]

    def efes_pool(self):
        pool = [dict(x) for x in PDS.archetypes]
        for aid in ("pale_lager_intl", "czech_dark", "strong_lager", "na_lager", "helles", "amber_lager", "kvass_classic"):
            base = PDS.archetype_raw_by_id[aid]
            pool.append(dict(base, id="efes-" + aid, efes_relation="own", style={"archetype": aid, "family": base["family"]}))
        pool.append(dict(PDS.archetype_raw_by_id["cider_semi_dry"], id="dist-cider", efes_relation="distribution"))
        return pool

    def check_order(self, items, window):
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, b = items[i], items[j]
                if a["score"] < b["score"]:                      # инверсия допустима только для Efes в пределах окна
                    self.assertTrue(a["efes_partner"] and not b["efes_partner"], (a["drink_id"], b["drink_id"]))
                    self.assertLessEqual(b["score"] - a["score"], window)
                if b["efes_partner"] and not a["efes_partner"]:  # Efes, уступающий ≤ window, должен стоять выше
                    self.assertGreater(a["score"] - b["score"], window, (a["drink_id"], a["score"], b["drink_id"], b["score"]))

    def test_tie_window_properties_all_dishes(self):
        pool = self.efes_pool()
        for d in PDS.dish_profiles:
            res = E.recommend(d, pool, {}, 0, P, PDS.classics)
            items = res["items"]
            self.check_order(items, self.W)
            for it in items:   # баллы честные: совпадают с score_pair
                self.assertEqual(it["score"], E.score_pair(next(x for x in pool if x["id"] == it["drink_id"]), d, {}, P, PDS.classics)["score"])
            efes = sorted([x for x in items if x["efes_partner"]], key=lambda x: (-x["score"], x["drink_id"]))
            self.assertEqual(res["best_partner"]["drink_id"], efes[0]["drink_id"])
            self.assertEqual(res["best_partner"]["score"], efes[0]["score"])

    def test_window_zero_is_pure_score_order(self):
        pool = self.efes_pool()
        P0 = E.merge_params(P, {"recommend.partner_tie_window": 0})
        res = E.recommend(PDS.dish_by_id["beshbarmak"], pool, {}, 0, P0, PDS.classics)
        scores = [x["score"] for x in res["items"]]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_handcrafted_window(self):
        dish = mk_dish(id="dd", fat=0.5, tags={"bread": 1.0})
        a = mk_drink(id="a-rival", tags={"bread": 0.15})     # ≈ +1 балл за мост
        c = mk_drink(id="c-rival", tags={"bread": 0.8})      # ≈ +5
        b = mk_drink(id="b-efes", efes="own")
        sc = {x["id"]: E.score_pair(x, dish, {}, P)["score"] for x in (a, b, c)}
        self.assertTrue(0 < sc["a-rival"] - sc["b-efes"] <= self.W, sc)
        self.assertGreater(sc["c-rival"] - sc["b-efes"], self.W, sc)
        res = E.recommend(dish, [a, b, c], {}, 0, P)
        self.assertEqual([x["drink_id"] for x in res["items"]], ["c-rival", "b-efes", "a-rival"])
        self.assertEqual({x["drink_id"]: x["score"] for x in res["items"]}, sc)
        self.assertEqual(res["best_partner"]["drink_id"], "b-efes")
        twin = dict(b, id="b-twin", efes_relation="none")      # равный балл → Efes первым
        res = E.recommend(dish, [twin, b], {}, 0, P)
        self.assertEqual([x["drink_id"] for x in res["items"]], ["b-efes", "b-twin"])
        self.assertIsNone(E.recommend(dish, [a, c], {}, 0, P)["best_partner"])


# ─────────────────────────────────────────────────────────────────────────────
@need_proto
class TestRecommend(unittest.TestCase):
    D = P["recommend"]["diversify"]

    def test_diversification(self):
        guaranteed_na = guaranteed_nb = 0
        for d in PDS.dish_profiles:
            full = E.recommend(d, PDS.archetypes, {}, 0, P, PDS.classics)["items"]
            res = E.recommend(d, PDS.archetypes, {}, 5, P, PDS.classics)
            items = res["items"]
            self.assertEqual(len(items), 5)
            fams = {}
            for it in items:
                fams[it["family"]] = fams.get(it["family"], 0) + 1
            self.assertLessEqual(max(fams.values()), self.D["max_per_group"], (d["id"], fams))
            na_avail = any(x["abv"] <= self.D["na_max_abv"] and x["score"] >= self.D["min_score_guarantee"] for x in full)
            if na_avail:
                guaranteed_na += 1
                self.assertTrue(any(x["abv"] <= self.D["na_max_abv"] for x in items), d["id"])
            nb_avail = any(x["category"] not in self.D["beer_categories"] and x["score"] >= self.D["min_score_guarantee"] for x in full)
            if nb_avail:
                guaranteed_nb += 1
                self.assertTrue(any(x["category"] not in self.D["beer_categories"] for x in items), d["id"])
            order = [x["drink_id"] for x in full]
            self.assertEqual([x["drink_id"] for x in items], sorted([x["drink_id"] for x in items], key=order.index))
        self.assertGreater(guaranteed_na, 10)
        self.assertGreater(guaranteed_nb, 10)

    def test_group_cap_without_guarantees(self):
        for did in ("beshbarmak", "steak", "schnitzel"):
            items = E.recommend(PDS.dish_by_id[did], PDS.archetypes, {}, 5, P, PDS.classics, categories=["beer"])["items"]
            fams = {}
            for it in items:
                fams[it["family"]] = fams.get(it["family"], 0) + 1
                self.assertEqual(it["category"], "beer")
            self.assertLessEqual(max(fams.values()), self.D["max_per_group"])

    def test_filters(self):
        venue = ["czech_dark", "ayran", "cabernet", "kumys"]
        res = E.recommend(PDS.dish_by_id["beshbarmak"], PDS.archetypes, {"venue_drink_ids": venue}, 5, P, PDS.classics)
        self.assertEqual(sorted(x["drink_id"] for x in res["items"]), sorted(venue))
        res = E.recommend(PDS.dish_by_id["beshbarmak"], PDS.archetypes, {}, 3, P, PDS.classics, categories=["wine", "cider"])
        self.assertEqual(len(res["items"]), 3)
        self.assertTrue(all(x["category"] in ("wine", "cider") for x in res["items"]))

    def test_by_category_and_reverse(self):
        res = E.by_category(PDS.dish_by_id["beshbarmak"], PDS.archetypes, {}, P, PDS.classics, per_category=2)
        cats = [c["category"] for c in res["categories"]]
        self.assertEqual(cats, [c for c in E.CATEGORIES if c in cats])
        for c in res["categories"]:
            best_score = max(E.score_pair(x, PDS.dish_by_id["beshbarmak"], {}, P, PDS.classics)["score"]
                             for x in PDS.archetypes if x["category"] == c["category"])
            self.assertEqual(c["best"]["score"], best_score)     # в архетипах нет Efes → лучший = максимум
            self.assertLessEqual(len(c["items"]), 2)
        rev = E.reverse(PDS.archetype_by_id["czech_pale_premium"], PDS.dish_profiles, {}, 6, P, PDS.classics)
        s = [x["score"] for x in rev["items"]]
        self.assertEqual(len(s), 6)
        self.assertEqual(s, sorted(s, reverse=True))
        self.assertTrue(E.reverse(PDS.archetype_by_id["cabernet"], PDS.dish_profiles, {"non_alcoholic": True}, 3, P)["excluded"])


# ─────────────────────────────────────────────────────────────────────────────
class TestParams(unittest.TestCase):
    def test_version_and_calibratable_bounds(self):
        self.assertTrue(P["version"])
        for c in P["calibratable"]["params"]:
            v = E.get_path(P, c["path"])
            self.assertTrue(c["min"] <= v <= c["max"], c)

    def test_merge_params_does_not_mutate(self):
        before = json.dumps(P, sort_keys=True)
        m = E.merge_params(P, {"R1.k_loud": 60, "score": {"base": 42}})
        self.assertEqual(m["R1"]["k_loud"], 60)
        self.assertEqual(m["score"]["base"], 42)
        self.assertEqual(m["score"]["k"], P["score"]["k"])
        self.assertEqual(json.dumps(P, sort_keys=True), before)

    @need_proto
    def test_base_shift_moves_scores(self):
        P2 = E.merge_params(P, {"score.base": P["score"]["base"] + 3})
        for bid, did in (("czech_dark", "beshbarmak"), ("ayran", "lagman-spicy"), ("helles", "plov")):
            a, b = score(bid, did), score(bid, did, params=P2)
            if not a["capped"] and 3 < a["score"] < 96:
                self.assertEqual(b["score"] - a["score"], 3)

    def test_every_rule_group_documented(self):
        for k, v in P.items():
            if isinstance(v, dict) and k not in ("labels",):
                self.assertIn("_doc", v, k)


# ─────────────────────────────────────────────────────────────────────────────
@unittest.skipUnless(GOLDEN.exists(), "data/golden_v2.json не сгенерирован (scripts/engine_eval_v2.py)")
class TestGoldenV2(unittest.TestCase):
    """golden_v2.json самодостаточен (inputs + params): движок должен воспроизводить его бит-в-бит."""

    @classmethod
    def setUpClass(cls):
        cls.g = json.loads(GOLDEN.read_text(encoding="utf-8"))
        cls.P = cls.g["params"]
        cls.arch = {x["id"]: x for x in cls.g["inputs"]["archetypes"]}
        cls.dishes = {x["id"]: x for x in cls.g["inputs"]["dishes"]}
        cls.cidx = E.index_classics(cls.g["inputs"]["classics"])

    def test_helpers(self):
        for x, y in self.g["helpers"]["r2"]:
            self.assertEqual(E.r2(x), y)
        for x, y in self.g["helpers"]["round_half_up"]:
            self.assertEqual(E.round_half_up(x), y)
        for x, y in self.g["helpers"]["fmt_num"]:
            self.assertEqual(E.fmt_num(x), y)
        for x, y in self.g["helpers"]["burn"]:
            self.assertEqual(E.burn(x, self.P), y)

    def test_matrix(self):
        prof = {k: E.drink_vector(v, self.P) for k, v in self.arch.items()}
        dprof = {k: E.dish_vector(v, self.P) for k, v in self.dishes.items()}
        self.assertEqual(self.g["matrix_fields"], ["drink", "dish", "score", "core", "match_type", "secondary_type", "vetoes"])
        for b_id, d_id, s, core, t, t2, v in self.g["matrix"]:
            r = E.score_pair(prof[b_id], dprof[d_id], {}, self.P, self.cidx, explain=False)
            self.assertEqual((r["score"], r["core"], r["match_type"], r["secondary_type"], r["vetoes"]), (s, core, t, t2, v),
                             (b_id, d_id))

    def test_cases_with_texts(self):
        for case in self.g["cases"]:
            PP = E.merge_params(self.P, case["params_override"]) if case.get("params_override") else self.P
            r = E.score_pair(E.drink_vector(self.arch[case["drink"]], PP), E.dish_vector(self.dishes[case["dish"]], PP),
                             case["ctx"], PP, self.cidx)
            exp = case["result"]
            self.assertEqual(r["score"], exp["score"], case["drink"] + "×" + case["dish"])
            self.assertEqual([{k: c[k] for k in ("rule", "family", "points", "key", "evidence", "text")} for c in r["components"]],
                             exp["components"], case["drink"] + "×" + case["dish"])
            self.assertEqual([w["text"] for w in r["warnings"]], [w["text"] for w in exp["warnings"]])

    def test_recommend(self):
        pool = self.g["inputs"]["recommend_pool"]
        for rc in self.g["recommend"]:
            res = E.recommend(self.dishes[rc["dish"]], pool, rc["ctx"], rc["top_n"], self.P, self.cidx,
                              categories=rc["categories"], venue_drink_ids=rc["venue_drink_ids"], explain=False)
            self.assertEqual([(x["drink_id"], x["score"]) for x in res["items"]],
                             [(x["drink_id"], x["score"]) for x in rc["items"]], rc["dish"])
            bp = res["best_partner"]
            self.assertEqual({"drink_id": bp["drink_id"], "score": bp["score"]} if bp else None, rc["best_partner"])


# ─────────────────────────────────────────────────────────────────────────────
class TestDataFiles(unittest.TestCase):
    """Смоук по файлам других потоков: движок не падает и держит диапазоны. Пропускается, если файлов нет."""

    @classmethod
    def setUpClass(cls):
        cls.ds = load_dataset()

    def test_dishes_v2(self):
        if not self.ds.dishes:
            self.skipTest("data/dishes_v2.json нет")
        drinks = self.ds.archetype_profiles or (PDS.archetype_profiles if PDS else [])
        if not drinks:
            self.skipTest("нет напитков")
        sample = drinks[:: max(1, len(drinks) // 8)]
        for d in self.ds.dish_profiles:
            for b in sample:
                r = E.score_pair(b, d, {}, self.ds.params, self.ds.classic_index or (PDS.classic_index if PDS else None))
                self.assertTrue(3 <= r["score"] <= 99)
                for c in r["mechanisms"] + r["warnings"]:
                    self.assertNotIn("{", c["text"], (d["id"], b["id"], c))

    def test_drinks_and_styles(self):
        profiles = self.ds.drink_profiles + self.ds.archetype_profiles
        if not profiles:
            self.skipTest("data/drinks.json и data/style_priors_v2.json нет")
        dishes = self.ds.dish_profiles or (PDS.dish_profiles if PDS else [])
        for b in profiles:
            for a in E.DRINK_AXES:
                if a != "serve_temp":
                    self.assertTrue(0.0 <= b["v"][a] <= 1.0, (b["id"], a, b["v"][a]))
            for d in dishes[:: max(1, len(dishes) // 6)]:
                r = E.score_pair(b, d, {}, self.ds.params, self.ds.classic_index)
                self.assertTrue(3 <= r["score"] <= 99)


if __name__ == "__main__":
    unittest.main()
