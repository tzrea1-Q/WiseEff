import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTracingBoundary, type TraceExporter } from "../../observability/tracing";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import type { DebugDeviceGateway } from "./gateway";
import type { DebugDeviceGatewayRegistry } from "./gatewayRegistry";
import { registerDebuggingRoutes } from "./routes";
import * as serviceModule from "./service";
import type {
  DebugDeviceRecord,
  DebugNodeBindingRecord,
  DebugNodeWithBindingsRecord,
  DebugParameterNodeBindingRecord,
  DebugParameterRecord,
  DebugParameterWithBindingsRecord,
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
  rollbackSnapshot: vi.fn(),
  listAdminParameters: vi.fn(),
  createAdminParameter: vi.fn(),
  updateAdminParameter: vi.fn(),
  archiveAdminParameter: vi.fn(),
  restoreAdminParameter: vi.fn(),
  upsertAdminParameterBinding: vi.fn(),
  archiveAdminParameterBinding: vi.fn(),
  listAdminDebugNodes: vi.fn(),
  createAdminDebugNode: vi.fn(),
  updateAdminDebugNode: vi.fn(),
  upsertAdminDebugNodeBinding: vi.fn(),
  archiveAdminDebugNodeBinding: vi.fn(),
  listAdminDebugModules: vi.fn(),
  createAdminDebugModule: vi.fn(),
  updateAdminDebugModule: vi.fn(),
  deleteAdminDebugModule: vi.fn()
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
    roles: [{  roleId: "software-user" }],
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

function makeServer(options: { db?: Database; gateway?: DebugDeviceGateway; gatewayRegistry?: DebugDeviceGatewayRegistry; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerDebuggingRoutes(router, {
    db: options.db,
    debugGateway: options.gateway,
    debugGatewayRegistry: options.gatewayRegistry,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

function createDeviceMetricsSpy() {
  return {
    recordDeviceGatewayOperation: vi.fn()
  };
}

function createTraceRecorder() {
  const spans: Parameters<TraceExporter>[0][] = [];
  return {
    spans,
    tracing: createTracingBoundary({
      enabled: true,
      serviceName: "wiseeff-api",
      exporter: (span) => {
        spans.push(span);
      }
    })
  };
}

const timestamp = "2026-05-27T10:00:00.000Z";

function deviceRecord(overrides: Partial<DebugDeviceRecord> = {}): DebugDeviceRecord {
  return {
    id: "device-1",
    organizationId: "org-1",
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
    deviceId: "device-1",
    bridgeId: null,
    protocol: "hdc",
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
    enabled: true,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    valueKind: "scalar",
    valueFormat: "raw",
    normalizationMode: "trim",
    maxValueBytes: null,
    ...overrides
  };
}

function parameterWithBindingsRecord(overrides: Partial<DebugParameterWithBindingsRecord> = {}): DebugParameterWithBindingsRecord {
  const parameter = parameterRecord(overrides);
  return {
    ...parameter,
    selectedBinding: null,
    bindings: [],
    ...overrides
  };
}

function bindingRecord(overrides: Partial<DebugParameterNodeBindingRecord> = {}): DebugParameterNodeBindingRecord {
  return {
    id: "binding-1",
    organizationId: "org-1",
    parameterId: "param-1",
    protocol: "hdc",
    nodePath: "/sys/current",
    accessMode: "RW",
    enabled: true,
    isSmokeDefault: false,
    notes: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function debugNodeWithBindingsRecord(overrides: Partial<DebugNodeWithBindingsRecord> = {}): DebugNodeWithBindingsRecord {
  return {
    id: "node-1",
    organizationId: "org-1",
    name: "Battery voltage",
    description: "Reads battery voltage node.",
    detailedDescription: "Full detail for battery voltage node.",
    writeFormatExample: "",
    writeFormatHint: "",
    module: "Battery",
    valueKind: "scalar",
    valueFormat: "raw",
    normalizationMode: "trim",
    maxValueBytes: null,
    enabled: true,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    bindings: [],
    ...overrides
  };
}

function debugNodeBindingRecord(overrides: Partial<DebugNodeBindingRecord> = {}): DebugNodeBindingRecord {
  return {
    id: "node-binding-1",
    organizationId: "org-1",
    nodeId: "node-1",
    protocol: "hdc",
    nodePath: "/sys/voltage",
    accessMode: "RO",
    enabled: true,
    notes: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function sessionRecord(overrides: Partial<DebugSessionRecord> = {}): DebugSessionRecord {
  return {
    id: "session-1",
    organizationId: "org-1",
    deviceId: "device-1",
    targetId: "target-1",
    protocol: "hdc",
    executionMode: "server",
    bridgeId: null,
    bridgeMachineLabel: null,
    sessionKind: "node",
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
    sessionId: "session-1",
    parameterId: "param-1",
    parameterDefinitionId: null,
    protocol: "hdc",
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
    valueKind: null,
    valueFormat: null,
    normalizationMode: null,
    requestedValueDigest: null,
    previousValueDigest: null,
    readbackValueDigest: null,
    valuePreview: null,
    ...overrides
  };
}

function snapshotRecord(overrides: Partial<DebugSnapshotRecord> = {}): DebugSnapshotRecord {
  return {
    id: "snapshot-1",
    organizationId: "org-1",
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

  it("GET /api/v1/debugging/devices returns items", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const device = deviceRecord();
    serviceMocks.listDevices.mockResolvedValue([device]);

    const response = await requestJson<{ items: DebugDeviceRecord[] }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/devices"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [device] });
    expect(serviceModule.createDebuggingService).toHaveBeenCalledWith({ db, gateway });
    expect(serviceMocks.listDevices).toHaveBeenCalledWith(makeAuth());
  });

  it("passes metrics and gateway mode into the debugging service", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const metrics = createDeviceMetricsSpy();
    const { tracing } = createTraceRecorder();
    const router = createRouter();
    serviceMocks.listDevices.mockResolvedValue([deviceRecord()]);
    registerDebuggingRoutes(router, {
      db,
      debugGateway: gateway,
      debugGatewayMode: "hdc",
      metrics,
      tracing,
      getCurrentAuthContext: () => makeAuth()
    });

    const response = await requestJson(createHttpServer(router), "/api/v1/debugging/devices");

    expect(response.status).toBe(200);
    expect(serviceModule.createDebuggingService).toHaveBeenCalledWith({
      db,
      gateway,
      gatewayMode: "hdc",
      metrics,
      tracing
    });
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
        body: JSON.stringify({  deviceId: "device-1" })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [target] });
    expect(serviceMocks.detectTargets).toHaveBeenCalledWith(
      makeAuth(),
      {  deviceId: "device-1", protocol: "hdc" },
      { requestId: "test-request" }
    );
  });

  it("passes protocol to target detection service", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const target = targetRecord({ protocol: "adb" });
    serviceMocks.detectTargets.mockResolvedValue([target]);

    const response = await requestJson<{ items: DebugTargetRecord[] }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/targets/detect",
      {
        method: "POST",
        body: JSON.stringify({  deviceId: "device-1", protocol: "adb" })
      }
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.detectTargets).toHaveBeenCalledWith(
      makeAuth(),
      {  deviceId: "device-1", protocol: "adb" },
      { requestId: "test-request" }
    );
  });

  it("GET /api/v1/debugging/parameters returns debug parameter DTOs", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const parameter = parameterRecord();
    serviceMocks.listParameters.mockResolvedValue([parameter]);

    const response = await requestJson<{ items: DebugParameterRecord[] }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/parameters?risk=Medium&risk=High"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [parameter] });
    expect(serviceMocks.listParameters).toHaveBeenCalledWith(makeAuth(), {  risk: ["Medium", "High"] });
  });

  it("passes the selected protocol to the parameter listing service", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const parameter = {
      ...parameterRecord(),
      selectedBinding: {
        id: "binding-param-1-adb",
        organizationId: "org-1",
        
        parameterId: "param-1",
        protocol: "adb" as const,
        nodePath: "/sys/adb/current",
        accessMode: "RW" as const,
        enabled: true,
        isSmokeDefault: true,
        notes: "ADB lab node",
        createdAt: timestamp,
        updatedAt: timestamp
      },
      bindings: []
    };
    serviceMocks.listParameters.mockResolvedValue([parameter]);

    const response = await requestJson<{ items: unknown[] }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/parameters?protocol=adb"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [parameter] });
    expect(serviceMocks.listParameters).toHaveBeenCalledWith(makeAuth(), {  protocol: "adb", risk: undefined });
  });

  it("GET /api/v1/debugging/admin/parameters parses includeArchived, risk, protocol, and coverage", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const item = parameterWithBindingsRecord({
      
      bindings: [bindingRecord({  protocol: "adb" })],
      selectedBinding: bindingRecord({  protocol: "adb" })
    });
    const auth = makeAuth({ permissions: ["debugging:view", "debugging:admin"] });
    serviceMocks.listAdminParameters.mockResolvedValue([item]);

    const response = await requestJson<{ items: DebugParameterWithBindingsRecord[] }>(
      makeServer({ db, gateway, auth }),
      "/api/v1/debugging/admin/parameters?includeArchived=true&risk=Medium&risk=High&protocol=adb&coverage=dual-protocol"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [item] });
    expect(serviceMocks.listAdminParameters).toHaveBeenCalledWith(auth, {
      
      includeArchived: true,
      risk: ["Medium", "High"],
      protocol: "adb",
      coverage: "dual-protocol"
    });
  });

  it("POST /api/v1/debugging/admin/parameters creates a catalog parameter", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const item = parameterWithBindingsRecord({ id: "param-created" });
    serviceMocks.createAdminParameter.mockResolvedValue(item);

    const response = await requestJson<{ item: DebugParameterWithBindingsRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/parameters",
      {
        method: "POST",
        body: JSON.stringify({
          
          name: "Created parameter",
          key: "created_parameter",
          module: "Battery",
          risk: "Medium",
          bindings: [{ protocol: "hdc", nodePath: "/sys/created", accessMode: "RW", enabled: true }]
        })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item });
    expect(serviceMocks.createAdminParameter).toHaveBeenCalledWith(
      makeAuth(),
      expect.objectContaining({
        
        name: "Created parameter",
        key: "created_parameter",
        description: "",
        module: "Battery",
        risk: "Medium",
        enabled: true,
        bindings: [{ protocol: "hdc", nodePath: "/sys/created", accessMode: "RW", enabled: true }]
      }),
      { requestId: "test-request" }
    );
  });

  it("PATCH /api/v1/debugging/admin/parameters/:parameterId preserves explicit nullable and falsey fields without injecting value metadata defaults", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const item = parameterWithBindingsRecord({
      
      minValue: null,
      maxValue: null,
      sortOrder: 0,
      enabled: false
    });
    serviceMocks.updateAdminParameter.mockResolvedValue(item);

    const response = await requestJson<{ item: DebugParameterWithBindingsRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/parameters/param-1",
      {
        method: "PATCH",
        body: JSON.stringify({
          
          minValue: null,
          maxValue: null,
          sortOrder: 0,
          enabled: false
        })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item });
    expect(serviceMocks.updateAdminParameter).toHaveBeenCalledWith(
      makeAuth(),
      {
        parameterId: "param-1",
        
        minValue: null,
        maxValue: null,
        sortOrder: 0,
        enabled: false
      },
      { requestId: "test-request" }
    );
  });

  it("PUT and PATCH admin binding routes parse params and body", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const putItem = bindingRecord({ protocol: "adb", nodePath: "/sys/adb/path", accessMode: "RO", notes: "ADB lab" });
    const patchItem = bindingRecord({ protocol: "adb", nodePath: "/sys/adb/path", enabled: false });
    serviceMocks.upsertAdminParameterBinding.mockResolvedValueOnce(putItem).mockResolvedValueOnce(patchItem);

    const putResponse = await requestJson<{ item: DebugParameterNodeBindingRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/parameters/param-1/bindings/adb",
      {
        method: "PUT",
        body: JSON.stringify({ nodePath: "/sys/adb/path", accessMode: "RO", enabled: true, notes: "ADB lab" })
      }
    );
    const patchResponse = await requestJson<{ item: DebugParameterNodeBindingRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/parameters/param-1/bindings/adb",
      {
        method: "PATCH",
        body: JSON.stringify({ nodePath: "/sys/adb/path", accessMode: "RW", enabled: false })
      }
    );

    expect(putResponse.status).toBe(200);
    expect(putResponse.body).toEqual({ item: putItem });
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body).toEqual({ item: patchItem });
    expect(serviceMocks.upsertAdminParameterBinding).toHaveBeenNthCalledWith(
      1,
      makeAuth(),
      { parameterId: "param-1", protocol: "adb", nodePath: "/sys/adb/path", accessMode: "RO", enabled: true, notes: "ADB lab" },
      { requestId: "test-request" }
    );
    expect(serviceMocks.upsertAdminParameterBinding).toHaveBeenNthCalledWith(
      2,
      makeAuth(),
      { parameterId: "param-1", protocol: "adb", nodePath: "/sys/adb/path", accessMode: "RW", enabled: false },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive archives a binding", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const item = bindingRecord({ protocol: "adb", enabled: false });
    serviceMocks.archiveAdminParameterBinding.mockResolvedValue(item);

    const response = await requestJson<{ item: DebugParameterNodeBindingRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/parameters/param-1/bindings/adb/archive",
      { method: "POST" }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item });
    expect(serviceMocks.archiveAdminParameterBinding).toHaveBeenCalledWith(
      makeAuth(),
      { parameterId: "param-1", protocol: "adb" },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/debugging/admin/nodes creates a metadata-only debug node with optional bindings", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const item = debugNodeWithBindingsRecord({
      id: "node-created",
      bindings: [debugNodeBindingRecord({ protocol: "hdc", nodePath: "/sys/created" })]
    });
    serviceMocks.createAdminDebugNode.mockResolvedValue(item);

    const response = await requestJson<{ item: DebugNodeWithBindingsRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/nodes",
      {
        method: "POST",
        body: JSON.stringify({
          
          name: "Created node",
          module: "Battery",
          bindings: [{ protocol: "hdc", nodePath: "/sys/created", accessMode: "RW", enabled: true }]
        })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item });
    expect(serviceMocks.createAdminDebugNode).toHaveBeenCalledWith(
      makeAuth(),
      expect.objectContaining({
        
        name: "Created node",
        module: "Battery",
        description: "",
        enabled: true,
        bindings: [{ protocol: "hdc", nodePath: "/sys/created", accessMode: "RW", enabled: true }]
      }),
      { requestId: "test-request" }
    );
  });

  it("PUT and PATCH admin node binding routes parse params and body", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const putItem = debugNodeBindingRecord({ protocol: "adb", nodePath: "/sys/adb/path", accessMode: "RO", notes: "ADB lab" });
    const patchItem = debugNodeBindingRecord({ protocol: "adb", nodePath: "/sys/adb/path", enabled: false });
    serviceMocks.upsertAdminDebugNodeBinding.mockResolvedValueOnce(putItem).mockResolvedValueOnce(patchItem);

    const putResponse = await requestJson<{ item: DebugNodeBindingRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/nodes/node-1/bindings/adb",
      {
        method: "PUT",
        body: JSON.stringify({ nodePath: "/sys/adb/path", accessMode: "RO", enabled: true, notes: "ADB lab" })
      }
    );
    const patchResponse = await requestJson<{ item: DebugNodeBindingRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/nodes/node-1/bindings/adb",
      {
        method: "PATCH",
        body: JSON.stringify({ nodePath: "/sys/adb/path", accessMode: "RW", enabled: false })
      }
    );

    expect(putResponse.status).toBe(200);
    expect(putResponse.body).toEqual({ item: putItem });
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body).toEqual({ item: patchItem });
    expect(serviceMocks.upsertAdminDebugNodeBinding).toHaveBeenNthCalledWith(
      1,
      makeAuth(),
      { nodeId: "node-1", protocol: "adb", nodePath: "/sys/adb/path", accessMode: "RO", enabled: true, notes: "ADB lab" },
      { requestId: "test-request" }
    );
    expect(serviceMocks.upsertAdminDebugNodeBinding).toHaveBeenNthCalledWith(
      2,
      makeAuth(),
      { nodeId: "node-1", protocol: "adb", nodePath: "/sys/adb/path", accessMode: "RW", enabled: false },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol/archive archives a node binding", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const item = debugNodeBindingRecord({ protocol: "adb", enabled: false });
    serviceMocks.archiveAdminDebugNodeBinding.mockResolvedValue(item);

    const response = await requestJson<{ item: DebugNodeBindingRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/nodes/node-1/bindings/adb/archive",
      { method: "POST" }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item });
    expect(serviceMocks.archiveAdminDebugNodeBinding).toHaveBeenCalledWith(
      makeAuth(),
      { nodeId: "node-1", protocol: "adb" },
      { requestId: "test-request" }
    );
  });

  it("admin module routes list, create, update, and delete debug modules", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const moduleItem = {
      name: "Battery Charging",
      description: "Charge policy nodes",
      scope: "Aurora",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    serviceMocks.listAdminDebugModules.mockResolvedValue([moduleItem]);
    serviceMocks.createAdminDebugModule.mockResolvedValue(moduleItem);
    serviceMocks.updateAdminDebugModule.mockResolvedValue({ ...moduleItem, name: "Charge Policy" });
    serviceMocks.deleteAdminDebugModule.mockResolvedValue(undefined);

    const listResponse = await requestJson<{ items: typeof moduleItem[] }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/modules"
    );
    const createResponse = await requestJson<{ item: typeof moduleItem }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/modules",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Battery Charging",
          description: "Charge policy nodes",
          scope: "Aurora"
        })
      }
    );
    const updateResponse = await requestJson<{ item: typeof moduleItem }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/modules/Battery%20Charging",
      {
        method: "PATCH",
        body: JSON.stringify({ name: "Charge Policy" })
      }
    );
    const deleteResponse = await requestJson<null>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/modules/Unused%20Module",
      { method: "DELETE" }
    );

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual({ items: [moduleItem] });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual({ item: moduleItem });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.item.name).toBe("Charge Policy");
    expect(deleteResponse.status).toBe(204);
    expect(serviceMocks.createAdminDebugModule).toHaveBeenCalledWith(
      makeAuth(),
      {
        name: "Battery Charging",
        description: "Charge policy nodes",
        scope: "Aurora"
      },
      { requestId: "test-request" }
    );
    expect(serviceMocks.updateAdminDebugModule).toHaveBeenCalledWith(
      makeAuth(),
      { moduleName: "Battery Charging", name: "Charge Policy" },
      { requestId: "test-request" }
    );
    expect(serviceMocks.deleteAdminDebugModule).toHaveBeenCalledWith(makeAuth(), "Unused Module", { requestId: "test-request" });
  });

  it("archive and restore admin parameter routes use route params", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const archived = parameterWithBindingsRecord({ enabled: false, archivedAt: timestamp });
    const restored = parameterWithBindingsRecord({ enabled: true, archivedAt: null });
    serviceMocks.archiveAdminParameter.mockResolvedValue(archived);
    serviceMocks.restoreAdminParameter.mockResolvedValue(restored);

    const archiveResponse = await requestJson<{ item: DebugParameterWithBindingsRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/parameters/param-1/archive",
      {
        method: "POST",
        body: JSON.stringify({ reason: "Deprecated" })
      }
    );
    const restoreResponse = await requestJson<{ item: DebugParameterWithBindingsRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/admin/parameters/param-1/restore",
      { method: "POST" }
    );

    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body).toEqual({ item: archived });
    expect(restoreResponse.status).toBe(200);
    expect(restoreResponse.body).toEqual({ item: restored });
    expect(serviceMocks.archiveAdminParameter).toHaveBeenCalledWith(
      makeAuth(),
      { parameterId: "param-1", reason: "Deprecated" },
      { requestId: "test-request" }
    );
    expect(serviceMocks.restoreAdminParameter).toHaveBeenCalledWith(makeAuth(), { parameterId: "param-1" }, { requestId: "test-request" });
  });

  it("POST /api/v1/debugging/sessions returns a session", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const session = sessionRecord();
    serviceMocks.createSession.mockResolvedValue(session);

    const response = await requestJson<{ item: DebugSessionRecord }>(makeServer({ db, gateway }), "/api/v1/debugging/sessions", {
      method: "POST",
      body: JSON.stringify({  deviceId: "device-1", targetId: "target-1" })
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item: session });
    expect(serviceMocks.createSession).toHaveBeenCalledWith(
      makeAuth(),
      {
        
        deviceId: "device-1",
        targetId: "target-1",
        protocol: "hdc",
        sessionKind: "node"
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

  it("accepts binding-aware read requests without nodePath", async () => {
    const db = makeDb();
    const gateway = makeGateway();
    const operation = operationRecord({ protocol: "adb", operationType: "read" });
    serviceMocks.readNode.mockResolvedValue(operation);

    const response = await requestJson<{ operation: NodeOperationRecord }>(
      makeServer({ db, gateway }),
      "/api/v1/debugging/nodes/read",
      {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", parameterId: "param-1" })
      }
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.readNode).toHaveBeenCalledWith(
      makeAuth(),
      {
        sessionId: "session-1",
        parameterId: "param-1"
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
      "/api/v1/debugging/devices"
    );

    const missingGateway = await requestJson<{ error: { code: string } }>(
      makeServer({ db: makeDb() }),
      "/api/v1/debugging/devices"
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
      "/api/v1/debugging/sessions",
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
