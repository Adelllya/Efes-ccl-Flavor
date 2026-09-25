import { Component, EventEmitter, Output, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { SelectionService } from '../../services/selection.service';
import { ActiveTab } from '../../models/navigation';
import { AuthComponent } from '../auth/auth.component';

interface Feedback {
  ok: boolean;
  text: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, DatePipe, AuthComponent],
  template: `
    @if (auth.user(); as u) {
      <div class="mb-2xl">
        <h1 class="section-header">Профиль</h1>
        <p class="section-subtitle">Ваш аккаунт, роль и настройки входа</p>
      </div>

      <div class="profile-grid">
        <aside class="glass-panel p-2xl">
          <div class="flex items-center gap-lg mb-xl">
            <div class="profile-avatar" aria-hidden="true">{{ initial(u.username) }}</div>
            <div>
              <div class="font-bold text-lg">{{ u.username }}</div>
              <span class="badge">{{ u.role_display }}</span>
            </div>
          </div>

          <dl class="profile-list">
            <div class="profile-row">
              <dt>Имя</dt>
              <dd>{{ u.first_name || '-' }}</dd>
            </div>
            <div class="profile-row">
              <dt>Email</dt>
              <dd>{{ u.email || '-' }}</dd>
            </div>
            <div class="profile-row">
              <dt>Заведение</dt>
              <dd>
                @if (u.venue) {
                  <button type="button" class="auth-link" (click)="openVenue(u.venue.slug)">{{ u.venue.name }}</button>
                } @else {
                  -
                }
              </dd>
            </div>
            @if (u.date_joined) {
              <div class="profile-row">
                <dt>С нами с</dt>
                <dd>{{ u.date_joined | date:'dd.MM.yyyy' }}</dd>
              </div>
            }
          </dl>

          <div class="flex flex-col gap-sm profile-actions">
            @if (auth.canSeePanel()) {
              <button type="button" class="btn-amber btn-block" (click)="navigate.emit('admin')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
                Открыть панель
              </button>
            }
            <button type="button" class="btn-outline btn-block" (click)="logout()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
              Выйти
            </button>
          </div>
        </aside>

        <div class="flex flex-col gap-2xl">
          <section class="glass-panel p-2xl">
            <h3 class="mb-lg">Данные</h3>
            <form (ngSubmit)="saveProfile()" novalidate>
              <div class="auth-field">
                <label class="auth-label" for="profile-first-name">Имя</label>
                <input id="profile-first-name" class="input" name="firstName" [(ngModel)]="firstName" autocomplete="given-name" />
              </div>
              <div class="auth-field">
                <label class="auth-label" for="profile-email">Email</label>
                <input id="profile-email" class="input" name="email" type="email" [(ngModel)]="email" autocomplete="email" />
              </div>
              <div class="flex items-center gap-lg flex-wrap">
                <button type="submit" class="btn-amber" [disabled]="savingProfile()">
                  {{ savingProfile() ? 'Сохраняем...' : 'Сохранить' }}
                </button>
                @if (profileFeedback(); as f) {
                  <span class="auth-feedback" [class.error]="!f.ok">{{ f.text }}</span>
                }
              </div>
            </form>
          </section>

          <section class="glass-panel p-2xl">
            <h3 class="mb-lg">Сменить пароль</h3>
            <form (ngSubmit)="savePassword()" novalidate>
              <div class="auth-field">
                <label class="auth-label" for="profile-old-password">Старый пароль</label>
                <input id="profile-old-password" class="input" name="oldPassword" type="password"
                       [(ngModel)]="oldPassword" autocomplete="current-password" />
              </div>
              <div class="auth-field">
                <label class="auth-label" for="profile-new-password">Новый пароль</label>
                <input id="profile-new-password" class="input" name="newPassword" type="password"
                       [(ngModel)]="newPassword" autocomplete="new-password" />
                <span class="text-xs text-muted">Не короче 8 символов, не только цифры</span>
              </div>
              <div class="auth-field">
                <label class="auth-label" for="profile-confirm-password">Повторите новый пароль</label>
                <input id="profile-confirm-password" class="input" name="confirmPassword" type="password"
                       [(ngModel)]="confirmPassword" autocomplete="new-password" />
              </div>
              <div class="flex items-center gap-lg flex-wrap">
                <button type="submit" class="btn-outline" [disabled]="savingPassword()">
                  {{ savingPassword() ? 'Меняем...' : 'Сменить пароль' }}
                </button>
                @if (passwordFeedback(); as f) {
                  <span class="auth-feedback" [class.error]="!f.ok">{{ f.text }}</span>
                }
              </div>
            </form>
          </section>
        </div>
      </div>
    } @else if (!auth.ready()) {
      <p class="text-muted text-center p-4xl">Проверяем сессию...</p>
    } @else {
      <!-- Обновили /profile без сессии: показываем вход, после него профиль появится сам -->
      <app-auth mode="login" (switchMode)="navigate.emit($event)" />
    }
  `
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
  private readonly selection = inject(SelectionService);

  @Output() navigate = new EventEmitter<ActiveTab>();

  firstName = '';
  email = '';
  oldPassword = '';
  newPassword = '';
  confirmPassword = '';

  readonly savingProfile = signal(false);
  readonly savingPassword = signal(false);
  readonly profileFeedback = signal<Feedback | null>(null);
  readonly passwordFeedback = signal<Feedback | null>(null);

  constructor() {
    // Пользователь может подгрузиться позже (обновление страницы): поля заполняем по факту
    effect(() => {
      const u = this.auth.user();
      if (u) {
        this.firstName = u.first_name;
        this.email = u.email;
      }
    });
  }

  initial(username: string): string {
    return (username || '?').charAt(0).toUpperCase();
  }

  openVenue(slug: string) {
    this.selection.openVenue(slug);
    this.navigate.emit('menu');
  }

  /** Выход ведёт на страницу входа, как и кнопка в шапке. */
  logout() {
    this.auth.logout();
    this.navigate.emit('login');
  }

  saveProfile() {
    if (this.savingProfile()) return;
    this.savingProfile.set(true);
    this.auth.updateProfile({ first_name: this.firstName.trim(), email: this.email.trim() }).subscribe({
      next: () => {
        this.savingProfile.set(false);
        this.flash(this.profileFeedback, { ok: true, text: 'Сохранено' });
      },
      error: (err: unknown) => {
        this.savingProfile.set(false);
        this.flash(this.profileFeedback, { ok: false, text: 'Ошибка: ' + AuthService.errorText(err) });
      }
    });
  }

  savePassword() {
    if (this.savingPassword()) return;
    if (!this.oldPassword || !this.newPassword) {
      this.flash(this.passwordFeedback, { ok: false, text: 'Заполните оба пароля' });
      return;
    }
    if (this.newPassword.length < 8) {
      this.flash(this.passwordFeedback, { ok: false, text: 'Новый пароль должен быть не короче 8 символов' });
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.flash(this.passwordFeedback, { ok: false, text: 'Пароли не совпадают' });
      return;
    }
    this.savingPassword.set(true);
    this.auth.changePassword(this.oldPassword, this.newPassword).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.oldPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.flash(this.passwordFeedback, { ok: true, text: 'Пароль изменён' });
      },
      error: (err: unknown) => {
        this.savingPassword.set(false);
        this.flash(this.passwordFeedback, { ok: false, text: 'Ошибка: ' + AuthService.errorText(err) });
      }
    });
  }

  /** Текст рядом с кнопкой на несколько секунд; ошибка держится дольше. */
  private flash(target: typeof this.profileFeedback, value: Feedback) {
    target.set(value);
    setTimeout(() => {
      if (target() === value) target.set(null);
    }, value.ok ? 3000 : 6000);
  }
}
