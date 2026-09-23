// Проверки оптимизатора барной карты (src/app/core/menu-optimizer.ts): npm run test:optimizer
//
// Модуль компилируется во временную папку вместе с движком v2 (как в engine-parity-v2.mjs) и гоняется на:
//  1) синтетике: каталог = все архетипы data/style_priors_v2.json (детерминированно, не зависит от каталога брендов),
//     карта = только светлые лагеры, меню = по 4 тяжёлых, острых блюда и десерта;
//  2) реальном каталоге (data/drinks_v2_spa.json, гостевой пул) и трёх демо-заведениях data/venues.json.
// Баллы — те же параметры и классика, что в SPA (data/engine_v2_spa.json). Всё сверяется с прямыми вызовами scorePair
// (перебором), без повторения логики оптимизатора: индекс, лучшие пары, приросты, жадный выбор, «лишние» позиции,
// режим «только Efes», фильтр категорий, исключения, кеш и досчёт порциями, детерминизм.
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const root = path.resolve(frontend, '..');
const out = path.join(here, '.menu-optimizer-build');
const src = path.join(frontend, 'src/app/core/menu-optimizer.ts');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let O, E;
try {
  // те же строгие флаги, что в tsconfig.json приложения
  execSync(`npx tsc "${src}" --outDir "${out}" --module commonjs --target es2022 --strict --skipLibCheck `
    + '--noImplicitReturns --noFallthroughCasesInSwitch --noPropertyAccessFromIndexSignature --noImplicitOverride',
  { stdio: 'inherit', cwd: frontend });
  const require = createRequire(import.meta.url);
  O = require(path.join(out, 'core', 'menu-optimizer.js'));
  E = require(path.join(out, 'engine', 'pairing-engine-v2.js'));
} finally {
  rmSync(out, { recursive: true, force: true });
}

const J = (f) => JSON.parse(readFileSync(path.join(root, 'data', f), 'utf8'));
const bundle = J('engine_v2_spa.json');
const P = bundle.params;
const C = E.indexClassics(bundle.classics);
E.setDefaultParams(P);
const dishById = new Map(J('dishes_v2.json').map((d) => [d.id, d]));
const EFES = new Set(P.recommend.efes_relations);

// ── учёт ─────────────────────────────────────────────────────────────────────
let checks = 0;
const fails = [];
let section = '';
function expect(name, ok, detail = '') {
  checks++;
  if (!ok) fails.push(`  [${section}] ${name}${detail ? `\n      ${detail}` : ''}`);
}
const score = (b, d) => E.scorePair(b, d, {}, P, C, false).score;
const bestOf = (list, d) => (list.length ? Math.max(...list.map((b) => score(b, d))) : null);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const r1 = (x) => Math.round(x * 10) / 10;
const idOf = (raw) => E.drinkVector(raw, P).id;

