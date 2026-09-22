/**
 * ИИ-сомелье Flavor Tree — серверный пайплайн (Vercel Function / любой Node).
 *
 *   вопрос или фото → Claude извлекает блюдо и контекст (строгий JSON)
 *                   → детерминированный движок подбора считает пары
 *                   → Claude объясняет результат словами сомелье
 *
 * Модель никогда не «угадывает пиво» — она переводит гостя на язык движка и обратно.
 * Язык ответа — поле locale ('ru' | 'kk' | 'en', по умолчанию 'ru'): указание языка уходит модели
 * вторым system-блоком, ПОСЛЕ кэшируемого, поэтому кэш промпта общий для всех языков.
 * Зеркало на Python: backend/api/ai.py (тот же контракт, те же промпты).
 */
import Anthropic from '@anthropic-ai/sdk';
import brandsJson from '../_data/brands.json';
import dishesJson from '../_data/dishes.json';
import notesJson from '../_data/flavor_notes.json';
import curatedJson from '../_data/pairings_curated.json';
import priorsJson from '../_data/style_priors.json';
import {
  BeerVector, CuratedPair, DishProfile, EngineBrand, EngineDish, EngineNote, Occasion, PairResult, PairingType,
  TYPE_LABELS, buildBeerProfile, buildDishProfile, indexCurated, recommendBeers,
} from '../../src/app/engine/pairing-engine';
import { DishSpec, SPEC_COOKINGS, SPEC_FATS, SPEC_TASTES, SPEC_WEIGHTS, customDishVector } from '../../src/app/engine/custom-dish';

export const MODEL = 'claude-opus-5';

// ─────────────────────────────── типы контракта ───────────────────────────────

export type Locale = 'ru' | 'kk' | 'en';
export interface ChatTurn { role: 'user' | 'assistant'; content: string; }
export interface VenueCtx { slug: string; name?: string; beers?: string[]; prices?: Record<string, number>; volumes?: Record<string, string>; currency?: string; }
export interface SommelierInput {
  mode: 'ask' | 'vision';
  messages?: ChatTurn[];
  image?: { media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string };
  venue?: VenueCtx | null;
  occasion?: Occasion | null;
  bitter_pref?: number;
  dna?: BeerVector | null;
  locale?: Locale;   // язык гостя; нет поля или неизвестное значение → 'ru'
}
export interface Pick {
  beer_id: string; name: string; style: string; abv: number; score: number; match_type: string; match_label: string;
  why: string; reasons: string[]; warnings: string[]; sommelier_pick: boolean; price?: number; volume?: string;
}
export interface DishOut { name: string; slug: string | null; emoji: string; spec: DishSpec; confidence: number; }
export interface SommelierOutput {
  ok: true; kind: 'picks' | 'clarify' | 'chat'; reply: string; dish: DishOut | null; picks: Pick[];
  route: string | null; occasion: Occasion | null; locale: Locale; usage: { input: number; output: number; calls: number };
}

// ─────────────────────────────── каталог для промпта ───────────────────────────────

type Brand = EngineBrand & { display_name: string; style_label: string; abv: number; tagline: string; origin: string };
type Dish = EngineDish & { display_name: string; emoji: string; cuisine_label: string; category: string; synonyms: string[]; description: string };

const brands = brandsJson as unknown as Brand[];
const dishes = dishesJson as unknown as Dish[];
const notesById = Object.fromEntries((notesJson as EngineNote[]).map(n => [n.id, n])) as Record<string, EngineNote>;
const priors = (priorsJson as { priors: Record<string, BeerVector> }).priors;
const beerProfiles = brands.map(b => buildBeerProfile(b, notesById, priors));
const dishProfiles = dishes.map(d => buildDishProfile(d));
const dishProfileById = Object.fromEntries(dishProfiles.map(p => [p.id, p])) as Record<string, DishProfile<Dish>>;
const brandById = Object.fromEntries(brands.map(b => [b.id, b])) as Record<string, Brand>;
const curatedIndex = indexCurated(curatedJson as CuratedPair[]);

