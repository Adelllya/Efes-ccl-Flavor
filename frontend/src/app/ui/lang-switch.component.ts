import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LanguageService } from '../i18n/language.service';
import { Lang } from '../i18n/lang-storage';

/**
 * Переключатель языка EN / RU в шапке. Подписи не переводятся (data-no-i18n):
 * коды языков одинаковы в обоих режимах.
 */
@Component({
  selector: 'app-lang-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-no-i18n': '' },
  template: `
    <div class="lang-switch" role="group" [attr.aria-label]="lang.lang() === 'ru' ? 'Язык интерфейса' : 'Interface language'">
      @for (l of langs; track l.code) {
        <button type="button" class="lang-btn" [class.active]="lang.lang() === l.code"
                [attr.aria-pressed]="lang.lang() === l.code" [attr.lang]="l.code" [title]="l.title"
                (click)="lang.set(l.code)">{{ l.label }}</button>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; flex-shrink: 0; }
    .lang-switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      border-radius: var(--radius-full);
      background: rgba(255, 255, 255, 0.7);
      border: 1px solid var(--line);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);
    }
    .lang-btn {
      min-width: 38px;
      height: 32px;
      padding: 0 10px;
      border: none;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--foam-dim);
      font-family: var(--font-body);
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      cursor: pointer;
      transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .lang-btn:hover:not(.active) { color: var(--foam); background-color: var(--beer-glow); }
    .lang-btn.active {
      color: #fff;
      background: var(--grad-cta);
      box-shadow: 0 3px 10px rgba(180, 83, 9, 0.3);
      cursor: default;
    }
    .lang-btn:focus-visible { outline: 2px solid var(--beer-light); outline-offset: 2px; }
    @media (max-width: 768px) {
      .lang-btn { min-width: 34px; height: 30px; padding: 0 8px; font-size: 0.7rem; }
    }
  `]
})
export class LangSwitchComponent {
  readonly lang = inject(LanguageService);
  readonly langs: { code: Lang; label: string; title: string }[] = [
    { code: 'en', label: 'EN', title: 'English' },
    { code: 'ru', label: 'RU', title: 'Русский' }
  ];
}
