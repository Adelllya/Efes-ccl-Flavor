/**
 * Импорт меню из выгрузок iiko / Poster / CSV → позиции каталога Flavor Tree (сорта и блюда с профилем вкуса).
 * Чистый TypeScript без Angular: этот же файл компилирует и гоняет node-тест scripts/menu-import-test.mjs.
 *
 * ЗЕРКАЛО backend/api/importers.py — списки, пороги и порядок действий должны совпадать до символа.
 * Паритет держит data/samples/expected_import.json: поменяли правило здесь → поменяйте там
 * и перегенерируйте эталон (node scripts/menu-import-test.mjs --update).
 *
 * Вход недоверенный: лимиты размера и строк, управляющие символы вырезаются, никакого eval, имени файла не верим.
 * Результат детерминирован: только целочисленная арифметика и явные классы символов (без \w \d \b —
 * в JS и Python они понимают кириллицу по-разному).
 */

export type ImportKind = 'BEER' | 'DISH';
export type ImportFormat = 'iiko' | 'iiko-menu' | 'poster' | 'csv';
export type ImportStatus = 'matched' | 'ambiguous' | 'unmatched';
export type ImportErrorCode = 'too_large' | 'empty' | 'bad_json' | 'unknown_format' | 'no_name_column' | 'too_many_rows' | 'no_rows';

export interface CatalogBrand { id: string; name: string; display_name: string; packaging_type?: string | null; }
export interface CatalogDish { id: string; name: string; display_name: string; synonyms?: string[]; category?: string; }
export interface ImportCatalog { brands: CatalogBrand[]; dishes: CatalogDish[]; }

export interface ImportCandidate { slug: string; confidence: number; }
export interface ImportRow {
  index: number;            // номер строки в результате — ключ для choices
  line: number;             // номер записи в исходном файле (для человека)
  name: string;             // как в файле
  title: string;            // без объёма/выхода — пойдёт в «своё название»
  category: string; price: number; volume: string;
  kind: ImportKind | ''; status: ImportStatus;
  ref_slug: string;         // выбран автоматически (matched), иначе ''
  confidence: number;       // 0..100, уверенность лучшего кандидата
  candidates: ImportCandidate[];
}
export interface ImportResult {
  format: ImportFormat; delimiter: string; total: number; skipped: number;
  matched: number; ambiguous: number; unmatched: number; warnings: string[]; rows: ImportRow[];
}
export interface ImportItem {
  kind: ImportKind; ref_slug: string; name: string; category: string; price: number; volume: string;
  action: 'create' | 'update';
}
export interface ImportPlan {
  items: ImportItem[]; created: number; updated: number; over_limit: number;
  duplicates: number; needs_choice: number; skipped_by_user: number; unmatched: number;
}

// ─────────────────────────────── лимиты и пороги ───────────────────────────────

export const MAX_BYTES = 2 * 1024 * 1024;   // файл
export const MAX_CHARS = 2 * 1024 * 1024;   // текст после декодирования (сервер получает уже текст)
export const MAX_ROWS = 2000;
const MAX_PRICE_CENTS = 999999900;          // 9 999 999 ₸ — влезает в Decimal(10, 2)
const MAX_NAME = 200, MAX_CATEGORY = 80, MAX_VOLUME = 40;
const MATCH_MIN = 85;       // от этой уверенности строка считается распознанной…
const GAP_MIN = 10;         // …если второй кандидат отстаёт хотя бы на столько
const CANDIDATE_MIN = 60;   // ниже — не кандидат
const TOKEN_SIM_MIN = 70;   // похожесть двух слов по биграммам (Dice, %)
const SOFT_CAP = 70;        // потолок для «другой сорт той же марки» и блюд из барных разделов
const SYNONYM_WEIGHT = 90;

const ERRORS: Record<ImportErrorCode, string> = {
  too_large: 'Файл больше 2 МБ. Выгрузите только меню (без остатков и тех. карт) или разделите файл.',
  empty: 'Файл пустой.',
  bad_json: 'Не удалось прочитать JSON: файл повреждён или это не JSON.',
  unknown_format: 'Не узнали формат. Поддерживаются JSON номенклатуры iiko, JSON Poster (menu.getProducts) и CSV с колонкой названия.',
  no_name_column: 'В CSV не нашли колонку с названием позиции. Назовите её «Название» или «Наименование».',
  too_many_rows: 'В файле больше 2000 позиций. Разделите выгрузку на части.',
  no_rows: 'В файле нет позиций меню.',
};

export class MenuImportError extends Error {
  constructor(readonly code: ImportErrorCode) { super(ERRORS[code]); this.name = 'MenuImportError'; }
}

// ─────────────────────────────── словари (зеркало importers.py) ───────────────────────────────

/** Написания марок, которые не выводятся из названия транслитом: [алиас, вес]. Короткие формы — 90. */
const BEER_ALIASES: Record<string, [string, number][]> = {
  'belyi-medved': [['бел медведь', 100]],
  'efes-pilsener': [['efes pilsner', 100], ['эфес пилзнер', 100], ['эфес пильзнер', 100], ['efes pils', 100], ['efes', 90]],
  'miller-genuine-draft': [['миллер дженьюин', 100], ['миллер генуин', 100], ['miller', 90], ['mgd', 90]],
  'kozel': [['kozel', 100]],
  'bremen-von-lustig': [['бремен фон лустиг', 100], ['bremen', 90]],
  'wukong-ju': [['wukong', 100]],
  'slavna-praga': [['славна прага', 100], ['praga', 90]],
  'legenda-777': [['legenda', 90]],
  '13-region': [['13й регион', 100], ['тринадцатый регион', 100]],
  'stary-melnik': [['старый мельник', 100]],
};

/** Слова, которые не помогают отличить позицию: предлоги, тара, «пиво», единицы. */
const STOP_WORDS = ('с со из и на в во по к для от под а ля шт штук порция порц г гр кг мл л the with and of '
  + 'пиво пиву beer разливное разливной розлив разлив draft draught бутылка бутылочное бут банка баночное жб стб стекло '
  + 'светлое светлый lager лагер кега keg tap new новинка хит').split(' ');

/** Признак другого сорта той же марки (тёмное, б/а, пшеничное…): профиль вкуса иной → только с подтверждением. */
const VARIANT_WORDS = ('темное темный темная dark черный черное cerny безалкогольное безалкогольный nonalcoholic '
  + 'нефильтрованное нефильтрованный unfiltered пшеничное пшеничный wheat weiss weizen radler радлер '
  + 'stout стаут porter портер ipa ale эль сидр cider').split(' ');

