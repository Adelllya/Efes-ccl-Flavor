/*
   ОТВЕТ ДВИЖКА V2 ДЛЯ ГЛАВНОЙ

   Для блюда из каталога главная берёт тот же расчёт, что вкладка
   «К блюду» (GET /api/v2/pairing/dish/<id>/), и оставляет из него пиво
   портфеля Efes. Баллы не меняем. Порядок меняем в одном случае: при
   разнице до STRONG_WINDOW баллов первым идёт сорт обычной крепости,
   а не крепкий, чтобы к мясу не советовать первым самое крепкое пиво.
   Сорта под вето движка не советуем, а пометку «Без алкоголя» ставим
   только напиткам до 0,5 % (isNonAlcoholic), а не всей категории na_beer.
   */

import { Brand, FoodPairing } from '../../models/flavor-tree.models';
import { V2Pair, V2PairingResult, V2Reason } from '../drinks-v2/v2.models';
import { normalizeDish } from './dish-search';
import { STRONG_ABV, softenStrong } from './pairing-engine.data';

/** Пиво портфеля Efes: собственные марки и дистрибуция. */
const EFES_BEER = new Set(['own', 'distribution']);

/** Предел для пометки «Без алкоголя»: 0,5 %, как в правиле V7 движка (безалкогольный выбор). */
export const NA_MAX_ABV = 0.5;

export function abvOf(p: V2Pair): number | null {
  const v = p.drink?.abv ?? p.abv;
  return typeof v === 'number' ? v : null;
}

export function isStrong(p: V2Pair): boolean {
  const abv = abvOf(p);
  return abv !== null && abv >= STRONG_ABV;
}

/**
 * Можно ли показать напиток с пометкой «Без алкоголя». Категории na_beer
 * мало: у «Efes 0.0 Абрикос-Малина» 0,6 % и flags.non_alcoholic = false.
 * Верим флагу каталога, а без флага только крепости до 0,5 %.
 */
export function isNonAlcoholic(p: V2Pair): boolean {
  const flag = p.drink?.flags?.non_alcoholic;
  const abv = abvOf(p);
  if (flag === false || (abv !== null && abv > NA_MAX_ABV)) return false;
  return flag === true || abv !== null;
}

/** Движок наложил вето (блюдо заглушит напиток, десерт слаще пива): такой сорт не советуем. */
export function isVetoed(p: V2Pair): boolean {
  return !!p.vetoes?.length;
}

function isEfesPick(p: V2Pair): boolean {
  return EFES_BEER.has(p.efes_relation) && p.drink?.in_pairing !== false;
}

/**
 * Ответ движка только с напитками Efes. Полный список весит около 1,3 МБ,
 * а главной нужны два-три десятка строк: их и держим в памяти и в кэше.
 */
export function efesOnly(result: V2PairingResult): V2PairingResult {
  return { ...result, items: result.items.filter(isEfesPick), categories: [] };
}

/** Пиво Efes по убыванию балла и лучший безалкогольный вариант Efes к этому блюду. Сорта под вето не берём. */
export function efesBeers(result: V2PairingResult): { beers: V2Pair[]; nonAlcoholic: V2Pair | null } {
  const efes = result.items.filter(p => isEfesPick(p) && !isVetoed(p));
  const byScore = (a: V2Pair, b: V2Pair) => b.score - a.score;
  const beers = efes.filter(p => p.category === 'beer').sort(byScore);
  const na = efes.filter(p => p.category === 'na_beer' && isNonAlcoholic(p)).sort(byScore);
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

/**
 * Штрафы R4 с ключом roast и roast_sweet звучат как похвала («обжарка
 * уравновешивает сладость»): это смягчённый штраф, а не предупреждение.
 */
function praiseLike(w: V2Reason): boolean {
  return w.rule === 'R4' && (w.key === 'roast' || w.key === 'roast_sweet');
}

/** Первое предупреждение движка, в котором после чистки не осталось цифр. */
export function pairWarning(p: V2Pair): string {
  for (const w of (p.warnings ?? []) as (V2Reason | string)[]) {
    if (typeof w !== 'string' && praiseLike(w)) continue;
    const text = cleanReason(typeof w === 'string' ? w : w.text ?? '');
    if (text && !/\d/.test(text)) return text;
  }
  return '';
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
