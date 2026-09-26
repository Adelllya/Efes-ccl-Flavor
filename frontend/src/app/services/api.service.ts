import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, EMPTY, of, throwError } from 'rxjs';
import { map, catchError, expand, reduce } from 'rxjs/operators';
import {
  Brand,
  Dish,
  FlavorNote,
  FoodPairing,
  Course,
  TeamMember,
  AdminFlavorProfilePayload,
  ServingRecommendation,
  FoodIcon,
  SiteSettings,
  Venue,
  VenueMenu,
  MenuItem,
  MenuDrink,
  Order,
  OrderInput,
  OrderStatus,
  AuthUser,
  UserRole,
  ChangeRequest,
  ChangeRequestInput,
  ChangeRequestApproved,
  RequestStatus,
  AiStatus,
  AiRequest,
  AiReply,
  PairFeedbackInput,
  PilotReport,
  QrLink
} from '../models/flavor-tree.models';
import { environment } from '../../environments/environment';

/** Локально http://127.0.0.1:8000/api, на проде /api на том же домене (src/environments). */
export const API_BASE = environment.apiBase;

export interface PaginatedResponse<T> {
  count: number;
  next?: string | null;
  results: T[];
}

export interface BrandFilters {
  style?: string;
  packaging_type?: string;
  is_horeca_only?: boolean;
  q?: string;
}

