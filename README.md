# RetroTube

RetroTube is a lightweight, self-hostable personal media deck and Progressive Web App (PWA) for inspecting YouTube metadata and downloading any available video or audio format—featuring automatic `ffmpeg` audio+video merging, audio conversions (MP3 128/192/320 kbps, M4A, Opus, FLAC, WAV), **full playlist batch downloads**, and **big-video reliability**.

---

## Key Features

### V1 Core Deck
- **Single-Video Stream Inspector:** Paste or share links from `youtube.com`, `youtu.be`, `m.youtube.com`, YouTube Shorts, or `music.youtube.com`.
- **Every Format Listed & Grouped:**
  - **Video:** Resolution-grouped streams (`144p` up to `8K` when available), `FPS`, container, codec, estimated size, `HDR` badge, and automatic `ffmpeg` `-c copy` audio merge for video-only streams.
  - **Audio:** Native audio streams grouped by codec/bitrate plus one-tap `ffmpeg` conversion targets (`MP3 128/192/320`, `M4A`, `Opus`, `FLAC`, `WAV`).
- **Live SSE Progress & HTTP Range Streaming:** Monotonic VHS tracking progress bar via Server-Sent Events (`GET /api/jobs/[jobId]/events`), job cancellation (`SIGTERM` process-tree cleanup), HTTP Range 206 resumable streaming with Node backpressure, sanitized filenames, and automatic temp-file cleanup.
- **Local SQLite History:** Stores the last 50 downloads in SQLite (`better-sqlite3` + Drizzle ORM) with delete, clear all, and re-download.
- **Retro Paper Theme:** Warm cream paper background, ink-black typography, tomato red, mustard, and teal accent tokens with halftone dots and hard offset shadows.
- **Installable PWA:** Web App Manifest (`app/manifest.ts`), hand-written Service Worker (`public/sw.js`), offline fallback (`/offline`), iOS home-screen hint, Chromium install banner, and Android Web Share Target (`share_target`).
- **Optional Password Gate:** Set `APP_PASSWORD` to lock down the UI and API with an `HttpOnly`, `SameSite=Strict` HMAC-SHA256 cookie.

### V2 Additions: (A) Playlist Support
- **Fast Playlist Listing:** `POST /api/playlist/fetch` uses `yt-dlp --flat-playlist -J` for lightning-fast inspection without per-video format probing.
- **Dual-Link Choice Prompt:** URLs containing both `v=` and `list=` prompt whether to inspect the single track or load the entire playlist.
- **Playlist Selection Deck:** Interactive scrollable checklist with thumbnails, track durations, Select All/None, and Range Select (e.g. tracks 5 to 20). Deleted and private videos are cleanly flagged as unavailable without failing the batch.
- **Unified Quality Presets:** Choose from `Best Video`, `1080p HD`, `720p`, `480p`, `Best Audio`, or `MP3 320k/192k/128k`. If an item does not have the exact requested resolution, it falls back to the closest lower quality and records the actual result.
- **Bounded Batch Queue:** Processes batch items with configurable concurrency (`BATCH_CONCURRENCY=1`, max 3), randomized jitter delays (`BATCH_ITEM_DELAY_MS`) to prevent YouTube rate-limiting, and exponential backoff retries (up to 2 retries).
- **On-The-Fly Streaming ZIP64 Delivery:** Stream all completed tracks as an uncompressed (`STORE` mode) ZIP archive directly to the client. Numbered filenames (e.g. `001 - Title.mp3`) preserve playlist order. Supports multi-gigabyte archives (> 4 GB) with ZIP64 headers and strictly bounded heap memory.
- **Optional Server Persistence:** Set `SERVER_SAVE_DIR` to automatically mirror completed batch files into a host directory in addition to browser downloads.
- **Startup Crash Recovery:** Unfinished batches and interrupted running items are automatically recovered on server restart, resuming downloads with `yt-dlp --continue`.

### V2 Additions: (B) Big-Video Reliability
- **Unlimited Duration with Soft Guards:** Removed hard video duration blocks. Configurable soft guards via `MAX_VIDEO_MINUTES` (default `0` = unlimited) and `MAX_FILE_SIZE_GB` (default `0` = unlimited).
- **Filesystem Disk-Space Guard:** Queries host storage via `statfs` before starting any job. Compares available space against required estimates (2.2x for video+audio merges, 1.2x for direct/audio) and maintains a configurable reserve (`MIN_FREE_DISK_GB=2`), aborting early with `INSUFFICIENT_DISK` if storage is low.
- **Storage Vault Modal & Sweeper:** Storage management dashboard accessible via the header **Vault** button. Displays live disk capacity, temp usage, and a manual purge trigger (`POST /api/settings/storage/clean`). Files are retained for `FILE_TTL_MINUTES` (default 120m) to accommodate slow cellular connections, and running jobs are always protected from deletion.
- **Reverse Proxy & Tunnel Stability:** 15-second SSE keepalive comments (`: keepalive`) with `id:` timestamps prevent Cloudflare Tunnels, Nginx, or Traefik from dropping idle connections during long-running ffmpeg operations. Client auto-reconnects with `Last-Event-ID`.
- **5-Minute Rolling Stall Detector:** Subprocesses that produce zero stdout/stderr output for 5 minutes are terminated with `TIMEOUT` and cleanly recycled.
- **Large-File & Mobile Guidance:** In-app warnings for media over 1 GB (mobile data notice) and iOS Safari advisory for downloads exceeding 2 GB.

