import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, flavorProfiles } from "@/db/schema";
import { brandCard } from "../../lib/helpers";

export const dynamic = "force-dynamic";

/** Admin list: all brands (including inactive) + profile completeness per layer. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  const conditions = [];
  if (q) conditions.push(ilike(brands.name, `%${q}%`));

  const rows = await db
    .select()
    .from(brands)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(brands.createdAt));

  const brandIds = rows.map((r) => r.id);
  const layerCounts: Record<string, Record<string, number>> = {};
  if (brandIds.length > 0) {
    const countRows = await db
      .select({
        brandId: flavorProfiles.brandId,
        layer: flavorProfiles.layer,
        cnt: sql<number>`count(*)::int`,
      })
      .from(flavorProfiles)
      .where(and(...brandIds.map((id) => eq(flavorProfiles.brandId, id))))
      .groupBy(flavorProfiles.brandId, flavorProfiles.layer);
    for (const r of countRows) {
      if (!layerCounts[r.brandId]) layerCounts[r.brandId] = {};
      layerCounts[r.brandId][r.layer] = r.cnt;
    }
  }

  return NextResponse.json(
    rows.map((b) => {
      const lc = layerCounts[b.id] ?? {};
      const top = lc["TOP"] ?? 0;
      const heart = lc["HEART"] ?? 0;
      const base = lc["BASE"] ?? 0;
      const complete = top > 0 && heart > 0 && base > 0;
      return {
        ...brandCard(b),
        profile: {
          top,
          heart,
          base,
          total: top + heart + base,
          complete,
          status: complete ? "complete" : top + heart + base === 0 ? "empty" : "partial",
        },
      };
    })
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const inserted = await db
    .insert(brands)
    .values({
      name: body.name ?? "Новый бренд",
      brandOwner: body.brandOwner ?? "",
      style: body.style ?? "Lager",
      abv: Number(body.abv ?? 5),
      density: body.density ?? null,
      fermentationType: body.fermentationType ?? null,
      description: body.description ?? "",
      image:
        body.image ??
        "https://placehold.co/600x800/999/fff?text=New+Brand",
      isActive: body.isActive ?? true,
    })
    .returning();
  return NextResponse.json(inserted[0], { status: 201 });
}
