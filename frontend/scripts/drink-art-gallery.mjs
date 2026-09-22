// Галерея иллюстраций напитков: рендерит docs/drink-art/gallery.html из той же TS-функции,
// что и приложение (frontend/src/app/ui/drink-art.ts), и снимает её в тёмной и светлой теме.
// Запуск: node scripts/drink-art-gallery.mjs            → gallery.html + gallery-dark.png + gallery-light.png
//         node scripts/drink-art-gallery.mjs --no-shots → только HTML
// Источники: docs/research/engine_v2_prototype.py (57 архетипов), data/drinks.json (если есть — все напитки).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const docs = path.join(root, 'docs', 'drink-art');
mkdirSync(docs, { recursive: true });

// ── 1. транспиляция drink-art.ts (как в engine-parity.mjs, но с JSON-импортом) ──
const build = path.join(tmpdir(), 'ft-drink-art-build');
rmSync(build, { recursive: true, force: true }); mkdirSync(build, { recursive: true });
execSync(`npx tsc ${path.join(here, '..', 'src/app/ui/drink-art.ts')} --outDir ${build} --rootDir ${root} --module commonjs --target es2022 --strict --skipLibCheck --resolveJsonModule --esModuleInterop`, { stdio: 'inherit', cwd: path.join(here, '..') });
const require = createRequire(import.meta.url);
const ART = require(path.join(build, 'frontend/src/app/ui/drink-art.js'));
const VIS = JSON.parse(readFileSync(path.join(root, 'data', 'drink_visuals.json'), 'utf8'));

// ── 2. архетипы из прототипа (id, категория, carb, temp, теги) ──
const py = readFileSync(path.join(root, 'docs/research/engine_v2_prototype.py'), 'utf8');
const archetypes = [];
for (const m of py.matchAll(/^ K\("([a-z_0-9]+)","([a-z_]+)",([\d.]+)(.*)$/gm)) {
  const [, id, cat, abv, rest] = m;
  const num = (k, d) => { const r = new RegExp(`\\b${k}=([\\d.]+)`).exec(rest); return r ? +r[1] : d; };
  const tags = {}; const tm = /tags=\{([^}]*)\}/.exec(rest);
  if (tm) for (const t of tm[1].matchAll(/"([a-z_]+)":\s*([\d.]+)/g)) tags[t[1]] = +t[2];
  archetypes.push({ id, category: cat, abv: +abv, sensory: { carbonation: num('carb', 0), serve_temp: num('temp', 6) }, aroma_tags: tags });
}
console.log(`архетипов из прототипа: ${archetypes.length}`);

// ── 3. напитки каталога (если файл уже есть) ──
let drinks = [];
const drinksPath = path.join(root, 'data', 'drinks.json');
if (existsSync(drinksPath)) {
  try { const raw = JSON.parse(readFileSync(drinksPath, 'utf8')); drinks = Array.isArray(raw) ? raw : raw.drinks ?? []; } catch (e) { console.log('drinks.json не читается:', e.message); }
  console.log(`напитков в каталоге: ${drinks.length}`);
}

// ── 4. HTML ──
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let sizes = [];
const card = (input, title, sub, note, size = 132) => {
  const svg = ART.drinkArtSvg(input, { size, idPrefix: 'g' + input.id.replace(/[^a-z0-9]/gi, '') + (input.archetype ? '' : 'c'), label: title });
  sizes.push(svg.length);
  const R = ART.resolveVisual(input);
  return `<figure class="c"><div class="art">${svg}</div><figcaption><b>${esc(title)}</b><span class="sub">${esc(sub)}</span><span class="note">${esc(note ?? R.anchor ?? '')}</span><span class="src">${esc(R.glass)} · ${esc(R.source)}</span></figcaption></figure>`;
};

