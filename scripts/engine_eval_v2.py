#!/usr/bin/env python3
"""Оценка движка v2 на эталонных парах (ENGINE_V2_SPEC.md §7) + распределение баллов + golden для TS-паритета.

Запуск из корня репозитория:
    python3 scripts/engine_eval_v2.py                      # отчёт + data/golden_v2.json
    python3 scripts/engine_eval_v2.py --json out.json      # + машиночитаемый отчёт
    python3 scripts/engine_eval_v2.py --prototype          # данные только из прототипа (docs/research/engine_v2_prototype.py)
    python3 scripts/engine_eval_v2.py --no-classics        # без R20 (как «65/68 без белого списка» в спецификации)
    python3 scripts/engine_eval_v2.py --compare-prototype  # сверка баллов с прототипом на его матрице
    python3 scripts/engine_eval_v2.py --no-golden | --golden PATH | --quiet | --params-override '{"score.base": 42}'

Источники: каждая часть (архетипы, блюда, тесты, классика) берётся из data/*.json, если файл есть, иначе из прототипа
(в отчёте печатается, что откуда). Архетипы/блюда, на которые ссылаются тесты, но которых нет в основных файлах,
ищутся в data/research/proposed_*.json.

Критерии (§7 / V2_CONTRACT.md): ранг — внутри категории напитка среди архетипов, 1 + число архетипов категории
со строго большим баллом (соревновательный ранг: ничьи не штрафуют).
    top3  — ранг ≤ 3 и балл ≥ 70;   good — балл ≥ 60 и нет вето;
    bad   — балл ≤ 57 и (ранг > 3 или в категории ≤ 3 архетипов);   avoid — балл ≤ 35 и сработало вето (V1–V6).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from api.pairing import engine_v2 as E  # noqa: E402
from api.pairing.dataset_v2 import DatasetV2, effective_params, load_dataset, prototype_dataset  # noqa: E402

GOLDEN_PATH = ROOT / "data" / "golden_v2.json"
# поля записи напитка, которые читает движок (golden хранит только их)
ENGINE_DRINK_FIELDS = ("id", "name", "display_name", "label_ru", "category", "style", "family", "archetype", "abv",
                       "abv_after_dilution", "ibu", "sensory", "vector_override", "aroma_tags", "origin_affinity",
                       "efes_relation", "flags", "serving")
ENGINE_DISH_FIELDS = ("id", "name", "display_name", "vector", "tags", "cuisine", "is_dessert", "acid_type", "cook_method",
                      "protein_source", "sauce")


# ─────────────────────────────────────────────────────────────────────────────
# данные
# ─────────────────────────────────────────────────────────────────────────────
def build_dataset(force_prototype: bool, params_override: Optional[Dict[str, Any]],
                  use_calibration: bool = True) -> DatasetV2:
    """use_calibration — накладывать ли data/engine_v2_calibration.json (калибратор строит набор без слоя)."""
    params = effective_params(None, params_override, use_calibration)
    proto = prototype_dataset(params)
    if force_prototype:
        if proto is None:
            sys.exit("prototype not found: docs/research/engine_v2_prototype.py")
        proto.sources = {k: "prototype" for k in ("archetypes", "dishes", "tests", "classics", "drinks")}
        return proto
    files = load_dataset(params_override=params_override, use_calibration=use_calibration)
    src: Dict[str, str] = {}

    def pick(name: str, file_val, proto_val, fname: str):
        if file_val:
            src[name] = fname
            return file_val
        src[name] = "prototype" if proto is not None else "missing"
        return proto_val if proto is not None else []

    archetypes = pick("archetypes", files.archetypes, proto.archetypes if proto else [], "style_priors_v2.json")
    dishes = pick("dishes", files.dishes, proto.dishes if proto else [], "dishes_v2.json")
    tests = pick("tests", files.tests if files.tests.get("pairs") else None, proto.tests if proto else None,
                 "test_pairs.json") or {"pairs": [], "ordinals": []}
    classics = pick("classics", files.classics, proto.classics if proto else [], "classic_pairs.json")
    src["drinks"] = "drinks.json" if files.drinks else "missing"
    ds = DatasetV2(archetypes=archetypes, dishes=dishes, drinks=files.drinks, classics=classics, tests=tests,
                   params=params, source="mixed", missing=files.missing,
                   proposed_archetypes=files.proposed_archetypes, proposed_dishes=files.proposed_dishes)
    ds.sources = src
    return ds


def resolve(ds: DatasetV2):
    """Добирает блюда/архетипы, упомянутые в тестах, из proposed_*.json. Возвращает (pool, dish_by_id, notes)."""
    P = ds.params
    pool = list(ds.archetype_profiles)
    arch = dict(ds.archetype_by_id)
    dishes = dict(ds.dish_by_id)
    notes: List[str] = []
    prop_a = {x["id"]: x for x in ds.proposed_archetypes}
    prop_d = {x["id"]: x for x in ds.proposed_dishes}
    refs = [(p["dish"], p["drink"]) for p in ds.tests.get("pairs", [])]
    refs += [(o["dish"], o["a"]) for o in ds.tests.get("ordinals", [])] + [(o["dish"], o["b"]) for o in ds.tests.get("ordinals", [])]
    for dish_id, drink_id in refs:
        if drink_id not in arch and drink_id in prop_a:
            arch[drink_id] = E.drink_vector(prop_a[drink_id], P)
            pool.append(arch[drink_id])
            notes.append(f"archetype {drink_id} ← research/proposed_archetypes.json")
        if dish_id not in dishes and dish_id in prop_d:
            dishes[dish_id] = E.dish_vector(prop_d[dish_id], P)
            notes.append(f"dish {dish_id} ← research/proposed_dishes.json")
    return pool, arch, dishes, notes


def pair_ctx(p: Dict[str, Any]) -> Dict[str, Any]:
    ctx = dict(p.get("ctx") or {})
    if p.get("heat_lover"):
        ctx["heat_lover"] = True
    if p.get("occasion") and "occasion" not in ctx:
        ctx["occasion"] = p["occasion"]
    return ctx


# ─────────────────────────────────────────────────────────────────────────────
# оценка
# ─────────────────────────────────────────────────────────────────────────────
def evaluate(ds: DatasetV2, classics: Any) -> Dict[str, Any]:
    P = ds.params
    pool, arch, dishes, notes = resolve(ds)
    by_cat: Dict[str, List[Dict[str, Any]]] = {}
    for b in pool:
        by_cat.setdefault(b["category"], []).append(b)
    rows = []
    for p in ds.tests.get("pairs", []):
        row: Dict[str, Any] = {"id": p.get("id"), "dish": p["dish"], "drink": p["drink"], "expect": p["expect"],
                               "split": p.get("split", "train"), "origin": p.get("origin", "?"),
                               "evidence": p.get("evidence")}
        if p["dish"] not in dishes or p["drink"] not in arch:
            row.update(status="SKIP", reason="unknown dish" if p["dish"] not in dishes else "unknown archetype")
            rows.append(row)
            continue
        ctx = pair_ctx(p)
        d = dishes[p["dish"]]
        b = arch[p["drink"]]
        r = E.score_pair(b, d, ctx, P, classics, explain=False)
        peers = by_cat.get(b["category"], [])
        higher = 0
        for x in peers:
            if x["id"] != b["id"] and E.score_pair(x, d, ctx, P, classics, explain=False)["score"] > r["score"]:
                higher += 1
        rank = higher + 1
        ncat = len(peers)
        s = r["score"]
        vetoed = any(v in E.CAP_VETOES for v in r["vetoes"])
        ok = {"top3": rank <= 3 and s >= 70,
              "good": s >= 60 and not vetoed,
              "bad": s <= 57 and (rank > 3 or ncat <= 3),
              "avoid": s <= 35 and vetoed}.get(p["expect"])
        row.update(category=b["category"], score=s, rank=rank, n_cat=ncat, vetoes=r["vetoes"], ctx=ctx,
                   match_type=r["match_type"], status="OK" if ok else "FAIL")
        rows.append(row)
    ords = []
    for o in ds.tests.get("ordinals", []):
        row = {"id": o.get("id"), "dish": o["dish"], "a": o["a"], "b": o["b"], "min_gap": o.get("min_gap", 0),
               "ctx": o.get("ctx") or {}, "why": o.get("why", "")}
        if o["dish"] not in dishes or o["a"] not in arch or o["b"] not in arch:
            row.update(status="SKIP")
            ords.append(row)
            continue
        sa = E.score_pair(arch[o["a"]], dishes[o["dish"]], row["ctx"], P, classics, explain=False)["score"]
        sb = E.score_pair(arch[o["b"]], dishes[o["dish"]], row["ctx"], P, classics, explain=False)["score"]
        row.update(score_a=sa, score_b=sb, status="OK" if sa - sb >= row["min_gap"] else "FAIL")
        ords.append(row)
    return {"pairs": rows, "ordinals": ords, "notes": notes, "pool": pool, "dishes": dishes}


def matrix_stats(scores: List[int]) -> Dict[str, Any]:
    s = sorted(scores)
    n = len(s)
    if not n:
        return {"n": 0}

    def q(p: float) -> int:  # как в прототипе: s[min(n-1, int(p·n))]
        return s[min(n - 1, int(p * n))]
    ge72 = sum(1 for x in s if x >= 72)
    le47 = sum(1 for x in s if x <= 47)
    return {"n": n, "min": s[0], "p10": q(0.1), "median": q(0.5), "p90": q(0.9), "max": s[-1],
            "pct_ge72": E.r1(100.0 * ge72 / n), "pct_le47": E.r1(100.0 * le47 / n)}


def summarize(rows: List[Dict[str, Any]], key: str) -> Dict[str, Dict[str, int]]:
    out: Dict[str, Dict[str, int]] = {}
    for r in rows:
        if r["status"] == "SKIP":
            continue
        k = str(r.get(key))
        g = out.setdefault(k, {"pass": 0, "total": 0})
        g["total"] += 1
        g["pass"] += 1 if r["status"] == "OK" else 0
    return dict(sorted(out.items()))


def compare_prototype(params: Dict[str, Any]) -> Dict[str, Any]:
    proto = prototype_dataset(params)
    from api.pairing.dataset_v2 import load_prototype_module
    mod = load_prototype_module()
    diffs = []
    n = 0
    for d in mod.DISHES:
        for b in mod.DRINKS:
            pr = mod.score_pair(b, d, {}, True)["score"]
            r = E.score_pair(proto.archetype_by_id[b["id"]], proto.dish_by_id[d["id"]], {}, params, proto.classic_index,
                             explain=False)["score"]
            n += 1
            if r != pr:
                diffs.append({"dish": d["id"], "drink": b["id"], "prototype": pr, "v2": r})
    return {"n": n, "n_diff": len(diffs), "max_abs_diff": max([abs(x["v2"] - x["prototype"]) for x in diffs] or [0]),
            "diffs": diffs}


# ─────────────────────────────────────────────────────────────────────────────
# golden для TS-паритета
# ─────────────────────────────────────────────────────────────────────────────
def _slim_drink(rec: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: rec[k] for k in ENGINE_DRINK_FIELDS if k in rec}
    if isinstance(out.get("flags"), dict):
        out["flags"] = {"non_alcoholic": bool(out["flags"].get("non_alcoholic"))}
    if isinstance(out.get("style"), dict):
        out["style"] = {k: out["style"][k] for k in ("archetype", "family") if k in out["style"]}
    if isinstance(out.get("serving"), dict):
        out["serving"] = {k: out["serving"][k] for k in ("temp_min_c", "temp_max_c") if k in out["serving"]}
    return out


def _slim_result(r: Dict[str, Any]) -> Dict[str, Any]:
    keys = ("drink_id", "dish_id", "score", "band", "match_type", "secondary_type", "vetoes", "capped", "excluded",
            "classic", "efes_partner", "W_B", "F_B", "W_D", "F_D", "W_B_eff", "dW", "dF", "fit", "core", "ctx_points", "raw")
    out = {k: r[k] for k in keys}
    out["components"] = [{k: c[k] for k in ("rule", "family", "points", "key", "evidence", "text")} for c in r["components"]]
    out["mechanisms"] = [c["rule"] for c in r["mechanisms"]]
    out["reasons"] = [c["rule"] for c in r["reasons"]]
    out["warnings"] = [{"rule": c["rule"], "text": c["text"]} for c in r["warnings"]]
    return out


def _slim_list(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{"drink_id": r["drink_id"], "score": r["score"], "efes_partner": r["efes_partner"]} for r in items]


def build_golden(ds: DatasetV2, classics_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    P = ds.params
    cidx = E.index_classics(classics_list)
    arch_raw = [_slim_drink(x) for x in ds.archetypes]
    arch_ids = {x["id"] for x in arch_raw}
    dish_raw = [{k: x[k] for k in ENGINE_DISH_FIELDS if k in x} for x in ds.dishes]
    dish_ids = [d["id"] for d in dish_raw]
    # пул для recommend: каталог drinks.json, иначе архетипы + синтетические «Efes»-копии (для политики tie-window)
    if ds.drinks:
        pool_raw = [_slim_drink(x) for x in ds.drinks]
        pool_note = "drinks.json"
    else:
        pool_raw = [dict(x, efes_relation="none") for x in arch_raw]
        for aid in ("pale_lager_intl", "czech_pale_premium", "czech_dark", "strong_lager", "helles", "na_lager", "amber_lager"):
            if aid in arch_ids:
                base = next(x for x in arch_raw if x["id"] == aid)
                pool_raw.append(dict(base, id="efes-" + aid.replace("_", "-"), name="Efes " + str(base.get("label_ru") or aid),
                                     efes_relation="own", style={"archetype": aid, "family": base.get("family")}))
        pool_note = "synthetic: archetypes + efes-* copies"
    pool = [E.drink_vector(x, P) for x in pool_raw]
    arch_prof = {x["id"]: E.drink_vector(x, P) for x in arch_raw}
    dish_prof = {d["id"]: E.dish_vector(d, P) for d in dish_raw}

    profiles = {"drinks": {}, "dishes": {}}
    for x in list(arch_prof.values()) + [p for p in pool if p["id"] not in arch_prof]:
        dv = E.derived(x, None, P)
        profiles["drinks"][x["id"]] = {"v": x["v"], "abv": x["abv"], "W_B": E.r2(dv["W_B"]), "F_B": E.r2(dv["F_B"])}
    for did, dp in dish_prof.items():
        dv = E.derived(None, dp, P)
        profiles["dishes"][did] = {"W_D": E.r2(dv["W_D"]), "F_D": E.r2(dv["F_D"])}

    matrix = []
    for did in dish_ids:
        for aid in (x["id"] for x in arch_raw):
            r = E.score_pair(arch_prof[aid], dish_prof[did], {}, P, cidx, explain=False)
            matrix.append([aid, did, r["score"], r["core"], r["match_type"], r["secondary_type"], r["vetoes"]])

    dna = E.dna_vector([{"drink": arch_prof[a], "rating": rt} for a, rt in
                        (("czech_pale_premium", "love"), ("american_ipa_45", "like"), ("milk_stout", "dislike"))
                        if a in arch_prof], P)
    case_specs = [
        ("czech_dark", "beshbarmak", {}, None), ("rice_lager", "beshbarmak", {}, None),
        ("kumys", "beshbarmak", {}, None), ("old_fashioned", "beshbarmak", {"occasion": "meal"}, None),
        ("ayran", "lagman-spicy", {}, None), ("lemonade_sweet", "lagman-spicy", {}, None),
        ("soda_water", "lagman-spicy", {}, None), ("whisky_neat", "lagman-spicy", {}, None),
        ("whisky_neat", "lagman-spicy", {"heat_lover": True}, None),
        ("rauchbier", "kazy", {}, None), ("imperial_stout", "kazy", {}, None), ("czech_pale_premium", "kazy", {}, None),
        ("brut_sparkling", "chak-chak", {}, None), ("milk_stout", "chak-chak", {}, None), ("port", "chak-chak", {}, None),
        ("cabernet", "steak", {}, None), ("black_tea_strong", "steak", {}, None),
        ("double_ipa_85", "buffalo-wings", {}, None), ("double_ipa_85", "buffalo-wings", {"heat_lover": True}, None),
        ("double_ipa_85", "buffalo-wings", {"harsh_tol": "sensitive"}, None),
        ("double_ipa_85", "buffalo-wings", {"harsh_tol": "tolerant"}, None),
        ("helles", "buffalo-wings", {"harsh_tol": 1.2}, None),
        ("barleywine", "caprese", {}, None), ("cabernet", "salmon-grilled", {}, None),
        ("cask_strength_whisky", "beef-tartare", {}, None), ("light_lager", "chocolate-fondant", {}, None),
        ("imperial_stout", "chocolate-fondant", {}, None), ("gin_tonic", "chocolate-fondant", {}, None),
        ("soda_water", "chocolate-fondant", {}, None), ("shiraz", "asparagus-grilled", {}, None),
        ("cabernet", "kartoffelsalat", {}, None), ("cider_dry", "kartoffelsalat", {}, None),
        ("double_ipa_85", "cheesecake", {}, None), ("negroni", "strudel", {}, None),
        ("peated_whisky", "cheese-aged", {}, None), ("dry_stout", "oysters-raw", {}, None),
        ("witbier", "mussels-steamed", {}, None), ("mezcal", "shashlyk", {}, None),
        ("aperol_spritz", "kurt", {}, None), ("german_pils", "kurt", {}, None), ("na_lager", "pretzel", {}, None),
        ("kvass_sour", "okroshka", {"non_alcoholic": True}, None),
        ("kvass_sour", "okroshka", {"non_alcoholic": True, "non_alcoholic_max_abv": 1.5}, None),
        ("na_lager", "okroshka", {"occasion": "non_alcoholic"}, None),
        ("port", "strudel", {"temperature_perception": True}, None),
        ("rice_lager", "sushi", {}, {"score.base": 42, "score.k": 0.85}),
        ("porter", "tiramisu", {}, {"R18": {"enabled": True}}),
        ("american_ipa_45", "burger", {"bitter_pref": 1.0}, None), ("american_ipa_45", "burger", {"bitter_pref": -1.0}, None),
        ("milk_stout", "tiramisu", {"sweet_pref": 1.0}, None), ("milk_stout", "tiramisu", {"sweet_pref": -0.5}, None),
        ("amber_lager", "plov", {"dna": dna} if dna else {}, None),
        ("vodka_neat", "plov", {"dna": dna} if dna else {}, None),
        ("amber_lager", "plov", {"occasion": "gourmet", "bitter_pref": 0.5, "sweet_pref": -0.5, "harsh_tol": "sensitive",
                                 **({"dna": dna} if dna else {})}, None),
    ]
    for occ in ("meal", "aperitif", "dessert", "hot", "evening", "party", "gourmet"):
        case_specs.append(("pale_lager_intl", "shashlyk", {"occasion": occ}, None))
        case_specs.append(("whisky_neat", "shashlyk", {"occasion": occ}, None))
        case_specs.append(("aperol_spritz", "nachos", {"occasion": occ}, None))
    cases = []
    for bid, did, ctx, override in case_specs:
        if bid not in arch_prof or did not in dish_prof:
            continue
        PP = E.merge_params(P, override) if override else P
        # профиль строится заново под PP (тексты/оси берутся из тех же params)
        r = E.score_pair(E.drink_vector(next(x for x in arch_raw if x["id"] == bid), PP),
                         E.dish_vector(next(x for x in dish_raw if x["id"] == did), PP), ctx, PP, cidx)
        case = {"drink": bid, "dish": did, "ctx": ctx, "result": _slim_result(r)}
        if override:
            case["params_override"] = override
        cases.append(case)

    venue = [x["id"] for x in pool_raw[::3]]
    rec_specs = [
        ("beshbarmak", {}, 5, None, None), ("beshbarmak", {}, 8, None, None), ("lagman-spicy", {}, 5, None, None),
        ("kazy", {"occasion": "evening"}, 5, None, None), ("sushi", {"non_alcoholic": True}, 5, None, None),
        ("chak-chak", {}, 5, ["beer", "cider"], None), ("steak", {}, 5, None, venue),
        ("plov", {"bitter_pref": -1.0}, 5, None, None), ("okroshka", {"occasion": "hot"}, 5, None, None),
        ("shashlyk", {}, 0, None, None),
    ]
    recs = []
    for did, ctx, n, cats, ven in rec_specs:
        if did not in dish_prof:
            continue
        res = E.recommend(dish_prof[did], pool, ctx, n, P, cidx, categories=cats, venue_drink_ids=ven, explain=False)
        bp = res["best_partner"]
        recs.append({"dish": did, "ctx": ctx, "top_n": n, "categories": cats, "venue_drink_ids": ven,
                     "items": _slim_list(res["items"]),
                     "best_partner": {"drink_id": bp["drink_id"], "score": bp["score"]} if bp else None,
                     "excluded_non_alcoholic": res["excluded_non_alcoholic"], "n_candidates": res["n_candidates"]})
    cats_out = []
    for did, ctx in (("beshbarmak", {}), ("lagman-spicy", {"non_alcoholic": True}), ("steak", {"occasion": "meal"})):
        if did not in dish_prof:
            continue
        res = E.by_category(dish_prof[did], pool, ctx, P, cidx, per_category=2, explain=False)
        cats_out.append({"dish": did, "ctx": ctx, "per_category": 2,
                         "categories": [{"category": c["category"], "n": c["n"], "items": _slim_list(c["items"])}
                                        for c in res["categories"]]})
    revs = []
    for bid, ctx in (("czech_pale_premium", {}), ("ayran", {"occasion": "meal"}), ("cabernet", {"non_alcoholic": True})):
        if bid not in arch_prof:
            continue
        res = E.reverse(arch_prof[bid], list(dish_prof.values()), ctx, 6, P, cidx, explain=False)
        revs.append({"drink": bid, "ctx": ctx, "top_n": 6, "excluded": res["excluded"],
                     "items": [{"dish_id": r["dish_id"], "score": r["score"]} for r in res["items"]]})

    helpers = {
        "r2": [[x, E.r2(x)] for x in (0.125, 0.135, 2.675, 1.005, -1.005, 0.285, -0.004, -0.006, 2.835, 72.495, 16.51)],
        "round_half_up": [[x, E.round_half_up(x)] for x in (40.5, 16.51, 2.5, -0.5, -2.5, 0.49999999999999994, 71.4999)],
        "fmt_num": [[x, E.fmt_num(x)] for x in (5.0, 4.4, 8.45, 0.0, 12, 58.0, 0.75)],
        "fmt2": [[x, E.fmt2(x)] for x in (0.125, 0.3, 0.005, 0.0, -0.07, 0.295)],
        "burn": [[a, E.burn(a, P)] for a in (0, 5, 6.5, 7, 8.4, 9.5, 12, 14, 17, 22, 24, 30, 40, 46, 58)],
        "cold": [[t, E.cold(t, P)] for t in (0, 3, 4, 6, 8.5, 12, 18, 70)],
    }
    return {
        "version": P.get("version"),
        "engine": "v2",
        "generated_by": "scripts/engine_eval_v2.py",
        "sources": getattr(ds, "sources", {}),
        "recommend_pool": pool_note,
        "_doc": "Эталон для TS-паритета: входы (inputs), параметры (params) и результаты движка v2. TS-порт должен "
                "получить из inputs+params те же профили, матрицу, кейсы (все компоненты с текстами), recommend/by_category/"
                "reverse и помощники. Регенерация: python3 scripts/engine_eval_v2.py.",
        "params": P,
        "inputs": {"archetypes": arch_raw, "dishes": dish_raw, "recommend_pool": pool_raw, "classics": classics_list},
        "helpers": helpers,
        "profiles": profiles,
        "matrix_fields": ["drink", "dish", "score", "core", "match_type", "secondary_type", "vetoes"],
        "matrix": matrix,
        "cases": cases,
        "recommend": recs,
        "by_category": cats_out,
        "reverse": revs,
    }


# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", metavar="PATH", help="записать отчёт в JSON")
    ap.add_argument("--prototype", action="store_true", help="использовать только данные прототипа")
    ap.add_argument("--no-classics", action="store_true", help="без R20")
    ap.add_argument("--compare-prototype", action="store_true", help="сверить баллы с прототипом на его матрице")
    ap.add_argument("--no-golden", action="store_true", help="не писать golden")
    ap.add_argument("--golden", metavar="PATH", default=str(GOLDEN_PATH), help="куда писать golden")
    ap.add_argument("--params-override", metavar="JSON", help='переопределить параметры, напр. \'{"score.base": 42}\'')
    ap.add_argument("--quiet", action="store_true", help="только сводка")
    ap.add_argument("--no-calibration", action="store_true",
                    help="без слоя data/engine_v2_calibration.json — только литературные значения")
    a = ap.parse_args()

    override = json.loads(a.params_override) if a.params_override else None
    ds = build_dataset(a.prototype, override, use_calibration=not a.no_calibration)
    classics = None if a.no_classics else ds.classic_index
    res = evaluate(ds, classics)
    rows, ords = res["pairs"], res["ordinals"]

    print(f"Flavor Tree engine v2 {ds.params.get('version')} — eval")
    print("sources:", ", ".join(f"{k}={v}" for k, v in sorted(getattr(ds, "sources", {}).items())))
    for n in res["notes"]:
        print("  note:", n)
    print(f"archetypes in pool: {len(res['pool'])}, dishes: {len(res['dishes'])}, classics: {'off' if a.no_classics else len(ds.classics)}")
    if not a.quiet:
        print("\n# pairs")
        for r in rows:
            if r["status"] == "SKIP":
                print(f"SKIP {r['id']:>4} {r['dish']:<20} {r['drink']:<24} ({r['reason']})")
                continue
            print(f"{r['status']:<4} {r['id']:>4} {r['dish']:<20} {r['drink']:<24} exp={r['expect']:<5} score={r['score']:>3} "
                  f"rank={r['rank']:>2}/{r['n_cat']:<2} {','.join(r['vetoes']):<8} {r['split']:<7} {r['origin']}")
    scored = [r for r in rows if r["status"] != "SKIP"]
    n_ok = sum(1 for r in scored if r["status"] == "OK")
    print(f"\nPAIRS: {n_ok}/{len(scored)} passed" + (f" ({len(rows) - len(scored)} skipped)" if len(rows) != len(scored) else ""))
    for key in ("split", "origin", "category", "expect"):
        s = summarize(rows, key)
        print(f"  by {key}: " + "; ".join(f"{k} {v['pass']}/{v['total']}" for k, v in s.items()))
    fails = [r for r in scored if r["status"] == "FAIL"]
    if fails:
        print("  FAIL: " + "; ".join(f"{r['id']} {r['dish']}×{r['drink']} ({r['expect']}: {r['score']}, rank {r['rank']})" for r in fails))
    print("\n# ordinals")
    for o in ords:
        if o["status"] == "SKIP":
            print(f"  SKIP {o['id']} {o['dish']} {o['a']} vs {o['b']}")
            continue
        if not a.quiet or o["status"] != "OK":
            print(f"  {o['status']:<4} {o['id']:>4} {o['dish']:<16} {o['a']:>20} {o['score_a']:>3} vs {o['b']:<20} {o['score_b']:>3} "
                  f"(need ≥ {o['min_gap']:+}) {json.dumps(o['ctx'], ensure_ascii=False) if o['ctx'] else ''}")
    o_scored = [o for o in ords if o["status"] != "SKIP"]
    print(f"ORDINALS: {sum(1 for o in o_scored if o['status'] == 'OK')}/{len(o_scored)} passed")

    scores = []
    for d in res["dishes"].values():
        for b in res["pool"]:
            scores.append(E.score_pair(b, d, {}, ds.params, classics, explain=False)["score"])
    ms = matrix_stats(scores)
    print(f"\nMATRIX {len(res['pool'])}×{len(res['dishes'])} = {ms['n']}: min {ms['min']} · p10 {ms['p10']} · median {ms['median']} · "
          f"p90 {ms['p90']} · max {ms['max']} · ≥72: {ms['pct_ge72']}% · ≤47: {ms['pct_le47']}%")

    cmp = None
    if a.compare_prototype:
        cmp = compare_prototype(ds.params)
        print(f"\nPROTOTYPE COMPARE: {cmp['n']} pairs, {cmp['n_diff']} differ, max |Δ| = {cmp['max_abs_diff']}")
        for x in cmp["diffs"][:20]:
            print(f"  {x['dish']} × {x['drink']}: prototype {x['prototype']} → v2 {x['v2']}")

    if a.json:
        out = {"version": ds.params.get("version"), "sources": getattr(ds, "sources", {}), "notes": res["notes"],
               "classics": not a.no_classics, "params_override": override,
               "summary": {"pairs_passed": n_ok, "pairs_total": len(scored), "pairs_skipped": len(rows) - len(scored),
                           "ordinals_passed": sum(1 for o in o_scored if o["status"] == "OK"), "ordinals_total": len(o_scored)},
               "by_split": summarize(rows, "split"), "by_origin": summarize(rows, "origin"),
               "by_category": summarize(rows, "category"), "by_expect": summarize(rows, "expect"),
               "pairs": rows, "ordinals": ords, "matrix": ms, "prototype_compare": cmp}
        Path(a.json).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\njson → {a.json}")

    if not a.no_golden and not override and not a.no_classics:
        golden = build_golden(ds, ds.classics)
        Path(a.golden).write_text(json.dumps(golden, ensure_ascii=False, indent=None, separators=(",", ":")) + "\n",
                                  encoding="utf-8")
        size = Path(a.golden).stat().st_size
        print(f"golden → {a.golden} ({len(golden['matrix'])} matrix, {len(golden['cases'])} cases, "
              f"{len(golden['recommend'])} recommend, {size // 1024} KB)")
    elif not a.no_golden:
        print("golden not written (override/--no-classics run)")


if __name__ == "__main__":
    main()
