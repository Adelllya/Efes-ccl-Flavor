import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { I18nKey, I18nService } from '../core/i18n.service';
import { GuestPrefsService, PrefNote } from '../core/guest-prefs.service';
import {
  MAX_TEXT, OwnReview, REVIEW_CHIPS, ReviewAggregate, ReviewChipId, ReviewsService, chipKey, countKey, fmtMean,
} from '../core/reviews.service';

let seq = 0;

/**
 * «Как вам пара?» — оценка пары гостем: 5 звёзд (нативная группа радиокнопок: стрелки, Tab, скринридер),
 * метки (кнопки-переключатели aria-pressed), «подбор помог?», необязательный текст ≤ 1000 знаков.
 * После отправки: «Спасибо! Учли: меньше горечи» (поправка профиля из applied_prefs — применена на устройстве)
 * и сводка пары: средняя, «мало оценок: n» или «Оценок пока нет». Без сервера — честная плашка
 * «сохранено только на этом устройстве». Повторная отправка той же пары обновляет прежний отзыв.
 */
@Component({
  selector: 'ft-pair-review',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pr card" [attr.aria-labelledby]="uid + '-title'">
      <header class="head">
        <h3 class="title" [id]="uid + '-title'">{{ t('review.title') }}</h3>
        @if (local()) { <span class="badge badge-info">{{ t('review.localOnly') }}</span> }
      </header>

      @if (phase() === 'done') {
        <div class="done" role="status" aria-live="polite">
          @if (justSent()) {
            <p class="thanks"><b>{{ t('review.thanks') }}</b> {{ learnedLine() }}</p>
            @if (pending()) { <p class="xs muted">{{ t('review.pending') }}</p> }
          } @else {
            @if (own(); as o) {
              <p class="thanks">{{ t('review.yours', { n: o.rating }) }}@if (o.where === 'server' && o.status !== 'published' && o.text) { <span class="muted"> · {{ t('review.onCheck') }}</span> }</p>
            }
          }
          <p class="agg">
            <svg class="agg-star" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="starPath" /></svg>
            <span class="sm dim">{{ aggLine() }}</span>
          </p>
          <button type="button" class="btn btn-ghost btn-sm" (click)="edit()">{{ t('review.edit') }}</button>
        </div>
      } @else {
        <form class="form" (submit)="$event.preventDefault(); submit()" novalidate>
          <fieldset class="stars">
            <legend class="sr-only">{{ t('review.stars.aria') }}</legend>
            <div class="star-row" (mouseleave)="hover.set(0)">
              @for (n of stars; track n) {
                <input class="sr-only star-input" type="radio" [id]="uid + '-s' + n" [name]="uid + '-rating'" [value]="n"
                       [checked]="rating() === n" (change)="setRating(n)" />
                <label class="star" [for]="uid + '-s' + n" [class.on]="n <= shown()" (mouseenter)="hover.set(n)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="starPath" /></svg>
                  <span class="sr-only">{{ t(starKey(n)) }}</span>
                </label>
              }
            </div>
            <span class="hint xs" aria-hidden="true">{{ shown() ? t(starKey(shown())) : t('review.stars.hint') }}</span>
          </fieldset>

          <div class="group">
            <span class="lbl" [id]="uid + '-chips'">{{ t('review.chips.label') }}</span>
            <div class="chips" role="group" [attr.aria-labelledby]="uid + '-chips'">
              @for (c of chips; track c.id) {
                <button type="button" class="chip chip-sm" [class.neg]="c.polarity < 0" [attr.aria-pressed]="isPicked(c.id)"
                        (click)="toggle(c.id)">{{ t(chipKey(c.id)) }}</button>
              }
            </div>
          </div>

          <div class="group">
            <span class="lbl" [id]="uid + '-help'">{{ t('review.helpful.q') }}</span>
            <div class="chips" role="group" [attr.aria-labelledby]="uid + '-help'">
              <button type="button" class="chip chip-sm" [attr.aria-pressed]="helpful() === true" (click)="setHelpful(true)">{{ t('review.helpful.yes') }}</button>
              <button type="button" class="chip chip-sm" [attr.aria-pressed]="helpful() === false" (click)="setHelpful(false)">{{ t('review.helpful.no') }}</button>
            </div>
          </div>

          <div class="group">
            <label class="lbl" [for]="uid + '-text'">{{ t('review.text.label') }}</label>
            <textarea class="input" [id]="uid + '-text'" rows="3" [attr.maxlength]="maxText" [value]="text()" (input)="onText($event)"
                      [placeholder]="t('review.text.placeholder')" [attr.aria-describedby]="uid + '-count'"></textarea>
            <span class="count xs" [id]="uid + '-count'" [class.full]="text().length >= maxText">{{ t('review.text.counter', { n: text().length, max: maxText }) }}</span>
          </div>

          @if (error(); as e) { <p class="err sm" role="alert">{{ e }}</p> }
          <div class="actions">
            <button type="submit" class="btn btn-primary btn-sm" [disabled]="phase() === 'sending'">
              {{ phase() === 'sending' ? t('review.sending') : (own() ? t('review.update') : t('review.submit')) }}
            </button>
            @if (own()) { <button type="button" class="btn btn-ghost btn-sm" (click)="cancel()">{{ t('review.cancel') }}</button> }
          </div>
        </form>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pr { padding: 16px; display: grid; gap: 12px; }
    @media (min-width: 720px) { .pr { padding: 20px; } }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .title { font-size: 1.3rem; }
    .form { display: grid; gap: 14px; }
    fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
    .stars { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .star-row { display: inline-flex; gap: 2px; }
    .star { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--r-sm); cursor: pointer; color: var(--ink-4); transition: color var(--t-fast), transform var(--t-fast) var(--ease); }
    .star svg { width: 30px; height: 30px; fill: transparent; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; }
    .star.on { color: var(--gold); }
    .star.on svg { fill: var(--gold); }
    .star:hover { transform: scale(1.08); }
    .star-input:focus-visible + .star { outline: 2px solid var(--gold); outline-offset: 1px; }
    .hint { color: var(--ink-3); min-height: 1.2em; }
    .group { display: grid; gap: 8px; }
    .lbl { font-size: .78rem; font-weight: 700; color: var(--ink-2); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip.neg[aria-pressed="true"] { background: var(--warn-bg); color: var(--warn); border-color: rgba(229, 112, 90, .45); box-shadow: none; }
    textarea.input { min-height: 84px; font-size: 16px; }
    .count { justify-self: end; color: var(--ink-4); font-variant-numeric: tabular-nums; }
    .count.full { color: var(--warn); }
    .err { color: var(--warn); background: var(--warn-bg); padding: 8px 12px; border-radius: var(--r-sm); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .done { display: grid; gap: 8px; justify-items: start; }
    .thanks { color: var(--ink); }
    .thanks b { color: var(--gold-soft); }
    .agg { display: inline-flex; align-items: center; gap: 6px; }
    .agg-star { width: 16px; height: 16px; fill: var(--gold); }
    @media (prefers-reduced-motion: reduce) { .star:hover { transform: none; } }
  `],
})
export class PairReviewComponent {
  private reviews = inject(ReviewsService);
  private i18n = inject(I18nService);
  private prefs = inject(GuestPrefsService);
  readonly t = this.i18n.t;

  readonly drinkId = input.required<string>();
  readonly dishId = input.required<string>();
  readonly dishName = input<string>('');
  /** Балл движка, который гость видел (3..99) — сохраняется с отзывом для калибровки. */
  readonly score = input<number | null>(null);
  /** Контекст подбора (повод, личные настройки) — сохраняется с отзывом. */
  readonly ctx = input<Record<string, unknown> | null>(null);
  readonly venueSlug = input<string | null>(null);
  readonly table = input<number | null>(null);

  readonly uid = `ftr${++seq}`;
  readonly chips = REVIEW_CHIPS;
  readonly stars = [1, 2, 3, 4, 5] as const;
  readonly maxText = MAX_TEXT;
  readonly chipKey = chipKey;
  readonly starPath = 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z';

  readonly rating = signal(0);
  readonly hover = signal(0);
  readonly picked = signal<readonly ReviewChipId[]>([]);
  readonly helpful = signal<boolean | null>(null);
  readonly text = signal('');
  readonly phase = signal<'form' | 'sending' | 'done'>('form');
  readonly error = signal<string | null>(null);
  readonly own = signal<OwnReview | null>(null);
  readonly notes = signal<PrefNote[]>([]);
  readonly pending = signal(false);
  readonly justSent = signal(false);
  readonly aggregate = signal<ReviewAggregate | null>(null);

  readonly shown = computed(() => this.hover() || this.rating());
  readonly local = computed(() => this.reviews.mode === 'local' || this.own()?.where === 'device');
  readonly learnedLine = computed(() => {
    const notes = this.notes();
    return notes.length ? this.t('review.learned', { items: notes.map(n => this.prefs.noteText(n.id)).join(', ') }) : this.t('review.counted');
  });
  readonly aggLine = computed(() => {
    const a = this.aggregate();
    if (!a || a.n === 0) return this.t('review.none');
    if (!a.enough || a.mean === null) return this.t('review.few', { n: a.n });
    const locale = this.i18n.locale();
    return this.t('review.mean', { mean: fmtMean(a.mean, locale), count: this.t(countKey(a.n, locale), { n: a.n }) });
  });

  private loadToken = 0;

  constructor() {
    // Пара сменилась → показываем свой прошлый отзыв (если был) или пустую форму.
    effect(() => {
      const drink = this.drinkId(), dish = this.dishId(), name = this.dishName();
      untracked(() => this.reset(this.reviews.mine(drink, dish, name)));
    }, { allowSignalWrites: true });
  }

  starKey(n: number): I18nKey { return `review.star.${Math.min(5, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5}`; }
  isPicked(id: ReviewChipId): boolean { return this.picked().includes(id); }
  setRating(n: number): void { this.rating.set(n); this.error.set(null); }
  toggle(id: ReviewChipId): void { this.picked.update(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])); }
  setHelpful(v: boolean): void { this.helpful.update(cur => (cur === v ? null : v)); }
  onText(e: Event): void { this.text.set((e.target as HTMLTextAreaElement).value.slice(0, MAX_TEXT)); }
  edit(): void { this.justSent.set(false); this.phase.set('form'); }
  cancel(): void { this.reset(this.own()); }

  async submit(): Promise<void> {
    if (this.phase() === 'sending') return;
    if (!this.rating()) { this.error.set(this.t('review.needRating')); return; }
    this.phase.set('sending');
    this.error.set(null);
    const res = await this.reviews.submit({
      drinkId: this.drinkId(), dishId: this.dishId(), dishName: this.dishName(), rating: this.rating(), chips: this.picked(),
      text: this.text(), helpful: this.helpful(), score: this.score(), ctx: this.ctx(), venueSlug: this.venueSlug(), table: this.table(),
    });
    if (!res.ok) {
      this.phase.set('form');
      this.error.set(this.t(res.error === 'rate_limited' ? 'review.rateLimited' : res.error === 'invalid' ? 'review.invalid' : 'review.error'));
      return;
    }
    this.own.set(res.review);
    this.notes.set(res.applied.notes);
    this.pending.set(res.pending);
    this.aggregate.set(res.aggregate);
    this.justSent.set(true);
    this.phase.set('done');
  }

  private reset(own: OwnReview | null): void {
    this.own.set(own);
    this.rating.set(own?.rating ?? 0);
    this.hover.set(0);
    this.picked.set(own?.chips ?? []);
    this.helpful.set(own?.helpful ?? null);
    this.text.set(own?.text ?? '');
    this.error.set(null);
    this.notes.set([]);
    this.pending.set(false);
    this.justSent.set(false);
    this.aggregate.set(null);
    this.phase.set(own ? 'done' : 'form');
    if (own) void this.loadAggregate();
  }

  private async loadAggregate(): Promise<void> {
    const token = ++this.loadToken;
    const data = await this.reviews.pair(this.drinkId(), this.dishId(), this.dishName(), 1);
    if (token === this.loadToken && data) this.aggregate.set(data.aggregate);
  }
}
