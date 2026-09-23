import { Injectable, inject } from '@angular/core';
import { API_URL } from './config';
import { DataV2Service } from './data-v2.service';
import { I18nService } from './i18n.service';
import { ENGINE_VERSION } from '../engine/pairing-engine-v2';

/**
 * Анонимная аналитика показов подбора v2 → POST /api/v2/track/ (контракт — V2_CONTRACT / docs бренд-аналитики).
 *
 * Что уходит: какой список увидел гость (блюдо, вкладка, заведение, до 10 напитков с местом и баллом, лучший балл
 * конкурента во всём пуле кандидатов) и что он с ним сделал (открыл карточку, раскрыл «почему», нажал «Заказать»).
 * Категорию, признак Efes, честное место и цену «Заказать» сервер берёт сам (drinks.json, карта заведения) — клиенту
 * не доверяет. Имён, телефонов, e-mail здесь нет. Сессия — СВОЙ случайный id трекинга (crypto, localStorage
 * ft.track.v1), не id гостя из отзывов и сканов (ft.saas.guest): записи трекинга и отзывы нельзя склеить даже
 * по сырому id. Сервер хранит только HMAC.
 * Действие review в типах есть, но клиент его пока не шлёт (дашборд так и пишет: «пока не собирается»).
 *
 * API_URL пуст (статическое демо на Vercel) → сервис ничего не копит и не отправляет: мы не делаем вид, что считаем.
 *
 * Отправка пачками: через 1,5 с после первого события или сразу на 20-м; при уходе со страницы (pagehide / вкладка
 * скрыта) — navigator.sendBeacon, если он есть, иначе fetch keepalive. Один и тот же список (блюдо × вкладка ×
 * напитки с баллами) повторно за 30 с не шлём: гость листает вкладки туда-обратно — это один показ.
 */
export type TrackSource = 'pair' | 'venue_menu' | 'ai';
export type TrackTab = 'best' | 'beer' | 'na' | 'cider' | 'wine' | 'cocktail' | 'spirit';
export type TrackActionKind = 'open_drink' | 'expand_why' | 'order_intent' | 'review';

export interface TrackItem { drink_id: string; rank: number; score: number; }

export interface ListShownInput {
  source: TrackSource;
  /** id блюда из dishes_v2 или 'custom' */
  dishId: string;
  tab?: string | null;
  venue?: string | null;
  table?: number | null;
  occasion?: string | null;
  /** в порядке показа гостю (после политики окна Efes); лишние сверх 10 отбрасываются */
  items: readonly TrackItem[];
  /**
   * Лучший балл не-Efes во всём пуле кандидатов этого списка (до окна и диверсификации) — см. poolBestOther().
   * null — в пуле ни одного не-Efes; undefined — не посчитан (сервер сравнит только с показанным списком).
   * Без него окно, вытеснившее равного конкурента из короткого списка, сошло бы за честную победу Efes.
   */
  poolBestOther?: number | null;
}

export interface ActionInput {
  kind: TrackActionKind;
  listId?: string | null;
  drinkId: string;
  dishId: string;
  venue?: string | null;
}

interface ListEvent {
  type: 'list'; list_id: string; source: TrackSource; dish_id: string; tab: TrackTab | null; venue: string | null;
  table: number | null; occasion: string | null; locale: string; session: string; engine: string; calibration: string | null;
  items: TrackItem[]; pool_best_other?: number | null;
}
/** Цену «Заказать» не шлём: сервер берёт её из карты заведения. */
interface ActionEvent {
  type: 'action'; kind: TrackActionKind; list_id: string | null; drink_id: string; dish_id: string; venue: string | null;
  session: string;
}
type TrackEvent = ListEvent | ActionEvent;

const ENDPOINT = `${API_URL}/v2/track/`;
const FLUSH_MS = 1500;
const MAX_BATCH = 20;
const MAX_ITEMS = 10;
const DEDUPE_MS = 30_000;
const MAX_TABLE = 100_000;         // как MAX_TABLE в views_tracking.py: стол из URL /m/:slug/999999 иначе уронил бы всю пачку в 400
const MAX_QUEUE = 200;             // сервер недоступен долго — старые события отбрасываем, память не растёт
const TABS: ReadonlySet<string> = new Set(['best', 'beer', 'na', 'cider', 'wine', 'cocktail', 'spirit']);
const SOURCES: ReadonlySet<string> = new Set(['pair', 'venue_menu', 'ai']);
const KINDS: ReadonlySet<string> = new Set(['open_drink', 'expand_why', 'order_intent', 'review']);
/** Поводы движка v2 (как OCCASIONS в backend/api/views_engine_v2.py): чужой повод уронил бы всю пачку в 400. */
const OCCASIONS: ReadonlySet<string> = new Set(['meal', 'aperitif', 'dessert', 'hot', 'evening', 'party', 'gourmet', 'non_alcoholic']);
const SESSION_RX = /^[A-Za-z0-9_-]{8,64}$/;
const LS_SESSION = 'ft.track.v1';

/** UUID v4: crypto.randomUUID есть не везде (http в локальной сети, старые Safari) — запасной путь через getRandomValues. */
export function uuid4(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID(); } catch { /* небезопасный контекст */ }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Результаты движка в порядке показа → позиции для трекинга (место с 1, балл целым). */
export function trackItems(results: readonly { drink_id: string; score: number }[]): TrackItem[] {
  return results.slice(0, MAX_ITEMS).map((r, i) => ({ drink_id: r.drink_id, rank: i + 1, score: Math.round(r.score) }));
}

