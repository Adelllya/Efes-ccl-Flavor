import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { FoodPairing, Dish, Brand } from '../../models/flavor-tree.models';
import { smallImage } from '../landing/pairing-engine.data';

@Component({
  selector: 'app-food-pairing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="section-head">
      <span class="badge">Матрица сочетаний</span>
      <h1 class="section-header">Пиво и еда: {{ pairings().length }} {{ pairWord(pairings().length) }}</h1>
      <p class="section-subtitle">Четыре принципа сочетаемости по стандарту FlavorActiV: Complement, Contrast, Cleanse и Bridge.</p>
    </div>

    <!-- Режимы: Пары или Каталог блюд + Поиск -->
    <div class="flex justify-between items-center mb-2xl flex-wrap gap-lg">
      <div class="flex gap-md flex-wrap items-center">
        <button
          class="btn-outline"
          [class.active]="viewMode() === 'pairings'"
          (click)="viewMode.set('pairings')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/></svg>
          51 Гастропара
        </button>
        <button
          class="btn-outline"
          [class.active]="viewMode() === 'dishes'"
          (click)="viewMode.set('dishes')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
          Каталог 50 блюд
        </button>
      </div>

      <div style="position: relative; min-width: 260px; max-width: 360px; width: 100%;">
        <input
          type="text"
          class="input"
          [ngModel]="searchQuery()"
          (ngModelChange)="searchQuery.set($event)"
          [placeholder]="viewMode() === 'pairings' ? 'Поиск по блюду или пиву...' : 'Поиск блюда...'"
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

    @if (viewMode() === 'pairings') {
      <!-- Фильтр по типу связи -->
      <div class="flex gap-sm mb-3xl flex-wrap">
        <button class="btn-outline" [class.active]="activeFilter() === ''" (click)="activeFilter.set('')">Все ({{ pairings().length }})</button>
        <button class="btn-outline" [class.active]="activeFilter() === 'CONTRAST'" (click)="activeFilter.set('CONTRAST')">
          <i class="type-dot" data-type="CONTRAST"></i> Contrast
        </button>
        <button class="btn-outline" [class.active]="activeFilter() === 'COMPLEMENT'" (click)="activeFilter.set('COMPLEMENT')">
          <i class="type-dot" data-type="COMPLEMENT"></i> Complement
        </button>
        <button class="btn-outline" [class.active]="activeFilter() === 'CLEANSE'" (click)="activeFilter.set('CLEANSE')">
          <i class="type-dot" data-type="CLEANSE"></i> Cleanse
        </button>
        <button class="btn-outline" [class.active]="activeFilter() === 'BRIDGE'" (click)="activeFilter.set('BRIDGE')">
          <i class="type-dot" data-type="BRIDGE"></i> Bridge
        </button>
      </div>

      <!-- Карточки пар: сначала самые сильные сочетания -->
      <div class="pair-grid">
        @for (pair of filteredPairings(); track pair.id) {
          <article class="glass-card pair-card stagger-item" [attr.data-type]="pair.pairing_type">
            <header class="pair-head">
              <span class="badge badge-type" [ngClass]="'badge-' + pair.pairing_type.toLowerCase()">
                {{ getBadgeLabel(pair.pairing_type) }}
              </span>
              <span class="pair-score" [attr.aria-label]="'Оценка ' + pair.compatibility_score + ' из 5'">
                @for (dot of [1, 2, 3, 4, 5]; track dot) {
                  <i class="pair-dot" [class.on]="dot <= pair.compatibility_score"></i>
                }
                <b>{{ pair.compatibility_score }}/5</b>
              </span>
            </header>

            <div class="pair-duo">
              <div class="pair-thumb">
                @if (brandImage(pair.brand); as src) {
                  <img [src]="src" [alt]="pair.brand_name" loading="lazy" />
                } @else {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v3.5l2 3V21a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8.5l2-3V2Z"/><path d="M8 12h8"/></svg>
                }
              </div>
              <div class="pair-names">
                <span class="pair-label">Сорт напитка</span>
                <p class="pair-beer">{{ pair.brand_name }}</p>
                <span class="pair-label">Блюдо</span>
                <p class="pair-dish">{{ pair.dish_name }}</p>
              </div>
            </div>

            <p class="pair-verdict mt-auto">
              <span class="pair-verdict-label">Вердикт сомелье</span>
              {{ pair.explanation }}
            </p>
          </article>
        } @empty {
          <div class="empty-state">
            <p>По вашему запросу гастропар не найдено.</p>
          </div>
        }
      </div>
    } @else {
      <!-- Каталог 50 блюд -->
      <div class="flex gap-sm mb-2xl flex-wrap">
        <button class="btn-outline" [class.active]="cuisineFilter() === ''" (click)="cuisineFilter.set('')">Все кухни ({{ dishes().length }})</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'KZ'" (click)="cuisineFilter.set('KZ')">🇰🇿 Казахская</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'ITALIAN'" (click)="cuisineFilter.set('ITALIAN')">🇮🇹 Итальянская</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'JAPANESE'" (click)="cuisineFilter.set('JAPANESE')">🇯🇵 Японская</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'AMERICAN'" (click)="cuisineFilter.set('AMERICAN')">🇺🇸 Американская</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'MEXICAN'" (click)="cuisineFilter.set('MEXICAN')">🇲🇽 Мексиканская</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'GERMAN'" (click)="cuisineFilter.set('GERMAN')">🇩🇪 Немецкая</button>
      </div>

      <div class="grid grid-cards-sm">
        @for (dish of filteredDishes(); track dish.id) {
          <div class="glass-card p-xl stagger-item">
            <div class="flex justify-between items-center mb-sm">
              <span class="badge">{{ dish.cuisine_display || dish.cuisine }}</span>
              <span class="badge" style="background: rgba(180,83,9,0.06);">{{ dish.dominant_taste_display || dish.dominant_taste }}</span>
            </div>
            <h3 class="mb-sm" style="font-size: 1.2rem;">{{ dish.name }}</h3>
            <p class="text-muted text-sm mb-md">{{ dish.category }} · {{ dish.cooking_method_display || dish.cooking_method }}</p>
            <p class="text-dim text-sm">{{ dish.description }}</p>
          </div>
        } @empty {
          <div class="empty-state">
            <p>По вашему запросу блюд не найдено.</p>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .badge-contrast { background: rgba(220, 38, 38, 0.1); color: #DC2626; border-color: rgba(220, 38, 38, 0.18); }
    .badge-complement { background: rgba(22, 163, 74, 0.1); color: #16A34A; border-color: rgba(22, 163, 74, 0.18); }
    .badge-cleanse { background: rgba(37, 99, 235, 0.1); color: #2563EB; border-color: rgba(37, 99, 235, 0.18); }
    .badge-bridge { background: rgba(147, 51, 234, 0.1); color: #9333EA; border-color: rgba(147, 51, 234, 0.18); }

    /* Точка принципа: тот же цвет, что и полоса слева на карточке. */
    .type-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .type-dot[data-type="CONTRAST"] { background: #DC2626; }
    .type-dot[data-type="COMPLEMENT"] { background: #16A34A; }
    .type-dot[data-type="CLEANSE"] { background: #2563EB; }
    .type-dot[data-type="BRIDGE"] { background: #9333EA; }

    .pair-grid {
      display: grid;
      gap: var(--space-xl);
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      align-items: stretch;
    }
    @media (max-width: 520px) {
      .pair-grid { grid-template-columns: 1fr; }
    }

    .pair-card {
      padding: var(--space-xl) var(--space-xl) var(--space-xl) calc(var(--space-xl) + 4px);
      overflow: hidden;
    }
    /* Цветная полоса слева кодирует принцип сочетания — 51 карточка
       перестаёт читаться как однородная стена. */
    .pair-card::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: var(--beer-accent);
    }
    .pair-card[data-type="CONTRAST"]::before { background: #DC2626; }
    .pair-card[data-type="COMPLEMENT"]::before { background: #16A34A; }
    .pair-card[data-type="CLEANSE"]::before { background: #2563EB; }
    .pair-card[data-type="BRIDGE"]::before { background: #9333EA; }

    .pair-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
      margin-bottom: var(--space-lg);
    }

    .pair-score {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .pair-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: rgba(180, 83, 9, 0.16);
    }
    .pair-dot.on { background: var(--beer-accent); box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.16); }
    .pair-score b {
      margin-left: 4px;
      font-family: var(--font-heading);
      font-size: 0.82rem;
      color: var(--beer-mid);
    }

    .pair-duo {
      display: grid;
      grid-template-columns: 64px 1fr;
      gap: var(--space-lg);
      align-items: center;
      padding: var(--space-md);
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, rgba(255, 253, 249, 0.9), rgba(250, 240, 226, 0.7));
      border: 1px solid var(--line-subtle);
      margin-bottom: var(--space-lg);
    }

    .pair-thumb {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      height: 78px;
      border-radius: var(--radius-md);
      background: radial-gradient(ellipse 60% 30% at 50% 94%, rgba(180, 83, 9, 0.16), transparent 70%);
      color: var(--beer-mid);
    }
    .pair-thumb img {
      height: 76px;
      width: 100%;
      object-fit: contain;
      object-position: center bottom;
      /* Как в каталоге: у исходников большие поля, поэтому масштабируем от дна. */
      transform: scale(1.3);
      transform-origin: center bottom;
      filter: drop-shadow(0 6px 8px rgba(69, 26, 3, 0.26));
    }
    .pair-thumb svg { width: 34px; height: 34px; opacity: 0.4; }

    .pair-label {
      display: block;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .pair-beer {
      font-family: var(--font-heading);
      font-size: 1.02rem;
      font-weight: 800;
      color: var(--beer-deep);
      line-height: 1.25;
      margin-bottom: var(--space-sm);
    }
    .pair-dish {
      font-family: var(--font-heading);
      font-size: 1.02rem;
      font-weight: 700;
      line-height: 1.25;
    }

    .pair-verdict {
      font-size: 0.85rem;
      line-height: 1.5;
      color: var(--foam-dim);
    }
    .pair-verdict-label {
      display: block;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 4px;
    }
  `]
})
export class FoodPairingComponent implements OnInit {
  private api = inject(ApiService);
  pairings = signal<FoodPairing[]>([]);
  dishes = signal<Dish[]>([]);
  brands = signal<Brand[]>([]);

  /** id бренда → лёгкое фото бутылки, чтобы не искать по массиву в шаблоне. */
  private brandPhotos = computed(() => {
    const map = new Map<string, string>();
    for (const b of this.brands()) {
      const src = smallImage(b);
      if (src) map.set(b.id, src);
    }
    return map;
  });
  viewMode = signal<'pairings' | 'dishes'>('pairings');
  activeFilter = signal<string>('');
  cuisineFilter = signal<string>('');
  searchQuery = signal<string>('');

  filteredPairings = computed(() => {
    const filter = this.activeFilter();
    const query = this.searchQuery().trim().toLowerCase();

    return this.pairings().filter(p => {
      const matchType = !filter || p.pairing_type === filter;
      const matchQuery = !query ||
        p.brand_name.toLowerCase().includes(query) ||
        p.dish_name.toLowerCase().includes(query) ||
        (p.explanation && p.explanation.toLowerCase().includes(query));
      return matchType && matchQuery;
    }).sort((a, b) => b.compatibility_score - a.compatibility_score);
  });

  filteredDishes = computed(() => {
    const cuisine = this.cuisineFilter();
    const query = this.searchQuery().trim().toLowerCase();

    return this.dishes().filter(d => {
      const matchCuisine = !cuisine || d.cuisine === cuisine;
      const matchQuery = !query ||
        d.name.toLowerCase().includes(query) ||
        (d.category && d.category.toLowerCase().includes(query)) ||
        (d.description && d.description.toLowerCase().includes(query));
      return matchCuisine && matchQuery;
    });
  });

  ngOnInit() {
    this.api.getPairings().subscribe(data => this.pairings.set(data));
    this.api.getDishes().subscribe(data => this.dishes.set(data));
    this.api.getBrands().subscribe(data => this.brands.set(data));
  }

  /** «1 пара», «2 пары», «51 пара», «5 пар» — иначе в заголовке видно кривую форму. */
  pairWord(n: number): string {
    const tens = n % 100;
    if (tens >= 11 && tens <= 14) return 'пар';
    switch (n % 10) {
      case 1: return 'пара';
      case 2: case 3: case 4: return 'пары';
      default: return 'пар';
    }
  }

  brandImage(brandId: string): string {
    return this.brandPhotos().get(brandId) ?? '';
  }

  getBadgeLabel(type: string): string {
    switch (type) {
      case 'CONTRAST': return 'Contrast · Горечь × жирность';
      case 'COMPLEMENT': return 'Complement · Схожие ноты';
      case 'CLEANSE': return 'Cleanse · Очищение';
      case 'BRIDGE': return 'Bridge · Мостик вкуса';
      default: return 'Сочетание';
    }
  }
}
