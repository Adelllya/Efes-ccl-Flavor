import { Component, EventEmitter, Output, computed, input } from '@angular/core';
import { Brand, Dish, FoodIcon, FoodPairing, PAIRING_LABELS, PairingType } from '../../models/flavor-tree.models';
import {
  CATEGORIES, COOKING, TASTES, WEIGHTS, FATS,
  DishProfile, Recommendation, bigImage, smallImage, bodyLabel, profileTitle, recommend,
} from './pairing-engine.data';

const PAIRING_HINT: Record<string, string> = {
  COMPLEMENT: 'Похожие вкусы усиливают друг друга',
  CONTRAST: 'Противоположности уравновешиваются',
  CLEANSE: 'Пиво освежает после тяжёлого или острого',
  BRIDGE: 'У пива и блюда есть общая нота',
};

/**
 * Результат мастера: лучший сорт крупно и ещё несколько карточками.
 *
 * Сколько показывать альтернатив, задаётся в админке - для застолья
 * нужен выбор, для быстрой подсказки хватит одной строки.
 */
@Component({
  selector: 'app-dish-result',
  standalone: true,
  template: `
    <div class="dr">
      <div class="dr-head">
        <button type="button" class="dr-back" (click)="back.emit()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Изменить ответы
        </button>
        <button type="button" class="dr-back" (click)="restart.emit()">Начать заново</button>
      </div>

      <header class="dr-ask">
        <span class="badge mb-xs">Результат подбора</span>
        <h2 class="section-header">К блюду <span class="dr-accent">{{ title() }}</span></h2>
      </header>

      @if (answers().length) {
        <div class="dr-answers">
          @for (a of answers(); track a.label) {
            <span class="badge">@if (a.emoji) {<span aria-hidden="true">{{ a.emoji }}</span> }{{ a.label }}</span>
          }
        </div>
      }

      @if (!loaded()) {
        <div class="skeleton-grid" aria-busy="true" aria-label="Подбираем сорта">
          @for (i of skeletonCards; track i) {
            <div class="skeleton-card">
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
            </div>
          }
        </div>
      } @else if (!list().length) {
        <div class="dr-none">
          <p class="text-dim">Каталог сортов пока пуст - подбирать не из чего.</p>
        </div>
      } @else {
        @if (list()[0]; as best) {
          <article class="glass-card dr-best">
            <div class="dr-best-visual">
              @if (big(best.brand); as src) {
                <img [src]="src" [alt]="'Бутылка ' + best.brand.name" />
              } @else {
                <span class="dr-fallback" aria-hidden="true">🍺</span>
              }
            </div>

            <div class="dr-best-body">
              <span class="badge badge-dark">Лучший выбор</span>
              <h3 class="dr-best-name">{{ best.brand.name }}</h3>
              <p class="text-sm text-muted">{{ best.brand.style }}@if (best.brand.abv) { · {{ best.brand.abv }}% алк. }</p>

              <div class="dr-score" [attr.aria-label]="'Совместимость ' + best.rating + ' из 5'">
                @for (s of [1,2,3,4,5]; track s) {
                  <span class="dr-pip" [class.on]="s <= best.rating"></span>
                }
                <span class="dr-score-num">{{ best.rating }}/5</span>
              </div>

              <div class="dr-why">
                <span class="badge">{{ label(best.type) }}</span>
                <p class="dr-why-text">«{{ best.explanation }}»</p>
                @if (best.extra) { <p class="text-sm text-dim">{{ best.extra }}</p> }
                <p class="text-xs text-muted">
                  @if (best.bySommelier) {
                    Оценка сомелье по блюду «{{ best.basedOn }}»
                  } @else {
                    {{ hint(best.type) }}
                  }
                </p>
              </div>

              @if (best.targetBody !== null) {
                <div class="dr-weight">
                  <p class="dr-weight-title">Сытность блюда и плотность сорта</p>

                  <div class="dr-scale">
                    <span class="dr-scale-label">Блюдо</span>
                    <span class="progress-track"><span class="progress-fill" [style.width.%]="best.targetBody * 10"></span></span>
                    <span class="dr-scale-value">{{ weightLabel() }}</span>
                  </div>

                  <div class="dr-scale">
                    <span class="dr-scale-label">Сорт</span>
                    <span class="progress-track"><span class="progress-fill alt" [style.width.%]="best.body * 10"></span></span>
                    <span class="dr-scale-value">{{ body(best.body) }} тело</span>
                  </div>

                  <p class="text-xs text-muted">{{ matchNote(best) }}</p>
                </div>
              }

              @if (best.brand.serving_recommendation; as rec) {
                <p class="text-sm text-dim">
                  Подавать при {{ rec.serving_temp_min }}-{{ rec.serving_temp_max }} °C, {{ rec.glass_type }}
                </p>
              }

              <button type="button" class="btn-amber" (click)="openBrand.emit(best.brand.id)">
                Узнать больше о напитке
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
              </button>
            </div>
          </article>
        }

        @if (others().length) {
          <h4 class="dr-alt-title">Ещё подойдут</h4>
          <div class="dr-alts">
            @for (alt of others(); track alt.brand.id; let i = $index) {
              <button type="button" class="glass-card dr-alt" [style.--i]="i" (click)="openBrand.emit(alt.brand.id)">
                <span class="dr-alt-visual">
                  @if (small(alt.brand); as src) {
                    <img [src]="src" [alt]="alt.brand.name" loading="lazy" />
                  } @else {
                    <span class="dr-fallback" aria-hidden="true">🍺</span>
                  }
                </span>

                <span class="dr-alt-body">
                  <span class="dr-alt-top">
                    <span class="dr-alt-name">{{ alt.brand.name }}</span>
                    <span class="dr-score" [attr.aria-label]="'Совместимость ' + alt.rating + ' из 5'">
                      @for (s of [1,2,3,4,5]; track s) {
                        <span class="dr-pip" [class.on]="s <= alt.rating"></span>
                      }
                    </span>
                  </span>
                  <span class="text-xs text-muted">{{ alt.brand.style }}@if (alt.brand.abv) { · {{ alt.brand.abv }}% }</span>
                  <span class="badge">{{ label(alt.type) }}</span>
                  <span class="text-sm text-dim">{{ alt.explanation }}</span>
                  @if (alt.bySommelier) {
                    <span class="text-xs text-muted">Оценка сомелье по блюду «{{ alt.basedOn }}»</span>
                  }
                </span>
              </button>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .dr-head { display: flex; justify-content: space-between; gap: var(--space-md); margin-bottom: var(--space-xl); }

    .dr-back {
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
    .dr-back:hover { color: var(--beer-mid); background: var(--beer-glow); }

    .dr-ask { text-align: center; margin-bottom: var(--space-lg); }
    .dr-ask .section-header { margin-bottom: 0; }
    .dr-accent {
      background: linear-gradient(120deg, var(--beer-light), var(--beer-deep));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .dr-answers { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-sm); margin-bottom: var(--space-2xl); }

    /* ── Лучший выбор ── */
    .dr-best {
      display: grid;
      grid-template-columns: minmax(200px, 34%) 1fr;
      gap: var(--space-3xl);
      align-items: center;
      padding: var(--space-3xl);
      margin-bottom: var(--space-3xl);
      animation: drRise var(--duration-slow) var(--ease-out) both;
    }

    @keyframes drRise {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: none; }
    }

    .dr-best-visual {
      position: relative;
      display: block;
      height: 300px;
      overflow: hidden;
      background: radial-gradient(circle at 50% 45%, var(--beer-glow), transparent 68%);
    }
    .dr-best-visual img { position: absolute; inset: 6px; width: auto; height: auto; max-width: calc(100% - 12px); max-height: calc(100% - 12px); margin: auto; object-fit: contain; }
    .dr-fallback { font-size: 3.4rem; line-height: 1; }

    .dr-best-body { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-md); }
    .dr-best-name { font-size: clamp(1.8rem, 3.4vw, 2.6rem); }

    .dr-score { display: flex; align-items: center; gap: 5px; }
    .dr-pip { width: 24px; height: 6px; border-radius: var(--radius-full); background: rgba(180, 83, 9, 0.18); }
    .dr-pip.on { background: linear-gradient(90deg, var(--beer-accent), var(--beer-mid)); }
    .dr-score-num { margin-left: var(--space-sm); font-size: 0.85rem; font-weight: 700; color: var(--beer-mid); }

    .dr-why {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-sm);
      padding: var(--space-lg);
      border-left: 3px solid var(--beer-accent);
      background: var(--beer-glow);
      border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
      width: 100%;
    }
    .dr-why-text { font-size: 1rem; line-height: 1.55; font-style: italic; }

    /* ── Сытность блюда против плотности сорта ── */
    .dr-weight {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      width: 100%;
      padding: var(--space-lg);
      border: 1px solid var(--line-subtle);
      border-radius: var(--radius-lg);
      background: var(--glass);
    }
    .dr-weight-title {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.13em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .dr-scale { display: grid; grid-template-columns: 54px 1fr auto; align-items: center; gap: var(--space-md); }
    .dr-scale-label { font-size: 0.76rem; font-weight: 700; color: var(--foam-dim); }
    .dr-scale-value { font-size: 0.76rem; font-weight: 600; color: var(--muted); white-space: nowrap; }
    .dr-scale .progress-track { display: block; }
    .dr-scale .progress-fill.alt { background: linear-gradient(90deg, var(--beer-deep), var(--beer-light)); }

    /* ── Альтернативы ── */
    .dr-alt-title {
      font-family: var(--font-body);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: var(--space-lg);
    }

    .dr-alts { display: grid; gap: var(--space-lg); }

    .dr-alt {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: var(--space-lg);
      align-items: center;
      padding: var(--space-lg);
      text-align: left;
      cursor: pointer;
      animation: drRise 460ms var(--ease-out) both;
      animation-delay: calc(var(--i, 0) * 70ms);
      transition: transform var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) ease;
    }
    .dr-alt:hover { transform: translateY(-4px); box-shadow: var(--shadow-hover); }

    .dr-alt-visual { position: relative; display: block; width: 110px; height: 110px; overflow: hidden; }
    .dr-alt-visual img { position: absolute; inset: 6px; width: auto; height: auto; max-width: calc(100% - 12px); max-height: calc(100% - 12px); margin: auto; object-fit: contain; }

    .dr-alt-body { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; min-width: 0; }
    .dr-alt-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); width: 100%; }
    .dr-alt-name { font-family: var(--font-heading); font-size: 1.05rem; font-weight: 700; }

    .dr-none { padding: var(--space-5xl); text-align: center; border: 1.5px dashed var(--line); border-radius: var(--radius-xl); }

    @media (max-width: 760px) {
      .dr-best { grid-template-columns: 1fr; gap: var(--space-xl); padding: var(--space-xl); }
      .dr-best-visual { height: 220px; }
      .dr-alt { grid-template-columns: 1fr; }
      .dr-alt-visual { width: 100%; }
    }

    @media (prefers-reduced-motion: reduce) {
      .dr-best, .dr-alt { animation: none; }
    }
  `],
})
export class DishResultComponent {
  // Сигнальные входы: список пересчитывается, когда родитель дозагрузит каталог
  profile = input.required<DishProfile>();
  brands = input<Brand[]>([]);
  dishes = input<Dish[]>([]);
  pairings = input<FoodPairing[]>([]);
  icons = input<FoodIcon[]>([]);
  /** false, пока родитель грузит каталог: показываем скелет, а не промежуточный подбор без оценок сомелье. */
  loaded = input(true);
  /** Сколько сортов показывать кроме лучшего - из настроек витрины. */
  alternatives = input(3);

