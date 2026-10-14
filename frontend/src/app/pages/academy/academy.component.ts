import {
  Component, DestroyRef, ElementRef, EventEmitter, Injector, OnInit, Output, afterNextRender, computed, effect, inject,
  signal, untracked, viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { concatMap, from } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { PreferencesService } from '../../services/preferences.service';
import { SelectionService } from '../../services/selection.service';
import { ActiveTab } from '../../models/navigation';
import {
  Academy, AcademyLevel, Lesson, LessonAction, LessonCard, Quiz, QuizResult, TeamMember
} from '../../models/flavor-tree.models';

/** Прогресс гостя без входа: прочитанные уроки и сданные ступени на этом устройстве. */
const LOCAL_LESSONS = 'ft_academy_lessons';
const LOCAL_LEVELS = 'ft_academy_levels';

function readList<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: unknown[]): void {
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list));
    else localStorage.removeItem(key);
  } catch {
    // без хранилища прогресс гостя живёт до перезагрузки
  }
}

/** Шаг пути: урок или тест ступени. */
interface PathStep {
  kind: 'lesson' | 'quiz';
  level: number;
  title: string;
  done: boolean;
  slug?: string;
}

type SheetMode = 'lesson' | 'quiz';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * Академия: путь из четырёх ступеней. В ступени три коротких урока и тест.
 * Сверху дорожка ступеней, под ней открыта одна ступень (по умолчанию та, где следующий шаг).
 * Урок и тест открываются в диалоге поверх пути; адрес урока попадает в строку
 * браузера (/academy/<slug>), поэтому уроком можно поделиться, а кнопка «назад» его закрывает.
 */
