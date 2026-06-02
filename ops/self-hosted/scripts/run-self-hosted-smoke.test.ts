import { describe, expect, it } from "vitest";
import { buildSelfHostedSmokeEvidence, runSelfHostedSmokeChecks, redactSecret, type SelfHostedSmokeCheck } from "./run-self-hosted-smoke";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": `req-${status}` }
  });
}

describe("self-hosted smoke runner", () => {
  it("probes live, ready, current user, and pilot-readiness endpoints", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push(`${String(url)} ${String((init?.headers as Record<string, string>).Authorization)}`);
      if (String(url).endsWith("/health/live")) return response(200, { ok: true });
      if (String(url).endsWith("/health/ready")) {
        return response(200, {
          ok: true,
          dependencies: {
            durableQueue: {
              ok: true,
              status: "ready",
              transport: { ok: true, status: "ready" },
              database: { ok: true, status: "ready" }
            }
          }
        });
      }
      if (String(url).endsWith("/api/v1/me")) return response(200, { user: { id: "u-xu-yun" } });
      if (String(url).endsWith("/api/v1/operations/pilot-readiness")) {
        return response(200, { ok: false, status: "blocked", blockedBy: ["deviceGateway"] });
      }
      return response(404, { ok: false });
    };

    const result = await runSelfHostedSmokeChecks({
      baseUrl: "https://wiseeff.example.test",
      authorization: "Bearer secret-token",
      allowedBlockedGates: ["deviceGateway"],
      fetchImpl
    });

    expect(result.status).toBe("passed");
    expect(result.checks.map((check) => check.name)).toEqual(["health live", "health ready", "current user", "pilot readiness"]);
    expect(calls).toEqual([
      "https://wiseeff.example.test/health/live Bearer secret-token",
      "https://wiseeff.example.test/health/ready Bearer secret-token",
      "https://wiseeff.example.test/api/v1/me Bearer secret-token",
      "https://wiseeff.example.test/api/v1/operations/pilot-readiness Bearer secret-token"
    ]);
  });

  it("fails when pilot readiness is blocked by an unexpected gate", async () => {
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/api/v1/operations/pilot-readiness")) {
        return response(200, { ok: false, status: "blocked", blockedBy: ["auth"] });
      }
      return response(200, { ok: true });
    };

    const result = await runSelfHostedSmokeChecks({
      baseUrl: "https://wiseeff.example.test/",
      authorization: "Bearer secret-token",
      allowedBlockedGates: ["deviceGateway"],
      fetchImpl
    });

    expect(result.status).toBe("failed");
    expect(result.checks.at(-1)).toMatchObject({
      name: "pilot readiness",
      status: "failed"
    });
  });

  it("fails when ready health omits durable queue dependencies", async () => {
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/health/ready")) {
        return response(200, { ok: true, dependencies: { database: { ok: true, status: "ready" } } });
      }
      if (String(url).endsWith("/api/v1/operations/pilot-readiness")) {
        return response(200, { ok: false, status: "blocked", blockedBy: ["deviceGateway"] });
      }
      return response(200, { ok: true });
    };

    const result = await runSelfHostedSmokeChecks({
      baseUrl: "https://wiseeff.example.test",
      authorization: "Bearer secret-token",
      allowedBlockedGates: ["deviceGateway"],
      fetchImpl
    });

    expect(result.status).toBe("failed");
    expect(result.checks.find((check) => check.name === "health ready")).toMatchObject({
      status: "failed",
      detail: "Ready health does not include dependencies.durableQueue."
    });
  });

  it("accepts a fully pilot-ready target", async () => {
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/health/ready")) {
        return response(200, {
          ok: true,
          dependencies: {
            durableQueue: {
              ok: true,
              status: "ready",
              transport: { ok: true, status: "ready" },
              database: { ok: true, status: "ready" }
            }
          }
        });
      }
      if (String(url).endsWith("/api/v1/operations/pilot-readiness")) {
        return response(200, { ok: true, status: "pilot_ready", blockedBy: [] });
      }

      return response(200, { ok: true });
    };

    const result = await runSelfHostedSmokeChecks({
      baseUrl: "https://wiseeff.example.test",
      authorization: "Bearer secret-token",
      fetchImpl
    });

    expect(result.status).toBe("passed");
    expect(result.checks.at(-1)).toMatchObject({
      name: "pilot readiness",
      status: "passed",
      statusCode: 200
    });
  });

  it("renders redacted evidence without leaking bearer values", () => {
    const checks: SelfHostedSmokeCheck[] = [
      { name: "health live", status: "passed", statusCode: 200, detail: "ok" },
      { name: "current user", status: "failed", statusCode: 401, detail: "Unauthorized" }
    ];

    const evidence = buildSelfHostedSmokeEvidence({
      date: "2026-06-02T00:00:00.000Z",
      branch: "codex/m6-self-hosted-planning",
      commit: "abc123",
      baseUrl: "https://wiseeff.example.test",
      authorization: "Bearer secret-token",
      status: "failed",
      checks
    });

    expect(evidence).toContain("# M6.1 Self-Hosted Runtime Evidence");
    expect(evidence).toContain("| Authorization | <set> |");
    expect(evidence).toContain("| current user | failed | 401 | Unauthorized |");
    expect(evidence).not.toContain("secret-token");
    expect(redactSecret("Bearer secret-token")).toBe("<set>");
  });
});
