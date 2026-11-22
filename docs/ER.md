# RetroTube — Entity-Relationship Model (ER)

> **Status:** Design Document (Phase 2 — Playlist Support & Big-Video Reliability)  
> **Database Engine:** SQLite 3 (`better-sqlite3`, `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`)

---

## 1. ER Diagram

```mermaid
erDiagram
    videos ||--o{ formats : "caches available streams for"
    videos ||--o{ download_jobs : "is target of single download"
    formats |o--o{ download_jobs : "is source format for (SET NULL on prune)"
    download_jobs ||--o| history : "produces completed record in"

    batches ||--o{ batch_items : "contains ordered items in"
    videos ||--o{ batch_items : "referenced by cached metadata (SET NULL)"
    download_jobs ||--o| batch_items : "executes item payload (SET NULL)"

    batches {
        text id PK "UUID v4"
        text source_url "Original YouTube playlist URL"
        text youtube_playlist_id "Canonical playlist ID (e.g. PL...)"
        text title "Playlist title"
        text channel "Uploader / Curator channel name"
        integer item_count "Total items discovered in playlist"
        integer selected_count "Total items selected for processing"
        text quality_preset "Preset: best_video | 1080p | 720p | 480p | audio_best | mp3_320 | mp3_192 | mp3_128"
        text kind "video | audio"
        text target_container "mp4 | webm | mkv | mp3 | m4a | opus | flac | wav"
        text status "queued | running | done | failed | cancelled | paused"
        integer created_at "Epoch ms when batch was submitted"
        integer finished_at "Epoch ms when terminal state reached (or NULL)"
    }

    batch_items {
        integer id PK "AUTOINCREMENT"
        text batch_id FK "FK -> batches(id) ON DELETE CASCADE"
        integer video_id FK "FK -> videos(id) ON DELETE SET NULL (nullable)"
        integer position "1-based order index in playlist"
        text youtube_id "11-char YouTube ID"
        text title "Video title snapshot"
        integer duration_sec "Duration in seconds"
        text status "queued | running | done | failed | skipped | cancelled"
        text job_id FK "FK -> download_jobs(id) ON DELETE SET NULL (nullable)"
        text error_code "Error code or NULL if successful"
        integer retry_count "Number of automatic/manual retries (0..2)"
    }

    videos {
        integer id PK "AUTOINCREMENT"
        text youtube_id UK "11-char YouTube ID (unique index)"
        text title "Video title"
        text channel "Channel / uploader name"
        integer duration_sec "Duration in seconds"
        text upload_date "YYYY-MM-DD (nullable)"
        text thumbnail_url "https://i.ytimg.com/..."
        integer fetched_at "Epoch ms (1h cache TTL)"
    }

    formats {
        integer id PK "AUTOINCREMENT"
        integer video_id FK "ON DELETE CASCADE"
        text format_id "yt-dlp format_id (unique per video_id)"
        text kind "video | audio"
        text container "mp4 | webm | m4a | ..."
        text vcodec "Video codec or NULL"
        text acodec "Audio codec or NULL (NULL => merge needed)"
        text resolution "e.g. 1080p, 2160p, or NULL"
        integer width "Pixel width or NULL"
        integer height "Pixel height or NULL"
        real fps "Frame rate or NULL"
        real bitrate_kbps "Total/audio bitrate kbps or NULL"
        integer filesize_bytes "Exact or estimated bytes or NULL"
        integer is_hdr "Boolean (0 or 1)"
        text format_note "Optional yt-dlp format_note"
    }

    download_jobs {
        text id PK "UUID v4"
        integer video_id FK "ON DELETE CASCADE"
        integer format_id FK "ON DELETE SET NULL (nullable)"
        integer batch_item_id FK "ON DELETE SET NULL (nullable, links to batch_items)"
        text source_format_id "Snapshot of yt-dlp format_id"
        text target_container "mp4 | webm | mkv | mp3 | m4a | opus | flac | wav"
        integer target_bitrate_kbps "128 | 192 | 320 for MP3, or NULL"
        integer needs_merge "Boolean (0 or 1)"
        text status "queued | running | done | failed | cancelled | paused"
        real progress_pct "0.0 to 100.0"
        text error_code "Error code or NULL"
        text error_message "Friendly error message or NULL"
        text output_filename "Sanitized download filename"
        text temp_filepath "Absolute temp path or NULL once cleaned"
        integer bytes_total "Output byte size or NULL"
        integer created_at "Epoch ms"
        integer started_at "Epoch ms or NULL"
        integer finished_at "Epoch ms or NULL"
    }

    history {
        integer id PK "AUTOINCREMENT"
        text job_id FK,UK "ON DELETE CASCADE (unique)"
        integer downloaded_at "Epoch ms"
        integer bytes_sent "Bytes streamed to client"
    }

    settings {
        text key PK "Setting key (e.g. storage, server_save_dir)"
        text value "JSON or string setting value"
        integer updated_at "Epoch ms"
    }
```

