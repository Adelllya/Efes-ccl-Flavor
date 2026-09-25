"""
Публичные данные, которые видит гость: команда, программа школы, подпись под черновыми
пирамидами, крепость и фото 17 сортов, демо-заведение.

Здесь только то, что правда сегодня. Состав команды взят из README.md. Крепость сортов
берётся из каталога движка (data/engine/drinks.json): у 17 сортов там есть legacy_brand_id
и источник числа: ритейлер, этикетка или оценка по стилю. Фото сортов лежат в media/brands,
пути к ним в data/media_map.json.

seed и load_flavor_data заливают данные отсюда. Уже заполненную базу, например на проде,
приводит к ним команда update_public_content: она ничего не удаляет, кроме
выдуманных «экспертов» из старого seed.
"""
import json
import logging
from functools import lru_cache
from pathlib import Path

from django.conf import settings

from .models import Brand, Course, FlavorNote, FlavorProfile, FoodPairing, TeamMember, Venue
from .pairing.dataset import DATA_DIR

log = logging.getLogger(__name__)

TEAM = [
    {'name': 'Аджибаева Аделия', 'role': 'Сооснователь', 'bio': 'Разработчик Flavor Tree: сайт, сервер и данные.'},
    {'name': 'Абуталифулы Ералы', 'role': 'Сооснователь', 'bio': 'Разработчик Flavor Tree: сайт, сервер и данные.'},
]

# Люди из старого seed, которых нет в команде. update_public_content удаляет только их.
INVENTED_TEAM = ('Айгерим Нурланова', 'Дамир Сапаров', 'Елена Коваль', 'Тимур Ахметов', 'Главный Сомелье Efes')

# Программа школы. Курсы ещё не готовы, на сайте они помечены «Скоро».
COURSES = [
    {'level': 1, 'title': 'Первое знакомство', 'color': '#f59e0b',
     'description': 'Стили пива, крепость и плотность. Как пробовать и на что обращать внимание в первом глотке.'},
    {'level': 2, 'title': 'Вкусовая пирамида', 'color': '#84cc16',
     'description': 'Верхние ноты, сердце и послевкусие: как раскрывается глоток и чем хмель отличается от солода.'},
    {'level': 3, 'title': 'Пиво и еда', 'color': '#0ea5e9',
     'description': 'Четыре типа сочетаний: дополняет, контраст, очищает и мостик. Температура подачи и бокал.'},
    {'level': 4, 'title': 'Подбор для гостей', 'color': '#8b5cf6',
     'description': 'Дегустация вслепую, описание вкуса по колесу вкусов пива и подбор напитка к блюдам из меню заведения.'},
]

# Пирамиды 17 сортов пока черновик команды, сомелье их не проверял.
DRAFT_AUTHOR = 'Команда Flavor Tree'
INVENTED_AUTHORS = ('Главный Сомелье Efes', 'Айгерим Нурланова')

# Старые названия нот с английской подписью в скобках -> как их показывать гостю.
RENAMED_NOTES = {
    'Сусло (Worty)': 'Сусло',
    'Тело и плотность (Body)': 'Тело и плотность',
}

# Значения старого seed без источника: у Efes Pilsener плотность «11.8% плато» никто не проверял.
UNSOURCED_BRAND_FIELDS = {'Efes Pilsener': {'density': '11.8% плато'}}

# Объяснения пар с английскими словами: старый текст -> как в fixtures/food_pairings.csv сейчас.
PAIRING_TEXT_FIXES = {
    'Высокая base-горечь пильзнера режет жирность вяленого мяса':
        'Выраженная горечь в послевкусии пильзнера режет жирность вяленого мяса',
}

DEMO_VENUE_SLUG = 'efes-beer-garden'
DEMO_VENUE_NAME = 'Демо-бар Flavor Tree'
DEMO_VENUE_DESCRIPTION = 'Демонстрационное заведение Flavor Tree: меню и цены условные, это пример, а не настоящий бар.'
# Заглушки старого seed_roles: выдуманные адрес и телефон. Настоящие данные заведения не трогаем.
DEMO_PLACEHOLDERS = {'name': 'Efes Beer Garden', 'address': 'пр. Достык 100', 'phone': '+7 727 000 00 00'}

MEDIA_MAP_PATH = Path(settings.BASE_DIR) / 'data' / 'media_map.json'


def _drinks_path():
    data_dir = str(getattr(settings, 'FLAVOR_DATA_DIR', '') or '') or DATA_DIR
    return Path(data_dir) / 'drinks.json'