/** Разделы, где блюд не бывает: совпадение с блюдом там — только с подтверждением («Маргарита» — коктейль). */
const DRINK_CATEGORIES = ('коктейли коктейль cocktails cocktail вино вина wine wines виски whisky whiskey водка vodka ром rum '
  + 'джин gin текила tequila коньяк бренди ликеры ликер настойки настойка шоты шот shots напитки напиток drinks beverages '
  + 'чай кофе tea coffee лимонады лимонад соки сок смузи кальян кальяны hookah алкоголь бар bar').split(' ');

const PRE_FOLD: [string, string][] = [['б/а', ' безалкогольное '], ['ст/б', ' стб '], ['с/б', ' стб '], ['ж/б', ' жб ']];

const FOLD_MAP: Record<string, string> = {};
for (const [chars, to] of [
  ['ё', 'е'], ['ә', 'а'], ['ғ', 'г'], ['қ', 'к'], ['ң', 'н'], ['ө', 'о'], ['ұү', 'у'], ['һ', 'х'], ['і', 'и'],
  ['àáâãäåā', 'a'], ['çćč', 'c'], ['ďđ', 'd'], ['èéêëēěę', 'e'], ['ìíîïī', 'i'], ['łľ', 'l'], ['ñńň', 'n'],
  ['òóôõöøō', 'o'], ['řŕ', 'r'], ['śšş', 's'], ['ťţ', 't'], ['ùúûüūů', 'u'], ['ýÿ', 'y'], ['źžż', 'z'],
  ['ß', 'ss'], ['æ', 'ae'], ['œ', 'oe'],
] as [string, string][]) for (const ch of chars) FOLD_MAP[ch] = to;

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i',
  ь: '', э: 'e', ю: 'iu', я: 'ia',
};
const LATIN_FOLD: [string, string][] = [['kh', 'h'], ['ph', 'f'], ['ck', 'k'], ['ts', 'c'], ['w', 'v'], ['y', 'i'], ['x', 'ks'], ['q', 'k']];

const HEADER_CATEGORY = ['категор', 'групп', 'раздел', 'category', 'group', 'section'];
const HEADER_PRICE = ['цена', 'стоимость', 'прайс', 'price'];
const HEADER_PRICE_NOT = ['себестоим', 'закуп', 'cost'];
const HEADER_UNIT = ['ед', 'ед изм', 'ед измерения', 'единица', 'единица измерения', 'unit', 'units', 'measure', 'measure unit'];
const HEADER_VOLUME = ['объем', 'обьем', 'выход', 'вес', 'масса', 'литраж', 'порция', 'volume', 'weight', 'size', 'portion'];
const HEADER_NAME = ['название', 'наименование', 'блюдо', 'товар', 'позиция', 'продукт', 'номенклатура', 'тех карта', 'техкарта',
  'name', 'title', 'product', 'item', 'dish', 'product name', 'item name'];
const HEADER_NAME_PREFIX = ['наименование', 'название', 'name', 'product name', 'item name'];

/** Для паритет-теста: словари и пороги обеих реализаций сверяются с эталоном. */
export function importerConfig(): Record<string, unknown> {
  return {
    limits: { max_bytes: MAX_BYTES, max_chars: MAX_CHARS, max_rows: MAX_ROWS, max_price_cents: MAX_PRICE_CENTS,
              max_name: MAX_NAME, max_category: MAX_CATEGORY, max_volume: MAX_VOLUME },
    thresholds: { match_min: MATCH_MIN, gap_min: GAP_MIN, candidate_min: CANDIDATE_MIN, token_sim_min: TOKEN_SIM_MIN,
                  soft_cap: SOFT_CAP, synonym_weight: SYNONYM_WEIGHT },
    errors: ERRORS, beer_aliases: BEER_ALIASES, stop_words: STOP_WORDS, variant_words: VARIANT_WORDS,
    drink_categories: DRINK_CATEGORIES, pre_fold: PRE_FOLD, fold_map: FOLD_MAP, translit: TRANSLIT, latin_fold: LATIN_FOLD,
    header: { category: HEADER_CATEGORY, price: HEADER_PRICE, price_not: HEADER_PRICE_NOT, unit: HEADER_UNIT,
              volume: HEADER_VOLUME, name: HEADER_NAME, name_prefix: HEADER_NAME_PREFIX },
  };
}

// ─────────────────────────────── декодирование и очистка ───────────────────────────────

/** Верхняя половина Windows-1251 (0x80–0xBF); 0xC0–0xFF — это А…я подряд. 0x98 в кодировке не определён. */
const CP1251_HIGH = '\u0402\u0403\u201a\u0453\u201e\u2026\u2020\u2021\u20ac\u2030\u0409\u2039\u040a\u040c\u040b\u040f'
  + '\u0452\u2018\u2019\u201c\u201d\u2022\u2013\u2014\ufffd\u2122\u0459\u203a\u045a\u045c\u045b\u045f'
  + '\u00a0\u040e\u045e\u0408\u00a4\u0490\u00a6\u00a7\u0401\u00a9\u0404\u00ab\u00ac\u00ad\u00ae\u0407'
  + '\u00b0\u00b1\u0406\u0456\u0491\u00b5\u00b6\u00b7\u0451\u2116\u0454\u00bb\u0458\u0405\u0455\u0457';

/** Байты файла → текст. UTF-8 (строго), UTF-16 по BOM, иначе Windows-1251 — так сохраняет Excel в СНГ. */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length > MAX_BYTES) throw new MenuImportError('too_large');
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  else if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    const be = bytes[0] === 0xfe;
    let body = bytes.subarray(2);
    if (be) {
      const sw = new Uint8Array(body.length - (body.length % 2));
      for (let i = 0; i + 1 < body.length; i += 2) { sw[i] = body[i + 1]; sw[i + 1] = body[i]; }
      body = sw;
    }
    return { text: new TextDecoder('utf-16le').decode(body), encoding: be ? 'utf-16be' : 'utf-16le' };
  }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }; } catch { /* не UTF-8 */ }
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out.push(b < 0x80 ? String.fromCharCode(b) : b >= 0xc0 ? String.fromCharCode(0x0410 + b - 0xc0) : CP1251_HIGH[b - 0x80]);
  }
  return { text: out.join(''), encoding: 'windows-1251' };
}

