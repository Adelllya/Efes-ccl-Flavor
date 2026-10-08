import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { TimeoutError, throwError, timeout } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { API_BASE } from './api.service';

/** Обычный запрос к API: дольше ждать нет смысла, даже с холодным стартом сервера. */
const DEFAULT_MS = 30000;
/** Загрузка фото: файл до 5 МБ на мобильной сети. */
const UPLOAD_MS = 60000;
/** ИИ разбирает фото и подбирает пары: ответ модели может идти больше минуты. */
const AI_MS = 130000;

/**
 * Ограничивает время ожидания каждого запроса к API. Без этого запрос, на который сервер
 * не ответил, висит до закрытия вкладки, а страница показывает вечную «Загрузку...».
 * По истечении времени запрос отменяется и превращается в обычную ошибку связи (status 0),
 * которую страницы уже умеют показывать с кнопкой «Обновить».
 */
export const timeoutInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API_BASE)) return next(req);
  const limit = req.url.includes('/ai/') ? AI_MS : req.body instanceof FormData ? UPLOAD_MS : DEFAULT_MS;
  return next(req).pipe(
    timeout(limit),
    catchError((err: unknown) => {
      if (!(err instanceof TimeoutError)) return throwError(() => err);
      return throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Timeout', url: req.url }));
    }),
  );
};