const DISH_CATALOG = dishes.map(d => `${d.id} — ${d.display_name}${d.synonyms.length ? ` (${d.synonyms.slice(0, 4).join(', ')})` : ''} · ${d.cuisine_label}, ${d.category}`).join('\n');
const BEER_CATALOG = brands.map(b => `${b.id} — ${b.display_name} · ${b.style_label}, ${b.abv}%${b.tagline ? ` · ${b.tagline}` : ''}`).join('\n');

/** Стабильный префикс (кэшируется): роль, правила, каталоги. Ничего изменчивого здесь нет. */
const SYSTEM_INTERPRET = `Ты — ассистент-сомелье сервиса Flavor Tree (Казахстан, портфель Efes Kazakhstan). Гость в баре описывает блюдо словами или присылает фото. Твоя задача — перевести это в структуру для движка подбора пива. Пиво ты НЕ выбираешь: это делает детерминированный движок.

Правила:
1. Если блюдо совпадает с позицией каталога (по названию, синониму, региональному варианту) — верни её slug в matched_slug. Бешбармак, казы, куырдак, манты, самса, шашлык, плов, лагман — это казахская/центральноазиатская кухня; знай их вкус: жирное мясо, соль, варка или гриль.
2. Если блюда нет в каталоге — matched_slug = null и опиши сенсорный профиль: доминирующий вкус, вес, жирность, способ приготовления, остроту 0..1 (0 — не острое, 0.5 — заметно, 0.8+ — очень), теги ароматов (smoke, char, fried, bread, cheese, herbs, citrus, garlic, tomato, soy, ginger, sesame, cured, sour, sweet, cream, nuts, chocolate, coffee, honey, fish, seafood, mushroom, pepper).
3. Повод: hot — жара/лето/освежиться; evening — вечер/расслабиться/после работы; party — компания/праздник/много людей; gourmet — гастро-ужин/вдумчиво/деликатес. Если не сказано — null.
4. bitter_pref: −1 (не любит горечь) … 0 (не сказано) … +1 (любит горькое, хмелевое).
5. kind = "dish", если понятно, что человек ест (или на фото еда). kind = "clarify", если непонятно, что за блюдо — задай ОДИН короткий вопрос в reply. kind = "chat", если вопрос не про подбор к еде (например, про сорт, температуру подачи, что такое лагер) — ответь кратко в reply как сомелье, опираясь на каталог.
6. На фото может быть несколько блюд — выбери главное (самое большое/центральное). Если на фото не еда — kind="clarify" и попроси сфотографировать блюдо.
7. confidence 0..1 — насколько уверен в распознавании.
8. reply при kind="dish" — одна короткая фраза-подтверждение, что ты понял (например: «Похоже на шашлык из баранины с луком — жирное мясо с гриля»). Без рекомендаций пива.
Пиши по-русски, коротко, без markdown.

КАТАЛОГ БЛЮД (slug — название (синонимы) · кухня, раздел):
${DISH_CATALOG}

КАТАЛОГ ПИВА (для kind="chat"; slug — название · стиль, ABV):
${BEER_CATALOG}`;

const SYSTEM_NARRATE = `Ты — пивной сомелье Flavor Tree. Тебе дают блюдо гостя и 1–3 сорта, которые уже выбрал движок подбора (с оценкой 0–100, типом пары и причинами по правилам: интенсивность, очищение жира горечью и карбонизацией, острота, соль, сладость, кислота, умами, мосты по ароматам, вердикт сомелье, повод). Объясни гостю выбор живым языком: 2–4 предложения, по-русски, без markdown и списков. Первым назови лучший сорт и главную причину «почему именно он к этому блюду»; второй–третий — одним штрихом, чем отличаются. Если есть предупреждения — упомяни мягко. Если указаны цены заведения — можно назвать цену лучшего. Не выдумывай сорта и факты сверх данных. Не используй слова «алгоритм» и «движок» — говори как человек за стойкой.`;

