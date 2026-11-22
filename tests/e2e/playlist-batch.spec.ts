import { expect, test } from "@playwright/test";

const MOCK_BATCH_ID = "00000000-0000-4000-8000-000000000789";

test.describe("RetroTube V2 Playlist & Batch E2E Flow", () => {
  test("playlist fetch -> view checklist & unavailable item -> start batch -> progress -> ZIP download", async ({
    page,
    context,
  }) => {
    // Mock thumbnails so there is zero external network dependency
    await context.route("https://i.ytimg.com/**", async (route) => {
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(pngBase64, "base64"),
      });
    });

    // Mock playlist metadata fetch
    await context.route("**/api/playlist/fetch", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          isCombined: false,
          playlist: {
            id: "PL_E2E_SYNTH",
            title: "Retro Wave Synth Tape Vol 1",
            channel: "Synthwave Club",
            itemCount: 3,
            totalDurationSec: 600,
            items: [
              {
                position: 1,
                youtubeId: "vid01",
                title: "Track 01 - Laser Highway",
                durationSec: 200,
                thumbnail: "https://i.ytimg.com/vi/vid01/hqdefault.jpg",
                isAvailable: true,
              },
              {
                position: 2,
                youtubeId: "vid02",
                title: "Track 02 - Deleted Broadcast",
                durationSec: null,
                thumbnail: null,
                isAvailable: false,
                unavailableReason: "This video is unavailable (deleted)",
              },
              {
                position: 3,
                youtubeId: "vid03",
                title: "Track 03 - Neon Runner",
                durationSec: 400,
                thumbnail: "https://i.ytimg.com/vi/vid03/hqdefault.jpg",
                isAvailable: true,
              },
            ],
          },
        }),
      });
    });

    // Mock batch creation POST
    await context.route("**/api/batch", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            batchId: MOCK_BATCH_ID,
            status: "queued",
            itemCount: 3,
            selectedCount: 2,
            qualityPreset: "1080p",
            eventsUrl: `/api/batch/${MOCK_BATCH_ID}/events`,
            zipUrl: `/api/batch/${MOCK_BATCH_ID}/zip`,
          }),
        });
        return;
      }
      await route.continue();
    });

    // Mock batch GET status
    await context.route(`**/api/batch/${MOCK_BATCH_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          batch: {
            id: MOCK_BATCH_ID,
            title: "Retro Wave Synth Tape Vol 1",
            channel: "Synthwave Club",
            status: "running",
            qualityPreset: "1080p",
            itemCount: 3,
            selectedCount: 2,
            completedCount: 2,
            failedCount: 0,
            zipUrl: `/api/batch/${MOCK_BATCH_ID}/zip`,
            items: [
              {
                id: 1,
                position: 1,
                youtubeId: "vid01",
                title: "Track 01 - Laser Highway",
                durationSec: 200,
                status: "done",
                downloadUrl: "/api/download/job-1/stream",
                outputFilename: "001 - Track 01 - Laser Highway.mp4",
                actualFormat: "1080p",
                bytesTotal: 12000000,
                retryCount: 0,
              },
              {
                id: 3,
                position: 3,
                youtubeId: "vid03",
                title: "Track 03 - Neon Runner",
                durationSec: 400,
                status: "done",
                downloadUrl: "/api/download/job-2/stream",
                outputFilename: "002 - Track 03 - Neon Runner.mp4",
                actualFormat: "1080p",
                bytesTotal: 24000000,
                retryCount: 0,
              },
            ],
          },
        }),
      });
    });

    // Mock SSE events for the batch
    await context.route(`**/api/batch/${MOCK_BATCH_ID}/events`, async (route) => {
      const sseBody = [
        `event: batch_progress\ndata: ${JSON.stringify({
          status: "running",
          completedCount: 2,
          failedCount: 0,
        })}\n\n`,
        `event: batch_done\ndata: ${JSON.stringify({
          status: "done",
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

    // Mock ZIP stream download
    await context.route("**/api/batch/**/zip*", async (route) => {
      // Minimal valid zip header bytes PK\x05\x06
      const minimalZip = Buffer.from([
        0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="Retro Wave Synth Tape Vol 1.zip"',
        },
        body: minimalZip,
      });
    });

    // 1. Visit Home
    await page.goto("/");
    await expect(page).toHaveTitle(/RetroTube/i);

    // 2. Paste playlist URL into input
    const urlInput = page.getByLabel(/YouTube.*URL/i);
    await urlInput.fill("https://www.youtube.com/playlist?list=PL_E2E_SYNTH");

    // 3. Click Fetch button
    await page.getByRole("button", { name: "Fetch" }).click();

    // 4. Verify Playlist Picker deck is displayed
    await expect(
      page.getByRole("heading", { name: "Retro Wave Synth Tape Vol 1" }),
    ).toBeVisible();
    await expect(page.getByText("Curator: Synthwave Club")).toBeVisible();
    await expect(page.getByText("3 Tracks")).toBeVisible();

    // 5. Verify available items and disabled unavailable item
    await expect(page.getByText("Track 01 - Laser Highway")).toBeVisible();
    await expect(page.getByText("Track 02 - Deleted Broadcast")).toBeVisible();
    await expect(page.getByText(/unavailable \(deleted\)/i)).toBeVisible();
    await expect(page.getByText("Track 03 - Neon Runner")).toBeVisible();

    // 6. Select quality preset "1080p HD"
    await page.getByRole("button", { name: "1080p HD" }).click();

    // 7. Verify Start Batch Download button has 2 tracks selected (since 1 is unavailable)
    const startBatchBtn = page.getByRole("button", {
      name: /Start Batch Download \(2\)/i,
    });
    await expect(startBatchBtn).toBeVisible();

    // Set up download listener before clicking ZIP button
    const downloadPromise = page.waitForEvent("download");

    // 8. Start batch
    await startBatchBtn.click();

    // 9. Batch progress panel is displayed
    await expect(page.getByText(/Retro Wave Synth Tape Vol 1/i).first()).toBeVisible();
    await expect(page.getByText("2 / 2 ready")).toBeVisible();

    // 10. Click Download ZIP button
    const downloadZipBtn = page.getByRole("button", {
      name: /Download ZIP/i,
    });
    await expect(downloadZipBtn).toBeVisible();
    await downloadZipBtn.click();

    // 11. Assert ZIP download was triggered with proper filename
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(".zip");
    expect(download.url()).toContain(`/api/batch/${MOCK_BATCH_ID}/zip`);
  });
});
