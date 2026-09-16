import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { flavorNotes } from "@/db/schema";
import { CATEGORY_LABELS } from "../lib/helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const category = params.get("category");
  const offFlavour = params.get("off_flavour");

  const conditions = [];
  if (category) conditions.push(eq(flavorNotes.category, category.toUpperCase()));
  if (offFlavour !== null && offFlavour !== "") {
    conditions.push(eq(flavorNotes.isOffFlavour, offFlavour === "true"));
  }

  const rows = await db
    .select()
    .from(flavorNotes)
    .where(conditions.length ? conditions[0] : undefined)
    .orderBy(asc(flavorNotes.sortOrder));

  return NextResponse.json(
    rows.map((n) => ({
      id: n.id,
      name: n.name,
      technicalTerm: n.technicalTerm,
      wheelCode: n.wheelCode,
      category: n.category,
      categoryLabel: CATEGORY_LABELS[n.category] ?? n.category,
      description: n.description,
      icon: n.icon,
      referenceMaterial: n.referenceMaterial,
      isOffFlavour: n.isOffFlavour,
    }))
  );
}
