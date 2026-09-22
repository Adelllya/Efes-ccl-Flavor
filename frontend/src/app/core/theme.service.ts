import { Injectable, signal } from '@angular/core';

export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'ft.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.load());
  constructor() { this.apply(this.theme()); }
  set(t: Theme): void { this.theme.set(t); this.apply(t); try { localStorage.setItem(KEY, t); } catch { /* ignore */ } }
  cycle(): void { this.set(this.theme() === 'auto' ? 'dark' : this.theme() === 'dark' ? 'light' : 'auto'); }
  private apply(t: Theme): void {
    const el = document.documentElement;
    if (t === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', t);
  }
  /* По умолчанию — тёмная: премиальная гастро-тема и есть лицо продукта, а не системная настройка гостя. */
  private load(): Theme { try { return (localStorage.getItem(KEY) as Theme) || 'dark'; } catch { return 'dark'; } }
}
