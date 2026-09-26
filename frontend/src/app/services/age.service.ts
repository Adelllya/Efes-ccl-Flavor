import { Injectable, computed, signal } from '@angular/core';
import { AGE_OK_KEY, ageConfirmed } from '../ui/age-storage';

/** «Нет» на вопрос о возрасте: помним до конца визита (sessionStorage вкладки), потом спросим снова. */
export const AGE_NO_KEY = 'ft_age_no';

/** unknown - ещё не ответил, adult - есть 21, under21 - ответил «Нет». */
export type AgeAnswer = 'unknown' | 'adult' | 'under21';

function initialAnswer(): AgeAnswer {
  if (ageConfirmed()) return 'adult';
  try {
    return sessionStorage.getItem(AGE_NO_KEY) === '1' ? 'under21' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Ответ гостя на вопрос «Вам исполнился 21 год?», общий для окна 21+, меню заведения и чата.
 *
 * «Да» хранится в localStorage (ft_age_ok) и больше не спрашивается. «Нет» на странице заведения
 * открывает меню без алкоголя: блюда и безалкогольные напитки бара; на остальных страницах окно
 * остаётся с безалкогольными напитками. Ответ «Нет» живёт до конца визита.
 */
@Injectable({ providedIn: 'root' })
export class AgeService {
  readonly answer = signal<AgeAnswer>(initialAnswer());
  readonly adult = computed(() => this.answer() === 'adult');
  readonly under21 = computed(() => this.answer() === 'under21');
  readonly answered = computed(() => this.answer() !== 'unknown');

  confirm(): void {
    try {
      localStorage.setItem(AGE_OK_KEY, '1');
      sessionStorage.removeItem(AGE_NO_KEY);
    } catch {
      // без хранилища ответ живёт до перезагрузки
    }
    this.answer.set('adult');
  }

  decline(): void {
    try {
      sessionStorage.setItem(AGE_NO_KEY, '1');
    } catch {
      // без хранилища ответ живёт до перезагрузки
    }
    this.answer.set('under21');
  }

  /** «Мне есть 21, ответить заново»: окно снова задаёт вопрос. */
  reset(): void {
    try {
      sessionStorage.removeItem(AGE_NO_KEY);
    } catch {
      // нечего убирать
    }
    this.answer.set('unknown');
  }
}
