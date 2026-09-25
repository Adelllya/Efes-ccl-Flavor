import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { AuthUser, UserRole, Venue } from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { ROLE_CHOICES, flash, formatDate, initialOf, isErrorText } from './panel-shared';

/** Черновик формы: venue '' значит "без заведения". */
interface UserDraft {
  role: UserRole;
  venue: string;
  is_active: boolean;
}

type UserPatch = { role?: UserRole; venue?: string | null; is_active?: boolean };
type RoleFilter = 'all' | UserRole;

/** Вкладка "Пользователи" (только модератор): список слева, роль, заведение и активность справа. */
@Component({
  selector: 'panel-users',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent],
  template: `
    <div class="wa-page" [class.has-selection]="!!selectedId()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Пользователи <span class="wa-count">{{ users().length }}</span></h2>
          <button type="button" class="wa-iconbtn" title="Обновить" [disabled]="loading()" (click)="load()">
            <panel-icon name="refresh" />
          </button>
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Логин, имя или email" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <div class="wa-pills">
          @for (p of pills; track p.value) {
            <button type="button" class="wa-pill" [class.active]="filter() === p.value" (click)="filter.set(p.value)">
              {{ p.label }}
            </button>
          }
        </div>
        <div class="wa-rows">
          @if (loading() && !users().length) {
            <p class="wa-empty">Загрузка...</p>
          } @else if (loadError()) {
            <p class="wa-error">{{ loadError() }}</p>
          } @else {
            @for (u of filtered(); track u.id) {
              <button type="button" class="wa-row" [class.active]="selectedId() === u.id" (click)="select(u.id)">
                <span class="wa-avatar">{{ initial(u.first_name || u.username) }}</span>
                <span class="wa-row-body">
                  <span class="wa-row-title">{{ u.username }}@if (isSelf(u)) {<span class="wa-dot"></span>это вы}</span>
                  <span class="wa-row-sub">{{ u.email || u.first_name || 'без email' }}</span>
                </span>
                <span class="wa-row-meta">
                  <span class="wa-chip" [class.wa-chip-accent]="u.role === 'moderator'">{{ u.role_display }}</span>
                  @if (u.is_active === false) { <span class="wa-chip wa-chip-warn">Отключён</span> }
                  @else if (u.venue) { <span class="wa-time">{{ u.venue.name }}</span> }
                </span>
              </button>
            } @empty {
              <p class="wa-empty">{{ users().length ? 'Ничего не найдено' : 'Пользователей пока нет' }}</p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (u of selectedOne(); track u.id) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="select(null)"><panel-icon name="arrowLeft" /> К списку</button>

            <div class="wa-card">
              <div class="wa-card-head">
                <span class="wa-avatar wa-avatar-lg">{{ initial(u.first_name || u.username) }}</span>
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">{{ u.username }}</h3>
                  <p class="wa-card-sub">{{ u.first_name || 'Имя не указано' }}<span class="wa-dot"></span>{{ u.email || 'email не указан' }}</p>
                </div>
                <div class="wa-chips">
                  <span class="wa-chip">{{ u.role_display }}</span>
                  @if (u.is_superuser) { <span class="wa-chip wa-chip-accent">Суперпользователь</span> }
                  @if (isSelf(u)) { <span class="wa-chip wa-chip-approved">Это вы</span> }
                  @if (u.is_active === false) { <span class="wa-chip wa-chip-warn">Отключён</span> }
                </div>
              </div>
              <dl class="wa-facts">
                <div><dt>Зарегистрирован</dt><dd>{{ formatDate(u.date_joined) || 'нет данных' }}</dd></div>
                <div><dt>Заведение</dt><dd>{{ u.venue?.name || 'нет' }}</dd></div>
              </dl>
              @if (locked(u)) {
                <p class="wa-info"><panel-icon name="alert" /> Суперпользователя может менять только суперпользователь</p>
              } @else if (isSelf(u)) {
                <p class="wa-info"><panel-icon name="alert" /> Свою роль и активность менять нельзя, заведение можно</p>
              } @else if (u.is_superuser) {
                <p class="wa-info"><panel-icon name="alert" /> Роль суперпользователя изменить нельзя, он всегда модератор</p>
              }
            </div>

            @if (draft(); as d) {
              <div class="wa-card">
                <h3 class="wa-card-title">Доступ</h3>
                <div class="wa-fields">
                  <div class="wa-field">
                    <span class="wa-label">Роль</span>
                    <ft-select [options]="roleOptions" [ngModel]="d.role" (ngModelChange)="d.role = $event"
                               [disabled]="locked(u) || isSelf(u) || u.is_superuser" />
                  </div>
                  <div class="wa-field">
                    <span class="wa-label">Заведение</span>
                    <ft-select [options]="venueOptions()" [searchable]="true" placeholder="Без заведения"
                               searchPlaceholder="Название заведения"
                               [ngModel]="d.venue" (ngModelChange)="d.venue = $event" [disabled]="locked(u)" />
                  </div>
                  <label class="wa-check wa-field-wide">
                    <input type="checkbox" [ngModel]="d.is_active" (ngModelChange)="d.is_active = $event"
                           [disabled]="locked(u) || isSelf(u)" /> Аккаунт активен
                  </label>
                </div>
                <p class="wa-muted">Роль задаёт вкладки панели. Заведение нужно администратору заведения: у одного пользователя оно может быть только одно, у прежнего владельца оно снимется.</p>
                <div class="wa-actions">
                  <button type="button" class="btn-amber" [disabled]="saving() || locked(u) || !hasChanges(u, d)" (click)="save(u, d)">
                    <panel-icon name="save" /> {{ saving() ? 'Сохраняем...' : 'Сохранить' }}
                  </button>
                  @if (hasChanges(u, d) && !saving()) {
                    <button type="button" class="btn-outline" (click)="draft.set(toDraft(u))">
                      <panel-icon name="undo" /> Отменить
                    </button>
                  }
                  @if (msg()) {
                    <p class="wa-msg" [class.error]="isError(msg())">{{ msg() }}</p>
                  }
                </div>
              </div>
            }
          </div>
        } @empty {
          <div class="wa-detail-empty">Выберите элемент слева</div>
        }
      </section>
    </div>
  `
})
export class PanelUsersComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly roleOptions: SelectOption[] = ROLE_CHOICES;
  readonly initial = initialOf;
  readonly pills: { value: RoleFilter; label: string }[] = [
    { value: 'all', label: 'Все' },
    { value: 'moderator', label: 'Модераторы' },
    { value: 'sommelier', label: 'Сомелье' },
    { value: 'restaurant_admin', label: 'Заведения' },
    { value: 'user', label: 'Пользователи' }
  ];
  isError = isErrorText;
  formatDate = formatDate;

  users = signal<AuthUser[]>([]);
  venues = signal<Venue[]>([]);
  loading = signal(true);
  loadError = signal<string | null>(null);
  search = signal('');
  filter = signal<RoleFilter>('all');
  selectedId = signal<number | null>(null);
  draft = signal<UserDraft | null>(null);
  saving = signal(false);
  msg = signal<string | null>(null);

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const f = this.filter();
    return this.users().filter(u =>
      (f === 'all' || u.role === f) &&
      (!q ||
        u.username.toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.first_name || '').toLowerCase().includes(q))
    );
  });

  selectedOne = computed(() => {
    const u = this.users().find(x => x.id === this.selectedId());
    return u ? [u] : [];
  });

  venueOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Без заведения' },
    ...this.venues().map(v => ({
      value: v.id,
      label: v.name,
      hint: v.owner ? 'владелец: ' + v.owner.username : (v.city || 'свободно')
    }))
  ]);

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getUsers().subscribe({
      next: users => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.loadError.set(AuthService.errorText(err));
      }
    });
    this.loadVenues();
  }

  private loadVenues() {
    this.api.getVenues().subscribe({
      next: list => this.venues.set(list),
      error: () => this.venues.set([])
    });
  }

  isSelf(u: AuthUser): boolean {
    return u.id === this.auth.user()?.id;
  }

  /** Суперпользователя правит только суперпользователь; бэкенд отвечает так же. */
  locked(u: AuthUser): boolean {
    return !!u.is_superuser && !this.auth.user()?.is_superuser;
  }

  select(id: number | null) {
    this.selectedId.set(id);
    this.msg.set(null);
    const u = id === null ? null : this.users().find(x => x.id === id);
    this.draft.set(u ? this.toDraft(u) : null);
  }

  toDraft(u: AuthUser): UserDraft {
    return { role: u.role, venue: u.venue?.id ?? '', is_active: u.is_active ?? true };
  }

  /** Отправляем только то, что изменилось: лишний venue снял бы заведение с нового владельца. */
  changes(u: AuthUser, d: UserDraft): UserPatch {
    const patch: UserPatch = {};
    if (!this.isSelf(u) && !u.is_superuser && d.role !== u.role) patch.role = d.role;
    if (d.venue !== (u.venue?.id ?? '')) patch.venue = d.venue || null;
    if (!this.isSelf(u) && d.is_active !== (u.is_active ?? true)) patch.is_active = d.is_active;
    return patch;
  }

  hasChanges(u: AuthUser, d: UserDraft): boolean {
    return Object.keys(this.changes(u, d)).length > 0;
  }

  save(u: AuthUser, d: UserDraft) {
    const patch = this.changes(u, d);
    if (!Object.keys(patch).length) {
      flash(this.msg, 'Изменений нет');
      return;
    }
    this.saving.set(true);
    this.msg.set(null);
    this.api.updateUser(u.id, patch).subscribe({
      next: saved => {
        this.saving.set(false);
        this.users.update(list => list.map(x => x.id === saved.id ? saved : x));
        this.draft.set(this.toDraft(saved));
        flash(this.msg, 'Сохранено');
        if (this.isSelf(saved)) this.auth.loadMe();
        // Заведение сменило владельца: у прежнего оно пропало, перечитываем список и заведения
        if ('venue' in patch) this.load();
      },
      error: err => {
        this.saving.set(false);
        flash(this.msg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }
}
