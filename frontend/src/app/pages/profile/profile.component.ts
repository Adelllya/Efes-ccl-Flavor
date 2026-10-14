import { Component, DestroyRef, ElementRef, EventEmitter, OnInit, Output, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { PreferencesService, TASTE_SCALES } from '../../services/preferences.service';
import { SelectionService } from '../../services/selection.service';
import { ActiveTab } from '../../models/navigation';
import { Academy, AcademyLevel, Brand, CuisineType, Passport, TasteKey, UserRole } from '../../models/flavor-tree.models';
import { CUISINE_CHOICES } from '../sommelier-admin/panel-shared';

interface Feedback {
  ok: boolean;
  text: string;
}

/** Значок знаний: только за уроки и тесты Академии (и слух на нотах), не за покупки. */
interface KnowledgeBadge {
  id: string;
  title: string;
  hint: string;
  earned: boolean;
  icon: 'level' | 'book' | 'nose';
  level?: number;
}

/** Шаг трека персонала: урок или тест ступеней про подачу и разговор с гостем. */
interface StaffStep {
  kind: 'lesson' | 'quiz';
  level: number;
  title: string;
  done: boolean;
  slug?: string;
}

const ROLE_TAGS: Record<UserRole, string> = {
  user: 'Guest',
  waiter: 'Waiter',
  sommelier: 'Sommelier',
  restaurant_admin: 'Venue admin',
  moderator: 'Moderator'
};

/** Ступени Академии, из которых собран трек официанта: пары с едой, подача, разговор с гостем. */
const STAFF_LEVELS = [3, 4];

/**
 * Профиль: сверху герой со статусом (аватар, роль, ступень Академии и прогресс до следующей,
 * плитки и значки знаний, «продолжить обучение»), ниже вкус гостя или трек официанта,
 * в самом низу свёрнутый блок «Аккаунт». Баллы и значки только за знания, без покупок.
 */
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    @if (auth.user(); as u) {
      <!-- Герой: статус пользователя с первого взгляда -->
      <section class="pf-hero" [class.pf-hero-staff]="u.role === 'waiter'" aria-label="Your status">
        <div class="pf-id">
          <div class="pf-avatar" aria-hidden="true">{{ initials() }}</div>
          <div class="pf-id-text">
            <span class="pf-role" [class]="'pf-role pf-role-' + u.role">
              @switch (u.role) {
                @case ('waiter') {
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 8V6"/></svg>
                }
                @case ('user') {
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                }
                @default {
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 15 8.5l7 1-5 4.9 1.2 7L12 18l-6.2 3.4 1.2-7-5-4.9 7-1L12 2Z"/></svg>
                }
              }
              {{ roleTag() }}
            </span>
            <h1 class="pf-name">{{ displayName() }}</h1>
            <p class="pf-handle">
              &#64;{{ u.username }}
              @if (u.venue) { · {{ u.venue.name }} }
              @if (u.date_joined) { · since {{ u.date_joined | date:'MMM yyyy' }} }
            </p>
            <p class="pf-motto">{{ motto() }}</p>
            <div class="pf-id-actions">
              <button type="button" class="pf-chip-btn" (click)="editName()">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                Edit name
              </button>
              @if (auth.canSeePanel()) {
                <button type="button" class="pf-chip-btn" (click)="navigate.emit('admin')">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
                  Dashboard
                </button>
              }
            </div>
          </div>
        </div>

        <!-- Ступень Академии и прогресс до следующей -->
        <div class="pf-level" role="group" aria-label="Academy level">
          <div class="pf-level-ring" role="img" [attr.aria-label]="levelPercent() + '% of the current level done'">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="pf-ring-track" cx="60" cy="60" r="52" />
              <circle class="pf-ring-fill" cx="60" cy="60" r="52"
                      [style.strokeDasharray]="ringLength" [style.strokeDashoffset]="ringLength * (1 - levelPercent() / 100)" />
            </svg>
            <div class="pf-level-num">
              <span>Level</span>
              <b>{{ current()?.level ?? 1 }}</b>
            </div>
          </div>
          <div class="pf-level-text">
            <span class="pf-level-kicker">Academy level</span>
            <b class="pf-level-name">{{ current()?.name ?? 'Beginner' }}</b>
            @if (!academy()) {
              <span class="pf-level-sub">Loading your progress...</span>
            } @else if (allPassed()) {
              <span class="pf-level-sub">All four levels passed. Path complete!</span>
            } @else {
              <span class="pf-level-sub">
                {{ currentDone() }} of {{ currentSteps() }} steps
                {{ nextLevelNum() ? 'to Level ' + nextLevelNum() : 'to finish the path' }}
              </span>
            }
            <div class="pf-level-bar" aria-hidden="true"><span [style.width.%]="levelPercent()"></span></div>
          </div>
        </div>

        <!-- Плитки: только то, что сделал сам пользователь -->
        <ul class="pf-stats" aria-label="Your stats">
          <li>
            <b>{{ lessonsDone() }}</b>
            <span>{{ lessonsDone() === 1 ? 'lesson read' : 'lessons read' }}</span>
          </li>
          <li>
            <b>{{ testsPassed() }}</b>
            <span>{{ testsPassed() === 1 ? 'test passed' : 'tests passed' }}</span>
          </li>
          <li>
            <b>{{ knowledgePoints() }}</b>
            <span>knowledge points</span>
          </li>
          <li>
            <b>{{ passport() ? triedCount() : '–' }}</b>
            <span>{{ triedCount() === 1 ? 'beer tried' : 'beers tried' }}</span>
          </li>
        </ul>

        <!-- Значки знаний -->
        <div class="pf-badges-wrap">
          <span class="pf-badges-title">Knowledge badges · {{ earnedBadges() }} earned</span>
          <ul class="pf-badges">
            @for (b of badges(); track b.id) {
              <li class="pf-badge" [class.earned]="b.earned" [attr.title]="b.hint">
                <span class="pf-badge-icon" aria-hidden="true">
                  @switch (b.icon) {
                    @case ('level') { <b>{{ b.level }}</b> }
                    @case ('book') {
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    }
                    @case ('nose') {
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 15 8.5l7 1-5 4.9 1.2 7L12 18l-6.2 3.4 1.2-7-5-4.9 7-1L12 2Z"/></svg>
                    }
                  }
                </span>
                <span class="pf-badge-name">{{ b.title }}</span>
                <span class="sr-only">{{ b.earned ? 'earned' : 'not earned yet' }}. {{ b.hint }}</span>
              </li>
            }
          </ul>
        </div>

        <!-- Следующий шаг в Академии -->
        @if (nextStep(); as s) {
          <button type="button" class="pf-continue" (click)="continueLearning()">
            <span class="pf-continue-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/></svg>
            </span>
            <span class="pf-continue-text">
              <small>{{ lessonsDone() || testsPassed() ? 'Continue learning' : 'Start learning' }} · Level {{ s.level }}</small>
              <b>{{ s.kind === 'quiz' ? 'Level ' + s.level + ' quiz' : s.title }}</b>
            </span>
            <svg class="pf-continue-go" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
        } @else if (academyFailed()) {
          <p class="pf-muted-line">Couldn't load your Academy progress. <button type="button" class="auth-link" (click)="loadAcademy()">Retry</button></p>
        }
      </section>

      <div class="pf-columns">
        <div class="pf-main">
          <!-- Официант: трек персонала -->
          @if (u.role === 'waiter') {
            <section class="pf-card pf-staff">
              <div class="pf-card-head">
                <div>
                  <span class="pf-kicker">Staff track</span>
                  <h2>{{ staffReady() ? 'Ready for the shift' : 'Getting ready for the shift' }}</h2>
                </div>
                <span class="pf-ready" [class.ok]="staffReady()">
                  @if (staffReady()) {
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                    Shift-ready
                  } @else {
                    {{ staffPercent() }}% ready
                  }
                </span>
              </div>
              <p class="pf-card-lede">
                Food pairing, serving and talking with a guest. Finish these steps to recommend a beer in 15 seconds and handle a returned glass with confidence.
              </p>
              <div class="pf-bar" aria-hidden="true"><span [style.width.%]="staffPercent()"></span></div>
              <ol class="pf-staff-list">
                @for (s of staffSteps(); track s.kind + s.level + s.title) {
                  <li>
                    <button type="button" class="pf-staff-step" [class.done]="s.done" (click)="openStaffStep(s)">
                      <span class="pf-staff-mark" aria-hidden="true">
                        @if (s.done) {
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        } @else if (s.kind === 'quiz') {
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>
                        }
                      </span>
                      <span class="pf-staff-title">{{ s.kind === 'quiz' ? 'Level ' + s.level + ' quiz' : s.title }}</span>
                      <span class="pf-staff-meta">{{ s.done ? 'Done' : (s.kind === 'quiz' ? 'Test' : 'Lesson') }}</span>
                    </button>
                  </li>
                }
              </ol>
              <div class="pf-staff-actions">
                <button type="button" class="btn-amber" [disabled]="!staffVenue()" (click)="openCheatSheet()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                  Staff cheat sheet
                </button>
                <span class="pf-muted-line">What to recommend with each dish on the venue's menu.</span>
              </div>
            </section>
          }

          <!-- Вкус -->
          <section class="pf-card">
            <div class="pf-card-head">
              <div>
                <span class="pf-kicker">Taste profile</span>
                <h2>My taste</h2>
              </div>
            </div>
            <p class="pf-card-lede">Tell us what kind of beer you like and we'll find the ones that suit you. Leave a scale empty if it doesn't matter.</p>

            <div class="taste-grid">
              @for (s of scales; track s.key) {
                <div class="taste-row">
                  <div class="taste-head">
                    <span class="font-semibold">{{ s.label }}</span>
                    @if (taste[s.key] !== null) {
                      <span class="taste-value">{{ taste[s.key] }}/10</span>
                      <button type="button" class="auth-link text-xs" (click)="taste[s.key] = null">doesn't matter</button>
                    } @else {
                      <button type="button" class="auth-link text-xs" (click)="taste[s.key] = 5">set</button>
                    }
                  </div>
                  @if (taste[s.key] !== null) {
                    <input class="taste-range" type="range" min="0" max="10" [attr.aria-label]="s.label"
                           [(ngModel)]="taste[s.key]" [name]="'taste-' + s.key" />
                    <div class="taste-ends text-xs text-muted"><span>{{ s.low }}</span><span>{{ s.high }}</span></div>
                  } @else {
                    <p class="text-xs text-muted taste-off">Doesn't matter</p>
                  }
                </div>
              }
            </div>

            <h3 class="pf-sub">Favorite cuisines</h3>
            <div class="flex gap-sm flex-wrap mb-xl">
              @for (c of cuisineChoices; track c.value) {
                <button type="button" class="btn-outline taste-chip" [class.active]="cuisines.has(c.value)"
                        [attr.aria-pressed]="cuisines.has(c.value)" (click)="toggleCuisine(c.value)">{{ c.label }}</button>
              }
            </div>

            <div class="flex items-center gap-lg flex-wrap">
              <button type="button" class="btn-amber" [disabled]="savingTaste() || !prefs.prefs()" (click)="saveTaste()">
                {{ savingTaste() ? 'Saving...' : 'Save taste' }}
              </button>
              @if (tasteFeedback(); as f) {
                <span class="auth-feedback" [class.error]="!f.ok">{{ f.text }}</span>
              }
            </div>
          </section>
        </div>

        <aside class="pf-side">
          <section class="pf-card">
            <span class="pf-kicker">For you</span>
            <h2 class="pf-side-title">Suits your taste</h2>
            @if (brandsFailed()) {
              <p class="text-muted text-sm" role="alert">
                Couldn't load the beers.
                <button type="button" class="auth-link" (click)="loadBrands()">Refresh</button>
              </p>
            } @else if (matches().length) {
              <div class="pf-list">
                @for (m of matches(); track m.brand.id) {
                  <button type="button" class="taste-brand" (click)="openBrand(m.brand.id)">
                    <span class="taste-brand-text">
                      <span class="font-semibold">{{ m.brand.name }}</span>
                      <span class="text-xs text-muted">{{ m.brand.style }}</span>
                    </span>
                    <span class="taste-value">{{ m.percent }}%</span>
                  </button>
                }
              </div>
            } @else {
              <p class="text-muted text-sm">Set at least one taste scale and save it to see beers that suit you.</p>
            }

            <h3 class="pf-sub">Favorites</h3>
            @if (favoriteBrands().length) {
              <div class="pf-list">
                @for (b of favoriteBrands(); track b.id) {
                  <div class="taste-brand">
                    <span class="taste-brand-text">
                      <button type="button" class="auth-link font-semibold" (click)="openBrand(b.id)">{{ b.name }}</button>
                      <span class="text-xs text-muted">{{ b.style }}</span>
                    </span>
                    <button type="button" class="btn-ghost text-sm" [attr.aria-label]="'Remove ' + b.name" (click)="removeFavorite(b.id)">Remove</button>
                  </div>
                }
              </div>
            } @else {
              <p class="text-muted text-sm">Tap the heart on a beer's page and it will show up here.</p>
            }
            @if (passport()) {
              <button type="button" class="btn-outline btn-block pf-passport-btn" (click)="navigate.emit('passport')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 15 8.5l7 1-5 4.9 1.2 7L12 18l-6.2 3.4 1.2-7-5-4.9 7-1L12 2Z"/></svg>
                Open my taste passport
              </button>
            }
          </section>

          <!-- Аккаунт: свёрнут, раскрывается по клику -->
          <details class="pf-card pf-account" #account [open]="accountOpen()" (toggle)="onAccountToggle($event)">
            <summary>
              <span>
                <span class="pf-kicker">Settings</span>
                <span class="pf-side-title">Account</span>
              </span>
              <svg class="pf-chevron" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </summary>

            <dl class="pf-facts">
              <div><dt>Username</dt><dd>{{ u.username }}</dd></div>
              <div><dt>Role</dt><dd>{{ roleTag() }}</dd></div>
              @if (u.venue) {
                <div><dt>Venue</dt><dd><button type="button" class="auth-link" (click)="openVenue(u.venue.slug)">{{ u.venue.name }}</button></dd></div>
              }
              @if (u.date_joined) {
                <div><dt>Member since</dt><dd>{{ u.date_joined | date:'MMM d, yyyy' }}</dd></div>
              }
            </dl>

            <form class="pf-form" (ngSubmit)="saveProfile()" novalidate>
              <div class="auth-field">
                <label class="auth-label" for="profile-first-name">Display name</label>
                <input #nameInput id="profile-first-name" class="input" name="firstName" [(ngModel)]="firstName" autocomplete="given-name" maxlength="150" placeholder="How should we call you?" />
              </div>
              <div class="auth-field">
                <label class="auth-label" for="profile-email">Email</label>
                <input id="profile-email" class="input" name="email" type="email" [(ngModel)]="email" autocomplete="email" />
              </div>
              <div class="flex items-center gap-lg flex-wrap">
                <button type="submit" class="btn-amber btn-sm" [disabled]="savingProfile()">
                  {{ savingProfile() ? 'Saving...' : 'Save' }}
                </button>
                @if (profileFeedback(); as f) {
                  <span class="auth-feedback" [class.error]="!f.ok">{{ f.text }}</span>
                }
              </div>
            </form>

            <details class="pf-nested">
              <summary>Change password</summary>
              <form class="pf-form" (ngSubmit)="savePassword()" novalidate>
                <div class="auth-field">
                  <label class="auth-label" for="profile-old-password">Current password</label>
                  <input id="profile-old-password" class="input" name="oldPassword" type="password"
                         [(ngModel)]="oldPassword" autocomplete="current-password" />
                </div>
                <div class="auth-field">
                  <label class="auth-label" for="profile-new-password">New password</label>
                  <input id="profile-new-password" class="input" name="newPassword" type="password"
                         [(ngModel)]="newPassword" autocomplete="new-password" />
                  <span class="text-xs text-muted">At least 8 characters, not digits only</span>
                </div>
                <div class="auth-field">
                  <label class="auth-label" for="profile-confirm-password">Repeat new password</label>
                  <input id="profile-confirm-password" class="input" name="confirmPassword" type="password"
                         [(ngModel)]="confirmPassword" autocomplete="new-password" />
                </div>
                <div class="flex items-center gap-lg flex-wrap">
                  <button type="submit" class="btn-outline" [disabled]="savingPassword()">
                    {{ savingPassword() ? 'Changing...' : 'Change password' }}
                  </button>
                  @if (passwordFeedback(); as f) {
                    <span class="auth-feedback" [class.error]="!f.ok">{{ f.text }}</span>
                  }
                </div>
              </form>
            </details>

            <div class="pf-signout">
              <button type="button" class="btn-outline" (click)="logout()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
                Sign out
              </button>
              <button type="button" class="btn-ghost text-sm" (click)="logout(true)" title="Every device using this account will be signed out">
                Sign out on all devices
              </button>
            </div>
          </details>
        </aside>
      </div>
    } @else if (!auth.ready()) {
      <p class="text-muted text-center p-4xl">Checking your session...</p>
    } @else {
      <!-- Без входа: дружелюбное приглашение вместо пустой страницы -->
      <section class="pf-hero pf-guest">
        <div class="pf-avatar pf-avatar-empty" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <h1 class="pf-name">Your profile lives here</h1>
        <p class="pf-motto">Sign in to keep your Academy level, knowledge badges and taste profile on any device.</p>
        <ul class="pf-perks">
          <li>Academy level and progress to the next one</li>
          <li>Knowledge badges for lessons and tests</li>
          <li>Your taste and beers that suit you</li>
        </ul>
        <div class="pf-guest-actions">
          <button type="button" class="btn-amber" (click)="navigate.emit('login')">Sign in</button>
          <button type="button" class="btn-outline" (click)="navigate.emit('register')">Create an account</button>
        </div>
        <p class="pf-muted-line">For ages 21 and over.</p>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }

    /* Герой */
    .pf-hero {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
      gap: var(--space-2xl) var(--space-3xl);
      padding: var(--space-3xl);
      margin-bottom: var(--space-2xl);
      border: 1px solid var(--line);
      border-radius: 28px;
      background:
        radial-gradient(120% 90% at 0% 0%, rgba(245, 158, 11, 0.22), transparent 55%),
        radial-gradient(90% 80% at 100% 100%, rgba(194, 87, 10, 0.14), transparent 60%),
        linear-gradient(160deg, #FFFDF8 0%, #FFF4E0 100%);
      box-shadow: var(--shadow-md);
      overflow: hidden;
    }
    .pf-hero-staff {
      background:
        radial-gradient(120% 90% at 0% 0%, rgba(245, 158, 11, 0.18), transparent 55%),
        radial-gradient(90% 80% at 100% 100%, rgba(22, 101, 52, 0.12), transparent 60%),
        linear-gradient(160deg, #FFFDF8 0%, #FFF1DA 100%);
    }
    .pf-id { display: flex; align-items: flex-start; gap: var(--space-xl); min-width: 0; }
    .pf-avatar {
      flex-shrink: 0;
      width: 112px;
      height: 112px;
      display: grid;
      place-content: center;
      border-radius: 32px;
      background: linear-gradient(140deg, #F59E0B 0%, #C2570A 55%, #92400E 100%);
      color: #fff;
      font-family: var(--font-heading);
      font-size: 2.6rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      box-shadow: 0 18px 40px -14px rgba(146, 64, 14, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.35);
      transform: rotate(-3deg);
    }
    .pf-id-text { min-width: 0; display: grid; justify-items: start; gap: 4px; }
    .pf-role {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: var(--radius-full);
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      background: var(--bg-1);
      border: 1px solid var(--line);
      color: var(--beer-deep);
    }
    .pf-role-waiter { background: #166534; border-color: #166534; color: #fff; }
    .pf-role-sommelier, .pf-role-moderator, .pf-role-restaurant_admin { background: var(--foam); border-color: var(--foam); color: #FDE68A; }
    .pf-name {
      margin: 4px 0 0;
      font-family: var(--font-heading);
      font-size: clamp(1.9rem, 4vw, 2.6rem);
      font-weight: 800;
      line-height: 1.05;
      letter-spacing: -0.02em;
      color: var(--foam);
      overflow-wrap: anywhere;
    }
    .pf-handle { margin: 0; font-size: 0.875rem; color: var(--muted); }
    .pf-motto { margin: 6px 0 0; max-width: 46ch; line-height: 1.5; color: var(--foam-dim); }
    .pf-id-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-top: var(--space-md); }
    .pf-chip-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      background: rgba(255, 255, 255, 0.8);
      color: var(--beer-deep);
      font: inherit;
      font-size: 0.8125rem;
      font-weight: 700;
      cursor: pointer;
    }
    .pf-chip-btn:hover { border-color: var(--beer-light); background: #fff; }

    .pf-level {
      display: flex;
      align-items: center;
      gap: var(--space-xl);
      padding: var(--space-xl);
      border-radius: var(--radius-2xl);
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid var(--line);
      backdrop-filter: blur(6px);
    }
    .pf-level-ring { position: relative; flex-shrink: 0; width: 124px; height: 124px; }
    .pf-level-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .pf-ring-track { fill: none; stroke: rgba(180, 83, 9, 0.12); stroke-width: 10; }
    .pf-ring-fill { fill: none; stroke: var(--beer-mid); stroke-width: 10; stroke-linecap: round; transition: stroke-dashoffset 900ms var(--ease-out); }
    .pf-level-num {
      position: absolute;
      inset: 14px;
      display: grid;
      place-content: center;
      text-align: center;
      border-radius: 50%;
      background: var(--grad-cta);
      color: #fff;
      line-height: 1;
      box-shadow: var(--shadow-cta);
    }
    .pf-level-num span { font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.9; }
    .pf-level-num b { font-family: var(--font-heading); font-size: 2.5rem; font-weight: 800; }
    .pf-level-text { min-width: 0; flex: 1; display: grid; gap: 4px; }
    .pf-level-kicker, .pf-kicker, .pf-badges-title { font-size: 0.6875rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--beer-mid); }
    .pf-level-name { font-family: var(--font-heading); font-size: 1.6rem; font-weight: 800; color: var(--foam); line-height: 1.1; }
    .pf-level-sub { font-size: 0.875rem; color: var(--foam-dim); }
    .pf-level-bar, .pf-bar { height: 8px; margin-top: 6px; border-radius: 8px; background: rgba(180, 83, 9, 0.12); overflow: hidden; }
    .pf-level-bar span, .pf-bar span { display: block; height: 100%; border-radius: 8px; background: var(--grad-cta); transition: width 700ms var(--ease-out); }

    .pf-stats { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-md); margin: 0; padding: 0; list-style: none; }
    .pf-stats li {
      display: grid;
      gap: 2px;
      padding: var(--space-lg) var(--space-xl);
      border-radius: var(--radius-xl);
      background: rgba(255, 255, 255, 0.82);
      border: 1px solid var(--line);
    }
    .pf-stats b { font-family: var(--font-heading); font-size: 2rem; font-weight: 800; line-height: 1; color: var(--beer-deep); }
    .pf-stats span { font-size: 0.8125rem; font-weight: 600; color: var(--muted); }

    .pf-badges-wrap { grid-column: 1 / -1; display: grid; gap: var(--space-sm); min-width: 0; }
    .pf-badges { display: flex; gap: var(--space-md); margin: 0; padding: 4px 2px 6px; list-style: none; overflow-x: auto; scrollbar-width: none; }
    .pf-badges::-webkit-scrollbar { display: none; }
    .pf-badge { flex: 0 0 auto; width: 92px; display: grid; justify-items: center; gap: 6px; text-align: center; }
    .pf-badge-icon {
      width: 60px;
      height: 60px;
      display: grid;
      place-content: center;
      border-radius: 50%;
      border: 2px dashed rgba(120, 113, 108, 0.35);
      background: rgba(255, 255, 255, 0.6);
      color: #a8a29e;
      font-family: var(--font-heading);
      font-size: 1.4rem;
    }
    .pf-badge-icon svg { width: 26px; height: 26px; }
    .pf-badge.earned .pf-badge-icon {
      border: 3px solid #FDE68A;
      background: linear-gradient(140deg, #F59E0B, #B45309);
      color: #fff;
      box-shadow: 0 8px 18px -8px rgba(146, 64, 14, 0.7);
    }
    .pf-badge-name { font-size: 0.75rem; font-weight: 700; line-height: 1.25; color: var(--muted); }
    .pf-badge.earned .pf-badge-name { color: var(--foam); }

    .pf-continue {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: var(--space-lg);
      width: 100%;
      padding: var(--space-lg) var(--space-xl);
      border: none;
      border-radius: var(--radius-xl);
      background: var(--grad-cta);
      color: #fff;
      font: inherit;
      text-align: left;
      cursor: pointer;
      box-shadow: var(--shadow-cta);
      transition: transform var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
    }
    .pf-continue:hover { transform: translateY(-1px); box-shadow: 0 14px 30px -10px rgba(146, 64, 14, 0.6); }
    .pf-continue:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 3px; }
    .pf-continue-icon { flex-shrink: 0; width: 44px; height: 44px; display: grid; place-content: center; border-radius: 14px; background: rgba(255, 255, 255, 0.18); }
    .pf-continue-icon svg { width: 24px; height: 24px; }
    .pf-continue-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .pf-continue-text small { font-size: 0.75rem; font-weight: 600; opacity: 0.9; }
    .pf-continue-text b { font-size: 1.0625rem; line-height: 1.3; }
    .pf-continue-go { flex-shrink: 0; }
    .pf-muted-line { margin: 0; font-size: 0.8125rem; color: var(--muted); }

    /* Колонки под героем */
    .pf-columns { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr); gap: var(--space-2xl); align-items: start; }
    .pf-main, .pf-side { display: grid; gap: var(--space-2xl); min-width: 0; }
    .pf-card { padding: var(--space-2xl); border: 1px solid var(--line); border-radius: var(--radius-2xl); background: var(--bg-1); box-shadow: var(--shadow-warm); }
    .pf-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-md); margin-bottom: var(--space-sm); }
    .pf-card-head h2, .pf-side-title { display: block; margin: 2px 0 0; font-family: var(--font-heading); font-size: 1.35rem; font-weight: 800; color: var(--foam); }
    .pf-side-title { margin-bottom: var(--space-md); }
    .pf-card-lede { margin: 0 0 var(--space-xl); max-width: 62ch; line-height: 1.55; color: var(--foam-dim); font-size: 0.9375rem; }
    .pf-sub { margin: var(--space-xl) 0 var(--space-md); font-family: var(--font-heading); font-size: 1.05rem; font-weight: 800; color: var(--foam); }
    .pf-list { display: grid; gap: var(--space-sm); }
    .pf-passport-btn { margin-top: var(--space-xl); }

    .pf-ready { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--radius-full); background: var(--beer-glow); color: var(--beer-deep); font-size: 0.8125rem; font-weight: 800; }
    .pf-ready.ok { background: #166534; color: #fff; }
    .pf-staff .pf-bar { margin: 0 0 var(--space-lg); }
    .pf-staff .pf-bar span { background: linear-gradient(90deg, #16a34a, #166534); }
    .pf-staff-list { display: grid; gap: var(--space-sm); margin: 0 0 var(--space-xl); padding: 0; list-style: none; }
    .pf-staff-step {
      width: 100%;
      display: flex;
      align-items: center;
      gap: var(--space-md);
      min-height: 52px;
      padding: 10px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--bg-0);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .pf-staff-step:hover { border-color: var(--beer-light); background: #FFF9EF; }
    .pf-staff-mark { flex-shrink: 0; width: 28px; height: 28px; display: grid; place-content: center; border-radius: 50%; border: 2px solid rgba(180, 83, 9, 0.3); color: var(--beer-deep); background: #fff; }
    .pf-staff-mark svg { width: 14px; height: 14px; }
    .pf-staff-step.done .pf-staff-mark { border-color: #16a34a; background: #16a34a; color: #fff; }
    .pf-staff-title { flex: 1; min-width: 0; font-weight: 700; color: var(--foam); line-height: 1.3; }
    .pf-staff-meta { flex-shrink: 0; font-size: 0.75rem; font-weight: 700; color: var(--beer-mid); }
    .pf-staff-step.done .pf-staff-meta { color: #166534; }
    .pf-staff-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-md); }

    /* Вкус */
    .taste-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-lg) var(--space-2xl); }
    .taste-head { display: flex; align-items: baseline; gap: var(--space-sm); }
    .taste-head .auth-link { margin-left: auto; }
    .taste-value { color: var(--beer-mid); font-weight: 800; font-size: 0.9rem; }
    .taste-range { width: 100%; margin: 8px 0 2px; accent-color: var(--beer-mid); }
    .taste-ends { display: flex; justify-content: space-between; }
    .taste-off { margin: 6px 0 0; }
    .taste-chip { padding: 6px 14px; font-size: 0.875rem; }
    .taste-brand {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--line-subtle);
      border-radius: var(--radius-md);
      background: var(--bg-0);
      color: inherit;
      font: inherit;
      text-align: left;
    }
    .taste-brand-text { flex: 1; min-width: 0; display: grid; justify-items: start; gap: 1px; }
    button.taste-brand { cursor: pointer; }
    button.taste-brand:hover { border-color: var(--beer-light); }

    /* Аккаунт */
    .pf-account { padding: 0; }
    .pf-account > summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
      padding: var(--space-xl) var(--space-2xl);
      cursor: pointer;
      list-style: none;
    }
    .pf-account > summary::-webkit-details-marker { display: none; }
    .pf-account > summary .pf-side-title { margin: 2px 0 0; }
    .pf-chevron { flex-shrink: 0; color: var(--beer-mid); transition: transform var(--duration-normal) var(--ease-out); }
    .pf-account[open] .pf-chevron { transform: rotate(180deg); }
    .pf-account > :not(summary) { margin-left: var(--space-2xl); margin-right: var(--space-2xl); }
    .pf-account > :last-child { margin-bottom: var(--space-2xl); }
    .pf-facts { display: grid; gap: 0; margin-top: 0; margin-bottom: var(--space-xl); }
    .pf-facts > div { display: flex; justify-content: space-between; gap: var(--space-md); padding: 10px 0; border-bottom: 1px solid var(--line-subtle); font-size: 0.9375rem; }
    .pf-facts dt { color: var(--muted); }
    .pf-facts dd { margin: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
    .pf-form { display: grid; gap: var(--space-sm); margin-bottom: var(--space-lg); }
    .pf-nested { margin-bottom: var(--space-lg); padding: var(--space-md) 0; border-top: 1px solid var(--line-subtle); border-bottom: 1px solid var(--line-subtle); }
    .pf-nested > summary { cursor: pointer; font-weight: 700; color: var(--beer-deep); }
    .pf-nested[open] > summary { margin-bottom: var(--space-md); }
    .pf-signout { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-md); }

    /* Без входа */
    .pf-guest { display: grid; grid-template-columns: 1fr; justify-items: center; gap: var(--space-md); max-width: 640px; margin: 0 auto var(--space-4xl); text-align: center; }
    .pf-avatar-empty { transform: none; background: var(--grad-cta); }
    .pf-guest .pf-motto { margin: 0; }
    .pf-perks { display: grid; gap: var(--space-sm); margin: var(--space-sm) 0; padding: 0; list-style: none; text-align: left; }
    .pf-perks li { position: relative; padding-left: 28px; color: var(--foam-dim); }
    .pf-perks li::before { content: '✓'; position: absolute; left: 0; top: 0; width: 20px; height: 20px; display: grid; place-content: center; border-radius: 50%; background: var(--beer-mid); color: #fff; font-size: 0.7rem; font-weight: 800; }
    .pf-guest-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-md); }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

    @media (max-width: 1024px) {
      .pf-hero { grid-template-columns: 1fr; }
      .pf-columns { grid-template-columns: 1fr; }
    }

    @media (max-width: 600px) {
      .pf-hero { gap: var(--space-lg); padding: var(--space-xl) var(--space-lg); border-radius: var(--radius-2xl); }
      .pf-id { gap: var(--space-lg); align-items: center; }
      .pf-avatar { width: 84px; height: 84px; border-radius: 26px; font-size: 2rem; }
      .pf-name { font-size: 1.75rem; }
      .pf-id .pf-motto { display: none; }
      .pf-id-actions { margin-top: var(--space-sm); }
      .pf-chip-btn { min-height: 32px; padding: 0 12px; }
      .pf-level { gap: var(--space-lg); padding: var(--space-lg); }
      .pf-level-ring { width: 100px; height: 100px; }
      .pf-level-num { inset: 12px; }
      .pf-level-num b { font-size: 2rem; }
      .pf-level-name { font-size: 1.35rem; }
      .pf-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-sm); }
      .pf-stats li { padding: var(--space-md) var(--space-lg); }
      .pf-stats b { font-size: 1.7rem; }
      .pf-badges { margin: 0 calc(-1 * var(--space-lg)); padding-left: var(--space-lg); padding-right: var(--space-lg); }
      .pf-badge { width: 78px; }
      .pf-badge-icon { width: 54px; height: 54px; }
      .pf-continue { padding: var(--space-md) var(--space-lg); }
      .pf-card { padding: var(--space-lg); border-radius: var(--radius-xl); }
      .pf-account { padding: 0; }
      .pf-account > summary { padding: var(--space-lg); }
      .pf-account > :not(summary) { margin-left: var(--space-lg); margin-right: var(--space-lg); }
      .pf-account > :last-child { margin-bottom: var(--space-lg); }
      .pf-guest { padding: var(--space-2xl) var(--space-lg); }
    }

    @media (prefers-reduced-motion: reduce) {
      .pf-ring-fill, .pf-level-bar span, .pf-bar span, .pf-chevron { transition: none; }
    }
  `]
})
export class ProfileComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly prefs = inject(PreferencesService);
  private readonly api = inject(ApiService);
  private readonly selection = inject(SelectionService);
  private readonly destroyRef = inject(DestroyRef);

  @Output() navigate = new EventEmitter<ActiveTab>();

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly scales = TASTE_SCALES;
  readonly cuisineChoices = CUISINE_CHOICES;
  readonly ringLength = 2 * Math.PI * 52;

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
  readonly matches = computed(() => this.prefs.match(this.brands()).slice(0, 5));
  readonly favoriteBrands = computed(() => {
    const fav = this.prefs.favorites();
    return this.brands().filter(b => fav.has(b.id));
  });

  // Статус: Академия и паспорт
  readonly academy = signal<Academy | null>(null);
  readonly academyFailed = signal(false);
  readonly passport = signal<Passport | null>(null);
  /** Заведение для шпаргалки официанта: своё или первое опубликованное. */
  readonly staffVenue = signal<string | null>(null);
  readonly accountOpen = signal(false);

  readonly roleTag = computed(() => ROLE_TAGS[this.auth.user()?.role ?? 'user'] ?? 'Guest');
  readonly displayName = computed(() => {
    const u = this.auth.user();
    return (u?.first_name || '').trim() || u?.username || '';
  });
  readonly initials = computed(() => {
    const name = this.displayName();
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 1);
    return (letters || '?').toUpperCase();
  });

  private readonly levels = computed(() => this.academy()?.levels ?? []);
  readonly lessonsDone = computed(() => this.levels().reduce((n, lv) => n + lv.lessons.filter(l => l.done).length, 0));
  readonly testsPassed = computed(() => this.levels().filter(lv => lv.passed).length);
  /** Баллы только за знания: уроки и тесты, по правилам начисления Академии. */
  readonly knowledgePoints = computed(() => {
    const a = this.academy();
    if (!a) return 0;
    return this.lessonsDone() * (a.points?.lesson ?? 0) + this.testsPassed() * (a.points?.level ?? 0);
  });
  readonly triedCount = computed(() => this.passport()?.tastings.length ?? 0);
  readonly allPassed = computed(() => this.levels().length > 0 && this.levels().every(lv => lv.passed));
  /** Ступень, на которой пользователь сейчас: первая не сданная, после всех - последняя. */
  readonly current = computed<AcademyLevel | null>(() => {
    const list = this.levels();
    return list.find(lv => !lv.passed) ?? list[list.length - 1] ?? null;
  });
  readonly currentSteps = computed(() => {
    const lv = this.current();
    return lv ? lv.lessons.length + (lv.quiz_size ? 1 : 0) : 0;
  });
  readonly currentDone = computed(() => {
    const lv = this.current();
    return lv ? lv.lessons.filter(l => l.done).length + (lv.passed ? 1 : 0) : 0;
  });
  readonly levelPercent = computed(() => this.allPassed() ? 100 : this.currentSteps() ? Math.round(this.currentDone() * 100 / this.currentSteps()) : 0);
  readonly nextLevelNum = computed(() => {
    const lv = this.current();
    const list = this.levels();
    const i = lv ? list.indexOf(lv) : -1;
    return i >= 0 && i < list.length - 1 ? list[i + 1].level : null;
  });
  /** Следующий шаг пути, как кнопка «Продолжить» в Академии. */
  readonly nextStep = computed(() => {
    for (const lv of this.levels()) {
      const lesson = lv.lessons.find(l => !l.done);
      if (lesson) return { kind: 'lesson' as const, level: lv.level, title: lesson.title, slug: lesson.slug };
      if (lv.quiz_size && !lv.passed) return { kind: 'quiz' as const, level: lv.level, title: 'Quiz', slug: undefined };
    }
    return null;
  });

  readonly badges = computed<KnowledgeBadge[]>(() => {
    const list: KnowledgeBadge[] = this.levels().map(lv => ({
      id: 'level-' + lv.level,
      title: lv.name,
      hint: `Pass the Level ${lv.level} test`,
      earned: lv.passed,
      icon: 'level' as const,
      level: lv.level
    }));
    const lessons = this.levels().flatMap(lv => lv.lessons);
    list.push({
      id: 'lessons',
      title: 'All lessons',
      hint: 'Read every Academy lesson',
      earned: lessons.length > 0 && lessons.every(l => l.done),
      icon: 'book'
    });
    const nose = this.passport()?.badges.find(b => b.id === 'sharp-nose');
    if (nose) list.push({ id: 'sharp-nose', title: 'Sharp Nose', hint: 'Detect notes from the sommelier pyramid', earned: nose.earned, icon: 'nose' });
    // Полученные значки впереди
    return list.sort((a, b) => Number(b.earned) - Number(a.earned));
  });
  readonly earnedBadges = computed(() => this.badges().filter(b => b.earned).length);

  readonly staffSteps = computed<StaffStep[]>(() => {
    const steps: StaffStep[] = [];
    for (const lv of this.levels().filter(item => STAFF_LEVELS.includes(item.level))) {
      for (const l of lv.lessons) steps.push({ kind: 'lesson', level: lv.level, title: l.title, done: l.done, slug: l.slug });
      if (lv.quiz_size) steps.push({ kind: 'quiz', level: lv.level, title: 'Quiz', done: lv.passed });
    }
    return steps;
  });
  readonly staffPercent = computed(() => {
    const s = this.staffSteps();
    return s.length ? Math.round(s.filter(x => x.done).length * 100 / s.length) : 0;
  });
  readonly staffReady = computed(() => this.staffSteps().length > 0 && this.staffSteps().every(s => s.done));

  readonly motto = computed(() => {
    switch (this.auth.user()?.role) {
      case 'waiter': return this.staffReady()
        ? 'Shift-ready: you can pair a beer with any dish and explain why in one sentence.'
        : 'Your staff track: pairing, serving and talking with guests. A few short lessons to be shift-ready.';
      case 'sommelier': return 'You shape the pairings and flavor pyramids guests see.';
      case 'restaurant_admin': return 'Your venue\'s menu, pairings and guests in one place.';
      case 'moderator': return 'You keep the catalog, pairings and accounts in order.';
      default: return 'Learn to taste, find your style and discover beers that suit you.';
    }
  });

  firstName = '';
  email = '';
  oldPassword = '';
  newPassword = '';
  confirmPassword = '';

  readonly savingProfile = signal(false);
  readonly savingPassword = signal(false);
  readonly profileFeedback = signal<Feedback | null>(null);
  readonly passwordFeedback = signal<Feedback | null>(null);

  /** Пользователь, для которого загружен статус: при смене аккаунта перечитываем. */
  private loadedFor: number | null = null;

  constructor() {
    // Пользователь может подгрузиться позже (обновление страницы): поля и статус заполняем по факту
    effect(() => {
      const u = this.auth.user();
      if (u) {
        this.firstName = u.first_name;
        this.email = u.email;
        if (this.loadedFor !== u.id) {
          this.loadedFor = u.id;
          queueMicrotask(() => this.loadStatus());
        }
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

  private loadStatus() {
    const u = this.auth.user();
    if (!u) return;
    this.loadAcademy();
    this.api.getPassport().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => this.passport.set(p),
      error: () => this.passport.set(null)
    });
    if (u.role === 'waiter') {
      if (u.venue) {
        this.staffVenue.set(u.venue.slug);
      } else {
        this.api.getVenues().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: list => this.staffVenue.set(list[0]?.slug ?? null),
          error: () => this.staffVenue.set(null)
        });
      }
    }
  }

  loadAcademy() {
    this.academyFailed.set(false);
    this.api.getAcademy().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: a => this.academy.set(a),
      error: () => this.academyFailed.set(true)
    });
  }

  loadBrands() {
    this.brandsFailed.set(false);
    this.api.getBrands().subscribe({
      next: list => this.brands.set(list),
      error: () => this.brandsFailed.set(true)
    });
  }

  /** Следующий урок открывается прямо в Академии; тест - на его ступени. */
  continueLearning() {
    const s = this.nextStep();
    this.openLesson(s?.kind === 'lesson' ? s.slug : undefined);
  }

  openStaffStep(s: StaffStep) {
    this.openLesson(s.kind === 'lesson' ? s.slug : undefined);
  }

  private openLesson(slug?: string) {
    // Сначала переход в раздел (он сбрасывает открытый урок), потом урок в адрес
    this.navigate.emit('academy');
    if (slug) this.selection.lessonSlug.set(slug);
  }

  openCheatSheet() {
    const slug = this.staffVenue();
    if (!slug) return;
    this.selection.openVenue(slug);
    this.navigate.emit('menu');
    // goTo выключает режим официанта, поэтому включаем его после перехода
    this.selection.staffMode.set(true);
  }

  editName() {
    this.accountOpen.set(true);
    setTimeout(() => {
      const input = this.nameInput()?.nativeElement;
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input?.focus({ preventScroll: true });
    }, 60);
  }

  onAccountToggle(event: Event) {
    this.accountOpen.set((event.target as HTMLDetailsElement).open);
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
        this.flash(this.tasteFeedback, { ok: true, text: 'Saved' });
      },
      error: (err: unknown) => {
        this.savingTaste.set(false);
        this.flash(this.tasteFeedback, { ok: false, text: 'Error: ' + AuthService.errorText(err) });
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
        this.flash(this.profileFeedback, { ok: true, text: 'Saved' });
      },
      error: (err: unknown) => {
        this.savingProfile.set(false);
        this.flash(this.profileFeedback, { ok: false, text: 'Error: ' + AuthService.errorText(err) });
      }
    });
  }

  savePassword() {
    if (this.savingPassword()) return;
    if (!this.oldPassword || !this.newPassword) {
      this.flash(this.passwordFeedback, { ok: false, text: 'Fill in both passwords' });
      return;
    }
    if (this.newPassword.length < 8) {
      this.flash(this.passwordFeedback, { ok: false, text: 'The new password must be at least 8 characters long' });
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.flash(this.passwordFeedback, { ok: false, text: 'Passwords don\'t match' });
      return;
    }
    this.savingPassword.set(true);
    this.auth.changePassword(this.oldPassword, this.newPassword).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.oldPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.flash(this.passwordFeedback, { ok: true, text: 'Password changed' });
      },
      error: (err: unknown) => {
        this.savingPassword.set(false);
        this.flash(this.passwordFeedback, { ok: false, text: 'Error: ' + AuthService.errorText(err) });
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
