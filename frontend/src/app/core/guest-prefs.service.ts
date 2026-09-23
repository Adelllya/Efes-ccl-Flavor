import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { I18nKey, I18nService } from './i18n.service';

/**
 * Личный профиль гостя для движка v2 — контекст R17: bitter_pref, sweet_pref (−1..1), heat_lover, harsh_tol.
 * Живёт только на устройстве гостя (localStorage). Отзывы о парах присылают поправку (applied_prefs) — сервер её
 * считает, но профиль не хранит. Формулы — зеркало backend/api/reviews_logic.py (apply_prefs, pref_notes).
 */
export type HarshTol = 'tolerant' | 'median' | 'sensitive';
export interface GuestPrefs { bitter_pref: number; sweet_pref: number; heat_lover: boolean; harsh_tol: HarshTol; }

/** Поправка из отзыва: bitter_pref / sweet_pref — сдвиг по шкале −1..1; harsh_tol — шаги по шкале
 *  tolerant → median → sensitive (+1 = бережнее); heat_lover — установить значение. */
export interface PrefsDelta { bitter_pref?: number; sweet_pref?: number; harsh_tol?: number; heat_lover?: boolean; }
export type PrefNoteId = 'bitter_down' | 'bitter_up' | 'sweet_down' | 'sweet_up' | 'harsh_up' | 'harsh_down' | 'heat_off';
export interface PrefNote { id: PrefNoteId; text?: string; source: 'chip' | 'text'; }
/** Ответ сервера (или локальный расчёт в режиме без сервера): что поменять и что сказать гостю. */
export interface AppliedPrefs { delta: PrefsDelta; notes: PrefNote[]; }

export const DEFAULT_PREFS: GuestPrefs = { bitter_pref: 0, sweet_pref: 0, heat_lover: false, harsh_tol: 'median' };
export const HARSH_ORDER: readonly HarshTol[] = ['tolerant', 'median', 'sensitive'];
/** За один отзыв ось сдвигается не больше чем на половину шкалы (MAX_PREF_STEP в reviews_logic.py). */
export const MAX_PREF_STEP = 0.5;
const KEY = 'ft.guest.prefs.v1';

/** Округление «половина вверх», как r2 в движке. */
export const r2 = (x: number): number => Math.floor(x * 100 + 0.5) / 100;
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const isHarsh = (x: unknown): x is HarshTol => x === 'tolerant' || x === 'median' || x === 'sensitive';

/** Применить поправку к профилю, с ограничениями (зеркало reviews_logic.apply_prefs). */
export function applyPrefs(p: GuestPrefs, d: PrefsDelta): GuestPrefs {
  const idx = HARSH_ORDER.indexOf(p.harsh_tol);
  const next = clamp((idx < 0 ? 1 : idx) + Math.trunc(num(d.harsh_tol)), 0, HARSH_ORDER.length - 1);
  return {
    bitter_pref: r2(clamp(num(p.bitter_pref) + num(d.bitter_pref), -1, 1)),
    sweet_pref: r2(clamp(num(p.sweet_pref) + num(d.sweet_pref), -1, 1)),
    heat_lover: typeof d.heat_lover === 'boolean' ? d.heat_lover : p.heat_lover === true,
    harsh_tol: HARSH_ORDER[next],
  };
}

/** «Что учли» по поправке (зеркало reviews_logic.pref_notes). */
export function prefNotes(d: PrefsDelta, source: 'chip' | 'text' = 'chip'): PrefNote[] {
  const notes: PrefNote[] = [];
  if (num(d.bitter_pref)) notes.push({ id: num(d.bitter_pref) < 0 ? 'bitter_down' : 'bitter_up', source });
  if (num(d.sweet_pref)) notes.push({ id: num(d.sweet_pref) < 0 ? 'sweet_down' : 'sweet_up', source });
  if (num(d.harsh_tol)) notes.push({ id: num(d.harsh_tol) > 0 ? 'harsh_up' : 'harsh_down', source });
  if (d.heat_lover === false) notes.push({ id: 'heat_off', source });
  return notes;
}

function load(): GuestPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const x = JSON.parse(raw) as Partial<Record<keyof GuestPrefs, unknown>>;
      return applyPrefs({
        bitter_pref: num(x.bitter_pref), sweet_pref: num(x.sweet_pref),
        heat_lover: x.heat_lover === true, harsh_tol: isHarsh(x.harsh_tol) ? x.harsh_tol : 'median',
      }, {});
    }
  } catch { /* приватный режим или битый JSON — начинаем с медианного гостя */ }
  return { ...DEFAULT_PREFS };
}

@Injectable({ providedIn: 'root' })
export class GuestPrefsService {
  private i18n = inject(I18nService);
  readonly prefs = signal<GuestPrefs>(load());

  /** Контекст для движка и API v2 (views_engine_v2._ctx_from): только то, чем гость отличается от «медианного». */
  readonly ctx = computed<Partial<GuestPrefs>>(() => {
    const p = this.prefs(); const out: Partial<GuestPrefs> = {};
    if (p.bitter_pref) out.bitter_pref = p.bitter_pref;
    if (p.sweet_pref) out.sweet_pref = p.sweet_pref;
    if (p.heat_lover) out.heat_lover = true;
    if (p.harsh_tol !== 'median') out.harsh_tol = p.harsh_tol;
    return out;
  });
  readonly isDefault = computed(() => Object.keys(this.ctx()).length === 0);

  /** «Что мы учли» — человекочитаемый список на языке гостя (пусто, пока профиль медианный). */
  readonly learned = computed<string[]>(() => {
    const p = this.prefs(); const keys: I18nKey[] = [];
    if (p.bitter_pref <= -0.2) keys.push('prefs.bitter.less'); else if (p.bitter_pref >= 0.2) keys.push('prefs.bitter.more');
    if (p.sweet_pref <= -0.2) keys.push('prefs.sweet.less'); else if (p.sweet_pref >= 0.2) keys.push('prefs.sweet.more');
    if (p.heat_lover) keys.push('prefs.heat.lover');
    if (p.harsh_tol === 'sensitive') keys.push('prefs.harsh.sensitive'); else if (p.harsh_tol === 'tolerant') keys.push('prefs.harsh.tolerant');
    return keys.map(k => this.i18n.t(k));
  });

  constructor() {
    effect(() => {
      const p = this.prefs();
      try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* приватный режим — профиль живёт до перезагрузки */ }
    });
  }

  /** Применить поправку из отзыва (applied_prefs ответа сервера или локальный расчёт). */
  applyDelta(applied: AppliedPrefs | PrefsDelta | null | undefined): void {
    if (!applied) return;
    const delta: PrefsDelta = 'delta' in applied ? applied.delta : applied;
    if (!delta || !Object.keys(delta).length) return;
    this.prefs.update(p => applyPrefs(p, delta));
  }

  /** Явная настройка (например, переключатель «люблю острое»); значения нормализуются. */
  set(patch: Partial<GuestPrefs>): void { this.prefs.update(p => applyPrefs({ ...p, ...patch }, {})); }
  reset(): void { this.prefs.set({ ...DEFAULT_PREFS }); }

  /** Короткая фраза для «Спасибо! Учли: …». */
  noteText(id: PrefNoteId): string { return this.i18n.t(`prefs.note.${id}`); }
}
