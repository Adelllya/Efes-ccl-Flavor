import { WritableSignal } from '@angular/core';
import {
  CookingMethod, CuisineType, FatType, OrderStatus, PAIRING_LABELS, PairingType, PyramidLayer,
  REQUEST_STATUS_LABELS, RequestStatus, TasteType, UserRole, VenueType, WeightType
} from '../../models/flavor-tree.models';

export interface Choice<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

/* Значения совпадают с choices моделей Django, подписи - с их verbose-текстом. */

export const CUISINE_CHOICES: Choice<CuisineType>[] = [
  { value: 'KZ', label: 'Казахская' },
  { value: 'ITALIAN', label: 'Итальянская' },
  { value: 'JAPANESE', label: 'Японская' },
  { value: 'AMERICAN', label: 'Американская' },
  { value: 'MEXICAN', label: 'Мексиканская' },
  { value: 'GERMAN', label: 'Немецкая' },
  { value: 'OTHER', label: 'Другая' }
];

export const TASTE_CHOICES: Choice<TasteType>[] = [
  { value: 'SALTY', label: 'Солёное' },
  { value: 'SWEET', label: 'Сладкое' },
  { value: 'SOUR', label: 'Кислое' },
  { value: 'BITTER', label: 'Горькое' },
  { value: 'UMAMI', label: 'Умами' },
  { value: 'SPICY', label: 'Острое' },
  { value: 'MIXED', label: 'Микс' }
];

export const WEIGHT_CHOICES: Choice<WeightType>[] = [
  { value: 'LIGHT', label: 'Лёгкое' },
  { value: 'MEDIUM', label: 'Среднее' },
  { value: 'HEAVY', label: 'Тяжёлое' }
];

export const FAT_CHOICES: Choice<FatType>[] = [
  { value: 'LOW', label: 'Низкая' },
  { value: 'MEDIUM', label: 'Средняя' },
  { value: 'HIGH', label: 'Высокая' }
];

export const COOKING_CHOICES: Choice<CookingMethod>[] = [
  { value: 'FRIED', label: 'Жарка' },
  { value: 'GRILLED', label: 'Гриль' },
  { value: 'BAKED', label: 'Запекание' },
  { value: 'BOILED', label: 'Варка' },
  { value: 'STEAMED', label: 'На пару' },
  { value: 'RAW', label: 'Сырое' },
  { value: 'CURED', label: 'Вяленое' },
  { value: 'FERMENTED', label: 'Ферментация' },
  { value: 'OTHER', label: 'Без термообработки / другое' }
];

export const VENUE_TYPE_CHOICES: Choice<VenueType>[] = [
  { value: 'BAR', label: 'Бар' },
  { value: 'RESTAURANT', label: 'Ресторан' },
  { value: 'PUB', label: 'Паб' },
  { value: 'CAFE', label: 'Кафе' },
  { value: 'OTHER', label: 'Другое' }
];

/** Подписи типов сочетания общие для всего сайта, здесь только форма для ft-select. */
export const PAIRING_TYPE_CHOICES: Choice<PairingType>[] =
  (Object.keys(PAIRING_LABELS) as PairingType[]).map(value => ({ value, label: PAIRING_LABELS[value] }));

export const LAYER_CHOICES: Choice<PyramidLayer>[] = [
  { value: 'TOP', label: 'Top: аромат, первые секунды' },
  { value: 'HEART', label: 'Heart: тело, 3-15 секунд' },
  { value: 'BASE', label: 'Base: послевкусие' }
];

/** Короткие названия слоёв для строк, чипов и сводок. */
export const LAYER_SHORT: Record<PyramidLayer, string> = {
  TOP: 'Top',
  HEART: 'Heart',
  BASE: 'Base'
};

export const REQUEST_STATUS_CHOICES: Choice<RequestStatus>[] =
  (Object.keys(REQUEST_STATUS_LABELS) as RequestStatus[]).map(value => ({ value, label: REQUEST_STATUS_LABELS[value] }));

