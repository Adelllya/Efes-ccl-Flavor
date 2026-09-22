/**
 * Flavor Tree Pairing Engine v2 — TypeScript-порт backend/api/pairing/engine_v2.py (v2.2.0).
 *
 * Python — источник истины; этот файл повторяет его 1-в-1: порядок операций в формулах, порядок правил
 * R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12 R14 R13 R20 R15 R16 R17, округления, выбор ключей и тексты.
 * Паритет: `npm run test:engine2` (scripts/engine-parity-v2.mjs) по data/golden_v2.json
 * (генерирует scripts/engine_eval_v2.py). Не меняйте формулы здесь без зеркальной правки в Python и регенерации golden.
 *
 * Все коэффициенты и ВСЕ русские тексты/подписи — в data/engine_v2_params.json. Модуль не читает файлы и не зависит
 * от Angular: параметры передаются аргументом `params` или один раз через `setDefaultParams(params)`
 * (слой калибровки: `setDefaultParams(mergeParams(params, calibration.params))`).
 *
 * Эмуляция Python (раздел «Python-семантика» ниже):
 *  • r2/r1/roundHalfUp = floor(x·k + 0.5)/k (НЕ Math.round), суммы — наивный цикл слева направо (как fsum);
 *  • числа в текстах — только fmt2 (r2(x).toFixed(2)) и fmtNum (одна десятичная, «.0» отбрасывается);
 *  • `a or b`, `if x:`, `bool(x)` — truthy() по правилам Python (пустые {} и [] ложны, 0 ложен);
 *  • max()/min() — первый экстремум (pyMax/pyMin), sorted() строк — по кодовым точкам (pyStrCmp, не localeCompare);
 *  • dict.get — только собственные ключи (dget), str() — pyStr (None → «None»), {slot} — \w в смысле Unicode;
 *  • словари с ключами из данных — через Map/setOwn (без прототипной цепочки и без «__proto__»-ловушек).
 */

// ─────────────────────────────────────────────────────────────────────────────
// константы и типы
// ─────────────────────────────────────────────────────────────────────────────
export const ENGINE_VERSION = '2.2.1';

export const DRINK_AXES = ['sweet', 'acid', 'bitter', 'tannin', 'carbonation', 'alcohol', 'body', 'dairy',
  'salt', 'umami', 'aroma_intensity', 'roast', 'smoke', 'serve_temp'] as const;
export const DISH_AXES = ['salt', 'sweet', 'sour', 'bitter', 'umami', 'fat', 'protein', 'heat', 'pungent',
  'weight', 'cream', 'maillard', 'smoke', 'fresh', 'fish_oil', 'green_iron'] as const;
export const CATEGORIES = ['beer', 'na_beer', 'radler', 'cider', 'wine', 'sparkling', 'fortified', 'cocktail',
  'spirit', 'liqueur', 'kvass', 'lemonade', 'soda', 'dairy', 'tea', 'coffee', 'water'] as const;
export const CAP_VETOES = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const;
/** Критерий «bad» для эталонных пар (engine_eval_v2.py, calibrate_v2.py): ниже этого балла — «не рекомендуем». */
export const BAD_ABSOLUTE = 48;

/** короткие ключи прототипа → ключи контракта */
const SHORT_AXES = new Map<string, string>([['carb', 'carbonation'], ['aroma', 'aroma_intensity'], ['temp', 'serve_temp']]);

export type DrinkAxis = typeof DRINK_AXES[number];
export type DishAxis = typeof DISH_AXES[number];
export type Category = typeof CATEGORIES[number];
export type DrinkVec = Record<DrinkAxis, number>;
export type DishVec = Record<DishAxis, number>;
export type Occasion = 'meal' | 'aperitif' | 'dessert' | 'hot' | 'evening' | 'party' | 'gourmet' | 'non_alcoholic';
export type HarshProfile = 'sensitive' | 'median' | 'tolerant';
export type Rating = 'love' | 'like' | 'meh' | 'dislike';
export type EfesRelation = 'own' | 'distribution' | 'cci' | 'none';
/** Семейство компонента: balance (R1, R13), cut / contrast / complement / bridge, penalty, context (R15–R17). */
export type RuleFamily = 'balance' | 'cut' | 'contrast' | 'complement' | 'bridge' | 'penalty' | 'context';
type Num = number | null | undefined;
type TagsInput = Readonly<Record<string, Num>> | readonly string[];

/** Запись drinks.json / архетип style_priors_v2 (с id) / запись прототипа (оси на верхнем уровне, carb/aroma/temp). */
export interface DrinkRecord {
  id?: string | null;
  name?: string | null;
  display_name?: string | null;
  label_ru?: string | null;
  category?: string | null;
  cat?: string | null;
  style?: { archetype?: string | null; family?: string | null; name?: string | null } | null;
  family?: string | null;
  archetype?: string | null;
  abv?: number | null;
  abv_after_dilution?: number | null;
  ibu?: number | null;
  sensory?: Readonly<Record<string, Num>> | null;
  vector?: Readonly<Record<string, Num>> | null;
  vector_override?: Readonly<Record<string, Num>> | null;
  aroma_tags?: TagsInput | null;
  tags?: TagsInput | null;
  origin_affinity?: readonly string[] | string | null;
  origin?: readonly string[] | string | null;
  efes_relation?: EfesRelation | string | null;
  flags?: { non_alcoholic?: boolean | null } | null;
  serving?: { temp_min_c?: number | null; temp_max_c?: number | null } | null;
  [key: string]: unknown;
}

/** Запись dishes_v2.json (или прототипа: оси на верхнем уровне, dessert, vinegar). */
export interface DishRecord {
  id?: string | null;
  name?: string | null;
  display_name?: string | null;
  vector?: Readonly<Record<string, Num>> | null;
  tags?: TagsInput | null;
  cuisine?: readonly string[] | string | null;
  is_dessert?: boolean | null;
  dessert?: boolean | null;
  acid_type?: string | null;
  vinegar?: boolean | null;
  cook_method?: string | null;
  protein_source?: string | null;
  sauce?: string | null;
  [key: string]: unknown;
}

/** Профиль напитка — результат drinkVector (повторный вызов возвращает его как есть). */
export interface DrinkProfile {
  _v2: 'drink';
  id: string;
  name: string;
  category: string;
  family: string;
  archetype: string | null;
  abv: number;
  ibu: number | null;
  v: DrinkVec;
  tags: Record<string, number>;
  origin: string[];
  efes_relation: string;
  non_alcoholic_flag: boolean;
  words: Record<string, string>;
}

/** Профиль блюда — результат dishVector. */
export interface DishProfile {
  _v2: 'dish';
  id: string;
  name: string;
  v: DishVec;
  tags: Record<string, number>;
  cuisine: string[];
  is_dessert: boolean;
  vinegar: boolean;
  acid_type: string;
  cook_method: string | null;
  protein_source: string;
  sauce: string;
  words: Record<string, string>;
}

export type DrinkInput = DrinkRecord | DrinkProfile;
export type DishInput = DishRecord | DishProfile;

/** Контекст подбора (§6). */
export interface Ctx {
  occasion?: Occasion | null;
  /** число или профиль sensitive / median / tolerant */
  harsh_tol?: number | HarshProfile | null;
  /** −1…1 */
  bitter_pref?: number | null;
  /** −1…1 */
  sweet_pref?: number | null;
  heat_lover?: boolean | null;
  /** Flavor DNA гостя: {ось: 0..1} (см. dnaVector) */
  dna?: Readonly<Record<string, Num>> | null;
  non_alcoholic?: boolean | null;
  non_alcoholic_max_abv?: number | null;
  /** включает R18 (температура восприятия) */
  temperature_perception?: boolean | null;
  categories?: readonly string[] | null;
  venue_drink_ids?: readonly string[] | null;
}

/** Классическая пара (data/classic_pairs.json, R20). drink — архетип или id напитка. */
export interface ClassicPair {
  dish: string;
  drink: string;
  bonus?: number | null;
  label?: string | null;
  source?: { title?: string | null; url?: string | null; quote?: string | null } | string | null;
}
export type ClassicIndex = Record<string, ClassicPair>;
export type ClassicsArg = readonly ClassicPair[] | ClassicIndex | null | undefined;

/** Компонент балла (правило). points уже округлены r2. */
export interface Mechanism {
  rule: string;
  family: RuleFamily;
  points: number;
  key: string;
  evidence: string;
  text: string;
}
/** Вето в предупреждениях (points = 0, cap — потолок балла или null для V7). */
export interface VetoItem {
  rule: string;
  family: 'veto';
  points: number;
  key: string;
  evidence: string;
  cap: number | null;
  text: string;
}
export type WarningItem = VetoItem | Mechanism;

export interface Band { id: string; label: string }

export interface PairResult {
  engine: 'v2';
  version: string;
  drink_id: string;
  dish_id: string;
  drink_name: string;
  dish_name: string;
  category: string;
  family: string;
  archetype: string | null;
  efes_relation: string;
  efes_partner: boolean;
  abv: number;
  score: number;
  band: string;
  band_label: string;
  match_type: string;
  secondary_type: string | null;
  mechanisms: Mechanism[];
  reasons: Mechanism[];
  warnings: WarningItem[];
  vetoes: string[];
  capped: boolean;
  excluded: boolean;
  classic: boolean;
  W_B: number; F_B: number; W_D: number; F_D: number; W_B_eff: number; dW: number; dF: number; fit: number;
  core: number; ctx_points: number; raw: number;
  components: Mechanism[];
}

export interface RecommendResult {
  engine: 'v2';
  dish_id: string;
  items: PairResult[];
  best_partner: PairResult | null;
  n_candidates: number;
  excluded_non_alcoholic: string[];
  policy: { partner_tie_window: number; note: string };
}

export interface CategoryGroup { category: string; label: string; n: number; best: PairResult; items: PairResult[] }
export interface ByCategoryResult {
  engine: 'v2';
  dish_id: string;
  categories: CategoryGroup[];
  best_partner: PairResult | null;
  excluded_non_alcoholic: string[];
}

export interface ReverseResult { engine: 'v2'; drink_id: string; items: PairResult[]; excluded: boolean }

/** W/F напитка и/или блюда без округления (§2.2, §3.1). */
export interface Derived {
  W_B?: number; F_B?: number; burn?: number; W_D?: number; F_D?: number;
  boost?: number; W_B_eff?: number; dW?: number; dF?: number; strong_dish?: boolean; fit?: number;
}
interface Intensity {
  W_B: number; F_B: number; W_D: number; F_D: number; boost: number; W_B_eff: number;
  dW: number; dF: number; strong_dish: boolean; fit: number;
}

export interface RatedDrink {
  drink?: DrinkInput | null;
  vector?: Readonly<Record<string, Num>> | null;
  rating?: Rating | null;
}

// ── параметры (data/engine_v2_params.json) ──────────────────────────────────
type Texts = Record<string, string>;
type Pairs = string[][];
interface VetoCap { cap: number; evidence: string; text: string }

