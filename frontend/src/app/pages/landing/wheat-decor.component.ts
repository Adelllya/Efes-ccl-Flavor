import { AfterViewInit, Component, DestroyRef, ElementRef, NgZone, QueryList, ViewChildren, inject, signal } from '@angular/core';

interface Stalk {
  src: string;
  side: 'left' | 'right';
  /** Верх картинки внутри одного «экрана» узора, px. */
  y: number;
  width: number;
  /** Отступ от края: минус прячет часть картинки за экран, плюс - заводит внутрь. */
  edge: number;
  /** Лёгкий наклон, градусы. */
  tilt: number;
  /** Параллакс: насколько колос отстаёт от страницы при прокрутке. */
  speed: number;
}

/** Высота одного «экрана» узора - дальше колосья повторяются. */
const TILE = 1300;
/** С этого места начинается первый экран: выше стоит навбар. */
const START = 60;

/** Колосья показываем только на широком экране: на узком они лезут на текст. */
const WIDE_QUERY = '(min-width: 1181px)';

/**
 * Колосья по краям страницы, как на сайте Efes.
 *
 * Картинки стоят как есть, без поворота на бок: у пучков стебли уходят
 * в правый нижний угол файла, поэтому справа край экрана их и срезает.
 * Слева стоят одиночные колосья, они целые и помещаются полностью.
 *
 * Слой фиксирован на экране, а колосья привязаны к местам на странице
 * и едут вместе с ней, только чуть медленнее (параллакс). У каждого
 * своя скорость, поэтому при прокрутке они немного расходятся и
 * получается глубина. Сдвиг считается от центра экрана: пока колос
 * виден, он смещается не больше чем на speed * пол-экрана.
 */
@Component({
  selector: 'app-wheat-decor',
  standalone: true,
  template: `
    <!-- На узком экране колосьев нет совсем: картинки не качаются и прокрутку не слушаем -->
    @if (wide()) {
    <div class="wheat" aria-hidden="true">
      @for (s of stalks(); track $index) {
        <img
          #stalk
          [src]="s.src"
          alt=""
          loading="lazy"
          decoding="async"
          [style.width.px]="s.width"
          [style.left.px]="s.side === 'left' ? s.edge : null"
          [style.right.px]="s.side === 'right' ? s.edge : null"
        />
      }
    </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    .wheat {
      position: fixed;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
    }

    .wheat img {
      position: absolute;
      top: 0;
      height: auto;
      will-change: transform;
      filter: drop-shadow(0 10px 18px rgba(180, 83, 9, 0.12));
    }

    /* На узком экране колосья лезут на текст - там их нет (см. WIDE_QUERY). */
    @media (max-width: 1180px) { .wheat { display: none; } }
  `],
})
export class WheatDecorComponent implements AfterViewInit {
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);

  @ViewChildren('stalk') private imgs!: QueryList<ElementRef<HTMLImageElement>>;

  /** Один экран узора, повторяется по всей высоте страницы. */
  private readonly pattern: Stalk[] = [
    // Справа вверху пучок заглядывает из-за края.
    { src: 'decor/corn2.webp', side: 'right', y: 0,    width: 250, edge: -70,  tilt: 0,   speed: 0.10 },
    // Слева тонкий колос по диагонали.
    { src: 'decor/corn4.webp', side: 'left',  y: 190,  width: 190, edge: -30,  tilt: -6,  speed: 0.28 },
    // Большой пучок справа, стебли срезаны краем.
    { src: 'decor/corn6.webp', side: 'right', y: 330,  width: 320, edge: -110, tilt: 0,   speed: 0.16 },
    // Слева ниже ещё один колос, почти стоит.
    { src: 'decor/corn5.webp', side: 'left',  y: 560,  width: 120, edge: 70,   tilt: -10, speed: 0.34 },
    // Справа одиночный колос, отстоит от края.
    { src: 'decor/corn4.webp', side: 'right', y: 860,  width: 180, edge: 150,  tilt: 4,   speed: 0.24 },
    // Слева колос с остями.
    { src: 'decor/corn3.webp', side: 'left',  y: 1000, width: 170, edge: -20,  tilt: 8,   speed: 0.20 },
  ];

  readonly stalks = signal<(Stalk & { pageY: number })[]>([]);

  /** Экран достаточно широкий для колосьев. */
  readonly wide = signal(typeof window === 'undefined' || !window.matchMedia || window.matchMedia(WIDE_QUERY).matches);

  private animate = true;

  constructor() {
    this.layout();
  }

  ngAfterViewInit(): void {
    this.animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const wideMq = window.matchMedia?.(WIDE_QUERY);
    if (wideMq) {
      const onChange = (e: MediaQueryListEvent) => this.zone.run(() => this.wide.set(e.matches));
      wideMq.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => wideMq.removeEventListener('change', onChange));
    }

    let ticking = false;
    const schedule = () => {
      if (ticking || !this.wide()) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        this.paint();
      });
    };

    // Высота страницы меняется при переходах между разделами:
    // пересчитываем, сколько экранов узора нужно.
    const relayout = () => {
      if (this.layout()) this.zone.run(() => {});
      schedule();
    };

    // Всё вне зоны Angular: иначе каждый пиксель прокрутки запускал бы
    // проверку изменений во всём приложении.
    this.zone.runOutsideAngular(() => {
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      const ro = new ResizeObserver(relayout);
      ro.observe(document.body);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        ro.disconnect();
      });
    });

    this.imgs.changes.subscribe(schedule);
    schedule();
  }

  /** Раскладывает узор по высоте страницы. Возвращает true, если число колосьев изменилось. */
  private layout(): boolean {
    const pageH = typeof document !== 'undefined' ? document.documentElement.scrollHeight : TILE;
    const tiles = Math.max(1, Math.ceil((pageH - START) / TILE));
    if (this.stalks().length === tiles * this.pattern.length) return false;

    const next: (Stalk & { pageY: number })[] = [];
    for (let t = 0; t < tiles; t++) {
      for (const s of this.pattern) {
        next.push({ ...s, pageY: START + t * TILE + s.y });
      }
    }
    this.stalks.set(next);
    return true;
  }

  /** Ставит колосья на места с учётом прокрутки. Пишем прямо в DOM, без Angular. */
  private paint(): void {
    const scroll = window.scrollY;
    const vh = window.innerHeight;
    const imgs = this.imgs.toArray();

    imgs.forEach((ref, i) => {
      const s = this.stalks()[i];
      if (!s) return;
      const el = ref.nativeElement;
      const h = el.offsetHeight || s.width;
      const onScreen = s.pageY - scroll;

      // Далеко за экраном - не двигаем, браузеру меньше работы.
      if (onScreen > vh + 400 || onScreen + h < -400) {
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = '';

      // Отставание от центра экрана: колос у центра стоит на своём месте,
      // выше и ниже - чуть сдвинут навстречу. Разные скорости дают глубину.
      const fromCenter = onScreen + h / 2 - vh / 2;
      const lag = this.animate ? -fromCenter * s.speed : 0;
      const y = onScreen + lag;

      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) rotate(${s.tilt}deg)`;
    });
  }
}
