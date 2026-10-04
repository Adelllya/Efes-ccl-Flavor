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
  /**
   * Вкус сорта в шести шкалах 0-10, посчитан на сервере из стиля, крепости и пирамиды.
   * Есть и в списке сортов, где самой пирамиды нет: подбор берёт профиль отсюда.
   */
  taste_profile?: TasteProfile;
}

/** Те же шесть шкал, что у вкуса пользователя и у профиля сорта в подборе. */
export interface TasteProfile {
  body: number;
  bitterness: number;
  freshness: number;
  sweetness: number;
  roast: number;
  strength: number;
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

/** Кто поставил пару: сомелье или ИИ-подбор, который сомелье ещё не подтвердил. */
export type PairingSource = 'SOMMELIER' | 'AI';

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
  /** Только чтение: задаёт сервер. После правки сомелье пара ИИ становится парой сомелье. */
  source?: PairingSource;
  source_display?: string;
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
  /** Блок команды в Академии: включают, когда в нём записаны настоящие люди. */
  show_team?: boolean;
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
  /** id пары в каталоге: по нему гость оценивает сочетание. */
  id?: string;
  brand: string;
  brand_name: string;
  brand_image: string | null;
  brand_style: string;
  abv: number | null;
  compatibility_score: number;
  pairing_type: PairingType;
  pairing_type_display?: string;
  explanation: string;
  /** Кто поставил пару: сомелье или ИИ-подбор. */
  source?: PairingSource;
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
/** Откуда гость добавил позицию: из меню, из совета пары или из чата ИИ. По этому считается аналитика. */
export type OrderVia = 'MENU' | 'PAIRING' | 'AI';

export interface OrderItemInput {
  kind: OrderItemKind;
  id: string;
  qty: number;
  note?: string;
  via?: OrderVia;
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
  via?: OrderVia;
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

/* Предпочтения пользователя и тест Школы сомелье */

/** Те же шесть шкал 0-10, что у профиля сорта в подборе. */
export type TasteKey = 'body' | 'bitterness' | 'freshness' | 'sweetness' | 'roast' | 'strength';

export interface UserPreferences {
  /** Нет ключа - шкала пользователю не важна. */
  taste: Partial<Record<TasteKey, number>>;
  cuisines: CuisineType[];
  favorite_brands: string[];
  /** Сколько ступеней Школы сдано подряд с первой. */
  sommelier_level: number;
  passed_levels: number[];
  updated_at?: string;
}

export interface QuizPublicQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface Quiz {
  level: number;
  title: string;
  pass_percent: number;
  questions: QuizPublicQuestion[];
}

export interface QuizAnswerResult {
  id: string;
  chosen: number | null;
  correct_index: number;
  is_correct: boolean;
  explanation: string;
}

export interface QuizResult {
  level: number;
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
  pass_percent: number;
  results: QuizAnswerResult[];
  /** false у гостя без входа: результат не записан. */
  saved: boolean;
  sommelier_level?: number;
  /** Баллы знаний после теста: только у вошедших. */
  points?: PointsBalance;
}

/** Вопрос целиком, с верным ответом: только для панели. */
export interface QuizQuestion {
  id: string;
  level: number;
  level_display?: string;
  text: string;
  options: string[];
  correct_index: number;
  explanation: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
}


/* ИИ в панели: блюда по фото и подбор сортов */

export type AiConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
/** Что на фото: блюдо, страница меню или ничего подходящего. */
export type AiPhotoKind = 'DISH' | 'MENU' | 'OTHER';

/** Сорт, предложенный к блюду: ИИ или расчёт по правилам. */
export interface AiPairing {
  brand: string;
  brand_name: string;
  brand_style: string;
  compatibility_score: number;
  pairing_type: PairingType;
  explanation: string;
  /** В ответе подбора: такая пара уже есть в базе. */
  exists?: boolean;
  /** В ответе подбора с save: пара записана этим запросом. */
  saved?: boolean;
}

/** Черновик блюда с фото. Ничего не сохранено, пока администратор не подтвердит. */
export interface AiDishDraft {
  name: string;
  category: string;
  cuisine: CuisineType;
  dominant_taste: TasteType;
  weight: WeightType;
  fat_level: FatType;
  cooking_method: CookingMethod;
  description: string;
  confidence: AiConfidence;
  /** Для страницы меню: раздел, порция и цена в тенге; у фото блюда пусто. */
  section: string;
  portion: string;
  price: number | null;
  /** Блюдо каталога с таким же или почти таким же названием. */
  duplicate_of: { id: string; name: string } | null;
  pairings: AiPairing[];
}

export interface AiRecognition {
  kind: AiPhotoKind;
  summary: string;
  dishes: AiDishDraft[];
  mode: AiMode;
  model: string;
}

export interface DishImportItem {
  /** id блюда каталога, если берём существующее; иначе поля нового блюда. */
  dish?: string | null;
  name?: string;
  category?: string;
  cuisine?: CuisineType;
  dominant_taste?: TasteType;
  weight?: WeightType;
  fat_level?: FatType;
  cooking_method?: CookingMethod;
  description?: string;
  /** Цена и раздел для меню заведения; null - в меню не ставить. */
  menu?: { price: string | number; section: string; portion: string } | null;
  pairings?: { brand: string; compatibility_score: number; pairing_type: PairingType; explanation: string }[];
}

export interface DishImportRequest {
  /** slug или uuid заведения, в чьё меню встают блюда; null - только каталог. */
  venue: string | null;
  items: DishImportItem[];
}

export interface DishImportResult {
  dishes: Dish[];
  created: number;
  reused: number;
  menu_items: number;
  pairings: number;
  warnings: string[];
}

export interface AiPairingResult {
  dish: string;
  dish_name: string;
  /** 1-2 предложения о блюде; пусто, если считали по правилам. */
  analysis: string;
  pairings: AiPairing[];
  by_rules: boolean;
  /** Может ли текущий пользователь записать пары к этому блюду. */
  can_save?: boolean;
}

export interface AiPairingSaveItem {
  dish: string;
  brand: string;
  compatibility_score: number;
  pairing_type: PairingType;
  explanation: string;
}

export interface AiPairingSaveResult {
  saved: number;
  skipped: number;
  pairings: FoodPairing[];
}

export interface AiPairingSuggestions {
  results: AiPairingResult[];
  mode: AiMode;
  note: string;
  /** Сколько пар записано (при save). */
  saved: number;
}


/* Академия: путь из ступеней и уроки */

export type LessonAction = 'explorer' | 'pairing' | 'landing' | 'menu';

export type LessonBlock =
  | { type: 'text'; title?: string; text: string }
  | { type: 'facts'; title?: string; items: string[] }
  | { type: 'steps'; title?: string; items: { title: string; text: string }[] }
  | { type: 'tip'; text: string }
  | { type: 'check'; question: string; options: string[]; correct_index: number; explanation: string }
  | { type: 'practice'; text: string; action: LessonAction; label: string };

export interface LessonCard {
  id: string;
  slug: string;
  level: number;
  title: string;
  summary: string;
  minutes: number;
  done: boolean;
}

export interface Lesson extends LessonCard {
  level_display: string;
  blocks: LessonBlock[];
  next: { slug: string; title: string; level: number } | null;
}

export interface AcademyLevel {
  level: number;
  name: string;
  description: string;
  color: string;
  lessons: LessonCard[];
  /** Сколько вопросов в банке ступени и сколько из них в одном тесте. */
  questions: number;
  quiz_size: number;
  passed: boolean;
  best_percent: number | null;
}

export interface PassportRank {
  index: number;
  title: string;
  from: number;
  next_title: string | null;
  next_at: number | null;
  to_next: number;
}

export interface PointsBalance {
  earned: number;
  spent: number;
  balance: number;
  rank: PassportRank;
}

export interface Academy {
  pass_percent: number;
  points: { lesson: number; level: number };
  show_team: boolean;
  levels: AcademyLevel[];
  progress: {
    authenticated: boolean;
    lessons_done: number;
    lessons_total: number;
    passed_levels: number[];
    points: PointsBalance | null;
  };
}

export interface LessonCompleteResult {
  done: boolean;
  awarded: number;
  points: PointsBalance;
}


/* Паспорт вкуса: отметки сортов, баллы знаний, награды */

export interface NoteChip {
  id: string;
  name: string;
  icon: string;
  image?: string | null;
  category: PyramidLayer;
}

export interface BrandCard {
  id: string;
  name: string;
  style: string;
  image: string | null;
  accent_color: string;
  packaging_type: string;
}

export interface Tasting {
  id: string;
  brand: BrandCard;
  venue: { slug: string; name: string } | null;
  notes: NoteChip[];
  rating: number;
  comment: string;
  /** Сколько выбранных нот есть в пирамиде сомелье. */
  matched: number;
  created_at: string;
  updated_at: string;
}

export interface TastingRevealNote extends NoteChip {
  layer: PyramidLayer;
  intensity: number;
  heard: boolean;
}

export interface TastingReveal {
  pyramid: TastingRevealNote[];
  matched: number;
  total: number;
}

export interface TastingSheet {
  brand: BrandCard;
  palette: NoteChip[];
  max_notes: number;
  mine: Tasting | null;
  reveal: TastingReveal | null;
}

export interface TastingInput {
  rating: number;
  notes: string[];
  comment?: string;
  venue?: string;
}

export interface TastingSaved {
  tasting: Tasting;
  reveal: TastingReveal;
  awarded: number;
  points: PointsBalance;
}

export interface GuestsHeard {
  count: number;
  min: number;
  /** false, пока отметок меньше min: сводка не показывается. */
  enough: boolean;
  rating_avg: number | null;
  notes: (NoteChip & { share: number; in_pyramid: boolean })[];
}

export interface PassportBadge {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  earned: boolean;
}

export type RewardKind = 'FOOD' | 'SOFT' | 'MERCH' | 'EVENT';

export interface Reward {
  id: string;
  /** slug заведения или null для общей награды платформы. */
  venue: string | null;
  venue_name: string;
  title: string;
  description: string;
  kind: RewardKind;
  kind_display: string;
  cost: number;
  stock: number | null;
  is_active: boolean;
  created_at?: string;
}

export type RedemptionStatus = 'ISSUED' | 'USED' | 'CANCELLED';

export interface Redemption {
  id: string;
  title: string;
  cost: number;
  code: string;
  status: RedemptionStatus;
  status_display: string;
  venue: { slug: string; name: string } | null;
  kind: RewardKind | '';
  created_at: string;
  used_at: string | null;
  /** Только в выдаче для сотрудника. */
  guest?: string;
}

export interface Passport {
  points: { earned: number; spent: number; balance: number };
  rank: PassportRank;
  ranks: { title: string; from: number }[];
  breakdown: { kind: string; label: string; count: number; each: number; points: number }[];
  badges: PassportBadge[];
  tastings: Tasting[];
  brands_total: number;
  rules: {
    lesson: number; level: number; tasting: number; notes: number; feedback: number;
    notes_from: number; feedback_cap: number;
  };
  redemptions: Redemption[];
}

export interface PairingVotes {
  likes: number;
  dislikes: number;
  mine: boolean | null;
  awarded?: number;
  points?: PointsBalance;
}


/* Аналитика */

export interface VenueAnalytics {
  venue: { slug: string; name: string };
  period: { days: number; from: string; to: string };
  demo: { included: boolean; orders: number };
  totals: { orders: number; revenue: number; avg_check: number | null };
  pairing: {
    dish_orders: number;
    with_drink: number;
    with_pair: number;
    drink_rate: number | null;
    pair_rate: number | null;
    avg_food_only: number | null;
    avg_with_drink: number | null;
    avg_with_pair: number | null;
  };
  advice: { pairing: { qty: number; revenue: number }; ai: { qty: number; revenue: number } };
  drinks: {
    qty: number;
    draught_qty: number;
    draught_rate: number | null;
    top: { title: string; qty: number; revenue: number; draught: boolean }[];
  };
  dishes: { top: { title: string; qty: number; revenue: number }[]; unpaired: string[] };
  top_pairs: { dish: string; drink: string; orders: number; recommended: boolean; source: PairingSource | '' }[];
  feedback: { likes: number; dislikes: number };
  by_day: { day: string; orders: number; revenue: number; with_pair: number }[];
}

export interface BrandInsight extends BrandCard {
  tastings: number;
  rating_avg: number | null;
  matched_avg: number | null;
  favorites: number;
  ordered: number;
  pairings: number;
  ai_pairings: number;
  votes: number;
  liked_rate: number | null;
  heard: (NoteChip & { share: number; in_pyramid: boolean })[];
}

export interface BrandsAnalytics {
  min_guests: number;
  totals: {
    users: number; tasters: number; tastings: number; lessons_done: number; levels_passed: number;
    votes: number; pairings: number; ai_pairings: number;
  };
  brands: BrandInsight[];
}
