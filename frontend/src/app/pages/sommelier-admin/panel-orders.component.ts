import { Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import {
  ORDER_FLOW, ORDER_STATUS_LABELS, Order, OrderItem, OrderStatus, Venue, isOrderClosed, nextOrderStatus
} from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { OrderAlertService } from './order-alert.service';
import {
  ORDER_NEXT_LABELS, ORDER_STATUS_CHIP, confirmTwice, countOf, flash, formatAgo, formatMoney, formatWhen, isErrorText,
  onTabReturn
} from './panel-shared';

type OrderFilter = 'new' | 'active' | 'closed' | 'all';

const ACTIVE_STATUSES: readonly OrderStatus[] = ['ACCEPTED', 'COOKING', 'SERVED'];
/** Незакрытые заказы: только их перечитываем по таймеру. */
const OPEN_STATUSES: OrderStatus[] = ['NEW', 'ACCEPTED', 'COOKING', 'SERVED'];
/** Закрытые читаем по запросу, когда открыт их фильтр, и не всю историю. */
const CLOSED_STATUSES: OrderStatus[] = ['DONE', 'CANCELLED'];
const CLOSED_LIMIT = 50;
/** Как часто перечитываем незакрытые заказы, пока вкладка на экране. */
const POLL_MS = 20000;

function matchesFilter(o: Order, f: OrderFilter): boolean {
  switch (f) {
    case 'new': return o.status === 'NEW';
    case 'active': return ACTIVE_STATUSES.includes(o.status);
    case 'closed': return isOrderClosed(o.status);
    default: return true;
  }
}

/** Новые сверху: номер заказа растёт внутри заведения вместе со временем создания. */
function sortOrders(list: Order[]): Order[] {
  return [...list].sort((a, b) => b.number - a.number);
}

/**
 * Вкладка "Заказы": заказы гостей выбранного заведения. Владелец видит своё заведение,
 * модератор выбирает из списка. Слева строки со статусом, справа позиции и кнопки перехода.
 */
@Component({
  selector: 'panel-orders',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent],
  template: `
    <div class="wa-page" [class.has-selection]="selectedOne().length > 0">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Orders
            @if (counts().new > 0) { <span class="wa-count wa-count-accent">{{ counts().new }}</span> }
          </h2>
          <button type="button" class="wa-iconbtn" title="Refresh" aria-label="Refresh" [disabled]="loading() || !slug()" (click)="refresh()">
            <panel-icon name="refresh" />
          </button>
        </div>
        @if (isModerator()) {
          <div class="wa-venue-pick">
            <ft-select [options]="venueOptions()" [searchable]="true" ariaLabel="Venue"
                       [placeholder]="venuesLoading() ? 'Loading venues...' : (venuesError() ? 'Venues failed to load' : 'Choose a venue')"
                       searchPlaceholder="Venue name" emptyText="No venues yet"
                       [disabled]="venuesLoading() || (!!venuesError() && !venues().length)"
                       [ngModel]="slug() || ''" (ngModelChange)="pickVenue($event)" />
          </div>
        }
        @if (slug()) {
          <!-- Для смены в баре: приём заказов, звук и экран без сна -->
          <div class="wa-orders-tools">
            <label class="wa-check">
              <input type="checkbox" [checked]="acceptsOrders()" [disabled]="acceptsSaving() || !venueInfo()"
                     (change)="setAcceptsOrders($any($event.target).checked)" />
              Accept orders through the app
            </label>
            @if (venueInfo() && !acceptsOrders()) {
              <p class="wa-hint">Guests can browse the menu but can't place an order: they're asked to show their list to a server instead.</p>
            }
            <div class="wa-orders-toggles">
              <button type="button" class="btn-outline panel-btn-sm" [class.active]="alerts.soundOn()" [attr.aria-pressed]="alerts.soundOn()"
                      (click)="alerts.toggleSound()" title="A short chime when a new order comes in">
                <panel-icon [name]="alerts.soundOn() ? 'bell' : 'bellOff'" /> {{ alerts.soundOn() ? 'Sound on' : 'Sound off' }}
              </button>
              <button type="button" class="btn-outline panel-btn-sm" [class.active]="alerts.wakeWanted()" [attr.aria-pressed]="alerts.wakeWanted()"
                      [disabled]="!alerts.wakeSupported" (click)="alerts.toggleWake()"
                      [title]="alerts.wakeSupported ? 'The tablet or phone screen stays on while the panel is open' : 'This browser can’t keep the screen on'">
                <panel-icon name="sun" /> {{ alerts.wakeActive() ? 'Screen stays on' : 'Keep screen on' }}
              </button>
            </div>
            @if (alerts.soundOn() && !alerts.audioReady()) {
              <p class="wa-hint">Tap the screen once: the browser won't allow sound until you do.</p>
            }
            @if (alerts.wakeError()) { <p class="wa-hint wa-error">{{ alerts.wakeError() }}</p> }
          </div>
        }
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Order number, table or guest name" aria-label="Search by order number, table or guest name"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <div class="wa-pills">
          @for (p of pills; track p.value) {
            <button type="button" class="wa-pill" [class.active]="filter() === p.value" (click)="setFilter(p.value)">
              {{ p.label }}@if (pillCount(p.value); as n) { <span class="wa-pill-count">{{ n }}</span> }
            </button>
          }
        </div>
        @if (msg()) {
          <p class="wa-msg" [class.error]="isError(msg())" [attr.role]="isError(msg()) ? 'alert' : 'status'">{{ msg() }}</p>
        }
        <div class="wa-rows">
          @if (venuesError()) {
            <!-- Не "Выберите заведение": список заведений не прочитан, выбирать не из чего -->
            <div class="wa-loadbar" role="alert">
              <panel-icon name="alert" />
              <span>{{ venuesError() }}</span>
              <button type="button" class="btn-outline" (click)="loadVenues()"><panel-icon name="refresh" /> Refresh</button>
            </div>
          }
          @if (!slug()) {
            @if (!venuesError()) {
              <p class="wa-empty">{{ emptyVenueText() }}</p>
            }
          } @else if (!loaded()) {
            @if (loadError()) {
              <div class="wa-loadbar" role="alert">
                <panel-icon name="alert" />
                <span>{{ loadError() }}</span>
                <button type="button" class="btn-outline" (click)="refresh()"><panel-icon name="refresh" /> Refresh</button>
              </div>
            } @else {
              <p class="wa-empty">Loading...</p>
            }
          } @else {
            @if (loadError()) {
              <p class="wa-error wa-error-inline" role="alert">{{ loadError() }}</p>
            }
            @if (showsClosed() && closedError()) {
              <div class="wa-loadbar" role="alert">
                <panel-icon name="alert" />
                <span>{{ closedError() }}</span>
                <button type="button" class="btn-outline" (click)="loadClosed()"><panel-icon name="refresh" /> Refresh</button>
              </div>
            }
            @for (o of filtered(); track o.id) {
              <button type="button" class="wa-row" [class.active]="selectedId() === o.id" (click)="select(o.id)">
                <span class="wa-avatar wa-avatar-table" [class.is-new]="o.status === 'NEW'" [title]="tableText(o)">{{ tableShort(o) }}</span>
                <span class="wa-row-body">
                  <span class="wa-row-title">№{{ o.number }}<span class="wa-dot"></span>{{ tableText(o) }}</span>
                  <span class="wa-row-sub">{{ money(o.total) }}<span class="wa-dot"></span>{{ countOf(itemsCount(o), 'item', 'items', 'items') }}<span class="wa-dot"></span>{{ ago(o.created_at) }}</span>
                </span>
                <span class="wa-row-meta">
                  <span [class]="chip[o.status]">{{ labels[o.status] }}</span>
                </span>
              </button>
            } @empty {
              <!-- Пока закрытые заказы не прочитаны (или не прочитались), "пусто" писать рано -->
              @if (!closedPending()) {
                <p class="wa-empty">{{ emptyText() }}</p>
              }
            }
            @if (closedPending() && !closedError()) {
              <p class="wa-empty">Loading closed orders...</p>
            }
            @if (showsClosed() && closedLoaded() && closedCount() >= closedLimit) {
              <p class="wa-empty">Showing the latest {{ closedLimit }} closed orders</p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (o of selectedOne(); track o.id) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="select(null)"><panel-icon name="arrowLeft" /> Back to list</button>

            <div class="wa-card">
              <div class="wa-card-head">
                <span class="wa-avatar wa-avatar-lg wa-avatar-table" [class.is-new]="o.status === 'NEW'">{{ tableShort(o) }}</span>
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">Order #{{ o.number }}</h3>
                  <p class="wa-card-sub">{{ tableText(o) }}<span class="wa-dot"></span>{{ when(o.created_at) }}<span class="wa-dot"></span>{{ ago(o.created_at) }}</p>
                </div>
                <span [class]="chip[o.status]">{{ labels[o.status] }}</span>
              </div>

              @if (o.status === 'CANCELLED') {
                <p class="wa-error wa-error-inline"><panel-icon name="ban" /> Order cancelled</p>
              } @else {
                <ol class="wa-flow">
                  @for (s of flow; track s; let i = $index) {
                    <li [class.done]="i < stepIndex(o)" [class.current]="s === o.status">{{ labels[s] }}</li>
                  }
                </ol>
              }

              <div class="wa-order-items">
                @for (it of o.items; track it.id) {
                  <div class="wa-order-item">
                    <span class="wa-order-qty">{{ it.qty }} x</span>
                    <span class="wa-order-title">
                      {{ it.title }}
                      @if (it.kind === 'DRINK') { <span class="wa-chip">drink</span> }
                      @if (it.source === 'PAIRING') { <span class="wa-chip wa-chip-pending">from pairing</span> }
                      @if (it.source === 'AI') { <span class="wa-chip wa-chip-pending">from AI sommelier</span> }
                      @if (pairedTitle(o, it); as dish) { <small>with {{ dish }}</small> }
                      @if (it.note) { <small>{{ it.note }}</small> }
                    </span>
                    <span class="wa-order-price">{{ money(lineTotal(it)) }}</span>
                  </div>
                } @empty {
                  <p class="wa-muted">No items</p>
                }
                <div class="wa-order-total"><span>Total</span><strong>{{ money(o.total) }}</strong></div>
              </div>

              <dl class="wa-facts">
                <div><dt>Guest</dt><dd>{{ o.guest_name || 'no name given' }}</dd></div>
                <div><dt>Table</dt><dd>{{ tableText(o) }}</dd></div>
                <div><dt>Updated</dt><dd>{{ when(o.updated_at || o.created_at) }}</dd></div>
                @if (o.age_confirmed) { <div><dt>Age</dt><dd>guest confirmed 21+</dd></div> }
              </dl>

              @if (o.comment) {
                <div class="wa-quote">
                  <span class="wa-label">Guest comment</span>
                  <p>{{ o.comment }}</p>
                </div>
              }

              @if (actionError()) {
                <p class="wa-error" role="alert">{{ actionError() }}</p>
              }
              <div class="wa-actions">
                @if (nextOf(o.status); as n) {
                  <button type="button" class="btn-amber" [disabled]="acting()" (click)="setStatus(o, n)">
                    <panel-icon name="arrowRight" /> {{ nextLabel(o.status) }}
                  </button>
                }
                @if (!closed(o.status)) {
                  <button type="button" class="btn-outline panel-danger" [disabled]="acting()" (click)="askCancel(o)">
                    <panel-icon name="ban" /> {{ pendingCancel() === o.id ? 'Really cancel?' : 'Cancel' }}
                  </button>
                } @else {
                  <span class="wa-muted">This order is closed; its status can't change anymore</span>
                }
              </div>
            </div>
          </div>
        } @empty {
          <div class="wa-detail-empty">Select an item on the left</div>
        }
      </section>
    </div>
  `
})
export class PanelOrdersComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  readonly alerts = inject(OrderAlertService);
  /** Номер последнего запроса незакрытых заказов: ответ более старого запроса не применяем. */
  private loadSeq = 0;
  /** То же для списка закрытых. */
  private closedSeq = 0;
  /** Заказы, пропавшие из незакрытых: ждут списка закрытых, чтобы показать настоящий статус. */
  private vanished = new Set<string>();
  /** Заказы, которые панель уже видела: сигнал звучит только на новые. null - первая загрузка заведения. */
  private seenIds: Set<string> | null = null;

  /** Slug заведения, за которым следит панель: владелец получает своё, модератор последнее выбранное. */
  venue = input<string | null>(null);
  /** Вкладка на экране. Панель держит её живой и прячет: спрятанная вкладка сервер не опрашивает. */
  active = input(true);
  /** Модератор выбрал другое заведение: родитель считает бейдж по нему. */
  venueChanged = output<string>();
  /** Статус заказа изменился: родитель пересчитывает бейдж новых заказов. */
  changed = output<void>();

  readonly labels = ORDER_STATUS_LABELS;
  readonly chip = ORDER_STATUS_CHIP;
  readonly flow = ORDER_FLOW;
  readonly money = formatMoney;
  readonly ago = formatAgo;
  readonly when = formatWhen;
  readonly countOf = countOf;
  readonly closed = isOrderClosed;
  readonly nextOf = nextOrderStatus;
  readonly closedLimit = CLOSED_LIMIT;
  readonly pills: { value: OrderFilter; label: string }[] = [
    { value: 'new', label: 'New' },
    { value: 'active', label: 'In progress' },
    { value: 'closed', label: 'Closed' },
    { value: 'all', label: 'All' }
  ];
  isError = isErrorText;

  isModerator = computed(() => this.auth.role() === 'moderator');

  venues = signal<Venue[]>([]);
  venuesLoading = signal(false);
  venuesError = signal<string | null>(null);
  slug = signal<string | null>(null);

  /** Незакрытые заказы (их приносит опрос) и те закрытые, что уже прочитаны или закрыты здесь же. */
  orders = signal<Order[]>([]);
  loading = signal(false);
  loaded = signal(false);
  loadError = signal<string | null>(null);
  /** Закрытые заказы: читаются, когда открыт фильтр "Закрытые" или "Все". */
  closedLoaded = signal(false);
  closedLoading = signal(false);
  closedError = signal<string | null>(null);
  search = signal('');
  filter = signal<OrderFilter>('new');
  selectedId = signal<string | null>(null);
  acting = signal(false);
  actionError = signal<string | null>(null);
  msg = signal<string | null>(null);
  pendingCancel = signal<string | null>(null);

  /** Карточка выбранного заведения: из неё флаг accepts_orders. */
  venueInfo = signal<Venue | null>(null);
  acceptsSaving = signal(false);
  acceptsOrders = computed(() => this.venueInfo()?.accepts_orders !== false);

  venueOptions = computed<SelectOption[]>(() =>
    this.venues().map(v => ({ value: v.slug, label: v.name, hint: [v.city, v.is_published ? '' : 'hidden'].filter(Boolean).join(', ') }))
  );

  /** Счётчики на кнопках фильтра: только по незакрытым, история закрытых читается не целиком. */
  counts = computed(() => {
    const list = this.orders();
    return {
      new: list.filter(o => matchesFilter(o, 'new')).length,
      active: list.filter(o => matchesFilter(o, 'active')).length
    };
  });

  closedCount = computed(() => this.orders().filter(o => isOrderClosed(o.status)).length);

  /** Открыт фильтр, которому нужны закрытые заказы. */
  showsClosed = computed(() => this.filter() === 'closed' || this.filter() === 'all');

  /** Фильтру нужны закрытые заказы, а их ещё нет: вместо "пусто" показываем загрузку или ошибку. */
  closedPending = computed(() => this.showsClosed() && !this.closedLoaded());

  filtered = computed(() => {
    const q = this.search().toLowerCase().replace(/№/g, '').trim();
    const f = this.filter();
    return this.orders().filter(o =>
      matchesFilter(o, f) &&
      (!q || String(o.number) === q || String(o.number).startsWith(q)
        || String(o.table_number) === q || (o.guest_name || '').toLowerCase().includes(q))
    );
  });

  emptyText = computed(() => {
    if (this.search().trim()) return 'Nothing found';
    switch (this.filter()) {
      case 'new': return 'No new orders';
      case 'active': return 'No orders in progress';
      case 'closed': return 'No closed orders yet';
      default: return 'No orders yet';
    }
  });

  emptyVenueText = computed(() => {
    if (!this.isModerator()) return 'You don\'t have a venue yet: fill in its profile on the "Menu" tab';
    if (this.venuesLoading()) return 'Loading...';
    return this.venues().length ? 'Choose a venue' : 'No venues yet';
  });

  selectedOne = computed(() => {
    const o = this.orders().find(x => x.id === this.selectedId());
    return o ? [o] : [];
  });

  constructor() {
    // Родитель сменил заведение (например, восстановил выбор модератора): подхватываем без нового emit
    effect(() => {
      const v = this.venue();
      if (v && untracked(this.slug) !== v) untracked(() => this.applyVenue(v));
    }, { allowSignalWrites: true });

    // Спрятанная вкладка сервер не опрашивает: бейдж новых заказов считает родитель
    const timer = setInterval(() => {
      if (this.active()) this.load(true);
    }, POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));

    // Вкладку открыли снова: пока она была спрятана, заказы и список заведений могли измениться
    onTabReturn(this.active, () => {
      if (this.isModerator()) this.loadVenues(this.venues().length > 0);
      this.load(true);
      if (this.showsClosed()) this.loadClosed();
    });
  }

  ngOnInit() {
    if (this.isModerator()) {
      this.loadVenues();
      return;
    }
    const own = this.auth.user()?.venue?.slug ?? null;
    if (own && !this.slug()) this.applyVenue(own);
  }

  tableText(o: Order): string {
    return o.table_number > 0 ? `table ${o.table_number}` : 'takeaway';
  }

  /** Крупная подпись в кружке: номер стола или "С" для заказа с собой. */
  tableShort(o: Order): string {
    return o.table_number > 0 ? String(o.table_number) : 'TA';
  }

  itemsCount(o: Order): number {
    return o.items.reduce((n, it) => n + (Number(it.qty) || 0), 0);
  }

  lineTotal(it: OrderItem): number {
    return (parseFloat(it.price) || 0) * (Number(it.qty) || 0);
  }

  /** Сколько шагов пути уже пройдено, чтобы подсветить их в полосе статусов. */
  stepIndex(o: Order): number {
    return Math.max(0, this.flow.indexOf(o.status));
  }

  nextLabel(status: OrderStatus): string {
    return ORDER_NEXT_LABELS[status] || 'Next';
  }

  pillCount(f: OrderFilter): number {
    return f === 'new' ? this.counts().new : f === 'active' ? this.counts().active : 0;
  }

  /** silent: фоновое обновление уже показанного списка, без блокировки выбора и без ошибки поверх него. */
  loadVenues(silent = false) {
    if (!silent) {
      this.venuesLoading.set(true);
      this.venuesError.set(null);
    }
    this.api.getVenues().subscribe({
      next: list => {
        this.venues.set(list);
        this.venuesLoading.set(false);
        this.venuesError.set(null);
        const wanted = this.venue();
        const pick = list.find(v => v.slug === wanted) ?? list[0];
        if (pick && !this.slug()) this.pickVenue(pick.slug);
      },
      error: err => {
        if (silent) return;
        this.venuesLoading.set(false);
        this.venuesError.set('Couldn\'t load venues: ' + AuthService.errorText(err));
      }
    });
  }

  /** Выбор в списке заведений: сообщаем родителю, чтобы бейдж считался по этому заведению. */
  pickVenue(slug: string) {
    if (!slug || slug === this.slug()) return;
    this.applyVenue(slug);
    this.venueChanged.emit(slug);
  }

  private applyVenue(slug: string) {
    this.slug.set(slug);
    this.orders.set([]);
    this.vanished.clear();
    this.loaded.set(false);
    this.loadError.set(null);
    // Ответ по закрытым заказам прошлого заведения больше не нужен
    this.closedSeq++;
    this.closedLoaded.set(false);
    this.closedLoading.set(false);
    this.closedError.set(null);
    this.selectedId.set(null);
    this.actionError.set(null);
    this.seenIds = null;
    this.alerts.stopBlink();
    this.loadVenueInfo(slug);
    this.load(false);
    if (this.showsClosed()) this.loadClosed();
  }

  private loadVenueInfo(slug: string) {
    this.venueInfo.set(null);
    this.api.getVenue(slug).subscribe({
      next: v => {
        if (this.slug() === slug) this.venueInfo.set(v);
      },
      error: () => {
        // Без карточки переключатель просто неактивен; список заказов работает и так
      }
    });
  }

  /** Выключатель заказов через приложение: гости с выключенным видят «покажите список официанту». */
  setAcceptsOrders(on: boolean) {
    const slug = this.slug();
    const v = this.venueInfo();
    if (!slug || !v || this.acceptsSaving()) return;
    this.acceptsSaving.set(true);
    // Сразу показываем новое положение, при ошибке вернём старое
    this.venueInfo.set({ ...v, accepts_orders: on });
    this.api.updateVenue(slug, { accepts_orders: on }).subscribe({
      next: saved => {
        this.acceptsSaving.set(false);
        if (this.slug() !== slug) return;
        this.venueInfo.set(saved);
        flash(this.msg, saved.accepts_orders === false ? 'In-app ordering turned off' : 'In-app ordering turned on');
      },
      error: err => {
        this.acceptsSaving.set(false);
        if (this.slug() !== slug) return;
        this.venueInfo.set(v);
        flash(this.msg, 'Error: ' + AuthService.errorText(err));
      }
    });
  }

  /** Блюдо, к которому гость взял напиток из подбора: название из этого же заказа. */
  pairedTitle(o: Order, it: OrderItem): string | null {
    if (!it.paired_menu_item) return null;
    return o.items.find(x => x.kind === 'DISH' && x.menu_item === it.paired_menu_item)?.title ?? null;
  }

  /** Новые заказы, которых панель ещё не видела: звук и мигание вкладки. Первая загрузка молчит. */
  private notifyNew(list: Order[]) {
    const fresh = this.seenIds ? list.filter(o => o.status === 'NEW' && !this.seenIds!.has(o.id)) : [];
    this.seenIds = new Set([...(this.seenIds ?? []), ...list.map(o => o.id)]);
    const newCount = list.filter(o => o.status === 'NEW').length;
    if (fresh.length) {
      this.alerts.ring(newCount);
      // Бейдж в рейле пусть догонит список сразу, а не через свой таймер
      this.changed.emit();
    } else if (!newCount) {
      this.alerts.stopBlink();
    }
  }

  /** Фильтры "Закрытые" и "Все" читают закрытые заказы в момент открытия: опрос их не трогает. */
  setFilter(f: OrderFilter) {
    this.filter.set(f);
    if (this.slug() && this.showsClosed()) this.loadClosed();
  }

  /** Кнопка "Обновить": незакрытые заказы и, если открыт их фильтр, закрытые. */
  refresh() {
    this.load(false);
    if (this.showsClosed()) this.loadClosed();
  }

  /**
   * Читает только незакрытые заказы: всю историю каждые 20 секунд тянуть незачем.
   * silent: фоновое обновление по таймеру, без индикатора и поверх уже показанного списка.
   */
  load(silent: boolean) {
    const slug = this.slug();
    if (!slug || (silent && this.loading())) return;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    if (!silent) this.loadError.set(null);
    this.api.getOrders(slug, OPEN_STATUSES).subscribe({
      next: list => {
        if (seq !== this.loadSeq || this.slug() !== slug) return;
        this.notifyNew(list);
        this.applyOpen(list);
        this.loaded.set(true);
        this.loading.set(false);
        this.loadError.set(null);
      },
      error: err => {
        if (seq !== this.loadSeq || this.slug() !== slug) return;
        this.loading.set(false);
        this.loadError.set('Couldn\'t load orders: ' + AuthService.errorText(err));
      }
    });
  }

  /**
   * Новый список незакрытых заказов встаёт рядом с уже известными закрытыми.
   * Заказ, который был открыт и пропал из ответа, закрыли с другого устройства: если он выбран
   * или закрытые уже показаны, держим его старую копию до списка закрытых и читаем этот список.
   */
  private applyOpen(list: Order[]) {
    const fresh = new Set(list.map(o => o.id));
    const selected = this.selectedId();
    const keep: Order[] = [];
    let missing = false;
    for (const o of this.orders()) {
      if (fresh.has(o.id)) continue;
      if (isOrderClosed(o.status)) {
        keep.push(o);
      } else if (this.closedLoaded() || this.showsClosed() || o.id === selected) {
        keep.push(o);
        this.vanished.add(o.id);
        missing = true;
      }
    }
    this.orders.set(sortOrders([...list, ...keep]));
    if (missing) this.loadClosed();
  }

  /** Последние закрытые заказы заведения: не больше CLOSED_LIMIT. */
  loadClosed() {
    const slug = this.slug();
    if (!slug) return;
    const seq = ++this.closedSeq;
    this.closedLoading.set(true);
    this.closedError.set(null);
    this.api.getOrders(slug, CLOSED_STATUSES, CLOSED_LIMIT).subscribe({
      next: list => {
        if (seq !== this.closedSeq || this.slug() !== slug) return;
        const closedIds = new Set(list.map(o => o.id));
        const selected = this.selectedId();
        // Старые копии пропавших заказов больше не нужны: их настоящий статус в списке закрытых.
        // Открытый в карточке закрытый заказ оставляем, даже если он старше последних CLOSED_LIMIT
        const rest = this.orders().filter(o =>
          !closedIds.has(o.id) && !this.vanished.has(o.id) && (!isOrderClosed(o.status) || o.id === selected));
        this.vanished.clear();
        this.orders.set(sortOrders([...rest, ...list]));
        this.closedLoaded.set(true);
        this.closedLoading.set(false);
      },
      error: err => {
        if (seq !== this.closedSeq || this.slug() !== slug) return;
        this.closedLoading.set(false);
        this.closedError.set('Couldn\'t load closed orders: ' + AuthService.errorText(err));
      }
    });
  }

  select(id: string | null) {
    this.selectedId.set(id);
    this.actionError.set(null);
    this.pendingCancel.set(null);
  }

  setStatus(o: Order, status: OrderStatus) {
    this.acting.set(true);
    this.actionError.set(null);
    this.api.updateOrderStatus(o.id, status).subscribe({
      next: saved => {
        this.acting.set(false);
        // Опрос, ушедший до этого PATCH, вернул бы старый статус: его ответ отбрасываем и перечитываем список
        this.loadSeq++;
        this.loading.set(false);
        this.vanished.delete(saved.id);
        this.orders.update(list => list.map(x => x.id === saved.id ? saved : x));
        flash(this.msg, `Order #${saved.number}: ${ORDER_STATUS_LABELS[saved.status].toLowerCase()}`);
        this.changed.emit();
        this.load(true);
        // Список закрытых, запрошенный до этого PATCH, пришёл бы без только что закрытого заказа
        if (isOrderClosed(saved.status) && this.closedLoading()) this.loadClosed();
      },
      error: err => {
        this.acting.set(false);
        const reason = AuthService.errorText(err);
        // Ошибку показываем в карточке, только если в ней тот же заказ; иначе строкой над списком с номером
        if (this.selectedId() === o.id) this.actionError.set('Error: ' + reason);
        else flash(this.msg, `Error: order #${o.number} wasn't updated. ${reason}`, 6000);
        // Скорее всего, статус уже поменяли с другого устройства: перечитываем список
        this.load(true);
      }
    });
  }

  askCancel(o: Order) {
    confirmTwice(this.pendingCancel, o.id, () => this.setStatus(o, 'CANCELLED'));
  }
}
