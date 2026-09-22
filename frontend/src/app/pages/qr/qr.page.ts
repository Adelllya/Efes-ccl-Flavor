import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { VenueService } from '../../core/venue.service';
import { Dish } from '../../core/models';
import { IconComponent } from '../../ui/icon.component';
import { DishCardComponent } from '../../ui/dish-card.component';
import { BeerCardComponent } from '../../ui/beer-card.component';
import { SectionHeadComponent } from '../../ui/section.component';

/** HoReCa-вход: гость сканирует QR на столе → меню заведения → подбор по тому, что реально на кранах. */
@Component({
  selector: 'ft-qr',
  standalone: true,
  imports: [RouterLink, IconComponent, DishCardComponent, BeerCardComponent, SectionHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session(); as s) {
      <section class="card vh">
        <div class="vh-top">
          <div class="pin"><ft-icon name="map-pin" [size]="26" /></div>
          <div class="grow"><span class="eyebrow">Вы в заведении</span><h1 class="vn">{{ s.venue.name }}</h1><p class="dim sm">{{ s.venue.city }}, {{ s.venue.address }} · стол {{ s.table }}</p></div>
        </div>
        <p class="dim" style="padding: 0 18px 14px">{{ s.venue.description }} Подбор ниже учитывает только {{ s.venue.brands.length }} сортов в наличии.</p>
        <div class="flex g8 wrap" style="padding: 0 18px 18px"><a routerLink="/pair" class="btn btn-primary btn-sm"><ft-icon name="sparkles" [size]="16" /> Подобрать к своему блюду</a><button type="button" class="btn btn-ghost btn-sm" (click)="leave()"><ft-icon name="x" [size]="16" /> Выйти из заведения</button></div>
      </section>

      <section class="section">
        <ft-section-head eyebrow="Меню" title="Что вы заказали?" sub="Нажмите на блюдо — покажем лучшие сорта с кранов" />
        <div class="grid grid-2">
          @for (d of menu(); track d.id) { <ft-dish-card [dish]="d" (pick)="go($event)" /> }
        </div>
      </section>

      <section class="section">
        <ft-section-head eyebrow="На кранах и в бутылках" title="Сорта в наличии" />
        <div class="grid grid-4">
          @for (b of beers(); track b.id) { <ft-beer-card [brand]="b" /> }
        </div>
      </section>
    } @else {
      <div class="card card-p center">
        <div style="font-size:48px">🔍</div>
        <h1>Код не распознан</h1>
        <p class="dim mt8">Токен «{{ token() }}» не привязан к заведению. Попробуйте демо-коды:</p>
        <div class="flex g8 jc wrap mt16">
          @for (v of data.venues(); track v.id) { <a class="chip" [routerLink]="['/qr', v.token_prefix + '-01']">{{ v.name }} · {{ v.token_prefix }}-01</a> }
        </div>
      </div>
    }
  `,
  styles: [`
    .vh { overflow: hidden; }
    .vh-top { display: flex; gap: 14px; align-items: center; padding: 18px; background: var(--info-bg); }
    .pin { width: 56px; height: 56px; border-radius: 18px; background: var(--info); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
    .vn { font-size: 1.6rem; }
  `],
})
export class QrPage {
  data = inject(DataService);
  private venue = inject(VenueService);
  private router = inject(Router);
  token = input.required<string>();
  session = computed(() => { const s = this.venue.session(); return s && s.token === this.token().toUpperCase() ? s : null; });
  menu = computed(() => (this.session()?.venue.menu ?? []).map(id => this.data.dish(id)!).filter(Boolean));
  beers = computed(() => (this.session()?.venue.brands ?? []).map(id => this.data.brand(id)!).filter(Boolean));
  constructor() { effect(() => { this.venue.resolve(this.token()); }, { allowSignalWrites: true }); }
  go(d: Dish): void { this.router.navigate(['/pair', d.id]); }
  leave(): void { this.venue.clear(); this.router.navigate(['/']); }
}
