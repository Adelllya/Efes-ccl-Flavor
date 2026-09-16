import {
  pgTable,
  uuid,
  varchar,
  text,
  real,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

const float = real;

// ─── Flavor Note ─────────────────────────────────────────────────────────────
export const flavorNotes = pgTable("flavor_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  technicalTerm: varchar("technical_term", { length: 100 }),
  wheelCode: varchar("wheel_code", { length: 10 }),
  category: varchar("category", { length: 10 }).notNull(),
  description: text("description").notNull(),
  icon: varchar("icon", { length: 10 }).notNull(),
  referenceMaterial: varchar("reference_material", { length: 200 }),
  isOffFlavour: boolean("is_off_flavour").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Brand ───────────────────────────────────────────────────────────────────
export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  brandOwner: varchar("brand_owner", { length: 100 }).notNull(),
  style: varchar("style", { length: 100 }).notNull(),
  abv: float("abv").notNull(),
  density: varchar("density", { length: 100 }),
  fermentationType: varchar("fermentation_type", { length: 100 }),
  description: text("description").notNull(),
  image: varchar("image", { length: 500 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Flavor Profile (link Brand ↔ FlavorNote with intensity per layer) ───────
export const flavorProfiles = pgTable("flavor_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  flavorNoteId: uuid("flavor_note_id").notNull().references(() => flavorNotes.id, { onDelete: "cascade" }),
  layer: varchar("layer", { length: 10 }).notNull(),
  intensity: integer("intensity").notNull(),
  sommelierNote: text("sommelier_note"),
  sommelierName: varchar("sommelier_name", { length: 150 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  brandNoteUq: (t.brandId, t.flavorNoteId),
}));

// ─── Serving Recommendation ─────────────────────────────────────────────────
export const servingRecommendations = pgTable("serving_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").notNull().unique().references(() => brands.id, { onDelete: "cascade" }),
  servingTempMin: float("serving_temp_min").notNull(),
  servingTempMax: float("serving_temp_max").notNull(),
  glassType: varchar("glass_type", { length: 100 }).notNull(),
  seasonality: varchar("seasonality", { length: 100 }),
});

// ─── Course (School of Sommelier) ───────────────────────────────────────────
export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  level: integer("level").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description").notNull(),
  color: varchar("color", { length: 20 }).notNull(),
  requiredScore: integer("required_score").notNull().default(0),
});

// ─── Team Member ─────────────────────────────────────────────────────────────
export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 150 }).notNull(),
  role: varchar("role", { length: 150 }).notNull(),
  bio: text("bio").notNull(),
  avatar: varchar("avatar", { length: 500 }),
});

// ─── Dish ────────────────────────────────────────────────────────────────────
export const dishes = pgTable("dishes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  cuisine: varchar("cuisine", { length: 20 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  description: text("description").notNull(),
  image: varchar("image", { length: 500 }),
});

// ─── Food Pairing ────────────────────────────────────────────────────────────
export const foodPairings = pgTable("food_pairings", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  dishId: uuid("dish_id").notNull().references(() => dishes.id, { onDelete: "cascade" }),
  compatibilityScore: integer("compatibility_score").notNull(),
  pairingType: varchar("pairing_type", { length: 20 }).notNull(),
  explanation: text("explanation").notNull(),
});

// ─── Venue ───────────────────────────────────────────────────────────────────
export const venues = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  address: varchar("address", { length: 300 }).notNull(),
  venueType: varchar("venue_type", { length: 50 }).notNull(),
  logo: varchar("logo", { length: 500 }),
});

// ─── QR Code ─────────────────────────────────────────────────────────────────
export const qrcodes = pgTable("qrcodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
  tableNumber: integer("table_number").notNull(),
  uniqueToken: varchar("unique_token", { length: 64 }).notNull(),
  scansCount: integer("scans_count").notNull().default(0),
});

// ─── Anonymous Session ───────────────────────────────────────────────────────
export const anonymousSessions = pgTable("anonymous_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  qrCodeId: uuid("qr_code_id").references(() => qrcodes.id, { onDelete: "set null" }),
  completedLevels: integer("completed_levels").notNull().default(0),
  score: integer("score").notNull().default(0),
  preferences: jsonb("preferences").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
