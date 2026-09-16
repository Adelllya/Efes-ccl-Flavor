import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { Brand } from '../../models/flavor-tree.models';

@Component({
  selector: 'app-brand-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex justify-between items-start mb-3xl flex-wrap gap-lg">
      <div>
        <h1 class="section-header">Каталог 17 сортов & Вкусовая пирамида</h1>
        <p class="text-muted">Исследуйте сенсорные профили, температуру подачи, бокалы и гастрономические характеристики</p>
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
      <button class="btn-outline" [class.active]="selectedPackaging() === ''" (click)="selectedPackaging.set('')">Все ({{ brands().length }})</button>
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

    <!-- МОДАЛЬНОЕ ОКНО: ВКУСОВАЯ ПИРАМИДА БРЕНДА -->
    @if (selectedBrand(); as brand) {
      <div class="modal-overlay" (click)="selectedBrand.set(null)">
        <div class="modal-content glass-card" (click)="$event.stopPropagation()">
          <button class="btn-outline modal-close" (click)="selectedBrand.set(null)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            Закрыть
          </button>

          <div class="flex gap-2xl items-center mb-3xl flex-wrap">
            @if (brand.image) {
              <div style="height: 160px; width: 120px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.03); border: 1px solid var(--line); border-radius: var(--radius-xl); padding: 10px; flex-shrink: 0;">
                <img [src]="brand.image" [alt]="brand.name" style="max-height: 100%; max-width: 100%; object-fit: contain; filter: drop-shadow(0 6px 16px rgba(0,0,0,0.2));" />
              </div>
            }
            <div>
              <span class="badge mb-sm">{{ brand.style }} · ABV {{ brand.abv !== null && brand.abv !== undefined ? brand.abv + '%' : 'N/A' }}</span>
              <h2 style="font-size: 1.8rem; margin: 0;">{{ brand.name }} — Сенсорная Пирамида</h2>
              @if (brand.brand_owner) {
                <p class="text-muted text-sm uppercase" style="margin-top: 4px;">{{ brand.brand_owner }}</p>
              }
            </div>
          </div>

          @if (brand.pyramid) {
            <!-- TOP NOTES -->
            @if (brand.pyramid.top && brand.pyramid.top.length > 0) {
              <div class="glass-panel pyramid-layer">
                <h3 class="pyramid-layer-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline; vertical-align: -2px;"><path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 17 3.5s1 2 1 6c0 3.3-2.7 6-6 6"/></svg>
                  Top Notes (Ароматическая вершина · 0–3 секунды)
                </h3>
                @for (item of brand.pyramid.top; track item.id) {
                  <div class="pyramid-note">
                    <div class="pyramid-note-header">
                      <span>{{ item.icon }} {{ item.name }}</span>
                      <span>Интенсивность: {{ item.intensity }}/10</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" [style.width.%]="item.intensity * 10"></div>
                    </div>
                    @if (item.sommelier_note) {
                      <p class="pyramid-note-comment">«{{ item.sommelier_note }}»</p>
                    }
                  </div>
                }
              </div>
            }

            <!-- HEART NOTES -->
            @if (brand.pyramid.heart && brand.pyramid.heart.length > 0) {
              <div class="glass-panel pyramid-layer">
                <h3 class="pyramid-layer-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline; vertical-align: -2px;"><path d="M2 22 16 8"/><path d="M7 12 5 11l1.5 1.5a3.5 3.5 0 0 1 0 5L5 19l-1.5-1.5a3.5 3.5 0 0 1 0-5Z"/></svg>
                  Heart Notes (Солодовое сердце · 3–15 секунд)
                </h3>
                @for (item of brand.pyramid.heart; track item.id) {
                  <div class="pyramid-note">
                    <div class="pyramid-note-header">
                      <span>{{ item.icon }} {{ item.name }}</span>
                      <span>Интенсивность: {{ item.intensity }}/10</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" [style.width.%]="item.intensity * 10"></div>
                    </div>
                    @if (item.sommelier_note) {
                      <p class="pyramid-note-comment">«{{ item.sommelier_note }}»</p>
                    }
                  </div>
                }
              </div>
            }

            <!-- BASE NOTES -->
            @if (brand.pyramid.base && brand.pyramid.base.length > 0) {
              <div class="glass-panel pyramid-layer mb-2xl">
                <h3 class="pyramid-layer-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline; vertical-align: -2px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  Base Notes (Послевкусие и горечь · 15+ секунд)
                </h3>
                @for (item of brand.pyramid.base; track item.id) {
                  <div class="pyramid-note">
                    <div class="pyramid-note-header">
                      <span>{{ item.icon }} {{ item.name }}</span>
                      <span>Интенсивность: {{ item.intensity }}/10</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" [style.width.%]="item.intensity * 10"></div>
                    </div>
                    @if (item.sommelier_note) {
                      <p class="pyramid-note-comment">«{{ item.sommelier_note }}»</p>
                    }
                  </div>
                }
              </div>
            }
          } @else {
            <p class="text-center text-muted p-3xl">Пирамида для этого сорта находится в стадии заполнения сомелье.</p>
          }

          <!-- Рекомендация по подаче -->
          @if (brand.serving_recommendation; as rec) {
            <div class="glass-card p-xl serving-info">
              <div class="serving-item">
                <span class="badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/></svg>
                  Температура подачи
                </span>
                <h4>{{ rec.serving_temp_min }}–{{ rec.serving_temp_max }} °C</h4>
              </div>
              <div class="serving-item">
                <span class="badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 2v8"/><path d="m4.6 18.4 3.4-3.4"/><path d="M20 4 8.5 15.5"/></svg>
                  Рекомендованный бокал
                </span>
                <h4>{{ rec.glass_type }}</h4>
              </div>
            </div>
          }
        </div>
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

  brands = signal<Brand[]>([]);
  searchQuery = signal<string>('');
  selectedPackaging = signal<string>('');
  onlyHoreca = signal<boolean>(false);
  selectedBrand = signal<Brand | null>(null);

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
    this.api.getBrands().subscribe(data => this.brands.set(data));
  }

  resetFilters() {
    this.searchQuery.set('');
    this.selectedPackaging.set('');
    this.onlyHoreca.set(false);
  }

  openBrandDetail(brand: Brand) {
    this.api.getBrandDetail(brand.id).subscribe(fullBrand => {
      this.selectedBrand.set(fullBrand);
    });
  }
}
