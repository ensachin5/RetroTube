import { spawn } from "node:child_process";
import fs from "node:fs";
import type { FormatRow } from "@/db/schema";
import { ensureYtDlpBinary } from "@/lib/binaries";
import { getEnv } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { buildContentDisposition, buildSafeOutputFilename } from "@/lib/filename";
import { getMimeTypeForContainer, parseRangeHeader } from "@/lib/http";
import { formatsRepo } from "@/repositories/formats.repo";
import { historyRepo } from "@/repositories/history.repo";
import { jobsRepo } from "@/repositories/jobs.repo";
import { videosRepo } from "@/repositories/videos.repo";
import { diskService } from "./disk.service";
import { jobService } from "./job.service";
import { killProcessTree } from "./process.util";
import { resolveCookiesArgs, resolveExtractorArgs } from "./ytdlp.service";

export const ALLOWED_TARGET_CONTAINERS = [
  "mp4",
  "webm",
  "mkv",
  "mp3",
  "m4a",
  "opus",
  "flac",
  "wav",
] as const;

export type TargetContainer = (typeof ALLOWED_TARGET_CONTAINERS)[number];

const AUDIO_TARGETS = new Set<TargetContainer>(["mp3", "m4a", "opus", "flac", "wav"]);
const VIDEO_TARGETS = new Set<TargetContainer>(["mp4", "webm", "mkv"]);

export interface EnqueueDownloadInput {
  videoId: number;
  formatId?: number | null;
  sourceFormatId?: string | null;
  targetContainer?: TargetContainer | null;
  audioBitrateKbps?: number | null;
}

export interface EnqueueDownloadResult {
  jobId: string;
  status: "queued";
  needsMerge: boolean;
  outputFilename: string;
  eventsUrl: string;
  streamUrl: string;
}

export interface StreamPreparedResult {
  status: 200 | 206 | 416;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
}

function resolveTargetAndQuality(params: {
  format: FormatRow;
  requestedContainer?: TargetContainer | null;
  requestedBitrate?: number | null;
}): {
  targetContainer: string;
  targetBitrateKbps: number | null;
  needsMerge: boolean;
  qualityTag: string | null;
} {
  const { format, requestedContainer, requestedBitrate } = params;

  if (requestedContainer && AUDIO_TARGETS.has(requestedContainer)) {
    const bitrate =
      requestedContainer === "mp3"
        ? requestedBitrate && [128, 192, 320].includes(requestedBitrate)
          ? requestedBitrate
          : 192
        : requestedContainer === "m4a"
          ? 192
          : requestedContainer === "opus"
            ? 160
            : null;

    const qualityTag = bitrate
      ? `${requestedContainer.toUpperCase()} ${bitrate}kbps`
      : requestedContainer.toUpperCase();

    return {
      targetContainer: requestedContainer,
      targetBitrateKbps: bitrate,
      needsMerge: true,
      qualityTag,
    };
  }

  if (format.kind === "audio") {
    return {
      targetContainer: format.container,
      targetBitrateKbps: format.bitrateKbps ? Math.round(format.bitrateKbps) : null,
      needsMerge: false,
      qualityTag: format.bitrateKbps ? `${Math.round(format.bitrateKbps)}kbps` : "audio",
    };
  }

  // Video format
  const targetContainer =
    requestedContainer && VIDEO_TARGETS.has(requestedContainer)
      ? requestedContainer
      : format.container === "webm"
        ? "webm"
        : format.container === "mkv"
          ? "mkv"
          : "mp4";

  const needsMerge = format.acodec === null || targetContainer !== format.container;
  const qualityTag = format.resolution ?? (format.height ? `${format.height}p` : null);

  return {
    targetContainer,
    targetBitrateKbps: null,
    needsMerge,
    qualityTag,
  };
}

