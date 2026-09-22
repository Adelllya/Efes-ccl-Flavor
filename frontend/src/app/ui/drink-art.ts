/**
 * drink-art.ts — детерминированные SVG-иллюстрации напитков (чистый TypeScript, без Angular).
 *
 * Картинка строится из данных: бокал — по категории/стилю, цвет жидкости — по SRM (пиво) или
 * типу (вино, коктейли), пена — по стилю, пузырьки — по оси `carbonation`, конденсат — при подаче
 * ≤ 8 °C, пар — при ≥ 50 °C, гарнир — по архетипу/аромат-тегам. Приоритет источников:
 *   drink.visual → serving (бокал/лёд из каталога) → archetypes[style.archetype] → families[style.family] → categories[category].
 * Тот же вход → тот же SVG (позиции пузырьков — из seeded-хэша id).
 *
 * Контуры бокала рисуются `currentColor` с прозрачностью, поэтому одна и та же картинка
 * читается и на тёмной теме (#0B0806), и на светлой (кремовой) — хост задаёт `color`.
 */
import visualsJson from '../../../../data/drink_visuals.json';

export type IceKind = 'none' | 'large_cube' | 'cubes' | 'crushed';
export type RimKind = 'none' | 'salt' | 'sugar';
export type GarnishId = 'lemon_wheel' | 'lime_wedge' | 'orange_peel' | 'orange_slice' | 'orange_wheel' | 'lemon_twist' | 'cherry' | 'mint' | 'rosemary' | 'cinnamon' | 'olive' | 'cucumber' | 'smoke';
export type GlassId = 'pilsner' | 'weizen' | 'nonic' | 'mug' | 'becher' | 'stange' | 'tulip' | 'snifter' | 'tumbler' | 'white_wine' | 'red_wine' | 'spritz' | 'flute' | 'port' | 'copita' | 'coupe' | 'martini' | 'rocks' | 'highball' | 'glencairn' | 'shot' | 'piala' | 'teacup' | 'podstakannik' | 'espresso';

export interface LiquidColors { top: string; mid: string; bottom: string; opacity?: number }

/** Визуальный приор (в data/drink_visuals.json) или per-drink override `drink.visual`. Все поля необязательны. */
export interface DrinkVisual {
  glass?: GlassId;
  /** Цвет пива по SRM (1..40); если задан вместе с liquid — liquid важнее. */
  srm?: number | null;
  liquid?: LiquidColors;
  foam?: { height: number; color?: string };
  garnish?: GarnishId[];
  ice?: IceKind;
  rim?: RimKind;
  /** Мутность 0..1 (пшеничное, радлер) — пастельнее цвет, глуше пузырьки. */
  haze?: number;
  /** Доля высоты чаши, залитая жидкостью (0..1). */
  fill?: number;
  /** Плотность пузырьков 0..1; по умолчанию — sensory.carbonation. */
  bubbles?: number;
  steam?: boolean;
  condensation?: boolean;
  anchor?: string;
}

export interface DrinkArtInput {
  id: string;
  category: string;
  archetype?: string | null;
  family?: string | null;
  sensory?: Partial<Record<string, number>> | null;
  aroma_tags?: Record<string, number> | null;
  /** Подача из каталога: бокал по-русски («пилснер», «кружка»…) и лёд по enum спецификации. */
  serving?: { glass?: string | null; ice?: string | null } | null;
  visual?: Partial<DrinkVisual> | null;
}

export interface DrinkArtOptions {
  /** Высота SVG в px (ширина = 0.75 × высота). Без размера — только viewBox. */
  size?: number;
  /** Префикс id градиентов/клипов — уникален на странице. По умолчанию — из хэша id. */
  idPrefix?: string;
  /** Встроить CSS-анимацию пузырьков/пара (учитывает prefers-reduced-motion). */
  animate?: boolean;
  /** aria-label; без него — aria-hidden. */
  label?: string;
}

export interface ResolvedVisual {
  glass: GlassId; liquid: Required<LiquidColors>; foam: { height: number; color: string }; garnish: GarnishId[];
  ice: IceKind; rim: RimKind; haze: number; fill: number; bubbles: number; steam: boolean; condensation: boolean;
  anchor: string | null; source: string;
}

interface VisualsFile {
  glasses: Record<string, string>;
  serving_glass_aliases_ru: Record<string, string>;
  archetypes: Record<string, DrinkVisual & { category?: string }>;
  families: Record<string, DrinkVisual>;
  categories: Record<string, DrinkVisual>;
}
const VISUALS = visualsJson as unknown as VisualsFile;

// ─── цвет ────────────────────────────────────────────────────────────────────
/** Стандартная таблица SRM → sRGB (1..40), как в пивоваренных калькуляторах (BeerSmith/Brewer's Friend). */
export const SRM_RGB = ['#FFE699', '#FFD878', '#FFCA5A', '#FFBF42', '#FBB123', '#F8A600', '#F39C00', '#EA8F00', '#E58500', '#DE7C00', '#D77200', '#CF6900', '#CB6200', '#C35900', '#BB5100', '#B54C00', '#B04500', '#A63E00', '#A13700', '#9B3200', '#952D00', '#8E2900', '#882300', '#821E00', '#7B1A00', '#771900', '#701400', '#6A0E00', '#660D00', '#5E0B00', '#5A0A02', '#560A05', '#520907', '#4C0505', '#470606', '#440607', '#3F0708', '#3B0607', '#3A070B', '#36080A'];

const hex2rgb = (h: string): number[] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r: number[]): string => '#' + r.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
/** Смешивает два hex-цвета: t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(A.map((v, i) => v + (B[i] - v) * t));
}
const lum = (h: string): number => { const [r, g, b] = hex2rgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

/** SRM → hex с линейной интерполяцией между целыми значениями. */
export function srmToHex(srm: number): string {
  const x = Math.max(1, Math.min(40, srm)); const i = Math.floor(x); const f = x - i;
  const a = SRM_RGB[i - 1], b = SRM_RGB[Math.min(40, i + 1) - 1];
  return f ? mix(a, b, f) : a;
}
/** Тройка цветов жидкости из SRM: верх светлее (свет сверху), низ темнее (толща); тёмное пиво — рубиновый отблеск. */
export function liquidFromSrm(srm: number, haze = 0): LiquidColors {
  let mid = srmToHex(srm);
  if (haze) mid = mix(mid, '#F6EEDC', haze * 0.35);
  const dark = srm >= 24;
  return { top: dark ? mix(mid, '#9A3A18', 0.30) : mix(mid, '#FFF6D6', 0.25), mid, bottom: mix(mid, '#150500', dark ? 0.30 : 0.38) };
}

