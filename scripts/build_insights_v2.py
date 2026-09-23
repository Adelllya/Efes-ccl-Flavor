#!/usr/bin/env python3
"""«Радар портфеля Efes» + «Карта вкусов»: data/insights_v2.json из честного движка v2.

Что считает (только stdlib, детерминированно — два запуска дают одинаковые байты):
  a) по каждому блюду: лучший напиток вообще и лучший напиток Efes, отставание (gap), место Efes в рейтинге,
     статус leads / tie / close / behind, топ-3;
  b) агрегаты: по статусу, по кухне, по категории блюда, по SKU Efes (кто «несёт» портфель), по категориям
     конкурентов (кому уходят блюда);
  c) пробелы портфеля (контрфактуал): каждый архетип из data/style_priors_v2.json (+ предложенные) добавляется
     в пул как гипотетический сорт Efes = профиль стиля, считается, сколько блюд перешло бы в leads/tie;
  d) карта вкусов: PCA по 13 осям вкуса (без serve_temp) для всех напитков каталога — x, y, нагрузки, дисперсия;
  e) meta: версии движка и калибровки, счётчики, оговорки.

ВАЖНО: статистика считается по честному рейтингу — сортировка (−балл, id) — а не по partner_order (окно ±2
политики Efes — правило показа, а не баллов). Баллы берутся из engine_v2.score_pair как есть; здесь нет ни
одной формулы оценки пары.

Запуск:  python3 scripts/build_insights_v2.py [--out data/insights_v2.json] [--quiet]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from api.pairing import engine_v2 as E  # noqa: E402
from api.pairing.dataset_v2 import FILES, get_dataset  # noqa: E402

OUT_DEFAULT = ROOT / "data" / "insights_v2.json"
INPUT_FILES = ("drinks", "styles", "dishes", "classics", "params", "calibration", "proposed_archetypes")

STATUSES: Tuple[str, ...] = ("leads", "tie", "close", "behind")
CLOSE_MAX = 5                       # «близко»: отставание ≤ 5 баллов
REALISTIC = ("beer", "na_beer", "radler", "cider", "kvass")   # стили, которые может варить пивовар
BEER_CATEGORIES = ("beer", "na_beer", "radler")                # «пивной портфель Efes» без напитков CCI
TOP_GAP_DISHES_REALISTIC = 8        # для скольких лучших архетипов перечислять приобретаемые блюда
TOP_GAP_DISHES_OTHER = 5
POWER_ITERATIONS = 400              # степенной метод: с запасом для 13×13

# категории напитков → группа карты вкусов (3 цветовых серии + «прочее»)
MAP_GROUPS: Dict[str, str] = {
    "beer": "beer", "na_beer": "beer", "radler": "beer",
    "wine": "wine", "sparkling": "wine", "fortified": "wine", "cider": "wine",
    "cocktail": "strong", "spirit": "strong", "liqueur": "strong",
}
AXES_RU: Dict[str, str] = {
    "sweet": "сладость", "acid": "кислотность", "bitter": "горечь", "tannin": "танины", "carbonation": "газация",
    "alcohol": "крепость", "body": "тело", "dairy": "молочность", "salt": "соль", "umami": "умами",
    "aroma_intensity": "яркость аромата", "roast": "обжарка", "smoke": "дым",
}


# ─────────────────────────────────────────────────────────────────────────────
# помощники
# ─────────────────────────────────────────────────────────────────────────────
def status_of(gap: int, window: float) -> str:
    if gap <= 0:
        return "leads"
    if gap <= window:
        return "tie"
    if gap <= CLOSE_MAX:
        return "close"
    return "behind"


def r2(x: float) -> float:
    return math.floor(x * 100 + 0.5) / 100


def r4(x: float) -> float:
    return math.floor(x * 10000 + 0.5) / 10000


def hex2(score: int) -> str:
    return "%02x" % max(0, min(255, int(score)))


def label_of(raw: Dict[str, Any], fallback: str) -> str:
    return raw.get("label_ru") or raw.get("name") or fallback


# ─────────────────────────────────────────────────────────────────────────────
# a) + b): статусы по блюдам и агрегаты
# ─────────────────────────────────────────────────────────────────────────────
def score_all(ds, pool: Sequence[Dict[str, Any]], ctx: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """{dish_id: [результаты score_pair в порядке пула]} — без текстов (explain=False), баллы те же."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    for d in ds.dish_profiles:
        out[d["id"]] = [E.score_pair(b, d, ctx, ds.params, ds.classic_index, explain=False) for b in pool]
    return out