export const downloadService = {
  async enqueue(input: EnqueueDownloadInput): Promise<EnqueueDownloadResult> {
    const env = getEnv();
    const video = videosRepo.findById(input.videoId);
    if (!video) {
      throw new AppError({
        code: ERROR_CODES.JOB_NOT_FOUND,
        status: 404,
        message: "Video metadata was not found. Please fetch the video URL first.",
      });
    }

    let format: FormatRow | null = null;
    if (input.formatId !== undefined && input.formatId !== null) {
      format = formatsRepo.findById(input.formatId);
      if (format && format.videoId !== video.id) {
        format = null;
      }
    }

    if (!format && input.sourceFormatId) {
      format = formatsRepo.findByVideoAndFormatId(video.id, input.sourceFormatId);
    }

    // For audio conversion or re-download when a cached format was pruned, fallback to best audio
    if (!format && input.targetContainer && AUDIO_TARGETS.has(input.targetContainer)) {
      format = formatsRepo.findBestAudioForVideo(video.id);
    }

    if (!format) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        status: 400,
        message:
          "Selected format is invalid or no longer available. Please re-fetch the video.",
      });
    }

    // If an audio conversion was requested on a video-only format, swap source to best audio stream
    let effectiveFormat = format;
    if (
      input.targetContainer &&
      AUDIO_TARGETS.has(input.targetContainer) &&
      format.kind === "video"
    ) {
      const bestAudio = formatsRepo.findBestAudioForVideo(video.id);
      if (!bestAudio) {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          status: 400,
          message: "No audio stream is available for conversion on this video.",
        });
      }
      effectiveFormat = bestAudio;
    }

    if (!jobService.canAcceptNewJob()) {
      throw new AppError({
        code: ERROR_CODES.QUEUE_FULL,
        status: 429,
        message:
          "Download queue is currently full. Please wait for an active job to finish.",
      });
    }

    if (env.MAX_FILE_SIZE_GB > 0 && effectiveFormat.filesizeBytes) {
      const maxBytes = env.MAX_FILE_SIZE_GB * 1024 * 1024 * 1024;
      if (effectiveFormat.filesizeBytes > maxBytes) {
        throw new AppError({
          code: ERROR_CODES.FILE_TOO_LARGE,
          status: 422,
          message: `The requested media file (${(effectiveFormat.filesizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds the configured limit of ${env.MAX_FILE_SIZE_GB} GB.`,
          details: {
            filesizeBytes: effectiveFormat.filesizeBytes,
            maxBytes,
          },
        });
      }
    }

    const plan = resolveTargetAndQuality({
      format: effectiveFormat,
      requestedContainer: input.targetContainer ?? null,
      requestedBitrate: input.audioBitrateKbps ?? null,
    });

    const estimatedBytes = diskService.estimateJobBytes(
      effectiveFormat.filesizeBytes,
      plan.needsMerge,
    );
    await diskService.assertSufficientDisk(estimatedBytes);

    const jobId = globalThis.crypto.randomUUID();
    const outputFilename = buildSafeOutputFilename({
      title: video.title,
      qualityTag: plan.qualityTag,
      extension: plan.targetContainer,
    });

    jobsRepo.create({
      id: jobId,
      videoId: video.id,
      formatId: effectiveFormat.id,
      sourceFormatId: effectiveFormat.formatId,
      targetContainer: plan.targetContainer,
      targetBitrateKbps: plan.targetBitrateKbps,
      needsMerge: plan.needsMerge,
      status: "queued",
      progressPct: 0,
      outputFilename,
      createdAt: Date.now(),
    });

    jobService.enqueue(jobId);

    return {
      jobId,
      status: "queued",
      needsMerge: plan.needsMerge,
      outputFilename,
      eventsUrl: `/api/jobs/${jobId}/events`,
      streamUrl: `/api/download/${jobId}/stream`,
    };
  },

  prepareStream(jobId: string, rangeHeader: string | null): StreamPreparedResult {
    const job = jobsRepo.findById(jobId);
    if (!job) {
      throw new AppError({
        code: ERROR_CODES.JOB_NOT_FOUND,
        status: 404,
        message: "Download job was not found.",
      });
    }

    if (job.status !== "done") {
      throw new AppError({
        code: ERROR_CODES.INVALID_JOB_STATE,
        status: 409,
        message: `Cannot stream job while status is "${job.status}".`,
        details: { status: job.status },
      });
    }

    const filepath = job.tempFilepath;
    if (!filepath || !fs.existsSync(filepath)) {
      jobsRepo.clearTempFilepath(jobId);
      throw new AppError({
        code: ERROR_CODES.FILE_EXPIRED,
        status: 410,
        message:
          "Temporary media file has expired or was already cleaned up. Please re-download.",
      });
    }

    const stat = fs.statSync(filepath);
    const fileSize = stat.size;
    if (fileSize <= 0) {
      throw new AppError({
        code: ERROR_CODES.FILE_EXPIRED,
        status: 410,
        message: "Temporary media file is empty.",
      });
    }

    jobService.cancelGraceDelete(jobId);

    const mimeType = getMimeTypeForContainer(job.targetContainer);
    const contentDisposition = buildContentDisposition(job.outputFilename);

    let start = 0;
    let end = fileSize - 1;
    let status: 200 | 206 = 200;

    if (rangeHeader) {
      const parsedRange = parseRangeHeader(rangeHeader, fileSize);
      if (!parsedRange) {
        return {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
            "Accept-Ranges": "bytes",
          },
          body: null,
        };
      }
      start = parsedRange.start;
      end = parsedRange.end;
      status = 206;
    }

    const contentLength = end - start + 1;
    const isFullOrFinalRange = !rangeHeader || end === fileSize - 1;

    // Record completion in history (ignoring tiny Range=0-1 probe until real transfer)
    if (!rangeHeader || contentLength > 2) {
      historyRepo.upsertAndPrune({
        jobId,
        bytesSent: contentLength,
      });
    }

    let nodeStream: fs.ReadStream | null = null;
    let cleanedUp = false;

    const finalizeCleanup = (cancelled = false) => {
      if (cleanedUp) return;
      cleanedUp = true;

      // Range requests are used by media players and browsers for buffering and seeking.
      // Do not delete immediately on Range request finish or cancel; keep alive for seeking.
      if (!rangeHeader && (isFullOrFinalRange || cancelled)) {
        void jobService.deleteJobTempFiles(jobId, filepath);
      } else {
        jobService.scheduleGraceDelete(jobId, filepath, 5 * 60_000);
      }
    };

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream = fs.createReadStream(filepath, { start, end });

        nodeStream.on("data", (chunk: string | Buffer) => {
          const bytes =
            typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
          controller.enqueue(bytes);
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            nodeStream?.pause();
          }
        });

        nodeStream.on("end", () => {
          try {
            controller.close();
          } catch {
            // Controller already closed
          }
          finalizeCleanup(false);
        });

        nodeStream.on("error", (err) => {
          try {
            controller.error(err);
          } catch {
            // Controller already errored/closed
          }
          finalizeCleanup(true);
        });
      },
      pull() {
        if (nodeStream && nodeStream.isPaused()) {
          nodeStream.resume();
        }
      },
      cancel() {
        if (nodeStream && !nodeStream.destroyed) {
          nodeStream.destroy();
        }
        finalizeCleanup(true);
      },
    });

    const headers: Record<string, string> = {
      "Content-Type": mimeType,
      "Content-Disposition": contentDisposition,
      "Accept-Ranges": "bytes",
      "Content-Length": String(contentLength),
      "Cache-Control": "private, no-store",
      ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${fileSize}` } : {}),
    };

    return {
      status,
      headers,
      body,
    };
  },

  async streamDirect(params: {
    canonicalUrl: string;
    formatSelector: string;
    outputFilename: string;
    targetContainer: string;
    signal?: AbortSignal;
  }): Promise<StreamPreparedResult> {
    const env = getEnv();
    const ytDlpPath = await ensureYtDlpBinary();

    const args = [
      "-o",
      "-",
      "--no-playlist",
      "--no-warnings",
      "--remote-components",
      "ejs:github",
      "--js-runtimes",
      "node",
      "--buffer-size",
      env.YTDLP_BUFFER_SIZE,
      "--socket-timeout",
      "15",
    ];
    args.push(...resolveExtractorArgs(env));
    args.push(...resolveCookiesArgs(env));

    if (env.YTDLP_PROXY) {
      args.push("--proxy", env.YTDLP_PROXY);
    }

    const isAudio = ["mp3", "m4a", "opus", "flac", "wav"].includes(params.targetContainer);
    if (isAudio) {
      args.push("-x", "--audio-format", params.targetContainer);
      if (params.formatSelector && params.formatSelector !== "best") {
        args.push("-f", params.formatSelector);
      }
    } else {
      let selector = params.formatSelector;
      if (!selector.includes("+") && selector !== "best" && selector !== "b") {
        selector = `${selector}+ba/b/${selector}`;
      }
      args.push("-f", selector);
    }

    args.push(params.canonicalUrl);

    const child = spawn(ytDlpPath, args, {
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onAbort = () => {
      killProcessTree(child, "SIGKILL");
    };
    params.signal?.addEventListener("abort", onAbort, { once: true });

    let isClosed = false;
    let stderrBuffer = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer = (stderrBuffer + chunk.toString("utf8")).slice(-1000);
    });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        child.stdout.on("data", (chunk: Buffer | Uint8Array) => {
          if (isClosed) return;
          controller.enqueue(new Uint8Array(chunk));
        });

        child.stdout.on("end", () => {
          if (isClosed) return;
          isClosed = true;
          params.signal?.removeEventListener("abort", onAbort);
          controller.close();
        });

        child.stdout.on("error", (err) => {
          if (isClosed) return;
          isClosed = true;
          params.signal?.removeEventListener("abort", onAbort);
          controller.error(err);
        });

        child.on("close", (code) => {
          if (isClosed) return;
          isClosed = true;
          params.signal?.removeEventListener("abort", onAbort);
          if (code !== 0 && code !== null) {
            controller.error(new Error(`yt-dlp stream error (code ${code}): ${stderrBuffer.trim()}`));
          } else {
            controller.close();
          }
        });
      },
      cancel() {
        if (!isClosed) {
          isClosed = true;
          params.signal?.removeEventListener("abort", onAbort);
          killProcessTree(child, "SIGKILL");
        }
      },
    });

    const mimeType = getMimeTypeForContainer(params.targetContainer);
    const contentDisposition = buildContentDisposition(params.outputFilename);

    return {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": contentDisposition,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
        "X-Accel-Buffering": "no",
      },
      body,
    };
  },
};
