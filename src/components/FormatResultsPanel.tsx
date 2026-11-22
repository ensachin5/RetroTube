"use client";

import Image from "next/image";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Tabs, type TabOption } from "@/src/components/ui/Tabs";
import {
  formatBytes,
  formatDuration,
  formatUploadDate,
  type AudioCodecGroup,
  type VideoResolutionGroup,
  shortCodecName,
} from "@/src/lib/format-grouping";
import type {
  AudioConversionOption,
  FetchVideoResponseDto,
  NormalizedAudioFormatDto,
  NormalizedVideoFormatDto,
} from "@/services/format.normalizer";

export type SelectedAction =
  | {
      kind: "video";
      format: NormalizedVideoFormatDto;
      label: string;
    }
  | {
      kind: "audio";
      format: NormalizedAudioFormatDto;
      label: string;
    }
  | {
      kind: "conversion";
      preset: AudioConversionOption;
      label: string;
    };

export interface FormatResultsPanelProps {
  result: FetchVideoResponseDto;
  activeTab: "video" | "audio";
  onTabChange: (tab: "video" | "audio") => void;
  videoGrouped: {
    groups: VideoResolutionGroup[];
    bestFormatId: number | null;
  };
  audioGrouped: {
    groups: AudioCodecGroup[];
    bestFormatId: number | null;
  };
  selectedAction: SelectedAction | null;
  onSelectAction: (action: SelectedAction) => void;
  onStartDownload: (action: SelectedAction) => void;
  startingJob: boolean;
  sourceUrl?: string;
  onLoadPlaylist?: (url: string) => void;
}

