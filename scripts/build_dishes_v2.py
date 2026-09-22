#!/usr/bin/env python3
"""Сборка каталога блюд Flavor Tree v2 → data/dishes_v2.json.

Источники:
  • docs/research/engine_v2_prototype.py — 44 эталонных блюда (DISHES). Их векторы переносятся
    как есть (vector_source = "prototype"); таблица PROTO ниже — дословная копия, а самопроверка
    сверяет её с модулем прототипа, если он доступен.
  • data/dishes.json (v1, 50 блюд) — имена, синонимы, эмодзи, описания, категории, а для блюд,
    которых нет в прототипе, ещё и 12 старых осей вектора (vector_source = "migrated_v1").
    Айран и кумыс не переносятся: в v2 это напитки (категория dairy) — см. ENGINE_V2_SPEC §3.4.
  • Таблица NEW — блюда, которых не было ни в v1, ни в прототипе (vector_source = "manual").
  • data/research/proposed_dishes.json (если есть) — предложения RESEARCH; добавляются только
    новые id, совпадения id/имени выводятся как конфликты.

Автозаполнение (ENGINE_V2_SPEC §3.3) реализовано в autofill(). Оно даёт:
  • у перенесённых из v1 блюд — новые оси protein, fish_oil, pungent, green_iron
    (старые 12 осей v1 размечены вручную и сохраняются, как это сделал прототип);
  • черновик вектора для любого нового блюда: --autofill '{"taste": "UMAMI", ...}';
  • контрольное сравнение «автозаполнение ↔ итог» для всех блюд: --report.

Запуск:  python3 scripts/build_dishes_v2.py            # собрать и проверить
         python3 scripts/build_dishes_v2.py --report   # + W_D/F_D и расхождения с автозаполнением
         python3 scripts/build_dishes_v2.py --check    # только проверить уже собранный файл
Только стандартная библиотека Python 3.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
V1_PATH = ROOT / "data" / "dishes.json"
OUT_PATH = ROOT / "data" / "dishes_v2.json"
PROPOSED_PATH = ROOT / "data" / "research" / "proposed_dishes.json"
PROTOTYPE_PATH = ROOT / "docs" / "research" / "engine_v2_prototype.py"

# ─────────────────────────────────────────────────────────────────────────────
# 1. СЛОВАРИ (контракт V2 + ENGINE_V2_SPEC §3.1–3.2)
# ─────────────────────────────────────────────────────────────────────────────
AXES = ("salt", "sweet", "sour", "bitter", "umami", "fat", "protein", "heat", "pungent",
        "weight", "cream", "maillard", "smoke", "fresh", "fish_oil", "green_iron")
# оси v1, которые переносятся без изменений (spice уходит в теги — §3.4)
LEGACY_AXES = ("salt", "sweet", "sour", "bitter", "umami", "heat", "fat", "weight",
               "smoke", "maillard", "fresh", "cream")

COOK_METHODS = ("raw", "cured", "fermented", "steamed", "boiled", "braised", "baked", "fried", "grilled", "smoked")
PROTEIN_SOURCES = ("none", "beef", "lamb", "horse", "pork", "poultry", "white_fish", "oily_fish", "shellfish",
                   "egg", "legume", "cheese_soft", "cheese_hard", "dairy")
SAUCES = ("none", "cream", "tomato", "bbq", "soy", "vinaigrette", "cheese", "chili", "sweet_glaze", "broth")
ACID_TYPES = ("none", "citrus", "vinegar", "lactic", "tomato")
SERVE_TEMPS = ("cold", "room", "hot")
VECTOR_SOURCES = ("prototype", "migrated_v1", "manual")
# §3.2 + значения, которые уже использует прототип (tatar, argentinian, austrian, bavarian)
# + ukrainian, vietnamese, greek для новых блюд
CUISINES = ("kazakh", "central_asian", "uyghur", "russian", "ukrainian", "caucasian", "turkish", "tatar",
            "german", "bavarian", "austrian", "czech", "belgian", "english", "irish", "french", "italian",
            "spanish", "greek", "japanese", "chinese", "korean", "vietnamese", "thai", "indian", "mexican",
            "american", "argentinian", "international")

# §2.3 — общий словарь ароматов напитка и блюда (по нему работает мост R12)
AROMA_TAGS = {
    "citrus", "tropical_fruit", "stone_fruit", "orchard_fruit", "red_fruit", "dark_fruit", "cherry", "banana",
    "clove", "pepper", "herbal", "floral", "pine_resin", "grass", "bread", "grain", "biscuit", "toast",
    "caramel", "honey", "nutty", "chocolate", "coffee", "roast", "smoke", "oak_vanilla", "dairy_cream",
    "sour_lactic", "mint", "cucumber", "brine", "mineral", "warm_spice", "anise", "juniper", "agave",
    "bitter_orange", "char", "cured", "yeast", "rice", "wheat", "warmth"}
# §3.2 — ингредиентные теги (для текстов объяснения)
INGREDIENT_TAGS = {"lamb", "pork", "beef", "cheese", "tomato", "onion", "garlic", "mustard", "egg", "rice",
                   "noodles", "potato", "corn", "beans", "char", "cured", "broth", "olive", "green"}
# теги, которые уже есть в прототипе, + несколько ингредиентов для новых блюд
EXTRA_TAGS = {"fish", "seaweed", "fried", "bacon", "butter", "molasses", "chili", "vanilla", "cocoa", "salt",
              "horseradish", "wasabi", "radish", "asparagus", "artichoke", "spinach",
              "chicken", "horse", "offal", "shellfish", "pumpkin", "cabbage"}
KNOWN_TAGS = AROMA_TAGS | INGREDIENT_TAGS | EXTRA_TAGS

V1_CUISINE = {"KZ": ["kazakh"], "ITALIAN": ["italian"], "JAPANESE": ["japanese"],
              "AMERICAN": ["american"], "MEXICAN": ["mexican"], "GERMAN": ["german"]}
MOVED_TO_DRINKS = {"airan", "kumys"}   # §3.4: переезжают в каталог напитков (dairy)
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else hi if x > hi else x


def r2(x: float) -> float:
    return round(float(x) + 0.0, 2)


# ─────────────────────────────────────────────────────────────────────────────
# 2. АВТОЗАПОЛНЕНИЕ (§3.3)
# ─────────────────────────────────────────────────────────────────────────────
TASTES = ("SALTY", "SWEET", "SOUR", "BITTER", "UMAMI", "SPICY", "MIXED")
WEIGHT_LEVELS = {"LIGHT": .25, "MEDIUM": .55, "HEAVY": .85}
FAT_LEVELS = {"LOW": .2, "MEDIUM": .5, "HIGH": .85}

# §3.1 №7: 0 салат · .2 картофель/выпечка · .5 птица/бобовые/моцарелла · .8 свинина/птица целиком ·
# .9–.95 говядина, баранина, конина, твёрдый сыр. Значение — для блюда, где белок главный; share < 1
# для смешанных блюд (плов, манты, лапша).
PROTEIN_BY_SOURCE = {"none": 0.0, "beef": .95, "lamb": .9, "horse": .9, "pork": .85, "poultry": .7,
                     "white_fish": .7, "oily_fish": .8, "shellfish": .5, "egg": .5, "legume": .5,
                     "cheese_soft": .5, "cheese_hard": .9, "dairy": .3}
# §3.1 №15
FISH_OIL_BY_SOURCE = {"oily_fish": .9, "white_fish": .4, "shellfish": .3}
# §3.1 №5: .5 курица · .7 бульон/сыр · .85 варёная баранина, стейк
UMAMI_BY_SOURCE = {"none": 0.0, "beef": .8, "lamb": .8, "horse": .8, "pork": .7, "poultry": .5,
                   "white_fish": .5, "oily_fish": .6, "shellfish": .6, "egg": .3, "legume": .3,
                   "cheese_soft": .3, "cheese_hard": .8, "dairy": .2}
STARCH_TAGS = {"bread", "rice", "potato", "noodles", "corn", "wheat", "biscuit", "grain"}
# §3.3 шаг 4. blend: v = 0.6·s + 0.4·v; add: v += s; floor: v = max(v, 0.6·s + 0.4·v) — для осей вне
# списка смешивания (дым в BBQ-соусе не может сделать блюдо менее дымным).
SAUCE_RULES = {
    "none": {},
    "cream": {"blend": {"cream": .7}, "add": {"fat": .2}},
    "bbq": {"blend": {"sweet": .6, "salt": .5}, "floor": {"smoke": .8}},
    "vinaigrette": {"blend": {"sour": .6}, "acid": "vinegar"},
    "tomato": {"blend": {"sour": .35}, "add": {"umami": .1}, "acid": "tomato"},
    "soy": {"blend": {"salt": .7}, "add": {"umami": .15}},
    "chili": {"blend": {"heat": .7}},
    "sweet_glaze": {"blend": {"sweet": .5}},
    "cheese": {"blend": {"cream": .6}, "add": {"fat": .2, "salt": .1}},
    "broth": {"min": {"umami": .6}},   # в §3.3 не описан; бульон = умами ≥ .6 (§3.1 №5 «.7 бульон»)
}
# §3.3 шаг 5 (+ §3.1 №9: «.3 лук · .5 чеснок, горчица · .8 хрен/васаби»)
PUNGENT_BY_TAG = {"onion": .3, "garlic": .45, "mustard": .5, "radish": .4, "horseradish": .8, "wasabi": .8}
GREEN_IRON_BY_TAG = {"asparagus": .8, "artichoke": .8, "spinach": .5}


def autofill(taste: str, weight: str, fat: str, cook: str, protein: str = "none", sauce: str = "none",
             acid: str = "none", dessert: bool = False, tags: dict | None = None, heat: float | None = None,
             share: float = 1.0) -> tuple[dict, str]:
    """Черновой вектор блюда из категориальных полей (§3.3). Возвращает (vector, acid_type)."""
    tags = tags or {}
    v = {a: 0.0 for a in AXES}
    # 1. база — как customDishVector v1, но острота — отдельное поле
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
    # 2. источник белка → protein, fish_oil, umami
    starch = any(tags.get(t, 0) >= .3 for t in STARCH_TAGS)
    p = PROTEIN_BY_SOURCE[protein] * share if protein != "none" else (.2 if starch else 0.0)
    v["protein"] = p * (.5 if dessert and protein in ("none", "dairy") else 1)
    v["fish_oil"] = FISH_OIL_BY_SOURCE.get(protein, 0.0) * min(1.0, share + .2)
    if not dessert:
        v["umami"] = max(v["umami"], UMAMI_BY_SOURCE[protein] * (.5 + .5 * share))
    # 3. способ приготовления → maillard / smoke / fresh (+ поправки fat, weight, salt, umami, sour)
    if cook == "raw":
        if not dessert: v["fresh"] = max(v["fresh"], .8)   # «сырое» у десерта (тирамису) — не свежесть
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
    # 5. теги → pungent, green_iron; сливочность из ингредиентов (тег dairy_cream) — наше дополнение к §3.3
    v["cream"] = max(v["cream"], .9 * tags.get("dairy_cream", 0))
    pung = [PUNGENT_BY_TAG[t] for t, w in tags.items() if t in PUNGENT_BY_TAG and w >= .3]
    if pung: v["pungent"] = max(pung)
    v["green_iron"] = max([GREEN_IRON_BY_TAG[t] for t, w in tags.items() if t in GREEN_IRON_BY_TAG and w >= .3] or [0])
    # 6. десерт → sweet ≥ .6; несладкое блюдо — соль не ниже обычной посолки (правило v1)
    if dessert: v["sweet"] = max(v["sweet"], .6)
    elif taste != "SWEET": v["salt"] = max(v["salt"], .4)
    if heat is not None: v["heat"] = heat
    return {a: r2(clamp(v[a])) for a in AXES}, acid


def w_d(v: dict, dessert: bool) -> float:
    """Вес блюда W_D (§3.1)."""
    w = clamp(.40 * v["weight"] + .30 * v["fat"] + .10 * v["cream"] + .10 * v["protein"])
    return max(w, clamp(.4 * v["sweet"] + .4 * v["fat"] + .2 * v["cream"])) if dessert else w


def f_d(v: dict, dessert: bool, tags: dict) -> float:
    """Громкость блюда F_D (§3.1)."""
    f = clamp(.15 * v["heat"] + .15 * v["smoke"] + .20 * v["salt"] + .20 * v["umami"] + .10 * v["maillard"]
              + .15 * v["sour"] + .05 * v["sweet"] + .05 * v["pungent"] + .05 * v["bitter"])
    if dessert:
        choc = max(tags.get("chocolate", 0), tags.get("cocoa", 0), tags.get("coffee", 0))
        f = max(f, clamp(.45 * v["sweet"] + .30 * v["bitter"] + .25 * choc))
    return f


# ─────────────────────────────────────────────────────────────────────────────
# 3. 44 БЛЮДА ПРОТОТИПА — дословная копия DISHES из docs/research/engine_v2_prototype.py
# ─────────────────────────────────────────────────────────────────────────────
def Dd(id, name, salt=0, sweet=0, sour=0, bitter=0, umami=0, fat=0, protein=0, heat=0, pungent=0, weight=.5,
       cream=0, maillard=0, smoke=0, fresh=0, fish_oil=0, green_iron=0, dessert=False, cold=False, vinegar=False,
       cuisine=None, tags=None):
    return dict(id=id, name=name, salt=salt, sweet=sweet, sour=sour, bitter=bitter, umami=umami, fat=fat,
                protein=protein, heat=heat, pungent=pungent, weight=weight, cream=cream, maillard=maillard,
                smoke=smoke, fresh=fresh, fish_oil=fish_oil, green_iron=green_iron, dessert=dessert, cold=cold,
                vinegar=vinegar, cuisine=cuisine or [], tags=tags or {})


PROTO = [
 Dd("beshbarmak","Бешбармак",salt=.5,umami=.85,fat=.8,protein=.9,pungent=.3,weight=.9,fresh=.1,cuisine=["kazakh"],tags={"bread":.8,"broth":.7,"onion":.5,"lamb":.8}),
 Dd("kazy","Казы",salt=.8,umami=.8,fat=.9,protein=.9,pungent=.4,weight=.8,smoke=.5,cuisine=["kazakh"],tags={"garlic":.6,"pepper":.6,"cured":.8,"smoke":.5}),
 Dd("kuyrdak","Куырдак",salt=.5,umami=.85,fat=.85,protein=.9,pungent=.4,weight=.85,maillard=.7,cuisine=["kazakh"],tags={"onion":.6,"fried":.7}),
 Dd("shashlyk","Шашлык",salt=.5,umami=.85,fat=.55,protein=.9,pungent=.3,weight=.8,smoke=.85,maillard=.8,cuisine=["kazakh","caucasian"],tags={"smoke":1,"char":.9,"pepper":.5,"onion":.5,"lamb":.8}),
 Dd("plov","Плов",salt=.45,sweet=.25,umami=.7,fat=.6,protein=.6,weight=.85,maillard=.35,cuisine=["central_asian","kazakh"],tags={"rice":1,"warm_spice":.7,"caramel":.4,"lamb":.6}),
 Dd("kurt","Курт",salt=.8,sour=.7,umami=.4,fat=.2,protein=.7,weight=.2,cream=.3,cold=True,cuisine=["kazakh"],tags={"cheese":1,"sour_lactic":.8,"brine":.5}),
 Dd("samsa","Самса",salt=.5,umami=.7,fat=.6,protein=.7,pungent=.3,weight=.7,maillard=.7,cuisine=["central_asian","kazakh"],tags={"bread":.8,"onion":.5,"warm_spice":.4,"lamb":.6}),
 Dd("manty","Манты",salt=.45,umami=.7,fat=.55,protein=.7,pungent=.3,weight=.7,fresh=.2,cuisine=["central_asian","kazakh"],tags={"bread":.6,"onion":.5,"pepper":.4}),
 Dd("lagman-spicy","Лагман острый",salt=.5,sweet=.05,sour=.15,umami=.7,fat=.5,protein=.7,heat=.6,pungent=.5,weight=.8,maillard=.4,smoke=.1,fresh=.1,cuisine=["central_asian","uyghur"],tags={"bread":.4,"lamb":.6,"pepper":.6,"warm_spice":.5,"garlic":.5,"tomato":.4}),
 Dd("chak-chak","Чак-чак",sweet=.9,fat=.5,protein=.1,weight=.5,maillard=.5,dessert=True,cuisine=["kazakh","tatar"],tags={"honey":1,"bread":.6,"fried":.5}),
 Dd("okroshka","Окрошка",salt=.5,sour=.6,umami=.3,fat=.3,protein=.4,pungent=.4,weight=.3,cream=.3,fresh=.7,cold=True,cuisine=["russian"],tags={"cucumber":1,"herbal":.8,"sour_lactic":.6,"egg":.4}),
 Dd("sushi","Суши (нигири)",salt=.35,sour=.3,umami=.7,fat=.25,protein=.6,weight=.25,fresh=.8,fish_oil=.5,cold=True,cuisine=["japanese"],tags={"rice":1,"fish":.8,"seaweed":.5,"brine":.4}),
 Dd("ramen","Рамен",salt=.7,umami=.9,fat=.55,protein=.6,weight=.8,cuisine=["japanese"],tags={"broth":1,"pork":.6,"egg":.4,"bread":.3}),
 Dd("steak","Стейк",salt=.5,umami=.9,fat=.55,protein=.95,weight=.85,smoke=.5,maillard=.85,cuisine=["american","argentinian"],tags={"beef":1,"char":.8,"butter":.5,"herbal":.5}),
 Dd("burger","Бургер",salt=.6,sweet=.2,umami=.85,fat=.85,protein=.8,pungent=.3,weight=.9,cream=.3,smoke=.4,maillard=.7,cuisine=["american"],tags={"beef":.9,"cheese":.6,"bacon":.5,"bread":.7,"smoke":.4,"onion":.5}),
 Dd("bbq-ribs","Рёбрышки BBQ",salt=.5,sweet=.6,umami=.8,fat=.85,protein=.8,weight=.9,smoke=.9,maillard=.7,cuisine=["american"],tags={"smoke":1,"caramel":.8,"pork":.8,"molasses":.6,"pepper":.4}),
 Dd("buffalo-wings","Крылышки Buffalo",salt=.6,sour=.3,umami=.5,fat=.75,protein=.7,heat=.85,weight=.55,cream=.3,maillard=.6,cuisine=["american"],tags={"chili":.9,"butter":.6,"cheese":.3}),
 Dd("nachos","Начос",salt=.8,sour=.2,umami=.5,fat=.75,protein=.4,heat=.6,weight=.55,cream=.5,maillard=.5,cuisine=["mexican","american"],tags={"cheese":.8,"corn":.8,"chili":.6,"tomato":.4}),
 Dd("tacos","Тако",salt=.5,sour=.3,umami=.65,fat=.5,protein=.6,heat=.6,pungent=.4,weight=.5,smoke=.3,maillard=.7,fresh=.4,cuisine=["mexican"],tags={"corn":.6,"citrus":1,"herbal":.6,"chili":.7,"onion":.5}),
 Dd("chili-con-carne","Чили кон карне",salt=.5,sweet=.15,sour=.2,umami=.8,fat=.5,protein=.7,heat=.75,weight=.8,cuisine=["mexican","american"],tags={"beef":.7,"beans":.5,"chili":.9,"warm_spice":.7,"tomato":.5}),
 Dd("mac-and-cheese","Мак-энд-чиз",salt=.5,umami=.7,fat=.85,protein=.5,weight=.8,cream=.9,maillard=.3,cuisine=["american"],tags={"cheese":1,"butter":.7,"dairy_cream":.9}),
 Dd("tiramisu","Тирамису",sweet=.85,fat=.6,protein=.2,weight=.5,cream=.8,dessert=True,cuisine=["italian"],tags={"coffee":1,"cocoa":.8,"chocolate":.7,"dairy_cream":.8}),
 Dd("strudel","Штрудель",sweet=.75,sour=.2,fat=.4,protein=.1,weight=.5,maillard=.4,dessert=True,cuisine=["austrian","german"],tags={"orchard_fruit":.9,"warm_spice":.7,"caramel":.6,"bread":.5,"butter":.4}),
 Dd("caprese","Капрезе",salt=.3,sour=.55,fat=.35,protein=.4,weight=.25,cream=.4,fresh=.85,cold=True,cuisine=["italian"],tags={"tomato":1,"cheese":.6,"herbal":.7,"dairy_cream":.4}),
 Dd("kartoffelsalat","Картофельный салат",salt=.5,sour=.5,umami=.3,fat=.4,protein=.2,pungent=.4,weight=.5,vinegar=True,cuisine=["german"],tags={"potato":1,"mustard":.5,"bacon":.4}),
 Dd("schnitzel","Шницель",salt=.45,sour=.15,umami=.65,fat=.8,protein=.8,weight=.8,maillard=.75,cuisine=["german","austrian"],tags={"fried":.8,"bread":.6,"pork":.8,"citrus":.4,"butter":.5}),
 Dd("bratwurst","Братвурст / вайсвурст",salt=.7,umami=.7,fat=.85,protein=.8,pungent=.4,weight=.8,smoke=.5,maillard=.5,cuisine=["german"],tags={"pork":.9,"smoke":.5,"herbal":.4,"mustard":.5}),
 Dd("weisswurst","Вайсвурст",salt=.6,umami=.6,fat=.6,protein=.8,pungent=.3,weight=.55,fresh=.2,cuisine=["german","bavarian"],tags={"pork":.8,"herbal":.6,"mustard":.5,"citrus":.3,"dairy_cream":.2}),
 Dd("pretzel","Брецель",salt=.8,umami=.2,fat=.2,protein=.2,weight=.4,maillard=.5,cuisine=["german"],tags={"bread":1,"salt":.8,"toast":.6}),
 Dd("edamame","Эдамаме",salt=.8,umami=.3,fat=.15,protein=.5,weight=.2,fresh=.6,cuisine=["japanese"],tags={"beans":1,"green":.6}),
 Dd("oysters-raw","Устрицы сырые",salt=.6,sour=.3,umami=.7,fat=.2,protein=.5,weight=.2,fresh=.9,fish_oil=.3,cold=True,cuisine=["french","irish"],tags={"brine":1,"mineral":1,"citrus":.4}),
 Dd("mussels-steamed","Мидии на пару",salt=.5,sour=.2,umami=.6,fat=.3,protein=.5,pungent=.3,weight=.35,fresh=.5,fish_oil=.2,cuisine=["belgian","french"],tags={"brine":.6,"herbal":.5,"garlic":.4,"citrus":.3}),
 Dd("grilled-trout","Форель на гриле",salt=.4,umami=.6,fat=.4,protein=.7,weight=.4,maillard=.5,smoke=.3,fresh=.4,fish_oil=.5,cuisine=["international"],tags={"citrus":.5,"herbal":.4,"char":.4}),
 Dd("roast-pork","Свинина запечённая",salt=.5,umami=.8,fat=.7,protein=.9,weight=.8,maillard=.8,cuisine=["german","czech"],tags={"caramel":.6,"pork":1,"herbal":.3,"char":.4}),
 Dd("chocolate-fondant","Шоколадный фондан",sweet=.85,bitter=.3,fat=.6,protein=.2,weight=.55,cream=.3,dessert=True,cuisine=["french"],tags={"chocolate":1,"cocoa":1,"butter":.5}),
 Dd("chicken-curry","Карри с курицей",salt=.5,sweet=.15,sour=.1,umami=.6,fat=.55,protein=.6,heat=.55,pungent=.4,weight=.65,cream=.4,maillard=.2,cuisine=["indian"],tags={"warm_spice":.9,"citrus":.3,"herbal":.4,"dairy_cream":.4,"chili":.5}),
 Dd("cheesecake","Чизкейк",sweet=.85,sour=.2,fat=.7,protein=.3,weight=.55,cream=.9,dessert=True,cuisine=["american"],tags={"dairy_cream":1,"biscuit":.5,"vanilla":.5,"citrus":.3}),
 Dd("burrata","Буррата",salt=.3,sour=.1,umami=.3,fat=.6,protein=.5,weight=.3,cream=.9,fresh=.8,cold=True,cuisine=["italian"],tags={"dairy_cream":1,"herbal":.3,"olive":.4}),
 Dd("salmon-grilled","Лосось на гриле",salt=.45,umami=.7,fat=.7,protein=.8,weight=.55,maillard=.6,smoke=.3,fresh=.3,fish_oil=.9,cuisine=["international"],tags={"citrus":.4,"char":.4}),
 Dd("asparagus-grilled","Спаржа на гриле",salt=.2,sweet=.1,bitter=.3,umami=.6,fat=.2,protein=.2,weight=.25,maillard=.3,fresh=.6,green_iron=.8,cuisine=["french"],tags={"herbal":.6,"green":.8,"butter":.3}),
 Dd("beef-tartare","Тартар из говядины",salt=.4,sour=.3,umami=.8,fat=.4,protein=.8,pungent=.5,weight=.35,fresh=.9,cold=True,cuisine=["french"],tags={"beef":1,"citrus":.3,"mustard":.5,"egg":.4}),
 Dd("cheese-aged","Выдержанный сыр / рокфор",salt=.8,bitter=.1,umami=.8,fat=.8,protein=.9,weight=.6,cream=.3,cuisine=["french","english"],tags={"cheese":1,"nutty":.6,"brine":.4,"dairy_cream":.5}),
 Dd("dark-chocolate","Тёмный шоколад 70%",sweet=.5,bitter=.7,fat=.5,protein=.2,weight=.5,dessert=True,cuisine=["international"],tags={"chocolate":1,"cocoa":1,"coffee":.3,"dark_fruit":.3}),
 Dd("risotto","Ризотто",salt=.45,umami=.7,fat=.55,protein=.4,weight=.55,cream=.7,cuisine=["italian"],tags={"rice":1,"cheese":.6,"butter":.6,"dairy_cream":.7}),
]

# Enum-поля эталонных блюд (в прототипе их нет — размечены здесь).
# spec = (dominant_taste, weight, fat_level) — только для контрольного автозаполнения; у блюд из v1 берётся из v1.
# share — доля белкового ингредиента для автозаполнения protein. Вектор эталона от этих полей не зависит.
def E(cook, protein, sauce, acid, serve, spec=None, share=1.0, heat=None):
    return dict(cook=cook, protein=protein, sauce=sauce, acid=acid, serve=serve, spec=spec, share=share, heat=heat)


PROTO_ENUMS = {
    "beshbarmak": E("boiled", "lamb", "broth", "none", "hot"),
    "kazy": E("cured", "horse", "none", "none", "room"),
    "kuyrdak": E("fried", "lamb", "none", "none", "hot"),
    "shashlyk": E("grilled", "lamb", "none", "none", "hot"),
    "plov": E("braised", "lamb", "none", "none", "hot", share=.67),
    "kurt": E("cured", "cheese_hard", "none", "lactic", "room", share=.8),   # прототип: cold=True; по факту курт — закуска комнатной температуры
    "samsa": E("baked", "lamb", "none", "none", "hot", share=.78),
    "manty": E("steamed", "lamb", "none", "none", "hot", share=.78),
    "lagman-spicy": E("braised", "lamb", "chili", "tomato", "hot", ("SPICY", "HEAVY", "MEDIUM"), .78, heat=.6),
    "chak-chak": E("fried", "none", "sweet_glaze", "none", "room", ("SWEET", "MEDIUM", "MEDIUM")),
    "okroshka": E("raw", "beef", "none", "lactic", "cold", ("SOUR", "LIGHT", "LOW"), .45),
    "sushi": E("raw", "white_fish", "soy", "vinegar", "cold", share=.85),   # §3.4: acid_type=vinegar (мягкий)
    "ramen": E("boiled", "pork", "broth", "none", "hot", share=.7),
    "steak": E("grilled", "beef", "none", "none", "hot"),
    "burger": E("grilled", "beef", "none", "none", "hot", share=.85),
    "bbq-ribs": E("smoked", "pork", "bbq", "none", "hot"),
    "buffalo-wings": E("fried", "poultry", "chili", "vinegar", "hot"),     # соус Buffalo — уксусный острый соус + масло
    "nachos": E("baked", "cheese_soft", "cheese", "tomato", "hot", share=.8),
    "tacos": E("grilled", "beef", "chili", "citrus", "hot", share=.85),
    "chili-con-carne": E("braised", "beef", "chili", "tomato", "hot", share=.75),
    "mac-and-cheese": E("baked", "cheese_hard", "cheese", "none", "hot", share=.55),
    "tiramisu": E("raw", "dairy", "none", "none", "cold"),
    "strudel": E("baked", "none", "none", "none", "hot"),
    "caprese": E("raw", "cheese_soft", "none", "tomato", "cold", share=.8),
    "kartoffelsalat": E("boiled", "none", "vinaigrette", "vinegar", "room"),
    "schnitzel": E("fried", "pork", "none", "citrus", "hot", share=.95),
    "bratwurst": E("grilled", "pork", "none", "none", "hot", share=.95),
    "weisswurst": E("boiled", "pork", "none", "none", "hot", ("SALTY", "MEDIUM", "MEDIUM"), .95),
    "pretzel": E("baked", "none", "none", "none", "room"),
    "edamame": E("boiled", "legume", "none", "none", "hot"),
    "oysters-raw": E("raw", "shellfish", "none", "citrus", "cold", ("SALTY", "LIGHT", "LOW")),
    "mussels-steamed": E("steamed", "shellfish", "broth", "none", "hot", ("UMAMI", "LIGHT", "LOW")),
    "grilled-trout": E("grilled", "oily_fish", "none", "citrus", "hot", ("UMAMI", "MEDIUM", "MEDIUM")),
    "roast-pork": E("baked", "pork", "none", "none", "hot", ("UMAMI", "HEAVY", "HIGH")),
    "chocolate-fondant": E("baked", "none", "none", "none", "hot", ("SWEET", "MEDIUM", "MEDIUM")),
    "chicken-curry": E("braised", "poultry", "cream", "none", "hot", ("SPICY", "MEDIUM", "MEDIUM"), .85, heat=.55),
    "cheesecake": E("baked", "cheese_soft", "none", "lactic", "cold", ("SWEET", "MEDIUM", "HIGH")),
    "burrata": E("raw", "cheese_soft", "none", "lactic", "cold", ("SALTY", "LIGHT", "MEDIUM")),
    "salmon-grilled": E("grilled", "oily_fish", "none", "citrus", "hot", ("UMAMI", "MEDIUM", "MEDIUM")),
    "asparagus-grilled": E("grilled", "none", "none", "none", "hot", ("UMAMI", "LIGHT", "LOW")),
    "beef-tartare": E("raw", "beef", "none", "citrus", "cold", ("UMAMI", "LIGHT", "MEDIUM"), .85),
    "cheese-aged": E("cured", "cheese_hard", "none", "none", "room", ("SALTY", "MEDIUM", "HIGH")),
    "dark-chocolate": E("raw", "none", "none", "none", "room", ("BITTER", "MEDIUM", "MEDIUM")),
    "risotto": E("boiled", "cheese_hard", "cheese", "none", "hot", share=.45),
}

# Метаданные эталонных блюд, которых нет в v1 (у остальных берутся из data/dishes.json).
def Meta(emoji, category, description, synonyms):
    return dict(emoji=emoji, category=category, description=description, synonyms=synonyms)


PROTO_META = {
    "lagman-spicy": Meta("🌶️", "Лапша", "Уйгурский лагман с тянутой лапшой, бараниной, перцем, томатами и чесноком; острый вариант — с чили и маслом ладжан.",
                         ["острый лагман", "лагман с ладжаном", "лагман острый", "spicy lagman"]),
    "chak-chak": Meta("🍯", "Десерт", "Обжаренные кусочки теста, залитые горячим мёдом; подают к чаю.",
                      ["шак-шак", "чакчак", "chak-chak"]),
    "okroshka": Meta("🥒", "Суп холодный", "Холодный суп на квасе или кефире с огурцом, редисом, зеленью, яйцом и отварным мясом.",
                     ["окрошка на квасе", "окрошка на кефире", "холодный суп", "okroshka"]),
    "weisswurst": Meta("🌭", "Колбасы", "Баварские белые колбаски из телятины и свинины с петрушкой и лимонной цедрой; их прогревают в горячей воде и подают со сладкой горчицей и брецелем.",
                       ["белые колбаски", "мюнхенские колбаски", "weisswurst", "weißwurst"]),
    "oysters-raw": Meta("🦪", "Морепродукты", "Сырые устрицы на льду с лимоном.",
                        ["устрицы", "свежие устрицы", "oysters"]),
    "mussels-steamed": Meta("🐚", "Морепродукты", "Мидии, приготовленные на пару в белом вине с луком-шалотом, чесноком и петрушкой.",
                            ["мидии", "мидии в вине", "мидии в белом вине", "moules"]),
    "grilled-trout": Meta("🐟", "Рыба", "Форель целиком или филе на гриле с лимоном и зеленью.",
                          ["форель", "форель гриль", "trout"]),
    "roast-pork": Meta("🍖", "Мясное", "Свиная шея или окорок, запечённые до карамельной корочки; немецко-чешская подача с тушёной капустой.",
                       ["запечённая свинина", "свиная шея", "schweinebraten", "вепрево"]),
    "chocolate-fondant": Meta("🍫", "Десерт", "Шоколадный кекс с жидкой серединой, подаётся тёплым.",
                              ["фондан", "шоколадный кекс", "лава-кейк", "fondant"]),
    "chicken-curry": Meta("🍛", "Основное", "Курица, тушённая в пряном соусе карри со сливками или кокосовым молоком; подаётся с рисом.",
                          ["карри", "куриное карри", "тикка масала", "баттер чикен", "chicken curry"]),
    "cheesecake": Meta("🍰", "Десерт", "Запечённый сливочный чизкейк на песочной основе (нью-йоркский).",
                       ["чизкейк нью-йорк", "cheesecake", "сырный торт"]),
    "burrata": Meta("🧀", "Закуска", "Свежий сыр из моцареллы со сливочной начинкой страчателла; подают с томатами, оливковым маслом и зеленью.",
                    ["бурата", "burrata"]),
    "salmon-grilled": Meta("🐟", "Рыба", "Стейк лосося на гриле с лимоном.",
                           ["лосось", "сёмга", "стейк из лосося", "сёмга на гриле", "salmon"]),
    "asparagus-grilled": Meta("🌿", "Овощи", "Зелёная спаржа на гриле со сливочным маслом.",
                              ["спаржа", "asparagus"]),
    "beef-tartare": Meta("🥩", "Закуска", "Мелко рубленная сырая говядина с каперсами, луком-шалотом, горчицей и желтком.",
                         ["тартар", "стейк-тартар", "tartare"]),
    "cheese-aged": Meta("🧀", "Сыры", "Твёрдый выдержанный сыр (пармезан, выдержанный чеддер) или голубой сыр (рокфор, горгонзола).",
                        ["рокфор", "пармезан", "горгонзола", "дорблю", "голубой сыр", "выдержанный сыр"]),
    "dark-chocolate": Meta("🍫", "Десерт", "Горький шоколад с содержанием какао около 70 %.",
                           ["горький шоколад", "тёмный шоколад", "шоколад"]),
}

# Правки метаданных v1 у эталонных блюд (v1-файл не трогаем)
LEGACY_META_FIX = {
    # в v1 «стейк» описан как рибай; в v2 рибай — отдельное блюдо (ribeye-steak, жирнее)
    "steak": {"description": "Говяжий стейк на гриле (стриплойн, филе) со сливочным маслом и розмарином"},
}
# Синонимы v1, которые в v2 указывают на отдельные новые блюда
SYNONYM_DROP = {
    "manty": ["пельмени", "хинкали"],        # → pelmeni, khinkali
    "burger": ["чизбургер"],                 # → cheeseburger
    "steak": ["рибай"],                      # → ribeye-steak
    "burrito": ["шаурма", "донер"],          # → shawarma
    "zheti-as": ["мясная нарезка"],          # → cold-cuts
    "currywurst": ["карри"],                 # «карри» → chicken-curry
}
SYNONYM_ADD = {
    "zheti-as": ["казахская мясная нарезка"],
    "bratwurst": ["баварские колбаски"],
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. БЛЮДА v1, КОТОРЫХ НЕТ В ПРОТОТИПЕ (21) — перенос
#    Итог = автозаполнение → поверх 12 осей v1 (ручная разметка v1) → поверх fix (правки v2).
#    Новые оси protein / fish_oil / pungent / green_iron берутся из автозаполнения, если нет в fix.
#    ref — ближайшее эталонное блюдо для сверки шкалы (--report).
# ─────────────────────────────────────────────────────────────────────────────
def M(cook, protein, sauce, acid, serve, tags, share=1.0, dessert=False, fix=None, ref=None, why=""):
    return dict(cook=cook, protein=protein, sauce=sauce, acid=acid, serve=serve, tags=tags, share=share,
                dessert=dessert, fix=fix or {}, ref=ref, why=why)


MIGRATED = {
    "shuzhyk": M("cured", "horse", "none", "none", "room", {"cured": .8, "garlic": .6, "pepper": .4, "smoke": .5},
                 fix={"smoke": .5}, ref="kazy",
                 why="дым .3 → .5, как у казы (§3.4): шужык — та же копчёная конская колбаса; spice .4 → тег pepper"),
    "zhaya": M("smoked", "horse", "none", "none", "room", {"smoke": .9, "cured": .8, "pepper": .3},
               fix={"smoke": .9}, ref="kazy",
               why="дым .6 → .9 по опорной точке шкалы §3.1 №13 («.9 BBQ, жая»)"),
    "irimshik": M("boiled", "dairy", "none", "lactic", "room", {"caramel": .6, "dairy_cream": .7, "sour_lactic": .3},
                  fix={"protein": .45}, ref="kurt",
                  why="сушёный творог: белка больше, чем даёт dairy (.3); сладость .6 — не десерт, сладость к чаю"),
    "baursaki": M("fried", "none", "none", "none", "room", {"bread": .9, "fried": .7, "yeast": .3}, ref="pretzel"),
    "zheti-as": M("cured", "horse", "none", "none", "room", {"cured": .9, "smoke": .6, "garlic": .5, "pepper": .4},
                  fix={"smoke": .6}, ref="kazy",
                  why="дым .4 → .6: ассорти из казы (.5), шужыка (.5) и жая (.9)"),
    "pizza-margherita": M("baked", "cheese_soft", "tomato", "tomato", "hot",
                          {"bread": .8, "tomato": .8, "cheese": .7, "herbal": .5, "dairy_cream": .3, "olive": .2},
                          share=.8, ref="caprese"),
    "carbonara": M("boiled", "pork", "cream", "none", "hot",
                   {"cheese": .7, "bacon": .6, "egg": .5, "pepper": .5, "dairy_cream": .6, "pork": .4},
                   share=.6, ref="mac-and-cheese"),
    "bruschetta": M("baked", "none", "none", "tomato", "room",
                    {"bread": .9, "toast": .5, "tomato": 1, "garlic": .5, "herbal": .6, "olive": .5}, ref="caprese"),
    "lasagna": M("baked", "beef", "tomato", "tomato", "hot",
                 {"cheese": .8, "tomato": .6, "beef": .7, "bread": .5, "dairy_cream": .5}, share=.75, ref="mac-and-cheese"),
    "tempura": M("fried", "shellfish", "soy", "none", "hot", {"fried": .8, "bread": .4, "brine": .4, "shellfish": .6},
                 ref="schnitzel", why="креветки в кляре; соус тэнцую на соевой основе подают отдельно — соль v1 .4 сохранена"),
    "yakitori": M("grilled", "poultry", "soy", "none", "hot", {"char": .7, "smoke": .6, "caramel": .5, "chicken": .8},
                  ref="shashlyk", why="глазурь тарэ (соевый соус, мирин, сахар)"),
    "mochi": M("steamed", "none", "none", "none", "room", {"rice": .7, "red_fruit": .4}, dessert=True, ref="chak-chak",
               why="is_dessert (§3.4)"),
    "tonkatsu": M("fried", "pork", "sweet_glaze", "none", "hot", {"fried": .8, "bread": .6, "pork": .8, "caramel": .3},
                  fix={"sweet": .2, "sour": .1}, ref="schnitzel",
                  why="соус тонкацу (фруктово-пряный, сладко-кислый) — sweet .2, sour .1; в v1 соус не учитывался"),
    "apple-pie": M("baked", "none", "none", "none", "room",
                   {"orchard_fruit": .9, "warm_spice": .5, "caramel": .5, "butter": .4, "bread": .5},
                   dessert=True, ref="strudel", why="is_dessert (§3.4); spice .5 (корица) → тег warm_spice"),
    "burrito": M("baked", "beef", "chili", "none", "hot",
                 {"rice": .6, "beans": .6, "chili": .6, "cheese": .5, "beef": .5, "smoke": .3, "bread": .3},
                 share=.7, ref="chili-con-carne"),
    "guacamole": M("raw", "none", "none", "citrus", "cold",
                   {"citrus": .8, "herbal": .6, "chili": .4, "onion": .3, "corn": .4},
                   fix={"protein": .1}, ref="caprese", why="авокадо почти без белка; кукурузные чипсы — гарнир"),
    "quesadilla": M("fried", "poultry", "cheese", "none", "hot",
                    {"cheese": .9, "chicken": .5, "corn": .3, "tomato": .3, "chili": .3}, share=.8, ref="nachos"),
    "enchilada": M("baked", "poultry", "chili", "tomato", "hot",
                   {"chili": .8, "corn": .7, "cheese": .6, "chicken": .5, "tomato": .5}, share=.8, ref="chili-con-carne"),
    "churros": M("fried", "none", "none", "none", "hot",
                 {"fried": .6, "bread": .5, "warm_spice": .5, "chocolate": .5, "caramel": .4},
                 dessert=True, ref="chak-chak", why="is_dessert (§3.4); spice .4 (корица) → тег warm_spice"),
    "sauerkraut": M("fermented", "none", "none", "lactic", "cold",
                    {"sour_lactic": .9, "cabbage": .8, "brine": .3, "juniper": .3}, ref="kartoffelsalat"),
    "currywurst": M("fried", "pork", "tomato", "tomato", "hot",
                    {"pork": .8, "warm_spice": .7, "tomato": .6, "fried": .4, "caramel": .3},
                    fix={"heat": .3, "sour": .2}, ref="bratwurst",
                    why="острота .55 → .3: карри-кетчуп обычно мягкий, порошок карри — пряность, а не капсаицин; "
                        "томатный соус даёт sour .2 (§3.3: tomato sour .35 × .6)"),
}

# ─────────────────────────────────────────────────────────────────────────────
# 5. НОВЫЕ БЛЮДА (manual) — частые позиции меню ресторанов и баров Казахстана
#    Вектор задан явно (как в прототипе), spec — категориальные поля для автозаполнения,
#    по нему --report показывает, где ручная разметка расходится с автоматикой.
# ─────────────────────────────────────────────────────────────────────────────
def N(id, name, emoji, category, cuisine, description, synonyms, cook, protein, sauce, acid, serve, spec, tags,
      vec, dessert=False, share=1.0, heat=None, ref=None):
    return dict(id=id, name=name, emoji=emoji, category=category, cuisine=cuisine, description=description,
                synonyms=synonyms, cook=cook, protein=protein, sauce=sauce, acid=acid, serve=serve, spec=spec,
                tags=tags, vec=vec, dessert=dessert, share=share, heat=heat, ref=ref)


V = dict  # короткий алиас: V(salt=.5, ...) — неуказанные оси = 0

NEW = [
    # ── Казахская и центральноазиатская ──
    N("sorpa", "Сорпа", "🍲", "Супы", ["kazakh"],
      "Крепкий мясной бульон, оставшийся после варки мяса для бешбармака; подают в кесе, иногда с куртом.",
      ["сорпа", "сурпа", "шурпа", "бульон", "sorpa"],
      "boiled", "lamb", "broth", "none", "hot", ("UMAMI", "LIGHT", "MEDIUM"),
      {"broth": 1, "lamb": .5, "onion": .4, "herbal": .2},
      V(salt=.5, umami=.75, fat=.45, protein=.3, pungent=.2, weight=.4), share=.35, ref="beshbarmak"),
    N("nauryz-kozhe", "Наурыз-коже", "🥣", "Супы", ["kazakh"],
      "Праздничный кисломолочный суп из семи ингредиентов: вода, мясо, соль, жир, крупа, мука и айран или катык; подают комнатной температуры.",
      ["наурыз көже", "наурыз коже", "коже", "көже"],
      "boiled", "dairy", "none", "lactic", "room", ("SOUR", "MEDIUM", "LOW"),
      {"sour_lactic": .8, "grain": .7, "dairy_cream": .5, "cured": .3},
      V(salt=.4, sour=.5, umami=.3, fat=.3, protein=.35, weight=.45, cream=.4, smoke=.1), ref="okroshka"),
    N("baursaki-kaimak", "Баурсаки с каймаком", "🍩", "Тестовое", ["kazakh"],
      "Горячие баурсаки с каймаком — густыми топлёными сливками; подают к чаю, иногда с мёдом или вареньем.",
      ["бауырсақ с каймаком", "баурсак с каймаком", "каймак"],
      "fried", "dairy", "cream", "none", "room", ("MIXED", "MEDIUM", "HIGH"),
      {"bread": .8, "fried": .6, "dairy_cream": .8, "yeast": .3},
      V(salt=.25, sweet=.35, umami=.3, fat=.7, protein=.2, weight=.55, cream=.6, maillard=.6), ref="baursaki"),
    N("lagman", "Лагман", "🍜", "Лапша", ["uyghur", "central_asian"],
      "Уйгурский лагман: тянутая лапша с обжаренной говядиной, болгарским перцем, томатами, чесноком и редькой; неострый вариант.",
      ["лагман", "лағман", "гуйру лагман", "суйру лагман", "lagman"],
      "braised", "beef", "tomato", "tomato", "hot", ("UMAMI", "HEAVY", "MEDIUM"),
      {"noodles": .9, "beef": .6, "garlic": .5, "bread": .4, "tomato": .4, "pepper": .4, "warm_spice": .3, "herbal": .2},
      V(salt=.5, sweet=.05, sour=.15, umami=.7, fat=.5, protein=.7, heat=.1, pungent=.45, weight=.8, maillard=.4,
        smoke=.1, fresh=.15), share=.75, heat=.1, ref="lagman-spicy"),
    N("manty-pumpkin", "Манты с тыквой", "🎃", "Тестовое (на пару)", ["central_asian", "kazakh"],
      "Паровые манты с начинкой из тыквы, лука и курдючного жира; подают со сметаной.",
      ["манты с тыквой", "тыквенные манты", "кәді манты"],
      "steamed", "none", "none", "none", "hot", ("UMAMI", "MEDIUM", "MEDIUM"),
      {"bread": .6, "pumpkin": .8, "onion": .5, "pepper": .3},
      V(salt=.4, sweet=.2, umami=.35, fat=.45, protein=.25, pungent=.3, weight=.55, fresh=.25), ref="manty"),
    N("plov-fergana", "Плов ферганский", "🍛", "Мясное с рисом", ["central_asian"],
      "Узбекский плов ферганского типа: баранина и жёлтая морковь, обжаренные в хлопковом масле, рис девзира, зира, нут.",
      ["ферганский плов", "узбекский плов", "плов по-узбекски"],
      "braised", "lamb", "none", "none", "hot", ("UMAMI", "HEAVY", "HIGH"),
      {"rice": 1, "warm_spice": .8, "lamb": .7, "caramel": .5, "beans": .3},
      V(salt=.45, sweet=.25, umami=.7, fat=.75, protein=.6, weight=.9, maillard=.45), share=.67, ref="plov"),
    N("ganfan", "Ганфан", "🍚", "Мясное с рисом", ["uyghur", "central_asian"],
      "Уйгурское блюдо: рис с обжаренными говядиной и овощами в томатно-чесночном соусе.",
      ["ганфан", "гаңфан", "рис с подливой"],
      "braised", "beef", "tomato", "tomato", "hot", ("UMAMI", "HEAVY", "MEDIUM"),
      {"rice": .9, "beef": .6, "garlic": .5, "pepper": .5, "tomato": .4, "warm_spice": .3},
      V(salt=.5, sweet=.05, sour=.15, umami=.7, fat=.5, protein=.6, heat=.2, pungent=.4, weight=.75, maillard=.35,
        fresh=.1), share=.65, heat=.2, ref="lagman-spicy"),
    N("ashlyam-fu", "Ашлям-фу", "🍜", "Лапша (холодная)", ["chinese", "central_asian"],
      "Дунганский холодный суп: крахмальное желе и лапша в уксусно-острой заправке с чесноком и яичным блинчиком.",
      ["ашлянфу", "ашлямфу", "ашлям фу"],
      "boiled", "egg", "vinaigrette", "vinegar", "cold", ("SOUR", "MEDIUM", "LOW"),
      {"noodles": .8, "chili": .6, "garlic": .6, "egg": .4, "herbal": .3, "pepper": .3},
      V(salt=.5, sweet=.1, sour=.55, umami=.35, fat=.3, protein=.25, heat=.5, pungent=.5, weight=.4, fresh=.4),
      share=.5, heat=.5, ref="okroshka"),
    N("kuyrdak-liver", "Куырдак из печени", "🍲", "Мясное (жареные потроха)", ["kazakh"],
      "Бауыр куырдак: печень, сердце и лёгкое, обжаренные с луком на курдючном жиру.",
      ["бауыр куырдак", "бауыр қуырдақ", "жареная печень", "печень с луком"],
      "fried", "lamb", "none", "none", "hot", ("UMAMI", "HEAVY", "HIGH"),
      {"offal": .9, "onion": .6, "fried": .6, "pepper": .4},
      V(salt=.5, bitter=.15, umami=.85, fat=.65, protein=.85, pungent=.4, weight=.75, maillard=.65), ref="kuyrdak"),
    N("achichuk", "Ачичук", "🍅", "Салаты", ["central_asian", "kazakh"],
      "Салат к плову из тонко нарезанных томатов и репчатого лука, иногда с острым перцем и зеленью; без масла.",
      ["ачик-чучук", "шакароб", "салат к плову", "помидоры с луком"],
      "raw", "none", "none", "tomato", "cold", ("SOUR", "LIGHT", "LOW"),
      {"tomato": 1, "onion": .8, "herbal": .5, "pepper": .3},
      V(salt=.35, sour=.45, fat=.05, protein=.05, heat=.15, pungent=.5, weight=.15, fresh=.85), heat=.15, ref="caprese"),
    N("shashlyk-chicken", "Шашлык из курицы", "🍢", "Мясное (гриль)", ["kazakh", "caucasian"],
      "Куриное бедро или филе в маринаде со специями, на углях.",
      ["куриный шашлык", "шашлык из курицы", "тауық шашлык"],
      "grilled", "poultry", "none", "none", "hot", ("UMAMI", "MEDIUM", "MEDIUM"),
      {"smoke": .9, "char": .8, "chicken": .8, "onion": .5, "pepper": .4, "herbal": .3},
      V(salt=.5, umami=.6, fat=.4, protein=.75, pungent=.3, weight=.6, maillard=.75, smoke=.75), ref="shashlyk"),
    N("lyulya-kebab", "Люля-кебаб", "🍢", "Мясное (гриль)", ["caucasian", "turkish", "central_asian"],
      "Рубленая баранина с курдючным жиром и луком на шампуре, на углях; подают с луком, сумахом и лавашом.",
      ["люля", "люля кебаб", "кебаб из баранины", "lula kebab"],
      "grilled", "lamb", "none", "none", "hot", ("UMAMI", "HEAVY", "HIGH"),
      {"smoke": .9, "lamb": .9, "char": .8, "onion": .6, "warm_spice": .4, "herbal": .4},
      V(salt=.5, sour=.1, umami=.8, fat=.75, protein=.85, pungent=.4, weight=.75, maillard=.75, smoke=.8), ref="shashlyk"),
    # ── Кавказская, татарская, русская ──
    N("chebureki", "Чебуреки", "🥟", "Тестовое (с мясом)", ["tatar", "russian"],
      "Жаренные во фритюре тонкие пирожки-полумесяцы с сочным фаршем и луком.",
      ["чебурек", "чибурек", "шыбөрек"],
      "fried", "lamb", "none", "none", "hot", ("UMAMI", "MEDIUM", "HIGH"),
      {"bread": .7, "fried": .7, "onion": .5, "lamb": .5, "pepper": .4},
      V(salt=.5, umami=.6, fat=.8, protein=.55, pungent=.3, weight=.6, maillard=.6), share=.6, ref="samsa"),
    N("pelmeni", "Пельмени", "🥟", "Тестовое (варёное)", ["russian"],
      "Отварные пельмени с мясным фаршем и луком; подают со сметаной или сливочным маслом.",
      ["пельмени", "пельмени со сметаной", "сибирские пельмени", "pelmeni"],
      "boiled", "beef", "cream", "lactic", "hot", ("UMAMI", "MEDIUM", "MEDIUM"),
      {"bread": .6, "beef": .5, "onion": .4, "pepper": .4, "dairy_cream": .4, "sour_lactic": .2},
      V(salt=.45, sour=.1, umami=.7, fat=.55, protein=.65, pungent=.3, weight=.65, cream=.3), share=.7, ref="manty"),
    N("khinkali", "Хинкали", "🥟", "Тестовое (варёное)", ["caucasian"],
      "Грузинские варёные пельмени-мешочки с говяжье-свиным фаршем, зеленью, чёрным перцем и бульоном внутри.",
      ["хинкали", "хинкал", "khinkali"],
      "boiled", "beef", "broth", "none", "hot", ("UMAMI", "HEAVY", "MEDIUM"),
      {"pepper": .7, "bread": .6, "beef": .6, "onion": .5, "broth": .5, "herbal": .4},
      V(salt=.5, umami=.75, fat=.6, protein=.7, heat=.1, pungent=.35, weight=.75, fresh=.1), share=.75, ref="manty"),
    N("khachapuri-adjarian", "Хачапури по-аджарски", "🧀", "Выпечка", ["caucasian"],
      "Лодочка из дрожжевого теста с расплавленным сулугуни и имерули, яичным желтком и сливочным маслом.",
      ["хачапури", "аджарули", "хачапури лодочка", "khachapuri"],
      "baked", "cheese_soft", "cheese", "none", "hot", ("SALTY", "HEAVY", "HIGH"),
      {"bread": .9, "cheese": 1, "dairy_cream": .7, "butter": .6, "egg": .5, "brine": .3},
      V(salt=.6, sour=.1, umami=.55, fat=.85, protein=.5, weight=.85, cream=.8, maillard=.55), ref="mac-and-cheese"),
    N("dolma", "Долма", "🍃", "Мясное", ["caucasian", "turkish"],
      "Виноградные листья с начинкой из рубленой баранины и риса, тушённые в бульоне; подают с мацони и чесноком.",
      ["толма", "долма в виноградных листьях", "dolma"],
      "braised", "lamb", "none", "lactic", "hot", ("UMAMI", "MEDIUM", "MEDIUM"),
      {"herbal": .6, "lamb": .6, "rice": .5, "sour_lactic": .5, "garlic": .4, "green": .3, "mint": .3},
      V(salt=.45, sour=.3, bitter=.1, umami=.6, fat=.5, protein=.6, pungent=.35, weight=.55, cream=.2, fresh=.1),
      share=.65, ref="manty"),
    N("herring-shuba", "Сельдь под шубой", "🐟", "Салаты", ["russian"],
      "Слоёный салат из солёной сельди, варёных картофеля, моркови и свёклы с луком и майонезом.",
      ["шуба", "селёдка под шубой", "сельдь под шубой"],
      "cured", "oily_fish", "cream", "vinegar", "cold", ("SALTY", "MEDIUM", "HIGH"),
      {"fish": .7, "brine": .6, "potato": .5, "onion": .4},
      V(salt=.6, sweet=.3, sour=.2, umami=.45, fat=.6, protein=.35, pungent=.3, weight=.5, cream=.5, fresh=.2,
        fish_oil=.6), share=.45, ref="sushi"),
    N("olivier", "Оливье", "🥗", "Салаты", ["russian"],
      "Салат из варёных картофеля, моркови и яиц, маринованных огурцов, горошка и курицы (или колбасы) с майонезом.",
      ["оливье", "столичный салат", "русский салат", "olivier"],
      "boiled", "poultry", "cream", "vinegar", "cold", ("MIXED", "MEDIUM", "HIGH"),
      {"potato": .8, "egg": .5, "cucumber": .4, "brine": .3, "chicken": .3},
      V(salt=.5, sweet=.05, sour=.2, umami=.35, fat=.6, protein=.35, pungent=.2, weight=.5, cream=.5, fresh=.2),
      share=.5, ref="kartoffelsalat"),
    N("borsch", "Борщ", "🍲", "Супы", ["ukrainian", "russian"],
      "Суп на говяжьем бульоне со свёклой, капустой, картофелем и томатом; подают со сметаной, чесноком и зеленью.",
      ["борщ", "украинский борщ", "борщ со сметаной", "borscht"],
      "boiled", "beef", "broth", "tomato", "hot", ("SOUR", "MEDIUM", "MEDIUM"),
      {"broth": .8, "beef": .5, "tomato": .4, "garlic": .4, "dairy_cream": .3, "herbal": .3},
      V(salt=.5, sweet=.2, sour=.3, umami=.6, fat=.45, protein=.45, pungent=.3, weight=.65, cream=.25), share=.5,
      ref="ramen"),
    N("solyanka", "Солянка мясная", "🍲", "Супы", ["russian"],
      "Густой кисло-солёный суп на мясном бульоне с копчёностями, солёными огурцами, оливками, каперсами и лимоном.",
      ["солянка", "сборная солянка", "солянка сборная мясная"],
      "boiled", "pork", "broth", "lactic", "hot", ("SALTY", "MEDIUM", "MEDIUM"),
      {"broth": .8, "cured": .7, "brine": .7, "pork": .5, "smoke": .4, "cucumber": .4, "olive": .4, "citrus": .4,
       "tomato": .3},
      V(salt=.75, sweet=.05, sour=.45, umami=.75, fat=.55, protein=.6, pungent=.2, weight=.65, cream=.15, smoke=.35),
      share=.7, ref="ramen"),
    N("vobla", "Вобла (вяленая рыба)", "🐟", "Закуски к пиву", ["russian", "kazakh"],
      "Вяленая солёная каспийская вобла или плотва — классическая закуска к пиву.",
      ["вобла", "вяленая рыба", "таранка", "сушёная рыба", "рыба к пиву", "лещ вяленый"],
      "cured", "white_fish", "none", "none", "room", ("SALTY", "LIGHT", "LOW"),
      {"brine": .9, "fish": .9, "cured": .9},
      V(salt=.95, umami=.8, fat=.35, protein=.8, weight=.3, fish_oil=.6), ref="kurt"),
    N("crayfish-boiled", "Раки варёные", "🦞", "Закуски к пиву", ["russian"],
      "Речные раки, сваренные в солёной воде с укропом, лавровым листом и перцем.",
      ["раки", "варёные раки", "раки с укропом"],
      "boiled", "shellfish", "none", "none", "hot", ("SALTY", "LIGHT", "LOW"),
      {"shellfish": .8, "herbal": .7, "brine": .5, "mineral": .3, "pepper": .2},
      V(salt=.65, sweet=.1, umami=.65, fat=.15, protein=.55, weight=.35, fresh=.35, fish_oil=.2), ref="mussels-steamed"),
    N("garlic-croutons", "Гренки чесночные", "🍞", "Закуски к пиву", ["russian"],
      "Брусочки ржаного хлеба, обжаренные во фритюре и натёртые чесноком; часто с сырным соусом.",
      ["гренки", "чесночные гренки", "гренки с чесноком", "сухарики"],
      "fried", "none", "none", "none", "hot", ("SALTY", "LIGHT", "MEDIUM"),
      {"bread": .9, "garlic": .9, "toast": .7, "fried": .5},
      V(salt=.65, umami=.25, fat=.6, protein=.15, pungent=.6, weight=.35, maillard=.65), ref="pretzel"),
    N("napoleon", "Торт «Наполеон»", "🍰", "Десерт", ["russian", "french"],
      "Слоёные коржи, пропитанные заварным кремом.",
      ["наполеон", "торт наполеон", "мильфей"],
      "baked", "none", "none", "none", "cold", ("SWEET", "MEDIUM", "HIGH"),
      {"dairy_cream": .9, "biscuit": .6, "butter": .6, "vanilla": .5, "caramel": .2},
      V(sweet=.8, fat=.7, protein=.15, weight=.6, cream=.75, maillard=.4), dessert=True, ref="cheesecake"),
    N("medovik", "Медовик", "🍰", "Десерт", ["russian"],
      "Медовые коржи со сметанным кремом.",
      ["медовый торт", "медовик", "торт медовик"],
      "baked", "none", "none", "lactic", "cold", ("SWEET", "MEDIUM", "MEDIUM"),
      {"honey": 1, "caramel": .7, "dairy_cream": .7, "biscuit": .6},
      V(sweet=.85, sour=.1, fat=.6, protein=.15, weight=.6, cream=.6, maillard=.45), dessert=True, ref="chak-chak"),
    N("baklava", "Пахлава", "🍯", "Десерт", ["turkish", "caucasian", "central_asian"],
      "Тонкое слоёное тесто с грецким орехом или фисташкой, пропитанное медовым или сахарным сиропом.",
      ["баклава", "пахлава", "baklava"],
      "baked", "none", "sweet_glaze", "none", "room", ("SWEET", "MEDIUM", "MEDIUM"),
      {"honey": .9, "nutty": .9, "caramel": .5, "butter": .5, "bread": .3, "warm_spice": .3},
      V(sweet=.95, fat=.6, protein=.2, weight=.5, maillard=.5), dessert=True, ref="chak-chak"),
    # ── Паб и стритфуд ──
    N("shawarma", "Шаурма", "🌯", "Стритфуд", ["turkish", "international"],
      "Курица с вертикального гриля в лаваше с капустой, огурцами, томатами и чесночным соусом.",
      ["шаурма", "шаверма", "донер", "дөнер", "shawarma"],
      "grilled", "poultry", "cream", "none", "hot", ("UMAMI", "HEAVY", "HIGH"),
      {"garlic": .7, "chicken": .7, "bread": .6, "cucumber": .3, "tomato": .3, "char": .3, "warm_spice": .3},
      V(salt=.55, sweet=.05, sour=.15, umami=.6, fat=.65, protein=.6, heat=.1, pungent=.5, weight=.75, cream=.35,
        maillard=.5, smoke=.2, fresh=.25), share=.8, heat=.1, ref="burger"),
    N("fries", "Картофель фри", "🍟", "Закуски к пиву", ["belgian", "american", "international"],
      "Картофель, обжаренный во фритюре, с солью; к нему обычно кетчуп или сырный соус.",
      ["фри", "картошка фри", "картофель фри", "french fries"],
      "fried", "none", "none", "none", "hot", ("SALTY", "MEDIUM", "MEDIUM"),
      {"potato": 1, "fried": .8},
      V(salt=.6, umami=.2, fat=.6, protein=.15, weight=.45, maillard=.6), ref="pretzel"),
    N("bbq-wings", "Куриные крылышки BBQ", "🍗", "Птица/Снеки", ["american"],
      "Обжаренные куриные крылья в сладко-дымном соусе барбекю.",
      ["крылышки барбекю", "крылья bbq", "крылышки bbq", "bbq wings"],
      "fried", "poultry", "bbq", "none", "hot", ("MIXED", "MEDIUM", "HIGH"),
      {"caramel": .7, "smoke": .7, "chicken": .7, "molasses": .4, "pepper": .3, "char": .3},
      V(salt=.6, sweet=.5, sour=.1, umami=.6, fat=.7, protein=.7, heat=.1, weight=.55, maillard=.65, smoke=.5),
      heat=.1, ref="buffalo-wings"),
    N("cheese-plate", "Сырная тарелка", "🧀", "Сыры", ["french", "international"],
      "Ассорти сыров: бри или камамбер, выдержанный твёрдый, голубой; с орехами, мёдом и виноградом.",
      ["сырное ассорти", "сырная нарезка", "сыры", "cheese plate"],
      "cured", "cheese_hard", "none", "none", "room", ("SALTY", "MEDIUM", "HIGH"),
      {"cheese": 1, "nutty": .6, "dairy_cream": .6, "honey": .3, "brine": .3},
      V(salt=.65, sweet=.15, sour=.1, bitter=.05, umami=.7, fat=.75, protein=.75, weight=.55, cream=.45), share=.85,
      ref="cheese-aged"),
    N("cold-cuts", "Мясная нарезка", "🥓", "Закуски", ["international"],
      "Салями, сыровяленая и копчёная колбаса, ветчина и бастурма; к ним горчица и корнишоны.",
      ["колбасная нарезка", "мясное плато", "салями", "бастурма", "ветчина", "cold cuts"],
      "cured", "pork", "none", "none", "room", ("SALTY", "MEDIUM", "HIGH"),
      {"cured": .9, "pork": .6, "pepper": .5, "smoke": .4, "garlic": .4, "warm_spice": .2},
      V(salt=.8, umami=.75, fat=.75, protein=.8, pungent=.3, weight=.6, smoke=.4), ref="kazy"),
    N("garlic-shrimp", "Креветки в чесночном соусе", "🍤", "Морепродукты", ["spanish", "international"],
      "Креветки, обжаренные в сливочном или оливковом масле с большим количеством чеснока, петрушкой и лимоном.",
      ["креветки в чесноке", "гамбас", "чесночные креветки", "gambas al ajillo"],
      "fried", "shellfish", "none", "citrus", "hot", ("UMAMI", "LIGHT", "MEDIUM"),
      {"garlic": .9, "shellfish": .8, "brine": .6, "butter": .5, "herbal": .4, "citrus": .3, "chili": .2},
      V(salt=.5, sour=.1, umami=.65, fat=.6, protein=.5, heat=.15, pungent=.6, weight=.35, cream=.15, maillard=.4,
        fresh=.3, fish_oil=.3), heat=.15, ref="mussels-steamed"),
    N("calamari-rings", "Кальмары в кляре", "🦑", "Закуски к пиву", ["spanish", "international"],
      "Кольца кальмара в кляре или панировке, обжаренные во фритюре; с лимоном и соусом.",
      ["кальмары", "кольца кальмара", "кальмары фри", "calamari"],
      "fried", "shellfish", "none", "citrus", "hot", ("SALTY", "LIGHT", "HIGH"),
      {"fried": .9, "shellfish": .6, "brine": .5, "bread": .4, "citrus": .3},
      V(salt=.55, sour=.1, umami=.45, fat=.65, protein=.5, weight=.4, maillard=.55, fresh=.15, fish_oil=.2),
      ref="tempura"),
    N("mozzarella-sticks", "Сырные палочки", "🧀", "Закуски к пиву", ["american"],
      "Палочки моцареллы в панировке, обжаренные во фритюре; с томатным или кисло-сладким соусом.",
      ["сырные палочки", "моцарелла фри", "жареный сыр", "mozzarella sticks"],
      "fried", "cheese_soft", "none", "none", "hot", ("SALTY", "LIGHT", "HIGH"),
      {"cheese": .9, "fried": .8, "dairy_cream": .6, "bread": .5},
      V(salt=.55, umami=.45, fat=.8, protein=.45, weight=.45, cream=.6, maillard=.6), ref="mac-and-cheese"),
    N("salted-nuts", "Фисташки / арахис", "🥜", "Закуски к пиву", ["international"],
      "Жареные солёные фисташки или арахис.",
      ["фисташки", "арахис", "орешки", "солёные орешки", "орехи к пиву"],
      "baked", "legume", "none", "none", "room", ("SALTY", "LIGHT", "HIGH"),
      {"nutty": 1, "toast": .5},
      V(salt=.7, sweet=.05, umami=.3, fat=.7, protein=.5, weight=.25, maillard=.5), ref="pretzel"),
    N("cheeseburger", "Чизбургер", "🍔", "Бургеры", ["american"],
      "Классический чизбургер: говяжья котлета с плавленым сыром, маринованным огурцом, луком, кетчупом и горчицей.",
      ["чизбургер", "cheeseburger"],
      "grilled", "beef", "cheese", "none", "hot", ("UMAMI", "HEAVY", "HIGH"),
      {"beef": .9, "cheese": .9, "bread": .7, "onion": .4, "mustard": .3, "dairy_cream": .3, "cucumber": .2},
      V(salt=.65, sweet=.2, sour=.15, umami=.8, fat=.75, protein=.7, pungent=.35, weight=.75, cream=.45, maillard=.65,
        smoke=.2), share=.75, ref="burger"),
    N("pork-knuckle", "Свиная рулька", "🍖", "Мясное", ["german", "czech"],
      "Свиная рулька, запечённая до хрустящей шкурки; подают с тушёной капустой, горчицей и хреном.",
      ["рулька", "свиная рулька", "айсбайн", "швайнсхаксе", "вепрево колено"],
      "baked", "pork", "none", "none", "hot", ("UMAMI", "HEAVY", "HIGH"),
      {"pork": 1, "caramel": .5, "char": .5, "mustard": .4, "herbal": .2},
      V(salt=.6, umami=.8, fat=.9, protein=.85, pungent=.35, weight=.95, maillard=.8, smoke=.1), ref="roast-pork"),
    N("fish-and-chips", "Фиш-энд-чипс", "🐟", "Рыба", ["english"],
      "Филе трески в пивном кляре с картофелем фри, лимоном и соусом тартар; к ним солодовый уксус.",
      ["фиш энд чипс", "рыба с картошкой", "fish and chips"],
      "fried", "white_fish", "none", "vinegar", "hot", ("UMAMI", "HEAVY", "HIGH"),
      {"fried": .9, "potato": .7, "fish": .6, "bread": .5, "citrus": .3, "brine": .3},
      V(salt=.55, sour=.2, umami=.5, fat=.75, protein=.55, pungent=.1, weight=.7, cream=.15, maillard=.6, fresh=.1,
        fish_oil=.4), share=.8, ref="schnitzel"),
    # ── Европейская кухня ──
    N("pizza-pepperoni", "Пицца пепперони", "🍕", "Пицца", ["italian", "american"],
      "Пицца с томатным соусом, моцареллой и острой сыровяленой колбасой пепперони.",
      ["пепперони", "пицца с колбасой", "pepperoni"],
      "baked", "pork", "tomato", "tomato", "hot", ("UMAMI", "MEDIUM", "HIGH"),
      {"bread": .8, "cheese": .8, "tomato": .6, "cured": .6, "pepper": .5, "pork": .5},
      V(salt=.65, sour=.3, umami=.75, fat=.7, protein=.5, heat=.2, weight=.65, cream=.45, maillard=.55, smoke=.15),
      share=.6, heat=.2, ref="pizza-margherita"),
    N("ribeye-steak", "Стейк рибай", "🥩", "Мясное", ["american", "argentinian"],
      "Мраморный стейк из толстого края говядины на гриле; жирнее стриплойна и филе.",
      ["рибай", "стейк рибай", "ribeye", "антрекот"],
      "grilled", "beef", "none", "none", "hot", ("UMAMI", "HEAVY", "HIGH"),
      {"beef": 1, "char": .8, "butter": .5, "herbal": .4},
      V(salt=.5, umami=.9, fat=.75, protein=.9, weight=.85, maillard=.85, smoke=.5), ref="steak"),
    N("paella", "Паэлья", "🥘", "Рис", ["spanish"],
      "Испанский рис с шафраном и морепродуктами (креветки, мидии, кальмар), иногда с курицей; с лимоном.",
      ["паэлья", "паэлья с морепродуктами", "paella"],
      "braised", "shellfish", "none", "citrus", "hot", ("UMAMI", "HEAVY", "MEDIUM"),
      {"rice": 1, "shellfish": .6, "brine": .5, "citrus": .4, "herbal": .3, "warm_spice": .3},
      V(salt=.5, sour=.1, umami=.7, fat=.45, protein=.5, pungent=.2, weight=.7, maillard=.3, fresh=.1, fish_oil=.25),
      ref="risotto"),
    N("caesar-salad", "Салат «Цезарь» с курицей", "🥗", "Салаты", ["american", "international"],
      "Листья романо, курица на гриле, пармезан и гренки под соусом «Цезарь» (желток, анчоусы, чеснок, лимон).",
      ["цезарь", "салат цезарь", "цезарь с курицей", "caesar"],
      "raw", "poultry", "cream", "citrus", "cold", ("SALTY", "MEDIUM", "MEDIUM"),
      {"green": .7, "cheese": .6, "chicken": .6, "bread": .4, "garlic": .4, "citrus": .3, "brine": .2},
      V(salt=.55, sour=.2, umami=.6, fat=.55, protein=.5, pungent=.35, weight=.45, cream=.35, maillard=.3, fresh=.6),
      share=.65, ref="caprese"),
    N("greek-salad", "Греческий салат", "🥗", "Салаты", ["greek"],
      "Томаты, огурцы, сладкий перец, красный лук, маслины и фета с оливковым маслом, уксусом и орегано.",
      ["греческий", "хорьятики", "салат с фетой", "greek salad"],
      "raw", "cheese_soft", "vinaigrette", "vinegar", "cold", ("SOUR", "LIGHT", "MEDIUM"),
      {"tomato": .8, "cucumber": .8, "olive": .7, "cheese": .6, "herbal": .6, "brine": .4, "onion": .4},
      V(salt=.55, sour=.35, umami=.3, fat=.45, protein=.3, pungent=.35, weight=.3, cream=.15, fresh=.85), share=.6,
      ref="caprese"),
    N("ice-cream", "Мороженое пломбир", "🍨", "Десерт", ["international"],
      "Сливочное мороженое пломбир с ванилью.",
      ["мороженое", "пломбир", "ice cream", "джелато"],
      "raw", "dairy", "none", "none", "cold", ("SWEET", "LIGHT", "MEDIUM"),
      {"dairy_cream": 1, "vanilla": .6},
      V(sweet=.8, fat=.6, protein=.15, weight=.4, cream=.9), dessert=True, ref="cheesecake"),
    # ── Азиатская ──
    N("philadelphia-roll", "Ролл «Филадельфия»", "🍣", "Суши", ["japanese", "american"],
      "Ролл с лососем, сливочным сыром и огурцом; лосось снаружи.",
      ["филадельфия", "ролл филадельфия", "ролл с лососем", "philadelphia roll"],
      "raw", "oily_fish", "soy", "vinegar", "cold", ("UMAMI", "MEDIUM", "MEDIUM"),
      {"rice": 1, "fish": .8, "dairy_cream": .7, "seaweed": .4, "cucumber": .3, "brine": .3},
      V(salt=.4, sour=.25, umami=.65, fat=.6, protein=.5, weight=.45, cream=.6, fresh=.65, fish_oil=.7), share=.6,
      ref="sushi"),
    N("tom-yum", "Том ям", "🍲", "Супы", ["thai"],
      "Тайский кисло-острый суп с креветками, лемонграссом, галангалом, листьями лайма, чили и кокосовым молоком.",
      ["том ям", "томям", "том ям кунг", "tom yum"],
      "boiled", "shellfish", "broth", "citrus", "hot", ("SPICY", "MEDIUM", "MEDIUM"),
      {"citrus": .9, "chili": .8, "broth": .8, "herbal": .7, "shellfish": .6, "brine": .4},
      V(salt=.6, sweet=.1, sour=.55, umami=.7, fat=.35, protein=.45, heat=.65, pungent=.2, weight=.45, cream=.3,
        fresh=.3, fish_oil=.25), share=.9, heat=.65, ref="lagman-spicy"),
    N("pad-thai", "Пад тай", "🍜", "Лапша", ["thai"],
      "Рисовая лапша, обжаренная с тамариндом, рыбным соусом, яйцом, курицей или креветками и арахисом; с лаймом.",
      ["пад тай", "пад-тай", "лапша пад тай", "pad thai"],
      "fried", "poultry", "sweet_glaze", "citrus", "hot", ("MIXED", "MEDIUM", "MEDIUM"),
      {"noodles": .9, "nutty": .6, "rice": .5, "citrus": .5, "chicken": .4, "chili": .3, "egg": .3, "garlic": .3,
       "herbal": .3},
      V(salt=.55, sweet=.35, sour=.3, umami=.6, fat=.45, protein=.5, heat=.2, pungent=.3, weight=.6, maillard=.35,
        fresh=.15), share=.7, heat=.2, ref="ramen"),
    N("pho-bo", "Фо бо", "🍜", "Супы", ["vietnamese"],
      "Вьетнамский суп на говяжьем бульоне с бадьяном и корицей, рисовой лапшой, тонко нарезанной говядиной, свежей зеленью и лаймом.",
      ["фо бо", "фо", "фобо", "pho", "pho bo"],
      "boiled", "beef", "broth", "citrus", "hot", ("UMAMI", "MEDIUM", "LOW"),
      {"broth": 1, "noodles": .8, "beef": .7, "herbal": .7, "anise": .6, "warm_spice": .5, "citrus": .4, "onion": .4,
       "rice": .4},
      V(salt=.55, sweet=.1, sour=.15, umami=.8, fat=.35, protein=.55, heat=.15, pungent=.3, weight=.6, fresh=.35),
      share=.6, heat=.15, ref="ramen"),
]

NEW_ORDER_NOTE = "порядок в файле: блюда v1 → эталонные без v1 → новые → предложения RESEARCH"


# ─────────────────────────────────────────────────────────────────────────────
# 6. СБОРКА
# ─────────────────────────────────────────────────────────────────────────────
def vec_of(d: dict) -> dict:
    return {a: r2(d[a]) for a in AXES}


def record(id, name, cuisine, category, dessert, vector, cook, protein, sauce, acid, serve, tags, synonyms,
           emoji, description, source, legacy) -> dict:
    return {
        "id": id, "name": name, "cuisine": list(cuisine), "category": category, "is_dessert": bool(dessert),
        "vector": {a: r2(vector[a]) for a in AXES},
        "cook_method": cook, "protein_source": protein, "sauce": sauce, "acid_type": acid, "serve_temp": serve,
        "tags": {t: r2(w) for t, w in sorted(tags.items(), key=lambda kv: (-kv[1], kv[0]))},
        "synonyms": synonyms, "emoji": emoji, "description": description,
        "vector_source": source, "legacy": bool(legacy),
    }


def clean_synonyms(did: str, name: str, syns: list[str]) -> list[str]:
    drop = {s.lower() for s in SYNONYM_DROP.get(did, [])}
    out, seen = [], set()
    for s in list(syns) + SYNONYM_ADD.get(did, []):
        k = s.strip().lower()
        if k and k not in seen and k not in drop:
            seen.add(k); out.append(s.strip())
    return out


def build(v1: list[dict]) -> tuple[list[dict], dict]:
    v1_by_id = {d["id"]: d for d in v1}
    proto_by_id = {d["id"]: d for d in PROTO}
    info = {"autofill": {}, "ref": {}, "spec": {}}
    out = []

    # 6.1 блюда v1 (кроме айрана и кумыса) — в порядке v1
    for d1 in v1:
        did = d1["id"]
        if did in MOVED_TO_DRINKS:
            continue
        meta = dict(name=d1["name"], emoji=d1["emoji"], category=d1["category"], description=d1["description"])
        meta.update(LEGACY_META_FIX.get(did, {}))
        syns = clean_synonyms(did, meta["name"], d1["synonyms"])
        spec = (d1["dominant_taste"], d1["weight"], d1["fat_level"])
        if did in proto_by_id:
            p, e = proto_by_id[did], PROTO_ENUMS[did]
            info["spec"][did] = dict(spec=spec, cook=e["cook"], protein=e["protein"], sauce=e["sauce"], acid=e["acid"],
                                     dessert=p["dessert"], tags=p["tags"], share=e["share"], heat=e["heat"])
            out.append(record(did, meta["name"], p["cuisine"], meta["category"], p["dessert"], vec_of(p), e["cook"],
                              e["protein"], e["sauce"], e["acid"], e["serve"], p["tags"], syns, meta["emoji"],
                              meta["description"], "prototype", True))
            continue
        m = MIGRATED[did]
        auto, acid = autofill(*spec, m["cook"], m["protein"], m["sauce"], m["acid"], m["dessert"], m["tags"],
                              share=m["share"])
        info["autofill"][did] = auto
        info["ref"][did] = m["ref"]
        v = dict(auto)
        for a in LEGACY_AXES:                      # ручная разметка v1 сохраняется
            v[a] = float(d1["vector"].get(a, 0.0))
        v.update(m["fix"])                          # правки v2
        cuisine = V1_CUISINE[d1["cuisine"]]
        out.append(record(did, meta["name"], cuisine, meta["category"], m["dessert"], v, m["cook"], m["protein"],
                          m["sauce"], acid, m["serve"], m["tags"], syns, meta["emoji"], meta["description"],
                          "migrated_v1", True))

    # 6.2 эталонные блюда, которых нет в v1
    for p in PROTO:
        did = p["id"]
        if did in v1_by_id:
            continue
        e, meta = PROTO_ENUMS[did], PROTO_META[did]
        info["spec"][did] = dict(spec=e["spec"], cook=e["cook"], protein=e["protein"], sauce=e["sauce"], acid=e["acid"],
                                 dessert=p["dessert"], tags=p["tags"], share=e["share"], heat=e["heat"])
        out.append(record(did, p["name"], p["cuisine"], meta["category"], p["dessert"], vec_of(p), e["cook"],
                          e["protein"], e["sauce"], e["acid"], e["serve"], p["tags"],
                          clean_synonyms(did, p["name"], meta["synonyms"]), meta["emoji"], meta["description"],
                          "prototype", False))

    # 6.3 новые блюда
    for n in NEW:
        v = {a: float(n["vec"].get(a, 0.0)) for a in AXES}
        unknown = set(n["vec"]) - set(AXES)
        if unknown:
            raise SystemExit(f"{n['id']}: неизвестные оси {unknown}")
        auto, acid = autofill(*n["spec"], n["cook"], n["protein"], n["sauce"], n["acid"], n["dessert"], n["tags"],
                              heat=n["heat"], share=n["share"])
        info["autofill"][n["id"]] = auto
        info["ref"][n["id"]] = n["ref"]
        out.append(record(n["id"], n["name"], n["cuisine"], n["category"], n["dessert"], v, n["cook"], n["protein"],
                          n["sauce"], n["acid"], n["serve"], n["tags"], clean_synonyms(n["id"], n["name"], n["synonyms"]),
                          n["emoji"], n["description"], "manual", False))
    return out, info


# ─────────────────────────────────────────────────────────────────────────────
# 7. ПРЕДЛОЖЕНИЯ RESEARCH (data/research/proposed_dishes.json)
# ─────────────────────────────────────────────────────────────────────────────
def merge_proposed(dishes: list[dict], log: list[str]) -> None:
    if not PROPOSED_PATH.exists():
        log.append(f"proposed: {PROPOSED_PATH.relative_to(ROOT)} нет — шаг пропущен")
        return
    try:
        raw = json.loads(PROPOSED_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as ex:
        log.append(f"proposed: файл не читается как JSON ({ex}) — шаг пропущен")
        return
    items = raw if isinstance(raw, list) else raw.get("dishes", [])
    have = {d["id"]: d for d in dishes}
    names = {d["name"].strip().lower(): d["id"] for d in dishes}
    added = 0
    for p in items:
        pid = p.get("id") if isinstance(p, dict) else None
        if not pid:
            log.append(f"proposed: запись без id пропущена: {str(p)[:80]}")
            continue
        if pid in have:
            ours = have[pid]
            diffs = [f"{a} {ours['vector'][a]}→{p.get('vector', {}).get(a)}" for a in AXES
                     if isinstance(p.get("vector"), dict) and isinstance(p["vector"].get(a), (int, float))
                     and abs(ours["vector"][a] - p["vector"][a]) > .05]
            diffs += [f"{k} {ours[k]}→{p[k]}" for k in ("cook_method", "protein_source", "sauce", "acid_type",
                                                          "serve_temp", "is_dessert") if k in p and p[k] != ours[k]]
            log.append(f"proposed: КОНФЛИКТ id «{pid}» уже есть ({ours['vector_source']}) — оставлен наш вариант"
                       + (f"; расхождения: {', '.join(diffs)}" if diffs else "; данные совпадают"))
            continue
        nm = str(p.get("name", "")).strip().lower()
        if nm in names:
            log.append(f"proposed: КОНФЛИКТ имя «{p.get('name')}» ({pid}) совпадает с «{names[nm]}» — пропущено")
            continue
        rec = dict(p)
        rec.setdefault("legacy", False)
        rec.setdefault("vector_source", "manual")
        rec.setdefault("is_dessert", False)
        rec.setdefault("category", "")
        vec = rec.get("vector")
        if isinstance(vec, dict) and set(vec) == set(AXES) and all(
                isinstance(x, (int, float)) and not isinstance(x, bool) for x in vec.values()):
            rec["vector"] = {a: r2(vec[a]) for a in AXES}   # только порядок и округление; неполный вектор отклонит проверка
        errs = validate_record(rec)
        if errs:
            log.append(f"proposed: «{pid}» отклонено: {'; '.join(errs)}")
            continue
        dishes.append(rec); have[pid] = rec; names[nm] = pid; added += 1
    log.append(f"proposed: добавлено {added} из {len(items)}")


# ─────────────────────────────────────────────────────────────────────────────
# 8. САМОПРОВЕРКА
# ─────────────────────────────────────────────────────────────────────────────
REQUIRED = ("id", "name", "cuisine", "is_dessert", "vector", "cook_method", "protein_source", "sauce", "acid_type",
            "serve_temp", "tags", "synonyms", "emoji", "description", "vector_source", "legacy")


def validate_record(d: dict) -> list[str]:
    e = []
    for k in REQUIRED:
        if k not in d:
            e.append(f"нет поля {k}")
    if e:
        return e
    if not isinstance(d["id"], str) or not ID_RE.match(d["id"]):
        e.append(f"id не kebab-case: {d['id']!r}")
    if not str(d["name"]).strip():
        e.append("пустое name")
    v = d["vector"]
    if not isinstance(v, dict) or set(v) != set(AXES):
        e.append(f"vector: нужны ровно 16 осей, есть {sorted(v) if isinstance(v, dict) else v}")
    else:
        for a in AXES:
            x = v[a]
            if not isinstance(x, (int, float)) or isinstance(x, bool) or not 0 <= x <= 1:
                e.append(f"vector.{a}={x!r} вне [0,1]")
    for k, allowed in (("cook_method", COOK_METHODS), ("protein_source", PROTEIN_SOURCES), ("sauce", SAUCES),
                       ("acid_type", ACID_TYPES), ("serve_temp", SERVE_TEMPS), ("vector_source", VECTOR_SOURCES)):
        if d[k] not in allowed:
            e.append(f"{k}={d[k]!r} не из {allowed}")
    if not isinstance(d["cuisine"], list) or not d["cuisine"]:
        e.append("cuisine: нужен непустой список")
    else:
        bad = [c for c in d["cuisine"] if c not in CUISINES]
        if bad:
            e.append(f"cuisine: неизвестные {bad}")
    if not isinstance(d["is_dessert"], bool) or not isinstance(d["legacy"], bool):
        e.append("is_dessert/legacy должны быть bool")
    if not isinstance(d["tags"], dict) or any(not isinstance(w, (int, float)) or not 0 <= w <= 1 for w in d["tags"].values()):
        e.append("tags: словарь {тег: вес 0..1}")
    if not isinstance(d["synonyms"], list):
        e.append("synonyms: нужен список")
    if not str(d["description"]).strip():
        e.append("пустое description")
    return e


def load_prototype():
    if not PROTOTYPE_PATH.exists():
        return None
    try:
        spec = importlib.util.spec_from_file_location("engine_v2_prototype", PROTOTYPE_PATH)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception as ex:  # прототип — справочный файл; его поломка не должна ронять сборку
        print(f"  ! прототип не импортируется ({ex}) — сверка только с таблицей PROTO")
        return None


def self_check(dishes: list[dict], v1: list[dict]) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    ids = [d["id"] for d in dishes]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        errors.append(f"повторяющиеся id: {dup}")
    for d in dishes:
        for msg in validate_record(d):
            errors.append(f"{d.get('id')}: {msg}")
    by_id = {d["id"]: d for d in dishes}
    # v1: все, кроме айрана и кумыса; айрана и кумыса быть не должно
    v1_ids = [d["id"] for d in v1]
    missing = [i for i in v1_ids if i not in MOVED_TO_DRINKS and i not in by_id]
    if missing:
        errors.append(f"нет блюд v1: {missing}")
    for i in MOVED_TO_DRINKS:
        if i in by_id:
            errors.append(f"{i} должен уйти в напитки (§3.4)")
    for i in v1_ids:
        if i in by_id and not by_id[i]["legacy"]:
            errors.append(f"{i}: legacy должен быть true")
    for d in dishes:
        if d["legacy"] and d["id"] not in v1_ids:
            errors.append(f"{d['id']}: legacy=true, но в v1 такого id нет")
    # прототип: таблица PROTO и (если доступен) сам модуль
    mod = load_prototype()
    sources = [("PROTO", PROTO)] + ([("engine_v2_prototype.py", mod.DISHES)] if mod else [])
    for label, table in sources:
        if len(table) != 44:
            warnings.append(f"{label}: {len(table)} блюд вместо 44")
        for p in table:
            d = by_id.get(p["id"])
            if d is None:
                errors.append(f"нет эталонного блюда {p['id']} ({label})")
                continue
            if d["vector_source"] != "prototype":
                errors.append(f"{p['id']}: vector_source должен быть prototype")
            diff = [f"{a}: {d['vector'][a]} ≠ {p[a]}" for a in AXES if abs(d["vector"][a] - p[a]) > 1e-9]
            if diff:
                errors.append(f"{p['id']}: вектор отличается от {label}: {diff}")
            if d["is_dessert"] != bool(p["dessert"]):
                errors.append(f"{p['id']}: is_dessert ≠ {label}")
            if p.get("vinegar") and d["acid_type"] != "vinegar":
                errors.append(f"{p['id']}: в {label} vinegar=True, а acid_type={d['acid_type']}")
            if set(d["cuisine"]) != set(p["cuisine"]):
                errors.append(f"{p['id']}: cuisine ≠ {label}")
            if d["tags"] != {t: r2(w) for t, w in p["tags"].items()}:
                errors.append(f"{p['id']}: tags ≠ {label}")
    # мягкие проверки
    syn_owner: dict[str, str] = {}
    for d in dishes:
        if d["is_dessert"] and d["vector"]["sweet"] < .6 and d["vector_source"] != "prototype":
            warnings.append(f"{d['id']}: десерт со sweet {d['vector']['sweet']} < .6 (§3.3 шаг 6)")
        unknown = sorted(set(d["tags"]) - KNOWN_TAGS)
        if unknown:
            warnings.append(f"{d['id']}: теги вне словаря {unknown}")
        if d["vector"]["fish_oil"] > 0 and d["protein_source"] not in ("white_fish", "oily_fish", "shellfish"):
            warnings.append(f"{d['id']}: fish_oil > 0 при protein_source={d['protein_source']}")
        for s in [d["name"]] + d["synonyms"]:
            k = s.strip().lower()
            if k in syn_owner and syn_owner[k] != d["id"]:
                warnings.append(f"синоним «{s}» у двух блюд: {syn_owner[k]} и {d['id']}")
            syn_owner.setdefault(k, d["id"])
    return errors, warnings


# ─────────────────────────────────────────────────────────────────────────────
# 9. ОТЧЁТ И CLI
# ─────────────────────────────────────────────────────────────────────────────
def report(dishes: list[dict], info: dict) -> None:
    by_id = {d["id"]: d for d in dishes}
    print("\nW_D / F_D (ориентиры прототипа §3.1: бешбармак .69/.29 · шашлык .58/.49 · суши .23/.25 · чизкейк .80/.38)")
    for d in dishes:
        v, t = d["vector"], d["tags"]
        ref = info["ref"].get(d["id"])
        line = f"  {d['id']:22} {d['vector_source']:11} W={w_d(v, d['is_dessert']):.2f} F={f_d(v, d['is_dessert'], t):.2f}"
        if ref and ref in by_id:
            r = by_id[ref]
            line += f"   ref {ref}: W={w_d(r['vector'], r['is_dessert']):.2f} F={f_d(r['vector'], r['is_dessert'], r['tags']):.2f}"
        print(line)
    print("\nРасхождения итог ↔ автозаполнение > .25 (перенесённые и новые блюда):")
    for did, auto in info["autofill"].items():
        v = by_id[did]["vector"]
        big = [f"{a} {auto[a]:.2f}→{v[a]:.2f}" for a in AXES if abs(auto[a] - v[a]) > .25]
        if big:
            print(f"  {did:22} {', '.join(big)}")
    # насколько автозаполнение воспроизводит эталонные векторы
    errs = {a: [] for a in AXES}
    for did, s in info["spec"].items():
        if not s["spec"]:
            continue
        auto, _ = autofill(*s["spec"], s["cook"], s["protein"], s["sauce"], s["acid"], s["dessert"], s["tags"],
                           heat=s["heat"], share=s["share"])
        for a in AXES:
            errs[a].append(abs(auto[a] - by_id[did]["vector"][a]))
    n = len(next(iter(errs.values())))
    mae = {a: sum(x) / len(x) for a, x in errs.items()}
    print(f"\nАвтозаполнение vs 44 эталонных вектора: средняя абсолютная ошибка по осям (n={n}):")
    print("  " + " · ".join(f"{a} {mae[a]:.2f}" for a in AXES))
    print(f"  в среднем по всем осям: {sum(mae.values()) / len(mae):.3f}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Сборка data/dishes_v2.json")
    ap.add_argument("--report", action="store_true", help="напечатать W_D/F_D и сверку с автозаполнением")
    ap.add_argument("--check", action="store_true", help="только проверить существующий data/dishes_v2.json")
    ap.add_argument("--autofill", metavar="JSON",
                    help='черновой вектор: {"taste":"UMAMI","weight":"HEAVY","fat":"HIGH","cook":"grilled",'
                         '"protein":"lamb","sauce":"none","acid":"none","dessert":false,"tags":{"onion":.5},'
                         '"heat":null,"share":1}')
    args = ap.parse_args()

    if args.autofill:
        a = json.loads(args.autofill)
        vec, acid = autofill(a["taste"], a["weight"], a["fat"], a["cook"], a.get("protein", "none"),
                             a.get("sauce", "none"), a.get("acid", "none"), a.get("dessert", False), a.get("tags", {}),
                             a.get("heat"), a.get("share", 1.0))
        print(json.dumps({"vector": vec, "acid_type": acid}, ensure_ascii=False, indent=2))
        return 0

    v1 = json.loads(V1_PATH.read_text(encoding="utf-8"))
    if args.check:
        dishes = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        errors, warnings = self_check(dishes, v1)
    else:
        dishes, info = build(v1)
        log: list[str] = []
        merge_proposed(dishes, log)
        errors, warnings = self_check(dishes, v1)
        for line in log:
            print("  " + line)
        if not errors:
            OUT_PATH.write_text(json.dumps(dishes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if args.report:
            report(dishes, info)

    counts = {}
    for d in dishes:
        counts[d["vector_source"]] = counts.get(d["vector_source"], 0) + 1
    for w in warnings:
        print("  ! " + w)
    for e in errors:
        print("  ✗ " + e)
    status = "OK" if not errors else f"ОШИБОК: {len(errors)} — файл не записан" if not args.check else f"ОШИБОК: {len(errors)}"
    print(f"{'✓' if not errors else '✗'} dishes_v2.json — {len(dishes)} блюд "
          f"({', '.join(f'{k} {v}' for k, v in sorted(counts.items()))}); "
          f"десертов {sum(d['is_dessert'] for d in dishes)}; предупреждений {len(warnings)}; {status}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
