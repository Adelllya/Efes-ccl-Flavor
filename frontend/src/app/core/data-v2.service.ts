import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import dishesJson from '../../../../data/dishes_v2.json';
import engineJson from '../../../../data/engine_v2_spa.json';
import {
  ClassicIndex, ClassicPair, DishProfile, DishRecord, DrinkProfile, DrinkRecord, ParamsV2,
  dishVector, drinkVector, indexClassics, mergeParams, setDefaultParams,
} from '../engine/pairing-engine-v2';
import { I18nService } from './i18n.service';

/** Запись каталога для SPA (data/drinks_v2_spa.json — лёгкая версия data/drinks.json). */
export interface DrinkV2 extends DrinkRecord {
  id: string;
  name: string;
  category: string;
  style?: { archetype?: string | null; name?: string | null; family?: string | null; bjcp_code?: string | null } | null;
  /** 14 осей 0..1 (serve_temp — °C); в каталоге всегда числа */
  sensory?: Readonly<Record<string, number>> | null;
  aroma_tags?: Readonly<Record<string, number>> | null;
  serving?: { temp_min_c?: number | null; temp_max_c?: number | null; glass?: string; ice?: string; garnish?: string } | null;
  producer?: { name?: string; group?: string; country?: string };
  efes_relation?: string;
  abv?: number | null;
  abv_source?: string;
  ibu?: number | null;
  ibu_source?: string;
  vector_source?: string;
  vector_confidence?: number;
  availability_kz?: { level?: string };
  price_kzt?: { retail_min?: number; retail_max?: number; horeca?: number; unit_ml?: number; is_estimate?: boolean };
  image?: string | null;
  legacy_brand_id?: string;
  description?: string;
  status?: string;
  occasions?: string[];
  flags?: { non_alcoholic?: boolean | null; abv_unknown?: boolean; [k: string]: unknown } | null;
}

/** Полная запись (data/drinks.json): + откуда числа, источники, цены, наличие. */
export interface DrinkFull extends DrinkV2 {
  vector_notes?: string[];
  sources?: { url: string; title?: string; what?: string[]; accessed?: string }[];
  availability_kz?: { level?: string; channels?: string[]; cities?: string[]; last_checked?: string; note?: string };
  price_kzt?: DrinkV2['price_kzt'] & { as_of?: string; source?: string; raw?: string };
}

export interface DishV2 extends DishRecord {
  id: string;
  name: string;
  display_name?: string;
  emoji?: string;
  category?: string;
  description?: string;
  synonyms?: string[];
  cuisine?: string[];
  vector: Record<string, number>;
}

interface EngineBundle {
  params: ParamsV2;
  calibration: null | {
    version?: string; fitted_at?: string; lambda?: number | null;
    metrics?: {
      train?: { literature: number[]; calibrated: number[] };
      holdout?: { literature: number[]; calibrated: number[] };
      cv?: { literature: number[]; calibrated: number[] };
      ordinals?: number[];
      matrix?: Record<string, number>;
    };
    data?: { pairs_train?: number; pairs_holdout?: number; ordinals?: number };
  };
  calibration_params: Record<string, number>;
  classics: ClassicPair[];
  classics_source: string;
  calibration_candidate?: null | {
    version?: string; fitted_at?: string; lambda?: number | null; params_changed?: number;
    metrics?: NonNullable<EngineBundle['calibration']>['metrics'];
    decision?: { applied?: boolean; why?: string; holdout_changes?: { lost?: string[]; gained?: string[]; mcnemar_p?: number } };
  };
}

/** Группы вкладок подбора: категории движка сведены в понятные гостю разделы. */
export const TAB_GROUPS: readonly { id: string; categories: readonly string[] }[] = [
  { id: 'beer', categories: ['beer', 'radler'] },
  { id: 'na', categories: ['na_beer', 'kvass', 'lemonade', 'soda', 'dairy', 'tea', 'coffee', 'water'] },
  { id: 'cider', categories: ['cider'] },
  { id: 'wine', categories: ['wine', 'sparkling', 'fortified'] },
  { id: 'cocktail', categories: ['cocktail'] },
  { id: 'spirit', categories: ['spirit', 'liqueur'] },
];

