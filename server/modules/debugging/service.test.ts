import { describe, expect, it, vi } from "vitest";
import { createTracingBoundary, type TraceExporter } from "../../observability/tracing";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { CreateAuditEventInput } from "../audit/types";
import type { DebugDeviceGateway, GatewayWriteResult } from "./gateway";
import { createDebugDeviceGatewayRegistry } from "./gatewayRegistry";
import { createDebuggingService } from "./service";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResultFn = ((call: QueryCall) => unknown[]) & { debugDeviceLease?: boolean };
type QueuedResult = unknown[] | QueuedResultFn;

function debugDeviceLeaseResult(rows: unknown[]): QueuedResultFn {
  const result = (() => rows) as QueuedResultFn;
  result.debugDeviceLease = true;
  return result;
}

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];
  const transactions: QueryCall[][] = [];
  const rollbacks: QueryCall[][] = [];

  const runQuery = async <Row,>(target: QueryCall[], text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    target.push(call);
    if (text.includes("debug_device_leases")) {
      const leaseResultIndex = results.findIndex((result) => typeof result === "function" && result.debugDeviceLease);
      if (leaseResultIndex >= 0) {
        const [next] = results.splice(leaseResultIndex, 1);
        const rows = (next as QueuedResultFn)(call);
        return { rows: rows as Row[], rowCount: rows.length };
      }
      return {
        rows: [
          {
            organization_id: values[0],
            project_id: values[1],
            device_id: values[2],
            session_id: values[3],
            lease_owner_user_id: values[4],
            expires_at: "2026-05-27T10:05:00.000Z",
            acquired_at: timestamp,
            updated_at: timestamp
          }
        ] as Row[],
        rowCount: 1
      };
    }
    let next = results.shift() ?? [];
    while (typeof next === "function" && next.debugDeviceLease) {
      next = results.shift() ?? [];
    }
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };

  const tx: Queryable = {
    query: (text, values = []) => runQuery(txCalls, text, values)
  };
  const db: Database = {
    query: (text, values = []) => runQuery(calls, text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => {
      const start = txCalls.length;
      try {
        const result = await fn(tx);
        transactions.push(txCalls.slice(start));
        return result;
      } catch (error) {
        rollbacks.push(txCalls.slice(start));
        throw error;
      }
    }
  };

  return { calls, txCalls, transactions, rollbacks, db };
}

function makeAuth(
  permissions: AuthContext["permissions"],
  roles: AuthContext["roles"] = [{ projectId: "aurora", roleId: "software-user" }]
): AuthContext {
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
    roles,
    permissions
  };
}

function makeGateway(overrides: Partial<DebugDeviceGateway> = {}): DebugDeviceGateway {
  return {
    detectTargets: vi.fn(async () => ({
      ok: true,
      targets: [{ id: "target-1", deviceId: "device-1", targetRef: "simulator://aurora-1", label: "Aurora Target", online: true }]
    })),
    readNode: vi.fn(async () => ({ ok: true, value: "3000", stdout: "3000", durationMs: 5 })),
    writeNode: vi.fn(async () => ({
      ok: true,
      value: "3200",
      verified: true,
      writeResult: { ok: true, value: "3200", stdout: "3200", durationMs: 7 },
      readResult: { ok: true, value: "3200", stdout: "3200", durationMs: 8 }
    })),
    ...overrides
  };
}

function createAuditSpy() {
  const events: CreateAuditEventInput[] = [];
  const createAuditEvent = vi.fn(async (_db: Queryable, input: CreateAuditEventInput) => {
    events.push(input);
  });

  return { createAuditEvent, events };
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

function deviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "device-1",
    organization_id: "org-1",
    project_id: "aurora",
    name: "Aurora Simulator",
    transport: "simulator",
    status: "online",
    firmware: "sim-1.0",
    last_seen_at: timestamp,
    ...overrides
  };
}

function targetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "target-1",
    organization_id: "org-1",
    project_id: "aurora",
    device_id: "device-1",
    protocol: "hdc",
    target_ref: "simulator://aurora-1",
    label: "Aurora Target",
    status: "detected",
    detected_at: timestamp,
    ...overrides
  };
}

function parameterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "param-1",
    organization_id: "org-1",
    project_id: "aurora",
    name: "Fast charge current",
    key: "fast_charge_current",
    description: "Controls constant charge current.",
    module: "Battery",
    node_path: "/sys/current",
    access_mode: "RW",
    unit: "mA",
    range_label: "0-5000",
    min_value: "0",
    max_value: "5000",
    risk: "Medium",
    current_value: "3000",
    target_value: "3200",
    sort_order: 10,
    ...overrides
  };
}

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "binding-1",
    organization_id: "org-1",
    project_id: "aurora",
    parameter_id: "param-1",
    protocol: "hdc",
    node_path: "/sys/current",
    access_mode: "RW",
    enabled: true,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides
  };
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    organization_id: "org-1",
    project_id: "aurora",
    device_id: "device-1",
    target_id: "target-1",
    protocol: "hdc",
    actor_user_id: "user-1",
    status: "active",
    started_at: timestamp,
    ended_at: null,
    ...overrides
  };
}

function operationRow(call: QueryCall, overrides: Record<string, unknown> = {}) {
  return {
    id: call.values[0],
    organization_id: call.values[1],
    project_id: call.values[2],
    session_id: call.values[3],
    parameter_id: call.values[4],
    protocol: call.values[5],
    node_path: call.values[6],
    operation_type: call.values[7],
    status: call.values[8],
    requested_value: call.values[9],
    previous_value: call.values[10],
    read_value: call.values[11],
    readback_value: call.values[12],
    verified: call.values[13],
    failure_reason: call.values[14],
    duration_ms: call.values[15],
    approval_id: call.values[16],
    snapshot_id: call.values[17],
    created_at: timestamp,
    ...overrides
  };
}

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "snapshot-1",
    organization_id: "org-1",
    project_id: "aurora",
    session_id: "session-1",
    operation_id: null,
    status: "valid",
    risk: "Medium",
    entries: [{ parameterId: "param-1", nodePath: "/sys/current", previousValue: "3000", targetValue: "3200" }],
    created_at: timestamp,
    ...overrides
  };
}

