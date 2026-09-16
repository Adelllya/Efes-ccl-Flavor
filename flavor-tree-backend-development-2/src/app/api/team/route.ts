import { NextResponse } from "next/server";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(teamMembers);
  return NextResponse.json(rows);
}
