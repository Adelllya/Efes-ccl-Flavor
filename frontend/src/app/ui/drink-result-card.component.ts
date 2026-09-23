import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DrinkV2 } from '../core/data-v2.service';
import { I18nKey, I18nService } from '../core/i18n.service';
import { Mechanism, PairResult, WarningItem } from '../engine/pairing-engine-v2';
import { DrinkArtComponent } from './drink-art.component';
import { IconComponent } from './icon.component';
import { ScoreRingComponent } from './score-ring.component';

const TYPE_VAR: Record<string, string> = {
  cut: 'var(--t-cleanse)', complement: 'var(--t-complement)', contrast: 'var(--t-contrast)', bridge: 'var(--t-bridge)',
  balance: 'var(--gold)', context: 'var(--ink-3)', penalty: 'var(--warn)',
};
const EVIDENCE = new Set(['A', 'B', 'C', 'D', 'G']);

/**
 * Результат подбора v2: напиток, честный балл, тип пары, причины с уровнем доказательности (A–D),
 * предупреждения и вето, надёжность профиля напитка и полный разбор по правилам.
 */
@Component({
  selector: 'ft-drink-result',
  standalone: true,
  imports: [RouterLink, DrinkArtComponent, IconComponent, ScoreRingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card dr" [class.top]="rank() === 1" [class.gilded]="rank() === 1">
      @if (crown()) { <div class="crown"><ft-icon name="trophy" [size]="14" /> {{ t('match.best') }}</div> }
      @else if (promoted()) { <div class="crown promoted" [attr.title]="t('v2.pair.policy', { n: window() })">{{ t('v2.card.promoted', { n: window() }) }}</div> }
      <div class="head">
        <a class="art" [routerLink]="['/drinks', drink().id]" [attr.aria-label]="drink().name">
          <ft-drink-art [drink]="drink()" [size]="rank() === 1 ? 84 : 72" [preferPhoto]="!!drink().image" [glow]="rank() === 1" />
        </a>
        <div class="title">
          <div class="chips">
            <span class="type" [style.--tc]="typeColor(r().match_type)">{{ typeLabel(r().match_type) }}</span>
            @if (r().secondary_type && r().secondary_type !== r().match_type) {
              <span class="type sec" [style.--tc]="typeColor(r().secondary_type!)">+ {{ typeLabel(r().secondary_type!) }}</span>
            }
            @if (r().classic) { <span class="badge"><ft-icon name="star" [size]="11" /> {{ t('v2.card.classic') }}</span> }
            @if (r().efes_partner) { <span class="badge efes">{{ t('v2.card.efes') }}</span> }
          </div>
          <a [routerLink]="['/drinks', drink().id]" class="nm"><h3>{{ drink().name }}</h3></a>
          <p class="sub">{{ sub() }}</p>
        </div>
        <ft-score [score]="r().score" [size]="rank() === 1 ? 72 : 60" />
      </div>

      <p class="verdict" [class.warn]="r().capped || r().band === 'not_recommended'">{{ r().band_label }}</p>

      <ul class="reasons">
        @for (m of reasons(); track m.rule + m.key) {
          <li>
            <span class="ev" [attr.data-ev]="m.evidence" [attr.title]="evTitle(m.evidence)">{{ m.evidence }}</span>
            <span>{{ m.text }}</span>
          </li>
        }
        @for (w of warnings(); track w.rule + w.key) {
          <li class="warn">
            <ft-icon name="info" [size]="16" />
            <span>{{ w.text }}@if (isVeto(w)) { <em class="cap"> · {{ t('v2.card.veto') }} {{ capOf(w) }}</em> }</span>
          </li>
        }
      </ul>

      <div class="meta">
        <span class="conf" [attr.title]="confTitle()"><i [style.width.%]="confPct()"></i></span>
        <span>{{ t('v2.card.profile', { source: sourceLabel(), conf: confPct() }) }}</span>
        @if (drink().flags?.abv_unknown) { <span class="dim">· {{ t('v2.card.abvUnknown') }}</span> }
        @if (price(); as p) { <span class="price">{{ t('v2.card.price', { price: p }) }}</span> }
      </div>

      <div class="actions">
        <button type="button" class="btn btn-ghost btn-sm" (click)="open.set(!open())" [attr.aria-expanded]="open()">
          <ft-icon [name]="open() ? 'chevron-down' : 'chevron-right'" [size]="16" /> {{ open() ? t('match.why.close') : t('match.why.open') }}
        </button>
        <a class="btn btn-secondary btn-sm" [routerLink]="['/drinks', drink().id]">{{ t('v2.card.drink') }} <ft-icon name="arrow-right" [size]="16" /></a>
      </div>

      @if (open()) {
        <div class="breakdown reveal">
          <div class="bd-title">{{ t('v2.card.why') }} · {{ t('match.contrib') }}: Σ {{ core() }} → {{ r().score }}/99</div>
          @for (c of sorted(); track c.rule + c.key) {
            <div class="rule" [class.neg]="c.points < 0">
              <div class="rl">
                <span class="rn"><span class="ev sm" [attr.data-ev]="c.evidence" [attr.title]="evTitle(c.evidence)">{{ c.evidence }}</span> {{ ruleName(c.rule) }}</span>
                <span class="rp">{{ c.points > 0 ? '+' : '' }}{{ c.points }}</span>
              </div>
              <div class="rb"><i [style.width.%]="barW(c.points)" [style.margin-left.%]="c.points < 0 ? 50 - barW(c.points) : 50"></i></div>
              <div class="rt">{{ c.text }}</div>
            </div>
          }
          <p class="intensity">{{ t('v2.card.intensity', { wb: fx(r().W_B), wd: fx(r().W_D), fb: fx(r().F_B), fd: fx(r().F_D) }) }}</p>
          <ng-content />
        </div>
      }
    </article>
  `,
  styles: [`
    :host { display: block; }
    .dr { padding: 16px; position: relative; overflow: hidden; }
    .dr.top { border-color: rgba(229, 184, 73, .45); box-shadow: var(--shadow-2), inset 0 0 0 1px rgba(229, 184, 73, .18); }
    .crown.promoted { background: rgba(229, 184, 73, .12); color: var(--gold-soft); border: 1px solid rgba(229, 184, 73, .35); cursor: help; }
    .crown { display: inline-flex; align-items: center; gap: 6px; background: var(--grad-amber); color: var(--on-gold); font-size: .7rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding: 4px 10px; border-radius: var(--r-full); margin-bottom: 10px; }
    .head { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; }
    .art { display: grid; place-items: center; width: 76px; min-height: 92px; border-radius: 14px; background: radial-gradient(70% 55% at 50% 90%, var(--gold-glow), transparent), var(--surface-2); }
    .top .art { width: 88px; min-height: 104px; }
    .title { min-width: 0; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
    .type { --tc: var(--gold); display: inline-flex; align-items: center; padding: 3px 9px; border-radius: var(--r-full); font-size: .7rem; font-weight: 700; letter-spacing: .04em; color: var(--tc); background: color-mix(in srgb, var(--tc) 14%, transparent); border: 1px solid color-mix(in srgb, var(--tc) 40%, transparent); }
    .type.sec { opacity: .85; }
    .badge.efes { color: var(--ink); background: rgba(229, 184, 73, .16); }
    .nm { color: inherit; }
    h3 { font-family: var(--font-display); font-size: 1.22rem; font-weight: 700; line-height: 1.12; }
    .sub { color: var(--ink-3); font-size: .8rem; margin-top: 3px; }
    .verdict { margin-top: 12px; font-family: var(--font-display); font-style: italic; font-weight: 600; color: var(--gold-soft); font-size: 1.02rem; }
    .verdict.warn { color: var(--warn); }
    .reasons { list-style: none; margin-top: 8px; display: grid; gap: 7px; padding: 0; }
    .reasons li { display: flex; gap: 9px; align-items: flex-start; font-size: .9rem; color: var(--ink-2); line-height: 1.4; }
    .reasons li.warn { color: var(--ink-2); }
    .reasons li.warn ft-icon { color: var(--warn); margin-top: 2px; flex-shrink: 0; }
    .cap { font-style: normal; color: var(--warn); font-weight: 600; }
    .ev { flex-shrink: 0; display: inline-grid; place-items: center; width: 20px; height: 20px; margin-top: 1px; border-radius: 6px; font-size: .68rem; font-weight: 800; font-family: var(--font-body); color: var(--evc, var(--gold)); border: 1px solid color-mix(in srgb, var(--evc, var(--gold)) 50%, transparent); background: color-mix(in srgb, var(--evc, var(--gold)) 12%, transparent); cursor: help; }
    .ev.sm { width: 17px; height: 17px; font-size: .62rem; margin: 0 4px 0 0; }
    .ev[data-ev="A"] { --evc: var(--ok); } .ev[data-ev="B"] { --evc: var(--info); } .ev[data-ev="C"] { --evc: var(--gold); } .ev[data-ev="D"] { --evc: var(--ink-3); } .ev[data-ev="G"] { --evc: var(--violet); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 12px; font-size: .76rem; color: var(--ink-3); }
    .meta .dim { color: var(--ink-4); }
    .conf { display: inline-block; width: 38px; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; }
    .conf i { display: block; height: 100%; background: var(--gold); border-radius: 3px; }
    .price { margin-left: auto; color: var(--gold-soft); font-weight: 700; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .breakdown { margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 12px; }
    .bd-title { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); margin-bottom: 10px; }
    .rule { margin-bottom: 9px; }
    .rl { display: flex; justify-content: space-between; align-items: center; font-size: .82rem; font-weight: 600; }
    .rn { display: inline-flex; align-items: center; }
    .rp { font-variant-numeric: tabular-nums; color: var(--ok); }
    .neg .rp { color: var(--warn); }
    .rb { height: 5px; background: var(--line); border-radius: 3px; position: relative; margin: 4px 0; }
    .rb i { display: block; height: 100%; background: var(--ok); border-radius: 3px; }
    .neg .rb i { background: var(--warn); }
    .rt { font-size: .78rem; color: var(--ink-3); line-height: 1.35; }
    .intensity { font-size: .74rem; color: var(--ink-4); margin-top: 8px; }
    @media (max-width: 480px) { .art { width: 64px; min-height: 80px; } .top .art { width: 72px; min-height: 92px; } h3 { font-size: 1.1rem; } }
  `],
})
export class DrinkResultCardComponent {
  i18n = inject(I18nService);
  readonly t = this.i18n.t;
  r = input.required<PairResult>();
  drink = input.required<DrinkV2>();
  rank = input<number>(0);
  /** цена позиции в меню заведения, ₸ */
  price = input<number | null>(null);
  /** «Лучшая пара» — только у напитка с наивысшим баллом в списке */
  crown = input<boolean>(false);
  /** Efes, поднятый политикой: отстаёт от лучшего не больше чем на window баллов */
  promoted = input<boolean>(false);
  window = input<number>(2);
  /** раскрыт ли разбор; двусторонняя привязка [(open)] — родитель может лениво показывать отзывы внутри */
  open = model<boolean>(false);

  readonly reasons = computed<Mechanism[]>(() => this.r().reasons.slice(0, 3));
  readonly warnings = computed<WarningItem[]>(() => this.r().warnings.slice(0, 3));
  readonly sorted = computed(() => [...this.r().components].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)));
  readonly core = computed(() => Math.round(this.r().core * 10) / 10);
  readonly confPct = computed(() => Math.round((this.drink().vector_confidence ?? 0.5) * 100));
  readonly sub = computed(() => {
    const d = this.drink();
    const parts: string[] = [];
    const prod = d.producer?.name && !/барная классика|фермерск/i.test(d.producer.name) ? d.producer.name : '';
    if (prod) parts.push(d.producer?.country ? `${prod} · ${d.producer.country}` : prod);
    parts.push(d.style?.name || this.t(`v2.cat.${d.category}` as I18nKey));
    if (d.abv !== null && d.abv !== undefined) parts.push(`${d.flags?.abv_unknown ? '≈' : ''}${String(d.abv).replace('.', ',')} %`);
    const s = d.serving;
    if (s?.temp_min_c !== undefined && s?.temp_min_c !== null && s?.temp_max_c !== undefined && s?.temp_max_c !== null) {
      parts.push(this.t('v2.card.serve', { min: s.temp_min_c, max: s.temp_max_c }));
    }
    return parts.join(' · ');
  });

  typeLabel(type: string): string { return this.t(`v2.type.${type}` as I18nKey); }
  /** R17_bitter → «Ваш вкус»; неизвестный код — как есть. */
  ruleName(rule: string): string {
    const base = rule.split('_')[0];
    const key = `v2.rule.${base}` as I18nKey;
    const txt = this.t(key);
    return txt === key ? rule : txt;
  }
  typeColor(type: string): string { return TYPE_VAR[type] ?? 'var(--gold)'; }
  evTitle(ev: string): string { return EVIDENCE.has(ev) ? this.t(`v2.ev.${ev}` as I18nKey) : ev; }
  sourceLabel(): string {
    const s = this.drink().vector_source ?? 'category_prior';
    return this.t(`v2.src.${s}` as I18nKey);
  }
  confTitle(): string { return `${this.confPct()}%`; }
  isVeto(w: WarningItem): boolean { return (w as { family: string }).family === 'veto'; }
  capOf(w: WarningItem): string { const c = (w as { cap?: number | null }).cap; return c === null || c === undefined ? '' : String(c); }
  barW(p: number): number { return Math.min(50, (Math.abs(p) / 22) * 50); }
  fx(x: number): string { return (Math.round(x * 100) / 100).toFixed(2); }
}
