/**
 * Типы API подбора v2 (/api/v2/...): 412 напитков всех категорий и 114 блюд.
 * Движок и данные: backend/api/pairing/engine_v2.py, backend/data/engine/.
 */

export interface V2Category {
  id: string;
  label: string;
  n: number;
}

export interface V2Meta {
  engine: string;
  drinks: number;
  drinks_efes: number;
  dishes: number;
  categories: V2Category[];
  policy: { partner_tie_window: number; note: string };
}

export interface V2Price {
  retail_min?: number | null;
  retail_max?: number | null;
  horeca?: number | null;
  horeca_max?: number | null;
  is_estimate?: boolean;
}

export interface V2Drink {
  id: string;
  name: string;
  display_name?: string;
  category: string;
  style?: { name?: string; archetype?: string; family?: string };
  producer?: { name?: string; country?: string; region?: string };
  efes_relation: string;
  abv?: number | null;
  ibu?: number | null;
  price_kzt?: V2Price | null;
  serving?: { temp_min_c?: number; temp_max_c?: number; glass?: string } | null;
  legacy_brand_id?: string | null;
  description?: string;
  image?: string | null;
  /** Автор и лицензия фото из открытых источников (CC BY / BY-SA требуют подписи). */
  image_credit?: { author: string; license: string; license_url?: string; source: string } | null;
  in_pairing?: boolean;
  /** Флаги каталога. Категория na_beer сама по себе не значит «без алкоголя»: у Efes 0.0 Абрикос-Малина 0,6 %. */
  flags?: { non_alcoholic?: boolean; contains_gluten?: boolean };
}

export interface V2Dish {
  id: string;
  name: string;
  display_name?: string;
  emoji?: string;
  cuisine?: string[];
  category?: string;
  is_dessert?: boolean;
  description?: string;
  synonyms?: string[];
}

export interface V2Reason {
  rule: string;
  family: string;
  points: number;
  text: string;
  evidence?: string;
  /** Вариант текста правила: у R4 это gap, roast, roast_sweet и другие. */
  key?: string;
}

/** Одна пара «напиток + блюдо» с баллом 0-99 и объяснением. */
export interface V2Pair {
  drink_id: string;
  dish_id: string;
  drink_name: string;
  dish_name: string;
  category: string;
  /** Архетип стиля: по нему, например, отличаем энергетики (energy_drink). */
  archetype?: string;
  efes_relation: string;
  efes_partner: boolean;
  score: number;
  band: string;
  band_label: string;
  match_type: string;
  reasons: V2Reason[];
  warnings: V2Reason[] | string[];
  /** Сработавшие вето V1-V7: балл срезан потолком, напиток к блюду не советуют. */
  vetoes?: string[];
  abv?: number | null;
  drink?: V2Drink;
}

export interface V2CategoryBest {
  category: string;
  label: string;
  n: number;
  best: V2Pair | null;
  items: V2Pair[];
}

export interface V2PairingResult {
  engine: string;
  dish: V2Dish;
  items: V2Pair[];
  best_partner: V2Pair | null;
  categories: V2CategoryBest[];
  n_candidates: number;
  /** id напитков, убранных безалкогольным режимом (non_alcoholic=1). */
  excluded_non_alcoholic?: string[];
  policy: { partner_tie_window: number; note: string };
}

export interface V2DrinkDetail {
  drink: V2Drink;
  best_dishes: V2Pair[];
}
