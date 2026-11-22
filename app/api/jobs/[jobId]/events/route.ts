import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { withApiHandler } from "@/lib/http";
import { jobService, type JobProgressEvent } from "@/services/job.service";

const jobIdParamSchema = z.string().uuid("Invalid jobId.");
const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);
const encoder = new TextEncoder();

function formatSseFrame(eventName: string, data: JobProgressEvent): Uint8Array {
  return encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

function eventNameForSnapshot(snapshot: JobProgressEvent): string {
  if (snapshot.status === "done") return "done";
  if (snapshot.status === "failed") return "failed";
  if (snapshot.status === "cancelled") return "cancelled";
  return "progress";
}

export const GET = withApiHandler<{ jobId: string }>(
  { route: "/api/jobs/[jobId]/events" },
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

    const snapshot = jobService.getSnapshot(parsed.data);
    if (!snapshot) {
      throw new AppError({
        code: ERROR_CODES.JOB_NOT_FOUND,
        status: 404,
        message: "Download job was not found.",
      });
    }

    let unsubscribe: (() => void) | null = null;
    let keepaliveTimer: NodeJS.Timeout | null = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const sendEvent = (event: JobProgressEvent) => {
          if (closed) return;
          try {
            controller.enqueue(formatSseFrame(eventNameForSnapshot(event), event));
            if (TERMINAL_STATUSES.has(event.status)) {
              cleanup();
              controller.close();
            }
          } catch {
            cleanup();
          }
        };

        sendEvent(snapshot);
        if (closed) return;

        unsubscribe = jobService.subscribe(parsed.data, sendEvent);

        keepaliveTimer = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            cleanup();
          }
        }, 15_000);
        keepaliveTimer.unref();

        request.signal.addEventListener(
          "abort",
          () => {
            cleanup();
            try {
              controller.close();
            } catch {
              // Already closed
            }
          },
          { once: true },
        );
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Request-Id": ctx.requestId,
      },
    });
  },
);
