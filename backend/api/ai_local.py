"""
Локальный сомелье: ответ без модели, на вкусовом движке v2 и правилах.

Работает, когда ключа Claude нет, лимит на сегодня исчерпан или API недоступно, а также
отвечает на все реплики, где сработали правила безопасности (ai_safety). Понимает блюдо
(в том числе из заказа гостя или из прошлой реплики), бюджет («до 1500 тенге»), пожелания
(лёгкое, без горечи, горькое, тёмное, крепкое, без алкоголя), категорию (вино, сидр, чай)
и названия напитков. Отвечает на русском, казахском (базовые фразы) и английском.
"""
import re
from dataclasses import dataclass, field

from . import ai_engine as AE
from . import ai_safety
from .ai_texts import (
    category_label, detect_lang, format_abv, format_price, join_list, joined, safety_text, t,
)

KIND_DISH = 'DISH'
KIND_DRINK = 'DRINK'
REASON_MAX_CHARS = 300
# Ниже этого балла движок считает пару неудачной («не рекомендуем»): такой напиток к блюду не советуем.
MIN_SCORE = 48

WISH_PATTERNS = (
    ('zero', re.compile(r'без\s*алкогол|безалкогол|нулев|\b0 0\b|\b00\b|не\s+пью\b|non\s?alcoholic|alcohol\s?free'
                        r'|\bno\s+alcohol|алкогольсіз|ішпеймін')),
    ('nobitter', re.compile(r'не\s+люблю\s+горьк|без\s+гореч|не\s+горьк|без\s+горьк|негорьк|помягче|\bмягк'
                            r'|not\s+bitter|no\s+bitter|ащы\s+емес')),
    ('light', re.compile(r'легк|освеж|жарк|полегче|\blight\b|lighter|refresh|жеңіл|сергіт')),
    ('bitter', re.compile(r'горьк|гореч|хмелев|\bipa\b|bitter|hoppy')),
    ('dark', re.compile(r'темн|\bdark\b|стаут|портер|stout|porter|қара\s+сыра')),
    ('strong', re.compile(r'покрепче|крепк|\bstrong|күшті')),
    ('sweet', re.compile(r'сладк|\bsweet|тәтті')),
    ('spicy', re.compile(r'остр|\bspicy|\bhot\s+food')),
    ('dessert', re.compile(r'десерт|dessert')),
    ('meat', re.compile(r'\bмяс|гриль|\bmeat|\bgrill|\bет\b|етті')),
    ('advise', re.compile(r'что\s+посоветуешь|что\s+взять|голод|посоветуй|порекоменд|что\s+поесть|что\s+есть\b'
                          r'|что\s+заказать|ужин|обед|перекус|recommend|suggest|hungry|what\s+should|кеңес'
                          r'|не\s+жеймін|не\s+алсам|не\s+ұсынасыз')),
    ('celebrate', re.compile(r'праздн|день\s+рожден|юбиле|повыш|отмеч|свадьб|годовщин|поздрав|birthday|celebrat'
                             r'|туған\s+күн|мереке')),
    ('greet', re.compile(r'^(?:привет|здравствуй\w*|добрый\s+\w+|хай|салам|сәлем\w*|салем|hello|hi|hey)\b'
                         r'|^(?:кто\s+ты|ты\s+кто|who\s+are\s+you)')),
    ('thanks', re.compile(r'спасибо|благодар|рахмет|thank')),
    ('cheaper', re.compile(r'дешевл|подешевл|бюджетн|недорог|cheaper|\bcheap\b|арзан')),
    ('more', re.compile(r'\bеще\b|другое|другой|второй\s+вариант|альтернатив|another|other\s+option|\belse\b'
                        r'|\bтағы\b|басқа')),
)
MOOD_WISHES = ('light', 'nobitter', 'bitter', 'dark', 'strong', 'sweet')
DISH_WISHES = ('spicy', 'dessert', 'meat', 'advise', 'celebrate')
FOLLOW_UP_WISHES = frozenset({'cheaper', 'more', 'zero', 'light', 'nobitter', 'bitter', 'dark', 'strong', 'sweet'})

CATEGORY_PATTERNS = (
    ('wine', re.compile(r'\bвин[оаеу]\b|\bвина\b|\bwine|шарап|игрист|шампан|просекко|prosecco')),
    ('cider', re.compile(r'сидр|cider')),
    ('cocktail', re.compile(r'коктейл|cocktail')),
    ('spirit', re.compile(r'водк|виски|коньяк|\bром\b|текил|\bджин\b|whisk|vodka|cognac|tequila|\bgin\b')),
    ('kvass', re.compile(r'\bквас')),
    ('tea', re.compile(r'\bчай|\bчая\b|\btea\b|\bшай\b')),
    ('coffee', re.compile(r'кофе|coffee|капучино|латте|эспрессо')),
    ('water', re.compile(r'\bвод[аыу]\b|\bwater\b|\bсу\b')),
    ('lemonade', re.compile(r'лимонад|\bсок\b|\bсока\b|juice|lemonade')),
    ('beer', re.compile(r'\bпив|\bbeer|\bсыра|лагер|\blager|\bэль\b|\bale\b')),
)
CATEGORY_GROUPS = {
    'wine': {'wine', 'sparkling', 'fortified'},
    'beer': {'beer', 'radler'},
    'cider': {'cider'}, 'cocktail': {'cocktail'}, 'spirit': {'spirit', 'liqueur'}, 'kvass': {'kvass'},
    'tea': {'tea'}, 'coffee': {'coffee'}, 'water': {'water'}, 'lemonade': {'lemonade', 'soda'},
}
DRINK_WORDS_RE = re.compile(
    r'напит|\bпив|запить|выпить|попить|\bпить\b|\bвин[оау]|сидр|коктейл|\bbeer|\bwine|drink|cider|cocktail|\bсыра'
    r'|шарап|сусын|ішу|ішсем|\bквас|\bчай|кофе|лимонад|\bсок\b|\bвод[аыу]\b|\btea\b|coffee|water|juice'
    r'|к\s+нему|к\s+ней|к\s+ним|к\s+этому|к\s+заказу|к\s+моему|goes\s+with|pair')
