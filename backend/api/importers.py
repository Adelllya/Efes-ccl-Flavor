"""Импорт меню из выгрузок iiko / Poster / CSV → позиции каталога Flavor Tree (сорта и блюда с профилем вкуса).

ЗЕРКАЛО frontend/src/app/core/menu-import.ts: списки, пороги и порядок действий совпадают до символа,
паритет держит data/samples/expected_import.json (backend/api/tests/test_importers.py). Поменяли правило
здесь → поменяйте в TS и перегенерируйте эталон (cd frontend && node scripts/menu-import-test.mjs --update).

Вход недоверенный: лимиты размера и строк, управляющие символы вырезаются, никакого eval, имени файла не верим.
Результат детерминирован: только целочисленная арифметика и явные классы символов (без \\w \\d \\b —
в JS и Python они понимают кириллицу по-разному).
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from functools import lru_cache
from typing import Any

from .pairing.dataset import DATA_DIR

# ─────────────────────────────── лимиты и пороги ───────────────────────────────

MAX_BYTES = 2 * 1024 * 1024    # файл
MAX_CHARS = 2 * 1024 * 1024    # текст после декодирования
MAX_ROWS = 2000
MAX_PRICE_CENTS = 999999900    # 9 999 999 ₸ — влезает в Decimal(10, 2)
MAX_NAME, MAX_CATEGORY, MAX_VOLUME = 200, 80, 40
MATCH_MIN = 85        # от этой уверенности строка считается распознанной…
GAP_MIN = 10          # …если второй кандидат отстаёт хотя бы на столько
CANDIDATE_MIN = 60    # ниже — не кандидат
TOKEN_SIM_MIN = 70    # похожесть двух слов по биграммам (Dice, %)
SOFT_CAP = 70         # потолок для «другой сорт той же марки» и блюд из барных разделов
SYNONYM_WEIGHT = 90

ERRORS = {
    'too_large': 'Файл больше 2 МБ. Выгрузите только меню (без остатков и тех. карт) или разделите файл.',
    'empty': 'Файл пустой.',
    'bad_json': 'Не удалось прочитать JSON: файл повреждён или это не JSON.',
    'unknown_format': 'Не узнали формат. Поддерживаются JSON номенклатуры iiko, JSON Poster (menu.getProducts) и CSV с колонкой названия.',
    'no_name_column': 'В CSV не нашли колонку с названием позиции. Назовите её «Название» или «Наименование».',
    'too_many_rows': 'В файле больше 2000 позиций. Разделите выгрузку на части.',
    'no_rows': 'В файле нет позиций меню.',
}


class MenuImportError(Exception):
    """Понятная владельцу ошибка разбора; code — для тестов и клиента."""

    def __init__(self, code: str):
        super().__init__(ERRORS[code])
        self.code = code
        self.message = ERRORS[code]


# ─────────────────────────────── словари (зеркало menu-import.ts) ───────────────────────────────

# Написания марок, которые не выводятся из названия транслитом: (алиас, вес). Короткие формы — 90.
BEER_ALIASES: dict[str, list[tuple[str, int]]] = {
    'belyi-medved': [('бел медведь', 100)],
    'efes-pilsener': [('efes pilsner', 100), ('эфес пилзнер', 100), ('эфес пильзнер', 100), ('efes pils', 100), ('efes', 90)],
    'miller-genuine-draft': [('миллер дженьюин', 100), ('миллер генуин', 100), ('miller', 90), ('mgd', 90)],
    'kozel': [('kozel', 100)],
    'bremen-von-lustig': [('бремен фон лустиг', 100), ('bremen', 90)],
    'wukong-ju': [('wukong', 100)],
    'slavna-praga': [('славна прага', 100), ('praga', 90)],
    'legenda-777': [('legenda', 90)],
    '13-region': [('13й регион', 100), ('тринадцатый регион', 100)],
    'stary-melnik': [('старый мельник', 100)],
}

# Слова, которые не помогают отличить позицию: предлоги, тара, «пиво», единицы.
STOP_WORDS = ('с со из и на в во по к для от под а ля шт штук порция порц г гр кг мл л the with and of '
              'пиво пиву beer разливное разливной розлив разлив draft draught бутылка бутылочное бут банка баночное жб стб стекло '
              'светлое светлый lager лагер кега keg tap new новинка хит').split(' ')

# Признак другого сорта той же марки (тёмное, б/а, пшеничное…): профиль вкуса иной → только с подтверждением.
VARIANT_WORDS = ('темное темный темная dark черный черное cerny безалкогольное безалкогольный nonalcoholic '
                 'нефильтрованное нефильтрованный unfiltered пшеничное пшеничный wheat weiss weizen radler радлер '
                 'stout стаут porter портер ipa ale эль сидр cider').split(' ')

# Разделы, где блюд не бывает: совпадение с блюдом там — только с подтверждением («Маргарита» — коктейль).
DRINK_CATEGORIES = ('коктейли коктейль cocktails cocktail вино вина wine wines виски whisky whiskey водка vodka ром rum '
                    'джин gin текила tequila коньяк бренди ликеры ликер настойки настойка шоты шот shots напитки напиток drinks beverages '
                    'чай кофе tea coffee лимонады лимонад соки сок смузи кальян кальяны hookah алкоголь бар bar').split(' ')

PRE_FOLD = [('б/а', ' безалкогольное '), ('ст/б', ' стб '), ('с/б', ' стб '), ('ж/б', ' жб ')]

FOLD_MAP: dict[str, str] = {}
for _chars, _to in [
    ('ё', 'е'), ('ә', 'а'), ('ғ', 'г'), ('қ', 'к'), ('ң', 'н'), ('ө', 'о'), ('ұү', 'у'), ('һ', 'х'), ('і', 'и'),
    ('àáâãäåā', 'a'), ('çćč', 'c'), ('ďđ', 'd'), ('èéêëēěę', 'e'), ('ìíîïī', 'i'), ('łľ', 'l'), ('ñńň', 'n'),
    ('òóôõöøō', 'o'), ('řŕ', 'r'), ('śšş', 's'), ('ťţ', 't'), ('ùúûüūů', 'u'), ('ýÿ', 'y'), ('źžż', 'z'),
    ('ß', 'ss'), ('æ', 'ae'), ('œ', 'oe'),
]:
    for _ch in _chars:
        FOLD_MAP[_ch] = _to

TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
    'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh', 'ъ': '', 'ы': 'i',
    'ь': '', 'э': 'e', 'ю': 'iu', 'я': 'ia',
}
LATIN_FOLD = [('kh', 'h'), ('ph', 'f'), ('ck', 'k'), ('ts', 'c'), ('w', 'v'), ('y', 'i'), ('x', 'ks'), ('q', 'k')]

HEADER_CATEGORY = ['категор', 'групп', 'раздел', 'category', 'group', 'section']
HEADER_PRICE = ['цена', 'стоимость', 'прайс', 'price']
HEADER_PRICE_NOT = ['себестоим', 'закуп', 'cost']
HEADER_UNIT = ['ед', 'ед изм', 'ед измерения', 'единица', 'единица измерения', 'unit', 'units', 'measure', 'measure unit']
HEADER_VOLUME = ['объем', 'обьем', 'выход', 'вес', 'масса', 'литраж', 'порция', 'volume', 'weight', 'size', 'portion']
HEADER_NAME = ['название', 'наименование', 'блюдо', 'товар', 'позиция', 'продукт', 'номенклатура', 'тех карта', 'техкарта',
               'name', 'title', 'product', 'item', 'dish', 'product name', 'item name']
HEADER_NAME_PREFIX = ['наименование', 'название', 'name', 'product name', 'item name']


def importer_config() -> dict:
    """Для паритет-теста: словари и пороги обеих реализаций сверяются с эталоном."""
    return {
        'limits': {'max_bytes': MAX_BYTES, 'max_chars': MAX_CHARS, 'max_rows': MAX_ROWS, 'max_price_cents': MAX_PRICE_CENTS,
                   'max_name': MAX_NAME, 'max_category': MAX_CATEGORY, 'max_volume': MAX_VOLUME},
        'thresholds': {'match_min': MATCH_MIN, 'gap_min': GAP_MIN, 'candidate_min': CANDIDATE_MIN, 'token_sim_min': TOKEN_SIM_MIN,
                       'soft_cap': SOFT_CAP, 'synonym_weight': SYNONYM_WEIGHT},
        'errors': ERRORS, 'beer_aliases': {k: [list(a) for a in v] for k, v in BEER_ALIASES.items()},
        'stop_words': STOP_WORDS, 'variant_words': VARIANT_WORDS, 'drink_categories': DRINK_CATEGORIES,
        'pre_fold': [list(p) for p in PRE_FOLD], 'fold_map': FOLD_MAP, 'translit': TRANSLIT, 'latin_fold': [list(p) for p in LATIN_FOLD],
        'header': {'category': HEADER_CATEGORY, 'price': HEADER_PRICE, 'price_not': HEADER_PRICE_NOT, 'unit': HEADER_UNIT,
                   'volume': HEADER_VOLUME, 'name': HEADER_NAME, 'name_prefix': HEADER_NAME_PREFIX},
    }


# ─────────────────────────────── декодирование и очистка ───────────────────────────────

def decode_bytes(data: bytes) -> tuple[str, str]:
    """Байты файла → (текст, кодировка). UTF-8 (строго), UTF-16 по BOM, иначе Windows-1251 — так сохраняет Excel в СНГ."""
    if len(data) > MAX_BYTES:
        raise MenuImportError('too_large')
    if data[:3] == b'\xef\xbb\xbf':
        data = data[3:]
    elif data[:2] in (b'\xff\xfe', b'\xfe\xff'):
        be = data[:2] == b'\xfe\xff'
        body = data[2:]
        body = body[:len(body) - len(body) % 2]
        return body.decode('utf-16-be' if be else 'utf-16-le', errors='replace'), 'utf-16be' if be else 'utf-16le'
    try:
        return data.decode('utf-8'), 'utf-8'
    except UnicodeDecodeError:
        return data.decode('cp1251', errors='replace'), 'windows-1251'


# управляющие (кроме \t \n \r), C1, невидимые и bidi-символы, суррогаты и всё вне BMP, U+FFFD
RE_UNSAFE = re.compile('[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f'
                       '\u202a-\u202e\u2060-\u2064\ufeff\ud800-\udfff\ufffd-\uffff'
                       '\U00010000-\U0010ffff]')
RE_SPACES = re.compile('[ \t\n\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+')


def _sanitize(text: str) -> str:
    return RE_UNSAFE.sub('', text)


def _trim_spaces(s: str) -> str:
    return s.strip(' ')


def _clean_cell(value: Any, max_len: int) -> str:
    """Значение ячейки: только строка, без мусора, пробелы схлопнуты, длина ограничена."""
    if not isinstance(value, str):
        return ''
    return _trim_spaces(_trim_spaces(RE_SPACES.sub(' ', _sanitize(value)))[:max_len])


# ─────────────────────────────── числа: цена и объём ───────────────────────────────

def _is_digit(ch: str) -> bool:
    return ch != '' and '0' <= ch <= '9'


def _cents_from_parts(int_part: str, frac: str) -> int:
    if len(int_part) > 9:
        return 0
    cents = int(int_part or '0') * 100 + int((frac + '00')[:2])
    return 0 if cents > MAX_PRICE_CENTS else cents


RE_PRICE_CHUNK = re.compile('[0-9][0-9 .,]*')


def _parse_price_text(raw: str) -> int:
    """«1 490,00 ₸», «1,490.50», «1490 тг» → копейки. Отрицательное и мусор → 0."""
    s = _clean_cell(raw, 60)
    m = RE_PRICE_CHUNK.search(s)
    if not m:
        return 0
    if m.start() > 0 and s[m.start() - 1] in ('-', '\u2212'):
        return 0
    chunk = m.group(0).replace(' ', '')
    while chunk and not _is_digit(chunk[-1]):
        chunk = chunk[:-1]
    dot, comma = chunk.rfind('.'), chunk.rfind(',')
    sep = -1
    if dot >= 0 and comma >= 0:
        sep = max(dot, comma)                       # оба есть: последний — десятичный
    else:
        pos = max(dot, comma)
        if pos >= 0:
            many = chunk.find(chunk[pos]) != pos     # «1.490.000» — разделители тысяч
            if not many and len(chunk) - pos - 1 != 3:   # «1,490» — тысячи, «1490,5» — дробь
                sep = pos

    def digits(t: str) -> str:
        return t.replace('.', '').replace(',', '')

    if sep < 0:
        return _cents_from_parts(digits(chunk), '')
    return _cents_from_parts(digits(chunk[:sep]), digits(chunk[sep + 1:]))


def _num(v: Any) -> float | None:
    """Число из JSON (не bool, конечное, не астрономическое) → float, иначе None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if isinstance(v, int):
        return None if abs(v) > 10 ** 12 else float(v)
    return v if math.isfinite(v) else None