// ─────────────────────────────── язык гостя (ru / kk / en) ───────────────────────────────

/** Язык гостя из запроса: 'kk' и 'en' как есть, всё остальное (и отсутствие поля) → 'ru'. */
export const resolveLocale = (x: unknown): Locale => (x === 'kk' || x === 'en' ? x : 'ru');

/** Изменчивая часть промпта. Для ru пусто: запрос к модели остаётся ровно таким, каким был до локалей. */
const LANG_STYLE: Record<Locale, string> = {
  ru: '',
  kk: 'Язык гостя — казахский. Весь текст для гостя пиши на естественном современном казахском языке кириллицей: коротко, тепло, без markdown и без кальки с русского. Названия блюд можно оставлять так, как их написал гость; названия сортов пива не переводи.',
  en: 'Язык гостя — английский. Весь текст для гостя пиши на естественном английском: коротко, тепло, без markdown. Названия блюд можно оставлять так, как их написал гость; названия сортов пива не переводи.',
};
const langInterpret = (l: Locale) => LANG_STYLE[l] && `${LANG_STYLE[l]} Это указание важнее строки «Пиши по-русски» выше. На языке гостя пишется только поле reply — фраза-подтверждение, уточняющий вопрос или ответ при kind="chat". Остальные поля не зависят от языка: matched_slug, значения enum и tags — строго как в правилах и каталоге; dish.name — так, как блюдо назвал гость, а если он его не называл (фото) — на языке гостя.`;
const langNarrate = (l: Locale) => LANG_STYLE[l] && `${LANG_STYLE[l]} Это указание важнее слова «по-русски» выше. Ответ — строго один JSON-объект по схеме. reply — твоё объяснение гостю (те же 2–4 предложения) на языке гостя. picks — те же сорта в том же порядке: beer_id копируй без изменений; why, reasons и warnings — перевод соответствующих русских строк на язык гостя, столько же элементов и в том же порядке, без добавлений и пропусков. Выбор сортов, их порядок, оценки и цены заданы — не меняй их.`;

/** Кэшируемый блок всегда первый и байт-в-байт одинаков для всех языков; указание языка — вторым блоком, уже за точкой кэша. */
const systemBlocks = (stable: string, volatile: string): Anthropic.TextBlockParam[] => [
  { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
  ...(volatile ? [{ type: 'text' as const, text: volatile }] : []),
];

/** Подпись типа пары — статично, без модели. ru — ровно подпись движка. */
const MATCH_LABELS: Record<Locale, Record<PairingType, string>> = {
  ru: TYPE_LABELS,
  kk: { COMPLEMENT: 'Complement · толықтыру', CONTRAST: 'Contrast · контраст', CLEANSE: 'Cleanse · тазарту', BRIDGE: 'Bridge · көпір' },
  en: { COMPLEMENT: 'Complement', CONTRAST: 'Contrast', CLEANSE: 'Cleanse', BRIDGE: 'Bridge' },
};

/** Готовые фразы гостю, которые пишет не модель. */
const TEXTS: Record<Locale, { refusal: string; clarify: string; noPicks: string }> = {
  ru: { refusal: 'С этим запросом я помочь не могу — но с радостью подберу пиво к вашему блюду.',
        clarify: 'Уточните, пожалуйста, что вы едите?',
        noPicks: 'В карте заведения нет сорта, который хорошо подходит к этому блюду.' },
  kk: { refusal: 'Бұл сұраныс бойынша көмектесе алмаймын — бірақ тағамыңызға лайық сыраны қуана таңдап беремін.',
        clarify: 'Не жеп отырғаныңызды нақтылап жіберіңізші.',
        noPicks: 'Мекеме мәзірінде бұл тағамға жақсы үйлесетін сыра сорты жоқ.' },
  en: { refusal: "I can't help with that request — but I'd be glad to pick a beer for your dish.",
        clarify: 'Could you tell me what you are eating?',
        noPicks: "There is no beer on this venue's list that pairs well with this dish." },
};

/** Объяснение для kk/en приходит строгим JSON: текст гостю + перевод человекочитаемых полей пар. */
const NARRATE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          beer_id: { type: 'string' },
          why: { type: 'string' },
          reasons: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['beer_id', 'why', 'reasons', 'warnings'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'picks'],
  additionalProperties: false,
} as const;

