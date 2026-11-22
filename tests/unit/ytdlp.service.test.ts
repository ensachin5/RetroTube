import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@/lib/errors";
import { mapYtDlpStderrToError, parseYtDlpProgressLine } from "@/services/ytdlp.service";

describe("ytdlp.service progress parsing and error mapping", () => {
  describe("parseYtDlpProgressLine", () => {
    it("parses standard single-stream progress line", () => {
      const parsed = parseYtDlpProgressLine(
        "[download]  50.0% of 10.00MiB at 2.50MiB/s ETA 00:02",
      );
      expect(parsed).toEqual({
        pct: 50,
        speed: "2.50MiB/s",
        etaSec: 2,
      });
    });

    it("parses concurrent fragment progress lines with tildes and extra fragment tokens", () => {
      const parsed = parseYtDlpProgressLine(
        "[download]  15.5% of ~ 45.20MiB at 8.10MiB/s ETA 00:04 (frag 6/38)",
      );
      expect(parsed).toEqual({
        pct: 15.5,
        speed: "8.10MiB/s",
        etaSec: 4,
      });

      const parsedCompact = parseYtDlpProgressLine(
        "[download]  25.0% of ~100.00MiB at 12.00MiB/s ETA 00:08",
      );
      expect(parsedCompact).toEqual({
        pct: 25,
        speed: "12.00MiB/s",
        etaSec: 8,
      });
    });

    it("parses hours-minutes-seconds ETA", () => {
      const parsed = parseYtDlpProgressLine(
        "[download]   1.0% of 1.50GiB at 500.00KiB/s ETA 01:02:03",
      );
      expect(parsed).toEqual({
        pct: 1,
        speed: "500.00KiB/s",
        etaSec: 3600 + 2 * 60 + 3,
      });
    });

    it("handles Unknown speed and ETA gracefully", () => {
      const parsed = parseYtDlpProgressLine(
        "[download]  33.3% of 20.00MiB at Unknown ETA Unknown",
      );
      expect(parsed).toEqual({
        pct: 33.3,
        speed: null,
        etaSec: null,
      });
    });

    it("returns null for non-progress lines", () => {
      expect(
        parseYtDlpProgressLine("[youtube] Extracting URL: https://youtube.com"),
      ).toBeNull();
      expect(parseYtDlpProgressLine("[info] Downloading video")).toBeNull();
      expect(parseYtDlpProgressLine("")).toBeNull();
    });
  });

  describe("mapYtDlpStderrToError", () => {
    it("maps private video stderr", () => {
      const err = mapYtDlpStderrToError(
        "ERROR: [youtube] Video unavailable. This video is private.",
      );
      expect(err.code).toBe(ERROR_CODES.PRIVATE_VIDEO);
      expect(err.status).toBe(403);
    });

    it("maps age restricted stderr", () => {
      const err = mapYtDlpStderrToError(
        "ERROR: Sign in to confirm your age. This video may be inappropriate for some users.",
      );
      expect(err.code).toBe(ERROR_CODES.AGE_RESTRICTED);
      expect(err.status).toBe(403);
    });

    it("maps geo blocked stderr", () => {
      const err = mapYtDlpStderrToError(
        "ERROR: The uploader has not made this video available in your country.",
      );
      expect(err.code).toBe(ERROR_CODES.GEO_BLOCKED);
      expect(err.status).toBe(451);
    });

    it("maps live stream stderr", () => {
      const err = mapYtDlpStderrToError("ERROR: This live event will begin in 2 hours.");
      expect(err.code).toBe(ERROR_CODES.LIVE_STREAM);
      expect(err.status).toBe(422);
    });

    it("maps rate limit stderr", () => {
      const err = mapYtDlpStderrToError("ERROR: HTTP Error 429: Too Many Requests");
      expect(err.code).toBe(ERROR_CODES.RATE_LIMITED);
      expect(err.status).toBe(429);
    });

    it("maps invalid url stderr", () => {
      const err = mapYtDlpStderrToError("ERROR: Unsupported URL: foo");
      expect(err.code).toBe(ERROR_CODES.INVALID_URL);
      expect(err.status).toBe(400);
    });

    it("maps video removed stderr", () => {
      const err = mapYtDlpStderrToError(
        "ERROR: Video unavailable. This video has been removed.",
      );
      expect(err.code).toBe(ERROR_CODES.VIDEO_UNAVAILABLE);
      expect(err.status).toBe(404);
    });

    it("defaults to YTDLP_FAILED on unknown stderr", () => {
      const err = mapYtDlpStderrToError(
        "ERROR: Something unexpected happened in extractor",
      );
      expect(err.code).toBe(ERROR_CODES.YTDLP_FAILED);
      expect(err.status).toBe(502);
    });
  });
});
