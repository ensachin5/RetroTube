import { desc, eq, notInArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { downloadJobs, history, videos, type HistoryRow } from "@/db/schema";

const MAX_HISTORY_ITEMS = 50;

export interface HistoryItemWithDetails {
  id: number;
  jobId: string;
  downloadedAt: number;
  bytesSent: number;
  outputFilename: string;
  targetContainer: string;
  targetBitrateKbps: number | null;
  sourceFormatId: string;
  formatId: number | null;
  video: {
    id: number;
    youtubeId: string;
    title: string;
    channel: string;
    durationSec: number;
    thumbnailUrl: string;
  };
}

export const historyRepo = {
  upsertAndPrune(params: {
    jobId: string;
    bytesSent: number;
    downloadedAt?: number;
  }): HistoryRow {
    const db = getDb();
    const downloadedAt = params.downloadedAt ?? Date.now();

    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(history)
        .where(eq(history.jobId, params.jobId))
        .get();

      let saved: HistoryRow;
      if (existing) {
        saved = tx
          .update(history)
          .set({
            downloadedAt,
            bytesSent: Math.max(existing.bytesSent, params.bytesSent),
          })
          .where(eq(history.id, existing.id))
          .returning()
          .get();
      } else {
        saved = tx
          .insert(history)
          .values({
            jobId: params.jobId,
            downloadedAt,
            bytesSent: params.bytesSent,
          })
          .returning()
          .get();
      }

      // Enforce hard cap of latest 50 rows in SQLite
      const keepIds = tx
        .select({ id: history.id })
        .from(history)
        .orderBy(desc(history.downloadedAt), desc(history.id))
        .limit(MAX_HISTORY_ITEMS)
        .all()
        .map((r) => r.id);

      if (keepIds.length === MAX_HISTORY_ITEMS) {
        tx.delete(history).where(notInArray(history.id, keepIds)).run();
      }

      return saved;
    });
  },

  listLatest(limit = MAX_HISTORY_ITEMS): HistoryItemWithDetails[] {
    const db = getDb();
    const capped = Math.max(1, Math.min(MAX_HISTORY_ITEMS, limit));

    const rows = db
      .select({
        id: history.id,
        jobId: history.jobId,
        downloadedAt: history.downloadedAt,
        bytesSent: history.bytesSent,
        outputFilename: downloadJobs.outputFilename,
        targetContainer: downloadJobs.targetContainer,
        targetBitrateKbps: downloadJobs.targetBitrateKbps,
        sourceFormatId: downloadJobs.sourceFormatId,
        formatId: downloadJobs.formatId,
        videoId: videos.id,
        youtubeId: videos.youtubeId,
        title: videos.title,
        channel: videos.channel,
        durationSec: videos.durationSec,
        thumbnailUrl: videos.thumbnailUrl,
      })
      .from(history)
      .innerJoin(downloadJobs, eq(history.jobId, downloadJobs.id))
      .innerJoin(videos, eq(downloadJobs.videoId, videos.id))
      .orderBy(desc(history.downloadedAt), desc(history.id))
      .limit(capped)
      .all();

    return rows.map((row) => ({
      id: row.id,
      jobId: row.jobId,
      downloadedAt: row.downloadedAt,
      bytesSent: row.bytesSent,
      outputFilename: row.outputFilename,
      targetContainer: row.targetContainer,
      targetBitrateKbps: row.targetBitrateKbps,
      sourceFormatId: row.sourceFormatId,
      formatId: row.formatId,
      video: {
        id: row.videoId,
        youtubeId: row.youtubeId,
        title: row.title,
        channel: row.channel,
        durationSec: row.durationSec,
        thumbnailUrl: row.thumbnailUrl,
      },
    }));
  },

  findById(id: number): HistoryRow | null {
    const db = getDb();
    return db.select().from(history).where(eq(history.id, id)).get() ?? null;
  },

  deleteById(id: number): boolean {
    const db = getDb();
    const res = db.delete(history).where(eq(history.id, id)).run();
    return res.changes > 0;
  },

  clearAll(): number {
    const db = getDb();
    const res = db.delete(history).run();
    return res.changes;
  },
};
