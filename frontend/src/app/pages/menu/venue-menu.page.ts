import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataV2Service, DishV2, DrinkV2 } from '../../core/data-v2.service';
import { PairingV2Service } from '../../core/pairing-v2.service';
import { GuestPrefsService } from '../../core/guest-prefs.service';
import { SaasService } from '../../core/saas.service';
import { TrackV2Service, poolBestOther, trackItems } from '../../core/track-v2.service';
import { MenuItem, VenueMenu } from '../../core/saas.models';
import { PairResult } from '../../engine/pairing-engine-v2';
import { IconComponent } from '../../ui/icon.component';
import { DrinkArtComponent } from '../../ui/drink-art.component';
import { DishPhotoComponent } from '../../ui/dish-photo.component';
import { ScoreRingComponent } from '../../ui/score-ring.component';
import { SommelierChatComponent } from '../../ui/sommelier-chat.component';
import { AiVenue } from '../../core/ai.service';
import { I18nKey, I18nService } from '../../core/i18n.service';
import { ru } from '../../core/i18n/ru';
import { LangSwitchComponent } from '../../ui/lang-switch.component';

interface DishRow { item: MenuItem; dish: DishV2; }
interface DrinkRow { item: MenuItem; drink: DrinkV2; }
interface Suggestion { r: PairResult; row: DrinkRow; best: boolean; }
const VENUE_TYPE_KEYS: Record<string, I18nKey> = { BAR: 'menu.type.BAR', RESTAURANT: 'menu.type.RESTAURANT', PUB: 'menu.type.PUB', CAFE: 'menu.type.CAFE' };

/**
 * Гостевое меню заведения — то, что открывается после скана QR на столе.
 * Брендинг заведения, ИХ цены, подбор (движок v2) только из ИХ карты — любые напитки каталога, не только пиво,
 * кнопка «Заказать» → событие для владельца. Позиции карты ссылаются на id напитка v2 или на slug сорта v1 (legacy_brand_id).
 * Язык ru/kk/en: строки интерфейса — через t(), подписи данных — через помощники I18nService; своё название
 * или описание позиции, заданное заведением, всегда важнее перевода.
 */
