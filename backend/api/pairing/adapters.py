"""Адаптеры Django-моделей → структуры движка (совпадают по форме с data/*.json)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from django.conf import settings

from .engine import build_beer_profile, build_dish_profile, index_curated


def load_priors() -> Dict[str, Dict[str, float]]:
    with open(Path(settings.FLAVOR_DATA_DIR) / "style_priors.json", encoding="utf-8") as f:
        return json.load(f)["priors"]


def note_to_engine(note) -> Dict[str, Any]:
    return {"id": note.slug or str(note.id), "name": note.name, "category": note.category,
            "icon": note.icon, "axes": note.axes or {}, "tags": note.tags or []}


def brand_to_engine(brand, request=None) -> Dict[str, Any]:
    """Brand + prefetched flavor_profiles/serving_recommendation → dict как в brands.json."""
    pyramid = []
    for p in brand.flavor_profiles.all():
        pyramid.append({"layer": p.layer, "note_id": p.flavor_note.slug or str(p.flavor_note.id),
                        "intensity": p.intensity, "sommelier_note": p.sommelier_note})
    image = None
    if brand.image:
        image = request.build_absolute_uri(brand.image.url) if request else brand.image.url
    sr = getattr(brand, "serving_recommendation", None)
    return {
        "id": brand.slug or str(brand.id), "uuid": str(brand.id), "name": brand.name,
        "display_name": brand.display_name or brand.name, "brand_owner": brand.brand_owner,
        "style": brand.style, "style_family": brand.style_family, "abv": brand.abv,
        "abv_estimated": brand.abv_estimated, "packaging_type": brand.packaging_type,
        "is_horeca_only": brand.is_horeca_only, "description": brand.description, "origin": brand.origin,
        "tagline": brand.tagline, "accent": brand.accent, "image": image, "pyramid": pyramid,
        "vector_override": brand.vector_override or {},
        "serving": {"temp_min": sr.serving_temp_min, "temp_max": sr.serving_temp_max, "glass": sr.glass_type,
                    "seasonality": sr.seasonality} if sr else None,
    }


def dish_to_engine(dish) -> Dict[str, Any]:
    return {"id": dish.slug or str(dish.id), "uuid": str(dish.id), "name": dish.name,
            "display_name": dish.display_name or dish.name, "emoji": dish.emoji, "cuisine": dish.cuisine,
            "category": dish.category, "dominant_taste": dish.dominant_taste, "weight": dish.weight,
            "fat_level": dish.fat_level, "cooking_method": dish.cooking_method, "description": dish.description,
            "vector": dish.vector or {}, "tags": dish.tags or [], "synonyms": dish.synonyms or []}


class EngineContext:
    """Собирает профили из БД для одного запроса (17 сортов × 50 блюд — дёшево)."""

    def __init__(self, request=None, brand_ids: Optional[List[str]] = None):
        from api.models import Brand, Dish, FlavorNote, FoodPairing
        self.priors = load_priors()
        self.notes_by_id = {n["id"]: n for n in (note_to_engine(x) for x in FlavorNote.objects.all())}
        qs = Brand.objects.filter(is_active=True).prefetch_related("flavor_profiles__flavor_note", "serving_recommendation")
        self.brands_raw = [brand_to_engine(b, request) for b in qs]
        self.beers = [build_beer_profile(b, self.notes_by_id, self.priors) for b in self.brands_raw]
        self.beer_by_id = {b["id"]: b for b in self.beers}
        self.dishes_raw = [dish_to_engine(d) for d in Dish.objects.all()]
        self.dishes = [build_dish_profile(d) for d in self.dishes_raw]
        self.dish_by_id = {d["id"]: d for d in self.dishes}
        curated = []
        for fp in FoodPairing.objects.select_related("brand", "dish"):
            curated.append({"brand_id": fp.brand.slug or str(fp.brand.id), "dish_id": fp.dish.slug or str(fp.dish.id),
                            "score": fp.compatibility_score, "type": fp.pairing_type, "explanation": fp.explanation})
        self.curated_index = index_curated(curated)

    def find_beer(self, key: str):
        return self.beer_by_id.get(key) or next((b for b in self.beers if b["brand"].get("uuid") == key), None)

    def find_dish(self, key: str):
        return self.dish_by_id.get(key) or next((d for d in self.dishes if d["dish"].get("uuid") == key), None)
