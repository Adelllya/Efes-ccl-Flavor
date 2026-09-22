"""
Management command: python manage.py load_flavor_data
Загружает 17 сортов пива из fixtures/brands_seed.csv и наполняет вкусовые пирамиды
на основе Flavor_Tree_Beer_Data_Draft.md.
"""

import csv
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from api.models import FlavorNote, Brand, FlavorProfile, ServingRecommendation, Course, TeamMember


NOTES_DEFINITIONS = [
    # TOP
    {"name": "Свежесть", "technical_term": "Freshness / Crisp", "category": "TOP", "icon": "🌿", "description": "Яркое ощущение свежести, чистоты и прохлады при первом глотке"},
    {"name": "Хмелевой аромат", "technical_term": "Hop Aroma", "category": "TOP", "icon": "🍃", "description": "Свежий аромат благородного хмеля (травянистый, смолистый)"},
    {"name": "Цветочные ноты", "technical_term": "Floral / Linalool", "category": "TOP", "icon": "🌸", "description": "Тонкие оттенки луговых цветов, жасмина, цитрусового цвета"},
    {"name": "Лёгкий хмель", "technical_term": "Light Hop", "category": "TOP", "icon": "🌱", "description": "Деликатный, ненавязчивый хмелевой оттенок"},
    {"name": "Искрящаяся карбонация", "technical_term": "Effervescence / Carbonation", "category": "TOP", "icon": "✨", "description": "Искрящиеся покалывающие пузырьки газа, освежающие рецепторы"},
    {"name": "Спиртовая теплота", "technical_term": "Alcoholic / Warming", "category": "TOP", "icon": "🔥", "description": "Согревающее ощущение этанола, характерное для крепких сортов"},
    {"name": "Котловой хмель", "technical_term": "Kettle Hop", "category": "TOP", "icon": "🫖", "description": "Глубокий хмелевой аромат многоэтапного охмеления в сусловарочном котле"},
    {"name": "Цитрусовый аромат", "technical_term": "Citrus / Myrcene", "category": "TOP", "icon": "🍋", "description": "Яркие ноты цедры лимона, грейпфрута или апельсина"},
    {"name": "Фруктовые эфиры", "technical_term": "Fruity Esters", "category": "TOP", "icon": "🍎", "description": "Фруктовые оттенки зеленого яблока, груши или банана"},

    # HEART
    {"name": "Солод", "technical_term": "Malty", "category": "HEART", "icon": "🌾", "description": "Сладковато-зерновой, хлебный фундамент пива из ячменного солода"},
    {"name": "Солодовая плотность", "technical_term": "Rich Malt", "category": "HEART", "icon": "🍞", "description": "Глубокое, округлое солодовое тело напитка"},
    {"name": "Зерновые ноты", "technical_term": "Grainy / Cereal", "category": "HEART", "icon": "🥣", "description": "Оттенки свежего зерна, солодовой муки, ячменных хлопьев"},
    {"name": "Карамель", "technical_term": "Caramel / Maltol", "category": "HEART", "icon": "🍯", "description": "Сладкие ноты жженого сахара, тоффи и карамельного солода"},
    {"name": "Рисовые ноты", "technical_term": "Rice / Dry Cereal", "category": "HEART", "icon": "🍚", "description": "Легкий сухой рисовый профиль, придающий воздушность и нейтральную чистоту"},
    {"name": "Сладость", "technical_term": "Sweetness", "category": "HEART", "icon": "🍬", "description": "Мягкая натуральная сладость несброженных сахаров"},
    {"name": "Сусло (Worty)", "technical_term": "Worty", "category": "HEART", "icon": "🌾", "description": "Свежий аромат варочного цеха и теплого пивного сусла"},
    {"name": "Мягкий баланс солода", "technical_term": "Smooth Malt Balance", "category": "HEART", "icon": "🥖", "description": "Идеально сбалансированное, бархатистое солодовое сердце"},
    {"name": "Обжаренный солод", "technical_term": "Roasty / 2-Acetylpyridine", "category": "HEART", "icon": "☕", "description": "Кофейно-шоколадный характер темного прожаренного солода"},
    {"name": "Шоколад", "technical_term": "Chocolate / Pyrazines", "category": "HEART", "icon": "🍫", "description": "Ноты горького темного какао и шоколада"},

    # BASE
    {"name": "Хмелевая горчинка", "technical_term": "Hop Bitterness / Iso-alpha", "category": "BASE", "icon": "⚡", "description": "Благородная освежающая горечь изо-альфа-кислот хмеля"},
    {"name": "Освежающий финиш", "technical_term": "Refreshing Finish", "category": "BASE", "icon": "❄️", "description": "Быстрое, сухое и чистое завершение глотка, зовущее к следующему"},
    {"name": "Умеренная горечь", "technical_term": "Mild Bitterness", "category": "BASE", "icon": "🌿", "description": "Мягкая, сглаженная горчинка без резкости"},
    {"name": "Чистый финиш", "technical_term": "Clean Finish", "category": "BASE", "icon": "🫧", "description": "Кристально чистое послевкусие без посторонних привкусов"},
    {"name": "Сбалансированный финиш", "technical_term": "Balanced Finish", "category": "BASE", "icon": "⚖️", "description": "Гармоничный баланс между мягким солодом и тонким хмелем"},
    {"name": "Хмелевое послевкусие", "technical_term": "Hoppy Aftertaste", "category": "BASE", "icon": "🍃", "description": "Долгое приятное травянисто-хмелевое эхо"},
    {"name": "Динамичная горечь", "technical_term": "Crisp Dynamic Bitterness", "category": "BASE", "icon": "🎯", "description": "Яркая, бодрящая горчинка с быстрым развитием"},
    {"name": "Тонкая сладость финиша", "technical_term": "Sweet Finish", "category": "BASE", "icon": "🍯", "description": "Едва уловимая карамельно-солодовая сладость в финале"},
    {"name": "Классическая горечь", "technical_term": "Classic Bitterness", "category": "BASE", "icon": "🍺", "description": "Традиционная лагерная горчинка, выверенная годами"},
    {"name": "Тело и плотность (Body)", "technical_term": "Mouthfeel / Body", "category": "BASE", "icon": "🧱", "description": "Ощущение весомости, плотности и густоты напитка во рту"},
    {"name": "Янтарная сладость", "technical_term": "Amber Sweetness", "category": "BASE", "icon": "🍂", "description": "Мягкое послевкусие венского и янтарного солода"},
    {"name": "Мягкий финиш", "technical_term": "Smooth Finish", "category": "BASE", "icon": "🕊️", "description": "Округлый, бархатистый и шелковистый сход вкуса"},
]


