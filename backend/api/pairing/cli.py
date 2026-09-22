"""CLI: python -m api.pairing.cli beshbarmak  |  --beer efes-pilsener  |  --matrix"""
from __future__ import annotations

import argparse
import json

from .dataset import Dataset
from .engine import recommend_beers, recommend_dishes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dish", nargs="?")
    ap.add_argument("--beer")
    ap.add_argument("--occasion")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--limit", type=int, default=5)
    a = ap.parse_args()
    ds = Dataset()
    ctx = {"occasion": a.occasion} if a.occasion else {}
    if a.beer:
        beer = ds.beer_by_id[a.beer]
        res = recommend_dishes(beer, ds.dish_profiles, ds.curated_index, ctx, a.limit)
        print(f"🍺 {beer['name']}  vector={beer['vector']}")
        for r in res:
            print(f"  {r['score']:>3}  {ds.dish_by_id[r['dish_id']]['name']:<28} {r['match_type']:<10} "
                  + " | ".join(c['text'][:50] for c in r['reasons']))
        return
    dish = ds.dish_by_id[a.dish]
    res = recommend_beers(dish, ds.beer_profiles, ds.curated_index, ctx, a.limit)
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return
    print(f"🍽  {dish['name']}  intensity={dish['intensity']}  vector={dish['vector']}")
    for r in res:
        print(f"  {r['score']:>3}  {ds.beer_by_id[r['beer_id']]['name']:<28} {r['match_type']:<10} "
              + " | ".join(f"{c['rule']}:{c['points']:+.1f}" for c in r['contributions']))


if __name__ == "__main__":
    main()