def dish_summary(ds, dish: Dict[str, Any], results: List[Dict[str, Any]], window: float,
                 raw_dish: Dict[str, Any]) -> Dict[str, Any]:
    ranked = sorted(results, key=lambda r: (-r["score"], r["drink_id"]))
    best = ranked[0]
    best_efes = None
    for r in ranked:
        if r["efes_partner"]:
            best_efes = r
            break
    if best_efes is None:   # в пуле нет Efes — не наш случай, но не падаем
        best_efes = {"drink_id": None, "score": 0, "category": None, "archetype": None, "drink_name": None}
    # только пиво Efes (own | distribution; без напитков CCI) — «что закрывает пивной портфель сам по себе»
    best_beer = None
    for r in ranked:
        if r["efes_partner"] and r["category"] in BEER_CATEGORIES:
            best_beer = r
            break
    if best_beer is None:
        best_beer = {"drink_id": None, "score": 0, "category": None, "archetype": None, "drink_name": None}
    gap = int(best["score"] - best_efes["score"])
    gap_beer = int(best["score"] - best_beer["score"])
    rank = 1 + len([r for r in results if r["score"] > best_efes["score"]])
    st = status_of(gap, window)
    top3 = [{"id": r["drink_id"], "score": r["score"], "category": r["category"], "efes": bool(r["efes_partner"])}
            for r in ranked[:3]]
    n_top = len([r for r in results if r["score"] == best["score"]])
    n_efes_top = len([r for r in results if r["score"] == best["score"] and r["efes_partner"]])
    return {
        "id": dish["id"], "name": dish["name"], "cuisine": list(dish["cuisine"]),
        "category": raw_dish.get("category"), "emoji": raw_dish.get("emoji"),
        "is_dessert": bool(dish["is_dessert"]),
        # имена напитков — по id из map.drinks (там все 412)
        "best": {"id": best["drink_id"], "score": best["score"], "category": best["category"],
                 "archetype": best["archetype"], "efes": bool(best["efes_partner"])},
        "best_efes": {"id": best_efes["drink_id"], "score": best_efes["score"], "category": best_efes["category"],
                      "archetype": best_efes["archetype"]},
        "gap": gap, "efes_rank": rank, "n_at_top": n_top, "n_efes_at_top": n_efes_top,
        "status": st,
        "beer": {"id": best_beer["drink_id"], "score": best_beer["score"], "archetype": best_beer["archetype"],
                 "gap": gap_beer, "status": status_of(gap_beer, window)},
        "top3": top3,
        # служебные поля для агрегатов (в JSON не пишутся)
        "_best_name": best["drink_name"],
    }


