// Паритет импорта меню (src/app/core/menu-import.ts ↔ backend/api/importers.py) по data/samples/expected_import.json.
// Запуск: npm run test:import. Перегенерировать эталон после осознанного изменения правил: node scripts/menu-import-test.mjs --update
// (после этого обязательно прогнать python manage.py test api.tests.test_importers — эталон должен сойтись и там).
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const samples = path.join(root, 'data', 'samples');
const goldenPath = path.join(samples, 'expected_import.json');
const update = process.argv.includes('--update');

// компилируем модуль во временную папку (у него нет зависимостей от Angular)
const out = mkdtempSync(path.join(tmpdir(), 'ft-menu-import-'));
execSync(`npx tsc ${path.join(here, '..', 'src/app/core/menu-import.ts')} --outDir ${out} --module commonjs --target es2022 --strict --skipLibCheck`, { stdio: 'inherit' });
const require = createRequire(import.meta.url);
const M = require(path.join(out, 'menu-import.js'));
rmSync(out, { recursive: true, force: true });

const J = (f) => JSON.parse(readFileSync(path.join(root, 'data', f), 'utf8'));
const catalog = { brands: J('brands.json'), dishes: J('dishes.json') };

// ── те же сценарии, что в test_importers.py ──
const ERROR_CASES = [
  ['', 'empty'], ['   \n\n', 'empty'], ['{bad json', 'bad_json'], ['{"foo": 1}', 'unknown_format'], ['[1, 2, 3]', 'unknown_format'],
  ['{"products": "нет"}', 'unknown_format'], ['Цена;Себестоимость\n100;50', 'no_name_column'], ['Название;Цена\n', 'no_rows'],
  ['{"products": []}', 'no_rows'], ['{"response": [{"product_name": "", "price": {"1": "100"}}]}', 'no_rows'],
  ['Название;Цена\n' + Array.from({ length: 2001 }, (_, i) => `Позиция ${i};100`).join('\n'), 'too_many_rows'],
  ['x'.repeat(2 * 1024 * 1024 + 1), 'too_large'],
];
const PLAN_CASES = [
  { fixture: 'iiko_nomenclature.json', choices: {}, existing: [], limit: 40 },
  { fixture: 'iiko_nomenclature.json', choices: { '8': 'kozel', '24': '', '25': 'buffalo-wings', '49': 'airan', '3': 'no-such-slug' },
    existing: ['BEER:efes-pilsener', 'DISH:shashlyk', 'BEER:kozel'], limit: 12 },
  { fixture: 'poster_products.json', choices: { '1': 'efes-pilsener', '5': '' }, existing: ['BEER:legenda-777'], limit: 300 },
  { fixture: 'bar_menu_tab.csv', choices: {}, existing: [], limit: 5 },
];

function build() {
  const fixtures = {};
  for (const file of readdirSync(samples).filter(f => f !== 'expected_import.json').sort()) {
    const bytes = new Uint8Array(readFileSync(path.join(samples, file)));
    const { text, encoding } = M.decodeBytes(bytes);
    fixtures[file] = { encoding, result: M.parseMenu(text, catalog) };
  }
  const errors = ERROR_CASES.map(([input, expected]) => {
    let code = 'ok';
    try { M.parseMenu(input, catalog); } catch (e) { code = e instanceof M.MenuImportError ? e.code : `unexpected:${e.message}`; }
    return { input: input.length > 120 ? `<${input.length} chars>` : input, expected, code };
  });
  const plans = PLAN_CASES.map(c => ({ ...c, plan: M.planImport(fixtures[c.fixture].result.rows, c.choices, catalog, c.existing, c.limit) }));
  return { config: M.importerConfig(), fixtures, errors, plans };
}

