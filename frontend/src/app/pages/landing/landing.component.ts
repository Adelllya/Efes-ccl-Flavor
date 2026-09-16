import { Component, OnInit, inject, signal, computed, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { Brand, Dish, FoodPairing, CuisineType } from '../../models/flavor-tree.models';
import { ActiveTab } from '../../app.component';
import { HeroComponent } from './hero/hero.component';

interface MoodOption {
  id: string;
  icon: string;
  title: string;
  desc: string;
  targetType: 'dish' | 'brand';
  targetName: string;
  badge: string;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, FormsModule, HeroComponent],
  template: `
    <!-- ═══════════════════════════════════════════════════════════════
         1. HERO SECTION & VALUE PROPOSITION
         ═══════════════════════════════════════════════════════════════ -->
    <app-hero (choose)="scrollToSelector($event)" (dishSearch)="onHeroSearch($event)" />

    <!-- ═══════════════════════════════════════════════════════════════
         2. ИНТЕРАКТИВНЫЙ ПОДБОРЩИК (ГЛАВНЫЙ ИНСТРУМЕНТ)
         ═══════════════════════════════════════════════════════════════ -->
    <section id="pairing-selector-section" class="glass-panel p-4xl mb-4xl pairing-engine-panel">
      <div class="flex justify-between items-start flex-wrap gap-lg mb-3xl">
        <div>
          <span class="badge badge-accent mb-sm">AI Sommelier Engine</span>
          <h2 class="section-header" style="margin-bottom: 6px;">Интерактивный навигатор вкуса</h2>
          <p class="text-muted">Выберите направление поиска: от блюда к сорту или от сорта к идеальной трапезе</p>
        </div>

        <!-- Переключатель режима: По блюду vs По напитку -->
        <div class="engine-mode-tabs">
          <button
            class="engine-mode-btn"
            [class.active]="discoveryMode() === 'dish'"
            (click)="setMode('dish')"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
            <span>По блюду → Пиво</span>
          </button>
          <button
            class="engine-mode-btn"
            [class.active]="discoveryMode() === 'brand'"
            (click)="setMode('brand')"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>
            <span>По напитку → Блюда</span>
          </button>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════
           РЕЖИМ 1: ПО БЛЮДУ (DISH -> BEER)
           ═══════════════════════════════════════════════════════════════ -->
      @if (discoveryMode() === 'dish') {
        <!-- Кухни / Категории блюд -->
        <div class="category-pills-row mb-xl">
          <button
            class="cat-pill"
            [class.active]="selectedCuisine() === ''"
            (click)="selectedCuisine.set('')"
          >
            🌐 Все кухни ({{ dishes().length }})
          </button>
          <button
            class="cat-pill"
            [class.active]="selectedCuisine() === 'KZ'"
            (click)="selectedCuisine.set('KZ')"
          >
            🇰🇿 Казахская (Бешбармак, Казы...)
          </button>
          <button
            class="cat-pill"
            [class.active]="selectedCuisine() === 'GERMAN'"
            (click)="selectedCuisine.set('GERMAN')"
          >
            🥩 Гриль & Мясо
          </button>
          <button
            class="cat-pill"
            [class.active]="selectedCuisine() === 'ITALIAN'"
            (click)="selectedCuisine.set('ITALIAN')"
          >
            🍕 Пицца & Паста
          </button>
          <button
            class="cat-pill"
            [class.active]="selectedCuisine() === 'JAPANESE'"
            (click)="selectedCuisine.set('JAPANESE')"
          >
            🍣 Суши & Азия
          </button>
          <button
            class="cat-pill"
            [class.active]="selectedCuisine() === 'AMERICAN'"
            (click)="selectedCuisine.set('AMERICAN')"
          >
            🍔 Бургеры & BBQ
          </button>
          <button
            class="cat-pill"
            [class.active]="selectedCuisine() === 'MEXICAN'"
            (click)="selectedCuisine.set('MEXICAN')"
          >
            🌮 Тако & Острое
          </button>
        </div>

        <!-- Поиск блюда -->
        <div class="dish-search-box mb-xl">
          <svg class="dish-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            type="text"
            class="input dish-search-input"
            [ngModel]="dishSearch()"
            (ngModelChange)="dishSearch.set($event)"
            placeholder="Быстрый поиск блюда: например, Бешбармак, Шашлык, Суши, Бургер, Пицца..."
          />
          @if (dishSearch()) {
            <button class="search-clear-btn" (click)="dishSearch.set('')">✕</button>
          }
        </div>

        <!-- Быстрые чипсы блюд -->
        <div class="dish-chips-carousel mb-3xl">
          @for (dish of filteredDishes(); track dish.id) {
            <button
              class="dish-chip"
              [class.active]="selectedDish()?.id === dish.id"
              (click)="selectDish(dish)"
            >
              <span class="dish-chip-flag">{{ getCuisineFlag(dish.cuisine) }}</span>
              <span class="dish-chip-title">{{ dish.name }}</span>
              @if (dish.dominant_taste_display) {
                <span class="dish-chip-taste">{{ dish.dominant_taste_display }}</span>
              }
            </button>
          }
        </div>

        <!-- КАРТОЧКА РЕКОМЕНДАЦИИ СОМЕЛЬЕ (DISH + BEER MATCH) -->
        @if (selectedDish(); as dish) {
          <div class="pairing-result-showcase glass-card p-3xl stagger-item">
            <!-- Блок выбранного блюда -->
            <div class="pairing-dish-header mb-2xl">
              <div class="flex items-center gap-md flex-wrap justify-between">
                <div>
                  <div class="flex items-center gap-sm mb-xs">
                    <span class="badge badge-accent">{{ dish.cuisine_display || dish.cuisine }}</span>
                    <span class="badge">{{ dish.dominant_taste_display || dish.dominant_taste }}</span>
                    @if (dish.fat_level_display) {
                      <span class="badge badge-dark">Жирность: {{ dish.fat_level_display }}</span>
                    }
                  </div>
                  <h3 class="pairing-dish-title">{{ dish.name }}</h3>
                  <p class="text-muted text-sm">{{ dish.description || (dish.category + ' · ' + dish.cooking_method_display) }}</p>
                </div>
                <div class="pairing-dish-status">
                  <span class="text-xs text-muted font-bold uppercase">Пейринг-анализ</span>
                  <div class="flex items-center gap-xs text-success font-bold">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    Готово к подаче
                  </div>
                </div>
              </div>
            </div>

            <!-- Главная рекомендация (Пиво) -->
            @if (topPairingForDish(); as pair) {
              <div class="matched-beer-box glass-panel p-2xl mb-xl">
                <div class="matched-beer-grid">
                  <!-- Бутылка / Превью -->
                  <div class="matched-beer-visual">
                    @if (pair.brandObj?.image) {
                      <img [src]="pair.brandObj?.image" [alt]="pair.brand_name" class="matched-beer-img" />
                    } @else {
                      <div class="matched-beer-placeholder">
                        <span style="font-size: 2.2rem;">🍺</span>
                        <span class="text-xs font-bold text-muted uppercase">Flavor Tree</span>
                      </div>
                    }
                  </div>

                  <!-- Описание сорта и почему он подходит -->
                  <div class="matched-beer-info">
                    <div class="flex justify-between items-start flex-wrap gap-sm mb-xs">
                      <div>
                        <span class="badge badge-beer mb-xs">ТОП ВЫБОР СОМЕЛЬЕ</span>
                        <h4 class="matched-beer-name">{{ pair.brand_name }}</h4>
                        <span class="text-muted text-sm font-semibold">
                          {{ pair.brandObj?.style }} · {{ pair.brandObj?.abv ? pair.brandObj?.abv + '% ABV' : '' }}
                        </span>
                      </div>

                      <div class="score-pill">
                        <span class="score-label">Совместимость</span>
                        <div class="score-val">
                          <span>⭐</span> {{ pair.compatibility_score }} / 5
                        </div>
                      </div>
                    </div>

                    <!-- Принцип пейринга -->
                    <div class="pairing-type-badge mb-md">
                      <span class="badge badge-type" [ngClass]="'badge-' + pair.pairing_type.toLowerCase()">
                        {{ getPairingTypeBadge(pair.pairing_type) }}
                      </span>
                    </div>

                    <!-- Обоснование вердикта -->
                    <div class="sommelier-verdict-box mb-lg">
                      <div class="flex items-center gap-xs text-xs font-bold text-deep uppercase mb-xs">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        Сенсорное обоснование
                      </div>
                      <p class="sommelier-verdict-text">«{{ pair.explanation }}»</p>
                    </div>

                    <!-- Подача & Кнопка Пирамиды -->
                    <div class="flex items-center justify-between flex-wrap gap-md">
                      @if (pair.brandObj?.serving_recommendation; as rec) {
                        <div class="serving-mini-info flex items-center gap-lg text-sm text-muted">
                          <span>🌡️ <strong>{{ rec.serving_temp_min }}–{{ rec.serving_temp_max }}°C</strong></span>
                          <span>🍷 <strong>{{ rec.glass_type }}</strong></span>
                        </div>
                      }
                      <button
                        class="btn-amber btn-sm"
                        (click)="openPyramidModal(pair.brandObj || pair.brand_name)"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 22 22 22"/></svg>
                        Пирамида вкуса (0–15+ сек)
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Альтернативные сорта для этого блюда (если есть) -->
              @if (alternativePairingsForDish().length > 0) {
                <div class="alternative-pairings-block">
                  <h5 class="text-sm font-bold uppercase text-muted mb-md">Другие отличные сочетания с этим блюдом:</h5>
                  <div class="grid grid-2">
                    @for (alt of alternativePairingsForDish(); track alt.id) {
                      <div class="glass-card p-lg flex items-center justify-between gap-md alt-pairing-card" (click)="openPyramidModal(alt.brandObj || alt.brand_name)">
                        <div>
                          <div class="flex items-center gap-xs mb-xs">
                            <span class="font-bold text-foam">{{ alt.brand_name }}</span>
                            <span class="badge" style="font-size: 0.7rem;">{{ alt.compatibility_score }}/5</span>
                          </div>
                          <p class="text-xs text-muted" style="line-height: 1.3;">{{ alt.explanation }}</p>
                        </div>
                        <span class="text-beer font-bold" style="font-size: 1.2rem;">→</span>
                      </div>
                    }
                  </div>
                </div>
              }
            } @else {
              <!-- Fallback если нет прямой пары -->
              <div class="glass-panel text-center p-3xl">
                <p class="text-muted mb-md">Для этого блюда сомелье рекомендует освежающий классический лагер или пильзнер.</p>
                <button class="btn-amber btn-sm" (click)="openPyramidModal('Efes Pilsener')">Попробовать с Efes Pilsener</button>
              </div>
            }
          </div>
        }
      }

      <!-- ═══════════════════════════════════════════════════════════════
           РЕЖИМ 2: ПО НАПИТКУ (BEER -> FOOD)
           ═══════════════════════════════════════════════════════════════ -->
      @if (discoveryMode() === 'brand') {
        <!-- Поиск пива -->
        <div class="dish-search-box mb-xl">
          <svg class="dish-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            type="text"
            class="input dish-search-input"
            [ngModel]="brandSearch()"
            (ngModelChange)="brandSearch.set($event)"
            placeholder="Выберите сорт: Efes Pilsener, Kozel Dark, Wùkōng Jū, Кружка Свежего, Хмельной Лось..."
          />
          @if (brandSearch()) {
            <button class="search-clear-btn" (click)="brandSearch.set('')">✕</button>
          }
        </div>

        <!-- Сетка / карусель сортов -->
        <div class="grid grid-cards-sm mb-3xl">
          @for (brand of filteredBrands(); track brand.id) {
            <div
              class="glass-card beer-select-card p-lg"
              [class.active]="selectedBrand()?.id === brand.id"
              (click)="selectBrand(brand)"
            >
              <div class="beer-select-visual">
                @if (brand.image) {
                  <img [src]="brand.image" [alt]="brand.name" />
                } @else {
                  <span>🍺</span>
                }
              </div>
              <div class="beer-select-meta">
                <span class="badge" style="font-size: 0.68rem;">{{ brand.style }}</span>
                <h4 class="beer-select-name">{{ brand.name }}</h4>
                <span class="text-xs text-muted">{{ brand.abv ? brand.abv + '% ABV' : '' }}</span>
              </div>
            </div>
          }
        </div>

        <!-- РЕЗУЛЬТАТ: БЛЮДА К ВЫБРАННОМУ ПИВУ -->
        @if (selectedBrand(); as brand) {
          <div class="pairing-result-showcase glass-card p-3xl stagger-item">
            <div class="flex justify-between items-start flex-wrap gap-lg mb-2xl">
              <div>
                <div class="flex items-center gap-sm mb-xs">
                  <span class="badge badge-beer">{{ brand.style }}</span>
                  <span class="badge">{{ brand.abv ? brand.abv + '% ABV' : 'Лагер' }}</span>
                  @if (brand.is_horeca_only) {
                    <span class="badge badge-horeca">HoReCa Exclusive</span>
                  }
                </div>
                <h3 style="font-size: 1.8rem; margin: 0;">{{ brand.name }}</h3>
                <p class="text-muted text-sm mt-xs">{{ brand.description }}</p>
              </div>

              <button class="btn-outline btn-sm" (click)="openPyramidModal(brand)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 22 22 22"/></svg>
                Вкусовая пирамида сорта
              </button>
            </div>

            <!-- Список рекомендуемых блюд -->
            <h4 class="text-md font-bold uppercase text-muted mb-lg flex items-center gap-xs">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
              Идеальные гастропары к {{ brand.name }}:
            </h4>

            <div class="grid grid-3">
              @for (pair of pairingsForSelectedBrand(); track pair.id) {
                <div class="glass-panel p-xl dish-match-item">
                  <div class="flex justify-between items-center mb-sm">
                    <span class="badge badge-type" [ngClass]="'badge-' + pair.pairing_type.toLowerCase()">
                      {{ pair.pairing_type }}
                    </span>
                    <span class="font-bold text-beer">⭐ {{ pair.compatibility_score }} / 5</span>
                  </div>
                  <h4 class="dish-match-title mb-xs">{{ pair.dish_name }}</h4>
                  <p class="text-dim text-xs" style="line-height: 1.4;">{{ pair.explanation }}</p>
                </div>
              } @empty {
                <div class="glass-panel text-center p-3xl" style="grid-column: 1 / -1;">
                  <p class="text-muted">Подбор пар для этого сорта обновляется сомелье. Рекомендуется к легким закускам и мясу на гриле.</p>
                </div>
              }
            </div>
          </div>
        }
      }
    </section>

    <!-- ═══════════════════════════════════════════════════════════════
         3. ЭКСПРЕСС-ПОДБОР: ВКУСОВОЙ КОМПАС & НАСТРОЕНИЕ
         ═══════════════════════════════════════════════════════════════ -->
    <section class="page-section mb-4xl">
      <div class="mb-2xl">
        <span class="badge mb-xs">Экспресс-сценарии</span>
        <h2 class="section-header">Что выберешь сегодня?</h2>
        <p class="section-subtitle">Выберите повод или гастрономическое настроение — получите готовую рекомендацию за 1 клик</p>
      </div>

      <div class="grid grid-3">
        @for (mood of moodPresets; track mood.id) {
          <div
            class="glass-card mood-card stagger-item"
            (click)="applyMoodPreset(mood)"
          >
            <div class="mood-icon">{{ mood.icon }}</div>
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

    <!-- ═══════════════════════════════════════════════════════════════
         4. ХРОНОМЕТРАЖ ГЛОТКА (СЕНСОРНАЯ ПИРАМИДА)
         ═══════════════════════════════════════════════════════════════ -->
    <section class="glass-panel p-4xl mb-4xl">
      <div class="text-center max-w-2xl mx-auto mb-3xl">
        <span class="badge badge-accent mb-sm">Методология дегустации</span>
        <h2 class="section-header">Хронометраж глотка: Вкусовая Пирамида</h2>
        <p class="text-muted">Стандарт сенсорной деконструкции вкуса напитков по временным слоям</p>
      </div>

      <div class="grid grid-3">
        <div class="glass-card p-2xl stagger-item pyramid-info-card">
          <div class="pyramid-time-badge top-time">0–3 сек</div>
          <h3 class="mb-sm">Top Notes · Ароматическая вершина</h3>
          <p class="text-dim text-sm mb-md">Первое впечатление при поднесении бокала: эфирные масла хмеля, цитрусовые, хвойные и цветочные летучие ароматы.</p>
          <div class="text-xs font-semibold text-muted">Примеры: Цитрус, Хвоя, Зелёное яблоко, Травы</div>
        </div>

        <div class="glass-card p-2xl stagger-item pyramid-info-card">
          <div class="pyramid-time-badge heart-time">3–15 сек</div>
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

    <!-- ═══════════════════════════════════════════════════════════════
         5. МОДАЛЬНОЕ ОКНО: ПИРАМИДА ВКУСА
         ═══════════════════════════════════════════════════════════════ -->
    @if (modalBrand(); as brand) {
      <div class="modal-overlay" (click)="closePyramidModal()">
        <div class="modal-content glass-card" (click)="$event.stopPropagation()">
          <button class="btn-outline modal-close" (click)="closePyramidModal()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            Закрыть
          </button>

          <div class="flex gap-2xl items-center mb-3xl flex-wrap">
            @if (brand.image) {
              <div style="height: 140px; width: 100px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.03); border: 1px solid var(--line); border-radius: var(--radius-xl); padding: 8px; flex-shrink: 0;">
                <img [src]="brand.image" [alt]="brand.name" style="max-height: 100%; max-width: 100%; object-fit: contain; filter: drop-shadow(0 6px 16px rgba(0,0,0,0.2));" />
              </div>
            }
            <div>
              <span class="badge mb-xs">{{ brand.style }} · ABV {{ brand.abv ? brand.abv + '%' : 'N/A' }}</span>
              <h2 style="font-size: 1.8rem; margin: 0;">{{ brand.name }}</h2>
              <p class="text-muted text-sm">{{ brand.brand_owner || 'Efes Kazakhstan' }}</p>
            </div>
          </div>

          <!-- Пирамида слоев -->
          @if (brand.pyramid) {
            @if (brand.pyramid.top && brand.pyramid.top.length > 0) {
              <div class="glass-panel pyramid-layer mb-lg">
                <h3 class="pyramid-layer-title">Top Notes (0–3 сек · Аромат)</h3>
                @for (item of brand.pyramid.top; track item.id) {
                  <div class="pyramid-note">
                    <div class="pyramid-note-header">
                      <span>{{ item.icon }} {{ item.name }}</span>
                      <span>Интенсивность: {{ item.intensity }}/10</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" [style.width.%]="item.intensity * 10"></div>
                    </div>
                    @if (item.sommelier_note) {
                      <p class="pyramid-note-comment">«{{ item.sommelier_note }}»</p>
                    }
                  </div>
                }
              </div>
            }

            @if (brand.pyramid.heart && brand.pyramid.heart.length > 0) {
              <div class="glass-panel pyramid-layer mb-lg">
                <h3 class="pyramid-layer-title">Heart Notes (3–15 сек · Тело)</h3>
                @for (item of brand.pyramid.heart; track item.id) {
                  <div class="pyramid-note">
                    <div class="pyramid-note-header">
                      <span>{{ item.icon }} {{ item.name }}</span>
                      <span>Интенсивность: {{ item.intensity }}/10</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" [style.width.%]="item.intensity * 10"></div>
                    </div>
                    @if (item.sommelier_note) {
                      <p class="pyramid-note-comment">«{{ item.sommelier_note }}»</p>
                    }
                  </div>
                }
              </div>
            }

            @if (brand.pyramid.base && brand.pyramid.base.length > 0) {
              <div class="glass-panel pyramid-layer mb-lg">
                <h3 class="pyramid-layer-title">Base Notes (15+ сек · Послевкусие)</h3>
                @for (item of brand.pyramid.base; track item.id) {
                  <div class="pyramid-note">
                    <div class="pyramid-note-header">
                      <span>{{ item.icon }} {{ item.name }}</span>
                      <span>Интенсивность: {{ item.intensity }}/10</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" [style.width.%]="item.intensity * 10"></div>
                    </div>
                    @if (item.sommelier_note) {
                      <p class="pyramid-note-comment">«{{ item.sommelier_note }}»</p>
                    }
                  </div>
                }
              </div>
            }
          } @else {
            <p class="text-center text-muted p-2xl">Сенсорная пирамида для данного сорта в обработке сомелье.</p>
          }

          <!-- Подача -->
          @if (brand.serving_recommendation; as rec) {
            <div class="glass-card p-xl serving-info mt-xl">
              <div class="serving-item">
                <span class="badge">Температура подачи</span>
                <h4>{{ rec.serving_temp_min }}–{{ rec.serving_temp_max }} °C</h4>
              </div>
              <div class="serving-item">
                <span class="badge">Бокал</span>
                <h4>{{ rec.glass_type }}</h4>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .pairing-engine-panel {
      scroll-margin-top: 120px;
      border: 1px solid var(--beer-light);
      box-shadow: 0 12px 40px -10px rgba(180, 83, 9, 0.15);
    }
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
    .top-time { background: #FEF08A; color: #854D0E; }
    .heart-time { background: #FED7AA; color: #9A3412; }
    .base-time { background: #E7E5E4; color: #292524; }
  `]
})
export class LandingComponent implements OnInit {
  private api = inject(ApiService);

