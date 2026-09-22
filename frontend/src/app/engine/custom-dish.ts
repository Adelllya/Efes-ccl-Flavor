/** Сенсорный вектор «своего блюда» из категориальных полей.
 *  Одна и та же логика, что default_dish_vector в scripts/build_data.py и customDish в PairingService —
 *  вынесена сюда, чтобы ИИ-слой (api/_lib/sommelier.ts) и SPA считали одинаково. */
import { DISH_AXES, DishVector } from './pairing-engine';

export type SpecTaste = 'SALTY' | 'SWEET' | 'SOUR' | 'BITTER' | 'UMAMI' | 'SPICY' | 'MIXED';
export type SpecWeight = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export type SpecFat = 'LOW' | 'MEDIUM' | 'HIGH';
export type SpecCooking = 'FRIED' | 'GRILLED' | 'BAKED' | 'BOILED' | 'STEAMED' | 'RAW' | 'CURED' | 'FERMENTED' | 'OTHER';
export interface DishSpec { taste: SpecTaste; weight: SpecWeight; fat: SpecFat; cooking: SpecCooking; heat?: number; tags?: string[]; }

export const SPEC_TASTES: SpecTaste[] = ['SALTY', 'SWEET', 'SOUR', 'BITTER', 'UMAMI', 'SPICY', 'MIXED'];
export const SPEC_WEIGHTS: SpecWeight[] = ['LIGHT', 'MEDIUM', 'HEAVY'];
export const SPEC_FATS: SpecFat[] = ['LOW', 'MEDIUM', 'HIGH'];
export const SPEC_COOKINGS: SpecCooking[] = ['FRIED', 'GRILLED', 'BAKED', 'BOILED', 'STEAMED', 'RAW', 'CURED', 'FERMENTED', 'OTHER'];

export function customDishVector(spec: DishSpec): { vector: DishVector; tags: string[] } {
  const v = Object.fromEntries(DISH_AXES.map(a => [a, 0])) as DishVector;
  switch (spec.taste) {
    case 'SALTY': v.salt = .8; break;
    case 'SWEET': v.sweet = .85; break;
    case 'SOUR': v.sour = .8; break;
    case 'BITTER': v.bitter = .7; break;
    case 'UMAMI': v.umami = .8; break;
    case 'SPICY': v.heat = .75; v.umami = .4; break;
    case 'MIXED': v.salt = .4; v.sweet = .4; v.umami = .4; break;
  }
  v.weight = { LIGHT: .25, MEDIUM: .55, HEAVY: .85 }[spec.weight];
  v.fat = { LOW: .2, MEDIUM: .5, HIGH: .85 }[spec.fat];
  const tags = new Set(spec.tags || []);
  switch (spec.cooking) {
    case 'FRIED': v.maillard = .6; v.fat = Math.min(1, v.fat + .1); tags.add('fried'); break;
    case 'GRILLED': v.smoke = .7; v.maillard = .7; tags.add('smoke'); tags.add('char'); break;
    case 'BAKED': v.maillard = .5; tags.add('bread'); break;
    case 'BOILED': v.umami = Math.min(1, v.umami + .1); tags.add('broth'); break;
    case 'STEAMED': v.fresh = .4; break;
    case 'RAW': v.fresh = .8; break;
    case 'CURED': v.salt = Math.min(1, v.salt + .3); v.smoke = .3; v.umami = Math.min(1, v.umami + .2); tags.add('cured'); break;
    case 'FERMENTED': v.sour = Math.min(1, v.sour + .3); v.fresh = .3; tags.add('sour'); break;
  }
  if (spec.taste !== 'SWEET') v.salt = Math.max(v.salt, .4);
  if (spec.heat !== undefined) v.heat = Math.max(v.heat, spec.heat);
  return { vector: v, tags: [...tags] };
}