// управляющие (кроме \t \n \r), C1, невидимые и bidi-символы, суррогаты (= всё вне BMP), U+FFFD
const RE_UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\ud800-\udfff\ufffd-\uffff]/g;
const RE_SPACES = /[ \t\n\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

function sanitize(text: string): string { return text.replace(RE_UNSAFE, ''); }

function trimSpaces(s: string): string {
  let a = 0, b = s.length;
  while (a < b && s[a] === ' ') a++;
  while (b > a && s[b - 1] === ' ') b--;
  return s.slice(a, b);
}

/** Значение ячейки: только строка, без мусора, пробелы схлопнуты, длина ограничена. */
function cleanCell(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return trimSpaces(trimSpaces(sanitize(value).replace(RE_SPACES, ' ')).slice(0, max));
}

// ─────────────────────────────── числа: цена и объём ───────────────────────────────

function isDigit(ch: string | undefined): boolean { return ch !== undefined && ch >= '0' && ch <= '9'; }

function centsFromParts(intPart: string, frac: string): number {
  if (intPart.length > 9) return 0;
  const cents = parseInt(intPart || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  return cents > MAX_PRICE_CENTS ? 0 : cents;
}

/** «1 490,00 ₸», «1,490.50», «1490 тг» → копейки. Отрицательное и мусор → 0. */
function parsePriceText(raw: string): number {
  const s = cleanCell(raw, 60);
  const m = /[0-9][0-9 .,]*/.exec(s);
  if (!m) return 0;
  if (m.index > 0 && (s[m.index - 1] === '-' || s[m.index - 1] === '\u2212')) return 0;
  let chunk = m[0].split(' ').join('');
  while (chunk.length && !isDigit(chunk[chunk.length - 1])) chunk = chunk.slice(0, -1);
  const dot = chunk.lastIndexOf('.'), comma = chunk.lastIndexOf(',');
  let sep = -1;
  if (dot >= 0 && comma >= 0) sep = Math.max(dot, comma);   // оба есть: последний — десятичный
  else {
    const pos = Math.max(dot, comma);
    if (pos >= 0) {
      const many = chunk.indexOf(chunk[pos]) !== pos;         // «1.490.000» — разделители тысяч
      if (!many && chunk.length - pos - 1 !== 3) sep = pos;   // «1,490» — тысячи, «1490,5» — дробь
    }
  }
  const digits = (t: string) => t.split('.').join('').split(',').join('');
  return sep < 0 ? centsFromParts(digits(chunk), '') : centsFromParts(digits(chunk.slice(0, sep)), digits(chunk.slice(sep + 1)));
}

function centsFromNumber(v: unknown): number {
  if (typeof v === 'string') return parsePriceText(v);
  if (typeof v !== 'number' || !isFinite(v) || v <= 0 || v > 1e9) return 0;
  const cents = Math.floor(v * 100 + 0.5);
  return cents > MAX_PRICE_CENTS ? 0 : cents;
}

/** Poster отдаёт цены строкой в минорных единицах: "149000" = 1 490 ₸. */
function centsFromMinor(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) && v > 0 && v <= MAX_PRICE_CENTS ? Math.floor(v + 0.5) : 0;
  if (typeof v !== 'string') return 0;
  const m = /^ *([0-9]{1,12})(?:\.[0-9]+)? *$/.exec(v);
  if (!m) return 0;
  const cents = parseInt(m[1], 10);
  return cents > MAX_PRICE_CENTS ? 0 : cents;
}

function priceFromCents(cents: number): number { return cents / 100; }

/** Нижний регистр БЕЗ изменения длины строки (позиции совпадают с исходной) + «0,5» → «0.5». */
function lowerKeep(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x41 && c <= 0x5a) out.push(String.fromCharCode(c + 32));
    else if (c >= 0x0410 && c <= 0x042f) out.push(String.fromCharCode(c + 32));
    else if (c === 0x0401 || c === 0x0451) out.push('е');
    else if (c === 0x2c && isDigit(s[i - 1]) && isDigit(s[i + 1])) out.push('.');
    else out.push(s[i]);
  }
  return out.join('');
}

/** «0.5» → 500 (тысячные). Длинные числа — не объём. */
function thousandths(num: string): number {
  const p = num.split('.');
  if (p[0].length > 6) return -1;
  return parseInt(p[0], 10) * 1000 + parseInt(((p[1] || '') + '000').slice(0, 3), 10);
}

interface Measure { unit: 'ml' | 'g'; amount: number; start: number; end: number; }

const RE_MEASURE = /(^|[^0-9a-zа-я.])([0-9]+(?:\.[0-9]+)?) ?(мл|ml|литр[а-я]*|л|l|кг|kg|грамм[а-я]*|гр|г|g)(?=$|[^0-9a-zа-я])/g;
const RE_BARE = /(^|[^0-9a-zа-я.,])([0-9]\.[0-9]{1,3})(?=$|[^0-9a-zа-я%])(?! ?%)/g;

function measureFrom(th: number, unit: string, start: number, end: number): Measure | null {
  if (th < 0) return null;
  let kind: 'ml' | 'g' = 'ml', amount = 0;
  if (unit === 'мл' || unit === 'ml') amount = Math.floor(th / 1000);
  else if (unit === 'л' || unit === 'l' || unit.slice(0, 4) === 'литр') amount = th;
  else if (unit === 'кг' || unit === 'kg') { kind = 'g'; amount = th; }
  else { kind = 'g'; amount = Math.floor(th / 1000); }
  return amount >= 1 && amount <= 100000 ? { unit: kind, amount, start, end } : null;
}

/** Первое «число + единица» в строке (уже после lowerKeep). */
function findMeasure(low: string): Measure | null {
  RE_MEASURE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_MEASURE.exec(low)) !== null) {
    const start = m.index + m[1].length;
    const r = measureFrom(thousandths(m[2]), m[3], start, m.index + m[0].length);
    if (r) return r;
  }
  return null;
}

/** «Эфес 0,5» — десятичное число без единицы: для пива это литры (0.1–3 л). */
function findBareLitres(low: string): Measure | null {
  RE_BARE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_BARE.exec(low)) !== null) {
    const th = thousandths(m[2]);
    const start = m.index + m[1].length;
    if (th >= 100 && th <= 3000) return { unit: 'ml', amount: th, start, end: start + m[2].length };
  }
  return null;
}

