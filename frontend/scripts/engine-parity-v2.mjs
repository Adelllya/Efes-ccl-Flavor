// Паритет TS-движка v2 (src/app/engine/pairing-engine-v2.ts) с Python (backend/api/pairing/engine_v2.py)
// по data/golden_v2.json (пишет scripts/engine_eval_v2.py). Запуск: npm run test:engine2 [-- путь/к/golden.json]
//
// Скрипт повторяет build_golden() из engine_eval_v2.py на TS-движке (те же входы из golden.inputs, те же параметры
// golden.params, те же проекции _slim_result/_slim_list/_sig) и сравнивает ВСЁ, что хранит golden: помощники, профили,
// матрицу (+ sig — sha1 полного результата с текстами), кейсы (все компоненты с текстами), recommend / by_category /
// reverse, edge (синтетические записи). Числа — точное совпадение (Object.is). Неизвестная секция golden = расхождение.
// Дополнительно: матрица с explain=true (баллы не зависят от текстов), dnaVector, семантика mergeParams/getPath/setPath,
// asRecords.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const root = path.resolve(frontend, '..');
const goldenPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'data', 'golden_v2.json');
const out = path.join(here, '.engine-v2-build');
const src = path.join(frontend, 'src/app/engine/pairing-engine-v2.ts');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let E;
try {
  // те же строгие флаги, что в tsconfig.json приложения
  execSync(`npx tsc "${src}" --outDir "${out}" --module commonjs --target es2022 --strict --skipLibCheck `
    + '--noImplicitReturns --noFallthroughCasesInSwitch --noPropertyAccessFromIndexSignature --noImplicitOverride',
  { stdio: 'inherit', cwd: frontend });
  E = createRequire(import.meta.url)(path.join(out, 'pairing-engine-v2.js'));
} finally {
  rmSync(out, { recursive: true, force: true });
}

const G = JSON.parse(readFileSync(goldenPath, 'utf8'));
const P = G.params;

// ── сравнение ────────────────────────────────────────────────────────────────
let checks = 0;
let nDiff = 0;
const shown = [];
const perSection = new Map();
let section = '';
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fmt = (v) => (v === undefined ? '<нет>' : JSON.stringify(v));

function diff(p, exp, act) {
  nDiff++;
  if (shown.length < 20) shown.push(`  ${p}\n    ожидалось: ${fmt(exp)}\n    получено:  ${fmt(act)}`);
}

function leaf(p, exp, act) {
  checks++;
  perSection.set(section, (perSection.get(section) || 0) + 1);
  if (!Object.is(exp, act)) diff(p, exp, act);
}

/** Рекурсивное сравнение: массивы — по длине и элементам, объекты — по множеству ключей и значениям. */
function cmp(p, exp, act) {
  if (Array.isArray(exp)) {
    if (!Array.isArray(act)) return leaf(p, exp, act);
    leaf(`${p}.length`, exp.length, act.length);
    for (let i = 0; i < Math.min(exp.length, act.length); i++) cmp(`${p}[${i}]`, exp[i], act[i]);
    return undefined;
  }
  if (exp !== null && typeof exp === 'object') {
    if (act === null || typeof act !== 'object' || Array.isArray(act)) return leaf(p, exp, act);
    for (const k of Object.keys(exp)) cmp(`${p}.${k}`, exp[k], hasOwn(act, k) ? act[k] : undefined);
    for (const k of Object.keys(act)) if (!hasOwn(exp, k)) leaf(`${p}.${k}`, undefined, act[k]);
    return undefined;
  }
  return leaf(p, exp, act);
}

/** Проверка без golden (семантика API): ok — булево. */
function expect(p, ok, detail = '') {
  checks++;
  perSection.set(section, (perSection.get(section) || 0) + 1);
  if (!ok) diff(p, 'true', `false${detail ? ` (${detail})` : ''}`);
}

