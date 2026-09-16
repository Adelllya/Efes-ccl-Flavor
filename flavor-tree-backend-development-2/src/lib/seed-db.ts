import { db } from "@/db";
import {
  flavorNotes,
  brands,
  flavorProfiles,
  servingRecommendations,
  courses,
  teamMembers,
} from "@/db/schema";
import {
  flavorNoteSeeds,
  brandSeeds,
  profileSeeds,
  servingRecSeeds,
  courseSeeds,
  teamMemberSeeds,
} from "./seed";

export async function runSeed() {
  // Idempotent: clear existing seed data
  await db.delete(teamMembers);
  await db.delete(courses);
  await db.delete(flavorProfiles);
  await db.delete(servingRecommendations);
  await db.delete(brands);
  await db.delete(flavorNotes);

  // 1. Flavor notes
  const insertedNotes = await db
    .insert(flavorNotes)
    .values(
      flavorNoteSeeds.map((n, i) => ({
        name: n.name,
        technicalTerm: n.technicalTerm,
        wheelCode: n.wheelCode,
        category: n.category,
        description: n.description,
        icon: n.icon,
        referenceMaterial: n.referenceMaterial,
        isOffFlavour: n.isOffFlavour ?? false,
        sortOrder: i,
      }))
    )
    .returning({ id: flavorNotes.id });

  const noteIdByIndex = insertedNotes.map((n) => n.id);

  // 2. Brands
  const insertedBrands = await db
    .insert(brands)
    .values(
      brandSeeds.map((b) => ({
        name: b.name,
        brandOwner: b.brandOwner,
        style: b.style,
        abv: b.abv,
        density: b.density,
        fermentationType: b.fermentationType,
        description: b.description,
        image: b.image,
        isActive: b.isActive ?? true,
      }))
    )
    .returning({ id: brands.id });

  const brandIdByIndex = insertedBrands.map((b) => b.id);

  // 3. Flavor profiles
  const profileRows: Array<{
    brandId: string;
    flavorNoteId: string;
    layer: string;
    intensity: number;
    sommelierNote: string | null;
    sommelierName: string | null;
  }> = [];

  for (const ps of profileSeeds) {
    const layers = ["TOP", "HEART", "BASE"] as const;
    for (const layer of layers) {
      const entries = ps[layer];
      for (const [noteIdx, intensity] of entries) {
        profileRows.push({
          brandId: brandIdByIndex[ps.brandIndex],
          flavorNoteId: noteIdByIndex[noteIdx],
          layer,
          intensity,
          sommelierNote: null,
          sommelierName: "Айгерим Нурланова",
        });
      }
    }
  }

  if (profileRows.length > 0) {
    await db.insert(flavorProfiles).values(profileRows);
  }

  // 4. Serving recommendations
  for (const rec of servingRecSeeds) {
    await db
      .insert(servingRecommendations)
      .values({
        brandId: brandIdByIndex[rec.brandIndex],
        servingTempMin: rec.servingTempMin,
        servingTempMax: rec.servingTempMax,
        glassType: rec.glassType,
        seasonality: rec.seasonality,
      });
  }

  // 5. Courses
  await db
    .insert(courses)
    .values(
      courseSeeds.map((c) => ({
        level: c.level,
        title: c.title,
        description: c.description,
        color: c.color,
      }))
    );

  // 6. Team
  await db
    .insert(teamMembers)
    .values(
      teamMemberSeeds.map((t) => ({
        name: t.name,
        role: t.role,
        bio: t.bio,
        avatar: t.avatar,
      }))
    );

  console.log("Seed complete:", {
    flavorNotes: flavorNoteSeeds.length,
    brands: brandSeeds.length,
    flavorProfiles: profileRows.length,
    servingRecs: servingRecSeeds.length,
    courses: courseSeeds.length,
    teamMembers: teamMemberSeeds.length,
  });
}
