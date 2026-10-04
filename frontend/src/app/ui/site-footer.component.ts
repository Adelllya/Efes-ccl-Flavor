import { Component, EventEmitter, Output } from '@angular/core';
import { ActiveTab } from '../models/navigation';
import { LEGAL_AGE } from '../services/age-gate.service';

/** Подвал сайта: разделы, слой ответственного потребления и происхождение проекта. */
@Component({
  selector: 'app-site-footer',
  standalone: true,
  template: `
    <footer class="sf">
      <div class="sf-top">
        <div class="sf-brand">
          <span class="sf-name">FLAVOR TREE</span>
          <p class="sf-about">
            Учим слышать вкус пива и подбираем его к еде. Проект участников
            OneIdea Championship 2026 × Efes Kazakhstan.
          </p>
        </div>
        <nav class="sf-nav" aria-label="Разделы сайта">
          <button type="button" (click)="navigate.emit('landing')">Подбор пары</button>
          <button type="button" (click)="navigate.emit('explorer')">Каталог сортов</button>
          <button type="button" (click)="navigate.emit('pairing')">К блюду</button>
          <button type="button" (click)="navigate.emit('academy')">Академия</button>
          <button type="button" (click)="navigate.emit('passport')">Паспорт вкуса</button>
          <button type="button" (click)="navigate.emit('menu')">Меню заведений</button>
        </nav>
      </div>
      <div class="sf-care">
        <span class="sf-age" aria-hidden="true">{{ legalAge }}+</span>
        <p>
          Сайт предназначен для лиц старше {{ legalAge }} года. Это информация о вкусе и культуре подачи, а не реклама.
          Чрезмерное употребление алкоголя вредит вашему здоровью. Не садитесь за руль после алкоголя.
        </p>
      </div>
    </footer>
  `,
  styles: [`
    :host { display: block; position: relative; z-index: 1; }
    .sf {
      max-width: 1280px;
      margin: var(--space-6xl) auto 0;
      padding: var(--space-3xl) var(--space-2xl) calc(var(--space-3xl) + 72px);
      border-top: 1px solid var(--line);
    }
    .sf-top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2xl); margin-bottom: var(--space-2xl); }
    .sf-brand { flex: 1 1 300px; max-width: 440px; }
    .sf-name { font-family: var(--font-heading); font-weight: 800; letter-spacing: 0.04em; color: var(--foam); }
    .sf-about { margin: var(--space-sm) 0 0; font-size: 0.875rem; line-height: 1.6; color: var(--muted); }
    .sf-nav { display: grid; grid-template-columns: repeat(2, auto); gap: 0 var(--space-3xl); align-content: start; }
    .sf-nav button {
      min-height: 40px;
      padding: 0;
      border: none;
      background: none;
      color: var(--foam-dim);
      font: inherit;
      font-size: 0.9375rem;
      text-align: left;
      cursor: pointer;
    }
    .sf-nav button:hover { color: var(--beer-mid); text-decoration: underline; }
    .sf-nav button:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; border-radius: 4px; }
    .sf-care {
      display: flex;
      align-items: flex-start;
      gap: var(--space-md);
      padding: var(--space-lg);
      border-radius: var(--radius-lg);
      background: var(--bg-1);
      border: 1px solid var(--line);
    }
    .sf-care p { margin: 0; font-size: 0.8125rem; line-height: 1.6; color: var(--muted); }
    .sf-age {
      flex-shrink: 0;
      padding: 4px 10px;
      border: 2px solid var(--beer-mid);
      border-radius: var(--radius-full);
      color: var(--beer-deep);
      font-weight: 800;
      font-size: 0.8125rem;
    }
    @media (max-width: 600px) {
      .sf { padding: var(--space-2xl) var(--space-lg) calc(var(--space-2xl) + 88px); margin-top: var(--space-4xl); }
      .sf-nav { grid-template-columns: 1fr 1fr; gap: 0 var(--space-lg); width: 100%; }
    }
  `],
})
export class SiteFooterComponent {
  @Output() navigate = new EventEmitter<ActiveTab>();
  readonly legalAge = LEGAL_AGE;
}