/** Выход golden минус эхо входных полей спецификации; неизвестные ключи golden попадут в сравнение и всплывут. */
function outputsOf(entry, specKeys) {
  const o = {};
  for (const k of Object.keys(entry)) if (!specKeys.includes(k)) o[k] = entry[k];
  return o;
}

// ── проекции как в engine_eval_v2.py (_slim_result, _slim_list) ─────────────
const RESULT_KEYS = ['drink_id', 'dish_id', 'score', 'band', 'match_type', 'secondary_type', 'vetoes', 'capped', 'excluded',
  'classic', 'efes_partner', 'W_B', 'F_B', 'W_D', 'F_D', 'W_B_eff', 'dW', 'dF', 'fit', 'core', 'ctx_points', 'raw'];
function slimResult(r) {
  const o = {};
  for (const k of RESULT_KEYS) o[k] = r[k];
  o.components = r.components.map((c) => ({ rule: c.rule, family: c.family, points: c.points, key: c.key,
    evidence: c.evidence, text: c.text }));
  o.mechanisms = r.mechanisms.map((c) => c.rule);
  o.reasons = r.reasons.map((c) => c.rule);
  o.warnings = r.warnings.map((c) => ({ rule: c.rule, text: c.text }));
  return o;
}
const slimList = (items) => items.map((r) => ({ drink_id: r.drink_id, score: r.score, efes_partner: r.efes_partner }));

// ── сигнатура полного результата (= engine_eval_v2.py::_sig): sha1 канонической строки, первые 12 hex ─────
const SIG_NUMS = ['W_B', 'F_B', 'W_D', 'F_D', 'W_B_eff', 'dW', 'dF', 'fit', 'core', 'ctx_points', 'raw'];
function sigLine(r) {
  const flag = (v) => (v ? '1' : '0');
  const lines = r.components.map((c) => `C|${c.rule}|${c.family}|${c.key}|${c.evidence}|${E.fmt2(c.points)}|${c.text}`);
  lines.push(`M|${r.mechanisms.map((c) => c.rule).join(',')}`);
  lines.push(`R|${r.reasons.map((c) => c.rule).join(',')}`);
  for (const w of r.warnings) lines.push(`W|${w.rule}|${w.text}`);
  lines.push(['S', String(r.score), r.band, r.band_label, r.match_type, r.secondary_type || '', r.vetoes.join(','),
    flag(r.capped), flag(r.excluded), flag(r.classic)].join('|'));
  lines.push(['N', ...SIG_NUMS.map((k) => E.fmt2(r[k]))].join('|'));
  return lines.join('\n');
}
const sig = (r) => createHash('sha1').update(sigLine(r), 'utf8').digest('hex').slice(0, 12);
let sigDebug = null; // TS-строка первой несовпавшей сигнатуры — сравнить с engine_eval_v2._sig для той же пары
function cmpSig(p, exp, r) {
  const act = sig(r);
  leaf(p, exp, act);
  if (exp !== act && !sigDebug) sigDebug = `${p}\n${sigLine(r)}`;
}

// ── секции golden, которые проверяет скрипт (новая секция в golden без проверки здесь = расхождение) ─────────
const KNOWN = ['version', 'engine', 'generated_by', 'sources', 'recommend_pool', '_doc', 'params', 'inputs', 'helpers',
  'profiles', 'matrix_fields', 'matrix', 'cases', 'recommend', 'by_category', 'reverse', 'edge'];
section = 'golden';
for (const k of Object.keys(G)) if (!KNOWN.includes(k)) leaf(`golden.${k}`, 'секция проверяется engine-parity-v2.mjs', undefined);
const KNOWN_MATRIX = ['drink', 'dish', 'score', 'core', 'match_type', 'secondary_type', 'vetoes', 'sig'];
for (const f of G.matrix_fields) if (!KNOWN_MATRIX.includes(f)) leaf(`golden.matrix_fields.${f}`, 'поле проверяется', undefined);
const ctxLabel = (ctx, override) => {
  const s = [ctx && Object.keys(ctx).length ? JSON.stringify(ctx) : '', override ? `params ${JSON.stringify(override)}` : '']
    .filter(Boolean).join(' ');
  return s ? ` ${s.length > 90 ? `${s.slice(0, 87)}...` : s}` : '';
};

