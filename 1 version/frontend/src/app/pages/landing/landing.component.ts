import { Component, EventEmitter, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActiveTab } from '../../app.component';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- HERO SECTION -->
    <section class="glass-panel" style="padding: 56px 48px; margin-bottom: 40px; position: relative; overflow: hidden;">
      <div style="max-width: 760px;">
        <span class="badge" style="margin-bottom: 16px;">✨ Образовательная платформа сенсорного анализа</span>
        <h1 style="font-size: 3.4rem; line-height: 1.12; margin-bottom: 20px; color: var(--foam);">
          Don't just drink — <span style="color: var(--beer-mid);">listen to the flavor.</span>
        </h1>
        <p style="font-size: 1.15rem; color: var(--foam-dim); margin-bottom: 32px;">
          Откройте архитектуру вкуса напитков через трехуровневую вкусовую пирамиду (0–3 сек, 3–15 сек, 15+ сек) и 51 идеальную гастропару по стандарту FlavorActiV.
        </p>

        <div style="display: flex; gap: 16px; flex-wrap: wrap;">
          <button class="btn-amber" (click)="navigate.emit('explorer')">
            🔍 Исследовать 17 сортов & Пирамиду
          </button>
          <button class="btn-outline" (click)="navigate.emit('pairing')">
            🍽️ Подобрать гастропару к 50 блюдам
          </button>
        </div>
      </div>

      <!-- Статистика платформы -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin-top: 48px; padding-top: 32px; border-top: 1px solid var(--line);">
        <div>
          <span class="brand-font" style="font-size: 2.2rem; font-weight: 800; color: var(--beer-mid);">17</span>
          <p style="font-size: 0.9rem; color: var(--muted);">Сортов с разбором пирамиды</p>
        </div>
        <div>
          <span class="brand-font" style="font-size: 2.2rem; font-weight: 800; color: var(--beer-mid);">50</span>
          <p style="font-size: 0.9rem; color: var(--muted);">Блюд мировой & казахской кухни</p>
        </div>
        <div>
          <span class="brand-font" style="font-size: 2.2rem; font-weight: 800; color: var(--beer-mid);">51</span>
          <p style="font-size: 0.9rem; color: var(--muted);">Гастрономическая пара</p>
        </div>
        <div>
          <span class="brand-font" style="font-size: 2.2rem; font-weight: 800; color: var(--beer-mid);">4</span>
          <p style="font-size: 0.9rem; color: var(--muted);">Уровня школы сомелье</p>
        </div>
      </div>
    </section>

    <!-- ИНТЕРАКТИВНЫЙ СЕЛЕКТОР НАСТРОЕНИЯ -->
    <section style="margin-bottom: 48px;">
      <h2 style="font-size: 2rem; margin-bottom: 8px;">Что выберешь сегодня?</h2>
      <p style="color: var(--muted); margin-bottom: 24px;">Выберите ваше гастрономическое настроение, и мы подскажем идеальный профиль</p>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px;">
        @for (mood of moods; track mood.title) {
          <div class="glass-card" (click)="selectedMood.set(mood)" style="padding: 24px; cursor: pointer;" [style.borderColor]="selectedMood().title === mood.title ? 'var(--beer-mid)' : 'var(--line)'">
            <div style="font-size: 2.2rem; margin-bottom: 12px;">{{ mood.icon }}</div>
            <h3 style="font-size: 1.2rem; margin-bottom: 8px;">{{ mood.title }}</h3>
            <p style="font-size: 0.9rem; color: var(--foam-dim); margin-bottom: 16px;">{{ mood.desc }}</p>
            <span class="badge">{{ mood.rec }}</span>
          </div>
        }
      </div>
    </section>

    <!-- ПРЕЗЕНТАЦИЯ КОНЦЕПЦИИ ВКУСОВОЙ ПИРАМИДЫ -->
    <section class="glass-panel" style="padding: 40px;">
      <h2 style="font-size: 2rem; margin-bottom: 24px; text-align: center;">Хронометраж глотка: Вкусовая Пирамида</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px;">
        <div class="glass-card" style="padding: 24px;">
          <span class="badge" style="margin-bottom: 12px;">🌿 TOP NOTES • 0–3 секунды</span>
          <h3 style="margin-bottom: 8px;">Ароматическая вершина</h3>
          <p style="color: var(--foam-dim); font-size: 0.92rem;">Первое впечатление при поднесении бокала: эфирные масла хмеля, цветочные, цитрусовые и пряные летучие соединения.</p>
        </div>

        <div class="glass-card" style="padding: 24px;">
          <span class="badge" style="margin-bottom: 12px;">🌾 HEART NOTES • 3–15 секунд</span>
          <h3 style="margin-bottom: 8px;">Солодовое сердце</h3>
          <p style="color: var(--foam-dim); font-size: 0.92rem;">Полнота вкуса во рту: хлебная корочка, солод, карамель, рисовые ноты и плотность тела напитка.</p>
        </div>

        <div class="glass-card" style="padding: 24px;">
          <span class="badge" style="margin-bottom: 12px;">⚡ BASE NOTES • 15+ секунд</span>
          <h3 style="margin-bottom: 8px;">База и Послевкусие</h3>
          <p style="color: var(--foam-dim); font-size: 0.92rem;">Финальный шлейф после глотка: благородная хмелевая горечь, сухость, обжаренные тона и освежающий финал.</p>
        </div>
      </div>
    </section>
  `
})
export class LandingComponent {
  @Output() navigate = new EventEmitter<ActiveTab>();

  moods = [
    { icon: '🍋', title: 'Освежиться в жару', desc: 'Легкое тело, яркий хмель и хрустящий сухой финиш.', rec: 'Efes Pilsener • 5–7°C' },
    { icon: '🥩', title: 'К сочному мясу / казы', desc: 'Высокая горечь и плотный солод для баланса жиров.', rec: 'Хмельной Лось / Kozel' },
    { icon: '🍚', title: 'Попробовать экзотику', desc: 'Шелковистая рисовая сухость и чистота.', rec: 'Wùkōng Jū (悟空居) • 4–6°C' },
    { icon: '🍺', title: 'Разливное с друзьями', desc: 'Свежесть бочки прямо сейчас.', rec: 'Кружка Свежего / Бочковое' }
  ];

  selectedMood = signal(this.moods[0]);
}