  @Output() navigate = new EventEmitter<ActiveTab>();

  // Данные
  brands = signal<Brand[]>([]);
  dishes = signal<Dish[]>([]);
  pairings = signal<FoodPairing[]>([]);

  // Состояние навигатора
  discoveryMode = signal<'dish' | 'brand'>('dish');
  selectedCuisine = signal<string>('');
  dishSearch = signal<string>('');
  brandSearch = signal<string>('');

  selectedDish = signal<Dish | null>(null);
  selectedBrand = signal<Brand | null>(null);

  modalBrand = signal<Brand | null>(null);

  // Экспресс-сценарии настроения (на основе CustDev-сегментов)
  moodPresets: MoodOption[] = [
    {
      id: 'kazakh',
      icon: '🥩',
      title: 'Казахское застолье',
      desc: 'Бешбармак, казы, куырдак — баланс плотного умами и солода.',
      targetType: 'dish',
      targetName: 'Бешбармак',
      badge: 'Казахская кухня'
    },
    {
      id: 'steak',
      icon: '🔥',
      title: 'Мясо на гриле & BBQ',
      desc: 'Шашлык, стейк, рёбрышки — высокая горечь гасит жирность.',
      targetType: 'dish',
      targetName: 'Шашлык',
      badge: 'Мясо & Гриль'
    },
    {
      id: 'fresh',
      icon: '🍋',
      title: 'Освежиться в жару',
      desc: 'Хрустящий хмелевой профиль и чистый сухой финиш.',
      targetType: 'brand',
      targetName: 'Efes Pilsener',
      badge: 'Свежесть 5–7°C'
    },
    {
      id: 'sushi',
      icon: '🍣',
      title: 'Суши & Азиатский ужин',
      desc: 'Деликатные морепродукты и легкое рисовое тело без горечи.',
      targetType: 'dish',
      targetName: 'Суши (нигири)',
      badge: 'Японская кухня'
    },
    {
      id: 'friends',
      icon: '🍺',
      title: 'Разливное с друзьями',
      desc: 'Свежесть бочки прямо из крана для душевной компании.',
      targetType: 'brand',
      targetName: 'Кружка Свежего',
      badge: 'Разливное'
    },
    {
      id: 'dessert',
      icon: '🍰',
      title: 'Штрудель или BBQ-вечер',
      desc: 'Карамельный мостик сладости с легким хмелевым послевкусием.',
      targetType: 'brand',
      targetName: 'Легенда 777',
      badge: 'Карамельный солод'
    }
  ];

