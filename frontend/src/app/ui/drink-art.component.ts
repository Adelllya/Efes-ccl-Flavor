import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DrinkArtInput, DrinkVisual, drinkArtSvg, resolveVisual } from './drink-art';

/** Запись напитка, которую понимает компонент: DrinkArtInput или сырой объект data/drinks.json (style.archetype/family). */
export interface DrinkArtDrink extends Omit<DrinkArtInput, 'archetype' | 'family'> {
  archetype?: string | null;
  family?: string | null;
  style?: { archetype?: string | null; family?: string | null } | null;
  name?: string;
  /** Реальное фото (17 брендов Efes) — используется при preferPhoto. */
  image?: string | null;
  visual?: Partial<DrinkVisual> | null;
}

/**
 * `<ft-drink-art [drink]="d" [size]="96" />` — иллюстрация напитка из данных (см. drink-art.ts).
 * Если у записи есть реальное `image` и включён `preferPhoto`, показывается фото.
 * SVG генерируется только из собственной строки drinkArtSvg — bypassSecurityTrustHtml применяется к ней и ни к чему другому.
 */
@Component({
  selector: 'ft-drink-art',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (preferPhoto() && drink().image) {
      <img class="photo" [src]="drink().image" [alt]="label()" [style.height.px]="size()" loading="lazy" decoding="async" />
    } @else {
      <span class="art" [class.glow]="glow()" [innerHTML]="svg()" role="img" [attr.aria-label]="label()"></span>
    }
  `,
  styles: [`
    :host { display: inline-block; line-height: 0; color: var(--ink, currentColor); vertical-align: middle; }
    .art { display: inline-block; line-height: 0; filter: drop-shadow(0 8px 14px rgba(0, 0, 0, .35)); }
    :host-context([data-theme="light"]) .art { filter: drop-shadow(0 6px 12px rgba(120, 90, 30, .18)); }
    .art.glow { position: relative; }
    .art.glow::before { content: ''; position: absolute; inset: 20% 10% 0; background: radial-gradient(50% 50% at 50% 60%, var(--art-glow, transparent) 0%, transparent 70%); opacity: .35; filter: blur(12px); z-index: -1; }
    .photo { display: block; width: auto; object-fit: contain; }
  `],
})
export class DrinkArtComponent {
  private sanitizer = inject(DomSanitizer);
  drink = input.required<DrinkArtDrink>();
  /** Высота в px (ширина = 0.75 × высота). */
  size = input<number>(96);
  /** Показывать реальное фото, если оно есть у записи. */
  preferPhoto = input<boolean>(false);
  /** Лёгкая CSS-анимация пузырьков/пара (prefers-reduced-motion учитывается внутри SVG и в стилях). */
  animate = input<boolean>(false);
  /** Тёплое свечение цвета напитка под бокалом (для карточек). */
  glow = input<boolean>(false);
  /** aria-label; по умолчанию — имя напитка или id. */
  alt = input<string | null>(null);

  readonly label = computed(() => this.alt() ?? this.drink().name ?? this.drink().id);
  readonly artInput = computed<DrinkArtInput>(() => {
    const d = this.drink();
    return { id: d.id, category: d.category, archetype: d.archetype ?? d.style?.archetype ?? null, family: d.family ?? d.style?.family ?? null, sensory: d.sensory, aroma_tags: d.aroma_tags, serving: d.serving, visual: d.visual };
  });
  readonly resolved = computed(() => resolveVisual(this.artInput()));
  readonly svg = computed<SafeHtml>(() => {
    const svg = drinkArtSvg(this.artInput(), { size: this.size(), animate: this.animate(), idPrefix: 'fa' + this.drink().id.replace(/[^a-z0-9]/gi, '') });
    // Строка собрана нами из чисел и словаря цветов — безопасна для innerHTML.
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  });
}
