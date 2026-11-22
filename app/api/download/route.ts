import { z } from "zod";
import { getEnv } from "@/lib/env";
import { jsonOk, parseJsonBody, withApiHandler } from "@/lib/http";
import { getRateLimiter } from "@/lib/rate-limiter";
import { ALLOWED_TARGET_CONTAINERS, downloadService } from "@/services/download.service";

const downloadRequestSchema = z
  .object({
    videoId: z.coerce.number().int().positive("videoId must be a positive integer."),
    formatId: z.coerce.number().int().positive().nullable().optional(),
    sourceFormatId: z.string().trim().min(1).max(64).nullable().optional(),
    targetContainer: z.enum(ALLOWED_TARGET_CONTAINERS).nullable().optional(),
    audioBitrateKbps: z
      .union([z.literal(128), z.literal(192), z.literal(320)])
      .nullable()
      .optional(),
  })
  .refine(
    (val) =>
      val.formatId != null ||
      val.sourceFormatId != null ||
      (val.targetContainer != null &&
        ["mp3", "m4a", "opus", "flac", "wav"].includes(val.targetContainer)),
    {
      message:
        "Either formatId, sourceFormatId, or an audio targetContainer is required.",
    },
  );

export const POST = withApiHandler({ route: "/api/download" }, async (request, ctx) => {
  const body = await parseJsonBody(request, downloadRequestSchema);

  const env = getEnv();
  getRateLimiter().enforce("download", ctx.clientIp, env.RATE_LIMIT_DOWNLOAD_PER_MIN);

  const result = downloadService.enqueue(body);
  return jsonOk(result, ctx.requestId, 202);
});
