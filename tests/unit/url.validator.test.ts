import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { validateAndParseYouTubeUrl } from "@/lib/url.validator";

describe("url.validator", () => {
  it("parses standard youtube.com watch URLs", () => {
    const parsed = validateAndParseYouTubeUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    );
    expect(parsed).toEqual({
      youtubeId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      hostname: "www.youtube.com",
      isShorts: false,
      isMusic: false,
      hadPlaylistParam: false,
    });
  });

  it("parses youtu.be, m.youtube.com, shorts, live, embed, and music.youtube.com URLs", () => {
    expect(
      validateAndParseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?si=abc"),
    ).toMatchObject({
      youtubeId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      isShorts: false,
      isMusic: false,
    });

    expect(
      validateAndParseYouTubeUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toMatchObject({
      youtubeId: "dQw4w9WgXcQ",
      hostname: "m.youtube.com",
    });

    expect(
      validateAndParseYouTubeUrl("https://youtube.com/shorts/abcdefghijk"),
    ).toMatchObject({
      youtubeId: "abcdefghijk",
      isShorts: true,
    });

    expect(
      validateAndParseYouTubeUrl("https://www.youtube.com/live/abcdefghijk"),
    ).toMatchObject({
      youtubeId: "abcdefghijk",
    });

    expect(
      validateAndParseYouTubeUrl("https://www.youtube.com/embed/abcdefghijk"),
    ).toMatchObject({
      youtubeId: "abcdefghijk",
    });

    expect(
      validateAndParseYouTubeUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toMatchObject({
      youtubeId: "dQw4w9WgXcQ",
      canonicalUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      isMusic: true,
    });

    expect(validateAndParseYouTubeUrl("youtu.be/dQw4w9WgXcQ")).toMatchObject({
      youtubeId: "dQw4w9WgXcQ",
    });
  });

  it("extracts single video ID when watch URL also contains list parameter", () => {
    const parsed = validateAndParseYouTubeUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ",
    );
    expect(parsed.youtubeId).toBe("dQw4w9WgXcQ");
    expect(parsed.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(parsed.hadPlaylistParam).toBe(true);
  });

  it("rejects playlist-only URLs with PLAYLIST_NOT_SUPPORTED", () => {
    const playlistUrls = [
      "https://www.youtube.com/playlist?list=PL1234567890",
      "https://music.youtube.com/playlist?list=OLAK5uy_123456",
      "https://www.youtube.com/watch?list=PL1234567890",
      "https://www.youtube.com/watch_videos?video_ids=dQw4w9WgXcQ,abcdefghijk",
    ];

    for (const url of playlistUrls) {
      let caught: unknown;
      try {
        validateAndParseYouTubeUrl(url);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe(ERROR_CODES.PLAYLIST_NOT_SUPPORTED);
    }
  });

  it("rejects tricky SSRF hostnames, bad protocols, credentials, ports, and malformed IDs", () => {
    const invalidUrls = [
      "",
      "   ",
      "not a url",
      "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
      "https://evil-youtube.com/watch?v=dQw4w9WgXcQ",
      "https://notyoutu.be/dQw4w9WgXcQ",
      "http://127.0.0.1/watch?v=dQw4w9WgXcQ",
      "http://localhost:3000/watch?v=dQw4w9WgXcQ",
      "http://169.254.169.254/latest/meta-data",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=too_long_video_id_123",
      "https://www.youtube.com/channel/UC12345",
    ];

    for (const url of invalidUrls) {
      let caught: unknown;
      try {
        validateAndParseYouTubeUrl(url);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe(ERROR_CODES.INVALID_URL);
    }
  });
});
