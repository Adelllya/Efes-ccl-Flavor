/**
 * «Дастархан» — подбор напитков на весь стол (несколько блюд одновременно). Чистые функции, без Angular.
 *
 *   planTable(dishes, pool, ctx, params, classics, opts) → TablePlan                       (синхронно)
 *   planTableAsync(…, { …opts, chunk, signal }) → Promise<TablePlan | null>                  (порциями, для страницы)
 *   opts.cache = newTableScoreCache() — баллы пар живут между вызовами: +1 блюдо = +1 столбец, а не вся матрица.
 *
 * Страница: const cache = newTableScoreCache();
 *   plan = await planTableAsync(dishes, data.guestPool(), { ...prefs.ctx(), occasion }, data.params, data.classics,
 *     { cache, venueDrinkIds, maxFlight: 3, signal });
 *
 * 1. Матрица «напиток × блюдо» (buildTableMatrix): каждый балл — scorePair(explain=false) движка v2, один раз.
 *    Напиток, исключённый контекстом (V7 «без алкоголя»: ABV > порога), в матрицу не попадает.
 *    Пул сужают opts.venueDrinkIds (карта заведения) и opts.categories (или те же поля ctx).
 * 2. single — ОДИН напиток на весь стол по принципу maximin: максимизируем худший балл по блюдам (самое трудное блюдо
 *    держится лучше всего; это не гарантия, что плохих пар нет — below_min и warnings говорят честно). Равенство —
 *    больший средний балл, затем id. runner_ups — следующие по тому же ключу (как в выдаче движка: не больше
 *    params.recommend.diversify.max_per_group напитков одного стилевого семейства, если есть из чего выбрать).
 * 3. flight — сет из 1..maxFlight бокалов, жадно от single: первый бокал — сам single, дальше каждый следующий — тот, что
 *    сильнее всего поднимает Σ_блюда max_{напиток сета} балл. Напиток добавляется, только если в среднем поднимает на
 *    ≥ minGainPerDish баллов каждое блюдо, которое он «забирает» (иначе лишний бокал — стоп). Чистка: убираются бокалы
 *    без блюд и (кроме single) бокалы, чей вклад на строго улучшенное блюдо упал ниже порога. Из очищенных префиксов
 *    жадной последовательности берётся сет с наибольшей суммой (равенство — меньше бокалов), поэтому:
 *    • каждое блюдо в сете не хуже, чем с single (flight_summary.min ≥ single.min, Σ сета ≥ Σ single);
 *    • сет из одного бокала — это всегда single («второй бокал не нужен» проверено для показанного напитка);
 *    • больший maxFlight никогда не даёт меньшую сумму.
 *    Каждое блюдо — к лучшему напитку сета. Порядок подачи — ENGINE_V2_SPEC §6.4: по громкости F_B по возрастанию,
 *    при равной — по весу W_B, затем от сухого к сладкому (Oliver, CMS).
 * 4. warnings — блюда, у которых даже лучший бокал сета ниже minScore (честно: «хорошей пары нет»), с лучшим напитком
 *    всего пула — чтобы отличить «в карте нет хорошей пары» (no_good_pair), «пара есть, но сет уже полон» (flight_limit)
 *    и «пара есть, место в сете было, но бокал добавляет меньше minGainPerDish на блюдо» (small_gain).
 * 5. Политика Efes (V2_CONTRACT.md) — только ПОРЯДОК показа: если включено opts.efesWindow и лучший по тому же ключу
 *    напиток Efes уступает single не больше чем на params.recommend.partner_tie_window баллов и по худшему, и по
 *    среднему баллу, он возвращается как efes_alternative (с честным местом rank) и первым в policy.display_order
 *    (promoted = true). single, баллы, состав runner_ups и сет от бренда не зависят никогда; best_partner — лучший
 *    напиток Efes с честными баллами.
 *
 * Все числа — из движка (scorePair); здесь нет своей формулы балла. Тексты причин/предупреждений — тексты движка
 * для конкретной пары. explain=true пересчитывается только для пар, которые показываются подробно (detail = true:
 * single, efes_alternative и — когда политика подняла Efes — запасные, что выше него по баллам); остальные запасные и
 * best_partner собираются из строки матрицы (detail = false: per_dish пуст, текстов нет). Всё детерминировано.
 * Проверки: npm run test:table (scripts/table-planner-test.mjs).
 */
import {
  ClassicsArg, Ctx, DishInput, DishProfile, DrinkInput, DrinkProfile, ParamsV2, PairResult,
  defaultParams, dishVector, drinkVector, fmtNum, indexClassics, isEfesRelation, pyStrCmp, r1, scorePair, tpl,
} from '../engine/pairing-engine-v2';
import { mainReason, mainWarning } from './menu-optimizer';

// ─────────────────────────────────────────────────────────────────────────────
// константы
// ─────────────────────────────────────────────────────────────────────────────
/** Сколько бокалов в сете по умолчанию и максимум. */
export const DEFAULT_MAX_FLIGHT = 3;
export const MAX_FLIGHT = 4;
/** Ниже этого балла пара не «хорошая» (бэнд good в engine_v2_params.bands начинается с 60). */
export const DEFAULT_MIN_SCORE = 60;
/** Новый бокал в сете должен поднимать каждое «своё» блюдо в среднем хотя бы на столько баллов. */
export const DEFAULT_MIN_GAIN_PER_DISH = 3;
/** Сколько запасных вариантов «один на весь стол». */
export const DEFAULT_RUNNER_UPS = 2;
/** Сколько блюд разумно выбирать на странице (ядро не ограничивает). */
export const MAX_TABLE_DISHES = 12;
/** Сколько контекстов (повод, профиль гостя…) держит кеш баллов страницы; старые вытесняются (LRU). */
export const TABLE_CACHE_CONTEXTS = 4;
/** planTableAsync: сколько миллисекунд счёта подряд, прежде чем отдать главный поток (кадр ≈ 16 мс). */
export const TABLE_SLICE_MS = 8;

