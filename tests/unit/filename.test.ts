import { describe, expect, it } from "vitest";
import {
  buildContentDisposition,
  buildSafeOutputFilename,
  sanitizeExtension,
  sanitizeFilenameSegment,
} from "@/lib/filename";

describe("filename sanitizer", () => {
  it("strips path traversal, control characters, and OS reserved symbols", () => {
    expect(sanitizeFilenameSegment('../../etc/passwd\u0000<>:"/\\|?*')).toBe(
      "etc passwd",
    );
    expect(sanitizeFilenameSegment("...   ")).toBe("retrotube-video");
  });

  it("guards Windows reserved device names", () => {
    expect(sanitizeFilenameSegment("con")).toBe("_con");
    expect(sanitizeFilenameSegment("NUL")).toBe("_NUL");
    expect(sanitizeFilenameSegment("COM1")).toBe("_COM1");
  });

  it("truncates overly long titles cleanly", () => {
    const longTitle = "A".repeat(250);
    const out = buildSafeOutputFilename({
      title: longTitle,
      qualityTag: "1080p",
      extension: "mp4",
    });
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.endsWith(" [1080p].mp4")).toBe(true);
  });

  it("sanitizes extensions and builds valid Content-Disposition with RFC 5987 UTF-8", () => {
    expect(sanitizeExtension("../MP4!")).toBe("mp4");
    const filename = buildSafeOutputFilename({
      title: 'Synthwave Mix — 東京 "Live"',
      qualityTag: "MP3 320kbps",
      extension: "mp3",
    });
    expect(filename).toBe("Synthwave Mix — 東京 Live [MP3 320kbps].mp3");

    const header = buildContentDisposition(filename);
    expect(header).toContain(
      'attachment; filename="Synthwave Mix Live [MP3 320kbps].mp3"',
    );
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("東京"));
  });
});
