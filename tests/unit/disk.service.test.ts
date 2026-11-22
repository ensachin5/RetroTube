import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES } from "@/lib/errors";
import { diskService } from "@/services/disk.service";

describe("DiskService & Storage API", () => {
  let testTempDir: string;

  beforeEach(async () => {
    testTempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "retrotube-disk-test-"));
    process.env.TEMP_DIR = testTempDir;
    process.env.MIN_FREE_DISK_GB = "2";
  });

  afterEach(async () => {
    await fsp.rm(testTempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  describe("Space Estimation", () => {
    it("estimates 2.2x for merges and 1.2x for non-merges", () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB
      const mergeEstimate = diskService.estimateJobBytes(fileSize, true);
      const directEstimate = diskService.estimateJobBytes(fileSize, false);

      expect(mergeEstimate).toBe(220 * 1024 * 1024);
      expect(directEstimate).toBe(120 * 1024 * 1024);
    });

    it("uses default fallback estimate when file size is zero or missing", () => {
      const fallbackEstimate = diskService.estimateJobBytes(null, false);
      expect(fallbackEstimate).toBeGreaterThan(0);
      expect(fallbackEstimate).toBe(Math.ceil(250 * 1024 * 1024 * 1.2));
    });
  });

  describe("Disk Space Guard", () => {
    it("reports sufficient space when free space exceeds required + reserve", async () => {
      vi.spyOn(diskService, "getStorageStats").mockResolvedValue({
        tempDirPath: testTempDir,
        diskTotalBytes: 100 * 1024 * 1024 * 1024,
        diskFreeBytes: 20 * 1024 * 1024 * 1024, // 20 GB free
        diskUsedBytes: 80 * 1024 * 1024 * 1024,
        minFreeDiskGb: 2, // 2 GB reserve
        tempUsageBytes: 0,
        tempFileCount: 0,
        runningJobsCount: 0,
      });

      const check = await diskService.checkAvailableDisk(500 * 1024 * 1024);
      expect(check.hasSufficientSpace).toBe(true);
      expect(check.availableMb).toBe(20480);
      expect(check.reserveMb).toBe(2048);
    });

    it("throws INSUFFICIENT_DISK when free space is below required + reserve", async () => {
      vi.spyOn(diskService, "getStorageStats").mockResolvedValue({
        tempDirPath: testTempDir,
        diskTotalBytes: 100 * 1024 * 1024 * 1024,
        diskFreeBytes: 2.5 * 1024 * 1024 * 1024, // 2.5 GB free
        diskUsedBytes: 97.5 * 1024 * 1024 * 1024,
        minFreeDiskGb: 2, // 2 GB reserve -> only 0.5 GB available
        tempUsageBytes: 0,
        tempFileCount: 0,
        runningJobsCount: 0,
      });

      // Requesting 1 GB requires 1 GB > 0.5 GB
      await expect(
        diskService.assertSufficientDisk(1024 * 1024 * 1024),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ERROR_CODES.INSUFFICIENT_DISK,
          status: 507,
        }),
      );
    });
  });

  describe("Storage Cleanup", () => {
    it("deletes files in temp dir that are not in the active job list", async () => {
      // Create some test temp files
      const file1 = path.join(testTempDir, "test1.mp4");
      const file2 = path.join(testTempDir, "test2.mp4");
      await fsp.writeFile(file1, "dummy data 12345");
      await fsp.writeFile(file2, "more dummy data");

      const report = await diskService.cleanStorage(true);
      expect(report.cleaned).toBe(true);
      expect(report.deletedFilesCount).toBe(2);
      expect(report.freedBytes).toBeGreaterThan(0);

      const remaining = await fsp.readdir(testTempDir);
      expect(remaining.length).toBe(0);
    });

    it("purges only expired temp files older than TTL while preserving fresh files", async () => {
      const oldFile = path.join(testTempDir, "old-video.mp4");
      const freshFile = path.join(testTempDir, "fresh-video.mp4");

      await fsp.writeFile(oldFile, "old video payload");
      await fsp.writeFile(freshFile, "fresh video payload");

      // Set oldFile mtime to 3 hours ago (180 min ago)
      const threeHoursAgo = new Date(Date.now() - 180 * 60 * 1000);
      await fsp.utimes(oldFile, threeHoursAgo, threeHoursAgo);

      // Run sweeper with 120 min TTL (FILE_TTL_MINUTES = 120)
      const report = await diskService.purgeExpiredTempFiles(120);

      expect(report.cleaned).toBe(true);
      expect(report.deletedFilesCount).toBe(1);

      const remaining = await fsp.readdir(testTempDir);
      expect(remaining).toContain("fresh-video.mp4");
      expect(remaining).not.toContain("old-video.mp4");
    });

    it("never purges temp files belonging to active running jobs even if expired", async () => {
      const activeFile = path.join(testTempDir, "running-job.mp4");
      await fsp.writeFile(activeFile, "in-flight stream payload");

      // Set mtime to 5 hours ago
      const fiveHoursAgo = new Date(Date.now() - 300 * 60 * 1000);
      await fsp.utimes(activeFile, fiveHoursAgo, fiveHoursAgo);

      // Mock jobsRepo.listActiveTempFilepaths to return activeFile
      const { jobsRepo } = await import("@/repositories/jobs.repo");
      vi.spyOn(jobsRepo, "listActiveTempFilepaths").mockReturnValue([activeFile]);

      const report = await diskService.purgeExpiredTempFiles(120);
      expect(report.deletedFilesCount).toBe(0);

      const remaining = await fsp.readdir(testTempDir);
      expect(remaining).toContain("running-job.mp4");
    });
  });
});
