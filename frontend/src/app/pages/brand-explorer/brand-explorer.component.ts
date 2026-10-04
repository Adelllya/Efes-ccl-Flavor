import { Component, EventEmitter, OnInit, Output, effect, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catalogModeFromUrl, noteOpenFromCatalog, syncCatalogMode } from '../drinks-v2/v2-url';
import { ApiService } from '../../services/api.service';
import { Brand } from '../../models/flavor-tree.models';
import { SelectionService } from '../../services/selection.service';
import { countOf } from '../venue-menu/plural';
import { DrinksCatalogComponent } from '../drinks-v2/drinks-catalog.component';
import { TapHintDirective } from '../drinks-v2/v2-ui';
import { V2ApiService } from '../drinks-v2/v2-api.service';
import { ABV_ESTIMATE_HINT, abvText } from '../../models/abv';
import { matchesSearch } from '../../services/search-text';

/**
 * Список сортов с прошлого показа каталога. Вернувшись сюда («Все сорта» или «Назад» браузера), рисуем его
 * сразу: со скелетом страница короче, и браузер восстановил бы прокрутку только до её низа. Свежий список
 * всё равно запрашиваем и подменяем.
 */
let lastBrands: Brand[] | null = null;

@Component({
  selector: 'app-brand-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule, DrinksCatalogComponent, TapHintDirective],
  template: `
    <!-- Сорта Efes с пирамидой или все напитки движка подбора -->
    <div class="flex gap-md flex-wrap mb-2xl">
      <button class="btn-outline" [class.active]="mode() === 'efes'" (click)="mode.set('efes')">
        Сорта Efes{{ loaded() ? ' (' + brands().length + ')' : '' }}
      </button>
      <button class="btn-outline" [class.active]="mode() === 'all'" (click)="mode.set('all')">
        Все напитки{{ drinksTotal() ? ' (' + drinksTotal() + ')' : '' }}
      </button>
    </div>

    @if (mode() === 'all') {
      <div class="mb-3xl">
        <h1 class="section-header">Все напитки</h1>
        <p class="text-muted">Пиво, вино, крепкое, коктейли и безалкогольное: всё, с чем работает подбор к блюдам</p>
      </div>
      <app-drinks-catalog (openBrand)="openBrandById($event)" />
    } @else {
    <div class="flex justify-between items-start mb-3xl flex-wrap gap-lg">
      <div>
        <h1 class="section-header">Каталог {{ loaded() ? countOf(brands().length, 'сорта', 'сортов', 'сортов') : 'сортов' }} и вкусовая пирамида</h1>
        <p class="text-muted">Исследуйте сенсорные профили, температуру подачи, бокалы и подходящие блюда</p>
      </div>
      <div class="be-search">
        <input
          type="text"
          class="input"
          [ngModel]="searchQuery()"
          (ngModelChange)="searchQuery.set($event)"
          placeholder="Поиск по названию или стилю..."
        />
        @if (searchQuery()) {
          <button class="be-clear" (click)="searchQuery.set('')" title="Очистить" aria-label="Очистить поиск">✕</button>
        }
      </div>
    </div>

    <!-- Панель фильтров -->
    <div class="glass-panel be-filters flex items-center gap-md flex-wrap mb-3xl">
      <span class="text-muted font-semibold text-sm">Упаковка:</span>
      <button class="btn-outline" [class.active]="selectedPackaging() === ''" (click)="selectedPackaging.set('')">Все{{ loaded() ? ' (' + brands().length + ')' : '' }}</button>
      <button class="btn-outline" [class.active]="selectedPackaging() === 'BOTTLE'" (click)="selectedPackaging.set('BOTTLE')">Бутылка</button>
      <button class="btn-outline" [class.active]="selectedPackaging() === 'CAN'" (click)="selectedPackaging.set('CAN')">Банка</button>
      <button class="btn-outline" [class.active]="selectedPackaging() === 'DRAFT'" (click)="selectedPackaging.set('DRAFT')">Разливное</button>

      <button
        class="btn-outline be-horeca"
        [class.active]="onlyHoreca()"
        (click)="onlyHoreca.set(!onlyHoreca())"
      >
        <span [style.color]="onlyHoreca() ? 'var(--beer-accent)' : 'inherit'">★</span>
        Только HoReCa
      </button>
    </div>

    <!-- Результаты поиска / счетчик -->
    @if (searchQuery() || selectedPackaging() || onlyHoreca()) {
      <div class="flex justify-between items-center mb-xl text-sm text-muted">
        <span>Найдено сортов: <strong style="color: var(--foam);">{{ filteredBrands().length }}</strong> из {{ brands().length }}</span>
        <button class="btn-outline btn-sm be-reset" (click)="resetFilters()">Сбросить фильтры</button>
      </div>
    }

    <!-- Сетка сортов -->
    @if (!loaded()) {
      <div class="skeleton-grid" aria-busy="true" aria-label="Загружаем сорта">
        @for (i of skeletonCards; track i) {
          <div class="skeleton-card">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
          </div>
        }
      </div>
    } @else {
    <div class="grid grid-cards">
      @for (brand of filteredBrands(); track brand.id; let i = $index) {
        <div class="glass-card beer-card p-xl stagger-item" (click)="openBrandDetail(brand)">
          <!-- Фото -->
          <div class="beer-card-image">
            @if (brand.is_horeca_only) {
              <span class="badge badge-horeca beer-card-image-badge">HoReCa</span>
            } @else {
              <span class="badge badge-dark beer-card-image-badge">{{ brand.packaging_type_display || brand.packaging_type }}</span>
            }
            @if (brand.image) {
              <!-- Первый ряд виден сразу (первое фото и есть самый крупный элемент экрана): грузим без lazy -->
              <img [attr.loading]="i < eagerImages ? 'eager' : 'lazy'" [attr.fetchpriority]="i === 0 ? 'high' : null"
                   [src]="brand.image" [alt]="brand.name" decoding="async" />
            } @else {
              <div class="beer-card-placeholder">
                <span>🍺</span>
                <span class="text-xs text-muted font-bold uppercase" style="margin-top: 4px;">Flavor Tree</span>
              </div>
            }
          </div>

          <!-- Детали -->
          <div class="beer-card-body">
            <div>
              <div class="beer-card-meta">
                <span class="badge">{{ brand.style }}</span>
                <!-- Крепости нет: бейдж не показываем. Оценку по стилю подписываем «около». -->
                @if (abvText(brand.abv, brand.abv_estimated); as abv) {
                  <span class="beer-card-abv" [attr.title]="brand.abv_estimated ? abvHint : 'Крепость'"
                        [ftHint]="brand.abv_estimated ? abvHint : null" ftHintAfter>{{ abv }}</span>
                }
              </div>
              <h3 class="beer-card-name">{{ brand.name }}</h3>
              @if (brand.brand_owner) {
                <p class="beer-card-owner">{{ brand.brand_owner }}</p>
              }
              <p class="beer-card-desc">{{ brand.description }}</p>
            </div>

            <div class="beer-card-footer">
              <!-- Внутренний статус пирамиды (черновик или заполнена) гостю не показываем, только число нот -->
              @if (brand.note_count) {
                <div class="flex justify-between items-center text-sm mb-md">
                  <span class="text-muted">Вкусовая пирамида:</span>
                  <span class="font-semibold text-deep">{{ countOf(brand.note_count, 'нота', 'ноты', 'нот') }}</span>
                </div>
              }
              <button class="btn-amber btn-block btn-sm" (click)="$event.stopPropagation(); openBrandDetail(brand)">
                Пирамида и подача
              </button>
            </div>
          </div>
        </div>
      } @empty {
        <div class="glass-panel text-center p-4xl" style="grid-column: 1 / -1;">
          <p class="text-muted mb-lg" style="font-size: 1.1rem;">По вашему запросу ничего не найдено.</p>
          <button class="btn-outline" (click)="resetFilters()">Сбросить фильтры</button>
        </div>
      }
    </div>
    }
    }
  `,
  styles: [`
    .beer-card-image-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 2;
      font-size: 0.7rem;
      padding: 2px 8px;
    }
    .be-search { position: relative; min-width: 280px; max-width: 380px; width: 100%; }
    .be-search .input { width: 100%; padding-right: 36px; }
    .be-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none;
      border: none; color: var(--muted); cursor: pointer; font-size: 16px; padding: 4px; }
    .be-filters { padding: 16px 24px; }
    .be-horeca { margin-left: auto; }

    /* Телефон и планшет: кнопки под палец, подписи не мельче 12px, поле без зума iOS */
    @media (max-width: 768px), (pointer: coarse) {
      .beer-card-image-badge { font-size: 0.75rem; }
      .beer-card-footer .btn-sm { min-height: 44px; }
      .be-reset { min-height: 40px; }
      .be-search .input { font-size: 16px; padding-right: 44px; }
      .be-clear { right: 2px; width: 40px; height: 40px; padding: 0; }
    }

    @media (max-width: 640px) {
      /* Фильтры одной строкой с прокруткой, как категории во «Всех напитках»: иначе они занимают весь первый экран */
      .be-filters { flex-wrap: nowrap; overflow-x: auto; padding: 12px 14px; scrollbar-width: none; }
      .be-filters::-webkit-scrollbar { display: none; }
      .be-filters > * { flex-shrink: 0; white-space: nowrap; }
    }
  `]
})
export class BrandExplorerComponent implements OnInit {
  private api = inject(ApiService);
  private v2 = inject(V2ApiService);
  private selection = inject(SelectionService);

