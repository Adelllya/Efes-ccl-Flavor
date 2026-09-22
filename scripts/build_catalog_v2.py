#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Flavor Tree v2 — сборка каталога напитков и стилевых приоров.

Вход (только чтение):
  docs/research/market-beer-kz.md          таблица «Полный каталог», 213 строк
  docs/research/market-other-drinks-kz.md  таблицы по разделам, 212 строк
  docs/research/engine_v2_prototype.py     57 архетипов прототипа — их числа каноничны
  docs/research/ENGINE_V2_SPEC.md          §2.4: якоря (anchor) архетипов прототипа
  docs/research/ABV_SOURCES.md             ссылки на ABV для 17 сортов Efes из data/brands.json
  data/brands.json, data/flavor_notes.json 17 брендов v1 и пирамида нот
  data/drink_overrides.json                необязательно: правки сомелье (vector_override), см. docs/CATALOG_V2.md

Выход:
  data/style_priors_v2.json   {archetype_id: {...}}
  data/drinks.json            массив записей (spec §8.1 + V2_CONTRACT.md), сортировка: категория, затем название

Порядок для каждой строки отчёта:
  стиль из таблицы → архетип (явная таблица STYLE_MAP, без нечёткого сопоставления)
  → приор архетипа → измеримые якоря (ABV → alcohol; IBU → bitter = clamp((IBU−8)/62))
  → для строк «не-пивного» отчёта: смешивание с экспертной оценкой отчёта 0–5 (Сл/Кисл/Гор, тело, газ)
  → vector_source, vector_confidence, vector_notes (по-русски, каждая поправка отдельной строкой).
17 брендов v1: тот же конвейер + пирамида нот как уточнение не больше ±0.15 на ось (spec §2.5).

Только стандартная библиотека Python 3. Детерминированно: одинаковый вход → побайтно одинаковый выход.
Запуск:  python3 scripts/build_catalog_v2.py            собрать, проверить, записать
         python3 scripts/build_catalog_v2.py --dry-run  собрать и проверить без записи файлов
Код возврата 1, если самопроверка нашла нарушения (файлы в этом случае не пишутся).
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import unicodedata
from collections import Counter, OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORT_BEER = ROOT / "docs" / "research" / "market-beer-kz.md"
REPORT_OTHER = ROOT / "docs" / "research" / "market-other-drinks-kz.md"
SPEC = ROOT / "docs" / "research" / "ENGINE_V2_SPEC.md"
PROTOTYPE = ROOT / "docs" / "research" / "engine_v2_prototype.py"
ABV_SOURCES_MD = ROOT / "docs" / "research" / "ABV_SOURCES.md"
BRANDS = ROOT / "data" / "brands.json"
FLAVOR_NOTES = ROOT / "data" / "flavor_notes.json"
OVERRIDES = ROOT / "data" / "drink_overrides.json"
OUT_DRINKS = ROOT / "data" / "drinks.json"
OUT_PRIORS = ROOT / "data" / "style_priors_v2.json"

REPORT_DATE = "2026-09-18"      # дата сбора обоих рыночных отчётов и ABV_SOURCES.md
VERIFIED_DATE = "2026-09-22"    # дата сверки BJCP / EU при сборке этого каталога
BEER_FILE, OTHER_FILE = "market-beer-kz.md", "market-other-drinks-kz.md"

# ───────────────────────────── словари контракта ─────────────────────────────
AXES = ["sweet", "acid", "bitter", "tannin", "carbonation", "alcohol", "body", "dairy", "salt", "umami",
        "aroma_intensity", "roast", "smoke", "serve_temp"]
UNIT_AXES = [a for a in AXES if a != "serve_temp"]
TAG_VOCAB = ["citrus", "tropical_fruit", "stone_fruit", "orchard_fruit", "red_fruit", "dark_fruit", "cherry", "banana",
             "clove", "pepper", "herbal", "floral", "pine_resin", "grass", "bread", "grain", "biscuit", "toast",
             "caramel", "honey", "nutty", "chocolate", "coffee", "roast", "smoke", "oak_vanilla", "dairy_cream",
             "sour_lactic", "mint", "cucumber", "brine", "mineral", "warm_spice", "anise", "juniper", "agave",
             "bitter_orange", "char", "cured", "yeast", "rice", "wheat", "warmth"]
CATEGORIES = ["beer", "na_beer", "radler", "cider", "wine", "sparkling", "fortified", "cocktail", "spirit", "liqueur",
              "kvass", "lemonade", "soda", "dairy", "tea", "coffee", "water"]
OCCASIONS = ["meal", "aperitif", "dessert", "hot", "evening", "party", "gourmet", "non_alcoholic"]
ORIGINS = ["kazakh", "central_asian", "uyghur", "russian", "caucasian", "turkish", "german", "czech", "belgian",
           "english", "irish", "french", "italian", "spanish", "japanese", "chinese", "korean", "indian", "thai",
           "mexican", "american", "international"]
ABV_SOURCE_ENUM = ["label", "producer_site", "retailer", "bjcp_midpoint", "recipe_calc", "estimate"]
IBU_SOURCE_ENUM = ["producer", "retailer", "bjcp_midpoint", "estimate", "none"]
VECTOR_SOURCES = ["measured", "label_derived", "bjcp_prior", "category_prior", "expert_tasting", "sommelier_override"]
AVAIL_LEVELS = ["wide", "horeca", "import", "niche", "unknown", "not_confirmed"]
STATUSES = ["draft", "auto", "reviewed", "published"]
EFES_REL = ["own", "distribution", "cci", "none"]
SOURCE_WHAT = ["abv", "ibu", "price", "availability", "tasting_notes", "style", "sugar", "acidity", "co2", "recipe"]


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def r3(x):
    return round(float(x) + 0.0, 3)


def fmt(x):
    """0.52 → «.52», 0.125 → «.125», 1 → «1», −0.09 → «−.09» (как в спецификации)."""
    s = f"{abs(x):.3f}".rstrip("0").rstrip(".")
    if s.startswith("0."):
        s = s[1:]
    return ("−" if x < 0 and s != "0" else "") + s


def fmt_abv(x):
    return f"{x:g}"


