import { NextResponse } from "next/server";
import { runSeed } from "@/lib/seed-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await runSeed();
    return NextResponse.json({ ok: true, message: "Seed data loaded" });
  } catch (e) {
    const anyErr = e as { message?: string; cause?: unknown };
    const causeMsg =
      anyErr.cause instanceof Error ? anyErr.cause.message : String(anyErr.cause ?? "");
    console.error("Seed error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: (anyErr.message ?? String(e)).slice(0, 200),
        cause: causeMsg.slice(0, 500),
      },
      { status: 500 }
    );
  }
}