function formatMeasure(unit: 'ml' | 'g', amount: number): string {
  if (unit === 'g') return `${amount} г`;
  const whole = Math.floor(amount / 1000), rem = amount % 1000;
  if (rem === 0) return `${whole} л`;
  let frac = ('00' + rem).slice(-3);
  while (frac[frac.length - 1] === '0') frac = frac.slice(0, -1);
  return `${whole}.${frac} л`;
}

const TRIM_CHARS = ' ,;:-\u2013\u2014/|.';
/** Название без вырезанного объёма: «Efes (0,5 л)» → «Efes». */
function cutOut(name: string, start: number, end: number): string {
  const s = (name.slice(0, start) + ' ' + name.slice(end)).replace(/\( *\)|\[ *\]/g, ' ').replace(/ +/g, ' ');
  let a = 0, b = s.length;
  while (a < b && TRIM_CHARS.indexOf(s[a]) >= 0) a++;
  while (b > a && TRIM_CHARS.indexOf(s[b - 1]) >= 0) b--;
  const t = s.slice(a, b);
  return t === '' ? trimSpaces(name) : t;
}

type UnitHint = 'ml' | 'l' | 'g' | 'kg' | '';

/** Единица из заголовка колонки («Вес, г», «Объём») или из ячейки «Ед. изм.». */
function unitHint(words: string[]): UnitHint {
  const has = (list: string[]) => words.some(w => list.indexOf(w) >= 0);
  if (has(['мл', 'ml'])) return 'ml';
  if (has(['кг', 'kg'])) return 'kg';
  if (has(['л', 'l', 'литр', 'литры', 'литров', 'литра'])) return 'l';
  if (has(['г', 'гр', 'g', 'грамм', 'граммы', 'граммов'])) return 'g';
  if (has(['объем', 'обьем', 'литраж', 'volume'])) return 'l';
  if (has(['вес', 'выход', 'масса', 'weight', 'out'])) return 'g';
  return '';
}

/** Ячейка объёма/выхода: «0,5 л», «300», «6 шт». Голое число понимаем по подсказке единицы. */
function measureFromCell(raw: string, hint: UnitHint): { unit: 'ml' | 'g' | ''; amount: number; text: string } {
  const text = cleanCell(raw, MAX_VOLUME);
  const low = lowerKeep(text);
  const m = findMeasure(low);
  if (m) return { unit: m.unit, amount: m.amount, text: formatMeasure(m.unit, m.amount) };
  if (hint && /^[0-9]+(?:\.[0-9]+)?$/.test(low)) {
    const th = thousandths(low);
    const unit = hint === 'l' && th >= 10000 ? 'мл' : hint === 'l' ? 'л' : hint === 'ml' ? 'мл' : hint === 'kg' ? 'кг' : 'г';
    const r = measureFrom(th, unit, 0, 0);
    if (r) return { unit: r.unit, amount: r.amount, text: formatMeasure(r.unit, r.amount) };
  }
  return { unit: '', amount: 0, text: /[1-9]/.test(text) ? text : '' };
}

// ─────────────────────────────── нормализация слов ───────────────────────────────

/** Нижний регистр, ё→е, казахские и латинские диакритики → базовые буквы, всё кроме букв и цифр → пробел. */
function foldWords(s: string): string[] {
  let t = s.normalize('NFC').toLowerCase();
  for (const [from, to] of PRE_FOLD) t = t.split(from).join(to);
  const out: string[] = [];
  for (const ch of t) {
    const f = FOLD_MAP[ch] !== undefined ? FOLD_MAP[ch] : ch;
    for (const c of f) out.push((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (c >= 'а' && c <= 'я') ? c : ' ');
  }
  return out.join('').split(' ').filter(w => w !== '');
}

/** «Фонетический скелет»: кириллица → латиница, y/i/й/ы → i, удвоения схлопнуты. «Белый» = «Belyi» = «Beliy». */
function skeleton(word: string): string {
  let t = '';
  for (const ch of word) t += TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch;
  for (const [from, to] of LATIN_FOLD) t = t.split(from).join(to);
  let out = '';
  for (const ch of t) if (out === '' || out[out.length - 1] !== ch) out += ch;
  return out;
}

function isNumeric(w: string): boolean { return /^[0-9]+$/.test(w); }

function bigrams(t: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < t.length; i++) { const g = t.slice(i, i + 2); if (out.indexOf(g) < 0) out.push(g); }
  return out;
}

// ─────────────────────────────── индекс каталога ───────────────────────────────

interface Phrase { ids: number[]; weight: number; }
interface Entry { slug: string; kind: ImportKind; order: number; phrases: Phrase[]; vocab: number[]; words: string[]; }
interface CatalogIndex {
  entries: Entry[]; vocab: string[]; vocabId: Map<string, number>; grams: number[];
  postings: Map<string, number[]>; byVocab: number[][]; keepNumbers: string[];
}

function buildIndex(catalog: ImportCatalog): CatalogIndex {
  const stop = new Set(STOP_WORDS);
  const ix: CatalogIndex = { entries: [], vocab: [], vocabId: new Map(), grams: [], postings: new Map(), byVocab: [], keepNumbers: [] };
  const add = (slug: string, kind: ImportKind, sources: [string, number][]) => {
    const entry: Entry = { slug, kind, order: ix.entries.length, phrases: [], vocab: [], words: [] };
    const seen: string[] = [];
    for (const [text, weight] of sources) {
      const words = foldWords(cleanCell(text, MAX_NAME)).filter(w => !stop.has(w));
      if (!words.length) continue;
      const ids = words.map(w => {
        const sk = skeleton(w);
        let id = ix.vocabId.get(sk);
        if (id === undefined) {
          id = ix.vocab.length; ix.vocab.push(sk); ix.vocabId.set(sk, id); ix.byVocab.push([]);
          const grams = sk.length >= 4 ? bigrams(sk) : [];
          ix.grams.push(grams.length);
          for (const g of grams) { const p = ix.postings.get(g); if (p) p.push(id); else ix.postings.set(g, [id]); }
        }
        if (isNumeric(w) && ix.keepNumbers.indexOf(w) < 0) ix.keepNumbers.push(w);
        if (entry.words.indexOf(w) < 0) entry.words.push(w);
        return id;
      });
      const key = ids.join(' ');
      if (seen.indexOf(key) >= 0) continue;   // тот же набор слов уже есть (с первым, большим весом)
      seen.push(key);
      entry.phrases.push({ ids, weight });
      for (const id of ids) if (entry.vocab.indexOf(id) < 0) { entry.vocab.push(id); ix.byVocab[id].push(entry.order); }
    }
    ix.entries.push(entry);
  };
  for (const b of catalog.brands) {
    add(b.id, 'BEER', [[b.display_name, 100], [b.name, 100], ...(BEER_ALIASES[b.id] || [])]);
  }
  for (const d of catalog.dishes) {
    add(d.id, 'DISH', [[d.display_name, 100], [d.name, 100], ...(d.synonyms || []).map(s => [s, SYNONYM_WEIGHT] as [string, number])]);
  }
  return ix;
}

