import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { FoodPairing, Dish, CuisineType, PAIRING_LABELS, PairingType } from '../../models/flavor-tree.models';
import { countOf } from '../venue-menu/plural';
import { PairingV2Component } from '../drinks-v2/pairing-v2.component';

/** Короткое пояснение к типу сочетания на бейдже карточки. */
const PAIRING_HINT: Record<PairingType, string> = {
  COMPLEMENT: 'схожие ноты',
  CONTRAST: 'горечь против жирности',
  CLEANSE: 'освежает рецепторы',
  BRIDGE: 'общая нота вкуса',
};

const CUISINES: { id: CuisineType; label: string }[] = [
  { id: 'KZ', label: 'Казахская' },
  { id: 'ITALIAN', label: 'Итальянская' },
  { id: 'JAPANESE', label: 'Японская' },
  { id: 'AMERICAN', label: 'Американская' },
  { id: 'MEXICAN', label: 'Мексиканская' },
  { id: 'GERMAN', label: 'Немецкая' },
];

@Component({
  selector: 'app-food-pairing',
  standalone: true,
  imports: [CommonModule, FormsModule, PairingV2Component],
  template: `
    <div class="mb-3xl">
      <h1 class="section-header">Что подать к блюду</h1>
      <p class="text-muted">Сочетания блюд и сортов, которые проверил сомелье</p>
    </div>

    <!-- Режимы: Сочетания или Каталог блюд + Поиск -->
    <div class="flex justify-between items-center mb-2xl flex-wrap gap-lg">
      <div class="flex gap-md flex-wrap items-center">
        <button
          class="btn-outline"
          [class.active]="viewMode() === 'pairings'"
          (click)="viewMode.set('pairings')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          {{ pairingsLoaded() ? countOf(pairings().length, 'сочетание', 'сочетания', 'сочетаний') : 'Сочетания' }}
        </button>
        <button
          class="btn-outline"
          [class.active]="viewMode() === 'dishes'"
          (click)="viewMode.set('dishes')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
          {{ dishesLoaded() ? 'Каталог ' + countOf(dishes().length, 'блюда', 'блюд', 'блюд') : 'Каталог блюд' }}
        </button>
        <button
          class="btn-outline"
          [class.active]="viewMode() === 'drinks'"
          (click)="viewMode.set('drinks')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/></svg>
          Подбор из 412 напитков
        </button>
      </div>

      @if (viewMode() !== 'drinks') {
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
          >&#x2715;</button>
        }
      </div>
      }
    </div>

    @if (viewMode() === 'pairings') {
      <!-- Фильтр по типу сочетания -->
      <div class="flex gap-sm mb-3xl flex-wrap">
        <button class="btn-outline" [class.active]="activeFilter() === ''" (click)="activeFilter.set('')">Все{{ pairingsLoaded() ? ' (' + pairings().length + ')' : '' }}</button>
        @for (t of pairingTypes; track t.id) {
          <button class="btn-outline" [class.active]="activeFilter() === t.id" (click)="activeFilter.set(t.id)">{{ t.label }}</button>
        }
      </div>

      @if (!pairingsLoaded()) {
        <div class="skeleton-grid" aria-busy="true" aria-label="Загружаем сочетания">
          @for (i of skeletonCards; track i) {
            <div class="skeleton-card">
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
            </div>
          }
        </div>
      } @else {
        <!-- Карточки сочетаний -->
        <div class="grid grid-cards-lg">
          @for (pair of filteredPairings(); track pair.id) {
            <div class="glass-card p-2xl stagger-item">
              <div class="flex justify-between items-center mb-lg">
                <span class="badge badge-type" [ngClass]="'badge-' + pair.pairing_type.toLowerCase()">
                  {{ getBadgeLabel(pair.pairing_type) }}
                </span>
                <span class="badge">{{ pair.compatibility_score }} / 5</span>
              </div>

              <div class="pairing-versus mb-lg">
                <div>
                  <span class="pairing-versus-label">Сорт напитка</span>
                  <h4 class="pairing-versus-name text-deep">{{ pair.brand_name }}</h4>
                </div>
                <div class="pairing-connector" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>
                </div>
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
              <p class="text-muted">По вашему запросу сочетаний не найдено.</p>
            </div>
          }
        </div>
      }
    } @else if (viewMode() === 'drinks') {
      <!-- Подбор из всех напитков движка v2 -->
      <app-pairing-v2 />
    } @else {
      <!-- Каталог блюд -->
      <div class="flex gap-sm mb-2xl flex-wrap">
        <button class="btn-outline" [class.active]="cuisineFilter() === ''" (click)="cuisineFilter.set('')">Все кухни{{ dishesLoaded() ? ' (' + dishes().length + ')' : '' }}</button>
        @for (c of cuisines; track c.id) {
          <button class="btn-outline" [class.active]="cuisineFilter() === c.id" (click)="cuisineFilter.set(c.id)">{{ c.label }}</button>
        }
      </div>

      @if (!dishesLoaded()) {
        <div class="skeleton-grid" aria-busy="true" aria-label="Загружаем блюда">
          @for (i of skeletonCards; track i) {
            <div class="skeleton-card">
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
            </div>
          }
        </div>
      } @else {
        <div class="grid grid-cards-sm">
          @for (dish of filteredDishes(); track dish.id) {
            <div class="glass-card p-xl stagger-item">
              <div class="flex justify-between items-center mb-sm">
                <span class="badge">{{ dish.cuisine_display || dish.cuisine }}</span>
                <span class="badge" style="background: rgba(180,83,9,0.06);">{{ dish.dominant_taste_display || dish.dominant_taste }}</span>
              </div>
              <h3 class="mb-sm" style="font-size: 1.2rem;">{{ dish.name }}</h3>
              <p class="text-muted text-sm mb-md">{{ dishLine(dish) }}</p>
              <p class="text-dim text-sm">{{ dish.description }}</p>
            </div>
          } @empty {
            <div class="glass-panel text-center p-4xl" style="grid-column: 1 / -1;">
              <p class="text-muted">По вашему запросу блюд не найдено.</p>
            </div>
          }
        </div>
      }
    }
  `,
  styles: [`
    .badge-contrast { background: rgba(220, 38, 38, 0.1); color: #DC2626; }
    .badge-complement { background: rgba(22, 163, 74, 0.1); color: #16A34A; }
    .badge-cleanse { background: rgba(37, 99, 235, 0.1); color: #2563EB; }
    .badge-bridge { background: rgba(147, 51, 234, 0.1); color: #9333EA; }
    .pairing-connector svg { display: block; margin: 0 auto; color: var(--beer-mid); }
  `]
})
export class FoodPairingComponent implements OnInit {
  private api = inject(ApiService);
  pairings = signal<FoodPairing[]>([]);
  dishes = signal<Dish[]>([]);
  /** Пока false - скелет; "не найдено" показываем только после загрузки. */
  pairingsLoaded = signal(false);
  dishesLoaded = signal(false);
  viewMode = signal<'pairings' | 'dishes' | 'drinks'>('pairings');
  activeFilter = signal<string>('');
  cuisineFilter = signal<string>('');
  searchQuery = signal<string>('');

  readonly countOf = countOf;
  readonly skeletonCards = [1, 2, 3, 4, 5, 6];
  readonly cuisines = CUISINES;
  readonly pairingTypes = (Object.keys(PAIRING_LABELS) as PairingType[])
    .map(id => ({ id, label: PAIRING_LABELS[id] }));

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
    this.api.getPairings().subscribe({
      next: data => { this.pairings.set(data); this.pairingsLoaded.set(true); },
      error: () => this.pairingsLoaded.set(true),
    });
    this.api.getDishes().subscribe({
      next: data => { this.dishes.set(data); this.dishesLoaded.set(true); },
      error: () => this.dishesLoaded.set(true),
    });
  }

  /** "Категория · Способ приготовления"; категория бывает пустой, тогда без разделителя. */
  dishLine(dish: Dish): string {
    return [dish.category, dish.cooking_method_display || dish.cooking_method].filter(Boolean).join(' · ');
  }

  getBadgeLabel(type: PairingType): string {
    const label = PAIRING_LABELS[type];
    if (!label) return 'Сочетание';
    const hint = PAIRING_HINT[type];
    return hint ? `${label} · ${hint}` : label;
  }
}
