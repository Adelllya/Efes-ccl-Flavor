import { ChangeDetectionStrategy, Component, DestroyRef, Directive, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { API_URL } from '../../core/config';
import { ru } from '../../core/i18n/ru';
import { IconComponent } from '../../ui/icon.component';

// ─────────────────────────────── контракт GET /api/brand/overview/ ───────────────────────────────
export interface TrendDay { date: string; lists: number; efes_top1_shown: number; efes_top1_honest: number; orders: number; }
export interface SkuRow {
  drink_id: string; name: string; impressions: number; top1: number; top1_honest: number; opens: number; orders: number;
  order_kzt: number; avg_score: number | null; review_mean: number | null; review_n: number;
}
export interface CompetitorRow { category: string; label: string; top1: number; share: number; }
export interface DishRow {
  dish_id: string; name: string; lists: number; efes_top1_share: number;
  /** сверх контракта (views_brand): доля по честному баллу; null — сервер не прислал */
  efes_top1_share_honest: number | null;
  top_competitor: { drink_id: string; name: string; category: string } | null;
}
export interface VenueRow {
  slug: string; name: string; city: string; lists: number; efes_top1_share: number; orders: number; order_kzt: number;
  /** сверх контракта: доля по честному баллу; null — сервер не прислал */
  efes_top1_share_honest: number | null;
  /** сверх контракта: списки, где конкурент был (в списке или среди кандидатов); null — сервер не прислал */
  contested_lists: number | null;
  /** сверх контракта: доля Efes №1 по честному баллу только в списках с конкурентом; null — сервер не прислал */
  contested_top1_share_honest: number | null;
  /** сверх контракта: заведение seed_saas — карта и цены выдуманы */
  is_demo_venue: boolean;
}
export interface BrandOverview {
  period: { days: number; from: string; to: string };
  demo: boolean;
  has_demo_data: boolean;
  totals: { lists: number; impressions: number; sessions: number; venues: number; dishes: number };
  efes: {
    top1_share_shown: number; top1_share_honest: number; top3_share: number; impression_share: number;
    avg_score_efes_top: number | null; avg_score_best: number | null;
    /** сверх контракта: средний разрыв «лидер − лучший Efes» по тем же спискам с Efes; null — сервер не прислал */
    avg_score_gap: number | null;
  };
  policy_effect: {
    lists_where_efes_promoted_to_top1: number; share: number; note: string;
    /** сверх контракта: окно политики, баллов (partner_tie_window) */
    window: number;
    /** сверх контракта: из них ничьи и списки, где равный/сильный конкурент в показанный список не попал */
    ties: number; hidden_competitor: number;
  };
  trend: TrendDay[];
  skus: SkuRow[];
  competitors: CompetitorRow[];
  dishes: DishRow[];
  venues: VenueRow[];
  actions: { open_drink: number; expand_why: number; order_intent: number; review: number };
  reviews: { efes_mean: number | null; efes_n: number; others_mean: number | null; others_n: number };
  notes: string[];
  /** сверх контракта: списки, где у Efes был хотя бы один конкурент (в списке или среди кандидатов) */
  contested: { lists: number; top1_share_shown: number; top1_share_honest: number; top3_share: number | null; impression_share: number | null } | null;
  /** сверх контракта: разбивка по источнику списка (pair · venue_menu · ai) */
  by_source: { source: string; lists: number; top1_share_shown: number; top1_share_honest: number }[];
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? x as Obj : {});
const rows = (x: unknown): Obj[] => (Array.isArray(x) ? x.filter(o => o && typeof o === 'object') as Obj[] : []);
const num = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const numN = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const share = (x: unknown): number => Math.min(1, Math.max(0, num(x)));

/** Ответ сервера (или демо-файл) → строго типизированный отчёт; нет поля — ноль / пусто, а не падение страницы. */
export function normalizeOverview(raw: unknown): BrandOverview | null {
  const r = obj(raw);
  if (!Object.keys(r).length) return null;
  const p = obj(r['period']); const t = obj(r['totals']); const e = obj(r['efes']); const pe = obj(r['policy_effect']);
  const a = obj(r['actions']); const rv = obj(r['reviews']);
  return {
    period: { days: num(p['days'], 30), from: str(p['from']), to: str(p['to']) },
    demo: r['demo'] === true,
    has_demo_data: r['has_demo_data'] === true,
    totals: { lists: num(t['lists']), impressions: num(t['impressions']), sessions: num(t['sessions']), venues: num(t['venues']), dishes: num(t['dishes']) },
    efes: {
      top1_share_shown: share(e['top1_share_shown']), top1_share_honest: share(e['top1_share_honest']),
      top3_share: share(e['top3_share']), impression_share: share(e['impression_share']),
      avg_score_efes_top: numN(e['avg_score_efes_top']), avg_score_best: numN(e['avg_score_best']), avg_score_gap: numN(e['avg_score_gap']),
    },
    policy_effect: {
      lists_where_efes_promoted_to_top1: num(pe['lists_where_efes_promoted_to_top1']), share: share(pe['share']), note: str(pe['note']),
      window: num(pe['window'], 2), ties: num(pe['ties']), hidden_competitor: num(pe['hidden_competitor']),
    },
    trend: rows(r['trend']).map(d => ({
      date: str(d['date']), lists: num(d['lists']), efes_top1_shown: num(d['efes_top1_shown']), efes_top1_honest: num(d['efes_top1_honest']), orders: num(d['orders']),
    })).filter(d => d.date),
    skus: rows(r['skus']).map(s => ({
      drink_id: str(s['drink_id']), name: str(s['name']) || str(s['drink_id']), impressions: num(s['impressions']), top1: num(s['top1']),
      top1_honest: num(s['top1_honest']), opens: num(s['opens']), orders: num(s['orders']), order_kzt: num(s['order_kzt']),
      avg_score: numN(s['avg_score']), review_mean: numN(s['review_mean']), review_n: num(s['review_n']),
    })).filter(s => s.drink_id),
    competitors: rows(r['competitors']).map(c => ({ category: str(c['category']), label: str(c['label']) || str(c['category']), top1: num(c['top1']), share: share(c['share']) })),
    dishes: rows(r['dishes']).map(d => {
      const tc = obj(d['top_competitor']);
      return {
        dish_id: str(d['dish_id']), name: str(d['name']) || str(d['dish_id']), lists: num(d['lists']), efes_top1_share: share(d['efes_top1_share']),
        efes_top1_share_honest: typeof d['efes_top1_share_honest'] === 'number' ? share(d['efes_top1_share_honest']) : null,
        top_competitor: str(tc['drink_id']) ? { drink_id: str(tc['drink_id']), name: str(tc['name']) || str(tc['drink_id']), category: str(tc['category']) } : null,
      };
    }).filter(d => d.dish_id),
    venues: rows(r['venues']).map(v => ({
      slug: str(v['slug']), name: str(v['name']) || str(v['slug']), city: str(v['city']), lists: num(v['lists']),
      efes_top1_share: share(v['efes_top1_share']), orders: num(v['orders']), order_kzt: num(v['order_kzt']),
      efes_top1_share_honest: typeof v['efes_top1_share_honest'] === 'number' ? share(v['efes_top1_share_honest']) : null,
      contested_lists: typeof v['contested_lists'] === 'number' ? num(v['contested_lists']) : null,
      contested_top1_share_honest: typeof v['contested_top1_share_honest'] === 'number' ? share(v['contested_top1_share_honest']) : null,
      is_demo_venue: v['is_demo_venue'] === true,
    })),
    actions: { open_drink: num(a['open_drink']), expand_why: num(a['expand_why']), order_intent: num(a['order_intent']), review: num(a['review']) },
    reviews: { efes_mean: numN(rv['efes_mean']), efes_n: num(rv['efes_n']), others_mean: numN(rv['others_mean']), others_n: num(rv['others_n']) },
    notes: Array.isArray(r['notes']) ? (r['notes'] as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()) : [],
    contested: r['contested'] && typeof r['contested'] === 'object' ? {
      lists: num(obj(r['contested'])['lists']), top1_share_shown: share(obj(r['contested'])['top1_share_shown']),
      top1_share_honest: share(obj(r['contested'])['top1_share_honest']),
      top3_share: typeof obj(r['contested'])['top3_share'] === 'number' ? share(obj(r['contested'])['top3_share']) : null,
      impression_share: typeof obj(r['contested'])['impression_share'] === 'number' ? share(obj(r['contested'])['impression_share']) : null,
    } : null,
    by_source: Object.entries(obj(r['by_source'])).map(([source, v]) => ({
      source, lists: num(obj(v)['lists']), top1_share_shown: share(obj(v)['top1_share_shown']), top1_share_honest: share(obj(v)['top1_share_honest']),
    })).filter(x => x.lists > 0).sort((a, b) => b.lists - a.lists),
  };
}

// ─────────────────────────────── форматирование (ru-RU) ───────────────────────────────
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfW = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const CAT = ru as unknown as Record<string, string | undefined>;
const TOKEN_KEY = 'ft.brand.token';
const SOURCE_LABEL: Record<string, string> = { pair: 'Подбор на сайте', venue_menu: 'Меню заведения (QR)', ai: 'ИИ-сомелье' };

function readToken(): string { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } }
function writeToken(v: string): void { try { if (v) sessionStorage.setItem(TOKEN_KEY, v); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* приватный режим */ } }

/** Шаг оси: 1 · 2 · 5 × 10ⁿ, целый (это счётчики). */
function niceTicks(max: number, count = 4): number[] {
  const raw = Math.max(1, max) / count;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const step = Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p);
  const top = Math.max(step, Math.ceil(Math.max(1, max) / step) * step);
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v));
  return out;
}
/** Столбик: скругление 4 px сверху, квадратный у базовой линии. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

type SkuKey = 'impressions' | 'top1' | 'top1_honest' | 'opens' | 'orders' | 'order_kzt' | 'avg_score' | 'review_mean';
type View = 'api' | 'file';

const PLOT_H = 190, PAD_T = 14, PAD_L = 40, PAD_R = 14, AXIS_H = 28;
/** Ширина подсказки графика: её левый край зажимаем в [0, ширина графика − TIP_W], чтобы не вылезала за карточку. */
const TIP_W = 212;
/** Первая строка notes у демо — текст плашки «Демо-данные»; страница показывает плашку сама. */
const DEMO_NOTE_PREFIX = 'Демо-данные:';

