/**
 * «Анализ карты» — оптимизатор барной карты (чистые функции, без Angular).
 *
 * analyzeMenu: для каждого блюда меню — лучший напиток из карты заведения (балл движка v2, бэнд, первая причина),
 *   индекс «качество пар» = средний лучший балл, доля блюд с парой ≥ 72, блюда без хорошей пары (< 60),
 *   «лишние позиции» — напитки карты, которые ни для одного блюда не лучший вариант.
 * suggestDrinks: жадный выбор (как в задаче о покрытии): на каждом шаге — напиток каталога, которого нет в карте,
 *   с максимальной суммой по блюдам max(0, новый лучший балл − текущий лучший балл); до `steps` шагов.
 *
 * Баллы считает только движок v2 (scorePair) — здесь нет своей формулы. Бренд на баллы и выбор не влияет:
 * режим «только Efes» лишь сужает кандидатов, а при равенстве прироста порядок решают наличие в Казахстане и id
 * (политика окна Efes действует в выдаче гостю, не в аналитике для владельца).
 *
 * Производительность: матрица «напиток × блюдо» кешируется в ScoreTable; её можно заполнять порциями
 * (fillScores на кусок каталога между кадрами) — analyzeMenu/suggestDrinks с готовой таблицей не зовут движок,
 * кроме пересчёта с текстами для показанных пар (≤ блюд + шагов).
 */
import {
  ClassicsArg, Ctx, DishInput, DishProfile, DrinkInput, DrinkProfile, ParamsV2, PairResult,
  dishVector, drinkVector, isEfesRelation, scorePair,
} from '../engine/pairing-engine-v2';

/** Пороги бэндов (engine_v2_params.bands): «отлично» от 72, «хорошо» от 60. */
export const EXCELLENT_FROM = 72;
export const GOOD_FROM = 60;
export const DEFAULT_STEPS = 3;
/** Шаг с суммарным приростом меньше этого — шум (±2 балла гость не заметит); на нём останавливаемся. */
export const DEFAULT_MIN_GAIN = 4;

export type PairLevel = 'excellent' | 'good' | 'weak' | 'none';

/** Порядок «чем проще купить, тем раньше» — для равного прироста. */
const AVAILABILITY_RANK: Readonly<Record<string, number>> = { wide: 0, horeca: 1, import: 2, niche: 3, unknown: 4, not_confirmed: 5 };

export interface MenuOptimizerOptions {
  /** Контекст подбора (по умолчанию пустой — «средний гость»). */
  ctx?: Ctx | null;
  /** Кеш баллов: заполняется по ходу (fillScores) и переиспользуется между вызовами. */
  table?: ScoreTable | null;
}

export interface SuggestOptions extends MenuOptimizerOptions {
  /** Сколько напитков предложить (жадных шагов), по умолчанию 3. */
  steps?: number;
  /** Минимальный суммарный прирост шага (по умолчанию DEFAULT_MIN_GAIN); меньше — остановка. */
  minGain?: number;
  /** Только портфель Efes (efes_relation own|distribution|cci по params.recommend.efes_relations). */
  efesOnly?: boolean;
  /** Ограничить кандидатов категориями каталога (null — все). */
  categories?: readonly string[] | null;
  /** Не предлагать эти id (например, напитки карты в стоп-листе: они уже заведены, но в анализ не входят). */
  exclude?: Iterable<string> | null;
  /** Уже посчитанный analyzeMenu для тех же входов — чтобы не пересчитывать текущие лучшие баллы. */
  analysis?: MenuAnalysis | null;
}

/** Кеш баллов «напиток × блюдо»: строка на напиток, столбцы — в порядке dishIds. */
export interface ScoreTable {
  readonly dishIds: readonly string[];
  readonly rows: Map<string, Int16Array>;
}

