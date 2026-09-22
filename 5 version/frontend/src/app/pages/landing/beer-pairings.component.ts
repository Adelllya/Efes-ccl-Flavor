import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Brand, Dish, FoodIcon, FoodPairing, PairingType } from '../../models/flavor-tree.models';
import { COOKING, TASTES, CATEGORIES, bigImage, smallImage } from './pairing-engine.data';

const PAIRING_LABEL: Record<string, string> = {
  COMPLEMENT: 'Дополняет', CONTRAST: 'Контраст', CLEANSE: 'Очищает', BRIDGE: 'Мостик',
};

const PAIRING_HINT: Record<string, string> = {
  COMPLEMENT: 'Похожие вкусы усиливают друг друга',
  CONTRAST: 'Противоположности уравновешиваются',
  CLEANSE: 'Пиво освежает после тяжёлого или острого',
  BRIDGE: 'У пива и блюда есть общая нота',
};

interface PairCard {
  pairing: FoodPairing;
  label: string;
  hint: string;
  photo: string | null;
  marks: { key: string; label: string; emoji: string; image: string | null }[];
}

/**
 * Ветка «у меня есть пиво»: витрина сортов, затем пары к выбранному.
 *
 * Сорт человек знает по названию, поэтому первый шаг — не опросник, а
 * полка с бутылками. На втором шаге слева стоит напиток, справа — блюда
 * карточками: с оценкой, объяснением сомелье целиком и значками того,
 * за счёт чего пара работает.
 */
