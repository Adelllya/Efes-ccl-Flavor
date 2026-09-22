// Прогон ИИ-пайплайна без сети: подменяем клиент Anthropic заглушкой и проверяем склейку
// «интерпретация → движок → объяснение». Запуск: node scripts/ai-dryrun.mjs
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'node_modules', '.cache', 'ft-ai'); mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'sommelier.mjs');
await build({ entryPoints: [path.resolve(here, '..', 'api/_lib/sommelier.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out,
              external: ['@anthropic-ai/sdk'], logLevel: 'error' });
const { runSommelier } = await import(pathToFileURL(out).href);

// заглушка: 1-й вызов — структурированный JSON, 2-й — текст сомелье (для kk/en — то, что вернёт narrate(brief): JSON с переводом)
function stub(interpretation, narrate) {
  const calls = [];
  const client = { messages: { create: async (params) => {
    calls.push(params);
    const text = calls.length === 1 ? JSON.stringify(interpretation) : narrate ? narrate(JSON.parse(params.messages[0].content))
      : 'Берите ' + JSON.parse(params.messages[0].content).picks[0].name + ' — он справится с жиром и дымом.';
    return { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 40 } };
  } } };
  return { client, calls };
}

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' — ' + extra)); if (!cond) failed++; };

// 1) блюдо из каталога + заведение с ценами
{
  const { client, calls } = stub({ kind: 'dish', reply: 'Похоже на шашлык', dish: { name: 'Шашлык', matched_slug: 'shashlyk', taste: 'UMAMI', weight: 'HEAVY', fat: 'HIGH', cooking: 'GRILLED', heat: 0.1, tags: ['smoke'], confidence: 0.9 }, occasion: 'hot', bitter_pref: 0 });
  const r = await runSommelier({ mode: 'ask', messages: [{ role: 'user', content: 'что взять к шашлыку в жару?' }],
    venue: { slug: 'efes-beer-garden-almaty', name: 'Efes Beer Garden', beers: ['13-region', 'bochkovoe', 'efes-pilsener'], prices: { '13-region': 1750 }, currency: '₸' } }, client);
  check('каталожное блюдо → 3 пары только из карты заведения', r.kind === 'picks' && r.picks.length === 3 && r.picks.every(p => ['13-region', 'bochkovoe', 'efes-pilsener'].includes(p.beer_id)), JSON.stringify(r.picks.map(p => p.beer_id)));
  check('цена заведения прокинута в пару', r.picks.some(p => p.beer_id === '13-region' && p.price === 1750));
  check('маршрут на полный разбор', r.route === '/pair/shashlyk?occasion=hot', r.route);
  check('объяснение от второго вызова', /Берите/.test(r.reply) && r.usage.calls === 2, r.reply);
  check('системный промпт с кэшем и строгой схемой', calls[0].system[0].cache_control?.type === 'ephemeral' && calls[0].output_config.format.type === 'json_schema');
  check('повод из вопроса попал в контекст движка', r.occasion === 'hot');
}
// 2) своё блюдо (не из каталога), фото
{
  const { client } = stub({ kind: 'dish', reply: 'Лагман с бараниной, острый', dish: { name: 'Лагман', matched_slug: null, taste: 'SPICY', weight: 'HEAVY', fat: 'HIGH', cooking: 'BOILED', heat: 0.7, tags: ['broth', 'pepper'], confidence: 0.75 }, occasion: null, bitter_pref: 0 });
  const r = await runSommelier({ mode: 'vision', image: { media_type: 'image/jpeg', data: 'AAAA' } }, client);
  check('своё блюдо → пары из всего каталога', r.kind === 'picks' && r.picks.length === 3 && r.dish.slug === null);
  check('маршрут custom с параметрами', /^\/pair\/custom\?.*taste=SPICY.*heat=70/.test(r.route), r.route);
  check('острое не получает горький хмель первым', r.picks[0].warnings.length === 0 || !/горечь/i.test(r.picks[0].warnings[0]), JSON.stringify(r.picks[0]));
}
// 3) уточнение и chat-режим
{
  const { client } = stub({ kind: 'clarify', reply: 'Что именно вы едите?', dish: { name: '', matched_slug: null, taste: 'MIXED', weight: 'MEDIUM', fat: 'MEDIUM', cooking: 'OTHER', heat: 0, tags: [], confidence: 0 }, occasion: null, bitter_pref: 0 });
  const r = await runSommelier({ mode: 'ask', messages: [{ role: 'user', content: 'ну что-нибудь' }] }, client);
  check('clarify: без пар, один вызов', r.kind === 'clarify' && r.picks.length === 0 && r.usage.calls === 1);
}
// 4) отказ модели
{
  const client = { messages: { create: async () => ({ stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }) } };
  const r = await runSommelier({ mode: 'ask', messages: [{ role: 'user', content: 'x' }] }, client);
  check('refusal обрабатывается мягко', r.kind === 'chat' && r.picks.length === 0);
}