// ── входы (как build_golden) ─────────────────────────────────────────────────
const archRaw = G.inputs.archetypes;
const dishRaw = G.inputs.dishes;
const poolRaw = G.inputs.recommend_pool;
const cidx = E.indexClassics(G.inputs.classics);
const pool = poolRaw.map((x) => E.drinkVector(x, P));
const archProf = new Map(archRaw.map((x) => [x.id, E.drinkVector(x, P)]));
const dishProf = new Map(dishRaw.map((d) => [d.id, E.dishVector(d, P)]));

// ── помощники ────────────────────────────────────────────────────────────────
section = 'helpers';
const HELPERS = {
  r2: (x) => E.r2(x), round_half_up: (x) => E.roundHalfUp(x), fmt_num: (x) => E.fmtNum(x), fmt2: (x) => E.fmt2(x),
  burn: (x) => E.burn(x, P), cold: (x) => E.cold(x, P),
};
for (const [name, rows] of Object.entries(G.helpers)) {
  const fn = HELPERS[name];
  if (!fn) {
    leaf(`helpers.${name}`, 'помощник есть в TS-скрипте', undefined);
    continue;
  }
  rows.forEach(([x, y], i) => leaf(`helpers.${name}[${i}](${JSON.stringify(x)})`, y, fn(x)));
}

// ── профили ──────────────────────────────────────────────────────────────────
section = 'profiles';
{
  const actual = { drinks: {}, dishes: {} };
  for (const x of [...archProf.values(), ...pool.filter((p) => !archProf.has(p.id))]) {
    const dv = E.derived(x, null, P);
    actual.drinks[x.id] = { v: x.v, abv: x.abv, W_B: E.r2(dv.W_B), F_B: E.r2(dv.F_B) };
  }
  for (const [did, dp] of dishProf) {
    const dv = E.derived(null, dp, P);
    actual.dishes[did] = { W_D: E.r2(dv.W_D), F_D: E.r2(dv.F_D) };
  }
  cmp('profiles', G.profiles, actual);
}

// ── матрица архетипы × блюда: explain=false (как golden) + повтор с explain=true, где сверяется и sig ─────
const fields = G.matrix_fields;
const sigAt = fields.indexOf('sig');
const plainFields = fields.filter((f) => f !== 'sig');
const asRow = (arr) => Object.fromEntries(plainFields.map((f) => [f, arr[fields.indexOf(f)]]));
for (const explain of [false, true]) {
  section = explain ? 'matrix(explain=true)' : 'matrix';
  let i = 0;
  const expectedLen = G.matrix.length;
  for (const d of dishRaw) {
    for (const x of archRaw) {
      const r = E.scorePair(archProf.get(x.id), dishProf.get(d.id), {}, P, cidx, explain);
      const row = [x.id, d.id, r.score, r.core, r.match_type, r.secondary_type, r.vetoes, null];
      const exp = G.matrix[i];
      const label = `${section}[${i}:${x.id}×${d.id}]`;
      if (exp) {
        cmp(label, asRow(exp), Object.fromEntries(plainFields.map((f) => [f, row[KNOWN_MATRIX.indexOf(f)]])));
        if (explain && sigAt >= 0) cmpSig(`${label}.sig`, exp[sigAt], r);
      }
      i++;
    }
  }
  leaf(`${section}.length`, expectedLen, i);
}

