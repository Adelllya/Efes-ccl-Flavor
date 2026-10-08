import {
  Component, DestroyRef, EventEmitter, HostListener, OnInit, Output, computed, inject, signal, viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { SelectionService } from '../../services/selection.service';
import { PreferencesService } from '../../services/preferences.service';
import { TasteQuizComponent } from '../../ui/taste-quiz.component';
import { Brand, Dish, FoodPairing, FoodIcon, SiteSettings } from '../../models/flavor-tree.models';
import { ActiveTab } from '../../app.component';
import { V2ApiService } from '../drinks-v2/v2-api.service';
import { V2Dish } from '../drinks-v2/v2.models';
import { HeroComponent } from './hero/hero.component';
import { DishWizardComponent, LAST_STEP, WizardMove } from './dish-wizard.component';
import { DishResultComponent } from './dish-result.component';
import { BeerPairingsComponent } from './beer-pairings.component';
import { DishProfile, emptyProfile } from './pairing-engine.data';
import { DishChoice, DishPick, buildDishIndex, resolveDish } from './dish-search';

type Stage = 'idle' | 'searching' | 'wizard' | 'dish-result' | 'brand';

/**
 * Шаг подбора в записи истории браузера. Только простые данные:
 * history.state их копирует и хранит даже после перезагрузки страницы.
 */
interface LandingSnap {
  stage: 'idle' | 'wizard' | 'dish-result' | 'brand';
  step?: number;
  profile?: DishProfile | null;
  dish?: DishPick | null;
  also?: DishPick[];
  brandId?: string | null;
}

interface LandingEntry {
  ftLanding: LandingSnap;
  /** Шаг, из которого пришли в эту запись: кнопки «Назад» подбора уходят в него по истории. */
  prev: LandingSnap | null;
}

const IDLE: LandingSnap = { stage: 'idle' };

/**
 * Последний шаг подбора. Роутера нет: при уходе в другой раздел через меню
 * компонент главной уничтожается, а в новой записи истории шага нет.
 * Модуль живёт всё время работы приложения, поэтому шаг переживает уход
 * и возврат, как раньше в PageStateService.
 */
let lastSnap: LandingSnap | null = null;

/** Один и тот же экран подбора: этап, шаг мастера, блюдо или сорт. */
function sameSpot(a: LandingSnap, b: LandingSnap): boolean {
  if (a.stage !== b.stage) return false;
  if (a.stage === 'wizard') return (a.step ?? 0) === (b.step ?? 0);
  if (a.stage === 'dish-result') return (a.dish?.v2Id ?? a.dish?.v1Id ?? null) === (b.dish?.v2Id ?? b.dish?.v1Id ?? null);
  if (a.stage === 'brand') return (a.brandId ?? null) === (b.brandId ?? null);
  return true;
}

function landingEntry(): Partial<LandingEntry> {
  try {
    const state = history.state as Partial<LandingEntry> | null;
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

/** Значок экспресс-сценария: линейный SVG в стиле hero. */
type MoodIcon = 'bowl' | 'flame' | 'citrus' | 'fish' | 'mug' | 'cake';

interface MoodOption {
  id: string;
  icon: MoodIcon;
  title: string;
  desc: string;
  targetType: 'dish' | 'brand';
  targetName: string;
  badge: string;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [
    CommonModule, FormsModule, HeroComponent,
    DishWizardComponent, DishResultComponent, BeerPairingsComponent, TasteQuizComponent,
  ],
  template: `
    <!--
         1. HERO SECTION & VALUE PROPOSITION
         -->
    @if (stage() === 'idle') {
      <app-hero [brandCount]="brands().length" (choose)="scrollToSelector($event)" (dishSearch)="onHeroSearch($event)" />

      <!-- Третий путь: гость не знает, что выбрать. Шесть вопросов о привычках и сорта под его вкус -->
      <section class="taste-entry mb-4xl" aria-label="Вкусовой профиль">
        <div>
          <b>{{ prefs.hasTaste() ? 'Ваш вкусовой профиль готов' : 'Не знаете, что выбрать?' }}</b>
          <span>{{ prefs.hasTaste() ? 'В каталоге сорта стоят по совпадению с вашим вкусом.' : 'Ответьте на шесть вопросов о привычках. Без регистрации, одна минута.' }}</span>
        </div>
        <div class="taste-entry-actions">
          @if (prefs.hasTaste()) {
            <button type="button" class="btn-amber" (click)="navigate.emit('explorer')">Сорта под мой вкус</button>
            <button type="button" class="btn-outline" (click)="quiz.open()">Пройти заново</button>
          } @else {
            <button type="button" class="btn-amber" (click)="quiz.open()">Узнать свой вкус</button>
          }
        </div>
      </section>
    }

    <!--
         2. ПОДБОР: ДВА ПУТИ - ОТ БЛЮДА И ОТ НАПИТКА
         Вход только через две кнопки в hero. Дальше - мастер из четырёх
         вопросов для блюда либо витрина сортов для напитка.
         -->
    @if (stage() !== 'idle') {
    <section id="pairing-selector-section" class="glass-panel p-4xl mb-4xl pairing-engine-panel">
      @switch (stage()) {
        @case ('searching') {
          <div class="skeleton-grid" aria-busy="true" aria-label="Ищем блюдо в каталоге">
            @for (i of [1, 2, 3]; track i) {
              <div class="skeleton-card">
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
              </div>
            }
          </div>
        }

        @case ('wizard') {
          <app-dish-wizard
            [catalog]="dishIndex()"
            [icons]="foodIcons()"
            [restore]="wizardProfile()"
            [restoreStep]="wizardStep()"
            (done)="onProfileReady($event)"
            (dishPicked)="onExactChoice($event)"
            (advance)="onWizardAdvance($event)"
            (retreat)="onWizardRetreat($event)"
            (exit)="resetFlow()"
          />
        }

        @case ('dish-result') {
          @if (resultProfile(); as p) {
            <app-dish-result
              [profile]="p"
              [dish]="exactDish()"
              [also]="alsoDishes()"
              [brands]="brands()"
              [dishes]="dishes()"
              [pairings]="pairings()"
              [icons]="foodIcons()"
              [loaded]="dataLoaded()"
              [failed]="dataFailed()"
              [alternatives]="settings().alternatives_count"
              (openBrand)="openBrandPage($event)"
              (reload)="reload()"
              (back)="backToAnswers()"
              (restart)="resetFlow()"
              (otherDish)="startDish()"
              (pickDish)="onPickDish($event)"
            />
          }
        }

        @case ('brand') {
          <app-beer-pairings
            [brands]="brands()"
            [pairings]="pairings()"
            [dishes]="dishes()"
            [icons]="foodIcons()"
            [loaded]="dataLoaded()"
            [failed]="brandsFailed() || pairingsFailed()"
            [intro]="settings().pairing_intro"
            [minScore]="settings().min_score_to_show"
            [initial]="selectedBrand()"
            (openBrand)="openBrandPage($event)"
            (picked)="onBrandPicked($event)"
            (retry)="reload()"
            (exit)="resetFlow()"
          />
        }
      }
    </section>
    }

    <!--
         3. ЭКСПРЕСС-ПОДБОР: ВКУСОВОЙ КОМПАС & НАСТРОЕНИЕ
         -->
    <section class="page-section mb-4xl">
      <div class="mb-2xl">
        <span class="badge mb-xs">Экспресс-сценарии</span>
        <h2 class="section-header">Что выберешь сегодня?</h2>
        <p class="section-subtitle">Выберите повод или настроение - получите готовую рекомендацию за 1 клик</p>
      </div>

      <div class="grid grid-3">
        @for (mood of moodPresets; track mood.id) {
          <div
            class="glass-card mood-card stagger-item"
            role="button"
            tabindex="0"
            (click)="applyMoodPreset(mood)"
            (keydown.enter)="applyMoodPreset(mood)"
            (keydown.space)="$event.preventDefault(); applyMoodPreset(mood)"
          >
            <div class="mood-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                @switch (mood.icon) {
                  @case ('bowl') {
                    <path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z"/><path d="M7 21h10"/><path d="M19.5 12 22 6"/><path d="M16.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.73 1.62"/><path d="M11.25 3c.27.1.8.53.74 1.36-.05.83-.93 1.2-.98 2.02-.06.78.33 1.24.72 1.62"/><path d="M6.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.74 1.62"/>
                  }
                  @case ('flame') {
                    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
                  }
                  @case ('citrus') {
                    <path d="M21.66 17.67a1.08 1.08 0 0 1-.04 1.6A12 12 0 0 1 4.73 2.38a1.1 1.1 0 0 1 1.61-.04z"/><path d="M19.65 15.66A8 8 0 0 1 8.35 4.34"/><path d="m14 10-5.5 5.5"/><path d="M14 17.85V10H6.15"/>
                  }
                  @case ('fish') {
                    <path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/><path d="M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4"/><path d="m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98"/>
                  }
                  @case ('mug') {
                    <path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/>
                  }
                  @case ('cake') {
                    <circle cx="9" cy="7" r="2"/><path d="M7.2 7.9 3 11v9c0 .6.4 1 1 1h16c.6 0 1-.4 1-1v-9c0-2-3-6-7-8l-3.6 2.6"/><path d="M16 13H3"/><path d="M16 17H3"/>
                  }
                }
              </svg>
            </div>
            <h3 class="mb-xs">{{ mood.title }}</h3>
            <p class="text-dim text-sm mb-lg">{{ mood.desc }}</p>
            <div class="flex justify-between items-center mt-auto">
              <span class="badge">{{ mood.badge }}</span>
              <span class="text-beer font-bold text-sm">Выбрать →</span>
            </div>
          </div>
        }
      </div>
    </section>

    <!--
         4. ХРОНОМЕТРАЖ ГЛОТКА (СЕНСОРНАЯ ПИРАМИДА)
         -->
    <section class="glass-panel p-4xl mb-4xl">
      <div class="text-center max-w-2xl mx-auto mb-3xl">
        <span class="badge badge-accent mb-sm">Методология дегустации</span>
        <h2 class="section-header">Хронометраж глотка: Вкусовая Пирамида</h2>
        <p class="text-muted">Стандарт сенсорной деконструкции вкуса напитков по временным слоям</p>
      </div>

      <div class="grid grid-3">
        <div class="glass-card p-2xl stagger-item pyramid-info-card">
          <div class="pyramid-time-badge top-time">0-3 сек</div>
          <h3 class="mb-sm">Top Notes · Ароматическая вершина</h3>
          <p class="text-dim text-sm mb-md">Первое впечатление при поднесении бокала: эфирные масла хмеля, цитрусовые, хвойные и цветочные летучие ароматы.</p>
          <div class="text-xs font-semibold text-muted">Примеры: Цитрус, Хвоя, Зелёное яблоко, Травы</div>
        </div>

        <div class="glass-card p-2xl stagger-item pyramid-info-card">
          <div class="pyramid-time-badge heart-time">3-15 сек</div>
          <h3 class="mb-sm">Heart Notes · Солодовое сердце</h3>
          <p class="text-dim text-sm mb-md">Полнота вкуса и тела на языке: баланс солодовой сладости, хлебной корочки, зерновых тонов и текстуры.</p>
          <div class="text-xs font-semibold text-muted">Примеры: Солод, Карамель, Хлебная корочка, Рис</div>
        </div>

        <div class="glass-card p-2xl stagger-item pyramid-info-card">
          <div class="pyramid-time-badge base-time">15+ сек</div>
          <h3 class="mb-sm">Base Notes · База & Послевкусие</h3>
          <p class="text-dim text-sm mb-md">Финальный шлейф после глотка: благородная горчинка, сухость, обжаренные тона и очищающая свежесть рецепторов.</p>
          <div class="text-xs font-semibold text-muted">Примеры: Хмелевая горечь, Жжёный солод, Сухой финиш</div>
        </div>
      </div>
    </section>

    <!--
         5. ЧТО ЕЩЁ ЕСТЬ НА ПЛАТФОРМЕ: ГОСТЮ, ОФИЦИАНТУ, ЗАВЕДЕНИЮ
         -->
    <section class="page-section mb-4xl">
      <div class="mb-2xl">
        <span class="badge mb-xs">Не только подбор</span>
        <h2 class="section-header">Учимся слышать вкус</h2>
        <p class="section-subtitle">Короткие уроки, паспорт вкуса с баллами за знания и меню заведений с парой у каждого блюда</p>
      </div>
      <div class="grid grid-3">
        <button type="button" class="glass-card more-card" (click)="navigate.emit('academy')">
          <span class="more-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/></svg>
          </span>
          <b>Академия вкуса</b>
          <span>12 уроков по 3-4 минуты и тесты четырёх ступеней. Последняя ступень для официантов: как посоветовать пару за 15 секунд.</span>
          <span class="more-go">Открыть уроки →</span>
        </button>
        <button type="button" class="glass-card more-card" (click)="navigate.emit('passport')">
          <span class="more-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 15 8.5l7 1-5 4.9 1.2 7L12 18l-6.2 3.4 1.2-7-5-4.9 7-1L12 2Z"/></svg>
          </span>
          <b>Паспорт вкуса</b>
          <span>Отмечайте сорта и ноты, которые услышали, и сравнивайте себя с сомелье. Баллы дают за знания, а не за количество.</span>
          <span class="more-go">Открыть паспорт →</span>
        </button>
        <button type="button" class="glass-card more-card" (click)="navigate.emit('menu')">
          <span class="more-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          </span>
          <b>Меню заведений</b>
          <span>Меню по QR-коду без приложения: у каждого блюда подсказка, какой сорт к нему взять, и заказ прямо со стола.</span>
          <span class="more-go">Открыть меню →</span>
        </button>
      </div>
    </section>

    <app-taste-quiz #quiz (openBrand)="openBrandPage($event)" (finished)="navigate.emit('explorer')" />
  `,
  styles: [`
    .pairing-engine-panel {
      scroll-margin-top: 120px;
      border: 1px solid var(--beer-light);
      box-shadow: 0 12px 40px -10px rgba(180, 83, 9, 0.15);
    }
    /* Значок сценария: размер идёт от font-size .mood-icon, на телефоне он меньше */
    .mood-icon svg { display: block; width: 1em; height: 1em; color: var(--beer-mid); }
    .mood-card:focus-visible { outline: 2px solid var(--beer-light); outline-offset: 3px; }
    .engine-mode-tabs {
      display: flex;
      background: rgba(0, 0, 0, 0.04);
      padding: 4px;
      border-radius: var(--radius-full);
      border: 1px solid var(--line);
      gap: 4px;
    }
    .engine-mode-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: var(--radius-full);
      border: none;
      background: transparent;
      font-family: var(--font-heading);
      font-weight: 700;
      font-size: 0.95rem;
      color: var(--muted);
      cursor: pointer;
      transition: all var(--duration-fast) var(--ease-out);
    }
    .engine-mode-btn.active {
      background: var(--foam);
      color: #fff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .category-pills-row {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 8px;
      scrollbar-width: thin;
    }
    .cat-pill {
      white-space: nowrap;
      padding: 8px 16px;
      border-radius: var(--radius-full);
      border: 1px solid var(--line);
      background: var(--glass);
      color: var(--foam);
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--duration-fast) var(--ease-out);
    }
    .cat-pill:hover {
      background: #fff;
      border-color: var(--beer-accent);
    }
    .cat-pill.active {
      background: var(--beer-mid);
      color: #fff;
      border-color: var(--beer-mid);
      box-shadow: 0 4px 12px rgba(180, 83, 9, 0.25);
    }
    .dish-search-box {
      position: relative;
      width: 100%;
    }
    .dish-search-icon {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted);
    }
    .dish-search-input {
      width: 100%;
      padding-left: 48px;
      padding-right: 40px;
      height: 48px;
      font-size: 0.95rem;
    }
    .search-clear-btn {
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: 16px;
      padding: 4px;
    }
    .dish-chips-carousel {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 10px;
      scrollbar-width: thin;
    }
    .dish-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      background: var(--glass-strong);
      color: var(--foam);
      font-size: 0.92rem;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition: all var(--duration-fast) var(--ease-out);
    }
    .dish-chip:hover {
      transform: translateY(-2px);
      border-color: var(--beer-mid);
      box-shadow: var(--shadow-warm);
    }
    .dish-chip.active {
      background: linear-gradient(135deg, #1C1917 0%, #292524 100%);
      color: #fff;
      border-color: #1C1917;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    }
    .dish-chip-taste {
      font-size: 0.72rem;
      opacity: 0.75;
      background: rgba(255, 255, 255, 0.15);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .dish-chip:not(.active) .dish-chip-taste {
      background: rgba(0, 0, 0, 0.05);
    }
    .pairing-result-showcase {
      border: 1px solid var(--line);
      background: var(--glass-strong);
    }
    .pairing-dish-title {
      font-size: 1.6rem;
      font-weight: 800;
      margin: 4px 0 2px;
    }
    .matched-beer-box {
      border: 1px solid rgba(245, 158, 11, 0.35);
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(254, 243, 199, 0.4) 100%);
    }
    .matched-beer-grid {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 24px;
      align-items: center;
    }
    @media (max-width: 640px) {
      .matched-beer-grid {
        grid-template-columns: 1fr;
      }
    }
    .matched-beer-visual {
      height: 160px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.6);
      border-radius: var(--radius-xl);
      border: 1px solid var(--line);
      padding: 10px;
    }
    .matched-beer-img {
      max-height: 100%;
      max-width: 100%;
      object-fit: contain;
      filter: drop-shadow(0 6px 16px rgba(0,0,0,0.18));
    }
    .matched-beer-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .matched-beer-name {
      font-size: 1.45rem;
      font-weight: 800;
      margin: 2px 0 2px;
    }
    .score-pill {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .score-label {
      font-size: 0.72rem;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--muted);
    }
    .score-val {
      font-family: var(--font-heading);
      font-size: 1.3rem;
      font-weight: 800;
      color: var(--beer-mid);
    }
    .sommelier-verdict-box {
      background: rgba(255, 255, 255, 0.8);
      border-left: 3px solid var(--beer-accent);
      padding: 12px 16px;
      border-radius: 0 var(--radius-md) var(--radius-md) 0;
    }
    .sommelier-verdict-text {
      font-size: 0.95rem;
      color: var(--foam);
      font-style: italic;
      line-height: 1.45;
    }
    .badge-contrast { background: rgba(220, 38, 38, 0.1); color: #DC2626; }
    .badge-complement { background: rgba(22, 163, 74, 0.1); color: #16A34A; }
    .badge-cleanse { background: rgba(37, 99, 235, 0.1); color: #2563EB; }
    .badge-bridge { background: rgba(147, 51, 234, 0.1); color: #9333EA; }
    .beer-select-card {
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: all var(--duration-fast) var(--ease-out);
    }
    .beer-select-card:hover {
      transform: translateY(-2px);
      border-color: var(--beer-accent);
    }
    .beer-select-card.active {
      border: 2px solid var(--beer-mid);
      background: rgba(254, 243, 199, 0.5);
      box-shadow: 0 6px 20px rgba(180, 83, 9, 0.15);
    }
    .beer-select-visual {
      width: 40px;
      height: 60px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .beer-select-visual img {
      max-height: 100%;
      max-width: 100%;
      object-fit: contain;
    }
    .beer-select-name {
      font-size: 0.98rem;
      font-weight: 700;
      margin: 2px 0 0;
    }
    .dish-match-item {
      border: 1px solid var(--line);
    }
    .dish-match-title {
      font-size: 1.15rem;
      font-weight: 700;
    }
    .alt-pairing-card {
      cursor: pointer;
      transition: all var(--duration-fast) var(--ease-out);
    }
    .alt-pairing-card:hover {
      border-color: var(--beer-accent);
      transform: translateX(3px);
    }
    .pyramid-info-card {
      position: relative;
    }
    .pyramid-time-badge {
      display: inline-block;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 0.8rem;
      padding: 4px 10px;
      border-radius: var(--radius-full);
      margin-bottom: 12px;
    }
    /* Вход в опрос вкуса под выбором пути */
    .taste-entry { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md) var(--space-xl); max-width: 900px; margin-left: auto; margin-right: auto; padding: var(--space-lg) var(--space-xl); border: 1px solid rgba(217, 119, 6, 0.3); border-radius: var(--radius-xl); background: linear-gradient(135deg, #FFF7EA, #fff); position: relative; z-index: 1; }
    .taste-entry > div:first-child { flex: 1 1 260px; display: grid; gap: 2px; }
    .taste-entry b { font-family: var(--font-heading); font-size: 1.1rem; color: var(--foam); }
    .taste-entry span { font-size: 0.9rem; line-height: 1.5; color: var(--foam-dim); }
    .taste-entry-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
    .taste-entry .btn-amber, .taste-entry .btn-outline { min-height: 44px; }
    /* Карточки разделов внизу главной */
    .more-card { display: grid; gap: var(--space-sm); align-content: start; padding: var(--space-2xl); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .more-card:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .more-card b { font-family: var(--font-heading); font-size: 1.15rem; color: var(--foam); }
    .more-card > span { font-size: 0.9rem; line-height: 1.55; color: var(--foam-dim); }
    .more-icon { width: 48px; height: 48px; display: grid; place-content: center; border-radius: 14px; background: var(--beer-glow); color: var(--beer-deep); }
    .more-icon svg { width: 24px; height: 24px; }
    .more-go { margin-top: var(--space-sm); font-weight: 700; color: var(--beer-mid) !important; }
    .top-time { background: #FEF08A; color: #854D0E; }
    .heart-time { background: #FED7AA; color: #9A3412; }
    .base-time { background: #E7E5E4; color: #292524; }
  `]
})
export class LandingComponent implements OnInit {
  private api = inject(ApiService);
  private v2 = inject(V2ApiService);
  private selection = inject(SelectionService);
  private destroyRef = inject(DestroyRef);
  readonly prefs = inject(PreferencesService);

  @Output() navigate = new EventEmitter<ActiveTab>();

  // Данные
  brands = signal<Brand[]>([]);
  dishes = signal<Dish[]>([]);
  pairings = signal<FoodPairing[]>([]);
  /** Блюда движка v2 с синонимами: по ним ищем «плов», «к шашлыку», «баурсаки». */
  v2Dishes = signal<V2Dish[]>([]);

  /** Пока не пришли все три списка, подбор показывает скелет, а не "пусто". */
  brandsLoaded = signal(false);
  dishesLoaded = signal(false);
  pairingsLoaded = signal(false);
  v2DishesLoaded = signal(false);
  dataLoaded = computed(() => this.brandsLoaded() && this.dishesLoaded() && this.pairingsLoaded());

  /** Список не загрузился: подбор показывает ошибку с кнопкой "Обновить", а не пустой каталог. */
  brandsFailed = signal(false);
  dishesFailed = signal(false);
  pairingsFailed = signal(false);
  dataFailed = computed(() => this.brandsFailed() || this.dishesFailed() || this.pairingsFailed());

  /** Поиск блюда: каталог движка и каталог сомелье одним списком. */
  dishIndex = computed(() => buildDishIndex(this.dishes(), this.v2Dishes()));
  private searchReady = computed(() => this.dishesLoaded() && this.v2DishesLoaded());

  // Картинки характеристик и настройки витрины - из админки
  foodIcons = signal<FoodIcon[]>([]);
  settings = signal<SiteSettings>({
    alternatives_count: 3,
    min_score_to_show: 1,
    show_wheat_decor: true,
    pairing_intro: '',
  });

  /**
   * Шаг подбора. Вход через две кнопки или поиск: 'idle' - выбор пути,
   * 'searching' - ждём каталог для поиска, 'wizard' - четыре вопроса о блюде,
   * 'dish-result' - сорта к блюду, 'brand' - витрина сортов и пары к выбранному.
   */
  stage = signal<Stage>('idle');

  /** Ответы мастера для результата. */
  dishProfile = signal<DishProfile | null>(null);
  /** Блюдо, которое человек назвал сам: ответ даёт движок v2. */
  exactDish = signal<DishPick | null>(null);
  /** Другие блюда по тому же запросу, подсказками под результатом. */
  alsoDishes = signal<DishPick[]>([]);
  /** С чем открыть мастер: ответы и шаг из истории браузера. */
  wizardProfile = signal<DishProfile | null>(null);
  wizardStep = signal<number | null>(null);

  /**
   * Профиль для результата. У блюда из каталога сомелье берём его
   * характеристики и id: запасной расчёт покажет только его пары.
   */
  resultProfile = computed<DishProfile | null>(() => {
    const pick = this.exactDish();
    if (!pick) return this.dishProfile();
    const dish = pick.v1Id ? this.dishes().find(d => d.id === pick.v1Id) : undefined;
    if (!dish) return { ...emptyProfile(), freeText: pick.name };
    return {
      category: null,
      cooking: dish.cooking_method === 'OTHER' ? null : dish.cooking_method,
      taste: dish.dominant_taste,
      weight: dish.weight,
      fat: dish.fat_level,
      freeText: dish.name,
      dishId: dish.id,
    };
  });

  /** Сорт для витрины «у меня есть пиво»: экспресс-сценарий открывает её сразу на нём. */
  selectedBrand = signal<Brand | null>(null);
  /** Экспресс-сценарий сорта, нажатый до загрузки каталога: применим, когда данные придут. */
  private pendingMood: MoodOption | null = null;
  /** Запрос блюда, отправленный до загрузки каталога. */
  private pendingQuery: string | null = null;
  /** Сорт из истории браузера, пока каталог сортов ещё грузится. */
  private pendingBrandId: string | null = null;
  private readonly beerPairings = viewChild(BeerPairingsComponent);
  private readonly wizard = viewChild(DishWizardComponent);


  // Экспресс-сценарии настроения (на основе CustDev-сегментов)
  moodPresets: MoodOption[] = [
    {
      id: 'kazakh',
      icon: 'bowl',
      title: 'Казахское застолье',
      desc: 'Бешбармак, казы, куырдак - баланс плотного умами и солода.',
      targetType: 'dish',
      targetName: 'Бешбармак',
      badge: 'Казахская кухня'
    },
    {
      id: 'steak',
      icon: 'flame',
      title: 'Мясо на гриле & BBQ',
      desc: 'Шашлык, стейк, рёбрышки - высокая горечь гасит жирность.',
      targetType: 'dish',
      targetName: 'Шашлык',
      badge: 'Мясо & Гриль'
    },
    {
      id: 'fresh',
      icon: 'citrus',
      title: 'Освежиться в жару',
      desc: 'Хрустящий хмелевой профиль и чистый сухой финиш.',
      targetType: 'brand',
      targetName: 'Efes Pilsener',
      badge: 'Свежесть 5-7°C'
    },
    {
      id: 'sushi',
      icon: 'fish',
      title: 'Суши & Азиатский ужин',
      desc: 'Деликатные морепродукты и легкое рисовое тело без горечи.',
      targetType: 'dish',
      targetName: 'Суши (нигири)',
      badge: 'Японская кухня'
    },
    {
      id: 'friends',
      icon: 'mug',
      title: 'Разливное с друзьями',
      desc: 'Свежесть бочки прямо из крана для душевной компании.',
      targetType: 'brand',
      targetName: 'Кружка Свежего',
      badge: 'Разливное'
    },
    {
      id: 'dessert',
      icon: 'cake',
      title: 'Штрудель или BBQ-вечер',
      desc: 'Карамельный мостик сладости с легким хмелевым послевкусием.',
      targetType: 'brand',
      targetName: 'Легенда 777',
      badge: 'Карамельный солод'
    }
  ];


  ngOnInit() {
    this.loadBrands();
    this.loadDishes();
    this.loadPairings();

    // Каталог движка нужен поиску; без него ищем по каталогу сомелье
    this.v2.dishes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: list => {
        this.v2Dishes.set(list);
        this.v2DishesLoaded.set(true);
        this.runPendingSearch();
      },
      error: () => { this.v2DishesLoaded.set(true); this.runPendingSearch(); },
    });

    this.api.getFoodIcons().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(icons => this.foodIcons.set(icons));
    this.api.getSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(settings => this.settings.set(settings));

    // Вернулись на главную «Назад» со страницы сорта или перезагрузили её: открываем тот же шаг.
    // В записи истории шага нет (пришли через меню): берём последний шаг этого сеанса.
    const saved = landingEntry().ftLanding ?? lastSnap;
    if (saved && saved.stage !== 'idle') this.apply(saved);
  }

  // Загрузка каталога. Подписки живут не дольше страницы: опоздавший ответ
  // не должен менять шаг подбора после ухода с главной.
  // При ошибке список считаем дошедшим (скелет не нужен) и помечаем неудачным.

  private loadBrands(): void {
    this.brandsLoaded.set(false);
    this.brandsFailed.set(false);
    this.api.getBrands().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: brands => {
        this.brands.set(brands);
        this.brandsLoaded.set(true);
        this.applyPendingBrand();
        this.applyPendingMood();
      },
      error: () => { this.brandsFailed.set(true); this.brandsLoaded.set(true); },
    });
  }

  private loadDishes(): void {
    this.dishesLoaded.set(false);
    this.dishesFailed.set(false);
    this.api.getDishes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: dishes => {
        this.dishes.set(dishes);
        this.dishesLoaded.set(true);
        this.runPendingSearch();
      },
      error: () => { this.dishesFailed.set(true); this.dishesLoaded.set(true); this.runPendingSearch(); },
    });
  }

  private loadPairings(): void {
    this.pairingsLoaded.set(false);
    this.pairingsFailed.set(false);
    this.api.getPairings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: pairings => {
        this.pairings.set(pairings);
        this.pairingsLoaded.set(true);
      },
      error: () => { this.pairingsFailed.set(true); this.pairingsLoaded.set(true); },
    });
  }

  /** Кнопка "Обновить": повторяем только те запросы, что не удались. */
  reload(): void {
    if (this.brandsFailed()) this.loadBrands();
    if (this.dishesFailed()) this.loadDishes();
    if (this.pairingsFailed()) this.loadPairings();
  }

  // Переходы подбора

  startDish(): void {
    this.go({ stage: 'wizard', step: 0, profile: null });
  }

  /** Витрина сортов; с initial сразу открывается второй шаг - пары к этому сорту. */
  startBrand(initial: Brand | null = null): void {
    this.go({ stage: 'brand', brandId: initial?.id ?? null });
  }

  /** Мастер пройден - показываем сорта под собранный профиль. */
  onProfileReady(profile: DishProfile): void {
    this.go({ stage: 'dish-result', profile }, { from: { stage: 'wizard', step: LAST_STEP, profile } });
  }

  /** Человек назвал блюдо из каталога: ответ даст движок v2, пары сомелье - только этого блюда. */
  onExactChoice(choice: DishChoice): void {
    this.go({ stage: 'dish-result', dish: choice.pick, also: choice.also });
  }

  /** Другое блюдо из подсказок «Ещё по запросу»: текущее остаётся среди подсказок. */
  onPickDish(pick: DishPick): void {
    const current = this.exactDish();
    const also = [...(current ? [current] : []), ...this.alsoDishes().filter(d => !sameDish(d, pick))];
    this.go({ stage: 'dish-result', dish: pick, also });
  }

  /** «Изменить ответы» в результате мастера: обратно к последнему вопросу. */
  backToAnswers(): void {
    this.goBackTo({ stage: 'wizard', step: LAST_STEP, profile: this.dishProfile() });
  }

  onWizardAdvance(move: WizardMove): void {
    this.go(
      { stage: 'wizard', step: move.step, profile: move.profile },
      { from: { stage: 'wizard', step: move.step - 1, profile: move.profile }, applied: true },
    );
  }

  onWizardRetreat(move: WizardMove): void {
    this.goBackTo({ stage: 'wizard', step: move.step, profile: move.profile }, true);
  }

  /** Гость открыл сорт в витрине или вернулся из него к списку. */
  onBrandPicked(brand: Brand | null): void {
    if (brand) {
      this.go({ stage: 'brand', brandId: brand.id }, { from: { stage: 'brand', brandId: null }, applied: true });
    } else {
      this.goBackTo({ stage: 'brand', brandId: null }, true);
    }
  }

  resetFlow(): void {
    this.pendingMood = null;
    this.pendingQuery = null;
    this.goBackTo(IDLE);
  }

  /** Кнопка «Узнать больше о напитке» ведёт на страницу сорта. */
  openBrandPage(id: string): void {
    this.selection.open(id);
    this.navigate.emit('beer');
  }

  private scrollToSection(): void {
    const el = document.getElementById('pairing-selector-section');
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  /** Две кнопки из hero - вход в подбор. */
  scrollToSelector(mode: 'dish' | 'brand') {
    if (mode === 'dish') this.startDish(); else this.startBrand();
  }

  /**
   * Поиск из hero. Блюдо нашлось - сразу показываем сорта, иначе открываем
   * мастер: по одному названию подобрать нечего, но вкус блюда можно описать.
   */
  onHeroSearch(query: string) {
    this.searchFor(query);
  }

  /** Экспресс-сценарий: сразу ведём к результату, минуя вопросы. */
  applyMoodPreset(mood: MoodOption) {
    this.pendingMood = null;
    if (mood.targetType === 'dish') { this.searchFor(mood.targetName); return; }
    // Каталог ещё грузится (или не загрузился): открываем витрину, а сорт выберем, когда данные придут
    if (!this.brandsLoaded() || this.brandsFailed()) { this.pendingMood = mood; this.startBrand(); return; }
    this.startBrand(this.moodBrand(mood));
  }

  private searchFor(query: string): void {
    const text = (query || '').trim();
    if (text.length < 2) { this.startDish(); return; }
    if (!this.searchReady()) {
      // Каталог ещё грузится: показываем ожидание, в историю этот шаг не пишем
      this.pendingQuery = text;
      this.stage.set('searching');
      setTimeout(() => this.scrollToSection());
      return;
    }
    const found = resolveDish(this.dishIndex(), text);
    if (found?.sure) { this.onExactChoice(found); return; }
    // Неточное совпадение мастер покажет подсказкой «Возможно, вы искали»
    this.go({ stage: 'wizard', step: 0, profile: { ...emptyProfile(), freeText: text } });
  }

  private runPendingSearch(): void {
    const query = this.pendingQuery;
    if (query === null || !this.searchReady()) return;
    this.pendingQuery = null;
    if (this.stage() === 'searching') this.searchFor(query);
  }

  /** Снятые с публикации сорта витрина не показывает, значит и пресет их не открывает. */
  private moodBrand(mood: MoodOption): Brand | null {
    return this.brands().find(b =>
      b.is_active !== false && b.name.toLowerCase().includes(mood.targetName.toLowerCase())) ?? null;
  }

  /** Данные пришли: доигрываем экспресс-сценарий сорта, нажатый во время загрузки. */
  private applyPendingMood(): void {
    const mood = this.pendingMood;
    if (!mood || !this.brandsLoaded() || this.brandsFailed()) return;
    this.pendingMood = null;
    // Витрина уже открыта и лежит в истории: подменяем запись, а не добавляем новую
    if (this.stage() === 'brand') this.replace({ stage: 'brand', brandId: this.moodBrand(mood)?.id ?? null });
  }

  private applyPendingBrand(): void {
    const id = this.pendingBrandId;
    this.pendingBrandId = null;
    if (id && this.stage() === 'brand') this.apply({ stage: 'brand', brandId: id });
  }

  // История браузера: «Назад» на телефоне идёт по шагам подбора, а не уводит с сайта

  @HostListener('window:popstate')
  onPopState(): void {
    if (location.pathname !== '/') return;
    this.pendingQuery = null;
    this.apply(landingEntry().ftLanding ?? IDLE);
  }

  /** Что сейчас на экране, в виде записи истории. */
  private current(): LandingSnap {
    switch (this.stage()) {
      case 'wizard': {
        const w = this.wizard();
        return { stage: 'wizard', step: w ? w.index() : this.wizardStep() ?? 0, profile: w ? w.profile() : this.wizardProfile() };
      }
      case 'dish-result':
        return this.exactDish()
          ? { stage: 'dish-result', dish: this.exactDish(), also: this.alsoDishes() }
          : { stage: 'dish-result', profile: this.dishProfile() };
      case 'brand':
        return { stage: 'brand', brandId: this.beerPairings()?.selected()?.id ?? this.selectedBrand()?.id ?? null };
      default:
        return IDLE;
    }
  }

  /**
   * Шаг вперёд: новая запись в истории. Текущая запись перед этим получает
   * свежие ответы, чтобы, вернувшись к ней, гость увидел свой выбор.
   * applied - дочерний компонент уже показал новый шаг сам.
   */
  private go(next: LandingSnap, opts: { from?: LandingSnap; applied?: boolean } = {}): void {
    const from = opts.from ?? this.current();
    try {
      const entry = landingEntry();
      history.replaceState({ ...entry, ftLanding: from, prev: entry.prev ?? null }, '');
      history.pushState({ ftLanding: next, prev: from } satisfies LandingEntry, '');
    } catch {
      // История недоступна: подбор работает и без неё
    }
    this.apply(next, opts.applied);
  }

  /**
   * Шаг назад кнопкой подбора. Если предыдущая запись истории и есть цель,
   * уходим в неё через history.back(): тогда «Назад» браузера после этого
   * не покажет тот же экран второй раз. Иначе подменяем текущую запись.
   */
  private goBackTo(target: LandingSnap, applied = false): void {
    const prev = landingEntry().prev;
    if (prev && sameSpot(prev, target)) {
      history.back();
      return;
    }
    this.replace(target, applied);
  }

  private replace(snap: LandingSnap, applied = false): void {
    try {
      const entry = landingEntry();
      history.replaceState({ ...entry, ftLanding: snap, prev: entry.prev ?? null }, '');
    } catch {
      // История недоступна: подбор работает и без неё
    }
    this.apply(snap, applied);
  }

  /** Показывает шаг подбора из записи истории. */
  private apply(snap: LandingSnap, applied = false): void {
    lastSnap = snap;
    const before = this.stage();
    switch (snap.stage) {
      case 'wizard': {
        const step = snap.step ?? 0;
        const w = this.wizard();
        if (before === 'wizard' && w) {
          // Мастер уже открыт: переходим по шагам, ответы остаются
          if (!applied) w.show(step, w.profile());
        } else {
          this.wizardProfile.set(snap.profile ?? null);
          this.wizardStep.set(step);
          this.stage.set('wizard');
        }
        break;
      }
      case 'dish-result':
        this.exactDish.set(snap.dish ?? null);
        this.alsoDishes.set(snap.dish ? snap.also ?? [] : []);
        this.dishProfile.set(snap.dish ? null : snap.profile ?? null);
        this.stage.set('dish-result');
        break;
      case 'brand': {
        const id = snap.brandId ?? null;
        const brand = id ? this.brands().find(b => b.id === id) ?? null : null;
        // Каталог сортов ещё не пришёл: откроем сорт, когда он загрузится
        this.pendingBrandId = id && !brand && !this.brandsLoaded() ? id : null;
        this.selectedBrand.set(brand);
        this.stage.set('brand');
        // Витрина уже открыта и вход initial мог не измениться: переводим её напрямую.
        // null тоже передаём - без цели гость возвращается к выбору сорта
        if (!applied) this.beerPairings()?.selected.set(brand);
        break;
      }
      default:
        this.dishProfile.set(null);
        this.exactDish.set(null);
        this.alsoDishes.set([]);
        this.selectedBrand.set(null);
        this.stage.set('idle');
    }

    const after = this.stage();
    if (after === before && after !== 'dish-result') return;
    if (after === 'idle') {
      window.scrollTo({ top: 0 });
    } else {
      setTimeout(() => this.scrollToSection());
    }
  }
}

function sameDish(a: DishPick, b: DishPick): boolean {
  return (a.v2Id ?? a.v1Id) === (b.v2Id ?? b.v1Id);
}
