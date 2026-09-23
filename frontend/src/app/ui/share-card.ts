/**
 * Карточки для сторис (JPEG 1080×1920) — «Дастархан» (стол) и пара «блюдо + напиток». Чистый DOM/canvas, без Angular.
 *
 *   const blob = await renderTableCard(data);   // блюда стола, один напиток на всех, сет бокалов в порядке подачи
 *   const blob = await renderPairCard(data);    // фото блюда, бокал, балл, 1–2 причины движка
 *   await shareImage(blob, { filename: `flavor-tree-table.${SHARE_IMAGE_EXT}`, title, text });   // share с файлом или скачивание
 *
 * Здесь ничего не считается: балл, среднее, слабейшая пара, порядок сета и тексты причин приходят от вызывающего —
 * из движка (scorePair / planTable). Фото блюд — data/dish_photos.json (свой origin, img/dishes/*.webp), внизу карточки —
 * авторы и лицензии только тех фото, что на карточке; бокал — drinkArtSvg (строка SVG → Blob URL → Image). Нет фото
 * или бокала — плитка с эмодзи. Весь текст — в безопасной зоне сторис (SAFE_TOP..SAFE_BOTTOM): сверху Instagram рисует
 * шкалу и аватар, снизу — поле ответа. Шрифты ждём через document.fonts (параллельно с картинками); цифры — Cormorant
 * Garamond с включённым lnum (как .num в styles.css), без сети — Inter Light, при следующей карточке пробуем снова.
 * Кодируем в JPEG (фото и градиенты: в 3–4 раза быстрее PNG и в ~8 раз меньше). Размер задан сторис (1080×1920) и от
 * devicePixelRatio не зависит; opts.scale — для крупных превью.
 */
import photosJson from '../../../../data/dish_photos.json';
import { DrinkArtInput, drinkArtSvg, resolveVisual } from './drink-art';

export const STORY_W = 1080;
export const STORY_H = 1920;
/**
 * Безопасная зона сторис: текст и главное — между этими линиями. Instagram закрывает сверху ≈ 14 % (шкала прогресса,
 * аватар, имя) и снизу ≈ 250 px (поле «Отправить сообщение» и градиент под ним).
 */
export const SAFE_TOP = 236;
export const SAFE_BOTTOM = 1664;
/** Формат файла карточки: фото и градиенты — JPEG (PNG кодируется в 3–4 раза дольше и весит в ~8 раз больше). */
export const SHARE_IMAGE_TYPE = 'image/jpeg';
export const SHARE_IMAGE_EXT = 'jpg';
const JPEG_QUALITY = 0.92;

/** Блюдо на карточке. Фото и подпись автора берутся из data/dish_photos.json по id (или photo — свой путь того же origin). */
export interface ShareDish {
  id: string;
  name: string;
  emoji?: string | null;
  photo?: string | null;
}

/** Напиток на карточке: запись каталога v2 (DrinkV2) подходит как есть. */
export interface ShareDrink {
  id: string;
  name: string;
  category: string;
  archetype?: string | null;
  family?: string | null;
  style?: { archetype?: string | null; family?: string | null } | null;
  sensory?: DrinkArtInput['sensory'];
  aroma_tags?: DrinkArtInput['aroma_tags'];
  serving?: DrinkArtInput['serving'];
  visual?: DrinkArtInput['visual'];
  /** Подпись под названием, например «Коктейль · 11 %». */
  sub?: string | null;
}

export interface ShareCardCommonLabels {
  /** Подвал: честная оговорка о том, откуда балл. */
  footer: string;
  /** «Фото: …» */
  photos: string;
  /** «и ещё {n}» — когда авторы не поместились */
  more: string;
  /** «авторы и лицензии — {url}» */
  credits: string;
}

export interface TableCardLabels extends ShareCardCommonLabels {
  eyebrow: string;
  title: string;
  single: string;
  min: string;
  mean: string;
  flight: string;
  /** Справа от заголовка сета: «средний балл стола» */
  summary: string;
  /** Сета нет, и один напиток держит все блюда (ни одно не ниже порога хорошей пары). */
  flightNone: string;
  /** Сета нет, но хорошей пары на весь стол нет (single.below_min > 0) — честно: «лучший компромисс». */
  flightWeak: string;
  /** Подпись к блюдам бокала: «к {list}» */
  serves: string;
  /** Перед причиной движка: «Лучше всего — {dish}:» (причина — про пару с этим блюдом, а не про весь стол). */
  why: string;
}

export interface PairCardLabels extends ShareCardCommonLabels {
  eyebrow: string;
  /** «из 99» */
  of: string;
  classic: string;
}

export interface TableCardData {
  dishes: readonly ShareDish[];
  /**
   * Один напиток на весь стол (single из planTable — никогда не подменяется политикой окна Efes). reason — главная
   * причина движка для пары с блюдом reason_dish (strongest_dish); below_min — сколько блюд ниже порога хорошей пары;
   * weakest — готовая строка про слабейшую пару с бэндом движка («Слабее всего — Тирамису, 31 · Избегать»), когда
   * below_min > 0.
   */
  single: {
    drink: ShareDrink; min: number; mean: number; reason?: string | null; reason_dish?: string | null;
    below_min?: number; weakest?: string | null;
  };
  /** Сет в порядке подачи (order 1..N); dishes — названия блюд, которые обслуживает бокал. */
  flight: readonly { drink: ShareDrink; order: number; dishes: readonly string[] }[];
  /** Средний балл стола: один напиток → сет. */
  summary?: { single_mean: number; mean: number } | null;
  /** Адрес под логотипом; по умолчанию location.host. */
  url?: string | null;
  /** ru/kk — десятичная запятая, en — точка. */
  locale?: string;
  labels?: Partial<TableCardLabels>;
}

export interface PairCardData {
  dish: ShareDish;
  drink: ShareDrink;
  /** Балл движка 0–99. */
  score: number;
  band_label?: string | null;
  /** Тип пары («Контраст», «Созвучие»…) */
  match_label?: string | null;
  classic?: boolean;
  /** 1–2 текста причин движка. */
  reasons?: readonly string[];
  url?: string | null;
  locale?: string;
  labels?: Partial<PairCardLabels>;
}

export interface RenderOptions {
  /** Множитель размера PNG (1 → 1080×1920). Для сторис оставьте 1. */
  scale?: number;
}

