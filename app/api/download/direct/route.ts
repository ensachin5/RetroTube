import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { withApiHandler } from "@/lib/http";
import { downloadService } from "@/services/download.service";

export const maxDuration = 300;

const directDownloadSchema = z.object({
  v: z.string().trim().min(1, "Video ID or URL parameter 'v' is required."),
  format: z.string().trim().min(1).default("best"),
  title: z.string().trim().min(1).optional(),
  container: z.string().trim().min(1).default("mp4"),
});

export const GET = withApiHandler(
  { route: "/api/download/direct" },
  async (request, ctx) => {
    const url = new URL(request.url);
    const parsed = directDownloadSchema.safeParse({
      v: url.searchParams.get("v") ?? url.searchParams.get("url"),
      format: url.searchParams.get("format") ?? undefined,
      title: url.searchParams.get("title") ?? undefined,
      container: url.searchParams.get("container") ?? undefined,
    });

    if (!parsed.success) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        status: 400,
        message: parsed.error.issues[0]?.message ?? "Invalid direct stream parameters.",
      });
    }

    const { v, format, title, container } = parsed.data;
    const canonicalUrl = v.startsWith("http://") || v.startsWith("https://")
      ? v
      : `https://www.youtube.com/watch?v=${v}`;

    const safeTitle = (title ?? v).replace(/[/\\?%*:|"<>]/g, "_");
    const outputFilename = `${safeTitle}.${container}`;

    const prepared = await downloadService.streamDirect({
      canonicalUrl,
      formatSelector: format,
      outputFilename,
      targetContainer: container,
      signal: request.signal,
    });

    return new Response(prepared.body, {
      status: prepared.status,
      headers: {
        ...prepared.headers,
        "X-Request-Id": ctx.requestId,
      },
    });
  },
);