# Пирамида для каждого из 17 сортов: (слой, имя_ноты, интенсивность 1-10, заметка)
PYRAMID_DRAFT = {
    "Кружка Свежего": [
        ("TOP", "Свежесть", 6, "Яркий свежий вдох разливного формата"),
        ("TOP", "Хмелевой аромат", 4, "Тонкий хмелевой акцент"),
        ("HEART", "Солод", 5, "Классический ячменный солод"),
        ("BASE", "Умеренная горечь", 4, "Мягкая приятная горчинка"),
        ("BASE", "Освежающий финиш", 5, "Быстрое утоление жажды"),
    ],
    "Белый Медведь": [
        ("TOP", "Свежесть", 5, "Чистый освежающий старт"),
        ("HEART", "Зерновые ноты", 5, "Ярко выраженное зерновое тело"),
        ("HEART", "Солод", 4, "Мягкая солодовая сладость"),
        ("BASE", "Умеренная горечь", 4, "Сдержанная классическая горчинка"),
    ],
    "Efes Pilsener": [
        ("TOP", "Хмелевой аромат", 6, "Благородный хмель европейского типа"),
        ("TOP", "Цветочные ноты", 4, "Изящные цветочные тона"),
        ("HEART", "Солодовая плотность", 6, "Полнотелый насыщенный солод"),
        ("BASE", "Хмелевая горчинка", 7, "Выразительная пилснеровская горечь"),
        ("BASE", "Освежающий финиш", 7, "Фирменное сухое послевкусие Efes"),
    ],
    "Miller Genuine Draft": [
        ("TOP", "Свежесть", 7, "Исключительная легкость холодной фильтрации"),
        ("TOP", "Лёгкий хмель", 3, "Очень деликатный хмель"),
        ("HEART", "Зерновые ноты", 3, "Мягкий кукурузно-ячменный профиль"),
        ("BASE", "Умеренная горечь", 3, "Едва заметная горчинка"),
        ("BASE", "Чистый финиш", 6, "Кристально чистое послевкусие"),
    ],
    "Velkopopovický Kozel": [
        ("TOP", "Хмелевой аромат", 5, "Чешский ароматный хмель"),
        ("HEART", "Солод", 7, "Глубокая солодовая основа"),
        ("HEART", "Карамель", 3, "Оттенки карамелизованного солода"),
        ("BASE", "Хмелевая горчинка", 5, "Благородная чешская горечь"),
        ("BASE", "Сбалансированный финиш", 5, "Классический велкопоповицкий баланс"),
    ],
    "Bremen von Lustig": [
        ("TOP", "Искрящаяся карбонация", 7, "Яркая игра пузырьков и свежесть"),
        ("BASE", "Хмелевая горчинка", 6, "Характерная немецкая горчинка"),
        ("BASE", "Хмелевое послевкусие", 6, "Стойкое хмелевое послевкусие"),
    ],
    "Bavaria": [
        ("TOP", "Свежесть", 5, "Голландская минеральная чистота"),
        ("HEART", "Солод", 4, "Легкое солодовое зерно"),
        ("BASE", "Умеренная горечь", 3, "Очень мягкий сход вкуса"),
    ],
    "Wùkōng Jū (悟空居)": [
        ("TOP", "Свежесть", 4, "Легкая восточная свежесть"),
        ("HEART", "Рисовые ноты", 5, "Характерная рисовая сухость и шелковистость"),
        ("HEART", "Сладость", 4, "Тонкая рисовая сладость"),
        ("BASE", "Сбалансированный финиш", 3, "Мягкий сбалансированный финиш"),
    ],
    "Карагандинское": [
        ("TOP", "Свежесть", 4, "Знакомая классическая свежесть"),
        ("HEART", "Зерновые ноты", 4, "Казахстанский ячменный характер"),
        ("BASE", "Динамичная горечь", 5, "Динамичная бодрящая горчинка"),
    ],
    "Slavna ПРАГА": [
        ("TOP", "Хмелевой аромат", 5, "Жатецкий хмель"),
        ("TOP", "Цветочные ноты", 3, "Цветочный букет"),
        ("HEART", "Солод", 6, "Золотистый плотный солод"),
        ("HEART", "Сусло (Worty)", 4, "Сладковатое сусло"),
        ("BASE", "Тонкая сладость финиша", 4, "Тонкая сладость послевкусия"),
    ],
    "Жигулевское": [
        ("TOP", "Свежесть", 4, "Легкая свежесть традиционного лагера"),
        ("HEART", "Зерновые ноты", 5, "Добротный солодовый вкус"),
        ("BASE", "Классическая горечь", 5, "Классическая ностальгическая горечь"),
    ],
    "Хмельной Лось": [
        ("TOP", "Спиртовая теплота", 6, "Согревающее алкогольное дыхание (7.3%)"),
        ("HEART", "Солодовая плотность", 6, "Густое солодовое тело"),
        ("BASE", "Хмелевая горчинка", 6, "Мощная выраженная горечь"),
        ("BASE", "Тело и плотность (Body)", 7, "Массивное плотное тело"),
    ],
    "Северное Сияние": [
        ("TOP", "Свежесть", 6, "Кристальная северная свежесть"),
        ("TOP", "Лёгкий хмель", 4, "Натуральные хмелевые ноты"),
        ("HEART", "Солод", 5, "Премиальный отборный солод"),
        ("BASE", "Освежающий финиш", 5, "Чистый освежающий финал"),
    ],
    "Легенда 777": [
        ("TOP", "Хмелевой аромат", 4, "Легкий хмель"),
        ("HEART", "Карамель", 5, "Янтарная карамель"),
        ("HEART", "Солод", 5, "Подрумяненный солод"),
        ("BASE", "Янтарная сладость", 4, "Мягкая сладость янтаря"),
        ("BASE", "Хмелевая горчинка", 4, "Сбалансированная горечь"),
    ],
    "13 регион": [
        ("TOP", "Свежесть", 6, "Южная свежесть"),
        ("HEART", "Зерновые ноты", 4, "Светлое зерно"),
        ("BASE", "Умеренная горечь", 4, "Легкая питкая горечь"),
    ],
    "Старый мельник (из бочонка)": [
        ("TOP", "Хмелевой аромат", 7, "Ароматный хмель позднего охмеления"),
        ("TOP", "Котловой хмель", 5, "Котловое охмеление трех сортов"),
        ("HEART", "Мягкий баланс солода", 5, "Бархатный баланс солода"),
        ("BASE", "Умеренная горечь", 5, "Умеренная благородная горечь"),
        ("BASE", "Мягкий финиш", 6, "Мягкий бочоночный финиш"),
    ],
    "Бочковое": [
        ("TOP", "Свежесть", 5, "Ощущение свеженакатанной бочки"),
        ("TOP", "Лёгкий хмель", 4, "Мягкий хмелевой штрих"),
        ("HEART", "Солод", 4, "Легкое солодовое зерно"),
        ("BASE", "Хмелевое послевкусие", 5, "Мягкое хмелевое послевкусие"),
    ],
}