// ─────────────────────────────── сопоставление строки ───────────────────────────────

type Sims = Map<number, number>;

function tokenSims(ix: CatalogIndex, sk: string, memo: Map<string, Sims>): Sims {
  const cached = memo.get(sk);
  if (cached) return cached;
  const res: Sims = new Map();
  const exact = ix.vocabId.get(sk);
  if (exact !== undefined) res.set(exact, 100);
  if (sk.length >= 4) {   // короткие слова («ет», «ас», «13») — только точное совпадение
    const grams = bigrams(sk);
    const counts = new Map<number, number>();
    for (const g of grams) for (const id of ix.postings.get(g) || []) counts.set(id, (counts.get(id) || 0) + 1);
    for (const [id, common] of counts) {
      if (id === exact) continue;
      const dice = Math.floor(200 * common / (grams.length + ix.grams[id]));
      if (dice >= TOKEN_SIM_MIN) res.set(id, dice);
    }
  }
  memo.set(sk, res);
  return res;
}

function bestSim(ids: number[], s: Sims): number { let v = 0; for (const id of ids) { const x = s.get(id) || 0; if (x > v) v = x; } return v; }

function scoreEntry(entry: Entry, sims: Sims[]): number {
  let rowSum = 0;
  for (const s of sims) rowSum += bestSim(entry.vocab, s);
  const rowCov = Math.floor(rowSum / sims.length);
  let top = 0;
  for (const p of entry.phrases) {
    let sum = 0;
    for (const id of p.ids) { let v = 0; for (const s of sims) { const x = s.get(id) || 0; if (x > v) v = x; } sum += v; }
    const cov = Math.floor(sum / p.ids.length);
    let score = Math.floor(cov * (80 + Math.floor(20 * rowCov / 100)) / 100);   // фраза найдена целиком + чем меньше лишних слов, тем выше
    if (bestSim(p.ids, sims[0]) > 0) score += 3;                                 // главное слово в меню стоит первым
    if (score > 100) score = 100;
    score = Math.floor(score * p.weight / 100);
    if (score > top) top = score;
  }
  return top;
}

interface Match { kind: ImportKind | ''; status: ImportStatus; ref_slug: string; confidence: number; candidates: ImportCandidate[]; }
const NO_MATCH: Match = { kind: '', status: 'unmatched', ref_slug: '', confidence: 0, candidates: [] };

function matchWords(ix: CatalogIndex, words: string[], drinkCategory: boolean, memo: Map<string, Sims>): Match {
  if (!words.length) return NO_MATCH;
  const sims = words.map(w => tokenSims(ix, skeleton(w), memo));
  const hit: number[] = [];
  for (const s of sims) for (const id of s.keys()) for (const e of ix.byVocab[id]) if (hit.indexOf(e) < 0) hit.push(e);
  hit.sort((a, b) => a - b);
  const variant = words.filter(w => VARIANT_WORDS.indexOf(w) >= 0);
  const found: { entry: Entry; score: number }[] = [];
  for (const e of hit) {
    const entry = ix.entries[e];
    let score = scoreEntry(entry, sims);
    if (entry.kind === 'BEER' && variant.some(w => entry.words.indexOf(w) < 0) && score > SOFT_CAP) score = SOFT_CAP;
    if (entry.kind === 'DISH' && drinkCategory && score > SOFT_CAP) score = SOFT_CAP;
    if (score >= CANDIDATE_MIN) found.push({ entry, score });
  }
  if (!found.length) return NO_MATCH;
  found.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
  const kind = found[0].entry.kind;   // при равенстве пиво раньше блюд — оно первым в каталоге
  const top = found.filter(f => f.entry.kind === kind).slice(0, 3);
  const sure = top[0].score >= MATCH_MIN && (top.length < 2 || top[0].score - top[1].score >= GAP_MIN);
  return { kind, status: sure ? 'matched' : 'ambiguous', ref_slug: sure ? top[0].entry.slug : '', confidence: top[0].score,
           candidates: top.map(f => ({ slug: f.entry.slug, confidence: f.score })) };
}

// ─────────────────────────────── сырые строки из форматов ───────────────────────────────

/** Строка меню до сопоставления. unit/amount — объём или выход, уже найденный в файле (колонка, size, weight, out). */
interface RawRow { line: number; name: string; category: string; cents: number; unit: 'ml' | 'g' | ''; amount: number; volumeText: string; }
interface Extracted { format: ImportFormat; delimiter: string; rows: RawRow[]; skipped: number; warnings: string[]; }

function isObject(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }

/** iiko weight — «вес позиции»; единицу документация не называет, на практике это кг (0.3 = 300 г). ≥10 считаем граммами. */
function iikoWeight(weight: unknown, measureUnit: unknown): { unit: 'ml' | 'g' | ''; amount: number } {
  if (typeof weight !== 'number' || !isFinite(weight) || weight <= 0 || weight > 100000) return { unit: '', amount: 0 };
  const hint = unitHint(foldWords(cleanCell(measureUnit, 20)));
  let unit: 'ml' | 'g' = 'g', amount: number;
  if (hint === 'l') { unit = 'ml'; amount = Math.floor(weight * 1000 + 0.5); }
  else if (hint === 'ml') { unit = 'ml'; amount = Math.floor(weight + 0.5); }
  else if (hint === 'g') amount = Math.floor(weight + 0.5);
  else amount = weight < 10 ? Math.floor(weight * 1000 + 0.5) : Math.floor(weight + 0.5);
  return amount >= 1 && amount <= 100000 ? { unit, amount } : { unit: '', amount: 0 };
}