@Component({
  selector: 'app-academy',
  standalone: true,
  template: `
    <section class="ac-hero">
      <div class="ac-hero-text">
        <span class="badge mb-md">Taste Academy</span>
        <h1 class="ac-title">Learn to <span class="ac-accent">really taste</span></h1>
        <p class="ac-lede">
          Four levels of short lessons and quizzes. From your first mindful sip to recommending a beer to a guest in 15 seconds.
        </p>
        <p class="ac-facts">
          <span><b>{{ lessonsTotal() || 12 }}</b> lessons</span>
          <span aria-hidden="true">·</span>
          <span><b>3-4</b> min each</span>
          <span aria-hidden="true">·</span>
          <span><b>{{ questionsTotal() || 52 }}</b> quiz questions</span>
        </p>
      </div>

      <aside class="ac-progress" aria-label="Your progress">
        <div class="ac-ring" role="img" [attr.aria-label]="doneSteps() + ' of ' + totalSteps() + ' steps completed'">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="ac-ring-track" cx="60" cy="60" r="52" />
            <circle class="ac-ring-fill" cx="60" cy="60" r="52"
                    [style.strokeDasharray]="ringLength" [style.strokeDashoffset]="ringOffset()" />
          </svg>
          <div class="ac-ring-text">
            <b>{{ percent() }}%</b>
            <span>done</span>
          </div>
        </div>
        <div class="ac-progress-body">
          <p class="ac-progress-kicker">Your progress</p>
          <p class="ac-progress-line"><b>{{ doneSteps() }} of {{ totalSteps() }}</b> steps completed</p>
          @if (points(); as p) {
            <button type="button" class="ac-points" (click)="navigate.emit('profile')" title="Open your profile">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/></svg>
              {{ p.earned }} knowledge {{ p.earned === 1 ? 'point' : 'points' }}
            </button>
          } @else if (loaded()) {
            <p class="ac-guest">
              Saved on this device.
              <button type="button" class="auth-link" (click)="navigate.emit('login')">Sign in</button>
              to keep it in your profile.
            </p>
          }
        </div>
        @if (nextStep(); as step) {
          <button type="button" class="btn-amber ac-continue" (click)="openStep(step)">
            <span class="ac-continue-text">
              <small>{{ doneSteps() ? 'Continue' : 'Start here' }}</small>
              {{ step.kind === 'quiz' ? 'Level ' + step.level + ' quiz' : step.title }}
            </span>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
        } @else if (loaded() && totalSteps()) {
          <p class="ac-all-done">All levels completed. Great work!</p>
        }
      </aside>
    </section>

    @if (failed()) {
      <div class="glass-panel ac-error" role="alert">
        <p>Couldn't load the Academy. Please check your connection.</p>
        <button type="button" class="btn-outline" (click)="load()">Retry</button>
      </div>
    } @else if (!loaded()) {
      <div class="skeleton-grid mb-5xl" aria-busy="true" aria-label="Loading the Academy">
        @for (i of [1, 2]; track i) {
          <div class="skeleton-card">
            <div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>
          </div>
        }
      </div>
    } @else {
      <!-- Дорожка ступеней: обзор всего пути и переключатель -->
      <nav class="ac-track" aria-label="Levels">
        @for (lv of levels(); track lv.level) {
          <button type="button" class="ac-track-item"
                  [class.is-done]="levelPassed(lv)"
                  [class.is-current]="!levelPassed(lv) && nextStep()?.level === lv.level"
                  [class.is-selected]="shownLevel()?.level === lv.level"
                  [attr.aria-current]="shownLevel()?.level === lv.level ? 'step' : null"
                  (click)="selectLevel(lv.level)">
            <span class="ac-track-dot" aria-hidden="true">
              @if (levelPassed(lv)) {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              } @else { {{ lv.level }} }
            </span>
            <span class="ac-track-label">Level {{ lv.level }}</span>
            <span class="ac-track-name">{{ lv.name }}</span>
            <span class="ac-track-count">{{ levelDone(lv) }}/{{ levelSteps(lv) }}</span>
          </button>
        }
      </nav>

      @if (shownLevel(); as lv) {
        <section class="ac-panel" [class.ac-panel-done]="levelPassed(lv)" [attr.aria-label]="'Level ' + lv.level + '. ' + lv.name">
          <header class="ac-panel-head">
            <div class="ac-panel-title">
              <span class="ac-panel-kicker">Level {{ lv.level }} of {{ levels().length }}</span>
              <h2>{{ lv.name }}</h2>
              @if (lv.description) { <p>{{ lv.description }}</p> }
            </div>
            @if (levelPassed(lv)) {
              <span class="badge badge-success ac-panel-state">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                Level passed
              </span>
            }
          </header>
          <div class="ac-meter" role="progressbar" [attr.aria-valuenow]="levelDone(lv)" aria-valuemin="0" [attr.aria-valuemax]="levelSteps(lv)"
               [attr.aria-label]="'Level ' + lv.level + ' progress'">
            <span [style.width.%]="levelDone(lv) * 100 / (levelSteps(lv) || 1)"></span>
          </div>
          <p class="ac-meter-text">{{ levelDone(lv) }} of {{ levelSteps(lv) }} steps done</p>

          <ol class="ac-steps">
            @for (lesson of lv.lessons; track lesson.slug; let i = $index) {
              <li>
                <button type="button" class="ac-step" [class.done]="lessonDone(lesson)" [class.next]="isNext(lesson.slug)" (click)="openLesson(lesson.slug)">
                  <span class="ac-step-mark" aria-hidden="true">
                    @if (lessonDone(lesson)) {
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    } @else { {{ i + 1 }} }
                  </span>
                  <span class="ac-step-body">
                    <span class="ac-step-title">{{ lesson.title }}</span>
                    <span class="ac-step-sub">{{ lesson.summary }}</span>
                    <span class="ac-step-tags">
                      <span class="ac-tag">{{ lesson.minutes }} min read</span>
                      @if (lessonDone(lesson)) { <span class="ac-tag ac-tag-ok">Read</span> }
                      @else if (isNext(lesson.slug)) { <span class="ac-tag ac-tag-next">Up next</span> }
                    </span>
                  </span>
                  <svg class="ac-step-go" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </li>
            }
          </ol>

          <button type="button" class="ac-quizcard" [class.done]="levelPassed(lv)" [disabled]="!lv.quiz_size" (click)="openQuiz(lv.level)">
            <span class="ac-quizcard-icon" aria-hidden="true">
              @if (levelPassed(lv)) {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 12.9 17 22l-5-3-5 3 1.5-9.1"/></svg>
              } @else {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>
              }
            </span>
            <span class="ac-quizcard-body">
              <span class="ac-quizcard-title">Level {{ lv.level }} quiz</span>
              <span class="ac-quizcard-sub">
                @if (!lv.quiz_size) {
                  Questions coming soon
                } @else {
                  {{ lv.quiz_size }} questions · pass mark {{ passPercent() }}%
                  @if (lv.best_percent !== null) { · best {{ lv.best_percent }}% }
                }
              </span>
              @if (!levelPassed(lv) && lessonsLeft(lv) > 0 && lv.quiz_size) {
                <span class="ac-quizcard-hint">Tip: read the {{ lessonsLeft(lv) === 1 ? 'last lesson' : lessonsLeft(lv) + ' lessons' }} first</span>
              }
            </span>
            <span class="ac-quizcard-cta">{{ levelPassed(lv) ? 'Retake' : 'Start' }}</span>
          </button>

          <footer class="ac-panel-foot">
            @if (prevLevel(lv); as p) {
              <button type="button" class="btn-ghost ac-levelnav" (click)="selectLevel(p)">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                Level {{ p }}
              </button>
            } @else { <span></span> }
            @if (nextLevel(lv); as n) {
              <button type="button" class="btn-ghost ac-levelnav" (click)="selectLevel(n)">
                Level {{ n }}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            }
          </footer>
        </section>
      }

      @if (allPassed()) {
        <section class="ac-cert" aria-label="Course completion">
          <div class="ac-cert-seal" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 12.9 17 22l-5-3-5 3 1.5-9.1"/></svg>
          </div>
          <div>
            <h2 class="ac-cert-title">All four levels passed</h2>
            <p class="ac-cert-text">
              {{ auth.user()?.first_name || auth.user()?.username || 'You' }}, you've completed the Flavor Tree Academy path.
              This is an in-app achievement, not a professional certification.
            </p>
          </div>
        </section>
      }

      <p class="ac-source">
        The program is based on open materials from the Cicerone Certification Program and the BJCP Style Guidelines.
        The Academy is an introduction to tasting culture and does not replace professional certification.
        Points are given only for knowledge: lessons and quizzes. For ages 21 and over.
      </p>

      @if (showTeam() && team().length) {
        <section class="ac-team">
          <h2 class="section-header mb-2xl">The team</h2>
          <div class="grid grid-3">
            @for (m of team(); track m.id) {
              <div class="glass-card p-2xl">
                <h3 class="ac-team-name">{{ m.name }}</h3>
                <p class="ac-team-role">{{ m.role }}</p>
                <p class="ac-team-bio">{{ m.bio }}</p>
              </div>
            }
          </div>
        </section>
      }
    }

    <!-- Урок или тест: диалог поверх пути -->
    <dialog #sheet class="ac-sheet" aria-labelledby="ac-sheet-title" (cancel)="onCancel($event)" (click)="onBackdrop($event)" (keydown)="onKey($event)">
      @if (mode(); as m) {
        <div class="ac-sheet-box">
          <header class="ac-sheet-head">
            <div class="ac-sheet-head-text">
              <span class="ac-sheet-kicker">
                @if (m === 'lesson') {
                  Level {{ lesson()?.level ?? '' }}
                  @if (lessonPos(); as pos) { · Lesson {{ pos.index + 1 }} of {{ pos.total }} }
                } @else { Level {{ quizLevel() }} · Quiz }
              </span>
              <h2 id="ac-sheet-title" class="ac-sheet-title">
                @if (m === 'lesson') { {{ lesson()?.title ?? 'Loading lesson...' }} }
                @else { {{ quiz()?.title || 'Level ' + quizLevel() + ' quiz' }} }
              </h2>
            </div>
            <button type="button" class="btn-ghost ac-close" (click)="requestClose()" aria-label="Close" autofocus>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </header>

          @if (m === 'lesson') {
            <div class="ac-bar ac-bar-read" aria-hidden="true"><span [style.width.%]="readPct()"></span></div>
          } @else if (quiz() && quizStarted() && !result()) {
            <div class="ac-bar" role="progressbar" aria-label="Quiz progress"
                 [attr.aria-valuenow]="answeredCount()" aria-valuemin="0" [attr.aria-valuemax]="quiz()!.questions.length">
              <span [style.width.%]="answeredCount() * 100 / quiz()!.questions.length"></span>
            </div>
          }

          @if (toast(); as t) {
            <div class="ac-toast" role="status">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              {{ t }}
            </div>
          }

          <div class="ac-sheet-body" #body (scroll)="onBodyScroll()">
            @if (actionError(); as err) {
              <p class="ac-note ac-note-bad ac-note-inline" role="alert">{{ err }}</p>
            }
            @if (sheetError(); as err) {
              <div class="ac-note ac-note-bad" role="alert">
                <p>{{ err }}</p>
                <button type="button" class="btn-outline" (click)="retrySheet()">Try again</button>
              </div>
            } @else if (sheetLoading()) {
              <div class="ac-loading" aria-busy="true">
                <div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>
              </div>
            } @else if (m === 'lesson' && lesson()) {
              @let l = lesson()!;
              <div class="ac-reading">
                <p class="ac-lesson-meta">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  {{ l.minutes }} min read
                  @if (isDoneSlug(l.slug)) { <span class="ac-tag ac-tag-ok">Read</span> }
                </p>
                @for (block of l.blocks; track $index; let bi = $index) {
                  @switch (block.type) {
                    @case ('text') {
                      @if (block.title) { <h3 class="ac-h3">{{ block.title }}</h3> }
                      <p class="ac-p">{{ block.text }}</p>
                    }
                    @case ('facts') {
                      @if (block.title) { <h3 class="ac-h3">{{ block.title }}</h3> }
                      <ul class="ac-facts-list">
                        @for (item of block.items; track $index) { <li>{{ item }}</li> }
                      </ul>
                    }
                    @case ('steps') {
                      @if (block.title) { <h3 class="ac-h3">{{ block.title }}</h3> }
                      <ol class="ac-numbered">
                        @for (item of block.items; track $index; let si = $index) {
                          <li>
                            <span class="ac-numbered-n" aria-hidden="true">{{ si + 1 }}</span>
                            <div>
                              <b>{{ item.title }}</b>
                              <p>{{ item.text }}</p>
                            </div>
                          </li>
                        }
                      </ol>
                    }
                    @case ('tip') {
                      <aside class="ac-tip">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2Z"/></svg>
                        <p>{{ block.text }}</p>
                      </aside>
                    }
                    @case ('check') {
                      <fieldset class="ac-check">
                        <legend>Check yourself</legend>
                        <p class="ac-check-q">{{ block.question }}</p>
                        <div class="ac-options">
                          @for (opt of block.options; track $index; let oi = $index) {
                            <button type="button" class="ac-option"
                                    [class.is-right]="checks()[bi] !== undefined && oi === block.correct_index"
                                    [class.is-wrong]="checks()[bi] === oi && oi !== block.correct_index"
                                    [attr.aria-pressed]="checks()[bi] === oi"
                                    [disabled]="checks()[bi] !== undefined"
                                    (click)="answerCheck(bi, oi)">
                              <span class="ac-letter" aria-hidden="true">{{ letter(oi) }}</span>
                              <span>{{ opt }}</span>
                            </button>
                          }
                        </div>
                        @if (checks()[bi] !== undefined) {
                          <p class="ac-verdict" [class.good]="checks()[bi] === block.correct_index" role="status">
                            <b>{{ checks()[bi] === block.correct_index ? 'Correct.' : 'Not quite.' }}</b> {{ block.explanation }}
                          </p>
                        }
                      </fieldset>
                    }
                    @case ('practice') {
                      <div class="ac-practice">
                        <p>{{ block.text }}</p>
                        <button type="button" class="btn-outline" (click)="practice(block.action)">{{ block.label }}</button>
                      </div>
                    }
                  }
                }
                @if (nextAfter(l.slug); as nx) {
                  <p class="ac-upnext">
                    Up next: <b>{{ nx.kind === 'quiz' ? 'Level ' + nx.level + ' quiz' : nx.title }}</b>
                  </p>
                }
              </div>
            } @else if (m === 'quiz' && result()) {
              @let r = result()!;
              <div class="ac-result" [class.passed]="r.passed">
                <div class="ac-score" role="img" [attr.aria-label]="r.percent + ' percent correct'">
                  <svg viewBox="0 0 120 120" aria-hidden="true">
                    <circle class="ac-ring-track" cx="60" cy="60" r="52" />
                    <circle class="ac-score-fill" cx="60" cy="60" r="52"
                            [style.strokeDasharray]="ringLength" [style.strokeDashoffset]="ringLength * (1 - r.percent / 100)" />
                  </svg>
                  <div class="ac-ring-text"><b>{{ r.percent }}%</b><span>{{ r.correct }} of {{ r.total }}</span></div>
                </div>
                <div>
                  <h3 class="ac-result-title">{{ r.passed ? 'Level ' + r.level + ' passed!' : 'Almost there' }}</h3>
                  <p class="ac-result-text">
                    You need {{ r.pass_percent }}% to pass.
                    @if (r.passed && r.saved) { Saved to your profile. }
                    @if (r.passed && !r.saved) { Sign in to keep this result in your profile. }
                    @if (!r.passed) { Look through the answers below and try again: you will get a fresh set of questions. }
                  </p>
                </div>
              </div>
              <h3 class="ac-h3">Answer review</h3>
              <ol class="ac-review">
                @for (q of quiz()!.questions; track q.id; let qi = $index) {
                  @if (resultFor(q.id); as row) {
                    <li [class.bad]="!row.is_correct">
                      <p class="ac-review-q">
                        <span class="ac-review-mark" aria-hidden="true">{{ row.is_correct ? '✓' : '✕' }}</span>
                        {{ qi + 1 }}. {{ q.text }}
                      </p>
                      @if (!row.is_correct && row.chosen !== null) {
                        <p class="ac-review-a ac-review-wrong">Your answer: {{ q.options[row.chosen] }}</p>
                      }
                      <p class="ac-review-a ac-review-right">Correct answer: {{ q.options[row.correct_index] }}</p>
                      @if (row.explanation) { <p class="ac-review-why">{{ row.explanation }}</p> }
                    </li>
                  }
                }
              </ol>
            } @else if (m === 'quiz' && quiz() && !quizStarted()) {
              @let q = quiz()!;
              <div class="ac-intro">
                <div class="ac-intro-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>
                </div>
                <h3 class="ac-intro-title">Ready to check what you know?</h3>
                <ul class="ac-intro-list">
                  <li><b>{{ q.questions.length }}</b> questions, one at a time</li>
                  <li><b>{{ q.pass_percent }}%</b> correct answers to pass</li>
                  <li>No timer. Retake as many times as you like</li>
                  <li>You'll see the right answers and explanations at the end</li>
                </ul>
              </div>
            } @else if (m === 'quiz' && quiz()) {
              @let q = quiz()!;
              <div class="ac-qdots" aria-label="Questions">
                @for (item of q.questions; track item.id; let di = $index) {
                  <button type="button" class="ac-qdot" [class.current]="di === index()" [class.answered]="answers()[item.id] !== undefined"
                          [attr.aria-label]="'Question ' + (di + 1)" [attr.aria-current]="di === index() ? 'step' : null"
                          (click)="goToQuestion(di)">{{ di + 1 }}</button>
                }
              </div>
              @if (q.questions[index()]; as question) {
                <p class="ac-quiz-count">Question {{ index() + 1 }} of {{ q.questions.length }}</p>
                <h3 class="ac-quiz-q" id="ac-quiz-q">{{ question.text }}</h3>
                <div class="ac-options" role="radiogroup" aria-labelledby="ac-quiz-q">
                  @for (opt of question.options; track $index; let oi = $index) {
                    <button type="button" class="ac-option" role="radio"
                            [class.chosen]="answers()[question.id] === oi"
                            [attr.aria-checked]="answers()[question.id] === oi"
                            (click)="choose(question.id, oi)">
                      <span class="ac-letter" aria-hidden="true">{{ letter(oi) }}</span>
                      <span>{{ opt }}</span>
                    </button>
                  }
                </div>
                <p class="ac-quiz-hint">Tap an answer. You can go back and change it before checking.</p>
              }
            }
          </div>

          <footer class="ac-sheet-foot">
            @if (closeAsk()) {
              <p class="ac-ask" role="alert">The quiz isn't finished. Close it? Your answers won't be saved.</p>
              <button type="button" class="btn-outline" (click)="closeSheet()">Close quiz</button>
              <button type="button" class="btn-amber" (click)="closeAsk.set(false)">Keep going</button>
            } @else if (m === 'lesson' && lesson()) {
              @let l = lesson()!;
              @if (prevLesson(l.slug); as prev) {
                <button type="button" class="btn-outline ac-foot-prev" (click)="openLesson(prev)" aria-label="Previous lesson">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                  <span class="ac-hide-sm">Previous</span>
                </button>
              } @else {
                <button type="button" class="btn-outline ac-foot-prev" (click)="closeSheet()">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                  <span class="ac-hide-sm">Back to path</span>
                </button>
              }
              <button type="button" class="btn-amber ac-foot-main" [disabled]="completing()" (click)="completeAndContinue(l)">
                {{ completing() ? 'Saving...' : mainLessonLabel(l.slug) }}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            } @else if (m === 'quiz' && result()) {
              @let r = result()!;
              <button type="button" class="btn-outline" (click)="restartQuiz(r.level)">Retake quiz</button>
              @if (r.passed && r.level < levels().length) {
                <button type="button" class="btn-amber" (click)="toLevel(r.level + 1)">Start level {{ r.level + 1 }}</button>
              } @else {
                <button type="button" class="btn-amber" (click)="closeSheet()">Back to path</button>
              }
            } @else if (m === 'quiz' && quiz() && !quizStarted() && !sheetError()) {
              <button type="button" class="btn-outline" (click)="closeSheet()">Not now</button>
              <button type="button" class="btn-amber ac-foot-main" (click)="quizStarted.set(true)">Start quiz</button>
            } @else if (m === 'quiz' && quiz() && !sheetError()) {
              @let q = quiz()!;
              <button type="button" class="btn-outline ac-foot-prev" [disabled]="index() === 0 || submitting()" (click)="step(-1)" aria-label="Previous question">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                <span class="ac-hide-sm">Back</span>
              </button>
              @if (allAnswered()) {
                <button type="button" class="btn-amber ac-foot-main" [disabled]="submitting()" (click)="submit()">
                  {{ submitting() ? 'Checking...' : 'Check answers' }}
                </button>
              } @else {
                <button type="button" class="btn-amber ac-foot-main" [disabled]="!answered() || index() >= q.questions.length - 1" (click)="step(1)">
                  Next
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </button>
              }
            }
          </footer>
        </div>
      }
    </dialog>
  `,
  styles: [`
    :host { display: block; }

    /* Шапка раздела: слева обещание, справа прогресс */
    .ac-hero {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
      gap: var(--space-3xl);
      align-items: center;
      margin-bottom: var(--space-3xl);
    }
    .ac-title {
      font-family: var(--font-heading);
      font-size: clamp(2rem, 4.4vw, 3.25rem);
      font-weight: 800;
      line-height: 1.08;
      letter-spacing: -0.02em;
      color: var(--foam);
      margin: 0 0 var(--space-lg);
      text-wrap: balance;
    }
    .ac-accent {
      background: linear-gradient(120deg, var(--beer-light), var(--beer-deep));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .ac-lede { max-width: 54ch; font-size: 1.0625rem; line-height: 1.65; color: var(--foam-dim); margin: 0 0 var(--space-lg); }
    .ac-facts { display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 0; font-size: 0.9375rem; color: var(--muted); }
    .ac-facts b { color: var(--beer-deep); font-weight: 800; }

    .ac-progress {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: var(--space-lg) var(--space-xl);
      padding: var(--space-2xl);
      border: 1px solid var(--line);
      border-radius: var(--radius-2xl);
      background: linear-gradient(160deg, #fff 0%, #FFF7EA 100%);
      box-shadow: var(--shadow-md);
    }
    .ac-ring { position: relative; flex-shrink: 0; width: 104px; height: 104px; }
    .ac-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .ac-ring-track { fill: none; stroke: rgba(180, 83, 9, 0.12); stroke-width: 10; }
    .ac-ring-fill {
      fill: none;
      stroke: var(--beer-mid);
      stroke-width: 10;
      stroke-linecap: round;
      transition: stroke-dashoffset 700ms var(--ease-out);
    }
    .ac-ring-text { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1.1; }
    .ac-ring-text b { font-family: var(--font-heading); font-size: 1.55rem; color: var(--foam); }
    .ac-ring-text span { font-size: 0.75rem; color: var(--muted); }
    .ac-progress-body { min-width: 0; display: grid; gap: 6px; justify-items: start; }
    .ac-progress-kicker { margin: 0; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--beer-mid); }
    .ac-progress-line { margin: 0; color: var(--foam-dim); }
    .ac-progress-line b { color: var(--foam); }
    .ac-guest, .ac-all-done { margin: 0; font-size: 0.875rem; line-height: 1.5; color: var(--muted); }
    .ac-all-done { grid-column: 1 / -1; color: #166534; font-weight: 600; }
    .ac-points {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      background: var(--bg-1);
      color: var(--beer-deep);
      font: inherit;
      font-size: 0.8125rem;
      font-weight: 700;
      cursor: pointer;
    }
    .ac-points:hover { border-color: var(--beer-light); background: var(--beer-glow); }
    .ac-continue {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
      width: 100%;
      min-height: 56px;
      text-align: left;
      white-space: normal;
      line-height: 1.3;
    }
    .ac-continue-text { display: grid; gap: 1px; }
    .ac-continue-text small { font-size: 0.75rem; font-weight: 600; opacity: 0.85; letter-spacing: 0.02em; }

    .ac-error { display: grid; gap: var(--space-md); justify-items: center; padding: var(--space-3xl); text-align: center; }

    /* Дорожка ступеней */
    .ac-track {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--space-sm);
      margin: 0 0 var(--space-xl);
    }
    .ac-track-item {
      position: relative;
      display: grid;
      justify-items: center;
      gap: 2px;
      padding: var(--space-md) 6px var(--space-md);
      border: 1px solid transparent;
      border-radius: var(--radius-xl);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: center;
      cursor: pointer;
      transition: background var(--duration-fast) ease, border-color var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
    }
    /* Линия к следующей ступени: от центра кружка до центра соседнего */
    .ac-track-item:not(:last-child)::after {
      content: '';
      position: absolute;
      top: calc(var(--space-md) + 21px);
      left: calc(50% + 28px);
      right: calc(-50% + 28px - var(--space-sm));
      height: 3px;
      border-radius: 3px;
      background: rgba(180, 83, 9, 0.16);
    }
    .ac-track-item.is-done:not(:last-child)::after { background: #16a34a; }
    .ac-track-item:hover { background: rgba(255, 255, 255, 0.6); }
    .ac-track-item:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .ac-track-item.is-selected { background: var(--bg-1); border-color: var(--line); box-shadow: var(--shadow-warm); }
    .ac-track-dot {
      width: 44px;
      height: 44px;
      display: grid;
      place-content: center;
      margin-bottom: 6px;
      border-radius: 50%;
      border: 2px solid rgba(180, 83, 9, 0.28);
      background: #fff;
      color: var(--beer-deep);
      font-family: var(--font-heading);
      font-size: 1.1rem;
      font-weight: 800;
    }
    .ac-track-dot svg { width: 20px; height: 20px; }
    .ac-track-item.is-current .ac-track-dot { border: none; background: var(--grad-cta); color: #fff; box-shadow: var(--shadow-cta); }
    .ac-track-item.is-done .ac-track-dot { border: none; background: #16a34a; color: #fff; }
    .ac-track-label { font-size: 0.6875rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .ac-track-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-heading); font-size: 1rem; font-weight: 800; color: var(--foam); }
    .ac-track-count { font-size: 0.75rem; font-weight: 700; color: var(--beer-mid); }
    .ac-track-item.is-done .ac-track-count { color: #166534; }

    /* Открытая ступень */
    .ac-panel {
      padding: var(--space-2xl) var(--space-3xl) var(--space-xl);
      margin-bottom: var(--space-3xl);
      border: 1px solid var(--line);
      border-radius: var(--radius-2xl);
      background: var(--bg-1);
      box-shadow: var(--shadow-md);
      animation: acPanel 320ms var(--ease-out);
    }
    @keyframes acPanel { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .ac-panel-done { border-color: rgba(22, 163, 74, 0.35); }
    .ac-panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-lg); margin-bottom: var(--space-lg); }
    .ac-panel-title { min-width: 0; }
    .ac-panel-kicker { display: block; margin-bottom: 4px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--beer-mid); }
    .ac-panel-title h2 { margin: 0 0 6px; font-family: var(--font-heading); font-size: clamp(1.5rem, 3vw, 1.9rem); font-weight: 800; color: var(--foam); line-height: 1.15; }
    .ac-panel-title p { max-width: 64ch; margin: 0; line-height: 1.55; color: var(--foam-dim); }
    .ac-panel-state { flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; }
    .ac-meter { height: 8px; border-radius: 8px; background: rgba(180, 83, 9, 0.1); overflow: hidden; }
    .ac-meter span { display: block; height: 100%; border-radius: 8px; background: var(--grad-cta); transition: width 500ms var(--ease-out); }
    .ac-panel-done .ac-meter span { background: #16a34a; }
    .ac-meter-text { margin: 6px 0 var(--space-xl); font-size: 0.8125rem; font-weight: 600; color: var(--muted); }

    .ac-steps { list-style: none; display: grid; gap: var(--space-sm); margin: 0 0 var(--space-md); padding: 0; }
    .ac-step {
      width: 100%;
      display: flex;
      align-items: center;
      gap: var(--space-lg);
      min-height: 72px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--bg-0);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease, transform var(--duration-fast) ease;
    }
    .ac-step:hover { border-color: var(--beer-light); background: #FFF9EF; }
    .ac-step:active { transform: scale(0.99); }
    .ac-step:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .ac-step.next { border-color: rgba(217, 119, 6, 0.55); background: #FFFBF3; box-shadow: 0 0 0 3px var(--beer-glow); }
    .ac-step-mark {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      display: grid;
      place-content: center;
      border-radius: 50%;
      border: 2px solid rgba(180, 83, 9, 0.3);
      color: var(--beer-deep);
      font-weight: 800;
      font-size: 0.9rem;
      background: #fff;
    }
    .ac-step-mark svg { width: 16px; height: 16px; }
    .ac-step.done .ac-step-mark { border-color: #16a34a; background: #16a34a; color: #fff; }
    .ac-step.next .ac-step-mark { border: none; background: var(--grad-cta); color: #fff; }
    .ac-step-body { flex: 1; min-width: 0; display: grid; gap: 3px; }
    .ac-step-title { font-weight: 700; font-size: 1.0625rem; color: var(--foam); line-height: 1.3; }
    .ac-step-sub { font-size: 0.875rem; line-height: 1.45; color: var(--muted); }
    .ac-step-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .ac-tag { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: var(--radius-full); background: rgba(180, 83, 9, 0.08); color: var(--beer-deep); font-size: 0.75rem; font-weight: 700; }
    .ac-tag-ok { background: var(--success-bg); color: #166534; }
    .ac-tag-next { background: var(--grad-cta); color: #fff; }
    .ac-step-go { flex-shrink: 0; color: var(--beer-mid); opacity: 0.7; }

    .ac-quizcard {
      width: 100%;
      display: flex;
      align-items: center;
      gap: var(--space-lg);
      padding: var(--space-lg) var(--space-xl);
      border: 1.5px dashed rgba(180, 83, 9, 0.4);
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, #FFF3DC, #FFFBF3);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color var(--duration-fast) ease, transform var(--duration-fast) ease;
    }
    .ac-quizcard:hover:not(:disabled) { border-color: var(--beer-mid); }
    .ac-quizcard:active:not(:disabled) { transform: scale(0.99); }
    .ac-quizcard:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .ac-quizcard:disabled { opacity: 0.55; cursor: default; }
    .ac-quizcard.done { border-style: solid; border-color: rgba(22, 163, 74, 0.4); background: linear-gradient(135deg, #ECFDF3, #fff); }
    .ac-quizcard-icon { flex-shrink: 0; width: 48px; height: 48px; display: grid; place-content: center; border-radius: 14px; background: var(--grad-cta); color: #fff; box-shadow: var(--shadow-cta); }
    .ac-quizcard.done .ac-quizcard-icon { background: #16a34a; box-shadow: none; }
    .ac-quizcard-icon svg { width: 24px; height: 24px; }
    .ac-quizcard-body { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .ac-quizcard-title { font-family: var(--font-heading); font-size: 1.1rem; font-weight: 800; color: var(--foam); }
    .ac-quizcard-sub { font-size: 0.875rem; color: var(--foam-dim); }
    .ac-quizcard-hint { font-size: 0.8125rem; color: var(--muted); }
    .ac-quizcard-cta { flex-shrink: 0; padding: 8px 16px; border-radius: var(--radius-full); background: var(--bg-1); border: 1px solid var(--line); font-size: 0.875rem; font-weight: 800; color: var(--beer-deep); }
    .ac-quizcard.done .ac-quizcard-cta { color: #166534; }

    .ac-panel-foot { display: flex; justify-content: space-between; align-items: center; margin-top: var(--space-lg); }
    .ac-levelnav { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; font-weight: 700; color: var(--beer-deep); }

    .ac-cert {
      display: flex;
      align-items: center;
      gap: var(--space-xl);
      padding: var(--space-2xl);
      margin-bottom: var(--space-2xl);
      border: 1px solid rgba(22, 163, 74, 0.35);
      border-radius: var(--radius-2xl);
      background: linear-gradient(135deg, #F0FDF4, #fff);
    }
    .ac-cert-seal { flex-shrink: 0; width: 64px; height: 64px; display: grid; place-content: center; border-radius: 50%; background: #16a34a; color: #fff; }
    .ac-cert-seal svg { width: 34px; height: 34px; }
    .ac-cert-title { margin: 0 0 4px; font-family: var(--font-heading); font-size: 1.3rem; color: var(--foam); }
    .ac-cert-text { margin: 0; color: var(--foam-dim); line-height: 1.55; }
    .ac-source { max-width: 80ch; margin: 0 0 var(--space-4xl); font-size: 0.8125rem; line-height: 1.6; color: var(--muted); }
    .ac-team-name { margin: 0 0 4px; font-size: 1.1rem; }
    .ac-team-role { margin: 0 0 var(--space-md); font-size: 0.875rem; font-weight: 600; color: var(--beer-mid); }
    .ac-team-bio { margin: 0; font-size: 0.875rem; line-height: 1.55; color: var(--foam-dim); }

    /* Диалог урока и теста */
    .ac-sheet {
      width: min(760px, calc(100vw - 32px));
      max-width: none;
      height: min(880px, calc(100dvh - 48px));
      max-height: none;
      margin: auto;
      padding: 0;
      border: none;
      border-radius: var(--radius-2xl);
      background: var(--bg-2);
      color: var(--foam);
      box-shadow: 0 30px 80px -20px rgba(28, 25, 23, 0.45);
      overflow: hidden;
    }
    .ac-sheet:focus { outline: none; }
    .ac-sheet::backdrop { background: rgba(28, 25, 23, 0.55); backdrop-filter: blur(4px); }
    .ac-sheet[open] { animation: acIn 260ms var(--ease-out); }
    @keyframes acIn { from { opacity: 0; transform: translateY(16px) scale(0.985); } to { opacity: 1; transform: none; } }
    .ac-sheet-box { position: relative; display: flex; flex-direction: column; height: 100%; }
    .ac-sheet-head {
      display: flex;
      align-items: flex-start;
      gap: var(--space-md);
      padding: var(--space-xl) var(--space-2xl) var(--space-lg);
      background: var(--bg-1);
    }
    .ac-sheet-head-text { flex: 1; min-width: 0; }
    .ac-sheet-kicker { display: block; margin-bottom: 4px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--beer-mid); }
    .ac-sheet-title { margin: 0; font-family: var(--font-heading); font-size: clamp(1.3rem, 3.4vw, 1.7rem); font-weight: 800; line-height: 1.2; text-wrap: balance; }
    .ac-close { flex-shrink: 0; width: 44px; height: 44px; display: grid; place-content: center; border-radius: 50%; }
    .ac-bar { height: 4px; background: rgba(180, 83, 9, 0.12); }
    .ac-bar span { display: block; height: 100%; background: var(--grad-cta); border-radius: 0 4px 4px 0; transition: width 300ms var(--ease-out); }
    .ac-bar-read span { transition: width 80ms linear; }
    .ac-toast {
      position: absolute;
      z-index: 2;
      top: 84px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: var(--radius-full);
      background: #166534;
      color: #fff;
      font-size: 0.875rem;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: 0 10px 30px -10px rgba(22, 101, 52, 0.6);
      animation: acToast 2600ms var(--ease-out) forwards;
      pointer-events: none;
    }
    @keyframes acToast {
      0% { opacity: 0; transform: translate(-50%, -8px); }
      10%, 85% { opacity: 1; transform: translate(-50%, 0); }
      100% { opacity: 0; transform: translate(-50%, -4px); }
    }
    .ac-sheet-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-2xl) var(--space-3xl) var(--space-3xl); }
    .ac-reading { max-width: 640px; margin: 0 auto; }
    .ac-sheet-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
      padding: var(--space-lg) var(--space-2xl);
      padding-bottom: max(var(--space-lg), env(safe-area-inset-bottom));
      border-top: 1px solid var(--line);
      background: var(--bg-1);
    }
    .ac-sheet-foot:empty { display: none; }
    .ac-sheet-foot .btn-amber, .ac-sheet-foot .btn-outline { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .ac-foot-main { margin-left: auto; min-width: 180px; }
    .ac-loading { display: grid; gap: var(--space-md); }
    .ac-loading .skeleton-line:nth-child(1) { width: 70%; height: 18px; }
    .ac-loading .skeleton-line:nth-child(3) { width: 85%; }

    /* Текст урока */
    .ac-lesson-meta { display: flex; align-items: center; gap: 6px; margin: 0 0 var(--space-lg); font-size: 0.8125rem; font-weight: 700; color: var(--muted); }
    .ac-p { margin: 0 0 var(--space-xl); font-size: 1.0938rem; line-height: 1.75; color: var(--foam-dim); }
    .ac-h3 { margin: var(--space-2xl) 0 var(--space-md); font-family: var(--font-heading); font-size: 1.2rem; font-weight: 800; color: var(--foam); }
    .ac-facts-list { margin: 0 0 var(--space-xl); padding: 0; list-style: none; display: grid; gap: 10px; }
    .ac-facts-list li { position: relative; padding-left: 24px; font-size: 1.03rem; line-height: 1.65; color: var(--foam-dim); }
    .ac-facts-list li::before { content: ''; position: absolute; left: 4px; top: 0.66em; width: 8px; height: 8px; border-radius: 50%; background: var(--beer-light); }
    .ac-numbered { margin: 0 0 var(--space-xl); padding: 0; list-style: none; display: grid; gap: var(--space-md); }
    .ac-numbered li { display: flex; gap: var(--space-md); padding: var(--space-md) var(--space-lg); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--bg-1); }
    .ac-numbered-n { flex-shrink: 0; width: 28px; height: 28px; display: grid; place-content: center; border-radius: 50%; background: var(--beer-glow); color: var(--beer-deep); font-weight: 800; font-size: 0.875rem; }
    .ac-numbered b { color: var(--foam); }
    .ac-numbered p { margin: 2px 0 0; line-height: 1.6; color: var(--foam-dim); }
    .ac-tip { display: flex; gap: var(--space-md); margin: 0 0 var(--space-xl); padding: var(--space-lg); border-radius: var(--radius-lg); background: #FFF3DC; border-left: 4px solid var(--beer-light); color: var(--beer-deep); }
    .ac-tip svg { flex-shrink: 0; margin-top: 2px; }
    .ac-tip p { margin: 0; line-height: 1.6; font-weight: 500; }
    .ac-check { margin: 0 0 var(--space-xl); padding: var(--space-lg); border: 1.5px dashed rgba(180, 83, 9, 0.4); border-radius: var(--radius-lg); background: var(--bg-1); }
    .ac-check legend { padding: 0 8px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--beer-mid); }
    .ac-check-q { margin: 0 0 var(--space-md); font-weight: 700; line-height: 1.45; }
    .ac-practice { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md); margin: 0 0 var(--space-xl); padding: var(--space-lg); border-radius: var(--radius-lg); background: var(--bg-1); border: 1px solid var(--line); }
    .ac-practice p { flex: 1 1 240px; margin: 0; line-height: 1.55; color: var(--foam-dim); }
    .ac-upnext { margin: var(--space-2xl) 0 0; padding-top: var(--space-lg); border-top: 1px solid var(--line); font-size: 0.9375rem; color: var(--muted); }
    .ac-upnext b { color: var(--foam); }

    /* Варианты ответа: общие для самопроверки и теста */
    .ac-options { display: grid; gap: var(--space-sm); }
    .ac-option {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      width: 100%;
      min-height: 56px;
      padding: 12px 16px;
      border: 1.5px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--bg-1);
      color: var(--foam);
      font: inherit;
      font-size: 1rem;
      line-height: 1.4;
      text-align: left;
      cursor: pointer;
      transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease, transform var(--duration-fast) ease;
    }
    .ac-option:hover:not(:disabled) { border-color: var(--beer-light); background: #FFF9EF; }
    .ac-option:active:not(:disabled) { transform: scale(0.99); }
    .ac-option:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .ac-option:disabled { cursor: default; color: var(--foam-dim); }
    .ac-letter { flex-shrink: 0; width: 30px; height: 30px; display: grid; place-content: center; border-radius: 50%; border: 1.5px solid rgba(180, 83, 9, 0.35); background: #fff; color: var(--beer-deep); font-size: 0.8125rem; font-weight: 800; transition: all var(--duration-fast) ease; }
    .ac-option.chosen { border-color: var(--beer-mid); background: #FFF4DF; font-weight: 600; }
    .ac-option.chosen .ac-letter { border-color: transparent; background: var(--grad-cta); color: #fff; }
    .ac-option.is-right { border-color: #16a34a; background: #F0FDF4; color: #14532d; font-weight: 600; }
    .ac-option.is-right .ac-letter { border-color: transparent; background: #16a34a; color: #fff; }
    .ac-option.is-wrong { border-color: #dc2626; background: #FEF2F2; color: #7f1d1d; }
    .ac-option.is-wrong .ac-letter { border-color: transparent; background: #dc2626; color: #fff; }
    .ac-verdict { margin: var(--space-md) 0 0; line-height: 1.55; color: #7f1d1d; }
    .ac-verdict.good { color: #14532d; }

    .ac-qdots { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 var(--space-xl); }
    .ac-qdot { width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid var(--line); background: var(--bg-1); color: var(--muted); font: inherit; font-size: 0.8125rem; font-weight: 700; cursor: pointer; }
    .ac-qdot.answered { border-color: transparent; background: rgba(180, 83, 9, 0.14); color: var(--beer-deep); }
    .ac-qdot.current { border-color: var(--beer-mid); background: var(--beer-mid); color: #fff; }
    .ac-qdot:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .ac-quiz-count { margin: 0 0 var(--space-sm); font-size: 0.8125rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--beer-mid); }
    .ac-quiz-q { margin: 0 0 var(--space-xl); font-family: var(--font-heading); font-size: clamp(1.2rem, 3vw, 1.5rem); line-height: 1.3; text-wrap: balance; }
    .ac-quiz-hint { margin: var(--space-lg) 0 0; font-size: 0.8125rem; color: var(--muted); }

    .ac-intro { max-width: 520px; margin: var(--space-xl) auto; text-align: center; }
    .ac-intro-icon { width: 72px; height: 72px; display: grid; place-content: center; margin: 0 auto var(--space-lg); border-radius: 22px; background: var(--grad-cta); color: #fff; box-shadow: var(--shadow-cta); }
    .ac-intro-icon svg { width: 34px; height: 34px; }
    .ac-intro-title { margin: 0 0 var(--space-xl); font-family: var(--font-heading); font-size: 1.5rem; font-weight: 800; }
    .ac-intro-list { display: grid; gap: var(--space-sm); margin: 0; padding: 0; list-style: none; text-align: left; }
    .ac-intro-list li { padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--bg-1); color: var(--foam-dim); }
    .ac-intro-list b { color: var(--beer-deep); }

    .ac-note { display: grid; gap: var(--space-md); justify-items: start; padding: var(--space-lg); border-radius: var(--radius-lg); }
    .ac-note-bad { background: #FEF2F2; border: 1px solid rgba(220, 38, 38, 0.3); color: #7f1d1d; }
    .ac-note p { margin: 0; }
    .ac-note-inline { margin: 0 0 var(--space-lg); }
    .ac-ask { flex: 1 1 100%; margin: 0; font-weight: 600; color: var(--foam); }

    .ac-result { display: flex; align-items: center; gap: var(--space-xl); padding: var(--space-xl); border-radius: var(--radius-xl); background: #FFF7ED; border: 1px solid rgba(217, 119, 6, 0.3); }
    .ac-result.passed { background: #F0FDF4; border-color: rgba(22, 163, 74, 0.35); }
    .ac-score { position: relative; flex-shrink: 0; width: 108px; height: 108px; }
    .ac-score svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .ac-score-fill { fill: none; stroke: var(--beer-light); stroke-width: 10; stroke-linecap: round; transition: stroke-dashoffset 900ms var(--ease-out); }
    .ac-result.passed .ac-score-fill { stroke: #16a34a; }
    .ac-result-title { margin: 0 0 4px; font-family: var(--font-heading); font-size: 1.4rem; }
    .ac-result-text { margin: 0; line-height: 1.55; color: var(--foam-dim); }
    .ac-review { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-md); }
    .ac-review li { padding: var(--space-md) var(--space-lg); border-radius: var(--radius-lg); border: 1px solid rgba(22, 163, 74, 0.3); background: #F7FEF9; }
    .ac-review li.bad { border-color: rgba(220, 38, 38, 0.3); background: #FFF8F8; }
    .ac-review p { margin: 0; line-height: 1.5; }
    .ac-review-q { font-weight: 700; margin-bottom: 6px !important; }
    .ac-review-mark { display: inline-grid; place-content: center; width: 20px; height: 20px; margin-right: 4px; border-radius: 50%; background: #16a34a; color: #fff; font-size: 0.7rem; vertical-align: 1px; }
    .ac-review li.bad .ac-review-mark { background: #dc2626; }
    .ac-review-a { font-size: 0.9375rem; }
    .ac-review-wrong { color: #991b1b; }
    .ac-review-right { color: #166534; font-weight: 600; }
    .ac-review-why { margin-top: 6px !important; font-size: 0.875rem; color: var(--muted); }

    @media (max-width: 960px) {
      .ac-hero { grid-template-columns: 1fr; gap: var(--space-xl); }
    }

    @media (max-width: 600px) {
      .ac-hero { margin-bottom: var(--space-xl); }
      .ac-lede { font-size: 1rem; margin-bottom: var(--space-md); }
      .ac-facts { font-size: 0.875rem; }
      .ac-progress { padding: var(--space-lg); gap: var(--space-md) var(--space-lg); }
      .ac-ring { width: 84px; height: 84px; }
      .ac-ring-text b { font-size: 1.25rem; }
      .ac-track { gap: 2px; margin-bottom: var(--space-lg); }
      .ac-track-item { padding: var(--space-sm) 2px; border-radius: var(--radius-lg); }
      .ac-track-item:not(:last-child)::after { top: calc(var(--space-sm) + 18px); left: calc(50% + 22px); right: calc(-50% + 22px - 2px); }
      .ac-track-dot { width: 36px; height: 36px; font-size: 0.95rem; margin-bottom: 4px; }
      .ac-track-label { display: none; }
      .ac-track-name { font-size: 0.75rem; letter-spacing: -0.01em; }
      .ac-panel { padding: var(--space-lg); border-radius: var(--radius-xl); }
      .ac-panel-head { flex-direction: column; gap: var(--space-sm); }
      .ac-step { gap: var(--space-md); padding: 12px; }
      .ac-step-title { font-size: 1rem; }
      .ac-step-go { display: none; }
      .ac-quizcard { padding: var(--space-md); gap: var(--space-md); flex-wrap: wrap; }
      .ac-quizcard-icon { width: 42px; height: 42px; border-radius: 12px; }
      .ac-quizcard-body { flex-basis: calc(100% - 60px); }
      .ac-quizcard-cta { flex: 1 1 100%; text-align: center; background: var(--grad-cta); color: #fff; border: none; padding: 10px; }
      .ac-quizcard.done .ac-quizcard-cta { background: var(--bg-1); border: 1px solid rgba(22, 163, 74, 0.4); }
      .ac-cert { flex-direction: column; align-items: flex-start; }
      /* Телефон: лист на весь экран, кнопки внизу на всю ширину */
      .ac-sheet { width: 100vw; height: 100dvh; border-radius: 0; }
      .ac-sheet-head { padding: var(--space-lg) var(--space-lg) var(--space-md); }
      .ac-sheet-body { padding: var(--space-lg) var(--space-lg) var(--space-2xl); }
      .ac-toast { top: 76px; }
      .ac-p { font-size: 1.0313rem; }
      .ac-sheet-foot { flex-wrap: nowrap; padding: var(--space-md) var(--space-lg); padding-bottom: max(var(--space-md), env(safe-area-inset-bottom)); }
      .ac-sheet-foot .btn-amber, .ac-sheet-foot .btn-outline { flex: 1 1 auto; }
      .ac-sheet-foot .ac-foot-prev { flex: 0 0 52px; padding: 0; }
      .ac-foot-main { min-width: 0; }
      .ac-hide-sm { display: none; }
      .ac-sheet-foot:has(.ac-ask) { flex-wrap: wrap; }
      .ac-result { flex-direction: column; align-items: flex-start; }
    }

    @media (prefers-reduced-motion: reduce) {
      .ac-sheet[open], .ac-panel, .ac-toast { animation: none; }
      .ac-ring-fill, .ac-bar span, .ac-meter span, .ac-score-fill { transition: none; }
    }
  `]
})
export class AcademyComponent implements OnInit {
  private api = inject(ApiService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);
  private selection = inject(SelectionService);
  readonly auth = inject(AuthService);
  readonly prefs = inject(PreferencesService);

