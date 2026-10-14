/**
 * Язык интерфейса: EN по умолчанию, RU по кнопке в шапке. Без зависимостей от Angular,
 * чтобы main.ts прочитал выбор до старта приложения и включил перевод до первой отрисовки.
 */
export type Lang = 'en' | 'ru';

export const LANG_KEY = 'ft_lang';

/** Выбранный язык. Без localStorage (приватный режим) всегда EN. */
export function storedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'ru' ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // без хранилища язык держится до перезагрузки
  }
}

/** Язык, с которым приложение запущено в этой вкладке (смена языка перезагружает страницу). */
export const CURRENT_LANG: Lang = storedLang();
