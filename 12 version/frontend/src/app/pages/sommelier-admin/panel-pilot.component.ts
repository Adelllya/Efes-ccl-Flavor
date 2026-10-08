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
              <h3 class="wa-card-title">Пилот в заведении</h3>
              <p class="wa-card-sub">{{ subtitle() }}</p>
            </div>
            <button type="button" class="wa-iconbtn" title="Обновить" [disabled]="loading()" (click)="load()">
              <panel-icon name="refresh" />
            </button>
          </div>

          <div class="wa-pilot-controls">
            @if (isModerator()) {
              <div class="wa-field wa-pilot-venue">
                <span class="wa-label">Заведение</span>
                <ft-select [options]="venueOptions()" [searchable]="true" placeholder="Все заведения"
                           searchPlaceholder="Название заведения" emptyText="Заведений пока нет"
                           [ngModel]="venue()" (ngModelChange)="pickVenue($event)" />
              </div>
            }
            <div class="wa-field">
              <span class="wa-label">Период</span>
              <div class="wa-pills wa-pilot-pills">
                @for (p of presets; track p.value) {
                  <button type="button" class="wa-pill" [class.active]="preset() === p.value" (click)="setPreset(p.value)">{{ p.label }}</button>
                }
              </div>
            </div>
            <div class="wa-pilot-dates">
              <label class="wa-field">
                <span class="wa-label">С</span>
                <input class="input" type="date" [ngModel]="from()" (ngModelChange)="setDate('from', $event)" />
              </label>
              <label class="wa-field">
                <span class="wa-label">По</span>
                <input class="input" type="date" [ngModel]="to()" (ngModelChange)="setDate('to', $event)" />
              </label>
            </div>
          </div>

          <div class="wa-actions">
            <span class="wa-label">Выгрузка для Excel:</span>
            @for (c of csvKinds; track c.value) {
              <button type="button" class="btn-outline" [disabled]="!report() || downloading() === c.value" (click)="download(c.value)">
                <panel-icon name="download" /> {{ downloading() === c.value ? 'Готовим...' : c.label }}
              </button>
            }
            @if (venue()) {
              <button type="button" class="btn-outline" [disabled]="qrOpening()" (click)="openQr()">
                <panel-icon name="qr" /> QR для столов
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
            <button type="button" class="btn-outline" (click)="load()"><panel-icon name="refresh" /> Обновить</button>
          </div>
        }

        @if (!report() && loading()) {
          <p class="wa-muted">Загрузка...</p>
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
            <h3 class="wa-card-title"><panel-icon name="filter" />Воронка гостя</h3>
            <p class="wa-muted wa-pilot-note">Уникальные гости (сессии браузера), дошедшие до шага. Процент от предыдущего шага.</p>
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
            <h3 class="wa-card-title"><panel-icon name="pairings" />Лучшие пары</h3>
            @if (r.top_pairs.length) {
              <div class="wa-data-wrap">
                <table class="wa-data">
                  <thead>
                    <tr><th>Блюдо</th><th>Напиток</th><th class="num">Открыли</th><th class="num">Добавили</th><th class="num">Заказали</th><th class="num">Оценка</th></tr>
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
              <p class="wa-muted">Пока никто не открывал подбор к блюдам за этот период.</p>
            }
          </div>

          <div class="wa-card">
            <h3 class="wa-card-title"><panel-icon name="clock" />По дням</h3>
            <div class="wa-data-wrap wa-data-scroll">
              <table class="wa-data">
                <thead>
                  <tr><th>День</th><th class="num">Гости</th><th class="num">Сканы</th><th class="num">Подбор</th><th class="num">Заказы</th><th class="num">С подбором</th><th class="num">Средний чек</th></tr>
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
              <h3 class="wa-card-title"><panel-icon name="store" />По столам</h3>
              <div class="wa-data-wrap wa-data-scroll">
                <table class="wa-data">
                  <thead><tr><th>Стол</th><th class="num">Гости</th><th class="num">Сканы</th><th class="num">Заказы</th></tr></thead>
                  <tbody>
                    @for (t of r.by_table; track t.table) {
                      <tr>
                        <td>{{ t.table > 0 ? 'Стол ' + t.table : 'С собой' }}</td>
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
            <h3 class="wa-card-title"><panel-icon name="star" />Оценки гостей</h3>
            @for (f of r.feedback ?? []; track $index) {
              <div class="wa-quote wa-pilot-quote">
                <span class="wa-label">{{ stars(f.rating) }} · {{ f.dish || 'блюдо не указано' }} и {{ f.drink || 'напиток не указан' }}@if (f.order_number) { · заказ №{{ f.order_number }} } · {{ when(f.created_at) }}</span>
                @if (f.comment) { <p>{{ f.comment }}</p> }
              </div>
            } @empty {
              <p class="wa-muted">Оценок пока нет. Гость видит вопрос о паре на экране заказа.</p>
            }
          </div>

          <p class="wa-hint">Период {{ dayLabel(r.period.from) }} - {{ dayLabel(r.period.to) }} по времени Алматы. Отменённые заказы не считаются.
            «Из подбора» - напиток добавлен кнопкой в панели «Подобрать напиток» или из чата ИИ-сомелье.</p>
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
    { value: 'all', label: 'Весь пилот' },
    { value: 'today', label: 'Сегодня' },
    { value: 'week', label: '7 дней' },
    { value: 'month', label: '30 дней' }
  ];
  readonly csvKinds: { value: CsvKind; label: string }[] = [
    { value: 'orders', label: 'Заказы' },
    { value: 'events', label: 'События' },
    { value: 'feedback', label: 'Оценки' }
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
    { value: '', label: 'Все заведения' },
    ...this.venues().map(v => ({ value: v.slug, label: v.name, hint: v.city || '' }))
  ]);

  readonly subtitle = computed(() => {
    const r = this.report();
    const name = r?.venue?.name ?? (this.isModerator() && !this.venue() ? 'Все заведения' : this.auth.user()?.venue?.name ?? '');
    if (!r) return name;
    return `${name}${name ? ', ' : ''}${this.dayLabel(r.period.from)} - ${this.dayLabel(r.period.to)}`;
  });

  readonly kpis = computed<Kpi[]>(() => {
    const t = this.report()?.totals;
    if (!t) return [];
    const cancelled = t.orders_cancelled ? `, отменено: ${t.orders_cancelled}` : '';
    return [
      { id: 'sessions', label: 'Гостей', value: String(t.sessions), sub: 'по сессиям браузера' },
      { id: 'scans', label: 'Сканов QR', value: String(t.scans), sub: `открытий меню: ${t.menu_opens}` },
      { id: 'pair', label: 'Открыли подбор', value: String(t.pair_opens), sub: `добавили из подбора: ${t.pair_adds}` },
      { id: 'orders', label: 'Заказов', value: String(t.orders), sub: `с напитком из подбора: ${t.orders_with_pairing}${cancelled}` },
      {
        id: 'share', label: 'Позиций из подбора', value: this.percent(t.share_items_from_pairing), accent: true,
        sub: `${t.items_from_pairing} из ${t.items}`
      },
      {
        id: 'check', label: 'Средний чек', value: t.avg_check !== null ? this.money(t.avg_check) : '-',
        sub: `с подбором ${this.moneyOrDash(t.avg_check_with_pairing)}, без ${this.moneyOrDash(t.avg_check_without_pairing)}`
      },
      {
        id: 'rating', label: 'Оценка пар', value: t.avg_rating !== null ? `${this.rating(t.avg_rating)} из 5` : '-',
        sub: `оценок: ${t.feedback_count}`
      },
      { id: 'ai', label: 'Вопросов ИИ-сомелье', value: String(t.ai_asks), sub: `добавили из чата: ${t.ai_adds}` }
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
        this.error.set('Не удалось загрузить отчёт: ' + AuthService.errorText(err));
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
        flash(this.msg, 'Ошибка: ' + AuthService.errorText(err));
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
        flash(this.msg, 'Ошибка: ' + AuthService.errorText(err));
      }
    });
  }

  percent(share: number | null | undefined): string {
    if (share === null || share === undefined || !isFinite(share)) return '-';
    const p = share * 100;
    return `${p < 10 && p % 1 ? p.toFixed(1).replace('.', ',') : Math.round(p)}%`;
  }

  rating(value: number): string {
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  }

  stars(n: number): string {
    return '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - n));
  }

  /** "2026-10-01" как "01.10.2026". */
  dayLabel(iso: string): string {
    const [y, m, d] = (iso || '').split('-');
    return y && m && d ? `${d}.${m}.${y}` : iso;
  }

  when(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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
