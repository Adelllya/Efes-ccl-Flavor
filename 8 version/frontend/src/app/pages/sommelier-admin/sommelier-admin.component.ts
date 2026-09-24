import { Component, EventEmitter, OnDestroy, OnInit, Output, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { PanelTab } from '../../models/navigation';
import { Brand, Dish, FlavorNote, FoodPairing, UserRole } from '../../models/flavor-tree.models';
import { PanelIconComponent } from './panel-icons';
import { PanelBrandsComponent } from './panel-brands.component';
import { PanelRequestsComponent } from './panel-requests.component';
import { PanelPairingsComponent } from './panel-pairings.component';
import { PanelNotesComponent } from './panel-notes.component';
import { PanelDishesComponent } from './panel-dishes.component';
import { PanelMenuComponent } from './panel-menu.component';
import { PanelOrdersComponent } from './panel-orders.component';
import { PanelUsersComponent } from './panel-users.component';
import { PanelSettingsComponent } from './panel-settings.component';

interface PanelTabDef {
  id: PanelTab;
  label: string;
  icon: string;
  description: string;
  /** null: без счётчика в рейле (например, ноль ожидающих запросов). */
  count?: () => number | null;
  /** false, пока данные для счётчика ещё не пришли: в рейле и обзоре число не показываем. */
  loaded?: () => boolean;
}

interface VisibleTab {
  id: PanelTab;
  label: string;
  icon: string;
  description: string;
  badge: number | null;
  loaded: boolean;
}

interface StatCard {
  id: string;
  tab: PanelTab;
  icon: string;
  value: number;
  label: string;
  sub?: string;
  accent?: boolean;
  loaded: boolean;
}

type DataSource = 'brands' | 'notes' | 'pairings' | 'dishes';

const SOURCE_LABELS: Record<DataSource, string> = {
  brands: 'сорта',
  notes: 'ноты',
  pairings: 'сочетания',
  dishes: 'блюда'
};

/** С какой вкладки начинает роль. Обзор остаётся первым в списке. */
const DEFAULT_TAB: Partial<Record<UserRole, PanelTab>> = {
  sommelier: 'brands',
  restaurant_admin: 'menu'
};

/** Как часто обновляем число новых заказов, пока панель открыта. */
const ORDERS_POLL_MS = 20000;

/**
 * Панель: рейл слева, справа вкладка. Каждая вкладка сама рисует
 * свои колонки "список" и "детали" классами .wa-* из panel.css.
 */
@Component({
  selector: 'app-sommelier-admin',
  standalone: true,
  imports: [
    PanelIconComponent,
    PanelBrandsComponent, PanelRequestsComponent, PanelPairingsComponent, PanelNotesComponent,
    PanelDishesComponent, PanelMenuComponent, PanelOrdersComponent, PanelUsersComponent, PanelSettingsComponent
  ],
  template: `
    <div class="wa-shell">
      <aside class="wa-rail">
        <div class="wa-rail-brand">
          <span class="wa-rail-logo">FT</span>
          <span class="wa-rail-brand-text">
            <strong>Flavor Tree</strong>
            <small>Панель управления</small>
          </span>
        </div>

        <nav class="wa-nav">
          @for (t of visibleTabs(); track t.id) {
            <button type="button" class="wa-nav-row" [class.active]="activeTab() === t.id" [title]="t.label" (click)="setTab(t.id)">
              <panel-icon [name]="t.icon" />
              <span class="wa-nav-label">{{ t.label }}</span>
              @if (t.badge !== null && t.loaded) {
                <span class="wa-nav-count">{{ t.badge }}</span>
              }
            </button>
          }
        </nav>

        <div class="wa-rail-foot">
          @if (auth.role() === 'moderator') {
            <a class="wa-rail-link" href="http://127.0.0.1:8000/admin/" target="_blank" rel="noopener" title="Django admin">
              <panel-icon name="external" /><span class="wa-nav-label">Django admin</span>
            </a>
          }
          @if (auth.user(); as u) {
            <div class="wa-user">
              <span class="wa-user-avatar">{{ (u.first_name || u.username).charAt(0) }}</span>
              <span class="wa-user-text">
                <span class="wa-user-name">{{ u.first_name || u.username }}</span>
                <span class="wa-user-role">{{ u.role_display }}</span>
              </span>
              <button type="button" class="wa-iconbtn" title="Выйти" (click)="auth.logout()">
                <panel-icon name="logout" />
              </button>
            </div>
          }
        </div>
      </aside>

      <section class="wa-main">
        @if (loadErrorText(); as text) {
          <div class="wa-loadbar">
            <panel-icon name="alert" />
            <span>{{ text }}</span>
            <button type="button" class="btn-outline" (click)="loadData()"><panel-icon name="refresh" /> Обновить</button>
          </div>
        }

        @switch (activeTab()) {

          @case ('overview') {
            <div class="wa-page wa-page-single">
              <div class="wa-overview">
                <div class="wa-card wa-hero">
                  <div>
                    <span class="wa-chip wa-chip-approved">{{ auth.user()?.role_display || 'Панель' }}</span>
                    <h2 class="wa-hero-title">Панель Flavor Tree</h2>
                    <p class="wa-hero-text">{{ overviewText() }}</p>
                  </div>
                  <button type="button" class="btn-outline" (click)="loadData()">
                    <panel-icon name="refresh" /> Обновить данные
                  </button>
                </div>

                @if (statCards().length) {
                  <div class="wa-stats">
                    @for (s of statCards(); track s.id) {
                      <button type="button" class="wa-stat" [class.wa-stat-accent]="s.accent" (click)="setTab(s.tab)">
                        <panel-icon [name]="s.icon" size="lg" />
                        <strong>{{ s.loaded ? s.value : '...' }}</strong>
                        <span>{{ s.label }}</span>
                        @if (s.sub) { <small>{{ s.sub }}</small> }
                      </button>
                    }
                  </div>
                }

                <div class="wa-card">
                  <h3 class="wa-card-title">Разделы</h3>
                  <div class="wa-quick">
                    @for (t of quickTabs(); track t.id) {
                      <button type="button" class="wa-quick-row" (click)="setTab(t.id)">
                        <panel-icon [name]="t.icon" />
                        <span class="wa-quick-text">
                          <strong>{{ t.label }}</strong>
                          <small>{{ t.description }}</small>
                        </span>
                        <panel-icon name="chevronRight" />
                      </button>
                    }
                  </div>
                </div>
              </div>
            </div>
          }

          @case ('brands') {
            <panel-brands [brands]="brands()" [notes]="notes()" [loaded]="loaded().brands"
                          (brandsChanged)="brands.set($event)" (requestsChanged)="refreshRequestCounts()" />
          }

          @case ('requests') {
            <panel-requests (reviewed)="onReviewed()" />
          }

          @case ('pairings') {
            <panel-pairings [pairings]="pairings()" [brands]="brands()" [dishes]="dishes()" [loaded]="loaded().pairings"
                            (changed)="pairings.set($event)" />
          }

          @case ('notes') {
            <panel-notes [notes]="notes()" [loaded]="loaded().notes" />
          }

          @case ('dishes') {
            <panel-dishes [dishes]="dishes()" [loaded]="loaded().dishes" (changed)="dishes.set($event)" (deleted)="onDishDeleted($event)" />
          }

          @case ('menu') {
            <panel-menu [dishes]="dishes()" [loaded]="loaded().dishes" [brands]="brands()" [brandsLoaded]="loaded().brands"
                        (openMenu)="openMenu.emit($event)" />
          }

          @case ('orders') {
            <panel-orders [venue]="ordersVenue()" (venueChanged)="onOrdersVenue($event)" (changed)="refreshOrderCount()" />
          }

          @case ('users') {
            <panel-users />
          }

          @case ('settings') {
            <panel-settings />
          }
        }
      </section>
    </div>
  `
})
export class SommelierAdminComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  readonly auth = inject(AuthService);

  /** Slug заведения: AppComponent открывает его гостевое меню. */
  @Output() openMenu = new EventEmitter<string>();

  readonly tabs: PanelTabDef[] = [
    { id: 'overview', label: 'Обзор', icon: 'overview', description: 'Сводка и быстрый переход' },
    {
      id: 'brands', label: 'Сорта', icon: 'brands', description: 'Фото, вкусовая пирамида и подача каждого сорта',
      count: () => this.brands().length, loaded: () => this.loaded().brands
    },
    { id: 'requests', label: 'Запросы', icon: 'inbox', description: 'Предложения сомелье: принять или отклонить', count: () => this.pendingCount() || null },
    {
      id: 'pairings', label: 'Сочетания', icon: 'pairings', description: 'Какие блюда подходят к сортам',
      count: () => this.pairings().length, loaded: () => this.loaded().pairings
    },
    {
      id: 'notes', label: 'Ноты', icon: 'notes', description: 'Справочник вкусовых нот колеса Meilgaard',
      count: () => this.notes().length, loaded: () => this.loaded().notes
    },
    {
      id: 'dishes', label: 'Блюда', icon: 'dishes', description: 'Справочник блюд: вкус, вес, способ приготовления',
      count: () => this.dishes().length, loaded: () => this.loaded().dishes
    },
    { id: 'menu', label: 'Меню', icon: 'menu', description: 'Карточка заведения, позиции меню с ценами и карта напитков' },
    { id: 'orders', label: 'Заказы', icon: 'orders', description: 'Заказы гостей: стол, позиции, статус', count: () => this.newOrdersCount() || null },
    { id: 'users', label: 'Пользователи', icon: 'users', description: 'Роли и заведения пользователей' },
    { id: 'settings', label: 'Настройки', icon: 'settings', description: 'Витрина: сколько сортов показывать, вступительный текст' }
  ];

  readonly visibleTabs = computed<VisibleTab[]>(() =>
    this.tabs
      .filter(t => this.auth.can(t.id))
      .map(t => ({
        id: t.id, label: t.label, icon: t.icon, description: t.description,
        badge: t.count ? t.count() : null,
        loaded: t.loaded ? t.loaded() : true
      }))
  );
  readonly quickTabs = computed(() => this.visibleTabs().filter(t => t.id !== 'overview'));
  readonly activeTab = signal<PanelTab>('overview');

  readonly overviewText = computed(() => {
    switch (this.auth.role()) {
      case 'moderator': return 'Сорта, запросы сомелье, сочетания, блюда, меню и заказы заведений, пользователи';
      case 'sommelier': return 'Сочетания блюд и сортов, предложения по пирамидам и подаче';
      case 'restaurant_admin': return 'Меню и заказы вашего заведения, справочник блюд';
      default: return '';
    }
  });

  brands = signal<Brand[]>([]);
  notes = signal<FlavorNote[]>([]);
  pairings = signal<FoodPairing[]>([]);
  dishes = signal<Dish[]>([]);

  /** Что уже пришло с сервера. Пока false, вкладки показывают "Загрузка...", а не пустые списки. */
  loaded = signal<Record<DataSource, boolean>>({ brands: false, notes: false, pairings: false, dishes: false });
  /** Какие справочники не удалось прочитать: строка ошибки над вкладкой с кнопкой "Обновить". */
  loadFailed = signal<DataSource[]>([]);
  private loadErrorDetail = signal<string | null>(null);

  readonly loadErrorText = computed(() => {
    const failed = this.loadFailed();
    if (!failed.length) return null;
    const what = failed.map(s => SOURCE_LABELS[s]).join(', ');
    const detail = this.loadErrorDetail();
    return `Не удалось загрузить: ${what}.` + (detail ? ` ${detail}` : '');
  });

  /** Модератор: сколько запросов ждут решения. Сомелье: сколько запросов он отправил. */
  pendingCount = signal(0);
  myRequestsCount = signal(0);
  myPendingCount = signal(0);

  /** Заказы: заведение вкладки заказов (владельцу по нему же считаем бейдж) и число новых заказов. */
  ordersVenue = signal<string | null>(null);
  newOrdersCount = signal(0);
  private ordersTimer: ReturnType<typeof setInterval> | null = null;

  readonly statCards = computed<StatCard[]>(() => {
    const visible = this.visibleTabs();
    const cards: StatCard[] = visible
      .filter(t => t.id !== 'requests' && t.id !== 'orders' && t.badge !== null)
      .map(t => ({ id: t.id, tab: t.id, icon: t.icon, value: t.badge ?? 0, label: t.label, loaded: t.loaded }));
    const role = this.auth.role();
    const first: StatCard[] = [];
    if (role === 'moderator') {
      const n = this.pendingCount();
      first.push({ id: 'pending', tab: 'requests', icon: 'inbox', value: n, label: 'Ожидают подтверждения', accent: n > 0, loaded: true });
    } else if (role === 'sommelier') {
      first.push({
        id: 'mine', tab: 'brands', icon: 'send', value: this.myRequestsCount(), label: 'Мои запросы',
        sub: this.myPendingCount() ? `ожидают: ${this.myPendingCount()}` : undefined, loaded: true
      });
    }
    if (visible.some(t => t.id === 'orders')) {
      const n = this.newOrdersCount();
      first.push({
        id: 'orders', tab: 'orders', icon: 'orders', value: n, label: 'Новые заказы', accent: n > 0, loaded: true,
        sub: role === 'moderator' ? 'по всем заведениям' : (this.ordersVenue() ? undefined : 'заведение не выбрано')
      });
    }
    return [...first, ...cards];
  });

  constructor() {
    // Если роль сменилась и текущая вкладка закрыта, уходим на первую доступную
    effect(() => {
      const visible = this.visibleTabs();
      const current = untracked(this.activeTab);
      if (visible.length && !visible.some(t => t.id === current)) this.activeTab.set(visible[0].id);
    }, { allowSignalWrites: true });

    // Своё заведение могло появиться уже в панели (создали на вкладке меню): бейдж заказов подхватывает его сразу
    effect(() => {
      const own = this.auth.user()?.venue?.slug ?? null;
      if (own && this.auth.role() !== 'moderator') untracked(() => this.onOrdersVenue(own));
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    this.pickDefaultTab();
    this.loadData();
    this.startOrdersPolling();
  }

  ngOnDestroy() {
    if (this.ordersTimer !== null) clearInterval(this.ordersTimer);
    this.ordersTimer = null;
  }

  setTab(id: PanelTab) {
    if (this.visibleTabs().some(t => t.id === id)) this.activeTab.set(id);
  }

  private pickDefaultTab() {
    const role = this.auth.role();
    if (!role || role === 'moderator') return;
    const visible = this.visibleTabs();
    const preferred = DEFAULT_TAB[role];
    const pick = visible.find(t => t.id === preferred) ?? visible.find(t => t.id !== 'overview');
    if (pick) this.activeTab.set(pick.id);
  }

  /** Читаем только то, что нужно роли; без заглушек: ошибка попадает в строку над вкладкой. */
  loadData() {
    const can = (tab: PanelTab) => this.auth.can(tab);
    const needs: Record<DataSource, boolean> = {
      brands: can('brands') || can('menu') || can('pairings'),
      notes: can('brands') || can('notes'),
      pairings: can('pairings'),
      dishes: can('dishes') || can('menu') || can('pairings')
    };
    this.loaded.set({ brands: !needs.brands, notes: !needs.notes, pairings: !needs.pairings, dishes: !needs.dishes });
    this.loadFailed.set([]);
    this.loadErrorDetail.set(null);

    if (needs.brands) {
      this.api.getBrandsStrict().subscribe({
        next: list => this.received('brands', () => this.brands.set(list)),
        error: err => this.failed('brands', err)
      });
    }
    if (needs.notes) {
      this.api.getFlavorNotesStrict().subscribe({
        next: list => this.received('notes', () => this.notes.set(list)),
        error: err => this.failed('notes', err)
      });
    }
    if (needs.pairings) {
      this.api.getPairings().subscribe({
        next: list => this.received('pairings', () => this.pairings.set(list)),
        error: err => this.failed('pairings', err)
      });
    }
    if (needs.dishes) {
      this.api.getDishes().subscribe({
        next: list => this.received('dishes', () => this.dishes.set(list)),
        error: err => this.failed('dishes', err)
      });
    }
    this.refreshRequestCounts();
    this.refreshOrderCount();
  }

  private received(source: DataSource, apply: () => void) {
    apply();
    this.loaded.update(l => ({ ...l, [source]: true }));
  }

  private failed(source: DataSource, err: unknown) {
    this.loaded.update(l => ({ ...l, [source]: true }));
    this.loadFailed.update(list => list.includes(source) ? list : [...list, source]);
    this.loadErrorDetail.set(AuthService.errorText(err));
  }

  /** Счётчики запросов: бейдж в рейле и карточки обзора. Ошибки не показываем, это фон. */
  refreshRequestCounts() {
    const role = this.auth.role();
    if (role === 'moderator') {
      this.api.getPendingRequestCount().subscribe({
        next: n => this.pendingCount.set(n),
        error: () => this.pendingCount.set(0)
      });
    } else if (role === 'sommelier') {
      this.api.getChangeRequests().subscribe({
        next: list => {
          this.myRequestsCount.set(list.length);
          this.myPendingCount.set(list.filter(r => r.status === 'PENDING').length);
        },
        error: () => {
          this.myRequestsCount.set(0);
          this.myPendingCount.set(0);
        }
      });
    }
  }

  /** После решения модератора пирамида или подача сорта изменилась: обновляем список сортов. */
  onReviewed() {
    this.refreshRequestCounts();
    this.api.getBrandsStrict().subscribe({
      next: list => this.brands.set(list),
      error: () => {}
    });
  }

  /** Вместе с блюдом сервер удалил его сочетания: убираем их сразу и перечитываем список. */
  onDishDeleted(dishId: string) {
    this.pairings.update(list => list.filter(p => p.dish !== dishId));
    this.api.getPairings().subscribe({
      next: list => this.pairings.set(list),
      error: () => {}
    });
  }

  // Заказы

  /** Своё заведение владельца подхватывает effect в конструкторе, модератору бейдж считается по всем: здесь только таймер. */
  private startOrdersPolling() {
    if (!this.auth.can('orders')) return;
    this.ordersTimer = setInterval(() => this.refreshOrderCount(), ORDERS_POLL_MS);
  }

  onOrdersVenue(slug: string) {
    if (!slug || slug === this.ordersVenue()) return;
    this.ordersVenue.set(slug);
    // Модератору бейдж считается по всем заведениям, выбор в списке на него не влияет
    if (this.auth.role() === 'moderator') return;
    this.newOrdersCount.set(0);
    this.refreshOrderCount();
  }

  /** Число новых заказов для бейджа и карточки обзора: владельцу по своему заведению, модератору по всем.
   *  Ошибки не показываем: это фоновый опрос. */
  refreshOrderCount() {
    if (!this.auth.can('orders')) return;
    const all = this.auth.role() === 'moderator';
    const slug = all ? null : this.ordersVenue();
    if (!all && !slug) return;
    this.api.getNewOrderCount(slug ?? undefined).subscribe({
      next: n => {
        if (all || this.ordersVenue() === slug) this.newOrdersCount.set(n);
      },
      error: () => {}
    });
  }
}
