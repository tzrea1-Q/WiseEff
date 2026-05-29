import { describe, expect, it } from "vitest";

import type { Queryable } from "../../shared/database/client";
import { buildLiveHealth, buildReadyHealth } from "./health";

describe("operations health", () => {
  it("reports liveness without checking dependencies", () => {
    expect(buildLiveHealth()).toMatchObject({
      ok: true,
      service: "wiseeff-api",
      status: "live"
    });
  });

  it("reports ready when database dependency passes", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>() => ({ rows: [{ ok: 1 } as Row], rowCount: 1 })
    };
    const objectStore = {
      checkHealth: async () => ({ ok: true as const, status: "ready" as const })
    };

    await expect(buildReadyHealth({ db, objectStore })).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        service: "wiseeff-api",
        status: "ready",
        dependencies: {
          database: { ok: true, status: "ready" },
          objectStore: { ok: true, status: "ready" }
        }
      }
    });
  });

  it("returns 503 with actionable dependency status when database is missing", async () => {
    await expect(buildReadyHealth({})).resolves.toMatchObject({
      status: 503,
      body: {
        ok: false,
        service: "wiseeff-api",
        status: "not_ready",
        dependencies: {
          database: {
            ok: false,
            status: "missing",
            message: "DATABASE_URL is not configured for this API process."
          },
          objectStore: {
            ok: false,
            status: "missing",
            message: "Object storage is not configured for this API process."
          }
        }
      }
    });
  });

  it("returns 503 when object store readiness fails", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>() => ({ rows: [{ ok: 1 } as Row], rowCount: 1 })
    };
    const objectStore = {
      checkHealth: async () => ({
        ok: false as const,
        status: "failed" as const,
        message: "Object store probe failed."
      })
    };

    await expect(buildReadyHealth({ db, objectStore })).resolves.toMatchObject({
      status: 503,
      body: {
        ok: false,
        status: "not_ready",
        dependencies: {
          database: { ok: true, status: "ready" },
          objectStore: { ok: false, status: "failed", message: "Object store probe failed." }
        }
      }
    });
  });

  it("returns 503 when object store readiness throws", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>() => ({ rows: [{ ok: 1 } as Row], rowCount: 1 })
    };
    const objectStore = {
      checkHealth: async () => {
        throw new Error("object store permission denied");
      }
    };

    await expect(buildReadyHealth({ db, objectStore })).resolves.toMatchObject({
      status: 503,
      body: {
        ok: false,
        status: "not_ready",
        dependencies: {
          database: { ok: true, status: "ready" },
          objectStore: { ok: false, status: "failed", message: "object store permission denied" }
        }
      }
    });
  });

  it("includes worker queue health in readiness when requested", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>(text: string) => {
        if (text.includes("from jobs")) {
          return {
            rows: [
              {
                queued: "1",
                processing: "0",
                dead_lettered: "0",
                oldest_queued_at: null
              } as Row
            ],
            rowCount: 1
          };
        }

        return { rows: [{ ok: 1 } as Row], rowCount: 1 };
      }
    };
    const objectStore = {
      checkHealth: async () => ({ ok: true as const, status: "ready" as const })
    };

    await expect(buildReadyHealth({ db, objectStore, includeWorkerQueue: true })).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        dependencies: {
          workerQueue: {
            ok: true,
            status: "ready",
            queued: 1,
            processing: 0,
            deadLettered: 0,
            oldestQueuedAgeMs: null
          }
        }
      }
    });
  });

  it("includes agent provider readiness when requested", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>() => ({ rows: [{ ok: 1 } as Row], rowCount: 1 })
    };
    const objectStore = {
      checkHealth: async () => ({ ok: true as const, status: "ready" as const })
    };
    const agentProvider = {
      metadata: () => ({ provider: "live" as const, model: "pilot-model", promptVersion: "m5-agent-v1" }),
      planTurn: async () => ({
        assistantDraft: { content: "Ready.", citations: [], confidence: 0.8 },
        toolRequests: [],
        provider: "live" as const,
        model: "pilot-model",
        promptVersion: "m5-agent-v1"
      }),
      checkHealth: async () => ({ ok: true as const, status: "ready" as const })
    };

    await expect(buildReadyHealth({ db, objectStore, agentProvider })).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        dependencies: {
          agentProvider: { ok: true, status: "ready" }
        }
      }
    });
  });
});
