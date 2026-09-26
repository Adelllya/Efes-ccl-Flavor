"""
Подбор напитка к блюду в меню заведения (GET /api/venues/<slug>/menu/).

Источник правды - движок подбора v2, и считаем только по тому, что бар реально продаёт:
- напиток движка в карте (MenuDrink.engine_drink_id) берём как есть;
- сорт каталога связываем с напитком движка через legacy_brand_id, иначе по точному названию.
Блюдо меню связываем с блюдом движка по названию и синонимам из dishes_v2.json. Если связи нет,
берём самое похожее блюдо каталога, у которого связь есть (кухня, вкус, вес, жирность, способ готовки).

К каждой позиции отдаём до трёх вариантов, которые можно заказать прямо сейчас (в карте и в наличии):
1. пара команды Flavor Tree (FoodPairing) с оценкой не ниже TEAM_LEAD_MIN, если её сорт есть в карте
   и движок не считает пару неудачной;
2. лучшие напитки бара по баллу движка (политика Efes и разнообразие как в /api/v2/);
3. остальные пары команды из карты, если мест ещё хватает, кроме отвергнутых движком.
Напитки с баллом ниже «нейтрально» движок не предлагает, энергетики к еде не советуем. Если лучший
вариант слабее «хорошей пары», подбор помечается как слабый, и гость видит честную подпись.
"""
import logging
import re
import threading
import weakref
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from django.conf import settings

from .pairing import engine_v2 as E

logger = logging.getLogger(__name__)

TOP_N = 3
# Пара команды идёт первой, только если команда оценила её на 4 или 5.
TEAM_LEAD_MIN = 4
SOURCE_TEAM = 'TEAM'
SOURCE_ENGINE = 'ENGINE'

STATUS_OK = 'ok'            # есть сильный вариант из карты
STATUS_WEAK = 'weak'        # варианты есть, но сильной пары в карте нет
STATUS_NONE = 'none'        # в карте есть напитки, но к блюду ничего не подходит или нет в наличии
STATUS_NO_DRINKS = 'no_drinks'  # карта напитков пустая: пара команды показывается только как совет

# Семейство сильнейшего правила движка -> тип пары каталога (для старой подписи «Очищает», «Мостик»).
MATCH_TO_PAIRING_TYPE = {
    'cut': 'CLEANSE',
    'complement': 'COMPLEMENT',
    'contrast': 'CONTRAST',
    'bridge': 'BRIDGE',
}
# Бэнд движка -> оценка 1..5, как у пар команды.
BAND_RATING = {'ideal': 5, 'excellent': 4, 'good': 3, 'neutral': 2}

# Слова-категории: по одному такому слову блюдо движка не угадываем («Салат из огурцов» не капрезе).
GENERIC_WORDS = frozenset({
    'салат', 'десерт', 'мясо', 'рыба', 'суп', 'выпечка', 'хлеб', 'пирог', 'торт', 'закуска', 'снеки',
    'ролл', 'роллы', 'дип', 'котлета', 'колбаса', 'лапша', 'паста', 'соленья', 'гриль', 'барбекю', 'bbq',
    'картошка', 'сыры', 'шоколад', 'творог', 'бульон', 'запеканка', 'рагу', 'пончики', 'макароны',
    'капуста', 'томаты', 'авокадо', 'бобы', 'говядина', 'отбивная', 'пицца', 'пирожок', 'креветки',
    'ет', 'фри', 'фо', 'шуба', 'сыр', 'курица', 'мясное', 'ассорти', 'нарезка',
})

# Похожесть блюд каталога: вес совпадения каждого поля и порог, ниже которого не угадываем.
SIMILAR_WEIGHTS = (('dominant_taste', 2.0), ('cooking_method', 1.5), ('weight', 1.0), ('fat_level', 1.0),
                   ('cuisine', 1.0))
SIMILAR_MIN = 4.0
DESSERT_WORDS = ('десерт', 'выпечк', 'сладк')

_warned_dishes = set()


def _data_dir():
    return str(getattr(settings, 'FLAVOR_DATA_DIR', '')) or None


