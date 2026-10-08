/**
 * Разделы сайта. Переключаются через activeTab в AppComponent,
 * роутер не используется, путь в адресной строке AppComponent ведёт сам.
 */
export type ActiveTab =
  | 'landing'
  | 'explorer'
  | 'pairing'
  | 'academy'
  | 'admin'
  | 'beer'
  | 'menu'
  | 'login'
  | 'register'
  | 'profile'
  | 'passport'
  | 'privacy';

/**
 * Вкладки панели. Какие видит пользователь, решает AuthService.can().
 * pyramid и serving объединены во вкладку brands и оставлены в типе только
 * для совместимости со старым кодом: в реестр вкладок их не добавлять.
 */
export type PanelTab =
  | 'overview'
  | 'brands'
  | 'requests'
  | 'pairings'
  | 'notes'
  | 'dishes'
  | 'menu'
  | 'orders'
  | 'pilot'
  | 'engine'
  | 'analytics'
  | 'rewards'
  | 'quiz'
  | 'users'
  | 'settings'
  | 'pyramid'
  | 'serving';

/** Порядок вкладок в панели. */
export const PANEL_TABS: readonly PanelTab[] = [
  'overview', 'brands', 'requests', 'pairings', 'notes', 'dishes', 'menu', 'orders', 'pilot', 'engine',
  'analytics', 'rewards', 'quiz', 'users', 'settings'
];
