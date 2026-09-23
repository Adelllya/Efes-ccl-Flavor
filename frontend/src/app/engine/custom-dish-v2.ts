/**
 * «Своё блюдо» для движка v2: черновой вектор из ответов мастера (вкус, сытность, жирность, способ приготовления,
 * острота, белок, соус). Порт autofill() из scripts/build_dishes_v2.py (ENGINE_V2_SPEC §3.3) — той же функцией
 * размечены 70 блюд каталога, поэтому своё блюдо стоит на одной шкале с ними.
 *
 * Отличие от Python — только округление: там round(x, 2), здесь Math.round(x·100)/100; расхождение возможно лишь
 * на границе .xx5 и на подбор не влияет (вектор своего блюда целиком считается в браузере).
 */
import type { DishRecord } from './pairing-engine-v2';

export type SpecTaste = 'SALTY' | 'SWEET' | 'SOUR' | 'BITTER' | 'UMAMI' | 'SPICY' | 'MIXED';
export type SpecWeight = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export type SpecFat = 'LOW' | 'MEDIUM' | 'HIGH';
export type CookMethod = 'raw' | 'cured' | 'fermented' | 'steamed' | 'boiled' | 'braised' | 'baked' | 'fried' | 'grilled' | 'smoked';
export type ProteinSource = 'none' | 'beef' | 'lamb' | 'horse' | 'pork' | 'poultry' | 'white_fish' | 'oily_fish' | 'shellfish'
  | 'egg' | 'legume' | 'cheese_soft' | 'cheese_hard' | 'dairy';
export type Sauce = 'none' | 'cream' | 'tomato' | 'bbq' | 'soy' | 'vinaigrette' | 'cheese' | 'chili' | 'sweet_glaze' | 'broth';
export type AcidType = 'none' | 'citrus' | 'vinegar' | 'lactic' | 'tomato';

export interface DishSpecV2 {
  name: string;
  taste: SpecTaste;
  weight: SpecWeight;
  fat: SpecFat;
  cook: CookMethod;
  protein?: ProteinSource;
  sauce?: Sauce;
  acid?: AcidType;
  dessert?: boolean;
  /** 0..1, null — не задано */
  heat?: number | null;
  tags?: Record<string, number>;
  cuisine?: string[];
}

export const DISH_AXES_V2 = ['salt', 'sweet', 'sour', 'bitter', 'umami', 'fat', 'protein', 'heat', 'pungent',
  'weight', 'cream', 'maillard', 'smoke', 'fresh', 'fish_oil', 'green_iron'] as const;
type Axis = typeof DISH_AXES_V2[number];

