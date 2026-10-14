import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './services/auth.interceptor';
import { timeoutInterceptor } from './services/timeout.interceptor';
import { localeInterceptor } from './i18n/locale.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withFetch(), withInterceptors([timeoutInterceptor, localeInterceptor, authInterceptor]))
  ]
};