/** Общие инварианты для любого сценария (всё — прямыми вызовами scorePair). */
function invariants(name, dishes, list, pool, opts = {}) {
  section = name;
  const table = O.newScoreTable(dishes, P);
  const a = O.analyzeMenu(dishes, list, pool, P, C, { table });
  const cur = dishes.map((d) => bestOf(list, d));

  // анализ: лучшая пара, индекс, доли, порядок «худшие сверху»
  for (const [j, d] of dishes.entries()) {
    const st = a.dishes.find((s) => s.dish_id === d.id);
    expect(`лучший балл карты для ${d.id}`, st && st.score === cur[j], `ожидалось ${cur[j]}, получено ${st?.score}`);
    if (st && st.drink_id) expect(`лучший напиток ${d.id} действительно даёт этот балл`, score(list.find((b) => idOf(b) === st.drink_id), d) === st.score);
    const ceil = bestOf([...pool, ...list], d);
    expect(`потолок каталога для ${d.id}`, st && st.ceiling && st.ceiling.score === ceil && ceil >= (cur[j] ?? 0), `ожидалось ${ceil}, получено ${st?.ceiling?.score}`);
    expect(`уровень ${d.id}`, st && st.level === (cur[j] === null ? 'none' : cur[j] >= 72 ? 'excellent' : cur[j] >= 60 ? 'good' : 'weak'));
  }
  const idx = list.length ? r1(mean(cur)) : (dishes.length ? 0 : null);
  expect('индекс = среднее лучших баллов', a.index === idx, `ожидалось ${idx}, получено ${a.index}`);
  const exc = cur.filter((s) => s !== null && s >= 72).length;
  expect('доля «отлично» (≥ 72)', a.excellent === exc && Math.abs(a.excellent_share - exc / dishes.length) < 1e-12);
  expect('слабые (< 60) посчитаны', a.weak === cur.filter((s) => s !== null && s < 60).length);
  expect('блюда отсортированы: худшие сверху', a.dishes.every((s, i) => i === 0 || (a.dishes[i - 1].score ?? -1) <= (s.score ?? -1)));

  // «лишние»: строго хуже лидера для каждого блюда; остальные хотя бы раз равны лидеру
  const red = new Set(a.redundant.map((r) => r.drink_id));
  for (const b of list) {
    const id = idOf(b);
    const tiesSome = dishes.some((d, j) => score(b, d) === cur[j]);
    expect(`«лишняя» позиция ${id} определена верно`, red.has(id) === !tiesSome);
  }
  for (const r of a.redundant) expect(`разрыв «лишней» ${r.drink_id} ≥ 1`, r.gap === null || r.gap >= 1);

  // предложения: оба режима + (опционально) фильтр категорий и исключения
  const runs = [
    ['any', O.suggestDrinks(dishes, list, pool, P, C, { table, analysis: a, ...opts })],
    ['efes', O.suggestDrinks(dishes, list, pool, P, C, { table, analysis: a, efesOnly: true, ...opts })],
  ];
  const listIds = new Set(list.map(idOf));
  const excluded = new Set(opts.exclude ?? []);
  const cats = opts.categories ? new Set(opts.categories) : null;
  for (const [mode, res] of runs) {
    const c = [...cur];
    let prevGain = Infinity;
    let prevIdx = res.before.index ?? 0;
    const chosen = new Set();
    for (const [k, s] of res.steps.entries()) {
      const b = pool.find((x) => idOf(x) === s.drink_id);
      expect(`${mode} шаг ${k + 1}: кандидат из каталога`, !!b);
      expect(`${mode} шаг ${k + 1}: не из карты и не исключён`, !listIds.has(s.drink_id) && !excluded.has(s.drink_id));
      if (cats) expect(`${mode} шаг ${k + 1}: категория в фильтре`, cats.has(s.category));
      if (mode === 'efes') expect(`efes шаг ${k + 1}: только портфель Efes`, EFES.has(s.efes_relation) && s.efes, s.drink_id + ' ' + s.efes_relation);
      let sum = 0;
      for (const im of s.improved) {
        const j = dishes.findIndex((d) => d.id === im.dish_id);
        const direct = score(b, dishes[j]);
        expect(`${mode} шаг ${k + 1}: прирост ${im.dish_id} > 0 и «после» = scorePair`, im.delta > 0 && im.after === direct
          && im.before === c[j] && im.delta === im.after - (c[j] ?? 0), JSON.stringify(im));
        sum += im.delta;
      }
      // блюда, которых нет в improved, не улучшаются этим напитком
      for (const [j, d] of dishes.entries()) {
        if (!s.improved.some((im) => im.dish_id === d.id)) expect(`${mode} шаг ${k + 1}: ${d.id} без прироста`, score(b, d) <= (c[j] ?? 0));
      }
      expect(`${mode} шаг ${k + 1}: прирост = Σ улучшений`, s.gain === sum);
      expect(`${mode} шаг ${k + 1}: прирост ≥ minGain`, s.gain >= (opts.minGain ?? O.DEFAULT_MIN_GAIN));
      expect(`${mode} шаг ${k + 1}: приросты не растут (жадность, субмодулярность)`, s.gain <= prevGain, `${s.gain} > ${prevGain}`);
      // жадный выбор: перебором нет кандидата с бо́льшим приростом
      let best = -1;
      for (const x of pool) {
        const id = idOf(x);
        const rel = E.drinkVector(x, P).efes_relation;
        if (listIds.has(id) || excluded.has(id) || chosen.has(id)) continue;
        if (mode === 'efes' && !EFES.has(rel)) continue;
        if (cats && !cats.has(E.drinkVector(x, P).category)) continue;
        const g = dishes.reduce((acc, d, j) => acc + Math.max(0, score(x, d) - (c[j] ?? 0)), 0);
        if (g > best) best = g;
      }
      expect(`${mode} шаг ${k + 1}: максимум прироста (перебор)`, s.gain === best, `выбран ${s.gain}, максимум ${best}`);
      for (const im of s.improved) c[dishes.findIndex((d) => d.id === im.dish_id)] = im.after;
      const idxAfter = r1(mean(c.map((x) => x ?? 0)));
      expect(`${mode} шаг ${k + 1}: индекс после шага`, s.index_after === idxAfter, `${s.index_after} ≠ ${idxAfter}`);
      expect(`${mode} шаг ${k + 1}: индекс не падает`, s.index_after >= prevIdx);
      prevGain = s.gain;
      prevIdx = s.index_after;
      chosen.add(s.drink_id);
    }
    expect(`${mode}: шагов не больше 3`, res.steps.length <= 3);
    expect(`${mode}: итог = последний шаг`, res.after.index === (res.steps.at(-1)?.index_after ?? res.before.index));
    expect(`${mode}: без повторов`, new Set(res.steps.map((s) => s.drink_id)).size === res.steps.length);
  }
  const [any, efes] = [runs[0][1], runs[1][1]];
  expect('первый шаг «любые» ≥ первого шага «Efes» (любые — надмножество)', (any.steps[0]?.gain ?? 0) >= (efes.steps[0]?.gain ?? 0));

  // кеш: без таблицы / досчёт порциями — те же результаты; детерминизм
  const plain = O.suggestDrinks(dishes, list, pool, P, C, { ...opts });
  expect('результат без готовой таблицы совпадает', JSON.stringify(plain) === JSON.stringify(any));
  const chunked = O.newScoreTable(dishes, P);
  const all = [...pool, ...list];
  for (let i = 0; i < all.length; i += 17) O.fillScores(chunked, all.slice(i, i + 17), dishes, P, C);
  const a2 = O.analyzeMenu(dishes, list, pool, P, C, { table: chunked });
  expect('таблица, заполненная порциями, даёт тот же анализ', JSON.stringify(a2) === JSON.stringify(a));
  expect('досчёт не пересчитывает готовые строки', O.fillScores(chunked, all, dishes, P, C) === 0);
  expect('повторный запуск детерминирован', JSON.stringify(O.suggestDrinks(dishes, list, pool, P, C, { ...opts })) === JSON.stringify(plain));
  return { a, any, efes };
}

