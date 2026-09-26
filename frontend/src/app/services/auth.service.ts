import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { API_BASE } from './api.service';
import { TokenStore } from './token.store';
import { AuthResponse, AuthUser, UserRole } from '../models/flavor-tree.models';
import { PanelTab } from '../models/navigation';

export type { PanelTab } from '../models/navigation';
export { TOKEN_KEY, readStoredToken } from './token.store';

export interface RegisterData {
  username: string;
  email: string;
  password: string;
  first_name?: string;
}

/** Какие вкладки панели открыты каждой роли. */
export const PANEL_ACCESS: Record<UserRole, readonly PanelTab[]> = {
  user: [],
  sommelier: ['overview', 'brands', 'pairings', 'engine'],
  restaurant_admin: ['overview', 'dishes', 'menu', 'orders', 'pilot'],
  moderator: ['overview', 'brands', 'pairings', 'notes', 'dishes', 'menu', 'orders', 'pilot', 'engine', 'users', 'settings', 'requests']
};

/** Старые вкладки pyramid и serving стали частями вкладки brands. */
const TAB_ALIASES: Partial<Record<PanelTab, PanelTab>> = {
  pyramid: 'brands',
  serving: 'brands'
};

/** Подписи полей для сообщений об ошибках с сервера. */
export const FIELD_LABELS: Record<string, string> = {
  username: 'Логин',
  email: 'Email',
  password: 'Пароль',
  first_name: 'Имя',
  old_password: 'Старый пароль',
  new_password: 'Новый пароль',
  role: 'Роль',
  venue: 'Заведение',
  owner: 'Владелец',
  name: 'Название',
  price: 'Цена',
  dish: 'Блюдо',
  brand: 'Сорт',
  image: 'Фото',
  image_url: 'Ссылка на фото',
  logo: 'Логотип',
  logo_url: 'Ссылка на логотип',
  file: 'Файл',
  kind: 'Тип запроса',
  payload: 'Данные запроса',
  comment: 'Комментарий',
  review_comment: 'Комментарий модератора',
  flavor_note_id: 'Нота',
  layer: 'Слой',
  intensity: 'Интенсивность',
  sommelier_note: 'Комментарий сомелье',
  serving_temp_min: 'Температура от',
  serving_temp_max: 'Температура до',
  glass_type: 'Бокал',
  seasonality: 'Сезон',
  cover: 'Ссылка на обложку',
  phone: 'Телефон',
  working_hours: 'Часы работы',
  address: 'Адрес',
  city: 'Город',
  description: 'Описание',
  category: 'Категория',
  section: 'Раздел меню',
  portion: 'Порция',
  sort_order: 'Порядок',
  chef_note: 'Комментарий повара',
  alternatives_count: 'Сколько сортов показывать',
  min_score_to_show: 'Минимальная оценка',
  pairing_intro: 'Вступительный текст',
  venue_type: 'Тип заведения',
  is_published: 'Показывать гостям',
  tables_count: 'Количество столов',
  volume: 'Объём',
  table_number: 'Номер стола',
  guest_name: 'Имя гостя',
  items: 'Позиции заказа',
  qty: 'Количество',
  note: 'Примечание',
  status: 'Статус',
  is_available: 'В наличии',
  accepts_orders: 'Приём заказов',
  rating: 'Оценка'
};

