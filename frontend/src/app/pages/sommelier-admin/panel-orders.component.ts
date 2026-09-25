import { Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import {
  ORDER_FLOW, ORDER_STATUS_LABELS, Order, OrderItem, OrderStatus, Venue, isOrderClosed, nextOrderStatus
} from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import {
  ORDER_NEXT_LABELS, ORDER_STATUS_CHIP, confirmTwice, countOf, flash, formatAgo, formatMoney, formatWhen, isErrorText
} from './panel-shared';

type OrderFilter = 'new' | 'active' | 'closed' | 'all';

const ACTIVE_STATUSES: readonly OrderStatus[] = ['ACCEPTED', 'COOKING', 'SERVED'];
/** Как часто перечитываем список, пока вкладка открыта. */
const POLL_MS = 20000;

function matchesFilter(o: Order, f: OrderFilter): boolean {
  switch (f) {
    case 'new': return o.status === 'NEW';
    case 'active': return ACTIVE_STATUSES.includes(o.status);
    case 'closed': return isOrderClosed(o.status);
    default: return true;
  }
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
    <div class="wa-page" [class.has-selection]="!!selectedId()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Заказы
            @if (counts().new > 0) { <span class="wa-count wa-count-accent">{{ counts().new }}</span> }
          </h2>
          <button type="button" class="wa-iconbtn" title="Обновить" [disabled]="loading() || !slug()" (click)="load(false)">
            <panel-icon name="refresh" />
          </button>
        </div>
        @if (isModerator()) {
          <div class="wa-venue-pick">
            <ft-select [options]="venueOptions()" [searchable]="true"
                       [placeholder]="venuesLoading() ? 'Загружаем заведения...' : 'Выберите заведение'"
                       searchPlaceholder="Название заведения" emptyText="Заведений пока нет"
                       [disabled]="venuesLoading()"
                       [ngModel]="slug() || ''" (ngModelChange)="pickVenue($event)" />
          </div>
        }
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Номер заказа, стол или имя гостя" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <div class="wa-pills">
          @for (p of pills; track p.value) {
            <button type="button" class="wa-pill" [class.active]="filter() === p.value" (click)="filter.set(p.value)">
              {{ p.label }}@if (p.value !== 'all' && counts()[p.value] > 0) { <span class="wa-pill-count">{{ counts()[p.value] }}</span> }
            </button>
          }
        </div>
        @if (msg()) {
          <p class="wa-msg" [class.error]="isError(msg())">{{ msg() }}</p>
        }
        <div class="wa-rows">
          @if (!slug()) {
            <p class="wa-empty">{{ venuesError() || (isModerator() ? 'Выберите заведение' : 'У вас пока нет заведения: заполните карточку на вкладке "Меню"') }}</p>
          } @else if (!loaded()) {
            @if (loadError()) {
              <div class="wa-loadbar">
                <panel-icon name="alert" />
                <span>{{ loadError() }}</span>
                <button type="button" class="btn-outline" (click)="load(false)"><panel-icon name="refresh" /> Обновить</button>
              </div>
            } @else {
              <p class="wa-empty">Загрузка...</p>
            }
          } @else {
            @if (loadError()) {
              <p class="wa-error wa-error-inline">{{ loadError() }}</p>
            }
            @for (o of filtered(); track o.id) {
              <button type="button" class="wa-row" [class.active]="selectedId() === o.id" (click)="select(o.id)">
                <span class="wa-avatar wa-avatar-table" [class.is-new]="o.status === 'NEW'" [title]="tableText(o)">{{ tableShort(o) }}</span>
                <span class="wa-row-body">
                  <span class="wa-row-title">№{{ o.number }}<span class="wa-dot"></span>{{ tableText(o) }}</span>
                  <span class="wa-row-sub">{{ money(o.total) }}<span class="wa-dot"></span>{{ countOf(itemsCount(o), 'позиция', 'позиции', 'позиций') }}<span class="wa-dot"></span>{{ ago(o.created_at) }}</span>
                </span>
                <span class="wa-row-meta">
                  <span [class]="chip[o.status]">{{ labels[o.status] }}</span>
                </span>
              </button>
            } @empty {
              <p class="wa-empty">{{ orders().length ? 'В этом фильтре пусто' : 'Заказов пока нет' }}</p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (o of selectedOne(); track o.id) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="select(null)"><panel-icon name="arrowLeft" /> К списку</button>

            <div class="wa-card">
              <div class="wa-card-head">
                <span class="wa-avatar wa-avatar-lg wa-avatar-table" [class.is-new]="o.status === 'NEW'">{{ tableShort(o) }}</span>
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">Заказ №{{ o.number }}</h3>
                  <p class="wa-card-sub">{{ tableText(o) }}<span class="wa-dot"></span>{{ when(o.created_at) }}<span class="wa-dot"></span>{{ ago(o.created_at) }}</p>
                </div>
                <span [class]="chip[o.status]">{{ labels[o.status] }}</span>
              </div>

              @if (o.status === 'CANCELLED') {
                <p class="wa-error wa-error-inline"><panel-icon name="ban" /> Заказ отменён</p>
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
                      @if (it.kind === 'DRINK') { <span class="wa-chip">напиток</span> }
                      @if (it.note) { <small>{{ it.note }}</small> }
                    </span>
                    <span class="wa-order-price">{{ money(lineTotal(it)) }}</span>
                  </div>
                } @empty {
                  <p class="wa-muted">Позиций нет</p>
                }
                <div class="wa-order-total"><span>Итого</span><strong>{{ money(o.total) }}</strong></div>
              </div>

              <dl class="wa-facts">
                <div><dt>Гость</dt><dd>{{ o.guest_name || 'имя не указано' }}</dd></div>
                <div><dt>Стол</dt><dd>{{ tableText(o) }}</dd></div>
                <div><dt>Обновлён</dt><dd>{{ when(o.updated_at || o.created_at) }}</dd></div>
              </dl>

              @if (o.comment) {
                <div class="wa-quote">
                  <span class="wa-label">Комментарий гостя</span>
                  <p>{{ o.comment }}</p>
                </div>
              }

              @if (actionError()) {
                <p class="wa-error">{{ actionError() }}</p>
              }
              <div class="wa-actions">
                @if (nextOf(o.status); as n) {
                  <button type="button" class="btn-amber" [disabled]="acting()" (click)="setStatus(o, n)">
                    <panel-icon name="arrowRight" /> {{ nextLabel(o.status) }}
                  </button>
                }
                @if (!closed(o.status)) {
                  <button type="button" class="btn-outline panel-danger" [disabled]="acting()" (click)="askCancel(o)">
                    <panel-icon name="ban" /> {{ pendingCancel() === o.id ? 'Точно отменить?' : 'Отменить' }}
                  </button>
                } @else {
                  <span class="wa-muted">Заказ закрыт, статус больше не меняется</span>
                }
              </div>
            </div>
          </div>
        } @empty {
          <div class="wa-detail-empty">Выберите элемент слева</div>
        }
      </section>
    </div>
  `
})
export class PanelOrdersComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  /** Номер последнего запроса списка: ответ более старого запроса не применяем. */
  private loadSeq = 0;

  /** Slug заведения, за которым следит панель: владелец получает своё, модератор последнее выбранное. */
  venue = input<string | null>(null);
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
  readonly pills: { value: OrderFilter; label: string }[] = [
    { value: 'new', label: 'Новые' },
    { value: 'active', label: 'В работе' },
    { value: 'closed', label: 'Закрытые' },
    { value: 'all', label: 'Все' }
  ];
  isError = isErrorText;

  isModerator = computed(() => this.auth.role() === 'moderator');

  venues = signal<Venue[]>([]);
  venuesLoading = signal(false);
  venuesError = signal<string | null>(null);
  slug = signal<string | null>(null);

  orders = signal<Order[]>([]);
  loading = signal(false);
  loaded = signal(false);
  loadError = signal<string | null>(null);
  search = signal('');
  filter = signal<OrderFilter>('new');
  selectedId = signal<string | null>(null);
  acting = signal(false);
  actionError = signal<string | null>(null);
  msg = signal<string | null>(null);
  pendingCancel = signal<string | null>(null);

  venueOptions = computed<SelectOption[]>(() =>
    this.venues().map(v => ({ value: v.slug, label: v.name, hint: [v.city, v.is_published ? '' : 'скрыто'].filter(Boolean).join(', ') }))
  );

  counts = computed<Record<OrderFilter, number>>(() => {
    const list = this.orders();
    return {
      new: list.filter(o => matchesFilter(o, 'new')).length,
      active: list.filter(o => matchesFilter(o, 'active')).length,
      closed: list.filter(o => matchesFilter(o, 'closed')).length,
      all: list.length
    };
  });

  filtered = computed(() => {
    const q = this.search().toLowerCase().replace(/№/g, '').trim();
    const f = this.filter();
    return this.orders().filter(o =>
      matchesFilter(o, f) &&
      (!q || String(o.number) === q || String(o.number).startsWith(q)
        || String(o.table_number) === q || (o.guest_name || '').toLowerCase().includes(q))
    );
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

    const timer = setInterval(() => this.load(true), POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
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
    return o.table_number > 0 ? `стол ${o.table_number}` : 'с собой';
  }

  /** Крупная подпись в кружке: номер стола или "С" для заказа с собой. */
  tableShort(o: Order): string {
    return o.table_number > 0 ? String(o.table_number) : 'С';
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
    return ORDER_NEXT_LABELS[status] || 'Дальше';
  }

  loadVenues() {
    this.venuesLoading.set(true);
    this.venuesError.set(null);
    this.api.getVenues().subscribe({
      next: list => {
        this.venues.set(list);
        this.venuesLoading.set(false);
        const wanted = this.venue();
        const pick = list.find(v => v.slug === wanted) ?? list[0];
        if (pick && !this.slug()) this.pickVenue(pick.slug);
      },
      error: err => {
        this.venuesLoading.set(false);
        this.venuesError.set('Не удалось загрузить заведения: ' + AuthService.errorText(err));
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
    this.loaded.set(false);
    this.loadError.set(null);
    this.selectedId.set(null);
    this.actionError.set(null);
    this.load(false);
  }

  /** silent: фоновое обновление по таймеру, без индикатора и поверх уже показанного списка. */
  load(silent: boolean) {
    const slug = this.slug();
    if (!slug || (silent && this.loading())) return;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    if (!silent) this.loadError.set(null);
    this.api.getOrders(slug).subscribe({
      next: list => {
        if (seq !== this.loadSeq || this.slug() !== slug) return;
        this.orders.set(list);
        this.loaded.set(true);
        this.loading.set(false);
        this.loadError.set(null);
      },
      error: err => {
        if (seq !== this.loadSeq || this.slug() !== slug) return;
        this.loading.set(false);
        this.loadError.set('Не удалось загрузить заказы: ' + AuthService.errorText(err));
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
        this.orders.update(list => list.map(x => x.id === saved.id ? saved : x));
        flash(this.msg, `Заказ №${saved.number}: ${ORDER_STATUS_LABELS[saved.status].toLowerCase()}`);
        this.changed.emit();
        this.load(true);
      },
      error: err => {
        this.acting.set(false);
        this.actionError.set('Ошибка: ' + AuthService.errorText(err));
        // Скорее всего, статус уже поменяли с другого устройства: перечитываем список
        this.load(true);
      }
    });
  }

  askCancel(o: Order) {
    confirmTwice(this.pendingCancel, o.id, () => this.setStatus(o, 'CANCELLED'));
  }
}
