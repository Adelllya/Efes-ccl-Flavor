// Проверки «Дастархана» — подбора на весь стол (src/app/core/table-planner.ts): npm run test:table
//
// Модуль компилируется во временную папку вместе с движком v2 (как в engine-parity-v2.mjs) и гоняется на реальных
// данных SPA: data/dishes_v2.json, data/drinks_v2_spa.json (гостевой пул), data/engine_v2_spa.json (параметры +
// классика), data/venues.json (карты демо-заведений). Всё сверяется с прямыми вызовами scorePair (перебором), без
// повторения логики планировщика: maximin по ВСЕМ кандидатам, сумма сета, сет не хуже single ни по одному блюду,
// сет из одного бокала = single, монотонность по размеру сета (фиксированные и случайные столы), порядок подачи
// (включая «от сухого к сладкому» при равных F_B и W_B), назначение блюд, предупреждения (три вида), пул заведения,
// «без алкоголя», политика Efes (только порядок, честное место), пресеты, детерминизм, кеш (LRU по контекстам), async.
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const root = path.resolve(frontend, '..');
const out = path.join(here, '.table-planner-build');
const src = path.join(frontend, 'src/app/core/table-planner.ts');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let T, E;
try {
  // те же строгие флаги, что в tsconfig.json приложения
  execSync(`npx tsc "${src}" --outDir "${out}" --module commonjs --target es2022 --strict --skipLibCheck `
    + '--noImplicitReturns --noFallthroughCasesInSwitch --noPropertyAccessFromIndexSignature --noImplicitOverride',
  { stdio: 'inherit', cwd: frontend });
  const require = createRequire(import.meta.url);
  T = require(path.join(out, 'core', 'table-planner.js'));
  E = require(path.join(out, 'engine', 'pairing-engine-v2.js'));
} finally {
  rmSync(out, { recursive: true, force: true });
}

const J = (f) => JSON.parse(readFileSync(path.join(root, 'data', f), 'utf8'));
const bundle = J('engine_v2_spa.json');
const P = bundle.params;
const C = E.indexClassics(bundle.classics);
E.setDefaultParams(P);
const allDishes = J('dishes_v2.json');
const dishById = new Map(allDishes.map((d) => [d.id, d]));
const drinks = J('drinks_v2_spa.json').drinks;
// гостевой пул — как DataV2Service.guestPool(): без черновиков и неподтверждённого наличия, профили движка
const pool = drinks.filter((d) => d.status !== 'draft' && d.availability_kz?.level !== 'not_confirmed').map((d) => E.drinkVector(d, P));
const venues = J('venues.json');
const WINDOW = P.recommend.partner_tie_window;

// ── учёт ─────────────────────────────────────────────────────────────────────
let checks = 0;
const fails = [];
let section = '';
function expect(name, ok, detail = '') {
  checks++;
  if (!ok) fails.push(`  [${section}] ${name}${detail ? `\n      ${detail}` : ''}`);
}
const dishes = (ids) => ids.map((id) => {
  const d = dishById.get(id);
  if (!d) throw new Error(`нет блюда ${id}`);
  return d;
});
const planOf = (ds, pl = pool, ctx = {}, opts = {}) => T.planTable(ds, pl, ctx, P, C, opts);
const noMatrix = (plan) => JSON.stringify({ ...plan, matrix: null });

/** Перебор прямыми вызовами scorePair: баллы каждого не исключённого напитка пула ко всем блюдам. */
function brute(ds, pl, ctx = {}) {
  const rows = [];
  const excluded = [];
  for (const b of pl) {
    const scores = ds.map((d) => E.scorePair(b, d, ctx, P, C, false));
    if (scores.some((r) => r.excluded)) { excluded.push(b.id); continue; }
    const s = scores.map((r) => r.score);
    rows.push({ b, s, min: Math.min(...s), sum: s.reduce((a, x) => a + x, 0) });
  }
  return { rows, excluded, byId: new Map(rows.map((r) => [r.b.id, r])) };
}