const COMMON_RU: ShareCardCommonLabels = {
  footer: 'балл движка Flavor Tree · по правилам сомелье',
  photos: 'Фото',
  more: 'и ещё {n}',
  credits: 'авторы и лицензии — {url}',
};
export const TABLE_CARD_LABELS_RU: TableCardLabels = {
  ...COMMON_RU,
  eyebrow: 'Дастархан',
  title: 'Подбор на весь стол',
  single: 'Один напиток на весь стол',
  min: 'слабейшая пара',
  mean: 'в среднем',
  flight: 'Сет из {n} бокалов',
  summary: 'средний балл стола',
  flightNone: 'Один бокал справляется со всем столом — сет не нужен',
  flightWeak: 'Хорошей пары на весь стол нет — это лучший компромисс',
  serves: 'к: {list}',
  why: 'Лучше всего — {dish}:',
};
export const PAIR_CARD_LABELS_RU: PairCardLabels = {
  ...COMMON_RU,
  eyebrow: 'Подбор пары',
  of: 'из 99',
  classic: 'Классика',
};

// ─────────────────────────────────────────────────────────────────────────────
// палитра Design System v3 (styles.css, тёмная тема) и шрифты
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0B0806', bg2: '#120D09', surface: '#191210', surface2: '#211813',
  ink: '#F7F1E5', ink2: '#D6CBB8', ink3: '#9A8E7C', ink4: '#6B6153',
  gold: '#E5B849', goldSoft: '#F4DDA3', goldDeep: '#9D6F22', warn: '#E5705A',
};
const SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", serif';
const SANS = 'Inter, -apple-system, "Segoe UI", system-ui, sans-serif';
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const LINING = 'FT Lining Figures';
const PAD = 84;

type Ctx2D = CanvasRenderingContext2D;

// ─────────────────────────────────────────────────────────────────────────────
// шрифты
// ─────────────────────────────────────────────────────────────────────────────
let uiFontsReady: Promise<void> | null = null;
let liningTry: Promise<void> | null = null;
let liningOk = false;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | void> => Promise.race([p, sleep(ms)]);

/** Шрифт цифр: антиква с lnum; не загрузилась — Inter Light (прописные цифры по умолчанию). */
function numFont(size: number, weight = 600): string {
  return liningOk ? `${weight} ${size}px "${LINING}", ${SERIF}` : `300 ${size}px ${SANS}`;
}

/**
 * Cormorant Garamond по умолчанию рисует старостильные цифры («17» читается как «I7»), а в canvas нет
 * font-variant-numeric. Поэтому грузим из Google Fonts подмножество только с цифрами (text=…) как отдельное семейство
 * с featureSettings "lnum" — те же глифы, что у .num на страницах.
 */
async function loadLiningFigures(fonts: FontFaceSet): Promise<void> {
  const text = '0123456789,.−–-+/%→·';
  const res = await fetch(`https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&text=${encodeURIComponent(text)}`);
  if (!res.ok) return;
  const css = await res.text();
  let n = 0;
  for (const block of css.split('@font-face').slice(1)) {
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1];
    const url = /url\(([^)]+)\)/.exec(block)?.[1];
    if (!weight || !url) continue;
    const face = new FontFace(LINING, `url(${url})`, { weight, featureSettings: '"lnum" 1' });
    await face.load();
    (fonts as unknown as { add(f: FontFace): void }).add(face);
    n++;
  }
  liningOk = n > 0;
}

/**
 * Ждём шрифты интерфейса (кириллица и казахские буквы — отдельные подмножества) и цифры; не дольше ~4 с. Шрифты
 * интерфейса и цифры грузятся параллельно. Цифры не загрузились (сбой сети) — карточка рисуется запасным шрифтом, а
 * следующий вызов пробует снова (не навсегда на сессию).
 */
export function ensureShareFonts(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  if (!fonts) return Promise.resolve();
  if (!uiFontsReady) {
    const sample = 'Аа Бб Жж Ққ Әә Өө Ұұ Үү Іі Ңң Ғғ Һһ Ёё Aa Zz 0123456789';
    const faces = [
      `500 64px ${SERIF}`, `600 64px ${SERIF}`, `italic 500 64px ${SERIF}`, `italic 600 64px ${SERIF}`,
      `300 24px ${SANS}`, `400 24px ${SANS}`, `500 24px ${SANS}`, `600 24px ${SANS}`, `700 24px ${SANS}`,
    ];
    uiFontsReady = withTimeout(Promise.all(faces.map(f => fonts.load(f, sample).catch(() => []))), 3500).then(() => undefined);
  }
  if (!liningOk && !liningTry) {
    liningTry = withTimeout(loadLiningFigures(fonts).catch(() => undefined), 3500)
      .then(() => { if (!liningOk) liningTry = null; });
  }
  return Promise.all([uiFontsReady, liningTry ?? Promise.resolve()])
    .then(() => withTimeout(fonts.ready, 1500))
    .then(() => undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// картинки
// ─────────────────────────────────────────────────────────────────────────────
interface PhotoRec { large?: string; square?: string; author?: string; license?: string; source?: string }
const PHOTOS = photosJson as unknown as Record<string, PhotoRec | undefined>;

function photoRec(id: string): PhotoRec | undefined {
  if (id.startsWith('_')) return undefined;
  const r = PHOTOS[id];
  if (r && typeof r === 'object' && r.large) return r;
  const trad = PHOTOS['_traditional_drinks'] as unknown as Record<string, PhotoRec | undefined> | undefined;
  return trad?.[id];
}

function absUrl(path: string): string {
  try { return new URL(path, document.baseURI).href; } catch { return path; }
}

function loadImage(src: string, timeoutMs = 3500): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    let done = false;
    const finish = (v: HTMLImageElement | null): void => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try { if (new URL(src, document.baseURI).origin !== location.origin && !src.startsWith('blob:')) img.crossOrigin = 'anonymous'; } catch { /* относительный путь */ }
    img.decoding = 'async';
    img.onload = () => {
      const ok = (): void => finish(img.naturalWidth > 0 ? img : null);
      if (typeof img.decode === 'function') img.decode().then(ok, ok); else ok();
    };
    img.onerror = () => finish(null);
    img.src = src;
  });
}

/**
 * Фото блюда: квадрат 480×480 (его уже загрузила страница — он в кеше), большое 1200×900 — только если плитка шире
 * ≈ 480 px на холсте. Не загрузилось (ошибка, SPA-заглушка вместо картинки, 3,5 с тишины) — пробуем другой вариант,
 * и лишь потом плитка с эмодзи.
 */
