"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Toast } from "@/src/components/ui/Toast";
import {
  JobProgressPanel,
  type ActiveDownloadJob,
} from "@/src/components/JobProgressPanel";
import { formatBytes, formatDuration } from "@/src/lib/format-grouping";
import {
  clearClientHistory,
  getClientHistory,
  removeClientHistoryItem,
} from "@/src/lib/client-history";
import type { HistoryItemWithDetails } from "@/repositories/history.repo";

export interface HistoryListProps {
  initialItems: HistoryItemWithDetails[];
}

export function HistoryList({ initialItems }: HistoryListProps) {
  const [items, setItems] = useState<HistoryItemWithDetails[]>(() => {
    if (typeof window !== "undefined") {
      const local = getClientHistory();
      if (local.length > 0) return local as unknown as HistoryItemWithDetails[];
    }
    return initialItems;
  });

  useEffect(() => {
    const local = getClientHistory();
    if (local.length > 0) {
      setItems(local as unknown as HistoryItemWithDetails[]);
    }
  }, []);

  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [redownloadingId, setRedownloadingId] = useState<number | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveDownloadJob | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: "info" | "error" | "success";
  } | null>(null);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      removeClientHistoryItem(id);
      void fetch(`/api/history/${id}`, { method: "DELETE" }).catch(() => undefined);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setToast({ message: "Entry removed from tape log.", tone: "info" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    if (items.length === 0) return;
    setClearingAll(true);
    try {
      clearClientHistory();
      void fetch("/api/history", { method: "DELETE" }).catch(() => undefined);
      setItems([]);
      setConfirmClearAll(false);
      setToast({
        message: "Cleared download history.",
        tone: "success",
      });
    } finally {
      setClearingAll(false);
    }
  };

  const handleRedownloadDirect = (item: HistoryItemWithDetails) => {
    const directUrl = `/api/download/direct?v=${encodeURIComponent(item.video.youtubeId)}&format=${encodeURIComponent(item.sourceFormatId || "best")}&container=${encodeURIComponent(item.targetContainer)}&title=${encodeURIComponent(item.video.title)}`;
    const anchor = document.createElement("a");
    anchor.href = directUrl;
    anchor.download = item.outputFilename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setToast({
      message: "Streaming directly to your device...",
      tone: "success",
    });
  };

  const handleRedownload = async (item: HistoryItemWithDetails) => {
    setRedownloadingId(item.id);
    try {
      handleRedownloadDirect(item);
    } finally {
      setRedownloadingId(null);
    }
  };

  return (
    <div className="space-y-5 pb-20 md:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone="mustard">Last 50</Badge>
          <span className="text-sm font-semibold text-[var(--text-muted)]">
            {items.length} {items.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {items.length > 0 ? (
          confirmClearAll ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-bold text-[var(--text-ink)]">
                Clear all history?
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleClearAll()}
                disabled={clearingAll}
              >
                {clearingAll ? "Clearing..." : "Yes, Clear All"}
              </Button>
              <Button
                variant="surface"
                size="sm"
                onClick={() => setConfirmClearAll(false)}
                disabled={clearingAll}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="surface" size="sm" onClick={() => setConfirmClearAll(true)}>
              Clear All
            </Button>
          )
        ) : null}
      </div>

      {activeJob ? (
        <JobProgressPanel job={activeJob} onDismiss={() => setActiveJob(null)} />
      ) : null}

      {items.length === 0 ? (
        <Card className="p-8 text-center space-y-4">
          <p className="font-display text-lg sm:text-xl font-bold text-[var(--text-ink)]">
            Your tape log is empty.
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            Fetched and downloaded videos appear here for one-tap re-downloads.
          </p>
          <div className="pt-1">
            <Link
              href="/"
              className="retro-btn min-h-11 inline-flex items-center justify-center rounded-md bg-[var(--accent-tomato)] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-[var(--on-tomato)] no-underline"
            >
              Fetch a Video
            </Link>
          </div>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card className="p-3.5 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="relative aspect-video w-24 sm:w-32 shrink-0 overflow-hidden rounded border-2 border-[var(--border-ink)] bg-[var(--bg-surface-alt)]">
                      <Image
                        src={item.video.thumbnailUrl}
                        alt={item.video.title}
                        fill
                        sizes="128px"
                        className="object-cover"
                      />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <h2 className="truncate font-display text-sm sm:text-base font-bold text-[var(--text-ink)]">
                        {item.video.title}
                      </h2>
                      <p className="truncate text-xs sm:text-sm text-[var(--text-muted)]">
                        {item.video.channel} · {formatDuration(item.video.durationSec)}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <Badge tone="teal">
                          {item.targetContainer.toUpperCase()}
                          {item.targetBitrateKbps ? ` ${item.targetBitrateKbps}k` : ""}
                        </Badge>
                        <Badge tone="outline">{formatBytes(item.bytesSent)}</Badge>
                        <time
                          dateTime={new Date(item.downloadedAt).toISOString()}
                          suppressHydrationWarning
                          className="text-xs text-[var(--text-muted)]"
                        >
                          {new Date(item.downloadedAt).toLocaleString()}
                        </time>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={redownloadingId === item.id}
                      onClick={() => void handleRedownload(item)}
                      className="flex-1 sm:flex-none"
                    >
                      {redownloadingId === item.id ? "Queuing..." : "Re-download"}
                    </Button>
                    <Button
                      variant="surface"
                      size="sm"
                      disabled={deletingId === item.id}
                      onClick={() => void handleDelete(item.id)}
                      className="flex-1 sm:flex-none"
                    >
                      {deletingId === item.id ? "..." : "Delete"}
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

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
