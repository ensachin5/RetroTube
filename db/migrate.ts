import fs from "node:fs";
import path from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type * as schema from "./schema";

function resolveMigrationsFolder(): string {
  const cwdCandidate = path.resolve(process.cwd(), "drizzle");
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }
  const relativeCandidate = path.resolve(__dirname, "..", "drizzle");
  if (fs.existsSync(relativeCandidate)) {
    return relativeCandidate;
  }
  throw new Error(
    `Drizzle migrations directory not found. Checked: ${cwdCandidate} and ${relativeCandidate}`,
  );
}

export function runDatabaseMigrations(db: BetterSQLite3Database<typeof schema>): void {
  const migrationsFolder = resolveMigrationsFolder();
  migrate(db, { migrationsFolder });
}
