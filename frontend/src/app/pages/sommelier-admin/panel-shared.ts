import { Signal, WritableSignal, effect, untracked } from '@angular/core';
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
  { value: 'KZ', label: 'Kazakh' },
  { value: 'ITALIAN', label: 'Italian' },
  { value: 'JAPANESE', label: 'Japanese' },
  { value: 'AMERICAN', label: 'American' },
  { value: 'MEXICAN', label: 'Mexican' },
  { value: 'GERMAN', label: 'German' },
  { value: 'OTHER', label: 'Other' }
];

export const TASTE_CHOICES: Choice<TasteType>[] = [
  { value: 'SALTY', label: 'Salty' },
  { value: 'SWEET', label: 'Sweet' },
  { value: 'SOUR', label: 'Sour' },
  { value: 'BITTER', label: 'Bitter' },
  { value: 'UMAMI', label: 'Umami' },
  { value: 'SPICY', label: 'Spicy' },
  { value: 'MIXED', label: 'Mixed' }
];

export const WEIGHT_CHOICES: Choice<WeightType>[] = [
  { value: 'LIGHT', label: 'Light' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HEAVY', label: 'Heavy' }
];

export const FAT_CHOICES: Choice<FatType>[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' }
];

export const COOKING_CHOICES: Choice<CookingMethod>[] = [
  { value: 'FRIED', label: 'Fried' },
  { value: 'GRILLED', label: 'Grilled' },
  { value: 'BAKED', label: 'Baked' },
  { value: 'BOILED', label: 'Boiled' },
  { value: 'STEAMED', label: 'Steamed' },
  { value: 'RAW', label: 'Raw' },
  { value: 'CURED', label: 'Cured' },
  { value: 'FERMENTED', label: 'Fermented' },
  { value: 'OTHER', label: 'No cooking / other' }
];

export const VENUE_TYPE_CHOICES: Choice<VenueType>[] = [
  { value: 'BAR', label: 'Bar' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'PUB', label: 'Pub' },
  { value: 'CAFE', label: 'Café' },
  { value: 'OTHER', label: 'Other' }
];

/** Подписи типов сочетания общие для всего сайта, здесь только форма для ft-select. */
export const PAIRING_TYPE_CHOICES: Choice<PairingType>[] =
  (Object.keys(PAIRING_LABELS) as PairingType[]).map(value => ({ value, label: PAIRING_LABELS[value] }));

export const LAYER_CHOICES: Choice<PyramidLayer>[] = [
  { value: 'TOP', label: 'Top: aroma, the first seconds' },
  { value: 'HEART', label: 'Heart: body, 3-15 seconds' },
  { value: 'BASE', label: 'Base: finish' }
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
  { value: 'user', label: 'User' },
  { value: 'waiter', label: 'Waiter' },
  { value: 'sommelier', label: 'Sommelier' },
  { value: 'restaurant_admin', label: 'Venue admin' },
  { value: 'moderator', label: 'Moderator' }
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
  NEW: 'Accept',
  ACCEPTED: 'Start cooking',
  COOKING: 'Mark served',
  SERVED: 'Close'
};

/** Число со словом: "3 позиции", "1 нота". */
export function countOf(n: number, one: string, few: string, many: string = few): string {
  const abs = Math.abs(Math.trunc(n));
  if (!/[А-Яа-яЁё]/.test(one)) return `${n} ${abs === 1 ? one : many}`;
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
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = n < 0 ? '-' : '';
  return frac ? `${sign}${grouped}.${String(frac).padStart(2, '0')} ₸` : `${sign}${grouped} ₸`;
}

/** "только что", "3 мин назад", "2 ч назад"; старше суток - дата и время. */
export function formatAgo(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
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
  return !!msg && /^(Ошибка|Error|Failed|Could not|Couldn't|Can't|Cannot)/i.test(msg);
}

/**
 * Вкладки панели при переходе не уничтожаются, а прячутся. Вызывает fn, когда спрятанную
 * вкладку открыли снова (active: false -> true). Первое открытие не считается: тогда данные
 * читает сама вкладка. Вызывать из конструктора компонента.
 */
export function onTabReturn(active: Signal<boolean>, fn: () => void): void {
  let was = true;
  effect(() => {
    const now = active();
    if (now && !was) untracked(fn);
    was = now;
  }, { allowSignalWrites: true });
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
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US');
}

/** "24.09, 14:05" для строк списка; сегодняшняя дата показывается как время. */
export function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return time;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' }) + ', ' + time;
}

/** Первая буква названия для круглой заглушки вместо фото. */
export function initialOf(name: string | null | undefined): string {
  return (name || '').trim().charAt(0).toUpperCase() || '?';
}

/* Фото: те же ограничения, что проверяет бэкенд. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Возвращает текст ошибки или null, если файл подходит. */
export function checkImageFile(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Only PNG, JPG or WebP files are supported';
  if (file.size > MAX_IMAGE_BYTES) return 'The file is larger than 4 MB';
  return null;
}
