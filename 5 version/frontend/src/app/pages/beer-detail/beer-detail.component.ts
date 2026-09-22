import { Component, EventEmitter, OnInit, Output, computed, effect, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { SelectionService } from '../../services/selection.service';
import { Brand, Dish, FoodPairing, PyramidNoteItem } from '../../models/flavor-tree.models';
import { CATEGORIES, COOKING, TASTES, bigImage, smallImage } from '../landing/pairing-engine.data';

const PAIRING_LABEL: Record<string, string> = {
  COMPLEMENT: 'Дополняет', CONTRAST: 'Контраст', CLEANSE: 'Очищает', BRIDGE: 'Мостик',
};

/**
 * Места для вкусов вокруг бутылки — своя раскладка на каждое число нот.
 *
 * Общий список не годится: у сорта с тремя нотами занялись бы первые три
 * места, и все кружки сбились бы в один угол. Здесь каждая раскладка
 * симметрична сама по себе. Левый край не ближе 10 %, иначе кружок
 * вылезает из колонки и наезжает на текст.
 *
 * sway — своя длительность покачивания, иначе кружки колышутся строем.
 */
const ORBIT_LAYOUTS: Record<number, { top: number; left: number; sway: number }[]> = {
  1: [{ top: 18, left: 84, sway: 6.4 }],
  2: [
    { top: 16, left: 14, sway: 6.4 },
    { top: 16, left: 86, sway: 7.2 },
  ],
  3: [
    { top: 10, left: 16, sway: 6.4 },
    { top: 10, left: 84, sway: 7.2 },
    { top: 66, left: 86, sway: 5.8 },
  ],
  4: [
    { top: 8,  left: 14, sway: 6.4 },
    { top: 8,  left: 86, sway: 7.2 },
    { top: 66, left: 12, sway: 5.8 },
    { top: 66, left: 88, sway: 6.9 },
  ],
  5: [
    { top: 6,  left: 16, sway: 6.4 },
    { top: 4,  left: 82, sway: 7.2 },
    { top: 38, left: 10, sway: 5.8 },
    { top: 40, left: 90, sway: 6.9 },
    { top: 74, left: 78, sway: 7.6 },
  ],
  6: [
    { top: 6,  left: 16, sway: 6.4 },
    { top: 4,  left: 82, sway: 7.2 },
    { top: 38, left: 10, sway: 5.8 },
    { top: 40, left: 90, sway: 6.9 },
    { top: 74, left: 14, sway: 7.6 },
    { top: 74, left: 84, sway: 6.1 },
  ],
};

const MAX_ORBIT = 6;

/**
 * Страница одного сорта.
 *
 * Слева паспорт напитка, справа бутылка в кольце собственных вкусов:
 * каждая нота — отдельный кружок с фото ингредиента из админки. Цвет
 * подложки тоже приходит из админки, поэтому у каждого сорта свой
 * характер при одной и той же вёрстке.
 */
@Component({
  selector: 'app-beer-detail',
  standalone: true,
  template: `
    @if (loading()) {
      <div class="glass-panel bd-skeleton"></div>
    } @else {
      @if (brand(); as b) {
      <button type="button" class="bd-back" (click)="back.emit()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Все сорта
      </button>

      <!-- ── Витрина сорта ── -->
      <section class="glass-panel bd-hero" [style.--brand-soft]="accentSoft()">
        <div class="bd-body">
          <span class="badge badge-accent mb-xs">{{ b.tagline || b.brand_owner || 'Flavor Tree' }}</span>
          <h1 class="bd-title">{{ b.name }}</h1>

          @if (b.description) { <p class="bd-desc text-dim">{{ b.description }}</p> }

          <dl class="bd-specs">
            <div class="bd-row"><dt>Тип</dt><dd>{{ b.packaging_type_display || b.packaging_type }}</dd></div>
            <div class="bd-row"><dt>Стиль</dt><dd>{{ b.style }}</dd></div>
            @if (b.abv) { <div class="bd-row"><dt>Алкоголь</dt><dd>{{ b.abv }} %</dd></div> }
            @if (b.density) { <div class="bd-row"><dt>Плотность</dt><dd>{{ b.density }}</dd></div> }
            @if (b.fermentation_type) { <div class="bd-row"><dt>Брожение</dt><dd>{{ b.fermentation_type }}</dd></div> }
          </dl>

          @if (b.serving_recommendation; as rec) {
            <div class="bd-serve">
              <div><span class="bd-serve-label">Температура</span><span class="bd-serve-value">{{ rec.serving_temp_min }}–{{ rec.serving_temp_max }} °C</span></div>
              <div><span class="bd-serve-label">Бокал</span><span class="bd-serve-value">{{ rec.glass_type }}</span></div>
              @if (rec.seasonality) {
                <div><span class="bd-serve-label">Сезон</span><span class="bd-serve-value">{{ rec.seasonality }}</span></div>
              }
            </div>
          }

          @if (b.is_horeca_only) { <span class="badge badge-horeca">Только в заведениях</span> }
        </div>

        <div class="bd-visual">
          <span class="bd-halo" aria-hidden="true"></span>

          <span class="bd-bottle">
            @if (photo(b); as src) {
              <img [src]="src" [alt]="'Бутылка ' + b.name" />
            } @else {
              <span class="bd-fallback" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v3.5l2 3V21a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8.5l2-3V2Z"/><path d="M8 12h8"/></svg>
              </span>
            }
          </span>

          @if (orbit().length) {
            <ul class="bd-orbit">
              @for (n of orbit(); track n.id; let i = $index) {
                <li class="bd-taste" [style.--i]="i" [style.top.%]="n.pos.top" [style.left.%]="n.pos.left" [style.--sway]="n.pos.sway + 's'">
                  <span class="bd-taste-face">
                    @if (n.image) {
                      <img [src]="n.image" [alt]="n.name" loading="lazy" />
                    } @else {
                      <span class="bd-taste-emoji" aria-hidden="true">{{ n.icon }}</span>
                    }
                  </span>
                  <span class="bd-taste-label">
                    <span class="bd-taste-name">{{ n.name }}</span>
                    <span class="bd-taste-int">{{ n.intensity }}/10</span>
                  </span>
                </li>
              }
            </ul>
          }
        </div>
      </section>

      <!-- ── Пирамида ── -->
      <section class="bd-section">
        <span class="badge mb-xs">Вкусовая пирамида</span>
        <h2 class="section-header">Как раскрывается глоток</h2>
        <p class="section-subtitle">Три слоя по времени: аромат, тело и послевкусие. Цифра — насколько нота выражена, от 1 до 10.</p>

        @if (hasPyramid()) {
          <div class="bd-layers">
            @for (layer of layers(); track layer.key) {
              <article class="glass-card bd-layer">
                <div class="bd-layer-head">
                  <h3>{{ layer.name }}</h3>
                  <span class="badge">{{ layer.time }}</span>
                </div>

                @if (layer.notes.length) {
                  <ul class="bd-notes">
                    @for (n of layer.notes; track n.id) {
                      <li class="bd-note">
                        <div class="bd-note-top">
                          <span class="font-bold">{{ n.name }}</span>
                          <span class="text-sm text-beer font-bold">{{ n.intensity }}/10</span>
                        </div>
                        <div class="progress-track" role="img" [attr.aria-label]="n.name + ': интенсивность ' + n.intensity + ' из 10'">
                          <div class="progress-fill" [style.width.%]="n.intensity * 10"></div>
                        </div>
                        @if (n.technical_term) { <span class="text-xs text-muted italic">{{ n.technical_term }}</span> }
                        @if (n.sommelier_note) { <span class="text-sm text-dim">«{{ n.sommelier_note }}»</span> }
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="text-sm text-muted">Этот слой ещё не заполнен сомелье.</p>
                }
              </article>
            }
          </div>
        } @else {
          <div class="glass-card bd-empty">
            <p class="text-dim">Пирамида этого сорта ещё не заполнена.</p>
            <p class="text-sm text-muted">Её заполняет сомелье в своей панели после дегустации.</p>
          </div>
        }
      </section>

      <!-- ── Пары ── -->
      <section class="bd-section">
        <span class="badge mb-xs">Гастрономия</span>
        <h2 class="section-header">С чем подавать</h2>

        @if (pairings().length) {
          <div class="bd-pairs">
            @for (p of pairings(); track p.id; let i = $index) {
              <article class="glass-card bd-pair" [style.--i]="i">
                <div class="bd-duo" aria-hidden="true">
                  <span class="bd-duo-dish">
                    @if (dishPhoto(p.dish); as src) {
                      <img [src]="src" alt="" loading="lazy" />
                    } @else {
                      <span class="bd-duo-emoji">{{ dishEmoji(p.dish, p.dish_name) }}</span>
                    }
                  </span>

                  <span class="bd-duo-beer">
                    @if (thumb(b); as src) {
                      <img [src]="src" alt="" loading="lazy" />
                    } @else {
                      <span class="bd-duo-emoji">🍺</span>
                    }
                  </span>
                </div>

                <div class="bd-pair-top">
                  <h3>{{ p.dish_name }}</h3>
                  <span class="badge">{{ p.compatibility_score }}/5</span>
                </div>
                <span class="badge badge-accent">{{ label(p.pairing_type) }}</span>
                <p class="text-sm text-dim">{{ p.explanation }}</p>
              </article>
            }
          </div>
        } @else {
          <div class="glass-card bd-empty">
            <p class="text-dim">Для этого сорта пары пока не описаны.</p>
          </div>
        }
      </section>
      } @else {
        <div class="glass-card bd-empty">
          <p class="text-dim">Сорт не выбран — откройте его из каталога или подбора.</p>
        </div>
      }
    }
  `,
  styles: [`
    :host { display: block; }

    .bd-skeleton { height: 420px; }

    .bd-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      padding: 0 14px;
      margin-bottom: var(--space-lg);
      border: none;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--foam-dim);
      font-family: var(--font-body);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: background var(--duration-fast) ease, color var(--duration-fast) ease;
    }
    .bd-back:hover { color: var(--beer-mid); background: var(--beer-glow); }

    /* ── Витрина ── */
    .bd-hero {
      display: grid;
      grid-template-columns: minmax(300px, 46%) 1fr;
      gap: var(--space-5xl);
      align-items: center;
      padding: var(--space-5xl);
      margin-bottom: var(--space-6xl);
      background:
        radial-gradient(120% 120% at 88% 12%, var(--brand-soft), transparent 62%),
        var(--glass-strong);
      animation: bdRise var(--duration-slow) var(--ease-out) both;
    }

    @keyframes bdRise {
      from { opacity: 0; transform: translateY(18px); }
      to   { opacity: 1; transform: none; }
    }

    .bd-body { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-lg); }
    .bd-title { font-size: clamp(2.2rem, 5vw, 3.6rem); }
    .bd-desc { line-height: 1.65; }

    .bd-specs { width: 100%; display: flex; flex-direction: column; }
    .bd-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-lg);
      padding: 11px 0;
      border-bottom: 1px solid var(--line-subtle);
    }
    .bd-row:first-child { border-top: 1px solid var(--line-subtle); }
    .bd-row dt { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
    .bd-row dd { font-family: var(--font-heading); font-size: 1rem; font-weight: 700; text-align: right; }

    .bd-serve { display: flex; flex-wrap: wrap; gap: var(--space-3xl); width: 100%; }
    .bd-serve > div { display: flex; flex-direction: column; gap: 2px; }
    .bd-serve-label { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; color: var(--muted); }
    .bd-serve-value { font-size: 1rem; font-weight: 600; }

    /* ── Бутылка и вкусы вокруг ── */
    .bd-visual { position: relative; display: grid; place-items: center; min-height: clamp(320px, 38vw, 460px); }

    .bd-halo {
      position: absolute;
      width: min(94%, 440px);
      aspect-ratio: 1;
      border-radius: 50%;
      background: radial-gradient(circle, var(--brand-soft), transparent 70%);
      pointer-events: none;
      animation: bdHalo 7s ease-in-out infinite alternate;
    }
    @keyframes bdHalo {
      from { transform: scale(0.94); opacity: 0.75; }
      to   { transform: scale(1.06); opacity: 1; }
    }

    /* Картинка прижата к рамке абсолютно: в grid строка тянется под
       содержимое, и max-height в процентах бутылку не удерживает. */
    .bd-bottle {
      position: relative;
      z-index: 2;
      display: block;
      width: min(100%, 360px);
      height: clamp(320px, 36vw, 460px);
      animation: bdBottle var(--duration-slow) var(--ease-spring) both 120ms;
    }
    /* Эллипс-тень под бутылкой: без неё фото висит в воздухе. */
    .bd-bottle::after {
      content: '';
      position: absolute;
      left: 50%;
      bottom: 6px;
      width: 52%;
      height: 26px;
      transform: translateX(-50%);
      border-radius: 50%;
      background: radial-gradient(ellipse, rgba(69, 26, 3, 0.28), transparent 70%);
      filter: blur(3px);
      pointer-events: none;
    }
    .bd-bottle img {
      position: absolute;
      inset: 0;
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 100%;
      margin: auto;
      object-fit: contain;
      filter:
        drop-shadow(0 26px 34px rgba(69, 26, 3, 0.3))
        drop-shadow(0 3px 4px rgba(69, 26, 3, 0.2));
    }
    .bd-fallback { position: absolute; inset: 0; display: grid; place-items: center; color: var(--beer-mid); opacity: 0.35; }
    .bd-fallback svg { width: 96px; height: 96px; }

    @keyframes bdBottle {
      from { opacity: 0; transform: translateY(26px) scale(0.94); }
      to   { opacity: 1; transform: none; }
    }

    .bd-orbit { position: absolute; inset: 0; margin: 0; padding: 0; list-style: none; z-index: 3; }

    .bd-taste {
      position: absolute;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      width: 104px;
      margin-left: -52px;
      text-align: center;
      animation:
        bdTasteIn 520ms var(--ease-spring) both calc(260ms + var(--i) * 90ms),
        bdSway var(--sway, 6s) ease-in-out infinite alternate calc(var(--i) * 300ms);
    }

    @keyframes bdTasteIn {
      from { opacity: 0; transform: scale(0.5); }
      to   { opacity: 1; transform: none; }
    }
    @keyframes bdSway {
      from { translate: 0 -7px; }
      to   { translate: 0 7px; }
    }

    .bd-taste-face {
      position: relative;
      display: grid;
      place-items: center;
      width: 76px;
      height: 76px;
      border-radius: 50%;
      background: #fff;
      border: 1.5px solid var(--line);
      box-shadow: var(--shadow-md);
      overflow: hidden;
      transition: transform var(--duration-normal) var(--ease-spring), box-shadow var(--duration-normal) ease;
    }
    .bd-taste-face img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .bd-taste-emoji { font-size: 2rem; line-height: 1; }
    .bd-taste:hover .bd-taste-face { transform: scale(1.14); box-shadow: var(--shadow-hover); }

    .bd-taste-label {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 4px 10px;
      border-radius: var(--radius-full);
      background: var(--glass-strong);
      border: 1px solid var(--line-subtle);
    }
    .bd-taste-name { font-size: 0.7rem; font-weight: 700; line-height: 1.2; }
    .bd-taste-int { font-size: 0.64rem; font-weight: 700; color: var(--beer-mid); }

    /* ── Секции ── */
    .bd-section { margin-bottom: var(--space-6xl); }
    .bd-section .section-header { margin-bottom: var(--space-xs); }
    .bd-section .section-subtitle { margin-bottom: var(--space-2xl); }

    .bd-layers { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-xl); }
    .bd-layer { padding: var(--space-2xl); }
    .bd-layer-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); margin-bottom: var(--space-lg); }

    .bd-notes { display: flex; flex-direction: column; gap: var(--space-lg); list-style: none; }
    .bd-note { display: flex; flex-direction: column; gap: 5px; }
    .bd-note-top { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-md); }

    .bd-pairs { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-lg); }
    .bd-pair {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-sm);
      padding: var(--space-xl);
      animation: bdRise 420ms var(--ease-out) both;
      animation-delay: calc(var(--i, 0) * 60ms);
    }
    .bd-pair-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); width: 100%; }

    /* ── Пара в лицах: блюдо и этот сорт рядом ── */
    .bd-duo {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      align-self: center;
      width: 100%;
      height: 120px;
      margin-bottom: var(--space-sm);
    }

    .bd-duo-dish {
      position: relative;
      display: grid;
      place-items: center;
      width: 92px;
      height: 92px;
      border-radius: 50%;
      background: var(--beer-glow);
      border: 1px solid var(--line-subtle);
      overflow: hidden;
      flex-shrink: 0;
    }
    .bd-duo-dish img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

    .bd-duo-beer {
      position: relative;
      display: grid;
      place-items: center;
      width: 60px;
      height: 110px;
      margin-left: -16px;
      flex-shrink: 0;
    }
    .bd-duo-beer img {
      position: absolute;
      inset: 0;
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 100%;
      margin: auto;
      object-fit: contain;
      filter: drop-shadow(0 6px 14px rgba(180, 83, 9, 0.22));
    }

    .bd-duo-emoji { font-size: 2.2rem; line-height: 1; }

    .bd-empty { padding: var(--space-5xl); text-align: center; }

    @media (max-width: 900px) {
      .bd-hero { grid-template-columns: 1fr; padding: var(--space-2xl); gap: var(--space-2xl); }
      .bd-visual { min-height: 340px; }
      .bd-taste { width: 84px; margin-left: -42px; }
      .bd-taste-face { width: 58px; height: 58px; }
      .bd-taste-emoji { font-size: 1.5rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      .bd-hero, .bd-bottle, .bd-taste, .bd-halo, .bd-pair { animation: none; }
    }
  `],
})
export class BeerDetailComponent implements OnInit {
  private api = inject(ApiService);
  private selection = inject(SelectionService);

  /** «Все сорта» — возврат в каталог, маршрут выбирает AppComponent. */
  @Output() back = new EventEmitter<void>();

  brand = signal<Brand | null>(null);
  pairings = signal<FoodPairing[]>([]);
  dishes = signal<Dish[]>([]);
  loading = signal(true);

  readonly photo = bigImage;
  readonly thumb = smallImage;

  constructor() {
    // Сорт можно сменить, не покидая страницу, — перезагружаем данные.
    effect(() => {
      const id = this.selection.brandId();
      if (id) this.load(id);
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    if (!this.selection.brandId()) this.loading.set(false);
    this.api.getDishes().subscribe(d => this.dishes.set(d));
  }

  /** Фото блюда для пары — в самой паре приходит только id и название. */
  dishPhoto(dishId: string): string | null {
    return this.dishes().find(d => d.id === dishId)?.image || null;
  }

  /**
   * Пока фото блюда не загружено, показываем emoji по его характеристикам:
   * одинаковая тарелка у всех пар ничего не сообщает, а «копчёное» или
   * «острое» уже намекает, о чём речь.
   */
  dishEmoji(dishId: string, name: string): string {
    const dish = this.dishes().find(d => d.id === dishId);
    if (!dish) return '🍽️';

    const text = `${dish.name} ${dish.category ?? ''}`.toLowerCase();
    const byCategory: [string, RegExp][] = [
      ['MEAT', /мяс|стейк|шашлык|рёбр|ребр|колбас|шницел/],
      ['SEAFOOD', /рыб|морепрод|суши|креветк|лосос/],
      ['DESSERT', /десерт|торт|пирож|шокол|тирамису|штрудел/],
      ['SALAD', /салат|овощ/],
      ['SOUP', /суп|рагу|бульон|лапша/],
      ['PIZZA', /пицц|паст|спагетт/],
      ['STREET', /бургер|тако|шаурм|самса|начос/],
      ['SNACK', /снек|тапас|сыр|орех|брецел|крендел/],
    ];
    const cat = byCategory.find(([, re]) => re.test(text))?.[0];
    if (cat) return CATEGORIES.find(c => c.id === cat)?.emoji ?? '🍽️';

    return COOKING.find(c => c.id === dish.cooking_method)?.emoji
      ?? TASTES.find(t => t.id === dish.dominant_taste)?.emoji
      ?? '🍽️';
  }

  private load(id: string): void {
    this.loading.set(true);
    this.api.getBrandDetail(id).subscribe({
      next: b => { this.brand.set(b); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.api.getPairings({ brand_id: id }).subscribe(p =>
      this.pairings.set([...p].sort((a, b) => b.compatibility_score - a.compatibility_score)));
  }

  /** Цвет сорта из админки, полупрозрачный — для свечения за бутылкой. */
  accentSoft = computed(() => {
    const hex = this.brand()?.accent_color?.trim();
    if (!hex || !/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(hex)) return 'rgba(245, 158, 11, 0.2)';
    const full = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(full.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, 0.28)`;
  });

  /**
   * Самые выраженные ноты — их и показываем вокруг бутылки. Полный список
   * остаётся в пирамиде ниже: витрина должна показать характер, а не всё.
   */
  orbit = computed(() => {
    const p = this.brand()?.pyramid;
    if (!p) return [];
    const notes = [...(p.top ?? []), ...(p.heart ?? []), ...(p.base ?? [])]
      .filter(n => !n.is_off_flavour)
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, MAX_ORBIT);

    const layout = ORBIT_LAYOUTS[notes.length] ?? ORBIT_LAYOUTS[MAX_ORBIT];
    return notes.map((n, i) => ({ ...n, pos: layout[i] }));
  });

  hasPyramid = computed(() => {
    const p = this.brand()?.pyramid;
    return !!p && ((p.top?.length ?? 0) + (p.heart?.length ?? 0) + (p.base?.length ?? 0)) > 0;
  });

  layers = computed<{ key: string; name: string; time: string; notes: PyramidNoteItem[] }[]>(() => {
    const p = this.brand()?.pyramid;
    return [
      { key: 'TOP', name: 'Верхние ноты', time: '0–3 сек', notes: p?.top ?? [] },
      { key: 'HEART', name: 'Ноты сердца', time: '3–15 сек', notes: p?.heart ?? [] },
      { key: 'BASE', name: 'Базовые ноты', time: '15+ сек', notes: p?.base ?? [] },
    ];
  });

  label(type: string): string { return PAIRING_LABEL[type] ?? type; }
}
