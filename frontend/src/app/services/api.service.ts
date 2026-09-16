import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import {
  Brand,
  Dish,
  FlavorNote,
  FoodPairing,
  Course,
  TeamMember,
  AdminFlavorProfilePayload,
  ServingRecommendation
} from '../models/flavor-tree.models';

interface PaginatedResponse<T> {
  count: number;
  results: T[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private baseUrl = 'http://127.0.0.1:8000/api';

  // 1. Бренды и сорта пива
  getBrands(filters?: {
    style?: string;
    packaging_type?: string;
    is_horeca_only?: boolean;
    q?: string;
  }): Observable<Brand[]> {
    let params = new HttpParams();
    if (filters?.style) params = params.set('style', filters.style);
    if (filters?.packaging_type) params = params.set('packaging_type', filters.packaging_type);
    if (filters?.is_horeca_only !== undefined) params = params.set('is_horeca_only', filters.is_horeca_only);
    if (filters?.q) params = params.set('q', filters.q);

    return this.http.get<PaginatedResponse<Brand> | Brand[]>(`${this.baseUrl}/brands/`, { params }).pipe(
      map(res => Array.isArray(res) ? res : res.results || []),
      catchError(() => of(this.getMockBrands()))
    );
  }

  getBrandDetail(id: string): Observable<Brand> {
    return this.http.get<Brand>(`${this.baseUrl}/brands/${id}/`).pipe(
      catchError(() => {
        const found = this.getMockBrands().find(b => b.id === id) || this.getMockBrands()[0];
        return of(found);
      })
    );
  }

  // 2. Вкусовые ноты
  getFlavorNotes(category?: string): Observable<FlavorNote[]> {
    let params = new HttpParams();
    if (category) params = params.set('category', category);
    return this.http.get<PaginatedResponse<FlavorNote> | FlavorNote[]>(`${this.baseUrl}/flavor-notes/`, { params }).pipe(
      map(res => Array.isArray(res) ? res : res.results || []),
      catchError(() => of(this.getMockNotes()))
    );
  }

  // 3. Блюда
  getDishes(filters?: {
    cuisine?: string;
    dominant_taste?: string;
    weight?: string;
    fat_level?: string;
    q?: string;
  }): Observable<Dish[]> {
    let params = new HttpParams();
    if (filters?.cuisine) params = params.set('cuisine', filters.cuisine);
    if (filters?.dominant_taste) params = params.set('dominant_taste', filters.dominant_taste);
    if (filters?.weight) params = params.set('weight', filters.weight);
    if (filters?.fat_level) params = params.set('fat_level', filters.fat_level);
    if (filters?.q) params = params.set('q', filters.q);

    return this.http.get<PaginatedResponse<Dish> | Dish[]>(`${this.baseUrl}/dishes/`, { params }).pipe(
      map(res => Array.isArray(res) ? res : res.results || []),
      catchError(() => of(this.getMockDishes()))
    );
  }

  // 4. Фуд-пейринг
  getPairings(filters?: {
    brand_id?: string;
    brand_name?: string;
    dish_id?: string;
    dish_name?: string;
    pairing_type?: string;
  }): Observable<FoodPairing[]> {
    let params = new HttpParams();
    if (filters?.brand_id) params = params.set('brand_id', filters.brand_id);
    if (filters?.brand_name) params = params.set('brand_name', filters.brand_name);
    if (filters?.dish_id) params = params.set('dish_id', filters.dish_id);
    if (filters?.dish_name) params = params.set('dish_name', filters.dish_name);
    if (filters?.pairing_type) params = params.set('pairing_type', filters.pairing_type);

    return this.http.get<PaginatedResponse<FoodPairing> | FoodPairing[]>(`${this.baseUrl}/pairings/`, { params }).pipe(
      map(res => Array.isArray(res) ? res : res.results || []),
      catchError(() => of(this.getMockPairings()))
    );
  }

  // 5. Курсы и Команда
  getCourses(): Observable<Course[]> {
    return this.http.get<PaginatedResponse<Course> | Course[]>(`${this.baseUrl}/courses/`).pipe(
      map(res => Array.isArray(res) ? res : res.results || []),
      catchError(() => of(this.getMockCourses()))
    );
  }

  getTeam(): Observable<TeamMember[]> {
    return this.http.get<PaginatedResponse<TeamMember> | TeamMember[]>(`${this.baseUrl}/team/`).pipe(
      map(res => Array.isArray(res) ? res : res.results || []),
      catchError(() => of(this.getMockTeam()))
    );
  }

  // 6. Админ-эндпоинты сомелье
  saveFlavorProfiles(payload: AdminFlavorProfilePayload): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/flavor-profiles/`, payload).pipe(
      catchError(() => of({ status: 'saved_in_demo_mode', payload }))
    );
  }

  saveServingRecommendation(brandId: string, rec: ServingRecommendation): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/serving-recommendations/`, { brand_id: brandId, ...rec }).pipe(
      catchError(() => of({ status: 'saved_in_demo_mode' }))
    );
  }

  uploadBrandImage(brandId: string, file: File): Observable<Brand> {
    const formData = new FormData();
    formData.append('image', file);
    return this.http.post<Brand>(`${this.baseUrl}/brands/${brandId}/upload-image/`, formData);
  }

  // ==================== FALLBACK MOCK ДАННЫЕ ====================
  private getMockNotes(): FlavorNote[] {
    return [
      { id: 'n1', name: 'Свежесть', category: 'TOP', icon: '🌿' },
      { id: 'n2', name: 'Хмелевой аромат', category: 'TOP', icon: '🍃' },
      { id: 'n3', name: 'Цветочные ноты', category: 'TOP', icon: '🌸' },
      { id: 'n4', name: 'Солод', category: 'HEART', icon: '🌾' },
      { id: 'n5', name: 'Солодовая плотность', category: 'HEART', icon: '🍞' },
      { id: 'n6', name: 'Карамель', category: 'HEART', icon: '🍯' },
      { id: 'n7', name: 'Хмелевая горчинка', category: 'BASE', icon: '⚡' },
      { id: 'n8', name: 'Освежающий финиш', category: 'BASE', icon: '❄️' }
    ];
  }

  private getMockBrands(): Brand[] {
    return [
      {
        id: 'b1',
        name: 'Efes Pilsener',
        style: 'Pilsner',
        abv: 5.0,
        density: '12%',
        packaging_type: 'BOTTLE',
        packaging_type_display: 'Бутылка',
        is_horeca_only: false,
        is_active: true,
        description: 'Флагманская марка Efes Beer Group с благородным хмелевым ароматом и освежающим сухим финишем.',
        serving_recommendation: {
          serving_temp_min: 5,
          serving_temp_max: 7,
          glass_type: 'Пилснер / Тюльпан',
          seasonality: 'Круглый год'
        },
        pyramid: {
          top: [
            { id: 'n2', name: 'Хмелевой аромат', icon: '🍃', description: 'Свежий благородный хмель', intensity: 6, sommelier_note: 'Благородный хмель европейского типа' },
            { id: 'n3', name: 'Цветочные ноты', icon: '🌸', description: 'Тонкие луговые цветы', intensity: 4, sommelier_note: 'Изящные цветочные тона' }
          ],
          heart: [
            { id: 'n5', name: 'Солодовая плотность', icon: '🍞', description: 'Плотный солод', intensity: 6, sommelier_note: 'Полнотелый насыщенный солод' }
          ],
          base: [
            { id: 'n7', name: 'Хмелевая горчинка', icon: '⚡', description: 'Освежающая горечь', intensity: 7, sommelier_note: 'Выразительная пилснеровская горечь' },
            { id: 'n8', name: 'Освежающий финиш', icon: '❄️', description: 'Быстрое чистое завершение', intensity: 7, sommelier_note: 'Фирменное сухое послевкусие Efes' }
          ]
        }
      },
      {
        id: 'b2',
        name: 'Кружка Свежего',
        style: 'Lager (draft-style)',
        abv: 4.5,
        density: '11%',
        packaging_type: 'BOTTLE',
        packaging_type_display: 'Бутылка',
        is_horeca_only: false,
        is_active: true,
        description: 'Разливное пиво в бутылочном формате, сваренное по классическому рецепту.',
        serving_recommendation: {
          serving_temp_min: 4,
          serving_temp_max: 7,
          glass_type: 'Кружка / Пинта',
          seasonality: 'Круглый год'
        },
        pyramid: {
          top: [{ id: 'n1', name: 'Свежесть', icon: '🌿', description: 'Чистота и свежесть', intensity: 6, sommelier_note: 'Яркий свежий вдох разливного формата' }],
          heart: [{ id: 'n4', name: 'Солод', icon: '🌾', description: 'Светлый ячменный солод', intensity: 5, sommelier_note: 'Классический ячменный солод' }],
          base: [{ id: 'n8', name: 'Освежающий финиш', icon: '❄️', description: 'Чистый сход', intensity: 5, sommelier_note: 'Быстрое утоление жажды' }]
        }
      }
    ];
  }

  private getMockDishes(): Dish[] {
    return [
      { id: 'd1', name: 'Бешбармак', cuisine: 'KZ', category: 'Мясное', dominant_taste: 'UMAMI', weight: 'HEAVY', fat_level: 'HIGH', cooking_method: 'BOILED', description: 'Традиционное главное блюдо казахской кухни из отварного мяса и тонкого сочня' },
      { id: 'd2', name: 'Казы', cuisine: 'KZ', category: 'Мясное (конская колбаса)', dominant_taste: 'SALTY', weight: 'HEAVY', fat_level: 'HIGH', cooking_method: 'CURED', description: 'Деликатесная сыровяленая конская колбаса с чесноком и черным перцем' },
      { id: 'd3', name: 'Пицца Маргарита', cuisine: 'ITALIAN', category: 'Пицца', dominant_taste: 'UMAMI', weight: 'MEDIUM', fat_level: 'MEDIUM', cooking_method: 'BAKED', description: 'Классическая неаполитанская пицца с томатами, моцареллой и базиликом' },
      { id: 'd4', name: 'Братвурст (сосиски)', cuisine: 'GERMAN', category: 'Колбасы/Гриль', dominant_taste: 'SALTY', weight: 'HEAVY', fat_level: 'HIGH', cooking_method: 'GRILLED', description: 'Традиционные немецкие колбаски из свинины на гриле' }
    ];
  }

  private getMockPairings(): FoodPairing[] {
    return [
      {
        id: 'p1',
        brand: 'b1',
        brand_name: 'Efes Pilsener',
        dish: 'd2',
        dish_name: 'Казы',
        pairing_type: 'CONTRAST',
        pairing_type_display: 'Контрастирует (Contrast)',
        compatibility_score: 5,
        explanation: 'Высокая base-горечь пильзнера режет жирность вяленого мяса'
      },
      {
        id: 'p2',
        brand: 'b1',
        brand_name: 'Efes Pilsener',
        dish: 'd3',
        dish_name: 'Пицца Маргарита',
        pairing_type: 'CONTRAST',
        pairing_type_display: 'Контрастирует (Contrast)',
        compatibility_score: 4,
        explanation: 'Хмелевая горчинка режет сырную жирность'
      }
    ];
  }

  private getMockCourses(): Course[] {
    return [
      { id: 'c1', level: 1, level_display: 'Новичок', title: 'Сенсорный старт: Анатомия вкуса', description: 'Учимся различать базовые вкусы, температуру подачи и влияние бокала на аромат.' },
      { id: 'c2', level: 2, level_display: 'Исследователь', title: 'Архитектура Вкусовой Пирамиды', description: 'Разбор нот 0-3 сек (Top), 3-15 сек (Heart) и послевкусия (Base).' },
      { id: 'c3', level: 3, level_display: 'Знаток', title: 'Искусство Food Pairing', description: '4 золотых правила гастрономических пар: Complement, Contrast, Cleanse, Bridge.' },
      { id: 'c4', level: 4, level_display: 'Сомелье', title: 'Мастер Пивной Сомелье', description: 'Дефекты вкуса (off-flavours), составление дегустационных карт и сертификация.' }
    ];
  }

  private getMockTeam(): TeamMember[] {
    return [
      { id: 't1', name: 'Главный Сомелье Efes', role: 'Шеф-сомелье проекта', bio: 'Пиво — это симфония зерна, воды и хмеля, где каждая секунда глотка открывает новую главу.' }
    ];
  }
}