// ── кейсы с текстами (explain=true, разные контексты, params_override) ───────
section = 'cases';
G.cases.forEach((c, i) => {
  const PP = c.params_override ? E.mergeParams(P, c.params_override) : P;
  const rawB = archRaw.find((x) => x.id === c.drink);
  const rawD = dishRaw.find((x) => x.id === c.dish);
  const label = `cases[${i}:${c.drink}×${c.dish}${ctxLabel(c.ctx, c.params_override)}]`;
  if (!rawB || !rawD) return leaf(label, 'архетип и блюдо есть в inputs', undefined);
  const r = E.scorePair(E.drinkVector(rawB, PP), E.dishVector(rawD, PP), c.ctx, PP, cidx);
  cmp(label, outputsOf(c, ['drink', 'dish', 'ctx', 'params_override']), { result: slimResult(r) });
  return undefined;
});

// ── Flavor DNA (вектор из build_golden: love czech_pale_premium, like american_ipa_45, dislike milk_stout) ─
section = 'dna';
{
  const withDna = G.cases.find((c) => c.ctx && c.ctx.dna);
  if (withDna) {
    const rated = [['czech_pale_premium', 'love'], ['american_ipa_45', 'like'], ['milk_stout', 'dislike']]
      .filter(([a]) => archProf.has(a)).map(([a, rating]) => ({ drink: archProf.get(a), rating }));
    cmp('dnaVector', withDna.ctx.dna, E.dnaVector(rated, P));
  }
}

// ── recommend ────────────────────────────────────────────────────────────────
section = 'recommend';
G.recommend.forEach((s, i) => {
  const label = `recommend[${i}:${s.dish}${ctxLabel(s.ctx)} top_n=${s.top_n}${s.categories ? ` cats=${s.categories}` : ''}`
    + `${s.venue_drink_ids ? ' venue' : ''}]`;
  const d = dishProf.get(s.dish);
  if (!d) return leaf(label, 'блюдо есть в inputs', undefined);
  const res = E.recommend(d, pool, s.ctx, s.top_n, P, cidx, s.categories, s.venue_drink_ids, false);
  const bp = res.best_partner;
  cmp(label, outputsOf(s, ['dish', 'ctx', 'top_n', 'categories', 'venue_drink_ids']), {
    items: slimList(res.items),
    best_partner: bp ? { drink_id: bp.drink_id, score: bp.score } : null,
    excluded_non_alcoholic: res.excluded_non_alcoholic,
    n_candidates: res.n_candidates,
  });
  return undefined;
});

// ── by_category ──────────────────────────────────────────────────────────────
section = 'by_category';
G.by_category.forEach((s, i) => {
  const label = `by_category[${i}:${s.dish}${ctxLabel(s.ctx)}]`;
  const d = dishProf.get(s.dish);
  if (!d) return leaf(label, 'блюдо есть в inputs', undefined);
  const res = E.byCategory(d, pool, s.ctx, P, cidx, s.per_category, null, false);
  cmp(label, outputsOf(s, ['dish', 'ctx', 'per_category']), {
    categories: res.categories.map((c) => ({ category: c.category, n: c.n, items: slimList(c.items) })),
  });
  return undefined;
});

// ── reverse ──────────────────────────────────────────────────────────────────
section = 'reverse';
G.reverse.forEach((s, i) => {
  const label = `reverse[${i}:${s.drink}${ctxLabel(s.ctx)}]`;
  const b = archProf.get(s.drink);
  if (!b) return leaf(label, 'архетип есть в inputs', undefined);
  const res = E.reverse(b, [...dishProf.values()], s.ctx, s.top_n, P, cidx, false);
  cmp(label, outputsOf(s, ['drink', 'ctx', 'top_n']), {
    excluded: res.excluded,
    items: res.items.map((r) => ({ dish_id: r.dish_id, score: r.score })),
  });
  return undefined;
});

