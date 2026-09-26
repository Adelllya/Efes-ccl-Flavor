export type PackagingType = 'BOTTLE' | 'CAN' | 'DRAFT';
export type PyramidLayer = 'TOP' | 'HEART' | 'BASE';
export type PairingType = 'COMPLEMENT' | 'CONTRAST' | 'CLEANSE' | 'BRIDGE';
export type CuisineType = 'KZ' | 'ITALIAN' | 'JAPANESE' | 'AMERICAN' | 'MEXICAN' | 'GERMAN' | 'OTHER';

export interface FlavorNote {
  id: string;
  name: string;
  /** Фото ингредиента с бэкенда: ромашка, колос, шишка хмеля. */
  image?: string | null;
  technical_term?: string;
  wheel_code?: string;
  category: PyramidLayer;
  category_display?: string;
  icon: string;
  description?: string;
  reference_material?: string;
  is_off_flavour?: boolean;
}

export interface PyramidNoteItem {
  id: string;
  name: string;
  icon: string;
  /** Фото ноты. Если пусто - остаётся emoji. */
  image?: string | null;
  description: string;
  technical_term?: string;
  reference_material?: string;
  is_off_flavour?: boolean;
  intensity: number; // 1 - 10
  sommelier_note?: string;
  sommelier_name?: string;
  category_label?: string;
}

export interface PyramidData {
  top: PyramidNoteItem[];
  heart: PyramidNoteItem[];
  base: PyramidNoteItem[];
}

export interface ServingRecommendation {
  serving_temp_min: number;
  serving_temp_max: number;
  glass_type: string;
  seasonality?: string;
}

export interface BrandProfileStatus {
  top: number;
  heart: number;
  base: number;
  total: number;
  complete: boolean;
  status: 'complete' | 'partial' | 'empty';
}

export interface Brand {
  id: string;
  name: string;
  brand_owner?: string;
  style: string;
  abv?: number | null;
  /** Точной крепости в наших источниках нет, это оценка по стилю из каталога движка: пишем «около». */
  abv_estimated?: boolean;
  density?: string;
  fermentation_type?: string;
  packaging_type: PackagingType;
  packaging_type_display?: string;
  is_horeca_only: boolean;
  description: string;
  /** Лёгкий файл для мелких мест: карточки, списки. */
  image?: string;
  /** Крупная версия для страницы сорта и большой карточки подбора. */
  image_hd?: string | null;
  /** HEX для фона страницы сорта, задаётся в админке. */
  accent_color?: string;
  /** Строка над названием на странице сорта. */
  tagline?: string;
  is_active: boolean;
  note_count?: number;
  profile?: BrandProfileStatus;
  serving_recommendation?: ServingRecommendation;
  pyramid?: PyramidData;
}

export type TasteType = 'SALTY' | 'SWEET' | 'SOUR' | 'BITTER' | 'UMAMI' | 'SPICY' | 'MIXED';
export type WeightType = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export type FatType = 'LOW' | 'MEDIUM' | 'HIGH';
export type CookingMethod =
  | 'FRIED' | 'GRILLED' | 'BAKED' | 'BOILED' | 'STEAMED'
  | 'RAW' | 'CURED' | 'FERMENTED' | 'OTHER';

export interface Dish {
  id: string;
  name: string;
  cuisine: CuisineType;
  cuisine_display?: string;
  category?: string;
  dominant_taste: TasteType;
  dominant_taste_display?: string;
  weight: WeightType;
  weight_display?: string;
  fat_level: FatType;
  fat_level_display?: string;
  cooking_method: CookingMethod;
  cooking_method_display?: string;
  description: string;
  /** Абсолютный URL: загруженный файл, а если его нет - image_url. Только чтение. */
  image?: string;
  /** Ссылка на фото, если файл не загружали. Записываемое поле. */
  image_url?: string;
  /** В скольких меню и сочетаниях блюдо участвует; приходит с бэкенда. */
  menu_items_count?: number;
  pairings_count?: number;
}

/** Русские подписи типов сочетания для всех страниц. */
export const PAIRING_LABELS: Record<PairingType, string> = {
  COMPLEMENT: 'Дополняет',
  CONTRAST: 'Контраст',
  CLEANSE: 'Очищает',
  BRIDGE: 'Мостик'
};

export interface FoodPairing {
  id: string;
  brand: string;
  brand_name: string;
  dish: string;
  dish_name: string;
  compatibility_score: number; // 1 - 5
  pairing_type: PairingType;
  pairing_type_display?: string;
  explanation: string;
}

export interface Course {
  id: string;
  level: number;
  level_display: string;
  title: string;
  description: string;
  color?: string;
  required_score?: number;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  avatar?: string;
}

export interface AdminFlavorProfilePayload {
  brand_id: string;
  notes: {
    flavor_note_id: string;
    layer: PyramidLayer;
    intensity: number;
    sommelier_note: string;
  }[];
}


