"""
Подбор сорта к блюду по правилам сочетания: вес к весу, горечь против жира, солод против остроты.

Тот же расчёт, что в мастере подбора на сайте (frontend/src/app/pages/landing/pairing-engine.data.ts),
перенесённый на сервер. Нужен там, где модели нет или она не ответила: ИИ-подбор пар в панели
и распознавание блюд по фото. Правки правил вносятся в оба файла.
"""
import re

WEIGHT_TARGET = {'LIGHT': 3.0, 'MEDIUM': 5.5, 'HEAVY': 8.0}
FAT_LOAD = {'LOW': 0, 'MEDIUM': 1, 'HIGH': 2}

PROFILE_KEYS = ('body', 'bitterness', 'freshness', 'sweetness', 'roast', 'strength')


def _profile(body, bitterness, freshness, sweetness, roast, strength):
    return {'body': body, 'bitterness': bitterness, 'freshness': freshness,
            'sweetness': sweetness, 'roast': roast, 'strength': strength}


# Стили идут от частного к общему: первое совпадение задаёт основу профиля.
STYLE_RULES = (
    (re.compile(r'imperial|стаут|stout|porter|портер', re.I), _profile(9, 6, 2, 6, 9, 7)),
    (re.compile(r'ipa|ипа|pale ale|пэйл', re.I), _profile(5, 9, 7, 3, 1, 6)),
    (re.compile(r'wheat|weiss|weizen|witbier|пшенич|белое', re.I), _profile(5, 2, 8, 5, 0, 4)),
    (re.compile(r'sour|gose|lambic|кисл', re.I), _profile(3, 2, 9, 3, 0, 4)),
    (re.compile(r'rice|рисов', re.I), _profile(2, 2, 8, 3, 0, 4)),
    (re.compile(r'radler|shandy|безалког|non-?alc|0[.,]0', re.I), _profile(2, 1, 9, 5, 0, 0)),
    (re.compile(r'bock|doppel|dunkel|amber|red|тёмн|темн', re.I), _profile(7, 3, 3, 7, 5, 7)),
    (re.compile(r'strong|крепк', re.I), _profile(8, 5, 3, 5, 3, 9)),
    (re.compile(r'pilsner|pils|пильзн|пилзн', re.I), _profile(4, 7, 8, 2, 0, 5)),
    (re.compile(r'czech|чешск', re.I), _profile(6, 5, 5, 6, 1, 5)),
    (re.compile(r'draft|разливн|бочков', re.I), _profile(4, 3, 7, 4, 0, 4)),
    (re.compile(r'lager|лагер', re.I), _profile(5, 4, 6, 4, 1, 5)),
    (re.compile(r'ale|эль', re.I), _profile(6, 5, 5, 5, 2, 6)),
)
NEUTRAL = _profile(5, 4, 5, 4, 1, 5)

# По каким словам в ноте видно, за какую характеристику она отвечает.
NOTE_WEIGHTS = (
    (re.compile(r'горч|горек|горьк|bitter', re.I), 'bitterness', 1.0),
    (re.compile(r'хмел|hop', re.I), 'bitterness', 0.6),
    (re.compile(r'солод|плотн|тело|malt|body', re.I), 'body', 1.0),
    (re.compile(r'карамел|мёд|мед|тоффи|caramel|honey', re.I), 'sweetness', 1.0),
    (re.compile(r'жжён|жжен|обжар|дым|кофе|шокол|roast', re.I), 'roast', 1.0),
    (re.compile(r'свеж|сух|чист|цитрус|лимон|fresh|crisp|citrus', re.I), 'freshness', 1.0),
    (re.compile(r'рисов|лёгк|легк|воздуш|rice', re.I), 'freshness', 0.6),
)

