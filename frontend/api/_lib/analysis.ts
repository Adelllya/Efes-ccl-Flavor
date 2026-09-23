/**
 * Всё, что пришло от модели, — непроверенные данные. Здесь они приводятся к строгим типам: enum — только из белых
 * списков, числа — конечные и в допустимых границах, id — только существующие в каталоге, строки — без управляющих
 * символов и с лимитом длины; всё, чего нет в схеме, отбрасывается. Модель не может передать движку ничего, кроме
 * описания блюда или напитка.
 *
 * Здесь же — профиль незнакомого напитка (режим «разобрать напиток»): приор стиля + то, что прочитано на этикетке,
 * + небольшие поправки ИИ; каждый шаг записывается в vector_notes (как в data/drinks.json).
 *
 * Зеркало на Python — backend/api/ai.py (normalize_interpretation, normalize_drink_analysis, estimate_drink, …).
 */
import { CATEGORIES, DRINK_AXES, clamp, fmt2, fmtNum, r1, r2, roundHalfUp } from '../../src/app/engine/pairing-engine-v2';
import type { AcidType, CookMethod, DishSpecV2, ProteinSource, Sauce, SpecFat, SpecTaste, SpecWeight } from '../../src/app/engine/custom-dish-v2';
import {
  ACID_TYPES, ADJUST_AXES, AROMA_TAGS, AXIS_RU, CIDER_SWEET, COOK_METHODS, CUISINES, DEFAULT_ARCHETYPE, DISH_TAGS, DRINK_KINDS,
  FATS, HOP_CATEGORIES, INTERPRET_KINDS, OCCASIONS, Occasion, PROTEIN_SOURCES, SAUCES, SOURCE_RU, SUGAR_CATEGORIES,
  SUGAR_CATEGORY_APPLIES, SUGAR_GL_SPARKLING, SUGAR_GL_STILL, SUGAR_LABELS, SWEET_KNOTS, SugarCategory, TASTES, WEIGHTS,
} from './prompts';

// ─────────────────────────────── проверка значений ───────────────────────────────

/** Пробелы в смысле JS \s — тот же класс явно перечислен в Python-зеркале. */
const WS = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/g;

/** Строка без управляющих символов и лишних пробелов, не длиннее max символов (кодовых точек, как в Python). */
export function cleanText(x: unknown, max: number): string {
  if (typeof x !== 'string') return '';
  const s = x.replace(CTRL, ' ').replace(WS, ' ').trim();
  const cps = Array.from(s);
  return cps.length > max ? cps.slice(0, max).join('').trim() : s;
}
export const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Конечное число (bool — не число), иначе null. */
export const finite = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const oneOf = <T extends string>(x: unknown, list: readonly T[], dflt: T): T => (typeof x === 'string' && (list as readonly string[]).includes(x) ? x as T : dflt);
const orNull = <T extends string>(x: unknown, list: readonly T[]): T | null => (typeof x === 'string' && (list as readonly string[]).includes(x) ? x as T : null);
/** 0..1, два знака (r2), не число → dflt. */
export const unit = (x: unknown, dflt = 0): number => { const v = finite(x); return v === null ? dflt : r2(clamp(v)); };

/** [{tag, weight}] → {tag: weight}: только теги из списка, вес 0..1 (r2), ниже 0.05 — отбрасывается, повтор — берётся больший. */
export function tagMap(x: unknown, allowed: readonly string[], max: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(x)) return out;
  for (const it of x) {
    if (!isObj(it) || typeof it['tag'] !== 'string' || !allowed.includes(it['tag'])) continue;
    const w = unit(it['weight'], -1);
    if (w < 0.05) continue;
    const t = it['tag'];
    if (Object.prototype.hasOwnProperty.call(out, t)) { if (w > out[t]) out[t] = w; continue; }
    if (Object.keys(out).length >= max) continue;
    out[t] = w;
  }
  return out;
}

