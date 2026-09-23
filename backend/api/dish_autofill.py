"""«Своё блюдо» для движка v2: черновой вектор из описания (вкус, сытность, жирность, способ приготовления, белок,
соус, кислота, десерт, острота, теги). Порт autofill() из scripts/build_dishes_v2.py (ENGINE_V2_SPEC §3.3) — той же
функцией размечены блюда каталога, поэтому своё блюдо стоит на одной шкале с ними. TS-двойник:
frontend/src/app/engine/custom-dish-v2.ts (autofillDish / customDishRecord).

Копия, а не импорт: скрипт сборки лежит вне пакета backend и тянет за собой весь каталог. Паритет с оригиналом
проверяет api/tests/test_dish_autofill.py по фикстуре api/tests/data/dish_autofill_v2.json (её генерирует сам
scripts/build_dishes_v2.py — см. docstring теста). Округление — как в скрипте: round(x, 2); TS округляет
Math.round(x·100)/100, расхождение возможно только на точной двоичной «половинке» .xx5.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

AXES = ("salt", "sweet", "sour", "bitter", "umami", "fat", "protein", "heat", "pungent",
        "weight", "cream", "maillard", "smoke", "fresh", "fish_oil", "green_iron")
TASTES = ("SALTY", "SWEET", "SOUR", "BITTER", "UMAMI", "SPICY", "MIXED")
WEIGHT_LEVELS = {"LIGHT": .25, "MEDIUM": .55, "HEAVY": .85}
FAT_LEVELS = {"LOW": .2, "MEDIUM": .5, "HIGH": .85}
COOK_METHODS = ("raw", "cured", "fermented", "steamed", "boiled", "braised", "baked", "fried", "grilled", "smoked")
PROTEIN_BY_SOURCE = {"none": 0.0, "beef": .95, "lamb": .9, "horse": .9, "pork": .85, "poultry": .7,
                     "white_fish": .7, "oily_fish": .8, "shellfish": .5, "egg": .5, "legume": .5,
                     "cheese_soft": .5, "cheese_hard": .9, "dairy": .3}
FISH_OIL_BY_SOURCE = {"oily_fish": .9, "white_fish": .4, "shellfish": .3}
UMAMI_BY_SOURCE = {"none": 0.0, "beef": .8, "lamb": .8, "horse": .8, "pork": .7, "poultry": .5,
                   "white_fish": .5, "oily_fish": .6, "shellfish": .6, "egg": .3, "legume": .3,
                   "cheese_soft": .3, "cheese_hard": .8, "dairy": .2}
STARCH_TAGS = {"bread", "rice", "potato", "noodles", "corn", "wheat", "biscuit", "grain"}
SAUCE_RULES: Dict[str, Dict[str, Any]] = {
    "none": {},
    "cream": {"blend": {"cream": .7}, "add": {"fat": .2}},
    "bbq": {"blend": {"sweet": .6, "salt": .5}, "floor": {"smoke": .8}},
    "vinaigrette": {"blend": {"sour": .6}, "acid": "vinegar"},
    "tomato": {"blend": {"sour": .35}, "add": {"umami": .1}, "acid": "tomato"},
    "soy": {"blend": {"salt": .7}, "add": {"umami": .15}},
    "chili": {"blend": {"heat": .7}},
    "sweet_glaze": {"blend": {"sweet": .5}},
    "cheese": {"blend": {"cream": .6}, "add": {"fat": .2, "salt": .1}},
    "broth": {"min": {"umami": .6}},
}
PUNGENT_BY_TAG = {"onion": .3, "garlic": .45, "mustard": .5, "radish": .4, "horseradish": .8, "wasabi": .8}
GREEN_IRON_BY_TAG = {"asparagus": .8, "artichoke": .8, "spinach": .5}
# ароматические теги от способа приготовления — для мостов R12 (в каталоге их проставляет разметчик); как COOK_TAGS в TS
COOK_TAGS = {"grilled": {"char": .7, "smoke": .6}, "smoked": {"smoke": .9}, "cured": {"cured": .7},
             "baked": {"bread": .4}, "fermented": {"sour_lactic": .5}}


def _clamp(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def autofill(taste: str, weight: str, fat: str, cook: str, protein: str = "none", sauce: str = "none",
             acid: str = "none", dessert: bool = False, tags: Optional[Dict[str, float]] = None,
             heat: Optional[float] = None) -> Tuple[Dict[str, float], str]:
    """Черновой вектор блюда (16 осей) и тип кислоты — как autofill() в scripts/build_dishes_v2.py при share = 1."""
    tags = tags or {}
    v = {a: 0.0 for a in AXES}
    # 1. база
    if taste == "SALTY": v["salt"] = .8
    elif taste == "SWEET": v["sweet"] = .85
    elif taste == "SOUR": v["sour"] = .8
    elif taste == "BITTER": v["bitter"] = .7
    elif taste == "UMAMI": v["umami"] = .8
    elif taste == "SPICY": v["umami"] = .4; v["heat"] = .6
    elif taste == "MIXED": v["salt"] = .4; v["sweet"] = .4; v["umami"] = .4
    else: raise ValueError(f"taste: {taste}")
    v["weight"] = WEIGHT_LEVELS[weight]
    v["fat"] = FAT_LEVELS[fat]
    # 2. белок → protein, fish_oil, umami (share = 1: в описании белок — главный ингредиент)
    share = 1.0
    starch = any(tags.get(t, 0) >= .3 for t in STARCH_TAGS)
    p = PROTEIN_BY_SOURCE[protein] * share if protein != "none" else (.2 if starch else 0.0)
    v["protein"] = p * (.5 if dessert and protein in ("none", "dairy") else 1)
    v["fish_oil"] = FISH_OIL_BY_SOURCE.get(protein, 0.0) * min(1.0, share + .2)
    if not dessert:
        v["umami"] = max(v["umami"], UMAMI_BY_SOURCE[protein] * (.5 + .5 * share))
    # 3. способ приготовления
    if cook == "raw":
        if not dessert: v["fresh"] = max(v["fresh"], .8)
    elif cook == "cured": v["salt"] += .3; v["umami"] += .2
    elif cook == "fermented": v["sour"] += .3; v["fresh"] = max(v["fresh"], .3)
    elif cook == "steamed": v["fresh"] = max(v["fresh"], .4)
    elif cook == "boiled": v["umami"] += .1
    elif cook == "braised": v["umami"] += .1; v["maillard"] = max(v["maillard"], .3)
    elif cook == "baked": v["maillard"] = max(v["maillard"], .5)
    elif cook == "fried": v["maillard"] = max(v["maillard"], .6); v["fat"] += .1
    elif cook == "grilled": v["maillard"] = max(v["maillard"], .7); v["smoke"] = max(v["smoke"], .7); v["weight"] += .1
    elif cook == "smoked": v["smoke"] = max(v["smoke"], .9); v["maillard"] = max(v["maillard"], .4)
    else: raise ValueError(f"cook_method: {cook}")
    # 4. соус доминирует (CMS, Gaiser)
    rule = SAUCE_RULES[sauce]
    for a, s in rule.get("blend", {}).items(): v[a] = .6 * s + .4 * v[a]
    for a, s in rule.get("add", {}).items(): v[a] += s
    for a, s in rule.get("floor", {}).items(): v[a] = max(v[a], .6 * s + .4 * v[a])
    for a, s in rule.get("min", {}).items(): v[a] = max(v[a], s)
    if acid == "none" and rule.get("acid"): acid = rule["acid"]
    # 5. теги → pungent, green_iron, cream
    v["cream"] = max(v["cream"], .9 * tags.get("dairy_cream", 0))
    pung = [PUNGENT_BY_TAG[t] for t, w in tags.items() if t in PUNGENT_BY_TAG and w >= .3]
    if pung: v["pungent"] = max(pung)
    v["green_iron"] = max([GREEN_IRON_BY_TAG[t] for t, w in tags.items() if t in GREEN_IRON_BY_TAG and w >= .3] or [0])
    # 6. десерт → sweet ≥ .6; несладкое блюдо — соль не ниже обычной посолки
    if dessert: v["sweet"] = max(v["sweet"], .6)
    elif taste != "SWEET": v["salt"] = max(v["salt"], .4)
    if heat is not None: v["heat"] = heat
    return {a: round(float(_clamp(v[a])) + 0.0, 2) for a in AXES}, acid


def autofill_dish(spec: Dict[str, Any]) -> Tuple[Dict[str, float], str]:
    """spec как DishSpecV2 в TS: {taste, weight, fat, cook, protein?, sauce?, acid?, dessert?, heat?, tags?}."""
    return autofill(spec["taste"], spec["weight"], spec["fat"], spec["cook"], spec.get("protein") or "none",
                    spec.get("sauce") or "none", spec.get("acid") or "none", bool(spec.get("dessert")),
                    spec.get("tags") or {}, spec.get("heat"))


def custom_dish_record(spec: Dict[str, Any]) -> Dict[str, Any]:
    """Запись блюда v2 (формат dishes_v2.json) для движка — как customDishRecord в TS."""
    vector, acid = autofill_dish(spec)
    tags = {**COOK_TAGS.get(spec["cook"], {}), **(spec.get("tags") or {})}
    name = spec.get("name") or "Ваше блюдо"
    return {"id": "custom", "name": name, "display_name": name, "vector": vector, "tags": tags,
            "cuisine": list(spec.get("cuisine") or []), "is_dessert": bool(spec.get("dessert")), "acid_type": acid,
            "cook_method": spec["cook"], "protein_source": spec.get("protein") or "none",
            "sauce": spec.get("sauce") or "none", "vector_source": "custom"}
