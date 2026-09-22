/**
 * Flavor Tree Pairing Engine v1.0 — TypeScript-порт backend/api/pairing/engine.py.
 *
 * Алгоритм ДОЛЖЕН совпадать с Python 1-в-1 (порядок операций, константы, округления):
 * паритет проверяется `npm run test:engine` по data/golden_scores.json.
 * Не добавляйте здесь правила без зеркального изменения в Python и регенерации golden.
 *
 * Пиво → вектор из 10 осей (пирамида × интенсивность поверх приора стиля, ABV).
 * Блюдо → вектор из 13 осей (data/dishes.json).
 * score = 30 + 0.9 · Σ(правила), ограничено [3, 99]. Каждое правило объяснимо словами.
 */

export const BEER_AXES = ['bitter', 'body', 'malt_sweet', 'carbonation', 'hop_aroma',
  'roast', 'alcohol', 'caramel', 'fruit', 'clean'] as const;
export const DISH_AXES = ['salt', 'sweet', 'sour', 'bitter', 'umami', 'heat', 'fat',
  'weight', 'smoke', 'maillard', 'fresh', 'cream', 'spice'] as const;

export type BeerAxis = typeof BEER_AXES[number];
export type DishAxis = typeof DISH_AXES[number];
export type BeerVector = Record<BeerAxis, number>;
export type DishVector = Record<DishAxis, number>;
export type PairingType = 'COMPLEMENT' | 'CONTRAST' | 'CLEANSE' | 'BRIDGE';
export type Family = PairingType | 'CONTEXT';
export type Occasion = 'hot' | 'evening' | 'party' | 'gourmet';
export type Rating = 'love' | 'like' | 'meh' | 'dislike';

export const PAIRING_TYPES: PairingType[] = ['COMPLEMENT', 'CONTRAST', 'CLEANSE', 'BRIDGE'];
export const SCORE_BASE = 30.0;
export const SCORE_K = 0.9;

export const TYPE_LABELS: Record<PairingType, string> = {
  COMPLEMENT: 'Complement · дополнение',
  CONTRAST: 'Contrast · контраст',
  CLEANSE: 'Cleanse · очищение',
  BRIDGE: 'Bridge · мост',
};

export const BEER_AXIS_LABELS: Record<BeerAxis, string> = {
  bitter: 'Горечь', body: 'Тело', malt_sweet: 'Солод', carbonation: 'Пузырьки', hop_aroma: 'Хмель',
  roast: 'Обжарка', alcohol: 'Крепость', caramel: 'Карамель', fruit: 'Фрукты', clean: 'Чистота',
};
export const DISH_AXIS_LABELS: Record<DishAxis, string> = {
  salt: 'Соль', sweet: 'Сладость', sour: 'Кислота', bitter: 'Горечь', umami: 'Умами', heat: 'Острота',
  fat: 'Жирность', weight: 'Вес', smoke: 'Дым', maillard: 'Корочка', fresh: 'Свежесть', cream: 'Сливочность', spice: 'Пряности',
};

export interface EngineNote { id: string; name: string; category: 'TOP' | 'HEART' | 'BASE'; icon: string; axes: Partial<Record<BeerAxis, number>>; tags: string[]; }
export interface PyramidEntry { layer: 'TOP' | 'HEART' | 'BASE'; note_id: string; intensity: number; sommelier_note?: string; }
export interface EngineBrand {
  id: string; name: string; display_name?: string; style_family?: string; abv?: number | null;
  pyramid?: PyramidEntry[]; vector_override?: Partial<Record<BeerAxis, number>>;
}
export interface EngineDish {
  id: string; name: string; display_name?: string; vector?: Partial<Record<DishAxis, number>>;
  tags?: string[] | Record<string, number>;
}
export interface BeerProfile<B extends EngineBrand = EngineBrand> {
  id: string; name: string; vector: BeerVector; tags: Record<string, number>; intensity: number; confidence: number; brand: B;
}
export interface DishProfile<D extends EngineDish = EngineDish> {
  id: string; name: string; vector: DishVector; tags: Record<string, number>; intensity: number; dish: D;
}
export interface CuratedPair { brand_id: string; dish_id: string; score: number; type: PairingType; explanation: string; }
export interface Contribution { rule: string; points: number; family: Family; text: string; tags?: string[]; curated_score?: number; }
export interface PairContext { occasion?: Occasion | null; bitter_pref?: number; dna?: BeerVector | null; }
export interface PairResult {
  beer_id: string; dish_id: string; score: number; verdict: string; match_type: PairingType; match_label: string;
  contributions: Contribution[]; reasons: Contribution[]; warnings: Contribution[];
  sommelier_pick: boolean; curated: CuratedPair | null; intensity: { beer: number; dish: number }; confidence: number;
}
export interface Archetype { id: string; name: string; emoji: string; tagline: string; vector: BeerVector; }

