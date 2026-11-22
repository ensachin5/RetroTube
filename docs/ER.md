# RetroTube — Entity-Relationship Model (ER)

> **Status:** Design Document (Phase 1)  
> **Database Engine:** SQLite 3 (`better-sqlite3`, `PRAGMA foreign_keys = ON`)

---

## 1. ER Diagram

```mermaid
erDiagram
    videos ||--o{ formats : "caches available streams for"
    videos ||--o{ download_jobs : "is target of"
    formats |o--o{ download_jobs : "is source format for (SET NULL on stale format)"
    download_jobs ||--o| history : "produces completed record in"

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
        text source_format_id "Snapshot of yt-dlp format_id"
        text target_container "mp4 | webm | mkv | mp3 | m4a | opus | flac | wav"
        integer target_bitrate_kbps "128 | 192 | 320 for MP3, or NULL"
        integer needs_merge "Boolean (0 or 1)"
        text status "queued | running | done | failed | cancelled"
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
        text key PK "Setting key (e.g. theme)"
        text value "JSON or string setting value"
        integer updated_at "Epoch ms"
    }
```

---

## 2. Relationships & Referential Integrity

| Parent Entity   | Child Entity    | Cardinality | Foreign Key & `ON DELETE` Action                               | Rationale                                                                                                                                                                                                                  |
| :-------------- | :-------------- | :---------- | :------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `videos`        | `formats`       | `1 : N`     | `formats.video_id -> videos.id` (`ON DELETE CASCADE`)          | Formats belong strictly to a video snapshot; removing a video cleans up its formats.                                                                                                                                       |
| `videos`        | `download_jobs` | `1 : N`     | `download_jobs.video_id -> videos.id` (`ON DELETE CASCADE`)    | Every job targets a known video; deleting a video cascades to its jobs.                                                                                                                                                    |
| `formats`       | `download_jobs` | `0..1 : N`  | `download_jobs.format_id -> formats.id` (`ON DELETE SET NULL`) | Refreshing a video's format list after the 1h TTL expires must **not** cascade-delete past `download_jobs` or `history` rows if YouTube drops an old format ID. `source_format_id` preserves the snapshot for re-download. |
| `download_jobs` | `history`       | `1 : 0..1`  | `history.job_id -> download_jobs.id` (`ON DELETE CASCADE`)     | Only completed & streamed jobs create a history record; deleting a job cascades to its history entry.                                                                                                                      |
| `settings`      | _(standalone)_  | `—`         | `—`                                                            | Key-value persistence for lightweight app preferences.                                                                                                                                                                     |

---

## 3. Data Retention & Lifecycle Notes

1. **Metadata Cache (`videos` + `formats`):** Upserted on `POST /api/fetch`. When `now - fetched_at < CACHE_TTL_SECONDS * 1000` (default `3600000 ms`), cached rows are served without spawning `yt-dlp`. On refresh, existing `(video_id, format_id)` rows are updated in place to preserve `formats.id` primary keys, and obsolete format rows are pruned (`download_jobs.format_id` becomes `NULL` via `ON DELETE SET NULL`).
2. **History Cap (Last 50):** `history` queries return at most 50 newest entries (`ORDER BY downloaded_at DESC LIMIT 50`), and inserts prune entries older than the newest 50 rows.
3. **Temp File Pointers (`download_jobs.temp_filepath`):** Cleared (`NULL`) when the temp file is deleted after streaming, cancellation, failure, or the 30-minute sweeper.
