"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { TapeReelLoader } from "@/src/components/ui/TapeReelLoader";
import { Toast } from "@/src/components/ui/Toast";
import type { SelectedAction } from "@/src/components/FormatResultsPanel";
import type { ActiveDownloadJob } from "@/src/components/JobProgressPanel";
import { UrlFetchForm } from "@/src/components/UrlFetchForm";
import {
  getFriendlyErrorCopy,
  groupAudioFormatsByCodec,
  groupVideoFormatsByResolution,
  shortCodecName,
} from "@/src/lib/format-grouping";
import type { FetchVideoResponseDto } from "@/services/format.normalizer";
import type { JobProgressEvent } from "@/services/job.service";

const FormatResultsPanel = dynamic(
  () =>
    import("@/src/components/FormatResultsPanel").then((mod) => mod.FormatResultsPanel),
  {
    loading: () => (
      <Card className="p-4 sm:p-5 space-y-3">
        <Skeleton className="h-44 w-full" />
      </Card>
    ),
  },
);

const JobProgressPanel = dynamic(() =>
  import("@/src/components/JobProgressPanel").then((mod) => mod.JobProgressPanel),
);

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

type ActiveTab = "video" | "audio";

export interface FetchWorkspaceProps {
  initialUrl?: string;
}

export function FetchWorkspace({ initialUrl = "" }: FetchWorkspaceProps) {
  const [lastSubmittedUrl, setLastSubmittedUrl] = useState(initialUrl);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [result, setResult] = useState<FetchVideoResponseDto | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("video");

  const [selectedAction, setSelectedAction] = useState<SelectedAction | null>(null);
  const [startingJob, setStartingJob] = useState(false);
  const [activeJob, setActiveJob] = useState<ActiveDownloadJob | null>(null);
  const [jobSnapshot, setJobSnapshot] = useState<JobProgressEvent | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: "info" | "error" | "success";
  } | null>(null);

  const autoFetchedInitialRef = useRef(false);

  const videoGrouped = useMemo(
    () => groupVideoFormatsByResolution(result?.videoFormats ?? []),
    [result?.videoFormats],
  );

  const audioGrouped = useMemo(
    () => groupAudioFormatsByCodec(result?.audioFormats ?? []),
    [result?.audioFormats],
  );

  const handleFetch = useCallback(async (url: string) => {
    setLastSubmittedUrl(url);
    setFetching(true);
    setFetchError(null);

    try {
      const response = await fetch("/api/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const payload = (await response.json()) as FetchVideoResponseDto & ApiErrorPayload;
      if (!response.ok) {
        setFetchError({
          code: payload.error?.code ?? "INTERNAL_ERROR",
          message: payload.error?.message ?? "Failed to fetch video metadata.",
        });
        setResult(null);
        return;
      }

      setResult(payload);

      const topVideo = groupVideoFormatsByResolution(payload.videoFormats);
      const bestVideo = topVideo.groups[0]?.formats[0];
      if (bestVideo) {
        setSelectedAction({
          kind: "video",
          format: bestVideo,
          label: `${bestVideo.resolution ?? "Video"} ${bestVideo.recommendedContainer.toUpperCase()}`,
        });
        setActiveTab("video");
      } else if (payload.audioFormats[0]) {
        const bestAudio = payload.audioFormats[0];
        setSelectedAction({
          kind: "audio",
          format: bestAudio,
          label: `${shortCodecName(bestAudio.acodec)} ${bestAudio.bitrateKbps ?? ""}kbps`,
        });
        setActiveTab("audio");
      } else {
        setSelectedAction(null);
      }
    } catch {
      setFetchError({
        code: "INTERNAL_ERROR",
        message: "Network error while contacting RetroTube server.",
      });
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (initialUrl && !autoFetchedInitialRef.current) {
      autoFetchedInitialRef.current = true;
      void handleFetch(initialUrl);
    }
  }, [handleFetch, initialUrl]);

  const startDownload = async (action: SelectedAction) => {
    if (!result) return;
    setSelectedAction(action);
    setStartingJob(true);

    const requestBody =
      action.kind === "video"
        ? {
            videoId: result.video.id,
            formatId: action.format.id,
            targetContainer: action.format.recommendedContainer,
          }
        : action.kind === "audio"
          ? {
              videoId: result.video.id,
              formatId: action.format.id,
            }
          : {
              videoId: result.video.id,
              targetContainer: action.preset.targetContainer,
              audioBitrateKbps: action.preset.bitrateKbps,
            };

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = (await response.json()) as ActiveDownloadJob & ApiErrorPayload;
      if (!response.ok) {
        const copy = getFriendlyErrorCopy(data.error?.code, data.error?.message);
        setToast({ message: `${copy.title}: ${copy.message}`, tone: "error" });
        return;
      }

      setJobSnapshot({
        jobId: data.jobId,
        status: "queued",
        progressPct: 0,
        stage: "queued",
        outputFilename: data.outputFilename,
        streamUrl: data.streamUrl,
      });
      setActiveJob(data);
    } catch {
      setToast({
        message: "Failed to queue download job. Check your connection.",
        tone: "error",
      });
    } finally {
      setStartingJob(false);
    }
  };

  const errorCopy = fetchError
    ? getFriendlyErrorCopy(fetchError.code, fetchError.message)
    : null;

  const isJobRunning =
    activeJob !== null &&
    jobSnapshot?.status !== "done" &&
    jobSnapshot?.status !== "failed" &&
    jobSnapshot?.status !== "cancelled";

  return (
    <div className="space-y-6 pb-24 md:pb-8">
      <section aria-labelledby="hero-heading">
        <Card className="p-4 sm:p-6 space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="mustard">Deck v1</Badge>
            </div>
            <h1
              id="hero-heading"
              className="font-display font-black tracking-tight text-[var(--text-ink)]"
              style={{ fontSize: "var(--type-display)", lineHeight: 1.08 }}
            >
              Pull any YouTube track to tape.
            </h1>
            <p className="max-w-2xl text-sm sm:text-base text-[var(--text-muted)]">
              Inspect every video and audio stream, splice high-res video with best audio
              automatically, or transcode to MP3, M4A, Opus, FLAC, and WAV.
            </p>
          </div>

          <UrlFetchForm
            initialUrl={initialUrl}
            loading={fetching}
            onFetch={(url) => void handleFetch(url)}
            onClipboardFallback={(msg) => setToast({ message: msg, tone: "info" })}
          />
        </Card>
      </section>

      {fetching ? (
        <section aria-label="Loading video metadata" className="space-y-4">
          <Card className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <TapeReelLoader label="Scanning tape index..." />
            </div>
            <div className="grid gap-4 md:grid-cols-[260px_1fr]">
              <Skeleton className="aspect-video w-full" />
              <div className="space-y-3">
                <Skeleton className="h-7 w-4/5" />
                <Skeleton className="h-5 w-1/2" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-24" />
                </div>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      {errorCopy && fetchError ? (
        <section aria-label="Fetch error">
          <Card
            tone="error"
            role="alert"
            aria-live="assertive"
            className="p-4 sm:p-5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone="tomato">{fetchError.code}</Badge>
                <h2 className="font-display text-base sm:text-lg font-bold">
                  {errorCopy.title}
                </h2>
              </div>
              <div className="flex gap-2">
                {fetchError.code === "UNAUTHORIZED" ? (
                  <Link
                    href="/unlock"
                    className="retro-btn min-h-11 inline-flex items-center rounded-md bg-[var(--accent-teal)] px-3 py-2 font-display text-xs font-bold uppercase tracking-wider text-[var(--on-teal)] no-underline"
                  >
                    Unlock Deck
                  </Link>
                ) : null}
                <Button
                  variant="surface"
                  size="sm"
                  onClick={() => {
                    if (lastSubmittedUrl) void handleFetch(lastSubmittedUrl);
                  }}
                  disabled={!lastSubmittedUrl}
                >
                  Retry
                </Button>
              </div>
            </div>
            <p className="text-sm sm:text-base text-[var(--text-ink)]">
              {errorCopy.message}
            </p>
          </Card>
        </section>
      ) : null}

      {activeJob ? (
        <section aria-label="Active download progress">
          <JobProgressPanel
            job={activeJob}
            onDismiss={() => {
              setActiveJob(null);
              setJobSnapshot(null);
            }}
            onSnapshotChange={setJobSnapshot}
          />
        </section>
      ) : null}

      {result && !fetching ? (
        <FormatResultsPanel
          result={result}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          videoGrouped={videoGrouped}
          audioGrouped={audioGrouped}
          selectedAction={selectedAction}
          onSelectAction={setSelectedAction}
          onStartDownload={(action) => void startDownload(action)}
          startingJob={startingJob}
        />
      ) : null}

      {result || activeJob ? (
        <div className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t-2 border-[var(--border-ink)] bg-[var(--bg-surface)] px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_0_var(--shadow-color)]">
          {isJobRunning && activeJob ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xs font-bold uppercase tracking-wider">
                  {Math.round(jobSnapshot?.progressPct ?? 0)}% ·{" "}
                  {activeJob.outputFilename}
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  await fetch(`/api/jobs/${activeJob.jobId}/cancel`, {
                    method: "POST",
                  }).catch(() => undefined);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : jobSnapshot?.status === "done" && activeJob ? (
            <div className="flex items-center justify-between gap-3">
              <p className="truncate font-display text-xs font-bold uppercase">
                Ready: {activeJob.outputFilename}
              </p>
              <a
                href={jobSnapshot.streamUrl ?? activeJob.streamUrl}
                download={activeJob.outputFilename}
                className="retro-btn min-h-11 inline-flex items-center justify-center rounded-md bg-[var(--accent-teal)] px-4 py-2 font-display text-xs font-bold uppercase text-[var(--on-teal)] no-underline shrink-0"
              >
                Save File
              </a>
            </div>
          ) : selectedAction && result ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Selected Quality
                </p>
                <p className="truncate font-display text-sm font-bold text-[var(--text-ink)]">
                  {selectedAction.label}
                </p>
              </div>
              <Button
                variant="primary"
                size="md"
                disabled={startingJob}
                onClick={() => void startDownload(selectedAction)}
                className="shrink-0"
              >
                {startingJob ? "Starting..." : "Download"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <Toast
          message={toast.message}
          tone={toast.tone}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}
