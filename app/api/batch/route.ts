import { z } from "zod";
import { getEnv } from "@/lib/env";
import { jsonOk, parseJsonBody, withApiHandler } from "@/lib/http";
import { getRateLimiter } from "@/lib/rate-limiter";
import { batchService } from "@/services/batch.service";

const playlistItemSchema = z.object({
  position: z.number().int().min(1),
  youtubeId: z.string().min(1),
  title: z.string(),
  durationSec: z.number().default(0),
  thumbnailUrl: z.string().default(""),
  isAvailable: z.boolean().default(true),
  unavailableReason: z.string().optional(),
});

const createBatchSchema = z.object({
  playlistId: z.string().min(1),
  sourceUrl: z.string().url(),
  title: z.string().default("Untitled Playlist"),
  channel: z.string().default("Unknown Curator"),
  selectedItemIds: z.array(z.string()).min(1),
  items: z.array(playlistItemSchema).min(1),
  qualityPreset: z.string().min(1),
  kind: z.enum(["video", "audio"]),
  targetContainer: z.string().min(1),
});

export const POST = withApiHandler(
  { route: "/api/batch" },
  async (request, ctx) => {
    const body = await parseJsonBody(request, createBatchSchema);
    const env = getEnv();
    getRateLimiter().enforce("download", ctx.clientIp, env.RATE_LIMIT_DOWNLOAD_PER_MIN);

    const result = await batchService.createBatch({
      ...body,
      requestId: ctx.requestId,
    });

    return jsonOk(result, ctx.requestId, 202);
  },
);
