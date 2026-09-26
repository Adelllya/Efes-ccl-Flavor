import { Injectable } from '@angular/core';
import { API_BASE } from './api.service';

/**
 * События пилота для POST /api/events/: сканы QR, открытия меню и подбора, добавления из подбора.
 *
 * Гость = сессия браузера: случайный id в localStorage под ключом ft_sid, общий для всего сайта.
 * События копятся в очереди и уходят пачкой раз в несколько секунд, а при уходе со страницы
 * (pagehide, вкладка скрыта) ещё и через navigator.sendBeacon.
 *
 * Событие не теряется из-за плохой сети: очередь лежит в localStorage (не больше MAX_QUEUE,
 * лишние самые старые), и событие уходит из неё, только когда сервер ответил 2xx. Пачку, которая
 * не дошла, отправляем снова с растущей паузой. У каждого события свой id (meta.cid): если пачка
 * дошла, а ответ потерялся, или маяк успел раньше, сервер выкинет повтор по паре (session, cid).
 * Аналитика не должна мешать гостю, поэтому ни один метод не бросает исключений.
 *
 * ORDER и FEEDBACK сервер пишет сам, из браузера их не шлём.
 */

export const SESSION_KEY = 'ft_sid';

export type TrackKind = 'SCAN' | 'MENU_OPEN' | 'PAIR_OPEN' | 'PAIR_ADD' | 'AGE_OK' | 'AI_ASK' | 'AI_ADD' | 'CATALOG_OPEN' | 'PAIRING_V2';

/** Поля события как их ждёт сервер; всё, кроме kind, необязательно. */
export interface TrackFields {
  table?: number | null;
  /** id позиции меню (MenuItem) этого заведения. */
  menu_item?: string;
  /** id напитка карты бара (MenuDrink) этого заведения. */
  menu_drink?: string;
  /** Блюдо или напиток, если это не позиция карты: id каталога, id движка или название. */
  dish_ref?: string;
  drink_ref?: string;
  /** Место в подборе, 1 - лучший. */
  rank?: number | null;
  source?: string;
  meta?: Record<string, unknown>;
}

type QueuedEvent = Omit<TrackFields, 'meta'> & { kind: TrackKind; meta: Record<string, unknown> & { cid: string } };

interface Queued {
  venue: string | null;
  event: QueuedEvent;
}

/** С чем гость пришёл по ссылке: стол и метка src из query, пока AppComponent не убрал их из адреса. */
export interface EntryParams {
  slug: string;
  table: number | null;
  src: string;
}

type SendResult = 'ok' | 'retry' | 'drop';

const EVENTS_URL = `${API_BASE}/events/`;
/** Сервер принимает до 20 событий за раз. */
const BATCH = 20;
const FLUSH_MS = 4000;
/** Самая длинная пауза между повторами, когда сеть лежит долго. */
const RETRY_MAX_MS = 120000;
/** Большую очередь после долгого обрыва отправляем по несколько пачек с короткой паузой. */
const MAX_PARALLEL = 3;
const DRAIN_MS = 300;
/** Очередь в localStorage: если сеть лежит долго, самые старые события выбрасываем. */
const QUEUE_KEY = 'ft_track_queue';
const MAX_QUEUE = 300;
/** Отметки «это событие уже записано» для trackOnce и ageOk. */
const ONCE_PREFIX = 'ft_once_';
const CID_RE = /^[A-Za-z0-9_-]{6,40}$/;

/** Сессия без хранилища (приватный режим): живёт до перезагрузки. */
let memorySession = '';

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  try {
    crypto.getRandomValues(b);
  } catch {
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return b;
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // randomUUID есть только в https и на localhost; getRandomValues работает и по http в локальной сети
  }
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** id события для сервера: 16 случайных знаков, повтор с тем же id сервер не запишет. */
function newCid(): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(16), x => abc[x % abc.length]).join('');
}

/** id сессии гостя (ft_sid). Создаётся при первом обращении; им пользуются и заказ, и оценка пары, и чат. */
export function sessionId(): string {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved && saved.length <= 36) return saved;
    const id = memorySession || newId();
    localStorage.setItem(SESSION_KEY, id);
    memorySession = id;
    return id;
  } catch {
    if (!memorySession) memorySession = newId();
    return memorySession;
  }
}