const byCat = {};
for (const a of archetypes) (byCat[a.category] ??= []).push(a);
const CAT_RU = { beer: 'Пиво', na_beer: 'Безалкогольное пиво', radler: 'Радлер', cider: 'Сидр', wine: 'Вино', sparkling: 'Игристое', fortified: 'Креплёное', cocktail: 'Коктейли', spirit: 'Крепкое', liqueur: 'Ликёры', kvass: 'Квас', lemonade: 'Лимонад', soda: 'Газировка', dairy: 'Кисломолочное', tea: 'Чай', coffee: 'Кофе', water: 'Вода' };

let sections = '';
sections += `<section id="archetypes"><h2>Архетипы прототипа <small>${archetypes.length}</small></h2>`;
for (const [cat, list] of Object.entries(byCat)) {
  sections += `<h3>${esc(CAT_RU[cat] ?? cat)} <small>${list.length}</small></h3><div class="grid">`;
  for (const a of list) sections += card({ id: a.id, category: a.category, archetype: a.id, sensory: a.sensory, aroma_tags: a.aroma_tags }, a.id, `${a.category} · ${a.abv}% · carb ${a.sensory.carbonation} · ${a.sensory.serve_temp} °C`);
  sections += `</div>`;
}
sections += `</section>`;

// все типы бокалов — на одной «нейтральной» жидкости, чтобы сравнить форму
sections += `<section id="glasses"><h2>Бокалы <small>${ART.GLASS_IDS.length}</small></h2><div class="grid">`;
for (const g of ART.GLASS_IDS) sections += card({ id: 'glass-' + g, category: 'beer', sensory: { carbonation: .5, serve_temp: 12 }, visual: { glass: g, srm: 6, foam: { height: 0 }, garnish: [], ice: 'none', condensation: false, steam: false } }, ART.GLASSES[g] ?? g, g, `профиль бокала «${g}»`);
sections += `</div></section>`;

// фолбэки по семейству и категории — то, что увидит незнакомый архетип
sections += `<section id="fallbacks"><h2>Фолбэки: семейства <small>${Object.keys(VIS.families).length}</small></h2><div class="grid">`;
for (const [fam, v] of Object.entries(VIS.families)) sections += card({ id: 'fam-' + fam, category: v.category ?? 'beer', family: fam, sensory: { carbonation: v.srm != null ? .6 : (v.ice && v.ice !== 'none' ? .3 : 0), serve_temp: v.steam ? 70 : 6 } }, fam, `family fallback · ${v.category ?? 'beer'}`, v.anchor);
sections += `</div><h2>Фолбэки: категории <small>${Object.keys(VIS.categories).length}</small></h2><div class="grid">`;
for (const [cat, v] of Object.entries(VIS.categories)) sections += card({ id: 'cat-' + cat, category: cat, archetype: 'unknown_' + cat, sensory: { carbonation: v.srm != null ? .6 : (v.ice ? .3 : 0), serve_temp: v.steam ? 70 : 6 } }, CAT_RU[cat] ?? cat, 'category fallback', v.anchor);
sections += `</div></section>`;

