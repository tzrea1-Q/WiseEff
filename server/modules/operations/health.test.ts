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
          objectStore: {
            ok: false,
            status: "failed",
            message: "Object store readiness failed. Verify endpoint, bucket, credentials, TLS policy, and S3 compatibility."
          }
        }
      }
    });
  });

  it("returns 503 with sanitized actionable object-store readiness failures", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>() => ({ rows: [{ ok: 1 } as Row], rowCount: 1 })
    };
    const objectStore = {
      checkHealth: async () => {
        throw new Error("AccessDenied secretAccessKey=super-secret https://storage.example.com/bucket?X-Amz-Signature=abc");
      }
    };

    await expect(buildReadyHealth({ db, objectStore })).resolves.toMatchObject({
      status: 503,
      body: {
        ok: false,
        status: "not_ready",
        dependencies: {
          database: { ok: true, status: "ready" },
          objectStore: {
            ok: false,
            status: "failed",
            message: "Object store readiness failed: credentials or access policy denied. Verify endpoint, bucket policy, access key, and secret rotation."
          }
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

  it("includes durable queue transport health separately from database job stats", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>(text: string) => {
        if (text.includes("from jobs")) {
          return {
            rows: [
              {
                queued: "0",
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

    await expect(
      buildReadyHealth({
        db,
        objectStore,
        includeWorkerQueue: true,
        durableQueue: {
          ok: true,
          status: "ready",
          waiting: 0,
          active: 0,
          completed: 1,
          failed: 0,
          delayed: 0,
          paused: false
        }
      })
    ).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        dependencies: {
          workerQueue: { ok: true, status: "ready" },
          durableQueue: {
            ok: true,
            status: "ready",
            transport: { waiting: 0, completed: 1 },
            database: { queued: 0, deadLettered: 0 }
          }
        }
      }
    });
  });

  it("loads durable queue transport health from a runtime checker", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>(text: string) => {
        if (text.includes("from jobs")) {
          return {
            rows: [{ queued: "0", processing: "0", dead_lettered: "0", oldest_queued_at: null } as Row],
            rowCount: 1
          };
        }
        return { rows: [{ ok: 1 } as Row], rowCount: 1 };
      }
    };
    const objectStore = {
      checkHealth: async () => ({ ok: true as const, status: "ready" as const })
    };
    let waiting = 0;
    const durableQueue = {
      checkHealth: async () => ({
        ok: true,
        status: "ready" as const,
        waiting: ++waiting,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false
      })
    };

    await expect(buildReadyHealth({ db, objectStore, includeWorkerQueue: true, durableQueue })).resolves.toMatchObject({
      body: { dependencies: { durableQueue: { transport: { waiting: 1 } } } }
    });
    await expect(buildReadyHealth({ db, objectStore, includeWorkerQueue: true, durableQueue })).resolves.toMatchObject({
      body: { dependencies: { durableQueue: { transport: { waiting: 2 } } } }
    });
  });

  it("returns 503 when durable queue transport is failed", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>(text: string) => {
        if (text.includes("from jobs")) {
          return {
            rows: [{ queued: "0", processing: "0", dead_lettered: "0", oldest_queued_at: null } as Row],
            rowCount: 1
          };
        }
        return { rows: [{ ok: 1 } as Row], rowCount: 1 };
      }
    };
    const objectStore = {
      checkHealth: async () => ({ ok: true as const, status: "ready" as const })
    };

    await expect(
      buildReadyHealth({
        db,
        objectStore,
        includeWorkerQueue: true,
        durableQueue: {
          ok: false,
          status: "failed",
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: false,
          message: "Redis connection failed."
        }
      })
    ).resolves.toMatchObject({
      status: 503,
      body: {
        ok: false,
        status: "not_ready",
        dependencies: {
          durableQueue: {
            ok: false,
            status: "failed",
            message: "Redis connection failed."
          }
        }
      }
    });
  });

  it("includes Xiaoze LLM readiness when env is provided", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>() => ({ rows: [{ ok: 1 } as Row], rowCount: 1 })
    };
    const objectStore = {
      checkHealth: async () => ({ ok: true as const, status: "ready" as const })
    };

    await expect(
      buildReadyHealth({
        db,
        objectStore,
        env: {
          AGENT_API_BASE_URL: "https://agent.example.com",
          AGENT_API_KEY: "test-key",
          XIAOZE_MODEL: "xiaoze-model"
        }
      })
    ).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        dependencies: {
          xiaozeLlm: {
            ok: true,
            status: "ready",
            details: {
              baseUrlConfigured: true,
              model: "xiaoze-model"
            }
          }
        }
      }
    });
  });

  it("reports missing Xiaoze LLM config when live mode env is incomplete", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>() => ({ rows: [{ ok: 1 } as Row], rowCount: 1 })
    };
    const objectStore = {
      checkHealth: async () => ({ ok: true as const, status: "ready" as const })
    };

    await expect(
      buildReadyHealth({
        db,
        objectStore,
        env: {
          AGENT_API_BASE_URL: "https://agent.example.com"
        }
      })
    ).resolves.toMatchObject({
      status: 503,
      body: {
        ok: false,
        dependencies: {
          xiaozeLlm: {
            ok: false,
            status: "missing",
            message: "Xiaoze LLM configuration is incomplete. Missing: AGENT_API_KEY."
          }
        }
      }
    });
  });

  it("treats deterministic Xiaoze mode as ready without LLM credentials", async () => {
    process.env.XIAOZE_DETERMINISTIC = "true";
    try {
      const db: Pick<Queryable, "query"> = {
        query: async <Row,>() => ({ rows: [{ ok: 1 } as Row], rowCount: 1 })
      };
      const objectStore = {
        checkHealth: async () => ({ ok: true as const, status: "ready" as const })
      };

      await expect(
        buildReadyHealth({
          db,
          objectStore,
          env: {}
        })
      ).resolves.toMatchObject({
        status: 200,
        body: {
          ok: true,
          dependencies: {
            xiaozeLlm: {
              ok: true,
              status: "ready",
              message: "Xiaoze deterministic mode; LLM API not required."
            }
          }
        }
      });
    } finally {
      delete process.env.XIAOZE_DETERMINISTIC;
    }
  });
});
