import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { QuizQuestion } from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { confirmTwice, flash, isErrorText } from './panel-shared';

/** Ступени Школы, как у курсов на бэкенде. */
const LEVEL_CHOICES: SelectOption[] = [
  { value: '1', label: '1. Beginner' },
  { value: '2', label: '2. Explorer' },
  { value: '3', label: '3. Connoisseur' },
  { value: '4', label: '4. Sommelier' }
];

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

interface QuizForm {
  /** id вопроса или 'new': по нему @for понимает, что открыли другую карточку. */
  key: string;
  id: string | null;
  level: string;
  text: string;
  /** Варианты лежат объектами: так ngModel не теряет фокус при наборе. */
  options: { text: string }[];
  correct_index: number;
  explanation: string;
  sort_order: number;
  is_active: boolean;
}

type LevelFilter = 'all' | '1' | '2' | '3' | '4';

/** Вкладка "Тесты": вопросы Школы сомелье по ступеням, список слева и форма справа. */
@Component({
  selector: 'panel-quiz',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent],
  template: `
    <div class="wa-page" [class.has-selection]="!!form()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Quizzes @if (loaded() && !loadError()) { <span class="wa-count">{{ questions().length }}</span> }</h2>
          <button type="button" class="wa-iconbtn" title="New question" aria-label="New question" (click)="openCreate()">
            <panel-icon name="plus" />
          </button>
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Question text" aria-label="Search by question text"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <div class="wa-pills">
          @for (p of pills; track p.value) {
            <!-- У кнопок ступеней видна только цифра: читалке называем её целиком -->
            <button type="button" class="wa-pill" [class.active]="filter() === p.value"
                    [attr.aria-label]="p.value === 'all' ? null : 'Level ' + p.label" (click)="filter.set(p.value)">
              {{ p.label }}
            </button>
          }
        </div>
        @if (msg() && !form()) {
          <p class="wa-msg" [class.error]="isError(msg())" [attr.role]="isError(msg()) ? 'alert' : 'status'">{{ msg() }}</p>
        }
        <div class="wa-rows">
          @if (!loaded()) {
            <p class="wa-empty">Loading...</p>
          } @else if (loadError()) {
            <div class="wa-loadbar" role="alert">
              <panel-icon name="alert" />
              <span>{{ loadError() }}</span>
              <button type="button" class="btn-outline" (click)="load()"><panel-icon name="refresh" /> Refresh</button>
            </div>
          } @else {
            @for (q of filtered(); track q.id) {
              <button type="button" class="wa-row" [class.active]="form()?.id === q.id" (click)="openEdit(q)">
                <span class="wa-avatar">{{ q.level }}</span>
                <span class="wa-row-body">
                  <span class="wa-row-title">{{ q.text }}</span>
                  <span class="wa-row-sub">Correct: {{ q.options[q.correct_index] }}</span>
                </span>
                <span class="wa-row-meta">
                  @if (!q.is_active) { <span class="wa-chip wa-chip-warn">Hidden</span> }
                </span>
              </button>
            } @empty {
              <p class="wa-empty">{{ questions().length ? 'Nothing found' : 'No questions yet' }}</p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (f of formList(); track f.key) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="close()"><panel-icon name="arrowLeft" /> Back to list</button>

            <div class="wa-card">
              <div class="wa-card-head">
                <span class="wa-avatar wa-avatar-lg">{{ f.level }}</span>
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">{{ f.id ? 'Quiz question' : 'New question' }}</h3>
                  <p class="wa-card-sub">Guests see the question and the options, and after answering, the correct option and an explanation</p>
                </div>
              </div>
              <div class="wa-fields">
                <div class="wa-field">
                  <span class="wa-label">Level</span>
                  <ft-select [options]="levelOptions" ariaLabel="Level" [(ngModel)]="f.level" />
                </div>
                <label class="wa-field">
                  <span class="wa-label">Order in quiz</span>
                  <input class="input" type="number" [(ngModel)]="f.sort_order" />
                </label>
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">Question</span>
                  <textarea class="input" rows="2" [(ngModel)]="f.text" placeholder="Where does bitterness in beer come from?"></textarea>
                </label>

                <div class="wa-field wa-field-wide">
                  <span class="wa-label">Answer options (mark the correct one)</span>
                  @for (opt of f.options; track $index; let i = $index) {
                    <div class="quiz-opt">
                      <input type="radio" [name]="'correct-' + f.key" [checked]="f.correct_index === i"
                             [attr.aria-label]="'Correct answer: option ' + (i + 1)" (change)="f.correct_index = i" />
                      <input class="input" type="text" [(ngModel)]="opt.text" [placeholder]="'Option ' + (i + 1)"
                             [attr.aria-label]="'Option ' + (i + 1)" />
                      <button type="button" class="wa-iconbtn" title="Remove option" [attr.aria-label]="'Remove option ' + (i + 1)"
                              [disabled]="f.options.length <= minOptions" (click)="removeOption(f, i)">
                        <panel-icon name="close" />
                      </button>
                    </div>
                  }
                  @if (f.options.length < maxOptions) {
                    <button type="button" class="btn-outline quiz-add" (click)="f.options.push({ text: '' })">
                      <panel-icon name="plus" /> Add option
                    </button>
                  }
                </div>

                <label class="wa-field wa-field-wide">
                  <span class="wa-label">Explanation after answering</span>
                  <textarea class="input" rows="2" [(ngModel)]="f.explanation"
                            placeholder="Why this answer is correct, in a sentence or two"></textarea>
                </label>
                <label class="wa-check wa-field-wide">
                  <input type="checkbox" [(ngModel)]="f.is_active" /> Show in quiz
                </label>
              </div>
              @if (formError()) {
                <p class="wa-error" role="alert">{{ formError() }}</p>
              }
              <div class="wa-actions">
                <button type="button" class="btn-amber" [disabled]="saving()" (click)="save()">
                  <panel-icon name="save" /> {{ saving() ? 'Saving...' : (f.id ? 'Save' : 'Create question') }}
                </button>
                @if (f.id) {
                  <button type="button" class="btn-outline panel-danger" (click)="askDelete(f.id)">
                    <panel-icon name="trash" /> {{ pendingDelete() === f.id ? 'Delete for sure?' : 'Delete' }}
                  </button>
                } @else {
                  <button type="button" class="btn-outline" (click)="close()">Cancel</button>
                }
                @if (msg()) {
                  <p class="wa-msg" [class.error]="isError(msg())" [attr.role]="isError(msg()) ? 'alert' : 'status'">{{ msg() }}</p>
                }
              </div>
            </div>
          </div>
        } @empty {
          <div class="wa-detail-empty">Select a question on the left or create a new one</div>
        }
      </section>
    </div>
  `,
  styles: [`
    .quiz-opt {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
    }
    .quiz-opt input[type=radio] {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      accent-color: var(--beer-mid);
    }
    .quiz-opt .input { flex: 1; min-width: 0; }
    .quiz-add { margin-top: 10px; align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; }
  `]
})
export class PanelQuizComponent implements OnInit {
  private api = inject(ApiService);

