import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings, type SettingRow } from "@/db/schema";

export const settingsRepo = {
  get(key: string): string | null {
    const db = getDb();
    const row = db.select().from(settings).where(eq(settings.key, key)).get();
    return row?.value ?? null;
  },

  set(key: string, value: string, updatedAt = Date.now()): SettingRow {
    const db = getDb();
    return db
      .insert(settings)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt },
      })
      .returning()
      .get();
  },

  ping(): boolean {
    const db = getDb();
    const row = db.get<{ ok: number }>(sql`SELECT 1 AS ok`);
    return row?.ok === 1;
  },
};