@Component({
  selector: 'app-beer-pairings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="bp">
      <div class="bp-head">
        <button type="button" class="bp-back" (click)="goBack()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          {{ selected() ? 'Выбрать другой сорт' : 'Назад' }}
        </button>

        <nav class="bp-bar" aria-label="Шаги подбора">
          <span class="bp-seg" [class.on]="!selected()" [class.done]="!!selected()"></span>
          <span class="bp-seg" [class.on]="!!selected()"></span>
        </nav>

        <span class="bp-step">Шаг {{ selected() ? 2 : 1 }} из 2</span>
      </div>

      <!-- ── Шаг 1: витрина сортов ── -->
      @if (!selected()) {
        <header class="bp-ask">
          <h2 class="section-header">Что у тебя <span class="bp-accent">в бокале?</span></h2>
          <p class="section-subtitle">Выбери сорт — покажем блюда, которые к нему подходят, и объясним почему</p>
        </header>

        <div class="bp-find">
          <svg class="bp-find-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <label class="sr-only" for="bp-search">Поиск сорта</label>
          <input
            id="bp-search"
            class="input bp-input"
            type="search"
            placeholder="Efes Pilsener, Kozel, Хмельной Лось…"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
        </div>

        <div class="bp-packs" role="group" aria-label="Тип упаковки">
          @for (p of packs; track p.id) {
            <button type="button" class="bp-pack" [class.on]="pack() === p.id" (click)="pack.set(p.id)">{{ p.label }}</button>
          }
        </div>

        @if (!visible().length) {
          <p class="bp-empty">Такого сорта не нашли. Проверьте написание или уберите фильтр.</p>
        } @else {
          <div class="bp-grid">
            @for (b of visible(); track b.id; let i = $index) {
              <button type="button" class="glass-card bp-card" [style.--i]="i" (click)="select(b)">
                <span class="bp-card-visual">
                  @if (small(b); as src) {
                    <img [src]="src" [alt]="b.name" loading="lazy" />
                  } @else {
                    <span class="bp-card-fallback" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v3.5l2 3V21a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8.5l2-3V2Z"/><path d="M8 12h8"/></svg></span>
                  }
                </span>
                <span class="bp-card-name">{{ b.name }}</span>
                <span class="bp-card-style">{{ b.style }}@if (b.abv) { · {{ b.abv }}% }</span>
                <span class="bp-card-go">Выбрать →</span>
              </button>
            }
          </div>
        }
      }

      <!-- ── Шаг 2: пары к сорту ── -->
      @if (selected(); as b) {
        <div class="bp-layout">
          <aside class="glass-card bp-drink" [style.--brand-soft]="accentSoft()">
            <span class="bp-halo" aria-hidden="true"></span>

            <span class="bp-bottle">
              @if (big(b); as src) {
                <img [src]="src" [alt]="'Бутылка ' + b.name" />
              } @else {
                <span class="bp-card-fallback" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v3.5l2 3V21a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8.5l2-3V2Z"/><path d="M8 12h8"/></svg></span>
              }
            </span>

            <span class="badge mb-xs">{{ b.tagline || b.brand_owner || 'Ваш сорт' }}</span>
            <h3 class="bp-drink-name">{{ b.name }}</h3>
            <p class="text-sm text-muted">{{ b.style }}@if (b.abv) { · {{ b.abv }}% алк. }</p>

            @if (b.description) { <p class="text-sm text-dim bp-drink-desc">{{ b.description }}</p> }

            @if (b.serving_recommendation; as rec) {
              <p class="text-xs text-muted bp-serve">
                Подавать при {{ rec.serving_temp_min }}–{{ rec.serving_temp_max }} °C, {{ rec.glass_type }}
              </p>
            }

            <button type="button" class="btn-amber bp-more" (click)="openBrand.emit(b.id)">
              Узнать больше о напитке
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
            </button>
          </aside>

          <div class="bp-list">
            <header class="bp-list-head">
              <h3 class="section-header bp-list-title">Что к нему подать</h3>
              @if (intro) { <p class="text-muted">{{ intro }}</p> }
            </header>

            @if (!cards().length) {
              <div class="bp-none">
                <p class="text-dim">Для этого сорта пары пока не описаны.</p>
                <p class="text-sm text-muted">Их заполняет сомелье в своей панели — как только появятся, они будут здесь.</p>
              </div>
            } @else {
              <div class="bp-cards">
                @for (c of cards(); track c.pairing.id; let i = $index) {
                  <article class="glass-card bp-pair" [style.--i]="i">
                    <div class="bp-duo" aria-hidden="true">
                      <span class="bp-duo-dish">
                        @if (c.photo) {
                          <img [src]="c.photo" alt="" loading="lazy" />
                        } @else {
                          <span class="bp-duo-emoji">{{ c.marks[0]?.emoji || '🍽️' }}</span>
                        }
                      </span>

                      <span class="bp-duo-beer">
                        @if (small(b); as src) {
                          <img [src]="src" alt="" loading="lazy" />
                        } @else {
                          <span class="bp-duo-emoji">🍺</span>
                        }
                      </span>
                    </div>

                    <div class="bp-pair-body">
                      <div class="bp-pair-top">
                        <h4 class="bp-pair-name">{{ c.pairing.dish_name }}</h4>
                        <span class="bp-score" [attr.aria-label]="'Совместимость ' + c.pairing.compatibility_score + ' из 5'">
                          @for (s of [1,2,3,4,5]; track s) {
                            <span class="bp-pip" [class.on]="s <= c.pairing.compatibility_score"></span>
                          }
                        </span>
                      </div>

                      <span class="badge">{{ c.label }}</span>
                      <p class="bp-why">«{{ c.pairing.explanation }}»</p>
                      <p class="text-xs text-muted">{{ c.hint }}</p>

                      @if (c.marks.length) {
                        <ul class="bp-marks">
                          @for (m of c.marks; track m.key) {
                            <li class="bp-mark">
                              <span class="bp-mark-face">
                                @if (m.image) {
                                  <img [src]="m.image" alt="" loading="lazy" />
                                } @else {
                                  <span aria-hidden="true">{{ m.emoji }}</span>
                                }
                              </span>
                              {{ m.label }}
                            </li>
                          }
                        </ul>
                      }
                    </div>
                  </article>
                }
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .bp-head {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-md);
      margin-bottom: var(--space-2xl);
    }

    .bp-back {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      padding: 0 14px;
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
    .bp-back:hover { color: var(--beer-mid); background: var(--beer-glow); }

    .bp-bar { display: flex; gap: var(--space-sm); }
    .bp-seg { width: clamp(60px, 11vw, 108px); height: 7px; border-radius: var(--radius-full); background: rgba(180, 83, 9, 0.16); }
    .bp-seg.done { background: rgba(180, 83, 9, 0.4); }
    .bp-seg.on { background: linear-gradient(90deg, var(--beer-accent), var(--beer-mid)); }

    .bp-step { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }

    .bp-ask { text-align: center; margin-bottom: var(--space-2xl); }
    .bp-ask .section-header { margin-bottom: var(--space-sm); }
    .bp-accent {
      background: linear-gradient(120deg, var(--beer-light), var(--beer-deep));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    /* ── Поиск и фильтры ── */
    .bp-find { position: relative; width: min(560px, 100%); margin: 0 auto var(--space-lg); }
    .bp-find-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
    .bp-input { padding-left: 44px; height: 52px; }

    .bp-packs { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-sm); margin-bottom: var(--space-2xl); }

    .bp-pack {
      min-height: 40px;
      padding: 0 18px;
      border-radius: var(--radius-full);
      border: 1.5px solid var(--line);
      background: var(--glass);
      color: var(--foam-dim);
      font-family: var(--font-body);
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--duration-normal) ease;
    }
    .bp-pack:hover { border-color: rgba(180, 83, 9, 0.3); color: var(--foam); }
    .bp-pack.on {
      background: linear-gradient(155deg, var(--beer-accent), var(--beer-mid));
      border-color: transparent;
      color: #fff;
      font-weight: 700;
    }

    /* ── Витрина ── */
    .bp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: var(--space-lg); }

    .bp-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: var(--space-xl) var(--space-lg) var(--space-2xl);
      text-align: center;
      /* Кнопка «Выбрать» прижата вниз через .bp-card-go { margin-top: auto } */
      justify-content: flex-start;
      cursor: pointer;
      animation: bpRise 420ms var(--ease-out) both;
      animation-delay: calc(var(--i, 0) * 45ms);
      transition: transform var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) ease;
    }
    .bp-card:hover { transform: translateY(-8px); box-shadow: var(--shadow-hover); }

    @keyframes bpRise {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: none; }
    }

    .bp-card-visual {
      position: relative;
      display: block;
      width: 100%;
      height: 150px;
      overflow: hidden;
      border-radius: var(--radius-md);
      /* Тёплая «полка» под бутылкой, как в каталоге сортов. */
      background: radial-gradient(ellipse 58% 26% at 50% 96%, rgba(180, 83, 9, 0.14), transparent 70%);
    }
    .bp-card-visual img {
      position: absolute;
      inset: 6px;
      width: auto;
      height: auto;
      max-width: calc(100% - 12px);
      max-height: calc(100% - 12px);
      margin: auto;
      object-fit: contain;
      transform: scale(1.22);
      filter: drop-shadow(0 10px 12px rgba(69, 26, 3, 0.26));
    }
    .bp-card-fallback { color: var(--beer-mid); opacity: 0.35; }
    .bp-card-fallback svg { width: 48px; height: 48px; }

    /* Две строки максимум: иначе у длинных названий кнопка уезжает вниз. */
    .bp-card-name {
      font-family: var(--font-heading);
      font-size: 1rem;
      font-weight: 700;
      line-height: 1.25;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .bp-card-style { font-size: 0.78rem; color: var(--muted); }

    .bp-card-go {
      margin-top: auto;
      padding: 7px 18px;
      border-radius: var(--radius-full);
      background: var(--beer-glow);
      color: var(--beer-deep);
      font-size: 0.76rem;
      font-weight: 800;
      transition: all var(--duration-normal) ease;
    }
    .bp-card:hover .bp-card-go {
      background: linear-gradient(155deg, var(--beer-accent), var(--beer-mid));
      color: #fff;
    }

    .bp-empty { padding: var(--space-6xl); text-align: center; color: var(--muted); }

    /* ── Пары: напиток слева, блюда справа ── */
    .bp-layout { display: grid; grid-template-columns: minmax(260px, 32%) 1fr; gap: var(--space-3xl); align-items: start; }

    .bp-drink {
      position: sticky;
      top: 100px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: var(--space-2xl) var(--space-xl);
      text-align: center;
      background:
        radial-gradient(110% 80% at 50% 6%, var(--brand-soft), transparent 62%),
        var(--glass-strong);
      animation: bpRise var(--duration-slow) var(--ease-out) both;
    }

    .bp-halo {
      position: absolute;
      top: 3%;
      width: min(80%, 250px);
      aspect-ratio: 1;
      border-radius: 50%;
      background: radial-gradient(circle, var(--brand-soft), transparent 70%);
      pointer-events: none;
    }

    .bp-bottle {
      position: relative;
      z-index: 1;
      display: block;
      width: 100%;
      height: 230px;
      overflow: hidden;
      margin-bottom: var(--space-md);
    }
    .bp-bottle img { position: absolute; inset: 6px; width: auto; height: auto; max-width: calc(100% - 12px); max-height: calc(100% - 12px); margin: auto; object-fit: contain; }

    .bp-drink-name { font-size: 1.5rem; }
    .bp-drink-desc { line-height: 1.55; }
    .bp-serve { padding-top: var(--space-md); border-top: 1px solid var(--line-subtle); width: 100%; }
    .bp-more { margin-top: var(--space-md); }

    .bp-list-head { margin-bottom: var(--space-xl); }
    .bp-list-title { font-size: 1.9rem; margin-bottom: var(--space-xs); }

    .bp-cards { display: grid; gap: var(--space-lg); }

    .bp-pair {
      display: grid;
      grid-template-columns: 148px 1fr;
      gap: var(--space-lg);
      align-items: center;
      padding: var(--space-lg);
      animation: bpRise 460ms var(--ease-out) both;
      animation-delay: calc(var(--i, 0) * 70ms);
      transition: transform var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) ease;
    }
    .bp-pair:hover { transform: translateY(-4px); box-shadow: var(--shadow-hover); }

    /* ── Пара в лицах: слева блюдо, справа напиток ──
       Тот же приём, что на плакатах о гастропарах: два предмета рядом
       читаются как сочетание быстрее любой подписи. */
    .bp-duo {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      width: 148px;
      height: 124px;
    }

    .bp-duo-dish {
      position: relative;
      display: grid;
      place-items: center;
      width: 96px;
      height: 96px;
      border-radius: 50%;
      background: var(--beer-glow);
      border: 1px solid var(--line-subtle);
      overflow: hidden;
      flex: 0 0 auto;
    }
    .bp-duo-dish img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

    .bp-duo-beer {
      position: relative;
      display: grid;
      place-items: center;
      width: 62px;
      height: 114px;
      margin-left: -16px;
      flex: 0 0 auto;
    }
    .bp-duo-beer img {
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

    .bp-duo-emoji { font-size: 2.3rem; line-height: 1; }

    .bp-pair-body { display: flex; flex-direction: column; gap: 7px; align-items: flex-start; min-width: 0; }
    .bp-pair-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); width: 100%; }
    .bp-pair-name { font-size: 1.05rem; font-weight: 700; }

    .bp-score { display: flex; gap: 4px; flex-shrink: 0; }
    .bp-pip { width: 18px; height: 5px; border-radius: var(--radius-full); background: rgba(180, 83, 9, 0.18); }
    .bp-pip.on { background: linear-gradient(90deg, var(--beer-accent), var(--beer-mid)); }

    .bp-why { font-size: 0.95rem; line-height: 1.55; font-style: italic; color: var(--foam); }

    .bp-marks { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-top: 4px; list-style: none; }

    .bp-mark {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 12px 3px 4px;
      border-radius: var(--radius-full);
      background: var(--glass);
      border: 1px solid var(--line);
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--foam-dim);
    }
    .bp-mark-face {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #fff;
      border: 1px solid var(--line-subtle);
      overflow: hidden;
      font-size: 0.9rem;
    }
    .bp-mark-face img { width: 100%; height: 100%; object-fit: cover; }

    .bp-none {
      padding: var(--space-5xl);
      text-align: center;
      border: 1.5px dashed var(--line);
      border-radius: var(--radius-xl);
    }

    @media (max-width: 900px) {
      .bp-layout { grid-template-columns: 1fr; }
      .bp-drink { position: static; }
    }

    @media (max-width: 560px) {
      .bp-pair { grid-template-columns: 1fr; }
      .bp-duo { width: 100%; height: 140px; }
      .bp-back { align-self: center; }
    }

    @media (prefers-reduced-motion: reduce) {
      .bp-card, .bp-pair, .bp-drink { animation: none; }
    }
  `],
})
export class BeerPairingsComponent {
  @Input() brands: Brand[] = [];
  @Input() pairings: FoodPairing[] = [];
  @Input() dishes: Dish[] = [];
  @Input() icons: FoodIcon[] = [];
  @Input() intro = '';
  /** Минимальная оценка пары — приходит из настроек витрины. */
  @Input() minScore = 1;

  @Output() openBrand = new EventEmitter<string>();
  @Output() exit = new EventEmitter<void>();

  readonly packs = [
    { id: '', label: 'Все' },
    { id: 'BOTTLE', label: 'Бутылка' },
    { id: 'CAN', label: 'Банка' },
    { id: 'DRAFT', label: 'Разливное' },
  ];

  selected = signal<Brand | null>(null);
  query = signal('');
  pack = signal('');

  readonly big = bigImage;
  readonly small = smallImage;

  visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const p = this.pack();
    return this.brands.filter(b => {
      if (b.is_active === false) return false;
      if (p && b.packaging_type !== p) return false;
      if (q && !`${b.name} ${b.style}`.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  /** Свечение в цвете сорта, заданном в админке. */
  accentSoft = computed(() => {
    const hex = this.selected()?.accent_color?.trim();
    if (!hex || !/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(hex)) return 'rgba(245, 158, 11, 0.18)';
    const full = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(full.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, 0.3)`;
  });

  cards = computed<PairCard[]>(() => {
    const brand = this.selected();
    if (!brand) return [];
    const byId = new Map(this.dishes.map(d => [d.id, d]));
    const byName = new Map(this.dishes.map(d => [d.name.toLowerCase(), d]));

    return this.pairings
      .filter(p => (p.brand === brand.id || p.brand_name === brand.name) && p.compatibility_score >= this.minScore)
      .sort((a, b) => b.compatibility_score - a.compatibility_score)
      .map(p => {
        const dish = byId.get(p.dish) ?? byName.get((p.dish_name ?? '').toLowerCase()) ?? null;
        return {
          pairing: p,
          label: PAIRING_LABEL[p.pairing_type] ?? p.pairing_type,
          hint: PAIRING_HINT[p.pairing_type] ?? '',
          photo: dish?.image || null,
          marks: this.marksFor(dish),
        };
      });
  });

  select(brand: Brand): void {
    this.selected.set(brand);
    window.scrollTo({ top: Math.max(0, window.scrollY - 200), behavior: 'smooth' });
  }

  goBack(): void {
    if (this.selected()) { this.selected.set(null); return; }
    this.exit.emit();
  }

  /**
   * Значки под объяснением: способ приготовления, вкус и категория блюда —
   * именно они объясняют пару. Картинка берётся из админки, emoji остаётся
   * запасным вариантом.
   */
  private marksFor(dish: Dish | null) {
    if (!dish) return [];
    const out: { key: string; label: string; emoji: string; image: string | null }[] = [];

    const add = (kind: string, key: string | undefined, list: readonly { id: string; emoji: string; label: string }[]) => {
      if (!key) return;
      const from = list.find(x => x.id === key);
      const icon = this.icons.find(i => i.kind === kind && i.key === key);
      if (!from && !icon) return;
      out.push({
        key: `${kind}:${key}`,
        label: icon?.label || from?.label || key,
        emoji: from?.emoji ?? '',
        image: icon?.image ?? null,
      });
    };

    add('COOKING', dish.cooking_method, COOKING);
    add('TASTE', dish.dominant_taste, TASTES);
    add('CATEGORY', this.categoryKey(dish), CATEGORIES);
    return out;
  }

  /** Категория блюда в базе — свободный текст, сводим её к коду мастера. */
  private categoryKey(dish: Dish): string | undefined {
    const text = `${dish.name} ${dish.category ?? ''}`.toLowerCase();
    const rules: [string, RegExp][] = [
      ['MEAT', /мяс|стейк|шашлык|рёбр|ребр|колбас|шницел/],
      ['SEAFOOD', /рыб|морепрод|суши|креветк|лосос/],
      ['DESSERT', /десерт|торт|пирож|шокол|тирамису/],
      ['SALAD', /салат|овощ/],
      ['SOUP', /суп|рагу|бульон|лапша/],
      ['PIZZA', /пицц|паст|спагетт/],
      ['STREET', /бургер|тако|шаурм|самса/],
      ['SNACK', /снек|тапас|сыр|орех|брецел|крендел/],
    ];
    return rules.find(([, re]) => re.test(text))?.[0];
  }
}
