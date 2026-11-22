import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES } from "@/lib/errors";
import { buildNumberedBatchFilename } from "@/lib/filename";
import { parseYouTubeUrl } from "@/lib/url.validator";
import { batchItemsRepo } from "@/repositories/batch-items.repo";
import { batchesRepo } from "@/repositories/batches.repo";
import { formatsRepo } from "@/repositories/formats.repo";
import { jobsRepo } from "@/repositories/jobs.repo";
import { videosRepo } from "@/repositories/videos.repo";
import { batchService } from "@/services/batch.service";
import { type FormatRow, matchFormatForPreset } from "@/services/format.normalizer";
import { jobService } from "@/services/job.service";
import { fetchService } from "@/services/fetch.service";
import { playlistService } from "@/services/playlist.service";
import { type RawYtDlpPlaylistInfo, ytdlpService } from "@/services/ytdlp.service";
import { zipService } from "@/services/zip.service";

describe("Stage 2: Playlist & Batch Support", () => {
  describe("Playlist URL Detection", () => {
    it("distinguishes playlist-only, video-only, and combined URLs", () => {
      const playlistOnly = parseYouTubeUrl(
        "https://www.youtube.com/playlist?list=PL1234567890abcdef",
      );
      expect(playlistOnly.type).toBe("playlist");
      expect(playlistOnly.playlistId).toBe("PL1234567890abcdef");
      expect(playlistOnly.videoId).toBeUndefined();

      const combined = parseYouTubeUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890abcdef",
      );
      expect(combined.type).toBe("combined");
      expect(combined.videoId).toBe("dQw4w9WgXcQ");
      expect(combined.playlistId).toBe("PL1234567890abcdef");

      const videoOnly = parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(videoOnly.type).toBe("video");
      expect(videoOnly.videoId).toBe("dQw4w9WgXcQ");
      expect(videoOnly.playlistId).toBeUndefined();
    });
  });

  describe("Playlist Normalization & Availability", () => {
    it("normalizes flat playlist entries and flags unavailable items from fixture without failing", async () => {
      const fixturePath = path.join(__dirname, "../fixtures/playlist-sample.json");
      const fixtureContent = await fsp.readFile(fixturePath, "utf8");
      const fixturePlaylist: RawYtDlpPlaylistInfo = JSON.parse(fixtureContent);

      vi.spyOn(ytdlpService, "inspectPlaylistFlat").mockResolvedValue(fixturePlaylist);

      const result = await playlistService.fetchPlaylistMetadata(
        "https://www.youtube.com/playlist?list=PL_TEST_SAMPLE_FIXTURE",
      );

      expect(result.isCombined).toBe(false);
      expect(result.playlist).toBeDefined();

      const playlist = result.playlist!;
      expect(playlist.title).toBe("Retro Waves & Synth Classics 1985");
      expect(playlist.channel).toBe("VHS Nostalgia Club");
      expect(playlist.itemCount).toBe(5);
      expect(playlist.totalDurationSec).toBe(757); // 259 + 290 + 208

      // Check item 1 (available)
      expect(playlist.items[0]).toMatchObject({
        position: 1,
        youtubeId: "vid_synth_01",
        title: "Kavinsky - Nightcall (Drive OST)",
        durationSec: 259,
        isAvailable: true,
      });

      // Check item 2 (deleted)
      expect(playlist.items[1]!.isAvailable).toBe(false);
      expect(playlist.items[1]!.unavailableReason).toContain("deleted");

      // Check item 3 (private)
      expect(playlist.items[2]!.isAvailable).toBe(false);
      expect(playlist.items[2]!.unavailableReason).toContain("private");

      // Check item 4 & 5 (available)
      expect(playlist.items[3]!.isAvailable).toBe(true);
      expect(playlist.items[3]!.youtubeId).toBe("vid_synth_04");
      expect(playlist.items[4]!.isAvailable).toBe(true);
      expect(playlist.items[4]!.youtubeId).toBe("vid_synth_05");
    });

    it("throws PLAYLIST_EMPTY when playlist has 0 entries", async () => {
      vi.spyOn(ytdlpService, "inspectPlaylistFlat").mockResolvedValue({
        id: "PL_EMPTY",
        title: "Empty Playlist",
        entries: [],
      });

      await expect(
        playlistService.fetchPlaylistMetadata(
          "https://www.youtube.com/playlist?list=PL_EMPTY",
        ),
      ).rejects.toThrowError(
        expect.objectContaining({ code: ERROR_CODES.PLAYLIST_EMPTY }),
      );
    });

    it("respects first N limit option", async () => {
      const fixturePath = path.join(__dirname, "../fixtures/playlist-sample.json");
      const fixtureContent = await fsp.readFile(fixturePath, "utf8");
      const fixturePlaylist: RawYtDlpPlaylistInfo = JSON.parse(fixtureContent);

      vi.spyOn(ytdlpService, "inspectPlaylistFlat").mockResolvedValue(fixturePlaylist);

      const result = await playlistService.fetchPlaylistMetadata(
        "https://www.youtube.com/playlist?list=PL_TEST_SAMPLE_FIXTURE",
        { limit: 2 },
      );

      expect(result.playlist?.items.length).toBe(2);
      expect(result.playlist?.items[0]!.youtubeId).toBe("vid_synth_01");
      expect(result.playlist?.items[1]!.youtubeId).toBe("vid_synth_02");
    });
  });

  describe("Quality Preset Matching & Fallback", () => {
    const mockFormats: FormatRow[] = [
      {
        id: 1,
        videoId: 10,
        formatId: "137",
        kind: "video",
        container: "mp4",
        vcodec: "avc1.640028",
        acodec: null,
        resolution: "1080p",
        width: 1920,
        height: 1080,
        fps: 30,
        bitrateKbps: 4500,
        filesizeBytes: 150000000,
        isHdr: false,
        formatNote: "1080p",
      },
      {
        id: 2,
        videoId: 10,
        formatId: "136",
        kind: "video",
        container: "mp4",
        vcodec: "avc1.4d401f",
        acodec: null,
        resolution: "720p",
        width: 1280,
        height: 720,
        fps: 30,
        bitrateKbps: 2200,
        filesizeBytes: 80000000,
        isHdr: false,
        formatNote: "720p",
      },
      {
        id: 3,
        videoId: 10,
        formatId: "135",
        kind: "video",
        container: "mp4",
        vcodec: "avc1.4d401e",
        acodec: null,
        resolution: "480p",
        width: 854,
        height: 480,
        fps: 30,
        bitrateKbps: 1100,
        filesizeBytes: 40000000,
        isHdr: false,
        formatNote: "480p",
      },
      {
        id: 4,
        videoId: 10,
        formatId: "251",
        kind: "audio",
        container: "webm",
        vcodec: null,
        acodec: "opus",
        resolution: null,
        width: null,
        height: null,
        fps: null,
        bitrateKbps: 160,
        filesizeBytes: 6000000,
        isHdr: false,
        formatNote: "medium",
      },
    ];

    it("matches exact video preset when available", () => {
      const match1080 = matchFormatForPreset(mockFormats, "1080p", "video", "mp4");
      expect(match1080.format?.height).toBe(1080);
      expect(match1080.needsMerge).toBe(true);

      const match720 = matchFormatForPreset(mockFormats, "720p", "video", "mp4");
      expect(match720.format?.height).toBe(720);
    });

    it("falls back to closest lower resolution when requested preset is unavailable", () => {
      // Filter out 1080p format, leaving only 720p and 480p
      const formatsWithout1080 = mockFormats.filter((f) => f.height !== 1080);

      const match = matchFormatForPreset(formatsWithout1080, "1080p", "video", "mp4");
      expect(match.format?.height).toBe(720); // Fallback to 720p
    });

    it("matches audio conversion presets", () => {
      const mp3Match = matchFormatForPreset(mockFormats, "mp3_320", "audio");
      expect(mp3Match.targetContainer).toBe("mp3");
      expect(mp3Match.targetBitrateKbps).toBe(320);
      expect(mp3Match.format?.formatId).toBe("251");

      const opusMatch = matchFormatForPreset(mockFormats, "opus", "audio");
      expect(opusMatch.targetContainer).toBe("opus");
      expect(opusMatch.targetBitrateKbps).toBe(160);
    });
  });

  describe("Numbered Filename Sanitization", () => {
    it("numbers items with 3-digit padding and sanitizes invalid characters", () => {
      const name1 = buildNumberedBatchFilename({
        position: 1,
        title: "Song #1: AC/DC - Thunderstruck <Official>? *Live*",
        extension: "mp3",
      });
      expect(name1).toBe("001 - Song #1 AC DC - Thunderstruck Official Live.mp3");

      const name42 = buildNumberedBatchFilename({
        position: 42,
        title: "Daft Punk - Around The World",
        extension: "mp4",
      });
      expect(name42).toBe("042 - Daft Punk - Around The World.mp4");
    });
  });

  describe("On-The-Fly Streaming ZIP Delivery", () => {
    let tempDir: string;
    let fileA: string;
    let fileB: string;

    beforeEach(async () => {
      tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "retrotube-zip-test-"));
      fileA = path.join(tempDir, "sampleA.mp3");
      fileB = path.join(tempDir, "sampleB.mp3");
      await fsp.writeFile(fileA, "Mock media track A bytes 1234567890");
      await fsp.writeFile(fileB, "Mock media track B bytes 0987654321");
    });

    afterEach(async () => {
      await fsp.rm(tempDir, { recursive: true, force: true });
    });

    it("streams a valid uncompressed ZIP containing completed batch tracks", async () => {
      const zipStream = zipService.createStreamingZip([
        {
          position: 1,
          title: "Track One",
          extension: "mp3",
          tempFilepath: fileA,
        },
        {
          position: 2,
          title: "Track Two",
          extension: "mp3",
          tempFilepath: fileB,
        },
      ]);

      const reader = zipStream.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalBytes += value.length;
        }
      }

      expect(totalBytes).toBeGreaterThan(0);
      const combinedBuffer = Buffer.concat(chunks);
      // ZIP file signature starts with PK\x03\x04
      expect(combinedBuffer[0]).toBe(0x50);
      expect(combinedBuffer[1]).toBe(0x4b);
      expect(combinedBuffer[2]).toBe(0x03);
      expect(combinedBuffer[3]).toBe(0x04);

      // Contains numbered filenames inside archive header
      const str = combinedBuffer.toString("utf8");
      expect(str).toContain("001 - Track One.mp3");
      expect(str).toContain("002 - Track Two.mp3");
    });
  });

  describe("Batch Repository & State Transitions", () => {
    it("creates batch, records items, and manages retries and status", () => {
      const batchId = `test-batch-${Date.now()}`;
      const batch = batchesRepo.create({
        id: batchId,
        sourceUrl: "https://www.youtube.com/playlist?list=PL_TEST",
        youtubePlaylistId: "PL_TEST",
        title: "Test Batch Run",
        channel: "Test Channel",
        itemCount: 3,
        selectedCount: 2,
        qualityPreset: "1080p",
        kind: "video",
        targetContainer: "mp4",
        status: "queued",
        createdAt: Date.now(),
      });

      expect(batch.id).toBe(batchId);
      expect(batch.status).toBe("queued");

      const items = batchItemsRepo.createMany([
        {
          batchId,
          position: 1,
          youtubeId: "item111",
          title: "Item One",
          durationSec: 120,
          status: "queued",
          retryCount: 0,
        },
        {
          batchId,
          position: 2,
          youtubeId: "item222",
          title: "Item Two",
          durationSec: 180,
          status: "queued",
          retryCount: 0,
        },
      ]);

      expect(items.length).toBe(2);

      // Update item 1 to running then done
      batchItemsRepo.updateStatus(items[0]!.id, "running");
      batchItemsRepo.updateStatus(items[0]!.id, "done");

      // Update item 2 to failed
      batchItemsRepo.updateStatus(items[1]!.id, "failed", {
        errorCode: "RATE_LIMITED",
      });

      const counts = batchItemsRepo.countByStatus(batchId);
      expect(counts["done"]).toBe(1);
      expect(counts["failed"]).toBe(1);

      // Reset failed to queued
      const retryingCount = batchItemsRepo.resetFailedToQueued(batchId);
      expect(retryingCount).toBe(1);

      const afterResetCounts = batchItemsRepo.countByStatus(batchId);
      expect(afterResetCounts["queued"]).toBe(1);

      // Clean up
      batchesRepo.delete(batchId);
      expect(batchesRepo.findById(batchId)).toBeNull();
      expect(batchItemsRepo.findByBatchId(batchId).length).toBe(0);
    });
  });

  describe("Batch Service Integration & Lifecycle", () => {
    it("cancels a batch mid-run and updates all unfinished items to cancelled", async () => {
      const batchId = `cancel-batch-${Date.now()}`;
      batchesRepo.create({
        id: batchId,
        sourceUrl: "https://www.youtube.com/playlist?list=PL_CANCEL",
        youtubePlaylistId: "PL_CANCEL",
        title: "Cancel Test Batch",
        channel: "Cancel Channel",
        itemCount: 3,
        selectedCount: 3,
        qualityPreset: "1080p",
        kind: "video",
        targetContainer: "mp4",
        status: "running",
        createdAt: Date.now(),
      });

      const items = batchItemsRepo.createMany([
        {
          batchId,
          position: 1,
          youtubeId: "vid_canc_1",
          title: "Item 1",
          durationSec: 100,
          status: "done",
          retryCount: 0,
        },
        {
          batchId,
          position: 2,
          youtubeId: "vid_canc_2",
          title: "Item 2",
          durationSec: 120,
          status: "running",
          retryCount: 0,
        },
        {
          batchId,
          position: 3,
          youtubeId: "vid_canc_3",
          title: "Item 3",
          durationSec: 140,
          status: "queued",
          retryCount: 0,
        },
      ]);

      const cancelledBatch = await batchService.cancelBatch(batchId);
      expect(cancelledBatch?.status).toBe("cancelled");

      const reloadedItems = batchItemsRepo.findByBatchId(batchId);
      // Item 1 was done, should remain done
      expect(reloadedItems.find((i) => i.id === items[0]!.id)?.status).toBe("done");
      // Item 2 (running) and Item 3 (queued) should be cancelled
      expect(reloadedItems.find((i) => i.id === items[1]!.id)?.status).toBe("cancelled");
      expect(reloadedItems.find((i) => i.id === items[2]!.id)?.status).toBe("cancelled");

      batchesRepo.delete(batchId);
    });

    it("resumes interrupted running batches on simulated server restart", async () => {
      const batchId = `restart-batch-${Date.now()}`;
      batchesRepo.create({
        id: batchId,
        sourceUrl: "https://www.youtube.com/playlist?list=PL_RESTART",
        youtubePlaylistId: "PL_RESTART",
        title: "Restart Test Batch",
        channel: "Restart Channel",
        itemCount: 2,
        selectedCount: 2,
        qualityPreset: "mp3_320",
        kind: "audio",
        targetContainer: "mp3",
        status: "running", // was in-flight when server died
        createdAt: Date.now(),
      });

      const items = batchItemsRepo.createMany([
        {
          batchId,
          position: 1,
          youtubeId: "vid_res_1",
          title: "Interrupted Item",
          durationSec: 200,
          status: "running", // was downloading when server crashed
          retryCount: 0,
        },
        {
          batchId,
          position: 2,
          youtubeId: "vid_res_2",
          title: "Waiting Item",
          durationSec: 150,
          status: "queued",
          retryCount: 0,
        },
      ]);

      // Mock processBatch so we can verify recoverInterruptedBatches resets the item status
      const processSpy = vi
        .spyOn(batchService, "processBatch")
        .mockResolvedValue(undefined);

      await batchService.recoverInterruptedBatches();

      expect(processSpy).toHaveBeenCalledWith(batchId);
      processSpy.mockRestore();

      const reloadedItem = batchItemsRepo
        .findByBatchId(batchId)
        .find((i) => i.id === items[0]!.id);
      // Status reset from running back to queued so it can continue with yt-dlp --continue
      expect(reloadedItem?.status).toBe("queued");

      batchesRepo.delete(batchId);
    });

    it("processes a batch with mixed success and failure", async () => {
      // Mock BATCH_ITEM_DELAY_MS to 0 for instant test execution
      process.env.BATCH_ITEM_DELAY_MS = "0";

      const testVideo = videosRepo.upsert({
        youtubeId: "vid_test",
        title: "Mocked Test Track",
        channel: "Mocked Artist",
        durationSec: 60,
        uploadDate: null,
        thumbnailUrl: "https://example.com/thumb.jpg",
        fetchedAt: Date.now(),
      });

      const batchId = `mixed-batch-${Date.now()}`;
      batchesRepo.create({
        id: batchId,
        sourceUrl: "https://www.youtube.com/playlist?list=PL_MIXED",
        youtubePlaylistId: "PL_MIXED",
        title: "Mixed Test Batch",
        channel: "Mixed Channel",
        itemCount: 2,
        selectedCount: 2,
        qualityPreset: "1080p",
        kind: "video",
        targetContainer: "mp4",
        status: "queued",
        createdAt: Date.now(),
      });

      const items = batchItemsRepo.createMany([
        {
          batchId,
          position: 1,
          youtubeId: "vid_ok",
          title: "Healthy Video",
          durationSec: 60,
          status: "queued",
          retryCount: 0,
        },
        {
          batchId,
          position: 2,
          youtubeId: "vid_err",
          title: "Corrupt Video",
          durationSec: 60,
          status: "queued",
          retryCount: 2, // already at max retries so it marks failed immediately
        },
      ]);

      const testFormats = formatsRepo.replaceForVideo(testVideo.id, [
        {
          formatId: "137",
          kind: "video",
          container: "mp4",
          vcodec: "avc1.640028",
          acodec: null,
          resolution: "1080p",
          width: 1920,
          height: 1080,
          fps: 30,
          bitrateKbps: 4000,
          filesizeBytes: 10000000,
          isHdr: false,
          formatNote: "1080p",
        },
      ]);

      // Mock fetch metadata
      vi.spyOn(fetchService, "fetchMetadata").mockResolvedValue({
        cached: false,
        video: testVideo,
        videoFormats: [
          {
            id: testFormats[0]!.id,
            formatId: "137",
            kind: "video",
            container: "mp4",
            vcodec: "avc1.640028",
            acodec: null,
            resolution: "1080p",
            width: 1920,
            height: 1080,
            fps: 30,
            bitrateKbps: 4000,
            filesizeBytes: 10000000,
            isHdr: false,
            needsAudioMerge: true,
            recommendedContainer: "mp4",
            formatNote: "1080p",
          },
        ],
        audioFormats: [],
        audioConversions: [],
      });

      // Mock job service enqueue
      vi.spyOn(jobService, "enqueue").mockImplementation(() => {});

      // Mock job completion: vid_ok succeeds, vid_err fails
      vi.spyOn(jobService, "waitForJobCompletion").mockImplementation(async (jobId) => {
        const reloadedItems = batchItemsRepo.findByBatchId(batchId);
        const item1 = reloadedItems.find((i) => i.youtubeId === "vid_ok");
        if (item1?.jobId === jobId) {
          jobsRepo.transitionToRunning(jobId);
          jobsRepo.markDone(jobId, {
            tempFilepath: "/tmp/mock.mp4",
            bytesTotal: 10000000,
          });
          return {
            jobId,
            status: "done",
            bytesTotal: 10000000,
            progressPct: 100,
            stage: "done",
          };
        }
        jobsRepo.transitionToRunning(jobId);
        jobsRepo.markFailed(jobId, {
          errorCode: "DOWNLOAD_FAILED",
          errorMessage: "Failed",
        });
        return {
          jobId,
          status: "failed",
          errorCode: "DOWNLOAD_FAILED",
          progressPct: 0,
          stage: "failed",
        };
      });

      await batchService.processBatch(batchId);

      const finalItems = batchItemsRepo.findByBatchId(batchId);
      const itemOk = finalItems.find((i) => i.id === items[0]!.id);
      const itemErr = finalItems.find((i) => i.id === items[1]!.id);

      expect(itemOk?.status).toBe("done");
      expect(itemErr?.status).toBe("failed");
      expect(itemErr?.errorCode).toBe("DOWNLOAD_FAILED");

      batchesRepo.delete(batchId);
    });
  });
});