FOOD_WORDS_RE = re.compile(
    r'блюд|\bеда\b|\bеды\b|поесть|закуск|кушать|съесть|\bfood\b|\bdish|\beat\b|snack|тағам|\bжеу\b')
OFFTOPIC_RE = re.compile(
    r'игнорир|забудь|инструкц|промпт|prompt|ignore\s+(?:all|previous|the)|стих|анекдот|погод|новост|курс\s+'
    r'(?:доллар|валют|тенге)|политик|напиши\s+(?:код|программ|сочинен|эссе)|weather|poem|\bjoke|write\s+(?:code|a)'
    r'|systems?\s+message|developer\s+mode|jailbreak|\bdan\b')
BUDGET_RE = re.compile(
    r'(?:до|не\s+дороже|дешевле|в\s+пределах|максимум|не\s+больше|under|up\s+to|below|less\s+than|max)\s*'
    r'(\d[\d\s]{1,6}\d|\d{3,})\s*(?:тг|тенге|₸|kzt|tenge|т\b)?')
BUDGET_KK_RE = re.compile(r'(\d[\d\s]{1,6}\d|\d{3,})\s*(?:тг|теңге|тенге|₸)\S*\s*(?:дейін|шейін)')
EFES_RE = re.compile(r'\befes\b')


def clean_text(value, limit):
    if not isinstance(value, str):
        return ''
    return value.strip()[:limit]


def parse_budget(text):
    raw = (text or '').lower()
    match = BUDGET_RE.search(raw) or BUDGET_KK_RE.search(raw)
    if not match:
        return None
    amount = int(re.sub(r'\D', '', match.group(1)))
    return amount if 200 <= amount <= 100000 else None


# Карточки

def make_suggestion(entry, ctx, reason='', pairs_with=None, score=None):
    """Карточка для ответа: название, подпись и оценка берутся из базы и движка, не из текста модели."""
    if entry['kind'] == KIND_DISH:
        pairs_with = None
    if pairs_with and pairs_with not in ctx['dish_by_id']:
        pairs_with = None
    drink = entry['kind'] == KIND_DRINK
    reason = clean_text(reason, REASON_MAX_CHARS)
    return {
        'kind': entry['kind'],
        'id': entry['id'],
        'title': entry['name'],
        'subtitle': entry.get('subtitle') or '',
        # В ответе объяснение стоит после двоеточия, а в карточке это отдельная фраза
        'reason': reason[:1].upper() + reason[1:],
        'score': score,
        'pairs_with': pairs_with,
        # Сорт каталога за напитком: ссылка «О напитке»; для остальных напитков движка ссылки нет
        'brand': entry.get('brand_id') if drink else None,
        'is_alcoholic': bool(drink and ai_safety.drink_is_alcoholic(entry)),
    }


def describe_drink(entry, ctx, lang):
    if ctx['venue']:
        extra = ', '.join(p for p in (entry.get('volume'), format_price(entry.get('price'))) if p)
    elif lang == 'ru':
        extra = ', '.join(p for p in (entry.get('style'), format_abv(entry.get('abv'))) if p)
    else:
        extra = format_abv(entry.get('abv'))
    return '{} ({})'.format(entry['name'], extra) if extra else entry['name']


def describe_dish(entry, ctx):
    if ctx['venue']:
        extra = ', '.join(p for p in (entry.get('portion'), format_price(entry.get('price'))) if p)
        return '{} ({})'.format(entry['name'], extra) if extra else entry['name']
    return entry['name']


# Разбор вопроса

@dataclass
class Plan:
    lang: str = 'ru'
    text: str = ''
    tokens: list = field(default_factory=list)
    wishes: set = field(default_factory=set)
    mood: str = ''
    category: str = ''
    budget: int = None
    efes: bool = False
    zero: bool = False
    dishes: list = field(default_factory=list)
    dish_source: str = ''
    missing: list = field(default_factory=list)
    similar: list = field(default_factory=list)
    drinks: list = field(default_factory=list)
    drinks_absent: list = field(default_factory=list)
    drink_intent: bool = False
    food_intent: bool = False
    # Без алкоголя по кнопке, словами или по правилам безопасности (ставит local_sommelier)
    no_alcohol: bool = False

    @property
    def mood_or_filter(self):
        return bool(self.mood or self.category or self.budget or self.zero or self.efes or 'cheaper' in self.wishes)


# Записи общего каталога (движок v2): и для чата без заведения, и чтобы узнать блюдо или напиток,
# которых нет в меню бара.

MEAT_PROTEINS = frozenset({'lamb', 'beef', 'pork', 'horse', 'chicken', 'poultry', 'game', 'offal', 'mixed_meat'})