export const ARCHETYPES: Archetype[] = [
  { id: 'hop-explorer', name: 'Хмелевой исследователь', emoji: '🌿', tagline: 'Любишь, когда горечь звучит ярко и долго.',
    vector: { bitter: .85, body: .5, malt_sweet: .3, carbonation: .6, hop_aroma: .9, roast: .1, alcohol: .45, caramel: .1, fruit: .3, clean: .25 } },
  { id: 'malt-classic', name: 'Солодовый классик', emoji: '🌾', tagline: 'Хлеб, зерно, мягкое тело — вкус, которому доверяешь.',
    vector: { bitter: .45, body: .65, malt_sweet: .75, carbonation: .5, hop_aroma: .35, roast: .15, alcohol: .35, caramel: .4, fruit: .1, clean: .35 } },
  { id: 'crisp-minimalist', name: 'Освежающий минималист', emoji: '❄️', tagline: 'Чисто, холодно, легко — пиво как глоток воздуха.',
    vector: { bitter: .3, body: .25, malt_sweet: .3, carbonation: .85, hop_aroma: .3, roast: .0, alcohol: .25, caramel: .05, fruit: .15, clean: .9 } },
  { id: 'bold-philosopher', name: 'Крепкий философ', emoji: '🔥', tagline: 'Плотное тело и тепло — вечер должен быть насыщенным.',
    vector: { bitter: .6, body: .85, malt_sweet: .55, carbonation: .4, hop_aroma: .4, roast: .25, alcohol: .85, caramel: .4, fruit: .15, clean: .15 } },
  { id: 'amber-gourmet', name: 'Янтарный гурман', emoji: '🍯', tagline: 'Карамель, тоффи, корочка — вкус с историей.',
    vector: { bitter: .4, body: .6, malt_sweet: .65, carbonation: .5, hop_aroma: .3, roast: .3, alcohol: .4, caramel: .85, fruit: .15, clean: .2 } },
];

export const TAG_LABELS: Record<string, string> = {
  bread: 'хлеб', grain: 'зерно', caramel: 'карамель', toffee: 'тоффи', honey: 'мёд', herbs: 'травы',
  pine: 'хвоя', grass: 'трава', floral: 'цветы', citrus: 'цитрус', lime: 'лайм', lemon: 'лимон',
  apple: 'яблоко', pear: 'груша', banana: 'банан', fruit: 'фрукты', rice: 'рис', coffee: 'кофе',
  toast: 'тост', roast: 'обжарка', chocolate: 'шоколад', cocoa: 'какао', fresh: 'свежесть', fizz: 'пузырьки',
  warmth: 'тепло', smoke: 'дым', corn: 'кукуруза', sweet: 'сладость', cheese: 'сыр', dairy: 'молочное',
  sour: 'кислинка', garlic: 'чеснок', pepper: 'перец', onion: 'лук', cumin: 'зира', cinnamon: 'корица',
  butter: 'масло', cream: 'сливки',
};

// ── helpers ───────────────────────────────────────────────────────────────────
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const r2 = (x: number): number => Math.floor(x * 100 + 0.5) / 100; // = Python _r2