  @Output() navigate = new EventEmitter<ActiveTab>();

  private sheetEl = viewChild<ElementRef<HTMLDialogElement>>('sheet');
  private bodyEl = viewChild<ElementRef<HTMLElement>>('body');

  readonly academy = signal<Academy | null>(null);
  readonly loaded = signal(false);
  readonly failed = signal(false);
  readonly team = signal<TeamMember[]>([]);

  /** Прогресс гостя без входа. У вошедшего прогресс приходит с сервера. */
  private localLessons = signal<string[]>(readList<string>(LOCAL_LESSONS));
  private localLevels = signal<number[]>(readList<number>(LOCAL_LEVELS));

  /** Ступень, выбранная на дорожке. null: показываем ту, где следующий шаг. */
  readonly selectedLevel = signal<number | null>(null);

  readonly mode = signal<SheetMode | null>(null);
  readonly sheetLoading = signal(false);
  readonly sheetError = signal('');
  readonly lesson = signal<Lesson | null>(null);
  /** Ответы на вопросы самопроверки: номер блока -> выбранный вариант. */
  readonly checks = signal<Record<number, number>>({});
  readonly completing = signal(false);
  /** Сколько урока прокручено, для полоски чтения. */
  readonly readPct = signal(0);
  /** Короткое сообщение поверх листа: «Урок пройден», «+5 баллов знаний». */
  readonly toast = signal('');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly quizLevel = signal(1);
  readonly quiz = signal<Quiz | null>(null);
  /** Тест начинается с короткого экрана правил. */
  readonly quizStarted = signal(false);
  readonly index = signal(0);
  readonly answers = signal<Record<string, number>>({});
  readonly result = signal<QuizResult | null>(null);
  readonly submitting = signal(false);
  /** Гость закрывает незаконченный тест: в подвале листа вопрос «закрыть или продолжить». */
  readonly closeAsk = signal(false);
  /** Ошибка действия (сохранить урок, проверить тест): показывается над содержимым, не вместо него. */
  readonly actionError = signal('');
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;