export interface ParamsV2 {
  version?: string;
  axes: { drink: string[]; dish: string[]; dish_defaults: Record<string, number>; drink_default_serve_temp: number };
  derived: {
    alcohol_abv_scale: number;
    W_B: { body: number; abv: number; abv_scale: number; sweet: number };
    F_B: { aroma_intensity: number; bitter: number; roast: number; smoke: number; tannin: number; acid: number; burn: number };
    W_D: { weight: number; fat: number; cream: number; protein: number; dessert_sweet: number; dessert_fat: number; dessert_cream: number };
    F_D: {
      heat: number; smoke: number; salt: number; umami: number; maillard: number; sour: number; sweet: number;
      pungent: number; bitter: number; dessert_sweet: number; dessert_bitter: number; dessert_choc: number;
      dessert_choc_tags: string[];
    };
    burn: { x0: number; x1: number; y1: number; x2: number; y2: number; x3: number };
    cold: { t_ref: number; span: number };
  };
  R1: {
    evidence: string; light_boost: number; light_boost_carb: number; base: number; k_loud: number; k_loud_strong: number;
    k_quiet: number; k_weight: number; min: number; max: number; strong_protein: number; strong_salt: number;
    strong_fat: number; fit_offset: number; fit_offset_strong: number; fit_span: number; text_dF: number;
    text_dW: number; text_boost_min: number; text_ok_min: number;
    texts: {
      loud: string; quiet: string; loud_ok: string; quiet_ok: string; match: string; w_boost: string; w_light: string; w_heavy: string; w_match: string;
      join: string; helpers: Texts;
    };
  };
  R2: {
    evidence: string; evidence_tannin: string; min_richness: number; richness_cream: number; richness_weight: number;
    tannin: number; bitter: number; bitter_heat_discount: number; carbonation: number; carbonation_cream_discount: number;
    acid: number; roast: number; alcohol: number; scale: number; min: number; max: number; coat_cream_min: number;
    texts: Texts;
  };
  R3: {
    evidence: string; min_heat: number; relief_sweet: number; relief_sweet_sat: number; relief_dairy: number;
    relief_cold: number; relief_body: number; hop_threshold: number; hop_span: number; salt_soft: number;
    aggr_burn: number; aggr_hop_salt: number; aggr_hop_abv: number; hop_abv_offset: number; hop_abv_span: number;
    aggr_tannin: number; aggr_carb: number; carb_threshold: number; carb_span: number; k_relief: number;
    k_aggr: number; heat_lover_relief: number; min: number; max: number; texts: Texts;
  };
  R4: {
    evidence: string; min_sweet: number; base: number; k_match: number; tolerance: number; k_gap: number;
    contrast_categories: string[]; contrast_bitter: number; contrast_dF: number; contrast_floor: number;
    hot_contrast_categories: string[]; hot_contrast_min_temp: number; hot_contrast_floor: number;
    choc: number; choc_tags: string[]; roast_sweet: number; fruit: number; fruit_nondessert: number;
    fruit_max: number; fruit_tags: string[]; min: number; max: number; text_roast_min: number;
    text_fruit_min: number; texts: Texts;
  };
  R5: {
    evidence: string; min_sour: number; vinegar_bonus: number; carb_as_acid: number; k_gap: number;
    vinegar_mult: number; k_match: number; tannin_threshold: number; k_tannin: number; sweet_threshold: number;
    k_sweet: number; min: number; max: number; text_clause_min: number; texts: Texts;
  };
  R6: {
    evidence: string; evidence_forgive: string; min_salt: number; k_forgive: number; forgive_tannin: number;
    forgive_max: number; k_clean: number; shield: number; k_alco: number; alco_threshold: number; alco_span: number;
    k_tann: number; tann_threshold: number; tann_span: number; snack_points: number; snack_salt: number;
    snack_weight: number; snack_carb: number; snack_bitter: number; min: number; max: number; texts: Texts;
  };
  R7: {
    evidence: string; min_umami: number; salt_gate: number; sour_gate: number; k_neg: number; neg_tannin: number;
    neg_bitter: number; neg_alcohol: number; k_pos: number; pos_bitter: number; pos_acid: number; k_match: number;
    min: number; max: number; text_match_min: number;
    texts: { pos: string; neg: string; match: string; helpers: Texts };
  };
  R8: {
    evidence: string; min_tannin: number; k_plus: number; protein_gate: number; low_protein_mult: number;
    k_fish: number; k_green: number; k_dry: number; dry_threshold: number; min: number; max: number; texts: Texts;
  };
  R9: {
    evidence: string; min_fresh: number; carbonation: number; clean: number; acid: number; roast: number;
    body: number; body_threshold: number; body_span: number; alcohol: number; alcohol_threshold: number;
    alcohol_span: number; bitter: number; bitter_threshold: number; bitter_span: number; smoke: number;
    k_fish_hop: number; fish_hop_threshold: number; fish_hop_span: number; min: number; max: number; texts: Texts;
  };
  R10: {
    evidence: string; min_maillard: number; bread: number; toast: number; nutty: number; k: number;
    min: number; max: number; texts: { main: string; none: string; notes: Texts };
  };
  R11: { evidence: string; min_smoke: number; k_smoke: number; k_roast: number; min: number; max: number; texts: Texts };
  R12: {
    evidence: string; k: number; min: number; max: number; text_top: number; exclude_tags: string[];
    texts: { main: string };
  };
  R13: { evidence: string; points: number; min_pts: number; texts: { main: string } };
  R14: {
    evidence: string; k_bitter: number; sweet_penalty: number; sweet_categories: string[]; sweet_threshold: number;
    min: number; max: number; emit_below: number; texts: Texts;
  };
  R15: { evidence: string; points: number; texts: { main: string } };
  R16: {
    evidence: string; min: number; max: number;
    meal: {
      light_bonus: number; light_max_abv: number; light_min_carb: number; strong_penalty: number;
      strong_min_abv: number; k_alcohol: number; alcohol_threshold: number; alcohol_span: number;
    };
    aperitif: { k_bitter_carb: number; k_acid: number; k_body: number; body_threshold: number };
    dessert: { sweet_bonus: number; sweet_min: number; alcohol_bonus: number; alcohol_min: number };
    hot: { carbonation: number; acid: number; alcohol: number };
    evening: { body: number; abv: number; abv_scale: number };
    party: { clean: number; carbonation: number; alcohol: number };
    gourmet: { aroma_intensity: number; tannin: number; body: number };
    texts: Texts;
  };
  R17: {
    evidence: string;
    harsh_tol: Record<string, number>;
    bitter_pref: { k: number; center: number; max: number };
    sweet_pref: { k: number; center: number; max: number };
    dna: { k: number; center: number; max: number; axes: string[]; rating_weights: Record<string, number> };
    texts: Texts;
  };
  R18: { enabled: boolean; t_ref: number; t_span: number; k_sweet: number; k_bitter: number };
  R20: { evidence: string; bonus: number; max_bonus: number; texts: { main: string; fallback_source: string } };
  vetoes: {
    order: string[];
    V1: VetoCap & { dF: number; dF_combo: number; dW_combo: number };
    V2: VetoCap & { dish_sweet: number; drink_sweet: number; roast_exempt: number };
    V3: VetoCap & { heat: number; abv: number };
    V4: VetoCap & { tannin: number; fish_oil: number };
    V5: VetoCap & { fresh: number; abv: number };
    V6: VetoCap & { dF: number; dF_combo: number; dW_combo: number };
    V7: { max_abv: number; evidence: string; text: string };
  };
  score: { base: number; k: number; min: number; max: number };
  bands: { avoid_max: number; avoid: Band; list: { id: string; min: number; label: string }[] };
  mechanisms: {
    min_abs: number; reasons_top: number; families: string[]; exclude_rules: string[]; secondary_min: number;
    penalty_below: number; fallback_type: string;
  };
  recommend: {
    partner_tie_window: number; efes_relations: string[]; top_n: number; reverse_top_n: number;
    diversify: { group_by: string; max_per_group: number; min_score_guarantee: number; na_max_abv: number; beer_categories: string[] };
    policy_note: string;
  };
  labels: {
    category: Texts; category_gen: Texts; category_gen_default: string; hop_categories: string[];
    bitter_ibu: string; bitter_hop: string; bitter_other: string; ibu_paren: string;
    protein_gen: Texts; protein_tag_order: Pairs; protein_tag_min: number; oily_fish_min: number;
    fat_sauce: Texts; fat_sauce_cream_min: number; fat_tags: Pairs; fat_default: string;
    salt_order: Pairs; salt_sauce: Texts; salt_default: string;
    acid_type: Texts; acid_tags: Pairs; acid_default: string;
    chili_tags: Pairs; chili_sauce: string; chili_default: string;
    crust_cook: Texts; crust_tags: Pairs; crust_default: string;
    smoke_cook: Texts; smoke_tags: Pairs; smoke_default: string;
    umami_tags: Pairs; umami_sauce: Texts; umami_default: string;
    tag_min: number; tags: Texts; cuisine: Texts; cuisine_default: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Python-семантика (каждый помощник — точный аналог конструкции Python)
// ─────────────────────────────────────────────────────────────────────────────
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** dict (не список, не null) — аналог isinstance(x, dict) для данных из JSON. */
function isDict(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Истинность по Python: None/False/0/""/[]/{} ложны; NaN истинен. */
export function truthy(x: unknown): boolean {
  if (x === null || x === undefined || x === false) return false;
  if (typeof x === 'number') return x !== 0;
  if (typeof x === 'string') return x.length > 0;
  if (typeof x === 'bigint') return x !== BigInt(0);
  if (Array.isArray(x)) return x.length > 0;
  if (x instanceof Map || x instanceof Set) return x.size > 0;
  if (isDict(x)) return Object.keys(x).length > 0;
  return true;
}

/** `a or b or c`: первый истинный операнд, иначе последний. */
function pyOr<T>(...xs: T[]): T {
  for (let i = 0; i < xs.length - 1; i++) if (truthy(xs[i])) return xs[i];
  return xs[xs.length - 1];
}

/** str(x): None → «None», bool → «True»/«False». Числа — как String() (для строковых id/имён совпадает всегда). */
function pyStr(x: unknown): string {
  if (x === null || x === undefined) return 'None';
  if (x === true) return 'True';
  if (x === false) return 'False';
  return typeof x === 'string' ? x : String(x);
}

/** float(x) для уже проверенного на None значения. */
const pyFloat = (x: unknown): number => Number(x);

/** dict.get(k): только собственные ключи; ключи JSON — строки, поэтому нестроковый ключ никогда не найден. */
function dget<T>(o: Readonly<Record<string, T>> | null | undefined, k: unknown): T | undefined {
  return o != null && typeof k === 'string' && hasOwn(o, k) ? o[k] : undefined;
}
function dgetOr<T, D>(o: Readonly<Record<string, T>> | null | undefined, k: unknown, dflt: D): T | D {
  return o != null && typeof k === 'string' && hasOwn(o, k) ? o[k] : dflt;
}
/** tags.get(t, 0.0) */
const tagW = (tags: Readonly<Record<string, number>>, t: string): number => dgetOr(tags, t, 0);

/** d[k] = v как собственное свойство (ключ «__proto__» не трогает прототип). */
function setOwn<T>(o: Record<string, T>, k: string, v: T): void {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
  else o[k] = v;
}

/** max(a, b, …) Python: первый максимальный (замена только при строгом >). */
function pyMax(first: number, ...rest: number[]): number {
  let m = first;
  for (const x of rest) if (x > m) m = x;
  return m;
}
/** min(a, b, …) Python: первый минимальный (замена только при строгом <). */
function pyMin(first: number, ...rest: number[]): number {
  let m = first;
  for (const x of rest) if (x < m) m = x;
  return m;
}

/** Сравнение строк как в Python (по кодовым точкам; JS-сортировка по UTF-16 расходится на символах вне BMP). */
export function pyStrCmp(a: string, b: string): number {
  if (a === b) return 0;
  let i = 0;
  while (i < a.length && i < b.length) {
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(i) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
  }
  return a.length - i > 0 ? 1 : b.length - i > 0 ? -1 : 0;
}

const cmpNum = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

/** Глубокая копия данных JSON (copy.deepcopy). */
function deepCopy<T>(x: T): T {
  if (Array.isArray(x)) return x.map((y) => deepCopy(y)) as unknown as T;
  if (isDict(x)) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(x)) setOwn(o, k, deepCopy(x[k]));
    return o as T;
  }
  return x;
}

// ─────────────────────────────────────────────────────────────────────────────
// численные помощники (зеркало engine_v2.py)
// ─────────────────────────────────────────────────────────────────────────────
export const clamp = (x: number, lo = 0, hi = 1): number => (x < lo ? lo : x > hi ? hi : x);
export const pos = (x: number): number => (x > 0 ? x : 0);
/** Округление до сотых «половина вверх» по двоичному значению (= Python r2). */
export const r2 = (x: number): number => Math.floor(x * 100 + 0.5) / 100;
/** До десятых (= Python r1). */
export const r1 = (x: number): number => Math.floor(x * 10 + 0.5) / 10;
/** Целое «половина вверх» (= Python round_half_up; не Math.round). */
export const roundHalfUp = (x: number): number => Math.floor(x + 0.5);

/** Наивная сумма слева направо (= Python fsum). */
export function fsum(values: Iterable<number>): number {
  let acc = 0;
  for (const v of values) acc += v;
  return acc;
}

/** Два знака после точки (= Python fmt2: "%.2f" % r2(x)). */
export const fmt2 = (x: number): string => r2(x).toFixed(2);

/** Одна десятичная, «.0» отбрасывается: 5 → «5», 4.4 → «4.4» (= Python fmt_num). */
export function fmtNum(x: number | null | undefined): string {
  if (x === null || x === undefined) return '';
  const r = r1(pyFloat(x));
  if (r === Math.floor(r)) return BigInt(r).toString(); // str(int(r))
  return r.toFixed(1);
}

const SLOT = /\{([\p{L}\p{N}_]+)\}/gu; // = Python r"\{(\w+)\}" (\w в смысле Unicode)

/** Подстановка {slot}; неизвестный слот остаётся как есть (= Python tpl). */
export function tpl(template: string, slots: Readonly<Record<string, unknown>>): string {
  return template.replace(SLOT, (m: string, k: string) => (hasOwn(slots, k) ? pyStr(slots[k]) : m));
}

/** Первая буква заглавная (= Python cap_first; по кодовой точке). */
export function capFirst(s: string): string {
  if (!s) return s;
  const first = String.fromCodePoint(s.codePointAt(0) as number);
  return first.toUpperCase() + s.slice(first.length);
}

type KV = [string, number];
/** Первый ключ с максимальным значением (строгое >, порядок — как передан). */
function argmax(items: readonly KV[]): KV {
  let [bk, bv] = items[0];
  for (let i = 1; i < items.length; i++) {
    const [k, v] = items[i];
    if (v > bv) { bk = k; bv = v; }
  }
  return [bk, bv];
}
function argmin(items: readonly KV[]): KV {
  let [bk, bv] = items[0];
  for (let i = 1; i < items.length; i++) {
    const [k, v] = items[i];
    if (v < bv) { bk = k; bv = v; }
  }
  return [bk, bv];
}

// ─────────────────────────────────────────────────────────────────────────────
// параметры
// ─────────────────────────────────────────────────────────────────────────────
let DEFAULT_PARAMS: ParamsV2 | null = null;

/** Параметры по умолчанию для вызовов без params (SPA: импорт data/engine_v2_params.json [+ калибровка]). */
export function setDefaultParams(params: ParamsV2 | null): void {
  DEFAULT_PARAMS = params;
}

/** Параметры по умолчанию (только чтение — для правок используйте mergeParams). */
export function defaultParams(): ParamsV2 {
  if (!DEFAULT_PARAMS) {
    throw new Error('pairing-engine-v2: параметры не заданы — вызовите setDefaultParams(params) или передайте params явно');
  }
  return DEFAULT_PARAMS;
}

/** `params or default_params()` */
function pickParams(params: ParamsV2 | null | undefined): ParamsV2 {
  return params && truthy(params) ? params : defaultParams();
}

/** d[k1][k2]…[kn] = value по пути «k1.k2…kn»; недостающие/не-словари по пути заменяются новыми {} (= Python _set_path). */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    let nxt = dget(cur, k);
    if (!isDict(nxt)) {
      nxt = {};
      setOwn(cur, k, nxt);
    }
    cur = nxt as Record<string, unknown>;
  }
  setOwn(cur, keys[keys.length - 1], value);
}

