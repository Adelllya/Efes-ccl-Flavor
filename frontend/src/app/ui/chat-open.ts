/**
 * Страница просит открыть чат сомелье (кнопка «ИИ-сомелье» на главной и т.п.):
 *   window.dispatchEvent(new CustomEvent('ft-open-chat', { detail: { text: 'Что взять к плову?' } }))
 * text необязателен: он встаёт в поле ввода, отправляет его гость сам.
 *
 * Событие ловит AppComponent. Чат грузится отдельным чанком, когда браузер освободится после первой
 * отрисовки: просьба, пришедшая раньше, ждёт его здесь, а AppComponent сразу грузит чанк.
 */
export const OPEN_CHAT_EVENT = 'ft-open-chat';

export interface OpenChatDetail {
  text?: string;
}

/** Сколько просьба ждёт чат: чат, появившийся позже (гость ушёл в панель и вернулся), её уже не выполняет. */
const WAIT_MS = 10000;

let openChat: ((detail: OpenChatDetail) => void) | null = null;
let waiting: { detail: OpenChatDetail; at: number } | null = null;

/** detail события: берём только строку text. */
export function openChatDetail(event: Event): OpenChatDetail {
  const detail = (event as CustomEvent<unknown>).detail as { text?: unknown } | null | undefined;
  return detail && typeof detail.text === 'string' ? { text: detail.text } : {};
}

/** Просьба пришла. Чат уже на странице: открывается сразу (false). Нет: просьба ждёт его (true). */
export function requestOpenChat(detail: OpenChatDetail): boolean {
  if (openChat) {
    openChat(detail);
    return false;
  }
  waiting = { detail, at: Date.now() };
  return true;
}

/** Чат появился: дальше просьбы идут ему. Возвращает просьбу, которая его ждала, если она свежая. */
export function attachChat(open: (detail: OpenChatDetail) => void): OpenChatDetail | null {
  openChat = open;
  const w = waiting;
  waiting = null;
  return w && Date.now() - w.at < WAIT_MS ? w.detail : null;
}

export function detachChat(open: (detail: OpenChatDetail) => void): void {
  if (openChat === open) openChat = null;
}
