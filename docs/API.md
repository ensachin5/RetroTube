# RetroTube — API Reference (`curl` Guide)

Base URL (local dev): `http://localhost:3000`

All JSON error responses follow a uniform envelope and include an `X-Request-Id` response header:

```json
{
  "error": {
    "code": "INVALID_URL",
    "message": "Please enter a valid YouTube video URL.",
    "requestId": "9f8c2e10-4b3b-4c4b-9e6b-87a1d88a12ab"
  }
}
```

---

## 1. `GET /api/health`

Checks SQLite connectivity, `TEMP_DIR` writability, and availability/versions of `yt-dlp` and `ffmpeg`. Always public even when `APP_PASSWORD` is set.

```bash
curl -s http://localhost:3000/api/health | jq .
```

- **`200 OK`** when all checks pass (`status: "ok"`)
- **`503 Service Unavailable`** when one or more checks fail (`status: "degraded"`)

---

## 2. Authentication (`APP_PASSWORD` Gate)

Disabled by default when `APP_PASSWORD` is empty. When enabled, authenticate first and store the `HttpOnly; SameSite=Strict` session cookie in `/tmp/cookies.txt`:

### `POST /api/auth/login`

```bash
curl -i -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"your-app-password"}'
```

### `POST /api/auth/logout`

```bash
curl -i -b /tmp/cookies.txt -c /tmp/cookies.txt \
  -X POST http://localhost:3000/api/auth/logout
```

_(If `APP_PASSWORD` is enabled, pass `-b /tmp/cookies.txt` to all subsequent API requests.)_

---

## 3. `POST /api/fetch`

Validates the YouTube URL against the strict hostname allowlist (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`, `www.youtu.be`), rejects playlist-only URLs, checks the 1-hour SQLite cache, or invokes `yt-dlp -J --no-playlist` and normalizes all video/audio streams plus audio conversion targets.

```bash
curl -s -X POST http://localhost:3000/api/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' | jq .
```

### Common Error Responses

- `400 INVALID_URL` — Non-YouTube host, malformed URL, or missing 11-char video ID
- `400 PLAYLIST_NOT_SUPPORTED` — Playlist-only URL (e.g. `/playlist?list=...`)
- `403 PRIVATE_VIDEO` / `403 AGE_RESTRICTED`
- `404 VIDEO_UNAVAILABLE`
- `422 LIVE_STREAM` / `422 VIDEO_TOO_LONG`
- `429 RATE_LIMITED`
- `451 GEO_BLOCKED`
- `502 YTDLP_FAILED` / `504 TIMEOUT`

---

## 4. `POST /api/download`

Creates a queued download, video+audio merge, or audio transcode job and returns `202 Accepted` with `jobId`, `eventsUrl`, and `streamUrl`.

### 4.1 Video format (auto-merges best audio via `ffmpeg` if video-only)

```bash
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{
    "videoId": 1,
    "formatId": 12,
    "targetContainer": "mp4"
  }' | jq .
```

### 4.2 Audio conversion (`mp3` 128/192/320, `m4a`, `opus`, `flac`, `wav`)

```bash
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{
    "videoId": 1,
    "targetContainer": "mp3",
    "audioBitrateKbps": 320
  }' | jq .
```

---

## 5. `GET /api/jobs/[jobId]/events` (SSE Progress)

Streams real-time job progress parsed from `yt-dlp` and `ffmpeg` stdout until a terminal event (`done`, `failed`, or `cancelled`) is reached.

```bash
JOB_ID="<paste-jobId-here>"
curl -N http://localhost:3000/api/jobs/${JOB_ID}/events
```

Sample frames:

```text
event: progress
data: {"jobId":"...","status":"running","progressPct":42.5,"stage":"downloading_video","speed":"3.4MiB/s","etaSec":12}

event: done
data: {"jobId":"...","status":"done","progressPct":100,"stage":"done","streamUrl":"/api/download/.../stream","outputFilename":"Title [1080p].mp4","bytesTotal":48120312}
```

---

## 6. `GET /api/download/[jobId]/stream`

Streams the finished file with sanitized `Content-Disposition` (`filename` + RFC 5987 `filename*`), `Accept-Ranges: bytes`, and HTTP `Range` support. Records the download in SQLite `history` (capped at 50) and deletes the temporary file after full stream completion/abort.

### Full file download (saves server-suggested filename)

```bash
curl -OJ http://localhost:3000/api/download/${JOB_ID}/stream
```

### Byte-range request (`206 Partial Content`)

```bash
curl -i -H "Range: bytes=0-1023" \
  http://localhost:3000/api/download/${JOB_ID}/stream
```

---

## 7. `POST /api/jobs/[jobId]/cancel`

Cancels a `queued` or `running` job, kills the spawned `yt-dlp`/`ffmpeg` child process tree (`SIGTERM` -> `SIGKILL`), and removes any staged temp files.

```bash
curl -s -X POST http://localhost:3000/api/jobs/${JOB_ID}/cancel | jq .
```

---

## 8. `GET /api/history`

Returns the most recent 50 completed downloads from SQLite.

```bash
curl -s http://localhost:3000/api/history | jq .
```

---

## 9. `DELETE /api/history/[id]`

Deletes a specific entry from local download history.

```bash
curl -s -X DELETE http://localhost:3000/api/history/1 | jq .
```