// ── edge: синтетические записи (ветки нормализации, 2.2, неизвестные категории, DNA, partner_order) ─────────
if (G.edge) {
  section = 'edge';
  const X = G.edge;
  const KNOWN_EDGE = ['_doc', 'drinks', 'dishes', 'classics', 'ctxs', 'real_dishes', 'real_drinks', 'profiles', 'pairs',
    'recommend', 'by_category', 'reverse', 'dna', 'partner'];
  for (const k of Object.keys(X)) if (!KNOWN_EDGE.includes(k)) leaf(`edge.${k}`, 'секция проверяется engine-parity-v2.mjs', undefined);
  const edgeB = X.drinks.map((x) => E.drinkVector(x, P));
  const edgeD = X.dishes.map((x) => E.dishVector(x, P));
  const edgeClassics = [...G.inputs.classics, ...X.classics];
  const ecidx = E.indexClassics(edgeClassics);
  const prof = { drinks: {}, dishes: {} };
  for (const p of edgeB) {
    const { _v2, ...rest } = p;
    const dv = E.derived(p, null, P);
    prof.drinks[p.id] = { ...rest, W_B: E.r2(dv.W_B), F_B: E.r2(dv.F_B) };
  }
  for (const p of edgeD) {
    const { _v2, ...rest } = p;
    const dv = E.derived(null, p, P);
    prof.dishes[p.id] = { ...rest, W_D: E.r2(dv.W_D), F_D: E.r2(dv.F_D) };
  }
  cmp('edge.profiles', X.profiles, prof);
  const byIdB = new Map([...archProf.values(), ...edgeB].map((p) => [p.id, p]));
  const byIdD = new Map([...dishProf.values(), ...edgeD].map((p) => [p.id, p]));
  const EF = ['drink', 'dish', 'ctx', 'score', 'core', 'match_type', 'secondary_type', 'vetoes'];
  X.pairs.forEach((row, i) => {
    const [bid, did, ci] = row;
    const label = `edge.pairs[${i}:${bid}×${did} ctx#${ci}]`;
    const b = byIdB.get(bid);
    const d = byIdD.get(did);
    if (!b || !d) return leaf(label, 'напиток и блюдо есть в golden', undefined);
    const r = E.scorePair(b, d, X.ctxs[ci], P, ecidx, true);
    cmp(label, Object.fromEntries(EF.map((f, k) => [f, row[k]])),
      Object.fromEntries(EF.map((f, k) => [f, [bid, did, ci, r.score, r.core, r.match_type, r.secondary_type, r.vetoes][k]])));
    cmpSig(`${label}.sig`, row[EF.length], r);
    return undefined;
  });
  const epool = [...pool, ...edgeB];
  const edgeDish = new Map(edgeD.map((p) => [p.id, p]));
  X.recommend.forEach((s, i) => {
    const res = E.recommend(edgeDish.get(s.dish), epool, s.ctx, s.top_n, P, edgeClassics, null, null, false);
    const bp = res.best_partner;
    cmp(`edge.recommend[${i}:${s.dish}${ctxLabel(s.ctx)} top_n=${s.top_n}]`, outputsOf(s, ['dish', 'ctx', 'top_n']), {
      items: slimList(res.items), best_partner: bp ? { drink_id: bp.drink_id, score: bp.score } : null,
      excluded_non_alcoholic: res.excluded_non_alcoholic, n_candidates: res.n_candidates, policy: res.policy,
    });
  });
  X.by_category.forEach((s, i) => {
    const res = E.byCategory(edgeDish.get(s.dish), epool, s.ctx, P, ecidx, s.per_category, null, false);
    cmp(`edge.by_category[${i}:${s.dish}${ctxLabel(s.ctx)}]`, outputsOf(s, ['dish', 'ctx', 'per_category']), {
      categories: res.categories.map((c) => ({ category: c.category, label: c.label, n: c.n, items: slimList(c.items) })),
    });
  });
  const realD = X.real_dishes.map((id) => dishProf.get(id));
  X.reverse.forEach((s, i) => {
    const res = E.reverse(edgeB.find((p) => p.id === s.drink), [...edgeD, ...realD], s.ctx, s.top_n, P, edgeClassics, false);
    cmp(`edge.reverse[${i}:${s.drink}${ctxLabel(s.ctx)}]`, outputsOf(s, ['drink', 'ctx', 'top_n']), {
      excluded: res.excluded, items: res.items.map((r) => ({ dish_id: r.dish_id, score: r.score })),
    });
  });
  const edgeRaw = new Map(X.drinks.map((x) => [x.id, x]));
  X.dna.forEach((s, i) => cmp(`edge.dna[${i}]`, s.result,
    E.dnaVector(s.rated.map((x) => ('drink' in x ? { ...x, drink: edgeRaw.get(x.drink) } : x)), P)));
  const bp = E.bestPartner(X.partner.results);
  cmp('edge.partner.best_partner', X.partner.best_partner, bp ? bp.drink_id : null);
  X.partner.orders.forEach((o, i) => cmp(`edge.partner.orders[${i}](window=${o.window})`, o.order,
    E.partnerOrder(X.partner.results, P, o.window).map((r) => r.drink_id)));
}