def dataset():
    """Набор движка с весами из админки, как в /api/v2/. Без весов или при сбое базы - обычный набор."""
    try:
        from . import engine_tuning
        return engine_tuning.tuned_dataset(_data_dir(), 'ru')
    except Exception:  # noqa: BLE001 - подкрутка весов не должна ломать меню
        logger.exception('Веса движка не загрузились, считаем по базовым')
    try:
        from .pairing.dataset_v2 import get_dataset
        return get_dataset(_data_dir())
    except Exception:  # noqa: BLE001 - без движка меню работает на парах команды
        logger.exception('Набор движка v2 не загрузился')
        return None


def norm(text):
    """Строка для сравнения названий: нижний регистр, ё как е, без знаков препинания."""
    text = str(text or '').lower().replace('ё', 'е')
    return ' '.join(re.sub(r'[^\w]+', ' ', text).split())


# ─── справочник движка: блюда по названиям, напитки по сортам ────────────────────

class _Index:
    """Поиск по набору движка. Строится один раз на набор (набор меняется, когда меняют веса)."""

    def __init__(self, ds):
        self.dish_exact: Dict[str, str] = {}
        self.dish_phrases: List[Tuple[Tuple[str, ...], bool, str]] = []
        names = []
        synonyms = []
        for raw in ds.dishes:
            for text in (raw.get('name'), raw.get('display_name')):
                if text:
                    names.append((norm(text), raw['id']))
            for text in raw.get('synonyms') or []:
                synonyms.append((norm(text), raw['id']))
        # Название блюда важнее чужого синонима с тем же текстом.
        for key, dish_id in names + synonyms:
            if key and key not in self.dish_exact:
                self.dish_exact[key] = dish_id
        for is_name, pairs in ((True, names), (False, synonyms)):
            for key, dish_id in pairs:
                words = tuple(key.split())
                if not words or (len(words) == 1 and words[0] in GENERIC_WORDS):
                    continue
                self.dish_phrases.append((words, is_name, dish_id))

        self.drink_by_legacy_name: Dict[str, str] = {}
        self.drink_by_name: Dict[str, List[str]] = {}
        for raw in ds.drinks:
            if raw.get('legacy_brand_id') and raw.get('name'):
                self.drink_by_legacy_name.setdefault(raw['name'], raw['id'])
            for text in {norm(raw.get('name')), norm(raw.get('display_name'))}:
                if text:
                    self.drink_by_name.setdefault(text, []).append(raw['id'])
        self.dish_cache: Dict[str, Tuple[Optional[str], Optional[str]]] = {}

    def match_dish(self, name) -> Tuple[Optional[str], Optional[str]]:
        """(id блюда движка, 'exact' | 'partial') или (None, None)."""
        key = norm(name)
        if key in self.dish_cache:
            return self.dish_cache[key]
        found: Tuple[Optional[str], Optional[str]] = (None, None)
        if key in self.dish_exact:
            found = (self.dish_exact[key], 'exact')
        elif key:
            words = key.split()
            best = None
            for phrase, is_name, dish_id in self.dish_phrases:
                pos = _find_words(words, phrase)
                if pos < 0:
                    continue
                # Больше слов, длиннее текст, название важнее синонима, раньше в названии.
                rank = (len(phrase), sum(len(w) for w in phrase), is_name, -pos)
                if best is None or rank > best[0]:
                    best = (rank, dish_id)
            if best:
                found = (best[1], 'partial')
        self.dish_cache[key] = found
        return found

    def engine_drink(self, ds, menu_drink) -> Optional[str]:
        """Напиток движка для позиции карты бара или None."""
        engine_id = (menu_drink.engine_drink_id or '').strip()
        if engine_id:
            return engine_id if engine_id in ds.drink_by_id else None
        brand = menu_drink.brand if menu_drink.brand_id else None
        if brand is None:
            return None
        found = self.drink_by_legacy_name.get(brand.name)
        if found:
            return found
        same_name = self.drink_by_name.get(norm(brand.name)) or []
        return same_name[0] if len(same_name) == 1 else None


def _find_words(words, phrase):
    """Позиция фразы в списке слов целыми словами, иначе -1."""
    n = len(phrase)
    for i in range(len(words) - n + 1):
        if tuple(words[i:i + n]) == phrase:
            return i
    return -1


_indexes = weakref.WeakKeyDictionary()


