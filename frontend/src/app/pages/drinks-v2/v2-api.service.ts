import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import { API_BASE } from '../../services/api.service';
import { V2Dish, V2Drink, V2DrinkDetail, V2Meta, V2PairingResult } from './v2.models';

/** Подбор v2: весь каталог напитков и блюд грузится один раз за сессию. */
@Injectable({ providedIn: 'root' })
export class V2ApiService {
  private http = inject(HttpClient);
  private base = `${API_BASE}/v2`;

  private meta$?: Observable<V2Meta>;
  private dishes$?: Observable<V2Dish[]>;
  private drinks$?: Observable<V2Drink[]>;

  meta(): Observable<V2Meta> {
    return this.meta$ ??= this.http.get<V2Meta>(`${this.base}/meta/`).pipe(shareReplay(1));
  }

  dishes(): Observable<V2Dish[]> {
    return this.dishes$ ??= this.http.get<{ results: V2Dish[] }>(`${this.base}/dishes/`)
      .pipe(map(r => r.results), shareReplay(1));
  }

  drinks(): Observable<V2Drink[]> {
    return this.drinks$ ??= this.http.get<{ results: V2Drink[] }>(`${this.base}/drinks/`, { params: { limit: 500 } })
      .pipe(map(r => r.results), shareReplay(1));
  }

  pairingForDish(dishId: string, top = 5): Observable<V2PairingResult> {
    const params = new HttpParams().set('top', top);
    return this.http.get<V2PairingResult>(`${this.base}/pairing/dish/${encodeURIComponent(dishId)}/`, { params });
  }

  drinkDetail(drinkId: string, top = 5): Observable<V2DrinkDetail> {
    const params = new HttpParams().set('top', top);
    return this.http.get<V2DrinkDetail>(`${this.base}/drinks/${encodeURIComponent(drinkId)}/`, { params });
  }
}
