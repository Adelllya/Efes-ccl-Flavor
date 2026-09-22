import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { Course, TeamMember } from '../../models/flavor-tree.models';

@Component({
  selector: 'app-academy',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="section-head">
      <span class="badge">Академия</span>
      <h1 class="section-header">Школа пивной культуры и сенсорики</h1>
      <p class="section-subtitle">Четыре ступени: от первого осознанного глотка до сомелье, который собирает карту бара.</p>
    </div>

    <!-- Лестница ступеней -->
    <div class="course-grid mb-5xl">
      @for (c of courses(); track c.id; let i = $index) {
        <article class="glass-card course-card stagger-item" [style.--step]="c.color">
          <div class="course-step">
            <span class="course-step-num">{{ c.level }}</span>
            <span class="course-step-name">{{ c.level_display }}</span>
          </div>
          <h3 class="course-title">{{ c.title }}</h3>
          <p class="text-dim text-sm course-desc">{{ c.description }}</p>
          <div class="course-foot mt-auto">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>
            Сертификация Flavor Tree
          </div>
        </article>
      } @empty {
        <div class="empty-state">
          <p>Ступени ещё не заведены. Загрузите их командой <code>manage.py load_flavor_data</code>.</p>
        </div>
      }
    </div>

    <!-- Экспресс-квиз -->
    <section class="glass-panel p-4xl mb-5xl quiz-panel">
      <div class="section-head" style="margin-bottom: var(--space-2xl);">
        <span class="badge">Проверка себя</span>
        <h2 class="section-header" style="font-size: 1.9rem;">Сенсорный экспресс-тест</h2>
        <p class="section-subtitle">Один вопрос и мгновенный вердикт шеф-сомелье.</p>
      </div>

      <div class="mb-xl">
        <h4 class="mb-lg" style="font-size: 1.15rem; line-height: 1.5;">
          Какой принцип фуд-пейринга работает лучше всего при сочетании классического чешского Пилснера (Efes Pilsener) с традиционным жирным мясным блюдом Казы?
        </h4>
        <div class="flex gap-md flex-wrap">
          <button class="btn-outline" (click)="quizAnswer.set('wrong')">Complement (Удвоение сладости и мягкости)</button>
          <button class="btn-outline" (click)="quizAnswer.set('correct')">Contrast (Хмелевая горечь и карбонизация режут жирность)</button>
        </div>
      </div>

      @if (quizAnswer() === 'correct') {
        <div class="quiz-result correct">
          Абсолютно верно! Это классический пример Contrast-пары: благородная горечь хмеля Saaz и свежая карбонизация очищают вкусовые сосочки от насыщенных животных жиров вяленой конины.
        </div>
      } @else if (quizAnswer() === 'wrong') {
        <div class="quiz-result wrong">
          Попробуйте еще раз! Жирные мясные деликатесы требуют хмелевого контраста (Contrast/Cleanse), чтобы освежить рецепторы.
        </div>
      }
    </section>

    <!-- Команда сомелье -->
    @if (team().length > 0) {
      <section>
        <div class="section-head">
          <span class="badge">Команда</span>
          <h2 class="section-header">Эксперты и сомелье проекта</h2>
        </div>
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
  `,
  styles: [`
    .course-grid {
      display: grid;
      gap: var(--space-2xl);
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }

    .course-card {
      padding: var(--space-2xl);
      overflow: hidden;
    }
    /* Кромка в цвете ступени: четыре карточки читаются как лестница. */
    .course-card::before {
      content: '';
      position: absolute;
      inset: 0 0 auto 0;
      height: 3px;
      background: var(--step, var(--beer-accent));
    }

    .course-step {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      margin-bottom: var(--space-lg);
    }
    .course-step-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      border-radius: var(--radius-md);
      background: var(--step, var(--beer-accent));
      color: #fff;
      font-family: var(--font-heading);
      font-size: 1.15rem;
      font-weight: 800;
      box-shadow: 0 6px 16px -6px var(--step, var(--beer-accent));
    }
    .course-step-name {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .course-title {
      font-size: 1.2rem;
      margin-bottom: var(--space-sm);
    }
    .course-desc { margin-bottom: var(--space-xl); }

    .course-foot {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding-top: var(--space-lg);
      border-top: 1px solid var(--line-subtle);
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--muted);
    }
    .course-foot svg { width: 15px; height: 15px; }

    .quiz-panel .btn-outline {
      text-align: left;
      line-height: 1.4;
      padding: 12px 18px;
    }
  `]
})
export class AcademyComponent implements OnInit {
  private api = inject(ApiService);
  courses = signal<Course[]>([]);
  team = signal<TeamMember[]>([]);
  quizAnswer = signal<string | null>(null);

  ngOnInit() {
    this.api.getCourses().subscribe(data => this.courses.set(data));
    this.api.getTeam().subscribe(data => this.team.set(data));
  }
}
