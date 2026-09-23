/**
 * Данные ИИ-сомелье на Vercel: копии data/*.json в api/_data (node scripts/sync-data.mjs) → профили движка v2,
 * индексы и строки каталогов для промпта. Всё считается один раз при холодном старте функции.
 *
 *   dishes_v2.json      — 114 блюд (каталог для распознавания и обратного подбора)
 *   drinks_v2_spa.json  — лёгкий каталог напитков (те же id и поля движка, что data/drinks.json)
 *   engine_v2_spa.json  — параметры движка (литература + калибровка, как на сервере) и классические пары R20
 *   style_priors_v2.json — стили-архетипы: приор профиля для незнакомого напитка
 *
 * Зеркало на Python — backend/api/ai.py (dataset_v2.get_dataset): строки каталогов совпадают байт-в-байт.
 */
import dishesJson from '../_data/dishes_v2.json';
import drinksJson from '../_data/drinks_v2_spa.json';
import engineJson from '../_data/engine_v2_spa.json';
import stylesJson from '../_data/style_priors_v2.json';
import {
  CATEGORIES, ClassicIndex, ClassicPair, DishProfile, DishRecord, DrinkProfile, DrinkRecord, ParamsV2,
  asRecords, dishVector, drinkVector, fmtNum, indexClassics,
} from '../../src/app/engine/pairing-engine-v2';
import { CUISINES, DISH_TAGS, SUGAR_CATEGORIES, SUGAR_LABELS, TAG_GLOSS, drinkSchema, systemContext, systemDrink } from './prompts';

export interface DishRaw extends DishRecord {
  id: string; name: string; emoji?: string; category?: string; synonyms?: string[]; cuisine?: string[];
  vector: Record<string, number>;
}
export interface DrinkRaw extends DrinkRecord {
  id: string; name: string; category: string; display_name?: string;
  style?: { archetype?: string | null; name?: string | null; family?: string | null } | null;
  producer?: { name?: string; group?: string; country?: string } | null;
  abv?: number | null; abv_source?: string; ibu?: number | null; ibu_source?: string;
  sensory?: Record<string, number> | null; aroma_tags?: Record<string, number> | null;
  serving?: { temp_min_c?: number | null; temp_max_c?: number | null; glass?: string } | null;
  vector_source?: string; vector_confidence?: number; efes_relation?: string; legacy_brand_id?: string;
  status?: string; availability_kz?: { level?: string } | null; image?: string | null;
}
export interface ArchetypeRaw {
  id: string; category: string; family?: string; label_ru?: string; abv?: number | null; ibu?: number | null;
  sensory?: Record<string, number>; aroma_tags?: Record<string, number>; origin_affinity?: string[];
  anchor?: string; anchor_type?: string; serving?: { temp_min_c?: number | null; temp_max_c?: number | null; glass?: string } | null;
}

/** Попадает ли напиток в подбор для гостя — как dataset_v2.is_guest_visible (и isGuestVisible в SPA). */
export const isGuestVisible = (d: DrinkRaw): boolean => d.status !== 'draft' && d.availability_kz?.level !== 'not_confirmed';

const bundle = engineJson as unknown as { params: ParamsV2; classics: ClassicPair[] };
export const P: ParamsV2 = bundle.params;
export const CLASSICS: ClassicIndex = indexClassics(bundle.classics);

export const DISHES = dishesJson as unknown as DishRaw[];
export const DISH_BY_ID = new Map(DISHES.map(d => [d.id, d]));
export const DISH_PROFILES: DishProfile[] = DISHES.map(d => dishVector(d, P));
export const DISH_PROFILE_BY_ID = new Map(DISH_PROFILES.map(p => [p.id, p]));

export const DRINKS = (drinksJson as unknown as { drinks: DrinkRaw[] }).drinks;
export const DRINK_BY_ID = new Map(DRINKS.map(d => [d.id, d]));
const DRINK_PROFILE_BY_ID = new Map(DRINKS.map(d => [d.id, drinkVector(d, P)]));
/** Пул подбора: без черновиков и позиций с неподтверждённым наличием. */
export const GUEST_POOL: DrinkProfile[] = DRINKS.filter(isGuestVisible).map(d => DRINK_PROFILE_BY_ID.get(d.id)!);
export const drinkProfile = (id: string): DrinkProfile | undefined => DRINK_PROFILE_BY_ID.get(id);

export const ARCHETYPES = asRecords<ArchetypeRaw>(stylesJson);
export const ARCHETYPE_BY_ID = new Map(ARCHETYPES.map(a => [a.id, a]));
export const ARCHETYPE_IDS = ARCHETYPES.map(a => a.id);

// ─────────────────────────────── строки каталогов для промпта ───────────────────────────────

const nonEmpty = (s: string | null | undefined): s is string => !!s;

export function dishLine(d: DishRaw): string {
  const syns = (d.synonyms ?? []).filter(s => typeof s === 'string' && !!s).slice(0, 4);
  const head = `${d.id} — ${d.name}${syns.length ? ` (${syns.join(', ')})` : ''}`;
  return [head, (d.cuisine ?? []).slice(0, 2).join(', '), d.category ?? ''].filter(nonEmpty).join(' · ');
}

export function drinkLine(d: DrinkRaw): string {
  const display = d.display_name && d.display_name !== d.name ? ` (${d.display_name})` : '';
  const arch = d.style?.archetype ? ARCHETYPE_BY_ID.get(d.style.archetype) : undefined;
  const style = arch?.label_ru || d.style?.name || '';
  const abv = d.abv !== null && d.abv !== undefined ? `${fmtNum(d.abv)}%` : '';
  return [`${d.id} — ${d.name}${display}`, d.producer?.name ?? '', [d.category, style, abv].filter(nonEmpty).join(', ')].filter(nonEmpty).join(' · ');
}

export function archetypeLine(a: ArchetypeRaw): string {
  const nums = [a.abv !== null && a.abv !== undefined ? `ABV ${fmtNum(a.abv)}` : '', a.ibu !== null && a.ibu !== undefined ? `IBU ${fmtNum(a.ibu)}` : ''];
  return [`${a.id} — ${a.label_ru || a.id}`, a.category, nums.filter(nonEmpty).join(', ')].filter(nonEmpty).join(' · ');
}

export const SYSTEM_CONTEXT = systemContext(
  fmtNum(P.recommend.partner_tie_window),
  CUISINES.join(', '),
  DISHES.map(dishLine).join('\n'),
  ARCHETYPES.map(archetypeLine).join('\n'),
  DISH_TAGS.map(t => `${t} — ${TAG_GLOSS[t]}`).join('\n'),
);
export const SYSTEM_DRINK = systemDrink(
  DRINKS.map(drinkLine).join('\n'),
  SUGAR_CATEGORIES.map(s => `${s} (${SUGAR_LABELS[s]})`).join(', '),
);
export const DRINK_SCHEMA = drinkSchema(CATEGORIES, ARCHETYPE_IDS);
