import { Injectable, signal } from '@angular/core';
import { CURRENT_LANG, Lang, saveLang } from './lang-storage';

/**
 * Язык интерфейса. Смена языка сохраняет выбор и перезагружает страницу: так данные движка подбора
 * заново приходят с нужным ?locale=, а перевод интерфейса стартует до первой отрисовки (main.ts).
 * Адрес страницы (раздел, фильтры, блюдо) живёт в URL и после перезагрузки сохраняется.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  readonly lang = signal<Lang>(CURRENT_LANG);

  set(lang: Lang): void {
    if (lang === this.lang()) return;
    saveLang(lang);
    this.lang.set(lang);
    location.reload();
  }
}
