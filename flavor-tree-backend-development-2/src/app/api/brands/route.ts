import { NextRequest, NextResponse } from "next/server";
import { eq, and, ilike, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, flavorProfiles } from "@/db/schema";
import { brandCard } from "../lib/helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const style = params.get("style");
  const isActive = params.get("is_active");
  const q = params.get("q");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, parseInt(params.get("page_size") ?? "20", 10) || 20)
  );

  const conditions = [];
  if (style) conditions.push(ilike(brands.style, `%${style}%`));
  if (q) conditions.push(ilike(brands.name, `%${q}%`));
  if (isActive !== null && isActive !== "") {
    conditions.push(eq(brands.isActive, isActive === "true" || isActive === "1"));
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const totalRows = await db
    .select({ count: brands.id })
    .from(brands)
    .where(where);
  const total: number = Number(totalRows[0]?.count ?? 0);

  const rows = await db
    .select()
    .from(brands)
    .where(where)
    .orderBy(desc(brands.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Aggregated note count per brand (single query — no N+1)
  const brandIds = rows.map((r) => r.id);
  const counts: Record<string, number> = {};
  if (brandIds.length > 0) {
    const countRows = await db
      .select({
        brandId: flavorProfiles.brandId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(flavorProfiles)
      .where(and(...brandIds.map((id) => eq(flavorProfiles.brandId, id))))
      .groupBy(flavorProfiles.brandId);
    for (const r of countRows) counts[r.brandId] = r.cnt;
  }

  return NextResponse.json({
    results: rows.map((b) => ({
      ...brandCard(b),
      noteCount: counts[b.id] ?? 0,
    })),
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.ceil(total / pageSize),
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const required = ["name", "brandOwner", "style", "abv", "description", "image"];
  for (const f of required) {
    if (body[f] === undefined || body[f] === null || body[f] === "") {
      return NextResponse.json(
        { error: `Missing required field: ${f}` },
        { status: 400 }
      );
    }
  }

  const inserted = await db
    .insert(brands)
    .values({
      name: body.name,
      brandOwner: body.brandOwner,
      style: body.style,
      abv: Number(body.abv),
      density: body.density ?? null,
      fermentationType: body.fermentationType ?? null,
      description: body.description,
      image: body.image,
      isActive: body.isActive ?? true,
    })
    .returning();

  return NextResponse.json(inserted[0], { status: 201 });
}
