import { Component, EventEmitter, OnInit, Output, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { PreferencesService, TASTE_SCALES } from '../../services/preferences.service';
import { SelectionService } from '../../services/selection.service';
import { ActiveTab } from '../../models/navigation';
import { Brand, CuisineType, TasteKey } from '../../models/flavor-tree.models';
import { AuthComponent } from '../auth/auth.component';
import { CUISINE_CHOICES } from '../sommelier-admin/panel-shared';

/** Названия ступеней Школы, как у курсов на бэкенде. */
const LEVEL_NAMES = ['Ещё не начато', 'Новичок', 'Исследователь', 'Знаток', 'Сомелье'];

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
            <button type="button" class="btn-ghost btn-block" (click)="logout(true)"
                    title="Все устройства под этим аккаунтом выйдут из системы">
              Выйти на всех устройствах
            </button>
          </div>
        </aside>

        <div class="flex flex-col gap-2xl">
          <section class="glass-panel p-2xl">
            <div class="flex items-center justify-between gap-md flex-wrap mb-sm">
              <h3>Мой вкус</h3>
              <span class="badge">Школа: {{ levelName() }}</span>
            </div>
            <p class="text-muted text-sm mb-xl">Отметьте, какое пиво вам нравится. По этим шкалам мы подберём сорта под вас. Шкалу, которая не важна, можно оставить пустой.</p>

            <div class="taste-grid">
              @for (s of scales; track s.key) {
                <div class="taste-row">
                  <div class="taste-head">
                    <span class="font-semibold">{{ s.label }}</span>
                    @if (taste[s.key] !== null) {
                      <span class="taste-value">{{ taste[s.key] }}/10</span>
                      <button type="button" class="auth-link text-xs" (click)="taste[s.key] = null">не важно</button>
                    } @else {
                      <button type="button" class="auth-link text-xs" (click)="taste[s.key] = 5">указать</button>
                    }
                  </div>
                  @if (taste[s.key] !== null) {
                    <input class="taste-range" type="range" min="0" max="10" [attr.aria-label]="s.label"
                           [(ngModel)]="taste[s.key]" [name]="'taste-' + s.key" />
                    <div class="taste-ends text-xs text-muted"><span>{{ s.low }}</span><span>{{ s.high }}</span></div>
                  } @else {
                    <p class="text-xs text-muted">Не важно</p>
                  }
                </div>
              }
            </div>

            <h4 class="mb-md taste-gap">Любимые кухни</h4>
            <div class="flex gap-sm flex-wrap mb-xl">
              @for (c of cuisineChoices; track c.value) {
                <button type="button" class="btn-outline taste-chip" [class.active]="cuisines.has(c.value)"
                        [attr.aria-pressed]="cuisines.has(c.value)" (click)="toggleCuisine(c.value)">{{ c.label }}</button>
              }
            </div>

            <div class="flex items-center gap-lg flex-wrap">
              <button type="button" class="btn-amber" [disabled]="savingTaste() || !prefs.prefs()" (click)="saveTaste()">
                {{ savingTaste() ? 'Сохраняем...' : 'Сохранить вкус' }}
              </button>
              @if (tasteFeedback(); as f) {
                <span class="auth-feedback" [class.error]="!f.ok">{{ f.text }}</span>
              }
            </div>
          </section>

          <section class="glass-panel p-2xl">
            <h3 class="mb-lg">Подходит вам</h3>
            @if (brandsFailed()) {
              <p class="text-muted text-sm mb-lg" role="alert">
                Не удалось загрузить сорта.
                <button type="button" class="auth-link" (click)="loadBrands()">Обновить</button>
              </p>
            }
            @if (matches().length) {
              <div class="flex flex-col gap-sm">
                @for (m of matches(); track m.brand.id) {
                  <button type="button" class="taste-brand" (click)="openBrand(m.brand.id)">
                    <span class="font-semibold">{{ m.brand.name }}</span>
                    <span class="text-sm text-muted">{{ m.brand.style }}</span>
                    <span class="taste-value">{{ m.percent }}%</span>
                  </button>
                }
              </div>
            } @else {
              <p class="text-muted text-sm">Заполните хотя бы одну шкалу вкуса и сохраните, и здесь появятся сорта под вас.</p>
            }

            <h3 class="mb-lg taste-gap">Любимые сорта</h3>
            @if (favoriteBrands().length) {
              <div class="flex flex-col gap-sm">
                @for (b of favoriteBrands(); track b.id) {
                  <div class="taste-brand">
                    <button type="button" class="auth-link font-semibold" (click)="openBrand(b.id)">{{ b.name }}</button>
                    <span class="text-sm text-muted">{{ b.style }}</span>
                    <button type="button" class="btn-ghost text-sm" [attr.aria-label]="'Убрать ' + b.name" (click)="removeFavorite(b.id)">Убрать</button>
                  </div>
                }
              </div>
            } @else {
              <p class="text-muted text-sm">Пока пусто. Нажмите на сердечко на странице сорта, и он появится здесь.</p>
            }
          </section>

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
  `,
  styles: [`
    .taste-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--space-lg) var(--space-2xl);
    }
    .taste-head {
      display: flex;
      align-items: baseline;
      gap: var(--space-sm);
    }
    .taste-head .auth-link { margin-left: auto; }
    .taste-value {
      color: var(--beer-mid);
      font-weight: 700;
      font-size: 0.9rem;
    }
    .taste-range {
      width: 100%;
      margin: 8px 0 2px;
      accent-color: var(--beer-mid);
    }
    .taste-ends {
      display: flex;
      justify-content: space-between;
    }
    .taste-gap { margin-top: var(--space-xl); }
    .taste-chip {
      padding: 6px 14px;
      font-size: 0.875rem;
    }
    .taste-brand {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--line-subtle);
      border-radius: var(--radius-md);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
    }
    button.taste-brand { cursor: pointer; }
    button.taste-brand:hover { border-color: var(--beer-light); }
    .taste-brand > :last-child { margin-left: auto; }
  `]
})
export class ProfileComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly prefs = inject(PreferencesService);
  private readonly api = inject(ApiService);
  private readonly selection = inject(SelectionService);

  readonly scales = TASTE_SCALES;
  readonly cuisineChoices = CUISINE_CHOICES;
  /** Форма вкуса: null - шкала не важна. */
  taste: Record<TasteKey, number | null> = emptyTaste();
  cuisines = new Set<CuisineType>();
  readonly savingTaste = signal(false);
  readonly tasteFeedback = signal<Feedback | null>(null);

  private readonly brands = signal<Brand[]>([]);
  /** Каталог не загрузился: списки ниже пусты не потому, что сортов нет. */
  readonly brandsFailed = signal(false);
  /** Снимок формы вкуса на момент заполнения с сервера: по нему видно несохранённые правки. */
  private tasteSaved = '';
  readonly matches = computed(() => this.prefs.match(this.brands()));
  readonly favoriteBrands = computed(() => {
    const fav = this.prefs.favorites();
    return this.brands().filter(b => fav.has(b.id));
  });
  readonly levelName = computed(() => LEVEL_NAMES[this.prefs.prefs()?.sommelier_level ?? 0] ?? LEVEL_NAMES[0]);

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
    // Предпочтения приходят отдельным запросом после входа и меняются при каждом
    // снятии любимого сорта. Форму заполняем в первый раз и пока в ней нет
    // несохранённых правок: иначе "Убрать" у сорта сбрасывало сдвинутые ползунки.
    effect(() => {
      const p = this.prefs.prefs();
      if (!p) return;
      if (this.tasteSaved && this.tasteSnapshot() !== this.tasteSaved) return;
      const form = emptyTaste();
      for (const s of TASTE_SCALES) form[s.key] = p.taste[s.key] ?? null;
      this.taste = form;
      this.cuisines = new Set(p.cuisines);
      this.tasteSaved = this.tasteSnapshot();
    });
  }

  ngOnInit() {
    this.loadBrands();
  }

  loadBrands() {
    this.brandsFailed.set(false);
    this.api.getBrands().subscribe({
      next: list => this.brands.set(list),
      error: () => this.brandsFailed.set(true)
    });
  }

  /** Форма вкуса одной строкой: шкалы по порядку и кухни по алфавиту. */
  private tasteSnapshot(): string {
    const scales = TASTE_SCALES.map(s => this.taste[s.key] === null ? null : Number(this.taste[s.key]));
    return JSON.stringify([scales, [...this.cuisines].sort()]);
  }

  toggleCuisine(c: CuisineType) {
    const next = new Set(this.cuisines);
    if (next.has(c)) next.delete(c); else next.add(c);
    this.cuisines = next;
  }

  saveTaste() {
    if (this.savingTaste()) return;
    const taste: Partial<Record<TasteKey, number>> = {};
    for (const s of TASTE_SCALES) {
      const v = this.taste[s.key];
      if (v !== null) taste[s.key] = Number(v);
    }
    this.savingTaste.set(true);
    const sent = this.tasteSnapshot();
    this.prefs.save({ taste, cuisines: [...this.cuisines] }).subscribe({
      next: () => {
        this.savingTaste.set(false);
        // Отправленное сохранено: если гость не правил форму дальше, она снова без правок
        this.tasteSaved = sent;
        this.flash(this.tasteFeedback, { ok: true, text: 'Сохранено' });
      },
      error: (err: unknown) => {
        this.savingTaste.set(false);
        this.flash(this.tasteFeedback, { ok: false, text: 'Ошибка: ' + AuthService.errorText(err) });
      }
    });
  }

  openBrand(id: string) {
    this.selection.open(id);
    this.navigate.emit('beer');
  }

  removeFavorite(id: string) {
    this.prefs.toggleFavorite(id).subscribe({ error: () => undefined });
  }

  initial(username: string): string {
    return (username || '?').charAt(0).toUpperCase();
  }

  openVenue(slug: string) {
    this.selection.openVenue(slug);
    this.navigate.emit('menu');
  }

  /** Выход ведёт на страницу входа, как и кнопка в шапке. */
  logout(everywhere = false) {
    this.auth.logout(everywhere);
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

function emptyTaste(): Record<TasteKey, number | null> {
  return { body: null, bitterness: null, freshness: null, sweetness: null, roast: null, strength: null };
}