/** Весь пул кандидатов (recommend с top = 0 при том же блюде, контексте, вкладке и заведении) → лучший балл не-Efes;
 *  null — в пуле ни одного не-Efes. */
export function poolBestOther(pool: readonly { score: number; efes_partner: boolean }[]): number | null {
  let best: number | null = null;
  for (const r of pool) if (!r.efes_partner && Number.isFinite(r.score)) best = Math.max(best ?? -Infinity, Math.round(r.score));
  return best;
}

@Injectable({ providedIn: 'root' })
export class TrackV2Service {
  private data = inject(DataV2Service);
  private i18n = inject(I18nService);

  /** Есть сервер — считаем. Нет — сервис молчит (демо без бэкенда). */
  readonly enabled = !!API_URL;

  private queue: TrackEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recent = new Map<string, { id: string; at: number }>();
  private sessionId: string | null = null;

  constructor() {
    if (!this.enabled || typeof window === 'undefined') return;
    window.addEventListener('pagehide', () => this.flush(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(true); });
  }

  /**
   * Гость увидел список рекомендаций. Возвращает list_id, к которому привязывать действия; повтор того же списка
   * за 30 с возвращает прежний id и ничего не отправляет. null — трекинг выключен или список пуст.
   */
  listShown(input: ListShownInput): string | null {
    if (!this.enabled || !SOURCES.has(input.source) || !input.dishId) return null;
    const items = input.items
      .filter(it => typeof it.drink_id === 'string' && it.drink_id && Number.isFinite(it.score))
      .slice(0, MAX_ITEMS)
      .map(it => ({ drink_id: it.drink_id, rank: Math.round(it.rank), score: Math.round(it.score) }));
    if (!items.length) return null;

    const tab = input.tab && TABS.has(input.tab) ? input.tab as TrackTab : null;
    const venue = input.venue || null;
    const key = [input.source, input.dishId, tab ?? '', venue ?? '', items.map(it => `${it.drink_id}:${it.score}`).join(',')].join('|');
    const now = Date.now();
    for (const [k, v] of this.recent) if (now - v.at > DEDUPE_MS) this.recent.delete(k);
    const seen = this.recent.get(key);
    if (seen) return seen.id;

    const id = uuid4();
    this.recent.set(key, { id, at: now });
    const ev: ListEvent = {
      type: 'list', list_id: id, source: input.source, dish_id: input.dishId, tab, venue,
      table: Number.isInteger(input.table) && (input.table as number) > 0 && (input.table as number) <= MAX_TABLE ? input.table as number : null,
      occasion: input.occasion && OCCASIONS.has(input.occasion) ? input.occasion : null,
      locale: this.i18n.locale(), session: this.session(), engine: ENGINE_VERSION,
      calibration: this.data.calibration?.version ?? null, items,
    };
    // пул: число 3…99 (как score на сервере) или null; неизвестно — поле не шлём
    const pool = input.poolBestOther;
    if (pool === null) ev.pool_best_other = null;
    else if (typeof pool === 'number' && Number.isFinite(pool)) ev.pool_best_other = Math.min(99, Math.max(3, Math.round(pool)));
    this.push(ev);
    return id;
  }

  /** Действие гостя со списком или карточкой напитка. */
  action(input: ActionInput): void {
    if (!this.enabled || !KINDS.has(input.kind) || !input.drinkId || !input.dishId) return;
    this.push({
      type: 'action', kind: input.kind, list_id: input.listId || null, drink_id: input.drinkId, dish_id: input.dishId,
      venue: input.venue || null, session: this.session(),
    });
  }

  /** Отправить всё накопленное сейчас. beacon — страница уходит: sendBeacon / keepalive. */
  flush(beacon = false): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    while (this.queue.length) {
      const batch = this.queue.splice(0, MAX_BATCH);
      this.send(JSON.stringify({ events: batch }), beacon);
    }
  }

  private push(e: TrackEvent): void {
    this.queue.push(e);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= MAX_BATCH) { this.flush(); return; }
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, FLUSH_MS);
  }

  private send(body: string, beacon: boolean): void {
    if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        // text/plain: beacon на другой домен без preflight; сервер разбирает его как JSON (_TextJSONParser)
        if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
      } catch { /* beacon недоступен — ниже fetch keepalive */ }
    }
    try {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
        .catch(() => { /* аналитика не должна мешать гостю */ });
    } catch { /* ignore */ }
  }

  /**
   * Анонимный id сессии трекинга: 32 hex из crypto (uuid4), в localStorage ft.track.v1. Отдельный от id гостя,
   * который уходит с отзывами и сканами QR (ft.saas.guest), — по нему записи трекинга с отзывами не склеить.
   * Меню заведения передаёт его и в старое событие «Заказать» (/api/track/), чтобы сервер склеил два пути одного
   * нажатия; сервер хранит его там тоже только как HMAC.
   */
  session(): string {
    if (this.sessionId) return this.sessionId;
    let id = '';
    try { id = localStorage.getItem(LS_SESSION) ?? ''; } catch { id = ''; }
    if (!SESSION_RX.test(id)) {
      id = uuid4().replace(/-/g, '');
      try { localStorage.setItem(LS_SESSION, id); } catch { /* приватный режим — id живёт до перезагрузки */ }
    }
    this.sessionId = id;
    return id;
  }
}
