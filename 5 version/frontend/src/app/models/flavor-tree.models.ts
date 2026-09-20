export type PackagingType = 'BOTTLE' | 'CAN' | 'DRAFT';
export type PyramidLayer = 'TOP' | 'HEART' | 'BASE';
export type PairingType = 'COMPLEMENT' | 'CONTRAST' | 'CLEANSE' | 'BRIDGE';
export type CuisineType = 'KZ' | 'ITALIAN' | 'JAPANESE' | 'AMERICAN' | 'MEXICAN' | 'GERMAN' | 'OTHER';

export interface FlavorNote {
  id: string;
  name: string;
  /** Фото ингредиента с бэкенда: ромашка, колос, шишка хмеля. */
  image?: string | null;
  technical_term?: string;
  wheel_code?: string;
  category: PyramidLayer;
  category_display?: string;
  icon: string;
  description?: string;
  reference_material?: string;
  is_off_flavour?: boolean;
}

export interface PyramidNoteItem {
  id: string;
  name: string;
  icon: string;
  /** Фото ноты. Если пусто — остаётся emoji. */
  image?: string | null;
  description: string;
  technical_term?: string;
  reference_material?: string;
  is_off_flavour?: boolean;
  intensity: number; // 1 - 10
  sommelier_note?: string;
  sommelier_name?: string;
  category_label?: string;
}

export interface PyramidData {
  top: PyramidNoteItem[];
  heart: PyramidNoteItem[];
  base: PyramidNoteItem[];
}

export interface ServingRecommendation {
  serving_temp_min: number;
  serving_temp_max: number;
  glass_type: string;
  seasonality?: string;
}

export interface BrandProfileStatus {
  top: number;
  heart: number;
  base: number;
  total: number;
  complete: boolean;
  status: 'complete' | 'partial' | 'empty';
}

export interface Brand {
  id: string;
  name: string;
  brand_owner?: string;
  style: string;
  abv?: number | null;
  density?: string;
  fermentation_type?: string;
  packaging_type: PackagingType;
  packaging_type_display?: string;
  is_horeca_only: boolean;
  description: string;
  /** Лёгкий файл для мелких мест: карточки, списки. */
  image?: string;
  /** Крупная версия для страницы сорта и большой карточки подбора. */
  image_hd?: string | null;
  /** HEX для фона страницы сорта, задаётся в админке. */
  accent_color?: string;
  /** Строка над названием на странице сорта. */
  tagline?: string;
  is_active: boolean;
  note_count?: number;
  profile?: BrandProfileStatus;
  serving_recommendation?: ServingRecommendation;
  pyramid?: PyramidData;
}

export type TasteType = 'SALTY' | 'SWEET' | 'SOUR' | 'BITTER' | 'UMAMI' | 'SPICY' | 'MIXED';
export type WeightType = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export type FatType = 'LOW' | 'MEDIUM' | 'HIGH';
export type CookingMethod =
  | 'FRIED' | 'GRILLED' | 'BAKED' | 'BOILED' | 'STEAMED'
  | 'RAW' | 'CURED' | 'FERMENTED' | 'OTHER';

export interface Dish {
  id: string;
  name: string;
  cuisine: CuisineType;
  cuisine_display?: string;
  category?: string;
  dominant_taste: TasteType;
  dominant_taste_display?: string;
  weight: WeightType;
  weight_display?: string;
  fat_level: FatType;
  fat_level_display?: string;
  cooking_method: CookingMethod;
  cooking_method_display?: string;
  description: string;
  image?: string;
}

export interface FoodPairing {
  id: string;
  brand: string;
  brand_name: string;
  dish: string;
  dish_name: string;
  compatibility_score: number; // 1 - 5
  pairing_type: PairingType;
  pairing_type_display?: string;
  explanation: string;
}

export interface Course {
  id: string;
  level: number;
  level_display: string;
  title: string;
  description: string;
  color?: string;
  required_score?: number;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  avatar?: string;
}

export interface AdminFlavorProfilePayload {
  brand_id: string;
  notes: {
    flavor_note_id: string;
    layer: PyramidLayer;
    intensity: number;
    sommelier_note: string;
  }[];
}


/** Картинка характеристики блюда из админки: «жареное», «острое», «мясо». */
export interface FoodIcon {
  id: string;
  kind: 'CATEGORY' | 'COOKING' | 'TASTE' | 'WEIGHT';
  kind_display?: string;
  key: string;
  label?: string;
  image: string;
  sort_order?: number;
}

/** Настройки витрины: сколько сортов показывать и нужен ли декор. */
export interface SiteSettings {
  alternatives_count: number;
  min_score_to_show: number;
  show_wheat_decor: boolean;
  pairing_intro: string;
}
