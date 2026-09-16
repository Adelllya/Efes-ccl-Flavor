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
    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 28px; flex-wrap: wrap; gap: 16px;">
      <div>
        <h1 style="font-size: 2.4rem;">Каталог 17 сортов & Вкусовая пирамида</h1>
        <p style="color: var(--muted);">Исследуйте сенсорные профили, температуру подачи, бокалы и HoReCa позиции</p>
      </div>

      <!-- Поиск -->
      <input
        type="text"
        [(ngModel)]="searchQuery"
        placeholder="🔍 Поиск по названию или стилю..."
        style="padding: 12px 20px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-1); min-width: 280px; font-size: 0.95rem;"
      />
    </div>

    <!-- Панель фильтров -->
    <div class="glass-panel" style="padding: 18px 24px; margin-bottom: 32px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
      <span style="font-weight: 600; font-size: 0.9rem; color: var(--muted);">Упаковка:</span>
      <button class="btn-outline" [class.active]="selectedPackaging() === ''" (click)="selectedPackaging.set('')">Все ({{ brands().length }})</button>
      <button class="btn-outline" [class.active]="selectedPackaging() === 'BOTTLE'" (click)="selectedPackaging.set('BOTTLE')">🍾 Бутылка</button>
      <button class="btn-outline" [class.active]="selectedPackaging() === 'CAN'" (click)="selectedPackaging.set('CAN')">🥫 Банка</button>
      <button class="btn-outline" [class.active]="selectedPackaging() === 'DRAFT'" (click)="selectedPackaging.set('DRAFT')">🍺 Разливное</button>

      <label style="display: flex; align-items: center; gap: 8px; margin-left: auto; cursor: pointer; font-weight: 600; font-size: 0.9rem;">
        <input type="checkbox" [(ngModel)]="onlyHoreca" />
        <span>🍷 Только для ресторанов HoReCa</span>
      </label>
    </div>

    <!-- Сетка сортов -->
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px;">
      @for (brand of filteredBrands(); track brand.id) {
        <div class="glass-card" style="padding: 24px; display: flex; flex-direction: column; justify-content: space-between; transition: transform 0.2s, box-shadow 0.2s;">
          <div>
            <!-- Верхняя строка: бейджи -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
              <span class="badge">{{ brand.style }}</span>
              @if (brand.is_horeca_only) {
                <span class="badge" style="background: rgba(168,85,12,0.15); color: var(--beer-deep);">🍷 HoReCa Only</span>
              } @else {
                <span class="badge" style="background: rgba(224,138,40,0.08);">{{ brand.packaging_type_display || brand.packaging_type }}</span>
              }
            </div>

            <!-- Витрина фотографии сорта (единая высота для всех карточек) -->
            <div style="height: 180px; width: 100%; display: flex; align-items: center; justify-content: center; margin-bottom: 18px; background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.03) 100%); border-radius: 14px; border: 1px solid var(--line); overflow: hidden; padding: 10px; position: relative;">
              @if (brand.image) {
                <img
                  [src]="brand.image"
                  [alt]="brand.name"
                  style="max-height: 100%; max-width: 100%; object-fit: contain; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.18)); transform: scale(1.1); transition: transform 0.3s ease;"
                />
              } @else {
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.35;">
                  <span style="font-size: 3rem;">🍺</span>
                  <span style="font-size: 0.72rem; color: var(--muted); margin-top: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Flavor Tree</span>
                </div>
              }
            </div>

            <h3 style="font-size: 1.35rem; margin-bottom: 6px;">{{ brand.name }}</h3>
            @if (brand.brand_owner) {
              <p style="font-size: 0.78rem; color: var(--muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">{{ brand.brand_owner }}</p>
            }
            <p style="font-size: 0.9rem; color: var(--foam-dim); margin-bottom: 18px; line-height: 1.45; min-height: 40px;">{{ brand.description }}</p>

            <!-- Характеристики -->
            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); margin-bottom: 18px; font-size: 0.85rem;">
              <div><strong>ABV:</strong> {{ brand.abv !== null && brand.abv !== undefined ? brand.abv + '%' : 'По закупке' }}</div>
              <div><strong>Упаковка:</strong> {{ brand.packaging_type_display || brand.packaging_type }}</div>
              @if (brand.profile) {
                <div><strong>Пирамида:</strong> {{ brand.profile.complete ? '✅ Заполнен' : (brand.profile.status === 'partial' ? '🟡 Частично' : '⚪ Черновик') }}</div>
              }
            </div>
          </div>

          <button class="btn-amber" style="width: 100%; justify-content: center;" (click)="openBrandDetail(brand)">
            📐 Вкусовая Пирамида & Подача
          </button>
        </div>
      }
    </div>

    <!-- МОДАЛЬНОЕ ОКНО: ИНТЕРАКТИВНАЯ ВКУСОВАЯ ПИРАМИДА БРЕНДА -->
    @if (selectedBrand(); as brand) {
      <div style="position: fixed; inset: 0; background: rgba(31, 22, 14, 0.65); backdrop-filter: blur(8px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px;">
        <div class="glass-card" style="max-width: 880px; width: 100%; max-height: 90vh; overflow-y: auto; padding: 36px; position: relative; background: var(--bg-0);">
          <button class="btn-outline" (click)="selectedBrand.set(null)" style="position: absolute; top: 24px; right: 24px;">✕ Закрыть</button>

          <div style="display: flex; gap: 24px; align-items: center; margin-bottom: 28px; flex-wrap: wrap;">
            @if (brand.image) {
              <div style="height: 160px; width: 120px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.03); border: 1px solid var(--line); border-radius: 16px; padding: 10px; flex-shrink: 0;">
                <img [src]="brand.image" [alt]="brand.name" style="max-height: 100%; max-width: 100%; object-fit: contain; filter: drop-shadow(0 6px 16px rgba(0,0,0,0.2));" />
              </div>
            }
            <div>
              <span class="badge" style="margin-bottom: 8px;">{{ brand.style }} • ABV {{ brand.abv !== null && brand.abv !== undefined ? brand.abv + '%' : 'N/A' }}</span>
              <h2 style="font-size: 2rem; margin: 0;">{{ brand.name }} — Сенсорная Пирамида</h2>
              @if (brand.brand_owner) {
                <p style="font-size: 0.85rem; color: var(--muted); margin-top: 4px; text-transform: uppercase;">{{ brand.brand_owner }}</p>
              }
            </div>
          </div>

          @if (brand.pyramid) {
            <!-- СЛОЙ 1: TOP NOTES -->
            @if (brand.pyramid.top && brand.pyramid.top.length > 0) {
              <div class="glass-panel" style="padding: 22px; margin-bottom: 18px;">
                <h3 style="color: var(--beer-deep); margin-bottom: 14px;">🌿 Top Notes (Ароматическая вершина • 0–3 секунды)</h3>
                @for (item of brand.pyramid.top; track item.id) {
                  <div style="margin-bottom: 14px;">
                    <div style="display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 6px;">
                      <span>{{ item.icon }} {{ item.name }}</span>
                      <span>Интенсивность: {{ item.intensity }}/10</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" [style.width.%]="item.intensity * 10"></div>
                    </div>
                    @if (item.sommelier_note) {
                      <p style="font-size: 0.85rem; color: var(--foam-dim); margin-top: 6px; font-style: italic;">«{{ item.sommelier_note }}»</p>
                    }
                  </div>
                }
              </div>
            }

            <!-- СЛОЙ 2: HEART NOTES -->
            @if (brand.pyramid.heart && brand.pyramid.heart.length > 0) {
              <div class="glass-panel" style="padding: 22px; margin-bottom: 18px;">
                <h3 style="color: var(--beer-deep); margin-bottom: 14px;">🌾 Heart Notes (Солодовое сердце • 3–15 секунд)</h3>
                @for (item of brand.pyramid.heart; track item.id) {
                  <div style="margin-bottom: 14px;">
                    <div style="display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 6px;">
                      <span>{{ item.icon }} {{ item.name }}</span>
                      <span>Интенсивность: {{ item.intensity }}/10</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" [style.width.%]="item.intensity * 10"></div>
                    </div>
                    @if (item.sommelier_note) {
                      <p style="font-size: 0.85rem; color: var(--foam-dim); margin-top: 6px; font-style: italic;">«{{ item.sommelier_note }}»</p>
                    }
                  </div>
                }
              </div>
            }

            <!-- СЛОЙ 3: BASE NOTES -->
            @if (brand.pyramid.base && brand.pyramid.base.length > 0) {
              <div class="glass-panel" style="padding: 22px; margin-bottom: 24px;">
                <h3 style="color: var(--beer-deep); margin-bottom: 14px;">⚡ Base Notes (Послевкусие и горечь • 15+ секунд)</h3>
                @for (item of brand.pyramid.base; track item.id) {
                  <div style="margin-bottom: 14px;">
                    <div style="display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 6px;">
                      <span>{{ item.icon }} {{ item.name }}</span>
                      <span>Интенсивность: {{ item.intensity }}/10</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" [style.width.%]="item.intensity * 10"></div>
                    </div>
                    @if (item.sommelier_note) {
                      <p style="font-size: 0.85rem; color: var(--foam-dim); margin-top: 6px; font-style: italic;">«{{ item.sommelier_note }}»</p>
                    }
                  </div>
                }
              </div>
            }
          } @else {
            <p style="padding: 24px; text-align: center; color: var(--muted);">Пирамида для этого сорта находится в стадии заполнения сомелье.</p>
          }

          <!-- Рекомендация по подаче -->
          @if (brand.serving_recommendation; as rec) {
            <div class="glass-card" style="padding: 20px; display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
              <div>
                <span class="badge">🌡️ Температура подачи</span>
                <h4 style="font-size: 1.3rem; margin-top: 6px;">{{ rec.serving_temp_min }}–{{ rec.serving_temp_max }} °C</h4>
              </div>
              <div>
                <span class="badge">🍷 Рекомендованный бокал</span>
                <h4 style="font-size: 1.1rem; margin-top: 6px;">{{ rec.glass_type }}</h4>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `
})
export class BrandExplorerComponent implements OnInit {
  private api = inject(ApiService);

  brands = signal<Brand[]>([]);
  searchQuery = '';
  selectedPackaging = signal<string>('');
  onlyHoreca = false;
  selectedBrand = signal<Brand | null>(null);

  filteredBrands = computed(() => {
    return this.brands().filter(b => {
      const matchSearch = b.name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
                          b.style.toLowerCase().includes(this.searchQuery.toLowerCase());
      const matchPack = !this.selectedPackaging() || b.packaging_type === this.selectedPackaging();
      const matchHoreca = !this.onlyHoreca || b.is_horeca_only;
      return matchSearch && matchPack && matchHoreca;
    });
  });

  ngOnInit() {
    this.api.getBrands().subscribe(data => this.brands.set(data));
  }

  openBrandDetail(brand: Brand) {
    this.api.getBrandDetail(brand.id).subscribe(full => {
      this.selectedBrand.set(full);
    });
  }
}