export function FormatResultsPanel({
  result,
  activeTab,
  onTabChange,
  videoGrouped,
  audioGrouped,
  selectedAction,
  onSelectAction,
  onStartDownload,
  startingJob,
  sourceUrl,
  onLoadPlaylist,
}: FormatResultsPanelProps) {
  const isIos =
    typeof navigator !== "undefined" &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const tabOptions: TabOption<"video" | "audio">[] = [
    { id: "video", label: "Video", count: result.videoFormats.length },
    {
      id: "audio",
      label: "Audio",
      count: result.audioFormats.length + result.audioConversions.length,
    },
  ];

  return (
    <section aria-label="Video details and formats" className="space-y-5">
      {result.hadPlaylistParam ? (
        <Card tone="alt" className="px-4 py-3 text-sm font-medium flex flex-wrap items-center justify-between gap-3">
          <span>This video belongs to a playlist.</span>
          {onLoadPlaylist ? (
            <Button
              variant="surface"
              size="sm"
              onClick={() =>
                onLoadPlaylist(
                  sourceUrl ||
                    `https://www.youtube.com/watch?v=${result.video.youtubeId}`,
                )
              }
            >
              📜 Load Whole Playlist
            </Button>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-[280px_1fr] md:items-center">
          <div className="relative aspect-video w-full overflow-hidden rounded-md border-2 border-[var(--border-ink)] bg-[var(--bg-surface-alt)]">
            <Image
              src={result.video.thumbnailUrl}
              alt={`Thumbnail for ${result.video.title}`}
              fill
              sizes="(max-width: 768px) 100vw, 280px"
              className="object-cover"
              priority
            />
            <span className="absolute right-2 bottom-2 rounded border border-[var(--border-ink)] bg-[#141210]/90 px-2 py-0.5 font-display text-xs font-bold text-[#fbf7ee] tabular-nums">
              {formatDuration(result.video.durationSec)}
            </span>
          </div>

          <div className="min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={result.cached ? "neutral" : "teal"}>
                {result.cached ? "Cached Tape (1h)" : "Fresh Pull"}
              </Badge>
            </div>

            <h2
              className="font-display font-bold text-[var(--text-ink)] break-words"
              style={{ fontSize: "var(--type-h2)", lineHeight: 1.2 }}
            >
              {result.video.title}
            </h2>

            <dl className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-3 sm:gap-3 pt-1">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Channel
                </dt>
                <dd className="font-semibold text-[var(--text-ink)] truncate">
                  {result.video.channel}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Duration
                </dt>
                <dd className="font-semibold text-[var(--text-ink)] tabular-nums">
                  {formatDuration(result.video.durationSec)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Uploaded
                </dt>
                <dd className="font-semibold text-[var(--text-ink)]">
                  {formatUploadDate(result.video.uploadDate)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <Tabs
          idPrefix="formats"
          label="Available stream formats"
          tabs={tabOptions}
          activeTab={activeTab}
          onChange={onTabChange}
        >
          {activeTab === "video" ? (
            <div className="max-h-[58dvh] overflow-y-auto pr-1 space-y-5">
              {videoGrouped.groups.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-4">
                  No video streams found for this video.
                </p>
              ) : (
                videoGrouped.groups.map((group) => (
                  <div key={group.key} className="space-y-2.5">
                    <h3 className="sticky top-0 z-10 inline-block rounded border border-[var(--border-ink)] bg-[var(--bg-surface-alt)] px-2.5 py-1 font-display text-xs sm:text-sm font-bold uppercase tracking-wider">
                      {group.label}
                    </h3>

                    <ul className="space-y-2.5">
                      {group.formats.map((fmt) => {
                        const isBest = fmt.id === videoGrouped.bestFormatId;
                        const isSelected =
                          selectedAction?.kind === "video" &&
                          selectedAction.format.id === fmt.id;

                        return (
                          <li
                            key={fmt.id}
                            className={`rounded-md border-2 p-3 transition-colors flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                              isSelected
                                ? "border-[var(--accent-teal)] bg-[var(--bg-surface-alt)]"
                                : "border-[var(--border-ink)] bg-[var(--bg-surface)]"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                onSelectAction({
                                  kind: "video",
                                  format: fmt,
                                  label: `${fmt.resolution ?? "Video"} ${fmt.recommendedContainer.toUpperCase()}`,
                                })
                              }
                              className="min-w-0 flex-1 text-left cursor-pointer space-y-1.5"
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                {isBest ? (
                                  <Badge tone="mustard">Best Quality</Badge>
                                ) : null}
                                <Badge tone="neutral">
                                  {fmt.container.toUpperCase()}
                                </Badge>
                                {fmt.fps ? (
                                  <Badge tone="outline">{fmt.fps} FPS</Badge>
                                ) : null}
                                {fmt.isHdr ? <Badge tone="tomato">HDR</Badge> : null}
                                {fmt.needsAudioMerge ? (
                                  <Badge tone="teal">Needs Merge</Badge>
                                ) : (
                                  <Badge tone="outline">Muxed</Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-[var(--text-muted)]">
                                <span className="font-semibold text-[var(--text-ink)]">
                                  {shortCodecName(fmt.vcodec)}
                                  {fmt.acodec ? ` + ${shortCodecName(fmt.acodec)}` : ""}
                                </span>
                                <span>{formatBytes(fmt.filesizeBytes)}</span>
                                {fmt.bitrateKbps ? (
                                  <span>{Math.round(fmt.bitrateKbps)} kbps</span>
                                ) : null}
                                <span>#{fmt.formatId}</span>
                              </div>
                              {fmt.filesizeBytes && fmt.filesizeBytes > 1024 * 1024 * 1024 ? (
                                <div className="text-[11px] font-mono text-[var(--accent-mustard)] flex items-center gap-1">
                                  <span>⚠️ Large Tape (&gt;1 GB): High mobile data usage.</span>
                                </div>
                              ) : null}
                              {isIos && fmt.filesizeBytes && fmt.filesizeBytes > 2 * 1024 * 1024 * 1024 ? (
                                <div className="text-[11px] font-mono text-[var(--accent-tomato)] flex items-center gap-1 p-1 rounded bg-[var(--bg-canvas)] border border-[var(--accent-tomato)]">
                                  <span>📱 iOS Safari: Downloads &gt;2 GB may fail in mobile Safari. Desktop recommended.</span>
                                </div>
                              ) : null}
                            </button>

                            <Button
                              variant={isBest ? "primary" : "secondary"}
                              size="sm"
                              disabled={startingJob}
                              onClick={() =>
                                onStartDownload({
                                  kind: "video",
                                  format: fmt,
                                  label: `${fmt.resolution ?? "Video"} ${fmt.recommendedContainer.toUpperCase()}`,
                                })
                              }
                              className="w-full sm:w-auto shrink-0"
                            >
                              Download
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="max-h-[58dvh] overflow-y-auto pr-1 space-y-6">
              {result.audioConversions.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="font-display text-xs sm:text-sm font-bold uppercase tracking-wider text-[var(--text-ink)]">
                    Convert & Download (ffmpeg)
                  </h3>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {result.audioConversions.map((preset) => (
                      <Button
                        key={preset.id}
                        variant={preset.id === "mp3-320" ? "accent" : "surface"}
                        size="md"
                        disabled={startingJob}
                        onClick={() =>
                          onStartDownload({
                            kind: "conversion",
                            preset,
                            label: preset.label,
                          })
                        }
                        className="justify-between"
                      >
                        <span>{preset.label}</span>
                        <span className="text-xs uppercase opacity-80">REC</span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-4">
                <h3 className="font-display text-xs sm:text-sm font-bold uppercase tracking-wider text-[var(--text-ink)]">
                  Source Audio Streams
                </h3>
                {audioGrouped.groups.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    No audio streams found for this video.
                  </p>
                ) : (
                  audioGrouped.groups.map((group) => (
                    <div key={group.key} className="space-y-2">
                      <h4 className="inline-block rounded border border-[var(--border-ink)] bg-[var(--bg-surface-alt)] px-2.5 py-0.5 font-display text-xs font-bold uppercase tracking-wider">
                        {group.label}
                      </h4>
                      <ul className="space-y-2">
                        {group.formats.map((fmt) => {
                          const isBest = fmt.id === audioGrouped.bestFormatId;
                          const isSelected =
                            selectedAction?.kind === "audio" &&
                            selectedAction.format.id === fmt.id;

                          return (
                            <li
                              key={fmt.id}
                              className={`rounded-md border-2 p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                                isSelected
                                  ? "border-[var(--accent-teal)] bg-[var(--bg-surface-alt)]"
                                  : "border-[var(--border-ink)] bg-[var(--bg-surface)]"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectAction({
                                    kind: "audio",
                                    format: fmt,
                                    label: `${shortCodecName(fmt.acodec)} ${fmt.bitrateKbps ?? ""}kbps`,
                                  })
                                }
                                className="min-w-0 flex-1 text-left cursor-pointer space-y-1.5"
                              >
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {isBest ? (
                                    <Badge tone="mustard">Best Quality</Badge>
                                  ) : null}
                                  <Badge tone="neutral">
                                    {fmt.container.toUpperCase()}
                                  </Badge>
                                  <Badge tone="outline">
                                    {shortCodecName(fmt.acodec)}
                                  </Badge>
                                  {fmt.bitrateKbps ? (
                                    <Badge tone="teal">
                                      {Math.round(fmt.bitrateKbps)} kbps
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="text-xs sm:text-sm text-[var(--text-muted)]">
                                  {formatBytes(fmt.filesizeBytes)} · #{fmt.formatId}
                                  {fmt.formatNote ? ` · ${fmt.formatNote}` : ""}
                                </p>
                              </button>

                              <Button
                                variant={isBest ? "primary" : "secondary"}
                                size="sm"
                                disabled={startingJob}
                                onClick={() =>
                                  onStartDownload({
                                    kind: "audio",
                                    format: fmt,
                                    label: `${shortCodecName(fmt.acodec)} ${fmt.bitrateKbps ?? ""}kbps`,
                                  })
                                }
                                className="w-full sm:w-auto shrink-0"
                              >
                                Download
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </Tabs>
      </Card>
    </section>
  );
}
