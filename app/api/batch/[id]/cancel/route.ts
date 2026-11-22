import { NextResponse } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { withApiHandler } from "@/lib/http";
import { batchService } from "@/services/batch.service";

export const maxDuration = 60;

export const POST = withApiHandler<{ id: string }>(
  { route: "/api/batch/[id]/cancel" },
  async (_request, _ctx, { params }) => {
    const { id } = await params;
    const cancelled = await batchService.cancelBatch(id);

    if (!cancelled) {
      throw new AppError({
        code: ERROR_CODES.JOB_NOT_FOUND,
        status: 404,
        message: "Batch was not found.",
      });
    }

    return NextResponse.json({
      batchId: id,
      status: "cancelled",
    });
  },
);