/** Общие инварианты плана для стола ds, пула pl и контекста ctx. */
function invariants(name, ds, pl = pool, ctx = {}, opts = {}) {
  section = name;
  const plan = planOf(ds, pl, ctx, opts);
  const bf = brute(ds, pl, ctx);
  const n = ds.length;
  const maxFlight = Math.min(4, Math.max(1, opts.maxFlight ?? 3));
  const minScore = opts.minScore ?? 60;
  const minGain = opts.minGainPerDish ?? 3;

  expect('статус ok', plan.status === 'ok', plan.status);
  expect('кандидаты = не исключённые напитки пула', plan.n_candidates === bf.rows.length && plan.matrix.drink_ids.length === bf.rows.length);
  expect('исключённые = перебор', JSON.stringify(plan.excluded_non_alcoholic) === JSON.stringify(bf.excluded));
  // матрица = прямые баллы
  let matrixOk = true;
  for (const [i, id] of plan.matrix.drink_ids.entries()) {
    const row = bf.byId.get(id);
    if (!row || row.s.some((s, j) => plan.matrix.scores[i][j] !== s)) { matrixOk = false; break; }
  }
  expect('матрица = scorePair(explain=false)', matrixOk);

  // single: maximin по ВСЕМ кандидатам
  const s = plan.single;
  const bestMin = Math.max(...bf.rows.map((r) => r.min));
  const tieMin = bf.rows.filter((r) => r.min === bestMin);
  const bestSum = Math.max(...tieMin.map((r) => r.sum));
  const winners = tieMin.filter((r) => r.sum === bestSum).map((r) => r.b.id).sort(E.pyStrCmp);
  expect('single максимизирует худший балл по всем кандидатам', s && s.min === bestMin, `single ${s?.drink_id} min ${s?.min}, максимум ${bestMin}`);
  expect('single: при равном min — больший средний, затем id', s && s.sum === bestSum && s.drink_id === winners[0], `${s?.drink_id} vs ${winners[0]}`);
  const sr = bf.byId.get(s.drink_id);
  expect('single: баллы по блюдам = scorePair', s.per_dish.length === n && s.per_dish.every((c, j) => c.dish_id === ds[j].id && c.score === sr.s[j]));
  expect('single: mean = r1(sum/n)', s.mean === E.r1(s.sum / n));
  expect('single: худшее блюдо — с минимальным баллом', s.weakest_dish.score === s.min && sr.s[ds.findIndex((d) => d.id === s.weakest_dish.dish_id)] === s.min);
  expect('single: лучшее блюдо — с максимальным баллом', s.strongest_dish.score === Math.max(...sr.s));
  expect('single: below_min', s.below_min === sr.s.filter((x) => x < minScore).length);
  expect('single: бэнды = движок', s.per_dish.every((c, j) => c.band === E.scorePair(sr.b, ds[j], ctx, P, C, true).band));
  expect('single: полная карточка', s.detail === true && s.per_dish.length === n);
  expect('single: причины — тексты движка', s.reasons.length >= 0 && s.reasons.length <= 2
    && s.reasons.every((t) => E.scorePair(sr.b, dishById.get(s.strongest_dish.dish_id), ctx, P, C, true).reasons.some((m) => m.text === t)));
  // запасные: после single по ключу, без повторов
  const key = (x) => [-x.min, -x.sum, x.drink_id];
  const lt = (a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] || E.pyStrCmp(ka[2], kb[2]); };
  expect('запасные не лучше single и отсортированы', plan.runner_ups.every((r, i) => lt(s, r) < 0 && (i === 0 || lt(plan.runner_ups[i - 1], r) < 0)));
  expect('запасные: без повторов и не single', new Set([s.drink_id, ...plan.runner_ups.map((r) => r.drink_id)]).size === plan.runner_ups.length + 1);
  expect('запасных не больше 2', plan.runner_ups.length === Math.min(2, bf.rows.length - 1));
  expect('запасные: баллы = scorePair', plan.runner_ups.every((r) => bf.byId.get(r.drink_id).min === r.min && bf.byId.get(r.drink_id).sum === r.sum));
  // лёгкие карточки (из строки матрицы) — честные числа, без per_dish и текстов; полные — только там, где их показывают крупно
  const cardOk = (r) => {
    const row = bf.byId.get(r.drink_id);
    const numsOk = r.mean === E.r1(r.sum / n) && r.below_min === row.s.filter((x) => x < minScore).length
      && r.weakest_dish.score === row.min && r.weakest_dish.dish_id === ds[row.s.indexOf(row.min)].id
      && r.strongest_dish.score === Math.max(...row.s);
    const wr = E.scorePair(row.b, dishById.get(r.weakest_dish.dish_id), ctx, P, C, false);
    const bandOk = r.weakest_dish.band === wr.band && r.weakest_dish.classic === wr.classic;
    const shapeOk = r.detail ? r.per_dish.length === n && r.per_dish.every((c, j) => c.score === row.s[j])
      : r.per_dish.length === 0 && r.why === null && r.reasons.length === 0 && r.weakest_dish.warning === null && r.strongest_dish.reason === null;
    return numsOk && bandOk && shapeOk;
  };
  expect('запасные и best_partner: числа, худшее/лучшее блюдо и бэнд = scorePair', [...plan.runner_ups, plan.best_partner].filter(Boolean).every(cardOk),
    [...plan.runner_ups, plan.best_partner].filter((r) => r && !cardOk(r)).map((r) => r.drink_id).join(', '));
  const ea = plan.efes_alternative;
  const outranks = (r) => ea && lt(r, ea) < 0;
  expect('полные карточки запасных — только выше поднятого Efes', plan.runner_ups.every((r) => r.detail === (plan.policy.promoted && !!outranks(r))),
    plan.runner_ups.map((r) => `${r.drink_id}:${r.detail}`).join(', '));
  expect('best_partner полный, только если это single или показанный Efes', !plan.best_partner
    || plan.best_partner.detail === (plan.best_partner.drink_id === s.drink_id || plan.best_partner.drink_id === ea?.drink_id));

  // сет
  const fl = plan.flight;
  expect(`сет: 1..${maxFlight} бокалов`, fl.length >= 1 && fl.length <= maxFlight, `${fl.length}`);
  expect('сет: без повторов', new Set(fl.map((f) => f.drink_id)).size === fl.length);
  const flRows = fl.map((f) => bf.byId.get(f.drink_id));
  expect('сет: только кандидаты пула', flRows.every(Boolean));
  const flBest = ds.map((_, j) => Math.max(...flRows.map((r) => r.s[j])));
  const flSum = flBest.reduce((a, x) => a + x, 0);
  expect('Σ сета ≥ Σ single', flSum >= s.sum, `${flSum} < ${s.sum}`);
  // сет начинается с single и не опускает ни одно блюдо ниже его балла с single
  const badDish = ds.findIndex((_, j) => flBest[j] < sr.s[j]);
  expect('каждое блюдо в сете не хуже, чем с single', badDish < 0, badDish < 0 ? '' : `${ds[badDish].id}: сет ${flBest[badDish]} < single ${sr.s[badDish]}`);
  expect('слабейшая пара сета ≥ слабейшей пары single', plan.flight_summary.min >= s.min && plan.flight_summary.single_min === s.min,
    `${plan.flight_summary.min} < ${s.min}`);
  expect('сет из одного бокала — это single', fl.length !== 1 || fl[0].drink_id === s.drink_id, `${fl[0]?.drink_id} ≠ ${s.drink_id}`);
  expect('в сете из одного бокала назначение — single', fl.length !== 1 || ds.every((d) => plan.assignment[d.id] === s.drink_id));
  expect('сводка сета = перебор', plan.flight_summary.sum === flSum && plan.flight_summary.min === Math.min(...flBest)
    && plan.flight_summary.mean === E.r1(flSum / n) && plan.flight_summary.size === fl.length && plan.flight_summary.single_sum === s.sum);
  // порядок подачи
  expect('порядок подачи: F_B не убывает', fl.every((f, i) => i === 0 || fl[i - 1].F_B <= f.F_B), fl.map((f) => f.F_B).join(' → '));
  expect('порядок подачи: при равном F_B — W_B не убывает', fl.every((f, i) => i === 0 || fl[i - 1].F_B < f.F_B || fl[i - 1].W_B <= f.W_B));
  expect('порядок подачи: при равных F_B и W_B — от сухого к сладкому', fl.every((f, i) => i === 0 || fl[i - 1].F_B < f.F_B
    || fl[i - 1].W_B < f.W_B || fl[i - 1].sweet <= f.sweet), fl.map((f) => `${f.drink_id} ${f.F_B}/${f.W_B}/${f.sweet}`).join(' → '));
  expect('сладость бокала = профиль напитка', fl.every((f) => f.sweet === bf.byId.get(f.drink_id).b.v.sweet));
  expect('order = 1..N', fl.every((f, i) => f.order === i + 1));
  expect('F_B/W_B = scorePair', fl.every((f) => {
    const r = E.scorePair(bf.byId.get(f.drink_id).b, dishById.get(f.best_dish_id), ctx, P, C, true);
    return r.F_B === f.F_B && r.W_B === f.W_B;
  }));
  // назначение
  const assigned = Object.keys(plan.assignment);
  expect('каждое блюдо назначено', assigned.length === n && ds.every((d) => plan.assignment[d.id]));
  expect('блюдо — к лучшему бокалу сета', ds.every((d, j) => bf.byId.get(plan.assignment[d.id]).s[j] === flBest[j]));
  expect('списки блюд бокалов = назначение', fl.reduce((a, f) => a + f.dishes.length, 0) === n
    && fl.every((f) => f.dishes.length >= 1 && f.dishes.every((c) => plan.assignment[c.dish_id] === f.drink_id)));
  expect('баллы блюд бокалов = scorePair', fl.every((f) => f.dishes.every((c) => c.score === bf.byId.get(f.drink_id).s[ds.findIndex((d) => d.id === c.dish_id)])));
  // нет лишних бокалов: вклад каждого (кроме single) ≥ порога на строго улучшенное им блюдо — или без него какое-то
  // блюдо опустилось бы ниже своего балла с single
  for (const f of fl) {
    const others = flRows.filter((r) => r.b.id !== f.drink_id);
    if (!others.length) { expect('один бокал — gain null', f.gain === null && f.gain_dishes === 0); continue; }
    const mine = ds.map((d, j) => j).filter((j) => plan.assignment[ds[j].id] === f.drink_id);
    const without = ds.map((_, j) => Math.max(...others.map((r) => r.s[j])));
    const gain = mine.reduce((a, j) => a + flBest[j] - without[j], 0);
    const improved = mine.filter((j) => flBest[j] > without[j]).length;
    expect(`вклад бокала ${f.drink_id} = перебор`, f.gain === gain && f.gain_dishes === improved, `${f.gain}/${f.gain_dishes} vs ${gain}/${improved}`);
    const breaksFloor = ds.some((_, j) => without[j] < sr.s[j]);
    expect(`бокал ${f.drink_id} не лишний`, f.drink_id === s.drink_id || (improved > 0 && gain >= minGain * improved) || breaksFloor,
      `вклад ${gain} на ${improved} улучшенных блюд`);
  }
  // предупреждения
  const weakIdx = ds.map((_, j) => j).filter((j) => flBest[j] < minScore);
  expect('предупреждения — ровно блюда ниже minScore', plan.warnings.length === weakIdx.length
    && weakIdx.every((j) => plan.warnings.some((w) => w.dish_id === ds[j].id && w.score === flBest[j])));
  for (const w of plan.warnings) {
    const j = ds.findIndex((d) => d.id === w.dish_id);
    const top = Math.max(...bf.rows.map((r) => r.s[j]));
    expect(`потолок пула для ${w.dish_id}`, w.pool_best.score === top && bf.byId.get(w.pool_best.drink_id).s[j] === top);
    const kind = top < minScore ? 'no_good_pair' : fl.length >= maxFlight ? 'flight_limit' : 'small_gain';
    expect(`вид предупреждения ${w.dish_id}`, w.kind === kind, `${w.kind} vs ${kind} (сет ${fl.length}/${maxFlight})`);
  }
  // Efes: лучший партнёр честно, окно — только порядок
  const efesRows = bf.rows.filter((r) => E.isEfesRelation(r.b.efes_relation, P)).sort((a, b) => lt(
    { min: a.min, sum: a.sum, drink_id: a.b.id }, { min: b.min, sum: b.sum, drink_id: b.b.id }));
  expect('best_partner = лучший Efes по тому же ключу', efesRows.length ? plan.best_partner?.drink_id === efesRows[0].b.id : plan.best_partner === null);
  if (plan.efes_alternative) {
    const a = plan.efes_alternative;
    expect('альтернатива Efes — в окне', a.efes && a.gap === s.min - a.min && a.gap >= 0 && a.gap <= WINDOW && a.mean_gap <= WINDOW);
    const above = bf.rows.filter((r) => lt({ min: r.min, sum: r.sum, drink_id: r.b.id }, a) < 0).length;
    expect('альтернатива Efes — честное место', a.rank === above + 1 && a.rank >= 2, `${a.rank} vs ${above + 1}`);
    expect('альтернатива Efes — полная карточка', a.detail === true && a.per_dish.length === n);
    expect('альтернатива Efes — первой в порядке показа', plan.policy.promoted && plan.policy.display_order[0] === a.drink_id
      && plan.policy.display_order[1] === s.drink_id);
    expect('single не Efes-альтернатива', !s.efes && a.drink_id !== s.drink_id);
  } else {
    expect('без альтернативы — single первым', !plan.policy.promoted && plan.policy.display_order[0] === s.drink_id);
  }
  return { plan, bf };
}

