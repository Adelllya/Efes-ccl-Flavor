"""
Вкусовой движок v2 для ИИ-сомелье.

Движок v2 (data/engine: 412 напитков, 114 блюд) единый источник подбора для лендинга, меню
заведения и чата. Здесь блюда меню и напитки карты бара сопоставляются с записями движка,
считаются баллы пар и выбираются понятные гостю объяснения. Для блюд и сортов, которых
в движке нет, чат работает по старым сочетаниям сомелье и стилю (см. ai_local).
"""
import logging
import re

from django.conf import settings

from .pairing import engine_v2 as E

log = logging.getLogger(__name__)

EFES_OWN = frozenset({'own', 'distribution'})
BEER_CATEGORIES = frozenset({'beer', 'na_beer', 'radler'})
DARK_FAMILIES = frozenset({'DARK_LAGER', 'STOUT', 'PORTER', 'BROWN_ALE', 'BELGIAN_DARK'})

# Слова, которые сами по себе не называют конкретное блюдо: их разбирают пожелания (мясное, десерт).
GENERIC_TERMS = frozenset({
    'мясо', 'салат', 'суп', 'рыба', 'закуска', 'десерт', 'выпечка', 'хлеб', 'снеки', 'колбаса', 'сыры', 'лапша',
    'гриль', 'барбекю', 'пирог', 'торт', 'творог', 'рис', 'ет', 'пончики', 'картошка', 'котлета', 'ролл', 'дип',
    'рагу', 'запеканка', 'паста', 'спагетти', 'макароны', 'капуста', 'соленья', 'отбивная', 'бобы', 'кебаб',
    'авокадо', 'томаты', 'моцарелла', 'креветки', 'шоколад', 'мороженое', 'сыр', 'бульон', 'орехи', 'колбаски',
    'сосиски', 'говядина', 'курица', 'дамплинги', 'печень', 'потроха', 'жаркое', 'чипсы', 'пирожок',
})
STOP_WORDS = frozenset({'и', 'с', 'со', 'в', 'на', 'к', 'по', 'под', 'из', 'для', 'а', 'the', 'a', 'with', 'and', 'of'})
# Как гости пишут бренды по-русски.
ALIASES = {
    'козел': 'kozel', 'козела': 'kozel', 'козелу': 'kozel', 'эфес': 'efes', 'эфеса': 'efes', 'эфесу': 'efes',
    'бавария': 'bavaria', 'баварию': 'bavaria', 'миллер': 'miller', 'гролш': 'grolsch', 'перони': 'peroni',
    'туборг': 'tuborg', 'хайнекен': 'heineken', 'карлсберг': 'carlsberg', 'гиннесс': 'guinness', 'гинесс': 'guinness',
}
CITATION_RE = re.compile(r'\s*\((?:[^()]|\([^()]*\))*\)\s*$')
NUMERIC_RE = re.compile(r'\d|↔')
SCORE5 = {'ideal': 5, 'excellent': 4, 'good': 3, 'neutral': 2}


def norm(text):
    text = (text or '').lower().replace('ё', 'е')
    return ' '.join(re.sub(r'[^\w\s]+', ' ', text).split())


def tokens(text):
    return [ALIASES.get(tok, tok) for tok in norm(text).split()]


def data_dir():
    return str(getattr(settings, 'FLAVOR_DATA_DIR', '')) or None


def dataset(lang='ru'):
    """Набор движка с весами из админки и объяснениями на языке гостя. None, если данных нет."""
    locale = lang if lang in ('kk', 'en') else 'ru'
    try:
        from . import engine_tuning
        return engine_tuning.tuned_dataset(data_dir(), locale)
    except Exception:  # noqa: BLE001 - без весов из базы берём обычный набор
        log.exception('ИИ-сомелье: набор движка с весами не загрузился')
    try:
        from .pairing.dataset_v2 import get_dataset
        return get_dataset(data_dir())
    except Exception:  # noqa: BLE001 - без движка чат работает по сочетаниям сомелье
        log.exception('ИИ-сомелье: набор движка v2 не загрузился')
        return None


# Названия и поиск