// ─── детерминированная случайность ───────────────────────────────────────────
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ─── геометрия бокалов (viewBox 120×160, ось x = 60, «стол» ≈ y 148) ─────────
type Prof = [number, number][]; // [y, halfWidth] от кромки к дну чаши
interface GlassSpec {
  p: Prof; smooth?: boolean; ry?: number; fill: number;
  stem?: [number, number, number];   // [y стопы, полуширина ножки, полуширина стопы]
  base?: [number, number];           // [высота, нижняя полуширина] — литое толстое дно
  handle?: [number, number, number]; // [y1, y2, вынос]
  saucer?: [number, number];         // [y, rx]
  holder?: [number, number];         // подстаканник: [yTop, yBottom]
  thick?: boolean; ornament?: boolean; overflow?: boolean;
}
const G: Record<GlassId, GlassSpec> = {
  pilsner:      { p: [[16, 17], [36, 16], [92, 11.5], [116, 9]], smooth: true, fill: .8, stem: [144, 3, 15] },
  weizen:       { p: [[12, 18], [26, 19.5], [46, 17], [76, 12.5], [104, 12], [122, 14]], smooth: true, fill: .78, base: [22, 11], overflow: true },
  nonic:        { p: [[20, 19.5], [42, 19.5], [50, 21.3], [58, 19.8], [138, 15.5]], smooth: true, fill: .8, base: [8, 15] },
  mug:          { p: [[24, 20], [136, 19]], fill: .84, base: [10, 18], handle: [46, 118, 14], thick: true },
  becher:       { p: [[20, 15], [36, 17], [136, 13.5]], smooth: true, fill: .8, base: [8, 13] },
  stange:       { p: [[20, 12], [138, 11]], fill: .82, base: [8, 10.5] },
  tulip:        { p: [[26, 14], [36, 18.5], [56, 20], [76, 17], [92, 11], [100, 7]], smooth: true, fill: .72, stem: [144, 3.5, 16] },
  snifter:      { p: [[34, 13], [46, 21], [66, 23.5], [88, 18], [104, 9]], smooth: true, fill: .5, stem: [144, 4, 17] },
  tumbler:      { p: [[34, 17], [140, 15]], fill: .8, base: [6, 14.5] },
  white_wine:   { p: [[24, 15], [38, 18], [60, 18], [82, 13], [94, 5]], smooth: true, fill: .55, stem: [144, 2.6, 16] },
  red_wine:     { p: [[20, 17], [32, 22], [56, 23.5], [80, 17], [94, 6]], smooth: true, fill: .45, stem: [144, 2.8, 17] },
  spritz:       { p: [[16, 20], [30, 25], [56, 26], [80, 20], [94, 7]], smooth: true, fill: .7, stem: [144, 3, 18] },
  flute:        { p: [[14, 9], [44, 10.5], [84, 8.5], [106, 4.5]], smooth: true, fill: .78, stem: [144, 2.4, 14] },
  port:         { p: [[46, 11], [58, 13], [80, 12.5], [96, 8], [104, 4]], smooth: true, fill: .6, stem: [144, 2.4, 13] },
  copita:       { p: [[44, 11.5], [60, 12.5], [86, 9.5], [100, 4.5]], smooth: true, fill: .5, stem: [144, 2.4, 13] },
  coupe:        { p: [[40, 26], [48, 25], [60, 20], [70, 11], [74, 5]], smooth: true, ry: .18, fill: .78, stem: [144, 3, 18] },
  martini:      { p: [[40, 27], [84, 3]], ry: .17, fill: .72, stem: [144, 3, 18] },
  rocks:        { p: [[62, 22], [128, 20.5]], ry: .16, fill: .55, base: [14, 19.5], thick: true },
  highball:     { p: [[24, 14], [140, 13]], fill: .82, base: [6, 12.5] },
  glencairn:    { p: [[52, 12], [62, 15], [80, 18], [104, 15], [120, 9]], smooth: true, fill: .45, stem: [144, 6, 13] },
  shot:         { p: [[66, 13], [128, 10.5]], fill: .85, base: [16, 10], thick: true },
  piala:        { p: [[60, 34], [78, 30], [94, 18], [102, 12]], smooth: true, ry: .3, fill: .78, base: [6, 10], ornament: true },
  teacup:       { p: [[80, 22], [104, 20], [122, 14], [130, 9]], smooth: true, ry: .28, fill: .78, base: [4, 8], handle: [86, 118, 10], saucer: [138, 36] },
  podstakannik: { p: [[26, 13], [136, 12]], fill: .8, base: [8, 11.5], holder: [86, 140], handle: [92, 130, 11] },
  espresso:     { p: [[86, 16], [108, 15], [124, 11], [130, 7]], smooth: true, ry: .28, fill: .72, base: [4, 6], handle: [92, 118, 8], saucer: [138, 28] },
};
/** Русские названия бокалов (для подписей/гарантии полноты). */
export const GLASSES: Record<GlassId, string> = VISUALS.glasses as Record<GlassId, string>;
export const GLASS_IDS = Object.keys(G) as GlassId[];

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const CX = 60;

