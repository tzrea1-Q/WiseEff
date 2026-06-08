import { describe, expect, it } from "vitest";

import { evaluateDurableQueueReadyBody, runDurableQueueCheck } from "./check-durable-queue";

function readyBody(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    dependencies: {
      durableQueue: {
        ok: true,
        status: "ready",
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
          ok: true,
          status: "ready",
          queued: 0,
          processing: 0,
          deadLettered: 0,
          oldestQueuedAgeMs: null
        }
      }
    },
    ...overrides
  };
}

describe("durable queue check", () => {
  it("passes only when ready health contains durable transport and database job health", () => {
    expect(evaluateDurableQueueReadyBody(readyBody())).toEqual({
      status: "passed",
      detail: "Durable queue transport and PostgreSQL job state are ready."
    });
  });

  it("fails when durable queue health is missing from readiness", () => {
    expect(evaluateDurableQueueReadyBody({ ok: true, dependencies: {} })).toEqual({
      status: "failed",
      detail: "Ready health does not include dependencies.durableQueue."
    });
  });

  it("fails when Redis transport is not ready", () => {
    expect(
      evaluateDurableQueueReadyBody(
        readyBody({
          dependencies: {
            durableQueue: {
              ok: false,
              status: "failed",
              message: "Redis connection failed.",
              transport: { ok: false, status: "failed" },
              database: { ok: true, status: "ready" }
            }
          }
        })
      )
    ).toEqual({
      status: "failed",
      detail: "Durable queue health is failed: Redis connection failed."
    });
  });

  it("fetches /health/ready and evaluates durable queue dependencies", async () => {
    const calls: string[] = [];
    const result = await runDurableQueueCheck({
      baseUrl: "https://wiseeff.example.test/",
      authorization: "Bearer token",
      fetchImpl: async (url, init) => {
        calls.push(`${String(url)} ${String((init?.headers as Record<string, string>).Authorization)}`);
        return new Response(JSON.stringify(readyBody()), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    expect(result.status).toBe("passed");
    expect(calls).toEqual(["https://wiseeff.example.test/health/ready Bearer token"]);
  });
});
