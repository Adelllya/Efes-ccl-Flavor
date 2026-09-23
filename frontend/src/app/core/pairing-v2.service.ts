import { Injectable, inject } from '@angular/core';
import { DataV2Service, DishV2, DrinkV2, TAB_GROUPS } from './data-v2.service';
import {
  Ctx, DRINK_AXES, DishInput, DrinkProfile, PairResult, RecommendResult, ReverseResult,
  cosine, recommend, reverse, scorePair,
} from '../engine/pairing-engine-v2';

export interface TabResult { id: string; categories: readonly string[]; result: RecommendResult; }
export interface SimilarDrink { drink: DrinkV2; similarity: number; }

/** Оси для сходства напитков: без температуры подачи (в °C она перевесила бы остальные). */
const SIMILARITY_AXES = DRINK_AXES.filter(a => a !== 'serve_temp');

/** Фасад движка v2 для страниц: подбор, вкладки, разбор пары, блюда к напитку, похожие напитки. */
@Injectable({ providedIn: 'root' })
export class PairingV2Service {
  private data = inject(DataV2Service);

  /** Топ к блюду (диверсификация + политика Efes). venueDrinkIds — только напитки заведения. */
  forDish(dish: DishInput, ctx: Ctx = {}, opts: { top?: number; categories?: readonly string[] | null; venueDrinkIds?: readonly string[] | null } = {}): RecommendResult {
    return recommend(dish, this.data.guestPool(), ctx, opts.top ?? null, this.data.activeParams(), this.data.classics,
      opts.categories ?? null, opts.venueDrinkIds ?? null);
  }

  /** Вкладки: лучшие в каждой группе категорий (пустые группы не возвращаются). */
  tabs(dish: DishInput, ctx: Ctx = {}, venueDrinkIds: readonly string[] | null = null, top = 5): TabResult[] {
    const out: TabResult[] = [];
    for (const g of TAB_GROUPS) {
      const result = recommend(dish, this.data.guestPool(), ctx, top, this.data.activeParams(), this.data.classics, g.categories, venueDrinkIds);
      if (result.items.length) out.push({ id: g.id, categories: g.categories, result });
    }
    return out;
  }

  explain(drinkId: string, dish: DishInput, ctx: Ctx = {}): PairResult | null {
    const b = this.data.drinkProfileById().get(drinkId);
    return b ? scorePair(b, dish, ctx, this.data.activeParams(), this.data.classics) : null;
  }

  /** Лучшие блюда к напитку. */
  forDrink(drinkId: string, ctx: Ctx = {}, top = 8): ReverseResult | null {
    const b = this.data.drinkProfileById().get(drinkId);
    return b ? reverse(b, this.data.dishProfiles(), ctx, top, this.data.activeParams(), this.data.classics) : null;
  }

  /** Похожие по профилю (косинус по 13 вкусовым осям), в той же группе категорий. */
  similar(drinkId: string, n = 4): SimilarDrink[] {
    const me = this.data.drinkProfileById().get(drinkId);
    if (!me) return [];
    const group = TAB_GROUPS.find(g => g.categories.includes(me.category))?.categories ?? [me.category];
    const byId = this.data.drinkById();
    const scored: SimilarDrink[] = [];
    for (const p of this.data.guestPool()) {
      if (p.id === me.id || !group.includes(p.category)) continue;
      const d = byId.get(p.id);
      if (d) scored.push({ drink: d, similarity: cosine(me.v, p.v, SIMILARITY_AXES) });
    }
    return scored.sort((a, b) => b.similarity - a.similarity || a.drink.name.localeCompare(b.drink.name)).slice(0, n);
  }

  /** Сорта заведения из v1 (slug бренда) → id напитков v2 (через legacy_brand_id). */
  venueDrinkIds(refs: readonly string[] | null): string[] | null {
    if (!refs) return null;
    const set = new Set(refs);
    return (this.data.drinks() ?? []).filter(d => set.has(d.id) || (!!d.legacy_brand_id && set.has(d.legacy_brand_id))).map(d => d.id);
  }

  profile(drinkId: string): DrinkProfile | undefined { return this.data.drinkProfileById().get(drinkId); }
  dish(id: string): DishV2 | undefined { return this.data.dish(id); }
}
