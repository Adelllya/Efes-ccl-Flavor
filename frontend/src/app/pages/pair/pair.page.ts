import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/data.service';
import { COOKING_LABELS, FAT_LABELS, PairingService, TASTE_LABELS, WEIGHT_LABELS } from '../../core/pairing.service';
import { VenueService } from '../../core/venue.service';
import { CUISINES, Cooking, Cuisine, Dish, Fat, Taste, Weight } from '../../core/models';
import { IconComponent } from '../../ui/icon.component';
import { DishCardComponent } from '../../ui/dish-card.component';
import { SectionHeadComponent } from '../../ui/section.component';
import { SommelierChatComponent } from '../../ui/sommelier-chat.component';
import { SaasService } from '../../core/saas.service';
import { AiVenue } from '../../core/ai.service';

type Step = 'pick' | 'taste' | 'body' | 'cook' | 'final';

/** Шаг 1 подбора: найти блюдо в базе или описать своё за 4 шага. */
@Component({
  selector: 'ft-pair',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, DishCardComponent, SectionHeadComponent, SommelierChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (step() === 'pick') {
      <section class="top">
        <span class="eyebrow">Шаг 1 из 2</span>
        <h1>Что вы <span class="grad-text">едите?</span></h1>
        <p class="dim mt8">Найдите блюдо — или опишите своё, если его нет в базе.</p>
        <div class="search mt16">
          <ft-icon name="search" />
          <input class="input" type="search" autocomplete="off" enterkeyhint="search" placeholder="Название блюда: шашлык, суши, пицца…" [ngModel]="q()" (ngModelChange)="q.set($event)" (keydown.enter)="enter()" aria-label="Поиск блюда" autofocus />
        </div>
        <a routerLink="/scan" class="scan-cta mt12"><span class="sc-ico">📷</span><span><b>Или просто сфотографируйте</b><br><span class="dim sm">ИИ распознает блюдо и подберёт пиво</span></span><ft-icon name="chevron-right" /></a>
        @if (venue.venue(); as v) {
          <div class="soft venue mt12"><ft-icon name="map-pin" [size]="18" /><span>Показываю меню <b>{{ v.name }}</b>. <button type="button" class="link" (click)="onlyMenu.set(!onlyMenu())">{{ onlyMenu() ? 'Показать все 50 блюд' : 'Только меню заведения' }}</button></span></div>
        }
      </section>

      @if (q().trim()) {
        <section class="section-sm">
          @if (hits().length) {
            <div class="grid grid-2">@for (h of hits(); track h.dish.id) { <ft-dish-card [dish]="h.dish" (pick)="go($event)" /> }</div>
            <button type="button" class="btn btn-secondary btn-block mt12" (click)="startCustom()"><ft-icon name="sparkles" [size]="16" /> Не то? Описать «{{ q() }}» за 4 шага</button>
          } @else {
            <div class="card card-p center"><p class="dim">Такого блюда в базе нет.</p><button type="button" class="btn btn-primary mt12" (click)="startCustom()"><ft-icon name="sparkles" /> Описать «{{ q() }}» за 4 шага</button></div>
          }
        </section>
      } @else {
        <section class="section-sm">
          <div class="cuisines scroll-x">
            <button type="button" class="chip" [class.on]="cuisine() === ''" (click)="cuisine.set('')">Все</button>
            @for (c of cuisines; track c.id) { <button type="button" class="chip" [class.on]="cuisine() === c.id" (click)="cuisine.set(c.id)">{{ c.flag }} {{ c.label }}</button> }
          </div>
          <div class="grid grid-2 mt16">
            @for (d of list(); track d.id) { <ft-dish-card [dish]="d" (pick)="go($event)" /> }
          </div>
          <button type="button" class="card hover card-p custom mt16" (click)="startCustom()">
            <span class="ci"><ft-icon name="sparkles" [size]="24" /></span>
            <span><b>Своё блюдо</b><br><span class="dim sm">Нет в списке? Опишите вкус, вес и способ готовки — движок посчитает вектор</span></span>
            <ft-icon name="chevron-right" />
          </button>
        </section>
      }
    } @else {
      <!-- МАСТЕР «СВОЁ БЛЮДО» -->
      <section class="wiz">
        <button type="button" class="btn btn-ghost btn-sm" (click)="back()"><ft-icon name="arrow-left" [size]="16" /> Назад</button>
        <div class="bar thin mt12"><i [style.width.%]="progress()"></i></div>
        <div class="muted xs mt8">Шаг {{ stepIdx() }} из 4 · {{ name() || 'своё блюдо' }}</div>

        @switch (step()) {
          @case ('taste') {
            <h2 class="mt12">Какой вкус доминирует?</h2>
            <div class="opts">
              @for (t of tastes; track t.id) { <button type="button" class="opt" [class.on]="taste() === t.id" (click)="taste.set(t.id); next('body')"><span class="oe">{{ t.e }}</span><span class="ol">{{ t.l }}</span><span class="od">{{ t.d }}</span></button> }
            </div>
          }
          @case ('body') {
            <h2 class="mt12">Насколько сытное и жирное?</h2>
            <div class="lbl mt12">Вес блюда</div>
            <div class="seg">@for (w of weights; track w.id) { <button type="button" [class.on]="weight() === w.id" (click)="weight.set(w.id)">{{ w.l }}</button> }</div>
            <div class="lbl mt16">Жирность</div>
            <div class="seg">@for (f of fats; track f.id) { <button type="button" [class.on]="fat() === f.id" (click)="fat.set(f.id)">{{ f.l }}</button> }</div>
            <button type="button" class="btn btn-primary btn-block mt24" (click)="next('cook')">Дальше <ft-icon name="arrow-right" /></button>
          }
          @case ('cook') {
            <h2 class="mt12">Как приготовлено?</h2>
            <div class="opts">
              @for (c of cooks; track c.id) { <button type="button" class="opt" [class.on]="cooking() === c.id" (click)="cooking.set(c.id); next('final')"><span class="oe">{{ c.e }}</span><span class="ol">{{ c.l }}</span></button> }
            </div>
          }
          @case ('final') {
            <h2 class="mt12">Последний штрих</h2>
            <div class="lbl mt12">Острота: {{ heatLabel() }}</div>
            <input type="range" class="range" min="0" max="100" step="5" [ngModel]="heat()" (ngModelChange)="heat.set(+$event)" aria-label="Острота" />
            <div class="lbl mt16">Название (необязательно)</div>
            <input class="input" [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="Например: лагман с говядиной" />
            <div class="summary card card-p mt16">
              <div class="muted xs mb8">Итог</div>
              <div class="flex g6 wrap"><span class="chip chip-sm">{{ tasteLabel() }}</span><span class="chip chip-sm">{{ weightLabel() }}</span><span class="chip chip-sm">жирность: {{ fatLabel() }}</span><span class="chip chip-sm">{{ cookLabel() }}</span>@if (heat() > 0) { <span class="chip chip-sm">🌶 {{ heat() }}%</span> }</div>
            </div>
            <button type="button" class="btn btn-primary btn-lg btn-block mt16" (click)="finish()"><ft-icon name="sparkles" /> Подобрать пиво</button>
          }
        }
      </section>
    }
    <ft-sommelier [venue]="aiVenue()" />
  `,
  styles: [`
    .top h1 { margin-top: 8px; }
    .scan-cta { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--r-lg); background: var(--surface); border: 1.5px solid var(--line); box-shadow: var(--shadow-1); transition: transform var(--t-fast), border-color var(--t-fast); }
    .scan-cta:hover { transform: translateY(-2px); border-color: var(--amber-400); } .scan-cta > span:nth-child(2) { flex: 1; }
    .sc-ico { width: 44px; height: 44px; border-radius: 14px; background: var(--grad-amber); display: grid; place-items: center; font-size: 1.3rem; flex-shrink: 0; }
    .section-sm { margin-top: 20px; }
    .venue { display: flex; gap: 10px; align-items: center; padding: 12px 14px; font-size: .9rem; }
    .link { color: var(--amber-700); font-weight: 700; text-decoration: underline; }
    .cuisines { padding-block: 4px; }
    .custom { display: flex; align-items: center; gap: 14px; text-align: left; width: 100%; }
    .ci { width: 48px; height: 48px; border-radius: 14px; background: var(--grad-amber); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
    .custom > span:nth-child(2) { flex: 1; }
    .wiz { max-width: 640px; margin: 0 auto; }
    .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
    @media (min-width: 640px) { .opts { grid-template-columns: repeat(3, 1fr); } }
    .opt { display: grid; gap: 2px; text-align: left; padding: 14px; border-radius: var(--r-lg); background: var(--surface); border: 1.5px solid var(--line); transition: all var(--t-fast); min-height: 96px; }
    .opt:hover { border-color: var(--amber-400); transform: translateY(-2px); box-shadow: var(--shadow-1); }
    .opt.on { border-color: var(--amber-500); background: var(--amber-100); box-shadow: var(--ring); }
    .oe { font-size: 1.6rem; } .ol { font-family: var(--font-display); font-weight: 700; } .od { font-size: .74rem; color: var(--ink-3); }
    .lbl { font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); margin-bottom: 8px; }
    .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--bg-2); }
    .seg button { min-height: 44px; border-radius: 10px; font-weight: 700; color: var(--ink-2); }
    .seg button.on { background: var(--surface); color: var(--amber-800); box-shadow: var(--shadow-1); }
  `],
})
export class PairPage {
  private saas = inject(SaasService);
  /** Контекст для ИИ: если гость в заведении — только его карта, с ценами. */
  readonly aiVenue = computed<AiVenue | null>(() => {
    const v = this.venue.venue(); if (!v) return null;
    const m = this.saas.localMenu(v.id, null);
    return { slug: v.id, name: v.name, beers: m ? m.beers.map(b => b.ref_slug) : v.brands, currency: m?.venue.currency,
             prices: m ? Object.fromEntries(m.beers.map(b => [b.ref_slug, b.price])) : undefined };
  });
  data = inject(DataService);
  venue = inject(VenueService);
  private pairing = inject(PairingService);
  private router = inject(Router);

  /** ?q= с главной */
  qParam = input<string>('', { alias: 'q' });
  q = signal('');
  cuisine = signal<Cuisine | ''>('');
  onlyMenu = signal(true);
  step = signal<Step>('pick');
  taste = signal<Taste>('UMAMI'); weight = signal<Weight>('MEDIUM'); fat = signal<Fat>('MEDIUM'); cooking = signal<Cooking>('GRILLED');
  heat = signal(0); name = signal('');

  readonly cuisines = CUISINES;
  readonly tastes: { id: Taste; e: string; l: string; d: string }[] = [
    { id: 'UMAMI', e: '🍖', l: 'Мясное · умами', d: 'мясо, бульон, сыр' }, { id: 'SALTY', e: '🧂', l: 'Солёное', d: 'закуски, колбасы' },
    { id: 'SPICY', e: '🌶️', l: 'Острое', d: 'перец, чили, карри' }, { id: 'SWEET', e: '🍰', l: 'Сладкое', d: 'десерт, выпечка' },
    { id: 'SOUR', e: '🍋', l: 'Кислое', d: 'салаты, соленья' }, { id: 'MIXED', e: '🥘', l: 'Микс', d: 'сладко-солёное' },
  ];
  readonly weights: { id: Weight; l: string }[] = [{ id: 'LIGHT', l: 'Лёгкое' }, { id: 'MEDIUM', l: 'Среднее' }, { id: 'HEAVY', l: 'Сытное' }];
  readonly fats: { id: Fat; l: string }[] = [{ id: 'LOW', l: 'Низкая' }, { id: 'MEDIUM', l: 'Средняя' }, { id: 'HIGH', l: 'Высокая' }];
  readonly cooks: { id: Cooking; e: string; l: string }[] = [
    { id: 'GRILLED', e: '🔥', l: 'Гриль / угли' }, { id: 'FRIED', e: '🍳', l: 'Жарка' }, { id: 'BAKED', e: '🥧', l: 'Запекание' },
    { id: 'BOILED', e: '🍲', l: 'Варка / тушение' }, { id: 'STEAMED', e: '♨️', l: 'На пару' }, { id: 'RAW', e: '🥗', l: 'Сырое / салат' },
    { id: 'CURED', e: '🥓', l: 'Вяленое / копчёное' }, { id: 'FERMENTED', e: '🫙', l: 'Ферментация' }, { id: 'OTHER', e: '🍽️', l: 'Другое' },
  ];

  hits = computed(() => this.pairing.searchDishes(this.q(), 10));
  list = computed<Dish[]>(() => {
    let l = this.data.dishes();
    const menu = this.venue.menuIds();
    if (menu && this.onlyMenu()) l = l.filter(d => menu.includes(d.id));
    if (this.cuisine()) l = l.filter(d => d.cuisine === this.cuisine());
    return l;
  });
  stepIdx = computed(() => ({ pick: 0, taste: 1, body: 2, cook: 3, final: 4 })[this.step()]);
  progress = computed(() => this.stepIdx() * 25);
  heatLabel = computed(() => (this.heat() === 0 ? 'не острое' : this.heat() < 40 ? 'слегка' : this.heat() < 75 ? 'заметно' : 'огонь 🔥'));
  tasteLabel = computed(() => TASTE_LABELS[this.taste()]); weightLabel = computed(() => WEIGHT_LABELS[this.weight()]);
  fatLabel = computed(() => FAT_LABELS[this.fat()]); cookLabel = computed(() => COOKING_LABELS[this.cooking()]);

  constructor() { queueMicrotask(() => { if (this.qParam()) this.q.set(this.qParam()); }); }

  go(d: Dish): void { this.router.navigate(['/pair', d.id]); }
  enter(): void { const h = this.hits()[0]; if (h) this.go(h.dish); }
  startCustom(): void { if (this.q().trim()) this.name.set(this.q().trim()); this.step.set('taste'); window.scrollTo({ top: 0 }); }
  next(s: Step): void { this.step.set(s); }
  back(): void { const order: Step[] = ['pick', 'taste', 'body', 'cook', 'final']; this.step.set(order[Math.max(0, this.stepIdx() - 1)]); }
  finish(): void {
    this.router.navigate(['/pair', 'custom'], { queryParams: { taste: this.taste(), weight: this.weight(), fat: this.fat(), cooking: this.cooking(), heat: this.heat() || null, name: this.name() || null } });
  }
}
