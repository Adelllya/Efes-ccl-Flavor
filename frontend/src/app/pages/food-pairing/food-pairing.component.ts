import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { FoodPairing, Dish, Brand } from '../../models/flavor-tree.models';

@Component({
  selector: 'app-food-pairing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="mb-3xl">
      <h1 class="section-header">Матрица Food Pairing (51 гастрономическая пара)</h1>
      <p class="text-muted">4 принципа сочетаемости по стандарту FlavorActiV: Complement, Contrast, Cleanse и Bridge</p>
    </div>

    <!-- Режимы: Пары или Каталог блюд + Поиск -->
    <div class="flex justify-between items-center mb-2xl flex-wrap gap-lg">
      <div class="flex gap-md flex-wrap items-center">
        <button
          class="btn-outline"
          [class.active]="viewMode() === 'pairings'"
          (click)="viewMode.set('pairings')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
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
        <button class="btn-outline" [class.active]="activeFilter() === 'CONTRAST'" (click)="activeFilter.set('CONTRAST')">⚡ Contrast</button>
        <button class="btn-outline" [class.active]="activeFilter() === 'COMPLEMENT'" (click)="activeFilter.set('COMPLEMENT')">🌿 Complement</button>
        <button class="btn-outline" [class.active]="activeFilter() === 'CLEANSE'" (click)="activeFilter.set('CLEANSE')">💧 Cleanse</button>
        <button class="btn-outline" [class.active]="activeFilter() === 'BRIDGE'" (click)="activeFilter.set('BRIDGE')">🌉 Bridge</button>
      </div>

      <!-- Карточки пар -->
      <div class="grid grid-cards-lg">
        @for (pair of filteredPairings(); track pair.id) {
          <div class="glass-card p-2xl stagger-item">
            <div class="flex justify-between items-center mb-lg">
              <span class="badge badge-type" [ngClass]="'badge-' + pair.pairing_type.toLowerCase()">
                {{ getBadgeLabel(pair.pairing_type) }}
              </span>
              <span class="font-bold text-beer">⭐ {{ pair.compatibility_score }} / 5</span>
            </div>

            <div class="pairing-versus mb-lg">
              <div>
                <span class="pairing-versus-label">Сорт напитка</span>
                <h4 class="pairing-versus-name text-deep">{{ pair.brand_name }}</h4>
              </div>
              <div class="pairing-connector">⟷</div>
              <div>
                <span class="pairing-versus-label">Блюдо</span>
                <h4 class="pairing-versus-name">{{ pair.dish_name }}</h4>
              </div>
            </div>

            <p class="text-dim text-sm" style="line-height: 1.45;">
              <strong style="color: var(--foam);">Вердикт сомелье:</strong> {{ pair.explanation }}
            </p>
          </div>
        } @empty {
          <div class="glass-panel text-center p-4xl" style="grid-column: 1 / -1;">
            <p class="text-muted">По вашему запросу гастропар не найдено.</p>
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
          <div class="glass-panel text-center p-4xl" style="grid-column: 1 / -1;">
            <p class="text-muted">По вашему запросу блюд не найдено.</p>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .badge-contrast { background: rgba(220, 38, 38, 0.1); color: #DC2626; }
    .badge-complement { background: rgba(22, 163, 74, 0.1); color: #16A34A; }
    .badge-cleanse { background: rgba(37, 99, 235, 0.1); color: #2563EB; }
    .badge-bridge { background: rgba(147, 51, 234, 0.1); color: #9333EA; }
  `]
})
export class FoodPairingComponent implements OnInit {
  private api = inject(ApiService);
  pairings = signal<FoodPairing[]>([]);
  dishes = signal<Dish[]>([]);
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
    });
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
