"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import type { PlaylistDTO } from "@/services/playlist.service";

export interface PlaylistPickerProps {
  playlist: PlaylistDTO;
  sourceUrl: string;
  onStartBatch: (params: {
    selectedItemIds: string[];
    qualityPreset: string;
    kind: "video" | "audio";
    targetContainer: string;
  }) => void;
  onCancel: () => void;
  loading?: boolean;
}

const PRESET_OPTIONS = [
  { id: "best_video", label: "Best Video", kind: "video", container: "mp4" },
  { id: "1080p", label: "1080p HD", kind: "video", container: "mp4" },
  { id: "720p", label: "720p", kind: "video", container: "mp4" },
  { id: "480p", label: "480p", kind: "video", container: "mp4" },
  { id: "audio_best", label: "Best Audio", kind: "audio", container: "m4a" },
  { id: "mp3_320", label: "MP3 320k", kind: "audio", container: "mp3" },
  { id: "mp3_192", label: "MP3 192k", kind: "audio", container: "mp3" },
  { id: "mp3_128", label: "MP3 128k", kind: "audio", container: "mp3" },
] as const;

function formatDuration(sec: number): string {
  if (sec <= 0) return "0:00";
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function PlaylistPicker({
  playlist,
  onStartBatch,
  onCancel,
  loading = false,
}: PlaylistPickerProps) {
  const availableItems = useMemo(
    () => playlist.items.filter((item) => item.isAvailable),
    [playlist.items],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    return new Set(availableItems.map((item) => item.youtubeId));
  });

  const [selectedPresetId, setSelectedPresetId] = useState<string>("1080p");
  const [rangeStart, setRangeStart] = useState<string>("1");
  const [rangeEnd, setRangeEnd] = useState<string>(
    String(Math.min(20, playlist.items.length)),
  );

  const toggleItem = (youtubeId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(youtubeId)) {
        next.delete(youtubeId);
      } else {
        next.add(youtubeId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(availableItems.map((i) => i.youtubeId)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleApplyRange = () => {
    const start = parseInt(rangeStart, 10);
    const end = parseInt(rangeEnd, 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) return;

    const inRange = new Set<string>();
    for (const item of playlist.items) {
      if (item.position >= start && item.position <= end && item.isAvailable) {
        inRange.add(item.youtubeId);
      }
    }
    setSelectedIds(inRange);
  };

  const handleStart = () => {
    const preset =
      PRESET_OPTIONS.find((p) => p.id === selectedPresetId) ?? PRESET_OPTIONS[0];

    onStartBatch({
      selectedItemIds: Array.from(selectedIds),
      qualityPreset: preset.id,
      kind: preset.kind as "video" | "audio",
      targetContainer: preset.container,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header card */}
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="mustard">Playlist Deck</Badge>
            <Badge tone="teal">{playlist.itemCount} Tracks</Badge>
            <Badge tone="outline">
              Total {formatDuration(playlist.totalDurationSec)}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            ← Load Another URL
          </Button>
        </div>

        <div>
          <h2
            className="font-display font-bold text-[var(--text-ink)] break-words"
            style={{ fontSize: "var(--type-h2)", lineHeight: 1.2 }}
          >
            {playlist.title}
          </h2>
          <p className="text-sm font-semibold text-[var(--text-muted)] pt-1">
            Curator: {playlist.channel}
          </p>
        </div>

        {/* Preset picker */}
        <div className="space-y-2 pt-2 border-t border-[var(--border-ink)]/20">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-ink)]">
            Quality Preset
          </label>
          <div className="flex flex-wrap gap-2">
            {PRESET_OPTIONS.map((preset) => {
              const isActive = selectedPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPresetId(preset.id)}
                  className={`px-3 py-1.5 text-xs sm:text-sm font-display font-bold rounded border-2 transition-all cursor-pointer ${
                    isActive
                      ? "border-[var(--border-ink)] bg-[var(--accent-mustard)] text-[var(--text-ink)] shadow-[2px_2px_0_var(--border-ink)]"
                      : "border-[var(--border-ink)]/50 bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--border-ink)] hover:text-[var(--text-ink)]"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selection controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--border-ink)]/20">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleSelectAll}>
              Select All ({availableItems.length})
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
              Clear
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="text-[var(--text-muted)]">Range:</span>
            <input
              type="number"
              min="1"
              max={playlist.itemCount}
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="w-16 min-h-9 rounded border-2 border-[var(--border-ink)] px-2 py-1 text-center font-bold text-base sm:text-xs bg-[var(--bg-surface)] text-[var(--text-ink)]"
            />
            <span className="text-[var(--text-muted)]">to</span>
            <input
              type="number"
              min="1"
              max={playlist.itemCount}
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="w-16 min-h-9 rounded border-2 border-[var(--border-ink)] px-2 py-1 text-center font-bold text-base sm:text-xs bg-[var(--bg-surface)] text-[var(--text-ink)]"
            />
            <Button variant="secondary" size="sm" onClick={handleApplyRange}>
              Apply
            </Button>
          </div>
        </div>
      </Card>

      {/* Playlist Items List */}
      <div className="space-y-2 max-h-[550px] overflow-y-auto pr-1">
        {playlist.items.map((item) => {
          const isSelected = selectedIds.has(item.youtubeId);
          return (
            <div
              key={item.youtubeId}
              onClick={() => {
                if (item.isAvailable) toggleItem(item.youtubeId);
              }}
              className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all select-none ${
                !item.isAvailable
                  ? "opacity-50 border-[var(--border-ink)]/30 bg-[var(--bg-surface-alt)] cursor-not-allowed"
                  : isSelected
                    ? "border-[var(--border-ink)] bg-[var(--bg-surface)] shadow-[2px_2px_0_var(--border-ink)] cursor-pointer"
                    : "border-[var(--border-ink)]/40 bg-[var(--bg-surface)]/70 hover:border-[var(--border-ink)] cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={!item.isAvailable}
                onChange={() => {}}
                className="h-4 w-4 rounded border-2 border-[var(--border-ink)] accent-[var(--accent-teal)] cursor-pointer"
              />

              <span className="w-8 shrink-0 font-display font-bold text-xs text-[var(--text-muted)] tabular-nums">
                #{String(item.position).padStart(2, "0")}
              </span>

              {item.thumbnailUrl ? (
                <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded border border-[var(--border-ink)] bg-black/10">
                  <Image
                    src={item.thumbnailUrl}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ) : (
                <div className="h-12 w-20 shrink-0 rounded border border-[var(--border-ink)] bg-[var(--bg-surface-alt)] flex items-center justify-center text-[10px] text-[var(--text-muted)]">
                  Tape
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-display font-bold text-sm text-[var(--text-ink)] truncate">
                    {item.title}
                  </p>
                  {!item.isAvailable && (
                    <Badge tone="tomato">
                      {item.unavailableReason ?? "Unavailable"}
                    </Badge>
                  )}
                </div>
                {item.durationSec > 0 && (
                  <p className="text-xs text-[var(--text-muted)] tabular-nums">
                    {formatDuration(item.durationSec)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="sticky bottom-0 z-30 -mx-4 -mb-6 p-4 border-t-2 border-[var(--border-ink)] bg-[var(--bg-surface)]/95 backdrop-blur shadow-[0_-4px_10px_rgba(0,0,0,0.08)] sm:rounded-b-lg sm:mx-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 max-w-4xl mx-auto">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display font-bold text-xs sm:text-sm text-[var(--text-ink)]">
              {selectedIds.size} of {availableItems.length} tracks selected
            </span>
            <Badge tone="neutral">
              Preset:{" "}
              {PRESET_OPTIONS.find((p) => p.id === selectedPresetId)?.label}
            </Badge>
          </div>

          <Button
            variant="primary"
            size="md"
            onClick={handleStart}
            disabled={selectedIds.size === 0 || loading}
            loading={loading}
            className="w-full sm:w-auto"
          >
            Start Batch Download ({selectedIds.size})
          </Button>
        </div>
      </div>
    </div>
  );
}
