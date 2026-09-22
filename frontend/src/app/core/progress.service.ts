import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DataService } from './data.service';

export type AwardKind = 'pairing' | 'lesson' | 'quiz' | 'quiz_perfect' | 'daily' | 'streak7' | 'dna' | 'explore' | 'share';
export const XP_TABLE: Record<AwardKind, number> = { pairing: 10, lesson: 50, quiz: 25, quiz_perfect: 60, daily: 20, streak7: 100, dna: 100, explore: 5, share: 30 };
export const CERTIFICATE_XP = 5000;

interface ProgressState {
  xp: number; streak: number; lastVisit: string; lessons: string[]; quizzes: Record<string, number>;
  pairings: string[]; explored: string[]; badges: string[]; name: string; certificateId?: string; version: 1;
}
const KEY = 'ft.progress.v1';
const today = () => new Date().toISOString().slice(0, 10);
const blank = (): ProgressState => ({ xp: 0, streak: 0, lastVisit: '', lessons: [], quizzes: {}, pairings: [], explored: [], badges: [], name: '', version: 1 });

/** Геймификация: XP, дневные серии, уровни Школы сомелье, сертификат. Хранится в localStorage. */
@Injectable({ providedIn: 'root' })
export class ProgressService {
  private data = inject(DataService);
  readonly state = signal<ProgressState>(this.load());
  readonly lastAward = signal<{ kind: AwardKind; xp: number; label: string } | null>(null);

  readonly xp = computed(() => this.state().xp);
  readonly level = computed(() => {
    const courses = this.data.courses();
    let lvl = courses[0];
    for (const c of courses) if (this.xp() >= c.xp_required) lvl = c;
    return lvl;
  });
  readonly nextLevel = computed(() => this.data.courses().find(c => c.xp_required > this.xp()) ?? null);
  readonly levelProgress = computed(() => {
    const cur = this.level(), next = this.nextLevel();
    if (!next) return 1;
    return Math.min(1, (this.xp() - cur.xp_required) / (next.xp_required - cur.xp_required));
  });
  readonly certificateReady = computed(() => this.xp() >= CERTIFICATE_XP);
  readonly certificatePercent = computed(() => Math.min(100, Math.round((this.xp() / CERTIFICATE_XP) * 100)));

  constructor() {
    effect(() => { try { localStorage.setItem(KEY, JSON.stringify(this.state())); } catch { /* private mode */ } });
    this.touchDaily();
  }

  award(kind: AwardKind, id?: string, label?: string): number {
    const s = this.state();
    if (kind === 'pairing' && id) { if (s.pairings.includes(id)) return 0; }
    if (kind === 'lesson' && id) { if (s.lessons.includes(id)) return 0; }
    if (kind === 'explore' && id) { if (s.explored.includes(id)) return 0; }
    if (kind === 'dna' && s.badges.includes('dna')) return 0;
    const xp = XP_TABLE[kind];
    this.state.update(st => ({
      ...st, xp: st.xp + xp,
      pairings: kind === 'pairing' && id ? [...st.pairings, id] : st.pairings,
      lessons: kind === 'lesson' && id ? [...st.lessons, id] : st.lessons,
      explored: kind === 'explore' && id ? [...st.explored, id] : st.explored,
      badges: kind === 'dna' ? [...st.badges, 'dna'] : st.badges,
    }));
    this.lastAward.set({ kind, xp, label: label || LABELS[kind] });
    setTimeout(() => this.lastAward.set(null), 2600);
    return xp;
  }

  recordQuiz(quizId: string, correct: number, total: number): number {
    const prev = this.state().quizzes[quizId] ?? -1;
    if (correct <= prev) return 0;
    const gained = (correct - Math.max(prev, 0)) * XP_TABLE.quiz + (correct === total && prev < total ? XP_TABLE.quiz_perfect : 0);
    this.state.update(st => ({ ...st, xp: st.xp + gained, quizzes: { ...st.quizzes, [quizId]: correct } }));
    this.lastAward.set({ kind: 'quiz', xp: gained, label: correct === total ? 'Квиз пройден без ошибок!' : 'Квиз засчитан' });
    setTimeout(() => this.lastAward.set(null), 2600);
    return gained;
  }

  setName(name: string): void { this.state.update(s => ({ ...s, name })); }
  issueCertificate(): string {
    const s = this.state();
    if (s.certificateId) return s.certificateId;
    const id = 'FT-' + today().replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    this.state.update(st => ({ ...st, certificateId: id }));
    return id;
  }
  reset(): void { this.state.set(blank()); }

  private touchDaily(): void {
    const s = this.state(); const t = today();
    if (s.lastVisit === t) return;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const streak = s.lastVisit === y.toISOString().slice(0, 10) ? s.streak + 1 : 1;
    const bonus = streak % 7 === 0 ? XP_TABLE.streak7 : 0;
    this.state.update(st => ({ ...st, lastVisit: t, streak, xp: st.xp + (st.lastVisit ? XP_TABLE.daily : 0) + bonus }));
  }

  private load(): ProgressState {
    try { const raw = localStorage.getItem(KEY); if (raw) return { ...blank(), ...JSON.parse(raw) }; } catch { /* ignore */ }
    return blank();
  }
}

const LABELS: Record<AwardKind, string> = {
  pairing: 'Пара подобрана', lesson: 'Урок прочитан', quiz: 'Ответ верный', quiz_perfect: 'Идеальный квиз', daily: 'Ежедневный визит',
  streak7: 'Серия 7 дней!', dna: 'Flavor DNA расшифрован', explore: 'Новый сорт изучен', share: 'Карточкой поделились',
};