  // Фильтрация блюд
  filteredDishes = computed(() => {
    const cuisine = this.selectedCuisine();
    const query = this.dishSearch().trim().toLowerCase();

    return this.dishes().filter(d => {
      const matchCuisine = !cuisine || d.cuisine === cuisine;
      const matchQuery = !query ||
        d.name.toLowerCase().includes(query) ||
        (d.category && d.category.toLowerCase().includes(query)) ||
        (d.dominant_taste_display && d.dominant_taste_display.toLowerCase().includes(query));
      return matchCuisine && matchQuery;
    });
  });

  // Фильтрация пива
  filteredBrands = computed(() => {
    const query = this.brandSearch().trim().toLowerCase();
    return this.brands().filter(b => {
      return !query ||
        b.name.toLowerCase().includes(query) ||
        (b.style && b.style.toLowerCase().includes(query));
    });
  });

  // Пары для выбранного блюда с прикрепленными объектами брендов
  pairingsForSelectedDish = computed(() => {
    const dish = this.selectedDish();
    if (!dish) return [];

    const pairs = this.pairings().filter(p =>
      p.dish === dish.id ||
      p.dish_name.toLowerCase() === dish.name.toLowerCase()
    );

    // Добавляем Brand объект для каждого пейринга
    return pairs.map(p => {
      const brandObj = this.brands().find(b =>
        b.id === p.brand ||
        b.name.toLowerCase() === p.brand_name.toLowerCase()
      );
      return {
        ...p,
        brandObj
      };
    }).sort((a, b) => b.compatibility_score - a.compatibility_score);
  });

