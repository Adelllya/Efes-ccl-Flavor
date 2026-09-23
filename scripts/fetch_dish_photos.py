#!/usr/bin/env python3
"""
Flavor Tree — фотографии блюд из свободных источников.

Источники: Wikimedia Commons (основной, API) и Openverse (только провайдер WordPress Photo
Directory — CC0, отдаёт оригиналы в полном размере). Допустимые лицензии: CC0, Public domain,
CC BY (любая версия), CC BY-SA (любая версия). Всё остальное (NC, ND, GFDL-only, «fair use»,
без лицензии) отбрасывается автоматически.

Подкоманды
  candidates [id …]   найти кандидатов для блюд (лицензия и размер проверены), скачать превью и
                      собрать лист кандидатов <cache>/candidates/<id>.jpg + <id>.json. Нужна сеть.
  preview <id>        показать выбранное фото (SELECTION) с рамками кадрирования 4:3 и 1:1 →
                      <cache>/preview/<id>.jpg. Помогает подобрать focus/zoom.
  build [id …]        скачать выбранные оригиналы, кадрировать, выровнять цвет, записать
                      frontend/public/img/dishes/<id>.webp (1200×900) и <id>-sq.webp (480×480),
                      обновить data/dish_photos.json.
  sheets              собрать контактные листы docs/dish-photos/contact-sheet-N.png (ImageMagick).
  check               заново запросить лицензии всех выбранных файлов (без кэша) и сообщить,
                      если что-то перестало быть свободным.

Кэш ответов API и скачанных файлов: $FT_PHOTO_CACHE или ~/.cache/flavortree-dish-photos.
Повторный запуск не ходит в сеть, если всё уже в кэше. Между запросами пауза DELAY секунд.

Как заменить фото: запустить `candidates <id>`, посмотреть лист, вписать выбранный файл в
SELECTION (source, ref, focus, zoom), проверить `preview <id>`, затем `build <id>` и `sheets`.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "frontend" / "public" / "img" / "dishes"
DATA_OUT = ROOT / "data" / "dish_photos.json"
SHEETS_DIR = ROOT / "docs" / "dish-photos"
CACHE = Path(os.environ.get("FT_PHOTO_CACHE") or (Path.home() / ".cache" / "flavortree-dish-photos"))

UA = "FlavorTree-dish-photos/1.0 (https://github.com/Adelllya/Efes-ccl-Flavor)"
DELAY = 0.4  # секунд между сетевыми запросами
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
OPENVERSE_API = "https://api.openverse.org/v1/images/"

LARGE = (1200, 900)  # 4:3
SQUARE = (480, 480)
MIN_SHORT_SIDE = 900  # минимальная короткая сторона кадра после кадрирования (пиксели оригинала)
MIN_SHORT_SIDE_SQ = 700
WEBP_QUALITY = 78
MAX_BYTES_LARGE = 130_000
MAX_BYTES_SQUARE = 40_000

# Единая «проявка» всех фото: чуть теплее, мягкий контраст, очень лёгкая виньетка.
GRADE = {
    "warmth": 0.035,       # R × (1+w), B × (1−w)
    "contrast": 1.06,
    "saturation": 1.04,
    "vignette": 0.10,      # затемнение углов (доля)
    "unsharp": {"radius": 1.2, "percent": 55, "threshold": 3},
}

FONT_CANDIDATES = [
    "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf",
    "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# ─────────────────────────────────────────────────────────────────────────────
# Поисковые запросы по блюдам (для подкоманды candidates). en/ru — текстовый поиск,
# cat — категория Commons, extra — дополнительные запросы. Ключ = id блюда.
# ─────────────────────────────────────────────────────────────────────────────
QUERIES: dict[str, dict] = {
    # Казахская / центральноазиатская
    "beshbarmak": {"en": "beshbarmak", "ru": "бешбармак", "cat": "Beshbarmak"},
    "kazy": {"en": "kazy horse sausage", "ru": "казы", "cat": "Qazi (food)", "extra": ["intitle:казы", "incategory:\"Horse dishes of Kazakhstan\"", "intitle:\"Kazakh national\"", "intitle:Kazakh food"]},
    "shuzhyk": {"en": "shuzhuk sausage", "ru": "шужык", "cat": "Sucuk", "extra": ["intitle:шужык", "intitle:shuzhyk", "intitle:Kazakh food"]},
    "kuyrdak": {"en": "kuurdak", "ru": "куырдак", "extra": ["intitle:quwyrdaq", "intitle:kuurdak", "intitle:куурдак", "intitle:Kazakh food"]},
    "zhaya": {"en": "zhaya horse meat", "ru": "жая", "extra": ["intitle:жая", "intitle:\"Kazakh national\"", "intitle:Kazakh food", "incategory:\"Horse dishes of Kazakhstan\""]},
    "shashlyk": {"en": "shashlik", "ru": "шашлык", "cat": "Shashlik", "extra": ["shashlik skewers plate"]},
    "plov": {"en": "plov", "ru": "плов", "cat": "Plov", "extra": ["uzbek pilaf", "palov"]},
    "kurt": {"en": "qurut", "ru": "курт", "cat": "Qurut", "extra": ["intitle:kurut", "intitle:курут", "intitle:qurut", "intitle:kurt kazakh"]},
    "irimshik": {"en": "irimshik", "ru": "иримшик", "extra": ["intitle:irimshik", "intitle:ірімшік", "intitle:Kazakh food", "intitle:\"Kazakh national\""]},
    "baursaki": {"en": "baursak", "ru": "баурсак", "cat": "Baursak", "extra": ["баурсаки", "boortsog"]},
    "samsa": {"en": "samsa", "ru": "самса", "cat": "Samsa", "extra": ["somsa"]},
    "manty": {"en": "manti dumplings", "ru": "манты", "cat": "Manti", "extra": ["mantu"]},
    "zheti-as": {"en": "kazakh meat platter", "ru": "мясная нарезка казы жая", "extra": ["kazakh cold cuts horse meat"]},
    "lagman-spicy": {"en": "lagman", "ru": "лагман", "cat": "Lagman", "extra": ["laghman noodles"]},
    "chak-chak": {"en": "chak-chak", "ru": "чак-чак", "cat": "Chak-chak", "extra": ["çäkçäk"]},
    "okroshka": {"en": "okroshka", "ru": "окрошка", "cat": "Okroshka"},
    # Итальянская
    "pizza-margherita": {"en": "pizza margherita", "ru": "пицца маргарита", "cat": "Pizza Margherita"},
    "carbonara": {"en": "spaghetti alla carbonara", "ru": "карбонара", "cat": "Carbonara"},
    "bruschetta": {"en": "bruschetta", "ru": "брускетта", "cat": "Bruschetta"},
    "lasagna": {"en": "lasagna", "ru": "лазанья", "cat": "Lasagna"},
    "risotto": {"en": "risotto", "ru": "ризотто", "cat": "Risotto"},
    "tiramisu": {"en": "tiramisu", "ru": "тирамису", "cat": "Tiramisù"},
    "caprese": {"en": "insalata caprese", "ru": "капрезе", "cat": "Caprese salad"},
    "burrata": {"en": "burrata", "ru": "буррата", "cat": "Burrata"},
    # Японская
    "sushi": {"en": "nigiri sushi", "ru": "нигири", "cat": "Nigirizushi", "extra": ["nigirizushi"]},
    "ramen": {"en": "ramen", "ru": "рамен", "cat": "Ramen", "extra": ["tonkotsu ramen"]},
    "edamame": {"en": "edamame", "ru": "эдамаме", "cat": "Edamame"},
    "tempura": {"en": "tempura", "ru": "темпура", "cat": "Tempura", "extra": ["ebi tempura"]},
    "yakitori": {"en": "yakitori", "ru": "якитори", "cat": "Yakitori"},
    "mochi": {"en": "mochi", "ru": "моти", "cat": "Mochi", "extra": ["daifuku"]},
    "tonkatsu": {"en": "tonkatsu", "ru": "тонкацу", "cat": "Tonkatsu"},
    # Американская
    "burger": {"en": "hamburger", "ru": "бургер", "cat": "Hamburgers", "extra": ["cheeseburger"]},
    "steak": {"en": "beef steak", "ru": "стейк", "cat": "Beef steaks", "extra": ["ribeye steak", "steak grilled"]},
    "nachos": {"en": "nachos", "ru": "начос", "cat": "Nachos"},
    "bbq-ribs": {"en": "barbecue ribs", "ru": "рёбрышки барбекю", "cat": "Barbecue ribs", "extra": ["pork ribs bbq"]},
    "buffalo-wings": {"en": "buffalo wings", "ru": "крылышки баффало", "cat": "Buffalo wings", "extra": ["chicken wings"]},
    "mac-and-cheese": {"en": "macaroni and cheese", "ru": "макароны с сыром", "cat": "Macaroni and cheese"},
    "apple-pie": {"en": "apple pie", "ru": "яблочный пирог", "cat": "Apple pies"},
    "cheesecake": {"en": "cheesecake", "ru": "чизкейк", "cat": "Cheesecakes"},
    # Мексиканская
    "tacos": {"en": "tacos", "ru": "тако", "cat": "Tacos"},
    "burrito": {"en": "burrito", "ru": "буррито", "cat": "Burritos"},
    "guacamole": {"en": "guacamole", "ru": "гуакамоле", "cat": "Guacamole"},
    "quesadilla": {"en": "quesadilla", "ru": "кесадилья", "cat": "Quesadillas"},
    "chili-con-carne": {"en": "chili con carne", "ru": "чили кон карне", "cat": "Chili con carne"},
    "enchilada": {"en": "enchiladas", "ru": "энчилада", "cat": "Enchiladas"},
    "churros": {"en": "churros", "ru": "чуррос", "cat": "Churros"},
    # Немецкая / австрийская
    "bratwurst": {"en": "bratwurst", "ru": "братвурст", "cat": "Bratwurst"},
    "weisswurst": {"en": "weisswurst", "ru": "вайсвурст", "cat": "Weißwurst", "extra": ["weißwurst"]},
    "pretzel": {"en": "brezel", "ru": "брецель", "cat": "Pretzels", "extra": ["pretzel"]},
    "schnitzel": {"en": "wiener schnitzel", "ru": "шницель", "cat": "Wiener Schnitzel", "extra": ["schnitzel"]},
    "sauerkraut": {"en": "sauerkraut", "ru": "квашеная капуста", "cat": "Sauerkraut"},
    "currywurst": {"en": "currywurst", "ru": "карривурст", "cat": "Currywurst"},
    "kartoffelsalat": {"en": "kartoffelsalat", "ru": "картофельный салат", "cat": "Potato salad", "extra": ["potato salad"]},
    "strudel": {"en": "apfelstrudel", "ru": "штрудель", "cat": "Apfelstrudel", "extra": ["apple strudel"]},
    "roast-pork": {"en": "schweinebraten", "ru": "запечённая свинина", "cat": "Schweinebraten", "extra": ["roast pork", "vepřová pečeně"]},
    # Французская / европейская / интернациональная
    "oysters-raw": {"en": "raw oysters", "ru": "устрицы", "cat": "Oysters (food)", "extra": ["oysters on ice"]},
    "mussels-steamed": {"en": "moules marinières", "ru": "мидии", "cat": "Moules-frites", "extra": ["steamed mussels"]},
    "grilled-trout": {"en": "grilled trout", "ru": "форель на гриле", "extra": ["trout dish"]},
    "chocolate-fondant": {"en": "chocolate fondant", "ru": "шоколадный фондан", "cat": "Fondant au chocolat", "extra": ["molten chocolate cake", "lava cake"]},
    "chicken-curry": {"en": "chicken curry", "ru": "карри с курицей", "cat": "Chicken curry", "extra": ["chicken tikka masala"]},
    "salmon-grilled": {"en": "grilled salmon", "ru": "лосось на гриле", "cat": "Salmon dishes", "extra": ["salmon fillet"]},
    "asparagus-grilled": {"en": "grilled asparagus", "ru": "спаржа на гриле", "cat": "Asparagus dishes", "extra": ["green asparagus dish"]},
    "beef-tartare": {"en": "steak tartare", "ru": "тартар из говядины", "cat": "Steak tartare", "extra": ["beef tartare"]},
    "cheese-aged": {"en": "roquefort", "ru": "рокфор", "cat": "Roquefort", "extra": ["aged cheese wedge", "blue cheese"]},
    "dark-chocolate": {"en": "dark chocolate", "ru": "тёмный шоколад", "cat": "Dark chocolate", "extra": ["chocolate bar pieces"]},
    # Ожидаемые новые блюда v2 (id уточняются по data/dishes_v2.json)
    "sorpa": {"en": "shorpa", "ru": "сорпа", "cat": "Shorpa", "extra": ["shurpa", "сорпа бульон"]},
    "nauryz-kozhe": {"en": "nauryz kozhe", "ru": "наурыз коже", "extra": ["наурыз-коже"]},
    "chebureki": {"en": "chebureki", "ru": "чебуреки", "cat": "Chebureki", "extra": ["cheburek"]},
    "pelmeni": {"en": "pelmeni", "ru": "пельмени", "cat": "Pelmeni"},
    "khinkali": {"en": "khinkali", "ru": "хинкали", "cat": "Khinkali"},
    "khachapuri-adjarian": {"en": "adjarian khachapuri", "ru": "хачапури по-аджарски", "cat": "Khachapuri", "extra": ["acharuli khachapuri"]},
    "lyulya-kebab": {"en": "lula kebab", "ru": "люля-кебаб", "cat": "Lula kebab", "extra": ["lyulya kebab", "kofta kebab skewers"]},
    "dolma": {"en": "dolma", "ru": "долма", "cat": "Dolma", "extra": ["stuffed grape leaves"]},
    "ganfan": {"en": "ganfan", "ru": "ганфан", "extra": ["ганфан уйгурский", "gan fan"]},
    "ashlyam-fu": {"en": "ashlyanfu", "ru": "ашлям-фу", "extra": ["ашлянфу", "ashlan-fu"]},
    "achichuk": {"en": "achichuk", "ru": "ачичук", "extra": ["achichuk salad", "shakarob"]},
    "herring-shuba": {"en": "dressed herring", "ru": "сельдь под шубой", "cat": "Dressed herring", "extra": ["shuba salad"]},
    "olivier": {"en": "olivier salad", "ru": "оливье", "cat": "Olivier salad"},
    "borsch": {"en": "borscht", "ru": "борщ", "cat": "Borscht"},
    "solyanka": {"en": "solyanka", "ru": "солянка", "cat": "Solyanka"},
    "shawarma": {"en": "shawarma", "ru": "шаурма", "cat": "Shawarma", "extra": ["shawarma wrap"]},
    "fries": {"en": "french fries", "ru": "картофель фри", "cat": "French fries"},
    "bbq-wings": {"en": "bbq chicken wings", "ru": "крылышки барбекю", "cat": "Chicken wings", "extra": ["barbecue wings"]},
    "garlic-croutons": {"en": "garlic rye croutons beer", "ru": "гренки чесночные", "extra": ["гренки к пиву", "rye bread sticks garlic"]},
    "cheese-plate": {"en": "cheese platter", "ru": "сырная тарелка", "cat": "Cheese platters", "extra": ["cheese board"]},
    "cold-cuts": {"en": "charcuterie board", "ru": "мясная нарезка", "cat": "Charcuterie boards", "extra": ["cold cuts platter"]},
    "garlic-shrimp": {"en": "gambas al ajillo", "ru": "креветки в чесночном соусе", "cat": "Gambas al ajillo", "extra": ["garlic shrimp"]},
    "tom-yum": {"en": "tom yum", "ru": "том ям", "cat": "Tom yum", "extra": ["tom yum goong"]},
    "pad-thai": {"en": "pad thai", "ru": "пад тай", "cat": "Pad thai"},
    "pho-bo": {"en": "pho bo", "ru": "фо бо", "cat": "Phở", "extra": ["pho soup"]},
    "pizza-pepperoni": {"en": "pepperoni pizza", "ru": "пицца пепперони", "cat": "Pepperoni pizza"},
    "ribeye-steak": {"en": "ribeye steak", "ru": "рибай", "cat": "Rib eye steak", "extra": ["rib-eye"]},
    "paella": {"en": "paella", "ru": "паэлья", "cat": "Paella"},
    "fish-and-chips": {"en": "fish and chips", "ru": "фиш энд чипс", "cat": "Fish and chips"},
    "cheeseburger": {"en": "cheeseburger", "ru": "чизбургер", "cat": "Cheeseburgers"},
    "vobla": {"en": "dried vobla fish", "ru": "вобла", "cat": "Vobla", "extra": ["вобла вяленая", "dried roach fish beer"]},
    "salted-nuts": {"en": "roasted pistachios", "ru": "фисташки", "cat": "Pistachios", "extra": ["pistachio nuts bowl", "salted peanuts bowl", "roasted peanuts"]},
    "napoleon": {"en": "napoleon cake", "ru": "торт наполеон", "cat": "Napoleon (pastry)", "extra": ["mille-feuille"]},
    "medovik": {"en": "medovik", "ru": "медовик", "cat": "Medovik", "extra": ["honey cake layered"]},
    "baklava": {"en": "baklava", "ru": "пахлава", "cat": "Baklava", "extra": ["baklawa"]},
    # Варианты блюд из data/dishes_v2.json
    "baursaki-kaimak": {"en": "baursak kaymak", "ru": "баурсаки с каймаком", "cat": "Baursak", "extra": ["intitle:бауырсақ", "kaymak baursak", "intitle:baursak"]},
    "lagman": {"en": "lagman", "ru": "лагман", "cat": "Lagman", "extra": ["laghman uyghur", "intitle:lagman"]},
    "manty-pumpkin": {"en": "pumpkin manti", "ru": "манты с тыквой", "cat": "Manti", "extra": ["qovoqli manti", "intitle:manti", "манты тыква"]},
    "plov-fergana": {"en": "fergana plov", "ru": "ферганский плов", "cat": "Plov", "extra": ["intitle:plov", "intitle:palov", "osh uzbek pilaf"]},
    "kuyrdak-liver": {"en": "kuurdak liver", "ru": "куырдак из печени", "extra": ["intitle:quwyrdaq", "intitle:куырдак", "fried liver with onions dish"]},
    "shashlyk-chicken": {"en": "chicken shashlik", "ru": "шашлык из курицы", "cat": "Shashlik", "extra": ["chicken kebab skewers grilled", "tavuk şiş", "intitle:shashlik"]},
    "crayfish-boiled": {"en": "boiled crayfish", "ru": "варёные раки", "cat": "Crayfish as food", "extra": ["intitle:раки", "crayfish dill plate", "kräftskiva crayfish"]},
    "calamari-rings": {"en": "fried calamari rings", "ru": "кальмары в кляре", "cat": "Fried squid", "extra": ["calamares a la romana", "calamari fritti", "intitle:calamari"]},
    "mozzarella-sticks": {"en": "mozzarella sticks", "ru": "сырные палочки", "cat": "Mozzarella sticks", "extra": ["fried cheese sticks"]},
    "pork-knuckle": {"en": "pork knuckle", "ru": "свиная рулька", "cat": "Schweinshaxe", "extra": ["schweinshaxe", "vepřové koleno", "eisbein"]},
    "caesar-salad": {"en": "caesar salad chicken", "ru": "салат цезарь", "cat": "Caesar salad", "extra": ["chicken caesar salad"]},
    "greek-salad": {"en": "greek salad", "ru": "греческий салат", "cat": "Greek salad", "extra": ["horiatiki"]},
    "ice-cream": {"en": "vanilla ice cream scoops", "ru": "мороженое пломбир", "cat": "Ice cream in bowls", "extra": ["ice cream sundae bowl", "intitle:пломбир", "vanilla ice cream"]},
    "philadelphia-roll": {"en": "philadelphia roll", "ru": "ролл филадельфия", "cat": "Uramaki", "extra": ["salmon uramaki cream cheese", "intitle:philadelphia roll"]},
    # Предложенные блюда (data/research/proposed_dishes.json)
    "berries-dessert": {"en": "berry dessert", "ru": "ягодный десерт", "cat": "Berry desserts", "extra": ["pavlova berries", "fresh berries bowl dessert", "berry tart"]},
    "blini-caviar": {"en": "blini with caviar", "ru": "блины с икрой", "cat": "Blini", "extra": ["blini red caviar", "блины с красной икрой"]},
    "blue-cheese": {"en": "blue cheese", "ru": "голубой сыр", "cat": "Gorgonzola", "extra": ["gorgonzola wedge", "stilton cheese wedge", "blue cheese board"]},
    "brie": {"en": "brie cheese", "ru": "бри", "cat": "Brie", "extra": ["camembert wheel", "brie de meaux"]},
    "brisket-smoked": {"en": "smoked brisket", "ru": "брискет", "cat": "Brisket", "extra": ["texas brisket sliced", "beef brisket bbq"]},
    "carrot-cake": {"en": "carrot cake", "ru": "морковный торт", "cat": "Carrot cakes", "extra": ["carrot cake slice cream cheese"]},
    "ceviche": {"en": "ceviche", "ru": "севиче", "cat": "Ceviche"},
    "creme-brulee": {"en": "crème brûlée", "ru": "крем-брюле", "cat": "Crème brûlée", "extra": ["creme brulee"]},
    "duck-roast": {"en": "roast duck", "ru": "запечённая утка", "cat": "Roast duck", "extra": ["peking duck sliced", "утка запечённая", "canard rôti"]},
    "fried-chicken": {"en": "fried chicken", "ru": "жареная курица", "cat": "Fried chicken", "extra": ["korean fried chicken", "crispy fried chicken plate"]},
    "fruit-salad": {"en": "fruit salad", "ru": "фруктовый салат", "cat": "Fruit salads"},
    "goat-cheese": {"en": "goat cheese", "ru": "козий сыр", "cat": "Goat cheeses", "extra": ["chèvre log", "crottin de chavignol"]},
    "grilled-lamb": {"en": "grilled lamb chops", "ru": "баранина на гриле", "cat": "Lamb chops", "extra": ["rack of lamb", "lamb chops grilled plate"]},
    "herring": {"en": "herring with potatoes and onion", "ru": "сельдь с картофелем", "cat": "Herring as food", "extra": ["сельдь с луком", "matjes onions potatoes", "silliperuna"]},
    "lemon-tart": {"en": "lemon tart", "ru": "лимонный тарт", "cat": "Lemon tarts", "extra": ["tarte au citron", "lemon meringue tart"]},
    "meat-stew": {"en": "meat stew", "ru": "тушёное мясо", "cat": "Stews", "extra": ["beef stew bowl", "goulash bowl", "рагу из баранины"]},
    "pickles": {"en": "pickled cucumbers", "ru": "соленья", "cat": "Pickled cucumbers", "extra": ["солёные огурцы", "pickles plate assorted", "kiszone ogórki"]},
    "roast-chicken": {"en": "roast chicken", "ru": "курица запечённая", "cat": "Roast chicken", "extra": ["whole roasted chicken", "poulet rôti"]},
    "smoked-fish": {"en": "smoked mackerel", "ru": "копчёная рыба", "cat": "Smoked fish", "extra": ["hot smoked mackerel", "smoked salmon fillet", "копчёная скумбрия"]},
    # Традиционные напитки (пиала) — отдельная папка drinks-traditional/
    "kumys": {"en": "kumis", "ru": "кумыс", "cat": "Kumis", "extra": ["qymyz"]},
    "airan": {"en": "ayran", "ru": "айран", "cat": "Ayran"},
    "shubat": {"en": "shubat", "ru": "шубат", "cat": "Shubat", "extra": ["camel milk fermented"]},
}

# ─────────────────────────────────────────────────────────────────────────────
# Ручной выбор: id → источник, файл, кадр. Заполняется после просмотра листов кандидатов.
#   source: "commons" (ref = точное имя файла «File:…») или "openverse" (ref = UUID записи).
#   focus:  точка интереса в долях (x, y) — центр кадра 4:3 стремится к ней.
#   zoom:   доля от максимально возможного кадра (1.0 = максимум, 0.7 = ближе).
#   box:    явный кадр (x0, y0, x1, y1) в долях — переопределяет focus/zoom.
#   sq_focus / sq_zoom / sq_box: то же для квадрата (по умолчанию = focus/zoom).
#   group:  "drinks-traditional" → подпапка и отдельный список в JSON.
# ─────────────────────────────────────────────────────────────────────────────
def P(source: str, ref: str, focus=(0.5, 0.5), zoom=1.0, box=None, sq_focus=None, sq_zoom=None, sq_box=None,
      group: str | None = None, note: str | None = None) -> dict:
    return {"source": source, "ref": ref, "focus": focus, "zoom": zoom, "box": box,
            "sq_focus": sq_focus, "sq_zoom": sq_zoom, "sq_box": sq_box, "group": group, "note": note}


SELECTION: dict[str, dict] = {
    # ── Казахская / центральноазиатская ──
    "beshbarmak": P("commons", "File:Бешбармак - казахское национальное блюдо.jpg", focus=(0.5, 0.5), zoom=0.9),
    "kazy": P("commons", "File:Саксаул Ресторан, horse-meat qazı.jpg", box=(0.24, 0.36, 0.74, 0.86), sq_box=(0.26, 0.36, 0.74, 0.86),
              note="кадр по тарелке; бокал и бутылка воды за кадром"),
    "zheti-as": P("commons", "File:Казы, курут и ток-чок.jpg", box=(0.02, 0.20, 0.40, 0.66), sq_box=(0.03, 0.18, 0.37, 0.68),
                  note="кадр: левая доска — казы, жая и вяленое мясо"),
    "shashlyk": P("commons", "File:Grilled shashlik.jpg", focus=(0.5, 0.5), zoom=1.0),
    "plov": P("commons", "File:Urazmat-Plov.jpg", focus=(0.54, 0.62), zoom=0.82),
    "kurt": P("commons", "File:Yong'oq qurut.jpg", focus=(0.5, 0.5), zoom=0.9),
    "baursaki": P("commons", "File:Тоқаш(бауырсақ).jpg", focus=(0.5, 0.45), zoom=0.9),
    "baursaki-kaimak": P("commons", "File:Kazakh Baursak.jpg", focus=(0.5, 0.55), zoom=0.8, note="в центре пиала с каймаком"),
    "lagman": P("commons", "File:Lagman avec salade et chou fermenté, restaurant Boukhara, Lyon (2021).jpg", focus=(0.55, 0.5), zoom=0.85),
    "manty-pumpkin": P("commons", "File:Uzbek Manti (bright).jpg", focus=(0.42, 0.5), zoom=0.85, note="начинка снаружи не видна — обычные манты на узбекской тарелке"),
    "samsa": P("commons", "File:Uyda tayyorlangan somsa.jpg", focus=(0.5, 0.5), zoom=1.0),
    "manty": P("commons", "File:Lyon 7e - Rue Renan - Restaurant Boukhara - Manti.jpg", focus=(0.5, 0.5), zoom=0.85),
    "lagman-spicy": P("commons", "File:Uzbek lagman.jpg", focus=(0.5, 0.52), zoom=0.88),
    "chak-chak": P("commons", "File:Чак-чак.jpg", focus=(0.5, 0.5), zoom=0.95),
    "okroshka": P("commons", "File:Окрошка 5.jpg", box=(0.50, 0.08, 0.98, 0.92), sq_box=(0.52, 0.10, 0.98, 0.92), note="правая миска"),
    # ── Итальянская ──
    "pizza-margherita": P("commons", "File:Margherita - Five50 Aria.jpg", focus=(0.55, 0.55), zoom=0.78),
    "carbonara": P("commons", "File:Spaghetti Carbonara von Unico Tauberbischofsheim.jpg", focus=(0.5, 0.5), zoom=0.9),
    "bruschetta": P("commons", "File:Caprese Bruschetta (14700996415).jpg", focus=(0.5, 0.5), zoom=1.0),
    "risotto": P("commons", "File:Broad bean and pea risotto (5267182554).jpg", focus=(0.5, 0.5), zoom=1.0),
    "lasagna": P("commons", "File:Lasagna bolognese, February 2012.jpg", focus=(0.5, 0.5), zoom=1.0),
    "burrata": P("commons", "File:Burrata cheese.jpg", focus=(0.5, 0.5), zoom=0.9),
    "caprese": P("commons", "File:Caprese salad in homemade.jpg", focus=(0.5, 0.5), zoom=1.0),
    "tiramisu": P("commons", "File:Tiramisu (44864394001).jpg", focus=(0.5, 0.5), zoom=1.0),
    # ── Японская ──
    "sushi": P("commons", "File:Nigiri Sushi (26478725732).jpg", focus=(0.5, 0.5), zoom=1.0),
    "ramen": P("commons", "File:Tonkotsu ramen 2.jpg", box=(0.14, 0.24, 0.86, 0.96), sq_box=(0.18, 0.26, 0.84, 0.92),
               note="кадр ниже надписи на ободке миски"),
    "edamame": P("commons", "File:枝豆 塩 (10857029115).jpg", focus=(0.5, 0.5), zoom=1.0),
    "tempura": P("commons", "File:Tempura Prawns at Southport Surf Life Saving Club, Main Beach, Queensland.jpg", focus=(0.45, 0.5), zoom=0.95),
    "yakitori": P("commons", "File:Yakitori 002.jpg", focus=(0.5, 0.5), zoom=0.95),
    "mochi": P("commons", "File:Daifuku 001.jpg", focus=(0.5, 0.5), zoom=0.9),
    "tonkatsu": P("commons", "File:とんから亭ロースカツとカキフライ.jpg", focus=(0.45, 0.5), zoom=1.0),
    # ── Американская ──
    "burger": P("commons", "File:Beautiful Burger.jpg", focus=(0.54, 0.5), zoom=0.92),
    "cheeseburger": P("commons", "File:Hamburguesa completa argentina con queso derretido.jpg", focus=(0.5, 0.5), zoom=0.9),
    "steak": P("commons", "File:Beef steak with garlic butter.jpg", focus=(0.43, 0.45), zoom=0.62),
    "nachos": P("commons", "File:Plat de nachos a un restaurant del Port, Xàbia.jpg", focus=(0.5, 0.5), zoom=0.9),
    "bbq-ribs": P("commons", "File:Pork-ribs 02.jpg", focus=(0.5, 0.5), zoom=0.95),
    "buffalo-wings": P("commons", "File:Torches Petaluma - July 2023 - Sarah Stierch 07.jpg", focus=(0.5, 0.5), zoom=1.0),
    "mac-and-cheese": P("commons", "File:Original Mac n Cheese .jpg", focus=(0.5, 0.5), zoom=1.0),
    "apple-pie": P("commons", "File:Apple pie 44.jpg", focus=(0.5, 0.52), zoom=0.9),
    "cheesecake": P("commons", "File:Cheesecake dessert (3250237208).jpg", focus=(0.45, 0.5), zoom=0.9),
    # ── Мексиканская ──
    "tacos": P("commons", "File:Tacos Mexican Meal.jpg", focus=(0.55, 0.5), zoom=0.95),
    "burrito": P("commons", "File:La Casa Restaurant - Sarah Stierch - July 2019 01.jpg", focus=(0.5, 0.5), zoom=0.9),
    "guacamole": P("commons", "File:Guacomole.jpg", focus=(0.55, 0.55), zoom=0.85),
    "quesadilla": P("commons", "File:Quesadilla with tortilla chips and guacamole.jpg", focus=(0.5, 0.5), zoom=1.0),
    "chili-con-carne": P("commons", "File:Flickr - cyclonebill - Chili con carne.jpg", box=(0.22, 0.0, 0.78, 0.63), note="без нижней части кастрюли"),
    "enchilada": P("commons", "File:Enchiladas hidrocálidas veganas.jpg", focus=(0.42, 0.62), zoom=0.8, note="рука и вилка за кадром"),
    "churros": P("commons", "File:Churros. Vienna, Austria. 2016. (28768491952).jpg", focus=(0.5, 0.5), zoom=0.85),
    # ── Немецкая / австрийская ──
    "bratwurst": P("commons", "File:Dülmen, Bürgerfest 2013 -- 2013 -- 3139.jpg", focus=(0.5, 0.5), zoom=0.85),
    "weisswurst": P("commons", "File:Bayerische Weißwurst mit Breze und süßem Senf.jpg", focus=(0.45, 0.55), zoom=0.88),
    "pretzel": P("commons", "File:Zwei schwäbische Brezeln 1.jpg", box=(0.28, 0.0, 0.92, 0.64), sq_box=(0.45, 0.02, 0.87, 0.64), note="надпись на салфетке за кадром"),
    "schnitzel": P("commons", "File:Wiener Schnitzel 2012.jpg", focus=(0.38, 0.5), zoom=0.85),
    "currywurst": P("commons", "File:Curryking-4612.jpg", focus=(0.5, 0.5), zoom=0.8),
    "kartoffelsalat": P("commons", "File:Potato salad-2.jpg", focus=(0.5, 0.5), zoom=1.0),
    "strudel": P("commons", "File:2015 0723 Apfelstrudel Gaislachalm Sölden.jpg", focus=(0.5, 0.55), zoom=0.95),
    "sauerkraut": P("commons", "File:Surówka z kiszonej kapusty 12 IV 2026.jpg", box=(0.04, 0.12, 0.62, 0.56), sq_box=(0.10, 0.14, 0.52, 0.53),
                    note="кадр без столовых приборов"),
    "roast-pork": P("commons", "File:Schweinebraten Goldener Adler Mürsbach.jpg", focus=(0.5, 0.55), zoom=0.9),
    # ── Французская / европейская / интернациональная ──
    "oysters-raw": P("commons", "File:Oysters - Viktualienmarkt - DSC08587.JPG", focus=(0.5, 0.58), zoom=0.85),
    "mussels-steamed": P("commons", "File:Normandy '10- Saint-Vaast-la-Hougue (4826863803).jpg", focus=(0.58, 0.62), zoom=0.78,
                          note="бокал с логотипом пивоварни за кадром"),
    "grilled-trout": P("commons", "File:Grillforelle 5688.JPG", focus=(0.45, 0.5), zoom=0.75),
    "chocolate-fondant": P("commons", "File:Шоколадний фондан.jpg", focus=(0.5, 0.5), zoom=0.85),
    "chicken-curry": P("commons", "File:Chicken curry Trivandrum.jpg", focus=(0.55, 0.5), zoom=0.82),
    "salmon-grilled": P("commons", "File:Salmon Fillet (30910417061).jpg", focus=(0.5, 0.5), zoom=0.8),
    "asparagus-grilled": P("commons", "File:Grilled Asparagus (13917724779).jpg", focus=(0.5, 0.5), zoom=0.9),
    "beef-tartare": P("commons", "File:2019 - ContentMakers dinner - Day 2 CG1 1671 (49025770076).jpg", focus=(0.5, 0.55), zoom=0.8),
    "cheese-aged": P("commons", "File:Wikicheese - Roquefort - 20150417 - 003.jpg", focus=(0.62, 0.55), zoom=1.0, sq_focus=(0.55, 0.55), sq_zoom=0.95),
    "dark-chocolate": P("commons", "File:Chocolate - stonesoup.jpg", focus=(0.5, 0.5), zoom=1.0),
    # ── Новые блюда v2 ──
    "nauryz-kozhe": P("commons", "File:Наурыз коже.jpg", focus=(0.5, 0.55), zoom=0.9),
    "chebureki": P("commons", "File:Chebureki at Pushkin Literature Restaurant, Zhong Guan Cun No.1 (20210714185521).jpg", focus=(0.5, 0.55), zoom=0.85),
    "pelmeni": P("commons", "File:Pelmeni Russian.jpg", focus=(0.45, 0.5), zoom=0.95),
    "sorpa": P("commons", "File:Самарканд, сорпа в уличном кафе.jpg", box=(0.02, 0.14, 0.98, 0.86), sq_box=(0.02, 0.02, 0.98, 0.98)),
    "khinkali": P("commons", "File:Khinkali 552.jpg", focus=(0.5, 0.5), zoom=0.8),
    "khachapuri-adjarian": P("commons", "File:Batumi - Khachapuri amb ou.jpg", focus=(0.5, 0.5), zoom=0.95),
    "lyulya-kebab": P("commons", "File:Lula kebab.jpg", focus=(0.5, 0.5), zoom=0.95),
    "dolma": P("commons", "File:Dolmades with Tomato Wedges (5045977233).jpg", box=(0.14, 0.18, 0.82, 0.90), sq_box=(0.2, 0.16, 0.76, 0.90),
               note="щипцы и карточка за кадром"),
    "ashlyam-fu": P("commons", "File:Karakol - 247 (49359622038).jpg", focus=(0.5, 0.5), zoom=0.9),
    "olivier": P("commons", "File:Ensalada rusa argentina.JPG", focus=(0.56, 0.5), zoom=0.85),
    "achichuk": P("commons", "File:Ачік-чучук.jpg", focus=(0.5, 0.5), zoom=0.9),
    "herring-shuba": P("commons", "File:Салат Сельдь под Шубой 04.jpg", focus=(0.5, 0.5), zoom=0.9),
    "borsch": P("commons", "File:Кубанский борщ.jpg", focus=(0.36, 0.5), zoom=0.85),
    "solyanka": P("commons", "File:Soljanka food 05.jpg", focus=(0.5, 0.5), zoom=0.95),
    "shawarma": P("commons", "File:Шаурма в лаваше сравнение 2.jpg", focus=(0.5, 0.5), zoom=0.85),
    "fries": P("commons", "File:Pub fries with ketchup 2021 001.jpg", focus=(0.5, 0.45), zoom=0.85),
    "garlic-croutons": P("commons", "File:Estonian rye bread sticks at restaurant 100 õlle koht.jpg", box=(0.08, 0.22, 0.99, 0.98), sq_box=(0.16, 0.2, 0.9, 0.94),
                         note="бокал пива сверху за кадром"),
    "cheese-plate": P("commons", "File:International cheese platters.jpg", focus=(0.5, 0.5), zoom=0.95),
    "cold-cuts": P("commons", "File:Salame ticinese.jpg", box=(0.2, 0.0, 1.0, 1.0), note="нож с логотипом за кадром"),
    "garlic-shrimp": P("commons", "File:Layla at MacArthur Place - 2021-05-20 - Sarah Stierch 03.jpg", focus=(0.56, 0.62), zoom=0.84,
                       note="этикетка вина за кадром"),
    "tom-yum": P("commons", "File:Tom Yum Goong Noodle Soup - Nok Nok Kitchen at The Cow 2024-03-28.jpg", focus=(0.53, 0.5), zoom=0.8, note="бутылка лимонада за кадром"),
    "ribeye-steak": P("commons", "File:HK SW 上環 Sheung Wan 皇后大道西 24 Queen's Road West Lai Yan Lau shop Kon Fusion Restaurant & Bar diner food Pizza n Rib Eye Steak June 2020 SS2 15.jpg", focus=(0.5, 0.55), zoom=0.85),
    "paella": P("commons", "File:Paella (2644894109).jpg", focus=(0.5, 0.5), zoom=1.0),
    "pad-thai": P("commons", "File:Pad Thai (2433385864).jpg", focus=(0.5, 0.5), zoom=1.0),
    "bbq-wings": P("commons", "File:Chicken wings meal at Siipiweikot.jpg", focus=(0.45, 0.72), zoom=0.7, note="стакан сверху за кадром"),
    "pizza-pepperoni": P("commons", "File:All Good pizza (38501728345).jpg", focus=(0.5, 0.5), zoom=1.0),
    "pho-bo": P("commons", "File:Pho, beef brisket, tendon, tripe (30025527004).jpg", box=(0.2, 0.14, 0.95, 0.89), sq_box=(0.25, 0.12, 0.92, 0.9)),
    "fish-and-chips": P("commons", "File:Fish and chips plate with peas.jpg", focus=(0.5, 0.5), zoom=0.9),
    "vobla": P("commons", "File:Wobla 4.JPG", focus=(0.45, 0.5), zoom=1.0),
    "salted-nuts": P("commons", "File:Roasted & Salted (51994480044).jpg", focus=(0.5, 0.5), zoom=0.9),
    "napoleon": P("commons", "File:Mille-feuille 008.JPG", focus=(0.5, 0.36), zoom=0.72, note="отражение в подносе за кадром"),
    "medovik": P("commons", "File:Medovnik Honey Cake.jpg", focus=(0.4, 0.5), zoom=0.95, sq_focus=(0.35, 0.5), sq_zoom=1.0),
    "baklava": P("commons", "File:بقلاوة (حلوى شرقية).JPG", focus=(0.5, 0.5), zoom=0.95),
    "shashlyk-chicken": P("commons", "File:Food-dinner-grilled-shashlik (24244253091).jpg", focus=(0.5, 0.5), zoom=0.95),
    "crayfish-boiled": P("commons", "File:Boiled crawfish 036 - Tony's Seafood, Baton Rouge, Louisiana.jpg", focus=(0.5, 0.5), zoom=0.95),
    "calamari-rings": P("commons", "File:Fried squid; Calamares fritos (Las Siete Orillas project) (1).jpg", box=(0.02, 0.36, 0.92, 0.81), sq_box=(0.05, 0.33, 0.9, 0.9), note="бокал пива сверху за кадром"),
    "plov-fergana": P("commons", "File:Farg'onacha osh.jpg", focus=(0.6, 0.62), zoom=0.8, note="шумовка слева сверху за кадром"),
    "mozzarella-sticks": P("commons", "File:2023-04-10 17 23 29 Mozzarella sticks from Wawa in Westampton Township, Burlington County, New Jersey.jpg", focus=(0.5, 0.5), zoom=0.95),
    "pork-knuckle": P("commons", "File:Brotzeit Pork Knuckle.jpg", box=(0.08, 0.2, 0.9, 1.0), sq_box=(0.2, 0.2, 0.785, 0.98), note="соусник и бокал сверху за кадром"),
    "caesar-salad": P("commons", "File:Ensalada Cesar.jpg", focus=(0.47, 0.6), zoom=0.75, note="бутылки сверху за кадром"),
    "greek-salad": P("commons", "File:Tomato Salad (7846872334).jpg", focus=(0.5, 0.5), zoom=1.0),
    "ice-cream": P("commons", "File:Day 354 - Photo365 - White (23766206842).jpg", focus=(0.5, 0.5), zoom=1.0),
    "philadelphia-roll": P("commons", "File:Philly roll.jpg", focus=(0.5, 0.5), zoom=1.0),
    # ── Предложенные блюда (data/research/proposed_dishes.json) ──
    "berries-dessert": P("commons", "File:Berries, lemon sorbet and agar jelly. A beautiful and delicious dessert at Otto! (5042970449).jpg", focus=(0.5, 0.5), zoom=0.9),
    "blini-caviar": P("commons", "File:Blin with red caviar by shakko 02.jpg", focus=(0.5, 0.5), zoom=0.9),
    "blue-cheese": P("commons", "File:2015-01-25 Blaue Geiss - Toggenburg - der Schweizer - hu - 8021.jpg", focus=(0.5, 0.5), zoom=0.95),
    "brie": P("commons", "File:Wikicheese - Brie de Meaux - 20150515 - 022.jpg", focus=(0.5, 0.5), zoom=0.9),
    "brisket-smoked": P("commons", "File:Smoked Brisket with smoke ring.jpg", focus=(0.55, 0.58), zoom=0.85, sq_focus=(0.62, 0.55), sq_zoom=0.85),
    "carrot-cake": P("commons", "File:Torta de zanahoria.jpg", focus=(0.5, 0.42), zoom=0.85),
    "ceviche": P("commons", "File:Ceviche at the Municipal Market of Sao Paulo.jpg", focus=(0.5, 0.5), zoom=0.9),
    "creme-brulee": P("commons", "File:Alex Munsell 2015 (Unsplash).jpg", focus=(0.5, 0.5), zoom=0.9),
    "duck-roast": P("commons", "File:A dish of Peking Duck from Fu Dong Kwok Restaurant in Sha Tin.jpg", focus=(0.56, 0.52), zoom=0.85),
    "fried-chicken": P("commons", "File:Fried chicken (25045114592).jpg", focus=(0.5, 0.5), zoom=0.9),
    "fruit-salad": P("commons", "File:Mexican fruit salad 2.jpg", focus=(0.5, 0.5), zoom=1.0),
    "goat-cheese": P("commons", "File:Crottin 02.jpg", focus=(0.5, 0.5), zoom=0.85),
    "grilled-lamb": P("commons", "File:Lamb Chops from a Greek restaurant in Fort Lauderdale, Florida.jpg", focus=(0.5, 0.58), zoom=0.82),
    "herring": P("commons", "File:Herring with sour cream and onion and fried potato.jpg", focus=(0.5, 0.5), zoom=1.0),
    "lemon-tart": P("commons", "File:Lemon tart dusted with powdered sugar at a restaurant.jpg", focus=(0.5, 0.5), zoom=0.95),
    "meat-stew": P("commons", "File:Irish Beef Stew (34046928633).jpg", focus=(0.5, 0.5), zoom=0.9),
    "roast-chicken": P("commons", "File:Roasted Chicken Dinner Plate, Broccoli, Demi Glace.jpg", focus=(0.45, 0.5), zoom=0.9),
    "pickles": P("commons", "File:Polish style pickled cucumbers IMGP0464.jpg", focus=(0.5, 0.5), zoom=0.95),
    "smoked-fish": P("commons", "File:Smoked mackerel-01.jpg", focus=(0.5, 0.5), zoom=1.0),
}

# Блюда, для которых подходящего свободного фото не нашлось (id → причина, попадает в docs).
NO_PHOTO: dict[str, str] = {
    "zhaya": "На Commons и в Openverse нет свободных фото жая (вяленый конский окорок); подменять похожей нарезкой не стали.",
    "shuzhyk": "Свободные фото есть только для турецкого/армянского суджука — это другой продукт, не казахский шужык.",
    "irimshik": "Свободных фото иримшика не найдено (поиск по irimshik / ірімшік / казахская кухня даёт только другие сыры).",
    "kuyrdak": "Единственное свободное фото (1280×960, CC BY-SA 2.0) — казан с рукой повара в кадре; ниже порога качества и разрешения.",
    "kuyrdak-liver": "См. kuyrdak — подходящего фото нет.",
    "ganfan": "Фото ганфана (дунганская кухня) в свободных источниках нет.",
}


# ─────────────────────────────────────────────────────────────────────────────
# HTTP с кэшем
# ─────────────────────────────────────────────────────────────────────────────
def _cache_path(url: str, binary: bool) -> Path:
    key = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return CACHE / ("files" if binary else "api") / (key + (".bin" if binary else ".json"))


def http_get(url: str, *, binary: bool = False, refresh: bool = False) -> bytes:
    path = _cache_path(url, binary)
    if path.exists() and not refresh:
        return path.read_bytes()
    last_err: Exception | None = None
    for attempt in range(5):
        try:
            time.sleep(DELAY)
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = resp.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return data
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429:
                print(f"    429 от {urllib.parse.urlsplit(url).netloc}: ждём 65 с", file=sys.stderr)
                time.sleep(65)
                continue
            if e.code in (500, 502, 503, 504):
                time.sleep(3 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last_err = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"не удалось скачать {url}: {last_err}")


def api_json(base: str, params: dict, refresh: bool = False) -> dict:
    url = base + "?" + urllib.parse.urlencode(params)
    return json.loads(http_get(url, refresh=refresh))


# ─────────────────────────────────────────────────────────────────────────────
# Лицензии
# ─────────────────────────────────────────────────────────────────────────────
LICENSE_RE = re.compile(r"^CC BY(?:-SA)? \d\.\d(?: [a-z]{2,3}(?:-[a-z]+)?)?$", re.I)


def normalize_license(short: str, url: str) -> tuple[str | None, str]:
    """→ (короткое имя допустимой лицензии или None, url). Строгий белый список."""
    s = html.unescape(short or "").strip()
    s = re.sub(r"\s+", " ", s)
    if re.fullmatch(r"CC0(?: 1\.0)?", s, re.I):
        return "CC0 1.0", url or "https://creativecommons.org/publicdomain/zero/1.0/"
    if re.fullmatch(r"Public domain", s, re.I):
        return "Public domain", url or ""
    if re.fullmatch(r"Public Domain Mark(?: 1\.0)?", s, re.I):
        return "Public Domain Mark 1.0", url or "https://creativecommons.org/publicdomain/mark/1.0/"
    if LICENSE_RE.fullmatch(s):
        parts = s.split(" ")
        kind, ver = parts[0].upper(), parts[1]
        rest = (" " + " ".join(parts[2:])) if len(parts) > 2 else ""
        return f"{kind} {ver}{rest}", url
    return None, url


def clean_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def clean_author(s: str) -> str:
    a = clean_html(s)
    a = re.sub(r"^(?:Unknown author|Неизвестен|Anonymous)\s*(?:Unknown author)?$", "неизвестный автор", a, flags=re.I)
    a = re.sub(r"\(talk\)|\(обсуждение\)", "", a, flags=re.I).strip()
    return a[:120] if a else "неизвестный автор"


# ─────────────────────────────────────────────────────────────────────────────
# Wikimedia Commons
# ─────────────────────────────────────────────────────────────────────────────
SIZE_FILTER = "filetype:bitmap filew:>1199 fileh:>899"
EXTMETA = "LicenseShortName|LicenseUrl|License|Artist|Credit|ImageDescription|Restrictions|Attribution|Categories|DateTimeOriginal"


def _commons_pages(params: dict, refresh: bool = False) -> list[dict]:
    d = api_json(COMMONS_API, {"format": "json", "formatversion": 2, **params}, refresh=refresh)
    return d.get("query", {}).get("pages", []) or []


def candidate_from_commons(p: dict) -> dict | None:
    if not p.get("imageinfo"):
        return None
    ii = p["imageinfo"][0]
    em = ii.get("extmetadata", {}) or {}
    val = lambda k: (em.get(k) or {}).get("value", "") or ""
    lic, lic_url = normalize_license(val("LicenseShortName"), val("LicenseUrl"))
    return {
        "source": "commons",
        "ref": p["title"],
        "title": p["title"],
        "page": ii.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(p['title'])}",
        "thumb": ii.get("thumburl"),
        "full": (ii.get("url") or "").split("?")[0],
        "width": ii.get("width", 0),
        "height": ii.get("height", 0),
        "mime": ii.get("mime", ""),
        "license": lic,
        "license_raw": clean_html(val("LicenseShortName")),
        "license_url": lic_url,
        "author": clean_author(val("Artist")),
        "credit": clean_html(val("Credit"))[:120],
        "desc": clean_html(val("ImageDescription"))[:160],
        "restrictions": clean_html(val("Restrictions")),
        "categories": val("Categories"),
    }


def commons_search(q: str, limit: int = 30, thumb: int = 640) -> list[dict]:
    pages = _commons_pages({
        "action": "query", "generator": "search", "gsrsearch": f"{q} {SIZE_FILTER}", "gsrnamespace": 6,
        "gsrlimit": limit, "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": thumb,
        "iiextmetadatafilter": EXTMETA,
    })
    out = [candidate_from_commons(p) for p in pages]
    return [c for c in out if c]


def commons_file(title: str, width: int = 2560, refresh: bool = False) -> dict | None:
    pages = _commons_pages({
        "action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": width, "iiextmetadatafilter": EXTMETA,
    }, refresh=refresh)
    for p in pages:
        c = candidate_from_commons(p)
        if c:
            return c
    return None


def wikidata_qid(label: str) -> str | None:
    d = api_json("https://www.wikidata.org/w/api.php", {
        "action": "wbsearchentities", "search": label, "language": "en", "limit": 1, "format": "json"})
    hits = d.get("search") or []
    return hits[0]["id"] if hits else None


# ─────────────────────────────────────────────────────────────────────────────
# Openverse (только WordPress Photo Directory: CC0, оригиналы доступны)
# ─────────────────────────────────────────────────────────────────────────────
OV_LICENSE = {"by": "CC BY", "by-sa": "CC BY-SA", "cc0": "CC0", "pdm": "Public Domain Mark"}


def candidate_from_openverse(r: dict) -> dict | None:
    kind = OV_LICENSE.get((r.get("license") or "").lower())
    if not kind:
        return None
    short = f"{kind} {r.get('license_version') or ''}".strip()
    lic, lic_url = normalize_license(short, r.get("license_url") or "")
    url = r.get("url") or ""
    full = url
    if r.get("provider") == "wordpress":
        full = re.sub(r"-\d+x\d+(\.\w+)$", r"\1", url)  # оригинал без суффикса размера
    return {
        "source": "openverse",
        "ref": r["id"],
        "title": (r.get("title") or "").strip() or r["id"],
        "page": r.get("foreign_landing_url") or "",
        "thumb": url,
        "full": full,
        "width": r.get("width") or 0,
        "height": r.get("height") or 0,
        "mime": "image/jpeg",
        "license": lic,
        "license_raw": short,
        "license_url": lic_url,
        "author": clean_author(r.get("creator") or ""),
        "credit": r.get("provider") or "",
        "desc": (r.get("title") or "")[:160],
        "restrictions": "",
        "categories": ", ".join(t.get("name", "") for t in (r.get("tags") or [])[:8]),
    }


def openverse_search(q: str, limit: int = 20) -> list[dict]:
    d = api_json(OPENVERSE_API, {"q": q, "license": "by,by-sa,cc0,pdm", "source": "wordpress", "page_size": limit})
    return [c for c in (candidate_from_openverse(r) for r in d.get("results", []) or []) if c]


def openverse_detail(uuid: str, refresh: bool = False) -> dict | None:
    url = f"{OPENVERSE_API}{uuid}/"
    r = json.loads(http_get(url, refresh=refresh))
    return candidate_from_openverse(r) if r.get("id") else None


# ─────────────────────────────────────────────────────────────────────────────
# Кандидаты
# ─────────────────────────────────────────────────────────────────────────────
BAD_TITLE = re.compile(r"(?i)\b(map|logo|diagram|drawing|painting|illustration|poster|menu card|sketch|clipart|"
                       r"advert|screenshot|recipe card|packag)")


def acceptable(c: dict) -> tuple[bool, str]:
    if not c.get("license"):
        return False, f"лицензия {c.get('license_raw') or '—'}"
    if c.get("mime") and c["mime"] not in ("image/jpeg", "image/png", "image/webp"):
        return False, c["mime"]
    if c.get("width") and c.get("height") and (c["width"] < 1200 or c["height"] < 900):
        return False, f"мало пикселей {c['width']}×{c['height']}"
    if BAD_TITLE.search(c.get("title", "")):
        return False, "по названию не фото"
    if re.search(r"(?i)trademark|personality|insignia", c.get("restrictions", "")):
        return False, f"ограничения: {c['restrictions']}"
    return True, ""


def gather_candidates(dish_id: str, limit: int = 16, per_query: int = 25) -> list[dict]:
    q = QUERIES.get(dish_id)
    if not q:
        raise SystemExit(f"нет запросов для {dish_id}: добавьте в QUERIES")
    queries: list[tuple[str, str]] = []
    if q.get("cat"):
        queries.append(("commons", f'incategory:"{q["cat"]}"'))
    queries.append(("commons", f'"{q["en"]}" hastemplate:QualityImage'))
    queries.append(("commons", f'{q["en"]}'))
    queries.append(("commons", f'{q["ru"]}'))
    for e in q.get("extra", []):
        queries.append(("commons", e))
    qid = wikidata_qid(q["en"])
    if qid:
        queries.append(("commons", f"haswbstatement:P180={qid}"))
    queries.append(("openverse", q["en"]))

    seen: set[str] = set()
    found: list[dict] = []
    rejected: Counter = Counter()
    for src, text in queries:
        try:
            res = commons_search(text, limit=per_query) if src == "commons" else openverse_search(text, limit=20)
        except Exception as e:  # noqa: BLE001
            print(f"    ! {src} «{text}»: {e}", file=sys.stderr)
            continue
        for c in res:
            key = f"{c['source']}:{c['ref']}"
            if key in seen:
                continue
            seen.add(key)
            ok, why = acceptable(c)
            if not ok:
                rejected[why.split(" ")[0]] += 1
                continue
            c["query"] = text
            found.append(c)
    # ранжирование: сначала по порядку запросов (категория/quality выше), внутри — по площади
    found.sort(key=lambda c: (-(c["width"] * c["height"] > 4_000_000), 0))
    return found[:limit], rejected


def load_font(size: int) -> ImageFont.ImageFont:
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def fetch_thumb(c: dict) -> Image.Image | None:
    url = c.get("thumb") or c.get("full")
    if not url:
        return None
    try:
        data = http_get(url, binary=True)
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((960, 960), Image.LANCZOS)
        return im
    except Exception as e:  # noqa: BLE001
        print(f"    ! превью {url[:80]}: {e}", file=sys.stderr)
        return None


def contact_sheet(items: list[tuple[Image.Image, str]], cols: int, cell: tuple[int, int], label_h: int,
                  bg=(11, 8, 6), fg=(214, 203, 184), font_size: int = 15, fit: str = "contain") -> Image.Image:
    rows = max(1, math.ceil(len(items) / cols))
    cw, ch = cell
    pad = 8
    W = cols * (cw + pad) + pad
    H = rows * (ch + label_h + pad) + pad
    sheet = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(sheet)
    font = load_font(font_size)
    for i, (im, label) in enumerate(items):
        r, c = divmod(i, cols)
        x = pad + c * (cw + pad)
        y = pad + r * (ch + label_h + pad)
        if fit == "cover":
            tile = ImageOps.fit(im, (cw, ch), Image.LANCZOS)
            sheet.paste(tile, (x, y))
        else:
            t = im.copy()
            t.thumbnail((cw, ch), Image.LANCZOS)
            sheet.paste(t, (x + (cw - t.width) // 2, y + (ch - t.height) // 2))
        for j, line in enumerate(label.split("\n")[:3]):
            draw.text((x + 2, y + ch + 3 + j * (font_size + 3)), line, fill=fg, font=font)
    return sheet


def cmd_candidates(ids: list[str], limit: int) -> None:
    out_dir = CACHE / "candidates"
    out_dir.mkdir(parents=True, exist_ok=True)
    for dish_id in ids:
        print(f"== {dish_id}")
        cands, rejected = gather_candidates(dish_id, limit=limit)
        items = []
        for i, c in enumerate(cands):
            im = fetch_thumb(c)
            if im is None:
                continue
            c["thumb_size"] = im.size
            label = (f"[{i}] {c['license']} · {c['width']}×{c['height']} · {c['source']}\n"
                     f"{c['title'][:52]}\n{c['author'][:40]}")
            items.append((im, label))
        (out_dir / f"{dish_id}.json").write_text(json.dumps(cands, ensure_ascii=False, indent=1), encoding="utf-8")
        if items:
            sheet = contact_sheet(items, cols=4, cell=(400, 300), label_h=58)
            sheet.save(out_dir / f"{dish_id}.jpg", quality=80)
        print(f"   кандидатов: {len(items)}; отброшено: {dict(rejected)}")
        for i, c in enumerate(cands):
            print(f"   [{i}] {c['license']:<14} {c['width']}×{c['height']:<6} {c['source']:<9} {c['title'][:60]}")


# ─────────────────────────────────────────────────────────────────────────────
# Кадрирование и проявка
# ─────────────────────────────────────────────────────────────────────────────
def compute_box(size: tuple[int, int], aspect: float, focus, zoom: float, box=None) -> tuple[int, int, int, int]:
    w, h = size
    if box:
        x0, y0, x1, y1 = box
        bx0, by0, bx1, by1 = x0 * w, y0 * h, x1 * w, y1 * h
        # привести к точной пропорции, сохраняя центр
        bw, bh = bx1 - bx0, by1 - by0
        if bw / bh > aspect:
            bw = bh * aspect
        else:
            bh = bw / aspect
        cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    else:
        if w / h > aspect:
            bw, bh = h * aspect, h
        else:
            bw, bh = w, w / aspect
        zoom = max(0.2, min(1.0, zoom))
        bw, bh = bw * zoom, bh * zoom
        cx, cy = focus[0] * w, focus[1] * h
    x0 = min(max(cx - bw / 2, 0), w - bw)
    y0 = min(max(cy - bh / 2, 0), h - bh)
    return int(round(x0)), int(round(y0)), int(round(x0 + bw)), int(round(y0 + bh))


def boxes_for(sel: dict, w: int, h: int) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    """Кадры 4:3 и 1:1 в пикселях оригинала. Квадрат без явных sq_* берётся из центра кадра 4:3."""
    box_l = compute_box((w, h), LARGE[0] / LARGE[1], sel["focus"], sel["zoom"], sel["box"])
    if sel.get("sq_box"):
        box_s = compute_box((w, h), 1.0, sel["focus"], sel["zoom"], sel["sq_box"])
    elif sel.get("box") and not sel.get("sq_focus") and not sel.get("sq_zoom"):
        x0, y0, x1, y1 = box_l
        side = min(x1 - x0, y1 - y0)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        box_s = compute_box((w, h), 1.0, (cx / w, cy / h), 1.0,
                            ((cx - side / 2) / w, (cy - side / 2) / h, (cx + side / 2) / w, (cy + side / 2) / h))
    else:
        box_s = compute_box((w, h), 1.0, sel.get("sq_focus") or sel["focus"], sel.get("sq_zoom") or sel["zoom"], None)
    return box_l, box_s


def _lut(scale: float) -> list[int]:
    return [max(0, min(255, round(i * scale))) for i in range(256)]


def grade(im: Image.Image) -> Image.Image:
    w = GRADE["warmth"]
    r, g, b = im.split()
    im = Image.merge("RGB", (r.point(_lut(1 + w)), g, b.point(_lut(1 - w))))
    im = ImageEnhance.Contrast(im).enhance(GRADE["contrast"])
    im = ImageEnhance.Color(im).enhance(GRADE["saturation"])
    v = GRADE["vignette"]
    if v > 0:
        mask = Image.radial_gradient("L").resize(im.size, Image.BILINEAR)
        # 0 в центре → плавно к 255 у краёв; начало затемнения ~ на 45 % радиуса
        mask = mask.point([0 if i < 115 else min(255, round((i - 115) / 140 * 255)) for i in range(256)])
        mask = mask.filter(ImageFilter.GaussianBlur(max(im.size) / 10))
        dark = ImageEnhance.Brightness(im).enhance(1 - v)
        im = Image.composite(dark, im, mask)
    u = GRADE["unsharp"]
    im = im.filter(ImageFilter.UnsharpMask(radius=u["radius"], percent=u["percent"], threshold=u["threshold"]))
    return im


def save_webp(im: Image.Image, path: Path, max_bytes: int) -> tuple[int, int, bool]:
    """Кодирует WebP, снижая качество ступенями до max_bytes. Если и при q≈62 файл велик
    (очень мелкая фактура), слегка смягчает изображение и повторяет с более высоким q —
    это даёт меньший файл при лучшем виде, чем q<56. → (байты, качество, смягчено?)"""
    q = WEBP_QUALITY
    cand, softened = im, False
    while True:
        buf = io.BytesIO()
        cand.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= max_bytes or (q <= 56 and softened):
            break
        if q <= 62 and not softened:
            cand = im.filter(ImageFilter.GaussianBlur(0.8))
            softened = True
            q = WEBP_QUALITY - 8
            continue
        q -= 4
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf.getvalue())
    return buf.tell(), q, softened


def resolve(sel: dict, refresh: bool = False) -> dict:
    if sel["source"] == "commons":
        c = commons_file(sel["ref"], refresh=refresh)
    elif sel["source"] == "openverse":
        c = openverse_detail(sel["ref"], refresh=refresh)
    else:
        raise ValueError(sel["source"])
    if not c:
        raise RuntimeError(f"файл не найден: {sel['source']}:{sel['ref']}")
    ok, why = acceptable(c)
    if not ok:
        raise RuntimeError(f"{sel['ref']}: отклонено — {why}")
    return c


def source_image(c: dict, need_w: int, need_h: int) -> Image.Image:
    """Скачать файл достаточного размера: превью 2560 px от Commons, если хватает, иначе оригинал."""
    url = c["full"]
    if c["source"] == "commons" and c.get("thumb") and c["thumb"] != c["full"]:
        m = re.search(r"/(\d+)px-", c["thumb"])
        tw = int(m.group(1)) if m else 0
        th = round(tw * c["height"] / c["width"]) if tw else 0
        if tw >= need_w and th >= need_h:
            url = c["thumb"]
    data = http_get(url, binary=True)
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    return im.convert("RGB")


CHANGES_RU = ("кадрирование (4:3 и 1:1), уменьшение, лёгкая единая цветокоррекция (тёплый баланс, "
              "контраст, мягкая виньетка), удаление метаданных, конвертация в WebP")


def attribution_ru(c: dict) -> str:
    src = "Wikimedia Commons" if c["source"] == "commons" else "WordPress Photo Directory / Openverse"
    lic = c["license"]
    if lic == "Public domain":
        lic = "общественное достояние"
    return f"Фото: {c['author']}, {lic}, {src} · кадрировано, цветокоррекция"


def build_one(dish_id: str, sel: dict, names: dict[str, tuple[str, str]], refresh: bool = False) -> dict:
    c = resolve(sel, refresh=refresh)
    w, h = c["width"], c["height"]
    box_l, box_s = boxes_for(sel, w, h)
    short_l = min(box_l[2] - box_l[0], box_l[3] - box_l[1])
    short_s = min(box_s[2] - box_s[0], box_s[3] - box_s[1])
    if short_l < MIN_SHORT_SIDE:
        raise RuntimeError(f"{dish_id}: кадр 4:3 слишком мал ({short_l} px < {MIN_SHORT_SIDE})")
    if short_s < MIN_SHORT_SIDE_SQ:
        raise RuntimeError(f"{dish_id}: квадрат слишком мал ({short_s} px < {MIN_SHORT_SIDE_SQ})")

    need_w = math.ceil(LARGE[0] / ((box_l[2] - box_l[0]) / w))
    need_h = math.ceil(LARGE[1] / ((box_l[3] - box_l[1]) / h))
    im = source_image(c, need_w, need_h)
    sx, sy = im.width / w, im.height / h  # если скачано превью — масштаб относительно оригинала

    def scaled(b):
        return (round(b[0] * sx), round(b[1] * sy), round(b[2] * sx), round(b[3] * sy))

    large = grade(im.crop(scaled(box_l)).resize(LARGE, Image.LANCZOS))
    square = grade(im.crop(scaled(box_s)).resize(SQUARE, Image.LANCZOS))

    sub = OUT_DIR / sel["group"] if sel.get("group") else OUT_DIR
    rel = f"img/dishes/{sel['group'] + '/' if sel.get('group') else ''}"
    n_l, q_l, soft_l = save_webp(large, sub / f"{dish_id}.webp", MAX_BYTES_LARGE)
    n_s, q_s, soft_s = save_webp(square, sub / f"{dish_id}-sq.webp", MAX_BYTES_SQUARE)

    name, cuisine = names.get(dish_id, (dish_id, ""))
    entry = {
        "large": f"{rel}{dish_id}.webp",
        "square": f"{rel}{dish_id}-sq.webp",
        "width": LARGE[0], "height": LARGE[1],
        "name": name,
        "cuisine": cuisine,
        "source": c["source"],
        "source_page": c["page"],
        "original_url": c["full"],
        "original_title": c["title"],
        "author": c["author"],
        "license": c["license"],
        "license_url": c["license_url"] or c["page"],
        "attribution_ru": attribution_ru(c),
        "changes": CHANGES_RU,
        "derivative_license": c["license"] if c["license"].startswith("CC BY-SA") else None,
        "crop": {"large": box_l, "square": box_s, "source_size": [w, h]},
        "bytes": {"large": n_l, "square": n_s},
        "webp_quality": {"large": q_l, "square": q_s},
        "softened": soft_l or soft_s,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if sel.get("note"):
        entry["note"] = sel["note"]
    return entry


CUISINE_RU = {
    "kazakh": "Казахская", "central_asian": "Среднеазиатская", "uyghur": "Уйгурская", "uzbek": "Узбекская",
    "tatar": "Татарская", "russian": "Русская", "ukrainian": "Украинская", "caucasian": "Кавказская",
    "georgian": "Грузинская", "italian": "Итальянская", "japanese": "Японская", "american": "Американская",
    "mexican": "Мексиканская", "german": "Немецкая", "austrian": "Австрийская", "bavarian": "Баварская",
    "czech": "Чешская", "french": "Французская", "belgian": "Бельгийская", "irish": "Ирландская",
    "english": "Английская", "british": "Британская", "spanish": "Испанская", "indian": "Индийская",
    "thai": "Тайская", "vietnamese": "Вьетнамская", "chinese": "Китайская", "korean": "Корейская",
    "turkish": "Турецкая", "middle_eastern": "Ближневосточная", "argentinian": "Аргентинская",
    "international": "Интернациональная", "european": "Европейская", "asian": "Азиатская",
    "greek": "Греческая", "peruvian": "Перуанская", "latin_american": "Латиноамериканская",
}


def dish_names() -> dict[str, tuple[str, str]]:
    """id → (название по-русски, кухня по-русски) из data/dishes.json и, если есть, data/dishes_v2.json."""
    out: dict[str, tuple[str, str]] = {}
    p1 = ROOT / "data" / "dishes.json"
    if p1.exists():
        for d in json.loads(p1.read_text(encoding="utf-8")):
            out[d["id"]] = (d.get("display_name") or d.get("name") or d["id"], d.get("cuisine_label") or "")
    for rel in ("data/dishes_v2.json", "data/research/proposed_dishes.json"):
        p2 = ROOT / rel
        if not p2.exists():
            continue
        try:
            for d in json.loads(p2.read_text(encoding="utf-8")):
                cs = d.get("cuisine") or []
                c = cs[0] if isinstance(cs, list) and cs else (cs if isinstance(cs, str) else "")
                label = CUISINE_RU.get(c, c.replace("_", " ").capitalize() if c else "")
                if d["id"] not in out or not out[d["id"]][1]:
                    out[d["id"]] = (d.get("name") or out.get(d["id"], (d["id"], ""))[0], label or out.get(d["id"], ("", ""))[1])
        except (json.JSONDecodeError, KeyError, TypeError):
            pass
    out.setdefault("kumys", ("Кумыс", "Казахская"))
    out.setdefault("airan", ("Айран", "Казахская"))
    out.setdefault("shubat", ("Шубат", "Казахская"))
    return out


def load_existing() -> dict:
    if DATA_OUT.exists():
        try:
            return json.loads(DATA_OUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {}


def write_data(entries: dict, drinks: dict) -> None:
    by_source = Counter(e["source"] for e in entries.values())
    by_license = Counter(e["license"] for e in entries.values())
    meta = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "script": "scripts/fetch_dish_photos.py",
        "dishes_with_photo": len(entries),
        "traditional_drinks": len(drinks),
        "by_source": dict(by_source),
        "by_license": dict(by_license),
        "large": {"size": f"{LARGE[0]}x{LARGE[1]}", "format": "webp", "quality": WEBP_QUALITY, "max_bytes": MAX_BYTES_LARGE},
        "square": {"size": f"{SQUARE[0]}x{SQUARE[1]}", "format": "webp", "quality": WEBP_QUALITY, "max_bytes": MAX_BYTES_SQUARE},
        "grade": GRADE,
        "min_short_side_px": MIN_SHORT_SIDE,
        "allowed_licenses": ["CC0", "Public domain", "CC BY *", "CC BY-SA *"],
        "no_photo": NO_PHOTO,
        "note": "Производные файлы под CC BY-SA распространяются на условиях той же лицензии (derivative_license).",
    }
    out = {"_meta": meta, **dict(sorted(entries.items()))}
    if drinks:
        out["_traditional_drinks"] = dict(sorted(drinks.items()))
    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def cmd_build(ids: list[str], refresh: bool = False) -> None:
    existing = load_existing()
    entries = {k: v for k, v in existing.items() if not k.startswith("_")}
    drinks = dict(existing.get("_traditional_drinks") or {})
    # убрать записи, которых больше нет в SELECTION
    entries = {k: v for k, v in entries.items() if k in SELECTION and not SELECTION[k].get("group")}
    drinks = {k: v for k, v in drinks.items() if k in SELECTION and SELECTION[k].get("group")}
    todo = ids or list(SELECTION)
    names = dish_names()
    failed = []
    for dish_id in todo:
        sel = SELECTION.get(dish_id)
        if not sel:
            print(f"!! {dish_id}: нет в SELECTION", file=sys.stderr)
            failed.append(dish_id)
            continue
        try:
            e = build_one(dish_id, sel, names, refresh=refresh)
        except Exception as ex:  # noqa: BLE001
            print(f"!! {dish_id}: {ex}", file=sys.stderr)
            failed.append(dish_id)
            continue
        (drinks if sel.get("group") else entries)[dish_id] = e
        print(f"ok {dish_id:<24} {e['license']:<14} {e['bytes']['large']//1024:>4} KB / {e['bytes']['square']//1024:>3} KB  {e['author'][:40]}")
    write_data(entries, drinks)
    # удалить файлы блюд, которых больше нет в SELECTION (переименования, отказ от фото)
    if not ids:
        for f in OUT_DIR.rglob("*.webp"):
            stem = f.name[:-len("-sq.webp")] if f.name.endswith("-sq.webp") else f.stem
            sel = SELECTION.get(stem)
            expected = OUT_DIR / (sel["group"] or "") / f.name if sel else None
            if expected is None or expected.resolve() != f.resolve():
                f.unlink()
                print(f"— удалён лишний файл {f.relative_to(ROOT)}")
    print(f"— записано {len(entries)} блюд + {len(drinks)} напитков → {DATA_OUT.relative_to(ROOT)}")
    if failed:
        print(f"— не собраны: {', '.join(failed)}", file=sys.stderr)
        sys.exit(1)


def cmd_preview(ids: list[str]) -> None:
    out_dir = CACHE / "preview"
    out_dir.mkdir(parents=True, exist_ok=True)
    for dish_id in ids:
        sel = SELECTION.get(dish_id)
        if not sel:
            print(f"!! {dish_id}: нет в SELECTION", file=sys.stderr)
            continue
        try:
            c = resolve(sel)
        except Exception as ex:  # noqa: BLE001
            print(f"!! {dish_id}: {ex}", file=sys.stderr)
            continue
        w, h = c["width"], c["height"]
        im = source_image(c, 1, 1)  # хватит превью
        sx, sy = im.width / w, im.height / h
        im.thumbnail((1400, 1400), Image.LANCZOS)
        sx, sy = im.width / w, im.height / h
        draw = ImageDraw.Draw(im)
        box_l, box_s = boxes_for(sel, w, h)
        for b, col in ((box_l, (229, 184, 73)), (box_s, (111, 168, 207))):
            draw.rectangle((b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy), outline=col, width=3)
        font = load_font(16)
        for i in range(1, 10):
            draw.line((im.width * i / 10, 0, im.width * i / 10, im.height), fill=(255, 255, 255, 60), width=1)
            draw.line((0, im.height * i / 10, im.width, im.height * i / 10), fill=(255, 255, 255, 60), width=1)
            draw.text((im.width * i / 10 + 2, 2), f"{i/10:.1f}", fill=(255, 255, 255), font=font)
            draw.text((2, im.height * i / 10 + 2), f"{i/10:.1f}", fill=(255, 255, 255), font=font)
        im.save(out_dir / f"{dish_id}.jpg", quality=82)
        print(f"{dish_id}: {w}×{h} {c['license']} {c['title']} → {out_dir / (dish_id + '.jpg')}")


def cmd_sheets(per_sheet: int = 24, cols: int = 6) -> None:
    files = sorted(p for p in OUT_DIR.glob("*.webp") if not p.name.endswith("-sq.webp"))
    if not files:
        raise SystemExit("нет собранных фото")
    SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    for old in SHEETS_DIR.glob("contact-sheet-*.png"):
        old.unlink()
    montage = shutil.which("montage")
    n = 0
    for i in range(0, len(files), per_sheet):
        chunk = files[i:i + per_sheet]
        n += 1
        out = SHEETS_DIR / f"contact-sheet-{n}.png"
        if montage:
            cmd = [montage, "-font", "Liberation-Sans", "-pointsize", "15", "-fill", "#D6CBB8", "-background", "#0B0806",
                   "-label", "%t", "-tile", f"{cols}x", "-geometry", "300x225+8+8",
                   *[str(p) for p in chunk], "-depth", "8", f"PNG24:{out}"]
            subprocess.run(cmd, check=True)
        else:
            items = [(Image.open(p).convert("RGB"), p.stem) for p in chunk]
            contact_sheet(items, cols=cols, cell=(300, 225), label_h=22, fit="cover").save(out)
        print(f"→ {out.relative_to(ROOT)} ({len(chunk)} фото)")


def cmd_check() -> None:
    bad = 0
    for dish_id, sel in SELECTION.items():
        try:
            c = resolve(sel, refresh=True)
            print(f"ok {dish_id:<24} {c['license']:<14} {c['title'][:60]}")
        except Exception as ex:  # noqa: BLE001
            bad += 1
            print(f"!! {dish_id}: {ex}")
    sys.exit(1 if bad else 0)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("candidates"); p.add_argument("ids", nargs="*"); p.add_argument("--limit", type=int, default=16)
    p = sub.add_parser("preview"); p.add_argument("ids", nargs="+")
    p = sub.add_parser("build"); p.add_argument("ids", nargs="*"); p.add_argument("--refresh", action="store_true")
    sub.add_parser("sheets")
    sub.add_parser("check")
    a = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    if a.cmd == "candidates":
        cmd_candidates(a.ids or list(QUERIES), a.limit)
    elif a.cmd == "preview":
        cmd_preview(a.ids)
    elif a.cmd == "build":
        cmd_build(a.ids, refresh=a.refresh)
    elif a.cmd == "sheets":
        cmd_sheets()
    elif a.cmd == "check":
        cmd_check()


if __name__ == "__main__":
    main()