// ── 1. пресеты ───────────────────────────────────────────────────────────────
section = 'пресеты';
expect('пять пресетов', T.TABLE_PRESETS.length === 5);
const presetPlans = [];
for (const p of T.TABLE_PRESETS) {
  const missing = p.dishes.filter((id) => !dishById.has(id));
  section = 'пресеты';
  expect(`пресет ${p.id}: все блюда есть в dishes_v2.json`, !missing.length, missing.join(', '));
  expect(`пресет ${p.id}: 2..${T.MAX_TABLE_DISHES} блюд без повторов`, p.dishes.length >= 2 && p.dishes.length <= T.MAX_TABLE_DISHES
    && new Set(p.dishes).size === p.dishes.length);
  expect(`presetDishes(${p.id})`, T.presetDishes(p.id, allDishes).map((d) => d.id).join() === p.dishes.join());
  const t0 = Date.now();
  const r = invariants(`пресет ${p.id}`, dishes(p.dishes));
  const ms = Date.now() - t0;
  section = `пресет ${p.id}`;
  expect('есть напиток на стол и сет', r.plan.single !== null && r.plan.flight.length >= 1);
  presetPlans.push({ p, plan: r.plan, ms });
}
expect('неизвестный пресет — пусто', T.presetDishes('nope', allDishes).length === 0);

