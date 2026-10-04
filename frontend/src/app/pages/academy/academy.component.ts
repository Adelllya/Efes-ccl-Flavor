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

/**
 * Академия: путь из четырёх ступеней. В ступени три коротких урока и тест.
 * Урок и тест открываются в диалоге поверх пути; адрес урока попадает в строку
 * браузера (/academy/<slug>), поэтому уроком можно поделиться, а кнопка «назад» его закрывает.
 */
@Component({
  selector: 'app-academy',
  standalone: true,
  template: `
    <section class="ac-hero">
      <div class="ac-hero-text">
        <span class="badge mb-md">Академия вкуса</span>
        <h1 class="ac-title">Научитесь <span class="ac-accent">слышать вкус</span></h1>
        <p class="ac-lede">
          Четыре ступени, двенадцать коротких уроков и тесты. От первого внимательного глотка до совета гостю за 15 секунд.
        </p>
        <ul class="ac-facts" aria-label="Коротко о программе">
          <li><b>{{ lessonsTotal() || 12 }}</b> уроков по 3-4 минуты</li>
          <li><b>{{ questionsTotal() || 52 }}</b> вопросов в тестах</li>
          <li><b>4</b> ступени</li>
        </ul>
      </div>

      <aside class="ac-progress" aria-label="Ваш прогресс">
        <div class="ac-ring" role="img" [attr.aria-label]="'Пройдено ' + doneSteps() + ' из ' + totalSteps() + ' шагов'">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="ac-ring-track" cx="60" cy="60" r="52" />
            <circle class="ac-ring-fill" cx="60" cy="60" r="52"
                    [style.strokeDasharray]="ringLength" [style.strokeDashoffset]="ringOffset()" />
          </svg>
          <div class="ac-ring-text">
            <b>{{ percent() }}%</b>
            <span>пути</span>
          </div>
        </div>
        <div class="ac-progress-body">
          <p class="ac-progress-line">
            <b>{{ doneSteps() }} из {{ totalSteps() }}</b> шагов пройдено
          </p>
          @if (points(); as p) {
            <button type="button" class="ac-points" (click)="navigate.emit('passport')">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 15 8.5l7 1-5 4.9 1.2 7L12 18l-6.2 3.4 1.2-7-5-4.9 7-1L12 2Z"/></svg>
              {{ p.balance }} баллов · {{ p.rank.title }}
            </button>
          } @else if (loaded()) {
            <p class="ac-guest">
              Прогресс хранится на этом устройстве.
              <button type="button" class="auth-link" (click)="navigate.emit('login')">Войдите</button>,
              чтобы сохранить его и получать баллы знаний.
            </p>
          }
          @if (nextStep(); as step) {
            <button type="button" class="btn-amber ac-continue" (click)="openStep(step)">
              {{ doneSteps() ? 'Продолжить' : 'Начать' }}: {{ step.kind === 'quiz' ? 'тест ступени ' + step.level : step.title }}
            </button>
          } @else if (loaded() && totalSteps()) {
            <p class="ac-all-done">Все ступени пройдены. Отличная работа!</p>
          }
        </div>
      </aside>
    </section>

    @if (failed()) {
      <div class="glass-panel ac-error" role="alert">
        <p>Не удалось загрузить Академию. Проверьте соединение.</p>
        <button type="button" class="btn-outline" (click)="load()">Обновить</button>
      </div>
    } @else if (!loaded()) {
      <div class="skeleton-grid mb-5xl" aria-busy="true" aria-label="Загружаем Академию">
        @for (i of [1, 2, 3, 4]; track i) {
          <div class="skeleton-card">
            <div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>
          </div>
        }
      </div>
    } @else {
      <ol class="ac-path" aria-label="Путь обучения">
        @for (lv of levels(); track lv.level) {
          <li class="ac-level" [class.ac-level-done]="levelPassed(lv)">
            <header class="ac-level-head">
              <span class="ac-level-num" aria-hidden="true">{{ lv.level }}</span>
              <div class="ac-level-text">
                <h2 class="ac-level-title">Ступень {{ lv.level }}. {{ lv.name }}</h2>
                @if (lv.description) { <p class="ac-level-desc">{{ lv.description }}</p> }
              </div>
              @if (levelPassed(lv)) {
                <span class="badge badge-success ac-level-state">Сдано</span>
              } @else {
                <span class="ac-level-state ac-level-count">{{ levelDone(lv) }} из {{ lv.lessons.length + 1 }}</span>
              }
            </header>

            <ul class="ac-steps">
              @for (lesson of lv.lessons; track lesson.slug; let i = $index) {
                <li>
                  <button type="button" class="ac-step" [class.done]="lessonDone(lesson)" (click)="openLesson(lesson.slug)">
                    <span class="ac-step-mark" aria-hidden="true">
                      @if (lessonDone(lesson)) {
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                      } @else { {{ i + 1 }} }
                    </span>
                    <span class="ac-step-body">
                      <span class="ac-step-title">{{ lesson.title }}</span>
                      <span class="ac-step-sub">{{ lesson.summary }}</span>
                    </span>
                    <span class="ac-step-meta">
                      {{ lessonDone(lesson) ? 'Прочитан' : lesson.minutes + ' мин' }}
                    </span>
                  </button>
                </li>
              }
              <li>
                <button type="button" class="ac-step ac-step-quiz" [class.done]="levelPassed(lv)"
                        [disabled]="!lv.quiz_size" (click)="openQuiz(lv.level)">
                  <span class="ac-step-mark" aria-hidden="true">
                    @if (levelPassed(lv)) {
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    } @else {
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>
                    }
                  </span>
                  <span class="ac-step-body">
                    <span class="ac-step-title">Тест ступени</span>
                    <span class="ac-step-sub">
                      @if (!lv.quiz_size) {
                        Вопросы скоро появятся
                      } @else {
                        {{ lv.quiz_size }} вопросов из {{ lv.questions }}, проходной балл {{ passPercent() }}%
                        @if (lv.best_percent !== null) { · лучший результат {{ lv.best_percent }}% }
                      }
                    </span>
                  </span>
                  <span class="ac-step-meta">{{ levelPassed(lv) ? 'Сдан' : 'Пройти' }}</span>
                </button>
              </li>
            </ul>
          </li>
        }
      </ol>

      @if (allPassed()) {
        <section class="ac-cert" aria-label="Итог обучения">
          <div class="ac-cert-seal" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 12.9 17 22l-5-3-5 3 1.5-9.1"/></svg>
          </div>
          <div>
            <h2 class="ac-cert-title">Все четыре ступени сданы</h2>
            <p class="ac-cert-text">
              {{ auth.user()?.first_name || auth.user()?.username || 'Вы' }}, вы прошли путь Академии Flavor Tree.
              Это подтверждение внутри платформы, а не профессиональная сертификация.
            </p>
          </div>
        </section>
      }

      <p class="ac-source">
        Программа составлена по открытым материалам Cicerone Certification Program и руководству по стилям BJCP.
        Академия знакомит с культурой вкуса и не заменяет профессиональную сертификацию. Материалы для лиц старше 21 года.
      </p>

      @if (showTeam() && team().length) {
        <section class="ac-team">
          <h2 class="section-header mb-2xl">Команда проекта</h2>
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
    <dialog #sheet class="ac-sheet" aria-labelledby="ac-sheet-title" (cancel)="onCancel($event)" (click)="onBackdrop($event)">
      @if (mode(); as m) {
        <div class="ac-sheet-box">
          <header class="ac-sheet-head">
            <div class="ac-sheet-head-text">
              <span class="ac-sheet-kicker">
                @if (m === 'lesson') { Ступень {{ lesson()?.level ?? '' }} · урок }
                @else { Ступень {{ quizLevel() }} · тест }
              </span>
              <h2 id="ac-sheet-title" class="ac-sheet-title">
                @if (m === 'lesson') { {{ lesson()?.title ?? 'Загружаем урок...' }} }
                @else { {{ quiz()?.title ?? 'Загружаем тест...' }} }
              </h2>
            </div>
            <button type="button" class="btn-ghost ac-close" (click)="requestClose()" aria-label="Закрыть" autofocus>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </header>

          @if (m === 'quiz' && quiz() && !result()) {
            <div class="ac-bar" role="progressbar" aria-label="Прогресс теста"
                 [attr.aria-valuenow]="index() + 1" aria-valuemin="1" [attr.aria-valuemax]="quiz()!.questions.length">
              <span [style.width.%]="(index() + 1) * 100 / quiz()!.questions.length"></span>
            </div>
          }

          <div class="ac-sheet-body" #body>
            @if (actionError(); as err) {
              <p class="ac-note ac-note-bad ac-note-inline" role="alert">{{ err }}</p>
            }
            @if (sheetError(); as err) {
              <div class="ac-note ac-note-bad" role="alert">
                <p>{{ err }}</p>
                <button type="button" class="btn-outline" (click)="retrySheet()">Повторить</button>
              </div>
            } @else if (sheetLoading()) {
              <div class="ac-loading" aria-busy="true">
                <div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>
              </div>
            } @else if (m === 'lesson' && lesson()) {
              @let l = lesson()!;
              <p class="ac-lesson-meta">{{ l.minutes }} мин чтения</p>
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
                      <legend>Проверьте себя</legend>
                      <p class="ac-check-q">{{ block.question }}</p>
                      <div class="ac-options">
                        @for (opt of block.options; track $index; let oi = $index) {
                          <button type="button" class="ac-option"
                                  [class.is-right]="checks()[bi] !== undefined && oi === block.correct_index"
                                  [class.is-wrong]="checks()[bi] === oi && oi !== block.correct_index"
                                  [attr.aria-pressed]="checks()[bi] === oi"
                                  [disabled]="checks()[bi] !== undefined"
                                  (click)="answerCheck(bi, oi)">{{ opt }}</button>
                        }
                      </div>
                      @if (checks()[bi] !== undefined) {
                        <p class="ac-verdict" [class.good]="checks()[bi] === block.correct_index" role="status">
                          <b>{{ checks()[bi] === block.correct_index ? 'Верно.' : 'Не совсем.' }}</b> {{ block.explanation }}
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
            } @else if (m === 'quiz' && result()) {
              @let r = result()!;
              <div class="ac-result" [class.passed]="r.passed">
                <div class="ac-score" aria-hidden="true">
                  <b>{{ r.correct }}</b><span>из {{ r.total }}</span>
                </div>
                <div>
                  <h3 class="ac-result-title">{{ r.passed ? 'Ступень сдана!' : 'Пока не сдано' }}</h3>
                  <p class="ac-result-text">
                    {{ r.percent }}% верных ответов, нужно {{ r.pass_percent }}%.
                    @if (r.passed && r.saved) { Результат сохранён в вашем паспорте вкуса. }
                    @if (r.passed && !r.saved) { Войдите, чтобы результат сохранился и принёс баллы. }
                    @if (!r.passed) { Посмотрите разбор ниже и попробуйте ещё раз: вопросы будут другими. }
                  </p>
                </div>
              </div>
              <h3 class="ac-h3">Разбор ответов</h3>
              <ol class="ac-review">
                @for (q of quiz()!.questions; track q.id; let qi = $index) {
                  @if (resultFor(q.id); as row) {
                    <li [class.bad]="!row.is_correct">
                      <p class="ac-review-q">{{ qi + 1 }}. {{ q.text }}</p>
                      @if (!row.is_correct && row.chosen !== null) {
                        <p class="ac-review-a ac-review-wrong">Ваш ответ: {{ q.options[row.chosen] }}</p>
                      }
                      <p class="ac-review-a ac-review-right">Верно: {{ q.options[row.correct_index] }}</p>
                      @if (row.explanation) { <p class="ac-review-why">{{ row.explanation }}</p> }
                    </li>
                  }
                }
              </ol>
            } @else if (m === 'quiz' && quiz()) {
              @let q = quiz()!;
              @if (q.questions[index()]; as question) {
                <p class="ac-quiz-count">Вопрос {{ index() + 1 }} из {{ q.questions.length }}</p>
                <h3 class="ac-quiz-q" id="ac-quiz-q">{{ question.text }}</h3>
                <div class="ac-options" role="radiogroup" aria-labelledby="ac-quiz-q">
                  @for (opt of question.options; track $index; let oi = $index) {
                    <button type="button" class="ac-option" role="radio"
                            [class.chosen]="answers()[question.id] === oi"
                            [attr.aria-checked]="answers()[question.id] === oi"
                            (click)="choose(question.id, oi)">
                      <span class="ac-option-dot" aria-hidden="true"></span>
                      {{ opt }}
                    </button>
                  }
                </div>
              }
            }
          </div>

          <footer class="ac-sheet-foot">
            @if (closeAsk()) {
              <p class="ac-ask" role="alert">Тест не закончен. Закрыть его? Ответы не сохранятся.</p>
              <button type="button" class="btn-outline" (click)="closeSheet()">Закрыть тест</button>
              <button type="button" class="btn-amber" (click)="closeAsk.set(false)">Продолжить тест</button>
            } @else if (m === 'lesson' && lesson()) {
              @let l = lesson()!;
              @if (justDone(); as done) {
                <p class="ac-done-note" role="status">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  Урок прочитан{{ done.awarded ? ': +' + done.awarded + ' баллов' : '' }}
                </p>
                @if (l.next; as next) {
                  <button type="button" class="btn-amber" (click)="openLesson(next.slug)">
                    {{ next.level === l.level ? 'Следующий урок' : 'К ступени ' + next.level }}
                  </button>
                } @else {
                  <button type="button" class="btn-amber" (click)="closeSheet()">К пути</button>
                }
                @if (l.next?.level !== l.level) {
                  <button type="button" class="btn-outline" (click)="openQuiz(l.level)">Пройти тест ступени</button>
                }
              } @else {
                <button type="button" class="btn-outline" (click)="closeSheet()">К пути</button>
                <button type="button" class="btn-amber" [disabled]="completing()" (click)="completeLesson(l)">
                  {{ completing() ? 'Сохраняем...' : (isDoneSlug(l.slug) ? 'Прочитано, дальше' : 'Урок прочитан') }}
                </button>
              }
            } @else if (m === 'quiz' && result()) {
              @let r = result()!;
              <button type="button" class="btn-outline" (click)="openQuiz(r.level)">Пройти ещё раз</button>
              @if (r.passed && r.level < 4) {
                <button type="button" class="btn-amber" (click)="toLevel(r.level + 1)">К ступени {{ r.level + 1 }}</button>
              } @else {
                <button type="button" class="btn-amber" (click)="closeSheet()">К пути</button>
              }
            } @else if (m === 'quiz' && quiz()) {
              @let q = quiz()!;
              <button type="button" class="btn-outline" [disabled]="index() === 0 || submitting()" (click)="step(-1)">Назад</button>
              @if (index() < q.questions.length - 1) {
                <button type="button" class="btn-amber" [disabled]="!answered()" (click)="step(1)">Дальше</button>
              } @else {
                <button type="button" class="btn-amber" [disabled]="!allAnswered() || submitting()" (click)="submit()">
                  {{ submitting() ? 'Проверяем...' : 'Проверить ответы' }}
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
      grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
      gap: var(--space-3xl);
      align-items: center;
      margin-bottom: var(--space-4xl);
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
    .ac-lede { max-width: 56ch; font-size: 1.0625rem; line-height: 1.65; color: var(--foam-dim); margin: 0 0 var(--space-xl); }
    .ac-facts { list-style: none; display: flex; flex-wrap: wrap; gap: var(--space-sm) var(--space-md); margin: 0; padding: 0; }
    .ac-facts li {
      padding: 8px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      background: var(--bg-1);
      font-size: 0.875rem;
      color: var(--foam-dim);
    }
    .ac-facts b { color: var(--beer-deep); font-weight: 800; }

    .ac-progress {
      display: flex;
      align-items: center;
      gap: var(--space-xl);
      padding: var(--space-2xl);
      border: 1px solid var(--line);
      border-radius: var(--radius-2xl);
      background: linear-gradient(160deg, #fff 0%, #FFF7EA 100%);
      box-shadow: var(--shadow-md);
    }
    .ac-ring { position: relative; flex-shrink: 0; width: 112px; height: 112px; }
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
    .ac-ring-text b { font-family: var(--font-heading); font-size: 1.6rem; color: var(--foam); }
    .ac-ring-text span { font-size: 0.75rem; color: var(--muted); }
    .ac-progress-body { min-width: 0; display: grid; gap: var(--space-md); justify-items: start; }
    .ac-progress-line { margin: 0; color: var(--foam-dim); }
    .ac-progress-line b { color: var(--foam); }
    .ac-guest, .ac-all-done { margin: 0; font-size: 0.875rem; line-height: 1.5; color: var(--muted); }
    .ac-all-done { color: #166534; font-weight: 600; }
    .ac-points {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      background: var(--bg-1);
      color: var(--beer-deep);
      font: inherit;
      font-size: 0.875rem;
      font-weight: 700;
      cursor: pointer;
    }
    .ac-points:hover { border-color: var(--beer-light); background: var(--beer-glow); }
    .ac-continue { text-align: left; white-space: normal; line-height: 1.3; }

    .ac-error { display: grid; gap: var(--space-md); justify-items: center; padding: var(--space-3xl); text-align: center; }

    /* Путь: четыре ступени, в каждой шаги */
    .ac-path {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2xl);
      margin: 0 0 var(--space-4xl);
      padding: 0;
    }
    .ac-level {
      padding: var(--space-2xl);
      border: 1px solid var(--line);
      border-radius: var(--radius-2xl);
      background: var(--bg-1);
      box-shadow: var(--shadow-sm);
    }
    .ac-level-done { border-color: rgba(22, 163, 74, 0.35); }
    .ac-level-head { display: flex; align-items: flex-start; gap: var(--space-md); margin-bottom: var(--space-lg); }
    .ac-level-num {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      display: grid;
      place-content: center;
      border-radius: 14px;
      background: var(--grad-cta);
      color: #fff;
      font-family: var(--font-heading);
      font-size: 1.25rem;
      font-weight: 800;
      box-shadow: var(--shadow-cta);
    }
    .ac-level-done .ac-level-num { background: linear-gradient(135deg, #16a34a, #166534); box-shadow: 0 8px 20px -8px rgba(22, 101, 52, 0.6); }
    .ac-level-text { flex: 1; min-width: 0; }
    .ac-level-title { margin: 0 0 4px; font-family: var(--font-heading); font-size: 1.2rem; font-weight: 800; color: var(--foam); }
    .ac-level-desc { margin: 0; font-size: 0.875rem; line-height: 1.5; color: var(--muted); }
    .ac-level-state { flex-shrink: 0; }
    .ac-level-count { font-size: 0.8125rem; font-weight: 700; color: var(--muted); white-space: nowrap; padding-top: 4px; }

    .ac-steps { list-style: none; display: grid; gap: var(--space-sm); margin: 0; padding: 0; }
    .ac-step {
      width: 100%;
      display: flex;
      align-items: center;
      gap: var(--space-md);
      min-height: 64px;
      padding: 10px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--bg-0);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease, transform var(--duration-fast) ease;
    }
    .ac-step:hover:not(:disabled) { border-color: var(--beer-light); background: #FFF9EF; }
    .ac-step:active:not(:disabled) { transform: scale(0.99); }
    .ac-step:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .ac-step:disabled { opacity: 0.55; cursor: default; }
    .ac-step-mark {
      flex-shrink: 0;
      width: 34px;
      height: 34px;
      display: grid;
      place-content: center;
      border-radius: 50%;
      border: 2px solid rgba(180, 83, 9, 0.3);
      color: var(--beer-deep);
      font-weight: 800;
      font-size: 0.875rem;
      background: #fff;
    }
    .ac-step-mark svg { width: 16px; height: 16px; }
    .ac-step.done .ac-step-mark { border-color: #16a34a; background: #16a34a; color: #fff; }
    .ac-step-quiz { background: linear-gradient(135deg, #FFF7EA, #fff); }
    .ac-step-quiz .ac-step-mark { border-style: dashed; }
    .ac-step-quiz.done .ac-step-mark { border-style: solid; }
    .ac-step-body { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .ac-step-title { font-weight: 700; color: var(--foam); line-height: 1.3; }
    .ac-step-sub { font-size: 0.8125rem; line-height: 1.4; color: var(--muted); }
    .ac-step-meta { flex-shrink: 0; font-size: 0.8125rem; font-weight: 700; color: var(--beer-mid); white-space: nowrap; }
    .ac-step.done .ac-step-meta { color: #166534; }

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
      height: min(860px, calc(100dvh - 48px));
      max-height: none;
      margin: auto;
      padding: 0;
      border: none;
      border-radius: var(--radius-2xl);
      background: var(--bg-1);
      color: var(--foam);
      box-shadow: 0 30px 80px -20px rgba(28, 25, 23, 0.45);
      overflow: hidden;
    }
    .ac-sheet:focus { outline: none; }
    .ac-sheet::backdrop { background: rgba(28, 25, 23, 0.55); backdrop-filter: blur(4px); }
    .ac-sheet[open] { animation: acIn 260ms var(--ease-out); }
    @keyframes acIn { from { opacity: 0; transform: translateY(16px) scale(0.985); } to { opacity: 1; transform: none; } }
    .ac-sheet-box { display: flex; flex-direction: column; height: 100%; }
    .ac-sheet-head {
      display: flex;
      align-items: flex-start;
      gap: var(--space-md);
      padding: var(--space-xl) var(--space-2xl) var(--space-lg);
      border-bottom: 1px solid var(--line);
    }
    .ac-sheet-head-text { flex: 1; min-width: 0; }
    .ac-sheet-kicker { display: block; margin-bottom: 4px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--beer-mid); }
    .ac-sheet-title { margin: 0; font-family: var(--font-heading); font-size: clamp(1.25rem, 3.4vw, 1.6rem); font-weight: 800; line-height: 1.2; }
    .ac-close { flex-shrink: 0; width: 44px; height: 44px; display: grid; place-content: center; border-radius: 50%; }
    .ac-bar { height: 6px; background: rgba(180, 83, 9, 0.12); }
    .ac-bar span { display: block; height: 100%; background: var(--grad-cta); border-radius: 0 6px 6px 0; transition: width 300ms var(--ease-out); }
    .ac-sheet-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-xl) var(--space-2xl) var(--space-2xl); }
    .ac-sheet-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--space-md);
      padding: var(--space-lg) var(--space-2xl);
      padding-bottom: max(var(--space-lg), env(safe-area-inset-bottom));
      border-top: 1px solid var(--line);
      background: var(--bg-0);
    }
    .ac-sheet-foot:empty { display: none; }
    .ac-sheet-foot .btn-amber, .ac-sheet-foot .btn-outline { min-height: 44px; }
    .ac-done-note { display: inline-flex; align-items: center; gap: 6px; margin: 0 auto 0 0; font-weight: 700; color: #166534; }
    .ac-loading { display: grid; gap: var(--space-md); }
    .ac-loading .skeleton-line:nth-child(1) { width: 70%; height: 18px; }
    .ac-loading .skeleton-line:nth-child(3) { width: 85%; }

    /* Текст урока */
    .ac-lesson-meta { margin: 0 0 var(--space-md); font-size: 0.8125rem; font-weight: 700; color: var(--muted); }
    .ac-p { max-width: 68ch; margin: 0 0 var(--space-xl); font-size: 1.0625rem; line-height: 1.7; color: var(--foam-dim); }
    .ac-h3 { margin: var(--space-xl) 0 var(--space-md); font-family: var(--font-heading); font-size: 1.1rem; font-weight: 800; color: var(--foam); }
    .ac-facts-list { max-width: 68ch; margin: 0 0 var(--space-xl); padding: 0; list-style: none; display: grid; gap: 10px; }
    .ac-facts-list li { position: relative; padding-left: 22px; line-height: 1.6; color: var(--foam-dim); }
    .ac-facts-list li::before { content: ''; position: absolute; left: 4px; top: 0.62em; width: 8px; height: 8px; border-radius: 50%; background: var(--beer-light); }
    .ac-numbered { max-width: 68ch; margin: 0 0 var(--space-xl); padding: 0; list-style: none; display: grid; gap: var(--space-md); }
    .ac-numbered li { display: flex; gap: var(--space-md); padding: var(--space-md) var(--space-lg); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--bg-0); }
    .ac-numbered-n { flex-shrink: 0; width: 28px; height: 28px; display: grid; place-content: center; border-radius: 50%; background: var(--beer-glow); color: var(--beer-deep); font-weight: 800; font-size: 0.875rem; }
    .ac-numbered b { color: var(--foam); }
    .ac-numbered p { margin: 2px 0 0; line-height: 1.55; color: var(--foam-dim); }
    .ac-tip { display: flex; gap: var(--space-md); max-width: 68ch; margin: 0 0 var(--space-xl); padding: var(--space-lg); border-radius: var(--radius-lg); background: #FFF7EA; border: 1px solid rgba(217, 119, 6, 0.3); color: var(--beer-deep); }
    .ac-tip svg { flex-shrink: 0; margin-top: 2px; }
    .ac-tip p { margin: 0; line-height: 1.6; font-weight: 500; }
    .ac-check { max-width: 68ch; margin: 0 0 var(--space-xl); padding: var(--space-lg); border: 1px dashed rgba(180, 83, 9, 0.4); border-radius: var(--radius-lg); }
    .ac-check legend { padding: 0 8px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--beer-mid); }
    .ac-check-q { margin: 0 0 var(--space-md); font-weight: 700; line-height: 1.45; }
    .ac-practice { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md); max-width: 68ch; padding: var(--space-lg); border-radius: var(--radius-lg); background: var(--bg-0); border: 1px solid var(--line); }
    .ac-practice p { flex: 1 1 240px; margin: 0; line-height: 1.55; color: var(--foam-dim); }

    /* Варианты ответа: общие для самопроверки и теста */
    .ac-options { display: grid; gap: var(--space-sm); }
    .ac-option {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      width: 100%;
      min-height: 52px;
      padding: 12px 16px;
      border: 1.5px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--bg-1);
      color: var(--foam);
      font: inherit;
      line-height: 1.4;
      text-align: left;
      cursor: pointer;
      transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease;
    }
    .ac-option:hover:not(:disabled) { border-color: var(--beer-light); background: #FFF9EF; }
    .ac-option:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .ac-option:disabled { cursor: default; color: var(--foam-dim); }
    .ac-option.chosen { border-color: var(--beer-mid); background: #FFF4DF; font-weight: 600; }
    .ac-option-dot { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(180, 83, 9, 0.4); background: #fff; }
    .ac-option.chosen .ac-option-dot { border: 6px solid var(--beer-mid); }
    .ac-option.is-right { border-color: #16a34a; background: #F0FDF4; color: #14532d; font-weight: 600; }
    .ac-option.is-wrong { border-color: #dc2626; background: #FEF2F2; color: #7f1d1d; }
    .ac-verdict { margin: var(--space-md) 0 0; line-height: 1.55; color: #7f1d1d; }
    .ac-verdict.good { color: #14532d; }

    .ac-quiz-count { margin: 0 0 var(--space-sm); font-size: 0.8125rem; font-weight: 700; color: var(--muted); }
    .ac-quiz-q { margin: 0 0 var(--space-xl); font-family: var(--font-heading); font-size: clamp(1.15rem, 3vw, 1.4rem); line-height: 1.3; }

    .ac-note { display: grid; gap: var(--space-md); justify-items: start; padding: var(--space-lg); border-radius: var(--radius-lg); }
    .ac-note-bad { background: #FEF2F2; border: 1px solid rgba(220, 38, 38, 0.3); color: #7f1d1d; }
    .ac-note p { margin: 0; }
    .ac-note-inline { margin: 0 0 var(--space-lg); }
    .ac-ask { flex: 1 1 100%; margin: 0; font-weight: 600; color: var(--foam); }

    .ac-result { display: flex; align-items: center; gap: var(--space-xl); padding: var(--space-xl); border-radius: var(--radius-xl); background: #FEF2F2; border: 1px solid rgba(220, 38, 38, 0.25); }
    .ac-result.passed { background: #F0FDF4; border-color: rgba(22, 163, 74, 0.35); }
    .ac-score { flex-shrink: 0; width: 84px; height: 84px; display: grid; place-content: center; text-align: center; border-radius: 50%; background: #fff; border: 3px solid #dc2626; line-height: 1.1; }
    .ac-result.passed .ac-score { border-color: #16a34a; }
    .ac-score b { font-family: var(--font-heading); font-size: 1.7rem; }
    .ac-score span { font-size: 0.75rem; color: var(--muted); }
    .ac-result-title { margin: 0 0 4px; font-family: var(--font-heading); font-size: 1.3rem; }
    .ac-result-text { margin: 0; line-height: 1.55; color: var(--foam-dim); }
    .ac-review { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-md); }
    .ac-review li { padding: var(--space-md) var(--space-lg); border-radius: var(--radius-lg); border: 1px solid rgba(22, 163, 74, 0.3); background: #F7FEF9; }
    .ac-review li.bad { border-color: rgba(220, 38, 38, 0.3); background: #FFF8F8; }
    .ac-review p { margin: 0; line-height: 1.5; }
    .ac-review-q { font-weight: 700; margin-bottom: 6px !important; }
    .ac-review-a { font-size: 0.9375rem; }
    .ac-review-wrong { color: #991b1b; }
    .ac-review-right { color: #166534; font-weight: 600; }
    .ac-review-why { margin-top: 6px !important; font-size: 0.875rem; color: var(--muted); }

    @media (max-width: 960px) {
      .ac-hero { grid-template-columns: 1fr; gap: var(--space-2xl); }
      .ac-path { grid-template-columns: 1fr; }
    }

    @media (max-width: 600px) {
      .ac-hero { margin-bottom: var(--space-2xl); }
      .ac-progress { padding: var(--space-lg); gap: var(--space-lg); }
      .ac-ring { width: 88px; height: 88px; }
      .ac-ring-text b { font-size: 1.3rem; }
      .ac-level { padding: var(--space-lg); }
      .ac-level-title { font-size: 1.05rem; }
      .ac-step { padding: 10px 12px; }
      .ac-step-meta { display: none; }
      .ac-cert { flex-direction: column; align-items: flex-start; }
      /* Телефон: лист на весь экран, кнопки внизу на всю ширину */
      .ac-sheet { width: 100vw; height: 100dvh; border-radius: 0; }
      .ac-sheet-head { padding: var(--space-lg) var(--space-lg) var(--space-md); }
      .ac-sheet-body { padding: var(--space-lg); }
      .ac-sheet-foot { padding: var(--space-md) var(--space-lg); padding-bottom: max(var(--space-md), env(safe-area-inset-bottom)); }
      .ac-sheet-foot .btn-amber, .ac-sheet-foot .btn-outline { flex: 1 1 140px; justify-content: center; }
      .ac-done-note { flex-basis: 100%; }
      .ac-result { flex-direction: column; align-items: flex-start; }
    }

    @media (prefers-reduced-motion: reduce) {
      .ac-sheet[open] { animation: none; }
      .ac-ring-fill, .ac-bar span { transition: none; }
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

  readonly mode = signal<SheetMode | null>(null);
  readonly sheetLoading = signal(false);
  readonly sheetError = signal('');
  readonly lesson = signal<Lesson | null>(null);
  /** Ответы на вопросы самопроверки: номер блока -> выбранный вариант. */
  readonly checks = signal<Record<number, number>>({});
  readonly completing = signal(false);
  readonly justDone = signal<{ awarded: number } | null>(null);

  readonly quizLevel = signal(1);
  readonly quiz = signal<Quiz | null>(null);
  readonly index = signal(0);
  readonly answers = signal<Record<string, number>>({});
  readonly result = signal<QuizResult | null>(null);
  readonly submitting = signal(false);
  /** Гость закрывает незаконченный тест: в подвале листа вопрос «закрыть или продолжить». */
  readonly closeAsk = signal(false);
  /** Ошибка действия (сохранить урок, проверить тест): показывается над содержимым, не вместо него. */
  readonly actionError = signal('');

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
      if (lv.quiz_size) list.push({ kind: 'quiz', level: lv.level, title: 'Тест', done: this.levelPassed(lv) });
    }
    return list;
  });
  readonly totalSteps = computed(() => this.steps().length);
  readonly doneSteps = computed(() => this.steps().filter(s => s.done).length);
  readonly percent = computed(() => this.totalSteps() ? Math.round(this.doneSteps() * 100 / this.totalSteps()) : 0);
  readonly ringOffset = computed(() => this.ringLength * (1 - this.percent() / 100));
  readonly nextStep = computed(() => this.steps().find(s => !s.done) ?? null);
  readonly allPassed = computed(() => this.levels().length > 0 && this.levels().every(lv => this.levelPassed(lv)));

  readonly answered = computed(() => {
    const q = this.quiz()?.questions[this.index()];
    return !!q && this.answers()[q.id] !== undefined;
  });
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

  levelPassed(lv: AcademyLevel): boolean {
    return lv.passed || this.localLevels().includes(lv.level);
  }

  levelDone(lv: AcademyLevel): number {
    return lv.lessons.filter(l => this.lessonDone(l)).length + (this.levelPassed(lv) ? 1 : 0);
  }

  private setLocalLessons(list: string[]) {
    this.localLessons.set(list);
    writeList(LOCAL_LESSONS, list);
  }

  private setLocalLevels(list: number[]) {
    this.localLevels.set(list);
    writeList(LOCAL_LEVELS, list);
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
    this.justDone.set(null);
    this.sheetError.set('');
    this.sheetLoading.set(true);
    this.showSheet();
    this.api.getLesson(slug).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: lesson => {
        if (this.selection.lessonSlug() !== slug) return;
        this.lesson.set(lesson);
        this.sheetLoading.set(false);
        this.scrollBodyTop();
      },
      error: err => {
        if (this.selection.lessonSlug() !== slug) return;
        this.sheetLoading.set(false);
        this.sheetError.set(err?.status === 404 ? 'Такого урока нет. Возможно, его убрали.' : 'Не удалось загрузить урок. Проверьте соединение.');
      },
    });
  }

  openQuiz(level: number) {
    this.lastSheet = { mode: 'quiz', level };
    // Тест не привязан к адресу: если был открыт урок, убираем его из адреса без закрытия диалога
    this.mode.set('quiz');
    if (this.selection.lessonSlug()) this.selection.lessonSlug.set(null);
    this.quizLevel.set(level);
    this.quiz.set(null);
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
        if (!quiz.questions.length) this.sheetError.set('В этой ступени пока нет вопросов.');
      },
      error: () => {
        this.sheetLoading.set(false);
        this.sheetError.set('Не удалось загрузить тест. Проверьте соединение.');
      },
    });
  }

  retrySheet() {
    const last = this.lastSheet;
    if (!last) return;
    if (last.mode === 'lesson' && last.slug) this.showLesson(last.slug);
    else if (last.level) this.openQuiz(last.level);
  }

  toLevel(level: number) {
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
    const dialog = this.sheetEl()?.nativeElement;
    if (dialog?.open) dialog.close();
  }

  private scrollBodyTop() {
    queueMicrotask(() => this.bodyEl()?.nativeElement.scrollTo({ top: 0 }));
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

  completeLesson(lesson: Lesson) {
    if (this.completing()) return;
    this.actionError.set('');
    if (!this.auth.isLoggedIn()) {
      if (!this.localLessons().includes(lesson.slug)) this.setLocalLessons([...this.localLessons(), lesson.slug]);
      this.justDone.set({ awarded: 0 });
      return;
    }
    this.completing.set(true);
    this.api.completeLesson(lesson.slug).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.completing.set(false);
        this.justDone.set({ awarded: res.awarded });
        this.academy.update(a => a ? {
          ...a,
          levels: a.levels.map(lv => ({ ...lv, lessons: lv.lessons.map(l => l.slug === lesson.slug ? { ...l, done: true } : l) })),
          progress: { ...a.progress, points: res.points },
        } : a);
      },
      error: () => {
        this.completing.set(false);
        this.actionError.set('Не удалось сохранить прогресс. Проверьте соединение и попробуйте ещё раз.');
      },
    });
  }

  /** Кнопка «попробуйте на практике» ведёт в раздел сайта. */
  practice(action: LessonAction) {
    const tab: ActiveTab = action === 'explorer' ? 'explorer' : action === 'pairing' ? 'pairing' : action === 'menu' ? 'menu' : 'landing';
    this.hideSheet();
    this.selection.lessonSlug.set(null);
    this.navigate.emit(tab);
  }

  // Тест

  choose(questionId: string, option: number) {
    if (this.result() || this.submitting()) return;
    this.answers.update(a => ({ ...a, [questionId]: option }));
  }

  step(delta: number) {
    const q = this.quiz();
    if (!q) return;
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
        this.actionError.set('Не удалось проверить ответы. Попробуйте ещё раз.');
      },
    });
  }
}
