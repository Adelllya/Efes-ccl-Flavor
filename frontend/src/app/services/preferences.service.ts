import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, of, switchMap, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { Brand, TasteKey, UserPreferences } from '../models/flavor-tree.models';
import { BeerProfile, beerProfile } from '../pages/landing/pairing-engine.data';

export const TASTE_SCALES: { key: TasteKey; label: string; low: string; high: string }[] = [
  { key: 'body', label: 'Плотность', low: 'лёгкое', high: 'плотное' },
  { key: 'bitterness', label: 'Горечь', low: 'мягкое', high: 'горькое' },
  { key: 'freshness', label: 'Свежесть', low: 'бархатное', high: 'освежающее' },
  { key: 'sweetness', label: 'Сладость', low: 'сухое', high: 'сладкое' },
  { key: 'roast', label: 'Обжарка', low: 'светлое', high: 'кофе, шоколад' },
  { key: 'strength', label: 'Крепость', low: 'слабое', high: 'крепкое' }
];

export interface BrandMatch {
  brand: Brand;
  /** 0-100: насколько сорт похож на заданный вкус. */
  percent: number;
}

export type Taste = Partial<Record<TasteKey, number>>;

/** Вкус гостя без входа: ответы короткого опроса живут в браузере. */
const GUEST_TASTE_KEY = 'ft_taste';

function readGuestTaste(): Taste {
  try {
    const saved = JSON.parse(localStorage.getItem(GUEST_TASTE_KEY) || '{}') as Record<string, unknown>;
    const taste: Taste = {};
    for (const scale of TASTE_SCALES) {
      const value = Number(saved?.[scale.key]);
      if (saved?.[scale.key] !== undefined && Number.isFinite(value) && value >= 0 && value <= 10) taste[scale.key] = value;
    }
    return taste;
  } catch {
    return {};
  }
}

/** Словесная оценка совпадения: число само по себе мало что говорит. */
export function matchLabel(percent: number): string {
  if (percent >= 80) return 'ваш вкус';
  if (percent >= 65) return 'близко к вашему вкусу';
  if (percent >= 50) return 'стоит попробовать';
  return 'на любителя';
}

/**
 * Вкус и любимые сорта вошедшего пользователя. Грузится после входа,
 * сбрасывается при выходе; у гостя всегда null.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly prefs = signal<UserPreferences | null>(null);
  readonly favorites = computed(() => new Set(this.prefs()?.favorite_brands ?? []));
  /** Вкус из короткого опроса, пока гость не вошёл. */
  readonly guestTaste = signal<Taste>(readGuestTaste());
  /** Вкус, по которому считаем совпадение: из аккаунта, а без него из опроса гостя. */
  readonly taste = computed<Taste>(() => {
    const own = this.prefs()?.taste ?? {};
    return Object.keys(own).length ? own : this.guestTaste();
  });
  readonly hasTaste = computed(() => Object.keys(this.taste()).length > 0);

  constructor() {
    effect(() => {
      const user = this.auth.user();
      untracked(() => user ? this.reload() : this.prefs.set(null));
    }, { allowSignalWrites: true });
  }

  reload() {
    this.api.getPreferences().subscribe({
      next: p => {
        this.prefs.set(p);
        this.adoptGuestTaste(p);
      },
      error: () => this.prefs.set(null)
    });
  }

  /** Гость прошёл опрос вкуса, а потом вошёл: в пустой профиль аккаунта переносим его ответы. */
  private adoptGuestTaste(p: UserPreferences) {
    const guest = this.guestTaste();
    if (Object.keys(p.taste ?? {}).length || !Object.keys(guest).length) return;
    this.save({ taste: guest }).subscribe({
      // Перенесли: запись в браузере больше не нужна, иначе очищенный в профиле вкус возвращался бы
      next: () => this.forgetGuestTaste(),
      error: () => undefined,
    });
  }

  private forgetGuestTaste() {
    this.guestTaste.set({});
    try {
      localStorage.removeItem(GUEST_TASTE_KEY);
    } catch {
      // хранилище недоступно: забывать нечего
    }
  }

  /** Результат опроса вкуса: вошедшему пишем в аккаунт, гостю в браузер. */
  setTaste(taste: Taste): void {
    if (this.auth.isLoggedIn()) {
      this.save({ taste }).subscribe({ error: () => undefined });
      return;
    }
    this.guestTaste.set(taste);
    try {
      localStorage.setItem(GUEST_TASTE_KEY, JSON.stringify(taste));
    } catch {
      // без хранилища вкус гостя живёт до перезагрузки
    }
  }

  /** Насколько сорт совпадает с известным вкусом, 0-100; null, если вкус ещё не задан. */
  percentFor(brand: Brand): number | null {
    const taste = this.taste();
    const keys = Object.keys(taste) as TasteKey[];
    if (!keys.length) return null;
    const p: BeerProfile = beerProfile(brand);
    const diff = keys.reduce((sum, k) => sum + Math.abs(p[k] - (taste[k] ?? 0)), 0) / keys.length;
    return Math.max(0, Math.round(100 - diff * 10));
  }

  save(patch: Partial<Pick<UserPreferences, 'taste' | 'cuisines' | 'favorite_brands'>>): Observable<UserPreferences> {
    return this.api.updatePreferences(patch).pipe(tap(p => this.prefs.set(p)));
  }

  isFavorite(brandId: string): boolean {
    return this.favorites().has(brandId);
  }

  /** Добавляет или убирает сорт из любимых. Сразу меняет сердечко, при ошибке возвращает назад. */
  toggleFavorite(brandId: string): Observable<UserPreferences> {
    const before = this.prefs();
    if (!before) return this.addFavoriteUnloaded(brandId);
    const list = before.favorite_brands ?? [];
    const next = list.includes(brandId) ? list.filter(id => id !== brandId) : [...list, brandId];
    this.prefs.set({ ...before, favorite_brands: next });
    return this.save({ favorite_brands: next }).pipe(
      tap({ error: () => this.prefs.set(before) })
    );
  }

  /**
   * Предпочтения ещё не загружены или загрузка упала. Отправить список из одного
   * сорта нельзя: он заменил бы на сервере все любимые. Сначала читаем настоящий
   * список. Сердечко без предпочтений всегда пустое, значит гость добавляет сорт:
   * если он уже в списке, ничего не пишем, только показываем загруженное.
   */
  private addFavoriteUnloaded(brandId: string): Observable<UserPreferences> {
    return this.api.getPreferences().pipe(
      tap(p => this.prefs.set(p)),
      switchMap(p => {
        const list = p.favorite_brands ?? [];
        return list.includes(brandId) ? of(p) : this.save({ favorite_brands: [...list, brandId] });
      })
    );
  }

  /** Сколько шкал вкуса заполнено. */
  readonly tasteCount = computed(() => Object.keys(this.prefs()?.taste ?? {}).length);

  /**
   * Сорта, ближе всего к вкусу пользователя. Шкалы, которые он оставил
   * пустыми, не учитываются; без единой шкалы список пуст.
   */
  match(brands: Brand[], limit = 3): BrandMatch[] {
    if (!this.hasTaste()) return [];
    return brands
      .map(brand => ({ brand, percent: this.percentFor(brand) ?? 0 }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, limit);
  }
}
