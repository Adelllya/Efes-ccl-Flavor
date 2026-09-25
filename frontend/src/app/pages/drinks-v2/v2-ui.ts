import { Component, Input } from '@angular/core';
import { V2Drink, V2Pair, V2Price } from './v2.models';

/** Связь с Efes по данным каталога: собственные сорта, Coca-Cola İçecek и дистрибуция. */
const EFES_RELATIONS = new Set(['own', 'cci', 'distribution']);

export function isEfes(relation: string | undefined | null): boolean {
  return !!relation && EFES_RELATIONS.has(relation);
}

type GlassKind = 'mug' | 'wine' | 'flute' | 'martini' | 'rocks' | 'highball' | 'cup';

const CATEGORY_STYLE: Record<string, { glass: GlassKind; color: string }> = {
  beer: { glass: 'mug', color: '#D97706' },
  na_beer: { glass: 'mug', color: '#CA8A04' },
  radler: { glass: 'mug', color: '#EAB308' },
  kvass: { glass: 'mug', color: '#78350F' },
  cider: { glass: 'highball', color: '#65A30D' },
  wine: { glass: 'wine', color: '#9F1239' },
  fortified: { glass: 'wine', color: '#7C2D12' },
  sparkling: { glass: 'flute', color: '#B7791F' },
  cocktail: { glass: 'martini', color: '#DB2777' },
  spirit: { glass: 'rocks', color: '#92400E' },
  liqueur: { glass: 'rocks', color: '#7E22CE' },
  lemonade: { glass: 'highball', color: '#F59E0B' },
  soda: { glass: 'highball', color: '#0284C7' },
  water: { glass: 'highball', color: '#0EA5E9' },
  dairy: { glass: 'cup', color: '#64748B' },
  tea: { glass: 'cup', color: '#15803D' },
  coffee: { glass: 'cup', color: '#57534E' },
};

export function categoryColor(category: string): string {
  return (CATEGORY_STYLE[category] ?? CATEGORY_STYLE['beer']).color;
}

const nf = new Intl.NumberFormat('ru-RU');

/** «в баре ≈ 3 500 ₸» или «в магазине от 2 600 ₸»; пусто, если цены нет. */
export function priceLabel(p: V2Price | null | undefined): string {
  if (!p) return '';
  const approx = p.is_estimate ? '≈ ' : '';
  if (p.horeca) {
    const max = p.horeca_max && p.horeca_max !== p.horeca ? '-' + nf.format(p.horeca_max) : '';
    return `в баре ${approx}${nf.format(p.horeca)}${max} ₸`;
  }
  if (p.retail_min) return `в магазине от ${approx}${nf.format(p.retail_min)} ₸`;
  return '';
}

/** «Czech Pale Lager · Efes Kazakhstan · 4 %». */
export function drinkLine(d: V2Drink | undefined): string {
  if (!d) return '';
  const abv = d.abv != null ? `${String(d.abv).replace('.', ',')}\u00a0%` : '';
  return [d.style?.name, d.producer?.name, abv].filter(Boolean).join(' · ');
}

/** Две самые весомые причины пары, без технических чисел вроде «(0.49 ↔ 0.49)». */
export function topReasons(p: V2Pair, n = 2): string[] {
  return [...(p.reasons ?? [])]
    .sort((a, b) => b.points - a.points)
    .slice(0, n)
    .map(r => r.text.replace(/\s*\((?:[\d.,]+\s*↔\s*[\d.,]+)\)/g, '').trim());
}

export function firstWarning(p: V2Pair): string {
  const w = (p.warnings ?? [])[0] as unknown;
  if (!w) return '';
  return typeof w === 'string' ? w : (w as { text?: string }).text ?? '';
}

const GLASS_PATHS: Record<GlassKind, string[]> = {
  mug: ['M17 11h1a3 3 0 0 1 0 6h-1', 'M9 12v6', 'M13 12v6', 'M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8',
    'M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z'],
  wine: ['M8 22h8', 'M7 10h10', 'M12 15v7', 'M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z'],
  flute: ['M8 22h8', 'M12 15v7', 'M10 2h4l1 8a3 3 0 0 1-6 0Z', 'M9.5 7h5'],
  martini: ['M8 22h8', 'M12 11v11', 'm19 3-7 8-7-8Z', 'M7.5 6h9'],
  rocks: ['M5 6h14l-1.4 13.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8Z', 'M6 12h12'],
  highball: ['M15.2 22H8.8a2 2 0 0 1-2-1.79L5 3h14l-1.81 17.21A2 2 0 0 1 15.2 22Z', 'M6 12a5 5 0 0 1 6 0 5 5 0 0 0 6 0'],
  cup: ['M10 2v2', 'M14 2v2', 'M6 2v2', 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1'],
};

/** Плитка с бокалом категории: одинаковая для 412 напитков, у которых нет фото. */
@Component({
  selector: 'v2-glass',
  standalone: true,
  template: `
    <span class="v2-glass" [style.width.px]="size" [style.height.px]="size" [style.--tone]="color" aria-hidden="true">
      <svg [attr.width]="size * 0.52" [attr.height]="size * 0.52" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        @for (d of paths; track d) { <path [attr.d]="d" /> }
      </svg>
    </span>
  `,
  styles: [`
    .v2-glass {
      display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
      border-radius: var(--radius-md);
      color: var(--tone);
      background: color-mix(in srgb, var(--tone) 12%, white);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 22%, transparent);
    }
  `],
})
export class V2GlassComponent {
  @Input() category = 'beer';
  @Input() size = 44;

  get color(): string {
    return categoryColor(this.category);
  }

  get paths(): string[] {
    return GLASS_PATHS[(CATEGORY_STYLE[this.category] ?? CATEGORY_STYLE['beer']).glass];
  }
}