def catalog_dish_entry(raw, order=0):
    vector = raw.get('vector') or {}
    category = raw.get('category') or ''
    return {
        'kind': KIND_DISH, 'id': raw['id'], 'dish_id': raw['id'], 'v2': raw['id'],
        'name': raw.get('display_name') or raw['name'], 'terms': AE.dish_terms(raw),
        'section': '', 'portion': '', 'price': None, 'is_available': True, 'chef_note': '',
        'category': category, 'subtitle': category,
        'is_dessert': bool(raw.get('is_dessert')), 'spicy': (vector.get('heat') or 0) >= 0.5,
        'meat': 'мяс' in category.lower() or raw.get('protein_source') in MEAT_PROTEINS,
        'kazakh': 'kazakh' in (raw.get('cuisine') or []), 'order': order,
    }


def catalog_drink_entry(raw, ds, brand_ids=None):
    from .engine_catalog import drink_style_label, is_alcoholic
    abv = raw.get('abv')
    category = raw.get('category')
    if category in AE.BEER_CATEGORIES or category == 'cider':
        style = drink_style_label(raw)
    else:
        style = (ds.params.get('labels', {}).get('category', {}).get(category) or category or '')
    relation = raw.get('efes_relation') or ''
    return {
        'kind': KIND_DRINK, 'id': raw['id'], 'v2': raw['id'],
        'brand_id': (brand_ids or {}).get(AE.norm(raw.get('name'))),
        'name': raw.get('display_name') or raw['name'], 'style': style, 'abv': abv, 'category': category,
        'efes_relation': relation, 'efes': relation in AE.EFES_OWN, 'is_alcoholic': is_alcoholic(abv, category),
        'price': None, 'volume': '', 'is_available': True,
        'wide': (raw.get('availability_kz') or {}).get('level') == 'wide',
        'rare_words': AE.rare_words(ds, raw.get('name')),
        'subtitle': joined(style, format_abv(abv)),
    }


_CATALOG = {}


def _catalog(ds):
    key = id(ds)
    cached = _CATALOG.get(key)
    if cached is not None and cached['ds'] is ds:
        return cached
    from .pairing.dataset_v2 import is_guest_visible
    dishes = [catalog_dish_entry(raw, i) for i, raw in enumerate(ds.dishes)]
    drinks = [catalog_drink_entry(raw, ds) for raw in ds.drinks
              if is_guest_visible(raw) and not ai_safety.is_energy({'name': raw.get('name'), 'v2': raw['id']})]
    _CATALOG.clear()
    _CATALOG[key] = {'ds': ds, 'dishes': dishes, 'drinks': drinks}
    return _CATALOG[key]


def catalog_dish_entries(ds):
    """Все блюда движка как записи чата (кэш на набор)."""
    return _catalog(ds)['dishes']


def catalog_drink_entries(ds):
    """Напитки движка, видимые гостю, без энергетиков (кэш на набор, без ссылок на сорта каталога)."""
    return _catalog(ds)['drinks']


def dishes_in(text, ctx):
    return AE.find_named(AE.tokens(text), ctx['dishes'])


def make_plan(messages, ctx, cart=None, prefs=None, ds=None):
    prefs = prefs or {}
    question = messages[-1]['content'] if messages else ''
    plan = Plan(lang=detect_lang(question))
    plan.tokens = AE.tokens(question)
    plan.text = ' '.join(plan.tokens)
    wishes = {name for name, pattern in WISH_PATTERNS if pattern.search(plan.text)}
    if 'nobitter' in wishes:
        wishes.discard('bitter')
    if prefs.get('no_bitter'):
        wishes.add('nobitter')
        wishes.discard('bitter')
    if prefs.get('light'):
        wishes.add('light')
    plan.wishes = wishes
    plan.zero = 'zero' in wishes or bool(prefs.get('no_alcohol'))
    plan.mood = next((m for m in MOOD_WISHES if m in wishes), '')
    plan.category = next((name for name, pattern in CATEGORY_PATTERNS if pattern.search(plan.text)), '')
    plan.budget = parse_budget(question)
    plan.efes = bool(EFES_RE.search(plan.text))
    plan.drink_intent = bool(DRINK_WORDS_RE.search(plan.text))
    plan.food_intent = bool(FOOD_WORDS_RE.search(plan.text))

    found = AE.find_named(plan.tokens, ctx['dishes'])
    if ctx['venue'] and ds is not None:
        # Блюдо, которого нет в меню («пицца пепперони» при одной «Маргарите»): честно говорим, что его нет,
        # а блюдо меню, узнанное только по общему слову, предлагаем как похожее.
        named = AE.find_named(plan.tokens, catalog_dish_entries(ds))
        on_menu = {d.get('v2') for d in ctx['dishes'] if d.get('v2')}
        plan.missing = [d for d in named if d['v2'] not in on_menu]
        if plan.missing:
            named_ids = {d['v2'] for d in named}
            plan.similar = [d for d in found if d.get('v2') and d['v2'] not in named_ids]
            found = [d for d in found if d not in plan.similar]
    plan.dishes = found
    if plan.dishes:
        plan.dish_source = 'question'

    plan.drinks = AE.find_drinks(plan.tokens, ctx['drinks'])
    if ctx['venue'] and ds is not None:
        listed = {AE.norm(d['name']) for d in plan.drinks}
        listed_words = {w for d in plan.drinks for w in AE.norm(d['name']).split()}
        plan.drinks_absent = [
            d for d in AE.find_drinks(plan.tokens, catalog_drink_entries(ds))
            if AE.norm(d['name']) not in listed
            and not set(AE.norm(d['name']).split()) & listed_words & set(d.get('rare_words') or ())]

    if plan.efes and (plan.mood or plan.category):
        # «Какое пиво Efes самое горькое»: Efes здесь фильтр по портфелю, а не название одного сорта
        def named_beyond_efes(drink):
            return bool((set(drink.get('rare_words') or ()) - {'efes'}) & set(plan.tokens))
        plan.drinks = [d for d in plan.drinks if named_beyond_efes(d)]
        plan.drinks_absent = [d for d in plan.drinks_absent if named_beyond_efes(d)]

    if not plan.dishes and not plan.missing:
        cart_dishes = []
        for item in cart or []:
            entry = ctx['dish_by_id'].get(str(item.get('id'))) if str(item.get('kind')).upper() == KIND_DISH else None
            if entry is not None and entry not in cart_dishes:
                cart_dishes.append(entry)
        dish_wish = any(w in wishes for w in ('spicy', 'dessert', 'meat', 'celebrate'))
        asks_drink = plan.drink_intent or not wishes or 'advise' in wishes
        if cart_dishes and not plan.drinks and not dish_wish and asks_drink:
            plan.dishes, plan.dish_source = cart_dishes, 'cart'
        elif len(plan.tokens) <= 7 and (wishes & FOLLOW_UP_WISHES or plan.category or plan.budget) and not plan.drinks:
            # «А подешевле есть?» после вопроса про шашлык: блюдо из прошлых реплик гостя
            for message in reversed(messages[:-1]):
                if message.get('role') != 'user':
                    continue
                found = dishes_in(message.get('content') or '', ctx)
                if found:
                    plan.dishes, plan.dish_source = found, 'history'
                    break
    return plan