  readonly ringLength = 2 * Math.PI * 52;

  readonly levels = computed(() => this.academy()?.levels ?? []);
  readonly passPercent = computed(() => this.academy()?.pass_percent ?? 70);
  readonly showTeam = computed(() => !!this.academy()?.show_team);
  readonly points = computed(() => this.academy()?.progress.points ?? null);
  readonly lessonsTotal = computed(() => this.levels().reduce((sum, lv) => sum + lv.lessons.length, 0));
  readonly questionsTotal = computed(() => this.levels().reduce((sum, lv) => sum + lv.questions, 0));

  /** Все шаги пути по порядку: уроки ступени, затем её тест. */
  readonly steps = computed<PathStep[]>(() => {
    const list: PathStep[] = [];
    for (const lv of this.levels()) {
      for (const lesson of lv.lessons) {
        list.push({ kind: 'lesson', level: lv.level, title: lesson.title, slug: lesson.slug, done: this.lessonDone(lesson) });
      }
      if (lv.quiz_size) list.push({ kind: 'quiz', level: lv.level, title: 'Quiz', done: this.levelPassed(lv) });
    }
    return list;
  });
  readonly totalSteps = computed(() => this.steps().length);
  readonly doneSteps = computed(() => this.steps().filter(s => s.done).length);
  readonly percent = computed(() => this.totalSteps() ? Math.round(this.doneSteps() * 100 / this.totalSteps()) : 0);
  readonly ringOffset = computed(() => this.ringLength * (1 - this.percent() / 100));
  readonly nextStep = computed(() => this.steps().find(s => !s.done) ?? null);
  readonly allPassed = computed(() => this.levels().length > 0 && this.levels().every(lv => this.levelPassed(lv)));