export interface DishState {
  dish_id: string;
  dish_name: string;
  /** Лучший напиток из карты (null — в карте нет ни одного напитка из каталога). */
  drink_id: string | null;
  drink_name: string | null;
  score: number | null;
  band: string | null;
  band_label: string | null;
  level: PairLevel;
  /** Первая причина движка (почему пара работает) — текст правила. */
  reason: string | null;
  /** Первое предупреждение движка (чем пара слаба) — для слабых пар. */
  warning: string | null;
  /** Потолок: лучший напиток всего каталога (гостевой пул + карта) для этого блюда. */
  ceiling: { drink_id: string; drink_name: string; score: number } | null;
}

export interface RedundantDrink {
  drink_id: string;
  drink_name: string;
  /** Блюдо, где напиток ближе всего к лидеру карты. */
  closest_dish_id: string | null;
  closest_dish_name: string | null;
  score: number | null;
  /** На сколько баллов уступает лучшему напитку карты для этого блюда (≥ 1). */
  gap: number | null;
}

export interface MenuAnalysis {
  dishes: DishState[];                     // худшие сверху
  /** Средний лучший балл по блюдам меню; null — меню пустое. */
  index: number | null;
  excellent: number;
  good: number;
  weak: number;
  /** Блюда, к которым в карте нет ни одного напитка. */
  none: number;
  /** Доля блюд с парой ≥ 72 (0..1); null — меню пустое. */
  excellent_share: number | null;
  list_size: number;
  redundant: RedundantDrink[];
  /** Текущий лучший балл карты по id блюда (null — нечем сочетать). */
  current: Record<string, number | null>;
}

export interface ImprovedDish {
  dish_id: string;
  dish_name: string;
  before: number | null;
  after: number;
  delta: number;
}

export interface SuggestStep {
  drink_id: string;
  drink_name: string;
  category: string;
  efes_relation: string;
  efes: boolean;
  /** Σ по блюдам max(0, новый лучший − текущий лучший) на этом шаге (с учётом предыдущих шагов). */
  gain: number;
  improved: ImprovedDish[];                // по убыванию прироста
  /** Главная причина для блюда с наибольшим приростом. */
  reason: string | null;
  /** Итог после этого шага (накопительно). */
  index_after: number | null;
  excellent_after: number;
  weak_after: number;
}

