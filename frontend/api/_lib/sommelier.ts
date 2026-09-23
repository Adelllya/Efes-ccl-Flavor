/**
 * ИИ-сомелье Flavor Tree v2 — серверный пайплайн (Vercel Function / любой Node).
 *
 *   режим «блюдо» (ask | vision):  вопрос или фото → Claude описывает блюдо (строгий JSON)
 *                                   → движок v2 считает напитки (recommend, фильтр заведения, политика Efes)
 *                                   → Claude объясняет результат словами сомелье
 *   режим «напиток» (drink):        название, строка меню или фото этикетки → Claude определяет напиток (строгий JSON)
 *                                   → каталожная запись или оценка по этикетке (приор стиля + этикетка + поправки ИИ)
 *                                   → движок v2: лучшие блюда (reverse) и, если гость назвал блюдо, оценка пары
 *                                   → Claude объясняет
 *
 * Модель никогда не выбирает напитки и блюда и не ставит оценки — она переводит гостя на язык движка и обратно.
 * Язык ответа — поле locale ('ru' | 'kk' | 'en', по умолчанию 'ru'): указание языка уходит модели последним
 * system-блоком, ПОСЛЕ кэшируемых, поэтому кэш промпта общий для всех языков.
 * Все вызовы — claude-opus-5 с серверным откатом при отказе классификаторов (fallbacks: "default").
 * Зеркало на Python: backend/api/ai.py (тот же контракт, те же промпты).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  Ctx, DishProfile, PairResult, clamp, dishVector, fmt2, isEfesRelation, r2, recommend, reverse, roundHalfUp, scorePair,
} from '../../src/app/engine/pairing-engine-v2';
import { customDishRecord } from '../../src/app/engine/custom-dish-v2';
import * as C from './catalog';
import * as A from './analysis';
import * as T from './prompts';
import type { Locale, Occasion } from './prompts';

export type { Locale, Occasion } from './prompts';
export const MODEL = 'claude-opus-5';
/** Серверный откат: если классификаторы claude-opus-5 откажут, API сам повторит запрос на рекомендованной модели. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const MAX_IMAGE_B64 = 5 * 1024 * 1024;   // base64 ~ 3.7 МБ картинки; клиент ужимает до ~1024px
export const MAX_TURNS = 8;
export const MAX_TURN_CHARS = 2000;
export const TOP_PICKS = 3;
export const TOP_DISHES = 5;
const MODES = ['ask', 'vision', 'drink'] as const;
const LOCALES: readonly Locale[] = ['ru', 'kk', 'en'];

// ─────────────────────────────── типы контракта ───────────────────────────────

export type Mode = typeof MODES[number];
export interface ChatTurn { role: 'user' | 'assistant'; content: string; }
export interface VenueCtx { slug: string; name?: string; beers?: string[] | null; prices?: Record<string, number>; volumes?: Record<string, string>; currency?: string; }
export interface SommelierInput {
  mode: Mode;
  messages?: ChatTurn[];
  image?: { media_type: string; data: string } | null;
  venue?: VenueCtx | null;
  occasion?: string | null;
  bitter_pref?: number | null;
  sweet_pref?: number | null;
  heat_lover?: boolean | null;
  harsh_tol?: string | null;
  non_alcoholic?: boolean | null;
  /** Flavor DNA в осях v2 (R17.dna.axes); вектор v1 отбрасывается */
  dna?: Record<string, number> | null;
  locale?: string;   // язык гостя; нет поля или неизвестное значение → 'ru'
}
export interface Note { text: string; evidence: string; }
export interface Pick {
  drink_id: string; beer_id: string; name: string; category: string; category_label: string; style: string; archetype: string | null;
  abv: number; score: number; band: string; band_label: string; match_type: string; match_label: string; secondary_type: string | null;
  why: string; reasons: Note[]; warnings: Note[]; classic: boolean; efes_partner: boolean;
  price: number | null; volume: string | null; image: string | null;
}
export interface DishPick {
  dish_id: string; name: string; emoji: string; score: number; band: string; band_label: string; match_type: string; match_label: string;
  secondary_type: string | null; why: string; reasons: Note[]; warnings: Note[]; classic: boolean; route: string;
}
export interface DishOut {
  name: string; slug: string | null; emoji: string; confidence: number; vector: Record<string, number>;
  spec: { taste: string; weight: string; fat: string; cook: string; protein: string; sauce: string; acid: string; dessert: boolean; heat: number; tags: Record<string, number>; cuisine: string[] };
}
export interface DrinkOut {
  id: string | null; name: string; producer: string | null; category: string; category_label: string; style: string;
  archetype: string | null; family: string | null; abv: number | null; ibu: number | null;
  sensory: Record<string, number>; aroma_tags: Record<string, number>;
  serving: { temp_min_c: number | null; temp_max_c: number | null; glass: string | null } | null;
  estimated: boolean; vector_source: string | null; vector_confidence: number | null; recognition_confidence: number;
  what_was_read: string[]; what_was_assumed: string[]; vector_notes: string[];
  efes_relation: string; efes_partner: boolean; image: string | null;
}
export interface Usage { input: number; output: number; cache_read: number; cache_write: number; calls: number; fallbacks: number; }
export interface SommelierOutput {
  ok: true; engine: 'v2'; kind: 'picks' | 'clarify' | 'chat' | 'drink'; reply: string;
  dish: DishOut | null; picks: Pick[]; best_partner: Pick | null;
  drink: DrinkOut | null; dishes: DishPick[]; pair: DishPick | null; questions: string[];
  route: string | null; occasion: Occasion | null; locale: Locale; usage: Usage;
}