/** iikoCloud POST /api/1/nomenclature: groups[], products[], sizes[]. Модификаторы и удалённое пропускаем. */
function extractIiko(doc: Record<string, unknown>): Extracted {
  const groups = new Map<string, { name: string; modifier: boolean }>();
  for (const g of Array.isArray(doc['groups']) ? doc['groups'] : []) {
    if (isObject(g) && typeof g['id'] === 'string') groups.set(g['id'], { name: cleanCell(g['name'], MAX_CATEGORY), modifier: g['isGroupModifier'] === true });
  }
  const sizes = new Map<string, { name: string; isDefault: boolean }>();
  for (const s of Array.isArray(doc['sizes']) ? doc['sizes'] : []) {
    if (isObject(s) && typeof s['id'] === 'string') sizes.set(s['id'], { name: cleanCell(s['name'], MAX_VOLUME), isDefault: s['isDefault'] === true });
  }
  const out: Extracted = { format: 'iiko', delimiter: '', rows: [], skipped: 0, warnings: [] };
  const products = doc['products'] as unknown[];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!isObject(p)) { out.skipped++; continue; }
    const type = typeof p['type'] === 'string' ? p['type'].toLowerCase() : '';
    const group = groups.get(typeof p['parentGroup'] === 'string' ? p['parentGroup'] : '')
      || groups.get(typeof p['groupId'] === 'string' ? p['groupId'] : '');
    const name = cleanCell(p['name'], MAX_NAME);
    if (!name || type === 'modifier' || type === 'service' || p['isDeleted'] === true || (group && group.modifier)) { out.skipped++; continue; }

    // цена: размер по умолчанию → первый «в меню» с ценой → первый с ценой
    let cents = 0, sizeName = '', rank = 0, listed = false;
    const prices = Array.isArray(p['sizePrices']) ? p['sizePrices'] : [];
    for (const sp of prices) {
      if (!isObject(sp) || !isObject(sp['price'])) continue;
      const c = centsFromNumber(sp['price']['currentPrice']);
      const inMenu = sp['price']['isIncludedInMenu'] !== false;
      if (inMenu) listed = true;
      const size = sizes.get(typeof sp['sizeId'] === 'string' ? sp['sizeId'] : '');
      const r = c <= 0 ? 0 : inMenu && size && size.isDefault ? 3 : inMenu ? 2 : 1;
      if (r > rank) { rank = r; cents = c; sizeName = size ? size.name : ''; }
    }
    if (prices.length && !listed) { out.skipped++; continue; }   // снято с продажи во всех размерах

    let unit: 'ml' | 'g' | '' = '', amount = 0;
    if (sizeName) { const low = lowerKeep(sizeName); const m = findMeasure(low) || findBareLitres(low); if (m) { unit = m.unit; amount = m.amount; } }
    if (!unit) { const w = iikoWeight(p['weight'], p['measureUnit']); unit = w.unit; amount = w.amount; }
    out.rows.push({ line: i + 1, name, category: group ? group.name : '', cents, unit, amount, volumeText: '' });
  }
  return out;
}

/** iiko «внешнее меню» (/api/2/menu/by_id): itemCategories[].items[].itemSizes[].prices[].price. */
function extractIikoMenu(doc: Record<string, unknown>): Extracted {
  const out: Extracted = { format: 'iiko-menu', delimiter: '', rows: [], skipped: 0, warnings: [] };
  let line = 0;
  for (const cat of doc['itemCategories'] as unknown[]) {
    if (!isObject(cat) || !Array.isArray(cat['items'])) continue;
    const category = cleanCell(cat['name'], MAX_CATEGORY);
    for (const item of cat['items']) {
      line++;
      if (!isObject(item)) { out.skipped++; continue; }
      const name = cleanCell(item['name'], MAX_NAME);
      const type = typeof item['type'] === 'string' ? item['type'].toLowerCase() : '';
      if (!name || type === 'modifier' || item['isHidden'] === true || cat['isHidden'] === true) { out.skipped++; continue; }
      let cents = 0, grams = 0, rank = 0;
      for (const size of Array.isArray(item['itemSizes']) ? item['itemSizes'] : []) {
        if (!isObject(size) || size['isHidden'] === true) continue;
        let c = 0;
        for (const pr of Array.isArray(size['prices']) ? size['prices'] : []) if (!c && isObject(pr)) c = centsFromNumber(pr['price']);
        const r = c <= 0 ? 0 : size['isDefault'] === true ? 2 : 1;
        if (r > rank) {
          rank = r; cents = c;
          const w = size['portionWeightGrams'];
          grams = typeof w === 'number' && isFinite(w) && w >= 1 && w <= 100000 ? Math.floor(w + 0.5) : 0;
        }
      }
      out.rows.push({ line, name, category, cents, unit: grams ? 'g' : '', amount: grams, volumeText: '' });
    }
  }
  return out;
}

function minorFromSpots(spots: unknown): number {
  for (const s of Array.isArray(spots) ? spots : []) {
    if (!isObject(s) || s['visible'] === '0' || s['visible'] === 0) continue;
    const c = centsFromMinor(s['price']);
    if (c > 0) return c;
  }
  return 0;
}

/** Poster menu.getProducts: response[] — product_name, category_name, price{spot_id: "минорные единицы"}, out (выход тех. карты, г). */
function extractPoster(list: unknown[]): Extracted {
  const out: Extracted = { format: 'poster', delimiter: '', rows: [], skipped: 0, warnings: [] };
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!isObject(p)) { out.skipped++; continue; }
    const name = cleanCell(p['product_name'], MAX_NAME);
    if (!name || p['hidden'] === '1' || p['hidden'] === 1 || p['type'] === '1' || p['type'] === 1) { out.skipped++; continue; }   // type 1 — полуфабрикат
    const category = cleanCell(p['category_name'], MAX_CATEGORY);
    const o = typeof p['out'] === 'string' && /^[0-9]{1,6}$/.test(p['out']) ? parseInt(p['out'], 10) : p['out'];
    const grams = typeof o === 'number' && isFinite(o) && o >= 1 && o <= 100000 ? Math.floor(o + 0.5) : 0;

    const mods = Array.isArray(p['modifications']) ? p['modifications'].filter(isObject) : [];
    if (mods.length) {   // товар с модификациями («0,3» / «0,5»): каждая — отдельная строка со своей ценой
      for (const mod of mods) {
        const full = cleanCell(name + ' ' + cleanCell(mod['modificator_name'], MAX_NAME), MAX_NAME);
        out.rows.push({ line: i + 1, name: full, category, cents: minorFromSpots(mod['spots']), unit: '', amount: 0, volumeText: '' });
      }
      continue;
    }
    let cents = 0;
    if (isObject(p['price'])) {   // ключи — id заведений; порядок ключей в JS и Python разный → сортируем сами
      const price = p['price'];
      const keys = Object.keys(price).filter(k => /^[0-9]{1,9}$/.test(k)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || (a < b ? -1 : a > b ? 1 : 0));
      for (const k of keys) if (!cents) cents = centsFromMinor(price[k]);
    }
    if (!cents) cents = minorFromSpots(p['spots']);
    out.rows.push({ line: i + 1, name, category, cents, unit: grams ? 'g' : '', amount: grams, volumeText: '' });
  }
  return out;
}

