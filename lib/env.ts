import { z } from "zod";
import { resolveBinaryPath } from "./binaries";

const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
const defaultDbPath = isVercel ? "/tmp/retrotube.db" : "./data/retrotube.db";
const defaultTempDir = isVercel ? "/tmp/retrotube" : "./tmp/retrotube";

const envSchema = z.object({
  YTDLP_PATH: z.string().trim().min(1).default(() => resolveBinaryPath("yt-dlp")),
  FFMPEG_PATH: z.string().trim().min(1).default(() => resolveBinaryPath("ffmpeg")),
  TEMP_DIR: z.string().trim().min(1).default(defaultTempDir),
  DB_PATH: z.string().trim().min(1).default(defaultDbPath),
  MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(16).default(2),
  MAX_VIDEO_MINUTES: z.coerce.number().int().min(0).max(10080).default(0),
  MAX_FILE_SIZE_GB: z.coerce.number().min(0).default(0),
  MAX_PLAYLIST_ITEMS: z.coerce.number().int().min(1).max(2000).default(200),
  BATCH_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(1),
  BATCH_ITEM_DELAY_MS: z.coerce.number().int().min(0).max(60000).default(1500),
  SERVER_SAVE_DIR: z.string().trim().default(""),
  FILE_TTL_MINUTES: z.coerce.number().int().min(5).max(10080).default(120),
  MIN_FREE_DISK_GB: z.coerce.number().min(0).default(5),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86400).default(3600),
  RATE_LIMIT_FETCH_PER_MIN: z.coerce.number().int().min(1).max(1000).default(20),
  RATE_LIMIT_DOWNLOAD_PER_MIN: z.coerce.number().int().min(1).max(1000).default(10),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  YTDLP_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  YTDLP_DOWNLOAD_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(7200000)
    .default(1800000),
  YTDLP_CONCURRENT_FRAGMENTS: z.coerce.number().int().min(1).max(32).default(16),
  YTDLP_HTTP_CHUNK_SIZE: z.string().trim().default("none"),
  YTDLP_BUFFER_SIZE: z.string().trim().min(1).default("1024K"),
  YTDLP_PROXY: z.string().trim().default(""),
  YTDLP_COOKIES_FILE: z.string().trim().default(""),
  YTDLP_COOKIES_FROM_BROWSER: z.string().trim().default(""),
  YTDLP_USE_ARIA2: z
    .preprocess((val) => val === "true" || val === "1" || val === true, z.boolean())
    .default(false),
});

export type AppEnv = z.infer<typeof envSchema>;

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function getEnv(): AppEnv {
  return envSchema.parse({
    YTDLP_PATH: emptyToUndefined(process.env.YTDLP_PATH),
    FFMPEG_PATH: emptyToUndefined(process.env.FFMPEG_PATH),
    TEMP_DIR: emptyToUndefined(process.env.TEMP_DIR),
    DB_PATH: emptyToUndefined(process.env.DB_PATH),
    MAX_CONCURRENT_JOBS: emptyToUndefined(process.env.MAX_CONCURRENT_JOBS),
    MAX_VIDEO_MINUTES: emptyToUndefined(process.env.MAX_VIDEO_MINUTES),
    MAX_FILE_SIZE_GB: emptyToUndefined(process.env.MAX_FILE_SIZE_GB),
    MAX_PLAYLIST_ITEMS: emptyToUndefined(process.env.MAX_PLAYLIST_ITEMS),
    BATCH_CONCURRENCY: emptyToUndefined(process.env.BATCH_CONCURRENCY),
    BATCH_ITEM_DELAY_MS: emptyToUndefined(process.env.BATCH_ITEM_DELAY_MS),
    SERVER_SAVE_DIR: emptyToUndefined(process.env.SERVER_SAVE_DIR) ?? "",
    FILE_TTL_MINUTES: emptyToUndefined(process.env.FILE_TTL_MINUTES),
    MIN_FREE_DISK_GB: emptyToUndefined(process.env.MIN_FREE_DISK_GB),
    CACHE_TTL_SECONDS: emptyToUndefined(process.env.CACHE_TTL_SECONDS),
    RATE_LIMIT_FETCH_PER_MIN: emptyToUndefined(process.env.RATE_LIMIT_FETCH_PER_MIN),
    RATE_LIMIT_DOWNLOAD_PER_MIN: emptyToUndefined(
      process.env.RATE_LIMIT_DOWNLOAD_PER_MIN,
    ),
    LOG_LEVEL: emptyToUndefined(process.env.LOG_LEVEL),
    YTDLP_FETCH_TIMEOUT_MS: emptyToUndefined(process.env.YTDLP_FETCH_TIMEOUT_MS),
    YTDLP_DOWNLOAD_TIMEOUT_MS: emptyToUndefined(process.env.YTDLP_DOWNLOAD_TIMEOUT_MS),
    YTDLP_CONCURRENT_FRAGMENTS: emptyToUndefined(process.env.YTDLP_CONCURRENT_FRAGMENTS),
    YTDLP_HTTP_CHUNK_SIZE: emptyToUndefined(process.env.YTDLP_HTTP_CHUNK_SIZE),
    YTDLP_BUFFER_SIZE: emptyToUndefined(process.env.YTDLP_BUFFER_SIZE),
    YTDLP_PROXY: emptyToUndefined(process.env.YTDLP_PROXY) ?? "",
    YTDLP_COOKIES_FILE: emptyToUndefined(process.env.YTDLP_COOKIES_FILE) ?? "",
    YTDLP_COOKIES_FROM_BROWSER:
      emptyToUndefined(process.env.YTDLP_COOKIES_FROM_BROWSER) ?? "",
    YTDLP_USE_ARIA2: emptyToUndefined(process.env.YTDLP_USE_ARIA2),
  });
}
