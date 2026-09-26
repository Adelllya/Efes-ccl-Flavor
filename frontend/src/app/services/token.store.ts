import { Injectable, signal } from '@angular/core';

export const TOKEN_KEY = 'ft_token';

/** localStorage может быть недоступен (приватный режим, отключённые данные сайта). */
export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // без хранилища сессия живёт в памяти до перезагрузки
  }
}

/**
 * Единственный источник токена для AuthService и интерцептора.
 *
 * Не зависит от HttpClient, поэтому его можно внедрять в интерцептор без
 * циклической зависимости. Слушает событие storage: выход или вход в соседней
 * вкладке меняет сигнал и здесь, AuthService на это реагирует.
 */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  readonly token = signal<string | null>(readStoredToken());

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('storage', (e: StorageEvent) => {
      // key === null означает localStorage.clear()
      if (e.key === TOKEN_KEY || e.key === null) this.token.set(e.newValue);
    });
  }

  /** Пишет в localStorage и обновляет сигнал. null удаляет токен. */
  set(token: string | null): void {
    writeStoredToken(token);
    this.token.set(token);
  }

  clear(): void {
    this.set(null);
  }
}
