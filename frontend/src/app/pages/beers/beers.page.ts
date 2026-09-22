import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/data.service';
import { Brand, Packaging } from '../../core/models';
import { IconComponent } from '../../ui/icon.component';
import { BeerCardComponent } from '../../ui/beer-card.component';

type Sort = 'name' | 'intensity' | 'bitter' | 'abv';

/** Каталог сортов: фильтры + сетка карточек или «карта вкусов» (горечь × тело). */
@Component({
  selector: 'ft-beers',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, BeerCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex jb as g12 wrap">
      <div>
        <span class="eyebrow">Портфель Efes Kazakhstan</span>
        <h1>{{ data.stats().brands }} сортов · <span class="grad-text">вкусовая пирамида</span></h1>
        <p class="dim mt8">Ноты, интенсивность, подача — и к чему подать. Профили сортов с неполной пирамидой помечены как черновик.</p>
      </div>
      <div class="seg view">
        <button type="button" [class.on]="view() === 'grid'" (click)="view.set('grid')"><ft-icon name="beer" [size]="16" /> Карточки</button>
        <button type="button" [class.on]="view() === 'map'" (click)="view.set('map')"><ft-icon name="compass" [size]="16" /> Карта вкусов</button>
      </div>
    </div>

    <div class="filters card mt16">
      <div class="search"><ft-icon name="search" /><input class="input" type="search" placeholder="Название или стиль…" [ngModel]="q()" (ngModelChange)="q.set($event)" aria-label="Поиск сорта" /></div>
      <div class="scroll-x fr">
        <button type="button" class="chip chip-sm" [class.on]="pack() === ''" (click)="pack.set('')">Все ({{ data.stats().brands }})</button>
        <button type="button" class="chip chip-sm" [class.on]="pack() === 'BOTTLE'" (click)="pack.set('BOTTLE')">Бутылка</button>
        <button type="button" class="chip chip-sm" [class.on]="pack() === 'CAN'" (click)="pack.set('CAN')">Банка</button>
        <button type="button" class="chip chip-sm" [class.on]="pack() === 'DRAFT'" (click)="pack.set('DRAFT')">Разливное · HoReCa</button>
        <span class="sep"></span>
        @for (f of families(); track f.id) { <button type="button" class="chip chip-sm" [class.on]="family() === f.id" (click)="family.set(family() === f.id ? '' : f.id)">{{ f.label }}</button> }
      </div>
      <div class="flex ac g8 fr2">
        <span class="muted xs">Сортировка</span>
        <select class="input sel" [ngModel]="sort()" (ngModelChange)="sort.set($event)" aria-label="Сортировка">
          <option value="name">По названию</option><option value="intensity">По интенсивности</option><option value="bitter">По горечи</option><option value="abv">По крепости</option>
        </select>
        <span class="muted xs" style="margin-left:auto">{{ list().length }} из {{ data.stats().brands }}</span>
      </div>
    </div>

    @if (view() === 'grid') {
      <div class="grid grid-4 mt16">
        @for (b of list(); track b.id) { <ft-beer-card [brand]="b" /> }
        @empty { <div class="card card-p center dim" style="grid-column:1/-1">Ничего не найдено</div> }
      </div>
    } @else {
      <div class="card card-p mt16 map-wrap">
        <p class="dim sm mb12">Каждый сорт — точка на карте «горечь × тело». Размер — крепость. Наведите, чтобы увидеть название.</p>
        <svg viewBox="0 0 600 420" class="map" role="img" aria-label="Карта вкусов">
          <defs><linearGradient id="mg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="rgba(245,185,66,.06)"/><stop offset="1" stop-color="rgba(194,98,26,.18)"/></linearGradient></defs>
          <rect x="50" y="20" width="520" height="340" rx="14" fill="url(#mg)" stroke="var(--line)"/>
          @for (g of [0.25,0.5,0.75]; track g) { <line [attr.x1]="50 + 520*g" y1="20" [attr.x2]="50 + 520*g" y2="360" class="gl"/><line x1="50" [attr.y1]="360 - 340*g" x2="570" [attr.y2]="360 - 340*g" class="gl"/> }
          <text x="310" y="395" text-anchor="middle" class="axl">Горечь →</text>
          <text x="22" y="190" text-anchor="middle" class="axl" transform="rotate(-90 22 190)">Тело →</text>
          <text x="60" y="40" class="quad">лёгкие · мягкие</text><text x="560" y="40" text-anchor="end" class="quad">лёгкие · хмелевые</text>
          <text x="60" y="352" class="quad">плотные · мягкие</text><text x="560" y="352" text-anchor="end" class="quad">плотные · хмелевые</text>
          @for (p of points(); track p.b.id) {
            <a [attr.href]="'/beers/' + p.b.id" class="pt" [routerLink]="['/beers', p.b.id]">
              <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="p.r" [attr.fill]="p.b.accent || '#E5B849'" fill-opacity=".85" stroke="#fff" stroke-width="2"/>
              <text [attr.x]="p.x" [attr.y]="p.y - p.r - 5" text-anchor="middle" class="pl">{{ p.b.display_name }}</text>
            </a>
          }
        </svg>
      </div>
    }
    <p class="muted xs mt16">* ABV оценочный — уточняется у сомелье Efes при дегустации.</p>
  `,
  styles: [`
    .seg { display: inline-grid; grid-auto-flow: column; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--bg-2); }
    .seg button { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 10px; font-weight: 700; font-size: .86rem; color: var(--ink-2); }
    .seg button.on { background: var(--surface); color: var(--amber-800); box-shadow: var(--shadow-1); }
    .filters { padding: 12px; display: grid; gap: 10px; }
    .fr { margin: 0; padding: 0; gap: 6px; align-items: center; }
    .sep { width: 1px; height: 24px; background: var(--line); margin: 0 4px; flex-shrink: 0; }
    .sel { max-width: 220px; min-height: 38px; font-size: .86rem; }
    .map { width: 100%; height: auto; }
    .gl { stroke: var(--line-2); }
    .axl { font-family: var(--font-display); font-weight: 700; font-size: 12px; fill: var(--ink-3); }
    .quad { font-size: 10px; fill: var(--ink-4); font-weight: 600; }
    .pt text { font-size: 10px; font-weight: 700; fill: var(--ink-2); opacity: 0; transition: opacity .2s; }
    .pt:hover text, .pt:focus text { opacity: 1; }
    .pt circle { transition: r .2s; cursor: pointer; }
    .pt:hover circle { stroke: var(--ink); }
    @media (min-width: 720px) { .pt text { opacity: .85; } }
  `],
})
export class BeersPage {
  data = inject(DataService);
  q = signal(''); pack = signal<Packaging | ''>(''); family = signal(''); sort = signal<Sort>('name'); view = signal<'grid' | 'map'>('grid');
  families = computed(() => { const seen = new Map<string, string>(); for (const b of this.data.brands()) seen.set(b.style_family, b.style_label); return [...seen].map(([id, label]) => ({ id, label })); });
  list = computed<Brand[]>(() => {
    const q = this.q().trim().toLowerCase(); const prof = this.data.beerProfileById();
    let l = this.data.brands().filter(b => (!q || b.display_name.toLowerCase().includes(q) || b.style.toLowerCase().includes(q) || b.style_label.toLowerCase().includes(q) || b.brand_owner.toLowerCase().includes(q))
      && (!this.pack() || b.packaging_type === this.pack()) && (!this.family() || b.style_family === this.family()));
    const s = this.sort();
    l = [...l].sort((a, b) => s === 'name' ? a.display_name.localeCompare(b.display_name) : s === 'abv' ? b.abv - a.abv : s === 'bitter' ? prof[b.id].vector.bitter - prof[a.id].vector.bitter : prof[b.id].intensity - prof[a.id].intensity);
    return l;
  });
  points = computed(() => this.list().map(b => { const p = this.data.beerProfileById()[b.id]; return { b, x: 50 + 520 * p.vector.bitter, y: 360 - 340 * p.vector.body, r: 8 + (b.abv - 3.5) * 3 }; }));
}