const INTERPRET_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['dish', 'clarify', 'chat'] },
    reply: { type: 'string' },
    dish: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        matched_slug: { type: ['string', 'null'] },
        taste: { type: 'string', enum: SPEC_TASTES },
        weight: { type: 'string', enum: SPEC_WEIGHTS },
        fat: { type: 'string', enum: SPEC_FATS },
        cooking: { type: 'string', enum: SPEC_COOKINGS },
        heat: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' },
      },
      required: ['name', 'matched_slug', 'taste', 'weight', 'fat', 'cooking', 'heat', 'tags', 'confidence'],
      additionalProperties: false,
    },
    occasion: { type: ['string', 'null'], enum: ['hot', 'evening', 'party', 'gourmet', null] },
    bitter_pref: { type: 'number' },
  },
  required: ['kind', 'reply', 'dish', 'occasion', 'bitter_pref'],
  additionalProperties: false,
} as const;

interface Interpretation {
  kind: 'dish' | 'clarify' | 'chat'; reply: string;
  dish: { name: string; matched_slug: string | null; taste: DishSpec['taste']; weight: DishSpec['weight']; fat: DishSpec['fat']; cooking: DishSpec['cooking']; heat: number; tags: string[]; confidence: number };
  occasion: Occasion | null; bitter_pref: number;
}

// ─────────────────────────────── пайплайн ───────────────────────────────