// ─────────────────────────────── вход: язык, история, фото, заведение, предпочтения ───────────────────────────────

/** Язык гостя из запроса: 'kk' и 'en' как есть, всё остальное (и отсутствие поля) → 'ru'. */
export const resolveLocale = (x: unknown): Locale => (x === 'kk' || x === 'en' ? x : 'ru');
export const isMode = (x: unknown): x is Mode => typeof x === 'string' && (MODES as readonly string[]).includes(x);

/** Последние 8 реплик (роль user|assistant, непустой текст ≤ 2000 символов); история начинается с реплики гостя. */
export function cleanHistory(raw: unknown): ChatTurn[] {
  const turns: ChatTurn[] = [];
  if (Array.isArray(raw)) {
    for (const m of raw) {
      if (!A.isObj(m) || (m['role'] !== 'user' && m['role'] !== 'assistant') || typeof m['content'] !== 'string') continue;
      const content = m['content'].trim();
      if (content) turns.push({ role: m['role'], content: Array.from(content).slice(0, MAX_TURN_CHARS).join('') });
    }
  }
  const last = turns.slice(-MAX_TURNS);
  while (last.length && last[0].role !== 'user') last.shift();
  return last;
}

function checkImage(x: unknown): { media_type: string; data: string } | null {
  if (x === null || x === undefined) return null;
  if (!A.isObj(x) || typeof x['data'] !== 'string' || !x['data']) throw new SommelierError(400, 'Нет изображения');
  if (x['data'].length > MAX_IMAGE_B64) throw new SommelierError(413, 'Фото слишком большое');
  const mt = typeof x['media_type'] === 'string' ? x['media_type'] : 'image/jpeg';
  if (!(T.MEDIA_TYPES as readonly string[]).includes(mt)) throw new SommelierError(400, 'Фото должно быть JPEG, PNG, WebP или GIF');
  return { media_type: mt, data: x['data'] };
}

/** Заведение из запроса: только ожидаемые поля и типы. beers — сорта заведения (slug v1 или id v2). */
export function normalizeVenue(v: unknown): VenueCtx | null {
  if (!A.isObj(v)) return null;
  const beers = Array.isArray(v['beers']) ? v['beers'].filter((s): s is string => typeof s === 'string' && !!s).slice(0, 300) : null;
  const prices: Record<string, number> = {};
  if (A.isObj(v['prices'])) {
    for (const [k, p] of Object.entries(v['prices']).slice(0, 300)) { const n = A.finite(p); if (n !== null && n >= 0) prices[k] = n; }
  }
  const volumes: Record<string, string> = {};
  if (A.isObj(v['volumes'])) {
    for (const [k, s] of Object.entries(v['volumes']).slice(0, 300)) { const t = A.cleanText(s, 20); if (t) volumes[k] = t; }
  }
  return { slug: A.cleanText(v['slug'], 80), name: A.cleanText(v['name'], 80), beers, prices, volumes, currency: A.cleanText(v['currency'], 8) || '₸' };
}

/**
 * Сорта заведения → id напитков v2: совпадение по id или по legacy_brand_id (slug бренда v1 в карте заведения).
 * null — фильтра нет (сортов не передали); [] — в карте нет ни одного напитка каталога. Как PairingV2Service.venueDrinkIds.
 */
export function venueIdsFrom(beers: readonly string[] | null | undefined, drinks: ReadonlyArray<{ id: string; legacy_brand_id?: string | null }>): string[] | null {
  if (!beers?.length) return null;
  const set = new Set(beers);
  return drinks.filter(d => set.has(d.id) || (!!d.legacy_brand_id && set.has(d.legacy_brand_id))).map(d => d.id);
}
const venueDrinkIds = (venue: VenueCtx | null): string[] | null => venueIdsFrom(venue?.beers, C.DRINKS);

/** Цена / объём из карты заведения: ключ — id напитка v2 или slug бренда v1. */
export function venueValue<T>(map: Record<string, T> | null | undefined, drinkId: string, legacy: string | null | undefined): T | null {
  if (!map) return null;
  if (Object.prototype.hasOwnProperty.call(map, drinkId)) return map[drinkId];
  if (legacy && Object.prototype.hasOwnProperty.call(map, legacy)) return map[legacy];
  return null;
}

interface Prefs {
  occasion: Occasion | null; bitter_pref: number; sweet_pref: number; heat_lover: boolean;
  harsh_tol: string | null; non_alcoholic: boolean; dna: Record<string, number> | null;
}

