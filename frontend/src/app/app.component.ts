import { Component, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LandingComponent } from './pages/landing/landing.component';
import { BrandExplorerComponent } from './pages/brand-explorer/brand-explorer.component';
import { FoodPairingComponent } from './pages/food-pairing/food-pairing.component';
import { AcademyComponent } from './pages/academy/academy.component';
import { SommelierAdminComponent } from './pages/sommelier-admin/sommelier-admin.component';

export type ActiveTab = 'landing' | 'explorer' | 'pairing' | 'academy' | 'admin';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    LandingComponent,
    BrandExplorerComponent,
    FoodPairingComponent,
    AcademyComponent,
    SommelierAdminComponent
  ],
  template: `
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 8h1a4 4 0 1 1 0 8h-1"/>
              <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>
              <line x1="6" x2="6" y1="2" y2="4"/>
              <line x1="10" x2="10" y1="2" y2="4"/>
              <line x1="14" x2="14" y1="2" y2="4"/>
            </svg>
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
          <button class="nav-tab" [class.active]="activeTab() === 'explorer'" [attr.aria-current]="activeTab() === 'explorer' ? 'page' : null" (click)="goTo('explorer')">17 Сортов</button>
          <button class="nav-tab" [class.active]="activeTab() === 'pairing'" [attr.aria-current]="activeTab() === 'pairing' ? 'page' : null" (click)="goTo('pairing')">Гастропары</button>
          <button class="nav-tab" [class.active]="activeTab() === 'academy'" [attr.aria-current]="activeTab() === 'academy' ? 'page' : null" (click)="goTo('academy')">Академия</button>
        </div>

        <!-- Кнопка Панель Сомелье (десктоп) -->
        <button class="btn-amber btn-sm nav-admin-btn" (click)="goTo('admin')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          Панель Сомелье
        </button>

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
      <button class="btn-outline" [class.active]="activeTab() === 'explorer'" (click)="goTo('explorer')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        17 Сортов & Пирамида
      </button>
      <button class="btn-outline" [class.active]="activeTab() === 'pairing'" (click)="goTo('pairing')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
        51 Гастропара & 50 Блюд
      </button>
      <button class="btn-outline" [class.active]="activeTab() === 'academy'" (click)="goTo('academy')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/></svg>
        Академия Сомелье
      </button>
      <hr style="border: none; border-top: 1px solid var(--line); margin: 8px 0;">
      <button class="btn-amber" (click)="goTo('admin')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        Панель Сомелье
      </button>
    </div>

    <!-- Основной контент -->
    <main style="position: relative; z-index: 1; max-width: var(--container-max); margin: 32px auto; padding: 0 var(--container-padding) 80px;">
      @switch (activeTab()) {
        @case ('landing') {
          <app-landing (navigate)="goTo($event)" />
        }
        @case ('explorer') {
          <app-brand-explorer />
        }
        @case ('pairing') {
          <app-food-pairing />
        }
        @case ('academy') {
          <app-academy />
        }
        @case ('admin') {
          <app-sommelier-admin />
        }
      }
    </main>
  `,
  styles: [`
    .nav-admin-btn {
      flex-shrink: 0;
    }

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
      transition: background var(--duration-fast) ease, color var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
    }

    .nav-tab:hover { color: var(--foam); background: var(--beer-glow); }

    .nav-tab.active {
      background: linear-gradient(155deg, var(--beer-accent), var(--beer-mid));
      color: #fff;
      box-shadow: 0 4px 16px rgba(180, 83, 9, 0.35);
    }

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

    @media (max-width: 1024px) {
      .nav-tab { padding: 0 12px; font-size: 0.76rem; }
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
export class AppComponent {
  activeTab = signal<ActiveTab>('landing');
  mobileMenuOpen = signal(false);
  showStickyTitle = signal(false);

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

  toggleMobileMenu() {
    this.mobileMenuOpen.update(v => !v);
  }

  closeMobileMenu() {
    this.mobileMenuOpen.set(false);
  }
}
