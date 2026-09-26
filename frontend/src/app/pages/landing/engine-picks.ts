/*
   ОТВЕТ ДВИЖКА V2 ДЛЯ ГЛАВНОЙ

   Для блюда из каталога главная берёт тот же расчёт, что вкладка
   «К блюду» (GET /api/v2/pairing/dish/<id>/), и оставляет из него пиво
   портфеля Efes. Баллы не меняем. Порядок меняем в одном случае: при
   разнице до STRONG_WINDOW баллов первым идёт сорт обычной крепости,
   а не крепкий, чтобы к мясу не советовать первым самое крепкое пиво.
   */

import { Brand, FoodPairing } from '../../models/flavor-tree.models';
import { V2Pair, V2PairingResult } from '../drinks-v2/v2.models';
import { normalizeDish } from './dish-search';
import { STRONG_ABV, softenStrong } from './pairing-engine.data';

/** Пиво портфеля Efes: собственные марки и дистрибуция. */
const EFES_BEER = new Set(['own', 'distribution']);

export function abvOf(p: V2Pair): number | null {
  const v = p.drink?.abv ?? (p as V2Pair & { abv?: number | null }).abv;
  return typeof v === 'number' ? v : null;
}

export function isStrong(p: V2Pair): boolean {
  const abv = abvOf(p);
  return abv !== null && abv >= STRONG_ABV;
}

/** Пиво Efes по убыванию балла и лучший безалкогольный вариант Efes к этому блюду. */
export function efesBeers(result: V2PairingResult): { beers: V2Pair[]; nonAlcoholic: V2Pair | null } {
  const efes = result.items.filter(p => EFES_BEER.has(p.efes_relation) && p.drink?.in_pairing !== false);
  const byScore = (a: V2Pair, b: V2Pair) => b.score - a.score;
  const beers = efes.filter(p => p.category === 'beer').sort(byScore);
  const na = efes.filter(p => p.category === 'na_beer').sort(byScore);
  return { beers: softenStrong(beers, p => p.score, isStrong), nonAlcoholic: na[0] ?? null };
}

/**
 * Фраза движка для гостя: без технических скобок с числами и ссылками на
 * источники, без стрелок и длинных тире.
 */
export function cleanReason(text: string): string {
  let t = (text || '').split(' · ').filter((part, i) => i === 0 || !part.includes('↔')).join(' · ');
  t = t.replace(/\s*\((?=[^()]*(?:↔|\d|[A-Za-z]))[^()]*\)/g, '');
  t = t.replace(/\s*↔\s*/g, ' и ');
  t = t.replace(/\s*[\u2013\u2014]\s*/g, ', ');
  t = t.replace(/,(\s*,)+/g, ',').replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/[,;:]$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** Одна-две причины пары. Сначала механизм (горечь, мостик, свежесть), потом общий баланс. */
export function pairReasons(p: V2Pair, n = 2): string[] {
  const general = (family: string) => (family === 'balance' || family === 'context' ? 1 : 0);
  const out: string[] = [];
  for (const r of [...(p.reasons ?? [])].sort((a, b) => general(a.family) - general(b.family) || b.points - a.points)) {
    const text = cleanReason(r.text);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= n) break;
  }
  return out;
}

/** Предупреждение движка, если после чистки в нём не осталось цифр. */
export function pairWarning(p: V2Pair): string {
  const w = (p.warnings ?? [])[0] as unknown;
  const raw = typeof w === 'string' ? w : (w as { text?: string } | undefined)?.text ?? '';
  const text = cleanReason(raw);
  return /\d/.test(text) ? '' : text;
}

function nameKeys(name: string | undefined | null): string[] {
  if (!name) return [];
  const full = normalizeDish(name);
  const short = normalizeDish(name.replace(/\([^)]*\)/g, ''));
  return [full, short].filter(Boolean);
}

/** Сорт из каталога сомелье для напитка движка: по legacy_brand_id или по названию. */
export function brandForPair(p: V2Pair, brands: Brand[]): Brand | null {
  const legacy = p.drink?.legacy_brand_id;
  const keys = new Set([...nameKeys(p.drink?.name), ...nameKeys(p.drink?.display_name), ...nameKeys(p.drink_name)]);
  return brands.find(b => b.is_active !== false && (
    (legacy && (b.id === legacy || (b as Brand & { slug?: string }).slug === legacy))
    || nameKeys(b.name).some(k => keys.has(k))
  )) ?? null;
}

/**
 * Пара сомелье показывается у напитка, только если она написана для этого
 * же блюда и этого же сорта. Чужие вердикты на главную больше не попадают.
 */
export function curatedFor(dishId: string | null, brand: Brand | null, pairings: FoodPairing[]): FoodPairing | null {
  if (!dishId || !brand) return null;
  return pairings.find(p => p.dish === dishId && p.brand === brand.id) ?? null;
}
