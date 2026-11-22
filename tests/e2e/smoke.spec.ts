import { expect, test } from "@playwright/test";

const MOCK_JOB_ID = "00000000-0000-4000-8000-000000000456";

test.describe("RetroTube E2E Smoke Flow (backend mocked)", () => {
  test("paste URL -> fetch -> choose format -> see SSE progress -> download starts + responsive checks", async ({
    page,
    context,
  }) => {
    // Mock i.ytimg.com thumbnail so test has zero external network reliance
    await context.route("https://i.ytimg.com/**", async (route) => {
      // 1x1 valid transparent PNG
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(pngBase64, "base64"),
      });
    });

    await context.route("**/api/fetch", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cached: false,
          video: {
            id: 1,
            youtubeId: "dQw4w9WgXcQ",
            title: "RetroTube Synthwave Demo Tape",
            channel: "Retro Channel",
            durationSec: 213,
            uploadDate: "2025-04-12",
            thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            fetchedAt: Date.now(),
          },
          videoFormats: [
            {
              id: 11,
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
              isHdr: true,
              needsAudioMerge: true,
              recommendedContainer: "mp4",
              formatNote: "1080p60 HDR",
            },
            {
              id: 12,
              formatId: "22",
              kind: "video",
              container: "mp4",
              vcodec: "avc1.64001F",
              acodec: "mp4a.40.2",
              resolution: "720p",
              width: 1280,
              height: 720,
              fps: 30,
              bitrateKbps: 1800,
              filesizeBytes: 40500000,
              isHdr: false,
              needsAudioMerge: false,
              recommendedContainer: "mp4",
              formatNote: "720p",
            },
          ],
          audioFormats: [
            {
              id: 21,
              formatId: "251",
              kind: "audio",
              container: "webm",
              vcodec: null,
              acodec: "opus",
              bitrateKbps: 160,
              filesizeBytes: 3600000,
              formatNote: "medium",
            },
          ],
          audioConversions: [
            {
              id: "mp3-320",
              targetContainer: "mp3",
              bitrateKbps: 320,
              label: "MP3 320 kbps",
            },
          ],
        }),
      });
    });

    await context.route("**/api/download", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: MOCK_JOB_ID,
          status: "queued",
          needsMerge: true,
          outputFilename: "RetroTube Synthwave Demo Tape [1080p].mp4",
          eventsUrl: `/api/jobs/${MOCK_JOB_ID}/events`,
          streamUrl: `/api/download/${MOCK_JOB_ID}/stream`,
        }),
      });
    });

    await context.route(`**/api/jobs/${MOCK_JOB_ID}/events`, async (route) => {
      const sseBody = [
        `event: progress\ndata: ${JSON.stringify({
          jobId: MOCK_JOB_ID,
          status: "running",
          progressPct: 45,
          stage: "downloading_video",
          speed: "4.1MiB/s",
          etaSec: 5,
        })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          jobId: MOCK_JOB_ID,
          status: "done",
          progressPct: 100,
          stage: "done",
          streamUrl: `/api/download/${MOCK_JOB_ID}/stream`,
          outputFilename: "RetroTube Synthwave Demo Tape [1080p].mp4",
          bytesTotal: 121500000,
        })}\n\n`,
      ].join("");

      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody,
      });
    });

    await context.route(`**/api/download/${MOCK_JOB_ID}/stream`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-disposition":
            'attachment; filename="RetroTube Synthwave Demo Tape [1080p].mp4"',
        },
        body: Buffer.from("MOCK_MP4_STREAM_PAYLOAD"),
      });
    });

    await page.goto("/");

    // Fill URL and click Fetch
    const urlInput = page.getByLabel("YouTube Video URL");
    await urlInput.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Fetch" }).click();

    // Verify metadata card and resolution groups appear
    await expect(
      page.getByRole("heading", { name: "RetroTube Synthwave Demo Tape" }),
    ).toBeVisible();
    await expect(page.getByText("Retro Channel")).toBeVisible();
    await expect(page.getByText("Best Quality")).toBeVisible();
    await expect(page.getByText("HDR")).toBeVisible();

    // Check keyboard navigation between VIDEO and AUDIO tabs
    const videoTab = page.getByRole("tab", { name: /Video/i });
    const audioTab = page.getByRole("tab", { name: /Audio/i });
    await videoTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(audioTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("MP3 320 kbps")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(videoTab).toHaveAttribute("aria-selected", "true");

    // Choose first format -> see progress & verify download starts
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).first().click();

    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByRole("link", { name: "Save File" })).toBeVisible();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      "RetroTube Synthwave Demo Tape [1080p].mp4",
    );
    expect(download.url()).toContain(`/api/download/${MOCK_JOB_ID}/stream`);

    // Theme toggle works without error
    await page.getByRole("button", { name: /CRT Night/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Zero horizontal overflow across mobile, foldable, tablet, and desktop widths
    for (const width of [280, 320, 360, 390, 412, 600, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `Horizontal overflow at ${width}px`).toBe(false);
    }
  });

  test("renders /history, /offline, and 404 pages cleanly", async ({ page }) => {
    await page.goto("/history");
    await expect(
      page.getByRole("heading", { name: /Tape Log & History/i }),
    ).toBeVisible();

    await page.goto("/offline");
    await expect(
      page.getByRole("heading", { name: /Offline Signal Lost/i }),
    ).toBeVisible();
    await expect(page.getByText("TAPE NOT FOUND")).toBeVisible();

    await page.goto("/non-existent-route-check");
    await expect(page.getByRole("heading", { name: /Track Not Found/i })).toBeVisible();
  });

  test("serves valid PWA manifest, icons, sw.js, iOS meta tags, and Web Share Target prefill", async ({
    page,
    request,
    context,
  }) => {
    const manifestRes = await request.get("/manifest.webmanifest");
    expect(manifestRes.status()).toBe(200);
    const manifest = (await manifestRes.json()) as {
      name: string;
      display: string;
      share_target: { action: string; params: { text: string; url: string } };
      icons: Array<{ src: string; purpose?: string }>;
      shortcuts: Array<{ url: string }>;
    };
    expect(manifest.name).toBe("RetroTube");
    expect(manifest.display).toBe("standalone");
    expect(manifest.share_target.action).toBe("/");
    expect(manifest.share_target.params).toMatchObject({ url: "url", text: "text" });
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(manifest.shortcuts.some((s) => s.url === "/history")).toBe(true);

    for (const asset of [
      "/sw.js",
      "/apple-touch-icon.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
      "/favicon.ico",
    ]) {
      const res = await request.get(asset);
      expect(res.status(), `Asset ${asset}`).toBe(200);
    }

    const swRes = await request.get("/sw.js");
    expect(swRes.headers()["content-type"]).toContain("javascript");
    expect(swRes.headers()["cache-control"]).toContain("no-cache");

    // Verify iOS PWA meta tags + viewport-fit=cover in rendered HTML
    await page.goto("/");
    await expect(
      page.locator('meta[name="apple-mobile-web-app-capable"]'),
    ).toHaveAttribute("content", "yes");
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      "content",
      "RetroTube",
    );
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/apple-touch-icon.png",
    );

    // Verify Web Share Target GET param extracts YouTube URL from text and auto-fetches
    await context.route("**/api/fetch", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cached: false,
          video: {
            id: 2,
            youtubeId: "dQw4w9WgXcQ",
            title: "Shared From Android YouTube",
            channel: "Share Channel",
            durationSec: 60,
            uploadDate: "2025-05-01",
            thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            fetchedAt: Date.now(),
          },
          videoFormats: [],
          audioFormats: [],
          audioConversions: [],
        }),
      });
    });

    await page.goto(
      "/?text=" + encodeURIComponent("Check this out: https://youtu.be/dQw4w9WgXcQ!"),
    );
    await expect(page.getByLabel("YouTube Video URL")).toHaveValue(
      "https://youtu.be/dQw4w9WgXcQ",
    );
    await expect(
      page.getByRole("heading", { name: "Shared From Android YouTube" }),
    ).toBeVisible();
  });
});
