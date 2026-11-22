import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FormatRow, VideoRow } from "@/db/schema";
import {
  AUDIO_CONVERSION_PRESETS,
  formatRowsToPresentation,
  normalizeYtDlpMetadata,
  type RawYtDlpInfo,
} from "@/services/format.normalizer";

function loadSampleFixture(): RawYtDlpInfo {
  const fixturePath = path.resolve(process.cwd(), "tests/fixtures/ytdlp-sample.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as RawYtDlpInfo;
}

describe("format.normalizer", () => {
  it("normalizes metadata, filters storyboards, dedupes format_ids, and detects HDR + bitrate filesize estimates", () => {
    const raw = loadSampleFixture();
    const result = normalizeYtDlpMetadata("dQw4w9WgXcQ", raw);

    expect(result.video).toEqual({
      youtubeId: "dQw4w9WgXcQ",
      title: "RetroTube Test Video: 8K / HDR / Synthwave",
      channel: "Retro Channel",
      durationSec: 180,
      uploadDate: "2025-04-12",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    });

    // sb0 storyboard excluded; duplicate 299 deduped -> 7 unique formats
    expect(result.formats).toHaveLength(7);
    expect(result.formats.find((f) => f.formatId === "sb0")).toBeUndefined();

    const f299 = result.formats.filter((f) => f.formatId === "299");
    expect(f299).toHaveLength(1);
    expect(f299[0]?.filesizeBytes).toBe(121500000);

    // Format 337 had no filesize/filesize_approx, so estimated from tbr=18000 kbps & 180s
    const f337 = result.formats.find((f) => f.formatId === "337");
    expect(f337).toMatchObject({
      kind: "video",
      resolution: "2160p",
      fps: 60,
      isHdr: true,
      acodec: null,
      filesizeBytes: Math.round((18000 * 1000 * 180) / 8),
    });

    const f571 = result.formats.find((f) => f.formatId === "571");
    expect(f571).toMatchObject({
      resolution: "4320p",
      isHdr: true,
      acodec: null,
    });

    const f22 = result.formats.find((f) => f.formatId === "22");
    expect(f22).toMatchObject({
      resolution: "720p",
      acodec: "mp4a.40.2",
      isHdr: false,
    });
  });

  it("sorts video/audio by quality descending, flags needsAudioMerge, and exposes conversion targets", () => {
    const raw = loadSampleFixture();
    const { video, formats } = normalizeYtDlpMetadata("dQw4w9WgXcQ", raw);

    const videoRow: VideoRow = {
      id: 1,
      ...video,
      fetchedAt: 1731331200000,
    };

    const formatRows: FormatRow[] = formats.map((item, index) => ({
      id: index + 1,
      videoId: 1,
      formatId: item.formatId,
      kind: item.kind,
      container: item.container,
      vcodec: item.vcodec ?? null,
      acodec: item.acodec ?? null,
      resolution: item.resolution ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      fps: item.fps ?? null,
      bitrateKbps: item.bitrateKbps ?? null,
      filesizeBytes: item.filesizeBytes ?? null,
      isHdr: item.isHdr ?? false,
      formatNote: item.formatNote ?? null,
    }));

    const presentation = formatRowsToPresentation(videoRow, formatRows, {
      cached: false,
    });

    expect(presentation.videoFormats.map((f) => f.formatId)).toEqual([
      "571", // 4320p
      "337", // 2160p
      "299", // 1080p60
      "22", // 720p
      "18", // 360p
    ]);

    expect(presentation.videoFormats[0]?.needsAudioMerge).toBe(true);
    expect(presentation.videoFormats[3]?.needsAudioMerge).toBe(false);

    expect(presentation.audioFormats.map((f) => f.formatId)).toEqual([
      "251", // 160 kbps opus
      "140", // 128 kbps m4a
    ]);

    expect(presentation.audioConversions).toEqual(AUDIO_CONVERSION_PRESETS);
    expect(presentation.audioConversions.map((c) => c.id)).toEqual([
      "mp3-128",
      "mp3-192",
      "mp3-320",
      "m4a",
      "opus",
      "flac",
      "wav",
    ]);
  });
});