async function dishImage(d: ShareDish, widthPx: number): Promise<HTMLImageElement | null> {
  if (d.photo) return loadImage(absUrl(d.photo));
  const rec = photoRec(d.id);
  if (!rec) return null;
  const order = widthPx > 480 ? [rec.large, rec.square] : [rec.square, rec.large];
  const tried = new Set<string>();
  for (const path of order) {
    if (!path || tried.has(path)) continue;
    tried.add(path);
    const img = await loadImage(absUrl(path));
    if (img) return img;
  }
  return null;
}

function artInput(d: ShareDrink): DrinkArtInput {
  return {
    id: d.id, category: d.category, archetype: d.archetype ?? d.style?.archetype ?? null, family: d.family ?? d.style?.family ?? null,
    sensory: d.sensory, aroma_tags: d.aroma_tags, serving: d.serving, visual: d.visual,
  };
}

let artSeq = 0;
/** Бокал: SVG-строка drinkArtSvg → Blob URL → Image в нужном размере (вектор — резкий при любом scale). */
async function glassImage(d: ShareDrink, heightPx: number): Promise<HTMLImageElement | null> {
  try {
    const svg = drinkArtSvg(artInput(d), { size: Math.round(heightPx), idPrefix: `sc${++artSeq}` })
      // контуры бокала нарисованы currentColor — в картинке без CSS задаём цвет явно
      .replace('<svg ', `<svg color="${C.ink}" `);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try { return await loadImage(url, 5000); } finally { URL.revokeObjectURL(url); }
  } catch {
    return null;
  }
}

function liquidColor(d: ShareDrink): string {
  try { return resolveVisual(artInput(d)).liquid.mid; } catch { return C.gold; }
}

const CATEGORY_EMOJI: Record<string, string> = {
  beer: '🍺', na_beer: '🍺', radler: '🍺', cider: '🍏', wine: '🍷', sparkling: '🥂', fortified: '🍷', cocktail: '🍸',
  spirit: '🥃', liqueur: '🥃', kvass: '🍺', lemonade: '🍋', soda: '🥤', dairy: '🥛', tea: '🍵', coffee: '☕', water: '💧',
};

// ─────────────────────────────────────────────────────────────────────────────
// рисование
// ─────────────────────────────────────────────────────────────────────────────
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function rrPath(c: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function goldGradient(c: Ctx2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, C.goldSoft);
  g.addColorStop(0.45, C.gold);
  g.addColorStop(1, C.goldDeep);
  return g;
}

function hairline(c: Ctx2D, x0: number, x1: number, y: number, fade: 'both' | 'right' | 'none' = 'both', alpha = 0.34): void {
  const g = c.createLinearGradient(x0, 0, x1, 0);
  const col = rgba(C.gold, alpha);
  if (fade === 'both') { g.addColorStop(0, rgba(C.gold, 0)); g.addColorStop(0.5, col); g.addColorStop(1, rgba(C.gold, 0)); }
  else if (fade === 'right') { g.addColorStop(0, col); g.addColorStop(1, rgba(C.gold, 0)); }
  else { g.addColorStop(0, col); g.addColorStop(1, col); }
  c.fillStyle = g;
  c.fillRect(x0, y, x1 - x0, 1.5);
}

/** Текст с разрядкой (канвас-letterSpacing поддерживается не везде). Возвращает ширину. */
function spacedWidth(c: Ctx2D, text: string, spacing: number): number {
  let w = 0;
  for (const ch of text) w += c.measureText(ch).width + spacing;
  return Math.max(0, w - spacing);
}
function spaced(c: Ctx2D, text: string, x: number, y: number, spacing: number, align: 'left' | 'center' | 'right' = 'left'): number {
  const w = spacedWidth(c, text, spacing);
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const prev = c.textAlign;
  c.textAlign = 'left';
  for (const ch of text) { c.fillText(ch, cx, y); cx += c.measureText(ch).width + spacing; }
  c.textAlign = prev;
  return w;
}

function ellipsize(c: Ctx2D, s: string, maxW: number): string {
  if (c.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

/** Перенос по словам с ограничением строк (последняя — с многоточием). */
function wrap(c: Ctx2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (!cur || c.measureText(t).width <= maxW) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    keep[maxLines - 1] = ellipsize(c, lines.slice(maxLines - 1).join(' '), maxW);
    return keep;
  }
  return lines.map(l => ellipsize(c, l, maxW));
}

function fmtNum(x: number, locale: string | undefined): string {
  const s = Number.isInteger(x) ? String(x) : (Math.round(x * 10) / 10).toFixed(1);
  return locale === 'en' ? s : s.replace('.', ',');
}
function tplStr(s: string, p: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m));
}
function hostText(url: string | null | undefined): string {
  if (url) return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  try { return location.host || 'Flavor Tree'; } catch { return 'Flavor Tree'; }
}

function paintBackground(c: Ctx2D, W: number, H: number): void {
  c.fillStyle = C.bg;
  c.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, col: string, a: number): void => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, a));
    g.addColorStop(0.5, rgba(col, a * 0.3));
    g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  };
  glow(W / 2, -H * 0.1, H * 0.62, C.gold, 0.22);
  glow(W * 0.06, H * 0.03, W * 0.85, C.goldDeep, 0.14);
  glow(W * 0.9, H * 1.02, W * 0.95, C.goldDeep, 0.12);
  const v = c.createRadialGradient(W / 2, H * 0.48, H * 0.3, W / 2, H * 0.48, H * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  // тонкая золотая рамка
  rrPath(c, 36, 36, W - 72, H - 72, 44);
  c.strokeStyle = rgba(C.gold, 0.22);
  c.lineWidth = 1.5;
  c.stroke();
}

const TREE = 'M12 22v-8M12 14c-3 0-6-2-6-6 0-2 1-3 2-4 0-2 2-3 4-3s4 1 4 3c1 1 2 2 2 4 0 4-3 6-6 6z';

function wordmark(c: Ctx2D, cx: number, y: number): void {
  c.font = `600 58px ${SERIF}`;
  c.textBaseline = 'alphabetic';
  const label = 'Flavor Tree';
  const tw = c.measureText(label).width;
  const icon = 46, gap = 14;
  const x0 = cx - (tw + icon + gap) / 2;
  c.save();
  c.translate(x0, y - icon + 6);
  c.scale(icon / 24, icon / 24);
  c.strokeStyle = C.gold;
  c.lineWidth = 1.5;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.stroke(new Path2D(TREE));
  c.restore();
  c.fillStyle = goldGradient(c, x0 + icon + gap, y - 50, x0 + icon + gap + tw, y + 8);
  c.textAlign = 'left';
  c.fillText(label, x0 + icon + gap, y);
}