const readAuth = makeAuth(["debugging:view", "debugging:read"]);
const writeAuth = makeAuth(["debugging:view", "debugging:read", "debugging:write"]);
const rollbackAuth = makeAuth(["debugging:view", "debugging:read", "debugging:write", "debugging:rollback"]);
const otherProjectReadAuth = makeAuth(["debugging:view", "debugging:read"], [{ projectId: "zephyr", roleId: "software-user" }]);
const otherProjectWriteAuth = makeAuth(["debugging:view", "debugging:read", "debugging:write"], [
  { projectId: "zephyr", roleId: "software-user" }
]);
const otherProjectRollbackAuth = makeAuth(["debugging:view", "debugging:read", "debugging:write", "debugging:rollback"], [
  { projectId: "zephyr", roleId: "software-user" }
]);
const multiProjectReadAuth = makeAuth(["debugging:view", "debugging:read"], [
  { projectId: "aurora", roleId: "software-user" },
  { projectId: "zephyr", roleId: "software-user" }
]);

describe("debugging service", () => {
  it("listDevices and listParameters deny different-project auth before querying", async () => {
    const { db, calls } = createFakeDb();
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.listDevices(otherProjectReadAuth, { projectId: "aurora" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId: "aurora" })
    );
    await expect(service.listParameters(otherProjectReadAuth, { projectId: "aurora" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId: "aurora" })
    );

    expect(calls).toHaveLength(0);
  });

  it("listDevices and listParameters scope unfiltered non-admin queries to auth projects", async () => {
    const { db, calls } = createFakeDb([[deviceRow()], [parameterRow()]]);
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.listDevices(multiProjectReadAuth)).resolves.toEqual([expect.objectContaining({ id: "device-1" })]);
    await expect(service.listParameters(multiProjectReadAuth)).resolves.toEqual([expect.objectContaining({ id: "param-1" })]);

    expect(calls[0].text).toContain("project_id = any($2::text[])");
    expect(calls[0].values).toEqual(["org-1", ["aurora", "zephyr"]]);
    expect(calls[1].text).toContain("project_id = any($2::text[])");
    expect(calls[1].values).toEqual(["org-1", ["aurora", "zephyr"]]);
  });

  it("lists selected-protocol parameter bindings for frontend availability", async () => {
    const { db, calls } = createFakeDb([
      [parameterRow()],
      [
        bindingRow({ protocol: "hdc", node_path: "/sys/current", enabled: true }),
        bindingRow({ id: "binding-param-1-adb", protocol: "adb", node_path: "/sys/adb/current", enabled: false, notes: "disabled in lab" })
      ]
    ]);
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.listParameters(readAuth, { projectId: "aurora", protocol: "adb" })).resolves.toEqual([
      expect.objectContaining({
        id: "param-1",
        selectedBinding: expect.objectContaining({
          parameterId: "param-1",
          protocol: "adb",
          nodePath: "/sys/adb/current",
          enabled: false,
          notes: "disabled in lab"
        }),
        bindings: expect.arrayContaining([
          expect.objectContaining({ protocol: "hdc", nodePath: "/sys/current", enabled: true }),
          expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/current", enabled: false })
        ])
      })
    ]);

    expect(calls[0].text).toContain("from debugging_parameters");
    expect(calls[1].text).toContain("from debugging_parameter_node_bindings");
    expect(calls[1].values).toEqual(["org-1", "aurora", ["param-1"]]);
  });

  it("detectTargets and createSession deny different-project auth before gateway or writes", async () => {
    const { db, txCalls } = createFakeDb();
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.detectTargets(otherProjectReadAuth, { projectId: "aurora", deviceId: "device-1" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId: "aurora" })
    );
    await expect(
      service.createSession(otherProjectReadAuth, { projectId: "aurora", deviceId: "device-1", targetId: "target-1" })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId: "aurora" }));

    expect(gateway.detectTargets).not.toHaveBeenCalled();
    expect(gateway.writeNode).not.toHaveBeenCalled();
    expect(txCalls).toHaveLength(0);
  });

  it("detectTargets rejects a device from another project before gateway or writes", async () => {
    const { db, txCalls } = createFakeDb([[deviceRow({ project_id: "other-project" })]]);
    const gateway = makeGateway();
    const audit = createAuditSpy();
    const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent });

    await expect(service.detectTargets(readAuth, { projectId: "aurora", deviceId: "device-1" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Debug device does not belong to the requested project.", 400)
    );

    expect(gateway.detectTargets).not.toHaveBeenCalled();
    expect(txCalls).toHaveLength(0);
    expect(audit.createAuditEvent).not.toHaveBeenCalled();
  });

  it("detectTargets requires debugging:read, calls gateway, persists targets, writes audit", async () => {
    const { db, txCalls } = createFakeDb([
      [deviceRow()],
      (call) => [
        targetRow({
          id: call.values[3],
          protocol: call.values[4],
          target_ref: call.values[5],
          label: call.values[6],
          status: call.values[7]
        })
      ],
      []
    ]);
    const gateway = makeGateway();
    const audit = createAuditSpy();
    const metrics = createDeviceMetricsSpy();
    const { spans, tracing } = createTraceRecorder();
    const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent, metrics, gatewayMode: "simulator", tracing });

    await expect(service.detectTargets(makeAuth(["debugging:view"]), { projectId: "aurora", deviceId: "device-1" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Missing permission: debugging:read.", 403, { permission: "debugging:read" })
    );

    const targets = await service.detectTargets(readAuth, { projectId: "aurora", deviceId: "device-1" });

    expect(gateway.detectTargets).toHaveBeenCalledWith({ projectId: "aurora", deviceId: "device-1" });
    expect(txCalls.some((call) => call.text.includes("insert into debugging_targets"))).toBe(true);
    expect(targets).toEqual([expect.objectContaining({ id: "target-1", status: "detected", targetRef: "simulator://aurora-1" })]);
    expect(audit.events[0]).toMatchObject({
      organizationId: "org-1",
      projectId: "aurora",
      actorUserId: "user-1",
      app: "debugging",
      kind: "debug-target-detect",
      action: "detect"
    });
    expect(metrics.recordDeviceGatewayOperation).toHaveBeenCalledWith({
      mode: "simulator",
      action: "detect",
      status: "succeeded"
    });
    expect(spans).toEqual([
      expect.objectContaining({
        name: "debug.gateway.detect",
        attributes: expect.objectContaining({
          service: "wiseeff-api",
          mode: "simulator",
          action: "detect",
          status: "succeeded",
          hasDeviceFilter: true
        })
      })
    ]);
    expect(JSON.stringify(spans)).not.toContain("device-1");
    expect(JSON.stringify(spans)).not.toContain("simulator://aurora-1");
  });

  it("detects ADB targets through the registry and audits protocol metadata", async () => {
    const adbGateway = makeGateway({
      detectTargets: vi.fn(async () => ({
        ok: true,
        targets: [
          {
            id: "adb:emulator-5554",
            deviceId: "device-1",
            targetRef: "emulator-5554",
            label: "ADB target emulator-5554",
            online: true,
            protocol: "adb" as const
          }
        ]
      }))
    });
    const { db } = createFakeDb([
      [deviceRow({ transport: "adb" })],
      (call) => [
        targetRow({
          id: call.values[3],
          protocol: call.values[4],
          target_ref: call.values[5],
          label: call.values[6],
          status: call.values[7]
        })
      ],
      []
    ]);
    const audit = createAuditSpy();
    const service = createDebuggingService({
      db,
      gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }),
      createAuditEvent: audit.createAuditEvent
    });

    const targets = await service.detectTargets(readAuth, {
      projectId: "aurora",
      deviceId: "device-1",
      protocol: "adb"
    });

    expect(targets[0]).toMatchObject({ protocol: "adb", targetRef: "emulator-5554" });
    expect(adbGateway.detectTargets).toHaveBeenCalledWith({ projectId: "aurora", deviceId: "device-1" });
    expect(audit.events.at(-1)?.metadata).toMatchObject({ protocol: "adb", targetCount: 1 });
  });

  it("persists detected targets with the requested protocol even if an adapter reports a conflicting protocol", async () => {
    const adbGateway = makeGateway({
      detectTargets: vi.fn(async () => ({
        ok: true,
        targets: [
          {
            id: "adb:emulator-5554",
            deviceId: "device-1",
            targetRef: "emulator-5554",
            label: "ADB target emulator-5554",
            online: true,
            protocol: "hdc" as const
          }
        ]
      }))
    });
    const { db, txCalls } = createFakeDb([
      [deviceRow({ transport: "adb" })],
      (call) => [
        targetRow({
          id: call.values[3],
          protocol: call.values[4],
          target_ref: call.values[5],
          label: call.values[6],
          status: call.values[7]
        })
      ],
      []
    ]);
    const service = createDebuggingService({
      db,
      gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }),
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await service.detectTargets(readAuth, {
      projectId: "aurora",
      deviceId: "device-1",
      protocol: "adb"
    });

    const upsertCall = txCalls.find((call) => call.text.includes("insert into debugging_targets"));
    expect(upsertCall?.values[4]).toBe("adb");
  });

  it("detectTargets commits a failed debug event when gateway detection fails", async () => {
    const { db, transactions } = createFakeDb([[deviceRow()], []]);
    const metrics = createDeviceMetricsSpy();
    const service = createDebuggingService({
      db,
      gateway: makeGateway({ detectTargets: vi.fn(async () => ({ ok: false, targets: [], error: "USB bridge unavailable." })) }),
      createAuditEvent: createAuditSpy().createAuditEvent,
      metrics,
      gatewayMode: "hdc"
    });

    await expect(service.detectTargets(readAuth, { projectId: "aurora", deviceId: "device-1" })).rejects.toMatchObject(
      new ApiError("DEVICE_UNAVAILABLE", "USB bridge unavailable.", 409)
    );

    expect(transactions).toHaveLength(1);
    expect(transactions[0].some((call) => call.text.includes("insert into debugging_events"))).toBe(true);
    expect(metrics.recordDeviceGatewayOperation).toHaveBeenCalledWith({
      mode: "hdc",
      action: "detect",
      status: "failed"
    });
  });

  it("createSession rejects offline or lost targets and persists an active session", async () => {
    const lost = createFakeDb([[deviceRow()], [targetRow({ status: "lost" })]]);
    const serviceForLost = createDebuggingService({ db: lost.db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(
      serviceForLost.createSession(readAuth, { projectId: "aurora", deviceId: "device-1", targetId: "target-1" })
    ).rejects.toMatchObject(new ApiError("DEVICE_UNAVAILABLE", "Debug target is not detected.", 409));

    const offline = createFakeDb([[deviceRow({ status: "offline" })], [targetRow()]]);
    const serviceForOffline = createDebuggingService({ db: offline.db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(
      serviceForOffline.createSession(readAuth, { projectId: "aurora", deviceId: "device-1", targetId: "target-1" })
    ).rejects.toMatchObject(new ApiError("DEVICE_UNAVAILABLE", "Debug device is offline.", 409));

    const { db, txCalls } = createFakeDb([[deviceRow()], [targetRow()], (call) => [sessionRow({ id: call.values[0] })], []]);
    const audit = createAuditSpy();
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

    const session = await service.createSession(readAuth, { projectId: "aurora", deviceId: "device-1", targetId: "target-1" });

    expect(txCalls.some((call) => call.text.includes("insert into debugging_sessions"))).toBe(true);
    expect(session).toMatchObject({ projectId: "aurora", deviceId: "device-1", targetId: "target-1", status: "active" });
    expect(audit.events[0]).toMatchObject({ kind: "debug-session-create", action: "create", targetId: session.id });
  });

  it("createSession rejects cross-project devices, cross-project targets, and mismatched device targets", async () => {
    const crossProjectDevice = createFakeDb([[deviceRow({ project_id: "other-project" })], [targetRow()]]);
    const serviceForDevice = createDebuggingService({
      db: crossProjectDevice.db,
      gateway: makeGateway(),
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(
      serviceForDevice.createSession(readAuth, { projectId: "aurora", deviceId: "device-1", targetId: "target-1" })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Debug device does not belong to the requested project.", 400));

    const crossProjectTarget = createFakeDb([[deviceRow()], [targetRow({ project_id: "other-project" })]]);
    const serviceForTarget = createDebuggingService({
      db: crossProjectTarget.db,
      gateway: makeGateway(),
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(
      serviceForTarget.createSession(readAuth, { projectId: "aurora", deviceId: "device-1", targetId: "target-1" })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Debug target does not belong to the requested project.", 400));

    const mismatchedTarget = createFakeDb([[deviceRow()], [targetRow({ device_id: "device-2" })]]);
    const serviceForMismatch = createDebuggingService({
      db: mismatchedTarget.db,
      gateway: makeGateway(),
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(
      serviceForMismatch.createSession(readAuth, { projectId: "aurora", deviceId: "device-1", targetId: "target-1" })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Debug target does not belong to the requested device.", 400));
  });

  it("createSession inserts a session-created debug event", async () => {
    const { db, txCalls } = createFakeDb([[deviceRow()], [targetRow()], (call) => [sessionRow({ id: call.values[0] })], []]);
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    const session = await service.createSession(readAuth, { projectId: "aurora", deviceId: "device-1", targetId: "target-1" });

    const eventCall = txCalls.find((call) => call.text.includes("insert into debugging_events"));
    expect(eventCall?.values.slice(1, 8)).toEqual([
      "org-1",
      "aurora",
      session.id,
      null,
      "session-created",
      "info",
      "Debug session created."
    ]);
    expect(JSON.parse(String(eventCall?.values[8]))).toEqual({ deviceId: "device-1", targetId: "target-1", protocol: "hdc" });
  });

  it("readNode requires debugging:read, resolves bindings, records operation, writes audit", async () => {
    const { db, txCalls } = createFakeDb([
      [sessionRow()],
      [parameterRow()],
      [bindingRow()],
      [targetRow()],
      (call) => [operationRow(call)]
    ]);
    const gateway = makeGateway();
    const audit = createAuditSpy();
    const metrics = createDeviceMetricsSpy();
    const { spans, tracing } = createTraceRecorder();
    const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent, metrics, gatewayMode: "simulator", tracing });

    await expect(service.readNode(makeAuth(["debugging:view"]), { sessionId: "session-1", nodePath: "/sys/current" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Missing permission: debugging:read.", 403, { permission: "debugging:read" })
    );
    const operation = await service.readNode(readAuth, { sessionId: "session-1", parameterId: "param-1", nodePath: "/frontend/ignored" });

    expect(gateway.readNode).toHaveBeenCalledWith({ targetRef: "simulator://aurora-1", nodePath: "/sys/current" });
    expect(operation).toMatchObject({ operationType: "read", status: "succeeded", readValue: "3000", verified: true });
    expect(txCalls.some((call) => call.text.includes("insert into node_operations"))).toBe(true);
    expect(audit.events[0]).toMatchObject({ kind: "debug-node-read", action: "read", targetType: "debug-node" });
    expect(metrics.recordDeviceGatewayOperation).toHaveBeenCalledWith({
      mode: "simulator",
      action: "read",
      status: "succeeded"
    });
    expect(spans).toEqual([
      expect.objectContaining({
        name: "debug.gateway.read",
        attributes: expect.objectContaining({
          service: "wiseeff-api",
          mode: "simulator",
          action: "read",
          status: "succeeded",
          hasParameterId: true
        })
      })
    ]);
    expect(JSON.stringify(spans)).not.toContain("/sys/current");
    expect(JSON.stringify(spans)).not.toContain("3000");
  });

  it("reads an ADB node from the session protocol binding without trusting frontend nodePath", async () => {
    const adbGateway = makeGateway();
    const { db } = createFakeDb([
      [sessionRow({ protocol: "adb" })],
      [parameterRow()],
      [bindingRow({ protocol: "adb", node_path: "/sys/adb/current" })],
      [targetRow({ protocol: "adb", target_ref: "emulator-5554" })],
      (call) => [operationRow(call, { protocol: "adb", node_path: "/sys/adb/current" })]
    ]);
    const service = createDebuggingService({
      db,
      gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }),
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await service.readNode(readAuth, {
      sessionId: "session-1",
      parameterId: "param-1",
      nodePath: "/malicious/frontend/path"
    });

    expect(adbGateway.readNode).toHaveBeenCalledWith({ targetRef: "emulator-5554", nodePath: "/sys/adb/current" });
  });

  it("readNode rejects inactive sessions and WO parameters before gateway call", async () => {
    const inactive = createFakeDb([[sessionRow({ status: "closed" })]]);
    const inactiveGateway = makeGateway();
    const inactiveService = createDebuggingService({
      db: inactive.db,
      gateway: inactiveGateway,
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(inactiveService.readNode(readAuth, { sessionId: "session-1", nodePath: "/sys/current" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Debug session is not active.", 400)
    );
    expect(inactiveGateway.readNode).not.toHaveBeenCalled();

    const writeOnly = createFakeDb([[sessionRow()], [parameterRow()], [bindingRow({ access_mode: "WO" })]]);
    const writeOnlyGateway = makeGateway();
    const writeOnlyService = createDebuggingService({
      db: writeOnly.db,
      gateway: writeOnlyGateway,
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(
      writeOnlyService.readNode(readAuth, { sessionId: "session-1", parameterId: "param-1", nodePath: "/sys/current" })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Parameter is not readable.", 400));
    expect(writeOnlyGateway.readNode).not.toHaveBeenCalled();
  });

  it("readNode denies sessions outside the auth project scope before gateway call", async () => {
    const { db } = createFakeDb([[sessionRow()]]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.readNode(otherProjectReadAuth, { sessionId: "session-1", nodePath: "/sys/current" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId: "aurora" })
    );
    expect(gateway.readNode).not.toHaveBeenCalled();
  });

  it("readNode records failed gateway reads as failed operations with audit metadata", async () => {
    const { db } = createFakeDb([[sessionRow()], [targetRow()], (call) => [operationRow(call)]]);
    const audit = createAuditSpy();
    const service = createDebuggingService({
      db,
      gateway: makeGateway({ readNode: vi.fn(async () => ({ ok: false, stderr: "node missing", error: "node missing", durationMs: 12 })) }),
      createAuditEvent: audit.createAuditEvent
    });

    const operation = await service.readNode(readAuth, { sessionId: "session-1", nodePath: "/sys/current" });

    expect(operation).toMatchObject({
      operationType: "read",
      status: "failed",
      readValue: null,
      verified: false,
      failureReason: "node missing"
    });
    expect(audit.events[0]).toMatchObject({
      kind: "debug-node-read",
      severity: "Medium",
      metadata: expect.objectContaining({ operationId: operation.id, failureReason: "node missing" })
    });
  });

  it("readNode treats audit write failure as operation failure and transaction failure", async () => {
    const { db, rollbacks } = createFakeDb([[sessionRow()], [targetRow()], (call) => [operationRow(call)]]);
    const createAuditEvent = vi.fn(async () => {
      throw new Error("audit unavailable");
    });
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent });

    await expect(service.readNode(readAuth, { sessionId: "session-1", nodePath: "/sys/current" })).rejects.toThrow("audit unavailable");

    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0].some((call) => call.text.includes("insert into node_operations"))).toBe(true);
  });

  it("writeNode requires debugging:write and rejects inactive sessions before gateway call", async () => {
    const permissionGateway = makeGateway();
    const permissionService = createDebuggingService({
      db: createFakeDb().db,
      gateway: permissionGateway,
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(permissionService.writeNode(readAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Missing permission: debugging:write.", 403, { permission: "debugging:write" })
    );
    expect(permissionGateway.writeNode).not.toHaveBeenCalled();

    const inactive = createFakeDb([[sessionRow({ status: "closed" })]]);
    const inactiveGateway = makeGateway();
    const inactiveService = createDebuggingService({
      db: inactive.db,
      gateway: inactiveGateway,
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(inactiveService.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Debug session is not active.", 400)
    );
    expect(inactiveGateway.writeNode).not.toHaveBeenCalled();
  });

  it("writeNode rejects RO parameters before gateway call", async () => {
    const { db } = createFakeDb([[sessionRow()], [parameterRow()], [bindingRow({ access_mode: "RO" })]]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Parameter is read-only.", 400)
    );
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("writeNode rejects numeric values outside minValue/maxValue", async () => {
    const { db } = createFakeDb([[sessionRow()], [parameterRow({ min_value: "0", max_value: "5000" })], [bindingRow()]]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "6000" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Value is outside the allowed range.", 400)
    );
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("writeNode rejects non-numeric values when a parameter has a numeric range", async () => {
    const { db } = createFakeDb([[sessionRow()], [parameterRow({ min_value: "0", max_value: "5000" })], [bindingRow()]]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "not-a-number" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Value must be numeric for ranged parameters.", 400, { minValue: 0, maxValue: 5000 })
    );
    expect(gateway.readNode).not.toHaveBeenCalled();
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("writeNode rejects parameters from a different project before gateway call", async () => {
    const { db } = createFakeDb([[sessionRow()], [parameterRow({ project_id: "other-project" })], [bindingRow()]]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Parameter does not belong to the session project.", 400)
    );
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("rejects writes when the session protocol binding is missing", async () => {
    const { db } = createFakeDb([[sessionRow({ protocol: "adb" })], [parameterRow()], []]);
    const gateway = makeGateway();
    const service = createDebuggingService({
      db,
      gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: gateway }),
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(
      service.writeNode(writeAuth, {
        sessionId: "session-1",
        parameterId: "param-1",
        value: "3200"
      })
    ).rejects.toMatchObject({
      code: "DEBUG_BINDING_NOT_CONFIGURED"
    });
    expect(gateway.readNode).not.toHaveBeenCalled();
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("rejects writes when the session protocol binding is disabled", async () => {
    const { db } = createFakeDb([[sessionRow({ protocol: "adb" })], [parameterRow()], [bindingRow({ protocol: "adb", enabled: false })]]);
    const gateway = makeGateway();
    const service = createDebuggingService({
      db,
      gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: gateway }),
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(
      service.writeNode(writeAuth, {
        sessionId: "session-1",
        parameterId: "param-1",
        value: "3200"
      })
    ).rejects.toMatchObject({
      code: "DEBUG_BINDING_DISABLED"
    });
    expect(gateway.readNode).not.toHaveBeenCalled();
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("requires an explicit registry for non-default protocols", async () => {
    const service = createDebuggingService({
      db: createFakeDb([[deviceRow({ transport: "adb" })]]).db,
      gateway: makeGateway(),
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(
      service.detectTargets(readAuth, {
        projectId: "aurora",
        deviceId: "device-1",
        protocol: "adb"
      })
    ).rejects.toMatchObject({
      code: "PROTOCOL_UNSUPPORTED"
    });
  });

  it("writeNode rejects High-risk parameters without confirmation token or approval", async () => {
    const { db } = createFakeDb([[sessionRow()], [parameterRow({ risk: "High" })], [bindingRow()]]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "High-risk write requires confirmation or approval.", 400)
    );
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("writeNode denies sessions outside the auth project scope before gateway call", async () => {
    const { db } = createFakeDb([[sessionRow()]]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.writeNode(otherProjectWriteAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId: "aurora" })
    );
    expect(gateway.readNode).not.toHaveBeenCalled();
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("writeNode creates a pre-write snapshot with previous value before calling gateway", async () => {
    const callOrder: string[] = [];
    const gateway = makeGateway({
      readNode: vi.fn(async () => {
        callOrder.push("gateway-read");
        return { ok: true, value: "3000", stdout: "3000", durationMs: 5 };
      }),
      writeNode: vi.fn(async () => {
        callOrder.push("gateway-write");
        return {
          ok: true,
          value: "3200",
          verified: true,
          writeResult: { ok: true, value: "3200", stdout: "3200", durationMs: 7 },
          readResult: { ok: true, value: "3200", stdout: "3200", durationMs: 8 }
        };
      })
    });
    const { db, txCalls } = createFakeDb([
      [sessionRow()],
      [parameterRow()],
      [bindingRow()],
      [targetRow()],
      (call) => {
        callOrder.push("snapshot");
        return [snapshotRow({ id: call.values[0], entries: JSON.parse(String(call.values[7])) })];
      },
      (call) => [operationRow(call, { snapshot_id: "snapshot-1" })],
      [],
      []
    ]);
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    const operation = await service.writeNode(
      writeAuth,
      { sessionId: "session-1", parameterId: "param-1", value: "3200" },
      { requestId: "request-debug-write-1" }
    );

    expect(callOrder).toEqual(["gateway-read", "snapshot", "gateway-write"]);
    const snapshotCall = txCalls.find((call) => call.text.includes("insert into debugging_snapshots"));
    expect(JSON.parse(String(snapshotCall?.values[7]))).toEqual([
      { parameterId: "param-1", protocol: "hdc", nodePath: "/sys/current", previousValue: "3000", targetValue: "3200" }
    ]);
    expect(operation).toMatchObject({ status: "succeeded", previousValue: "3000", snapshotId: "snapshot-1" });
  });

  it("writeNode rejects a device lease held by another active session before gateway calls", async () => {
    const { db, txCalls } = createFakeDb([
      [sessionRow()],
      [parameterRow()],
      [bindingRow()],
      [targetRow()],
      debugDeviceLeaseResult([]),
      (call) => [snapshotRow({ id: call.values[0], entries: JSON.parse(String(call.values[7])) })],
      (call) => [operationRow(call, { snapshot_id: "snapshot-1" })],
      [],
      []
    ]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })).rejects.toMatchObject(
      new ApiError("CONFLICT", "Debug device is leased by another active session.", 409)
    );

    expect(txCalls.some((call) => call.text.includes("debug_device_leases"))).toBe(true);
    expect(gateway.readNode).not.toHaveBeenCalled();
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("writeNode stores readback_mismatch when gateway verified=false", async () => {
    const gatewayResult: GatewayWriteResult = {
      ok: true,
      value: "3200",
      verified: false,
      error: "Readback mismatch.",
      writeResult: { ok: true, value: "3200", stdout: "3200", durationMs: 7 },
      readResult: { ok: true, value: "3100", stdout: "3100", durationMs: 8 }
    };
    const { db } = createFakeDb([
      [sessionRow()],
      [parameterRow()],
      [bindingRow()],
      [targetRow()],
      (call) => [snapshotRow({ id: call.values[0], entries: JSON.parse(String(call.values[7])) })],
      (call) => [operationRow(call, { snapshot_id: "snapshot-1" })],
      []
    ]);
    const service = createDebuggingService({
      db,
      gateway: makeGateway({ writeNode: vi.fn(async () => gatewayResult) }),
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    const operation = await service.writeNode(
      writeAuth,
      { sessionId: "session-1", parameterId: "param-1", value: "3200" },
      { requestId: "request-debug-write-1" }
    );

    expect(operation).toMatchObject({
      operationType: "write",
      status: "readback_mismatch",
      readbackValue: "3100",
      verified: false,
      failureReason: "Readback mismatch."
    });
  });

  it("writeNode stores failed status when gateway write fails", async () => {
    const gatewayResult: GatewayWriteResult = {
      ok: false,
      verified: false,
      error: "Write failed.",
      writeResult: { ok: false, stderr: "permission denied", error: "permission denied", durationMs: 7 }
    };
    const { db } = createFakeDb([
      [sessionRow()],
      [parameterRow()],
      [bindingRow()],
      [targetRow()],
      (call) => [snapshotRow({ id: call.values[0], entries: JSON.parse(String(call.values[7])) })],
      (call) => [operationRow(call, { snapshot_id: "snapshot-1" })],
      []
    ]);
    const metrics = createDeviceMetricsSpy();
    const { spans, tracing } = createTraceRecorder();
    const service = createDebuggingService({
      db,
      gateway: makeGateway({ writeNode: vi.fn(async () => gatewayResult) }),
      createAuditEvent: createAuditSpy().createAuditEvent,
      metrics,
      gatewayMode: "hdc",
      tracing
    });

    const operation = await service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" });

    expect(operation).toMatchObject({
      operationType: "write",
      status: "failed",
      readbackValue: null,
      verified: false,
      failureReason: "Write failed."
    });
    expect(metrics.recordDeviceGatewayOperation).toHaveBeenCalledWith({
      mode: "hdc",
      action: "read",
      status: "succeeded"
    });
    expect(metrics.recordDeviceGatewayOperation).toHaveBeenCalledWith({
      mode: "hdc",
      action: "write",
      status: "failed"
    });
    expect(spans).toEqual([
      expect.objectContaining({
        name: "debug.gateway.read",
        attributes: expect.objectContaining({
          service: "wiseeff-api",
          mode: "hdc",
          action: "read",
          status: "succeeded",
          hasParameterId: true
        })
      }),
      expect.objectContaining({
        name: "debug.gateway.write",
        attributes: expect.objectContaining({
          service: "wiseeff-api",
          mode: "hdc",
          action: "write",
          status: "failed",
          requiresApproval: false
        })
      })
    ]);
    expect(JSON.stringify(spans)).not.toContain("3200");
    expect(JSON.stringify(spans)).not.toContain("permission denied");
  });

  it("writeNode updates parameter current and target values after a verified write", async () => {
    const { db, txCalls } = createFakeDb([
      [sessionRow()],
      [parameterRow()],
      [bindingRow()],
      [targetRow()],
      (call) => [snapshotRow({ id: call.values[0], entries: JSON.parse(String(call.values[7])) })],
      (call) => [operationRow(call, { snapshot_id: "snapshot-1" })],
      [],
      []
    ]);
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    await service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" });

    const updateCall = txCalls.find((call) => call.text.includes("update debugging_parameters"));
    expect(updateCall?.values).toEqual(["org-1", "param-1", "3200", "3200"]);
  });

  it("writeNode writes audit metadata for successful writes", async () => {
    const { db } = createFakeDb([
      [sessionRow()],
      [parameterRow()],
      [bindingRow()],
      [targetRow()],
      (call) => [snapshotRow({ id: call.values[0], entries: JSON.parse(String(call.values[7])) })],
      (call) => [operationRow(call, { snapshot_id: "snapshot-1" })],
      [],
      []
    ]);
    const audit = createAuditSpy();
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

    const operation = await service.writeNode(
      writeAuth,
      { sessionId: "session-1", parameterId: "param-1", value: "3200" },
      { requestId: "request-debug-write-1" }
    );

    expect(audit.events[0]).toMatchObject({
      kind: "debug-node-write",
      action: "write",
      severity: "Medium",
      targetType: "debug-node",
      targetId: "param-1",
      metadata: expect.objectContaining({
        sessionId: "session-1",
        operationId: operation.id,
        nodePath: "/sys/current",
        requestedValue: "3200",
        previousValue: "3000",
        readbackValue: "3200",
        verified: true,
        snapshotId: expect.any(String)
      })
    });
    expect(audit.events[0].traceId).toBe("request-debug-write-1");
  });

  it("writeNode treats audit write failure as operation failure and transaction failure", async () => {
    const { db, rollbacks } = createFakeDb([
      [sessionRow()],
      [parameterRow()],
      [bindingRow()],
      [targetRow()],
      (call) => [snapshotRow({ id: call.values[0], entries: JSON.parse(String(call.values[7])) })],
      (call) => [operationRow(call, { snapshot_id: "snapshot-1" })],
      []
    ]);
    const createAuditEvent = vi.fn(async () => {
      throw new Error("audit unavailable");
    });
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent });

    await expect(service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })).rejects.toThrow(
      "audit unavailable"
    );

    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0].some((call) => call.text.includes("insert into node_operations"))).toBe(true);
  });

  it("rollbackSnapshot requires debugging:rollback and confirmation token before gateway call", async () => {
    const permissionGateway = makeGateway();
    const permissionService = createDebuggingService({
      db: createFakeDb().db,
      gateway: permissionGateway,
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(
      permissionService.rollbackSnapshot(writeAuth, {
        snapshotId: "snapshot-1",
        confirmationToken: "confirm-rollback"
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Missing permission: debugging:rollback.", 403, { permission: "debugging:rollback" }));
    expect(permissionGateway.writeNode).not.toHaveBeenCalled();

    const tokenGateway = makeGateway();
    const tokenService = createDebuggingService({
      db: createFakeDb().db,
      gateway: tokenGateway,
      createAuditEvent: createAuditSpy().createAuditEvent
    });

    await expect(
      tokenService.rollbackSnapshot(rollbackAuth, {
        snapshotId: "snapshot-1",
        confirmationToken: "wrong-token"
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Rollback confirmation is required.", 400));
    expect(tokenGateway.writeNode).not.toHaveBeenCalled();
  });

  it("rollbackSnapshot rejects missing, consumed, invalid, or cross-session snapshots", async () => {
    for (const snapshot of [null, snapshotRow({ status: "consumed" }), snapshotRow({ status: "invalid" }), snapshotRow({ session_id: "other-session" })]) {
      const { db } = createFakeDb([snapshot ? [snapshot] : [], snapshot ? [sessionRow()] : []]);
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.rollbackSnapshot(rollbackAuth, {
          snapshotId: "snapshot-1",
          confirmationToken: "confirm-rollback"
        })
      ).rejects.toMatchObject(new ApiError(snapshot ? "VALIDATION_FAILED" : "NOT_FOUND", snapshot ? "Snapshot is not valid for this session." : "Snapshot was not found.", snapshot ? 400 : 404));
    }
  });

  it("rollbackSnapshot rejects snapshots from a different project", async () => {
    const { db } = createFakeDb([[snapshotRow({ project_id: "other-project" })], [sessionRow()]]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(
      service.rollbackSnapshot(rollbackAuth, {
        snapshotId: "snapshot-1",
        confirmationToken: "confirm-rollback"
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Snapshot is not valid for this session.", 400));
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("rollbackSnapshot loads snapshot first, then denies inferred sessions outside the auth project scope before gateway writes", async () => {
    const { db, txCalls } = createFakeDb([[snapshotRow()], [sessionRow()]]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(
      service.rollbackSnapshot(otherProjectRollbackAuth, {
        snapshotId: "snapshot-1",
        confirmationToken: "confirm-rollback"
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId: "aurora" }));
    expect(txCalls[0].text).toContain("from debugging_snapshots");
    expect(txCalls[1].text).toContain("from debugging_sessions");
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("rollbackSnapshot claims snapshot before gateway writes and conflicts when claim fails", async () => {
    const callOrder: string[] = [];
    const { db } = createFakeDb([
      [snapshotRow()],
      [sessionRow()],
      (call) => {
        callOrder.push(call.text.includes("rollback_pending") ? "claim" : "unexpected-update");
        return [];
      }
    ]);
    const gateway = makeGateway({
      writeNode: vi.fn(async () => {
        callOrder.push("gateway-write");
        return {
          ok: true,
          verified: true,
          writeResult: { ok: true, value: "3000", durationMs: 3 },
          readResult: { ok: true, value: "3000", durationMs: 4 }
        };
      })
    });
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(
      service.rollbackSnapshot(rollbackAuth, {
        snapshotId: "snapshot-1",
        confirmationToken: "confirm-rollback"
      })
    ).rejects.toMatchObject(new ApiError("CONFLICT", "Snapshot is already being rolled back or has been consumed.", 409));

    expect(callOrder).toEqual(["claim"]);
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("rollbackSnapshot rejects a device lease held by another active session before gateway writes", async () => {
    const { db, txCalls } = createFakeDb([
      [snapshotRow()],
      [sessionRow()],
      [snapshotRow({ status: "rollback_pending" })],
      [targetRow()],
      debugDeviceLeaseResult([]),
      (call) => [operationRow(call)],
      [snapshotRow({ status: "consumed" })],
      []
    ]);
    const gateway = makeGateway();
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(
      service.rollbackSnapshot(rollbackAuth, {
        snapshotId: "snapshot-1",
        confirmationToken: "confirm-rollback"
      })
    ).rejects.toMatchObject(new ApiError("CONFLICT", "Debug device is leased by another active session.", 409));

    expect(txCalls.some((call) => call.text.includes("debug_device_leases"))).toBe(true);
    expect(gateway.writeNode).not.toHaveBeenCalled();
  });

  it("rollbackSnapshot keeps snapshot valid and inserts a failed event on partial failure", async () => {
    const entries = [
      { parameterId: "param-1", nodePath: "/sys/current", previousValue: "3000", targetValue: "3200" },
      { parameterId: "param-2", nodePath: "/sys/voltage", previousValue: "12", targetValue: "14" }
    ];
    const { db, txCalls } = createFakeDb([
      [snapshotRow({ entries })],
      [sessionRow()],
      [snapshotRow({ entries, status: "rollback_pending" })],
      [targetRow()],
      (call) => [operationRow(call, { status: "succeeded" })],
      (call) => [operationRow(call, { status: "failed", failure_reason: "Rollback write failed." })],
      [snapshotRow({ entries, status: "valid" })],
      []
    ]);
    const gateway = makeGateway({
      writeNode: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          verified: true,
          writeResult: { ok: true, value: "3000", durationMs: 3 },
          readResult: { ok: true, value: "3000", durationMs: 4 }
        })
        .mockResolvedValueOnce({
          ok: false,
          verified: false,
          error: "Rollback write failed.",
          writeResult: { ok: false, error: "Rollback write failed.", durationMs: 5 }
        })
    });
    const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

    const result = await service.rollbackSnapshot(rollbackAuth, {
      snapshotId: "snapshot-1",
      confirmationToken: "confirm-rollback"
    });

    expect(result.snapshot).toMatchObject({ id: "snapshot-1", status: "valid" });
    expect(result.operations).toEqual([
      expect.objectContaining({ status: "succeeded", requestedValue: "3000" }),
      expect.objectContaining({ status: "failed", requestedValue: "12" })
    ]);
    expect(txCalls.some((call) => call.text.includes("update debugging_snapshots") && call.text.includes("status = 'rollback_pending'"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("update debugging_snapshots") && call.text.includes("status = 'valid'"))).toBe(true);
    const eventCall = txCalls.find((call) => call.text.includes("insert into debugging_events"));
    expect(eventCall?.values.slice(1, 8)).toEqual(["org-1", "aurora", "session-1", null, "rollback-failed", "error", "Snapshot rollback failed."]);
    expect(JSON.parse(String(eventCall?.values[8]))).toMatchObject({ snapshotId: "snapshot-1", failures: [expect.objectContaining({ status: "failed" })] });
  });

  it("rollbackSnapshot writes previous values, records rollback operations, marks snapshot consumed", async () => {
    const { db, txCalls } = createFakeDb([
      [snapshotRow()],
      [sessionRow()],
      [snapshotRow({ status: "rollback_pending" })],
      [targetRow()],
      (call) => [operationRow(call)],
      [snapshotRow({ status: "consumed" })],
      []
    ]);
    const gateway = makeGateway();
    const audit = createAuditSpy();
    const metrics = createDeviceMetricsSpy();
    const { spans, tracing } = createTraceRecorder();
    const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent, metrics, gatewayMode: "simulator", tracing });

    const result = await service.rollbackSnapshot(rollbackAuth, {
      snapshotId: "snapshot-1",
      confirmationToken: "confirm-rollback"
    });

    expect(gateway.writeNode).toHaveBeenCalledWith({ targetRef: "simulator://aurora-1", nodePath: "/sys/current", value: "3000", readBack: true });
    expect(result.operations).toEqual([expect.objectContaining({ operationType: "rollback", status: "succeeded", requestedValue: "3000" })]);
    expect(result.snapshot).toEqual(expect.objectContaining({ id: "snapshot-1", status: "consumed" }));
    expect(txCalls.findIndex((call) => call.text.includes("rollback_pending"))).toBeLessThan(
      txCalls.findIndex((call) => call.text.includes("insert into node_operations"))
    );
    expect(txCalls.some((call) => call.text.includes("update debugging_snapshots") && call.values.includes("snapshot-1"))).toBe(true);
    expect(audit.events[0]).toMatchObject({
      kind: "debug-snapshot-rollback",
      action: "rollback",
      targetId: "snapshot-1",
      metadata: expect.objectContaining({ protocol: "hdc" })
    });
    expect(metrics.recordDeviceGatewayOperation).toHaveBeenCalledWith({
      mode: "simulator",
      action: "rollback",
      status: "succeeded"
    });
    expect(spans).toEqual([
      expect.objectContaining({
        name: "debug.gateway.rollback",
        attributes: expect.objectContaining({
          service: "wiseeff-api",
          mode: "simulator",
          action: "rollback",
          status: "succeeded",
          entryCount: 1
        })
      })
    ]);
    expect(JSON.stringify(spans)).not.toContain("/sys/current");
    expect(JSON.stringify(spans)).not.toContain("3000");
  });

  it("rollbackSnapshot inserts a succeeded event after successful rollback", async () => {
    const { db, txCalls } = createFakeDb([
      [snapshotRow()],
      [sessionRow()],
      [snapshotRow({ status: "rollback_pending" })],
      [targetRow()],
      (call) => [operationRow(call)],
      [snapshotRow({ status: "consumed" })],
      [],
      []
    ]);
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    await service.rollbackSnapshot(rollbackAuth, {
      snapshotId: "snapshot-1",
      confirmationToken: "confirm-rollback"
    });

    const eventCall = txCalls.find((call) => call.text.includes("insert into debugging_events"));
    expect(eventCall?.values.slice(1, 8)).toEqual([
      "org-1",
      "aurora",
      "session-1",
      null,
      "rollback-succeeded",
      "info",
      "Snapshot rollback succeeded."
    ]);
    expect(JSON.parse(String(eventCall?.values[8]))).toMatchObject({ snapshotId: "snapshot-1", operationCount: 1, protocol: "hdc" });
  });

  it("listDevices, listParameters, getSession, and listSessionEvents require view permission and return records", async () => {
    const { db, calls } = createFakeDb([
      [deviceRow()],
      [parameterRow()],
      [sessionRow()],
      [sessionRow()],
      [
        {
          id: "operation-1",
          organization_id: "org-1",
          project_id: "aurora",
          session_id: "session-1",
          parameter_id: "param-1",
          protocol: "hdc",
          node_path: "/sys/current",
          operation_type: "read",
          status: "succeeded",
          requested_value: null,
          previous_value: null,
          read_value: "3000",
          readback_value: null,
          verified: true,
          failure_reason: null,
          duration_ms: 5,
          approval_id: null,
          snapshot_id: null,
          created_at: timestamp
        }
      ]
    ]);
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.listDevices(makeAuth([]), { projectId: "aurora" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Missing permission: debugging:view.", 403, { permission: "debugging:view" })
    );
    await expect(service.listParameters(makeAuth([]), { projectId: "aurora" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Missing permission: debugging:view.", 403, { permission: "debugging:view" })
    );
    await expect(service.getSession(makeAuth([]), { sessionId: "session-1" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Missing permission: debugging:view.", 403, { permission: "debugging:view" })
    );
    await expect(service.listSessionEvents(makeAuth([]), { sessionId: "session-1" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Missing permission: debugging:view.", 403, { permission: "debugging:view" })
    );

    await expect(service.listDevices(readAuth, { projectId: "aurora" })).resolves.toEqual([
      expect.objectContaining({ id: "device-1", projectId: "aurora" })
    ]);
    await expect(service.listParameters(readAuth, { projectId: "aurora", module: "Battery", risk: ["Medium"] })).resolves.toEqual([
      expect.objectContaining({ id: "param-1", nodePath: "/sys/current" })
    ]);
    await expect(service.getSession(readAuth, { sessionId: "session-1" })).resolves.toMatchObject({ id: "session-1", status: "active" });
    await expect(service.listSessionEvents(readAuth, { sessionId: "session-1" })).resolves.toEqual([
      expect.objectContaining({ id: "operation-1", operationType: "read" })
    ]);

    expect(calls).toHaveLength(5);
    expect(calls[0].text).toContain("from debugging_devices");
    expect(calls[1].text).toContain("from debugging_parameters");
    expect(calls[2].text).toContain("from debugging_sessions");
    expect(calls[3].text).toContain("from debugging_sessions");
    expect(calls[4].text).toContain("from node_operations");
  });

  it("getSession and listSessionEvents deny session-backed records outside the auth project scope", async () => {
    const { db } = createFakeDb([[sessionRow()], [sessionRow()]]);
    const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

    await expect(service.getSession(otherProjectReadAuth, { sessionId: "session-1" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId: "aurora" })
    );
    await expect(service.listSessionEvents(otherProjectReadAuth, { sessionId: "session-1" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId: "aurora" })
    );
  });
});