// ── 2. детерминизм ───────────────────────────────────────────────────────────
section = 'детерминизм';
{
  const ds = dishes(T.TABLE_PRESETS[0].dishes);
  const a = planOf(ds);
  const b = planOf(ds);
  expect('два вызова — один результат', JSON.stringify(a) === JSON.stringify(b));
  const rev = planOf(ds, pool.slice().reverse());
  expect('порядок пула не влияет на план (кроме порядка строк матрицы)', noMatrix(a) === noMatrix(rev));
  const shuffled = pool.slice().sort((x, y) => (x.id.length * 7 + x.id.charCodeAt(0)) % 11 - (y.id.length * 7 + y.id.charCodeAt(0)) % 11);
  expect('перемешанный пул — тот же план', noMatrix(a) === noMatrix(planOf(ds, shuffled)));
  const dup = planOf([...ds, ds[0], ds[2]]);
  expect('повторы блюд отбрасываются', noMatrix(dup) === noMatrix(a));
  const reuse = planOf(ds, pool, {}, { matrix: a.matrix });
  expect('готовая матрица переиспользуется', reuse.matrix === a.matrix && noMatrix(reuse) === noMatrix(a));
  const other = planOf(ds, pool, { occasion: 'party' }, { matrix: a.matrix });
  expect('матрица другого контекста не переиспользуется', other.matrix !== a.matrix && other.matrix.key !== a.matrix.key);
  expect('matrixScore', T.matrixScore(a.matrix, ds[1].id, a.single.drink_id) === a.single.per_dish[1].score
    && T.matrixScore(a.matrix, 'nope', a.single.drink_id) === null);
  const m = T.buildTableMatrix(ds, pool, {}, P, C);
  expect('buildTableMatrix = матрица плана', JSON.stringify(m) === JSON.stringify(a.matrix));
}