# ═══════════════════════════════════════════════════════════════════════════════
#  ФОТО БУТЫЛОК
#  Файлы уже лежат в MEDIA_ROOT (media/brands/ и media/brands/hd/), поэтому
#  достаточно записать путь в ImageField — копировать ничего не нужно.
#  image    — лёгкий PNG 240x430 для карточек каталога и списков.
#  image_hd — крупный PNG для страницы сорта; если нет, там берётся image.
# ═══════════════════════════════════════════════════════════════════════════════

BRAND_IMAGES = {
    "Кружка Свежего":              ("brands/Kruzhka_Svezhevo.png",    "brands/hd/kruzhka_svezhego_hd.png"),
    "Белый Медведь":               ("brands/Belyi_Medved.png",        "brands/hd/belyi_medved_hd.png"),
    "Efes Pilsener":               ("brands/Efes_Pilsener.png",       "brands/hd/efes_pilsener_hd.png"),
    "Miller Genuine Draft":        ("brands/Miller.png",              "brands/hd/miller_hd.png"),
    "Velkopopovický Kozel":        ("brands/Kozel.png",               "brands/hd/kozel_hd.png"),
    "Bremen von Lustig":           ("brands/Bremen.png",              "brands/hd/bremen_hd.png"),
    "Bavaria":                     ("brands/Bavaria.png",             "brands/hd/bavaria_hd.png"),
    "Wùkōng Jū (悟空居)":           ("brands/WuKong.png",              "brands/hd/wukong_hd.png"),
    "Карагандинское":              ("brands/Karagandinskoe.png",      "brands/hd/karagandinskoe_hd.png"),
    "Slavna ПРАГА":                ("brands/Slavna_ПРАГА.png",        "brands/hd/praga_hd.png"),
    "Жигулевское":                 ("brands/Zhigulevskoe.png",        "brands/hd/zhigulevskoe_hd.png"),
    "Хмельной Лось":               ("brands/Khmelnyi_los.png",        "brands/hd/khmelnoy_los_hd.png"),
    "Северное Сияние":             ("brands/Severnoye_Syiyanyie.png", "brands/hd/severnoe_siyanie_hd.png"),
    "Легенда 777":                 ("brands/777_razliv.png",          "brands/hd/legenda_777_hd.png"),
    "13 регион":                   ("brands/13_region.png",           "brands/hd/13_region_hd.png"),
    "Старый мельник (из бочонка)": ("brands/Melnik.png",              ""),
    "Бочковое":                    ("brands/Bochkovoe.png",           ""),
}

