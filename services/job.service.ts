import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DownloadJobRow, FormatRow } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { AppError, ERROR_CODES, normalizeError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { formatsRepo } from "@/repositories/formats.repo";
import { historyRepo } from "@/repositories/history.repo";
import { jobsRepo, type JobStatus } from "@/repositories/jobs.repo";
import { ffmpegService } from "./ffmpeg.service";
import { ytdlpService } from "./ytdlp.service";

export const ALLOWED_JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "failed", "cancelled"],
  running: ["done", "failed", "cancelled", "paused"],
  paused: ["queued", "running", "cancelled"],
  done: [],
  failed: [],
  cancelled: [],
};

export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJobStatus(from, to)) {
    throw new AppError({
      code: ERROR_CODES.INVALID_JOB_STATE,
      status: 409,
      message: `Cannot transition job from "${from}" to "${to}".`,
      details: { from, to },
    });
  }
}

export type JobStage =
  | "queued"
  | "downloading"
  | "downloading_video"
  | "downloading_audio"
  | "merging"
  | "converting"
  | "done"
  | "failed"
  | "cancelled";

export interface JobProgressEvent {
  jobId: string;
  status: JobStatus;
  progressPct: number;
  stage: JobStage;
  speed?: string | null;
  etaSec?: number | null;
  streamUrl?: string;
  outputFilename?: string;
  bytesTotal?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface SweepReport {
  deletedFiles: number;
  clearedJobs: number;
}

function getFileTtlMs(): number {
  return (getEnv().FILE_TTL_MINUTES ?? 120) * 60 * 1000;
}
const AUDIO_CONVERSION_CONTAINERS = new Set(["mp3", "m4a", "opus", "flac", "wav"]);

function isAudioConversionContainer(
  container: string,
): container is "mp3" | "m4a" | "opus" | "flac" | "wav" {
  return AUDIO_CONVERSION_CONTAINERS.has(container);
}

function selectBestAudioFormat(
  formats: FormatRow[],
  targetVideoContainer: string,
): FormatRow | null {
  const audioOnly = formats.filter((f) => f.kind === "audio" && f.acodec !== null);
  if (audioOnly.length === 0) return null;

  const preferAac = targetVideoContainer === "mp4";
  const preferOpus = targetVideoContainer === "webm";

  const sorted = [...audioOnly].sort((a, b) => {
    const aCodec = (a.acodec ?? "").toLowerCase();
    const bCodec = (b.acodec ?? "").toLowerCase();

    if (preferAac) {
      const aMatch = Number(aCodec.startsWith("mp4a") || aCodec === "aac");
      const bMatch = Number(bCodec.startsWith("mp4a") || bCodec === "aac");
      if (bMatch !== aMatch) return bMatch - aMatch;
    } else if (preferOpus) {
      const aMatch = Number(aCodec.includes("opus") || aCodec.includes("vorbis"));
      const bMatch = Number(bCodec.includes("opus") || bCodec.includes("vorbis"));
      if (bMatch !== aMatch) return bMatch - aMatch;
    }

    return (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0);
  });

  return sorted[0] ?? null;
}

class JobServiceImpl {
  private readonly emitter = new EventEmitter();
  private readonly queue: string[] = [];
  private readonly activeAbortControllers = new Map<string, AbortController>();
  private readonly latestSnapshots = new Map<string, JobProgressEvent>();
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private sweeperInterval: NodeJS.Timeout | null = null;
  private lastPersistedProgress = new Map<string, number>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public getTempDir(): string {
    const tempDir = path.resolve(getEnv().TEMP_DIR);
    fs.mkdirSync(tempDir, { recursive: true });
    return tempDir;
  }

  public getQueueMetrics(): { running: number; queued: number; maxConcurrent: number } {
    return {
      running: this.activeAbortControllers.size,
      queued: this.queue.length,
      maxConcurrent: getEnv().MAX_CONCURRENT_JOBS,
    };
  }

  public canAcceptNewJob(): boolean {
    const { running, queued, maxConcurrent } = this.getQueueMetrics();
    const maxTotal = maxConcurrent * 5;
    return running + queued < maxTotal;
  }

  public enqueue(jobId: string): void {
    const job = jobsRepo.findById(jobId);
    if (!job) {
      throw new AppError({
        code: ERROR_CODES.JOB_NOT_FOUND,
        status: 404,
        message: "Download job was not found.",
      });
    }

    this.emitProgress({
      jobId,
      status: "queued",
      progressPct: 0,
      stage: "queued",
    });

    if (!this.queue.includes(jobId) && !this.activeAbortControllers.has(jobId)) {
      this.queue.push(jobId);
    }

    this.drainQueue();
  }

