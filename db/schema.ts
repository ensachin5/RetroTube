import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const videos = sqliteTable(
  "videos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    youtubeId: text("youtube_id").notNull(),
    title: text("title").notNull(),
    channel: text("channel").notNull(),
    durationSec: integer("duration_sec").notNull(),
    uploadDate: text("upload_date"),
    thumbnailUrl: text("thumbnail_url").notNull(),
    fetchedAt: integer("fetched_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("idx_videos_youtube_id").on(table.youtubeId)],
);

export const formats = sqliteTable(
  "formats",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    videoId: integer("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    formatId: text("format_id").notNull(),
    kind: text("kind", { enum: ["video", "audio"] }).notNull(),
    container: text("container").notNull(),
    vcodec: text("vcodec"),
    acodec: text("acodec"),
    resolution: text("resolution"),
    width: integer("width"),
    height: integer("height"),
    fps: real("fps"),
    bitrateKbps: real("bitrate_kbps"),
    filesizeBytes: integer("filesize_bytes"),
    isHdr: integer("is_hdr", { mode: "boolean" }).notNull().default(false),
    formatNote: text("format_note"),
  },
  (table) => [
    uniqueIndex("idx_formats_video_format_unique").on(table.videoId, table.formatId),
    index("idx_formats_video_id").on(table.videoId),
  ],
);

export const batches = sqliteTable(
  "batches",
  {
    id: text("id").primaryKey(),
    sourceUrl: text("source_url").notNull(),
    youtubePlaylistId: text("youtube_playlist_id").notNull(),
    title: text("title").notNull(),
    channel: text("channel").notNull(),
    itemCount: integer("item_count").notNull(),
    selectedCount: integer("selected_count").notNull(),
    qualityPreset: text("quality_preset").notNull(),
    kind: text("kind", { enum: ["video", "audio"] }).notNull(),
    targetContainer: text("target_container").notNull(),
    status: text("status", {
      enum: ["queued", "running", "done", "failed", "cancelled", "paused"],
    })
      .notNull()
      .default("queued"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    finishedAt: integer("finished_at", { mode: "number" }),
  },
  (table) => [
    index("idx_batches_status").on(table.status),
    index("idx_batches_created_at").on(table.createdAt),
    index("idx_batches_playlist_id").on(table.youtubePlaylistId),
  ],
);

export const batchItems = sqliteTable(
  "batch_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    videoId: integer("video_id").references(() => videos.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    youtubeId: text("youtube_id").notNull(),
    title: text("title").notNull(),
    durationSec: integer("duration_sec").notNull().default(0),
    status: text("status", {
      enum: ["queued", "running", "done", "failed", "skipped", "cancelled"],
    })
      .notNull()
      .default("queued"),
    jobId: text("job_id").references(() => downloadJobs.id, { onDelete: "set null" }),
    errorCode: text("error_code"),
    retryCount: integer("retry_count").notNull().default(0),
  },
  (table) => [
    index("idx_batch_items_batch_id").on(table.batchId),
    index("idx_batch_items_status").on(table.status),
    index("idx_batch_items_youtube_id").on(table.youtubeId),
    index("idx_batch_items_job_id").on(table.jobId),
  ],
);

export const downloadJobs = sqliteTable(
  "download_jobs",
  {
    id: text("id").primaryKey(),
    videoId: integer("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    formatId: integer("format_id").references(() => formats.id, {
      onDelete: "set null",
    }),
    batchItemId: integer("batch_item_id"),
    sourceFormatId: text("source_format_id").notNull(),
    targetContainer: text("target_container").notNull(),
    targetBitrateKbps: integer("target_bitrate_kbps"),
    needsMerge: integer("needs_merge", { mode: "boolean" }).notNull().default(false),
    status: text("status", {
      enum: ["queued", "running", "done", "failed", "cancelled", "paused"],
    })
      .notNull()
      .default("queued"),
    progressPct: real("progress_pct").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    outputFilename: text("output_filename").notNull(),
    tempFilepath: text("temp_filepath"),
    bytesTotal: integer("bytes_total"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    startedAt: integer("started_at", { mode: "number" }),
    finishedAt: integer("finished_at", { mode: "number" }),
  },
  (table) => [
    index("idx_download_jobs_status").on(table.status),
    index("idx_download_jobs_created_at").on(table.createdAt),
    index("idx_download_jobs_video_id").on(table.videoId),
    index("idx_download_jobs_batch_item_id").on(table.batchItemId),
  ],
);

export const history = sqliteTable(
  "history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => downloadJobs.id, { onDelete: "cascade" }),
    downloadedAt: integer("downloaded_at", { mode: "number" }).notNull(),
    bytesSent: integer("bytes_sent").notNull().default(0),
  },
  (table) => [
    uniqueIndex("idx_history_job_id").on(table.jobId),
    index("idx_history_downloaded_at").on(table.downloadedAt),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export type VideoRow = typeof videos.$inferSelect;
export type NewVideoRow = typeof videos.$inferInsert;
export type FormatRow = typeof formats.$inferSelect;
export type NewFormatRow = typeof formats.$inferInsert;
export type BatchRow = typeof batches.$inferSelect;
export type NewBatchRow = typeof batches.$inferInsert;
export type BatchItemRow = typeof batchItems.$inferSelect;
export type NewBatchItemRow = typeof batchItems.$inferInsert;
export type DownloadJobRow = typeof downloadJobs.$inferSelect;
export type NewDownloadJobRow = typeof downloadJobs.$inferInsert;
export type HistoryRow = typeof history.$inferSelect;
export type NewHistoryRow = typeof history.$inferInsert;
export type SettingRow = typeof settings.$inferSelect;
export type NewSettingRow = typeof settings.$inferInsert;