# ═══════════════════════════════ 1. АРХЕТИПЫ ═══════════════════════════════
def load_prototype():
    spec = importlib.util.spec_from_file_location("engine_v2_prototype_catalog", PROTOTYPE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def parse_spec_anchors():
    """Последняя колонка таблицы §2.4 спецификации — якорь архетипа прототипа."""
    text = SPEC.read_text(encoding="utf-8")
    block = text[text.index("### 2.4"):text.index("### 2.5")]
    out = {}
    for line in block.splitlines():
        m = re.match(r"^\| `([a-z0-9_]+)` \|", line)
        if m:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            out[m.group(1)] = cells[-1]
    return out


# Теги прототипа вне словаря контракта: toffee → caramel (spec §2.5), tannic — это ось tannin, не мост.
PROTO_TAG_RENAME = {"toffee": "caramel", "tannic": None}
PROTO_ORIGIN_RENAME = {"austrian": "german"}

BJCP = "https://www.bjcp.org/style/2021/"
EU_2019_33 = "https://www.legislation.gov.uk/eur/2019/33/annex/III"
EU_251_2014 = "https://legislation.gov.uk/eur/2014/251/article/6"

# Метаданные архетипов прототипа (числа не трогаем). Семейства совпадают с PROTOTYPE_FAMILIES движка.
# extra — дополнение к якорю из spec §2.4 (что проверено при сборке каталога).
PROTO_META = {
    "light_lager": ("Лёгкий лагер", "LAGER", "1A", ["meal", "hot", "party"], None),
    "pale_lager_intl": ("Международный светлый лагер", "LAGER", "2A", ["meal", "hot", "party"], None),
    "czech_pale_premium": ("Чешский премиальный светлый лагер (пилзнер)", "LAGER", "3B", ["meal", "hot", "gourmet"], None),
    "german_pils": ("Немецкий пилс", "LAGER", "5D", ["meal", "hot", "aperitif"], None),
    "helles": ("Мюнхенский хеллес", "LAGER", "4A", ["meal", "hot", "party"], None),
    "amber_lager": ("Янтарный лагер (венский / мерцен)", "AMBER_LAGER", "7A", ["meal", "evening"],
                    ("BJCP 7A Vienna Lager (проверено " + VERIFIED_DATE + "): IBU 18–30, ABV 4.7–5.5, FG 1.010–1.014, "
                     "«Medium-light to medium body… Moderate carbonation»", BJCP + "7/7A/vienna-lager/")),
    "czech_dark": ("Чешский тёмный лагер", "DARK_LAGER", "3D", ["meal", "evening"], None),
    "strong_lager": ("Крепкий лагер", "STRONG_LAGER", None, ["evening", "party"], None),
    "rice_lager": ("Рисовый лагер", "LAGER", None, ["meal", "hot", "party"], None),
    "weissbier": ("Баварское пшеничное (вайсбир)", "WHEAT", "10A", ["meal", "hot", "aperitif"], None),
    "witbier": ("Бельгийское белое (витбир)", "WHEAT", "24A", ["meal", "hot", "aperitif"], None),
    "american_pale_ale": ("Американский пейл-эль", "IPA", "18B", ["meal", "gourmet", "evening"],
                          ("BJCP 18B American Pale Ale (проверено " + VERIFIED_DATE + "): IBU 30–50, ABV 4.5–6.2, "
                           "«Medium-light to medium body. Moderate to high carbonation»", BJCP + "18/18B/american-pale-ale/")),
    "american_ipa_45": ("Американский IPA", "IPA", "21A", ["meal", "gourmet", "evening"], None),
    "double_ipa_85": ("Двойной IPA", "IPA", "22A", ["evening", "gourmet"], None),
    "brown_ale": ("Английский коричневый эль", "BROWN_ALE", "13B", ["meal", "evening"],
                  ("BJCP 13B British Brown Ale (проверено " + VERIFIED_DATE + "): IBU 20–30, ABV 4.2–5.9, "
                   "«Medium-light to medium body. Medium to medium-high carbonation»", BJCP + "13/13B/british-brown-ale/")),
    "porter": ("Портер", "STOUT", None, ["meal", "evening"], None),
    "dry_stout": ("Ирландский сухой стаут", "STOUT", "15B", ["meal", "evening"], None),
    "milk_stout": ("Сладкий (молочный) стаут", "STOUT", "16A", ["evening", "dessert"],
                   ("BJCP 16A Sweet Stout (проверено " + VERIFIED_DATE + "): IBU 20–40, ABV 4–6, FG 1.012–1.024, "
                    "«Medium-full to full-bodied and creamy»", BJCP + "16/16A/sweet-stout/")),
    "imperial_stout": ("Имперский стаут", "STOUT", "20C", ["evening", "gourmet", "dessert"], None),
    "barleywine": ("Ячменное вино", "STRONG_ALE", "22C", ["evening", "gourmet", "dessert"], None),
    "rauchbier": ("Раухбир (копчёное пиво)", "SMOKED", "6B", ["meal", "gourmet"], None),
    "kriek_sour": ("Крик / фруктовый ламбик", "SOUR", "23F", ["aperitif", "gourmet", "dessert"],
                   ("BJCP 23F Fruit Lambic (проверено " + VERIFIED_DATE + "): IBU 0–10, ABV 5–7, "
                    "«Light to medium-light body… Carbonation can vary from sparkling to nearly still»",
                    BJCP + "23/23F/fruit-lambic/")),
    "na_lager": ("Безалкогольный лагер", "NA_BEER", None, ["meal", "hot"], None),
    "radler": ("Радлер / пивной микс", "RADLER", None, ["hot", "party"], None),
    "cider_dry": ("Сухой сидр", "CIDER", None, ["meal", "aperitif", "hot"], None),
    "cider_semi_dry": ("Полусухой сидр", "CIDER", None, ["meal", "hot", "party"], None),
    "cider_sweet_commercial": ("Сладкий сидр", "CIDER", None, ["hot", "party", "dessert"], None),
    "white_dry": ("Белое сухое вино", "WHITE", None, ["meal", "aperitif", "gourmet"], None),
    "riesling_off_dry": ("Рислинг полусухой (кабинетт)", "WHITE", None, ["meal", "gourmet"], None),
    "brut_sparkling": ("Игристое брют", "SPARKLING", None, ["aperitif", "party"], None),
    "demi_sec_sparkling": ("Игристое полусладкое", "SPARKLING", None, ["dessert", "party"], None),
    "red_light": ("Лёгкое красное вино (пино нуар / гаме)", "RED", None, ["meal", "gourmet"], None),
    "cabernet": ("Полнотелое красное (каберне / саперави)", "RED", None, ["meal", "evening", "gourmet"], None),
    "shiraz": ("Шираз", "RED", None, ["meal", "evening", "gourmet"], None),
    "red_semi_sweet": ("Красное полусладкое", "RED", None, ["meal", "evening", "dessert"], None),
    "port": ("Портвейн / креплёное десертное", "FORTIFIED", None, ["dessert", "evening"], None),
    "aperol_spritz": ("Апероль спритц", "SPRITZ", None, ["aperitif", "hot", "party"], None),
    "negroni": ("Негрони", "BITTER_COCKTAIL", None, ["aperitif", "evening"], None),
    "margarita": ("Маргарита", "SOUR_COCKTAIL", None, ["party", "evening"], None),
    "old_fashioned": ("Олд фэшн", "STIRRED", None, ["evening", "gourmet"], None),
    "manhattan": ("Манхэттен", "STIRRED", None, ["evening", "gourmet"], None),
    "gin_tonic": ("Джин-тоник", "HIGHBALL", None, ["aperitif", "hot", "party"], None),
    "white_russian": ("Белый русский", "CREAM_COCKTAIL", None, ["dessert", "evening"], None),
    "whisky_neat": ("Виски без льда", "WHISKY", None, ["evening", "gourmet"], None),
    "cask_strength_whisky": ("Виски бочковой крепости", "WHISKY", None, ["evening", "gourmet"], None),
    "peated_whisky": ("Торфяной виски", "WHISKY", None, ["evening", "gourmet"], None),
    "vodka_neat": ("Водка", "VODKA", None, ["meal", "party"], None),
    "mezcal": ("Мескаль", "AGAVE", None, ["evening", "gourmet"], None),
    "kvass_classic": ("Хлебный квас", "KVASS", None, ["meal", "hot"], None),
    "kvass_sour": ("Кислый (окрошечный) квас", "KVASS", None, ["meal", "hot"], None),
    "lemonade_sweet": ("Сладкий лимонад / газировка", "LEMONADE", None, ["hot", "party"], None),
    "soda_water": ("Содовая / газированная вода", "WATER", None, ["meal", "hot"], None),
    "ayran": ("Айран", "FERMENTED_DAIRY", None, ["meal", "hot"], None),
    "kumys": ("Кумыс", "FERMENTED_DAIRY", None, ["meal", "hot"], None),
    "shubat": ("Шубат", "FERMENTED_DAIRY", None, ["meal", "hot"], None),
    "black_tea_strong": ("Крепкий чёрный чай", "TEA", None, ["meal", "dessert"], None),
    "green_tea": ("Зелёный чай", "TEA", None, ["meal", "dessert"], None),
}


def X(aid, cat, family, label, abv, ibu, anchor_type, anchor, occasions, origin, tags, verified=None, bjcp=None,
      sweet=0.0, acid=0.0, bitter=0.0, tannin=0.0, carbonation=0.0, body=0.3, dairy=0.0, salt=0.0, umami=0.0,
      aroma=0.3, roast=0.0, smoke=0.0, temp=6.0):
    """Дополнительный архетип каталога. Числа — экспертная интерполяция между соседними архетипами прототипа
    по указанному якорю; bitter для пива — по формуле spec §2.1 от середины IBU BJCP, если не оговорено иное."""
    return aid, {
        "category": cat, "family": family, "label_ru": label, "abv": abv, "ibu": ibu,
        "sensory": {"sweet": sweet, "acid": acid, "bitter": bitter, "tannin": tannin, "carbonation": carbonation,
                    "alcohol": r3(clamp(abv / 40)), "body": body, "dairy": dairy, "salt": salt, "umami": umami,
                    "aroma_intensity": aroma, "roast": roast, "smoke": smoke, "serve_temp": temp},
        "aroma_tags": tags, "origin_affinity": origin, "anchor": anchor, "anchor_type": anchor_type,
        "bjcp_code": bjcp, "occasions": occasions, "verified": verified,
    }


def V(path, what):
    return {"url": BJCP + path, "date": VERIFIED_DATE, "what": what}


VS = "IBU/ABV/FG/mouthfeel"
EXTRA_ARCHETYPES = OrderedDict([
    # ── пиво: стили BJCP 2021, vital statistics сверены по bjcp.org ──
    X("american_lager", "beer", "LAGER", "Американский лагер", 4.7, 13, "bjcp",
      "BJCP 1B American Lager: IBU 8–18, ABV 4.2–5.3, FG 1.004–1.010, «Low to medium-low body. Very highly carbonated» "
      "(Miller Genuine Draft, Pabst Blue Ribbon)", ["meal", "hot", "party"], ["american", "international"],
      {"grain": .5, "bread": .2}, V("1/1B/american-lager/", VS), "1B",
      sweet=.15, acid=.25, bitter=.08, tannin=.02, carbonation=.75, body=.25, aroma=.2, temp=4),
    X("czech_pale_lager", "beer", "LAGER", "Чешский светлый лагер (výčepní)", 3.8, 27, "bjcp",
      "BJCP 3A Czech Pale Lager: IBU 20–35, ABV 3.0–4.1, FG 1.008–1.014, «Medium-light to medium body. Moderate "
      "carbonation» (Kozel Světlý, Zatecky Gus Svetly)", ["meal", "hot", "party"], ["czech"],
      {"bread": .6, "herbal": .5, "floral": .3}, V("3/3A/czech-pale-lager/", VS), "3A",
      sweet=.2, acid=.25, bitter=.31, tannin=.05, carbonation=.5, body=.45, aroma=.35, temp=6),
    X("kolsch", "beer", "GOLDEN_ALE", "Кёльш", 4.8, 24, "bjcp",
      "BJCP 5B Kölsch: IBU 18–30, ABV 4.4–5.2, FG 1.007–1.011, «Medium-light to medium body… Medium to medium-high "
      "carbonation»", ["meal", "hot", "aperitif"], ["german"],
      {"bread": .5, "grain": .4, "herbal": .3, "orchard_fruit": .2}, V("5/5B/kolsch/", VS), "5B",
      sweet=.15, acid=.3, bitter=.26, tannin=.03, carbonation=.6, body=.4, aroma=.35, temp=5),
    X("helles_export", "beer", "LAGER", "Хеллес экспорт", 5.4, 25, "bjcp",
      "BJCP 5C German Helles Exportbier: IBU 20–30, ABV 5–6, FG 1.008–1.015, «Medium to medium-full body. Medium "
      "carbonation»", ["meal", "hot", "party"], ["german"],
      {"bread": .6, "grain": .4, "herbal": .3, "mineral": .2}, V("5/5C/german-helles-exportbier/", VS), "5C",
      sweet=.2, acid=.2, bitter=.27, tannin=.03, carbonation=.5, body=.55, aroma=.35, temp=6),
    X("kellerbier", "beer", "LAGER", "Нефильтрованный лагер (келлербир)", 5.0, 19, "bjcp",
      "BJCP 27A Historical Beer: Kellerbier — vital statistics «Same as base style» (база: хеллес 4A), «May have a bit "
      "more body and a creamier texture… Carbonation… may be lower», хлебно-дрожжевой характер, лёгкая муть",
      ["meal", "hot"], ["german"], {"bread": .7, "yeast": .5, "grain": .4},
      V("27/27A/historical-beer-kellerbier/", "mouthfeel/haze/carbonation"), "27A",
      sweet=.2, acid=.25, bitter=.2, tannin=.03, carbonation=.5, body=.55, aroma=.4, temp=7),
    X("munich_dunkel", "beer", "DARK_LAGER", "Мюнхенский тёмный (дункель)", 5.0, 23, "bjcp",
      "BJCP 8A Munich Dunkel: IBU 18–28, SRM 17–28, ABV 4.5–5.6, FG 1.010–1.016, «Medium to medium-full body… Moderate "
      "carbonation»", ["meal", "evening"], ["german"],
      {"bread": .8, "toast": .6, "caramel": .4, "chocolate": .3, "nutty": .3}, V("8/8A/munich-dunkel/", VS), "8A",
      sweet=.3, acid=.22, bitter=.24, tannin=.08, carbonation=.5, body=.58, aroma=.5, roast=.25, temp=8),
    X("dark_lager_intl", "beer", "DARK_LAGER", "Тёмный лагер (международный)", 4.8, 14, "bjcp",
      "BJCP 2C International Dark Lager: IBU 8–20, SRM 14–30, ABV 4.2–6, FG 1.008–1.012, «Light to medium-light body. "
      "Smooth with a light creaminess. Medium to high carbonation»", ["meal", "evening"], ["international"],
      {"caramel": .5, "bread": .4, "toast": .3, "chocolate": .2}, V("2/2C/international-dark-lager/", VS), "2C",
      sweet=.25, acid=.22, bitter=.1, tannin=.05, carbonation=.65, body=.38, aroma=.35, roast=.2, temp=6),
    X("doppelbock", "beer", "STRONG_LAGER", "Доппельбок", 8.0, 21, "bjcp",
      "BJCP 9A Doppelbock: IBU 16–26, ABV 7–10, FG 1.016–1.024, «Medium-full to full body. Moderate to moderately-low "
      "carbonation»", ["evening", "gourmet", "dessert"], ["german"],
      {"caramel": .8, "bread": .7, "toast": .6, "dark_fruit": .5, "chocolate": .3, "warmth": .5},
      V("9/9A/doppelbock/", VS), "9A",
      sweet=.45, acid=.2, bitter=.21, tannin=.08, carbonation=.4, body=.8, aroma=.7, roast=.2, temp=10),
    X("dunkelweizen", "beer", "WHEAT", "Тёмное пшеничное (дункельвайцен)", 5.0, 14, "bjcp",
      "BJCP 10B Dunkles Weissbier: IBU 10–18, ABV 4.3–5.6, FG 1.008–1.014, «Medium-light to medium-full body… moderate "
      "to high carbonation. Effervescent»", ["meal", "evening"], ["german"],
      {"banana": .6, "clove": .4, "bread": .6, "caramel": .4, "wheat": .5, "chocolate": .2},
      V("10/10B/dunkles-weissbier/", VS), "10B",
      sweet=.3, acid=.3, bitter=.1, tannin=.03, carbonation=.85, body=.5, aroma=.55, roast=.15, temp=7),
    X("blonde_ale", "beer", "GOLDEN_ALE", "Светлый эль (блонд)", 4.7, 21, "bjcp",
      "BJCP 18A Blonde Ale: IBU 15–28, ABV 3.8–5.5, FG 1.008–1.013, «Medium-light to medium body. Medium to high "
      "carbonation»", ["meal", "hot", "party"], ["american", "english"],
      {"bread": .5, "grain": .3, "honey": .2, "citrus": .2, "floral": .2}, V("18/18A/blonde-ale/", VS), "18A",
      sweet=.2, acid=.3, bitter=.22, tannin=.05, carbonation=.65, body=.4, aroma=.4, temp=6),
    X("english_bitter", "beer", "ENGLISH_ALE", "Английский биттер", 4.3, 32, "bjcp",
      "BJCP 11B Best Bitter: IBU 25–40, ABV 3.8–4.6, FG 1.008–1.012, «Low carbonation, although bottled examples can "
      "have moderate carbonation»; 11C Strong Bitter: IBU 30–50, ABV 4.6–6.2", ["meal", "evening"], ["english"],
      {"biscuit": .6, "caramel": .5, "herbal": .4, "orchard_fruit": .3, "floral": .3},
      V("11/11B/best-bitter/", VS + " (+11C)"), "11B",
      sweet=.25, acid=.3, bitter=.39, tannin=.1, carbonation=.4, body=.45, aroma=.55, roast=.05, temp=10),
    X("english_ipa", "beer", "IPA", "Английский IPA", 6.0, 50, "bjcp",
      "BJCP 12C English IPA: IBU 40–60, ABV 5–7.5, FG 1.010–1.015, «medium-light to medium body… Medium to medium-high "
      "carbonation»", ["meal", "gourmet", "evening"], ["english"],
      {"biscuit": .5, "caramel": .4, "herbal": .5, "floral": .4, "orchard_fruit": .3},
      V("12/12C/english-ipa/", VS), "12C",
      sweet=.25, acid=.3, bitter=.68, tannin=.1, carbonation=.6, body=.45, aroma=.7, temp=9),
    X("hazy_ipa", "beer", "IPA", "Мутный IPA (NEIPA)", 6.5, 42, "bjcp",
      "BJCP 21C Hazy IPA: IBU 25–60, ABV 6–9, FG 1.010–1.015, «Medium to medium-full body. Medium carbonation»; "
      "«Low to medium-high perceived bitterness, often masked by the fuller body» — поэтому bitter .45 вместо .55 "
      "по формуле §2.1 (оценка)", ["meal", "gourmet", "evening"], ["american"],
      {"tropical_fruit": .9, "citrus": .7, "stone_fruit": .5}, V("21/21C/hazy-ipa/", VS + "/perceived bitterness"), "21C",
      sweet=.3, acid=.35, bitter=.45, tannin=.12, carbonation=.5, body=.6, aroma=.9, temp=8),
    X("belgian_blond", "beer", "BELGIAN", "Бельгийский светлый эль", 6.8, 22, "bjcp",
      "BJCP 25A Belgian Blond Ale: IBU 15–30, ABV 6–7.5, FG 1.008–1.018, «Medium-high to high carbonation… Medium "
      "body» (Leffe Blonde, Grimbergen Blonde)", ["meal", "gourmet"], ["belgian"],
      {"bread": .5, "honey": .4, "orchard_fruit": .3, "citrus": .3, "clove": .3, "pepper": .3},
      V("25/25A/belgian-blond-ale/", VS), "25A",
      sweet=.3, acid=.3, bitter=.23, tannin=.05, carbonation=.8, body=.5, aroma=.6, temp=7),
    X("belgian_golden_strong", "beer", "BELGIAN", "Бельгийский крепкий золотой эль", 8.5, 28, "bjcp",
      "BJCP 25C Belgian Golden Strong Ale: IBU 22–35, ABV 7.5–10.5, FG 1.005–1.016, «Very highly carbonated… Light to "
      "medium body»", ["evening", "gourmet"], ["belgian"],
      {"orchard_fruit": .5, "pepper": .5, "citrus": .4, "floral": .3, "warmth": .5},
      V("25/25C/belgian-golden-strong-ale/", VS), "25C",
      sweet=.2, acid=.3, bitter=.33, tannin=.05, carbonation=.9, body=.4, aroma=.7, temp=8),
    X("belgian_dubbel", "beer", "BELGIAN_DARK", "Бельгийский дуббель", 6.8, 20, "bjcp",
      "BJCP 26B Belgian Dubbel: IBU 15–25, ABV 6–7.6, FG 1.008–1.018, «Smooth, medium to medium-full body. Medium-high "
      "carbonation» (Leffe Brune, Grimbergen Double-Ambrée)", ["meal", "evening", "gourmet"], ["belgian"],
      {"dark_fruit": .8, "caramel": .6, "bread": .4, "clove": .3, "chocolate": .2, "warmth": .3},
      V("26/26B/belgian-dubbel/", VS), "26B",
      sweet=.35, acid=.28, bitter=.19, tannin=.08, carbonation=.7, body=.6, aroma=.7, roast=.05, temp=10),
    X("belgian_tripel", "beer", "BELGIAN", "Бельгийский трипель", 8.5, 30, "bjcp",
      "BJCP 26C Belgian Tripel: IBU 20–40, ABV 7.5–9.5, FG 1.008–1.014, «Medium-light to medium body… Highly "
      "carbonated»", ["evening", "gourmet"], ["belgian"],
      {"pepper": .5, "citrus": .4, "orchard_fruit": .4, "clove": .3, "honey": .3, "warmth": .5},
      V("26/26C/belgian-tripel/", VS), "26C",
      sweet=.2, acid=.3, bitter=.35, tannin=.05, carbonation=.9, body=.45, aroma=.75, temp=8),
    X("gose", "beer", "SOUR", "Гозе (кисло-солёное пшеничное)", 4.5, 8, "bjcp",
      "BJCP 23G Gose: IBU 5–12, ABV 4.2–4.8, «High to very high carbonation»; «Noticeable sourness, medium-low to "
      "medium-high»; «the salt should be noticeable… but not taste overtly salty» → salt .3 (как в spec §2.5)",
      ["aperitif", "hot", "gourmet"], ["german"],
      {"sour_lactic": .8, "brine": .6, "wheat": .4, "citrus": .3, "warm_spice": .3},
      V("23/23G/gose/", VS + "/salt/sourness"), "23G",
      sweet=.15, acid=.7, bitter=.02, tannin=.02, carbonation=.9, body=.4, salt=.3, aroma=.5, temp=5),
    X("sour_ale", "beer", "SOUR", "Кислый эль", 4.0, 6, "expert",
      "экспертная оценка по категории «кислый эль» (конкретный подстиль в источнике не указан); ориентир — BJCP 23A "
      "Berliner Weisse: IBU 3–8, ABV 2.8–3.8, «Light body… Very high carbonation… Crisp acidity»",
      ["aperitif", "hot", "gourmet"], ["international"], {"sour_lactic": .9, "citrus": .3, "wheat": .3},
      V("23/23A/berliner-weisse/", VS), None,
      sweet=.15, acid=.8, bitter=.02, tannin=.03, carbonation=.8, body=.35, aroma=.5, temp=5),
    X("fruit_beer_sweet", "beer", "FRUIT_BEER", "Фруктовое пиво (сладкое)", 5.5, None, "expert",
      "BJCP 29A Fruit Beer: vital statistics «vary depending on the underlying base beer» — фиксированных цифр нет; "
      "экспертная оценка по категории «подслащённое фруктовое/ягодное пиво» (Grimbergen Rouge, Kasteel Rouge, "
      "Line Brew фруктовые)", ["party", "dessert", "hot"], ["belgian"], {"red_fruit": .8, "cherry": .4, "bread": .2},
      V("29/29A/fruit-beer/", "нет фиксированных vital statistics"), None,
      sweet=.55, acid=.45, bitter=.08, tannin=.05, carbonation=.7, body=.45, aroma=.7, temp=6),
    X("wood_aged_beer", "beer", "WOOD_AGED", "Пиво, выдержанное с дубом", 6.0, None, "expert",
      "BJCP 33A Wood-Aged Beer: IBU/ABV «varies with base style»; дуб даёт «vanilla, caramel, or cocoa notes»; база — "
      "светлый лагер (Tennent's Whisky Oak) — экспертная оценка", ["evening", "gourmet"], ["english"],
      {"oak_vanilla": .8, "caramel": .5, "bread": .4, "warmth": .3},
      V("33/33A/wood-aged-beer/", "vital statistics/wood character"), None,
      sweet=.3, acid=.2, bitter=.2, tannin=.15, carbonation=.5, body=.5, aroma=.6, roast=.05, smoke=.05, temp=8),
    # ── безалкогольное пиво ──
    X("na_wheat", "na_beer", "NA_BEER", "Безалкогольное пшеничное", 0.0, None, "expert",
      "экспертная оценка: безалкогольная версия BJCP 10A Weissbier (IBU 8–15); сусловая сладость выше, чем у "
      "алкогольного оригинала", ["meal", "hot"], ["german"], {"banana": .6, "clove": .4, "wheat": .6, "bread": .5},
      None, None, sweet=.35, acid=.3, bitter=.08, tannin=.02, carbonation=.85, body=.4, aroma=.45, temp=5),
    X("na_beer_fruit", "na_beer", "NA_BEER", "Безалкогольное пиво с фруктовым вкусом", 0.0, None, "expert",
      "экспертная оценка по категории: безалкогольное пиво + фруктовый сок/ароматизатор (Балтика 0 Грейпфрут, "
      "Efes 0.0 Абрикос-Малина)", ["hot", "party"], ["international"], {"citrus": .5, "grain": .3},
      None, None, sweet=.5, acid=.45, bitter=.12, tannin=.02, carbonation=.75, body=.3, aroma=.55, temp=4),
    X("na_stout", "na_beer", "NA_BEER", "Безалкогольный стаут", 0.0, None, "expert",
      "экспертная оценка: безалкогольная версия BJCP 15B Irish Stout (IBU 25–45); обжарка сохраняется, тело легче",
      ["meal", "evening"], ["irish"], {"coffee": .7, "chocolate": .5, "roast": .9, "dairy_cream": .2},
      None, None, sweet=.25, acid=.3, bitter=.45, tannin=.25, carbonation=.3, body=.5, aroma=.55, roast=.8, temp=8),
    # ── сидр ──
    X("cider_fruit", "cider", "CIDER", "Фруктовый (ароматизированный) сидр", 4.0, None, "expert",
      "экспертная оценка по категории «сидр с другими фруктами/ягодами, массовый» (Kopparberg, Somersby, Chester's "
      "ягодные); сахар на этикетках в источниках не указан", ["hot", "party", "dessert"], ["international"],
      {"red_fruit": .7, "orchard_fruit": .4}, None, None,
      sweet=.7, acid=.5, bitter=.03, tannin=.05, carbonation=.8, body=.35, aroma=.65, temp=5),
    # ── вино и игристое: категория сахара на этикетке (ЕС) → sweet по шкале spec §2.1 ──
    X("white_semi_dry", "wine", "WHITE", "Белое полусухое", 12.0, None, "regulation",
      "EU 2019/33 прил. III ч. B: «medium dry» (полусухое) — сахар до 12 г/л (до 18 при оговорке о кислотности); "
      "середина ≈ 8 г/л → sweet ≈ .18 по шкале §2.1", ["meal", "gourmet"], ["international"],
      {"orchard_fruit": .6, "citrus": .5, "floral": .3, "honey": .2, "mineral": .2},
      {"url": EU_2019_33, "date": VERIFIED_DATE, "what": "пороги сахара, часть B"}, None,
      sweet=.2, acid=.75, bitter=.05, tannin=.05, carbonation=0, body=.38, aroma=.6, temp=8),
    X("white_semi_sweet", "wine", "WHITE", "Белое полусладкое", 11.5, None, "regulation",
      "EU 2019/33 прил. III ч. B: «medium» (полусладкое) — сахар выше порога полусухого и не более 45 г/л; середина "
      "≈ 28 г/л → sweet ≈ .43 по шкале §2.1", ["meal", "dessert"], ["international"],
      {"honey": .5, "stone_fruit": .5, "orchard_fruit": .5, "floral": .4},
      {"url": EU_2019_33, "date": VERIFIED_DATE, "what": "пороги сахара, часть B"}, None,
      sweet=.45, acid=.65, bitter=.03, tannin=.03, carbonation=0, body=.42, aroma=.6, temp=8),
    X("red_semi_dry", "wine", "RED", "Красное полусухое", 12.0, None, "regulation",
      "EU 2019/33 прил. III ч. B: «medium dry» — до 12 (18) г/л → sweet ≈ .2; танин/тело между red_light и cabernet — "
      "оценка", ["meal", "evening"], ["international"], {"red_fruit": .8, "dark_fruit": .4},
      {"url": EU_2019_33, "date": VERIFIED_DATE, "what": "пороги сахара, часть B"}, None,
      sweet=.2, acid=.55, bitter=.12, tannin=.45, carbonation=0, body=.55, aroma=.6, temp=14),
    X("red_dry_medium", "wine", "RED", "Красное сухое, среднее тело", 13.0, None, "regulation",
      "EU 2019/33 прил. III ч. B: «dry» — до 4 г/л (до 9 при оговорке о кислотности) → sweet .05; танин и тело между "
      "red_light и cabernet — экспертная оценка (кьянти, саперави/пино среднего тела)", ["meal", "evening", "gourmet"],
      ["international"],
      {"red_fruit": .6, "dark_fruit": .6, "cherry": .4, "herbal": .3, "oak_vanilla": .3, "pepper": .2},
      {"url": EU_2019_33, "date": VERIFIED_DATE, "what": "пороги сахара, часть B"}, None,
      sweet=.05, acid=.6, bitter=.2, tannin=.6, carbonation=0, body=.6, aroma=.65, roast=.05, temp=16),
    X("sparkling_extra_dry", "sparkling", "SPARKLING", "Игристое extra dry", 11.0, None, "regulation",
      "EU 2019/33 прил. III ч. A: «extra dry» — сахар 12–17 г/л; середина 14.5 г/л → sweet .28 по шкале §2.1 "
      "(Prosecco DOC extra dry)", ["aperitif", "party"], ["italian"],
      {"orchard_fruit": .7, "floral": .5, "citrus": .4, "stone_fruit": .3},
      {"url": EU_2019_33, "date": VERIFIED_DATE, "what": "пороги сахара, часть A"}, None,
      sweet=.28, acid=.8, bitter=.05, tannin=.03, carbonation=1.0, body=.35, aroma=.55, temp=7),
    X("sparkling_dry", "sparkling", "SPARKLING", "Игристое dry", 11.0, None, "regulation",
      "EU 2019/33 прил. III ч. A: «dry» — сахар 17–32 г/л; середина 24.5 г/л → sweet .39 по шкале §2.1",
      ["aperitif", "party", "dessert"], ["italian"],
      {"orchard_fruit": .7, "floral": .5, "citrus": .4, "stone_fruit": .3},
      {"url": EU_2019_33, "date": VERIFIED_DATE, "what": "пороги сахара, часть A"}, None,
      sweet=.39, acid=.78, bitter=.05, tannin=.03, carbonation=1.0, body=.38, aroma=.55, temp=7),
    # ── ароматизированные вина и биттеры ──
    X("vermouth_sweet", "fortified", "VERMOUTH", "Вермут сладкий (bianco / rosso)", 15.0, None, "regulation",
      "EU 251/2014 ст. 6: «semi-sweet» 90–130 г/л, «sweet» ≥ 130 г/л; категория конкретных SKU на этикетке не "
      "сверена; по шкале §2.1 это ≥ 1.0, взято .8 — горечь полыни частично маскирует сладость (оценка)",
      ["aperitif"], ["italian"],
      {"herbal": .9, "warm_spice": .4, "bitter_orange": .4, "oak_vanilla": .3, "caramel": .3},
      {"url": EU_251_2014, "date": VERIFIED_DATE, "what": "пороги сахара ароматизированных вин"}, None,
      sweet=.8, acid=.35, bitter=.45, tannin=.05, carbonation=0, body=.6, aroma=.8, temp=6),
    X("vermouth_dry", "fortified", "VERMOUTH", "Вермут сухой", 18.0, None, "regulation",
      "EU 251/2014 ст. 6: «extra-dry» < 30 г/л, «dry» < 50 г/л → sweet ≤ .45 по шкале §2.1; взято .3 (оценка)",
      ["aperitif"], ["italian", "french"], {"herbal": .9, "citrus": .4, "floral": .3},
      {"url": EU_251_2014, "date": VERIFIED_DATE, "what": "пороги сахара ароматизированных вин"}, None,
      sweet=.3, acid=.45, bitter=.45, tannin=.05, carbonation=0, body=.4, aroma=.75, temp=6),
    X("bitter_aperitif", "liqueur", "BITTER_APERITIF", "Биттер-аперитив", 25.0, None, "expert",
      "экспертная оценка по категории «горький аперитив типа Campari» (горечь ≈ негрони, сладость ликёрная); сахар "
      "SKU не сверен", ["aperitif"], ["italian"], {"bitter_orange": 1, "herbal": .7, "red_fruit": .2}, None, None,
      sweet=.6, acid=.15, bitter=.9, tannin=.05, carbonation=0, body=.6, aroma=.9, temp=6),
    # ── крепкое ──
    X("brandy", "spirit", "BRANDY", "Коньяк / бренди", 40.0, None, "expert",
      "40 % без льда, как whisky_neat; фруктовая база и дуб — экспертная оценка по категории", ["evening", "gourmet"],
      ["french"], {"oak_vanilla": .8, "dark_fruit": .6, "caramel": .5, "warmth": 1}, None, None,
      sweet=.2, bitter=.15, tannin=.2, body=.65, aroma=.8, roast=.05, temp=18),
    X("gin_neat", "spirit", "GIN", "Джин", 40.0, None, "expert",
      "шкала spec §2.1: ароматика джина .6, горечь крепкого .15–.25; можжевельник — определяющий ботаник",
      ["aperitif", "evening"], ["english"], {"juniper": 1, "citrus": .5, "herbal": .5, "warm_spice": .3, "warmth": 1},
      None, None, bitter=.25, tannin=.02, body=.45, aroma=.6, temp=10),
    X("rum_white", "spirit", "RUM", "Белый ром", 40.0, None, "expert",
      "экспертная оценка по категории (нейтральный ром для коктейлей)", ["party", "evening"], ["international"],
      {"oak_vanilla": .2, "caramel": .2, "warmth": 1}, None, None,
      sweet=.1, bitter=.12, body=.5, aroma=.35, temp=18),
    X("rum_aged", "spirit", "RUM", "Выдержанный / пряный ром", 40.0, None, "expert",
      "экспертная оценка по категории; многие выдержанные и пряные ромы подслащены — сахар SKU не измерен",
      ["evening", "dessert", "gourmet"], ["international"],
      {"caramel": .8, "oak_vanilla": .7, "dark_fruit": .5, "chocolate": .3, "warmth": 1}, None, None,
      sweet=.35, bitter=.15, tannin=.15, body=.7, aroma=.8, roast=.05, temp=18),
    X("tequila_blanco", "spirit", "AGAVE", "Текила бланко", 38.0, None, "expert",
      "экспертная оценка по категории; агава — определяющий аромат (как mezcal, но без дыма)", ["party", "evening"],
      ["mexican"], {"agave": 1, "pepper": .5, "citrus": .4, "herbal": .3, "warmth": 1}, None, None,
      sweet=.05, bitter=.2, body=.5, aroma=.7, temp=18),
    X("tequila_aged", "spirit", "AGAVE", "Текила аньехо / репосадо", 38.0, None, "expert",
      "экспертная оценка по категории; выдержка в дубе → oak_vanilla, caramel", ["evening", "gourmet"], ["mexican"],
      {"agave": .8, "oak_vanilla": .7, "caramel": .6, "warmth": 1}, None, None,
      sweet=.15, bitter=.2, tannin=.15, body=.6, aroma=.8, temp=18),
    X("anise_spirit", "spirit", "ANISE", "Анисовая водка (ракы)", 45.0, None, "expert",
      "экспертная оценка; ракы пьют охлаждённой, с водой и льдом («львиное молоко») — отсюда serve_temp 8",
      ["meal", "evening"], ["turkish"], {"anise": 1, "warmth": 1}, None, None,
      sweet=.05, bitter=.15, body=.55, aroma=.9, temp=8),
    X("clear_spirit_aromatic", "spirit", "CLEAR_SPIRIT", "Чача / граппа / самогон", 42.0, None, "expert",
      "экспертная оценка: неразбавленный невыдержанный дистиллят с выраженным ароматом сырья (ароматнее водки)",
      ["meal", "evening"], ["caucasian", "italian"], {"orchard_fruit": .3, "floral": .3, "grain": .2, "warmth": 1},
      None, None, sweet=.05, bitter=.2, tannin=.02, body=.55, aroma=.65, temp=12),
    # ── ликёры ──
    X("liqueur_cream", "liqueur", "CREAM_LIQUEUR", "Сливочный ликёр", 17.0, None, "spec",
      "шкала spec §2.1: dairy .8 «сливочный ликёр»; сладость и тело — экспертная оценка", ["dessert"], ["irish"],
      {"dairy_cream": 1, "chocolate": .6, "coffee": .3, "oak_vanilla": .3, "warmth": .3}, None, None,
      sweet=.9, bitter=.05, body=.9, dairy=.8, aroma=.6, roast=.15, temp=6),
    X("liqueur_citrus", "liqueur", "FRUIT_LIQUEUR", "Цитрусовый ликёр (лимончелло, трипл сек)", 35.0, None, "expert",
      "экспертная оценка по категории; сахар SKU не измерен", ["dessert"], ["italian", "french"],
      {"citrus": .9, "bitter_orange": .5, "warmth": .6}, None, None,
      sweet=.85, acid=.2, bitter=.15, body=.7, aroma=.85, temp=8),
    X("liqueur_herbal", "liqueur", "HERBAL_LIQUEUR", "Травяной ликёр", 35.0, None, "expert",
      "экспертная оценка по категории (Jägermeister, Becherovka, Drambuie): сладкий и горьковато-пряный",
      ["dessert", "evening"], ["german", "czech"],
      {"herbal": 1, "warm_spice": .5, "anise": .4, "bitter_orange": .3, "honey": .2, "warmth": .7}, None, None,
      sweet=.7, acid=.05, bitter=.6, tannin=.05, body=.75, aroma=.9, temp=5),
    X("amaro", "liqueur", "AMARO", "Амаро / горький травяной ликёр", 30.0, None, "spec",
      "шкала spec §2.1: фернет bitter 1, амаро aroma 1; сладость — экспертная оценка по категории",
      ["evening", "dessert"], ["italian"],
      {"herbal": 1, "bitter_orange": .5, "warm_spice": .4, "anise": .3, "mint": .3, "warmth": .7}, None, None,
      sweet=.45, acid=.05, bitter=.9, tannin=.1, body=.7, aroma=1.0, temp=14),
    # ── коктейли: рецептура барной классики; ABV в бокале — оценка рыночного отчёта ──
    X("mojito", "cocktail", "HIGHBALL", "Мохито", 10.0, None, "recipe",
      "рецептура классики: белый ром, лайм, сахар, мята, содовая (IBA; по первоисточнику не сверено); ABV ≈ 10 % — "
      "оценка рыночного отчёта", ["hot", "party"], ["international"], {"mint": 1, "citrus": .9, "warmth": .2},
      None, None, sweet=.55, acid=.65, bitter=.03, carbonation=.6, body=.3, aroma=.7, temp=3),
    X("sour_highball", "cocktail", "HIGHBALL", "Кислый хайбол (коллинз, палома)", 10.0, None, "recipe",
      "рецептура: крепкое + цитрус + сахар/газировка (Tom Collins, Paloma); ABV ≈ 10 % — оценка отчёта",
      ["hot", "party", "aperitif"], ["international"], {"citrus": .9}, None, None,
      sweet=.45, acid=.65, bitter=.05, carbonation=.8, body=.3, aroma=.55, temp=3),
    X("highball_mixed", "cocktail", "HIGHBALL", "Хайбол с колой / имбирным пивом", 10.0, None, "recipe",
      "рецептура: крепкое + кола или имбирное пиво + лайм (Cuba Libre, Moscow Mule, Dark 'n' Stormy); сладость от "
      "газировки; ABV — оценка отчёта", ["hot", "party"], ["international"],
      {"citrus": .5, "caramel": .3, "warm_spice": .3}, None, None,
      sweet=.6, acid=.4, bitter=.08, carbonation=.8, body=.3, aroma=.55, temp=3),
    X("sour_classic", "cocktail", "SOUR_COCKTAIL", "Сауэр (виски сауэр, дайкири, кайпиринья)", 18.0, None, "recipe",
      "формула сауэра: крепкое + цитрус + сахар; ABV после шейка ≈ 15–20 % (оценка, как у margarita прототипа)",
      ["party", "evening"], ["international"], {"citrus": 1, "warmth": .4}, None, None,
      sweet=.45, acid=.85, bitter=.08, body=.4, aroma=.65, temp=2),
    X("dry_martini", "cocktail", "STIRRED", "Сухой мартини", 30.0, None, "recipe",
      "stirred: джин + сухой вермут; ABV ≈ 30 % (оценка, как у stirred-коктейлей прототипа)",
      ["aperitif", "evening"], ["american"], {"juniper": .9, "herbal": .7, "brine": .2, "warmth": .8}, None, None,
      sweet=.02, acid=.05, bitter=.35, body=.75, aroma=.75, temp=2),
    X("espresso_martini", "cocktail", "COFFEE_COCKTAIL", "Эспрессо мартини", 18.0, None, "recipe",
      "рецептура: водка + кофейный ликёр + эспрессо; шкала spec §2.1: кофейные коктейли roast .7; ABV — оценка отчёта",
      ["dessert", "evening"], ["international"], {"coffee": 1, "chocolate": .4, "oak_vanilla": .3}, None, None,
      sweet=.5, acid=.25, bitter=.5, tannin=.1, body=.6, aroma=.8, roast=.7, temp=3),
    X("pina_colada", "cocktail", "CREAM_COCKTAIL", "Пина колада", 12.0, None, "recipe",
      "рецептура: ром + кокосовые сливки + ананас; dairy .2 — жир кокоса без молочного белка (spec §2.1 считает белок "
      "главным), оценка", ["party", "dessert", "hot"], ["international"],
      {"tropical_fruit": 1, "dairy_cream": .6, "nutty": .3}, None, None,
      sweet=.85, acid=.3, body=.85, dairy=.2, aroma=.65, temp=2),
    X("bloody_mary", "cocktail", "SAVORY_COCKTAIL", "Кровавая Мэри", 10.0, None, "spec",
      "шкала spec §2.1: томатный сок / Bloody Mary umami .6; соль рецепта (сельдерейная соль, вустер) ≈ .3–.4 — оценка",
      ["meal"], ["american"], {"pepper": .7, "herbal": .4, "brine": .4, "citrus": .3}, None, None,
      sweet=.15, acid=.55, bitter=.1, body=.6, salt=.35, umami=.6, aroma=.7, temp=3),
    X("sparkling_wine_cocktail", "cocktail", "SPRITZ", "Коктейль на игристом (беллини, мимоза, хуго)", 8.0, None,
      "recipe", "рецептура: просекко + фруктовое пюре / сок / сироп бузины; ABV 7–8 % — оценка отчёта",
      ["aperitif", "party", "hot"], ["italian"], {"stone_fruit": .5, "citrus": .5, "floral": .3}, None, None,
      sweet=.5, acid=.65, bitter=.03, carbonation=.8, body=.35, aroma=.6, temp=4),
    X("long_sweet", "cocktail", "LONG_SWEET", "Сладкий лонг (секс на пляже, текила санрайз)", 10.0, None, "recipe",
      "рецептура: крепкое + соки / сиропы (апельсин, клюква, гренадин, кюрасао); ABV — оценка отчёта",
      ["party", "hot"], ["international"],
      {"citrus": .6, "red_fruit": .5, "tropical_fruit": .4, "stone_fruit": .3}, None, None,
      sweet=.8, acid=.45, bitter=.02, carbonation=.2, body=.4, aroma=.6, temp=2),
    X("sangria", "cocktail", "WINE_PUNCH", "Сангрия", 8.0, None, "recipe",
      "рецептура: красное вино + фрукты + пряности; танин вина разбавлен — оценка", ["party", "hot"], ["spanish"],
      {"red_fruit": .7, "citrus": .6, "warm_spice": .5, "dark_fruit": .4}, None, None,
      sweet=.45, acid=.55, bitter=.1, tannin=.3, carbonation=.1, body=.45, aroma=.6, temp=5),
    # ── национальное и безалкогольное ──
    X("tan", "dairy", "FERMENTED_DAIRY", "Тан (газированный кисломолочный)", 0.0, None, "expert",
      "экспертная оценка: айран (прототип) + газация средняя; солёный, кислый", ["meal", "hot"],
      ["kazakh", "central_asian"], {"sour_lactic": .8, "dairy_cream": .8, "brine": .4}, None, None,
      sweet=.05, acid=.55, carbonation=.5, body=.4, dairy=.5, salt=.4, umami=.1, aroma=.4, temp=5),
    X("drinking_yogurt", "dairy", "DAIRY", "Питьевой кисломолочный (катык, снежок)", 0.0, None, "expert",
      "экспертная оценка по категории: без соли, сладость зависит от SKU", ["meal", "dessert"], ["kazakh", "russian"],
      {"dairy_cream": .9, "sour_lactic": .6}, None, None,
      sweet=.35, acid=.5, body=.6, dairy=.7, umami=.05, aroma=.35, temp=5),
    X("saumal", "dairy", "DAIRY", "Саумал (свежее кобылье молоко)", 0.0, None, "expert",
      "экспертная оценка: неферментированное кобылье молоко, сладковатое (лактоза), лёгкое; состав не измерен",
      ["meal"], ["kazakh", "central_asian"], {"dairy_cream": .8}, None, None,
      sweet=.35, acid=.1, body=.3, dairy=.5, salt=.02, umami=.05, aroma=.3, temp=6),
    X("boza", "kvass", "GRAIN_FERMENTED", "Боза (злаковый ферментированный)", 1.0, None, "expert",
      "экспертная оценка: слабоферментированный густой напиток из проса/пшеницы, кисло-сладкий", ["meal", "hot"],
      ["kazakh", "central_asian", "turkish"], {"grain": .8, "bread": .5, "sour_lactic": .5, "yeast": .4}, None, None,
      sweet=.45, acid=.45, bitter=.02, carbonation=.15, body=.7, aroma=.45, temp=6),
    X("maksym", "kvass", "GRAIN_FERMENTED", "Максым / шоро (злаковый, солоноватый)", 0.5, None, "expert",
      "экспертная оценка: ферментированный напиток из талкана, кислый и солоноватый", ["meal", "hot"],
      ["central_asian", "kazakh"], {"grain": .8, "sour_lactic": .7, "brine": .4, "bread": .3}, None, None,
      sweet=.15, acid=.55, bitter=.05, carbonation=.2, body=.55, dairy=.1, salt=.3, umami=.1, aroma=.45, temp=6),
    X("juice", "lemonade", "JUICE", "Сок", 0.0, None, "expert",
      "шкала spec §2.1: для соков/лимонадов sweet = углеводы г/100 мл × 10 г/л; этикетки SKU не сверены, соки обычно "
      "8–11 г/100 мл → .85 (оценка)", ["meal", "hot"], ["international"], {"citrus": .6, "orchard_fruit": .5},
      None, None, sweet=.85, acid=.6, bitter=.02, body=.45, aroma=.6, temp=5),
    X("cola", "soda", "SODA", "Кола", 0.0, None, "expert",
      "как lemonade_sweet прототипа (≈ 100 г/л по этикетке); этикетка KZ-SKU не сверена; Zero — подсластители "
      "(воспринимаемая сладость та же, оценка)", ["hot", "party"], ["american", "international"],
      {"caramel": .6, "warm_spice": .4, "citrus": .3}, None, None,
      sweet=.95, acid=.6, bitter=.1, carbonation=.85, body=.3, aroma=.5, temp=4),
    X("tonic_water", "soda", "TONIC", "Тоник", 0.0, None, "spec",
      "шкала spec §2.1: тоник bitter .5 (хинин); сладость — оценка", ["aperitif", "hot"], ["english"],
      {"citrus": .5, "herbal": .3, "bitter_orange": .2}, None, None,
      sweet=.55, acid=.5, bitter=.55, carbonation=.95, body=.25, aroma=.4, temp=4),
    X("energy_drink", "soda", "SODA", "Энергетик", 0.0, None, "expert",
      "экспертная оценка по категории: очень сладкий, кислый, газированный", ["party"], ["international"],
      {"citrus": .4, "tropical_fruit": .3}, None, None,
      sweet=.9, acid=.55, bitter=.15, carbonation=.85, body=.3, aroma=.6, temp=4),
    X("iced_tea", "soda", "ICED_TEA", "Холодный чай", 0.0, None, "expert",
      "экспертная оценка: сладкий чайный напиток без газа (лимон / персик)", ["hot", "meal"], ["international"],
      {"citrus": .5, "stone_fruit": .4}, None, None,
      sweet=.6, acid=.45, bitter=.2, tannin=.2, body=.3, aroma=.5, temp=5),
    X("water_still", "water", "WATER", "Питьевая вода", 0.0, None, "expert",
      "нейтральная вода: все оси ≈ 0 (Nolden 2019: вода — базовая линия против жжения)", ["meal"], ["international"],
      {"mineral": .3}, None, None, body=.02, aroma=0.0, temp=8),
    X("mineral_water_salty", "water", "WATER", "Минеральная вода (солоноватая, газированная)", 0.0, None, "expert",
      "экспертная оценка: гидрокарбонатно-натриевая вода с заметной солоноватостью; минерализация SKU не сверена",
      ["meal"], ["caucasian"], {"mineral": .8, "brine": .5}, None, None,
      acid=.15, bitter=.05, carbonation=.95, body=.08, salt=.2, aroma=.1, temp=6),
    X("herbal_tea", "tea", "TEA", "Травяной / фруктовый чай", 0.0, None, "expert",
      "экспертная оценка: без чайного танина; кислотность зависит от сбора (облепиха, ягоды)", ["meal", "dessert"],
      ["kazakh", "russian"], {"herbal": .9, "floral": .4, "red_fruit": .3}, None, None,
      sweet=.05, acid=.3, bitter=.1, tannin=.05, body=.2, aroma=.7, temp=70),
    X("tea_milk", "tea", "TEA", "Чай с молоком по-казахски", 0.0, None, "expert",
      "экспертная оценка: black_tea_strong прототипа + молоко/сливки — белок частично связывает танин",
      ["meal", "dessert"], ["kazakh", "central_asian"], {"dairy_cream": .6, "honey": .1}, None, None,
      sweet=.05, acid=.05, bitter=.3, tannin=.45, body=.5, dairy=.35, aroma=.5, roast=.1, temp=70),
    X("coffee_black", "coffee", "COFFEE", "Чёрный кофе (эспрессо, американо)", 0.0, None, "spec",
      "шкала spec §2.1: эспрессо bitter .7, roast 1; кислотность — оценка", ["dessert"], ["international"],
      {"coffee": 1, "roast": .8, "chocolate": .3}, None, None,
      acid=.5, bitter=.7, tannin=.2, body=.45, aroma=.9, roast=1.0, temp=65),
    X("coffee_milk", "coffee", "COFFEE", "Кофе с молоком (капучино, латте)", 0.0, None, "expert",
      "экспертная оценка: coffee_black + молоко (dairy .5, обжарка приглушена)", ["dessert"], ["international"],
      {"coffee": .8, "dairy_cream": .8, "chocolate": .3}, None, None,
      sweet=.2, acid=.15, bitter=.4, tannin=.1, body=.65, dairy=.5, aroma=.7, roast=.6, temp=65),
    X("hot_chocolate", "coffee", "COCOA", "Горячий шоколад", 0.0, None, "expert",
      "экспертная оценка: какао + молоко, сладкий и плотный", ["dessert"], ["international"],
      {"chocolate": 1, "dairy_cream": .7}, None, None,
      sweet=.75, acid=.05, bitter=.25, tannin=.1, body=.85, dairy=.6, aroma=.7, roast=.4, temp=60),
    X("milkshake", "dairy", "DAIRY", "Молочный коктейль", 0.0, None, "expert",
      "экспертная оценка: мороженое + молоко + сироп", ["dessert"], ["international"],
      {"dairy_cream": 1, "oak_vanilla": .4}, None, None,
      sweet=.9, acid=.05, body=.9, dairy=.8, aroma=.5, temp=4),
])

# База уверенности по типу якоря архетипа (см. docs/CATALOG_V2.md).
ANCHOR_BASE = {"bjcp": 0.70, "regulation": 0.65, "spec": 0.60, "prototype": 0.60, "recipe": 0.55, "expert": 0.50}
ANCHOR_TYPE_RU = {"bjcp": "BJCP", "regulation": "норматив (ЕС / ГОСТ)", "spec": "шкала spec §2.1",
                  "prototype": "архетип прототипа", "recipe": "рецептура", "expert": "экспертная оценка по категории"}

GLASS = {
    "LAGER": "пилснер / кружка", "AMBER_LAGER": "кружка", "DARK_LAGER": "кружка", "STRONG_LAGER": "тюльпан",
    "WHEAT": "бокал для пшеничного пива", "IPA": "тюльпан / пинта", "BROWN_ALE": "пинта", "STOUT": "пинта / тюльпан",
    "STRONG_ALE": "снифтер", "SMOKED": "кружка", "SOUR": "тюльпан", "NA_BEER": "пилснер / кружка",
    "RADLER": "кружка", "CIDER": "бокал для сидра / пинта", "WHITE": "бокал для белого вина",
    "RED": "бокал для красного вина", "SPARKLING": "флюте", "FORTIFIED": "малый винный бокал",
    "SPRITZ": "винный бокал со льдом", "BITTER_COCKTAIL": "рокс", "SOUR_COCKTAIL": "купе / рокс",
    "STIRRED": "рокс / коктейльный бокал", "HIGHBALL": "хайбол", "CREAM_COCKTAIL": "рокс / харрикейн",
    "WHISKY": "гленкерн / тумблер", "VODKA": "рюмка", "AGAVE": "копита / шот", "KVASS": "кружка",
    "LEMONADE": "хайбол / кувшин", "WATER": "стакан", "FERMENTED_DAIRY": "пиала", "TEA": "пиала / чашка",
    "GOLDEN_ALE": "пинта / стэнге", "ENGLISH_ALE": "пинта", "BELGIAN": "кубок / тюльпан",
    "BELGIAN_DARK": "кубок / тюльпан", "FRUIT_BEER": "тюльпан", "WOOD_AGED": "снифтер", "VERMOUTH": "рокс со льдом",
    "BITTER_APERITIF": "рокс со льдом", "BRANDY": "коньячный снифтер", "GIN": "рокс", "RUM": "тумблер",
    "ANISE": "узкий высокий стакан (с водой и льдом)", "CLEAR_SPIRIT": "рюмка", "CREAM_LIQUEUR": "рокс со льдом",
    "FRUIT_LIQUEUR": "ликёрная рюмка", "HERBAL_LIQUEUR": "ликёрная рюмка", "AMARO": "рокс / дижестивная рюмка",
    "COFFEE_COCKTAIL": "коктейльный бокал", "SAVORY_COCKTAIL": "хайбол", "LONG_SWEET": "хайбол / харрикейн",
    "WINE_PUNCH": "кувшин / винный бокал", "DAIRY": "стакан", "GRAIN_FERMENTED": "пиала / кружка", "JUICE": "стакан",
    "SODA": "хайбол", "TONIC": "хайбол", "ICED_TEA": "хайбол", "COFFEE": "чашка", "COCOA": "кружка",
}
TEMP_SPREAD = {"beer": 2, "na_beer": 2, "radler": 2, "cider": 2, "wine": 2, "sparkling": 1, "fortified": 2,
               "cocktail": 2, "spirit": 2, "liqueur": 3, "kvass": 2, "lemonade": 2, "soda": 2, "dairy": 2, "tea": 10,
               "coffee": 5, "water": 3}


# Диапазон ABV стиля BJCP (для «середины стиля», когда ABV продукта не опубликован). Берётся из якоря архетипа;
# у 27A Kellerbier своих цифр нет — «Same as base style», база архетипа — 4A Munich Helles.
ABV_RANGE_OVERRIDES = {"kellerbier": ([4.7, 5.4], "BJCP 27A (как у базового стиля 4A Munich Helles)")}
ABV_RANGE_RE = re.compile(r"BJCP\s+(\d+[A-Z])\b[^·;]*?ABV\s+(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)")


def abv_range_for(aid, anchor, anchor_type):
    if aid in ABV_RANGE_OVERRIDES:
        return ABV_RANGE_OVERRIDES[aid]
    if anchor_type != "bjcp":
        return None, None
    m = ABV_RANGE_RE.search(anchor)
    if not m:
        return None, None
    return [float(m.group(2)), float(m.group(3))], f"BJCP {m.group(1)}"


def build_priors(proto):
    anchors = parse_spec_anchors()
    priors = OrderedDict()
    warnings = []
    for k in proto.DRINKS:
        aid = k["id"]
        label, family, bjcp, occ, extra = PROTO_META[aid]
        tags = {}
        dropped = []
        for t, w in k["tags"].items():
            nt = PROTO_TAG_RENAME.get(t, t)
            if nt is None or nt not in TAG_VOCAB:
                dropped.append(f"{t} {fmt(w)} удалён (ось, а не аромат-мост)")
                continue
            if nt != t:
                dropped.append(f"{t} {fmt(w)} → {nt} (spec §2.5)")
            tags[nt] = max(tags.get(nt, 0.0), w)
        origin = []
        for o in k["origin"]:
            no = PROTO_ORIGIN_RENAME.get(o, o)
            if no != o:
                dropped.append(f"origin {o} → {no} (нет в перечне origin_affinity)")
            if no not in origin:
                origin.append(no)
        anchor = anchors.get(aid)
        if not anchor:
            warnings.append(f"нет якоря в spec §2.4 для {aid}")
            anchor = "engine_v2_prototype.py"
        verified = None
        if extra:
            anchor = anchor + " · " + extra[0]
            verified = {"url": extra[1], "date": VERIFIED_DATE, "what": VS}
        if "BJCP" in anchor:
            atype = "bjcp"
        elif "ГОСТ" in anchor or "EU" in anchor or "г/л" in anchor:
            atype = "regulation"
        else:
            atype = "prototype"
        rec = OrderedDict()
        rec["category"] = k["cat"]
        rec["family"] = family
        rec["label_ru"] = label
        rec["abv"] = k["abv"]
        rec["ibu"] = k["ibu"]
        rec["sensory"] = OrderedDict([
            ("sweet", k["sweet"]), ("acid", k["acid"]), ("bitter", k["bitter"]), ("tannin", k["tannin"]),
            ("carbonation", k["carb"]), ("alcohol", r3(clamp(k["abv"] / 40))), ("body", k["body"]),
            ("dairy", k["dairy"]), ("salt", k["salt"]), ("umami", k["umami"]), ("aroma_intensity", k["aroma"]),
            ("roast", k["roast"]), ("smoke", k["smoke"]), ("serve_temp", k["temp"])])
        rec["aroma_tags"] = tags
        rec["origin_affinity"] = origin
        rec["anchor"] = anchor
        rec["anchor_type"] = atype
        if bjcp:
            rec["bjcp_code"] = bjcp
        rng, rng_src = abv_range_for(aid, anchor, atype)
        if rng:
            rec["abv_range"], rec["abv_range_source"] = rng, rng_src
        rec["occasions"] = occ
        rec["serving"] = serving_for(k["cat"], family, k["temp"])
        rec["source"] = "prototype"
        if verified:
            rec["verified"] = verified
        if dropped:
            rec["notes"] = ["Прототип: " + x for x in dropped]
        priors[aid] = rec
    for aid, a in EXTRA_ARCHETYPES.items():
        if aid in priors:
            raise SystemExit(f"архетип {aid} уже есть в прототипе")
        rec = OrderedDict()
        rec["category"] = a["category"]
        rec["family"] = a["family"]
        rec["label_ru"] = a["label_ru"]
        rec["abv"] = a["abv"]
        rec["ibu"] = a["ibu"]
        rec["sensory"] = OrderedDict((ax, a["sensory"][ax]) for ax in AXES)
        rec["aroma_tags"] = a["aroma_tags"]
        rec["origin_affinity"] = a["origin_affinity"]
        rec["anchor"] = a["anchor"]
        rec["anchor_type"] = a["anchor_type"]
        if a["bjcp_code"]:
            rec["bjcp_code"] = a["bjcp_code"]
        rng, rng_src = abv_range_for(aid, a["anchor"], a["anchor_type"])
        if rng:
            rec["abv_range"], rec["abv_range_source"] = rng, rng_src
        rec["occasions"] = a["occasions"]
        rec["serving"] = serving_for(a["category"], a["family"], a["sensory"]["serve_temp"])
        rec["source"] = "catalog_v2"
        if a["verified"]:
            rec["verified"] = a["verified"]
        priors[aid] = rec
    return priors, warnings


def serving_for(cat, family, temp):
    d = TEMP_SPREAD.get(cat, 2)
    out = OrderedDict([("temp_min_c", max(-5, temp - d)), ("temp_max_c", temp + d)])
    if family in GLASS:
        out["glass"] = GLASS[family]
    return out


# ═══════════════════════════════ 2. ОТЧЁТЫ ═══════════════════════════════
def md_table_rows(path):
    """(заголовок раздела, ячейки) для строк таблиц, где первая ячейка — номер."""
    section = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            section = line.lstrip("#").strip()
            continue
        if line.startswith("| ") and not line.startswith("|---"):
            cells = [c.strip() for c in line.strip().strip("|").split(" | ")]
            if cells and re.fullmatch(r"\d+", cells[0]):
                yield section, cells


def parse_num(s):
    s = (s or "").strip().replace(",", ".")
    if s in ("", "—", "-", "n/a", "н/д"):
        return None
    m = re.fullmatch(r"~?(\d+(?:\.\d+)?)", s)
    if not m:
        raise ValueError(f"не число: {s!r}")
    return float(m.group(1))


OTHER_SECTIONS = {"Сидры": "cider", "Безалкогольное пиво": "na_beer", "Радлеры / hard lemonade": "radler",
                  "Квас": "kvass", "Вина": "wine", "Игристые": "sparkling", "Вермуты / аперитивы": "vermouth",
                  "Коктейли": "cocktail", "Крепкое и ликёры": "spirits",
                  "Безалкогольное, национальное, чай, кофе": "national"}
OTHER_SECTION_RU = {v: k for k, v in OTHER_SECTIONS.items()}
AVAIL_OTHER = {"широко": "wide", "HoReCa": "horeca", "импорт/алкомаркеты": "import", "ниша": "niche",
               "не подтверждено": "not_confirmed"}
BODY_WORD = {"лёгкое": 0.3, "легкое": 0.3, "среднее": 0.5, "полное": 0.8}
GAS_WORD = {"нет": 0.0, "низкий": 0.2, "средний": 0.45, "высокий": 0.85}


def parse_expert(text):
    """«Сл4/Кисл2/Гор0 · тело лёгкое · газ высокий · ноты; комментарий» → оценки 0..1, ноты, комментарий."""
    m = re.search(r"Сл(\d)\s*/\s*Кисл(\d)\s*/\s*Гор(\d)", text)
    if not m:
        return None, "", text
    parts = [p.strip() for p in text.split(" · ")]
    body = gas = None
    rest = []
    for p in parts[1:]:
        if p.startswith("тело "):
            body = p[5:].strip()
        elif p.startswith("газ "):
            gas = p[4:].strip()
        else:
            rest.append(p)
    tail = " · ".join(rest)
    desc, _, comment = tail.partition(";")
    exp = OrderedDict()
    exp["sweet"] = int(m.group(1)) / 5
    exp["acid"] = int(m.group(2)) / 5
    exp["bitter"] = int(m.group(3)) / 5
    raw = f"Сл{m.group(1)}/Кисл{m.group(2)}/Гор{m.group(3)}"
    if body:
        w = body.split()[0]
        if w in BODY_WORD:
            exp["body"] = BODY_WORD[w]
        raw += f", тело {body}"
    if gas:
        w = gas.split()[0]
        if "/" not in w and w in GAS_WORD:
            exp["carbonation"] = GAS_WORD[w]
        raw += f", газ {gas}"
    exp["_raw"] = raw
    return exp, desc.strip(), comment.strip()


def load_rows():
    rows = []
    for section, c in md_table_rows(REPORT_BEER):
        if len(c) != 13:
            raise SystemExit(f"{BEER_FILE}: строка {c[0]} — {len(c)} ячеек вместо 13")
        n = int(c[0])
        rows.append({
            "report": "beer", "no": n, "key": f"beer#{n}", "ref": f"{BEER_FILE} №{n}", "section": "beer",
            "name": c[1], "producer": c[2], "category_raw": c[3], "style_raw": c[4], "abv": parse_num(c[5]),
            "ibu": parse_num(c[6]), "country_raw": c[7], "efes_raw": c[8], "avail_raw": c[9], "price_raw": c[10],
            "note": "" if c[11] in ("—", "-") else c[11], "sources_raw": c[12], "expert": None, "descriptors": "",
        })
    for section, c in md_table_rows(REPORT_OTHER):
        if len(c) != 11:
            raise SystemExit(f"{OTHER_FILE}: строка {c[0]} — {len(c)} ячеек вместо 11")
        head = re.sub(r"\s*\(\d+\)\s*$", "", section or "")
        sec = OTHER_SECTIONS.get(head)
        if sec is None:
            raise SystemExit(f"{OTHER_FILE}: неизвестный раздел {section!r}")
        n = int(c[0])
        exp, desc, comment = parse_expert(c[6])
        rows.append({
            "report": "other", "no": n, "key": f"other:{sec}#{n}",
            "ref": f"{OTHER_FILE}, раздел «{head}» №{n}", "section": sec,
            "name": c[1], "producer": c[2], "country_raw": c[3], "style_raw": c[4], "abv": parse_num(c[5]),
            "ibu": None, "sensory_raw": c[6], "price_raw": c[7], "avail_raw": c[8], "efes_raw": c[9],
            "sources_raw": c[10], "expert": exp, "descriptors": desc, "note": comment, "category_raw": sec,
        })
    return rows


# ═══════════════════════════════ 3. СТИЛЬ → АРХЕТИП ═══════════════════════════════
# (архетип, категория напитка, точность): exact — архетип описывает стиль; generic — стиль указан обобщённо или
# архетип лишь близок (уверенность ×0.85); fallback — стиль неизвестен, взята заглушка (×0.5, статус draft).
E, G, F = "exact", "generic", "fallback"
BEER_STYLE_MAP = {
    "International Pale Lager": ("pale_lager_intl", "beer", E),
    "Pilsner (International)": ("pale_lager_intl", "beer", E),
    "Italian Pale Lager": ("pale_lager_intl", "beer", G),
    "Pale Lager": ("pale_lager_intl", "beer", G),
    "Pale Lager (Zhigulevskoe)": ("pale_lager_intl", "beer", G),
    "Pale Lager (draft)": ("pale_lager_intl", "beer", G),
    "Pale Lager (draft-style)": ("pale_lager_intl", "beer", G),
    "Premium Pale Lager (draft)": ("pale_lager_intl", "beer", G),
    "Pale Lager (German-style)": ("helles", "beer", G),
    "German-style Pale Lager": ("helles", "beer", G),
    "Light Lager": ("light_lager", "beer", E),
    "Light Lager (Japanese-style)": ("light_lager", "beer", E),
    "Light Lager (Helles-type)": ("helles", "beer", E),
    "American Lager": ("american_lager", "beer", E),
    "Munich Helles": ("helles", "beer", E),
    "Munich Helles (brewpub)": ("helles", "beer", E),
    "Munich Helles-type": ("helles", "beer", E),
    "Munich Helles / Export": ("helles_export", "beer", E),
    "Export Lager": ("helles_export", "beer", G),
    "Kellerbier / Zwickel": ("kellerbier", "beer", E),
    "Unfiltered Lager (brewpub)": ("kellerbier", "beer", G),
    "German Pils": ("german_pils", "beer", E),
    "German-style Pilsner": ("german_pils", "beer", E),
    "Czech Pale Lager": ("czech_pale_lager", "beer", E),
    "Czech-style Pale Lager": ("czech_pale_lager", "beer", E),
    "Czech-style Lager (brewpub)": ("czech_pale_lager", "beer", G),
    "Czech Pilsner": ("czech_pale_premium", "beer", E),
    "Czech Premium Pale Lager": ("czech_pale_premium", "beer", E),
    "Czech Premium Pale Lager (Bohemian Pilsner)": ("czech_pale_premium", "beer", E),
    "Czech Dark Lager": ("czech_dark", "beer", E),
    "Czech-style Dark Lager": ("czech_dark", "beer", E),
    "Czech Amber Lager": ("amber_lager", "beer", G),
    "Vienna Lager": ("amber_lager", "beer", E),
    "Vienna/Amber Lager": ("amber_lager", "beer", E),
    "Amber Lager": ("amber_lager", "beer", E),
    "Amber Lager (draft)": ("amber_lager", "beer", E),
    "Amber Ale/Lager": ("amber_lager", "beer", G),
    "Dark Lager": ("dark_lager_intl", "beer", G),
    "Munich Dunkel (brewpub)": ("munich_dunkel", "beer", E),
    "Doppelbock": ("doppelbock", "beer", E),
    "Strong Pale Lager": ("strong_lager", "beer", E),
    "Strong Pale Lager (Malt Liquor)": ("strong_lager", "beer", E),
    "Strong Lager (Malt Liquor)": ("strong_lager", "beer", E),
    "Rice Lager": ("rice_lager", "beer", E),
    "Japanese Rice Lager": ("rice_lager", "beer", E),
    "Rice/Pale Lager (Chinese-style)": ("rice_lager", "beer", E),
    "Wood-aged Lager": ("wood_aged_beer", "beer", E),
    "Weissbier": ("weissbier", "beer", E),
    "Dunkles Weissbier": ("dunkelweizen", "beer", E),
    "Witbier": ("witbier", "beer", E),
    "Witbier (fruit-flavoured)": ("witbier", "beer", E),
    "Fruit Witbier": ("witbier", "beer", E),
    "Belgian Witbier / Weissbier": ("witbier", "beer", G),
    "Kölsch": ("kolsch", "beer", E),
    "Blonde Ale": ("blonde_ale", "beer", E),
    "Blonde/Golden Ale": ("blonde_ale", "beer", E),
    "Golden Ale (honey)": ("blonde_ale", "beer", E),
    "Light Ale": ("blonde_ale", "beer", G),
    "British Bitter / Pale Ale": ("english_bitter", "beer", E),
    "English-style Ale (brewpub)": ("english_bitter", "beer", G),
    "British Brown Ale": ("brown_ale", "beer", E),
    "American Pale Ale": ("american_pale_ale", "beer", E),
    "Session IPA": ("american_pale_ale", "beer", G),
    "American IPA": ("american_ipa_45", "beer", E),
    "West Coast IPA": ("american_ipa_45", "beer", E),
    "English IPA": ("english_ipa", "beer", E),
    "Hazy IPA": ("hazy_ipa", "beer", E),
    "Milkshake IPA": ("hazy_ipa", "beer", G),
    "Double IPA": ("double_ipa_85", "beer", E),
    "Porter": ("porter", "beer", E),
    "Porter (sweet)": ("porter", "beer", G),
    "Stout": ("dry_stout", "beer", G),
    "Irish Dry Stout": ("dry_stout", "beer", E),
    "Sweet Stout": ("milk_stout", "beer", E),
    "Oatmeal/Sweet Stout": ("milk_stout", "beer", G),
    "Imperial Stout": ("imperial_stout", "beer", E),
    "Rauchbier": ("rauchbier", "beer", E),
    "Belgian Blond Ale": ("belgian_blond", "beer", E),
    "Belgian Blond Ale (abbey)": ("belgian_blond", "beer", E),
    "Belgian Strong Golden Ale": ("belgian_golden_strong", "beer", E),
    "Belgian Strong Ale": ("belgian_golden_strong", "beer", G),
    "Belgian Dubbel": ("belgian_dubbel", "beer", E),
    "Belgian Dubbel-style": ("belgian_dubbel", "beer", E),
    "Belgian Dubbel / Amber": ("belgian_dubbel", "beer", E),
    "Belgian Dark Ale": ("belgian_dubbel", "beer", G),
    "Belgian Tripel-style": ("belgian_tripel", "beer", E),
    "Fruit Lambic": ("kriek_sour", "beer", E),
    "Fruit Lambic (kriek)": ("kriek_sour", "beer", E),
    "Fruit Beer": ("fruit_beer_sweet", "beer", E),
    "Fruit Beer (Belgian)": ("fruit_beer_sweet", "beer", E),
    "Fruit Beer (cherry)": ("fruit_beer_sweet", "beer", E),
    "Belgian Fruit Beer (cherry)": ("fruit_beer_sweet", "beer", E),
    "Gose": ("gose", "beer", E),
    "Fruited Gose": ("gose", "beer", E),
    "Gose (с кумысом)": ("gose", "beer", G),
    "Tomato Gose": ("gose", "beer", G),
    "Sour Ale": ("sour_ale", "beer", G),
    "Non-alcoholic Lager": ("na_lager", "na_beer", E),
    "Non-alcoholic Wheat": ("na_wheat", "na_beer", E),
    "Non-alcoholic Weissbier": ("na_wheat", "na_beer", E),
    "Non-alcoholic Flavoured Beer": ("na_beer_fruit", "na_beer", E),
    "Non-alcoholic Stout": ("na_stout", "na_beer", E),
    "Flavoured Cider": ("cider_fruit", "cider", E),
    "Hard Lemonade (beer-based)": ("radler", "radler", G),
    "Kvass": ("kvass_classic", "kvass", E),
    "unknown": ("pale_lager_intl", "beer", F),
}
OTHER_STYLE_MAP = {
    # Сидры
    ("cider", "sweet apple cider"): ("cider_sweet_commercial", "cider", E),
    ("cider", "fruit cider / beer-based cider drink"): ("cider_sweet_commercial", "cider", E),
    ("cider", "pear cider (perry-style)"): ("cider_sweet_commercial", "cider", E),
    ("cider", "pear cider drink"): ("cider_sweet_commercial", "cider", E),
    ("cider", "cidre doux (sweet)"): ("cider_sweet_commercial", "cider", G),
    ("cider", "flavoured cider drink"): ("cider_fruit", "cider", E),
    ("cider", "fruit cider"): ("cider_fruit", "cider", E),
    ("cider", "berry fruit cider"): ("cider_fruit", "cider", E),
    ("cider", "cherry fruit cider"): ("cider_fruit", "cider", E),
    ("cider", "semi-dry apple cider"): ("cider_semi_dry", "cider", E),
    ("cider", "medium-dry apple cider"): ("cider_semi_dry", "cider", E),
    ("cider", "strong apple cider"): ("cider_semi_dry", "cider", G),
    ("cider", "cidre brut (traditional dry)"): ("cider_dry", "cider", E),
    ("cider", "dry craft apple cider"): ("cider_dry", "cider", E),
    ("cider", "natural apple cider (local apples)"): ("cider_dry", "cider", G),
    # Безалкогольное пиво
    ("na_beer", "non-alcoholic lager"): ("na_lager", "na_beer", E),
    ("na_beer", "non-alcoholic lager (мембранная деалкоголизация)"): ("na_lager", "na_beer", E),
    ("na_beer", "non-alcoholic pilsner"): ("na_lager", "na_beer", E),
    ("na_beer", "non-alcoholic pilsner (sugar-free)"): ("na_lager", "na_beer", E),
    ("na_beer", "non-alcoholic wheat beer"): ("na_wheat", "na_beer", E),
    ("na_beer", "flavoured non-alcoholic beer"): ("na_beer_fruit", "na_beer", E),
    # Радлеры
    ("radler", "shandy / radler (клюква)"): ("radler", "radler", E),
    ("radler", "hard lemonade"): ("radler", "radler", G),
    ("radler", "hard lemonade (strong)"): ("radler", "radler", G),
    ("radler", "hard lemonade (пивной напиток)"): ("radler", "radler", G),
    # Квас
    ("kvass", "хлебный квас"): ("kvass_classic", "kvass", E),
    ("kvass", "хлебный квас двойного брожения"): ("kvass_classic", "kvass", E),
    ("kvass", "традиционный хлебный квас"): ("kvass_classic", "kvass", E),
    ("kvass", "тёмный хлебный квас"): ("kvass_classic", "kvass", E),
    ("kvass", "живой квас брожения"): ("kvass_classic", "kvass", E),
    ("kvass", "белый квас"): ("kvass_sour", "kvass", E),
    # Вина: категория сахара на этикетке выбирает архетип
    ("wine", "белое сухое"): ("white_dry", "wine", E),
    ("wine", "белое сухое (Алиготе)"): ("white_dry", "wine", E),
    ("wine", "белое сухое (Мускат)"): ("white_dry", "wine", E),
    ("wine", "белое сухое (Ркацители)"): ("white_dry", "wine", E),
    ("wine", "белое сухое (Ркацители+Мцване)"): ("white_dry", "wine", E),
    ("wine", "белое/розовое сухое, автохтонный сорт"): ("white_dry", "wine", G),
    ("wine", "белое полусухое (Рислинг/Ркацители)"): ("white_semi_dry", "wine", E),
    ("wine", "белое полусладкое"): ("white_semi_sweet", "wine", E),
    ("wine", "белое полусладкое (Мускат)"): ("white_semi_sweet", "wine", E),
    ("wine", "белое природно-полусладкое (Цоликаури)"): ("white_semi_sweet", "wine", E),
    ("wine", "белое полусладкое/десертное (линейка)"): ("white_semi_sweet", "wine", G),
    ("wine", "красное природно-полусладкое (Саперави)"): ("red_semi_sweet", "wine", E),
    ("wine", "красное природно-полусладкое (Александроули/Муджуретули)"): ("red_semi_sweet", "wine", E),
    ("wine", "красное полусухое (Саперави/Пино/Каберне)"): ("red_semi_dry", "wine", E),
    ("wine", "красное сухое (Саперави)"): ("cabernet", "wine", E),
    ("wine", "красное сухое выдержанное (Саперави, дуб)"): ("cabernet", "wine", E),
    ("wine", "красное сухое (Каберне)"): ("cabernet", "wine", E),
    ("wine", "красное сухое (Каберне Совиньон)"): ("cabernet", "wine", E),
    ("wine", "красное сухое (Мальбек)"): ("cabernet", "wine", G),
    ("wine", "красное сухое"): ("red_dry_medium", "wine", G),
    ("wine", "красное сухое (Саперави/Пино)"): ("red_dry_medium", "wine", E),
    ("wine", "красное сухое Chianti DOCG"): ("red_dry_medium", "wine", E),
    ("wine", "красное сухое / белое сухое"): ("red_dry_medium", "wine", G),
    ("wine", "красное/белое сухое и полусладкое"): ("red_dry_medium", "wine", G),
    ("wine", "десертное креплёное (Саперави)"): ("port", "fortified", G),
    # Игристые
    ("sparkling", "Prosecco DOC extra dry"): ("sparkling_extra_dry", "sparkling", E),
    ("sparkling", "Prosecco DOC dry"): ("sparkling_dry", "sparkling", E),
    # Вермуты / аперитивы
    ("vermouth", "вермут белый"): ("vermouth_sweet", "fortified", G),
    ("vermouth", "вермут белый сладкий"): ("vermouth_sweet", "fortified", E),
    ("vermouth", "вермут красный сладкий"): ("vermouth_sweet", "fortified", E),
    ("vermouth", "вермут сухой"): ("vermouth_dry", "fortified", E),
    ("vermouth", "биттер-аперитив"): ("bitter_aperitif", "liqueur", E),
    # Коктейли
    ("cocktail", "spritz / low-ABV aperitivo"): ("aperol_spritz", "cocktail", E),
    ("cocktail", "spritz (просекко, бузина, мята)"): ("sparkling_wine_cocktail", "cocktail", G),
    ("cocktail", "sparkling (просекко/персиковое пюре)"): ("sparkling_wine_cocktail", "cocktail", E),
    ("cocktail", "sparkling (просекко/апельсин)"): ("sparkling_wine_cocktail", "cocktail", E),
    ("cocktail", "stirred, bitter (джин/кампари/вермут)"): ("negroni", "cocktail", E),
    ("cocktail", "highball"): ("gin_tonic", "cocktail", E),
    ("cocktail", "highball (ром/мята/лайм/сода)"): ("mojito", "cocktail", E),
    ("cocktail", "mocktail (мята/лайм/спрайт)"): ("mojito", "cocktail", G),
    ("cocktail", "highball (текила/грейпфрут/сода)"): ("sour_highball", "cocktail", E),
    ("cocktail", "collins (джин/лимон/сахар/сода)"): ("sour_highball", "cocktail", E),
    ("cocktail", "highball (водка/имбирное пиво/лайм)"): ("highball_mixed", "cocktail", E),
    ("cocktail", "highball (ром/кола/лайм)"): ("highball_mixed", "cocktail", E),
    ("cocktail", "highball (тёмный ром/имбирное пиво)"): ("highball_mixed", "cocktail", E),
    ("cocktail", "strong sour-highball (5 спиртов/кола)"): ("highball_mixed", "cocktail", G),
    ("cocktail", "sour (текила/трипл сек/лайм)"): ("margarita", "cocktail", E),
    ("cocktail", "sour (виски/лимон/сахар/белок)"): ("sour_classic", "cocktail", E),
    ("cocktail", "sour (ром/лайм/сахар)"): ("sour_classic", "cocktail", E),
    ("cocktail", "sour (кашаса/лайм/сахар)"): ("sour_classic", "cocktail", E),
    ("cocktail", "sour (водка/клюква/лайм/трипл сек)"): ("sour_classic", "cocktail", E),
    ("cocktail", "tiki (ром/оршад/кюрасао/лайм)"): ("sour_classic", "cocktail", G),
    ("cocktail", "signature sour с ликёром на курте"): ("sour_classic", "cocktail", G),
    ("cocktail", "shaken (ваниль/маракуйя + шот просекко)"): ("sour_classic", "cocktail", G),
    ("cocktail", "shaken (водка/личи)"): ("sour_classic", "cocktail", G),
    ("cocktail", "stirred spirit-forward (бурбон/сахар/биттер)"): ("old_fashioned", "cocktail", E),
    ("cocktail", "stirred (виски/красный вермут/биттер)"): ("manhattan", "cocktail", E),
    ("cocktail", "stirred spirit-forward (джин/сухой вермут)"): ("dry_martini", "cocktail", E),
    ("cocktail", "shaken (водка/кофейный ликёр/эспрессо)"): ("espresso_martini", "cocktail", E),
    ("cocktail", "creamy (водка/кофейный ликёр/сливки)"): ("white_russian", "cocktail", E),
    ("cocktail", "layered shot (кофейный ликёр/Baileys/Grand Marnier)"): ("white_russian", "cocktail", G),
    ("cocktail", "blended (ром/кокос/ананас)"): ("pina_colada", "cocktail", E),
    ("cocktail", "mocktail (ананас/кокос/сливки)"): ("pina_colada", "cocktail", G),
    ("cocktail", "savory long (водка/томат/специи)"): ("bloody_mary", "cocktail", E),
    ("cocktail", "long sweet (водка/персик/апельсин/клюква)"): ("long_sweet", "cocktail", E),
    ("cocktail", "long sweet (текила/апельсин/гренадин)"): ("long_sweet", "cocktail", E),
    ("cocktail", "long sweet (водка/блю кюрасао/лимонад)"): ("long_sweet", "cocktail", E),
    ("cocktail", "wine punch"): ("sangria", "cocktail", E),
    # Крепкое и ликёры
    ("spirits", "single malt Scotch"): ("whisky_neat", "spirit", E),
    ("spirits", "single malt Scotch (sherry cask)"): ("whisky_neat", "spirit", E),
    ("spirits", "unpeated single malt"): ("whisky_neat", "spirit", E),
    ("spirits", "blended Scotch"): ("whisky_neat", "spirit", E),
    ("spirits", "blended Irish whiskey"): ("whisky_neat", "spirit", E),
    ("spirits", "Tennessee whiskey"): ("whisky_neat", "spirit", E),
    ("spirits", "single barrel bourbon"): ("whisky_neat", "spirit", E),
    ("spirits", "Japanese blended whisky"): ("whisky_neat", "spirit", E),
    ("spirits", "rye whiskey"): ("whisky_neat", "spirit", E),
    ("spirits", "peated single malt"): ("peated_whisky", "spirit", E),
    ("spirits", "cognac VS"): ("brandy", "spirit", E),
    ("spirits", "brandy (коньяк КЗ)"): ("brandy", "spirit", E),
    ("spirits", "calvados"): ("brandy", "spirit", G),
    ("spirits", "vodka"): ("vodka_neat", "spirit", E),
    ("spirits", "premium vodka"): ("vodka_neat", "spirit", E),
    ("spirits", "grape vodka"): ("vodka_neat", "spirit", E),
    ("spirits", "London dry gin"): ("gin_neat", "spirit", E),
    ("spirits", "gin (огурец/роза)"): ("gin_neat", "spirit", E),
    ("spirits", "gin (citrus)"): ("gin_neat", "spirit", E),
    ("spirits", "gin (47 botanicals)"): ("gin_neat", "spirit", E),
    ("spirits", "white rum"): ("rum_white", "spirit", E),
    ("spirits", "aged rum (solera)"): ("rum_aged", "spirit", E),
    ("spirits", "spiced rum"): ("rum_aged", "spirit", G),
    ("spirits", "tequila blanco 100% agave"): ("tequila_blanco", "spirit", E),
    ("spirits", "tequila mixto"): ("tequila_blanco", "spirit", G),
    ("spirits", "tequila añejo"): ("tequila_aged", "spirit", E),
    ("spirits", "rakı (анисовый виноградный дистиллят)"): ("anise_spirit", "spirit", E),
    ("spirits", "chacha (виноградный самогон)"): ("clear_spirit_aromatic", "spirit", E),
    ("spirits", "grappa"): ("clear_spirit_aromatic", "spirit", E),
    ("spirits", "craft moonshine"): ("clear_spirit_aromatic", "spirit", G),
    ("spirits", "herbal liqueur"): ("liqueur_herbal", "liqueur", E),
    ("spirits", "herbal bitter liqueur"): ("liqueur_herbal", "liqueur", E),
    ("spirits", "whisky-honey liqueur"): ("liqueur_herbal", "liqueur", G),
    ("spirits", "cream liqueur"): ("liqueur_cream", "liqueur", E),
    ("spirits", "lemon liqueur"): ("liqueur_citrus", "liqueur", E),
    ("spirits", "triple sec / orange liqueur"): ("liqueur_citrus", "liqueur", E),
    ("spirits", "cognac-orange liqueur"): ("liqueur_citrus", "liqueur", E),
    ("spirits", "amaro (bitter)"): ("amaro", "liqueur", E),
    ("spirits", "amaro"): ("amaro", "liqueur", E),
    ("spirits", "artichoke amaro"): ("amaro", "liqueur", E),
    # Национальное, безалкогольное, чай, кофе
    ("national", "ферментированное кобылье молоко"): ("kumys", "dairy", E),
    ("national", "ферментированное верблюжье молоко"): ("shubat", "dairy", E),
    ("national", "неферментированное кобылье молоко"): ("saumal", "dairy", E),
    ("national", "кисломолочный солёный напиток"): ("ayran", "dairy", E),
    ("national", "разбавленный катык с солью/травами"): ("ayran", "dairy", E),
    ("national", "газированный кисломолочный напиток"): ("tan", "dairy", E),
    ("national", "сладкий/кислый питьевой кисломолочный"): ("drinking_yogurt", "dairy", E),
    ("national", "слабоферментированный злаковый напиток"): ("boza", "kvass", E),
    ("national", "злаковый/кисломолочный ферментированный напиток"): ("maksym", "kvass", E),
    ("national", "house lemonade"): ("lemonade_sweet", "lemonade", E),
    ("national", "fresh juice 250 мл"): ("juice", "lemonade", E),
    ("national", "packaged juice"): ("juice", "lemonade", E),
    ("national", "cola"): ("cola", "soda", E),
    ("national", "cola / lemon-lime / orange CSD"): ("cola", "soda", G),
    ("national", "flavoured CSD / tonic-mixers"): ("lemonade_sweet", "soda", G),
    ("national", "iced tea (лимон/персик)"): ("iced_tea", "soda", E),
    ("national", "energy drink"): ("energy_drink", "soda", E),
    ("national", "premium tonic water"): ("tonic_water", "soda", E),
    ("national", "still/sparkling water"): ("water_still", "water", G),
    ("national", "premium water"): ("water_still", "water", G),
    ("national", "минеральная вода (сильногазированная, щелочная)"): ("mineral_water_salty", "water", E),
    ("national", "black tea (чайник)"): ("black_tea_strong", "tea", E),
    ("national", "чёрный чай с молоком/сливками"): ("tea_milk", "tea", E),
    ("national", "green tea / oolong"): ("green_tea", "tea", E),
    ("national", "herbal / fruit tea"): ("herbal_tea", "tea", E),
    ("national", "coffee"): ("coffee_black", "coffee", E),
    ("national", "milk coffee"): ("coffee_milk", "coffee", E),
    ("national", "signature Kazakh coffee"): ("coffee_milk", "coffee", G),
    ("national", "hot chocolate"): ("hot_chocolate", "coffee", E),
    ("national", "milkshake"): ("milkshake", "dairy", E),
}
# Точечные исключения, когда стиль строки не отражает продукт (название важнее обобщённого стиля).
ROW_OVERRIDES = {
    "other:spirits#18": (("cask_strength_whisky", "spirit", E),
                         "в названии «Barrel Strength», ABV 55 % → архетип виски бочковой крепости"),
}
# Явные поправки к приору по уточнению в названии стиля (оценка; каждая пишется в vector_notes).
STYLE_MODIFIERS = {
    "Milkshake IPA": [("set", "dairy", 0.15, "milkshake IPA: лактоза → dairy .15 (шкала spec §2.1)"),
                      ("add", "sweet", 0.10, "лактоза → сладость +.10 (spec §2.1 «+ лактоза/фрукты», оценка)")],
    "Oatmeal/Sweet Stout": [("add", "body", 0.05, "овсянка → тело +.05 (оценка)")],
    "Porter (sweet)": [("add", "sweet", 0.10, "портер помечен в отчёте как сладкий → сладость +.10 (оценка)")],
    "Witbier (fruit-flavoured)": [("add", "sweet", 0.10, "витбир с фруктовым ароматизатором → сладость +.10 (оценка)")],
    "Fruit Witbier": [("add", "sweet", 0.10, "фруктовый витбир (сок) → сладость +.10 (оценка)")],
    "Tomato Gose": [("set", "umami", 0.20, "томат в рецептуре → umami .20 (оценка; у Bloody Mary .6)")],
    "Gose (с кумысом)": [("set", "dairy", 0.05, "кумыс в рецептуре → dairy .05 (оценка)")],
    "non-alcoholic pilsner (sugar-free)": [],
}


def map_style(row):
    if row["key"] in ROW_OVERRIDES:
        return ROW_OVERRIDES[row["key"]][0], ROW_OVERRIDES[row["key"]][1]
    if row["report"] == "beer":
        m = BEER_STYLE_MAP.get(row["style_raw"])
    else:
        m = OTHER_STYLE_MAP.get((row["section"], row["style_raw"]))
    return m, None


# ═══════════════════════════════ 4. ДЕДУПЛИКАЦИЯ И БРЕНДЫ v1 ═══════════════════════════════
# Один и тот же продукт в обоих отчётах: основная строка — пивной отчёт (цена/ABV из ритейла),
# из второй берутся экспертные оценки, ссылки и описание вкуса. avail: какую доступность оставить.
DEDUPE = [
    ("beer#65", "other:cider#2", "primary"),     # Somersby Blackberry
    ("beer#66", "other:cider#3", "primary"),     # Somersby Strawberry & Kiwi
    ("beer#67", "other:cider#4", "primary"),     # Somersby Passion Fruit & Orange
    ("beer#68", "other:radler#2", "primary"),    # S&R's Garage Hard Lemon
    ("beer#69", "other:radler#3", "primary"),    # … Hard Black Cherry
    ("beer#70", "other:radler#4", "primary"),    # … Hard Raspberry
    ("beer#71", "other:radler#5", "primary"),    # … Hardcore Pineapple
    ("beer#72", "other:radler#6", "primary"),    # … Hardcore Mango
    ("beer#73", "other:na_beer#5", "primary"),   # Балтика 0
    ("beer#74", "other:na_beer#6", "primary"),   # Балтика 0 Грейпфрут
    ("beer#165", "other:na_beer#11", "primary"),  # Paulaner Hefe-Weissbier 0.0
    ("beer#31", "other:na_beer#4", "primary"),   # Bavaria 0.0 (пивной отчёт нашёл цену alco24, второй — нет)
    ("beer#28", "other:na_beer#15", "secondary"),  # Kozel 0.0: «unknown» → «not_confirmed»
]
# 17 брендов data/brands.json ↔ строка пивного отчёта (тот же продукт).
LEGACY_ROWS = {
    "efes-pilsener": "beer#1", "karagandinskoe": "beer#3", "belyi-medved": "beer#6", "kruzhka-svezhego": "beer#10",
    "zhigulevskoe": "beer#12", "khmelnoy-los": "beer#14", "bremen-von-lustig": "beer#16", "wukong-ju": "beer#17",
    "slavna-praga": "beer#18", "13-region": "beer#21", "legenda-777": "beer#22", "bochkovoe": "beer#23",
    "severnoe-siyanie": "beer#24", "stary-melnik": "beer#25", "kozel": "beer#26", "miller-genuine-draft": "beer#29",
    "bavaria": "beer#30",
}
LEGACY_LICENSE = {"efes-pilsener": "TR", "miller-genuine-draft": "US", "kozel": "CZ", "bavaria": "NL"}
# Разделы ABV_SOURCES.md §4 → id бренда.
ABV_SECTION_IDS = {"1": ["kruzhka-svezhego"], "2": ["belyi-medved"], "3": ["efes-pilsener"],
                   "4": ["miller-genuine-draft"], "5": ["kozel"], "6": ["bremen-von-lustig"], "7": ["bavaria"],
                   "8": ["wukong-ju"], "9": ["karagandinskoe"], "10": ["slavna-praga"], "11": ["zhigulevskoe"],
                   "12": ["khmelnoy-los"], "13–15, 17": ["severnoe-siyanie", "legenda-777", "13-region", "bochkovoe"],
                   "16": ["stary-melnik"]}
# Строки ABV_SOURCES.md, которые описывают ДРУГОЙ продукт или выброс, — не источник для бренда.
ABV_SKIP_PREFIXES = ("Противоречие", "Не путать", "Выбросы", "Наблюдение", "Связка", "Других", "Другие", "Логика",
                     "Уверенность")

# Пирамида v1 → уточнение оси (spec §2.5; синонимы нот v1 перечислены явно).
PYR_BITTER_DOWN = {"mild-bitterness"}
PYR_BITTER_UP = {"hop-bitterness", "resin", "crisp-dynamic-bitterness"}
PYR_SWEET_UP = {"malty", "caramel", "honey", "toffee", "rich-malt", "sweetness", "sweet-finish", "amber-sweetness",
                "worty", "smooth-malt-balance"}
PYR_BODY_UP = {"mouthfeel"}
PYR_CARB_UP = {"effervescence"}
PYR_AROMA_TOP = {"hop-aroma", "floral", "light-hop", "kettle-hop"}
V1_TAG_MAP = {"herbs": "herbal", "pine": "pine_resin", "resin": "pine_resin", "grass": "grass", "floral": "floral",
              "bread": "bread", "grain": "grain", "corn": "grain", "wheat": "wheat", "biscuit": "biscuit",
              "toast": "toast", "caramel": "caramel", "toffee": "caramel", "honey": "honey", "rice": "rice",
              "citrus": "citrus", "lemon": "citrus", "lime": "citrus", "apple": "orchard_fruit", "pear": "orchard_fruit",
              "banana": "banana", "clove": "clove", "coffee": "coffee", "chocolate": "chocolate", "cocoa": "chocolate",
              "smoke": "smoke", "tropical": "tropical_fruit", "mango": "tropical_fruit", "berry": "red_fruit",
              "raisin": "dark_fruit", "vanilla": "oak_vanilla", "nuts": "nutty", "mineral": "brine", "mint": "mint",
              "pepper": "pepper", "spice": "warm_spice", "cream": "dairy_cream", "butter": "dairy_cream"}
# fresh, fizz, warmth, sweet, sour, fruit — это оси, а не мосты (spec §2.5), в теги не переносятся.


# ═══════════════════════════════ 5. ИСТОЧНИКИ, ЦЕНЫ, ДОСТУПНОСТЬ ═══════════════════════════════
URL_RE = re.compile(r"https?://[^\s<>\"'`)\]]+")


def url_key(u):
    u = re.sub(r"^https?://", "", u.strip())
    u = re.sub(r"^www\.", "", u)
    return u.rstrip("/").lower()


def host_of(u):
    return url_key(u).split("/")[0]


def collect_urls(text):
    out = []
    for u in URL_RE.findall(text):
        u = u.rstrip(".,;:»")
        out.append(u)
    return out


class SourceIndex:
    def __init__(self, text):
        self.by_key = OrderedDict()
        self.www = set()
        for u in collect_urls(text):
            k = url_key(u)
            self.by_key.setdefault(k, u)
            if re.match(r"^https?://www\.", u):
                self.www.add(host_of(u))

    def host(self, h):
        return ("www." + h) if h in self.www else h

    def resolve(self, item):
        """Элемент колонки «Источник» пивного отчёта → (url, title, note)."""
        title = item.strip()
        if title.startswith("внутренние материалы"):
            m = re.search(r"([\w.-]+\.md)", title)
            return "internal:" + (m.group(1) if m else "Flavor_Tree_Beer_Data_Draft.md"), title, None
        m = re.match(r"^instagram\s+([A-Za-z0-9_.]+)", title)
        if m:
            return f"https://www.instagram.com/{m.group(1)}/", title, "URL собран из хэндла в отчёте"
        m = re.match(r"^([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(/\S*)?", title, re.I)
        if not m:
            return None, title, None
        host = m.group(1).lower()
        hkey = re.sub(r"^www\.", "", host)
        path = m.group(2) or ""
        token = hkey + path
        if "..." in token or "…" in token:
            prefix, suffix = re.split(r"\.\.\.|…", token, maxsplit=1)
            pk, sk = url_key(prefix), url_key(suffix) if suffix else ""
            cands = [u for k, u in self.by_key.items() if k.startswith(pk) and k.endswith(sk)]
            if len(cands) == 1:
                return cands[0], title, None
            return f"https://{self.host(hkey)}/", title, "ссылка в отчёте сокращена — указан только домен"
        k = url_key(token)
        if k in self.by_key:
            return self.by_key[k], title, None
        if path.strip("/") == "":
            same = [u for kk, u in self.by_key.items() if kk.split("/")[0] == hkey]
            if len(same) == 1:
                return same[0], title, None
            root = [u for kk, u in self.by_key.items() if kk == hkey]
            if root:
                return root[0], title, None
            return f"https://{self.host(hkey)}/", title, None
        pref = [u for kk, u in self.by_key.items() if kk.startswith(k + "/")]
        if len(pref) == 1:
            return pref[0], title, None
        return f"https://{self.host(hkey)}{path}", title, None


def other_source_titles(text):
    out = {}
    for m in re.finditer(r"^\d+\.\s+\[(.+?)\]\((https?://[^)\s]+)\)", text, re.M):
        out[url_key(m.group(2))] = m.group(1)
    return out


DOMAIN_CLASS = {}
for _d in ["carlsbergkazakhstan.kz", "carlsberggroup.com", "sigmabrau.kz", "pivzavod1.kz", "bacchus.kz",
           "turgenwines.com", "arbawine.com", "foodmaster.kz", "pintashymkent.kz"]:
    DOMAIN_CLASS[_d] = "producer"
for _d in ["kaspi.kz", "alco24.kz", "newelitalco.kz", "elitalco.kz", "arbuz.kz", "magnumopt.kz", "newxo.kz",
           "luxalcomarket.kz", "luxalco.kz", "roalco.kz", "champagne.kz", "almawine.kz", "sg-shop.kz", "tsmerkury.kz",
           "shop.chinchin.kz", "almaty.instashop.kz", "produktoff.kz", "propartner.kz", "dastarkhan24.kz", "kbc.kz",
           "galanz.kz"]:
    DOMAIN_CLASS[_d] = "retailer"
for _d in ["beertasting.com", "pintplease.com", "untappd.com", "craftovik.ru", "kazbeer.ru"]:
    DOMAIN_CLASS[_d] = "aggregator"
for _d in ["restolife.kz", "alberto.kz", "sandyqgroup.com", "2gis.kz"]:
    DOMAIN_CLASS[_d] = "bar_menu"


def domain_class(url):
    if url.startswith("internal:"):
        return "internal"
    h = host_of(url)
    return DOMAIN_CLASS.get(h, "article")


CHANNELS = [
    ("kaspi.kz", "kaspi"), ("arbuz.kz", "arbuz"), ("alco24.kz", "alco24"), ("newelitalco.kz", "elitalco"),
    ("elitalco.kz", "elitalco"), ("magnumopt.kz", "magnumopt"), ("newxo.kz", "xo"), ("luxalcomarket.kz", "luxalco"),
    ("luxalco.kz", "luxalco"), ("roalco.kz", "roalco"), ("champagne.kz", "champagne_kz"), ("almawine.kz", "almawine"),
    ("sg-shop.kz", "sg_shop"), ("tsmerkury.kz", "ts_merkury"), ("shop.chinchin.kz", "chinchin"),
    ("almaty.instashop.kz", "instashop"), ("propartner.kz", "propartner"), ("dastarkhan24.kz", "dastarkhan24"),
    ("produktoff.kz", "produktoff"), ("restolife.kz/bar/kultura", "bar_menu:Kultura"),
    ("restolife.kz/upload", "bar_menu:ресторан Алматы (карта restolife.kz)"), ("alberto.kz", "bar_menu:Alberto Bar"),
    ("sandyqgroup.com", "bar_menu:TARY"), ("2gis.kz", "bar_menu:Paulaner Bräuhaus Almaty"),
]


AVAIL_NOTE_RE = re.compile(
    r"подтвержд|наличи|рознице|рознич|каталог|импорт|поступлен|предзаказ|ожидаем|HoReCa|\bбар|taproom|паб|анонс|"
    r"актуальн|продаж|продаёт|дистрибьют|\bсеть|Kaspi|alco24|Elitalco|MagnumOpt|magnumopt|карточк|\bсайт|меню|в карт|"
    r"дефицит|производство|розлив|разливн|\bкег|банка|бутылк|фасовк|\d\.\d+ л|портфел|сезонн|единичн", re.I)
# Явная маркировка в KZ (ключевой вывод №1 отчёта по не-пивным напиткам).
LABELED_AS_RULES = [(re.compile(r"^Somersby\b"), "пивной напиток",
                     "отчёт: «Somersby в Казахстане — это Carlsberg, и он маркируется как «пивной напиток» "
                     "(солодовая основа, 4%)»")]


def channels_for(urls):
    out = []
    for u in urls:
        k = url_key(u)
        for pref, ch in CHANNELS:
            if k.startswith(pref) and ch not in out:
                out.append(ch)
                break
    return out


NUM = r"(?:\d{1,3}(?:[  ]\d{3})+|\d+)"
PRICE_RE = re.compile(rf"({NUM}(?:\s*[–—-]\s*{NUM}|\s*/\s*{NUM})*)\s*₸")
UNIT_RE = re.compile(r"^\s*/\s*(\d+(?:[.,]\d+)?)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(мл|л)?")
HORECA_WORDS = re.compile(r"бар|ресторан|HoReCa|бокал|Альберто|кофейн|чайник", re.I)
RETAIL_WORDS = re.compile(r"розниц|бутылк|alco24|elitalco|Kaspi|магазин|ТС |AlmaWine|Newxo|Champagne|ProPartner|кег|"
                          r"фасовк|шоп-рум", re.I)
ESTIMATE_WORDS = re.compile(r"оценк|аналог|Red Bull|уровн|\bбары\b")
# Источник, названный в самом тексте цены → домен из ссылок строки.
NAMED_PRICE_SOURCES = [(r"alco24", ("alco24.kz",)), (r"[Ee]litalco", ("newelitalco.kz", "elitalco.kz")),
                       (r"ТС Меркурий", ("tsmerkury.kz",)), (r"AlmaWine", ("almawine.kz",)), (r"Newxo", ("newxo.kz",)),
                       (r"Champagne\.kz", ("champagne.kz",)), (r"ProPartner", ("propartner.kz",)),
                       (r"Альберто", ("alberto.kz",)), (r"inform\.kz", ("inform.kz",)),
                       (r"Instashop", ("almaty.instashop.kz",)), (r"Arba", ("arbawine.com",))]
# Kaspi не отдаёт цены (отчёт: «Цены Kaspi.kz не парсятся… по Kaspi подтверждено только наличие и ABV»).
NO_PRICE_HOSTS = {"kaspi.kz"}
# Строки, где ссылка есть, но цена в ней относится к другому продукту или посчитана — цена = оценка.
PRICE_ESTIMATE_ROWS = {
    "other:national#6": "ссылка Instashop в строке ведёт на айран FoodMaster, не на тан",
    "other:na_beer#3": "ссылка MagnumOpt в строке — карточка Efes 0.0 Абрикос-Малина; цена по аналогии",
    "other:cocktail#4": "цена G&T сложена из цен джина и тоника в барной карте",
    "other:cocktail#24": "в карте Альберто — «Sex in sex» (близкий состав), а не классический Sex on the Beach",
}


def parse_price(raw, default_kind, row_hosts, forced_estimate=None):
    """Строка цены отчёта → price_kzt. Цена считается подтверждённой, если её источник есть среди ссылок строки:
    назван в тексте цены, или это ритейлер (для розницы, кроме Kaspi) / барная карта (для HoReCa). Иначе — оценка."""
    if not raw or "₸" not in raw:
        return None
    parts = {}
    for seg in raw.split(";"):
        if "₸" not in seg or re.search(r"\bчек\b", seg):
            continue
        m = PRICE_RE.search(seg)
        if not m:
            continue
        nums = [int(re.sub(r"[  ]", "", x)) for x in re.findall(NUM, m.group(1))]
        if not nums:
            continue
        kind = "horeca" if HORECA_WORDS.search(seg) else "retail" if RETAIL_WORDS.search(seg) else default_kind
        unit = None
        um = UNIT_RE.match(seg[m.end():])
        if um and (um.group(1) or um.group(2)):
            val = float(um.group(1).replace(",", ".")) if um.group(1) else 1.0
            if um.group(2) == "мл":
                unit = int(round(val))
            elif um.group(2) == "л" or val < 10:
                unit = int(round(val * 1000))
            else:
                unit = int(round(val))
        if unit is not None and unit <= 100 and kind == "retail" and not RETAIL_WORDS.search(seg):
            kind = "horeca"   # цена за 50/100 мл — барная порция
        src = None
        if not ESTIMATE_WORDS.search(seg) and not forced_estimate:
            for rx, hosts in NAMED_PRICE_SOURCES:
                if re.search(rx, seg):
                    src = next((h for h in hosts if h in row_hosts), None)
                    break
            else:
                want = "retailer" if kind == "retail" else "bar_menu"
                src = next((h for h in row_hosts if DOMAIN_CLASS.get(h) == want and h not in NO_PRICE_HOSTS), None)
        parts.setdefault(kind, []).append((min(nums), max(nums), unit, src is None, src))
    if not parts:
        return None
    out = OrderedDict()
    srcs = []
    for kind, lst in (("retail", parts.get("retail")), ("horeca", parts.get("horeca"))):
        if not lst:
            continue
        unit = lst[0][2]
        same = [p for p in lst if p[2] == unit]
        lo, hi = min(p[0] for p in same), max(p[1] for p in same)
        est = any(p[3] for p in same)
        for p in same:
            if p[4] and p[4] not in srcs:
                srcs.append(p[4])
        if kind == "retail":
            out["retail_min"], out["retail_max"] = lo, hi
            if unit:
                out["unit_ml"] = unit
            out["retail_is_estimate"] = est
        else:
            out["horeca"] = lo
            if hi != lo:
                out["horeca_max"] = hi
            if unit:
                out["horeca_unit_ml"] = unit
            out["horeca_is_estimate"] = est
    dm = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", raw)
    out["as_of"] = f"{dm.group(3)}-{dm.group(2)}-{dm.group(1)}" if dm else REPORT_DATE
    out["source"] = ", ".join(srcs) if srcs else "не указан: оценка отчёта по уровню цен"
    out["is_estimate"] = bool(out.get("retail_is_estimate") or out.get("horeca_is_estimate"))
    if forced_estimate:
        out["note"] = forced_estimate
    out["raw"] = raw
    return out


# ═══════════════════════════════ 6. АРОМАТ: ключевые слова ═══════════════════════════════
# (регулярное выражение, {тег: вес}); ищется в названии, стиле и нотах строки. Только добавляет теги (max).
KW = [
    (r"яблок|яблоч|\bapple", {"orchard_fruit": .8}), (r"груш|\bpear\b", {"orchard_fruit": .7}),
    (r"\bайв", {"orchard_fruit": .6}), (r"абрикос|персик|\bpeach", {"stone_fruit": .7}),
    (r"\bслив[аы]\b", {"dark_fruit": .6}), (r"чернослив", {"dark_fruit": .8}), (r"изюм", {"dark_fruit": .7}),
    (r"сухофрукт", {"dark_fruit": .7}), (r"херес", {"dark_fruit": .5, "nutty": .4}),
    (r"вишн|\bcherry\b|\bkriek\b", {"cherry": .8}), (r"черешн", {"cherry": .7}),
    (r"малин|\braspberr", {"red_fruit": .7}), (r"клубник|\bstrawberr", {"red_fruit": .7}),
    (r"клюкв|\bcranberr", {"red_fruit": .7}), (r"ежевик|\bblackberr", {"red_fruit": .6}),
    (r"смородин|blackcurrant", {"red_fruit": .6}), (r"гранат|pomegranate", {"red_fruit": .6}),
    (r"брусник|голубик", {"red_fruit": .5}), (r"ягод|berries|mixed fruit", {"red_fruit": .6}),
    (r"гренадин", {"red_fruit": .5}),
    (r"лимон|\blemon\b", {"citrus": .8}), (r"лайм|\blime\b", {"citrus": .8}), (r"апельсин|\borange\b", {"citrus": .7}),
    (r"грейпфрут|grapefruit", {"citrus": .8}), (r"помело", {"citrus": .6}), (r"цитрус", {"citrus": .7}),
    (r"бергамот", {"citrus": .5, "floral": .3}), (r"цедр", {"bitter_orange": .5}),
    (r"кампари", {"bitter_orange": .9}), (r"кюрасао", {"bitter_orange": .5, "citrus": .4}),
    (r"трипл сек|grand marnier", {"citrus": .6, "bitter_orange": .4}),
    (r"маракуй|passion", {"tropical_fruit": .8}), (r"манго|\bmango", {"tropical_fruit": .8}),
    (r"ананас|pineapple", {"tropical_fruit": .8}), (r"тропи", {"tropical_fruit": .7}),
    (r"\bличи\b|lychee", {"tropical_fruit": .6, "floral": .3}), (r"кокос", {"tropical_fruit": .6, "nutty": .3}),
    (r"\bкиви\b", {"tropical_fruit": .5}), (r"\bдын", {"tropical_fruit": .4}),
    (r"банан", {"banana": .8}), (r"гвоздик", {"clove": .7}),
    (r"мёд|\bмед\b|медов|\bhoney", {"honey": .7}), (r"вереск", {"floral": .4, "honey": .3}),
    (r"балкаймак", {"dairy_cream": .6, "honey": .4}),
    (r"карамел|caramel", {"caramel": .7}), (r"ирис|тоффи", {"caramel": .6}), (r"патока", {"caramel": .5}),
    (r"тростник", {"caramel": .3}), (r"\bкол[аы]\b", {"caramel": .4, "warm_spice": .3}),
    (r"ванил", {"oak_vanilla": .6}), (r"\bдуб|\boak\b", {"oak_vanilla": .7}), (r"кедр", {"oak_vanilla": .3}),
    (r"бурбон", {"oak_vanilla": .6, "caramel": .5}), (r"виск[иа]", {"oak_vanilla": .5}),
    (r"шоколад|chocolate|какао", {"chocolate": .7}), (r"кофе|coffee", {"coffee": .8}), (r"эспрессо|espresso", {"coffee": .9}),
    (r"дым|smoke|\brauch", {"smoke": .8}), (r"копч", {"smoke": .7}), (r"торф|\bpeat", {"smoke": .9}),
    (r"уголь", {"char": .5}),
    (r"хлеб|ржан", {"bread": .8}), (r"солод", {"grain": .5}), (r"зерн|ячмен|\bрожь", {"grain": .6}),
    (r"пшениц", {"wheat": .6}), (r"пшено|талкан|толокн", {"grain": .6}), (r"\bрис\b|рисов", {"rice": .8}),
    (r"сусл", {"grain": .5}), (r"кукуруз", {"grain": .5}),
    (r"\bтрав", {"herbal": .6}), (r"полын", {"herbal": .8}), (r"хмел", {"herbal": .4}), (r"вермут", {"herbal": .7}),
    (r"артишок", {"herbal": .6}), (r"ревен", {"herbal": .4}), (r"сельдере", {"herbal": .5}), (r"хинин", {"herbal": .3}),
    (r"цветоч|цветы|цветам", {"floral": .6}), (r"\bроз[аыу]\b", {"floral": .6}), (r"фиалк", {"floral": .5}),
    (r"жасмин", {"floral": .7}), (r"бузин", {"floral": .7}), (r"ромашк", {"floral": .5}), (r"мускат", {"floral": .5}),
    (r"мят", {"mint": .8}), (r"огур", {"cucumber": .8}), (r"можжевел|\bджин", {"juniper": .8}),
    (r"анис", {"anise": .9}), (r"лакриц", {"anise": .6}), (r"агав|текил", {"agave": .8}),
    (r"перец|перч", {"pepper": .6}), (r"паприк", {"pepper": .4}),
    (r"пряност|специ", {"warm_spice": .6}), (r"корица", {"warm_spice": .7}), (r"имбир|ginger", {"warm_spice": .6}),
    (r"кориандр", {"warm_spice": .6}), (r"шафран", {"warm_spice": .5}),
    (r"сливк|сливоч|baileys", {"dairy_cream": .8}), (r"молок|молоч", {"dairy_cream": .7}),
    (r"мороженое", {"dairy_cream": .8}), (r"кисломолоч", {"sour_lactic": .8}), (r"кумыс", {"sour_lactic": .7}),
    (r"\bкурт", {"sour_lactic": .5, "brine": .5}),
    (r"минерал|кремень", {"mineral": .6}), (r"солоноват|солён|солен|морск\w* сол|\bсоль\b", {"brine": .6}),
    (r"морской бриз", {"brine": .5}), (r"олив", {"brine": .4}),
    (r"орех|миндал|оршад", {"nutty": .6}),
    (r"дрожж", {"yeast": .6}), (r"фермент|брожени", {"yeast": .4}),
    (r"\bсено\b", {"grass": .5}), (r"зел[её]н\w* свежест", {"grass": .4}),
    (r"спиртуоз", {"warmth": .6}),
]
KW_RE = [(re.compile(p, re.I), tags) for p, tags in KW]


def keyword_tags(text):
    found = OrderedDict()
    hits = []
    for rx, tags in KW_RE:
        m = rx.search(text)
        if m:
            hits.append((m.group(0).strip(), tags))
            for t, w in tags.items():
                found[t] = max(found.get(t, 0.0), w)
    return found, hits


# ═══════════════════════════════ 7. СТРАНА, ПРОИЗВОДИТЕЛЬ ═══════════════════════════════
COUNTRY_RU = {"Казахстан": "KZ", "Россия": "RU", "Швеция": "SE", "Франция": "FR", "Грузия": "GE", "Италия": "IT",
              "Шотландия": "GB", "Англия": "GB", "Великобритания": "GB", "Ирландия": "IE", "США": "US",
              "Мексика": "MX", "Пуэрто-Рико": "PR", "Гватемала": "GT", "Ямайка": "JM", "Турция": "TR",
              "Германия": "DE", "Чехия": "CZ", "Нидерланды": "NL", "Дания": "DK", "Япония": "JP",
              "Кыргызстан": "KG", "Беларусь": "BY", "Чили": "CL", "Аргентина": "AR", "Молдова": "MD", "Китай": "CN",
              "Бразилия": "BR", "Куба": "CU", "Бермуды": "BM", "Австрия": "AT", "Испания": "ES"}
COUNTRY_AFFINITY = {"KZ": "kazakh", "KG": "central_asian", "UZ": "central_asian", "RU": "russian", "BY": "russian",
                    "GE": "caucasian", "AM": "caucasian", "TR": "turkish", "DE": "german", "AT": "german",
                    "CZ": "czech", "BE": "belgian", "GB": "english", "IE": "irish", "FR": "french", "IT": "italian",
                    "ES": "spanish", "JP": "japanese", "CN": "chinese", "KR": "korean", "MX": "mexican",
                    "US": "american"}
NO_COUNTRY_AFFINITY = {"soda", "water", "coffee", "lemonade"}
PRODUCER_GROUPS = [("Coca-Cola İçecek", "Coca-Cola İçecek (Anadolu Efes)"), ("CCI", "Coca-Cola İçecek (Anadolu Efes)"),
                   ("Efes", "Anadolu Efes"), ("Carlsberg", "Carlsberg Group"), ("AB InBev", "AB InBev"),
                   ("Diageo", "Diageo"), ("Heineken", "Heineken"), ("Pernod Ricard", "Pernod Ricard"),
                   ("Molson Coors", "Molson Coors"), ("Asahi", "Asahi"), ("Campari", "Campari Group"),
                   ("LVMH", "LVMH"), ("Rémy Cointreau", "Rémy Cointreau"), ("Beam Suntory", "Beam Suntory"),
                   ("Brown-Forman", "Brown-Forman"), ("William Grant", "William Grant & Sons"),
                   ("Radeberger", "Radeberger Gruppe"), ("Paulaner Gruppe", "Paulaner Gruppe"),
                   ("Marston's", "Marston's"), ("Edrington", "Edrington"), ("Whyte & Mackay", "Whyte & Mackay"),
                   ("Sazerac", "Sazerac"), ("Lactalis", "Lactalis"), ("PepsiCo", "PepsiCo"), ("Swinkels", "Swinkels")]
LOCAL_PRODUCERS_KZ = ("рестораны Алматы", "рестораны казахской кухни", "рестораны, Альберто Бар")


def parse_country(row):
    raw = row["country_raw"]
    region = None
    lic = None
    if row["report"] == "beer":
        codes = re.findall(r"\b[A-Z]{2}\b", raw)
        codes = ["GB" if c == "UK" else c for c in codes]
        country = codes[0] if codes else "ZZ"
        m = re.search(r"лицензия\s+(?:МПК\s+)?([A-Z]{2})", raw)
        if m:
            lic = m.group(1)
        return country, lic, region
    base = raw.split("(")[0].strip()
    country = None
    for part in re.split(r"/", base):
        part = part.strip().rstrip(".")
        if part in COUNTRY_RU:
            country = COUNTRY_RU[part]
            break
    m = re.search(r"\(([^)]*)\)", raw)
    if m and not re.search(r"лиц|розлив|Kaspi|указано", m.group(1)):
        region = m.group(1)
    if country is None:
        country = "KZ" if row["producer"].startswith(LOCAL_PRODUCERS_KZ) else "ZZ"
    return country, lic, region


def producer_block(row, country, lic, region):
    p = OrderedDict()
    p["name"] = row["producer"]
    for key, grp in PRODUCER_GROUPS:
        if key in row["producer"]:
            p["group"] = grp
            break
    p["country"] = country
    if region:
        p["region"] = region
    if lic:
        p["license_origin"] = lic
    return p


def efes_relation(row):
    if row["report"] == "beer":
        if row["efes_raw"] != "да":
            return "none"
        raw = row["country_raw"]
        codes = re.findall(r"\b[A-Z]{2}\b", raw)
        if "лиценз" in raw or (codes and codes[0] == "KZ"):
            return "own"
        return "distribution"
    if row["efes_raw"] != "да":
        return "none"
    if "CCI" in row["producer"] or "Coca-Cola İçecek" in row["producer"]:
        return "cci"
    if "дистр" in row["producer"]:
        return "distribution"
    return "own"


# ═══════════════════════════════ 8. ID ═══════════════════════════════
TRANSLIT = {"а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
            "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
            "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "",
            "э": "e", "ю": "yu", "я": "ya", "ә": "a", "ғ": "g", "қ": "k", "ң": "n", "ө": "o", "ұ": "u", "ү": "u",
            "һ": "h", "і": "i", "ı": "i", "ß": "ss", "ø": "o", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d"}


def slugify(text):
    s = text.lower().replace("&", " and ").replace("'", "").replace("’", "")
    s = "".join(TRANSLIT.get(ch, ch) for ch in s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def make_id(name, producer, used):
    base = slugify(re.sub(r"\([^)]*\)", " ", name)) or slugify(name)
    for cand in (base, slugify(name), f"{base}-{slugify(producer)}"):
        if cand and cand not in used:
            return cand
    i = 2
    while f"{base}-{i}" in used:
        i += 1
    return f"{base}-{i}"


# ═══════════════════════════════ 9. ВЕКТОР ═══════════════════════════════
def blend_weight(axis, arch, category):
    """Вес экспертной оценки отчёта при смешивании с приором (см. docs/CATALOG_V2.md). 0 — не смешивать."""
    if axis == "body" and category == "water":
        return 0.0    # шкала тела в отчёте не опускается ниже «лёгкое» (.3) — для воды это завышение
    if axis == "sweet" and (arch["category"] in ("wine", "sparkling") or arch["family"] == "VERMOUTH"):
        return 0.25   # сладость уже задана категорией сахара на этикетке
    if category == "spirit" and axis in ("sweet", "bitter"):
        return 0.25   # у крепкого шкала 0–5 отражает дуб/пряность, а не сахар и горечь
    return 0.5


# Строки, где ссылка есть, но ABV по ней не подтверждается (ссылка на другой SKU или позиция не найдена в KZ).
ABV_ESTIMATE_ROWS = {
    "other:wine#29": "ссылка в строке — карточка Casillero Cabernet; ABV Sauvignon Blanc по ней не подтверждается",
    "other:cider#6": "Somersby Pear в KZ-каталогах 2025–26 не найден; ABV — значение бренда без KZ-карточки",
    "other:cider#23": "Strongbow в проверенных KZ-магазинах не найден; ABV — значение бренда без KZ-карточки",
}


# ABV из docs/research/ABV_SOURCES.md для строк, где рыночный отчёт ABV не дал (явный список, сверен вручную).
ABV_EVIDENCE = {
    "other:radler#1": (3.6, "estimate", "ABV_SOURCES.md §4.1 при сверке «Кружки Свежего»: «есть фруктовые Hit 3,6 %» — "
                                        "значение линейки Hit, отдельной карточки Cranberry Hit со ссылкой нет"),
}
# 17 брендов v1: значения, которые ABV_SOURCES.md подтверждает ритейлом, хотя в brands.json стоит abv_estimated.
LEGACY_ABV_EVIDENCE = {
    "stary-melnik": (3.9, "retailer", "фасованное «Старый Мельник из Бочонка Мягкое» 3.9 % — «Семейный» (страница "
                                      "открыта), MagnumOpt и mela.kz (по поисковому индексу), ABV_SOURCES.md §4.16; "
                                      "у кеговой версии ABV может отличаться"),
    "kozel": (4.0, "retailer", "4 % — Elitalco и Alco24 (страницы открыты, ABV_SOURCES.md §4.5) и рыночный отчёт; "
                               "Kaspi с данными этикетки KZ даёт 3.9 % — источники расходятся на 0.1 %, "
                               "оставлено значение v1"),
}
MEASURED_ABV = ("producer_site", "retailer", "label")


def abv_source_for(row, urls):
    """Откуда взят ABV строки (enum контракта) + пояснение."""
    if row["abv"] is None:
        return None, "ABV в отчёте не указан"
    if row["key"] in ABV_ESTIMATE_ROWS:
        return "estimate", ABV_ESTIMATE_ROWS[row["key"]]
    text = " ".join([row.get("note", ""), row.get("descriptors", ""), row.get("sensory_raw", ""), row["name"]])
    if row["report"] == "other":
        if row["section"] == "cocktail":
            return "estimate", "ABV коктейля — оценка отчёта (в бокале, после льда), рецептурный расчёт не приводится"
        if row["section"] == "kvass":
            return "estimate", ("ABV кваса — типичное значение категории (в строке «Квас Очаковский» отчёт прямо "
                                "пишет «не из источника»; бренды кваса в KZ-каталогах не раскрыты)")
        if any(p in row["producer"] for p in ("Bacchus", "Turgen", "Arba")):
            return "estimate", "Bacchus/Turgen/Arba не публикуют ABV — в отчёте типовой для сорта (оценка)"
        if re.search(r"типичн|типов|не из источника|не опубликован|алкогольность ~", text):
            return "estimate", "ABV типичный для категории, не из источника (пометка отчёта)"
    if row["report"] == "beer" and "ABV — данные бренда" in row.get("note", ""):
        if not any(domain_class(u) == "producer" for u in urls):
            return "estimate", "ABV — «данные бренда» по отчёту, ссылки на значение нет"
    classes = [domain_class(u) for u in urls]
    if "producer" in classes:
        return "producer_site", "ABV с сайта производителя"
    if "retailer" in classes:
        return "retailer", "ABV из карточки ритейлера"
    if "aggregator" in classes:
        return "retailer", "ABV по агрегатору (pintplease/beertasting/untappd) — вторичный источник"
    return "estimate", "ABV дан отчётом, источник строки — барная карта или статья, крепость по нему не сверялась"


def sensory_from_prior(arch):
    return OrderedDict((a, float(arch["sensory"][a])) for a in AXES)


def confidence(arch, abv_state, ibu_state, precision, category):
    base = ANCHOR_BASE[arch["anchor_type"]]
    m_abv = {"measured": 1.0, "estimate": 0.8, "unknown": 0.7, "definitional": 1.0}[abv_state]
    m_ibu = 1.0
    if category in ("beer", "na_beer"):
        m_ibu = 1.0 if ibu_state == "measured" else 0.85
    m_style = {E: 1.0, G: 0.85, F: 0.5}[precision]
    val = round(base * m_abv * m_ibu * m_style, 2)
    note = (f"Уверенность {fmt(val)} = база {fmt(base)} (якорь: {ANCHOR_TYPE_RU[arch['anchor_type']]}) × ABV {fmt(m_abv)}"
            f" × IBU {fmt(m_ibu)} × стиль {fmt(m_style)}")
    return val, note


def vector_source_for(category, arch, abv_state, ibu_state):
    if category in ("beer", "na_beer"):
        if abv_state == "measured" and ibu_state == "measured":
            return "label_derived"
        return "bjcp_prior" if arch["anchor_type"] == "bjcp" else "category_prior"
    if category in ("wine", "sparkling") and abv_state == "measured" and arch["anchor_type"] == "regulation":
        return "label_derived"
    return "category_prior"


# ═══════════════════════════════ 10. СБОРКА ЗАПИСЕЙ ═══════════════════════════════
class Builder:
    def __init__(self):
        self.proto = load_prototype()
        self.priors, self.prior_warnings = build_priors(self.proto)
        self.rows = load_rows()
        self.row_by_key = {r["key"]: r for r in self.rows}
        beer_text = REPORT_BEER.read_text(encoding="utf-8")
        other_text = REPORT_OTHER.read_text(encoding="utf-8")
        self.beer_index = SourceIndex(beer_text)
        self.other_titles = other_source_titles(other_text)
        self.brands = json.loads(BRANDS.read_text(encoding="utf-8"))
        self.notes_by_id = {n["id"]: n for n in json.loads(FLAVOR_NOTES.read_text(encoding="utf-8"))}
        self.abv_urls = self.parse_abv_sources()
        self.overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
        self.unmapped = []
        self.log = []
        self.used_ids = set(b["id"] for b in self.brands)

    # ── ABV_SOURCES.md → {brand_id: [(url, title), ...]} ──
    def parse_abv_sources(self):
        text = ABV_SOURCES_MD.read_text(encoding="utf-8")
        # границы раздела «## 4.» — по началу строки: подстрока «## 5.» есть и внутри заголовка «### 5. …»
        text = text[text.index("\n## 4."):text.index("\n## 5.")]
        out = {}
        current = []
        for line in text.splitlines():
            m = re.match(r"^### (.+?)\.\s", line)
            if m:
                current = ABV_SECTION_IDS.get(m.group(1).strip(), [])
                continue
            if not line.startswith("- ") or not current:
                continue
            body = line[2:].strip()
            if body.startswith(ABV_SKIP_PREFIXES) or "выброс" in body:
                continue
            if "[открыта]" not in body and "[открыты]" not in body and "[индекс]" not in body:
                continue
            matches = list(URL_RE.finditer(body))
            prev = 0
            for i, mu in enumerate(matches):
                # у каждой ссылки свой фрагмент строки: текст перед ней и хвост до следующей ссылки (там бывает пометка)
                seg = body[prev:mu.start()]
                after = body[mu.end():matches[i + 1].start() if i + 1 < len(matches) else len(body)]
                prev = mu.end()
                status = ("[по поисковому индексу]" if "[индекс]" in seg + after else
                          "[страница открыта]" if re.search(r"\[открыт[аы]\]", seg + after) else "")
                title = re.sub(r"\*\*\[(открыта|открыты|индекс)\]\*\*", "", seg)
                title = re.sub(r"\(\s*\)", "", title)
                title = re.sub(r"\s+", " ", title).strip(" .;:,")
                title = re.sub(r"\s*\($", "", title)
                if title.count("(") > title.count(")"):
                    title += ")"
                u = mu.group(0).rstrip(".,;:»")
                for bid in current:
                    lst = out.setdefault(bid, [])
                    if all(url_key(u) != url_key(x[0]) for x in lst):
                        lst.append((u, (title[:160] + " " + status).strip()))
        return out

    # ── источники строки ──
    def row_sources(self, row):
        """[(url, title, note)] в порядке отчёта."""
        out = []
        if row["report"] == "beer":
            for item in row["sources_raw"].split(";"):
                if not item.strip():
                    continue
                url, title, note = self.beer_index.resolve(item)
                if url is None:
                    self.log.append(f"{row['ref']}: не разобран источник {item!r}")
                    continue
                out.append((url, title, note))
        else:
            for u in re.findall(r"\]\((https?://[^)\s]+)\)", row["sources_raw"]):
                out.append((u, self.other_titles.get(url_key(u), host_of(u)), None))
        return out

    # ── одна запись из строки (или пары строк-дубликатов) ──
    def record_from_rows(self, primary, secondary=None, avail_rule="primary"):
        rows = [primary] + ([secondary] if secondary else [])
        mapping, override_note = map_style(primary)
        if mapping is None and secondary:
            mapping, override_note = map_style(secondary)
        if mapping is None:
            fb = "pale_lager_intl" if primary["report"] == "beer" else None
            self.unmapped.append((primary["ref"], primary["style_raw"]))
            if fb is None:
                raise SystemExit(f"нет архетипа для {primary['ref']} стиль {primary['style_raw']!r}")
            mapping = (fb, "beer", F)
        aid, category, precision = mapping
        arch = self.priors[aid]
        notes = [f"Строка отчёта: {primary['ref']}" + (f"; дубль: {secondary['ref']}" if secondary else "") + "."]
        style_note = f"Стиль «{primary['style_raw']}» → архетип {aid} ({arch['label_ru']}"
        if arch.get("bjcp_code"):
            style_note += f", BJCP {arch['bjcp_code']}"
        style_note += ")"
        if precision == G:
            style_note += "; стиль указан обобщённо или архетип лишь близок"
        if precision == F:
            style_note = (f"Стиль в отчёте не указан («{primary['style_raw']}») → заглушка {aid} (самый массовый стиль "
                          f"рынка KZ); вектор не описывает конкретный продукт")
        notes.append(style_note + ".")
        if override_note:
            notes.append("Исключение: " + override_note + ".")

        # источники
        src_list = []
        for r in rows:
            src_list.extend(self.row_sources(r))
        urls = [u for u, _, _ in src_list]
        # ABV
        abv = primary["abv"]
        if abv is None and secondary is not None:
            abv = secondary["abv"]
        abv_row = primary if primary["abv"] is not None or secondary is None else secondary
        abv_src, abv_why = abv_source_for(abv_row, [u for u, _, _ in self.row_sources(abv_row)])
        sens = sensory_from_prior(arch)
        abv_unknown = abv is None
        if abv is None:
            ev = next((ABV_EVIDENCE[r["key"]] for r in rows if r["key"] in ABV_EVIDENCE), None)
            if precision == F:
                abv_state = "unknown"
                abv_src = "estimate"
                notes.append(f"ABV в отчёте нет, стиль неизвестен → середины стиля нет, поле abv = null; ось alcohol "
                             f"по ABV заглушки {fmt_abv(arch['abv'])} %: alcohol {fmt(sens['alcohol'])}.")
            elif ev:
                abv, abv_src, why = ev
                abv_state = "estimate"
                sens["alcohol"] = r3(clamp(abv / 40))
                notes.append(f"ABV в отчёте нет → {fmt_abv(abv)} % ({abv_src}: {why}) → alcohol {fmt(sens['alcohol'])}; "
                             f"flags.abv_unknown = true.")
            elif arch.get("abv_range"):
                lo, hi = arch["abv_range"]
                abv = round((lo + hi) / 2, 2)
                abv_src = "bjcp_midpoint"
                abv_state = "unknown"
                sens["alcohol"] = r3(clamp(abv / 40))
                notes.append(f"ABV не опубликован → принята середина стиля {arch['abv_range_source']} "
                             f"({fmt_abv(lo)}–{fmt_abv(hi)} %) = {fmt_abv(abv)} % → alcohol {fmt(sens['alcohol'])}; "
                             f"flags.abv_unknown = true (в интерфейсе: «крепость не опубликована — принята середина "
                             f"стиля»).")
            else:
                abv = arch["abv"]
                abv_src = "estimate"
                abv_state = "unknown"
                notes.append(f"ABV не опубликован, у архетипа {aid} нет диапазона BJCP → принято типичное значение "
                             f"архетипа {fmt_abv(abv)} % (оценка) → alcohol {fmt(sens['alcohol'])}; "
                             f"flags.abv_unknown = true.")
        else:
            nonalc_cat = abv == 0 and (category in ("lemonade", "soda", "water", "tea", "coffee")
                                       or (category == "dairy" and aid not in ("kumys", "shubat")))
            nonalc_name = abv == 0 and category == "na_beer" and re.search(r"\b0[.,]0\b|\b0\b", primary["name"])
            sens["alcohol"] = r3(clamp(abv / 40))
            if nonalc_cat or (nonalc_name and abv_src not in ("producer_site", "retailer", "label")):
                abv_state = "definitional"
                abv_src = "estimate"
                notes.append("ABV 0 % — безалкогольный продукт по определению категории/названию (ссылки на значение "
                             "ABV нет), штраф уверенности за ABV не применяется → alcohol 0.")
            elif abv_src in ("producer_site", "retailer", "label"):
                abv_state = "measured"
                notes.append(f"ABV {fmt_abv(abv)} % ({abv_src}: {abv_why}) → alcohol {fmt(sens['alcohol'])}.")
            else:
                abv_state = "estimate"
                notes.append(f"ABV {fmt_abv(abv)} % ({abv_src}: {abv_why}) → alcohol {fmt(sens['alcohol'])}.")
            if 0.5 < abv <= 1.2 and category == "na_beer":
                notes.append(f"ABV {fmt_abv(abv)} % выше порога 0.5 % → flags.non_alcoholic = false, хотя продукт "
                             f"продаётся как «0.0» (порог настраивается, spec §8.1).")
        # поправки по уточнению стиля
        for kind, axis, val, why in STYLE_MODIFIERS.get(primary["style_raw"], []):
            before = sens[axis]
            sens[axis] = r3(clamp(val if kind == "set" else before + val))
            notes.append(f"{axis}: {fmt(before)} → {fmt(sens[axis])} — {why}.")
        # IBU
        ibu = primary.get("ibu")
        ibu_state = "none"
        ibu_src = "none"
        if category in ("beer", "na_beer"):
            if ibu is not None:
                ibu_state = "measured"
                has_producer = any(domain_class(u) == "producer" for u in urls) or "данные бренда" in primary["note"]
                ibu_src = "producer" if has_producer else "retailer"
                before = sens["bitter"]
                sens["bitter"] = r3(clamp((ibu - 8) / 62))
                notes.append(f"IBU {fmt_abv(ibu)} ({'производитель' if ibu_src == 'producer' else 'агрегатор/ритейл'}) → "
                             f"bitter clamp((IBU−8)/62) = {fmt(sens['bitter'])} (приор стиля {fmt(before)})"
                             + ("; обжарочная горечь в IBU не входит и учтена осью roast." if sens["roast"] >= 0.3
                                else "."))
            else:
                ibu_src = "bjcp_midpoint" if (arch["ibu"] is not None and arch["anchor_type"] == "bjcp") else "none"
                notes.append(f"IBU не опубликован → bitter {fmt(sens['bitter'])} из приора стиля"
                             + (f" (IBU архетипа {fmt_abv(arch['ibu'])})." if arch["ibu"] is not None else "."))
        # экспертная оценка отчёта (строки «не-пивного» отчёта)
        exp_row = primary if primary.get("expert") else (secondary if secondary and secondary.get("expert") else None)
        if exp_row is not None:
            exp = exp_row["expert"]
            notes.append(f"Экспертная оценка отчёта (по стилю, не дегустация): {exp['_raw']}.")
            for axis in ("sweet", "acid", "bitter", "body", "carbonation"):
                if axis not in exp:
                    continue
                if axis == "bitter" and ibu_state == "measured":
                    continue
                w = blend_weight(axis, arch, category)
                if w == 0:
                    notes.append(f"{axis}: оценка отчёта ({fmt(exp[axis])}) не применена — для этой категории шкала "
                                 f"отчёта слишком грубая; оставлен приор {fmt(sens[axis])}.")
                    continue
                before = sens[axis]
                after = r3(clamp((1 - w) * before + w * exp[axis]))
                if abs(after - before) >= 0.005:
                    notes.append(f"{axis}: приор {fmt(before)} → {fmt(after)} (смешано с оценкой {fmt(exp[axis])}, "
                                 f"вес оценки {int(w * 100)} %).")
                sens[axis] = after
        # аромат
        tags = OrderedDict(arch["aroma_tags"])
        text = " ".join(filter(None, [primary["name"], primary["style_raw"], primary.get("descriptors"),
                                      primary["note"] if primary["report"] == "beer" else "",
                                      secondary.get("descriptors") if secondary else ""]))
        kw, hits = keyword_tags(text)
        added = []
        for t, w in kw.items():
            if tags.get(t, 0.0) < w:
                added.append(f"{t} {fmt(w)}")
                tags[t] = w
        if added:
            notes.append("Аромат: к тегам архетипа добавлено по словам строки ("
                         + ", ".join(f"«{h}»" for h, _ in hits) + "): " + ", ".join(added) + ".")
        if re.search(r"томат", text, re.I):
            notes.append("Томат в описании — отдельного аромат-тега в словаре нет, учтено только осью umami.")
        # доступность
        levels = []
        for r in rows:
            lvl = r["avail_raw"] if r["report"] == "beer" else AVAIL_OTHER.get(r["avail_raw"])
            if lvl not in AVAIL_LEVELS:
                raise SystemExit(f"{r['ref']}: неизвестная доступность {r['avail_raw']!r}")
            levels.append(lvl)
        level = levels[0] if avail_rule == "primary" or len(levels) == 1 else levels[1]
        avail = OrderedDict([("level", level)])
        ch = channels_for(urls)
        if ch:
            avail["channels"] = ch
        avail["last_checked"] = REPORT_DATE
        anote = []
        for r in rows:
            if r["note"]:
                notes.append(f"Комментарий отчёта ({'пиво' if r['report'] == 'beer' else 'не-пиво'}): {r['note']}.")
                if AVAIL_NOTE_RE.search(r["note"]):
                    anote.append(r["note"])
        if len(set(levels)) > 1:
            anote.append(f"отчёты расходятся по доступности ({' / '.join(levels)}), оставлено «{level}»")
        if level == "not_confirmed":
            anote.append("позиция не подтверждена в KZ-источниках — гостю не показывать (spec §8.3)")
        if anote:
            avail["note"] = "; ".join(anote)
        # цена
        price = None
        for r in rows:
            first_src = self.row_sources(r)
            default_kind = "horeca" if (r["section"] == "cocktail" or (first_src and domain_class(first_src[0][0]) ==
                                                                        "bar_menu")) else "retail"
            price = parse_price(r["price_raw"], default_kind, [host_of(u) for u, _, _ in first_src],
                                PRICE_ESTIMATE_ROWS.get(r["key"]))
            if price:
                break
        # страна, производитель, Efes
        country, lic, region = parse_country(primary)
        prod_row = primary
        if secondary is not None and "дистр" in secondary["producer"]:
            prod_row = secondary   # второй отчёт точнее: Efes KZ — дистрибьютор, а не производитель
        producer = producer_block(prod_row, country, lic, region)
        rel = efes_relation(primary)
        if secondary is not None and rel != "none":
            rel2 = efes_relation(secondary)
            if "distribution" in (rel, rel2):
                rel = "distribution"
        # записи
        conf, conf_note = confidence(arch, abv_state, ibu_state, precision, category)
        notes.append(conf_note + ".")
        vsrc = vector_source_for(category, arch, abv_state, ibu_state)
        status = "draft" if precision == F else "auto"   # draft = «не знаем, что это за напиток» (нет стиля)
        rec = self.assemble(
            name=primary["name"], category=category, aid=aid, arch=arch, style_raw=primary["style_raw"],
            producer=producer, rel=rel, abv=abv, abv_src=(abv_src or "estimate"), ibu=ibu, ibu_src=ibu_src,
            sens=sens, vsrc=vsrc, conf=conf, notes=notes, tags=tags, avail=avail, price=price,
            src_list=src_list, rows=rows, status=status, country=country, precision=precision,
            abv_row_key=abv_row["key"] if not abv_unknown else None, abv_unknown=abv_unknown,
        )
        return rec

    def assemble(self, *, name, category, aid, arch, style_raw, producer, rel, abv, abv_src, ibu, ibu_src, sens, vsrc,
                 conf, notes, tags, avail, price, src_list, rows, status, country, precision, legacy=None,
                 abv_row_key=None, abv_unknown=False):
        used = self.used_ids
        rid = legacy["id"] if legacy else make_id(name, producer["name"], used)
        used.add(rid)
        rec = OrderedDict()
        rec["id"] = rid
        rec["name"] = name
        if legacy and legacy.get("display_name") and legacy["display_name"] != name:
            rec["display_name"] = legacy["display_name"]
        rec["category"] = category
        style = OrderedDict([("archetype", aid)])
        if arch.get("bjcp_code") and precision != F:
            style["bjcp_code"] = arch["bjcp_code"]
        style["name"] = style_raw
        style["family"] = arch["family"]
        rec["style"] = style
        rec["producer"] = producer
        rec["efes_relation"] = rel
        rec["abv"] = abv
        rec["abv_source"] = abv_src
        rec["ibu"] = ibu
        rec["ibu_source"] = ibu_src
        rec["sensory"] = OrderedDict((a, r3(sens[a]) if a != "serve_temp" else float(sens[a])) for a in AXES)
        rec["vector_source"] = vsrc
        rec["vector_confidence"] = conf
        rec["vector_notes"] = notes
        rec["aroma_tags"] = OrderedDict((t, round(w, 2)) for t, w in tags.items())
        if legacy:
            s = legacy["serving"]
            serving = OrderedDict([("temp_min_c", s["temp_min"]), ("temp_max_c", s["temp_max"])])
            if s.get("glass"):
                serving["glass"] = s["glass"]
            if s.get("seasonality"):
                serving["seasonality"] = s["seasonality"]
        else:
            serving = serving_for(category, arch["family"], sens["serve_temp"])
        rec["serving"] = serving
        occ = [o for o in arch["occasions"] if o != "non_alcoholic"]
        eff_abv = abv if abv is not None else arch["abv"]
        if eff_abv <= 0.5:
            occ.append("non_alcoholic")
        rec["occasions"] = occ
        origin = []
        if category not in NO_COUNTRY_AFFINITY and country in COUNTRY_AFFINITY:
            origin.append(COUNTRY_AFFINITY[country])
        for o in arch["origin_affinity"]:
            if o not in origin:
                origin.append(o)
        rec["origin_affinity"] = origin or ["international"]
        rec["price_kzt"] = price
        rec["availability_kz"] = avail
        flags = OrderedDict()
        flags["non_alcoholic"] = eff_abv <= 0.5
        if sens["dairy"] > 0 or arch["family"] in ("FERMENTED_DAIRY", "DAIRY", "CREAM_LIQUEUR"):
            flags["contains_dairy"] = True
        text_all = " ".join(r.get("sensory_raw", "") + " " + r.get("note", "") + " " + r["style_raw"] for r in rows)
        labeled_beer_drink = bool(re.search(r"пивной напиток|beer-based", text_all, re.I))
        for rx, label, why in LABELED_AS_RULES:
            if rx.search(name) and not labeled_beer_drink:
                labeled_beer_drink = True
                notes.insert(len(notes) - 1, f"Маркировка в KZ «{label}» — {why}.")
        if category in ("beer", "na_beer", "radler", "kvass") or labeled_beer_drink or aid in ("boza", "maksym"):
            flags["contains_gluten"] = True
        if labeled_beer_drink:
            flags["labeled_as"] = "пивной напиток"
        if abv_unknown:
            flags["abv_unknown"] = True
        if avail["level"] == "not_confirmed":
            flags["availability_unconfirmed"] = True
        if any(re.search(r"типов\w* позиция|типичн\w* позиция", r["name"]) for r in rows):
            flags["generic_position"] = True
        if precision == F:
            flags["style_fallback"] = True
        flags["report_refs"] = [r["key"] for r in rows]
        rec["flags"] = flags
        # источники: what — что именно строка отчёта подтверждает этой ссылкой (отчёт не разносит поля по ссылкам,
        # поэтому «abv» ставится всем ссылкам строки-источника ABV, если ABV не оценка; «price» — только домену,
        # из которого взята цена)
        abv_measured = abv_src in ("producer_site", "retailer", "label")
        price_hosts = set(h.strip() for h in (price or {}).get("source", "").split(",")) if price else set()
        sources = []
        seen = set()
        for r in rows:
            for u, title, note in self.row_sources(r):
                k = url_key(u)
                if k in seen:
                    continue
                seen.add(k)
                what = ["availability"]
                if abv_measured and r["key"] == abv_row_key:
                    what.append("abv")
                if r.get("ibu") is not None:
                    what.append("ibu")
                if host_of(u) in price_hosts:
                    what.append("price")
                if r["report"] == "beer":
                    what.append("style")
                if r["key"] in TASTING_NOTE_ROWS:
                    what.append("tasting_notes")
                s = OrderedDict([("url", u), ("title", title + (f" ({note})" if note else ""))])
                s["what"] = what
                s["accessed"] = REPORT_DATE
                sources.append(s)
        if legacy:
            for u, title in self.abv_urls.get(legacy["id"], []):
                k = url_key(u)
                if k in seen:
                    continue
                seen.add(k)
                sources.append(OrderedDict([("url", u), ("title", "ABV_SOURCES.md: " + title), ("what", ["abv"]),
                                            ("accessed", REPORT_DATE)]))
        rec["sources"] = sources
        rec["status"] = status
        if legacy:
            rec["description"] = legacy.get("description", "")
            for k in ("tagline", "image", "accent"):
                if legacy.get(k):
                    rec[k] = legacy[k]
            rec["pyramid"] = legacy.get("pyramid", [])
            rec["legacy_brand_id"] = legacy["id"]
        else:
            rec["description"] = self.describe(rows, arch, producer)
        return rec

    def describe(self, rows, arch, producer):
        desc = f"{arch['label_ru']}. Производитель: {producer['name'].rstrip('.')}."
        notes = [r["descriptors"] for r in rows if r.get("descriptors")]
        if notes:
            tasting = any(r["key"] in TASTING_NOTE_ROWS for r in rows)
            lead = "Ноты по источнику" if tasting else "Ожидаемый профиль (оценка по стилю)"
            desc += f" {lead}: {notes[-1]}."
        return desc

    # ── 17 брендов v1 ──
    def legacy_record(self, brand):
        row = self.row_by_key[LEGACY_ROWS[brand["id"]]]
        mapping, _ = map_style(row)
        aid, category, precision = mapping
        arch = self.priors[aid]
        notes = [f"Бренд v1 data/brands.json «{brand['id']}»; строка отчёта: {row['ref']}.",
                 f"Стиль «{row['style_raw']}» → архетип {aid} ({arch['label_ru']}"
                 + (f", BJCP {arch['bjcp_code']}" if arch.get("bjcp_code") else "") + ")"
                 + ("; стиль указан обобщённо" if precision == G else "") + "."]
        sens = sensory_from_prior(arch)
        # ABV: значения v1 сверены в docs/research/ABV_SOURCES.md
        abv_unknown = False
        ev = LEGACY_ABV_EVIDENCE.get(brand["id"])
        if ev:
            abv, abv_src, why_abv = ev
            abv_state = "measured" if abv_src in MEASURED_ABV else "estimate"
            sens["alcohol"] = r3(clamp(abv / 40))
            notes.append(f"ABV {fmt_abv(abv)} % ({abv_src}: {why_abv}) → alcohol {fmt(sens['alcohol'])}.")
        elif brand.get("abv_estimated") and row["abv"] is None:
            abv = brand["abv"]
            abv_src = "estimate"
            abv_state = "unknown"
            abv_unknown = True
            sens["alcohol"] = r3(clamp(abv / 40))
            notes.append(f"ABV не опубликован (ABV_SOURCES.md: по кеговому сорту данных нет) → принято "
                         f"документированное допущение v1 {fmt_abv(abv)} % (от стиля) → alcohol "
                         f"{fmt(sens['alcohol'])}; flags.abv_unknown = true.")
        else:
            abv = brand["abv"]
            abv_src = "estimate" if brand.get("abv_estimated") else "retailer"
            abv_state = "estimate" if brand.get("abv_estimated") else "measured"
            sens["alcohol"] = r3(clamp(abv / 40))
            line = f"ABV {fmt_abv(abv)} % ({abv_src}; сверка в ABV_SOURCES.md) → alcohol {fmt(sens['alcohol'])}."
            if row["abv"] is not None and abs(row["abv"] - abv) > 0.05:
                line += (f" В рыночном отчёте {fmt_abv(row['abv'])} % — там международное значение/другая фасовка; "
                         f"оставлено значение локального розлива из ABV_SOURCES.md.")
            notes.append(line)
        ibu_src = "bjcp_midpoint" if (arch["ibu"] is not None and arch["anchor_type"] == "bjcp") else "none"
        notes.append(f"IBU не опубликован → bitter {fmt(sens['bitter'])} из приора стиля"
                     + (f" (IBU архетипа {fmt_abv(arch['ibu'])})." if arch["ibu"] is not None else "."))
        # пирамида v1: уточнение не больше ±0.15 на ось (spec §2.5)
        delta = Counter()
        why = {}
        top_int = []
        for p in brand.get("pyramid", []):
            nid, i = p["note_id"], p["intensity"] / 10
            if nid in PYR_BITTER_DOWN:
                d = -0.15 * (1 - i)
                delta["bitter"] += d
                why.setdefault("bitter", []).append(f"{nid} {p['intensity']} → {fmt(d)}")
            if nid in PYR_BITTER_UP:
                d = 0.15 * i
                delta["bitter"] += d
                why.setdefault("bitter", []).append(f"{nid} {p['intensity']} → +{fmt(d)}")
            if nid in PYR_SWEET_UP:
                d = 0.05 * i
                delta["sweet"] += d
                why.setdefault("sweet", []).append(f"{nid} {p['intensity']} → +{fmt(d)}")
            if nid in PYR_BODY_UP:
                delta["body"] += 0.1
                why.setdefault("body", []).append(f"{nid} {p['intensity']} → +.10")
            if nid in PYR_CARB_UP:
                d = 0.1 * i
                delta["carbonation"] += d
                why.setdefault("carbonation", []).append(f"{nid} {p['intensity']} → +{fmt(d)}")
            if p["layer"] == "TOP" and nid in PYR_AROMA_TOP:
                top_int.append((i, nid, p["intensity"]))
        if top_int:
            i, nid, raw = max(top_int)
            target = 0.2 + 0.6 * i
            delta["aroma_intensity"] = target - sens["aroma_intensity"]
            why["aroma_intensity"] = [f"цель 0.2 + 0.6·{fmt(i)} = {fmt(target)} по ноте {nid} {raw}"]
        for axis in ("bitter", "sweet", "body", "carbonation", "aroma_intensity"):
            if axis not in delta:
                continue
            d = max(-0.15, min(0.15, delta[axis]))
            before = sens[axis]
            sens[axis] = r3(clamp(before + d))
            capped = " (ограничено ±.15)" if abs(delta[axis]) > 0.15 + 1e-9 else ""
            if abs(sens[axis] - before) >= 0.005 or capped:
                notes.append(f"Пирамида v1, {axis}: {fmt(before)} → {fmt(sens[axis])}{capped}: " + "; ".join(why[axis]) + ".")
        s = brand["serving"]
        sens["serve_temp"] = (s["temp_min"] + s["temp_max"]) / 2
        notes.append(f"Температура подачи из v1 serving {fmt_abv(s['temp_min'])}–{fmt_abv(s['temp_max'])} °C → "
                     f"{fmt_abv(sens['serve_temp'])} °C (spec §2.5).")
        # теги пирамиды: первый тег ноты — её основная ассоциация (вес intensity/10), остальные — вполовину
        tags = OrderedDict(arch["aroma_tags"])
        pyr = OrderedDict()
        for p in brand.get("pyramid", []):
            note = self.notes_by_id.get(p["note_id"])
            if not note:
                continue
            j = 0
            for t in note.get("tags", []):
                nt = V1_TAG_MAP.get(t)
                if not nt:
                    continue
                w = round(p["intensity"] / 10 * (1.0 if j == 0 else 0.5), 2)
                j += 1
                if w > pyr.get(nt, (0.0, ""))[0]:
                    pyr[nt] = (w, p["note_id"])
        added = []
        for nt, (w, nid) in pyr.items():
            if tags.get(nt, 0.0) < w:
                tags[nt] = w
                added.append(f"{nt} {fmt(w)} ({nid})")
        if added:
            notes.append("Аромат из пирамиды v1 (основной тег ноты — intensity/10, дополнительные — вполовину): "
                         + ", ".join(added) + ".")
        # доступность и цена — из строки рыночного отчёта
        src_list = self.row_sources(row)
        urls = [u for u, _, _ in src_list] + [u for u, _ in self.abv_urls.get(brand["id"], [])]
        avail = OrderedDict([("level", row["avail_raw"])])
        ch = channels_for(urls)
        if ch:
            avail["channels"] = ch
        avail["last_checked"] = REPORT_DATE
        if row["note"]:
            notes.append(f"Комментарий отчёта (пиво): {row['note']}.")
            if AVAIL_NOTE_RE.search(row["note"]):
                avail["note"] = row["note"]
        price = parse_price(row["price_raw"], "retail", [host_of(u) for u, _, _ in src_list])
        producer = OrderedDict([("name", "Efes Kazakhstan"), ("group", "Anadolu Efes"), ("country", "KZ")])
        if brand["id"] in LEGACY_LICENSE:
            producer["license_origin"] = LEGACY_LICENSE[brand["id"]]
        conf, conf_note = confidence(arch, abv_state, "none", precision, category)
        notes.append(conf_note + " (пирамида нот уверенность не повышает — это описание, не измерение).")
        vsrc = "bjcp_prior" if arch["anchor_type"] == "bjcp" else "category_prior"
        status = "auto"   # стиль всех 17 брендов известен; неопубликованный ABV — не повод прятать напиток
        return self.assemble(
            name=brand["name"], category=category, aid=aid, arch=arch, style_raw=row["style_raw"], producer=producer,
            rel="own", abv=abv, abv_src=abv_src, ibu=None, ibu_src=ibu_src, sens=sens, vsrc=vsrc, conf=conf,
            notes=notes, tags=tags, avail=avail, price=price, src_list=src_list, rows=[row], status=status,
            country="KZ", precision=precision, legacy=brand,
            abv_row_key=row["key"] if (abv is not None and row["abv"] is not None and abs(row["abv"] - abv) <= 0.05)
            else None, abv_unknown=abv_unknown,
        )

    def apply_overrides(self, rec):
        ov = self.overrides.get(rec["id"])
        if not ov:
            return
        vo = ov.get("vector_override") or {}
        if vo:
            rec["vector_override"] = OrderedDict((a, vo[a]) for a in AXES if a in vo)
            for a, v in rec["vector_override"].items():
                rec["vector_notes"].append(f"Правка сомелье: {a} {fmt(rec['sensory'][a])} → {fmt(v)}"
                                           + (f" ({ov.get('note')})" if ov.get("note") else "") + ".")
                rec["sensory"][a] = v
            rec["vector_source"] = "sommelier_override"
            if rec["vector_confidence"] < 0.8:
                rec["vector_notes"].append(f"Уверенность {fmt(rec['vector_confidence'])} → .8 после правки сомелье.")
                rec["vector_confidence"] = 0.8
        if ov.get("reviewed_by"):
            rec["reviewed_by"] = ov["reviewed_by"]
            rec["status"] = "reviewed"

    def build(self):
        records = []
        consumed = set()
        for brand in self.brands:
            records.append(self.legacy_record(brand))
            consumed.add(LEGACY_ROWS[brand["id"]])
        dedupe = {}
        for a, b, rule in DEDUPE:
            dedupe[a] = (b, rule)
            consumed.add(b)
        for row in self.rows:
            if row["key"] in consumed:
                continue
            if row["key"] in dedupe:
                b, rule = dedupe[row["key"]]
                records.append(self.record_from_rows(row, self.row_by_key[b], rule))
            else:
                records.append(self.record_from_rows(row))
        for rec in records:
            self.apply_overrides(rec)
        records.sort(key=lambda r: (CATEGORIES.index(r["category"]), r["name"].casefold(), r["id"]))
        return records


# Строки, для которых отчёт указывает источник дегустационных нот (раздел «Что НЕ удалось подтвердить»).
TASTING_NOTE_ROWS = {"other:cider#13", "other:wine#1", "other:sparkling#1", "other:spirits#24", "other:na_beer#8",
                     "other:na_beer#9"}


# ═══════════════════════════════ 11. САМОПРОВЕРКА ═══════════════════════════════
REQUIRED = ["id", "name", "category", "style", "producer", "efes_relation", "abv", "abv_source", "ibu", "ibu_source",
            "sensory", "vector_source", "vector_confidence", "vector_notes", "aroma_tags", "serving", "occasions",
            "origin_affinity", "price_kzt", "availability_kz", "flags", "sources", "status", "description"]
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def in_unit(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and 0.0 <= x <= 1.0


def validate(priors, records, proto, brands):
    errs = []
    # приоры
    proto_ids = [k["id"] for k in proto.DRINKS]
    if len(proto_ids) != 57:
        errs.append(f"в прототипе {len(proto_ids)} архетипов, ожидалось 57")
    for k in proto.DRINKS:
        p = priors.get(k["id"])
        if p is None:
            errs.append(f"style_priors_v2: нет архетипа прототипа {k['id']}")
            continue
        s = p["sensory"]
        pairs = [("sweet", "sweet"), ("acid", "acid"), ("bitter", "bitter"), ("tannin", "tannin"),
                 ("carbonation", "carb"), ("body", "body"), ("dairy", "dairy"), ("salt", "salt"), ("umami", "umami"),
                 ("aroma_intensity", "aroma"), ("roast", "roast"), ("smoke", "smoke"), ("serve_temp", "temp")]
        for ax, kk in pairs:
            if abs(float(s[ax]) - float(k[kk])) > 1e-9:
                errs.append(f"style_priors_v2.{k['id']}.{ax} = {s[ax]} ≠ прототип {k[kk]}")
        if abs(s["alcohol"] - round(clamp(k["abv"] / 40), 3)) > 1e-9:
            errs.append(f"style_priors_v2.{k['id']}.alcohol ≠ clamp(abv/40)")
        if p["abv"] != k["abv"] or p["ibu"] != k["ibu"] or p["category"] != k["cat"]:
            errs.append(f"style_priors_v2.{k['id']}: abv/ibu/category отличаются от прототипа")
    for aid, p in priors.items():
        for key in ("category", "family", "abv", "ibu", "sensory", "aroma_tags", "origin_affinity", "anchor",
                    "label_ru", "anchor_type", "occasions", "serving"):
            if key not in p:
                errs.append(f"style_priors_v2.{aid}: нет ключа {key}")
        if p.get("category") not in CATEGORIES:
            errs.append(f"style_priors_v2.{aid}: категория {p.get('category')}")
        if not p.get("anchor"):
            errs.append(f"style_priors_v2.{aid}: пустой anchor")
        if set(p["sensory"]) != set(AXES):
            errs.append(f"style_priors_v2.{aid}: оси {sorted(set(p['sensory']) ^ set(AXES))}")
        for a in UNIT_AXES:
            if not in_unit(p["sensory"].get(a)):
                errs.append(f"style_priors_v2.{aid}.{a} вне [0,1]: {p['sensory'].get(a)}")
        if not -5 <= p["sensory"]["serve_temp"] <= 95:
            errs.append(f"style_priors_v2.{aid}.serve_temp вне диапазона")
        for t, w in p["aroma_tags"].items():
            if t not in TAG_VOCAB or not in_unit(w):
                errs.append(f"style_priors_v2.{aid}: тег {t}={w}")
        for o in p["origin_affinity"]:
            if o not in ORIGINS:
                errs.append(f"style_priors_v2.{aid}: origin {o}")
        for o in p["occasions"]:
            if o not in OCCASIONS:
                errs.append(f"style_priors_v2.{aid}: occasion {o}")
        if p["anchor_type"] not in ANCHOR_BASE:
            errs.append(f"style_priors_v2.{aid}: anchor_type {p['anchor_type']}")
    # напитки
    ids = Counter(r["id"] for r in records)
    for i, n in ids.items():
        if n > 1:
            errs.append(f"drinks: id {i} повторяется {n} раз")
        if not ID_RE.match(i):
            errs.append(f"drinks: id {i!r} не kebab-case ASCII")
    for r in records:
        rid = r.get("id")
        for k in REQUIRED:
            if k not in r:
                errs.append(f"drinks.{rid}: нет ключа {k}")
        if r.get("category") not in CATEGORIES:
            errs.append(f"drinks.{rid}: категория {r.get('category')}")
        st = r.get("style") or {}
        for k in ("archetype", "name", "family"):
            if not st.get(k):
                errs.append(f"drinks.{rid}: style.{k} пусто")
        if st.get("archetype") not in priors:
            errs.append(f"drinks.{rid}: архетип {st.get('archetype')} отсутствует в style_priors_v2")
        elif st.get("family") != priors[st["archetype"]]["family"]:
            errs.append(f"drinks.{rid}: family не совпадает с архетипом")
        pr = r.get("producer") or {}
        if not pr.get("name") or not re.fullmatch(r"[A-Z]{2}", pr.get("country", "")):
            errs.append(f"drinks.{rid}: producer.name/country")
        if r.get("efes_relation") not in EFES_REL:
            errs.append(f"drinks.{rid}: efes_relation {r.get('efes_relation')}")
        abv = r.get("abv")
        if abv is not None and not (isinstance(abv, (int, float)) and 0 <= abv <= 75):
            errs.append(f"drinks.{rid}: abv {abv}")
        if r.get("abv_source") not in ABV_SOURCE_ENUM:
            errs.append(f"drinks.{rid}: abv_source {r.get('abv_source')}")
        if r.get("ibu_source") not in IBU_SOURCE_ENUM:
            errs.append(f"drinks.{rid}: ibu_source {r.get('ibu_source')}")
        s = r.get("sensory") or {}
        if set(s) != set(AXES):
            errs.append(f"drinks.{rid}: оси sensory {sorted(set(s) ^ set(AXES))}")
        for a in UNIT_AXES:
            if not in_unit(s.get(a)):
                errs.append(f"drinks.{rid}.sensory.{a} вне [0,1]: {s.get(a)}")
        if not isinstance(s.get("serve_temp"), (int, float)) or not -5 <= s["serve_temp"] <= 95:
            errs.append(f"drinks.{rid}.serve_temp")
        if r.get("vector_source") not in VECTOR_SOURCES:
            errs.append(f"drinks.{rid}: vector_source {r.get('vector_source')}")
        if not in_unit(r.get("vector_confidence")):
            errs.append(f"drinks.{rid}: vector_confidence {r.get('vector_confidence')}")
        if not r.get("vector_notes"):
            errs.append(f"drinks.{rid}: пустые vector_notes")
        for t, w in (r.get("aroma_tags") or {}).items():
            if t not in TAG_VOCAB or not in_unit(w):
                errs.append(f"drinks.{rid}: тег {t}={w}")
        sv = r.get("serving") or {}
        if "temp_min_c" not in sv or "temp_max_c" not in sv or sv["temp_min_c"] > sv["temp_max_c"]:
            errs.append(f"drinks.{rid}: serving")
        for o in r.get("occasions") or []:
            if o not in OCCASIONS:
                errs.append(f"drinks.{rid}: occasion {o}")
        for o in r.get("origin_affinity") or []:
            if o not in ORIGINS:
                errs.append(f"drinks.{rid}: origin {o}")
        av = r.get("availability_kz") or {}
        if av.get("level") not in AVAIL_LEVELS or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", av.get("last_checked", "")):
            errs.append(f"drinks.{rid}: availability_kz")
        if r.get("price_kzt") is not None and not isinstance(r["price_kzt"], dict):
            errs.append(f"drinks.{rid}: price_kzt")
        srcs = r.get("sources") or []
        if not srcs:
            errs.append(f"drinks.{rid}: нет sources")
        for sobj in srcs:
            if not sobj.get("url") or not re.match(r"^(https?://|internal:)", sobj["url"]):
                errs.append(f"drinks.{rid}: source url {sobj.get('url')}")
            if not sobj.get("what") or any(w not in SOURCE_WHAT for w in sobj["what"]):
                errs.append(f"drinks.{rid}: source what {sobj.get('what')}")
        if r.get("status") not in STATUSES:
            errs.append(f"drinks.{rid}: status {r.get('status')}")
        fl = r.get("flags") or {}
        if abv is None and not fl.get("style_fallback"):
            errs.append(f"drinks.{rid}: abv = null при известном стиле (политика: середина стиля / допущение v1)")
        if (r.get("status") == "draft") != bool(fl.get("style_fallback")) and r.get("status") != "reviewed":
            errs.append(f"drinks.{rid}: draft должен означать «стиль неизвестен» (status={r.get('status')})")
        if fl.get("abv_unknown") and r.get("abv_source") not in ("estimate", "bjcp_midpoint"):
            errs.append(f"drinks.{rid}: abv_unknown, но abv_source={r.get('abv_source')}")
        vo = r.get("vector_override")
        if vo is not None:
            for a, v in vo.items():
                if a not in AXES or (a != "serve_temp" and not in_unit(v)):
                    errs.append(f"drinks.{rid}: vector_override.{a}={v}")
    legacy = [r["legacy_brand_id"] for r in records if "legacy_brand_id" in r]
    brand_ids = [b["id"] for b in brands]
    if sorted(legacy) != sorted(brand_ids):
        errs.append(f"drinks: legacy_brand_id {sorted(set(brand_ids) ^ set(legacy))}")
    non_efes = sum(1 for r in records if r.get("efes_relation") == "none")
    if non_efes < 290:
        errs.append(f"drinks: efes_relation == none — {non_efes} < 290")
    if len(records) < 400:
        errs.append(f"drinks: всего {len(records)} < 400")
    return errs


# ═══════════════════════════════ 12. ИТОГИ И ЗАПИСЬ ═══════════════════════════════
def summary(records, builder):
    print(f"Всего записей: {len(records)}")
    rel = Counter(r["efes_relation"] for r in records)
    print(f"Не-Efes (efes_relation=none): {rel['none']}; Efes: own {rel['own']}, distribution {rel['distribution']}, "
          f"cci {rel['cci']}; из них брендов v1 (legacy_brand_id): "
          f"{sum(1 for r in records if 'legacy_brand_id' in r)}")
    print("По категориям: " + ", ".join(f"{c} {n}" for c, n in sorted(Counter(r['category'] for r in records).items(),
                                                                      key=lambda x: CATEGORIES.index(x[0]))))
    print("vector_source: " + ", ".join(f"{k} {v}" for k, v in Counter(r['vector_source'] for r in records).most_common()))
    print("status: " + ", ".join(f"{k} {v}" for k, v in Counter(r['status'] for r in records).most_common()))
    print("availability: " + ", ".join(f"{k} {v}" for k, v in
                                       Counter(r['availability_kz']['level'] for r in records).most_common()))
    bins = [(0, .2), (.2, .4), (.4, .5), (.5, .6), (.6, .7), (.7, 1.01)]
    print("vector_confidence: " + ", ".join(
        f"[{lo:.1f}–{min(hi, 1):.1f}{')' if hi < 1 else ']'} {sum(1 for r in records if lo <= r['vector_confidence'] < hi)}"
        for lo, hi in bins))
    print("abv_source: " + ", ".join(f"{k} {v}" for k, v in Counter(r["abv_source"] for r in records).most_common()))
    print(f"ABV не опубликован (flags.abv_unknown): {sum(1 for r in records if r['flags'].get('abv_unknown'))}; "
          f"abv = null (нет стиля): {sum(1 for r in records if r['abv'] is None)}; "
          f"IBU измерен: {sum(1 for r in records if r['ibu'] is not None)}; "
          f"цена есть: {sum(1 for r in records if r['price_kzt'])}")
    arch_used = Counter(r["style"]["archetype"] for r in records)
    print(f"Архетипов в style_priors_v2: {len(builder.priors)} (прототип 57 + новых {len(EXTRA_ARCHETYPES)}); "
          f"используется в каталоге: {len(arch_used)}")
    fallback = [r["id"] for r in records if r["flags"].get("style_fallback")]
    print(f"Строки без стиля (заглушка, draft): {len(fallback)} {fallback}")
    drafts = [(r["id"], "стиль неизвестен" if r["flags"].get("style_fallback") else "?") for r in records
              if r["status"] == "draft"]
    print(f"draft: {len(drafts)} {drafts}")
    print(f"Несопоставленные стили: {len(builder.unmapped)}" + ("" if not builder.unmapped else " " + str(builder.unmapped)))
    merged = [r["id"] for r in records if len(r["flags"]["report_refs"]) > 1]
    print(f"Дубли между отчётами объединены: {len(merged)}; строки отчётов, слитые с брендами v1: {len(LEGACY_ROWS)}")
    rows_total = len(builder.rows)
    print(f"Строк в отчётах: {rows_total} → записей из отчётов {len(records)} "
          f"(= {rows_total} − {len(merged)} дублей − {len(LEGACY_ROWS)} строк брендов v1 + {len(LEGACY_ROWS)} брендов v1)")
    for w in builder.prior_warnings + builder.log:
        print("  ! " + w)


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1) + "\n"


def main(argv):
    dry = "--dry-run" in argv
    b = Builder()
    records = b.build()
    summary(records, b)
    errs = validate(b.priors, records, b.proto, b.brands)
    if errs:
        print(f"\nСАМОПРОВЕРКА: {len(errs)} нарушений")
        for e in errs[:200]:
            print("  ✗ " + e)
        return 1
    print("\nСамопроверка: OK (ключи контракта, оси в [0,1], архетипы существуют, id уникальны и kebab-case, "
          "57 архетипов прототипа совпадают числами, ≥290 не-Efes, ≥400 всего)")
    if not dry:
        OUT_PRIORS.write_text(dump(b.priors), encoding="utf-8")
        OUT_DRINKS.write_text(dump(records), encoding="utf-8")
        print(f"Записано: {OUT_PRIORS.relative_to(ROOT)}, {OUT_DRINKS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
