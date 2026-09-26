import {
  Component, ElementRef, HostListener, OnDestroy, OnInit, ViewEncapsulation, computed, inject, input, output, signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { QrLink, Venue } from '../../models/flavor-tree.models';
import { PanelIconComponent } from './panel-icons';

/** Табличек на листе A4: 2 x 2 формата A6. */
const PER_PAGE = 4;
/** Больше за раз не печатаем: столько запросов QR подряд и столько листов в предпросмотре. */
const MAX_TABLES = 100;
/** Сколько QR качаем одновременно. */
const PARALLEL = 4;

/**
 * Печать QR на столы: таблички A6, по четыре на листе A4, с названием заведения, номером стола
 * и короткой подсказкой. Каждый QR ведёт на /menu/<slug>?table=N&src=qr, картинку рисует сервер.
 *
 * Слой выносится прямо в body: при печати всё приложение прячется (body.qrp-printing),
 * на бумагу идут только листы. Перед печатью показываем, какой адрес зашит в QR:
 * если это адрес ноутбука, у гостей ничего не откроется.
 */
@Component({
  selector: 'panel-qr-print',
  standalone: true,
  imports: [FormsModule, PanelIconComponent],
  encapsulation: ViewEncapsulation.None,
  host: { class: 'qrp-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'QR для столов' },
  template: `
    <div class="qrp-screen">
      <div class="wa-card qrp-bar">
        <div class="qrp-bar-text">
          <h3 class="wa-card-title">QR для столов</h3>
          <p class="wa-card-sub">{{ venue().name }}: таблички A6, по четыре на листе A4</p>
        </div>
        <div class="qrp-range">
          <label class="wa-field">
            <span class="wa-label">Столы с</span>
            <input class="input" type="number" min="1" [max]="tablesCount()" [ngModel]="from()" (ngModelChange)="setFrom($event)" />
          </label>
          <label class="wa-field">
            <span class="wa-label">по</span>
            <input class="input" type="number" min="1" [max]="tablesCount()" [ngModel]="to()" (ngModelChange)="setTo($event)" />
          </label>
        </div>
        <div class="wa-actions qrp-actions">
          <button type="button" class="btn-amber" (click)="print()" [disabled]="!tables().length">
            <panel-icon name="printer" /> Печать
          </button>
          <button type="button" class="btn-outline" (click)="closed.emit()">
            <panel-icon name="close" /> Закрыть
          </button>
        </div>
      </div>

      <div class="wa-card qrp-check">
        @if (link(); as l) {
          <p class="wa-muted">В QR стола {{ from() }} зашита ссылка:</p>
          <code class="qrp-url">{{ l.url }}</code>
          @if (l.local) {
            <p class="wa-error"><panel-icon name="alert" /> Это адрес компьютера или локальной сети, с телефонов гостей он не откроется.
              Откройте панель на рабочем сайте или задайте на сервере FT_PUBLIC_SITE_URL.</p>
          } @else if (!isHttps(l.url)) {
            <p class="wa-error"><panel-icon name="alert" /> Ссылка без https: часть телефонов покажет предупреждение.</p>
          } @else if (!l.configured) {
            <p class="wa-muted">Адрес взят из адреса этой страницы. Чтобы таблички не зависели от того, откуда открыта панель,
              задайте FT_PUBLIC_SITE_URL на сервере. Если домен сайта сменится, таблички придётся печатать заново.</p>
          } @else {
            <p class="wa-muted">Адрес задан на сервере. Если домен сайта сменится, таблички придётся печатать заново.</p>
          }
        } @else if (linkError()) {
          <p class="wa-error"><panel-icon name="alert" /> {{ linkError() }}</p>
        } @else {
          <p class="wa-muted">Проверяем ссылку в QR...</p>
        }
        @if (!venue().is_published) {
          <p class="wa-error"><panel-icon name="alert" /> Меню скрыто от гостей: включите «Показывать гостям» во вкладке «Меню», иначе QR откроет ошибку.</p>
        }
        @if (failedCount()) {
          <p class="wa-error">Не загрузилось QR: {{ failedCount() }}. <button type="button" class="wa-link-btn" (click)="retryFailed()">Повторить</button></p>
        }
        <p class="wa-hint">В окне печати: бумага A4, масштаб 100%, поля «нет» или «минимальные». Режьте по пунктиру.
          Перед печатью всех табличек отсканируйте один код телефоном.</p>
      </div>
    </div>

    <div class="qrp-sheets">
      @for (page of pages(); track $index) {
        <section class="qrp-page">
          @for (t of page; track t) {
            <article class="qrp-card">
              <p class="qrp-venue">{{ venue().name }}</p>
              <p class="qrp-table">Стол {{ t }}</p>
              <div class="qrp-code">
                @if (qr()[t]; as src) {
                  <img [src]="src" [alt]="'QR-код меню, стол ' + t" />
                } @else if (failed()[t]) {
                  <span class="qrp-code-empty">QR не загрузился</span>
                } @else {
                  <span class="qrp-code-empty">Загружаем...</span>
                }
              </div>
              <p class="qrp-cta">Наведите камеру телефона на код</p>
              <p class="qrp-sub">{{ subline() }}</p>
              <p class="qrp-foot">Алкоголь подаём гостям старше 21 года</p>
            </article>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    .qrp-root {
      position: fixed;
      inset: 0;
      z-index: 3000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      overflow: auto;
      background: #F5F5F4;
      font-size: 0.92rem;
    }
    .qrp-screen { display: flex; flex-direction: column; gap: 12px; max-width: 900px; width: 100%; margin: 0 auto; }
    .qrp-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 20px; }
    .qrp-bar .wa-card-title { margin: 0; }
    .qrp-bar-text { flex: 1 1 220px; }
    .qrp-range { display: flex; gap: 10px; }
    .qrp-range .wa-field { width: 96px; }
    .qrp-actions { margin-top: 0; }
    .qrp-check { display: flex; flex-direction: column; gap: 8px; }
    .qrp-check .wa-error { margin: 0; display: flex; align-items: flex-start; gap: 6px; }
    .qrp-url {
      display: block;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--beer-glow);
      color: var(--beer-deep);
      font-family: monospace;
      font-size: 0.85rem;
      overflow-wrap: anywhere;
    }

    /* Листы: на экране это предпросмотр, на бумаге ровно A4 */
    .qrp-sheets { display: flex; flex-direction: column; align-items: center; gap: 16px; overflow-x: auto; padding-bottom: 24px; }
    .qrp-page {
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: repeat(2, 105mm);
      grid-template-rows: repeat(2, 148.5mm);
      width: 210mm;
      height: 297mm;
      background: #fff;
      box-shadow: 0 4px 24px -6px rgba(0, 0, 0, 0.18);
    }
    .qrp-card {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2.5mm;
      padding: 9mm 8mm;
      border: 0.3mm dashed #C8C2BC;
      color: #1C1917;
      text-align: center;
      font-family: var(--font-body);
    }
    .qrp-card p { margin: 0; }
    .qrp-venue { font-size: 10pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #92400E; }
    .qrp-table { font-family: var(--font-heading); font-size: 26pt; font-weight: 800; line-height: 1.05; }
    .qrp-code { display: flex; align-items: center; justify-content: center; width: 62mm; height: 62mm; }
    .qrp-code img { width: 100%; height: 100%; }
    .qrp-code-empty { font-size: 9pt; color: #78716C; }
    .qrp-cta { font-family: var(--font-heading); font-size: 12.5pt; font-weight: 700; line-height: 1.2; }
    .qrp-sub { font-size: 9.5pt; line-height: 1.3; color: #44403C; }
    .qrp-foot { margin-top: 1.5mm !important; font-size: 7.5pt; color: #78716C; }

    @media screen {
      body.qrp-printing { overflow: hidden; }
    }

    @media print {
      @page { size: A4; margin: 0; }
      body.qrp-printing { background: #fff !important; overflow: visible !important; }
      body.qrp-printing > *:not(.qrp-root) { display: none !important; }
      .qrp-root { position: static; display: block; padding: 0; overflow: visible; background: #fff; }
      .qrp-screen { display: none; }
      .qrp-sheets { display: block; padding: 0; overflow: visible; }
      .qrp-page { box-shadow: none; break-after: page; page-break-after: always; }
      .qrp-page:last-child { break-after: auto; page-break-after: auto; }
      .qrp-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `]
})
export class PanelQrPrintComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  venue = input.required<Venue>();
  closed = output<void>();

  readonly tablesCount = computed(() => Math.max(1, Math.min(500, Number(this.venue().tables_count) || 1)));
  from = signal(1);
  to = signal(1);

  /** Адрес картинки QR по номеру стола (blob: из ответа сервера). */
  qr = signal<Record<number, string>>({});
  failed = signal<Record<number, boolean>>({});
  link = signal<QrLink | null>(null);
  linkError = signal('');

  readonly tables = computed(() => {
    const a = this.from();
    const b = this.to();
    if (!(a >= 1) || !(b >= a)) return [];
    const list: number[] = [];
    for (let t = a; t <= b && list.length < MAX_TABLES; t++) list.push(t);
    return list;
  });

  readonly pages = computed(() => {
    const list = this.tables();
    const pages: number[][] = [];
    for (let i = 0; i < list.length; i += PER_PAGE) pages.push(list.slice(i, i + PER_PAGE));
    return pages;
  });

  readonly failedCount = computed(() => this.tables().filter(t => this.failed()[t]).length);

  readonly subline = computed(() => this.venue().accepts_orders === false
    ? 'Меню и напиток к вашему блюду'
    : 'Меню, напиток к вашему блюду и заказ прямо со стола');

  private loading = new Set<number>();
  private subs = new Subscription();

  ngOnInit() {
    // Слой прямо в body: так при печати можно спрятать всё приложение одним правилом
    document.body.appendChild(this.host.nativeElement);
    document.body.classList.add('qrp-printing');
    const n = this.tablesCount();
    this.from.set(1);
    this.to.set(Math.min(n, MAX_TABLES));
    this.loadLink();
    this.loadCodes();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    document.body.classList.remove('qrp-printing');
    for (const url of Object.values(this.qr())) URL.revokeObjectURL(url);
    this.host.nativeElement.remove();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closed.emit();
  }

  isHttps(url: string): boolean {
    return url.startsWith('https://');
  }

  setFrom(value: unknown) {
    const n = this.clamp(value);
    if (n === null) return;
    this.from.set(n);
    if (this.to() < n) this.to.set(n);
    this.loadCodes();
  }

  setTo(value: unknown) {
    const n = this.clamp(value);
    if (n === null) return;
    this.to.set(Math.max(n, this.from()));
    this.loadCodes();
  }

  print() {
    window.print();
  }

  retryFailed() {
    this.failed.set({});
    this.loadCodes();
  }

  private clamp(value: unknown): number | null {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(n, this.tablesCount());
  }

  private loadLink() {
    const v = this.venue();
    this.api.getQrLink(v.slug, 1).subscribe({
      next: l => this.link.set(l),
      error: err => this.linkError.set('Не удалось проверить ссылку в QR: ' + AuthService.errorText(err))
    });
  }

  /** Качаем только недостающие коды, по несколько сразу. */
  private loadCodes() {
    const slug = this.venue().slug;
    const missing = this.tables().filter(t => !this.qr()[t] && !this.failed()[t] && !this.loading.has(t));
    if (!missing.length) return;
    missing.forEach(t => this.loading.add(t));
    this.subs.add(from(missing).pipe(
      mergeMap(t => new Promise<[number, Blob | null]>(resolve => {
        this.api.getTableQr(slug, t).subscribe({ next: b => resolve([t, b]), error: () => resolve([t, null]) });
      }), PARALLEL)
    ).subscribe(([t, blob]) => {
      this.loading.delete(t);
      if (blob) this.qr.update(m => ({ ...m, [t]: URL.createObjectURL(blob) }));
      else this.failed.update(m => ({ ...m, [t]: true }));
    }));
  }
}
