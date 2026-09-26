import { Component, Input } from '@angular/core';
import { V2Drink, V2Pair, V2Price, V2Reason } from './v2.models';

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
  return [d.style?.name, d.producer?.name && withoutDashes(d.producer.name), abv].filter(Boolean).join(' · ');
}

/** Энергетики к еде не советуем: в подборе к блюду их не показываем. */
export function isEnergy(p: V2Pair | V2Drink | null | undefined): boolean {
  if (!p) return false;
  const drink = 'drink_id' in p ? p.drink : p;
  return ('drink_id' in p && p.archetype === 'energy_drink') || drink?.style?.archetype === 'energy_drink';
}

/** Текст для экрана ошибки загрузки: нет связи, раздела нет на сервере, сервер не ответил. */
export function loadErrorText(err: unknown): string {
  const status = (err as { status?: number } | null)?.status ?? 0;
  if (status === 0) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (status === 404) return 'Этот раздел сейчас недоступен на сервере. Загляните чуть позже.';
  return 'Сервер сейчас не отвечает. Попробуйте ещё раз через минуту.';
}

/* Тексты объяснений движка для гостя.
   Шаблоны живут в backend/data/engine/engine_v2_params.json и принадлежат движку.
   Здесь только чистка при показе: ссылки на источники в скобках уходят в подсказку,
   английские цитаты и длинные тире убираются. Что стоит поправить в самих шаблонах,
   собрано в docs/ENGINE_TEXT_ISSUES.md. */

/** Пометки источников: авторы, гиды и статьи, на которые опирается правило. */
const SOURCE_MARK = /\b(?:CMS|BA|WSET|THAC|Oliver|Peyrot|Madrigal|Nolden|Nasrawi|Trevisani|Sam Adams|Gaiser|Garneau|Breslin|Beauchamp|Papazian|Hanni|Herz|Death & Co|Whisky School|Brekell|Kallithraka|Marrero|Goldstein|Frankmann|Cicerone|Mosher|Wayback|NW Cider|Brewers Association|Wine Enthusiast|Wine Folly)\b/;
const CYRILLIC = /[А-Яа-яЁё]/;
const LATIN = /[A-Za-z]/;
/** Служебная пометка в названии напитка: «(Trapiche/Alamos, типовая позиция)» с длинным тире. */
const TYPICAL_NOTE = /\s*\(([^()]*?)\s*[\u2014\u2013]\s*тип\S* позиция\)/;
const TYPICAL_ONLY = /\s*\(тип\S* позиция\)/;
/** Одинаковые слова подряд: «Горячий Горячий шоколад» (шаблон плюс название напитка). */
const REPEATED_WORD = /(^|[^\p{L}])(\p{L}+)(?:\s+\2)+(?=[^\p{L}]|$)/giu;
/** Хвост вида « · фрукт ↔ фрукт»: общая нота напитка и блюда. */
const SAME_NOTE: Record<string, string> = {
  'фрукт': 'фруктовые ноты перекликаются',
  'умами': 'в напитке тоже есть умами',
};

function withoutDashes(s: string): string {
  return s.replace(/(\S)\s*\u2013\s*(?=\S)/g, '$1-').replace(/\s*[\u2014\u2013]\s*/g, ', ');
}

/** Название напитка без служебных пометок каталога и длинных тире. */
export function drinkTitle(name: string | null | undefined): string {
  if (!name) return '';
  return withoutDashes(name.replace(TYPICAL_NOTE, ' (например, $1)').replace(TYPICAL_ONLY, '')).trim();
}

/** Кавычки внутри кавычек по-русски: «Салат „Цезарь“ с курицей». Несбалансированные не трогаем. */
function nestQuotes(s: string): string {
  let depth = 0;
  let out = '';
  for (const ch of s) {
    if (ch === '«') {
      out += depth > 0 ? '„' : '«';
      depth++;
    } else if (ch === '»') {
      depth--;
      if (depth < 0) return s;
      out += depth > 0 ? '“' : '»';
    } else {
      out += ch;
    }
  }
  return depth === 0 ? out : s;
}

/** Длинное тире между частями фразы: двоеточие, а если двоеточие во фразе уже есть, запятая. */
function replaceDashes(s: string): string {
  let t = s.replace(/\s*,\s*[\u2014\u2013]\s+/g, ', ');
  for (let m = t.match(/\s+[\u2014\u2013]\s+/); m?.index !== undefined; m = t.match(/\s+[\u2014\u2013]\s+/)) {
    const before = t.slice(0, m.index);
    const after = t.slice(m.index + m[0].length);
    t = before + (before.includes(':') || after.includes(':') ? ', ' : ': ') + after;
  }
  return t.replace(/(\S)\u2013(?=\S)/g, '$1-');
}

/**
 * Фраза движка для гостя: без чисел вроде «(0.49 ↔ 0.49)», без ссылок на источники в скобках,
 * без английских цитат и длинных тире; «громкость» названа насыщенностью вкуса.
 * names: названия напитка и блюда из пары, скобки внутри них («Efes 0.0 (классическое)») не трогаем.
 */
