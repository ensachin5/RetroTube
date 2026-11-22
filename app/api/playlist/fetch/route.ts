import { z } from "zod";
import { getEnv } from "@/lib/env";
import { jsonOk, parseJsonBody, withApiHandler } from "@/lib/http";
import { getRateLimiter } from "@/lib/rate-limiter";
import { playlistService } from "@/services/playlist.service";

const fetchPlaylistSchema = z.object({
  url: z.string().trim().min(1, "Please provide a YouTube URL."),
  forcePlaylist: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

export const POST = withApiHandler(
  { route: "/api/playlist/fetch" },
  async (request, ctx) => {
    try {
      const body = await parseJsonBody(request, fetchPlaylistSchema);
      const env = getEnv();
      getRateLimiter().enforce("fetch", ctx.clientIp, env.RATE_LIMIT_FETCH_PER_MIN);

      const result = await playlistService.fetchPlaylistMetadata(
        body.url,
        {
          forcePlaylist: body.forcePlaylist,
          limit: body.limit,
        },
      );

      return jsonOk(result, ctx.requestId, 200);
    } catch (err) {
      console.error("[CRITICAL PLAYLIST FETCH ERROR]", err);
      throw err;
    }
  },
);
