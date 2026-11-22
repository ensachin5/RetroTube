import { getEnv } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { parseYouTubeUrl } from "@/lib/url.validator";
import {
  type RawYtDlpPlaylistEntry,
  ytdlpService,
} from "./ytdlp.service";

export interface PlaylistItemDTO {
  position: number;
  youtubeId: string;
  title: string;
  durationSec: number;
  thumbnailUrl: string;
  isAvailable: boolean;
  unavailableReason?: string;
}

export interface PlaylistDTO {
  id: string;
  title: string;
  channel: string;
  itemCount: number;
  totalDurationSec: number;
  items: PlaylistItemDTO[];
}

export interface PlaylistFetchResult {
  isCombined: boolean;
  videoId?: string;
  playlistId: string;
  playlist?: PlaylistDTO;
  prompt?: string;
}

function resolveThumbnail(
  entry: RawYtDlpPlaylistEntry,
  youtubeId: string,
): string {
  if (entry.thumbnails && entry.thumbnails.length > 0) {
    const last = entry.thumbnails[entry.thumbnails.length - 1];
    if (last?.url) return last.url;
  }
  if (entry.thumbnail) {
    return entry.thumbnail;
  }
  return youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : "";
}

function isEntryUnavailable(entry: RawYtDlpPlaylistEntry | null): {
  unavailable: boolean;
  reason?: string;
} {
  if (!entry) {
    return { unavailable: true, reason: "Entry is missing or removed" };
  }
  const title = (entry.title ?? "").trim().toLowerCase();
  if (title === "[deleted video]" || title.includes("deleted video")) {
    return { unavailable: true, reason: "Video was deleted by uploader" };
  }
  if (title === "[private video]" || title.includes("private video")) {
    return { unavailable: true, reason: "Video is private" };
  }
  if (entry.availability === "private") {
    return { unavailable: true, reason: "Video is private" };
  }
  if (entry.availability === "subscriber_only") {
    return { unavailable: true, reason: "Video is members-only" };
  }
  if (!entry.id) {
    return { unavailable: true, reason: "Video identifier unavailable" };
  }
  return { unavailable: false };
}

export const playlistService = {
  async fetchPlaylistMetadata(
    rawUrl: string,
    options?: { forcePlaylist?: boolean; limit?: number },
    signal?: AbortSignal,
  ): Promise<PlaylistFetchResult> {
    const parsedUrl = parseYouTubeUrl(rawUrl);
    const env = getEnv();

    if (parsedUrl.type === "combined" && !options?.forcePlaylist) {
      return {
        isCombined: true,
        videoId: parsedUrl.videoId,
        playlistId: parsedUrl.playlistId!,
        prompt:
          "This link contains both a single video and a playlist. Choose whether to load the single video or the full playlist.",
      };
    }

    const playlistId = parsedUrl.playlistId;
    if (!playlistId) {
      throw new AppError({
        code: ERROR_CODES.INVALID_URL,
        status: 400,
        message: "No playlist ID was found in the provided URL.",
      });
    }

    const isMixOrRadio = playlistId.startsWith("RD") || playlistId.startsWith("UL");
    const canonicalPlaylistUrl =
      (parsedUrl.type === "combined" || isMixOrRadio) && parsedUrl.videoId
        ? `https://${parsedUrl.hostname === "music.youtube.com" ? "music.youtube.com" : "www.youtube.com"}/watch?v=${parsedUrl.videoId}&list=${playlistId}`
        : (parsedUrl.canonicalPlaylistUrl ??
          `https://www.youtube.com/playlist?list=${playlistId}`);

    const rawData = await ytdlpService.inspectPlaylistFlat(
      canonicalPlaylistUrl,
      signal,
    );

    if (!rawData || typeof rawData !== "object") {
      throw new AppError({
        code: ERROR_CODES.PLAYLIST_EMPTY,
        status: 404,
        message: "Could not retrieve playlist metadata. The playlist may be empty or unavailable.",
      });
    }

    const rawEntries = Array.isArray(rawData.entries) ? rawData.entries : [];

    if (rawEntries.length === 0) {
      if (isMixOrRadio) {
        throw new AppError({
          code: ERROR_CODES.PLAYLIST_EMPTY,
          status: 422,
          message:
            "This playlist is a YouTube Mix / Radio which cannot be fetched as a batch playlist. You can still download individual videos.",
        });
      }
      throw new AppError({
        code: ERROR_CODES.PLAYLIST_EMPTY,
        status: 422,
        message: "This playlist does not contain any videos or is unavailable.",
      });
    }

    const cap = env.MAX_PLAYLIST_ITEMS;
    if (
      !options?.limit &&
      rawEntries.length > cap &&
      options?.limit === undefined
    ) {
      throw new AppError({
        code: ERROR_CODES.PLAYLIST_TOO_LARGE,
        status: 422,
        message: `Playlist contains ${rawEntries.length} items, which exceeds the maximum limit of ${cap}.`,
        details: {
          totalItems: rawEntries.length,
          maxAllowed: cap,
        },
      });
    }

    const effectiveEntries = options?.limit
      ? rawEntries.slice(0, options.limit)
      : rawEntries.slice(0, cap);

    let totalDurationSec = 0;
    const items: PlaylistItemDTO[] = [];

    for (let i = 0; i < effectiveEntries.length; i++) {
      const entry = effectiveEntries[i];
      const position = i + 1;
      const { unavailable, reason } = isEntryUnavailable(entry ?? null);

      if (!entry || unavailable) {
        items.push({
          position,
          youtubeId: entry?.id ?? `unavailable-${position}`,
          title: entry?.title?.trim() || `[Unavailable Video #${position}]`,
          durationSec: 0,
          thumbnailUrl: "",
          isAvailable: false,
          unavailableReason: reason ?? "Video is unavailable",
        });
        continue;
      }

      const durationSec = Math.max(0, Math.floor(entry.duration ?? 0));
      totalDurationSec += durationSec;
      const youtubeId = entry.id!;
      const thumbnailUrl = resolveThumbnail(entry, youtubeId);

      items.push({
        position,
        youtubeId,
        title: entry.title?.trim() || `Track ${position}`,
        durationSec,
        thumbnailUrl,
        isAvailable: true,
      });
    }

    const title = rawData.title?.trim() || "Untitled Playlist";
    const channel =
      rawData.channel?.trim() ||
      rawData.uploader?.trim() ||
      "Unknown Curator";

    return {
      isCombined: false,
      playlistId,
      playlist: {
        id: playlistId,
        title,
        channel,
        itemCount: items.length,
        totalDurationSec,
        items,
      },
    };
  },
};