# Подбор

def allowed_fn(plan, safety):
    """Что можно предлагать: в наличии, не энергетик, без алкоголя при флагах и пожелании."""
    def allowed(entry):
        if not entry.get('is_available', True) or ai_safety.is_energy(entry):
            return False
        if safety is not None and safety.kinds and not safety.allows(entry):
            return False
        if plan.zero and ai_safety.drink_is_alcoholic(entry):
            return False
        return True
    return allowed


def category_ok(entry, plan):
    if not plan.category:
        return True
    group = set(CATEGORY_GROUPS.get(plan.category, {plan.category}))
    if plan.category == 'beer' and plan.zero:
        group = {'na_beer'}
    return entry.get('category') in group


# Чай, вода и газировка: к блюду без просьбы гостя их первыми не ставим, если рядом есть сорт не хуже.
SOFT_CATEGORIES = frozenset({'tea', 'coffee', 'water', 'soda', 'lemonade', 'dairy'})
SOFT_WINDOW = 12


def drink_kind(entry):
    """Род напитка для «а подешевле?»: не меняем пиво на чай или на 0.0."""
    if entry.get('category') in SOFT_CATEGORIES:
        return 'soft'
    return 'alcohol' if ai_safety.drink_is_alcoholic(entry) else 'zero'


def default_order(pool, plan):
    """
    Гость в баре спросил «что взять к шашлыку» без категории: если движок ставит первым чай или воду,
    а пиво (вино, сидр) отстаёт не больше чем на SOFT_WINDOW баллов, первым идёт напиток бара.
    """
    if plan.category or plan.no_alcohol or not pool or pool[0][0].get('category') not in SOFT_CATEGORIES:
        return pool
    top = pool[0][1]
    drinks = [r for r in pool if r[0].get('category') not in SOFT_CATEGORIES]
    if not drinks or (top is not None and drinks[0][1] is not None and drinks[0][1] < top - SOFT_WINDOW):
        return pool
    return drinks + [r for r in pool if r[0].get('category') in SOFT_CATEGORIES]


EFES_ORDER = {'own': 0, 'distribution': 1, 'cci': 2}


def efes_first(entry):
    """Свои марки Efes, затем дистрибуция, затем напитки партнёра CCI, затем остальные."""
    return EFES_ORDER.get(entry.get('efes_relation') or '', 3)


def ranked_for_dish(dish, ctx, ds, allowed):
    """[(drink, score 0-100 или None, объяснение, оценка 1-5)] к блюду: движок, иначе сочетания сомелье."""
    out = []
    seen = set()
    if dish.get('v2') and ds is not None:
        for entry, result in AE.rank_for_dish(ds, dish['v2'], ctx['drinks']):
            if allowed(entry):
                out.append((entry, result['score'], AE.guest_reason(result), AE.score5(result)))
                seen.add(entry['id'])
    # Сорта вне движка и блюда вне движка: старые сочетания сомелье, затем в конец списка
    pairings = sorted(ctx.get('pairings_by_dish', {}).get(dish.get('dish_id'), []), key=lambda p: -p['score'])
    for pairing in pairings:
        entry = ctx.get('drink_by_brand', {}).get(pairing['brand_id'])
        outside_engine = not entry.get('v2') or not dish.get('v2') if entry is not None else False
        if entry is not None and entry['id'] not in seen and allowed(entry) and outside_engine:
            out.append((entry, None, AE.lower_first(pairing['explanation'] or ''), pairing['score']))
            seen.add(entry['id'])
    if not out:
        rest = [e for e in ctx['drinks'] if e['id'] not in seen and allowed(e)]
        rest.sort(key=lambda e: (efes_first(e), AE.mood_key(ds, e, 'light'), e['name']))
        for entry in rest[:3]:
            out.append((entry, None, '', None))
    return out