  // Топ-пара для блюда
  topPairingForDish = computed(() => {
    const list = this.pairingsForSelectedDish();
    return list.length > 0 ? list[0] : null;
  });

  // Альтернативные пары
  alternativePairingsForDish = computed(() => {
    const list = this.pairingsForSelectedDish();
    return list.slice(1);
  });

  // Пары для выбранного пива
  pairingsForSelectedBrand = computed(() => {
    const brand = this.selectedBrand();
    if (!brand) return [];

    return this.pairings().filter(p =>
      p.brand === brand.id ||
      p.brand_name.toLowerCase() === brand.name.toLowerCase()
    ).sort((a, b) => b.compatibility_score - a.compatibility_score);
  });

  ngOnInit() {
    this.api.getBrands().subscribe(brands => {
      this.brands.set(brands);
      if (brands.length > 0 && !this.selectedBrand()) {
        this.selectedBrand.set(brands[0]);
      }
    });

    this.api.getDishes().subscribe(dishes => {
      this.dishes.set(dishes);
      if (dishes.length > 0 && !this.selectedDish()) {
        // По умолчанию выберем Бешбармак (главный символ казахской кухни)
        const besh = dishes.find(d => d.name.toLowerCase().includes('бешбармак')) || dishes[0];
        this.selectedDish.set(besh);
      }
    });

    this.api.getPairings().subscribe(pairings => {
      this.pairings.set(pairings);
    });
  }

