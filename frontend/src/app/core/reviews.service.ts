import { Injectable, inject, signal } from '@angular/core';
import { API_URL } from './config';
import { I18nKey, I18nService, Locale } from './i18n.service';
import { SaasService } from './saas.service';
import { AppliedPrefs, GuestPrefsService, MAX_PREF_STEP, PrefsDelta, clamp, prefNotes, r2 } from './guest-prefs.service';

/**
 * Отзывы гостей о парах напиток × блюдо — клиент API /api/v2/reviews/ (backend/api/views_reviews.py, docs/REVIEWS.md).
 *
 * API_URL задан → отзыв уходит на сервер; копия своего отзыва остаётся на устройстве (ключ LS_MINE), чтобы виджет
 * показал «Ваша оценка» и дал её изменить. API_URL пуст (демо на Vercel без Django) → отзыв хранится ТОЛЬКО на этом
 * устройстве (ключ LS_DEVICE), нигде не публикуется, и интерфейс так и пишет: «сохранено только на этом устройстве».
 * Личный профиль (GuestPrefsService) поправляется в обоих режимах — на устройстве гостя.
 */
export type ReviewChipId = 'perfect_match' | 'great_with_fat' | 'refreshing' | 'cools_heat' | 'flavors_echo' | 'too_bitter'
  | 'too_sweet' | 'burns_more' | 'too_strong_alcohol' | 'overpowers_dish' | 'lost_behind_dish' | 'wouldnt_order_again';
export interface ChipDef { readonly id: ReviewChipId; readonly polarity: 1 | -1; readonly prefs: PrefsDelta; }

/** Словарь меток — зеркало REVIEW_CHIPS в backend/api/reviews_logic.py: порядок, полярность, поправка профиля.
 *  Сверяется тестом api.tests.test_reviews (HonestyAndMirrorTests). Подписи — i18n-ключи review.chip.<id>. */
export const REVIEW_CHIPS: readonly ChipDef[] = [
  { id: 'perfect_match', polarity: 1, prefs: {} },
  { id: 'great_with_fat', polarity: 1, prefs: {} },
  { id: 'refreshing', polarity: 1, prefs: {} },
  { id: 'cools_heat', polarity: 1, prefs: {} },
  { id: 'flavors_echo', polarity: 1, prefs: {} },
  { id: 'too_bitter', polarity: -1, prefs: { bitter_pref: -0.25 } },
  { id: 'too_sweet', polarity: -1, prefs: { sweet_pref: -0.25 } },
  { id: 'burns_more', polarity: -1, prefs: { harsh_tol: 1, heat_lover: false } },
  { id: 'too_strong_alcohol', polarity: -1, prefs: { harsh_tol: 1 } },
  { id: 'overpowers_dish', polarity: -1, prefs: {} },
  { id: 'lost_behind_dish', polarity: -1, prefs: {} },
  { id: 'wouldnt_order_again', polarity: -1, prefs: {} },
];
const CHIP_BY_ID: Readonly<Record<string, ChipDef | undefined>> = Object.fromEntries(REVIEW_CHIPS.map(c => [c.id, c]));
export const MAX_TEXT = 1000;

export const chipKey = (id: ReviewChipId): I18nKey => `review.chip.${id}`;
export const isChip = (x: unknown): x is ReviewChipId => typeof x === 'string' && !!CHIP_BY_ID[x];

// ── типы ответов API ──
export interface ChipCount { id: ReviewChipId; n: number; label: string; polarity: 1 | -1; }
export interface ReviewAggregate {
  n: number; enough: boolean; mean: number | null; raw_mean: number | null; expected: number; engine_score: number | null;
  verified: number | null; helpful_pct: number | null; helpful_n: number | null; distribution: Record<string, number> | null;
  chips: ChipCount[]; disagreement: { direction: 'lower' | 'higher'; delta: number } | null; note: string | null;
}
export interface PublicReview {
  id: string; drink_id: string; drink_name: string; dish_id: string; dish_name: string; rating: number; chips: ReviewChipId[];
  text: string; summary: string | null; aspects: ReviewChipId[]; helpful: boolean | null; verified: boolean; locale: string; date: string;
}
export type ReviewStatus = 'published' | 'pending' | 'hidden' | 'spam';
export interface PairReviews { drink_id: string; drink_name: string; dish_id: string; dish_name: string; aggregate: ReviewAggregate; reviews: PublicReview[]; }
export interface PairRow { drink_id?: string; drink_name?: string; dish_id: string; dish_name: string; aggregate: ReviewAggregate; }
export interface DrinkReviews { drink_id: string; drink_name: string; aggregate: ReviewAggregate; top_chips: ChipCount[]; by_dish: PairRow[]; reviews: PublicReview[]; }
export interface CabinetReviews {
  venue: { slug: string; name: string }; days: number;
  summary: { published: number; pending: number; hidden: number; verified: number; with_text: number };
  aggregate: ReviewAggregate; pairs: PairRow[]; low_rated: PairRow[]; chips: ChipCount[]; reviews: PublicReview[];
}

