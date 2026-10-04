/**
 * Листы поверх страницы (чат сомелье, мобильное меню) и кнопка «Назад» телефона.
 *
 * Пока лист открыт на телефоне, у него своя запись в истории браузера с тем же адресом. «Назад»
 * (кнопка, жест от края) закрывает лист, а не меняет страницу под ним и не уводит с сайта гостя,
 * который пришёл по QR. Лист закрыли сами (крестик, Escape, подложка): его запись убираем шагом
 * назад, и дальше «Назад» ведёт туда же, куда вёл до листа. Переход на другую страницу из листа
 * ставит новую страницу на место записи листа (AppComponent, replaceOverlayEntry). «Вперёд»
 * на запись листа и обновление страницы на ней открывают лист снова.
 *
 * Запись листа и запись страницы под ним помечены одной меткой. Шаг между ними узнаём точно и
 * не показываем другим обработчикам popstate (адрес раздела, шаги подбора на главной, фильтры
 * каталога): страница та же, менять им нечего, а главная иначе прокручивала бы к результату.
 * Карточка напитка в каталоге держит свою запись сама (drinks-v2/v2-url.ts).
 */

/** Какой лист добавил запись истории. */
const OVERLAY_KEY = 'ftOverlay';
/** Общая метка записи листа и записи страницы под ним. */
const MARK_KEY = 'ftOverlayMark';
/** Сколько ждём popstate от своего шага назад. */
const POP_WAIT_MS = 1500;

export type OverlayName = 'chat' | 'menu';

export interface OverlayHandlers {
  /** «Назад» с записи листа: закрыть лист (запись уже снята, history не трогать). */
  back: () => void;
  /** «Вперёд» на запись листа или страница открылась на ней: открыть лист без новой записи. */
  forward: () => void;
  /** Открыт ли лист сейчас. */
  isOpen: () => boolean;
}

/** Все листы с записями: переход со страницы сбрасывает их метки (replaceOverlayEntry). */
const live = new Set<OverlayHistory>();

function currentState(): Record<string, unknown> {
  try {
    const s: unknown = history.state;
    return s && typeof s === 'object' ? s as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Лист, которому принадлежит текущая запись истории, или null для записи страницы. */
export function overlayEntry(): OverlayName | null {
  const v = currentState()[OVERLAY_KEY];
  return v === 'chat' || v === 'menu' ? v : null;
}

/**
 * Переход на другую страницу, пока текущая запись принадлежит листу: новая страница встаёт на её
 * место, и «Назад» с неё ведёт на страницу под листом, а не на пустой шаг с тем же адресом.
 */
export function replaceOverlayEntry(url: string): void {
  live.forEach(o => o.forget());
  history.replaceState({}, '', url);
}

export class OverlayHistory {
  /** Метка пары записей; null, пока у листа нет своей записи. */
  private mark: string | null = null;
  /** Где мы в паре: на записи листа, на странице под ней или вне пары. */
  private at: 'overlay' | 'base' | null = null;
  /** Шаг назад сделали мы сами (лист закрыли крестиком): его popstate только снимает запись. */
  private popping = false;
  private popTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly name: OverlayName, private readonly handlers: OverlayHandlers) {
    live.add(this);
    // capture: на window такой обработчик срабатывает раньше обработчиков страниц и может скрыть от них свой шаг
    window.addEventListener('popstate', this.onPopState, true);
  }

  destroy(): void {
    live.delete(this);
    clearTimeout(this.popTimer);
    window.removeEventListener('popstate', this.onPopState, true);
  }

  /** Страница открылась на записи этого листа (обновили, вернулись с другого сайта): true, лист нужно открыть. */
  resume(): boolean {
    const s = currentState();
    if (s[OVERLAY_KEY] !== this.name) return false;
    this.mark = typeof s[MARK_KEY] === 'string' ? s[MARK_KEY] as string : null;
    this.at = 'overlay';
    this.popping = false;
    return true;
  }

  /** Лист открылся: запись с тем же адресом поверх текущей. */
  push(): void {
    // Лист открыли снова, пока наш шаг назад ещё идёт: запись вернёт onPopState
    if (this.popping || overlayEntry() === this.name) return;
    const mark = `${this.name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const base = currentState();
      history.replaceState({ ...base, [MARK_KEY]: mark }, '');
      history.pushState({ ...base, [MARK_KEY]: mark, [OVERLAY_KEY]: this.name }, '');
      this.mark = mark;
      this.at = 'overlay';
    } catch {
      // История недоступна (Safari ограничивает частоту вызовов): лист закрывается крестиком, как раньше
    }
  }

  /**
   * Лист закрыт, и страница уже отрисована: переход из листа успел поставить новую страницу на место
   * его записи. Если запись листа всё ещё текущая, dismiss (крестик, Escape, подложка) снимает её
   * шагом назад. Без dismiss (пункт меню того же раздела) она остаётся записью страницы без метки:
   * шаг назад вернул бы прокрутку, которую переход только что поставил.
   */
  settle(dismiss: boolean): void {
    if (this.at !== 'overlay' || this.popping) return;
    const s = currentState();
    if (s[OVERLAY_KEY] !== this.name) {
      this.forget();
      return;
    }
    if (dismiss) {
      this.popping = true;
      history.back();
      // Шаг назад не случился (записи под листом нет): не ждём его вечно, иначе лист больше не получит запись
      clearTimeout(this.popTimer);
      this.popTimer = setTimeout(() => { this.popping = false; }, POP_WAIT_MS);
      return;
    }
    const { [OVERLAY_KEY]: _overlay, [MARK_KEY]: _mark, ...rest } = s;
    try {
      history.replaceState(rest, '');
    } catch {
      // Метка останется: «Назад» отсюда просто закроет уже закрытый лист
    }
    this.forget();
  }

  /** Запись листа заменили или покинули: метка больше ничего не значит. */
  forget(): void {
    this.mark = null;
    this.at = null;
    this.popping = false;
    clearTimeout(this.popTimer);
  }

  private readonly onPopState = (e: PopStateEvent) => {
    const s = currentState();
    const onOverlay = s[OVERLAY_KEY] === this.name;
    const paired = !!this.mark && s[MARK_KEY] === this.mark;

    if (paired && this.at === 'overlay' && !onOverlay) {
      // «Назад» с листа или наш шаг назад после крестика: страница под листом та же
      e.stopImmediatePropagation();
      this.at = 'base';
      if (this.popping) {
        this.popping = false;
        clearTimeout(this.popTimer);
        // Пока шаг шёл, лист открыли снова: возвращаем его запись
        if (this.handlers.isOpen()) this.push();
      } else {
        this.handlers.back();
      }
      return;
    }
    if (paired && this.at === 'base' && onOverlay) {
      // «Вперёд» на запись листа
      e.stopImmediatePropagation();
      this.at = 'overlay';
      this.handlers.forward();
      return;
    }

    // Любой другой шаг истории: страница меняется, её обработчики работают как обычно
    const wasOpen = this.at === 'overlay' && this.handlers.isOpen();
    this.forget();
    if (onOverlay && this.resume()) this.handlers.forward();
    else if (wasOpen) this.handlers.back();
  };
}
