/** Типы канонических данных Flavor Tree (data/*.json). Совпадают с полями Django-моделей v2. */
import type { BeerAxis, DishAxis, PairingType } from '../engine/pairing-engine';

export type Layer = 'TOP' | 'HEART' | 'BASE';
export type Cuisine = 'KZ' | 'ITALIAN' | 'JAPANESE' | 'AMERICAN' | 'MEXICAN' | 'GERMAN' | 'OTHER';
export type Taste = 'SALTY' | 'SWEET' | 'SOUR' | 'BITTER' | 'UMAMI' | 'SPICY' | 'MIXED';
export type Weight = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export type Fat = 'LOW' | 'MEDIUM' | 'HIGH';
export type Cooking = 'FRIED' | 'GRILLED' | 'BAKED' | 'BOILED' | 'STEAMED' | 'RAW' | 'CURED' | 'FERMENTED' | 'OTHER';
export type Packaging = 'BOTTLE' | 'CAN' | 'DRAFT';

export interface FlavorNote {
  id: string; name: string; technical_term: string; category: Layer; icon: string; description: string;
  axes: Partial<Record<BeerAxis, number>>; tags: string[]; sort_order: number; is_off_flavour?: boolean;
}
export interface PyramidEntry { layer: Layer; note_id: string; intensity: number; sommelier_note: string; }
export interface Serving { temp_min: number; temp_max: number; glass: string; seasonality: string; }
export interface Brand {
  id: string; name: string; display_name: string; brand_owner: string; style: string; style_family: string; style_label: string;
  abv: number; abv_estimated: boolean; packaging_type: Packaging; is_horeca_only: boolean; description: string;
  origin: string; tagline: string; image: string | null; media_file?: string; accent: string | null;
  pyramid: PyramidEntry[]; serving: Serving; vector_override?: Partial<Record<BeerAxis, number>>;
}
export interface Dish {
  id: string; name: string; display_name: string; emoji: string; cuisine: Cuisine; cuisine_label: string; cuisine_flag: string;
  category: string; dominant_taste: Taste; dominant_taste_label: string; weight: Weight; weight_label: string;
  fat_level: Fat; fat_level_label: string; cooking_method: Cooking; cooking_method_label: string; description: string;
  vector: Record<DishAxis, number>; tags: string[]; synonyms: string[];
}
export interface CuratedPairing { brand_id: string; dish_id: string; score: number; type: PairingType; explanation: string; }
export interface Course { level: number; id: string; title: string; subtitle: string; xp_required: number; color: string; description: string; }
export interface TeamMember { id: string; name: string; role: string; bio: string; avatar: string; }
export interface Venue {
  id: string; name: string; city: string; address: string; venue_type: string; description: string;
  brands: string[]; menu: string[]; tables: number; token_prefix: string;
}
export interface StylePriors { axes: BeerAxis[]; labels: Record<string, string>; priors: Record<string, Record<BeerAxis, number>>; }

export const PACKAGING_LABELS: Record<Packaging, string> = { BOTTLE: 'Бутылка', CAN: 'Банка', DRAFT: 'Разливное' };
export const LAYER_META: Record<Layer, { label: string; time: string; hint: string; color: string }> = {
  TOP: { label: 'Top notes', time: '0–3 сек', hint: 'первое впечатление: аромат, свежесть, хмель', color: 'var(--layer-top)' },
  HEART: { label: 'Heart notes', time: '3–15 сек', hint: 'тело: солод, зерно, карамель', color: 'var(--layer-heart)' },
  BASE: { label: 'Base notes', time: '15+ сек', hint: 'послевкусие: горечь, плотность, финиш', color: 'var(--layer-base)' },
};
export const CUISINES: { id: Cuisine; label: string; flag: string }[] = [
  { id: 'KZ', label: 'Казахская', flag: '🇰🇿' }, { id: 'ITALIAN', label: 'Итальянская', flag: '🇮🇹' },
  { id: 'JAPANESE', label: 'Японская', flag: '🇯🇵' }, { id: 'AMERICAN', label: 'Американская', flag: '🇺🇸' },
  { id: 'MEXICAN', label: 'Мексиканская', flag: '🇲🇽' }, { id: 'GERMAN', label: 'Немецкая', flag: '🇩🇪' },
];