// ── mergeParams / getPath / setPath (семантика engine_v2.merge_params, данные-независимо) ─
section = 'mergeParams';
{
  const base = { a: { b: 1, c: [1, 2], d: { e: 'x' } }, f: 5, arr: [{ k: 1 }] };
  const snapshot = JSON.stringify(base);
  const m = E.mergeParams(base, { a: { b: 2, c: [9], d: { g: 7 } }, 'f': 6, 'arr': [{ z: 0 }], 'n.m.o': 3 });
  cmp('mergeParams.nested', { a: { b: 2, c: [9], d: { e: 'x', g: 7 } }, f: 6, arr: [{ z: 0 }], n: { m: { o: 3 } } }, m);
  expect('mergeParams.base_unchanged', JSON.stringify(base) === snapshot);
  m.a.d.e = 'mutated';
  expect('mergeParams.deep_copy', base.a.d.e === 'x');
  const ov = { a: { d: { e: 'y' } } };
  const m2 = E.mergeParams(base, ov);
  ov.a.d.e = 'changed-after-merge';
  expect('mergeParams.override_copied', m2.a.d.e === 'y');
  // путь с точкой заменяет значение целиком (без слияния); не-словарь на пути заменяется новым {}
  cmp('mergeParams.dotted_replaces_dict', { a: { b: 1, c: [1, 2], d: { g: 1 } }, f: 5, arr: [{ k: 1 }] },
    E.mergeParams(base, { 'a.d': { g: 1 } }));
  cmp('mergeParams.dotted_through_scalar', { a: { b: 1, c: [1, 2], d: { e: 'x' } }, f: { q: 1 }, arr: [{ k: 1 }] },
    E.mergeParams(base, { 'f.q': 1 }));
  cmp('mergeParams.dict_over_scalar', { a: { b: 1, c: [1, 2], d: { e: 'x' } }, f: { q: 1 }, arr: [{ k: 1 }] },
    E.mergeParams(base, { f: { q: 1 } }));
  // в _deep_merge ключи с точкой — обычные ключи (пути только на верхнем уровне override)
  cmp('mergeParams.nested_dot_key_literal', { a: { b: 1, c: [1, 2], d: { e: 'x' }, 'x.y': 1 }, f: 5, arr: [{ k: 1 }] },
    E.mergeParams(base, { a: { 'x.y': 1 } }));
  for (const empty of [null, undefined, {}]) {
    const c = E.mergeParams(base, empty);
    expect(`mergeParams.empty_override(${JSON.stringify(empty)})`, c !== base && JSON.stringify(c) === snapshot);
  }
  // на реальных параметрах golden: путь и вложенный объект дают одно и то же; тождественный override не меняет баллы
  const scale = E.getPath(P, 'R2.scale');
  const viaPath = E.mergeParams(P, { 'R2.scale': scale + 5, 'labels.tags.bread': 'хлебушек' });
  const viaNested = E.mergeParams(P, { R2: { scale: scale + 5 }, labels: { tags: { bread: 'хлебушек' } } });
  expect('mergeParams.path_equals_nested', JSON.stringify(viaPath) === JSON.stringify(viaNested));
  expect('mergeParams.getPath', E.getPath(viaPath, 'R2.scale') === scale + 5 && E.getPath(P, 'R2.scale') === scale);
  expect('mergeParams.siblings_kept', E.getPath(viaPath, 'R2.tannin') === E.getPath(P, 'R2.tannin')
    && E.getPath(viaPath, 'labels.tags.citrus') === E.getPath(P, 'labels.tags.citrus'));
  let threw = false;
  try { E.getPath(P, 'R2.no_such_key'); } catch { threw = true; }
  expect('getPath.missing_throws', threw);
  const tgt = { a: 1 };
  E.setPath(tgt, 'a.b.c', 2);
  cmp('setPath.creates', { a: { b: { c: 2 } } }, tgt);
  const same = E.mergeParams(P, { R2: { scale } });
  const d0 = dishRaw[0], b0 = archRaw[0];
  if (d0 && b0) {
    const r0 = E.scorePair(E.drinkVector(b0, P), E.dishVector(d0, P), {}, P, cidx);
    const r1 = E.scorePair(E.drinkVector(b0, same), E.dishVector(d0, same), {}, same, cidx);
    cmp('mergeParams.identity_override_score', slimResult(r0), slimResult(r1));
  }
}

