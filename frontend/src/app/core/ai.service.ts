import { Injectable, inject, signal } from '@angular/core';
import { AI_URL } from './config';
import { DnaService } from './dna.service';
import { I18nService, Locale } from './i18n.service';
import type { Occasion, BeerVector } from '../engine/pairing-engine';
import type { DishSpec } from '../engine/custom-dish';

export interface AiTurn { role: 'user' | 'assistant'; content: string; }
export interface AiVenue { slug: string; name?: string; beers?: string[]; prices?: Record<string, number>; volumes?: Record<string, string>; currency?: string; }
export interface AiPick {
  beer_id: string; name: string; style: string; abv: number; score: number; match_type: string; match_label: string;
  why: string; reasons: string[]; warnings: string[]; sommelier_pick: boolean; price?: number; volume?: string;
}
export interface AiDish { name: string; slug: string | null; emoji: string; spec: DishSpec; confidence: number; }
export interface AiResult {
  ok: true; kind: 'picks' | 'clarify' | 'chat'; reply: string; dish: AiDish | null; picks: AiPick[];
  route: string | null; occasion: Occasion | null; usage: { input: number; output: number; calls: number };
  locale?: Locale;   // язык, на котором сервер написал ответ (старый сервер поля не отдаёт = ru)
}
export interface AiFailure { ok: false; error: string; status?: number; }
export type AiResponse = AiResult | AiFailure;
export interface AiOpts { venue?: AiVenue | null; occasion?: Occasion | null; bitter_pref?: number; dna?: BeerVector | null; }

const MAX_SIDE = 1024;

/** Клиент ИИ-сомелье: текстовый вопрос или фото блюда → блюдо + пары движка + объяснение.
 *  В теле запроса уходит `locale` ('ru' | 'kk' | 'en'); сервер без поля считает ru. */
@Injectable({ providedIn: 'root' })
export class AiService {
  private dna = inject(DnaService);
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

  private ctx(opts: AiOpts) {
    return { venue: opts.venue ?? null, occasion: opts.occasion ?? null, bitter_pref: opts.bitter_pref ?? 0, dna: opts.dna ?? this.dna.vector() ?? null, locale: this.i18n.locale() };
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
      return data as AiResult;
    } catch {
      this.available.set(false);
      return { ok: false, error: this.i18n.t('ai.err.network') };
    } finally { this.busy.set(false); }
  }

  /** Ужимаем фото до 1024px по длинной стороне — быстрее загрузка, дешевле токены, точности хватает. */
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