const pref = (x: unknown): number => { const v = A.finite(x); return v === null ? 0 : r2(clamp(v, -1, 1)); };

/** Flavor DNA гостя в осях v2; вектор v1 (malt_sweet, hop_aroma…) и неполный вектор отбрасываются. */
function cleanDna(x: unknown): Record<string, number> | null {
  if (!A.isObj(x)) return null;
  const axes = C.P.R17.dna.axes;
  const keys = Object.keys(x);
  if (keys.length < 3 || keys.some(k => !axes.includes(k))) return null;
  const out: Record<string, number> = {};
  for (const k of keys) { const v = A.finite(x[k]); if (v === null) return null; out[k] = r2(clamp(v)); }
  return out;
}

function prefsOf(input: SommelierInput): Prefs {
  const occ = input.occasion;
  return {
    occasion: typeof occ === 'string' && (T.OCCASIONS as readonly string[]).includes(occ) ? occ as Occasion : null,
    bitter_pref: pref(input.bitter_pref),
    sweet_pref: pref(input.sweet_pref),
    heat_lover: input.heat_lover === true,
    harsh_tol: typeof input.harsh_tol === 'string' && (T.HARSH_TOL as readonly string[]).includes(input.harsh_tol) ? input.harsh_tol : null,
    non_alcoholic: input.non_alcoholic === true,
    dna: cleanDna(input.dna),
  };
}

/** Контекст движка: запрос гостя важнее того, что модель услышала в его словах. */
function engineCtx(p: Prefs, occasion: Occasion | null, bitterHeard: number, heatLoverHeard: boolean, drinkMode = false): Ctx {
  const ctx: Ctx = {};
  if (occasion && !(drinkMode && occasion === 'non_alcoholic')) ctx.occasion = occasion;
  const bp = p.bitter_pref !== 0 ? p.bitter_pref : bitterHeard;
  if (bp !== 0) ctx.bitter_pref = bp;
  if (p.sweet_pref !== 0) ctx.sweet_pref = p.sweet_pref;
  if (p.heat_lover || heatLoverHeard) ctx.heat_lover = true;
  if (p.harsh_tol) ctx.harsh_tol = p.harsh_tol as Ctx['harsh_tol'];
  if (p.non_alcoholic && !drinkMode) ctx.non_alcoholic = true;
  if (p.dna) ctx.dna = p.dna;
  return ctx;
}

interface Turn {
  mode: Mode; history: ChatTurn[]; lastUser: string; image: { media_type: string; data: string } | null;
  venue: VenueCtx | null; prefs: Prefs; locale: Locale; usage: Usage;
}

// ─────────────────────────────── вызов модели ───────────────────────────────

/** Кэшируемые блоки идут первыми и байт-в-байт одинаковы для всех языков; указание языка — последним блоком, за точкой кэша. */
const systemBlocks = (stable: string[], volatile: string): BetaTextBlockParam[] => [
  ...stable.map(text => ({ type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } })),
  ...(volatile ? [{ type: 'text' as const, text: volatile }] : []),
];

function buildMessages(t: Turn, imagePrompt: string): BetaMessageParam[] {
  const messages: BetaMessageParam[] = t.image
    ? [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: t.image.media_type as 'image/jpeg', data: t.image.data } },
        { type: 'text', text: t.lastUser || imagePrompt },
      ] }]
    : t.history.map(m => ({ role: m.role, content: m.content }));
  const note = [
    t.venue?.name ? `Гость находится в заведении «${t.venue.name}».` : '',
    t.prefs.occasion ? `Повод уже выбран гостем: ${t.prefs.occasion}.` : '',
  ].filter(Boolean).join(' ');
  if (note) messages.push({ role: 'user', content: `(контекст: ${note})` });
  return messages;
}

interface ModelReply { text: string; refused: boolean; truncated: boolean }

/** Текст ответа: блоки text после последнего блока fallback (до него — прерванная попытка отказавшей модели). */
export function textOf(res: { content?: ReadonlyArray<{ type: string; text?: string }> | null }): string {
  const blocks = res.content ?? [];
  let start = 0;
  blocks.forEach((b, i) => { if (b.type === 'fallback') start = i + 1; });
  return blocks.slice(start).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
}

async function callModel(client: Anthropic, t: Turn, p: { system: BetaTextBlockParam[]; messages: BetaMessageParam[]; maxTokens: number; effort: 'low' | 'medium'; schema?: Record<string, unknown> }): Promise<ModelReply> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: p.maxTokens,
    thinking: { type: 'adaptive' },
    system: p.system,
    messages: p.messages,
    output_config: p.schema ? { effort: p.effort, format: { type: 'json_schema', schema: p.schema } } : { effort: p.effort },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  });
  const u = res.usage;
  t.usage.calls++;
  t.usage.input += u?.input_tokens ?? 0;
  t.usage.output += u?.output_tokens ?? 0;
  t.usage.cache_read += u?.cache_read_input_tokens ?? 0;
  t.usage.cache_write += u?.cache_creation_input_tokens ?? 0;
  if ((u?.iterations ?? []).some(x => x.type === 'fallback_message')) t.usage.fallbacks++;
  // отказ проверяем до чтения content: при отказе он пуст или содержит обрывок
  return { text: res.stop_reason === 'refusal' ? '' : textOf(res), refused: res.stop_reason === 'refusal', truncated: res.stop_reason === 'max_tokens' };
}