/** Картинка характеристики блюда из админки: «жареное», «острое», «мясо». */
export interface FoodIcon {
  id: string;
  kind: 'CATEGORY' | 'COOKING' | 'TASTE' | 'WEIGHT';
  kind_display?: string;
  key: string;
  label?: string;
  image: string;
  sort_order?: number;
}

/** Настройки витрины: сколько сортов показывать и нужен ли декор. */
export interface SiteSettings {
  alternatives_count: number;
  min_score_to_show: number;
  show_wheat_decor: boolean;
  pairing_intro: string;
}

/** Роли совпадают с группами Django; is_superuser считается модератором. */
export type UserRole = 'user' | 'sommelier' | 'restaurant_admin' | 'moderator';

export interface VenueRef {
  id: string;
  slug: string;
  name: string;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  role: UserRole;
  role_display: string;
  is_superuser: boolean;
  venue: VenueRef | null;
  date_joined?: string;
  is_active?: boolean;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export type VenueType = 'BAR' | 'RESTAURANT' | 'PUB' | 'CAFE' | 'OTHER';

export interface Venue {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  venue_type: VenueType;
  venue_type_display?: string;
  /** Абсолютный URL: загруженный файл, а если его нет - logo_url. Только чтение. */
  logo: string;
  /** Ссылка на логотип, если файл не загружали. Записываемое поле. */
  logo_url?: string;
  cover: string;
  description: string;
  phone: string;
  working_hours: string;
  is_published: boolean;
  /** Сколько столов у заведения: гость выбирает номер из 1..tables_count. */
  tables_count: number;
  items_count?: number;
  owner?: { id: number; username: string } | null;
}

/** Лучшее сочетание для блюда в меню: пара с самым высоким баллом. */
export interface MenuPairing {
  brand: string;
  brand_name: string;
  brand_image: string | null;
  brand_style: string;
  abv: number | null;
  compatibility_score: number;
  pairing_type: PairingType;
  pairing_type_display?: string;
  explanation: string;
  /** Позиция карты бара, если этот сорт там есть; null - сорта в карте нет. */
  menu_drink?: MenuDrinkRef | null;
}

export interface MenuItem {
  id: string;
  venue: string;
  dish: string;
  dish_name?: string;
  dish_category?: string;
  dish_image?: string;
  price: string;
  section: string;
  portion: string;
  sort_order: number;
  is_available: boolean;
  chef_note: string;
}

/** Напиток в карте бара: сорт из каталога с ценой и объёмом для этого заведения. */
export interface MenuDrink {
  id: string;
  venue: string;
  brand: string;
  brand_name: string;
  brand_style: string;
  /** Абсолютный URL: image, а если его нет - image_hd. */
  brand_image: string | null;
  abv: number | null;
  price: string;
  /** Например "0,5 л". */
  volume: string;
  is_available: boolean;
  sort_order: number;
}

/** Короткая ссылка на позицию карты бара внутри рекомендации к блюду. */
export interface MenuDrinkRef {
  id: string;
  price: string;
  volume: string;
  is_available: boolean;
}

/** Позиция публичного меню: блюдо целиком плюс рекомендация. */
export interface MenuEntry extends Omit<MenuItem, 'dish' | 'venue'> {
  dish: Dish;
  pairing: MenuPairing | null;
  /** До двух других сочетаний для блюда, сорта которых есть в карте бара. */
  alternatives?: MenuPairing[];
}

export interface VenueMenu {
  venue: Venue;
  sections: { name: string; items: MenuEntry[] }[];
  /** Карта бара целиком, включая недоступные позиции, в порядке sort_order. */
  drinks: MenuDrink[];
}

/** Запрос сомелье на изменение данных сорта: живыми становятся только принятые. */
export type RequestKind = 'NOTE_UPSERT' | 'NOTE_DELETE' | 'SERVING';
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  NOTE_UPSERT: 'Нота пирамиды',
  NOTE_DELETE: 'Удалить ноту',
  SERVING: 'Подача'
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: 'Ожидает',
  APPROVED: 'Принято',
  REJECTED: 'Отклонено'
};

/** Данные запроса: NOTE_UPSERT, NOTE_DELETE и SERVING несут разные поля. */
export interface NoteUpsertPayload {
  flavor_note_id: string;
  layer: PyramidLayer;
  intensity: number;
  sommelier_note: string;
}

export interface NoteDeletePayload {
  flavor_note_id: string;
}

export type ServingPayload = ServingRecommendation;