def apply_filters(ranked, plan, ctx, ds):
    """Категория, пожелание и бюджет. Возвращает (список, ослаблен ли фильтр, бюджет не прошёл)."""
    relaxed = False
    pool = [r for r in ranked if category_ok(r[0], plan)]
    if plan.category and not pool:
        pool, relaxed = list(ranked), True
    if plan.mood:
        moody = [r for r in pool if AE.fits_mood(ds, r[0], plan.mood)]
        if moody:
            pool = moody
        else:
            relaxed = True
    if plan.efes:
        efes = [r for r in pool if r[0].get('efes')]
        pool = efes or pool
    budget_failed = False
    if plan.budget and ctx['venue']:
        cheap = [r for r in pool if r[0].get('price') is not None and float(r[0]['price']) <= plan.budget]
        if cheap:
            pool = cheap
        else:
            budget_failed = True
    pool = default_order(pool, plan)
    if 'cheaper' in plan.wishes and ctx['venue'] and pool:
        # «А подешевле?»: из того же рода напитков и не сильно хуже по баллу
        top, kind = pool[0][1], drink_kind(pool[0][0])
        near = [r for r in pool if (top is None or r[1] is None or r[1] >= top - 15) and drink_kind(r[0]) == kind]
        pool = sorted(near, key=lambda r: (float(r[0]['price']) if r[0].get('price') is not None else 1e9))
    return pool, relaxed, budget_failed


def best_efes_beer(ranked, first, zero=False):
    """Лучшее пиво портфеля Efes из подобранных (при «без алкоголя» их 0.0), если первым стоит не оно."""
    categories = ('na_beer',) if zero else ('beer', 'radler')
    if first.get('efes') and first.get('category') in categories:
        return None
    for row in ranked:
        entry = row[0]
        if entry is not first and entry.get('efes') and entry.get('category') in categories \
                and (row[1] is None or row[1] >= MIN_SCORE):
            return row
    return None


class Reply:
    """Собирает текст и карточки ответа."""

    def __init__(self, ctx, lang):
        self.ctx = ctx
        self.lang = lang
        self.parts = []
        self.suggestions = []

    def say(self, text):
        if text:
            self.parts.append(text)

    def card(self, entry, reason='', pairs_with=None, score=None):
        if any(s['kind'] == entry['kind'] and s['id'] == entry['id'] for s in self.suggestions):
            return
        self.suggestions.append(make_suggestion(entry, self.ctx, reason, pairs_with, score))

    def result(self, intent, dish=None):
        return {'reply': ' '.join(self.parts).strip(), 'suggestions': self.suggestions[:6], 'lang': self.lang,
                'intent': intent, 'dish': dish}


def pair_for_dish(out, dish, plan, ctx, ds, allowed, lead_key='pair_lead', with_efes=True):
    """Напиток к блюду с объяснением движка; второй вариант и лучшее пиво Efes, если уместно."""
    lang = plan.lang
    ranked = ranked_for_dish(dish, ctx, ds, allowed)
    pool, relaxed, budget_failed = apply_filters(ranked, plan, ctx, ds)
    if budget_failed:
        out.say(t('budget_none', lang, budget=format_price(plan.budget)))
    if not pool:
        if plan.no_alcohol and ctx['venue']:
            out.say(t('no_na_in_bar', lang))
        else:
            out.say(t('pair_none', lang, dish=dish['name']))
        return False
    if pool[0][1] is not None and pool[0][1] < MIN_SCORE:
        out.say(t('pair_weak', lang, dish=dish['name']))
        return False
    if relaxed:
        out.say(t('filter_relaxed', lang))
    entry, score, reason, score_5 = pool[0]
    if reason:
        out.say(t(lead_key, lang, dish=dish['name'], drink=describe_drink(entry, ctx, lang), reason=reason.rstrip('.')))
    else:
        out.say(t(lead_key + '_plain', lang, dish=dish['name'], drink=describe_drink(entry, ctx, lang)))
    if score is not None:
        out.say(t('pair_score', lang, score=score))
    out.card(entry, reason, dish['id'], score_5)
    shown = [entry]
    efes = best_efes_beer(pool, entry, plan.no_alcohol) \
        if with_efes and plan.category in ('', 'beer') and 'cheaper' not in plan.wishes else None
    if efes is not None:
        out.say(t('pair_efes', lang, drink=describe_drink(efes[0], ctx, lang)))
        out.card(efes[0], efes[2], dish['id'], efes[3])
        shown.append(efes[0])
    elif len(pool) > 1 and ('more' in plan.wishes or 'cheaper' in plan.wishes or plan.mood or len(plan.dishes) == 1):
        second = next((r for r in pool[1:] if (r[1] is None or r[1] >= MIN_SCORE)
                       and (r[0].get('category') != entry.get('category') or plan.category or ctx['venue'])), None)
        if second is not None:
            out.say(t('pair_second', lang, drink=describe_drink(second[0], ctx, lang)))
            out.card(second[0], second[2], dish['id'], second[3])
    if not dish.get('is_available', True) and plan.dish_source == 'question':
        out.say(t('dish_unavailable', lang, dish=dish['name']))
    return True