const unreadable = () => new SommelierError(502, 'ИИ вернул неразборчивый ответ, попробуйте ещё раз');

function parseJson(r: ModelReply): unknown {
  if (r.truncated) throw unreadable();
  try { return JSON.parse(r.text); } catch { throw unreadable(); }
}

// ─────────────────────────────── ответ ───────────────────────────────

function out(t: Turn, o: Partial<SommelierOutput> & Pick2<SommelierOutput, 'kind' | 'reply'>): SommelierOutput {
  return {
    ok: true, engine: 'v2', kind: o.kind, reply: o.reply, dish: o.dish ?? null, picks: o.picks ?? [], best_partner: o.best_partner ?? null,
    drink: o.drink ?? null, dishes: o.dishes ?? [], pair: o.pair ?? null, questions: o.questions ?? [],
    route: o.route ?? null, occasion: o.occasion ?? null, locale: t.locale, usage: t.usage,
  };
}
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

const refusal = (t: Turn) => out(t, { kind: 'chat', reply: T.TEXTS[t.locale].refusal });
const notes = (xs: ReadonlyArray<{ text: string; evidence: string }>): Note[] => xs.map(c => ({ text: c.text, evidence: c.evidence }));
/** «Почему» одной строкой: сильнейший механизм пары (как тип пары у движка: cut / complement / contrast / bridge,
 *  без R1, R13, R20), иначе первая причина, иначе подпись оценки. Повод и личные предпочтения сюда не попадают. */
function whyOf(r: PairResult): string {
  let best: PairResult['mechanisms'][number] | null = null;
  for (const c of r.mechanisms) {
    if (c.points > 0 && WHY_FAMILIES.includes(c.family) && !WHY_SKIP.includes(c.rule) && (best === null || c.points > best.points)) best = c;
  }
  return best?.text || r.reasons[0]?.text || r.band_label;
}
const WHY_FAMILIES: readonly string[] = ['cut', 'complement', 'contrast', 'bridge'];
const WHY_SKIP: readonly string[] = ['R1', 'R13', 'R20'];
const bandLabel = (r: PairResult, l: Locale): string => (l === 'ru' ? r.band_label : T.BAND_LABELS[l][r.band] ?? r.band_label);
const categoryLabel = (cat: string, l: Locale): string => T.CATEGORY_LABELS[l][cat] ?? cat;
const matchLabel = (type: string, l: Locale): string => T.MATCH_LABELS[l][type] ?? type;
const styleLabel = (archetype: string | null | undefined, fallback: string | null | undefined): string =>
  (archetype ? C.ARCHETYPE_BY_ID.get(archetype)?.label_ru : undefined) || fallback || '';

function toPick(r: PairResult, t: Turn): Pick {
  const raw = C.DRINK_BY_ID.get(r.drink_id);
  return {
    drink_id: r.drink_id, beer_id: r.drink_id, name: raw?.name ?? r.drink_name,
    category: r.category, category_label: categoryLabel(r.category, t.locale), style: styleLabel(r.archetype, raw?.style?.name),
    archetype: r.archetype, abv: r.abv, score: r.score, band: r.band, band_label: bandLabel(r, t.locale),
    match_type: r.match_type, match_label: matchLabel(r.match_type, t.locale), secondary_type: r.secondary_type,
    why: whyOf(r), reasons: notes(r.reasons), warnings: notes(r.warnings), classic: r.classic, efes_partner: r.efes_partner,
    price: venueValue(t.venue?.prices, r.drink_id, raw?.legacy_brand_id), volume: venueValue(t.venue?.volumes, r.drink_id, raw?.legacy_brand_id),
    image: raw?.image ?? null,
  };
}

function toDishPick(r: PairResult, l: Locale, route: string | null = null): DishPick {
  const raw = C.DISH_BY_ID.get(r.dish_id);
  return {
    dish_id: r.dish_id, name: raw?.name ?? r.dish_name, emoji: raw?.emoji ?? '🍽️', score: r.score, band: r.band,
    band_label: bandLabel(r, l), match_type: r.match_type, match_label: matchLabel(r.match_type, l), secondary_type: r.secondary_type,
    why: whyOf(r), reasons: notes(r.reasons), warnings: notes(r.warnings), classic: r.classic, route: route ?? `/pair/${r.dish_id}`,
  };
}

