import { z } from "zod";
import { getEnv } from "@/lib/env";
import { jsonOk, parseJsonBody, withApiHandler } from "@/lib/http";
import { getRateLimiter } from "@/lib/rate-limiter";
import { fetchService } from "@/services/fetch.service";

export const maxDuration = 60;

const fetchRequestSchema = z.object({
  url: z.string().trim().min(1, "Please enter a YouTube URL."),
});

export const POST = withApiHandler({ route: "/api/fetch" }, async (request, ctx) => {
  const body = await parseJsonBody(request, fetchRequestSchema);

  const env = getEnv();
  getRateLimiter().enforce("fetch", ctx.clientIp, env.RATE_LIMIT_FETCH_PER_MIN);

  const result = await fetchService.fetchMetadata(body.url, ctx.requestId);
  return jsonOk(result, ctx.requestId, 200);
});