// ── 1. синтетика: только светлые лагеры × тяжёлое, острое, десерты ─────────────
const priors = J('style_priors_v2.json');
const OWN = new Set(['pale_lager_intl', 'czech_pale_premium', 'czech_dark', 'weissbier', 'na_lager', 'radler', 'porter']);
const CCI = new Set(['lemonade_sweet', 'soda_water']);
const archetypes = Object.entries(priors).filter(([k, v]) => !k.startsWith('_') && v && v.sensory).map(([k, v]) => ({
  id: `arch-${k}`, name: v.label_ru ?? k, category: v.category, style: { archetype: k, family: v.family },
  abv: v.abv, ibu: v.ibu ?? null, sensory: v.sensory, aroma_tags: v.aroma_tags ?? {}, origin_affinity: v.origin_affinity ?? [],
  efes_relation: OWN.has(k) ? 'own' : CCI.has(k) ? 'cci' : 'none', availability_kz: { level: 'wide' },
}));
const LAGERS = ['light_lager', 'american_lager', 'pale_lager_intl', 'rice_lager'];
const list = archetypes.filter((d) => LAGERS.includes(d.style.archetype));
const HEAVY = ['bbq-ribs', 'pork-knuckle', 'steak', 'beshbarmak'];
const SPICY = ['buffalo-wings', 'chili-con-carne', 'tom-yum', 'lagman-spicy'];
const DESSERT = ['chocolate-fondant', 'cheesecake', 'tiramisu', 'medovik'];
const menu = [...HEAVY, ...SPICY, ...DESSERT].map((id) => {
  const d = dishById.get(id);
  if (!d) throw new Error(`нет блюда ${id} в data/dishes_v2.json`);
  return d;
});
section = 'синтетика: входы';
expect('архетипов в каталоге ≥ 57', archetypes.length >= 57, String(archetypes.length));
expect('в карте 4 светлых лагера', list.length === 4);