/** Своё блюдо → /pair/custom: параметры мастера v1 (taste, weight, fat, cooking, heat) + поля v2 (cook, protein, sauce, acid, dessert, tags). */
export function customRoute(d: A.DishIntent, name: string, occasion: Occasion | null): string {
  const q: [string, string][] = [
    ['name', name], ['taste', d.taste], ['weight', d.weight], ['fat', d.fat], ['cooking', T.COOK_TO_V1[d.cook]],
    ['heat', String(roundHalfUp(d.heat * 100))], ['cook', d.cook], ['protein', d.protein], ['sauce', d.sauce], ['acid', d.acid],
    ['dessert', d.dessert ? '1' : '0'],
  ];
  const tags = Object.entries(d.tags).map(([k, w]) => `${k}:${fmt2(w)}`).join(',');
  if (tags) q.push(['tags', tags]);
  if (occasion) q.push(['occasion', occasion]);
  return `/pair/custom?${new URLSearchParams(q).toString()}`;
}

// ─────────────────────────────── объяснение (фаза 3) ───────────────────────────────

interface TextUnit { id: string; why: string; reasons: string[]; warnings: string[] }
const textUnit = (id: string, p: { why: string; reasons: Note[]; warnings: Note[] }): TextUnit =>
  ({ id, why: p.why, reasons: p.reasons.map(n => n.text), warnings: p.warnings.map(n => n.text) });

/**
 * Разбор JSON-объяснения (kk/en). Модель переводит только тексты: выбор, порядок, оценки и цены остаются от движка.
 * items = null при любом расхождении — другой набор или порядок id, другое число причин/предупреждений, пустые строки;
 * notes = null, если строк не столько же или есть пустые. Исключений наружу не бросает.
 */
export function parseNarration(text: string, units: TextUnit[], noteLines: string[]): { reply: string; items: TextUnit[] | null; notes: string[] | null } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { reply: '', items: null, notes: null }; }
  if (!A.isObj(data)) return { reply: '', items: null, notes: null };
  const str = (x: unknown): x is string => typeof x === 'string' && !!x.trim();
  const list = (x: unknown, n: number): x is string[] => Array.isArray(x) && x.length === n && x.every(str);
  const raw = Array.isArray(data['items']) ? data['items'] as unknown[] : [];
  const ok = raw.length === units.length && raw.every((it, i) => A.isObj(it) && it['id'] === units[i].id && str(it['why'])
    && list(it['reasons'], units[i].reasons.length) && list(it['warnings'], units[i].warnings.length));
  const items = ok ? (raw as Record<string, unknown>[]).map(it => ({
    id: it['id'] as string, why: (it['why'] as string).trim(),
    reasons: (it['reasons'] as string[]).map(s => s.trim()), warnings: (it['warnings'] as string[]).map(s => s.trim()),
  })) : null;
  const notesOk = list(data['notes'], noteLines.length);
  return { reply: str(data['reply']) ? A.cleanText(data['reply'], 1500) : '', items, notes: notesOk ? (data['notes'] as string[]).map(s => s.trim()) : null };
}

function withTexts<P extends { why: string; reasons: Note[]; warnings: Note[] }>(p: P, u: TextUnit): P {
  return { ...p, why: u.why, reasons: p.reasons.map((n, i) => ({ ...n, text: u.reasons[i] })), warnings: p.warnings.map((n, i) => ({ ...n, text: u.warnings[i] })) };
}

async function narrate(client: Anthropic, t: Turn, brief: Record<string, unknown>, units: TextUnit[], noteLines: string[]): Promise<{ reply: string; items: TextUnit[] | null; notes: string[] | null }> {
  const translate = t.locale !== 'ru';   // kk/en: тем же вызовом получаем и перевод человекочитаемых строк
  const body = translate ? { ...brief, translate: { items: units, notes: noteLines } } : brief;
  const res = await callModel(client, t, {
    system: systemBlocks([T.SYSTEM_NARRATE], T.langNarrate(t.locale)),
    messages: [{ role: 'user', content: JSON.stringify(body) }],
    maxTokens: translate ? 4096 : 2048,
    effort: 'low',
    schema: translate ? T.NARRATE_SCHEMA : undefined,
  });
  // отказ или обрыв → объяснения нет, остаются фраза первой фазы и русские тексты движка; запрос не падает
  if (res.refused || res.truncated) return { reply: '', items: null, notes: null };
  if (!translate) return { reply: A.cleanText(res.text, 1500), items: null, notes: null };
  return parseNarration(res.text, units, noteLines);
}

const briefNotes = (xs: Note[]) => xs.map(n => ({ text: n.text, evidence: n.evidence }));

// ─────────────────────────────── пайплайн ───────────────────────────────

export async function runSommelier(input: SommelierInput, client: Anthropic = new Anthropic()): Promise<SommelierOutput> {
  if (!isMode(input.mode)) throw new SommelierError(400, 'mode должен быть ask, vision или drink');
  const history = cleanHistory(input.messages);
  const lastUser = [...history].reverse().find(m => m.role === 'user')?.content || '';
  const image = input.mode === 'ask' ? null : checkImage(input.image);
  if (input.mode === 'vision' && !image) throw new SommelierError(400, 'Нет изображения');
  if (input.mode === 'ask' && !lastUser) throw new SommelierError(400, 'Пустой вопрос');
  if (input.mode === 'drink' && !image && !lastUser) throw new SommelierError(400, 'Нет названия или фото напитка');
  const t: Turn = {
    mode: input.mode, history, lastUser, image, venue: normalizeVenue(input.venue), prefs: prefsOf(input),
    locale: resolveLocale(input.locale), usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0, fallbacks: 0 },
  };
  return input.mode === 'drink' ? runDrink(client, t) : runDish(client, t);
}