export const ROLE_CHOICES: Choice<UserRole>[] = [
  { value: 'user', label: 'Пользователь' },
  { value: 'sommelier', label: 'Сомелье' },
  { value: 'restaurant_admin', label: 'Администратор заведения' },
  { value: 'moderator', label: 'Модератор' }
];

export function labelOf(choices: Choice[], value: string | null | undefined): string {
  return choices.find(c => c.value === value)?.label ?? (value || '');
}

/** Класс чипа статуса запроса: .wa-chip-pending / -approved / -rejected. */
export function statusChipClass(status: RequestStatus): string {
  return 'wa-chip wa-chip-' + status.toLowerCase();
}

/** Чип статуса заказа: новый выделен, в работе жёлтый, подан зелёный, отменён красный. */
export const ORDER_STATUS_CHIP: Record<OrderStatus, string> = {
  NEW: 'wa-chip wa-chip-accent',
  ACCEPTED: 'wa-chip wa-chip-pending',
  COOKING: 'wa-chip wa-chip-pending',
  SERVED: 'wa-chip wa-chip-approved',
  DONE: 'wa-chip',
  CANCELLED: 'wa-chip wa-chip-rejected'
};

/** Подпись кнопки перехода в следующий статус заказа. */
export const ORDER_NEXT_LABELS: Partial<Record<OrderStatus, string>> = {
  NEW: 'Принять',
  ACCEPTED: 'Готовится',
  COOKING: 'Подан',
  SERVED: 'Закрыть'
};

/** Число со словом: "3 позиции", "1 нота". */
export function countOf(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const m10 = abs % 10;
  const m100 = abs % 100;
  const word = (m10 === 1 && m100 !== 11) ? one
    : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? few
    : many;
  return `${n} ${word}`;
}

/** Цена из DRF приходит строкой "9800.00", показываем "9 800 ₸". */
export function formatMoney(value: string | number | null | undefined): string {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!isFinite(n)) return `${value ?? 0} ₸`;
  const abs = Math.abs(n);
  const whole = Math.trunc(abs);
  const frac = Math.round((abs - whole) * 100);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = n < 0 ? '-' : '';
  return frac ? `${sign}${grouped},${String(frac).padStart(2, '0')} ₸` : `${sign}${grouped} ₸`;
}

/** "только что", "3 мин назад", "2 ч назад"; старше суток - дата и время. */
export function formatAgo(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return formatWhen(iso);
}

/** Показывает текст статуса и убирает его через ms миллисекунд. */
export function flash(target: WritableSignal<string | null>, text: string, ms = 4000): void {
  target.set(text);
  setTimeout(() => {
    if (target() === text) target.set(null);
  }, ms);
}

/** Сообщения об ошибках начинаются с "Ошибка", по этому признаку красим текст. */
export function isErrorText(msg: string | null | undefined): boolean {
  return !!msg && msg.startsWith('Ошибка');
}

/**
 * Удаление в два клика без confirm(): первый клик переводит кнопку
 * в "Точно удалить?", второй в течение 3,5 секунд выполняет действие.
 */
export function confirmTwice(pending: WritableSignal<string | null>, id: string, action: () => void): void {
  if (pending() === id) {
    pending.set(null);
    action();
    return;
  }
  pending.set(id);
  setTimeout(() => {
    if (pending() === id) pending.set(null);
  }, 3500);
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
}

/** "24.09, 14:05" для строк списка; сегодняшняя дата показывается как время. */
export function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return time;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ', ' + time;
}

/** Первая буква названия для круглой заглушки вместо фото. */
export function initialOf(name: string | null | undefined): string {
  return (name || '').trim().charAt(0).toUpperCase() || '?';
}

/* Фото: те же ограничения, что проверяет бэкенд. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Возвращает текст ошибки или null, если файл подходит. */
export function checkImageFile(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Подходят только PNG, JPG или WebP';
  if (file.size > MAX_IMAGE_BYTES) return 'Файл больше 5 МБ';
  return null;
}