def _cents_from_number(v: Any) -> int:
    if isinstance(v, str):
        return _parse_price_text(v)
    f = _num(v)
    if f is None or f <= 0 or f > 1e9:
        return 0
    cents = math.floor(f * 100 + 0.5)
    return 0 if cents > MAX_PRICE_CENTS else cents


RE_MINOR = re.compile(' *([0-9]{1,12})(?:\\.[0-9]+)? *')


def _cents_from_minor(v: Any) -> int:
    """Poster отдаёт цены строкой в минорных единицах: "149000" = 1 490 ₸."""
    if not isinstance(v, str):
        f = _num(v)
        return math.floor(f + 0.5) if f is not None and 0 < f <= MAX_PRICE_CENTS else 0
    m = RE_MINOR.fullmatch(v)
    if not m:
        return 0
    cents = int(m.group(1))
    return 0 if cents > MAX_PRICE_CENTS else cents


def _price_from_cents(cents: int):
    return cents // 100 if cents % 100 == 0 else cents / 100


def _lower_keep(s: str) -> str:
    """Нижний регистр БЕЗ изменения длины строки (позиции совпадают с исходной) + «0,5» → «0.5»."""
    out = []
    n = len(s)
    for i in range(n):
        c = ord(s[i])
        if 0x41 <= c <= 0x5a or 0x0410 <= c <= 0x042f:
            out.append(chr(c + 32))
        elif c in (0x0401, 0x0451):
            out.append('е')
        elif c == 0x2c and i > 0 and i + 1 < n and _is_digit(s[i - 1]) and _is_digit(s[i + 1]):
            out.append('.')
        else:
            out.append(s[i])
    return ''.join(out)