@Component({
  selector: 'ft-venue-menu',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, ScoreRingComponent, SommelierChatComponent, LangSwitchComponent, DrinkArtComponent, DishPhotoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'loading') {
      <div class="card card-p center"><div class="spinner"></div><p class="dim mt12">{{ t('menu.loading') }}</p></div>
    } @else if (state() === 'missing') {
      <div class="card card-p center">
        <div style="font-size:48px">🍽️</div>
        <h1>{{ t('menu.missing.title') }}</h1>
        <p class="dim mt8">{{ t('menu.missing.text', { slug: slug() }) }}</p>
        <a routerLink="/business" class="btn btn-primary mt16">{{ t('menu.missing.cta') }}</a>
      </div>
    } @else { @if (menu(); as m) {
      <section class="hero" [style.--accent]="accent()" [style.background-image]="m.venue.cover ? 'url(' + m.venue.cover + ')' : null">
        <div class="hero-in">
          <div class="brand">
            @if (m.venue.logo) { <img [src]="m.venue.logo" alt="" class="logo" /> } @else { <span class="logo logo-ph">{{ initials() }}</span> }
            <div class="grow">
              <div class="eyebrow light">{{ typeLabel() }} · {{ m.venue.city }}</div>
              <h1 class="vn">{{ m.venue.name }}</h1>
            </div>
            @if (m.table) { <span class="table">{{ t('common.table', { n: m.table }) }}</span> }
          </div>
          <p class="headline">{{ headline() }}</p>
          <div class="chips">
            @if (m.venue.wifi) { <span class="hchip">📶 Wi-Fi: {{ m.venue.wifi }}</span> }
            @if (m.venue.instagram) { <span class="hchip">📷 {{ m.venue.instagram }}</span> }
            <span class="hchip">{{ t('v2.menu.positions', { n: m.beers.length + m.dishes.length }) }}</span>
            <ft-lang-switch light />
          </div>
          <a routerLink="/scan" [queryParams]="{ venue: m.venue.slug, table: m.table }" class="scan-btn"><span class="sb-ico">📷</span><span><b>{{ t('menu.scan.title') }}</b><br><small>{{ t('menu.scan.sub') }}</small></span><ft-icon name="chevron-right" [size]="18" /></a>
        </div>
      </section>

      <section class="section-sm">
        <div class="search"><ft-icon name="search" /><input class="input" type="search" [placeholder]="t('menu.search.placeholder')" [ngModel]="q()" (ngModelChange)="q.set($event)" [attr.aria-label]="t('menu.search.aria')" /></div>
        @if (categories().length > 1) {
          <div class="scroll-x cats mt12">
            <button type="button" class="chip" [class.on]="cat() === ''" (click)="cat.set('')">{{ t('menu.cat.all') }}</button>
            @for (c of categories(); track c) { <button type="button" class="chip" [class.on]="cat() === c" (click)="cat.set(c)">{{ i18n.category(c) }}</button> }
          </div>
        }
      </section>

      <section class="section-sm">
        <div class="lbl">{{ t('v2.menu.dishes') }}</div>
        <div class="rows">
          @for (r of dishRows(); track r.item.id) {
            <button type="button" class="row" (click)="open(r)" [class.on]="picked()?.item?.id === r.item.id">
              <span class="ph"><ft-dish-photo [dishId]="r.dish.id" [emoji]="r.dish.emoji || '🍽️'" variant="square" [name]="dishTitle(r)" /></span>
              <span class="txt"><span class="nm">{{ dishTitle(r) }}</span><span class="ct">{{ r.item.description || dishBlurb(r.dish) }}</span></span>
              <span class="price"><span class="pv">{{ fmt(r.item.price) }} <small>{{ cur() }}</small></span>@if (r.item.is_featured) { <span class="hit">{{ t('menu.hit') }}</span> }</span>
            </button>
          } @empty {
            <div class="card card-p center dim">{{ t('menu.empty') }}</div>
          }
        </div>
      </section>

      <section class="section-sm">
        <div class="lbl">{{ t('v2.menu.drinks') }}</div>
        <div class="beers">
          @for (b of drinkRows(); track b.item.id) {
            <a class="beer card hover" [routerLink]="['/drinks', b.drink.id]" (click)="trackDrink(b)">
              <span class="bimg"><ft-drink-art [drink]="b.drink" [size]="92" [preferPhoto]="!!b.drink.image" /></span>
              <span class="bn">{{ b.item.name || b.drink.name }}</span>
              <span class="bs">{{ styleOf(b.drink) }}@if (b.drink.abv !== null && b.drink.abv !== undefined) { · {{ b.drink.flags?.abv_unknown ? '≈' : '' }}{{ b.drink.abv }}% }</span>
              <span class="bp">{{ fmt(b.item.price) }} {{ cur() }} <small>{{ i18n.volume(b.item.volume) }}</small></span>
            </a>
          }
        </div>
      </section>

      <p class="powered">{{ t('menu.powered.pre') }} <a routerLink="/business"><b>Flavor Tree</b></a> {{ t('menu.powered.post') }} <a routerLink="/business">{{ t('menu.powered.cta') }}</a></p>

      @if (picked(); as p) {
        <div class="sheet-bg" (click)="close()"></div>
        <div class="sheet" role="dialog" [attr.aria-label]="t('menu.sheet.aria', { dish: dishTitle(p) })" [style.--accent]="accent()">
          <div class="grab"></div>
          <div class="sh-head">
            <span class="ph"><ft-dish-photo [dishId]="p.dish.id" [emoji]="p.dish.emoji || '🍽️'" variant="square" [name]="dishTitle(p)" /></span>
            <div class="grow"><div class="eyebrow">{{ t('menu.sheet.eyebrow') }}</div><h2>{{ dishTitle(p) }}</h2></div>
            <button type="button" class="btn btn-icon btn-ghost" (click)="close()" [attr.aria-label]="t('common.close')"><ft-icon name="x" /></button>
          </div>
          @if (suggestions().length) {
            <div class="sugg">
              @for (s of suggestions(); track s.row.item.id; let i = $index) {
                <div class="sg" [class.top]="i === 0">
                  <ft-score [score]="s.r.score" [size]="54" [stroke]="5" />
                  <div class="grow">
                    <div class="sg-nm">{{ s.row.item.name || s.row.drink.name }} @if (s.best) { <span class="best">{{ t('common.best') }}</span> } @if (s.r.classic) { <span class="somm">{{ t('v2.card.classic') }}</span> }</div>
                    <div class="sg-band">{{ s.r.band_label }}</div>
                    @if (why(s.r); as w) { <div class="sg-why"><span class="ev" [attr.data-ev]="w.evidence" [attr.title]="evTitle(w.evidence)">{{ w.evidence }}</span>{{ w.text }}</div> }
                    <div class="sg-meta">{{ pairType(s.r.match_type) }} · {{ styleOf(s.row.drink) }} · {{ i18n.volume(s.row.item.volume) }}</div>
                  </div>
                  <div class="sg-buy">
                    <div class="sg-price">{{ fmt(s.row.item.price) }} {{ cur() }}</div>
                    <button type="button" class="btn btn-primary btn-sm" (click)="order(s)" [disabled]="ordered().has(s.row.item.id)">
                      @if (ordered().has(s.row.item.id)) { <ft-icon name="check" [size]="14" /> {{ t('common.ordered') }} } @else { {{ t('common.order') }} }
                    </button>
                  </div>
                </div>
              }
            </div>
            <p class="muted xs mt12 center">{{ t('v2.menu.hint') }}</p>
          } @else {
            <p class="dim center">{{ t('v2.menu.none') }}</p>
          }
        </div>
      }
      <ft-sommelier [venue]="aiVenue()" [table]="tableNo()" />
      @if (toast(); as t) { <div class="toast" role="status">{{ t }}</div> }
    } }
  `,
  styles: [`
    :host { display: block; --accent: #F7941D; }
    .hero { border-radius: var(--r-xl); overflow: hidden; background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #1E1611)); background-size: cover; background-position: center; color: #fff; box-shadow: var(--shadow-2); }
    .hero-in { padding: 22px 18px 18px; background: linear-gradient(180deg, rgba(20,10,0,.15), rgba(20,10,0,.55)); }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo { width: 56px; height: 56px; border-radius: 16px; object-fit: cover; background: #fff; flex-shrink: 0; }
    .logo-ph { display: grid; place-items: center; font-family: var(--font-display); font-weight: 800; font-size: 1.3rem; color: var(--accent); }
    .eyebrow.light { color: rgba(255,255,255,.8); }
    .vn { font-size: 1.7rem; line-height: 1.05; color: #fff; }
    .table { background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.4); padding: 6px 12px; border-radius: var(--r-full); font-weight: 700; font-size: .8rem; white-space: nowrap; }
    .headline { margin-top: 14px; font-family: var(--font-accent); font-style: italic; font-size: 1.15rem; color: #fff; }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .scan-btn { display: flex; align-items: center; gap: 12px; margin-top: 14px; padding: 10px 12px; border-radius: 16px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.3); backdrop-filter: blur(8px); color: #fff; }
    .scan-btn > span:nth-child(2) { flex: 1; line-height: 1.2; } .scan-btn small { opacity: .8; font-size: .74rem; }
    .sb-ico { width: 40px; height: 40px; border-radius: 12px; background: #fff; display: grid; place-items: center; font-size: 1.2rem; flex-shrink: 0; }
    .hchip { background: rgba(255,255,255,.16); backdrop-filter: blur(8px); padding: 6px 10px; border-radius: var(--r-full); font-size: .78rem; font-weight: 600; }
    .section-sm { margin-top: 18px; }
    .cats { padding-block: 2px; }
    .lbl { font-size: .74rem; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); margin-bottom: 10px; }
    .rows { display: grid; gap: 8px; }
    .row { display: flex; gap: 12px; align-items: center; text-align: left; width: 100%; padding: 12px 14px; border-radius: var(--r-lg); background: var(--surface); border: 1.5px solid var(--line); transition: all var(--t-fast); }
    .row:hover, .row.on { border-color: var(--accent); box-shadow: var(--shadow-1); }
    .em { font-size: 1.7rem; width: 46px; height: 46px; display: grid; place-items: center; border-radius: 13px; background: var(--grad-amber-soft); flex-shrink: 0; }
    .ph { width: 52px; flex-shrink: 0; }
    .sh-head .ph { width: 56px; }
    .bimg { display: grid; place-items: center; min-height: 96px; }
    .sg-band { font-family: var(--font-display); font-style: italic; color: var(--gold-soft); font-size: .86rem; margin-top: 2px; }
    .sg-why { display: flex; gap: 6px; align-items: flex-start; }
    .ev { flex-shrink: 0; display: inline-grid; place-items: center; width: 17px; height: 17px; margin-top: 1px; border-radius: 5px; font-size: .6rem; font-weight: 800; color: var(--evc, var(--gold)); border: 1px solid color-mix(in srgb, var(--evc, var(--gold)) 50%, transparent); cursor: help; }
    .ev[data-ev="A"] { --evc: var(--ok); } .ev[data-ev="B"] { --evc: var(--info); } .ev[data-ev="D"] { --evc: var(--ink-3); }
    .txt { display: grid; gap: 2px; min-width: 0; flex: 1; }
    .nm { font-family: var(--font-display); font-weight: 700; }
    .ct { font-size: .76rem; color: var(--ink-3); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    .price { font-family: var(--font-display); font-weight: 800; font-size: 1.05rem; white-space: nowrap; display: grid; justify-items: end; gap: 3px; }
    .pv { white-space: nowrap; }
    .price small { font-weight: 600; font-size: .75em; color: var(--ink-3); }
    .hit { font-size: .62rem; text-transform: uppercase; letter-spacing: .08em; background: var(--accent); color: #fff; padding: 2px 7px; border-radius: var(--r-full); }
    .beers { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    @media (min-width: 640px) { .beers { grid-template-columns: repeat(4, 1fr); } }
    .beer { display: grid; gap: 4px; padding: 12px; text-align: center; }

    .bn { font-family: var(--font-display); font-weight: 700; font-size: .9rem; }
    .bs { font-size: .72rem; color: var(--ink-3); }
    .bp { font-weight: 800; color: var(--amber-700); margin-top: 2px; }
    .bp small { font-weight: 600; color: var(--ink-3); }
    .powered { text-align: center; font-size: .78rem; color: var(--ink-3); margin: 28px 0 8px; }
    .powered a { color: var(--amber-700); }
    .sheet-bg { position: fixed; inset: 0; background: rgba(30,22,17,.45); z-index: 200; animation: fade var(--t-med) both; }
    .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 201; background: var(--surface); border-radius: var(--r-xl) var(--r-xl) 0 0; padding: 8px 16px calc(16px + var(--safe-b)); max-height: 88vh; overflow: auto; box-shadow: var(--shadow-3); animation: up var(--t-slow) var(--ease) both; }
    @media (min-width: 720px) { .sheet { left: 50%; right: auto; width: 640px; transform: translateX(-50%); border-radius: var(--r-xl); bottom: 24px; } @keyframes up { from { transform: translate(-50%, 40px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } } }
    @keyframes up { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    .grab { width: 40px; height: 4px; border-radius: 4px; background: var(--line); margin: 6px auto 12px; }
    .sh-head { display: flex; align-items: center; gap: 12px; }
    .sh-head h2 { font-size: 1.25rem; }
    .sugg { display: grid; gap: 10px; margin-top: 14px; }
    .sg { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: var(--r-lg); border: 1.5px solid var(--line); background: var(--surface-2); }
    .sg.top { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
    .sg-nm { font-family: var(--font-display); font-weight: 800; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .best, .somm { font-size: .6rem; text-transform: uppercase; letter-spacing: .08em; padding: 2px 7px; border-radius: var(--r-full); background: var(--accent); color: #fff; }
    .somm { background: var(--violet); }
    .sg-why { font-size: .82rem; color: var(--ink-2); margin-top: 3px; }
    .sg-meta { font-size: .7rem; color: var(--ink-3); margin-top: 3px; }
    .sg > .grow { min-width: 0; }
    .sg-buy { display: grid; gap: 6px; justify-items: end; flex-shrink: 0; }
    .sg-price { font-family: var(--font-display); font-weight: 800; }
    .toast { position: fixed; left: 50%; top: calc(var(--header-h) + var(--safe-t) + 10px); transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 12px 18px; border-radius: var(--r-lg); z-index: 300; box-shadow: var(--shadow-3); font-weight: 600; width: max-content; max-width: calc(100vw - 32px); text-align: center; animation: fade var(--t-med) both; }
    .spinner { width: 32px; height: 32px; border: 3px solid var(--line); border-top-color: var(--amber-500); border-radius: 50%; margin: 0 auto; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class VenueMenuPage {
  data = inject(DataV2Service);
  private pairing = inject(PairingV2Service);
  private prefs = inject(GuestPrefsService);
  private saas = inject(SaasService);
  private track = inject(TrackV2Service);
  i18n = inject(I18nService);
  /** t() читает сигнал языка: шаблон и computed(), где он вызван, пересчитываются при смене языка. */
  readonly t = this.i18n.t;

  slug = input.required<string>();
  table = input<string | undefined>();

  readonly state = signal<'loading' | 'ready' | 'missing'>('loading');
  readonly menu = signal<VenueMenu | null>(null);
  readonly q = signal('');
  readonly cat = signal('');
  readonly picked = signal<DishRow | null>(null);
  readonly ordered = signal(new Set<string>());
  readonly toast = signal<string | null>(null);
  /** id показанного в шторке списка (аналитика /api/v2/track/) — к нему привязываем «Заказать». */
  private sheetListId: string | null = null;

  readonly cur = computed(() => this.menu()?.venue.currency || '₸');
  readonly accent = computed(() => this.menu()?.venue.accent || '#F7941D');
  readonly tableNo = computed(() => { const t = parseInt(this.table() || '', 10); return Number.isFinite(t) ? t : null; });
  readonly initials = computed(() => (this.menu()?.venue.name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
  readonly typeLabel = computed(() => this.t(VENUE_TYPE_KEYS[this.menu()?.venue.venue_type || ''] ?? 'menu.type.OTHER'));
  /** Слоган заведения — его собственный текст; переводим только стандартный, который кабинет подставляет по умолчанию. */
  readonly headline = computed(() => { const h = this.menu()?.venue.headline || ''; return h === ru['menu.headline.default'] ? this.t('menu.headline.default') : h; });

  readonly dishRowsAll = computed<DishRow[]>(() => (this.menu()?.dishes || [])
    .map(item => ({ item, dish: this.data.dish(item.ref_slug)! })).filter(r => !!r.dish)
    .sort((a, b) => a.item.sort_order - b.item.sort_order));
  readonly categories = computed(() => [...new Set(this.dishRowsAll().map(r => r.item.category || r.dish.category || '').filter(Boolean))]);
  readonly dishRows = computed(() => {
    const q = this.q().trim().toLowerCase().replace(/ё/g, 'е'); const c = this.cat();
    return this.dishRowsAll().filter(r => (!c || (r.item.category || r.dish.category) === c) &&
      (!q || [r.item.name, r.dish.display_name, r.dish.name, this.dishTitle(r), ...(r.dish.synonyms ?? [])]
        .some(s => s?.toLowerCase().replace(/ё/g, 'е').includes(q))));
  });
  /** Позиция карты → напиток v2: по id напитка или по slug сорта v1 (legacy_brand_id). */
  readonly drinkRows = computed<DrinkRow[]>(() => {
    const list = this.data.drinks(); if (!list) return [];
    const byLegacy = new Map(list.filter(d => d.legacy_brand_id).map(d => [d.legacy_brand_id as string, d]));
    return (this.menu()?.beers || [])
      .map(item => ({ item, drink: (this.data.drink(item.ref_slug) ?? byLegacy.get(item.ref_slug))! })).filter(r => !!r.drink)
      .sort((a, b) => a.item.sort_order - b.item.sort_order);
  });
  readonly aiVenue = computed<AiVenue | null>(() => {
    const m = this.menu(); if (!m) return null;
    return { slug: m.venue.slug, name: m.venue.name, beers: m.beers.map(b => b.ref_slug), currency: m.venue.currency,
             prices: Object.fromEntries(m.beers.map(b => [b.ref_slug, b.price])), volumes: Object.fromEntries(m.beers.map(b => [b.ref_slug, b.volume])) };
  });

  /** Подбор движка v2 только из того, что реально есть в карте этого заведения (с учётом профиля гостя). */
  readonly suggestions = computed<Suggestion[]>(() => {
    const p = this.picked(); const rows = this.drinkRows(); if (!p || !rows.length) return [];
    const byId = new Map(rows.map(r => [r.drink.id, r]));
    const rec = this.pairing.forDish(p.dish, { ...this.prefs.ctx() }, { top: 3, venueDrinkIds: [...byId.keys()] });
    const max = rec.items.reduce((m, r) => Math.max(m, r.score), -1);
    let crowned = false;
    const out: Suggestion[] = [];
    for (const r of rec.items) {
      const row = byId.get(r.drink_id); if (!row) continue;
      const best = !crowned && r.score === max; if (best) crowned = true;
      out.push({ r, row, best });
    }
    return out;
  });

  constructor() {
    this.data.ensureDrinks().catch(() => { /* без каталога раздел напитков пуст, меню блюд работает */ });
    effect(async () => {
      const slug = this.slug(); const table = this.tableNo();
      this.state.set('loading');
      const m = await this.saas.loadMenu(slug, table);
      if (!m) { this.state.set('missing'); return; }
      this.menu.set(m); this.state.set('ready');
      this.trackScan(slug, table);
    }, { allowSignalWrites: true });
    // шторка блюда открылась и в ней есть подбор → показ списка (source venue_menu); повтор за 30 с сервис не шлёт
    if (this.track.enabled) {
      effect(() => {
        const p = this.picked(); const sugg = this.suggestions(); const m = this.menu(); const table = this.tableNo();
        if (!p || !m || !sugg.length) return;
        const items = trackItems(sugg.map(s => s.r));
        const venueIds = [...new Set(this.drinkRows().map(r => r.drink.id))]; const ctx = { ...this.prefs.ctx() };
        untracked(() => {
          // пул кандидатов шторки (вся карта заведения) — для честного места на сервере
          const pool = this.pairing.forDish(p.dish, ctx, { top: 0, venueDrinkIds: venueIds }).items;
          this.sheetListId = this.track.listShown({ source: 'venue_menu', dishId: p.dish.id, tab: null, venue: m.venue.slug, table, occasion: null,
                                                    items, poolBestOther: poolBestOther(pool) });
        });
      });
    }
  }

  fmt(n: number): string { return Math.round(n).toLocaleString('ru-RU'); }
  /** Самая конкретная причина: «громкость совпадает» верна почти всегда, поэтому показываем её последней. */
  why(r: PairResult): { text: string; evidence: string } | null { return r.reasons.find(x => x.rule !== 'R1') ?? r.reasons[0] ?? null; }
  evTitle(ev: string): string { return ['A', 'B', 'C', 'D'].includes(ev) ? this.t(`v2.ev.${ev}` as I18nKey) : ev; }
  pairType(type: string): string { return this.t(`v2.type.${type}` as I18nKey); }
  styleOf(d: DrinkV2): string { return d.style?.name || this.t(`v2.cat.${d.category}` as I18nKey); }
  /** Название позиции от заведения важнее перевода из словаря. */
  dishTitle(r: DishRow): string { return r.item.name || this.i18n.dishName({ id: r.dish.id, display_name: r.dish.display_name || r.dish.name }); }
  /** Описание блюда: по-русски — из каталога, на kk/en — кухня. */
  dishBlurb(d: DishV2): string { return this.i18n.locale() === 'ru' ? (d.description ?? '') : (d.category ?? ''); }

  open(r: DishRow): void {
    this.picked.set(r);
    const v = this.menu()!.venue.slug;
    this.saas.track({ venue: v, kind: 'DISH_VIEW', dish: r.dish.id, table: this.tableNo() });
    const top = this.suggestions()[0];
    if (top) this.saas.track({ venue: v, kind: 'PAIR_VIEW', dish: r.dish.id, beer: top.row.item.ref_slug, score: top.r.score, table: this.tableNo() });
  }
  close(): void { this.picked.set(null); this.sheetListId = null; }

  order(s: Suggestion): void {
    const p = this.picked(); if (!p) return;
    // сессия трекинга (не id гостя): сервер склеит это нажатие с order_intent ниже и хранит её только как HMAC
    this.saas.track({ venue: this.menu()!.venue.slug, kind: 'ORDER_INTENT', dish: p.dish.id, beer: s.row.item.ref_slug,
                      score: s.r.score, price: s.row.item.price, table: this.tableNo(), session: this.track.enabled ? this.track.session() : undefined });
    this.track.action({ kind: 'order_intent', listId: this.sheetListId, drinkId: s.row.drink.id, dishId: p.dish.id,
                        venue: this.menu()!.venue.slug });
    this.ordered.update(set => new Set(set).add(s.row.item.id));
    this.flash(this.t('menu.toast.order', { beer: s.row.item.name || s.row.drink.name, dish: this.dishTitle(p) }));
  }
  trackDrink(b: DrinkRow): void { this.saas.track({ venue: this.menu()!.venue.slug, kind: 'BEER_VIEW', beer: b.item.ref_slug, table: this.tableNo() }); }

  private trackScan(slug: string, table: number | null): void {
    const key = `ft.scan.${slug}.${table ?? 0}`;
    try {
      const last = +(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 60 * 60 * 1000) return;   // повторное открытие за час — не новый гость
      sessionStorage.setItem(key, String(Date.now()));
    } catch { /* ignore */ }
    this.saas.track({ venue: slug, kind: 'SCAN', table });
  }
  private flash(text: string): void { this.toast.set(text); setTimeout(() => this.toast.set(null), 2600); }
}