@lru_cache(maxsize=1)
def engine_brand_facts():
    """Название сорта -> {'abv', 'abv_estimated'} по записям каталога движка с legacy_brand_id."""
    try:
        with open(_drinks_path(), encoding='utf-8') as f:
            records = json.load(f)
    except (OSError, ValueError):
        log.warning('drinks.json не прочитан, крепость сортов не дополняется')
        return {}
    facts = {}
    for d in records if isinstance(records, list) else []:
        if not isinstance(d, dict) or not d.get('legacy_brand_id') or not d.get('name'):
            continue
        abv = d.get('abv')
        flags = d.get('flags') or {}
        facts[d['name']] = {
            'abv': float(abv) if isinstance(abv, (int, float)) else None,
            # Производитель крепость не публикует, в каталоге она принята по стилю.
            'abv_estimated': d.get('abv_source') == 'estimate' or bool(flags.get('abv_unknown')),
        }
    return facts


def abv_is_estimate(brand):
    """True, если у сорта стоит крепость-оценка из каталога, а не число с этикетки."""
    fact = engine_brand_facts().get(brand.name)
    if not fact or not fact['abv_estimated'] or brand.abv is None or fact['abv'] is None:
        return False
    return abs(brand.abv - fact['abv']) < 1e-6


def _media_map():
    try:
        return json.loads(MEDIA_MAP_PATH.read_text(encoding='utf-8')).get('brands', {})
    except (OSError, ValueError):
        return {}


def _is_placeholder(field):
    name = str(getattr(field, 'name', '') or '')
    return not name or 'placehold.co' in name


def backfill_brands():
    """Пустую крепость берёт из каталога движка, пустое фото из media_map. Заполненное не трогает,
    кроме значений старого seed без источника.

    update() вместо save(): save() пересобирает миниатюры, а на Vercel диск только для чтения.
    """
    facts = engine_brand_facts()
    media = _media_map()
    media_root = Path(settings.MEDIA_ROOT)
    abv_filled = images_filled = 0
    for brand in Brand.objects.filter(name__in=set(facts) | set(media) | set(UNSOURCED_BRAND_FIELDS)):
        changes = {}
        fact = facts.get(brand.name)
        if brand.abv is None and fact and fact['abv'] is not None:
            changes['abv'] = fact['abv']
        for field, path in media.get(brand.name, {}).items():
            if field in ('image', 'image_hd') and _is_placeholder(getattr(brand, field)) \
                    and (media_root / path).is_file():
                changes[field] = path
        for field, value in UNSOURCED_BRAND_FIELDS.get(brand.name, {}).items():
            if getattr(brand, field) == value:
                changes[field] = ''
        if changes:
            Brand.objects.filter(pk=brand.pk).update(**changes)
            abv_filled += 'abv' in changes
            images_filled += 'image' in changes
    return {'abv': abv_filled, 'images': images_filled}


def rename_notes():
    """Переименовывает ноты с английской подписью, если нового имени ещё нет. Связи с сортами остаются."""
    renamed = 0
    for old, new in RENAMED_NOTES.items():
        if not FlavorNote.objects.filter(name=new).exists():
            renamed += FlavorNote.objects.filter(name=old).update(name=new)
    return renamed


def fix_pairing_texts():
    """Правит только объяснения, совпадающие со старым текстом дословно."""
    return sum(FoodPairing.objects.filter(explanation=old).update(explanation=new)
               for old, new in PAIRING_TEXT_FIXES.items())


def sync_team():
    removed, _ = TeamMember.objects.filter(name__in=INVENTED_TEAM).delete()
    for member in TEAM:
        TeamMember.objects.update_or_create(
            name=member['name'], defaults={'role': member['role'], 'bio': member['bio'], 'avatar': ''})
    return removed


def sync_courses():
    for course in COURSES:
        Course.objects.update_or_create(
            level=course['level'],
            defaults={'title': course['title'], 'description': course['description'], 'color': course['color']})
    return len(COURSES)


def relabel_profiles():
    """Подпись «сомелье» у черновых пирамид меняет на команду. Правки настоящих пользователей не трогает."""
    return FlavorProfile.objects.filter(sommelier_name__in=INVENTED_AUTHORS).update(sommelier_name=DRAFT_AUTHOR)


def fix_demo_venue():
    """Демо-заведение называется демо, без выдуманных адреса и телефона. Настоящие значения не трогает."""
    venue = Venue.objects.filter(slug=DEMO_VENUE_SLUG).first()
    if venue is None:
        return False
    changes = {}
    if venue.name == DEMO_PLACEHOLDERS['name']:
        changes['name'] = DEMO_VENUE_NAME
        changes['description'] = DEMO_VENUE_DESCRIPTION
    for field in ('address', 'phone'):
        if getattr(venue, field) == DEMO_PLACEHOLDERS[field]:
            changes[field] = ''
    if changes:
        Venue.objects.filter(pk=venue.pk).update(**changes)
    return bool(changes)
