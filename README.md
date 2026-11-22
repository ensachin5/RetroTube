# RetroTube

RetroTube is a lightweight, self-hostable, personal-use web app and installable Progressive Web App (PWA) for inspecting YouTube single-video metadata and downloading any available video or audio format—including automatic `ffmpeg` audio+video merging and audio conversion to MP3 (128/192/320 kbps), M4A, Opus, FLAC, and WAV.

---

## Key Features

- **Single-Video Stream Inspector:** Paste or share links from `youtube.com`, `youtu.be`, `m.youtube.com`, YouTube Shorts, or `music.youtube.com`. Playlist-only URLs are cleanly rejected in v1.
- **Every Format Listed & Grouped:**
  - **Video:** Resolution-grouped streams (`144p` up to `8K` when offered), `FPS`, container, codec, estimated size, `HDR` badge, and automatic `ffmpeg` best-audio merge for video-only streams.
  - **Audio:** All native streams grouped by codec/bitrate plus one-tap `ffmpeg` conversion targets (`MP3 128/192/320`, `M4A`, `Opus`, `FLAC`, `WAV`).
- **Live SSE Progress & HTTP Range Streaming:** Monotonic VHS tracking progress bar via Server-Sent Events (`GET /api/jobs/[jobId]/events`), job cancellation (`SIGTERM` process-tree cleanup), sanitized `Content-Disposition` downloads, and automatic temp-file cleanup + 30-minute sweeper.
- **Local SQLite History:** Stores the last 50 downloads in SQLite (`better-sqlite3` + Drizzle ORM) with delete, clear all, and re-download.
- **Retro Paper Theme:** Warm cream paper background, ink-black typography, tomato red, mustard, and teal accent tokens with halftone dots and hard offset shadows.
- **Installable PWA:** Web App Manifest (`app/manifest.ts`), hand-written Service Worker (`public/sw.js`), offline fallback (`/offline`), iOS home-screen hint, Chromium install banner, and Android Web Share Target (`share_target`).
- **Optional Password Gate:** Set `APP_PASSWORD` to lock down the UI and API with an `HttpOnly`, `SameSite=Strict` HMAC-SHA256 cookie.

---

## Architecture & Design Docs

All design documents live in `/docs`:

- [High-Level Design (`docs/HLD.md`)](docs/HLD.md) — Context, container, request flows, NFRs, deployment diagram, and ADRs
- [Low-Level Design (`docs/LLD.md`)](docs/LLD.md) — Module breakdown, sequence diagrams, job state machine, error code catalogue, and temp-file lifecycle
- [Entity-Relationship Model (`docs/ER.md`)](docs/ER.md) — Mermaid `erDiagram` and cascade rules
- [Database Schema & Migration (`docs/SCHEMA.md`)](docs/SCHEMA.md) — Table specs, PRAGMAs, Drizzle schema, and SQL migration
- [API Reference (`docs/API.md`)](docs/API.md) — `curl` examples for every endpoint

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

RetroTube ships with a multi-stage `node:24-alpine` Dockerfile bundling `yt-dlp` and `ffmpeg`, plus `docker-compose.yml` mounting persistent volumes for SQLite (`/app/data`) and temporary staging (`/app/tmp`).

```bash
# Optional: create .env or pass APP_PASSWORD directly
cp .env.example .env

# Build and start
docker compose up -d --build

# Check health
curl -s http://localhost:3000/api/health
```

> **Note on PWA installation:** Browsers require **HTTPS** (or `localhost`) for Service Workers and PWA installation prompts. When hosting on a LAN IP or custom domain, terminate TLS in front of port `3000` with Caddy, Nginx, or Traefik.

---

## Environment Variables