  /** Просит показать страницу сорта - маршрут выбирает AppComponent. */
  @Output() openBrand = new EventEmitter<string>();

  brands = signal<Brand[]>(lastBrands ?? []);
  /** Пока false - скелет; "ничего не найдено" показываем только после загрузки. */
  loaded = signal(lastBrands !== null);
  searchQuery = signal<string>('');

  readonly countOf = countOf;
  readonly abvText = abvText;
  readonly abvHint = ABV_ESTIMATE_HINT;
  /** Сколько напитков в каталоге движка: число берём из /api/v2/meta/, а не пишем текстом. */
  drinksTotal = signal<number | null>(null);
  /** efes - 17 сортов с пирамидой, all - все напитки движка подбора. */
  mode = signal<'efes' | 'all'>(catalogModeFromUrl());
  /** Режим живёт в адресе (?view=all): переживает перезагрузку и возврат со страницы сорта. */
  private readonly modeInUrl = effect(() => syncCatalogMode(this.mode()));
  readonly skeletonCards = [1, 2, 3, 4, 5, 6];
  /** Сколько первых фото грузить сразу: первый ряд сетки на широком экране. */
  readonly eagerImages = 3;
  selectedPackaging = signal<string>('');
  onlyHoreca = signal<boolean>(false);

  filteredBrands = computed(() => {
    const q = this.searchQuery();
    const pack = this.selectedPackaging();
    const horeca = this.onlyHoreca();

    return this.brands().filter(b => {
      // «эфес», «козел», «бавария» находят Efes, Kozel, Bavaria: кириллица и латиница сравниваются по одному ключу
      const matchSearch = matchesSearch(q, b.name, b.style, b.brand_owner);
      const matchPack = !pack || b.packaging_type === pack;
      const matchHoreca = !horeca || b.is_horeca_only;
      return matchSearch && matchPack && matchHoreca;
    });
  });

  ngOnInit() {
    // Каталог снова на экране: переход, который до страницы сорта не дошёл («Назад», пока грузился её чанк), не в счёт
    noteOpenFromCatalog(null);
    this.v2.meta().subscribe({ next: m => this.drinksTotal.set(m.drinks || null), error: () => {} });
    this.api.getBrands().subscribe({
      // Снятые с публикации сорта в каталог не попадают
      next: data => {
        lastBrands = data.filter(b => b.is_active !== false);
        this.brands.set(lastBrands);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  resetFilters() {
    this.searchQuery.set('');
    this.selectedPackaging.set('');
    this.onlyHoreca.set(false);
  }

  openBrandById(id: string) {
    const brand = this.brands().find(b => b.id === id);
    if (brand) this.openBrandDetail(brand);
  }

  /** Каталог и подбор ведут на одну и ту же страницу сорта. */
  openBrandDetail(brand: Brand) {
    // «Все сорта» на странице сорта тогда вернётся сюда шагом назад, с той же прокруткой
    noteOpenFromCatalog(brand.id);
    this.selection.open(brand.id);
    this.openBrand.emit(brand.id);
  }
}
