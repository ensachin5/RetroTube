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
    sourceFormatId: text("source_format_id").notNull(),
    targetContainer: text("target_container").notNull(),
    targetBitrateKbps: integer("target_bitrate_kbps"),
    needsMerge: integer("needs_merge", { mode: "boolean" }).notNull().default(false),
    status: text("status", {
      enum: ["queued", "running", "done", "failed", "cancelled"],
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
export type DownloadJobRow = typeof downloadJobs.$inferSelect;
export type NewDownloadJobRow = typeof downloadJobs.$inferInsert;
export type HistoryRow = typeof history.$inferSelect;
export type NewHistoryRow = typeof history.$inferInsert;
export type SettingRow = typeof settings.$inferSelect;
export type NewSettingRow = typeof settings.$inferInsert;
