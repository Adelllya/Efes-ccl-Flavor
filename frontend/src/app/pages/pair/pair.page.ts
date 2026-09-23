import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataV2Service, DishV2 } from '../../core/data-v2.service';
import { COOKING_LABELS, FAT_LABELS, TASTE_LABELS, WEIGHT_LABELS } from '../../core/pairing.service';
import { VenueService } from '../../core/venue.service';
import { I18nKey, I18nService } from '../../core/i18n.service';
import { cuisineLabel } from '../../core/cuisines-v2';
import { Cooking, Fat, Taste, Weight } from '../../core/models';
import { IconComponent } from '../../ui/icon.component';
import { DishPhotoComponent } from '../../ui/dish-photo.component';
import { SommelierChatComponent } from '../../ui/sommelier-chat.component';
import { SaasService } from '../../core/saas.service';
import { AiVenue } from '../../core/ai.service';

type Step = 'pick' | 'taste' | 'body' | 'cook' | 'final';

/**
 * Шаг 1 подбора: найти блюдо в базе v2 (114 блюд, фото, кухни, синонимы) или описать своё за 4 шага.
 * Мастер «своё блюдо» ведёт на /pair/custom с query-параметрами v1 (taste, weight, fat, cooking, heat, name) —
 * страница результатов v2 их понимает.
 */
