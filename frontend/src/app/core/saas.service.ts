import { Injectable, computed, inject, signal } from '@angular/core';
import { DataService } from './data.service';
import { PairingService } from './pairing.service';
import { API_URL } from './config';
import {
  CabinetSession, EventKind, MenuItem, PLAN_BY_ID, Plan, PlanLimits, Stats, TableRow, TrackPayload,
  VenueMenu, VenuePublic,
} from './saas.models';

const LS = { session: 'ft.saas.session', menus: 'ft.saas.menus', venues: 'ft.saas.venues',
             accounts: 'ft.saas.accounts', tables: 'ft.saas.tables', events: 'ft.saas.events',
             seeded: 'ft.saas.seeded.v3', guest: 'ft.saas.guest' } as const;

const DEMO_PASSWORD = 'flavor2026';
const TRIAL_LIMITS: PlanLimits = { tables: 5, items: 40, history_days: 14, branding: false, price_kzt: 0 };
const PLAN_LABEL: Record<Plan, string> = { TRIAL: 'Пробный', START: 'Старт', PRO: 'Про', NETWORK: 'Сеть' };
// Цены под рынок Казахстана, ₸ — те же диапазоны, что в backend/api/management/commands/seed_saas.py
const BEER_PRICE: Record<string, [number, number]> = { DRAFT: [1400, 2200], BOTTLE: [900, 1600], CAN: [1100, 1700] };
const DISH_PRICE: Record<string, [number, number]> = { LIGHT: [900, 1800], MEDIUM: [1800, 3200], HEAVY: [2900, 5200] };
const VOLUME: Record<string, string> = { DRAFT: '0.5 л', BOTTLE: '0.45 л', CAN: '0.5 л' };

interface LocalAccount { email: string; password: string; venueSlug: string; plan: Plan; activeUntil: string; }
interface LocalEvent { venue: string; kind: EventKind; dish: string; beer: string; score: number | null; price: number; table: number | null; session: string; ts: string; }

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим — молча */ }
}
/** Детерминированный ГПСЧ: цены в демо не прыгают между перезагрузками. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function priceIn([lo, hi]: [number, number], r: () => number): number {
  const steps = Math.floor((hi - lo) / 50);
  return lo + Math.floor(r() * steps) * 50;
}
function uid(): string { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

/**
 * Слой заведений: кабинет, карта с ценами, аналитика.
 * API_URL задан → работает с Django. Не задан → полностью локально (демо на Vercel:
 * бар видит живой кабинет с цифрами, не требуя развёрнутого бэкенда).
 */
@Injectable({ providedIn: 'root' })
export class SaasService {
  private data = inject(DataService);
  private pairing = inject(PairingService);
  readonly mode: 'api' | 'local' = API_URL ? 'api' : 'local';
  readonly session = signal<CabinetSession | null>(read<CabinetSession | null>(LS.session, null));
  readonly authed = computed(() => !!this.session());

  constructor() { if (this.mode === 'local') this.seedOnce(); }

  // ──────────────────────────────── гостевое меню ────────────────────────────────

  async loadMenu(slug: string, table?: number | null): Promise<VenueMenu | null> {
    if (this.mode === 'api') {
      const q = table ? `?table=${table}` : '';
      const res = await fetch(`${API_URL}/menu/${slug}/${q}`).catch(() => null);
      if (res?.ok) return res.json();
      if (res && res.status !== 404) return null;
    }
    return this.localMenu(slug, table ?? null);
  }

  localMenu(slug: string, table: number | null): VenueMenu | null {
    const venue = this.localVenue(slug);
    if (!venue) return null;
    const items = this.localItems(slug).filter(i => i.is_available);
    return { venue, table, beers: items.filter(i => i.kind === 'BEER'), dishes: items.filter(i => i.kind === 'DISH') };
  }

  // ──────────────────────────────── трекинг ────────────────────────────────

  /** Сессия гостя нужна, чтобы «сколько гостей» отличалось от «сколько сканов». */
  guestSession(): string {
    let id = read<string>(LS.guest, '');
    if (!id) { id = uid(); write(LS.guest, id); }
    return id;
  }