export async function runSommelier(input: SommelierInput, client: Anthropic = new Anthropic()): Promise<SommelierOutput> {
  const usage = { input: 0, output: 0, calls: 0 };
  const locale = resolveLocale(input.locale);
  const history = (input.messages || []).filter(m => m.content?.trim()).slice(-8);
  const lastUser = [...history].reverse().find(m => m.role === 'user')?.content || '';

  // ── фаза 1: понять блюдо и контекст ──
  const userContent: Anthropic.ContentBlockParam[] = [];
  if (input.mode === 'vision') {
    if (!input.image?.data) throw new SommelierError(400, 'Нет изображения');
    userContent.push({ type: 'image', source: { type: 'base64', media_type: input.image.media_type, data: input.image.data } });
    userContent.push({ type: 'text', text: lastUser || 'Что это за блюдо? Опиши его сенсорный профиль для подбора пива.' });
  } else {
    if (!lastUser) throw new SommelierError(400, 'Пустой вопрос');
  }
  const ctxNote = [
    input.venue?.name ? `Гость находится в заведении «${input.venue.name}».` : '',
    input.occasion ? `Повод уже выбран гостем: ${input.occasion}.` : '',
  ].filter(Boolean).join(' ');

  const messages: Anthropic.MessageParam[] = input.mode === 'vision'
    ? [{ role: 'user', content: userContent }]
    : history.map(m => ({ role: m.role, content: m.content }));
  if (ctxNote) messages.push({ role: 'user', content: `(контекст: ${ctxNote})` });

  const first = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: systemBlocks(SYSTEM_INTERPRET, langInterpret(locale)),
    output_config: { effort: input.mode === 'vision' ? 'medium' : 'low', format: { type: 'json_schema', schema: INTERPRET_SCHEMA } },
    messages,
  });
  usage.calls++; usage.input += first.usage.input_tokens; usage.output += first.usage.output_tokens;
  if (first.stop_reason === 'refusal') {
    return { ok: true, kind: 'chat', reply: TEXTS[locale].refusal, dish: null, picks: [], route: null, occasion: null, locale, usage };
  }
  const text = first.content.find(b => b.type === 'text')?.text || '{}';
  const intent = JSON.parse(text) as Interpretation;

  if (intent.kind !== 'dish') {
    return { ok: true, kind: intent.kind, reply: intent.reply || TEXTS[locale].clarify, dish: null, picks: [], route: null, occasion: intent.occasion, locale, usage };
  }

  // ── фаза 2: движок ──
  const occasion = input.occasion ?? intent.occasion ?? null;
  const ctx = { occasion, bitter_pref: input.bitter_pref ?? intent.bitter_pref ?? 0, dna: input.dna ?? null };
  const matched = intent.dish.matched_slug ? dishProfileById[intent.dish.matched_slug] : undefined;
  const spec: DishSpec = { taste: intent.dish.taste, weight: intent.dish.weight, fat: intent.dish.fat, cooking: intent.dish.cooking,
                           heat: clamp01(intent.dish.heat), tags: intent.dish.tags || [] };
  let profile: DishProfile;
  if (matched) profile = matched;
  else {
    const { vector, tags } = customDishVector(spec);
    profile = buildDishProfile({ id: 'custom', name: intent.dish.name, vector, tags } as EngineDish);
  }
  const venueBeers = input.venue?.beers?.length ? input.venue.beers : null;
  const results = recommendBeers(profile, beerProfiles, matched ? curatedIndex : {}, ctx, 3, venueBeers, true);
  let picks: Pick[] = results.map(r => toPick(r, input.venue, locale));

  const dish: DishOut = {
    name: matched ? matched.dish.display_name : intent.dish.name, slug: matched ? matched.id : null,
    emoji: matched ? matched.dish.emoji : '🍽️', spec, confidence: clamp01(intent.dish.confidence),
  };
  const route = matched ? `/pair/${matched.id}${occasion ? `?occasion=${occasion}` : ''}`
    : `/pair/custom?${new URLSearchParams({ name: dish.name, taste: spec.taste, weight: spec.weight, fat: spec.fat, cooking: spec.cooking,
        heat: String(Math.round((spec.heat || 0) * 100)), ...(occasion ? { occasion } : {}) }).toString()}`;

  // ── фаза 3: объяснить словами сомелье ──
  let reply = intent.reply;
  if (picks.length) {
    const translate = locale !== 'ru';   // kk/en: тем же вызовом получаем и перевод текстов пар
    const brief = {
      guest_said: lastUser || '(фото блюда)', dish: { name: dish.name, in_catalog: !!matched, spec, recognized_as: intent.reply },
      occasion, venue: input.venue?.name || null, currency: input.venue?.currency || '₸',
      picks: picks.map((p, i) => ({ rank: i + 1, ...(translate ? { beer_id: p.beer_id, why: p.why } : {}),
                                    name: p.name, style: p.style, abv: p.abv, score: p.score, match: p.match_label,
                                    reasons: p.reasons, warnings: p.warnings, sommelier_pick: p.sommelier_pick, price: p.price, volume: p.volume })),
    };
    const second = await client.messages.create({
      model: MODEL, max_tokens: translate ? 3000 : 700,
      system: systemBlocks(SYSTEM_NARRATE, langNarrate(locale)),
      output_config: translate ? { effort: 'low', format: { type: 'json_schema', schema: NARRATE_SCHEMA } } : { effort: 'low' },
      messages: [{ role: 'user', content: JSON.stringify(brief) }],
    });
    usage.calls++; usage.input += second.usage.input_tokens; usage.output += second.usage.output_tokens;
    const narrated = second.stop_reason === 'refusal' ? '' : (second.content.find(b => b.type === 'text')?.text || '').trim();
    if (!translate) { if (narrated) reply = narrated; }
    else {
      // JSON не разобрался или не сошёлся с парами движка → остаёмся на русских текстах, запрос не роняем
      const tr = parseNarration(narrated, picks);
      if (tr.reply) reply = tr.reply;
      if (tr.texts) picks = picks.map((p, i) => ({ ...p, ...tr.texts![i] }));
    }
  } else {
    reply = `${intent.reply} ${TEXTS[locale].noPicks}`;
  }

  return { ok: true, kind: 'picks', reply, dish, picks, route, occasion, locale, usage };
}

