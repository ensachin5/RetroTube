import { getEnv } from "./env";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogContext {
  requestId?: string;
  jobId?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  errorCode?: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  try {
    const configured = getEnv().LOG_LEVEL;
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configured];
  } catch {
    return true;
  }
}

function writeLog(level: LogLevel, msg: string, context?: LogContext): void {
  if (!shouldLog(level)) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...context,
  };

  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, context?: LogContext): void => writeLog("debug", msg, context),
  info: (msg: string, context?: LogContext): void => writeLog("info", msg, context),
  warn: (msg: string, context?: LogContext): void => writeLog("warn", msg, context),
  error: (msg: string, context?: LogContext): void => writeLog("error", msg, context),
};
