import { Component, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { AgeGateService, LEGAL_AGE, ageFrom } from '../services/age-gate.service';

/**
 * Окно проверки возраста поверх всего сайта. Нативный <dialog> в режиме showModal
 * делает страницу под ним недоступной для клавиатуры и скринридера; Esc окно не закрывает.
 */
@Component({
  selector: 'app-age-gate',
  standalone: true,
  template: `
    <dialog #gate class="ag" aria-labelledby="ag-title" aria-describedby="ag-text" (cancel)="$event.preventDefault()" (close)="onClose()">
      <div class="ag-box">
        <div class="ag-logo" aria-hidden="true"><img src="decor/logo.png" alt="" /></div>
        <span class="ag-age" aria-hidden="true">{{ legalAge }}+</span>

        @if (age.denied()) {
          <h1 id="ag-title" class="ag-title">Доступ закрыт</h1>
          <p id="ag-text" class="ag-text">
            Сайт рассказывает о пиве и предназначен только для совершеннолетних от {{ legalAge }} года.
            Возвращайтесь, когда вам исполнится {{ legalAge }}.
          </p>
        } @else {
          <h1 id="ag-title" class="ag-title">Вам уже есть {{ legalAge }} год?</h1>
          <p id="ag-text" class="ag-text">
            Flavor Tree рассказывает о вкусе пива. В Казахстане такая информация предназначена
            только для совершеннолетних от {{ legalAge }} года. Введите дату рождения.
          </p>

          <form class="ag-form" (submit)="submit($event)" novalidate>
            <fieldset class="ag-fields" [attr.aria-describedby]="error() ? 'ag-error' : null">
              <legend class="ag-sr">Дата рождения</legend>
              <label class="ag-field">
                <span>День</span>
                <input #dayEl type="text" inputmode="numeric" autocomplete="bday-day" maxlength="2" placeholder="ДД"
                       [value]="day()" (input)="onInput('day', $event, monthEl)" [attr.aria-invalid]="!!error()" />
              </label>
              <label class="ag-field">
                <span>Месяц</span>
                <input #monthEl type="text" inputmode="numeric" autocomplete="bday-month" maxlength="2" placeholder="ММ"
                       [value]="month()" (input)="onInput('month', $event, yearEl)" [attr.aria-invalid]="!!error()" />
              </label>
              <label class="ag-field ag-field-year">
                <span>Год</span>
                <input #yearEl type="text" inputmode="numeric" autocomplete="bday-year" maxlength="4" placeholder="ГГГГ"
                       [value]="year()" (input)="onInput('year', $event, null)" [attr.aria-invalid]="!!error()" />
              </label>
            </fieldset>
            @if (error(); as text) {
              <p id="ag-error" class="ag-error" role="alert">{{ text }}</p>
            }

            <label class="ag-remember">
              <input type="checkbox" [checked]="remember()" (change)="remember.set($any($event.target).checked)" />
              <span>Запомнить на этом устройстве на 30 дней <small>Не отмечайте на чужом или общем устройстве</small></span>
            </label>

            <button type="submit" class="btn-amber ag-submit" [disabled]="!filled()">Войти на сайт</button>
          </form>

          <p class="ag-note">
            Дату рождения мы не сохраняем: запоминаем только, что проверка пройдена.
            Чрезмерное употребление алкоголя вредит вашему здоровью.
          </p>
        }
      </div>
    </dialog>
  `,
  styles: [`
    .ag {
      width: min(460px, calc(100vw - 32px));
      max-width: none;
      max-height: calc(100dvh - 32px);
      margin: auto;
      padding: 0;
      border: none;
      border-radius: var(--radius-2xl);
      background: var(--bg-1);
      color: var(--foam);
      box-shadow: 0 30px 80px -20px rgba(28, 25, 23, 0.6);
      overflow-y: auto;
    }
    /* Плотное затемнение: содержимое сайта до проверки не читается */
    .ag:focus { outline: none; }
    .ag::backdrop { background: rgba(28, 25, 23, 0.88); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
    .ag-box { position: relative; padding: var(--space-3xl) var(--space-2xl) var(--space-2xl); text-align: center; }
    .ag-logo { width: 64px; height: 64px; margin: 0 auto var(--space-lg); border-radius: 18px; overflow: hidden; box-shadow: var(--shadow-md); }
    .ag-logo img { width: 100%; height: 100%; object-fit: cover; }
    .ag-age {
      position: absolute;
      top: var(--space-lg);
      right: var(--space-lg);
      min-width: 44px;
      padding: 4px 10px;
      border: 2px solid var(--beer-mid);
      border-radius: var(--radius-full);
      color: var(--beer-deep);
      font-weight: 800;
      font-size: 0.875rem;
    }
    .ag-title { margin: 0 0 var(--space-md); font-family: var(--font-heading); font-size: clamp(1.5rem, 5vw, 1.9rem); font-weight: 800; line-height: 1.15; }
    .ag-text { margin: 0 0 var(--space-xl); line-height: 1.6; color: var(--foam-dim); }
    .ag-form { display: grid; gap: var(--space-lg); }
    .ag-fields { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: var(--space-md); margin: 0; padding: 0; border: none; min-width: 0; }
    .ag-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    .ag-field { display: grid; gap: 6px; text-align: left; min-width: 0; }
    .ag-field span { font-size: 0.8125rem; font-weight: 700; color: var(--foam-dim); }
    .ag-field input {
      width: 100%;
      min-width: 0;
      height: 56px;
      padding: 0 8px;
      border: 1.5px solid rgba(180, 83, 9, 0.3);
      border-radius: var(--radius-md);
      background: var(--bg-0);
      color: var(--foam);
      font: inherit;
      font-size: 1.25rem;
      font-weight: 700;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .ag-field input::placeholder { color: #A8A29E; font-weight: 500; }
    .ag-field input:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; border-color: var(--beer-mid); }
    .ag-field input[aria-invalid="true"] { border-color: #dc2626; }
    .ag-error { margin: 0; text-align: left; font-size: 0.9375rem; font-weight: 600; color: #991b1b; }
    .ag-remember { display: flex; align-items: center; gap: var(--space-md); min-height: 44px; text-align: left; cursor: pointer; color: var(--foam-dim); }
    .ag-remember input { width: 20px; height: 20px; flex-shrink: 0; accent-color: var(--beer-mid); }
    .ag-remember small { display: block; font-size: 0.75rem; color: var(--muted); }
    .ag-submit { width: 100%; min-height: 52px; justify-content: center; font-size: 1rem; }
    .ag-submit:disabled { opacity: 0.5; cursor: default; }
    .ag-note { margin: var(--space-xl) 0 0; font-size: 0.8125rem; line-height: 1.55; color: var(--muted); }

    @media (max-width: 420px) {
      .ag-box { padding: var(--space-2xl) var(--space-lg) var(--space-xl); }
      .ag-fields { gap: var(--space-sm); }
    }
  `],
})
export class AgeGateComponent {
  readonly age = inject(AgeGateService);
  readonly legalAge = LEGAL_AGE;

  private gate = viewChild<ElementRef<HTMLDialogElement>>('gate');
  private dayEl = viewChild<ElementRef<HTMLInputElement>>('dayEl');

  readonly day = signal('');
  readonly month = signal('');
  readonly year = signal('');
  readonly remember = signal(true);
  readonly error = signal('');
  readonly filled = computed(() => !!this.day() && !!this.month() && this.year().length === 4);

  constructor() {
    afterNextRender(() => {
      if (this.age.passed()) return;
      const dialog = this.gate()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
      this.dayEl()?.nativeElement.focus();
    });
    // Проверка пройдена: закрываем окно, страница под ним снова доступна
    effect(() => {
      if (!this.age.passed()) return;
      const dialog = this.gate()?.nativeElement;
      if (dialog?.open) dialog.close();
    });
  }

  /**
   * Браузер может закрыть окно по Esc, не спросив страницу (если гость ещё ни разу не нажал
   * на странице). Пока возраст не подтверждён, окно открываем снова.
   */
  onClose() {
    if (this.age.passed()) return;
    queueMicrotask(() => {
      const dialog = this.gate()?.nativeElement;
      if (dialog && !dialog.open && !this.age.passed()) dialog.showModal();
    });
  }

  /** Только цифры; когда поле заполнено, фокус уходит в следующее. */
  onInput(field: 'day' | 'month' | 'year', event: Event, next: HTMLInputElement | null) {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, field === 'year' ? 4 : 2);
    input.value = digits;
    this[field].set(digits);
    this.error.set('');
    if (next && digits.length === 2) next.focus();
  }

  submit(event: Event) {
    event.preventDefault();
    if (!this.filled()) return;
    const years = ageFrom(Number(this.day()), Number(this.month()), Number(this.year()));
    if (years === null) {
      this.error.set('Такой даты нет. Проверьте день, месяц и год.');
      return;
    }
    if (years < LEGAL_AGE) {
      this.age.deny();
      return;
    }
    this.age.allow(this.remember());
  }
}
