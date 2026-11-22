import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as fetchPOST } from "@/app/api/fetch/route";
import { POST as downloadPOST } from "@/app/api/download/route";
import { GET as streamGET } from "@/app/api/download/[jobId]/stream/route";
import { GET as eventsGET } from "@/app/api/jobs/[jobId]/events/route";
import { POST as cancelPOST } from "@/app/api/jobs/[jobId]/cancel/route";
import { GET as historyGET } from "@/app/api/history/route";
import { DELETE as historyDELETE } from "@/app/api/history/[id]/route";
import { closeDb, getDb } from "@/db/client";
import { ERROR_CODES } from "@/lib/errors";
import { getRateLimiter } from "@/lib/rate-limiter";
import { jobService } from "@/services/job.service";

function makeJsonRequest(
  url: string,
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.10",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function readSseToCompletion(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text.split("\n\n").filter((frame) => frame.trim().length > 0);
}

describe("API Route Handlers (mocked yt-dlp / ffmpeg executables)", () => {
  let tmpRoot: string;
  let mockYtDlpPath: string;
  let mockFfmpegPath: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "retrotube-api-test-"));

    mockYtDlpPath = path.join(tmpRoot, "mock-yt-dlp");
    mockFfmpegPath = path.join(tmpRoot, "mock-ffmpeg");

    fs.writeFileSync(
      mockYtDlpPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const mode = process.env.MOCK_YTDLP_MODE || "ok";

if (args.includes("--version")) {
  console.log("2026.11.11-mock");
  process.exit(0);
}

if (mode === "sleep") {
  setTimeout(() => process.exit(0), 5000);
} else if (mode === "private") {
  console.error("ERROR: [youtube] Video unavailable. This video is private.");
  process.exit(1);
} else if (mode === "age") {
  console.error("ERROR: Sign in to confirm your age. This video may be inappropriate for some users.");
  process.exit(1);
} else if (mode === "geo") {
  console.error("ERROR: The uploader has not made this video available in your country.");
  process.exit(1);
} else if (mode === "rate_limit") {
  console.error("ERROR: HTTP Error 429: Too Many Requests");
  process.exit(1);
} else if (mode === "fail") {
  console.error("ERROR: Generic extractor crash");
  process.exit(1);
} else if (args.includes("-J")) {
  const fixture = JSON.parse(fs.readFileSync(process.env.MOCK_FIXTURE_PATH, "utf8"));
  if (mode === "live") {
    fixture.is_live = true;
    fixture.live_status = "is_live";
  } else if (mode === "long") {
    fixture.duration = 999999;
  }
  process.stdout.write(JSON.stringify(fixture));
  process.exit(0);
} else {
  const outIdx = args.indexOf("-o");
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  const delayMs = Number(process.env.MOCK_DOWNLOAD_DELAY_MS || "20");
  console.log("[download]  25.0% of   1.00MiB at  500.00KiB/s ETA 00:01");
  setTimeout(() => {
    console.log("[download] 100.0% of   1.00MiB at  1.00MiB/s ETA 00:00");
    if (outPath) {
      fs.writeFileSync(outPath, "RETROTUBE_MEDIA_PAYLOAD_0123456789");
    }
    process.exit(0);
  }, delayMs);
}
`,
      { mode: 0o755 },
    );

    fs.writeFileSync(
      mockFfmpegPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("-version")) {
  console.log("ffmpeg version 7.1-mock");
  process.exit(0);
}
const outPath = args[args.length - 1];
console.log("out_time_us=90000000");
console.log("progress=end");
fs.writeFileSync(outPath, "RETROTUBE_FFMPEG_MERGED_PAYLOAD_0123456789");
process.exit(0);
`,
      { mode: 0o755 },
    );
  });

  beforeEach(() => {
    const dbPath = path.join(tmpRoot, `db-${Date.now()}-${Math.random()}.db`);
    const tempDir = path.join(tmpRoot, "temp");
    fs.mkdirSync(tempDir, { recursive: true });

    process.env.DB_PATH = dbPath;
    process.env.TEMP_DIR = tempDir;
    process.env.YTDLP_PATH = mockYtDlpPath;
    process.env.FFMPEG_PATH = mockFfmpegPath;
    process.env.MOCK_FIXTURE_PATH = path.resolve(
      process.cwd(),
      "tests/fixtures/ytdlp-sample.json",
    );
    process.env.MOCK_YTDLP_MODE = "ok";
    process.env.MOCK_DOWNLOAD_DELAY_MS = "20";
    process.env.MAX_CONCURRENT_JOBS = "2";
    process.env.MAX_VIDEO_MINUTES = "180";
    process.env.CACHE_TTL_SECONDS = "3600";
    process.env.RATE_LIMIT_FETCH_PER_MIN = "20";
    process.env.RATE_LIMIT_DOWNLOAD_PER_MIN = "10";
    process.env.YTDLP_FETCH_TIMEOUT_MS = "5000";
    process.env.APP_PASSWORD = "";

    getRateLimiter().reset();
    closeDb();
    getDb();
  });

  afterAll(() => {
    jobService.stopPeriodicSweeper();
    closeDb();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DB_PATH;
    delete process.env.TEMP_DIR;
    delete process.env.YTDLP_PATH;
    delete process.env.FFMPEG_PATH;
    delete process.env.MOCK_FIXTURE_PATH;
    delete process.env.MOCK_YTDLP_MODE;
    delete process.env.MOCK_DOWNLOAD_DELAY_MS;
    delete process.env.APP_PASSWORD;
  });

  it("reports healthy checks on GET /api/health", async () => {
    const res = await healthGET(new NextRequest("http://localhost:3000/api/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: { db: { ok: boolean }; ytdlp: { ok: boolean }; ffmpeg: { ok: boolean } };
    };
    expect(body.status).toBe("ok");
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.ytdlp.ok).toBe(true);
    expect(body.checks.ffmpeg.ok).toBe(true);
  });

  it("executes full happy path: fetch (miss -> cache hit) -> download -> SSE -> Range & full stream -> cleanup -> history -> delete", async () => {
    // 1. Fetch metadata (miss)
    const fetchRes1 = await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    );
    expect(fetchRes1.status).toBe(200);
    expect(fetchRes1.headers.get("x-request-id")).toBeTruthy();
    const fetchData1 = (await fetchRes1.json()) as {
      cached: boolean;
      video: { id: number; youtubeId: string };
      videoFormats: Array<{ id: number; formatId: string; needsAudioMerge: boolean }>;
      audioFormats: Array<{ id: number; formatId: string }>;
    };
    expect(fetchData1.cached).toBe(false);
    expect(fetchData1.video.youtubeId).toBe("dQw4w9WgXcQ");
    expect(fetchData1.videoFormats.length).toBeGreaterThan(0);

    // 2. Fetch same video again -> served from 1h SQLite cache
    const fetchRes2 = await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://youtu.be/dQw4w9WgXcQ",
      }),
    );
    const fetchData2 = (await fetchRes2.json()) as { cached: boolean };
    expect(fetchData2.cached).toBe(true);

    // 3. Enqueue a video-only merge job (1080p formatId "299")
    const mergeFormat = fetchData1.videoFormats.find((f) => f.formatId === "299")!;
    expect(mergeFormat.needsAudioMerge).toBe(true);

    const dlRes = await downloadPOST(
      makeJsonRequest("http://localhost:3000/api/download", "POST", {
        videoId: fetchData1.video.id,
        formatId: mergeFormat.id,
        targetContainer: "mp4",
      }),
    );
    expect(dlRes.status).toBe(202);
    const dlData = (await dlRes.json()) as { jobId: string; status: string };
    expect(dlData.status).toBe("queued");

    // 4. Read SSE events until terminal "done"
    const sseRes = await eventsGET(
      new NextRequest(`http://localhost:3000/api/jobs/${dlData.jobId}/events`),
      { params: Promise.resolve({ jobId: dlData.jobId }) },
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream");
    const frames = await readSseToCompletion(sseRes);
    const lastFrame = frames[frames.length - 1] ?? "";
    expect(lastFrame).toContain("event: done");
    expect(lastFrame).toContain(
      "RETROTUBE_FFMPEG_MERGED_PAYLOAD_0123456789".length.toString(),
    );

    // 5. Partial Range request (bytes=0-3 -> 206) leaves file available for follow-up full request
    const rangeRes = await streamGET(
      new NextRequest(`http://localhost:3000/api/download/${dlData.jobId}/stream`, {
        headers: { range: "bytes=0-3" },
      }),
      { params: Promise.resolve({ jobId: dlData.jobId }) },
    );
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get("content-range")).toMatch(/^bytes 0-3\//);
    expect(await rangeRes.text()).toBe("RETR");

    // 6. Full stream download (200) -> verifies headers & deletes temp file after completion
    const streamRes = await streamGET(
      new NextRequest(`http://localhost:3000/api/download/${dlData.jobId}/stream`),
      { params: Promise.resolve({ jobId: dlData.jobId }) },
    );
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toBe("video/mp4");
    expect(streamRes.headers.get("content-disposition")).toContain("attachment;");
    expect(await streamRes.text()).toBe("RETROTUBE_FFMPEG_MERGED_PAYLOAD_0123456789");

    // Allow microtask/async unlink after stream closes
    await new Promise((r) => setTimeout(r, 30));

    // Subsequent stream returns 410 FILE_EXPIRED because temp file was deleted
    const expiredRes = await streamGET(
      new NextRequest(`http://localhost:3000/api/download/${dlData.jobId}/stream`),
      { params: Promise.resolve({ jobId: dlData.jobId }) },
    );
    expect(expiredRes.status).toBe(410);
    const expiredBody = (await expiredRes.json()) as { error: { code: string } };
    expect(expiredBody.error.code).toBe(ERROR_CODES.FILE_EXPIRED);

    // 7. History contains the download and can be deleted
    const histRes = await historyGET(
      new NextRequest("http://localhost:3000/api/history"),
    );
    expect(histRes.status).toBe(200);
    const histData = (await histRes.json()) as {
      items: Array<{ id: number; jobId: string; targetContainer: string }>;
    };
    expect(histData.items).toHaveLength(1);
    expect(histData.items[0]?.jobId).toBe(dlData.jobId);

    const delRes = await historyDELETE(
      new NextRequest(`http://localhost:3000/api/history/${histData.items[0]!.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: String(histData.items[0]!.id) }) },
    );
    expect(delRes.status).toBe(200);

    const histAfter = (await (
      await historyGET(new NextRequest("http://localhost:3000/api/history"))
    ).json()) as { items: unknown[] };
    expect(histAfter.items).toHaveLength(0);
  });

  it("supports MP3 audio conversion and active job cancellation", async () => {
    const fetchRes = await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    );
    const fetchData = (await fetchRes.json()) as { video: { id: number } };

    // MP3 320kbps conversion without explicitly passing formatId (auto-selects best audio)
    const mp3Res = await downloadPOST(
      makeJsonRequest("http://localhost:3000/api/download", "POST", {
        videoId: fetchData.video.id,
        targetContainer: "mp3",
        audioBitrateKbps: 320,
      }),
    );
    expect(mp3Res.status).toBe(202);
    const mp3Job = (await mp3Res.json()) as { jobId: string; outputFilename: string };
    expect(mp3Job.outputFilename).toContain("[MP3 320kbps].mp3");

    const mp3Events = await eventsGET(
      new NextRequest(`http://localhost:3000/api/jobs/${mp3Job.jobId}/events`),
      { params: Promise.resolve({ jobId: mp3Job.jobId }) },
    );
    const mp3Frames = await readSseToCompletion(mp3Events);
    expect(mp3Frames.at(-1)).toContain("event: done");

    // Slow download cancellation
    process.env.MOCK_DOWNLOAD_DELAY_MS = "3000";
    const slowRes = await downloadPOST(
      makeJsonRequest("http://localhost:3000/api/download", "POST", {
        videoId: fetchData.video.id,
        targetContainer: "mp3",
        audioBitrateKbps: 128,
      }),
    );
    const slowJob = (await slowRes.json()) as { jobId: string };
    await new Promise((r) => setTimeout(r, 40));

    const cancelRes = await cancelPOST(
      new NextRequest(`http://localhost:3000/api/jobs/${slowJob.jobId}/cancel`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: slowJob.jobId }) },
    );
    expect(cancelRes.status).toBe(200);
    const cancelData = (await cancelRes.json()) as { status: string };
    expect(cancelData.status).toBe("cancelled");
  });

  it("maps every error code cleanly", async () => {
    // INVALID_URL
    const invalidRes = await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
      }),
    );
    expect(invalidRes.status).toBe(400);
    expect(((await invalidRes.json()) as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.INVALID_URL,
    );

    // PLAYLIST_NOT_SUPPORTED
    const playlistRes = await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://www.youtube.com/playlist?list=PL123456",
      }),
    );
    expect(playlistRes.status).toBe(400);
    expect(((await playlistRes.json()) as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PLAYLIST_NOT_SUPPORTED,
    );

    const errorModes: Array<{
      mode: string;
      expectedStatus: number;
      expectedCode: string;
    }> = [
      { mode: "private", expectedStatus: 403, expectedCode: ERROR_CODES.PRIVATE_VIDEO },
      { mode: "age", expectedStatus: 403, expectedCode: ERROR_CODES.AGE_RESTRICTED },
      { mode: "geo", expectedStatus: 451, expectedCode: ERROR_CODES.GEO_BLOCKED },
      { mode: "live", expectedStatus: 422, expectedCode: ERROR_CODES.LIVE_STREAM },
      { mode: "long", expectedStatus: 422, expectedCode: ERROR_CODES.VIDEO_TOO_LONG },
      { mode: "rate_limit", expectedStatus: 429, expectedCode: ERROR_CODES.RATE_LIMITED },
      { mode: "fail", expectedStatus: 502, expectedCode: ERROR_CODES.YTDLP_FAILED },
    ];

    for (const tc of errorModes) {
      process.env.MOCK_YTDLP_MODE = tc.mode;
      const res = await fetchPOST(
        makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
      );
      expect(res.status).toBe(tc.expectedStatus);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe(tc.expectedCode);
    }

    // TIMEOUT
    process.env.MOCK_YTDLP_MODE = "sleep";
    process.env.YTDLP_FETCH_TIMEOUT_MS = "1000";
    const timeoutRes = await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    );
    expect(timeoutRes.status).toBe(504);
    expect(((await timeoutRes.json()) as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.TIMEOUT,
    );

    // Client IP RATE_LIMITED
    process.env.MOCK_YTDLP_MODE = "ok";
    process.env.YTDLP_FETCH_TIMEOUT_MS = "5000";
    process.env.RATE_LIMIT_FETCH_PER_MIN = "1";
    getRateLimiter().reset();
    await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    );
    const rateLimitedRes = await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    );
    expect(rateLimitedRes.status).toBe(429);
    expect(
      ((await rateLimitedRes.json()) as { error: { code: string } }).error.code,
    ).toBe(ERROR_CODES.RATE_LIMITED);

    // JOB_NOT_FOUND
    const missingRes = await cancelPOST(
      new NextRequest(
        "http://localhost:3000/api/jobs/00000000-0000-4000-8000-000000000999/cancel",
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ jobId: "00000000-0000-4000-8000-000000000999" }) },
    );
    expect(missingRes.status).toBe(404);
    expect(((await missingRes.json()) as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.JOB_NOT_FOUND,
    );
  });

  it("enforces APP_PASSWORD cookie gate with httpOnly and sameSite strict when enabled", async () => {
    process.env.APP_PASSWORD = "secret-tape-password";

    const unauthRes = await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    );
    expect(unauthRes.status).toBe(401);
    expect(((await unauthRes.json()) as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.UNAUTHORIZED,
    );

    // Wrong password
    const badLogin = await loginPOST(
      makeJsonRequest("http://localhost:3000/api/auth/login", "POST", {
        password: "wrong",
      }),
    );
    expect(badLogin.status).toBe(401);

    // Correct password issues httpOnly + SameSite=Strict cookie
    const goodLogin = await loginPOST(
      makeJsonRequest("http://localhost:3000/api/auth/login", "POST", {
        password: "secret-tape-password",
      }),
    );
    expect(goodLogin.status).toBe(200);
    const setCookie = goodLogin.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("retrotube_session=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");

    const cookiePair = setCookie.split(";")[0]!;
    const authedFetch = await fetchPOST(
      makeJsonRequest(
        "http://localhost:3000/api/fetch",
        "POST",
        { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
        { cookie: cookiePair },
      ),
    );
    expect(authedFetch.status).toBe(200);

    const logoutRes = await logoutPOST(
      makeJsonRequest("http://localhost:3000/api/auth/logout", "POST"),
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("deletes temp file when full stream aborts mid-transfer and queues beyond MAX_CONCURRENT_JOBS", async () => {
    const fetchRes = await fetchPOST(
      makeJsonRequest("http://localhost:3000/api/fetch", "POST", {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    );
    const fetchData = (await fetchRes.json()) as {
      video: { id: number };
      videoFormats: Array<{ id: number; formatId: string }>;
    };
    const muxedFormat = fetchData.videoFormats.find((f) => f.formatId === "22")!;

    process.env.MAX_CONCURRENT_JOBS = "1";
    process.env.MOCK_DOWNLOAD_DELAY_MS = "150";

    const j1Res = await downloadPOST(
      makeJsonRequest("http://localhost:3000/api/download", "POST", {
        videoId: fetchData.video.id,
        formatId: muxedFormat.id,
        targetContainer: "mp4",
      }),
    );
    const j2Res = await downloadPOST(
      makeJsonRequest("http://localhost:3000/api/download", "POST", {
        videoId: fetchData.video.id,
        formatId: muxedFormat.id,
        targetContainer: "mp4",
      }),
    );
    expect(j1Res.status).toBe(202);
    expect(j2Res.status).toBe(202);
    const j1 = (await j1Res.json()) as { jobId: string };
    const j2 = (await j2Res.json()) as { jobId: string };

    // Wait for both queued jobs to finish
    await readSseToCompletion(
      await eventsGET(
        new NextRequest(`http://localhost:3000/api/jobs/${j1.jobId}/events`),
        { params: Promise.resolve({ jobId: j1.jobId }) },
      ),
    );
    await readSseToCompletion(
      await eventsGET(
        new NextRequest(`http://localhost:3000/api/jobs/${j2.jobId}/events`),
        { params: Promise.resolve({ jobId: j2.jobId }) },
      ),
    );

    // Abort j1 stream immediately -> temp file must be cleaned up
    const abortStreamRes = await streamGET(
      new NextRequest(`http://localhost:3000/api/download/${j1.jobId}/stream`),
      { params: Promise.resolve({ jobId: j1.jobId }) },
    );
    expect(abortStreamRes.status).toBe(200);
    await abortStreamRes.body?.cancel();
    await new Promise((r) => setTimeout(r, 30));

    const afterAbort = await streamGET(
      new NextRequest(`http://localhost:3000/api/download/${j1.jobId}/stream`),
      { params: Promise.resolve({ jobId: j1.jobId }) },
    );
    expect(afterAbort.status).toBe(410);

    // Clean up j2 by streaming it
    const j2Stream = await streamGET(
      new NextRequest(`http://localhost:3000/api/download/${j2.jobId}/stream`),
      { params: Promise.resolve({ jobId: j2.jobId }) },
    );
    expect(await j2Stream.text()).toBe("RETROTUBE_MEDIA_PAYLOAD_0123456789");
  });
});
