import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { Course, TeamMember } from '../../models/flavor-tree.models';

@Component({
  selector: 'app-academy',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="margin-bottom: 36px;">
      <h1 style="font-size: 2.4rem;">Школа Пивной Культуры & Сенсорики</h1>
      <p style="color: var(--muted);">4 ступени обучения от базовой дегустации до дипломированного сомелье по стандарту FlavorActiV</p>
    </div>

    <!-- Сетка курсов -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 24px; margin-bottom: 48px;">
      @for (c of courses(); track c.id) {
        <div class="glass-card" style="padding: 26px;">
          <span class="badge" style="margin-bottom: 12px;">Ступень {{ c.level }}: {{ c.level_display }}</span>
          <h3 style="font-size: 1.3rem; margin-bottom: 10px;">{{ c.title }}</h3>
          <p style="font-size: 0.9rem; color: var(--foam-dim); margin-bottom: 16px;">{{ c.description }}</p>
          <div style="font-size: 0.85rem; color: var(--muted);">📚 Сертификация сомелье Flavor Tree</div>
        </div>
      }
    </div>

    <!-- Экспресс-квиз сомелье -->
    <section class="glass-panel" style="padding: 36px; margin-bottom: 48px;">
      <h2 style="margin-bottom: 8px;">⚡ Сенсорный Экспресс-Тест: Проверьте знания</h2>
      <p style="color: var(--muted); margin-bottom: 24px;">Ответьте на вопрос и получите мгновенный вердикт шеф-сомелье</p>

      <div style="margin-bottom: 20px;">
        <h4 style="font-size: 1.2rem; margin-bottom: 16px;">
          Какой принцип фуд-пейринга работает лучше всего при сочетании классического чешского Пилснера (Efes Pilsener) с традиционным жирным мясным блюдом Казы?
        </h4>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn-outline" (click)="quizAnswer.set('wrong')">Complement (Удвоение сладости и мягкости)</button>
          <button class="btn-outline" (click)="quizAnswer.set('correct')">Contrast (Хмелевая горечь и карбонизация режут жирность)</button>
        </div>
      </div>

      @if (quizAnswer() === 'correct') {
        <div style="padding: 16px; border-radius: 12px; background: rgba(46, 160, 67, 0.15); color: #1a5e28; font-weight: 600;">
          🎉 Абсолютно верно! Это классический пример Contrast-пары: благородная горечь хмеля Saaz и свежая карбонизация очищают вкусовые сосочки от насыщенных животных жиров вяленой конины.
        </div>
      } @else if (quizAnswer() === 'wrong') {
        <div style="padding: 16px; border-radius: 12px; background: rgba(212, 117, 25, 0.15); color: var(--beer-deep); font-weight: 600;">
          💡 Попробуйте еще раз! Жирные мясные деликатесы требуют хмелевого контраста (Contrast/Cleanse), чтобы освежить рецепторы.
        </div>
      }
    </section>

    <!-- Команда сомелье -->
    @if (team().length > 0) {
      <section>
        <h2 style="font-size: 2rem; margin-bottom: 24px;">Эксперты и Сомелье Проекта</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
          @for (m of team(); track m.id) {
            <div class="glass-card" style="padding: 24px;">
              <h3 style="font-size: 1.2rem; margin-bottom: 6px;">{{ m.name }}</h3>
              <p style="font-size: 0.85rem; color: var(--beer-mid); font-weight: 600; margin-bottom: 12px;">{{ m.role }}</p>
              <p style="font-size: 0.9rem; color: var(--foam-dim); font-style: italic;">«{{ m.bio }}»</p>
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