| Variable                      | Default               | Description                                                  |
| :---------------------------- | :-------------------- | :----------------------------------------------------------- |
| `YTDLP_PATH`                  | `yt-dlp`              | Path or executable name for `yt-dlp`                         |
| `FFMPEG_PATH`                 | `ffmpeg`              | Path or executable name for `ffmpeg`                         |
| `TEMP_DIR`                    | `./tmp/retrotube`     | Temporary staging directory for downloads/merges             |
| `DB_PATH`                     | `./data/retrotube.db` | SQLite database file path                                    |
| `MAX_CONCURRENT_JOBS`         | `2`                   | Maximum active concurrent `yt-dlp`/`ffmpeg` jobs (`1–16`)    |
| `MAX_VIDEO_MINUTES`           | `180`                 | Maximum video duration allowed (`1–1440`)                    |
| `APP_PASSWORD`                | _(empty)_             | Optional shared password gate (`HttpOnly; SameSite=Strict`)  |
| `CACHE_TTL_SECONDS`           | `3600`                | Metadata cache TTL in SQLite (1 hour)                        |
| `RATE_LIMIT_FETCH_PER_MIN`    | `20`                  | Per-IP `/api/fetch` limit per minute                         |
| `RATE_LIMIT_DOWNLOAD_PER_MIN` | `10`                  | Per-IP `/api/download` limit per minute                      |
| `LOG_LEVEL`                   | `info`                | Structured JSON log level (`debug \| info \| warn \| error`) |
| `YTDLP_FETCH_TIMEOUT_MS`      | `30000`               | Timeout in ms for `yt-dlp -J` metadata inspection            |
| `YTDLP_DOWNLOAD_TIMEOUT_MS`   | `1800000`             | Timeout in ms for media download/transcode processes         |
| `YTDLP_CONCURRENT_FRAGMENTS`  | `4`                   | Parallel fragment download threads for DASH/HLS (`1–16`)     |
| `YTDLP_HTTP_CHUNK_SIZE`       | `10M`                 | HTTP range chunk size; bypasses YouTube playback throttling  |
| `YTDLP_BUFFER_SIZE`           | `16K`                 | Read buffer size passed to `yt-dlp`                          |
| `YTDLP_USE_ARIA2`             | `false`               | Enable `aria2c` multi-connection downloader in Docker/host   |
| `YTDLP_PROXY`                 | _(empty)_             | Proxy URL (`http://`, `https://`, `socks5://`)               |
| `YTDLP_COOKIES_FILE`          | _(empty)_             | Path to Netscape `cookies.txt` (bypasses bot/age throttling) |

---

## Download Speed Acceleration

RetroTube includes high-throughput download tuning for `yt-dlp`:

1. **Concurrent Fragments (`YTDLP_CONCURRENT_FRAGMENTS=4` to `8`):**
   YouTube serves 1080p, 1440p, 4K, 8K and high-bitrate audio streams as fragmented DASH streams. Instead of fetching fragments sequentially over a single connection, RetroTube downloads up to 4–8 fragments simultaneously, maximizing bandwidth.
2. **Chunk Size Throttling Bypass (`YTDLP_HTTP_CHUNK_SIZE=10M`):**
   YouTube artificially throttles progressive/single-connection video streams down to playback speed. Splitting requests into 10 MB HTTP range chunks bypasses this server-side throttle.
3. **Multi-Connection `aria2c` (`YTDLP_USE_ARIA2=true`):**
   Pre-installed in the Docker image. Splits single streams into 16 concurrent HTTP connections with 8 concurrent tasks.
4. **Proxy & Cookies (`YTDLP_PROXY` & `YTDLP_COOKIES_FILE`):**
   Route requests through clean IPs or pass your authenticated `cookies.txt` file to unlock YouTube Premium high-bitrate formats (1080p Premium) and avoid bot verification rate-limits.

---

## Updating `yt-dlp`

YouTube frequently rotates extractor signatures. Keep `yt-dlp` up to date if downloads start failing:

- **Local (Homebrew):** `brew upgrade yt-dlp`
- **Local binary:** `yt-dlp -U`
- **Docker:** Rebuild the image cleanly with `--no-cache` so the latest `yt-dlp` release is pulled:
  ```bash
  docker compose build --no-cache && docker compose up -d
  ```

---

## Scripts & Testing

```bash
pnpm test          # Vitest unit, repository, API route & React Testing Library tests
pnpm test:e2e      # Playwright E2E smoke tests
pnpm lint          # ESLint (zero `any` enforced)
pnpm typecheck     # TypeScript strict check
pnpm format:check  # Prettier formatting check
pnpm icons:generate # Regenerate PWA PNG icons & favicon.ico from scripts/logo.svg
```

---

## Troubleshooting

- **`/api/health` reports `ytdlp.ok: false`:** Ensure `yt-dlp` is installed and executable at `YTDLP_PATH`.
- **`HTTP 429` or bot check from YouTube:** Wait a few minutes or lower fetch frequency; YouTube temporarily rate-limits shared/datacenter IPs.
- **Native `better-sqlite3` binding error after upgrading Node:** Run `pnpm rebuild better-sqlite3`.
- **Auth cookie ignored over LAN HTTP:** `APP_PASSWORD` uses `SameSite=Strict`; access the app over `http://localhost:3000` or HTTPS via reverse proxy.
- **Stale PWA shell after deploy:** Click **Reload** on the "Update available" toast, or hard-refresh to activate the new Service Worker cache version.

---

## Disclaimer

**Personal Use Only.** RetroTube is intended solely for personal, non-commercial archival and offline playback of content you have the legal right to download. Respect creators, YouTube's Terms of Service, and all applicable copyright laws in your jurisdiction.