function eyebrow(c: Ctx2D, text: string, x: number, y: number, align: 'left' | 'center', rule: boolean): void {
  c.font = `600 23px ${SANS}`;
  c.fillStyle = C.gold;
  const up = text.toLocaleUpperCase();
  const w = spaced(c, up, align === 'center' ? x : x + 20, y, 5.5, align);
  // точка-«пузырёк» как .eyebrow::before
  const dotX = align === 'center' ? x - w / 2 - 20 : x + 4;
  c.save();
  c.shadowColor = rgba(C.gold, 0.9);
  c.shadowBlur = 12;
  c.beginPath();
  c.arc(dotX, y - 8, 4.5, 0, Math.PI * 2);
  c.fill();
  c.restore();
  if (rule) {
    if (align === 'center') {
      const l = c.createLinearGradient(x - w / 2 - 170, 0, x - w / 2 - 36, 0);
      l.addColorStop(0, rgba(C.gold, 0)); l.addColorStop(1, rgba(C.gold, 0.4));
      c.fillStyle = l; c.fillRect(x - w / 2 - 170, y - 9, 134, 1.5);
      const r = c.createLinearGradient(x + w / 2 + 20, 0, x + w / 2 + 154, 0);
      r.addColorStop(0, rgba(C.gold, 0.4)); r.addColorStop(1, rgba(C.gold, 0));
      c.fillStyle = r; c.fillRect(x + w / 2 + 20, y - 9, 134, 1.5);
    } else {
      hairline(c, x + 20 + w + 22, STORY_W - PAD, y - 9, 'right', 0.36);
    }
  }
}

function drawCover(c: Ctx2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number): void {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const ir = iw / ih, br = w / h;
  let sw: number, sh: number, sx: number, sy: number;
  if (ir > br) { sh = ih; sw = sh * br; sx = (iw - sw) / 2; sy = 0; } else { sw = iw; sh = sw / br; sx = 0; sy = (ih - sh) / 2; }
  c.save();
  rrPath(c, x, y, w, h, r);
  c.clip();
  c.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  c.restore();
}

