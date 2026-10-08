/**
 * Состояние экранов движка v2 в адресе: режим каталога, фильтры, поиск, выбранное блюдо, открытый напиток.
 * Так оно переживает перезагрузку и возврат со страницы сорта, ссылку можно переслать, а «Назад»
 * браузера закрывает карточку напитка, а не уводит с сайта. Раздел (/catalog, /pairings) выбирает
 * AppComponent и query в этих разделах не трогает; здесь меняется только query своего раздела.
 */

export const CATALOG_PATH = '/catalog';
export const PAIRINGS_PATH = '/pairings';

/** Параметры экрана «Все напитки» в /catalog: категория, поиск, фильтр Efes, открытый напиток. */
export const CATALOG_PARAMS = ['cat', 'q', 'efes', 'drink'] as const;
/** Параметры вкладки «Подбор из всех напитков» в /pairings: блюдо, без алкоголя, весь рынок. */
export const PAIRING_PARAMS = ['dish', 'na', 'efes'] as const;

/** Метка записи истории, которую добавила открытая карточка напитка. */
const SHEET_KEY = 'ftSheet';

/** Значение параметра, если сейчас открыт этот раздел. */
export function urlParam(path: string, name: string): string | null {
  if (location.pathname !== path) return null;
  return new URLSearchParams(location.search).get(name);
}

/**
 * Меняет параметры раздела; null или пустая строка убирает параметр. Без push запись истории
 * подменяется (фильтры и поиск не плодят шагов «Назад»), с push добавляется новая (карточка напитка).
 * Если открыт другой раздел, ничего не делает: чужой адрес не трогаем.
 */
export function setUrlParams(path: string, patch: Record<string, string | null>, push = false): void {
  if (location.pathname !== path) return;
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') params.delete(key);
    else params.set(key, value);
  }
  const search = params.toString();
  const url = path + (search ? '?' + search : '') + location.hash;
  try {
    if (push) history.pushState({ [SHEET_KEY]: true }, '', url);
    else if (url !== path + location.search + location.hash) history.replaceState(history.state, '', url);
  } catch {
    // Safari ограничивает частоту replaceState: состояние экрана при этом не теряется, отстаёт только адрес
  }
}

/** Убирает параметры раздела, например когда гость ушёл из режима, которому они принадлежат. */
export function dropUrlParams(path: string, names: readonly string[]): void {
  setUrlParams(path, Object.fromEntries(names.map(n => [n, null])));
}

/** Режим каталога из адреса: ?view=all или ссылка на напиток (?drink=) открывают «Все напитки». */
export function catalogModeFromUrl(): 'efes' | 'all' {
  return urlParam(CATALOG_PATH, 'view') === 'all' || urlParam(CATALOG_PATH, 'drink') ? 'all' : 'efes';
}

/** Режим каталога в адрес. В режиме «Сорта Efes» параметры экрана «Все напитки» не нужны. */
export function syncCatalogMode(mode: 'efes' | 'all'): void {
  if (mode === 'all') setUrlParams(CATALOG_PATH, { view: 'all' });
  else dropUrlParams(CATALOG_PATH, ['view', ...CATALOG_PARAMS]);
}

export type PairingView = 'pairings' | 'dishes' | 'drinks';

/** Вкладка раздела «К блюду» из адреса: ?view=drinks|dishes; ссылка с ?dish= открывает подбор из всех напитков. */
export function pairingViewFromUrl(): PairingView {
  const view = urlParam(PAIRINGS_PATH, 'view');
  if (view === 'drinks' || urlParam(PAIRINGS_PATH, 'dish')) return 'drinks';
  return view === 'dishes' ? 'dishes' : 'pairings';
}

/** Вкладка «К блюду» в адрес. Параметры подбора из всех напитков живут только на своей вкладке. */
export function syncPairingView(view: PairingView): void {
  setUrlParams(PAIRINGS_PATH, { view: view === 'pairings' ? null : view });
  if (view !== 'drinks') dropUrlParams(PAIRINGS_PATH, PAIRING_PARAMS);
}

/** Текущую запись истории добавила карточка: закрывать её нужно шагом назад, а не новой записью. */
export function isSheetEntry(): boolean {
  const state = history.state as Record<string, unknown> | null;
  return !!state && state[SHEET_KEY] === true;
}