/** Свой отзыв на этом устройстве. where: server — отправлен (status — решение сервера); device — только здесь. */
export interface OwnReview {
  id: string | null; drink_id: string; dish_id: string; dish_name: string; rating: number; chips: ReviewChipId[]; text: string;
  helpful: boolean | null; status: ReviewStatus | 'device'; where: 'server' | 'device'; saved_at: string;
}
export interface ReviewInput {
  drinkId: string; dishId: string; dishName?: string; rating: number; chips: readonly ReviewChipId[]; text?: string;
  helpful?: boolean | null; score?: number | null; ctx?: Record<string, unknown> | null; venueSlug?: string | null; table?: number | null;
}
export type SubmitResult =
  | { ok: true; where: 'server' | 'device'; review: OwnReview; applied: AppliedPrefs; aggregate: ReviewAggregate | null; pending: boolean }
  | { ok: false; error: 'invalid' | 'rate_limited' | 'network' | 'server'; detail?: string; retryAfter?: number };

const LS_MINE = 'ft.reviews.mine.v1';            // копии своих отзывов, отправленных на сервер
const LS_DEVICE = 'ft.reviews.device-only.v1';   // режим без сервера: отзывы ТОЛЬКО на этом устройстве, не опубликованы
const TIMEOUT_MS = 15000;                        // сервер может разбирать текст ИИ до ~8 с

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим — копия не сохранится */ }
}
/** Ключ пары как dish_key на сервере: id блюда или custom:<название в нижнем регистре, ё → е>. */
export function pairKey(drinkId: string, dishId: string, dishName = ''): string {
  const dish = dishId === 'custom' ? `custom:${dishName.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е')}` : dishId;
  return `${drinkId}|${dish}`;
}

/** Метки → поправка профиля (зеркало reviews_logic.prefs_delta): сумма, ±MAX_PREF_STEP, harsh_tol ±1 ступень. */
export function chipDelta(chips: readonly string[]): PrefsDelta {
  let bitter = 0, sweet = 0, harsh = 0;
  let heat: boolean | undefined;
  for (const id of new Set(chips)) {
    const c = CHIP_BY_ID[id];
    if (!c) continue;
    bitter += c.prefs.bitter_pref ?? 0;
    sweet += c.prefs.sweet_pref ?? 0;
    harsh += c.prefs.harsh_tol ?? 0;
    if (c.prefs.heat_lover !== undefined) heat = heat === undefined ? c.prefs.heat_lover : heat && c.prefs.heat_lover;
  }
  const out: PrefsDelta = {};
  if (bitter) out.bitter_pref = r2(clamp(bitter, -MAX_PREF_STEP, MAX_PREF_STEP));
  if (sweet) out.sweet_pref = r2(clamp(sweet, -MAX_PREF_STEP, MAX_PREF_STEP));
  if (harsh) out.harsh_tol = clamp(harsh, -1, 1);
  if (heat !== undefined) out.heat_lover = heat;
  return out;
}

/** Правка отзыва сдвигает профиль только на разницу с прошлой версией (зеркало reviews_logic.prefs_diff). */
export function deltaDiff(next: PrefsDelta, prev: PrefsDelta): PrefsDelta {
  const out: PrefsDelta = {};
  const b = r2((next.bitter_pref ?? 0) - (prev.bitter_pref ?? 0));
  const s = r2((next.sweet_pref ?? 0) - (prev.sweet_pref ?? 0));
  const h = (next.harsh_tol ?? 0) - (prev.harsh_tol ?? 0);
  if (b) out.bitter_pref = b;
  if (s) out.sweet_pref = s;
  if (h) out.harsh_tol = h;
  if (next.heat_lover !== undefined && next.heat_lover !== prev.heat_lover) out.heat_lover = next.heat_lover;
  return out;
}

export function appliedFor(chips: readonly string[], previous: readonly string[] = []): AppliedPrefs {
  const delta = deltaDiff(chipDelta(chips), chipDelta(previous));
  return { delta, notes: prefNotes(delta) };
}

/** Форма множественного числа для «{n} оценка/оценки/оценок» (как I18nService.count). */
export function countKey(n: number, locale: Locale): I18nKey {
  const m10 = n % 10, m100 = n % 100;
  const form = locale === 'ru'
    ? (m10 === 1 && m100 !== 11 ? 'one' : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'few' : 'many')
    : locale === 'en' && n === 1 ? 'one' : 'many';
  return `review.count.${form}`;
}

