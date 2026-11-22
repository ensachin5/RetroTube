import type {
  NormalizedAudioFormatDto,
  NormalizedVideoFormatDto,
} from "@/services/format.normalizer";

export interface VideoResolutionGroup {
  key: string;
  label: string;
  heightScore: number;
  formats: NormalizedVideoFormatDto[];
}

export interface AudioCodecGroup {
  key: string;
  label: string;
  formats: NormalizedAudioFormatDto[];
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "Est. —";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = idx >= 2 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[idx]}`;
}

export function formatUploadDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "Unknown date";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function shortCodecName(codec: string | null | undefined): string {
  if (!codec) return "—";
  const lower = codec.toLowerCase();
  if (lower.startsWith("av01")) return "AV1";
  if (lower.startsWith("vp9") || lower.startsWith("vp09")) return "VP9";
  if (lower.startsWith("vp8")) return "VP8";
  if (lower.startsWith("avc1") || lower.includes("h264")) return "H.264";
  if (lower.startsWith("hev1") || lower.startsWith("hvc1")) return "HEVC";
  if (lower.startsWith("mp4a")) return "AAC";
  if (lower.includes("opus")) return "Opus";
  if (lower.includes("vorbis")) return "Vorbis";
  const dot = codec.indexOf(".");
  return (dot === -1 ? codec : codec.slice(0, dot)).toUpperCase();
}

function resolutionGroupMeta(format: NormalizedVideoFormatDto): {
  key: string;
  label: string;
  heightScore: number;
} {
  const height = format.height ?? 0;
  if (height >= 4320)
    return { key: "4320p", label: "4320p · 8K Ultra HD", heightScore: 4320 };
  if (height >= 2160) return { key: "2160p", label: "2160p · 4K UHD", heightScore: 2160 };
  if (height >= 1440) return { key: "1440p", label: "1440p · QHD", heightScore: 1440 };
  if (height >= 1080)
    return { key: "1080p", label: "1080p · Full HD", heightScore: 1080 };
  if (height >= 720) return { key: "720p", label: "720p · HD", heightScore: 720 };
  if (height >= 480) return { key: "480p", label: "480p · SD", heightScore: 480 };
  if (height >= 360) return { key: "360p", label: "360p", heightScore: 360 };
  if (height >= 240) return { key: "240p", label: "240p", heightScore: 240 };
  if (height > 0) return { key: `${height}p`, label: `${height}p`, heightScore: height };

  const fallback = format.resolution ?? "Other";
  return { key: fallback, label: fallback, heightScore: 0 };
}

export function groupVideoFormatsByResolution(formats: NormalizedVideoFormatDto[]): {
  groups: VideoResolutionGroup[];
  bestFormatId: number | null;
} {
  if (formats.length === 0) {
    return { groups: [], bestFormatId: null };
  }

  const groupMap = new Map<string, VideoResolutionGroup>();
  for (const format of formats) {
    const meta = resolutionGroupMeta(format);
    const existing = groupMap.get(meta.key);
    if (existing) {
      existing.formats.push(format);
    } else {
      groupMap.set(meta.key, {
        key: meta.key,
        label: meta.label,
        heightScore: meta.heightScore,
        formats: [format],
      });
    }
  }

  const groups = Array.from(groupMap.values()).sort(
    (a, b) => b.heightScore - a.heightScore,
  );

  // Best quality = first format of the highest resolution group (already sorted best-first by normalizer)
  const bestFormatId = groups[0]?.formats[0]?.id ?? null;

  return { groups, bestFormatId };
}

export function groupAudioFormatsByCodec(formats: NormalizedAudioFormatDto[]): {
  groups: AudioCodecGroup[];
  bestFormatId: number | null;
} {
  if (formats.length === 0) {
    return { groups: [], bestFormatId: null };
  }

  const groupMap = new Map<string, AudioCodecGroup>();
  for (const format of formats) {
    const codec = shortCodecName(format.acodec);
    const key = `${codec}-${format.container.toUpperCase()}`;
    const label = `${codec} (${format.container.toUpperCase()})`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.formats.push(format);
    } else {
      groupMap.set(key, {
        key,
        label,
        formats: [format],
      });
    }
  }

  // Sort groups by highest bitrate available in each group
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const aMax = Math.max(...a.formats.map((f) => f.bitrateKbps ?? 0));
    const bMax = Math.max(...b.formats.map((f) => f.bitrateKbps ?? 0));
    return bMax - aMax;
  });

  // Highest bitrate stream overall
  const sortedAll = [...formats].sort(
    (a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0),
  );
  const bestFormatId = sortedAll[0]?.id ?? null;

  return { groups, bestFormatId };
}

export interface FriendlyErrorCopy {
  title: string;
  message: string;
  retryable: boolean;
}

const ERROR_COPY_MAP: Record<string, FriendlyErrorCopy> = {
  INVALID_URL: {
    title: "Invalid YouTube Link",
    message:
      "Please paste a valid YouTube link from youtube.com, youtu.be, Shorts, or music.youtube.com.",
    retryable: false,
  },
  PLAYLIST_NOT_SUPPORTED: {
    title: "Playlist Detected (v1 Single Video Only)",
    message:
      "Playlist URLs are not supported yet. Please pick a single video link instead.",
    retryable: false,
  },
  PRIVATE_VIDEO: {
    title: "Private Tape",
    message: "This video is private and cannot be read without creator access.",
    retryable: false,
  },
  AGE_RESTRICTED: {
    title: "Age-Restricted Video",
    message: "YouTube requires an authenticated session to access age-restricted videos.",
    retryable: false,
  },
  GEO_BLOCKED: {
    title: "Region Restricted",
    message: "This video is blocked in the server's region.",
    retryable: false,
  },
  LIVE_STREAM: {
    title: "Live Broadcast Active",
    message:
      "Active live streams and upcoming premieres cannot be downloaded until they finish.",
    retryable: false,
  },
  VIDEO_UNAVAILABLE: {
    title: "Tape Unavailable",
    message: "This video has been removed or is no longer available on YouTube.",
    retryable: false,
  },
  VIDEO_TOO_LONG: {
    title: "Duration Limit Exceeded",
    message: "This video exceeds the server's maximum configured length limit.",
    retryable: false,
  },
  RATE_LIMITED: {
    title: "Signal Throttled",
    message: "Too many requests right now. Wait a short moment and try fetching again.",
    retryable: true,
  },
  QUEUE_FULL: {
    title: "Tape Deck Busy",
    message:
      "Too many concurrent jobs are queued right now. Wait for one to finish and retry.",
    retryable: true,
  },
  TIMEOUT: {
    title: "Signal Timed Out",
    message: "The extractor took too long to respond. Retry the request.",
    retryable: true,
  },
  YTDLP_FAILED: {
    title: "Extractor Failure",
    message: "yt-dlp could not read or download this video.",
    retryable: true,
  },
  FFMPEG_FAILED: {
    title: "Mux / Encode Error",
    message: "ffmpeg failed while splicing or converting the media streams.",
    retryable: true,
  },
  SERVER_RESTART: {
    title: "Deck Restarted",
    message: "The server restarted while this job was active. Please retry.",
    retryable: true,
  },
  FILE_EXPIRED: {
    title: "Tape Expired",
    message:
      "The temporary file has expired from storage. Re-download to fetch it again.",
    retryable: true,
  },
  UNAUTHORIZED: {
    title: "Deck Locked",
    message: "This instance requires the APP_PASSWORD unlock cookie.",
    retryable: false,
  },
  JOB_CANCELLED: {
    title: "Download Cancelled",
    message: "The tape job was ejected before completion.",
    retryable: true,
  },
};

export function getFriendlyErrorCopy(
  code?: string | null,
  serverMessage?: string | null,
): FriendlyErrorCopy {
  const normalizedCode = (code ?? "INTERNAL_ERROR").toUpperCase();
  const mapped = ERROR_COPY_MAP[normalizedCode];
  if (mapped) {
    return {
      title: mapped.title,
      message: serverMessage?.trim() || mapped.message,
      retryable: mapped.retryable,
    };
  }
  return {
    title: "Unexpected Signal Error",
    message:
      serverMessage?.trim() || "Something went wrong on the server. Please try again.",
    retryable: true,
  };
}
