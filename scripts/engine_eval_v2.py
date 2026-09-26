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
    bad   — балл ≤ 57 и (ранг > 3, или в категории ≤ 3 архетипов, или балл < 48 — «не рекомендуем» в любом ранге:
            если в категории всё плохо, плохой напиток может оказаться 2-м, но гостю его всё равно не покажут);
    avoid — балл ≤ 35 и сработало вето (V1–V6).
"""
from __future__ import annotations

import argparse
import hashlib
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
              "bad": s <= 57 and (rank > 3 or ncat <= 3 or s < E.BAD_ABSOLUTE),
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


_SIG_NUMS = ("W_B", "F_B", "W_D", "F_D", "W_B_eff", "dW", "dF", "fit", "core", "ctx_points", "raw")


def _sig(r: Dict[str, Any]) -> str:
    """Сигнатура полного результата score_pair(explain=True): первые 12 hex sha1 от канонической строки (UTF-8).
    Покрывает то, чего нет в строке матрицы: ключи, баллы и тексты всех правил, механизмы, причины, предупреждения, бэнд,
    промежуточные величины. Строки через «\\n» (TS-зеркало: frontend/scripts/engine-parity-v2.mjs, sigLine):
      C|rule|family|key|evidence|fmt2(points)|text   — компонент, в порядке вычисления;
      M|правила mechanisms через «,»;   R|правила reasons через «,»;   W|rule|text — предупреждение;
      S|score|band|band_label|match_type|secondary_type или ""|vetoes через «,»|capped|excluded|classic (булевы — 1/0);
      N|W_B|F_B|W_D|F_D|W_B_eff|dW|dF|fit|core|ctx_points|raw (каждое через fmt2).
    Только строки, целые и fmt2 — форматирование совпадает в Python и JS."""
    def flag(v: Any) -> str:
        return "1" if v else "0"
    lines = [f"C|{c['rule']}|{c['family']}|{c['key']}|{c['evidence']}|{E.fmt2(c['points'])}|{c['text']}"
             for c in r["components"]]
    lines.append("M|" + ",".join(c["rule"] for c in r["mechanisms"]))
    lines.append("R|" + ",".join(c["rule"] for c in r["reasons"]))
    lines += [f"W|{w['rule']}|{w['text']}" for w in r["warnings"]]
    lines.append("|".join(["S", str(r["score"]), r["band"], r["band_label"], r["match_type"], r["secondary_type"] or "",
                           ",".join(r["vetoes"]), flag(r["capped"]), flag(r["excluded"]), flag(r["classic"])]))
    lines.append("|".join(["N"] + [E.fmt2(r[k]) for k in _SIG_NUMS]))
    return hashlib.sha1("\n".join(lines).encode("utf-8")).hexdigest()[:12]


def _profile_out(p: Dict[str, Any]) -> Dict[str, Any]:
    """Профиль движка целиком (без служебного _v2) — для edge-записей golden."""
    return {k: v for k, v in p.items() if k != "_v2"}


# Синтетические записи для golden (секция edge): ветки нормализации drink_vector/dish_vector, которых нет в каталоге
# (формат прототипа, vector_override, abv_after_dilution, середина serving, пустой sensory, теги списком, None-значения,
# неизвестные категории, is_dessert=None при dessert=True, не-словарь vector…), горячий контраст R4 и roast_exempt V2 (2.2),
# классики со строковым источником / только label / бонусом выше max_bonus. Это не данные продукта.
_EDGE_DRINKS: List[Dict[str, Any]] = [
    {"id": "edge-proto", "cat": "cocktail", "abv": 18, "ibu": None, "sweet": .5, "acid": .3, "bitter": .6, "tannin": 0,
     "carb": .2, "body": .4, "dairy": 0, "salt": 0, "umami": 0, "aroma": .8, "roast": 0, "smoke": 0, "temp": 7,
     "tags": {"bitter_orange": .8, "herbal": .5}, "origin": ["italian"]},
    {"id": "edge-override", "name": "Override", "category": "beer", "abv": 6.2, "ibu": 44.5,
     "sensory": {"sweet": .2, "bitter": .5, "carbonation": .7, "body": .4},
     "vector_override": {"bitter": .9, "alcohol": .5, "serve_temp": 9.5}, "aroma_tags": ["citrus", "pine_resin", "citrus"],
     "origin_affinity": "american", "efes_relation": "cci", "serving": {"temp_min_c": 4, "temp_max_c": 8}},
    {"id": "edge-dilution", "display_name": "Разбавленный", "name": "ignored", "category": "cocktail", "abv": 40,
     "abv_after_dilution": 12.5, "sensory": {"sweet": .7, "acid": .6, "carbonation": .8, "body": .3, "serve_temp": None},
     "serving": {"temp_min_c": 2, "temp_max_c": 5}, "aroma_tags": {"citrus": .9, "mint": .6, "x": None},
     "style": {"archetype": "mojito", "family": "HIGHBALL"}},
    {"id": "edge-empty-sensory", "label_ru": "Пустой", "category": "water", "abv": None, "sensory": {},
     "vector": {"carbonation": .9, "acid": .1}, "flags": {"non_alcoholic": True}, "efes_relation": None,
     "aroma_tags": None, "tags": ["mineral"]},
    {"id": "edge-alcohol-only", "category": "spirit",
     "sensory": {"alcohol": .95, "aroma_intensity": .9, "roast": .3, "smoke": .8, "tannin": .2},
     "ibu": 0, "style": {}, "family": "WHISKY", "archetype": "peated_whisky", "serving": {"temp_min_c": 16}},
    {"id": "edge-na-beer", "name": "NA", "category": "na_beer", "abv": 0.4, "ibu": 18,
     "sensory": {"sweet": .3, "bitter": .3, "carbonation": .8, "body": .3, "serve_temp": 4}, "efes_relation": "own",
     "flags": {"non_alcoholic": False}, "aroma_tags": {"grain": .5, "bread": .5, "honey": .5}},
    {"id": "edge-mead", "name": "Медовуха", "category": "mead", "abv": 11, "sensory": {"sweet": .8, "body": .6, "acid": .3},
     "aroma_tags": {"honey": 1.0, "floral": .5, "warm_spice": .5}, "origin_affinity": ["russian", "tatar"]},
    {"id": "edge-kombucha", "name": "Комбуча", "category": "kombucha", "abv": 0.5,
     "sensory": {"acid": .7, "carbonation": .6, "sweet": .3}},
    {"id": "edge-ties", "name": "Ties", "category": "beer", "abv": 5, "ibu": 20,
     "sensory": {"sweet": .3, "bitter": .3, "carbonation": .5, "body": .4, "acid": .3, "salt": .3, "tannin": .3,
                 "serve_temp": 6},
     "aroma_tags": {"yeast": .5, "bread": .5, "caramel": .5, "toast": .5, "biscuit": .5, "grain": .5, "nutty": .5,
                    "honey": .5, "citrus": .5, "herbal": .5}},
    {"id": "edge-hot-tea", "name": "Горячий чай", "category": "tea", "abv": 0,
     "sensory": {"bitter": .35, "tannin": .55, "aroma_intensity": .5, "body": .2, "serve_temp": 75},
     "aroma_tags": {"herbal": .4, "floral": .3}},
    {"id": "edge-roasted-dry", "name": "Сухой стаут", "category": "beer", "abv": 4.2, "ibu": 40,
     "sensory": {"sweet": .1, "bitter": .6, "roast": .7, "body": .45, "carbonation": .45, "serve_temp": 9},
     "aroma_tags": {"coffee": .8, "chocolate": .5, "roast": .9}, "style": {"archetype": "dry_stout", "family": "STOUT"}},
]
_EDGE_DISHES: List[Dict[str, Any]] = [
    {"id": "edge-proto-dish", "name": "Прото", "salt": .8, "sweet": .1, "sour": .5, "umami": .6, "fat": .7, "protein": .9,
     "heat": .7, "weight": .7, "maillard": .6, "smoke": .5, "fresh": .1, "fish_oil": 0, "dessert": False, "vinegar": True,
     "tags": {"beef": .9, "char": .7}, "cuisine": ["korean"]},
    {"id": "edge-dessert", "name": "Десерт", "vector": {"sweet": .9, "fat": .6, "cream": .7, "bitter": .3}, "is_dessert": True,
     "tags": {"chocolate": .8, "cocoa": .6, "coffee": .9, "red_fruit": .5, "cherry": .6, "dairy_cream": .7}, "cuisine": "french"},
    {"id": "edge-fish", "name": "Рыба", "vector": {"salt": .5, "fat": .6, "protein": .8, "fresh": .7, "fish_oil": .7, "weight": None},
     "protein_source": "white_fish", "sauce": "cream", "acid_type": "citrus", "cook_method": "steamed",
     "tags": ["fish", "citrus", "herbal"]},
    {"id": "edge-cured", "name": "Вяленое", "vector": {"salt": .9, "umami": .7, "fat": .5, "protein": .8, "smoke": .6, "maillard": .3},
     "cook_method": "cured", "protein_source": "horse",
     "tags": {"cured": 1, "smoke": .8, "yeast": .5, "bread": .5, "caramel": .5, "toast": .5, "biscuit": .5, "grain": .5,
              "nutty": .5, "honey": .5}},
    {"id": "edge-cheese", "name": "Сыр", "vector": {"salt": .8, "umami": .8, "fat": .8, "protein": .7, "sour": .3},
     "protein_source": "cheese_hard", "sauce": "none", "acid_type": "lactic", "tags": {"nutty": .6, "caramel": .5, "cheese": .9}},
    {"id": "edge-chili", "name": "Чили",
     "vector": {"heat": .8, "salt": .6, "fat": .5, "sour": .4, "sweet": .4, "umami": .5, "protein": .6, "weight": .6},
     "sauce": "chili", "tags": {"pepper": .7, "tomato": .6, "chicken": .8, "fried": .6}, "cook_method": "fried"},
    {"id": "edge-soy", "name": "Соя", "vector": {"salt": .7, "umami": .9, "sour": .1}, "sauce": "soy",
     "tags": {"rice": .8, "brine": .6, "yeast": .5}},
    {"id": "edge-bare", "name": None, "display_name": "", "vector": "not-a-dict", "salt": .4, "fat": .2, "tags": {},
     "cuisine": [], "sauce": "broth"},
    {"id": "edge-null-dessert", "name": "Неявный десерт", "is_dessert": None, "dessert": True, "vector": {"sweet": .8, "fat": .4}},
    {"id": "edge-green", "name": "Зелень", "vector": {"green_iron": .8, "fresh": .6, "bitter": .6, "sour": .3},
     "protein_source": "legume", "tags": {"grass": .7, "herbal": .6, "beans": .8}, "cook_method": "grilled"},
]
_EDGE_CLASSICS: List[Dict[str, Any]] = [
    {"dish": "edge-cured", "drink": "peated_whisky", "bonus": 5, "label": "мой список", "source": "строка-источник"},
    {"dish": "edge-cheese", "drink": "edge-ties", "bonus": None, "label": "метка", "source": None},
    {"dish": "edge-fish", "drink": "edge-override", "bonus": 12, "source": {"title": None}},
    {"dish": "edge-dessert", "drink": "edge-hot-tea", "source": {"title": "чайная традиция"}},
]


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
            sig = _sig(E.score_pair(arch_prof[aid], dish_prof[did], {}, P, cidx, explain=True))
            matrix.append([aid, did, r["score"], r["core"], r["match_type"], r["secondary_type"], r["vetoes"], sig])

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
        # слой калибровки: вложенный частичный override (массив заменяется целиком, подписи — из params) и смешанный с путями
        ("czech_dark", "beshbarmak", {}, {"R2": {"scale": 25}, "R12": {"k": 6, "exclude_tags": ["fresh", "fizz"]},
                                          "labels": {"tags": {"bread": "хлебные ноты"}}}),
        ("czech_dark", "beshbarmak", {"occasion": "meal"}, {"score": {"base": 44}, "R13.points": 5,
                                                            "R1.texts.join": "{loudness} / {weight}"}),
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
    # диверсификация (§5.4), чтобы golden покрывал _diversify целиком (данные меняются — выбор автоматический):
    # 1) венью только из двух семейств (LAGER + IPA, иначе два самых частых) → групповой лимит и добор без лимита (шаг 3);
    # 2) первые блюда, где гарантия безалкогольной / не-пивной позиции меняет топ-n (сравнение с тем же пулом, но
    #    categories = все категории пула: фильтра нет, а гарантии выключены).
    def _fam(x: Dict[str, Any]) -> str:
        return str((x.get("style") or {}).get("family") or x.get("family") or x.get("category"))
    fam_n: Dict[str, int] = {}
    for x in pool_raw:
        fam_n[_fam(x)] = fam_n.get(_fam(x), 0) + 1
    two_fams = [f for f in ("LAGER", "IPA") if f in fam_n]
    if len(two_fams) < 2:
        two_fams = sorted(fam_n, key=lambda f: -fam_n[f])[:2]
    venue2 = [i for f in two_fams for i in [x["id"] for x in pool_raw if _fam(x) == f][:6]]
    if dish_ids:
        rec_specs += [(dish_ids[0], {}, 5, None, venue2), (dish_ids[0], {}, 8, None, venue2)]
    all_cats = sorted({b["category"] for b in pool})
    na_ids = {b["id"] for b in pool if b["non_alcoholic_flag"]}
    na_max = P["recommend"]["diversify"]["na_max_abv"]
    found: Dict[Any, str] = {}
    for n in (5, 3):
        for did in dish_ids:
            if ("na", n) in found and ("nonbeer", n) in found:
                break
            got = E.recommend(dish_prof[did], pool, {}, n, P, cidx, explain=False)["items"]
            plain = {r["drink_id"] for r in E.recommend(dish_prof[did], pool, {}, n, P, cidx, categories=all_cats,
                                                        explain=False)["items"]}
            for r in got:
                if r["drink_id"] not in plain:
                    kind = "na" if (r["drink_id"] in na_ids or r["abv"] <= na_max) else "nonbeer"
                    found.setdefault((kind, n), did)
    for (kind, n), did in sorted(found.items()):
        rec_specs.append((did, {}, n, None, None))
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

    # ── edge: синтетические записи (_EDGE_*) — профили целиком, пары с сигнатурами, выдача с неизвестными категориями,
    #    DNA с векторами/пустыми оценками, partner_order на заданных баллах. Классика = classics + _EDGE_CLASSICS.
    edge_b = [E.drink_vector(x, P) for x in _EDGE_DRINKS]
    edge_d = [E.dish_vector(x, P) for x in _EDGE_DISHES]
    edge_classics = list(classics_list) + _EDGE_CLASSICS
    ecidx = E.index_classics(edge_classics)
    edge_profiles: Dict[str, Dict[str, Any]] = {"drinks": {}, "dishes": {}}
    for p in edge_b:
        dv = E.derived(p, None, P)
        edge_profiles["drinks"][p["id"]] = dict(_profile_out(p), W_B=E.r2(dv["W_B"]), F_B=E.r2(dv["F_B"]))
    for p in edge_d:
        dv = E.derived(None, p, P)
        edge_profiles["dishes"][p["id"]] = dict(_profile_out(p), W_D=E.r2(dv["W_D"]), F_D=E.r2(dv["F_D"]))
    ectxs = [{}, {"occasion": "dessert", "temperature_perception": True},
             {"heat_lover": True, "harsh_tol": 0.8, "bitter_pref": 0.6}, {"non_alcoholic": True, "sweet_pref": -0.4},
             {"occasion": "meal", "harsh_tol": "tolerant", **({"dna": dna} if dna else {})}]
    real_d = [dish_prof[i] for i in dish_ids[::10]]
    real_b = [arch_prof[x["id"]] for x in arch_raw[::11]]
    combos = [(b, d) for b in edge_b for d in edge_d + real_d] + [(b, d) for b in real_b for d in edge_d]
    edge_pairs = []
    for k, (b, d) in enumerate(combos):
        for ci in sorted({0, 1 + k % (len(ectxs) - 1)}):
            r = E.score_pair(b, d, ectxs[ci], P, ecidx, explain=True)
            edge_pairs.append([b["id"], d["id"], ci, r["score"], r["core"], r["match_type"], r["secondary_type"],
                               r["vetoes"], _sig(r)])
    epool = pool + edge_b
    edge_dish = {p["id"]: p for p in edge_d}
    edge_rec = []
    for did, ctx, n in (("edge-dessert", {}, 8), ("edge-dessert", {"non_alcoholic": True}, 5), ("edge-cured", {}, 5)):
        res = E.recommend(edge_dish[did], epool, ctx, n, P, edge_classics, explain=False)
        bp = res["best_partner"]
        edge_rec.append({"dish": did, "ctx": ctx, "top_n": n, "items": _slim_list(res["items"]),
                         "best_partner": {"drink_id": bp["drink_id"], "score": bp["score"]} if bp else None,
                         "excluded_non_alcoholic": res["excluded_non_alcoholic"], "n_candidates": res["n_candidates"],
                         "policy": res["policy"]})
    edge_cat = []
    for did, ctx in (("edge-dessert", {}), ("edge-cheese", {"occasion": "gourmet"})):
        res = E.by_category(edge_dish[did], epool, ctx, P, ecidx, per_category=2, explain=False)
        edge_cat.append({"dish": did, "ctx": ctx, "per_category": 2,
                         "categories": [{"category": c["category"], "label": c["label"], "n": c["n"],
                                         "items": _slim_list(c["items"])} for c in res["categories"]]})
    edge_rev = []
    for bid, ctx in (("edge-hot-tea", {}), ("edge-roasted-dry", {"occasion": "dessert"}), ("edge-dilution", {"non_alcoholic": True})):
        b = next(p for p in edge_b if p["id"] == bid)
        res = E.reverse(b, edge_d + real_d, ctx, 0, P, edge_classics, explain=False)
        edge_rev.append({"drink": bid, "ctx": ctx, "top_n": 0, "excluded": res["excluded"],
                         "items": [{"dish_id": r["dish_id"], "score": r["score"]} for r in res["items"]]})
    edge_raw = {x["id"]: x for x in _EDGE_DRINKS}
    dna_specs = [
        [{"drink": "edge-override", "rating": "love"}, {"drink": "edge-mead", "rating": "dislike"},
         {"vector": {"sweet": .3, "bitter": None, "roast": .9}, "rating": "like"}],
        [{"drink": "edge-na-beer", "rating": "meh"}, {"drink": "edge-proto", "rating": None},
         {"drink": "edge-ties", "rating": "unknown"}],
        [{"vector": {"sweet": 1.2, "acid": -0.5, "carbonation": .4}, "rating": "love"}, {"drink": "edge-hot-tea", "rating": "like"}],
    ]
    edge_dna = [{"rated": spec, "result": E.dna_vector([dict(x, drink=edge_raw[x["drink"]]) if "drink" in x else x
                                                        for x in spec], P)} for spec in dna_specs]
    fake = [{"drink_id": f"p{i:02d}", "score": s, "efes_partner": e} for i, (s, e) in enumerate(
        [(80, False), (79, True), (79, False), (78, True), (75, False), (74, True), (74, True), (70, False), (69, True), (60, False)])]
    edge_partner = {"results": fake, "best_partner": (E.best_partner(fake) or {}).get("drink_id"),
                    "orders": [{"window": w, "order": [r["drink_id"] for r in E.partner_order(fake, P, w)]}
                               for w in (None, 0, 1, 2, 5)]}
    edge = {
        "_doc": "Синтетические записи (не каталог): ветки нормализации, горячий контраст R4 / roast_exempt V2, неизвестные "
                "категории, классика со строковым источником. pairs: [drink, dish, индекс ctxs, score, core, match_type, "
                "secondary_type, vetoes, sig]; recommend/by_category — пул recommend_pool + drinks; классика — "
                "inputs.classics + classics.",
        "drinks": _EDGE_DRINKS, "dishes": _EDGE_DISHES, "classics": _EDGE_CLASSICS, "ctxs": ectxs,
        "real_dishes": [p["id"] for p in real_d], "real_drinks": [p["id"] for p in real_b],
        "profiles": edge_profiles, "pairs": edge_pairs, "recommend": edge_rec, "by_category": edge_cat,
        "reverse": edge_rev, "dna": edge_dna, "partner": edge_partner,
    }

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
                "reverse и помощники. matrix.sig — sha1 полного результата с текстами (см. _sig), edge — синтетические "
                "записи для веток нормализации. Регенерация: python3 scripts/engine_eval_v2.py. "
                "Проверка: cd frontend && npm run test:engine2.",
        "params": P,
        "inputs": {"archetypes": arch_raw, "dishes": dish_raw, "recommend_pool": pool_raw, "classics": classics_list},
        "helpers": helpers,
        "profiles": profiles,
        "matrix_fields": ["drink", "dish", "score", "core", "match_type", "secondary_type", "vetoes", "sig"],
        "matrix": matrix,
        "cases": cases,
        "recommend": recs,
        "by_category": cats_out,
        "reverse": revs,
        "edge": edge,
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
