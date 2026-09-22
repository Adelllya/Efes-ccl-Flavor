// Интерактивный smoke-тест SPA: мастер «своё блюдо», DNA, урок+квиз, админка, QR. Запуск: npm run build && node scripts/smoke.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', 'dist/frontend/browser');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => { let p = path.join(dist, decodeURIComponent(req.url.split('?')[0])); if (!existsSync(p) || statSync(p).isDirectory()) p = path.join(dist, 'index.html'); res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }).listen(4319);
const base = 'http://127.0.0.1:4319';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log('✓', name); } catch (e) { failed++; console.log('✗', name, '—', e.message.split('\n').slice(0, 4).join(' | ')); } };
// фиксированная нижняя панель вкладок перекрывает элементы у края экрана — центрируем перед тапом
const tap = async (loc) => {
  const el = loc.first();
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  // в мобильной эмуляции Chrome visualViewport смещён относительно layout viewport (offsetTop ≠ 0),
  // координатный клик Playwright промахивается — падаем на DOM-событие click
  try { await el.click({ timeout: 4000 }); } catch { await el.dispatchEvent('click'); }
};

await check('главная: поиск «казы» ведёт к результатам', async () => {
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.fill('input[type=search]', 'казы');
  await page.waitForSelector('.suggest button');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/pair/kazy');
  await page.waitForSelector('ft-match');
  const first = await page.locator('ft-match h3').first().textContent();
  if (!/Efes Pilsener/.test(first)) throw new Error('ожидали Efes Pilsener первым, получили ' + first);
});
await check('результаты: смена повода «Жара» перестраивает список', async () => {
  const before = await page.locator('ft-match h3').allTextContents();
  await page.getByRole('button', { name: /Жара/ }).click();
  await page.waitForTimeout(200);
  const after = await page.locator('ft-match h3').allTextContents();
  if (before.join() === after.join() && before.length < 2) throw new Error('список не изменился');
});
await check('результаты: разбор по правилам раскрывается', async () => {
  await tap(page.getByRole('button', { name: /Почему такая оценка/ }));
  await page.waitForSelector('.breakdown .rule');
  const n = await page.locator('.breakdown .rule').count();
  if (n < 4) throw new Error('мало правил: ' + n);
});
await check('мастер «своё блюдо»: 4 шага → результаты', async () => {
  await page.goto(base + '/pair', { waitUntil: 'networkidle' });
  await page.fill('input[type=search]', 'лагман с бараниной');
  await page.getByRole('button', { name: /Описать/ }).click();
  await page.getByRole('button', { name: /Острое/ }).click();
  await page.getByRole('button', { name: 'Сытное' }).click();
  await page.getByRole('button', { name: 'Высокая' }).click();
  await page.getByRole('button', { name: /Дальше/ }).click();
  await page.getByRole('button', { name: /Варка/ }).click();
  await page.getByRole('button', { name: /Подобрать пиво/ }).click();
  await page.waitForURL('**/pair/custom**');
  await page.waitForSelector('ft-match');
  const h1 = await page.locator('h1').first().textContent();
  if (!/лагман/i.test(h1)) throw new Error('название не перенесено: ' + h1);
});
await check('DNA: три оценки → архетип и рекомендации', async () => {
  await page.goto(base + '/dna', { waitUntil: 'networkidle' });
  const cards = page.locator('.dcard');
  await tap(cards.nth(0).locator('button.love'));
  await tap(cards.nth(1).locator('button').nth(1));
  await tap(cards.nth(2).locator('button').nth(0));
  await page.waitForSelector('.result');
  const arch = await page.locator('.result h2').textContent();
  if (!arch) throw new Error('архетип не показан');
  await tap(page.getByRole('button', { name: /Карточка для сторис/ }));
  await page.waitForSelector('.card-preview img');
});
await check('академия: урок → +50 XP, квиз проходится', async () => {
  await page.goto(base + '/academy/novice', { waitUntil: 'networkidle' });
  await tap(page.locator('.lesson .lh'));
  await tap(page.getByRole('button', { name: /Прочитал/ }));
  await page.waitForSelector('.toast');
  await tap(page.getByRole('button', { name: /^Начать|Пройти ещё раз/ }));
  for (let i = 0; i < 5; i++) { await tap(page.locator('.opt')); await tap(page.getByRole('button', { name: /Дальше|Результат/ })); }
  await page.waitForSelector('text=/из 5/');
});
await check('XP отображается в шапке', async () => {
  const xp = await page.locator('.xp').textContent();
  if (!/\d+ XP/.test(xp) || parseInt(xp) < 50) throw new Error('XP: ' + xp);
});
await check('QR: токен EBG-05 → заведение, стол 5, меню', async () => {
  await page.goto(base + '/qr/EBG-05', { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Efes Beer Garden")');
  await page.waitForSelector('p:has-text("стол 5")');
  await tap(page.locator('ft-dish-card'));
  await page.waitForURL('**/pair/**');
  await page.waitForSelector('ft-match');
  const chip = await page.getByRole('button', { name: /Только в наличии/ }).count();
  if (!chip) throw new Error('нет чипа заведения');
});
await check('админка: изменение интенсивности пересчитывает профиль', async () => {
  await page.goto(base + '/admin', { waitUntil: 'networkidle' });
  const before = await page.locator('.sticky').textContent();
  const slider = page.locator('input[type=range]').first();
  await slider.fill('10');
  await page.waitForTimeout(150);
  const after = await page.locator('.sticky').textContent();
  if (before === after) throw new Error('профиль не изменился');
});
await check('админка: QR-столы генерируются', async () => {
  await tap(page.getByRole('button', { name: 'QR-столы' }));
  await tap(page.getByRole('button', { name: /Сгенерировать/ }));
  await page.waitForSelector('.qr-svg img');
  const n = await page.locator('.qr-card').count();
  if (n !== 12) throw new Error('ожидали 12 QR, получили ' + n);
});
await check('сертификат: образец рендерится с QR', async () => {
  await page.goto(base + '/academy', { waitUntil: 'networkidle' });
  await tap(page.getByRole('button', { name: /Посмотреть образец/ }));
  await page.waitForSelector('.cert .c-qr img', { timeout: 8000 });
});
await check('карта вкусов и тёмная тема', async () => {
  await page.goto(base + '/beers', { waitUntil: 'networkidle' });
  await tap(page.getByRole('button', { name: /Карта вкусов/ }));
  await page.waitForSelector('.map .pt');
  await page.locator('button[title="Переключить тему"]').click();
  const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (t !== 'dark') throw new Error('тема: ' + t);
});

// ── SaaS: гостевое меню, кабинет, лендинг, печать QR ──
await check('гостевое меню: блюдо → 3 сорта с ценами → «Заказать»', async () => {
  await page.goto(base + '/m/efes-beer-garden-almaty/5', { waitUntil: 'networkidle' });
  await page.waitForSelector('.row .price');
  const rows = await page.locator('.row').count();
  if (rows < 10) throw new Error('мало блюд: ' + rows);
  if (!/стол 5/.test(await page.locator('.table').textContent())) throw new Error('нет номера стола');
  await tap(page.locator('.row').first());
  await page.waitForSelector('.sheet .sg');
  const n = await page.locator('.sheet .sg').count();
  if (n !== 3) throw new Error('ожидали 3 предложения, получили ' + n);
  const price = await page.locator('.sheet .sg-price').first().textContent();
  if (!/\d/.test(price)) throw new Error('нет цены: ' + price);
  await tap(page.locator('.sheet .sg button').first());
  await page.waitForSelector('.toast');
});
await check('кабинет: демо-вход → обзор с выручкой и графиком', async () => {
  await page.goto(base + '/cabinet', { waitUntil: 'networkidle' });
  await tap(page.getByRole('button', { name: 'заполнить' }));
  await tap(page.getByRole('button', { name: 'Войти' }));
  await page.waitForSelector('.hero .big');
  const big = await page.locator('.hero .big').textContent();
  if (!/\+\d/.test(big)) throw new Error('нет суммы эффекта: ' + big);
  const bars = await page.locator('svg rect.sbar').count();
  if (bars !== 30) throw new Error('ожидали 30 столбцов, получили ' + bars);
  const pairs = await page.locator('.list li').count();
  if (pairs < 3) throw new Error('пустые топы');
});
await check('кабинет: стоп-лист → сохранить → гость не видит позицию', async () => {
  await tap(page.getByRole('button', { name: /Меню и цены/ }));
  await page.waitForSelector('.mrow');
  const first = page.locator('.mrow').first();
  const name = (await first.locator('input.nm').inputValue()).trim();
  await first.locator('input[type=checkbox]').dispatchEvent('click');
  await page.waitForSelector('.savebar');
  await tap(page.locator('.savebar button'));
  await page.waitForSelector('.toast');
  await page.goto(base + '/m/efes-beer-garden-almaty/5', { waitUntil: 'networkidle' });
  await page.waitForSelector('.beer');
  const names = await page.locator('.beer .bn').allTextContents();
  if (names.some(t => t.trim() === name)) throw new Error('позиция из стоп-листа видна гостю: ' + name);
});
await check('кабинет: столы и печать QR', async () => {
  await page.goto(base + '/cabinet', { waitUntil: 'networkidle' });
  await tap(page.getByRole('button', { name: /Столы и QR/ }));
  await page.waitForSelector('.tbl .tok');
  const n = await page.locator('.tbl').count();
  if (n !== 12) throw new Error('ожидали 12 столов, получили ' + n);
  await page.goto(base + '/cabinet/print', { waitUntil: 'networkidle' });
  await page.waitForSelector('.qr img', { timeout: 8000 });
});
await check('лендинг: калькулятор считает, заявка отправляется', async () => {
  await page.goto(base + '/business', { waitUntil: 'networkidle' });
  const before = await page.locator('.co-big').textContent();
  await page.locator('#calc input[type=range]').nth(1).fill('400');
  await page.waitForTimeout(100);
  const after = await page.locator('.co-big').textContent();
  if (before === after) throw new Error('калькулятор не пересчитал');
  await page.fill('input[name=venue_name]', 'Тест паб');
  await page.fill('input[name=phone]', '+77010000000');
  await tap(page.getByRole('button', { name: /Отправить заявку/ }));
  await page.waitForSelector('.soft.ok');
});
console.log(`\nsmoke: ${passed} ok, ${failed} failed`);
if (errors.length) console.log('Ошибки консоли:\n' + [...new Set(errors)].join('\n'));
await browser.close(); server.close();
process.exit(failed || errors.length ? 1 : 0);
