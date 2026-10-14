// ПРОДАКШЕН. Адрес бекенда на Vercel (проект flavor-tree-backend). Схема https, без слэша на конце домена.
export const environment = {
  production: true,
  apiBase: 'https://flavor-tree-backend.vercel.app/api',
  adminUrl: 'https://flavor-tree-backend.vercel.app/admin/',
  // Прототип: кнопки быстрого входа видны и на проде, чтобы любой мог зайти под ролью.
  demoAccounts: true,
};
