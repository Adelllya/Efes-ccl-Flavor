"""
ИИ-сомелье: чат, который помогает гостю выбрать блюдо и напиток.

Контекст (меню заведения, карта бара и сочетания сомелье, а без заведения общий каталог)
собирается из базы и уходит в Claude вторым блоком системного промпта с кэшированием.
Без ключа ANTHROPIC_API_KEY и при любой ошибке API отвечает локальный подбор на правилах.
Ключ нигде не хранится в коде: SDK читает его из окружения.
"""
import json
import logging
import os
import re
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db.models import Count

from .models import Brand, Dish, FoodPairing, Venue

try:
    import anthropic
except ImportError:  # без SDK остаётся только локальный режим
    anthropic = None

log = logging.getLogger(__name__)

DEFAULT_MODEL = 'claude-opus-5'
MAX_TOKENS = 4000  # мысли модели тоже считаются в лимит, поэтому запас
REQUEST_TIMEOUT = 25
MAX_RETRIES = 1
CONTEXT_MAX_CHARS = 12000
CATALOG_DISHES_LIMIT = 60
MAX_SUGGESTIONS = 6
REASON_MAX_CHARS = 300
REPLY_MAX_CHARS = 4000
EXPLANATION_MAX_CHARS = 120
LOCAL_NOTE = 'ИИ недоступен, отвечает локальный подбор'

KIND_DISH = 'DISH'
KIND_DRINK = 'DRINK'

CUISINE_LABELS = dict(Dish.CUISINE_CHOICES)
TASTE_LABELS = dict(Dish.TASTE_CHOICES)
WEIGHT_LABELS = dict(Dish.WEIGHT_CHOICES)
FAT_LABELS = dict(Dish.FAT_CHOICES)
COOKING_LABELS = dict(Dish.COOKING_METHOD_CHOICES)
PAIRING_LABELS = {'COMPLEMENT': 'дополняет', 'CONTRAST': 'контраст', 'CLEANSE': 'очищает', 'BRIDGE': 'мостик'}
PREF_LABELS = (
    ('no_bitter', 'без горечи'),
    ('light', 'полегче'),
    ('no_alcohol', 'без алкоголя'),
    ('spicy_ok', 'острое подходит'),
)

SYSTEM_PROMPT = """Ты ИИ-сомелье Flavor Tree: помогаешь гостю бара или ресторана выбрать блюдо и напиток к нему.

Правила:
1. Предлагай только то, что есть в переданном меню и карте бара (или в каталоге, если заведение не выбрано). Никогда не выдумывай цены, объёмы, крепость и наличие: бери их из списка или не называй вовсе.
2. В первую очередь опирайся на сочетания сомелье с оценкой 4-5 и одним коротким предложением объясняй, почему пара работает. Если сорт из сочетания отсутствует в карте бара, скажи об этом и предложи ближайший по стилю из карты.
3. Если желание гостя непонятно, задай один уточняющий вопрос вместо длинного списка.
4. Учитывай пожелания гостя: no_bitter означает избегать выраженной горечи (IPA, хмелевые пилснеры) и выбирать мягкие лагеры или пшеничное; light означает лёгкие лагеры и пшеничное, поменьше крепости; no_alcohol означает только безалкогольные сорта (0.0), а если их нет в списке, честно скажи, что у бара их нет; spicy_ok означает, что гость не против острого.
5. Если в заказе гостя уже есть блюда, подбирай напиток к ним и упоминай их (например, "к вашему бешбармаку").
6. Позиции, которых нет в наличии, не предлагай.
7. Стиль: коротко и тепло, 2-6 предложений, без эмодзи и без markdown-заголовков; списки допустимы. Отвечай на языке гостя, по умолчанию на русском.

Формат ответа: строго один JSON-объект и ничего вокруг него:
{"reply": "текст ответа гостю", "suggestions": [{"kind": "DISH" или "DRINK", "id": "id из списка", "reason": "почему подходит, одно предложение", "pairs_with": "id блюда, к которому подобран напиток, или null"}]}
В suggestions только id из переданных списков и не больше 4 позиций; если предлагать нечего, передай пустой массив. Название, цену и оценку в suggestions писать не нужно: они подставляются из базы."""


# Настройки

def ai_enabled():
    """Ключ есть в окружении (или подхвачен из backend/.env) и SDK установлен."""
    return anthropic is not None and bool(os.environ.get('ANTHROPIC_API_KEY', '').strip())


def ai_model():
    return os.environ.get('FT_AI_MODEL', '').strip() or getattr(settings, 'FT_AI_MODEL', DEFAULT_MODEL)


# Форматирование