---

## Architecture & Design Docs

All design documents live in `/docs`:

- [High-Level Design (`docs/HLD.md`)](docs/HLD.md) — Architecture, C4 containers, request flows, NFRs, and ADRs (including ADR-007 ZIP delivery and ADR-008 Big-Video Direct Streaming)
- [Low-Level Design (`docs/LLD.md`)](docs/LLD.md) — Sequence diagrams (Playlist Fetch, Batch Queue, Resume After Restart, ZIP64 Streaming, Disk Guard), state machines, and error catalog
- [Entity-Relationship Model (`docs/ER.md`)](docs/ER.md) — Database entities (`batches`, `batch_items`, `download_jobs`, `videos`, `formats`, `cache_entries`)
- [Database Schema & Migration (`docs/SCHEMA.md`)](docs/SCHEMA.md) — Table definitions, indexes, PRAGMAs, and non-breaking migrations
- [API Reference (`docs/API.md`)](docs/API.md) — Full contract for all single-video and batch endpoints

---

## Local Development Setup

### Prerequisites

- **Node.js** `>= 22` (tested on `v25.8.0`)
- **pnpm** `10.x` (`corepack enable`)
- **`yt-dlp`** and **`ffmpeg`** installed and on your `PATH` (or configured via `.env`)

On macOS (Homebrew):

```bash
brew install yt-dlp ffmpeg
```

### Install, Configure & Run

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment variables
cp .env.example .env

# 3. Run in development mode (with Turbopack)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). SQLite migrations run automatically on server boot (`instrumentation.ts` / `db/client.ts`).

### Production Build & Standalone Run

```bash
pnpm build
cp -R public .next/standalone/public
cp -R .next/static .next/standalone/.next/static
cp -R drizzle .next/standalone/drizzle
node .next/standalone/server.js
```

---

## Docker Deployment (Recommended)

RetroTube ships with a multi-stage `node:24-alpine` Dockerfile bundling `yt-dlp`, `ffmpeg`, and `aria2c`, plus `docker-compose.yml` mounting persistent volumes for SQLite (`/app/data`) and temporary staging (`/app/tmp`).

```bash
# 1. Configure environment
cp .env.example .env

# 2. Build and start
docker compose up -d --build

# 3. Check health
curl -s http://localhost:3000/api/health
```

### Volume Sizing & Guidance

In `docker-compose.yml`:
- **`retrotube_data`:** Mounts to `/app/data`. Stores the SQLite database (`retrotube.db`) and format metadata cache. Typically requires **100 MB to 1 GB**.
- **`retrotube_tmp`:** Mounts to `/app/tmp`. Stores in-flight DASH fragments, ffmpeg `-c copy` merges, and staged media files. **Recommended size: 20 GB to 50 GB** (or a host bind mount on a fast NVMe partition) when downloading 4K/8K media or large playlists.

---

## Environment Variables

| Variable                      | Default               | Description                                                                 |
| :---------------------------- | :-------------------- | :-------------------------------------------------------------------------- |
| `YTDLP_PATH`                  | `yt-dlp`              | Path or executable name for `yt-dlp`                                        |
| `FFMPEG_PATH`                 | `ffmpeg`              | Path or executable name for `ffmpeg`                                        |
| `TEMP_DIR`                    | `./tmp/retrotube`     | Temporary staging directory for downloads, merges, and ZIP streaming        |
| `DB_PATH`                     | `./data/retrotube.db` | SQLite database file path                                                   |
| `MAX_CONCURRENT_JOBS`         | `2`                   | Maximum active concurrent `yt-dlp`/`ffmpeg` single-video jobs (`1–16`)       |
| `MAX_VIDEO_MINUTES`           | `0`                   | Maximum video duration allowed in minutes (`0` = unlimited soft guard)      |
| `MAX_FILE_SIZE_GB`            | `0`                   | Maximum single-file size in gigabytes (`0` = unlimited soft guard)          |
| `MIN_FREE_DISK_GB`            | `2`                   | Minimum free disk space required before starting jobs (`statfs` guard)      |
| `FILE_TTL_MINUTES`            | `120`                 | Temp file retention time in minutes before cleanup (accommodates slow links)|
| `MAX_PLAYLIST_ITEMS`          | `200`                 | Maximum items listed or selectable from a playlist                          |
| `BATCH_CONCURRENCY`           | `1`                   | Concurrent downloads inside a batch queue (`1–3`)                           |
| `BATCH_ITEM_DELAY_MS`         | `1000`                | Randomized jitter delay in ms between playlist items to avoid rate limits   |
| `SERVER_SAVE_DIR`             | _(empty)_             | Optional host directory to automatically save completed batch media files   |
| `APP_PASSWORD`                | _(empty)_             | Optional shared password gate (`HttpOnly; SameSite=Strict`)                 |
| `CACHE_TTL_SECONDS`           | `3600`                | Metadata cache TTL in SQLite (1 hour)                                       |
| `RATE_LIMIT_FETCH_PER_MIN`    | `20`                  | Per-IP `/api/fetch` limit per minute                                        |
| `RATE_LIMIT_DOWNLOAD_PER_MIN` | `10`                  | Per-IP `/api/download` limit per minute                                     |
| `LOG_LEVEL`                   | `info`                | Structured JSON log level (`debug \| info \| warn \| error`)                |
| `YTDLP_FETCH_TIMEOUT_MS`      | `30000`               | Timeout in ms for `yt-dlp -J` metadata inspection                           |
| `YTDLP_DOWNLOAD_TIMEOUT_MS`   | `1800000`             | Timeout in ms for media download/transcode processes                        |
| `YTDLP_CONCURRENT_FRAGMENTS`  | `4`                   | Parallel fragment download threads for DASH/HLS (`1–16`)                    |
| `YTDLP_HTTP_CHUNK_SIZE`       | `10M`                 | HTTP range chunk size; bypasses YouTube playback throttling                 |
| `YTDLP_BUFFER_SIZE`           | `16K`                 | Read buffer size passed to `yt-dlp`                                         |
| `YTDLP_USE_ARIA2`             | `false`               | Enable `aria2c` multi-connection downloader in Docker/host                  |
| `YTDLP_PROXY`                 | _(empty)_             | Proxy URL (`http://`, `https://`, `socks5://`)                              |
| `YTDLP_COOKIES_FILE`          | _(empty)_             | Path to Netscape `cookies.txt` (bypasses bot/age throttling)                |

