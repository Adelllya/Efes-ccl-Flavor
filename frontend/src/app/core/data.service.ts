import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import brandsJson from '../../../../data/brands.json';
import dishesJson from '../../../../data/dishes.json';
import notesJson from '../../../../data/flavor_notes.json';
import curatedJson from '../../../../data/pairings_curated.json';
import priorsJson from '../../../../data/style_priors.json';
import coursesJson from '../../../../data/courses.json';
import teamJson from '../../../../data/team.json';
import venuesJson from '../../../../data/venues.json';
import { API_URL } from './config';
import { Brand, Course, CuratedPairing, Dish, FlavorNote, StylePriors, TeamMember, Venue } from './models';
import { BeerProfile, DishProfile, buildBeerProfile, buildDishProfile, indexCurated } from '../engine/pairing-engine';

/**
 * Единственный источник данных для SPA. Встроенные JSON (data/) → мгновенный офлайн-старт;
 * если задан API_URL — подтягивает актуальные пирамиды из Django (правки сомелье).
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private http = inject(HttpClient);

  readonly notes = signal<FlavorNote[]>(notesJson as FlavorNote[]);
  readonly brands = signal<Brand[]>(brandsJson as unknown as Brand[]);
  readonly dishes = signal<Dish[]>(dishesJson as unknown as Dish[]);
  readonly curated = signal<CuratedPairing[]>(curatedJson as CuratedPairing[]);
  readonly priors = signal<StylePriors>(priorsJson as unknown as StylePriors);
  readonly courses = signal<Course[]>(coursesJson as Course[]);
  readonly team = signal<TeamMember[]>(teamJson as TeamMember[]);
  readonly venues = signal<Venue[]>(venuesJson as Venue[]);
  readonly source = signal<'bundled' | 'api'>('bundled');

  readonly notesById = computed(() => Object.fromEntries(this.notes().map(n => [n.id, n])) as Record<string, FlavorNote>);
  readonly brandById = computed(() => Object.fromEntries(this.brands().map(b => [b.id, b])) as Record<string, Brand>);
  readonly dishById = computed(() => Object.fromEntries(this.dishes().map(d => [d.id, d])) as Record<string, Dish>);
  readonly venueById = computed(() => Object.fromEntries(this.venues().map(v => [v.id, v])) as Record<string, Venue>);

  /** Профили движка пересчитываются при любом изменении данных (например, из админки). */
  readonly beerProfiles = computed<BeerProfile<Brand>[]>(() => {
    const notes = this.notesById(); const priors = this.priors().priors;
    return this.brands().map(b => buildBeerProfile(b, notes, priors));
  });
  readonly dishProfiles = computed<DishProfile<Dish>[]>(() => this.dishes().map(d => buildDishProfile(d)));
  readonly beerProfileById = computed(() => Object.fromEntries(this.beerProfiles().map(p => [p.id, p])) as Record<string, BeerProfile<Brand>>);
  readonly dishProfileById = computed(() => Object.fromEntries(this.dishProfiles().map(p => [p.id, p])) as Record<string, DishProfile<Dish>>);
  readonly curatedIndex = computed(() => indexCurated(this.curated()));

  readonly stats = computed(() => ({
    brands: this.brands().length, dishes: this.dishes().length, notes: this.notes().length,
    curated: this.curated().length, venues: this.venues().length,
    pyramidNotes: this.brands().reduce((s, b) => s + b.pyramid.length, 0),
  }));

  constructor() {
    if (API_URL) this.syncFromApi();
  }

  brand(id: string): Brand | undefined { return this.brandById()[id]; }
  dish(id: string): Dish | undefined { return this.dishById()[id]; }
  note(id: string): FlavorNote | undefined { return this.notesById()[id]; }
  brandImage(b: Brand): string { return b.image || 'img/beers/placeholder.svg'; }

  /** Локальное обновление пирамиды (панель сомелье) — движок пересчитается автоматически. */
  updateBrand(id: string, patch: Partial<Brand>): void {
    this.brands.update(list => list.map(b => (b.id === id ? { ...b, ...patch } : b)));
  }

  private syncFromApi(): void {
    this.http.get<{ results?: any[] } | any[]>(`${API_URL}/brands/?page_size=200`).pipe(catchError(() => of(null))).subscribe(res => {
      if (!res) return;
      const rows: any[] = Array.isArray(res) ? res : res.results || [];
      if (!rows.length) return;
      const notesBySlug = this.notesById();
      this.brands.update(list => list.map(b => {
        const row = rows.find(r => r.slug === b.id);
        if (!row) return b;
        const pyramid = row.pyramid ? (['top', 'heart', 'base'] as const).flatMap(l => (row.pyramid[l] || []).map((n: any) => ({
          layer: l.toUpperCase() as 'TOP' | 'HEART' | 'BASE', note_id: n.slug || n.id, intensity: n.intensity, sommelier_note: n.sommelier_note || '',
        })).filter((p: any) => notesBySlug[p.note_id])) : b.pyramid;
        return { ...b, pyramid: pyramid.length ? pyramid : b.pyramid, vector_override: row.vector_override || b.vector_override,
          abv: row.abv ?? b.abv, description: row.description || b.description, image: row.image || b.image };
      }));
      this.source.set('api');
    });
  }
}
