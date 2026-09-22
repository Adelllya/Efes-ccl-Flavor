// Паритет TS-движка с Python по data/golden_scores.json. Запуск: npm run test:engine
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const out = path.join(here, '.engine-build');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execSync(`npx tsc ${path.join(here, '..', 'src/app/engine/pairing-engine.ts')} --outDir ${out} --module commonjs --target es2022 --strict --skipLibCheck`, { stdio: 'inherit' });
const require = createRequire(import.meta.url);
const E = require(path.join(out, 'pairing-engine.js'));
const J = (f) => JSON.parse(readFileSync(path.join(root, 'data', f), 'utf8'));

const notes = J('flavor_notes.json'), brands = J('brands.json'), dishes = J('dishes.json');
const curated = J('pairings_curated.json'), priors = J('style_priors.json').priors, golden = J('golden_scores.json');
const notesById = Object.fromEntries(notes.map(n => [n.id, n]));
const beers = Object.fromEntries(brands.map(b => [b.id, E.buildBeerProfile(b, notesById, priors)]));
const ds = Object.fromEntries(dishes.map(d => [d.id, E.buildDishProfile(d)]));
const idx = E.indexCurated(curated);

let fails = 0, checked = 0;
const eq = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
for (const [id, p] of Object.entries(golden.beer_profiles)) {
  for (const a of E.BEER_AXES) if (!eq(beers[id].vector[a], p.vector[a])) { fails++; console.log('vector mismatch', id, a, beers[id].vector[a], p.vector[a]); }
  if (!eq(beers[id].intensity, p.intensity) || !eq(beers[id].confidence, p.confidence)) { fails++; console.log('profile mismatch', id); }
  checked++;
}
for (const m of golden.matrix) {
  const r = E.scorePair(beers[m.beer], ds[m.dish], {}, idx[E.curatedKey(m.beer, m.dish)]);
  checked++;
  if (r.score !== m.score || r.match_type !== m.type) { fails++; if (fails < 15) console.log('matrix mismatch', m, '→', r.score, r.match_type); }
}
for (const c of golden.cases) {
  const r = E.scorePair(beers[c.beer], ds[c.dish], c.context, idx[E.curatedKey(c.beer, c.dish)]);
  checked++;
  if (r.score !== c.score || r.match_type !== c.type) { fails++; console.log('case mismatch', c.beer, c.dish, r.score, c.score); }
  const byRule = Object.fromEntries(r.contributions.map(x => [x.rule, x.points]));
  for (const g of c.contributions) if (!eq(byRule[g.rule] ?? NaN, g.points, 1e-6)) { fails++; console.log('rule mismatch', c.beer, c.dish, g.rule, byRule[g.rule], g.points); }
}
{
  const rated = [{ vector: beers['efes-pilsener'].vector, rating: 'love' }, { vector: beers['wukong-ju'].vector, rating: 'dislike' }];
  const v = E.dnaVector(rated);
  for (const a of E.BEER_AXES) if (!eq(v[a], golden.dna_case.vector[a])) { fails++; console.log('dna mismatch', a); }
  if (E.dnaArchetype(v).id !== golden.dna_case.archetype) { fails++; console.log('archetype mismatch'); }
  checked++;
}
rmSync(out, { recursive: true, force: true });
console.log(`engine parity: ${checked} проверок, расхождений: ${fails}`);
process.exit(fails ? 1 : 0);