if (drinks.length) {
  sections += `<section id="drinks"><h2>Каталог data/drinks.json <small>${drinks.length}</small></h2><div class="grid small">`;
  for (const d of drinks) sections += card({ id: d.id, category: d.category, archetype: d.style?.archetype, family: d.style?.family, sensory: d.sensory, aroma_tags: d.aroma_tags, serving: d.serving, visual: d.visual }, d.name, `${d.style?.archetype ?? '—'} · ${d.category}`, d.style?.name ?? '', 96);
  sections += `</div></section>`;
}

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flavor Tree — иллюстрации напитков</title>
<style>
:root{--bg:#0B0806;--surface:#191210;--ink:#F7F1E5;--ink-3:#9A8E7C;--line:rgba(246,239,226,.10);--gold:#E5B849;--gold-glow:rgba(229,184,73,.18)}
:root[data-theme=light]{--bg:#F8F3E9;--surface:#FFFDF8;--ink:#1A140D;--ink-3:#85796A;--line:rgba(120,90,30,.16)}
@media(prefers-color-scheme:light){:root:not([data-theme=dark]){--bg:#F8F3E9;--surface:#FFFDF8;--ink:#1A140D;--ink-3:#85796A;--line:rgba(120,90,30,.16)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 Inter,system-ui,sans-serif;padding:32px 36px 60px;background-image:radial-gradient(1100px 620px at 50% -18%,var(--gold-glow),transparent 60%)}
h1,h2,h3{font-family:'Cormorant Garamond','Times New Roman',Georgia,serif;font-weight:500;letter-spacing:-.005em}h1{font-size:40px;margin:0 0 6px}h2{font-size:28px;margin:36px 0 10px;border-bottom:1px solid var(--line);padding-bottom:8px}h3{font-size:20px;margin:22px 0 8px;color:var(--gold)}small{color:var(--ink-3);font-size:.7em;margin-left:8px}
.lede{color:var(--ink-3);max-width:70ch;margin:0 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px}.grid.small{grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}
.c{margin:0;background:linear-gradient(165deg,rgba(255,248,235,.055),rgba(255,248,235,.022)),var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 12px 10px;display:flex;flex-direction:column;align-items:center;gap:6px;box-shadow:0 1px 2px rgba(0,0,0,.25),0 6px 18px -10px rgba(0,0,0,.6)}
:root[data-theme=light] .c{box-shadow:0 1px 2px rgba(60,40,5,.06),0 4px 14px -6px rgba(120,90,30,.14)}
.art{color:var(--ink);display:flex;justify-content:center;filter:drop-shadow(0 8px 14px rgba(0,0,0,.35))}:root[data-theme=light] .art{filter:drop-shadow(0 6px 12px rgba(120,90,30,.18))}
figcaption{display:flex;flex-direction:column;gap:2px;width:100%;font-size:12px}figcaption b{font-family:'Cormorant Garamond',Georgia,serif;font-size:16px;font-weight:600}
.sub{color:var(--ink-3);font-size:11px}.note{color:var(--ink-3);font-size:10.5px;line-height:1.35}.src{color:var(--gold);opacity:.7;font-size:10px;font-family:ui-monospace,monospace}
.meta{color:var(--ink-3);font-size:12px}
</style></head><body>
<h1>Иллюстрации напитков</h1>
<p class="lede">Каждая картинка построена из данных: бокал по стилю, цвет жидкости по SRM/типу, пена по стилю, пузырьки по оси carbonation, конденсат при подаче ≤ 8 °C, пар при ≥ 50 °C, гарнир по архетипу/аромат-тегам. Рендерер: <code>frontend/src/app/ui/drink-art.ts</code>, приоры: <code>data/drink_visuals.json</code>.</p>
<p class="meta">Сгенерировано ${new Date().toISOString().slice(0, 10)} · средний размер SVG ${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)} байт · максимум ${Math.max(...sizes)} байт</p>
${sections}
</body></html>`;
const htmlPath = path.join(docs, 'gallery.html');
writeFileSync(htmlPath, html);
console.log(`gallery.html: ${(html.length / 1024).toFixed(0)} KB, SVG avg ${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)} B, max ${Math.max(...sizes)} B`);

// ── 5. скриншоты (тот же Chrome, что в screenshots.mjs) ──
if (!process.argv.includes('--no-shots')) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: process.env.SCALE ? +process.env.SCALE : 1, colorScheme: theme, locale: 'ru-RU' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(300);
    const clip = process.env.CLIP; // "x,y,w,h" — фрагмент для детального просмотра
    await page.screenshot({ path: path.join(docs, `gallery-${theme}.png`), fullPage: !clip, clip: clip ? Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, +clip.split(',')[i]])) : undefined });
    if (errors.length) console.log('ERRORS', theme, errors);
    console.log('✓ gallery-' + theme + '.png');
    await ctx.close();
  }
  await browser.close();
}
rmSync(build, { recursive: true, force: true });
