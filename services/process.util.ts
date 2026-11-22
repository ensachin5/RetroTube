import { spawn, type ChildProcess } from "node:child_process";

export function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform !== "win32") {
    try {
      // Negative PID targets the entire detached process group
      process.kill(-pid, signal);
      return;
    } catch {
      // Fallback to direct child kill if process group already exited
    }
  }

  try {
    child.kill(signal);
  } catch {
    // Process already dead
  }
}

export interface SpawnedCommandOptions {
  command: string;
  args: string[];
  timeoutMs: number;
  stallTimeoutMs?: number;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface SpawnedCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export function runSpawnedCommand(
  options: SpawnedCommandOptions,
): Promise<SpawnedCommandResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: true,
      });
      return;
    }

    const child = spawn(options.command, options.args, {
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutRemainder = "";
    let stderrRemainder = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let stallTimer: NodeJS.Timeout | undefined;

    const terminateChild = () => {
      killProcessTree(child, "SIGTERM");
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          killProcessTree(child, "SIGKILL");
        }, 2500);
        forceKillTimer.unref();
      }
    };

    const resetStallTimer = () => {
      if (!options.stallTimeoutMs || options.stallTimeoutMs <= 0) return;
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        timedOut = true;
        terminateChild();
      }, options.stallTimeoutMs);
      stallTimer.unref();
    };

    resetStallTimer();

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, options.timeoutMs);
    timeoutTimer.unref();

    const onAbort = () => {
      aborted = true;
      terminateChild();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (stallTimer) clearTimeout(stallTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      resetStallTimer();
      stdout += chunk;
      if (options.onStdoutLine) {
        stdoutRemainder += chunk;
        const lines = stdoutRemainder.split(/\r?\n|\r/);
        stdoutRemainder = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length > 0) options.onStdoutLine(line);
        }
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      resetStallTimer();
      stderr += chunk;
      if (options.onStderrLine) {
        stderrRemainder += chunk;
        const lines = stderrRemainder.split(/\r?\n|\r/);
        stderrRemainder = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length > 0) options.onStderrLine(line);
        }
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (options.onStdoutLine && stdoutRemainder.length > 0) {
        options.onStdoutLine(stdoutRemainder);
      }
      if (options.onStderrLine && stderrRemainder.length > 0) {
        options.onStderrLine(stderrRemainder);
      }
      resolve({ code, stdout, stderr, timedOut, aborted });
    });
  });
}
