"""
Справка по напиткам и блюдам движка подбора v2 для карты бара, заказа и отчёта пилота.

Бар может поставить в карту любой из 412 напитков data/engine/drinks.json (MenuDrink.engine_drink_id).
Здесь берём из набора движка название, стиль, крепость, категорию и картинку и решаем,
считается ли напиток алкогольным (для проверки возраста в заказе).
"""
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

# Категории drinks.json без алкоголя. Квас и кумыс сюда входят, но их крепость
# всё равно проверяется по abv: 1-1,5% уже больше порога ниже.
NON_ALCOHOLIC_CATEGORIES = frozenset({
    'na_beer', 'kvass', 'dairy', 'soda', 'tea', 'coffee', 'water', 'lemonade',
})
# Безалкогольное пиво с маркировкой 0.0 бывает до 0,5% (в drinks.json так у Efes 0.0 Грейпфрут-Помело).
NA_ABV_LIMIT = 0.5


def _dataset():
    """Набор движка (кэш на процесс). Если файлов нет, справка просто пустая."""
    try:
        from .pairing.dataset_v2 import get_dataset
        data_dir = str(getattr(settings, 'FLAVOR_DATA_DIR', '')) or None
        return get_dataset(data_dir)
    except Exception:  # noqa: BLE001 - без набора движка карта бара работает на сортах каталога
        logger.exception('Набор движка v2 не загрузился')
        return None


def engine_drink(drink_id):
    """Сырая запись напитка из drinks.json или None."""
    if not drink_id:
        return None
    ds = _dataset()
    return ds.drink_raw_by_id.get(str(drink_id)) if ds else None


def engine_dish(dish_id):
    """Сырая запись блюда из dishes_v2.json или None."""
    if not dish_id:
        return None
    ds = _dataset()
    return ds.dish_raw_by_id.get(str(dish_id)) if ds else None


def drink_style_label(raw):
    """Стиль напитка по-русски: подпись архетипа, иначе название стиля из записи."""
    style = raw.get('style') or {}
    if not isinstance(style, dict):
        return str(style)
    ds = _dataset()
    archetype = (ds.archetype_raw_by_id.get(style.get('archetype')) if ds else None) or {}
    label = archetype.get('label_ru') or style.get('name') or ''
    return '' if label == 'unknown' else label


def is_alcoholic(abv, category=None):
    """
    Алкогольный ли напиток. Известная крепость решает сама: больше 0,5% - алкоголь.
    Крепость неизвестна: алкоголь всё, что не в безалкогольных категориях (сорт каталога без abv - пиво).
    """
    if abv is not None:
        try:
            return float(abv) > NA_ABV_LIMIT
        except (TypeError, ValueError):
            pass
    return category not in NON_ALCOHOLIC_CATEGORIES


def drink_facts(menu_drink):
    """
    Что показать и проверить по напитку карты бара: название, стиль, крепость, категория,
    картинка (путь на сайте фронтенда для напитка движка), алкогольный ли он.
    Сорт каталога важнее записи движка в названии и картинке; крепость и категорию
    уточняет запись движка, если она привязана.
    """
    brand = menu_drink.brand if menu_drink.brand_id else None
    raw = engine_drink(menu_drink.engine_drink_id) or {}
    image = raw.get('image') or ''
    if brand is not None:
        name = brand.name
        style = brand.style or ''
        abv = brand.abv if brand.abv is not None else raw.get('abv')
    else:
        name = menu_drink.name or raw.get('display_name') or raw.get('name') or menu_drink.engine_drink_id
        style = drink_style_label(raw) if raw else ''
        abv = raw.get('abv')
    category = raw.get('category') or ('beer' if brand is not None else None)
    return {
        'name': name,
        'style': style,
        'abv': abv,
        'category': category,
        'efes_relation': raw.get('efes_relation') or '',
        'image': ('/' + image.lstrip('/')) if image else None,
        'is_alcoholic': is_alcoholic(abv, category),
    }