/**
 * Подсказка «таблицу можно листать»: у обёртки .tw, которая шире экрана, край со скрытыми столбцами затухает
 * (классы more-l / more-r), пока таблицу не долистали до этого края.
 */
@Directive({
  selector: '[ftScrollHint]',
  standalone: true,
  host: { '(scroll)': 'update()', '[class.more-l]': 'left()', '[class.more-r]': 'right()' },
})
export class ScrollHintDirective {
  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly left = signal(false);
  readonly right = signal(false);
  constructor() {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => this.update());
    ro.observe(this.el);
    const inner = this.el.firstElementChild; if (inner) ro.observe(inner);
    inject(DestroyRef).onDestroy(() => ro.disconnect());
  }
  update(): void {
    const { scrollLeft, scrollWidth, clientWidth } = this.el;
    this.left.set(scrollLeft > 2);
    this.right.set(scrollLeft + clientWidth < scrollWidth - 2);
  }
}

/**
 * «Efes · аналитика портфеля» — отчёт для спонсора: как напитки Efes проявляют себя в реальных подборах.
 * Данные: GET /api/brand/overview/ (токен FT_BRAND_TOKEN → Authorization: Bearer; хранится в sessionStorage этой вкладки).
 * Без сервера (API_URL пуст, Vercel) — встроенная выгрузка data/brand_demo_overview.json, всегда с плашкой «Демо-данные».
 * Честность: доля Efes на 1-м месте показана и «как показано» (с политикой окна ±2 балла), и «по честному баллу»,
 * плюс отдельный блок — сколько раз окно подняло Efes на первое место. Интерфейс только на русском, как кабинет.
 */
