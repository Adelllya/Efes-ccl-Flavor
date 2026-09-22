import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProgressService } from '../../core/progress.service';
import { IconComponent } from '../../ui/icon.component';
import { ACADEMY, Level } from './academy.page';

/** Уровень: уроки (аккордеон, +50 XP за прочтение) и квиз по одному вопросу. */
@Component({
  selector: 'ft-lesson',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (level(); as l) {
      <a routerLink="/academy" class="btn btn-ghost btn-sm"><ft-icon name="arrow-left" [size]="16" /> Все ступени</a>
      <div class="flex g12 ac mt12"><span style="font-size:2.4rem">{{ l.emoji }}</span><div><span class="eyebrow">Ступень {{ l.level }}</span><h1 style="font-size:1.8rem">{{ l.title }} · {{ l.subtitle }}</h1></div></div>
      <p class="dim mt8">{{ l.intro }}</p>

      <section class="section">
        <h2>Уроки</h2>
        <div class="lessons mt12">
          @for (ls of l.lessons; track ls.id; let i = $index) {
            <div class="card lesson" [class.open]="open() === ls.id" [class.done]="isDone(ls.id)">
              <button type="button" class="lh" (click)="open.set(open() === ls.id ? '' : ls.id)" [attr.aria-expanded]="open() === ls.id">
                <span class="ln">{{ i + 1 }}</span>
                <span class="grow"><b>{{ ls.title }}</b><span class="muted xs"> · {{ ls.minutes }} мин</span></span>
                @if (isDone(ls.id)) { <span class="badge badge-ok"><ft-icon name="check" [size]="12" /> прочитано</span> }
                <ft-icon [name]="open() === ls.id ? 'chevron-down' : 'chevron-right'" />
              </button>
              @if (open() === ls.id) {
                <div class="lb reveal">
                  @for (p of ls.body; track p) { <p [innerHTML]="md(p)"></p> }
                  <div class="tip"><ft-icon name="sparkles" [size]="16" /> {{ ls.tip }}</div>
                  @if (!isDone(ls.id)) { <button type="button" class="btn btn-primary btn-sm mt12" (click)="finish(ls.id, ls.title)"><ft-icon name="check" [size]="16" /> Прочитал · +50 XP</button> }
                </div>
              }
            </div>
          }
        </div>
      </section>

      <section class="section">
        <div class="flex jb ac"><h2>Квиз</h2>@if (best() !== null) { <span class="badge badge-info">лучший результат {{ best() }}/{{ l.quiz.length }}</span> }</div>
        <div class="card card-p mt12 quiz">
          @if (!started()) {
            <p class="dim">{{ l.quiz.length }} вопросов · +25 XP за верный ответ, +60 XP за безошибочное прохождение.</p>
            <button type="button" class="btn btn-primary mt12" (click)="start()"><ft-icon name="bolt" /> {{ best() === null ? 'Начать' : 'Пройти ещё раз' }}</button>
          } @else if (idx() < l.quiz.length) {
            <div class="bar thin"><i [style.width.%]="idx() / l.quiz.length * 100"></i></div>
            <div class="muted xs mt8">Вопрос {{ idx() + 1 }} из {{ l.quiz.length }} · верных {{ correct() }}</div>
            <h3 class="mt12">{{ current().q }}</h3>
            <div class="opts mt12">
              @for (o of current().options; track o; let oi = $index) {
                <button type="button" class="opt" [class.right]="picked() !== null && oi === current().answer" [class.wrong]="picked() === oi && oi !== current().answer" [disabled]="picked() !== null" (click)="pick(oi)">{{ o }}</button>
              }
            </div>
            @if (picked() !== null) {
              <div class="why reveal" [class.ok]="picked() === current().answer"><b>{{ picked() === current().answer ? 'Верно!' : 'Не совсем.' }}</b> {{ current().why }}</div>
              <button type="button" class="btn btn-primary btn-sm mt12" (click)="next()">{{ idx() + 1 < l.quiz.length ? 'Дальше' : 'Результат' }} <ft-icon name="arrow-right" [size]="16" /></button>
            }
          } @else {
            <div class="center pop">
              <div style="font-size:52px">{{ correct() === l.quiz.length ? '🏆' : correct() >= l.quiz.length / 2 ? '👏' : '📚' }}</div>
              <h3 class="mt8">{{ correct() }} из {{ l.quiz.length }}</h3>
              <p class="dim sm mt8">{{ correct() === l.quiz.length ? 'Безошибочно — сомелье гордится.' : 'Перечитайте уроки и попробуйте снова: XP начисляется за улучшение результата.' }}</p>
              <div class="flex g8 jc mt16"><button type="button" class="btn btn-secondary btn-sm" (click)="start()">Ещё раз</button><a routerLink="/academy" class="btn btn-primary btn-sm">К ступеням</a></div>
            </div>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    .lessons { display: grid; gap: 10px; }
    .lesson.done { border-color: rgba(46,139,87,.35); }
    .lh { width: 100%; display: flex; align-items: center; gap: 12px; padding: 14px 16px; text-align: left; }
    .ln { width: 30px; height: 30px; border-radius: 50%; background: var(--grad-amber); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: .84rem; flex-shrink: 0; }
    .lb { padding: 0 16px 16px 58px; display: grid; gap: 10px; color: var(--ink-2); line-height: 1.6; }
    @media (max-width: 640px) { .lb { padding-left: 16px; } }
    .tip { display: flex; gap: 8px; align-items: flex-start; background: var(--amber-100); padding: 10px 12px; border-radius: var(--r-md); font-size: .9rem; color: var(--amber-900); }
    .opts { display: grid; gap: 8px; }
    .opt { text-align: left; padding: 14px 16px; border-radius: var(--r-md); border: 1.5px solid var(--line); background: var(--surface); font-weight: 600; transition: all var(--t-fast); }
    .opt:hover:not(:disabled) { border-color: var(--amber-400); }
    .opt.right { border-color: var(--ok); background: var(--ok-bg); }
    .opt.wrong { border-color: var(--warn); background: var(--warn-bg); }
    .why { margin-top: 12px; padding: 12px 14px; border-radius: var(--r-md); background: var(--warn-bg); color: var(--ink-2); font-size: .92rem; }
    .why.ok { background: var(--ok-bg); }
  `],
})
export class LessonPage {
  private progress = inject(ProgressService);
  levelId = input.required<string>();
  level = computed<Level | undefined>(() => ACADEMY.find(l => l.id === this.levelId()));
  open = signal('');
  started = signal(false); idx = signal(0); correct = signal(0); picked = signal<number | null>(null);
  current = computed(() => this.level()!.quiz[this.idx()]);
  best = computed(() => { const v = this.progress.state().quizzes[this.levelId()]; return v === undefined ? null : v; });

  isDone(id: string): boolean { return this.progress.state().lessons.includes(id); }
  finish(id: string, title: string): void { this.progress.award('lesson', id, `Урок «${title}»`); }
  md(p: string): string { return p.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }
  start(): void { this.started.set(true); this.idx.set(0); this.correct.set(0); this.picked.set(null); }
  pick(i: number): void { this.picked.set(i); if (i === this.current().answer) this.correct.update(c => c + 1); }
  next(): void {
    this.picked.set(null); this.idx.update(i => i + 1);
    if (this.idx() >= this.level()!.quiz.length) this.progress.recordQuiz(this.levelId(), this.correct(), this.level()!.quiz.length);
  }
}
