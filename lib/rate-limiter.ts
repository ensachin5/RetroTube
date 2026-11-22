import { AppError, ERROR_CODES } from "./errors";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSec: number;
}

interface BucketEntry {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly store = new Map<string, BucketEntry>();
  private lastPruneAt = 0;

  public check(
    bucket: string,
    key: string,
    limit: number,
    windowMs = 60_000,
    now = Date.now(),
  ): RateLimitResult {
    this.maybePrune(windowMs, now);

    const compositeKey = `${bucket}:${key}`;
    const entry = this.store.get(compositeKey) ?? { timestamps: [] };
    const cutoff = now - windowMs;

    // Keep only timestamps within the active sliding window
    const active = entry.timestamps.filter((ts) => ts > cutoff);

    if (active.length >= limit) {
      this.store.set(compositeKey, { timestamps: active });
      const oldest = active[0] ?? now;
      const retryAfterMs = Math.max(1000, oldest + windowMs - now);
      return {
        allowed: false,
        remaining: 0,
        limit,
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
      };
    }

    active.push(now);
    this.store.set(compositeKey, { timestamps: active });

    return {
      allowed: true,
      remaining: Math.max(0, limit - active.length),
      limit,
      retryAfterSec: 0,
    };
  }

  public enforce(
    bucket: string,
    key: string,
    limit: number,
    windowMs = 60_000,
    now = Date.now(),
  ): RateLimitResult {
    const result = this.check(bucket, key, limit, windowMs, now);
    if (!result.allowed) {
      throw new AppError({
        code: ERROR_CODES.RATE_LIMITED,
        status: 429,
        message: `Rate limit exceeded. Please wait ${result.retryAfterSec}s before trying again.`,
        details: {
          bucket,
          limit,
          retryAfterSec: result.retryAfterSec,
        },
      });
    }
    return result;
  }

  public reset(): void {
    this.store.clear();
    this.lastPruneAt = 0;
  }

  private maybePrune(windowMs: number, now: number): void {
    if (now - this.lastPruneAt < windowMs) return;
    this.lastPruneAt = now;
    const cutoff = now - windowMs;

    for (const [k, v] of this.store.entries()) {
      const fresh = v.timestamps.filter((ts) => ts > cutoff);
      if (fresh.length === 0) {
        this.store.delete(k);
      } else {
        v.timestamps = fresh;
      }
    }
  }
}

const globalForRateLimiter = globalThis as typeof globalThis & {
  __retrotubeRateLimiter?: SlidingWindowRateLimiter;
};

export function getRateLimiter(): SlidingWindowRateLimiter {
  if (!globalForRateLimiter.__retrotubeRateLimiter) {
    globalForRateLimiter.__retrotubeRateLimiter = new SlidingWindowRateLimiter();
  }
  return globalForRateLimiter.__retrotubeRateLimiter;
}
