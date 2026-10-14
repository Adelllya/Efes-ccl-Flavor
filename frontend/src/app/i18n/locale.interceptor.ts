import { HttpInterceptorFn } from '@angular/common/http';
import { CURRENT_LANG } from './lang-storage';

/**
 * Движок подбора v2 отдаёт названия блюд, категории и объяснения на языке из ?locale=ru|en.
 * Подставляем язык интерфейса во все запросы к /api/v2/, если вызывающий код не указал свой.
 */
export const localeInterceptor: HttpInterceptorFn = (req, next) => {
  if (!/\/api\/v2\//.test(req.url) || req.params.has('locale') || /[?&]locale=/.test(req.url)) return next(req);
  return next(req.clone({ params: req.params.set('locale', CURRENT_LANG) }));
};
