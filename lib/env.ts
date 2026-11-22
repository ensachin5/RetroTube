import { z } from "zod";

const envSchema = z.object({
  YTDLP_PATH: z.string().trim().min(1).default("yt-dlp"),
  FFMPEG_PATH: z.string().trim().min(1).default("ffmpeg"),
  TEMP_DIR: z.string().trim().min(1).default("./tmp/retrotube"),
  DB_PATH: z.string().trim().min(1).default("./data/retrotube.db"),
  MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(16).default(2),
  MAX_VIDEO_MINUTES: z.coerce.number().int().min(1).max(1440).default(180),
  APP_PASSWORD: z.string().default(""),
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
  YTDLP_CONCURRENT_FRAGMENTS: z.coerce.number().int().min(1).max(16).default(4),
  YTDLP_HTTP_CHUNK_SIZE: z.string().trim().min(1).default("10M"),
  YTDLP_BUFFER_SIZE: z.string().trim().min(1).default("16K"),
  YTDLP_PROXY: z.string().trim().default(""),
  YTDLP_COOKIES_FILE: z.string().trim().default(""),
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
    APP_PASSWORD: process.env.APP_PASSWORD ?? "",
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
    YTDLP_USE_ARIA2: emptyToUndefined(process.env.YTDLP_USE_ARIA2),
  });
}