// ── язык гостя: locale ru / kk / en ──
const SHASHLYK = { kind: 'dish', reply: 'Похоже на шашлык', dish: { name: 'Шашлык', matched_slug: 'shashlyk', taste: 'UMAMI', weight: 'HEAVY', fat: 'HIGH', cooking: 'GRILLED', heat: 0.1, tags: ['smoke'], confidence: 0.9 }, occasion: 'hot', bitter_pref: 0 };
const VENUE = { slug: 'efes-beer-garden-almaty', name: 'Efes Beer Garden', beers: ['13-region', 'bochkovoe', 'efes-pilsener'], prices: { '13-region': 1750 }, currency: '₸' };
const ask = (locale, client) => runSommelier({ mode: 'ask', messages: [{ role: 'user', content: 'что взять к шашлыку в жару?' }], venue: VENUE, ...(locale === undefined ? {} : { locale }) }, client);
// «перевод» заглушки: те же beer_id в том же порядке, столько же причин и предупреждений, каждая строка помечена языком
const translated = (tag, mutate = x => x) => brief => JSON.stringify(mutate({ reply: `[${tag}] reply`, picks: brief.picks.map(p => ({
  beer_id: p.beer_id, why: `[${tag}] ${p.why}`, reasons: p.reasons.map(s => `[${tag}] ${s}`), warnings: p.warnings.map(s => `[${tag}] ${s}`) })) }));
const engineOwned = p => JSON.stringify([p.beer_id, p.name, p.style, p.abv, p.score, p.match_type, p.sommelier_pick, p.price, p.volume]);
const humanText = p => JSON.stringify([p.why, p.reasons, p.warnings]);
const allTagged = (r, tag) => r.picks.every(p => [p.why, ...p.reasons, ...p.warnings].every(s => s.startsWith(`[${tag}] `)));

