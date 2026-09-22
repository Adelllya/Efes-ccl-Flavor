import { Injectable, computed, inject, signal } from '@angular/core';
import { DataService } from './data.service';
import { Venue } from './models';

export interface VenueSession { venue: Venue; table: number; token: string; since: string; }
const KEY = 'ft.venue';

/** HoReCa-контекст: гость отсканировал QR на столе → подбор ограничен картой заведения. */
@Injectable({ providedIn: 'root' })
export class VenueService {
  private data = inject(DataService);
  readonly session = signal<VenueSession | null>(this.load());
  readonly venue = computed(() => this.session()?.venue ?? null);
  readonly brandIds = computed<string[] | null>(() => this.venue()?.brands ?? null);
  readonly menuIds = computed<string[] | null>(() => this.venue()?.menu ?? null);

  /** Токен вида EBG-05 → заведение по префиксу + стол. */
  resolve(token: string): VenueSession | null {
    const m = /^([A-Za-z0-9]+)-(\d{1,3})$/.exec(token.trim());
    if (!m) return null;
    const venue = this.data.venues().find(v => v.token_prefix.toUpperCase() === m[1].toUpperCase());
    if (!venue) return null;
    const s: VenueSession = { venue, table: parseInt(m[2], 10), token: token.toUpperCase(), since: new Date().toISOString() };
    this.session.set(s);
    try { sessionStorage.setItem(KEY, JSON.stringify({ token: s.token })); } catch { /* ignore */ }
    return s;
  }
  clear(): void { this.session.set(null); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }

  private load(): VenueSession | null {
    try {
      const raw = sessionStorage.getItem(KEY); if (!raw) return null;
      const { token } = JSON.parse(raw);
      const m = /^([A-Za-z0-9]+)-(\d{1,3})$/.exec(token);
      const venue = m && this.data.venues().find(v => v.token_prefix.toUpperCase() === m[1].toUpperCase());
      return venue && m ? { venue, table: parseInt(m[2], 10), token, since: '' } : null;
    } catch { return null; }
  }
}
