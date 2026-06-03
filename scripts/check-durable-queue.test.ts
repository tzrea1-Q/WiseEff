import { describe, expect, it } from "vitest";

import {
  buildDurableQueueEvidence,
  evaluateDurableQueueReadyBody,
  parseDurableQueueArgs,
  runDurableQueueCli,
  runDurableQueueCheck
} from "./check-durable-queue";

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

  it("parses equals-form CLI arguments and npm config fallback values", () => {
    expect(parseDurableQueueArgs(["--base-url=https://target.example.test"], {})).toMatchObject({
      baseUrl: "https://target.example.test"
    });
    expect(
      parseDurableQueueArgs(
        ["--env-file=ops/self-hosted/target.env", "--authorization=Bearer local", "--output=docs/generated/queue.md"],
        { npm_config_base_url: "https://npm.example.test" }
      )
    ).toMatchObject({
      envFile: "ops/self-hosted/target.env",
      baseUrl: "https://npm.example.test",
      authorization: "Bearer local",
      output: "docs/generated/queue.md"
    });
  });

  it("builds redacted markdown evidence for release records", () => {
    const evidence = buildDurableQueueEvidence({
      date: "2026-06-03T00:00:00.000Z",
      baseUrl: "https://wiseeff.example.test?token=secret",
      authorization: "Bearer sensitive-token",
      result: {
        status: "passed",
        detail: "Durable queue transport and PostgreSQL job state are ready.",
        body: readyBody()
      }
    });

    expect(evidence).toContain("## M6.4 Durable Queue Readiness Evidence");
    expect(evidence).toContain("- Status: `passed`");
    expect(evidence).toContain("- Base URL: `https://wiseeff.example.test?token=<redacted>`");
    expect(evidence).toContain("- Authorization: `<set>`");
    expect(evidence).toContain("Durable queue transport and PostgreSQL job state are ready.");
    expect(evidence).not.toContain("sensitive-token");
    expect(evidence).not.toContain("token=secret");
  });

  it("writes failed evidence when the target base URL is missing", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const result = await runDurableQueueCli({
      args: ["--output=docs/generated/missing-queue.md"],
      env: {},
      fileSystem: {
        existsSync: () => false,
        readFileSync: () => "",
        mkdirSync: () => undefined,
        writeFileSync: (filePath, content) => writes.push({ path: filePath, content })
      }
    });

    expect(result.status).toBe("failed");
    expect(result.detail).toBe("Durable queue check requires --base-url, WISEEFF_API_BASE_URL, or VITE_WISEEFF_API_BASE_URL.");
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("docs/generated/missing-queue.md");
    expect(writes[0].content).toContain("- Status: `failed`");
    expect(writes[0].content).toContain("Durable queue check requires --base-url");
    expect(writes[0].content).toContain("```json\nnull\n```");
  });
});
