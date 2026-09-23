import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataV2Service, DishV2, DrinkV2 } from '../../core/data-v2.service';
import { PairingV2Service, TabResult } from '../../core/pairing-v2.service';
import { ProgressService } from '../../core/progress.service';
import { VenueService } from '../../core/venue.service';
import { SaasService } from '../../core/saas.service';
import { AiVenue } from '../../core/ai.service';
import { I18nKey, I18nService } from '../../core/i18n.service';
import { COOK_FROM_V1, DISH_AXES_V2, SpecFat, SpecTaste, SpecWeight, customDishRecord } from '../../engine/custom-dish-v2';
import { Ctx, DishRecord, Occasion, PairResult, RecommendResult } from '../../engine/pairing-engine-v2';
import { IconComponent } from '../../ui/icon.component';
import { DrinkResultCardComponent } from '../../ui/drink-result-card.component';
import { DishPhotoComponent } from '../../ui/dish-photo.component';
import { SommelierChatComponent } from '../../ui/sommelier-chat.component';
import { PairReviewComponent } from '../../ui/pair-review.component';
import { ReviewSummaryComponent } from '../../ui/review-summary.component';
import { GuestPrefsService } from '../../core/guest-prefs.service';
import { TrackActionKind, TrackV2Service, poolBestOther, trackItems } from '../../core/track-v2.service';

type OccasionChip = { id: Occasion | null; l: I18nKey };
/** Блюдо страницы: из каталога v2 или «своё» (тот же формат dishes_v2.json). */
type PageDish = DishRecord & { id: string; name: string; emoji?: string };
interface Shown { r: PairResult; drink: DrinkV2; crown: boolean; promoted: boolean; }

/** Кухни v2 → подписи (ru / kk / en). Нет в словаре — id как есть. */
const CUISINE: Record<string, [string, string, string]> = {
  kazakh: ['Казахская', 'Қазақ асханасы', 'Kazakh'], central_asian: ['Среднеазиатская', 'Орта Азия', 'Central Asian'],
  uyghur: ['Уйгурская', 'Ұйғыр асханасы', 'Uyghur'], russian: ['Русская', 'Орыс асханасы', 'Russian'],
  ukrainian: ['Украинская', 'Украин асханасы', 'Ukrainian'], caucasian: ['Кавказская', 'Кавказ асханасы', 'Caucasian'],
  turkish: ['Турецкая', 'Түрік асханасы', 'Turkish'], tatar: ['Татарская', 'Татар асханасы', 'Tatar'],
  german: ['Немецкая', 'Неміс асханасы', 'German'], bavarian: ['Баварская', 'Бавария', 'Bavarian'],
  austrian: ['Австрийская', 'Австрия', 'Austrian'], czech: ['Чешская', 'Чех асханасы', 'Czech'],
  belgian: ['Бельгийская', 'Бельгия', 'Belgian'], english: ['Английская', 'Ағылшын асханасы', 'English'],
  irish: ['Ирландская', 'Ирландия', 'Irish'], french: ['Французская', 'Француз асханасы', 'French'],
  italian: ['Итальянская', 'Итальян асханасы', 'Italian'], spanish: ['Испанская', 'Испан асханасы', 'Spanish'],
  greek: ['Греческая', 'Грек асханасы', 'Greek'], japanese: ['Японская', 'Жапон асханасы', 'Japanese'],
  chinese: ['Китайская', 'Қытай асханасы', 'Chinese'], korean: ['Корейская', 'Корей асханасы', 'Korean'],
  thai: ['Тайская', 'Тай асханасы', 'Thai'], vietnamese: ['Вьетнамская', 'Вьетнам асханасы', 'Vietnamese'],
  indian: ['Индийская', 'Үнді асханасы', 'Indian'], mexican: ['Мексиканская', 'Мексика асханасы', 'Mexican'],
  american: ['Американская', 'Америка асханасы', 'American'], argentinian: ['Аргентинская', 'Аргентина', 'Argentinian'],
  international: ['Интернациональная', 'Халықаралық', 'International'],
};

/**
 * Подбор v2 к блюду: вкладки «Лучшее · Пиво · Без алкоголя · Сидр · Вино · Коктейли · Крепкое», контекст гостя,
 * лучший напиток Efes с честным баллом. Блюдо из каталога (dishes_v2.json) или «своё» из мастера (query-параметры v1).
 */