@Component({
  selector: 'ft-pair',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, DishPhotoComponent, SommelierChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (step() === 'pick') {
      <section class="top">
        <span class="eyebrow">{{ t('pk.step') }}</span>
        <h1>{{ t('pk.h1a') }} <span class="grad-text">{{ t('pk.h1b') }}</span></h1>
        <p class="dim mt8">{{ t('pk.lede', { n: nDrinks() }) }}</p>
        <div class="search mt16">
          <ft-icon name="search" />
          <input class="input" type="search" autocomplete="off" enterkeyhint="search" [placeholder]="t('pk.search.ph')" [ngModel]="q()" (ngModelChange)="q.set($event)" (keydown.enter)="enter()" [attr.aria-label]="t('home.search.aria')" autofocus />
        </div>
        <a routerLink="/scan" class="scan-cta mt12"><span class="sc-ico"><ft-icon name="camera" [size]="22" /></span><span><b>{{ t('pk.scan.t') }}</b><br><span class="dim sm">{{ t('pk.scan.d') }}</span></span><ft-icon name="chevron-right" /></a>
        @if (venue.venue(); as v) {
          <div class="soft venue mt12"><ft-icon name="map-pin" [size]="18" /><span>{{ t('pk.venue') }} <b>{{ v.name }}</b>. <button type="button" class="link" (click)="onlyMenu.set(!onlyMenu())">{{ onlyMenu() ? t('pk.venue.all', { n: data.dishes().length }) : t('pk.venue.only') }}</button></span></div>
        }
      </section>

      @if (q().trim()) {
        <section class="section-sm">
          @if (hits().length) {
            <div class="tiles">@for (h of hits(); track h.dish.id) { <a class="card hover tile" [routerLink]="['/pair', h.dish.id]" [attr.aria-label]="t('pk.tile.aria', { dish: name(h.dish) })">
              <ft-dish-photo [dishId]="h.dish.id" [emoji]="h.dish.emoji || '🍽️'" variant="square" [name]="name(h.dish)" />
              <span class="tb"><span class="tn">{{ name(h.dish) }}</span><span class="tc ellipsis">{{ sub(h.dish) }}</span></span>
            </a> }</div>
            <button type="button" class="btn btn-secondary btn-block mt12" (click)="startCustom()"><ft-icon name="sparkles" [size]="16" /> {{ t('pk.notIt', { q: q() }) }}</button>
          } @else {
            <div class="card card-p center"><p class="dim">{{ t('pk.none') }}</p><button type="button" class="btn btn-primary mt12" (click)="startCustom()"><ft-icon name="sparkles" /> {{ t('pk.describe', { q: q() }) }}</button></div>
          }
        </section>
      } @else {
        <section class="section-sm">
          <div class="cuisines scroll-x" role="group" [attr.aria-label]="t('pk.cuisines')">
            <button type="button" class="chip" [class.on]="cuisine() === ''" [attr.aria-pressed]="cuisine() === ''" (click)="cuisine.set('')">{{ t('pk.all') }} <span class="n">{{ base().length }}</span></button>
            @for (c of cuisines(); track c.id) { <button type="button" class="chip" [class.on]="cuisine() === c.id" [attr.aria-pressed]="cuisine() === c.id" (click)="cuisine.set(cuisine() === c.id ? '' : c.id)">{{ c.label }} <span class="n">{{ c.n }}</span></button> }
          </div>
          <div class="tiles mt16">
            @for (d of list(); track d.id; let i = $index) {
              <a class="card hover tile" [class]="'card hover tile' + (i < 12 ? ' reveal reveal-' + (i % 5 + 1) : '')" [routerLink]="['/pair', d.id]" [attr.aria-label]="t('pk.tile.aria', { dish: name(d) })">
                <ft-dish-photo [dishId]="d.id" [emoji]="d.emoji || '🍽️'" variant="square" [name]="name(d)" [priority]="i < 4" />
                <span class="tb">
                  <span class="tn">{{ name(d) }}</span>
                  <span class="tc ellipsis">{{ sub(d) }}</span>
                  @if (isHot(d)) { <span class="hot"><ft-icon name="flame" [size]="12" /> {{ t('pk.hot') }}</span> }
                </span>
              </a>
            } @empty {
              <div class="card card-p center dim empty">{{ t('pk.empty') }}</div>
            }
          </div>
          <button type="button" class="card hover card-p custom mt16" (click)="startCustom()">
            <span class="ci"><ft-icon name="sparkles" [size]="24" /></span>
            <span><b>{{ t('pk.custom.t') }}</b><br><span class="dim sm">{{ t('pk.custom.d', { n: data.dishes().length }) }}</span></span>
            <ft-icon name="chevron-right" />
          </button>
        </section>
      }
    } @else {
      <!-- МАСТЕР «СВОЁ БЛЮДО» -->
      <section class="wiz">
        <button type="button" class="btn btn-ghost btn-sm" (click)="back()"><ft-icon name="arrow-left" [size]="16" /> {{ t('pk.back') }}</button>
        <div class="bar thin mt12"><i [style.width.%]="progress()"></i></div>
        <div class="muted xs mt8">{{ t('pk.wiz.step', { i: stepIdx(), name: name_() || t('pk.wiz.own') }) }}</div>

        @switch (step()) {
          @case ('taste') {
            <h2 class="mt12">{{ t('pk.wiz.taste') }}</h2>
            <div class="opts">
              @for (t of tastes; track t.id) { <button type="button" class="opt" [class.on]="taste() === t.id" (click)="taste.set(t.id); next('body')"><span class="oe">{{ t.e }}</span><span class="ol">{{ i18n.tasteLabel(t.id, t.l) }}</span><span class="od">{{ tr(t.d) }}</span></button> }
            </div>
          }
          @case ('body') {
            <h2 class="mt12">{{ t('pk.wiz.body') }}</h2>
            <div class="lbl mt12">{{ t('pk.wiz.weight') }}</div>
            <div class="seg">@for (w of weights; track w.id) { <button type="button" [class.on]="weight() === w.id" (click)="weight.set(w.id)">{{ i18n.weightLabel(w.id, w.l) }}</button> }</div>
            <div class="lbl mt16">{{ t('pk.wiz.fat') }}</div>
            <div class="seg">@for (f of fats; track f.id) { <button type="button" [class.on]="fat() === f.id" (click)="fat.set(f.id)">{{ i18n.fatLabel(f.id, f.l) }}</button> }</div>
            <button type="button" class="btn btn-primary btn-block mt24" (click)="next('cook')">{{ t('pk.wiz.next') }} <ft-icon name="arrow-right" /></button>
          }
          @case ('cook') {
            <h2 class="mt12">{{ t('pk.wiz.cook') }}</h2>
            <div class="opts">
              @for (c of cooks; track c.id) { <button type="button" class="opt" [class.on]="cooking() === c.id" (click)="cooking.set(c.id); next('final')"><span class="oe">{{ c.e }}</span><span class="ol">{{ i18n.cookingLabel(c.id, c.l) }}</span></button> }
            </div>
          }
          @case ('final') {
            <h2 class="mt12">{{ t('pk.wiz.final') }}</h2>
            <div class="lbl mt12">{{ t('pk.wiz.heat', { v: heatLabel() }) }}</div>
            <input type="range" class="range" min="0" max="100" step="5" [ngModel]="heat()" (ngModelChange)="heat.set(+$event)" [attr.aria-label]="t('pk.wiz.heatAria')" />
            <div class="lbl mt16">{{ t('pk.wiz.name') }}</div>
            <input class="input" [ngModel]="name_()" (ngModelChange)="name_.set($event)" [placeholder]="t('pk.wiz.namePh')" />
            <div class="summary card card-p mt16">
              <div class="muted xs mb8">{{ t('pk.wiz.sum') }}</div>
              <div class="flex g6 wrap"><span class="chip chip-sm">{{ tasteLabel() }}</span><span class="chip chip-sm">{{ weightLabel() }}</span><span class="chip chip-sm">{{ t('pk.wiz.fatChip', { v: fatLabel() }) }}</span><span class="chip chip-sm">{{ cookLabel() }}</span>@if (heat() > 0) { <span class="chip chip-sm"><ft-icon name="flame" [size]="12" /> {{ heat() }}%</span> }</div>
            </div>
            <button type="button" class="btn btn-primary btn-lg btn-block mt16" (click)="finish()"><ft-icon name="sparkles" /> {{ t('pk.wiz.go') }}</button>
          }
        }
      </section>
    }
    <ft-sommelier [venue]="aiVenue()" />
  `,
  styles: [`
    .top h1 { margin-top: 8px; }
    .top .dim { max-width: 62ch; }
    .scan-cta { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--r-lg); background: var(--surface); border: 1.5px solid var(--line); box-shadow: var(--shadow-1); transition: transform var(--t-fast), border-color var(--t-fast); }
    .scan-cta:hover { transform: translateY(-2px); border-color: var(--amber-400); } .scan-cta > span:nth-child(2) { flex: 1; }
    .sc-ico { width: 44px; height: 44px; border-radius: 14px; background: var(--grad-amber); color: var(--on-gold); display: grid; place-items: center; flex-shrink: 0; }
    .section-sm { margin-top: 20px; }
    .venue { display: flex; gap: 10px; align-items: center; padding: 12px 14px; font-size: .9rem; }
    .link { color: var(--amber-700); font-weight: 700; text-decoration: underline; }
    .cuisines { padding-block: 4px; gap: 6px; }
    .chip .n { font-weight: 600; opacity: .65; font-variant-numeric: tabular-nums; }
    .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    @media (min-width: 640px) { .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; } }
    @media (min-width: 1000px) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; } }
    .tile { display: grid; gap: 0; overflow: hidden; min-width: 0; }
    .tile ft-dish-photo { --r-md: 0px; }
    .tb { display: grid; gap: 2px; padding: 10px 12px 12px; min-width: 0; }
    .tn { font-family: var(--font-display); font-weight: 700; font-size: 1.08rem; line-height: 1.12; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .tc { color: var(--ink-3); font-size: .74rem; }
    .hot { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; font-size: .68rem; font-weight: 700; color: var(--warn); }
    .empty { grid-column: 1 / -1; }
    .custom { display: flex; align-items: center; gap: 14px; text-align: left; width: 100%; }
    .ci { width: 48px; height: 48px; border-radius: 14px; background: var(--grad-amber); color: var(--on-gold); display: grid; place-items: center; flex-shrink: 0; }
    .custom > span:nth-child(2) { flex: 1; }
    .wiz { max-width: 640px; margin: 0 auto; }
    .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
    @media (min-width: 640px) { .opts { grid-template-columns: repeat(3, 1fr); } }
    .opt { display: grid; gap: 2px; text-align: left; padding: 14px; border-radius: var(--r-lg); background: var(--surface); border: 1.5px solid var(--line); transition: all var(--t-fast); min-height: 96px; }
    .opt:hover { border-color: var(--amber-400); transform: translateY(-2px); box-shadow: var(--shadow-1); }
    .opt.on { border-color: var(--amber-500); background: var(--amber-100); box-shadow: var(--ring); }
    .oe { font-size: 1.6rem; } .ol { font-family: var(--font-display); font-weight: 700; } .od { font-size: .74rem; color: var(--ink-3); }
    .lbl { font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); margin-bottom: 8px; }
    .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--bg-2); }
    .seg button { min-height: 44px; border-radius: 10px; font-weight: 700; color: var(--ink-2); }
    .seg button.on { background: var(--surface); color: var(--amber-800); box-shadow: var(--shadow-1); }
  `],
})
export class PairPage {
  private saas = inject(SaasService);
  /** Контекст для ИИ: если гость в заведении — только его карта, с ценами. */
  readonly aiVenue = computed<AiVenue | null>(() => {
    const v = this.venue.venue(); if (!v) return null;
    // пустая локальная карта (режим с сервером) — как будто её нет: сорта заведения без цен
    const m0 = this.saas.localMenu(v.id, null); const m = m0 && m0.beers.length ? m0 : null;
    return { slug: v.id, name: v.name, beers: m ? m.beers.map(b => b.ref_slug) : v.brands, currency: m?.venue.currency,
             prices: m ? Object.fromEntries(m.beers.map(b => [b.ref_slug, b.price])) : undefined };
  });
  data = inject(DataV2Service);
  venue = inject(VenueService);
  i18n = inject(I18nService);
  t = this.i18n.t;
  tr(k: I18nKey): string { return this.t(k); }
  private router = inject(Router);

  /** ?q= с главной */
  qParam = input<string>('', { alias: 'q' });
  q = signal('');
  cuisine = signal('');
  onlyMenu = signal(true);
  step = signal<Step>('pick');
  taste = signal<Taste>('UMAMI'); weight = signal<Weight>('MEDIUM'); fat = signal<Fat>('MEDIUM'); cooking = signal<Cooking>('GRILLED');
  heat = signal(0); name_ = signal('');

  readonly tastes: { id: Taste; e: string; l: string; d: I18nKey }[] = [
    { id: 'UMAMI', e: '🍖', l: 'Мясное · умами', d: 'pk.taste.UMAMI' }, { id: 'SALTY', e: '🧂', l: 'Солёное', d: 'pk.taste.SALTY' },
    { id: 'SPICY', e: '🌶️', l: 'Острое', d: 'pk.taste.SPICY' }, { id: 'SWEET', e: '🍰', l: 'Сладкое', d: 'pk.taste.SWEET' },
    { id: 'SOUR', e: '🍋', l: 'Кислое', d: 'pk.taste.SOUR' }, { id: 'MIXED', e: '🥘', l: 'Микс', d: 'pk.taste.MIXED' },
  ];
  readonly weights: { id: Weight; l: string }[] = [{ id: 'LIGHT', l: 'Лёгкое' }, { id: 'MEDIUM', l: 'Среднее' }, { id: 'HEAVY', l: 'Сытное' }];
  readonly fats: { id: Fat; l: string }[] = [{ id: 'LOW', l: 'Низкая' }, { id: 'MEDIUM', l: 'Средняя' }, { id: 'HIGH', l: 'Высокая' }];
  readonly cooks: { id: Cooking; e: string; l: string }[] = [
    { id: 'GRILLED', e: '🔥', l: 'Гриль / угли' }, { id: 'FRIED', e: '🍳', l: 'Жарка' }, { id: 'BAKED', e: '🥧', l: 'Запекание' },
    { id: 'BOILED', e: '🍲', l: 'Варка / тушение' }, { id: 'STEAMED', e: '♨️', l: 'На пару' }, { id: 'RAW', e: '🥗', l: 'Сырое / салат' },
    { id: 'CURED', e: '🥓', l: 'Вяленое / копчёное' }, { id: 'FERMENTED', e: '🫙', l: 'Ферментация' }, { id: 'OTHER', e: '🍽️', l: 'Другое' },
  ];

  /** Число напитков в подборе (каталог грузится лениво; до загрузки — «сотен»). */
  readonly nDrinks = computed(() => { const n = this.data.stats().inPairing; return n ? String(n) : this.t('pk.many'); });
  hits = computed(() => this.data.searchDishes(this.q(), 12));
  /** Блюда, доступные к выбору: карта заведения (v2 хранит id блюд v1) или весь каталог. */
  readonly base = computed<DishV2[]>(() => {
    const menu = this.venue.menuIds();
    const l = this.data.dishes();
    return menu && this.onlyMenu() ? l.filter(d => menu.includes(d.id)) : l;
  });
  readonly cuisines = computed(() => {
    const counts = new Map<string, number>();
    for (const d of this.base()) for (const c of d.cuisine ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
    const loc = this.i18n.locale();
    return [...counts.entries()].map(([id, n]) => ({ id, n, label: cuisineLabel(id, loc) })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, loc));
  });
  list = computed<DishV2[]>(() => {
    const c = this.cuisine();
    return c ? this.base().filter(d => (d.cuisine ?? []).includes(c)) : this.base();
  });
  stepIdx = computed(() => ({ pick: 0, taste: 1, body: 2, cook: 3, final: 4 })[this.step()]);
  progress = computed(() => this.stepIdx() * 25);
  heatLabel = computed(() => this.t(this.heat() === 0 ? 'pk.heat.0' : this.heat() < 40 ? 'pk.heat.1' : this.heat() < 75 ? 'pk.heat.2' : 'pk.heat.3'));
  tasteLabel = computed(() => this.i18n.tasteLabel(this.taste(), TASTE_LABELS[this.taste()])); weightLabel = computed(() => this.i18n.weightLabel(this.weight(), WEIGHT_LABELS[this.weight()]));
  fatLabel = computed(() => this.i18n.fatLabel(this.fat(), FAT_LABELS[this.fat()])); cookLabel = computed(() => this.i18n.cookingLabel(this.cooking(), COOKING_LABELS[this.cooking()]));

  constructor() {
    queueMicrotask(() => { if (this.qParam()) this.q.set(this.qParam()); });
    this.data.ensureDrinks().catch(() => { /* каталог нужен на следующем шаге; ошибку покажет страница результатов */ });
  }

  name(d: DishV2): string { return this.i18n.dishName({ id: d.id, display_name: d.display_name || d.name }); }
  sub(d: DishV2): string {
    const loc = this.i18n.locale();
    const cz = (d.cuisine ?? []).slice(0, 1).map(c => cuisineLabel(c, loc));
    const cat = d.category ? this.i18n.category(d.category) : '';
    return [cz[0], cat].filter(Boolean).join(' · ');
  }
  isHot(d: DishV2): boolean { return (d.vector?.['heat'] ?? 0) >= 0.5; }
  enter(): void { const h = this.hits()[0]; if (h) this.router.navigate(['/pair', h.dish.id]); }
  startCustom(): void { if (this.q().trim()) this.name_.set(this.q().trim()); this.step.set('taste'); window.scrollTo({ top: 0 }); }
  next(s: Step): void { this.step.set(s); }
  back(): void { const order: Step[] = ['pick', 'taste', 'body', 'cook', 'final']; this.step.set(order[Math.max(0, this.stepIdx() - 1)]); }
  finish(): void {
    this.router.navigate(['/pair', 'custom'], { queryParams: { taste: this.taste(), weight: this.weight(), fat: this.fat(), cooking: this.cooking(), heat: this.heat() || null, name: this.name_() || null } });
  }
}
