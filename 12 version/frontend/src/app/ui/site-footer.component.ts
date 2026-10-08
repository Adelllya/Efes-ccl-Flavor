import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ActiveTab } from '../models/navigation';
import { LEGAL_AGE } from '../services/age-gate.service';

/**
 * Подвал на всех страницах сайта, кроме панели: разделы, слой ответственного потребления,
 * происхождение проекта и ссылка на /privacy. В меню заведения добавляется строка о том,
 * что алкоголь подают только с 21 года.
 */
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
        <div>
          <p class="sf-warning">Чрезмерное употребление алкоголя вредит вашему здоровью</p>
          <p>
            Сайт предназначен для лиц старше {{ legalAge }} года. Это информация о вкусе и культуре подачи, а не реклама.
            Не садитесь за руль после алкоголя.
          </p>
          @if (menu) {
            <p>Заказ уходит персоналу заведения. Алкоголь подают только гостям старше {{ legalAge }} года, могут попросить документ.</p>
          }
          <p><a href="/privacy" (click)="open($event)">Конфиденциальность</a></p>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    :host { display: block; position: relative; z-index: 1; }
    .sf {
      max-width: 1280px;
      margin: var(--space-6xl) auto 0;
      padding: var(--space-3xl) 0 calc(var(--space-3xl) + 72px);
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
    .sf-care p { margin: 0 0 var(--space-xs); font-size: 0.8125rem; line-height: 1.6; color: var(--muted); }
    .sf-care p:last-child { margin-bottom: 0; }
    .sf-care .sf-warning { font-size: 0.88rem; font-weight: 700; color: var(--foam-dim); }
    .sf-care a {
      color: var(--beer-mid);
      font-weight: 600;
      white-space: nowrap;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .sf-care a:hover { color: var(--beer-deep); }
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
      .sf { padding: var(--space-2xl) 0 calc(var(--space-2xl) + 88px); margin-top: var(--space-4xl); }
      .sf-nav { grid-template-columns: 1fr 1fr; gap: 0 var(--space-lg); width: 100%; }
    }
  `]
})
export class SiteFooterComponent {
  /** Открыто меню заведения. */
  @Input() menu = false;
  /** Переход на /privacy без перезагрузки страницы. */
  @Output() privacy = new EventEmitter<void>();
  /** Переход в раздел сайта из подвала. */
  @Output() navigate = new EventEmitter<ActiveTab>();
  readonly legalAge = LEGAL_AGE;

  open(event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    this.privacy.emit();
  }
}
