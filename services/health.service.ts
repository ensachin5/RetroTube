import fs from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { jobsRepo } from "@/repositories/jobs.repo";
import { settingsRepo } from "@/repositories/settings.repo";
import { ffmpegService } from "./ffmpeg.service";
import { ytdlpService } from "./ytdlp.service";

export interface HealthReport {
  status: "ok" | "degraded";
  timestamp: string;
  checks: {
    db: { ok: boolean; error?: string };
    tempDir: { ok: boolean; path: string; error?: string };
    ytdlp: { ok: boolean; version?: string; error?: string };
    ffmpeg: { ok: boolean; version?: string; error?: string };
  };
  activeJobs: number;
  queuedJobs: number;
}

export const healthService = {
  async check(): Promise<HealthReport> {
    const env = getEnv();
    const tempPath = path.resolve(env.TEMP_DIR);

    let dbCheck: { ok: boolean; error?: string };
    try {
      const ok = settingsRepo.ping();
      dbCheck = ok ? { ok: true } : { ok: false, error: "Ping returned false" };
    } catch (err) {
      dbCheck = {
        ok: false,
        error: err instanceof Error ? err.message : "Database ping failed",
      };
    }

    let tempCheck: { ok: boolean; path: string; error?: string };
    try {
      fs.mkdirSync(tempPath, { recursive: true });
      fs.accessSync(tempPath, fs.constants.W_OK);
      tempCheck = { ok: true, path: tempPath };
    } catch (err) {
      tempCheck = {
        ok: false,
        path: tempPath,
        error: err instanceof Error ? err.message : "Temp dir not writable",
      };
    }

    const [ytdlpCheck, ffmpegCheck] = await Promise.all([
      ytdlpService.probeVersion(),
      ffmpegService.probeVersion(),
    ]);

    const counts = dbCheck.ok ? jobsRepo.countByStatus() : { running: 0, queued: 0 };

    const allOk = dbCheck.ok && tempCheck.ok && ytdlpCheck.ok && ffmpegCheck.ok;

    return {
      status: allOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: {
        db: dbCheck,
        tempDir: tempCheck,
        ytdlp: ytdlpCheck,
        ffmpeg: ffmpegCheck,
      },
      activeJobs: counts.running,
      queuedJobs: counts.queued,
    };
  },
};
