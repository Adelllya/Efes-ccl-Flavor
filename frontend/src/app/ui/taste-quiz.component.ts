import { Component, DestroyRef, ElementRef, EventEmitter, Output, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../services/api.service';
import { AuthService } from '../services/auth.service';
import { BrandMatch, PreferencesService, TASTE_SCALES, Taste, matchLabel } from '../services/preferences.service';
import { Brand, TasteKey } from '../models/flavor-tree.models';

interface QuizOption {
  label: string;
  value: number;
}

interface QuizQuestion {
  key: TasteKey;
  text: string;
  options: QuizOption[];
}

/**
 * Шесть бытовых вопросов вместо шести ползунков: гость не обязан знать, что такое
 * «тело» или «обжарка». Каждый ответ ставит одну шкалу вкуса от 0 до 10.
 */
const QUESTIONS: QuizQuestion[] = [
  { key: 'bitterness', text: 'Какой кофе вам ближе?', options: [
    { label: 'Чёрный без сахара', value: 8 },
    { label: 'С молоком', value: 5 },
    { label: 'Сладкий латте или вообще не пью: горько', value: 2 },
  ] },
  { key: 'sweetness', text: 'Сколько сахара кладёте в чай?', options: [
    { label: 'Пью без сахара', value: 2 },
    { label: 'Одну ложку', value: 5 },
    { label: 'Две и больше', value: 8 },
  ] },
  { key: 'body', text: 'Что закажете на обед?', options: [
    { label: 'Лёгкий салат', value: 3 },
    { label: 'Суп и что-нибудь к нему', value: 5 },
    { label: 'Мясо с гарниром, чтобы наесться', value: 8 },
  ] },
  { key: 'freshness', text: 'Жаркий день. Что возьмёте?', options: [
    { label: 'Газировку со льдом', value: 9 },
    { label: 'Холодный чай или морс', value: 6 },
    { label: 'Тёплый чай, как обычно', value: 3 },
  ] },
  { key: 'roast', text: 'Какая корочка у хлеба вам нравится?', options: [
    { label: 'Мягкая и светлая', value: 1 },
    { label: 'Золотистая', value: 4 },
    { label: 'Тёмная, как у бородинского', value: 7 },
  ] },
  { key: 'strength', text: 'Вечером с друзьями выбираете напиток...', options: [
    { label: 'Полегче', value: 3 },
    { label: 'Обычной крепости', value: 5 },
    { label: 'Покрепче', value: 8 },
  ] },
];

/** Короткое описание вкуса словами: по самым выраженным шкалам. */
function describe(taste: Taste): string {
  const parts: string[] = [];
  const v = (key: TasteKey) => taste[key];
  if ((v('bitterness') ?? 5) >= 7) parts.push('с заметной горчинкой');
  if ((v('bitterness') ?? 5) <= 3) parts.push('мягкие, без горечи');
  if ((v('freshness') ?? 5) >= 7) parts.push('свежие и газированные');
  if ((v('body') ?? 5) >= 7) parts.push('плотные');
  if ((v('body') ?? 5) <= 3) parts.push('лёгкие');
  if ((v('sweetness') ?? 5) >= 7) parts.push('с солодовой сладостью');
  if ((v('roast') ?? 3) >= 6) parts.push('с карамелью и тёмной корочкой');
  if ((v('strength') ?? 5) >= 7) parts.push('покрепче');
  if ((v('strength') ?? 5) <= 3) parts.push('некрепкие');
  return parts.length ? parts.slice(0, 3).join(', ') : 'сбалансированные, без крайностей';
}

/**
 * Опрос вкуса за минуту и результат: шесть шкал и три самых близких сорта.
 * Работает без входа: ответы хранятся в браузере и переезжают в аккаунт при входе.
 */
@Component({
  selector: 'app-taste-quiz',
  standalone: true,
  template: `
    <dialog #dlg class="tq" aria-labelledby="tq-title" (cancel)="onCancel($event)" (click)="onBackdrop($event)">
      @if (opened()) {
        <div class="tq-box">
          <header class="tq-head">
            <div class="tq-head-text">
              <span class="tq-kicker">Вкусовой профиль</span>
              <h2 id="tq-title" class="tq-title">{{ done() ? 'Ваш вкус' : 'Шесть вопросов о привычках' }}</h2>
            </div>
            <button type="button" class="btn-ghost tq-close" (click)="close()" aria-label="Закрыть" autofocus>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </header>

          @if (!done()) {
            <div class="tq-bar" role="progressbar" aria-label="Прогресс опроса" [attr.aria-valuenow]="index() + 1" aria-valuemin="1" [attr.aria-valuemax]="questions.length">
              <span [style.width.%]="(index() + 1) * 100 / questions.length"></span>
            </div>
          }

          <div class="tq-body">
            @if (!done()) {
              @let q = questions[index()];
              <p class="tq-count">Вопрос {{ index() + 1 }} из {{ questions.length }}</p>
              <h3 class="tq-q" id="tq-q">{{ q.text }}</h3>
              <div class="tq-options" role="radiogroup" aria-labelledby="tq-q">
                @for (opt of q.options; track opt.value) {
                  <button type="button" class="tq-option" role="radio" [class.chosen]="answers()[q.key] === opt.value"
                          [attr.aria-checked]="answers()[q.key] === opt.value" (click)="choose(q.key, opt.value)">
                    <span class="tq-dot" aria-hidden="true"></span>{{ opt.label }}
                  </button>
                }
              </div>
              <p class="tq-hint">Про пиво спрашивать не будем: вкус виден по привычкам.</p>
            } @else {
              <p class="tq-summary">Вам ближе сорта: <b>{{ summary() }}</b>.</p>
              <ul class="tq-scales" aria-label="Шкалы вкуса">
                @for (s of scales; track s.key) {
                  <li>
                    <span class="tq-scale-name">{{ s.label }}</span>
                    <span class="tq-scale-bar" aria-hidden="true"><span [style.width.%]="(answers()[s.key] ?? 0) * 10"></span></span>
                    <span class="tq-scale-word">{{ word(s.key) }}</span>
                  </li>
                }
              </ul>

              <h3 class="tq-h3">Начните с этих сортов</h3>
              @if (!brandsLoaded()) {
                <div class="tq-loading" aria-busy="true"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
              } @else if (!matches().length) {
                <p class="tq-hint">Каталог сейчас недоступен. Совпадение появится на страницах сортов.</p>
              } @else {
                <ul class="tq-matches">
                  @for (m of matches(); track m.brand.id) {
                    <li>
                      <button type="button" class="tq-match" (click)="pick(m.brand)">
                        <span class="tq-match-img">
                          @if (m.brand.image) { <img [src]="m.brand.image" alt="" loading="lazy" /> }
                        </span>
                        <span class="tq-match-body">
                          <b>{{ m.brand.name }}</b>
                          <small>{{ m.brand.style }}</small>
                        </span>
                        <span class="tq-match-pct"><b>{{ m.percent }}%</b><small>{{ label(m.percent) }}</small></span>
                      </button>
                    </li>
                  }
                </ul>
              }
              @if (!auth.isLoggedIn()) {
                <p class="tq-hint">Профиль сохранён на этом устройстве. Войдите, и он переедет в ваш аккаунт.</p>
              }
            }
          </div>

          <footer class="tq-foot">
            @if (!done()) {
              <button type="button" class="btn-outline" [disabled]="index() === 0" (click)="index.set(index() - 1)">Назад</button>
              <button type="button" class="btn-amber" [disabled]="answers()[questions[index()].key] === undefined" (click)="next()">
                {{ index() < questions.length - 1 ? 'Дальше' : 'Показать мой вкус' }}
              </button>
            } @else {
              <button type="button" class="btn-outline" (click)="restart()">Пройти заново</button>
              <button type="button" class="btn-amber" (click)="finish()">Весь каталог по совпадению</button>
            }
          </footer>
        </div>
      }
    </dialog>
  `,
  styles: [`
    .tq {
      width: min(560px, calc(100vw - 32px));
      max-width: none;
      max-height: min(760px, calc(100dvh - 48px));
      margin: auto;
      padding: 0;
      border: none;
      border-radius: var(--radius-2xl);
      background: var(--bg-1);
      color: var(--foam);
      box-shadow: 0 30px 80px -20px rgba(28, 25, 23, 0.45);
      overflow: hidden;
    }
    .tq[open] { display: flex; animation: tqIn 240ms var(--ease-out); }
    .tq:focus { outline: none; }
    .tq::backdrop { background: rgba(28, 25, 23, 0.55); backdrop-filter: blur(4px); }
    @keyframes tqIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    .tq-box { display: flex; flex-direction: column; width: 100%; min-height: 0; }
    .tq-head { display: flex; align-items: flex-start; gap: var(--space-md); padding: var(--space-xl) var(--space-2xl) var(--space-lg); border-bottom: 1px solid var(--line); }
    .tq-head-text { flex: 1; min-width: 0; }
    .tq-kicker { display: block; margin-bottom: 4px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--beer-mid); }
    .tq-title { margin: 0; font-family: var(--font-heading); font-size: clamp(1.2rem, 3.6vw, 1.5rem); font-weight: 800; line-height: 1.2; }
    .tq-close { flex-shrink: 0; width: 44px; height: 44px; display: grid; place-content: center; border-radius: 50%; }
    .tq-bar { height: 6px; background: rgba(180, 83, 9, 0.12); }
    .tq-bar span { display: block; height: 100%; background: var(--grad-cta); border-radius: 0 6px 6px 0; transition: width 300ms var(--ease-out); }
    .tq-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-xl) var(--space-2xl); }
    .tq-foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-md); padding: var(--space-lg) var(--space-2xl); padding-bottom: max(var(--space-lg), env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--bg-0); }
    .tq-foot .btn-amber, .tq-foot .btn-outline { min-height: 44px; }
    .tq-count { margin: 0 0 var(--space-sm); font-size: 0.8125rem; font-weight: 700; color: var(--muted); }
    .tq-q { margin: 0 0 var(--space-xl); font-family: var(--font-heading); font-size: clamp(1.15rem, 3.4vw, 1.4rem); line-height: 1.3; }
    .tq-options { display: grid; gap: var(--space-sm); }
    .tq-option { display: flex; align-items: center; gap: var(--space-md); width: 100%; min-height: 56px; padding: 12px 16px; border: 1.5px solid var(--line); border-radius: var(--radius-lg); background: var(--bg-1); color: var(--foam); font: inherit; line-height: 1.4; text-align: left; cursor: pointer; transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease; }
    .tq-option:hover { border-color: var(--beer-light); background: #FFF9EF; }
    .tq-option:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .tq-option.chosen { border-color: var(--beer-mid); background: #FFF4DF; font-weight: 600; }
    .tq-dot { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(180, 83, 9, 0.4); background: #fff; }
    .tq-option.chosen .tq-dot { border: 6px solid var(--beer-mid); }
    .tq-hint { margin: var(--space-lg) 0 0; font-size: 0.8125rem; line-height: 1.5; color: var(--muted); }
    .tq-summary { margin: 0 0 var(--space-lg); font-size: 1.0625rem; line-height: 1.55; color: var(--foam-dim); }
    .tq-summary b { color: var(--foam); }
    .tq-scales { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .tq-scales li { display: grid; grid-template-columns: 96px minmax(0, 1fr) 108px; align-items: center; gap: var(--space-md); font-size: 0.875rem; }
    .tq-scale-name { font-weight: 700; }
    .tq-scale-bar { height: 8px; border-radius: var(--radius-full); background: rgba(180, 83, 9, 0.12); overflow: hidden; }
    .tq-scale-bar span { display: block; height: 100%; border-radius: inherit; background: var(--beer-light); }
    .tq-scale-word { color: var(--muted); text-align: right; }
    .tq-h3 { margin: var(--space-xl) 0 var(--space-md); font-family: var(--font-heading); font-size: 1.05rem; font-weight: 800; }
    .tq-loading { display: grid; gap: var(--space-md); }
    .tq-matches { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-sm); }
    .tq-match { width: 100%; display: flex; align-items: center; gap: var(--space-md); min-height: 64px; padding: 8px 14px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--bg-0); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .tq-match:hover { border-color: var(--beer-light); }
    .tq-match:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .tq-match-img { flex-shrink: 0; width: 36px; height: 48px; display: grid; place-content: center; }
    .tq-match-img img { max-width: 36px; max-height: 48px; object-fit: contain; }
    .tq-match-body { flex: 1; min-width: 0; display: grid; }
    .tq-match-body small { color: var(--muted); }
    .tq-match-pct { flex-shrink: 0; display: grid; justify-items: end; }
    .tq-match-pct b { font-family: var(--font-heading); font-size: 1.2rem; color: var(--beer-deep); font-variant-numeric: tabular-nums; }
    .tq-match-pct small { font-size: 0.75rem; color: var(--muted); }

    @media (max-width: 600px) {
      .tq { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; }
      .tq-head { padding: var(--space-lg) var(--space-lg) var(--space-md); }
      .tq-body { padding: var(--space-lg); }
      .tq-foot { padding: var(--space-md) var(--space-lg); padding-bottom: max(var(--space-md), env(safe-area-inset-bottom)); }
      .tq-foot .btn-amber, .tq-foot .btn-outline { flex: 1 1 140px; justify-content: center; }
      .tq-scales li { grid-template-columns: 84px minmax(0, 1fr) 92px; gap: var(--space-sm); }
    }
    @media (prefers-reduced-motion: reduce) {
      .tq[open] { animation: none; }
      .tq-bar span { transition: none; }
    }
  `],
})
export class TasteQuizComponent {
  private api = inject(ApiService);
  private destroyRef = inject(DestroyRef);
  private prefs = inject(PreferencesService);
  readonly auth = inject(AuthService);

  /** Гость выбрал сорт из результата: родитель открывает его страницу. */
  @Output() openBrand = new EventEmitter<string>();
  /** Опрос закончен, гость хочет увидеть каталог по совпадению. */
  @Output() finished = new EventEmitter<void>();

  private dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  readonly questions = QUESTIONS;
  readonly scales = TASTE_SCALES;
  readonly label = matchLabel;

  readonly opened = signal(false);
  readonly index = signal(0);
  readonly answers = signal<Taste>({});
  readonly done = signal(false);
  readonly brands = signal<Brand[]>([]);
  readonly brandsLoaded = signal(false);

  readonly summary = computed(() => describe(this.answers()));
  readonly matches = computed<BrandMatch[]>(() => this.done() ? this.prefs.match(this.brands(), 3) : []);

  open() {
    this.opened.set(true);
    this.index.set(0);
    this.done.set(false);
    this.answers.set({});
    queueMicrotask(() => {
      const dialog = this.dlg()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    });
    if (!this.brandsLoaded()) {
      this.api.getBrandsStrict().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: list => { this.brands.set(list.filter(b => b.is_active !== false)); this.brandsLoaded.set(true); },
        error: () => this.brandsLoaded.set(true),
      });
    }
  }

  choose(key: TasteKey, value: number) {
    this.answers.update(a => ({ ...a, [key]: value }));
  }

  next() {
    if (this.index() < QUESTIONS.length - 1) {
      this.index.set(this.index() + 1);
      return;
    }
    this.prefs.setTaste(this.answers());
    this.done.set(true);
  }

  restart() {
    this.index.set(0);
    this.answers.set({});
    this.done.set(false);
  }

  /** Словами, где ответ стоит на шкале: «лёгкое», «посередине», «плотное». */
  word(key: TasteKey): string {
    const scale = TASTE_SCALES.find(s => s.key === key);
    const value = this.answers()[key];
    if (!scale || value === undefined) return '';
    return value <= 3 ? scale.low : value >= 7 ? scale.high : 'посередине';
  }

  pick(brand: Brand) {
    this.close();
    this.openBrand.emit(brand.id);
  }

  finish() {
    this.close();
    this.finished.emit();
  }

  close() {
    const dialog = this.dlg()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.opened.set(false);
  }

  onCancel(event: Event) {
    event.preventDefault();
    this.close();
  }

  onBackdrop(event: MouseEvent) {
    if (event.target === this.dlg()?.nativeElement) this.close();
  }
}
