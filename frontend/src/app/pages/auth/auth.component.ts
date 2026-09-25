import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

export type AuthMode = 'login' | 'register';

interface DemoAccount {
  username: string;
  password: string;
  role: string;
  hint: string;
}

/** Аккаунты из команды seed_roles: команда пробует роли без регистрации. */
const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: 'moderator', password: 'moderator12345', role: 'Модератор', hint: 'все вкладки панели' },
  { username: 'sommelier', password: 'sommelier12345', role: 'Сомелье', hint: 'сочетания и пирамида' },
  { username: 'restaurant', password: 'restaurant12345', role: 'Администратор заведения', hint: 'меню и блюда' },
  { username: 'guest', password: 'guest12345', role: 'Пользователь', hint: 'только сайт и профиль' }
];

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="auth-wrap">
      <div class="glass-panel auth-card">
        <div class="auth-head">
          <div class="auth-icon">
            @if (isLogin) {
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
            } @else {
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
            }
          </div>
          <h1>{{ isLogin ? 'Вход' : 'Регистрация' }}</h1>
          <p class="text-muted text-sm">
            {{ isLogin ? 'Войдите, чтобы открыть профиль и панель' : 'Создайте аккаунт, чтобы сохранять настройки профиля' }}
          </p>
        </div>

        <form (ngSubmit)="submit()" novalidate>
          <div class="auth-field">
            <label class="auth-label" for="auth-username">{{ isLogin ? 'Логин или email' : 'Логин' }}</label>
            <input id="auth-username" class="input" name="username" [(ngModel)]="username"
                   autocomplete="username" autocapitalize="off" spellcheck="false" required />
          </div>

          @if (!isLogin) {
            <div class="auth-field">
              <label class="auth-label" for="auth-email">Email</label>
              <input id="auth-email" class="input" name="email" type="email" [(ngModel)]="email"
                     autocomplete="email" required />
            </div>
            <div class="auth-field">
              <label class="auth-label" for="auth-first-name">Имя <span class="text-muted">(необязательно)</span></label>
              <input id="auth-first-name" class="input" name="firstName" [(ngModel)]="firstName" autocomplete="given-name" />
            </div>
          }

          <div class="auth-field">
            <label class="auth-label" for="auth-password">Пароль</label>
            <input id="auth-password" class="input" name="password" type="password" [(ngModel)]="password"
                   [attr.autocomplete]="isLogin ? 'current-password' : 'new-password'" required />
            @if (!isLogin) {
              <span class="text-xs text-muted">Не короче 8 символов, не только цифры</span>
            }
          </div>

          @if (!isLogin) {
            <div class="auth-field">
              <label class="auth-label" for="auth-confirm">Повторите пароль</label>
              <input id="auth-confirm" class="input" name="confirm" type="password" [(ngModel)]="confirm"
                     autocomplete="new-password" required />
            </div>
          }

          @if (error()) {
            <div class="auth-error" role="alert">{{ error() }}</div>
          }

          <button type="submit" class="btn-amber btn-block" [disabled]="loading()">
            {{ loading() ? 'Подождите...' : (isLogin ? 'Войти' : 'Создать аккаунт') }}
          </button>
        </form>

        <p class="auth-switch">
          @if (isLogin) {
            Нет аккаунта?
            <button type="button" class="auth-link" (click)="switchMode.emit('register')">Зарегистрироваться</button>
          } @else {
            Уже есть аккаунт?
            <button type="button" class="auth-link" (click)="switchMode.emit('login')">Войти</button>
          }
        </p>

        @if (isLogin && showDemo) {
          <div class="auth-demo">
            <div class="auth-demo-title">Тестовые аккаунты</div>
            @for (a of demo; track a.username) {
              <button type="button" class="auth-demo-row" (click)="fill(a)">
                <span class="auth-demo-role">{{ a.role }} <span class="text-muted">{{ a.hint }}</span></span>
                <code>{{ a.username }} / {{ a.password }}</code>
              </button>
            }
            <p class="text-xs text-muted auth-demo-note">
              Нажмите на строку, чтобы подставить данные. Аккаунты создаёт команда seed_roles на бэкенде.
            </p>
          </div>
        }
      </div>
    </div>
  `
})
export class AuthComponent {
  private readonly auth = inject(AuthService);

  @Input() mode: AuthMode = 'login';
  @Output() done = new EventEmitter<void>();
  @Output() switchMode = new EventEmitter<AuthMode>();

  readonly demo = DEMO_ACCOUNTS;
  /** Только локально: на проде у этих учёток другие пароли. */
  readonly showDemo = environment.demoAccounts;

  username = '';
  email = '';
  firstName = '';
  password = '';
  confirm = '';

  readonly loading = signal(false);
  readonly error = signal('');

  get isLogin(): boolean {
    return this.mode === 'login';
  }

  fill(account: DemoAccount) {
    this.username = account.username;
    this.password = account.password;
    this.error.set('');
  }

  submit() {
    if (this.loading()) return;
    const problem = this.validate();
    if (problem) {
      this.error.set(problem);
      return;
    }
    this.error.set('');
    this.loading.set(true);

    const request = this.isLogin
      ? this.auth.login(this.username.trim(), this.password)
      : this.auth.register({
          username: this.username.trim(),
          email: this.email.trim(),
          password: this.password,
          first_name: this.firstName.trim() || undefined
        });

    request.subscribe({
      next: () => {
        this.loading.set(false);
        this.done.emit();
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(AuthService.errorText(err));
      }
    });
  }

  /** Проверки до запроса: пустые поля и совпадение паролей. Остальное скажет сервер. */
  private validate(): string {
    if (!this.username.trim() || !this.password) return 'Введите логин и пароль';
    if (this.isLogin) return '';
    if (!this.email.trim()) return 'Введите email';
    if (this.password.length < 8) return 'Пароль должен быть не короче 8 символов';
    if (this.password !== this.confirm) return 'Пароли не совпадают';
    return '';
  }
}
