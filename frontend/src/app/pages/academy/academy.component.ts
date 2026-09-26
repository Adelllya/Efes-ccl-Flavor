import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { Brand, Course, PAIRING_LABELS, PyramidNoteItem } from '../../models/flavor-tree.models';

interface QuizQuestion {
  id: string;
  text: string;
  options: { id: string; label: string }[];
  correct: string;
  /** Пояснение после верного ответа. */
  right: string;
  /** Подсказка после неверного. */
  wrong: string;
}

/** Команда из README: имена и роли, без регалий, которых нет. */
const TEAM = [
  { name: 'Аджибаева Аделия', role: 'Сооснователь' },
  { name: 'Абуталифулы Ералы', role: 'Сооснователь' },
];

/** Слои пирамиды: те же названия и секунды, что на странице сорта. */
const LAYERS: { key: 'top' | 'heart' | 'base'; name: string; time: string; text: string }[] = [
  { key: 'top', name: 'Верхние ноты', time: '0-3 сек', text: 'Аромат и первое впечатление: свежесть, хмель, цветы, фрукты.' },
  { key: 'heart', name: 'Ноты сердца', time: '3-15 сек', text: 'Тело глотка: солод, зерно, карамель, сладость.' },
  { key: 'base', name: 'Базовые ноты', time: '15+ сек', text: 'Послевкусие: горечь, сухость или мягкий сладковатый финиш.' },
];

/** Сорт, на котором показываем пример пирамиды. Если его нет, берём первый сорт с пирамидой. */
const EXAMPLE_BRAND = 'Efes Pilsener';

/** Вопросы только по модели Flavor Tree, парам из её подбора (fixtures/food_pairings.csv) и каталогу сортов. */
const QUIZ: QuizQuestion[] = [
  {
    id: 'kazy',
    text: 'В подборе Flavor Tree к жирному казы стоит Efes Pilsener. Какой это тип сочетания?',
    options: [
      { id: 'complement', label: PAIRING_LABELS.COMPLEMENT },
      { id: 'contrast', label: PAIRING_LABELS.CONTRAST },
      { id: 'bridge', label: PAIRING_LABELS.BRIDGE },
    ],
    correct: 'contrast',
    right: `Верно. Это «${PAIRING_LABELS.CONTRAST}»: горечь хмеля и газ освежают рот после жирной конской колбасы.`,
    wrong: `Не совсем. Здесь «${PAIRING_LABELS.CONTRAST}»: горечь хмеля и пузырьки освежают рот после жирной колбасы.`,
  },
  {
    id: 'top',
    text: 'Сколько длятся верхние ноты во вкусовой пирамиде Flavor Tree?',
    options: [
      { id: '0-3', label: 'Первые 0-3 секунды' },
      { id: '3-15', label: 'С 3 по 15 секунду' },
      { id: '15+', label: 'После 15 секунд' },
    ],
    correct: '0-3',
    right: 'Верно. Верхние ноты это аромат и первое впечатление от глотка.',
    wrong: 'Нет. Первые 0-3 секунды это верхние ноты, с 3 по 15 секунду сердце, дальше послевкусие.',
  },
  {
    id: 'cleanse',
    text: `Что делает пара типа «${PAIRING_LABELS.CLEANSE}»?`,
    options: [
      { id: 'fresh', label: 'Освежает рот между кусочками блюда' },
      { id: 'sweet', label: 'Добавляет блюду сладости' },
      { id: 'spicy', label: 'Делает вкус блюда острее' },
    ],
    correct: 'fresh',
    right: 'Верно. Напиток освежает рот, и следующий кусочек снова ощущается ярко.',
    wrong: `Нет. «${PAIRING_LABELS.CLEANSE}» значит, что напиток освежает рот между кусочками.`,
  },
  {
    id: 'beshbarmak',
    text: 'В подборе Flavor Tree к бешбармаку стоит Velkopopovický Kozel. Какой это тип сочетания?',
    options: [
      { id: 'complement', label: PAIRING_LABELS.COMPLEMENT },
      { id: 'contrast', label: PAIRING_LABELS.CONTRAST },
      { id: 'cleanse', label: PAIRING_LABELS.CLEANSE },
    ],
    correct: 'complement',
    right: `Верно. Это «${PAIRING_LABELS.COMPLEMENT}»: плотная солодовая основа Kozel поддерживает насыщенный вкус варёного мяса.`,
    wrong: `Нет. Здесь «${PAIRING_LABELS.COMPLEMENT}»: солодовая плотность Kozel повторяет насыщенный вкус варёного мяса, а не спорит с ним.`,
  },
  {
    id: 'rice',
    text: 'Wùkōng Jū в каталоге Flavor Tree: какое это пиво?',
    options: [
      { id: 'rice', label: 'Рисовое' },
      { id: 'wheat', label: 'Пшеничное' },
      { id: 'dark', label: 'Тёмное' },
    ],
    correct: 'rice',
    right: 'Верно. Это рисовый лагер: рис делает тело лёгким и сухим.',
    wrong: 'Нет. Wùkōng Jū это рисовый лагер.',
  },
];

