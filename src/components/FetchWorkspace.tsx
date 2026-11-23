"use client";

import dynamic from "next/dynamic";
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
import type { PlaylistDTO, PlaylistFetchResult } from "@/services/playlist.service";
import { saveClientHistoryItem } from "@/src/lib/client-history";

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

const PlaylistPicker = dynamic(() =>
  import("@/src/components/PlaylistPicker").then((mod) => mod.PlaylistPicker),
);

const BatchProgressPanel = dynamic(() =>
  import("@/src/components/BatchProgressPanel").then((mod) => mod.BatchProgressPanel),
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
  const [playlistResult, setPlaylistResult] = useState<PlaylistDTO | null>(null);
  const [combinedPrompt, setCombinedPrompt] = useState<{
    url: string;
    videoId?: string;
    playlistId?: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>("video");
  const [selectedAction, setSelectedAction] = useState<SelectedAction | null>(null);
  const [startingJob, setStartingJob] = useState(false);
  const [activeJob, setActiveJob] = useState<ActiveDownloadJob | null>(null);
  const [activeDirectStream, setActiveDirectStream] = useState<{
    directUrl: string;
    outputFilename: string;
    title: string;
    qualityLabel: string;
    container: string;
  } | null>(null);
  const [, setJobSnapshot] = useState<JobProgressEvent | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem("retrotube_active_batch_id");
      } catch {
        // Ignore
      }
    }
    return null;
  });

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

  const fetchSingleVideo = useCallback(async (url: string) => {
    setLastSubmittedUrl(url);
    setFetching(true);
    setFetchError(null);
    setPlaylistResult(null);
    setCombinedPrompt(null);

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

  const fetchPlaylist = useCallback(async (url: string, force = false) => {
    setLastSubmittedUrl(url);
    setFetching(true);
    setFetchError(null);
    setResult(null);
    setCombinedPrompt(null);

    try {
      const response = await fetch("/api/playlist/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, forcePlaylist: force }),
      });

      const payload = (await response.json()) as PlaylistFetchResult & ApiErrorPayload;
      if (!response.ok) {
        setFetchError({
          code: payload.error?.code ?? "INTERNAL_ERROR",
          message: payload.error?.message ?? "Failed to fetch playlist metadata.",
        });
        setPlaylistResult(null);
        return;
      }

      if (payload.isCombined && !force) {
        setCombinedPrompt({
          url,
          videoId: payload.videoId,
          playlistId: payload.playlistId,
        });
        return;
      }

      if (payload.playlist) {
        setPlaylistResult(payload.playlist);
      }
    } catch {
      setFetchError({
        code: "INTERNAL_ERROR",
        message: "Network error while fetching playlist metadata.",
      });
    } finally {
      setFetching(false);
    }
  }, []);

  const handleFetch = useCallback(
    async (url: string) => {
      const lower = url.toLowerCase();
      const hasList = lower.includes("list=") || lower.includes("/playlist");
      const hasVideo =
        lower.includes("v=") || lower.includes("youtu.be/") || lower.includes("/shorts/");

      if (hasVideo) {
        // Fast path: Immediately load the video so the user sees formats and download button with zero delay
        await fetchSingleVideo(url);
      } else if (hasList) {
        // Pure playlist URL: Load the playlist directly
        await fetchPlaylist(url, true);
      } else {
        await fetchSingleVideo(url);
      }
    },
    [fetchPlaylist, fetchSingleVideo],
  );

  useEffect(() => {
    if (initialUrl && !autoFetchedInitialRef.current) {
      autoFetchedInitialRef.current = true;
      void handleFetch(initialUrl);
    }
  }, [handleFetch, initialUrl]);

  const handleDirectDownload = (action: SelectedAction) => {
    if (!result) return;
    const formatSelector =
      action.kind === "video"
        ? action.format.formatId
        : action.kind === "audio"
          ? action.format.formatId
          : "bestaudio";
    const container =
      action.kind === "video"
        ? action.format.recommendedContainer
        : action.kind === "audio"
          ? action.format.container
          : action.preset.targetContainer;

    const safeTitle = result.video.title.replace(/[/\\?%*:|"<>]/g, "_");
    const outputFilename = `${safeTitle}.${container}`;
    const directUrl = `/api/download/direct?v=${encodeURIComponent(result.video.youtubeId)}&format=${encodeURIComponent(formatSelector)}&container=${encodeURIComponent(container)}&title=${encodeURIComponent(result.video.title)}`;

    saveClientHistoryItem({
      jobId: `direct-${Date.now()}`,
      outputFilename,
      targetContainer: container,
      targetBitrateKbps:
        action.kind === "audio"
          ? action.format.bitrateKbps ?? null
          : action.kind === "conversion"
            ? action.preset.bitrateKbps
            : null,
      sourceFormatId: formatSelector,
      formatId: action.kind !== "conversion" ? action.format.id : null,
      bytesSent: action.kind !== "conversion" ? (action.format.filesizeBytes ?? 0) : 0,
      video: {
        id: result.video.id,
        youtubeId: result.video.youtubeId,
        title: result.video.title,
        channel: result.video.channel,
        durationSec: result.video.durationSec,
        thumbnailUrl: result.video.thumbnailUrl,
      },
    });

    setActiveDirectStream({
      directUrl,
      outputFilename,
      title: result.video.title,
      qualityLabel: action.label,
      container,
    });

    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = directUrl;
      document.body.appendChild(iframe);
      setTimeout(() => {
        iframe.remove();
      }, 30000);
    } catch {
      // Ignore iframe fallback
    }

    try {
      const anchor = document.createElement("a");
      anchor.href = directUrl;
      anchor.download = outputFilename;
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => anchor.remove(), 100);
    } catch {
      // Ignore anchor fallback
    }

    setToast({
      message: "Direct tape stream started! Check download progress below.",
      tone: "success",
    });
  };

  const startDownload = async (action: SelectedAction) => {
    handleDirectDownload(action);
  };

  const handleStartBatch = async (params: {
    selectedItemIds: string[];
    qualityPreset: string;
    kind: "video" | "audio";
    targetContainer: string;
  }) => {
    if (!playlistResult) return;
    setStartingJob(true);

    try {
      const response = await fetch("/api/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playlistId: playlistResult.id,
          sourceUrl: lastSubmittedUrl,
          title: playlistResult.title,
          channel: playlistResult.channel,
          selectedItemIds: params.selectedItemIds,
          items: playlistResult.items,
          qualityPreset: params.qualityPreset,
          kind: params.kind,
          targetContainer: params.targetContainer,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setToast({
          message: payload.error?.message ?? "Failed to start batch.",
          tone: "error",
        });
        return;
      }

      const newBatchId = payload.batchId;
      setActiveBatchId(newBatchId);
      try {
        localStorage.setItem("retrotube_active_batch_id", newBatchId);
      } catch {
        // Ignore
      }

      setPlaylistResult(null);
      setToast({
        message: "Tape batch recorder started.",
        tone: "success",
      });
    } catch {
      setToast({
        message: "Could not start batch.",
        tone: "error",
      });
    } finally {
      setStartingJob(false);
    }
  };

  const errorCopy = fetchError ? getFriendlyErrorCopy(fetchError.code) : null;

  return (
    <div className="space-y-6 pb-24 md:pb-8">
      {/* Hero Section with URL Input */}
      <section aria-labelledby="hero-heading">
        <Card className="p-4 sm:p-6 space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="mustard">Deck v2</Badge>
              <Badge tone="outline">Playlist & Batch Ready</Badge>
            </div>
            <h1
              id="hero-heading"
              className="font-display font-black tracking-tight text-[var(--text-ink)]"
              style={{ fontSize: "var(--type-display)", lineHeight: 1.08 }}
            >
              Pull any YouTube track or playlist to tape.
            </h1>
            <p className="max-w-2xl text-sm sm:text-base text-[var(--text-muted)]">
              Inspect single video streams, batch download whole playlists with quality
              presets, stream uncompressed ZIP archives on the fly, or convert to MP3,
              M4A, Opus, and FLAC.
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

      {/* Loading Skeleton */}
      {fetching ? (
        <section aria-label="Loading metadata" className="space-y-4">
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

      {/* Combined URL Prompt */}
      {combinedPrompt && !fetching ? (
        <section aria-label="Combined URL prompt">
          <Card className="p-4 sm:p-6 space-y-4 border-2 border-[var(--accent-mustard)] bg-[var(--bg-surface)]">
            <div className="flex items-center gap-2">
              <Badge tone="mustard">Dual Link Detected</Badge>
              <h2 className="font-display text-base sm:text-lg font-bold text-[var(--text-ink)]">
                Track + Playlist Choice
              </h2>
            </div>
            <p className="text-sm text-[var(--text-ink)]">
              This link points to a single video that also belongs to a playlist. What
              would you like to load?
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Button
                variant="primary"
                onClick={() => void fetchPlaylist(combinedPrompt.url, true)}
              >
                📜 Load Whole Playlist
              </Button>
              <Button
                variant="secondary"
                onClick={() => void fetchSingleVideo(combinedPrompt.url)}
              >
                🎬 Load Single Track
              </Button>
              <Button variant="ghost" onClick={() => setCombinedPrompt(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        </section>
      ) : null}

      {/* Error Alert */}
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
              {fetchError.message || errorCopy.message}
            </p>
          </Card>
        </section>
      ) : null}

      {/* Active Batch Progress Screen */}
      {activeBatchId ? (
        <section aria-label="Active batch download progress">
          <BatchProgressPanel
            batchId={activeBatchId}
            onDismiss={() => {
              setActiveBatchId(null);
              try {
                localStorage.removeItem("retrotube_active_batch_id");
              } catch {
                // Ignore
              }
            }}
          />
        </section>
      ) : null}

      {/* Playlist Picker View */}
      {playlistResult && !fetching && !activeBatchId ? (
        <section aria-label="Playlist selection deck">
          <PlaylistPicker
            playlist={playlistResult}
            sourceUrl={lastSubmittedUrl}
            onStartBatch={(params) => void handleStartBatch(params)}
            onCancel={() => setPlaylistResult(null)}
            loading={startingJob}
          />
        </section>
      ) : null}

      {/* Active Direct Stream Card */}
      {activeDirectStream ? (
        <section aria-label="Direct stream download active">
          <Card
            tone="alt"
            className="p-4 sm:p-5 border-2 border-[var(--border-ink)] shadow-[var(--shadow-retro-sm)] bg-[var(--bg-surface-alt)] space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone="teal">⚡ Live Stream to Device</Badge>
                <Badge tone="mustard">{activeDirectStream.container.toUpperCase()}</Badge>
              </div>
              <Button
                variant="surface"
                size="sm"
                onClick={() => setActiveDirectStream(null)}
              >
                Close
              </Button>
            </div>

            <div className="space-y-1">
              <h3 className="font-display font-bold text-base sm:text-lg text-[var(--text-ink)] line-clamp-1">
                {activeDirectStream.title}
              </h3>
              <p className="text-xs sm:text-sm text-[var(--text-muted)] font-mono">
                {activeDirectStream.outputFilename} · {activeDirectStream.qualityLabel}
              </p>
            </div>

            <div className="py-2">
              <TapeReelLoader label="Pulling stream directly into your device storage (0 MB server disk)..." />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--border-ink)]">
              <span className="text-xs text-[var(--text-muted)]">
                Downloaded directly to your browser tray. If it didn't trigger automatically:
              </span>
              <a
                href={activeDirectStream.directUrl}
                download={activeDirectStream.outputFilename}
                className="retro-btn min-h-10 inline-flex items-center justify-center rounded-md bg-[var(--accent-teal)] px-4 py-2 font-display text-sm font-bold uppercase tracking-wider text-[var(--on-teal)] no-underline w-full sm:w-auto"
              >
                💾 Save File
              </a>
            </div>
          </Card>
        </section>
      ) : null}

      {/* Single Video Active Job Progress */}
      {activeJob && !activeBatchId ? (
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

      {/* Single Video Results Panel */}
      {result && !fetching && !playlistResult && !activeBatchId ? (
        <FormatResultsPanel
          result={result}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          videoGrouped={videoGrouped}
          audioGrouped={audioGrouped}
          selectedAction={selectedAction}
          onSelectAction={setSelectedAction}
          onStartDownload={(action) => void startDownload(action)}
          onDirectDownload={handleDirectDownload}
          startingJob={startingJob}
          sourceUrl={lastSubmittedUrl}
          onLoadPlaylist={(targetUrl) => void fetchPlaylist(targetUrl, true)}
        />
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
