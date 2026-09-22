import { ChangeDetectionStrategy, Component, booleanAttribute, inject, input } from '@angular/core';
import { I18nService, LOCALES } from '../core/i18n.service';

/**
 * Компактный переключатель языка RU / ҚАЗ / EN (~104px — помещается в шапку на телефоне 390px).
 * Обычные кнопки с aria-pressed: Tab + Enter/Пробел работают нативно. `light` — вариант для тёмной/цветной подложки (шапка меню заведения).
 */
@Component({
  selector: 'ft-lang-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ls" [class.light]="light()" role="group" [attr.aria-label]="i18n.t('lang.aria')">
      @for (l of locales; track l.id) {
        <button type="button" [class.on]="i18n.locale() === l.id" [attr.aria-pressed]="i18n.locale() === l.id"
                [attr.aria-label]="l.label + ' — ' + l.name" [attr.lang]="l.id" [title]="l.name" (click)="i18n.set(l.id)">{{ l.label }}</button>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; flex-shrink: 0; }
    .ls { display: inline-flex; gap: 1px; padding: 2px; border-radius: var(--r-full); background: var(--bg-2); border: 1px solid var(--line-2); }
    button { min-width: 32px; height: 30px; padding: 0 6px; border-radius: var(--r-full); font-size: .68rem; font-weight: 800; letter-spacing: .04em; line-height: 1; color: var(--ink-3); white-space: nowrap; transition: background var(--t-fast), color var(--t-fast); }
    button:hover { color: var(--amber-800); }
    button.on { background: var(--surface); color: var(--amber-800); box-shadow: var(--shadow-1); }
    button:focus-visible { border-radius: var(--r-full); }
    .light { background: rgba(255,255,255,.16); border-color: rgba(255,255,255,.3); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
    .light button { color: rgba(255,255,255,.88); }
    .light button:hover { color: #fff; }
    .light button.on { background: #fff; color: #1E1611; box-shadow: none; }
  `],
})
export class LangSwitchComponent {
  i18n = inject(I18nService);
  light = input(false, { transform: booleanAttribute });
  readonly locales = LOCALES;
}
