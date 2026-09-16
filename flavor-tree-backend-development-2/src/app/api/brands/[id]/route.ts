import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brands, servingRecommendations } from "@/db/schema";
import { getBrandFull } from "../../lib/helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const full = await getBrandFull(id);
  if (!full) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  return NextResponse.json(full.brand);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();

  const allowed = [
    "name",
    "brandOwner",
    "style",
    "abv",
    "density",
    "fermentationType",
    "description",
    "image",
    "isActive",
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const existing = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.id, id))
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  await db.update(brands).set(updates).where(eq(brands.id, id));

  // Optional serving recommendation update (nested)
  if (body.servingRecommendation) {
    const sr = body.servingRecommendation;
    const existingSr = await db
      .select({ id: servingRecommendations.id })
      .from(servingRecommendations)
      .where(eq(servingRecommendations.brandId, id))
      .limit(1);
    const srData = {
      servingTempMin: sr.servingTempMin ?? 4,
      servingTempMax: sr.servingTempMax ?? 8,
      glassType: sr.glassType ?? "Standard",
      seasonality: sr.seasonality ?? null,
    };
    if (existingSr.length > 0) {
      await db
        .update(servingRecommendations)
        .set(srData)
        .where(eq(servingRecommendations.brandId, id));
    } else {
      await db
        .insert(servingRecommendations)
        .values({ brandId: id, ...srData });
    }
  }

  const updated = await getBrandFull(id);
  return NextResponse.json(updated?.brand ?? { id, updated: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const existing = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.id, id))
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  await db.delete(brands).where(eq(brands.id, id));
  return NextResponse.json({ ok: true, deleted: id });
}