def index_for(ds) -> _Index:
    idx = _indexes.get(ds)
    if idx is None:
        idx = _Index(ds)
        _indexes[ds] = idx
    return idx


def venue_engine_drink_ids(venue, ds=None, available_only=True) -> List[str]:
    """id напитков движка, которые бар продаёт: и по сортам каталога, и напрямую из базы подбора."""
    ds = ds or dataset()
    if ds is None:
        return []
    idx = index_for(ds)
    drinks = venue.menu_drinks.select_related('brand')
    if available_only:
        drinks = drinks.filter(is_available=True)
    out = []
    for md in drinks:
        engine_id = idx.engine_drink(ds, md)
        if engine_id and engine_id not in out:
            out.append(engine_id)
    return out


def _is_energy(raw) -> bool:
    style = raw.get('style') or {}
    text = ' '.join([str(raw.get('name') or ''), str(style.get('name') if isinstance(style, dict) else style)])
    return 'energy' in text.lower() or 'энергет' in text.lower()


def _usable_for_food(raw) -> bool:
    """Черновик без стиля и энергетики к еде не советуем."""
    return bool(raw) and raw.get('status') != 'draft' and not _is_energy(raw)


# ─── тексты ─────────────────────────────────────────────────────────────────────

_CITATION = re.compile(r'\s*\([^()]*[A-Za-z0-9↔«:][^()]*\)')
# Длинное и среднее тире (\u2014, \u2013) в текстах движка.
_DASH_PAIR = re.compile('\\s[\u2014\u2013]\\s([^\u2014\u2013]+?)\\s[\u2014\u2013]\\s')
_DASH = re.compile('\\s*[\u2014\u2013]\\s*')
# R1 про «громкость» и вес с числами, R20 про классику из справочника: гостю они ничего не объясняют.
HIDDEN_RULES = frozenset({'R1', 'R20'})


def clean_reason(text) -> str:
    """Причина движка без ссылок на источники, чисел в скобках и длинных тире."""
    text = _CITATION.sub('', str(text or ''))
    text = _DASH_PAIR.sub(lambda m: ' (' + m.group(1).strip() + ') ', text)
    text = _DASH.sub(', ', text)
    text = text.replace(' ↔ ', ' и ').replace('↔', ' и ')
    text = re.sub(r'\s+([,.;:])', r'\1', text)
    text = ' '.join(text.split()).strip(' ,;')
    return text[:1].upper() + text[1:] if text else ''


def short_reasons(result, limit=2) -> List[str]:
    """Две самые весомые понятные причины пары."""
    items = [r for r in (result.get('reasons') or []) if r.get('rule') not in HIDDEN_RULES]
    if len(items) < limit:
        seen = {id(r) for r in items}
        extra = [c for c in (result.get('components') or [])
                 if c.get('points', 0) > 0 and c.get('rule') not in HIDDEN_RULES and id(c) not in seen]
        extra.sort(key=lambda c: -c.get('points', 0))
        items += extra
    out = []
    for r in items:
        text = clean_reason(r.get('text'))
        if text and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


# ─── подбор ─────────────────────────────────────────────────────────────────────

@dataclass
class Option:
    menu_drink: Any
    source: str
    rank: int = 0
    team: Any = None             # FoodPairing
    engine: Optional[dict] = None  # результат score_pair движка
    engine_drink_id: str = ''


@dataclass
class ItemPick:
    options: List[Option] = field(default_factory=list)
    status: str = STATUS_NONE
    engine_dish: Optional[str] = None
    engine_dish_name: str = ''
    dish_match: Optional[str] = None
    based_on: str = ''
    reference: Any = None        # пара команды как совет, когда карта напитков пустая


def band_min(ds, band_id, default):
    for band in (ds.params.get('bands') or {}).get('list') or []:
        if band.get('id') == band_id:
            return band.get('min', default)
    return default


def engine_rating(result) -> int:
    return BAND_RATING.get(result.get('band'), 1)


# Результаты движка на процесс: меню открывают часто, а карта и блюда меняются редко.
_rank_cache: 'OrderedDict[tuple, Tuple[Any, list, dict]]' = OrderedDict()
_rank_lock = threading.Lock()
_RANK_CACHE_SIZE = 512