/** Значение по пути «a.b.c»; отсутствующий ключ — ошибка (как KeyError в Python). */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (!isDict(cur) || !hasOwn(cur, k)) throw new Error(`getPath: нет ключа «${k}» в пути «${path}»`);
    cur = cur[k];
  }
  return cur;
}

function deepMerge(dst: Record<string, unknown>, src: Readonly<Record<string, unknown>>): void {
  for (const k of Object.keys(src)) {
    const v = src[k];
    const cur = dget(dst, k);
    if (isDict(v) && isDict(cur)) deepMerge(cur, v);
    else setOwn(dst, k, deepCopy(v));
  }
}

/**
 * Новые параметры = base + override (base не изменяется, результат — глубокая копия; = Python merge_params).
 * override — вложенный объект и/или плоские пути: {"R1.k_loud": 60, "score": {"base": 42}}.
 * Вложенные словари сливаются рекурсивно, override побеждает, массивы заменяются целиком;
 * ключ с точкой — путь (значение по пути заменяется целиком, даже если это словарь).
 */
export function mergeParams<T extends object = ParamsV2>(base: T, override?: Readonly<Record<string, unknown>> | null): T {
  const out = deepCopy(base) as unknown as Record<string, unknown>;
  if (!override || !truthy(override)) return out as unknown as T;
  for (const k of Object.keys(override)) {
    const v = override[k];
    if (k.includes('.')) setPath(out, k, deepCopy(v));
    else {
      const cur = dget(out, k);
      if (isDict(v) && isDict(cur)) deepMerge(cur, v);
      else setOwn(out, k, deepCopy(v));
    }
  }
  return out as unknown as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// загрузка данных (= backend/api/pairing/dataset_v2.py::_as_records)
// ─────────────────────────────────────────────────────────────────────────────
const WRAPPER_KEYS = ['items', 'drinks', 'dishes', 'pairs', 'classics', 'archetypes', 'styles'];

/**
 * Файл данных → массив записей (= Python dataset_v2._as_records): массив (не-объекты отбрасываются), или
 * {id: запись} (ключи с «_» и не-объекты пропускаются, id = ключ, если его нет в записи), или обёртка
 * {"items"|"drinks"|"dishes"|"pairs"|"classics"|"archetypes"|"styles": <одно из двух>}.
 * Нужен для data/style_priors_v2.json — это словарь {archetype_id: запись} без поля id.
 */
export function asRecords<T extends object = Record<string, unknown>>(obj: unknown, unwrap = true): T[] {
  if (Array.isArray(obj)) return obj.filter((x) => isDict(x)) as T[];
  if (!isDict(obj)) return [];
  if (unwrap) {
    for (const k of WRAPPER_KEYS) {
      const v = dget(obj, k);
      if (Array.isArray(v) || isDict(v)) return asRecords<T>(v, false);
    }
  }
  const out: T[] = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (k.startsWith('_') || !isDict(v)) continue;
    const rec: Record<string, unknown> = { ...v };
    if (!hasOwn(rec, 'id')) rec['id'] = k;
    out.push(rec as T);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// нормализация входов
// ─────────────────────────────────────────────────────────────────────────────
function asTags(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!truthy(raw)) return out;
  if (Array.isArray(raw)) {
    for (const t of raw) setOwn(out, pyStr(t), 1.0);
    return out;
  }
  if (isDict(raw)) {
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      if (v !== null && v !== undefined) setOwn(out, pyStr(k), pyFloat(v));
    }
  }
  return out;
}

function asList(raw: unknown): string[] {
  if (!truthy(raw)) return [];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.map((x) => pyStr(x));
  if (isDict(raw)) return Object.keys(raw);
  return [];
}

/** Первый по приоритету тег с весом ≥ minW → его подпись. */
function pickLabel(tags: Readonly<Record<string, number>>, order: readonly (readonly string[])[], minW: number): string | null {
  for (const [tag, label] of order) if (tagW(tags, tag) >= minW) return label;
  return null;
}

function isDrinkProfile(x: DrinkInput): x is DrinkProfile {
  return (x as { _v2?: unknown })._v2 === 'drink';
}
function isDishProfile(x: DishInput): x is DishProfile {
  return (x as { _v2?: unknown })._v2 === 'dish';
}

export function isEfesRelation(relation: string | null | undefined, params?: ParamsV2 | null): boolean {
  const P = pickParams(params);
  return P.recommend.efes_relations.includes(pyOr<string | null | undefined>(relation, 'none') as string);
}

/**
 * Запись drinks.json / архетип style_priors_v2 (с id) / запись прототипа → профиль движка (= Python drink_vector).
 * Оси — из sensory (или vector, или верхнего уровня), carb/aroma/temp → полные имена; ABV = abv_after_dilution,
 * иначе abv; alcohol всегда = clamp(ABV/40); serve_temp — из sensory, иначе середина serving, иначе дефолт;
 * vector_override применяется последним.
 */
export function drinkVector(drink: DrinkInput, params?: ParamsV2 | null): DrinkProfile {
  if (isDrinkProfile(drink)) return drink;
  const P = pickParams(params);
  const rec = drink;
  const src = pyOr<unknown>(rec.sensory, rec.vector, rec);
  const sens = new Map<string, unknown>();
  if (isDict(src)) for (const k of Object.keys(src)) sens.set(SHORT_AXES.get(k) ?? k, src[k]);
  const scale = P.derived.alcohol_abv_scale;
  let abvRaw: unknown = rec.abv_after_dilution;
  if (abvRaw === null || abvRaw === undefined) abvRaw = rec.abv;
  if (abvRaw === null || abvRaw === undefined) abvRaw = pyFloat(pyOr(sens.get('alcohol'), 0)) * scale;
  const abv = pyFloat(abvRaw);
  const v = {} as DrinkVec;
  const vr = v as Record<string, number>;
  for (const a of P.axes.drink) {
    if (a === 'alcohol') setOwn(vr, a, clamp(abv / scale));
    else if (a === 'serve_temp') {
      let t: unknown = sens.get('serve_temp');
      if (t === null || t === undefined) {
        const serving = pyOr<unknown>(rec.serving, {}) as Record<string, unknown>;
        const lo = dget(serving, 'temp_min_c');
        const hi = dget(serving, 'temp_max_c');
        if (lo !== null && lo !== undefined && hi !== null && hi !== undefined) t = (pyFloat(lo) + pyFloat(hi)) / 2;
        else t = P.axes.drink_default_serve_temp;
      }
      setOwn(vr, a, pyFloat(t));
    } else setOwn(vr, a, clamp(pyFloat(pyOr(sens.get(a), 0))));
  }
  const override = pyOr<unknown>(rec.vector_override, {}) as Record<string, unknown>;
  for (const a of P.axes.drink) {
    const ov = dget(override, a);
    if (ov !== null && ov !== undefined) setOwn(vr, a, pyFloat(ov));
  }
  const style = pyOr<unknown>(rec.style, {}) as Record<string, unknown>;
  const category = pyOr<unknown>(rec.category, rec.cat, 'beer') as string;
  const archetype = pyOr<unknown>(dget(style, 'archetype'), rec.archetype, rec.id) as string | null;
  const family = pyOr<unknown>(dget(style, 'family'), rec.family, pyStr(category).toUpperCase()) as string;
  const flags = pyOr<unknown>(rec.flags, {}) as Record<string, unknown>;
  const ibu = rec.ibu === undefined ? null : rec.ibu;
  const name = pyOr<unknown>(rec.display_name, rec.name, rec.label_ru, rec.id) as string;
  const L = P.labels;
  const catGen = dgetOr(L.category_gen, category, L.category_gen_default);
  const ibuS = ibu !== null ? fmtNum(ibu) : null;
  let bitterPhrase: string;
  if (L.hop_categories.includes(category)) {
    bitterPhrase = ibuS !== null ? tpl(L.bitter_ibu, { ibu: ibuS }) : L.bitter_hop;
  } else {
    bitterPhrase = tpl(L.bitter_other, { cat_gen: catGen });
  }
  const words: Record<string, string> = {
    drink: name,
    cat_gen: catGen,
    bitter: bitterPhrase,
    bitter_cap: capFirst(bitterPhrase),
    ibu: ibuS !== null ? ibuS : '',
    ibu_paren: ibuS !== null ? tpl(L.ibu_paren, { ibu: ibuS }) : '',
    abv: fmtNum(abv),
    temp: fmtNum(v.serve_temp),
  };
  return {
    _v2: 'drink',
    id: pyStr(rec.id),
    name,
    category,
    family,
    archetype,
    abv,
    ibu,
    v,
    tags: asTags(rec.aroma_tags !== null && rec.aroma_tags !== undefined ? rec.aroma_tags : rec.tags),
    origin: asList(rec.origin_affinity !== null && rec.origin_affinity !== undefined ? rec.origin_affinity : rec.origin),
    efes_relation: pyOr<unknown>(rec.efes_relation, 'none') as string,
    non_alcoholic_flag: truthy(dget(flags, 'non_alcoholic')),
    words,
  };
}

