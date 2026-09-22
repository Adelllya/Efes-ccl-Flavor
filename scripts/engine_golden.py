#!/usr/bin/env python3
"""Генерирует data/golden_scores.json — эталон движка для паритета Python ↔ TypeScript,
и печатает метрики калибровки. Запуск из корня: python3 scripts/engine_golden.py"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from api.pairing.dataset import Dataset  # noqa: E402
from api.pairing.engine import score_pair, recommend_beers, dna_vector, dna_archetype  # noqa: E402


def main() -> None:
    ds = Dataset()
    matrix = []
    detailed = []
    all_scores = []
    for d in ds.dish_profiles:
        for b in ds.beer_profiles:
            cu = ds.curated_index.get(f"{b['id']}|{d['id']}")
            r = score_pair(b, d, {}, cu)
            matrix.append({"beer": b["id"], "dish": d["id"], "score": r["score"], "type": r["match_type"]})
            all_scores.append(r["score"])
    # подробные кейсы с контекстом — проверяют R12/R13 и разбивку по правилам
    dna = dna_vector([{"vector": ds.beer_by_id["efes-pilsener"]["vector"], "rating": "love"},
                      {"vector": ds.beer_by_id["wukong-ju"]["vector"], "rating": "dislike"}])
    cases = [
        ("kozel", "beshbarmak", {}),
        ("efes-pilsener", "kazy", {"occasion": "hot"}),
        ("khmelnoy-los", "bbq-ribs", {"occasion": "evening", "bitter_pref": 0.5}),
        ("miller-genuine-draft", "sushi", {"occasion": "party"}),
        ("legenda-777", "strudel", {"occasion": "gourmet", "dna": dna}),
        ("bavaria", "buffalo-wings", {"bitter_pref": -1.0}),
    ]
    for bid, did, ctx in cases:
        cu = ds.curated_index.get(f"{bid}|{did}")
        r = score_pair(ds.beer_by_id[bid], ds.dish_by_id[did], ctx, cu)
        detailed.append({"beer": bid, "dish": did, "context": ctx, "score": r["score"], "type": r["match_type"],
                         "contributions": [{"rule": c["rule"], "points": c["points"]} for c in r["contributions"]]})
    profiles = {b["id"]: {"vector": b["vector"], "intensity": b["intensity"], "confidence": b["confidence"], "tags": b["tags"]}
                for b in ds.beer_profiles}
    out = {"version": "1.0", "matrix": matrix, "cases": detailed, "beer_profiles": profiles,
           "dna_case": {"vector": dna, "archetype": dna_archetype(dna)["id"]}}
    (ROOT / "data" / "golden_scores.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── метрики ──
    all_scores.sort()
    n = len(all_scores)
    print(f"golden: {n} пар. score min={all_scores[0]} p10={all_scores[n//10]} median={all_scores[n//2]} "
          f"p90={all_scores[9*n//10]} max={all_scores[-1]}")
    picks = [p for p in ds.curated if p["score"] >= 4]
    picks5 = [p for p in ds.curated if p["score"] >= 5]
    for label, group, k in (("score≥4 в top-5", picks, 5), ("score=5 в top-3", picks5, 3), ("score=5 в top-5", picks5, 5)):
        hits = 0
        for p in group:
            top = recommend_beers(ds.dish_by_id[p["dish_id"]], ds.beer_profiles, {}, {}, limit=k)
            hits += p["brand_id"] in [t["beer_id"] for t in top]
        print(f"согласие с сомелье (без R11), {label}: {hits}/{len(group)} = {hits/len(group):.0%}")
    types = {}
    for m in matrix:
        types[m["type"]] = types.get(m["type"], 0) + 1
    print("типы пар по матрице:", types)


if __name__ == "__main__":
    main()
