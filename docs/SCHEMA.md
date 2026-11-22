# RetroTube — Database Schema & Migration Specification

> **Status:** Design Document (Phase 2 — Playlist Support & Big-Video Reliability)  
> **ORM & Driver:** Drizzle ORM (`drizzle-orm/better-sqlite3`) + `better-sqlite3`  
> **V1 Migration:** [`drizzle/0000_ambitious_epoch.sql`](../drizzle/0000_ambitious_epoch.sql)  
> **V2 Migration:** [`drizzle/0001_v2_batches.sql`](../drizzle/0001_v2_batches.sql)  
> **Drizzle Schema:** [`db/schema.ts`](../db/schema.ts)

---

## 1. SQLite Runtime PRAGMAs

Executed once on singleton DB initialization in `db/client.ts`:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -2000;
PRAGMA journal_size_limit = 6144000;
```

- `journal_mode = WAL`: Allows concurrent reads during write transactions without blocking SSE/history reads.
- `foreign_keys = ON`: Enforces `ON DELETE CASCADE` and `ON DELETE SET NULL` strictly per connection.
- `busy_timeout = 5000`: Prevents spurious `SQLITE_BUSY` failures under concurrent batch processing and SSE events.
- `temp_store = MEMORY`: Directs temporary tables and indexes to RAM.
- `cache_size = -2000`: Binds SQLite page cache to ~2 MB RAM to maintain a lightweight footprint.
- `journal_size_limit = 6144000`: Caps WAL checkpoint size at ~6 MB.

---

## 2. Table Definitions

### 2.1 `batches` (New in V2)

Represents a playlist download batch containing multiple selected items.

| Column                 | SQLite Type | Constraints                                                      | Description                                                                                 |
| :--------------------- | :---------- | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| `id`                   | `TEXT`      | `PRIMARY KEY NOT NULL`                                           | UUID v4 batch identifier                                                                    |
| `source_url`           | `TEXT`      | `NOT NULL`                                                       | Full original YouTube playlist URL                                                          |
| `youtube_playlist_id`  | `TEXT`      | `NOT NULL`                                                       | Canonical playlist ID (e.g., `PL...`, `RD...`)                                              |
| `title`                | `TEXT`      | `NOT NULL`                                                       | Playlist title snapshot                                                                     |
| `channel`              | `TEXT`      | `NOT NULL`                                                       | Playlist uploader / curator name                                                            |
| `item_count`           | `INTEGER`   | `NOT NULL`                                                       | Total number of items discovered in the playlist                                            |
| `selected_count`       | `INTEGER`   | `NOT NULL`                                                       | Total number of items chosen by user to download                                            |
| `quality_preset`       | `TEXT`      | `NOT NULL`                                                       | Preset: `'best_video' \| '1080p' \| '720p' \| '480p' \| 'audio_best' \| 'mp3_320' \| ...`  |
| `kind`                 | `TEXT`      | `NOT NULL`                                                       | `'video' \| 'audio'`                                                                        |
| `target_container`     | `TEXT`      | `NOT NULL`                                                       | Output format: `'mp4' \| 'webm' \| 'mkv' \| 'mp3' \| 'm4a' \| 'opus' \| 'flac' \| 'wav'`    |
| `status`               | `TEXT`      | `NOT NULL DEFAULT 'queued'`                                      | `'queued' \| 'running' \| 'done' \| 'failed' \| 'cancelled' \| 'paused'`                    |
| `created_at`           | `INTEGER`   | `NOT NULL`                                                       | Epoch milliseconds when created                                                             |
| `finished_at`          | `INTEGER`   | Nullable                                                         | Epoch milliseconds when finished or cancelled                                               |

- **Indexes:**
  - `idx_batches_status` (on `status`)
  - `idx_batches_created_at` (on `created_at`)
  - `idx_batches_playlist_id` (on `youtube_playlist_id`)

---

### 2.2 `batch_items` (New in V2)

Individual video items belonging to a batch execution.

| Column         | SQLite Type | Constraints                                                                | Description                                                                  |
| :------------- | :---------- | :------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| `id`           | `INTEGER`   | `PRIMARY KEY AUTOINCREMENT NOT NULL`                                       | Surrogate item identifier                                                    |
| `batch_id`     | `TEXT`      | `NOT NULL, FK -> batches(id) ON DELETE CASCADE`                            | Parent batch                                                                 |
| `video_id`     | `INTEGER`   | Nullable, `FK -> videos(id) ON DELETE SET NULL`                            | Linked video cache row (if metadata was fetched)                             |
| `position`     | `INTEGER`   | `NOT NULL`                                                                 | 1-based order index in the playlist                                          |
| `youtube_id`   | `TEXT`      | `NOT NULL`                                                                 | 11-character YouTube video ID                                                |
| `title`        | `TEXT`      | `NOT NULL`                                                                 | Snapshot of item title                                                       |
| `duration_sec` | `INTEGER`   | `NOT NULL DEFAULT 0`                                                       | Duration in seconds                                                          |
| `status`       | `TEXT`      | `NOT NULL DEFAULT 'queued'`                                                | `'queued' \| 'running' \| 'done' \| 'failed' \| 'skipped' \| 'cancelled'`    |
| `job_id`       | `TEXT`      | Nullable, `FK -> download_jobs(id) ON DELETE SET NULL`                     | Linked download worker job                                                   |
| `error_code`   | `TEXT`      | Nullable                                                                   | Error code if `failed` or `skipped` (e.g. `ITEM_UNAVAILABLE`)                |
| `retry_count`  | `INTEGER`   | `NOT NULL DEFAULT 0`                                                       | Count of automatic/manual retry attempts (`0..2`)                            |

- **Indexes:**
  - `idx_batch_items_batch_id` (on `batch_id`)
  - `idx_batch_items_status` (on `status`)
  - `idx_batch_items_youtube_id` (on `youtube_id`)
  - `idx_batch_items_job_id` (on `job_id`)

---

### 2.3 `download_jobs` (Updated for V2)

Tracks queued, active, completed, failed, cancelled, and paused download/merge/conversion jobs.

| Column                | SQLite Type | Constraints                                      | Description                                                                  |
| :-------------------- | :---------- | :----------------------------------------------- | :--------------------------------------------------------------------------- |
| `id`                  | `TEXT`      | `PRIMARY KEY NOT NULL`                           | UUID v4 job identifier                                                       |
| `video_id`            | `INTEGER`   | `NOT NULL`, `FK -> videos(id) ON DELETE CASCADE` | Target video                                                                 |
| `format_id`           | `INTEGER`   | Nullable, `FK -> formats(id) ON DELETE SET NULL` | Source format row (`SET NULL` if pruned on refresh)                          |
| `batch_item_id`       | `INTEGER`   | Nullable, `FK -> batch_items(id) ON DELETE SET NULL` | **New in V2:** Linked batch item if part of a batch                          |
| `source_format_id`    | `TEXT`      | `NOT NULL`                                       | Snapshot of `yt-dlp` `format_id` string                                      |
| `target_container`    | `TEXT`      | `NOT NULL`                                       | Output container (`mp4`, `webm`, `mkv`, `mp3`, `m4a`, `opus`, `flac`, `wav`) |
| `target_bitrate_kbps` | `INTEGER`   | Nullable                                         | Target bitrate (`128`, `192`, `320`) for MP3 conversions                     |
| `needs_merge`         | `INTEGER`   | `NOT NULL DEFAULT 0`                             | Boolean (`1` when video+audio merge or audio conversion is required)         |
| `status`              | `TEXT`      | `NOT NULL DEFAULT 'queued'`                      | `'queued' \| 'running' \| 'done' \| 'failed' \| 'cancelled' \| 'paused'`     |
| `progress_pct`        | `REAL`      | `NOT NULL DEFAULT 0`                             | Progress `0.0` .. `100.0`                                                    |
| `error_code`          | `TEXT`      | Nullable                                         | Standardized error code when `failed`, `cancelled`, or `paused`              |
| `error_message`       | `TEXT`      | Nullable                                         | Friendly error description                                                   |
| `output_filename`     | `TEXT`      | `NOT NULL`                                       | Sanitized download filename                                                  |
| `temp_filepath`       | `TEXT`      | Nullable                                         | Path to staged temp file (`NULL` once deleted)                               |
| `bytes_total`         | `INTEGER`   | Nullable                                         | Final file size in bytes                                                     |
| `created_at`          | `INTEGER`   | `NOT NULL`                                       | Epoch ms when enqueued                                                       |
| `started_at`          | `INTEGER`   | Nullable                                         | Epoch ms when worker started                                                 |
| `finished_at`         | `INTEGER`   | Nullable                                         | Epoch ms when terminal state reached                                         |

- **Indexes:**
  - `idx_download_jobs_status` (on `status`)
  - `idx_download_jobs_created_at` (on `created_at`)
  - `idx_download_jobs_video_id` (on `video_id`)
  - `idx_download_jobs_batch_item_id` (on `batch_item_id`) — **New in V2**

---

### 2.4 Existing Tables (`videos`, `formats`, `history`, `settings`)

These tables retain their existing V1 definitions without breaking changes:
- `videos`: Caches single-video metadata (11-character YouTube ID unique index).
- `formats`: Normalized formats for cached videos (`idx_formats_video_format_unique`).
- `history`: Last 50 completed downloads (`job_id` unique FK).
- `settings`: Key-value configuration for theme, storage reserve thresholds, and server save directory.

---

## 3. Drizzle ORM Schema Specification (`db/schema.ts`)

```ts
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
    batchItemId: integer("batch_item_id").references(() => batchItems.id, {
      onDelete: "set null",
    }),
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
```

---

## 4. Incremental Migration (`drizzle/0001_v2_batches.sql`)

Non-breaking migration script that preserves all existing tables, rows, and relationships:

```sql
-- 1. Create batches table
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`youtube_playlist_id` text NOT NULL,
	`title` text NOT NULL,
	`channel` text NOT NULL,
	`item_count` integer NOT NULL,
	`selected_count` integer NOT NULL,
	`quality_preset` text NOT NULL,
	`kind` text NOT NULL,
	`target_container` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_batches_status` ON `batches` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_batches_created_at` ON `batches` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_batches_playlist_id` ON `batches` (`youtube_playlist_id`);
--> statement-breakpoint

-- 2. Create batch_items table
CREATE TABLE `batch_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`video_id` integer,
	`position` integer NOT NULL,
	`youtube_id` text NOT NULL,
	`title` text NOT NULL,
	`duration_sec` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`job_id` text,
	`error_code` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `download_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_batch_items_batch_id` ON `batch_items` (`batch_id`);
--> statement-breakpoint
CREATE INDEX `idx_batch_items_status` ON `batch_items` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_batch_items_youtube_id` ON `batch_items` (`youtube_id`);
--> statement-breakpoint
CREATE INDEX `idx_batch_items_job_id` ON `batch_items` (`job_id`);
--> statement-breakpoint

-- 3. Add batch_item_id column and index to download_jobs
ALTER TABLE `download_jobs` ADD COLUMN `batch_item_id` integer REFERENCES `batch_items`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `idx_download_jobs_batch_item_id` ON `download_jobs` (`batch_item_id`);
```

---

## 5. Migration Execution Strategy

- Drizzle migration runner in `db/migrate.ts` executes automatically during server initialization in `instrumentation.ts`.
- Migrations run inside a transaction with `PRAGMA foreign_keys = OFF` during DDL alter and restored to `PRAGMA foreign_keys = ON` immediately after commit.
- Existing database contents from V1 (`videos`, `formats`, `download_jobs`, `history`) are unaffected and remain fully backward-compatible.