def _thousandths(num: str) -> int:
    """«0.5» → 500 (тысячные). Длинные числа — не объём."""
    p = num.split('.')
    if len(p[0]) > 6:
        return -1
    return int(p[0]) * 1000 + int(((p[1] if len(p) > 1 else '') + '000')[:3])


RE_MEASURE = re.compile('(^|[^0-9a-zа-я.])([0-9]+(?:\\.[0-9]+)?) ?(мл|ml|литр[а-я]*|л|l|кг|kg|грамм[а-я]*|гр|г|g)(?=$|[^0-9a-zа-я])')
RE_BARE = re.compile('(^|[^0-9a-zа-я.,])([0-9]\\.[0-9]{1,3})(?=$|[^0-9a-zа-я%])(?! ?%)')


def _measure_from(th: int, unit: str, start: int, end: int) -> dict | None:
    if th < 0:
        return None
    kind, amount = 'ml', 0
    if unit in ('мл', 'ml'):
        amount = th // 1000
    elif unit in ('л', 'l') or unit[:4] == 'литр':
        amount = th
    elif unit in ('кг', 'kg'):
        kind, amount = 'g', th
    else:
        kind, amount = 'g', th // 1000
    return {'unit': kind, 'amount': amount, 'start': start, 'end': end} if 1 <= amount <= 100000 else None


def _find_measure(low: str) -> dict | None:
    """Первое «число + единица» в строке (уже после _lower_keep)."""
    for m in RE_MEASURE.finditer(low):
        start = m.start() + len(m.group(1))
        r = _measure_from(_thousandths(m.group(2)), m.group(3), start, m.end())
        if r:
            return r
    return None


def _find_bare_litres(low: str) -> dict | None:
    """«Эфес 0,5» — десятичное число без единицы: для пива это литры (0.1–3 л)."""
    for m in RE_BARE.finditer(low):
        th = _thousandths(m.group(2))
        start = m.start() + len(m.group(1))
        if 100 <= th <= 3000:
            return {'unit': 'ml', 'amount': th, 'start': start, 'end': start + len(m.group(2))}
    return None


def _format_measure(unit: str, amount: int) -> str:
    if unit == 'g':
        return f'{amount} г'
    whole, rem = amount // 1000, amount % 1000
    if rem == 0:
        return f'{whole} л'
    frac = ('00' + str(rem))[-3:]
    while frac[-1] == '0':
        frac = frac[:-1]
    return f'{whole}.{frac} л'


TRIM_CHARS = ' ,;:-\u2013\u2014/|.'
RE_EMPTY_BRACKETS = re.compile('\\( *\\)|\\[ *\\]')
RE_MANY_SPACES = re.compile(' +')


def _cut_out(name: str, start: int, end: int) -> str:
    """Название без вырезанного объёма: «Efes (0,5 л)» → «Efes»."""
    s = RE_MANY_SPACES.sub(' ', RE_EMPTY_BRACKETS.sub(' ', name[:start] + ' ' + name[end:]))
    t = s.strip(TRIM_CHARS)
    return _trim_spaces(name) if t == '' else t


def _unit_hint(words: list[str]) -> str:
    """Единица из заголовка колонки («Вес, г», «Объём») или из ячейки «Ед. изм.»."""
    def has(lst):
        return any(w in lst for w in words)
    if has(['мл', 'ml']):
        return 'ml'
    if has(['кг', 'kg']):
        return 'kg'
    if has(['л', 'l', 'литр', 'литры', 'литров', 'литра']):
        return 'l'
    if has(['г', 'гр', 'g', 'грамм', 'граммы', 'граммов']):
        return 'g'
    if has(['объем', 'обьем', 'литраж', 'volume']):
        return 'l'
    if has(['вес', 'выход', 'масса', 'weight', 'out']):
        return 'g'
    return ''


