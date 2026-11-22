import { NextResponse } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { withApiHandler } from "@/lib/http";
import { batchesRepo } from "@/repositories/batches.repo";
import { jobsRepo } from "@/repositories/jobs.repo";

export const maxDuration = 60;

export const GET = withApiHandler<{ id: string }>(
  { route: "/api/batch/[id]" },
  async (_request, _ctx, { params }) => {
    const { id } = await params;
    const data = batchesRepo.findWithItemsById(id);

    if (!data) {
      throw new AppError({
        code: ERROR_CODES.JOB_NOT_FOUND,
        status: 404,
        message: "Batch was not found.",
      });
    }

    const { batch, items } = data;
    const completedItems = items.filter((i) => i.status === "done").length;
    const failedItems = items.filter((i) => i.status === "failed").length;

    const enrichedItems = items.map((item) => {
      let downloadUrl: string | undefined;
      let outputFilename: string | undefined;
      let bytesTotal: number | null | undefined;

      if (item.jobId) {
        const job = jobsRepo.findById(item.jobId);
        if (job && job.status === "done") {
          downloadUrl = `/api/download/${job.id}/stream`;
          outputFilename = job.outputFilename;
          bytesTotal = job.bytesTotal;
        }
      }

      return {
        id: item.id,
        position: item.position,
        youtubeId: item.youtubeId,
        title: item.title,
        durationSec: item.durationSec,
        status: item.status,
        jobId: item.jobId,
        errorCode: item.errorCode,
        retryCount: item.retryCount,
        downloadUrl,
        outputFilename,
        bytesTotal,
      };
    });

    return NextResponse.json({
      batch: {
        id: batch.id,
        sourceUrl: batch.sourceUrl,
        playlistId: batch.youtubePlaylistId,
        title: batch.title,
        channel: batch.channel,
        itemCount: batch.itemCount,
        selectedCount: batch.selectedCount,
        completedCount: completedItems,
        failedCount: failedItems,
        qualityPreset: batch.qualityPreset,
        kind: batch.kind,
        targetContainer: batch.targetContainer,
        status: batch.status,
        createdAt: batch.createdAt,
        finishedAt: batch.finishedAt,
        zipUrl: `/api/batch/${batch.id}/zip`,
        eventsUrl: `/api/batch/${batch.id}/events`,
        items: enrichedItems,
      },
    });
  },
);

export const DELETE = withApiHandler<{ id: string }>(
  { route: "/api/batch/[id]" },
  async (_request, _ctx, { params }) => {
    const { id } = await params;
    const deleted = batchesRepo.delete(id);

    if (!deleted) {
      throw new AppError({
        code: ERROR_CODES.JOB_NOT_FOUND,
        status: 404,
        message: "Batch not found or already deleted.",
      });
    }

    return NextResponse.json({ deleted: true, id });
  },
);
