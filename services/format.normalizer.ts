import type { FormatRow, VideoRow } from "@/db/schema";
export type { FormatRow, VideoRow };
import type { FormatInsertInput } from "@/repositories/formats.repo";

export interface RawYtDlpFormat {
  format_id?: string;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  width?: number | null;
  height?: number | null;
  resolution?: string | null;
  fps?: number | null;
  tbr?: number | null;
  vbr?: number | null;
  abr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  dynamic_range?: string | null;
  format_note?: string | null;
  protocol?: string | null;
}

export interface RawYtDlpInfo {
  id: string;
  title?: string;
  channel?: string | null;
  uploader?: string | null;
  duration?: number | null;
  upload_date?: string | null;
  thumbnail?: string | null;
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
  is_live?: boolean | null;
  live_status?: string | null;
  formats?: RawYtDlpFormat[];
}

export interface AudioConversionOption {
  id: "mp3-128" | "mp3-192" | "mp3-320" | "m4a" | "opus" | "flac" | "wav";
  targetContainer: "mp3" | "m4a" | "opus" | "flac" | "wav";
  bitrateKbps: number | null;
  label: string;
}

export const AUDIO_CONVERSION_PRESETS: AudioConversionOption[] = [
  { id: "mp3-128", targetContainer: "mp3", bitrateKbps: 128, label: "MP3 128 kbps" },
  { id: "mp3-192", targetContainer: "mp3", bitrateKbps: 192, label: "MP3 192 kbps" },
  { id: "mp3-320", targetContainer: "mp3", bitrateKbps: 320, label: "MP3 320 kbps" },
  { id: "m4a", targetContainer: "m4a", bitrateKbps: 192, label: "M4A (AAC 192 kbps)" },
  { id: "opus", targetContainer: "opus", bitrateKbps: 160, label: "Opus 160 kbps" },
  { id: "flac", targetContainer: "flac", bitrateKbps: null, label: "FLAC (Lossless)" },
  { id: "wav", targetContainer: "wav", bitrateKbps: null, label: "WAV (PCM 16-bit)" },
];

export interface NormalizedVideoData {
  youtubeId: string;
  title: string;
  channel: string;
  durationSec: number;
  uploadDate: string | null;
  thumbnailUrl: string;
}

export interface NormalizedVideoFormatDto {
  id: number;
  formatId: string;
  kind: "video";
  container: string;
  vcodec: string | null;
  acodec: string | null;
  resolution: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  filesizeBytes: number | null;
  isHdr: boolean;
  needsAudioMerge: boolean;
  recommendedContainer: "mp4" | "webm" | "mkv";
  formatNote: string | null;
}

export interface NormalizedAudioFormatDto {
  id: number;
  formatId: string;
  kind: "audio";
  container: string;
  vcodec: null;
  acodec: string | null;
  bitrateKbps: number | null;
  filesizeBytes: number | null;
  formatNote: string | null;
}

export interface FetchVideoResponseDto {
  cached: boolean;
  hadPlaylistParam?: boolean;
  video: {
    id: number;
    youtubeId: string;
    title: string;
    channel: string;
    durationSec: number;
    uploadDate: string | null;
    thumbnailUrl: string;
    fetchedAt: number;
  };
  videoFormats: NormalizedVideoFormatDto[];
  audioFormats: NormalizedAudioFormatDto[];
  audioConversions: AudioConversionOption[];
}

function normalizeUploadDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeThumbnailUrl(youtubeId: string, info: RawYtDlpInfo): string {
  const candidates: string[] = [];
  if (info.thumbnail) candidates.push(info.thumbnail);
  if (Array.isArray(info.thumbnails)) {
    for (let i = info.thumbnails.length - 1; i >= 0; i -= 1) {
      const url = info.thumbnails[i]?.url;
      if (url) candidates.push(url);
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (
        parsed.protocol === "https:" &&
        (parsed.hostname === "i.ytimg.com" || parsed.hostname === "i9.ytimg.com")
      ) {
        return parsed.toString();
      }
    } catch {
      // Ignore malformed thumbnail candidate
    }
  }

  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

function parseDimensions(raw: RawYtDlpFormat): {
  width: number | null;
  height: number | null;
} {
  let width =
    typeof raw.width === "number" && Number.isFinite(raw.width) && raw.width > 0
      ? Math.round(raw.width)
      : null;
  let height =
    typeof raw.height === "number" && Number.isFinite(raw.height) && raw.height > 0
      ? Math.round(raw.height)
      : null;

  if ((!width || !height) && typeof raw.resolution === "string") {
    const dimMatch = /^(\d+)x(\d+)$/.exec(raw.resolution.trim());
    if (dimMatch) {
      width = Number(dimMatch[1]);
      height = Number(dimMatch[2]);
    }
  }

  return { width, height };
}

function isHdrFormat(raw: RawYtDlpFormat): boolean {
  if (typeof raw.dynamic_range === "string") {
    const dr = raw.dynamic_range.trim().toUpperCase();
    if (dr !== "" && dr !== "SDR" && dr !== "NONE") {
      return true;
    }
  }
  const vcodec = (raw.vcodec ?? "").toLowerCase();
  return vcodec.startsWith("vp9.2") || vcodec.startsWith("vp09.02");
}

function estimateFilesizeBytes(
  raw: RawYtDlpFormat,
  bitrateKbps: number | null,
  durationSec: number,
): number | null {
  if (
    typeof raw.filesize === "number" &&
    Number.isFinite(raw.filesize) &&
    raw.filesize > 0
  ) {
    return Math.round(raw.filesize);
  }
  if (
    typeof raw.filesize_approx === "number" &&
    Number.isFinite(raw.filesize_approx) &&
    raw.filesize_approx > 0
  ) {
    return Math.round(raw.filesize_approx);
  }
  if (bitrateKbps && bitrateKbps > 0 && durationSec > 0) {
    return Math.round((bitrateKbps * 1000 * durationSec) / 8);
  }
  return null;
}

function cleanCodec(codec: string | null | undefined): string | null {
  if (!codec) return null;
  const trimmed = codec.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") {
    return null;
  }
  return trimmed;
}

export function normalizeYtDlpMetadata(
  youtubeId: string,
  info: RawYtDlpInfo,
): {
  video: NormalizedVideoData;
  formats: FormatInsertInput[];
} {
  const durationSec =
    typeof info.duration === "number" &&
    Number.isFinite(info.duration) &&
    info.duration >= 0
      ? Math.round(info.duration)
      : 0;

  const video: NormalizedVideoData = {
    youtubeId,
    title: info.title?.trim() || `YouTube Video (${youtubeId})`,
    channel: info.channel?.trim() || info.uploader?.trim() || "Unknown Channel",
    durationSec,
    uploadDate: normalizeUploadDate(info.upload_date),
    thumbnailUrl: normalizeThumbnailUrl(youtubeId, info),
  };

  const deduped = new Map<string, FormatInsertInput>();
  const rawFormats = Array.isArray(info.formats) ? info.formats : [];

  for (const raw of rawFormats) {
    const formatId = raw.format_id?.trim();
    if (!formatId) continue;

    const ext = (raw.ext ?? "").trim().toLowerCase();
    const protocol = (raw.protocol ?? "").trim().toLowerCase();
    const note = raw.format_note?.trim() ?? null;

    if (ext === "mhtml" || protocol === "mhtml" || note?.toLowerCase() === "storyboard") {
      continue;
    }

    const vcodec = cleanCodec(raw.vcodec);
    const acodec = cleanCodec(raw.acodec);

    // Skip formats with neither video nor audio
    if (!vcodec && !acodec) continue;

    const kind: "video" | "audio" = vcodec ? "video" : "audio";
    const { width, height } = parseDimensions(raw);

    const resolution =
      kind === "video"
        ? height
          ? `${height}p`
          : raw.resolution && raw.resolution !== "audio only"
            ? raw.resolution
            : null
        : null;

    const fps =
      kind === "video" &&
      typeof raw.fps === "number" &&
      Number.isFinite(raw.fps) &&
      raw.fps > 0
        ? Math.round(raw.fps * 100) / 100
        : null;

    const rawBitrate = kind === "audio" ? (raw.abr ?? raw.tbr) : (raw.tbr ?? raw.vbr);
    const bitrateKbps =
      typeof rawBitrate === "number" && Number.isFinite(rawBitrate) && rawBitrate > 0
        ? Math.round(rawBitrate * 10) / 10
        : null;

    const filesizeBytes = estimateFilesizeBytes(raw, bitrateKbps, durationSec);
    const isHdr = kind === "video" ? isHdrFormat(raw) : false;

    const normalized: FormatInsertInput = {
      formatId,
      kind,
      container: ext || (kind === "video" ? "mp4" : "m4a"),
      vcodec,
      acodec,
      resolution,
      width,
      height,
      fps,
      bitrateKbps,
      filesizeBytes,
      isHdr,
      formatNote: note,
    };

    const existing = deduped.get(formatId);
    if (!existing) {
      deduped.set(formatId, normalized);
    } else if (!existing.filesizeBytes && normalized.filesizeBytes) {
      deduped.set(formatId, normalized);
    }
  }

  return {
    video,
    formats: Array.from(deduped.values()),
  };
}

