import { Injectable, inject } from '@angular/core';
import { DataService } from './data.service';
import { Brand, Cooking, Dish, Fat, Taste, Weight } from './models';
import {
  BeerProfile, DishProfile, PairContext, PairResult, DISH_AXES, DishVector,
  buildDishProfile, recommendBeers, recommendDishes, scorePair, similarBeers, curatedKey,
} from '../engine/pairing-engine';
import { customDishVector } from '../engine/custom-dish';

export interface Match extends PairResult { beer: Brand; dish: Dish; beerProfile: BeerProfile<Brand>; dishProfile: DishProfile<Dish>; }
export interface DishSearchHit { dish: Dish; score: number; }
export interface CustomDishSpec { name: string; taste: Taste; weight: Weight; fat: Fat; cooking: Cooking; heat?: number; tags?: string[]; }

/** Фасад движка для страниц: возвращает результаты, обогащённые объектами бренда и блюда. */
@Injectable({ providedIn: 'root' })
export class PairingService {
  private data = inject(DataService);

  forDish(dishId: string, ctx: PairContext = {}, opts: { limit?: number; venueBrands?: string[] | null; diversify?: boolean } = {}): Match[] {
    const dish = this.data.dishProfileById()[dishId];
    if (!dish) return [];
    return this.forDishProfile(dish, ctx, opts);
  }

  forDishProfile(dish: DishProfile<Dish>, ctx: PairContext = {}, opts: { limit?: number; venueBrands?: string[] | null; diversify?: boolean } = {}): Match[] {
    const res = recommendBeers(dish, this.data.beerProfiles(), this.data.curatedIndex(), ctx, opts.limit ?? 5, opts.venueBrands ?? null, opts.diversify ?? true);
    return res.map(r => this.enrich(r, dish));
  }

  forBeer(beerId: string, ctx: PairContext = {}, limit = 6): Match[] {
    const beer = this.data.beerProfileById()[beerId];
    if (!beer) return [];
    return recommendDishes(beer, this.data.dishProfiles(), this.data.curatedIndex(), ctx, limit).map(r => this.enrich(r));
  }

  explain(beerId: string, dishId: string, ctx: PairContext = {}): Match | null {
    const beer = this.data.beerProfileById()[beerId]; const dish = this.data.dishProfileById()[dishId];
    if (!beer || !dish) return null;
    return this.enrich(scorePair(beer, dish, ctx, this.data.curatedIndex()[curatedKey(beerId, dishId)]), dish);
  }

  similar(beerId: string, limit = 3): { brand: Brand; similarity: number }[] {
    const beer = this.data.beerProfileById()[beerId];
    if (!beer) return [];
    return similarBeers(beer, this.data.beerProfiles(), limit).map(s => ({ brand: this.data.brand(s.beer_id)!, similarity: s.similarity }));
  }

  /** Полнотекстовый поиск по названию, синонимам, категории и кухне. */
  searchDishes(query: string, limit = 8): DishSearchHit[] {
    const q = query.trim().toLowerCase().replace(/ё/g, 'е');
    if (!q) return [];
    const tokens = q.split(/[\s,]+/).filter(t => t.length >= 2);
    if (!tokens.length) return [];
    const hits: DishSearchHit[] = [];
    for (const d of this.data.dishes()) {
      const hay = [d.name, d.display_name, ...d.synonyms, d.category, d.cuisine_label].map(s => s.toLowerCase().replace(/ё/g, 'е'));
      let score = 0;
      for (const t of tokens) {
        for (let i = 0; i < hay.length; i++) {
          const h = hay[i];
          if (h === t) score += 10;
          else if (h.startsWith(t)) score += 6;
          else if (t.length >= 3 && h.split(/[\s()]+/).some(w => w.startsWith(t))) score += 4;
          else if (t.length >= 4 && h.includes(t)) score += 3;
          else if (t.length >= 5 && h.split(/[\s()]+/).some(w => w.startsWith(t.slice(0, 4)))) score += 1;
        }
      }
      if (score > 0) hits.push({ dish: d, score });
    }
    return hits.sort((a, b) => b.score - a.score || a.dish.name.localeCompare(b.dish.name)).slice(0, limit);
  }

  /** «Своё блюдо» из мастера — та же логика, что default_dish_vector в scripts/build_data.py. */
  customDish(spec: CustomDishSpec): DishProfile<Dish> {
    const { vector: v, tags } = customDishVector(spec);
    const dish: Dish = {
      id: 'custom', name: spec.name || 'Ваше блюдо', display_name: spec.name || 'Ваше блюдо', emoji: '🍽️', cuisine: 'OTHER',
      cuisine_label: 'Своё блюдо', cuisine_flag: '✨', category: 'Своё', dominant_taste: spec.taste, dominant_taste_label: TASTE_LABELS[spec.taste],
      weight: spec.weight, weight_label: WEIGHT_LABELS[spec.weight], fat_level: spec.fat, fat_level_label: FAT_LABELS[spec.fat],
      cooking_method: spec.cooking, cooking_method_label: COOKING_LABELS[spec.cooking], description: 'Блюдо, описанное вами в мастере подбора.',
      vector: v, tags, synonyms: [],
    };
    return buildDishProfile(dish);
  }

  private enrich(r: PairResult, dish?: DishProfile<Dish>): Match {
    const beerProfile = this.data.beerProfileById()[r.beer_id];
    const dishProfile = dish ?? this.data.dishProfileById()[r.dish_id];
    return { ...r, beer: beerProfile.brand, dish: dishProfile.dish, beerProfile, dishProfile };
  }
}

export const TASTE_LABELS: Record<Taste, string> = { SALTY: 'Солёное', SWEET: 'Сладкое', SOUR: 'Кислое', BITTER: 'Горькое', UMAMI: 'Умами · мясное', SPICY: 'Острое', MIXED: 'Микс' };
export const WEIGHT_LABELS: Record<Weight, string> = { LIGHT: 'Лёгкое', MEDIUM: 'Среднее', HEAVY: 'Сытное' };
export const FAT_LABELS: Record<Fat, string> = { LOW: 'Низкая', MEDIUM: 'Средняя', HIGH: 'Высокая' };
export const COOKING_LABELS: Record<Cooking, string> = { FRIED: 'Жарка', GRILLED: 'Гриль / угли', BAKED: 'Запекание', BOILED: 'Варка / тушение', STEAMED: 'На пару', RAW: 'Сырое / салат', CURED: 'Вяленое / копчёное', FERMENTED: 'Ферментация', OTHER: 'Без термообработки' };