  setMode(mode: 'dish' | 'brand') {
    this.discoveryMode.set(mode);
  }

  selectDish(dish: Dish) {
    this.selectedDish.set(dish);
  }

  selectBrand(brand: Brand) {
    this.selectedBrand.set(brand);
  }

  scrollToSelector(mode: 'dish' | 'brand') {
    this.discoveryMode.set(mode);
    const el = document.getElementById('pairing-selector-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /** Поиск из hero: переключаемся на режим «по блюду», подставляем запрос и выбираем первое совпадение. */
  onHeroSearch(query: string) {
    this.selectedCuisine.set('');
    this.dishSearch.set(query);
    if (query) {
      const q = query.toLowerCase();
      const found = this.dishes().find(d => d.name.toLowerCase().includes(q));
      if (found) {
        this.selectedDish.set(found);
      }
    }
    this.scrollToSelector('dish');
  }

  applyMoodPreset(mood: MoodOption) {
    if (mood.targetType === 'dish') {
      this.discoveryMode.set('dish');
      const found = this.dishes().find(d => d.name.toLowerCase().includes(mood.targetName.toLowerCase()));
      if (found) {
        this.selectedDish.set(found);
      }
    } else {
      this.discoveryMode.set('brand');
      const found = this.brands().find(b => b.name.toLowerCase().includes(mood.targetName.toLowerCase()));
      if (found) {
        this.selectedBrand.set(found);
      }
    }
    const el = document.getElementById('pairing-selector-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  openPyramidModal(target: Brand | string) {
    if (typeof target === 'string') {
      const found = this.brands().find(b => b.name.toLowerCase() === target.toLowerCase());
      if (found) {
        this.api.getBrandDetail(found.id).subscribe(full => this.modalBrand.set(full));
      }
    } else {
      this.api.getBrandDetail(target.id).subscribe(full => this.modalBrand.set(full));
    }
  }

  closePyramidModal() {
    this.modalBrand.set(null);
  }

  getCuisineFlag(c: CuisineType): string {
    switch (c) {
      case 'KZ': return '🇰🇿';
      case 'ITALIAN': return '🇮🇹';
      case 'JAPANESE': return '🇯🇵';
      case 'AMERICAN': return '🇺🇸';
      case 'MEXICAN': return '🇲🇽';
      case 'GERMAN': return '🇩🇪';
      default: return '🍽️';
    }
  }

  getPairingTypeBadge(type: string): string {
    switch (type) {
      case 'CONTRAST': return '⚡ Contrast · Горечь режет жирность';
      case 'COMPLEMENT': return '🌿 Complement · Схожие ноты усиливают вкус';
      case 'CLEANSE': return '💧 Cleanse · Освежает рецепторы';
      case 'BRIDGE': return '🌉 Bridge · Общий мостик вкуса';
      default: return 'Сочетание';
    }
  }
}
