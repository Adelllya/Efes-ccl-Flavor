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
              <h3 class="wa-card-title">Что дают рекомендации</h3>
              <p class="wa-card-sub">Заказы заведения за период: сколько гостей берут напиток к блюду и сколько берут пару из меню</p>
            </div>
            <div class="an-tools">
              @if (venues().length > 1) {
                <ft-select class="an-venue" [options]="venueOptions()" [ngModel]="venue()" (ngModelChange)="setVenue($event)"
                           ariaLabel="Заведение" />
              }
              <div class="an-seg" role="group" aria-label="Период">
                @for (d of periods; track d) {
                  <button type="button" [class.active]="days() === d" [attr.aria-pressed]="days() === d" (click)="setDays(d)">{{ d }} дней</button>
                }
              </div>
              <button type="button" class="btn-outline" [disabled]="!data() || exporting()" (click)="export()">
                <panel-icon name="download" /> {{ exporting() ? 'Готовим...' : 'CSV' }}
              </button>
            </div>
          </div>

          @if (venueError(); as err) {
            <div class="wa-loadbar" role="alert">
              <panel-icon name="alert" />
              <span>{{ err }}</span>
              <button type="button" class="btn-outline" (click)="loadVenue()"><panel-icon name="refresh" /> Обновить</button>
            </div>
          } @else if (!venue() && venuesLoaded()) {
            <div class="wa-card"><p class="wa-muted">У вашей учётной записи пока нет заведения. Создайте его во вкладке «Меню».</p></div>
          } @else if (!data()) {
            <div class="wa-card"><p class="wa-muted">Загрузка...</p></div>
          } @else {
            @let a = data()!;
            @if (a.demo.orders > 0) {
              <div class="an-demo" role="note">
                <panel-icon name="alert" />
                <span>
                  <b>Показаны демо-данные.</b> {{ a.demo.orders }} из {{ a.totals.orders }} заказов созданы для примера
                  и не являются результатом работы заведения.
                </span>
                <button type="button" class="btn-outline" (click)="setDemo(false)">Скрыть демо-данные</button>
              </div>
            } @else if (!demo()) {
              <div class="an-demo an-demo-off" role="note">
                <span>Демо-данные скрыты: считаются только настоящие заказы.</span>
                <button type="button" class="btn-outline" (click)="setDemo(true)">Показать демо-данные</button>
              </div>
            }

            <div class="an-kpis">
              <div class="an-kpi"><span>Заказов</span><b>{{ a.totals.orders }}</b></div>
              <div class="an-kpi"><span>Выручка</span><b>{{ money(a.totals.revenue) }}</b></div>
              <div class="an-kpi"><span>Средний чек</span><b>{{ a.totals.avg_check === null ? 'нет данных' : money(a.totals.avg_check) }}</b></div>
              <div class="an-kpi an-kpi-accent">
                <span>Заказы с парой из меню</span>
                <b>{{ a.pairing.pair_rate === null ? 'нет данных' : a.pairing.pair_rate + '%' }}</b>
              </div>
            </div>

            @if (!a.totals.orders) {
              <div class="wa-card">
                <p class="wa-muted">За этот период заказов нет. Когда гости начнут заказывать через меню по QR-коду, здесь появятся цифры.</p>
              </div>
            } @else {
              <div class="an-grid">
                <div class="wa-card">
                  <h3 class="wa-card-title">Путь от блюда к паре</h3>
                  <ul class="an-funnel">
                    <li>
                      <span class="an-funnel-label">Заказы с блюдом</span>
                      <span class="an-bar"><span style="width: 100%"></span></span>
                      <b>{{ a.pairing.dish_orders }}</b>
                    </li>
                    <li>
                      <span class="an-funnel-label">из них с напитком</span>
                      <span class="an-bar"><span [style.width.%]="a.pairing.drink_rate ?? 0"></span></span>
                      <b>{{ a.pairing.with_drink }} · {{ a.pairing.drink_rate ?? 0 }}%</b>
                    </li>
                    <li>
                      <span class="an-funnel-label">из них с парой из меню</span>
                      <span class="an-bar an-bar-strong"><span [style.width.%]="a.pairing.pair_rate ?? 0"></span></span>
                      <b>{{ a.pairing.with_pair }} · {{ a.pairing.pair_rate ?? 0 }}%</b>
                    </li>
                  </ul>
                  <p class="an-note">
                    Пара из меню: в заказе есть блюдо и напиток, который сомелье или ИИ советует именно к нему.
                  </p>
                </div>

                <div class="wa-card">
                  <h3 class="wa-card-title">Напитки, добавленные из совета</h3>
                  <dl class="an-advice">
                    <div>
                      <dt>Из совета к блюду</dt>
                      <dd><b>{{ a.advice.pairing.qty }}</b> шт. на {{ money(a.advice.pairing.revenue) }}</dd>
                    </div>
                    <div>
                      <dt>Из чата ИИ-сомелье</dt>
                      <dd><b>{{ a.advice.ai.qty }}</b> шт. на {{ money(a.advice.ai.revenue) }}</dd>
                    </div>
                  </dl>
                  <p class="an-note">
                    Считаются напитки, которые гость добавил кнопкой в совете к блюду или из карточки в чате.
                    Это прямой вклад рекомендаций в выручку бара.
                  </p>
                </div>

                <div class="wa-card">
                  <h3 class="wa-card-title">Средний чек</h3>
                  <ul class="an-checks">
                    @for (row of checks(); track row.label) {
                      <li>
                        <span class="an-funnel-label">{{ row.label }}</span>
                        <span class="an-bar" [class.an-bar-strong]="row.strong"><span [style.width.%]="row.width"></span></span>
                        <b>{{ row.value === null ? 'нет данных' : money(row.value) }}</b>
                      </li>
                    }
                  </ul>
                  <p class="an-note">
                    Чек с напитком всегда больше чека без него. Чтобы узнать эффект рекомендаций, сравнивайте долю заказов
                    с парой до и после их включения.
                  </p>
                </div>

                <div class="wa-card">
                  <h3 class="wa-card-title">Карта бара</h3>
                  <p class="an-draught">
                    <b>{{ a.drinks.draught_rate === null ? 'нет данных' : a.drinks.draught_rate + '%' }}</b>
                    напитков разливные
                  </p>
                  <p class="an-note">От разливного пива остаётся меньше упаковки: кег возвращается на завод.</p>
                  <ol class="an-top">
                    @for (d of a.drinks.top; track d.title) {
                      <li>
                        <span class="an-top-name">{{ d.title }} @if (d.draught) { <span class="wa-chip wa-chip-approved">розлив</span> }</span>
                        <span class="an-top-num">{{ d.qty }} шт. · {{ money(d.revenue) }}</span>
                      </li>
                    } @empty { <li class="wa-muted">Напитков в заказах нет</li> }
                  </ol>
                </div>
              </div>

              <div class="wa-card">
                <div class="wa-card-head">
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title">Заказы по дням</h3>
                    <p class="wa-card-sub">Высота столбика: заказы за день. Тёмная часть: заказы с парой из меню</p>
                  </div>
                </div>
                <div class="an-days" role="img" [attr.aria-label]="daysSummary()">
                  @for (b of bars(); track b.day) {
                    <span class="an-day" [title]="b.label + ': заказов ' + b.orders + ', с парой ' + b.withPair + ', выручка ' + money(b.revenue)">
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
                  <h3 class="wa-card-title">Что заказывают вместе</h3>
                  <ol class="an-top">
                    @for (p of a.top_pairs; track p.dish + p.drink) {
                      <li>
                        <span class="an-top-name">
                          {{ p.dish }} + {{ p.drink }}
                          @if (p.source === 'SOMMELIER') { <span class="wa-chip wa-chip-approved">пара сомелье</span> }
                          @else if (p.source === 'AI') { <span class="wa-chip wa-chip-pending">подбор ИИ</span> }
                        </span>
                        <span class="an-top-num">{{ p.orders }} зак.</span>
                      </li>
                    } @empty { <li class="wa-muted">Пока нет заказов с блюдом и напитком</li> }
                  </ol>
                </div>

                <div class="wa-card">
                  <h3 class="wa-card-title">Блюда без пары</h3>
                  @if (a.dishes.unpaired.length) {
                    <p class="an-note">К этим блюдам в карте бара нет ни одного сорта с парой. Гость не увидит совета.</p>
                    <div class="wa-chips">
                      @for (name of a.dishes.unpaired.slice(0, 14); track name) { <span class="wa-chip">{{ name }}</span> }
                      @if (a.dishes.unpaired.length > 14) { <span class="wa-chip">ещё {{ a.dishes.unpaired.length - 14 }}</span> }
                    </div>
                    <div class="wa-actions">
                      <button type="button" class="btn-amber" (click)="openTab.emit('dishes')"><panel-icon name="dishes" /> Подобрать через ИИ</button>
                    </div>
                  } @else {
                    <p class="wa-muted">У каждого блюда меню есть пара из карты бара.</p>
                  }
                  <h3 class="wa-card-title an-sub-title">Оценки пар от гостей</h3>
                  @if (a.feedback.likes + a.feedback.dislikes) {
                    <p class="an-votes">
                      <b>{{ a.feedback.likes }}</b> подошло, <b>{{ a.feedback.dislikes }}</b> не подошло
                    </p>
                  } @else {
                    <p class="wa-muted">Гости ещё не оценивали сочетания. Вопрос появляется на экране заказа.</p>
                  }
                </div>
              </div>
            }
          }
        }

        @if (showBrands()) {
          <div class="wa-card an-head">
            <div class="wa-card-head-text">
              <h3 class="wa-card-title">Что гости слышат в сортах</h3>
              <p class="wa-card-sub">Отметки из паспортов вкуса: какие ноты называют гости и совпадают ли они с пирамидой сомелье</p>
            </div>
            <button type="button" class="btn-outline" (click)="loadBrands()"><panel-icon name="refresh" /> Обновить</button>
          </div>

          @if (brandsError(); as err) {
            <div class="wa-loadbar" role="alert">
              <panel-icon name="alert" /><span>{{ err }}</span>
              <button type="button" class="btn-outline" (click)="loadBrands()"><panel-icon name="refresh" /> Обновить</button>
            </div>
          } @else if (!brands()) {
            <div class="wa-card"><p class="wa-muted">Загрузка...</p></div>
          } @else {
            @let b = brands()!;
            <div class="an-kpis">
              <div class="an-kpi"><span>Отметок сортов</span><b>{{ b.totals.tastings }}</b></div>
              <div class="an-kpi"><span>Гостей с паспортом</span><b>{{ b.totals.tasters }}</b></div>
              <div class="an-kpi"><span>Уроков прочитано</span><b>{{ b.totals.lessons_done }}</b></div>
              <div class="an-kpi"><span>Ступеней сдано</span><b>{{ b.totals.levels_passed }}</b></div>
              <div class="an-kpi"><span>Оценок пар</span><b>{{ b.totals.votes }}</b></div>
              <div class="an-kpi"><span>Пар от ИИ ждут сомелье</span><b>{{ b.totals.ai_pairings }}</b></div>
            </div>

            <div class="wa-card">
              <div class="an-table" role="table" aria-label="Сорта">
                <div class="an-row an-row-head" role="row">
                  <span role="columnheader">Сорт</span>
                  <span role="columnheader">Отметок</span>
                  <span role="columnheader">Оценка</span>
                  <span role="columnheader">В любимых</span>
                  <span role="columnheader">Заказано</span>
                  <span role="columnheader">Пары подошли</span>
                  <span role="columnheader">Что слышат гости</span>
                </div>
                @for (row of b.brands; track row.id) {
                  @if (isQuiet(row)) {
                    <!-- О сорте пока нечего сказать: одна строка вместо шести нулей -->
                    <div class="an-row an-row-quiet" role="row">
                      <span role="cell" class="an-brand"><b>{{ row.name }}</b><small>{{ row.style }}</small></span>
                      <span role="cell" class="an-quiet">Гости ещё не отмечали, не оценивали и не заказывали этот сорт</span>
                    </div>
                  } @else {
                  <div class="an-row" role="row">
                    <span role="cell" class="an-brand"><b>{{ row.name }}</b><small>{{ row.style }}</small></span>
                    <span role="cell" data-label="Отметок">{{ row.tastings }}</span>
                    <span role="cell" data-label="Оценка">{{ row.rating_avg === null ? 'нет' : row.rating_avg + ' из 5' }}</span>
                    <span role="cell" data-label="В любимых">{{ row.favorites }}</span>
                    <span role="cell" data-label="Заказано">{{ row.ordered }} шт.</span>
                    <span role="cell" data-label="Пары подошли">{{ row.liked_rate === null ? 'нет оценок' : row.liked_rate + '% из ' + row.votes }}</span>
                    <span role="cell" class="an-heard" data-label="Что слышат гости">
                      @for (n of row.heard; track n.id) {
                        <span class="wa-chip" [class.wa-chip-approved]="n.in_pyramid" [title]="n.in_pyramid ? 'Есть в пирамиде сомелье' : 'Нет в пирамиде сомелье'">
                          {{ n.name }} {{ n.share }}%
                        </span>
                      } @empty {
                        <span class="wa-muted">{{ row.tastings ? 'мало отметок: ' + row.tastings + ' из ' + b.min_guests : 'нет отметок' }}</span>
                      }
                    </span>
                  </div>
                  }
                }
              </div>
              <p class="an-note">
                Зелёным отмечены ноты, которые есть в пирамиде сомелье. Серые ноты гости называют сами: это повод перепроверить пирамиду
                или описание сорта. Сводка по нотам появляется от {{ b.min_guests }} отметок.
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
      { label: 'Только еда', value: p.avg_food_only, strong: false },
      { label: 'Еда и напиток', value: p.avg_with_drink, strong: false },
      { label: 'Еда и пара из меню', value: p.avg_with_pair, strong: true },
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
    return `Заказы по дням за ${a.period.days} дней. Всего ${a.totals.orders}. `
      + (best?.orders ? `Больше всего ${this.dateLabel(best.day)}: ${best.orders}.` : '');
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
          this.venueError.set('Не удалось загрузить заведения: ' + AuthService.errorText(err));
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
        this.venueError.set('Не удалось загрузить аналитику: ' + AuthService.errorText(err));
      },
    });
  }

  loadBrands() {
    this.brandsError.set('');
    this.api.getBrandsAnalytics().subscribe({
      next: b => this.brands.set(b),
      error: err => {
        this.brands.set(null);
        this.brandsError.set('Не удалось загрузить сводку по сортам: ' + AuthService.errorText(err));
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
        this.venueError.set('Не удалось выгрузить файл: ' + AuthService.errorText(err));
      },
    });
  }

  /** По сорту нет ни отметок, ни оценок пар, ни заказов, ни любимых. */
  isQuiet(row: BrandInsight): boolean {
    return !row.tastings && !row.votes && !row.ordered && !row.favorites;
  }

  money(value: number): string {
    return value.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₸';
  }

  /** «24 сент.» из 2026-09-24. */
  dateLabel(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
}
