import { Injectable } from '@angular/core';
import { API_BASE } from './api.service';

/**
 * События пилота для POST /api/events/: сканы QR, открытия меню и подбора, добавления из подбора.
 *
 * Гость = сессия браузера: случайный id в localStorage под ключом ft_sid, общий для всего сайта.
 * События копятся в очереди и уходят пачкой раз в несколько секунд, а при уходе со страницы
 * (pagehide, вкладка скрыта) через navigator.sendBeacon. Аналитика не должна мешать гостю,
 * поэтому ни один метод не бросает исключений, а ошибки сети молча теряются.
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

interface Queued {
  venue: string | null;
  event: TrackFields & { kind: TrackKind };
}

/** С чем гость пришёл по ссылке: стол и метка src из query, пока AppComponent не убрал их из адреса. */
export interface EntryParams {
  slug: string;
  table: number | null;
  src: string;
}

const EVENTS_URL = `${API_BASE}/events/`;
/** Сервер принимает до 20 событий за раз. */
const BATCH = 20;
const FLUSH_MS = 4000;
/** Если сеть лежит долго, старые события выбрасываем, чтобы очередь не росла. */
const MAX_QUEUE = 200;

/** Сессия без хранилища (приватный режим): живёт до перезагрузки. */
let memorySession = '';

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // randomUUID есть только в https и на localhost; getRandomValues работает и по http в локальной сети
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  }
}

/** id сессии гостя (ft_sid). Создаётся при первом обращении; им пользуются и заказ, и оценка пары. */
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

@Injectable({ providedIn: 'root' })
export class TrackService {
  private queue: Queued[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private entry: EntryParams | null = null;

  constructor() {
    try {
      // При уходе со страницы setTimeout уже не сработает: отправляем то, что накопилось, маяком
      window.addEventListener('pagehide', () => this.flush(true));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flush(true);
      });
    } catch {
      // без window (тесты, пререндер) просто не шлём при уходе
    }
  }

  get session(): string {
    return sessionId();
  }

  /** Кладёт событие в очередь. venue - slug заведения или null. */
  track(kind: TrackKind, venue: string | null, fields: TrackFields = {}): void {
    try {
      // Пустые поля не шлём: сервер всё равно их отбросит
      const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      this.queue.push({ venue: venue || null, event: { ...clean, kind } });
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
      if (this.queue.length >= BATCH) this.flush(false);
      else this.schedule();
    } catch {
      // событие потеряно, гостю это не мешает
    }
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

  /** Отправляет очередь. beacon: страница закрывается, fetch может не успеть. */
  flush(beacon = false): void {
    try {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (!this.queue.length) return;
      const pending = this.queue;
      this.queue = [];
      // Одна пачка - одно заведение и не больше BATCH событий
      const groups = new Map<string | null, Queued['event'][]>();
      for (const q of pending) {
        const list = groups.get(q.venue) ?? [];
        list.push(q.event);
        groups.set(q.venue, list);
      }
      const session = this.session;
      for (const [venue, events] of groups) {
        for (let i = 0; i < events.length; i += BATCH) {
          const body = JSON.stringify({ session, venue: venue ?? '', events: events.slice(i, i + BATCH) });
          this.send(body, beacon);
        }
      }
    } catch {
      // не удалось собрать пачку: события потеряны
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush(false);
    }, FLUSH_MS);
  }

  /**
   * text/plain без заголовков - «простой» CORS-запрос без preflight, сервер разбирает JSON внутри.
   * Без Authorization: события анонимные, токен сотрудника сюда не нужен.
   */
  private send(body: string, beacon: boolean): void {
    try {
      if (beacon && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(EVENTS_URL, body)) return;
    } catch {
      // маяк не принял данные: пробуем обычным запросом
    }
    try {
      fetch(EVENTS_URL, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        keepalive: true,
        credentials: 'omit',
        mode: 'cors',
      }).catch(() => undefined);
    } catch {
      // fetch нет или он бросил сразу: событие потеряно
    }
  }
}
