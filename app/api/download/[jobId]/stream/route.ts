import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { withApiHandler } from "@/lib/http";
import { downloadService } from "@/services/download.service";

export const maxDuration = 60;

const jobIdParamSchema = z.string().uuid("Invalid jobId.");

export const GET = withApiHandler<{ jobId: string }>(
  { route: "/api/download/[jobId]/stream" },
  async (request, ctx, routeContext) => {
    const { jobId } = await routeContext.params;
    const parsed = jobIdParamSchema.safeParse(jobId);
    if (!parsed.success) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        status: 400,
        message: "Invalid jobId format.",
      });
    }

    const rangeHeader = request.headers.get("range");
    const prepared = downloadService.prepareStream(parsed.data, rangeHeader);

    return new Response(prepared.body, {
      status: prepared.status,
      headers: {
        ...prepared.headers,
        "X-Request-Id": ctx.requestId,
      },
    });
  },
);
