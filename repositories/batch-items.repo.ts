import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { batchItems, type BatchItemRow, type NewBatchItemRow } from "@/db/schema";

export const batchItemsRepo = {
  createMany(items: NewBatchItemRow[]): BatchItemRow[] {
    if (items.length === 0) return [];
    const db = getDb();
    return db.insert(batchItems).values(items).returning().all();
  },

  findById(id: number): BatchItemRow | null {
    const db = getDb();
    return db.select().from(batchItems).where(eq(batchItems.id, id)).get() ?? null;
  },

  findByBatchId(batchId: string): BatchItemRow[] {
    const db = getDb();
    return db
      .select()
      .from(batchItems)
      .where(eq(batchItems.batchId, batchId))
      .orderBy(asc(batchItems.position))
      .all();
  },

  updateStatus(
    id: number,
    status: BatchItemRow["status"],
    params?: { jobId?: string | null; errorCode?: string | null },
  ): BatchItemRow | null {
    const db = getDb();
    return (
      db
        .update(batchItems)
        .set({
          status,
          ...(params?.jobId !== undefined ? { jobId: params.jobId } : {}),
          ...(params?.errorCode !== undefined ? { errorCode: params.errorCode } : {}),
        })
        .where(eq(batchItems.id, id))
        .returning()
        .get() ?? null
    );
  },

  incrementRetry(id: number): BatchItemRow | null {
    const db = getDb();
    return (
      db
        .update(batchItems)
        .set({
          retryCount: sql`${batchItems.retryCount} + 1`,
          status: "queued",
        })
        .where(eq(batchItems.id, id))
        .returning()
        .get() ?? null
    );
  },

  resetFailedToQueued(batchId: string): number {
    const db = getDb();
    const result = db
      .update(batchItems)
      .set({
        status: "queued",
        errorCode: null,
      })
      .where(and(eq(batchItems.batchId, batchId), eq(batchItems.status, "failed")))
      .run();
    return result.changes;
  },

  findNextQueuedItem(batchId: string): BatchItemRow | null {
    const db = getDb();
    return (
      db
        .select()
        .from(batchItems)
        .where(and(eq(batchItems.batchId, batchId), eq(batchItems.status, "queued")))
        .orderBy(asc(batchItems.position))
        .limit(1)
        .get() ?? null
    );
  },

  countByStatus(batchId: string): Record<string, number> {
    const db = getDb();
    const rows = db
      .select({
        status: batchItems.status,
        count: sql<number>`count(*)`,
      })
      .from(batchItems)
      .where(eq(batchItems.batchId, batchId))
      .groupBy(batchItems.status)
      .all();

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = row.count;
    }
    return counts;
  },
};