function hwAt(p: Prof, y: number): number {
  if (y <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][0]) { const [y0, h0] = p[i - 1], [y1, h1] = p[i]; return h0 + (h1 - h0) * (y - y0) / (y1 - y0); }
  }
  return p[p.length - 1][1];
}
interface XY { x: number; y: number }
/** Правая и левая (зеркальная, снизу вверх) стороны профиля как фрагменты path. */
function sides(p: Prof, smooth: boolean): { right: string; left: string } {
  const pts: XY[] = p.map(([y, hw]) => ({ x: CX + hw, y }));
  const m = (q: XY): string => `${f1(2 * CX - q.x)} ${f1(q.y)}`;
  const s = (q: XY): string => `${f1(q.x)} ${f1(q.y)}`;
  if (!smooth || pts.length < 3) {
    return { right: pts.slice(1).map(q => `L${s(q)}`).join(''), left: pts.slice(0, -1).reverse().map(q => `L${m(q)}`).join('') };
  }
  const segs: { a: XY; c1: XY; c2: XY; b: XY }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    segs.push({ a: p1, c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, b: p2 });
  }
  return {
    right: segs.map(g => `C${s(g.c1)} ${s(g.c2)} ${s(g.b)}`).join(''),
    left: segs.slice().reverse().map(g => `C${m(g.c2)} ${m(g.c1)} ${m(g.a)}`).join(''),
  };
}
/** Замкнутый контур чаши: передняя дуга кромки → правая стенка → дно → левая стенка. */
function bowlPath(p: Prof, smooth: boolean, ry: number, topArc = true): string {
  const [y0, hw0] = p[0]; const [yB, hwB] = p[p.length - 1];
  const { right, left } = sides(p, smooth);
  const top = topArc ? `A${f1(hw0)} ${f1(hw0 * ry)} 0 0 0 ${f1(CX + hw0)} ${f1(y0)}` : `L${f1(CX + hw0)} ${f1(y0)}`;
  return `M${f1(CX - hw0)} ${f1(y0)}${top}${right}Q${CX} ${f1(yB + hwB * 0.35)} ${f1(CX - hwB)} ${f1(yB)}${left}Z`;
}
const ell = (cy: number, rx: number, ry: number, attrs: string): string => `<ellipse cx="${CX}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}" ${attrs}/>`;
const arc = (cy: number, rx: number, ry: number, front: boolean, attrs: string): string =>
  `<path d="M${f1(CX - rx)} ${f1(cy)}A${f1(rx)} ${f1(ry)} 0 0 ${front ? 0 : 1} ${f1(CX + rx)} ${f1(cy)}" fill="none" ${attrs}/>`;

// ─── разрешение визуала ──────────────────────────────────────────────────────
const CARB_DEFAULT: Record<string, number> = { beer: .6, na_beer: .6, radler: .8, cider: .7, sparkling: 1, lemonade: .9, soda: .9, kvass: .6, dairy: .1, water: .5 };
const GARNISH_CATS = new Set(['cocktail', 'lemonade', 'soda', 'spirit', 'liqueur']);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function garnishFromTags(tags: Record<string, number>): GarnishId[] {
  const t = (k: string): number => tags[k] ?? 0;
  const out: GarnishId[] = [];
  if (t('bitter_orange') >= .6) out.push('orange_peel');
  else if (t('citrus') >= .6) out.push(t('juniper') >= .5 || t('agave') >= .5 ? 'lime_wedge' : 'lemon_wheel');
  if (t('cherry') >= .4) out.push('cherry');
  if (t('mint') >= .4) out.push('mint');
  if (t('cucumber') >= .4) out.push('cucumber');
  if (t('warm_spice') >= .7) out.push('cinnamon');
  return out.slice(0, 2);
}

/** Собирает итоговый визуал по цепочке фолбэков; экспортирован для отладки и галереи. */
export function resolveVisual(input: DrinkArtInput): ResolvedVisual {
  const layers: string[] = [];
  const v: DrinkVisual = {};
  const put = (src: DrinkVisual | undefined | null, name: string): void => {
    if (!src) return;
    for (const [k, val] of Object.entries(src)) if (val !== undefined && val !== null && k !== 'category') (v as Record<string, unknown>)[k] = val;
    layers.push(name);
  };
  put(VISUALS.categories[input.category] ?? VISUALS.categories['beer'], 'category:' + (VISUALS.categories[input.category] ? input.category : 'beer'));
  const fam = input.family ? VISUALS.families[input.family.toUpperCase()] : undefined;
  if (fam) put(fam, 'family:' + input.family!.toUpperCase());
  const arch = input.archetype ? VISUALS.archetypes[input.archetype] : undefined;
  if (arch) put(arch, 'archetype:' + input.archetype);
  if (input.serving) {
    const g = input.serving.glass ? VISUALS.serving_glass_aliases_ru[input.serving.glass.trim().toLowerCase()] : undefined;
    const ice = input.serving.ice;
    const s: DrinkVisual = {};
    if (g && g in G) s.glass = g as GlassId;
    if (ice === 'none' || ice === 'large_cube' || ice === 'cubes' || ice === 'crushed') s.ice = ice;
    if (s.glass || s.ice) put(s, 'serving');
  }
  if (input.visual) put(input.visual, 'visual');

  const haze = clamp01(v.haze ?? 0);
  // liquid: явные цвета важнее; srm из per-drink override пересчитывает цвет
  let liquid: LiquidColors | undefined = v.liquid;
  if (input.visual?.srm != null && !input.visual.liquid) liquid = liquidFromSrm(input.visual.srm, haze);
  if (!liquid) liquid = v.srm != null ? liquidFromSrm(v.srm, haze) : { top: '#F4DDA3', mid: '#E5B849', bottom: '#9D6F22' };
  const sens = input.sensory ?? {};
  const temp = sens['serve_temp'];
  const carb = v.bubbles ?? sens['carbonation'] ?? CARB_DEFAULT[input.category] ?? 0;
  let garnish = (v.garnish ?? []).slice();
  if (!garnish.length && !arch && !input.visual?.garnish && GARNISH_CATS.has(input.category) && input.aroma_tags) garnish = garnishFromTags(input.aroma_tags);
  return {
    glass: (v.glass && v.glass in G ? v.glass : 'tumbler') as GlassId,
    liquid: { top: liquid.top, mid: liquid.mid, bottom: liquid.bottom, opacity: liquid.opacity ?? 1 },
    foam: { height: clamp01(v.foam?.height ?? 0), color: v.foam?.color ?? '#FFF8EA' },
    garnish, ice: v.ice ?? 'none', rim: v.rim ?? 'none', haze,
    fill: clamp01(v.fill ?? G[(v.glass && v.glass in G ? v.glass : 'tumbler') as GlassId].fill),
    bubbles: clamp01(carb),
    steam: v.steam ?? (temp != null && temp >= 50),
    condensation: v.condensation ?? (temp != null && temp <= 8),
    anchor: v.anchor ?? null, source: layers.join(' → '),
  };
}