  readonly levelOptions = LEVEL_CHOICES;
  readonly minOptions = MIN_OPTIONS;
  readonly maxOptions = MAX_OPTIONS;
  readonly pills: { value: LevelFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' }
  ];
  isError = isErrorText;

  questions = signal<QuizQuestion[]>([]);
  loaded = signal(false);
  /** Вопросы не прочитались: текст с кнопкой "Обновить" держится до удачной попытки, вместо "Вопросов пока нет". */
  loadError = signal<string | null>(null);
  search = signal('');
  filter = signal<LevelFilter>('all');
  form = signal<QuizForm | null>(null);
  formError = signal<string | null>(null);
  saving = signal(false);
  msg = signal<string | null>(null);
  pendingDelete = signal<string | null>(null);

  formList = computed(() => {
    const f = this.form();
    return f ? [f] : [];
  });

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const f = this.filter();
    return this.questions().filter(x =>
      (f === 'all' || String(x.level) === f) && (!q || x.text.toLowerCase().includes(q))
    );
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.loaded.set(false);
    this.loadError.set(null);
    this.api.getQuizQuestions().subscribe({
      next: list => { this.questions.set(sortQuestions(list)); this.loaded.set(true); },
      error: err => {
        this.loaded.set(true);
        this.loadError.set('Couldn\'t load questions: ' + AuthService.errorText(err));
      }
    });
  }

  openCreate() {
    this.resetState();
    const level = this.filter() === 'all' ? '1' : this.filter();
    const sameLevel = this.questions().filter(q => String(q.level) === level);
    this.form.set({
      key: 'new', id: null, level, text: '', options: [{ text: '' }, { text: '' }, { text: '' }],
      correct_index: 0, explanation: '', is_active: true,
      sort_order: sameLevel.length ? Math.max(...sameLevel.map(q => q.sort_order)) + 1 : 0
    });
  }

  openEdit(q: QuizQuestion) {
    this.resetState();
    this.form.set({
      key: q.id, id: q.id, level: String(q.level), text: q.text,
      options: q.options.map(text => ({ text })), correct_index: q.correct_index,
      explanation: q.explanation, sort_order: q.sort_order, is_active: q.is_active
    });
  }

  close() {
    this.resetState();
    this.form.set(null);
  }

  removeOption(f: QuizForm, i: number) {
    if (f.options.length <= MIN_OPTIONS) return;
    f.options.splice(i, 1);
    // Верный ответ сдвигается вместе со списком
    if (f.correct_index === i) f.correct_index = 0;
    else if (f.correct_index > i) f.correct_index -= 1;
  }

  save() {
    const f = this.form();
    if (!f) return;
    const text = f.text.trim();
    const options = f.options.map(o => o.text.trim());
    if (!text) {
      this.formError.set('Please enter a question');
      return;
    }
    if (options.some(o => !o)) {
      this.formError.set('Fill in all answer options or remove the empty ones');
      return;
    }
    const payload: Partial<QuizQuestion> = {
      level: Number(f.level), text, options, correct_index: f.correct_index,
      explanation: f.explanation.trim(), sort_order: Number(f.sort_order) || 0, is_active: f.is_active
    };
    this.saving.set(true);
    this.formError.set(null);
    const req = f.id ? this.api.updateQuizQuestion(f.id, payload) : this.api.createQuizQuestion(payload);
    req.subscribe({
      next: saved => {
        this.saving.set(false);
        const rest = this.questions().filter(q => q.id !== saved.id);
        this.questions.set(sortQuestions([...rest, saved]));
        // Пока шёл запрос, могли открыть другой вопрос: его форму и сообщения не трогаем
        if (this.form() !== f) return;
        this.openEdit(saved);
        flash(this.msg, f.id ? 'Saved' : 'Question created');
      },
      error: err => {
        this.saving.set(false);
        const reason = AuthService.errorText(err);
        if (this.form() === f) this.formError.set('Error: ' + reason);
        // Ошибка чужой формы называет вопрос, чтобы её не приняли за ошибку открытой
        else flash(this.msg, `Error: the question "${shorten(text)}" wasn't saved. ${reason}`, 6000);
      }
    });
  }

  askDelete(id: string) {
    confirmTwice(this.pendingDelete, id, () => {
      this.api.deleteQuizQuestion(id).subscribe({
        next: () => {
          this.questions.set(this.questions().filter(q => q.id !== id));
          // Форму закрываем, только если в ней всё ещё удалённый вопрос
          if (this.form()?.id !== id) return;
          this.close();
          flash(this.msg, 'Question deleted');
        },
        error: err => flash(this.msg, 'Error: the question wasn\'t deleted. ' + AuthService.errorText(err), 6000)
      });
    });
  }

  private resetState() {
    this.formError.set(null);
    this.msg.set(null);
    this.pendingDelete.set(null);
  }
}

function sortQuestions(list: QuizQuestion[]): QuizQuestion[] {
  return [...list].sort((a, b) => a.level - b.level || a.sort_order - b.sort_order);
}

/** Начало длинного текста для сообщения об ошибке. */
function shorten(text: string, max = 40): string {
  return text.length > max ? text.slice(0, max).trimEnd() + '...' : text;
}
