import { Component, EventEmitter, OnInit, Output, effect, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catalogModeFromUrl, syncCatalogMode } from '../drinks-v2/v2-url';
import { ApiService } from '../../services/api.service';
import { Brand } from '../../models/flavor-tree.models';
import { SelectionService } from '../../services/selection.service';
import { PageStateService } from '../../services/page-state.service';
import { PreferencesService, matchLabel } from '../../services/preferences.service';
import { TasteQuizComponent } from '../../ui/taste-quiz.component';
import { countOf } from '../venue-menu/plural';
import { DrinksCatalogComponent } from '../drinks-v2/drinks-catalog.component';
import { V2ApiService } from '../drinks-v2/v2-api.service';
import { ABV_ESTIMATE_HINT, abvText } from '../../models/abv';

@Component({
  selector: 'app-brand-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule, DrinksCatalogComponent, TasteQuizComponent],
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
      <div style="position: relative; min-width: min(280px, 100%); max-width: 380px; width: 100%;">
        <input
          type="text"
          class="input"
          [ngModel]="searchQuery()"
          (ngModelChange)="searchQuery.set($event)"
          placeholder="Поиск по названию или стилю..."
          aria-label="Поиск по названию или стилю"
          style="width: 100%; padding-right: 44px;"
        />
        @if (searchQuery()) {
          <button
            type="button"
            (click)="searchQuery.set('')"
            style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 16px;"
            title="Очистить"
            aria-label="Очистить поиск"
          >✕</button>
        }
      </div>
    </div>

    <!-- Вкус гостя: опрос на минуту, после него у каждого сорта видно совпадение -->
    <div class="be-taste" [class.be-taste-done]="prefs.hasTaste()">
      <div>
        <b>{{ prefs.hasTaste() ? 'Сорта отсортированы по вашему вкусу' : 'Какой сорт ваш? Узнайте за минуту' }}</b>
        <span>{{ prefs.hasTaste() ? 'У каждого сорта показано, насколько он совпадает с вашим профилем.' : 'Шесть вопросов о привычках, без регистрации. Покажем, какие сорта вам ближе.' }}</span>
      </div>
      <button type="button" [class]="prefs.hasTaste() ? 'btn-outline' : 'btn-amber'" (click)="quiz.open()">
        {{ prefs.hasTaste() ? 'Пройти заново' : 'Узнать свой вкус' }}
      </button>
    </div>

    <!-- Панель фильтров -->
    <div class="glass-panel flex items-center gap-md flex-wrap mb-3xl be-filters">
      <span class="text-muted font-semibold text-sm">Упаковка:</span>
      <button class="btn-outline" [class.active]="selectedPackaging() === ''" (click)="selectedPackaging.set('')">Все{{ loaded() ? ' (' + brands().length + ')' : '' }}</button>
      <button class="btn-outline" [class.active]="selectedPackaging() === 'BOTTLE'" (click)="selectedPackaging.set('BOTTLE')">Бутылка</button>
      <button class="btn-outline" [class.active]="selectedPackaging() === 'CAN'" (click)="selectedPackaging.set('CAN')">Банка</button>
      <button class="btn-outline" [class.active]="selectedPackaging() === 'DRAFT'" (click)="selectedPackaging.set('DRAFT')">Разливное</button>

      <button
        class="btn-outline"
        [class.active]="onlyHoreca()"
        (click)="onlyHoreca.set(!onlyHoreca())"
        style="margin-left: auto;"
      >
        <span [style.color]="onlyHoreca() ? 'var(--beer-accent)' : 'inherit'">★</span>
        Только HoReCa
      </button>
    </div>

    <!-- Результаты поиска / счетчик -->
    @if (loaded() && hasFilter()) {
      <div class="flex justify-between items-center mb-xl text-sm text-muted">
        <span>Найдено сортов: <strong style="color: var(--foam);">{{ filteredBrands().length }}</strong> из {{ brands().length }}</span>
        <button class="btn-outline btn-sm" (click)="resetFilters()">Сбросить фильтры</button>
      </div>
    }

    <!-- Сетка сортов -->
    @if (failed()) {
      <div class="glass-panel text-center p-4xl" role="alert">
        <p class="text-muted mb-lg">Не удалось загрузить каталог. Проверьте интернет и попробуйте ещё раз.</p>
        <button type="button" class="btn-amber btn-sm" (click)="load()">Обновить</button>
      </div>
    } @else if (!loaded()) {
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
      @for (brand of filteredBrands(); track brand.id) {
        <div class="glass-card beer-card p-xl stagger-item" (click)="openBrandDetail(brand)">
          <!-- Фото -->
          <div class="beer-card-image">
            @if (brand.is_horeca_only) {
              <span class="badge badge-horeca beer-card-image-badge">HoReCa</span>
            } @else {
              <span class="badge badge-dark beer-card-image-badge">{{ brand.packaging_type_display || brand.packaging_type }}</span>
            }
            @if (brand.image) {
              <img [src]="brand.image" [alt]="brand.name" loading="lazy" decoding="async" />
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
                  <span class="beer-card-abv" [attr.title]="brand.abv_estimated ? abvHint : 'Крепость'">{{ abv }}</span>
                }
              </div>
              <h3 class="beer-card-name">{{ brand.name }}</h3>
              @if (brand.brand_owner) {
                <p class="beer-card-owner">{{ brand.brand_owner }}</p>
              }
              <p class="beer-card-desc">{{ brand.description }}</p>
            </div>

            <div class="beer-card-footer">
              @if (percent(brand); as pct) {
                <div class="be-match mb-md" role="img" [attr.aria-label]="'Совпадение с вашим вкусом ' + pct + ' процентов: ' + matchLabel(pct)">
                  <span class="be-match-bar"><span [style.width.%]="pct"></span></span>
                  <span class="be-match-text"><b>{{ pct }}%</b> {{ matchLabel(pct) }}</span>
                </div>
              } @else if (brand.note_count) {
                <!-- Внутренний статус пирамиды (черновик или заполнена) гостю не показываем, только число нот -->
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
          @if (hasFilter()) {
            <p class="text-muted mb-lg" style="font-size: 1.1rem;">По вашему запросу ничего не найдено.</p>
            <button class="btn-outline" (click)="resetFilters()">Сбросить фильтры</button>
          } @else {
            <p class="text-muted" style="font-size: 1.1rem;">Каталог пока пуст.</p>
          }
        </div>
      }
    </div>
    }
    }

    <app-taste-quiz #quiz (openBrand)="openById($event)" />
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
    .be-filters { padding: 16px 24px; }
    .be-taste { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md) var(--space-xl); margin-bottom: var(--space-xl); padding: var(--space-lg) var(--space-xl); border: 1px solid rgba(217, 119, 6, 0.3); border-radius: var(--radius-xl); background: linear-gradient(135deg, #FFF7EA, #fff); }
    .be-taste > div { flex: 1 1 260px; display: grid; gap: 2px; }
    .be-taste b { font-family: var(--font-heading); font-size: 1.05rem; color: var(--foam); }
    .be-taste span { font-size: 0.875rem; line-height: 1.5; color: var(--foam-dim); }
    .be-taste-done { border-color: var(--line); background: var(--bg-1); }
    .be-taste .btn-amber, .be-taste .btn-outline { min-height: 44px; }
    .be-match { display: grid; gap: 6px; }
    .be-match-bar { height: 6px; border-radius: var(--radius-full); background: rgba(180, 83, 9, 0.12); overflow: hidden; }
    .be-match-bar span { display: block; height: 100%; border-radius: inherit; background: var(--beer-light); }
    .be-match-text { font-size: 0.8125rem; color: var(--muted); }
    .be-match-text b { font-size: 0.9375rem; color: var(--beer-deep); font-variant-numeric: tabular-nums; }
    /* Телефон: фильтры плотнее, чтобы уместиться в две строки */
    @media (max-width: 640px) {
      .be-filters { padding: 12px; gap: var(--space-sm); }
      .be-filters .btn-outline { padding: 8px 14px; font-size: 0.84rem; }
    }
  `]
})
export class BrandExplorerComponent implements OnInit {
  private api = inject(ApiService);
  private v2 = inject(V2ApiService);
  private selection = inject(SelectionService);
  private state = inject(PageStateService);
  readonly prefs = inject(PreferencesService);
  readonly matchLabel = matchLabel;

  /** Просит показать страницу сорта - маршрут выбирает AppComponent. */
  @Output() openBrand = new EventEmitter<string>();

  brands = signal<Brand[]>([]);
  /** Пока false - скелет; "ничего не найдено" показываем только после загрузки. */
  loaded = signal(false);
  /** Каталог не загрузился: вместо "ничего не найдено" ошибка с кнопкой "Обновить". */
  failed = signal(false);

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

  // Поиск и фильтры лежат в PageStateService: гость открыл сорт, вернулся и видит тот же список
  readonly searchQuery = this.state.catalogQuery;
  readonly selectedPackaging = this.state.catalogPackaging;
  readonly onlyHoreca = this.state.catalogHoreca;
  readonly hasFilter = computed(() => !!this.searchQuery() || !!this.selectedPackaging() || this.onlyHoreca());

  filteredBrands = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const pack = this.selectedPackaging();
    const horeca = this.onlyHoreca();

    const list = this.brands().filter(b => {
      const matchSearch = !q ||
        b.name.toLowerCase().includes(q) ||
        (b.style && b.style.toLowerCase().includes(q)) ||
        (b.brand_owner && b.brand_owner.toLowerCase().includes(q));
      const matchPack = !pack || b.packaging_type === pack;
      const matchHoreca = !horeca || b.is_horeca_only;
      return matchSearch && matchPack && matchHoreca;
    });
    // Вкус известен: ближе всего к нему идут первыми. Порядок каталога сохраняется при равенстве.
    if (!this.prefs.hasTaste()) return list;
    return [...list].sort((a, b) => (this.prefs.percentFor(b) ?? 0) - (this.prefs.percentFor(a) ?? 0));
  });

  /** Совпадение сорта с вкусом гостя; null, пока вкус не известен. */
  percent(brand: Brand): number | null {
    return this.prefs.percentFor(brand);
  }

  openById(id: string) {
    this.selection.open(id);
    this.openBrand.emit(id);
  }

  ngOnInit() {
    this.v2.meta().subscribe({ next: m => this.drinksTotal.set(m.drinks || null), error: () => {} });
    this.load();
  }

  load() {
    this.loaded.set(false);
    this.failed.set(false);
    this.api.getBrands().subscribe({
      // Снятые с публикации сорта в каталог не попадают
      next: data => { this.brands.set(data.filter(b => b.is_active !== false)); this.loaded.set(true); },
      error: () => this.failed.set(true),
    });
  }

  resetFilters() {
    this.state.resetCatalog();
  }

  openBrandById(id: string) {
    const brand = this.brands().find(b => b.id === id);
    if (brand) this.openBrandDetail(brand);
  }

  /** Каталог и подбор ведут на одну и ту же страницу сорта. */
  openBrandDetail(brand: Brand) {
    this.selection.open(brand.id);
    this.openBrand.emit(brand.id);
  }
}