function stringList(x: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const it of x) {
    const s = cleanText(it, maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

// ─────────────────────────────── фаза «понять блюдо» ───────────────────────────────

export interface DishIntent {
  name: string; matched_slug: string | null; taste: SpecTaste; weight: SpecWeight; fat: SpecFat; cook: CookMethod;
  protein: ProteinSource; sauce: Sauce; acid: AcidType; dessert: boolean; heat: number; tags: Record<string, number>;
  cuisine: string[]; confidence: number;
}
export interface Interpretation {
  kind: typeof INTERPRET_KINDS[number]; reply: string; dish: DishIntent | null;
  occasion: Occasion | null; bitter_pref: number; heat_lover: boolean;
}

export function normalizeDish(x: unknown, dishIds: ReadonlySet<string>): DishIntent | null {
  if (!isObj(x)) return null;
  const slug = typeof x['matched_slug'] === 'string' && dishIds.has(x['matched_slug']) ? x['matched_slug'] : null;
  const cuisine: string[] = [];
  if (Array.isArray(x['cuisine'])) {
    for (const c of x['cuisine']) if (typeof c === 'string' && (CUISINES as readonly string[]).includes(c) && !cuisine.includes(c) && cuisine.length < 2) cuisine.push(c);
  }
  return {
    name: cleanText(x['name'], 80),
    matched_slug: slug,
    taste: oneOf(x['taste'], TASTES, 'MIXED'),
    weight: oneOf(x['weight'], WEIGHTS, 'MEDIUM'),
    fat: oneOf(x['fat'], FATS, 'MEDIUM'),
    cook: oneOf(x['cook'], COOK_METHODS, 'boiled'),
    protein: oneOf(x['protein'], PROTEIN_SOURCES, 'none'),
    sauce: oneOf(x['sauce'], SAUCES, 'none'),
    acid: oneOf(x['acid'], ACID_TYPES, 'none'),
    dessert: x['dessert'] === true,
    heat: unit(x['heat']),
    tags: tagMap(x['tags'], DISH_TAGS, 8),
    cuisine,
    confidence: unit(x['confidence']),
  };
}

/** Ответ фазы «понять блюдо» → строгая структура. null — ответ не объект (модель вернула мусор). */
export function normalizeInterpretation(raw: unknown, dishIds: ReadonlySet<string>): Interpretation | null {
  if (!isObj(raw)) return null;
  let kind = oneOf(raw['kind'], INTERPRET_KINDS, 'clarify');
  const dish = normalizeDish(raw['dish'], dishIds);
  if (kind === 'dish' && !dish) kind = 'clarify';
  const bp = finite(raw['bitter_pref']);
  return {
    kind,
    reply: cleanText(raw['reply'], 600),
    dish,
    occasion: orNull(raw['occasion'], OCCASIONS),
    bitter_pref: bp === null ? 0 : r2(clamp(bp, -1, 1)),
    heat_lover: raw['heat_lover'] === true,
  };
}

/** Описание блюда → вход autofill (frontend/src/app/engine/custom-dish-v2.ts, backend/api/dish_autofill.py). */
export const dishSpec = (d: DishIntent, fallbackName: string): DishSpecV2 => ({
  name: d.name || fallbackName, taste: d.taste, weight: d.weight, fat: d.fat, cook: d.cook, protein: d.protein, sauce: d.sauce,
  acid: d.acid, dessert: d.dessert, heat: d.heat, tags: d.tags, cuisine: d.cuisine,
});

// ─────────────────────────────── фаза «разобрать напиток» ───────────────────────────────

export interface LabelRead { abv: number | null; ibu: number | null; sugar_category: SugarCategory | null; other: string[] }
export interface Adjustment { axis: string; delta: number; reason: string }
export interface AnalyzedDrink {
  matched_drink_id: string | null; name: string; producer: string | null; category: string; archetype: string;
  archetype_note: string; read: LabelRead; adjustments: Adjustment[]; aroma_tags: Record<string, number>;
  confidence: number; questions: string[];
}
export interface DrinkAnalysis { kind: typeof DRINK_KINDS[number]; reply: string; drink: AnalyzedDrink | null; with_dish: DishIntent | null }

interface CatalogIndex {
  drinkIds: ReadonlySet<string>; drinkCategory: (id: string) => string | null;
  archetypeCategory: (id: string) => string | null; archetypesOf: (category: string) => string[]; dishIds: ReadonlySet<string>;
}

/** Ответ фазы «разобрать напиток» → строгая структура. null — ответ не объект. */
export function normalizeDrinkAnalysis(raw: unknown, idx: CatalogIndex): DrinkAnalysis | null {
  if (!isObj(raw)) return null;
  let kind = oneOf(raw['kind'], DRINK_KINDS, 'clarify');
  const reply = cleanText(raw['reply'], 600);
  const wd = normalizeDish(raw['with_dish'], idx.dishIds);
  const withDish = wd && (wd.matched_slug || wd.name) ? wd : null;   // пустое описание блюда — как будто его нет
  const x = raw['drink'];
  if (!isObj(x)) return { kind: 'clarify', reply, drink: null, with_dish: withDish };
  const matched = typeof x['matched_drink_id'] === 'string' && idx.drinkIds.has(x['matched_drink_id']) ? x['matched_drink_id'] : null;
  let category: string = oneOf(x['category'], CATEGORIES, 'beer');
  if (matched) category = idx.drinkCategory(matched) ?? category;   // у каталожного напитка категория — из каталога
  let archetype = typeof x['archetype'] === 'string' ? x['archetype'] : '';
  let archetypeNote = '';
  const archCat = idx.archetypeCategory(archetype);
  if (archCat === null || archCat !== category) {
    const pool = idx.archetypesOf(category);
    const fallback = pool.includes(DEFAULT_ARCHETYPE[category] ?? '') ? DEFAULT_ARCHETYPE[category] : (pool[0] ?? '');
    archetypeNote = archCat === null
      ? `Стиль от ИИ не из списка стилей → взят типичный стиль категории ${category}.`
      : `Стиль ${archetype} относится к категории ${archCat}, а не ${category} → взят типичный стиль категории.`;
    archetype = fallback;
  }
  const lr = isObj(x['read_from_label']) ? x['read_from_label'] : {};
  const abv = finite(lr['abv']);
  const ibu = finite(lr['ibu']);
  const read: LabelRead = {
    abv: abv !== null && abv >= 0 && abv <= 80 ? r1(abv) : null,
    ibu: ibu !== null && ibu >= 0 && ibu <= 150 ? r1(ibu) : null,
    sugar_category: orNull(lr['sugar_category'], SUGAR_CATEGORIES),
    other: stringList(lr['other'], 6, 60),
  };
  const adjustments: Adjustment[] = [];
  if (Array.isArray(x['adjustments'])) {
    for (const it of x['adjustments']) {
      if (adjustments.length >= 6) break;
      if (!isObj(it) || typeof it['axis'] !== 'string' || !(ADJUST_AXES as readonly string[]).includes(it['axis'])) continue;
      if (adjustments.some(a => a.axis === it['axis'])) continue;
      const d = finite(it['delta']);
      if (d === null) continue;
      const delta = r2(clamp(d, -0.15, 0.15));
      if (delta === 0) continue;
      adjustments.push({ axis: it['axis'], delta, reason: cleanText(it['reason'], 100) });
    }
  }
  const drink: AnalyzedDrink = {
    matched_drink_id: matched,
    name: cleanText(x['name'], 80),
    producer: cleanText(x['producer'], 80) || null,
    category, archetype, archetype_note: archetypeNote, read, adjustments,
    aroma_tags: tagMap(x['aroma_tags'], AROMA_TAGS, 6),
    confidence: unit(x['confidence']),
    questions: stringList(x['questions'], 2, 120),
  };
  if (!archetype) kind = 'clarify';
  return { kind, reply, drink, with_dish: withDish };
}

// ─────────────────────────────── профиль незнакомого напитка ───────────────────────────────

export interface Prior {
  id: string; category: string; family?: string; label_ru?: string; abv?: number | null; ibu?: number | null;
  sensory?: Record<string, number>; aroma_tags?: Record<string, number>; origin_affinity?: string[]; anchor?: string;
  anchor_type?: string; serving?: { temp_min_c?: number | null; temp_max_c?: number | null; glass?: string } | null;
}
export interface Estimate {
  record: Record<string, unknown>; read: string[]; assumed: string[]; notes: string[]; confidence: number;
}

/** Сладость по г/л — кусочно-линейно по узлам ENGINE_V2_SPEC §2.1. */
export function sweetFromGl(gl: number): number {
  for (let i = 1; i < SWEET_KNOTS.length; i++) {
    const [x0, y0] = SWEET_KNOTS[i - 1];
    const [x1, y1] = SWEET_KNOTS[i];
    if (gl <= x1) return y0 + (y1 - y0) * (Math.max(gl, x0) - x0) / (x1 - x0);
  }
  return 1;
}

const pct = (x: number): string => String(roundHalfUp(x * 100));
const signed = (x: number): string => `${x >= 0 ? '+' : '−'}${fmt2(Math.abs(x))}`;

/** Что прочитано на этикетке — одинаково для каталожного и незнакомого напитка. */
function readLines(read: LabelRead, category: string): string[] {
  const out: string[] = [];
  if (read.abv !== null) out.push(`Крепость ${fmtNum(read.abv)} %`);
  if (read.ibu !== null && (HOP_CATEGORIES as readonly string[]).includes(category)) out.push(`Горечь ${fmtNum(read.ibu)} IBU`);
  if (read.sugar_category !== null && (SUGAR_CATEGORY_APPLIES as readonly string[]).includes(category)) out.push(`Сахар: ${SUGAR_LABELS[read.sugar_category]}`);
  for (const o of read.other) out.push(`«${o}»`);
  return out;
}

/**
 * Напиток не найден в каталоге → запись для движка: приор стиля (style_priors_v2) + якоря с этикетки
 * (ABV → alcohol; IBU → bitter = clamp((IBU−8)/62) для пива; сахар → sweet) + поправки ИИ (±0.15, после якорей,
 * к осям с этикетки не применяются). vector_source = "ai_estimate", уверенность не выше 0.45.
 */
export function estimateDrink(a: AnalyzedDrink, prior: Prior, fromImage: boolean, defaultServeTemp: number): Estimate {
  const notes: string[] = [];
  const assumed: string[] = [];
  const cat = a.category;
  const label = prior.label_ru || prior.id;
  const sens: Record<string, number> = {};
  for (const ax of DRINK_AXES) {
    const v = finite(prior.sensory?.[ax]);
    sens[ax] = v !== null ? v : (ax === 'serve_temp' ? defaultServeTemp : 0);
  }
  notes.push(`Стиль «${label}» (${prior.id}) определил ИИ по ${fromImage ? 'фото этикетки или меню' : 'названию'}; уверенность распознавания ${pct(a.confidence)} %.`);
  if (a.archetype_note) notes.push(a.archetype_note);
  notes.push(`Профиль начат с приора стиля: ${prior.anchor || 'оценка по категории'}.`);
  assumed.push(`Стиль «${label}» — определил ИИ`);

  const anchored = new Set<string>();
  let conf = 0.25;
  const parts = ['стиль от ИИ 0.25'];
  // крепость
  let abv: number;
  let abvSource: string;
  if (a.read.abv !== null) {
    abv = a.read.abv; abvSource = 'label'; conf += 0.1; parts.push('ABV с этикетки 0.10');
    notes.push(`ABV ${fmtNum(abv)} % — прочитано на этикетке → alcohol ${fmt2(clamp(abv / 40))}.`);
  } else {
    abv = finite(prior.abv) ?? 0; abvSource = 'estimate';
    notes.push(`ABV на этикетке не прочитан → ${fmtNum(abv)} % по стилю (оценка) → alcohol ${fmt2(clamp(abv / 40))}.`);
    assumed.push(`Крепость ${fmtNum(abv)} % — типичная для стиля`);
  }
  sens['alcohol'] = r2(clamp(abv / 40));
  // горечь
  const hop = (HOP_CATEGORIES as readonly string[]).includes(cat);
  let ibu: number | null = null;
  let ibuSource = 'none';
  let anchorBonus = false;
  if (a.read.ibu !== null && hop) {
    ibu = a.read.ibu; ibuSource = 'label'; anchorBonus = true;
    const before = sens['bitter'];
    sens['bitter'] = r2(clamp((ibu - 8) / 62));
    anchored.add('bitter');
    notes.push(`IBU ${fmtNum(ibu)} — прочитано на этикетке → bitter clamp((IBU−8)/62) = ${fmt2(sens['bitter'])} (по стилю было ${fmt2(before)}).`);
  } else if (a.read.ibu !== null) {
    notes.push(`IBU ${fmtNum(a.read.ibu)} на этикетке не пива — в профиль не идёт.`);
  } else if (hop) {
    const pIbu = finite(prior.ibu);
    ibuSource = pIbu !== null && prior.anchor_type === 'bjcp' ? 'bjcp_midpoint' : 'none';
    notes.push(`IBU не прочитан → bitter ${fmt2(sens['bitter'])} по стилю${pIbu !== null ? ` (IBU стиля ${fmtNum(pIbu)})` : ''}.`);
  }
  // сахар
  const sc = a.read.sugar_category;
  if (sc !== null && (SUGAR_CATEGORY_APPLIES as readonly string[]).includes(cat)) {
    const before = sens['sweet'];
    let how: string;
    if (cat === 'cider') { sens['sweet'] = CIDER_SWEET[sc]; how = 'шкала сидра BJCP'; }
    else {
      const gl = (cat === 'sparkling' ? SUGAR_GL_SPARKLING : SUGAR_GL_STILL)[sc];
      sens['sweet'] = r2(sweetFromGl(gl));
      how = `≈ ${fmtNum(gl)} г/л — середина диапазона`;
    }
    anchored.add('sweet'); anchorBonus = true;
    notes.push(`Сахар по этикетке «${SUGAR_LABELS[sc]}» (${how}) → sweet ${fmt2(sens['sweet'])} (по стилю было ${fmt2(before)}).`);
  } else if (sc !== null) {
    notes.push(`Сахар «${SUGAR_LABELS[sc]}» для категории ${cat} в профиль не идёт.`);
  }
  if (anchorBonus) { conf += 0.1; parts.push(anchored.has('bitter') ? 'IBU с этикетки 0.10' : 'сахар с этикетки 0.10'); }
  const fromStyle = ['горечь', 'сладость', 'кислотность', 'тело', 'газация']
    .filter(x => !(x === 'горечь' && anchored.has('bitter')) && !(x === 'сладость' && anchored.has('sweet'))).join(', ');
  assumed.push(`${fromStyle.charAt(0).toUpperCase()}${fromStyle.slice(1)} — типичные для стиля`);
  // поправки ИИ
  const applied: string[] = [];
  for (const adj of a.adjustments) {
    if (anchored.has(adj.axis)) { notes.push(`Поправка ИИ к ${adj.axis} отброшена: значение взято с этикетки.`); continue; }
    const before = sens[adj.axis];
    sens[adj.axis] = r2(clamp(before + adj.delta));
    notes.push(`Поправка ИИ: ${adj.axis} ${fmt2(before)} → ${fmt2(sens[adj.axis])} (${signed(adj.delta)})${adj.reason ? ` — ${adj.reason}` : ''}.`);
    applied.push(`${AXIS_RU[adj.axis]} ${signed(adj.delta)}`);
  }
  if (applied.length) assumed.push(`Поправки ИИ к стилю: ${applied.join(', ')}`);
  // аромат
  const tags: Record<string, number> = {};
  for (const [t, w] of Object.entries(prior.aroma_tags ?? {})) { const v = finite(w); if (v !== null) tags[t] = v; }
  const added: string[] = [];
  for (const [t, w] of Object.entries(a.aroma_tags)) {
    if ((tags[t] ?? 0) < w) { tags[t] = w; added.push(`${t} ${fmt2(w)}`); }
  }
  if (added.length) notes.push(`Аромат: к тегам стиля добавлено по оценке ИИ — ${added.join(', ')}.`);
  // уверенность
  const k = r2(0.6 + 0.4 * a.confidence);
  const confidence = r2(Math.min(0.45, conf * k));
  notes.push(`Уверенность ${fmt2(confidence)} = (${parts.join(' + ')}) × распознавание ${fmt2(k)}; у оценки ИИ потолок 0.45.`);
  assumed.push('Производитель, цена и наличие в Казахстане не проверены');

  const record: Record<string, unknown> = {
    id: 'ai-estimate', name: a.name || label, category: cat,
    style: { archetype: prior.id, family: prior.family ?? cat.toUpperCase(), name: label },
    producer: a.producer ? { name: a.producer } : null,
    efes_relation: 'none', abv, abv_source: abvSource, ibu, ibu_source: ibuSource,
    sensory: sens, aroma_tags: tags, origin_affinity: [...(prior.origin_affinity ?? [])], serving: prior.serving ?? null,
    flags: { non_alcoholic: abv <= 0.5 },
    vector_source: 'ai_estimate', vector_confidence: confidence, vector_notes: notes, status: 'ai_estimate',
  };
  return { record, read: readLines(a.read, cat), assumed, notes, confidence };
}

/** Напиток нашёлся в каталоге: профиль — каталожный; прочитанное на этикетке показываем, расхождение с каталогом — тоже. */
export function catalogReadAssumed(a: AnalyzedDrink, d: { abv?: number | null; abv_source?: string; vector_source?: string; vector_confidence?: number }): { read: string[]; assumed: string[] } {
  const read = readLines(a.read, a.category);
  const assumed: string[] = [];
  const src = SOURCE_RU[d.vector_source ?? ''] ?? 'по каталогу';
  assumed.push(`Профиль из каталога Flavor Tree: ${src}, надёжность ${pct(finite(d.vector_confidence) ?? 0)} %`);
  const cAbv = finite(d.abv);
  if (a.read.abv !== null && cAbv !== null && Math.abs(a.read.abv - cAbv) >= 0.3) {
    read.push(`В каталоге крепость ${fmtNum(cAbv)} % — для подбора взят каталог`);
  } else if (a.read.abv === null && cAbv !== null && d.abv_source === 'estimate') {
    assumed.push(`Крепость ${fmtNum(cAbv)} % — оценка каталога`);
  }
  return { read, assumed };
}
