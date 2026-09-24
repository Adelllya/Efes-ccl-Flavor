import { Component, ElementRef, EventEmitter, Input, OnInit, Output, computed, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dish, FoodIcon } from '../../models/flavor-tree.models';
import {
  CATEGORIES, COOKING, TASTES, WEIGHTS, FATS,
  DishProfile, WizardOption, emptyProfile, findDish,
} from './pairing-engine.data';

interface StepDef {
  key: keyof DishProfile;
  title: string;
  accent: string;
  sub: string;
  options: WizardOption[];
  /** Первый шаг нельзя пропустить: без категории подбирать не от чего. */
  skippable: boolean;
}

const STEPS: StepDef[] = [
  { key: 'category', title: 'Что ты', accent: 'ешь?', sub: 'Выбери категорию блюда', options: CATEGORIES, skippable: false },
  { key: 'cooking', title: 'Как это', accent: 'приготовлено?', sub: 'Огонь, пар или сырое - способ меняет вкус сильнее, чем кажется', options: COOKING, skippable: true },
  { key: 'taste', title: 'Какой вкус', accent: 'главный?', sub: 'Тот, что чувствуется первым, ещё до остальных', options: TASTES, skippable: true },
  { key: 'weight', title: 'Насколько', accent: 'сытное?', sub: 'От веса блюда зависит плотность сорта - лёгкое к лёгкому, тяжёлое к тяжёлому', options: WEIGHTS, skippable: true },
];

/** Какому типу картинок из админки соответствует шаг мастера. */
const STEP_KIND: Record<string, string> = {
  category: 'CATEGORY', cooking: 'COOKING', taste: 'TASTE', weight: 'WEIGHT',
};

/**
 * Мастер подбора по блюду: четыре вопроса вместо списка из полусотни позиций.
 * Человек может не помнить название блюда из меню, но всегда знает, мясо это
 * или рыба, жарили это или варили и тяжело ли будет после тарелки.
 */