def format_price(value):
    """Decimal('4500.00') -> '4 500 ₸'."""
    if value is None:
        return ''
    amount = int(Decimal(str(value)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    return '{:,}'.format(amount).replace(',', ' ') + ' ₸'


def format_abv(abv):
    """5.0 -> '5 %', 4.75 -> '4,8 %'."""
    if abv is None:
        return ''
    text = '{:.1f}'.format(float(abv))
    if text.endswith('.0'):
        text = text[:-2]
    return text.replace('.', ',') + ' %'


def joined(*parts):
    return ' · '.join(p for p in parts if p)


def clean_text(value, limit):
    if not isinstance(value, str):
        return ''
    return value.strip()[:limit]


def lower_first(text):
    # Первую букву опускаем только у обычного слова, аббревиатуры вроде IPA не трогаем.
    if len(text) >= 2 and text[0].isupper() and text[1].islower():
        return text[0].lower() + text[1:]
    return text


# Контекст для модели

def dish_entry(dish, item=None):
    """Блюдо меню (id позиции) или блюдо каталога (id блюда)."""
    entry = {
        'kind': KIND_DISH,
        'id': str(item.id if item is not None else dish.id),
        'dish_id': str(dish.id),
        'name': dish.name,
        'category': dish.category,
        'cuisine': dish.cuisine,
        'taste': dish.dominant_taste,
        'weight': dish.weight,
        'fat': dish.fat_level,
        'cooking': dish.cooking_method,
        'section': item.section if item is not None else '',
        'portion': item.portion if item is not None else '',
        'price': item.price if item is not None else None,
        'is_available': item.is_available if item is not None else True,
        'chef_note': item.chef_note if item is not None else '',
    }
    if item is not None:
        entry['subtitle'] = joined(item.portion, format_price(item.price))
    else:
        entry['subtitle'] = joined(CUISINE_LABELS.get(dish.cuisine, ''), dish.category)
    return entry


def drink_entry(brand, menu_drink=None):
    """Напиток карты бара (id позиции) или сорт каталога (id сорта)."""
    entry = {
        'kind': KIND_DRINK,
        'id': str(menu_drink.id if menu_drink is not None else brand.id),
        'brand_id': str(brand.id),
        'name': brand.name,
        'style': brand.style or '',
        'abv': brand.abv,
        'price': menu_drink.price if menu_drink is not None else None,
        'volume': menu_drink.volume if menu_drink is not None else '',
        'is_available': menu_drink.is_available if menu_drink is not None else True,
    }
    if menu_drink is not None:
        entry['subtitle'] = joined(brand.style, menu_drink.volume, format_price(menu_drink.price))
    else:
        entry['subtitle'] = joined(brand.style, format_abv(brand.abv))
    return entry


def pairing_entry(pairing):
    return {
        'dish_id': str(pairing.dish_id),
        'brand_id': str(pairing.brand_id),
        'dish_name': pairing.dish.name,
        'brand_name': pairing.brand.name,
        'score': pairing.compatibility_score,
        'type': pairing.pairing_type,
        'explanation': (pairing.explanation or '').strip(),
    }


def dish_attributes(dish):
    return ', '.join([
        CUISINE_LABELS.get(dish['cuisine'], dish['cuisine']).lower(),
        TASTE_LABELS.get(dish['taste'], dish['taste']).lower(),
        WEIGHT_LABELS.get(dish['weight'], dish['weight']).lower(),
        'жирность ' + FAT_LABELS.get(dish['fat'], dish['fat']).lower(),
        COOKING_LABELS.get(dish['cooking'], dish['cooking']).lower(),
    ])


def availability(flag):
    return 'в наличии' if flag else 'нет в наличии'


def render_context(venue_info, dishes, drinks, pairings, drink_by_brand):
    lines = []
    if venue_info:
        lines.append(
            'Заведение: {} ({}). Ниже его меню, карта бара и сочетания сомелье. '
            'Предлагать можно только позиции из этих списков; id стоит в начале строки.'
            .format(venue_info['name'], venue_info['type'].lower()))
        lines.append('')
        lines.append('Блюда меню (id | название | раздел | порция | цена | наличие | '
                     'кухня, вкус, вес, жирность, приготовление):')
        for dish in dishes:
            line = ' | '.join([
                dish['id'], dish['name'], dish['section'] or 'без раздела',
                dish['portion'] or 'порция не указана', format_price(dish['price']) or 'цена не указана',
                availability(dish['is_available']), dish_attributes(dish),
            ])
            if dish['chef_note']:
                line += '. Повар: ' + dish['chef_note']
            lines.append(line)
        lines.append('')
        if drinks:
            lines.append('Напитки бара (id | название | стиль | крепость | объём | цена | наличие):')
            for drink in drinks:
                lines.append(' | '.join([
                    drink['id'], drink['name'], drink['style'] or 'стиль не указан',
                    format_abv(drink['abv']) or 'крепость не указана', drink['volume'] or 'объём не указан',
                    format_price(drink['price']) or 'цена не указана', availability(drink['is_available']),
                ]))
        else:
            lines.append('Напитки бара: карта пока пуста, напитки не предлагай.')
    else:
        lines.append(
            'Заведение не выбрано: гость смотрит общий каталог Flavor Tree. Ниже блюда каталога, сорта и '
            'сочетания сомелье. Предлагать можно только позиции из этих списков; id стоит в начале строки. '
            'Цены и наличие неизвестны, не называй их.')
        lines.append('')
        lines.append('Блюда каталога (id | название | категория | кухня, вкус, вес, жирность, приготовление):')
        for dish in dishes:
            lines.append(' | '.join([
                dish['id'], dish['name'], dish['category'] or 'без категории', dish_attributes(dish),
            ]))
        lines.append('')
        lines.append('Сорта каталога (id | название | стиль | крепость):')
        for drink in drinks:
            lines.append(' | '.join([
                drink['id'], drink['name'], drink['style'] or 'стиль не указан',
                format_abv(drink['abv']) or 'крепость не указана',
            ]))
    lines.append('')
    if pairings:
        lines.append('Сочетания сомелье (блюдо -> сорт | оценка из 5 | тип | почему):')
        for pairing in sorted(pairings, key=lambda p: (p['dish_name'], -p['score'], p['brand_name'])):
            brand = pairing['brand_name']
            if venue_info and pairing['brand_id'] not in drink_by_brand:
                brand += ' [нет в карте бара]'
            lines.append(' | '.join([
                '{} -> {}'.format(pairing['dish_name'], brand), str(pairing['score']),
                PAIRING_LABELS.get(pairing['type'], pairing['type'].lower()),
                pairing['explanation'][:EXPLANATION_MAX_CHARS],
            ]))
    else:
        lines.append('Сочетания сомелье: пока нет, подбирай по стилю и характеру блюда.')
    return '\n'.join(lines)


def build_context(venue_slug=None, venue=None):
    """
    Контекст для промпта и для проверки id в ответе. Для заведения: его меню, карта бара и сочетания
    сомелье по блюдам меню. Без заведения: активные сорта и до 60 блюд каталога с сочетаниями.
    Списки отсортированы, текст обрезан до CONTEXT_MAX_CHARS, чтобы кэш промпта работал.
    Неизвестный slug: Venue.DoesNotExist.
    """
    if venue is None and venue_slug:
        venue = Venue.objects.get(slug=venue_slug, is_published=True)

    if venue is not None:
        items = venue.menu_items.select_related('dish').order_by('section', 'sort_order', 'dish__name')
        menu_drinks = venue.menu_drinks.select_related('brand').order_by('sort_order', 'brand__name')
        dishes = [dish_entry(item.dish, item) for item in items]
        drinks = [drink_entry(md.brand, md) for md in menu_drinks]
        venue_info = {'slug': venue.slug, 'name': venue.name, 'type': venue.get_venue_type_display()}
    else:
        catalog = (
            Dish.objects.annotate(pairings_count=Count('food_pairings'))
            .order_by('-pairings_count', 'name')[:CATALOG_DISHES_LIMIT]
        )
        dishes = [dish_entry(dish) for dish in catalog]
        drinks = [drink_entry(brand) for brand in Brand.objects.filter(is_active=True).order_by('name')]
        venue_info = None

    drink_by_brand = {drink['brand_id']: drink for drink in drinks}
    pairings = [
        pairing_entry(p) for p in
        FoodPairing.objects.filter(dish_id__in=[d['dish_id'] for d in dishes], brand__is_active=True)
        .select_related('brand', 'dish')
    ]
    pairings.sort(key=lambda p: (p['dish_name'], -p['score'], p['brand_name']))

    def render():
        return render_context(venue_info, dishes, drinks, pairings, drink_by_brand)

    def shrink():
        """Один шаг ужатия: сначала сочетания без сорта в карте, потом блюда без сочетаний,
        потом самые слабые сочетания, в конце блюда с конца списка."""
        unlisted = [p for p in pairings if p['brand_id'] not in drink_by_brand]
        if unlisted:
            pairings.remove(min(unlisted, key=lambda p: (p['score'], p['dish_name'], p['brand_name'])))
            return True
        paired = set(p['dish_id'] for p in pairings)
        lonely = [d for d in dishes if d['dish_id'] not in paired]
        if lonely:
            dishes.remove(lonely[-1])
            return True
        if pairings:
            pairings.remove(min(pairings, key=lambda p: (p['score'], p['dish_name'], p['brand_name'])))
            return True
        if dishes:
            dishes.pop()
            return True
        return False

    text = render()
    while len(text) > CONTEXT_MAX_CHARS and shrink():
        text = render()
    text = text[:CONTEXT_MAX_CHARS]

    pairings_by_dish = {}
    for pairing in pairings:
        pairings_by_dish.setdefault(pairing['dish_id'], []).append(pairing)
    return {
        'venue': venue_info,
        'dishes': dishes,
        'drinks': drinks,
        'pairings': pairings,
        'text': text,
        'dish_by_id': {d['id']: d for d in dishes},
        'drink_by_id': {d['id']: d for d in drinks},
        'drink_by_brand': drink_by_brand,
        'pairings_by_dish': pairings_by_dish,
    }


def lookup(ctx, kind, entry_id):
    kind = str(kind or '').upper()
    if kind == KIND_DISH:
        return ctx['dish_by_id'].get(str(entry_id))
    if kind == KIND_DRINK:
        return ctx['drink_by_id'].get(str(entry_id))
    return None


def pairing_for(ctx, dish, brand_id):
    for pairing in ctx['pairings_by_dish'].get(dish['dish_id'], []):
        if pairing['brand_id'] == brand_id:
            return pairing
    return None


def make_suggestion(entry, ctx, reason='', pairs_with=None, score=None):
    """Карточка для ответа: название, подпись и оценка берутся из базы, не из текста модели."""
    if entry['kind'] == KIND_DISH:
        pairs_with = None
    dish = ctx['dish_by_id'].get(pairs_with) if pairs_with else None
    if dish is None:
        pairs_with = None
    if entry['kind'] == KIND_DRINK and dish is not None and score is None:
        pairing = pairing_for(ctx, dish, entry['brand_id'])
        score = pairing['score'] if pairing else None
    return {
        'kind': entry['kind'],
        'id': entry['id'],
        'title': entry['name'],
        'subtitle': entry['subtitle'],
        'reason': clean_text(reason, REASON_MAX_CHARS),
        'score': score,
        'pairs_with': pairs_with,
    }


# Обращение к Claude

def guest_state_text(ctx, cart, prefs, table):
    """Третий блок системного промпта: стол, заказ и пожелания. Он меняется, поэтому не кэшируется."""
    parts = []
    if table:
        parts.append('Стол: {}'.format(table))
    lines = []
    for item in cart or []:
        entry = lookup(ctx, item.get('kind'), item.get('id'))
        title = entry['name'] if entry else clean_text(item.get('title'), 200)
        if title:
            lines.append('{} x{}'.format(title, item.get('qty') or 1))
    if lines:
        parts.append('В заказе гостя: ' + ', '.join(lines))
    wishes = [label for key, label in PREF_LABELS if (prefs or {}).get(key)]
    if wishes:
        parts.append('Пожелания гостя: ' + ', '.join(wishes))
    if not parts:
        return ''
    return 'Состояние гостя сейчас:\n' + '\n'.join(parts)


def build_system(ctx, cart=None, prefs=None, table=None):
    """Системный промпт списком блоков: правила, кэшируемый контекст и текущее состояние гостя."""
    blocks = [
        {'type': 'text', 'text': SYSTEM_PROMPT},
        {'type': 'text', 'text': ctx['text'], 'cache_control': {'type': 'ephemeral'}},
    ]
    state = guest_state_text(ctx, cart, prefs, table)
    if state:
        blocks.append({'type': 'text', 'text': state})
    return blocks


def api_messages(messages):
    """История для API: первая реплика должна быть от гостя."""
    result = [{'role': m['role'], 'content': m['content']} for m in messages]
    while result and result[0]['role'] != 'user':
        result.pop(0)
    return result


def call_claude(system_blocks, messages, model=None):
    """Один запрос к модели. Возвращает текст ответа; ошибки SDK уходят вызывающему."""
    client = anthropic.Anthropic(timeout=REQUEST_TIMEOUT, max_retries=MAX_RETRIES)
    response = client.messages.create(
        model=model or ai_model(),
        max_tokens=MAX_TOKENS,
        system=system_blocks,
        messages=messages,
        # Для чата хватает низкого уровня усилий: ответ быстрее и дешевле
        extra_body={'output_config': {'effort': 'low'}},
    )
    return ''.join(block.text for block in response.content if getattr(block, 'type', '') == 'text').strip()


def extract_json(text):
    """JSON-объект из ответа модели: от первой { до последней }. None, если не разобрать."""
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start:end + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def salvage_reply(text):
    """Если JSON оборван, вытаскиваем хотя бы поле reply; иначе отдаём текст как есть."""
    match = re.search(r'"reply"\s*:\s*"((?:[^"\\]|\\.)*)', text)
    if match:
        try:
            return json.loads('"' + match.group(1) + '"').strip()
        except ValueError:
            return match.group(1).strip()
    return text.strip()


def validate_suggestions(raw, ctx):
    """Оставляем только id из контекста, без повторов; поля карточки заполняем из базы."""
    result = []
    seen = set()
    if not isinstance(raw, list):
        return result
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get('kind') or '').upper()
        entry = lookup(ctx, kind, item.get('id'))
        if entry is None or (kind, entry['id']) in seen:
            continue
        seen.add((kind, entry['id']))
        pairs_with = item.get('pairs_with')
        pairs_with = str(pairs_with) if pairs_with else None
        result.append(make_suggestion(entry, ctx, item.get('reason'), pairs_with))
        if len(result) >= MAX_SUGGESTIONS:
            break
    return result


def parse_model_reply(text, ctx):
    """Ответ модели -> {reply, suggestions}. Без разборного JSON весь текст идёт в reply."""
    text = (text or '').strip()
    if not text:
        return None
    data = extract_json(text)
    if data is None:
        reply = salvage_reply(text)
        return {'reply': reply[:REPLY_MAX_CHARS], 'suggestions': []} if reply else None
    reply = clean_text(data.get('reply'), REPLY_MAX_CHARS)
    suggestions = validate_suggestions(data.get('suggestions'), ctx)
    if not reply and not suggestions:
        return None
    if not reply:
        reply = 'Вот что я бы предложил.'
    return {'reply': reply, 'suggestions': suggestions}


# Локальный подбор на правилах

BITTER_RE = re.compile(r'\bipa\b|pils|пилс|bitter|горьк', re.I)
WHEAT_RE = re.compile(r'wheat|weiss|weizen|\bwit|пшенич', re.I)
LAGER_RE = re.compile(r'lager|лагер', re.I)
DARK_RE = re.compile(r'dark|dunkel|amber|bock|stout|porter|strong|темн|янтар|крепк', re.I)
SWEET_RE = re.compile(r'amber|honey|sweet|мед|янтар', re.I)
ZERO_RE = re.compile(r'0[.,]0|non-?alco|alcohol.?free|безалко', re.I)
DRINK_INTENT_RE = re.compile(r'напит|пив|запить|подобр|к заказ|к нему|к ним|к этому|к моему|к ней')
WISH_PATTERNS = (
    ('zero', re.compile(r'без\s*алкогол|безалкогол|нулев|0[.,]0')),
    ('nobitter', re.compile(r'не\s+люблю\s+горьк|без\s+гореч|не\s+горьк|без\s+горьк|негорьк|помягче')),
    ('light', re.compile(r'легк|освеж|жарк|полегче')),
    ('spicy', re.compile(r'остр')),
    ('dessert', re.compile(r'десерт|сладк')),
    ('meat', re.compile(r'мяс|гриль')),
    ('advise', re.compile(r'что\s+посоветуешь|что\s+взять|голод|посоветуй|порекоменд|что\s+поесть|'
                          r'что\s+есть|что\s+заказать|ужин|обед|перекус')),
    # Настроение и вежливость: без модели отвечаем по-человечески, а не сразу списком
    ('sad', re.compile(r'расстал|грустн|тоск|одинок|устал|тяжел|разбит|плач|обид|плохо мне|мне плохо|печал')),
    ('celebrate', re.compile(r'праздн|день рожден|юбиле|повыш|отмеч|свадьб|годовщин|поздрав')),
    ('greet', re.compile(r'^(привет|здравствуй|добрый|хай|салам|салем|hello|hi)\b')),
    ('thanks', re.compile(r'спасибо|благодар|рахмет')),
)
MOOD_INTENTS = ('sad', 'celebrate', 'greet', 'thanks')


def normalize(text):
    return re.sub(r'[^\w\s]+', ' ', (text or '').lower().replace('ё', 'е'))


def name_stems(name):
    return set(word[:4] for word in normalize(name).split() if len(word) >= 4)


def find_mentioned_dishes(question, ctx):
    """Блюда из контекста, названные в вопросе: по полному имени или по 4-буквенной основе слова."""
    padded = ' ' + ' '.join(normalize(question).split()) + ' '
    found = []
    for dish in ctx['dishes']:
        name = ' '.join(normalize(dish['name']).split())
        if name and ' ' + name + ' ' in padded:
            found.append(dish)
            continue
        if any(stem in padded for stem in name_stems(dish['name'])):
            found.append(dish)
    return found


def is_zero(drink):
    return (drink['abv'] is not None and drink['abv'] <= 0.5) or bool(ZERO_RE.search(drink['name'] + ' ' + drink['style']))


def is_bitter(drink):
    return bool(BITTER_RE.search(drink['style'] + ' ' + drink['name']))


def fits_prefs(drink, prefs):
    if prefs.get('no_alcohol') and not is_zero(drink):
        return False
    if prefs.get('no_bitter') and is_bitter(drink):
        return False
    return True


def abv_key(drink):
    return (drink['abv'] is None, drink['abv'] or 0.0, drink['name'])


def light_key(drink):
    # Крепкие и тёмные стили в конец, затем по известной крепости; сорта без крепости после известных.
    return (bool(DARK_RE.search(drink['style'] + ' ' + drink['name'])),) + abv_key(drink)


def drink_candidates(ctx, prefs):
    pool = [d for d in ctx['drinks'] if d['is_available'] and fits_prefs(d, prefs)]
    if prefs.get('light'):
        pool.sort(key=light_key)
    return pool


def first_match(pool, pattern):
    for drink in pool:
        if pattern.search(drink['style'] + ' ' + drink['name']):
            return drink
    return None


def drink_for_dish(dish, ctx, prefs):
    """
    Лучшее сочетание сомелье среди сортов из карты (с учётом пожеланий), иначе эвристика движка:
    острое смягчает пшеничное, солёное и жареное освежает пилснер, плотное держит тёмный или крепкий лагер.
    Возвращает (напиток, объяснение, оценка, источник) или None.
    """
    listed = []
    for pairing in ctx['pairings_by_dish'].get(dish['dish_id'], []):
        drink = ctx['drink_by_brand'].get(pairing['brand_id'])
        if drink is not None and drink['is_available'] and fits_prefs(drink, prefs):
            listed.append((pairing, drink))
    listed.sort(key=lambda pd: (-pd[0]['score'], pd[1]['name']))
    if listed:
        pairing, drink = listed[0]
        reason = pairing['explanation'] or 'Сочетание из подборки нашего сомелье'
        return drink, reason, pairing['score'], 'pairing'

    pool = drink_candidates(ctx, prefs)
    if not pool:
        return None
    if dish['taste'] == 'SPICY':
        pick = first_match(pool, WHEAT_RE) or min(pool, key=light_key)
        reason = 'Острое блюдо мягче раскрывается с пшеничным или лёгким лагером'
    elif dish['taste'] == 'SALTY' or dish['cooking'] == 'FRIED':
        pick = (None if prefs.get('no_bitter') else first_match(pool, BITTER_RE)) or first_match(pool, LAGER_RE) or pool[0]
        reason = 'Солёное и жареное освежает чистый сухой лагер, он снимает жирность'
    elif dish['weight'] == 'HEAVY' or dish['taste'] == 'UMAMI':
        pick = first_match(pool, DARK_RE) or max(pool, key=lambda d: (d['abv'] or 0.0, d['name']))
        reason = 'К плотному блюду нужен более плотный или крепкий лагер: солод поддержит вкус'
    else:
        pick = first_match(pool, LAGER_RE) or pool[0]
        reason = 'Универсальный лагер не спорит с блюдом и освежает'
    return pick, reason, None, 'engine'


def describe(entry):
    if entry.get('subtitle'):
        return '{} ({})'.format(entry['name'], entry['subtitle'].replace(' · ', ', '))
    return entry['name']


def best_listed_score(ctx, dish):
    scores = [p['score'] for p in ctx['pairings_by_dish'].get(dish['dish_id'], [])
              if p['brand_id'] in ctx['drink_by_brand']]
    return max(scores) if scores else 0


def popular_dishes(ctx, limit=2, pool=None):
    dishes = [d for d in (ctx['dishes'] if pool is None else pool) if d['is_available']]
    dishes.sort(key=lambda d: (-best_listed_score(ctx, d), d['name']))
    return dishes[:limit]


def dish_with_drink(dish, ctx, prefs, suggestions, dish_reason):
    """Карточка блюда и карточка напитка к нему; возвращает текст вида «Блюдо с Напитком»."""
    suggestions.append(make_suggestion(dish, ctx, dish_reason))
    pick = drink_for_dish(dish, ctx, prefs)
    if pick is None:
        return describe(dish)
    drink, reason, score, _ = pick
    suggestions.append(make_suggestion(drink, ctx, reason, dish['id'], score))
    return '{} с {}'.format(describe(dish), drink['name'])


def no_alcohol_line(ctx):
    return 'Безалкогольных сортов в карте этого бара сейчас нет.' if ctx['venue'] else \
        'Безалкогольных сортов в каталоге сейчас нет.'


def reply_for_dishes(targets, ctx, prefs, from_cart):
    sentences = []
    suggestions = []
    for dish in targets[:3]:
        pick = drink_for_dish(dish, ctx, prefs)
        if pick is None:
            continue
        drink, reason, score, source = pick
        lead = 'К блюду «{}» из вашего заказа'.format(dish['name']) if from_cart else 'К блюду «{}»'.format(dish['name'])
        sentence = '{} советую {}: {}.'.format(lead, describe(drink), lower_first(reason).rstrip('.'))
        if source == 'pairing':
            sentence += ' Это пара от нашего сомелье, оценка {} из 5.'.format(score)
        if not dish['is_available'] and not from_cart:
            sentence += ' Учтите: этого блюда сегодня нет в наличии.'
        sentences.append(sentence)
        suggestions.append(make_suggestion(drink, ctx, reason, dish['id'], score))
    if not suggestions:
        if prefs.get('no_alcohol'):
            reply = no_alcohol_line(ctx) + ' Поэтому напиток к блюду не предлагаю; если передумаете, подскажу самый лёгкий сорт.'
        else:
            reply = ('Подходящего напитка к этому блюду в карте сейчас нет. '
                     'Скажите, что вам ближе, полегче или поплотнее, и я подберу из того, что есть.')
        return reply, suggestions
    if len(sentences) == 1:
        sentences.append('Если хотите второй вариант или что-то полегче, скажите.')
    return ' '.join(sentences), suggestions


def local_sommelier(question, ctx, cart=None, prefs=None):
    """
    Подбор без модели. Порядок: блюда из вопроса или из заказа -> напиток к ним; затем пожелания
    (лёгкое, без горечи, острое, десерт, мясо, без алкоголя, «что взять»); иначе два быстрых
    варианта и уточняющий вопрос. Возвращает {reply, suggestions}.
    """
    prefs = dict(prefs or {})
    q = ' '.join(normalize(question).split())
    wishes = [name for name, pattern in WISH_PATTERNS if pattern.search(q)]
    if 'zero' in wishes:
        prefs['no_alcohol'] = True
    if 'nobitter' in wishes:
        prefs['no_bitter'] = True
    if 'light' in wishes:
        prefs['light'] = True
    intent = next((w for w in wishes if w in ('spicy', 'dessert', 'meat', 'advise')), None)
    if intent is None and wishes:
        intent = wishes[0]
    if intent in MOOD_INTENTS and any(w not in MOOD_INTENTS for w in wishes):
        # «Устал, хочу чего-то лёгкого»: пожелание важнее настроения
        intent = next(w for w in wishes if w not in MOOD_INTENTS)

    cart_dishes = []
    for item in cart or []:
        entry = lookup(ctx, item.get('kind'), item.get('id'))
        if entry is not None and entry['kind'] == KIND_DISH and entry not in cart_dishes:
            cart_dishes.append(entry)

    targets = find_mentioned_dishes(question, ctx)
    from_cart = False
    if not targets and cart_dishes and (intent in (None, 'advise') or DRINK_INTENT_RE.search(q)):
        targets, from_cart = cart_dishes, True
    if targets:
        reply, suggestions = reply_for_dishes(targets, ctx, prefs, from_cart)
        return {'reply': reply, 'suggestions': suggestions}

    suggestions = []
    pool = drink_candidates(ctx, prefs)

    if intent == 'zero':
        zero = [d for d in pool if is_zero(d)][:2]
        if zero:
            for drink in zero:
                suggestions.append(make_suggestion(drink, ctx, 'Безалкогольный сорт из карты'))
            reply = 'Из безалкогольного есть {}. Скажите, к какому блюду подбираем, и я уточню выбор.'.format(
                ' и '.join(describe(d) for d in zero))
        else:
            reply = no_alcohol_line(ctx) + ' Могу предложить что-то из еды или подсказать самый лёгкий сорт, если передумаете.'
        return {'reply': reply, 'suggestions': suggestions}

    if prefs.get('no_alcohol') and not pool:
        return {'reply': no_alcohol_line(ctx) + ' Подберу блюдо, если скажете, чего хочется: мясного, лёгкого или сладкого.',
                'suggestions': suggestions}

    if intent == 'nobitter':
        ordered = sorted(pool, key=lambda d: (not WHEAT_RE.search(d['style']), not LAGER_RE.search(d['style']), light_key(d)))
        picks = ordered[:2]
        for drink in picks:
            suggestions.append(make_suggestion(drink, ctx, 'Мягкий сорт без выраженной горечи'))
        if picks:
            reply = 'Без выраженной горечи подойдут мягкие лагеры: {}. Скажите, что будете есть, и подберу точнее.'.format(
                ' и '.join(describe(d) for d in picks))
        else:
            reply = 'Сорта без выраженной горечи в карте сейчас нет. Скажите, что будете есть, и я предложу самый мягкий вариант из доступных.'
        return {'reply': reply, 'suggestions': suggestions}

    if intent == 'light':
        picks = sorted(pool, key=light_key)[:2]
        for drink in picks:
            suggestions.append(make_suggestion(drink, ctx, 'Один из самых лёгких сортов в карте'))
        light_dish = next((d for d in ctx['dishes'] if d['is_available'] and d['weight'] == 'LIGHT'), None)
        if light_dish is not None:
            suggestions.append(make_suggestion(light_dish, ctx, 'Лёгкое блюдо из меню'))
        if picks:
            reply = 'Самые лёгкие в карте: {}. Освежают и не перегружают.'.format(' и '.join(describe(d) for d in picks))
            if light_dish is not None:
                reply += ' Из еды в том же духе {}.'.format(describe(light_dish))
            reply += ' К чему подбираем?'
        else:
            reply = 'Лёгких напитков в карте сейчас нет. Могу предложить что-то из еды.'
        return {'reply': reply, 'suggestions': suggestions}

    if intent in MOOD_INTENTS and not targets:
        return mood_reply(intent, ctx, prefs, pool, suggestions)

    if intent == 'spicy':
        soft = [d for d in pool if not is_bitter(d)] or pool
        drink = first_match(pool, WHEAT_RE) or first_match(pool, SWEET_RE) or (min(soft, key=light_key) if soft else None)
        spicy_dishes = popular_dishes(ctx, 2, [d for d in ctx['dishes'] if d['taste'] == 'SPICY'])
        parts = []
        if drink is not None:
            suggestions.append(make_suggestion(drink, ctx, 'Мягкий сорт смягчает остроту'))
            parts.append('К острому берут пшеничное или мягкий лагер с лёгкой сладостью: {}.'.format(describe(drink)))
        for dish in spicy_dishes:
            suggestions.append(make_suggestion(dish, ctx, 'Острое блюдо из меню'))
        if spicy_dishes:
            parts.append('Из острого в меню: {}.'.format(' и '.join(describe(d) for d in spicy_dishes)))
        if not parts:
            parts.append('Острых блюд в меню сейчас нет, и напитков тоже не подобрать.')
        parts.append('Сказать подробнее про какое-то из них?')
        return {'reply': ' '.join(parts), 'suggestions': suggestions}

    if intent == 'dessert':
        desserts = popular_dishes(ctx, 2, [d for d in ctx['dishes'] if 'десерт' in d['section'].lower() or d['taste'] == 'SWEET'])
        drink = first_match(pool, DARK_RE) or (max(pool, key=lambda d: (d['abv'] or 0.0, d['name'])) if pool else None)
        parts = []
        for dish in desserts:
            suggestions.append(make_suggestion(dish, ctx, 'Десерт из меню'))
        if desserts:
            parts.append('Из десертов в меню: {}.'.format(' и '.join(describe(d) for d in desserts)))
        else:
            parts.append('Десертов в меню сейчас нет.')
        if drink is not None:
            suggestions.append(make_suggestion(drink, ctx, 'Солодовый сорт поддерживает сладкое', desserts[0]['id'] if desserts else None))
            parts.append('К сладкому хорошо идёт янтарный или более плотный лагер: {}.'.format(describe(drink)))
        return {'reply': ' '.join(parts), 'suggestions': suggestions}

    if intent == 'meat':
        meaty = popular_dishes(ctx, 2, [
            d for d in ctx['dishes']
            if 'гриль' in d['section'].lower() or d['cooking'] == 'GRILLED' or 'мяс' in d['category'].lower()
        ])
        if meaty:
            combos = [dish_with_drink(d, ctx, prefs, suggestions, 'Мясное блюдо из меню') for d in meaty]
            reply = 'Из мясного и гриля советую {}. Хотите, подберу что-то одно под ваш вкус?'.format(' или '.join(combos))
        else:
            reply = 'Мясных блюд и гриля в меню сейчас нет. Могу подобрать что-то другое, скажите, чего хочется.'
        return {'reply': reply, 'suggestions': suggestions}

    if intent == 'advise':
        picks = popular_dishes(ctx, 2)
        if picks:
            combos = [dish_with_drink(d, ctx, prefs, suggestions, 'Одно из самых удачных блюд по сочетаниям сомелье') for d in picks]
            reply = 'Если выбирать из меню, возьмите {}. Скажите, если хотите что-то полегче или без горечи, подберу другое.'.format(
                ' или '.join(combos))
        else:
            reply = 'Меню пока пустое, предложить нечего. Загляните позже.'
        return {'reply': reply, 'suggestions': suggestions}

    # Непонятный вопрос: два быстрых варианта и уточнение.
    picks = popular_dishes(ctx, 1)
    options = []
    if picks:
        options.append(dish_with_drink(picks[0], ctx, prefs, suggestions, 'Популярное блюдо из меню'))
    lightest = min(pool, key=light_key) if pool else None
    if lightest is not None and all(s['id'] != lightest['id'] for s in suggestions):
        suggestions.append(make_suggestion(lightest, ctx, 'Самый лёгкий сорт в карте'))
        options.append('{}, если хочется чего-то полегче'.format(describe(lightest)))
    reply = 'Могу подобрать блюдо или напиток к тому, что вы уже выбрали.'
    if options:
        reply += ' Например, {}.'.format(' или '.join(options))
    reply += ' Что вам ближе: поплотнее или полегче?'
    return {'reply': reply, 'suggestions': suggestions}


def mood_reply(intent, ctx, prefs, pool, suggestions):
    """Тёплый ответ на настроение или приветствие плюс одна-две мягкие подсказки."""
    if intent == 'thanks':
        return {'reply': 'Рад помочь. Если захотите подобрать что-то ещё, я рядом.', 'suggestions': []}
    if intent == 'greet':
        return {'reply': 'Здравствуйте! Я сомелье Flavor Tree: подберу блюдо и напиток к нему. '
                         'Назовите блюдо или скажите, чего хочется: поплотнее, полегче, поострее или без алкоголя.',
                'suggestions': []}
    if intent == 'sad':
        comfort = popular_dishes(ctx, 1, [d for d in ctx['dishes'] if 'десерт' in d['section'].lower() or d['taste'] == 'SWEET'])
        if not comfort:
            comfort = popular_dishes(ctx, 1)
        soft = min(pool, key=light_key) if pool else None
        parts = ['Сочувствую, такие вечера бывают. Еда и хороший бокал не решат всё, но согреют.']
        if comfort:
            suggestions.append(make_suggestion(comfort[0], ctx, 'Что-то тёплое и сладкое для настроения'))
            parts.append('Возьмите {}'.format(describe(comfort[0])))
            if soft is not None:
                suggestions.append(make_suggestion(soft, ctx, 'Мягкий и лёгкий, чтобы не перебивать вечер', comfort[0]['id']))
                parts[-1] += ' и {}, он мягкий и не давит.'.format(describe(soft))
            else:
                parts[-1] += '.'
        elif soft is not None:
            suggestions.append(make_suggestion(soft, ctx, 'Мягкий и лёгкий сорт'))
            parts.append('Возьмите {}, он мягкий и не давит.'.format(describe(soft)))
        parts.append('Если захотите поговорить о вкусах, я здесь.')
        return {'reply': ' '.join(parts), 'suggestions': suggestions}
    # celebrate
    picks = popular_dishes(ctx, 1)
    festive = first_match(pool, DARK_RE) or (max(pool, key=lambda d: (d['abv'] or 0.0, d['name'])) if pool else None)
    parts = ['Поздравляю! Для праздника советую взять что-то яркое.']
    if picks:
        suggestions.append(make_suggestion(picks[0], ctx, 'Одно из самых удачных блюд в меню'))
        parts.append('Например, {}'.format(describe(picks[0])))
        if festive is not None:
            suggestions.append(make_suggestion(festive, ctx, 'Плотный сорт под праздничный стол', picks[0]['id']))
            parts[-1] += ' и {} к нему.'.format(describe(festive))
        else:
            parts[-1] += '.'
    parts.append('Сколько вас за столом? Подберу на компанию.')
    return {'reply': ' '.join(parts), 'suggestions': suggestions}


# Точка входа

def answer(ctx, messages, cart=None, prefs=None, table=None):
    """Ответ сомелье: Claude, если есть ключ; иначе или при ошибке API локальный подбор."""
    question = messages[-1]['content']
    note = ''
    if ai_enabled():
        try:
            text = call_claude(build_system(ctx, cart, prefs, table), api_messages(messages))
            parsed = parse_model_reply(text, ctx)
            if parsed is not None:
                return {'reply': parsed['reply'], 'suggestions': parsed['suggestions'], 'mode': 'claude', 'note': ''}
            log.warning('ИИ-сомелье: пустой ответ модели, отвечает локальный подбор')
        except anthropic.APIError as exc:
            log.warning('ИИ-сомелье: ошибка API (%s), отвечает локальный подбор', exc.__class__.__name__)
        note = LOCAL_NOTE
    local = local_sommelier(question, ctx, cart, prefs)
    return {'reply': local['reply'], 'suggestions': local['suggestions'], 'mode': 'local', 'note': note}
