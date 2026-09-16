import { eq, and, ilike, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  brands,
  flavorProfiles,
  flavorNotes,
  servingRecommendations,
} from "@/db/schema";

export function brandCard(brand: Record<string, unknown>) {
  return {
    id: brand.id,
    name: brand.name,
    brandOwner: brand.brandOwner,
    style: brand.style,
    abv: brand.abv,
    density: brand.density,
    fermentationType: brand.fermentationType,
    description: brand.description,
    image: brand.image,
    isActive: brand.isActive,
  };
}

export const CATEGORY_LABELS: Record<string, string> = {
  TOP: "Верхние ноты",
  HEART: "Ноты сердца",
  BASE: "Базовые ноты",
};

/**
 * Fetch a brand with its full pyramid + serving recommendation in a single
 * query (no N+1). Returns null if brand not found.
 */
export async function getBrandFull(id: string) {
  const brandRows = await db
    .select({
      id: brands.id,
      name: brands.name,
      brandOwner: brands.brandOwner,
      style: brands.style,
      abv: brands.abv,
      density: brands.density,
      fermentationType: brands.fermentationType,
      description: brands.description,
      image: brands.image,
      isActive: brands.isActive,
      servingTempMin: servingRecommendations.servingTempMin,
      servingTempMax: servingRecommendations.servingTempMax,
      glassType: servingRecommendations.glassType,
      seasonality: servingRecommendations.seasonality,
      noteId: flavorNotes.id,
      noteName: flavorNotes.name,
      noteIcon: flavorNotes.icon,
      noteDescription: flavorNotes.description,
      noteCategory: flavorNotes.category,
      noteTechnicalTerm: flavorNotes.technicalTerm,
      noteReferenceMaterial: flavorNotes.referenceMaterial,
      noteIsOffFlavour: flavorNotes.isOffFlavour,
      layer: flavorProfiles.layer,
      intensity: flavorProfiles.intensity,
      sommelierNote: flavorProfiles.sommelierNote,
      sommelierName: flavorProfiles.sommelierName,
    })
    .from(brands)
    .leftJoin(
      servingRecommendations,
      eq(servingRecommendations.brandId, brands.id)
    )
    .leftJoin(flavorProfiles, eq(flavorProfiles.brandId, brands.id))
    .leftJoin(flavorNotes, eq(flavorNotes.id, flavorProfiles.flavorNoteId))
    .where(eq(brands.id, id));

  if (brandRows.length === 0) return null;

  const first = brandRows[0];
  const brand = {
    id: first.id,
    name: first.name,
    brandOwner: first.brandOwner,
    style: first.style,
    abv: first.abv,
    density: first.density,
    fermentationType: first.fermentationType,
    description: first.description,
    image: first.image,
    isActive: first.isActive,
    servingRecommendation:
      first.servingTempMin != null
        ? {
            servingTempMin: first.servingTempMin,
            servingTempMax: first.servingTempMax,
            glassType: first.glassType,
            seasonality: first.seasonality,
          }
        : null,
  };

  const pyramid: Record<string, Array<Record<string, unknown>>> = {
    top: [],
    heart: [],
    base: [],
  };

  for (const row of brandRows) {
    if (!row.noteId) continue;
    const key =
      row.layer === "TOP" ? "top" : row.layer === "HEART" ? "heart" : "base";
    pyramid[key].push({
      id: row.noteId,
      name: row.noteName,
      icon: row.noteIcon,
      description: row.noteDescription,
      technicalTerm: row.noteTechnicalTerm,
      referenceMaterial: row.noteReferenceMaterial,
      isOffFlavour: row.noteIsOffFlavour,
      intensity: row.intensity,
      sommelierNote: row.sommelierNote,
      sommelierName: row.sommelierName,
      categoryLabel: row.layer ? (CATEGORY_LABELS[row.layer] ?? row.layer) : "",
    });
  }

  for (const key of ["top", "heart", "base"]) {
    pyramid[key].sort(
      (a, b) => (b.intensity as number) - (a.intensity as number)
    );
  }

  return { brand, pyramid };
}
