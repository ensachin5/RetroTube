import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { getOrCreateRequestId, requireApiAuth } from "@/lib/http";
import { batchesRepo } from "@/repositories/batches.repo";
import { type BatchEvent, batchService } from "@/services/batch.service";



export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getOrCreateRequestId(request);
  await requireApiAuth(request);

  const { id } = await routeContext.params;
  const data = batchesRepo.findWithItemsById(id);

  if (!data) {
    throw new AppError({
      code: ERROR_CODES.JOB_NOT_FOUND,
      status: 404,
      message: "Batch was not found.",
    });
  }

  let cleanup: (() => void) | null = null;
  let keepaliveTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const sendFrame = (event: string, payload: unknown) => {
        try {
          const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(body));
        } catch {
          // Stream might be closed
        }
      };

      const sendComment = (comment: string) => {
        try {
          controller.enqueue(encoder.encode(`: ${comment}\n\n`));
        } catch {
          // Stream might be closed
        }
      };

      // Send initial batch state
      sendFrame("batch_progress", {
        batchId: data.batch.id,
        status: data.batch.status,
        itemCount: data.batch.itemCount,
        selectedCount: data.batch.selectedCount,
        completedCount: data.items.filter((i) => i.status === "done").length,
        failedCount: data.items.filter((i) => i.status === "failed").length,
      });

      // Periodic keepalive comment every 15s
      keepaliveTimer = setInterval(() => {
        sendComment("keepalive");
      }, 15000);

      const unsubscribe = batchService.subscribeBatch(id, (event: BatchEvent) => {
        sendFrame(event.type, event.data);

        if (event.type === "batch_done" || event.type === "batch_cancelled") {
          if (keepaliveTimer) clearInterval(keepaliveTimer);
          try {
            controller.close();
          } catch {
            // Ignore
          }
        }
      });

      cleanup = () => {
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        unsubscribe();
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  request.signal.addEventListener("abort", () => {
    cleanup?.();
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Request-Id": requestId,
    },
  });
}
