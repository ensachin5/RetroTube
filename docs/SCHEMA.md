# RetroTube — Database Schema & Migration Specification

> **Status:** Design Document (Phase 1)  
> **ORM & Driver:** Drizzle ORM (`drizzle-orm/better-sqlite3`) + `better-sqlite3`  
> **Migration File:** [`drizzle/0000_ambitious_epoch.sql`](../drizzle/0000_ambitious_epoch.sql)  
> **Drizzle Schema:** [`db/schema.ts`](../db/schema.ts)

---

## 1. SQLite Runtime PRAGMAs

Executed once on singleton DB initialization in `db/client.ts`:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

- `journal_mode = WAL`: Allows concurrent reads during write transactions without blocking SSE/history reads.
- `foreign_keys = ON`: Enforces `ON DELETE CASCADE` and `ON DELETE SET NULL` strictly per connection.
- `busy_timeout = 5000`: Prevents spurious `SQLITE_BUSY` failures under concurrent API calls.

---

## 2. Table Definitions

### 2.1 `videos`

Caches fetched single-video metadata for 1 hour (`CACHE_TTL_SECONDS = 3600`).

| Column          | SQLite Type | Constraints                                    | Description                                             |
| :-------------- | :---------- | :--------------------------------------------- | :------------------------------------------------------ |
| `id`            | `INTEGER`   | `PRIMARY KEY AUTOINCREMENT`                    | Internal surrogate PK                                   |
| `youtube_id`    | `TEXT`      | `NOT NULL`, `UNIQUE` (`idx_videos_youtube_id`) | Canonical 11-character YouTube video ID                 |
| `title`         | `TEXT`      | `NOT NULL`                                     | Video title                                             |
| `channel`       | `TEXT`      | `NOT NULL`                                     | Channel / uploader display name                         |
| `duration_sec`  | `INTEGER`   | `NOT NULL`                                     | Duration in whole seconds (`>= 0`)                      |
| `upload_date`   | `TEXT`      | Nullable                                       | Normalized `YYYY-MM-DD` upload date                     |
| `thumbnail_url` | `TEXT`      | `NOT NULL`                                     | HTTPS thumbnail URL (`i.ytimg.com`)                     |
| `fetched_at`    | `INTEGER`   | `NOT NULL`                                     | Epoch milliseconds of last successful `yt-dlp -J` fetch |

### 2.2 `formats`

Stores every normalized video and audio stream returned by `yt-dlp -J`.

| Column           | SQLite Type | Constraints                                      | Description                                             |
| :--------------- | :---------- | :----------------------------------------------- | :------------------------------------------------------ |
| `id`             | `INTEGER`   | `PRIMARY KEY AUTOINCREMENT`                      | Internal surrogate PK                                   |
| `video_id`       | `INTEGER`   | `NOT NULL`, `FK -> videos(id) ON DELETE CASCADE` | Parent video                                            |
| `format_id`      | `TEXT`      | `NOT NULL`                                       | Raw `yt-dlp` format identifier (e.g., `"137"`, `"251"`) |
| `kind`           | `TEXT`      | `NOT NULL` (`'video' \| 'audio'`)                | Stream category                                         |
| `container`      | `TEXT`      | `NOT NULL`                                       | Container extension (`mp4`, `webm`, `m4a`, etc.)        |
| `vcodec`         | `TEXT`      | Nullable                                         | Video codec (`av01...`, `vp9`, `avc1...`) or `NULL`     |
| `acodec`         | `TEXT`      | Nullable                                         | Audio codec (`mp4a...`, `opus`) or `NULL` (video-only)  |
| `resolution`     | `TEXT`      | Nullable                                         | Human label (`1080p`, `2160p`, `4320p`, etc.)           |
| `width`          | `INTEGER`   | Nullable                                         | Pixel width                                             |
| `height`         | `INTEGER`   | Nullable                                         | Pixel height                                            |
| `fps`            | `REAL`      | Nullable                                         | Frames per second                                       |
| `bitrate_kbps`   | `REAL`      | Nullable                                         | Total or audio bitrate in kbps                          |
| `filesize_bytes` | `INTEGER`   | Nullable                                         | Exact or approximate estimated byte size                |
| `is_hdr`         | `INTEGER`   | `NOT NULL DEFAULT 0`                             | Boolean (`0` = SDR, `1` = HDR10/HLG/Dolby Vision)       |
| `format_note`    | `TEXT`      | Nullable                                         | Descriptive `yt-dlp` note (`"1080p60"`, `"medium"`)     |

- **Indexes:**
  - `idx_formats_video_format_unique` (`UNIQUE` on `(video_id, format_id)`)
  - `idx_formats_video_id` (on `video_id`)

### 2.3 `download_jobs`

Tracks queued, active, completed, failed, and cancelled download/merge/conversion jobs.

