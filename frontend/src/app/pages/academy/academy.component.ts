import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { Course, PAIRING_LABELS, TeamMember } from '../../models/flavor-tree.models';

@Component({
  selector: 'app-academy',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mb-4xl">
      <h1 class="section-header">Школа Пивной Культуры & Сенсорики</h1>
      <p class="section-subtitle">4 ступени обучения от базовой дегустации до дипломированного сомелье по стандарту FlavorActiV</p>
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
            Ступень {{ c.level }}: {{ c.level_display }}
          </span>
          <h3 class="mb-md" style="font-size: 1.25rem;">{{ c.title }}</h3>
          <p class="text-dim text-sm mb-lg">{{ c.description }}</p>
          <div class="text-muted text-sm flex items-center gap-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>
            Сертификация сомелье Flavor Tree
          </div>
        </div>
      } @empty {
        <div class="glass-panel text-center p-4xl" style="grid-column: 1 / -1;">
          <p class="text-muted">Курсы пока не добавлены.</p>
        </div>
      }
    </div>
    }

    <!-- Экспресс-квиз -->
    <section class="glass-panel p-4xl mb-5xl">
      <h2 class="mb-sm">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline; vertical-align: -3px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        Сенсорный Экспресс-Тест
      </h2>
      <p class="text-muted mb-2xl">Ответьте на вопрос и получите мгновенный вердикт шеф-сомелье</p>

      <div class="mb-xl">
        <h4 class="mb-lg" style="font-size: 1.15rem; line-height: 1.5;">
          Какой принцип сочетания работает лучше всего, когда к жирному мясному блюду Казы подают классический чешский Пилснер (Efes Pilsener)?
        </h4>
        <div class="flex gap-md flex-wrap">
          @for (o of quizOptions; track o.id) {
            <button class="btn-outline" [class.active]="quizAnswer() === o.id" (click)="quizAnswer.set(o.id)">{{ o.label }}</button>
          }
        </div>
      </div>

      @if (quizAnswer() === 'correct') {
        <div class="quiz-result correct">
          Абсолютно верно! Это классический пример пары «{{ labels.CONTRAST }}»: благородная горечь хмеля Saaz и свежая карбонизация очищают вкусовые сосочки от насыщенных животных жиров вяленой конины.
        </div>
      } @else if (quizAnswer() === 'wrong') {
        <div class="quiz-result wrong">
          Попробуйте ещё раз! Жирные мясные деликатесы требуют хмелевого контраста («{{ labels.CONTRAST }}» или «{{ labels.CLEANSE }}»), чтобы освежить рецепторы.
        </div>
      }
    </section>

    <!-- Команда сомелье -->
    @if (teamLoaded() && team().length > 0) {
      <section>
        <h2 class="section-header mb-2xl">Эксперты и Сомелье Проекта</h2>
        <div class="grid grid-3">
          @for (m of team(); track m.id) {
            <div class="glass-card p-2xl stagger-item">
              <h3 class="mb-sm" style="font-size: 1.15rem;">{{ m.name }}</h3>
              <p class="text-beer font-semibold text-sm mb-md">{{ m.role }}</p>
              <p class="text-dim text-sm italic">«{{ m.bio }}»</p>
            </div>
          }
        </div>
      </section>
    }
  `
})
export class AcademyComponent implements OnInit {
  private api = inject(ApiService);
  courses = signal<Course[]>([]);
  team = signal<TeamMember[]>([]);
  /** Пока false - скелет вместо пустого списка. */
  coursesLoaded = signal(false);
  teamLoaded = signal(false);
  quizAnswer = signal<string | null>(null);

  readonly skeletonCards = [1, 2, 3, 4];
  /** Типы сочетаний подписываем так же, как на остальных страницах. */
  readonly labels = PAIRING_LABELS;
  readonly quizOptions = [
    { id: 'wrong', label: `${PAIRING_LABELS.COMPLEMENT}: удвоение сладости и мягкости` },
    { id: 'correct', label: `${PAIRING_LABELS.CONTRAST}: хмелевая горечь и карбонизация режут жирность` },
  ];

  ngOnInit() {
    this.api.getCourses().subscribe({
      next: data => { this.courses.set(data); this.coursesLoaded.set(true); },
      error: () => this.coursesLoaded.set(true),
    });
    this.api.getTeam().subscribe({
      next: data => { this.team.set(data); this.teamLoaded.set(true); },
      error: () => this.teamLoaded.set(true),
    });
  }
}
