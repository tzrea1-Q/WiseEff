import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import type { DebugDeviceGateway } from "./gateway";
import { registerDebuggingRoutes } from "./routes";
import * as serviceModule from "./service";
import type {
  DebugDeviceRecord,
  DebugParameterRecord,
  DebugSessionRecord,
  DebugSnapshotRecord,
  DebugTargetRecord,
  NodeOperationRecord
} from "./types";

const serviceMocks = vi.hoisted(() => ({
  listDevices: vi.fn(),
  detectTargets: vi.fn(),
  listParameters: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  listSessionEvents: vi.fn(),
  readNode: vi.fn(),
  writeNode: vi.fn(),
  rollbackSnapshot: vi.fn()
}));

vi.mock("./service", () => ({
  createDebuggingService: vi.fn(() => serviceMocks)
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "aurora", roleId: "software-user" }],
    permissions: ["debugging:view", "debugging:read", "debugging:write", "debugging:rollback"],
    ...overrides
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function makeGateway(): DebugDeviceGateway {
  return {
    detectTargets: vi.fn(),
    readNode: vi.fn(),
    writeNode: vi.fn()
  };
}

function makeServer(options: { db?: Database; gateway?: DebugDeviceGateway; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerDebuggingRoutes(router, {
    db: options.db,
    debugGateway: options.gateway,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

const timestamp = "2026-05-27T10:00:00.000Z";

function deviceRecord(overrides: Partial<DebugDeviceRecord> = {}): DebugDeviceRecord {
  return {
    id: "device-1",
    organizationId: "org-1",
    projectId: "aurora",
    name: "Aurora Simulator",
    transport: "simulator",
    status: "online",
    firmware: "sim-1.0",
    lastSeenAt: timestamp,
    ...overrides
  };
}

function targetRecord(overrides: Partial<DebugTargetRecord> = {}): DebugTargetRecord {
  return {
    id: "target-1",
    organizationId: "org-1",
    projectId: "aurora",
    deviceId: "device-1",
    targetRef: "simulator://aurora-1",
    label: "Aurora Target",
    status: "detected",
    detectedAt: timestamp,
    ...overrides
  };
}

function parameterRecord(overrides: Partial<DebugParameterRecord> = {}): DebugParameterRecord {
  return {
    id: "param-1",
    organizationId: "org-1",
    projectId: "aurora",
    name: "Fast charge current",
    key: "fast_charge_current",
    description: "Controls constant charge current.",
    module: "Battery",
    nodePath: "/sys/current",
    accessMode: "RW",
    unit: "mA",
    range: "0-5000",
    minValue: 0,
    maxValue: 5000,
    risk: "Medium",
    currentValue: "3000",
    targetValue: "3200",
    sortOrder: 10,
    ...overrides
  };
}

function sessionRecord(overrides: Partial<DebugSessionRecord> = {}): DebugSessionRecord {
  return {
    id: "session-1",
    organizationId: "org-1",
    projectId: "aurora",
    deviceId: "device-1",
    targetId: "target-1",
    actorUserId: "user-1",
    status: "active",
    startedAt: timestamp,
    endedAt: null,
    ...overrides
  };
}

function operationRecord(overrides: Partial<NodeOperationRecord> = {}): NodeOperationRecord {
  return {
    id: "op-1",
    organizationId: "org-1",
    projectId: "aurora",
    sessionId: "session-1",
    parameterId: "param-1",
    nodePath: "/sys/current",
    operationType: "read",
    status: "succeeded",
    requestedValue: null,
    previousValue: null,
    readValue: "3000",
    readbackValue: null,
    verified: true,
    failureReason: null,
    durationMs: 5,
    approvalId: null,
    snapshotId: null,
    createdAt: timestamp,
    ...overrides
  };
}

function snapshotRecord(overrides: Partial<DebugSnapshotRecord> = {}): DebugSnapshotRecord {
  return {
    id: "snapshot-1",
    organizationId: "org-1",
    projectId: "aurora",
    sessionId: "session-1",
    operationId: "op-2",
    status: "valid",
    risk: "Medium",
    entries: [{ parameterId: "param-1", nodePath: "/sys/current", previousValue: "3000", targetValue: "3200" }],
    createdAt: timestamp,
    ...overrides
  };
}

describe("debugging routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(serviceModule.createDebuggingService).mockReturnValue(serviceMocks as unknown as ReturnType<typeof serviceModule.createDebuggingService>);
  });

  it("GET /api/v1/debugging/devices?projectId=aurora returns items", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const device = deviceRecord();
    serviceMocks.listDevices.mockResolvedValue([device]);

    const response = await requestJson<{ items: DebugDeviceRecord[] }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/devices?projectId=aurora"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [device] });
    expect(serviceModule.createDebuggingService).toHaveBeenCalledWith({ db, gateway });
    expect(serviceMocks.listDevices).toHaveBeenCalledWith(makeAuth(), { projectId: "aurora" });
  });

  it("POST /api/v1/debugging/targets/detect validates body and returns detected targets", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const target = targetRecord();
    serviceMocks.detectTargets.mockResolvedValue([target]);

    const response = await requestJson<{ items: DebugTargetRecord[] }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/targets/detect",
      {
        method: "POST",
        body: JSON.stringify({ projectId: "aurora", deviceId: "device-1" })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [target] });
    expect(serviceMocks.detectTargets).toHaveBeenCalledWith(
      makeAuth(),
      { projectId: "aurora", deviceId: "device-1" },
      { requestId: "test-request" }
    );
  });

  it("GET /api/v1/debugging/parameters?projectId=aurora returns debug parameter DTOs", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const parameter = parameterRecord();
    serviceMocks.listParameters.mockResolvedValue([parameter]);

    const response = await requestJson<{ items: DebugParameterRecord[] }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/parameters?projectId=aurora&risk=Medium&risk=High"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [parameter] });
    expect(serviceMocks.listParameters).toHaveBeenCalledWith(makeAuth(), { projectId: "aurora", risk: ["Medium", "High"] });
  });

  it("POST /api/v1/debugging/sessions returns a session", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const session = sessionRecord();
    serviceMocks.createSession.mockResolvedValue(session);

    const response = await requestJson<{ item: DebugSessionRecord }>(makeServer({ db, gateway }), "/api/v1/debugging/sessions", {
      method: "POST",
      body: JSON.stringify({ projectId: "aurora", deviceId: "device-1", targetId: "target-1" })
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item: session });
    expect(serviceMocks.createSession).toHaveBeenCalledWith(
      makeAuth(),
      {
        projectId: "aurora",
        deviceId: "device-1",
        targetId: "target-1"
      },
      { requestId: "test-request" }
    );
  });

  it("GET /api/v1/debugging/sessions/:sessionId returns a session from route params", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const session = sessionRecord({ id: "session-route" });
    serviceMocks.getSession.mockResolvedValue(session);

    const response = await requestJson<{ item: DebugSessionRecord | null }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/sessions/session-route"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item: session });
    expect(serviceMocks.getSession).toHaveBeenCalledWith(makeAuth(), { sessionId: "session-route" });
  });

  it("GET /api/v1/debugging/sessions/:sessionId/events uses route params", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const operation = operationRecord({ id: "op-route" });
    serviceMocks.listSessionEvents.mockResolvedValue([operation]);

    const response = await requestJson<{ items: NodeOperationRecord[] }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/sessions/session-route/events"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [operation] });
    expect(serviceMocks.listSessionEvents).toHaveBeenCalledWith(makeAuth(), { sessionId: "session-route" });
  });

  it("POST /api/v1/debugging/nodes/read returns an operation result", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const operation = operationRecord({ operationType: "read" });
    serviceMocks.readNode.mockResolvedValue(operation);

    const response = await requestJson<{ operation: NodeOperationRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/nodes/read",
      {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", parameterId: "param-1", nodePath: "/sys/current" })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ operation });
    expect(serviceMocks.readNode).toHaveBeenCalledWith(
      makeAuth(),
      {
        sessionId: "session-1",
        parameterId: "param-1",
        nodePath: "/sys/current"
      },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/debugging/nodes/write returns an operation and snapshot when available", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const operation = operationRecord({ id: "op-write", operationType: "write", requestedValue: "3200", snapshotId: "snapshot-1" });
    const snapshot = snapshotRecord();
    serviceMocks.writeNode.mockResolvedValue({ operation, snapshot });

    const response = await requestJson<{ operation: NodeOperationRecord; snapshot: DebugSnapshotRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/nodes/write",
      {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          parameterId: "param-1",
          nodePath: "/sys/current",
          value: "3200",
          readBack: true,
          confirmationToken: "confirm-high-risk-write"
        })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ operation, snapshot });
    expect(serviceMocks.writeNode).toHaveBeenCalledWith(
      makeAuth(),
      {
        sessionId: "session-1",
        parameterId: "param-1",
        value: "3200",
        confirmationToken: "confirm-high-risk-write"
      },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/debugging/nodes/write returns operation only when the service does not return a snapshot", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const operation = operationRecord({ id: "op-write", operationType: "write", requestedValue: "3200", snapshotId: "snapshot-1" });
    serviceMocks.writeNode.mockResolvedValue(operation);

    const response = await requestJson<{ operation: NodeOperationRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/nodes/write",
      {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", parameterId: "param-1", nodePath: "/sys/current", value: "3200" })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ operation });
  });

  it("POST /api/v1/debugging/snapshots/:snapshotId/rollback infers session from snapshot and returns rollback result", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const operation = operationRecord({ id: "op-rollback", operationType: "rollback", requestedValue: "3000" });
    const snapshot = snapshotRecord({ id: "snapshot-1", status: "consumed" });
    serviceMocks.rollbackSnapshot.mockResolvedValue({ operations: [operation], snapshot });

    const response = await requestJson<{ operations: NodeOperationRecord[]; snapshot: DebugSnapshotRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/snapshots/snapshot-1/rollback",
      {
        method: "POST",
        body: JSON.stringify({ confirmationToken: "confirm-rollback" })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ operations: [operation], snapshot });
    expect(serviceMocks.rollbackSnapshot).toHaveBeenCalledWith(
      makeAuth(),
      {
        snapshotId: "snapshot-1",
        confirmationToken: "confirm-rollback"
      },
      { requestId: "test-request" }
    );
  });

  it("missing DB or gateway returns INTERNAL_ERROR", async () => {
    const gateway = makeGateway();
    const missingDb = await requestJson<{ error: { code: string } }>(
      makeServer({ gateway }),
      "/api/v1/debugging/devices?projectId=aurora"
    );

    const missingGateway = await requestJson<{ error: { code: string } }>(
      makeServer({ db: makeDb() }),
      "/api/v1/debugging/devices?projectId=aurora"
    );

    expect(missingDb.status).toBe(500);
    expect(missingDb.body.error.code).toBe("INTERNAL_ERROR");
    expect(missingGateway.status).toBe(500);
    expect(missingGateway.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("schema failures return VALIDATION_FAILED", async () => {
    const db = makeDb();
    const gateway = makeGateway();

    const response = await requestJson<{ error: { code: string; details: { issues?: unknown[] } } }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/targets/detect",
      {
        method: "POST",
        body: JSON.stringify({ deviceId: "device-1" })
      }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.issues).toEqual(expect.any(Array));
    expect(serviceMocks.detectTargets).not.toHaveBeenCalled();
  });

  it("forbidden writes return FORBIDDEN", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    serviceMocks.writeNode.mockRejectedValue(new ApiError("FORBIDDEN", "Missing permission: debugging:write.", 403));

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/nodes/write",
      {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", parameterId: "param-1", nodePath: "/sys/current", value: "3200" })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("write route rejects auth without debugging write permission before service work", async () => {
    const db = makeDb();
    const gateway = makeGateway();

    const response = await requestJson<{ error: { code: string; message: string } }>(
      makeServer({ db, gateway, auth: makeAuth({ permissions: ["debugging:view", "debugging:read"] }) }),
      "/api/v1/debugging/nodes/write",
      {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", parameterId: "param-1", nodePath: "/sys/current", value: "3200" })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Missing permission: debugging:write."
    });
    expect(serviceMocks.writeNode).not.toHaveBeenCalled();
  });
});
