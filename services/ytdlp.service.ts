import fs from "node:fs";
import path from "node:path";
import { ensureYtDlpBinary } from "@/lib/binaries";
import { getEnv, type AppEnv } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import type { RawYtDlpInfo } from "./format.normalizer";
import { runSpawnedCommand } from "./process.util";

export function resolveCookiesArgs(env: AppEnv): string[] {
  if (env.YTDLP_COOKIES_FILE && fs.existsSync(env.YTDLP_COOKIES_FILE)) {
    return ["--cookies", env.YTDLP_COOKIES_FILE];
  }
  if (env.YTDLP_COOKIES_TEXT) {
    const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
    const tmpDir = isVercel
      ? "/tmp"
      : process.env.TEMP_DIR && process.env.TEMP_DIR.startsWith("/tmp")
        ? process.env.TEMP_DIR
        : "/tmp";
    const tmpCookiePath = path.join(tmpDir, "retrotube-cookies.txt");
    try {
      fs.mkdirSync(path.dirname(tmpCookiePath), { recursive: true });
      let content = env.YTDLP_COOKIES_TEXT;
      if (!content.includes("\n") && content.includes("\\n")) {
        content = content.replace(/\\n/g, "\n");
      }
      fs.writeFileSync(tmpCookiePath, content.trim() + "\n", { encoding: "utf8" });
      return ["--cookies", tmpCookiePath];
    } catch {
      // Ignore write error
    }
  }
  if (env.YTDLP_COOKIES_BASE64) {
    const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
    const tmpDir = isVercel
      ? "/tmp"
      : process.env.TEMP_DIR && process.env.TEMP_DIR.startsWith("/tmp")
        ? process.env.TEMP_DIR
        : "/tmp";
    const tmpCookiePath = path.join(tmpDir, "retrotube-cookies.txt");
    try {
      fs.mkdirSync(path.dirname(tmpCookiePath), { recursive: true });
      const decoded = Buffer.from(env.YTDLP_COOKIES_BASE64, "base64").toString("utf8");
      fs.writeFileSync(tmpCookiePath, decoded.trim() + "\n", { encoding: "utf8" });
      return ["--cookies", tmpCookiePath];
    } catch {
      // Ignore write error
    }
  }
  if (env.YTDLP_COOKIES_FROM_BROWSER) {
    return ["--cookies-from-browser", env.YTDLP_COOKIES_FROM_BROWSER];
  }
  return [];
}

export function resolveExtractorArgs(env: AppEnv, clientOverride?: string): string[] {
  if (env.YTDLP_EXTRACTOR_ARGS) {
    return ["--extractor-args", env.YTDLP_EXTRACTOR_ARGS];
  }
  const client = clientOverride || env.YTDLP_PLAYER_CLIENT;
  if (client) {
    return ["--extractor-args", `youtube:player_client=${client};skip=translated_subs,comments`];
  }
  // Default: do not hardcode player_client=android,web.
  // In modern yt-dlp, omitting player_client allows yt-dlp to use its resilient
  // multi-client default ('tv_samsung', 'visionos', 'web') which does not get blocked
  // by YouTube's android PO token requirements or cloud datacenter IP blocks.
  return ["--extractor-args", "youtube:skip=translated_subs,comments"];
}

export interface DownloadProgressSample {
  pct: number;
  speed: string | null;
  etaSec: number | null;
}

export interface RawYtDlpPlaylistEntry {
  id?: string;
  title?: string;
  duration?: number | null;
  thumbnail?: string | null;
  thumbnails?: Array<{ url: string; width?: number; height?: number }>;
  url?: string;
  ie_key?: string;
  _type?: string;
  availability?: string;
}

export interface RawYtDlpPlaylistInfo {
  _type?: string;
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  uploader_id?: string;
  entries?: Array<RawYtDlpPlaylistEntry | null>;
}