const syn = invariants('синтетика', menu, list, archetypes);
section = 'синтетика: смысл';
const hit = (ids) => syn.any.steps.flatMap((s) => s.improved).filter((im) => ids.includes(im.dish_id));
expect('предложено 3 напитка', syn.any.steps.length === 3, String(syn.any.steps.length));
expect('индекс заметно растёт (≥ +8)', (syn.any.after.index ?? 0) - (syn.any.before.index ?? 0) >= 8,
  `${syn.any.before.index} → ${syn.any.after.index}`);
expect('десерты получают пару лучше', hit(DESSERT).length >= 2, JSON.stringify(hit(DESSERT)));
expect('тяжёлые блюда получают пару лучше', hit(HEAVY).length >= 2, JSON.stringify(hit(HEAVY)));
expect('острые блюда получают пару лучше', hit(SPICY).length >= 1, JSON.stringify(hit(SPICY)));
expect('слабых пар становится меньше', syn.any.after.weak < syn.a.weak + syn.a.none, `${syn.a.weak} → ${syn.any.after.weak}`);
expect('в карте из одних лагеров есть слабые пары (десерты)', syn.a.weak >= 2, String(syn.a.weak));
expect('ни один лагер не предлагается повторно', syn.any.steps.every((s) => !LAGERS.includes(s.drink_id.replace('arch-', ''))));
expect('первый шаг — самый сильный (дальше прирост строго меньше)', syn.any.steps.slice(1).every((s) => s.gain < syn.any.steps[0].gain));

// фильтр категорий, исключения, minGain, пустая карта
invariants('синтетика: только пиво', menu, list, archetypes, { categories: ['beer', 'na_beer', 'radler'] });
const firstAny = syn.any.steps[0].drink_id;
invariants('синтетика: исключён лучший', menu, list, archetypes, { exclude: [firstAny] });
section = 'синтетика: minGain';
const long = O.suggestDrinks(menu, list, archetypes, P, C, { steps: 30, minGain: 12 });
expect('с большим minGain шагов меньше и каждый ≥ minGain', long.steps.every((s) => s.gain >= 12) && long.steps.length < 30);
const tiny = O.suggestDrinks(menu, list, archetypes, P, C, { steps: 30, minGain: 1 });
expect('при minGain = 1 жадность идёт до исчерпания прироста', tiny.steps.length > long.steps.length);
expect('steps = 0 — нет шагов', O.suggestDrinks(menu, list, archetypes, P, C, { steps: 0 }).steps.length === 0);
section = 'синтетика: пустая карта';
const empty = O.analyzeMenu(menu, [], archetypes, P, C);
expect('пустая карта: все блюда без пары, индекс 0', empty.none === menu.length && empty.index === 0 && empty.list_size === 0);
const fromZero = O.suggestDrinks(menu, [], archetypes, P, C);
expect('пустая карта: предложения поднимают пары с нуля', fromZero.steps.length === 3
  && fromZero.steps[0].improved.length === menu.length && fromZero.steps[0].improved.every((im) => im.before === null));
