import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getEnv } from "@/lib/env";
import { runDatabaseMigrations } from "./migrate";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

interface DbSingleton {
  dbPath: string;
  sqlite: Database.Database;
  db: AppDatabase;
  migrated: boolean;
}

const globalForDb = globalThis as typeof globalThis & {
  __retrotubeDb?: DbSingleton;
};

function ensureDbParentDirectory(dbPath: string): void {
  if (dbPath === ":memory:" || dbPath.startsWith("file:")) {
    return;
  }
  const dir = path.dirname(path.resolve(dbPath));
  fs.mkdirSync(dir, { recursive: true });
}

function configurePragmas(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("cache_size = -2000"); // 2 MB cache cap for ultra-lean memory usage
  sqlite.pragma("journal_size_limit = 6144000"); // 6 MB WAL cap to prevent disk bloat
}

function createDbSingleton(dbPath: string): DbSingleton {
  ensureDbParentDirectory(dbPath);
  const sqlite = new Database(dbPath);
  configurePragmas(sqlite);
  const db = drizzle(sqlite, { schema });
  runDatabaseMigrations(db);
  return {
    dbPath,
    sqlite,
    db,
    migrated: true,
  };
}

export function getDb(): AppDatabase {
  const configuredPath = getEnv().DB_PATH;
  const existing = globalForDb.__retrotubeDb;

  if (existing && existing.dbPath === configuredPath) {
    return existing.db;
  }

  if (existing) {
    try {
      existing.sqlite.close();
    } catch {
      // Ignore close error when reinitializing for a different DB_PATH
    }
  }

  const created = createDbSingleton(configuredPath);
  globalForDb.__retrotubeDb = created;
  return created.db;
}

export function ensureDbMigrated(): void {
  getDb();
}

export function closeDb(): void {
  const existing = globalForDb.__retrotubeDb;
  if (!existing) return;
  try {
    existing.sqlite.close();
  } finally {
    globalForDb.__retrotubeDb = undefined;
  }
}