/** Длиннее этого сервер по-человечески не пишет: скорее всего, это трассировка или HTML. */
const MAX_MESSAGE_LENGTH = 300;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private store = inject(TokenStore);
  /** Токен, для которого загружен user(). Отличает свою запись от смены токена из другой вкладки. */
  private loadedToken: string | null = null;

  readonly user = signal<AuthUser | null>(null);
  /** true, когда первичная проверка токена закончилась или токена нет. */
  readonly ready = signal(false);

  readonly role = computed<UserRole | null>(() => this.user()?.role ?? null);
  readonly isLoggedIn = computed(() => this.user() !== null);
  readonly canSeePanel = computed(() => {
    const r = this.role();
    return r === 'sommelier' || r === 'restaurant_admin' || r === 'moderator';
  });

  constructor() {
    this.loadMe();
    // Токен сменился снаружи (вход или выход в другой вкладке): подтягиваем или сбрасываем пользователя
    effect(() => {
      const token = this.store.token();
      if (token === this.loadedToken) return;
      untracked(() => token ? this.loadMe() : this.clearSession());
    }, { allowSignalWrites: true });
  }

  /** Текущий токен из общего хранилища. */
  getToken(): string | null {
    return this.store.token();
  }

  can(tab: PanelTab): boolean {
    const r = this.role();
    if (r === null) return false;
    return PANEL_ACCESS[r].includes(TAB_ALIASES[tab] ?? tab);
  }

  login(username: string, password: string): Observable<AuthUser> {
    return this.http.post<AuthResponse>(`${API_BASE}/auth/login/`, { username, password }).pipe(
      tap(res => this.setSession(res)),
      map(res => res.user)
    );
  }

  register(data: RegisterData): Observable<AuthUser> {
    return this.http.post<AuthResponse>(`${API_BASE}/auth/register/`, data).pipe(
      tap(res => this.setSession(res)),
      map(res => res.user)
    );
  }

  /** Сообщает серверу и чистит состояние сразу, ответа не ждём. Переход на вход делает AppComponent. */
  logout(): void {
    const token = this.store.token();
    if (token) {
      this.http.post(`${API_BASE}/auth/logout/`, {}, { headers: { Authorization: `Token ${token}` } })
        .pipe(catchError(() => of(null)))
        .subscribe();
    }
    this.clearSession();
  }

  loadMe(): void {
    const token = this.store.token();
    this.loadedToken = token;
    if (!token) {
      this.user.set(null);
      this.ready.set(true);
      return;
    }
    this.http.get<AuthUser>(`${API_BASE}/auth/me/`).subscribe({
      next: user => {
        // пока ждали ответ, токен сменился: этот ответ уже не про нас
        if (this.store.token() !== token) return;
        this.user.set(user);
        this.ready.set(true);
      },
      error: (err: unknown) => {
        if (this.store.token() !== token) return;
        // 401 уже сбросил токен в интерцепторе; сеть недоступна - токен оставляем
        if (err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403)) this.clearSession();
        this.ready.set(true);
      }
    });
  }

  updateProfile(patch: { first_name?: string; email?: string }): Observable<AuthUser> {
    return this.http.patch<AuthUser>(`${API_BASE}/auth/me/`, patch).pipe(
      tap(user => this.user.set(user))
    );
  }

  changePassword(oldPassword: string, newPassword: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${API_BASE}/auth/change-password/`, {
      old_password: oldPassword,
      new_password: newPassword
    }).pipe(
      tap(res => this.setToken(res.token))
    );
  }

  /** Сбрасывает токен и пользователя. Вызывается интерцептором на 401. */
  clearSession(): void {
    this.setToken(null);
    this.user.set(null);
    this.ready.set(true);
  }

  private setSession(res: AuthResponse): void {
    this.setToken(res.token);
    this.user.set(res.user);
    this.ready.set(true);
  }

  private setToken(token: string | null): void {
    // loadedToken ставим до записи в store, чтобы эффект не запустил лишний loadMe
    this.loadedToken = token;
    this.store.set(token);
  }

  /** Превращает ответ DRF ({detail} | {field: [..]} | {errors: {...}}) в одну строку. */
  static errorText(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Сервер недоступен. Проверьте, запущен ли бэкенд.';
      const text = AuthService.bodyText(err.error);
      if (text) return text;
      if (err.status === 401) return 'Нужно войти в аккаунт';
      if (err.status === 403) return 'Недостаточно прав';
      if (err.status === 404) return 'Не найдено';
      if (err.status === 413) return 'Файл слишком большой';
      return `Сервер вернул ошибку ${err.status}`;
    }
    if (err instanceof Error) return err.message;
    return 'Неизвестная ошибка';
  }

  /** HTML-страницы ошибок Django и прочие сырые ответы пользователю не показываем. */
  private static plainText(value: string): string {
    const text = value.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) return '';
    if (/^</.test(text) || /<\/?(html|body|head|!doctype)\b/i.test(text)) return '';
    return text;
  }

  private static bodyText(body: unknown): string {
    if (!body) return '';
    if (typeof body === 'string') return AuthService.plainText(body);
    // SyntaxError от JSON.parse, когда сервер ответил HTML
    if (body instanceof Error) return '';
    if (Array.isArray(body)) return AuthService.plainText(body.map(String).join(' '));
    if (typeof body !== 'object') return '';
    const obj = body as Record<string, unknown>;
    // XHR-бэкенд кладёт нераспарсенный ответ как { error: SyntaxError, text: '<html>...' }
    if (obj['error'] instanceof Error) return '';
    if (typeof obj['detail'] === 'string') return AuthService.plainText(obj['detail']);
    // Часть эндпоинтов отвечает {error: '...'} вместо {detail}
    if (typeof obj['error'] === 'string') return AuthService.plainText(obj['error']);
    if (obj['errors'] && typeof obj['errors'] === 'object') return AuthService.bodyText(obj['errors']);
    const parts: string[] = [];
    for (const [field, value] of Object.entries(obj)) {
      const raw = Array.isArray(value)
        ? value.map(String).join(' ')
        : (value && typeof value === 'object') ? AuthService.bodyText(value) : String(value);
      const msg = AuthService.plainText(raw);
      if (!msg) continue;
      if (field === 'non_field_errors' || field === 'detail' || field === 'error') parts.push(msg);
      else parts.push(`${FIELD_LABELS[field] ?? field}: ${msg}`);
    }
    return parts.join(' ');
  }
}