# Категория блюда по словам в названии, категории и описании.
CATEGORY_WORDS = (
    ('DESSERT', re.compile(r'десерт|торт|пирож|шокол|мороже|чизкейк|тирамису|сладк|штрудел|выпечк', re.I)),
    ('SOUP', re.compile(r'суп|рагу|бульон|сорпа|лапша|том ям|шурпа|борщ|солянк', re.I)),
    ('SEAFOOD', re.compile(r'рыб|морепрод|суши|ролл|креветк|лосос|тунец|мидии|краб|кальмар', re.I)),
    ('SALAD', re.compile(r'салат|овощ|зелен|зелён', re.I)),
    ('PIZZA', re.compile(r'пицц|паст|спагетт|лазан|фокачч|равиол', re.I)),
    ('STREET', re.compile(r'бургер|тако|шаурм|хот-?дог|сэндвич|стритфуд|самса|донер|буррито', re.I)),
    ('SNACK', re.compile(r'снек|тапас|сыр|орех|чипс|брецел|крендел|сухар|гренк|начос', re.I)),
    ('MEAT', re.compile(r'мяс|стейк|шашлык|рёбр|ребр|казы|куырдак|шницел|бешбармак|колбас|бекон|гриль|птиц|кури', re.I)),
)


def clamp10(value):
    return max(0.0, min(10.0, float(value)))


def beer_profile(brand, notes=None):
    """
    Пиво в шести числах 0-10: основа от стиля, поправка от крепости, уточнение от пирамиды.
    notes: список (название, термин, описание, интенсивность); по умолчанию берётся из brand.flavor_profiles.
    """
    # Плотность в строку не берём: «10.0%» читалось бы как безалкогольное «0.0»
    style = ' '.join([brand.style or '', brand.name or ''])
    base = NEUTRAL
    for pattern, values in STYLE_RULES:
        if pattern.search(style):
            base = values
            break
    p = dict(base)

    # Крепость - самый надёжный признак тела: он есть почти у каждого сорта.
    if brand.abv is not None and brand.abv > 0:
        p['strength'] = clamp10((brand.abv - 2.5) * 1.6)
        p['body'] = clamp10(p['body'] * 0.65 + p['strength'] * 0.35)

    if notes is None:
        notes = [
            (fp.flavor_note.name, fp.flavor_note.technical_term, fp.flavor_note.description, fp.intensity)
            for fp in brand.flavor_profiles.all()
        ]
    for name, term, description, intensity in notes:
        text = ' '.join([name or '', term or '', description or ''])
        for pattern, field, k in NOTE_WEIGHTS:
            if pattern.search(text):
                p[field] = clamp10(p[field] * 0.55 + intensity * k * 0.45 + 1.2)
    return p


def dish_category(dish):
    """Категория мастера подбора (MEAT, SOUP, ...) по тексту блюда или None."""
    text = ' '.join([dish.get('name') or '', dish.get('category') or '', dish.get('description') or ''])
    for key, pattern in CATEGORY_WORDS:
        if pattern.search(text):
            return key
    return None


