import { Routes } from '@angular/router';

/** Все страницы — lazy standalone-компоненты. data.tab подсвечивает вкладку нижней панели на телефоне. */
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage), title: 'Flavor Tree — что выберешь сегодня?', data: { tab: 'home' } },
  { path: 'pair', loadComponent: () => import('./pages/pair/pair.page').then(m => m.PairPage), title: 'Подбор пива к блюду', data: { tab: 'pair' } },
  { path: 'pair/:dishId', loadComponent: () => import('./pages/pair/pair-results.page').then(m => m.PairResultsPage), title: 'Результат подбора', data: { tab: 'pair' } },
  { path: 'beers', loadComponent: () => import('./pages/beers/beers.page').then(m => m.BeersPage), title: '17 сортов · вкусовая пирамида', data: { tab: 'beers' } },
  { path: 'beers/:id', loadComponent: () => import('./pages/beers/beer-detail.page').then(m => m.BeerDetailPage), title: 'Сорт', data: { tab: 'beers' } },
  { path: 'dishes', loadComponent: () => import('./pages/dishes/dishes.page').then(m => m.DishesPage), title: '50 блюд', data: { tab: 'pair' } },
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
  { path: '**', loadComponent: () => import('./pages/not-found.page').then(m => m.NotFoundPage), title: 'Страница не найдена' },
];
