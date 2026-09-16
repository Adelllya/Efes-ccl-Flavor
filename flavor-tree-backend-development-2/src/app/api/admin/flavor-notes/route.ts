import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { flavorNotes } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Admin: full CRUD for flavor notes dictionary. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const inserted = await db
    .insert(flavorNotes)
    .values({
      name: body.name ?? "Новая нота",
      technicalTerm: body.technicalTerm ?? null,
      wheelCode: body.wheelCode ?? null,
      category: body.category ?? "HEART",
      description: body.description ?? "",
      icon: body.icon ?? "🍺",
      referenceMaterial: body.referenceMaterial ?? null,
      isOffFlavour: body.isOffFlavour ?? false,
      sortOrder: body.sortOrder ?? 999,
    })
    .returning();
  return NextResponse.json(inserted[0], { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const id: string = body.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const fields: Record<string, unknown> = {};
  for (const key of [
    "name",
    "technicalTerm",
    "wheelCode",
    "category",
    "description",
    "icon",
    "referenceMaterial",
    "isOffFlavour",
    "sortOrder",
  ]) {
    if (key in body) fields[key] = body[key];
  }
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  await db.update(flavorNotes).set(fields).where(eq(flavorNotes.id, id));

  const rows = await db.select().from(flavorNotes).where(eq(flavorNotes.id, id));
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.delete(flavorNotes).where(eq(flavorNotes.id, id));
  return NextResponse.json({ ok: true });
}
