import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { SaasService } from '../../core/saas.service';
import { CabinetReviews, ChipCount, PairRow, ReviewsService, fmtMean } from '../../core/reviews.service';
import { plural } from '../../core/format';
import { IconComponent } from '../../ui/icon.component';

/**
 * «Отзывы гостей» для кабинета заведения — самостоятельный блок: <ft-cabinet-reviews />.
 * Берёт токен из SaasService, данные — GET /api/cabinet/reviews/?days= (только своё заведение).
 * Показывает: сводку (оценок, средняя, «подбор помог», из заведения, на проверке), пары «на доработку»
 * (средняя ≤ 3 или гости ниже ожидания подбора), все пары, частые метки, последние опубликованные тексты.
 * Непроверенные тексты, столы и время не показываем. Без сервера (демо) отзывы не собираются — так и пишем.
 * Кабинет русскоязычный, как cabinet.page.ts.
 */
@Component({
  selector: 'ft-cabinet-reviews',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cr" aria-labelledby="cr-title">
      <div class="top">
        <div>
          <span class="eyebrow">Отзывы гостей</span>
          <h2 id="cr-title" class="h">Как гостям ваши пары</h2>
        </div>
        @if (saas.mode === 'api') {
          <div class="seg" role="group" aria-label="Период">
            @for (d of periods; track d) {
              <button type="button" [class.on]="days() === d" [attr.aria-pressed]="days() === d" [disabled]="d > historyDays()" (click)="days.set(d)">{{ d }} дн</button>
            }
          </div>
        }
      </div>

      @if (saas.mode === 'local') {
        <div class="card card-p mt12">
          <p class="empty">Оценок пока нет</p>
          <p class="muted sm mt8">В демо-режиме без сервера отзывы гостей не собираются: гость видит «Как вам пара?», но его оценка сохраняется только на его телефоне и сюда не приходит.</p>
        </div>
      } @else if (loading() && !data()) {
        <div class="skeleton sk mt12" aria-hidden="true"></div>
      } @else if (failed()) {
        <div class="soft warn mt12" role="alert">Не удалось загрузить отзывы. <button type="button" class="link" (click)="reload()">Повторить</button></div>
      } @else { @if (data(); as d) {
        @if (!d.summary.published && !d.summary.pending) {
          <div class="card card-p mt12">
            <p class="empty">Оценок пока нет</p>
            <p class="muted sm mt8">После подбора гость видит «Как вам пара?» — оценки за {{ d.days }} дн. появятся здесь.</p>
          </div>
        } @else {
          <div class="kpis mt12">
            <div class="kpi"><span class="kv">{{ d.summary.published }}</span><span class="kl">{{ word(d.summary.published, 'оценка', 'оценки', 'оценок') }} за {{ d.days }} дн.</span></div>
            <div class="kpi">
              <span class="kv">{{ d.aggregate.mean !== null ? mean(d.aggregate.mean) + ' ★' : '—' }}</span>
              <span class="kl">{{ d.aggregate.enough ? 'средняя (с поправкой на число оценок)' : 'мало оценок для средней' }}</span>
            </div>
            <div class="kpi"><span class="kv">{{ d.aggregate.helpful_pct !== null ? d.aggregate.helpful_pct + '%' : '—' }}</span><span class="kl">«подбор помог»</span></div>
            <div class="kpi"><span class="kv">{{ d.summary.verified }}</span><span class="kl">из заведения (скан QR)</span></div>
            <div class="kpi"><span class="kv">{{ d.summary.pending }}</span><span class="kl">текстов на проверке</span></div>
          </div>

          @if (d.low_rated.length) {
            <div class="card card-p mt12 fix">
              <div class="flex ac g8"><ft-icon name="flame" [size]="18" /><b>Пары на доработку</b></div>
              <p class="muted xs mt8">Средняя ≤ 3 ★ или гости ставят заметно ниже, чем обещает подбор. Проверьте подачу и температуру, попросите сомелье перепробовать пару или предложите гостям другую.</p>
              <ul class="rows mt12">
                @for (p of d.low_rated; track rowKey(p)) {
                  <li class="row">
                    <div class="grow min0">
                      <div class="pair">{{ pairName(p) }}</div>
                      <div class="xs muted">{{ pairLine(p) }}</div>
                      @if (negChips(p).length) {
                        <div class="chips mt8">@for (c of negChips(p); track c.id) { <span class="chip chip-sm neg">{{ c.label }} · {{ c.n }}</span> }</div>
                      }
                    </div>
                    <span class="score low">{{ p.aggregate.mean !== null ? mean(p.aggregate.mean) : '—' }}</span>
                  </li>
                }
              </ul>
            </div>
          }

          <div class="grid2 mt12">
            <div class="card card-p">
              <b>Все пары</b>
              @if (d.pairs.length) {
                <ul class="rows mt12">
                  @for (p of d.pairs; track rowKey(p)) {
                    <li class="row">
                      <div class="grow min0"><div class="pair">{{ pairName(p) }}</div><div class="xs muted">{{ word(p.aggregate.n, 'оценка', 'оценки', 'оценок') }}</div></div>
                      <span class="score" [class.low]="p.aggregate.mean !== null && p.aggregate.mean <= 3">{{ p.aggregate.enough && p.aggregate.mean !== null ? mean(p.aggregate.mean) : 'мало оценок' }}</span>
                    </li>
                  }
                </ul>
              } @else { <p class="muted sm mt8">Опубликованных оценок пока нет — тексты ждут проверки.</p> }
            </div>

            <div class="card card-p">
              <b>Что отмечают гости</b>
              @if (d.chips.length) {
                <ul class="bars mt12">
                  @for (c of d.chips; track c.id) {
                    <li>
                      <div class="flex jb sm"><span>{{ c.label }}</span><b>{{ c.n }}</b></div>
                      <div class="bar thin" [class.neg]="c.polarity < 0"><i [style.width.%]="c.n / maxChip() * 100"></i></div>
                    </li>
                  }
                </ul>
              } @else { <p class="muted sm mt8">Меток пока мало — они появятся, когда оценок будет от трёх.</p> }
            </div>
          </div>

          @if (d.reviews.length) {
            <div class="card card-p mt12">
              <b>Последние отзывы</b>
              <ul class="texts mt12">
                @for (r of d.reviews; track r.id) {
                  <li>
                    <div class="flex ac g8 wrap xs">
                      <b class="stars-n">★ {{ r.rating }}</b>
                      <span class="dim">{{ r.drink_name }} × {{ r.dish_name }}</span>
                      @if (r.verified) { <span class="badge badge-ok">из заведения</span> }
                      <span class="muted date">{{ r.date }}</span>
                    </div>
                    <p class="sm mt8">{{ r.text }}</p>
                    @if (r.summary) { <p class="xs muted mt8"><ft-icon name="sparkles" [size]="12" /> {{ r.summary }}</p> }
                  </li>
                }
              </ul>
            </div>
          }
        }
      } }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .top { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .h { font-size: 1.5rem; margin-top: 4px; }
    .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--r-full); background: var(--surface); border: 1px solid var(--line); }
    .seg button { padding: 6px 10px; font-size: .78rem; font-weight: 700; border-radius: var(--r-full); color: var(--ink-2); }
    .seg button.on { background: var(--ink); color: var(--bg); }
    .seg button:disabled { opacity: .4; }
    .sk { height: 120px; }
    .empty { font-family: var(--font-display); font-size: 1.3rem; }
    .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    @media (min-width: 720px) { .kpis { grid-template-columns: repeat(5, 1fr); } }
    .kpi { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px; display: grid; gap: 2px; }
    .kv { font-family: var(--font-display); font-weight: 800; font-size: 1.5rem; font-variant-numeric: lining-nums tabular-nums; }
    .kl { font-size: .72rem; color: var(--ink-3); }
    .fix { border-color: rgba(229, 112, 90, .35); }
    .grid2 { display: grid; gap: 12px; }
    @media (min-width: 900px) { .grid2 { grid-template-columns: 1fr 1fr; } }
    .rows, .bars, .texts { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
    .row { display: flex; gap: 10px; align-items: center; padding-top: 10px; border-top: 1px solid var(--line-2); }
    .row:first-child { border-top: 0; padding-top: 0; }
    .min0 { min-width: 0; }
    .pair { font-weight: 700; font-size: .9rem; overflow-wrap: anywhere; }
    .score { font-family: var(--font-display); font-weight: 800; font-size: 1.2rem; color: var(--gold-soft); white-space: nowrap; }
    .score.low { color: var(--warn); }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip.neg { background: var(--warn-bg); color: var(--warn); border-color: transparent; }
    .bar.neg > i { background: linear-gradient(90deg, rgba(229, 112, 90, .55), var(--warn)); }
    .texts li { padding-top: 10px; border-top: 1px solid var(--line-2); }
    .texts li:first-child { border-top: 0; padding-top: 0; }
    .stars-n { color: var(--gold); }
    .date { margin-left: auto; }
    .link { color: var(--amber-700); font-weight: 700; text-decoration: underline; }
    .soft.warn { background: var(--warn-bg); color: var(--warn); padding: 10px 14px; border-radius: var(--r-md); }
  `],
})
export class CabinetReviewsComponent {
  readonly saas = inject(SaasService);
  private reviews = inject(ReviewsService);
  readonly periods = [7, 30, 90] as const;
  readonly historyDays = computed(() => this.saas.session()?.limits.history_days ?? 14);
  readonly days = signal<number>(30);
  readonly data = signal<CabinetReviews | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly maxChip = computed(() => Math.max(1, ...(this.data()?.chips ?? []).map(c => c.n)));
  private token = 0;
  private started = false;

  constructor() {
    effect(() => {
      const session = this.saas.session(), days = this.days(), history = this.historyDays();
      untracked(() => {
        if (!this.started) {                      // первый запуск: период не длиннее истории тарифа
          this.started = true;
          if (days > history) { this.days.set(Math.min(30, history)); return; }
        }
        void this.load(session?.token ?? '', Math.min(days, history));
      });
    }, { allowSignalWrites: true });
  }

  reload(): void { void this.load(this.saas.session()?.token ?? '', Math.min(this.days(), this.historyDays())); }

  mean(x: number): string { return fmtMean(x, 'ru'); }
  word(n: number, one: string, few: string, many: string): string { return plural(n, one, few, many); }
  rowKey(p: PairRow): string { return `${p.drink_id ?? ''}|${p.dish_id}|${p.dish_name}`; }
  pairName(p: PairRow): string { return `${p.drink_name ?? p.drink_id ?? ''} × ${p.dish_name}`; }
  negChips(p: PairRow): ChipCount[] { return p.aggregate.chips.filter(c => c.polarity < 0).slice(0, 3); }
  pairLine(p: PairRow): string {
    const a = p.aggregate;
    const parts = [plural(a.n, 'оценка', 'оценки', 'оценок')];
    if (a.raw_mean !== null) parts.push(`гости в среднем ${fmtMean(a.raw_mean, 'ru')} ★`);
    parts.push(`подбор ждал ≈ ${fmtMean(a.expected, 'ru')} ★`);
    if (a.disagreement?.direction === 'lower') parts.push(`ниже ожидания на ${fmtMean(Math.abs(a.disagreement.delta), 'ru')} ★`);
    return parts.join(' · ');
  }

  private async load(token: string, days: number): Promise<void> {
    if (this.saas.mode !== 'api' || !token) return;
    const ticket = ++this.token;
    this.loading.set(true);
    this.failed.set(false);
    const res = await this.reviews.cabinet(token, days);
    if (ticket !== this.token) return;
    this.loading.set(false);
    if (res) this.data.set(res); else this.failed.set(true);
  }
}