@Component({
  selector: 'ft-brand',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, ScrollHintDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bp">
      <header class="hd">
        <span class="eyebrow">Efes Kazakhstan · OneIdea 2026</span>
        <h1 class="h1">Efes · аналитика портфеля @if (isDemo()) { <span class="badge demo-badge">Демо</span> }</h1>
        <p class="lede">Как напитки Efes выступают в подборах Flavor Tree: где побеждают честным баллом, где их поднимает окно ±{{ winText() }}, кому уходят блюда и что заказывают гости.</p>
      </header>

      @if (needLogin()) {
        <section class="card card-p login" aria-labelledby="bl-title">
          <span class="eyebrow plain">Для команды Efes</span>
          <h2 id="bl-title" class="h2">Вход по токену</h2>
          <p class="dim sm mt8">Отчёт закрыт: только агрегаты, без данных гостей. Токен выдаёт администратор Flavor Tree.</p>
          <form class="lf mt16" (ngSubmit)="login()">
            <label for="bl-token" class="lbl">Токен доступа</label>
            <input id="bl-token" class="input" type="password" name="token" autocomplete="off" spellcheck="false"
                   [ngModel]="draft()" (ngModelChange)="draft.set($event)" placeholder="FT_BRAND_TOKEN" required />
            <button type="submit" class="btn btn-primary" [disabled]="!draft().trim()">Открыть отчёт <ft-icon name="arrow-right" [size]="16" /></button>
          </form>
          @if (error(); as e) { <p class="err mt12" role="alert">{{ e }}</p> }
          <p class="muted xs mt12">Токен хранится только в этой вкладке и стирается при её закрытии.</p>
          <div class="divider"></div>
          <button type="button" class="linkish sm" (click)="openDemoFile()">Посмотреть встроенную демо-выгрузку без входа</button>
        </section>
      } @else {
        @if (isDemo()) {
          <aside class="demo-banner" role="note" aria-label="Демо-данные">
            <span class="db-ico"><ft-icon name="info" [size]="20" /></span>
            <div>
              <p class="db-title">Демо-данные: сгенерированы движком на тестовом потоке, не реальные гости</p>
              <p class="db-text">Списки построены настоящим движком подбора v2 по реальному каталогу напитков и блюд, но поток гостей, заказы и заведения смоделированы. Это образец отчёта, а не результаты продаж Efes.</p>
            </div>
          </aside>
        }

        <div class="filters" role="toolbar" aria-label="Фильтры отчёта">
          <div class="seg" role="group" aria-label="Период">
            @for (p of periods; track p) {
              <button type="button" [class.on]="days() === p" [attr.aria-pressed]="days() === p" [disabled]="view() === 'file' && p !== days()"
                      [attr.title]="view() === 'file' && p !== days() ? 'В демо-выгрузке только ' + days() + ' дн.' : null" (click)="days.set(p)">{{ p }} дн</button>
            }
          </div>
          @if (view() === 'api' && (data()?.has_demo_data || demo())) {
            <button type="button" class="chip chip-sm" [class.on]="demo()" [attr.aria-pressed]="demo()" (click)="demo.set(!demo())">
              <ft-icon [name]="demo() ? 'check' : 'sparkles'" [size]="14" /> Демо-поток
            </button>
          }
          <span class="src muted xs" aria-live="polite">{{ sourceLine() }}</span>
          @if (view() === 'api') {
            <button type="button" class="btn btn-ghost btn-sm" (click)="logout()">Выйти</button>
          } @else if (hasApi) {
            <button type="button" class="btn btn-ghost btn-sm" (click)="view.set('api')">Ко входу</button>
          }
        </div>

        @if (error() && !data()) {
          <div class="card card-p err-card" role="alert"><p>{{ error() }}</p><button type="button" class="btn btn-secondary btn-sm mt12" (click)="reload()">Повторить</button></div>
        } @else if (!data()) {
          <div class="kpis" aria-busy="true"><div class="skeleton sk-t hero"></div><div class="skeleton sk-t"></div><div class="skeleton sk-t"></div><div class="skeleton sk-t"></div><div class="skeleton sk-t"></div></div>
          <div class="skeleton sk-c"></div>
        } @else { @if (data(); as d) {
          <div class="body" [class.stale]="loading()" [attr.aria-busy]="loading()">
            @if (error(); as e) { <p class="err" role="alert">{{ e }}</p> }

            @if (!d.totals.lists) {
              <section class="card card-p empty">
                <h2 class="h2">Показов за период пока нет</h2>
                @if (view() === 'file') {
                  <p class="dim mt8">Встроенная демо-выгрузка ещё не сгенерирована — в файле нули, и мы не подставляем выдуманные цифры.</p>
                  <p class="muted sm mt8">Выгрузку создаёт сервер: <code>python manage.py seed_brand_demo --days 30 --lists 1500 --export data/brand_demo_overview.json</code></p>
                } @else {
                  <p class="dim mt8">Когда гости откроют подбор к блюду или меню заведения, здесь появятся показы, места Efes и заказы. {{ d.has_demo_data && !demo() ? 'Чтобы посмотреть, как выглядит отчёт, включите «Демо-поток».' : '' }}</p>
                }
              </section>
            } @else {
              <!-- ═══════ KPI ═══════ -->
              <section class="kpis" aria-label="Ключевые показатели">
                @if (hero(); as h) {
                <article class="tile hero gilded card">
                  <h2 class="tl">Efes на 1-м месте в списке</h2>
                  <p class="scope">{{ h.scope }}</p>
                  <div class="duo">
                    <div>
                      <div class="tk"><i class="key k-shown" aria-hidden="true"></i>как показано гостю</div>
                      <div class="tv">{{ pct(h.shown) }}</div>
                    </div>
                    <div>
                      <div class="tk"><i class="key k-honest" aria-hidden="true"></i>по честному баллу</div>
                      <div class="tv">{{ pct(h.honest) }}</div>
                    </div>
                  </div>
                  <div class="hm" role="img" [attr.aria-label]="h.scope + ': Efes первым по честному баллу — ' + pct(h.honest) + ', ещё ' + pct(h.shown - h.honest) + ' добавило окно, итого как показано — ' + pct(h.shown)">
                    <div class="hm-track">
                      <span class="hm-h" [style.width.%]="h.honest * 100"></span>
                      @if (h.shown > h.honest) { <span class="hm-p" [style.width.%]="(h.shown - h.honest) * 100"></span> }
                    </div>
                    <div class="hm-leg" aria-hidden="true">
                      <span><i class="sq k-honest"></i>честный балл</span>
                      <span><i class="sq k-shown"></i>+ окно ±{{ win() }}</span>
                      <span class="hm-all">шкала — 100 % {{ h.contested ? 'списков с конкурентом' : 'списков' }}</span>
                    </div>
                  </div>
                  @if (h.contested) {
                    <p class="ts">По всем {{ int(d.totals.lists) }} {{ word(d.totals.lists, 'списку', 'спискам', 'спискам') }}, включая {{ int(h.closed) }} без конкурентов: {{ pct(d.efes.top1_share_shown) }} как показано · {{ pct(d.efes.top1_share_honest) }} по честному баллу.</p>
                  } @else if (h.closed) {
                    <p class="ts">Ни в одном списке периода конкурентов не было (ни в списке, ни среди кандидатов): первое место — не результат сравнения.</p>
                  }
                  <p class="ts">{{ gapLine() }}</p>
                </article>
                }
                <article class="tile card">
                  <h2 class="tl">Efes в топ-3</h2>
                  <div class="tv">{{ pct(d.efes.top3_share) }}</div>
                  <p class="ts">списков, где Efes в первой тройке (как показано)@if (closedLists() && d.contested?.top3_share !== null && d.contested?.top3_share !== undefined) {; в списках с конкурентом — <b>{{ pct(d.contested!.top3_share!) }}</b>}</p>
                </article>
                <article class="tile card">
                  <h2 class="tl">Доля Efes в показах</h2>
                  <div class="tv">{{ pct(d.efes.impression_share) }}</div>
                  <p class="ts">из {{ int(d.totals.impressions) }} показов напитков в списках@if (closedLists() && d.contested?.impression_share !== null && d.contested?.impression_share !== undefined) {; в списках с конкурентом — <b>{{ pct(d.contested!.impression_share!) }}</b>}</p>
                </article>
                <article class="tile card">
                  <h2 class="tl">Показано списков</h2>
                  <div class="tv">{{ int(d.totals.lists) }}</div>
                  <p class="ts">{{ int(d.totals.sessions) }} {{ word(d.totals.sessions, 'сессия', 'сессии', 'сессий') }} · {{ int(d.totals.dishes) }} {{ word(d.totals.dishes, 'блюдо', 'блюда', 'блюд') }} · {{ int(d.totals.venues) }} {{ word(d.totals.venues, 'заведение', 'заведения', 'заведений') }}</p>
                </article>
                <article class="tile card">
                  <h2 class="tl">Заказы Efes через подбор</h2>
                  <div class="tv">{{ int(orders().efes) }}</div>
                  <p class="ts">на {{ kzt(orders().kzt) }} по ценам карты заведения · «Заказать» — намерение, не чек@if (orders().all > orders().efes) { · по всем напиткам — {{ int(orders().all) }} }</p>
                </article>
              </section>

              <!-- ═══════ ЭФФЕКТ ПОЛИТИКИ + ОТЗЫВЫ ═══════ -->
              <div class="two">
                <section class="card card-p gilded policy" aria-labelledby="pe-title">
                  <div class="sh"><h2 id="pe-title" class="h2">Эффект политики окна</h2>@if (isDemo()) { <span class="demo-tag">Демо-данные</span> }</div>
                  <p class="dim sm mt8">Баллы движок никогда не меняет. Если напиток Efes отстаёт от лидера не больше чем на {{ winText() }}, он ставится выше. На странице подбора гость видит на карточке отметку «поднят политикой», когда более сильный напиток стоит ниже в том же списке; в меню заведения по QR и когда окно вытеснило конкурента из короткого списка, отметки нет. Здесь — как часто окно решало, кто окажется первым.</p>
                  <p class="pe-big"><b>{{ int(d.policy_effect.lists_where_efes_promoted_to_top1) }}</b> {{ word(d.policy_effect.lists_where_efes_promoted_to_top1, 'список', 'списка', 'списков') }} <span class="muted">· {{ pct(d.policy_effect.share) }} всех</span></p>
                  <p class="sm">Efes стоял первым только благодаря окну: по честному баллу первым был бы другой напиток или была бы ничья с ним@if (d.policy_effect.ties) { (ничьих — {{ int(d.policy_effect.ties) }})}.@if (d.policy_effect.hidden_competitor) { В {{ int(d.policy_effect.hidden_competitor) }} {{ word(d.policy_effect.hidden_competitor, 'списке', 'списках', 'списках') }} этот конкурент в показанный гостю список не попал — сравнение шло со всеми кандидатами, а не только с видимыми.}</p>

                  <div class="db" role="img" [attr.aria-label]="'Доля списков с Efes на первом месте: по честному баллу ' + pct(d.efes.top1_share_honest) + ', как показано ' + pct(d.efes.top1_share_shown)">
                    <div [class]="'db-lbl up ' + align(d.efes.top1_share_shown)" [style.left.%]="d.efes.top1_share_shown * 100"><i class="key k-shown"></i>как показано · <b>{{ pct(d.efes.top1_share_shown) }}</b></div>
                    <div class="db-track">
                      @for (t of [0, 25, 50, 75, 100]; track t) { <span class="db-tick" [style.left.%]="t"></span> }
                      <span class="db-seg" [style.left.%]="d.efes.top1_share_honest * 100" [style.width.%]="(d.efes.top1_share_shown - d.efes.top1_share_honest) * 100"></span>
                      <span class="db-dot honest" [style.left.%]="d.efes.top1_share_honest * 100"></span>
                      <span class="db-dot shown" [style.left.%]="d.efes.top1_share_shown * 100"></span>
                    </div>
                    <div [class]="'db-lbl down ' + align(d.efes.top1_share_honest)" [style.left.%]="d.efes.top1_share_honest * 100"><i class="key k-honest"></i>по честному баллу · <b>{{ pct(d.efes.top1_share_honest) }}</b></div>
                    <div class="db-axis" aria-hidden="true"><span style="left:0">0 %</span><span style="left:50%">50 %</span><span style="left:100%">100 %</span></div>
                  </div>

                  @if (d.efes.avg_score_efes_top !== null && d.efes.avg_score_best !== null) {
                    <p class="sm mt12">В списках, где есть Efes, лучший Efes набирает в среднем <b>{{ one(d.efes.avg_score_efes_top) }}</b> из 99, лидер тех же списков (с учётом кандидатов, не попавших в список) — <b>{{ one(d.efes.avg_score_best) }}</b>{{ scoreGap(d.efes.avg_score_gap ?? d.efes.avg_score_best - d.efes.avg_score_efes_top) }}</p>
                  }
                  @if (d.contested; as c) {
                    @if (closedLists() > 0) {
                      <div class="closed mt16">
                        <p class="sm"><b>{{ int(closedLists()) }}</b> {{ word(closedLists(), 'список', 'списка', 'списков') }} ({{ pct(closedLists() / d.totals.lists) }}) — без конкурентов: ни в списке, ни среди кандидатов, из которых он собран, не было напитков не из портфеля Efes (обычно карта заведения только из Efes). Там первое место не результат сравнения.</p>
                        <p class="sm mt8">В {{ int(c.lists) }} {{ word(c.lists, 'списке', 'списках', 'списках') }} с конкурентами Efes первый в <b>{{ pct(c.top1_share_shown) }}</b> как показано и в <b>{{ pct(c.top1_share_honest) }}</b> по честному баллу.</p>
                      </div>
                    }
                  }
                  @if (d.policy_effect.note) { <p class="muted xs mt12">{{ d.policy_effect.note }}</p> }
                </section>

                <div class="stack">
                @if (d.by_source.length) {
                  <section class="card card-p" aria-labelledby="src-title">
                    <div class="sh"><h2 id="src-title" class="h2">Откуда списки</h2>@if (isDemo()) { <span class="demo-tag">Демо-данные</span> }</div>
                    <div class="tw mt12" ftScrollHint>
                      <table class="tbl">
                        <caption class="sr-only">Списки по источнику и доля Efes на первом месте: как показано и по честному баллу</caption>
                        <thead><tr><th scope="col">Источник</th><th scope="col" class="r">Списков</th><th scope="col" class="r"><i class="key k-shown"></i>№1 показано</th><th scope="col" class="r"><i class="key k-honest"></i>№1 честно</th></tr></thead>
                        <tbody>
                          @for (b of d.by_source; track b.source) {
                            <tr><th scope="row">{{ sourceLabel(b.source) }}</th><td class="r">{{ int(b.lists) }}</td><td class="r">{{ pct(b.top1_share_shown) }}</td><td class="r">{{ pct(b.top1_share_honest) }}</td></tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  </section>
                }
                <section class="card card-p" aria-labelledby="ac-title">
                  <div class="sh"><h2 id="ac-title" class="h2">Что делают гости со списком</h2>@if (isDemo()) { <span class="demo-tag">Демо-данные</span> }</div>
                  <div class="acts mt12">
                    @for (a of actionRows(); track a.label) {
                      <div class="act" [class.off]="a.off"><span class="av">{{ a.off && !a.n ? '—' : int(a.n) }}</span><span class="al">{{ a.label }}</span><span class="ar">{{ a.off ? 'пока не собирается: приложение это действие ещё не отправляет' : a.rate + ' на 100 списков' }}</span></div>
                    }
                  </div>
                  <p class="muted xs mt12">По всем напиткам, не только Efes. «Заказать» — намерение гостя, а не оплаченный чек.</p>
                </section>
                <section class="card card-p" aria-labelledby="rv-title">
                  <div class="sh"><h2 id="rv-title" class="h2">Оценки гостей</h2></div>
                  <p class="dim sm mt8">Средняя опубликованных оценок пар «блюдо × напиток», шкала 1–5 ★.</p>
                  <div class="rvp mt16">
                    @for (r of reviewRows(); track r.label) {
                      <div class="rv-row">
                        <span class="rv-l"><i class="key" [class.k-shown]="r.efes" [class.k-other]="!r.efes"></i>{{ r.label }}</span>
                        <div class="rv-track" role="img" [attr.aria-label]="r.label + ': ' + (r.mean === null ? 'нет оценок' : one(r.mean) + ' из 5, ' + word(r.n, 'оценка', 'оценки', 'оценок'))">
                          @for (t of [1, 2, 3, 4, 5]; track t) { <span class="rv-tick" [style.left.%]="(t - 1) * 25"><em>{{ t }}</em></span> }
                          @if (r.mean !== null) { <span class="rv-dot" [class.efes]="r.efes" [style.left.%]="(r.mean - 1) / 4 * 100"></span> }
                        </div>
                        <span class="rv-v"><span class="rv-m">@if (r.mean !== null) { <b>{{ one(r.mean) }}</b> ★ } @else { — }</span><small>{{ int(r.n) }} {{ word(r.n, 'оценка', 'оценки', 'оценок') }}</small></span>
                      </div>
                    }
                  </div>
                  @if (!d.reviews.efes_n && !d.reviews.others_n) {
                    <p class="muted xs mt12">{{ isDemo() ? 'Отзывы в демо не генерируются: этот блок показывает только настоящие опубликованные оценки, поэтому здесь пусто.' + (d.actions.review ? ' Счётчик «Оставили отзыв» выше — смоделированные нажатия, а не оценки.' : '') : 'Опубликованных оценок за период пока нет.' }}</p>
                  } @else if (d.reviews.efes_n + d.reviews.others_n < 30) {
                    <p class="muted xs mt12">Оценок меньше 30 — средние пока ненадёжны.</p>
                  }
                </section>
                </div>
              </div>

              <!-- ═══════ ДИНАМИКА ═══════ -->
              <section class="card card-p" aria-labelledby="tr-title">
                <div class="sh"><h2 id="tr-title" class="h2">По дням</h2>@if (isDemo()) { <span class="demo-tag">Демо-данные</span> }</div>
                <p class="dim sm mt8">Сколько списков увидели гости и в скольких первым стоял Efes — как показано и по честному баллу (все списки, включая без конкурентов). Заштрихованный промежуток между линиями — работа окна ±{{ win() }}.</p>
                <ul class="legend mt12" aria-label="Легенда">
                  <li><i class="sw sw-ctx"></i>списков показано</li>
                  <li><i class="ln k-shown"></i>Efes №1 — как показано</li>
                  <li><i class="ln k-honest"></i>Efes №1 — по честному баллу</li>
                  <li><i class="sw sw-band"></i>штриховка — эффект окна</li>
                </ul>
                <div #tbox class="chart mt8" tabindex="0" role="group" [attr.aria-label]="trendAria()" aria-describedby="tr-live"
                     (keydown)="trendKey($event)" (blur)="hi.set(null)">
                  @if (geo(); as g) {
                    <svg [attr.width]="g.w" [attr.height]="g.h" [attr.viewBox]="'0 0 ' + g.w + ' ' + g.h" aria-hidden="true">
                      <defs>
                        <pattern id="ft-brand-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <rect width="6" height="6" class="hatch-bg" /><line x1="0" y1="0" x2="0" y2="6" class="hatch-ln" />
                        </pattern>
                      </defs>
                      @for (t of g.yTicks; track t.v) {
                        <line [attr.x1]="padL" [attr.x2]="g.w - padR" [attr.y1]="t.y" [attr.y2]="t.y" [class]="t.v === 0 ? 'base' : 'grid'" />
                        <text [attr.x]="padL - 8" [attr.y]="t.y + 4" class="ytick">{{ int(t.v) }}</text>
                      }
                      @for (b of g.bars; track b.i) { <path [attr.d]="b.d" class="col" [class.on]="hi() === b.i" /> }
                      @if (hi() !== null) { <line [attr.x1]="g.cx[hi()!]" [attr.x2]="g.cx[hi()!]" [attr.y1]="padT" [attr.y2]="padT + plotH" class="cross" /> }
                      <path [attr.d]="g.band" class="band" fill="url(#ft-brand-hatch)" />
                      <path [attr.d]="g.honest" class="line honest" />
                      <path [attr.d]="g.shown" class="line shown" />
                      @if (hi() !== null) {
                        <circle [attr.cx]="g.cx[hi()!]" [attr.cy]="g.yHonest[hi()!]" r="4" class="dot honest" />
                        <circle [attr.cx]="g.cx[hi()!]" [attr.cy]="g.yShown[hi()!]" r="4" class="dot shown" />
                      } @else {
                        <circle [attr.cx]="g.cx[g.n - 1]" [attr.cy]="g.yHonest[g.n - 1]" r="4" class="dot honest" />
                        <circle [attr.cx]="g.cx[g.n - 1]" [attr.cy]="g.yShown[g.n - 1]" r="4" class="dot shown" />
                      }
                      @for (x of g.xLabels; track x.i) { <text [attr.x]="x.x" [attr.y]="padT + plotH + 18" class="xtick" [attr.text-anchor]="x.anchor">{{ x.label }}</text> }
                      <rect [attr.x]="padL" [attr.y]="padT" [attr.width]="g.w - padL - padR" [attr.height]="plotH" fill="transparent" class="hit"
                            (pointermove)="trendPointer($event, g)" (pointerdown)="trendPointer($event, g)" (pointerleave)="trendLeave($event)" />
                    </svg>
                    @if (tip(); as tp) {
                      <div class="tip" [style.left.px]="tp.left" [style.top.px]="padT" [style.width.px]="tipW">
                        <div class="tip-d">{{ tp.date }}</div>
                        <div class="tip-r"><i class="ln sw-ctx"></i><b>{{ int(tp.day.lists) }}</b><span>списков</span></div>
                        <div class="tip-r"><i class="ln k-shown"></i><b>{{ int(tp.day.efes_top1_shown) }}</b><span>Efes №1 как показано</span></div>
                        <div class="tip-r"><i class="ln k-honest"></i><b>{{ int(tp.day.efes_top1_honest) }}</b><span>Efes №1 по честному баллу</span></div>
                        <div class="tip-r"><i class="ln"></i><b>{{ int(tp.day.orders) }}</b><span>заказов Efes</span></div>
                      </div>
                    }
                  }
                </div>
                <p id="tr-live" class="sr-only" aria-live="polite">{{ tipText() }}</p>
                <details class="tv-details mt12">
                  <summary>Таблица по дням</summary>
                  <div class="tw" ftScrollHint>
                    <table class="tbl">
                      <caption class="sr-only">Показы и места Efes по дням</caption>
                      <thead><tr><th scope="col">Дата</th><th scope="col" class="r">Списков</th><th scope="col" class="r">Efes №1 как показано</th><th scope="col" class="r">Efes №1 по честному баллу</th><th scope="col" class="r">Заказов Efes</th></tr></thead>
                      <tbody>
                        @for (t of d.trend; track t.date) {
                          <tr><th scope="row">{{ shortDate(t.date) }}</th><td class="r">{{ int(t.lists) }}</td><td class="r">{{ int(t.efes_top1_shown) }}</td><td class="r">{{ int(t.efes_top1_honest) }}</td><td class="r">{{ int(t.orders) }}</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>

              <!-- ═══════ SKU ═══════ -->
              <section class="card card-p" aria-labelledby="sku-title">
                <div class="sh"><h2 id="sku-title" class="h2">Портфель по SKU</h2>@if (isDemo()) { <span class="demo-tag">Демо-данные</span> }</div>
                <p class="dim sm mt8">Первые места (как показано и по честному баллу), показы в списках, переходы в карточку, заказы и оценки гостей. «№1 честно» — балл строго выше любого конкурента, в том числе не попавшего в список; ничья с конкурентом не в зачёт, ничья двух Efes — тому, кто стоял выше, поэтому столбец складывается в общую честную долю. Нажмите на заголовок столбца, чтобы отсортировать.</p>
                @if (d.skus.length) {
                  <div class="tw mt12" ftScrollHint>
                    <table class="tbl sku">
                      <caption class="sr-only">Напитки Efes: показы, первые места, заказы и оценки</caption>
                      <thead>
                        <tr>
                          <th scope="col" class="stick">Напиток</th>
                          @for (c of skuCols; track c.key) {
                            <th scope="col" class="r" [attr.aria-sort]="skuSort() === c.key ? 'descending' : null">
                              <button type="button" class="sort" [class.on]="skuSort() === c.key" (click)="skuSort.set(c.key)" [attr.title]="c.title">{{ c.label }}@if (skuSort() === c.key) { <ft-icon name="chevron-down" [size]="12" /> }</button>
                            </th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (s of skuRows(); track s.drink_id) {
                          <tr>
                            <th scope="row" class="stick"><a [routerLink]="['/drinks', s.drink_id]" class="dl">{{ s.name }}</a></th>
                            <td class="r">{{ int(s.top1) }}</td>
                            <td class="r">{{ int(s.top1_honest) }}</td>
                            <td class="r bc"><span class="ib" aria-hidden="true"><i [style.width.%]="s.impressions / skuMax() * 100"></i></span>{{ int(s.impressions) }}</td>
                            <td class="r">{{ int(s.opens) }}</td>
                            <td class="r">{{ int(s.orders) }}</td>
                            <td class="r nw">{{ s.order_kzt ? int(s.order_kzt) + ' ₸' : '—' }}</td>
                            <td class="r">{{ s.avg_score !== null ? one(s.avg_score) : '—' }}</td>
                            <td class="r nw">@if (s.review_mean !== null) { {{ one(s.review_mean) }} ★ <small class="muted">({{ s.review_n }})</small> } @else { — }</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  @if (skuHidden() > 0 || skuAll()) {
                    <div class="flex ac g8 wrap mt8">
                      <button type="button" class="btn btn-ghost btn-sm" (click)="skuAll.set(!skuAll())">{{ skuAll() ? 'Свернуть' : 'Показать все ' + d.skus.length + ' SKU' }}</button>
                      @if (!skuAll() && skuUnseen() > 0) { <span class="muted xs">{{ skuUnseen() }} SKU портфеля не попадали в списки за период</span> }
                    </div>
                  }
                } @else { <p class="muted sm mt12">Напитки Efes ещё не появлялись в списках за период.</p> }
              </section>

              <!-- ═══════ КОНКУРЕНТЫ + БЛЮДА ═══════ -->
              <div class="two">
                <section class="card card-p" aria-labelledby="cp-title">
                  <div class="sh"><h2 id="cp-title" class="h2">Кому уходят блюда</h2>@if (isDemo()) { <span class="demo-tag">Демо-данные</span> }</div>
                  <p class="dim sm mt8">Когда первым в списке стоит не Efes — напиток какой категории. Доля — от всех показанных списков.</p>
                  @if (competitors().length) {
                    <table class="tbl bars mt12">
                      <caption class="sr-only">Категории напитков, занявших первое место вместо Efes</caption>
                      <thead class="sr-only"><tr><th scope="col">Категория</th><th scope="col">Доля</th><th scope="col">Списков</th></tr></thead>
                      <tbody>
                        @for (c of competitors(); track c.category) {
                          <tr class="brow">
                            <th scope="row" class="bl">{{ c.label }}</th>
                            <td class="bt"><div class="bt-in"><span class="track"><i [class.efes]="c.category === 'efes'" [style.width.%]="c.share / compMax() * 100"></i></span><span class="bv">{{ pct(c.share) }}</span></div></td>
                            <td class="r muted nw">{{ int(c.top1) }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  } @else { <p class="muted sm mt12">Во всех списках первым был Efes — или списков пока нет.</p> }
                </section>

                <section class="card card-p" aria-labelledby="wd-title">
                  <div class="sh"><h2 id="wd-title" class="h2">Где Efes редко побеждает</h2>@if (isDemo()) { <span class="demo-tag">Демо-данные</span> }</div>
                  <p class="dim sm mt8">Блюда, к которым Efes реже всего стоит первым (от {{ minDishLists }} списков). Полоса — доля «как показано». Точки роста портфеля.</p>
                  @if (weakDishes().length) {
                    <ul class="wd mt12">
                      @for (w of weakDishes(); track w.dish_id) {
                        <li>
                          <div class="wd-h"><a [routerLink]="['/pair', w.dish_id]" class="dl">{{ w.name }}</a><span class="muted xs nw">{{ int(w.lists) }} {{ word(w.lists, 'список', 'списка', 'списков') }}</span></div>
                          <div class="meter" role="img" [attr.aria-label]="'Efes первым в ' + pct(w.efes_top1_share) + ' списков' + (w.efes_top1_share_honest !== null ? ', по честному баллу — ' + pct(w.efes_top1_share_honest) : '')"><span class="mt"><i [style.width.%]="w.efes_top1_share * 100"></i></span><span class="mv">{{ pct(w.efes_top1_share) }}</span></div>
                          <div class="xs muted">
                            @if (w.efes_top1_share_honest !== null) { Efes первый по честному баллу — {{ pct(w.efes_top1_share_honest) }} · }
                            @if (w.top_competitor; as tc) { чаще первым <a [routerLink]="['/drinks', tc.drink_id]" class="dl2">{{ tc.name }}</a> ({{ cat(tc.category) }}) }
                          </div>
                        </li>
                      }
                    </ul>
                  } @else { <p class="muted sm mt12">Недостаточно списков по блюдам.</p> }
                  <a routerLink="/insights" class="btn btn-secondary btn-sm mt16 wrapbtn">Портфельный радар: каких стилей не хватает <ft-icon name="arrow-right" [size]="16" /></a>
                </section>
              </div>

              <!-- ═══════ ЗАВЕДЕНИЯ ═══════ -->
              <section class="card card-p" aria-labelledby="vn-title">
                <div class="sh"><h2 id="vn-title" class="h2">Заведения</h2>@if (isDemo()) { <span class="demo-tag">Демо-данные</span> }</div>
                <p class="dim sm mt8">Списки из меню по QR и подбора внутри заведения. Efes №1 — доля списков, где Efes стоял первым: как показано гостю и по честному баллу. Если в карте нет конкурентов, первое место — не результат сравнения: смотрите строку «с конкурентом». Сумма заказов — по ценам карты заведения.</p>
                @if (venueRows().length) {
                  <div class="tw mt12" ftScrollHint>
                    <table class="tbl">
                      <caption class="sr-only">Заведения: списки (и сколько из них с конкурентом), доля Efes на первом месте как показано и по честному баллу, заказы</caption>
                      <thead><tr><th scope="col">Заведение</th><th scope="col" class="r">Списков</th><th scope="col" class="r">Efes №1: <span class="nw"><i class="key k-shown"></i>показано</span> / <span class="nw"><i class="key k-honest"></i>честно</span></th><th scope="col" class="r">Заказов Efes</th><th scope="col" class="r">Сумма Efes</th></tr></thead>
                      <tbody>
                        @for (v of venueRows(); track v.slug) {
                          <tr>
                            <th scope="row" class="vcell">
                              <span class="vn">{{ v.name }}</span>@if (v.is_demo_venue && !isDemo()) { <span class="demo-tag vt">демо-заведение</span> }
                              @if (v.city) { <span class="vc muted xs">{{ v.city }}</span> }
                              @if (v.contested_lists !== null && v.lists) {
                                <span class="vc muted xs">с конкурентом: {{ int(v.contested_lists) }} из {{ int(v.lists) }}@if (!v.contested_lists) { — сравнения не было } @else if (v.contested_top1_share_honest !== null) {, там №1 честно — {{ pct(v.contested_top1_share_honest) }}}</span>
                              }
                            </th>
                            <td class="r">{{ int(v.lists) }}</td>
                            <td class="r nw">
                              <span class="sv" [attr.aria-label]="'как показано ' + pct(v.efes_top1_share)"><i class="key k-shown"></i>{{ pct(v.efes_top1_share) }}</span>
                              <span class="sv" [attr.aria-label]="'по честному баллу ' + (v.efes_top1_share_honest !== null ? pct(v.efes_top1_share_honest) : 'нет данных')"><i class="key k-honest"></i>{{ v.efes_top1_share_honest !== null ? pct(v.efes_top1_share_honest) : '—' }}</span>
                            </td>
                            <td class="r">{{ int(v.orders) }}</td>
                            <td class="r nw">{{ v.order_kzt ? int(v.order_kzt) + ' ₸' : '—' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  @if (hasDemoVenues() && !isDemo()) { <p class="muted xs mt8">«Демо-заведение» — заведение из демо-набора: карта и цены выдуманы, поэтому заказы там в цифры не входят; показы списков — настоящие.</p> }
                } @else { <p class="muted sm mt12">Списков из заведений за период нет — только общий подбор на сайте.</p> }
              </section>

              <!-- ═══════ МЕТОДИКА ═══════ -->
              <section class="card card-p notes" aria-labelledby="nt-title">
                <h2 id="nt-title" class="h2">Как считаем</h2>
                <ul class="nl mt12">
                  <li><b>Как показано</b> — место в списке после политики окна ±{{ winText() }}. <b>По честному баллу</b> — только по баллу движка: балл лучшего Efes строго выше, чем у лучшего конкурента и в показанном списке, и среди всех кандидатов, из которых список собран; ничья с конкурентом в зачёт Efes не идёт.</li>
                  <li>Категорию напитка и принадлежность к Efes сервер берёт из каталога, цену «Заказать» — из карты заведения; данным из браузера не доверяет. Баллы присылает приложение гостя: сервер проверяет их диапазон, но не пересчитывает.</li>
                  <li>Только агрегаты: без имён, телефонов и e-mail. Сессия (отдельный случайный id, не тот, что у отзывов) и IP хранятся лишь как HMAC-хэши.</li>
                  @for (n of notes(); track $index) { <li>{{ n }}</li> }
                </ul>
              </section>
            }
          </div>
        } }
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      /* цвета графиков: проверены validate_palette (тёмная поверхность карточки #1C1512; светлая #FFFDF8) */
      --c-shown: #B8892A; --c-honest: #3F8CC4; --c-other: #8A7E6C;
      --c-ctx: rgba(246, 239, 226, .12); --c-ctx-on: rgba(246, 239, 226, .24);
      --c-grid: rgba(246, 239, 226, .07); --c-base: rgba(246, 239, 226, .2);
      --c-track: rgba(184, 137, 42, .16); --c-ring: #1C1512; --c-stick: var(--surface-2);
    }
    /* светлая тема: карточки золотые (#FBF1D8 → #F3E2B0), и глобальный --ink-3 (#85796A) даёт на них 3,3–3,8:1 —
       мелкий вторичный текст этой страницы темнее (#665B4C: 5,2:1 внизу карточки, 6:1 вверху) */
    :host-context([data-theme="light"]) {
      --ink-3: #665B4C;
      --c-shown: #A87A26; --c-honest: #2C6E9E; --c-other: #85796A;
      --c-ctx: rgba(120, 90, 30, .13); --c-ctx-on: rgba(120, 90, 30, .26);
      --c-grid: rgba(120, 90, 30, .09); --c-base: rgba(120, 90, 30, .28);
      --c-track: rgba(168, 122, 38, .16); --c-ring: #FFFDF8; --c-stick: #F8EDD2;
    }
    @media (prefers-color-scheme: light) {
      :host-context(html:not([data-theme])) {
        --ink-3: #665B4C;
        --c-shown: #A87A26; --c-honest: #2C6E9E; --c-other: #85796A;
        --c-ctx: rgba(120, 90, 30, .13); --c-ctx-on: rgba(120, 90, 30, .26);
        --c-grid: rgba(120, 90, 30, .09); --c-base: rgba(120, 90, 30, .28);
        --c-track: rgba(168, 122, 38, .16); --c-ring: #FFFDF8; --c-stick: #F8EDD2;
      }
    }
    .bp { display: grid; gap: 16px; }
    .bp > *, .body > *, .two > *, .stack > *, .kpis > * { min-width: 0; }
    .hd { display: grid; gap: 6px; }
    .h1 { font-size: clamp(2.1rem, 3.4vw + 1rem, 3.3rem); display: flex; align-items: center; flex-wrap: wrap; gap: 4px 14px; }
    /* --amber-800: тёмный в светлой теме и светлый в тёмной — читается в обеих (у .badge цвет --gold-soft, 1,15:1 на светлом) */
    .badge.demo-badge { font-family: var(--font-body); font-size: .72rem; color: var(--amber-800); background: rgba(229, 184, 73, .14); border-color: rgba(184, 137, 42, .6); }
    .lede { margin-top: 4px; }
    .h2 { font-size: clamp(1.45rem, 1vw + 1.1rem, 1.85rem); font-weight: 600; }
    .h3 { font-family: var(--font-display); font-size: 1.25rem; font-weight: 600; }
    .sh { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .demo-tag { font-size: .66rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--amber-800); border: 1px solid rgba(184, 137, 42, .6); border-radius: var(--r-full); padding: 2px 9px; white-space: nowrap; }
    .demo-tag.vt { display: inline-block; margin-left: 8px; letter-spacing: .06em; vertical-align: 1px; }

    /* вход */
    .login { max-width: 520px; }
    .lf { display: grid; gap: 10px; }
    .lbl { font-size: .78rem; font-weight: 700; color: var(--ink-2); }
    .linkish { color: var(--amber-700); text-decoration: underline; text-underline-offset: 3px; text-align: left; }
    .err { color: var(--warn); font-weight: 600; font-size: .9rem; }
    .err-card p { color: var(--warn); font-weight: 600; }

    /* плашка демо — заметная, первой после заголовка */
    .demo-banner { display: flex; gap: 14px; align-items: flex-start; padding: 16px 18px; border-radius: var(--r-lg);
      background: linear-gradient(135deg, rgba(229, 184, 73, .16), rgba(229, 184, 73, .06)); border: 1px solid rgba(229, 184, 73, .55);
      box-shadow: inset 4px 0 0 var(--gold); }
    .db-ico { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: var(--grad-amber); color: var(--on-gold); flex-shrink: 0; }
    .db-title { font-weight: 800; font-size: 1rem; line-height: 1.35; color: var(--ink); }
    .db-text { margin-top: 4px; font-size: .86rem; color: var(--ink-2); line-height: 1.5; }

    /* фильтры: одна строка над всем, что они меняют */
    .filters { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; }
    .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--r-full); background: var(--surface); border: 1px solid var(--line); }
    .seg button { min-height: 34px; padding: 0 14px; font-size: .8rem; font-weight: 700; border-radius: var(--r-full); color: var(--ink-2); }
    .seg button.on { background: var(--ink); color: var(--bg); }
    .seg button:disabled { opacity: .35; cursor: not-allowed; }
    .src { flex: 1 1 200px; }
    .body { display: grid; gap: 16px; transition: opacity var(--t-med); }
    .body.stale { opacity: .55; pointer-events: none; }
    .sk-t { height: 150px; } .sk-c { height: 320px; }

    /* KPI */
    .kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .kpis .hero { grid-column: 1 / -1; }
    @media (min-width: 720px) { .kpis { grid-template-columns: repeat(4, 1fr); } }
    @media (min-width: 1000px) { .kpis .hero { grid-column: 1 / span 2; grid-row: span 2; } }
    .tile.hero { align-content: space-between; gap: 14px; padding: 20px 22px; }
    .scope { font-size: .8rem; font-weight: 600; color: var(--ink-2); margin-top: -8px; }
    .hero .duo .tv { font-size: clamp(2.4rem, 2.4vw + 1.6rem, 3.3rem); }
    .hm { display: grid; gap: 8px; }
    .hm-track { display: flex; gap: 2px; height: 12px; border-radius: 0 4px 4px 0; background: var(--c-grid); overflow: hidden; }
    .hm-track span { display: block; height: 100%; min-width: 2px; }
    .hm-h { background: var(--c-honest); }
    .hm-p { background: var(--c-shown); border-radius: 0 4px 4px 0; }
    .hm-h:last-child { border-radius: 0 4px 4px 0; }
    .hm-leg { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .72rem; color: var(--ink-3); }
    .hm-leg span { display: inline-flex; align-items: center; gap: 6px; }
    .hm-all { margin-left: auto; }
    .sq { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
    .tile { padding: 16px 18px; display: grid; align-content: start; gap: 6px; min-width: 0; }
    .tl { font-family: var(--font-body); font-size: .8rem; font-weight: 600; color: var(--ink-2); letter-spacing: 0; line-height: 1.3; }
    .tv { font-family: var(--font-body); font-weight: 600; font-size: clamp(1.7rem, 1.2vw + 1.3rem, 2.15rem); line-height: 1.1; letter-spacing: -.02em; color: var(--ink); }
    .tv-sub { font-size: .55em; font-weight: 600; color: var(--ink-2); letter-spacing: 0; white-space: nowrap; }
    .ts { font-size: .78rem; color: var(--ink-3); line-height: 1.45; }
    .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .duo .tv { font-size: clamp(2rem, 2vw + 1.4rem, 2.7rem); }
    .tk { display: flex; align-items: center; gap: 7px; font-size: .74rem; font-weight: 600; color: var(--ink-3); margin-bottom: 2px; }
    .key { display: inline-block; width: 14px; height: 3px; border-radius: 2px; flex-shrink: 0; }
    .k-shown { background: var(--c-shown); } .k-honest { background: var(--c-honest); } .k-other { background: var(--c-other); }

    .two { display: grid; gap: 16px; }
    .stack { display: grid; gap: 16px; align-content: start; }
    .closed { padding: 12px 14px; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line-2); color: var(--ink-2); }
    .tbl thead .key { vertical-align: middle; margin-right: 4px; }
    @media (min-width: 1000px) { .two { grid-template-columns: 1fr 1fr; align-items: start; } }

    /* эффект политики */
    .pe-big { margin-top: 14px; font-size: 1rem; color: var(--ink-2); }
    .pe-big b { font-family: var(--font-body); font-size: 2rem; font-weight: 600; color: var(--ink); letter-spacing: -.02em; margin-right: 4px; }
    .db { position: relative; margin: 18px 4px 4px; padding: 30px 0 46px; }
    .db-track { position: relative; height: 12px; }
    .db-track::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--c-base); }
    .db-tick { position: absolute; top: 2px; bottom: 2px; width: 1px; background: var(--c-base); }
    .db-seg { position: absolute; top: 50%; height: 2px; margin-top: -1px; background: var(--c-shown); opacity: .55; }
    .db-dot { position: absolute; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; box-shadow: 0 0 0 2px var(--c-ring); }
    .db-dot.honest { background: var(--c-honest); } .db-dot.shown { background: var(--c-shown); }
    .db-lbl { position: absolute; display: flex; align-items: center; gap: 6px; font-size: .78rem; color: var(--ink-2); white-space: nowrap; transform: translateX(-50%); }
    .db-lbl.up { top: 0; } .db-lbl.down { top: 52px; }
    .db-lbl.l { transform: translateX(-8px); } .db-lbl.r { transform: translateX(calc(-100% + 8px)); }
    .db-lbl b { color: var(--ink); font-weight: 700; }
    .db-axis { position: absolute; left: 0; right: 0; bottom: 0; height: 14px; font-size: .68rem; color: var(--ink-3); font-variant-numeric: tabular-nums; }
    .db-axis span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
    .db-axis span:first-child { transform: none; } .db-axis span:last-child { transform: translateX(-100%); }

    /* отзывы */
    .rvp { display: grid; gap: 18px; }
    .rv-row { display: grid; grid-template-columns: 112px minmax(0, 1fr) 76px; gap: 14px; align-items: center; }
    .rv-m { white-space: nowrap; }
    .rv-l { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: .88rem; }
    .rv-track { position: relative; height: 26px; }
    .rv-track::before { content: ''; position: absolute; left: 0; right: 0; top: 9px; height: 1px; background: var(--c-base); }
    .rv-tick { position: absolute; top: 5px; width: 1px; height: 9px; background: var(--c-base); }
    .rv-tick em { position: absolute; top: 11px; left: 0; transform: translateX(-50%); font-style: normal; font-size: .66rem; color: var(--ink-3); }
    .rv-dot { position: absolute; top: 9px; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: var(--c-other); box-shadow: 0 0 0 2px var(--c-ring); }
    .rv-dot.efes { background: var(--c-shown); }
    .rv-v { display: grid; justify-items: end; font-size: .95rem; white-space: nowrap; }
    .rv-v b { font-weight: 700; }
    .rv-v small { font-size: .7rem; color: var(--ink-3); }
    .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .act { display: grid; gap: 2px; padding: 12px; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line-2); }
    .av { font-weight: 600; font-size: 1.35rem; letter-spacing: -.02em; }
    .al { font-size: .78rem; color: var(--ink-2); line-height: 1.3; }
    .ar { font-size: .7rem; color: var(--ink-3); }
    .act.off { border-style: dashed; background: transparent; }
    .act.off .av { color: var(--ink-3); }

    /* график по дням */
    .legend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: .78rem; color: var(--ink-2); }
    .legend li { display: inline-flex; align-items: center; gap: 8px; }
    .sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
    .sw-ctx { background: var(--c-ctx-on); }
    /* эффект окна — штриховка, а не заливка: заливка сливалась с серыми столбиками (ΔE ≈ 2) */
    .sw-band { background: repeating-linear-gradient(135deg, var(--c-shown) 0 1.6px, color-mix(in srgb, var(--c-shown) 14%, transparent) 1.6px 4.2px); box-shadow: inset 0 0 0 1px var(--c-shown); }
    .ln { display: inline-block; width: 16px; height: 2px; border-radius: 2px; }
    .ln.k-shown { background: var(--c-shown); } .ln.k-honest { background: var(--c-honest); }
    .chart { position: relative; min-height: 232px; border-radius: var(--r-sm); }
    .chart:focus-visible { outline-offset: 4px; }
    .chart svg { display: block; overflow: visible; touch-action: pan-y; }
    .grid { stroke: var(--c-grid); stroke-width: 1; shape-rendering: crispEdges; }
    .base { stroke: var(--c-base); stroke-width: 1; shape-rendering: crispEdges; }
    .ytick, .xtick { font-family: var(--font-body); font-size: 11px; fill: var(--ink-3); font-variant-numeric: tabular-nums; }
    .ytick { text-anchor: end; }
    .col { fill: var(--c-ctx); transition: fill var(--t-fast); }
    .col.on { fill: var(--c-ctx-on); }
    .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .hatch-bg { fill: var(--c-shown); opacity: .14; }
    .hatch-ln { stroke: var(--c-shown); stroke-width: 1.6; }
    .line.shown { stroke: var(--c-shown); } .line.honest { stroke: var(--c-honest); }
    .dot { stroke: var(--c-ring); stroke-width: 2; }
    .dot.shown { fill: var(--c-shown); } .dot.honest { fill: var(--c-honest); }
    .cross { stroke: var(--ink-3); stroke-width: 1; shape-rendering: crispEdges; }
    .hit { cursor: crosshair; }
    .tip { position: absolute; z-index: 2; box-sizing: border-box; padding: 10px 12px; border-radius: 12px; pointer-events: none;
      background: var(--surface-glass); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid var(--line); box-shadow: var(--shadow-2); }
    .tip-d { font-size: .72rem; color: var(--ink-3); margin-bottom: 6px; }
    .tip-d::first-letter { text-transform: uppercase; }
    .tip-r { display: grid; grid-template-columns: 16px auto 1fr; align-items: center; gap: 6px; font-size: .76rem; color: var(--ink-3); line-height: 1.6; }
    .tip-r b { color: var(--ink); font-weight: 700; font-variant-numeric: tabular-nums; min-width: 26px; text-align: right; }
    .tip-r .ln.sw-ctx { height: 8px; border-radius: 2px; }
    .tv-details summary { cursor: pointer; font-size: .82rem; font-weight: 700; color: var(--amber-700); width: max-content; }

    /* таблицы */
    .tw { overflow-x: auto; margin-inline: -18px; padding-inline: 18px; scrollbar-width: thin; }
    /* таблица шире экрана: край со скрытыми столбцами затухает (ScrollHintDirective) */
    .tw.more-r { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); }
    .tw.more-l { -webkit-mask-image: linear-gradient(to left, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(to left, #000 calc(100% - 36px), transparent); }
    .tw.more-l.more-r { -webkit-mask-image: linear-gradient(to right, transparent, #000 36px, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(to right, transparent, #000 36px, #000 calc(100% - 36px), transparent); }
    @media (min-width: 720px) { .tw { margin-inline: -24px; padding-inline: 24px; } }
    .tbl { width: 100%; border-collapse: collapse; font-size: .86rem; }
    .tbl th, .tbl td { padding: 10px 10px; border-bottom: 1px solid var(--line-2); text-align: left; vertical-align: middle; }
    .tbl thead th { font-size: .68rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); border-bottom-color: var(--line); line-height: 1.3; }
    .tbl tbody th { font-weight: 600; }
    .tbl td { font-variant-numeric: tabular-nums; color: var(--ink-2); }
    .tbl tbody tr:hover > * { background: rgba(229, 184, 73, .04); }
    .tbl .r { text-align: right; }
    .tbl .nw, .nw { white-space: nowrap; }
    .tbl tr > :first-child { padding-left: 0; }
    .tbl tr > :last-child { padding-right: 0; }
    .sku td { white-space: nowrap; }
    .stick { min-width: 150px; }
    @media (max-width: 1099px) { .stick { position: sticky; left: 0; z-index: 1; background: var(--c-stick); box-shadow: 10px 0 12px -12px rgba(0, 0, 0, .5); } }
    .sort { display: inline-flex; align-items: center; gap: 2px; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; padding: 4px 0; }
    .sort.on { color: var(--amber-700); }
    .dl { color: var(--ink); text-decoration: underline; text-decoration-color: rgba(229, 184, 73, .35); text-underline-offset: 3px; }
    .dl:hover { color: var(--amber-700); text-decoration-color: var(--gold); }
    .dl2 { color: var(--ink-2); text-decoration: underline; text-underline-offset: 2px; }
    .bc { white-space: nowrap; }
    .ib { display: inline-block; vertical-align: middle; width: 72px; height: 6px; margin-right: 10px; border-radius: 0 3px 3px 0; background: transparent; }
    .ib i { display: block; height: 100%; min-width: 2px; background: var(--c-shown); border-radius: 0 3px 3px 0; }

    .bars .brow th, .bars .brow td { border-bottom: 0; padding-block: 7px; }
    .bars .bl { width: 38%; font-weight: 600; font-size: .84rem; padding-right: 12px; }
    .bars .bt { padding-inline: 0; }
    .bt-in { display: flex; align-items: center; gap: 10px; }
    .track { flex: 1; height: 14px; }
    .track i { display: block; height: 100%; min-width: 2px; background: var(--c-other); border-radius: 0 4px 4px 0; transition: filter var(--t-fast); }
    .track i.efes { background: var(--c-shown); }
    .brow:hover .track i { filter: brightness(1.25); }
    .bv { width: 52px; text-align: right; font-weight: 700; color: var(--ink); font-size: .84rem; }
    .bars td.r { width: 44px; font-size: .78rem; }

    .wd { list-style: none; display: grid; gap: 14px; }
    .wrapbtn { white-space: normal; text-align: left; max-width: 100%; padding-block: 8px; line-height: 1.3; }
    .wd li { display: grid; gap: 4px 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line-2); }
    @media (min-width: 560px) { .wd li { grid-template-columns: minmax(0, 1fr) minmax(140px, 42%); align-items: center; } .wd li > .xs { grid-column: 1 / -1; } }
    .wd li:last-child { border-bottom: 0; padding-bottom: 0; }
    .wd-h { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-weight: 600; }
    .meter { display: flex; align-items: center; gap: 10px; }
    .mt { flex: 1; height: 6px; border-radius: 3px; background: var(--c-track); overflow: hidden; min-width: 60px; }
    .mt i { display: block; height: 100%; background: var(--c-shown); border-radius: 3px; }
    .mv { width: 52px; text-align: right; font-size: .8rem; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
    .vn { font-weight: 600; color: var(--ink); }
    .vcell { min-width: 150px; } .vc { display: block; font-weight: 500; }
    .sv { display: flex; align-items: center; justify-content: flex-end; gap: 6px; line-height: 1.6; }

    .nl { display: grid; gap: 8px; padding-left: 18px; color: var(--ink-2); font-size: .86rem; line-height: 1.55; }
    .nl li::marker { color: var(--gold); }
    code { font-size: .8rem; background: var(--bg-2); border: 1px solid var(--line); padding: 2px 6px; border-radius: 6px; word-break: break-word; }

    @media (max-width: 520px) {
      .rv-row { grid-template-columns: 104px minmax(0, 1fr) 68px; gap: 10px; }
      .sku .stick { min-width: 118px; font-size: .8rem; }
      .acts { grid-template-columns: 1fr 1fr; }
      .bars .bl { width: 42%; }
    }
  `],
})
export class BrandPage {
  readonly hasApi = !!API_URL;
  readonly periods = [7, 30, 90];
  readonly skuLimit = 12;
  readonly minDishLists = 5;
  readonly padL = PAD_L; readonly padR = PAD_R; readonly padT = PAD_T; readonly plotH = PLOT_H; readonly tipW = TIP_W;
  readonly skuCols: readonly { key: SkuKey; label: string; title: string }[] = [
    { key: 'top1', label: '№1 гостю', title: 'Первое место в списке, как его видел гость (с политикой окна)' },
    { key: 'top1_honest', label: '№1 честно', title: 'Первое место по честному баллу: балл строго выше любого конкурента — и в списке, и среди кандидатов, не попавших в него. Ничья с конкурентом не в зачёт; ничья двух Efes — тому, кто стоял выше' },
    { key: 'impressions', label: 'Показы', title: 'Сколько раз напиток был в показанном списке' },
    { key: 'opens', label: 'Открыли', title: 'Переходы в карточку напитка из списка' },
    { key: 'orders', label: 'Заказы', title: 'Нажатия «Заказать»' },
    { key: 'order_kzt', label: 'Сумма', title: 'Сумма заказов по ценам заведений, ₸' },
    { key: 'avg_score', label: 'Ср. балл', title: 'Средний балл совместимости в показанных списках, из 99' },
    { key: 'review_mean', label: 'Оценка', title: 'Средняя оценка гостей, ★ из 5 (число оценок)' },
  ];

  readonly view = signal<View>(API_URL ? 'api' : 'file');
  readonly token = signal(readToken());
  readonly draft = signal('');
  readonly days = signal(30);
  readonly demo = signal(false);
  readonly data = signal<BrandOverview | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly skuSort = signal<SkuKey>('impressions');
  readonly skuAll = signal(false);
  readonly hi = signal<number | null>(null);
  readonly tW = signal(0);
  private readonly reloadTick = signal(0);
  private seq = 0;
  /** Откат фильтров к загруженному отчёту после ошибки — эффект загрузки его пропускает (данные уже на экране). */
  private skipLoad = false;

  private readonly tbox = viewChild<ElementRef<HTMLElement>>('tbox');

  readonly needLogin = computed(() => this.view() === 'api' && !this.token());
  readonly isDemo = computed(() => !!this.data()?.demo);

  /** Подпись источника — по тому, что на экране (data), а не по запрошенному: после ошибки они могут расходиться. */
  readonly sourceLine = computed(() => {
    const d = this.data();
    const period = d?.period.from && d.period.to ? `${this.shortDate(d.period.from)} — ${this.shortDate(d.period.to)}` : '';
    if (this.view() === 'file') return ['Сервер не подключён: встроенная демо-выгрузка', period].filter(Boolean).join(' · ');
    return [(d ? d.demo : this.demo()) ? 'Сервер · только демо-поток' : 'Сервер · реальные показы', period].filter(Boolean).join(' · ');
  });

  /** Окно политики из ответа сервера (partner_tie_window), по умолчанию 2. */
  readonly win = computed(() => this.data()?.policy_effect.window ?? 2);
  readonly winText = computed(() => {
    const w = this.win();
    return `${nfW.format(w)} ${Number.isInteger(w) ? this.word(w, 'балл', 'балла', 'баллов') : 'балла'}`;
  });
  /** Списки без конкурентов (ни в списке, ни среди кандидатов): там первое место — не результат сравнения. */
  readonly closedLists = computed(() => {
    const d = this.data(); const c = d?.contested;
    return d && c ? Math.max(0, d.totals.lists - c.lists) : 0;
  });
  /** Главная плитка: где был конкурент — доли по спискам с конкурентом, общие — строкой ниже. */
  readonly hero = computed(() => {
    const d = this.data(); if (!d) return null;
    const c = d.contested; const closed = this.closedLists();
    if (c && c.lists > 0 && closed > 0) {
      return { contested: true, closed, shown: c.top1_share_shown, honest: c.top1_share_honest,
               scope: `В ${this.int(c.lists)} ${this.word(c.lists, 'списке', 'списках', 'списках')} с конкурентом из ${this.int(d.totals.lists)}` };
    }
    return { contested: false, closed, shown: d.efes.top1_share_shown, honest: d.efes.top1_share_honest,
             scope: closed ? `Во всех ${this.int(d.totals.lists)} списках — без конкурентов` : `Во всех ${this.int(d.totals.lists)} списках был конкурент` };
  });
  readonly hasDemoVenues = computed(() => (this.data()?.venues ?? []).some(v => v.is_demo_venue));
  /** Пояснения сервера без текста плашки «Демо-данные» — плашка уже на экране. */
  readonly notes = computed(() => (this.data()?.notes ?? []).filter(n => !(this.isDemo() && n.startsWith(DEMO_NOTE_PREFIX))));

  readonly orders = computed(() => {
    const d = this.data();
    if (!d) return { efes: 0, kzt: 0, all: 0 };
    return {
      efes: d.skus.reduce((s, x) => s + x.orders, 0),
      kzt: d.skus.reduce((s, x) => s + x.order_kzt, 0),
      all: d.actions.order_intent,
    };
  });

  readonly gapLine = computed(() => {
    const d = this.data(); if (!d) return '';
    const n = d.policy_effect.lists_where_efes_promoted_to_top1;
    if (n === 0) return `Окно ±${this.winText()} за период ни разу не решило, кто первый.`;
    return `Разница — ${this.int(n)} ${this.word(n, 'список', 'списка', 'списков')} (${this.pct(d.policy_effect.share)} всех), где Efes отставал от лидера не больше чем на ${this.winText()} или шёл с ним вровень и по политике окна встал первым.`;
  });

  readonly reviewRows = computed(() => {
    const r = this.data()?.reviews;
    if (!r) return [];
    return [
      { label: 'Efes', efes: true, mean: r.efes_mean, n: r.efes_n },
      { label: 'Остальные', efes: false, mean: r.others_mean, n: r.others_n },
    ];
  });

  readonly actionRows = computed(() => {
    const d = this.data(); if (!d) return [];
    const per = (n: number) => d.totals.lists ? nf1.format(n / d.totals.lists * 100) : '0';
    const a = d.actions;
    return [
      { label: 'Открыли карточку напитка', n: a.open_drink, rate: per(a.open_drink) },
      { label: 'Раскрыли «Почему такая оценка»', n: a.expand_why, rate: per(a.expand_why) },
      { label: 'Нажали «Заказать»', n: a.order_intent, rate: per(a.order_intent) },
      // приложение это действие пока не шлёт: не выдаём ноль за измерение
      { label: 'Оставили отзыв', n: a.review, rate: per(a.review), off: true },
    ].map(x => ({ off: false, ...x }));
  });

  readonly skuRows = computed(() => {
    const d = this.data(); if (!d) return [];
    const k = this.skuSort();
    const sorted = [...d.skus].sort((a, b) => (b[k] ?? -1) - (a[k] ?? -1) || b.impressions - a.impressions || a.name.localeCompare(b.name, 'ru'));
    return this.skuAll() ? sorted : sorted.filter(s => s.impressions > 0 || s.orders > 0 || s.review_n > 0).slice(0, this.skuLimit);
  });
  readonly skuUnseen = computed(() => (this.data()?.skus ?? []).filter(s => !(s.impressions > 0 || s.orders > 0 || s.review_n > 0)).length);
  readonly skuHidden = computed(() => (this.data()?.skus.length ?? 0) - (this.skuAll() ? 0 : this.skuRows().length));
  readonly skuMax = computed(() => Math.max(1, ...(this.data()?.skus ?? []).map(s => s.impressions)));

  readonly competitors = computed(() => [...(this.data()?.competitors ?? [])].filter(c => c.top1 > 0 || c.share > 0).sort((a, b) => b.share - a.share || b.top1 - a.top1));
  readonly compMax = computed(() => Math.max(0.0001, ...this.competitors().map(c => c.share)));

  readonly weakDishes = computed(() => {
    const list = this.data()?.dishes ?? [];
    const enough = list.filter(d => d.lists >= this.minDishLists);
    return [...(enough.length ? enough : list)].sort((a, b) => a.efes_top1_share - b.efes_top1_share || b.lists - a.lists).slice(0, 6);
  });
  readonly venueRows = computed(() => [...(this.data()?.venues ?? [])].sort((a, b) => b.lists - a.lists));

  /** Геометрия графика по дням — в реальных пикселях контейнера (ResizeObserver), без растяжения текста. */
  readonly geo = computed(() => {
    const d = this.data(); const w = this.tW();
    if (!d || !d.trend.length || w < 120) return null;
    const t = d.trend; const n = t.length;
    const plotW = w - PAD_L - PAD_R; const slot = plotW / n;
    const ticks = niceTicks(Math.max(...t.map(x => Math.max(x.lists, x.efes_top1_shown, x.efes_top1_honest))));
    const top = ticks[ticks.length - 1];
    const y = (v: number) => PAD_T + PLOT_H - (v / top) * PLOT_H;
    const gap = slot >= 8 ? 2 : slot >= 4 ? 1 : 0;
    const bw = Math.max(1, Math.min(24, slot - gap));
    const cx = t.map((_, i) => PAD_L + (i + .5) * slot);
    const yShown = t.map(x => y(x.efes_top1_shown));
    const yHonest = t.map(x => y(x.efes_top1_honest));
    const line = (ys: number[]) => ys.map((yy, i) => `${i ? 'L' : 'M'}${cx[i].toFixed(1)},${yy.toFixed(1)}`).join('');
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
    const xLabels = t.map((x, i) => ({ i, x: cx[i], label: this.shortDate(x.date), anchor: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }))
      .filter(l => (n - 1 - l.i) % every === 0)
      .map(l => ({ ...l, anchor: l.x - PAD_L < 22 ? 'start' : w - PAD_R - l.x < 22 ? 'end' : 'middle' }));
    return {
      n, w, h: PAD_T + PLOT_H + AXIS_H, slot, cx, yShown, yHonest,
      yTicks: ticks.map(v => ({ v, y: Math.round(y(v)) + .5 })),
      bars: t.map((x, i) => { const yy = y(x.lists); return { i, d: barPath(PAD_L + i * slot + (slot - bw) / 2, yy, bw, PAD_T + PLOT_H - yy) }; }),
      shown: line(yShown), honest: line(yHonest), xLabels,
      band: `${line(yShown)}${yHonest.map((yy, i) => i).reverse().map(i => `L${cx[i].toFixed(1)},${yHonest[i].toFixed(1)}`).join('')}Z`,
    };
  });

  /** Подсказка справа от точки, у правого края — слева; левый край зажат в [0, ширина − TIP_W] (узкий экран). */
  readonly tip = computed(() => {
    const i = this.hi(); const g = this.geo(); const d = this.data();
    if (i === null || !g || !d || !d.trend[i]) return null;
    const x = g.cx[i];
    const want = x + 12 + TIP_W <= g.w ? x + 12 : x - 12 - TIP_W;
    return { left: Math.max(0, Math.min(g.w - TIP_W, want)), day: d.trend[i], date: this.longDate(d.trend[i].date) };
  });
  readonly tipText = computed(() => {
    const tp = this.tip(); if (!tp) return '';
    return `${tp.date}: ${tp.day.lists} списков, Efes первым как показано — ${tp.day.efes_top1_shown}, по честному баллу — ${tp.day.efes_top1_honest}, заказов Efes — ${tp.day.orders}.`;
  });
  readonly trendAria = computed(() => {
    const d = this.data(); if (!d) return '';
    const s = d.trend.reduce((a, x) => ({ l: a.l + x.lists, s: a.s + x.efes_top1_shown, h: a.h + x.efes_top1_honest }), { l: 0, s: 0, h: 0 });
    return `График по дням за ${d.trend.length} дн.: ${s.l} списков, Efes первым как показано — ${s.s}, по честному баллу — ${s.h}. Стрелки влево и вправо — перейти по дням; таблица — ниже.`;
  });

  constructor() {
    // загрузка: источник × токен × период × демо; ответы устаревших запросов отбрасываем
    effect(() => {
      const view = this.view(); const token = this.token(); const days = this.days(); const demo = this.demo();
      this.reloadTick();
      if (this.skipLoad) { this.skipLoad = false; return; }
      untracked(() => { void this.load(view, token, days, demo); });
    });
    // ширина графика — по контейнеру
    effect((onCleanup) => {
      const el = this.tbox()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(entries => {
        const w = Math.floor(entries[0]?.contentRect.width ?? 0);
        if (w && w !== untracked(() => this.tW())) this.tW.set(w);
      });
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });
  }

  login(): void {
    const t = this.draft().trim(); if (!t) return;
    writeToken(t);
    this.error.set(null);
    this.draft.set('');
    this.token.set(t);
  }
  logout(): void {
    writeToken('');
    this.token.set('');
    this.data.set(null);
    this.demo.set(false);
  }
  openDemoFile(): void { this.error.set(null); this.view.set('file'); }
  reload(): void { this.reloadTick.update(n => n + 1); }

  private async load(view: View, token: string, days: number, demo: boolean): Promise<void> {
    const seq = ++this.seq;
    if (view === 'api' && !token) { this.data.set(null); return; }
    this.loading.set(true);
    this.error.set(null);
    try {
      if (view === 'file') {
        const m = await import('../../../../../data/brand_demo_overview.json');
        if (seq !== this.seq) return;
        const d = normalizeOverview((m as unknown as { default?: unknown }).default ?? m);
        if (!d) { this.error.set('Демо-выгрузка повреждена'); return; }
        d.demo = true;   // встроенный файл — всегда демо, что бы в нём ни было написано
        if (d.period.days !== this.days()) this.days.set(d.period.days);
        this.data.set(d);
        return;
      }
      const q = new URLSearchParams({ days: String(days), demo: demo ? '1' : '0' });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      let res: Response;
      try {
        res = await fetch(`${API_URL}/brand/overview/?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
      } finally { clearTimeout(timer); }
      if (seq !== this.seq) return;
      if (res.status === 401 || res.status === 403) {
        this.logout();
        this.error.set(res.status === 401 ? 'Нужен токен доступа.' : 'Токен не подошёл — проверьте его и попробуйте снова.');
        return;
      }
      if (!res.ok) { this.error.set(`Сервер не отдал отчёт (код ${res.status}). Попробуйте позже.`); this.rollback(); return; }
      const d = normalizeOverview(await res.json().catch(() => null));
      if (seq !== this.seq) return;
      if (!d) { this.error.set('Сервер прислал пустой отчёт.'); this.rollback(); return; }
      this.data.set(d);
    } catch {
      if (seq === this.seq) {
        this.error.set(view === 'file' ? 'Не удалось загрузить демо-выгрузку.' : 'Сервер недоступен. Проверьте соединение и повторите.');
        if (view === 'api') this.rollback();
      }
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  /** Запрос не удался, а на экране прежний отчёт: период и «Демо-поток» возвращаем к нему, чтобы фильтры не врали. */
  private rollback(): void {
    const d = this.data(); if (!d || this.view() !== 'api') return;
    if (this.days() === d.period.days && this.demo() === d.demo) return;
    this.skipLoad = true;
    this.days.set(d.period.days);
    this.demo.set(d.demo);
  }

  /** Касание: pointerleave приходит сразу после pointerup — день остаётся выбранным до следующего касания или ухода фокуса. */
  trendLeave(ev: PointerEvent): void { if (ev.pointerType !== 'touch') this.hi.set(null); }

  trendPointer(ev: PointerEvent, g: { n: number; slot: number }): void {
    const svg = (ev.currentTarget as SVGElement).ownerSVGElement ?? (ev.currentTarget as SVGElement);
    const x = ev.clientX - svg.getBoundingClientRect().left;
    this.hi.set(Math.max(0, Math.min(g.n - 1, Math.floor((x - PAD_L) / g.slot))));
  }
  trendKey(ev: KeyboardEvent): void {
    const n = this.data()?.trend.length ?? 0; if (!n) return;
    const cur = this.hi();
    const next = ev.key === 'ArrowRight' ? (cur === null ? n - 1 : Math.min(n - 1, cur + 1))
      : ev.key === 'ArrowLeft' ? (cur === null ? n - 1 : Math.max(0, cur - 1))
      : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : ev.key === 'Escape' ? null : undefined;
    if (next === undefined) return;
    ev.preventDefault();
    this.hi.set(next);
  }

  // ── форматирование ──
  int(n: number): string { return nf0.format(Math.round(n)); }
  one(n: number): string { return nf1.format(n); }
  pct(x: number): string { return `${nf1.format(x * 100)} %`; }
  kzt(n: number): string {
    if (n >= 1e6) return `${nf1.format(n / 1e6)} млн ₸`;
    if (n >= 1e4) return `${nf0.format(n / 1e3)} тыс. ₸`;
    return `${nf0.format(n)} ₸`;
  }
  word(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
  }
  /** gap — средний разрыв «лидер − лучший Efes» по одним и тем же спискам (≥ 0). */
  scoreGap(gap: number): string {
    return gap >= 0.05 ? `: в среднем на ${nf1.format(gap)} балла ниже лидера.` : ': в среднем вровень с лидером (разрыв меньше 0,1 балла).';
  }
  cat(c: string): string { return CAT[`v2.cat.${c}`] ?? c; }
  sourceLabel(s: string): string { return SOURCE_LABEL[s] ?? s; }
  /** Подпись точки: у краёв шкалы выравниваем внутрь, чтобы не вылезала за карточку. */
  align(x: number): string { return x < .22 ? 'l' : x > .78 ? 'r' : ''; }
  shortDate(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}.${m[2]}` : iso;
  }
  longDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
  }
}
