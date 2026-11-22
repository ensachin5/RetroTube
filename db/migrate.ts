import fs from "node:fs";
import path from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type * as schema from "./schema";

function resolveMigrationsFolder(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(__dirname, "..", "drizzle"),
    path.resolve(__dirname, "drizzle"),
    "/var/task/drizzle",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return candidate;
    }
  }
  return null;
}

export function runDatabaseMigrations(db: BetterSQLite3Database<typeof schema>): void {
  const migrationsFolder = resolveMigrationsFolder();
  if (migrationsFolder) {
    try {
      migrate(db, { migrationsFolder });
      return;
    } catch (err) {
      console.warn("[RetroTube DB] Migration warning:", err);
    }
  }
}