/** Запись dishes_v2.json (или прототипа) → профиль блюда. Недостающие оси = 0 (weight = 0.5) (= Python dish_vector). */
export function dishVector(dish: DishInput, params?: ParamsV2 | null): DishProfile {
  if (isDishProfile(dish)) return dish;
  const P = pickParams(params);
  const rec = dish;
  const src = (isDict(rec.vector) ? rec.vector : rec) as Readonly<Record<string, unknown>>;
  const defaults = P.axes.dish_defaults;
  const v = {} as DishVec;
  const vr = v as Record<string, number>;
  for (const a of P.axes.dish) {
    const val = dget(src, a);
    setOwn(vr, a, val !== null && val !== undefined ? clamp(pyFloat(val)) : pyFloat(dgetOr(defaults, a, 0)));
  }
  const tags = asTags(rec.tags);
  const isDessert = truthy(hasOwn(rec, 'is_dessert') ? rec.is_dessert : hasOwn(rec, 'dessert') ? rec.dessert : false);
  const acidType = pyOr<unknown>(rec.acid_type, truthy(rec.vinegar) ? 'vinegar' : 'none') as string;
  const cook = pyOr<unknown>(rec.cook_method, '') as string;
  const sauce = pyOr<unknown>(rec.sauce, 'none') as string;
  const proteinSource = pyOr<unknown>(rec.protein_source, 'none') as string;
  const name = pyOr<unknown>(rec.display_name, rec.name, rec.id) as string;
  const L = P.labels;
  const tmin = L.tag_min;

  // белок: явное поле → иначе по тегам
  let pkey: string | null = hasOwn(L.protein_gen, proteinSource) ? proteinSource : null;
  if (pkey === null) {
    for (const [tag, key] of L.protein_tag_order) {
      if (tagW(tags, tag) >= L.protein_tag_min) {
        pkey = key;
        break;
      }
    }
  }
  if (pkey === 'white_fish' && v.fish_oil >= L.oily_fish_min) pkey = 'oily_fish';
  const proteinSrc = truthy(pkey) ? L.protein_gen[pkey as string] : L.fat_default;
  // жир
  let fatSrc: string;
  if (hasOwn(L.fat_sauce, sauce) && v.cream >= L.fat_sauce_cream_min) fatSrc = L.fat_sauce[sauce];
  else if (truthy(pkey)) fatSrc = L.protein_gen[pkey as string];
  else fatSrc = pyOr<string | null>(pickLabel(tags, L.fat_tags, tmin), L.fat_default) as string;
  // соль
  const saltLabels = new Map<string, string>();
  for (const [tag, label] of L.salt_order) saltLabels.set(tag, label);
  let saltSrc: string | null | undefined = null;
  if (cook === 'cured') saltSrc = saltLabels.get('cured');
  if (saltSrc === null || saltSrc === undefined) saltSrc = pickLabel(tags, L.salt_order, tmin);
  if ((saltSrc === null || saltSrc === undefined) && hasOwn(L.salt_sauce, sauce)) saltSrc = L.salt_sauce[sauce];
  if ((saltSrc === null || saltSrc === undefined) && pyStr(proteinSource).startsWith('cheese')) saltSrc = saltLabels.get('cheese');
  const saltStr = pyOr<string | null | undefined>(saltSrc, L.salt_default) as string;
  // кислота
  const acidSrc = pyOr<string | null | undefined>(dget(L.acid_type, acidType), pickLabel(tags, L.acid_tags, tmin),
    L.acid_default) as string;
  // острота
  const chiliGen = pyOr<string | null>(pickLabel(tags, L.chili_tags, tmin),
    sauce === 'chili' ? L.chili_sauce : L.chili_default) as string;
  // корочка / дым / умами
  const crust = pyOr<string | null | undefined>(dget(L.crust_cook, cook), pickLabel(tags, L.crust_tags, tmin),
    L.crust_default) as string;
  const smokeDat = pyOr<string | null | undefined>(dget(L.smoke_cook, cook), pickLabel(tags, L.smoke_tags, tmin),
    L.smoke_default) as string;
  const umamiSrc = pyOr<string | null | undefined>(dget(L.umami_sauce, sauce), pickLabel(tags, L.umami_tags, tmin),
    truthy(pkey) ? L.protein_gen[pkey as string] : null, L.umami_default) as string;
  const words: Record<string, string> = {
    dish: name, fat_src: fatSrc, protein_src: proteinSrc, salt_src: saltStr,
    salt_src_cap: capFirst(saltStr), acid_src: acidSrc, chili_gen: chiliGen,
    crust, crust_cap: capFirst(crust), smoke_dat: smokeDat, umami_src: umamiSrc,
  };
  return {
    _v2: 'dish',
    id: pyStr(rec.id),
    name,
    v,
    tags,
    cuisine: asList(rec.cuisine),
    is_dessert: isDessert,
    vinegar: acidType === 'vinegar',
    acid_type: acidType,
    cook_method: truthy(cook) ? cook : null,
    protein_source: proteinSource,
    sauce,
    words,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// производные величины (§2.2, §3.1)
// ─────────────────────────────────────────────────────────────────────────────
/** Кусочно-линейное «жжение» спирта (§2.2): 0 до x0, далее отрезки до (x1,y1), (x2,y2), (x3,1). */
export function burn(abv: number, params?: ParamsV2 | null): number {
  const B = pickParams(params).derived.burn;
  const x0 = B.x0, x1 = B.x1, y1 = B.y1, x2 = B.x2, y2 = B.y2, x3 = B.x3;
  if (abv < x0) return 0.0;
  if (abv <= x1) return y1 * (abv - x0) / (x1 - x0);
  if (abv <= x2) return y1 + (y2 - y1) * (abv - x1) / (x2 - x1);
  if (abv <= x3) return y2 + (1.0 - y2) * (abv - x2) / (x3 - x2);
  return 1.0;
}

export function cold(t: number, params?: ParamsV2 | null): number {
  const C = pickParams(params).derived.cold;
  return clamp((C.t_ref - t) / C.span);
}

function wB(v: DrinkVec, abv: number, P: ParamsV2): number {
  const p = P.derived.W_B;
  return clamp(p.body * v.body + p.abv * clamp(abv / p.abv_scale) + p.sweet * v.sweet);
}

function fB(v: DrinkVec, abv: number, P: ParamsV2): number {
  const p = P.derived.F_B;
  return clamp(p.aroma_intensity * v.aroma_intensity + p.bitter * v.bitter + p.roast * v.roast
    + p.smoke * v.smoke + p.tannin * v.tannin + p.acid * v.acid
    + p.burn * burn(abv, P));
}

function wD(d: DishProfile, P: ParamsV2): number {
  const p = P.derived.W_D;
  const x = d.v;
  let w = clamp(p.weight * x.weight + p.fat * x.fat + p.cream * x.cream + p.protein * x.protein);
  if (d.is_dessert) {
    w = pyMax(w, clamp(p.dessert_sweet * x.sweet + p.dessert_fat * x.fat + p.dessert_cream * x.cream));
  }
  return w;
}

function fD(d: DishProfile, P: ParamsV2): number {
  const p = P.derived.F_D;
  const x = d.v;
  let f = clamp(p.heat * x.heat + p.smoke * x.smoke + p.salt * x.salt + p.umami * x.umami
    + p.maillard * x.maillard + p.sour * x.sour + p.sweet * x.sweet
    + p.pungent * x.pungent + p.bitter * x.bitter);
  if (d.is_dessert) {
    let choc = 0.0;
    for (const t of p.dessert_choc_tags) choc = pyMax(choc, tagW(d.tags, t));
    f = pyMax(f, clamp(p.dessert_sweet * x.sweet + p.dessert_bitter * x.bitter + p.dessert_choc * choc));
  }
  return f;
}

function applyR18(v: DrinkVec, P: ParamsV2): DrinkVec {
  const p = P.R18;
  const warmth = clamp((v.serve_temp - p.t_ref) / p.t_span);
  const out: DrinkVec = { ...v };
  out.sweet = clamp(v.sweet * (1 + p.k_sweet * warmth));
  out.bitter = clamp(v.bitter * (1 + p.k_bitter * warmth));
  return out;
}

function intensity(b: DrinkProfile, d: DishProfile, v: DrinkVec, P: ParamsV2): Intensity {
  const p = P.R1;
  const wb = wB(v, b.abv, P), fb = fB(v, b.abv, P);
  const wd = wD(d, P), fd = fD(d, P);
  const boost = wb < wd
    ? p.light_boost * pyMax(v.acid, p.light_boost_carb * v.carbonation, v.salt, v.tannin)
    : 0.0;
  const wbEff = wb + boost;
  const dW = wbEff - wd;
  const dF = fb - fd;
  const x = d.v;
  const strong = x.protein >= p.strong_protein && x.salt >= p.strong_salt && x.fat >= p.strong_fat;
  const off = strong ? p.fit_offset_strong : p.fit_offset;
  const fit = 1 - clamp((dF - off) / p.fit_span);
  return { W_B: wb, F_B: fb, W_D: wd, F_D: fd, boost, W_B_eff: wbEff, dW, dF, strong_dish: strong, fit };
}

/** W/F напитка и/или блюда (без округления). Если переданы оба — ещё W_B_eff, dW, dF, fit, strong_dish. */
export function derived(drink?: DrinkInput | null, dish?: DishInput | null, params?: ParamsV2 | null): Derived {
  const P = pickParams(params);
  const out: Derived = {};
  const b = drink !== null && drink !== undefined ? drinkVector(drink, P) : null;
  const d = dish !== null && dish !== undefined ? dishVector(dish, P) : null;
  if (b !== null) {
    const v = P.R18.enabled ? applyR18(b.v, P) : b.v;
    out.W_B = wB(v, b.abv, P);
    out.F_B = fB(v, b.abv, P);
    out.burn = burn(b.abv, P);
  }
  if (d !== null) {
    out.W_D = wD(d, P);
    out.F_D = fD(d, P);
  }
  if (b !== null && d !== null) {
    const v = P.R18.enabled ? applyR18(b.v, P) : b.v;
    Object.assign(out, intensity(b, d, v, P));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// классические пары (R20)
// ─────────────────────────────────────────────────────────────────────────────
/** [{dish, drink (архетип или id напитка), bonus, label, source}] → {"dish|drink": запись}. */
export function indexClassics(classics: Iterable<ClassicPair> | null | undefined): ClassicIndex {
  const out: ClassicIndex = {};
  for (const c of classics || []) setOwn(out, `${pyStr(c.dish)}|${pyStr(c.drink)}`, c);
  return out;
}

function classicLookup(cidx: ClassicsArg, d: DishProfile, b: DrinkProfile): ClassicPair | null {
  if (!truthy(cidx)) return null;
  const idx: ClassicIndex = Array.isArray(cidx) ? indexClassics(cidx as readonly ClassicPair[]) : (cidx as ClassicIndex);
  const first = dget(idx, `${d.id}|${b.id}`);
  if (truthy(first)) return first as ClassicPair;
  const second = dget(idx, `${d.id}|${pyStr(b.archetype)}`);
  return second === undefined ? null : second;
}

// ─────────────────────────────────────────────────────────────────────────────
// контекст
// ─────────────────────────────────────────────────────────────────────────────
/** ctx.harsh_tol: число или профиль sensitive / median / tolerant (§6.3). */
export function harshTol(ctx: Ctx, params?: ParamsV2 | null): number {
  const P = pickParams(params);
  const h: unknown = ctx.harsh_tol;
  if (h === null || h === undefined) return 1.0;
  if (typeof h === 'string') return pyFloat(dgetOr(P.R17.harsh_tol, h, 1.0));
  return pyFloat(h);
}

/** null — фильтра нет; иначе максимальный ABV (V7). Включается ctx.non_alcoholic или occasion = non_alcoholic. */
export function nonAlcoholicLimit(ctx: Ctx, params?: ParamsV2 | null): number | null {
  const P = pickParams(params);
  if (truthy(ctx.non_alcoholic) || ctx.occasion === 'non_alcoholic') {
    const lim = ctx.non_alcoholic_max_abv;
    return lim !== null && lim !== undefined ? pyFloat(lim) : pyFloat(P.vetoes.V7.max_abv);
  }
  return null;
}

export function cosine(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>, axes: readonly string[]): number {
  let dot = 0.0, na = 0.0, nb = 0.0;
  for (const k of axes) {
    const x = pyFloat(pyOr<unknown>(dgetOr(a, k, 0.0), 0.0));
    const y = pyFloat(pyOr<unknown>(dgetOr(b, k, 0.0), 0.0));
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0.0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Flavor DNA v2: [{drink: запись|профиль, rating: love|like|meh|dislike}] (или {vector, rating}) →
 * средневзвешенный вектор по осям params.R17.dna.axes, clamp 0..1, r2. null — если оценок нет.
 */
export function dnaVector(rated: Iterable<RatedDrink>, params?: ParamsV2 | null): Record<string, number> | null {
  const P = pickParams(params);
  const axes = P.R17.dna.axes;
  const weights = P.R17.dna.rating_weights;
  const acc = new Map<string, number>();
  for (const a of axes) acc.set(a, 0.0);
  let wsum = 0.0;
  for (const r of rated) {
    const w = pyFloat(dgetOr(weights, r.rating, 0));
    if (w === 0.0) continue;
    const vec = (r.drink !== null && r.drink !== undefined
      ? drinkVector(r.drink, P).v
      : pyOr<unknown>(r.vector, {})) as Readonly<Record<string, unknown>>;
    for (const a of axes) acc.set(a, (acc.get(a) as number) + w * pyFloat(pyOr<unknown>(dgetOr(vec, a, 0.0), 0.0)));
    wsum += Math.abs(w);
  }
  if (wsum === 0.0) return null;
  const out: Record<string, number> = {};
  for (const a of axes) setOwn(out, a, r2(clamp((acc.get(a) as number) / wsum)));
  return out;
}

export function bandFor(score: number, capped: boolean, params?: ParamsV2 | null): Band {
  const B = pickParams(params).bands;
  if (capped && score <= B.avoid_max) return { ...B.avoid };
  for (const band of B.list) {
    if (score >= band.min) return { id: band.id, label: band.label };
  }
  const last = B.list[B.list.length - 1];
  return { id: last.id, label: last.label };
}

function vetoParam(V: ParamsV2['vetoes'], vid: string): { cap?: number | null; evidence: string; text: string } {
  return (V as unknown as Record<string, { cap?: number | null; evidence: string; text: string }>)[vid];
}

// ─────────────────────────────────────────────────────────────────────────────
// scorePair
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Балл пары напиток × блюдо по §4–§5 (= Python score_pair).
 *
 * ctx: occasion, harsh_tol, bitter_pref, sweet_pref, heat_lover, dna, non_alcoholic, non_alcoholic_max_abv,
 * temperature_perception. classics: список classic_pairs.json или indexClassics(); null — без R20.
 * explain=false — без текстов (быстрее); баллы идентичны.
 */
export function scorePair(drink: DrinkInput, dish: DishInput, ctx?: Ctx | null, params?: ParamsV2 | null,
  classics?: ClassicsArg, explain = true): PairResult {
  const P = pickParams(params);
  const cx: Ctx = ctx && truthy(ctx) ? ctx : {};
  const b = drinkVector(drink, P);
  const d = dishVector(dish, P);
  let bv = b.v;
  if (P.R18.enabled || truthy(cx.temperature_perception)) bv = applyR18(bv, P);
  const x = d.v;
  const abv = b.abv;
  const alc = bv.alcohol;
  const tol = harshTol(cx, P);
  const heatLover = truthy(cx.heat_lover) ? 1.0 : 0.0;
  const dessert = d.is_dessert;
  const W: Record<string, unknown> = {};
  if (explain) {
    Object.assign(W, b.words);
    Object.assign(W, d.words);
  }

  const comps: Mechanism[] = [];
  const vetoes: string[] = [];

  const add = (rule: string, pts: number, family: RuleFamily, key: string, evidence: string, text: string): void => {
    comps.push({ rule, family, points: r2(pts), key, evidence, text: explain ? text : '' });
  };

  // ── R1 intensity_match + V1/V6 + fit ─────────────────────────────────────
  const p1 = P.R1;
  const it = intensity(b, d, bv, P);
  const wb = it.W_B, fb = it.F_B, wd = it.W_D, fd = it.F_D, dW = it.dW, dF = it.dF, fit = it.fit;
  const strong = it.strong_dish;
  const kLoud = strong ? p1.k_loud_strong : p1.k_loud;
  const pts1 = p1.base - (dF > 0 ? kLoud * dF : p1.k_quiet * (-dF)) - (p1.k_weight * Math.abs(dW));
  let text1 = '';
  if (explain) {
    Object.assign(W, { fb: fmt2(fb), fd: fmt2(fd), wb: fmt2(wb), wd: fmt2(wd) });
    const T = p1.texts;
    // «громче/тише» с плюсом в баллах — мягкая формулировка (как в Python)
    const ok = pts1 >= p1.text_ok_min;
    const loud = dF > p1.text_dF ? (ok ? T.loud_ok : T.loud) : dF < -p1.text_dF ? (ok ? T.quiet_ok : T.quiet) : T.match;
    let weight: string;
    if (it.boost >= p1.text_boost_min && dW >= -p1.text_dW) {
      const [helperKey] = argmax([['acid', bv.acid], ['carbonation', p1.light_boost_carb * bv.carbonation],
        ['salt', bv.salt], ['tannin', bv.tannin]]);
      weight = tpl(T.w_boost, { ...W, helper: T.helpers[helperKey] });
    } else if (dW < -p1.text_dW) {
      weight = tpl(T.w_light, W);
    } else if (dW > p1.text_dW) {
      weight = tpl(T.w_heavy, W);
    } else {
      weight = tpl(T.w_match, W);
    }
    text1 = tpl(T.join, { loudness: tpl(loud, W), weight });
  }
  add('R1', clamp(pts1, p1.min, p1.max), 'balance', 'intensity', p1.evidence, text1);
  const V = P.vetoes;
  if ((dF >= V.V1.dF || (dF >= V.V1.dF_combo && dW >= V.V1.dW_combo)) && !dessert && !strong) vetoes.push('V1');
  if (dF <= V.V6.dF || (dF <= V.V6.dF_combo && dW <= V.V6.dW_combo)) vetoes.push('V6');

  const addfit = (rule: string, pts: number, family: RuleFamily, key: string, evidence: string, text: string): void => {
    add(rule, pts > 0 ? pts * fit : pts, family, key, evidence, text);
  };

  // ── R2 cut_richness ─────────────────────────────────────────────────────
  {
    const p = P.R2;
    const rich = pyMax(x.fat, p.richness_cream * x.cream, p.richness_weight * x.weight);
    if (rich >= p.min_richness) {
      const tTan = p.tannin * bv.tannin;
      const tBit = p.bitter * bv.bitter * (1 - p.bitter_heat_discount * x.heat);
      const tCarb = p.carbonation * bv.carbonation * (1 - p.carbonation_cream_discount * x.cream);
      const tAcid = p.acid * bv.acid;
      const tRoast = p.roast * bv.roast;
      const tAlc = p.alcohol * alc;
      const cp = tTan + tBit + tCarb + tAcid + tRoast + tAlc;
      const [key] = argmax([['tannin', tTan], ['bitter', tBit], ['carbonation', tCarb], ['acid', tAcid],
        ['roast', tRoast], ['alcohol', tAlc]]);
      let text = '';
      if (explain) {
        const T = p.texts;
        const coat = x.cream >= p.coat_cream_min ? T['coat_cream'] : tpl(T['coat_fat'], W);
        text = tpl(T[key], { ...W, coat });
      }
      addfit('R2', clamp(p.scale * rich * cp, p.min, p.max), 'cut', key,
        key === 'tannin' ? p.evidence_tannin : p.evidence, text);
    }
  }

  // ── R3 chili_heat + V3 ──────────────────────────────────────────────────
  {
    const p = P.R3;
    if (x.heat >= p.min_heat) {
      const saltSoft = 1 - p.salt_soft * x.salt;
      const relSweet = p.relief_sweet * clamp(bv.sweet / p.relief_sweet_sat);
      const relDairy = p.relief_dairy * bv.dairy;
      const relCold = p.relief_cold * cold(bv.serve_temp, P);
      const relBody = p.relief_body * bv.body;
      const relief = relSweet + relDairy + relCold + relBody;
      const hop = pos(bv.bitter - p.hop_threshold) / p.hop_span;
      const aBurn = p.aggr_burn * burn(abv, P);
      const aHop = p.aggr_hop_salt * hop * saltSoft;
      const aHopAbv = p.aggr_hop_abv * hop * clamp((abv - p.hop_abv_offset) / p.hop_abv_span);
      const aTan = p.aggr_tannin * bv.tannin;
      const aCarb = p.aggr_carb * pos(bv.carbonation - p.carb_threshold) / p.carb_span;
      const aggr = aBurn + aHop + aHopAbv + aTan + aCarb;
      const pts = x.heat * (p.k_relief * relief - p.k_aggr * aggr * tol * (1 - p.heat_lover_relief * heatLover));
      let key: string;
      if (pts >= 0) {
        [key] = argmax([['dairy', relDairy], ['sweet', relSweet], ['cold', relCold], ['body', relBody]]);
      } else {
        [key] = argmax([['burn', aBurn], ['hop', aHop], ['hop_abv', aHopAbv], ['tannin', aTan], ['carbonation', aCarb]]);
      }
      if (heatLover !== 0 && hop > 0) key = 'heat_lover';
      let text = '';
      if (explain) {
        const T = p.texts;
        const ibuAbv = tpl(b.ibu !== null && b.ibu !== undefined ? T['ibu_abv'] : T['noibu_abv'], W);
        text = tpl(T[key], { ...W, ibu_abv: ibuAbv });
      }
      add('R3', clamp(pts, p.min, p.max), pts >= 0 ? 'cut' : 'penalty', key, p.evidence, text);
      if (x.heat >= V.V3.heat && abv >= V.V3.abv && heatLover === 0) vetoes.push('V3');
    }
  }

  // ── R4 sweet_match + V2 ─────────────────────────────────────────────────
  {
    const p = P.R4;
    if (x.sweet >= p.min_sweet) {
      const gap = x.sweet - bv.sweet;
      let pts: number;
      if (gap <= p.tolerance) {
        pts = gap <= 0 ? p.base + p.k_match * bv.sweet * x.sweet : p.base * (1 - gap / p.tolerance);
      } else {
        pts = -p.k_gap * (gap - p.tolerance);
      }
      const basePts = pts;
      let contrast = dessert && p.contrast_categories.includes(b.category) && bv.bitter >= p.contrast_bitter
        && Math.abs(dF) < p.contrast_dF;
      // горячий чай/кофе к десерту: контраст терпкости и сладости, а не правило вина «sweets need sweets»
      const hot = dessert && !contrast && p.hot_contrast_categories.includes(b.category)
        && bv.serve_temp >= p.hot_contrast_min_temp;
      if (contrast) {
        pts = pyMax(pts, p.contrast_floor);
      } else if (hot) {
        pts = pyMax(pts, p.hot_contrast_floor);
        contrast = true;
      }
      let chocD = 0.0;
      for (const t of p.choc_tags) chocD = pyMax(chocD, tagW(d.tags, t));
      const choc = pyMin(bv.roast, chocD);
      const roastBonusChoc = p.choc * choc;
      const roastBonusSweet = p.roast_sweet * bv.roast * x.sweet;
      pts += roastBonusChoc;
      pts += roastBonusSweet;
      let fruit = 0.0;
      for (const t of p.fruit_tags) fruit += pyMin(tagW(b.tags, t), tagW(d.tags, t));
      const fruitPts = p.fruit * pyMin(fruit, p.fruit_max) * (dessert ? 1 : p.fruit_nondessert);
      pts += fruitPts;
      let key: string;
      if (hot) key = 'hot_contrast';
      else if (contrast) key = 'contrast';
      else if (roastBonusChoc + roastBonusSweet >= p.text_roast_min
        && (basePts <= 0 || roastBonusChoc + roastBonusSweet > basePts)) key = roastBonusChoc > 0 ? 'roast' : 'roast_sweet';
      else if (gap <= 0) key = 'match';
      else if (gap <= p.tolerance) key = 'near';
      else key = 'gap';
      let text = '';
      if (explain) {
        const T = p.texts;
        text = tpl(T[key], W) + (fruitPts >= p.text_fruit_min ? T['fruit'] : '');
      }
      add('R4', clamp(pts, p.min, p.max), contrast ? 'contrast' : pts >= 0 ? 'complement' : 'penalty',
        key, p.evidence, text);
      if (dessert && x.sweet >= V.V2.dish_sweet && bv.sweet <= V.V2.drink_sweet && !contrast
        && bv.roast < V.V2.roast_exempt) vetoes.push('V2');
    }
  }

  // ── R5 acid_match ───────────────────────────────────────────────────────
  {
    const p = P.R5;
    if (x.sour >= p.min_sour) {
      const effSour = x.sour + (d.vinegar ? p.vinegar_bonus : 0);
      const effAcid = pyMax(bv.acid, p.carb_as_acid * bv.carbonation);
      const gap = effSour - effAcid;
      let pts = gap > 0 ? -p.k_gap * gap * (d.vinegar ? p.vinegar_mult : 1) : p.k_match * pyMin(bv.acid, x.sour);
      let tTan = 0.0;
      let tSweet = 0.0;
      if (bv.tannin >= p.tannin_threshold) {
        tTan = p.k_tannin * bv.tannin * x.sour;
        pts -= tTan;
      }
      if (!dessert) {
        tSweet = p.k_sweet * pos(bv.sweet - p.sweet_threshold) * x.sour;
        pts -= tSweet;
      }
      let key: string;
      if (gap > 0) key = d.vinegar && bv.tannin >= p.tannin_threshold ? 'vinegar_tannin' : 'flabby';
      else key = 'clean';
      let text = '';
      if (explain) {
        const T = p.texts;
        text = tpl(T[key], W);
        if (tTan >= p.text_clause_min && key !== 'vinegar_tannin') text += T['tannin'];
        if (tSweet >= p.text_clause_min) text += T['sweet'];
      }
      add('R5', clamp(pts, p.min, p.max), pts >= 0 ? 'cut' : 'penalty', key, p.evidence, text);
    }
  }

  // ── R6 salt_modulation ──────────────────────────────────────────────────
  {
    const p = P.R6;
    if (x.salt >= p.min_salt) {
      const fBit = bv.bitter * (1 - x.heat);
      const fTan = p.forgive_tannin * bv.tannin;
      const forgive = p.k_forgive * x.salt * (fBit + fTan);
      const clean = p.k_clean * x.salt * pyMax(bv.acid, bv.carbonation);
      const shield = 1 - p.shield * pyMax(x.fat, x.protein);
      const alco = -p.k_alco * x.salt * pos(alc - p.alco_threshold) / p.alco_span * shield;
      const tann = -p.k_tann * x.salt * pos(bv.tannin - p.tann_threshold) / p.tann_span;
      const snack = (x.salt >= p.snack_salt && x.weight <= p.snack_weight
        && bv.carbonation >= p.snack_carb && bv.bitter >= p.snack_bitter) ? p.snack_points : 0;
      const forgiveC = pyMin(forgive, p.forgive_max);
      const pts = forgiveC + clean + alco + tann + snack;
      let key: string;
      if (pts >= 0) {
        [key] = argmax([['forgive', forgiveC], ['clean', clean], ['snack', snack]]);
        if (key === 'forgive') key = fBit >= fTan ? 'forgive_bitter' : 'forgive_tannin';
        else if (key === 'clean') key = bv.acid >= bv.carbonation ? 'clean_acid' : 'clean_carb';
      } else {
        [key] = argmin([['alco', alco], ['tann', tann]]);
      }
      const text = explain ? tpl(p.texts[key], W) : '';
      addfit('R6', clamp(pts, p.min, p.max), pts >= 0 ? 'complement' : 'penalty', key,
        key.startsWith('forgive') ? p.evidence_forgive : p.evidence, text);
    }
  }

  // ── R7 umami ────────────────────────────────────────────────────────────
  {
    const p = P.R7;
    if (x.umami >= p.min_umami) {
      let matchPts = 0.0;
      let pts: number;
      if (x.salt < p.salt_gate && x.sour < p.sour_gate) {
        pts = -p.k_neg * x.umami * (p.neg_tannin * bv.tannin + p.neg_bitter * bv.bitter
          + p.neg_alcohol * alc) * tol;
      } else {
        matchPts = p.k_match * pyMin(bv.umami, x.umami);
        pts = p.k_pos * x.umami * (p.pos_bitter * bv.bitter + p.pos_acid * bv.acid) + matchPts;
      }
      const key: 'pos' | 'neg' = pts >= 0 ? 'pos' : 'neg';
      let text = '';
      if (explain) {
        const T = p.texts;
        const helper = T.helpers[p.pos_bitter * bv.bitter >= p.pos_acid * bv.acid ? 'bitter' : 'acid'];
        text = tpl(T[key], { ...W, helper }) + (key === 'pos' && matchPts >= p.text_match_min ? T.match : '');
      }
      addfit('R7', clamp(pts, p.min, p.max), pts >= 0 ? 'complement' : 'penalty', key, p.evidence, text);
    }
  }

  // ── R8 tannin_protein + V4 ──────────────────────────────────────────────
  {
    const p = P.R8;
    if (bv.tannin >= p.min_tannin) {
      const pf = pyMax(x.protein, x.fat);
      const plus = p.k_plus * bv.tannin * pf * (x.protein >= p.protein_gate ? 1 : p.low_protein_mult);
      const fish = -p.k_fish * bv.tannin * x.fish_oil;
      const green = -p.k_green * bv.tannin * x.green_iron;
      const dry = bv.tannin >= p.dry_threshold ? -p.k_dry * bv.tannin * (1 - pf) : 0;
      const pts = plus + fish * tol + green * tol + dry * tol;
      const key = pts >= 0 ? 'plus' : argmin([['fish', fish], ['green', green], ['dry', dry]])[0];
      const text = explain ? tpl(p.texts[key], W) : '';
      addfit('R8', clamp(pts, p.min, p.max), pts >= 0 ? 'complement' : 'penalty', key, p.evidence, text);
      if (bv.tannin >= V.V4.tannin && x.fish_oil >= V.V4.fish_oil) vetoes.push('V4');
    }
  }

  // ── R9 delicate_fresh + V5 ──────────────────────────────────────────────
  {
    const p = P.R9;
    if (x.fresh >= p.min_fresh) {
      const tCarb = p.carbonation * bv.carbonation;
      const tClean = p.clean * (1 - bv.aroma_intensity);
      const tAcid = p.acid * bv.acid;
      const tRoast = p.roast * bv.roast;
      const tBody = p.body * pos(bv.body - p.body_threshold) / p.body_span;
      const tAlc = p.alcohol * pos(alc - p.alcohol_threshold) / p.alcohol_span;
      const tBit = p.bitter * pos(bv.bitter - p.bitter_threshold) / p.bitter_span;
      const tSmoke = p.smoke * bv.smoke;
      let pts = x.fresh * (tCarb + tClean + tAcid - tRoast - tBody - tAlc - tBit - tSmoke);
      const tFish = p.k_fish_hop * x.fish_oil * pos(bv.bitter - p.fish_hop_threshold) / p.fish_hop_span;
      pts -= tFish;
      const key = pts >= 0
        ? argmax([['carbonation', tCarb], ['clean', tClean], ['acid', tAcid]])[0]
        : argmax([['roast', tRoast], ['body', tBody], ['alcohol', tAlc], ['bitter', tBit], ['smoke', tSmoke],
          ['fish_hop', tFish]])[0];
      const text = explain ? tpl(p.texts[key], W) : '';
      add('R9', clamp(pts, p.min, p.max), pts >= 0 ? 'cut' : 'penalty', key, p.evidence, text);
      if (x.fresh >= V.V5.fresh && abv >= V.V5.abv) vetoes.push('V5');
    }
  }

  // ── R10 maillard_harmony ────────────────────────────────────────────────
  {
    const p = P.R10;
    if (x.maillard >= p.min_maillard) {
      const bt = b.tags;
      let [key, m] = argmax([
        ['caramel', tagW(bt, 'caramel')],
        ['roast', bv.roast * pyMax(x.smoke, tagW(d.tags, 'char'))],
        ['bread', p.bread * tagW(bt, 'bread')],
        ['oak_vanilla', tagW(bt, 'oak_vanilla')],
        ['toast', p.toast * tagW(bt, 'toast')],
        ['nutty', p.nutty * tagW(bt, 'nutty')],
      ]);
      if (m <= 0) key = 'none';
      let text = '';
      if (explain) {
        const T = p.texts;
        text = key === 'none' ? tpl(T.none, W) : tpl(T.main, { ...W, note: T.notes[key] });
      }
      addfit('R10', clamp(p.k * x.maillard * m, p.min, p.max), 'complement', key, p.evidence, text);
    }
  }

  // ── R11 smoke_bridge ────────────────────────────────────────────────────
  {
    const p = P.R11;
    if (x.smoke >= p.min_smoke) {
      const sSmoke = p.k_smoke * pyMin(x.smoke, bv.smoke);
      const sRoast = p.k_roast * x.smoke * bv.roast;
      const key = sSmoke + sRoast <= 0 ? 'none' : sSmoke >= sRoast ? 'smoke' : 'roast';
      const text = explain ? tpl(p.texts[key], W) : '';
      addfit('R11', clamp(sSmoke + sRoast, p.min, p.max), 'bridge', key, p.evidence, text);
    }
  }

  // ── R12 aroma_bridge (теги напитка — sorted() по кодовым точкам) ─────────
  {
    const p = P.R12;
    const excl = p.exclude_tags;
    const sharedList: KV[] = [];
    for (const t of Object.keys(b.tags).sort(pyStrCmp)) {
      if (hasOwn(d.tags, t) && !excl.includes(t)) sharedList.push([t, pyMin(b.tags[t], d.tags[t])]);
    }
    let shared = 0.0;
    for (const [, w] of sharedList) shared += w;
    if (shared > 0) {
      // sorted(key=−w) устойчив: при равных весах сохраняется алфавитный порядок
      const top = sharedList.slice().sort((a, c) => cmpNum(-a[1], -c[1])).slice(0, p.text_top);
      let text = '';
      if (explain) {
        const names = top.map(([t]) => dgetOr(P.labels.tags, t, t)).join(', ');
        text = tpl(p.texts.main, { ...W, tags: names });
      }
      addfit('R12', clamp(p.k * shared, p.min, p.max), 'bridge', top.map(([t]) => t).join(','), p.evidence, text);
    }
  }

  // ── R14 same_on_same ────────────────────────────────────────────────────
  {
    const p = P.R14;
    const penBit = -p.k_bitter * bv.bitter * x.bitter * tol;
    let pen = penBit;
    let penSweet = 0.0;
    if (p.sweet_categories.includes(b.category) && bv.sweet > p.sweet_threshold
      && x.sweet > p.sweet_threshold && !dessert) {
      penSweet = -p.sweet_penalty * tol;
      pen -= p.sweet_penalty * tol;
    }
    if (pen < p.emit_below) {
      const key = penBit <= penSweet ? 'bitter' : 'sweet';
      const text = explain ? tpl(p.texts[key], W) : '';
      add('R14', clamp(pen, p.min, p.max), 'penalty', key, p.evidence, text);
    }
  }

  // ── R13 both_principles (по уже посчитанным правилам) ──────────────────
  {
    const p = P.R13;
    const fams = new Set<string>();
    for (const c of comps) if (c.points >= p.min_pts) fams.add(c.family);
    if ((fams.has('cut') || fams.has('contrast')) && (fams.has('complement') || fams.has('bridge'))) {
      addfit('R13', p.points, 'balance', 'both', p.evidence, explain ? tpl(p.texts.main, W) : '');
    }
  }

  // ── R20 classic_pairs ───────────────────────────────────────────────────
  const classic = classicLookup(classics, d, b);
  {
    const p = P.R20;
    if (classic !== null) {
      let bonus = p.bonus;
      const cb = dget(classic as unknown as Record<string, unknown>, 'bonus');
      if (cb !== null && cb !== undefined) bonus = pyMin(bonus, pyFloat(cb));
      bonus = pyMin(bonus, p.max_bonus);
      let text = '';
      if (explain) {
        const src = pyOr<unknown>(dget(classic as unknown as Record<string, unknown>, 'source'), {});
        const title = pyOr<unknown>(isDict(src) ? dget(src, 'title') : pyStr(src),
          dget(classic as unknown as Record<string, unknown>, 'label'), p.texts.fallback_source);
        text = tpl(p.texts.main, { ...W, source: title });
      }
      add('R20', bonus, 'complement', 'classic', p.evidence, text);
    }
  }

  // ── R15 regional ────────────────────────────────────────────────────────
  {
    const p = P.R15;
    let sharedCuisine: string | null = null;
    for (const c of d.cuisine) {
      if (b.origin.includes(c)) {
        sharedCuisine = c;
        break;
      }
    }
    if (sharedCuisine !== null) {
      let text = '';
      if (explain) {
        const cz = dgetOr(P.labels.cuisine, sharedCuisine, P.labels.cuisine_default);
        text = tpl(p.texts.main, { ...W, cuisine: cz });
      }
      add('R15', p.points, 'context', sharedCuisine, p.evidence, text);
    }
  }

  // ── R16 occasion ────────────────────────────────────────────────────────
  {
    const p = P.R16;
    const occ: unknown = cx.occasion;
    let occPts: number | null = null;
    if (occ === 'meal') {
      const q = p.meal;
      occPts = q.light_bonus * (abv <= q.light_max_abv && bv.carbonation >= q.light_min_carb ? 1 : 0)
        - (abv >= q.strong_min_abv && !dessert ? q.strong_penalty : 0)
        - q.k_alcohol * pos(alc - q.alcohol_threshold) / q.alcohol_span;
    } else if (occ === 'aperitif') {
      const q = p.aperitif;
      occPts = q.k_bitter_carb * bv.bitter * bv.carbonation + q.k_acid * bv.acid
        - q.k_body * pos(bv.body - q.body_threshold);
    } else if (occ === 'dessert') {
      const q = p.dessert;
      occPts = q.sweet_bonus * (bv.sweet >= q.sweet_min ? 1 : 0)
        + q.alcohol_bonus * (alc >= q.alcohol_min ? 1 : 0);
    } else if (occ === 'hot') {
      const q = p.hot;
      occPts = q.carbonation * bv.carbonation + q.acid * bv.acid - q.alcohol * alc;
    } else if (occ === 'evening') {
      const q = p.evening;
      occPts = q.body * bv.body + q.abv * clamp(abv / q.abv_scale);
    } else if (occ === 'party') {
      const q = p.party;
      occPts = q.clean * (1 - bv.aroma_intensity) + q.carbonation * bv.carbonation - q.alcohol * alc;
    } else if (occ === 'gourmet') {
      const q = p.gourmet;
      occPts = q.aroma_intensity * bv.aroma_intensity + q.tannin * bv.tannin + q.body * bv.body;
    }
    if (occPts !== null) {
      const key = `${occ as string}_${occPts >= 0 ? 'pos' : 'neg'}`;
      add('R16', clamp(occPts, p.min, p.max), 'context', key, p.evidence, explain ? tpl(p.texts[key], W) : '');
    }
  }

  // ── R17 personal ────────────────────────────────────────────────────────
  {
    const p = P.R17;
    const pref = pyFloat(pyOr<unknown>(cx.bitter_pref, 0.0));
    if (pref !== 0.0) {
      const q = p.bitter_pref;
      const bp = clamp(q.k * pref * (bv.bitter - q.center), -q.max, q.max);
      const key = `bitter_${pref > 0 ? 'like' : 'avoid'}_${bp >= 0 ? 'pos' : 'neg'}`;
      add('R17_bitter', bp, 'context', key, p.evidence, explain ? tpl(p.texts[key], W) : '');
    }
    const spref = pyFloat(pyOr<unknown>(cx.sweet_pref, 0.0));
    if (spref !== 0.0) {
      const q = p.sweet_pref;
      const sp = clamp(q.k * spref * (bv.sweet - q.center), -q.max, q.max);
      const key = `sweet_${spref > 0 ? 'like' : 'avoid'}_${sp >= 0 ? 'pos' : 'neg'}`;
      add('R17_sweet', sp, 'context', key, p.evidence, explain ? tpl(p.texts[key], W) : '');
    }
    const dna = cx.dna;
    if (truthy(dna)) {
      const q = p.dna;
      const cs = cosine(bv, dna as Readonly<Record<string, unknown>>, q.axes);
      const dp = clamp(q.k * (cs - q.center), -q.max, q.max);
      const key = dp >= 0 ? 'dna_pos' : 'dna_neg';
      add('R17_dna', dp, 'context', key, p.evidence, explain ? tpl(p.texts[key], W) : '');
    }
  }

  // ── итог ────────────────────────────────────────────────────────────────
  const S = P.score;
  let core = 0.0;
  for (const c of comps) if (c.family !== 'context') core += c.points;
  let ctxp = 0.0;
  for (const c of comps) if (c.family === 'context') ctxp += c.points;
  const raw = S.base + S.k * core + ctxp;
  let score = roundHalfUp(raw);
  let capped = false;
  for (const vid of CAP_VETOES) {
    if (vetoes.includes(vid)) {
      score = pyMin(score, vetoParam(V, vid).cap as number);
      capped = true;
    }
  }
  score = Math.trunc(clamp(score, S.min, S.max));

  const naLimit = nonAlcoholicLimit(cx, P);
  const excluded = naLimit !== null && abv > naLimit;
  if (excluded) vetoes.push('V7');
  const vetoesOut = V.order.filter((vid) => vetoes.includes(vid));

  // ── механизмы, причины, предупреждения, тип пары ────────────────────────
  const M = P.mechanisms;
  const mechanisms = comps.filter((c) => Math.abs(c.points) >= M.min_abs);
  const order = new Map<Mechanism, number>();
  comps.forEach((c, i) => order.set(c, i));
  const idx = (c: Mechanism): number => order.get(c) as number;
  const reasons = mechanisms.filter((c) => c.points > 0)
    .sort((a, c) => cmpNum(-a.points, -c.points) || idx(a) - idx(c))
    .slice(0, M.reasons_top);
  const negatives = mechanisms.filter((c) => c.points < 0)
    .sort((a, c) => cmpNum(a.points, c.points) || idx(a) - idx(c));
  const vetoItems: VetoItem[] = [];
  for (const vid of vetoesOut) {
    const vp = vetoParam(V, vid);
    let vtext = '';
    if (explain) vtext = tpl(vp.text, { ...W, max_abv: naLimit !== null ? fmtNum(naLimit) : '' });
    const cap = dget(vp as unknown as Record<string, unknown>, 'cap');
    vetoItems.push({ rule: vid, family: 'veto', points: 0.0, key: vid, evidence: vp.evidence,
      cap: cap === undefined ? null : (cap as number | null), text: vtext });
  }
  const warnings: WarningItem[] = [...vetoItems, ...negatives];

  const cands = comps.filter((c) => M.families.includes(c.family) && !M.exclude_rules.includes(c.rule) && c.points > 0);
  let best: Mechanism | null = null;
  for (const c of cands) if (best === null || c.points > best.points) best = c;
  let worst: Mechanism | null = null;
  for (const c of comps) {
    if (c.family !== 'context' && c.rule !== 'R13' && c.rule !== 'R20' && c.points < 0) {
      if (worst === null || c.points < worst.points) worst = c;
    }
  }
  let matchType: string;
  let secondary: string | null;
  if (capped || (score < M.penalty_below && worst !== null && (best === null || -worst.points > best.points))) {
    matchType = 'penalty';
    secondary = best !== null && best.points >= M.secondary_min ? best.family : null;
  } else if (best !== null) {
    matchType = best.family;
    secondary = null;
    let secBest: Mechanism | null = null;
    for (const c of cands) {
      if (c.family !== matchType && c.points >= M.secondary_min) {
        if (secBest === null || c.points > secBest.points) secBest = c;
      }
    }
    if (secBest !== null) secondary = secBest.family;
  } else {
    matchType = M.fallback_type;
    secondary = null;
  }

  const band = bandFor(score, capped, P);
  return {
    engine: 'v2',
    version: (hasOwn(P, 'version') ? P.version : ENGINE_VERSION) as string,
    drink_id: b.id,
    dish_id: d.id,
    drink_name: b.name,
    dish_name: d.name,
    category: b.category,
    family: b.family,
    archetype: b.archetype,
    efes_relation: b.efes_relation,
    efes_partner: isEfesRelation(b.efes_relation, P),
    abv: b.abv,
    score,
    band: band.id,
    band_label: band.label,
    match_type: matchType,
    secondary_type: secondary,
    mechanisms,
    reasons,
    warnings,
    vetoes: vetoesOut,
    capped,
    excluded,
    classic: classic !== null,
    W_B: r2(wb), F_B: r2(fb), W_D: r2(wd), F_D: r2(fd),
    W_B_eff: r2(it.W_B_eff), dW: r2(dW), dF: r2(dF), fit: r2(fit),
    core: r2(core), ctx_points: r2(ctxp), raw: r2(raw),
    components: comps,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// выдача: политика Efes, диверсификация, вкладки категорий, обратный подбор
// ─────────────────────────────────────────────────────────────────────────────
/** Ключ сортировки (−score, id): строки — по кодовым точкам, как в Python. */
function byScoreThen(field: 'drink_id' | 'dish_id') {
  return (a: PairResult, c: PairResult): number =>
    (a.score > c.score ? -1 : a.score < c.score ? 1 : pyStrCmp(a[field], c[field]));
}

/**
 * Политика Efes (V2_CONTRACT.md): баллы не меняются; напиток Efes (efes_partner) ставится выше не-Efes,
 * только если уступает ему не более чем на window баллов. Жадно: остаток отсортирован по (−score, drink_id);
 * на каждом шаге среди элементов с баллом ≥ top − window берётся первый Efes, иначе — первый элемент.
 */
export function partnerOrder(results: readonly PairResult[], params?: ParamsV2 | null, window?: number | null): PairResult[] {
  const P = pickParams(params);
  const w = window === null || window === undefined ? P.recommend.partner_tie_window : window;
  const rem = results.slice().sort(byScoreThen('drink_id'));
  const out: PairResult[] = [];
  while (rem.length) {
    const top = rem[0].score;
    let pick = 0;
    for (let i = 0; i < rem.length; i++) {
      const r = rem[i];
      if (r.score < top - w) break;
      if (r.efes_partner) {
        pick = i;
        break;
      }
    }
    out.push(rem.splice(pick, 1)[0]);
  }
  return out;
}

/** Лучший напиток Efes с честным баллом (ключ −score, drink_id). */
export function bestPartner(results: readonly PairResult[]): PairResult | null {
  for (const r of results.slice().sort(byScoreThen('drink_id'))) if (r.efes_partner) return r;
  return null;
}

function isNaOption(r: PairResult, maxAbv: number, naFlags: ReadonlyMap<string, boolean>): boolean {
  return truthy(naFlags.get(r.drink_id)) || r.abv <= maxAbv;
}

function diversify(ranked: readonly PairResult[], topN: number, P: ParamsV2, guarantee: boolean,
  naFlags: ReadonlyMap<string, boolean>): PairResult[] {
  const D = P.recommend.diversify;
  const cap = D.max_per_group;
  const minScore = D.min_score_guarantee;
  const beerCats = D.beer_categories;
  const group = (r: PairResult): string =>
    pyStr(pyOr<unknown>(dget(r as unknown as Record<string, unknown>, D.group_by), r.archetype, r.category));
  const isNa = (r: PairResult): boolean => isNaOption(r, D.na_max_abv, naFlags);
  const isNonbeer = (r: PairResult): boolean => !beerCats.includes(r.category);

  // Шаг 1: жадно по ranked, не больше cap на группу.
  const picked: PairResult[] = [];
  const inPicked = new Set<string>();
  const counts = new Map<string, number>();
  for (const r of ranked) {
    const g = group(r);
    if (picked.length < topN && (counts.get(g) ?? 0) < cap) {
      picked.push(r);
      inPicked.add(r.drink_id);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }

  // Шаг 2: гарантия (pred) — лучший подходящий из остатка с баллом ≥ minScore; при полном списке вытесняем самый
  // нижний выбранный (из той же группы, если группа кандидата заполнена), не трогая единственного носителя protect.
  const force = (pred: (r: PairResult) => boolean, protect: ReadonlyArray<(r: PairResult) => boolean>): void => {
    for (const r of picked) if (pred(r)) return;
    let cand: PairResult | null = null;
    for (const r of ranked) {
      if (!inPicked.has(r.drink_id) && pred(r) && r.score >= minScore) {
        cand = r;
        break;
      }
    }
    if (cand === null) return;
    if (picked.length < topN) {
      picked.push(cand);
      inPicked.add(cand.drink_id);
      return;
    }
    const g = group(cand);
    const full = picked.filter((r) => group(r) === g).length >= cap;
    const isProtected = (v: PairResult): boolean => {
      for (const pp of protect) if (pp(v) && picked.filter((y) => pp(y)).length === 1) return true;
      return false;
    };
    let victimI = -1;
    for (let i = picked.length - 1; i >= 0; i--) {
      const v = picked[i];
      if (full && group(v) !== g) continue;
      if (isProtected(v)) continue;
      victimI = i;
      break;
    }
    if (victimI < 0 && full) {
      for (let i = picked.length - 1; i >= 0; i--) {
        if (!isProtected(picked[i])) {
          victimI = i;
          break;
        }
      }
    }
    if (victimI < 0) return;
    const victim = picked.splice(victimI, 1)[0];
    inPicked.delete(victim.drink_id);
    picked.push(cand);
    inPicked.add(cand.drink_id);
  };

  // «самый нижний выбранный» = последний по позиции в ranked → держим picked в порядке ranked перед force
  const index = new Map<string, number>();
  ranked.forEach((r, i) => index.set(r.drink_id, i));
  const byIndex = (a: PairResult, c: PairResult): number => (index.get(a.drink_id) as number) - (index.get(c.drink_id) as number);
  if (guarantee) {
    picked.sort(byIndex);
    force(isNa, []);
    picked.sort(byIndex);
    force(isNonbeer, [isNa]);
  }
  // Шаг 3: если групповой лимит оставил пустые места — добираем по порядку ranked без лимита.
  for (const r of ranked) {
    if (picked.length >= topN) break;
    if (!inPicked.has(r.drink_id)) {
      picked.push(r);
      inPicked.add(r.drink_id);
    }
  }
  picked.sort(byIndex);
  return picked;
}

function scoredPool(d: DishProfile, drinks: Iterable<DrinkInput>, ctx: Ctx, P: ParamsV2, classics: ClassicsArg,
  categories: readonly string[] | null | undefined, venueDrinkIds: readonly string[] | null | undefined,
  explain: boolean): { pool: PairResult[]; excluded: string[]; naFlags: Map<string, boolean> } {
  const cidx: ClassicsArg = Array.isArray(classics) ? indexClassics(classics as readonly ClassicPair[]) : classics;
  const catSet = truthy(categories) ? new Set(categories) : null;
  const venueSet = venueDrinkIds !== null && venueDrinkIds !== undefined ? new Set(venueDrinkIds) : null;
  const pool: PairResult[] = [];
  const excluded: string[] = [];
  const naFlags = new Map<string, boolean>();
  const seen = new Set<string>();
  for (const raw of drinks) {
    const b = drinkVector(raw, P);
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    if (catSet !== null && !catSet.has(b.category)) continue;
    if (venueSet !== null && !venueSet.has(b.id)) continue;
    const r = scorePair(b, d, ctx, P, cidx, explain);
    if (r.excluded) {
      excluded.push(b.id);
      continue;
    }
    naFlags.set(b.id, b.non_alcoholic_flag);
    pool.push(r);
  }
  return { pool, excluded, naFlags };
}

/**
 * Топ-N напитков к блюду (§5.4 + политика Efes) (= Python recommend).
 * Фильтры: categories (или ctx.categories), venueDrinkIds (или ctx.venue_drink_ids), V7 (ctx non_alcoholic).
 * Порядок: partnerOrder; затем диверсификация (≤ max_per_group на style.family; без фильтра категорий — гарантия
 * одной безалкогольной и одной не-пивной позиции с баллом ≥ min_score_guarantee). topN = 0 — весь пул без диверсификации.
 */
export function recommend(dish: DishInput, drinks: Iterable<DrinkInput>, ctx?: Ctx | null, topN?: number | null,
  params?: ParamsV2 | null, classics?: ClassicsArg, categories?: readonly string[] | null,
  venueDrinkIds?: readonly string[] | null, explain = true): RecommendResult {
  const P = pickParams(params);
  const cx: Ctx = { ...(ctx || {}) };
  const cats = categories === null || categories === undefined ? cx.categories : categories;
  const venue = venueDrinkIds === null || venueDrinkIds === undefined ? cx.venue_drink_ids : venueDrinkIds;
  const n = topN === null || topN === undefined ? P.recommend.top_n : topN;
  const d = dishVector(dish, P);
  const { pool, excluded, naFlags } = scoredPool(d, drinks, cx, P, classics, cats, venue, explain);
  const ranked = partnerOrder(pool, P);
  const items = truthy(n) ? diversify(ranked, n, P, !truthy(cats), naFlags) : ranked;
  const window = P.recommend.partner_tie_window;
  return {
    engine: 'v2',
    dish_id: d.id,
    items,
    best_partner: bestPartner(pool),
    n_candidates: pool.length,
    excluded_non_alcoholic: excluded,
    policy: { partner_tie_window: window, note: tpl(P.recommend.policy_note, { window: fmtNum(window) }) },
  };
}

/** Лучшие напитки в каждой категории (вкладки UI). Порядок — CATEGORIES, неизвестные — по алфавиту в конце. */
export function byCategory(dish: DishInput, drinks: Iterable<DrinkInput>, ctx?: Ctx | null, params?: ParamsV2 | null,
  classics?: ClassicsArg, perCategory = 1, venueDrinkIds?: readonly string[] | null, explain = true): ByCategoryResult {
  const P = pickParams(params);
  const cx: Ctx = { ...(ctx || {}) };
  const venue = venueDrinkIds === null || venueDrinkIds === undefined ? cx.venue_drink_ids : venueDrinkIds;
  const d = dishVector(dish, P);
  const { pool, excluded } = scoredPool(d, drinks, cx, P, classics, cx.categories, venue, explain);
  const groups = new Map<string, PairResult[]>();
  for (const r of pool) {
    let g = groups.get(r.category);
    if (g === undefined) {
      g = [];
      groups.set(r.category, g);
    }
    g.push(r);
  }
  const known: readonly string[] = CATEGORIES;
  const cats = [
    ...known.filter((c) => groups.has(c)),
    ...[...groups.keys()].filter((c) => !known.includes(c)).sort(pyStrCmp),
  ];
  const out: CategoryGroup[] = [];
  for (const c of cats) {
    const ranked = partnerOrder(groups.get(c) as PairResult[], P);
    out.push({ category: c, label: dgetOr(P.labels.category, c, c), n: ranked.length, best: ranked[0],
      items: ranked.slice(0, pyMax(1, perCategory)) });
  }
  return { engine: 'v2', dish_id: d.id, categories: out, best_partner: bestPartner(pool), excluded_non_alcoholic: excluded };
}

/** Лучшие блюда к напитку: сортировка (−score, dish_id); topN = 0 — все. */
export function reverse(drink: DrinkInput, dishes: Iterable<DishInput>, ctx?: Ctx | null, topN?: number | null,
  params?: ParamsV2 | null, classics?: ClassicsArg, explain = true): ReverseResult {
  const P = pickParams(params);
  const cx: Ctx = { ...(ctx || {}) };
  const b = drinkVector(drink, P);
  const cidx: ClassicsArg = Array.isArray(classics) ? indexClassics(classics as readonly ClassicPair[]) : classics;
  const results: PairResult[] = [];
  for (const d of dishes) results.push(scorePair(b, d, cx, P, cidx, explain));
  results.sort(byScoreThen('dish_id'));
  const n = topN === null || topN === undefined ? P.recommend.reverse_top_n : topN;
  const excluded = results.length > 0 && results[0].excluded;
  return { engine: 'v2', drink_id: b.id, items: truthy(n) ? results.slice(0, n) : results, excluded };
}