---

## Reverse Proxy & Tunnel Timeout Guidance

When deploying behind **Cloudflare Tunnels**, **Nginx**, **Caddy**, or **Traefik**, apply the following settings:

1. **Disable Proxy Buffering for Streams & ZIPs:**
   Streaming large video files and on-the-fly ZIP archives requires unbuffered chunk forwarding so chunks pass immediately to the client without buffering gigabytes in proxy memory.
   - **Nginx:**
     ```nginx
     location ~ ^/api/(download/[^/]+/stream|batch/[^/]+/zip|.*/events)$ {
         proxy_pass http://127.0.0.1:3000;
         proxy_buffering off;
         proxy_cache off;
         proxy_read_timeout 3600s;
         proxy_send_timeout 3600s;
     }
     ```
   - **Caddy:**
     ```caddy
     reverse_proxy 127.0.0.1:3000 {
         flush_interval -1
     }
     ```
2. **SSE Keepalives:**
   RetroTube automatically emits SSE keepalive comments (`: keepalive\n\n`) every 15 seconds with timestamped event IDs (`id: <timestamp>`). Proxies and tunnels will not drop connections during lengthy download or merge operations.
3. **Resumable HTTP Range Streaming:**
   The streaming endpoint (`/api/download/[jobId]/stream`) natively supports HTTP Range requests (`HTTP 206 Partial Content`). Browsers and download managers (e.g. Free Download Manager, curl) can pause and resume downloads seamlessly.

---

## ZIP64 & Disk Space Guidance

1. **STORE Mode (Zero Re-compression Overhead):**
   Media formats (MP4, WebM, MP3, Opus, AAC) are already compressed with state-of-the-art entropy encoders. Compressing them again with Deflate wastes 100% CPU and achieves 0% space savings. RetroTube streams ZIP archives using pure uncompressed `STORE` mode (`method: 0`), achieving maximum disk I/O throughput with near-zero CPU usage.
2. **ZIP64 Architecture:**
   Whenever an individual file or total archive exceeds 4 GB, RetroTube automatically emits ZIP64 Local File Headers, Central Directory Headers, and ZIP64 End of Central Directory Records (`0x06064b50` / `0x07064b50`). Memory usage is strictly bounded (< 50 MB heap delta) via Node stream backpressure.
3. **Disk Guard Safety Margin:**
   Before staging any file, RetroTube checks `statfs` against estimated requirements:
   $$\text{Required} = \text{Filesize} \times (2.2 \text{ for merges } \mid 1.2 \text{ for direct}) + \text{MIN\_FREE\_DISK\_GB}$$
   If available space falls below this threshold, the request is refused with `INSUFFICIENT_DISK`, protecting host systems from out-of-disk crashes.

---

## Scripts & Testing

```bash
pnpm test          # Vitest unit, integration & ZIP64 tests (69 tests passing)
pnpm test:e2e      # Playwright E2E smoke and playlist-batch tests (4 tests passing)
pnpm lint          # ESLint check (zero errors, strict typing)
pnpm typecheck     # TypeScript strict compilation check
pnpm build         # Next.js Turbopack production build
docker compose config # Validate Docker Compose configuration
```

---

## Disclaimer

**Personal Use Only.** RetroTube is intended solely for personal, non-commercial archival and offline playback of content you have the legal right to download. Respect creators, YouTube's Terms of Service, and all applicable copyright laws in your jurisdiction.
