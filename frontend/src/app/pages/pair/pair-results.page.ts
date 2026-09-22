import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { Match, PairingService } from '../../core/pairing.service';
import { ProgressService } from '../../core/progress.service';
import { VenueService } from '../../core/venue.service';
import { DnaService } from '../../core/dna.service';
import { Cooking, Dish, Fat, Taste, Weight } from '../../core/models';
import { DISH_AXES, DISH_AXIS_LABELS, DishProfile, Occasion } from '../../engine/pairing-engine';
import { IconComponent } from '../../ui/icon.component';
import { MatchCardComponent } from '../../ui/match-card.component';
import { SommelierChatComponent } from '../../ui/sommelier-chat.component';
import { SaasService } from '../../core/saas.service';
import { AiVenue } from '../../core/ai.service';
import { I18nKey, I18nService } from '../../core/i18n.service';

/** Шаг 2: результаты для блюда (из базы или custom из query) с контекстом повода/горечи/DNA/заведения. Язык ru/kk/en — через I18nService. */
@Component({
  selector: 'ft-pair-results',
  standalone: true,
  imports: [RouterLink, IconComponent, MatchCardComponent, SommelierChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dishProfile(); as dp) {
      <a routerLink="/pair" class="btn btn-ghost btn-sm"><ft-icon name="arrow-left" [size]="16" /> {{ t('pair.back') }}</a>
      <header class="dh card card-p mt12">
        <div class="de">{{ dp.dish.emoji }}</div>
        <div class="grow">
          <span class="eyebrow">{{ t('pair.eyebrow') }}</span>
          <h1 class="dn">{{ dishName() }}</h1>
          <div class="flex g6 wrap mt8">
            <span class="chip chip-sm">{{ dp.dish.cuisine_flag }} {{ i18n.cuisineLabel(dp.dish) }}</span><span class="chip chip-sm">{{ i18n.tasteLabel(dp.dish.dominant_taste, dp.dish.dominant_taste_label) }}</span>
            <span class="chip chip-sm">{{ i18n.weightLabel(dp.dish.weight, dp.dish.weight_label) }}</span><span class="chip chip-sm">{{ t('common.fat', { level: i18n.fatLabel(dp.dish.fat_level, dp.dish.fat_level_label) }) }}</span><span class="chip chip-sm">{{ i18n.cookingLabel(dp.dish.cooking_method, dp.dish.cooking_method_label) }}</span>
          </div>
          <div class="axes mt12">
            @for (a of topAxes(); track a.k) { <div class="ax"><span class="ellipsis">{{ i18n.dishAxis(a.k, a.l) }}</span><div class="bar thin"><i [style.width.%]="a.v * 100"></i></div></div> }
          </div>
        </div>
        <div class="share">
          <button type="button" class="btn btn-icon btn-secondary" (click)="share()" [attr.aria-label]="t('pair.share')"><ft-icon name="share" [size]="18" /></button>
        </div>
      </header>

      <!-- КОНТЕКСТ -->
      <section class="ctx card card-p mt12">
        <div class="ctx-row">
          <span class="lbl">{{ t('pair.occasion') }}</span>
          <div class="scroll-x chips">
            @for (o of occasions; track o.id) { <button type="button" class="chip chip-sm" [class.on]="occasion() === o.id" (click)="occasion.set(o.id)">{{ o.e }} {{ t(o.l) }}</button> }
          </div>
        </div>
        <div class="ctx-row">
          <span class="lbl">{{ t('pair.bitter') }}</span>
          <div class="seg">
            <button type="button" [class.on]="bitter() === -1" (click)="bitter.set(-1)">{{ t('pair.bitter.less') }}</button>
            <button type="button" [class.on]="bitter() === 0" (click)="bitter.set(0)">{{ t('pair.bitter.neutral') }}</button>
            <button type="button" [class.on]="bitter() === 1" (click)="bitter.set(1)">{{ t('pair.bitter.love') }}</button>
          </div>
        </div>
        <div class="ctx-row toggles">
          @if (dna.ready()) {
            <button type="button" class="chip chip-sm" [class.on]="useDna()" (click)="useDna.set(!useDna())"><ft-icon name="user" [size]="14" /> {{ t('pair.dna.use') }}</button>
          } @else {
            <a routerLink="/dna" class="chip chip-sm"><ft-icon name="user" [size]="14" /> {{ t('pair.dna.rate') }}</a>
          }
          @if (venue.venue(); as v) {
            <button type="button" class="chip chip-sm" [class.on]="onlyVenue()" (click)="onlyVenue.set(!onlyVenue())"><ft-icon name="map-pin" [size]="14" /> {{ t('pair.onlyVenue', { venue: v.name }) }}</button>
          }
        </div>
      </section>

      <!-- РЕЗУЛЬТАТЫ -->
      <section class="results mt16">
        @for (m of shown(); track m.beer_id; let i = $index) {
          <div class="reveal" [class]="'reveal reveal-' + (i + 1 > 5 ? 5 : i + 1)"><ft-match [m]="m" [rank]="i + 1" /></div>
        }
        @if (!showAll() && all().length > 5) {
          <button type="button" class="btn btn-secondary btn-block mt8" (click)="showAll.set(true)">{{ t('pair.showAll', { n: all().length }) }} <ft-icon name="chevron-down" /></button>
        }
      </section>

      @if (related().length) {
        <section class="section">
          <h2>{{ t('pair.related') }}</h2>
          <div class="scroll-x mt12">
            @for (d of related(); track d.id) { <a class="card hover rel" [routerLink]="['/pair', d.id]"><span class="re">{{ d.emoji }}</span><span class="b sm">{{ i18n.dishName(d) }}</span></a> }
          </div>
        </section>
      }
    } @else {
      <div class="card card-p center"><p class="dim">{{ t('pair.notFound') }}</p><a routerLink="/pair" class="btn btn-primary mt12">{{ t('pair.choose') }}</a></div>
    }
    <ft-sommelier [venue]="aiVenue()" [occasion]="occasion()" />
  `,
  styles: [`
    .dh { display: flex; gap: 14px; align-items: flex-start; }
    .de { font-size: 2.6rem; width: 64px; height: 64px; border-radius: 18px; background: var(--grad-amber-soft); display: grid; place-items: center; flex-shrink: 0; }
    .dn { font-size: clamp(1.5rem, 4vw + .5rem, 2.2rem); margin-top: 4px; }
    .axes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 16px; max-width: 520px; }
    @media (min-width: 640px) { .axes { grid-template-columns: repeat(3, 1fr); } }
    .ax { display: grid; grid-template-columns: 82px minmax(48px, 1fr); align-items: center; gap: 8px; font-size: .74rem; color: var(--ink-3); font-weight: 600; }
    .dh .grow { min-width: 0; }
    .ctx { display: grid; gap: 12px; }
    .ctx-row { display: grid; gap: 6px; }
    @media (min-width: 720px) { .ctx-row { grid-template-columns: 90px 1fr; align-items: center; } }
    .lbl { font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); }
    .chips { margin: 0; padding: 0; gap: 6px; }
    .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--bg-2); max-width: 420px; }
    .seg button { min-height: 38px; border-radius: 10px; font-weight: 700; font-size: .84rem; color: var(--ink-2); }
    .seg button.on { background: var(--surface); color: var(--amber-800); box-shadow: var(--shadow-1); }
    .toggles { display: flex; gap: 8px; flex-wrap: wrap; }
    .toggles .chip { white-space: normal; text-align: left; line-height: 1.25; padding-block: 4px; max-width: 100%; }
    @media (min-width: 720px) { .toggles { grid-column: 1 / -1; } }
    .results { display: grid; gap: 12px; }
    @media (min-width: 900px) { .results { grid-template-columns: 1fr 1fr; align-items: start; } .results > :first-child { grid-column: 1 / -1; } }
    .rel { display: grid; place-items: center; gap: 6px; width: 132px; padding: 14px 10px; text-align: center; }
    .re { font-size: 1.8rem; }
  `],
})
export class PairResultsPage {
  private saas = inject(SaasService);
  /** Контекст для ИИ: в заведении — только его карта, с ценами. */
  readonly aiVenue = computed<AiVenue | null>(() => {
    const v = this.venue.venue(); if (!v) return null;
    const m = this.saas.localMenu(v.id, null);
    return { slug: v.id, name: v.name, beers: m ? m.beers.map(b => b.ref_slug) : v.brands, currency: m?.venue.currency,
             prices: m ? Object.fromEntries(m.beers.map(b => [b.ref_slug, b.price])) : undefined };
  });
  data = inject(DataService);
  venue = inject(VenueService);
  dna = inject(DnaService);
  private pairing = inject(PairingService);
  private progress = inject(ProgressService);
  private router = inject(Router);
  i18n = inject(I18nService);
  /** t() читает сигнал языка — шаблон и computed() с его вызовом пересчитываются при смене языка. */
  readonly t = this.i18n.t;

  dishId = input.required<string>();
  // query params (custom dish + occasion)
  taste = input<Taste>(); weight = input<Weight>(); fat = input<Fat>(); cooking = input<Cooking>(); heat = input<string>(); name = input<string>();
  occasionParam = input<string>('', { alias: 'occasion' });

  occasion = signal<Occasion | null>(null);
  bitter = signal<-1 | 0 | 1>(0);
  useDna = signal(true);
  onlyVenue = signal(true);
  showAll = signal(false);
  /** l — ключ словаря: перевод берётся в шаблоне, чтобы чипы менялись вместе с языком. */
  readonly occasions: { id: Occasion | null; e: string; l: I18nKey }[] = [
    { id: null, e: '✨', l: 'pair.occasion.any' }, { id: 'hot', e: '☀️', l: 'pair.occasion.hot' }, { id: 'evening', e: '🌆', l: 'pair.occasion.evening' },
    { id: 'party', e: '🎉', l: 'pair.occasion.party' }, { id: 'gourmet', e: '🍷', l: 'pair.occasion.gourmet' },
  ];

  dishProfile = computed<DishProfile<Dish> | null>(() => {
    const id = this.dishId();
    if (id === 'custom') {
      return this.pairing.customDish({ name: this.name() || this.t('pair.custom.name'), taste: this.taste() || 'UMAMI', weight: this.weight() || 'MEDIUM', fat: this.fat() || 'MEDIUM', cooking: this.cooking() || 'OTHER', heat: this.heat() ? Number(this.heat()) / 100 : undefined });
    }
    return this.data.dishProfileById()[id] ?? null;
  });
  ctx = computed(() => ({ occasion: this.occasion(), bitter_pref: this.bitter(), dna: this.useDna() ? this.dna.vector() : null }));
  all = computed<Match[]>(() => {
    const dp = this.dishProfile(); if (!dp) return [];
    const vb = this.onlyVenue() ? this.venue.brandIds() : null;
    return this.pairing.forDishProfile(dp, this.ctx(), { limit: 0, venueBrands: vb, diversify: false });
  });
  shown = computed<Match[]>(() => {
    const dp = this.dishProfile(); if (!dp) return [];
    if (this.showAll()) return this.all();
    const vb = this.onlyVenue() ? this.venue.brandIds() : null;
    return this.pairing.forDishProfile(dp, this.ctx(), { limit: 5, venueBrands: vb, diversify: true });
  });
  topAxes = computed(() => {
    const dp = this.dishProfile(); if (!dp) return [];
    return DISH_AXES.map(k => ({ k, l: DISH_AXIS_LABELS[k], v: dp.vector[k] })).filter(a => a.v > 0.15).sort((a, b) => b.v - a.v).slice(0, 6);
  });
  /** Своё блюдо названо гостем — как есть; блюдо из базы — по словарю языка. */
  readonly dishName = computed(() => { const dp = this.dishProfile(); return !dp ? '' : dp.id === 'custom' ? dp.dish.display_name : this.i18n.dishName(dp.dish); });
  related = computed(() => { const dp = this.dishProfile(); if (!dp || dp.id === 'custom') return []; return this.data.dishes().filter(d => d.cuisine === dp.dish.cuisine && d.id !== dp.id).slice(0, 8); });

  constructor() {
    effect(() => { const o = this.occasionParam(); if (o && ['hot', 'evening', 'party', 'gourmet'].includes(o)) this.occasion.set(o as Occasion); }, { allowSignalWrites: true });
    effect(() => { const dp = this.dishProfile(); if (dp && dp.id !== 'custom') this.progress.award('pairing', dp.id, untracked(() => this.t('pair.award', { dish: this.dishName() }))); }, { allowSignalWrites: true });
  }

  async share(): Promise<void> {
    const dp = this.dishProfile(); const top = this.shown()[0]; if (!dp || !top) return;
    const text = `${this.dishName()} + ${top.beer.display_name} — ${top.score}/99 (${this.i18n.verdict(top.verdict)}). ${top.reasons[0] ? this.i18n.reason(top.reasons[0]) : ''} — Flavor Tree`;
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: 'Flavor Tree', text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); this.progress.lastAward.set({ kind: 'share', xp: 0, label: this.t('pair.copied') }); setTimeout(() => this.progress.lastAward.set(null), 2000); }
      this.progress.award('share');
    } catch { /* отменено */ }
  }
}
