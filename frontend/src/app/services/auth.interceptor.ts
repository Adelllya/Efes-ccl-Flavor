import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { API_BASE } from './api.service';
import { AuthService } from './auth.service';
import { TokenStore } from './token.store';

/** Вход и регистрация без токена: иначе протухший токен из хранилища ломает сам вход. */
const PUBLIC_AUTH_URLS = [`${API_BASE}/auth/login/`, `${API_BASE}/auth/register/`];

/**
 * Запрос к нашему API: тот же origin и путь под API_BASE.
 * На проде API_BASE относительный (/api), а ссылки пагинации DRF (next) приходят
 * абсолютными, поэтому сравниваем разобранные адреса, а не строки.
 */
function isApiRequest(url: string): boolean {
  const base = new URL(API_BASE, location.origin);
  const target = new URL(url, location.origin);
  return target.origin === base.origin && target.pathname.startsWith(base.pathname);
}

/**
 * Подставляет токен из TokenStore в запросы к API.
 *
 * Если сервер ответил 401 на токен из хранилища, значит он протух:
 * сбрасываем сессию и повторяем тот же запрос без заголовка, чтобы
 * публичные страницы не ломались. DRF проверяет токен до вызова view,
 * поэтому повтор безопасен и для записи: первый запрос ничего не сделал.
 *
 * AuthService берём через Injector только в момент ошибки: его конструктор
 * сам делает запрос, и синхронный inject здесь дал бы циклическую зависимость.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiRequest(req.url)) return next(req);
  // Явный заголовок (logout) не трогаем
  if (req.headers.has('Authorization') || PUBLIC_AUTH_URLS.includes(req.url)) return next(req);

  const store = inject(TokenStore);
  const injector = inject(Injector);
  const token = store.token();
  if (!token) return next(req);

  return next(req.clone({ setHeaders: { Authorization: `Token ${token}` } })).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      // не трогаем сессию, если пользователь уже успел войти заново
      if (store.token() === token) injector.get(AuthService).clearSession();
      return next(req);
    })
  );
};