function getRecommendedVideoContainer(format: FormatRow): "mp4" | "webm" | "mkv" {
  if (format.container === "webm") return "webm";
  if (format.container === "mkv") return "mkv";
  return "mp4";
}

export function formatRowsToPresentation(
  video: VideoRow,
  rows: FormatRow[],
  options: { cached: boolean; hadPlaylistParam?: boolean },
): FetchVideoResponseDto {
  const videoFormats: NormalizedVideoFormatDto[] = rows
    .filter((row) => row.kind === "video")
    .sort((a, b) => {
      const heightDiff = (b.height ?? 0) - (a.height ?? 0);
      if (heightDiff !== 0) return heightDiff;

      const fpsDiff = (b.fps ?? 0) - (a.fps ?? 0);
      if (fpsDiff !== 0) return fpsDiff;

      const hdrDiff = Number(b.isHdr) - Number(a.isHdr);
      if (hdrDiff !== 0) return hdrDiff;

      const bitrateDiff = (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0);
      if (bitrateDiff !== 0) return bitrateDiff;

      const mp4Diff = Number(b.container === "mp4") - Number(a.container === "mp4");
      if (mp4Diff !== 0) return mp4Diff;

      return (b.filesizeBytes ?? 0) - (a.filesizeBytes ?? 0);
    })
    .map((row) => ({
      id: row.id,
      formatId: row.formatId,
      kind: "video" as const,
      container: row.container,
      vcodec: row.vcodec,
      acodec: row.acodec,
      resolution: row.resolution,
      width: row.width,
      height: row.height,
      fps: row.fps,
      bitrateKbps: row.bitrateKbps,
      filesizeBytes: row.filesizeBytes,
      isHdr: row.isHdr,
      needsAudioMerge: row.acodec === null,
      recommendedContainer: getRecommendedVideoContainer(row),
      formatNote: row.formatNote,
    }));

  const audioFormats: NormalizedAudioFormatDto[] = rows
    .filter((row) => row.kind === "audio")
    .sort((a, b) => {
      const bitrateDiff = (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0);
      if (bitrateDiff !== 0) return bitrateDiff;

      const sizeDiff = (b.filesizeBytes ?? 0) - (a.filesizeBytes ?? 0);
      if (sizeDiff !== 0) return sizeDiff;

      return a.container.localeCompare(b.container);
    })
    .map((row) => ({
      id: row.id,
      formatId: row.formatId,
      kind: "audio" as const,
      container: row.container,
      vcodec: null,
      acodec: row.acodec,
      bitrateKbps: row.bitrateKbps,
      filesizeBytes: row.filesizeBytes,
      formatNote: row.formatNote,
    }));

  return {
    cached: options.cached,
    ...(options.hadPlaylistParam ? { hadPlaylistParam: true } : {}),
    video: {
      id: video.id,
      youtubeId: video.youtubeId,
      title: video.title,
      channel: video.channel,
      durationSec: video.durationSec,
      uploadDate: video.uploadDate ?? null,
      thumbnailUrl: video.thumbnailUrl,
      fetchedAt: video.fetchedAt,
    },
    videoFormats,
    audioFormats,
    audioConversions: audioFormats.length > 0 ? AUDIO_CONVERSION_PRESETS : [],
  };
}

export interface MatchedPresetResult {
  format: FormatRow | null;
  targetContainer: string;
  targetBitrateKbps?: number | null;
  needsMerge: boolean;
  actualQuality: string;
}