const DISH_IDS: ReadonlySet<string> = new Set(C.DISH_BY_ID.keys());
const INDEX = {
  drinkIds: new Set(C.DRINK_BY_ID.keys()) as ReadonlySet<string>,
  drinkCategory: (id: string) => C.DRINK_BY_ID.get(id)?.category ?? null,
  archetypeCategory: (id: string) => C.ARCHETYPE_BY_ID.get(id)?.category ?? null,
  archetypesOf: (cat: string) => C.ARCHETYPES.filter(a => a.category === cat).map(a => a.id),
  dishIds: DISH_IDS,
};

/** Режим «блюдо»: понять блюдо → движок → объяснить. */
async function runDish(client: Anthropic, t: Turn): Promise<SommelierOutput> {
  const first = await callModel(client, t, {
    system: systemBlocks([C.SYSTEM_CONTEXT, T.SYSTEM_INTERPRET], T.langInterpret(t.locale)),
    messages: buildMessages(t, T.IMAGE_PROMPT_DISH),
    maxTokens: 4096,
    effort: t.image ? 'medium' : 'low',
    schema: T.INTERPRET_SCHEMA,
  });
  if (first.refused) return refusal(t);
  const intent = A.normalizeInterpretation(parseJson(first), DISH_IDS);
  if (!intent) throw unreadable();
  if (intent.kind === 'drink') return runDrink(client, t);   // «что поесть под Kozel?» — та же реплика гостя, режим «напиток»
  if (intent.kind !== 'dish' || !intent.dish) {
    return out(t, { kind: intent.kind === 'chat' ? 'chat' : 'clarify', reply: intent.reply || T.TEXTS[t.locale].clarify, occasion: intent.occasion });
  }

  // ── фаза 2: движок v2 ──
  const d = intent.dish;
  const occasion = t.prefs.occasion ?? intent.occasion;
  const ctx = engineCtx(t.prefs, occasion, intent.bitter_pref, intent.heat_lover);
  const matched = d.matched_slug ? C.DISH_BY_ID.get(d.matched_slug) : undefined;
  const dishName = matched ? matched.name : (d.name || 'Ваше блюдо');
  const profile: DishProfile = matched ? C.DISH_PROFILE_BY_ID.get(matched.id)! : dishVector(customDishRecord(A.dishSpec(d, dishName)), C.P);
  const rec = recommend(profile, C.GUEST_POOL, ctx, TOP_PICKS, C.P, C.CLASSICS, null, venueDrinkIds(t.venue));
  let picks = rec.items.map(r => toPick(r, t));
  const bp = rec.best_partner;
  let bestPartner = bp && !rec.items.some(r => r.drink_id === bp.drink_id) ? toPick(bp, t) : null;
  const dish: DishOut = {
    name: dishName, slug: matched ? matched.id : null, emoji: matched?.emoji ?? '🍽️', confidence: d.confidence, vector: { ...profile.v },
    spec: { taste: d.taste, weight: d.weight, fat: d.fat, cook: d.cook, protein: d.protein, sauce: d.sauce, acid: d.acid, dessert: d.dessert, heat: d.heat, tags: { ...d.tags }, cuisine: [...d.cuisine] },
  };
  const route = matched ? `/pair/${matched.id}${occasion ? `?occasion=${occasion}` : ''}` : customRoute(d, dishName, occasion);

  // ── фаза 3: объяснить словами сомелье ──
  let reply = intent.reply;
  if (picks.length) {
    const units = [...picks, ...(bestPartner ? [bestPartner] : [])].map(p => textUnit(p.drink_id, p));
    const brief = {
      mode: 'dish', guest_said: t.lastUser || T.PHOTO_DISH,
      dish: { name: dishName, in_catalog: !!matched, recognized_as: intent.reply },
      occasion, venue: t.venue?.name || null, currency: t.venue?.currency || '₸',
      picks: rec.items.map((r, i) => ({
        rank: i + 1, name: picks[i].name, category: categoryLabel(r.category, 'ru'), style: picks[i].style, abv: r.abv, score: r.score,
        band: r.band_label, match: matchLabel(r.match_type, 'ru'), reasons: briefNotes(picks[i].reasons), warnings: briefNotes(picks[i].warnings),
        classic: r.classic, price: picks[i].price, volume: picks[i].volume,
      })),
    };
    const n = await narrate(client, t, brief, units, []);
    if (n.reply) reply = n.reply;
    if (n.items) {
      picks = picks.map((p, i) => withTexts(p, n.items![i]));
      if (bestPartner) bestPartner = withTexts(bestPartner, n.items[picks.length]);
    }
  } else {
    reply = `${intent.reply} ${T.TEXTS[t.locale].noPicks}`.trim();
  }
  return out(t, { kind: 'picks', reply, dish, picks, best_partner: bestPartner, route, occasion });
}