RE_BARE_NUMBER = re.compile('[0-9]+(?:\\.[0-9]+)?')
RE_HAS_NONZERO = re.compile('[1-9]')


def _measure_from_cell(raw: str, hint: str) -> dict:
    """Ячейка объёма/выхода: «0,5 л», «300», «6 шт». Голое число понимаем по подсказке единицы."""
    text = _clean_cell(raw, MAX_VOLUME)
    low = _lower_keep(text)
    m = _find_measure(low)
    if m:
        return {'unit': m['unit'], 'amount': m['amount'], 'text': _format_measure(m['unit'], m['amount'])}
    if hint and RE_BARE_NUMBER.fullmatch(low):
        th = _thousandths(low)
        unit = 'мл' if hint == 'l' and th >= 10000 else 'л' if hint == 'l' else 'мл' if hint == 'ml' else 'кг' if hint == 'kg' else 'г'
        r = _measure_from(th, unit, 0, 0)
        if r:
            return {'unit': r['unit'], 'amount': r['amount'], 'text': _format_measure(r['unit'], r['amount'])}
    return {'unit': '', 'amount': 0, 'text': text if RE_HAS_NONZERO.search(text) else ''}


# ─────────────────────────────── нормализация слов ───────────────────────────────

def _fold_words(s: str) -> list[str]:
    """Нижний регистр, ё→е, казахские и латинские диакритики → базовые буквы, всё кроме букв и цифр → пробел."""
    t = unicodedata.normalize('NFC', s).lower()
    for src, dst in PRE_FOLD:
        t = t.replace(src, dst)
    out = []
    for ch in t:
        f = FOLD_MAP.get(ch, ch)
        for c in f:
            out.append(c if ('a' <= c <= 'z') or ('0' <= c <= '9') or ('а' <= c <= 'я') else ' ')
    return [w for w in ''.join(out).split(' ') if w != '']


def _skeleton(word: str) -> str:
    """«Фонетический скелет»: кириллица → латиница, y/i/й/ы → i, удвоения схлопнуты. «Белый» = «Belyi» = «Beliy»."""
    t = ''.join(TRANSLIT.get(ch, ch) for ch in word)
    for src, dst in LATIN_FOLD:
        t = t.replace(src, dst)
    out = ''
    for ch in t:
        if out == '' or out[-1] != ch:
            out += ch
    return out


RE_NUMERIC = re.compile('[0-9]+')


def _is_numeric(w: str) -> bool:
    return RE_NUMERIC.fullmatch(w) is not None


def _bigrams(t: str) -> list[str]:
    out: list[str] = []
    for i in range(len(t) - 1):
        g = t[i:i + 2]
        if g not in out:
            out.append(g)
    return out


# ─────────────────────────────── индекс каталога ───────────────────────────────

class _Entry:
    __slots__ = ('slug', 'kind', 'order', 'phrases', 'vocab', 'words')

    def __init__(self, slug: str, kind: str, order: int):
        self.slug, self.kind, self.order = slug, kind, order
        self.phrases: list[tuple[list[int], int]] = []
        self.vocab: list[int] = []
        self.words: list[str] = []


class _Index:
    def __init__(self, catalog: dict):
        stop = set(STOP_WORDS)
        self.entries: list[_Entry] = []
        self.vocab: list[str] = []
        self.vocab_id: dict[str, int] = {}
        self.grams: list[int] = []
        self.postings: dict[str, list[int]] = {}
        self.by_vocab: list[list[int]] = []
        self.keep_numbers: list[str] = []

        def add(slug: str, kind: str, sources: list[tuple[str, int]]) -> None:
            entry = _Entry(slug, kind, len(self.entries))
            seen: list[str] = []
            for text, weight in sources:
                words = [w for w in _fold_words(_clean_cell(text, MAX_NAME)) if w not in stop]
                if not words:
                    continue
                ids = []
                for w in words:
                    sk = _skeleton(w)
                    id_ = self.vocab_id.get(sk)
                    if id_ is None:
                        id_ = len(self.vocab)
                        self.vocab.append(sk)
                        self.vocab_id[sk] = id_
                        self.by_vocab.append([])
                        grams = _bigrams(sk) if len(sk) >= 4 else []
                        self.grams.append(len(grams))
                        for g in grams:
                            self.postings.setdefault(g, []).append(id_)
                    if _is_numeric(w) and w not in self.keep_numbers:
                        self.keep_numbers.append(w)
                    if w not in entry.words:
                        entry.words.append(w)
                    ids.append(id_)
                key = ' '.join(str(i) for i in ids)
                if key in seen:          # тот же набор слов уже есть (с первым, большим весом)
                    continue
                seen.append(key)
                entry.phrases.append((ids, weight))
                for id_ in ids:
                    if id_ not in entry.vocab:
                        entry.vocab.append(id_)
                        self.by_vocab[id_].append(entry.order)
            self.entries.append(entry)

        for b in catalog['brands']:
            add(b['id'], 'BEER', [(b.get('display_name', ''), 100), (b.get('name', ''), 100)] + BEER_ALIASES.get(b['id'], []))
        for d in catalog['dishes']:
            add(d['id'], 'DISH', [(d.get('display_name', ''), 100), (d.get('name', ''), 100)]
                + [(s, SYNONYM_WEIGHT) for s in (d.get('synonyms') or [])])


# ─────────────────────────────── сопоставление строки ───────────────────────────────

def _token_sims(ix: _Index, sk: str, memo: dict[str, dict[int, int]]) -> dict[int, int]:
    cached = memo.get(sk)
    if cached is not None:
        return cached
    res: dict[int, int] = {}
    exact = ix.vocab_id.get(sk)
    if exact is not None:
        res[exact] = 100
    if len(sk) >= 4:    # короткие слова («ет», «ас», «13») — только точное совпадение
        grams = _bigrams(sk)
        counts: dict[int, int] = {}
        for g in grams:
            for id_ in ix.postings.get(g, []):
                counts[id_] = counts.get(id_, 0) + 1
        for id_, common in counts.items():
            if id_ == exact:
                continue
            dice = (200 * common) // (len(grams) + ix.grams[id_])
            if dice >= TOKEN_SIM_MIN:
                res[id_] = dice
    memo[sk] = res
    return res


