// Локальная разработка. Значения для продакшена — в environment.prod.ts
// (подменяется при production-сборке через fileReplacements в angular.json).
export const environment = {
  production: false,
  apiBase: 'http://127.0.0.1:8000/api',
  adminUrl: 'http://127.0.0.1:8000/admin/',
};
