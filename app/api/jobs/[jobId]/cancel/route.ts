import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { jsonOk, withApiHandler } from "@/lib/http";
import { jobService } from "@/services/job.service";

export const maxDuration = 60;

const jobIdParamSchema = z.string().uuid("Invalid jobId.");

export const POST = withApiHandler<{ jobId: string }>(
  { route: "/api/jobs/[jobId]/cancel" },
  async (_request, ctx, routeContext) => {
    const { jobId } = await routeContext.params;
    const parsed = jobIdParamSchema.safeParse(jobId);
    if (!parsed.success) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        status: 400,
        message: "Invalid jobId format.",
      });
    }

    const cancelled = await jobService.cancel(parsed.data);
    return jsonOk({ jobId: cancelled.id, status: cancelled.status }, ctx.requestId, 200);
  },
);
