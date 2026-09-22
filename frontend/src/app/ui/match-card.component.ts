import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../core/data.service';
import { Match } from '../core/pairing.service';
import { abv } from '../core/format';
import { ScoreRingComponent } from './score-ring.component';
import { IconComponent } from './icon.component';
import { RadarComponent } from './radar.component';
import { I18nService } from '../core/i18n.service';

/** Результат подбора: сорт (или блюдо в обратном режиме), оценка, тип пары, «почему» и разбор по правилам. Язык ru/kk/en — через I18nService. */
@Component({
  selector: 'ft-match',
  standalone: true,
  imports: [RouterLink, ScoreRingComponent, IconComponent, RadarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card mc" [class.top]="rank() === 1" [style.--accent]="m().beer.accent || 'var(--amber-300)'">
      @if (rank() === 1) { <div class="crown"><ft-icon name="trophy" [size]="14" /> {{ t('match.best') }}</div> }
      <div class="head">
        @if (mode() === 'beer') {
          <a class="thumb" [routerLink]="['/beers', m().beer.id]"><img [src]="data.brandImage(m().beer)" [alt]="m().beer.display_name" loading="lazy" /></a>
        } @else {
          <div class="thumb emoji">{{ m().dish.emoji }}</div>
        }
        <div class="title">
          <div class="chips">
            <span class="badge badge-type" [class]="'badge badge-type ' + m().match_type">{{ typeShort() }}</span>
            @if (m().sommelier_pick) { <span class="badge pick"><ft-icon name="star" [size]="11" /> {{ t('common.sommPick') }}</span> }
          </div>
          @if (mode() === 'beer') {
            <a [routerLink]="['/beers', m().beer.id]"><h3>{{ m().beer.display_name }}</h3></a>
            <p class="sub">{{ i18n.styleLabel(m().beer) }} · {{ abvText() }} · {{ m().beer.serving.temp_min }}–{{ m().beer.serving.temp_max }} °C</p>
          } @else {
            <h3>{{ i18n.dishName(m().dish) }}</h3>
            <p class="sub">{{ m().dish.cuisine_flag }} {{ i18n.cuisineLabel(m().dish) }} · {{ i18n.tasteLabel(m().dish.dominant_taste, m().dish.dominant_taste_label) }} · {{ i18n.weightLabel(m().dish.weight, m().dish.weight_label) }}</p>
          }
        </div>
        <ft-score [score]="m().score" [size]="rank() === 1 ? 72 : 60" />
      </div>
      <p class="verdict">{{ i18n.verdict(m().verdict) }}</p>
      <ul class="reasons">
        @for (r of m().reasons; track r.rule) {
          <li><ft-icon name="check" [size]="16" /><span>{{ i18n.reason(r) }}</span></li>
        }
        @for (w of m().warnings; track w.rule) {
          <li class="warn"><ft-icon name="info" [size]="16" /><span>{{ i18n.reason(w) }}</span></li>
        }
      </ul>
      <!-- цитата сомелье пока только на русском (pairings_curated.json) -->
      @if (m().curated?.explanation && !m().sommelier_pick) { <p class="somm">{{ t('match.somm', { text: m().curated!.explanation }) }}</p> }
      @if (m().sommelier_pick) { <p class="somm">{{ t('match.somm', { text: m().curated!.explanation }) }}</p> }
      <div class="actions">
        <button type="button" class="btn btn-ghost btn-sm" (click)="open.set(!open())" [attr.aria-expanded]="open()">
          <ft-icon [name]="open() ? 'chevron-down' : 'chevron-right'" [size]="16" /> {{ open() ? t('match.why.close') : t('match.why.open') }}
        </button>
        @if (mode() === 'beer') {
          <a class="btn btn-secondary btn-sm" [routerLink]="['/beers', m().beer.id]">{{ t('match.pyramid') }} <ft-icon name="arrow-right" [size]="16" /></a>
        } @else {
          <a class="btn btn-secondary btn-sm" [routerLink]="['/pair', m().dish.id]">{{ t('match.allBeers') }} <ft-icon name="arrow-right" [size]="16" /></a>
        }
      </div>
      @if (open()) {
        <div class="breakdown reveal">
          <div class="bd-grid">
            <div>
              <div class="bd-title">{{ t('match.contrib') }} · Σ = {{ total() }} → {{ m().score }}/99</div>
              @for (c of sorted(); track c.rule) {
                <div class="rule" [class.neg]="c.points < 0">
                  <div class="rl"><span class="rn">{{ ruleName(c.rule) }}</span><span class="rp">{{ c.points > 0 ? '+' : '' }}{{ c.points }}</span></div>
                  <div class="rb"><i [style.width.%]="barW(c.points)" [style.margin-left.%]="c.points < 0 ? 50 - barW(c.points) : 50"></i></div>
                  <div class="rt">{{ i18n.reason(c) }}</div>
                </div>
              }
              <div class="intensity">{{ t('match.intensity', { beer: pct(m().intensity.beer), dish: pct(m().intensity.dish), conf: pct(m().confidence) }) }}</div>
            </div>
            <div class="bd-radar"><div class="bd-title">{{ t('match.profile', { beer: m().beer.display_name }) }}</div><ft-radar [vector]="m().beerProfile.vector" /></div>
          </div>
        </div>
      }
    </article>
  `,
  styles: [`
    .mc { padding: 16px; position: relative; overflow: hidden; }
    .mc.top { border-color: rgba(224, 138, 40, .55); box-shadow: var(--shadow-2), inset 0 0 0 1px rgba(245, 185, 66, .25); }
    .crown { display: inline-flex; align-items: center; gap: 6px; background: var(--grad-amber); color: #fff; font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 4px 10px; border-radius: var(--r-full); margin-bottom: 10px; }
    .head { display: grid; grid-template-columns: 64px 1fr auto; gap: 12px; align-items: center; }
    .thumb { width: 64px; height: 84px; border-radius: 12px; background: radial-gradient(80% 60% at 50% 100%, color-mix(in srgb, var(--accent) 30%, transparent), transparent), var(--surface-2); display: grid; place-items: center; overflow: hidden; }
    .thumb img { height: 90%; width: auto; object-fit: contain; filter: drop-shadow(0 6px 8px rgba(60,30,5,.25)); }
    .thumb.emoji { font-size: 2.2rem; height: 64px; }
    .title { min-width: 0; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
    h3 { font-size: 1.12rem; line-height: 1.15; }
    .sub { color: var(--ink-3); font-size: .8rem; margin-top: 3px; }
    .verdict { margin-top: 12px; font-family: var(--font-display); font-weight: 700; color: var(--amber-700); font-size: .95rem; }
    .reasons { list-style: none; margin-top: 8px; display: grid; gap: 6px; }
    .reasons li { display: flex; gap: 8px; align-items: flex-start; font-size: .9rem; color: var(--ink-2); line-height: 1.4; }
    .reasons li ft-icon { color: var(--ok); margin-top: 2px; flex-shrink: 0; }
    .reasons li.warn ft-icon { color: var(--warn); }
    .somm { margin-top: 10px; font-family: var(--font-accent); font-style: italic; color: var(--ink-2); font-size: .92rem; padding: 10px 12px; background: var(--amber-100); border-radius: var(--r-md); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .breakdown { margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 12px; }
    .bd-grid { display: grid; gap: 16px; }
    @media (min-width: 720px) { .bd-grid { grid-template-columns: 1fr 220px; } }
    .bd-title { font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); margin-bottom: 8px; }
    .rule { margin-bottom: 8px; }
    .rl { display: flex; justify-content: space-between; font-size: .84rem; font-weight: 600; }
    .rp { font-variant-numeric: tabular-nums; color: var(--ok); }
    .neg .rp { color: var(--warn); }
    .rb { height: 6px; background: var(--amber-100); border-radius: 3px; position: relative; margin: 3px 0; }
    .rb i { display: block; height: 100%; background: var(--ok); border-radius: 3px; }
    .neg .rb i { background: var(--warn); }
    .rt { font-size: .76rem; color: var(--ink-3); }
    .intensity { font-size: .74rem; color: var(--ink-4); margin-top: 6px; }
    @media (max-width: 480px) { .head { grid-template-columns: 56px 1fr auto; } .thumb { width: 56px; height: 74px; } }
  `],
})
export class MatchCardComponent {
  data = inject(DataService);
  i18n = inject(I18nService);
  /** t() читает сигнал языка — шаблон и typeShort() пересчитываются при его смене. */
  readonly t = this.i18n.t;
  m = input.required<Match>();
  rank = input<number>(0);
  mode = input<'beer' | 'dish'>('beer');
  open = signal(false);
  typeShort = computed(() => this.t(`match.short.${this.m().match_type}` as const));
  abvText = computed(() => abv(this.m().beer));
  sorted = computed(() => [...this.m().contributions].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)));
  total = computed(() => Math.round(this.m().contributions.reduce((s, c) => s + c.points, 0) * 10) / 10);
  pct(x: number): number { return Math.round(x * 100); }
  barW(p: number): number { return Math.min(50, (Math.abs(p) / 25) * 50); }
  ruleName(r: string): string { return this.i18n.ruleName(r, RULE_NAMES[r] ?? r); }
}

export const RULE_NAMES: Record<string, string> = {
  intensity: 'Интенсивность', cut: 'Очищение жира', heat: 'Острота', salt: 'Соль', sweet: 'Сладость', sour: 'Кислота', umami: 'Умами',
  fresh: 'Деликатность', roast: 'Корочка', smoke: 'Дым ↔ хмель', bridge: 'Мост ароматов', curated: 'Сомелье', occasion: 'Повод', bitter_pref: 'Горечь', dna: 'Flavor DNA',
};
