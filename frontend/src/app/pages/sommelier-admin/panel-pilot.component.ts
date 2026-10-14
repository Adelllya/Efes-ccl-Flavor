import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { PilotReport, Venue } from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { PanelQrPrintComponent } from './panel-qr-print.component';
import { flash, formatMoney, isErrorText } from './panel-shared';

type Preset = 'all' | 'today' | 'week' | 'month' | 'custom';
type CsvKind = 'events' | 'orders' | 'feedback';

interface Kpi {
  id: string;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}

/** Даты отчёта считаются по Алматы, поэтому и «сегодня» берём в этом поясе, а не в поясе браузера. */
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' });

function almatyDay(offsetDays = 0): string {
  return DAY_FORMAT.format(new Date(Date.now() - offsetDays * 86400000));
}

/**
 * Вкладка "Пилот": цифры для защиты и для заведения. Гости, воронка от скана QR до заказа
 * с напитком из подбора, средний чек с подбором и без, лучшие пары и оценки гостей, выгрузка CSV.
 * Владелец видит своё заведение, модератор любое или все сразу.
 */
@Component({
  selector: 'panel-pilot',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent, PanelQrPrintComponent],
  template: `
    <div class="wa-page wa-page-single">
      <div class="wa-overview">
        <div class="wa-card">
          <div class="wa-card-head">
            <div class="wa-card-head-text">
              <h3 class="wa-card-title">Venue pilot</h3>
              <p class="wa-card-sub">{{ subtitle() }}</p>
            </div>
            <button type="button" class="wa-iconbtn" title="Refresh" [disabled]="loading()" (click)="load()">
              <panel-icon name="refresh" />
            </button>
          </div>

          <div class="wa-pilot-controls">
            @if (isModerator()) {
              <div class="wa-field wa-pilot-venue">
                <span class="wa-label">Venue</span>
                <ft-select [options]="venueOptions()" [searchable]="true" placeholder="All venues"
                           searchPlaceholder="Venue name" emptyText="No venues yet"
                           [ngModel]="venue()" (ngModelChange)="pickVenue($event)" />
              </div>
            }
            <div class="wa-field">
              <span class="wa-label">Period</span>
              <div class="wa-pills wa-pilot-pills">
                @for (p of presets; track p.value) {
                  <button type="button" class="wa-pill" [class.active]="preset() === p.value" (click)="setPreset(p.value)">{{ p.label }}</button>
                }
              </div>
            </div>
            <div class="wa-pilot-dates">
              <label class="wa-field">
                <span class="wa-label">From</span>
                <input class="input" type="date" [ngModel]="from()" (ngModelChange)="setDate('from', $event)" />
              </label>
              <label class="wa-field">
                <span class="wa-label">To</span>
                <input class="input" type="date" [ngModel]="to()" (ngModelChange)="setDate('to', $event)" />
              </label>
            </div>
          </div>

          <div class="wa-actions">
            <span class="wa-label">Export for Excel:</span>
            @for (c of csvKinds; track c.value) {
              <button type="button" class="btn-outline" [disabled]="!report() || downloading() === c.value" (click)="download(c.value)">
                <panel-icon name="download" /> {{ downloading() === c.value ? 'Preparing...' : c.label }}
              </button>
            }
            @if (venue()) {
              <button type="button" class="btn-outline" [disabled]="qrOpening()" (click)="openQr()">
                <panel-icon name="qr" /> Table QR codes
              </button>
            }
          </div>
          @if (msg()) {
            <p class="wa-msg" [class.error]="isError(msg())">{{ msg() }}</p>
          }
        </div>

        @if (error()) {
          <div class="wa-loadbar">
            <panel-icon name="alert" />
            <span>{{ error() }}</span>
            <button type="button" class="btn-outline" (click)="load()"><panel-icon name="refresh" /> Refresh</button>
          </div>
        }

        @if (!report() && loading()) {
          <p class="wa-muted">Loading...</p>
        }

        @if (report(); as r) {
          <div class="wa-stats">
            @for (k of kpis(); track k.id) {
              <div class="wa-stat wa-kpi" [class.wa-stat-accent]="k.accent">
                <strong>{{ k.value }}</strong>
                <span>{{ k.label }}</span>
                @if (k.sub) { <small>{{ k.sub }}</small> }
              </div>
            }
          </div>

          <div class="wa-card">
            <h3 class="wa-card-title"><panel-icon name="filter" />Guest funnel</h3>
            <p class="wa-muted wa-pilot-note">Unique guests (browser sessions) who reached each step. Percentage is relative to the previous step.</p>
            <ol class="wa-funnel">
              @for (f of funnel(); track f.step) {
                <li class="wa-funnel-row" [title]="f.label + ': ' + f.count">
                  <span class="wa-funnel-label">{{ f.label }}</span>
                  <span class="wa-funnel-track" aria-hidden="true"><span class="wa-funnel-bar" [style.width.%]="f.width"></span></span>
                  <span class="wa-funnel-count">{{ f.count }}</span>
                  <span class="wa-funnel-conv">{{ f.conv }}</span>
                </li>
              }
            </ol>
          </div>

          <div class="wa-card">
            <h3 class="wa-card-title"><panel-icon name="pairings" />Top pairings</h3>
            @if (r.top_pairs.length) {
              <div class="wa-data-wrap">
                <table class="wa-data">
                  <thead>
                    <tr><th>Dish</th><th>Drink</th><th class="num">Opened</th><th class="num">Added</th><th class="num">Ordered</th><th class="num">Rating</th></tr>
                  </thead>
                  <tbody>
                    @for (p of r.top_pairs; track $index) {
                      <tr>
                        <td>{{ p.dish }}</td>
                        <td>{{ p.drink }}</td>
                        <td class="num">{{ p.opens }}</td>
                        <td class="num">{{ p.adds }}</td>
                        <td class="num">{{ p.ordered }}</td>
                        <td class="num">{{ p.avg_rating !== null ? rating(p.avg_rating) : '-' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="wa-muted">No one has opened dish pairings during this period yet.</p>
            }
          </div>

          <div class="wa-card">
            <h3 class="wa-card-title"><panel-icon name="clock" />By day</h3>
            <div class="wa-data-wrap wa-data-scroll">
              <table class="wa-data">
                <thead>
                  <tr><th>Day</th><th class="num">Guests</th><th class="num">Scans</th><th class="num">Pairings</th><th class="num">Orders</th><th class="num">With pairing</th><th class="num">Avg. check</th></tr>
                </thead>
                <tbody>
                  @for (d of days(); track d.date) {
                    <tr [class.wa-data-empty]="!d.sessions && !d.orders">
                      <td>{{ dayLabel(d.date) }}</td>
                      <td class="num">{{ d.sessions }}</td>
                      <td class="num">{{ d.scans ?? '-' }}</td>
                      <td class="num">{{ d.pair_opens }}</td>
                      <td class="num">{{ d.orders }}</td>
                      <td class="num">{{ d.orders_with_pairing ?? '-' }}</td>
                      <td class="num">{{ d.avg_check !== null ? money(d.avg_check) : '-' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          @if (r.by_table.length) {
            <div class="wa-card">
              <h3 class="wa-card-title"><panel-icon name="store" />By table</h3>
              <div class="wa-data-wrap wa-data-scroll">
                <table class="wa-data">
                  <thead><tr><th>Table</th><th class="num">Guests</th><th class="num">Scans</th><th class="num">Orders</th></tr></thead>
                  <tbody>
                    @for (t of r.by_table; track t.table) {
                      <tr>
                        <td>{{ t.table > 0 ? 'Table ' + t.table : 'Takeaway' }}</td>
                        <td class="num">{{ t.sessions }}</td>
                        <td class="num">{{ t.scans ?? '-' }}</td>
                        <td class="num">{{ t.orders }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }

          <div class="wa-card">
            <h3 class="wa-card-title"><panel-icon name="star" />Guest ratings</h3>
            @for (f of r.feedback ?? []; track $index) {
              <div class="wa-quote wa-pilot-quote">
                <span class="wa-label">{{ stars(f.rating) }} · {{ f.dish || 'no dish given' }} and {{ f.drink || 'no drink given' }}@if (f.order_number) { · order #{{ f.order_number }} } · {{ when(f.created_at) }}</span>
                @if (f.comment) { <p>{{ f.comment }}</p> }
              </div>
            } @empty {
              <p class="wa-muted">No ratings yet. Guests are asked about the pairing on the order screen.</p>
            }
          </div>

          <p class="wa-hint">Period {{ dayLabel(r.period.from) }} - {{ dayLabel(r.period.to) }}, Almaty time. Cancelled orders aren't counted.
            "From pairing" means the drink was added with the button in the "Find a drink" panel or from the AI sommelier chat.</p>
        }
      </div>
    </div>

    @if (qrVenue(); as v) {
      <panel-qr-print [venue]="v" (closed)="qrVenue.set(null)" />
    }
  `
})
export class PanelPilotComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly money = formatMoney;
  isError = isErrorText;

  readonly presets: { value: Preset; label: string }[] = [
    { value: 'all', label: 'Whole pilot' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: '7 days' },
    { value: 'month', label: '30 days' }
  ];
  readonly csvKinds: { value: CsvKind; label: string }[] = [
    { value: 'orders', label: 'Orders' },
    { value: 'events', label: 'Events' },
    { value: 'feedback', label: 'Ratings' }
  ];

  isModerator = computed(() => this.auth.role() === 'moderator');

  venues = signal<Venue[]>([]);
  /** slug заведения; пусто - модератор смотрит все заведения, владелец своё по умолчанию. */
  venue = signal('');
  preset = signal<Preset>('all');
  from = signal('');
  to = signal('');

  report = signal<PilotReport | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  msg = signal<string | null>(null);
  downloading = signal<CsvKind | null>(null);
  qrVenue = signal<Venue | null>(null);
  qrOpening = signal(false);
  private loadSeq = 0;

  venueOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'All venues' },
    ...this.venues().map(v => ({ value: v.slug, label: v.name, hint: v.city || '' }))
  ]);

  readonly subtitle = computed(() => {
    const r = this.report();
    const name = r?.venue?.name ?? (this.isModerator() && !this.venue() ? 'All venues' : this.auth.user()?.venue?.name ?? '');
    if (!r) return name;
    return `${name}${name ? ', ' : ''}${this.dayLabel(r.period.from)} - ${this.dayLabel(r.period.to)}`;
  });

  readonly kpis = computed<Kpi[]>(() => {
    const t = this.report()?.totals;
    if (!t) return [];
    const cancelled = t.orders_cancelled ? `, cancelled: ${t.orders_cancelled}` : '';
    return [
      { id: 'sessions', label: 'Guests', value: String(t.sessions), sub: 'by browser session' },
      { id: 'scans', label: 'QR scans', value: String(t.scans), sub: `menu opens: ${t.menu_opens}` },
      { id: 'pair', label: 'Pairings opened', value: String(t.pair_opens), sub: `added from pairing: ${t.pair_adds}` },
      { id: 'orders', label: 'Orders', value: String(t.orders), sub: `with a paired drink: ${t.orders_with_pairing}${cancelled}` },
      {
        id: 'share', label: 'Items from pairing', value: this.percent(t.share_items_from_pairing), accent: true,
        sub: `${t.items_from_pairing} of ${t.items}`
      },
      {
        id: 'check', label: 'Average check', value: t.avg_check !== null ? this.money(t.avg_check) : '-',
        sub: `with pairing ${this.moneyOrDash(t.avg_check_with_pairing)}, without ${this.moneyOrDash(t.avg_check_without_pairing)}`
      },
      {
        id: 'rating', label: 'Pairing rating', value: t.avg_rating !== null ? `${this.rating(t.avg_rating)} of 5` : '-',
        sub: `ratings: ${t.feedback_count}`
      },
      { id: 'ai', label: 'AI sommelier questions', value: String(t.ai_asks), sub: `added from chat: ${t.ai_adds}` }
    ];
  });

  /** Шаги воронки: ширина полосы от первого шага, процент от предыдущего. */
  readonly funnel = computed(() => {
    const steps = this.report()?.funnel ?? [];
    const max = Math.max(1, ...steps.map(s => s.count));
    return steps.map((s, i) => {
      const prev = i > 0 ? steps[i - 1].count : 0;
      return {
        ...s,
        width: Math.round((s.count / max) * 100),
        conv: i === 0 ? '' : prev ? this.percent(s.count / prev) : '-'
      };
    });
  });

  /** Свежие дни сверху. */
  readonly days = computed(() => [...(this.report()?.by_day ?? [])].reverse());

  ngOnInit() {
    if (this.isModerator()) this.loadVenues();
    else this.venue.set(this.auth.user()?.venue?.slug ?? '');
    this.load();
  }

  pickVenue(slug: string) {
    if ((slug || '') === this.venue()) return;
    this.venue.set(slug || '');
    this.load();
  }

  setPreset(p: Preset) {
    this.preset.set(p);
    const today = almatyDay();
    if (p === 'all') {
      this.from.set('');
      this.to.set('');
    } else {
      this.to.set(today);
      this.from.set(p === 'today' ? today : almatyDay(p === 'week' ? 6 : 29));
    }
    this.load();
  }

  setDate(which: 'from' | 'to', value: string) {
    (which === 'from' ? this.from : this.to).set(value || '');
    this.preset.set(this.from() || this.to() ? 'custom' : 'all');
    const f = this.from();
    const t = this.to();
    if (f && t && f > t) return;
    this.load();
  }

  load() {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.api.getPilotReport(this.venue() || null, this.from() || undefined, this.to() || undefined).subscribe({
      next: r => {
        if (seq !== this.loadSeq) return;
        this.report.set(r);
        this.loading.set(false);
      },
      error: err => {
        if (seq !== this.loadSeq) return;
        this.loading.set(false);
        this.error.set('Couldn\'t load the report: ' + AuthService.errorText(err));
      }
    });
  }

  /** CSV за тот же период, что на экране. Файл собираем из ответа: ссылка с токеном в браузере не нужна. */
  download(kind: CsvKind) {
    const r = this.report();
    if (!r || this.downloading()) return;
    this.downloading.set(kind);
    const slug = this.venue() || r.venue?.slug || '';
    this.api.downloadPilotCsv(kind, slug || null, r.period.from, r.period.to).subscribe({
      next: blob => {
        this.downloading.set(null);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pilot-${slug || 'all'}-${kind}-${r.period.from}-${r.period.to}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: err => {
        this.downloading.set(null);
        flash(this.msg, 'Error: ' + AuthService.errorText(err));
      }
    });
  }

  openQr() {
    const slug = this.venue();
    if (!slug || this.qrOpening()) return;
    this.qrOpening.set(true);
    this.api.getVenue(slug).subscribe({
      next: v => {
        this.qrOpening.set(false);
        this.qrVenue.set(v);
      },
      error: err => {
        this.qrOpening.set(false);
        flash(this.msg, 'Error: ' + AuthService.errorText(err));
      }
    });
  }

  percent(share: number | null | undefined): string {
    if (share === null || share === undefined || !isFinite(share)) return '-';
    const p = share * 100;
    return `${p < 10 && p % 1 ? p.toFixed(1) : Math.round(p)}%`;
  }

  rating(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  }

  stars(n: number): string {
    return '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - n));
  }

  /** "2026-10-01" как "01.10.2026". */
  dayLabel(iso: string): string {
    const [y, m, d] = (iso || '').split('-');
    return y && m && d ? `${m}/${d}/${y}` : iso;
  }

  when(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  private moneyOrDash(value: number | null): string {
    return value !== null ? this.money(value) : '-';
  }

  private loadVenues() {
    this.api.getVenues().subscribe({
      next: list => this.venues.set(list),
      error: () => {
        // Без списка модератор всё равно видит отчёт по всем заведениям
      }
    });
  }
}
