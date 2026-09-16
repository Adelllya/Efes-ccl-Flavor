import { Component, signal } from '@angular/core';
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
    <!-- Плавающие пузырьки карбонизации на фоне -->
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

    <!-- Навигационная шапка Glassmorphism -->
    <header style="position: sticky; top: 16px; z-index: 100; max-width: 1280px; margin: 0 auto; padding: 0 20px;">
      <nav class="glass-panel" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 28px; flex-wrap: wrap; gap: 12px;">
        <!-- Логотип -->
        <div (click)="activeTab.set('landing')" style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
          <div style="width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg, var(--beer-accent), var(--beer-mid)); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; box-shadow: 0 6px 16px rgba(224,138,40,0.35);">
            🍺
          </div>
          <div>
            <span class="brand-font" style="font-size: 1.35rem; font-weight: 800; color: var(--foam);">FLAVOR TREE</span>
            <span style="display: block; font-size: 0.72rem; color: var(--muted); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;">Sensory Beer Guide</span>
          </div>
        </div>

        <!-- Навигационные табы -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn-outline" [class.active]="activeTab() === 'landing'" (click)="activeTab.set('landing')">Главная</button>
          <button class="btn-outline" [class.active]="activeTab() === 'explorer'" (click)="activeTab.set('explorer')">17 Сортов & Пирамида</button>
          <button class="btn-outline" [class.active]="activeTab() === 'pairing'" (click)="activeTab.set('pairing')">51 Гастропара & 50 Блюд</button>
          <button class="btn-outline" [class.active]="activeTab() === 'academy'" (click)="activeTab.set('academy')">Академия Сомелье</button>
        </div>

        <!-- Кнопка панели сомелье -->
        <button class="btn-amber" (click)="activeTab.set('admin')">
          <span>⚙️ Панель Сомелье</span>
        </button>
      </nav>
    </header>

    <!-- Основной контент страницы -->
    <main style="position: relative; z-index: 1; max-width: 1280px; margin: 32px auto; padding: 0 20px 80px;">
      @switch (activeTab()) {
        @case ('landing') {
          <app-landing (navigate)="activeTab.set($event)" />
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
  `
})
export class AppComponent {
  activeTab = signal<ActiveTab>('landing');

  // Генерируем 18 микро-пузырьков с разными размерами и скоростью подъема
  bubbles = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    left: Math.floor(Math.random() * 96) + 2,
    size: Math.floor(Math.random() * 14) + 6,
    duration: Math.floor(Math.random() * 8) + 7,
    delay: Math.floor(Math.random() * 5)
  }));
}