/** Средняя одной цифрой после запятой по правилам языка: 4,2 (ru/kk) · 4.2 (en). */
export function fmtMean(x: number, locale: Locale): string {
  return x.toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

@Injectable({ providedIn: 'root' })
export class ReviewsService {
  private saas = inject(SaasService);
  private prefs = inject(GuestPrefsService);
  private i18n = inject(I18nService);
  readonly mode: 'api' | 'local' = API_URL ? 'api' : 'local';
  /** Растёт после каждой отправки — сводки на странице могут перезапросить данные. */
  readonly saved = signal(0);

  /** Свой отзыв на эту пару (с этого устройства) или null. */
  mine(drinkId: string, dishId: string, dishName = ''): OwnReview | null {
    const store = read<Record<string, OwnReview | undefined>>(this.mode === 'api' ? LS_MINE : LS_DEVICE, {});
    return store[pairKey(drinkId, dishId, dishName)] ?? null;
  }

  async submit(input: ReviewInput): Promise<SubmitResult> {
    const key = pairKey(input.drinkId, input.dishId, input.dishName ?? '');
    const previous = this.mine(input.drinkId, input.dishId, input.dishName ?? '');
    const chips = REVIEW_CHIPS.map(c => c.id).filter(id => input.chips.includes(id));
    const text = (input.text ?? '').trim().slice(0, MAX_TEXT);
    const base = { drink_id: input.drinkId, dish_id: input.dishId, dish_name: input.dishId === 'custom' ? (input.dishName ?? '').trim() : '',
                   rating: input.rating, chips, text, helpful: input.helpful ?? null };

    if (this.mode === 'local') {
      // Сервера нет: отзыв остаётся на устройстве и НЕ публикуется. Поправка профиля — та же, что посчитал бы сервер по меткам.
      const review: OwnReview = { ...base, id: null, status: 'device', where: 'device', saved_at: new Date().toISOString() };
      const applied = appliedFor(chips, previous?.chips ?? []);
      this.store(LS_DEVICE, key, review);
      this.prefs.applyDelta(applied);
      this.saved.update(n => n + 1);
      return { ok: true, where: 'device', review, applied, aggregate: null, pending: false };
    }

    const body = {
      ...base, locale: this.i18n.locale(), session: this.saas.guestSession(),
      score_shown: input.score ?? null, ctx: input.ctx ?? {}, venue: input.venueSlug ?? null, table: input.table ?? null,
    };
    const res = await this.request('POST', '/v2/reviews/', body);
    if (!res) return { ok: false, error: 'network' };
    if (res.status === 429) return { ok: false, error: 'rate_limited', retryAfter: Number(res.data?.retry_after) || undefined };
    if (res.status === 400) return { ok: false, error: 'invalid', detail: typeof res.data?.detail === 'string' ? res.data.detail : undefined };
    if (!res.ok || !res.data?.review) return { ok: false, error: 'server' };

    const r = res.data.review;
    const review: OwnReview = {
      ...base, id: String(r.id), rating: Number(r.rating) || input.rating, text: typeof r.text === 'string' ? r.text : text,
      chips: Array.isArray(r.chips) ? r.chips.filter(isChip) : chips, status: r.status as ReviewStatus, where: 'server',
      saved_at: new Date().toISOString(),
    };
    const applied: AppliedPrefs = res.data.applied_prefs ?? { delta: {}, notes: [] };
    this.store(LS_MINE, key, review);
    this.prefs.applyDelta(applied);
    this.saved.update(n => n + 1);
    return { ok: true, where: 'server', review, applied, aggregate: res.data.aggregate ?? null, pending: !!res.data.pending };
  }

  /** Сводка пары + последние опубликованные тексты. null — нет сервера или ошибка (показываем «Оценок пока нет»). */
  async pair(drinkId: string, dishId: string, dishName = '', limit = 3): Promise<PairReviews | null> {
    if (this.mode === 'local') return null;
    const q = new URLSearchParams({ drink: drinkId, dish: dishId, limit: String(limit) });
    if (dishId === 'custom') q.set('dish_name', dishName);
    const res = await this.request('GET', `/v2/reviews/pair/?${q}`);
    return res?.ok ? res.data as PairReviews : null;
  }

  /** Сводка напитка по всем блюдам. */
  async drink(drinkId: string, limit = 3): Promise<DrinkReviews | null> {
    if (this.mode === 'local') return null;
    const res = await this.request('GET', `/v2/reviews/drink/${encodeURIComponent(drinkId)}/?limit=${limit}`);
    return res?.ok ? res.data as DrinkReviews : null;
  }

  /** Кабинет заведения: отзывы гостей в своём заведении (Bearer-токен кабинета). */
  async cabinet(token: string, days?: number): Promise<CabinetReviews | null> {
    if (this.mode === 'local' || !token) return null;
    const res = await this.request('GET', `/cabinet/reviews/${days ? `?days=${days}` : ''}`, undefined, token);
    return res?.ok ? res.data as CabinetReviews : null;
  }

  private store(lsKey: string, key: string, review: OwnReview): void {
    const all = read<Record<string, OwnReview>>(lsKey, {});
    all[key] = review;
    write(lsKey, all);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async request(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<{ ok: boolean; status: number; data: any } | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
