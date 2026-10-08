import { Injectable, signal } from '@angular/core';

/** С какого возраста в Казахстане продают алкоголь. */
export const LEGAL_AGE = 21;
/** На сколько дней запоминаем пройденную проверку, если гость попросил запомнить. */
const REMEMBER_DAYS = 30;
const PASS_KEY = 'ft_age';
const DENIED_KEY = 'ft_age_denied';

interface StoredPass {
  ok: boolean;
  until: number;
}

function readPass(storage: Storage): boolean {
  try {
    const saved = JSON.parse(storage.getItem(PASS_KEY) || 'null') as Partial<StoredPass> | null;
    return !!saved && saved.ok === true && Number(saved.until) > Date.now();
  } catch {
    return false;
  }
}

/** Полных лет на сегодня; null, если такой даты не существует или она в будущем. */
export function ageFrom(day: number, month: number, year: number, today = new Date()): number | null {
  if (![day, month, year].every(Number.isInteger)) return null;
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) return null;
  if (year < 1900 || birth > today) return null;
  let age = today.getFullYear() - year;
  const hadBirthday = today.getMonth() > month - 1 || (today.getMonth() === month - 1 && today.getDate() >= day);
  if (!hadBirthday) age -= 1;
  return age;
}

/**
 * Проверка возраста 21+. Сайт рассказывает о пиве, поэтому каждая страница закрыта, пока
 * гость не подтвердит возраст датой рождения. Саму дату не храним: запоминаем только,
 * что проверка пройдена, и до какого дня это помнить.
 */
@Injectable({ providedIn: 'root' })
export class AgeGateService {
  readonly passed = signal(this.readPassed());
  /** Гость младше 21: до конца сессии форму повторно не показываем. */
  readonly denied = signal(this.readDenied());

  private readPassed(): boolean {
    try {
      return readPass(localStorage) || readPass(sessionStorage);
    } catch {
      return false;
    }
  }

  private readDenied(): boolean {
    try {
      return sessionStorage.getItem(DENIED_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** Возраст подтверждён. remember: помнить 30 дней на устройстве, иначе до закрытия вкладки. */
  allow(remember: boolean): void {
    const days = remember ? REMEMBER_DAYS : 1;
    const pass: StoredPass = { ok: true, until: Date.now() + days * 24 * 60 * 60 * 1000 };
    try {
      (remember ? localStorage : sessionStorage).setItem(PASS_KEY, JSON.stringify(pass));
    } catch {
      // без хранилища проверка действует до перезагрузки страницы
    }
    this.passed.set(true);
  }

  deny(): void {
    try {
      sessionStorage.setItem(DENIED_KEY, '1');
    } catch {
      // без хранилища отказ действует до перезагрузки страницы
    }
    this.denied.set(true);
  }
}