section = 'пустое меню';
const noDishes = O.analyzeMenu([], list, archetypes, P, C);
expect('пустое меню: индекс null, лишних нет', noDishes.index === null && noDishes.excellent_share === null && noDishes.redundant.length === 0);
expect('пустое меню: предложений нет', O.suggestDrinks([], list, archetypes, P, C).steps.length === 0);
section = 'таблица';
let threw = false;
try { O.fillScores(O.newScoreTable(menu.slice(1), P), list, menu, P, C); } catch { threw = true; }
expect('таблица чужого набора блюд отвергается', threw);

// ── 2. реальный каталог и демо-заведения ───────────────────────────────────────
const drinks = J('drinks_v2_spa.json').drinks;
const pool = drinks.filter((d) => d.status !== 'draft' && d.availability_kz?.level !== 'not_confirmed');
const venues = J('venues.json');
const real = [];
for (const v of venues) {
  const dishes = v.menu.map((id) => dishById.get(id)).filter(Boolean);
  const vl = pool.filter((d) => v.brands.includes(d.id) || (d.legacy_brand_id && v.brands.includes(d.legacy_brand_id)));
  const t0 = Date.now();
  const r = invariants(`демо ${v.id}`, dishes, vl, pool);
  real.push({ v, dishes, list: vl, r, ms: Date.now() - t0 });
}
section = 'демо: смысл';
for (const { v, r } of real) {
  expect(`${v.id}: есть анализ`, r.a.index !== null && r.a.list_size > 0);
  expect(`${v.id}: режим Efes — только портфель`, r.efes.steps.every((s) => EFES.has(s.efes_relation)));
}

// ── итог ─────────────────────────────────────────────────────────────────────
const fmtStep = (s) => `${s.drink_name} (+${s.gain}: ${s.improved.slice(0, 3).map((i) => `${i.dish_name} ${i.before ?? '—'}→${i.after}`).join(', ')})`;
console.log(`Синтетика (${menu.length} блюд, карта: ${list.map((d) => d.name).join(', ')}):`);
console.log(`  качество пар ${syn.a.index}, отлично ${syn.a.excellent}, слабо ${syn.a.weak}`);
console.log(`  любые:  ${syn.any.before.index} → ${syn.any.after.index}; ${syn.any.steps.map(fmtStep).join(' | ')}`);
console.log(`  Efes:   ${syn.efes.before.index} → ${syn.efes.after.index}; ${syn.efes.steps.map(fmtStep).join(' | ')}`);
for (const { v, dishes, list: vl, r, ms } of real) {
  console.log(`${v.id} (${dishes.length} блюд, ${vl.length} напитков, ${pool.length} в каталоге, ${ms} мс с проверками):`);
  console.log(`  качество пар ${r.a.index}, отлично ${r.a.excellent}/${dishes.length}, слабо ${r.a.weak}, лишних ${r.a.redundant.length}`);
  console.log(`  любые:  ${r.any.before.index} → ${r.any.after.index}; ${r.any.steps.map((s) => s.drink_name).join(', ')}`);
  console.log(`  Efes:   ${r.efes.before.index} → ${r.efes.after.index}; ${r.efes.steps.map((s) => s.drink_name).join(', ')}`);
}
if (fails.length) {
  console.error(`\nmenu-optimizer: ${fails.length} из ${checks} проверок не прошли:\n${fails.slice(0, 40).join('\n')}`);
  process.exit(1);
}
console.log(`\nmenu-optimizer: ${checks} проверок, все прошли.`);
