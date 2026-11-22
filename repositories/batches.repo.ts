import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  batches,
  batchItems,
  type BatchItemRow,
  type BatchRow,
  type NewBatchRow,
} from "@/db/schema";

export const batchesRepo = {
  create(input: NewBatchRow): BatchRow {
    const db = getDb();
    return db.insert(batches).values(input).returning().get();
  },

  findById(batchId: string): BatchRow | null {
    const db = getDb();
    return db.select().from(batches).where(eq(batches.id, batchId)).get() ?? null;
  },

  findWithItemsById(
    batchId: string,
  ): { batch: BatchRow; items: BatchItemRow[] } | null {
    const db = getDb();
    const batch =
      db.select().from(batches).where(eq(batches.id, batchId)).get() ?? null;
    if (!batch) return null;

    const items = db
      .select()
      .from(batchItems)
      .where(eq(batchItems.batchId, batchId))
      .orderBy(batchItems.position)
      .all();

    return { batch, items };
  },

  listRecent(limit = 20): BatchRow[] {
    const db = getDb();
    return db
      .select()
      .from(batches)
      .orderBy(desc(batches.createdAt))
      .limit(limit)
      .all();
  },

  updateStatus(
    batchId: string,
    status: BatchRow["status"],
    finishedAt?: number,
  ): BatchRow | null {
    const db = getDb();
    return (
      db
        .update(batches)
        .set({
          status,
          ...(finishedAt !== undefined ? { finishedAt } : {}),
        })
        .where(eq(batches.id, batchId))
        .returning()
        .get() ?? null
    );
  },

  delete(batchId: string): boolean {
    const db = getDb();
    const result = db.delete(batches).where(eq(batches.id, batchId)).run();
    return result.changes > 0;
  },

  findUnfinishedBatches(): BatchRow[] {
    const db = getDb();
    return db
      .select()
      .from(batches)
      .where(inArray(batches.status, ["queued", "running", "paused"]))
      .all();
  },
};
