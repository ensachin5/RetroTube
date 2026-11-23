import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { jobsRepo } from "@/repositories/jobs.repo";

export interface DiskCheckResult extends Record<string, unknown> {
  hasSufficientSpace: boolean;
  requiredBytes: number;
  availableBytes: number;
  reserveBytes: number;
  requiredMb: number;
  availableMb: number;
  reserveMb: number;
}

export interface StorageStats {
  tempDirPath: string;
  diskTotalBytes: number;
  diskFreeBytes: number;
  diskUsedBytes: number;
  minFreeDiskGb: number;
  tempUsageBytes: number;
  tempFileCount: number;
  runningJobsCount: number;
}

export interface CleanReport {
  cleaned: boolean;
  deletedFilesCount: number;
  freedBytes: number;
}

export const diskService = {
  getTempDir(): string {
    const tempDir = path.resolve(getEnv().TEMP_DIR);
    fs.mkdirSync(tempDir, { recursive: true });
    return tempDir;
  },

  estimateJobBytes(filesizeBytes?: number | null, needsMerge = false): number {
    const baseBytes =
      filesizeBytes && filesizeBytes > 0 ? filesizeBytes : 250 * 1024 * 1024;
    const multiplier = needsMerge ? 2.2 : 1.2;
    return Math.round(baseBytes * multiplier);
  },

  async getStorageStats(): Promise<StorageStats> {
    const env = getEnv();
    const tempDirPath = this.getTempDir();

    let diskTotalBytes = 100 * 1024 * 1024 * 1024; // 100 GB default fallback
    let diskFreeBytes = 50 * 1024 * 1024 * 1024; // 50 GB default fallback

    try {
      const stat = await fsp.statfs(tempDirPath);
      const bsize = Number(stat.bsize || 4096);
      diskTotalBytes = Number(stat.blocks) * bsize;
      diskFreeBytes = Number(stat.bavail) * bsize;
    } catch (err) {
      logger.warn("statfs unavailable on tempDir, using fallback estimates", {
        tempDirPath,
        error: err,
      });
    }

    const diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);

    let tempUsageBytes = 0;
    let tempFileCount = 0;

    try {
      const entries = await fsp.readdir(tempDirPath);
      for (const entry of entries) {
        try {
          const fullPath = path.join(tempDirPath, entry);
          const fstat = await fsp.stat(fullPath);
          if (fstat.isFile()) {
            tempUsageBytes += fstat.size;
            tempFileCount += 1;
          }
        } catch {
          // File race or missing
        }
      }
    } catch {
      // Missing tempDir
    }

    const counts = jobsRepo.countByStatus();

    return {
      tempDirPath,
      diskTotalBytes,
      diskFreeBytes,
      diskUsedBytes,
      minFreeDiskGb: env.MIN_FREE_DISK_GB,
      tempUsageBytes,
      tempFileCount,
      runningJobsCount: counts.running,
    };
  },

  async checkAvailableDisk(requiredBytes: number): Promise<DiskCheckResult> {
    const env = getEnv();
    const stats = await this.getStorageStats();
    const isServerless =
      process.env.VERCEL === "1" ||
      Boolean(process.env.VERCEL_ENV) ||
      Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

    // On serverless hosts (Vercel/AWS Lambda), the file streams straight to the user's browser/disk.
    // We do not hold a multi-GB server disk reserve.
    const reserveBytes = isServerless ? 0 : env.MIN_FREE_DISK_GB * 1024 * 1024 * 1024;
    const effectiveAvailable = Math.max(0, stats.diskFreeBytes - reserveBytes);
    const hasSufficientSpace = isServerless ? true : effectiveAvailable >= requiredBytes;

    return {
      hasSufficientSpace,
      requiredBytes,
      availableBytes: stats.diskFreeBytes,
      reserveBytes,
      requiredMb: Math.round(requiredBytes / (1024 * 1024)),
      availableMb: Math.round(stats.diskFreeBytes / (1024 * 1024)),
      reserveMb: Math.round(reserveBytes / (1024 * 1024)),
    };
  },

  async assertSufficientDisk(requiredBytes: number): Promise<void> {
    const isServerless =
      process.env.VERCEL === "1" ||
      Boolean(process.env.VERCEL_ENV) ||
      Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

    // In serverless environments (Vercel / Lambda), media streams directly to the user's
    // device storage. Bypass blocking server disk assertion completely.
    if (isServerless) {
      return;
    }

    let check = await this.checkAvailableDisk(requiredBytes);
    if (!check.hasSufficientSpace) {
      try {
        await this.cleanStorage(false, 15);
      } catch {
        // Ignore opportunistic cleanup failure
      }
      check = await this.checkAvailableDisk(requiredBytes);
    }

    if (!check.hasSufficientSpace) {
      throw new AppError({
        code: ERROR_CODES.INSUFFICIENT_DISK,
        status: 507,
        message: `Insufficient disk space: this operation requires ~${check.requiredMb} MB but only ${check.availableMb} MB is free (${check.reserveMb} MB kept in reserve).`,
        details: check,
      });
    }
  },

  async cleanStorage(forceCleanAll = true, maxAgeMinutes?: number): Promise<CleanReport> {
    const env = getEnv();
    const tempDirPath = this.getTempDir();
    const activePaths = new Set(jobsRepo.listActiveTempFilepaths());
    const ttlMinutes = maxAgeMinutes ?? env.FILE_TTL_MINUTES;
    const maxAgeMs = ttlMinutes * 60 * 1000;
    const now = Date.now();

    let deletedFilesCount = 0;
    let freedBytes = 0;
    const deletedPaths: string[] = [];

    try {
      const entries = await fsp.readdir(tempDirPath);
      for (const entry of entries) {
        const fullPath = path.join(tempDirPath, entry);
        if (activePaths.has(fullPath)) {
          continue;
        }

        try {
          const fstat = await fsp.stat(fullPath);
          if (fstat.isFile()) {
            if (!forceCleanAll && now - fstat.mtimeMs < maxAgeMs) {
              // File is still within TTL window
              continue;
            }

            await fsp.unlink(fullPath);
            deletedFilesCount += 1;
            freedBytes += fstat.size;
            deletedPaths.push(fullPath);
          }
        } catch {
          // Ignore unlink/stat errors
        }
      }
    } catch {
      // Directory read error
    }

    if (deletedPaths.length > 0) {
      jobsRepo.clearTempFilepathsByPaths(deletedPaths);
    }

    logger.info("Storage cleanup executed", {
      deletedFilesCount,
      freedBytes,
      forceCleanAll,
      ttlMinutes,
    });

    return {
      cleaned: true,
      deletedFilesCount,
      freedBytes,
    };
  },

  async purgeExpiredTempFiles(maxAgeMinutes?: number): Promise<CleanReport> {
    return this.cleanStorage(false, maxAgeMinutes);
  },
};