// декодирование проверяем отдельно: BOM, Windows-1251, UTF-16
const decodeChecks = [
  [[0xef, 0xbb, 0xbf, 0x41], 'A', 'utf-8'],
  [[0xd0, 0x9f, 0xd0, 0xb8, 0xd0, 0xb2, 0xd0, 0xbe], 'Пиво', 'utf-8'],
  [[0xcf, 0xe8, 0xe2, 0xee, 0x20, 0xb8, 0x98], 'Пиво ё\ufffd', 'windows-1251'],
  [[0xff, 0xfe, 0x1f, 0x04, 0x38, 0x04], 'Пи', 'utf-16le'],
  [[0xfe, 0xff, 0x04, 0x1f, 0x04, 0x38], 'Пи', 'utf-16be'],
];

const actual = build();
if (update) {
  const golden = { _comment: 'Эталон паритета импорта меню. Генерируется: cd frontend && node scripts/menu-import-test.mjs --update. Не править руками.', ...actual };
  writeFileSync(goldenPath, JSON.stringify(golden, null, 1) + '\n');
  console.log(`эталон записан: ${Object.keys(actual.fixtures).length} фикстур, ${actual.errors.length} ошибок, ${actual.plans.length} планов → ${goldenPath}`);
}

let fails = 0, checked = 0;
const fail = (msg) => { fails++; if (fails <= 25) console.log('✗', msg); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const [bytes, text, enc] of decodeChecks) {
  checked++;
  const r = M.decodeBytes(new Uint8Array(bytes));
  if (r.text !== text || r.encoding !== enc) fail(`decode ${enc}: got ${JSON.stringify(r)}`);
}
for (const e of actual.errors) { checked++; if (e.code !== e.expected) fail(`error case ${JSON.stringify(e.input).slice(0, 60)}: ожидали ${e.expected}, получили ${e.code}`); }

let golden;
try { golden = JSON.parse(readFileSync(goldenPath, 'utf8')); } catch { fail(`нет эталона ${goldenPath} — запустите с --update`); }
if (golden) {
  checked++;
  if (!same(golden.config, actual.config)) fail('config (словари/пороги) отличается от эталона');
  for (const [file, exp] of Object.entries(golden.fixtures)) {
    checked++;
    const got = actual.fixtures[file];
    if (!got) { fail(`фикстура ${file} не найдена`); continue; }
    if (got.encoding !== exp.encoding) fail(`${file}: кодировка ${got.encoding} ≠ ${exp.encoding}`);
    const keys = ['format', 'delimiter', 'total', 'skipped', 'matched', 'ambiguous', 'unmatched', 'warnings'];
    for (const k of keys) if (!same(got.result[k], exp.result[k])) fail(`${file}: ${k} ${JSON.stringify(got.result[k])} ≠ ${JSON.stringify(exp.result[k])}`);
    exp.result.rows.forEach((row, i) => {
      checked++;
      if (!same(got.result.rows[i], row)) fail(`${file} строка ${i} (${row.name}): ${JSON.stringify(got.result.rows[i])} ≠ ${JSON.stringify(row)}`);
    });
  }
  for (const f of Object.keys(actual.fixtures)) if (!golden.fixtures[f]) fail(`новая фикстура ${f} не в эталоне — --update`);
  golden.plans.forEach((p, i) => { checked++; if (!same(actual.plans[i]?.plan, p.plan)) fail(`план ${i} (${p.fixture}) отличается от эталона`); });
  golden.errors.forEach((e, i) => { checked++; if (actual.errors[i]?.code !== e.code) fail(`ошибка ${i}: ${actual.errors[i]?.code} ≠ ${e.code}`); });
}

// детерминизм: тот же вход → тот же выход
checked++;
if (!same(build(), actual)) fail('результат недетерминирован (второй прогон отличается)');

const totals = Object.values(actual.fixtures).map(f => `${f.result.matched}/${f.result.ambiguous}/${f.result.unmatched}`).join(' ');
console.log(`menu import parity: ${checked} проверок, расхождений: ${fails} (matched/ambiguous/unmatched по фикстурам: ${totals})`);
process.exit(fails ? 1 : 0);
