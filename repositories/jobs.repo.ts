import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  downloadJobs,
  videos,
  type DownloadJobRow,
  type NewDownloadJobRow,
  type VideoRow,
} from "@/db/schema";

export type JobStatus = DownloadJobRow["status"];

export const jobsRepo = {
  create(input: NewDownloadJobRow): DownloadJobRow {
    const db = getDb();
    return db.insert(downloadJobs).values(input).returning().get();
  },

  findById(jobId: string): DownloadJobRow | null {
    const db = getDb();
    return db.select().from(downloadJobs).where(eq(downloadJobs.id, jobId)).get() ?? null;
  },

  findWithVideoById(jobId: string): { job: DownloadJobRow; video: VideoRow } | null {
    const db = getDb();
    const row = db
      .select({
        job: downloadJobs,
        video: videos,
      })
      .from(downloadJobs)
      .innerJoin(videos, eq(downloadJobs.videoId, videos.id))
      .where(eq(downloadJobs.id, jobId))
      .get();

    return row ?? null;
  },

  transitionToRunning(jobId: string, startedAt = Date.now()): DownloadJobRow | null {
    const db = getDb();
    return (
      db
        .update(downloadJobs)
        .set({
          status: "running",
          startedAt,
        })
        .where(and(eq(downloadJobs.id, jobId), eq(downloadJobs.status, "queued")))
        .returning()
        .get() ?? null
    );
  },

  updateProgress(jobId: string, progressPct: number): void {
    const db = getDb();
    const clamped = Math.max(0, Math.min(100, progressPct));
    db.update(downloadJobs)
      .set({ progressPct: clamped })
      .where(and(eq(downloadJobs.id, jobId), eq(downloadJobs.status, "running")))
      .run();
  },

  markDone(
    jobId: string,
    params: { tempFilepath: string; bytesTotal: number; finishedAt?: number },
  ): DownloadJobRow | null {
    const db = getDb();
    return (
      db
        .update(downloadJobs)
        .set({
          status: "done",
          progressPct: 100,
          tempFilepath: params.tempFilepath,
          bytesTotal: params.bytesTotal,
          finishedAt: params.finishedAt ?? Date.now(),
        })
        .where(and(eq(downloadJobs.id, jobId), eq(downloadJobs.status, "running")))
        .returning()
        .get() ?? null
    );
  },

  markFailed(
    jobId: string,
    params: { errorCode: string; errorMessage: string; finishedAt?: number },
  ): DownloadJobRow | null {
    const db = getDb();
    return (
      db
        .update(downloadJobs)
        .set({
          status: "failed",
          errorCode: params.errorCode,
          errorMessage: params.errorMessage,
          tempFilepath: null,
          finishedAt: params.finishedAt ?? Date.now(),
        })
        .where(
          and(
            eq(downloadJobs.id, jobId),
            inArray(downloadJobs.status, ["queued", "running"]),
          ),
        )
        .returning()
        .get() ?? null
    );
  },

  markCancelled(
    jobId: string,
    params?: { errorMessage?: string; finishedAt?: number },
  ): DownloadJobRow | null {
    const db = getDb();
    return (
      db
        .update(downloadJobs)
        .set({
          status: "cancelled",
          errorCode: "JOB_CANCELLED",
          errorMessage: params?.errorMessage ?? "Download was cancelled.",
          tempFilepath: null,
          finishedAt: params?.finishedAt ?? Date.now(),
        })
        .where(
          and(
            eq(downloadJobs.id, jobId),
            inArray(downloadJobs.status, ["queued", "running"]),
          ),
        )
        .returning()
        .get() ?? null
    );
  },

  clearTempFilepath(jobId: string): void {
    const db = getDb();
    db.update(downloadJobs)
      .set({ tempFilepath: null })
      .where(eq(downloadJobs.id, jobId))
      .run();
  },

  clearTempFilepathsByPaths(paths: string[]): number {
    if (paths.length === 0) return 0;
    const db = getDb();
    const res = db
      .update(downloadJobs)
      .set({ tempFilepath: null })
      .where(inArray(downloadJobs.tempFilepath, paths))
      .run();
    return res.changes;
  },

  markStaleJobsAsServerRestart(now = Date.now()): number {
    const db = getDb();
    const res = db
      .update(downloadJobs)
      .set({
        status: "failed",
        errorCode: "SERVER_RESTART",
        errorMessage: "Job was interrupted by a server restart. Please retry.",
        tempFilepath: null,
        finishedAt: now,
      })
      .where(inArray(downloadJobs.status, ["queued", "running"]))
      .run();
    return res.changes;
  },

  listActiveTempFilepaths(): string[] {
    const db = getDb();
    const rows = db
      .select({ tempFilepath: downloadJobs.tempFilepath })
      .from(downloadJobs)
      .where(
        and(eq(downloadJobs.status, "running"), isNotNull(downloadJobs.tempFilepath)),
      )
      .all();
    return rows
      .map((r) => r.tempFilepath)
      .filter((p): p is string => typeof p === "string" && p.length > 0);
  },

  listNonRunningWithTempFile(): DownloadJobRow[] {
    const db = getDb();
    return db
      .select()
      .from(downloadJobs)
      .where(
        and(ne(downloadJobs.status, "running"), isNotNull(downloadJobs.tempFilepath)),
      )
      .all();
  },

  countByStatus(): { running: number; queued: number } {
    const db = getDb();
    const rows = db
      .select({
        status: downloadJobs.status,
        count: sql<number>`count(*)`,
      })
      .from(downloadJobs)
      .where(inArray(downloadJobs.status, ["running", "queued"]))
      .groupBy(downloadJobs.status)
      .all();

    let running = 0;
    let queued = 0;
    for (const row of rows) {
      if (row.status === "running") running = Number(row.count);
      if (row.status === "queued") queued = Number(row.count);
    }
    return { running, queued };
  },
};
