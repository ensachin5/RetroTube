import fs from "node:fs";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { buildContentDisposition, sanitizeFilenameSegment } from "@/lib/filename";
import { getOrCreateRequestId } from "@/lib/http";
import { batchesRepo } from "@/repositories/batches.repo";
import { jobsRepo } from "@/repositories/jobs.repo";
import { type ZipItemDescriptor, zipService } from "@/services/zip.service";

export const maxDuration = 60;

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getOrCreateRequestId(request);

  const { id } = await routeContext.params;
  const data = batchesRepo.findWithItemsById(id);

  if (!data) {
    throw new AppError({
      code: ERROR_CODES.JOB_NOT_FOUND,
      status: 404,
      message: "Batch was not found.",
    });
  }

  const { batch, items } = data;
  const completedItems = items.filter((i) => i.status === "done" && i.jobId);

  const zipItems: ZipItemDescriptor[] = [];
  for (const item of completedItems) {
    if (!item.jobId) continue;
    const job = jobsRepo.findById(item.jobId);
    if (job?.tempFilepath && fs.existsSync(job.tempFilepath)) {
      zipItems.push({
        position: item.position,
        title: item.title,
        extension: job.targetContainer,
        tempFilepath: job.tempFilepath,
      });
    }
  }

  if (zipItems.length === 0) {
    throw new AppError({
      code: ERROR_CODES.INVALID_JOB_STATE,
      status: 409,
      message: "No completed media files are available for download in this batch.",
    });
  }

  const zipStream = zipService.createStreamingZip(zipItems, requestId);
  const zipFilename = `${sanitizeFilenameSegment(batch.title)}.zip`;
  const contentDisposition = buildContentDisposition(zipFilename);

  return new Response(zipStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition,
      "Cache-Control": "no-cache",
      "X-Request-Id": requestId,
    },
  });
}