/** Попадает ли напиток в подбор для гостя (как dataset_v2.is_guest_visible на сервере, ENGINE_V2_SPEC §8.3). */
export function isGuestVisible(d: DrinkV2): boolean {
  return d.status !== 'draft' && d.availability_kz?.level !== 'not_confirmed';
}

/**
 * Данные движка v2 в браузере. Блюда и параметры (литература + слой калибровки, те же числа, что на сервере) —
 * в основном бандле; каталог напитков (≈ 45 КБ gzip) подгружается при первом подборе, полный каталог с
 * источниками — только на странице напитка.
 */
@Injectable({ providedIn: 'root' })
export class DataV2Service {
  private readonly bundle = engineJson as unknown as EngineBundle;
  readonly params: ParamsV2 = this.bundle.params;
  readonly calibration = this.bundle.calibration;
  readonly calibrationParams = this.bundle.calibration_params;
  /** Попытка калибровки, которая не прошла проверку на отложенных парах и не применяется (честно показываем её итог). */
  readonly calibrationCandidate = this.bundle.calibration_candidate ?? null;
  readonly classics: ClassicIndex = indexClassics(this.bundle.classics);
  readonly classicsList: readonly ClassicPair[] = this.bundle.classics;

  private i18n = inject(I18nService);
  /** Слои текстов движка на kk/en (data/engine_v2_texts_{kk,en}.json): только слова, числа не меняются (scripts/check_engine_texts.py). */
  private readonly textOverlays = signal<Partial<Record<'kk' | 'en', Record<string, unknown>>>>({});
  /** Параметры для языка гостя: литература + калибровка (params) + слой текстов. Профили строятся с ними же —
   *  слова вроде «жир баранины» вшиваются в профиль при построении, поэтому на kk/en профили свои. */
  readonly activeParams = computed<ParamsV2>(() => {
    const loc = this.i18n.locale();
    const ov = loc === 'ru' ? undefined : this.textOverlays()[loc];
    return ov ? mergeParams(this.params, ov) : this.params;
  });

  readonly dishes = signal<DishV2[]>(dishesJson as unknown as DishV2[]);
  readonly drinks = signal<DrinkV2[] | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly dishById = computed(() => new Map(this.dishes().map(d => [d.id, d])));
  /** Блюдо для движка на языке гостя: название попадает только в тексты причин («…жирность «Бешбармака»…»), на балл не влияет. */
  forEngine<T extends { id?: unknown; name?: unknown; display_name?: unknown }>(d: T): T {
    if (this.i18n.locale() === 'ru' || typeof d.id !== 'string' || d.id === 'custom') return d;
    const ru = String(d.display_name || d.name || d.id);
    const local = this.i18n.dishNameById(d.id, ru);
    return local === ru ? d : { ...d, display_name: local };
  }
  readonly dishProfiles = computed<DishProfile[]>(() => { const P = this.activeParams(); return this.dishes().map(d => dishVector(this.forEngine(d), P)); });
  readonly dishProfileById = computed(() => new Map(this.dishProfiles().map(p => [p.id, p])));
  readonly drinkById = computed(() => new Map((this.drinks() ?? []).map(d => [d.id, d])));
  readonly drinkProfiles = computed<DrinkProfile[]>(() => { const P = this.activeParams(); return (this.drinks() ?? []).map(d => drinkVector(d, P)); });
  readonly drinkProfileById = computed(() => new Map(this.drinkProfiles().map(p => [p.id, p])));
  /** Пул подбора: без черновиков и позиций с неподтверждённым наличием. */
  readonly guestPool = computed<DrinkProfile[]>(() => {
    const byId = this.drinkById();
    return this.drinkProfiles().filter(p => { const d = byId.get(p.id); return !!d && isGuestVisible(d); });
  });
  readonly stats = computed(() => {
    const list = this.drinks() ?? [];
    return {
      drinks: list.length,
      nonEfes: list.filter(d => (d.efes_relation ?? 'none') === 'none').length,
      dishes: this.dishes().length,
      inPairing: list.filter(isGuestVisible).length,
    };
  });

  private drinksPromise: Promise<DrinkV2[]> | null = null;
  private fullPromise: Promise<Map<string, DrinkFull>> | null = null;

  constructor() {
    setDefaultParams(this.params);
    effect(() => {
      const loc = this.i18n.locale();
      if (loc !== 'ru' && !untracked(() => this.textOverlays()[loc])) this.loadTexts(loc);
    });
  }

