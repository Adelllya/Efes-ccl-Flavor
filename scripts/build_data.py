#!/usr/bin/env python3
"""
build_data.py — собирает канонические JSON-данные Flavor Tree в папку data/.

Источники:
  • backend/api/fixtures/brands_seed.csv       — 17 сортов
  • backend/api/fixtures/dishes_50.csv          — 50 блюд
  • backend/api/fixtures/food_pairings.csv      — 51 кураторская пара
  • справочники ниже в этом файле               — ноты → сенсорные оси, стили → приоры,
                                                  пирамиды сортов, векторы блюд, теги, синонимы

Запуск:  python3 scripts/build_data.py
Результат: data/flavor_notes.json, data/brands.json, data/dishes.json,
           data/pairings_curated.json, data/style_priors.json
Картинки бутылок конвертируются в WebP → frontend/public/img/beers/<slug>.webp
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "backend" / "api" / "fixtures"
MEDIA = ROOT / "backend" / "media" / "brands"
OUT = ROOT / "data"
IMG_OUT = ROOT / "frontend" / "public" / "img" / "beers"

# ─────────────────────────────────────────────────────────────────────────────
# 1. СЕНСОРНЫЕ ОСИ
# ─────────────────────────────────────────────────────────────────────────────
BEER_AXES = ["bitter", "body", "malt_sweet", "carbonation", "hop_aroma",
             "roast", "alcohol", "caramel", "fruit", "clean"]
DISH_AXES = ["salt", "sweet", "sour", "bitter", "umami", "heat", "fat",
             "weight", "smoke", "maillard", "fresh", "cream", "spice"]

# ─────────────────────────────────────────────────────────────────────────────
# 2. ВКУСОВЫЕ НОТЫ (65 — полное колесо вкусов + off-flavours) — с привязкой к осям и «мостовым» тегам
# ─────────────────────────────────────────────────────────────────────────────
NOTES = [
    # ── TOP (0–3 сек) ──
    dict(name="Свежесть", technical_term="Freshness / Crisp", category="TOP", icon="🌿",
         description="Яркое ощущение свежести, чистоты и прохлады при первом глотке",
         axes={"carbonation": .7, "clean": .5}, tags=["fresh"]),
    dict(name="Хмелевой аромат", technical_term="Hop Aroma", category="TOP", icon="🍃",
         description="Свежий аромат благородного хмеля (травянистый, смолистый)",
         axes={"hop_aroma": .9}, tags=["herbs", "pine", "grass"]),
    dict(name="Цветочные ноты", technical_term="Floral / Linalool", category="TOP", icon="🌸",
         description="Тонкие оттенки луговых цветов, жасмина, цитрусового цвета",
         axes={"hop_aroma": .6, "fruit": .2}, tags=["floral", "herbs"]),
    dict(name="Лёгкий хмель", technical_term="Light Hop", category="TOP", icon="🌱",
         description="Деликатный, ненавязчивый хмелевой оттенок",
         axes={"hop_aroma": .4}, tags=["herbs"]),
    dict(name="Искрящаяся карбонация", technical_term="Effervescence / Carbonation", category="TOP", icon="✨",
         description="Искрящиеся покалывающие пузырьки газа, освежающие рецепторы",
         axes={"carbonation": .95}, tags=["fizz", "fresh"]),
    dict(name="Спиртовая теплота", technical_term="Alcoholic / Warming", category="TOP", icon="🔥",
         description="Согревающее ощущение этанола, характерное для крепких сортов",
         axes={"alcohol": .8, "body": .2}, tags=["warmth"]),
    dict(name="Котловой хмель", technical_term="Kettle Hop", category="TOP", icon="🫖",
         description="Глубокий хмелевой аромат многоэтапного охмеления в сусловарочном котле",
         axes={"hop_aroma": .7, "bitter": .3}, tags=["herbs", "pine"]),
    dict(name="Цитрусовый аромат", technical_term="Citrus / Myrcene", category="TOP", icon="🍋",
         description="Яркие ноты цедры лимона, грейпфрута или апельсина",
         axes={"hop_aroma": .7, "fruit": .5}, tags=["citrus", "lime", "lemon"]),
    dict(name="Фруктовые эфиры", technical_term="Fruity Esters", category="TOP", icon="🍎",
         description="Фруктовые оттенки зеленого яблока, груши или банана",
         axes={"fruit": .9}, tags=["apple", "pear", "banana", "fruit"]),
    # ── HEART (3–15 сек) ──
    dict(name="Солод", technical_term="Malty", category="HEART", icon="🌾",
         description="Сладковато-зерновой, хлебный фундамент пива из ячменного солода",
         axes={"malt_sweet": .6, "body": .4}, tags=["bread", "grain"]),
    dict(name="Солодовая плотность", technical_term="Rich Malt", category="HEART", icon="🍞",
         description="Глубокое, округлое солодовое тело напитка",
         axes={"body": .8, "malt_sweet": .5}, tags=["bread", "grain"]),
    dict(name="Зерновые ноты", technical_term="Grainy / Cereal", category="HEART", icon="🥣",
         description="Оттенки свежего зерна, солодовой муки, ячменных хлопьев",
         axes={"malt_sweet": .3, "clean": .3, "body": .3}, tags=["grain", "bread", "corn"]),
    dict(name="Карамель", technical_term="Caramel / Maltol", category="HEART", icon="🍯",
         description="Сладкие ноты жженого сахара, тоффи и карамельного солода",
         axes={"caramel": .9, "malt_sweet": .6}, tags=["caramel", "toffee", "honey"]),
    dict(name="Рисовые ноты", technical_term="Rice / Dry Cereal", category="HEART", icon="🍚",
         description="Легкий сухой рисовый профиль, придающий воздушность и нейтральную чистоту",
         axes={"clean": .8}, tags=["rice"]),
    dict(name="Сладость", technical_term="Sweetness", category="HEART", icon="🍬",
         description="Мягкая натуральная сладость несброженных сахаров",
         axes={"malt_sweet": .8}, tags=["honey", "sweet"]),
    dict(name="Сусло (Worty)", technical_term="Worty", category="HEART", icon="🌾",
         description="Свежий аромат варочного цеха и теплого пивного сусла",
         axes={"malt_sweet": .6, "body": .3}, tags=["grain", "bread", "honey"]),
    dict(name="Мягкий баланс солода", technical_term="Smooth Malt Balance", category="HEART", icon="🥖",
         description="Идеально сбалансированное, бархатистое солодовое сердце",
         axes={"malt_sweet": .5, "body": .5, "clean": .3}, tags=["bread"]),
    dict(name="Обжаренный солод", technical_term="Roasty / 2-Acetylpyridine", category="HEART", icon="☕",
         description="Кофейно-шоколадный характер темного прожаренного солода",
         axes={"roast": .9, "body": .3}, tags=["coffee", "toast", "roast"]),
    dict(name="Шоколад", technical_term="Chocolate / Pyrazines", category="HEART", icon="🍫",
         description="Ноты горького темного какао и шоколада",
         axes={"roast": .7, "caramel": .3}, tags=["chocolate", "cocoa"]),
    # ── BASE (15+ сек) ──
    dict(name="Хмелевая горчинка", technical_term="Hop Bitterness / Iso-alpha", category="BASE", icon="⚡",
         description="Благородная освежающая горечь изо-альфа-кислот хмеля",
         axes={"bitter": .9}, tags=["herbs"]),
    dict(name="Освежающий финиш", technical_term="Refreshing Finish", category="BASE", icon="❄️",
         description="Быстрое, сухое и чистое завершение глотка, зовущее к следующему",
         axes={"carbonation": .6, "clean": .6}, tags=["fresh"]),
    dict(name="Умеренная горечь", technical_term="Mild Bitterness", category="BASE", icon="🌿",
         description="Мягкая, сглаженная горчинка без резкости",
         axes={"bitter": .5}, tags=[]),
    dict(name="Чистый финиш", technical_term="Clean Finish", category="BASE", icon="🫧",
         description="Кристально чистое послевкусие без посторонних привкусов",
         axes={"clean": .8, "carbonation": .3}, tags=["fresh"]),
    dict(name="Сбалансированный финиш", technical_term="Balanced Finish", category="BASE", icon="⚖️",
         description="Гармоничный баланс между мягким солодом и тонким хмелем",
         axes={"clean": .4, "malt_sweet": .3, "bitter": .3}, tags=[]),
    dict(name="Хмелевое послевкусие", technical_term="Hoppy Aftertaste", category="BASE", icon="🍃",
         description="Долгое приятное травянисто-хмелевое эхо",
         axes={"bitter": .6, "hop_aroma": .5}, tags=["herbs", "grass"]),
    dict(name="Динамичная горечь", technical_term="Crisp Dynamic Bitterness", category="BASE", icon="🎯",
         description="Яркая, бодрящая горчинка с быстрым развитием",
         axes={"bitter": .8, "carbonation": .3}, tags=[]),
    dict(name="Тонкая сладость финиша", technical_term="Sweet Finish", category="BASE", icon="🍯",
         description="Едва уловимая карамельно-солодовая сладость в финале",
         axes={"malt_sweet": .5, "caramel": .3}, tags=["honey", "caramel"]),
    dict(name="Классическая горечь", technical_term="Classic Bitterness", category="BASE", icon="🍺",
         description="Традиционная лагерная горчинка, выверенная годами",
         axes={"bitter": .7}, tags=[]),
    dict(name="Тело и плотность (Body)", technical_term="Mouthfeel / Body", category="BASE", icon="🧱",
         description="Ощущение весомости, плотности и густоты напитка во рту",
         axes={"body": .9}, tags=[]),
    dict(name="Янтарная сладость", technical_term="Amber Sweetness", category="BASE", icon="🍂",
         description="Мягкое послевкусие венского и янтарного солода",
         axes={"caramel": .7, "malt_sweet": .5}, tags=["caramel", "toffee", "bread"]),
    dict(name="Мягкий финиш", technical_term="Smooth Finish", category="BASE", icon="🕊️",
         description="Округлый, бархатистый и шелковистый сход вкуса",
         axes={"clean": .5, "body": .3}, tags=[]),
    # ── Расширенное колесо вкусов (Meilgaard / ASBC) — дополнительные дескрипторы и off-flavours ──
    # TOP
    dict(name="Банан", technical_term="Banana / Isoamyl acetate", category="TOP", icon="🍌",
         description="Эфирный аромат спелого банана — дрожжевой характер пшеничных и тёплых брожений",
         axes={"fruit": .8}, tags=["banana", "fruit"]),
    dict(name="Тропические фрукты", technical_term="Tropical Fruit", category="TOP", icon="🥭",
         description="Манго, маракуйя, ананас — современные ароматные сорта хмеля",
         axes={"hop_aroma": .5, "fruit": .7}, tags=["mango", "tropical", "citrus"]),
    dict(name="Ягоды", technical_term="Berry", category="TOP", icon="🫐",
         description="Тёмные и красные ягоды: смородина, ежевика, вишня",
         axes={"fruit": .7}, tags=["berry", "fruit"]),
    dict(name="Сосна и смола", technical_term="Pine / Resin", category="TOP", icon="🌲",
         description="Хвойная смолистость американского хмеля",
         axes={"hop_aroma": .8, "bitter": .2}, tags=["pine", "resin", "herbs"]),
    dict(name="Травянистость", technical_term="Grassy", category="TOP", icon="🍀",
         description="Свежескошенная трава, зелёные стебли — сырой хмель",
         axes={"hop_aroma": .6, "clean": .2}, tags=["grass", "herbs"]),
    dict(name="Пряный хмель", technical_term="Spicy Hop / Saaz", category="TOP", icon="🫚",
         description="Перечно-пряные оттенки благородных чешских и немецких сортов хмеля",
         axes={"hop_aroma": .6}, tags=["pepper", "spice", "herbs"]),
    dict(name="Мёд", technical_term="Honey", category="TOP", icon="🐝",
         description="Цветочный мёд, нектар — светлый солод и мягкие эфиры",
         axes={"malt_sweet": .5, "fruit": .2}, tags=["honey", "sweet", "floral"]),
    dict(name="Гвоздика", technical_term="Clove / Phenolic", category="TOP", icon="🪵",
         description="Гвоздика и лёгкая аптечность — фенолы дрожжей пшеничных стилей",
         axes={"fruit": .2, "alcohol": .1}, tags=["clove", "spice"]),
    dict(name="Мята", technical_term="Minty", category="TOP", icon="🌿",
         description="Прохладная мятно-эвкалиптовая свежесть некоторых сортов хмеля",
         axes={"hop_aroma": .4, "clean": .3}, tags=["mint", "herbs"]),
    # HEART
    dict(name="Бисквит", technical_term="Biscuit", category="HEART", icon="🍪",
         description="Сухое печенье, крекер — лёгкий обжаренный солод",
         axes={"malt_sweet": .5, "body": .3}, tags=["bread", "biscuit", "toast"]),
    dict(name="Тост", technical_term="Toasty", category="HEART", icon="🥐",
         description="Поджаренная хлебная корочка, сухарь",
         axes={"roast": .4, "malt_sweet": .3}, tags=["toast", "bread"]),
    dict(name="Орех", technical_term="Nutty", category="HEART", icon="🥜",
         description="Фундук, миндаль — характер тёмного мюнхенского и «бисквитного» солода",
         axes={"caramel": .3, "body": .3, "roast": .2}, tags=["nuts", "toast"]),
    dict(name="Тоффи", technical_term="Toffee", category="HEART", icon="🍮",
         description="Ирис, сливочная карамель — кристаллические солода",
         axes={"caramel": .8, "malt_sweet": .5}, tags=["toffee", "caramel", "sweet"]),
    dict(name="Сухофрукты", technical_term="Dried Fruit", category="HEART", icon="🍇",
         description="Изюм, чернослив, финик — тёмные карамельные солода и крепкие сорта",
         axes={"fruit": .6, "malt_sweet": .4, "alcohol": .2}, tags=["raisin", "fruit", "sweet"]),
    dict(name="Кофе", technical_term="Coffee", category="HEART", icon="☕",
         description="Свежемолотый кофе — сильно обжаренный солод и ячмень",
         axes={"roast": .9, "bitter": .3}, tags=["coffee", "roast"]),
    dict(name="Дым", technical_term="Smoky / Rauch", category="HEART", icon="💨",
         description="Копчёный солод: костёр, бекон, дуб",
         axes={"roast": .5, "body": .3}, tags=["smoke", "char"]),
    dict(name="Пшеничная мягкость", technical_term="Wheat / Doughy", category="HEART", icon="🥯",
         description="Мягкое тесто, хлебный мякиш — пшеничный солод",
         axes={"body": .3, "clean": .4, "carbonation": .3}, tags=["bread", "wheat"]),
    dict(name="Овсяная кремовость", technical_term="Oaty / Creamy", category="HEART", icon="🥛",
         description="Шелковистая, сливочная текстура овса и лактозы",
         axes={"body": .6, "malt_sweet": .3}, tags=["cream"]),
    dict(name="Ваниль", technical_term="Vanilla", category="HEART", icon="🍦",
         description="Ваниль и лёгкая древесность — выдержка в бочке или специальный солод",
         axes={"caramel": .4, "malt_sweet": .3}, tags=["vanilla", "sweet"]),
    dict(name="Варёная кукуруза (DMS)", technical_term="Cooked corn / DMS", category="HEART", icon="🌽",
         description="Off-flavour: варёная кукуруза, консервированные овощи — диметилсульфид при недостаточном кипячении",
         axes={"malt_sweet": .2}, tags=["corn"], off=True),
    dict(name="Масло (диацетил)", technical_term="Buttery / Diacetyl", category="HEART", icon="🧈",
         description="Off-flavour: сливочное масло, попкорн, скользкое послевкусие — незавершённое брожение",
         axes={"body": .3}, tags=["butter"], off=True),
    # BASE
    dict(name="Сухой финиш", technical_term="Dry / Attenuated", category="BASE", icon="🏜️",
         description="Полное сбраживание: сухое, «хрустящее» завершение без сладости",
         axes={"clean": .6, "carbonation": .3}, tags=["fresh"]),
    dict(name="Кислинка", technical_term="Tart / Acidic", category="BASE", icon="🥝",
         description="Лёгкая приятная кислотность — пшеничные, фруктовые и кислые стили",
         axes={"carbonation": .3, "clean": .3, "fruit": .2}, tags=["sour"]),
    dict(name="Терпкость", technical_term="Astringent / Tannic", category="BASE", icon="🍵",
         description="Вяжущее, как крепкий чай — оболочки зерна, избыточное промывание",
         axes={"bitter": .4, "body": .2}, tags=[]),
    dict(name="Минеральность", technical_term="Mineral / Salty", category="BASE", icon="🧂",
         description="Солоноватая минеральность воды — стиль гозе или жёсткая вода",
         axes={"clean": .5}, tags=["mineral"]),
    dict(name="Согревающее послевкусие", technical_term="Warming Finish", category="BASE", icon="♨️",
         description="Тёплая волна алкоголя в финале крепких лагеров и боков",
         axes={"alcohol": .8, "body": .3}, tags=["warmth"]),
    dict(name="Маслянистая текстура", technical_term="Oily / Slick", category="BASE", icon="🫒",
         description="Плотная, обволакивающая текстура — высокая плотность, овёс, лактоза",
         axes={"body": .5}, tags=[]),
    dict(name="Металлический", technical_term="Metallic", category="BASE", icon="🔩",
         description="Off-flavour: монеты, кровь — ржавое оборудование, старый хмель",
         axes={}, tags=[], off=True),
    dict(name="Сернистый", technical_term="Sulfury", category="BASE", icon="🥚",
         description="Off-flavour: варёное яйцо, спичка — дрожжевой стресс; лёгкая сера допустима в молодых лагерах",
         axes={}, tags=[], off=True),
    dict(name="Зелёное яблоко (ацетальдегид)", technical_term="Acetaldehyde", category="BASE", icon="🍏",
         description="Off-flavour: незрелое зелёное яблоко, свежая краска — недобродившее «зелёное» пиво",
         axes={"fruit": .3}, tags=["apple"], off=True),
    dict(name="Картон (окисление)", technical_term="Papery / Oxidized", category="BASE", icon="📦",
         description="Off-flavour: мокрый картон, чёрствый хлеб — старое или неправильно хранившееся пиво",
         axes={}, tags=[], off=True),
    dict(name="Скунс (засветка)", technical_term="Lightstruck / Skunky", category="BASE", icon="🦨",
         description="Off-flavour: скунс, жжёная резина — свет разрушил хмелевые кислоты в прозрачной бутылке",
         axes={}, tags=[], off=True),
    dict(name="Уксусный", technical_term="Acetic / Vinegar", category="BASE", icon="🫙",
         description="Off-flavour: уксус — заражение уксуснокислыми бактериями (кроме намеренно кислых стилей)",
         axes={}, tags=["sour"], off=True),
]

# ─────────────────────────────────────────────────────────────────────────────
# 3. СТИЛЕВЫЕ ПРИОРЫ — базовый сенсорный вектор стиля (когда пирамида неполная)
# ─────────────────────────────────────────────────────────────────────────────
STYLE_PRIORS = {
    #                bitter body malt  carb  hop   roast alc   caram fruit clean
    "PILSNER":        [.55, .35, .30, .70, .55, .05, .30, .05, .10, .50],
    "LAGER":          [.40, .40, .40, .65, .35, .05, .30, .10, .10, .55],
    "AMERICAN_LAGER": [.25, .25, .30, .75, .20, .00, .25, .05, .10, .80],
    "CZECH_LAGER":    [.50, .50, .45, .60, .50, .05, .30, .15, .10, .40],
    "GERMAN_LAGER":   [.45, .45, .40, .65, .40, .05, .30, .10, .10, .50],
    "AMBER_LAGER":    [.40, .55, .55, .55, .30, .20, .35, .60, .10, .30],
    "STRONG_LAGER":   [.50, .70, .55, .50, .30, .10, .75, .35, .15, .20],
    "RICE_LAGER":     [.25, .25, .30, .70, .15, .00, .25, .00, .10, .85],
    "DRAFT_LAGER":    [.35, .40, .40, .60, .35, .05, .30, .10, .10, .55],
    # для будущих сортов портфеля (Kozel Dark, пшеничное, IPA, стаут)
    "DARK_LAGER":     [.35, .60, .60, .50, .20, .55, .35, .55, .10, .20],
    "WHEAT":          [.20, .45, .45, .75, .30, .00, .35, .05, .70, .40],
    "IPA":            [.85, .55, .35, .60, .95, .05, .55, .15, .60, .15],
    "STOUT":          [.55, .80, .55, .40, .20, .95, .45, .40, .10, .05],
}
STYLE_LABELS = {
    "PILSNER": "Пилснер", "LAGER": "Светлый лагер", "AMERICAN_LAGER": "Американский лагер",
    "CZECH_LAGER": "Чешский лагер", "GERMAN_LAGER": "Немецкий лагер", "AMBER_LAGER": "Янтарный лагер",
    "STRONG_LAGER": "Крепкий лагер", "RICE_LAGER": "Рисовый лагер", "DRAFT_LAGER": "Разливной лагер",
    "DARK_LAGER": "Тёмный лагер", "WHEAT": "Пшеничное", "IPA": "IPA", "STOUT": "Стаут",
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. 17 СОРТОВ — стиль, пирамида, ABV, картинка, происхождение
# ─────────────────────────────────────────────────────────────────────────────
# ABV сверен по публичным источникам рынка КЗ 2026-09-18 — таблица и ссылки: docs/research/ABV_SOURCES.md.
# abv_estimated=False — только если совпали ≥2 независимых ритейлера КЗ (Kaspi, MagnumOpt, Alco24 …) или есть этикетка;
# True — публичных данных нет (разливные HoReCa) либо источники расходятся → уточнить на дегустации с сомелье Efes.
BRANDS_EXTRA = {
    "Кружка Свежего": dict(slug="kruzhka-svezhego", family="DRAFT_LAGER", abv=4.0, abv_estimated=False,  # Kaspi + MagnumOpt + Alco24: 4%
        image="Kruzhka_Svezhevo.png", origin="Казахстан", tagline="Разливное — в бутылке",
        pyramid=[("TOP", "Свежесть", 6, "Яркий свежий вдох разливного формата"),
                 ("TOP", "Хмелевой аромат", 4, "Тонкий хмелевой акцент"),
                 ("HEART", "Солод", 5, "Классический ячменный солод"),
                 ("BASE", "Умеренная горечь", 4, "Мягкая приятная горчинка"),
                 ("BASE", "Освежающий финиш", 5, "Быстрое утоление жажды")]),
    "Белый Медведь": dict(slug="belyi-medved", family="LAGER", abv=4.8, abv_estimated=False,  # «Светлое»: Kaspi + MagnumOpt + tsmerkury: 4,8%
        image="Belyi_Medved.png", origin="Казахстан · Алматы, с 2007", tagline="Локальная классика",
        pyramid=[("TOP", "Свежесть", 5, "Чистый освежающий старт"),
                 ("HEART", "Зерновые ноты", 5, "Ярко выраженное зерновое тело"),
                 ("HEART", "Солод", 4, "Мягкая солодовая сладость"),
                 ("BASE", "Умеренная горечь", 4, "Сдержанная классическая горчинка")]),
    "Efes Pilsener": dict(slug="efes-pilsener", family="PILSNER", abv=5.0, abv_estimated=False,
        image="Efes_Pilsener.png", origin="Турция · Efes Beer Group", tagline="Флагман портфеля",
        pyramid=[("TOP", "Хмелевой аромат", 6, "Благородный хмель европейского типа"),
                 ("TOP", "Цветочные ноты", 4, "Изящные цветочные тона"),
                 ("HEART", "Солодовая плотность", 6, "Полнотелый насыщенный солод"),
                 ("BASE", "Хмелевая горчинка", 7, "Выразительная пилснеровская горечь"),
                 ("BASE", "Освежающий финиш", 7, "Фирменное сухое послевкусие Efes")]),
    "Miller Genuine Draft": dict(slug="miller-genuine-draft", family="AMERICAN_LAGER", abv=4.4, abv_estimated=False,  # розлив КЗ: Kaspi + MagnumOpt 4,4% (импорт — 4,7%)
        image="Miller.png", origin="США · Milwaukee", tagline="Холодная фильтрация",
        pyramid=[("TOP", "Свежесть", 7, "Исключительная легкость холодной фильтрации"),
                 ("TOP", "Лёгкий хмель", 3, "Очень деликатный хмель"),
                 ("HEART", "Зерновые ноты", 3, "Мягкий кукурузно-ячменный профиль"),
                 ("BASE", "Умеренная горечь", 3, "Едва заметная горчинка"),
                 ("BASE", "Чистый финиш", 6, "Кристально чистое послевкусие")]),
    "Velkopopovický Kozel": dict(slug="kozel", family="CZECH_LAGER", abv=4.0, abv_estimated=True,  # источники расходятся: Kaspi 3,9% / Elitalco 4% — сверить этикетку
        image="Kozel.png", origin="Чехия · Velké Popovice, с 1874", tagline="Чешское пиво №1 в мире",
        pyramid=[("TOP", "Хмелевой аромат", 5, "Чешский ароматный хмель"),
                 ("HEART", "Солод", 7, "Глубокая солодовая основа"),
                 ("HEART", "Карамель", 3, "Оттенки карамелизованного солода"),
                 ("BASE", "Хмелевая горчинка", 5, "Благородная чешская горечь"),
                 ("BASE", "Сбалансированный финиш", 5, "Классический велкопоповицкий баланс")]),
    "Bremen von Lustig": dict(slug="bremen-von-lustig", family="GERMAN_LAGER", abv=4.0, abv_estimated=False,  # Kaspi + MagnumOpt + текст этикетки «не менее 4,0%»
        image="Bremen.png", origin="Немецкий стиль", tagline="Искрящаяся горчинка",
        pyramid=[("TOP", "Искрящаяся карбонация", 7, "Яркая игра пузырьков и свежесть"),
                 ("HEART", "Солод", 4, "Лёгкая солодовая основа"),
                 ("BASE", "Хмелевая горчинка", 6, "Характерная немецкая горчинка"),
                 ("BASE", "Хмелевое послевкусие", 6, "Стойкое хмелевое послевкусие")]),
    "Bavaria": dict(slug="bavaria", family="LAGER", abv=4.9, abv_estimated=False,  # розлив КЗ: Kaspi + Alco24 + MagnumOpt: 4,9%
        image="Bavaria.png", origin="Нидерланды · с 1719", tagline="120+ стран",
        pyramid=[("TOP", "Свежесть", 5, "Голландская минеральная чистота"),
                 ("HEART", "Солод", 4, "Легкое солодовое зерно"),
                 ("BASE", "Умеренная горечь", 3, "Очень мягкий сход вкуса")]),
    "Wùkōng Jū (悟空居)": dict(slug="wukong-ju", family="RICE_LAGER", abv=4.0, abv_estimated=False,  # Kaspi + tsmerkury + Pint Please: 4%
        image="WuKong.png", origin="Китай", tagline="Рисовый лагер", display_name="Wùkōng Jū",
        pyramid=[("TOP", "Свежесть", 4, "Легкая восточная свежесть"),
                 ("HEART", "Рисовые ноты", 5, "Характерная рисовая сухость и шелковистость"),
                 ("HEART", "Сладость", 4, "Тонкая рисовая сладость"),
                 ("BASE", "Сбалансированный финиш", 3, "Мягкий сбалансированный финиш")]),
    "Карагандинское": dict(slug="karagandinskoe", family="LAGER", abv=4.6, abv_estimated=False,  # «Светлое»: semeiniy.kz + tsmerkury + Pint Please: 4,6%
        image="Karagandinskoe.png", origin="Казахстан · Караганда", tagline="История казахстанского пивоварения",
        pyramid=[("TOP", "Свежесть", 4, "Знакомая классическая свежесть"),
                 ("HEART", "Зерновые ноты", 4, "Казахстанский ячменный характер"),
                 ("BASE", "Динамичная горечь", 5, "Динамичная бодрящая горчинка")]),
    "Slavna ПРАГА": dict(slug="slavna-praga", family="CZECH_LAGER", abv=4.5, abv_estimated=False,  # «Большая Прага» 0,65: Kaspi + MagnumOpt: 4,5%
        image="Slavna_ПРАГА.png", origin="Чешский стиль", tagline="Золотистый баланс",
        pyramid=[("TOP", "Хмелевой аромат", 5, "Жатецкий хмель"),
                 ("TOP", "Цветочные ноты", 3, "Цветочный букет"),
                 ("HEART", "Солод", 6, "Золотистый плотный солод"),
                 ("HEART", "Сусло (Worty)", 4, "Сладковатое сусло"),
                 ("BASE", "Тонкая сладость финиша", 4, "Тонкая сладость послевкусия")]),
    "Жигулевское": dict(slug="zhigulevskoe", family="LAGER", abv=4.5, abv_estimated=False,  # «Разливное»: Kaspi + MagnumOpt + BeerTasting: 4,5%
        image="Zhigulevskoe.png", origin="Классический рецепт", tagline="Знакомый вкус",
        pyramid=[("TOP", "Свежесть", 4, "Легкая свежесть традиционного лагера"),
                 ("HEART", "Зерновые ноты", 5, "Добротный солодовый вкус"),
                 ("BASE", "Классическая горечь", 5, "Классическая ностальгическая горечь")]),
    "Хмельной Лось": dict(slug="khmelnoy-los", family="STRONG_LAGER", abv=7.3, abv_estimated=False,
        image="Khmelnyi_los.png", origin="Казахстан", tagline="Крепкое · 7,3%",
        pyramid=[("TOP", "Спиртовая теплота", 6, "Согревающее алкогольное дыхание (7.3%)"),
                 ("HEART", "Солодовая плотность", 6, "Густое солодовое тело"),
                 ("BASE", "Хмелевая горчинка", 6, "Мощная выраженная горечь"),
                 ("BASE", "Тело и плотность (Body)", 7, "Массивное плотное тело")]),
    "Северное Сияние": dict(slug="severnoe-siyanie", family="LAGER", abv=4.5, abv_estimated=True,
        image="Severnoye_Syiyanyie.png", origin="Казахстан · разливное", tagline="Премиальный лагер",
        pyramid=[("TOP", "Свежесть", 6, "Кристальная северная свежесть"),
                 ("TOP", "Лёгкий хмель", 4, "Натуральные хмелевые ноты"),
                 ("HEART", "Солод", 5, "Премиальный отборный солод"),
                 ("BASE", "Освежающий финиш", 5, "Чистый освежающий финал")]),
    "Легенда 777": dict(slug="legenda-777", family="AMBER_LAGER", abv=4.7, abv_estimated=True,
        image="777_razliv.png", origin="Казахстан · разливное", tagline="Янтарный характер",
        pyramid=[("TOP", "Хмелевой аромат", 4, "Легкий хмель"),
                 ("HEART", "Карамель", 5, "Янтарная карамель"),
                 ("HEART", "Солод", 5, "Подрумяненный солод"),
                 ("BASE", "Янтарная сладость", 4, "Мягкая сладость янтаря"),
                 ("BASE", "Хмелевая горчинка", 4, "Сбалансированная горечь")]),
    "13 регион": dict(slug="13-region", family="LAGER", abv=4.5, abv_estimated=True,
        image="13_region.png", origin="Казахстан · Шымкент, разливное", tagline="Для настоящих южан",
        pyramid=[("TOP", "Свежесть", 6, "Южная свежесть"),
                 ("HEART", "Зерновые ноты", 4, "Светлое зерно"),
                 ("BASE", "Умеренная горечь", 4, "Легкая питкая горечь")]),
    "Старый мельник (из бочонка)": dict(slug="stary-melnik", family="LAGER", abv=3.9, abv_estimated=True,  # фасованное «Мягкое» розлива КЗ — 3,9% (semeiniy.kz, MagnumOpt); кег не подтверждён
        image="Melnik.png", origin="Разливное · три сорта хмеля", tagline="Три хмеля в три этапа",
        display_name="Старый мельник из бочонка",
        pyramid=[("TOP", "Хмелевой аромат", 7, "Ароматный хмель позднего охмеления"),
                 ("TOP", "Котловой хмель", 5, "Котловое охмеление трех сортов"),
                 ("HEART", "Мягкий баланс солода", 5, "Бархатный баланс солода"),
                 ("BASE", "Умеренная горечь", 5, "Умеренная благородная горечь"),
                 ("BASE", "Мягкий финиш", 6, "Мягкий бочоночный финиш")]),
    "Бочковое": dict(slug="bochkovoe", family="DRAFT_LAGER", abv=4.6, abv_estimated=True,
        image="Bochkovoe.png", origin="Казахстан · разливное", tagline="Мягкий хмель",
        pyramid=[("TOP", "Свежесть", 5, "Ощущение свеженакатанной бочки"),
                 ("TOP", "Лёгкий хмель", 4, "Мягкий хмелевой штрих"),
                 ("HEART", "Солод", 4, "Легкое солодовое зерно"),
                 ("BASE", "Хмелевое послевкусие", 5, "Мягкое хмелевое послевкусие")]),
}

# ─────────────────────────────────────────────────────────────────────────────
# 5. 50 БЛЮД — сенсорные векторы, теги-мосты, эмодзи, синонимы для поиска
# ─────────────────────────────────────────────────────────────────────────────
D = dict  # короткий алиас
DISHES_EXTRA = {
    # ── Казахская ──
    "Бешбармак": D(slug="beshbarmak", emoji="🍖", v=D(umami=.85, salt=.5, fat=.8, weight=.9, spice=.2, fresh=.1),
                  tags=["bread", "broth", "onion", "lamb"], syn=["бесбармак", "ет", "мясо по-казахски", "beshbarmak"]),
    "Казы": D(slug="kazy", emoji="🥩", v=D(salt=.8, umami=.8, fat=.9, weight=.8, smoke=.3, spice=.5),
             tags=["garlic", "pepper", "cured", "horse"], syn=["қазы", "конская колбаса", "kazy"]),
    "Шужык": D(slug="shuzhyk", emoji="🌭", v=D(salt=.8, umami=.7, fat=.8, weight=.8, spice=.4),
               tags=["cured", "garlic", "horse"], syn=["шұжық", "шужук", "колбаса"]),
    "Куырдак": D(slug="kuyrdak", emoji="🍲", v=D(umami=.85, fat=.85, weight=.85, maillard=.7, salt=.5),
                tags=["onion", "offal", "fried", "potato"], syn=["қуырдақ", "куурдак", "жаркое", "потроха"]),
    "Жая": D(slug="zhaya", emoji="🥓", v=D(salt=.8, umami=.8, fat=.7, smoke=.6, weight=.8),
            tags=["smoke", "cured", "horse"], syn=["жая", "вяленая конина"]),
    "Шашлык": D(slug="shashlyk", emoji="🍢", v=D(umami=.85, smoke=.85, maillard=.8, fat=.55, weight=.8, spice=.5, salt=.5),
               tags=["smoke", "char", "pepper", "onion", "lamb"], syn=["шашлык", "кебаб", "мясо на углях", "гриль", "shashlik", "барбекю"]),
    "Плов": D(slug="plov", emoji="🍛", v=D(umami=.7, fat=.6, weight=.85, sweet=.25, spice=.6, salt=.45, maillard=.35),
             tags=["rice", "grain", "cumin", "carrot", "lamb", "caramel"], syn=["палау", "пилав", "плов с бараниной", "plov"]),
    "Курт": D(slug="kurt", emoji="🧀", v=D(salt=.8, sour=.7, umami=.4, fat=.2, weight=.2, cream=.3),
             tags=["cheese", "dairy", "sour"], syn=["құрт", "курут", "сушёный сыр"]),
    "Иримшик": D(slug="irimshik", emoji="🍮", v=D(sweet=.6, sour=.3, cream=.5, weight=.3, fat=.3),
                tags=["caramel", "dairy", "milk"], syn=["ірімшік", "иримшик", "творог"]),
    "Айран": D(slug="airan", emoji="🥛", v=D(sour=.7, salt=.3, fresh=.6, cream=.4, weight=.15),
              tags=["dairy", "sour"], syn=["айран", "кефир", "тан"]),
    "Кумыс": D(slug="kumys", emoji="🐎", v=D(sour=.8, fresh=.5, weight=.15, fat=.1),
              tags=["dairy", "sour", "fizz"], syn=["қымыз", "кумыс"]),
    "Баурсаки": D(slug="baursaki", emoji="🍩", v=D(sweet=.3, salt=.3, fat=.5, maillard=.6, weight=.5),
                 tags=["bread", "dough", "fried"], syn=["бауырсақ", "баурсак", "пончики", "выпечка"]),
    "Самса": D(slug="samsa", emoji="🥟", v=D(umami=.7, fat=.6, weight=.7, maillard=.7, salt=.5, spice=.3),
              tags=["bread", "pastry", "onion", "cumin"], syn=["самса", "самоса", "пирожок с мясом", "тандыр"]),
    "Манты": D(slug="manty", emoji="🥟", v=D(umami=.7, fat=.55, weight=.7, fresh=.2, spice=.3, salt=.45),
              tags=["dough", "onion", "pepper", "pumpkin"], syn=["мәнті", "манты", "пельмени", "хинкали", "дамплинги"]),
    "Жети-ас (мясная нарезка)": D(slug="zheti-as", emoji="🍽️", v=D(salt=.85, umami=.8, fat=.85, weight=.85, smoke=.4),
                                  tags=["cured", "garlic", "smoke", "horse"], syn=["жеті ас", "мясная нарезка", "мясное ассорти", "нарезка"],
                                  display_name="Жети-ас"),
    # ── Итальянская ──
    "Пицца Маргарита": D(slug="pizza-margherita", emoji="🍕", v=D(umami=.7, salt=.5, sour=.35, fat=.5, weight=.55, maillard=.5, cream=.4),
                         tags=["bread", "tomato", "cheese", "basil", "herbs"], syn=["пицца", "маргарита", "pizza"]),
    "Паста Карбонара": D(slug="carbonara", emoji="🍝", v=D(umami=.8, fat=.85, cream=.8, salt=.6, weight=.8),
                         tags=["cheese", "egg", "bacon", "pepper"], syn=["карбонара", "паста", "спагетти", "макароны"]),
    "Брускетта": D(slug="bruschetta", emoji="🥖", v=D(sour=.6, fresh=.7, salt=.4, fat=.3, weight=.25, maillard=.3),
                  tags=["bread", "tomato", "garlic", "herbs", "olive"], syn=["брускетта", "закуска с томатами", "кростини"]),
    "Лазанья": D(slug="lasagna", emoji="🍽️", v=D(umami=.85, fat=.8, cream=.6, weight=.9, maillard=.5, sour=.2, salt=.5),
                tags=["cheese", "tomato", "beef", "bread"], syn=["лазанья", "запеканка"]),
    "Ризотто": D(slug="risotto", emoji="🍚", v=D(umami=.7, cream=.7, fat=.55, weight=.55, salt=.45),
                tags=["rice", "cheese", "butter", "wine"], syn=["ризотто", "рис с сыром"]),
    "Тирамису": D(slug="tiramisu", emoji="🍰", v=D(sweet=.85, cream=.8, bitter=.35, fat=.6, weight=.5),
                 tags=["coffee", "cocoa", "cream", "chocolate"], syn=["тирамису", "десерт", "торт"]),
    "Капрезе": D(slug="caprese", emoji="🥗", v=D(sour=.55, fresh=.85, cream=.4, fat=.35, weight=.25, salt=.3),
                tags=["tomato", "cheese", "basil", "herbs", "olive"], syn=["капрезе", "салат", "моцарелла", "томаты"]),
    # ── Японская ──
    "Суши (нигири)": D(slug="sushi", emoji="🍣", v=D(umami=.7, fresh=.8, sour=.3, salt=.35, fat=.25, weight=.25),
                       tags=["rice", "fish", "seaweed", "vinegar"], syn=["суши", "роллы", "нигири", "сашими", "рыба", "sushi"], display_name="Суши"),
    "Рамен": D(slug="ramen", emoji="🍜", v=D(umami=.9, salt=.7, fat=.55, weight=.8, spice=.3),
              tags=["broth", "pork", "egg", "noodles", "seaweed"], syn=["рамен", "лапша", "суп"]),
    "Эдамаме": D(slug="edamame", emoji="🫛", v=D(salt=.8, fresh=.6, umami=.3, fat=.15, weight=.2),
                tags=["beans", "green"], syn=["эдамаме", "бобы", "соевые бобы"]),
    "Темпура": D(slug="tempura", emoji="🍤", v=D(umami=.5, fat=.75, maillard=.5, fresh=.3, weight=.5, salt=.4),
                tags=["fried", "seafood", "batter", "shrimp"], syn=["темпура", "креветки в кляре", "креветки"]),
    "Якитори": D(slug="yakitori", emoji="🍗", v=D(umami=.75, smoke=.6, sweet=.35, salt=.5, maillard=.7, fat=.4, weight=.5),
                 tags=["smoke", "soy", "caramel", "char", "chicken"], syn=["якитори", "курица на шпажках", "куриные шашлычки"]),
    "Моти": D(slug="mochi", emoji="🍡", v=D(sweet=.75, fresh=.3, weight=.25, fat=.1),
             tags=["rice", "sweet", "berries"], syn=["моти", "мочи", "рисовый десерт"]),
    "Тонкацу": D(slug="tonkatsu", emoji="🍱", v=D(umami=.7, fat=.85, maillard=.75, weight=.8, salt=.45),
                tags=["fried", "pork", "bread"], syn=["тонкацу", "свинина в панировке", "отбивная"]),
    # ── Американская ──
    "Бургер": D(slug="burger", emoji="🍔", v=D(umami=.85, fat=.85, weight=.9, maillard=.7, smoke=.4, salt=.6, cream=.3, sweet=.2),
               tags=["beef", "cheese", "bacon", "bread", "smoke", "onion"], syn=["бургер", "гамбургер", "чизбургер", "burger"]),
    "Стейк": D(slug="steak", emoji="🥩", v=D(umami=.9, fat=.55, weight=.85, maillard=.85, smoke=.5, salt=.5),
              tags=["beef", "char", "butter", "rosemary", "herbs"], syn=["стейк", "рибай", "говядина", "мясо", "steak"]),
    "Начос": D(slug="nachos", emoji="🧀", v=D(heat=.6, salt=.8, fat=.75, cream=.5, umami=.5, weight=.55, sour=.2),
              tags=["cheese", "corn", "chili", "tomato"], syn=["начос", "чипсы с сыром", "снеки"]),
    "Рёбрышки BBQ": D(slug="bbq-ribs", emoji="🍖", v=D(sweet=.6, salt=.5, smoke=.9, umami=.8, fat=.85, weight=.9, spice=.4),
                      tags=["smoke", "caramel", "pork", "molasses", "pepper"], syn=["рёбрышки", "ребрышки", "ребра", "барбекю", "bbq", "ribs"]),
    "Куриные крылышки Buffalo": D(slug="buffalo-wings", emoji="🍗", v=D(heat=.85, salt=.6, fat=.75, sour=.3, umami=.5, weight=.55, cream=.3),
                                  tags=["chili", "butter", "cheese", "celery", "chicken"], syn=["крылышки", "крылья", "баффало", "острые крылышки", "wings"],
                                  display_name="Крылышки Buffalo"),
    "Мак-энд-чиз": D(slug="mac-and-cheese", emoji="🧀", v=D(cream=.9, fat=.85, umami=.7, salt=.5, weight=.8, maillard=.3),
                     tags=["cheese", "butter", "pasta"], syn=["мак энд чиз", "макароны с сыром", "mac and cheese"]),
    "Яблочный пирог": D(slug="apple-pie", emoji="🥧", v=D(sweet=.8, sour=.2, maillard=.4, spice=.5, weight=.5, fat=.45),
                        tags=["apple", "cinnamon", "caramel", "butter", "pastry", "bread"], syn=["яблочный пирог", "пирог", "шарлотка", "выпечка"]),
    # ── Мексиканская ──
    "Тако": D(slug="tacos", emoji="🌮", v=D(heat=.6, umami=.65, fresh=.4, sour=.3, salt=.5, fat=.5, weight=.5, smoke=.3),
             tags=["corn", "lime", "cilantro", "chili", "onion"], syn=["тако", "такос", "tacos"]),
    "Буррито": D(slug="burrito", emoji="🌯", v=D(heat=.55, umami=.7, fat=.6, weight=.85, cream=.3, salt=.5, smoke=.4),
                tags=["rice", "beans", "chili", "cheese", "smoke"], syn=["буррито", "ролл", "шаурма", "донер"]),
    "Гуакамоле": D(slug="guacamole", emoji="🥑", v=D(sour=.55, fresh=.8, fat=.7, cream=.3, heat=.3, salt=.4, weight=.3),
                  tags=["avocado", "lime", "cilantro", "chili"], syn=["гуакамоле", "авокадо", "дип"]),
    "Кесадилья": D(slug="quesadilla", emoji="🫓", v=D(umami=.65, fat=.75, cream=.6, salt=.5, weight=.55, maillard=.5, heat=.2, fresh=.2),
                  tags=["cheese", "corn", "chicken", "tomato"], syn=["кесадилья", "кесадия", "лепёшка с сыром"]),
    "Чили кон карне": D(slug="chili-con-carne", emoji="🌶️", v=D(heat=.75, umami=.8, weight=.8, fat=.5, spice=.6, sweet=.15, sour=.2, salt=.5),
                        tags=["beef", "beans", "chili", "cumin", "tomato"], syn=["чили", "чили кон карне", "рагу", "острое рагу"]),
    "Энчилада": D(slug="enchilada", emoji="🌯", v=D(heat=.65, umami=.7, weight=.75, fat=.55, cream=.4, sour=.2, salt=.5),
                 tags=["chili", "cheese", "corn", "chicken"], syn=["энчилада", "энчиладас"]),
    "Чуррос": D(slug="churros", emoji="🥨", v=D(sweet=.8, maillard=.5, spice=.4, fat=.5, weight=.35),
               tags=["cinnamon", "sugar", "chocolate", "fried", "dough"], syn=["чуррос", "чурросы", "сладкая выпечка"]),
    # ── Немецкая ──
    "Братвурст (сосиски)": D(slug="bratwurst", emoji="🌭", v=D(salt=.7, umami=.7, fat=.85, weight=.8, smoke=.5, maillard=.5, spice=.4),
                             tags=["pork", "smoke", "herbs", "mustard"], syn=["братвурст", "сосиски", "колбаски", "сардельки", "wurst"],
                             display_name="Братвурст"),
    "Брецель": D(slug="pretzel", emoji="🥨", v=D(salt=.8, maillard=.5, weight=.4, fat=.2, umami=.2),
                tags=["bread", "salt", "toast"], syn=["брецель", "крендель", "претцель", "хлеб"]),
    "Шницель": D(slug="schnitzel", emoji="🍽️", v=D(umami=.65, fat=.8, maillard=.75, weight=.8, salt=.45, sour=.15),
                tags=["fried", "bread", "pork", "lemon", "butter"], syn=["шницель", "отбивная в панировке", "котлета"]),
    "Квашеная капуста": D(slug="sauerkraut", emoji="🥬", v=D(sour=.85, salt=.4, fresh=.5, weight=.2, fat=.1, spice=.2),
                          tags=["sour", "cabbage", "juniper"], syn=["квашеная капуста", "зауэркраут", "капуста", "соленья"]),
    "Карривурст": D(slug="currywurst", emoji="🌭", v=D(heat=.55, salt=.6, umami=.65, fat=.75, sweet=.3, spice=.6, weight=.7),
                   tags=["curry", "tomato", "pork", "spice"], syn=["карривурст", "сосиска с карри", "карри"]),
    "Картофельный салат": D(slug="kartoffelsalat", emoji="🥔", v=D(sour=.5, salt=.5, fat=.4, umami=.3, weight=.5, spice=.2),
                            tags=["potato", "mustard", "bacon", "vinegar"], syn=["картофельный салат", "картошка", "салат"]),
    "Штрудель": D(slug="strudel", emoji="🥐", v=D(sweet=.75, sour=.2, spice=.5, maillard=.4, fat=.4, weight=.5),
                 tags=["apple", "cinnamon", "raisin", "pastry", "caramel", "butter", "bread"], syn=["штрудель", "яблочный штрудель", "выпечка"]),
}

CUISINE_LABELS = {"KZ": "Казахская", "ITALIAN": "Итальянская", "JAPANESE": "Японская",
                  "AMERICAN": "Американская", "MEXICAN": "Мексиканская", "GERMAN": "Немецкая", "OTHER": "Другая"}
CUISINE_FLAGS = {"KZ": "🇰🇿", "ITALIAN": "🇮🇹", "JAPANESE": "🇯🇵", "AMERICAN": "🇺🇸", "MEXICAN": "🇲🇽", "GERMAN": "🇩🇪", "OTHER": "🌍"}
TASTE_LABELS = {"SALTY": "Солёное", "SWEET": "Сладкое", "SOUR": "Кислое", "BITTER": "Горькое",
                "UMAMI": "Умами", "SPICY": "Острое", "MIXED": "Микс"}
WEIGHT_LABELS = {"LIGHT": "Лёгкое", "MEDIUM": "Среднее", "HEAVY": "Тяжёлое"}
FAT_LABELS = {"LOW": "Низкая", "MEDIUM": "Средняя", "HIGH": "Высокая"}
COOK_LABELS = {"FRIED": "Жарка", "GRILLED": "Гриль", "BAKED": "Запекание", "BOILED": "Варка",
               "STEAMED": "На пару", "RAW": "Сырое", "CURED": "Вяленое", "FERMENTED": "Ферментация",
               "OTHER": "Без термообработки"}


def default_dish_vector(row: dict) -> dict:
    """Базовый вектор из категориальных полей CSV (потом поверх ложатся ручные правки)."""
    v = {a: 0.0 for a in DISH_AXES}
    t = row["dominant_taste"]
    if t == "SALTY": v["salt"] = .8
    elif t == "SWEET": v["sweet"] = .85
    elif t == "SOUR": v["sour"] = .8
    elif t == "BITTER": v["bitter"] = .7
    elif t == "UMAMI": v["umami"] = .8
    elif t == "SPICY": v["heat"] = .75; v["umami"] = .4
    elif t == "MIXED": v["salt"] = .4; v["sweet"] = .4; v["umami"] = .4
    v["weight"] = {"LIGHT": .25, "MEDIUM": .55, "HEAVY": .85}[row["weight"]]
    v["fat"] = {"LOW": .2, "MEDIUM": .5, "HIGH": .85}[row["fat_level"]]
    m = row["cooking_method"]
    if m == "FRIED": v["maillard"] = .6; v["fat"] = min(1, v["fat"] + .1)
    elif m == "GRILLED": v["smoke"] = .7; v["maillard"] = .7
    elif m == "BAKED": v["maillard"] = .5
    elif m == "BOILED": v["umami"] = min(1, v["umami"] + .1)
    elif m == "STEAMED": v["fresh"] = .4
    elif m == "RAW": v["fresh"] = .8
    elif m == "CURED": v["salt"] = min(1, v["salt"] + .3); v["smoke"] = .3; v["umami"] = min(1, v["umami"] + .2)
    elif m == "FERMENTED": v["sour"] = min(1, v["sour"] + .3); v["fresh"] = .3
    if t != "SWEET":
        v["salt"] = max(v["salt"], .4)
    return v


def read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def dominant_color(png: Path) -> str | None:
    """Акцентный цвет бренда: медианный оттенок насыщенных пикселей этикетки."""
    try:
        from PIL import Image
        import colorsys
        im = Image.open(png).convert("RGBA").resize((60, 108))
        buckets: Counter = Counter()
        samples: dict = {}
        for r, g, b, a in im.getdata():
            if a < 200:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s < .35 or v < .25:
                continue
            key = int(h * 24)
            buckets[key] += 1
            samples.setdefault(key, []).append((r, g, b))
        if not buckets:
            return None
        key = buckets.most_common(1)[0][0]
        px = samples[key]
        r = sum(p[0] for p in px) // len(px)
        g = sum(p[1] for p in px) // len(px)
        b = sum(p[2] for p in px) // len(px)
        return "#%02x%02x%02x" % (r, g, b)
    except Exception as e:  # noqa
        print("  ! color:", png.name, e, file=sys.stderr)
        return None


def convert_image(src: Path, slug: str) -> str | None:
    try:
        from PIL import Image
        IMG_OUT.mkdir(parents=True, exist_ok=True)
        im = Image.open(src).convert("RGBA")
        dst = IMG_OUT / f"{slug}.webp"
        im.save(dst, "WEBP", quality=88, method=6)
        return f"img/beers/{slug}.webp"
    except Exception as e:  # noqa
        print("  ! webp:", src.name, e, file=sys.stderr)
        return None


def main() -> None:
    OUT.mkdir(exist_ok=True)
    note_by_name = {n["name"]: n for n in NOTES}

    # ── notes ──
    notes_out = []
    for i, n in enumerate(NOTES):
        notes_out.append({
            "id": slugify(n["technical_term"].split("/")[0]) or f"note-{i}",
            "name": n["name"], "technical_term": n["technical_term"], "category": n["category"],
            "icon": n["icon"], "description": n["description"],
            "axes": n["axes"], "tags": n["tags"], "sort_order": i + 1,
            "is_off_flavour": bool(n.get("off", False)),
        })
    # уникальность id
    seen: Counter = Counter()
    for n in notes_out:
        seen[n["id"]] += 1
        if seen[n["id"]] > 1:
            n["id"] = f'{n["id"]}-{seen[n["id"]]}'
    note_id = {n["name"]: n["id"] for n in notes_out}
    (OUT / "flavor_notes.json").write_text(json.dumps(notes_out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ flavor_notes.json — {len(notes_out)} нот")

    # ── style priors ──
    priors = {k: dict(zip(BEER_AXES, v)) for k, v in STYLE_PRIORS.items()}
    (OUT / "style_priors.json").write_text(json.dumps({
        "axes": BEER_AXES, "labels": STYLE_LABELS, "priors": priors,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ style_priors.json — {len(priors)} стилей")

    # ── brands ──
    brands_out = []
    for row in read_csv(FIX / "brands_seed.csv"):
        name = row["name"].strip()
        x = BRANDS_EXTRA[name]
        img_src = MEDIA / x["image"]
        pyramid = []
        for layer, note_name, intensity, note in x["pyramid"]:
            assert note_name in note_by_name, f"нота {note_name} не найдена"
            assert note_by_name[note_name]["category"] == layer, f"{name}: {note_name} не в слое {layer}"
            pyramid.append({"layer": layer, "note_id": note_id[note_name], "intensity": intensity, "sommelier_note": note})
        abv = float(row["abv"]) if row["abv"].strip() else x["abv"]
        is_draft = row["packaging_type"].strip() == "DRAFT"
        is_strong = abv >= 7.0
        brands_out.append({
            "id": x["slug"],
            "name": name,
            "display_name": x.get("display_name", name),
            "brand_owner": row["brand_owner"].strip(),
            "style": row["style"].strip(),
            "style_family": x["family"],
            "style_label": STYLE_LABELS[x["family"]],
            "abv": abv,
            "abv_estimated": bool(x["abv_estimated"]),
            "packaging_type": row["packaging_type"].strip(),
            "is_horeca_only": row["is_horeca_only"].strip().lower() == "true",
            "description": row["description"].strip(),
            "origin": x["origin"],
            "tagline": x["tagline"],
            "image": convert_image(img_src, x["slug"]),
            "media_file": x["image"],
            "accent": dominant_color(img_src),
            "pyramid": pyramid,
            "serving": {
                "temp_min": 8.0 if is_strong else (4.0 if is_draft else 5.0),
                "temp_max": 12.0 if is_strong else (7.0 if is_draft else 8.0),
                "glass": "Тюльпан / Снифтер" if is_strong else ("Кружка 0,5 л" if is_draft else "Пилснер / Пинта"),
                "seasonality": "Круглый год",
            },
        })
    (OUT / "brands.json").write_text(json.dumps(brands_out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ brands.json — {len(brands_out)} сортов")

    # ── dishes ──
    dishes_out = []
    for row in read_csv(FIX / "dishes_50.csv"):
        name = row["name"].strip()
        x = DISHES_EXTRA[name]
        v = default_dish_vector(row)
        v.update({k: float(val) for k, val in x["v"].items()})
        dishes_out.append({
            "id": x["slug"],
            "name": name,
            "display_name": x.get("display_name", name),
            "emoji": x["emoji"],
            "cuisine": row["cuisine"], "cuisine_label": CUISINE_LABELS[row["cuisine"]],
            "cuisine_flag": CUISINE_FLAGS[row["cuisine"]],
            "category": row["category"].strip(),
            "dominant_taste": row["dominant_taste"], "dominant_taste_label": TASTE_LABELS[row["dominant_taste"]],
            "weight": row["weight"], "weight_label": WEIGHT_LABELS[row["weight"]],
            "fat_level": row["fat_level"], "fat_level_label": FAT_LABELS[row["fat_level"]],
            "cooking_method": row["cooking_method"], "cooking_method_label": COOK_LABELS[row["cooking_method"]],
            "description": row["description"].strip(),
            "vector": {a: round(v[a], 2) for a in DISH_AXES},
            "tags": x["tags"],
            "synonyms": x["syn"],
        })
    (OUT / "dishes.json").write_text(json.dumps(dishes_out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ dishes.json — {len(dishes_out)} блюд")

    # ── curated pairings ──
    brand_id = {b["name"]: b["id"] for b in brands_out}
    dish_id = {d["name"]: d["id"] for d in dishes_out}
    pairs_out = []
    for row in read_csv(FIX / "food_pairings.csv"):
        bn, dn = row["brand_name"].strip(), row["dish_name"].strip()
        bid = brand_id.get(bn) or next((v for k, v in brand_id.items() if bn in k), None)
        did = dish_id.get(dn) or next((v for k, v in dish_id.items() if dn in k), None)
        assert bid and did, f"пара не сматчилась: {bn} + {dn}"
        pairs_out.append({
            "brand_id": bid, "dish_id": did,
            "score": int(row["compatibility_score"]),
            "type": row["pairing_type"].strip().upper(),
            "explanation": row["explanation"].strip(),
        })
    (OUT / "pairings_curated.json").write_text(json.dumps(pairs_out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ pairings_curated.json — {len(pairs_out)} пар")


if __name__ == "__main__":
    main()