def score_beer(profile, dish):
    """
    Совместимость сорта (профиль из beer_profile) с блюдом.
    dish: словарь с ключами taste, weight, fat, cooking и текстом name, category, description.
    Возвращает (балл 0-100, тип пары, объяснения по убыванию веса).
    """
    b = profile
    taste, weight, fat, cooking = dish.get('taste'), dish.get('weight'), dish.get('fat'), dish.get('cooking')
    category = dish_category(dish)
    reasons = []
    score = 50.0
    pair = {'type': 'COMPLEMENT', 'weight': 0}

    def set_type(kind, w):
        if w > pair['weight']:
            pair['type'], pair['weight'] = kind, w

    # 1. Вес к весу - базовое правило сочетания.
    if weight in WEIGHT_TARGET:
        gap = abs(b['body'] - WEIGHT_TARGET[weight])
        score += (2.5 - gap) * 9
        if gap <= 1.5 and weight == 'HEAVY':
            reasons.append((9, 'Плотное тело сорта держит вес сытного блюда и не теряется рядом с ним'))
            set_type('COMPLEMENT', 5)
        elif gap <= 1.5 and weight == 'LIGHT':
            reasons.append((9, 'Лёгкое тело не перебивает деликатный вкус: блюдо остаётся главным'))
            set_type('COMPLEMENT', 5)
        elif gap <= 1.5:
            reasons.append((7, 'Тело сорта совпадает по весу с блюдом: ни один не перетягивает внимание'))
            set_type('COMPLEMENT', 4)

    # 2. Жир и жарка: их снимают горечь и карбонизация.
    fat_load = FAT_LOAD.get(fat, 0)
    fat_load += 2 if cooking == 'FRIED' else 0
    fat_load += 1 if cooking == 'GRILLED' else 0
    fat_load += 1 if category in ('STREET', 'PIZZA') else 0
    if fat_load >= 2:
        cleansing = (b['bitterness'] + b['freshness']) / 2
        score += (cleansing - 4) * 3.2 * min(fat_load, 4) / 2
        if cleansing >= 6:
            reasons.append((10, 'Горчинка и живая карбонизация смывают жир и обновляют вкус перед каждым новым куском'))
            set_type('CLEANSE', 6)

    # 3. Острое. Горечь и спирт усиливают жжение, солод и холод гасят.
    if taste == 'SPICY':
        score -= b['bitterness'] * 2.2 + b['strength'] * 1.8
        score += b['sweetness'] * 2.4 + b['freshness'] * 2.0
        if b['bitterness'] <= 5 and b['strength'] <= 6:
            reasons.append((10, 'Мягкий солод и низкая горечь гасят остроту: хмель и крепость её бы только разогнали'))
            set_type('CONTRAST', 7)

    # 4. Сладкое: десерту нужен солод, иначе пиво покажется пустым и кислым.
    if taste == 'SWEET' or category == 'DESSERT':
        score += (b['sweetness'] - 4) * 3.6 + (b['roast'] - 2) * 2.2 - max(0, b['bitterness'] - 5) * 2.4
        if b['sweetness'] >= 5 or b['roast'] >= 4:
            reasons.append((9, 'Карамельный и жжёный солод перекликаются со сладостью десерта, не споря с ней'))
            set_type('COMPLEMENT', 6)

    # 5. Мясо, гриль и копчение: у корочки и тёмного солода общая нота.
    # Деликатное умами (суши, блюда на пару, лёгкие закуски) сюда не относится: ему плотный сорт только мешает.
    delicate = cooking in ('RAW', 'STEAMED') or category in ('SALAD', 'SEAFOOD') or weight == 'LIGHT'
    if (taste == 'UMAMI' and not delicate) or category == 'MEAT' or cooking in ('GRILLED', 'CURED'):
        score += (b['body'] - 4) * 2.4 + (b['roast'] - 1) * 2.0 + (b['sweetness'] - 3) * 1.4
        if b['roast'] >= 3 or b['sweetness'] >= 5:
            reasons.append((8, 'Поджаренный солод повторяет карамельную корочку с огня: вкусы сходятся в одной ноте'))
            set_type('BRIDGE', 6)

    # 6. Сырое, на пару, салаты, рыба: главное не перебить.
    if cooking in ('RAW', 'STEAMED') or category in ('SALAD', 'SEAFOOD'):
        score += (b['freshness'] - 4) * 3.4 - max(0, b['body'] - 5) * 2.6 - max(0, b['roast'] - 2) * 2.2
        if b['freshness'] >= 6 and b['body'] <= 5:
            reasons.append((9, 'Чистое сухое тело не забивает деликатный вкус и освежает между кусочками'))
            set_type('COMPLEMENT', 5)

    # 7. Солёное: сухой финиш снимает соль и возвращает аппетит.
    if taste == 'SALTY' or category == 'SNACK':
        score += (b['freshness'] - 4) * 2.6 + (b['bitterness'] - 3) * 1.8
        if b['freshness'] >= 6:
            reasons.append((8, 'Сухой финиш смывает соль и снова открывает аппетит: классика барной закуски'))
            set_type('CLEANSE', 5)

    # 8. Кислое и ферментация: острые кислоты не дружат с грубой горечью.
    if taste == 'SOUR' or cooking == 'FERMENTED':
        score += (b['freshness'] - 4) * 2.8 - max(0, b['bitterness'] - 6) * 2.4
        if b['freshness'] >= 6 and b['bitterness'] <= 6:
            reasons.append((7, 'Свежесть сорта подхватывает кислинку блюда, а мягкая горечь не даёт ей стать резкой'))
            set_type('BRIDGE', 4)

    # 9. Горькое блюдо: две горечи складываются и глушат друг друга.
    if taste == 'BITTER':
        score -= max(0, b['bitterness'] - 4) * 2.8
        score += (b['sweetness'] - 3) * 2.4
        if b['bitterness'] <= 5:
            reasons.append((7, 'Низкая горечь сорта уравновешивает горчинку блюда, а не удваивает её'))
            set_type('CONTRAST', 5)

    # 10. Суп: жидкое к жидкому, нужен сорт с характером.
    if category == 'SOUP':
        score += (b['bitterness'] - 3) * 1.8 + (b['freshness'] - 4) * 1.6
        if b['bitterness'] >= 5:
            reasons.append((6, 'Выраженная горчинка слышна даже после ложки горячего бульона'))
            set_type('CONTRAST', 4)

    if not reasons:
        reasons.append((1, 'Сбалансированный сорт: не спорит с блюдом и подойдёт как нейтральная пара'))

    reasons.sort(key=lambda item: -item[0])
    return max(0.0, min(100.0, score)), pair['type'], [text for _, text in reasons]