// ─── гарнир ──────────────────────────────────────────────────────────────────
function wheel(cx: number, cy: number, r: number, rot: number, rind: string, flesh: string, seg: string): string {
  const lines: string[] = [];
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; lines.push(`M${f1(cx)} ${f1(cy)}l${f1(Math.cos(a) * (r - 1.6))} ${f1(Math.sin(a) * (r - 1.6))}`); }
  return `<g transform="rotate(${f1(rot)} ${f1(cx)} ${f1(cy)})"><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="${rind}"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r - 1.4)}" fill="${flesh}"/><path d="${lines.join('')}" stroke="${seg}" stroke-width=".7" stroke-opacity=".85"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r - 1.4)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".6"/></g>`;
}
function wedge(cx: number, cy: number, r: number, a1: number, a2: number, rind: string, flesh: string): string {
  const P = (rr: number, a: number): string => `${f1(cx + rr * Math.cos(a))} ${f1(cy + rr * Math.sin(a))}`;
  const mid = (a1 + a2) / 2;
  return `<path d="M${f1(cx)} ${f1(cy)}L${P(r, a1)}A${f1(r)} ${f1(r)} 0 0 1 ${P(r, a2)}Z" fill="${rind}"/><path d="M${f1(cx)} ${f1(cy)}L${P(r - 1.6, a1 + .08)}A${f1(r - 1.6)} ${f1(r - 1.6)} 0 0 1 ${P(r - 1.6, a2 - .08)}Z" fill="${flesh}"/><path d="M${f1(cx)} ${f1(cy)}L${P(r - 2, mid)}" stroke="#fff" stroke-opacity=".6" stroke-width=".6"/>`;
}

