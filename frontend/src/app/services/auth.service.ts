import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError, timer } from 'rxjs';
import { catchError, map, retry, tap } from 'rxjs/operators';
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
  /** Согласие с /privacy: без true сервер отвечает 400. */
  consent: boolean;
}

/** Какие вкладки панели открыты каждой роли. */
export const PANEL_ACCESS: Record<UserRole, readonly PanelTab[]> = {
  user: [],
  waiter: [],
  sommelier: ['overview', 'brands', 'pairings', 'notes', 'engine', 'analytics', 'quiz'],
  restaurant_admin: ['overview', 'dishes', 'menu', 'orders', 'pilot', 'analytics', 'rewards'],
  moderator: [
    'overview', 'brands', 'pairings', 'notes', 'dishes', 'menu', 'orders', 'pilot', 'engine', 'analytics', 'rewards',
    'users', 'settings', 'requests', 'quiz'
  ]
};

/** Старые вкладки pyramid и serving стали частями вкладки brands. */
const TAB_ALIASES: Partial<Record<PanelTab, PanelTab>> = {
  pyramid: 'brands',
  serving: 'brands'
};

/** Подписи полей для сообщений об ошибках с сервера. */
export const FIELD_LABELS: Record<string, string> = {
  username: 'Username',
  email: 'Email',
  password: 'Password',
  first_name: 'First name',
  consent: 'Consent',
  old_password: 'Current password',
  new_password: 'New password',
  role: 'Role',
  venue: 'Venue',
  owner: 'Owner',
  name: 'Name',
  price: 'Price',
  dish: 'Dish',
  brand: 'Beer',
  image: 'Photo',
  image_url: 'Photo URL',
  logo: 'Logo',
  logo_url: 'Logo URL',
  file: 'File',
  kind: 'Request type',
  payload: 'Request data',
  comment: 'Comment',
  review_comment: 'Moderator comment',
  flavor_note_id: 'Note',
  layer: 'Layer',
  intensity: 'Intensity',
  sommelier_note: 'Sommelier note',
  serving_temp_min: 'Min. temperature',
  serving_temp_max: 'Max. temperature',
  glass_type: 'Glass',
  seasonality: 'Season',
  cover: 'Cover image URL',
  phone: 'Phone',
  working_hours: 'Opening hours',
  address: 'Address',
  city: 'City',
  description: 'Description',
  category: 'Category',
  section: 'Menu section',
  portion: 'Portion',
  sort_order: 'Sort order',
  chef_note: 'Chef note',
  alternatives_count: 'Number of beers to show',
  min_score_to_show: 'Minimum score',
  pairing_intro: 'Intro text',
  venue_type: 'Venue type',
  is_published: 'Visible to guests',
  tables_count: 'Number of tables',
  volume: 'Volume',
  table_number: 'Table number',
  guest_name: 'Guest name',
  items: 'Order items',
  qty: 'Quantity',
  note: 'Note',
  status: 'Status',
  is_available: 'Available',
  accepts_orders: 'Accepting orders',
  rating: 'Rating',
  text: 'Question',
  options: 'Answer options',
  correct_index: 'Correct answer',
  explanation: 'Why the pairing works',
  is_active: 'Show in quiz',
  level: 'Level',
  taste: 'Taste',
  cuisines: 'Cuisines',
  favorite_brands: 'Favorite beers',
  answers: 'Answers'
};

/** Длиннее этого сервер по-человечески не пишет: скорее всего, это трассировка или HTML. */
const MAX_MESSAGE_LENGTH = 300;

/** Сколько раз повторить проверку сессии, если сервер не ответил, и пауза перед первым повтором. */
const ME_RETRIES = 2;
const ME_RETRY_DELAY_MS = 1500;

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

  /**
   * Сообщает серверу и чистит состояние сразу, ответа не ждём. Переход на вход делает AppComponent.
   * Обычный выход не трогает другие устройства (например, планшет бара под тем же аккаунтом),
   * everywhere=true отзывает токен и на них.
   */
  logout(everywhere = false): void {
    const token = this.store.token();
    if (token) {
      const body = everywhere ? { everywhere: true } : {};
      this.http.post(`${API_BASE}/auth/logout/`, body, { headers: { Authorization: `Token ${token}` } })
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
    const rejected = (err: unknown) => err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403);
    this.http.get<AuthUser>(`${API_BASE}/auth/me/`).pipe(
      // Холодный старт сервера или обрыв сети: сессия цела, просто ответа нет. Пробуем ещё пару раз
      // и до конца попыток держим ready = false, иначе вошедшего пользователя уводило на вход.
      // Отказ по токену и смену токена повтор не лечит.
      retry({
        count: ME_RETRIES,
        delay: (err: unknown, attempt: number) =>
          rejected(err) || this.store.token() !== token ? throwError(() => err) : timer(ME_RETRY_DELAY_MS * attempt)
      })
    ).subscribe({
      next: user => {
        // пока ждали ответ, токен сменился: этот ответ уже не про нас
        if (this.store.token() !== token) return;
        this.user.set(user);
        this.ready.set(true);
      },
      error: (err: unknown) => {
        if (this.store.token() !== token) return;
        // 401 уже сбросил токен в интерцепторе; сеть недоступна - токен оставляем
        if (rejected(err)) this.clearSession();
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
      if (err.status === 0) return 'Can’t reach the server. Check your connection and try again.';
      const text = AuthService.bodyText(err.error);
      if (text) return text;
      if (err.status === 401) return 'Please sign in to continue';
      if (err.status === 403) return 'You don’t have permission to do this';
      if (err.status === 404) return 'Not found';
      if (err.status === 413) return 'The file is too large';
      return `Server error ${err.status}`;
    }
    if (err instanceof Error) return err.message;
    return 'Unknown error';
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