/** Пока админ не завёл настройки, витрина работает на этих. */
const DEFAULT_SETTINGS: SiteSettings = {
  alternatives_count: 3,
  min_score_to_show: 1,
  show_wheat_decor: true,
  pairing_intro: 'Мы разложили сорт на вкусовые ноты и нашли блюда, которые с ними совпадают.'
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private baseUrl = API_BASE;

  /**
   * Собирает все страницы ответа DRF.
   *
   * Блюд и пар в базе больше, чем помещается на одну страницу (по 20),
   * а подбору нужен весь список: иначе половина блюд просто не участвует
   * в рекомендациях. Ответ без пагинации (массив) тоже понимает.
   */
  fetchAll<T>(url: string, params: HttpParams = new HttpParams()): Observable<T[]> {
    return this.http.get<PaginatedResponse<T> | T[]>(url, { params }).pipe(
      expand(res => (!Array.isArray(res) && res.next) ? this.http.get<PaginatedResponse<T>>(res.next) : EMPTY),
      reduce((acc: T[], res) => acc.concat(Array.isArray(res) ? res : res.results || []), [])
    );
  }

  // 1. Бренды и сорта пива
  /** Публичные страницы: если бэкенд не отвечает, показываем демо-сорта. */
  getBrands(filters?: BrandFilters): Observable<Brand[]> {
    return this.getBrandsStrict(filters).pipe(
      catchError(() => of(this.getMockBrands()))
    );
  }

  /** Для панели: без заглушек, любая ошибка уходит вызывающему. */
  getBrandsStrict(filters?: BrandFilters): Observable<Brand[]> {
    let params = new HttpParams();
    if (filters?.style) params = params.set('style', filters.style);
    if (filters?.packaging_type) params = params.set('packaging_type', filters.packaging_type);
    if (filters?.is_horeca_only !== undefined) params = params.set('is_horeca_only', filters.is_horeca_only);
    if (filters?.q) params = params.set('q', filters.q);
    return this.fetchAll<Brand>(`${this.baseUrl}/brands/`, params);
  }

  /**
   * Демо-сорт подставляем только когда сервер недоступен (status 0).
   * 404 и 5xx уходят вызывающему: по устаревшей ссылке нельзя показывать чужой сорт.
   */
  getBrandDetail(id: string): Observable<Brand> {
    return this.getBrandDetailStrict(id).pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 0) {
          return of(this.getMockBrands().find(b => b.id === id) || this.getMockBrands()[0]);
        }
        return throwError(() => err);
      })
    );
  }

  /** Для панели: без заглушек. */
  getBrandDetailStrict(id: string): Observable<Brand> {
    return this.http.get<Brand>(`${this.baseUrl}/brands/${id}/`);
  }

  // 2. Вкусовые ноты
  /** Все страницы справочника: с одной страницы панель видела 20 нот из 67. */
  getFlavorNotes(category?: string): Observable<FlavorNote[]> {
    return this.getFlavorNotesStrict(category).pipe(
      catchError(() => of(this.getMockNotes()))
    );
  }

  /** Для панели: без заглушек. */
  getFlavorNotesStrict(category?: string): Observable<FlavorNote[]> {
    let params = new HttpParams();
    if (category) params = params.set('category', category);
    return this.fetchAll<FlavorNote>(`${this.baseUrl}/flavor-notes/`, params);
  }

  // 3. Блюда
  getDishes(filters?: {
    cuisine?: string;
    dominant_taste?: string;
    weight?: string;
    fat_level?: string;
    cooking_method?: string;
    category?: string;
    q?: string;
  }): Observable<Dish[]> {
    let params = new HttpParams();
    if (filters?.cuisine) params = params.set('cuisine', filters.cuisine);
    if (filters?.dominant_taste) params = params.set('dominant_taste', filters.dominant_taste);
    if (filters?.weight) params = params.set('weight', filters.weight);
    if (filters?.fat_level) params = params.set('fat_level', filters.fat_level);
    if (filters?.cooking_method) params = params.set('cooking_method', filters.cooking_method);
    if (filters?.category) params = params.set('category', filters.category);
    if (filters?.q) params = params.set('q', filters.q);

    return this.fetchAll<Dish>(`${this.baseUrl}/dishes/`, params).pipe(
      catchError(() => of(this.getMockDishes()))
    );
  }

  createDish(d: Partial<Dish>): Observable<Dish> {
    return this.http.post<Dish>(`${this.baseUrl}/dishes/`, d);
  }

  updateDish(id: string, d: Partial<Dish>): Observable<Dish> {
    return this.http.patch<Dish>(`${this.baseUrl}/dishes/${id}/`, d);
  }

  deleteDish(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/dishes/${id}/`);
  }

  /** Файл становится главным фото блюда. Ошибки формата и размера приходят как 400. */
  uploadDishImage(id: string, file: File): Observable<Dish> {
    const formData = new FormData();
    formData.append('image', file);
    return this.http.post<Dish>(`${this.baseUrl}/dishes/${id}/upload-image/`, formData);
  }

  /** Убирает загруженный файл; если у блюда есть image_url, показывается он. */
  deleteDishImage(id: string): Observable<Dish> {
    return this.http.delete<Dish>(`${this.baseUrl}/dishes/${id}/upload-image/`);
  }

  /** Картинки характеристик блюда из админки. Пусто - остаются emoji. */
  getFoodIcons(): Observable<FoodIcon[]> {
    return this.http.get<FoodIcon[]>(`${this.baseUrl}/food-icons/`).pipe(
      map(res => Array.isArray(res) ? res : []),
      catchError(() => of([] as FoodIcon[]))
    );
  }

  /** Настройки витрины: сколько сортов показывать, нужен ли декор. */
  getSettings(): Observable<SiteSettings> {
    return this.http.get<SiteSettings>(`${this.baseUrl}/settings/`).pipe(
      catchError(() => of(DEFAULT_SETTINGS))
    );
  }

  /** Только модератор. Ошибка уходит вызывающему. */
  updateSettings(s: Partial<SiteSettings>): Observable<SiteSettings> {
    return this.http.patch<SiteSettings>(`${this.baseUrl}/settings/`, s);
  }

  // 4. Сочетания блюд и сортов
  getPairings(filters?: {
    brand_id?: string;
    brand_name?: string;
    dish_id?: string;
    dish_name?: string;
    pairing_type?: string;
  }): Observable<FoodPairing[]> {
    let params = new HttpParams();
    if (filters?.brand_id) params = params.set('brand_id', filters.brand_id);
    if (filters?.brand_name) params = params.set('brand_name', filters.brand_name);
    if (filters?.dish_id) params = params.set('dish_id', filters.dish_id);
    if (filters?.dish_name) params = params.set('dish_name', filters.dish_name);
    if (filters?.pairing_type) params = params.set('pairing_type', filters.pairing_type);

    return this.fetchAll<FoodPairing>(`${this.baseUrl}/pairings/`, params).pipe(
      catchError(() => of(this.getMockPairings()))
    );
  }

  createPairing(p: Partial<FoodPairing>): Observable<FoodPairing> {
    return this.http.post<FoodPairing>(`${this.baseUrl}/pairings/`, p);
  }

  updatePairing(id: string, p: Partial<FoodPairing>): Observable<FoodPairing> {
    return this.http.patch<FoodPairing>(`${this.baseUrl}/pairings/${id}/`, p);
  }

  deletePairing(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/pairings/${id}/`);
  }

  // 5. Курсы и Команда
  getCourses(): Observable<Course[]> {
    return this.http.get<PaginatedResponse<Course> | Course[]>(`${this.baseUrl}/courses/`).pipe(
      map(res => Array.isArray(res) ? res : res.results || []),
      catchError(() => of(this.getMockCourses()))
    );
  }

  getTeam(): Observable<TeamMember[]> {
    return this.http.get<PaginatedResponse<TeamMember> | TeamMember[]>(`${this.baseUrl}/team/`).pipe(
      map(res => Array.isArray(res) ? res : res.results || []),
      catchError(() => of(this.getMockTeam()))
    );
  }

  // 6. Админ-эндпоинты сомелье. Ошибки записи уходят в панель, чтобы их показать.
  saveFlavorProfiles(payload: AdminFlavorProfilePayload & { replace?: boolean }): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/flavor-profiles/`, payload);
  }

  deleteFlavorProfile(brandId: string, flavorNoteId: string): Observable<any> {
    const params = new HttpParams().set('brand_id', brandId).set('flavor_note_id', flavorNoteId);
    return this.http.delete(`${this.baseUrl}/admin/flavor-profiles/`, { params });
  }

  saveServingRecommendation(brandId: string, rec: ServingRecommendation): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/serving-recommendations/`, { brand_id: brandId, ...rec });
  }

  /** Одно фото: сервер кладёт оригинал в image_hd и сам делает уменьшенную image. */
  uploadBrandImage(brandId: string, file: File): Observable<Brand> {
    const formData = new FormData();
    formData.append('image', file);
    return this.http.post<Brand>(`${this.baseUrl}/brands/${brandId}/upload-image/`, formData);
  }

  /** Убирает оба файла сорта: оригинал и уменьшенную версию. */
  deleteBrandImage(brandId: string): Observable<Brand> {
    return this.http.delete<Brand>(`${this.baseUrl}/brands/${brandId}/upload-image/`);
  }

  // 7. Заведения и электронное меню. Без заглушек: ошибка уходит вызывающему.
  getVenues(): Observable<Venue[]> {
    return this.fetchAll<Venue>(`${this.baseUrl}/venues/`);
  }

  /** Заведения текущего пользователя (модератор получает все). Нужен токен. */
  getMyVenues(): Observable<Venue[]> {
    return this.fetchAll<Venue>(`${this.baseUrl}/venues/mine/`);
  }

  getVenue(slug: string): Observable<Venue> {
    return this.http.get<Venue>(`${this.baseUrl}/venues/${slug}/`);
  }

  getVenueMenu(slug: string): Observable<VenueMenu> {
    return this.http.get<VenueMenu>(`${this.baseUrl}/venues/${slug}/menu/`);
  }

  createVenue(v: Partial<Venue> & { owner?: number | null }): Observable<Venue> {
    return this.http.post<Venue>(`${this.baseUrl}/venues/`, v);
  }

  updateVenue(slug: string, v: Partial<Venue>): Observable<Venue> {
    return this.http.patch<Venue>(`${this.baseUrl}/venues/${slug}/`, v);
  }

  uploadVenueLogo(slug: string, file: File): Observable<Venue> {
    const formData = new FormData();
    formData.append('image', file);
    return this.http.post<Venue>(`${this.baseUrl}/venues/${slug}/upload-logo/`, formData);
  }

  deleteVenueLogo(slug: string): Observable<Venue> {
    return this.http.delete<Venue>(`${this.baseUrl}/venues/${slug}/upload-logo/`);
  }

  /** venue: uuid или slug заведения. */
  getMenuItems(venue: string): Observable<MenuItem[]> {
    const params = new HttpParams().set('venue', venue);
    return this.fetchAll<MenuItem>(`${this.baseUrl}/menu-items/`, params);
  }

  createMenuItem(m: Partial<MenuItem>): Observable<MenuItem> {
    return this.http.post<MenuItem>(`${this.baseUrl}/menu-items/`, m);
  }

  updateMenuItem(id: string, m: Partial<MenuItem>): Observable<MenuItem> {
    return this.http.patch<MenuItem>(`${this.baseUrl}/menu-items/${id}/`, m);
  }

  deleteMenuItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/menu-items/${id}/`);
  }

  // 7a. Карта бара: напитки заведения с ценой и объёмом
  /** venue: uuid или slug заведения. */
  getMenuDrinks(venue: string): Observable<MenuDrink[]> {
    const params = new HttpParams().set('venue', venue);
    return this.fetchAll<MenuDrink>(`${this.baseUrl}/menu-drinks/`, params);
  }

  createMenuDrink(m: Partial<MenuDrink>): Observable<MenuDrink> {
    return this.http.post<MenuDrink>(`${this.baseUrl}/menu-drinks/`, m);
  }

  updateMenuDrink(id: string, m: Partial<MenuDrink>): Observable<MenuDrink> {
    return this.http.patch<MenuDrink>(`${this.baseUrl}/menu-drinks/${id}/`, m);
  }

  deleteMenuDrink(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/menu-drinks/${id}/`);
  }

  // 7b. Заказы гостей. Создание и чтение по токену открыты без входа.
  createOrder(body: OrderInput): Observable<Order> {
    return this.http.post<Order>(`${this.baseUrl}/orders/`, body);
  }

  /** Гость читает свой заказ по guest_token из ответа createOrder. */
  getGuestOrder(id: string, token: string): Observable<Order> {
    const params = new HttpParams().set('token', token);
    return this.http.get<Order>(`${this.baseUrl}/orders/${id}/`, { params });
  }

  /** Владелец заведения или модератор: заказы заведения, новые сверху. */
  getOrders(venue: string, status?: OrderStatus): Observable<Order[]> {
    let params = new HttpParams().set('venue', venue);
    if (status) params = params.set('status', status);
    return this.fetchAll<Order>(`${this.baseUrl}/orders/`, params);
  }

  /** Переходы NEW > ACCEPTED > COOKING > SERVED > DONE, любой незакрытый > CANCELLED; иначе 400. */
  updateOrderStatus(id: string, status: OrderStatus): Observable<Order> {
    return this.http.patch<Order>(`${this.baseUrl}/orders/${id}/`, { status });
  }

  /** Число новых заказов для бейджа в панели. Без venue сервер считает по всем заведениям, которые видит пользователь. */
  getNewOrderCount(venue?: string): Observable<number> {
    let params = new HttpParams();
    if (venue) params = params.set('venue', venue);
    return this.http.get<{ count: number }>(`${this.baseUrl}/orders/new-count/`, { params }).pipe(
      map(res => res?.count ?? 0)
    );
  }

  // 7c. Пилот в баре

  /** Гость оценивает пару после заказа. Без входа; ответ 201 {id, rating}. */
  submitFeedback(body: PairFeedbackInput): Observable<{ id: number; rating: number }> {
    return this.http.post<{ id: number; rating: number }>(`${this.baseUrl}/feedback/`, body);
  }

  /** Цифры пилота: владелец видит своё заведение, модератор любое или все сразу (без venue). */
  getPilotReport(venue?: string | null, from?: string, to?: string): Observable<PilotReport> {
    let params = new HttpParams();
    if (venue) params = params.set('venue', venue);
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<PilotReport>(`${this.baseUrl}/pilot/report/`, { params });
  }

  /** CSV для Excel. Нужен токен, поэтому качаем через HttpClient, а не обычной ссылкой. */
  downloadPilotCsv(kind: 'events' | 'orders' | 'feedback', venue?: string | null, from?: string, to?: string): Observable<Blob> {
    let params = new HttpParams().set('kind', kind);
    if (venue) params = params.set('venue', venue);
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get(`${this.baseUrl}/pilot/export.csv`, { params, responseType: 'blob' });
  }

  /** SVG с QR стола. Через HttpClient с токеном: так печатаются и коды скрытого заведения. */
  getTableQr(slug: string, table: number): Observable<Blob> {
    const params = new HttpParams().set('table', table);
    return this.http.get(`${this.baseUrl}/venues/${slug}/qr.svg`, { params, responseType: 'blob' });
  }

  /** Какая ссылка окажется в QR: проверка адреса сайта перед печатью. */
  getQrLink(slug: string, table?: number): Observable<QrLink> {
    let params = new HttpParams();
    if (table) params = params.set('table', table);
    return this.http.get<QrLink>(`${this.baseUrl}/venues/${slug}/qr-link/`, { params });
  }

  // 8. Пользователи, только модератор
  getUsers(): Observable<AuthUser[]> {
    return this.fetchAll<AuthUser>(`${this.baseUrl}/auth/users/`);
  }

  updateUser(id: number, patch: { role?: UserRole; venue?: string | null; is_active?: boolean }): Observable<AuthUser> {
    return this.http.patch<AuthUser>(`${this.baseUrl}/auth/users/${id}/`, patch);
  }

  // 9. Запросы сомелье на изменение сорта. Сомелье видит свои, модератор все.
  getChangeRequests(filters?: { status?: RequestStatus; brand?: string }): Observable<ChangeRequest[]> {
    let params = new HttpParams();
    if (filters?.status) params = params.set('status', filters.status);
    if (filters?.brand) params = params.set('brand', filters.brand);
    return this.fetchAll<ChangeRequest>(`${this.baseUrl}/change-requests/`, params);
  }

  createChangeRequest(body: ChangeRequestInput): Observable<ChangeRequest> {
    return this.http.post<ChangeRequest>(`${this.baseUrl}/change-requests/`, body);
  }

  /** Автор отзывает свой ожидающий запрос; модератор может удалить любой. */
  deleteChangeRequest(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/change-requests/${id}/`);
  }

  /** Только модератор. В ответе ещё и пирамида сорта после применения. */
  approveChangeRequest(id: string, review_comment?: string): Observable<ChangeRequestApproved> {
    const body = review_comment ? { review_comment } : {};
    return this.http.post<ChangeRequestApproved>(`${this.baseUrl}/change-requests/${id}/approve/`, body);
  }

  rejectChangeRequest(id: string, review_comment: string): Observable<ChangeRequest> {
    return this.http.post<ChangeRequest>(`${this.baseUrl}/change-requests/${id}/reject/`, { review_comment });
  }

  /** Число ожидающих запросов для бейджа в панели модератора. */
  getPendingRequestCount(): Observable<number> {
    return this.http.get<{ count: number }>(`${this.baseUrl}/change-requests/pending-count/`).pipe(
      map(res => res?.count ?? 0)
    );
  }

  // 10. ИИ-сомелье. Открыт без входа; ошибки уходят в чат, там есть повтор.
  getAiStatus(): Observable<AiStatus> {
    return this.http.get<AiStatus>(`${this.baseUrl}/ai/status/`);
  }

  askSommelier(body: AiRequest): Observable<AiReply> {
    return this.http.post<AiReply>(`${this.baseUrl}/ai/sommelier/`, body);
  }

  // Заглушки на случай, если бэкенд не отвечает
  private getMockNotes(): FlavorNote[] {
    return [
      { id: 'n1', name: 'Свежесть', category: 'TOP', icon: '🌿' },
      { id: 'n2', name: 'Хмелевой аромат', category: 'TOP', icon: '🍃' },
      { id: 'n3', name: 'Цветочные ноты', category: 'TOP', icon: '🌸' },
      { id: 'n4', name: 'Солод', category: 'HEART', icon: '🌾' },
      { id: 'n5', name: 'Солодовая плотность', category: 'HEART', icon: '🍞' },
      { id: 'n6', name: 'Карамель', category: 'HEART', icon: '🍯' },
      { id: 'n7', name: 'Хмелевая горчинка', category: 'BASE', icon: '⚡' },
      { id: 'n8', name: 'Освежающий финиш', category: 'BASE', icon: '❄️' }
    ];
  }

  private getMockBrands(): Brand[] {
    return [
      {
        id: 'b1',
        name: 'Efes Pilsener',
        style: 'Pilsner',
        abv: 5.0,
        density: '12%',
        packaging_type: 'BOTTLE',
        packaging_type_display: 'Бутылка',
        is_horeca_only: false,
        is_active: true,
        description: 'Флагманская марка Efes Beer Group с благородным хмелевым ароматом и освежающим сухим финишем.',
        serving_recommendation: {
          serving_temp_min: 5,
          serving_temp_max: 7,
          glass_type: 'Пилснер / Тюльпан',
          seasonality: 'Круглый год'
        },
        pyramid: {
          top: [
            { id: 'n2', name: 'Хмелевой аромат', icon: '🍃', description: 'Свежий благородный хмель', intensity: 6, sommelier_note: 'Благородный хмель европейского типа' },
            { id: 'n3', name: 'Цветочные ноты', icon: '🌸', description: 'Тонкие луговые цветы', intensity: 4, sommelier_note: 'Изящные цветочные тона' }
          ],
          heart: [
            { id: 'n5', name: 'Солодовая плотность', icon: '🍞', description: 'Плотный солод', intensity: 6, sommelier_note: 'Полнотелый насыщенный солод' }
          ],
          base: [
            { id: 'n7', name: 'Хмелевая горчинка', icon: '⚡', description: 'Освежающая горечь', intensity: 7, sommelier_note: 'Выразительная пилснеровская горечь' },
            { id: 'n8', name: 'Освежающий финиш', icon: '❄️', description: 'Быстрое чистое завершение', intensity: 7, sommelier_note: 'Фирменное сухое послевкусие Efes' }
          ]
        }
      },
      {
        id: 'b2',
        name: 'Кружка Свежего',
        style: 'Lager (draft-style)',
        abv: 4.5,
        density: '11%',
        packaging_type: 'BOTTLE',
        packaging_type_display: 'Бутылка',
        is_horeca_only: false,
        is_active: true,
        description: 'Разливное пиво в бутылочном формате, сваренное по классическому рецепту.',
        serving_recommendation: {
          serving_temp_min: 4,
          serving_temp_max: 7,
          glass_type: 'Кружка / Пинта',
          seasonality: 'Круглый год'
        },
        pyramid: {
          top: [{ id: 'n1', name: 'Свежесть', icon: '🌿', description: 'Чистота и свежесть', intensity: 6, sommelier_note: 'Яркий свежий вдох разливного формата' }],
          heart: [{ id: 'n4', name: 'Солод', icon: '🌾', description: 'Светлый ячменный солод', intensity: 5, sommelier_note: 'Классический ячменный солод' }],
          base: [{ id: 'n8', name: 'Освежающий финиш', icon: '❄️', description: 'Чистый сход', intensity: 5, sommelier_note: 'Быстрое утоление жажды' }]
        }
      }
    ];
  }

  private getMockDishes(): Dish[] {
    return [
      { id: 'd1', name: 'Бешбармак', cuisine: 'KZ', category: 'Мясное', dominant_taste: 'UMAMI', weight: 'HEAVY', fat_level: 'HIGH', cooking_method: 'BOILED', description: 'Традиционное главное блюдо казахской кухни из отварного мяса и тонкого сочня' },
      { id: 'd2', name: 'Казы', cuisine: 'KZ', category: 'Мясное (конская колбаса)', dominant_taste: 'SALTY', weight: 'HEAVY', fat_level: 'HIGH', cooking_method: 'CURED', description: 'Деликатесная сыровяленая конская колбаса с чесноком и черным перцем' },
      { id: 'd3', name: 'Пицца Маргарита', cuisine: 'ITALIAN', category: 'Пицца', dominant_taste: 'UMAMI', weight: 'MEDIUM', fat_level: 'MEDIUM', cooking_method: 'BAKED', description: 'Классическая неаполитанская пицца с томатами, моцареллой и базиликом' },
      { id: 'd4', name: 'Братвурст (сосиски)', cuisine: 'GERMAN', category: 'Колбасы/Гриль', dominant_taste: 'SALTY', weight: 'HEAVY', fat_level: 'HIGH', cooking_method: 'GRILLED', description: 'Традиционные немецкие колбаски из свинины на гриле' }
    ];
  }

  private getMockPairings(): FoodPairing[] {
    return [
      {
        id: 'p1',
        brand: 'b1',
        brand_name: 'Efes Pilsener',
        dish: 'd2',
        dish_name: 'Казы',
        pairing_type: 'CONTRAST',
        pairing_type_display: 'Контрастирует (Contrast)',
        compatibility_score: 5,
        explanation: 'Высокая base-горечь пильзнера режет жирность вяленого мяса'
      },
      {
        id: 'p2',
        brand: 'b1',
        brand_name: 'Efes Pilsener',
        dish: 'd3',
        dish_name: 'Пицца Маргарита',
        pairing_type: 'CONTRAST',
        pairing_type_display: 'Контрастирует (Contrast)',
        compatibility_score: 4,
        explanation: 'Хмелевая горчинка режет сырную жирность'
      }
    ];
  }

  private getMockCourses(): Course[] {
    return [
      { id: 'c1', level: 1, level_display: 'Новичок', title: 'Сенсорный старт: Анатомия вкуса', description: 'Учимся различать базовые вкусы, температуру подачи и влияние бокала на аромат.' },
      { id: 'c2', level: 2, level_display: 'Исследователь', title: 'Архитектура Вкусовой Пирамиды', description: 'Разбор нот 0-3 сек (Top), 3-15 сек (Heart) и послевкусия (Base).' },
      { id: 'c3', level: 3, level_display: 'Знаток', title: 'Искусство сочетаний: что подать к блюду', description: '4 золотых правила сочетания блюда и напитка: Complement, Contrast, Cleanse, Bridge.' },
      { id: 'c4', level: 4, level_display: 'Сомелье', title: 'Мастер Пивной Сомелье', description: 'Дефекты вкуса (off-flavours), составление дегустационных карт и сертификация.' }
    ];
  }

  private getMockTeam(): TeamMember[] {
    return [
      { id: 't1', name: 'Главный Сомелье Efes', role: 'Шеф-сомелье проекта', bio: 'Пиво - это симфония зерна, воды и хмеля, где каждая секунда глотка открывает новую главу.' }
    ];
  }
}