def _engine_rank(ds, dish_id, pool_ids, exclude, slots, min_score):
    """
    Баллы движка для всех напитков пула и лучшие из них без exclude: (выбранные с объяснением, {id: балл}).
    Кандидаты ниже min_score отсекаются до разнообразия, чтобы оно не вытеснило сильный сорт слабым.
    """
    key = (id(ds), dish_id, pool_ids, exclude, slots, min_score)
    with _rank_lock:
        hit = _rank_cache.get(key)
        if hit is not None and hit[0] is ds:
            _rank_cache.move_to_end(key)
            return hit[1], hit[2]
    dish = ds.dish_by_id[dish_id]
    pool = [ds.drink_by_id[i] for i in pool_ids]
    full = E.recommend(dish, pool, {}, 0, ds.params, ds.classic_index, explain=False)['items']
    scores = {r['drink_id']: r['score'] for r in full}
    strong = [ds.drink_by_id[r['drink_id']] for r in full
              if r['score'] >= min_score and r['drink_id'] not in exclude]
    picked = []
    if strong and slots > 0:
        picked = E.recommend(dish, strong, {}, slots, ds.params, ds.classic_index, explain=True)['items']
    with _rank_lock:
        _rank_cache[key] = (ds, picked, scores)
        if len(_rank_cache) > _RANK_CACHE_SIZE:
            _rank_cache.popitem(last=False)
    return picked, scores


def _similar_dish(dish, known):
    """Самое похожее блюдо каталога из known [(Dish, id блюда движка)] по полям классификации."""
    dessert = any(w in (dish.category or '').lower() for w in DESSERT_WORDS)
    best, best_score = (None, None), SIMILAR_MIN
    for other, engine_id in known:
        if other.pk == dish.pk:
            continue
        if dessert != any(w in (other.category or '').lower() for w in DESSERT_WORDS):
            continue
        score = sum(weight for name, weight in SIMILAR_WEIGHTS if getattr(dish, name) == getattr(other, name))
        # При равенстве остаётся первое по порядку каталога (кухня, название): ответ не прыгает.
        if score > best_score or (score == best_score and best[0] is None):
            best, best_score = (other, engine_id), score
    return best


def _engine_dish_for(ds, idx, dish, catalog):
    """(id блюда движка, как нашли, на какое блюдо каталога опирались)."""
    engine_id, how = idx.match_dish(dish.name)
    if engine_id:
        return engine_id, how, ''
    other, engine_id = _similar_dish(dish, catalog())
    first_time = dish.name not in _warned_dishes
    _warned_dishes.add(dish.name)
    if engine_id:
        if first_time:
            logger.info('Блюдо «%s» не найдено в движке v2 по названию, считаем по похожему «%s»',
                        dish.name, other.name)
        return engine_id, 'similar', other.name
    if first_time:
        logger.warning('Блюдо «%s» не связано с блюдом движка v2: к нему советуем только пары команды', dish.name)
    return None, None, ''


