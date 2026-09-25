import { Component, EventEmitter, OnInit, Output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { Brand } from '../../models/flavor-tree.models';
import { SelectionService } from '../../services/selection.service';
import { countOf } from '../venue-menu/plural';

@Component({
  selector: 'app-brand-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex justify-between items-start mb-3xl flex-wrap gap-lg">
      <div>
        <h1 class="section-header">Каталог {{ loaded() ? countOf(brands().length, 'сорта', 'сортов', 'сортов') : 'сортов' }} & Вкусовая пирамида</h1>
        <p class="text-muted">Исследуйте сенсорные профили, температуру подачи, бокалы и подходящие блюда</p>
      </div>
      <div style="position: relative; min-width: 280px; max-width: 380px; width: 100%;">
        <input
          type="text"
          class="input"
          [ngModel]="searchQuery()"
          (ngModelChange)="searchQuery.set($event)"
          placeholder="Поиск по названию или стилю..."
          style="width: 100%; padding-right: 36px;"
        />
        @if (searchQuery()) {
          <button
            (click)="searchQuery.set('')"
            style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--muted); cursor: pointer; font-size: 16px; padding: 4px;"
            title="Очистить"
          >✕</button>
        }
      </div>
    </div>

    <!-- Панель фильтров -->
    <div class="glass-panel flex items-center gap-md flex-wrap mb-3xl" style="padding: 16px 24px;">
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
    @if (searchQuery() || selectedPackaging() || onlyHoreca()) {
      <div class="flex justify-between items-center mb-xl text-sm text-muted">
        <span>Найдено сортов: <strong style="color: var(--foam);">{{ filteredBrands().length }}</strong> из {{ brands().length }}</span>
        <button class="btn-outline btn-sm" (click)="resetFilters()">Сбросить фильтры</button>
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
              <img [src]="brand.image" [alt]="brand.name" />
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
                <span class="beer-card-abv">
                  {{ brand.abv !== null && brand.abv !== undefined ? brand.abv + '% ABV' : 'N/A' }}
                </span>
              </div>
              <h3 class="beer-card-name">{{ brand.name }}</h3>
              @if (brand.brand_owner) {
                <p class="beer-card-owner">{{ brand.brand_owner }}</p>
              }
              <p class="beer-card-desc">{{ brand.description }}</p>
            </div>

            <div class="beer-card-footer">
              <div class="flex justify-between items-center text-sm mb-md">
                <span class="text-muted">Пирамида:</span>
                @if (brand.profile?.complete) {
                  <span class="font-bold" style="color: var(--success);">Заполнен</span>
                } @else {
                  <span class="font-semibold text-deep">Черновик</span>
                }
              </div>
              <button class="btn-amber btn-block btn-sm" (click)="$event.stopPropagation(); openBrandDetail(brand)">
                Пирамида & Подача
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
  `]
})
export class BrandExplorerComponent implements OnInit {
  private api = inject(ApiService);
  private selection = inject(SelectionService);

  /** Просит показать страницу сорта - маршрут выбирает AppComponent. */
  @Output() openBrand = new EventEmitter<string>();

  brands = signal<Brand[]>([]);
  /** Пока false - скелет; "ничего не найдено" показываем только после загрузки. */
  loaded = signal(false);
  searchQuery = signal<string>('');

  readonly countOf = countOf;
  readonly skeletonCards = [1, 2, 3, 4, 5, 6];
  selectedPackaging = signal<string>('');
  onlyHoreca = signal<boolean>(false);

  filteredBrands = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const pack = this.selectedPackaging();
    const horeca = this.onlyHoreca();

    return this.brands().filter(b => {
      const matchSearch = !q ||
        b.name.toLowerCase().includes(q) ||
        (b.style && b.style.toLowerCase().includes(q)) ||
        (b.brand_owner && b.brand_owner.toLowerCase().includes(q));
      const matchPack = !pack || b.packaging_type === pack;
      const matchHoreca = !horeca || b.is_horeca_only;
      return matchSearch && matchPack && matchHoreca;
    });
  });

  ngOnInit() {
    this.api.getBrands().subscribe({
      // Снятые с публикации сорта в каталог не попадают
      next: data => { this.brands.set(data.filter(b => b.is_active !== false)); this.loaded.set(true); },
      error: () => this.loaded.set(true),
    });
  }

  resetFilters() {
    this.searchQuery.set('');
    this.selectedPackaging.set('');
    this.onlyHoreca.set(false);
  }

  /** Каталог и подбор ведут на одну и ту же страницу сорта. */
  openBrandDetail(brand: Brand) {
    this.selection.open(brand.id);
    this.openBrand.emit(brand.id);
  }
}