// ── 2б. кеш баллов и асинхронный счёт ────────────────────────────────────────
section = 'кеш и async';
{
  const ids = T.TABLE_PRESETS[0].dishes;
  const cache = T.newTableScoreCache();
  const plain = planOf(dishes(ids));
  const cached = planOf(dishes(ids), pool, {}, { cache });
  expect('план с кешем = без кеша', JSON.stringify(cached) === JSON.stringify(plain));
  const size1 = cache.size;
  expect('кеш заполнен: пул × блюда', size1 === pool.length * ids.length, `${size1}`);
  const more = [...ids, 'sushi'];
  const grown = planOf(dishes(more), pool, {}, { cache });
  expect('добавили блюдо — досчитан только его столбец', cache.size === size1 + pool.length, `${cache.size - size1}`);
  expect('план с кешем после роста = без кеша', JSON.stringify(grown) === JSON.stringify(planOf(dishes(more))));
  for (const ctx of [{ occasion: 'party' }, { non_alcoholic: true }, { harsh_tol: 'sensitive', bitter_pref: -0.5 }]) {
    expect(`контексты не смешиваются в кеше: ${JSON.stringify(ctx)}`,
      JSON.stringify(planOf(dishes(ids), pool, ctx, { cache })) === JSON.stringify(planOf(dishes(ids), pool, ctx)));
  }
  const venueIds = pool.filter((b) => b.category === 'beer').slice(0, 20).map((b) => b.id);
  expect('кеш и пул заведения', JSON.stringify(planOf(dishes(ids), pool, {}, { cache, venueDrinkIds: venueIds }))
    === JSON.stringify(planOf(dishes(ids), pool, {}, { venueDrinkIds: venueIds })));
  // LRU по контекстам: память ограничена, {occasion: null} и {} — один контекст
  const lru = T.newTableScoreCache(4);
  const two = dishes(ids.slice(0, 2));
  planOf(two, pool, {}, { cache: lru });
  const oneCtx = lru.size;
  planOf(two, pool, { occasion: null, heat_lover: undefined }, { cache: lru });
  expect('null/undefined в контексте — тот же блок кеша', lru.size === oneCtx && lru.contexts === 1, `${lru.size} vs ${oneCtx}, контекстов ${lru.contexts}`);
  expect('план с {occasion: null} = план с {}', noMatrix(planOf(two, pool, { occasion: null })) === noMatrix(planOf(two, pool, {})));
  for (const occasion of ['meal', 'evening', 'party', 'hot', 'gourmet', 'dessert']) planOf(two, pool, { occasion }, { cache: lru });
  expect('кеш держит не больше 4 контекстов', lru.contexts === 4 && lru.size <= 4 * oneCtx, `${lru.contexts} контекстов, ${lru.size} баллов`);
  expect('после вытеснения план тот же', JSON.stringify(planOf(two, pool, {}, { cache: lru })) === JSON.stringify(planOf(two, pool, {})));
  const asyncPlan = await T.planTableAsync(dishes(ids), pool, {}, P, C, { chunk: 17 });
  expect('planTableAsync = planTable', JSON.stringify(asyncPlan) === JSON.stringify(plain));
  const asyncTimed = await T.planTableAsync(dishes(ids), pool, {}, P, C, { sliceMs: 2 });
  expect('planTableAsync по времени (без chunk) = planTable', JSON.stringify(asyncTimed) === JSON.stringify(plain));
  const asyncCached = await T.planTableAsync(dishes(more), pool, {}, P, C, { cache: T.newTableScoreCache(), chunk: 50 });
  expect('planTableAsync с кешем = planTable', JSON.stringify(asyncCached) === JSON.stringify(grown));
  const ctl = { aborted: false };
  const pending = T.planTableAsync(dishes(ids), pool, { occasion: 'gourmet' }, P, C, { chunk: 10, signal: ctl });
  ctl.aborted = true;
  expect('отмена — null', (await pending) === null);
  const reused = await T.planTableAsync(dishes(ids), pool, {}, P, C, { matrix: plain.matrix });
  expect('planTableAsync переиспользует матрицу', reused.matrix === plain.matrix && noMatrix(reused) === noMatrix(plain));
}

// ── 3. добавление блюд по одному (до всего каталога блюд) ─────────────────────
section = 'рост стола';
{
  const order = allDishes.map((d) => d.id);
  let crashed = null;
  let last = null;
  for (let k = 1; k <= 12; k++) {
    try {
      const ids = order.filter((_, i) => i % 9 === k % 9).slice(0, k);
      last = invariants(`рост стола: ${k} блюд`, dishes(ids.length === k ? ids : order.slice(0, k)));
    } catch (e) { crashed = `${k}: ${e.stack}`; break; }
  }
  section = 'рост стола';
  expect('1..12 блюд без падений', crashed === null, crashed ?? '');
  expect('последний план ок', last && last.plan.status === 'ok');
  let bigErr = null;
  const t0 = Date.now();
  let big = null;
  try { big = planOf(allDishes); } catch (e) { bigErr = e.stack; }
  const bigMs = Date.now() - t0;
  expect(`все ${allDishes.length} блюд без падения`, bigErr === null && big.status === 'ok'
    && Object.keys(big.assignment).length === allDishes.length, bigErr ?? '');
  console.log(`Весь каталог блюд (${allDishes.length}) × ${pool.length} напитков: ${bigMs} мс; сет ${big?.flight.length}, предупреждений ${big?.warnings.length}`);
  section = 'одно блюдо';
  const one = invariants('одно блюдо', dishes(['beshbarmak']));
  expect('одно блюдо — один бокал', one.plan.flight.length === 1 && one.plan.flight[0].gain === null);
  expect('одно блюдо — single = лучший балл пула', one.plan.single.min === Math.max(...one.bf.rows.map((r) => r.s[0])));
}

// ── 4. пустые входы ──────────────────────────────────────────────────────────
section = 'пустые входы';
{
  const e1 = planOf([]);
  expect('без блюд — no_dishes', e1.status === 'no_dishes' && e1.single === null && e1.flight.length === 0 && e1.warnings.length === 0);
  const e2 = planOf(dishes(['kazy']), []);
  expect('пустой пул — no_drinks', e2.status === 'no_drinks' && e2.single === null && e2.flight.length === 0);
  const e3 = planOf(dishes(['kazy']), pool, {}, { venueDrinkIds: [] });
  expect('пустая карта заведения — no_drinks', e3.status === 'no_drinks');
}

