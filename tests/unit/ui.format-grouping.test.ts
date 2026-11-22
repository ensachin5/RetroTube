import { describe, expect, it } from "vitest";
import { extractShareUrlParam } from "@/src/lib/client-url";
import {
  formatBytes,
  formatDuration,
  formatUploadDate,
  getFriendlyErrorCopy,
  groupAudioFormatsByCodec,
  groupVideoFormatsByResolution,
  shortCodecName,
} from "@/src/lib/format-grouping";
import type {
  NormalizedAudioFormatDto,
  NormalizedVideoFormatDto,
} from "@/services/format.normalizer";

describe("format-grouping & UI format helpers", () => {
  it("groups video formats by resolution descending and highlights Best Quality", () => {
    const videos: NormalizedVideoFormatDto[] = [
      {
        id: 1,
        formatId: "571",
        kind: "video",
        container: "mp4",
        vcodec: "av01.0.17M.10",
        acodec: null,
        resolution: "4320p",
        width: 7680,
        height: 4320,
        fps: 60,
        bitrateKbps: 32000,
        filesizeBytes: 720000000,
        isHdr: true,
        needsAudioMerge: true,
        recommendedContainer: "mp4",
        formatNote: "4320p60 HDR",
      },
      {
        id: 2,
        formatId: "299",
        kind: "video",
        container: "mp4",
        vcodec: "avc1.64002A",
        acodec: null,
        resolution: "1080p",
        width: 1920,
        height: 1080,
        fps: 60,
        bitrateKbps: 5400,
        filesizeBytes: 121500000,
        isHdr: false,
        needsAudioMerge: true,
        recommendedContainer: "mp4",
        formatNote: "1080p60",
      },
      {
        id: 3,
        formatId: "248",
        kind: "video",
        container: "webm",
        vcodec: "vp9",
        acodec: null,
        resolution: "1080p",
        width: 1920,
        height: 1080,
        fps: 30,
        bitrateKbps: 2800,
        filesizeBytes: 63000000,
        isHdr: false,
        needsAudioMerge: true,
        recommendedContainer: "webm",
        formatNote: "1080p",
      },
    ];

    const grouped = groupVideoFormatsByResolution(videos);
    expect(grouped.bestFormatId).toBe(1);
    expect(grouped.groups.map((g) => g.key)).toEqual(["4320p", "1080p"]);
    expect(grouped.groups[1]?.formats).toHaveLength(2);
  });

  it("groups audio formats by codec and picks highest bitrate as Best Quality", () => {
    const audios: NormalizedAudioFormatDto[] = [
      {
        id: 10,
        formatId: "140",
        kind: "audio",
        container: "m4a",
        vcodec: null,
        acodec: "mp4a.40.2",
        bitrateKbps: 128,
        filesizeBytes: 2880000,
        formatNote: "medium",
      },
      {
        id: 11,
        formatId: "251",
        kind: "audio",
        container: "webm",
        vcodec: null,
        acodec: "opus",
        bitrateKbps: 160,
        filesizeBytes: 3600000,
        formatNote: "medium",
      },
    ];

    const grouped = groupAudioFormatsByCodec(audios);
    expect(grouped.bestFormatId).toBe(11);
    expect(grouped.groups.map((g) => g.key)).toEqual(["Opus-WEBM", "AAC-M4A"]);
  });

  it("formats duration, bytes, dates, codecs, share params, and error copies", () => {
    expect(formatDuration(213)).toBe("3:33");
    expect(formatDuration(3665)).toBe("1:01:05");
    expect(formatBytes(1024 * 1024 * 12.5)).toBe("12.5 MB");
    expect(formatUploadDate("2025-04-12")).toBe("Apr 12, 2025");
    expect(shortCodecName("av01.0.17M.10")).toBe("AV1");
    expect(shortCodecName("avc1.64002A")).toBe("H.264");
    expect(
      extractShareUrlParam(undefined, "Watch this: https://youtu.be/dQw4w9WgXcQ."),
    ).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(
      extractShareUrlParam("https://www.youtube.com/shorts/abcdefghijk", "Ignored"),
    ).toBe("https://www.youtube.com/shorts/abcdefghijk");
    expect(getFriendlyErrorCopy("LIVE_STREAM").title).toBe("Live Broadcast Active");
    expect(getFriendlyErrorCopy("RATE_LIMITED").retryable).toBe(true);
  });
});
