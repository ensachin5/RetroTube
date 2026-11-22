import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { execSync } from "node:child_process";

export interface BinaryResolution {
  path: string;
  isExecutable: boolean;
  source: "env" | "project-bin" | "tmp-bin" | "system";
}

const archSuffix = process.arch === "arm64" ? "_aarch64" : "";
// Must use standalone Linux binary (yt-dlp_linux) with bundled Python runtime for serverless
const YTDLP_LINUX_URL =
  `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux${archSuffix}`;

function isExecutable(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    // Check executable bit on POSIX systems
    if (process.platform !== "win32") {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveBinaryPath(binaryName: "yt-dlp" | "ffmpeg"): string {
  // 1. Explicit environment variable
  const envVal =
    binaryName === "yt-dlp" ? process.env.YTDLP_PATH : process.env.FFMPEG_PATH;
  if (envVal && envVal.trim().length > 0) {
    return envVal.trim();
  }

  // 2. Project-bundled binary (./bin/<binaryName>)
  const projectBin = path.resolve(process.cwd(), "bin", binaryName);
  if (isExecutable(projectBin)) {
    return projectBin;
  }

  // 3. Lambda /tmp binary (/tmp/bin/<binaryName>)
  const tmpBin = path.join("/tmp", "bin", binaryName);
  if (isExecutable(tmpBin)) {
    return tmpBin;
  }

  // 4. Default to binary name in PATH
  return binaryName;
}

export async function ensureYtDlpBinary(): Promise<string> {
  const current = resolveBinaryPath("yt-dlp");
  if (current !== "yt-dlp" && isExecutable(current)) {
    return current;
  }

  // Check if system has yt-dlp installed
  try {
    execSync("yt-dlp --version", { stdio: "ignore" });
    return "yt-dlp";
  } catch {
    // Not found in system PATH
  }

  // On Linux / Vercel, auto-download standalone yt-dlp binary into /tmp/bin
  if (process.platform === "linux" || process.env.VERCEL === "1") {
    const tmpBinDir = path.join("/tmp", "bin");
    const targetPath = path.join(tmpBinDir, "yt-dlp");

    if (isExecutable(targetPath)) {
      return targetPath;
    }

    fs.mkdirSync(tmpBinDir, { recursive: true });

    await new Promise<void>((resolve, reject) => {
      const download = (url: string, redirectsRemaining = 5) => {
        if (redirectsRemaining <= 0) {
          reject(new Error("Too many redirects downloading yt-dlp binary"));
          return;
        }
        https
          .get(url, (response) => {
            if (
              response.statusCode &&
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location
            ) {
              response.resume();
              download(response.headers.location, redirectsRemaining - 1);
              return;
            }
            if (response.statusCode !== 200) {
              reject(
                new Error(
                  `Failed to download yt-dlp binary: HTTP ${response.statusCode}`,
                ),
              );
              return;
            }
            const file = fs.createWriteStream(targetPath, { mode: 0o755 });
            response.pipe(file);
            file.on("finish", () => {
              file.close(() => {
                try {
                  fs.chmodSync(targetPath, 0o755);
                } catch {
                  // Ignore chmod error if already executable
                }
                resolve();
              });
            });
            file.on("error", (err) => {
              fs.unlink(targetPath, () => undefined);
              reject(err);
            });
          })
          .on("error", (err) => {
            fs.unlink(targetPath, () => undefined);
            reject(err);
          });
      };
      download(YTDLP_LINUX_URL);
    });

    return targetPath;
  }

  return current;
}