// ─────────────────────────────── CSV ───────────────────────────────

const DELIMITERS = [';', '\t', ','];

/** Разделитель — тот, что даёт одинаковое число колонок в первых строках. При равенстве «;» важнее «,» (запятая — десятичная). */
function detectDelimiter(text: string): string {
  const lines: string[] = [];
  for (const ln of text.slice(0, 65536).split(/\r\n|\n|\r/)) { if (/[^ \t]/.test(ln)) { lines.push(ln); if (lines.length >= 20) break; } }
  let bestD = ';', bestSame = 0, bestTotal = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map(ln => { let n = 0, q = false; for (const ch of ln) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; });
    // первая строка часто — заголовок отчёта без разделителей, поэтому меряем самое частое ненулевое число
    let mode = 0, modeN = 0;
    for (const c of counts) { if (c <= 0) continue; const n = counts.filter(x => x === c).length; if (n > modeN || (n === modeN && c > mode)) { mode = c; modeN = n; } }
    const total = counts.reduce((a, b) => a + b, 0);
    if (modeN > bestSame || (modeN === bestSame && total > bestTotal)) { bestD = d; bestSame = modeN; bestTotal = total; }
  }
  return bestD;
}

/** RFC 4180 с поблажками: кавычки, "" внутри, переводы строк в кавычках, CR/LF/CRLF. */
function parseCsv(text: string, delim: string, maxRecords: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field: string[] = [], quoted = false, atStart = true;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field.push(ch);
      else if (text[i + 1] === '"') { field.push('"'); i++; }
      else quoted = false;
    } else if (ch === '"' && atStart) { quoted = true; atStart = false; }
    else if (ch === delim) { row.push(field.join('')); field = []; atStart = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.join('')); rows.push(row); row = []; field = []; atStart = true;
      if (rows.length > maxRecords) return rows;
    } else { field.push(ch); atStart = false; }
  }
  if (field.length || row.length) { row.push(field.join('')); rows.push(row); }
  return rows;
}

type Role = 'name' | 'category' | 'price' | 'volume' | 'unit' | '';

function headerRole(cell: string): Role {
  const h = foldWords(cleanCell(cell, 80)).join(' ');
  if (!h) return '';
  const has = (list: string[]) => list.some(k => h.indexOf(k) >= 0);
  if (has(HEADER_CATEGORY)) return 'category';
  if (has(HEADER_PRICE) && !has(HEADER_PRICE_NOT)) return 'price';
  if (HEADER_UNIT.indexOf(h) >= 0) return 'unit';
  if (has(HEADER_VOLUME) || h === 'out') return 'volume';
  if (HEADER_NAME.indexOf(h) >= 0 || HEADER_NAME_PREFIX.some(k => h.indexOf(k + ' ') === 0)) return 'name';
  return '';
}

// «Себестоимость», «Закупочная», «Cost» — колонка заведомо не с названием: запасным вариантом в неё не падаем.
function isCostHeader(cell: string): boolean {
  const h = foldWords(cleanCell(cell, 80)).join(' ');
  return HEADER_PRICE_NOT.some(k => h.indexOf(k) >= 0);
}

interface Columns { name: number; category: number; price: number; volume: number; unit: number; }

function mapColumns(cells: string[]): Columns {
  const cols: Columns = { name: -1, category: -1, price: -1, volume: -1, unit: -1 };
  cells.forEach((cell, i) => { const r = headerRole(cell); if (r && cols[r] < 0) cols[r] = i; });
  return cols;
}

function extractCsv(text: string): Extracted {
  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, delimiter, MAX_ROWS + 50);
  const out: Extracted = { format: 'csv', delimiter, rows: [], skipped: 0, warnings: [] };

  // заголовок ищем в первых 10 записях: над таблицей бывает «Прейскурант на …» и пустые строки
  let head = -1, cols: Columns = { name: -1, category: -1, price: -1, volume: -1, unit: -1 };
  for (let i = 0; i < records.length && i < 10 && head < 0; i++) {
    const c = mapColumns(records[i]);
    if (c.name >= 0 || c.price >= 0) { head = i; cols = c; }
  }
  if (head >= 0 && cols.name < 0) {   // «Позиция меню; Цена» — название в первой колонке без роли
    const taken = [cols.category, cols.price, cols.volume, cols.unit];
    for (let i = 0; i < records[head].length && cols.name < 0; i++) if (taken.indexOf(i) < 0 && !isCostHeader(records[head][i])) cols.name = i;
    if (cols.name < 0) throw new MenuImportError('no_name_column');
  }
  if (head < 0) {   // без заголовка: название — первая колонка, цена — самая правая с числом, раздел — вторая
    const first = records.find(r => r.some(c => cleanCell(c, MAX_NAME) !== '')) || [];
    cols.name = 0;
    for (let i = first.length - 1; i > 0 && cols.price < 0; i--) if (parsePriceText(first[i]) > 0) cols.price = i;
    if (first.length >= 3 && cols.price !== 1) cols.category = 1;
  }
  if (cols.price < 0) out.warnings.push('no_price_column');

  const hint = cols.volume >= 0 && head >= 0 ? unitHint(foldWords(cleanCell(records[head][cols.volume], 80))) : '';
  let heading = '';
  for (let i = head + 1; i < records.length; i++) {
    const cells = records[i].map(c => cleanCell(c, MAX_NAME));
    if (!cells.some(c => c !== '')) continue;
    const name = cells[cols.name] || '';
    if (!name) { out.skipped++; continue; }
    const cents = cols.price >= 0 ? parsePriceText(cells[cols.price] || '') : 0;
    // прейскурант без колонки раздела: строка «ПИВО РАЗЛИВНОЕ» без цены и других ячеек — это заголовок раздела
    if (cols.category < 0 && cols.price >= 0 && !cents && !cells.some((c, j) => j !== cols.name && c !== '')) { heading = name.slice(0, MAX_CATEGORY); continue; }
    const category = cols.category >= 0 ? (cells[cols.category] || '').slice(0, MAX_CATEGORY) : heading;
    let rowHint: UnitHint = hint;
    if (cols.unit >= 0) { const u = unitHint(foldWords(cells[cols.unit] || '')); if (u) rowHint = u; }
    const m = cols.volume >= 0 ? measureFromCell(cells[cols.volume] || '', rowHint) : { unit: '' as const, amount: 0, text: '' };
    out.rows.push({ line: i + 1, name, category: trimSpaces(category), cents, unit: m.unit, amount: m.amount, volumeText: m.text });
    if (out.rows.length > MAX_ROWS) throw new MenuImportError('too_many_rows');
  }
  return out;
}

