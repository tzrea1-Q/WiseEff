import { describe, expect, it } from "vitest";
import { authAttemptKey, createAuthAttemptLimiter } from "./authAttemptLimiter";

describe("createAuthAttemptLimiter", () => {
  it("allows up to maxAttempts inside the window and then blocks", () => {
    let now = 1_000;
    const limiter = createAuthAttemptLimiter({
      windowMs: 1_000,
      maxAttempts: 2,
      now: () => now
    });

    expect(limiter.consume("login:127.0.0.1:a")).toEqual({ allowed: true });
    expect(limiter.consume("login:127.0.0.1:a")).toEqual({ allowed: true });
    expect(limiter.consume("login:127.0.0.1:a")).toEqual({ allowed: false, retryAfterMs: 1_000 });
  });

  it("forgets attempts after the window and after reset", () => {
    let now = 1_000;
    const limiter = createAuthAttemptLimiter({
      windowMs: 1_000,
      maxAttempts: 1,
      now: () => now
    });

    expect(limiter.consume("k")).toEqual({ allowed: true });
    expect(limiter.consume("k").allowed).toBe(false);
    limiter.reset("k");
    expect(limiter.consume("k")).toEqual({ allowed: true });

    now = 3_000;
    expect(limiter.consume("k")).toEqual({ allowed: true });
  });

  it("builds distinct keys for login and register", () => {
    expect(authAttemptKey("login", "10.0.0.1", "xu.yun")).toBe("login:10.0.0.1:xu.yun");
    expect(authAttemptKey("register", "", "")).toBe("register:unknown:*");
  });
});
