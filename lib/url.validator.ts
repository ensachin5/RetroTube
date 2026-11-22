import { AppError, ERROR_CODES } from "./errors";

export const ALLOWED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_REGEX = /^[A-Za-z0-9_-]{2,64}$/;
const HAS_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export type YouTubeUrlType = "video" | "playlist" | "combined";

export interface ParsedYouTubeUrl {
  type: YouTubeUrlType;
  videoId?: string;
  playlistId?: string;
  canonicalUrl: string;
  canonicalVideoUrl?: string;
  canonicalPlaylistUrl?: string;
  hostname: string;
  isShorts: boolean;
  isMusic: boolean;
}

export interface ValidatedYouTubeUrl {
  youtubeId: string;
  canonicalUrl: string;
  hostname: string;
  isShorts: boolean;
  isMusic: boolean;
  hadPlaylistParam: boolean;
  playlistId?: string;
}

function normalizeInputUrl(rawInput: string): URL {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new AppError({
      code: ERROR_CODES.INVALID_URL,
      status: 400,
      message: "Please enter a valid YouTube link.",
    });
  }

  let candidate = trimmed;
  if (!HAS_SCHEME_REGEX.test(trimmed)) {
    const firstSlash = trimmed.indexOf("/");
    const hostPart = (
      firstSlash === -1 ? trimmed : trimmed.slice(0, firstSlash)
    ).toLowerCase();
    if (!ALLOWED_YOUTUBE_HOSTS.has(hostPart)) {
      throw new AppError({
        code: ERROR_CODES.INVALID_URL,
        status: 400,
        message:
          "Please enter a valid YouTube URL (youtube.com, youtu.be, shorts, or music.youtube.com).",
      });
    }
    candidate = `https://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new AppError({
      code: ERROR_CODES.INVALID_URL,
      status: 400,
      message: "The URL format could not be parsed.",
    });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AppError({
      code: ERROR_CODES.INVALID_URL,
      status: 400,
      message: "Only HTTP and HTTPS YouTube URLs are allowed.",
    });
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new AppError({
      code: ERROR_CODES.INVALID_URL,
      status: 400,
      message: "URLs containing embedded credentials are not allowed.",
    });
  }

  if (
    parsed.port !== "" &&
    !(parsed.protocol === "https:" && parsed.port === "443") &&
    !(parsed.protocol === "http:" && parsed.port === "80")
  ) {
    throw new AppError({
      code: ERROR_CODES.INVALID_URL,
      status: 400,
      message: "Non-standard ports are not allowed in YouTube URLs.",
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    throw new AppError({
      code: ERROR_CODES.INVALID_URL,
      status: 400,
      message:
        "Unsupported host. Only youtube.com, youtu.be, m.youtube.com, and music.youtube.com links are allowed.",
    });
  }

  return parsed;
}

function extractVideoIdFromUrl(url: URL): {
  videoId: string | null;
  isShorts: boolean;
} {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((s) => s.length > 0);

  if (host === "youtu.be" || host === "www.youtu.be") {
    const candidate = segments[0] ?? null;
    if (candidate && YOUTUBE_ID_REGEX.test(candidate)) {
      return { videoId: candidate, isShorts: false };
    }
    return { videoId: null, isShorts: false };
  }

  if (url.pathname === "/watch" || url.pathname === "/watch/") {
    const v = url.searchParams.get("v");
    if (v && YOUTUBE_ID_REGEX.test(v)) {
      return { videoId: v, isShorts: false };
    }
    return { videoId: null, isShorts: false };
  }

  if (segments.length >= 2) {
    const prefix = segments[0];
    const candidate = segments[1];
    if (
      (prefix === "shorts" ||
        prefix === "live" ||
        prefix === "embed" ||
        prefix === "v") &&
      candidate &&
      YOUTUBE_ID_REGEX.test(candidate)
    ) {
      return { videoId: candidate, isShorts: prefix === "shorts" };
    }
  }

  if (segments.length === 0) {
    const v = url.searchParams.get("v");
    if (v && YOUTUBE_ID_REGEX.test(v)) {
      return { videoId: v, isShorts: false };
    }
  }

  return { videoId: null, isShorts: false };
}

function extractPlaylistIdFromUrl(url: URL): string | null {
  const list = url.searchParams.get("list");
  if (list && PLAYLIST_ID_REGEX.test(list)) {
    return list;
  }
  return null;
}

export function parseYouTubeUrl(rawInput: string): ParsedYouTubeUrl {
  const parsed = normalizeInputUrl(rawInput);
  const host = parsed.hostname.toLowerCase();
  const isMusic = host === "music.youtube.com";
  const { videoId, isShorts } = extractVideoIdFromUrl(parsed);
  const playlistId = extractPlaylistIdFromUrl(parsed);

  const canonicalHost = isMusic ? "music.youtube.com" : "www.youtube.com";
  const canonicalVideoUrl = videoId
    ? `https://${canonicalHost}/watch?v=${videoId}`
    : undefined;
  const canonicalPlaylistUrl = playlistId
    ? `https://${canonicalHost}/playlist?list=${playlistId}`
    : undefined;

  const isPlaylistPath =
    parsed.pathname === "/playlist" ||
    parsed.pathname.startsWith("/playlist/") ||
    parsed.pathname === "/watch_videos";

  if (videoId && playlistId && !isPlaylistPath) {
    return {
      type: "combined",
      videoId,
      playlistId,
      canonicalUrl: `https://${canonicalHost}/watch?v=${videoId}&list=${playlistId}`,
      canonicalVideoUrl,
      canonicalPlaylistUrl,
      hostname: host,
      isShorts,
      isMusic,
    };
  }

  if (playlistId || isPlaylistPath) {
    return {
      type: "playlist",
      playlistId: playlistId ?? "watch_videos",
      canonicalUrl: canonicalPlaylistUrl ?? rawInput,
      canonicalPlaylistUrl: canonicalPlaylistUrl ?? rawInput,
      hostname: host,
      isShorts: false,
      isMusic,
    };
  }

  if (videoId) {
    return {
      type: "video",
      videoId,
      canonicalUrl: canonicalVideoUrl!,
      canonicalVideoUrl,
      hostname: host,
      isShorts,
      isMusic,
    };
  }

  throw new AppError({
    code: ERROR_CODES.INVALID_URL,
    status: 400,
    message: "Could not find a valid YouTube video ID or playlist ID in that URL.",
  });
}

export function validateAndParseYouTubeUrl(rawInput: string): ValidatedYouTubeUrl {
  const parsed = parseYouTubeUrl(rawInput);

  if (parsed.type === "playlist") {
    throw new AppError({
      code: ERROR_CODES.PLAYLIST_NOT_SUPPORTED,
      status: 400,
      message:
        "Playlist URLs are not supported on this endpoint. Please use the playlist fetch endpoint.",
    });
  }

  if (!parsed.videoId) {
    throw new AppError({
      code: ERROR_CODES.INVALID_URL,
      status: 400,
      message: "Could not find a valid 11-character YouTube video ID in that URL.",
    });
  }

  return {
    youtubeId: parsed.videoId,
    canonicalUrl: parsed.canonicalVideoUrl ?? parsed.canonicalUrl,
    hostname: parsed.hostname,
    isShorts: parsed.isShorts,
    isMusic: parsed.isMusic,
    hadPlaylistParam: Boolean(parsed.playlistId),
    playlistId: parsed.playlistId,
  };
}