export function cosine(a: Record<string, number>, b: Record<string, number>, axes: readonly string[]): number {
  let dot = 0, na = 0, nb = 0;
  for (const k of axes) {
    const x = a[k] ?? 0, y = b[k] ?? 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function emptyBeer(): BeerVector {
  return { bitter: 0, body: 0, malt_sweet: 0, carbonation: 0, hop_aroma: 0, roast: 0, alcohol: 0, caramel: 0, fruit: 0, clean: 0 };
}

// ── profiles ──────────────────────────────────────────────────────────────────
export function buildBeerProfile<B extends EngineBrand>(brand: B, notesById: Record<string, EngineNote>,
  priors: Record<string, Partial<BeerVector>>): BeerProfile<B> {
  const prior = priors[brand.style_family || 'LAGER'] || priors['LAGER'] || {};
  const contribs: Record<BeerAxis, number[]> = { bitter: [], body: [], malt_sweet: [], carbonation: [], hop_aroma: [], roast: [], alcohol: [], caramel: [], fruit: [], clean: [] };
  const tags: Record<string, number> = {};
  const layers = new Set<string>();
  let nNotes = 0;
  for (const p of brand.pyramid || []) {
    const note = notesById[p.note_id];
    if (!note) continue;
    nNotes += 1;
    layers.add(p.layer);
    const w = clamp(p.intensity / 10.0, 0, 1);
    for (const [axis, k] of Object.entries(note.axes || {})) {
      if (axis in contribs) contribs[axis as BeerAxis].push(w * (k as number));
    }
    for (const t of note.tags || []) tags[t] = Math.max(tags[t] ?? 0, w);
  }
  const vec = emptyBeer();
  for (const a of BEER_AXES) {
    const cs = contribs[a];
    let combined = 0;
    if (cs.length) {
      const mx = Math.max(...cs);
      const sum = cs.reduce((s, x) => s + x, 0);
      combined = clamp(mx + 0.35 * (sum - mx), 0, 1);
    }
    const p0 = prior[a] ?? 0;
    vec[a] = clamp(p0 + (1.0 - p0) * combined, 0, 1);
  }
  const abv = Number(brand.abv ?? 4.5) || 4.5;
  vec.alcohol = Math.max(vec.alcohol, clamp((abv - 3.5) / 5.0, 0, 1));
  vec.body = clamp(vec.body + Math.max(0, abv - 5.0) * 0.08, 0, 1);
  for (const [a, v] of Object.entries(brand.vector_override || {})) {
    if (a in vec) vec[a as BeerAxis] = clamp(Number(v), 0, 1);
  }
  const confidence = Math.min(1, nNotes / 5.0) * (layers.size / 3.0);
  for (const a of BEER_AXES) vec[a] = r2(vec[a]);
  const rtags: Record<string, number> = {};
  for (const [k, v] of Object.entries(tags)) rtags[k] = r2(v);
  return { id: brand.id, name: brand.display_name || brand.name, vector: vec, tags: rtags,
    intensity: r2(intensityBeer(vec)), confidence: r2(confidence), brand };
}

export function buildDishProfile<D extends EngineDish>(dish: D): DishProfile<D> {
  const vec = {} as DishVector;
  for (const a of DISH_AXES) vec[a] = Number((dish.vector || {})[a] ?? 0);
  const raw = dish.tags || [];
  const tags: Record<string, number> = {};
  if (Array.isArray(raw)) for (const t of raw) tags[t] = 1.0;
  else for (const [k, v] of Object.entries(raw)) tags[k] = Number(v);
  return { id: dish.id, name: dish.display_name || dish.name, vector: vec, tags, intensity: r2(intensityDish(vec)), dish };
}

export function intensityDish(d: DishVector): number {
  return clamp(0.30 * d.weight + 0.22 * d.fat + 0.15 * d.heat + 0.10 * d.umami + 0.08 * d.smoke + 0.05 * d.salt + 0.10 * d.sweet, 0, 1);
}
export function intensityBeer(b: BeerVector): number {
  return clamp(0.30 * b.body + 0.25 * b.bitter + 0.20 * b.alcohol + 0.15 * b.roast + 0.10 * b.malt_sweet, 0, 1);
}

// ── rules ─────────────────────────────────────────────────────────────────────
const C = (rule: string, points: number, family: Family, text: string): Contribution => ({ rule, points: r2(points), family, text });

function ruleIntensity(b: BeerVector, d: DishVector): Contribution {
  const ib = intensityBeer(b), id = intensityDish(d);
  const diff = Math.abs(ib - id);
  const pts = clamp(22.0 - 60.0 * diff, -15.0, 22.0);
  let text: string;
  if (diff < 0.12) text = 'Интенсивность пива и блюда совпадают — никто никого не перекрикивает';
  else if (ib > id) text = diff > 0.3 ? 'Пиво мощнее блюда: рискует заглушить его вкус' : 'Пиво чуть плотнее блюда — ведёт в паре';
  else text = diff > 0.3 ? 'Блюдо мощнее пива: напиток потеряется на его фоне' : 'Блюдо чуть ярче пива — пиво играет роль фона';
  return C('intensity', pts, 'COMPLEMENT', text);
}

function ruleCut(b: BeerVector, d: DishVector): Contribution | null {
  const richness = Math.max(d.fat, 0.6 * d.weight, 0.8 * d.cream);
  if (richness < 0.3) return null;
  const bit = 0.55 * b.bitter, carb = 0.45 * b.carbonation;
  const pts = 20.0 * richness * (bit + carb);
  if (bit >= carb) return C('cut', pts, 'CONTRAST', 'Хмелевая горечь «режет» жирность и обновляет рецепторы');
  return C('cut', pts, 'CLEANSE', 'Карбонизация смывает жир с языка — каждый глоток как первый');
}

function ruleHeat(b: BeerVector, d: DishVector): Contribution | null {
  const heat = d.heat;
  if (heat < 0.15) return null;
  const soothe = 14.0 * b.malt_sweet + 8.0 * b.carbonation + 6.0 * b.clean;
  const amplify = 16.0 * Math.max(0, b.bitter - 0.4) + 14.0 * Math.max(0, b.alcohol - 0.45);
  const pts = clamp(heat * (soothe - amplify), -15.0, 20.0);
  if (pts >= 0) return C('heat', pts, 'CLEANSE', 'Солодовая мягкость и пузырьки гасят остроту, не споря с ней');
  return C('heat', pts, 'CLEANSE', 'Хмель и алкоголь усиливают жжение перца — пара будет «горячее», чем хочется');
}

function ruleSalt(b: BeerVector, d: DishVector): Contribution | null {
  const salt = d.salt;
  if (salt < 0.35) return null;
  let pts = salt * (6.0 * b.carbonation + 5.0 * b.malt_sweet + 3.0 * b.bitter);
  if (salt >= 0.7 && d.weight <= 0.45) {
    pts += 6.0 * b.carbonation + 3.0 * b.clean;
    return C('salt', pts, 'COMPLEMENT', 'Солёная закуска — классика к пиву: соль будит жажду, пузырьки её утоляют');
  }
  return C('salt', pts, 'COMPLEMENT', 'Соль смягчает горечь и подчёркивает солодовую сладость');
}

function ruleSweet(b: BeerVector, d: DishVector): Contribution | null {
  const sweet = d.sweet;
  if (sweet < 0.3) return null;
  let pts = sweet * (18.0 * b.malt_sweet + 10.0 * b.caramel + 6.0 * b.roast - 22.0 * Math.max(0, b.bitter - b.malt_sweet));
  pts = clamp(pts, -18.0, 25.0);
  if (pts >= 0) return C('sweet', pts, 'COMPLEMENT', 'Солодовая сладость держит уровень десерта — пиво не кажется горьким');
  return C('sweet', pts, 'COMPLEMENT', 'Десерт слаще пива: на его фоне пиво покажется резким и водянистым');
}

function ruleSour(b: BeerVector, d: DishVector): Contribution | null {
  const sour = d.sour;
  if (sour < 0.3) return null;
  let pts = sour * (10.0 * b.carbonation + 6.0 * b.clean - 8.0 * b.roast - 6.0 * Math.max(0, b.body - 0.6) - 4.0 * Math.max(0, b.malt_sweet - 0.6));
  pts = clamp(pts, -10.0, 14.0);
  if (pts >= 0) return C('sour', pts, 'CLEANSE', 'Кислинка блюда и игристая чистота пива освежают друг друга');
  return C('sour', pts, 'CLEANSE', 'Плотное сладковатое пиво спорит с кислотой блюда');
}

function ruleUmami(b: BeerVector, d: DishVector): Contribution | null {
  const um = d.umami;
  if (um < 0.3) return null;
  let pts = um * (10.0 * b.malt_sweet + 6.0 * b.body + 4.0 * b.roast - 8.0 * Math.max(0, b.bitter - 0.6) * (1.0 - d.fat));
  pts = clamp(pts, -6.0, 16.0);
  if (pts >= 0) return C('umami', pts, 'COMPLEMENT', 'Умами мяса/бульона отзеркаливается солодовым телом пива');
  return C('umami', pts, 'COMPLEMENT', 'Сильный хмель на деликатном умами даёт металлический привкус');
}

function ruleFresh(b: BeerVector, d: DishVector): Contribution | null {
  const fr = d.fresh;
  if (fr < 0.3) return null;
  let pts = fr * (8.0 * b.clean + 6.0 * b.carbonation + 3.0 * b.hop_aroma - 10.0 * b.roast - 8.0 * Math.max(0, b.alcohol - 0.5) - 6.0 * Math.max(0, b.body - 0.55));
  pts = clamp(pts, -12.0, 14.0);
  if (pts >= 0) return C('fresh', pts, 'CLEANSE', 'Лёгкое чистое пиво не перебивает свежесть и деликатность блюда');
  return C('fresh', pts, 'CLEANSE', 'Тяжёлое или крепкое пиво давит деликатное блюдо');
}

function ruleRoast(b: BeerVector, d: DishVector): Contribution[] {
  const out: Contribution[] = [];
  const crust = Math.max(d.maillard, d.smoke);
  if (crust >= 0.3) {
    const pts = 12.0 * crust * Math.max(b.caramel, b.roast, 0.7 * b.malt_sweet);
    out.push(C('roast', pts, 'COMPLEMENT', 'Корочка и карамелизация блюда перекликаются с солодом и карамелью пива'));
  }
  if (d.smoke >= 0.3) {
    out.push(C('smoke', 6.0 * d.smoke * b.hop_aroma, 'BRIDGE', 'Смолистый хмель вторит дымку гриля'));
  }
  return out;
}

function ruleBridge(bt: Record<string, number>, dt: Record<string, number>): Contribution | null {
  const shared: [string, number][] = [];
  for (const t of Object.keys(bt)) if (t in dt) shared.push([t, Math.min(bt[t], dt[t])]);
  if (!shared.length) return null;
  const total = shared.reduce((s, [, w]) => s + w, 0);
  const pts = clamp(12.0 * total, 0, 18.0);
  shared.sort((a, b) => b[1] - a[1]);
  const names = shared.slice(0, 3).map(([t]) => TAG_LABELS[t] ?? t).join(', ');
  const c = C('bridge', pts, 'BRIDGE', `Общие ароматы — ${names} — строят «мост» между пивом и блюдом`);
  c.tags = shared.slice(0, 3).map(([t]) => t);
  return c;
}

function ruleCurated(curated: CuratedPair | null | undefined): Contribution | null {
  if (!curated) return null;
  const pts = ((curated.score ?? 3) - 3) * 8.0;
  const c = C('curated', pts, curated.type || 'COMPLEMENT', curated.explanation || 'Вердикт сомелье');
  c.curated_score = curated.score ?? 3;
  return c;
}

function ruleContext(b: BeerVector, ctx: PairContext): Contribution[] {
  const out: Contribution[] = [];
  const occ = ctx.occasion;
  if (occ === 'hot') out.push(C('occasion', 8.0 * b.carbonation + 4.0 * b.clean - 6.0 * b.alcohol, 'CONTEXT', 'Жаркий день: ценим свежесть и лёгкость'));
  else if (occ === 'evening') out.push(C('occasion', 6.0 * b.body + 4.0 * b.alcohol + 2.0 * b.caramel, 'CONTEXT', 'Вечер: плотное тело и тепло звучат уместнее'));
  else if (occ === 'party') out.push(C('occasion', 5.0 * b.clean + 3.0 * b.carbonation - 5.0 * b.alcohol, 'CONTEXT', 'Компания: питкое пиво, которое не утомляет'));
  else if (occ === 'gourmet') out.push(C('occasion', 4.0 * b.hop_aroma + 4.0 * b.caramel + 2.0 * b.body, 'CONTEXT', 'Гастро-вечер: чем сложнее ароматика, тем интереснее'));
  const pref = Number(ctx.bitter_pref || 0);
  if (pref !== 0) {
    const pts = clamp(16.0 * pref * (b.bitter - 0.5), -8.0, 8.0);
    out.push(C('bitter_pref', pts, 'CONTEXT', pref > 0 ? 'Ты любишь горечь — плюс к хмелевым сортам' : 'Ты избегаешь горечи — минус хмелевым сортам'));
  }
  return out;
}

function ruleDna(b: BeerVector, dna: BeerVector | null | undefined): Contribution | null {
  if (!dna) return null;
  const cos = cosine(b, dna, BEER_AXES);
  const pts = clamp(40.0 * (cos - 0.85), -8.0, 8.0);
  return C('dna', pts, 'CONTEXT', pts >= 0 ? 'Совпадает с твоим Flavor DNA' : 'Далеко от твоего Flavor DNA');
}

// ── scoring ───────────────────────────────────────────────────────────────────
export function verdictLabel(score: number): string {
  if (score >= 85) return 'Идеальная пара';
  if (score >= 72) return 'Отличное сочетание';
  if (score >= 60) return 'Хорошая пара';
  if (score >= 48) return 'Нейтрально';
  return 'Не рекомендуем';
}

export function scorePair(beer: BeerProfile, dish: DishProfile, context?: PairContext | null, curated?: CuratedPair | null): PairResult {
  const ctx = context || {};
  const b = beer.vector, d = dish.vector;
  const contribs: Contribution[] = [ruleIntensity(b, d)];
  for (const c of [ruleCut(b, d), ruleHeat(b, d), ruleSalt(b, d), ruleSweet(b, d), ruleSour(b, d), ruleUmami(b, d), ruleFresh(b, d)]) if (c) contribs.push(c);
  contribs.push(...ruleRoast(b, d));
  const br = ruleBridge(beer.tags, dish.tags); if (br) contribs.push(br);
  const cu = ruleCurated(curated); if (cu) contribs.push(cu);
  contribs.push(...ruleContext(b, ctx));
  const dn = ruleDna(b, ctx.dna); if (dn) contribs.push(dn);

  const total = contribs.reduce((s, c) => s + c.points, 0);
  const score = Math.trunc(clamp(Math.floor(SCORE_BASE + SCORE_K * total + 0.5), 3, 99));

  let matchType: PairingType;
  if (curated && PAIRING_TYPES.includes(curated.type)) {
    matchType = curated.type;
  } else {
    let best: Contribution | null = null;
    for (const c of contribs) {
      if (c.rule === 'intensity' || c.family === 'CONTEXT' || !PAIRING_TYPES.includes(c.family as PairingType)) continue;
      if (c.points > 0 && (best === null || c.points > best.points)) best = c;
    }
    matchType = best ? (best.family as PairingType) : 'COMPLEMENT';
  }
  const reasons = contribs.filter(c => c.points > 0.5).sort((x, y) => y.points - x.points).slice(0, 3);
  const warnings = contribs.filter(c => c.points < -0.5).sort((x, y) => x.points - y.points).slice(0, 2);
  return {
    beer_id: beer.id, dish_id: dish.id, score, verdict: verdictLabel(score),
    match_type: matchType, match_label: TYPE_LABELS[matchType],
    contributions: contribs, reasons, warnings,
    sommelier_pick: !!(curated && (curated.score ?? 0) >= 4), curated: curated ?? null,
    intensity: { beer: r2(intensityBeer(b)), dish: r2(intensityDish(d)) },
    confidence: beer.confidence ?? 1,
  };
}

export const curatedKey = (brandId: string, dishId: string): string => `${brandId}|${dishId}`;
export function indexCurated(pairs: CuratedPair[]): Record<string, CuratedPair> {
  const idx: Record<string, CuratedPair> = {};
  for (const p of pairs) idx[curatedKey(p.brand_id, p.dish_id)] = p;
  return idx;
}

const byScoreThenBeer = (a: PairResult, b: PairResult) => b.score - a.score || (a.beer_id < b.beer_id ? -1 : a.beer_id > b.beer_id ? 1 : 0);
const byScoreThenDish = (a: PairResult, b: PairResult) => b.score - a.score || (a.dish_id < b.dish_id ? -1 : a.dish_id > b.dish_id ? 1 : 0);

export function recommendBeers(dish: DishProfile, beers: BeerProfile[], curatedIndex: Record<string, CuratedPair>,
  context?: PairContext | null, limit = 5, availableIds?: Iterable<string> | null, diversify = false): PairResult[] {
  const allowed = availableIds ? new Set(availableIds) : null;
  const results: PairResult[] = [];
  const families: Record<string, string> = {};
  for (const beer of beers) {
    if (allowed && !allowed.has(beer.id)) continue;
    results.push(scorePair(beer, dish, context, curatedIndex[curatedKey(beer.id, dish.id)]));
    families[beer.id] = (beer.brand?.style_family as string) || 'LAGER';
  }
  results.sort(byScoreThenBeer);
  if (!limit) return results;
  if (!diversify) return results.slice(0, limit);
  const picked: PairResult[] = [], rest: PairResult[] = [];
  const counts: Record<string, number> = {};
  for (const r of results) {
    const fam = families[r.beer_id];
    if (picked.length < limit && (counts[fam] ?? 0) < 2) { picked.push(r); counts[fam] = (counts[fam] ?? 0) + 1; }
    else rest.push(r);
  }
  for (const r of rest) { if (picked.length >= limit) break; picked.push(r); }
  picked.sort(byScoreThenBeer);
  return picked;
}

export function recommendDishes(beer: BeerProfile, dishes: DishProfile[], curatedIndex: Record<string, CuratedPair>,
  context?: PairContext | null, limit = 6): PairResult[] {
  const results = dishes.map(d => scorePair(beer, d, context, curatedIndex[curatedKey(beer.id, d.id)]));
  results.sort(byScoreThenDish);
  return limit ? results.slice(0, limit) : results;
}

export function similarBeers(beer: BeerProfile, beers: BeerProfile[], limit = 3): { beer_id: string; similarity: number }[] {
  const out = beers.filter(o => o.id !== beer.id).map(o => ({ beer_id: o.id, similarity: r2(cosine(beer.vector, o.vector, BEER_AXES)) }));
  out.sort((a, b) => b.similarity - a.similarity || (a.beer_id < b.beer_id ? -1 : 1));
  return out.slice(0, limit);
}

// ── Flavor DNA ────────────────────────────────────────────────────────────────
export const RATING_WEIGHTS: Record<Rating, number> = { love: 2.0, like: 1.0, meh: 0.0, dislike: -1.0 };

export function dnaVector(rated: { vector: BeerVector; rating: Rating }[]): BeerVector | null {
  const acc = emptyBeer();
  let wsum = 0;
  for (const r of rated) {
    const w = RATING_WEIGHTS[r.rating] ?? 0;
    if (w === 0) continue;
    for (const a of BEER_AXES) acc[a] += w * (r.vector[a] ?? 0);
    wsum += Math.abs(w);
  }
  if (wsum === 0) return null;
  const vec = emptyBeer();
  for (const a of BEER_AXES) vec[a] = r2(clamp(acc[a] / wsum, 0, 1));
  return vec;
}

export function dnaArchetype(vec: BeerVector): Archetype & { similarity: number } {
  let best: { s: number; a: Archetype } | null = null;
  for (const a of ARCHETYPES) {
    const s = cosine(vec, a.vector, BEER_AXES);
    if (best === null || s > best.s) best = { s, a };
  }
  return { ...best!.a, similarity: r2(best!.s) };
}
