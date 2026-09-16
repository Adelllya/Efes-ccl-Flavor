export type PackagingType = 'BOTTLE' | 'CAN' | 'DRAFT';
export type PyramidLayer = 'TOP' | 'HEART' | 'BASE';
export type PairingType = 'COMPLEMENT' | 'CONTRAST' | 'CLEANSE' | 'BRIDGE';
export type CuisineType = 'KZ' | 'ITALIAN' | 'JAPANESE' | 'AMERICAN' | 'MEXICAN' | 'GERMAN' | 'OTHER';

export interface FlavorNote {
  id: string;
  name: string;
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
  image?: string;
  is_active: boolean;
  note_count?: number;
  profile?: BrandProfileStatus;
  serving_recommendation?: ServingRecommendation;
  pyramid?: PyramidData;
}

export interface Dish {
  id: string;
  name: string;
  cuisine: CuisineType;
  cuisine_display?: string;
  category?: string;
  dominant_taste: 'SALTY' | 'SWEET' | 'SOUR' | 'BITTER' | 'UMAMI' | 'SPICY' | 'MIXED';
  dominant_taste_display?: string;
  weight: 'LIGHT' | 'MEDIUM' | 'HEAVY';
  weight_display?: string;
  fat_level: 'LOW' | 'MEDIUM' | 'HIGH';
  fat_level_display?: string;
  cooking_method: 'FRIED' | 'GRILLED' | 'BAKED' | 'BOILED' | 'STEAMED' | 'RAW' | 'CURED' | 'FERMENTED' | 'OTHER';
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
