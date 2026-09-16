import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { FoodPairing, Dish } from '../../models/flavor-tree.models';

@Component({
  selector: 'app-food-pairing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="margin-bottom: 32px;">
      <h1 style="font-size: 2.4rem;">Матрица Food Pairing (51 гастрономическая пара)</h1>
      <p style="color: var(--muted);">4 принципа сочетаемости: Complement (дополнение), Contrast (контраст), Cleanse (очищение) и Bridge (мостик вкуса)</p>
    </div>

    <!-- Режимы: Пары или Каталог 50 блюд -->
    <div style="display: flex; gap: 16px; margin-bottom: 24px; align-items: center; flex-wrap: wrap;">
      <button class="btn-amber" [style.opacity]="viewMode() === 'pairings' ? '1' : '0.6'" (click)="viewMode.set('pairings')">
        🤝 51 Гастропара (Пиво + Еда)
      </button>
      <button class="btn-amber" [style.opacity]="viewMode() === 'dishes' ? '1' : '0.6'" (click)="viewMode.set('dishes')">
        🍽️ Каталог 50 блюд (6 кухонь мира)
      </button>
    </div>

    @if (viewMode() === 'pairings') {
      <!-- Фильтр по типу связи -->
      <div style="display: flex; gap: 12px; margin-bottom: 32px; flex-wrap: wrap;">
        <button class="btn-outline" [class.active]="activeFilter() === ''" (click)="activeFilter.set('')">Все сочетания ({{ pairings().length }})</button>
        <button class="btn-outline" [class.active]="activeFilter() === 'CONTRAST'" (click)="activeFilter.set('CONTRAST')">🟠 Contrast (Контраст жир+горечь)</button>
        <button class="btn-outline" [class.active]="activeFilter() === 'COMPLEMENT'" (click)="activeFilter.set('COMPLEMENT')">🟢 Complement (Схожие ноты)</button>
        <button class="btn-outline" [class.active]="activeFilter() === 'CLEANSE'" (click)="activeFilter.set('CLEANSE')">🔵 Cleanse (Очищение после острого)</button>
        <button class="btn-outline" [class.active]="activeFilter() === 'BRIDGE'" (click)="activeFilter.set('BRIDGE')">🟣 Bridge (Мостик вкуса: дым/карамель)</button>
      </div>

      <!-- Карточки пар -->
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 24px;">
        @for (pair of filteredPairings(); track pair.id) {
          <div class="glass-card" style="padding: 28px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <span class="badge">{{ getBadgeLabel(pair.pairing_type) }}</span>
              <span style="font-weight: 700; color: var(--beer-mid);">★ {{ pair.compatibility_score }} / 5 баллов</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 16px; align-items: center; padding: 16px; background: var(--bg-0); border-radius: 14px; margin-bottom: 18px;">
              <div>
                <span style="font-size: 0.75rem; color: var(--muted); text-transform: uppercase;">Сорт напитка</span>
                <h4 style="font-size: 1.1rem; color: var(--beer-deep);">🍺 {{ pair.brand_name }}</h4>
              </div>
              <div style="font-size: 1.4rem;">🤝</div>
              <div>
                <span style="font-size: 0.75rem; color: var(--muted); text-transform: uppercase;">Блюдо</span>
                <h4 style="font-size: 1.1rem; color: var(--foam);">🍽️ {{ pair.dish_name }}</h4>
              </div>
            </div>

            <p style="font-size: 0.93rem; color: var(--foam-dim);">
              <strong>Вердикт сомелье:</strong> {{ pair.explanation }}
            </p>
          </div>
        }
      </div>
    } @else {
      <!-- Вкладка: Каталог 50 блюд -->
      <div style="display: flex; gap: 10px; margin-bottom: 24px; flex-wrap: wrap;">
        <button class="btn-outline" [class.active]="cuisineFilter() === ''" (click)="cuisineFilter.set('')">Все кухни ({{ dishes().length }})</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'KZ'" (click)="cuisineFilter.set('KZ')">🇰🇿 Казахская (15)</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'ITALIAN'" (click)="cuisineFilter.set('ITALIAN')">🇮🇹 Итальянская (7)</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'JAPANESE'" (click)="cuisineFilter.set('JAPANESE')">🇯🇵 Японская (7)</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'AMERICAN'" (click)="cuisineFilter.set('AMERICAN')">🇺🇸 Американская (7)</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'MEXICAN'" (click)="cuisineFilter.set('MEXICAN')">🇲🇽 Мексиканская (7)</button>
        <button class="btn-outline" [class.active]="cuisineFilter() === 'GERMAN'" (click)="cuisineFilter.set('GERMAN')">🇩🇪 Немецкая (7)</button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px;">
        @for (dish of filteredDishes(); track dish.id) {
          <div class="glass-card" style="padding: 22px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="badge">{{ dish.cuisine_display || dish.cuisine }}</span>
              <span class="badge" style="background: rgba(224,138,40,0.08);">{{ dish.dominant_taste_display || dish.dominant_taste }}</span>
            </div>
            <h3 style="font-size: 1.25rem; margin-bottom: 6px;">{{ dish.name }}</h3>
            <p style="font-size: 0.85rem; color: var(--muted); margin-bottom: 10px;">{{ dish.category }} • {{ dish.cooking_method_display || dish.cooking_method }}</p>
            <p style="font-size: 0.9rem; color: var(--foam-dim);">{{ dish.description }}</p>
          </div>
        }
      </div>
    }
  `
})
export class FoodPairingComponent implements OnInit {
  private api = inject(ApiService);
  pairings = signal<FoodPairing[]>([]);
  dishes = signal<Dish[]>([]);
  viewMode = signal<'pairings' | 'dishes'>('pairings');
  activeFilter = signal<string>('');
  cuisineFilter = signal<string>('');

  ngOnInit() {
    this.api.getPairings().subscribe(data => this.pairings.set(data));
    this.api.getDishes().subscribe(data => this.dishes.set(data));
  }

  filteredPairings() {
    if (!this.activeFilter()) return this.pairings();
    return this.pairings().filter(p => p.pairing_type === this.activeFilter());
  }

  filteredDishes() {
    if (!this.cuisineFilter()) return this.dishes();
    return this.dishes().filter(d => d.cuisine === this.cuisineFilter());
  }

  getBadgeLabel(type: string): string {
    switch (type) {
      case 'CONTRAST': return '🟠 Contrast • Горечь режет жирность';
      case 'COMPLEMENT': return '🟢 Complement • Схожие вкусовые ноты';
      case 'CLEANSE': return '🔵 Cleanse • Освежение после острого';
      case 'BRIDGE': return '🟣 Bridge • Общая карамельная/дымная нота';
      default: return '🤝 Сочетание';
    }
  }
}