  track(payload: TrackPayload): void {
    const body = { ...payload, session: payload.session ?? this.guestSession() };
    if (this.mode === 'api') {
      fetch(`${API_URL}/track/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .catch(() => { /* аналитика не должна ломать меню гостю */ });
      return;
    }
    const events = read<LocalEvent[]>(LS.events, []);
    events.push({ venue: body.venue, kind: body.kind, dish: body.dish || '', beer: body.beer || '',
                  score: body.score ?? null, price: body.price || 0, table: body.table ?? null,
                  session: body.session!, ts: new Date().toISOString() });
    write(LS.events, events.slice(-4000));
  }

  // ──────────────────────────────── кабинет: вход ────────────────────────────────

  async login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
    if (this.mode === 'api') {
      const res = await this.post('/cabinet/login/', { email, password });
      if (!res.ok) return { ok: false, error: res.data?.detail || 'Не удалось войти' };
      this.setSession(res.data as CabinetSession);
      return { ok: true };
    }
    const account = read<LocalAccount[]>(LS.accounts, []).find(a => a.email === email.trim().toLowerCase());
    if (!account || account.password !== password) return { ok: false, error: 'Неверный e-mail или пароль' };
    this.setSession(this.sessionFor(account));
    return { ok: true };
  }

  async register(form: { email: string; password: string; venue_name: string; city?: string; address?: string; phone?: string; contact_name?: string; tables?: number }):
    Promise<{ ok: boolean; error?: string }> {
    if (this.mode === 'api') {
      const res = await this.post('/cabinet/register/', form);
      if (!res.ok) return { ok: false, error: res.data?.detail || 'Не удалось зарегистрироваться' };
      this.setSession(res.data as CabinetSession);
      return { ok: true };
    }
    const email = form.email.trim().toLowerCase();
    const accounts = read<LocalAccount[]>(LS.accounts, []);
    if (accounts.some(a => a.email === email)) return { ok: false, error: 'Такой e-mail уже зарегистрирован' };

    const slug = this.uniqueSlug(form.venue_name);
    const venues = read<VenuePublic[]>(LS.venues, []);
    venues.push({
      slug, name: form.venue_name, city: form.city || '', address: form.address || '', venue_type: 'BAR',
      description: '', logo: '', cover: '', accent: '#F7941D', phone: form.phone || '', instagram: '', wifi: '',
      headline: 'Что взять к вашему блюду?', currency: '₸', branding: false, plan: 'TRIAL',
    });
    write(LS.venues, venues);

    const trialEnd = new Date(Date.now() + 14 * 864e5).toISOString();
    const account: LocalAccount = { email, password: form.password, venueSlug: slug, plan: 'TRIAL', activeUntil: trialEnd };
    accounts.push(account);
    write(LS.accounts, accounts);
    this.addTablesLocal(slug, Math.min(form.tables || 5, TRIAL_LIMITS.tables));
    this.setSession(this.sessionFor(account));
    return { ok: true };
  }

  logout(): void {
    this.session.set(null);
    try { localStorage.removeItem(LS.session); } catch { /* ignore */ }
  }

  // ──────────────────────────────── кабинет: карта ────────────────────────────────

  async menu(): Promise<{ beers: MenuItem[]; dishes: MenuItem[]; limit: number; used: number }> {
    const s = this.session();
    if (!s) return { beers: [], dishes: [], limit: 0, used: 0 };
    if (this.mode === 'api') {
      const res = await this.get('/cabinet/menu/');
      if (res.ok) return res.data;
    }
    const items = this.localItems(s.venue.slug);
    return { beers: items.filter(i => i.kind === 'BEER'), dishes: items.filter(i => i.kind === 'DISH'),
             limit: s.limits.items, used: items.length };
  }

  async saveItems(rows: Partial<MenuItem>[]): Promise<{ ok: boolean; skipped: number }> {
    const s = this.session();
    if (!s || !rows.length) return { ok: false, skipped: 0 };
    if (this.mode === 'api') {
      const res = await this.post('/cabinet/menu/', { items: rows });
      return { ok: res.ok, skipped: res.data?.skipped_over_limit || 0 };
    }
    const all = this.localItems(s.venue.slug);
    let skipped = 0;
    for (const row of rows) {
      if (!row.kind || !row.ref_slug) continue;
      const found = all.find(i => i.kind === row.kind && i.ref_slug === row.ref_slug);
      if (found) { Object.assign(found, row); continue; }
      if (all.length >= s.limits.items) { skipped++; continue; }
      all.push({ id: uid(), kind: row.kind, ref_slug: row.ref_slug, name: row.name || '', description: row.description || '',
                 category: row.category || '', price: row.price || 0, volume: row.volume || '',
                 is_available: row.is_available ?? true, is_featured: row.is_featured ?? false, sort_order: row.sort_order ?? all.length });
    }
    this.writeItems(s.venue.slug, all);
    return { ok: true, skipped };
  }

  async removeItem(id: string): Promise<boolean> {
    const s = this.session();
    if (!s) return false;
    if (this.mode === 'api') return (await this.del(`/cabinet/menu/${id}/`)).ok;
    this.writeItems(s.venue.slug, this.localItems(s.venue.slug).filter(i => i.id !== id));
    return true;
  }

  // ──────────────────────────────── кабинет: столы ────────────────────────────────

  async tables(): Promise<{ tables: TableRow[]; limit: number }> {
    const s = this.session();
    if (!s) return { tables: [], limit: 0 };
    if (this.mode === 'api') {
      const res = await this.get('/cabinet/tables/');
      if (res.ok) return res.data;
    }
    return { tables: this.localTables(s.venue.slug), limit: s.limits.tables };
  }

  async addTables(count: number): Promise<{ ok: boolean; error?: string }> {
    const s = this.session();
    if (!s) return { ok: false };
    if (this.mode === 'api') {
      const res = await this.post('/cabinet/tables/', { tables: count });
      return res.ok ? { ok: true } : { ok: false, error: res.data?.detail || 'Не удалось добавить столы' };
    }
    const have = this.localTables(s.venue.slug).length;
    const allowed = Math.min(count, s.limits.tables - have);
    if (allowed <= 0) return { ok: false, error: `Лимит тарифа — ${s.limits.tables} столов` };
    this.addTablesLocal(s.venue.slug, allowed);
    return { ok: true };
  }

  async removeTable(id: string): Promise<boolean> {
    const s = this.session();
    if (!s) return false;
    if (this.mode === 'api') return (await this.del(`/cabinet/tables/${id}/`)).ok;
    this.writeTables(s.venue.slug, this.localTables(s.venue.slug).filter(t => t.id !== id));
    return true;
  }

  // ──────────────────────────────── кабинет: брендинг ────────────────────────────────

  async saveVenue(patch: Partial<VenuePublic>): Promise<boolean> {
    const s = this.session();
    if (!s) return false;
    if (this.mode === 'api') {
      const res = await this.request('PATCH', '/cabinet/venue/', patch);
      if (res.ok) this.setSession({ ...s, venue: res.data.venue });
      return res.ok;
    }
    const venues = read<VenuePublic[]>(LS.venues, []);
    const idx = venues.findIndex(v => v.slug === s.venue.slug);
    const base = idx >= 0 ? venues[idx] : s.venue;
    const allowed: Partial<VenuePublic> = { ...patch };
    if (!s.limits.branding) { delete allowed.accent; delete allowed.logo; delete allowed.cover; }
    const next = { ...base, ...allowed };
    if (idx >= 0) venues[idx] = next; else venues.push(next);
    write(LS.venues, venues);
    this.setSession({ ...s, venue: next });
    return true;
  }

  // ──────────────────────────────── кабинет: аналитика ────────────────────────────────

  async stats(days = 30): Promise<Stats | null> {
    const s = this.session();
    if (!s) return null;
    if (this.mode === 'api') {
      const res = await this.get(`/cabinet/stats/?days=${days}`);
      if (res.ok) return res.data;
    }
    return this.localStats(s.venue.slug, Math.min(days, s.limits.history_days));
  }

  private localStats(slug: string, days: number): Stats {
    const since = Date.now() - days * 864e5;
    const events = read<LocalEvent[]>(LS.events, []).filter(e => e.venue === slug && Date.parse(e.ts) >= since);
    const scans = events.filter(e => e.kind === 'SCAN');
    const intents = events.filter(e => e.kind === 'ORDER_INTENT');

    const byDay = new Map<string, number>();
    for (const e of scans) { const d = e.ts.slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + 1); }
    const series: { date: string; scans: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      series.push({ date: d, scans: byDay.get(d) || 0 });
    }
    const top = (rows: LocalEvent[], key: 'dish' | 'beer') => {
      const m = new Map<string, number>();
      for (const e of rows) { const v = e[key]; if (v) m.set(v, (m.get(v) || 0) + 1); }
      return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s2, count]) => ({ slug: s2, count }));
    };
    const pairs = new Map<string, number>();
    for (const e of intents) if (e.dish && e.beer) pairs.set(`${e.dish}|${e.beer}`, (pairs.get(`${e.dish}|${e.beer}`) || 0) + 1);

    const revenue = intents.reduce((s2, e) => s2 + e.price, 0);
    return {
      days, scans: scans.length,
      guests: new Set(scans.map(e => e.session)).size,
      pair_views: events.filter(e => e.kind === 'PAIR_VIEW').length,
      order_intents: intents.length,
      conversion: scans.length ? Math.round(intents.length / scans.length * 1000) / 10 : 0,
      revenue_intent_kzt: revenue,
      avg_check_add_kzt: intents.length ? Math.round(revenue / intents.length) : 0,
      series,
      top_dishes: top(events.filter(e => e.kind === 'DISH_VIEW' || e.kind === 'PAIR_VIEW'), 'dish'),
      top_beers: top(intents, 'beer'),
      top_pairs: [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, count]) => ({ dish: k.split('|')[0], beer: k.split('|')[1], count })),
      tables: this.localTables(slug).sort((a, b) => b.scans - a.scans).slice(0, 12),
    };
  }

  // ──────────────────────────────── HTTP ────────────────────────────────

  private headers(): Record<string, string> {
    const token = this.session()?.token;
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }
  private async request(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
    try {
      const res = await fetch(`${API_URL}${path}`, { method, headers: this.headers(), body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) this.logout();
      return { ok: res.ok, data };
    } catch { return { ok: false, data: {} }; }
  }
  private get(path: string) { return this.request('GET', path); }
  private post(path: string, body: unknown) { return this.request('POST', path, body); }
  private del(path: string) { return this.request('DELETE', path); }

  // ──────────────────────────────── локальное хранилище ────────────────────────────────

  private setSession(s: CabinetSession): void { this.session.set(s); write(LS.session, s); }

  private sessionFor(account: LocalAccount): CabinetSession {
    const venue = this.localVenue(account.venueSlug)!;
    const limits = account.plan === 'TRIAL' ? TRIAL_LIMITS : (PLAN_BY_ID[account.plan]?.limits ?? TRIAL_LIMITS);
    const daysLeft = Math.max(0, Math.ceil((Date.parse(account.activeUntil) - Date.now()) / 864e5));
    return { token: `local-${account.email}`, venue: { ...venue, plan: account.plan, branding: limits.branding },
             plan: account.plan, plan_label: PLAN_LABEL[account.plan], limits, days_left: daysLeft,
             active: daysLeft > 0, active_until: account.activeUntil, email: account.email };
  }

  private localVenue(slug: string): VenuePublic | null {
    const stored = read<VenuePublic[]>(LS.venues, []).find(v => v.slug === slug);
    if (stored) return stored;
    const base = this.data.venues().find(v => v.id === slug);
    if (!base) return null;
    return { slug: base.id, name: base.name, city: base.city, address: base.address, venue_type: base.venue_type,
             description: base.description, logo: '', cover: '', accent: '#F7941D', phone: '', instagram: '', wifi: '',
             headline: 'Что взять к вашему блюду?', currency: '₸', branding: true, plan: 'START' };
  }

  private uniqueSlug(name: string): string {
    const translit: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
    const base = name.toLowerCase().split('').map(c => translit[c] ?? c).join('')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || `venue-${uid().slice(0, 5)}`;
    const taken = new Set([...read<VenuePublic[]>(LS.venues, []).map(v => v.slug), ...this.data.venues().map(v => v.id)]);
    let slug = base, i = 2;
    while (taken.has(slug)) slug = `${base}-${i++}`;
    return slug;
  }

  private localItems(slug: string): MenuItem[] {
    const menus = read<Record<string, MenuItem[]>>(LS.menus, {});
    return menus[slug] ? menus[slug] : [];
  }
  private writeItems(slug: string, items: MenuItem[]): void {
    const menus = read<Record<string, MenuItem[]>>(LS.menus, {});
    menus[slug] = items;
    write(LS.menus, menus);
  }
  private localTables(slug: string): TableRow[] {
    const all = read<Record<string, TableRow[]>>(LS.tables, {});
    return all[slug] ? all[slug] : [];
  }
  private writeTables(slug: string, rows: TableRow[]): void {
    const all = read<Record<string, TableRow[]>>(LS.tables, {});
    all[slug] = rows;
    write(LS.tables, all);
  }
  private addTablesLocal(slug: string, count: number): void {
    const rows = this.localTables(slug);
    const prefix = rows[0]?.token.split('-')[0]
      ?? (this.data.venues().find(v => v.id === slug)?.token_prefix ?? slug.slice(0, 3).toUpperCase());
    let n = rows.length ? Math.max(...rows.map(t => t.number)) + 1 : 1;
    for (let i = 0; i < count; i++, n++) {
      rows.push({ id: uid(), number: n, label: `Стол ${n}`, token: `${prefix}-${String(n).padStart(2, '0')}`,
                  scans: 0, is_active: true, last_scan_at: null });
    }
    this.writeTables(slug, rows);
  }

  /** Демо-заведения с картой, ценами, столами и 30 днями истории — чтобы кабинет не выглядел пустым. */
  private seedOnce(): void {
    if (read<boolean>(LS.seeded, false)) return;
    const accounts: LocalAccount[] = read<LocalAccount[]>(LS.accounts, []);
    const events: LocalEvent[] = read<LocalEvent[]>(LS.events, []);
    const brandById = this.data.brandById();
    const dishById = this.data.dishById();

    this.data.venues().forEach((v, vi) => {
      const r = rng(v.id);
      const items: MenuItem[] = [];
      v.brands.forEach((slug, i) => {
        const b = brandById[slug];
        if (!b) return;
        const pack = b.packaging_type || 'BOTTLE';
        items.push({ id: uid(), kind: 'BEER', ref_slug: slug, name: '', description: '',
                     category: pack === 'DRAFT' ? 'Разливное' : 'Бутылка и банка',
                     price: priceIn(BEER_PRICE[pack] ?? BEER_PRICE['BOTTLE'], r), volume: VOLUME[pack] ?? '0.5 л',
                     is_available: true, is_featured: i < 2, sort_order: i });
      });
      v.menu.forEach((slug, i) => {
        const d = dishById[slug];
        if (!d) return;
        items.push({ id: uid(), kind: 'DISH', ref_slug: slug, name: '', description: '', category: d.category || 'Основное',
                     price: priceIn(DISH_PRICE[d.weight] ?? DISH_PRICE['MEDIUM'], r), volume: '',
                     is_available: true, is_featured: i < 3, sort_order: i });
      });
      this.writeItems(v.id, items);
      this.addTablesLocal(v.id, v.tables);

      const plan: Plan = vi === 0 ? 'PRO' : 'START';
      accounts.push({ email: `${v.id.split('-')[0]}@demo.flavortree.kz`, password: DEMO_PASSWORD, venueSlug: v.id,
                      plan, activeUntil: new Date(Date.now() + (60 + vi * 40) * 864e5).toISOString() });

      // история: 30 дней, вечерний пик, треть гостей жмёт «Заказать»
      const beers = items.filter(i => i.kind === 'BEER');
      const dishes = items.filter(i => i.kind === 'DISH');
      const tables = this.localTables(v.id);
      const perDay = 3 + Math.floor(r() * 5);
      const beerSlugs = beers.map(b => b.ref_slug);
      const beerBySlug = Object.fromEntries(beers.map(b => [b.ref_slug, b]));
      // гости заказывают то, что советует движок: топ-1 чаще, топ-2 реже, иногда — что-то своё
      const pickBeer = (dishSlug: string): MenuItem | undefined => {
        const top = this.pairing.forDish(dishSlug, {}, { venueBrands: beerSlugs, limit: 3 });
        const x = r();
        const pick = x < .58 ? top[0] : x < .85 ? top[1] : top[2];
        return (pick && beerBySlug[pick.beer_id]) || beers[Math.floor(r() * beers.length)];
      };
      let session = '';
      for (let day = 29; day >= 0; day--) {
        const weekend = [5, 6].includes(new Date(Date.now() - day * 864e5).getDay());
        const n = Math.max(1, Math.round(perDay * (weekend ? 1.7 : 1) * (0.6 + r())));
        for (let k = 0; k < n; k++) {
          const ts = new Date(Date.now() - day * 864e5 - Math.floor(r() * 6) * 36e5).toISOString();
          const table = tables[Math.floor(r() * tables.length)];
          if (!session || r() > .22) session = `demo-${day}-${k}-${vi}`;   // ~22% — тот же гость открыл меню ещё раз
          const dish = dishes[Math.min(dishes.length - 1, Math.floor(Math.pow(r(), 1.8) * dishes.length))];   // хиты открывают чаще
          const beer = dish ? pickBeer(dish.ref_slug) : undefined;
          if (!dish || !beer || !table) continue;
          const base: Omit<LocalEvent, 'kind' | 'price'> = { venue: v.id, dish: '', beer: '', score: null, table: table.number, session, ts };
          events.push({ ...base, kind: 'SCAN', price: 0 });
          events.push({ ...base, kind: 'DISH_VIEW', dish: dish.ref_slug, price: 0 });
          events.push({ ...base, kind: 'PAIR_VIEW', dish: dish.ref_slug, beer: beer.ref_slug, score: 72 + Math.floor(r() * 24), price: 0 });
          if (r() < 0.34) events.push({ ...base, kind: 'ORDER_INTENT', dish: dish.ref_slug, beer: beer.ref_slug, score: 88, price: beer.price });
          table.scans++;
        }
      }
      this.writeTables(v.id, tables);
    });

    write(LS.accounts, accounts);
    write(LS.events, events.slice(-4000));
    write(LS.seeded, true);
  }
}