// ── 5. карта заведения ───────────────────────────────────────────────────────
for (const v of venues) {
  // = PairingV2Service.venueDrinkIds(venue.brands): id напитка или legacy_brand_id
  const set = new Set(v.brands);
  const venueIds = drinks.filter((d) => set.has(d.id) || (d.legacy_brand_id && set.has(d.legacy_brand_id))).map((d) => d.id);
  const vset = new Set(venueIds);
  const ds = dishes(v.menu.filter((id) => dishById.has(id)).slice(0, 8));
  const venuePool = pool.filter((b) => vset.has(b.id));
  const { plan } = invariants(`заведение ${v.id}`, ds, venuePool);
  section = `заведение ${v.id}`;
  const viaOpt = planOf(ds, pool, {}, { venueDrinkIds: venueIds });
  expect('venueDrinkIds = пул только из карты', noMatrix({ ...viaOpt, matrix: null }) === noMatrix({ ...plan, matrix: null }));
  const viaCtx = planOf(ds, pool, { venue_drink_ids: venueIds });
  expect('ctx.venue_drink_ids тоже сужает пул', viaCtx.matrix.drink_ids.every((id) => vset.has(id)));
  const shown = [viaOpt.single, ...viaOpt.runner_ups, viaOpt.best_partner, viaOpt.efes_alternative, ...viaOpt.flight,
    ...viaOpt.warnings.map((w) => w.pool_best)].filter(Boolean).map((x) => x.drink_id);
  expect('все показанные напитки — из карты заведения', shown.every((id) => vset.has(id)) && viaOpt.matrix.drink_ids.every((id) => vset.has(id)),
    shown.filter((id) => !vset.has(id)).join(', '));
}

// ── 6. без алкоголя ──────────────────────────────────────────────────────────
for (const ctx of [{ non_alcoholic: true }, { occasion: 'non_alcoholic' }]) {
  const name = `без алкоголя ${JSON.stringify(ctx)}`;
  const ds = dishes(T.TABLE_PRESETS[1].dishes);
  const { plan } = invariants(name, ds, pool, ctx);
  section = name;
  const abv = new Map(pool.map((b) => [b.id, b.abv]));
  const shown = [plan.single, ...plan.runner_ups, plan.best_partner, plan.efes_alternative, ...plan.flight,
    ...plan.warnings.map((w) => w.pool_best)].filter(Boolean).map((x) => x.drink_id);
  expect('в плане только напитки ≤ 0.5 % ABV', shown.every((id) => abv.get(id) <= 0.5), shown.filter((id) => abv.get(id) > 0.5).join(', '));
  expect('в матрице только ≤ 0.5 %', plan.matrix.drink_ids.every((id) => abv.get(id) <= 0.5));
  expect('все крепче 0.5 % — в исключённых', pool.filter((b) => b.abv > 0.5).every((b) => plan.excluded_non_alcoholic.includes(b.id)));
}

// ── 7. профиль гостя и повод ─────────────────────────────────────────────────
invariants('профиль гостя', dishes(T.TABLE_PRESETS[3].dishes), pool, { harsh_tol: 'sensitive', bitter_pref: -0.5, heat_lover: true });
invariants('повод: десерт', dishes(T.TABLE_PRESETS[4].dishes), pool, { occasion: 'dessert' });
invariants('только пиво', dishes(T.TABLE_PRESETS[2].dishes), pool.filter((b) => ['beer', 'na_beer', 'radler'].includes(b.category)));

// ── 8. размер сета и пороги ──────────────────────────────────────────────────
{
  const ds = dishes(['beshbarmak', 'sushi', 'chak-chak', 'buffalo-wings', 'oysters-raw', 'dark-chocolate', 'lagman-spicy', 'caprese']);
  const sizes = [];
  for (const maxFlight of [1, 2, 3, 4]) {
    const { plan } = invariants(`сет до ${maxFlight}`, ds, pool, {}, { maxFlight });
    sizes.push(plan.flight_summary.sum);
  }
  section = 'размер сета';
  expect('больше бокалов — сумма не меньше', sizes.every((x, i) => i === 0 || x >= sizes[i - 1]), sizes.join(' → '));
  expect('maxFlight вне 1..4 ограничивается', planOf(ds, pool, {}, { maxFlight: 9 }).flight.length <= 4
    && planOf(ds, pool, {}, { maxFlight: 0 }).flight.length === 1);
  const strict = invariants('высокий порог прироста', ds, pool, {}, { minGainPerDish: 40, maxFlight: 4 });
  const loose = invariants('низкий порог прироста', ds, pool, {}, { minGainPerDish: 0.5, maxFlight: 4 });
  section = 'размер сета';
  expect('высокий порог — не больше бокалов, чем низкий', strict.plan.flight.length <= loose.plan.flight.length);
  invariants('строгий minScore', ds, pool, {}, { minScore: 80 });
}

