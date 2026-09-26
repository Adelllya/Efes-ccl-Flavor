import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Подвал на всех страницах сайта: предупреждение о вреде алкоголя и ссылка на /privacy.
 * В меню заведения добавляется строка о том, что алкоголь подают только с 21 года.
 */
@Component({
  selector: 'app-site-footer',
  standalone: true,
  template: `
    <footer class="sf">
      <p class="sf-warning">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        Чрезмерное употребление алкоголя вредит вашему здоровью
      </p>
      @if (menu) {
        <p class="sf-line">Заказ уходит персоналу заведения. Алкоголь подают только гостям старше 21 года, могут попросить документ.</p>
      }
      <p class="sf-line">
        Flavor Tree: справочник по напиткам и подбор к блюдам для гостей старше 21 года.
        <a href="/privacy" (click)="open($event)">Конфиденциальность</a>
      </p>
    </footer>
  `,
  styles: [`
    .sf {
      margin-top: var(--space-5xl);
      padding: var(--space-xl) var(--space-lg) 0;
      border-top: 1px solid var(--line);
      text-align: center;
    }
    .sf-warning {
      display: inline-flex;
      align-items: center;
      gap: var(--space-sm);
      margin: 0 0 var(--space-sm);
      font-size: 0.88rem;
      font-weight: 700;
      color: var(--foam-dim);
    }
    .sf-warning svg { flex-shrink: 0; color: var(--beer-mid); }
    .sf-line {
      margin: 0 auto var(--space-xs);
      max-width: 640px;
      font-size: 0.78rem;
      line-height: 1.5;
      color: var(--muted);
    }
    .sf-line a {
      color: var(--beer-mid);
      font-weight: 600;
      white-space: nowrap;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .sf-line a:hover { color: var(--beer-deep); }
  `]
})
export class SiteFooterComponent {
  /** Открыто меню заведения. */
  @Input() menu = false;
  /** Переход на /privacy без перезагрузки страницы. */
  @Output() privacy = new EventEmitter<void>();

  open(event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    this.privacy.emit();
  }
}
