import { Component, HostListener, OnDestroy, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LandingComponent } from './pages/landing/landing.component';
import { BrandExplorerComponent } from './pages/brand-explorer/brand-explorer.component';
import { FoodPairingComponent } from './pages/food-pairing/food-pairing.component';
import { AcademyComponent } from './pages/academy/academy.component';
import { SommelierAdminComponent } from './pages/sommelier-admin/sommelier-admin.component';
import { WheatDecorComponent } from './pages/landing/wheat-decor.component';
import { BeerDetailComponent } from './pages/beer-detail/beer-detail.component';
import { VenueMenuComponent } from './pages/venue-menu/venue-menu.component';
import { AuthComponent } from './pages/auth/auth.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { SommelierChatComponent } from './ui/sommelier-chat.component';
import { AuthService } from './services/auth.service';
import { SelectionService } from './services/selection.service';
import { ActiveTab } from './models/navigation';

export type { ActiveTab } from './models/navigation';

/** Путь в адресной строке для раздела. Сорт и заведение попадают в него параметром. */
function pathFor(tab: ActiveTab, brandId: string | null, venueSlug: string | null): string {
  switch (tab) {
    case 'explorer': return '/catalog';
    case 'beer': return brandId ? `/beer/${encodeURIComponent(brandId)}` : '/catalog';
    case 'pairing': return '/pairings';
    case 'academy': return '/academy';
    case 'admin': return '/panel';
    case 'menu': return venueSlug ? `/menu/${encodeURIComponent(venueSlug)}` : '/menu';
    case 'login': return '/login';
    case 'register': return '/register';
    case 'profile': return '/profile';
    default: return '/';
  }
}

interface ParsedPath {
  tab: ActiveTab;
  brandId?: string;
  venueSlug?: string | null;
}