def recommend_menu(items, drinks, team_by_dish, ds=None, top_n=TOP_N) -> Dict[Any, ItemPick]:
    """
    Подбор для позиций меню одного заведения.
    items - MenuItem с dish; drinks - MenuDrink этого заведения с brand;
    team_by_dish - {dish_id: [FoodPairing активных сортов, лучшие первыми]}.
    Возвращает {menu_item.pk: ItemPick}.
    """
    ds = ds if ds is not None else dataset()
    idx = index_for(ds) if ds is not None else None
    good_min = band_min(ds, 'good', 60) if ds is not None else 60
    neutral_min = band_min(ds, 'neutral', 48) if ds is not None else 48

    # Позиции карты, которые можно заказать, и их напитки движка.
    available = [md for md in drinks if md.is_available]
    by_brand = {}
    by_engine = {}
    engine_of = {}
    for md in available:
        if md.brand_id and md.brand_id not in by_brand:
            by_brand[md.brand_id] = md
        engine_id = idx.engine_drink(ds, md) if idx else None
        raw = ds.drink_raw_by_id.get(engine_id) if engine_id else None
        if engine_id and _usable_for_food(raw) and engine_id not in by_engine:
            by_engine[engine_id] = md
            engine_of[md.pk] = engine_id
    pool_ids = tuple(sorted(by_engine))

    catalog_cache = []

    def catalog():
        # Блюда каталога, у которых есть связь с движком: для поиска похожего. Читаем один раз на запрос.
        if not catalog_cache:
            from .models import Dish
            rows = []
            for other in Dish.objects.only('id', 'name', 'category', 'cuisine', 'dominant_taste', 'weight',
                                           'fat_level', 'cooking_method'):
                engine_id, _ = idx.match_dish(other.name)
                if engine_id:
                    rows.append((other, engine_id))
            catalog_cache.append(rows)
        return catalog_cache[0]

    picks = {}
    for item in items:
        pick = ItemPick()
        picks[item.pk] = pick
        team = team_by_dish.get(item.dish_id, [])
        if not drinks:
            pick.status = STATUS_NO_DRINKS
            pick.reference = team[0] if team else None
            continue

        if idx is not None:
            engine_dish, how, based_on = _engine_dish_for(ds, idx, item.dish, catalog)
            if engine_dish and engine_dish in ds.dish_by_id:
                pick.engine_dish = engine_dish
                pick.engine_dish_name = (ds.dish_raw_by_id.get(engine_dish) or {}).get('name', '')
                pick.dish_match = how
                pick.based_on = based_on

        team_in_bar = [p for p in team if p.brand_id in by_brand]
        chosen: List[Option] = []
        taken = set()

        def take(option):
            chosen.append(option)
            taken.add(option.menu_drink.pk)

        scores = {}
        if pick.engine_dish and pool_ids:
            _, scores = _engine_rank(ds, pick.engine_dish, pool_ids, (), 0, neutral_min)
        # Пара команды первой, если команда дала 4-5 и движок не считает её неудачной.
        if team_in_bar and team_in_bar[0].compatibility_score >= TEAM_LEAD_MIN:
            lead = team_in_bar[0]
            md = by_brand[lead.brand_id]
            engine_id = engine_of.get(md.pk, '')
            if scores.get(engine_id, neutral_min) >= neutral_min:
                take(Option(md, SOURCE_TEAM, team=lead, engine_drink_id=engine_id))

        if pick.engine_dish and pool_ids:
            exclude = tuple(sorted(o.engine_drink_id for o in chosen if o.engine_drink_id))
            picked, _ = _engine_rank(ds, pick.engine_dish, pool_ids, exclude, top_n - len(chosen), neutral_min)
            for result in picked:
                md = by_engine[result['drink_id']]
                if md.pk not in taken and len(chosen) < top_n:
                    team_pair = next((p for p in team_in_bar if p.brand_id == md.brand_id), None)
                    take(Option(md, SOURCE_ENGINE, team=team_pair, engine=result, engine_drink_id=result['drink_id']))

        # Остальные пары команды добирают свободные места, кроме тех, что движок считает неудачными.
        for pairing in team_in_bar:
            if len(chosen) >= top_n:
                break
            md = by_brand[pairing.brand_id]
            engine_id = engine_of.get(md.pk, '')
            if md.pk in taken or scores.get(engine_id, neutral_min) < neutral_min:
                continue
            take(Option(md, SOURCE_TEAM, team=pairing, engine_drink_id=engine_id))

        # Балл движка и для пар команды, если напиток есть в движке: фронт может показать оба мнения.
        if pick.engine_dish:
            for option in chosen:
                if option.engine is None and option.engine_drink_id:
                    score = scores.get(option.engine_drink_id)
                    if score is None:
                        continue
                    b = ds.drink_by_id[option.engine_drink_id]
                    option.engine = E.score_pair(b, ds.dish_by_id[pick.engine_dish], {}, ds.params,
                                                 ds.classic_index, True)

        for i, option in enumerate(chosen, start=1):
            option.rank = i
        pick.options = chosen
        if not chosen:
            pick.status = STATUS_NONE
        else:
            first = chosen[0]
            strong = (first.source == SOURCE_TEAM and first.team.compatibility_score >= TEAM_LEAD_MIN) or \
                (first.engine is not None and first.engine['score'] >= good_min)
            pick.status = STATUS_OK if strong else STATUS_WEAK
    return picks
