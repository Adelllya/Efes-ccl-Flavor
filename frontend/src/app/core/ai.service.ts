import { Injectable, inject, signal } from '@angular/core';
import { AI_URL } from './config';
import { I18nService, Locale } from './i18n.service';

/** Повод в движке v2 (ENGINE_V2_SPEC §6). */
export type AiOccasion = 'meal' | 'aperitif' | 'dessert' | 'hot' | 'evening' | 'party' | 'gourmet' | 'non_alcoholic';
export interface AiTurn { role: 'user' | 'assistant'; content: string; }
/** Карта заведения: beers — slug сортов v1 или id напитков v2 (сервер сопоставляет через legacy_brand_id). */
export interface AiVenue { slug: string; name?: string; beers?: string[]; prices?: Record<string, number>; volumes?: Record<string, string>; currency?: string; }
/** Причина или предупреждение движка: текст и уровень доказательности (A — лаборатория … D — гипотеза). */
export interface AiNote { text: string; evidence: string; }
/** Напиток к блюду — результат движка v2 (оценка, тип пары, причины). Выбор и оценки модель не меняет. */
export interface AiPick {
  drink_id: string;
  /** старое имя поля; равно drink_id */
  beer_id: string;
  name: string; category: string; category_label: string; style: string; archetype: string | null; abv: number;
  score: number; band: string; band_label: string; match_type: string; match_label: string; secondary_type: string | null;
  why: string; reasons: AiNote[]; warnings: AiNote[]; classic: boolean; efes_partner: boolean;
  price: number | null; volume: string | null; image: string | null;
}
/** Блюдо к напитку (режим «разобрать напиток»). route — полный разбор /pair/:dish. */
export interface AiDishPick {
  dish_id: string; name: string; emoji: string; score: number; band: string; band_label: string; match_type: string; match_label: string;
  secondary_type: string | null; why: string; reasons: AiNote[]; warnings: AiNote[]; classic: boolean; route: string;
}
export interface AiDishSpec {
  taste: string; weight: string; fat: string; cook: string; protein: string; sauce: string; acid: string;
  dessert: boolean; heat: number; tags: Record<string, number>; cuisine: string[];
}
export interface AiDish { name: string; slug: string | null; emoji: string; confidence: number; vector: Record<string, number>; spec: AiDishSpec; }
/** Разобранный напиток: из каталога (estimated = false) или оценка ИИ по этикетке (estimated = true, уверенность ≤ 0.45). */
export interface AiDrink {
  id: string | null; name: string; producer: string | null; category: string; category_label: string; style: string;
  archetype: string | null; family: string | null; abv: number | null; ibu: number | null;
  sensory: Record<string, number>; aroma_tags: Record<string, number>;
  serving: { temp_min_c: number | null; temp_max_c: number | null; glass: string | null } | null;
  estimated: boolean; vector_source: string | null; vector_confidence: number | null; recognition_confidence: number;
  /** что буквально прочитано на этикетке / в меню */
  what_was_read: string[];
  /** что взято по стилю или предположено ИИ */
  what_was_assumed: string[];
  vector_notes: string[];
  efes_relation: string; efes_partner: boolean; image: string | null;
}
export interface AiResult {
  ok: true;
  /** 'v2' — движок подбора v2; старый сервер поля не отдаёт */
  engine?: 'v2';
  kind: 'picks' | 'clarify' | 'chat' | 'drink';
  reply: string;
  dish: AiDish | null;
  picks: AiPick[];
  /** лучший напиток из портфеля Efes с честной оценкой — если его нет среди picks */
  best_partner: AiPick | null;
  drink: AiDrink | null;
  dishes: AiDishPick[];
  /** оценка пары с блюдом, которое назвал гость (режим «напиток») */
  pair: AiDishPick | null;
  questions: string[];
  route: string | null;
  occasion: AiOccasion | null;
  usage: { input: number; output: number; calls: number; cache_read?: number; cache_write?: number; fallbacks?: number };
  locale?: Locale;   // язык, на котором сервер написал ответ (старый сервер поля не отдаёт = ru)
}
export interface AiFailure { ok: false; error: string; status?: number; }
export type AiResponse = AiResult | AiFailure;
export interface AiOpts {
  venue?: AiVenue | null; occasion?: AiOccasion | null; bitter_pref?: number; sweet_pref?: number; heat_lover?: boolean;
  harsh_tol?: 'sensitive' | 'median' | 'tolerant' | null;
}

const MAX_SIDE = 1024;