/** Очередь прошлого визита: только записи правильной формы, не больше MAX_QUEUE последних. */
function loadQueue(): Queued[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is Queued => {
      const e = q?.event;
      return !!e && typeof e.kind === 'string' && typeof e.meta?.cid === 'string' && CID_RE.test(e.meta.cid)
        && (q.venue === null || typeof q.venue === 'string');
    }).slice(-MAX_QUEUE);
  } catch {
    return [];
  }
}

@Injectable({ providedIn: 'root' })
export class TrackService {
  private queue: Queued[] = loadQueue();
  /** cid событий, которые сейчас летят обычным запросом: второй раз параллельно их не шлём. */
  private readonly inflight = new Set<string>();
  /** Отметки trackOnce, когда хранилище недоступно. */
  private readonly onceMemory = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Неудачных отправок подряд: от них растёт пауза до следующей попытки. */
  private failures = 0;
  private entry: EntryParams | null = null;

  constructor() {
    try {
      // При уходе со страницы setTimeout уже не сработает: отправляем то, что накопилось, маяком
      window.addEventListener('pagehide', () => this.flush(true));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flush(true);
        else if (this.queue.length) this.schedule(FLUSH_MS);
      });
      // Сеть вернулась: не ждём конца паузы
      window.addEventListener('online', () => {
        this.failures = 0;
        this.flush(false);
      });
    } catch {
      // без window (тесты, пререндер) просто не шлём при уходе
    }
    // События, которые не ушли в прошлый раз
    if (this.queue.length) this.schedule(1000);
  }

  get session(): string {
    return sessionId();
  }

  /** Кладёт событие в очередь. venue - slug заведения или null. */
  track(kind: TrackKind, venue: string | null, fields: TrackFields = {}): void {
    try {
      // Пустые поля не шлём: сервер всё равно их отбросит
      const clean = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ) as TrackFields;
      const meta = { ...(clean.meta ?? {}), cid: newCid() };
      this.queue.push({ venue: venue || null, event: { ...clean, kind, meta } });
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
      this.persist();
      // Пока сеть сбоит, новые события не сокращают паузу между повторами
      if (!this.failures && this.pending().length >= BATCH) this.flush(false);
      else this.schedule(this.failures ? this.retryDelay() : FLUSH_MS);
    } catch {
      // событие потеряно, гостю это не мешает
    }
  }

  /**
   * Событие, которое пишем один раз: за браузер (scope 'local', localStorage) или за визит
   * (scope 'session', sessionStorage вкладки). Возвращает true, если событие ушло в очередь.
   */
  trackOnce(key: string, scope: 'local' | 'session', kind: TrackKind, venue: string | null, fields: TrackFields = {}): boolean {
    const name = ONCE_PREFIX + key;
    if (this.onceMemory.has(name)) return false;
    try {
      const storage = scope === 'session' ? sessionStorage : localStorage;
      if (storage.getItem(name)) return false;
      storage.setItem(name, '1');
    } catch {
      // без хранилища отметка живёт до перезагрузки
    }
    this.onceMemory.add(name);
    this.track(kind, venue, fields);
    return true;
  }

  /**
   * AGE_OK: гость подтвердил 21+. Одно событие на сессию гостя (ft_sid) для каждого заведения
   * и одно вне заведений: окно 21+ и галочка в корзине второй раз его не пишут.
   */
  ageOk(venue: string | null, table: number | null, source: 'GATE' | 'CART'): void {
    this.trackOnce(`AGE_OK:${venue || ''}`, 'local', 'AGE_OK', venue, { table: venue ? table : null, source });
  }

  /**
   * Запоминает стол и src из адреса /menu/<slug>?table=7&src=qr до того, как query уберут из адреса.
   * Страница меню забирает их через takeEntry и отправляет SCAN.
   */
  noteEntry(slug: string, search: string): void {
    try {
      const q = new URLSearchParams(search);
      const rawTable = q.get('table');
      const n = rawTable === null ? NaN : Number(rawTable);
      const table = Number.isInteger(n) && n >= 0 ? n : null;
      const src = (q.get('src') || '').trim().slice(0, 16);
      if (table === null && !src) return;
      this.entry = { slug, table, src };
    } catch {
      this.entry = null;
    }
  }

  /** Отдаёт параметры входа для заведения один раз. */
  takeEntry(slug: string): EntryParams | null {
    const e = this.entry;
    if (!e || e.slug !== slug) return null;
    this.entry = null;
    return e;
  }

  /**
   * Отправляет очередь. beacon: страница закрывается или прячется, обычный запрос может не успеть.
   * Маяк не сообщает, дошли ли данные, поэтому события после него остаются в очереди (и уходят
   * в нём все, даже летящие: при закрытии страницы обычный запрос обрывается). Если маяк дошёл,
   * повтор сервер узнает по cid и не запишет.
   */
  flush(beacon = false): void {
    try {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const list = beacon ? this.queue : this.pending();
      if (!list.length) return;
      const session = this.session;
      let posted = 0;
      for (const chunk of this.chunks(list)) {
        const body = JSON.stringify({ session, venue: chunk[0].venue ?? '', events: chunk.map(q => q.event) });
        if (beacon) {
          if (!this.beacon(body)) this.post(chunk, body, true);
        } else if (posted < MAX_PARALLEL) {
          this.post(chunk, body, false);
          posted++;
        } else {
          // остальное уйдёт следующим заходом, когда эти пачки дойдут
          break;
        }
      }
    } catch {
      // не удалось собрать пачку: события остались в очереди до следующей попытки
    }
  }

  /** События в очереди, которые сейчас не летят. */
  private pending(): Queued[] {
    return this.queue.filter(q => !this.inflight.has(q.event.meta.cid));
  }

  /** Пачки для сервера: одно заведение и не больше BATCH событий в каждой. */
  private chunks(list: Queued[]): Queued[][] {
    const groups = new Map<string | null, Queued[]>();
    for (const q of list) {
      const group = groups.get(q.venue) ?? [];
      group.push(q);
      groups.set(q.venue, group);
    }
    const out: Queued[][] = [];
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += BATCH) out.push(group.slice(i, i + BATCH));
    }
    return out;
  }

  private schedule(ms: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush(false);
    }, ms);
  }

  /** Пауза после неудачи: 8, 16, 32 секунды и так далее до двух минут. */
  private retryDelay(): number {
    return Math.min(RETRY_MAX_MS, FLUSH_MS * 2 ** Math.min(this.failures, 6));
  }

  private beacon(body: string): boolean {
    try {
      return typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(EVENTS_URL, body);
    } catch {
      return false;
    }
  }

  /**
   * text/plain без заголовков - «простой» CORS-запрос без preflight, сервер разбирает JSON внутри.
   * Без Authorization: события анонимные, токен сотрудника сюда не нужен.
   * 2xx - дошло; 408, 429, 5xx и ошибка сети - повторим позже; другие 4xx сервер не примет никогда.
   * keepalive только при уходе со страницы: у таких запросов общий лимит 64 КБ.
   */
  private post(chunk: Queued[], body: string, keepalive: boolean): void {
    const cids = chunk.map(q => q.event.meta.cid);
    cids.forEach(c => this.inflight.add(c));
    let request: Promise<SendResult>;
    try {
      request = fetch(EVENTS_URL, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        keepalive,
        credentials: 'omit',
        mode: 'cors',
      }).then(
        (r): SendResult => r.ok ? 'ok' : r.status === 408 || r.status === 429 || r.status >= 500 ? 'retry' : 'drop',
        (): SendResult => 'retry',
      );
    } catch {
      request = Promise.resolve<SendResult>('retry');
    }
    request.then(result => {
      cids.forEach(c => this.inflight.delete(c));
      if (result === 'retry') {
        this.failures++;
        this.schedule(this.retryDelay());
        return;
      }
      this.failures = 0;
      const done = new Set(cids);
      this.queue = this.queue.filter(q => !done.has(q.event.meta.cid));
      this.persist();
      if (this.pending().length) this.schedule(DRAIN_MS);
    }).catch(() => undefined);
  }

  private persist(): void {
    try {
      if (this.queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
      else localStorage.removeItem(QUEUE_KEY);
    } catch {
      // хранилище недоступно или переполнено: очередь живёт в памяти до перезагрузки
    }
  }
}
