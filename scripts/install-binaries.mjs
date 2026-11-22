#!/usr/bin/env node

/**
 * RetroTube - Serverless Binary Provisioning Script
 * Automatically provisions yt-dlp and ffmpeg for Vercel/serverless environments.
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import zlib from "node:zlib";
import { execSync } from "node:child_process";

const BIN_DIR = path.resolve(process.cwd(), "bin");
const YTDLP_LINUX_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
// Pre-compiled static Linux x86_64 ffmpeg
const FFMPEG_LINUX_GZ_URL =
  "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64.gz";

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with status ${res.statusCode} for ${url}`));
        }
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });
      })
      .on("error", reject);
  });
}

function downloadAndDecompressGz(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadAndDecompressGz(res.headers.location, destPath).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with status ${res.statusCode} for ${url}`));
        }
        const gunzip = zlib.createGunzip();
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(gunzip).pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });
        gunzip.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  console.log("⚡ [RetroTube] Checking serverless binary requirements...");

  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  const isLinux = process.platform === "linux";
  const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);

  console.log(`[RetroTube] Platform: ${process.platform} (${process.arch}), Vercel: ${isVercel}`);

  // Provision yt-dlp
  const ytdlpDest = path.join(BIN_DIR, "yt-dlp");
  if (!fs.existsSync(ytdlpDest)) {
    if (isLinux || isVercel) {
      console.log(`[RetroTube] Downloading standalone yt-dlp binary from ${YTDLP_LINUX_URL}...`);
      await downloadFile(YTDLP_LINUX_URL, ytdlpDest);
      fs.chmodSync(ytdlpDest, 0o755);
      console.log("✅ [RetroTube] yt-dlp binary downloaded and marked executable.");
    } else {
      // Local development on macOS or Windows: verify local install or symlink
      try {
        const localPath = execSync("which yt-dlp", { encoding: "utf8" }).trim();
        console.log(`ℹ️ [RetroTube] Using local system yt-dlp at: ${localPath}`);
      } catch {
        console.warn("⚠️ [RetroTube] yt-dlp not found in system PATH. Please ensure it is installed locally.");
      }
    }
  } else {
    console.log("✅ [RetroTube] yt-dlp binary already present in ./bin");
  }

  // Provision ffmpeg
  const ffmpegDest = path.join(BIN_DIR, "ffmpeg");
  if (!fs.existsSync(ffmpegDest)) {
    if (isLinux || isVercel) {
      console.log(`[RetroTube] Downloading static Linux ffmpeg from ${FFMPEG_LINUX_GZ_URL}...`);
      try {
        await downloadAndDecompressGz(FFMPEG_LINUX_GZ_URL, ffmpegDest);
        fs.chmodSync(ffmpegDest, 0o755);
        console.log("✅ [RetroTube] ffmpeg binary downloaded and marked executable.");
      } catch (err) {
        console.warn("⚠️ [RetroTube] Could not download static ffmpeg:", err.message);
      }
    } else {
      try {
        const localFfmpeg = execSync("which ffmpeg", { encoding: "utf8" }).trim();
        console.log(`ℹ️ [RetroTube] Using local system ffmpeg at: ${localFfmpeg}`);
      } catch {
        console.warn("⚠️ [RetroTube] ffmpeg not found in system PATH.");
      }
    }
  } else {
    console.log("✅ [RetroTube] ffmpeg binary already present in ./bin");
  }

  // Verification step
  if (fs.existsSync(ytdlpDest)) {
    try {
      const ver = execSync(`"${ytdlpDest}" --version`, { encoding: "utf8" }).trim();
      console.log(`🎉 [RetroTube] Verified ./bin/yt-dlp version: ${ver}`);
    } catch {
      // May fail if cross-compiling on different arch during local test
    }
  }

  console.log("🚀 [RetroTube] Binary setup complete.");
}

main().catch((err) => {
  console.error("❌ [RetroTube] Binary provisioning error:", err);
  // Do not fail the build if offline; runtime fallback in lib/binaries.ts handles it
  process.exit(0);
});