---

## 2. Relationships & Referential Integrity

| Parent Entity   | Child Entity    | Cardinality | Foreign Key & `ON DELETE` Action                                    | Rationale                                                                                                                                                                                                                  |
| :-------------- | :-------------- | :---------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batches`       | `batch_items`   | `1 : N`     | `batch_items.batch_id -> batches.id` (`ON DELETE CASCADE`)          | Batch items strictly belong to a batch run; deleting a batch cascades to all its item records.                                                                                                                             |
| `videos`        | `batch_items`   | `0..1 : N`  | `batch_items.video_id -> videos.id` (`ON DELETE SET NULL`)          | If a cached video entry expires or is pruned, batch item records remain intact for history and reporting.                                                                                                                  |
| `download_jobs` | `batch_items`   | `0..1 : 1`  | `batch_items.job_id -> download_jobs.id` (`ON DELETE SET NULL`)     | Batch items delegate physical downloading to a `download_jobs` worker execution. If a job is pruned, the item keeps its status and metadata.                                                                              |
| `batch_items`   | `download_jobs` | `0..1 : 1`  | `download_jobs.batch_item_id -> batch_items.id` (`ON DELETE SET NULL`) | Two-way cross-reference allows download job workers to locate parent batch item context directly without redundant table scans.                                                                                            |
| `videos`        | `formats`       | `1 : N`     | `formats.video_id -> videos.id` (`ON DELETE CASCADE`)               | Formats belong strictly to a video snapshot; removing a video cleans up its formats.                                                                                                                                       |
| `videos`        | `download_jobs` | `1 : N`     | `download_jobs.video_id -> videos.id` (`ON DELETE CASCADE`)         | Every job targets a known video; deleting a video cascades to its jobs.                                                                                                                                                    |
| `formats`       | `download_jobs` | `0..1 : N`  | `download_jobs.format_id -> formats.id` (`ON DELETE SET NULL`)      | Refreshing a video's format list after the 1h TTL expires must **not** cascade-delete past `download_jobs` or `history` rows if YouTube drops an old format ID. `source_format_id` preserves the snapshot for re-download. |
| `download_jobs` | `history`       | `1 : 0..1`  | `history.job_id -> download_jobs.id` (`ON DELETE CASCADE`)          | Only completed & streamed jobs create a history record; deleting a job cascades to its history entry.                                                                                                                      |
| `settings`      | _(standalone)_  | `—`         | `—`                                                                 | Key-value persistence for app preferences and storage thresholds.                                                                                                                                                          |

---

## 3. Data Retention & Lifecycle Notes

1. **Batch Lifecycle & Items:**
   - Batches are created via `POST /api/batch`. Each item starts in `queued` state.
   - Items execute through the batch worker with `BATCH_CONCURRENCY` (default 1, max 3) respecting global `MAX_CONCURRENT_JOBS`.
   - Items that fail due to transient errors (network timeout, rate limit) are retried up to 2 times (`retry_count <= 2`) with exponential backoff before transitioning to `failed`.
   - Unavailable or deleted items in a playlist are marked `skipped` with error code `ITEM_UNAVAILABLE` without failing the entire batch.
   - When all items reach a terminal state (`done`, `failed`, `skipped`, `cancelled`), the batch transitions to `done` (or `cancelled` if aborted).
2. **Resumable Downloads & Paused States:**
   - Both `download_jobs` and `batches` support a `paused` state (e.g. triggered by pre-flight disk guard `INSUFFICIENT_DISK` or server shutdown).
   - Partial file downloads (`.part` files) are preserved on disk. When resumed, `yt-dlp` runs with `--continue` to resume downloading from the existing byte offset rather than restarting from zero.
3. **ZIP Delivery & Retention:**
   - Batch completions offer on-the-fly streaming ZIP (`GET /api/batch/[id]/zip`) using `STORE` mode (zero compression) with `ZIP64` extensions.
   - No temporary ZIP archive is created on disk. Files remain on disk in `TEMP_DIR` until `FILE_TTL_MINUTES` (default 120 minutes) expires or until the user triggers a cleanup.
4. **History Cap:** Single-video and batch item history queries return at most 50 newest entries (`ORDER BY downloaded_at DESC LIMIT 50`), pruning records exceeding the 50-item ceiling.