def list_drinks(ctx, ds, plan, allowed, limit=2):
    """Напитки без блюда: по пожеланию, категории или бюджету."""
    pool = [e for e in ctx['drinks'] if allowed(e) and category_ok(e, plan)]
    if not ctx['venue']:
        # В общем каталоге без категории держимся пива, а в списках только то, что реально продаётся в РК
        if not plan.category and not plan.zero:
            pool = [e for e in pool if e.get('category') in ('beer', 'radler')]
        pool = [e for e in pool if e.get('wide') or e.get('efes')] or pool
    if plan.efes:
        pool = [e for e in pool if e.get('efes')] or pool
    if plan.mood:
        # Нет ничего точно под пожелание: показываем ближайшее («самое горькое из того, что есть»)
        pool = [e for e in pool if AE.fits_mood(ds, e, plan.mood)] or pool
        pool.sort(key=lambda e: (AE.mood_key(ds, e, plan.mood), efes_first(e), e['name']))
    elif plan.zero:
        order = ai_safety.OPTION_ORDER['no_alcohol']
        pool.sort(key=lambda e: (order.index(e['category']) if e.get('category') in order else len(order),
                                 efes_first(e), not e.get('wide'), e['name']))
    else:
        pool.sort(key=lambda e: (efes_first(e), not e.get('wide'), e['name']))
    if plan.budget and ctx['venue']:
        # В пределах суммы: сначала то, о чём спросили (пиво, а не 0.0), и ближе к сумме гостя
        pool = [e for e in pool if e.get('price') is not None and float(e['price']) <= plan.budget]
        pool.sort(key=lambda e: (e.get('category') in SOFT_CATEGORIES | {'na_beer'} and not plan.zero,
                                 -float(e['price'])))
    elif 'cheaper' in plan.wishes and ctx['venue']:
        pool.sort(key=lambda e: float(e['price']) if e.get('price') is not None else 1e9)
    if plan.zero and not plan.mood:
        # По одному из категории: 0.0, лимонад, чай
        picked, cats = [], set()
        for entry in pool:
            if entry.get('category') not in cats:
                picked.append(entry)
                cats.add(entry.get('category'))
            if len(picked) >= limit + 1:
                break
        return picked
    return pool[:limit]


def safety_options(kind, ctx, allowed, exclude=(), limit=3):
    """Безалкогольные варианты по флагу: по одному из разрешённых категорий, свои Efes впереди."""
    order = ai_safety.OPTION_ORDER.get(kind) or ai_safety.OPTION_ORDER['no_alcohol']
    picked = []
    for category in order:
        group = [e for e in ctx['drinks'] if e.get('category') == category and e['id'] not in exclude and allowed(e)]
        if not ctx['venue']:
            group = [e for e in group if e.get('wide') or e.get('efes')] or group
        group.sort(key=lambda e: (efes_first(e), not e.get('wide'), len(e['name'])))
        if group:
            picked.append(group[0])
        if len(picked) >= limit:
            break
    return picked


def popular_dishes(ctx, ds, allowed, pool=None, limit=2):
    """Блюда, к которым в карте есть самая сильная пара по движку."""
    dishes = [d for d in (ctx['dishes'] if pool is None else pool) if d.get('is_available', True)]
    if not ctx['venue']:
        # В каталоге начинаем с казахской кухни: бешбармак, казы, шашлык
        dishes.sort(key=lambda d: (not d.get('kazakh'), d.get('order', 0)))
        return dishes[:limit]
    best = {}
    for dish in dishes:
        ranked = ranked_for_dish(dish, ctx, ds, allowed)
        if not ranked:
            best[dish['id']] = 0
        elif ranked[0][1] is not None:
            best[dish['id']] = ranked[0][1]
        else:
            best[dish['id']] = (ranked[0][3] or 0) * 15  # оценка сомелье 1-5 примерно в шкале движка
    dishes.sort(key=lambda d: (-best[d['id']], d['name']))
    return dishes[:limit]


def combos(out, dishes, plan, ctx, ds, allowed, dish_reason):
    texts = []
    for dish in dishes:
        out.card(dish, dish_reason)
        ranked = ranked_for_dish(dish, ctx, ds, allowed)
        pool, _, _ = apply_filters(ranked, plan, ctx, ds)
        pool = [r for r in pool if r[1] is None or r[1] >= MIN_SCORE]
        if pool:
            # Второе блюдо лучше показать с другим напитком, если он почти так же хорош
            used = {s['id'] for s in out.suggestions}
            fresh = next((r for r in pool if r[0]['id'] not in used
                          and (pool[0][1] is None or r[1] is None or r[1] >= pool[0][1] - 5)), None)
            entry, _, reason, score_5 = fresh or pool[0]
            out.card(entry, reason, dish['id'], score_5)
            texts.append(t('combo', plan.lang, dish=describe_dish(dish, ctx), drink=entry['name']))
        else:
            texts.append(describe_dish(dish, ctx))
    return join_list(texts, plan.lang, 'or')


def drink_facts_text(entry, ctx, lang):
    parts = []
    if entry.get('style'):
        parts.append(entry['style'] if lang == 'ru' else category_label(entry.get('category'), lang))
    if entry.get('abv') is not None:
        parts.append(format_abv(entry['abv']))
    if ctx['venue']:
        parts.extend(p for p in (entry.get('volume'), format_price(entry.get('price'))) if p)
    return ', '.join(parts)


