// Копирует канонические data/*.json внутрь frontend/api/_data — serverless-функции Vercel не видят файлы выше корня проекта.
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'data');
const dst = path.resolve(here, '..', 'api', '_data');
mkdirSync(dst, { recursive: true });
for (const f of ['brands.json', 'dishes.json', 'flavor_notes.json', 'pairings_curated.json', 'style_priors.json', 'venues.json']) {
  copyFileSync(path.join(src, f), path.join(dst, f));
}
console.log('data → api/_data synced');
