import { Component, DestroyRef, EventEmitter, Output, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { Brand, Dish, FoodIcon, FoodPairing, PAIRING_LABELS, PairingType } from '../../models/flavor-tree.models';
import { V2Drink, V2Pair, V2PairingResult } from '../drinks-v2/v2.models';
import {
  CATEGORIES, COOKING, TASTES, WEIGHTS, FATS, STRONG_WINDOW,
  DishProfile, Recommendation, bigImage, smallImage, bodyLabel, profileTitle, recommend,
} from './pairing-engine.data';
import { DishPick } from './dish-search';
import { abvOf, brandForPair, curatedFor, efesBeers, pairReasons, pairWarning } from './engine-picks';

const PAIRING_HINT: Record<string, string> = {
  COMPLEMENT: 'Похожие вкусы усиливают друг друга',
  CONTRAST: 'Противоположности уравновешиваются',
  CLEANSE: 'Пиво освежает после тяжёлого или острого',
  BRIDGE: 'У пива и блюда есть общая нота',
};

/** Ниже этого балла движок считает пару нейтральной: такие сорта в «Ещё подойдут» не берём. */
const MIN_ALT_SCORE = 48;
/** Ниже этого балла честно говорим, что пиво к блюду раскрывается слабо. */
const WEAK_SCORE = 60;

/** Карточка сорта из ответа движка v2. */
interface EngineCard {
  pair: V2Pair;
  name: string;
  line: string;
  /** Сорт из каталога сомелье: его картинка и страница «Узнать больше». */
  brand: Brand | null;
  image: string | null;
  /** Автор и лицензия, если фото взято из открытых источников. */
  credit: V2Drink['image_credit'] | null;
  reasons: string[];
  warning: string;
  /** Пара сомелье к этому же блюду и этому же сорту. */
  curated: FoodPairing | null;
  serving: string;
}

interface EngineView {
  best: EngineCard;
  others: EngineCard[];
  nonAlcoholic: EngineCard | null;
  weak: boolean;
}

/**
 * Результат подбора: лучший сорт крупно и ещё несколько карточками.
 *
 * Для блюда из каталога ответ даёт движок v2, тот же, что в разделе
 * «К блюду», и из него берутся сорта портфеля Efes. Пара сомелье видна
 * только у своего блюда и своего сорта. Если сервер подбора не ответил,
 * остаётся расчёт по каталогу сомелье (recommend), как для мастера.
 *
 * Сколько показывать альтернатив, задаётся в админке - для застолья
 * нужен выбор, для быстрой подсказки хватит одной строки.
 */
@Component({
  selector: 'app-dish-result',
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    <div class="dr">
      <div class="dr-head">
        @if (dish()) {
          <button type="button" class="dr-back" (click)="otherDish.emit()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Другое блюдо
          </button>
        } @else {
          <button type="button" class="dr-back" (click)="back.emit()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Изменить ответы
          </button>
        }
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

      @if (also().length) {
        <div class="dr-also" aria-label="Другие блюда по запросу">
          <span class="text-xs text-muted">Ещё по запросу:</span>
          @for (d of also(); track d.name) {
            <button type="button" class="dr-also-chip" (click)="pickDish.emit(d)">
              @if (d.emoji) { <span aria-hidden="true">{{ d.emoji }}</span> }{{ d.name }}
            </button>
          }
        </div>
      }

      @switch (mode()) {
        @case ('loading') {
          <div class="skeleton-grid" aria-busy="true" aria-label="Подбираем сорта">
            @for (i of skeletonCards; track i) {
              <div class="skeleton-card">
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
              </div>
            }
          </div>
        }

        @case ('error') {
          <div class="dr-none">
            <p class="text-dim mb-lg">Сервер подбора сейчас не отвечает, поэтому посчитать пары к этому блюду не получилось.</p>
            <div class="dr-none-acts">
              <button type="button" class="btn-amber" (click)="retry()">Попробовать ещё раз</button>
              <button type="button" class="btn-ghost" (click)="otherDish.emit()">Подобрать по вопросам</button>
            </div>
          </div>
        }

        @case ('engine') {
          @if (engineView(); as v) {
            <article class="glass-card dr-best">
              <div class="dr-best-visual">
                @if (v.best.image; as src) {
                  <img [src]="src" [alt]="'Бутылка ' + v.best.name" />
                } @else {
                  <span class="dr-fallback" aria-hidden="true">🍺</span>
                }
              </div>

              <div class="dr-best-body">
                <span class="badge badge-dark">Лучший выбор</span>
                <h3 class="dr-best-name">{{ v.best.name }}</h3>
                @if (v.best.line) { <p class="text-sm text-muted">{{ v.best.line }}</p> }
                @if (v.best.credit; as c) {
                  <p class="dr-credit">
                    Фото: <a [href]="c.source" target="_blank" rel="noopener">{{ c.author || 'Wikimedia Commons' }}</a>,
                    @if (c.license_url) {
                      <a [href]="c.license_url" target="_blank" rel="noopener license">{{ c.license }}</a>
                    } @else {
                      {{ c.license }}
                    }
                  </p>
                }

                <div class="dr-points" [attr.data-band]="v.best.pair.band" [attr.aria-label]="'Совместимость ' + v.best.pair.score + ' из 99'">
                  <strong>{{ v.best.pair.score }}</strong>
                  <span>{{ v.best.pair.band_label }}</span>
                </div>

                @if (v.best.curated; as c) {
                  <div class="dr-why">
                    <span class="badge">Выбор сомелье</span>
                    <p class="dr-why-text">«{{ c.explanation }}»</p>
                    <div class="dr-score" [attr.aria-label]="'Оценка сомелье ' + c.compatibility_score + ' из 5'">
                      @for (s of pips; track s) {
                        <span class="dr-pip" [class.on]="s <= c.compatibility_score"></span>
                      }
                      <span class="dr-score-num">{{ c.compatibility_score }}/5</span>
                    </div>
                    <p class="text-xs text-muted">Оценка сомелье к этому блюду</p>
                  </div>
                }

                @if (v.best.reasons.length) {
                  <div class="dr-why dr-why-engine">
                    <span class="badge">Почему подходит</span>
                    <ul class="dr-reasons">
                      @for (t of v.best.reasons; track t) { <li>{{ t }}</li> }
                    </ul>
                    @if (v.best.warning) { <p class="text-xs text-muted">{{ v.best.warning }}</p> }
                  </div>
                }

                @if (v.best.serving) { <p class="text-sm text-dim">{{ v.best.serving }}</p> }

                @if (v.best.brand; as b) {
                  <button type="button" class="btn-amber" (click)="openBrand.emit(b.id)">
                    Узнать больше о напитке
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
                  </button>
                }
              </div>
            </article>

            @if (v.weak) {
              <p class="dr-note mb-xl">
                Пиво к этому блюду раскрывается слабо: у лучшего сорта Efes {{ v.best.pair.score }} из 99.
                В разделе «К блюду» движок сравнит блюдо и с другими напитками, в том числе безалкогольными.
              </p>
            }

            @if (v.others.length) {
              <h4 class="dr-alt-title">Ещё подойдут</h4>
              <div class="dr-alts">
                @for (c of v.others; track c.pair.drink_id; let i = $index) {
                  @if (c.brand; as b) {
                    <button type="button" class="glass-card dr-alt" [style.--i]="i" (click)="openBrand.emit(b.id)">
                      <ng-container *ngTemplateOutlet="engineAlt; context: { $implicit: c }" />
                    </button>
                  } @else {
                    <div class="glass-card dr-alt dr-alt-static" [style.--i]="i">
                      <ng-container *ngTemplateOutlet="engineAlt; context: { $implicit: c }" />
                    </div>
                  }
                }
              </div>
            }

            @if (v.nonAlcoholic; as na) {
              <div class="glass-card dr-na">
                <span class="badge">Без алкоголя</span>
                <div class="dr-na-body">
                  <span class="dr-alt-top">
                    <span class="dr-alt-name">{{ na.name }}</span>
                    <span class="dr-points dr-points-sm" [attr.data-band]="na.pair.band">
                      <strong>{{ na.pair.score }}</strong><span>{{ na.pair.band_label }}</span>
                    </span>
                  </span>
                  @if (na.reasons[0]; as t) { <span class="text-sm text-dim">{{ t }}</span> }
                </div>
              </div>
            }

            <p class="dr-note">
              Сорта портфеля Efes по расчёту движка подбора: баллы от 0 до 99 те же, что в разделе «К блюду».
              Если баллы отличаются не больше чем на {{ strongWindow }}, первым идёт сорт обычной крепости, а не крепкий.
            </p>
          }
        }

        @default {
          @if (engineFailed()) {
            <div class="dr-offline">
              <p class="text-sm text-dim">Сервер подбора не ответил, поэтому пока показываем оценки сомелье из каталога.</p>
              <button type="button" class="btn-ghost" (click)="retry()">Обновить подбор</button>
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

                  <div class="dr-score" [attr.aria-label]="(best.bySommelier ? 'Оценка сомелье ' : 'Совместимость ') + best.rating + ' из 5'">
                    @for (s of pips; track s) {
                      <span class="dr-pip" [class.on]="s <= best.rating"></span>
                    }
                    <span class="dr-score-num">{{ best.rating }}/5</span>
                  </div>

                  <div class="dr-why">
                    <span class="badge">{{ label(best.type) }}</span>
                    @if (best.bySommelier) {
                      <p class="dr-why-text">«{{ best.explanation }}»</p>
                    } @else {
                      <p class="dr-why-plain">{{ best.explanation }}</p>
                    }
                    @if (best.extra) { <p class="text-sm text-dim">{{ best.extra }}</p> }
                    <p class="text-xs text-muted">{{ source(best) }}</p>
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
                        <span class="dr-score" [attr.aria-label]="(alt.bySommelier ? 'Оценка сомелье ' : 'Совместимость ') + alt.rating + ' из 5'">
                          @for (s of pips; track s) {
                            <span class="dr-pip" [class.on]="s <= alt.rating"></span>
                          }
                        </span>
                      </span>
                      <span class="text-xs text-muted">{{ alt.brand.style }}@if (alt.brand.abv) { · {{ alt.brand.abv }}% }</span>
                      <span class="badge">{{ label(alt.type) }}</span>
                      <span class="text-sm text-dim">{{ alt.explanation }}</span>
                      @if (alt.bySommelier) {
                        <span class="text-xs text-muted">{{ source(alt) }}</span>
                      }
                    </span>
                  </button>
                }
              </div>
            }
          }
        }
      }
    </div>

    <ng-template #engineAlt let-c>
      <span class="dr-alt-visual">
        @if (c.image) {
          <img [src]="c.image" [alt]="c.name" loading="lazy" />
        } @else {
          <span class="dr-fallback" aria-hidden="true">🍺</span>
        }
      </span>

      <span class="dr-alt-body">
        <span class="dr-alt-top">
          <span class="dr-alt-name">{{ c.name }}</span>
          <span class="dr-points dr-points-sm" [attr.data-band]="c.pair.band" [attr.aria-label]="'Совместимость ' + c.pair.score + ' из 99'">
            <strong>{{ c.pair.score }}</strong><span>{{ c.pair.band_label }}</span>
          </span>
        </span>
        @if (c.line) { <span class="text-xs text-muted">{{ c.line }}</span> }
        @if (c.credit) { <span class="dr-credit">Фото: {{ c.credit.author || 'Wikimedia Commons' }}, {{ c.credit.license }}</span> }
        @if (c.curated) {
          <span class="badge">Выбор сомелье: {{ c.curated.compatibility_score }}/5</span>
          <span class="text-sm text-dim">«{{ c.curated.explanation }}»</span>
        } @else if (c.reasons.length) {
          <span class="text-sm text-dim">{{ c.reasons[0] }}</span>
        }
      </span>
    </ng-template>
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
      font: inherit;
      color: inherit;
      cursor: pointer;
      animation: drRise 460ms var(--ease-out) both;
      animation-delay: calc(var(--i, 0) * 70ms);
      transition: transform var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) ease;
    }
    .dr-alt:not(.dr-alt-static):hover { transform: translateY(-4px); box-shadow: var(--shadow-hover); }
    .dr-alt-static { cursor: default; }

    .dr-alt-visual { position: relative; display: block; width: 110px; height: 110px; overflow: hidden; }
    .dr-alt-visual img { position: absolute; inset: 6px; width: auto; height: auto; max-width: calc(100% - 12px); max-height: calc(100% - 12px); margin: auto; object-fit: contain; }

    .dr-alt-body { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; min-width: 0; }
    .dr-alt-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); width: 100%; }
    .dr-alt-name { font-family: var(--font-heading); font-size: 1.05rem; font-weight: 700; }

    /* ── Другие блюда по тому же запросу ── */
    .dr-also { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: var(--space-sm); margin: calc(-1 * var(--space-md)) 0 var(--space-2xl); }
    .dr-also-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 14px;
      border-radius: var(--radius-full);
      border: 1.5px solid var(--line);
      background: var(--glass);
      color: var(--foam-dim);
      font-family: var(--font-body);
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: border-color var(--duration-fast) ease, color var(--duration-fast) ease;
    }
    .dr-also-chip:hover { border-color: rgba(180, 83, 9, 0.35); color: var(--beer-deep); }

    /* ── Балл движка 0-99 ── */
    .dr-points { display: flex; align-items: baseline; gap: var(--space-sm); }
    .dr-points strong { font-family: var(--font-heading); font-size: 2.2rem; line-height: 1; color: var(--beer-deep); }
    .dr-points span { font-size: 0.82rem; font-weight: 600; color: var(--muted); }
    .dr-points[data-band="ideal"] strong { color: var(--success); }
    .dr-points-sm { flex-shrink: 0; gap: 6px; }
    .dr-points-sm strong { font-size: 1.25rem; }
    .dr-points-sm span { font-size: 0.72rem; }

    .dr-why-plain { font-size: 1rem; line-height: 1.55; }
    .dr-why-engine { background: var(--glass); border-left-color: rgba(180, 83, 9, 0.35); }
    .dr-reasons { margin: 0; padding-left: 1.1em; display: flex; flex-direction: column; gap: 4px; font-size: 0.95rem; line-height: 1.5; color: var(--foam-dim); }

    .dr-credit { font-size: 0.72rem; color: var(--muted); }
    .dr-credit a { color: inherit; text-decoration: underline; }

    .dr-note { font-size: 0.78rem; line-height: 1.5; color: var(--muted); text-align: center; max-width: 64ch; margin-left: auto; margin-right: auto; }
    .dr-offline { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-md); margin-bottom: var(--space-xl); text-align: center; }
    .dr-none-acts { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-md); }

    /* ── Без алкоголя ── */
    .dr-na {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-lg);
      padding: var(--space-lg);
      margin: var(--space-2xl) 0 var(--space-xl);
    }
    .dr-na-body { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 220px; }

    .dr-none { padding: var(--space-5xl); text-align: center; border: 1.5px dashed var(--line); border-radius: var(--radius-xl); }

    @media (max-width: 760px) {
      .dr-best { grid-template-columns: 1fr; gap: var(--space-xl); padding: var(--space-xl); }
      .dr-best-visual { height: 220px; }
      .dr-alt { grid-template-columns: 1fr; }
      .dr-alt-visual { width: 100%; }
      .dr-alt-top { flex-wrap: wrap; }
    }

    @media (prefers-reduced-motion: reduce) {
      .dr-best, .dr-alt { animation: none; }
    }
  `],
})
export class DishResultComponent {
  private api = inject(ApiService);
  private destroyRef = inject(DestroyRef);

  // Сигнальные входы: список пересчитывается, когда родитель дозагрузит каталог
  profile = input.required<DishProfile>();
  /** Блюдо из каталога, если человек назвал его сам; null - ответы мастера. */
  dish = input<DishPick | null>(null);
  /** Другие блюда, подошедшие под тот же запрос: «торт», «плов». */
  also = input<DishPick[]>([]);
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
  /** «Другое блюдо»: вернуться к вопросам мастера. */
  @Output() otherDish = new EventEmitter<void>();
  /** Выбрано другое блюдо из подсказок под заголовком. */
  @Output() pickDish = new EventEmitter<DishPick>();

  readonly big = bigImage;
  readonly small = smallImage;
  readonly pips = [1, 2, 3, 4, 5];
  readonly strongWindow = STRONG_WINDOW;

  /** Ответ движка v2 для блюда из каталога. */
  private engine = signal<V2PairingResult | null>(null);
  private engineState = signal<'idle' | 'loading' | 'ok' | 'error'>('idle');
  private request?: Subscription;

  constructor() {
    // Блюдо сменилось (подсказка «Ещё по запросу» или «Назад» браузера): просим движок заново
    effect(() => {
      const dish = this.dish();
      untracked(() => this.loadEngine(dish));
    }, { allowSignalWrites: true });
    this.destroyRef.onDestroy(() => this.request?.unsubscribe());
  }

  title = computed(() => this.dish()?.name ?? profileTitle(this.profile()));

  /** Движок не ответил, а у блюда есть пары в каталоге сомелье: показываем их. */
  engineFailed = computed(() => !!this.dish()?.v2Id && this.engineState() === 'error');

  engineView = computed<EngineView | null>(() => {
    const result = this.engine();
    if (!result) return null;
    const { beers, nonAlcoholic } = efesBeers(result);
    if (!beers.length) return null;
    const v1DishId = this.dish()?.v1Id ?? null;
    const card = (pair: V2Pair) => this.engineCard(pair, v1DishId);
    const [best, ...rest] = beers;
    return {
      best: card(best),
      others: rest.filter(p => p.score >= MIN_ALT_SCORE).slice(0, Math.max(0, this.alternatives())).map(card),
      nonAlcoholic: nonAlcoholic ? card(nonAlcoholic) : null,
      weak: best.score < WEAK_SCORE,
    };
  });

  /** Что показать: ответ движка, ожидание, запасной расчёт по каталогу или ошибку. */
  mode = computed<'engine' | 'loading' | 'local' | 'error'>(() => {
    const dish = this.dish();
    if (!dish?.v2Id) return 'local';
    const state = this.engineState();
    if (state === 'loading' || state === 'idle') return 'loading';
    if (state === 'ok' && this.engineView()) return 'engine';
    // Движок молчит или не нашёл пиво Efes: выручают пары сомелье, если блюдо есть в их каталоге
    return dish.v1Id ? 'local' : 'error';
  });

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
    // Блюда нет в каталоге сомелье: подписываем категорию из каталога движка
    const dish = this.dish();
    if (!out.length && dish?.hint) out.push({ emoji: dish.emoji, label: dish.hint });
    return out;
  });

  readonly body = bodyLabel;

  /** Ответ о сытности словами - подпись к верхней шкале. */
  weightLabel = computed(() =>
    WEIGHTS.find(w => w.id === this.profile().weight)?.label ?? '-');

  retry(): void {
    this.loadEngine(this.dish());
  }

  private loadEngine(dish: DishPick | null): void {
    this.request?.unsubscribe();
    this.engine.set(null);
    if (!dish?.v2Id) { this.engineState.set('idle'); return; }
    this.engineState.set('loading');
    this.request = this.api.getEnginePairing(dish.v2Id, ['beer', 'na_beer']).subscribe({
      next: r => { this.engine.set(r); this.engineState.set('ok'); },
      error: () => this.engineState.set('error'),
    });
  }

  private engineCard(pair: V2Pair, v1DishId: string | null): EngineCard {
    const brand = brandForPair(pair, this.brands());
    const drink = pair.drink;
    const own = brand ? bigImage(brand) : null;
    const abv = abvOf(pair);
    const style = drink?.style?.name || brand?.style || '';
    const serving = brand?.serving_recommendation;
    return {
      pair,
      name: brand?.name || drink?.display_name || drink?.name || pair.drink_name,
      line: [style, abv !== null ? `${String(abv).replace('.', ',')}% алк.` : ''].filter(Boolean).join(' · '),
      brand,
      image: own || drink?.image || null,
      credit: !own && drink?.image ? drink.image_credit ?? null : null,
      reasons: pairReasons(pair),
      warning: pairWarning(pair),
      curated: curatedFor(v1DishId, brand, this.pairings()),
      serving: serving
        ? `Подавать при ${serving.serving_temp_min}-${serving.serving_temp_max} °C, ${serving.glass_type}`
        : drink?.serving?.temp_min_c != null
          ? `Подавать при ${drink.serving.temp_min_c}-${drink.serving.temp_max_c} °C${drink.serving.glass ? ', ' + drink.serving.glass : ''}`
          : '',
    };
  }

  /** Подпись под объяснением: чья это оценка и к какому блюду. */
  source(rec: Recommendation): string {
    if (!rec.bySommelier) return this.hint(rec.type);
    return rec.basedOn ? `Оценка сомелье по похожему блюду «${rec.basedOn}»` : 'Оценка сомелье к этому блюду';
  }

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
