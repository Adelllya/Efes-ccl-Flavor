import { NextRequest, NextResponse } from "next/server";
import { getBrandFull } from "../../../lib/helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const full = await getBrandFull(id);
  if (!full) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const { brand, pyramid } = full;
  // Strip sommelier internals for the public pyramid response
  const strip = (arr: Record<string, unknown>[]) =>
    arr.map(({ id: nid, name, icon, description, intensity, technicalTerm, referenceMaterial, isOffFlavour }) => ({
      id: nid,
      name,
      icon,
      description,
      intensity,
      technicalTerm,
      referenceMaterial,
      isOffFlavour,
    }));

  return NextResponse.json({
    brand: brand.name,
    brandId: brand.id,
    top: strip(pyramid.top),
    heart: strip(pyramid.heart),
    base: strip(pyramid.base),
  });
}