const YTDLP_PROGRESS_REGEX =
  /\[download\]\s+(\d+(?:\.\d+)?)%(?:\s+of\s+~?\s*\S+)?(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/i;

export function parseYtDlpProgressLine(line: string): DownloadProgressSample | null {
  const match = YTDLP_PROGRESS_REGEX.exec(line);
  if (!match || !match[1]) return null;

  const pct = Number(match[1]);
  if (!Number.isFinite(pct)) return null;

  const speed = match[2] && match[2] !== "Unknown" ? match[2] : null;
  let etaSec: number | null = null;
  const rawEta = match[3];
  if (rawEta && rawEta !== "Unknown") {
    const parts = rawEta.split(":").map((part) => Number(part));
    if (parts.every((p) => Number.isFinite(p))) {
      if (parts.length === 2) {
        etaSec = (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
      } else if (parts.length === 3) {
        etaSec = (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
      }
    }
  }

  return {
    pct: Math.max(0, Math.min(100, pct)),
    speed,
    etaSec,
  };
}

export function mapYtDlpStderrToError(stderr: string): AppError {
  const lower = stderr.toLowerCase();

  if (lower.includes("private video") || lower.includes("this video is private")) {
    return new AppError({
      code: ERROR_CODES.PRIVATE_VIDEO,
      status: 403,
      message: "This video is private and cannot be accessed.",
    });
  }

  if (
    lower.includes("confirm your age") ||
    lower.includes("age-restricted") ||
    lower.includes("inappropriate for some users")
  ) {
    return new AppError({
      code: ERROR_CODES.AGE_RESTRICTED,
      status: 403,
      message: "This video is age-restricted and cannot be fetched without sign-in.",
    });
  }

  if (
    lower.includes("not made this video available in your country") ||
    lower.includes("blocked it in your country") ||
    lower.includes("geo-restricted") ||
    lower.includes("geo restricted")
  ) {
    return new AppError({
      code: ERROR_CODES.GEO_BLOCKED,
      status: 451,
      message: "This video is geo-blocked and unavailable in the server's region.",
    });
  }

  if (
    lower.includes("this live event will begin") ||
    lower.includes("live stream") ||
    lower.includes("premieres in") ||
    lower.includes("is live")
  ) {
    return new AppError({
      code: ERROR_CODES.LIVE_STREAM,
      status: 422,
      message: "Live streams and upcoming premieres cannot be downloaded.",
    });
  }

  if (
    lower.includes("http error 429") ||
    lower.includes("too many requests") ||
    lower.includes("confirm you’re not a bot") ||
    lower.includes("confirm you're not a bot")
  ) {
    return new AppError({
      code: ERROR_CODES.RATE_LIMITED,
      status: 429,
      message:
        "YouTube temporarily rate-limited requests from this server. Please try again shortly.",
      details: stderr ? { stderr: stderr.slice(-500) } : undefined,
    });
  }

  if (lower.includes("unsupported url") || lower.includes("is not a valid url")) {
    return new AppError({
      code: ERROR_CODES.INVALID_URL,
      status: 400,
      message: "Please enter a valid YouTube video URL.",
    });
  }

  if (
    lower.includes("video unavailable") ||
    lower.includes("has been removed") ||
    lower.includes("account associated with this video has been terminated")
  ) {
    return new AppError({
      code: ERROR_CODES.VIDEO_UNAVAILABLE,
      status: 404,
      message: "This video is unavailable or has been removed.",
    });
  }

  if (
    lower.includes("this playlist type is unviewable") ||
    lower.includes("unable to recognize playlist") ||
    lower.includes("playlist does not exist") ||
    lower.includes("the playlist does not exist")
  ) {
    return new AppError({
      code: ERROR_CODES.PLAYLIST_EMPTY,
      status: 404,
      message:
        "This playlist does not exist, is private, or cannot be viewed as a batch playlist.",
    });
  }

  return new AppError({
    code: ERROR_CODES.YTDLP_FAILED,
    status: 502,
    message: "Failed to fetch or download media via yt-dlp.",
    details: stderr ? { stderr: stderr.slice(-500) } : undefined,
  });
}

export const ytdlpService = {
  async inspectVideo(canonicalUrl: string, signal?: AbortSignal): Promise<RawYtDlpInfo> {
    const env = getEnv();
    const ytDlpPath = await ensureYtDlpBinary();

    const buildArgs = (clientOverride?: string) => {
      const args = [
        "-J",
        "--no-playlist",
        "--no-warnings",
        "--no-check-formats",
        "--skip-download",
        "--remote-components",
        "ejs:github",
        "--js-runtimes",
        "node",
        "--no-write-comments",
        "--no-write-thumbnail",
        "--no-write-subs",
        "--no-write-auto-subs",
      ];
      args.push(...resolveExtractorArgs(env, clientOverride));
      args.push("--socket-timeout", "10");
      args.push(...resolveCookiesArgs(env));
      if (env.YTDLP_PROXY) {
        args.push("--proxy", env.YTDLP_PROXY);
      }
      args.push(canonicalUrl);
      return args;
    };

    let result;
    try {
      result = await runSpawnedCommand({
        command: ytDlpPath,
        args: buildArgs(),
        timeoutMs: env.YTDLP_FETCH_TIMEOUT_MS,
        signal,
      });
    } catch (err) {
      throw new AppError({
        code: ERROR_CODES.YTDLP_FAILED,
        status: 502,
        message: "Failed to execute yt-dlp binary.",
        cause: err,
      });
    }

    if (result.timedOut) {
      throw new AppError({
        code: ERROR_CODES.TIMEOUT,
        status: 504,
        message: "Fetching video metadata timed out. Please try again.",
      });
    }

    if (result.aborted) {
      throw new AppError({
        code: ERROR_CODES.JOB_CANCELLED,
        status: 499,
        message: "Metadata fetch was cancelled.",
      });
    }

    if (result.code !== 0 && !signal?.aborted) {
      const mapped = mapYtDlpStderrToError(result.stderr || result.stdout);
      if (mapped.code === ERROR_CODES.RATE_LIMITED) {
        // If YouTube challenged the datacenter IP (429 or bot check), try fallback clients
        const fallbackClients = ["tv_samsung,visionos", "tv_embedded,web", "ios,web"];
        for (const fallback of fallbackClients) {
          if (signal?.aborted) break;
          await new Promise((res) => setTimeout(res, 800));
          const fallbackResult = await runSpawnedCommand({
            command: ytDlpPath,
            args: buildArgs(fallback),
            timeoutMs: env.YTDLP_FETCH_TIMEOUT_MS,
            signal,
          });
          if (fallbackResult.code === 0) {
            result = fallbackResult;
            break;
          }
        }
      }
    }

    if (result.code !== 0) {
      throw mapYtDlpStderrToError(result.stderr || result.stdout);
    }

    let parsed: RawYtDlpInfo;
    try {
      parsed = JSON.parse(result.stdout) as RawYtDlpInfo;
    } catch (err) {
      throw new AppError({
        code: ERROR_CODES.YTDLP_FAILED,
        status: 502,
        message: "yt-dlp returned invalid metadata JSON.",
        cause: err,
      });
    }

    if (parsed.is_live === true || parsed.live_status === "is_live") {
      throw new AppError({
        code: ERROR_CODES.LIVE_STREAM,
        status: 422,
        message: "Live streams cannot be downloaded while broadcasting.",
      });
    }

    return parsed;
  },

  async inspectPlaylistFlat(
    canonicalPlaylistUrl: string,
    signal?: AbortSignal,
  ): Promise<RawYtDlpPlaylistInfo> {
    const env = getEnv();
    const ytDlpPath = await ensureYtDlpBinary();

    const buildArgs = (clientOverride?: string) => {
      const args = [
        "-J",
        "--flat-playlist",
        "--no-warnings",
        "--no-check-formats",
        "--skip-download",
        "--remote-components",
        "ejs:github",
        "--js-runtimes",
        "node",
        "--ignore-errors",
        "--no-write-comments",
        "--no-write-thumbnail",
        "--no-write-subs",
        "--no-write-auto-subs",
      ];
      args.push(...resolveExtractorArgs(env, clientOverride));
      args.push("--socket-timeout", "10");
      args.push(...resolveCookiesArgs(env));
      if (env.YTDLP_PROXY) {
        args.push("--proxy", env.YTDLP_PROXY);
      }
      args.push(canonicalPlaylistUrl);
      return args;
    };

    let result;
    try {
      result = await runSpawnedCommand({
        command: ytDlpPath,
        args: buildArgs(),
        timeoutMs: Math.max(30000, env.YTDLP_FETCH_TIMEOUT_MS * 2),
        signal,
      });
    } catch (err) {
      throw new AppError({
        code: ERROR_CODES.YTDLP_FAILED,
        status: 502,
        message: "Failed to execute yt-dlp binary for playlist.",
        cause: err,
      });
    }

    if (result.timedOut) {
      throw new AppError({
        code: ERROR_CODES.TIMEOUT,
        status: 504,
        message: "Fetching playlist metadata timed out. Please try again.",
      });
    }

    if (result.aborted) {
      throw new AppError({
        code: ERROR_CODES.JOB_CANCELLED,
        status: 499,
        message: "Playlist fetch was cancelled.",
      });
    }

    if (result.code !== 0 && !signal?.aborted) {
      const mapped = mapYtDlpStderrToError(result.stderr || result.stdout);
      if (mapped.code === ERROR_CODES.RATE_LIMITED) {
        const fallbackClients = ["tv_samsung,visionos", "tv_embedded,web", "ios,web"];
        for (const fallback of fallbackClients) {
          if (signal?.aborted) break;
          await new Promise((res) => setTimeout(res, 800));
          const fallbackResult = await runSpawnedCommand({
            command: ytDlpPath,
            args: buildArgs(fallback),
            timeoutMs: Math.max(30000, env.YTDLP_FETCH_TIMEOUT_MS * 2),
            signal,
          });
          if (fallbackResult.code === 0) {
            result = fallbackResult;
            break;
          }
        }
      }
    }

    if (result.code !== 0) {
      const trimmed = (result.stdout || "").trim();
      if (!trimmed || trimmed === "null") {
        throw mapYtDlpStderrToError(result.stderr || result.stdout);
      }
    }

    let parsed: RawYtDlpPlaylistInfo;
    try {
      parsed = JSON.parse(result.stdout) as RawYtDlpPlaylistInfo;
    } catch (err) {
      if (result.code !== 0) {
        throw mapYtDlpStderrToError(result.stderr || result.stdout);
      }
      throw new AppError({
        code: ERROR_CODES.YTDLP_FAILED,
        status: 502,
        message: "yt-dlp returned invalid playlist metadata JSON.",
        cause: err,
      });
    }

    if (!parsed || typeof parsed !== "object") {
      if (result.code !== 0) {
        throw mapYtDlpStderrToError(result.stderr || result.stdout);
      }
      throw new AppError({
        code: ERROR_CODES.PLAYLIST_EMPTY,
        status: 404,
        message:
          "Could not retrieve playlist metadata. The playlist may be empty, private, or unavailable.",
      });
    }

    return parsed;
  },

  async downloadStream(params: {
    canonicalUrl: string;
    formatSelector: string;
    outputPath: string;
    signal?: AbortSignal;
    onProgress?: (sample: DownloadProgressSample) => void;
  }): Promise<void> {
    const env = getEnv();
    const ytDlpPath = await ensureYtDlpBinary();
    const args = [
      "--no-playlist",
      "--newline",
      "--progress",
      "--continue",
      "--remote-components",
      "ejs:github",
      "--js-runtimes",
      "node",
      "--no-warnings",
      "--concurrent-fragments",
      String(env.YTDLP_CONCURRENT_FRAGMENTS),
      "--buffer-size",
      env.YTDLP_BUFFER_SIZE,
      "--retries",
      "5",
      "--fragment-retries",
      "5",
      "--no-mtime",
    ];
    args.push(...resolveExtractorArgs(env));

    if (env.YTDLP_HTTP_CHUNK_SIZE && env.YTDLP_HTTP_CHUNK_SIZE !== "none") {
      args.push("--http-chunk-size", env.YTDLP_HTTP_CHUNK_SIZE);
    }

    args.push(...resolveCookiesArgs(env));
    if (env.YTDLP_PROXY) {
      args.push("--proxy", env.YTDLP_PROXY);
    }
    if (env.YTDLP_USE_ARIA2) {
      args.push(
        "--downloader",
        "aria2c",
        "--downloader-args",
        "aria2c:-s 16 -x 16 -k 1M -j 8",
      );
    }

    args.push("-f", params.formatSelector, "-o", params.outputPath, params.canonicalUrl);

    let result;
    try {
      result = await runSpawnedCommand({
        command: ytDlpPath,
        args,
        timeoutMs: env.YTDLP_DOWNLOAD_TIMEOUT_MS,
        stallTimeoutMs: 5 * 60 * 1000,
        signal: params.signal,
        onStdoutLine: (line) => {
          const sample = parseYtDlpProgressLine(line);
          if (sample) params.onProgress?.(sample);
        },
        onStderrLine: (line) => {
          const sample = parseYtDlpProgressLine(line);
          if (sample) params.onProgress?.(sample);
        },
      });
    } catch (err) {
      throw new AppError({
        code: ERROR_CODES.YTDLP_FAILED,
        status: 502,
        message: "Failed to execute yt-dlp for download.",
        cause: err,
      });
    }

    if (result.aborted) {
      throw new AppError({
        code: ERROR_CODES.JOB_CANCELLED,
        status: 499,
        message: "Download was cancelled.",
      });
    }

    if (result.timedOut) {
      throw new AppError({
        code: ERROR_CODES.TIMEOUT,
        status: 504,
        message: "Media download timed out.",
      });
    }

    if (result.code !== 0) {
      throw mapYtDlpStderrToError(result.stderr || result.stdout);
    }
  },

  async probeVersion(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const ytDlpPath = await ensureYtDlpBinary();
      const result = await runSpawnedCommand({
        command: ytDlpPath,
        args: ["--version"],
        timeoutMs: 5000,
      });
      if (result.code === 0) {
        return { ok: true, version: result.stdout.trim() };
      }
      return {
        ok: false,
        error: result.stderr.trim() || `Exited with code ${result.code}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "yt-dlp executable not found",
      };
    }
  },
};
