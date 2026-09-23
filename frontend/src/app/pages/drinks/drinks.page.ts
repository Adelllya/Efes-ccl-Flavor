import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataV2Service, DrinkV2, TAB_GROUPS, isGuestVisible } from '../../core/data-v2.service';
import { I18nKey, I18nService } from '../../core/i18n.service';
import { IconComponent } from '../../ui/icon.component';
import { DrinkArtComponent } from '../../ui/drink-art.component';

type Sort = 'name' | 'conf' | 'abv';
const PAGE = 48;
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/**
 * Каталог напитков v2: честные счётчики из DataV2Service.stats(), поиск (название · производитель · стиль),
 * группы категорий как вкладки подбора + категории внутри группы, «Только Efes», черновики по требованию,
 * сортировка, сетка карточек с иллюстрацией из данных. Порциями по 48 — 400 SVG-бокалов сразу тяжелы для телефона.
 */
@Component({
  selector: 'ft-drinks',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, DrinkArtComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <div>
        <span class="eyebrow">{{ t('drinks.eyebrow') }}</span>
        @if (data.drinks(); as all) {
          <h1 class="h num">{{ i18n.count(all.length, 'count.drinks') }}<span class="dot"> · </span><span class="grad-text">{{ i18n.count(nCategories(), 'count.categories') }}</span></h1>
          <p class="dim mt8 lede-sm">{{ t('drinks.sub', { nonEfes: data.stats().nonEfes, inPairing: data.stats().inPairing }) }}</p>
        } @else {
          <div class="skeleton sk-h mt8" aria-hidden="true"></div>
          <div class="skeleton sk-p mt8" aria-hidden="true"></div>
        }
      </div>
      <a routerLink="/beers" class="btn btn-secondary btn-sm pyr"><ft-icon name="tree" [size]="16" /> {{ t('drinks.pyramids') }}</a>
    </header>

    <section class="filters card mt16" [attr.aria-label]="t('drinks.search.aria')">
      <div class="search">
        <ft-icon name="search" />
        <input class="input" type="search" autocomplete="off" enterkeyhint="search" [placeholder]="t('drinks.search')" [ngModel]="q()" (ngModelChange)="setQ($event)" [attr.aria-label]="t('drinks.search.aria')" />
      </div>
      <div class="scroll-x fr" role="group" [attr.aria-label]="t('v2.pair.tabsAria')">
        <button type="button" class="chip chip-sm" [class.on]="group() === ''" [attr.aria-pressed]="group() === ''" (click)="setGroup('')">{{ t('drinks.all') }} <span class="n">{{ pool().length }}</span></button>
        @for (g of groups(); track g.id) {
          <button type="button" class="chip chip-sm" [class.on]="group() === g.id" [attr.aria-pressed]="group() === g.id" (click)="setGroup(g.id)">{{ t(g.label) }} <span class="n">{{ g.n }}</span></button>
        }
      </div>
      @if (subCategories().length > 1) {
        <div class="scroll-x fr sub" role="group" [attr.aria-label]="t(groupLabel())">
          @for (c of subCategories(); track c.id) {
            <button type="button" class="chip chip-sm ghost" [class.on]="category() === c.id" [attr.aria-pressed]="category() === c.id" (click)="setCategory(category() === c.id ? '' : c.id)">{{ t(c.label) }} <span class="n">{{ c.n }}</span></button>
          }
        </div>
      }
      <div class="row">
        <button type="button" class="chip chip-sm" [class.on]="onlyEfes()" [attr.aria-pressed]="onlyEfes()" (click)="toggleEfes()">{{ t('drinks.onlyEfes') }}</button>
        <button type="button" class="chip chip-sm" [class.on]="showHidden()" [attr.aria-pressed]="showHidden()" (click)="toggleHidden()">{{ t('drinks.showHidden') }} <span class="n">{{ hiddenCount() }}</span></button>
        <label class="sort">
          <span class="muted xs">{{ t('drinks.sort') }}</span>
          <select class="input sel" [ngModel]="sort()" (ngModelChange)="sort.set($event)">
            <option value="name">{{ t('drinks.sort.name') }}</option>
            <option value="conf">{{ t('drinks.sort.conf') }}</option>
            <option value="abv">{{ t('drinks.sort.abv') }}</option>
          </select>
        </label>
        <span class="muted xs total" aria-live="polite">{{ t('drinks.shown', { shown: list().length, total: pool().length }) }}</span>
      </div>
    </section>

    @if (data.drinks() === null) {
      @if (data.error()) {
        <div class="card card-p center mt16"><p class="dim">{{ t('v2.pair.loadError') }}</p></div>
      } @else {
        <div class="grid dk-grid mt16" aria-busy="true">
          @for (i of skeletons; track i) { <div class="card skeleton sk"></div> }
        </div>
      }
    } @else {
      <div class="grid dk-grid mt16">
        @for (d of shown(); track d.id) {
          <a class="card hover dk" [class.off]="!visible(d)" [routerLink]="['/drinks', d.id]" [attr.aria-label]="name(d)">
            <div class="stage"><ft-drink-art [drink]="d" [size]="92" [preferPhoto]="!!d.image" [alt]="name(d)" /></div>
            <div class="body">
              <div class="chips">
                @if (d.efes_relation && d.efes_relation !== 'none') { <span class="badge efes">{{ relLabel(d) }}</span> }
                @if (d.flags?.non_alcoholic) { <span class="badge na">{{ t('drinks.na') }}</span> }
                @if (!visible(d)) { <span class="badge badge-warn">{{ t('drinks.excluded') }}</span> }
              </div>
              <h3 class="nm">{{ name(d) }}</h3>
              <p class="sub ellipsis">{{ producer(d) }}</p>
              <p class="style ellipsis">{{ d.style?.name || t(catKey(d)) }}</p>
              <div class="meta">
                <span class="abv num">{{ abv(d) }}</span>
                <span class="conf" [attr.title]="t('drinks.conf', { n: conf(d) })" [attr.aria-label]="t('drinks.conf', { n: conf(d) })" role="img"><i [style.width.%]="conf(d)"></i></span>
              </div>
              @if (!visible(d)) { <p class="reason">{{ reason(d) }}</p> }
            </div>
          </a>
        } @empty {
          <div class="card card-p center dim empty">{{ t('drinks.empty') }}</div>
        }
      </div>
      @if (shown().length < list().length) {
        <div class="center mt24">
          <button type="button" class="btn btn-secondary" (click)="page.set(page() + 1)">{{ t('drinks.more') }} <span class="rest">· {{ list().length - shown().length }}</span> <ft-icon name="chevron-down" [size]="16" /></button>
        </div>
      }
    }
  `,
  styles: [`
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px 24px; flex-wrap: wrap; }
    .top > div { min-width: 0; flex: 1 1 320px; }
    .h { margin-top: 6px; font-size: clamp(2.1rem, 5vw + .5rem, 3.6rem); }
    /* на телефоне заголовок в две строки — разделитель не нужен */
    .h .dot { display: none; } @media (min-width: 560px) { .h .dot { display: inline; } }
    .h .grad-text { display: block; } @media (min-width: 560px) { .h .grad-text { display: inline; } }
    .lede-sm { max-width: 62ch; }
    .pyr { flex-shrink: 0; }
    .sk-h { height: 44px; width: min(100%, 420px); }
    .sk-p { height: 18px; width: min(100%, 520px); }
    .filters { padding: 12px; display: grid; gap: 10px; }
    @media (min-width: 720px) { .filters { padding: 14px 16px; } }
    .fr { margin: 0; padding: 0; gap: 6px; align-items: center; }
    .fr.sub { padding-left: 8px; border-left: 2px solid rgba(229, 184, 73, .35); }
    .chip .n { font-weight: 600; opacity: .7; font-variant-numeric: tabular-nums; margin-left: 2px; }
    .chip.on .n { opacity: .8; }
    .chip.ghost { background: transparent; border-color: var(--line-2); }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .sort { display: inline-flex; align-items: center; gap: 8px; }
    .sel { max-width: 230px; min-height: 34px; font-size: .82rem; padding-block: 0; border-radius: var(--r-sm); }
    .total { margin-left: auto; white-space: nowrap; }
    .dk-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    @media (min-width: 640px) { .dk-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; } }
    @media (min-width: 1000px) { .dk-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; } }
    .sk { height: 250px; }
    .empty { grid-column: 1 / -1; }
    .dk { display: grid; grid-template-rows: auto 1fr; overflow: hidden; min-width: 0; }
    .dk.off { opacity: .78; }
    .stage { display: grid; place-items: center; padding: 14px 8px 8px; min-height: 118px; background: radial-gradient(70% 55% at 50% 92%, var(--gold-glow), transparent), linear-gradient(180deg, rgba(255, 248, 235, .02), transparent); border-bottom: 1px solid var(--line-2); }
    .body { padding: 10px 12px 12px; display: grid; gap: 3px; align-content: start; min-width: 0; }
    .chips { display: flex; gap: 4px; flex-wrap: wrap; min-height: 0; }
    .chips:empty { display: none; }
    .badge { font-size: .6rem; padding: 2px 7px; letter-spacing: .06em; }
    .badge.efes { color: var(--on-gold); background: var(--grad-amber); border-color: transparent; }
    .badge.na { background: var(--info-bg); color: var(--info); border-color: transparent; }
    .nm { font-family: var(--font-display); font-size: 1.08rem; font-weight: 700; line-height: 1.12; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 2px; }
    .sub { color: var(--ink-3); font-size: .74rem; }
    .style { color: var(--ink-2); font-size: .78rem; }
    .meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .abv { font-size: 1rem; color: var(--gold-soft); }
    .conf { display: inline-block; width: 40px; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; margin-left: auto; }
    .conf i { display: block; height: 100%; background: var(--gold); border-radius: 3px; }
    .reason { font-size: .7rem; color: var(--warn); line-height: 1.3; margin-top: 4px; }
    .rest { font-weight: 600; opacity: .7; }
  `],
})
export class DrinksPage {
  data = inject(DataV2Service);
  i18n = inject(I18nService);
  readonly t = this.i18n.t;

  q = signal('');
  group = signal('');
  category = signal('');
  onlyEfes = signal(false);
  showHidden = signal(false);
  sort = signal<Sort>('name');
  page = signal(1);
  readonly skeletons = Array.from({ length: 8 }, (_, i) => i);

  /** Базовый пул: без черновиков и неподтверждённых, если их не попросили показать. */
  readonly pool = computed<DrinkV2[]>(() => {
    const all = this.data.drinks() ?? [];
    return this.showHidden() ? all : all.filter(isGuestVisible);
  });
  readonly hiddenCount = computed(() => (this.data.drinks() ?? []).filter(d => !isGuestVisible(d)).length);
  readonly nCategories = computed(() => new Set((this.data.drinks() ?? []).map(d => d.category)).size);

  readonly groups = computed(() => {
    const pool = this.pool();
    return TAB_GROUPS.map(g => ({ id: g.id, label: `v2.tab.${g.id}` as I18nKey, n: pool.filter(d => g.categories.includes(d.category)).length })).filter(g => g.n > 0);
  });
  readonly groupLabel = computed(() => `v2.tab.${this.group()}` as I18nKey);
  readonly subCategories = computed(() => {
    const g = TAB_GROUPS.find(x => x.id === this.group());
    if (!g) return [];
    const pool = this.pool();
    return g.categories.map(c => ({ id: c, label: `v2.cat.${c}` as I18nKey, n: pool.filter(d => d.category === c).length })).filter(c => c.n > 0);
  });

  readonly list = computed<DrinkV2[]>(() => {
    const q = norm(this.q().trim());
    const g = TAB_GROUPS.find(x => x.id === this.group());
    const cat = this.category();
    let l = this.pool().filter(d =>
      (!g || g.categories.includes(d.category)) && (!cat || d.category === cat) && (!this.onlyEfes() || (d.efes_relation ?? 'none') !== 'none'));
    if (q) l = l.filter(d => norm([d.name, d.display_name ?? '', d.producer?.name ?? '', d.style?.name ?? '', d.style?.family ?? '', this.t(this.catKey(d))].join(' ')).includes(q));
    const s = this.sort();
    return [...l].sort((a, b) => s === 'name' ? this.name(a).localeCompare(this.name(b), 'ru')
      : s === 'conf' ? (b.vector_confidence ?? 0) - (a.vector_confidence ?? 0) || this.name(a).localeCompare(this.name(b), 'ru')
      : (b.abv ?? -1) - (a.abv ?? -1) || this.name(a).localeCompare(this.name(b), 'ru'));
  });
  readonly shown = computed(() => this.list().slice(0, this.page() * PAGE));

  constructor() { this.data.ensureDrinks().catch(() => { /* ошибку показывает шаблон */ }); }

  setQ(v: string): void { this.q.set(v); this.page.set(1); }
  setGroup(id: string): void { this.group.set(id); this.category.set(''); this.page.set(1); }
  setCategory(id: string): void { this.category.set(id); this.page.set(1); }
  toggleEfes(): void { this.onlyEfes.set(!this.onlyEfes()); this.page.set(1); }
  toggleHidden(): void { this.showHidden.set(!this.showHidden()); this.page.set(1); }

  visible(d: DrinkV2): boolean { return isGuestVisible(d); }
  name(d: DrinkV2): string { return d.display_name || d.name; }
  catKey(d: DrinkV2): I18nKey { return `v2.cat.${d.category}` as I18nKey; }
  producer(d: DrinkV2): string {
    const p = d.producer?.name ?? '';
    return d.producer?.country && d.producer.country !== 'ZZ' ? `${p} · ${d.producer.country}` : p;
  }
  abv(d: DrinkV2): string {
    if (d.abv === null || d.abv === undefined) return '—';
    return `${d.flags?.abv_unknown ? '≈' : ''}${String(d.abv).replace('.', ',')} %`;
  }
  conf(d: DrinkV2): number { return Math.round((d.vector_confidence ?? 0.5) * 100); }
  relLabel(d: DrinkV2): string { return d.efes_relation === 'own' ? this.t('v2.card.efes') : this.t(`v2.rel.${d.efes_relation}` as I18nKey); }
  reason(d: DrinkV2): string {
    return d.status === 'draft' ? this.t('drinks.reason.draft') : this.t('drinks.reason.not_confirmed');
  }
}