/**
 * Клиент ИИ-сомелье v2: вопрос текстом или фото блюда → блюдо + напитки движка + объяснение;
 * «разобрать напиток» (название, строка меню или фото этикетки) → напиток + блюда к нему.
 * В теле запроса уходит `locale` ('ru' | 'kk' | 'en'); сервер без поля считает ru.
 * Flavor DNA v1 (оси пива v1) в движок v2 не передаётся — у v2 другая шкала осей.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private i18n = inject(I18nService);
  readonly busy = signal(false);
  readonly available = signal<boolean | null>(null);   // null — ещё не проверяли

  ask(messages: AiTurn[], opts: AiOpts = {}): Promise<AiResponse> {
    return this.post({ mode: 'ask', messages, ...this.ctx(opts) });
  }

  async vision(file: Blob, opts: AiOpts = {}, note = ''): Promise<AiResponse> {
    const image = await this.shrink(file).catch(() => null);
    if (!image) return { ok: false, error: this.i18n.t('ai.err.photo') };
    return this.post({ mode: 'vision', image, messages: note ? [{ role: 'user', content: note }] : [], ...this.ctx(opts) });
  }

  /** Разобрать напиток по названию или строке меню (messages) и/или по фото этикетки. */
  async drink(input: { messages?: AiTurn[]; file?: Blob | null; note?: string }, opts: AiOpts = {}): Promise<AiResponse> {
    let image: { media_type: 'image/jpeg'; data: string } | null = null;
    if (input.file) {
      image = await this.shrink(input.file).catch(() => null);
      if (!image) return { ok: false, error: this.i18n.t('ai.err.photo') };
    }
    const messages = input.messages ?? (input.note ? [{ role: 'user' as const, content: input.note }] : []);
    return this.post({ mode: 'drink', messages, ...(image ? { image } : {}), ...this.ctx(opts) });
  }

  private ctx(opts: AiOpts) {
    return {
      venue: opts.venue ?? null, occasion: opts.occasion ?? null, bitter_pref: opts.bitter_pref ?? 0, sweet_pref: opts.sweet_pref ?? 0,
      heat_lover: opts.heat_lover ?? false, harsh_tol: opts.harsh_tol ?? null, locale: this.i18n.locale(),
    };
  }

  private async post(body: unknown): Promise<AiResponse> {
    this.busy.set(true);
    try {
      const res = await fetch(AI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        this.available.set(res.status !== 404);
        return { ok: false, status: res.status, error: data?.error || (res.status === 404 ? this.i18n.t('ai.err.server') : this.i18n.t('ai.err.status', { status: res.status })) };
      }
      this.available.set(true);
      return normalize(data);
    } catch {
      this.available.set(false);
      return { ok: false, error: this.i18n.t('ai.err.network') };
    } finally { this.busy.set(false); }
  }

  /** Ужимаем фото до 1024px по длинной стороне — быстрее загрузка, дешевле токены, этикетку читать хватает. */
  private async shrink(file: Blob): Promise<{ media_type: 'image/jpeg'; data: string }> {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * k); canvas.height = Math.round(bitmap.height * k);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL('image/jpeg', 0.82);
    return { media_type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
  }
}

/** Ответ старого сервера (v1) или сохранённый в sessionStorage — к форме v2, чтобы шаблоны не падали на отсутствующих полях. */
export function normalize(data: Partial<AiResult> & { ok: true; kind: AiResult['kind']; reply: string }): AiResult {
  const note = (n: unknown): AiNote => (typeof n === 'string' ? { text: n, evidence: '' } : { text: String((n as AiNote)?.text ?? ''), evidence: String((n as AiNote)?.evidence ?? '') });
  const pick = (p: Partial<AiPick> & Record<string, unknown>): AiPick => ({
    drink_id: String(p.drink_id ?? p.beer_id ?? ''), beer_id: String(p.beer_id ?? p.drink_id ?? ''), name: String(p.name ?? ''),
    category: String(p.category ?? 'beer'), category_label: String(p.category_label ?? ''), style: String(p.style ?? ''), archetype: p.archetype ?? null,
    abv: Number(p.abv ?? 0), score: Number(p.score ?? 0), band: String(p.band ?? ''), band_label: String(p.band_label ?? ''),
    match_type: String(p.match_type ?? ''), match_label: String(p.match_label ?? ''), secondary_type: p.secondary_type ?? null, why: String(p.why ?? ''),
    reasons: (Array.isArray(p.reasons) ? p.reasons : []).map(note), warnings: (Array.isArray(p.warnings) ? p.warnings : []).map(note),
    classic: !!(p.classic ?? p['sommelier_pick']), efes_partner: !!p.efes_partner, price: p.price ?? null, volume: p.volume ?? null, image: p.image ?? null,
  });
  return {
    ...data, ok: true, kind: data.kind, reply: data.reply, dish: data.dish ?? null,
    picks: (data.picks ?? []).map(p => pick(p as AiPick & Record<string, unknown>)),
    best_partner: data.best_partner ? pick(data.best_partner as AiPick & Record<string, unknown>) : null,
    drink: data.drink ?? null, dishes: data.dishes ?? [], pair: data.pair ?? null, questions: data.questions ?? [],
    route: data.route ?? null, occasion: data.occasion ?? null, usage: data.usage ?? { input: 0, output: 0, calls: 0 },
  };
}