  /** Ступень под дорожкой. */
  readonly shownLevel = computed<AcademyLevel | null>(() => {
    const list = this.levels();
    if (!list.length) return null;
    const want = this.selectedLevel() ?? this.nextStep()?.level ?? list[list.length - 1].level;
    return list.find(lv => lv.level === want) ?? list[0];
  });

  /** Номер урока внутри его ступени, для подписи «Урок 2 из 3». */
  readonly lessonPos = computed(() => {
    const l = this.lesson();
    if (!l) return null;
    const lv = this.levels().find(item => item.level === l.level);
    const index = lv ? lv.lessons.findIndex(item => item.slug === l.slug) : -1;
    return lv && index >= 0 ? { index, total: lv.lessons.length } : null;
  });

  readonly answered = computed(() => {
    const q = this.quiz()?.questions[this.index()];
    return !!q && this.answers()[q.id] !== undefined;
  });
  readonly answeredCount = computed(() => Object.keys(this.answers()).length);
  readonly allAnswered = computed(() => {
    const q = this.quiz();
    return !!q && q.questions.length > 0 && q.questions.every(item => this.answers()[item.id] !== undefined);
  });

  private lastSheet: { mode: SheetMode; slug?: string; level?: number } | null = null;

  constructor() {
    // Вошли или вышли: прогресс на пути другой
    effect(() => {
      this.auth.user();
      untracked(() => { if (this.loaded() || this.failed()) this.load(); });
    }, { allowSignalWrites: true });

    // Адрес /academy/<slug> и кнопки браузера: открываем и закрываем урок вслед за адресом
    effect(() => {
      const slug = this.selection.lessonSlug();
      untracked(() => {
        if (slug) {
          if (this.lesson()?.slug !== slug || this.mode() !== 'lesson') this.showLesson(slug);
        } else if (this.mode() === 'lesson') {
          this.hideSheet();
        }
      });
    }, { allowSignalWrites: true });

    this.destroyRef.onDestroy(() => {
      if (this.toastTimer) clearTimeout(this.toastTimer);
      if (this.advanceTimer) clearTimeout(this.advanceTimer);
    });
  }

