import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import photosJson from '../../../../data/dish_photos.json';

/** Запись data/dish_photos.json (собирается scripts/fetch_dish_photos.py). */
export interface DishPhoto {
  large: string; square: string; width: number; height: number;
  name?: string; cuisine?: string;
  source: 'commons' | 'openverse' | string; source_page: string; original_url: string; original_title?: string;
  author: string; license: string; license_url: string; attribution_ru: string; changes: string;
  derivative_license?: string | null; fetched_at: string; note?: string;
}
export interface DishPhotosMeta {
  generated_at: string | null; dishes_with_photo: number; traditional_drinks: number;
  by_source: Record<string, number>; by_license: Record<string, number>; no_photo: Record<string, string>;
}

const RAW = photosJson as unknown as Record<string, unknown>;
const pick = (o: Record<string, unknown>): Record<string, DishPhoto> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))) as Record<string, DishPhoto>;

/** id блюда → фото. Ключи с «_» — служебные. */
export const DISH_PHOTOS: Record<string, DishPhoto> = pick(RAW);
/** Традиционные напитки в пиале (кумыс, айран, шубат) — отдельная группа. */
export const TRADITIONAL_DRINK_PHOTOS: Record<string, DishPhoto> = pick((RAW['_traditional_drinks'] as Record<string, unknown>) ?? {});
export const DISH_PHOTOS_META: DishPhotosMeta = RAW['_meta'] as DishPhotosMeta;

export function dishPhoto(id: string): DishPhoto | undefined {
  return DISH_PHOTOS[id] ?? TRADITIONAL_DRINK_PHOTOS[id];
}

/**
 * Фото блюда из свободных источников (Wikimedia Commons / Openverse) с корректной подписью
 * автора и лицензии. Если фото нет — тёплая плитка с эмодзи, никогда не «битая» картинка.
 *
 *   <ft-dish-photo [dishId]="d.id" [emoji]="d.emoji" [name]="d.name" variant="square" />
 *   <ft-dish-photo dishId="beshbarmak" variant="large" [credit]="true" [priority]="true" />
 */
@Component({
  selector: 'ft-dish-photo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (photo(); as p) {
      <figure class="ph" [class.lg]="variant() === 'large'">
        <img
          [src]="variant() === 'large' ? p.large : p.square"
          [width]="variant() === 'large' ? p.width : 480"
          [height]="variant() === 'large' ? p.height : 480"
          [alt]="alt()"
          [attr.loading]="priority() ? 'eager' : 'lazy'"
          [attr.fetchpriority]="priority() ? 'high' : null"
          decoding="async"
          (error)="failed.set(true)" />
        @if (credit()) {
          <figcaption class="cr">
            <a [href]="p.source_page" target="_blank" rel="noopener license" [title]="p.changes">{{ p.attribution_ru }}</a>
          </figcaption>
        }
      </figure>
    } @else {
      <div class="ph fb" [class.lg]="variant() === 'large'" [attr.role]="name() ? 'img' : null"
           [attr.aria-label]="name() || null" [attr.aria-hidden]="name() ? null : 'true'">
        <span class="em">{{ emoji() }}</span>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .ph {
      position: relative; margin: 0; width: 100%; aspect-ratio: 1 / 1; overflow: hidden; isolation: isolate;
      border-radius: var(--r-md); background: var(--surface-2); container-type: inline-size;
    }
    .ph.lg { aspect-ratio: 4 / 3; border-radius: var(--r-lg); }
    .ph::after {
      content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
      box-shadow: inset 0 0 0 1px rgba(229, 184, 73, .22), inset 0 1px 0 rgba(255, 250, 240, .07);
    }
    img { display: block; width: 100%; height: 100%; object-fit: cover; }
    /* подпись автора: крошечная, приглушённая, читаемая на градиенте, кликабельная */
    .cr {
      position: absolute; inset: auto 0 0 0; margin: 0; padding: 22px 10px 7px;
      background: linear-gradient(180deg, rgba(11, 8, 6, 0) 0%, rgba(11, 8, 6, .72) 100%);
      font-family: var(--font-body); font-size: .62rem; line-height: 1.3; letter-spacing: .01em;
      color: rgba(247, 241, 229, .62); text-align: right;
    }
    .cr a { color: inherit; text-decoration: none; }
    .cr a:hover, .cr a:focus-visible { color: var(--gold-soft); text-decoration: underline; }
    /* нет фото: тёплая радиальная плитка с эмодзи */
    .fb {
      display: grid; place-items: center;
      background: radial-gradient(120% 90% at 50% 18%, rgba(229, 184, 73, .16) 0%, rgba(229, 184, 73, .04) 45%, transparent 70%), var(--surface-2);
    }
    .em { font-size: 2rem; font-size: 34cqw; line-height: 1; filter: drop-shadow(0 6px 14px rgba(0, 0, 0, .35)); user-select: none; }
    .fb.lg .em { font-size: 2.6rem; font-size: 22cqw; }
  `],
})
export class DishPhotoComponent {
  /** id блюда из data/dishes.json / dishes_v2.json (или напитка: kumys, airan, shubat). */
  dishId = input.required<string>();
  /** Эмодзи для плитки-заглушки, когда фото нет. */
  emoji = input<string>('🍽️');
  /** square — 480×480 для карточек и списков; large — 1200×900 (4:3) для страницы блюда. */
  variant = input<'square' | 'large'>('square');
  /** Показать подпись «Фото: автор, лицензия, источник» поверх нижнего края. */
  credit = input<boolean>(false);
  /** Название блюда по-русски — для alt-текста. */
  name = input<string>('');
  /** Первый экран: грузить сразу, не lazy. */
  priority = input<boolean>(false);

  readonly failed = signal(false);
  readonly photo = computed<DishPhoto | undefined>(() => (this.failed() ? undefined : dishPhoto(this.dishId())));
  readonly alt = computed(() => (this.name() ? `${this.name()} — фото блюда` : 'Фото блюда'));
}
