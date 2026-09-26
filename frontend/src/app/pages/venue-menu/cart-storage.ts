import { OrderItemKind, OrderItemSource } from '../../models/flavor-tree.models';

/**
 * Корзина гостя в localStorage, отдельно для каждого заведения.
 *
 * Запись читает и пишет страница меню; ИИ-сомелье добавляет сюда позиции
 * из своих карточек и сообщает об этом событием CART_CHANGED_EVENT на window.
 */

/** Строка корзины: id позиции меню (блюдо) или напитка из карты бара. */
export interface CartLine {
  kind: OrderItemKind;
  id: string;
  title: string;
  sub: string;
  price: string;
  qty: number;
  /** Откуда позиция: без поля - из меню. Уходит в заказ для отчёта пилота. */
  source?: OrderItemSource;
  /** Позиция меню (блюдо), к которой подобран напиток. */
  pairedWith?: string;
  /** Место напитка в подборе, 1 - лучший. */
  rank?: number;
}

export const MAX_QTY = 20;

/** Событие window: корзину заведения изменили вне страницы меню. detail: { slug }. */
export const CART_CHANGED_EVENT = 'ft-cart-changed';

export const cartKey = (slug: string) => `ft_cart_${slug}`;
export const orderKey = (slug: string) => `ft_order_${slug}`;

/** localStorage может быть недоступен (приватный режим): тогда состояние живёт до перезагрузки. */
export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // без хранилища корзина и заказ живут в памяти
  }
}

export function readCart(slug: string): CartLine[] {
  const saved = readJson<CartLine[]>(cartKey(slug));
  return Array.isArray(saved) ? saved : [];
}

/** Пустая корзина удаляет запись, чтобы не копить мусор в хранилище. */
export function writeCart(slug: string, lines: CartLine[]): void {
  writeJson(cartKey(slug), lines.length ? lines : null);
}

/**
 * Метка источника для строки, в которую добавили ещё одну единицу. Одна строка на позицию,
 * поэтому подсказка побеждает: напиток, взятый из подбора или у ИИ-сомелье хотя бы раз,
 * считается выбранным по подсказке. Уже поставленную подсказку меню не перезаписывает.
 */
export function withSource<T extends Pick<CartLine, 'source' | 'pairedWith' | 'rank'>>(
  line: T, from: Pick<CartLine, 'source' | 'pairedWith' | 'rank'> | undefined,
): T {
  if (!from?.source || from.source === 'MENU') return line;
  if (line.source && line.source !== 'MENU') return line;
  return { ...line, source: from.source, pairedWith: from.pairedWith, rank: from.rank };
}

/** Плюс одна единица позиции в корзине заведения; новая строка получает qty 1. Возвращает новую корзину. */
export function addToCart(slug: string, line: Omit<CartLine, 'qty'>): CartLine[] {
  const lines = [...readCart(slug)];
  const i = lines.findIndex(l => l.kind === line.kind && l.id === line.id);
  if (i < 0) lines.push({ ...line, qty: 1 });
  else if (lines[i].qty < MAX_QTY) lines[i] = withSource({ ...lines[i], qty: lines[i].qty + 1 }, line);
  writeCart(slug, lines);
  return lines;
}

/** Сообщает открытой странице меню, что корзину заведения поменяли. */
export function notifyCartChanged(slug: string): void {
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: { slug } }));
}