def dish_terms(raw):
    terms = [raw.get('name'), raw.get('display_name')] + list(raw.get('synonyms') or [])
    out = []
    for term in terms:
        n = norm(term)
        if n and n not in out:
            out.append(n)
    return out


_INDEX = {}


def index(ds):
    """Словари «название -> id» для напитков и блюд набора. Считаются один раз на набор."""
    key = id(ds)
    cached = _INDEX.get(key)
    if cached is not None and cached['ds'] is ds:
        return cached
    drink_by_name = {}
    for raw in ds.drinks:
        for name in (raw.get('name'), raw.get('display_name')):
            n = norm(name)
            if n and (n not in drink_by_name or raw.get('legacy_brand_id')):
                drink_by_name[n] = raw['id']
    dish_by_term = {}
    for raw in ds.dishes:
        for term in dish_terms(raw):
            dish_by_term.setdefault(term, raw['id'])
    # Слово из названия напитка, которое встречается у немногих напитков, годится как бренд: «Kozel», «Tuborg».
    word_count = {}
    for raw in ds.drinks:
        for tok in set(norm(raw.get('name')).split()):
            word_count[tok] = word_count.get(tok, 0) + 1
    _INDEX.clear()
    _INDEX[key] = {'ds': ds, 'drink_by_name': drink_by_name, 'dish_by_term': dish_by_term, 'word_count': word_count}
    return _INDEX[key]


# Слова из названий напитков, которые не называют бренд: их разбирает категория или пожелание.
NON_BRAND_WORDS = frozenset({
    'чай', 'кофе', 'вода', 'квас', 'сок', 'лимонад', 'пиво', 'вино', 'сидр', 'коктейль', 'светлое', 'темное',
    'безалкогольное', 'безалкогольный', 'пшеничное', 'домашний', 'белый', 'белое', 'красное', 'сухое', 'крепкое',
    'мягкое', 'особое', 'классическое', 'розлив', 'разливное', 'зеленый', 'черный', 'молочный', 'травяной',
    'большой', 'большая', 'большое', 'свежее', 'живое', 'холодный', 'горячий', 'летний', 'бочковой', 'фирменный',
    'lager', 'beer', 'wine', 'tea', 'water', 'light', 'dark', 'premium', 'original', 'classic', 'draft', 'zero',
    'alcoholic', 'non', 'free', 'pilsner', 'lemonade', 'cider', 'dry', 'brut', 'red', 'white', 'rose',
})
RARE_WORD_MAX = 6


def rare_words(ds, name):
    """Слова названия, по которым напиток узнаётся как бренд: редкие в каталоге и не общие."""
    if ds is None:
        return frozenset()
    counts = index(ds)['word_count']
    return frozenset(w for w in norm(name).split()
                     if len(w) >= 4 and not w.isdigit() and w not in NON_BRAND_WORDS
                     and w not in STOP_WORDS and 0 < counts.get(w, 0) <= RARE_WORD_MAX)


def v2_drink_id(ds, name):
    return index(ds)['drink_by_name'].get(norm(name)) if ds and name else None


def v2_dish_id(ds, name):
    return index(ds)['dish_by_term'].get(norm(name)) if ds and name else None


def stem(word):
    if len(word) <= 4:
        return word
    if len(word) <= 6:
        return word[:-1]
    return word[:-2]


def word_hits(q_tokens, word):
    """Позиции слов вопроса, в которых узнаётся слово названия с любым окончанием («шашлыку», «бешбармаққа»)."""
    if len(word) <= 3:
        return [i for i, q in enumerate(q_tokens) if q == word]
    s = stem(word)
    return [i for i, q in enumerate(q_tokens) if q.startswith(s) and len(q) <= len(word) + 4]


def brand_hits(q_tokens, word):
    """Строже, чем для блюд: бренд пишут почти без окончаний («Kozel», «Жигулевского»)."""
    if len(word) <= 4:
        return [i for i, q in enumerate(q_tokens) if q.startswith(word) and len(q) <= len(word) + 2]
    s = word[:-1]
    return [i for i, q in enumerate(q_tokens) if q.startswith(s) and len(q) <= len(word) + 3]