/** Готовые столы: id блюд из data/dishes_v2.json (проверяется в test:table). Подписи — в i18n страницы (table.preset.<id>). */
export interface TablePreset { id: string; dishes: readonly string[] }
export const TABLE_PRESETS: readonly TablePreset[] = [
  { id: 'dastarkhan', dishes: ['beshbarmak', 'kazy', 'baursaki', 'kurt', 'samsa', 'chak-chak'] },
  { id: 'beer_night', dishes: ['pretzel', 'vobla', 'bbq-wings', 'fries', 'garlic-croutons', 'salted-nuts'] },
  { id: 'sushi', dishes: ['sushi', 'philadelphia-roll', 'tempura', 'edamame', 'yakitori'] },
  { id: 'grill', dishes: ['shashlyk', 'lyulya-kebab', 'shashlyk-chicken', 'bbq-ribs', 'ribeye-steak', 'asparagus-grilled'] },
  { id: 'dessert', dishes: ['chak-chak', 'medovik', 'cheesecake', 'baklava', 'dark-chocolate', 'tiramisu'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// типы
// ─────────────────────────────────────────────────────────────────────────────
export interface TablePlanOptions {
  /** Максимум бокалов в сете: 1..4 (по умолчанию 3). */
  maxFlight?: number;
  /** Порог «хорошей» пары для предупреждений (по умолчанию 60). */
  minScore?: number;
  /** Минимальный средний прирост на «забранное» блюдо, чтобы добавить бокал (по умолчанию 3). */
  minGainPerDish?: number;
  /** Политика окна Efes для порядка показа «одного напитка» (по умолчанию true — как в выдаче движка). */
  efesWindow?: boolean;
  /** Окно политики в баллах (по умолчанию params.recommend.partner_tie_window). */
  window?: number;
  /** Сколько запасных вариантов «один на весь стол» (по умолчанию 2). */
  runnerUps?: number;
  /** Только напитки заведения (id v2; см. PairingV2Service.venueDrinkIds). null — весь пул. Иначе — ctx.venue_drink_ids. */
  venueDrinkIds?: readonly string[] | null;
  /** Только эти категории напитков. null — все. Иначе — ctx.categories. */
  categories?: readonly string[] | null;
  /** Готовая матрица прошлого вызова: переиспользуется, если совпал её key (те же блюда, пул, контекст, фильтры). */
  matrix?: TableMatrix | null;
  /** Кеш баллов пар между вызовами (newTableScoreCache) — добавление блюда пересчитывает только его столбец. */
  cache?: TableScoreCache | null;
}

/** Опции planTableAsync сверх planTable. */
export interface TablePlanAsyncOptions extends TablePlanOptions {
  /** Отдавать поток после каждых `chunk` напитков (для тестов). По умолчанию — по времени: каждые TABLE_SLICE_MS мс. */
  chunk?: number;
  /** Бюджет одного куска счёта в мс (по умолчанию TABLE_SLICE_MS); используется, когда chunk не задан. */
  sliceMs?: number;
  /** signal.aborted (AbortSignal или {aborted}) — вернуть null: входы уже поменялись. */
  signal?: { readonly aborted: boolean } | null;
}

/**
 * Баллы движка «напиток × блюдо». scores[i][j] — балл drink_ids[i] к dish_ids[j] (scorePair, explain=false).
 * Структура — простой JSON (можно хранить в signal). Для поиска — matrixScore().
 */
export interface TableMatrix {
  /** Подпись входов (контекст, версия параметров, блюда, отфильтрованный пул) — для переиспользования. */
  key: string;
  dish_ids: string[];
  /** Кандидаты (без исключённых контекстом), в порядке пула. */
  drink_ids: string[];
  scores: number[][];
  /** Исключены контекстом «без алкоголя» (V7: ABV выше порога). */
  excluded_non_alcoholic: string[];
}

/** Балл пары в ячейке стола (из explain-пересчёта движка). */
export interface TablePairCell {
  dish_id: string;
  dish_name: string;
  score: number;
  band: string;
  band_label: string;
  /** Задокументированная классическая пара (R20). */
  classic: boolean;
}

export interface TableWeakDish extends TablePairCell {
  /** Главное предупреждение движка для этой пары (почему слабее), если есть. */
  warning: string | null;
}

export interface TableStrongDish extends TablePairCell {
  /** Главная причина движка для этой пары. */
  reason: string | null;
}

/** Кандидат «один напиток на весь стол». */
export interface TableSingle {
  drink_id: string;
  drink_name: string;
  category: string;
  family: string;
  efes_relation: string;
  efes: boolean;
  abv: number;
  /** Худший балл по блюдам стола — критерий maximin. */
  min: number;
  /** Средний балл по блюдам (r1). */
  mean: number;
  /** Сумма баллов (целое; равные min сравниваются по ней — это тот же порядок, что по среднему). */
  sum: number;
  /** Баллы к каждому блюду — в порядке блюд стола. */
  per_dish: TablePairCell[];
  /** Блюдо с худшим баллом (равенство — первое в порядке стола). */
  weakest_dish: TableWeakDish;
  /** Блюдо с лучшим баллом — из его пары взяты why/reasons. */
  strongest_dish: TableStrongDish;
  /** Главная причина движка (для лучшей пары напитка на этом столе). */
  why: string | null;
  /** 1–2 текста причин движка для лучшей пары (для карточки/сторис). */
  reasons: string[];
  /** Сколько блюд ниже minScore. */
  below_min: number;
  /**
   * true — карточка собрана полностью (per_dish, тексты движка: explain=true). false — из строки матрицы: per_dish пуст,
   * why/reasons/warning/reason пустые; min/mean/sum/below_min и худшее/лучшее блюдо (балл и бэнд движка) — честные.
   */
  detail: boolean;
}

/** Альтернатива Efes, показанная первой по политике окна. Её баллы — честные, single не меняется. */
export interface TableEfesAlternative extends TableSingle {
  /** single.min − min этого напитка (≥ 0, ≤ окна). */
  gap: number;
  /** single.mean − mean этого напитка (r1; может быть < 0 — по среднему он бывает и выше). */
  mean_gap: number;
  /** Честное место по ключу maximin среди всех кандидатов (1 — single). Показывать рядом с продвинутой карточкой. */
  rank: number;
}

/** Бокал сета. Список flight отсортирован по порядку подачи (order = 1..N). */
export interface TableFlightItem {
  drink_id: string;
  drink_name: string;
  category: string;
  family: string;
  efes_relation: string;
  efes: boolean;
  abv: number;
  /** Порядок подачи, 1..N: от тихого к громкому (F_B), затем по весу (W_B), затем от сухого к сладкому. */
  order: number;
  /** На каком шаге жадного выбора напиток вошёл в сет (1 — «якорь», это всегда single). */
  pick: number;
  /** Блюда, к которым этот бокал — лучший в сете (по убыванию балла). */
  dishes: TablePairCell[];
  /** id блюда, с которым у бокала лучшая пара (из неё why/reasons). */
  best_dish_id: string;
  why: string | null;
  reasons: string[];
  /**
   * На сколько баллов суммарно хуже стали бы его блюда без этого бокала (null — в сете один бокал). Это сумма по блюдам,
   * не балл 0–99: на экране — gain / dishes.length («в среднем на блюдо»).
   */
  gain: number | null;
  /** Сколько его блюд без него стали бы строго хуже (блюда с равным баллом у другого бокала сюда не входят). */
  gain_dishes: number;
  /** Громкость, вес (r2 из scorePair) и сладость напитка — основание порядка подачи. */
  F_B: number;
  W_B: number;
  sweet: number;
}

export interface TableFlightSummary {
  size: number;
  /** Σ/среднее/минимум баллов стола, когда каждое блюдо — со своим лучшим бокалом сета. */
  sum: number;
  mean: number;
  min: number;
  /** Те же величины для single (один напиток на всё) — «что даёт сет». */
  single_sum: number;
  single_mean: number;
  single_min: number;
}

export type TableWarningKind = 'no_good_pair' | 'flight_limit' | 'small_gain';

/** Блюдо, у которого лучший бокал сета ниже minScore. */
export interface TableWarning {
  dish_id: string;
  dish_name: string;
  /** Лучший балл в сете и его напиток. */
  score: number;
  drink_id: string;
  drink_name: string;
  /** Предупреждение движка для этой пары. */
  engine_warning: string | null;
  /** Лучший напиток всего пула к этому блюду (честный потолок). */
  pool_best: { drink_id: string; drink_name: string; score: number };
  /**
   * no_good_pair — во всём пуле нет пары ≥ minScore; flight_limit — есть, но сет уже полон (maxFlight бокалов);
   * small_gain — есть, место в сете было, но бокал поднимает свои блюда в среднем меньше чем на minGainPerDish.
   */
  kind: TableWarningKind;
}

export interface TablePolicy {
  /** Включена ли политика окна Efes для этого вызова. */
  efes_window: boolean;
  /** Окно в баллах. */
  window: number;
  /** Напиток Efes показан первым вместо лучшего (см. efes_alternative) — об этом нужно сказать гостю. */
  promoted: boolean;
  /** Порядок карточек «один напиток на стол»: id из single / efes_alternative / runner_ups. */
  display_order: string[];
  /** Текст политики из параметров движка. */
  note: string;
}

export type TablePlanStatus = 'ok' | 'no_dishes' | 'no_drinks';

export interface TablePlan {
  engine: 'v2';
  status: TablePlanStatus;
  /** Блюда стола (без повторов), в порядке ввода. */
  dishes: { dish_id: string; dish_name: string }[];
  n_candidates: number;
  excluded_non_alcoholic: string[];
  matrix: TableMatrix;
  /** Лучший один напиток на весь стол (maximin); null — нет блюд или напитков. */
  single: TableSingle | null;
  runner_ups: TableSingle[];
  /** Сет в порядке подачи. */
  flight: TableFlightItem[];
  flight_summary: TableFlightSummary | null;
  /** Блюдо → напиток сета. */
  assignment: Record<string, string>;
  warnings: TableWarning[];
  /** Только когда policy.promoted. */
  efes_alternative: TableEfesAlternative | null;
  /** Лучший напиток Efes по тому же критерию, с честными баллами (null — в пуле нет Efes). */
  best_partner: TableSingle | null;
  policy: TablePolicy;
  /** Итоговые опции (после значений по умолчанию и ограничений). */
  options: { maxFlight: number; minScore: number; minGainPerDish: number; efesWindow: boolean; window: number; runnerUps: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// матрица
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Каноническая строка JSON (ключи по алфавиту) — для подписи контекста. Поля null и undefined отбрасываются: для движка
 * они одинаковы (ctx.x ?? по умолчанию), поэтому {occasion: null} и {} — один контекст и один блок кеша.
 */
function stableJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableJson).join(',')}]`;
  if (x !== null && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined && o[k] !== null).sort()
      .map(k => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(x ?? null);
}

function uniqueDishes(dishes: Iterable<DishInput>, P: ParamsV2): DishProfile[] {
  const out: DishProfile[] = [];
  const seen = new Set<string>();
  for (const raw of dishes) {
    const d = dishVector(raw, P);
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

interface Filters { venue: readonly string[] | null; categories: readonly string[] | null }

function resolveFilters(ctx: Ctx, opts: TablePlanOptions): Filters {
  const venue = opts.venueDrinkIds !== undefined ? opts.venueDrinkIds : (ctx.venue_drink_ids ?? null);
  const cats = opts.categories !== undefined ? opts.categories : (ctx.categories ?? null);
  return { venue: venue ?? null, categories: cats && cats.length ? cats : null };
}

function filteredPool(pool: Iterable<DrinkInput>, P: ParamsV2, f: Filters): DrinkProfile[] {
  const venue = f.venue ? new Set(f.venue) : null;
  const cats = f.categories ? new Set(f.categories) : null;
  const out: DrinkProfile[] = [];
  const seen = new Set<string>();
  for (const raw of pool) {
    const b = drinkVector(raw, P);
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    if (venue && !venue.has(b.id)) continue;
    if (cats && !cats.has(b.category)) continue;
    out.push(b);
  }
  return out;
}

/**
 * Кеш баллов пар между вызовами: блок на подпись контекста → напиток → блюдо → балл (−1 — напиток исключён V7).
 * Держите один на страницу: добавили блюдо — считается только его столбец. Подпись контекста хранится один раз на блок,
 * а не в каждом ключе; блоков — не больше maxContexts (последние по использованию, LRU), так что перебор поводов и
 * переключателей не раздувает память. Действителен для одних params и classics.
 */
export class TableScoreCache {
  private readonly blocks = new Map<string, Map<string, Map<string, number>>>();
  constructor(readonly maxContexts: number = TABLE_CACHE_CONTEXTS) {}
  /** Блок баллов контекста: создаёт при нужде и помечает как свежий; самые старые сверх maxContexts удаляются. */
  block(sig: string): Map<string, Map<string, number>> {
    let b = this.blocks.get(sig);
    if (b) { this.blocks.delete(sig); this.blocks.set(sig, b); return b; }
    b = new Map();
    this.blocks.set(sig, b);
    const cap = Math.max(1, Math.floor(this.maxContexts));
    for (const k of this.blocks.keys()) {
      if (this.blocks.size <= cap) break;
      this.blocks.delete(k);
    }
    return b;
  }
  /** Сколько баллов пар хранится (всего по блокам). */
  get size(): number {
    let n = 0;
    for (const b of this.blocks.values()) for (const row of b.values()) n += row.size;
    return n;
  }
  /** Сколько контекстов в кеше. */
  get contexts(): number { return this.blocks.size; }
  clear(): void { this.blocks.clear(); }
}
export function newTableScoreCache(maxContexts: number = TABLE_CACHE_CONTEXTS): TableScoreCache {
  return new TableScoreCache(maxContexts);
}

/** Подпись контекста для кеша и матрицы: всё, что влияет на балл (фильтры пула — нет). */
function ctxSig(ctx: Ctx, P: ParamsV2): string {
  const { venue_drink_ids: _v, categories: _c, ...rest } = ctx;
  return `${P.version ?? ''}~${stableJson(rest)}`;
}

interface Prepared {
  P: ParamsV2; cx: Ctx; cidx: ClassicsArg; dp: DishProfile[]; drinks: DrinkProfile[]; sig: string; key: string;
}

function prepare(dishes: Iterable<DishInput>, pool: Iterable<DrinkInput>, ctx: Ctx | null | undefined, params: ParamsV2 | null | undefined,
  classics: ClassicsArg, opts: Pick<TablePlanOptions, 'venueDrinkIds' | 'categories'>): Prepared {
  const P = params ?? defaultParams();
  const cx: Ctx = ctx ?? {};
  const f = resolveFilters(cx, opts);
  const dp = uniqueDishes(dishes, P);
  const drinks = filteredPool(pool, P, f);
  const sig = ctxSig(cx, P);
  // пул уже отфильтрован (заведение, категории) — его id и есть подпись фильтров
  const key = [sig, dp.map(d => d.id).join(','), drinks.map(b => b.id).join(',')].join('|');
  return { P, cx, cidx: Array.isArray(classics) ? indexClassics(classics) : classics, dp, drinks, sig, key };
}

/** Матрица по шагам: yield после каждого напитка (строки матрицы) — вызывающий решает, когда отдать поток. */
function* matrixSteps(p: Prepared, cache: TableScoreCache | null | undefined): Generator<void, TableMatrix, void> {
  const drinkIds: string[] = [];
  const scores: number[][] = [];
  const excluded: string[] = [];
  const block = cache ? cache.block(p.sig) : null;
  for (let i = 0; i < p.drinks.length; i++) {
    if (i > 0) yield;
    const b = p.drinks[i];
    const row: number[] = [];
    let out = false;
    let memo = block ? block.get(b.id) : undefined;
    if (block && !memo) { memo = new Map(); block.set(b.id, memo); }
    for (const d of p.dp) {
      let s = memo ? memo.get(d.id) : undefined;
      if (s === undefined) {
        const r = scorePair(b, d, p.cx, p.P, p.cidx, false);
        s = r.excluded ? -1 : r.score;
        if (memo) memo.set(d.id, s);
      }
      if (s < 0) { out = true; break; }
      row.push(s);
    }
    if (out) { excluded.push(b.id); continue; }
    drinkIds.push(b.id);
    scores.push(row);
  }
  return { key: p.key, dish_ids: p.dp.map(d => d.id), drink_ids: drinkIds, scores, excluded_non_alcoholic: excluded };
}

function runSync<R>(g: Generator<void, R, void>): R {
  for (;;) {
    const n = g.next();
    if (n.done) return n.value;
  }
}

/**
 * Только матрица баллов (без плана) — тем же пулом и фильтрами, что planTable. Пустой список блюд — матрица без
 * столбцов (исключения V7 тогда не определить: excluded_non_alcoholic пуст).
 */
export function buildTableMatrix(dishes: Iterable<DishInput>, pool: Iterable<DrinkInput>, ctx?: Ctx | null,
  params?: ParamsV2 | null, classics?: ClassicsArg,
  opts: Pick<TablePlanOptions, 'venueDrinkIds' | 'categories' | 'cache'> = {}): TableMatrix {
  return runSync(matrixSteps(prepare(dishes, pool, ctx, params, classics, opts), opts.cache));
}

/** Балл напитка к блюду из матрицы; null — пары нет в матрице (напиток исключён / не в пуле / блюдо не на столе). */
export function matrixScore(m: TableMatrix, dishId: string, drinkId: string): number | null {
  const j = m.dish_ids.indexOf(dishId);
  const i = m.drink_ids.indexOf(drinkId);
  return i < 0 || j < 0 ? null : m.scores[i][j];
}

// ─────────────────────────────────────────────────────────────────────────────
// план
// ─────────────────────────────────────────────────────────────────────────────
const clampInt = (x: number | undefined, lo: number, hi: number, dflt: number): number => {
  const v = typeof x === 'number' && Number.isFinite(x) ? Math.floor(x) : dflt;
  return v < lo ? lo : v > hi ? hi : v;
};

interface Stat { i: number; min: number; sum: number }

/** Ключ maximin: больший min, затем больший sum, затем id (как sorted() в Python — по кодовым точкам). */
function cmpStat(a: Stat, b: Stat, ids: readonly string[]): number {
  return b.min - a.min || b.sum - a.sum || pyStrCmp(ids[a.i], ids[b.i]);
}

function reasonsOf(r: PairResult, n = 2): string[] {
  const out: string[] = [];
  const main = mainReason(r);
  if (main) out.push(main);
  for (const m of r.reasons) {
    if (out.length >= n) break;
    if (m.text && !out.includes(m.text)) out.push(m.text);
  }
  return out;
}

/**
 * План напитков на стол. dishes — блюда стола (записи dishes_v2 или профили; повторы по id отбрасываются);
 * pool — напитки (обычно DataV2Service.guestPool()); ctx — контекст движка (повод, «без алкоголя», профиль гостя);
 * params/classics — как у scorePair (DataV2Service.params / .classics).
 */
export function planTable(dishes: Iterable<DishInput>, pool: Iterable<DrinkInput>, ctx?: Ctx | null, params?: ParamsV2 | null,
  classics?: ClassicsArg, opts: TablePlanOptions = {}): TablePlan {
  const prep = prepare(dishes, pool, ctx, params, classics, opts);
  const m = opts.matrix && opts.matrix.key === prep.key ? opts.matrix : runSync(matrixSteps(prep, opts.cache));
  return planFrom(prep, m, opts);
}

const nowMs = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/**
 * Отдать главный поток: scheduler.yield(), где он есть (продолжение — вперёд других задач), иначе MessageChannel
 * (вложенный setTimeout(0) браузеры зажимают до 4 мс), иначе setTimeout.
 */
function yieldToMain(): Promise<void> {
  const sch = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sch && typeof sch.yield === 'function') return sch.yield();
  if (typeof MessageChannel === 'function') {
    return new Promise<void>(resolve => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(null);
    });
  }
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

/**
 * То же, что planTable, но без долгих задач: матрица считается кусками не дольше opts.sliceMs (по умолчанию
 * TABLE_SLICE_MS = 8 мс, независимо от числа блюд) или по opts.chunk напитков, между ними поток отдаётся странице;
 * перед сборкой плана — ещё одна пауза. signal.aborted (AbortSignal или {aborted}) — вернуть null (входы уже
 * поменялись). С cache повторный вызов после добавления блюда считает только новый столбец.
 */
export async function planTableAsync(dishes: Iterable<DishInput>, pool: Iterable<DrinkInput>, ctx?: Ctx | null,
  params?: ParamsV2 | null, classics?: ClassicsArg, opts: TablePlanAsyncOptions = {}): Promise<TablePlan | null> {
  const prep = prepare(dishes, pool, ctx, params, classics, opts);
  let m: TableMatrix | null = opts.matrix && opts.matrix.key === prep.key ? opts.matrix : null;
  if (!m) {
    const chunk = opts.chunk !== undefined && opts.chunk !== null ? clampInt(opts.chunk, 1, 100000, 40) : 0;
    const budget = typeof opts.sliceMs === 'number' && Number.isFinite(opts.sliceMs) ? Math.max(1, opts.sliceMs) : TABLE_SLICE_MS;
    const g = matrixSteps(prep, opts.cache);
    let t0 = nowMs();
    let rows = 0;
    for (;;) {
      const n = g.next();
      if (n.done) { m = n.value; break; }
      rows++;
      if (chunk ? rows % chunk === 0 : nowMs() - t0 >= budget) {
        await yieldToMain();
        if (opts.signal?.aborted) return null;
        t0 = nowMs();
      }
    }
  }
  // сборка плана (explain для показанных пар) и перерисовка страницы — отдельной задачей после матрицы
  await yieldToMain();
  return opts.signal?.aborted ? null : planFrom(prep, m, opts);
}

function planFrom(prep: Prepared, m: TableMatrix, opts: TablePlanOptions): TablePlan {
  const { P, cx, cidx, dp, drinks } = prep;
  const window = typeof opts.window === 'number' && Number.isFinite(opts.window) ? Math.max(0, opts.window) : P.recommend.partner_tie_window;
  const o = {
    maxFlight: clampInt(opts.maxFlight, 1, MAX_FLIGHT, DEFAULT_MAX_FLIGHT),
    minScore: typeof opts.minScore === 'number' && Number.isFinite(opts.minScore) ? opts.minScore : DEFAULT_MIN_SCORE,
    minGainPerDish: typeof opts.minGainPerDish === 'number' && Number.isFinite(opts.minGainPerDish)
      ? Math.max(0, opts.minGainPerDish) : DEFAULT_MIN_GAIN_PER_DISH,
    efesWindow: opts.efesWindow ?? true,
    window,
    runnerUps: clampInt(opts.runnerUps, 0, 10, DEFAULT_RUNNER_UPS),
  };

  const byId = new Map(drinks.map(b => [b.id, b]));
  const cand = m.drink_ids.map(id => byId.get(id) as DrinkProfile);
  const ids = m.drink_ids;
  const S = m.scores;
  const nD = dp.length;

  const policyNote = tpl(P.recommend.policy_note, { window: fmtNum(window) });
  const base: TablePlan = {
    engine: 'v2', status: 'ok',
    dishes: dp.map(d => ({ dish_id: d.id, dish_name: d.name })),
    n_candidates: cand.length, excluded_non_alcoholic: m.excluded_non_alcoholic, matrix: m,
    single: null, runner_ups: [], flight: [], flight_summary: null, assignment: {}, warnings: [],
    efes_alternative: null, best_partner: null,
    policy: { efes_window: o.efesWindow, window, promoted: false, display_order: [], note: policyNote },
    options: o,
  };
  if (!nD) return { ...base, status: 'no_dishes' };
  if (!cand.length) return { ...base, status: 'no_drinks' };

  // explain=true — только для пар, которые показываются подробно, с кешем
  const explained = new Map<number, PairResult>();
  const explain = (i: number, j: number): PairResult => {
    const k = i * nD + j;
    let r = explained.get(k);
    if (!r) { r = scorePair(cand[i], dp[j], cx, P, cidx, true); explained.set(k, r); }
    return r;
  };
  const cellOf = (r: PairResult, j: number): TablePairCell =>
    ({ dish_id: dp[j].id, dish_name: dp[j].name, score: r.score, band: r.band, band_label: r.band_label, classic: r.classic });
  const cell = (i: number, j: number): TablePairCell => cellOf(explain(i, j), j);
  /** Бэнд и классика одной пары без текстов (explain=false) — для карточек из строки матрицы. */
  const quickCell = (i: number, j: number): TablePairCell =>
    (explained.has(i * nD + j) ? cell(i, j) : cellOf(scorePair(cand[i], dp[j], cx, P, cidx, false), j));

  // ── один напиток на весь стол (maximin) ────────────────────────────────────
  const stats: Stat[] = S.map((row, i) => {
    let mn = Infinity, sum = 0;
    for (const s of row) { if (s < mn) mn = s; sum += s; }
    return { i, min: mn, sum };
  });
  const ranked = stats.slice().sort((a, b) => cmpStat(a, b, ids));

  /** Общие поля карточки из строки матрицы: худшее/лучшее блюдо (равенство — первое в порядке стола). */
  const head = (st: Stat) => {
    const b = cand[st.i];
    const row = S[st.i];
    let wj = 0, bj = 0;
    for (let j = 1; j < nD; j++) {
      if (row[j] < row[wj]) wj = j;
      if (row[j] > row[bj]) bj = j;
    }
    return {
      wj, bj,
      fields: {
        drink_id: b.id, drink_name: b.name, category: b.category, family: b.family, efes_relation: b.efes_relation,
        efes: isEfesRelation(b.efes_relation, P), abv: b.abv,
        min: st.min, mean: r1(st.sum / nD), sum: st.sum,
        below_min: row.filter(s => s < o.minScore).length,
      },
    };
  };
  /** Полная карточка: баллы по всем блюдам и тексты движка (explain=true). */
  const single = (st: Stat): TableSingle => {
    const { wj, bj, fields } = head(st);
    const strong = explain(st.i, bj);
    return {
      ...fields,
      per_dish: dp.map((_, j) => cell(st.i, j)),
      weakest_dish: { ...cell(st.i, wj), warning: mainWarning(explain(st.i, wj)) },
      strongest_dish: { ...cellOf(strong, bj), reason: mainReason(strong) },
      why: mainReason(strong), reasons: reasonsOf(strong),
      detail: true,
    };
  };
  /** Лёгкая карточка из строки матрицы (запасные мелким шрифтом, best_partner): без per_dish и текстов. */
  const lite = (st: Stat): TableSingle => {
    const { wj, bj, fields } = head(st);
    return {
      ...fields,
      per_dish: [],
      weakest_dish: { ...quickCell(st.i, wj), warning: null },
      strongest_dish: { ...quickCell(st.i, bj), reason: null },
      why: null, reasons: [],
      detail: false,
    };
  };

  const best = single(ranked[0]);
  // запасные: следующие по ключу, не больше max_per_group одного семейства (включая single), если есть из чего выбрать
  const cap = Math.max(1, P.recommend.diversify.max_per_group);
  const fam = new Map<string, number>([[best.family, 1]]);
  const ru: Stat[] = [];
  for (const st of ranked.slice(1)) {
    if (ru.length >= o.runnerUps) break;
    const g = cand[st.i].family;
    if ((fam.get(g) ?? 0) >= cap) continue;
    fam.set(g, (fam.get(g) ?? 0) + 1);
    ru.push(st);
  }
  for (const st of ranked.slice(1)) {
    if (ru.length >= o.runnerUps) break;
    if (!ru.includes(st)) ru.push(st);
  }
  ru.sort((a, b) => cmpStat(a, b, ids));

  // ── Efes: лучший партнёр (честно) и окно политики (только порядок) ─────────
  const efesPos = ranked.findIndex(st => isEfesRelation(cand[st.i].efes_relation, P));
  const efesStat = efesPos >= 0 ? ranked[efesPos] : null;
  let promoted = false, gap = 0, meanGap = 0;
  if (o.efesWindow && efesStat && efesPos > 0) {
    gap = ranked[0].min - efesStat.min;
    meanGap = r1((ranked[0].sum - efesStat.sum) / nD);
    promoted = gap <= window && meanGap <= window;
  }
  // запасные, которые по баллам выше поднятого Efes, показываются так же крупно — им нужна полная карточка
  const runnerUps = ru.map(st => (promoted && efesStat && cmpStat(st, efesStat, ids) < 0 ? single(st) : lite(st)));
  const bestPartner = efesStat ? (efesPos === 0 ? best : promoted ? single(efesStat) : lite(efesStat)) : null;
  const efesAlt: TableEfesAlternative | null = promoted && bestPartner
    ? { ...bestPartner, gap, mean_gap: meanGap, rank: efesPos + 1 } : null;
  const displayOrder: string[] = [];
  for (const id of [efesAlt?.drink_id, best.drink_id, ...runnerUps.map(r => r.drink_id)]) {
    if (id && !displayOrder.includes(id)) displayOrder.push(id);
  }

  // ── сет: жадно по Σ max, начиная с single ───────────────────────────────────
  const a0 = ranked[0].i;
  const floor = S[a0];
  // Жадная последовательность от single. Она не зависит от maxFlight (только её длина), поэтому сет из k бокалов —
  // её префикс: так сравнение «не больше 2/3/4 бокалов» честное.
  const seq: number[] = [a0];
  {
    const cur = floor.slice();
    while (seq.length < o.maxFlight) {
      let pick: { i: number; gain: number; taken: number; newMin: number } | null = null;
      for (let i = 0; i < cand.length; i++) {
        if (seq.includes(i)) continue;
        const row = S[i];
        let gain = 0, taken = 0, newMin = Infinity;
        for (let j = 0; j < nD; j++) {
          const v = row[j] > cur[j] ? row[j] : cur[j];
          if (row[j] > cur[j]) { gain += row[j] - cur[j]; taken++; }
          if (v < newMin) newMin = v;
        }
        if (!taken || gain < o.minGainPerDish * taken) continue;
        if (pick === null || gain > pick.gain || (gain === pick.gain && (newMin > pick.newMin
          || (newMin === pick.newMin && pyStrCmp(ids[i], ids[pick.i]) < 0)))) {
          pick = { i, gain, taken, newMin };
        }
      }
      if (!pick) break;
      seq.push(pick.i);
      for (let j = 0; j < nD; j++) if (S[pick.i][j] > cur[j]) cur[j] = S[pick.i][j];
    }
  }

  /** Блюдо → индекс в fl лучшего бокала (равенство — раньше выбранный). */
  const assign = (fl: readonly number[]): number[] => dp.map((_, j) => {
    let k = 0;
    for (let q = 1; q < fl.length; q++) if (S[fl[q]][j] > S[fl[k]][j]) k = q;
    return k;
  });
  const sumOf = (fl: readonly number[]): number => {
    let s = 0;
    for (let j = 0; j < nD; j++) { let mx = -Infinity; for (const i of fl) if (S[i][j] > mx) mx = S[i][j]; s += mx; }
    return s;
  };
  /** Каждое блюдо не хуже, чем с single. */
  const keepsFloor = (fl: readonly number[]): boolean =>
    fl.includes(a0) || floor.every((f, j) => fl.some(i => S[i][j] >= f));
  /**
   * Вклад бокала q: насколько упадёт сумма без него (gain) и сколько его блюд без него станут строго хуже (n) —
   * то же «забирает», что в жадном шаге (блюда с равным баллом у другого бокала не считаются).
   */
  const marginal = (fl: readonly number[], asg: readonly number[], q: number): { gain: number; n: number } => {
    let gain = 0, n = 0;
    for (let j = 0; j < nD; j++) {
      if (asg[j] !== q) continue;
      let alt = -Infinity;
      for (let p = 0; p < fl.length; p++) if (p !== q && S[fl[p]][j] > alt) alt = S[fl[p]][j];
      const d = S[fl[q]][j] - alt;
      if (d > 0) { gain += d; n++; }
    }
    return { gain, n };
  };
  /**
   * Чистка: бокалы без блюд (все их блюда у других бокалов строго лучше); затем бокалы (кроме single) с вкладом ниже
   * порога на строго улучшенное блюдо — слабейший первым. Ни один шаг не опускает блюдо ниже его балла с single.
   */
  const cleanup = (start: readonly number[]): number[] => {
    const fl = start.slice();
    for (;;) {
      const asg = assign(fl);
      const empty = fl.findIndex((_, q) => !asg.includes(q));
      if (empty >= 0 && keepsFloor(fl.filter((_, p) => p !== empty))) { fl.splice(empty, 1); continue; }
      if (fl.length < 2) break;
      let drop: { q: number; per: number } | null = null;
      for (let q = 0; q < fl.length; q++) {
        if (fl[q] === a0) continue;
        const mg = marginal(fl, asg, q);
        const per = mg.n ? mg.gain / mg.n : 0;
        if (per >= o.minGainPerDish) continue;
        if (!keepsFloor(fl.filter((_, p) => p !== q))) continue;
        if (drop === null || per < drop.per || (per === drop.per && q > drop.q)) drop = { q, per };
      }
      if (!drop) break;
      fl.splice(drop.q, 1);
    }
    return fl;
  };
  // Из очищенных префиксов — с наибольшей суммой (равенство — меньше бокалов): больше бокалов в лимите не хуже.
  let flightIdx: number[] = [a0];
  let flightSum = sumOf(flightIdx);
  for (let k = 2; k <= seq.length; k++) {
    const fl = cleanup(seq.slice(0, k));
    const sm = sumOf(fl);
    if (sm > flightSum || (sm === flightSum && fl.length < flightIdx.length)) { flightIdx = fl; flightSum = sm; }
  }

  const asg = assign(flightIdx);
  const assignment: Record<string, string> = {};
  const items: (TableFlightItem & { sortKey: [number, number, number] })[] = flightIdx.map((i, q) => {
    const b = cand[i];
    const mine = dp.map((_, j) => j).filter(j => asg[j] === q);
    for (const j of mine) assignment[dp[j].id] = b.id;
    const cells = mine.map(j => cell(i, j)).sort((a, c) => c.score - a.score || pyStrCmp(a.dish_id, c.dish_id));
    const bj = mine.reduce((x, j) => (S[i][j] > S[i][x] ? j : x), mine[0]);
    const r = explain(i, bj);
    const mg = flightIdx.length > 1 ? marginal(flightIdx, asg, q) : null;
    return {
      drink_id: b.id, drink_name: b.name, category: b.category, family: b.family, efes_relation: b.efes_relation,
      efes: isEfesRelation(b.efes_relation, P), abv: b.abv,
      order: 0, pick: seq.indexOf(i) + 1, dishes: cells, best_dish_id: dp[bj].id,
      why: mainReason(r), reasons: reasonsOf(r),
      gain: mg ? mg.gain : null, gain_dishes: mg ? mg.n : 0,
      F_B: r.F_B, W_B: r.W_B, sweet: b.v.sweet,
      sortKey: [r.F_B, r.W_B, b.v.sweet],
    };
  });
  // порядок подачи (§6.4): F_B ↑, W_B ↑, сладость ↑, id
  items.sort((a, c) => a.sortKey[0] - c.sortKey[0] || a.sortKey[1] - c.sortKey[1] || a.sortKey[2] - c.sortKey[2]
    || pyStrCmp(a.drink_id, c.drink_id));
  const flight: TableFlightItem[] = items.map(({ sortKey: _k, ...it }, n) => ({ ...it, order: n + 1 }));

  // сводка и предупреждения
  const flightScores = dp.map((_, j) => S[flightIdx[asg[j]]][j]);
  const fSum = flightScores.reduce((s, x) => s + x, 0);
  const full = flight.length >= o.maxFlight;
  const warnings: TableWarning[] = [];
  for (let j = 0; j < nD; j++) {
    const sc = flightScores[j];
    if (sc >= o.minScore) continue;
    const i = flightIdx[asg[j]];
    let top = 0;
    for (let k = 1; k < cand.length; k++) {
      if (S[k][j] > S[top][j] || (S[k][j] === S[top][j] && pyStrCmp(ids[k], ids[top]) < 0)) top = k;
    }
    warnings.push({
      dish_id: dp[j].id, dish_name: dp[j].name, score: sc, drink_id: cand[i].id, drink_name: cand[i].name,
      engine_warning: mainWarning(explain(i, j)),
      pool_best: { drink_id: cand[top].id, drink_name: cand[top].name, score: S[top][j] },
      kind: S[top][j] < o.minScore ? 'no_good_pair' : full ? 'flight_limit' : 'small_gain',
    });
  }
  warnings.sort((a, c) => a.score - c.score || pyStrCmp(a.dish_id, c.dish_id));

  return {
    ...base,
    single: best,
    runner_ups: runnerUps,
    flight,
    flight_summary: {
      size: flight.length, sum: fSum, mean: r1(fSum / nD), min: Math.min(...flightScores),
      single_sum: best.sum, single_mean: best.mean, single_min: best.min,
    },
    assignment,
    warnings,
    efes_alternative: efesAlt,
    best_partner: bestPartner,
    policy: { ...base.policy, promoted: efesAlt !== null, display_order: displayOrder },
  };
}

/** Блюда готового стола, которые есть в переданном списке (порядок пресета). */
export function presetDishes<T extends { id?: string | null }>(presetId: string, all: readonly T[]): T[] {
  const p = TABLE_PRESETS.find(x => x.id === presetId);
  if (!p) return [];
  const byId = new Map(all.map(d => [d.id ?? '', d]));
  return p.dishes.map(id => byId.get(id)).filter((d): d is T => d !== undefined);
}
