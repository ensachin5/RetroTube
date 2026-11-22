import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { AppError, ERROR_CODES, toErrorResponse } from "./errors";
import { logger } from "./logger";

export interface ApiContext {
  requestId: string;
  clientIp: string;
  route: string;
}

export function getOrCreateRequestId(request: Request): string {
  const existing = request.headers.get("x-request-id")?.trim();
  if (existing && existing.length <= 128) {
    return existing;
  }
  return globalThis.crypto.randomUUID();
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "127.0.0.1";
}

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      status: 400,
      message: "Request body must be valid JSON.",
    });
  }
  return schema.parse(raw);
}

export interface ApiHandlerOptions {
  route: string;
}

export function withApiHandler<TParams = Record<string, string>>(
  options: ApiHandlerOptions,
  handler: (
    request: NextRequest,
    ctx: ApiContext,
    routeContext: { params: Promise<TParams> },
  ) => Promise<Response>,
) {
  return async function routeHandler(
    request: NextRequest,
    routeContext?: { params: Promise<TParams> },
  ): Promise<Response> {
    const requestId = getOrCreateRequestId(request);
    const clientIp = getClientIp(request);
    const startedAt = Date.now();
    const ctx: ApiContext = {
      requestId,
      clientIp,
      route: options.route,
    };

    try {
      const resolvedContext = routeContext ?? {
        params: Promise.resolve({} as TParams),
      };
      const response = await handler(request, ctx, resolvedContext);
      if (!response.headers.has("X-Request-Id")) {
        response.headers.set("X-Request-Id", requestId);
      }

      logger.info("HTTP request completed", {
        requestId,
        route: options.route,
        method: request.method,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });

      return response;
    } catch (err) {
      return toErrorResponse(err, requestId, options.route);
    }
  };
}

export function jsonOk<T>(data: T, requestId: string, status = 200): NextResponse<T> {
  return NextResponse.json(data, {
    status,
    headers: {
      "X-Request-Id": requestId,
    },
  });
}

export const MIME_TYPE_BY_CONTAINER: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  opus: "audio/opus",
  ogg: "audio/ogg",
  flac: "audio/flac",
  wav: "audio/wav",
};

export function getMimeTypeForContainer(container: string): string {
  return MIME_TYPE_BY_CONTAINER[container.toLowerCase()] ?? "application/octet-stream";
}

export interface ParsedByteRange {
  start: number;
  end: number;
}

export function parseRangeHeader(
  rangeHeader: string,
  fileSize: number,
): ParsedByteRange | null {
  if (fileSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;

  if (!startRaw && endRaw) {
    // Suffix byte-range: bytes=-500
    const suffixLength = Number(endRaw);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, fileSize - suffixLength);
    return { start, end: fileSize - 1 };
  }

  const start = Number(startRaw);
  const end = endRaw ? Math.min(Number(endRaw), fileSize - 1) : fileSize - 1;

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= fileSize ||
    end < start
  ) {
    return null;
  }

  return { start, end };
}
