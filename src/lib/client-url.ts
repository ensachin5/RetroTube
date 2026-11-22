const ALLOWED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const HAS_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export type ClientUrlValidationResult =
  | {
      ok: true;
      youtubeId: string;
      canonicalUrl: string;
      hadPlaylistParam: boolean;
    }
  | {
      ok: false;
      code: "INVALID_URL" | "PLAYLIST_NOT_SUPPORTED";
      message: string;
    };

export function validateYouTubeUrlClient(rawInput: string): ClientUrlValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 2048) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Paste a YouTube video URL to get started.",
    };
  }

  let candidate = trimmed;
  if (!HAS_SCHEME_REGEX.test(trimmed)) {
    const firstSlash = trimmed.indexOf("/");
    const hostPart = (
      firstSlash === -1 ? trimmed : trimmed.slice(0, firstSlash)
    ).toLowerCase();
    if (!ALLOWED_YOUTUBE_HOSTS.has(hostPart)) {
      return {
        ok: false,
        code: "INVALID_URL",
        message:
          "Only YouTube links are supported (youtube.com, youtu.be, Shorts, or music.youtube.com).",
      };
    }
    candidate = `https://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "That link does not look like a valid URL.",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Only HTTP and HTTPS YouTube links are allowed.",
    };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "URLs with embedded credentials are not allowed.",
    };
  }

  if (
    parsed.port !== "" &&
    !(parsed.protocol === "https:" && parsed.port === "443") &&
    !(parsed.protocol === "http:" && parsed.port === "80")
  ) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Non-standard ports are not allowed in YouTube URLs.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return {
      ok: false,
      code: "INVALID_URL",
      message:
        "Unsupported domain. Use youtube.com, youtu.be, m.youtube.com, or music.youtube.com.",
    };
  }

  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  let videoId: string | null = null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    const seg = segments[0];
    if (seg && YOUTUBE_ID_REGEX.test(seg)) videoId = seg;
  } else if (parsed.pathname === "/watch" || parsed.pathname === "/watch/") {
    const v = parsed.searchParams.get("v");
    if (v && YOUTUBE_ID_REGEX.test(v)) videoId = v;
  } else if (segments.length >= 2) {
    const [prefix, seg] = segments;
    if (
      (prefix === "shorts" ||
        prefix === "live" ||
        prefix === "embed" ||
        prefix === "v") &&
      seg &&
      YOUTUBE_ID_REGEX.test(seg)
    ) {
      videoId = seg;
    }
  } else if (segments.length === 0) {
    const v = parsed.searchParams.get("v");
    if (v && YOUTUBE_ID_REGEX.test(v)) videoId = v;
  }

  const hasListParam =
    parsed.searchParams.has("list") &&
    (parsed.searchParams.get("list") ?? "").trim().length > 0;
  const isPlaylistPath =
    parsed.pathname === "/playlist" ||
    parsed.pathname.startsWith("/playlist/") ||
    parsed.pathname === "/watch_videos";

  if (isPlaylistPath || (hasListParam && !videoId)) {
    return {
      ok: false,
      code: "PLAYLIST_NOT_SUPPORTED",
      message: "Playlist URLs are not supported in v1. Please pick a single video URL.",
    };
  }

  if (!videoId) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Could not find a valid 11-character YouTube video ID in that URL.",
    };
  }

  const canonicalHost =
    host === "music.youtube.com" ? "music.youtube.com" : "www.youtube.com";

  return {
    ok: true,
    youtubeId: videoId,
    canonicalUrl: `https://${canonicalHost}/watch?v=${videoId}`,
    hadPlaylistParam: hasListParam,
  };
}

export function extractShareUrlParam(url?: string, text?: string): string {
  const candidates = [url, text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = /https?:\/\/[^\s<>"']+/i.exec(candidate.trim());
    if (match) {
      return match[0].replace(/[),.;!?]+$/, "");
    }
    if (candidate.trim().length > 0) return candidate.trim();
  }
  return "";
}