const pickServing = (s: { temp_min_c?: number | null; temp_max_c?: number | null; glass?: string | null } | null | undefined): DrinkOut['serving'] =>
  (s ? { temp_min_c: A.finite(s.temp_min_c), temp_max_c: A.finite(s.temp_max_c), glass: typeof s.glass === 'string' && s.glass ? s.glass : null } : null);
const numMap = (x: unknown): Record<string, number> => {
  const o: Record<string, number> = {};
  if (A.isObj(x)) for (const [k, v] of Object.entries(x)) { const n = A.finite(v); if (n !== null) o[k] = n; }
  return o;
};

/** Режим «напиток»: определить напиток → запись каталога или оценка по этикетке → лучшие блюда → объяснить. */
async function runDrink(client: Anthropic, t: Turn): Promise<SommelierOutput> {
  const res = await callModel(client, t, {
    system: systemBlocks([C.SYSTEM_CONTEXT, C.SYSTEM_DRINK], T.langDrink(t.locale)),
    messages: buildMessages(t, T.IMAGE_PROMPT_DRINK),
    maxTokens: 4096,
    effort: t.image ? 'medium' : 'low',
    schema: C.DRINK_SCHEMA,
  });
  if (res.refused) return refusal(t);
  const an = A.normalizeDrinkAnalysis(parseJson(res), INDEX);
  if (!an) throw unreadable();
  if (an.kind !== 'drink' || !an.drink) {
    return out(t, { kind: 'clarify', reply: an.reply || T.TEXTS[t.locale].clarifyDrink, questions: an.drink?.questions ?? [] });
  }
  const a = an.drink;
  const l = t.locale;
  let record: Record<string, unknown> | ReturnType<typeof C.drinkProfile>;
  let drink: DrinkOut;
  if (a.matched_drink_id) {
    const raw = C.DRINK_BY_ID.get(a.matched_drink_id)!;
    const ra = A.catalogReadAssumed(a, raw);
    record = C.drinkProfile(raw.id)!;
    drink = {
      id: raw.id, name: raw.name, producer: raw.producer?.name || null, category: raw.category, category_label: categoryLabel(raw.category, l),
      style: styleLabel(raw.style?.archetype, raw.style?.name), archetype: raw.style?.archetype ?? null, family: raw.style?.family ?? null,
      abv: A.finite(raw.abv), ibu: A.finite(raw.ibu), sensory: numMap(raw.sensory), aroma_tags: numMap(raw.aroma_tags), serving: pickServing(raw.serving),
      estimated: false, vector_source: raw.vector_source ?? null, vector_confidence: A.finite(raw.vector_confidence), recognition_confidence: a.confidence,
      what_was_read: ra.read, what_was_assumed: ra.assumed, vector_notes: [],
      efes_relation: raw.efes_relation || 'none', efes_partner: isEfesRelation(raw.efes_relation, C.P), image: raw.image ?? null,
    };
  } else {
    const prior = C.ARCHETYPE_BY_ID.get(a.archetype)!;
    const est = A.estimateDrink(a, prior, !!t.image, C.P.axes.drink_default_serve_temp);
    record = est.record;
    const rec = est.record as { name: string; abv: number; ibu: number | null; sensory: Record<string, number>; aroma_tags: Record<string, number> };
    drink = {
      id: null, name: rec.name, producer: a.producer, category: a.category, category_label: categoryLabel(a.category, l),
      style: prior.label_ru || prior.id, archetype: prior.id, family: prior.family ?? null, abv: rec.abv, ibu: rec.ibu,
      sensory: { ...rec.sensory }, aroma_tags: { ...rec.aroma_tags }, serving: pickServing(prior.serving),
      estimated: true, vector_source: 'ai_estimate', vector_confidence: est.confidence, recognition_confidence: a.confidence,
      what_was_read: est.read, what_was_assumed: est.assumed, vector_notes: est.notes,
      efes_relation: 'none', efes_partner: false, image: null,
    };
  }

  // ── движок v2: лучшие блюда к напитку и, если гость назвал блюдо, оценка этой пары ──
  const ctx = engineCtx(t.prefs, t.prefs.occasion, 0, false, true);
  const drinkInput = record as Parameters<typeof reverse>[0];
  const rev = reverse(drinkInput, C.DISH_PROFILES, ctx, TOP_DISHES, C.P, C.CLASSICS);
  let dishes = rev.items.map(r => toDishPick(r, l));
  let pair: DishPick | null = null;
  if (an.with_dish) {
    const wd = an.with_dish;
    const m = wd.matched_slug ? C.DISH_PROFILE_BY_ID.get(wd.matched_slug) : undefined;
    const name = m ? C.DISH_BY_ID.get(m.id)!.name : (wd.name || 'Ваше блюдо');
    const dp = m ?? dishVector(customDishRecord(A.dishSpec(wd, name)), C.P);
    pair = { ...toDishPick(scorePair(drinkInput, dp, ctx, C.P, C.CLASSICS), l, m ? null : customRoute(wd, name, null)), name };
  }

  // ── объяснить ──
  let reply = an.reply;
  const noteLines = [...drink.what_was_read, ...drink.what_was_assumed];
  if (dishes.length) {
    const units = [...dishes, ...(pair ? [pair] : [])].map(p => textUnit(p.dish_id, p));
    const brief = {
      mode: 'drink', guest_said: t.lastUser || T.PHOTO_DRINK, recognized_as: an.reply,
      drink: {
        name: drink.name, producer: drink.producer, category: categoryLabel(drink.category, 'ru'), style: drink.style, abv: drink.abv,
        estimated: drink.estimated, profile_confidence: drink.vector_confidence, read: drink.what_was_read, assumed: drink.what_was_assumed,
      },
      dishes: rev.items.map((r, i) => ({
        rank: i + 1, name: dishes[i].name, score: r.score, band: r.band_label, match: matchLabel(r.match_type, 'ru'),
        reasons: briefNotes(dishes[i].reasons), warnings: briefNotes(dishes[i].warnings), classic: r.classic,
      })),
      with_dish: pair ? { name: pair.name, score: pair.score, match: matchLabel(pair.match_type, 'ru'), reasons: briefNotes(pair.reasons), warnings: briefNotes(pair.warnings) } : null,
    };
    const n = await narrate(client, t, brief, units, noteLines);
    if (n.reply) reply = n.reply;
    if (n.items) {
      dishes = dishes.map((p, i) => withTexts(p, n.items![i]));
      if (pair) pair = withTexts(pair, n.items[dishes.length]);
    }
    if (n.notes) {
      const k = drink.what_was_read.length;
      drink = { ...drink, what_was_read: n.notes.slice(0, k), what_was_assumed: n.notes.slice(k) };
    }
  } else {
    reply = `${an.reply} ${T.TEXTS[l].noDishes}`.trim();
  }
  return out(t, {
    kind: 'drink', reply, drink, dishes, pair, questions: a.questions,
    route: a.matched_drink_id ? `/drinks/${a.matched_drink_id}` : null, occasion: t.prefs.occasion,
  });
}

