import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { flavorNotes, flavorProfiles, brands } from "@/db/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Reverse search: which brands contain this flavor note. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const note = await db
    .select({ id: flavorNotes.id, name: flavorNotes.name })
    .from(flavorNotes)
    .where(eq(flavorNotes.id, id))
    .limit(1);
  if (note.length === 0) {
    return NextResponse.json({ error: "Flavor note not found" }, { status: 404 });
  }

  const rows = await db
    .select({
      brandId: brands.id,
      brandName: brands.name,
      brandStyle: brands.style,
      brandImage: brands.image,
      brandOwner: brands.brandOwner,
      isActive: brands.isActive,
      intensity: flavorProfiles.intensity,
      layer: flavorProfiles.layer,
    })
    .from(flavorProfiles)
    .innerJoin(brands, eq(brands.id, flavorProfiles.brandId))
    .where(and(eq(flavorProfiles.flavorNoteId, id)))
    .orderBy(flavorProfiles.intensity);

  return NextResponse.json({
    note: note[0],
    brands: rows.map((r) => ({
      id: r.brandId,
      name: r.brandName,
      style: r.brandStyle,
      image: r.brandImage,
      brandOwner: r.brandOwner,
      isActive: r.isActive,
      intensity: r.intensity,
      layer: r.layer,
    })),
  });
}
