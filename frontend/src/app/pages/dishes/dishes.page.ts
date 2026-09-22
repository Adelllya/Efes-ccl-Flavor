import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/data.service';
import { PairingService } from '../../core/pairing.service';
import { CUISINES, Cuisine, Dish } from '../../core/models';
import { IconComponent } from '../../ui/icon.component';
import { DishCardComponent } from '../../ui/dish-card.component';

@Component({
  selector: 'ft-dishes',
  standalone: true,
  imports: [FormsModule, IconComponent, DishCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="eyebrow">База блюд</span>
    <h1>{{ data.stats().dishes }} блюд · <span class="grad-text">6 кухонь</span></h1>
    <p class="dim mt8">Каждое размечено по 13 сенсорным осям — соль, жир, умами, острота, дым, корочка… Нажмите, чтобы подобрать пиво.</p>
    <div class="search mt16"><ft-icon name="search" /><input class="input" type="search" placeholder="Поиск блюда…" [ngModel]="q()" (ngModelChange)="q.set($event)" aria-label="Поиск" /></div>
    <div class="scroll-x mt12">
      <button type="button" class="chip" [class.on]="cuisine() === ''" (click)="cuisine.set('')">Все</button>
      @for (c of cuisines; track c.id) { <button type="button" class="chip" [class.on]="cuisine() === c.id" (click)="cuisine.set(c.id)">{{ c.flag }} {{ c.label }}</button> }
    </div>
    <div class="grid grid-2 mt16">
      @for (d of list(); track d.id) { <ft-dish-card [dish]="d" (pick)="go($event)" /> }
      @empty { <div class="card card-p center dim" style="grid-column:1/-1">Ничего не найдено</div> }
    </div>
  `,
})
export class DishesPage {
  data = inject(DataService);
  private pairing = inject(PairingService);
  private router = inject(Router);
  q = signal(''); cuisine = signal<Cuisine | ''>('');
  readonly cuisines = CUISINES;
  list = computed<Dish[]>(() => {
    let l = this.q().trim() ? this.pairing.searchDishes(this.q(), 50).map(h => h.dish) : this.data.dishes();
    if (this.cuisine()) l = l.filter(d => d.cuisine === this.cuisine());
    return l;
  });
  go(d: Dish): void { this.router.navigate(['/pair', d.id]); }
}
