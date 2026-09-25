import {
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  AfterViewInit,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';

type DiscoveryMode = 'dish' | 'brand';

interface RisingBubble {
  id: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
}

interface HeroPill {
  id: string;
  label: string;
  icon: 'beer' | 'pyramid' | 'sparkle' | 'book';
}

/**
 * Hero «Что выберешь сегодня?» - первая секция главной страницы.
 * Дизайн: fjisk.html (тёплый янтарный glassmorphism), реализация по
 * правилам ui-ux-pro-max: SVG вместо эмодзи, семантические токены,
 * видимый фокус, reduced-motion, тач-цели ≥44px.
 */
@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  template: `
    <!-- Боковые «пузыри» появляются при скролле (только desktop) -->
    <div class="side-beers side-beers--left" aria-hidden="true">
      @for (i of [0, 1, 2]; track i) {
        <div class="side-beer" [class.visible]="sideVisible()[i]" [style.transform]="sideTransform()[i]">
          <ng-container *ngTemplateOutlet="beerIcon"></ng-container>
        </div>
      }
    </div>
    <div class="side-beers side-beers--right" aria-hidden="true">
      @for (i of [0, 1, 2]; track i) {
        <div class="side-beer" [class.visible]="sideVisible()[i]" [style.transform]="sideTransform()[i + 3]">
          <ng-container *ngTemplateOutlet="beerIcon"></ng-container>
        </div>
      }
    </div>

    <section class="hero" aria-labelledby="hero-title">
      <h1 class="hero-title" id="hero-title" #heroTitle>
        Что выберешь <span class="hero-accent">сегодня?</span>
      </h1>

      <p class="hero-lede">
        FlavorTree - платформа сенсорного образования для пива. Мы раскладываем вкус
        каждого бренда на три слоя, как аромат в парфюмерии, и подбираем идеальное
        сочетание с едой.
      </p>

      <ul class="hero-pills" aria-label="Что есть на платформе">
        @for (pill of pills; track pill.id) {
          <li class="hero-pill">
            <span class="hero-pill-icon" aria-hidden="true">
              @switch (pill.icon) {
                @case ('beer') { <ng-container *ngTemplateOutlet="beerIcon"></ng-container> }
                @case ('pyramid') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 21h20L12 3Z"/><path d="M8.5 15h7"/><path d="M10 11h4"/></svg>
                }
                @case ('sparkle') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3Z"/><path d="M19 17v4"/><path d="M17 19h4"/><path d="M5 3v3"/><path d="M3.5 4.5h3"/></svg>
                }
                @case ('book') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
                }
              }
            </span>
            {{ pill.label }}
          </li>
        }
      </ul>

      <form class="hero-search" (submit)="submitSearch($event)" role="search">
        <label class="sr-only" for="hero-search-input">Введите блюдо для подбора пива</label>
        <svg class="hero-search-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input
          id="hero-search-input"
          class="hero-search-input"
          type="search"
          name="dish"
          autocomplete="off"
          enterkeyhint="search"
          placeholder="Введите блюдо (напр. Шашлык, Бешбармак…)"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
        />
        <button class="hero-search-btn" type="submit">
          Подобрать
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
        </button>
      </form>

      <div class="choices">
        <button
          #choice
          type="button"
          class="choice choice--left"
          [class.revealed]="revealed()"
          (click)="choose.emit('dish')"
          aria-describedby="choice-dish-desc"
        >
          <span class="choice-shine" aria-hidden="true"></span>
          <span class="choice-bubbles" aria-hidden="true">
            @for (b of cardBubblesLeft; track b.id) {
              <span
                class="card-bubble"
                [style.left.%]="b.left"
                [style.width.px]="b.size"
                [style.height.px]="b.size"
                [style.animationDuration.s]="b.duration"
                [style.animationDelay.s]="b.delay"
                [style.--drift]="b.drift + 'px'"
              ></span>
            }
          </span>
          <span class="choice-inner">
            <span class="choice-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
            </span>
            <span class="choice-title">У меня есть<br><em>блюдо</em></span>
            <span class="choice-desc" id="choice-dish-desc">Подберу пиво к еде по вкусовой пирамиде за 4 шага</span>
            <span class="choice-cta">Выбрать →</span>
          </span>
        </button>

        <button
          #choice
          type="button"
          class="choice choice--right"
          [class.revealed]="revealed()"
          (click)="choose.emit('brand')"
          aria-describedby="choice-beer-desc"
        >
          <span class="choice-shine" aria-hidden="true"></span>
          <span class="choice-bubbles" aria-hidden="true">
            @for (b of cardBubblesRight; track b.id) {
              <span
                class="card-bubble"
                [style.left.%]="b.left"
                [style.width.px]="b.size"
                [style.height.px]="b.size"
                [style.animationDuration.s]="b.duration"
                [style.animationDelay.s]="b.delay"
                [style.--drift]="b.drift + 'px'"
              ></span>
            }
          </span>
          <span class="choice-inner">
            <span class="choice-icon" aria-hidden="true">
              <ng-container *ngTemplateOutlet="beerIcon"></ng-container>
            </span>
            <span class="choice-title">У меня есть<br><em>пиво</em></span>
            <span class="choice-desc" id="choice-beer-desc">Покажу идеальные блюда и вкусовые мосты</span>
            <span class="choice-cta">Выбрать →</span>
          </span>
        </button>
      </div>

    </section>

    <ng-template #beerIcon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 8h1a4 4 0 1 1 0 8h-1"/>
        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>
        <line x1="6" x2="6" y1="2" y2="4"/>
        <line x1="10" x2="10" y1="2" y2="4"/>
        <line x1="14" x2="14" y1="2" y2="4"/>
      </svg>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    /* ── Hero */
    .hero {
      text-align: center;
      padding: var(--space-6xl) var(--space-lg) var(--space-4xl);
      position: relative;
      z-index: 1;
    }

    .hero-title {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: clamp(2.5rem, 6vw, 4.75rem);
      line-height: 1.05;
      letter-spacing: -0.03em;
      color: var(--foam);
      margin: 0 0 var(--space-2xl);
      text-wrap: balance;
    }

    .hero-accent {
      background: linear-gradient(120deg, var(--beer-light), var(--beer-deep));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .hero-lede {
      max-width: 660px;
      margin: 0 auto var(--space-3xl);
      font-size: 1.0625rem;
      line-height: 1.7;
      color: var(--foam-dim);
      font-weight: 500;
    }

    /* ── Pills */
    .hero-pills {
      list-style: none;
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: var(--space-sm) 10px;
      margin: 0 0 var(--space-4xl);
      padding: 0;
    }

    .hero-pill {
      display: inline-flex;
      align-items: center;
      gap: var(--space-sm);
      min-height: 44px;
      background: var(--bg-1);
      border: 1px solid var(--line);
      color: var(--foam);
      font-size: 0.85rem;
      font-weight: 600;
      padding: 0 var(--space-xl);
      border-radius: var(--radius-full);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03);
    }

    .hero-pill-icon {
      display: inline-flex;
      color: var(--beer-mid);
    }

    .hero-pill-icon svg { width: 16px; height: 16px; }

    /* ── Search */
    .hero-search {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      max-width: 620px;
      margin: 0 auto var(--space-6xl);
      background: var(--bg-1);
      border: 1.5px solid var(--line);
      border-radius: var(--radius-xl);
      padding: var(--space-sm) var(--space-sm) var(--space-sm) var(--space-lg);
      box-shadow: var(--shadow-md);
      transition: border-color var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
    }

    .hero-search:focus-within {
      border-color: var(--beer-light);
      box-shadow: var(--shadow-glow), var(--shadow-md);
    }

    .hero-search-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      color: var(--muted);
    }

    .hero-search-input {
      flex: 1;
      min-width: 0;
      min-height: 44px;
      background: transparent;
      border: none;
      outline: none;
      color: var(--foam);
      font-size: 1rem;
      font-family: inherit;
      font-weight: 500;
      padding: 0 var(--space-sm);
      text-overflow: ellipsis;
    }

    .hero-search-input::placeholder { color: var(--muted); }
    .hero-search-input::-webkit-search-cancel-button { -webkit-appearance: none; }

    .hero-search-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--space-sm);
      min-height: 44px;
      background: linear-gradient(150deg, var(--beer-accent), var(--beer-mid));
      color: #fff;
      border: none;
      border-radius: var(--radius-md);
      font-family: inherit;
      font-size: 0.92rem;
      font-weight: 700;
      padding: 0 var(--space-2xl);
      cursor: pointer;
      white-space: nowrap;
      box-shadow: 0 8px 20px -4px rgba(180, 83, 9, 0.4);
      transition: transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) ease;
    }

    .hero-search-btn svg { width: 16px; height: 16px; }
    .hero-search-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 24px -4px rgba(180, 83, 9, 0.5); }
    .hero-search-btn:active { transform: translateY(0); }

    /* ── Two choice bubbles */
    .choices {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 60px;
      max-width: 900px;
      margin: 0 auto var(--space-6xl);
      padding: var(--space-3xl) 0;
    }

    .choice {
      position: relative;
      width: 320px;
      height: 320px;
      border-radius: 50%;
      background: radial-gradient(circle at 34% 28%,
        rgba(255, 255, 255, 0.98) 0%,
        rgba(253, 243, 222, 0.92) 45%,
        rgba(245, 158, 11, 0.32) 75%,
        rgba(180, 83, 9, 0.16) 100%);
      border: 2px solid rgba(217, 119, 6, 0.38);
      box-shadow:
        0 20px 50px -10px rgba(217, 119, 6, 0.24),
        inset 0 -16px 32px rgba(180, 83, 9, 0.18),
        inset 0 12px 22px rgba(255, 255, 255, 0.95);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: var(--space-3xl);
      font-family: inherit;
      color: inherit;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      opacity: 0;
      transform: translateY(70px) scale(0.8);
      transition:
        transform 0.8s var(--ease-out),
        opacity 0.8s var(--ease-out),
        box-shadow var(--duration-slow) ease,
        border-color var(--duration-slow) ease;
    }

    .choice--right { transition-delay: 0.18s; }

    .choice:focus-visible {
      outline: 3px solid var(--beer-light);
      outline-offset: 6px;
    }

    .choice--left.revealed {
      opacity: 1;
      transform: translateY(-28px) scale(1);
      animation: floatLeft 4.5s ease-in-out infinite alternate 0.8s;
    }

    .choice--right.revealed {
      opacity: 1;
      transform: translateY(18px) scale(1);
      animation: floatRight 5s ease-in-out infinite alternate 0.8s;
    }

    @keyframes floatLeft {
      0%   { transform: translateY(-28px) rotate(0deg); }
      50%  { transform: translateY(-42px) rotate(-1.5deg); }
      100% { transform: translateY(-28px) rotate(0deg); }
    }

    @keyframes floatRight {
      0%   { transform: translateY(18px) rotate(0deg); }
      50%  { transform: translateY(32px) rotate(1.5deg); }
      100% { transform: translateY(18px) rotate(0deg); }
    }

    .choice:hover {
      border-color: var(--beer-mid);
      box-shadow:
        0 32px 65px -8px rgba(217, 119, 6, 0.4),
        inset 0 -20px 38px rgba(180, 83, 9, 0.28),
        inset 0 16px 28px rgba(255, 255, 255, 1);
    }

    .choice--left:hover  { transform: translateY(-48px) scale(1.07) !important; }
    .choice--right:hover { transform: translateY(6px) scale(1.07) !important; }

    .choice-shine {
      position: absolute;
      top: 10%;
      left: 18%;
      width: 48%;
      height: 24%;
      border-radius: 50%;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0));
      pointer-events: none;
      z-index: 2;
      transform: rotate(-24deg);
    }

    .choice-bubbles {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 1;
      overflow: hidden;
      border-radius: 50%;
    }

    .card-bubble {
      position: absolute;
      bottom: -30px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%,
        rgba(255, 255, 255, 0.95),
        rgba(245, 158, 11, 0.35) 50%,
        rgba(217, 119, 6, 0.08) 85%);
      border: 1px solid rgba(217, 119, 6, 0.3);
      box-shadow: 0 2px 10px rgba(245, 158, 11, 0.25);
      animation: cardRise cubic-bezier(0.4, 0, 0.6, 1) infinite;
      opacity: 0;
    }

    @keyframes cardRise {
      0%   { transform: translate(0, 0) scale(0.75); opacity: 0; }
      15%  { opacity: 0.9; }
      85%  { opacity: 0.6; }
      100% { transform: translate(var(--drift, 18px), -340px) scale(1.2); opacity: 0; }
    }

    .choice-inner {
      position: relative;
      z-index: 3;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .choice-icon {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, rgba(245, 158, 11, 0.4), rgba(255, 255, 255, 0.95));
      border: 1.5px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--beer-deep);
      margin-bottom: var(--space-md);
      box-shadow: 0 8px 20px rgba(217, 119, 6, 0.22);
      transition: transform var(--duration-slow) var(--ease-spring);
    }

    .choice-icon svg { width: 34px; height: 34px; }
    .choice:hover .choice-icon { transform: scale(1.15) rotate(6deg); }

    .choice-title {
      font-family: var(--font-heading);
      font-size: 1.45rem;
      font-weight: 800;
      line-height: 1.15;
      color: var(--foam);
      margin-bottom: 6px;
    }

    .choice-title em { font-style: normal; color: var(--beer-mid); }

    .choice-desc {
      font-size: 0.82rem;
      color: var(--foam-dim);
      line-height: 1.4;
      max-width: 210px;
      margin-bottom: var(--space-lg);
      font-weight: 500;
    }

    .choice-cta {
      display: inline-flex;
      align-items: center;
      background: linear-gradient(150deg, var(--beer-accent), var(--beer-mid));
      color: #fff;
      font-size: 0.78rem;
      font-weight: 700;
      padding: 7px 18px;
      border-radius: var(--radius-full);
      box-shadow: 0 4px 14px rgba(180, 83, 9, 0.38);
      transition: transform var(--duration-normal) var(--ease-out);
    }

    .choice:hover .choice-cta { transform: scale(1.06); }


    /* ── Side beers (desktop only) */
    .side-beers {
      position: fixed;
      top: 140px;
      display: flex;
      flex-direction: column;
      gap: 45px;
      z-index: 90;
      pointer-events: none;
    }

    .side-beers--left  { left: 32px; }
    .side-beers--right { right: 32px; }

    .side-beer {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: radial-gradient(circle at 32% 28%,
        rgba(255, 255, 255, 0.98),
        rgba(253, 243, 222, 0.92) 50%,
        rgba(245, 158, 11, 0.4) 100%);
      border: 2px solid rgba(217, 119, 6, 0.35);
      box-shadow: 0 12px 30px rgba(217, 119, 6, 0.22), inset 0 4px 10px rgba(255, 255, 255, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--beer-deep);
      opacity: 0;
      transition: opacity var(--duration-slow) ease, transform 0.45s var(--ease-spring);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .side-beer svg { width: 28px; height: 28px; }
    .side-beer.visible { opacity: 1; }

    /* ── Reduced motion */
    @media (prefers-reduced-motion: reduce) {
      .choice,
      .choice--left.revealed,
      .choice--right.revealed {
        opacity: 1;
        transform: none;
        animation: none;
        transition: box-shadow var(--duration-fast) ease, border-color var(--duration-fast) ease;
      }
      .choice--left:hover,
      .choice--right:hover { transform: none !important; }
      .card-bubble { display: none; }
      .side-beers { display: none; }
      .choice:hover .choice-icon,
      .choice:hover .choice-cta { transform: none; }
    }

    /* ── Responsive */
    @media (max-width: 1280px) {
      .side-beers { display: none; }
    }

    @media (max-width: 860px) {
      .hero { padding: var(--space-4xl) 0 var(--space-3xl); }
      .choices { flex-direction: column; gap: var(--space-4xl); padding: var(--space-lg) 0; }
      .choice--left.revealed,
      .choice--right.revealed { transform: none; animation: none; }
      .choice--left:hover,
      .choice--right:hover { transform: scale(1.03) !important; }
      .hero-search {
        flex-wrap: wrap;
        padding: var(--space-sm);
        margin-bottom: var(--space-4xl);
      }
      .hero-search-icon { display: none; }
      .hero-search-input { flex-basis: 100%; padding: 0 var(--space-md); }
      .hero-search-btn { width: 100%; justify-content: center; }
    }

    @media (max-width: 400px) {
      .choice { width: min(300px, calc(100vw - 32px)); height: min(300px, calc(100vw - 32px)); }
    }
  `],
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  private host = inject(ElementRef<HTMLElement>);
  private zone = inject(NgZone);

  /** Пользователь выбрал направление подбора. */
  choose = output<DiscoveryMode>();
  /** Пользователь отправил поисковый запрос по блюду. */
  dishSearch = output<string>();

  query = signal('');
  revealed = signal(false);
  sideVisible = signal<boolean[]>([false, false, false]);
  sideTransform = signal<string[]>(['', '', '', '', '', '']);

  pills: HeroPill[] = [
    { id: 'brands', label: '17 брендов Efes KZ', icon: 'beer' },
    { id: 'pyramid', label: 'Вкусовая пирамида', icon: 'pyramid' },
    { id: 'ai', label: 'AI-Сомелье', icon: 'sparkle' },
    { id: 'school', label: 'Школа вкуса', icon: 'book' },
  ];

  cardBubblesLeft = this.makeBubbles(16);
  cardBubblesRight = this.makeBubbles(16);

  private observer: IntersectionObserver | null = null;
  private readonly reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  private static readonly SIDE_THRESHOLDS = [60, 200, 360];

  ngAfterViewInit(): void {
    if (!this.reducedMotion) {
      this.zone.runOutsideAngular(() => window.addEventListener('scroll', this.onScrollEvent, { passive: true }));
    }
    if (this.reducedMotion || typeof IntersectionObserver === 'undefined') {
      this.revealed.set(true);
      return;
    }
    const target = this.host.nativeElement.querySelector('.choices');
    if (!target) {
      this.revealed.set(true);
      return;
    }
    this.observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          this.revealed.set(true);
          this.observer?.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    this.observer.observe(target);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    window.removeEventListener('scroll', this.onScrollEvent);
  }

  /** Боковые кружки видны только шире 1280px (см. стили), на узком экране прокрутку не считаем. */
  private readonly sideMq = typeof window !== 'undefined' ? window.matchMedia?.('(min-width: 1281px)') : undefined;
  private scrollTicking = false;

  /** Прокрутка слушается вне зоны Angular (ngAfterViewInit), считаем не чаще кадра. */
  private readonly onScrollEvent = () => {
    if (this.scrollTicking || (this.sideMq && !this.sideMq.matches)) return;
    this.scrollTicking = true;
    requestAnimationFrame(() => {
      this.scrollTicking = false;
      this.zone.run(() => this.onScroll());
    });
  };

  onScroll(): void {
    if (this.reducedMotion) return;
    const y = window.scrollY;
    const visible: boolean[] = [];
    const transforms: string[] = new Array(6).fill('');

    HeroComponent.SIDE_THRESHOLDS.forEach((th, i) => {
      const on = y > th;
      visible[i] = on;
      if (on) {
        const offsetL = (y - th) * 0.12;
        const offsetR = (y - th) * 0.14;
        const rotL = Math.sin((y + i * 40) * 0.008) * 12;
        const rotR = Math.cos((y + i * 40) * 0.008) * -12;
        transforms[i] = `translateY(${offsetL}px) rotate(${rotL}deg)`;
        transforms[i + 3] = `translateY(${offsetR}px) rotate(${rotR}deg)`;
      } else {
        transforms[i] = 'translateY(-80px) scale(0.5) rotate(-25deg)';
        transforms[i + 3] = 'translateY(-80px) scale(0.5) rotate(25deg)';
      }
    });

    this.sideVisible.set(visible);
    this.sideTransform.set(transforms);
  }

  submitSearch(event: Event): void {
    event.preventDefault();
    this.dishSearch.emit(this.query().trim());
  }

  private makeBubbles(count: number): RisingBubble[] {
    return Array.from({ length: count }, (_, id) => ({
      id,
      left: Math.random() * 90 + 5,
      size: 7 + Math.random() * 20,
      duration: 3.2 + Math.random() * 5,
      delay: Math.random() * -6,
      drift: Math.random() * 30 - 15,
    }));
  }
}