const WEIGHT_LEVELS: Record<SpecWeight, number> = { LIGHT: .25, MEDIUM: .55, HEAVY: .85 };
const FAT_LEVELS: Record<SpecFat, number> = { LOW: .2, MEDIUM: .5, HIGH: .85 };
const PROTEIN_BY_SOURCE: Record<ProteinSource, number> = {
  none: 0, beef: .95, lamb: .9, horse: .9, pork: .85, poultry: .7, white_fish: .7, oily_fish: .8, shellfish: .5,
  egg: .5, legume: .5, cheese_soft: .5, cheese_hard: .9, dairy: .3,
};
const FISH_OIL_BY_SOURCE: Partial<Record<ProteinSource, number>> = { oily_fish: .9, white_fish: .4, shellfish: .3 };
const UMAMI_BY_SOURCE: Record<ProteinSource, number> = {
  none: 0, beef: .8, lamb: .8, horse: .8, pork: .7, poultry: .5, white_fish: .5, oily_fish: .6, shellfish: .6,
  egg: .3, legume: .3, cheese_soft: .3, cheese_hard: .8, dairy: .2,
};
const STARCH_TAGS = ['bread', 'rice', 'potato', 'noodles', 'corn', 'wheat', 'biscuit', 'grain'];
interface SauceRule { blend?: Partial<Record<Axis, number>>; add?: Partial<Record<Axis, number>>; floor?: Partial<Record<Axis, number>>; min?: Partial<Record<Axis, number>>; acid?: AcidType }
const SAUCE_RULES: Record<Sauce, SauceRule> = {
  none: {},
  cream: { blend: { cream: .7 }, add: { fat: .2 } },
  bbq: { blend: { sweet: .6, salt: .5 }, floor: { smoke: .8 } },
  vinaigrette: { blend: { sour: .6 }, acid: 'vinegar' },
  tomato: { blend: { sour: .35 }, add: { umami: .1 }, acid: 'tomato' },
  soy: { blend: { salt: .7 }, add: { umami: .15 } },
  chili: { blend: { heat: .7 } },
  sweet_glaze: { blend: { sweet: .5 } },
  cheese: { blend: { cream: .6 }, add: { fat: .2, salt: .1 } },
  broth: { min: { umami: .6 } },
};
const PUNGENT_BY_TAG: Record<string, number> = { onion: .3, garlic: .45, mustard: .5, radish: .4, horseradish: .8, wasabi: .8 };
const GREEN_IRON_BY_TAG: Record<string, number> = { asparagus: .8, artichoke: .8, spinach: .5 };
/** Ароматические теги от способа приготовления — для мостов R12 (в каталоге их проставляет разметчик). */
const COOK_TAGS: Partial<Record<CookMethod, Record<string, number>>> = {
  grilled: { char: .7, smoke: .6 }, smoked: { smoke: .9 }, cured: { cured: .7 }, baked: { bread: .4 }, fermented: { sour_lactic: .5 },
};

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Вектор блюда (16 осей) и тип кислоты — как autofill() в scripts/build_dishes_v2.py. */
export function autofillDish(spec: DishSpecV2): { vector: Record<Axis, number>; acid: AcidType } {
  const tags = spec.tags ?? {};
  const protein: ProteinSource = spec.protein ?? 'none';
  const sauce: Sauce = spec.sauce ?? 'none';
  const dessert = !!spec.dessert;
  let acid: AcidType = spec.acid ?? 'none';
  const v = Object.fromEntries(DISH_AXES_V2.map(a => [a, 0])) as Record<Axis, number>;
  // 1. база
  switch (spec.taste) {
    case 'SALTY': v.salt = .8; break;
    case 'SWEET': v.sweet = .85; break;
    case 'SOUR': v.sour = .8; break;
    case 'BITTER': v.bitter = .7; break;
    case 'UMAMI': v.umami = .8; break;
    case 'SPICY': v.umami = .4; v.heat = .6; break;
    case 'MIXED': v.salt = .4; v.sweet = .4; v.umami = .4; break;
  }
  v.weight = WEIGHT_LEVELS[spec.weight];
  v.fat = FAT_LEVELS[spec.fat];
  // 2. белок → protein, fish_oil, umami (share = 1: в мастере белок — главный ингредиент)
  const starch = STARCH_TAGS.some(t => (tags[t] ?? 0) >= .3);
  const p = protein !== 'none' ? PROTEIN_BY_SOURCE[protein] : (starch ? .2 : 0);
  v.protein = p * (dessert && (protein === 'none' || protein === 'dairy') ? .5 : 1);
  v.fish_oil = (FISH_OIL_BY_SOURCE[protein] ?? 0) * Math.min(1, 1 + .2);
  if (!dessert) v.umami = Math.max(v.umami, UMAMI_BY_SOURCE[protein]);
  // 3. способ приготовления
  switch (spec.cook) {
    case 'raw': if (!dessert) v.fresh = Math.max(v.fresh, .8); break;
    case 'cured': v.salt += .3; v.umami += .2; break;
    case 'fermented': v.sour += .3; v.fresh = Math.max(v.fresh, .3); break;
    case 'steamed': v.fresh = Math.max(v.fresh, .4); break;
    case 'boiled': v.umami += .1; break;
    case 'braised': v.umami += .1; v.maillard = Math.max(v.maillard, .3); break;
    case 'baked': v.maillard = Math.max(v.maillard, .5); break;
    case 'fried': v.maillard = Math.max(v.maillard, .6); v.fat += .1; break;
    case 'grilled': v.maillard = Math.max(v.maillard, .7); v.smoke = Math.max(v.smoke, .7); v.weight += .1; break;
    case 'smoked': v.smoke = Math.max(v.smoke, .9); v.maillard = Math.max(v.maillard, .4); break;
  }
  // 4. соус доминирует (CMS, Gaiser)
  const rule = SAUCE_RULES[sauce];
  for (const [a, s] of Object.entries(rule.blend ?? {}) as [Axis, number][]) v[a] = .6 * s + .4 * v[a];
  for (const [a, s] of Object.entries(rule.add ?? {}) as [Axis, number][]) v[a] += s;
  for (const [a, s] of Object.entries(rule.floor ?? {}) as [Axis, number][]) v[a] = Math.max(v[a], .6 * s + .4 * v[a]);
  for (const [a, s] of Object.entries(rule.min ?? {}) as [Axis, number][]) v[a] = Math.max(v[a], s);
  if (acid === 'none' && rule.acid) acid = rule.acid;
  // 5. теги
  v.cream = Math.max(v.cream, .9 * (tags['dairy_cream'] ?? 0));
  const pung = Object.entries(tags).filter(([t, w]) => t in PUNGENT_BY_TAG && w >= .3).map(([t]) => PUNGENT_BY_TAG[t]);
  if (pung.length) v.pungent = Math.max(...pung);
  const green = Object.entries(tags).filter(([t, w]) => t in GREEN_IRON_BY_TAG && w >= .3).map(([t]) => GREEN_IRON_BY_TAG[t]);
  v.green_iron = green.length ? Math.max(...green) : 0;
  // 6. десерт → sweet ≥ .6; несладкое блюдо — соль не ниже обычной посолки
  if (dessert) v.sweet = Math.max(v.sweet, .6);
  else if (spec.taste !== 'SWEET') v.salt = Math.max(v.salt, .4);
  if (spec.heat !== null && spec.heat !== undefined) v.heat = spec.heat;
  for (const a of DISH_AXES_V2) v[a] = round2(clamp(v[a]));
  return { vector: v, acid };
}

/** Запись блюда v2 (формат dishes_v2.json) для движка. */
export function customDishRecord(spec: DishSpecV2): DishRecord {
  const { vector, acid } = autofillDish(spec);
  const tags: Record<string, number> = { ...(COOK_TAGS[spec.cook] ?? {}), ...(spec.tags ?? {}) };
  return {
    id: 'custom', name: spec.name || 'Ваше блюдо', display_name: spec.name || 'Ваше блюдо',
    vector, tags, cuisine: spec.cuisine ?? [], is_dessert: !!spec.dessert, acid_type: acid, cook_method: spec.cook,
    protein_source: spec.protein ?? 'none', sauce: spec.sauce ?? 'none', vector_source: 'custom',
  };
}

/** Мастер v1 (FRIED/GRILLED/…) → способ приготовления v2. «Без термообработки» — сырое. */
export const COOK_FROM_V1: Record<string, CookMethod> = {
  FRIED: 'fried', GRILLED: 'grilled', BAKED: 'baked', BOILED: 'boiled', STEAMED: 'steamed', RAW: 'raw',
  CURED: 'cured', FERMENTED: 'fermented', OTHER: 'raw',
};