def match_term(q_tokens, term, allow_generic=False):
    """(вес, позиции), если все значимые слова названия есть в вопросе, иначе None."""
    words = [w for w in term.split() if w not in STOP_WORDS]
    if not words or (len(words) == 1 and words[0] in GENERIC_TERMS and not allow_generic):
        return None
    positions = set()
    for word in words:
        hits = word_hits(q_tokens, word)
        if not hits:
            return None
        positions.add(hits[0])
    return sum(len(w) for w in words), positions


def find_named(q_tokens, entries, allow_generic=False):
    """
    Записи (блюда), названные в вопросе. Самое длинное совпадение побеждает: «пицца пепперони»
    выбирает пепперони, а не «Пиццу Маргариту» по слову «пицца».
    """
    scored = []
    for entry in entries:
        best = None
        for term in entry.get('terms') or []:
            hit = match_term(q_tokens, term, allow_generic)
            if hit and (best is None or hit[0] > best[0]):
                best = hit
        if best:
            scored.append((best[0], best[1], entry))
    scored.sort(key=lambda s: -s[0])
    kept = []
    for weight, positions, entry in scored:
        if any(positions <= other for _, other, _ in kept):
            continue
        kept.append((weight, positions, entry))
    kept.sort(key=lambda k: min(k[1]))
    return [entry for _, _, entry in kept]


def find_drinks(q_tokens, entries):
    """
    Напитки, названные в вопросе: полное название или редкое слово из него («Kozel», «Tuborg»).
    Из нескольких напитков одного бренда берём основной (сорт каталога или самый короткий).
    """
    full = []
    by_word = {}
    for entry in entries:
        name_words = [w for w in norm(entry['name']).split() if w not in STOP_WORDS]
        if not name_words:
            continue
        if all(brand_hits(q_tokens, w) for w in name_words):
            full.append(entry)
            continue
        for word in name_words:
            if len(word) >= 4 and not word.isdigit() and entry.get('rare_words') and word in entry['rare_words'] \
                    and brand_hits(q_tokens, word):
                by_word.setdefault(word, []).append(entry)
                break
    found = list(full)
    for word, group in by_word.items():
        if any(word in norm(e['name']).split() for e in found):
            continue
        group.sort(key=lambda e: (not e.get('brand_id'), not e.get('wide'), len(e['name'])))
        found.append(group[0])
    return found[:3]


# Подбор

def rank_for_dish(ds, dish_v2, entries):
    """
    Напитки из entries к блюду движка, лучшие первыми. Порядок движка: честный балл, а при
    разнице не больше окна политики первым идёт напиток портфеля Efes. -> [(entry, result)].
    """
    dish = ds.dish_by_id.get(dish_v2) if ds and dish_v2 else None
    if dish is None:
        return []
    results = []
    by_drink = {}
    for entry in entries:
        v2 = entry.get('v2')
        profile = ds.drink_by_id.get(v2) if v2 else None
        if profile is None or v2 in by_drink:
            continue
        result = E.score_pair(profile, dish, {}, ds.params, ds.classic_index, True)
        if result['excluded']:
            continue
        by_drink[v2] = entry
        results.append(result)
    return [(by_drink[r['drink_id']], r) for r in E.partner_order(results, ds.params)]


def rank_dishes_for_drink(ds, drink_v2, dish_entries):
    """Блюда из dish_entries к напитку движка, лучшие первыми. -> [(entry, result)]."""
    profile = ds.drink_by_id.get(drink_v2) if ds and drink_v2 else None
    if profile is None:
        return []
    out = []
    for entry in dish_entries:
        dish = ds.dish_by_id.get(entry.get('v2') or '')
        if dish is None:
            continue
        result = E.score_pair(profile, dish, {}, ds.params, ds.classic_index, True)
        if not result['excluded']:
            out.append((entry, result))
    out.sort(key=lambda er: (-er[1]['score'], er[0]['name']))
    return out


def score5(result):
    """Балл движка 0-100 в оценку карточки 1-5 по полосам движка."""
    return SCORE5.get(result.get('band'), 1)


