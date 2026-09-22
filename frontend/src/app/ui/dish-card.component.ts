import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Dish } from '../core/models';

/** Карточка блюда (каталог, поиск, подбор). */
@Component({
  selector: 'ft-dish-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="card hover dc" (click)="pick.emit(dish())" [attr.aria-label]="'Подобрать пиво к блюду ' + dish().display_name">
      <span class="em">{{ dish().emoji }}</span>
      <span class="txt">
        <span class="nm">{{ dish().display_name }}</span>
        <span class="ct">{{ dish().cuisine_flag }} {{ dish().cuisine_label }} · {{ dish().category }}</span>
        <span class="chips">
          <span class="chip chip-sm">{{ dish().dominant_taste_label }}</span>
          <span class="chip chip-sm">{{ dish().weight_label }}</span>
          @if (dish().vector.heat >= 0.5) { <span class="chip chip-sm hot">🌶 острое</span> }
        </span>
      </span>
    </button>
  `,
  styles: [`
    .dc { display: flex; gap: 14px; align-items: center; text-align: left; padding: 14px; width: 100%; }
    .em { font-size: 2rem; width: 52px; height: 52px; display: grid; place-items: center; border-radius: 14px; background: var(--grad-amber-soft); flex-shrink: 0; }
    .txt { display: grid; gap: 4px; min-width: 0; }
    .nm { font-family: var(--font-display); font-weight: 700; font-size: 1rem; }
    .ct { color: var(--ink-3); font-size: .78rem; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
    .hot { color: var(--warn); border-color: rgba(192, 57, 43, .3); }
  `],
})
export class DishCardComponent {
  dish = input.required<Dish>();
  pick = output<Dish>();
}