@Component({
  selector: 'app-dish-wizard',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="wiz">
      <div class="wiz-head">
        <button type="button" class="wiz-back" (click)="back()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Назад
        </button>

        <nav class="wiz-bar" aria-label="Шаги подбора">
          @for (s of steps; track s.key; let i = $index) {
            <button
              type="button"
              class="wiz-seg"
              [class.on]="i === index()"
              [class.done]="i < index()"
              [disabled]="i > index()"
              [attr.aria-current]="i === index() ? 'step' : null"
              [attr.aria-label]="'Шаг ' + (i + 1) + ': ' + s.sub"
              (click)="goTo(i)"
            ></button>
          }
        </nav>

        <span class="wiz-step" aria-live="polite">Шаг {{ index() + 1 }} из {{ steps.length }}</span>
      </div>

      <header class="wiz-ask">
        <h2 class="section-header">{{ step().title }} <span class="wiz-accent">{{ step().accent }}</span></h2>
        <p class="section-subtitle">{{ step().sub }}</p>
      </header>

      @if (chosen().length) {
        <div class="wiz-picked" aria-label="Ваши ответы">
          @for (c of chosen(); track c.key) {
            <button type="button" class="wiz-chip" (click)="goTo(c.step)" [attr.aria-label]="'Изменить: ' + c.label">
              <span aria-hidden="true">{{ c.emoji }}</span>{{ c.label }}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
          }
        </div>
      }

      <div class="wiz-opts" role="radiogroup" [attr.aria-label]="step().sub" (keydown)="onArrows($event)" #grid>
        @for (o of step().options; track o.id; let i = $index) {
          <button
            type="button"
            class="wiz-opt"
            role="radio"
            [class.on]="value(step().key) === o.id"
            [attr.aria-checked]="value(step().key) === o.id"
            [style.--i]="i"
            (click)="choose(o.id)"
          >
            <span class="wiz-circle">
              <span class="wiz-face">
                @if (picture(o.id); as src) {
                  <img [src]="src" alt="" loading="lazy" />
                } @else {
                  <span class="wiz-emoji" aria-hidden="true">{{ o.emoji }}</span>
                }
              </span>

              <span class="wiz-check" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            </span>
            <span class="wiz-label">{{ o.label }}</span>
            @if (o.hint) { <span class="wiz-hint">{{ o.hint }}</span> }
          </button>
        }
      </div>

      @if (isLast() && profile().weight) {
        <div class="wiz-extra">
          <p class="wiz-extra-title">Насколько блюдо жирное?</p>
          <div class="wiz-fats">
            @for (f of fats; track f.id) {
              <button type="button" class="wiz-fat" [class.on]="profile().fat === f.id" (click)="setFat(f.id)">
                {{ f.label }}
              </button>
            }
          </div>
        </div>
      }

      @if (index() === 0) {
        <div class="wiz-or"><span>или напиши своё</span></div>

        <form class="wiz-free" (ngSubmit)="submitFree()">
          <div class="wiz-field">
            <label class="sr-only" for="wiz-dish">Название блюда</label>
            <svg class="wiz-find-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              id="wiz-dish"
              class="input wiz-input"
              type="text"
              name="dish"
              autocomplete="off"
              placeholder="Например: стейк рибай, том ям, тирамису…"
              [ngModel]="query()"
              (ngModelChange)="query.set($event)"
            />

            @if (suggestions().length) {
              <ul class="wiz-hints" role="listbox" aria-label="Блюда из каталога">
                @for (d of suggestions(); track d.id) {
                  <li>
                    <button type="button" role="option" [attr.aria-selected]="false" (click)="pickExact(d)">
                      <span class="font-bold">{{ d.name }}</span>
                      <span class="text-xs text-muted">{{ d.cuisine_display || d.cuisine }} · {{ d.weight_display || d.weight }}</span>
                    </button>
                  </li>
                }
              </ul>
            }
          </div>

          <button type="submit" class="btn-amber wiz-go" [disabled]="query().trim().length < 2">
            Подобрать
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
          </button>
        </form>
      }

      <div class="wiz-acts">
        @if (step().skippable && !isLast()) {
          <button type="button" class="btn-ghost" (click)="skip()">Не знаю, пропустить</button>
        }
        @if (isLast()) {
          <button type="button" class="btn-amber" (click)="finish()">
            Подобрать пиво
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .wiz { display: flex; flex-direction: column; align-items: center; text-align: center; }

    /* ── Шапка мастера ── */
    .wiz-head {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-md);
      width: 100%;
      margin-bottom: var(--space-2xl);
    }

    .wiz-back {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      padding: 0 14px;
      border: none;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--foam-dim);
      font-family: var(--font-body);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: background var(--duration-fast) ease, color var(--duration-fast) ease;
    }
    .wiz-back:hover { color: var(--beer-mid); background: var(--beer-glow); }

    .wiz-bar { display: flex; gap: var(--space-sm); }

    .wiz-seg {
      width: clamp(44px, 9vw, 86px);
      height: 7px;
      padding: 0;
      border: none;
      border-radius: var(--radius-full);
      background: rgba(180, 83, 9, 0.16);
      cursor: pointer;
      transition: background var(--duration-normal) ease, transform var(--duration-normal) var(--ease-out);
    }
    .wiz-seg.done { background: rgba(180, 83, 9, 0.4); }
    .wiz-seg.done:hover { transform: scaleY(1.5); }
    .wiz-seg.on { background: linear-gradient(90deg, var(--beer-accent), var(--beer-mid)); }
    .wiz-seg:disabled { cursor: default; }

    .wiz-step {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
    }

    /* ── Вопрос ── */
    .wiz-ask { margin-bottom: var(--space-2xl); animation: wizRise var(--duration-slow) var(--ease-out) both; }
    .wiz-ask .section-header { margin-bottom: var(--space-sm); }
    .wiz-ask .section-subtitle { max-width: 54ch; margin: 0 auto; text-wrap: balance; }

    .wiz-accent {
      background: linear-gradient(120deg, var(--beer-light), var(--beer-deep));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    @keyframes wizRise {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: none; }
    }

    /* ── Уже данные ответы ── */
    .wiz-picked { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-sm); margin-bottom: var(--space-xl); }

    .wiz-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 36px;
      padding: 0 14px;
      border-radius: var(--radius-full);
      border: 1.5px solid rgba(180, 83, 9, 0.28);
      background: var(--beer-glow);
      color: var(--beer-deep);
      font-family: var(--font-body);
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      transition: background var(--duration-fast) ease;
    }
    .wiz-chip svg { opacity: 0.55; }
    .wiz-chip:hover { background: rgba(245, 158, 11, 0.24); }

    /* ── Круги вариантов ── */
    .wiz-opts {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--space-2xl) var(--space-lg);
      width: 100%;
      max-width: 940px;
      margin-bottom: var(--space-2xl);
    }

    .wiz-opt {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-sm);
      width: clamp(104px, 15vw, 152px);
      padding: 0;
      background: none;
      border: none;
      color: var(--foam);
      cursor: pointer;
      animation: wizPop 420ms var(--ease-out) both;
      animation-delay: calc(var(--i, 0) * 45ms);
    }

    @keyframes wizPop {
      from { opacity: 0; transform: translateY(12px) scale(0.94); }
      to   { opacity: 1; transform: none; }
    }

    /* Обёртка без обрезки: в ней живёт отметка выбора, поэтому она
       не упирается в край круга. */
    .wiz-circle { position: relative; display: block; width: clamp(88px, 11.5vw, 122px); }

    .wiz-face {
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 1;
      border-radius: 50%;
      background: var(--glass-strong);
      border: 1.5px solid var(--line);
      box-shadow: var(--shadow-warm);
      overflow: hidden;
      transition: transform var(--duration-normal) var(--ease-spring),
                  box-shadow var(--duration-normal) ease,
                  border-color var(--duration-normal) ease;
    }
    .wiz-face img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--duration-normal) var(--ease-spring); }

    .wiz-emoji { font-size: clamp(2.1rem, 4.4vw, 2.9rem); line-height: 1; transition: transform var(--duration-normal) var(--ease-spring); }

    .wiz-opt:hover .wiz-circle { transform: translateY(-7px); }
    .wiz-opt:hover .wiz-face { border-color: rgba(180, 83, 9, 0.32); box-shadow: var(--shadow-hover); }
    .wiz-opt:hover .wiz-emoji { transform: scale(1.14) rotate(-7deg); }
    .wiz-opt:hover .wiz-face img { transform: scale(1.09); }
    .wiz-opt:active .wiz-circle { transform: translateY(-2px) scale(0.97); }

    .wiz-circle { transition: transform var(--duration-normal) var(--ease-spring); }

    .wiz-opt.on .wiz-circle { transform: translateY(-7px); }
    .wiz-opt.on .wiz-face {
      border-color: var(--beer-accent);
      box-shadow: var(--shadow-glow), var(--shadow-md);
    }

    /* Отметка выбора сидит на краю круга целиком, а не наполовину в нём. */
    .wiz-check {
      position: absolute;
      right: -6px;
      bottom: -2px;
      z-index: 2;
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: linear-gradient(155deg, var(--beer-accent), var(--beer-mid));
      border: 2.5px solid var(--bg-0);
      color: #fff;
      box-shadow: 0 4px 12px rgba(180, 83, 9, 0.35);
      opacity: 0;
      transform: scale(0.4);
      transition: opacity var(--duration-fast) ease, transform var(--duration-normal) var(--ease-spring);
    }
    .wiz-opt.on .wiz-check { opacity: 1; transform: scale(1); }

    .wiz-label { font-family: var(--font-body); font-size: 0.9rem; font-weight: 700; line-height: 1.25; color: var(--foam-dim); }
    .wiz-opt.on .wiz-label { color: var(--beer-deep); }

    .wiz-hint {
      min-height: 2.7em;
      font-size: 0.72rem;
      line-height: 1.35;
      color: var(--muted);
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease;
    }
    .wiz-opt:hover .wiz-hint, .wiz-opt:focus-visible .wiz-hint, .wiz-opt.on .wiz-hint { opacity: 1; transform: none; }

    /* ── Жирность ── */
    .wiz-extra { margin-bottom: var(--space-2xl); }
    .wiz-extra-title {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: var(--space-md);
    }
    .wiz-fats { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-sm); }

    .wiz-fat {
      min-height: 40px;
      padding: 0 18px;
      border-radius: var(--radius-full);
      border: 1.5px solid var(--line);
      background: var(--glass);
      color: var(--foam-dim);
      font-family: var(--font-body);
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--duration-normal) ease;
    }
    .wiz-fat:hover { border-color: rgba(180, 83, 9, 0.3); color: var(--foam); }
    .wiz-fat.on {
      background: linear-gradient(155deg, var(--beer-accent), var(--beer-mid));
      border-color: transparent;
      color: #fff;
      font-weight: 700;
    }

    /* ── Свободный ввод ── */
    .wiz-or {
      display: flex;
      align-items: center;
      gap: var(--space-lg);
      width: min(620px, 100%);
      margin-bottom: var(--space-lg);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .wiz-or::before, .wiz-or::after {
      content: '';
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(180, 83, 9, 0.22), transparent);
    }

    .wiz-free { display: flex; gap: var(--space-md); width: min(620px, 100%); }
    .wiz-field { position: relative; flex: 1; }
    .wiz-find-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
    .wiz-input { padding-left: 44px; height: 52px; }
    .wiz-go { flex-shrink: 0; }

    .wiz-hints {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 6px);
      z-index: 20;
      margin: 0;
      padding: 6px;
      list-style: none;
      background: #fff;
      border: 1.5px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
    }
    .wiz-hints button {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      width: 100%;
      padding: 9px 14px;
      background: none;
      border: none;
      border-radius: var(--radius-sm);
      color: var(--foam);
      text-align: left;
      cursor: pointer;
    }
    .wiz-hints button:hover { background: var(--beer-glow); }

    .wiz-acts { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-md); margin-top: var(--space-2xl); }

    @media (max-width: 620px) {
      .wiz-opts { gap: var(--space-lg) var(--space-md); }
      .wiz-opt { width: calc((100% - 2 * var(--space-md)) / 3); }
      .wiz-circle { width: min(100%, 104px); }
      .wiz-label { font-size: 0.8rem; }
      .wiz-hint { display: none; }
      .wiz-free { flex-direction: column; }
      .wiz-back { align-self: center; }
    }

    @media (prefers-reduced-motion: reduce) {
      .wiz-opt, .wiz-ask { animation: none; }
    }
  `],
})
export class DishWizardComponent implements OnInit {
  /** Каталог блюд - нужен для подсказок в свободном вводе. */
  @Input() dishes: Dish[] = [];
  /** Картинки вариантов из админки. Пусто - на кружках остаются emoji. */
  @Input() icons: FoodIcon[] = [];
  /** Ответы прошлого прохода: с ними «назад» из результата не теряет выбор. */
  @Input() restore: DishProfile | null = null;

  @Output() done = new EventEmitter<DishProfile>();
  @Output() dishPicked = new EventEmitter<Dish>();
  @Output() exit = new EventEmitter<void>();

  readonly steps = STEPS;
  readonly fats = FATS;

  private gridRef = viewChild<ElementRef<HTMLElement>>('grid');

  index = signal(0);
  profile = signal<DishProfile>(emptyProfile());
  query = signal('');

  step = computed(() => this.steps[this.index()]);
  isLast = computed(() => this.index() === this.steps.length - 1);

  suggestions = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (q.length < 2) return [];
    return this.dishes.filter(d => d.name.toLowerCase().includes(q)).slice(0, 5);
  });

  chosen = computed(() => {
    const p = this.profile();
    const out: { key: string; step: number; emoji: string; label: string }[] = [];
    this.steps.forEach((s, i) => {
      if (i >= this.index()) return;
      const v = p[s.key] as string | null;
      if (!v) return;
      const o = s.options.find(x => x.id === v);
      if (o) out.push({ key: s.key, step: i, emoji: o.emoji, label: o.label });
    });
    return out;
  });

  ngOnInit(): void {
    if (!this.restore) return;
    this.profile.set({ ...this.restore });
    this.index.set(this.steps.length - 1);
  }

  value(key: keyof DishProfile): string | null {
    return this.profile()[key] as string | null;
  }

  /** Картинка варианта берётся по типу текущего шага. */
  picture(id: string): string | null {
    const kind = STEP_KIND[this.step().key as string];
    if (!kind) return null;
    return this.icons.find(i => i.kind === kind && i.key === id)?.image ?? null;
  }

  choose(id: string): void {
    this.profile.update(p => ({ ...p, [this.step().key]: id }));
    // На промежуточных шагах ведём дальше сами: выбор виден, ждать нечего.
    if (!this.isLast()) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => this.next(), reduce ? 0 : 260);
    }
  }

  setFat(id: string): void {
    this.profile.update(p => ({ ...p, fat: p.fat === id ? null : (id as DishProfile['fat']) }));
  }

  skip(): void {
    this.profile.update(p => ({ ...p, [this.step().key]: null }));
    this.next();
  }

  next(): void {
    if (this.isLast()) { this.finish(); return; }
    this.index.update(i => i + 1);
    this.focusGrid();
  }

  back(): void {
    if (this.index() === 0) { this.exit.emit(); return; }
    this.index.update(i => i - 1);
    this.focusGrid();
  }

  goTo(i: number): void {
    if (i > this.index()) return;
    this.index.set(i);
    this.focusGrid();
  }

  finish(): void {
    this.done.emit(this.profile());
  }

  submitFree(): void {
    const text = this.query().trim();
    if (text.length < 2) return;

    const exact = findDish(this.dishes, text);
    if (exact) { this.pickExact(exact); return; }

    // Блюда нет в каталоге - запоминаем название и уточняем его вручную.
    this.profile.update(p => ({ ...p, freeText: text }));
    this.next();
  }

  pickExact(dish: Dish): void {
    this.query.set('');
    this.dishPicked.emit(dish);
  }

  /** Стрелки внутри группы вариантов - как в обычной радиогруппе. */
  onArrows(event: KeyboardEvent): void {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const grid = this.gridRef()?.nativeElement;
    if (!grid) return;
    const items = Array.from(grid.querySelectorAll<HTMLButtonElement>('.wiz-opt'));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    items[(at + (forward ? 1 : -1) + items.length) % items.length].focus();
  }

  private focusGrid(): void {
    queueMicrotask(() => {
      this.gridRef()?.nativeElement.querySelector<HTMLButtonElement>('.wiz-opt')?.focus({ preventScroll: true });
    });
  }
}