@Component({
  selector: 'ft-pair-results',
  standalone: true,
  imports: [RouterLink, IconComponent, DrinkResultCardComponent, DishPhotoComponent, SommelierChatComponent, PairReviewComponent, ReviewSummaryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dish(); as d) {
      <a routerLink="/pair" class="btn btn-ghost btn-sm"><ft-icon name="arrow-left" [size]="16" /> {{ t('pair.back') }}</a>

      <header class="dh card mt12">
        <div class="ph">
          @if (d.id !== 'custom') {
            <ft-dish-photo [dishId]="d.id" [emoji]="emoji()" variant="square" [name]="dishName()" [priority]="true" />
          } @else {
            <div class="custom-ph">{{ emoji() }}</div>
          }
        </div>
        <div class="grow">
          <span class="eyebrow">{{ t('pair.eyebrow') }}</span>
          <h1 class="dn">{{ dishName() }}</h1>
          <div class="flex g6 wrap mt8">
            @for (c of cuisines(); track c) { <span class="chip chip-sm">{{ c }}</span> }
          </div>
          <div class="axes mt12">
            @for (a of topAxes(); track a.k) {
              <div class="ax"><span class="ellipsis">{{ t(a.l) }}</span><div class="bar thin"><i [style.width.%]="a.v * 100"></i></div></div>
            }
          </div>
        </div>
        <button type="button" class="btn btn-icon btn-secondary share" (click)="share()" [attr.aria-label]="t('pair.share')"><ft-icon name="share" [size]="18" /></button>
      </header>
      @if (dishId() !== 'custom') {
        <a class="to-table mt12" routerLink="/table" [queryParams]="{ d: dishId() }" [attr.title]="t('v2.pair.toTableHint')">
          <span class="tt-ico">🍽️</span><span class="grow"><b>{{ t('v2.pair.toTable') }}</b><span class="dim xs tt-sub">{{ t('v2.pair.toTableHint') }}</span></span><ft-icon name="chevron-right" [size]="18" />
        </a>
      }

      <section class="ctx card card-p mt12">
        <div class="ctx-row">
          <span class="lbl">{{ t('pair.occasion') }}</span>
          <div class="scroll-x chips">
            @for (o of occasions; track o.l) {
              <button type="button" class="chip chip-sm" [class.on]="occasion() === o.id" (click)="occasion.set(o.id)">{{ t(o.l) }}</button>
            }
          </div>
        </div>
        <div class="ctx-row">
          <span class="lbl">{{ t('pair.bitter') }}</span>
          <div class="seg">
            <button type="button" [class.on]="bitter() === -1" (click)="setBitter(-1)">{{ t('pair.bitter.less') }}</button>
            <button type="button" [class.on]="bitter() === 0" (click)="setBitter(0)">{{ t('pair.bitter.neutral') }}</button>
            <button type="button" [class.on]="bitter() === 1" (click)="setBitter(1)">{{ t('pair.bitter.love') }}</button>
          </div>
        </div>
        <div class="ctx-row toggles">
          @if (isSpicy()) {
            <button type="button" class="chip chip-sm" [class.on]="heatLover()" (click)="prefs.set({ heat_lover: !heatLover() })"><ft-icon name="flame" [size]="14" /> {{ t('v2.pair.heatLover') }}</button>
          }
          <button type="button" class="chip chip-sm" [class.on]="sensitive()" (click)="prefs.set({ harsh_tol: sensitive() ? 'median' : 'sensitive' })"><ft-icon name="droplet" [size]="14" /> {{ t('v2.pair.sensitive') }}</button>
          @if (venue.venue(); as v) {
            <button type="button" class="chip chip-sm" [class.on]="onlyVenue()" (click)="onlyVenue.set(!onlyVenue())"><ft-icon name="map-pin" [size]="14" /> {{ t('pair.onlyVenue', { venue: v.name }) }}</button>
          }
        </div>
        @if (prefs.learned().length) {
          <p class="learned sm">{{ t('v2.pair.prefs', { list: prefs.learned().join(', ') }) }} · <button type="button" class="linkish" (click)="prefs.reset()">{{ t('v2.pair.prefsReset') }}</button></p>
        }
      </section>

      @if (data.drinks() === null) {
        <section class="results mt16" aria-busy="true">
          @if (data.error()) { <div class="card card-p center"><p class="dim">{{ t('v2.pair.loadError') }}</p></div> }
          @else {
            <p class="loading dim">{{ t('v2.pair.loading') }}</p>
            <div class="card skeleton sk"></div><div class="card skeleton sk"></div>
          }
        </section>
      } @else {
        <nav class="tabs scroll-x mt16" [attr.aria-label]="t('v2.pair.tabsAria')">
          <button type="button" class="tab" [class.on]="tab() === 'best'" (click)="tab.set('best')">{{ t('v2.tab.best') }}</button>
          @for (g of tabs(); track g.id) {
            <button type="button" class="tab" [class.on]="tab() === g.id" (click)="tab.set(g.id)">{{ t(tabLabel(g.id)) }} <span class="n">{{ g.result.n_candidates }}</span></button>
          }
        </nav>

        <section class="results mt12">
          @for (s of shown(); track s.r.drink_id; let i = $index) {
            <div [class]="'reveal reveal-' + (i + 1 > 5 ? 5 : i + 1)">
              <ft-drink-result [r]="s.r" [drink]="s.drink" [rank]="tab() === 'best' ? i + 1 : 0" [price]="priceOf(s.drink)"
                               [crown]="s.crown" [promoted]="s.promoted" [window]="window()"
                               [open]="isOpen(s.r.drink_id)" (openChange)="setOpen(s.r.drink_id, $event)" (click)="cardClick($event, s.drink)">
                @if (isOpen(s.r.drink_id)) {
                  <div class="rv">
                    <ft-review-summary [drinkId]="s.r.drink_id" [dishId]="d.id" [dishName]="dishName()" />
                    <ft-pair-review [drinkId]="s.r.drink_id" [dishId]="d.id" [dishName]="dishName()" [score]="s.r.score"
                                    [ctx]="reviewCtx()" [venueSlug]="venueSlug()" [table]="tableNo()" />
                  </div>
                }
              </ft-drink-result>
            </div>
          } @empty {
            <div class="card card-p center"><p class="dim">{{ t('v2.pair.empty') }}</p></div>
          }
        </section>

        @if (partner(); as p) {
          <section class="partner card card-p mt16">
            <div class="ph-head">
              <span class="eyebrow plain">{{ t('v2.pair.partner.title') }}</span>
              <p class="dim sm">{{ t('v2.pair.partner.note') }}</p>
            </div>
            <ft-drink-result [r]="p.r" [drink]="p.drink" [price]="priceOf(p.drink)"
                             [open]="isOpen(p.r.drink_id)" (openChange)="setOpen(p.r.drink_id, $event)" (click)="cardClick($event, p.drink)">
              @if (isOpen(p.r.drink_id)) {
                <div class="rv">
                  <ft-review-summary [drinkId]="p.r.drink_id" [dishId]="d.id" [dishName]="dishName()" />
                  <ft-pair-review [drinkId]="p.r.drink_id" [dishId]="d.id" [dishName]="dishName()" [score]="p.r.score"
                                  [ctx]="reviewCtx()" [venueSlug]="venueSlug()" [table]="tableNo()" />
                </div>
              }
            </ft-drink-result>
          </section>
        }

        <p class="foot dim sm mt12">
          {{ t('v2.pair.count', { n: current()?.n_candidates ?? 0 }) }}
          @if ((current()?.excluded_non_alcoholic?.length ?? 0) > 0) { · {{ t('v2.pair.excludedNa', { n: current()!.excluded_non_alcoholic.length }) }} }
          · {{ t('v2.pair.policy', { n: window() }) }}
          · <a routerLink="/method">{{ t('v2.pair.method') }}</a>
          · <a routerLink="/drinks">{{ t('v2.pair.catalog') }}</a>
        </p>
      }

      @if (related().length) {
        <section class="section">
          <h2>{{ t('pair.related') }}</h2>
          <div class="scroll-x mt12">
            @for (r of related(); track r.id) {
              <a class="card hover rel" [routerLink]="['/pair', r.id]">
                <ft-dish-photo [dishId]="r.id" [emoji]="r.emoji || '🍽️'" variant="square" [name]="r.name" />
                <span class="b sm">{{ i18n.dishName({ id: r.id, display_name: r.display_name || r.name }) }}</span>
              </a>
            }
          </div>
        </section>
      }
    } @else {
      <div class="card card-p center"><p class="dim">{{ t('pair.notFound') }}</p><a routerLink="/pair" class="btn btn-primary mt12">{{ t('pair.choose') }}</a></div>
    }
    <ft-sommelier [venue]="aiVenue()" [occasion]="aiOccasion()" />
  `,
  styles: [`
    .dh { display: grid; grid-template-columns: auto 1fr auto; gap: 16px; align-items: start; padding: 16px; }
    .ph { width: 112px; }
    @media (min-width: 720px) { .ph { width: 148px; } }
    .custom-ph { width: 100%; aspect-ratio: 1; border-radius: var(--r-md); display: grid; place-items: center; font-size: 2.8rem; background: radial-gradient(80% 70% at 50% 60%, var(--gold-glow), transparent), var(--surface-2); border: 1px solid var(--line); }
    .dn { font-size: clamp(1.6rem, 4vw + .6rem, 2.4rem); margin-top: 4px; line-height: 1.05; }
    .grow { min-width: 0; }
    .axes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 16px; max-width: 540px; }
    @media (min-width: 640px) { .axes { grid-template-columns: repeat(3, 1fr); } }
    .ax { display: grid; grid-template-columns: 92px minmax(40px, 1fr); align-items: center; gap: 8px; font-size: .74rem; color: var(--ink-3); font-weight: 600; }
    .to-table { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--r-lg); background: var(--surface); border: 1.5px solid var(--line); transition: border-color var(--t-fast), transform var(--t-fast); }
    .to-table:hover { border-color: var(--amber-400); transform: translateY(-1px); }
    .to-table .tt-ico { font-size: 1.4rem; }
    .to-table .tt-sub { display: block; margin-top: 2px; }
    @media (max-width: 520px) { .dh { grid-template-columns: auto 1fr; } .share { grid-column: 2; justify-self: end; grid-row: 1; } .ph { width: 88px; } }
    .ctx { display: grid; gap: 12px; }
    .ctx-row { display: grid; gap: 6px; }
    @media (min-width: 720px) { .ctx-row { grid-template-columns: 90px 1fr; align-items: center; } }
    .lbl { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: var(--ink-3); }
    .chips { margin: 0; padding: 0; gap: 6px; }
    .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--bg-2); max-width: 420px; }
    .seg button { min-height: 38px; border-radius: 10px; font-weight: 700; font-size: .84rem; color: var(--ink-2); }
    .seg button.on { background: var(--surface-2); color: var(--gold-soft); box-shadow: var(--shadow-1); }
    .toggles { display: flex; gap: 8px; flex-wrap: wrap; }
    .toggles .chip { white-space: normal; text-align: left; line-height: 1.25; padding-block: 4px; max-width: 100%; }
    @media (min-width: 720px) { .toggles { grid-column: 1 / -1; } }
    .tabs { display: flex; gap: 6px; padding-bottom: 2px; border-bottom: 1px solid var(--line); }
    .tab { position: relative; flex-shrink: 0; padding: 10px 14px; font-weight: 700; font-size: .9rem; color: var(--ink-3); border-radius: var(--r-md) var(--r-md) 0 0; transition: color var(--t-fast); }
    .tab:hover { color: var(--ink); }
    .tab.on { color: var(--gold-soft); }
    .tab.on::after { content: ''; position: absolute; left: 12px; right: 12px; bottom: -2px; height: 2px; border-radius: 2px; background: var(--grad-amber); }
    .tab .n { font-size: .7rem; font-weight: 600; color: var(--ink-4); margin-left: 2px; }
    .results { display: grid; gap: 12px; }
    @media (min-width: 900px) { .results { grid-template-columns: 1fr 1fr; align-items: start; } .results > :first-child { grid-column: 1 / -1; } }
    .sk { height: 180px; }
    .loading { font-size: .85rem; }
    .partner { border-color: rgba(229, 184, 73, .28); display: grid; gap: 10px; }
    .ph-head .sm { margin-top: 4px; }
    .foot { line-height: 1.6; }
    .foot a { color: var(--gold-soft); text-decoration: underline; text-underline-offset: 3px; }
    .rel { display: grid; gap: 8px; width: 140px; padding: 8px; text-align: center; }
    .rv { display: grid; gap: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--line); }
    .learned { margin: 2px 0 0; color: var(--ink-3); }
    .linkish { color: var(--gold-soft); text-decoration: underline; text-underline-offset: 3px; font-size: inherit; }
  `],
})
export class PairResultsPage {
  data = inject(DataV2Service);
  private pairing = inject(PairingV2Service);
  venue = inject(VenueService);
  private saas = inject(SaasService);
  private progress = inject(ProgressService);
  private track = inject(TrackV2Service);
  i18n = inject(I18nService);
  readonly t = this.i18n.t;

  dishId = input.required<string>();
  // «своё блюдо» из мастера v1 (query-параметры)
  taste = input<SpecTaste>(); weight = input<SpecWeight>(); fat = input<SpecFat>(); cooking = input<string>(); heat = input<string>(); name = input<string>();
  occasionParam = input<string>('', { alias: 'occasion' });

  prefs = inject(GuestPrefsService);
  occasion = signal<Occasion | null>(null);
  /** −1 / 0 / 1 для переключателя; сам профиль (−1..1, двигается и отзывами) — в GuestPrefsService */
  readonly bitter = computed<-1 | 0 | 1>(() => { const b = this.prefs.prefs().bitter_pref; return b <= -0.2 ? -1 : b >= 0.2 ? 1 : 0; });
  readonly heatLover = computed(() => this.prefs.prefs().heat_lover);
  readonly sensitive = computed(() => this.prefs.prefs().harsh_tol === 'sensitive');
  onlyVenue = signal(true);
  tab = signal<string>('best');
  private readonly opened = signal<ReadonlySet<string>>(new Set());
  /** Аналитика показов (TrackV2Service): id последнего отправленного списка и отложенная отправка (600 мс). */
  private listId: string | null = null;
  private pendingList: (() => void) | null = null;
  private listTimer: ReturnType<typeof setTimeout> | null = null;

  readonly occasions: OccasionChip[] = [
    { id: null, l: 'pair.occasion.any' }, { id: 'meal', l: 'v2.pair.occasion.meal' }, { id: 'aperitif', l: 'v2.pair.occasion.aperitif' }, { id: 'dessert', l: 'v2.pair.occasion.dessert' },
    { id: 'hot', l: 'pair.occasion.hot' }, { id: 'evening', l: 'pair.occasion.evening' }, { id: 'party', l: 'pair.occasion.party' },
    { id: 'gourmet', l: 'pair.occasion.gourmet' }, { id: 'non_alcoholic', l: 'v2.pair.occasion.na' },
  ];

  /** Блюдо: из каталога v2 или «своё» (вектор — autofill §3.3, как у 70 блюд каталога). */
  readonly dish = computed<PageDish | null>(() => {
    const id = this.dishId();
    if (id === 'custom') {
      const heat = this.heat() ? Number(this.heat()) / 100 : null;
      return {
        ...customDishRecord({
          name: this.name() || this.t('pair.custom.name'), taste: this.taste() || 'UMAMI', weight: this.weight() || 'MEDIUM',
          fat: this.fat() || 'MEDIUM', cook: COOK_FROM_V1[this.cooking() || 'OTHER'] ?? 'raw', heat: Number.isFinite(heat) ? heat : null,
        }),
        id: 'custom', name: this.name() || this.t('pair.custom.name'), emoji: '✨',
      };
    }
    return (this.data.dish(id) as PageDish | undefined) ?? null;
  });
  readonly emoji = computed(() => this.dish()?.emoji || '🍽️');
  readonly dishName = computed(() => {
    const d = this.dish(); if (!d) return '';
    return d.id === 'custom' ? d.name : this.i18n.dishName({ id: d.id, display_name: (d.display_name as string) || d.name });
  });
  readonly cuisines = computed(() => {
    const d = this.dish(); if (!d) return [];
    const li = { ru: 0, kk: 1, en: 2 }[this.i18n.locale()];
    const list = Array.isArray(d.cuisine) ? (d.cuisine as string[]) : [];
    return list.slice(0, 3).map(c => CUISINE[c]?.[li] ?? c);
  });
  readonly topAxes = computed(() => {
    const d = this.dish(); if (!d || !d.vector) return [];
    const v = d.vector as Record<string, number>;
    return DISH_AXES_V2.map(k => ({ k, l: `v2.dax.${k}` as I18nKey, v: v[k] ?? 0 })).filter(a => a.v > 0.15).sort((a, b) => b.v - a.v).slice(0, 6);
  });
  readonly isSpicy = computed(() => ((this.dish()?.vector as Record<string, number> | undefined)?.['heat'] ?? 0) >= 0.3);

  /** Контекст движка: повод + личный профиль гостя (R17), тот же, что уходит в API v2 и в отзывы. */
  readonly ctx = computed<Ctx>(() => ({ occasion: this.occasion(), ...this.prefs.ctx() }));
  readonly reviewCtx = computed<Record<string, unknown>>(() => ({ ...this.ctx() }));
  readonly venueSlug = computed(() => this.venue.venue()?.id ?? null);
  readonly tableNo = computed(() => this.venue.session()?.table ?? null);
  readonly venueDrinkIds = computed<string[] | null>(() => {
    if (!this.onlyVenue() || !this.venue.venue() || this.data.drinks() === null) return null;
    const menu = this.localMenu();
    const refs = menu ? menu.beers.map(b => b.ref_slug) : this.venue.brandIds();
    return this.pairing.venueDrinkIds(refs);
  });
  private readonly localMenu = computed(() => { const v = this.venue.venue(); return v ? this.saas.localMenu(v.id, null) : null; });
  private readonly prices = computed(() => {
    const m = this.localMenu(); if (!m) return new Map<string, number>();
    return new Map(m.beers.map(b => [b.ref_slug, b.price] as [string, number]));
  });

  readonly best = computed<RecommendResult | null>(() => {
    const d = this.dish(); if (!d || this.data.drinks() === null) return null;
    return this.pairing.forDish(d, this.ctx(), { top: 5, venueDrinkIds: this.venueDrinkIds() });
  });
  readonly tabs = computed<TabResult[]>(() => {
    const d = this.dish(); if (!d || this.data.drinks() === null) return [];
    return this.pairing.tabs(d, this.ctx(), this.venueDrinkIds(), 5);
  });
  readonly current = computed<RecommendResult | null>(() => {
    const id = this.tab();
    if (id === 'best') return this.best();
    return this.tabs().find(g => g.id === id)?.result ?? this.best();
  });
  readonly shown = computed<Shown[]>(() => this.withDrinks(this.current()?.items ?? []));
  /** Лучший напиток Efes, если его нет среди показанных. */
  readonly partner = computed<Shown | null>(() => {
    const bp = this.best()?.best_partner; if (!bp) return null;
    if (this.shown().some(s => s.r.drink_id === bp.drink_id)) return null;
    const drink = this.data.drink(bp.drink_id);
    return drink ? { r: bp, drink, crown: false, promoted: false } : null;
  });
  readonly window = computed(() => this.data.params.recommend.partner_tie_window);
  readonly related = computed<DishV2[]>(() => {
    const d = this.dish(); if (!d || d.id === 'custom') return [];
    const cz = new Set(Array.isArray(d.cuisine) ? d.cuisine as string[] : []);
    return this.data.dishes().filter(x => x.id !== d.id && (x.cuisine ?? []).some(c => cz.has(c))).slice(0, 10);
  });

  readonly aiVenue = computed<AiVenue | null>(() => {
    const v = this.venue.venue(); if (!v) return null;
    const m = this.localMenu();
    return { slug: v.id, name: v.name, beers: m ? m.beers.map(b => b.ref_slug) : v.brands, currency: m?.venue.currency,
             prices: m ? Object.fromEntries(m.beers.map(b => [b.ref_slug, b.price])) : undefined };
  });
  /** Чат ИИ-сомелье (v1) понимает 4 повода — остальные не передаём. */
  readonly aiOccasion = computed(() => {
    const o = this.occasion();
    return o === 'hot' || o === 'evening' || o === 'party' || o === 'gourmet' ? o : null;
  });

  constructor() {
    this.data.ensureDrinks().catch(() => { /* ошибку показывает шаблон */ });
    effect(() => {
      const o = this.occasionParam();
      if (o && this.occasions.some(x => x.id === o)) this.occasion.set(o as Occasion);
    }, { allowSignalWrites: true });
    effect(() => {
      const d = this.dish();
      if (d && d.id !== 'custom') this.progress.award('pairing', d.id, untracked(() => this.t('pair.award', { dish: this.dishName() })));
    }, { allowSignalWrites: true });
    // вкладка, которой нет при новом контексте (например, «Без алкоголя» оставил только одну группу), → «Лучшее»
    effect(() => {
      const id = untracked(() => this.tab());
      if (id !== 'best' && !this.tabs().some(g => g.id === id)) this.tab.set('best');
    }, { allowSignalWrites: true });
    // показ списка → /api/v2/track/: ждём 600 мс, пока гость не перестанет щёлкать поводами и вкладками
    if (this.track.enabled) {
      effect(() => {
        const d = this.dish(); const shown = this.shown();
        const input = { source: 'pair' as const, tab: this.tab(), venue: this.venueSlug(), table: this.tableNo(), occasion: this.occasion() };
        // пул кандидатов того же списка (контекст, вкладка, заведение) — для честного места на сервере
        const ctx = this.ctx(); const venueIds = this.venueDrinkIds();
        const cats = input.tab === 'best' ? null : this.tabs().find(g => g.id === input.tab)?.categories ?? null;
        this.cancelList();
        if (!d || !shown.length) return;
        const items = trackItems(shown.map(s => s.r));
        this.pendingList = () => {
          const pool = this.pairing.forDish(d, ctx, { top: 0, categories: cats, venueDrinkIds: venueIds }).items;
          this.listId = this.track.listShown({ ...input, dishId: d.id, items, poolBestOther: poolBestOther(pool) });
        };
        this.listTimer = setTimeout(() => this.firePendingList(), 600);
      });
      inject(DestroyRef).onDestroy(() => this.cancelList());
    }
  }

  tabLabel(id: string): I18nKey { return `v2.tab.${id}` as I18nKey; }
  setBitter(v: -1 | 0 | 1): void { this.prefs.set({ bitter_pref: v }); }
  isOpen(id: string): boolean { return this.opened().has(id); }
  setOpen(id: string, open: boolean): void {
    if (open && !this.isOpen(id)) { const drink = this.data.drink(id); if (drink) this.trackAction('expand_why', drink); }
    this.opened.update(set => { const next = new Set(set); if (open) next.add(id); else next.delete(id); return next; });
  }

  /** Переход по ссылке карточки на страницу напитка (/drinks/:id) → open_drink. */
  cardClick(ev: Event, drink: DrinkV2): void {
    const a = (ev.target as Element | null)?.closest?.('a[href]');
    if (a && (a.getAttribute('href') ?? '').includes('/drinks/')) this.trackAction('open_drink', drink);
  }

  private trackAction(kind: TrackActionKind, drink: DrinkV2): void {
    const d = this.dish(); if (!this.track.enabled || !d) return;
    this.firePendingList();   // действие раньше, чем истекли 600 мс, — список гость уже точно видел
    this.track.action({ kind, listId: this.listId, drinkId: drink.id, dishId: d.id, venue: this.venueSlug() });
  }
  private firePendingList(): void {
    const fire = this.pendingList;
    this.cancelList();
    fire?.();
  }
  private cancelList(): void {
    if (this.listTimer) { clearTimeout(this.listTimer); this.listTimer = null; }
    this.pendingList = null;
  }

  priceOf(d: DrinkV2): number | null {
    const p = this.prices();
    return p.get(d.id) ?? (d.legacy_brand_id ? p.get(d.legacy_brand_id) ?? null : null);
  }

  /** crown — первый напиток с наивысшим баллом; promoted — Efes, стоящий выше напитка с бо́льшим баллом (политика окна). */
  private withDrinks(items: PairResult[]): Shown[] {
    const out: Shown[] = [];
    const max = items.reduce((m, r) => Math.max(m, r.score), -1);
    let crowned = false;
    items.forEach((r, i) => {
      const drink = this.data.drink(r.drink_id); if (!drink) return;
      const crown = !crowned && r.score === max;
      if (crown) crowned = true;
      const promoted = r.efes_partner && items.slice(i + 1).some(x => x.score > r.score);
      out.push({ r, drink, crown, promoted });
    });
    return out;
  }

  async share(): Promise<void> {
    const top = this.shown()[0]; if (!top) return;
    const reason = top.r.reasons[0]?.text ?? '';
    const text = `${this.dishName()} + ${top.drink.name} — ${top.r.score}/99 (${top.r.band_label}). ${reason} — Flavor Tree`;
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: 'Flavor Tree', text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        this.progress.lastAward.set({ kind: 'share', xp: 0, label: this.t('pair.copied') });
        setTimeout(() => this.progress.lastAward.set(null), 2000);
      }
      this.progress.award('share');
    } catch { /* отменено */ }
  }
}