# Подложка страницы сорта: цвет снимаем с самой бутылки, чтобы фон не спорил с этикеткой.
BRAND_ACCENTS = {
    "Кружка Свежего": "#C98A2B",
    "Белый Медведь": "#8FA9C4",
    "Efes Pilsener": "#1F3F8F",
    "Miller Genuine Draft": "#B8892F",
    "Velkopopovický Kozel": "#D8A32B",
    "Bremen von Lustig": "#9C6B24",
    "Bavaria": "#C2453B",
    "Wùkōng Jū (悟空居)": "#C0392B",
    "Карагандинское": "#A2551C",
    "Slavna ПРАГА": "#C08B2E",
    "Жигулевское": "#B5762A",
    "Хмельной Лось": "#5C4A2E",
    "Северное Сияние": "#2E6E8E",
    "Легенда 777": "#B4561A",
    "13 регион": "#2F7A46",
    "Старый мельник (из бочонка)": "#8A5A22",
    "Бочковое": "#A3702A",
}


def media_exists(rel_path):
    """Не записываем в базу путь к файлу, которого нет на диске."""
    if not rel_path:
        return False
    return (Path(settings.MEDIA_ROOT) / rel_path).exists()


# ═══════════════════════════════════════════════════════════════════════════════
#  ЧЕТЫРЕ СТУПЕНИ ШКОЛЫ
#  Подзаголовок «Академии» обещает 4 ступени, поэтому они должны быть в базе:
#  без них страница открывалась пустой. Цвета — из янтарной палитры сайта.
# ═══════════════════════════════════════════════════════════════════════════════

