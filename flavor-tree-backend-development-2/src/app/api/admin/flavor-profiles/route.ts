import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { flavorProfiles, flavorNotes, brands } from "@/db/schema";
import { CATEGORY_LABELS } from "../../lib/helpers";

export const dynamic = "force-dynamic";

/**
 * PUT replaces the entire pyramid for a brand (atomic upsert by layer batches).
 * Body: { brandId, notes: [{ flavorNoteId, layer, intensity, sommelierNote? }] }
 *
 * Validation: layer must match the note's category (Django `clean()` equivalent).
 * Warning (not error) if a layer is empty — drafts are allowed.
 */
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const brandId: string = body.brandId;
  const notes: Array<{
    flavorNoteId: string;
    layer: string;
    intensity: number;
    sommelierNote?: string | null;
    sommelierName?: string | null;
  }> = body.notes ?? [];

  const brand = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (brand.length === 0) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  // Fetch all referenced notes to validate layer == category
  const noteIds = notes.map((n) => n.flavorNoteId);
  const noteMap: Record<string, { category: string; name: string }> = {};
  if (noteIds.length > 0) {
    const rows = await db
      .select({ id: flavorNotes.id, category: flavorNotes.category, name: flavorNotes.name })
      .from(flavorNotes)
      .where(and(...noteIds.map((id) => eq(flavorNotes.id, id))));
    for (const r of rows) noteMap[r.id] = { category: r.category, name: r.name };
  }

  const errors: string[] = [];
  for (const n of notes) {
    const note = noteMap[n.flavorNoteId];
    if (!note) {
      errors.push(`Note ${n.flavorNoteId} not found`);
      continue;
    }
    if (n.layer !== note.category) {
      errors.push(
        `Нота «${note.name}» относится к слою ${CATEGORY_LABELS[note.category]}, а не к ${n.layer} — исправьте слой`
      );
    }
    if (n.intensity < 1 || n.intensity > 10) {
      errors.push(`Интенсивность должна быть 1–10`);
    }
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 400 });
  }

  // Warnings: empty layers (drafts allowed — not blocking)
  const warnings: string[] = [];
  for (const layer of ["TOP", "HEART", "BASE"]) {
    if (!notes.some((n) => n.layer === layer)) {
      warnings.push(`Слой «${CATEGORY_LABELS[layer]}» пуст — профиль останется черновиком`);
    }
  }

  // Replace strategy: delete then insert
  await db.delete(flavorProfiles).where(eq(flavorProfiles.brandId, brandId));
  if (notes.length > 0) {
    await db.insert(flavorProfiles).values(
      notes.map((n) => ({
        brandId,
        flavorNoteId: n.flavorNoteId,
        layer: n.layer,
        intensity: n.intensity,
        sommelierNote: n.sommelierNote ?? null,
        sommelierName: n.sommelierName ?? null,
        updatedAt: new Date(),
      }))
    );
  }

  // Compute final counts
  const finalRows = await db
    .select({ layer: flavorProfiles.layer, cnt: flavorProfiles.id })
    .from(flavorProfiles)
    .where(eq(flavorProfiles.brandId, brandId));
  const counts = { TOP: 0, HEART: 0, BASE: 0 } as Record<string, number>;
  for (const r of finalRows) counts[r.layer]++;

  return NextResponse.json({
    ok: true,
    warnings,
    profile: {
      top: counts.TOP,
      heart: counts.HEART,
      base: counts.BASE,
      complete: counts.TOP > 0 && counts.HEART > 0 && counts.BASE > 0,
    },
  });
}