def _best_sim(ids: list[int], s: dict[int, int]) -> int:
    v = 0
    for id_ in ids:
        x = s.get(id_, 0)
        if x > v:
            v = x
    return v


def _score_entry(entry: _Entry, sims: list[dict[int, int]]) -> int:
    row_sum = 0
    for s in sims:
        row_sum += _best_sim(entry.vocab, s)
    row_cov = row_sum // len(sims)
    top = 0
    for ids, weight in entry.phrases:
        total = 0
        for id_ in ids:
            v = 0
            for s in sims:
                x = s.get(id_, 0)
                if x > v:
                    v = x
            total += v
        cov = total // len(ids)
        score = cov * (80 + (20 * row_cov) // 100) // 100    # фраза найдена целиком + чем меньше лишних слов, тем выше
        if _best_sim(ids, sims[0]) > 0:                       # главное слово в меню стоит первым
            score += 3
        if score > 100:
            score = 100
        score = score * weight // 100
        if score > top:
            top = score
    return top


NO_MATCH = {'kind': '', 'status': 'unmatched', 'ref_slug': '', 'confidence': 0, 'candidates': []}


def _match_words(ix: _Index, words: list[str], drink_category: bool, memo: dict) -> dict:
    if not words:
        return NO_MATCH
    sims = [_token_sims(ix, _skeleton(w), memo) for w in words]
    hit: list[int] = []
    for s in sims:
        for id_ in s.keys():
            for e in ix.by_vocab[id_]:
                if e not in hit:
                    hit.append(e)
    hit.sort()
    variant = [w for w in words if w in VARIANT_WORDS]
    found: list[tuple[int, int, _Entry]] = []
    for e in hit:
        entry = ix.entries[e]
        score = _score_entry(entry, sims)
        if entry.kind == 'BEER' and any(w not in entry.words for w in variant) and score > SOFT_CAP:
            score = SOFT_CAP
        if entry.kind == 'DISH' and drink_category and score > SOFT_CAP:
            score = SOFT_CAP
        if score >= CANDIDATE_MIN:
            found.append((-score, entry.order, entry))
    if not found:
        return NO_MATCH
    found.sort(key=lambda f: (f[0], f[1]))
    kind = found[0][2].kind    # при равенстве пиво раньше блюд — оно первым в каталоге
    top = [f for f in found if f[2].kind == kind][:3]
    sure = -top[0][0] >= MATCH_MIN and (len(top) < 2 or (-top[0][0]) - (-top[1][0]) >= GAP_MIN)
    return {'kind': kind, 'status': 'matched' if sure else 'ambiguous', 'ref_slug': top[0][2].slug if sure else '',
            'confidence': -top[0][0], 'candidates': [{'slug': f[2].slug, 'confidence': -f[0]} for f in top]}


# ─────────────────────────────── сырые строки из форматов ───────────────────────────────

def _is_object(v: Any) -> bool:
    return isinstance(v, dict)


def _raw(line: int, name: str, category: str, cents: int, unit: str = '', amount: int = 0, volume_text: str = '') -> dict:
    return {'line': line, 'name': name, 'category': category, 'cents': cents, 'unit': unit, 'amount': amount, 'volume_text': volume_text}


def _iiko_weight(weight: Any, measure_unit: Any) -> tuple[str, int]:
    """iiko weight — «вес позиции»; единицу документация не называет, на практике это кг (0.3 = 300 г). ≥10 считаем граммами."""
    w = _num(weight)
    if w is None or w <= 0 or w > 100000:
        return '', 0
    hint = _unit_hint(_fold_words(_clean_cell(measure_unit, 20)))
    unit = 'g'
    if hint == 'l':
        unit, amount = 'ml', math.floor(w * 1000 + 0.5)
    elif hint == 'ml':
        unit, amount = 'ml', math.floor(w + 0.5)
    elif hint == 'g':
        amount = math.floor(w + 0.5)
    else:
        amount = math.floor(w * 1000 + 0.5) if w < 10 else math.floor(w + 0.5)
    return (unit, amount) if 1 <= amount <= 100000 else ('', 0)


def _extract_iiko(doc: dict) -> dict:
    """iikoCloud POST /api/1/nomenclature: groups[], products[], sizes[]. Модификаторы и удалённое пропускаем."""
    groups: dict[str, dict] = {}
    for g in (doc.get('groups') if isinstance(doc.get('groups'), list) else []):
        if _is_object(g) and isinstance(g.get('id'), str):
            groups[g['id']] = {'name': _clean_cell(g.get('name'), MAX_CATEGORY), 'modifier': g.get('isGroupModifier') is True}
    sizes: dict[str, dict] = {}
    for s in (doc.get('sizes') if isinstance(doc.get('sizes'), list) else []):
        if _is_object(s) and isinstance(s.get('id'), str):
            sizes[s['id']] = {'name': _clean_cell(s.get('name'), MAX_VOLUME), 'is_default': s.get('isDefault') is True}
    out = {'format': 'iiko', 'delimiter': '', 'rows': [], 'skipped': 0, 'warnings': []}
    products = doc['products']
    for i, p in enumerate(products):
        if not _is_object(p):
            out['skipped'] += 1
            continue
        type_ = p['type'].lower() if isinstance(p.get('type'), str) else ''
        group = groups.get(p['parentGroup'] if isinstance(p.get('parentGroup'), str) else '') \
            or groups.get(p['groupId'] if isinstance(p.get('groupId'), str) else '')
        name = _clean_cell(p.get('name'), MAX_NAME)
        if not name or type_ in ('modifier', 'service') or p.get('isDeleted') is True or (group and group['modifier']):
            out['skipped'] += 1
            continue

        # цена: размер по умолчанию → первый «в меню» с ценой → первый с ценой
        cents, size_name, rank, listed = 0, '', 0, False
        prices = p['sizePrices'] if isinstance(p.get('sizePrices'), list) else []
        for sp in prices:
            if not _is_object(sp) or not _is_object(sp.get('price')):
                continue
            c = _cents_from_number(sp['price'].get('currentPrice'))
            in_menu = sp['price'].get('isIncludedInMenu') is not False
            if in_menu:
                listed = True
            size = sizes.get(sp['sizeId'] if isinstance(sp.get('sizeId'), str) else '')
            r = 0 if c <= 0 else 3 if in_menu and size and size['is_default'] else 2 if in_menu else 1
            if r > rank:
                rank, cents, size_name = r, c, (size['name'] if size else '')
        if prices and not listed:    # снято с продажи во всех размерах
            out['skipped'] += 1
            continue

        unit, amount = '', 0
        if size_name:
            low = _lower_keep(size_name)
            m = _find_measure(low) or _find_bare_litres(low)
            if m:
                unit, amount = m['unit'], m['amount']
        if not unit:
            unit, amount = _iiko_weight(p.get('weight'), p.get('measureUnit'))
        out['rows'].append(_raw(i + 1, name, group['name'] if group else '', cents, unit, amount))
    return out


def _extract_iiko_menu(doc: dict) -> dict:
    """iiko «внешнее меню» (/api/2/menu/by_id): itemCategories[].items[].itemSizes[].prices[].price."""
    out = {'format': 'iiko-menu', 'delimiter': '', 'rows': [], 'skipped': 0, 'warnings': []}
    line = 0
    for cat in doc['itemCategories']:
        if not _is_object(cat) or not isinstance(cat.get('items'), list):
            continue
        category = _clean_cell(cat.get('name'), MAX_CATEGORY)
        for item in cat['items']:
            line += 1
            if not _is_object(item):
                out['skipped'] += 1
                continue
            name = _clean_cell(item.get('name'), MAX_NAME)
            type_ = item['type'].lower() if isinstance(item.get('type'), str) else ''
            if not name or type_ == 'modifier' or item.get('isHidden') is True or cat.get('isHidden') is True:
                out['skipped'] += 1
                continue
            cents, grams, rank = 0, 0, 0
            for size in (item['itemSizes'] if isinstance(item.get('itemSizes'), list) else []):
                if not _is_object(size) or size.get('isHidden') is True:
                    continue
                c = 0
                for pr in (size['prices'] if isinstance(size.get('prices'), list) else []):
                    if not c and _is_object(pr):
                        c = _cents_from_number(pr.get('price'))
                r = 0 if c <= 0 else 2 if size.get('isDefault') is True else 1
                if r > rank:
                    rank, cents = r, c
                    w = _num(size.get('portionWeightGrams'))
                    grams = math.floor(w + 0.5) if w is not None and 1 <= w <= 100000 else 0
            out['rows'].append(_raw(line, name, category, cents, 'g' if grams else '', grams))
    return out


def _minor_from_spots(spots: Any) -> int:
    for s in (spots if isinstance(spots, list) else []):
        if not _is_object(s) or s.get('visible') == '0' or s.get('visible') == 0:
            continue
        c = _cents_from_minor(s.get('price'))
        if c > 0:
            return c
    return 0


RE_OUT = re.compile('[0-9]{1,6}')
RE_SPOT_KEY = re.compile('[0-9]{1,9}')


def _extract_poster(items: list) -> dict:
    """Poster menu.getProducts: response[] — product_name, category_name, price{spot_id: "минорные единицы"}, out (выход тех. карты, г)."""
    out = {'format': 'poster', 'delimiter': '', 'rows': [], 'skipped': 0, 'warnings': []}
    for i, p in enumerate(items):
        if not _is_object(p):
            out['skipped'] += 1
            continue
        name = _clean_cell(p.get('product_name'), MAX_NAME)
        if not name or p.get('hidden') in ('1', 1) or p.get('type') in ('1', 1):    # type 1 — полуфабрикат
            out['skipped'] += 1
            continue
        category = _clean_cell(p.get('category_name'), MAX_CATEGORY)
        o = p.get('out')
        if isinstance(o, str) and RE_OUT.fullmatch(o):
            o = int(o)
        f = _num(o)
        grams = math.floor(f + 0.5) if f is not None and 1 <= f <= 100000 else 0

        mods = [m for m in p['modifications'] if _is_object(m)] if isinstance(p.get('modifications'), list) else []
        if mods:    # товар с модификациями («0,3» / «0,5»): каждая — отдельная строка со своей ценой
            for mod in mods:
                full = _clean_cell(name + ' ' + _clean_cell(mod.get('modificator_name'), MAX_NAME), MAX_NAME)
                out['rows'].append(_raw(i + 1, full, category, _minor_from_spots(mod.get('spots'))))
            continue
        cents = 0
        if _is_object(p.get('price')):    # ключи — id заведений; порядок ключей в JS и Python разный → сортируем сами
            price = p['price']
            keys = sorted([k for k in price.keys() if isinstance(k, str) and RE_SPOT_KEY.fullmatch(k)], key=lambda k: (int(k), k))
            for k in keys:
                if not cents:
                    cents = _cents_from_minor(price[k])
        if not cents:
            cents = _minor_from_spots(p.get('spots'))
        out['rows'].append(_raw(i + 1, name, category, cents, 'g' if grams else '', grams))
    return out


# ─────────────────────────────── CSV ───────────────────────────────

DELIMITERS = [';', '\t', ',']
RE_LINE_SPLIT = re.compile('\r\n|\n|\r')
RE_NON_BLANK = re.compile('[^ \t]')


def _detect_delimiter(text: str) -> str:
    """Разделитель — тот, что даёт одинаковое число колонок в первых строках. При равенстве «;» важнее «,» (запятая — десятичная)."""
    lines: list[str] = []
    for ln in RE_LINE_SPLIT.split(text[:65536]):
        if RE_NON_BLANK.search(ln):
            lines.append(ln)
            if len(lines) >= 20:
                break
    best_d, best_same, best_total = ';', 0, 0
    for d in DELIMITERS:
        counts = []
        for ln in lines:
            n, q = 0, False
            for ch in ln:
                if ch == '"':
                    q = not q
                elif ch == d and not q:
                    n += 1
            counts.append(n)
        # первая строка часто — заголовок отчёта без разделителей, поэтому меряем самое частое ненулевое число
        mode, mode_n = 0, 0
        for c in counts:
            if c <= 0:
                continue
            n = counts.count(c)
            if n > mode_n or (n == mode_n and c > mode):
                mode, mode_n = c, n
        total = sum(counts)
        if mode_n > best_same or (mode_n == best_same and total > best_total):
            best_d, best_same, best_total = d, mode_n, total
    return best_d


def _parse_csv(text: str, delim: str, max_records: int) -> list[list[str]]:
    """RFC 4180 с поблажками: кавычки, "" внутри, переводы строк в кавычках, CR/LF/CRLF."""
    rows: list[list[str]] = []
    row: list[str] = []
    field: list[str] = []
    quoted, at_start = False, True
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        if quoted:
            if ch != '"':
                field.append(ch)
            elif i + 1 < n and text[i + 1] == '"':
                field.append('"')
                i += 1
            else:
                quoted = False
        elif ch == '"' and at_start:
            quoted, at_start = True, False
        elif ch == delim:
            row.append(''.join(field))
            field, at_start = [], True
        elif ch == '\n' or ch == '\r':
            if ch == '\r' and i + 1 < n and text[i + 1] == '\n':
                i += 1
            row.append(''.join(field))
            rows.append(row)
            row, field, at_start = [], [], True
            if len(rows) > max_records:
                return rows
        else:
            field.append(ch)
            at_start = False
        i += 1
    if field or row:
        row.append(''.join(field))
        rows.append(row)
    return rows


def _header_role(cell: str) -> str:
    h = ' '.join(_fold_words(_clean_cell(cell, 80)))
    if not h:
        return ''

    def has(lst):
        return any(k in h for k in lst)
    if has(HEADER_CATEGORY):
        return 'category'
    if has(HEADER_PRICE) and not has(HEADER_PRICE_NOT):
        return 'price'
    if h in HEADER_UNIT:
        return 'unit'
    if has(HEADER_VOLUME) or h == 'out':
        return 'volume'
    if h in HEADER_NAME or any(h.startswith(k + ' ') for k in HEADER_NAME_PREFIX):
        return 'name'
    return ''


def _is_cost_header(cell: str) -> bool:
    """«Себестоимость», «Закупочная», «Cost» — колонка заведомо не с названием: запасным вариантом в неё не падаем."""
    h = ' '.join(_fold_words(_clean_cell(cell, 80)))
    return any(k in h for k in HEADER_PRICE_NOT)


def _map_columns(cells: list[str]) -> dict[str, int]:
    cols = {'name': -1, 'category': -1, 'price': -1, 'volume': -1, 'unit': -1}
    for i, cell in enumerate(cells):
        r = _header_role(cell)
        if r and cols[r] < 0:
            cols[r] = i
    return cols


def _cell(cells: list[str], i: int) -> str:
    return cells[i] if 0 <= i < len(cells) else ''


def _extract_csv(text: str) -> dict:
    delimiter = _detect_delimiter(text)
    records = _parse_csv(text, delimiter, MAX_ROWS + 50)
    out = {'format': 'csv', 'delimiter': delimiter, 'rows': [], 'skipped': 0, 'warnings': []}

    # заголовок ищем в первых 10 записях: над таблицей бывает «Прейскурант на …» и пустые строки
    head, cols = -1, {'name': -1, 'category': -1, 'price': -1, 'volume': -1, 'unit': -1}
    for i in range(min(len(records), 10)):
        c = _map_columns(records[i])
        if c['name'] >= 0 or c['price'] >= 0:
            head, cols = i, c
            break
    if head >= 0 and cols['name'] < 0:    # «Позиция меню; Цена» — название в первой колонке без роли
        taken = [cols['category'], cols['price'], cols['volume'], cols['unit']]
        for i in range(len(records[head])):
            if i not in taken and not _is_cost_header(records[head][i]):
                cols['name'] = i
                break
        if cols['name'] < 0:
            raise MenuImportError('no_name_column')
    if head < 0:    # без заголовка: название — первая колонка, цена — самая правая с числом, раздел — вторая
        first = next((r for r in records if any(_clean_cell(c, MAX_NAME) != '' for c in r)), [])
        cols['name'] = 0
        for i in range(len(first) - 1, 0, -1):
            if _parse_price_text(first[i]) > 0:
                cols['price'] = i
                break
        if len(first) >= 3 and cols['price'] != 1:
            cols['category'] = 1
    if cols['price'] < 0:
        out['warnings'].append('no_price_column')

    hint = _unit_hint(_fold_words(_clean_cell(_cell(records[head], cols['volume']), 80))) if cols['volume'] >= 0 and head >= 0 else ''
    heading = ''
    for i in range(head + 1, len(records)):
        cells = [_clean_cell(c, MAX_NAME) for c in records[i]]
        if not any(c != '' for c in cells):
            continue
        name = _cell(cells, cols['name'])
        if not name:
            out['skipped'] += 1
            continue
        cents = _parse_price_text(_cell(cells, cols['price'])) if cols['price'] >= 0 else 0
        # прейскурант без колонки раздела: строка «ПИВО РАЗЛИВНОЕ» без цены и других ячеек — это заголовок раздела
        if cols['category'] < 0 and cols['price'] >= 0 and not cents and not any(c != '' for j, c in enumerate(cells) if j != cols['name']):
            heading = name[:MAX_CATEGORY]
            continue
        category = _cell(cells, cols['category'])[:MAX_CATEGORY] if cols['category'] >= 0 else heading
        row_hint = hint
        if cols['unit'] >= 0:
            u = _unit_hint(_fold_words(_cell(cells, cols['unit'])))
            if u:
                row_hint = u
        m = _measure_from_cell(_cell(cells, cols['volume']), row_hint) if cols['volume'] >= 0 else {'unit': '', 'amount': 0, 'text': ''}
        out['rows'].append(_raw(i + 1, name, _trim_spaces(category), cents, m['unit'], m['amount'], m['text']))
        if len(out['rows']) > MAX_ROWS:
            raise MenuImportError('too_many_rows')
    return out


# ─────────────────────────────── публичное API ───────────────────────────────

RE_LEADING_WS = re.compile('^[ \t\r\n]+')


def _reject_constant(_name: str):
    raise ValueError('NaN/Infinity')


def _extract(text: str) -> dict:
    body = _trim_spaces(RE_LEADING_WS.sub('', _sanitize(text)))
    if not body:
        raise MenuImportError('empty')
    if body[0] != '{' and body[0] != '[':
        return _extract_csv(body)
    try:
        doc = json.loads(body, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        raise MenuImportError('bad_json')
    if _is_object(doc) and isinstance(doc.get('products'), list):
        return _extract_iiko(doc)
    if _is_object(doc) and isinstance(doc.get('itemCategories'), list):
        return _extract_iiko_menu(doc)
    if _is_object(doc) and isinstance(doc.get('response'), list):
        return _extract_poster(doc['response'])
    if isinstance(doc, list) and any(_is_object(x) and isinstance(x.get('product_name'), str) for x in doc):
        return _extract_poster(doc)
    raise MenuImportError('unknown_format')


@lru_cache(maxsize=1)
def catalog() -> dict:
    """Канонический каталог из data/*.json — тот же, что встроен во фронтенд."""
    with open(DATA_DIR / 'brands.json', encoding='utf-8') as f:
        brands = json.load(f)
    with open(DATA_DIR / 'dishes.json', encoding='utf-8') as f:
        dishes = json.load(f)
    return {'brands': brands, 'dishes': dishes}


def parse_menu(text: str, cat: dict | None = None) -> dict:
    """Текст файла → строки меню с кандидатами из каталога. Бросает MenuImportError с понятным текстом."""
    if not isinstance(text, str):
        raise MenuImportError('empty')
    if len(text) > MAX_CHARS:
        raise MenuImportError('too_large')
    ex = _extract(text)
    if len(ex['rows']) > MAX_ROWS:
        raise MenuImportError('too_many_rows')
    if not ex['rows']:
        raise MenuImportError('no_rows')

    cat = cat or catalog()
    ix = _Index(cat)
    stop, drinks, memo = set(STOP_WORDS), set(DRINK_CATEGORIES), {}
    result = {'format': ex['format'], 'delimiter': ex['delimiter'], 'total': len(ex['rows']), 'skipped': ex['skipped'],
              'matched': 0, 'ambiguous': 0, 'unmatched': 0, 'warnings': ex['warnings'], 'rows': []}
    for index, raw in enumerate(ex['rows']):
        low = _lower_keep(raw['name'])
        in_name = _find_measure(low)
        bare = None if in_name else _find_bare_litres(low)
        cut = in_name or bare
        for_match = _cut_out(raw['name'], cut['start'], cut['end']) if cut else raw['name']
        words = [w for w in _fold_words(for_match) if w not in stop and (not _is_numeric(w) or w in ix.keep_numbers)]
        m = _match_words(ix, words, any(w in drinks for w in _fold_words(raw['category'])), memo)

        # объём: колонка/размер/выход из файла → «число + единица» в названии → для пива голое «0,5» = литры
        unit, amount, title = raw['unit'], raw['amount'], raw['name']
        if in_name:
            title = for_match
            if not unit:
                unit, amount = in_name['unit'], in_name['amount']
        elif bare and m['kind'] == 'BEER':
            title = for_match
            if not unit:
                unit, amount = 'ml', bare['amount']
        if m['kind'] == 'BEER' and unit == 'g':    # выход пива в граммах (тех. карта) показываем литрами
            unit = 'ml'
        volume = _format_measure(unit, amount) if unit else raw['volume_text']

        result[m['status']] += 1
        result['rows'].append({'index': index, 'line': raw['line'], 'name': raw['name'], 'title': title, 'category': raw['category'],
                               'price': _price_from_cents(raw['cents']), 'volume': volume, 'kind': m['kind'], 'status': m['status'],
                               'ref_slug': m['ref_slug'], 'confidence': m['confidence'], 'candidates': m['candidates']})
    return result


def plan_import(rows: list[dict], choices: dict, cat: dict, existing: list[str], limit: int) -> dict:
    """Что именно запишем в карту. choices: {"<index>": "<slug>" | ""} — выбор владельца ('' = не импортировать).
    existing — ключи «KIND:slug» уже имеющихся позиций (они обновляются и лимит не тратят), limit — лимит тарифа.
    Одна позиция каталога = одна строка карты: из «Efes 0,3» и «Efes 0,5» берётся первая, остальные — duplicates."""
    plan = {'items': [], 'created': 0, 'updated': 0, 'over_limit': 0, 'duplicates': 0, 'needs_choice': 0, 'skipped_by_user': 0, 'unmatched': 0}
    brands = {b['id']: b for b in cat['brands']}
    dishes = {d['id']: d for d in cat['dishes']}
    seen: list[str] = []
    used = len(existing)
    for row in rows:
        if row['status'] == 'unmatched' or not row['kind']:
            plan['unmatched'] += 1
            continue
        key_idx = str(row['index'])
        choice = choices[key_idx] if isinstance(choices, dict) and key_idx in choices else None
        if choice == '':
            plan['skipped_by_user'] += 1
            continue
        slug = choice if isinstance(choice, str) and any(c['slug'] == choice for c in row['candidates']) else ''
        if not slug and row['status'] == 'matched':
            slug = row['ref_slug']
        if not slug:
            plan['needs_choice'] += 1
            continue
        key = f"{row['kind']}:{slug}"
        if key in seen:
            plan['duplicates'] += 1
            continue
        seen.append(key)

        brand, dish = brands.get(slug), dishes.get(slug)
        catalog_name = (brand.get('display_name', '') if brand else '') if row['kind'] == 'BEER' else (dish.get('display_name', '') if dish else '')
        update = key in existing
        if not update and used >= limit:
            plan['over_limit'] += 1
            continue
        if update:
            plan['updated'] += 1
        else:
            plan['created'] += 1
            used += 1
        if row['kind'] == 'BEER':
            fallback = 'Разливное' if brand and brand.get('packaging_type') == 'DRAFT' else 'Бутылка и банка'
        else:
            fallback = (dish.get('category') if dish else '') or 'Основное'
        plan['items'].append({
            'kind': row['kind'], 'ref_slug': slug, 'name': '' if row['title'] == catalog_name else row['title'],
            'category': row['category'] or ('' if update else fallback[:MAX_CATEGORY]), 'price': row['price'], 'volume': row['volume'],
            'action': 'update' if update else 'create',
        })
    return plan