// ─── рендер ──────────────────────────────────────────────────────────────────
/** Возвращает самодостаточную SVG-строку иллюстрации напитка. */
export function drinkArtSvg(input: DrinkArtInput, opts: DrinkArtOptions = {}): string {
  const R = resolveVisual(input);
  const spec = G[R.glass];
  const P = opts.idPrefix ?? 'da' + hash32(input.id).toString(36);
  const rnd = rng(hash32(input.id + '|' + R.glass));
  const ry = spec.ry ?? .15;
  const [y0, hw0] = spec.p[0]; const [yB, hwB] = spec.p[spec.p.length - 1];
  const H = yB - y0;
  const fillY = yB - R.fill * H;
  const rxS = Math.max(1, hwAt(spec.p, fillY) - .6), ryS = rxS * ry;
  let W = 0; for (let y = fillY; y <= yB; y += 2) W = Math.max(W, hwAt(spec.p, y));
  const bowl = bowlPath(spec.p, !!spec.smooth, ry);
  const bowlExt = bowlPath([[y0 - 18, hw0], ...spec.p], !!spec.smooth, ry, false);
  const L = R.liquid; const lightLiquid = lum(L.mid);
  const o: string[] = [];
  const defs: string[] = [];

  // — defs
  defs.push(`<linearGradient id="${P}l" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(fillY)}" x2="0" y2="${f1(yB)}"><stop offset="0" stop-color="${L.top}"/><stop offset=".42" stop-color="${L.mid}"/><stop offset="1" stop-color="${L.bottom}"/></linearGradient>`);
  defs.push(`<linearGradient id="${P}s" gradientUnits="userSpaceOnUse" x1="${f1(CX - W)}" y1="0" x2="${f1(CX + W)}" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".34"/><stop offset=".11" stop-color="#000" stop-opacity=".05"/><stop offset=".17" stop-color="#fff" stop-opacity=".10"/><stop offset=".26" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".30"/></linearGradient>`);
  defs.push(`<linearGradient id="${P}g" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(y0)}" x2="0" y2="${f1(yB)}"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".5" stop-color="#fff" stop-opacity=".025"/><stop offset="1" stop-color="#fff" stop-opacity=".07"/></linearGradient>`);
  defs.push(`<radialGradient id="${P}r"><stop offset="0" stop-color="currentColor" stop-opacity=".14"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient>`);
  defs.push(`<clipPath id="${P}c"><path d="${bowl}"/></clipPath>`);
  const foamH = R.foam.height * 26;
  let foamTop = fillY - foamH;
  if (foamH > 0) {
    foamTop = spec.overflow ? Math.max(foamTop, y0 - 9) : Math.max(foamTop, y0 + 1.5);
    defs.push(`<clipPath id="${P}e"><path d="${bowlExt}"/></clipPath>`);
    const fc = R.foam.color;
    defs.push(`<linearGradient id="${P}f" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(foamTop)}" x2="0" y2="${f1(fillY)}"><stop offset="0" stop-color="${mix(fc, '#FFFFFF', .5)}"/><stop offset=".55" stop-color="${fc}"/><stop offset="1" stop-color="${mix(fc, L.top, .45)}"/></linearGradient>`);
  }

  // — стол (отражение/тень под бокалом)
  const groundY = spec.saucer ? spec.saucer[0] + spec.saucer[1] * .22 + 1 : spec.stem ? spec.stem[0] + spec.stem[2] * .22 + 1 : spec.base ? yB + spec.base[0] + 1 : yB + 2;
  const groundR = Math.max(spec.saucer ? spec.saucer[1] : 0, spec.stem ? spec.stem[2] : 0, spec.base ? spec.base[1] : hwB) + 7;
  o.push(ell(groundY, groundR, 3.4, `fill="url(#${P}r)"`));

  const line = (d: string, op: number, w: number, extra = ''): string => `<path d="${d}" fill="none" stroke="currentColor" stroke-opacity="${op}" stroke-width="${w}" stroke-linecap="round"${extra}/>`;
  const hi = (d: string, op: number, w: number): string => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${op}" stroke-width="${w}" stroke-linecap="round"/>`;

  // — блюдце (под чашкой)
  if (spec.saucer) {
    const [sy, srx] = spec.saucer; const sry = srx * .22;
    o.push(ell(sy, srx, sry, `fill="#fff" fill-opacity=".07"`), ell(sy, srx, sry, `fill="currentColor" fill-opacity=".035"`));
    o.push(arc(sy, srx, sry, false, `stroke="currentColor" stroke-opacity=".22" stroke-width=".8"`), arc(sy, srx, sry, true, `stroke="currentColor" stroke-opacity=".45" stroke-width="1.1"`));
    o.push(ell(sy - .6, srx * .5, sry * .5, `fill="none" stroke="currentColor" stroke-opacity=".16" stroke-width=".7"`));
  }
  // — ножка и стопа (до чаши)
  if (spec.stem) {
    const [fy, sw, fhw] = spec.stem; const fry = fhw * .22;
    o.push(`<path d="M${f1(CX - sw)} ${f1(yB - 1)}L${f1(CX - sw * 1.7)} ${f1(fy - 1.5)}L${f1(CX + sw * 1.7)} ${f1(fy - 1.5)}L${f1(CX + sw)} ${f1(yB - 1)}Z" fill="#fff" fill-opacity=".08" stroke="currentColor" stroke-opacity=".42" stroke-width="1" stroke-linejoin="round"/>`);
    o.push(hi(`M${f1(CX - sw * .35)} ${f1(yB + 3)}L${f1(CX - sw * .5)} ${f1(fy - 4)}`, .35, .8));
    o.push(ell(fy, fhw, fry, `fill="#fff" fill-opacity=".07"`), ell(fy, fhw, fry, `fill="currentColor" fill-opacity=".03"`));
    o.push(arc(fy, fhw, fry, false, `stroke="currentColor" stroke-opacity=".22" stroke-width=".8"`), arc(fy, fhw, fry, true, `stroke="currentColor" stroke-opacity=".45" stroke-width="1.1"`));
  }
  // — литое дно
  if (spec.base) {
    const [bh, bhw] = spec.base; const by = yB + bh;
    o.push(`<path d="M${f1(CX - hwB)} ${f1(yB)}L${f1(CX - bhw)} ${f1(by)}Q${CX} ${f1(by + bhw * .3)} ${f1(CX + bhw)} ${f1(by)}L${f1(CX + hwB)} ${f1(yB)}" fill="#fff" fill-opacity=".13" stroke="currentColor" stroke-opacity=".42" stroke-width="1.1" stroke-linejoin="round"/>`);
    if (bh >= 8) o.push(hi(`M${f1(CX - bhw * .6)} ${f1(yB + bh * .55)}Q${CX} ${f1(yB + bh * .55 + 2)} ${f1(CX + bhw * .6)} ${f1(yB + bh * .55)}`, .3, .8));
  }
  // — подстаканник (задняя часть под стаканом рисуется вместе с передней — металл непрозрачен)
  // — стекло чаши (тон + блик)
  o.push(`<path d="${bowl}" fill="url(#${P}g)"/><path d="${bowl}" fill="currentColor" fill-opacity=".035"/>`);

  // — жидкость
  const liq: string[] = [];
  liq.push(`<rect x="${f1(CX - W - 1)}" y="${f1(fillY)}" width="${f1(2 * W + 2)}" height="${f1(yB + 12 - fillY)}" fill="url(#${P}l)"/>`);
  liq.push(`<rect x="${f1(CX - W - 1)}" y="${f1(fillY)}" width="${f1(2 * W + 2)}" height="${f1(yB + 12 - fillY)}" fill="url(#${P}s)"/>`);
  if (R.ice === 'none' && R.foam.height === 0) liq.push(ell(fillY, rxS, ryS, `fill="${mix(L.top, '#FFFFFF', .32)}" fill-opacity=".9"`), ell(fillY, rxS, ryS, `fill="none" stroke="#fff" stroke-opacity=".38" stroke-width=".6"`));
  else if (R.foam.height === 0) liq.push(ell(fillY, rxS, ryS, `fill="${mix(L.top, '#FFFFFF', .3)}" fill-opacity=".85"`));
  // пузырьки
  const n = Math.round(R.bubbles * (R.bubbles >= .95 ? 30 : 22) * (1 - R.haze * .5) * (input.category === 'dairy' ? .5 : 1));
  const bubbleOp = .28 + .42 * (1 - Math.min(1, lightLiquid * 1.1)) + (lightLiquid < .25 ? .1 : 0);
  const bub: string[] = [];
  const span = yB - fillY;
  if (n > 0 && span > 8) {
    const fine = R.bubbles >= .95 && R.foam.height === 0; // игристое: мелкий бисер и «нить»
    for (let i = 0; i < n; i++) {
      const y = fillY + 4 + rnd() * (span - 7);
      const hw = Math.max(1, hwAt(spec.p, y) - 2.2);
      const x = CX + (rnd() * 2 - 1) * hw * (fine && i % 3 === 0 ? .12 : .92);
      const r = fine ? .35 + rnd() * .5 : .45 + rnd() * .95;
      const op = Math.min(.85, bubbleOp * (.6 + rnd() * .6));
      const anim = opts.animate ? ` class="${P}b" style="--t:${f1(2.6 + rnd() * 2.6)}s;--d:-${f1(rnd() * 4)}s;--h:-${f1(Math.min(14, y - fillY - 3))}px"` : '';
      bub.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="#fff" fill-opacity="${f1(op)}"${anim}/>`);
    }
  }
  const liquidOpacity = L.opacity < 1 ? ` opacity="${L.opacity}"` : '';
  o.push(`<g clip-path="url(#${P}c)"${liquidOpacity}>${liq.join('')}</g>`);
  if (bub.length) o.push(`<g clip-path="url(#${P}c)">${bub.join('')}</g>`);

  // — гарнир внутри бокала (под льдом)
  const inner: string[] = [];
  for (const g of R.garnish) {
    if (g === 'orange_slice') { const hw = hwAt(spec.p, fillY + 8); inner.push(wheel(CX + hw * .42, fillY + 3, 9, 18 + rnd() * 10, '#F08A2A', '#FBBE6C', '#E9862E')); }
    if (g === 'cherry') {
      const cy = yB - 6.5, cx = CX - 2.5;
      inner.push(`<path d="M${f1(cx + 1)} ${f1(cy - 3.5)}Q${f1(cx + 4)} ${f1(cy - 12)} ${f1(cx + 9)} ${f1(cy - 15)}" fill="none" stroke="#6B3A1E" stroke-width=".9" stroke-linecap="round"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="4.2" fill="#B2122E"/><ellipse cx="${f1(cx - 1.4)}" cy="${f1(cy - 1.5)}" rx="1.3" ry=".8" fill="#fff" fill-opacity=".5"/>`);
    }
    if (g === 'olive') {
      const cy = fillY + 8, cx = CX - 4;
      inner.push(`<path d="M${f1(cx + 14)} ${f1(y0 - 8)}L${f1(cx - 6)} ${f1(cy + 6)}" stroke="#2A2A2A" stroke-opacity=".8" stroke-width=".9" stroke-linecap="round"/><ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="4.2" ry="3" transform="rotate(-30 ${f1(cx)} ${f1(cy)})" fill="#7A8F3A"/><circle cx="${f1(cx + 1.6)}" cy="${f1(cy - .8)}" r="1.1" fill="#C0392B"/>`);
    }
    if (g === 'cucumber') { const hw = hwAt(spec.p, fillY + 8); inner.push(wheel(CX - hw * .4, fillY + 6, 8, -12, '#8DBB6A', '#DCEDC0', '#B7D89A')); }
  }
  if (inner.length) o.push(`<g clip-path="url(#${P}c)">${inner.join('')}</g>`);

  // — лёд
  const ice: string[] = [];
  const cube = (cx: number, cy: number, s: number, rot: number): string =>
    `<g transform="rotate(${f1(rot)} ${f1(cx)} ${f1(cy)})"><rect x="${f1(cx - s / 2)}" y="${f1(cy - s / 2)}" width="${f1(s)}" height="${f1(s)}" rx="${f1(s * .12)}" fill="#fff" fill-opacity=".2" stroke="currentColor" stroke-opacity=".36" stroke-width=".8"/><path d="M${f1(cx - s / 2 + 2)} ${f1(cy + s / 2 - 2.5)}L${f1(cx - s / 2 + 2)} ${f1(cy - s / 2 + 2)}L${f1(cx + s / 2 - 3)} ${f1(cy - s / 2 + 2)}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.1" stroke-linecap="round"/><path d="M${f1(cx - s * .1)} ${f1(cy + s * .35)}L${f1(cx + s * .35)} ${f1(cy - s * .1)}" stroke="#fff" stroke-opacity=".28" stroke-width=".8"/></g>`;
  if (R.ice === 'large_cube') ice.push(cube(CX + 1, fillY + 10, Math.min(31, W * 1.5), -7 + rnd() * 4));
  else if (R.ice === 'cubes') {
    const count = span > 70 ? 4 : 3; const s = Math.min(14, W * .72);
    for (let i = 0; i < count; i++) { const y = fillY + 4 + i * (s + 1.5) + (i ? 0 : -2); const hw = hwAt(spec.p, y) - s * .55; ice.push(cube(CX + (i % 2 ? .45 : -.4) * hw + (rnd() - .5) * 3, y + s / 2, s - i * .6, (rnd() - .5) * 48)); }
  } else if (R.ice === 'crushed') {
    for (let i = 0; i < 16; i++) { const y = fillY + 3 + rnd() * span * .6; const hw = hwAt(spec.p, y) - 3; ice.push(`<circle cx="${f1(CX + (rnd() * 2 - 1) * hw)}" cy="${f1(y)}" r="${f1(1.4 + rnd() * 1.6)}" fill="#fff" fill-opacity=".38" stroke="currentColor" stroke-opacity=".18" stroke-width=".5"/>`); }
  }
  if (ice.length) o.push(`<g clip-path="url(#${P}c)">${ice.join('')}</g>`);

  // — пена
  if (foamH > 0) {
    const x0 = CX - W - 6, x1 = CX + W + 6;
    let d = `M${f1(x0)} ${f1(foamTop + 2)}`; let x = x0;
    const big = Math.max(.45, Math.min(1.5, foamH / 11)); // высокая пена — крупнее «облака», тонкая пенка — мелкий бисер
    while (x < x1) { const s = (4 + rnd() * 5) * big; const r = s / 2; d += `a${f1(r)} ${f1(r * (.7 + rnd() * .5))} 0 0 1 ${f1(s)} ${f1((rnd() - .5) * 1.2 * big)}`; x += s; }
    const body = d + `L${f1(x1)} ${f1(fillY)}L${f1(CX + rxS)} ${f1(fillY)}A${f1(rxS)} ${f1(ryS)} 0 0 1 ${f1(CX - rxS)} ${f1(fillY)}L${f1(x0)} ${f1(fillY)}Z`;
    const fm: string[] = [`<path d="${body}" fill="url(#${P}f)"/>`];
    const fb = Math.max(2, Math.round(foamH / 3));
    for (let i = 0; i < fb; i++) { const y = foamTop + 3 + rnd() * Math.max(1, foamH - 5); const hw = hwAt(spec.p, Math.max(y0, y)) - 3; fm.push(`<circle cx="${f1(CX + (rnd() * 2 - 1) * hw)}" cy="${f1(y)}" r="${f1(.5 + rnd() * .9)}" fill="none" stroke="${mix(R.foam.color, '#5A3A10', .35)}" stroke-opacity=".35" stroke-width=".5"/>`); }
    fm.push(`<path d="${d}" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width=".7" stroke-linejoin="round"/>`);
    o.push(`<g clip-path="url(#${P}e)">${fm.join('')}</g>`);
  }

  // — контур чаши, кромка, блики
  o.push(line(bowl, .44, 1.1));
  o.push(arc(y0, hw0, hw0 * ry, false, `stroke="currentColor" stroke-opacity=".26" stroke-width=".8"`));
  if (spec.thick) o.push(line(bowlPath(spec.p.map(([y, hw], i) => [i === 0 ? y + 2.5 : y - 2.2, hw - 2.2] as [number, number]), !!spec.smooth, ry, false), .14, .7));
  {
    const ya = y0 + H * .12, yb = yB - H * .1, ym = (ya + yb) / 2;
    const xa = CX - hwAt(spec.p, ya) * .74, xb = CX - hwAt(spec.p, yb) * .74, xm = CX - hwAt(spec.p, ym) * .74;
    o.push(hi(`M${f1(xa)} ${f1(ya)}Q${f1(2 * xm - (xa + xb) / 2)} ${f1(ym)} ${f1(xb)} ${f1(yb)}`, .42, 2));
    const yc = y0 + H * .3, yd = y0 + H * .75;
    o.push(hi(`M${f1(CX + hwAt(spec.p, yc) * .82)} ${f1(yc)}L${f1(CX + hwAt(spec.p, yd) * .82)} ${f1(yd)}`, .18, .9));
  }
  // — орнамент пиалы (золотая полоса под кромкой)
  if (spec.ornament) { const yo = y0 + 7; const rx = hwAt(spec.p, yo); o.push(arc(yo, rx, rx * ry, true, `stroke="#E5B849" stroke-opacity=".7" stroke-width=".9"`), arc(yo + 2.4, rx - .6, (rx - .6) * ry, true, `stroke="#E5B849" stroke-opacity=".45" stroke-width=".5" stroke-dasharray="1 1.6"`)); }
  // — подстаканник
  if (spec.holder) {
    const [ht, hb] = spec.holder; const w1 = hwAt(spec.p, ht) + 1.8, w2 = hwAt(spec.p, Math.min(yB, hb)) + 2.2;
    defs.push(`<linearGradient id="${P}m" gradientUnits="userSpaceOnUse" x1="${f1(CX - w2)}" y1="0" x2="${f1(CX + w2)}" y2="0"><stop offset="0" stop-color="#9D6F22"/><stop offset=".3" stop-color="#F4DDA3"/><stop offset=".55" stop-color="#E5B849"/><stop offset="1" stop-color="#9D6F22"/></linearGradient>`);
    o.push(`<path d="M${f1(CX - w1)} ${f1(ht)}L${f1(CX - w2)} ${f1(hb)}Q${CX} ${f1(hb + w2 * .3)} ${f1(CX + w2)} ${f1(hb)}L${f1(CX + w1)} ${f1(ht)}Q${CX} ${f1(ht + w1 * .3)} ${f1(CX - w1)} ${f1(ht)}Z" fill="url(#${P}m)" fill-opacity=".55" stroke="#9D6F22" stroke-opacity=".8" stroke-width=".8" stroke-linejoin="round"/>`);
    o.push(`<path d="M${f1(CX - w1 + .8)} ${f1(ht + 4)}Q${CX} ${f1(ht + 4 + w1 * .3)} ${f1(CX + w1 - .8)} ${f1(ht + 4)}M${f1(CX - w2 + 1)} ${f1(hb - 5)}Q${CX} ${f1(hb - 5 + w2 * .3)} ${f1(CX + w2 - 1)} ${f1(hb - 5)}" fill="none" stroke="#F4DDA3" stroke-opacity=".6" stroke-width=".6"/>`);
    for (let i = -2; i <= 2; i++) { const x = CX + i * w1 * .38; o.push(`<path d="M${f1(x)} ${f1(ht + 9)}l0 ${f1(hb - ht - 18)}" stroke="#F4DDA3" stroke-opacity=".35" stroke-width=".5"/><path d="M${f1(x)} ${f1(ht + 14)}l2.2 4.5 -2.2 4.5 -2.2 -4.5z" fill="#F4DDA3" fill-opacity=".35"/>`); }
  }
  // — ручка
  if (spec.handle) {
    const [h1, h2, out] = spec.handle; const gold = !!spec.holder;
    const x1 = CX + hwAt(spec.p, h1) + (gold ? 1.8 : 0), x2 = CX + hwAt(spec.p, h2) + (gold ? 2 : 0);
    const d = `M${f1(x1)} ${f1(h1)}C${f1(x1 + out + 4)} ${f1(h1 - 1)} ${f1(x2 + out + 4)} ${f1(h2 + 1)} ${f1(x2)} ${f1(h2)}`;
    if (gold) o.push(`<path d="${d}" fill="none" stroke="#9D6F22" stroke-width="4.4" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#E5B849" stroke-width="2.6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#F4DDA3" stroke-opacity=".8" stroke-width=".8" stroke-linecap="round"/>`);
    else o.push(`<path d="${d}" fill="none" stroke="currentColor" stroke-opacity=".44" stroke-width="4.4" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2.6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width=".7" stroke-linecap="round"/>`);
  }
  // — конденсат
  if (R.condensation && span > 14) {
    const cd: string[] = [];
    for (let i = 0; i < 9; i++) {
      const y = fillY + 5 + rnd() * (span - 9); const hw = hwAt(spec.p, y) - 2.5; const x = CX + (rnd() * 1.6 - .4) * hw;
      const r = .55 + rnd() * .7;
      cd.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="#fff" fill-opacity=".5"/>`);
      if (i % 4 === 0) cd.push(`<path d="M${f1(x)} ${f1(y)}v${f1(3 + rnd() * 4)}" stroke="#fff" stroke-opacity=".28" stroke-width="${f1(r * 1.1)}" stroke-linecap="round"/>`);
    }
    o.push(`<g clip-path="url(#${P}c)">${cd.join('')}</g>`);
  }
  // — кромка: соль/сахар
  if (R.rim !== 'none') {
    const dash = R.rim === 'salt' ? '.1 2.1' : '.1 1.3'; const w = R.rim === 'salt' ? 1.8 : 1.2;
    o.push(ell(y0, hw0 + .3, hw0 * ry + .3, `fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="${f1(w + .9)}" stroke-dasharray="${dash}" stroke-linecap="round"`));
    o.push(ell(y0, hw0 + .3, hw0 * ry + .3, `fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="${w}" stroke-dasharray="${dash}" stroke-linecap="round"`));
  }
  // — гарнир на кромке
  const rimR = CX + hw0;
  for (const g of R.garnish) {
    if (g === 'lemon_wheel') o.push(wheel(rimR - 3, y0 - 1, 8.5, -12 + rnd() * 20, '#EFC63A', '#FBEC93', '#E6B62C'));
    if (g === 'orange_wheel') o.push(wheel(rimR - 3, y0 - 1, 8, -12 + rnd() * 20, '#F08A2A', '#FBBE6C', '#E9862E'));
    if (g === 'lime_wedge') o.push(wedge(rimR - 5, y0 + 1, 9.5, -1.15, 0.25, '#6FAE4E', '#C4E39B'));
    if (g === 'orange_peel' || g === 'lemon_twist') {
      const c = g === 'orange_peel' ? '#F0862B' : '#F0D040', c2 = g === 'orange_peel' ? '#FBC26B' : '#FBF0A0';
      const d = `M${f1(rimR - 8)} ${f1(fillY + 8)}C${f1(rimR - 3)} ${f1(fillY - 2)} ${f1(rimR + 5)} ${f1(y0 - 9)} ${f1(rimR - 1)} ${f1(y0 - 11)}S${f1(rimR - 8)} ${f1(y0 - 5)} ${f1(rimR - 4)} ${f1(y0 - 2)}`;
      o.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c2}" stroke-opacity=".8" stroke-width=".8" stroke-linecap="round"/>`);
    }
    if (g === 'mint') {
      const bx = CX + hw0 * .5, by = y0 + 1;
      let s = `<path d="M${f1(bx)} ${f1(by)}Q${f1(bx + 1.5)} ${f1(by - 8)} ${f1(bx + 1)} ${f1(by - 16)}" fill="none" stroke="#3E7A3E" stroke-width=".9" stroke-linecap="round"/>`;
      const leaf = (x: number, y: number, rot: number, r: number): string => `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(r)}" ry="${f1(r * .55)}" transform="rotate(${rot} ${f1(x)} ${f1(y)})" fill="#5FA85E" stroke="#3E7A3E" stroke-width=".5"/>`;
      s += leaf(bx - 3, by - 5, -35, 3.4) + leaf(bx + 4.5, by - 8, 30, 3.2) + leaf(bx - 2.5, by - 11, -40, 3) + leaf(bx + 3.5, by - 14, 20, 2.6) + leaf(bx + .8, by - 17.5, -80, 2.4);
      o.push(s);
    }
    if (g === 'rosemary') {
      const bx = CX + hw0 * .4, by = y0 + 2; let s = `<path d="M${f1(bx)} ${f1(by)}L${f1(bx + 3)} ${f1(by - 20)}" fill="none" stroke="#4E7A4E" stroke-width=".9" stroke-linecap="round"/>`;
      for (let i = 1; i < 9; i++) { const x = bx + i * .36, y = by - i * 2.3; s += `<path d="M${f1(x)} ${f1(y)}l-2.6 -1.4M${f1(x)} ${f1(y)}l2.6 -1.2" stroke="#5F9A5B" stroke-width=".7" stroke-linecap="round"/>`; }
      o.push(s);
    }
    if (g === 'cinnamon') { const cx = CX + hw0 * .45; o.push(`<rect x="${f1(cx - 1.6)}" y="${f1(y0 - 10)}" width="3.2" height="${f1(fillY - y0 + 22)}" rx="1.4" transform="rotate(14 ${f1(cx)} ${f1(fillY)})" fill="#8B4A22" stroke="#5C2E12" stroke-width=".5"/>`); }
    if (g === 'smoke') {
      const d1 = `M${f1(CX - 4)} ${f1(y0 - 3)}c-5 -6 5 -10 -1 -18c-4 -6 4 -9 0 -15`, d2 = `M${f1(CX + 5)} ${f1(y0 - 2)}c5 -7 -5 -11 1 -19c4 -6 -4 -9 0 -14`;
      o.push(`<g fill="none" stroke="currentColor" stroke-opacity=".14" stroke-width="1.4" stroke-linecap="round"${opts.animate ? ` class="${P}s"` : ''}><path d="${d1}"/><path d="${d2}"/></g>`);
    }
  }
  // — пар
  if (R.steam) {
    const y = y0 - 4;
    o.push(`<g fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="1.3" stroke-linecap="round"${opts.animate ? ` class="${P}s"` : ''}><path d="M${f1(CX - 9)} ${f1(y)}c-3 -5 3 -8 0 -14c-2 -4 1 -6 0 -9"/><path d="M${f1(CX)} ${f1(y - 2)}c-4 -6 4 -10 0 -17c-3 -5 2 -8 0 -12"/><path d="M${f1(CX + 9)} ${f1(y)}c-3 -5 3 -8 0 -14c-2 -4 1 -6 0 -9"/></g>`);
  }

  // — сборка
  const size = opts.size;
  const dims = size ? ` width="${Math.round(size * .75)}" height="${size}"` : '';
  const a11y = opts.label ? ` role="img" aria-label="${opts.label.replace(/"/g, '&quot;')}"` : ' aria-hidden="true"';
  const style = opts.animate
    ? `<style>.${P}b{animation:${P}r var(--t,4s) linear var(--d,0s) infinite}@keyframes ${P}r{to{transform:translateY(var(--h,-12px));opacity:0}}.${P}s{animation:${P}f 3.2s ease-in-out infinite alternate}@keyframes ${P}f{from{opacity:.55}to{opacity:1}}@media(prefers-reduced-motion:reduce){.${P}b,.${P}s{animation:none}}</style>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"${dims}${a11y} class="ft-drink-art" data-glass="${R.glass}"><defs>${defs.join('')}</defs>${style}${o.join('')}</svg>`;
}
