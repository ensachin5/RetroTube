import { getEnv } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { validateAndParseYouTubeUrl } from "@/lib/url.validator";
import { formatsRepo } from "@/repositories/formats.repo";
import { videosRepo } from "@/repositories/videos.repo";
import {
  formatRowsToPresentation,
  normalizeYtDlpMetadata,
  type FetchVideoResponseDto,
} from "./format.normalizer";
import { ytdlpService } from "./ytdlp.service";

const inFlightFetches = new Map<string, Promise<FetchVideoResponseDto>>();

export const fetchService = {
  async fetchMetadata(rawUrl: string, requestId: string): Promise<FetchVideoResponseDto> {
    const parsedUrl = validateAndParseYouTubeUrl(rawUrl);
    const env = getEnv();
    const now = Date.now();
    const ttlMs = env.CACHE_TTL_SECONDS * 1000;

    const existingVideo = videosRepo.findByYoutubeId(parsedUrl.youtubeId);
    if (existingVideo && ttlMs > 0 && now - existingVideo.fetchedAt < ttlMs) {
      const cachedFormats = formatsRepo.listByVideoId(existingVideo.id);
      if (cachedFormats.length > 0) {
        logger.info("Served video metadata from SQLite cache", {
          requestId,
          youtubeId: parsedUrl.youtubeId,
          videoId: existingVideo.id,
        });
        return formatRowsToPresentation(existingVideo, cachedFormats, {
          cached: true,
          hadPlaylistParam: parsedUrl.hadPlaylistParam,
        });
      }
    }

    const inFlight = inFlightFetches.get(parsedUrl.youtubeId);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = (async () => {
      const rawInfo = await ytdlpService.inspectVideo(parsedUrl.canonicalUrl);
      const normalized = normalizeYtDlpMetadata(parsedUrl.youtubeId, rawInfo);

      const maxDurationSec = env.MAX_VIDEO_MINUTES * 60;
      if (normalized.video.durationSec > maxDurationSec) {
        throw new AppError({
          code: ERROR_CODES.VIDEO_TOO_LONG,
          status: 422,
          message: `This video is ${Math.ceil(normalized.video.durationSec / 60)} minutes long, exceeding the ${env.MAX_VIDEO_MINUTES}-minute limit.`,
          details: {
            durationSec: normalized.video.durationSec,
            maxMinutes: env.MAX_VIDEO_MINUTES,
          },
        });
      }

      const savedVideo = videosRepo.upsert({
        ...normalized.video,
        fetchedAt: Date.now(),
      });
      const savedFormats = formatsRepo.replaceForVideo(savedVideo.id, normalized.formats);

      logger.info("Fetched and cached fresh video metadata", {
        requestId,
        youtubeId: savedVideo.youtubeId,
        videoId: savedVideo.id,
        formatCount: savedFormats.length,
      });

      return formatRowsToPresentation(savedVideo, savedFormats, {
        cached: false,
        hadPlaylistParam: parsedUrl.hadPlaylistParam,
      });
    })();

    inFlightFetches.set(parsedUrl.youtubeId, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      inFlightFetches.delete(parsedUrl.youtubeId);
    }
  },
};