def rating_of(score):
    """Балл 0-100 в оценку 1-5, как у пар сомелье."""
    return max(1, min(5, int(round(score / 20.0))))


# Чем сорт заметен на вкус: по этим чертам объяснение к разным сортам читается по-разному.
TRAITS = (
    ('bitterness', 6.5, 'выраженная хмелевая горчинка'),
    ('sweetness', 6.0, 'солодовая сладость'),
    ('roast', 4.0, 'тона обжаренного солода'),
    ('freshness', 7.0, 'сухой свежий финиш'),
    ('strength', 7.0, 'заметная крепость'),
    ('body', 7.0, 'плотное тело'),
)
# Расчёт по правилам не ставит высшую оценку: 5 из 5 остаётся за сомелье.
RULES_MAX_RATING = 4


def brand_traits(profile, limit=2):
    """Самые заметные черты сорта словами, не больше limit."""
    found = [(profile[key] - threshold, text) for key, threshold, text in TRAITS if profile[key] >= threshold]
    found.sort(key=lambda item: -item[0])
    return [text for _, text in found[:limit]]


def explain(reason, profile):
    traits = brand_traits(profile)
    if not traits:
        return reason
    return '{}. У этого сорта {}'.format(reason.rstrip('.'), ' и '.join(traits))


def rank_brands(dish, brands, limit=3):
    """
    Лучшие сорта к блюду. brands: список (brand, profile). Порядок стабилен: балл, затем название.
    Возвращает список словарей brand, score (1-4), pairing_type, explanation.
    """
    scored = []
    for brand, profile in brands:
        points, kind, reasons = score_beer(profile, dish)
        scored.append((points, brand, kind, explain(reasons[0], profile)))
    scored.sort(key=lambda item: (-item[0], item[1].name))
    return [
        {'brand': brand, 'score': min(rating_of(points), RULES_MAX_RATING), 'pairing_type': kind, 'explanation': reason}
        for points, brand, kind, reason in scored[:limit]
    ]
