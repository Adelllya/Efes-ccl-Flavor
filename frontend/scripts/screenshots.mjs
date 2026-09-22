// Скриншоты ключевых экранов (mobile 390×844 + desktop 1366×900) через Playwright.
// Запуск: npm run build && npm run shots  → docs/screenshots/*.png
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', 'dist/frontend/browser');
const out = path.resolve(here, '..', '..', 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  let p = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p) || statSync(p).isDirectory()) p = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(4317);

const routes = [
  ['home', '/'], ['pair', '/pair'], ['pair-results', '/pair/beshbarmak'], ['pair-custom', '/pair/custom?taste=SPICY&weight=HEAVY&fat=HIGH&cooking=GRILLED&heat=70&name=Лагман'],
  ['beers', '/beers'], ['beer-detail', '/beers/efes-pilsener'], ['dishes', '/dishes'], ['academy', '/academy'], ['lesson', '/academy/expert'],
  ['dna', '/dna'], ['qr', '/qr/EBG-05'], ['admin', '/admin'], ['about', '/about'],
  ['venue-menu', '/m/efes-beer-garden-almaty/5'], ['business', '/business'], ['cabinet', '/cabinet'],
];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, vp, mobile] of [['mobile', { width: 390, height: 844 }, true], ['desktop', { width: 1366, height: 900 }, false]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', colorScheme: process.env.DARK ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text().slice(0, 200)}`); });
  for (const [id, url] of routes) {
    await page.goto('http://127.0.0.1:4317' + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    if (id === 'dna' && mobile) { for (const b of ['efes-pilsener', 'stary-melnik', 'wukong-ju']) { /* оценки через UI кнопки */ } }
    await page.screenshot({ path: path.join(out, `${name}-${id}.png`), fullPage: !!process.env.FULL });
    console.log('✓', name, id);
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await ctx.close();
}
await browser.close();
server.close();