function drawEmojiTile(c: Ctx2D, emoji: string, x: number, y: number, w: number, h: number, r: number): void {
  c.save();
  rrPath(c, x, y, w, h, r);
  c.clip();
  c.fillStyle = C.surface2;
  c.fillRect(x, y, w, h);
  const g = c.createRadialGradient(x + w / 2, y + h * 0.2, 0, x + w / 2, y + h * 0.2, Math.max(w, h) * 0.8);
  g.addColorStop(0, rgba(C.gold, 0.18));
  g.addColorStop(0.5, rgba(C.gold, 0.04));
  g.addColorStop(1, rgba(C.gold, 0));
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.font = `${Math.round(Math.min(w, h) * 0.4)}px ${EMOJI}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = C.ink;
  c.fillText(emoji || '🍽️', x + w / 2, y + h / 2 + Math.min(w, h) * 0.02);
  c.textBaseline = 'alphabetic';
  c.restore();
}

function tileFrame(c: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  rrPath(c, x + 0.75, y + 0.75, w - 1.5, h - 1.5, r);
  c.strokeStyle = rgba(C.gold, 0.3);
  c.lineWidth = 1.5;
  c.stroke();
}

/** Бокал с тёплым свечением цвета напитка и мягкой тенью; bottom — линия «стола». Без картинки — эмодзи категории. */
function drawGlass(c: Ctx2D, img: HTMLImageElement | null, d: ShareDrink, cx: number, bottom: number, h: number): void {
  const w = h * 0.75;
  const col = liquidColor(d);
  const g = c.createRadialGradient(cx, bottom - h * 0.32, 0, cx, bottom - h * 0.32, h * 0.62);
  g.addColorStop(0, rgba(col, 0.42));
  g.addColorStop(0.55, rgba(col, 0.1));
  g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g;
  c.fillRect(cx - h, bottom - h * 1.2, h * 2, h * 1.5);
  if (img) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,.5)';
    c.shadowBlur = h * 0.08;
    c.shadowOffsetY = h * 0.04;
    c.drawImage(img, cx - w / 2, bottom - h, w, h);
    c.restore();
  } else {
    c.font = `${Math.round(h * 0.5)}px ${EMOJI}`;
    c.textAlign = 'center';
    c.fillStyle = C.ink;
    c.fillText(CATEGORY_EMOJI[d.category] ?? '🥂', cx, bottom - h * 0.2);
  }
}

/**
 * Подпись фото — одна строка: «Фото: автор (лицензия), … и ещё N · авторы и лицензии — host/credits». Только фото,
 * которые действительно нарисованы на карточке (не загрузилось — не подписываем).
 */
function drawCredits(c: Ctx2D, shown: readonly ShareDish[], L: ShareCardCommonLabels, host: string, y: number): void {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const d of shown) {
    if (d.photo) continue;
    const r = photoRec(d.id);
    if (!r?.author) continue;
    const p = r.license ? `${r.author} (${r.license})` : r.author;
    if (!seen.has(p)) { seen.add(p); parts.push(p); }
  }
  if (!parts.length) return;
  c.font = `400 20px ${SANS}`;
  c.fillStyle = C.ink3;
  c.textAlign = 'left';
  const maxW = STORY_W - 2 * PAD;
  const tail = ' · ' + tplStr(L.credits, { url: `${host}/credits` });
  let text = '';
  for (let n = parts.length; n >= 0; n--) {
    const more = n < parts.length ? `${n ? ' ' : ''}${tplStr(L.more, { n: parts.length - n })}` : '';
    text = `${L.photos}: ${parts.slice(0, n).join(', ')}${more}${tail}`;
    if (c.measureText(text).width <= maxW) break;
  }
  c.fillText(ellipsize(c, text, maxW), PAD, y);
}

/** Где начинается подвал (линия): всё содержимое карточки — выше. */
const FOOTER_LINE = SAFE_BOTTOM - 80;

/** Подвал в безопасной зоне: адрес и честная оговорка, под ними — авторы фото. */
function footer(c: Ctx2D, L: ShareCardCommonLabels, host: string, shown: readonly ShareDish[]): void {
  const y = FOOTER_LINE;
  hairline(c, PAD, STORY_W - PAD, y, 'both', 0.32);
  c.textAlign = 'left';
  c.font = `600 26px ${SANS}`;
  c.fillStyle = C.goldSoft;
  c.fillText(host, PAD, y + 42);
  const hw = c.measureText(host).width;
  c.textAlign = 'right';
  c.font = `400 24px ${SANS}`;
  c.fillStyle = C.ink2;
  c.fillText(ellipsize(c, L.footer, STORY_W - 2 * PAD - hw - 40), STORY_W - PAD, y + 42);
  c.textAlign = 'left';
  drawCredits(c, shown, L, host, y + 76);
}

function setupCanvas(scale: number): { canvas: HTMLCanvasElement; c: Ctx2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(STORY_W * scale);
  canvas.height = Math.round(STORY_H * scale);
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Canvas 2D недоступен');
  c.scale(scale, scale);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  return { canvas, c };
}

/**
 * JPEG синхронно (toDataURL): Chrome кодирует toBlob кусками в «простое» главного потока, и на живой странице это
 * растягивается на секунды. JPEG 1080×1920 кодируется за ≈ 80 мс (≈ 330 мс на слабом телефоне) против ≈ 0,3–1,2 с у
 * PNG и весит ≈ 300 КБ вместо ≈ 2,5 МБ. Строка → Blob через fetch(data:) (без побайтового цикла); холст сразу
 * освобождаем (на iOS Safari память холстов ограничена).
 */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  await new Promise<void>(r => setTimeout(r, 0));   // дать окну отрисоваться до тяжёлой работы
  let url = canvas.toDataURL(SHARE_IMAGE_TYPE, JPEG_QUALITY);
  canvas.width = 0;
  canvas.height = 0;
  try {
    const blob = await (await fetch(url)).blob();
    if (blob.size) return blob.type ? blob : new Blob([blob], { type: SHARE_IMAGE_TYPE });
  } catch { /* старые WebView без fetch(data:) — ниже */ }
  const type = url.slice(5, url.indexOf(';')) || SHARE_IMAGE_TYPE;
  const bin = atob(url.slice(url.indexOf(',') + 1));
  url = '';
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Перенос по словам без ограничения строк (для подбора, влезает ли текст). */
function wrapAll(c: Ctx2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (!cur || c.measureText(t).width <= maxW) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Список блюд бокала в maxLines строк: сколько влезает целиком, остальные — числом («к: Гренки, Фисташки +1»), а не
 * молча обрезанным многоточием.
 */
function fitList(c: Ctx2D, names: readonly string[], fmt: (list: string) => string, maxW: number, maxLines: number): string[] {
  for (let k = names.length; k >= 1; k--) {
    const rest = names.length - k;
    const lines = wrapAll(c, fmt(names.slice(0, k).join(', ') + (rest ? ` +${rest}` : '')), maxW);
    if (lines.length <= maxLines && lines.every(l => c.measureText(l).width <= maxW)) return lines;
  }
  return wrap(c, fmt(names.join(', ')), maxW, maxLines);
}

// ─────────────────────────────────────────────────────────────────────────────
// карточка стола
// ─────────────────────────────────────────────────────────────────────────────
/** Раскладка плиток: до 3 блюд — один ряд, больше — два. */
function mosaic(n: number, x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number }[] {
  if (n <= 0) return [];
  const rows = n <= 3 ? 1 : 2;
  const gap = n > 8 ? 12 : 16;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const perRow = [Math.ceil(n / rows), n - Math.ceil(n / rows)].slice(0, rows);
  const th = (h - (rows - 1) * gap) / rows;
  let idx = 0;
  perRow.forEach((k, r) => {
    const tw = (w - (k - 1) * gap) / k;
    for (let i = 0; i < k; i++, idx++) out.push({ x: x + i * (tw + gap), y: y + r * (th + gap), w: tw, h: th });
  });
  return out;
}

/** Раскладка карточки стола по вертикали (всё в SAFE_TOP..FOOTER_LINE). */
const TL = {
  word: 284, title: 352, eyebrow: 400,
  tiles: 428, tilesH: 250,
  singleEb: 730, panel: 754, panelH: 450,
  flightEb: 1252, cols: 1274, colsH: FOOTER_LINE - 20 - 1274,
} as const;

/** JPEG 1080×1920: блюда стола, «один напиток на весь стол» со слабейшей парой и средним баллом, сет в порядке подачи. */
export async function renderTableCard(data: TableCardData, opts: RenderOptions = {}): Promise<Blob> {
  const L: TableCardLabels = { ...TABLE_CARD_LABELS_RU, ...(data.labels ?? {}) };
  const scale = Math.max(0.25, Math.min(3, opts.scale ?? 1));
  const dishes = data.dishes.slice(0, 12);
  const flight = [...data.flight].sort((a, b) => a.order - b.order).slice(0, 4);
  const showFlight = flight.length > 1;
  const tiles = mosaic(dishes.length, PAD, TL.tiles, STORY_W - 2 * PAD, TL.tilesH);
  const flightH = flight.length >= 4 ? 116 : 128;
  const singleH = 250;

  // картинки и шрифты — параллельно
  const [photos, singleArt, flightArt] = await Promise.all([
    Promise.all(dishes.map((d, i) => dishImage(d, (tiles[i]?.w ?? 0) * scale))),
    glassImage(data.single.drink, singleH * scale),
    Promise.all(showFlight ? flight.map(f => glassImage(f.drink, flightH * scale)) : []),
    ensureShareFonts(),
  ]);

  const { canvas, c } = setupCanvas(scale);
  const W = STORY_W;
  paintBackground(c, W, STORY_H);
  wordmark(c, W / 2, TL.word);
  c.font = `italic 500 52px ${SERIF}`;
  c.fillStyle = C.ink;
  c.textAlign = 'center';
  c.fillText(ellipsize(c, L.title, W - 2 * PAD), W / 2, TL.title);
  eyebrow(c, L.eyebrow, W / 2, TL.eyebrow, 'center', true);

  // ── блюда ──
  dishes.forEach((d, i) => {
    const t = tiles[i];
    const r = dishes.length > 6 ? 18 : 26;
    const img = photos[i];
    if (img) drawCover(c, img, t.x, t.y, t.w, t.h, r); else drawEmojiTile(c, d.emoji ?? '🍽️', t.x, t.y, t.w, t.h, r);
    // подпись на затемнении снизу, до двух строк
    c.save();
    rrPath(c, t.x, t.y, t.w, t.h, r);
    c.clip();
    const g = c.createLinearGradient(0, t.y + t.h * 0.35, 0, t.y + t.h);
    g.addColorStop(0, 'rgba(11,8,6,0)');
    g.addColorStop(1, 'rgba(11,8,6,.86)');
    c.fillStyle = g;
    c.fillRect(t.x, t.y, t.w, t.h);
    c.restore();
    tileFrame(c, t.x, t.y, t.w, t.h, r);
    const fs = t.w < 160 ? 18 : t.w < 240 ? 21 : 25;
    c.font = `600 ${fs}px ${SANS}`;
    c.fillStyle = C.ink;
    c.textAlign = 'left';
    const lines = wrap(c, d.name, t.w - 24, 2);
    const lh = Math.round(fs * 1.18);
    lines.forEach((l, k) => c.fillText(l, t.x + 12, t.y + t.h - 12 - (lines.length - 1 - k) * lh));
  });

  // ── один напиток на весь стол ──
  const s = data.single;
  eyebrow(c, L.single, PAD, TL.singleEb, 'left', true);
  const py = TL.panel, ph = TL.panelH;
  rrPath(c, PAD, py, W - 2 * PAD, ph, 36);
  const pg = c.createLinearGradient(0, py, 0, py + ph);
  pg.addColorStop(0, 'rgba(255,248,235,.06)');
  pg.addColorStop(1, 'rgba(255,248,235,.02)');
  c.fillStyle = pg;
  c.fill();
  c.strokeStyle = rgba(C.gold, 0.3);
  c.lineWidth = 1.5;
  c.stroke();
  // золотая кромка сверху, как .card.gilded
  const edge = c.createLinearGradient(PAD, 0, W - PAD, 0);
  edge.addColorStop(0, rgba(C.gold, 0)); edge.addColorStop(0.35, C.gold); edge.addColorStop(0.5, C.goldSoft); edge.addColorStop(0.65, C.gold); edge.addColorStop(1, rgba(C.gold, 0));
  c.fillStyle = edge;
  c.fillRect(PAD + 30, py, W - 2 * PAD - 60, 2);

  drawGlass(c, singleArt, s.drink, PAD + 140, py + 306, singleH);
  const tx = PAD + 290, tw = W - PAD - 36 - tx;
  c.textAlign = 'left';
  c.font = `600 56px ${SERIF}`;
  c.fillStyle = C.ink;
  const nameLines = wrap(c, s.drink.name, tw, 2);
  let ty = py + 78;
  nameLines.forEach((l, i) => c.fillText(l, tx, ty + i * 56));
  ty += (nameLines.length - 1) * 56;
  if (s.drink.sub) {
    c.font = `500 24px ${SANS}`;
    c.fillStyle = C.ink3;
    c.fillText(ellipsize(c, s.drink.sub, tw), tx, ty + 40);
  }
  // крупные цифры: слабейшая пара · в среднем. Подпись — ниже самого низкого знака (запятая дробного среднего
  // уходит под строку на ≈ 0,3 кегля и иначе режет подпись).
  const ny = py + 282;
  const colW = tw / 2;
  const weak = (s.below_min ?? 0) > 0;
  const nums: [string, string][] = [[fmtNum(s.min, data.locale), L.min], [fmtNum(s.mean, data.locale), L.mean]];
  c.font = numFont(112);
  const desc = Math.max(...nums.map(([v]) => c.measureText(v).actualBoundingBoxDescent || 0), 112 * 0.3);
  const capY = ny + Math.ceil(desc) + 26;
  nums.forEach(([v, cap], i) => {
    const x = tx + i * colW;
    c.font = numFont(112);
    c.fillStyle = i === 0 && weak ? C.warn : goldGradient(c, x, ny - 100, x + 180, ny);
    c.fillText(v, x, ny);
    c.font = `600 21px ${SANS}`;
    c.fillStyle = C.ink2;
    spaced(c, cap.toLocaleUpperCase(), x + 4, capY, 3.2);
  });
  c.fillStyle = rgba(C.gold, 0.25);
  c.fillRect(tx + colW - 26, ny - 88, 1.5, capY - ny + 96);
  // низ карточки: слабое место (если есть) и причина движка — с блюдом, к которому она относится, без кавычек
  const lines: { text: string; font: string; color: string; prefix?: string }[] = [];
  const bw = W - 2 * PAD - 80;
  if (weak && s.weakest) lines.push({ text: s.weakest, font: `600 26px ${SANS}`, color: C.warn });
  if (s.reason) {
    const prefix = s.reason_dish ? tplStr(L.why, { dish: s.reason_dish }) : '';
    const font = `italic 500 30px ${SERIF}`;
    c.font = font;
    const rl = wrap(c, prefix ? `${prefix} ${s.reason}` : s.reason, bw, 2 - lines.length);
    rl.forEach((t, k) => lines.push({ text: t, font, color: C.ink2, prefix: k === 0 && prefix && t.startsWith(prefix) ? prefix : undefined }));
  }
  if (lines.length) {
    hairline(c, PAD + 36, W - PAD - 36, py + 364, 'both', 0.22);
    lines.forEach((l, k) => {
      const y = py + 402 + k * 36;
      c.font = l.font;
      c.textAlign = 'left';
      if (l.prefix) {
        c.fillStyle = C.goldSoft;
        c.fillText(l.prefix, PAD + 40, y);
        const pw = c.measureText(l.prefix + ' ').width;
        c.fillStyle = l.color;
        c.fillText(l.text.slice(l.prefix.length).trimStart(), PAD + 40 + pw, y);
      } else {
        c.fillStyle = l.color;
        c.fillText(ellipsize(c, l.text, bw), PAD + 40, y);
      }
    });
  }

  // ── сет ──
  const fy = TL.flightEb;
  if (showFlight) {
    eyebrow(c, tplStr(L.flight, { n: flight.length }), PAD, fy, 'left', false);
    if (data.summary) {
      const a = fmtNum(data.summary.single_mean, data.locale), b = fmtNum(data.summary.mean, data.locale);
      c.textAlign = 'right';
      c.font = numFont(46);
      c.fillStyle = goldGradient(c, W - PAD - 160, fy - 40, W - PAD, fy);
      const bw2 = c.measureText(b).width;
      c.fillText(b, W - PAD, fy + 4);
      c.font = numFont(34, 500);
      c.fillStyle = C.ink3;
      const arrow = `${a}  →  `;
      c.fillText(arrow, W - PAD - bw2 - 6, fy + 2);
      const aw = c.measureText(arrow).width;
      c.font = `600 18px ${SANS}`;
      c.fillStyle = C.ink3;
      spaced(c, L.summary.toLocaleUpperCase(), W - PAD - bw2 - aw - 22, fy - 2, 2.5, 'right');
      c.textAlign = 'left';
    }
    const n = flight.length;
    const gap = 20;
    const cw = (W - 2 * PAD - (n - 1) * gap) / n;
    const top = TL.cols, colH = TL.colsH;
    flight.forEach((f, i) => {
      const x = PAD + i * (cw + gap);
      const cx = x + cw / 2;
      // подложка колонки
      rrPath(c, x, top, cw, colH, 26);
      c.fillStyle = 'rgba(255,248,235,.028)';
      c.fill();
      c.strokeStyle = rgba(C.gold, 0.16);
      c.lineWidth = 1.2;
      c.stroke();
      drawGlass(c, flightArt[i] ?? null, f.drink, cx, top + 18 + flightH, flightH);
      // номер подачи — в углу колонки
      const ox = x + 32, oy = top + 32;
      c.beginPath();
      c.arc(ox, oy, 21, 0, Math.PI * 2);
      c.fillStyle = C.bg2;
      c.fill();
      c.strokeStyle = rgba(C.gold, 0.7);
      c.lineWidth = 1.5;
      c.stroke();
      c.font = numFont(30);
      c.fillStyle = C.goldSoft;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(f.order), ox, oy + 1);
      c.textBaseline = 'alphabetic';
      // стрелка к следующему бокалу
      if (i < n - 1) {
        c.strokeStyle = rgba(C.gold, 0.55);
        c.lineWidth = 1.5;
        const ax = x + cw + gap / 2, ay = top + 18 + flightH * 0.55;
        c.beginPath();
        c.moveTo(ax - 5, ay - 7); c.lineTo(ax + 3, ay); c.lineTo(ax - 5, ay + 7);
        c.stroke();
      }
      const nfs = n >= 4 ? 26 : 30;
      c.font = `600 ${nfs}px ${SERIF}`;
      c.fillStyle = C.ink;
      const nl = wrap(c, f.drink.name, cw - 24, 2);
      const nameY = top + 18 + flightH + 38;
      nl.forEach((l, j) => c.fillText(l, cx, nameY + j * (nfs + 2)));
      const dfs = n >= 4 ? 19 : 21;
      const dlh = dfs + 5;
      const dy = nameY + (nl.length - 1) * (nfs + 2) + dlh + 6;
      const maxLines = Math.max(1, Math.floor((top + colH - 14 - dy) / dlh) + 1);
      c.font = `400 ${dfs}px ${SANS}`;
      c.fillStyle = C.ink2;
      const dl = fitList(c, f.dishes, list => tplStr(L.serves, { list }), cw - 24, maxLines);
      dl.forEach((l, j) => c.fillText(l, cx, dy + j * dlh));
      c.textAlign = 'left';
    });
  } else {
    hairline(c, PAD, W - PAD, fy - 10, 'both', 0.25);
    const weakCopy = (s.below_min ?? 0) > 0;
    c.font = `italic 500 38px ${SERIF}`;
    c.fillStyle = weakCopy ? C.warn : C.ink2;
    c.textAlign = 'center';
    wrap(c, weakCopy ? L.flightWeak : L.flightNone, W - 2 * PAD - 60, 2).forEach((l, i) => c.fillText(l, W / 2, fy + 64 + i * 46));
    c.textAlign = 'left';
  }

  footer(c, L, hostText(data.url), dishes.filter((_, i) => photos[i] !== null));
  return encode(canvas);
}

// ─────────────────────────────────────────────────────────────────────────────
// карточка пары
// ─────────────────────────────────────────────────────────────────────────────
/** JPEG 1080×1920: фото блюда, бокал, балл движка, тип пары и 1–2 причины (всё в безопасной зоне сторис). */
export async function renderPairCard(data: PairCardData, opts: RenderOptions = {}): Promise<Blob> {
  const L: PairCardLabels = { ...PAIR_CARD_LABELS_RU, ...(data.labels ?? {}) };
  const scale = Math.max(0.25, Math.min(3, opts.scale ?? 1));
  const glassH = 270;
  const px = PAD, py = 372, pw = STORY_W - 2 * PAD, ph = Math.round(pw * 0.58);

  const [photo, art] = await Promise.all([
    dishImage(data.dish, pw * scale), glassImage(data.drink, glassH * scale), ensureShareFonts(),
  ]);

  const { canvas, c } = setupCanvas(scale);
  const W = STORY_W;
  paintBackground(c, W, STORY_H);
  wordmark(c, W / 2, 284);
  eyebrow(c, L.eyebrow, W / 2, 340, 'center', true);

  // фото блюда
  if (photo) drawCover(c, photo, px, py, pw, ph, 40); else drawEmojiTile(c, data.dish.emoji ?? '🍽️', px, py, pw, ph, 40);
  c.save();
  rrPath(c, px, py, pw, ph, 40);
  c.clip();
  const sh = c.createLinearGradient(0, py + ph * 0.55, 0, py + ph);
  sh.addColorStop(0, 'rgba(11,8,6,0)');
  sh.addColorStop(1, 'rgba(11,8,6,.6)');
  c.fillStyle = sh;
  c.fillRect(px, py, pw, ph);
  c.restore();
  tileFrame(c, px, py, pw, ph, 40);

  // медальон с бокалом на нижнем крае фото
  const mx = W - PAD - 140, my = py + ph + 6, mr = 124;
  c.save();
  c.shadowColor = 'rgba(0,0,0,.6)';
  c.shadowBlur = 40;
  c.beginPath();
  c.arc(mx, my, mr, 0, Math.PI * 2);
  c.fillStyle = C.bg2;
  c.fill();
  c.restore();
  c.beginPath();
  c.arc(mx, my, mr, 0, Math.PI * 2);
  c.strokeStyle = rgba(C.gold, 0.5);
  c.lineWidth = 1.5;
  c.stroke();
  c.beginPath();
  c.arc(mx, my, mr - 10, 0, Math.PI * 2);
  c.strokeStyle = rgba(C.gold, 0.14);
  c.lineWidth = 1;
  c.stroke();
  drawGlass(c, art, data.drink, mx, my + mr - 30, glassH);

  // нижний блок: балл, названия, тип пары, причины. Сначала меряем, потом рисуем с равными добавочными отступами,
  // чтобы короткий текст не оставлял дыру над подвалом; что не влезает до подвала — не рисуем.
  const score = String(Math.round(data.score));
  const chips = [data.match_label, data.classic ? L.classic : null].filter((x): x is string => !!x);
  c.font = `600 62px ${SERIF}`;
  const dishLines = wrap(c, data.dish.name, W - 2 * PAD, 2);
  c.font = `italic 500 50px ${SERIF}`;
  const drinkLines = wrap(c, `+ ${data.drink.name}`, W - 2 * PAD, 2);
  c.font = `400 28px ${SANS}`;
  const reasonLines = (data.reasons ?? []).filter(Boolean).slice(0, 2).map(r => wrap(c, r, W - 2 * PAD - 34, 2));
  const hasChips = chips.length > 0 || !!data.drink.sub;
  const scoreY = py + ph + 196;
  const limit = FOOTER_LINE - 26;
  /** Последняя базовая линия блока без добавочных отступов и сколько отступов extra в неё войдёт. */
  const layout = (reasons: readonly string[][]): { last: number; k: number } => {
    let last = scoreY + 84 + dishLines.length * 60 + (drinkLines.length - 1) * 54;
    let after = last + 54;
    let k = 1.6;
    if (hasChips) { last = after + 4; after = last + 58; k += 1; }
    if (reasons.length) {
      let start = after + 18;
      k += 1;
      for (const l of reasons) { last = start + (l.length - 1) * 38; start += l.length * 38 + 16; }
    }
    return { last, k };
  };
  // причины, которые не помещаются над подвалом целиком, не рисуем (а не обрезаем подвалом)
  while (reasonLines.length && layout(reasonLines).last > limit) reasonLines.pop();
  const fit = layout(reasonLines);
  const extra = Math.max(0, Math.min(48, (limit - fit.last) / fit.k));

  // балл
  const sy = scoreY + extra * 0.6;
  c.textAlign = 'left';
  c.font = numFont(210);
  c.fillStyle = goldGradient(c, PAD, sy - 185, PAD + 260, sy);
  c.fillText(score, PAD - 6, sy);
  const sw = c.measureText(score).width;
  c.font = `600 22px ${SANS}`;
  c.fillStyle = C.ink3;
  spaced(c, L.of.toLocaleUpperCase(), PAD + sw + 14, sy - 12, 4);
  if (data.band_label) {
    c.font = `italic 600 42px ${SERIF}`;
    c.fillStyle = C.goldSoft;
    // под медальоном — во всю ширину, рядом с ним — до его края
    const right = sy - 58 - 40 > my + mr ? W - PAD : mx - mr - 24;
    c.fillText(ellipsize(c, data.band_label, right - (PAD + sw + 14)), PAD + sw + 14, sy - 58);
  }

  // названия
  let y = sy + 84 + extra;
  c.font = `600 62px ${SERIF}`;
  c.fillStyle = C.ink;
  for (const l of dishLines) { c.fillText(l, PAD, y); y += 60; }
  c.font = `italic 500 50px ${SERIF}`;
  c.fillStyle = C.goldSoft;
  for (const l of drinkLines) { c.fillText(l, PAD, y); y += 54; }

  // тип пары, классика, подпись напитка
  if (hasChips && y + 8 <= limit) {
    y += 4 + extra;
    let cx = PAD;
    for (const ch of chips) {
      c.font = `600 20px ${SANS}`;
      const text = ch.toLocaleUpperCase();
      const w = spacedWidth(c, text, 3) + 36;
      rrPath(c, cx, y - 30, w, 44, 22);
      c.fillStyle = rgba(C.gold, 0.1);
      c.fill();
      c.strokeStyle = rgba(C.gold, 0.4);
      c.lineWidth = 1.2;
      c.stroke();
      c.fillStyle = C.goldSoft;
      spaced(c, text, cx + 18, y - 1, 3);
      cx += w + 12;
    }
    if (data.drink.sub) {
      c.font = `500 24px ${SANS}`;
      c.fillStyle = C.ink3;
      c.fillText(ellipsize(c, data.drink.sub, W - PAD - cx - 4), cx + (chips.length ? 6 : 0), y);
    }
    y += 58;
  }

  // причины движка — только те, что целиком помещаются над подвалом
  if (reasonLines.length) y += 18 + extra;
  for (const lines of reasonLines) {
    if (y + (lines.length - 1) * 38 > limit + 0.5) break;
    c.fillStyle = C.gold;
    c.beginPath();
    c.arc(PAD + 7, y - 10, 5, 0, Math.PI * 2);
    c.fill();
    c.font = `400 28px ${SANS}`;
    c.fillStyle = C.ink2;
    lines.forEach((l, i) => c.fillText(l, PAD + 34, y + i * 38));
    y += lines.length * 38 + 16;
  }

  footer(c, L, hostText(data.url), photo ? [data.dish] : []);
  return encode(canvas);
}

// ─────────────────────────────────────────────────────────────────────────────
// поделиться
// ─────────────────────────────────────────────────────────────────────────────
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** Имя файла с расширением, которое совпадает с типом картинки (вызывающий мог передать «….png»). */
function fileNameFor(blob: Blob, filename: string): string {
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : '';
  if (!ext) return filename;
  return /\.(png|jpe?g|webp)$/i.test(filename) ? filename.replace(/\.(png|jpe?g|webp)$/i, `.${ext}`) : `${filename}.${ext}`;
}

/**
 * Скачать картинку (ссылка с download). Узнать, сохранил ли браузер файл, нельзя (во встроенных браузерах Instagram,
 * Telegram, VK такие ссылки часто молча игнорируются) — поэтому вызывающий пишет нейтрально и подсказывает долгое нажатие.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFor(blob, filename);
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Можно ли отправить файл через системное «Поделиться» (мобильные браузеры). */
export function canShareFiles(): boolean {
  try {
    const f = new File([new Blob([''], { type: SHARE_IMAGE_TYPE })], `x.${SHARE_IMAGE_EXT}`, { type: SHARE_IMAGE_TYPE });
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}

/**
 * navigator.share с файлом, где он есть; иначе — ссылка на скачивание ('downloaded' значит «попросили браузер
 * скачать», а не «файл сохранён»). Отмена гостем → 'cancelled'.
 * Вызывайте из обработчика нажатия с уже готовым blob: браузеры требуют свежий жест пользователя.
 */
export async function shareImage(blob: Blob, o: { filename: string; title?: string; text?: string; url?: string }): Promise<ShareOutcome> {
  const name = fileNameFor(blob, o.filename);
  const file = new File([blob], name, { type: blob.type || SHARE_IMAGE_TYPE });
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: o.title, text: o.text ? (o.url ? `${o.text}\n${o.url}` : o.text) : o.url });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
      // NotAllowedError (истёк жест) и прочее — падаем в скачивание
    }
  }
  downloadBlob(blob, name);
  return 'downloaded';
}