  ngOnInit() {
    this.load();
    this.api.getTeam().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => this.team.set(data),
      error: () => this.team.set([]),
    });
  }

  load() {
    this.failed.set(false);
    this.api.getAcademy().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => {
        this.academy.set(data);
        this.loaded.set(true);
        this.syncLocalProgress(data);
      },
      error: () => {
        this.loaded.set(false);
        this.failed.set(true);
      },
    });
  }

  /** Гость читал уроки без входа, а потом вошёл: переносим прочитанное в аккаунт. */
  private syncLocalProgress(data: Academy) {
    if (!data.progress.authenticated) return;
    const serverDone = new Set(data.levels.flatMap(lv => lv.lessons.filter(l => l.done).map(l => l.slug)));
    const known = new Set(data.levels.flatMap(lv => lv.lessons.map(l => l.slug)));
    const pending = this.localLessons().filter(slug => known.has(slug) && !serverDone.has(slug));
    this.setLocalLessons([]);
    this.setLocalLevels([]);
    if (!pending.length) return;
    from(pending).pipe(concatMap(slug => this.api.completeLesson(slug)), takeUntilDestroyed(this.destroyRef)).subscribe({
      complete: () => this.load(),
      error: () => this.load(),
    });
  }

  // Прогресс

  lessonDone(lesson: LessonCard): boolean {
    return lesson.done || this.localLessons().includes(lesson.slug);
  }

  isDoneSlug(slug: string): boolean {
    return this.levels().some(lv => lv.lessons.some(l => l.slug === slug && this.lessonDone(l)));
  }

  isNext(slug: string): boolean {
    const n = this.nextStep();
    return !!n && n.kind === 'lesson' && n.slug === slug;
  }

  levelPassed(lv: AcademyLevel): boolean {
    return lv.passed || this.localLevels().includes(lv.level);
  }

  levelDone(lv: AcademyLevel): number {
    return lv.lessons.filter(l => this.lessonDone(l)).length + (this.levelPassed(lv) ? 1 : 0);
  }

  levelSteps(lv: AcademyLevel): number {
    return lv.lessons.length + (lv.quiz_size ? 1 : 0);
  }

  lessonsLeft(lv: AcademyLevel): number {
    return lv.lessons.filter(l => !this.lessonDone(l)).length;
  }

  prevLevel(lv: AcademyLevel): number | null {
    const list = this.levels();
    const i = list.findIndex(item => item.level === lv.level);
    return i > 0 ? list[i - 1].level : null;
  }

  nextLevel(lv: AcademyLevel): number | null {
    const list = this.levels();
    const i = list.findIndex(item => item.level === lv.level);
    return i >= 0 && i < list.length - 1 ? list[i + 1].level : null;
  }

  selectLevel(level: number) {
    this.selectedLevel.set(level);
  }

  /** Шаг пути после урока: следующий урок или тест ступени. */
  nextAfter(slug: string): PathStep | null {
    const list = this.steps();
    const i = list.findIndex(s => s.kind === 'lesson' && s.slug === slug);
    return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  }

  /** Предыдущий урок по пути (тесты пропускаем). */
  prevLesson(slug: string): string | null {
    const list = this.steps();
    const i = list.findIndex(s => s.kind === 'lesson' && s.slug === slug);
    for (let k = i - 1; k >= 0; k--) {
      if (list[k].kind === 'lesson' && list[k].slug) return list[k].slug!;
    }
    return null;
  }

  mainLessonLabel(slug: string): string {
    const next = this.nextAfter(slug);
    const done = this.isDoneSlug(slug);
    if (!next) return done ? 'Back to path' : 'Finish lesson';
    const target = next.kind === 'quiz' ? 'take the quiz' : 'next lesson';
    if (done) return next.kind === 'quiz' ? 'Take the level quiz' : 'Next lesson';
    return 'Done, ' + target;
  }

  letter(i: number): string {
    return LETTERS[i] ?? String(i + 1);
  }

  private setLocalLessons(list: string[]) {
    this.localLessons.set(list);
    writeList(LOCAL_LESSONS, list);
  }

  private setLocalLevels(list: number[]) {
    this.localLevels.set(list);
    writeList(LOCAL_LEVELS, list);
  }

  private showToast(text: string) {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set('');
    // Новый узел: анимация запускается заново, даже если прошлое сообщение ещё видно
    queueMicrotask(() => this.toast.set(text));
    this.toastTimer = setTimeout(() => this.toast.set(''), 2700);
  }

  // Диалог

  openStep(step: PathStep) {
    if (step.kind === 'lesson' && step.slug) this.openLesson(step.slug);
    else this.openQuiz(step.level);
  }

  /** Урок открывается через адрес: так работает кнопка «назад» и ссылкой можно поделиться. */
  openLesson(slug: string) {
    if (this.selection.lessonSlug() === slug) this.showLesson(slug);
    else this.selection.lessonSlug.set(slug);
  }

  private showLesson(slug: string) {
    this.lastSheet = { mode: 'lesson', slug };
    this.mode.set('lesson');
    this.lesson.set(null);
    this.checks.set({});
    this.readPct.set(0);
    this.sheetError.set('');
    this.sheetLoading.set(true);
    this.showSheet();
    this.api.getLesson(slug).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: lesson => {
        if (this.selection.lessonSlug() !== slug) return;
        this.lesson.set(lesson);
        this.selectedLevel.set(lesson.level);
        this.sheetLoading.set(false);
        this.scrollBodyTop();
      },
      error: err => {
        if (this.selection.lessonSlug() !== slug) return;
        this.sheetLoading.set(false);
        this.sheetError.set(err?.status === 404 ? 'This lesson doesn\'t exist. It may have been removed.' : 'Couldn\'t load the lesson. Please check your connection.');
      },
    });
  }

  openQuiz(level: number, startNow = false) {
    this.lastSheet = { mode: 'quiz', level };
    // Тест не привязан к адресу: если был открыт урок, убираем его из адреса без закрытия диалога
    this.mode.set('quiz');
    if (this.selection.lessonSlug()) this.selection.lessonSlug.set(null);
    this.selectedLevel.set(level);
    this.quizLevel.set(level);
    this.quiz.set(null);
    this.quizStarted.set(startNow);
    this.result.set(null);
    this.answers.set({});
    this.index.set(0);
    this.sheetError.set('');
    this.sheetLoading.set(true);
    this.showSheet();
    this.api.getQuiz(level).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: quiz => {
        if (this.mode() !== 'quiz' || this.quizLevel() !== level) return;
        this.quiz.set(quiz);
        this.sheetLoading.set(false);
        this.scrollBodyTop();
        if (!quiz.questions.length) this.sheetError.set('This level has no questions yet.');
      },
      error: () => {
        this.sheetLoading.set(false);
        this.sheetError.set('Couldn\'t load the quiz. Please check your connection.');
      },
    });
  }

  /** Пересдача из экрана результата: правила уже видели, начинаем сразу. */
  restartQuiz(level: number) {
    this.openQuiz(level, true);
  }

  retrySheet() {
    const last = this.lastSheet;
    if (!last) return;
    if (last.mode === 'lesson' && last.slug) this.showLesson(last.slug);
    else if (last.level) this.openQuiz(last.level);
  }

  toLevel(level: number) {
    this.selectedLevel.set(level);
    const first = this.levels().find(lv => lv.level === level)?.lessons[0];
    if (first) this.openLesson(first.slug);
    else this.openQuiz(level);
  }

  closeSheet() {
    if (this.mode() === 'lesson' && this.selection.lessonSlug()) this.selection.lessonSlug.set(null);
    else this.hideSheet();
  }

  private showSheet() {
    this.closeAsk.set(false);
    this.actionError.set('');
    const open = () => {
      const dialog = this.sheetEl()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
      return !!dialog;
    };
    // Страница открыта сразу по адресу урока: диалог появится только после первой отрисовки
    if (!open()) afterNextRender(() => { if (this.mode()) open(); }, { injector: this.injector });
  }

  private hideSheet() {
    this.mode.set(null);
    this.closeAsk.set(false);
    this.toast.set('');
    const dialog = this.sheetEl()?.nativeElement;
    if (dialog?.open) dialog.close();
  }

  private scrollBodyTop() {
    queueMicrotask(() => {
      this.bodyEl()?.nativeElement.scrollTo({ top: 0 });
      this.readPct.set(0);
    });
  }

  onBodyScroll() {
    if (this.mode() !== 'lesson') return;
    const el = this.bodyEl()?.nativeElement;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    this.readPct.set(max > 0 ? Math.min(100, Math.round(el.scrollTop * 100 / max)) : 100);
  }

  /** Esc: закрываем сами, чтобы адрес и состояние не разошлись. Незаконченный тест просит подтверждения. */
  onCancel(event: Event) {
    event.preventDefault();
    this.requestClose();
  }

  /** Клик по затемнению вокруг листа. */
  onBackdrop(event: MouseEvent) {
    if (event.target === this.sheetEl()?.nativeElement) this.requestClose();
  }

  /** Клавиши в тесте: 1-4 выбирают ответ, стрелки листают вопросы. */
  onKey(event: KeyboardEvent) {
    if (this.mode() !== 'quiz' || !this.quizStarted() || this.result() || this.closeAsk()) return;
    const q = this.quiz()?.questions[this.index()];
    if (!q) return;
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
      event.preventDefault();
      this.choose(q.id, n - 1);
    } else if (event.key === 'ArrowRight' && this.answered()) {
      this.step(1);
    } else if (event.key === 'ArrowLeft') {
      this.step(-1);
    }
  }

  /** Незаконченный тест закрываем только после подтверждения в самом листе. */
  requestClose() {
    const unfinished = this.mode() === 'quiz' && !this.result() && Object.keys(this.answers()).length > 0;
    if (unfinished && !this.closeAsk()) {
      this.closeAsk.set(true);
      return;
    }
    this.closeSheet();
  }

  // Урок

  answerCheck(block: number, option: number) {
    if (this.checks()[block] !== undefined) return;
    this.checks.update(c => ({ ...c, [block]: option }));
  }

  /** Главная кнопка урока: отметить прочитанным и перейти к следующему шагу пути. */
  completeAndContinue(lesson: Lesson) {
    if (this.completing()) return;
    this.actionError.set('');
    if (this.isDoneSlug(lesson.slug)) {
      this.goAfter(lesson.slug);
      return;
    }
    if (!this.auth.isLoggedIn()) {
      if (!this.localLessons().includes(lesson.slug)) this.setLocalLessons([...this.localLessons(), lesson.slug]);
      this.showToast('Lesson complete');
      this.goAfter(lesson.slug);
      return;
    }
    this.completing.set(true);
    this.api.completeLesson(lesson.slug).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.completing.set(false);
        this.academy.update(a => a ? {
          ...a,
          levels: a.levels.map(lv => ({ ...lv, lessons: lv.lessons.map(l => l.slug === lesson.slug ? { ...l, done: true } : l) })),
          progress: { ...a.progress, points: res.points },
        } : a);
        this.showToast(res.awarded ? `Lesson complete: +${res.awarded} knowledge ${res.awarded === 1 ? 'point' : 'points'}` : 'Lesson complete');
        this.goAfter(lesson.slug);
      },
      error: () => {
        this.completing.set(false);
        this.actionError.set('Couldn\'t save your progress. Please check your connection and try again.');
      },
    });
  }

  private goAfter(slug: string) {
    const next = this.nextAfter(slug);
    if (!next) this.closeSheet();
    else if (next.kind === 'lesson' && next.slug) this.openLesson(next.slug);
    else this.openQuiz(next.level);
  }

  /** Кнопка «попробуйте на практике» ведёт в раздел сайта. */
  practice(action: LessonAction) {
    const tab: ActiveTab = action === 'explorer' ? 'explorer' : action === 'pairing' ? 'pairing' : action === 'menu' ? 'menu' : 'landing';
    this.hideSheet();
    this.selection.lessonSlug.set(null);
    this.navigate.emit(tab);
  }

  // Тест

  /** Выбор ответа. Первый ответ на вопрос сам переводит к следующему, чтобы на телефоне не тянуться к кнопке. */
  choose(questionId: string, option: number) {
    if (this.result() || this.submitting()) return;
    const first = this.answers()[questionId] === undefined;
    this.answers.update(a => ({ ...a, [questionId]: option }));
    const q = this.quiz();
    const at = this.index();
    if (!first || !q || at >= q.questions.length - 1) return;
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = setTimeout(() => {
      if (this.mode() === 'quiz' && this.index() === at && !this.result()) this.step(1);
    }, 380);
  }

  goToQuestion(i: number) {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.index.set(i);
  }

  step(delta: number) {
    const q = this.quiz();
    if (!q) return;
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.index.set(Math.min(Math.max(this.index() + delta, 0), q.questions.length - 1));
    this.scrollBodyTop();
  }

  resultFor(questionId: string) {
    return this.result()?.results.find(r => r.id === questionId) ?? null;
  }

  submit() {
    const q = this.quiz();
    if (!q || this.submitting() || !this.allAnswered()) return;
    this.submitting.set(true);
    this.actionError.set('');
    this.api.submitQuiz(q.level, this.answers()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        this.submitting.set(false);
        this.result.set(r);
        this.scrollBodyTop();
        if (r.passed) this.showToast(`Level ${r.level} passed`);
        if (r.saved) {
          // Новая ступень и баллы: обновляем путь и предпочтения
          this.prefs.reload();
          this.load();
        } else if (r.passed && !this.localLevels().includes(r.level)) {
          this.setLocalLevels([...this.localLevels(), r.level]);
        }
      },
      error: () => {
        this.submitting.set(false);
        this.actionError.set('Couldn\'t check your answers. Please try again.');
      },
    });
  }
}