  private loadTexts(loc: 'kk' | 'en'): void {
    const imp = loc === 'kk' ? import('../../../../data/engine_v2_texts_kk.json') : import('../../../../data/engine_v2_texts_en.json');
    imp.then(m => {
      const ov = (m.default ?? m) as unknown as Record<string, unknown>;
      this.textOverlays.update(o => ({ ...o, [loc]: ov }));
    }).catch(() => { /* нет слоя — объяснения остаются русскими, баллы те же */ });
  }

  /** Каталог напитков (лёгкий) — один раз на сессию. */
  ensureDrinks(): Promise<DrinkV2[]> {
    if (!this.drinksPromise) {
      this.loading.set(true);
      this.drinksPromise = import('../../../../data/drinks_v2_spa.json').then(m => {
        const list = ((m.default ?? m) as unknown as { drinks: DrinkV2[] }).drinks;
        this.drinks.set(list);
        this.loading.set(false);
        return list;
      }).catch(err => {
        this.loading.set(false);
        this.error.set('Не удалось загрузить каталог напитков');
        this.drinksPromise = null;
        throw err;
      });
    }
    return this.drinksPromise;
  }

  /** Полная запись напитка с источниками и заметками о расчёте профиля (грузит data/drinks.json ≈ 1.2 МБ один раз). */
  async fullDrink(id: string): Promise<DrinkFull | null> {
    if (!this.fullPromise) {
      this.fullPromise = import('../../../../data/drinks.json').then(m => {
        const list = (m.default ?? m) as unknown as DrinkFull[];
        return new Map(list.map(d => [d.id, d]));
      }).catch(err => { this.fullPromise = null; throw err; });
    }
    return (await this.fullPromise).get(id) ?? null;
  }

  dish(id: string): DishV2 | undefined { return this.dishById().get(id); }
  drink(id: string): DrinkV2 | undefined { return this.drinkById().get(id); }

  /** Поиск блюда по названию, синонимам, категории и кухне (ё → е, по началу слов) — как PairingService.searchDishes в v1. */
  searchDishes(query: string, limit = 8): { dish: DishV2; score: number }[] {
    const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
    const q = norm(query.trim());
    if (!q) return [];
    const tokens = q.split(/[\s,]+/).filter(t => t.length >= 2);
    if (!tokens.length) return [];
    const hits: { dish: DishV2; score: number }[] = [];
    for (const d of this.dishes()) {
      const hay = [d.name, d.display_name ?? '', ...(d.synonyms ?? []), d.category ?? '', ...(d.cuisine ?? []).map(c => CUISINE_RU[c] ?? c)]
        .filter(Boolean).map(norm);
      let score = 0;
      for (const t of tokens) {
        for (const h of hay) {
          if (h === t) score += 10;
          else if (h.startsWith(t)) score += 6;
          else if (t.length >= 3 && h.split(/[\s()]+/).some(w => w.startsWith(t))) score += 4;
          else if (t.length >= 4 && h.includes(t)) score += 3;
          else if (t.length >= 5 && h.split(/[\s()]+/).some(w => w.startsWith(t.slice(0, 4)))) score += 1;
        }
      }
      if (score > 0) hits.push({ dish: d, score });
    }
    return hits.sort((a, b) => b.score - a.score || a.dish.name.localeCompare(b.dish.name, 'ru')).slice(0, limit);
  }
}

/** Русские названия кухонь для поиска (полный словарь ru/kk/en — core/cuisines-v2.ts). */
const CUISINE_RU: Record<string, string> = {
  kazakh: 'казахская', central_asian: 'среднеазиатская', uyghur: 'уйгурская', russian: 'русская', ukrainian: 'украинская',
  caucasian: 'кавказская', turkish: 'турецкая', tatar: 'татарская', german: 'немецкая', bavarian: 'баварская', austrian: 'австрийская',
  czech: 'чешская', belgian: 'бельгийская', english: 'английская', irish: 'ирландская', french: 'французская', italian: 'итальянская',
  spanish: 'испанская', greek: 'греческая', japanese: 'японская', chinese: 'китайская', korean: 'корейская', thai: 'тайская',
  vietnamese: 'вьетнамская', indian: 'индийская', mexican: 'мексиканская', american: 'американская', argentinian: 'аргентинская',
  international: 'интернациональная',
};