| Column                | SQLite Type | Constraints                                      | Description                                                                  |
| :-------------------- | :---------- | :----------------------------------------------- | :--------------------------------------------------------------------------- |
| `id`                  | `TEXT`      | `PRIMARY KEY NOT NULL`                           | UUID v4 job identifier                                                       |
| `video_id`            | `INTEGER`   | `NOT NULL`, `FK -> videos(id) ON DELETE CASCADE` | Target video                                                                 |
| `format_id`           | `INTEGER`   | Nullable, `FK -> formats(id) ON DELETE SET NULL` | Source format row (`SET NULL` if pruned on refresh)                          |
| `source_format_id`    | `TEXT`      | `NOT NULL`                                       | Snapshot of `yt-dlp` `format_id` string                                      |
| `target_container`    | `TEXT`      | `NOT NULL`                                       | Output container (`mp4`, `webm`, `mkv`, `mp3`, `m4a`, `opus`, `flac`, `wav`) |
| `target_bitrate_kbps` | `INTEGER`   | Nullable                                         | Target bitrate (`128`, `192`, `320`) for MP3 conversions                     |
| `needs_merge`         | `INTEGER`   | `NOT NULL DEFAULT 0`                             | Boolean (`1` when video+audio merge or audio conversion is required)         |
| `status`              | `TEXT`      | `NOT NULL DEFAULT 'queued'`                      | `queued \| running \| done \| failed \| cancelled`                           |
| `progress_pct`        | `REAL`      | `NOT NULL DEFAULT 0`                             | Progress `0.0` .. `100.0`                                                    |
| `error_code`          | `TEXT`      | Nullable                                         | Standardized error code when `failed` / `cancelled`                          |
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

### 2.4 `history`

Stores up to the last 50 completed downloads for quick delete and re-download.

| Column          | SQLite Type | Constraints                                                       | Description                     |
| :-------------- | :---------- | :---------------------------------------------------------------- | :------------------------------ |
| `id`            | `INTEGER`   | `PRIMARY KEY AUTOINCREMENT`                                       | Surrogate PK                    |
| `job_id`        | `TEXT`      | `NOT NULL`, `UNIQUE`, `FK -> download_jobs(id) ON DELETE CASCADE` | Associated job                  |
| `downloaded_at` | `INTEGER`   | `NOT NULL`                                                        | Epoch ms when downloaded        |
| `bytes_sent`    | `INTEGER`   | `NOT NULL DEFAULT 0`                                              | Total bytes streamed to browser |

- **Indexes:**
  - `idx_history_job_id` (`UNIQUE` on `job_id`)
  - `idx_history_downloaded_at` (on `downloaded_at`)

### 2.5 `settings`

Lightweight key-value preferences store.

| Column       | SQLite Type | Constraints            | Description             |
| :----------- | :---------- | :--------------------- | :---------------------- |
| `key`        | `TEXT`      | `PRIMARY KEY NOT NULL` | Setting identifier      |
| `value`      | `TEXT`      | `NOT NULL`             | Setting value           |
| `updated_at` | `INTEGER`   | `NOT NULL`             | Epoch ms of last update |

---

## 3. Drizzle ORM Schema (`db/schema.ts`)

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
```

---

## 4. Initial SQL Migration (`drizzle/0000_ambitious_epoch.sql`)

```sql
CREATE TABLE `download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` integer NOT NULL,
	`format_id` integer,
	`source_format_id` text NOT NULL,
	`target_container` text NOT NULL,
	`target_bitrate_kbps` integer,
	`needs_merge` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress_pct` real DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`output_filename` text NOT NULL,
	`temp_filepath` text,
	`bytes_total` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_download_jobs_status` ON `download_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_download_jobs_created_at` ON `download_jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_download_jobs_video_id` ON `download_jobs` (`video_id`);--> statement-breakpoint
CREATE TABLE `formats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` integer NOT NULL,
	`format_id` text NOT NULL,
	`kind` text NOT NULL,
	`container` text NOT NULL,
	`vcodec` text,
	`acodec` text,
	`resolution` text,
	`width` integer,
	`height` integer,
	`fps` real,
	`bitrate_kbps` real,
	`filesize_bytes` integer,
	`is_hdr` integer DEFAULT false NOT NULL,
	`format_note` text,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_formats_video_format_unique` ON `formats` (`video_id`,`format_id`);--> statement-breakpoint
CREATE INDEX `idx_formats_video_id` ON `formats` (`video_id`);--> statement-breakpoint
CREATE TABLE `history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`downloaded_at` integer NOT NULL,
	`bytes_sent` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `download_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_history_job_id` ON `history` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_history_downloaded_at` ON `history` (`downloaded_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`youtube_id` text NOT NULL,
	`title` text NOT NULL,
	`channel` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`upload_date` text,
	`thumbnail_url` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_videos_youtube_id` ON `videos` (`youtube_id`);
```