  @Output() openBrand = new EventEmitter<string>();
  @Output() back = new EventEmitter<void>();
  @Output() restart = new EventEmitter<void>();

  readonly big = bigImage;
  readonly small = smallImage;

  title = computed(() => profileTitle(this.profile()));

  list = computed<Recommendation[]>(() =>
    recommend(this.profile(), this.brands(), this.dishes(), this.pairings(), Math.max(1, this.alternatives() + 1)));

  others = computed(() => this.list().slice(1));

  answers = computed(() => {
    const p = this.profile();
    const out: { emoji: string; label: string }[] = [];
    const add = (list: readonly { id: string; emoji: string; label: string }[], id: string | null) => {
      const o = id ? list.find(x => x.id === id) : null;
      if (o) out.push({ emoji: o.emoji, label: o.label });
    };
    add(CATEGORIES, p.category);
    add(COOKING, p.cooking);
    add(TASTES, p.taste);
    add(WEIGHTS, p.weight);
    if (p.fat) {
      const f = FATS.find(x => x.id === p.fat);
      if (f) out.push({ emoji: '', label: f.label });
    }
    return out;
  });

  readonly body = bodyLabel;

  /** Ответ о сытности словами - подпись к верхней шкале. */
  weightLabel = computed(() =>
    WEIGHTS.find(w => w.id === this.profile().weight)?.label ?? '-');

  /** Одна фраза о том, сошлись вес блюда и тело сорта или нет. */
  matchNote(rec: Recommendation): string {
    if (rec.targetBody === null) return '';
    const gap = Math.abs(rec.body - rec.targetBody);
    if (gap <= 1.2) return 'Тело сорта совпало с весом блюда - ни один не перетягивает внимание.';
    if (gap <= 2.5) return 'Небольшая разница в плотности: сорт чуть ' + (rec.body > rec.targetBody ? 'плотнее' : 'легче') + ' блюда.';
    return rec.body > rec.targetBody
      ? 'Сорт заметно плотнее блюда - держите его на второй глоток, после еды.'
      : 'Сорт легче блюда: он освежит, но не составит ему компанию по плотности.';
  }

  readonly skeletonCards = [1, 2, 3];

  label(type: string): string { return PAIRING_LABELS[type as PairingType] ?? type; }
  hint(type: string): string { return PAIRING_HINT[type] ?? ''; }
}
