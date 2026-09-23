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
