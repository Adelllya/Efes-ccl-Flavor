// Локальная разработка. Значения для продакшена — в environment.prod.ts
// (подменяется при production-сборке через fileReplacements в angular.json).
// Хост берём из адресной строки, чтобы сайт работал и с телефона в той же сети
// (http://<IP компьютера>:4200), а не только с 127.0.0.1.
const devHost = typeof location !== 'undefined' ? location.hostname : '127.0.0.1';

export const environment = {
  production: false,
  apiBase: `http://${devHost}:8000/api`,
  adminUrl: `http://${devHost}:8000/admin/`,
  // Кнопки тестовых аккаунтов на странице входа: показываем в dev, скрываем на проде (пароли ротируются).
  demoAccounts: true,
};