// 5) ru: нет поля / 'ru' / мусор — запрос к модели ровно прежний
const ru = stub(SHASHLYK); const ruOut = await ask(undefined, ru.client);
{
  check('нет locale → ru, эхо в ответе', ruOut.locale === 'ru');
  check('ru: один system-блок, объяснение текстом без JSON-схемы, 700 токенов',
    ru.calls.every(c => c.system.length === 1) && !ru.calls[1].output_config.format && ru.calls[1].max_tokens === 700, JSON.stringify(ru.calls[1].output_config));
  check('ru: в brief нет полей для перевода', JSON.parse(ru.calls[1].messages[0].content).picks.every(p => !('beer_id' in p) && !('why' in p)));
  for (const junk of ['ru', 'de', 'EN', 42, null]) {
    const s = stub(SHASHLYK); const r = await ask(junk, s.client);
    check(`locale=${JSON.stringify(junk)} → ru, запросы те же`, r.locale === 'ru' && JSON.stringify(s.calls) === JSON.stringify(ru.calls) && JSON.stringify(r.picks) === JSON.stringify(ruOut.picks));
  }
}
// 6) en и kk: ответ и тексты пар на языке гостя, выбор — только от движка, кэшируемый префикс тот же
for (const [locale, hint, label] of [['en', /английск/, /^(Complement|Contrast|Cleanse|Bridge)$/], ['kk', /казахск.*кириллиц/, /^(Complement · толықтыру|Contrast · контраст|Cleanse · тазарту|Bridge · көпір)$/]]) {
  const s = stub(SHASHLYK, translated(locale)); const r = await ask(locale, s.client);
  check(`${locale}: эхо locale, reply из JSON`, r.locale === locale && r.kind === 'picks' && r.reply === `[${locale}] reply`, r.reply);
  check(`${locale}: why / reasons / warnings переведены`, allTagged(r, locale), JSON.stringify(r.picks[0]));
  check(`${locale}: сорта, порядок, оценки и цены — как у движка`, r.picks.map(engineOwned).join() === ruOut.picks.map(engineOwned).join() && r.route === ruOut.route);
  check(`${locale}: match_label из статичной карты`, r.picks.every(p => label.test(p.match_label)), r.picks.map(p => p.match_label).join(' | '));
  check(`${locale}: кэшируемый system-блок байт-в-байт как у ru (оба вызова)`, [0, 1].every(i => JSON.stringify(s.calls[i].system[0]) === JSON.stringify(ru.calls[i].system[0])));
  check(`${locale}: указание языка — вторым блоком, без cache_control`, [0, 1].every(i => s.calls[i].system.length === 2 && !s.calls[i].system[1].cache_control && hint.test(s.calls[i].system[1].text)), s.calls[0].system[1]?.text);
  check(`${locale}: схема интерпретации и сообщения гостя не зависят от языка`, JSON.stringify(s.calls[0].output_config) === JSON.stringify(ru.calls[0].output_config) && JSON.stringify(s.calls[0].messages) === JSON.stringify(ru.calls[0].messages));
  check(`${locale}: объяснение — строгая JSON-схема, в brief есть beer_id и why`, s.calls[1].output_config.format?.type === 'json_schema' && JSON.parse(s.calls[1].messages[0].content).picks.every(p => p.beer_id && p.why));
}
// 7) модель вернула сломанный JSON → русские тексты движка, запрос не падает
for (const [name, bad] of [['оборванный JSON', () => '{"reply": "Go for'], ['текст вместо JSON', () => 'Take the pilsner.'], ['пустой ответ', () => '']]) {
  const s = stub(SHASHLYK, bad); const r = await ask('en', s.client);
  check(`en, ${name}: откат на русские тексты пар`, r.kind === 'picks' && r.locale === 'en' && r.picks.map(humanText).join() === ruOut.picks.map(humanText).join() && r.picks.map(engineOwned).join() === ruOut.picks.map(engineOwned).join());
  check(`en, ${name}: reply — фраза из интерпретации, не обломок JSON`, r.reply === SHASHLYK.reply, r.reply);
}
// 8) модель пытается поменять выбор → перевод отбрасывается целиком, пары остаются от движка
for (const [name, mutate] of [
  ['другой порядок', d => ({ ...d, picks: [...d.picks].reverse() })],
  ['чужой beer_id', d => ({ ...d, picks: d.picks.map((p, i) => i ? p : { ...p, beer_id: 'guinness' }) })],
  ['пропала причина', d => ({ ...d, picks: d.picks.map((p, i) => i ? p : { ...p, reasons: p.reasons.slice(1) }) })],
  ['лишняя пара', d => ({ ...d, picks: [...d.picks, d.picks[0]] })],
  ['пустая строка в переводе', d => ({ ...d, picks: d.picks.map((p, i) => i ? p : { ...p, why: ' ' }) })],
]) {
  const s = stub(SHASHLYK, translated('kk', mutate)); const r = await ask('kk', s.client);
  check(`kk, ${name}: тексты и пары движка`, r.picks.map(humanText).join() === ruOut.picks.map(humanText).join() && r.picks.map(engineOwned).join() === ruOut.picks.map(engineOwned).join(), JSON.stringify(r.picks.map(p => p.beer_id)));
}
{
  // подменённые оценка и цена в JSON просто игнорируются: из перевода берутся только why / reasons / warnings
  const s = stub(SHASHLYK, translated('en', d => ({ ...d, picks: d.picks.map(p => ({ ...p, score: 100, price: 1, name: 'Guinness' })) }))); const r = await ask('en', s.client);
  check('en: score / price / name из JSON не попадают в ответ', allTagged(r, 'en') && r.picks.map(engineOwned).join() === ruOut.picks.map(engineOwned).join());
}
{
  // у пары с предупреждением движка (кумыс × крепкий сорт) предупреждение тоже переводится, а потерянное — откат
  const KUMYS = { ...SHASHLYK, reply: 'Қымыз', dish: { ...SHASHLYK.dish, name: 'Кумыс', matched_slug: 'kumys' }, occasion: null };
  const kumys = (narrate) => runSommelier({ mode: 'ask', messages: [{ role: 'user', content: 'қымызға не сәйкес келеді?' }], locale: 'kk' }, stub(KUMYS, narrate).client);
  const ok = await kumys(translated('kk')); const warned = ok.picks.filter(p => p.warnings.length);
  check('kk: предупреждение движка переведено', warned.length > 0 && allTagged(ok, 'kk'), JSON.stringify(ok.picks.map(p => p.warnings)));
  const lost = await kumys(translated('kk', d => ({ ...d, picks: d.picks.map(p => ({ ...p, warnings: [] })) })));
  check('kk: модель потеряла предупреждение → русские тексты, предупреждение на месте', lost.picks.some(p => p.warnings.length) && !lost.picks.some(p => p.why.startsWith('[kk]')), JSON.stringify(lost.picks.map(p => p.warnings)));
}
// 9) ветки без пар: уточнение, отказ, пустая карта
{
  const clarify = { ...SHASHLYK, kind: 'clarify', reply: 'Қандай тағам жеп отырсыз?' };
  const r1 = await ask('kk', stub(clarify).client);
  check('kk clarify: вопрос модели как есть, эхо locale', r1.kind === 'clarify' && r1.reply === clarify.reply && r1.locale === 'kk');
  const r2 = await ask('en', stub({ ...clarify, reply: '' }).client);
  check('en clarify без текста → готовая английская фраза', /what you are eating/.test(r2.reply), r2.reply);
  const refuse = { messages: { create: async () => ({ stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }) } };
  const r3 = await ask('kk', refuse); const r4 = await ask('en', refuse);
  check('refusal: kk и en — готовые фразы на языке гостя', /сыра/.test(r3.reply) && r3.locale === 'kk' && /beer/.test(r4.reply) && r4.locale === 'en', r3.reply + ' | ' + r4.reply);
  const s = stub(SHASHLYK); const r5 = await runSommelier({ mode: 'ask', messages: [{ role: 'user', content: 'шашлык' }], venue: { slug: 'x', beers: ['no-such-beer'] }, locale: 'en' }, s.client);
  check('en, в карте нет подходящего сорта: английская фраза, один вызов', r5.kind === 'picks' && r5.picks.length === 0 && /no beer on this venue/.test(r5.reply) && r5.usage.calls === 1, r5.reply);
}
console.log(failed ? `\nai-dryrun: ${failed} failed` : '\nai-dryrun: all ok');
process.exit(failed ? 1 : 0);
