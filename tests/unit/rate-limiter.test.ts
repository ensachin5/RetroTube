import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";

describe("rate-limiter", () => {
  it("allows requests up to limit and blocks excess within the window", () => {
    const limiter = new SlidingWindowRateLimiter();
    const baseTime = 1_700_000_000_000;

    expect(limiter.check("fetch", "10.0.0.1", 3, 60_000, baseTime)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
    expect(limiter.check("fetch", "10.0.0.1", 3, 60_000, baseTime + 100)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.check("fetch", "10.0.0.1", 3, 60_000, baseTime + 200)).toMatchObject({
      allowed: true,
      remaining: 0,
    });

    const blocked = limiter.check("fetch", "10.0.0.1", 3, 60_000, baseTime + 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);

    // Different IP or different bucket remains unaffected
    expect(limiter.check("fetch", "10.0.0.2", 3, 60_000, baseTime + 300).allowed).toBe(
      true,
    );
    expect(limiter.check("download", "10.0.0.1", 3, 60_000, baseTime + 300).allowed).toBe(
      true,
    );

    // Sliding window frees slots once window expires
    expect(limiter.check("fetch", "10.0.0.1", 3, 60_000, baseTime + 60_001).allowed).toBe(
      true,
    );
  });

  it("throws AppError RATE_LIMITED when enforce() exceeds limit", () => {
    const limiter = new SlidingWindowRateLimiter();
    limiter.enforce("fetch", "1.2.3.4", 1, 60_000, 1000);

    let caught: unknown;
    try {
      limiter.enforce("fetch", "1.2.3.4", 1, 60_000, 2000);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ERROR_CODES.RATE_LIMITED);
    expect((caught as AppError).status).toBe(429);
  });
});