export interface SuggestResult {
  mode: 'any' | 'efes';
  candidates: number;
  steps: SuggestStep[];
  before: { index: number | null; excellent: number; weak: number };
  after: { index: number | null; excellent: number; weak: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// кеш баллов
// ─────────────────────────────────────────────────────────────────────────────

export function newScoreTable(dishes: readonly DishInput[], params?: ParamsV2 | null): ScoreTable {
  return { dishIds: dishes.map(d => dishVector(d, params).id), rows: new Map() };
}

/** Совпадает ли таблица с этим набором блюд (иначе её нельзя использовать). */
export function tableMatches(table: ScoreTable | null | undefined, dishes: readonly DishProfile[]): table is ScoreTable {
  if (!table || table.dishIds.length !== dishes.length) return false;
  for (let i = 0; i < dishes.length; i++) if (table.dishIds[i] !== dishes[i].id) return false;
  return true;
}

/** Досчитывает строки для напитков, которых ещё нет в таблице; возвращает число посчитанных напитков. */
export function fillScores(table: ScoreTable, drinks: Iterable<DrinkInput>, dishes: readonly DishInput[],
  params?: ParamsV2 | null, classics?: ClassicsArg, ctx?: Ctx | null): number {
  const dp = dishes.map(d => dishVector(d, params));
  if (!tableMatches(table, dp)) throw new Error('ScoreTable не совпадает с набором блюд');
  let n = 0;
  for (const raw of drinks) {
    const b = drinkVector(raw, params);
    if (table.rows.has(b.id)) continue;
    const row = new Int16Array(dp.length);
    for (let j = 0; j < dp.length; j++) {
      const r = scorePair(b, dp[j], ctx ?? {}, params, classics, false);
      row[j] = r.excluded ? -1 : r.score;
    }
    table.rows.set(b.id, row);
    n++;
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// анализ текущей карты
// ─────────────────────────────────────────────────────────────────────────────

export function levelFor(score: number | null): PairLevel {
  if (score === null) return 'none';
  return score >= EXCELLENT_FROM ? 'excellent' : score >= GOOD_FROM ? 'good' : 'weak';
}

const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Причина «почему работает» — как в меню гостя (venue-menu): сначала не R1 (баланс громкости с числами), потом любая. */
export function mainReason(r: PairResult | null | undefined): string | null {
  if (!r) return null;
  return (r.reasons.find(x => x.rule !== 'R1') ?? r.reasons[0])?.text || null;
}

/** Главное предупреждение: вето, затем штрафы; R1 (громкость) — последним. */
export function mainWarning(r: PairResult | null | undefined): string | null {
  if (!r) return null;
  const neg = r.warnings.filter(w => w.family === 'veto' || w.points < 0);
  return (neg.find(w => w.family === 'veto') ?? neg.find(w => w.rule !== 'R1') ?? neg[0])?.text || null;
}

function uniqueProfiles(drinks: Iterable<DrinkInput>, params?: ParamsV2 | null): DrinkProfile[] {
  const out: DrinkProfile[] = [];
  const seen = new Set<string>();
  for (const raw of drinks) {
    const b = drinkVector(raw, params);
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

function uniqueDishes(dishes: Iterable<DishInput>, params?: ParamsV2 | null): DishProfile[] {
  const out: DishProfile[] = [];
  const seen = new Set<string>();
  for (const raw of dishes) {
    const d = dishVector(raw, params);
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/** Таблица для этих блюд: переданная (если подходит) или новая; досчитывает недостающие строки. */
function ensureTable(dp: DishProfile[], drinks: DrinkProfile[], params: ParamsV2 | null | undefined,
  classics: ClassicsArg, opts: MenuOptimizerOptions): ScoreTable {
  const table = tableMatches(opts.table, dp) ? opts.table : newScoreTable(dp, params);
  fillScores(table, drinks, dp, params, classics, opts.ctx);
  return table;
}

function summary(scores: readonly (number | null)[]): { index: number | null; excellent: number; good: number; weak: number; none: number } {
  let sum = 0, n = 0, excellent = 0, good = 0, weak = 0, none = 0;
  for (const s of scores) {
    const lv = levelFor(s);
    if (lv === 'none') { none++; continue; }
    sum += s as number; n++;
    if (lv === 'excellent') excellent++; else if (lv === 'good') good++; else weak++;
  }
  // блюдо без единого напитка в карте считаем нулём в индексе — иначе пустая карта выглядела бы «без проблем»
  const total = n + none;
  return { index: total ? r1(sum / total) : null, excellent, good, weak, none };
}

/** Лучший по (−балл, id) — как сортировка движка; исключённые (-1) не участвуют. */
function argBest(ids: readonly string[], table: ScoreTable, j: number): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const id of ids) {
    const s = (table.rows.get(id) as Int16Array)[j];
    if (s < 0) continue;
    if (best === null || s > best.score || (s === best.score && id < best.id)) best = { id, score: s };
  }
  return best;
}

/**
 * Текущее состояние карты. dishes — блюда меню (в наличии), listDrinks — напитки карты (в наличии),
 * catalogPool — гостевой пул каталога (для «потолка» — лучшего возможного балла к блюду).
 */
export function analyzeMenu(dishes: Iterable<DishInput>, listDrinks: Iterable<DrinkInput>, catalogPool: Iterable<DrinkInput>,
  params?: ParamsV2 | null, classics?: ClassicsArg, opts: MenuOptimizerOptions = {}): MenuAnalysis {
  const dp = uniqueDishes(dishes, params);
  const list = uniqueProfiles(listDrinks, params);
  const pool = uniqueProfiles([...catalogPool, ...list], params);
  const table = ensureTable(dp, pool, params, classics, opts);
  const byId = new Map(pool.map(b => [b.id, b]));
  const listIds = list.map(b => b.id);
  const poolIds = pool.map(b => b.id);
  const ctx = opts.ctx ?? {};

  const states: DishState[] = [];
  const current: Record<string, number | null> = {};
  const bestIdByDish: (string | null)[] = [];
  for (let j = 0; j < dp.length; j++) {
    const d = dp[j];
    const best = argBest(listIds, table, j);
    const top = argBest(poolIds, table, j);
    let res: PairResult | null = null;
    if (best) res = scorePair(byId.get(best.id) as DrinkProfile, d, ctx, params, classics, true);
    const score = res ? res.score : null;
    current[d.id] = score;
    bestIdByDish.push(best ? best.id : null);
    states.push({
      dish_id: d.id, dish_name: d.name,
      drink_id: res ? res.drink_id : null, drink_name: res ? res.drink_name : null,
      score, band: res ? res.band : null, band_label: res ? res.band_label : null, level: levelFor(score),
      reason: mainReason(res),
      warning: mainWarning(res),
      ceiling: top ? { drink_id: top.id, drink_name: (byId.get(top.id) as DrinkProfile).name, score: top.score } : null,
    });
  }

  // лишние: ни для одного блюда не дают лучший балл карты (ничьи с лидером считаются «лучшим»)
  const redundant: RedundantDrink[] = [];
  for (const b of list) {
    const row = table.rows.get(b.id) as Int16Array;
    let used = false;
    let closest: { j: number; gap: number; score: number } | null = null;
    for (let j = 0; j < dp.length; j++) {
      const cur = current[dp[j].id];
      if (cur === null || row[j] < 0) continue;
      const gap = cur - row[j];
      if (gap <= 0) { used = true; break; }
      if (closest === null || gap < closest.gap || (gap === closest.gap && row[j] > closest.score)) closest = { j, gap, score: row[j] };
    }
    if (used || !dp.length) continue;
    redundant.push({
      drink_id: b.id, drink_name: b.name,
      closest_dish_id: closest ? dp[closest.j].id : null, closest_dish_name: closest ? dp[closest.j].name : null,
      score: closest ? closest.score : null, gap: closest ? closest.gap : null,
    });
  }
  redundant.sort((a, c) => (c.gap ?? 1e9) - (a.gap ?? 1e9) || (a.drink_id < c.drink_id ? -1 : a.drink_id > c.drink_id ? 1 : 0));

  states.sort((a, c) => (a.score ?? -1) - (c.score ?? -1) || a.dish_name.localeCompare(c.dish_name, 'ru'));
  const s = summary(dp.map(d => current[d.id]));
  return {
    dishes: states, index: s.index, excellent: s.excellent, good: s.good, weak: s.weak, none: s.none,
    excellent_share: dp.length ? s.excellent / dp.length : null,
    list_size: list.length, redundant, current,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// жадные предложения
// ─────────────────────────────────────────────────────────────────────────────

function availabilityRank(b: DrinkInput): number {
  const lvl = (b as { availability_kz?: { level?: string } | null }).availability_kz?.level ?? 'unknown';
  return AVAILABILITY_RANK[lvl] ?? AVAILABILITY_RANK['unknown'];
}

/**
 * До `steps` напитков, которые сильнее всего поднимают лучшие пары меню. Кандидаты — catalogPool без напитков карты
 * (listDrinks) и без opts.exclude (например, позиций карты в стоп-листе), в режиме efesOnly —
 * только портфель Efes. Шаг: argmax Σ_блюда max(0, балл кандидата − текущий лучший); равенство — больше блюд
 * улучшено, проще купить (availability_kz), id. Прирост меньше minGain — остановка (меньше шагов, чем просили).
 */
export function suggestDrinks(dishes: Iterable<DishInput>, listDrinks: Iterable<DrinkInput>, catalogPool: Iterable<DrinkInput>,
  params?: ParamsV2 | null, classics?: ClassicsArg, opts: SuggestOptions = {}): SuggestResult {
  const dp = uniqueDishes(dishes, params);
  const list = uniqueProfiles(listDrinks, params);
  const listIds = new Set(list.map(b => b.id));
  for (const id of opts.exclude ?? []) listIds.add(id);
  const catSet = opts.categories ? new Set(opts.categories) : null;
  const rawPool = [...catalogPool];
  const rawById = new Map<string, DrinkInput>();
  for (const raw of rawPool) { const b = drinkVector(raw, params); if (!rawById.has(b.id)) rawById.set(b.id, raw); }
  const cands = uniqueProfiles(rawPool, params).filter(b =>
    !listIds.has(b.id) && (!catSet || catSet.has(b.category)) && (!opts.efesOnly || isEfesRelation(b.efes_relation, params)));
  const table = ensureTable(dp, [...list, ...cands], params, classics, opts);
  const analysis = opts.analysis && opts.analysis.dishes.length === dp.length && dp.every(d => d.id in opts.analysis!.current)
    ? opts.analysis : analyzeMenu(dp, list, [], params, classics, { ...opts, table });

  const cur: (number | null)[] = dp.map(d => analysis.current[d.id]);
  const before = summary(cur);
  const steps: SuggestStep[] = [];
  const chosen = new Set<string>();
  const nSteps = Math.max(0, Math.floor(opts.steps ?? DEFAULT_STEPS));
  const minGain = Math.max(1, opts.minGain ?? DEFAULT_MIN_GAIN);
  const ctx = opts.ctx ?? {};

  for (let k = 0; k < nSteps; k++) {
    let pick: { b: DrinkProfile; gain: number; count: number; avail: number } | null = null;
    for (const b of cands) {
      if (chosen.has(b.id)) continue;
      const row = table.rows.get(b.id) as Int16Array;
      let gain = 0, count = 0;
      for (let j = 0; j < dp.length; j++) {
        if (row[j] < 0) continue;
        const d = row[j] - (cur[j] ?? 0);
        if (d > 0) { gain += d; count++; }
      }
      if (gain < minGain) continue;
      const avail = availabilityRank(rawById.get(b.id) ?? b);
      if (pick === null || gain > pick.gain
        || (gain === pick.gain && (count > pick.count
          || (count === pick.count && (avail < pick.avail || (avail === pick.avail && b.id < pick.b.id)))))) {
        pick = { b, gain, count, avail };
      }
    }
    if (!pick) break;
    chosen.add(pick.b.id);
    const row = table.rows.get(pick.b.id) as Int16Array;
    const improved: ImprovedDish[] = [];
    for (let j = 0; j < dp.length; j++) {
      if (row[j] < 0) continue;
      const prev = cur[j];
      if (row[j] > (prev ?? 0)) {
        improved.push({ dish_id: dp[j].id, dish_name: dp[j].name, before: prev, after: row[j], delta: row[j] - (prev ?? 0) });
        cur[j] = row[j];
      }
    }
    improved.sort((a, c) => c.delta - a.delta || c.after - a.after || a.dish_name.localeCompare(c.dish_name, 'ru'));
    const topDish = improved.length ? dp.find(d => d.id === improved[0].dish_id) ?? null : null;
    const reason = topDish ? mainReason(scorePair(pick.b, topDish, ctx, params, classics, true)) : null;
    const s = summary(cur);
    steps.push({
      drink_id: pick.b.id, drink_name: pick.b.name, category: pick.b.category, efes_relation: pick.b.efes_relation,
      efes: isEfesRelation(pick.b.efes_relation, params), gain: pick.gain, improved, reason,
      index_after: s.index, excellent_after: s.excellent, weak_after: s.weak,
    });
  }
  const after = summary(cur);
  return {
    mode: opts.efesOnly ? 'efes' : 'any', candidates: cands.length, steps,
    before: { index: before.index, excellent: before.excellent, weak: before.weak },
    after: { index: after.index, excellent: after.excellent, weak: after.weak },
  };
}