// ─────────────────────────────── публичное API ───────────────────────────────

function extract(text: string): Extracted {
  const body = trimSpaces(sanitize(text).replace(/^[ \t\r\n]+/, ''));
  if (!body) throw new MenuImportError('empty');
  if (body[0] !== '{' && body[0] !== '[') return extractCsv(body);
  let doc: unknown;
  try { doc = JSON.parse(body); } catch { throw new MenuImportError('bad_json'); }
  if (isObject(doc) && Array.isArray(doc['products'])) return extractIiko(doc);
  if (isObject(doc) && Array.isArray(doc['itemCategories'])) return extractIikoMenu(doc);
  if (isObject(doc) && Array.isArray(doc['response'])) return extractPoster(doc['response']);
  if (Array.isArray(doc) && doc.some(x => isObject(x) && typeof x['product_name'] === 'string')) return extractPoster(doc);
  throw new MenuImportError('unknown_format');
}

/** Текст файла → строки меню с кандидатами из каталога. Бросает MenuImportError с понятным текстом. */
export function parseMenu(text: string, catalog: ImportCatalog): ImportResult {
  if (typeof text !== 'string') throw new MenuImportError('empty');
  if (text.length > MAX_CHARS) throw new MenuImportError('too_large');
  const ex = extract(text);
  if (ex.rows.length > MAX_ROWS) throw new MenuImportError('too_many_rows');
  if (!ex.rows.length) throw new MenuImportError('no_rows');

  const ix = buildIndex(catalog);
  const stop = new Set(STOP_WORDS), drinks = new Set(DRINK_CATEGORIES), memo = new Map<string, Sims>();
  const result: ImportResult = { format: ex.format, delimiter: ex.delimiter, total: ex.rows.length, skipped: ex.skipped,
                                 matched: 0, ambiguous: 0, unmatched: 0, warnings: ex.warnings, rows: [] };
  ex.rows.forEach((raw, index) => {
    const low = lowerKeep(raw.name);
    const inName = findMeasure(low), bare = inName ? null : findBareLitres(low);
    const cut = inName || bare;
    const forMatch = cut ? cutOut(raw.name, cut.start, cut.end) : raw.name;
    const words = foldWords(forMatch).filter(w => !stop.has(w) && (!isNumeric(w) || ix.keepNumbers.indexOf(w) >= 0));
    const m = matchWords(ix, words, foldWords(raw.category).some(w => drinks.has(w)), memo);

    // объём: колонка/размер/выход из файла → «число + единица» в названии → для пива голое «0,5» = литры
    let unit = raw.unit, amount = raw.amount, title = raw.name;
    if (inName) { title = forMatch; if (!unit) { unit = inName.unit; amount = inName.amount; } }
    else if (bare && m.kind === 'BEER') { title = forMatch; if (!unit) { unit = 'ml'; amount = bare.amount; } }
    if (m.kind === 'BEER' && unit === 'g') unit = 'ml';   // выход пива в граммах (тех. карта) показываем литрами
    const volume = unit ? formatMeasure(unit, amount) : raw.volumeText;

    result[m.status]++;
    result.rows.push({ index, line: raw.line, name: raw.name, title, category: raw.category, price: priceFromCents(raw.cents), volume,
                       kind: m.kind, status: m.status, ref_slug: m.ref_slug, confidence: m.confidence, candidates: m.candidates });
  });
  return result;
}

/**
 * Что именно запишем в карту. choices: { "<index>": "<slug>" | "" } — выбор владельца ('' = не импортировать).
 * existing — ключи «KIND:slug» уже имеющихся позиций (они обновляются и лимит не тратят), limit — лимит тарифа.
 * Одна позиция каталога = одна строка карты: из «Efes 0,3» и «Efes 0,5» берётся первая, остальные — duplicates.
 */
export function planImport(rows: ImportRow[], choices: Record<string, string>, catalog: ImportCatalog, existing: string[], limit: number): ImportPlan {
  const plan: ImportPlan = { items: [], created: 0, updated: 0, over_limit: 0, duplicates: 0, needs_choice: 0, skipped_by_user: 0, unmatched: 0 };
  const brands = new Map(catalog.brands.map(b => [b.id, b])), dishes = new Map(catalog.dishes.map(d => [d.id, d]));
  const seen: string[] = [];
  let used = existing.length;
  for (const row of rows) {
    if (row.status === 'unmatched' || !row.kind) { plan.unmatched++; continue; }
    const choice = Object.prototype.hasOwnProperty.call(choices, String(row.index)) ? choices[String(row.index)] : undefined;
    if (choice === '') { plan.skipped_by_user++; continue; }
    let slug = typeof choice === 'string' && row.candidates.some(c => c.slug === choice) ? choice : '';
    if (!slug && row.status === 'matched') slug = row.ref_slug;
    if (!slug) { plan.needs_choice++; continue; }
    const key = `${row.kind}:${slug}`;
    if (seen.indexOf(key) >= 0) { plan.duplicates++; continue; }
    seen.push(key);

    const brand = brands.get(slug), dish = dishes.get(slug);
    const catalogName = row.kind === 'BEER' ? (brand ? brand.display_name : '') : (dish ? dish.display_name : '');
    const update = existing.indexOf(key) >= 0;
    if (!update && used >= limit) { plan.over_limit++; continue; }
    if (update) plan.updated++; else { plan.created++; used++; }
    const fallback = row.kind === 'BEER' ? (brand && brand.packaging_type === 'DRAFT' ? 'Разливное' : 'Бутылка и банка') : ((dish && dish.category) || 'Основное');
    plan.items.push({ kind: row.kind, ref_slug: slug, name: row.title === catalogName ? '' : row.title,
                      category: row.category || (update ? '' : fallback.slice(0, MAX_CATEGORY)), price: row.price, volume: row.volume,
                      action: update ? 'update' : 'create' });
  }
  return plan;
}