// ── 9. политика Efes: только порядок ─────────────────────────────────────────
section = 'политика Efes';
{
  let promotedSeen = 0;
  const tables = [...T.TABLE_PRESETS.map((p) => p.dishes), ['kazy', 'kurt'], ['pizza-margherita', 'burger', 'fries'], ['sushi', 'edamame']];
  for (const ids of tables) {
    const ds = dishes(ids);
    const on = planOf(ds, pool, {}, { efesWindow: true });
    const off = planOf(ds, pool, {}, { efesWindow: false });
    const wide = planOf(ds, pool, {}, { efesWindow: true, window: 100 });
    const tag = ids.slice(0, 2).join('+');
    // single, сет и предупреждения — байт в байт; запасные и best_partner — тот же состав и те же баллы (подробность
    // карточки может отличаться: запасных выше поднятого Efes показывают крупно, им нужна полная карточка)
    const honest = (r) => r && [r.drink_id, r.min, r.sum, r.mean, r.below_min, r.weakest_dish.dish_id, r.weakest_dish.score,
      r.weakest_dish.band, r.strongest_dish.dish_id, r.strongest_dish.score];
    for (const [label, p] of [['окно', on], ['широкое окно', wide]]) {
      expect(`${tag}: ${label} не меняет single/сет/предупреждения`,
        JSON.stringify([p.single, p.flight, p.warnings, p.flight_summary]) === JSON.stringify([off.single, off.flight, off.warnings, off.flight_summary]));
      expect(`${tag}: ${label} не меняет состав и баллы запасных и best_partner`,
        JSON.stringify([p.runner_ups.map(honest), honest(p.best_partner)]) === JSON.stringify([off.runner_ups.map(honest), honest(off.best_partner)]));
    }
    expect(`${tag}: без окна — нет альтернативы`, off.efes_alternative === null && !off.policy.promoted);
    const bp = off.best_partner;
    if (bp && !off.single.efes) {
      expect(`${tag}: широкое окно показывает Efes первым`, wide.policy.promoted && wide.efes_alternative.drink_id === bp.drink_id
        && wide.policy.display_order[0] === bp.drink_id && wide.single.drink_id === off.single.drink_id);
      expect(`${tag}: баллы альтернативы честные`, wide.efes_alternative.min === bp.min && wide.efes_alternative.sum === bp.sum
        && wide.efes_alternative.gap === off.single.min - bp.min);
    }
    if (off.single.efes) expect(`${tag}: single сам Efes — не продвигаем`, !on.policy.promoted && !wide.policy.promoted);
    if (wide.policy.promoted) {
      const e = wide.efes_alternative;
      const all = brute(ds, pool).rows.map((r) => ({ min: r.min, sum: r.sum, id: r.b.id }))
        .sort((a, b) => b.min - a.min || b.sum - a.sum || E.pyStrCmp(a.id, b.id));
      expect(`${tag}: место Efes = его позиция по ключу maximin`, all[e.rank - 1].id === e.drink_id, `${e.rank}: ${all[e.rank - 1].id}`);
    }
    if (on.policy.promoted) promotedSeen++;
  }
  console.log(`Политика Efes: окно ${WINDOW} балла сработало на ${promotedSeen} из ${tables.length} столов.`);
}

// ── 10. сет от single: воспроизведения найденных ошибок ──────────────────────
{
  // сет не хуже single: «не больше 2 бокалов» на дастархане (было: худшее блюдо 63 → 61)
  const d2 = invariants('дастархан, сет до 2', dishes(T.TABLE_PRESETS[0].dishes), pool, {}, { maxFlight: 2 });
  section = 'сет от single';
  expect('дастархан, 2 бокала: слабейшая пара не падает', d2.plan.flight_summary.min >= d2.plan.single.min,
    `${d2.plan.single.min} → ${d2.plan.flight_summary.min}`);
  // тирамису: single давал 64, прежний сет — 56 и предупреждение «в сете только 56»
  const big = ['borsch', 'shuzhyk', 'cheeseburger', 'pho-bo', 'crayfish-boiled', 'apple-pie', 'tiramisu', 'risotto', 'edamame', 'enchilada', 'pork-knuckle'];
  const r2 = invariants('11 блюд, сет до 3', dishes(big), pool, {}, { maxFlight: 3 });
  section = 'сет от single';
  const ti = r2.plan.single.per_dish.find((c) => c.dish_id === 'tiramisu');
  const tiSet = r2.bf.byId.get(r2.plan.assignment.tiramisu).s[big.indexOf('tiramisu')];
  expect('тирамису в сете не хуже, чем с single', tiSet >= ti.score, `${tiSet} < ${ti.score}`);
  expect('нет предупреждения о блюде, которое single обслуживает хорошо', r2.plan.warnings.every((w) =>
    r2.plan.single.per_dish.find((c) => c.dish_id === w.dish_id).score < 60));
  // один бокал в сете — это показанный single (было: тоник вместо legenda-777)
  const r3 = invariants('чебуреки + пад-тай, компания', dishes(['chebureki', 'pad-thai']), pool, { occasion: 'party' });
  section = 'сет от single';
  expect('чебуреки + пад-тай: сет содержит single или из двух бокалов', r3.plan.flight.length > 1
    || r3.plan.flight[0].drink_id === r3.plan.single.drink_id);
  // flight_limit — только при полном сете (было: «не вошла в сет из 3 бокалов» при двух бокалах)
  const bar = venues.find((v) => v.id === 'bar-13-shymkent');
  if (bar) {
    const set = new Set(bar.brands);
    const ids = drinks.filter((d) => set.has(d.id) || (d.legacy_brand_id && set.has(d.legacy_brand_id))).map((d) => d.id);
    const vp = pool.filter((b) => ids.includes(b.id));
    const menu = ['cold-cuts', 'fries', 'tonkatsu', 'ice-cream', 'paella', 'tacos', 'kartoffelsalat', 'beef-tartare', 'chocolate-fondant'];
    const r4 = invariants('bar-13: предупреждения при неполном сете', dishes(menu), vp, { occasion: 'party' }, { maxFlight: 3 });
    section = 'сет от single';
    const lim = r4.plan.warnings.filter((w) => w.kind === 'flight_limit');
    expect('flight_limit только при полном сете', lim.length === 0 || r4.plan.flight.length === 3);
    const ks = r4.plan.warnings.find((w) => w.dish_id === 'kartoffelsalat');
    expect('картофельный салат: пара ≥ 60 есть, место было — small_gain', !ks || ks.pool_best.score < 60 || r4.plan.flight.length === 3
      || ks.kind === 'small_gain', ks ? `${ks.kind}, сет ${r4.plan.flight.length}` : '');
  }
}