def local_sommelier(messages, ctx, cart=None, prefs=None, safety=None, plan=None, ds=None):
    """
    Ответ без модели. Порядок: правила безопасности -> приветствие и спасибо -> вне темы ->
    названные напитки -> блюда (из вопроса, заказа или прошлой реплики) -> пожелания без блюда ->
    блюда по желанию (мясное, десерт, острое, «что взять», праздник) -> два быстрых варианта и вопрос.
    Возвращает {reply, suggestions, lang, intent, dish}.
    """
    if ds is None:
        ds = AE.dataset(plan.lang if plan else 'ru')
    if plan is None:
        plan = make_plan(messages, ctx, cart, prefs, ds)
    plan.no_alcohol = plan.zero or bool(safety is not None and safety.kinds)
    lang = plan.lang
    allowed = allowed_fn(plan, safety)
    out = Reply(ctx, lang)
    main_dish = plan.dishes[0] if plan.dishes else None

    # 1. Гость только что сказал о возрасте, руле, беременности, самочувствии: сначала забота
    if safety is not None and safety.kind and safety.fresh:
        out.say(safety_text(safety.kind, lang, fresh=True))
        exclude = []
        if main_dish is not None and safety.pairing_allowed:
            ranked = ranked_for_dish(main_dish, ctx, ds, allowed)
            if ranked:
                entry, _, reason, score_5 = ranked[0]
                out.say(t('safety_pair', lang, dish=main_dish['name'], drink=describe_drink(entry, ctx, lang),
                          reason=(reason or category_label(entry.get('category'), lang)).rstrip('.')))
                out.card(entry, reason, main_dish['id'], score_5)
                exclude.append(entry['id'])
        elif safety.pairing_allowed and (plan.wishes & {'advise', 'meat', 'dessert', 'spicy'} or plan.food_intent):
            # «Мне 16, что посоветуешь»: блюдо и безалкогольный напиток к нему
            picks = popular_dishes(ctx, ds, allowed, limit=1)
            if picks:
                text = combos(out, picks, plan, ctx, ds, allowed, t('reason_popular', lang))
                out.say(t('dishes_advise', lang, combos=text))
                exclude.extend(s['id'] for s in out.suggestions)
        options = safety_options(safety.kind, ctx, allowed, exclude, limit=2 if exclude else 3)
        if options:
            out.say(t('safety_options', lang, drinks=join_list([describe_drink(e, ctx, lang) for e in options], lang)))
            for entry in options:
                out.card(entry, category_label(entry.get('category'), lang).capitalize())
        elif not any(s['kind'] == KIND_DRINK for s in out.suggestions) and safety.kind != 'unwell':
            out.say(t('no_na_in_bar', lang) if ctx['venue'] else t('safety_water_tea', lang))
        if safety.allergy and safety.kind != 'gluten':
            out.say(t('allergy_note', lang))
        return out.result('safety', main_dish.get('v2') if main_dish else None)

    if safety is not None and safety.kind:
        out.say(safety_text(safety.kind, lang, fresh=False))

    related = bool(plan.dishes or plan.missing or plan.drinks or plan.drinks_absent or plan.category
                   or plan.budget or plan.drink_intent or plan.food_intent
                   or plan.wishes - {'greet', 'thanks'})

    # 2. Приветствие и спасибо без вопроса
    if not related and 'thanks' in plan.wishes:
        out.say(t('thanks', lang))
        return out.result('thanks')
    if not related and 'greet' in plan.wishes:
        out.say(t('greet_venue' if ctx['venue'] else 'greet_catalog', lang))
        return out.result('greet')

    # 3. Вне темы или попытка сменить роль
    if OFFTOPIC_RE.search(plan.text) and not (plan.dishes or plan.drinks) or (not related and len(plan.tokens) >= 6):
        out.say(t('offtopic', lang))
        return out.result('offtopic')

    if plan.budget and not ctx['venue']:
        out.say(t('budget_catalog', lang, budget=format_price(plan.budget)))

    # 4. Названные напитки без блюда: что это и к чему лучше
    if (plan.drinks or plan.drinks_absent) and not plan.dishes:
        for entry in plan.drinks_absent[:2]:
            out.say(t('drink_not_listed', lang, drink=entry['name']))
        for entry in plan.drinks[:2]:
            if not allowed(entry):
                continue
            out.say(t('drink_info', lang, drink=entry['name'], facts=drink_facts_text(entry, ctx, lang)))
            out.card(entry, entry.get('style') or '')
            dish_pool = ctx['dishes'] if ctx['venue'] else catalog_dish_entries(ds) if ds else []
            best = [(d, r) for d, r in AE.rank_dishes_for_drink(ds, entry.get('v2'), dish_pool)
                    if d.get('is_available', True)][:2] if ds else []
            if best:
                out.say(t('drink_best_dishes', lang, dishes=join_list([d['name'] for d, _ in best], lang)))
                if ctx['venue']:
                    for dish, result in best:
                        out.card(dish, AE.guest_reason(result))
        if len(plan.drinks) + len(plan.drinks_absent) >= 2:
            out.say(t('drink_compare', lang))
        elif plan.drinks and not out.suggestions:
            out.say(t('ask_dish', lang))
        if out.parts:
            return out.result('drink')

    # 5. Блюдо названо, есть в заказе или было в прошлой реплике
    if plan.missing and not plan.dishes:
        for dish in plan.missing[:2]:
            out.say(t('dish_not_on_menu', lang, dish=dish['name']))
        if plan.similar:
            out.say(t('dish_similar', lang, dish=plan.similar[0]['name']))
            pair_for_dish(out, plan.similar[0], plan, ctx, ds, allowed, with_efes=False)
        else:
            picks = popular_dishes(ctx, ds, allowed, limit=1)
            if picks:
                out.say(t('dishes_advise', lang, combos=combos(out, picks, plan, ctx, ds, allowed,
                                                               t('reason_popular', lang))))
            if plan.no_alcohol and ctx['venue'] and not any(s['kind'] == KIND_DRINK for s in out.suggestions):
                out.say(t('no_na_in_bar', lang))
        return out.result('dish_missing', plan.missing[0]['v2'])
    if plan.dishes:
        lead = 'pair_lead_cart' if plan.dish_source == 'cart' else 'pair_lead'
        for dish in plan.dishes[:2]:
            pair_for_dish(out, dish, plan, ctx, ds, allowed, lead, with_efes=len(plan.dishes) == 1)
        if safety is not None and safety.allergy:
            out.say(t('allergy_note', lang))
        return out.result('pairing', main_dish.get('v2'))

    # 6. Пожелания без блюда: без алкоголя, лёгкое, без горечи, категория, бюджет
    if plan.mood_or_filter and not any(w in plan.wishes for w in ('dessert', 'meat', 'spicy')):
        picks = list_drinks(ctx, ds, plan, allowed, limit=2)
        drinks_text = join_list([describe_drink(e, ctx, lang) for e in picks], lang)
        if not picks:
            out.say(t('no_na_in_bar', lang) if plan.zero and ctx['venue'] else t('list_none', lang))
        elif plan.budget and ctx['venue']:
            out.say(t('list_budget', lang, budget=format_price(plan.budget), drinks=drinks_text))
        elif plan.zero and not plan.mood:
            out.say(t('list_na', lang, drinks=drinks_text))
        elif plan.mood:
            out.say(t('list_' + plan.mood, lang, drinks=drinks_text))
        elif 'cheaper' in plan.wishes and ctx['venue']:
            out.say(t('cheaper_lead', lang, drinks=drinks_text))
        elif plan.category:
            out.say(t('list_category', lang, category=category_label(plan.category, lang), drinks=drinks_text))
        else:
            out.say(t('list_efes', lang, drinks=drinks_text))
        reason_key = 'reason_' + plan.mood if plan.mood else ('reason_zero' if plan.zero else '')
        for entry in picks:
            out.card(entry, t(reason_key, lang) if reason_key else
                     (entry.get('style') or category_label(entry.get('category'), lang)))
        if picks:
            out.say(t('ask_dish', lang))
        return out.result('drinks')

    # 7. Блюда по желанию
    dish_wish = next((w for w in DISH_WISHES if w in plan.wishes), '')
    if dish_wish:
        if dish_wish == 'dessert' or ('sweet' in plan.wishes and not plan.drink_intent):
            pool = [d for d in ctx['dishes'] if d.get('is_dessert')]
            key, reason = 'dishes_dessert', t('reason_dessert', lang)
        elif dish_wish == 'meat':
            pool = [d for d in ctx['dishes'] if d.get('meat')]
            key, reason = 'dishes_meat', t('reason_meat', lang)
        elif dish_wish == 'spicy':
            pool = [d for d in ctx['dishes'] if d.get('spicy')]
            key, reason = 'dishes_spicy', t('reason_spicy', lang)
        else:
            pool = None
            key, reason = ('celebrate' if dish_wish == 'celebrate' else 'dishes_advise'), t('reason_best', lang)
        if pool is not None and not pool:
            out.say(t('dishes_none', lang))
            return out.result(dish_wish)
        picks = popular_dishes(ctx, ds, allowed, pool, limit=1 if dish_wish == 'celebrate' else 2)
        if not picks:
            out.say(t('menu_empty', lang))
            return out.result(dish_wish)
        out.say(t(key, lang, combos=combos(out, picks, plan, ctx, ds, allowed, reason)))
        if plan.no_alcohol and ctx['venue'] and not any(s['kind'] == KIND_DRINK for s in out.suggestions):
            out.say(t('no_na_in_bar', lang))
        return out.result(dish_wish, picks[0].get('v2'))

    # 8. Непонятный вопрос: два быстрых варианта и уточнение
    out.say(t('unclear', lang))
    options = []
    picks = popular_dishes(ctx, ds, allowed, limit=1)
    if picks:
        options.append(combos(out, picks, plan, ctx, ds, allowed, t('reason_popular', lang)))
    light_plan = Plan(lang=lang, mood='light', zero=plan.zero)
    lightest = list_drinks(ctx, ds, light_plan, allowed, limit=1)
    if lightest and all(s['id'] != lightest[0]['id'] for s in out.suggestions):
        out.card(lightest[0], lightest[0].get('style') or '')
        options.append(describe_drink(lightest[0], ctx, lang))
    if options:
        out.say(t('unclear_options', lang, options=join_list(options, lang, 'or')))
    out.say(t('ask_closer', lang))
    return out.result('unclear')
