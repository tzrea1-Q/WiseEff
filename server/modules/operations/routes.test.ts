import { describe, expect, it } from "vitest";

import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { developmentAuthContext } from "../auth/routes";
import type { DebugDeviceGateway } from "../debugging/gateway";
import { requestJson } from "../../test/testClient";
import { registerOperationsRoutes, type PilotReadinessEnv } from "./routes";

function createReadyDb(): Database {
  const db: Database = {
    query: async <Row,>() => ({
      rows: [{ ok: 1 }] as Row[],
      rowCount: 1
    }),
    transaction: async (fn) => fn(db)
  };

  return db;
}

function createReadyObjectStore() {
  return {
    checkHealth: async () => ({ ok: true as const, status: "ready" as const })
  };
}

function createFailedObjectStore(message = "Object store probe failed.") {
  return {
    checkHealth: async () => ({ ok: false as const, status: "failed" as const, message })
  };
}

function createDebugGateway(): DebugDeviceGateway {
  return {
    detectTargets: async () => ({ ok: true, targets: [] }),
    readNode: async () => ({ ok: true, durationMs: 1 }),
    writeNode: async () => ({
      ok: true,
      verified: true,
      durationMs: 1,
      writeResult: { ok: true, durationMs: 1 }
    })
  };
}

function createReadyAgentProvider() {
  return {
    metadata: () => ({ provider: "live" as const, model: "pilot", promptVersion: "m5" }),
    planTurn: async () => ({
      assistantDraft: { content: "Ready.", citations: [], confidence: 0.9 },
      toolRequests: [],
      provider: "live" as const,
      model: "pilot",
      promptVersion: "m5"
    }),
    checkHealth: async () => ({ ok: true as const, status: "ready" as const })
  };
}

function createFailedAgentProvider(message = "Agent provider unavailable.") {
  return {
    metadata: () => ({ provider: "live" as const, model: "pilot", promptVersion: "m5" }),
    planTurn: async () => ({
      assistantDraft: { content: "Blocked.", citations: [], confidence: 0.2 },
      toolRequests: [],
      provider: "live" as const,
      model: "pilot",
      promptVersion: "m5"
    }),
    checkHealth: async () => ({ ok: false as const, status: "failed" as const, message })
  };
}

function createAdminAuth() {
  return {
    ...developmentAuthContext,
    permissions: [...developmentAuthContext.permissions]
  };
}

function createNonAdminAuth() {
  return {
    ...developmentAuthContext,
    permissions: developmentAuthContext.permissions.filter((permission) => permission !== "admin:access")
  };
}

function createPilotReadinessEnv(
  overrides: Partial<PilotReadinessEnv> & {
    M5_CONTRACT_CHECK_PASSED?: boolean;
    M5_CONTRACT_ARTIFACT_CHECKED_AT?: string;
  } = {}
) {
  return {
    NODE_ENV: "production" as const,
    DEBUG_DEVICE_GATEWAY_MODE: "hdc" as const,
    DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: false,
    AGENT_PROVIDER: "live" as const,
    ...overrides
  };
}