// ── 11. монотонность по размеру сета: фиксированные и случайные столы ────────
{
  section = 'монотонность';
  const sumsOf = (ds, ctx, pl = pool) => {
    const m = T.buildTableMatrix(ds, pl, ctx, P, C);
    return [1, 2, 3, 4].map((maxFlight) => T.planTable(ds, pl, ctx, P, C, { maxFlight, matrix: m }));
  };
  const mono = ['tempura', 'khachapuri-adjarian', 'salmon-grilled', 'garlic-croutons', 'shawarma', 'pho-bo', 'risotto', 'strudel',
    'ice-cream', 'chicken-curry', 'greek-salad', 'ashlyam-fu'];
  const ps = sumsOf(dishes(mono), { occasion: 'party' });
  expect('12 блюд, компания: сумма не падает с размером сета', ps.every((p, i) => i === 0 || p.flight_summary.sum >= ps[i - 1].flight_summary.sum),
    ps.map((p) => p.flight_summary.sum).join(' → '));
  // случайные столы (детерминированный ГПСЧ): сумма не падает, сет не хуже single ни по одному блюду, один бокал = single
  let seed = 20260923;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ctxs = [{}, { occasion: 'party' }, { occasion: 'meal' }, { harsh_tol: 'sensitive' }];
  const TABLES = 60;
  const bad = [], floorBad = [], oneBad = [];
  const t0 = Date.now();
  for (let t = 0; t < TABLES; t++) {
    const k = 1 + Math.floor(rnd() * 12);
    const ids = [];
    while (ids.length < k) { const id = allDishes[Math.floor(rnd() * allDishes.length)].id; if (!ids.includes(id)) ids.push(id); }
    const ctx = ctxs[t % ctxs.length];
    const ds = dishes(ids);
    const plans = sumsOf(ds, ctx);
    const sums = plans.map((p) => p.flight_summary.sum);
    if (!sums.every((x, i) => i === 0 || x >= sums[i - 1])) bad.push(`${ids.join(',')} ${JSON.stringify(ctx)}: ${sums.join(' → ')}`);
    for (const p of plans) {
      const S = p.matrix.scores, di = p.matrix.drink_ids;
      const row = (id) => S[di.indexOf(id)];
      const sRow = row(p.single.drink_id);
      const fl = p.flight.map((f) => row(f.drink_id));
      if (ds.some((_, j) => Math.max(...fl.map((r) => r[j])) < sRow[j]) || p.flight_summary.min < p.single.min) floorBad.push(`${ids.join(',')} max${p.options.maxFlight}`);
      if (p.flight.length === 1 && p.flight[0].drink_id !== p.single.drink_id) oneBad.push(`${ids.join(',')} max${p.options.maxFlight}`);
    }
  }
  expect(`${TABLES} случайных столов: больше бокалов — сумма не меньше`, bad.length === 0, bad.slice(0, 3).join('\n      '));
  expect(`${TABLES} случайных столов: каждое блюдо в сете ≥ его балла с single`, floorBad.length === 0, floorBad.slice(0, 3).join('\n      '));
  expect(`${TABLES} случайных столов: сет из одного бокала = single`, oneBad.length === 0, oneBad.slice(0, 3).join('\n      '));
  console.log(`Монотонность: ${TABLES} случайных столов × 4 размера сета за ${Date.now() - t0} мс.`);
}

// ── 12. порядок подачи: равные F_B и W_B — от сухого к сладкому ──────────────
{
  // venskoe и paloma: одинаковые F_B/W_B (0.26/0.4), сладость 0.3 и 0.525; по id первой шла бы paloma
  const tied = pool.filter((b) => b.id === 'venskoe' || b.id === 'paloma').reverse();
  const r = invariants('равная громкость: venskoe и paloma', dishes(['guacamole', 'roast-pork']), tied);
  section = 'сухое раньше сладкого';
  const order = r.plan.flight.map((f) => f.drink_id).join(' → ');
  expect('оба бокала в сете, равные F_B и W_B', r.plan.flight.length === 2 && r.plan.flight[0].F_B === r.plan.flight[1].F_B
    && r.plan.flight[0].W_B === r.plan.flight[1].W_B, order);
  expect('сначала сухое (venskoe), потом сладкое (paloma)', order === 'venskoe → paloma', order);
}

// ── итог ─────────────────────────────────────────────────────────────────────
for (const { p, plan, ms } of presetPlans) {
  const s = plan.single;
  const eff = plan.efes_alternative;
  console.log(`\n${p.id} (${p.dishes.length} блюд, ${plan.n_candidates} напитков, ${ms} мс с проверками):`);
  console.log(`  один на стол: ${s.drink_name} — min ${s.min}, среднее ${s.mean}; слабее всего: ${s.weakest_dish.dish_name} ${s.weakest_dish.score}`);
  console.log(`  запасные: ${plan.runner_ups.map((r) => `${r.drink_name} (${r.min}/${r.mean})`).join(', ')}`);
  if (eff) console.log(`  окно Efes: первым показан ${eff.drink_name} (${eff.min}/${eff.mean}, −${eff.gap} по худшему)`);
  else if (plan.best_partner) console.log(`  лучший Efes: ${plan.best_partner.drink_name} (${plan.best_partner.min}/${plan.best_partner.mean})`);
  console.log(`  сет из ${plan.flight.length}: ${plan.flight.map((f) => `${f.order}. ${f.drink_name} [F_B ${f.F_B}] → ${f.dishes.map((c) => `${c.dish_name} ${c.score}`).join(', ')}`).join(' | ')}`);
  console.log(`  среднее стола: один напиток ${plan.flight_summary.single_mean} → сет ${plan.flight_summary.mean}; предупреждений ${plan.warnings.length}`);
}
if (fails.length) {
  console.error(`\ntable-planner: ${fails.length} из ${checks} проверок не прошли:\n${fails.slice(0, 40).join('\n')}`);
  process.exit(1);
}
console.log(`\ntable-planner: ${checks} проверок, все прошли.`);