export interface ChangeRequest {
  id: string;
  kind: RequestKind;
  kind_display: string;
  status: RequestStatus;
  status_display: string;
  brand: string;
  brand_name: string;
  brand_image: string | null;
  payload: Record<string, any>;
  comment: string;
  /** Русская строка вида "Бочковое: нота Свежесть (Top), интенсивность 7/10". */
  summary: string;
  author: { id: number; username: string };
  reviewer: { id: number; username: string } | null;
  review_comment: string;
  created_at: string;
  reviewed_at: string | null;
  flavor_note_name?: string | null;
  /** Текущее живое значение той же ноты или подачи, чтобы показать "было / станет". */
  current?: Record<string, any> | null;
}

export interface ChangeRequestInput {
  brand: string;
  kind: RequestKind;
  payload: Record<string, any>;
  comment?: string;
}

/** Ответ approve: сам запрос плюс пирамида сорта после применения. */
export interface ChangeRequestApproved extends ChangeRequest {
  pyramid?: PyramidData;
}

/** Заказ гостя: статусы совпадают с choices модели Order. */
export type OrderStatus = 'NEW' | 'ACCEPTED' | 'COOKING' | 'SERVED' | 'DONE' | 'CANCELLED';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'Новый',
  ACCEPTED: 'Принят',
  COOKING: 'Готовится',
  SERVED: 'Подан',
  DONE: 'Закрыт',
  CANCELLED: 'Отменён'
};

/** Обычный путь заказа; отмена возможна из любого статуса, кроме DONE. */
export const ORDER_FLOW: readonly OrderStatus[] = ['NEW', 'ACCEPTED', 'COOKING', 'SERVED', 'DONE'];

/** Следующий статус по обычному пути или null, если заказ закрыт или отменён. */
export function nextOrderStatus(status: OrderStatus): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(status);
  return i >= 0 && i < ORDER_FLOW.length - 1 ? ORDER_FLOW[i + 1] : null;
}

/** Заказ больше не меняется: гостю можно перестать опрашивать сервер. */
export function isOrderClosed(status: OrderStatus): boolean {
  return status === 'DONE' || status === 'CANCELLED';
}

export type OrderItemKind = 'DISH' | 'DRINK';

/** Строка корзины для POST /orders/: id позиции меню (MenuItem) или напитка (MenuDrink). */
export interface OrderItemInput {
  kind: OrderItemKind;
  id: string;
  qty: number;
  note?: string;
}

export interface OrderInput {
  /** slug или uuid заведения. */
  venue: string;
  table_number: number;
  guest_name?: string;
  comment?: string;
  items: OrderItemInput[];
}

/** Строка заказа со снимком названия и цены на момент заказа. */
export interface OrderItem {
  id?: string;
  kind: OrderItemKind;
  menu_item?: string | null;
  menu_drink?: string | null;
  title: string;
  price: string;
  qty: number;
  note: string;
}

export interface Order {
  id: string;
  /** Номер внутри заведения, с 1. */
  number: number;
  status: OrderStatus;
  status_display: string;
  total: string;
  /** Приходит гостю при создании: по нему заказ читают без входа. */
  guest_token?: string;
  items: OrderItem[];
  created_at: string;
  updated_at?: string;
  table_number: number;
  guest_name: string;
  comment: string;
  venue: { slug: string; name: string };
}

/** ИИ-сомелье: claude, когда на сервере есть ключ, иначе локальный подбор по правилам. */
export type AiMode = 'claude' | 'local';

export interface AiStatus {
  /** Ключ ANTHROPIC_API_KEY задан на сервере. */
  enabled: boolean;
  model: string;
  mode: AiMode;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Позиция корзины гостя, которую сомелье учитывает в совете. */
export interface AiCartItem {
  kind: OrderItemKind;
  id: string;
  title: string;
  qty: number;
}

/** Пожелания гостя; все поля необязательные. */
export interface AiPrefs {
  no_bitter?: boolean;
  light?: boolean;
  no_alcohol?: boolean;
  spicy_ok?: boolean;
}

/** Тело POST /ai/sommelier/: до 12 реплик, последняя от гостя. */
export interface AiRequest {
  /** slug заведения; null - совет по общему каталогу. */
  venue: string | null;
  table: number | null;
  messages: AiMessage[];
  cart?: AiCartItem[];
  prefs?: AiPrefs;
}

/** Карточка совета: id позиции меню или напитка бара, а без заведения - блюда или сорта из каталога. */
export interface AiSuggestion {
  kind: OrderItemKind;
  id: string;
  title: string;
  /** "400 г · 4 500 ₸" или "Czech Lager · 0,5 л · 2 200 ₸". */
  subtitle: string;
  reason: string;
  /** Балл сочетания 1..5 или null, если сомелье его не ставил. */
  score: number | null;
  /** id блюда из этого же ответа, к которому предложен напиток. */
  pairs_with: string | null;
}

export interface AiReply {
  reply: string;
  suggestions: AiSuggestion[];
  mode: AiMode;
  /** Пусто или "ИИ недоступен, отвечает локальный подбор". */
  note: string;
}