// ─────────────────────────────── ошибки ───────────────────────────────

export class SommelierError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Единая обработка ошибок SDK → HTTP-статус и понятное сообщение для UI. */
export function describeError(e: unknown): { status: number; error: string } {
  if (e instanceof SommelierError) return { status: e.status, error: e.message };
  if (e instanceof Anthropic.AuthenticationError) return { status: 503, error: 'ИИ-сомелье не настроен: нет ключа API' };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, error: 'Слишком много запросов, попробуйте через минуту' };
  if (e instanceof Anthropic.BadRequestError) return { status: 400, error: `Запрос отклонён: ${e.message}` };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, error: 'Нет связи с ИИ' };
  if (e instanceof Anthropic.APIError) return { status: 502, error: `Ошибка ИИ (${e.status ?? '?'})` };
  if (e instanceof SyntaxError) return { status: 502, error: 'ИИ вернул неразборчивый ответ, попробуйте ещё раз' };
  return { status: 500, error: 'Внутренняя ошибка' };
}

// ─────────────────────────────── снимок промптов (паритет с Python) ───────────────────────────────

/** Всё, что должно совпадать с backend/api/ai.py байт-в-байт: промпты с каталогами, схемы, подписи, готовые фразы. */
export function promptSnapshot(): Record<string, unknown> {
  return {
    model: MODEL, fallback_beta: FALLBACK_BETA,
    system: { context: C.SYSTEM_CONTEXT, interpret: T.SYSTEM_INTERPRET, drink: C.SYSTEM_DRINK, narrate: T.SYSTEM_NARRATE },
    lang: Object.fromEntries(LOCALES.map(l => [l, { interpret: T.langInterpret(l), drink: T.langDrink(l), narrate: T.langNarrate(l) }])),
    schemas: { interpret: T.INTERPRET_SCHEMA, drink: C.DRINK_SCHEMA, narrate: T.NARRATE_SCHEMA },
    texts: Object.fromEntries(LOCALES.map(l => [l, {
      refusal: T.TEXTS[l].refusal, clarify: T.TEXTS[l].clarify, clarify_drink: T.TEXTS[l].clarifyDrink,
      no_picks: T.TEXTS[l].noPicks, no_dishes: T.TEXTS[l].noDishes,
    }])),
    labels: { category: T.CATEGORY_LABELS, match: T.MATCH_LABELS, band: T.BAND_LABELS },
    prompts: { image_dish: T.IMAGE_PROMPT_DISH, image_drink: T.IMAGE_PROMPT_DRINK, photo_dish: T.PHOTO_DISH, photo_drink: T.PHOTO_DRINK },
  };
}
