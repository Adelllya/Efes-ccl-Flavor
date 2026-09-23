import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { I18nService } from '../core/i18n.service';
import {
  ChipCount, DrinkReviews, PairReviews, PublicReview, ReviewAggregate, ReviewsService, chipKey, countKey, fmtMean,
} from '../core/reviews.service';
import { IconComponent } from './icon.component';

interface SummaryState { aggregate: ReviewAggregate | null; top: ChipCount[]; reviews: PublicReview[]; }

/**
 * Сводка отзывов гостей: по паре (drinkId + dishId) или по напитку (только drinkId — все блюда).
 * Сжатая средняя (одна цифра после запятой) и число оценок, частые метки, 2–3 последних опубликованных текста
 * с метками ИИ-разбора. Честные пустые состояния: «Оценок пока нет», «Мало оценок: n» (средняя по 1–2 оценкам
 * ничего не значит — её и сервер не отдаёт). Без сервера — «Оценок пока нет» и, если гость оценивал пару здесь,
 * «Ваша оценка … · сохранено только на этом устройстве».
 * Готовые данные можно передать в [data] — тогда запроса нет.
 */
@Component({
  selector: 'ft-review-summary',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rs" [attr.aria-label]="t('review.summary.title')" [attr.aria-busy]="loading()">
      <span class="eyebrow plain">{{ t('review.summary.title') }}</span>

      @if (loading() && !state()) {
        <div class="skeleton sk" aria-hidden="true"></div>
      } @else {
        @if (agg(); as a) {
          @if (a.enough && a.mean !== null) {
            <div class="score">
              <span class="big num" aria-hidden="true">{{ mean(a.mean) }}</span>
              <div class="side">
                <span class="stars" role="img" [attr.aria-label]="t('review.summary.aria', { mean: mean(a.mean), count: count(a.n) })">
                  <span class="base" aria-hidden="true">★★★★★</span>
                  <span class="fill" aria-hidden="true" [style.width.%]="a.mean / 5 * 100">★★★★★</span>
                </span>
                <span class="xs muted">{{ count(a.n) }}@if (a.helpful_pct !== null) { · {{ t('review.helpfulPct', { pct: a.helpful_pct }) }} }</span>
              </div>
            </div>
            @if (top().length) {
              <div class="chips">
                @for (c of top(); track c.id) {
                  <span class="chip chip-sm" [class.neg]="c.polarity < 0">{{ t(chipKey(c.id)) }} <b class="n">{{ c.n }}</b></span>
                }
              </div>
            }
          } @else if (a.n > 0) {
            <p class="empty sm">{{ t('review.few', { n: a.n }) }}</p>
          } @else {
            <p class="empty sm">{{ t('review.none') }}</p>
          }
        } @else {
          <p class="empty sm">{{ t('review.none') }}</p>
        }

        @if (texts().length) {
          <ul class="texts">
            @for (r of texts(); track r.id) {
              <li class="item">
                <div class="meta">
                  <span class="mini" role="img" [attr.aria-label]="t('review.ratingAria', { n: r.rating })">★ {{ r.rating }}</span>
                  @if (r.verified) { <span class="badge badge-ok">{{ t('review.verified') }}</span> }
                  @if (!dishId() && r.dish_name) { <span class="xs dim ellipsis">{{ dishLabel(r) }}</span> }
                  <span class="xs muted date">{{ r.date }}</span>
                </div>
                <p class="txt sm">{{ r.text }}</p>
                @if (r.aspects.length) {
                  <div class="aspects" role="group" [attr.aria-label]="t('review.ai.aria')">
                    <ft-icon name="sparkles" [size]="12" />
                    @for (id of r.aspects.slice(0, 3); track id) { <span class="chip chip-sm ai">{{ t(chipKey(id)) }}</span> }
                  </div>
                }
              </li>
            }
          </ul>
        }
      }

      @if (own(); as o) {
        <p class="own xs muted">{{ t('review.yours', { n: o.rating }) }}@if (o.where === 'device') { · {{ t('review.localOnly') }} } @else if (o.status !== 'published' && o.text) { · {{ t('review.onCheck') }} }</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .rs { display: grid; gap: 10px; }
    .sk { height: 58px; }
    .score { display: flex; align-items: center; gap: 12px; }
    .big { font-size: 2.4rem; line-height: 1; color: var(--gold-soft); }
    .side { display: grid; gap: 2px; }
    .stars { position: relative; display: inline-block; font-size: 1.05rem; letter-spacing: 2px; line-height: 1; }
    .stars .base { color: var(--ink-4); }
    .stars .fill { position: absolute; inset: 0 auto 0 0; overflow: hidden; white-space: nowrap; color: var(--gold); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip .n { font-weight: 800; color: var(--gold-soft); margin-left: 2px; }
    .chip.neg .n { color: var(--warn); }
    .empty { color: var(--ink-3); }
    .texts { list-style: none; display: grid; gap: 10px; padding: 0; margin: 0; }
    .item { display: grid; gap: 6px; padding: 12px 14px; border-radius: var(--r-md); background: var(--surface-2); border: 1px solid var(--line-2); }
    .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
    .mini { font-weight: 800; color: var(--gold); font-size: .85rem; font-variant-numeric: tabular-nums; }
    .date { margin-left: auto; }
    .txt { color: var(--ink-2); white-space: pre-line; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
    .aspects { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--violet); }
    .chip.ai { min-height: 24px; padding: 0 8px; font-size: .72rem; background: var(--violet-bg); color: var(--violet); border-color: transparent; }
    .own { margin-top: 2px; }
  `],
})
export class ReviewSummaryComponent {
  private reviews = inject(ReviewsService);
  private i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly chipKey = chipKey;

  readonly drinkId = input.required<string>();
  /** Пусто — сводка по напитку (все блюда). */
  readonly dishId = input<string>('');
  readonly dishName = input<string>('');
  /** Готовые данные (например, из ответа на отправку) — без запроса к серверу. */
  readonly data = input<PairReviews | DrinkReviews | null>(null);
  /** Сколько последних текстов показать (2–3 по умолчанию). */
  readonly limit = input<number>(3);

  readonly state = signal<SummaryState | null>(null);
  readonly loading = signal(false);
  readonly agg = computed(() => this.state()?.aggregate ?? null);
  readonly top = computed(() => (this.state()?.top ?? []).slice(0, 4));
  readonly texts = computed(() => (this.state()?.reviews ?? []).filter(r => r.text).slice(0, this.limit()));
  readonly own = computed(() => {
    this.reviews.saved();                        // свой отзыв мог появиться только что
    const dish = this.dishId();
    return dish ? this.reviews.mine(this.drinkId(), dish, this.dishName()) : null;
  });

  private token = 0;

  constructor() {
    effect(() => {
      const drink = this.drinkId(), dish = this.dishId(), name = this.dishName(), given = this.data(), limit = this.limit();
      this.reviews.saved();                      // после отправки отзыва сводку стоит перечитать
      untracked(() => {
        const token = ++this.token;
        if (given) { this.state.set(this.normalize(given)); this.loading.set(false); return; }
        this.loading.set(true);
        const request = dish ? this.reviews.pair(drink, dish, name, limit) : this.reviews.drink(drink, limit);
        void request.then(res => {
          if (token !== this.token) return;       // пока ждали, пара сменилась
          this.state.set(res ? this.normalize(res) : null);
          this.loading.set(false);
        });
      });
    }, { allowSignalWrites: true });
  }

  mean(x: number): string { return fmtMean(x, this.i18n.locale()); }
  count(n: number): string { return this.t(countKey(n, this.i18n.locale()), { n }); }
  dishLabel(r: PublicReview): string { return r.dish_id === 'custom' ? r.dish_name : this.i18n.dishNameById(r.dish_id, r.dish_name); }

  private normalize(res: PairReviews | DrinkReviews): SummaryState {
    const top = 'top_chips' in res ? res.top_chips : res.aggregate.chips;
    return { aggregate: res.aggregate, top: top ?? [], reviews: res.reviews ?? [] };
  }
}
