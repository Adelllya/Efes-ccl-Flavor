import { eq, and, sql } from "drizzle-orm";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { flavorProfiles, brands } from "@/db/schema";

async function main() {
  const pool = new pg.Pool({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/app_db" });
  const db = drizzle(pool, { logger: { logQuery: (query, params) => { console.log("SQL:", query.slice(0, 700)); console.log("PARAMS:", JSON.stringify(params).slice(0, 500)); } } });
  const all = await db.select({ id: brands.id }).from(brands);
  const rows = await db
    .select({
      brandId: flavorProfiles.brandId,
      layer: flavorProfiles.layer,
      cnt: sql<number>`count(*)::int`,
    })
    .from(flavorProfiles)
    .where(and(...all.map((b) => eq(flavorProfiles.brandId, b.id))))
    .groupBy(flavorProfiles.brandId, flavorProfiles.layer);
  console.log("drizzle rows:", rows.length);
  await pool.end();
}
main();
