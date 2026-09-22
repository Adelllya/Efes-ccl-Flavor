import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/data.service';
import { CERTIFICATE_XP, ProgressService } from '../../core/progress.service';
import { IconComponent } from '../../ui/icon.component';
import { SectionHeadComponent } from '../../ui/section.component';
import academyJson from '../../../../../data/academy.json';

export interface Lesson { id: string; title: string; minutes: number; body: string[]; tip: string; }
export interface Quiz { q: string; options: string[]; answer: number; why: string; }
export interface Level { id: string; level: number; title: string; subtitle: string; emoji: string; intro: string; lessons: Lesson[]; quiz: Quiz[]; }
export const ACADEMY = (academyJson as { levels: Level[] }).levels;

/** Школа сомелье: прогресс, уровни, сертификат. */
@Component({
  selector: 'ft-academy',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, SectionHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="eyebrow">Школа сомелье</span>
    <h1>Учимся <span class="grad-text">слышать вкус</span></h1>
    <p class="dim mt8">4 уровня, 12 уроков и 20 вопросов. За уроки, квизы, подборы и ежедневные визиты — XP. 5000 XP — именной сертификат Efes.</p>

    <section class="card hero mt16">
      <div class="lv">
        <div class="lv-badge" [style.background]="progress.level().color">{{ progress.level().level }}</div>
        <div class="grow">
          <div class="flex jb ac wrap g8"><b class="lg">{{ progress.level().title }} · {{ progress.level().subtitle }}</b><span class="badge"><ft-icon name="bolt" [size]="12" /> {{ progress.xp() }} XP</span></div>
          <div class="bar mt8"><i [style.width.%]="progress.levelProgress() * 100"></i></div>
          <div class="muted xs mt8">{{ progress.nextLevel() ? 'До «' + progress.nextLevel()!.title + '»: ' + (progress.nextLevel()!.xp_required - progress.xp()) + ' XP' : 'Высший уровень' }} · серия {{ progress.state().streak }} дн. · уроков {{ progress.state().lessons.length }}/12</div>
        </div>
      </div>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Программа" title="Четыре ступени" />
      <div class="levels">
        @for (l of levels; track l.id) {
          <a class="card hover lvl" [routerLink]="['/academy', l.id]" [style.--lc]="course(l.level)?.color">
            <div class="lvl-e">{{ l.emoji }}</div>
            <div class="grow">
              <div class="flex jb ac g8"><b>Ступень {{ l.level }} · {{ l.title }}</b><span class="muted xs">от {{ course(l.level)?.xp_required }} XP</span></div>
              <div class="amber sm b">{{ l.subtitle }}</div>
              <p class="dim sm mt8">{{ l.intro }}</p>
              <div class="flex g6 wrap mt8"><span class="chip chip-sm">{{ l.lessons.length }} урока</span><span class="chip chip-sm">{{ l.quiz.length }} вопросов</span>
                @if (done(l) === l.lessons.length) { <span class="badge badge-ok"><ft-icon name="check" [size]="12" /> уроки пройдены</span> } @else if (done(l) > 0) { <span class="badge">{{ done(l) }}/{{ l.lessons.length }} уроков</span> }
                @if (quizScore(l) !== null) { <span class="badge badge-info">квиз {{ quizScore(l) }}/{{ l.quiz.length }}</span> }
              </div>
            </div>
            <ft-icon name="chevron-right" />
          </a>
        }
      </div>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Сертификат" title="Именной сертификат Efes" [sub]="progress.certificateReady() ? 'Поздравляем — вы набрали 5000 XP' : progress.certificatePercent() + '% пути пройдено'" />
      <div class="card card-p cert-wrap">
        @if (!progress.certificateReady() && !preview()) {
          <div class="bar"><i [style.width.%]="progress.certificatePercent()"></i></div>
          <p class="dim sm mt8">{{ CERT_XP - progress.xp() }} XP до сертификата. Сертификат подтверждается QR-кодом и уникальным номером.</p>
          <button type="button" class="btn btn-secondary btn-sm mt12" (click)="preview.set(true)"><ft-icon name="shield" [size]="16" /> Посмотреть образец</button>
        } @else {
          <div class="flex g8 wrap ac mb12">
            <input class="input" style="max-width:320px" placeholder="Имя и фамилия на сертификате" [ngModel]="name()" (ngModelChange)="name.set($event)" />
            @if (progress.certificateReady()) { <button type="button" class="btn btn-primary btn-sm" (click)="issue()" [disabled]="!name().trim()"><ft-icon name="trophy" [size]="16" /> Выпустить</button> }
            <button type="button" class="btn btn-ghost btn-sm no-print" onclick="window.print()"><ft-icon name="download" [size]="16" /> Печать / PDF</button>
          </div>
          <div class="cert" [class.sample]="!progress.certificateReady()">
            <div class="cert-in">
              <div class="c-top"><span class="c-brand">FLAVOR TREE</span><span class="c-brand">EFES KAZAKHSTAN</span></div>
              <div class="c-title">Сертификат пивного сомелье</div>
              <div class="c-sub">подтверждает, что</div>
              <div class="c-name">{{ name().trim() || 'Имя Фамилия' }}</div>
              <div class="c-sub">прошёл(а) программу сенсорного образования Flavor Tree — 4 ступени, вкусовая пирамида, гастрономические пары — и набрал(а) {{ progress.certificateReady() ? progress.xp() : 5000 }} XP</div>
              <div class="c-foot"><div><div class="c-id">№ {{ certId() || 'FT-XXXXXXXX-XXXXX' }}</div><div class="muted xs">Проверка: flavortree.kz/verify/{{ certId() || '…' }}</div></div><div class="c-qr">@if (qrSvg()) { <img [src]="qrSvg()" alt="QR верификации" /> }</div></div>
              @if (!progress.certificateReady()) { <div class="wm">ОБРАЗЕЦ</div> }
            </div>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .hero { padding: 18px; }
    .lv { display: flex; gap: 14px; align-items: center; }
    .lv-badge { width: 56px; height: 56px; border-radius: 18px; color: #fff; font-family: var(--font-display); font-weight: 800; font-size: 1.6rem; display: grid; place-items: center; flex-shrink: 0; box-shadow: var(--shadow-1); }
    .levels { display: grid; gap: 12px; }
    .lvl { display: flex; gap: 14px; align-items: center; padding: 16px; border-left: 5px solid var(--lc, var(--amber-300)); }
    .lvl-e { font-size: 2rem; width: 52px; height: 52px; display: grid; place-items: center; border-radius: 16px; background: var(--grad-amber-soft); flex-shrink: 0; }
    .cert { position: relative; border-radius: var(--r-lg); overflow: hidden; background: #FFFDF8; color: #1A140D; border: 8px double #9D6F22; }
    .cert-in { padding: 28px 22px; text-align: center; position: relative; background: radial-gradient(500px 200px at 50% -20%, rgba(245,185,66,.25), transparent); }
    @media (min-width: 720px) { .cert-in { padding: 44px 48px; } }
    .c-top { display: flex; justify-content: space-between; font-family: var(--font-display); font-weight: 800; letter-spacing: .18em; font-size: .72rem; color: #8A6118; }
    .c-brand { }
    .c-title { font-family: var(--font-display); font-weight: 800; font-size: clamp(1.4rem, 4vw, 2.2rem); margin-top: 26px; color: #1A140D; }
    .c-sub { font-family: var(--font-accent); font-style: italic; color: #4A4033; margin-top: 10px; max-width: 56ch; margin-inline: auto; }
    .c-name { font-family: var(--font-display); font-weight: 800; font-size: clamp(1.6rem, 5vw, 2.8rem); color: #9D6F22; margin-top: 8px; }
    .c-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; text-align: left; gap: 12px; }
    .c-id { font-family: var(--font-display); font-weight: 700; letter-spacing: .06em; }
    .c-qr { width: 84px; height: 84px; }
    .c-qr img { width: 100%; height: 100%; }
    .wm { position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--font-display); font-weight: 900; font-size: clamp(3rem, 14vw, 7rem); color: rgba(192,57,43,.13); transform: rotate(-18deg); pointer-events: none; letter-spacing: .1em; }
  `],
})
export class AcademyPage {
  data = inject(DataService);
  progress = inject(ProgressService);
  readonly levels = ACADEMY;
  readonly CERT_XP = CERTIFICATE_XP;
  preview = signal(false);
  name = signal(this.progress.state().name);
  certId = computed(() => this.progress.state().certificateId ?? '');
  qrSvg = signal<string>('');

  course(level: number) { return this.data.courses().find(c => c.level === level); }
  done(l: Level): number { const s = new Set(this.progress.state().lessons); return l.lessons.filter(x => s.has(x.id)).length; }
  quizScore(l: Level): number | null { const v = this.progress.state().quizzes[l.id]; return v === undefined ? null : v; }
  async issue(): Promise<void> { this.progress.setName(this.name().trim()); const id = this.progress.issueCertificate(); await this.renderQr(id); }
  private async renderQr(id: string): Promise<void> {
    const QRm: any = await import('qrcode'); const QR = QRm.default ?? QRm;
    this.qrSvg.set(await QR.toDataURL(`https://flavortree.kz/verify/${id}`, { margin: 0, width: 240, color: { dark: '#1A140D', light: '#ffffff00' } }));
  }
  constructor() { queueMicrotask(() => { if (this.certId()) this.renderQr(this.certId()); else this.renderQr('SAMPLE'); }); }
}
