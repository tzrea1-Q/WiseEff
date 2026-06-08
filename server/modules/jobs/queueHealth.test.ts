import { describe, expect, it } from "vitest";

import { buildDurableQueueHealth } from "./queueHealth";

describe("durable queue health model", () => {
  it("is ready when Redis transport and database job state are healthy", () => {
    expect(
      buildDurableQueueHealth({
        transport: {
          ok: true,
          status: "ready",
          waiting: 2,
          active: 1,
          completed: 4,
          failed: 0,
          delayed: 0,
          paused: false
        },
        database: {
          ok: true,
          status: "ready",
          queued: 2,
          processing: 1,
          deadLettered: 0,
          oldestQueuedAgeMs: 500
        }
      })
    ).toEqual({
      ok: true,
      status: "ready",
      transport: {
        ok: true,
        status: "ready",
        waiting: 2,
        active: 1,
        completed: 4,
        failed: 0,
        delayed: 0,
        paused: false
      },
      database: {
        ok: true,
        status: "ready",
        queued: 2,
        processing: 1,
        deadLettered: 0,
        oldestQueuedAgeMs: 500
      }
    });
  });

  it("is degraded when transport is ready but database jobs have dead letters", () => {
    const health = buildDurableQueueHealth({
      transport: {
        ok: true,
        status: "ready",
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false
      },
      database: {
        ok: false,
        status: "degraded",
        queued: 0,
        processing: 0,
        deadLettered: 1,
        oldestQueuedAgeMs: null,
        message: "1 log analysis job(s) are dead-lettered."
      }
    });

    expect(health).toMatchObject({
      ok: false,
      status: "degraded",
      message: "1 log analysis job(s) are dead-lettered."
    });
  });

  it("fails when Redis transport is unavailable", () => {
    const health = buildDurableQueueHealth({
      transport: {
        ok: false,
        status: "failed",
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
        message: "Redis connection failed."
      },
      database: {
        ok: true,
        status: "ready",
        queued: 0,
        processing: 0,
        deadLettered: 0,
        oldestQueuedAgeMs: null
      }
    });

    expect(health).toMatchObject({
      ok: false,
      status: "failed",
      message: "Redis connection failed."
    });
  });
});
