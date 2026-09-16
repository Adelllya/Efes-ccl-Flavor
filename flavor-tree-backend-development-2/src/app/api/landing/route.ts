import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { brands, courses, teamMembers, flavorNotes, flavorProfiles } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Aggregating endpoint: everything the landing page needs in ONE request.
 * project info, team, courses, stats, quote.
 */
export async function GET() {
  const [brandCount, noteCount, courseRows, teamRows] = await Promise.all([
    db.select().from(brands).where(undefined),
    db.select().from(flavorNotes),
    db.select().from(courses).orderBy(asc(courses.level)),
    db.select().from(teamMembers),
  ]);

  const profileCountRows = await db.select().from(flavorProfiles);

  return NextResponse.json({
    project: {
      name: "Flavor Tree",
      tagline: "Don't just drink — listen to the flavor",
      description:
        "Платформа сенсорного образования и подбора пива. Каждый сорт раскладывается на «Вкусовую пирамиду»: Top Notes, Heart Notes, Base Notes.",
      partner: "EFES Kazakhstan · One Idea University / Anadolu Group",
      market: "Казахстан",
    },
    quote: {
      text: "Сегодня я услышал пиво, а не просто выпил его. Flavor Tree меняет то, как я отношусь к любимому напитку.",
      author: "Участник пилотной дегустации, Алматы",
    },
    stats: {
      brands: brandCount.length,
      flavorNotes: noteCount.length,
      flavorProfiles: profileCountRows.length,
      courses: courseRows.length,
      teamMembers: teamRows.length,
    },
    courses: courseRows,
    team: teamRows,
    pyramidLayers: [
      { key: "TOP", label: "Top Notes", time: "0–3 сек", color: "#facc15" },
      { key: "HEART", label: "Heart Notes", time: "3–15 сек", color: "#b45309" },
      { key: "BASE", label: "Base Notes", time: "15+ сек", color: "#451a03" },
    ],
  });
}