  public ensureJobRunning(jobId: string): void {
    if (this.activeAbortControllers.has(jobId)) {
      return;
    }
    const job = jobsRepo.findById(jobId);
    if (!job) return;

    if (job.status === "queued" || job.status === "running") {
      if (!this.queue.includes(jobId)) {
        this.queue.push(jobId);
      }
      this.drainQueue();
    }
  }

  public subscribe(
    jobId: string,
    listener: (event: JobProgressEvent) => void,
  ): () => void {
    const eventName = `job:${jobId}`;
    this.emitter.on(eventName, listener);
    return () => {
      this.emitter.off(eventName, listener);
    };
  }

  public waitForJobCompletion(
    jobId: string,
    onProgress?: (event: JobProgressEvent) => void,
  ): Promise<JobProgressEvent> {
    const initial = this.getSnapshot(jobId);
    if (
      initial &&
      (initial.status === "done" ||
        initial.status === "failed" ||
        initial.status === "cancelled")
    ) {
      return Promise.resolve(initial);
    }

    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(jobId, (event) => {
        onProgress?.(event);
        if (
          event.status === "done" ||
          event.status === "failed" ||
          event.status === "cancelled"
        ) {
          unsubscribe();
          resolve(event);
        }
      });
    });
  }


  public getSnapshot(jobId: string): JobProgressEvent | null {
    const live = this.latestSnapshots.get(jobId);
    if (live) return live;

    const job = jobsRepo.findById(jobId);
    if (!job) return null;

    return {
      jobId: job.id,
      status: job.status,
      progressPct: job.progressPct,
      stage:
        job.status === "done"
          ? "done"
          : job.status === "failed"
            ? "failed"
            : job.status === "cancelled"
              ? "cancelled"
              : job.status === "running"
                ? "downloading"
                : "queued",
      ...(job.status === "done"
        ? {
          streamUrl: `/api/download/${job.id}/stream`,
          outputFilename: job.outputFilename,
          bytesTotal: job.bytesTotal,
        }
        : {}),
      ...(job.errorCode ? { errorCode: job.errorCode } : {}),
      ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
    };
  }

  public async cancel(jobId: string): Promise<DownloadJobRow> {
    const job = jobsRepo.findById(jobId);
    if (!job) {
      throw new AppError({
        code: ERROR_CODES.JOB_NOT_FOUND,
        status: 404,
        message: "Download job was not found.",
      });
    }

    if (job.status === "cancelled") {
      return job;
    }

    assertValidJobTransition(job.status, "cancelled");

    // Remove from queue if waiting
    const queueIdx = this.queue.indexOf(jobId);
    if (queueIdx !== -1) {
      this.queue.splice(queueIdx, 1);
    }

    // Abort active worker process tree if running
    const controller = this.activeAbortControllers.get(jobId);
    if (controller) {
      controller.abort();
    }

    const updated = jobsRepo.markCancelled(jobId);
    await this.deleteJobTempFiles(jobId, job.tempFilepath);

    this.emitProgress({
      jobId,
      status: "cancelled",
      progressPct: job.progressPct,
      stage: "cancelled",
      errorCode: ERROR_CODES.JOB_CANCELLED,
      errorMessage: "Download was cancelled.",
    });

    return updated ?? { ...job, status: "cancelled" };
  }

  public async deleteJobTempFiles(
    jobId: string,
    knownFilepath?: string | null,
  ): Promise<void> {
    this.cancelGraceDelete(jobId);
    const tempDir = this.getTempDir();
    const candidates = new Set<string>();

    if (knownFilepath) {
      candidates.add(path.resolve(knownFilepath));
    }

    try {
      const entries = await fsp.readdir(tempDir);
      for (const entry of entries) {
        if (entry === jobId || entry.startsWith(`${jobId}.`)) {
          candidates.add(path.join(tempDir, entry));
        }
      }
    } catch {
      // Ignore directory read failure if TEMP_DIR wasn't created yet
    }

    for (const filePath of candidates) {
      try {
        await fsp.unlink(filePath);
      } catch {
        // Already deleted or missing
      }
    }

    jobsRepo.clearTempFilepath(jobId);
  }

  public scheduleGraceDelete(jobId: string, filepath: string, delayMs = 60_000): void {
    this.cancelGraceDelete(jobId);
    const timer = setTimeout(() => {
      this.graceTimers.delete(jobId);
      void this.deleteJobTempFiles(jobId, filepath);
    }, delayMs);
    timer.unref();
    this.graceTimers.set(jobId, timer);
  }

  public cancelGraceDelete(jobId: string): void {
    const existing = this.graceTimers.get(jobId);
    if (existing) {
      clearTimeout(existing);
      this.graceTimers.delete(jobId);
    }
  }

  public async runSweep(maxAgeMs = getFileTtlMs()): Promise<SweepReport> {
    const tempDir = this.getTempDir();
    const now = Date.now();
    const activePaths = new Set(
      jobsRepo.listActiveTempFilepaths().map((p) => path.resolve(p)),
    );
    const activeJobIds = new Set(this.activeAbortControllers.keys());

    let deletedFiles = 0;
    const deletedPaths: string[] = [];

    try {
      const entries = await fsp.readdir(tempDir);
      for (const entry of entries) {
        const fullPath = path.join(tempDir, entry);
        if (activePaths.has(path.resolve(fullPath))) continue;

        // Skip files belonging to currently running jobs
        const matchingActiveJob = Array.from(activeJobIds).some(
          (id) => entry === id || entry.startsWith(`${id}.`),
        );
        if (matchingActiveJob) continue;

        try {
          const stat = await fsp.stat(fullPath);
          if (stat.isFile() && now - stat.mtimeMs >= maxAgeMs) {
            await fsp.unlink(fullPath);
            deletedFiles += 1;
            deletedPaths.push(fullPath);
          }
        } catch {
          // Ignore file stat/unlink race
        }
      }
    } catch {
      // Ignore missing tempDir
    }

    const clearedJobs = jobsRepo.clearTempFilepathsByPaths(deletedPaths);

    // Also clear DB tempFilepath pointers whose files no longer exist
    const staleRows = jobsRepo.listNonRunningWithTempFile();
    for (const row of staleRows) {
      if (row.tempFilepath && !fs.existsSync(row.tempFilepath)) {
        jobsRepo.clearTempFilepath(row.id);
      }
    }

    if (deletedFiles > 0 || clearedJobs > 0) {
      logger.info("Temp directory sweep completed", {
        deletedFiles,
        clearedJobs,
      });
    }

    return { deletedFiles, clearedJobs };
  }

  public startPeriodicSweeper(intervalMs = getFileTtlMs()): void {
    if (this.sweeperInterval) return;
    this.sweeperInterval = setInterval(() => {
      void this.runSweep();
    }, intervalMs);
    this.sweeperInterval.unref();
  }

  public stopPeriodicSweeper(): void {
    if (!this.sweeperInterval) return;
    clearInterval(this.sweeperInterval);
    this.sweeperInterval = null;
  }

  public async recoverOnStartup(): Promise<{
    recoveredJobs: number;
    sweep: SweepReport;
  }> {
    const recoveredJobs = jobsRepo.markStaleJobsAsServerRestart();
    const sweep = await this.runSweep(getFileTtlMs());
    if (recoveredJobs > 0) {
      logger.warn("Marked stale jobs as failed after server restart", {
        recoveredJobs,
        errorCode: ERROR_CODES.SERVER_RESTART,
      });
    }
    return { recoveredJobs, sweep };
  }

  private drainQueue(): void {
    const maxConcurrent = getEnv().MAX_CONCURRENT_JOBS;
    while (this.activeAbortControllers.size < maxConcurrent && this.queue.length > 0) {
      const nextJobId = this.queue.shift();
      if (!nextJobId) break;

      const controller = new AbortController();
      this.activeAbortControllers.set(nextJobId, controller);

      void this.runJob(nextJobId, controller).finally(() => {
        this.activeAbortControllers.delete(nextJobId);
        this.lastPersistedProgress.delete(nextJobId);
        this.drainQueue();
      });
    }
  }

  private async runJob(jobId: string, controller: AbortController): Promise<void> {
    const record = jobsRepo.findWithVideoById(jobId);
    if (!record) return;

    const { job, video } = record;
    if (job.status !== "queued" && job.status !== "running") {
      return;
    }

    const started = jobsRepo.transitionToRunning(jobId);
    if (!started) return;

    const tempDir = this.getTempDir();

    // Aggressively clean up orphan part files and stale temp files from failed/cancelled jobs
    // while preserving files belonging to currently running jobs or completed jobs waiting to be streamed
    try {
      const activeJobIds = new Set(this.activeAbortControllers.keys());
      const doneJobsWithFiles = new Set(
        jobsRepo
          .listNonRunningWithTempFile()
          .map((r) => r.tempFilepath && path.resolve(r.tempFilepath))
          .filter((p): p is string => Boolean(p)),
      );
      const entries = await fsp.readdir(tempDir);
      for (const entry of entries) {
        if (entry.includes(jobId)) continue;
        const belongsToActive = Array.from(activeJobIds).some((id) => entry.startsWith(id));
        const fullPath = path.resolve(path.join(tempDir, entry));
        if (belongsToActive || doneJobsWithFiles.has(fullPath)) continue;

        if (
          entry.includes(".part") ||
          entry.endsWith(".mp4") ||
          entry.endsWith(".webm") ||
          entry.endsWith(".mkv") ||
          entry.endsWith(".mp3")
        ) {
          await fsp.unlink(fullPath).catch(() => undefined);
        }
      }
    } catch {
      // Ignore cleanup error
    }

    const finalOutputPath = path.join(
      /*turbopackIgnore: true*/ tempDir,
      `${jobId}.${job.targetContainer}`,
    );
    const canonicalUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;
    const intermediatePaths: string[] = [];

    const reportProgress = (
      pct: number,
      stage: JobStage,
      extra?: { speed?: string | null; etaSec?: number | null },
    ) => {
      const rounded = Math.round(Math.max(0, Math.min(99.9, pct)) * 10) / 10;
      const lastPersisted = this.lastPersistedProgress.get(jobId) ?? -1;
      if (rounded - lastPersisted >= 2 || rounded >= 99) {
        this.lastPersistedProgress.set(jobId, rounded);
        jobsRepo.updateProgress(jobId, rounded);
      }

      this.emitProgress({
        jobId,
        status: "running",
        progressPct: rounded,
        stage,
        speed: extra?.speed ?? null,
        etaSec: extra?.etaSec ?? null,
      });
    };

    try {
      const formats = formatsRepo.listByVideoId(video.id);
      const sourceFormat =
        (job.formatId ? formats.find((f) => f.id === job.formatId) : null) ??
        formats.find((f) => f.formatId === job.sourceFormatId) ??
        null;

      if (isAudioConversionContainer(job.targetContainer)) {
        const rawAudioPath = path.join(tempDir, `${jobId}.part.audio`);
        intermediatePaths.push(rawAudioPath);

        reportProgress(0, "downloading_audio");
        await ytdlpService.downloadStream({
          canonicalUrl,
          formatSelector: job.sourceFormatId,
          outputPath: rawAudioPath,
          signal: controller.signal,
          onProgress: (sample) => {
            reportProgress(sample.pct * 0.6, "downloading_audio", {
              speed: sample.speed,
              etaSec: sample.etaSec,
            });
          },
        });

        reportProgress(60, "converting");
        await ffmpegService.transcodeAudio({
          inputPath: rawAudioPath,
          outputPath: finalOutputPath,
          targetContainer: job.targetContainer,
          bitrateKbps: job.targetBitrateKbps,
          durationSec: video.durationSec,
          signal: controller.signal,
          onProgress: (ffPct) => {
            reportProgress(60 + ffPct * 0.39, "converting");
          },
        });
      } else if (job.needsMerge) {
        const videoContainer =
          job.targetContainer === "webm" || job.targetContainer === "mkv"
            ? job.targetContainer
            : "mp4";

        const rawVideoPath = path.join(tempDir, `${jobId}.part.video`);
        const rawAudioPath = path.join(tempDir, `${jobId}.part.audio`);
        intermediatePaths.push(rawVideoPath, rawAudioPath);

        const bestAudio = selectBestAudioFormat(formats, videoContainer);
        const audioSelector = bestAudio?.formatId ?? "bestaudio";

        let videoPct = 0;
        let audioPct = 0;
        let lastSpeed: string | null = null;
        let lastEta: number | null = null;

        const updateParallelProgress = () => {
          const combined = Math.min(84.9, (videoPct * 0.75 + audioPct * 0.25) * 0.85);
          reportProgress(combined, "downloading", {
            speed: lastSpeed,
            etaSec: lastEta,
          });
        };

        reportProgress(0, "downloading");
        await Promise.all([
          ytdlpService.downloadStream({
            canonicalUrl,
            formatSelector: job.sourceFormatId,
            outputPath: rawVideoPath,
            signal: controller.signal,
            onProgress: (sample) => {
              videoPct = sample.pct;
              if (sample.speed) lastSpeed = sample.speed;
              if (sample.etaSec !== null) lastEta = sample.etaSec;
              updateParallelProgress();
            },
          }),
          ytdlpService.downloadStream({
            canonicalUrl,
            formatSelector: audioSelector,
            outputPath: rawAudioPath,
            signal: controller.signal,
            onProgress: (sample) => {
              audioPct = sample.pct;
              updateParallelProgress();
            },
          }),
        ]);

        reportProgress(85, "merging");
        await ffmpegService.mergeVideoAndAudio({
          videoPath: rawVideoPath,
          audioPath: rawAudioPath,
          outputPath: finalOutputPath,
          targetContainer: videoContainer,
          audioCodec: bestAudio?.acodec ?? sourceFormat?.acodec ?? null,
          durationSec: video.durationSec,
          signal: controller.signal,
          onProgress: (ffPct) => {
            reportProgress(85 + ffPct * 0.14, "merging");
          },
        });
      } else {
        reportProgress(0, "downloading");
        await ytdlpService.downloadStream({
          canonicalUrl,
          formatSelector: job.sourceFormatId,
          outputPath: finalOutputPath,
          signal: controller.signal,
          onProgress: (sample) => {
            reportProgress(sample.pct * 0.99, "downloading", {
              speed: sample.speed,
              etaSec: sample.etaSec,
            });
          },
        });
      }

      // Clean intermediate files right away
      for (const tempPart of intermediatePaths) {
        await fsp.unlink(tempPart).catch(() => undefined);
      }

      const stat = await fsp
        .stat(/*turbopackIgnore: true*/ finalOutputPath)
        .catch(() => null);
      if (!stat || stat.size <= 0) {
        throw new AppError({
          code: ERROR_CODES.YTDLP_FAILED,
          status: 502,
          message: "Downloaded media file was empty or missing.",
        });
      }

      const doneJob = jobsRepo.markDone(jobId, {
        tempFilepath: finalOutputPath,
        bytesTotal: stat.size,
      });

      // Commit to local SQLite history immediately upon job completion
      try {
        historyRepo.upsertAndPrune({
          jobId,
          bytesSent: stat.size,
        });
      } catch (historyErr) {
        logger.warn("Failed to persist completed job into local SQLite history", {
          jobId,
          error: historyErr,
        });
      }

      if (doneJob) {
        this.emitProgress({
          jobId,
          status: "done",
          progressPct: 100,
          stage: "done",
          streamUrl: `/api/download/${jobId}/stream`,
          outputFilename: doneJob.outputFilename,
          bytesTotal: stat.size,
        });
      }

      logger.info("Download job completed", {
        jobId,
        youtubeId: video.youtubeId,
        targetContainer: job.targetContainer,
        bytesTotal: stat.size,
      });
    } catch (err) {
      await this.deleteJobTempFiles(jobId, finalOutputPath);

      const latest = jobsRepo.findById(jobId);
      if (controller.signal.aborted || latest?.status === "cancelled") {
        // Already marked cancelled by cancel()
        return;
      }

      const appError = normalizeError(err);
      jobsRepo.markFailed(jobId, {
        errorCode: appError.code,
        errorMessage: appError.message,
      });

      this.emitProgress({
        jobId,
        status: "failed",
        progressPct: latest?.progressPct ?? 0,
        stage: "failed",
        errorCode: appError.code,
        errorMessage: appError.message,
      });

      logger.warn("Download job failed", {
        jobId,
        errorCode: appError.code,
        cause: appError.message,
        details: appError.details,
      });
    }
  }

  private emitProgress(event: JobProgressEvent): void {
    this.latestSnapshots.set(event.jobId, event);
    this.emitter.emit(`job:${event.jobId}`, event);
  }
}

const globalForJobService = globalThis as typeof globalThis & {
  __retrotubeJobService?: JobServiceImpl;
};

export function getJobService(): JobServiceImpl {
  if (!globalForJobService.__retrotubeJobService) {
    globalForJobService.__retrotubeJobService = new JobServiceImpl();
  }
  return globalForJobService.__retrotubeJobService;
}

export const jobService = getJobService();
