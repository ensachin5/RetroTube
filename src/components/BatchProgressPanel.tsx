"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ProgressBar } from "@/src/components/ui/ProgressBar";
import { TapeReelLoader } from "@/src/components/ui/TapeReelLoader";

export interface BatchItemState {
  id: number;
  position: number;
  youtubeId: string;
  title: string;
  durationSec: number;
  status: "queued" | "running" | "done" | "failed" | "skipped" | "cancelled";
  downloadUrl?: string;
  outputFilename?: string;
  actualFormat?: string;
  bytesTotal?: number | null;
  errorCode?: string | null;
  retryCount: number;
}

export interface BatchDataState {
  id: string;
  title: string;
  channel: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled" | "paused";
  qualityPreset: string;
  itemCount: number;
  selectedCount: number;
  completedCount: number;
  failedCount: number;
  zipUrl: string;
  items: BatchItemState[];
}

export interface BatchProgressPanelProps {
  batchId: string;
  onDismiss: () => void;
}

export function BatchProgressPanel({ batchId, onDismiss }: BatchProgressPanelProps) {
  const [batch, setBatch] = useState<BatchDataState | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [activeItemProgress, setActiveItemProgress] = useState<{
    itemId: number;
    progressPct: number;
    stage: string;
    speed?: string | null;
    etaSec?: number | null;
  } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    fetch(`/api/batch/${batchId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && data?.batch) {
          setBatch(data.batch);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) {
          setLoadingInitial(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [batchId]);

  // Connect SSE events
  useEffect(() => {
    const eventSource = new EventSource(`/api/batch/${batchId}/events`);

    eventSource.addEventListener("batch_progress", (e) => {
      try {
        const data = JSON.parse(e.data);
        setBatch((prev) => (prev ? { ...prev, ...data } : prev));
      } catch {
        // Ignore
      }
    });

    eventSource.addEventListener("item_progress", (e) => {
      try {
        const data = JSON.parse(e.data);
        setActiveItemProgress({
          itemId: data.itemId,
          progressPct: data.progressPct ?? 0,
          stage: data.stage ?? "downloading",
          speed: data.speed,
          etaSec: data.etaSec,
        });

        setBatch((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((i) =>
              i.id === data.itemId ? { ...i, status: "running" } : i,
            ),
          };
        });
      } catch {
        // Ignore
      }
    });

    eventSource.addEventListener("item_done", (e) => {
      try {
        const data = JSON.parse(e.data);
        setActiveItemProgress(null);
        setBatch((prev) => {
          if (!prev) return prev;
          const updatedItems = prev.items.map((i) =>
            i.id === data.itemId
              ? {
                  ...i,
                  status: "done" as const,
                  downloadUrl: data.streamUrl,
                  outputFilename: data.outputFilename,
                  actualFormat: data.actualFormat,
                  bytesTotal: data.bytesTotal,
                }
              : i,
          );
          const completedCount = updatedItems.filter((i) => i.status === "done").length;
          return {
            ...prev,
            completedCount,
            items: updatedItems,
          };
        });
      } catch {
        // Ignore
      }
    });

    eventSource.addEventListener("item_failed", (e) => {
      try {
        const data = JSON.parse(e.data);
        setActiveItemProgress(null);
        setBatch((prev) => {
          if (!prev) return prev;
          const updatedItems = prev.items.map((i) =>
            i.id === data.itemId
              ? {
                  ...i,
                  status: "failed" as const,
                  errorCode: data.errorCode,
                }
              : i,
          );
          const failedCount = updatedItems.filter((i) => i.status === "failed").length;
          return {
            ...prev,
            failedCount,
            items: updatedItems,
          };
        });
      } catch {
        // Ignore
      }
    });

    eventSource.addEventListener("batch_done", () => {
      setActiveItemProgress(null);
      setBatch((prev) => (prev ? { ...prev, status: "done" } : prev));
      eventSource.close();
    });

    eventSource.addEventListener("batch_cancelled", () => {
      setActiveItemProgress(null);
      setBatch((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [batchId]);

  const handleCancelAll = async () => {
    setIsCancelling(true);
    try {
      await fetch(`/api/batch/${batchId}/cancel`, { method: "POST" });
      setBatch((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
    } catch {
      // Ignore
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRetryFailed = async () => {
    setIsRetrying(true);
    try {
      await fetch(`/api/batch/${batchId}/retry-failed`, { method: "POST" });
      setBatch((prev) => (prev ? { ...prev, status: "running" } : prev));
      const res = await fetch(`/api/batch/${batchId}`);
      if (res.ok) {
        const data = await res.json();
        setBatch(data.batch);
      }
    } catch {
      // Ignore
    } finally {
      setIsRetrying(false);
    }
  };

  const handleDownloadZip = () => {
    const link = document.createElement("a");
    link.href = `/api/batch/${batchId}/zip`;
    link.download = batch?.title ? `${batch.title}.zip` : "batch.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const overallProgressPct = useMemo(() => {
    if (!batch || batch.selectedCount === 0) return 0;
    const completed = batch.completedCount ?? 0;
    return Math.min(100, Math.round((completed / batch.selectedCount) * 100));
  }, [batch]);

  if (loadingInitial && !batch) {
    return (
      <Card className="p-8 flex flex-col items-center justify-center space-y-4">
        <TapeReelLoader spinning label="Connecting to batch recorder..." />
        <p className="font-display font-bold text-sm text-[var(--text-ink)]">
          Loading Batch #{batchId.slice(0, 8)}...
        </p>
      </Card>
    );
  }

  if (!batch) {
    return (
      <Card className="p-6 space-y-4">
        <p className="font-display font-bold text-sm text-[var(--color-tomato)]">
          Could not find batch {batchId}.
        </p>
        <Button variant="secondary" onClick={onDismiss}>
          ← Back to Search
        </Button>
      </Card>
    );
  }

  const isTerminal = batch.status === "done" || batch.status === "cancelled";
  const hasCompletedItems = batch.completedCount > 0;
  const hasFailedItems = batch.failedCount > 0;

  return (
    <div className="space-y-6">
      {/* Batch Header Card */}
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="mustard">Batch Tape</Badge>
            <Badge
              tone={
                batch.status === "done"
                  ? "teal"
                  : batch.status === "cancelled"
                    ? "neutral"
                    : "mustard"
              }
            >
              {batch.status.toUpperCase()}
            </Badge>
            <Badge tone="outline">Preset: {batch.qualityPreset}</Badge>
          </div>

          <Button variant="ghost" size="sm" onClick={onDismiss}>
            ← New Pull
          </Button>
        </div>

        <div>
          <h2
            className="font-display font-bold text-[var(--text-ink)] break-words"
            style={{ fontSize: "var(--type-h2)", lineHeight: 1.2 }}
          >
            {batch.title}
          </h2>
          <p className="text-sm font-semibold text-[var(--text-muted)] pt-1">
            {batch.channel} • {batch.completedCount} of {batch.selectedCount} tracks
            completed
          </p>
        </div>

        {/* Overall VHS Tracking Progress Bar */}
        <div className="pt-2">
          <ProgressBar
            value={overallProgressPct}
            label="Tape Batch Progress"
            stageLabel={`Batch Progress: ${batch.completedCount} / ${batch.selectedCount}`}
          />
        </div>

        {/* Live Active Item Progress banner */}
        {activeItemProgress && (
          <div className="p-3 rounded-lg border-2 border-[var(--accent-mustard)] bg-[var(--bg-surface-alt)] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <TapeReelLoader spinning className="w-8 h-5 shrink-0" />
              <div>
                <p className="font-display font-bold text-xs text-[var(--text-ink)] uppercase tracking-wider">
                  Recording Active Track...
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {activeItemProgress.speed ?? "Processing"}
                  {activeItemProgress.etaSec
                    ? ` • ETA ${activeItemProgress.etaSec}s`
                    : ""}
                </p>
              </div>
            </div>
            <span className="font-display font-bold text-sm text-[var(--text-ink)] tabular-nums">
              {Math.round(activeItemProgress.progressPct)}%
            </span>
          </div>
        )}
      </Card>

      {/* Item Rows Table/List */}
      <Card className="p-4 sm:p-6 space-y-3">
        <h3 className="font-display font-bold text-sm uppercase tracking-wider text-[var(--text-ink)]">
          Playlist Tracks ({batch.items.length})
        </h3>

        <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
          {batch.items.map((item) => {
            const isRunning =
              item.status === "running" || activeItemProgress?.itemId === item.id;
            const isDone = item.status === "done";
            const isFailed = item.status === "failed";

            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[var(--border-ink)]/30 bg-[var(--bg-surface)] hover:border-[var(--border-ink)] transition-all"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="w-8 shrink-0 font-display font-bold text-xs text-[var(--text-muted)] tabular-nums">
                    #{String(item.position).padStart(2, "0")}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-display font-bold text-sm text-[var(--text-ink)] truncate">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 pt-0.5">
                      {isDone && (
                        <span className="text-[11px] text-[var(--text-muted)] font-semibold">
                          {item.actualFormat ?? "Saved"}
                        </span>
                      )}
                      {isFailed && (
                        <span className="text-[11px] text-[var(--color-tomato)] font-semibold">
                          Failed: {item.errorCode ?? "Error"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isRunning && (
                    <Badge tone="mustard">
                      {Math.round(activeItemProgress?.progressPct ?? 0)}%
                    </Badge>
                  )}
                  {isDone && <Badge tone="teal">Ready</Badge>}
                  {isFailed && <Badge tone="tomato">Failed</Badge>}
                  {item.status === "queued" && <Badge tone="neutral">Queued</Badge>}
                  {item.status === "cancelled" && <Badge tone="outline">Cancelled</Badge>}

                  {isDone && item.downloadUrl && (
                    <a
                      href={item.downloadUrl}
                      download
                      className="px-2.5 py-1 text-xs font-display font-bold rounded border-2 border-[var(--border-ink)] bg-[var(--accent-teal)] text-[var(--text-ink)] shadow-[1px_1px_0_var(--border-ink)] hover:translate-y-[-1px] transition-all"
                    >
                      Download
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Sticky Bottom Action Bar */}
      <div className="sticky bottom-0 z-30 -mx-4 -mb-6 p-4 border-t-2 border-[var(--border-ink)] bg-[var(--bg-surface)]/95 backdrop-blur shadow-[0_-4px_10px_rgba(0,0,0,0.08)] sm:rounded-b-lg sm:mx-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-xs sm:text-sm text-[var(--text-ink)]">
              {batch.completedCount} / {batch.selectedCount} ready
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            {!isTerminal && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelAll}
                disabled={isCancelling}
                loading={isCancelling}
                className="flex-1 sm:flex-none"
              >
                Cancel Batch
              </Button>
            )}

            {hasFailedItems && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRetryFailed}
                disabled={isRetrying}
                loading={isRetrying}
                className="flex-1 sm:flex-none"
              >
                Retry ({batch.failedCount})
              </Button>
            )}

            <Button
              variant="primary"
              size="md"
              onClick={handleDownloadZip}
              disabled={!hasCompletedItems}
              className="w-full sm:w-auto"
            >
              📦 Download ZIP ({batch.completedCount})
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
