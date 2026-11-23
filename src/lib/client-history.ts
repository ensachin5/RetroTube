import type { HistoryItemWithDetails } from "@/repositories/history.repo";

const LOCAL_STORAGE_KEY = "retrotube_history_v1";
const MAX_LOCAL_ITEMS = 50;

export interface ClientHistoryEntry {
  id: number;
  jobId: string;
  downloadedAt: number;
  bytesSent: number;
  outputFilename: string;
  targetContainer: string;
  targetBitrateKbps: number | null;
  sourceFormatId: string;
  formatId: number | null;
  video: {
    id: number;
    youtubeId: string;
    title: string;
    channel: string;
    durationSec: number;
    thumbnailUrl: string;
  };
}

export function getClientHistory(): ClientHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

export function saveClientHistoryItem(entry: Omit<ClientHistoryEntry, "id" | "downloadedAt"> & { id?: number; downloadedAt?: number }): ClientHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const existing = getClientHistory();
    const newEntry: ClientHistoryEntry = {
      ...entry,
      id: entry.id ?? Date.now(),
      downloadedAt: entry.downloadedAt ?? Date.now(),
    };

    // Filter out if already exists by jobId or youtubeId+format
    const filtered = existing.filter(
      (item) => item.jobId !== newEntry.jobId && !(item.video.youtubeId === newEntry.video.youtubeId && item.outputFilename === newEntry.outputFilename)
    );

    const updated = [newEntry, ...filtered].slice(0, MAX_LOCAL_ITEMS);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function removeClientHistoryItem(id: number): ClientHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const existing = getClientHistory();
    const updated = existing.filter((item) => item.id !== id);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function clearClientHistory(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Ignore
  }
}
