// Копирует канонические data/*.json внутрь frontend/api/_data — serverless-функции Vercel не видят файлы выше корня проекта.
// Нужны ИИ-сомелье v2 (api/_lib/catalog.ts): блюда v2, лёгкий каталог напитков, параметры движка и классические пары,
// стили-архетипы для оценки незнакомого напитка. Файлы v1 (brands, dishes, flavor_notes, pairings_curated, style_priors,
// venues) функции больше не нужны. Запуск: node scripts/sync-data.mjs (перед деплоем; файлы в api/_data коммитятся —
// сборка Vercel этот скрипт сама не вызывает).
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'data');
const dst = path.resolve(here, '..', 'api', '_data');
export const FILES = ['dishes_v2.json', 'drinks_v2_spa.json', 'engine_v2_spa.json', 'style_priors_v2.json'];
mkdirSync(dst, { recursive: true });
for (const f of FILES) copyFileSync(path.join(src, f), path.join(dst, f));
console.log(`data → api/_data synced (${FILES.join(', ')})`);