export function cleanEngineText(raw: string | null | undefined, names: (string | null | undefined)[] = []): string {
  if (!raw) return '';
  if (/^Признанная классика/.test(raw)) return 'Признанная классика: такую пару называют в учебниках и гидах по сочетаниям';
  // «Интернациональная кухня» подходит к чему угодно, как довод не звучит
  if (/^Региональная пара: интернациональная кухня/.test(raw)) return '';

  const keep = [...new Set(names.filter((n): n is string => !!n && n.length > 2))].sort((a, b) => b.length - a.length);
  let t = raw;
  keep.forEach((name, i) => { t = t.split(name).join(`\uE000${i}\uE001`); });

  // Технические числа движка
  t = t.replace(/\s*\((?:[\d.,]+\s*↔\s*[\d.,]+)\)/g, '').replace(/:?\s*громкость\s+[\d.,]+\s+против\s+[\d.,]+/gi, '');
  // Хвосты « · фрукт ↔ фрукт» и « · кислота усиливает вяжущесть танинов»
  const [head, ...tails] = t.split(' · ');
  t = [head, ...tails.map(part => {
    const m = part.match(/^(.+?)\s*↔\s*(.+)$/);
    if (!m) return part;
    return m[1] === m[2] ? SAME_NOTE[m[1]] ?? `общая нота: ${m[1]}` : `${m[1]} и ${m[2]} перекликаются`;
  })].join('; ');
  t = t.replace(/Общие ароматы\s+[\u2014\u2013]\s+(.+?)\s+[\u2014\u2013]\s+строят мост между напитком и блюдом/,
    'Общие ароматы строят мост между напитком и блюдом: $1');
  t = t.replace(/\s*↔\s*/g, ' и ');

  // Английские цитаты: одна переводится, остальные стоят в скобках источников и уходят вместе с ними
  t = t.replace(/«palate destruction»/g, 'вкус блюда пропадёт');
  t = t.replace(/\s*\(([^()]*)\)/g, (whole: string, inner: string) => {
    if (inner.includes('\uE000')) return whole;
    const source = SOURCE_MARK.test(inner) || (LATIN.test(inner) && !CYRILLIC.test(inner));
    return source || /^мост[\s:]/.test(inner) ? '' : whole;
  });
  t = t.replace(/\s*«([^«»\uE000]*)»/g, (whole: string, inner: string) => (LATIN.test(inner) && !CYRILLIC.test(inner) ? '' : whole));

  t = t.replace(/Громкость совпадает/g, 'Насыщенность вкуса совпадает')
    .replace(/громкост(ь|и|ью)/g, 'насыщенност$1')
    .replace(/громче/g, 'насыщеннее')
    .replace(/перекрикивает/g, 'заглушает')
    // «мягче и фруктовее» сказано про вино, к чаю и кофе не подходит
    .replace(/(танины (?:чая|кофе).*?мягче) и фруктовее/, '$1');
  t = replaceDashes(t);

  t = t.replace(/\uE000(\d+)\uE001/g, (_: string, i: string) => drinkTitle(keep[+i]));
  t = nestQuotes(t).replace(REPEATED_WORD, '$1$2');
  t = t.replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])(?:\s*[,;:])+/g, '$1').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/[\s,;:]+$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** Источники из скобок фразы движка: для подсказки при наведении, в самом тексте гостю не нужны. */
export function engineSources(raw: string | null | undefined): string {
  if (!raw) return '';
  const classic = raw.match(/^Признанная классика:\s*(.+)$/);
  if (classic) return classic[1];
  const found: string[] = [];
  for (const m of raw.matchAll(/\(([^()]*)\)/g)) {
    if (SOURCE_MARK.test(m[1])) found.push(m[1]);
  }
  return found.join('; ');
}

export interface ReasonLine {
  text: string;
  /** «Источник: CMS» для подсказки; пусто, если источника нет. */
  source: string;
}

/** Правила общего баланса и контекста звучат одинаково у многих пар: их показываем после механизма. */
function isGeneral(r: V2Reason): number {
  return r.family === 'balance' || r.family === 'context' ? 1 : 0;
}

/**
 * Причины пары для гостя: сначала механизм (жир, соль, мост вкуса), потом общий баланс.
 * Тексты очищены, повторы убраны; used: фразы, уже показанные в том же списке.
 */
export function reasonLines(p: V2Pair, n = 2, used?: Set<string>): ReasonLine[] {
  const names = [p.drink_name, p.dish_name, p.drink?.name, p.drink?.display_name];
  const out: ReasonLine[] = [];
  for (const r of [...(p.reasons ?? [])].sort((a, b) => isGeneral(a) - isGeneral(b) || b.points - a.points)) {
    const text = cleanEngineText(r.text, names);
    if (!text || used?.has(text) || out.some(x => x.text === text)) continue;
    const src = engineSources(r.text);
    out.push({ text, source: src ? `Источник: ${src}` : '' });
    if (out.length >= n) break;
  }
  return out;
}

/** Самые весомые причины пары очищенным текстом. */
export function topReasons(p: V2Pair, n = 2): string[] {
  return reasonLines(p, n).map(r => r.text);
}

export function firstWarning(p: V2Pair): string {
  const w = (p.warnings ?? [])[0] as unknown;
  if (!w) return '';
  const raw = typeof w === 'string' ? w : (w as { text?: string }).text ?? '';
  return cleanEngineText(raw, [p.drink_name, p.dish_name, p.drink?.name, p.drink?.display_name]);
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
