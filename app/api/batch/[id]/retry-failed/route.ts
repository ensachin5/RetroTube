import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/http";
import { batchService } from "@/services/batch.service";

export const POST = withApiHandler<{ id: string }>(
  { route: "/api/batch/[id]/retry-failed" },
  async (_request, _ctx, { params }) => {
    const { id } = await params;
    const result = batchService.retryFailedItems(id);

    return NextResponse.json({
      batchId: id,
      retryingItemCount: result.retryingCount,
      status: "running",
    });
  },
);
