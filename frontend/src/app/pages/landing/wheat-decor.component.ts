import { Component, DestroyRef, NgZone, OnInit, inject, signal } from '@angular/core';

interface Stalk {
  src: string;
  side: 'left' | 'right';
  /** Якорь по высоте страницы, % — считается от низа для anchor: 'bottom'. */
  at: number;
  anchor: 'top' | 'bottom';
  /** Сдвиг центра картинки за край экрана, % её ширины. */
  hide: number;
  width: number;
  /** Наклон от вертикали. Около 75° колос почти лежит. */
  tilt: number;
  /** Насколько сильно колос отстаёт при прокрутке. */
  lag: number;
  opacity: number;
}

/** Дальше этого колос не уедет — иначе он выйдет за слой и обрежется. */
const MAX_SHIFT = 50;

/**
 * Пшеница по краям страницы.
 *
 * Колосья лежат почти горизонтально и растут из-за боковых краёв.
 *
 * Наклон здесь главное. У исходных картинок стебли обрезаны по нижней
 * границе файла, и пока колос стоит вертикально, этот срез виден прямо
 * посреди страницы. При наклоне около 75° стебли смотрят вбок и уходят
 * за край экрана — наружу остаётся только метёлка. Поворот считается от
 * центра картинки, поэтому половина длины прячется за краем, половина
 * входит в кадр.
 *
 * Прокрутка качает колосья в пределах ±70px. Раньше сдвиг рос вместе со
 * скроллом, и нижние колосья уезжали за слой, где их срезало ровной
 * линией; теперь диапазон ограничен и такого не бывает.
 */
@Component({
  selector: 'app-wheat-decor',
  standalone: true,
  template: `
    <div class="wheat" aria-hidden="true">
      @for (s of stalks; track $index) {
        <img
          [src]="s.src"
          alt=""
          [class.right]="s.side === 'right'"
          [class.from-bottom]="s.anchor === 'bottom'"
          [style.top]="s.anchor === 'top' ? s.at + '%' : null"
          [style.bottom]="s.anchor === 'bottom' ? s.at + '%' : null"
          [style.width.px]="s.width"
          [style.opacity]="s.opacity"
          [style.transform]="transform(s)"
        />
      }
    </div>
  `,
  styles: [`
    :host { display: contents; }

    .wheat {
      position: absolute;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
    }

    /* Лежачий колос занимает по высоте свою ширину, а не длину, поэтому
       у краёв слоя хватает небольшого запаса. */
    .wheat img.from-bottom { margin-bottom: 20px; }

    .wheat img {
      position: absolute;
      left: 0;
      height: auto;
      /* Поворот вокруг центра: половина колоса уходит за край, половина
         остаётся в кадре. */
      transform-origin: 50% 50%;
      will-change: transform;
      filter: drop-shadow(0 12px 26px rgba(180, 83, 9, 0.16));
    }
    .wheat img.right { left: auto; right: 0; }

    /* На узком экране колосья лезут на текст — там их нет. */
    @media (max-width: 1180px) { .wheat { display: none; } }
  `],
})
export class WheatDecorComponent implements OnInit {
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);

  private scrollY = signal(0);

  /**
   * Колосья расставлены по всей высоте страницы: верхние отмеряются от
   * верха, нижние — от низа, поэтому на короткой странице они не
   * слипаются, а на длинной не собираются в начале.
   */
  readonly stalks: Stalk[] = [
    { src: 'decor/corn6.png', side: 'right', at: 8,  anchor: 'top',    hide: 52, width: 300, tilt: 76, lag: 0.16, opacity: 0.85 },
    { src: 'decor/corn2.png', side: 'left',  at: 16, anchor: 'top',    hide: 50, width: 260, tilt: 72, lag: 0.10, opacity: 0.75 },
    { src: 'decor/corn4.png', side: 'left',  at: 44, anchor: 'top',    hide: 48, width: 210, tilt: 78, lag: 0.18, opacity: 0.6 },
    { src: 'decor/corn6.png', side: 'right', at: 40, anchor: 'top',    hide: 54, width: 280, tilt: 74, lag: 0.13, opacity: 0.7 },
    { src: 'decor/corn3.png', side: 'left',  at: 34, anchor: 'bottom', hide: 46, width: 200, tilt: 80, lag: 0.09, opacity: 0.6 },
    { src: 'decor/corn5.png', side: 'right', at: 28, anchor: 'bottom', hide: 46, width: 175, tilt: 72, lag: 0.17, opacity: 0.55 },
    { src: 'decor/corn2.png', side: 'left',  at: 16, anchor: 'bottom', hide: 50, width: 240, tilt: 75, lag: 0.12, opacity: 0.55 },
    { src: 'decor/corn6.png', side: 'right', at: 12, anchor: 'bottom', hide: 52, width: 260, tilt: 77, lag: 0.15, opacity: 0.5 },
  ];

  private animate = true;

  ngOnInit(): void {
    this.animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!this.animate) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        this.zone.run(() => this.scrollY.set(window.scrollY));
        ticking = false;
      });
    };

    // Слушаем вне зоны Angular: иначе каждый пиксель прокрутки запускал бы
    // проверку изменений во всём приложении.
    this.zone.runOutsideAngular(() => window.addEventListener('scroll', onScroll, { passive: true }));
    this.destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
    this.scrollY.set(window.scrollY);
  }

  transform(s: Stalk): string {
    // Поворот по часовой уводит низ картинки (стебли) влево, против —
    // вправо. Значит левому колосу нужен плюс, правому минус: тогда
    // срез у обоих прячется за своим краем, а метёлка входит в кадр.
    const angle = s.side === 'left' ? s.tilt : -s.tilt;
    const x = s.side === 'left' ? -s.hide : s.hide;

    // Синус вместо линейного сдвига: колос плавно качается в пределах
    // ±MAX_SHIFT и никогда не уезжает за слой, где его срезало бы краем.
    const y = this.animate ? MAX_SHIFT * Math.sin(this.scrollY() * s.lag / 90) : 0;

    return `translate(${x}%, ${y.toFixed(1)}px) rotate(${angle}deg)`;
  }
}
