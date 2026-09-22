import { Component, OnInit, inject, signal, computed, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { SelectionService } from '../../services/selection.service';
import { Brand, Dish, FoodPairing, CuisineType, FoodIcon, SiteSettings } from '../../models/flavor-tree.models';
import { ActiveTab } from '../../app.component';
import { HeroComponent } from './hero/hero.component';
import { DishWizardComponent } from './dish-wizard.component';
import { DishResultComponent } from './dish-result.component';
import { BeerPairingsComponent } from './beer-pairings.component';
import { DishProfile, findDish } from './pairing-engine.data';

type MoodIcon = 'meat' | 'flame' | 'citrus' | 'fish' | 'mug' | 'cake';

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
    DishWizardComponent, DishResultComponent, BeerPairingsComponent,
  ],
  template: `
    <!-- ═══════════════════════════════════════════════════════════════
         1. HERO SECTION & VALUE PROPOSITION
         ═══════════════════════════════════════════════════════════════ -->
    @if (stage() === 'idle') {
      <app-hero (choose)="scrollToSelector($event)" (dishSearch)="onHeroSearch($event)" />
    }

    <!-- ═══════════════════════════════════════════════════════════════
         2. ПОДБОР: ДВА ПУТИ — ОТ БЛЮДА И ОТ НАПИТКА
         Вход только через две кнопки в hero. Дальше — мастер из четырёх
         вопросов для блюда либо витрина сортов для напитка.
         ═══════════════════════════════════════════════════════════════ -->
    @if (stage() !== 'idle') {
    <section id="pairing-selector-section" class="glass-panel p-4xl mb-4xl pairing-engine-panel">
      @switch (stage()) {
        @case ('wizard') {
          <app-dish-wizard
            [dishes]="dishes()"
            [icons]="foodIcons()"
            [restore]="dishProfile()"
            (done)="onProfileReady($event)"
            (dishPicked)="onExactDish($event)"
            (exit)="resetFlow()"
          />
        }

        @case ('dish-result') {
          @if (dishProfile(); as p) {
            <app-dish-result
              [profile]="p"
              [brands]="brands()"
              [dishes]="dishes()"
              [pairings]="pairings()"
              [icons]="foodIcons()"
              [alternatives]="settings().alternatives_count"
              (openBrand)="openBrandPage($event)"
              (back)="stage.set('wizard')"
              (restart)="resetFlow()"
            />
          }
        }

        @case ('brand') {
          <app-beer-pairings
            [brands]="brands()"
            [pairings]="pairings()"
            [dishes]="dishes()"
            [icons]="foodIcons()"
            [intro]="settings().pairing_intro"
            [minScore]="settings().min_score_to_show"
            (openBrand)="openBrandPage($event)"
            (exit)="resetFlow()"
          />
        }
      }
    </section>
    }

    <!-- ═══════════════════════════════════════════════════════════════
         3. ЭКСПРЕСС-ПОДБОР: ВКУСОВОЙ КОМПАС & НАСТРОЕНИЕ
         ═══════════════════════════════════════════════════════════════ -->
    <section class="page-section mb-4xl">
      <div class="section-head">
        <span class="badge">Экспресс-подбор</span>
        <h2 class="section-header">Сценарий вечера</h2>
        <p class="section-subtitle">Шесть готовых ситуаций. Нажмите на карточку и получите рекомендацию сразу, минуя вопросы мастера.</p>
      </div>

      <div class="mood-grid">
        @for (mood of moodPresets; track mood.id) {
          <button
            type="button"
            class="glass-card mood-card stagger-item"
            (click)="applyMoodPreset(mood)"
          >
            <span class="mood-icon" aria-hidden="true">
              @switch (mood.icon) {
                @case ('meat') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="M5 12a7 7 0 0 0 14 0"/><path d="M12 3v3"/><path d="M8 5.5V7"/><path d="M16 5.5V7"/><path d="M4 21h16"/></svg>
                }
                @case ('flame') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/></svg>
                }
                @case ('citrus') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/></svg>
                }
                @case ('fish') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c3-4.5 6.5-6.5 10-6.5S18.5 7.5 22 12c-3.5 4.5-6.5 6.5-10 6.5S5 16.5 2 12Z"/><circle cx="8" cy="12" r="1"/><path d="M16 8.5 22 5v14l-6-3.5"/></svg>
                }
                @case ('mug') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>
                }
                @case ('cake') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M4 21v-6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6"/><path d="M4 16c1.5 1.5 3 1.5 4 0s2.5-1.5 4 0 3 1.5 4 0 2.5-1.5 4 0"/><path d="M12 9V6"/><path d="M12 4.5 13 3l-1-1-1 1 1 1.5Z"/></svg>
                }
              }
            </span>
            <h3 class="mood-title">{{ mood.title }}</h3>
            <p class="text-dim text-sm mood-desc">{{ mood.desc }}</p>
            <span class="mood-foot mt-auto">
              <span class="badge">{{ mood.badge }}</span>
              <span class="mood-cta">
                Выбрать
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
              </span>
            </span>
          </button>
        }
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════
         4. ХРОНОМЕТРАЖ ГЛОТКА (СЕНСОРНАЯ ПИРАМИДА)
         ═══════════════════════════════════════════════════════════════ -->
    <section class="glass-panel p-4xl mb-4xl">
      <div class="section-head center">
        <span class="badge">Методология дегустации</span>
        <h2 class="section-header">Хронометраж глотка</h2>
        <p class="section-subtitle">Один глоток раскладывается на три слоя по времени. Так же, как пирамида аромата в парфюмерии.</p>
      </div>

      <!-- Шкала времени: подсказывает, что три карточки идут подряд, а не параллельно -->
      <div class="pyramid-timeline" aria-hidden="true">
        <span class="pyramid-timeline-dot top-dot"></span>
        <span class="pyramid-timeline-dot heart-dot"></span>
        <span class="pyramid-timeline-dot base-dot"></span>
      </div>

      <div class="pyramid-grid">
        <div class="glass-card p-2xl stagger-item pyramid-info-card top-layer">
          <div class="pyramid-time-badge top-time">0–3 сек</div>
          <h3 class="mb-xs">Top Notes</h3>
          <p class="pyramid-info-sub">Ароматическая вершина</p>
          <p class="text-dim text-sm mb-lg">Первое впечатление при поднесении бокала: эфирные масла хмеля, цитрусовые, хвойные и цветочные летучие ароматы.</p>
          <div class="pyramid-examples mt-auto">
            <span>Цитрус</span><span>Хвоя</span><span>Зелёное яблоко</span><span>Травы</span>
          </div>
        </div>

        <div class="glass-card p-2xl stagger-item pyramid-info-card heart-layer">
          <div class="pyramid-time-badge heart-time">3–15 сек</div>
          <h3 class="mb-xs">Heart Notes</h3>
          <p class="pyramid-info-sub">Солодовое сердце</p>
          <p class="text-dim text-sm mb-lg">Полнота вкуса и тела на языке: баланс солодовой сладости, хлебной корочки, зерновых тонов и текстуры.</p>
          <div class="pyramid-examples mt-auto">
            <span>Солод</span><span>Карамель</span><span>Хлебная корочка</span><span>Рис</span>
          </div>
        </div>

        <div class="glass-card p-2xl stagger-item pyramid-info-card base-layer">
          <div class="pyramid-time-badge base-time">15+ сек</div>
          <h3 class="mb-xs">Base Notes</h3>
          <p class="pyramid-info-sub">База и послевкусие</p>
          <p class="text-dim text-sm mb-lg">Финальный шлейф после глотка: благородная горчинка, сухость, обжаренные тона и очищающая свежесть рецепторов.</p>
          <div class="pyramid-examples mt-auto">
            <span>Хмелевая горечь</span><span>Жжёный солод</span><span>Сухой финиш</span>
          </div>
        </div>
      </div>
    </section>

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

    /* ── Экспресс-сценарии ────────────────────────────────────── */
    .mood-grid {
      display: grid;
      gap: var(--space-2xl);
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    @media (max-width: 1040px) {
      .mood-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 620px) {
      .mood-grid { grid-template-columns: 1fr; }
    }

    /* Карточка теперь <button>: сбрасываем оформление кнопки и выравниваем по левому краю. */
    .mood-card {
      font-family: inherit;
      text-align: left;
      color: inherit;
      appearance: none;
      overflow: hidden;
    }
    .mood-card::before {
      content: '';
      position: absolute;
      inset: auto -30% -60% auto;
      width: 260px;
      height: 260px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(245, 158, 11, 0.16), transparent 68%);
      opacity: 0;
      transition: opacity var(--duration-normal) var(--ease-out);
      pointer-events: none;
    }
    .mood-card:hover::before { opacity: 1; }

    .mood-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 52px;
      height: 52px;
      margin-bottom: var(--space-lg);
      border-radius: var(--radius-lg);
      background: linear-gradient(140deg, rgba(254, 243, 199, 0.95), rgba(253, 230, 187, 0.85));
      border: 1px solid rgba(180, 83, 9, 0.16);
      color: var(--beer-deep);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
      transition: transform var(--duration-normal) var(--ease-spring);
    }
    .mood-icon svg { width: 26px; height: 26px; }
    .mood-card:hover .mood-icon { transform: rotate(-6deg) scale(1.06); }

    .mood-title {
      font-size: 1.12rem;
      margin-bottom: var(--space-xs);
    }
    .mood-desc {
      margin-bottom: var(--space-xl);
    }
    .mood-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-md);
      padding-top: var(--space-lg);
      border-top: 1px solid var(--line-subtle);
    }
    .mood-cta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--beer-mid);
      font-weight: 700;
      font-size: 0.86rem;
      white-space: nowrap;
    }
    .mood-cta svg { width: 15px; height: 15px; transition: transform var(--duration-fast) var(--ease-out); }
    .mood-card:hover .mood-cta svg { transform: translateX(4px); }

    /* ── Пирамида ──────────────────────────────────────────────── */
    .pyramid-grid {
      display: grid;
      gap: var(--space-2xl);
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    @media (max-width: 900px) {
      .pyramid-grid { grid-template-columns: 1fr; }
    }

    /* Линия времени над карточками: слева направо, от аромата к послевкусию. */
    .pyramid-timeline {
      position: relative;
      height: 2px;
      margin: 0 6% var(--space-xl);
      border-radius: var(--radius-full);
      background: linear-gradient(90deg, #FDE68A, #FDBA74 50%, #D6D3D1);
    }
    .pyramid-timeline-dot {
      position: absolute;
      top: 50%;
      width: 12px;
      height: 12px;
      margin: -6px 0 0 -6px;
      border-radius: 50%;
      border: 2px solid var(--bg-1);
      box-shadow: 0 2px 6px rgba(180, 83, 9, 0.25);
    }
    .top-dot { left: 16.6%; background: #FACC15; }
    .heart-dot { left: 50%; background: #FB923C; }
    .base-dot { left: 83.3%; background: #78716C; }
    @media (max-width: 900px) {
      .pyramid-timeline { display: none; }
    }

    .pyramid-info-card {
      position: relative;
      overflow: hidden;
    }
    /* Цветная кромка сверху привязывает карточку к точке на шкале времени. */
    .pyramid-info-card::before {
      content: '';
      position: absolute;
      inset: 0 0 auto 0;
      height: 3px;
    }
    .top-layer::before { background: linear-gradient(90deg, #FDE68A, #FACC15); }
    .heart-layer::before { background: linear-gradient(90deg, #FED7AA, #FB923C); }
    .base-layer::before { background: linear-gradient(90deg, #E7E5E4, #A8A29E); }

    .pyramid-info-sub {
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: var(--space-md);
    }
    .pyramid-examples {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding-top: var(--space-lg);
      border-top: 1px solid var(--line-subtle);
    }
    .pyramid-examples span {
      padding: 3px 10px;
      border-radius: var(--radius-full);
      background: rgba(180, 83, 9, 0.06);
      border: 1px solid var(--line-subtle);
      font-size: 0.74rem;
      font-weight: 600;
      color: var(--foam-dim);
    }
    .pyramid-time-badge {
      display: inline-block;
      align-self: flex-start;
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
  private selection = inject(SelectionService);

  @Output() navigate = new EventEmitter<ActiveTab>();

  // Данные
  brands = signal<Brand[]>([]);
  dishes = signal<Dish[]>([]);
  pairings = signal<FoodPairing[]>([]);

  // Картинки характеристик и настройки витрины — из админки
  foodIcons = signal<FoodIcon[]>([]);
  settings = signal<SiteSettings>({
    alternatives_count: 3,
    min_score_to_show: 1,
    show_wheat_decor: true,
    pairing_intro: '',
  });

  /**
   * Шаг подбора. Вход всегда через две кнопки: 'idle' — выбор пути,
   * 'wizard' — четыре вопроса о блюде, 'dish-result' — сорта к блюду,
   * 'brand' — витрина сортов и пары к выбранному.
   */
  stage = signal<'idle' | 'wizard' | 'dish-result' | 'brand'>('idle');

  /** Ответы мастера: сохраняем, чтобы «изменить ответы» не начинало заново. */
  dishProfile = signal<DishProfile | null>(null);

  selectedDish = signal<Dish | null>(null);
  selectedBrand = signal<Brand | null>(null);


  // Экспресс-сценарии настроения (на основе CustDev-сегментов)
  moodPresets: MoodOption[] = [
    {
      id: 'kazakh',
      icon: 'meat',
      title: 'Казахское застолье',
      desc: 'Бешбармак, казы, куырдак — баланс плотного умами и солода.',
      targetType: 'dish',
      targetName: 'Бешбармак',
      badge: 'Казахская кухня'
    },
    {
      id: 'steak',
      icon: 'flame',
      title: 'Мясо на гриле & BBQ',
      desc: 'Шашлык, стейк, рёбрышки — высокая горечь гасит жирность.',
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
      badge: 'Свежесть 5–7°C'
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

    this.api.getFoodIcons().subscribe(icons => this.foodIcons.set(icons));
    this.api.getSettings().subscribe(settings => this.settings.set(settings));
  }

  // ─── Переходы подбора ───────────────────────────────────────────

  startDish(): void {
    this.dishProfile.set(null);
    this.stage.set('wizard');
  }

  startBrand(): void {
    this.stage.set('brand');
  }

  /** Мастер пройден — показываем сорта под собранный профиль. */
  onProfileReady(profile: DishProfile): void {
    this.dishProfile.set(profile);
    this.stage.set('dish-result');
    this.scrollToSection();
  }

  /**
   * Человек назвал блюдо, которое уже есть в каталоге. Профиль собираем
   * из его же характеристик — так подбор опирается на данные сомелье,
   * а не на догадки по названию.
   */
  onExactDish(dish: Dish): void {
    this.selectedDish.set(dish);
    this.dishProfile.set({
      category: null,
      cooking: dish.cooking_method === 'OTHER' ? null : dish.cooking_method,
      taste: dish.dominant_taste,
      weight: dish.weight,
      fat: dish.fat_level,
      freeText: dish.name,
    });
    this.stage.set('dish-result');
    this.scrollToSection();
  }

  resetFlow(): void {
    this.dishProfile.set(null);
    this.stage.set('idle');
    this.scrollToSection();
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




  /** Две кнопки из hero — единственный вход в подбор. */
  scrollToSelector(mode: 'dish' | 'brand') {
    if (mode === 'dish') this.startDish(); else this.startBrand();
    this.scrollToSection();
  }

  /**
   * Поиск из hero. Если блюдо нашлось в каталоге — сразу показываем сорта,
   * иначе открываем мастер: по одному названию подобрать нечего.
   */
  onHeroSearch(query: string) {
    const found = findDish(this.dishes(), query);
    if (found) { this.onExactDish(found); return; }
    this.startDish();
    this.scrollToSection();
  }

  /** Экспресс-сценарий: сразу ведём к результату, минуя вопросы. */
  applyMoodPreset(mood: MoodOption) {
    if (mood.targetType === 'dish') {
      const found = this.dishes().find(d => d.name.toLowerCase().includes(mood.targetName.toLowerCase()));
      if (found) { this.onExactDish(found); return; }
      this.startDish();
    } else {
      const found = this.brands().find(b => b.name.toLowerCase().includes(mood.targetName.toLowerCase()));
      if (found) this.selectedBrand.set(found);
      this.startBrand();
    }
    this.scrollToSection();
  }




}
