import { Component, EventEmitter, OnInit, Output, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { PanelTab } from '../../models/navigation';
import { BrandInsight, BrandsAnalytics, Venue, VenueAnalytics } from '../../models/flavor-tree.models';
import { FtSelectComponent } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';

const PERIODS = [7, 30, 90];

/** Столбик диаграммы по дням. */
interface DayBar {
  day: string;
  label: string;
  orders: number;
  revenue: number;
  withPair: number;
  height: number;
  pairHeight: number;
}

/**
 * Вкладка "Аналитика".
 * Заведению: что рекомендации дают заказам. Доля заказов с напитком и с парой из меню,
 * напитки, добавленные из совета, средний чек и что заказывают вместе.
 * Сомелье и модератору: что гости слышат в сортах (отметки паспорта вкуса и оценки пар).
 */
@Component({
  selector: 'panel-analytics',
  standalone: true,
  imports: [FormsModule, FtSelectComponent, PanelIconComponent],
  template: `
    <div class="wa-page wa-page-single">
      <div class="an">
        @if (showVenue()) {
          <div class="wa-card an-head">
            <div class="wa-card-head-text">
              <h3 class="wa-card-title">What recommendations deliver</h3>
              <p class="wa-card-sub">Venue orders for the period: how many guests add a drink to their dish, and how many order a pairing from the menu</p>
            </div>
            <div class="an-tools">
              @if (venues().length > 1) {
                <ft-select class="an-venue" [options]="venueOptions()" [ngModel]="venue()" (ngModelChange)="setVenue($event)"
                           ariaLabel="Venue" />
              }
              <div class="an-seg" role="group" aria-label="Period">
                @for (d of periods; track d) {
                  <button type="button" [class.active]="days() === d" [attr.aria-pressed]="days() === d" (click)="setDays(d)">{{ d }} days</button>
                }
              </div>
              <button type="button" class="btn-outline" [disabled]="!data() || exporting()" (click)="export()">
                <panel-icon name="download" /> {{ exporting() ? 'Preparing...' : 'CSV' }}
              </button>
            </div>
          </div>

          @if (venueError(); as err) {
            <div class="wa-loadbar" role="alert">
              <panel-icon name="alert" />
              <span>{{ err }}</span>
              <button type="button" class="btn-outline" (click)="loadVenue()"><panel-icon name="refresh" /> Refresh</button>
            </div>
          } @else if (!venue() && venuesLoaded()) {
            <div class="wa-card"><p class="wa-muted">Your account doesn’t have a venue yet. Create one in the Menu tab.</p></div>
          } @else if (!data()) {
            <div class="wa-card"><p class="wa-muted">Loading...</p></div>
          } @else {
            @let a = data()!;
            @if (a.demo.orders > 0) {
              <div class="an-demo" role="note">
                <panel-icon name="alert" />
                <span>
                  <b>Showing demo data.</b> {{ a.demo.orders }} of {{ a.totals.orders }} orders were created as examples
                  and do not reflect the venue’s actual results.
                </span>
                <button type="button" class="btn-outline" (click)="setDemo(false)">Hide demo data</button>
              </div>
            } @else if (!demo()) {
              <div class="an-demo an-demo-off" role="note">
                <span>Demo data is hidden: only real orders are counted.</span>
                <button type="button" class="btn-outline" (click)="setDemo(true)">Show demo data</button>
              </div>
            }

            <div class="an-kpis">
              <div class="an-kpi"><span>Orders</span><b>{{ a.totals.orders }}</b></div>
              <div class="an-kpi"><span>Revenue</span><b>{{ money(a.totals.revenue) }}</b></div>
              <div class="an-kpi"><span>Average check</span><b>{{ a.totals.avg_check === null ? 'no data' : money(a.totals.avg_check) }}</b></div>
              <div class="an-kpi an-kpi-accent">
                <span>Orders with a menu pairing</span>
                <b>{{ a.pairing.pair_rate === null ? 'no data' : a.pairing.pair_rate + '%' }}</b>
              </div>
            </div>

            @if (!a.totals.orders) {
              <div class="wa-card">
                <p class="wa-muted">No orders in this period. Numbers will appear here once guests start ordering through the QR-code menu.</p>
              </div>
            } @else {
              <div class="an-grid">
                <div class="wa-card">
                  <h3 class="wa-card-title">From dish to pairing</h3>
                  <ul class="an-funnel">
                    <li>
                      <span class="an-funnel-label">Orders with a dish</span>
                      <span class="an-bar"><span style="width: 100%"></span></span>
                      <b>{{ a.pairing.dish_orders }}</b>
                    </li>
                    <li>
                      <span class="an-funnel-label">of which with a drink</span>
                      <span class="an-bar"><span [style.width.%]="a.pairing.drink_rate ?? 0"></span></span>
                      <b>{{ a.pairing.with_drink }} · {{ a.pairing.drink_rate ?? 0 }}%</b>
                    </li>
                    <li>
                      <span class="an-funnel-label">of which with a menu pairing</span>
                      <span class="an-bar an-bar-strong"><span [style.width.%]="a.pairing.pair_rate ?? 0"></span></span>
                      <b>{{ a.pairing.with_pair }} · {{ a.pairing.pair_rate ?? 0 }}%</b>
                    </li>
                  </ul>
                  <p class="an-note">
                    Menu pairing: the order has a dish plus a drink that the sommelier or AI recommends for that specific dish.
                  </p>
                </div>

                <div class="wa-card">
                  <h3 class="wa-card-title">Drinks added from recommendations</h3>
                  <dl class="an-advice">
                    <div>
                      <dt>From dish recommendations</dt>
                      <dd><b>{{ a.advice.pairing.qty }}</b> pcs for {{ money(a.advice.pairing.revenue) }}</dd>
                    </div>
                    <div>
                      <dt>From the AI sommelier chat</dt>
                      <dd><b>{{ a.advice.ai.qty }}</b> pcs for {{ money(a.advice.ai.revenue) }}</dd>
                    </div>
                  </dl>
                  <p class="an-note">
                    Counts drinks a guest added via the button in a dish recommendation or from a card in the chat.
                    This is the direct contribution of recommendations to bar revenue.
                  </p>
                </div>

                <div class="wa-card">
                  <h3 class="wa-card-title">Average check</h3>
                  <ul class="an-checks">
                    @for (row of checks(); track row.label) {
                      <li>
                        <span class="an-funnel-label">{{ row.label }}</span>
                        <span class="an-bar" [class.an-bar-strong]="row.strong"><span [style.width.%]="row.width"></span></span>
                        <b>{{ row.value === null ? 'no data' : money(row.value) }}</b>
                      </li>
                    }
                  </ul>
                  <p class="an-note">
                    A check with a drink is always bigger than one without. To measure the effect of recommendations, compare the share of orders
                    with a pairing before and after turning them on.
                  </p>
                </div>

                <div class="wa-card">
                  <h3 class="wa-card-title">Bar menu</h3>
                  <p class="an-draught">
                    <b>{{ a.drinks.draught_rate === null ? 'no data' : a.drinks.draught_rate + '%' }}</b>
                    of drinks are on draught
                  </p>
                  <p class="an-note">Draught beer leaves less packaging: the keg goes back to the brewery.</p>
                  <ol class="an-top">
                    @for (d of a.drinks.top; track d.title) {
                      <li>
                        <span class="an-top-name">{{ d.title }} @if (d.draught) { <span class="wa-chip wa-chip-approved">draught</span> }</span>
                        <span class="an-top-num">{{ d.qty }} pcs · {{ money(d.revenue) }}</span>
                      </li>
                    } @empty { <li class="wa-muted">No drinks in orders</li> }
                  </ol>
                </div>
              </div>

              <div class="wa-card">
                <div class="wa-card-head">
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title">Orders by day</h3>
                    <p class="wa-card-sub">Bar height: orders per day. Dark part: orders with a menu pairing</p>
                  </div>
                </div>
                <div class="an-days" role="img" [attr.aria-label]="daysSummary()">
                  @for (b of bars(); track b.day) {
                    <span class="an-day" [title]="b.label + ': ' + b.orders + ' orders, ' + b.withPair + ' with pairing, revenue ' + money(b.revenue)">
                      <span class="an-day-bar" [style.height.%]="b.height">
                        <span class="an-day-pair" [style.height.%]="b.pairHeight"></span>
                      </span>
                    </span>
                  }
                </div>
                <div class="an-days-axis"><span>{{ dateLabel(a.period.from) }}</span><span>{{ dateLabel(a.period.to) }}</span></div>
              </div>

              <div class="an-grid">
                <div class="wa-card">
                  <h3 class="wa-card-title">Ordered together</h3>
                  <ol class="an-top">
                    @for (p of a.top_pairs; track p.dish + p.drink) {
                      <li>
                        <span class="an-top-name">
                          {{ p.dish }} + {{ p.drink }}
                          @if (p.source === 'SOMMELIER') { <span class="wa-chip wa-chip-approved">sommelier pairing</span> }
                          @else if (p.source === 'AI') { <span class="wa-chip wa-chip-pending">AI match</span> }
                        </span>
                        <span class="an-top-num">{{ p.orders }} orders</span>
                      </li>
                    } @empty { <li class="wa-muted">No orders with both a dish and a drink yet</li> }
                  </ol>
                </div>

                <div class="wa-card">
                  <h3 class="wa-card-title">Dishes without a pairing</h3>
                  @if (a.dishes.unpaired.length) {
                    <p class="an-note">No beer on the bar menu is paired with these dishes, so guests won’t see a recommendation.</p>
                    <div class="wa-chips">
                      @for (name of a.dishes.unpaired.slice(0, 14); track name) { <span class="wa-chip">{{ name }}</span> }
                      @if (a.dishes.unpaired.length > 14) { <span class="wa-chip">+{{ a.dishes.unpaired.length - 14 }} more</span> }
                    </div>
                    <div class="wa-actions">
                      <button type="button" class="btn-amber" (click)="openTab.emit('dishes')"><panel-icon name="dishes" /> Match with AI</button>
                    </div>
                  } @else {
                    <p class="wa-muted">Every dish on the menu has a pairing from the bar menu.</p>
                  }
                  <h3 class="wa-card-title an-sub-title">Guest pairing ratings</h3>
                  @if (a.feedback.likes + a.feedback.dislikes) {
                    <p class="an-votes">
                      <b>{{ a.feedback.likes }}</b> liked, <b>{{ a.feedback.dislikes }}</b> disliked
                    </p>
                  } @else {
                    <p class="wa-muted">Guests haven’t rated any pairings yet. The question appears on the order screen.</p>
                  }
                </div>
              </div>
            }
          }
        }

        @if (showBrands()) {
          <div class="wa-card an-head">
            <div class="wa-card-head-text">
              <h3 class="wa-card-title">What guests taste in each beer</h3>
              <p class="wa-card-sub">Taste passport check-ins: which notes guests name and whether they match the sommelier’s pyramid</p>
            </div>
            <button type="button" class="btn-outline" (click)="loadBrands()"><panel-icon name="refresh" /> Refresh</button>
          </div>

          @if (brandsError(); as err) {
            <div class="wa-loadbar" role="alert">
              <panel-icon name="alert" /><span>{{ err }}</span>
              <button type="button" class="btn-outline" (click)="loadBrands()"><panel-icon name="refresh" /> Refresh</button>
            </div>
          } @else if (!brands()) {
            <div class="wa-card"><p class="wa-muted">Loading...</p></div>
          } @else {
            @let b = brands()!;
            <div class="an-kpis">
              <div class="an-kpi"><span>Beer check-ins</span><b>{{ b.totals.tastings }}</b></div>
              <div class="an-kpi"><span>Guests with a passport</span><b>{{ b.totals.tasters }}</b></div>
              <div class="an-kpi"><span>Lessons completed</span><b>{{ b.totals.lessons_done }}</b></div>
              <div class="an-kpi"><span>Levels passed</span><b>{{ b.totals.levels_passed }}</b></div>
              <div class="an-kpi"><span>Pairing ratings</span><b>{{ b.totals.votes }}</b></div>
              <div class="an-kpi"><span>AI pairings awaiting sommelier</span><b>{{ b.totals.ai_pairings }}</b></div>
            </div>

            <div class="wa-card">
              <div class="an-table" role="table" aria-label="Beers">
                <div class="an-row an-row-head" role="row">
                  <span role="columnheader">Beer</span>
                  <span role="columnheader">Check-ins</span>
                  <span role="columnheader">Rating</span>
                  <span role="columnheader">Favorites</span>
                  <span role="columnheader">Ordered</span>
                  <span role="columnheader">Pairings liked</span>
                  <span role="columnheader">What guests taste</span>
                </div>
                @for (row of b.brands; track row.id) {
                  @if (isQuiet(row)) {
                    <!-- О сорте пока нечего сказать: одна строка вместо шести нулей -->
                    <div class="an-row an-row-quiet" role="row">
                      <span role="cell" class="an-brand"><b>{{ row.name }}</b><small>{{ row.style }}</small></span>
                      <span role="cell" class="an-quiet">Guests haven’t checked in, rated or ordered this beer yet</span>
                    </div>
                  } @else {
                  <div class="an-row" role="row">
                    <span role="cell" class="an-brand"><b>{{ row.name }}</b><small>{{ row.style }}</small></span>
                    <span role="cell" data-label="Check-ins">{{ row.tastings }}</span>
                    <span role="cell" data-label="Rating">{{ row.rating_avg === null ? 'none' : row.rating_avg + ' of 5' }}</span>
                    <span role="cell" data-label="Favorites">{{ row.favorites }}</span>
                    <span role="cell" data-label="Ordered">{{ row.ordered }} pcs</span>
                    <span role="cell" data-label="Pairings liked">{{ row.liked_rate === null ? 'no ratings' : row.liked_rate + '% of ' + row.votes }}</span>
                    <span role="cell" class="an-heard" data-label="What guests taste">
                      @for (n of row.heard; track n.id) {
                        <span class="wa-chip" [class.wa-chip-approved]="n.in_pyramid" [title]="n.in_pyramid ? 'In the sommelier’s pyramid' : 'Not in the sommelier’s pyramid'">
                          {{ n.name }} {{ n.share }}%
                        </span>
                      } @empty {
                        <span class="wa-muted">{{ row.tastings ? 'too few check-ins: ' + row.tastings + ' of ' + b.min_guests : 'no check-ins' }}</span>
                      }
                    </span>
                  </div>
                  }
                }
              </div>
              <p class="an-note">
                Notes in green are in the sommelier’s pyramid. Gray notes are ones guests name on their own: a reason to double-check the pyramid
                or the beer description. The notes summary appears after {{ b.min_guests }} check-ins.
              </p>
            </div>
          }
        }
      </div>
    </div>
  `
})
export class PanelAnalyticsComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  /** Вкладка сейчас на экране: данные обновляются при каждом открытии. */
  active = input(false);
  /** Переход на другую вкладку панели (например, к подбору пар через ИИ). */
  @Output() openTab = new EventEmitter<PanelTab>();

  readonly periods = PERIODS;
  readonly showVenue = computed(() => this.auth.role() === 'restaurant_admin' || this.auth.role() === 'moderator');
  readonly showBrands = computed(() => this.auth.role() === 'sommelier' || this.auth.role() === 'moderator');

  readonly venues = signal<Venue[]>([]);
  readonly venuesLoaded = signal(false);
  readonly venue = signal('');
  readonly days = signal(30);
  readonly demo = signal(true);
  readonly data = signal<VenueAnalytics | null>(null);
  readonly venueError = signal('');
  readonly exporting = signal(false);
  readonly brands = signal<BrandsAnalytics | null>(null);
  readonly brandsError = signal('');
  private venueSeq = 0;

  readonly venueOptions = computed(() => this.venues().map(v => ({ value: v.slug, label: v.name })));

  /** Три строки сравнения среднего чека; ширина столбика относительно самого большого. */
  readonly checks = computed(() => {
    const p = this.data()?.pairing;
    if (!p) return [];
    const rows = [
      { label: 'Food only', value: p.avg_food_only, strong: false },
      { label: 'Food and a drink', value: p.avg_with_drink, strong: false },
      { label: 'Food and a menu pairing', value: p.avg_with_pair, strong: true },
    ];
    const max = Math.max(1, ...rows.map(r => r.value ?? 0));
    return rows.map(r => ({ ...r, width: Math.round((r.value ?? 0) * 100 / max) }));
  });

  readonly bars = computed<DayBar[]>(() => {
    const list = this.data()?.by_day ?? [];
    const max = Math.max(1, ...list.map(d => d.orders));
    return list.map(d => ({
      day: d.day,
      label: this.dateLabel(d.day),
      orders: d.orders,
      revenue: d.revenue,
      withPair: d.with_pair,
      height: d.orders ? Math.max(6, Math.round(d.orders * 100 / max)) : 0,
      pairHeight: d.orders ? Math.round(d.with_pair * 100 / d.orders) : 0,
    }));
  });

  readonly daysSummary = computed(() => {
    const a = this.data();
    if (!a) return '';
    const best = [...a.by_day].sort((x, y) => y.orders - x.orders)[0];
    return `Orders by day over ${a.period.days} days. Total: ${a.totals.orders}. `
      + (best?.orders ? `Busiest day: ${this.dateLabel(best.day)}, ${best.orders}.` : '');
  });

  constructor() {
    // Вкладку открыли снова: цифры могли измениться
    effect(() => {
      if (!this.active()) return;
      untracked(() => {
        if (this.showVenue() && this.venue()) this.loadVenue();
        if (this.showBrands()) this.loadBrands();
      });
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    if (this.showVenue()) {
      this.api.getMyVenues().subscribe({
        next: list => {
          this.venues.set(list);
          this.venuesLoaded.set(true);
          if (list.length && !this.venue()) {
            this.venue.set(list[0].slug);
            this.loadVenue();
          }
        },
        error: err => {
          this.venuesLoaded.set(true);
          this.venueError.set("Couldn't load venues: " + AuthService.errorText(err));
        },
      });
    }
    if (this.showBrands()) this.loadBrands();
  }

  setVenue(slug: string) {
    if (!slug || slug === this.venue()) return;
    this.venue.set(slug);
    this.loadVenue();
  }

  setDays(days: number) {
    if (days === this.days()) return;
    this.days.set(days);
    this.loadVenue();
  }

  setDemo(on: boolean) {
    this.demo.set(on);
    this.loadVenue();
  }

  loadVenue() {
    const slug = this.venue();
    if (!slug) return;
    const seq = ++this.venueSeq;
    this.venueError.set('');
    this.api.getVenueAnalytics(slug, this.days(), this.demo()).subscribe({
      next: a => { if (seq === this.venueSeq) this.data.set(a); },
      error: err => {
        if (seq !== this.venueSeq) return;
        this.data.set(null);
        this.venueError.set("Couldn't load analytics: " + AuthService.errorText(err));
      },
    });
  }

  loadBrands() {
    this.brandsError.set('');
    this.api.getBrandsAnalytics().subscribe({
      next: b => this.brands.set(b),
      error: err => {
        this.brands.set(null);
        this.brandsError.set("Couldn't load the beer summary: " + AuthService.errorText(err));
      },
    });
  }

  /** CSV со строками заказов: браузер сохраняет его файлом. */
  export() {
    const slug = this.venue();
    if (!slug || this.exporting()) return;
    this.exporting.set(true);
    this.api.exportVenueOrders(slug, this.days(), this.demo()).subscribe({
      next: blob => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `flavor-tree-${slug}-${this.days()}d.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: err => {
        this.exporting.set(false);
        this.venueError.set("Couldn't export the file: " + AuthService.errorText(err));
      },
    });
  }

  /** По сорту нет ни отметок, ни оценок пар, ни заказов, ни любимых. */
  isQuiet(row: BrandInsight): boolean {
    return !row.tastings && !row.votes && !row.ordered && !row.favorites;
  }

  money(value: number): string {
    return value.toLocaleString('en-US').replace(/ /g, ' ') + ' ₸';
  }

  /** «24 сент.» из 2026-09-24. */
  dateLabel(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  }
}