type PickTexts = { why: string; reasons: string[]; warnings: string[] };

/**
 * Разбор JSON-объяснения (kk/en). Модель переводит только тексты: сорта, порядок, оценки и цены остаются от движка.
 * texts = null при любом расхождении — другой набор или порядок beer_id, другое число причин/предупреждений, пустые строки.
 */
function parseNarration(text: string, picks: Pick[]): { reply: string; texts: PickTexts[] | null } {
  let data: { reply?: unknown; picks?: unknown };
  try { data = JSON.parse(text) ?? {}; } catch { return { reply: '', texts: null }; }
  if (typeof data !== 'object') return { reply: '', texts: null };
  const str = (x: unknown): x is string => typeof x === 'string' && !!x.trim();
  const list = (x: unknown, n: number): x is string[] => Array.isArray(x) && x.length === n && x.every(str);
  const raw = Array.isArray(data.picks) ? data.picks as Array<Partial<PickTexts> & { beer_id?: unknown }> : [];
  const ok = raw.length === picks.length && raw.every((t, i) => !!t && t.beer_id === picks[i].beer_id
    && str(t.why) && list(t.reasons, picks[i].reasons.length) && list(t.warnings, picks[i].warnings.length));
  return { reply: str(data.reply) ? data.reply.trim() : '',
           texts: ok ? raw.map(t => ({ why: t.why!.trim(), reasons: t.reasons!.map(s => s.trim()), warnings: t.warnings!.map(s => s.trim()) })) : null };
}

function toPick(r: PairResult, venue?: VenueCtx | null, locale: Locale = 'ru'): Pick {
  const b = brandById[r.beer_id];
  const reasons = r.reasons.map(c => c.text);
  return {
    beer_id: r.beer_id, name: b?.display_name || r.beer_id, style: b?.style_label || '', abv: b?.abv || 0,
    score: r.score, match_type: r.match_type, match_label: MATCH_LABELS[locale][r.match_type] ?? r.match_label,
    why: (r.reasons.find(c => c.rule !== 'intensity') ?? r.reasons[0])?.text || r.verdict,
    reasons, warnings: r.warnings.map(c => c.text), sommelier_pick: r.sommelier_pick,
    price: venue?.prices?.[r.beer_id], volume: venue?.volumes?.[r.beer_id],
  };
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export class SommelierError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Единая обработка ошибок SDK → HTTP-статус и понятное сообщение для UI. */
export function describeError(e: unknown): { status: number; error: string } {
  if (e instanceof SommelierError) return { status: e.status, error: e.message };
  if (e instanceof Anthropic.AuthenticationError) return { status: 503, error: 'ИИ-сомелье не настроен: нет ключа API' };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, error: 'Слишком много запросов, попробуйте через минуту' };
  if (e instanceof Anthropic.BadRequestError) return { status: 400, error: `Запрос отклонён: ${e.message}` };
  if (e instanceof Anthropic.APIError) return { status: 502, error: `Ошибка ИИ (${e.status ?? '?'})` };
  if (e instanceof SyntaxError) return { status: 502, error: 'ИИ вернул неразборчивый ответ, попробуйте ещё раз' };
  return { status: 500, error: 'Внутренняя ошибка' };
}
