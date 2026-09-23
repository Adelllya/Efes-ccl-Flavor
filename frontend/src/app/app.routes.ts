import { Routes } from '@angular/router';

/** Все страницы — lazy standalone-компоненты. data.tab подсвечивает вкладку нижней панели на телефоне (home · pair · drinks · academy · me). */
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage), title: 'Flavor Tree — что выберешь сегодня?', data: { tab: 'home' } },
  { path: 'pair', loadComponent: () => import('./pages/pair/pair.page').then(m => m.PairPage), title: 'Подбор напитка к блюду', data: { tab: 'pair' } },
  { path: 'pair/:dishId', loadComponent: () => import('./pages/pair/pair-results.page').then(m => m.PairResultsPage), title: 'Результат подбора', data: { tab: 'pair' } },
  // ── каталог напитков v2 и методика ──
  { path: 'drinks', loadComponent: () => import('./pages/drinks/drinks.page').then(m => m.DrinksPage), title: 'Напитки · каталог', data: { tab: 'drinks' } },
  { path: 'drinks/:id', loadComponent: () => import('./pages/drinks/drink-detail.page').then(m => m.DrinkDetailPage), title: 'Напиток', data: { tab: 'drinks' } },
  { path: 'method', loadComponent: () => import('./pages/method/method.page').then(m => m.MethodPage), title: 'Как мы считаем', data: { tab: 'home' } },
  { path: 'credits', loadComponent: () => import('./pages/credits/credits.page').then(m => m.CreditsPage), title: 'Источники фото и данных', data: { tab: 'home' } },
  // ── пирамиды 17 сортов Efes (v1) — остаются доступны из каталога напитков ──
  { path: 'beers', loadComponent: () => import('./pages/beers/beers.page').then(m => m.BeersPage), title: 'Сорта Efes · вкусовая пирамида', data: { tab: 'drinks' } },
  { path: 'beers/:id', loadComponent: () => import('./pages/beers/beer-detail.page').then(m => m.BeerDetailPage), title: 'Сорт', data: { tab: 'drinks' } },
  { path: 'dishes', loadComponent: () => import('./pages/dishes/dishes.page').then(m => m.DishesPage), title: 'База блюд', data: { tab: 'pair' } },
  { path: 'academy', loadComponent: () => import('./pages/academy/academy.page').then(m => m.AcademyPage), title: 'Школа сомелье', data: { tab: 'academy' } },
  { path: 'academy/:levelId', loadComponent: () => import('./pages/academy/lesson.page').then(m => m.LessonPage), title: 'Урок', data: { tab: 'academy' } },
  { path: 'dna', loadComponent: () => import('./pages/dna/dna.page').then(m => m.DnaPage), title: 'Flavor DNA', data: { tab: 'me' } },
  { path: 'qr/:token', loadComponent: () => import('./pages/qr/qr.page').then(m => m.QrPage), title: 'Меню заведения', data: { tab: 'pair' } },
  // ── SaaS: гостевое меню заведения, кабинет владельца, лендинг для баров ──
  { path: 'm/:slug', loadComponent: () => import('./pages/menu/venue-menu.page').then(m => m.VenueMenuPage), title: 'Меню заведения', data: { tab: 'pair', bare: true } },
  { path: 'm/:slug/:table', loadComponent: () => import('./pages/menu/venue-menu.page').then(m => m.VenueMenuPage), title: 'Меню заведения', data: { tab: 'pair', bare: true } },
  { path: 'scan', loadComponent: () => import('./pages/scan/scan.page').then(m => m.ScanPage), title: 'Сфотографировать блюдо — ИИ-сомелье', data: { tab: 'pair' } },
  { path: 'business', loadComponent: () => import('./pages/business/business.page').then(m => m.BusinessPage), title: 'Flavor Tree для баров и ресторанов', data: { tab: 'home' } },
  { path: 'cabinet', loadComponent: () => import('./pages/cabinet/cabinet.page').then(m => m.CabinetPage), title: 'Кабинет заведения', data: { tab: 'me' } },
  { path: 'cabinet/print', loadComponent: () => import('./pages/cabinet/qr-print.page').then(m => m.QrPrintPage), title: 'Печать QR-стендов', data: { tab: 'me', bare: true } },
  { path: 'admin', loadComponent: () => import('./pages/admin/admin.page').then(m => m.AdminPage), title: 'Панель сомелье', data: { tab: 'me' } },
  { path: 'about', loadComponent: () => import('./pages/about/about.page').then(m => m.AboutPage), title: 'О проекте · OneIdea 2026', data: { tab: 'home' } },
  { path: 'insights', loadComponent: () => import('./pages/insights/insights.page').then(m => m.InsightsPage), title: 'Радар портфеля Efes', data: { tab: 'home' } },
  { path: 'brand', loadComponent: () => import('./pages/brand/brand.page').then(m => m.BrandPage), title: 'Efes · аналитика портфеля', data: { tab: 'me' } },
  { path: '**', loadComponent: () => import('./pages/not-found.page').then(m => m.NotFoundPage), title: 'Страница не найдена' },
];
