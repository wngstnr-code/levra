import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
/** Any fixed number; every service that migrates takes the same lock, so two never migrate at once. */
const MIGRATION_LOCK = 7_262_001;

export async function runMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK})`);
    try {
      await migrate(db, { migrationsFolder });
    } finally {
      await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK})`);
    }
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(url);
}
