"""Загрузка канонических данных из /data/*.json без Django (тесты, CLI, golden)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from .engine import build_beer_profile, build_dish_profile, index_curated

DATA_DIR = Path(__file__).resolve().parents[3] / "data"


def load_json(name: str) -> Any:
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


class Dataset:
    def __init__(self, data_dir: Path | None = None):
        d = data_dir or DATA_DIR
        self.notes: List[Dict[str, Any]] = json.loads((d / "flavor_notes.json").read_text(encoding="utf-8"))
        self.brands: List[Dict[str, Any]] = json.loads((d / "brands.json").read_text(encoding="utf-8"))
        self.dishes: List[Dict[str, Any]] = json.loads((d / "dishes.json").read_text(encoding="utf-8"))
        self.curated: List[Dict[str, Any]] = json.loads((d / "pairings_curated.json").read_text(encoding="utf-8"))
        self.priors: Dict[str, Dict[str, float]] = json.loads((d / "style_priors.json").read_text(encoding="utf-8"))["priors"]
        self.notes_by_id = {n["id"]: n for n in self.notes}
        self.beer_profiles = [build_beer_profile(b, self.notes_by_id, self.priors) for b in self.brands]
        self.dish_profiles = [build_dish_profile(x) for x in self.dishes]
        self.beer_by_id = {p["id"]: p for p in self.beer_profiles}
        self.dish_by_id = {p["id"]: p for p in self.dish_profiles}
        self.curated_index = index_curated(self.curated)