COURSE_LEVELS = [
    {
        "level": 1,
        "title": "Первый глоток",
        "description": "Что такое лагер, эль и пшеничное. Крепость, плотность, карбонизация. "
                       "Учимся описывать напиток словами, а не «вкусно / невкусно».",
        "color": "#F59E0B",
        "required_score": 0,
    },
    {
        "level": 2,
        "title": "Три слоя вкуса",
        "description": "Разбираем пирамиду: Top за 3 секунды, Heart до 15-й, Base в послевкусии. "
                       "Отличаем хмелевую горечь от солодовой сладости и ловим off-flavour.",
        "color": "#D97706",
        "required_score": 25,
    },
    {
        "level": 3,
        "title": "Пиво и еда",
        "description": "Четыре принципа сочетания: Contrast, Complement, Cleanse, Bridge. "
                       "Температура подачи, бокал, порядок подачи блюд в зале.",
        "color": "#B45309",
        "required_score": 50,
    },
    {
        "level": 4,
        "title": "Сомелье зала",
        "description": "Слепая дегустация, лексикон FlavorActiV, работа с гостем и картой бара. "
                       "Финал: собрать гастропару под меню заведения и защитить её.",
        "color": "#92400E",
        "required_score": 80,
    },
]


class Command(BaseCommand):
    help = "Загружает 17 сортов пива из brands_seed.csv и наполняет вкусовые пирамиды"

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write("1. Создание/обновление вкусовых нот...")
        note_map = {}
        for idx, nd in enumerate(NOTES_DEFINITIONS):
            note, _ = FlavorNote.objects.update_or_create(
                name=nd["name"],
                defaults={
                    "technical_term": nd["technical_term"],
                    "category": nd["category"],
                    "icon": nd["icon"],
                    "description": nd["description"],
                    "sort_order": idx + 1,
                }
            )
            note_map[nd["name"]] = note

        self.stdout.write(f"   ✓ Создано/обновлено {len(note_map)} нот")

        self.stdout.write("2. Загрузка 17 брендов из brands_seed.csv...")
        csv_path = Path(__file__).resolve().parent.parent.parent / "fixtures" / "brands_seed.csv"
        
        # Очистим бренды, которых нет в списке 17
        allowed_names = list(PYRAMID_DRAFT.keys())
        Brand.objects.exclude(name__in=allowed_names).delete()

        brands_count = 0
        profiles_count = 0
        images_count = 0

        with open(csv_path, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row["name"].strip()
                brand_owner = row.get("brand_owner", "").strip()
                style = row.get("style", "Lager").strip()
                abv_raw = row.get("abv", "").strip()
                abv = float(abv_raw) if abv_raw else None
                packaging_type = row.get("packaging_type", "BOTTLE").strip()
                is_horeca = row.get("is_horeca_only", "False").strip().lower() in ("true", "1", "yes")
                description = row.get("description", "").strip()

                image, image_hd = BRAND_IMAGES.get(name, ("", ""))
                defaults = {
                    "brand_owner": brand_owner,
                    "style": style,
                    "abv": abv,
                    "packaging_type": packaging_type,
                    "is_horeca_only": is_horeca,
                    "description": description,
                    "is_active": True,
                    "accent_color": BRAND_ACCENTS.get(name, ""),
                }
                if media_exists(image):
                    defaults["image"] = image
                    images_count += 1
                if media_exists(image_hd):
                    defaults["image_hd"] = image_hd

                brand, created = Brand.objects.update_or_create(name=name, defaults=defaults)
                brands_count += 1

                # Настройка рекомендаций по подаче
                is_draft = packaging_type == "DRAFT"
                is_strong = (abv or 0) >= 7.0
                ServingRecommendation.objects.update_or_create(
                    brand=brand,
                    defaults={
                        "serving_temp_min": 8.0 if is_strong else (4.0 if is_draft else 5.0),
                        "serving_temp_max": 12.0 if is_strong else (7.0 if is_draft else 8.0),
                        "glass_type": "Тюльпан / Снифтер" if is_strong else ("Кружка / Бокал для разливного" if is_draft else "Пилснер / Пинта"),
                        "seasonality": "Круглый год",
                    }
                )

                # Наполнение вкусовой пирамиды
                if name in PYRAMID_DRAFT:
                    # Очистим старые профили для этого бренда
                    FlavorProfile.objects.filter(brand=brand).delete()
                    for layer, note_name, intensity, sommelier_note in PYRAMID_DRAFT[name]:
                        note_obj = note_map.get(note_name)
                        if not note_obj:
                            # Попробуем найти в БД
                            note_obj = FlavorNote.objects.filter(name__icontains=note_name).first()
                        if note_obj:
                            FlavorProfile.objects.create(
                                brand=brand,
                                flavor_note=note_obj,
                                layer=layer,
                                intensity=intensity,
                                sommelier_note=sommelier_note,
                                sommelier_name="Главный Сомелье Efes",
                            )
                            profiles_count += 1

        self.stdout.write(f"   ✓ Загружено {brands_count} брендов")
        self.stdout.write(f"   ✓ Прикреплено {images_count} фото бутылок из media/brands/")
        self.stdout.write(f"   ✓ Создано {profiles_count} вкусовых связей пирамиды")

        self.stdout.write("3. Загрузка 50 блюд для Food Pairing из dishes_50.csv...")
        from api.models import Dish
        dishes_csv_path = Path(__file__).resolve().parent.parent.parent / "fixtures" / "dishes_50.csv"
        dishes_count = 0

        with open(dishes_csv_path, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row["name"].strip()
                cuisine = row.get("cuisine", "KZ").strip()
                category = row.get("category", "Основное").strip()
                dominant_taste = row.get("dominant_taste", "UMAMI").strip()
                weight = row.get("weight", "MEDIUM").strip()
                fat_level = row.get("fat_level", "MEDIUM").strip()
                cooking_method = row.get("cooking_method", "GRILLED").strip()
                description = row.get("description", "").strip()

                Dish.objects.update_or_create(
                    name=name,
                    defaults={
                        "cuisine": cuisine,
                        "category": category,
                        "dominant_taste": dominant_taste,
                        "weight": weight,
                        "fat_level": fat_level,
                        "cooking_method": cooking_method,
                        "description": description,
                    }
                )
                dishes_count += 1

        self.stdout.write(f"   ✓ Загружено {dishes_count} блюд (Казахская, Итальянская, Японская, Американская, Мексиканская, Немецкая)")

        self.stdout.write("4. Загрузка матрицы Food Pairing (51 пара)...")
        from django.core.management import call_command
        call_command("load_food_pairings")

        self.stdout.write("5. Загрузка 4 ступеней Школы сомелье...")
        for course in COURSE_LEVELS:
            Course.objects.update_or_create(level=course["level"], defaults=course)
        self.stdout.write(f"   ✓ Загружено {len(COURSE_LEVELS)} ступеней")

        self.stdout.write(self.style.SUCCESS(
            "✅ Успешно загружены 17 сортов с фото, вкусовые пирамиды, 50 блюд, "
            "51 пара Food Pairing и 4 ступени школы!"
        ))