def aggregate(ds, dishes: List[Dict[str, Any]], pool: Sequence[Dict[str, Any]],
              scored: Dict[str, List[Dict[str, Any]]], efes_raw_by_id: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    by_status = {s: len([d for d in dishes if d["status"] == s]) for s in STATUSES}
    by_status_beer = {s: len([d for d in dishes if d["beer"]["status"] == s]) for s in STATUSES}

    def bucket(keyf, keep_dishes: bool) -> List[Dict[str, Any]]:
        acc: Dict[str, Dict[str, Any]] = {}
        for d in dishes:
            for k in keyf(d):
                row = acc.setdefault(k, {"id": k, "n": 0, **{s: 0 for s in STATUSES}, "beer_covered": 0, "dishes": []})
                row["n"] += 1
                row[d["status"]] += 1
                if d["beer"]["status"] in ("leads", "tie"):
                    row["beer_covered"] += 1
                row["dishes"].append(d["id"])
        rows = list(acc.values())
        for r in rows:
            ids = set(r["dishes"])
            r["covered"] = r["leads"] + r["tie"]
            r["mean_gap"] = r2(sum(dd["gap"] for dd in dishes if dd["id"] in ids) / r["n"])
            if not keep_dishes:
                del r["dishes"]
        rows.sort(key=lambda r: (-r["n"], r["id"]))
        return rows

    by_cuisine = bucket(lambda d: d["cuisine"] or ["unknown"], keep_dishes=True)
    by_dish_category = bucket(lambda d: [d["category"] or "—"], keep_dishes=False)

    # SKU Efes: для скольких блюд это лучший вариант Efes; для скольких — лучший вообще (ничьи считаются); топ-3
    sku: Dict[str, Dict[str, Any]] = {}
    for b in pool:
        if not E.is_efes_relation(b["efes_relation"], ds.params):
            continue
        raw = efes_raw_by_id.get(b["id"], {})
        sku[b["id"]] = {"id": b["id"], "name": b["name"], "category": b["category"], "archetype": b["archetype"],
                        "relation": b["efes_relation"], "producer": (raw.get("producer") or {}).get("name"),
                        "best_efes_for": 0, "leads_for": 0, "top3_for": 0, "mean_score": 0.0,
                        "best_efes_dishes": []}
    for d in dishes:
        bid = d["best_efes"]["id"]
        if bid in sku:
            sku[bid]["best_efes_for"] += 1
            sku[bid]["best_efes_dishes"].append(d["id"])
        top = d["best"]["score"]
        for r in scored[d["id"]]:
            if r["drink_id"] in sku:
                s = sku[r["drink_id"]]
                s["mean_score"] += r["score"]
                if r["score"] == top:
                    s["leads_for"] += 1
        for t in d["top3"]:
            if t["id"] in sku:
                sku[t["id"]]["top3_for"] += 1
    n_d = len(dishes)
    for s in sku.values():
        s["mean_score"] = r2(s["mean_score"] / n_d) if n_d else 0.0
    efes_skus = sorted(sku.values(), key=lambda s: (-s["best_efes_for"], -s["leads_for"], -s["mean_score"], s["id"]))

    # категории конкурентов: чья категория/архетип берёт блюдо, когда Efes не первый (и отдельно — когда отстаёт > 5)
    comp: Dict[str, Dict[str, Any]] = {}
    for d in dishes:
        if d["status"] == "leads":
            continue
        w = d["best"]
        row = comp.setdefault(w["category"], {"category": w["category"], "group": MAP_GROUPS.get(w["category"], "other"),
                                              "n": 0, "tie": 0, "close": 0, "behind": 0, "archetypes": {}, "dishes": []})
        row["n"] += 1
        row[d["status"]] += 1
        row["archetypes"][w["archetype"]] = row["archetypes"].get(w["archetype"], 0) + 1
        row["dishes"].append(d["id"])
    competitors = []
    for row in comp.values():
        arch = sorted(row["archetypes"].items(), key=lambda kv: (-kv[1], kv[0]))
        row["archetypes"] = [{"archetype": a, "n": n, "label_ru": label_of(ds.archetype_raw_by_id.get(a, {}), a)} for a, n in arch[:5]]
        competitors.append(row)
    competitors.sort(key=lambda r: (-r["n"], -r["behind"], r["category"]))

    # и то же по группам карты (beer / wine / strong / other): «другое пиво» — важный отдельный ответ
    groups: Dict[str, Dict[str, int]] = {}
    for row in competitors:
        g = groups.setdefault(row["group"], {"group": row["group"], "n": 0, "tie": 0, "close": 0, "behind": 0})
        for k in ("n", "tie", "close", "behind"):
            g[k] += row[k]
    competitor_groups = sorted(groups.values(), key=lambda g: (-g["n"], g["group"]))

    return {
        "by_status": by_status,
        "by_status_beer": by_status_beer,
        "by_cuisine": by_cuisine,
        "by_dish_category": by_dish_category,
        "efes_skus": efes_skus,
        "competitors": competitors,
        "competitor_groups": competitor_groups,
        "mean_gap": r2(sum(d["gap"] for d in dishes) / n_d) if n_d else 0.0,
        "mean_best_score": r2(sum(d["best"]["score"] for d in dishes) / n_d) if n_d else 0.0,
        "mean_best_efes_score": r2(sum(d["best_efes"]["score"] for d in dishes) / n_d) if n_d else 0.0,
    }


# ─────────────────────────────────────────────────────────────────────────────
# c) пробелы портфеля — контрфактуал по архетипам
# ─────────────────────────────────────────────────────────────────────────────
def portfolio_gaps(ds, dishes: List[Dict[str, Any]], ctx: Dict[str, Any], window: float,
                   efes_archetypes: Dict[str, List[str]]) -> Dict[str, Any]:
    dish_by_id = {d["id"]: d for d in dishes}
    candidates: List[Tuple[str, Dict[str, Any], Dict[str, Any], bool]] = []
    for raw in ds.archetypes:
        candidates.append((raw["id"], ds.archetype_by_id[raw["id"]], raw, False))
    for raw in ds.proposed_archetypes:
        if raw["id"] in ds.archetype_by_id:
            continue
        candidates.append((raw["id"], E.drink_vector(raw, ds.params), raw, True))
    candidates.sort(key=lambda c: c[0])

    rows: List[Dict[str, Any]] = []
    for aid, prof, raw, proposed in candidates:
        hyp = dict(prof)
        hyp["id"] = "hyp-" + aid
        hyp["efes_relation"] = "own"
        hyp["name"] = "Гипотетический сорт Efes: " + label_of(raw, aid)
        gained: List[Dict[str, Any]] = []
        gained_leads = 0
        gap_sum_old = 0
        gap_sum_new = 0
        new_status_counts = {s: 0 for s in STATUSES}
        for d in ds.dish_profiles:
            info = dish_by_id[d["id"]]
            s = E.score_pair(hyp, d, ctx, ds.params, ds.classic_index, explain=False)["score"]
            old_best, old_efes, old_gap = info["best"]["score"], info["best_efes"]["score"], info["gap"]
            new_efes = max(old_efes, s)
            new_best = max(old_best, s)
            new_gap = int(new_best - new_efes)
            new_st = status_of(new_gap, window)
            new_status_counts[new_st] += 1
            gap_sum_old += old_gap
            gap_sum_new += new_gap
            if new_st in ("leads", "tie") and info["status"] not in ("leads", "tie"):
                gained.append({"id": d["id"], "score": s, "was": info["status"], "now": new_st,
                               "old_gap": old_gap, "new_gap": new_gap})
                if new_st == "leads":
                    gained_leads += 1
        n_d = len(dishes)
        rows.append({
            "archetype": aid, "label_ru": label_of(raw, aid), "category": raw.get("category"),
            "abv": raw.get("abv"), "ibu": raw.get("ibu"),
            "realistic": raw.get("category") in REALISTIC,
            "proposed": proposed,
            "in_portfolio": efes_archetypes.get(aid, []),
            "dishes_gained": len(gained), "gained_leads": gained_leads, "gained_tie": len(gained) - gained_leads,
            "avg_gap_reduction": r2((gap_sum_old - gap_sum_new) / n_d) if n_d else 0.0,
            "new_by_status": new_status_counts,
            "dishes": sorted(gained, key=lambda g: (g["new_gap"], -g["score"], g["id"])),
        })
    rows.sort(key=lambda r: (-r["dishes_gained"], -r["avg_gap_reduction"], r["archetype"]))
    realistic = [r for r in rows if r["realistic"]]
    beyond = [r for r in rows if not r["realistic"]]
    for i, r in enumerate(realistic):
        if i >= TOP_GAP_DISHES_REALISTIC:
            r["dishes"] = []
            del r["new_by_status"]
    for i, r in enumerate(beyond):
        if i >= TOP_GAP_DISHES_OTHER:
            r["dishes"] = []
            del r["new_by_status"]
    return {
        "note_ru": "Контрфактуал: в пул добавляется гипотетический сорт Efes = профиль стиля из style_priors_v2 "
                   "(BJCP/литературный приор), не реальный продукт. Считается тем же движком с теми же параметрами; "
                   "цена, логистика, ёмкость рынка и вкус конкретной рецептуры не учитываются.",
        "realistic_categories": list(REALISTIC),
        "realistic": realistic,
        "beyond_brewing": beyond,
        "n_candidates": len(rows),
    }


# ─────────────────────────────────────────────────────────────────────────────
# d) карта вкусов — PCA степенным методом
# ─────────────────────────────────────────────────────────────────────────────
def pca_2d(X: List[List[float]]) -> Dict[str, Any]:
    n, m = len(X), len(X[0])
    means = [sum(row[j] for row in X) / n for j in range(m)]
    stds = []
    for j in range(m):
        var = sum((row[j] - means[j]) ** 2 for row in X) / n
        s = math.sqrt(var)
        stds.append(s if s > 1e-12 else 1.0)
    Z = [[(row[j] - means[j]) / stds[j] for j in range(m)] for row in X]
    cov = [[sum(Z[i][a] * Z[i][b] for i in range(n)) / (n - 1) for b in range(m)] for a in range(m)]
    trace = sum(cov[j][j] for j in range(m))

    def power(C: List[List[float]]) -> Tuple[List[float], float]:
        v = [1.0 / math.sqrt(m)] * m
        for _ in range(POWER_ITERATIONS):
            w = [sum(C[a][b] * v[b] for b in range(m)) for a in range(m)]
            norm = math.sqrt(sum(x * x for x in w))
            if norm < 1e-15:
                break
            v = [x / norm for x in w]
        lam = sum(v[a] * sum(C[a][b] * v[b] for b in range(m)) for a in range(m))
        # знак: компонента с наибольшей |нагрузкой| положительна — метки направлений стабильны
        k = max(range(m), key=lambda j: (abs(v[j]), -j))
        if v[k] < 0:
            v = [-x for x in v]
        return v, lam

    v1, l1 = power(cov)
    cov2 = [[cov[a][b] - l1 * v1[a] * v1[b] for b in range(m)] for a in range(m)]
    v2, l2 = power(cov2)
    xs = [sum(Z[i][j] * v1[j] for j in range(m)) for i in range(n)]
    ys = [sum(Z[i][j] * v2[j] for j in range(m)) for i in range(n)]
    return {"loadings": [v1, v2], "explained": [l1 / trace, l2 / trace], "x": xs, "y": ys,
            "means": means, "stds": stds}


def flavor_map(ds, pool_ids: List[str]) -> Dict[str, Any]:
    axes = [a for a in ds.params["axes"]["drink"] if a != "serve_temp"]
    profiles = ds.drink_profiles
    X = [[float(p["v"][a]) for a in axes] for p in profiles]
    pca = pca_2d(X)
    pool_index = {pid: i for i, pid in enumerate(pool_ids)}
    drinks = []
    for i, p in enumerate(profiles):
        drinks.append({
            "id": p["id"], "name": p["name"], "category": p["category"], "group": MAP_GROUPS.get(p["category"], "other"),
            "archetype": p["archetype"], "efes": E.is_efes_relation(p["efes_relation"], ds.params), "abv": p["abv"],
            "x": r4(pca["x"][i]), "y": r4(pca["y"][i]),
            "pool": pool_index.get(p["id"], -1),   # −1: не в пуле подбора (черновик / наличие не подтверждено)
        })

    def directions(v: List[float]) -> Dict[str, List[str]]:
        order = sorted(range(len(axes)), key=lambda j: (-abs(v[j]), j))
        pos = [axes[j] for j in order if v[j] > 0.2][:3]
        neg = [axes[j] for j in order if v[j] < -0.2][:3]
        return {"pos": pos, "neg": neg}

    def pct(values: List[float], q: float) -> float:
        s = sorted(values)
        return s[min(len(s) - 1, int(q * (len(s) - 1)))]

    # робастные границы (x: 2–98-й процентили, y: 2–95-й — PC2 сильно скошена): кисломолочные и «кровавая мэри» уходят далеко по PC2 —
    # карта прижимает их к рамке и помечает, иначе 400 точек сжимаются в угол
    rb = {"x": [r4(pct(pca["x"], 0.02)), r4(pct(pca["x"], 0.98))], "y": [r4(pct(pca["y"], 0.02)), r4(pct(pca["y"], 0.95))]}
    n_outside = len([d for d in drinks if not (rb["x"][0] <= d["x"] <= rb["x"][1] and rb["y"][0] <= d["y"] <= rb["y"][1])])

    return {
        "axes": axes, "axes_ru": {a: AXES_RU.get(a, a) for a in axes},
        "method_ru": "PCA: оси стандартизованы (z-score), ковариационная матрица 13×13, две первые компоненты "
                     "степенным методом с дефляцией; знак компоненты — так, чтобы её сильнейшая нагрузка была положительной.",
        "explained": [r4(pca["explained"][0]), r4(pca["explained"][1])],
        "loadings": {"pc1": {a: r4(pca["loadings"][0][j]) for j, a in enumerate(axes)},
                     "pc2": {a: r4(pca["loadings"][1][j]) for j, a in enumerate(axes)}},
        "directions": {"pc1": directions(pca["loadings"][0]), "pc2": directions(pca["loadings"][1])},
        "bounds": {"x": [r4(min(pca["x"])), r4(max(pca["x"]))], "y": [r4(min(pca["y"])), r4(max(pca["y"]))]},
        "bounds_robust": rb, "n_outside_robust": n_outside,
        "groups": {"beer": ["beer", "na_beer", "radler"], "wine": ["wine", "sparkling", "fortified", "cider"],
                   "strong": ["cocktail", "spirit", "liqueur"],
                   "other": ["kvass", "lemonade", "soda", "dairy", "tea", "coffee", "water"]},
        "drinks": drinks,
    }


# ─────────────────────────────────────────────────────────────────────────────
# сборка
# ─────────────────────────────────────────────────────────────────────────────
def inputs_fingerprint() -> Tuple[str, str]:
    """sha256 входных файлов + ISO-время последнего изменения (детерминированная «дата сборки»)."""
    h = hashlib.sha256()
    newest = 0.0
    for key in INPUT_FILES:
        p = ROOT / "data" / FILES[key]
        if not p.exists():
            h.update(b"missing:" + key.encode())
            continue
        h.update(key.encode() + b":" + p.read_bytes())
        newest = max(newest, p.stat().st_mtime)
    stamp = datetime.fromtimestamp(newest, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return h.hexdigest()[:16], stamp


def build(quiet: bool = False) -> Dict[str, Any]:
    ds = get_dataset()
    P = ds.params
    window = float(P["recommend"]["partner_tie_window"])
    pool = list(ds.guest_drink_profiles)
    pool_ids = [b["id"] for b in pool]
    efes_pool = [b for b in pool if E.is_efes_relation(b["efes_relation"], P)]
    efes_raw_by_id = {b["id"]: ds.drink_raw_by_id[b["id"]] for b in efes_pool}
    efes_archetypes: Dict[str, List[str]] = {}
    for b in efes_pool:
        efes_archetypes.setdefault(b["archetype"], []).append(b["id"])
    for v in efes_archetypes.values():
        v.sort()

    ctx: Dict[str, Any] = {}
    scored = score_all(ds, pool, ctx)
    dishes = [dish_summary(ds, d, scored[d["id"]], window, ds.dish_raw_by_id[d["id"]]) for d in ds.dish_profiles]
    dishes.sort(key=lambda d: (STATUSES.index(d["status"]), d["gap"], d["id"]))
    agg = aggregate(ds, dishes, pool, scored, efes_raw_by_id)
    gaps = portfolio_gaps(ds, dishes, ctx, window, efes_archetypes)
    fmap = flavor_map(ds, pool_ids)

    # второй проход: повод «трапеза» — только статусы
    ctx_meal = {"occasion": "meal"}
    scored_meal = score_all(ds, pool, ctx_meal)
    dishes_meal = [dish_summary(ds, d, scored_meal[d["id"]], window, ds.dish_raw_by_id[d["id"]]) for d in ds.dish_profiles]
    meal = {
        "ctx": ctx_meal,
        "by_status": {s: len([d for d in dishes_meal if d["status"] == s]) for s in STATUSES},
        "status_by_dish": {d["id"]: d["status"] for d in sorted(dishes_meal, key=lambda d: d["id"])},
        "mean_gap": r2(sum(d["gap"] for d in dishes_meal) / len(dishes_meal)) if dishes_meal else 0.0,
    }

    # матрица баллов: по 2 hex-символа на напиток пула (порядок pool) — для перекраски карты по блюду
    scores = {d["id"]: "".join(hex2(r["score"]) for r in scored[d["id"]]) for d in sorted(dishes, key=lambda d: d["id"])}

    fp, stamp = inputs_fingerprint()
    cal = ds.calibration
    caveats = [
        "Балл — модель движка v2 (правила из литературы по гастропарам + слой калибровки), не результат дегустации. "
        "Профили напитков — приоры стилей и данные этикеток; у большинства позиций уверенность профиля ниже 0.5.",
        f"Статусы считаются по честному рейтингу (сортировка по баллу, при равенстве — по id), без окна ±{E.fmt_num(window)} "
        f"политики Efes. «Ничья» = отставание 1–{E.fmt_num(window)} балла — то же окно, в котором подбор показывает Efes выше "
        "не-Efes; «близко» — до 5 баллов; «отстаёт» — больше 5.",
        "Гипотетические сорта в разделе пробелов — профиль стиля (BJCP-приор), а не реальный продукт: реальный сорт может "
        "отличаться от приора; цены, логистика, ёмкость рынка и каннибализация не учитываются.",
        "Контекст подбора пустой (без повода и личных предпочтений); отдельно приведена прикидка для повода «трапеза».",
        "Карта вкусов — PCA по 13 осям без температуры подачи; две компоненты объясняют "
        f"{round(100 * (fmap['explained'][0] + fmap['explained'][1]))} % дисперсии, близость на карте ≠ одинаковый балл к блюду.",
        f"Блюд {len(dishes)}, из них казахской кухни {len([d for d in dishes if 'kazakh' in d['cuisine']])}; веса кухонь "
        "в меню реальных заведений другие — считайте статистику по своему меню через кабинет.",
        f"«Конкуренты» — категории напитков из каталога ({len(ds.drinks)} позиций, доступных в Казахстане), а не бренды "
        "по доле рынка; крепкое и коктейли выигрывают по модели вкуса, а не по частоте заказа с едой.",
        "Позиции Efes в пуле: собственные бренды, дистрибуция и напитки CCI (efes_relation own | distribution | cci) — "
        "как в политике подбора.",
    ]
    meta = {
        "title_ru": "Радар портфеля Efes",
        "engine_version": E.ENGINE_VERSION,
        "params_version": P.get("version"),
        "calibration": ({k: v for k, v in cal.items() if k in ("version", "fitted_at", "metrics", "data", "lambda")}
                        if cal else None),
        "calibration_applied": bool(cal),
        "generated_at": stamp,
        "generated_at_note": "время последнего изменения входных файлов (сборка детерминирована, часы не используются)",
        "inputs_sha256_16": fp,
        "script": "scripts/build_insights_v2.py",
        "ctx": ctx,
        "tie_window": window,
        "close_max": CLOSE_MAX,
        "statuses": list(STATUSES),
        "status_labels_ru": {"leads": "Efes лидирует", "tie": "ничья (в окне ±%s)" % E.fmt_num(window),
                             "close": "близко (≤ %d)" % CLOSE_MAX, "behind": "отстаёт (> %d)" % CLOSE_MAX},
        "counts": {
            "drinks_catalog": len(ds.drinks), "drinks_pool": len(pool), "efes_in_pool": len(efes_pool),
            "efes_own": len([b for b in efes_pool if b["efes_relation"] == "own"]),
            "efes_distribution": len([b for b in efes_pool if b["efes_relation"] == "distribution"]),
            "efes_cci": len([b for b in efes_pool if b["efes_relation"] == "cci"]),
            "dishes": len(dishes), "cuisines": len(agg["by_cuisine"]),
            "archetypes": len(ds.archetypes), "proposed_archetypes": len(ds.proposed_archetypes),
            "classics": len(ds.classics),
        },
        "caveats_ru": caveats,
        "method_ru": [
            f"Пул — {len(pool)} напитков, видимых гостю (без черновиков и позиций с неподтверждённым наличием); блюд — {len(dishes)}.",
            "Для каждой пары «напиток × блюдо» балл считает движок v2 (engine_v2.score_pair) с параметрами продукта "
            "(литература + калибровка), контекст пустой.",
            "Рейтинг честный: по баллу, при равенстве — по id; политика Efes (окно ±%s) в статистике не применяется." % E.fmt_num(window),
            "Статус блюда — отставание лучшего Efes от лучшего вообще: 0 — лидирует, 1–%s — ничья, до %d — близко, дальше — отстаёт."
            % (E.fmt_num(window), CLOSE_MAX),
            "Пробелы портфеля — тот же расчёт с добавленным гипотетическим сортом Efes = профиль стиля; карта вкусов — PCA по 13 осям.",
        ],
    }
    for d in dishes:   # служебные поля не пишем
        for k in [k for k in d if k.startswith("_")]:
            del d[k]
    out = {
        "meta": meta,
        "headline": {
            "dishes": len(dishes),
            "leads": agg["by_status"]["leads"], "tie": agg["by_status"]["tie"],
            "close": agg["by_status"]["close"], "behind": agg["by_status"]["behind"],
            "covered": agg["by_status"]["leads"] + agg["by_status"]["tie"],
            "beer_covered": agg["by_status_beer"]["leads"] + agg["by_status_beer"]["tie"],
            "beer_leads": agg["by_status_beer"]["leads"],
            "meal_covered": meal["by_status"]["leads"] + meal["by_status"]["tie"],
            "mean_gap": agg["mean_gap"],
            "mean_best_score": agg["mean_best_score"], "mean_best_efes_score": agg["mean_best_efes_score"],
            "top_sku": agg["efes_skus"][0]["id"] if agg["efes_skus"] else None,
            "top_gap_archetype": gaps["realistic"][0]["archetype"] if gaps["realistic"] else None,
            "top_competitor": agg["competitors"][0]["category"] if agg["competitors"] else None,
        },
        "dishes": dishes,
        "aggregates": agg,
        "gaps": gaps,
        "meal": meal,
        "map": fmap,
        "pool": pool_ids,
        "scores": scores,
    }
    if not quiet:
        print_summary(out)
    return out


def print_summary(out: Dict[str, Any]) -> None:
    h, agg, gaps, m = out["headline"], out["aggregates"], out["gaps"], out["meta"]
    c = m["counts"]
    print(f"engine {m['engine_version']} · params {m['params_version']} · calibration {'applied' if m['calibration_applied'] else 'none'}"
          f" · inputs {m['inputs_sha256_16']} @ {m['generated_at']}")
    print(f"pool {c['drinks_pool']}/{c['drinks_catalog']} drinks, Efes in pool {c['efes_in_pool']} "
          f"(own {c['efes_own']}, distribution {c['efes_distribution']}, cci {c['efes_cci']}), dishes {c['dishes']}, cuisines {c['cuisines']}")
    print(f"STATUS  leads {h['leads']} · tie {h['tie']} · close {h['close']} · behind {h['behind']}  → covered {h['covered']}/{h['dishes']}"
          f" · mean gap {h['mean_gap']} · mean best {h['mean_best_score']} vs best Efes {h['mean_best_efes_score']}")
    bs = agg["by_status_beer"]
    print(f"BEER    leads {bs['leads']} · tie {bs['tie']} · close {bs['close']} · behind {bs['behind']}  → covered {h['beer_covered']}/{h['dishes']}"
          " (только пиво Efes: own|distribution, без CCI)")
    ml = out["meal"]["by_status"]
    print(f"MEAL    leads {ml['leads']} · tie {ml['tie']} · close {ml['close']} · behind {ml['behind']} · mean gap {out['meal']['mean_gap']}")
    print("CUISINE (n · leads/tie/close/behind · mean gap):")
    for r in agg["by_cuisine"][:12]:
        print(f"  {r['id']:<14} {r['n']:>3} · {r['leads']}/{r['tie']}/{r['close']}/{r['behind']} · {r['mean_gap']}")
    print("EFES SKU (best-Efes-for · leads-for · top3-for · mean):")
    for s in agg["efes_skus"][:10]:
        print(f"  {s['id']:<32} {s['best_efes_for']:>3} · {s['leads_for']:>3} · {s['top3_for']:>3} · {s['mean_score']}")
    print("COMPETITORS (n · tie/close/behind · top archetypes):")
    for r in agg["competitors"]:
        print(f"  {r['category']:<10} {r['n']:>3} · {r['tie']}/{r['close']}/{r['behind']} · "
              + ", ".join(f"{a['archetype']}×{a['n']}" for a in r["archetypes"][:3]))
    print("GAPS realistic (dishes gained · leads/tie · avg gap reduction · in portfolio):")
    for r in gaps["realistic"][:12]:
        print(f"  {r['archetype']:<24} {r['dishes_gained']:>3} · {r['gained_leads']}/{r['gained_tie']} · {r['avg_gap_reduction']}"
              f" · {','.join(r['in_portfolio']) or '—'}")
    print("GAPS beyond brewing:")
    for r in gaps["beyond_brewing"][:6]:
        print(f"  {r['archetype']:<24} {r['dishes_gained']:>3} · {r['gained_leads']}/{r['gained_tie']} · {r['avg_gap_reduction']}")
    fm = out["map"]
    print(f"MAP PC1 {fm['explained'][0]:.3f} {fm['directions']['pc1']} · PC2 {fm['explained'][1]:.3f} {fm['directions']['pc2']}")


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=OUT_DEFAULT)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    out = build(quiet=args.quiet)
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n"
    args.out.write_text(text, encoding="utf-8")
    if not args.quiet:
        print(f"→ {args.out} ({len(text.encode('utf-8')) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
