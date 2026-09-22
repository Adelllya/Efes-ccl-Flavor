import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DataService } from './data.service';
import { Brand } from './models';
import { ARCHETYPES, Archetype, BEER_AXES, BeerVector, Rating, cosine, dnaArchetype, dnaVector } from '../engine/pairing-engine';

const KEY = 'ft.dna.v1';

/** Flavor DNA — личный профиль вкуса из оценок сортов. Хранится локально, без регистрации. */
@Injectable({ providedIn: 'root' })
export class DnaService {
  private data = inject(DataService);
  readonly ratings = signal<Record<string, Rating>>(this.load());

  readonly ratedCount = computed(() => Object.values(this.ratings()).filter(r => r !== 'meh').length);
  readonly vector = computed<BeerVector | null>(() => {
    const byId = this.data.beerProfileById();
    const rated = Object.entries(this.ratings()).filter(([id]) => byId[id]).map(([id, rating]) => ({ vector: byId[id].vector, rating }));
    return dnaVector(rated);
  });
  readonly archetype = computed<(Archetype & { similarity: number }) | null>(() => { const v = this.vector(); return v ? dnaArchetype(v) : null; });
  readonly ready = computed(() => this.ratedCount() >= 3 && !!this.vector());
  /** Топ сортов, похожих на профиль (исключая уже оценённые). */
  readonly recommendations = computed<{ brand: Brand; similarity: number }[]>(() => {
    const v = this.vector(); if (!v) return [];
    const rated = this.ratings();
    return this.data.beerProfiles().filter(p => !rated[p.id] || rated[p.id] === 'meh')
      .map(p => ({ brand: p.brand, similarity: Math.round(cosine(p.vector, v, BEER_AXES) * 100) / 100 }))
      .sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  });
  readonly archetypes = ARCHETYPES;

  constructor() { effect(() => { try { localStorage.setItem(KEY, JSON.stringify(this.ratings())); } catch { /* ignore */ } }); }

  rate(beerId: string, rating: Rating): void { this.ratings.update(r => ({ ...r, [beerId]: rating })); }
  clear(): void { this.ratings.set({}); }

  private load(): Record<string, Rating> {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return {};
  }
}