/** Обратная операция: из адреса в раздел. Незнакомый адрес ведёт на главную. */
function parsePath(pathname: string): ParsedPath {
  let parts: string[];
  try {
    parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return { tab: 'landing' };
  }
  const [first = '', second = ''] = parts;
  switch (first) {
    case '': return { tab: 'landing' };
    case 'catalog': return { tab: 'explorer' };
    case 'beer': return second ? { tab: 'beer', brandId: second } : { tab: 'explorer' };
    case 'pairings': return { tab: 'pairing' };
    case 'academy': return { tab: 'academy' };
    case 'panel': return { tab: 'admin' };
    case 'menu': return { tab: 'menu', venueSlug: second || null };
    case 'login': return { tab: 'login' };
    case 'register': return { tab: 'register' };
    case 'profile': return { tab: 'profile' };
    default: return { tab: 'landing' };
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    LandingComponent,
    BrandExplorerComponent,
    FoodPairingComponent,
    AcademyComponent,
    SommelierAdminComponent,
    WheatDecorComponent,
    BeerDetailComponent,
    VenueMenuComponent,
    AuthComponent,
    ProfileComponent,
    SommelierChatComponent
  ],
  template: `
    <!-- Колосья по краям страницы: растут из-за кулис, едут при прокрутке -->
    <app-wheat-decor />

    <!-- Плавающие пузырьки карбонизации -->
    <div class="bubbles-container">
      @for (b of bubbles; track b.id) {
        <div
          class="bubble"
          [style.left.%]="b.left"
          [style.width.px]="b.size"
          [style.height.px]="b.size"
          [style.animationDuration.s]="b.duration"
          [style.animationDelay.s]="b.delay"
        ></div>
      }
    </div>

    <!-- Навигация с Glassmorphism -->
    <header class="nav-container">
      <nav class="glass-panel nav-bar">
        <!-- Логотип -->
        <div class="nav-logo" (click)="goTo('landing')">
          <div class="nav-logo-icon">
            <img src="decor/logo.png" alt="" />
          </div>
          <div>
            <span class="nav-brand-name">FLAVOR TREE</span>
            <span class="nav-brand-sub">Sensory Beer Guide</span>
          </div>
        </div>

        <!-- Липкий заголовок: появляется, когда H1 главной уходит за навбар -->
        <div class="nav-sticky-title" [class.visible]="showStickyTitle()" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>
          Что выберешь <span class="accent">сегодня?</span>
        </div>

        <!-- Десктопные табы -->
        <div class="nav-tabs" role="tablist" aria-label="Разделы">
          <button class="nav-tab" [class.active]="activeTab() === 'landing'" [attr.aria-current]="activeTab() === 'landing' ? 'page' : null" (click)="goTo('landing')">Главная</button>
          <button class="nav-tab" [class.active]="activeTab() === 'explorer' || activeTab() === 'beer'" [attr.aria-current]="activeTab() === 'explorer' ? 'page' : null" (click)="goTo('explorer')">Каталог</button>
          <button class="nav-tab" [class.active]="activeTab() === 'pairing'" [attr.aria-current]="activeTab() === 'pairing' ? 'page' : null" (click)="goTo('pairing')">К блюду</button>
          <button class="nav-tab" [class.active]="activeTab() === 'academy'" [attr.aria-current]="activeTab() === 'academy' ? 'page' : null" (click)="goTo('academy')">Академия</button>
          <button class="nav-tab" [class.active]="activeTab() === 'menu'" [attr.aria-current]="activeTab() === 'menu' ? 'page' : null" (click)="goTo('menu')">Меню</button>
        </div>

        <!-- Вход и аккаунт (десктоп) -->
        <div class="nav-user nav-admin-btn">
          @if (auth.isLoggedIn()) {
            @if (auth.canSeePanel()) {
              <button class="btn-amber btn-sm" (click)="goTo('admin')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                Панель
              </button>
            }
            <button class="btn-outline" [class.active]="activeTab() === 'profile'" (click)="goTo('profile')" title="Профиль">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span>{{ auth.user()?.username }}</span>
            </button>
            <button class="btn-ghost" (click)="logout()" title="Выйти" aria-label="Выйти">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
            </button>
          } @else {
            <button class="btn-amber btn-sm" (click)="goTo('login')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
              Войти
            </button>
          }
        </div>

        <!-- Гамбургер (мобильный) -->
        <button class="nav-hamburger" [class.open]="mobileMenuOpen()" (click)="toggleMobileMenu()" [attr.aria-expanded]="mobileMenuOpen()" aria-label="Открыть меню">
          <span></span>
          <span></span>
          <span></span>
        </button>
      </nav>
    </header>

    <!-- Мобильное меню (slide-out) -->
    <div class="nav-mobile-backdrop" [class.open]="mobileMenuOpen()" (click)="closeMobileMenu()"></div>
    <div class="nav-mobile-menu" [class.open]="mobileMenuOpen()">
      <button class="btn-outline" [class.active]="activeTab() === 'landing'" (click)="goTo('landing')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Главная
      </button>
      <button class="btn-outline" [class.active]="activeTab() === 'explorer' || activeTab() === 'beer'" (click)="goTo('explorer')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        Сорта и пирамида
      </button>
      <button class="btn-outline" [class.active]="activeTab() === 'pairing'" (click)="goTo('pairing')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
        Что подать к блюду
      </button>
      <button class="btn-outline" [class.active]="activeTab() === 'academy'" (click)="goTo('academy')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/></svg>
        Академия Сомелье
      </button>
      <button class="btn-outline" [class.active]="activeTab() === 'menu'" (click)="goTo('menu')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        Электронное меню
      </button>
      <hr style="border: none; border-top: 1px solid var(--line); margin: 8px 0;">
      @if (auth.isLoggedIn()) {
        @if (auth.canSeePanel()) {
          <button class="btn-amber" (click)="goTo('admin')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            Панель
          </button>
        }
        <button class="btn-outline" [class.active]="activeTab() === 'profile'" (click)="goTo('profile')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          {{ auth.user()?.username }}
        </button>
        <button class="btn-outline" (click)="logout()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
          Выйти
        </button>
      } @else {
        <button class="btn-amber" (click)="goTo('login')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
          Войти
        </button>
      }
    </div>

    <!-- Основной контент -->
    <main style="position: relative; z-index: 1; max-width: var(--container-max); margin: 32px auto; padding: 0 var(--container-padding) 80px;">
      <!-- Каждый @case монтирует свою обёртку .page-enter, поэтому раздел плавно появляется при каждом переключении -->
      @switch (activeTab()) {
        @case ('landing') {
          <div class="page-enter">
            <app-landing (navigate)="goTo($event)" />
          </div>
        }
        @case ('explorer') {
          <div class="page-enter">
            <app-brand-explorer (openBrand)="goTo('beer')" />
          </div>
        }
        @case ('beer') {
          <div class="page-enter">
            <app-beer-detail (back)="goTo('explorer')" />
          </div>
        }
        @case ('pairing') {
          <div class="page-enter">
            <app-food-pairing />
          </div>
        }
        @case ('academy') {
          <div class="page-enter">
            <app-academy />
          </div>
        }
        @case ('menu') {
          <div class="page-enter">
            <app-venue-menu (openBrand)="goTo('beer')" />
          </div>
        }
        @case ('admin') {
          <div class="page-enter">
            <!-- Пока сессия проверяется, форму входа не показываем: иначе она мигает при обновлении /panel -->
            @if (!auth.ready()) {
              <p class="text-muted text-center p-4xl">Проверяем сессию...</p>
            } @else if (auth.canSeePanel()) {
              <app-sommelier-admin (openMenu)="openVenueMenu($event)" />
            } @else {
              @if (auth.isLoggedIn()) {
                <p class="text-muted text-center mb-lg">Аккаунту {{ auth.user()?.username }} панель недоступна. Войдите под другой учётной записью.</p>
              }
              <app-auth mode="login" (done)="afterAuth()" (switchMode)="goTo($event)" />
            }
          </div>
        }
        @case ('login') {
          <div class="page-enter">
            <app-auth mode="login" (done)="afterAuth()" (switchMode)="goTo($event)" />
          </div>
        }
        @case ('register') {
          <div class="page-enter">
            <app-auth mode="register" (done)="afterAuth()" (switchMode)="goTo($event)" />
          </div>
        }
        @case ('profile') {
          <div class="page-enter">
            <app-profile (navigate)="goTo($event)" />
          </div>
        }
      }
    </main>

    <!-- ИИ-сомелье: плавающая кнопка и чат. В панели и на формах входа не нужен -->
    @if (activeTab() !== 'admin' && activeTab() !== 'login' && activeTab() !== 'register') {
      <app-sommelier-chat [lift]="activeTab() === 'menu'" (openBrand)="goTo('beer')" />
    }
  `,
  styles: [`
    :host { position: relative; display: block; }

    .nav-admin-btn {
      flex-shrink: 0;
    }

    .nav-user {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .nav-user .btn-outline {
      padding: 7px 14px;
      font-size: 0.82rem;
      max-width: 180px;
    }

    .nav-user .btn-outline span {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .nav-user .btn-ghost { color: var(--muted); }

    .nav-bar { position: relative; }

    .nav-tabs {
      gap: 6px;
      background: rgba(255, 255, 255, 0.7);
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      padding: 5px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);
      flex-wrap: nowrap;
    }

    .nav-tab {
      position: relative;
      isolation: isolate;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0 18px;
      border: none;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--foam-dim);
      font-family: var(--font-body);
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
      cursor: pointer;
      transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
    }

    /* Градиент активного таба живёт в ::before: сам градиент не анимируется, а его прозрачность да */
    .nav-tab::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(155deg, var(--beer-accent), var(--beer-mid));
      opacity: 0;
      transition: opacity 180ms ease;
    }

    .nav-tab:hover { color: var(--foam); background-color: var(--beer-glow); }

    .nav-tab.active {
      color: #fff;
      box-shadow: 0 4px 16px rgba(180, 83, 9, 0.35);
    }

    .nav-tab.active::before { opacity: 1; }

    .nav-tab:focus-visible {
      outline: 2px solid var(--beer-light);
      outline-offset: 2px;
    }

    /* Липкий заголовок под навбаром */
    .nav-sticky-title {
      position: absolute;
      left: 50%;
      top: 100%;
      transform: translateX(-50%) translateY(-100%);
      opacity: 0;
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      font-family: var(--font-heading);
      font-size: 0.92rem;
      font-weight: 800;
      color: var(--foam);
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(253, 243, 222, 0.96));
      border: 1.5px solid var(--line);
      padding: 8px 22px;
      border-radius: var(--radius-full);
      box-shadow: 0 10px 28px rgba(180, 83, 9, 0.22);
      transition: transform 0.45s var(--ease-out), opacity var(--duration-slow) ease;
      z-index: -1;
    }

    .nav-sticky-title svg { color: var(--beer-mid); }

    .nav-sticky-title .accent {
      background: linear-gradient(120deg, var(--beer-light), var(--beer-deep));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .nav-sticky-title.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(12px);
    }

    @media (prefers-reduced-motion: reduce) {
      .nav-sticky-title { transition: opacity var(--duration-fast) ease; }
    }

    @media (max-width: 1100px) {
      .nav-tab { padding: 0 12px; font-size: 0.76rem; }
      .nav-user .btn-outline { max-width: 130px; }
    }

    @media (max-width: 860px) {
      .nav-sticky-title { display: none; }
    }

    @media (max-width: 768px) {
      .nav-admin-btn {
        display: none;
      }
    }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly selection = inject(SelectionService);

  activeTab = signal<ActiveTab>('landing');
  mobileMenuOpen = signal(false);
  showStickyTitle = signal(false);

  constructor() {
    // Адрес читаем до первого запуска эффекта, иначе он перепишет его на главную
    this.applyPath(location.pathname);

    // Раздел, сорт или заведение поменялись: кладём новый адрес в историю
    effect(() => {
      const path = pathFor(this.activeTab(), this.selection.brandId(), this.selection.venueSlug());
      if (path !== location.pathname) history.pushState({}, '', path);
    });

    // Сессия закончилась (кнопка выхода в панели или 401): с панели и профиля уводим на вход
    effect(() => {
      const user = this.auth.user();
      const ready = this.auth.ready();
      const tab = untracked(this.activeTab);
      if (ready && user === null && (tab === 'admin' || tab === 'profile')) untracked(() => this.goTo('login'));
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    // Сессию AuthService проверяет сам в конструкторе (loadMe), второй запрос не нужен
    window.addEventListener('popstate', this.onPopState);
  }

  ngOnDestroy() {
    window.removeEventListener('popstate', this.onPopState);
  }

  /** Кнопки назад/вперёд браузера: адрес уже сменился, разбираем его без нового pushState. */
  private readonly onPopState = () => {
    this.applyPath(location.pathname);
    this.closeMobileMenu();
    this.showStickyTitle.set(false);
  };

  private applyPath(pathname: string) {
    const parsed = parsePath(pathname);
    if (parsed.brandId) this.selection.open(parsed.brandId);
    if (parsed.tab === 'menu') {
      this.selection.openVenue(parsed.venueSlug ?? null);
      // QR-ссылка вида /menu/<slug>?table=7: стол запоминаем, query из адреса убираем
      if (parsed.venueSlug) this.selection.setTableFromQuery(parsed.venueSlug);
    }
    this.activeTab.set(parsed.tab);
    // Незнакомый или неполный адрес (или адрес с query) подменяем каноническим без новой записи в истории
    const canonical = pathFor(parsed.tab, this.selection.brandId(), this.selection.venueSlug());
    if (canonical !== pathname || location.search) history.replaceState({}, '', canonical);
  }

  /** Показываем липкий заголовок, когда H1 главной ушёл за навбар. */
  @HostListener('window:scroll')
  onScroll() {
    if (this.activeTab() !== 'landing') {
      this.showStickyTitle.set(false);
      return;
    }
    const h1 = document.getElementById('hero-title');
    this.showStickyTitle.set(!!h1 && h1.getBoundingClientRect().bottom < 90);
  }

  // Генерируем 18 микро-пузырьков с разными размерами и скоростью подъема
  bubbles = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    left: Math.floor(Math.random() * 96) + 2,
    size: Math.floor(Math.random() * 14) + 6,
    duration: Math.floor(Math.random() * 8) + 7,
    delay: Math.floor(Math.random() * 5)
  }));

  goTo(tab: ActiveTab) {
    this.activeTab.set(tab);
    this.closeMobileMenu();
    this.showStickyTitle.set(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** После входа: в панель, если роль её видит, иначе на главную. */
  afterAuth() {
    this.goTo(this.auth.canSeePanel() ? 'admin' : 'landing');
  }

  /** Из панели: открыть гостевое меню заведения. */
  openVenueMenu(slug: string) {
    this.selection.openVenue(slug);
    this.goTo('menu');
  }

  /** Выход из шапки и мобильного меню: всегда ведёт на страницу входа. */
  logout() {
    this.auth.logout();
    this.closeMobileMenu();
    this.goTo('login');
  }

  toggleMobileMenu() {
    this.mobileMenuOpen.update(v => !v);
  }

  closeMobileMenu() {
    this.mobileMenuOpen.set(false);
  }
}
