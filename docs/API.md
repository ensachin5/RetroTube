# RetroTube — API Reference (`curl` Guide)

Base URL (local dev): `http://localhost:3000`

All JSON error responses follow a uniform envelope and include an `X-Request-Id` response header:

```json
{
  "error": {
    "code": "INSUFFICIENT_DISK",
    "message": "Server does not have sufficient temporary storage for this operation.",
    "requestId": "9f8c2e10-4b3b-4c4b-9e6b-87a1d88a12ab",
    "details": {
      "requiredMb": 4200,
      "availableMb": 2100,
      "reserveMb": 5120
    }
  }
}
```

---

## 1. `GET /api/health`

Checks SQLite connectivity, `TEMP_DIR` writability, disk free space, and availability/versions of `yt-dlp` and `ffmpeg`. Always public even when `APP_PASSWORD` is set.

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

---

## 3. Single Video Metadata: `POST /api/fetch`

Validates single-video YouTube URLs, checks SQLite 1h cache, or invokes `yt-dlp -J --no-playlist`.

```bash
curl -s -X POST http://localhost:3000/api/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' | jq .
```

---

## 4. Playlist Fast Flat Listing: `POST /api/playlist/fetch`

Inspects playlists via `yt-dlp --flat-playlist -J --no-check-formats`. If the URL contains both `v=` and `list=`, returns `isCombined: true` offering single video vs full playlist options.

```bash
curl -s -X POST http://localhost:3000/api/playlist/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/playlist?list=PL1234567890abcdef"}' | jq .
```

---

## 5. Single Video Download: `POST /api/download`

Enqueues a single-video download, merge, or audio transcode.

### 5.1 Video format

```bash
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{
    "videoId": 1,
    "formatId": 12,
    "targetContainer": "mp4"
  }' | jq .
```

### 5.2 Audio conversion (`mp3` 128/192/320, `m4a`, `opus`, `flac`, `wav`)

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

## 6. Single Video SSE Progress: `GET /api/jobs/[jobId]/events`

```bash
curl -N http://localhost:3000/api/jobs/<jobId>/events
```

---

## 7. Single Video Stream: `GET /api/download/[jobId]/stream`

Streams completed file with `Accept-Ranges: bytes` and `Content-Disposition`.

```bash
curl -OJ http://localhost:3000/api/download/<jobId>/stream
```

Byte-range probe:

```bash
curl -i -H "Range: bytes=0-1023" http://localhost:3000/api/download/<jobId>/stream
```

---

## 8. Playlist Batch: `POST /api/batch`

Creates a batch job with quality presets (`best_video`, `1080p`, `720p`, `480p`, `audio_best`, `mp3_320`, `mp3_192`, `mp3_128`).

```bash
curl -s -X POST http://localhost:3000/api/batch \
  -H "Content-Type: application/json" \
  -d '{
    "playlistId": "PL1234567890abcdef",
    "sourceUrl": "https://www.youtube.com/playlist?list=PL1234567890abcdef",
    "title": "Synthwave Favorites",
    "channel": "Retro Curator",
    "selectedItemIds": ["dQw4w9WgXcQ", "xyz987abc11"],
    "qualityPreset": "1080p",
    "kind": "video",
    "targetContainer": "mp4"
  }' | jq .
```

---

## 9. Batch Status & Items: `GET /api/batch/[id]`

```bash
curl -s http://localhost:3000/api/batch/<batchId> | jq .
```

---

## 10. Batch SSE Progress: `GET /api/batch/[id]/events`

Streams both overall batch completion and per-item progress frames.

```bash
curl -N http://localhost:3000/api/batch/<batchId>/events
```

---

## 11. On-The-Fly Streaming ZIP: `GET /api/batch/[id]/zip`

Streams an uncompressed (`STORE` mode) ZIP64 archive on the fly directly to disk/browser:

```bash
curl -OJ http://localhost:3000/api/batch/<batchId>/zip
```

---

## 12. Batch Control: Cancel & Retry Failed

### Cancel active batch

```bash
curl -s -X POST http://localhost:3000/api/batch/<batchId>/cancel | jq .
```

### Retry failed items

```bash
curl -s -X POST http://localhost:3000/api/batch/<batchId>/retry-failed | jq .
```

---

## 13. Storage Dashboard & Temp Clean

### Check free disk & temp usage

```bash
curl -s http://localhost:3000/api/settings/storage | jq .
```

### Trigger manual temp cleanup

```bash
curl -s -X POST http://localhost:3000/api/settings/storage/clean | jq .
```

---

## 14. History: `GET /api/history` & `DELETE /api/history/[id]`

```bash
curl -s http://localhost:3000/api/history | jq .
curl -s -X DELETE http://localhost:3000/api/history/1 | jq .
```