export function matchFormatForPreset(
  formats: FormatRow[],
  preset: string,
  kind: "video" | "audio",
  preferredContainer?: string,
): MatchedPresetResult {
  if (kind === "audio") {
    const audioFormats = formats
      .filter((f) => f.kind === "audio")
      .sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0));
    const bestAudio = audioFormats[0] ?? null;

    if (preset === "mp3_320" || preset === "mp3-320") {
      return {
        format: bestAudio,
        targetContainer: "mp3",
        targetBitrateKbps: 320,
        needsMerge: true,
        actualQuality: "MP3 320 kbps",
      };
    }
    if (preset === "mp3_192" || preset === "mp3-192") {
      return {
        format: bestAudio,
        targetContainer: "mp3",
        targetBitrateKbps: 192,
        needsMerge: true,
        actualQuality: "MP3 192 kbps",
      };
    }
    if (preset === "mp3_128" || preset === "mp3-128") {
      return {
        format: bestAudio,
        targetContainer: "mp3",
        targetBitrateKbps: 128,
        needsMerge: true,
        actualQuality: "MP3 128 kbps",
      };
    }
    if (preset === "m4a") {
      return {
        format: bestAudio,
        targetContainer: "m4a",
        targetBitrateKbps: 192,
        needsMerge: true,
        actualQuality: "M4A (AAC)",
      };
    }
    if (preset === "opus") {
      return {
        format: bestAudio,
        targetContainer: "opus",
        targetBitrateKbps: 160,
        needsMerge: true,
        actualQuality: "Opus",
      };
    }
    if (preset === "flac") {
      return {
        format: bestAudio,
        targetContainer: "flac",
        targetBitrateKbps: null,
        needsMerge: true,
        actualQuality: "FLAC (Lossless)",
      };
    }
    if (preset === "wav") {
      return {
        format: bestAudio,
        targetContainer: "wav",
        targetBitrateKbps: null,
        needsMerge: true,
        actualQuality: "WAV",
      };
    }

    return {
      format: bestAudio,
      targetContainer: preferredContainer || bestAudio?.container || "m4a",
      targetBitrateKbps: bestAudio?.bitrateKbps
        ? Math.round(bestAudio.bitrateKbps)
        : null,
      needsMerge: false,
      actualQuality: `Best Audio (${bestAudio?.bitrateKbps ? Math.round(bestAudio.bitrateKbps) + "k" : bestAudio?.container || "audio"})`,
    };
  }

  const videoFormats = formats
    .filter((f) => f.kind === "video")
    .sort((a, b) => {
      const hDiff = (b.height ?? 0) - (a.height ?? 0);
      if (hDiff !== 0) return hDiff;
      return (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0);
    });

  if (videoFormats.length === 0) {
    return {
      format: null,
      targetContainer: preferredContainer || "mp4",
      needsMerge: false,
      actualQuality: "Unknown",
    };
  }

  let targetHeight: number | null = null;
  if (preset === "1080p") targetHeight = 1080;
  else if (preset === "720p") targetHeight = 720;
  else if (preset === "480p") targetHeight = 480;

  let selectedFormat: FormatRow | null = null;

  if (targetHeight === null || preset === "best_video" || preset === "best") {
    selectedFormat = videoFormats[0] ?? null;
  } else {
    selectedFormat = videoFormats.find((f) => f.height === targetHeight) ?? null;

    if (!selectedFormat) {
      selectedFormat =
        videoFormats.find((f) => f.height !== null && f.height! < targetHeight) ?? null;
    }

    if (!selectedFormat) {
      selectedFormat = videoFormats[videoFormats.length - 1] ?? null;
    }
  }

  if (!selectedFormat) {
    selectedFormat = videoFormats[0] ?? null;
  }

  if (!selectedFormat) {
    return {
      format: null,
      targetContainer: preferredContainer || "mp4",
      needsMerge: false,
      actualQuality: "Unknown",
    };
  }

  const container =
    preferredContainer || (selectedFormat.container === "webm" ? "webm" : "mp4");
  const needsMerge = selectedFormat.acodec === null;
  const actualQuality = `${selectedFormat.resolution || (selectedFormat.height ? selectedFormat.height + "p" : "video")}`;

  return {
    format: selectedFormat,
    targetContainer: container,
    needsMerge,
    actualQuality,
  };
}
