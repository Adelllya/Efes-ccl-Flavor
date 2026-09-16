import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servingRecommendations, brands } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Upsert serving recommendation for a brand (OneToOne). */
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const brandId: string = body.brandId;

  const brand = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (brand.length === 0) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const data = {
    servingTempMin: Number(body.servingTempMin ?? 4),
    servingTempMax: Number(body.servingTempMax ?? 8),
    glassType: body.glassType ?? "Standard",
    seasonality: body.seasonality ?? null,
  };

  const existing = await db
    .select({ id: servingRecommendations.id })
    .from(servingRecommendations)
    .where(eq(servingRecommendations.brandId, brandId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(servingRecommendations)
      .set(data)
      .where(eq(servingRecommendations.brandId, brandId));
  } else {
    await db.insert(servingRecommendations).values({ brandId, ...data });
  }

  const rows = await db
    .select()
    .from(servingRecommendations)
    .where(eq(servingRecommendations.brandId, brandId));
  return NextResponse.json(rows[0]);
}
