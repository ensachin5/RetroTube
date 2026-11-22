import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { formatsRepo } from "@/repositories/formats.repo";
import { historyRepo } from "@/repositories/history.repo";
import { jobsRepo } from "@/repositories/jobs.repo";
import { videosRepo } from "@/repositories/videos.repo";
import { parseFfmpegProgressLine } from "@/services/ffmpeg.service";
import {
  assertValidJobTransition,
  canTransitionJobStatus,
  jobService,
} from "@/services/job.service";
import { parseYtDlpProgressLine } from "@/services/ytdlp.service";

describe("job state machine, persistence, and sweeper", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "retrotube-job-test-"));
    process.env.DB_PATH = path.join(tmpRoot, "test.db");
    process.env.TEMP_DIR = path.join(tmpRoot, "tmp");
    closeDb();
    getDb();
  });

  afterEach(() => {
    jobService.stopPeriodicSweeper();
    closeDb();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DB_PATH;
    delete process.env.TEMP_DIR;
  });

  it("enforces allowed state transitions", () => {
    expect(canTransitionJobStatus("queued", "running")).toBe(true);
    expect(canTransitionJobStatus("queued", "cancelled")).toBe(true);
    expect(canTransitionJobStatus("running", "done")).toBe(true);
    expect(canTransitionJobStatus("running", "failed")).toBe(true);
    expect(canTransitionJobStatus("running", "cancelled")).toBe(true);

    expect(canTransitionJobStatus("done", "running")).toBe(false);
    expect(canTransitionJobStatus("done", "cancelled")).toBe(false);
    expect(canTransitionJobStatus("failed", "running")).toBe(false);
    expect(canTransitionJobStatus("cancelled", "done")).toBe(false);

    expect(() => assertValidJobTransition("done", "cancelled")).toThrowError(AppError);
    try {
      assertValidJobTransition("done", "cancelled");
    } catch (err) {
      expect((err as AppError).code).toBe(ERROR_CODES.INVALID_JOB_STATE);
      expect((err as AppError).status).toBe(409);
    }
  });

  it("parses yt-dlp and ffmpeg stdout progress lines", () => {
    expect(
      parseYtDlpProgressLine("[download]  42.5% of   15.20MiB at    3.45MiB/s ETA 01:12"),
    ).toEqual({
      pct: 42.5,
      speed: "3.45MiB/s",
      etaSec: 72,
    });

    expect(parseYtDlpProgressLine("[download] 100% of 5.00MiB")).toEqual({
      pct: 100,
      speed: null,
      etaSec: null,
    });

    expect(parseFfmpegProgressLine("out_time_us=45000000", 90)).toBe(50);
    expect(parseFfmpegProgressLine("progress=end", 90)).toBe(100);
  });

  it("marks leftover running and queued jobs as SERVER_RESTART on startup recovery", async () => {
    const video = videosRepo.upsert({
      youtubeId: "dQw4w9WgXcQ",
      title: "Test Video",
      channel: "Channel",
      durationSec: 60,
      uploadDate: "2025-01-01",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      fetchedAt: Date.now(),
    });

    jobsRepo.create({
      id: "00000000-0000-4000-8000-000000000001",
      videoId: video.id,
      formatId: null,
      sourceFormatId: "22",
      targetContainer: "mp4",
      needsMerge: false,
      status: "running",
      progressPct: 40,
      outputFilename: "video1.mp4",
      createdAt: Date.now(),
    });

    jobsRepo.create({
      id: "00000000-0000-4000-8000-000000000002",
      videoId: video.id,
      formatId: null,
      sourceFormatId: "22",
      targetContainer: "mp4",
      needsMerge: false,
      status: "queued",
      progressPct: 0,
      outputFilename: "video2.mp4",
      createdAt: Date.now(),
    });

    jobsRepo.create({
      id: "00000000-0000-4000-8000-000000000003",
      videoId: video.id,
      formatId: null,
      sourceFormatId: "22",
      targetContainer: "mp4",
      needsMerge: false,
      status: "done",
      progressPct: 100,
      outputFilename: "video3.mp4",
      createdAt: Date.now(),
    });

    const recovery = await jobService.recoverOnStartup();
    expect(recovery.recoveredJobs).toBe(2);

    const job1 = jobsRepo.findById("00000000-0000-4000-8000-000000000001");
    const job2 = jobsRepo.findById("00000000-0000-4000-8000-000000000002");
    const job3 = jobsRepo.findById("00000000-0000-4000-8000-000000000003");

    expect(job1).toMatchObject({
      status: "failed",
      errorCode: ERROR_CODES.SERVER_RESTART,
    });
    expect(job2).toMatchObject({
      status: "failed",
      errorCode: ERROR_CODES.SERVER_RESTART,
    });
    expect(job3?.status).toBe("done");
  });

  it("caps history at 50 entries and preserves history when formats are pruned", () => {
    const video = videosRepo.upsert({
      youtubeId: "dQw4w9WgXcQ",
      title: "Test Video",
      channel: "Channel",
      durationSec: 60,
      uploadDate: "2025-01-01",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      fetchedAt: Date.now(),
    });

    const insertedFormats = formatsRepo.replaceForVideo(video.id, [
      {
        formatId: "22",
        kind: "video",
        container: "mp4",
        vcodec: "avc1",
        acodec: "mp4a",
        resolution: "720p",
        width: 1280,
        height: 720,
        fps: 30,
        bitrateKbps: 1500,
        filesizeBytes: 1000000,
        isHdr: false,
        formatNote: "720p",
      },
    ]);

    const formatId = insertedFormats[0]!.id;

    for (let i = 1; i <= 55; i += 1) {
      const jobId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      jobsRepo.create({
        id: jobId,
        videoId: video.id,
        formatId,
        sourceFormatId: "22",
        targetContainer: "mp4",
        needsMerge: false,
        status: "done",
        progressPct: 100,
        outputFilename: `video-${i}.mp4`,
        createdAt: 1000 + i,
      });
      historyRepo.upsertAndPrune({
        jobId,
        bytesSent: 1024 * i,
        downloadedAt: 2000 + i,
      });
    }

    const latest = historyRepo.listLatest(50);
    expect(latest).toHaveLength(50);
    expect(latest[0]?.outputFilename).toBe("video-55.mp4");
    expect(latest[49]?.outputFilename).toBe("video-6.mp4");

    // Refreshing formats removes old formatId "22" -> ON DELETE SET NULL keeps history intact
    formatsRepo.replaceForVideo(video.id, [
      {
        formatId: "18",
        kind: "video",
        container: "mp4",
        vcodec: "avc1",
        acodec: "mp4a",
        resolution: "360p",
        width: 640,
        height: 360,
        fps: 30,
        bitrateKbps: 500,
        filesizeBytes: 500000,
        isHdr: false,
        formatNote: "360p",
      },
    ]);

    const afterRefresh = historyRepo.listLatest(50);
    expect(afterRefresh).toHaveLength(50);
    expect(afterRefresh[0]?.formatId).toBeNull();
    expect(afterRefresh[0]?.sourceFormatId).toBe("22");
  });

  it("sweeps expired temp files older than 30 minutes while sparing recent files", async () => {
    const tempDir = jobService.getTempDir();
    const oldFile = path.join(tempDir, "old-file.mp4");
    const freshFile = path.join(tempDir, "fresh-file.mp4");

    fs.writeFileSync(oldFile, "old");
    fs.writeFileSync(freshFile, "fresh");

    const oldTime = new Date(Date.now() - 35 * 60 * 1000);
    fs.utimesSync(oldFile, oldTime, oldTime);

    const report = await jobService.runSweep(30 * 60 * 1000);
    expect(report.deletedFiles).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);
  });
});