/** Уровень курса -> раздел этой страницы, где уже есть материал по нему. */
const READY_SECTIONS: Record<number, { anchor: string; label: string }> = {
  2: { anchor: 'academy-lesson', label: 'Урок ниже' },
  3: { anchor: 'academy-quiz', label: 'Тест ниже' },
};

@Component({
  selector: 'app-academy',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mb-4xl">
      <h1 class="section-header">Школа пивной культуры и сенсорики</h1>
      <p class="section-subtitle">
        Четыре ступени: от первого знакомства с пивом до подбора напитка к блюдам для гостей.
        Курсы в разработке, первый урок и экспресс-тест уже на этой странице.
      </p>
    </div>

    <!-- Сетка курсов -->
    @if (!coursesLoaded()) {
      <div class="skeleton-grid mb-5xl" aria-busy="true" aria-label="Загружаем курсы">
        @for (i of skeletonCards; track i) {
          <div class="skeleton-card">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
          </div>
        }
      </div>
    } @else {
    <div class="grid grid-2 mb-5xl">
      @for (c of courses(); track c.id) {
        <div class="glass-card p-2xl stagger-item">
          <span class="badge mb-md">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/></svg>
            Ступень {{ c.level }}
          </span>
          <h3 class="mb-md" style="font-size: 1.25rem;">{{ c.title }}</h3>
          <p class="text-dim text-sm mb-lg">{{ c.description }}</p>
          @if (ready[c.level]; as section) {
            <button type="button" class="btn-outline btn-sm" (click)="scrollTo(section.anchor)">{{ section.label }}</button>
          } @else {
            <div class="text-muted text-sm flex items-center gap-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              Скоро
            </div>
          }
        </div>
      } @empty {
        <div class="glass-panel text-center p-4xl" style="grid-column: 1 / -1;">
          <p class="text-muted">Курсы пока не добавлены.</p>
        </div>
      }
    </div>
    }

    <!-- Урок: вкусовая пирамида на примере сорта из каталога -->
    <section id="academy-lesson" class="glass-panel p-4xl mb-5xl">
      <span class="badge mb-md">Урок</span>
      <h2 class="mb-sm">Как раскрывается глоток</h2>
      <p class="text-muted mb-2xl">
        Во Flavor Tree вкус сорта раскладывается на три слоя по времени, как аромат в парфюмерии.
        Это наша учебная модель: она помогает замечать, что меняется во рту за несколько секунд.
      </p>

      <div class="grid grid-3 mb-2xl">
        @for (layer of layers(); track layer.key) {
          <article class="glass-card p-xl">
            <div class="flex justify-between items-center gap-sm mb-md">
              <h3 style="font-size: 1.05rem;">{{ layer.name }}</h3>
              <span class="badge">{{ layer.time }}</span>
            </div>
            <p class="text-dim text-sm mb-lg">{{ layer.text }}</p>
            @if (layer.notes.length) {
              <ul class="lesson-notes">
                @for (n of layer.notes; track n.id) {
                  <li>
                    <span aria-hidden="true">{{ n.icon }}</span>
                    <span class="font-semibold">{{ n.name }}</span>
                    <span class="text-beer font-bold">{{ n.intensity }}/10</span>
                  </li>
                }
              </ul>
            }
          </article>
        }
      </div>

      @if (example(); as b) {
        <p class="text-sm text-muted mb-lg">
          Ноты в карточках взяты из пирамиды {{ b.name }} в нашем каталоге. Цифра показывает, насколько нота выражена,
          от 1 до 10. Пирамиды сортов пока черновик команды Flavor Tree.
        </p>
      }
      <p class="text-sm text-dim">
        Как попробовать: сделайте глоток и подержите его во рту секунд пятнадцать. Сначала заметьте аромат,
        потом тело, в конце то, что осталось после глотка.
      </p>
    </section>

    <!-- Экспресс-тест -->
    <section id="academy-quiz" class="glass-panel p-4xl mb-5xl">
      <h2 class="mb-sm">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline; vertical-align: -3px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        Экспресс-тест: пиво и еда
      </h2>
      <p class="text-muted mb-2xl">Вопросы по вкусовой пирамиде, сочетаниям и сортам каталога. Ответ проверяется сразу.</p>

      @for (q of quiz; track q.id; let i = $index) {
        <div class="mb-2xl">
          <h4 class="mb-lg" style="font-size: 1.15rem; line-height: 1.5;">{{ i + 1 }}. {{ q.text }}</h4>
          <div class="flex gap-md flex-wrap mb-md">
            @for (o of q.options; track o.id) {
              <button type="button" class="btn-outline quiz-option" [class.active]="answers()[q.id] === o.id" (click)="answer(q.id, o.id)">{{ o.label }}</button>
            }
          </div>
          @if (answers()[q.id]; as picked) {
            <div class="quiz-result" [class.correct]="picked === q.correct" [class.wrong]="picked !== q.correct" role="status">
              {{ picked === q.correct ? q.right : q.wrong }}
            </div>
          }
        </div>
      }

      @if (answeredCount() === quiz.length) {
        <div class="flex items-center justify-between gap-md flex-wrap">
          <p class="font-bold">Правильных ответов: {{ correctCount() }} из {{ quiz.length }}</p>
          <button type="button" class="btn-outline" (click)="answers.set({})">Пройти заново</button>
        </div>
      }
    </section>

    <!-- Команда проекта -->
    <section>
      <h2 class="section-header mb-sm">Команда проекта</h2>
      <p class="text-muted mb-2xl">
        Сомелье в команде нет. Вкусовые пирамиды сортов и пары с блюдами пока черновик команды:
        ноты и пары подобраны по стилю и описанию сорта, без дегустации.
      </p>
      <div class="grid grid-3">
        @for (m of team; track m.name) {
          <div class="glass-card p-2xl stagger-item">
            <h3 class="mb-sm" style="font-size: 1.15rem;">{{ m.name }}</h3>
            <p class="text-beer font-semibold text-sm">{{ m.role }}</p>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    /* Длинные варианты ответа переносятся, а не вылезают за экран */
    .quiz-option { white-space: normal; text-align: left; line-height: 1.4; }

    .lesson-notes { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-sm); }
    .lesson-notes li { display: flex; align-items: center; gap: var(--space-sm); font-size: 0.9rem; }
    .lesson-notes li .text-beer { margin-left: auto; }

    @media (max-width: 768px) {
      .quiz-option { width: 100%; min-height: 48px; }
    }
  `]
})
export class AcademyComponent implements OnInit {
  private api = inject(ApiService);
  courses = signal<Course[]>([]);
  /** Пока false - скелет вместо пустого списка. */
  coursesLoaded = signal(false);
  /** Сорт из каталога, на котором показан пример пирамиды. */
  example = signal<Brand | null>(null);
  /** id вопроса -> выбранный вариант. */
  answers = signal<Record<string, string>>({});

  readonly skeletonCards = [1, 2, 3, 4];
  readonly team = TEAM;
  readonly quiz = QUIZ;
  readonly ready = READY_SECTIONS;

  /** Слои урока с нотами сорта-примера (до трёх самых выраженных, без дефектов вкуса). */
  layers = computed(() => {
    const p = this.example()?.pyramid;
    return LAYERS.map(l => ({
      ...l,
      notes: [...(p?.[l.key] ?? [])]
        .filter((n: PyramidNoteItem) => !n.is_off_flavour)
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 3),
    }));
  });

  answeredCount = computed(() => Object.keys(this.answers()).length);
  correctCount = computed(() => this.quiz.filter(q => this.answers()[q.id] === q.correct).length);

  ngOnInit() {
    this.api.getCourses().subscribe({
      next: data => { this.courses.set(data); this.coursesLoaded.set(true); },
      error: () => this.coursesLoaded.set(true),
    });
    // Пример пирамиды: без сорта урок всё равно читается, просто без нот.
    this.api.getBrands().subscribe(brands => {
      const pick = brands.find(b => b.name === EXAMPLE_BRAND && b.is_active !== false)
        ?? brands.find(b => b.is_active !== false && (b.note_count ?? 0) >= 3);
      if (!pick) return;
      this.api.getBrandDetail(pick.id).subscribe({ next: b => this.example.set(b), error: () => {} });
    });
  }

  answer(questionId: string, optionId: string) {
    this.answers.update(a => ({ ...a, [questionId]: optionId }));
  }

  scrollTo(anchor: string) {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
