import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "./logger";

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_URL: "INVALID_URL",
  PLAYLIST_NOT_SUPPORTED: "PLAYLIST_NOT_SUPPORTED",
  UNAUTHORIZED: "UNAUTHORIZED",
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  INVALID_JOB_STATE: "INVALID_JOB_STATE",
  FILE_EXPIRED: "FILE_EXPIRED",
  VIDEO_TOO_LONG: "VIDEO_TOO_LONG",
  LIVE_STREAM: "LIVE_STREAM",
  PRIVATE_VIDEO: "PRIVATE_VIDEO",
  AGE_RESTRICTED: "AGE_RESTRICTED",
  GEO_BLOCKED: "GEO_BLOCKED",
  VIDEO_UNAVAILABLE: "VIDEO_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  QUEUE_FULL: "QUEUE_FULL",
  TIMEOUT: "TIMEOUT",
  YTDLP_FAILED: "YTDLP_FAILED",
  FFMPEG_FAILED: "FFMPEG_FAILED",
  SERVER_RESTART: "SERVER_RESTART",
  JOB_CANCELLED: "JOB_CANCELLED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface AppErrorOptions {
  code: ErrorCode;
  status: number;
  message: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }

  if (err instanceof z.ZodError) {
    return new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      status: 400,
      message: err.issues[0]?.message ?? "Request validation failed.",
      details: {
        issues: err.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      cause: err,
    });
  }

  return new AppError({
    code: ERROR_CODES.INTERNAL_ERROR,
    status: 500,
    message: "An unexpected internal error occurred.",
    cause: err,
  });
}

export function toErrorResponse(
  err: unknown,
  requestId: string,
  route?: string,
): NextResponse<ErrorEnvelope> {
  const appError = normalizeError(err);

  if (appError.status >= 500) {
    logger.error(appError.message, {
      requestId,
      route,
      status: appError.status,
      errorCode: appError.code,
      cause:
        appError.cause instanceof Error
          ? appError.cause.message
          : String(appError.cause ?? ""),
    });
  } else {
    logger.warn(appError.message, {
      requestId,
      route,
      status: appError.status,
      errorCode: appError.code,
    });
  }

  const body: ErrorEnvelope = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
      ...(appError.details ? { details: appError.details } : {}),
    },
  };

  return NextResponse.json(body, {
    status: appError.status,
    headers: {
      "X-Request-Id": requestId,
    },
  });
}
