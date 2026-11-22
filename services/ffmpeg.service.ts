import { getEnv } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { runSpawnedCommand } from "./process.util";

export function parseFfmpegProgressLine(
  line: string,
  durationSec: number,
): number | null {
  if (durationSec <= 0) return null;

  const usMatch = /^out_time_us=(\d+)$/.exec(line.trim());
  if (usMatch && usMatch[1]) {
    const outTimeUs = Number(usMatch[1]);
    if (Number.isFinite(outTimeUs) && outTimeUs >= 0) {
      const pct = (outTimeUs / (durationSec * 1_000_000)) * 100;
      return Math.max(0, Math.min(100, pct));
    }
  }

  const msMatch = /^out_time_ms=(\d+)$/.exec(line.trim());
  if (msMatch && msMatch[1]) {
    const outTimeMs = Number(msMatch[1]);
    if (Number.isFinite(outTimeMs) && outTimeMs >= 0) {
      const pct = (outTimeMs / (durationSec * 1_000_000)) * 100;
      return Math.max(0, Math.min(100, pct));
    }
  }

  if (line.trim() === "progress=end") {
    return 100;
  }

  return null;
}

function buildAudioTranscodeArgs(
  targetContainer: "mp3" | "m4a" | "opus" | "flac" | "wav",
  bitrateKbps: number | null,
): string[] {
  switch (targetContainer) {
    case "mp3":
      return ["-vn", "-c:a", "libmp3lame", "-b:a", `${bitrateKbps ?? 192}k`];
    case "m4a":
      return [
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        `${bitrateKbps ?? 192}k`,
        "-movflags",
        "+faststart",
      ];
    case "opus":
      return ["-vn", "-c:a", "libopus", "-b:a", `${bitrateKbps ?? 160}k`];
    case "flac":
      return ["-vn", "-c:a", "flac"];
    case "wav":
      return ["-vn", "-c:a", "pcm_s16le"];
  }
}

function isAudioCopyCompatible(
  targetContainer: "mp4" | "webm" | "mkv",
  audioCodec: string | null,
): boolean {
  if (targetContainer === "mkv") return true;
  const codec = (audioCodec ?? "").toLowerCase();
  if (targetContainer === "mp4") {
    return codec.startsWith("mp4a") || codec === "aac";
  }
  if (targetContainer === "webm") {
    return codec.includes("opus") || codec.includes("vorbis");
  }
  return false;
}

export const ffmpegService = {
  async mergeVideoAndAudio(params: {
    videoPath: string;
    audioPath: string;
    outputPath: string;
    targetContainer: "mp4" | "webm" | "mkv";
    audioCodec: string | null;
    durationSec: number;
    signal?: AbortSignal;
    onProgress?: (pct: number) => void;
  }): Promise<void> {
    const env = getEnv();
    const canCopyAudio = isAudioCopyCompatible(params.targetContainer, params.audioCodec);

    const audioArgs = canCopyAudio
      ? ["-c:a", "copy"]
      : params.targetContainer === "webm"
        ? ["-c:a", "libopus", "-b:a", "160k"]
        : ["-c:a", "aac", "-b:a", "192k"];

    const containerFlags =
      params.targetContainer === "mp4" ? ["-movflags", "+faststart"] : [];

    const args = [
      "-y",
      "-threads",
      "0",
      "-fflags",
      "+genpts",
      "-i",
      params.videoPath,
      "-i",
      params.audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      ...audioArgs,
      "-avoid_negative_ts",
      "make_zero",
      "-max_interleave_delta",
      "0",
      ...containerFlags,
      "-progress",
      "pipe:1",
      "-nostats",
      params.outputPath,
    ];

    let result;
    try {
      result = await runSpawnedCommand({
        command: env.FFMPEG_PATH,
        args,
        timeoutMs: env.YTDLP_DOWNLOAD_TIMEOUT_MS,
        signal: params.signal,
        onStdoutLine: (line) => {
          const pct = parseFfmpegProgressLine(line, params.durationSec);
          if (pct !== null) params.onProgress?.(pct);
        },
      });
    } catch (err) {
      throw new AppError({
        code: ERROR_CODES.FFMPEG_FAILED,
        status: 500,
        message: "Failed to execute ffmpeg binary for stream merge.",
        cause: err,
      });
    }

    if (result.aborted) {
      throw new AppError({
        code: ERROR_CODES.JOB_CANCELLED,
        status: 499,
        message: "Merge job was cancelled.",
      });
    }

    if (result.timedOut) {
      throw new AppError({
        code: ERROR_CODES.TIMEOUT,
        status: 504,
        message: "Merging video and audio streams timed out.",
      });
    }

    if (result.code !== 0) {
      throw new AppError({
        code: ERROR_CODES.FFMPEG_FAILED,
        status: 500,
        message: "ffmpeg failed while merging video and audio streams.",
        details: result.stderr ? { stderr: result.stderr.slice(-500) } : undefined,
      });
    }
  },

  async transcodeAudio(params: {
    inputPath: string;
    outputPath: string;
    targetContainer: "mp3" | "m4a" | "opus" | "flac" | "wav";
    bitrateKbps: number | null;
    durationSec: number;
    signal?: AbortSignal;
    onProgress?: (pct: number) => void;
  }): Promise<void> {
    const env = getEnv();
    const codecArgs = buildAudioTranscodeArgs(params.targetContainer, params.bitrateKbps);

    const args = [
      "-y",
      "-threads",
      "0",
      "-i",
      params.inputPath,
      ...codecArgs,
      "-progress",
      "pipe:1",
      "-nostats",
      params.outputPath,
    ];

    let result;
    try {
      result = await runSpawnedCommand({
        command: env.FFMPEG_PATH,
        args,
        timeoutMs: env.YTDLP_DOWNLOAD_TIMEOUT_MS,
        signal: params.signal,
        onStdoutLine: (line) => {
          const pct = parseFfmpegProgressLine(line, params.durationSec);
          if (pct !== null) params.onProgress?.(pct);
        },
      });
    } catch (err) {
      throw new AppError({
        code: ERROR_CODES.FFMPEG_FAILED,
        status: 500,
        message: "Failed to execute ffmpeg binary for audio conversion.",
        cause: err,
      });
    }

    if (result.aborted) {
      throw new AppError({
        code: ERROR_CODES.JOB_CANCELLED,
        status: 499,
        message: "Audio conversion job was cancelled.",
      });
    }

    if (result.timedOut) {
      throw new AppError({
        code: ERROR_CODES.TIMEOUT,
        status: 504,
        message: "Audio conversion timed out.",
      });
    }

    if (result.code !== 0) {
      throw new AppError({
        code: ERROR_CODES.FFMPEG_FAILED,
        status: 500,
        message: "ffmpeg failed while converting audio.",
        details: result.stderr ? { stderr: result.stderr.slice(-500) } : undefined,
      });
    }
  },

  async probeVersion(): Promise<{ ok: boolean; version?: string; error?: string }> {
    const env = getEnv();
    try {
      const result = await runSpawnedCommand({
        command: env.FFMPEG_PATH,
        args: ["-version"],
        timeoutMs: 5000,
      });
      if (result.code === 0) {
        const firstLine = result.stdout.split(/\r?\n/)[0]?.trim() ?? "ffmpeg";
        return { ok: true, version: firstLine };
      }
      return {
        ok: false,
        error: result.stderr.trim() || `Exited with code ${result.code}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "ffmpeg executable not found",
      };
    }
  },
};