function restoreProcessEnv(key: "M5_BACKUP_RESTORE_DRILL_AT", originalValue: string | undefined) {
  if (originalValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = originalValue;
}

describe("operations routes", () => {
  it("serves /health/live", async () => {
    const router = createRouter();
    registerOperationsRoutes(router, {});

    const response = await requestJson(createHttpServer(router), "/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, service: "wiseeff-api", status: "live" });
  });

  it("serves /health/ready with database status", async () => {
    const router = createRouter();
    const db = createReadyDb();
    registerOperationsRoutes(router, { db, objectStore: createReadyObjectStore() });

    const response = await requestJson(createHttpServer(router), "/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      status: "ready",
      dependencies: {
        database: { ok: true, status: "ready" },
        objectStore: { ok: true, status: "ready" }
      }
    });
  });

  it("reports /health/ready as unavailable when the database is missing", async () => {
    const router = createRouter();
    registerOperationsRoutes(router, {});

    const response = await requestJson(createHttpServer(router), "/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      ok: false,
      status: "not_ready",
      dependencies: {
        database: { ok: false, status: "missing" },
        objectStore: { ok: false, status: "missing" }
      }
    });
  });

  it("keeps /api/v1/health compatibility", async () => {
    const router = createRouter();
    registerOperationsRoutes(router, {});

    const response = await requestJson(createHttpServer(router), "/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "wiseeff-api" });
  });

  it("serves /api/v1/operations/pilot-readiness when all M5 gates are ready", async () => {
    const originalBackupDrillAt = process.env.M5_BACKUP_RESTORE_DRILL_AT;
    process.env.M5_BACKUP_RESTORE_DRILL_AT = "2026-05-29T09:00:00Z";

    try {
      const router = createRouter();
      const db = createReadyDb();
      registerOperationsRoutes(router, {
        db,
        objectStore: createReadyObjectStore(),
        debugGateway: createDebugGateway(),
        agentProvider: createReadyAgentProvider(),
        env: createPilotReadinessEnv({
          DEBUG_DEVICE_GATEWAY_MODE: "hdc",
          HDC_DEVICE_LAB_AVAILABLE: true,
          HDC_SMOKE_PROJECT_ID: "aurora",
          HDC_SMOKE_DEVICE_ID: "lab-device-1",
          HDC_SMOKE_TARGET_REF: "Aurora Simulator 1",
          HDC_SMOKE_PARAMETER_ID: "fast-charge-current",
          HDC_SMOKE_NODE_PATH: "/power/fast-charge-current",
          HDC_SMOKE_WRITE_VALUE: "3100",
          M5_CONTRACT_CHECK_PASSED: true
        }),
        getCurrentAuthContext: async () => createAdminAuth()
      });

      const response = await requestJson(createHttpServer(router), "/api/v1/operations/pilot-readiness");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        status: "pilot_ready",
        blockedBy: [],
        gates: {
          auth: { ok: true, status: "ready" },
          database: { ok: true, status: "ready" },
          objectStore: { ok: true, status: "ready" },
          worker: { ok: true, status: "ready" },
          deviceGateway: { ok: true, status: "ready" },
          agentProvider: { ok: true, status: "ready" },
          backups: { ok: true, status: "ready" }
        }
      });
    } finally {
      restoreProcessEnv("M5_BACKUP_RESTORE_DRILL_AT", originalBackupDrillAt);
    }
  });

  it("blocks /api/v1/operations/pilot-readiness when contract evidence is missing", async () => {
    const originalBackupDrillAt = process.env.M5_BACKUP_RESTORE_DRILL_AT;
    process.env.M5_BACKUP_RESTORE_DRILL_AT = "2026-05-29T09:00:00Z";

    try {
      const router = createRouter();
      const db = createReadyDb();
      registerOperationsRoutes(router, {
        db,
        objectStore: createReadyObjectStore(),
        debugGateway: createDebugGateway(),
        agentProvider: createReadyAgentProvider(),
        env: createPilotReadinessEnv({
          DEBUG_DEVICE_GATEWAY_MODE: "hdc",
          HDC_DEVICE_LAB_AVAILABLE: true,
          HDC_SMOKE_PROJECT_ID: "aurora",
          HDC_SMOKE_DEVICE_ID: "lab-device-1",
          HDC_SMOKE_TARGET_REF: "Aurora Simulator 1",
          HDC_SMOKE_PARAMETER_ID: "fast-charge-current",
          HDC_SMOKE_NODE_PATH: "/power/fast-charge-current",
          HDC_SMOKE_WRITE_VALUE: "3100"
        }),
        getCurrentAuthContext: async () => createAdminAuth()
      });

      const response = await requestJson(createHttpServer(router), "/api/v1/operations/pilot-readiness");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: false,
        status: "blocked",
        blockedBy: ["contract"],
        gates: {
          contract: { ok: false, status: "missing" }
        }
      });
    } finally {
      restoreProcessEnv("M5_BACKUP_RESTORE_DRILL_AT", originalBackupDrillAt);
    }
  });

  it("treats recorded contract evidence as ready", async () => {
    const originalBackupDrillAt = process.env.M5_BACKUP_RESTORE_DRILL_AT;
    process.env.M5_BACKUP_RESTORE_DRILL_AT = "2026-05-29T09:00:00Z";

    try {
      const router = createRouter();
      const db = createReadyDb();
      registerOperationsRoutes(router, {
        db,
        objectStore: createReadyObjectStore(),
        debugGateway: createDebugGateway(),
        agentProvider: createReadyAgentProvider(),
        env: createPilotReadinessEnv({
          DEBUG_DEVICE_GATEWAY_MODE: "hdc",
          HDC_DEVICE_LAB_AVAILABLE: true,
          HDC_SMOKE_PROJECT_ID: "aurora",
          HDC_SMOKE_DEVICE_ID: "lab-device-1",
          HDC_SMOKE_TARGET_REF: "Aurora Simulator 1",
          HDC_SMOKE_PARAMETER_ID: "fast-charge-current",
          HDC_SMOKE_NODE_PATH: "/power/fast-charge-current",
          HDC_SMOKE_WRITE_VALUE: "3100",
          M5_CONTRACT_CHECK_PASSED: true
        }),
        getCurrentAuthContext: async () => createAdminAuth()
      });

      const response = await requestJson(createHttpServer(router), "/api/v1/operations/pilot-readiness");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        status: "pilot_ready",
        blockedBy: [],
        gates: {
          contract: { ok: true, status: "ready" }
        }
      });
    } finally {
      restoreProcessEnv("M5_BACKUP_RESTORE_DRILL_AT", originalBackupDrillAt);
    }
  });

  it("serves /api/v1/operations/pilot-readiness with blocked dependencies", async () => {
    const originalBackupDrillAt = process.env.M5_BACKUP_RESTORE_DRILL_AT;
    delete process.env.M5_BACKUP_RESTORE_DRILL_AT;

    try {
      const router = createRouter();
      const db = createReadyDb();
      registerOperationsRoutes(router, {
        db,
        objectStore: createFailedObjectStore(),
        debugGateway: createDebugGateway(),
        agentProvider: createFailedAgentProvider(),
        env: createPilotReadinessEnv({
          M5_CONTRACT_CHECK_PASSED: true
        }),
        getCurrentAuthContext: async () => createAdminAuth()
      });

      const response = await requestJson(createHttpServer(router), "/api/v1/operations/pilot-readiness");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: false,
        status: "blocked",
        blockedBy: ["objectStore", "deviceGateway", "agentProvider", "backups"],
        gates: {
          contract: { ok: true, status: "ready" },
          auth: { ok: true, status: "ready" },
          database: { ok: true, status: "ready" },
          objectStore: { ok: false, status: "failed" },
          worker: { ok: true, status: "ready" },
          deviceGateway: { ok: false, status: "missing" },
          agentProvider: { ok: false, status: "failed" },
          backups: { ok: false, status: "missing" }
        }
      });
    } finally {
      restoreProcessEnv("M5_BACKUP_RESTORE_DRILL_AT", originalBackupDrillAt);
    }
  });

  it("blocks HDC device gateway mode without device-lab evidence", async () => {
    const originalBackupDrillAt = process.env.M5_BACKUP_RESTORE_DRILL_AT;
    process.env.M5_BACKUP_RESTORE_DRILL_AT = "2026-05-29T09:00:00Z";

    try {
      const router = createRouter();
      const db = createReadyDb();
      registerOperationsRoutes(router, {
        db,
        objectStore: createReadyObjectStore(),
        debugGateway: createDebugGateway(),
        agentProvider: createReadyAgentProvider(),
        env: createPilotReadinessEnv({
          DEBUG_DEVICE_GATEWAY_MODE: "hdc",
          M5_CONTRACT_CHECK_PASSED: true
        }),
        getCurrentAuthContext: async () => createAdminAuth()
      });

      const response = await requestJson(createHttpServer(router), "/api/v1/operations/pilot-readiness");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: false,
        status: "blocked",
        blockedBy: ["deviceGateway"],
        gates: {
          deviceGateway: { ok: false, status: "missing" }
        }
      });
    } finally {
      restoreProcessEnv("M5_BACKUP_RESTORE_DRILL_AT", originalBackupDrillAt);
    }
  });

  it("allows HDC device gateway mode with explicit device-lab evidence", async () => {
    const originalBackupDrillAt = process.env.M5_BACKUP_RESTORE_DRILL_AT;
    process.env.M5_BACKUP_RESTORE_DRILL_AT = "2026-05-29T09:00:00Z";

    try {
      const router = createRouter();
      const db = createReadyDb();
      registerOperationsRoutes(router, {
        db,
        objectStore: createReadyObjectStore(),
        debugGateway: createDebugGateway(),
        agentProvider: createReadyAgentProvider(),
        env: createPilotReadinessEnv({
          DEBUG_DEVICE_GATEWAY_MODE: "hdc",
          HDC_DEVICE_LAB_AVAILABLE: true,
          HDC_SMOKE_PROJECT_ID: "aurora",
          HDC_SMOKE_DEVICE_ID: "lab-device-1",
          HDC_SMOKE_TARGET_REF: "Aurora Simulator 1",
          HDC_SMOKE_PARAMETER_ID: "fast-charge-current",
          HDC_SMOKE_NODE_PATH: "/power/fast-charge-current",
          HDC_SMOKE_WRITE_VALUE: "3100",
          M5_CONTRACT_CHECK_PASSED: true
        }),
        getCurrentAuthContext: async () => createAdminAuth()
      });

      const response = await requestJson(createHttpServer(router), "/api/v1/operations/pilot-readiness");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        status: "pilot_ready",
        blockedBy: [],
        gates: {
          deviceGateway: { ok: true, status: "ready" }
        }
      });
    } finally {
      restoreProcessEnv("M5_BACKUP_RESTORE_DRILL_AT", originalBackupDrillAt);
    }
  });

  it("forbids /api/v1/operations/pilot-readiness without admin access", async () => {
    const router = createRouter();
    const db = createReadyDb();
    registerOperationsRoutes(router, {
      db,
      objectStore: createReadyObjectStore(),
      debugGateway: {} as never,
      agentProvider: createReadyAgentProvider(),
      env: createPilotReadinessEnv(),
      getCurrentAuthContext: async () => createNonAdminAuth()
    });

    const response = await requestJson(createHttpServer(router), "/api/v1/operations/pilot-readiness");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "FORBIDDEN",
        message: "Admin access required."
      }
    });
  });

  it("blocks simulator and deterministic M5 modes from returning pilot ready", async () => {
    const originalBackupDrillAt = process.env.M5_BACKUP_RESTORE_DRILL_AT;
    process.env.M5_BACKUP_RESTORE_DRILL_AT = "2026-05-29T09:00:00Z";

    try {
      const router = createRouter();
      const db = createReadyDb();
      registerOperationsRoutes(router, {
        db,
        objectStore: createReadyObjectStore(),
        debugGateway: {} as never,
        agentProvider: createReadyAgentProvider(),
        env: createPilotReadinessEnv({
          DEBUG_DEVICE_GATEWAY_MODE: "simulator",
          AGENT_PROVIDER: "deterministic",
          M5_CONTRACT_CHECK_PASSED: true
        }),
        getCurrentAuthContext: async () => createAdminAuth()
      });

      const response = await requestJson(createHttpServer(router), "/api/v1/operations/pilot-readiness");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: false,
        status: "blocked",
        blockedBy: ["deviceGateway", "agentProvider"],
        gates: {
          deviceGateway: { ok: false, status: "blocked" },
          agentProvider: { ok: false, status: "blocked" }
        }
      });
    } finally {
      restoreProcessEnv("M5_BACKUP_RESTORE_DRILL_AT", originalBackupDrillAt);
    }
  });

  it("uses durable queue health for the worker pilot gate when provided", async () => {
    const originalBackupDrillAt = process.env.M5_BACKUP_RESTORE_DRILL_AT;
    process.env.M5_BACKUP_RESTORE_DRILL_AT = "2026-05-29T09:00:00Z";

    try {
      const router = createRouter();
      const db = createReadyDb();
      registerOperationsRoutes(router, {
        db,
        objectStore: createReadyObjectStore(),
        debugGateway: createDebugGateway(),
        agentProvider: createReadyAgentProvider(),
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
        },
        env: createPilotReadinessEnv({
          DEBUG_DEVICE_GATEWAY_MODE: "hdc",
          HDC_DEVICE_LAB_AVAILABLE: true,
          HDC_SMOKE_PROJECT_ID: "aurora",
          HDC_SMOKE_DEVICE_ID: "lab-device-1",
          HDC_SMOKE_TARGET_REF: "Aurora Simulator 1",
          HDC_SMOKE_PARAMETER_ID: "fast-charge-current",
          HDC_SMOKE_NODE_PATH: "/power/fast-charge-current",
          HDC_SMOKE_WRITE_VALUE: "3100",
          M5_CONTRACT_CHECK_PASSED: true
        }),
        getCurrentAuthContext: async () => createAdminAuth()
      });

      const response = await requestJson(createHttpServer(router), "/api/v1/operations/pilot-readiness");

      expect(response.body).toMatchObject({
        ok: false,
        status: "blocked",
        blockedBy: ["worker"],
        gates: {
          worker: {
            ok: false,
            status: "failed",
            message: "Redis connection failed."
          }
        }
      });
    } finally {
      restoreProcessEnv("M5_BACKUP_RESTORE_DRILL_AT", originalBackupDrillAt);
    }
  });
});