def lower_first(text):
    """Первую букву опускаем, кроме аббревиатур вроде IPA; однобуквенное слово («К плотному») тоже."""
    if text and text[0].isupper() and (len(text) == 1 or not text[1].isupper()):
        return text[0].lower() + text[1:]
    return text


def clean_reason(text):
    """Объяснение движка для гостя: без ссылки на источник в скобках в конце и без длинных тире."""
    text = CITATION_RE.sub('', text or '').strip()
    text = re.sub(r' [\u2014\u2013] ([^\u2014\u2013]+?) [\u2014\u2013] ', r' (\1) ', text)
    text = re.sub(r'\s*[\u2014\u2013]\s*', ': ', text)
    return lower_first(text.rstrip('. '))


def guest_reason(result):
    """Понятное гостю объяснение пары: без чисел и технических стрелок, общие фразы в последнюю очередь."""
    mechanisms = list(result.get('reasons') or []) + list(result.get('mechanisms') or [])
    for allow_generic in (False, True):
        for mech in mechanisms:
            text = mech.get('text') or ''
            if not text or NUMERIC_RE.search(text) or mech.get('rule') in ('R1', 'R15', 'R20'):
                continue
            if mech.get('rule') == 'R13' and not allow_generic:
                continue
            reason = clean_reason(text)
            if reason:
                return reason
    return lower_first(result.get('band_label') or '')


# Свойства напитка для пожеланий «полегче», «без горечи», «тёмное»

BITTER_STYLE_RE = re.compile(r'\bipa\b|pils|пилс|bitter|горьк', re.I)
DARK_STYLE_RE = re.compile(r'dark|dunkel|stout|porter|темн|тёмн', re.I)


def traits(ds, entry):
    """Горечь, тело, обжарка и сладость 0..1 из движка; для сорта вне движка грубо по стилю."""
    raw = ds.drink_raw_by_id.get(entry.get('v2') or '') if ds else None
    if raw:
        sensory = raw.get('sensory') or {}
        return {
            'bitter': sensory.get('bitter') or 0.0, 'body': sensory.get('body') or 0.0,
            'roast': sensory.get('roast') or 0.0, 'sweet': sensory.get('sweet') or 0.0,
            'family': (raw.get('style') or {}).get('family') or '',
        }
    style = '{} {}'.format(entry.get('style') or '', entry.get('name') or '')
    dark = bool(DARK_STYLE_RE.search(style))
    return {
        'bitter': 0.4 if BITTER_STYLE_RE.search(style) else 0.2, 'body': 0.6 if dark else 0.35,
        'roast': 0.3 if dark else 0.0, 'sweet': 0.2, 'family': 'DARK_LAGER' if dark else '',
    }


def abv_of(entry):
    try:
        return float(entry['abv']) if entry.get('abv') is not None else None
    except (TypeError, ValueError):
        return None


MOODS = ('light', 'nobitter', 'bitter', 'dark', 'strong', 'sweet')


def fits_mood(ds, entry, mood):
    tr = traits(ds, entry)
    abv = abv_of(entry)
    if mood == 'light':
        return (abv is None or abv <= 5.0) and tr['body'] <= 0.4
    if mood == 'nobitter':
        return tr['bitter'] <= 0.25
    if mood == 'bitter':
        return tr['bitter'] >= 0.33
    if mood == 'dark':
        return tr['roast'] >= 0.2 or tr['family'] in DARK_FAMILIES
    if mood == 'strong':
        return abv is not None and abv >= 6.0
    if mood == 'sweet':
        return tr['sweet'] >= 0.3
    return True


def mood_key(ds, entry, mood):
    """Ключ сортировки: самое подходящее под пожелание первым."""
    tr = traits(ds, entry)
    abv = abv_of(entry) or 0.0
    if mood == 'light':
        return tr['body'] + abv / 20
    if mood == 'nobitter':
        return tr['bitter']
    if mood == 'bitter':
        return -tr['bitter']
    if mood == 'dark':
        return -tr['roast']
    if mood == 'strong':
        return -abv
    if mood == 'sweet':
        return -tr['sweet']
    return 0.0
