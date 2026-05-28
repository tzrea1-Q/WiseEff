import { describe, expect, it } from "vitest";
import { decideRetry } from "./retryPolicy";

describe("job retry policy", () => {
  it("schedules exponential backoff before max attempts", () => {
    expect(
      decideRetry({
        attemptCount: 1,
        maxAttempts: 4,
        baseDelayMs: 1000,
        now: new Date("2026-05-28T00:00:00.000Z")
      })
    ).toEqual({
      action: "retry",
      nextRunAt: "2026-05-28T00:00:02.000Z",
      reason: "Retry 2 of 4 after 2000ms."
    });
  });

  it("dead-letters when attempts are exhausted", () => {
    expect(
      decideRetry({
        attemptCount: 4,
        maxAttempts: 4,
        baseDelayMs: 1000,
        now: new Date("2026-05-28T00:00:00.000Z")
      })
    ).toEqual({
      action: "dead-letter",
      reason: "Job exhausted 4 attempts."
    });
  });
});
