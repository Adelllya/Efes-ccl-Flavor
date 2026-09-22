/** Типы платного слоя: карта заведения, кабинет, аналитика. Зеркалят api/views_saas.py. */

export type ItemKind = 'BEER' | 'DISH';
export type Plan = 'TRIAL' | 'START' | 'PRO' | 'NETWORK';
export type EventKind = 'SCAN' | 'DISH_VIEW' | 'PAIR_VIEW' | 'BEER_VIEW' | 'ORDER_INTENT';

export interface PlanLimits { tables: number; items: number; history_days: number; branding: boolean; price_kzt: number; }

export interface VenuePublic {
  slug: string; name: string; city: string; address: string; venue_type: string; description: string;
  logo: string; cover: string; accent: string; phone: string; instagram: string; wifi: string;
  headline: string; currency: string; branding: boolean; plan: Plan;
}

export interface MenuItem {
  id: string; kind: ItemKind; ref_slug: string; name: string; description: string; category: string;
  price: number; volume: string; is_available: boolean; is_featured: boolean; sort_order: number;
}

export interface VenueMenu { venue: VenuePublic; table: number | null; beers: MenuItem[]; dishes: MenuItem[]; }

export interface CabinetSession {
  token: string; venue: VenuePublic; plan: Plan; plan_label: string; limits: PlanLimits;
  days_left: number; active: boolean; active_until: string | null; email: string;
}

export interface TableRow {
  id: string; number: number; label: string; token: string; scans: number;
  is_active: boolean; last_scan_at: string | null;
}

export interface Stats {
  days: number; scans: number; guests: number; pair_views: number; order_intents: number;
  conversion: number; revenue_intent_kzt: number; avg_check_add_kzt: number;
  series: { date: string; scans: number }[];
  top_dishes: { slug: string; count: number }[];
  top_beers: { slug: string; count: number }[];
  top_pairs: { dish: string; beer: string; count: number }[];
  tables: TableRow[];
}

export interface TrackPayload {
  venue: string; kind: EventKind; dish?: string; beer?: string;
  score?: number; price?: number; table?: number | null; session?: string;
}

/** Тарифы — единственный источник правды для лендинга и кабинета (₸/мес). */
export const PLANS: { id: Plan; name: string; price: number; tagline: string; limits: PlanLimits; features: string[] }[] = [
  {
    id: 'START', name: 'Старт', price: 14900, tagline: 'Для одного бара до 15 столов',
    limits: { tables: 15, items: 80, history_days: 60, branding: true, price_kzt: 14900 },
    features: ['QR-меню с вашими ценами', 'Подбор пива к каждому блюду', 'Стоп-лист в один клик',
               'До 15 столов и 80 позиций', 'Аналитика сканов за 60 дней', 'Свой логотип и цвет'],
  },
  {
    id: 'PRO', name: 'Про', price: 34900, tagline: 'Для ресторана и пивного сада',
    limits: { tables: 60, items: 300, history_days: 365, branding: true, price_kzt: 34900 },
    features: ['Всё из «Старт»', 'До 60 столов и 300 позиций', 'История и отчёты за год',
               'Топ связок блюдо → пиво', 'Оценка прироста чека в ₸', 'Печатные стенды на столы'],
  },
  {
    id: 'NETWORK', name: 'Сеть', price: 89000, tagline: 'Для сети и дистрибьютора',
    limits: { tables: 10000, items: 10000, history_days: 1095, branding: true, price_kzt: 89000 },
    features: ['Всё из «Про»', 'Неограниченно точек и позиций', 'Сводный отчёт по сети',
               'Выгрузка данных и API', 'Приоритетная поддержка', 'Обучение персонала'],
  },
];

export const PLAN_BY_ID: Record<string, (typeof PLANS)[number] | undefined> =
  Object.fromEntries(PLANS.map(p => [p.id, p]));
