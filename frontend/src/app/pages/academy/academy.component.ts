import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { Course, TeamMember } from '../../models/flavor-tree.models';

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
      }
    </div>

    <!-- Экспресс-квиз -->
    <section class="glass-panel p-4xl mb-5xl">
      <h2 class="mb-sm">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline; vertical-align: -3px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        Сенсорный Экспресс-Тест
      </h2>
      <p class="text-muted mb-2xl">Ответьте на вопрос и получите мгновенный вердикт шеф-сомелье</p>

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
  quizAnswer = signal<string | null>(null);

  ngOnInit() {
    this.api.getCourses().subscribe(data => this.courses.set(data));
    this.api.getTeam().subscribe(data => this.team.set(data));
  }
}
