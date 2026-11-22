"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ProgressBar } from "@/src/components/ui/ProgressBar";
import { TapeReelLoader } from "@/src/components/ui/TapeReelLoader";
import { formatBytes, getFriendlyErrorCopy } from "@/src/lib/format-grouping";
import type { JobProgressEvent } from "@/services/job.service";

export interface ActiveDownloadJob {
  jobId: string;
  outputFilename: string;
  eventsUrl: string;
  streamUrl: string;
  needsMerge: boolean;
}

export interface JobProgressPanelProps {
  job: ActiveDownloadJob;
  onDismiss: () => void;
  onSnapshotChange?: (snapshot: JobProgressEvent | null) => void;
}

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued on Deck",
  downloading: "Pulling Media Stream",
  downloading_video: "Pulling Video Track",
  downloading_audio: "Pulling Best Audio Track",
  merging: "Splicing Video + Audio (ffmpeg)",
  converting: "Encoding Audio Track (ffmpeg)",
  done: "Tape Ready",
  failed: "Tracking Error",
  cancelled: "Tape Ejected",
};

const MAX_RECONNECT_ATTEMPTS = 5;

export function JobProgressPanel({
  job,
  onDismiss,
  onSnapshotChange,
}: JobProgressPanelProps) {
  const [snapshot, setSnapshot] = useState<JobProgressEvent>({
    jobId: job.jobId,
    status: "queued",
    progressPct: 0,
    stage: "queued",
    outputFilename: job.outputFilename,
    streamUrl: job.streamUrl,
  });
  const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const triggeredDownloadForJobRef = useRef<string | null>(null);
  const downloadAnchorRef = useRef<HTMLAnchorElement | null>(null);
  const reconnectCountRef = useRef(0);
  const terminalReachedRef = useRef(false);

  useEffect(() => {
    terminalReachedRef.current = false;
    reconnectCountRef.current = 0;

    const es = new EventSource(job.eventsUrl);

    const handleFrame = (rawData: string) => {
      try {
        const parsed = JSON.parse(rawData) as JobProgressEvent;
        reconnectCountRef.current = 0;
        setConnectionWarning(null);
        setSnapshot(parsed);
        onSnapshotChange?.(parsed);

        if (
          parsed.status === "done" ||
          parsed.status === "failed" ||
          parsed.status === "cancelled"
        ) {
          terminalReachedRef.current = true;
          es.close();

          if (
            parsed.status === "done" &&
            triggeredDownloadForJobRef.current !== job.jobId
          ) {
            triggeredDownloadForJobRef.current = job.jobId;
            // Trigger browser download via stream endpoint
            setTimeout(() => {
              downloadAnchorRef.current?.click();
            }, 40);
          }
        }
      } catch {
        // Ignore malformed SSE frame
      }
    };

    const onEvent = (event: MessageEvent<string>) => {
      handleFrame(event.data);
    };

    es.addEventListener("progress", onEvent as EventListener);
    es.addEventListener("done", onEvent as EventListener);
    es.addEventListener("failed", onEvent as EventListener);
    es.addEventListener("cancelled", onEvent as EventListener);
    es.onmessage = onEvent;

    es.onerror = () => {
      if (terminalReachedRef.current) {
        es.close();
        return;
      }

      reconnectCountRef.current += 1;
      if (
        es.readyState === EventSource.CLOSED ||
        reconnectCountRef.current > MAX_RECONNECT_ATTEMPTS
      ) {
        es.close();
        setConnectionWarning(
          "Live tracking connection interrupted. You can reconnect or cancel.",
        );
      } else {
        setConnectionWarning(
          `Signal flicker — reconnecting (${reconnectCountRef.current}/${MAX_RECONNECT_ATTEMPTS})...`,
        );
      }
    };

    return () => {
      es.close();
    };
  }, [job.eventsUrl, job.jobId, onSnapshotChange, reconnectNonce]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await fetch(`/api/jobs/${job.jobId}/cancel`, { method: "POST" });
    } catch {
      setConnectionWarning("Could not send cancel signal. Try again.");
    } finally {
      setCancelling(false);
    }
  };

  const isTerminal =
    snapshot.status === "done" ||
    snapshot.status === "failed" ||
    snapshot.status === "cancelled";

  const errorCopy =
    snapshot.status === "failed"
      ? getFriendlyErrorCopy(snapshot.errorCode, snapshot.errorMessage)
      : null;

  const cardTone =
    snapshot.status === "failed"
      ? "error"
      : snapshot.status === "done"
        ? "success"
        : "default";

  return (
    <Card tone={cardTone} className="p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                snapshot.status === "done"
                  ? "teal"
                  : snapshot.status === "failed"
                    ? "tomato"
                    : "mustard"
              }
            >
              {snapshot.status}
            </Badge>
          </div>
          <p className="truncate font-display text-sm sm:text-base font-bold text-[var(--text-ink)]">
            {job.outputFilename}
          </p>
        </div>

        {!isTerminal ? (
          <TapeReelLoader label="Recording" />
        ) : (
          <Button variant="surface" size="sm" onClick={onDismiss}>
            Close
          </Button>
        )}
      </div>

      <div aria-live="polite" className="space-y-3">
        <ProgressBar
          value={snapshot.progressPct}
          label="Download progress"
          stageLabel={STAGE_LABELS[snapshot.stage] ?? snapshot.stage}
          speed={snapshot.speed}
          etaSec={snapshot.etaSec}
        />

        {connectionWarning && !isTerminal ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-ink)] bg-[var(--bg-surface-alt)] px-3 py-2 text-xs sm:text-sm"
          >
            <span>{connectionWarning}</span>
            <Button
              size="sm"
              variant="surface"
              onClick={() => {
                setConnectionWarning(null);
                setReconnectNonce((n) => n + 1);
              }}
            >
              Reconnect
            </Button>
          </div>
        ) : null}

        {snapshot.status === "done" ? (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[var(--text-ink)]">
                Ready to save ({formatBytes(snapshot.bytesTotal)}). Download should start
                automatically.
              </p>
              <a
                ref={downloadAnchorRef}
                href={snapshot.streamUrl ?? job.streamUrl}
                download={job.outputFilename}
                className="retro-btn min-h-11 inline-flex items-center justify-center rounded-md bg-[var(--accent-teal)] px-4 py-2 font-display text-sm font-bold uppercase tracking-wider text-[var(--on-teal)] no-underline w-full sm:w-auto"
              >
                Save File
              </a>
            </div>
            <div className="text-xs font-mono text-[var(--text-muted)] flex items-center gap-1.5">
              <span>⏱️ Temporary file kept on server for 120 min before cleanup.</span>
            </div>
          </div>
        ) : null}

        {snapshot.status === "failed" && errorCopy ? (
          <div role="alert" aria-live="assertive" className="space-y-1">
            <p className="font-display text-sm font-bold text-[var(--text-ink)]">
              {errorCopy.title}
              {snapshot.errorCode ? (
                <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                  [{snapshot.errorCode}]
                </span>
              ) : null}
            </p>
            <p className="text-sm text-[var(--text-ink)]">{errorCopy.message}</p>
          </div>
        ) : null}

        {snapshot.status === "cancelled" ? (
          <p className="text-sm font-medium text-[var(--text-muted)]">
            Download was cancelled and temporary files were cleared.
          </p>
        ) : null}
      </div>

      {!isTerminal ? (
        <div className="flex justify-end">
          <Button
            variant="surface"
            size="sm"
            onClick={() => void handleCancel()}
            disabled={cancelling}
          >
            {cancelling ? "Ejecting..." : "Cancel"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