// ── asRecords (семантика dataset_v2._as_records: style_priors_v2.json — словарь {archetype_id: запись} без id) ─
section = 'asRecords';
{
  cmp('asRecords.map', [{ x: 1, id: 'a' }, { id: 'keep', y: 2 }, { id: null }],
    E.asRecords({ _doc: 'x', a: { x: 1 }, b: { id: 'keep', y: 2 }, c: 5, d: [1], e: { id: null } }));
  cmp('asRecords.list', [{ id: 1 }, { z: 3 }], E.asRecords([{ id: 1 }, 2, null, [1], { z: 3 }]));
  cmp('asRecords.wrapper', [{ k: 1, id: 's1' }], E.asRecords({ styles: { s1: { k: 1 }, _skip: { k: 2 } } }));
  cmp('asRecords.wrapper_order', [{ v: 1, id: 'i' }], E.asRecords({ archetypes: [], items: { i: { v: 1 } } }));
  cmp('asRecords.not_container', [], E.asRecords('str'));
  const recs = E.asRecords(Object.fromEntries(archRaw.map(({ id, ...rest }) => [id, rest])));
  cmp('asRecords.archetype_ids', archRaw.map((x) => x.id), recs.map((r) => E.drinkVector(r, P).id));
}

// ── итог ─────────────────────────────────────────────────────────────────────
const rel = path.relative(process.cwd(), goldenPath) || goldenPath;
console.log(`golden: ${rel} (v${G.version}; ${Object.entries(G.sources || {}).map(([k, v]) => `${k}=${v}`).join(', ')}; `
  + `recommend pool: ${G.recommend_pool})`);
console.log(`  ${[...perSection].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
if (nDiff) {
  console.log(`первые ${shown.length} расхождений (путь, ожидалось из Python, получено из TS):`);
  console.log(shown.join('\n'));
  if (sigDebug) console.log(`TS-строка сигнатуры первого расхождения sig (сравните с engine_eval_v2._sig):\n${sigDebug}`);
}
console.log(`engine v2 parity: ${checks} проверок, расхождений: ${nDiff}`);
process.exit(nDiff ? 1 : 0);
