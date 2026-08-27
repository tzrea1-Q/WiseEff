/**
 * Behavior-level coverage for the debugging service: admin catalog CRUD,
 * device/target detection, sessions, node reads/writes, snapshots, and
 * rollback against a real database. Device I/O stays behind the gateway,
 * bridge-RPC, audit, metrics, and tracing ports (dependency-injected mocks);
 * every database effect is asserted through returned DTOs and subsequent
 * reads — never SQL text.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracingBoundary, type TraceExporter } from "../../observability/tracing";
import { serializePostgresJsonb } from "../../shared/database/jsonb";
import { ApiError } from "../../shared/http/errors";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import type { AuthContext } from "../auth/types";
import type { CreateAuditEventInput } from "../audit/types";
import { createAgentApproval, createAgentSession } from "../agent/repository";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import type { DebugDeviceGateway, GatewayWriteResult } from "./gateway";
import { createDebugDeviceGatewayRegistry } from "./gatewayRegistry";
import {
  acquireDebugDeviceLease,
  createDebugParameter,
  createDebugSession,
  createDebugSnapshot,
  upsertDebugParameterNodeBinding
} from "./repository";
import {
  createDebugNode,
  getDebugNodeBinding,
  listDebugNodeBindings,
  listDebugNodes,
  upsertDebugNodeBinding
} from "./catalogSplitRepository";
import { createDebuggingService } from "./service";
import type { DebugParameterRecord, DebugSessionRecord } from "./types";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(
  permissions: AuthContext["permissions"],
  roles: AuthContext["roles"] = [{ roleId: "software-user" }],
  userId = "user-1"
): AuthContext {
  return {
    user: {
      id: userId,
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
      targets: [
        { id: "target-1", deviceId: "device-1", targetRef: "simulator://aurora-1", label: "Aurora Target", online: true }
      ]
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
  const createAuditEvent = vi.fn(async (_db: unknown, input: CreateAuditEventInput) => {
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

const readAuth = makeAuth(["debugging:view", "debugging:read"]);
const writeAuth = makeAuth(["debugging:view", "debugging:read", "debugging:write"]);
const rollbackAuth = makeAuth(["debugging:view", "debugging:read", "debugging:write", "debugging:rollback"]);
const adminAuth = makeAuth(["debugging:view", "debugging:read", "debugging:write", "debugging:admin"], [
  { roleId: "admin" }
]);

describe.skipIf(!databaseAvailable)("debugging service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "user-1", name: "Riley Chen", email: "riley@example.com" },
        { id: "user-2", name: "Other User", email: "other@example.com" }
      ]
    });
    await seedCoreGraph(db, {
      organization: { id: "org-2", name: "Foreign Org" },
      users: [{ id: "user-foreign", name: "Foreign User", email: "foreign@example.com" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedDevice(overrides: Record<string, unknown> = {}) {
    const row = {
      id: "device-1",
      organization_id: "org-1",
      name: "Aurora Simulator",
      transport: "simulator",
      status: "online",
      firmware: "sim-1.0",
      ...overrides
    };
    await db.query(
      `insert into debugging_devices (id, organization_id, name, transport, status, firmware, last_seen_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [row.id, row.organization_id, row.name, row.transport, row.status, row.firmware]
    );
    return row;
  }

  async function seedTarget(overrides: Record<string, unknown> = {}) {
    const row = {
      id: "target-1",
      organization_id: "org-1",
      device_id: "device-1",
      protocol: "hdc",
      bridge_id: null,
      target_ref: "simulator://aurora-1",
      label: "Aurora Target",
      status: "detected",
      ...overrides
    };
    await db.query(
      `insert into debugging_targets (id, organization_id, device_id, protocol, bridge_id, target_ref, label, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.id, row.organization_id, row.device_id, row.protocol, row.bridge_id, row.target_ref, row.label, row.status]
    );
    return row;
  }

  async function seedBridge(overrides: Record<string, unknown> = {}) {
    const row = {
      id: "br-1",
      organization_id: "org-1",
      user_id: "user-1",
      machine_label: "Laptop",
      ...overrides
    };
    await db.query(
      `insert into device_bridges (id, organization_id, user_id, machine_label, platform, arch, client_version, last_seen_at)
       values ($1, $2, $3, $4, 'windows', 'amd64', '0.1.0', now())`,
      [row.id, row.organization_id, row.user_id, row.machine_label]
    );
    return row;
  }

  async function seedParameter(overrides: Record<string, unknown> = {}): Promise<DebugParameterRecord> {
    const key = (overrides.key as string) ?? "fast_charge_current";
    const organizationId = (overrides.organizationId as string) ?? "org-1";
    const parameter = await createDebugParameter(db, {
      organizationId,
      name: (overrides.name as string) ?? "Fast charge current",
      key,
      description: "Controls constant charge current.",
      module: (overrides.module as string) ?? "Battery",
      nodePath: (overrides.nodePath as string) ?? `/sys/${key.replaceAll(".", "/")}`,
      accessMode: (overrides.accessMode as "RW" | "RO" | "WO") ?? "RW",
      unit: "mA",
      range: "0-5000",
      minValue: overrides.minValue === undefined ? 0 : (overrides.minValue as number | null),
      maxValue: overrides.maxValue === undefined ? 5000 : (overrides.maxValue as number | null),
      risk: (overrides.risk as DebugParameterRecord["risk"]) ?? "Medium",
      currentValue: "3000",
      targetValue: "3200",
      sortOrder: 10,
      enabled: (overrides.enabled as boolean) ?? true,
      valueKind: overrides.valueKind as DebugParameterRecord["valueKind"] | undefined,
      valueFormat: overrides.valueFormat as DebugParameterRecord["valueFormat"] | undefined,
      normalizationMode: overrides.normalizationMode as DebugParameterRecord["normalizationMode"] | undefined
    });
    // Deliberately no same-id debug_nodes mirror row: production admin creation
    // never writes one, and operation inserts must not depend on it (#416).
    return parameter;
  }

  async function seedBinding(
    parameterId: string,
    overrides: { protocol?: "hdc" | "adb"; nodePath?: string; accessMode?: "RW" | "RO" | "WO"; enabled?: boolean; notes?: string | null } = {}
  ) {
    const binding = await upsertDebugParameterNodeBinding(db, {
      organizationId: "org-1",
      parameterId,
      protocol: overrides.protocol ?? "hdc",
      nodePath: overrides.nodePath ?? "/sys/current",
      accessMode: overrides.accessMode ?? "RW",
      enabled: overrides.enabled ?? true,
      notes: overrides.notes ?? null
    });
    if (!binding) throw new Error("failed to seed binding");
    return binding;
  }

  async function seedSession(
    overrides: {
      protocol?: "hdc" | "adb";
      executionMode?: "server" | "bridge";
      bridgeId?: string | null;
      bridgeMachineLabel?: string | null;
      actorUserId?: string;
      deviceId?: string;
      targetId?: string;
    } = {}
  ): Promise<DebugSessionRecord> {
    return createDebugSession(db, {
      organizationId: "org-1",
      deviceId: overrides.deviceId ?? "device-1",
      targetId: overrides.targetId ?? "target-1",
      protocol: overrides.protocol ?? "hdc",
      executionMode: overrides.executionMode,
      bridgeId: overrides.bridgeId,
      bridgeMachineLabel: overrides.bridgeMachineLabel,
      actorUserId: overrides.actorUserId ?? "user-1"
    });
  }

  async function seedAgentDeviceApproval(input: {
    approvalId?: string;
    toolName?: string;
    status?: "pending" | "approved" | "rejected";
    payload: Record<string, unknown>;
    organizationId?: string;
    userId?: string;
  }) {
    const organizationId = input.organizationId ?? "org-1";
    const userId = input.userId ?? "user-1";
    const sessionId = `agent-session-${randomUUID()}`;
    const toolCallId = `agent-tool-${randomUUID()}`;
    const approvalId = input.approvalId ?? `agent-approval-${randomUUID()}`;
    await createAgentSession(db, {
      id: sessionId,
      organizationId,
      actorUserId: userId,
      pageKey: "node-debugging",
      context: { path: "/node-debugging", pageKey: "node-debugging" },
      title: "Device write approval"
    });
    await db.query(
      `insert into agent_tool_calls (
         id, session_id, organization_id, name, label, payload, requires_approval, status
       ) values ($1, $2, $3, $4, $5, $6::jsonb, true, 'pending_approval')`,
      [
        toolCallId,
        sessionId,
        organizationId,
        input.toolName ?? "action.writeDebugNode",
        "Write debug node",
        serializePostgresJsonb(input.payload)
      ]
    );
    await createAgentApproval(db, {
      id: approvalId,
      sessionId,
      toolCallId,
      organizationId,
      status: input.status ?? "approved",
      title: "Device write",
      message: "Approve the device write.",
      requestedByUserId: userId
    });
    return { approvalId, sessionId, toolCallId };
  }

  /** Standard server-mode runtime: online device, detected target, RW parameter + hdc binding, active session. */
  async function seedRuntime(overrides: { bindingAccessMode?: "RW" | "RO" | "WO"; parameter?: Record<string, unknown> } = {}) {
    await seedDevice();
    await seedTarget();
    const parameter = await seedParameter(overrides.parameter ?? {});
    const binding = await seedBinding(parameter.id, { accessMode: overrides.bindingAccessMode ?? "RW" });
    const session = await seedSession();
    return { parameter, binding, session };
  }

  /**
   * Regression seed for #416: create the catalog parameter through the admin
   * service path exactly like production does — debugging_parameters plus
   * debugging_parameter_node_bindings only, never a same-id debug_nodes row.
   */
  async function seedAdminParameter(
    service: ReturnType<typeof createDebuggingService>,
    overrides: { nodePath?: string } = {}
  ) {
    return service.createAdminParameter(adminAuth, {
      name: "Admin-created current limit",
      key: "admin_current_limit",
      description: "Created through the live admin surface.",
      module: "Battery",
      risk: "Medium",
      unit: "mA",
      range: "0-5000",
      minValue: 0,
      maxValue: 5000,
      currentValue: "3000",
      targetValue: "3200",
      sortOrder: 10,
      enabled: true,
      bindings: [{ protocol: "hdc", nodePath: overrides.nodePath ?? "/sys/current", accessMode: "RW", enabled: true }]
    });
  }

  async function nodeOperationRows(sessionId?: string) {
    const result = await db.query<{
      id: string;
      session_id: string;
      parameter_id: string | null;
      node_id: string | null;
      operation_type: string;
      status: string;
      node_path: string;
    }>(
      `select id, session_id, parameter_id, node_id, operation_type, status, node_path
       from node_operations
       ${sessionId ? "where session_id = $1" : ""}
       order by id`,
      sessionId ? [sessionId] : []
    );
    return result.rows;
  }

  async function snapshotRows() {
    const result = await db.query<{ id: string; status: string; entries: unknown }>(
      `select id, status, entries from debugging_snapshots order by id`
    );
    return result.rows;
  }

  describe("admin parameter catalog", () => {
    it("deletes an unused node, cascades bindings, and records a summary audit", async () => {
      const node = await createDebugNode(db, {
        organizationId: "org-1",
        name: "Unused node",
        description: "Safe to remove"
      });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: node.id,
        protocol: "hdc",
        nodePath: "/sys/unused",
        accessMode: "RW",
        enabled: true
      });
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

      await service.deleteAdminDebugNode(adminAuth, node.id, { requestId: "request-delete" });

      await expect(listDebugNodes(db, { organizationId: "org-1", includeArchived: true })).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: node.id })])
      );
      await expect(listDebugNodeBindings(db, { organizationId: "org-1", nodeId: node.id })).resolves.toEqual([]);
      expect(audit.events[0]).toMatchObject({
        traceId: "request-delete",
        app: "debugging",
        kind: "debug-node-admin-delete",
        action: "delete",
        targetType: "debug-node-registry",
        targetId: node.id,
        metadata: { nodeId: node.id, name: "Unused node", bindingCount: 1 }
      });
      expect(JSON.stringify(audit.events[0].metadata)).not.toContain("/sys/unused");
    });

    it("deletes a node with its operation history and bindings in one audited transaction", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession();
      const node = await createDebugNode(db, { organizationId: "org-1", name: "Historical node" });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: node.id,
        protocol: "adb",
        nodePath: "/sys/historical",
        accessMode: "RO",
        enabled: true
      });
      await db.query(
        `insert into node_operations (
           id, organization_id, session_id, node_id, node_path, operation_type, status, actor_user_id
         ) values ('operation-delete-protection', 'org-1', $1, $2, '/sys/historical', 'read', 'failed', 'user-1')`,
        [session.id, node.id]
      );
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

      await expect(service.deleteAdminDebugNode(adminAuth, node.id, { requestId: "request-cascade" })).resolves.toBeUndefined();
      await expect(listDebugNodes(db, { organizationId: "org-1", includeArchived: true })).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: node.id })])
      );
      await expect(
        getDebugNodeBinding(db, { organizationId: "org-1", nodeId: node.id, protocol: "adb", includeDisabled: true })
      ).resolves.toBeNull();
      await expect(
        db.query<{ count: string }>("select count(*)::text as count from node_operations where node_id = $1", [node.id])
      ).resolves.toMatchObject({ rows: [{ count: "0" }] });
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]).toMatchObject({
        traceId: "request-cascade",
        kind: "debug-node-admin-delete",
        severity: "High",
        metadata: { nodeId: node.id, name: "Historical node", bindingCount: 1, operationCount: 1 }
      });
      expect(JSON.stringify(audit.events[0]?.metadata)).not.toContain("/sys/historical");
    });

    it("deletes an unused disabled node and hides foreign or unknown nodes as not found", async () => {
      const disabledNode = await createDebugNode(db, { organizationId: "org-1", name: "Disabled unused node" });
      await db.query(`update debug_nodes set enabled = false where id = $1`, [disabledNode.id]);
      const foreignNode = await createDebugNode(db, { organizationId: "org-2", name: "Foreign node" });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.deleteAdminDebugNode(readAuth, disabledNode.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(service.deleteAdminDebugNode(adminAuth, foreignNode.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(service.deleteAdminDebugNode(adminAuth, "unknown-node")).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(service.deleteAdminDebugNode(adminAuth, disabledNode.id)).resolves.toBeUndefined();
      await expect(listDebugNodes(db, { organizationId: "org-1", includeArchived: true })).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: disabledNode.id })])
      );
      await expect(listDebugNodes(db, { organizationId: "org-2", includeArchived: true })).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: foreignNode.id })])
      );
    });

    it("listAdminParameters requires debugging:admin, includes archived rows, and returns bindings", async () => {
      const parameter = await seedParameter({ enabled: false });
      await db.query(`update debugging_parameters set archived_at = now(), archived_by = 'user-1' where id = $1`, [
        parameter.id
      ]);
      await seedBinding(parameter.id, { protocol: "hdc", nodePath: "/sys/hdc/current" });
      await seedBinding(parameter.id, { protocol: "adb", nodePath: "/sys/adb/current" });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.listAdminParameters(readAuth, { includeArchived: true })).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Missing permission: debugging:admin.", { permission: "debugging:admin" })
      );

      const items = await service.listAdminParameters(adminAuth, { includeArchived: true });

      expect(items).toEqual([
        expect.objectContaining({
          id: parameter.id,
          enabled: false,
          selectedBinding: expect.objectContaining({ protocol: "hdc" }),
          bindings: expect.arrayContaining([
            expect.objectContaining({ protocol: "hdc" }),
            expect.objectContaining({ protocol: "adb" })
          ])
        })
      ]);
      expect(items[0].archivedAt).not.toBeNull();
    });

    it("filters admin parameters by binding coverage after attaching bindings", async () => {
      const covered = await seedParameter({ key: "covered", nodePath: "/sys/covered" });
      await seedBinding(covered.id, { protocol: "hdc", nodePath: "/sys/covered/hdc" });
      await seedBinding(covered.id, { protocol: "adb", nodePath: "/sys/covered/adb" });
      const uncovered = await seedParameter({ key: "voltage", name: "Voltage", nodePath: "/sys/voltage" });
      await seedBinding(uncovered.id, { protocol: "hdc", nodePath: "/sys/voltage/hdc" });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.listAdminParameters(adminAuth, { coverage: "missing-adb" })).resolves.toEqual([
        expect.objectContaining({ id: uncovered.id })
      ]);
    });

    it("treats archived coverage as an admin archived query", async () => {
      await seedParameter({ key: "active", nodePath: "/sys/active" });
      const archived = await seedParameter({ key: "archived", nodePath: "/sys/archived", enabled: false });
      await db.query(`update debugging_parameters set archived_at = '2026-06-22T12:00:00.000Z' where id = $1`, [
        archived.id
      ]);
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      // Without includeArchived, the archived coverage filter still reaches archived rows.
      await expect(service.listAdminParameters(adminAuth, { coverage: "archived" })).resolves.toEqual([
        expect.objectContaining({ id: archived.id, archivedAt: "2026-06-22T12:00:00.000Z" })
      ]);
    });

    it("archives a debug parameter and writes summary audit metadata", async () => {
      const parameter = await seedParameter({ nodePath: "/sys/current" });
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

      const item = await service.archiveAdminParameter(
        adminAuth,
        { parameterId: parameter.id, reason: "Deprecated" },
        { requestId: "request-1" }
      );

      expect(item).toMatchObject({ id: parameter.id, enabled: true });
      expect(item.archivedAt).not.toBeNull();
      // The archive is persisted, not just mapped.
      const stored = await db.query<{ archived_at: string | null; archive_reason: string | null }>(
        `select archived_at, archive_reason from debugging_parameters where id = $1`,
        [parameter.id]
      );
      expect(stored.rows[0].archived_at).not.toBeNull();
      expect(stored.rows[0].archive_reason).toBe("Deprecated");
      expect(audit.events[0]).toMatchObject({
        traceId: "request-1",
        app: "debugging",
        kind: "debug-parameter-admin-archive",
        action: "archive",
        targetType: "debug-parameter",
        targetId: parameter.id,
        metadata: { parameterId: parameter.id, enabled: true, archived: true, hasReason: true }
      });
      expect(JSON.stringify(audit.events[0].metadata)).not.toContain("/sys/current");
    });

    it("creates an admin parameter with bindings in one transaction and omits raw node paths from audit", async () => {
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

      const item = await service.createAdminParameter(
        adminAuth,
        {
          name: "Created parameter",
          key: "created_parameter",
          description: "Created in admin.",
          module: "Battery",
          risk: "Medium",
          unit: "mA",
          range: "0-5000",
          minValue: 0,
          maxValue: 5000,
          currentValue: "100",
          targetValue: "200",
          sortOrder: 20,
          enabled: true,
          bindings: [
            { protocol: "hdc", nodePath: "/sys/hdc/path", accessMode: "RW", enabled: true },
            { protocol: "adb", nodePath: "/sys/adb/path", accessMode: "RO", enabled: true, notes: "ADB lab" }
          ]
        },
        { requestId: "request-create" }
      );

      expect(item).toMatchObject({
        name: "Created parameter",
        selectedBinding: expect.objectContaining({ protocol: "hdc" }),
        bindings: expect.arrayContaining([
          expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/path", accessMode: "RW" }),
          expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/path", accessMode: "RO", notes: "ADB lab" })
        ])
      });
      // Both the parameter and its bindings are durable rows.
      const bindings = await db.query<{ protocol: string }>(
        `select protocol from debugging_parameter_node_bindings where parameter_id = $1 order by protocol`,
        [item.id]
      );
      expect(bindings.rows.map((row) => row.protocol)).toEqual(["adb", "hdc"]);
      expect(audit.events[0]).toMatchObject({
        kind: "debug-parameter-admin-create",
        action: "create",
        metadata: { parameterId: item.id, enabled: true, bindingCount: 2, protocols: ["adb", "hdc"] }
      });
      expect(JSON.stringify(audit.events[0].metadata)).not.toContain("/sys/hdc/path");
      expect(JSON.stringify(audit.events[0].metadata)).not.toContain("/sys/adb/path");
    });

    it("updates an admin parameter with bindings in one transaction and omits raw node paths from audit", async () => {
      const parameter = await seedParameter({ name: "Existing parameter", nodePath: "/sys/existing" });
      await seedBinding(parameter.id, { protocol: "adb", nodePath: "/sys/adb/existing", accessMode: "RO" });
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

      const item = await service.updateAdminParameter(
        adminAuth,
        {
          parameterId: parameter.id,
          name: "Updated parameter",
          description: "Updated in admin.",
          risk: "High",
          minValue: null,
          maxValue: null,
          sortOrder: 0,
          enabled: false,
          bindings: [{ protocol: "hdc", nodePath: "/sys/updated", accessMode: "RW", enabled: true, notes: "Updated binding" }]
        },
        { requestId: "request-update" }
      );

      expect(item).toMatchObject({
        id: parameter.id,
        name: "Updated parameter",
        risk: "High",
        minValue: null,
        maxValue: null,
        sortOrder: 0,
        enabled: false,
        selectedBinding: expect.objectContaining({ protocol: "hdc", nodePath: "/sys/updated" }),
        bindings: expect.arrayContaining([
          expect.objectContaining({ parameterId: parameter.id, protocol: "hdc", nodePath: "/sys/updated", notes: "Updated binding" }),
          expect.objectContaining({ parameterId: parameter.id, protocol: "adb", nodePath: "/sys/adb/existing" })
        ])
      });
      const stored = await db.query<{ name: string; min_value: string | null; sort_order: number; enabled: boolean }>(
        `select name, min_value, sort_order, enabled from debugging_parameters where id = $1`,
        [parameter.id]
      );
      expect(stored.rows[0]).toEqual({ name: "Updated parameter", min_value: null, sort_order: 0, enabled: false });
      expect(audit.events[0]).toMatchObject({
        traceId: "request-update",
        kind: "debug-parameter-admin-update",
        action: "update",
        targetType: "debug-parameter",
        targetId: parameter.id,
        metadata: { parameterId: parameter.id, enabled: false, bindingCount: 2, protocols: ["adb", "hdc"] }
      });
      expect(JSON.stringify(audit.events[0].metadata)).not.toContain("/sys/updated");
    });

    it("upserts an admin parameter binding and converts repository null to NOT_FOUND", async () => {
      const parameter = await seedParameter();
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

      await expect(
        service.upsertAdminParameterBinding(
          adminAuth,
          { parameterId: parameter.id, protocol: "adb", nodePath: "/sys/adb/path", accessMode: "RO", enabled: true, notes: "ADB" },
          { requestId: "request-binding" }
        )
      ).resolves.toMatchObject({ parameterId: parameter.id, protocol: "adb", enabled: true });
      expect(audit.events[0]).toMatchObject({
        kind: "debug-parameter-binding-admin-upsert",
        action: "update",
        targetType: "debug-parameter-binding",
        targetId: `${parameter.id}:adb`,
        metadata: { parameterId: parameter.id, protocol: "adb", enabled: true }
      });
      expect(JSON.stringify(audit.events[0].metadata)).not.toContain("/sys/adb/path");

      await expect(
        service.upsertAdminParameterBinding(adminAuth, {
          parameterId: "missing-param",
          protocol: "adb",
          nodePath: "/sys/adb/path",
          accessMode: "RO",
          enabled: true
        })
      ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Debug parameter was not found."));
      // The failed transaction left no binding row behind.
      const rows = await db.query<{ parameter_id: string }>(
        `select parameter_id from debugging_parameter_node_bindings where parameter_id = 'missing-param'`
      );
      expect(rows.rows).toEqual([]);
    });
  });

  describe("runtime listings", () => {
    it("listDevices and listParameters scope queries to the auth organization", async () => {
      await seedDevice();
      await seedDevice({ id: "device-foreign", organization_id: "org-2", name: "Foreign Bench" });
      const mine = await seedParameter();
      await seedParameter({ organizationId: "org-2", key: "foreign", nodePath: "/sys/foreign" });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.listDevices(readAuth)).resolves.toEqual([expect.objectContaining({ id: "device-1" })]);
      await expect(service.listParameters(readAuth)).resolves.toEqual([expect.objectContaining({ id: mine.id })]);
    });

    it("lists selected-protocol parameter bindings for frontend availability", async () => {
      const parameter = await seedParameter();
      await seedBinding(parameter.id, { protocol: "hdc", nodePath: "/sys/current" });
      await seedBinding(parameter.id, { protocol: "adb", nodePath: "/sys/adb/current", notes: "ADB lab" });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.listParameters(readAuth, { protocol: "adb" })).resolves.toEqual([
        expect.objectContaining({
          id: parameter.id,
          selectedBinding: expect.objectContaining({
            parameterId: parameter.id,
            protocol: "adb",
            nodePath: "/sys/adb/current",
            enabled: true,
            notes: "ADB lab"
          }),
          // A protocol-scoped listing loads only that protocol's bindings — the old
          // fake fixture returned both protocols here, which the real query never did.
          bindings: [expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/current", enabled: true })]
        })
      ]);
    });

    it("filters runtime parameters without an enabled selected-protocol binding", async () => {
      const hdcOnly = await seedParameter({ key: "hdc_only", nodePath: "/sys/hdc/only" });
      await seedBinding(hdcOnly.id, { protocol: "hdc", nodePath: "/sys/hdc/only" });
      const adbDisabled = await seedParameter({ key: "adb_disabled", nodePath: "/sys/adb/disabled" });
      await seedBinding(adbDisabled.id, { protocol: "adb", nodePath: "/sys/adb/disabled", enabled: false });
      const adbEnabled = await seedParameter({ key: "adb_enabled", nodePath: "/sys/adb/enabled" });
      await seedBinding(adbEnabled.id, { protocol: "adb", nodePath: "/sys/adb/enabled" });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.listParameters(readAuth, { protocol: "adb" })).resolves.toEqual([
        expect.objectContaining({
          id: adbEnabled.id,
          selectedBinding: expect.objectContaining({ protocol: "adb", enabled: true })
        })
      ]);
    });

    it("listDevices, listParameters, getSession, and listSessionEvents require view permission and return records", async () => {
      await seedDevice();
      await seedTarget();
      const parameter = await seedParameter({ module: "Battery", risk: "Medium" });
      const session = await seedSession();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.listDevices(makeAuth([]))).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Missing permission: debugging:view.", { permission: "debugging:view" })
      );
      await expect(service.listParameters(makeAuth([]))).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Missing permission: debugging:view.", { permission: "debugging:view" })
      );
      await expect(service.getSession(makeAuth([]), { sessionId: session.id })).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Missing permission: debugging:view.", { permission: "debugging:view" })
      );
      await expect(service.listSessionEvents(makeAuth([]), { sessionId: session.id })).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Missing permission: debugging:view.", { permission: "debugging:view" })
      );

      // Record an operation through the real write path so the event listing has content.
      await seedBinding(parameter.id);
      const writeService = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });
      await writeService.readNode(readAuth, { sessionId: session.id, parameterId: parameter.id });

      await expect(service.listDevices(readAuth)).resolves.toEqual([expect.objectContaining({ id: "device-1" })]);
      await expect(service.listParameters(readAuth, { module: "Battery", risk: ["Medium"] })).resolves.toEqual([
        expect.objectContaining({ id: parameter.id, nodePath: parameter.nodePath })
      ]);
      await expect(service.getSession(readAuth, { sessionId: session.id })).resolves.toMatchObject({
        id: session.id,
        status: "active"
      });
      await expect(service.listSessionEvents(readAuth, { sessionId: session.id })).resolves.toEqual([
        expect.objectContaining({ operationType: "read", status: "succeeded" })
      ]);
    });
  });

  describe("detectTargets", () => {
    it("requires debugging:read, calls gateway, persists targets, writes audit", async () => {
      await seedDevice();
      const gateway = makeGateway();
      const audit = createAuditSpy();
      const metrics = createDeviceMetricsSpy();
      const { spans, tracing } = createTraceRecorder();
      const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent, metrics, gatewayMode: "simulator", tracing });

      await expect(service.detectTargets(makeAuth(["debugging:view"]), { deviceId: "device-1" })).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Missing permission: debugging:read.", { permission: "debugging:read" })
      );

      const targets = await service.detectTargets(readAuth, { deviceId: "device-1" });

      expect(gateway.detectTargets).toHaveBeenCalledWith({ deviceId: "device-1" });
      expect(targets).toEqual([
        expect.objectContaining({ id: "target-1", status: "detected", targetRef: "simulator://aurora-1" })
      ]);
      // The detected target is a durable row.
      const stored = await db.query<{ id: string; status: string }>(`select id, status from debugging_targets`);
      expect(stored.rows).toEqual([{ id: "target-1", status: "detected" }]);
      expect(audit.events[0]).toMatchObject({
        organizationId: "org-1",
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
      await seedDevice({ transport: "adb" });
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
      const audit = createAuditSpy();
      const service = createDebuggingService({
        db,
        gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }),
        createAuditEvent: audit.createAuditEvent
      });

      const targets = await service.detectTargets(readAuth, { deviceId: "device-1", protocol: "adb" });

      expect(targets[0]).toMatchObject({ protocol: "adb", targetRef: "emulator-5554" });
      expect(adbGateway.detectTargets).toHaveBeenCalledWith({ deviceId: "device-1" });
      expect(audit.events.at(-1)?.metadata).toMatchObject({ protocol: "adb", targetCount: 1 });
    });

    it("persists detected targets with the requested protocol even if an adapter reports a conflicting protocol", async () => {
      await seedDevice({ transport: "adb" });
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
      const service = createDebuggingService({
        db,
        gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }),
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      await service.detectTargets(readAuth, { deviceId: "device-1", protocol: "adb" });

      const stored = await db.query<{ protocol: string }>(
        `select protocol from debugging_targets where id = 'adb:emulator-5554'`
      );
      expect(stored.rows).toEqual([{ protocol: "adb" }]);
    });

    it("commits a failed debug event when gateway detection fails", async () => {
      await seedDevice();
      const metrics = createDeviceMetricsSpy();
      const service = createDebuggingService({
        db,
        gateway: makeGateway({ detectTargets: vi.fn(async () => ({ ok: false, targets: [], error: "USB bridge unavailable." })) }),
        createAuditEvent: createAuditSpy().createAuditEvent,
        metrics,
        gatewayMode: "hdc"
      });

      await expect(service.detectTargets(readAuth, { deviceId: "device-1" })).rejects.toMatchObject(
        new ApiError("DEVICE_UNAVAILABLE", "USB bridge unavailable.")
      );

      // The failure event committed even though the detect call threw.
      const events = await db.query<{ kind: string; severity: string }>(
        `select kind, severity from debugging_events where organization_id = 'org-1'`
      );
      expect(events.rows).toEqual([{ kind: "target-detect-failed", severity: "error" }]);
      expect(metrics.recordDeviceGatewayOperation).toHaveBeenCalledWith({
        mode: "hdc",
        action: "detect",
        status: "failed"
      });
    });

    it("succeeds when bridge targets are available even if server gateway detection fails", async () => {
      await seedBridge();
      const bridgeRpcClient = {
        call: vi.fn().mockResolvedValueOnce({ targets: [{ targetRef: "serial-1", online: true, label: "HDC serial-1" }] })
      };
      const bridgeConnectionPool = {
        isConnected: vi.fn((bridgeId: string) => bridgeId === "br-1")
      };
      const service = createDebuggingService({
        db,
        gateway: makeGateway({
          detectTargets: vi.fn(async () => ({
            ok: false,
            targets: [],
            error:
              "HDC target detection requires deviceId so detected targets can be persisted against a known debugging device."
          }))
        }),
        bridgeConnectionPool,
        bridgeRpcClient,
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      const targets = await service.detectTargets(readAuth, { protocol: "hdc", bridgeId: "br-1" });

      expect(targets).toEqual([
        expect.objectContaining({
          id: "bridge:br-1:hdc:serial-1",
          bridgeId: "br-1",
          deviceId: "bridge:br-1",
          targetRef: "serial-1"
        })
      ]);
      const stored = await db.query<{ bridge_id: string | null }>(
        `select bridge_id from debugging_targets where id = 'bridge:br-1:hdc:serial-1'`
      );
      expect(stored.rows).toEqual([{ bridge_id: "br-1" }]);
    });

    it("skips bridge detection when bridgeId is omitted", async () => {
      await seedBridge({ id: "br-1", machine_label: "Laptop" });
      await seedBridge({ id: "br-2", machine_label: "Desktop" });
      const bridgeRpcClient = {
        call: vi
          .fn()
          .mockResolvedValueOnce({ targets: [{ targetRef: "serial-1", online: true, label: "ADB serial-1" }] })
          .mockResolvedValueOnce({ targets: [] })
      };
      const bridgeConnectionPool = {
        isConnected: vi.fn((bridgeId: string) => bridgeId === "br-1" || bridgeId === "br-2")
      };
      const service = createDebuggingService({
        db,
        gateway: makeGateway({ detectTargets: vi.fn(async () => ({ ok: true, targets: [] })) }),
        bridgeConnectionPool,
        bridgeRpcClient,
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      const targets = await service.detectTargets(readAuth, {});

      expect(bridgeRpcClient.call).not.toHaveBeenCalled();
      expect(targets).toEqual([]);
      const stored = await db.query<{ id: string }>(`select id from debugging_targets`);
      expect(stored.rows).toEqual([]);
    });

    it("queries only the requested bridge when bridgeId is provided", async () => {
      await seedBridge({ id: "br-1", machine_label: "Laptop" });
      await seedBridge({ id: "br-2", machine_label: "Desktop" });
      const bridgeRpcClient = {
        call: vi
          .fn()
          .mockResolvedValueOnce({ targets: [{ targetRef: "serial-1", online: true, label: "ADB serial-1" }] })
          .mockResolvedValueOnce({ targets: [{ targetRef: "serial-2", online: true, label: "ADB serial-2" }] })
      };
      const bridgeConnectionPool = {
        isConnected: vi.fn((bridgeId: string) => bridgeId === "br-1" || bridgeId === "br-2")
      };
      const service = createDebuggingService({
        db,
        gateway: makeGateway({ detectTargets: vi.fn(async () => ({ ok: true, targets: [] })) }),
        bridgeConnectionPool,
        bridgeRpcClient,
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      const targets = await service.detectTargets(readAuth, { bridgeId: "br-1" });

      expect(bridgeRpcClient.call).toHaveBeenCalledTimes(1);
      expect(bridgeRpcClient.call).toHaveBeenCalledWith("br-1", "debug.detectTargets", { protocol: "hdc" }, { timeoutMs: 5000 });
      expect(targets).toEqual([
        expect.objectContaining({
          id: "bridge:br-1:hdc:serial-1",
          bridgeId: "br-1",
          deviceId: "bridge:br-1",
          targetRef: "serial-1"
        })
      ]);
      const stored = await db.query<{ bridge_id: string | null }>(
        `select bridge_id from debugging_targets where id = 'bridge:br-1:hdc:serial-1'`
      );
      expect(stored.rows).toEqual([{ bridge_id: "br-1" }]);
    });

    it("requires an explicit registry for non-default protocols", async () => {
      await seedDevice({ transport: "adb" });
      const service = createDebuggingService({
        db,
        gateway: makeGateway(),
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      await expect(service.detectTargets(readAuth, { deviceId: "device-1", protocol: "adb" })).rejects.toMatchObject({
        code: "PROTOCOL_UNSUPPORTED"
      });
    });
  });

  describe("createSession", () => {
    it("rejects offline or lost targets and persists an active session", async () => {
      await seedDevice();
      await seedTarget({ status: "lost" });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.createSession(readAuth, { deviceId: "device-1", targetId: "target-1" })).rejects.toMatchObject(
        new ApiError("DEVICE_UNAVAILABLE", "Debug target is not detected.")
      );

      await db.query(`update debugging_targets set status = 'detected' where id = 'target-1'`);
      await db.query(`update debugging_devices set status = 'offline' where id = 'device-1'`);
      await expect(service.createSession(readAuth, { deviceId: "device-1", targetId: "target-1" })).rejects.toMatchObject(
        new ApiError("DEVICE_UNAVAILABLE", "Debug device is offline.")
      );

      await db.query(`update debugging_devices set status = 'online' where id = 'device-1'`);
      const audit = createAuditSpy();
      const auditedService = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });
      const session = await auditedService.createSession(readAuth, { deviceId: "device-1", targetId: "target-1" });

      expect(session).toMatchObject({ deviceId: "device-1", targetId: "target-1", status: "active" });
      await expect(auditedService.getSession(readAuth, { sessionId: session.id })).resolves.toMatchObject({
        id: session.id,
        status: "active"
      });
      expect(audit.events[0]).toMatchObject({ kind: "debug-session-create", action: "create", targetId: session.id });
    });

    it("requires bridgeId when the target is bridge-backed and persists bridge execution metadata", async () => {
      const targetId = "bridge:br-1:adb:serial-1";
      await seedDevice({ id: "bridge:br-1", name: "Laptop Bridge", transport: "adb" });
      await seedTarget({
        id: targetId,
        device_id: "bridge:br-1",
        bridge_id: "br-1",
        protocol: "adb",
        target_ref: "serial-1"
      });
      await seedBridge();
      const service = createDebuggingService({
        db,
        gateway: makeGateway(),
        bridgeConnectionPool: { isConnected: vi.fn(() => true) },
        bridgeRpcClient: { call: vi.fn() },
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      await expect(
        service.createSession(readAuth, { deviceId: "bridge:br-1", targetId, protocol: "adb" })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "bridgeId is required for bridge-backed targets."));

      const session = await service.createSession(readAuth, {
        deviceId: "bridge:br-1",
        targetId,
        bridgeId: "br-1",
        protocol: "adb"
      });

      expect(session).toMatchObject({ executionMode: "bridge", bridgeId: "br-1", bridgeMachineLabel: "Laptop" });
      const stored = await db.query<{ execution_mode: string; bridge_id: string | null; bridge_machine_label: string | null }>(
        `select execution_mode, bridge_id, bridge_machine_label from debugging_sessions where id = $1`,
        [session.id]
      );
      expect(stored.rows).toEqual([{ execution_mode: "bridge", bridge_id: "br-1", bridge_machine_label: "Laptop" }]);
    });

    it("rejects mismatched device targets", async () => {
      await seedDevice();
      await seedDevice({ id: "device-2", name: "Other Bench" });
      await seedTarget({ device_id: "device-2" });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.createSession(readAuth, { deviceId: "device-1", targetId: "target-1" })).rejects.toMatchObject(
        new ApiError("VALIDATION_FAILED", "Debug target does not belong to the requested device.")
      );
    });

    it("inserts a session-created debug event", async () => {
      await seedDevice();
      await seedTarget();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      const session = await service.createSession(readAuth, { deviceId: "device-1", targetId: "target-1" });

      const events = await db.query<{ kind: string; severity: string; message: string; metadata: unknown }>(
        `select kind, severity, message, metadata from debugging_events where session_id = $1`,
        [session.id]
      );
      expect(events.rows).toEqual([
        {
          kind: "session-created",
          severity: "info",
          message: "Debug session created.",
          metadata: {
            deviceId: "device-1",
            targetId: "target-1",
            protocol: "hdc",
            executionMode: "server",
            bridgeId: null
          }
        }
      ]);
    });
  });

  describe("readNode", () => {
    it("requires debugging:read, resolves bindings, records operation, writes audit", async () => {
      const { parameter, session } = await seedRuntime();
      const gateway = makeGateway();
      const audit = createAuditSpy();
      const metrics = createDeviceMetricsSpy();
      const { spans, tracing } = createTraceRecorder();
      const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent, metrics, gatewayMode: "simulator", tracing });

      await expect(
        service.readNode(makeAuth(["debugging:view"]), { sessionId: session.id, nodePath: "/sys/current" })
      ).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Missing permission: debugging:read.", { permission: "debugging:read" })
      );

      const operation = await service.readNode(readAuth, {
        sessionId: session.id,
        parameterId: parameter.id,
        nodePath: "/frontend/ignored"
      });

      // The binding's node path wins over whatever the frontend claims.
      expect(gateway.readNode).toHaveBeenCalledWith({ targetRef: "simulator://aurora-1", nodePath: "/sys/current", preserveExactRead: false });
      expect(operation).toMatchObject({ operationType: "read", status: "succeeded", readValue: "3000", verified: true });
      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([
        expect.objectContaining({ operation_type: "read", status: "succeeded", node_path: "/sys/current" })
      ]);
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
      await seedDevice();
      await seedTarget({ protocol: "adb", target_ref: "emulator-5554" });
      const parameter = await seedParameter();
      await seedBinding(parameter.id, { protocol: "adb", nodePath: "/sys/adb/current" });
      const session = await seedSession({ protocol: "adb" });
      const adbGateway = makeGateway();
      const service = createDebuggingService({
        db,
        gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }),
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      await service.readNode(readAuth, {
        sessionId: session.id,
        parameterId: parameter.id,
        nodePath: "/malicious/frontend/path"
      });

      expect(adbGateway.readNode).toHaveBeenCalledWith({ targetRef: "emulator-5554", nodePath: "/sys/adb/current", preserveExactRead: false });
    });

    it("reads bridge-backed sessions through the bridge rpc client", async () => {
      await seedDevice({ id: "bridge:br-1", name: "Laptop Bridge", transport: "adb" });
      await seedTarget({
        id: "bridge:br-1:adb:serial-1",
        device_id: "bridge:br-1",
        bridge_id: "br-1",
        protocol: "adb",
        target_ref: "serial-1"
      });
      const parameter = await seedParameter();
      await seedBinding(parameter.id, { protocol: "adb", nodePath: "/sys/adb/current" });
      const session = await seedSession({
        protocol: "adb",
        executionMode: "bridge",
        bridgeId: "br-1",
        deviceId: "bridge:br-1",
        targetId: "bridge:br-1:adb:serial-1"
      });
      const bridgeRpcClient = {
        call: vi.fn().mockResolvedValue({ ok: true, value: "3000", stdout: "3000", durationMs: 4 })
      };
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, bridgeRpcClient, createAuditEvent: createAuditSpy().createAuditEvent });

      await service.readNode(readAuth, { sessionId: session.id, parameterId: parameter.id });

      expect(bridgeRpcClient.call).toHaveBeenCalledWith(
        "br-1",
        "debug.readNode",
        expect.objectContaining({ targetRef: "serial-1", nodePath: "/sys/adb/current", protocol: "adb" }),
        { timeoutMs: 10000 }
      );
      expect(gateway.readNode).not.toHaveBeenCalled();
    });

    it("reads a parameter through a read-only session protocol binding", async () => {
      await seedDevice();
      await seedTarget({ protocol: "adb", target_ref: "emulator-5554" });
      const parameter = await seedParameter();
      await seedBinding(parameter.id, { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO" });
      const session = await seedSession({ protocol: "adb" });
      const adbGateway = makeGateway();
      const service = createDebuggingService({
        db,
        gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }),
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      const operation = await service.readNode(readAuth, { sessionId: session.id, parameterId: parameter.id });

      expect(adbGateway.readNode).toHaveBeenCalledWith({ targetRef: "emulator-5554", nodePath: "/sys/adb/current", preserveExactRead: false });
      expect(operation).toMatchObject({ operationType: "read", status: "succeeded" });
    });

    it("rejects inactive sessions and WO parameters before gateway call", async () => {
      const { parameter, session } = await seedRuntime({ bindingAccessMode: "WO" });
      await db.query(`update debugging_sessions set status = 'closed' where id = $1`, [session.id]);
      const inactiveGateway = makeGateway();
      const inactiveService = createDebuggingService({ db, gateway: inactiveGateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        inactiveService.readNode(readAuth, { sessionId: session.id, nodePath: "/sys/current" })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Debug session is not active."));
      expect(inactiveGateway.readNode).not.toHaveBeenCalled();

      await db.query(`update debugging_sessions set status = 'active' where id = $1`, [session.id]);
      const writeOnlyGateway = makeGateway();
      const writeOnlyService = createDebuggingService({ db, gateway: writeOnlyGateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        writeOnlyService.readNode(readAuth, { sessionId: session.id, parameterId: parameter.id, nodePath: "/sys/current" })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Parameter is not readable."));
      expect(writeOnlyGateway.readNode).not.toHaveBeenCalled();
    });

    it("rejects archived parameters before gateway call", async () => {
      const { parameter, session } = await seedRuntime();
      await db.query(`update debugging_parameters set archived_at = now() where id = $1`, [parameter.id]);
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.readNode(readAuth, { sessionId: session.id, parameterId: parameter.id })).rejects.toMatchObject(
        new ApiError("VALIDATION_FAILED", "Debug parameter is archived or disabled.")
      );
      expect(gateway.readNode).not.toHaveBeenCalled();
    });

    it("records failed gateway reads as failed operations with audit metadata", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession();
      const audit = createAuditSpy();
      const service = createDebuggingService({
        db,
        gateway: makeGateway({ readNode: vi.fn(async () => ({ ok: false, stderr: "node missing", error: "node missing", durationMs: 12 })) }),
        createAuditEvent: audit.createAuditEvent
      });

      const operation = await service.readNode(readAuth, { sessionId: session.id, nodePath: "/sys/current" });

      expect(operation).toMatchObject({
        operationType: "read",
        status: "failed",
        readValue: null,
        verified: false,
        failureReason: "node missing"
      });
      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([expect.objectContaining({ operation_type: "read", status: "failed" })]);
      expect(audit.events[0]).toMatchObject({
        kind: "debug-node-read",
        severity: "Medium",
        metadata: expect.objectContaining({ operationId: operation.id, failureReason: "node missing" })
      });
    });

    it("treats audit write failure as operation failure and transaction failure", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession();
      const createAuditEvent = vi.fn(async () => {
        throw new Error("audit unavailable");
      });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent });

      await expect(service.readNode(readAuth, { sessionId: session.id, nodePath: "/sys/current" })).rejects.toThrow(
        "audit unavailable"
      );

      // The operation insert rolled back with the transaction.
      await expect(nodeOperationRows(session.id)).resolves.toEqual([]);
    });

    it("rejects a same-organization user operating another user's device session", async () => {
      const { parameter, session } = await seedRuntime();
      const otherUser = makeAuth(
        ["debugging:view", "debugging:read", "debugging:write"],
        [{ roleId: "software-user" }],
        "user-2"
      );

      const readGateway = makeGateway();
      const readService = createDebuggingService({ db, gateway: readGateway, createAuditEvent: createAuditSpy().createAuditEvent });
      await expect(
        readService.readNode(otherUser, { sessionId: session.id, parameterId: parameter.id, nodePath: "/sys/current" })
      ).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Debug session belongs to another user.", { sessionId: session.id })
      );
      expect(readGateway.readNode).not.toHaveBeenCalled();

      const writeGateway = makeGateway();
      const writeService = createDebuggingService({ db, gateway: writeGateway, createAuditEvent: createAuditSpy().createAuditEvent });
      await expect(
        writeService.writeNode(otherUser, { sessionId: session.id, parameterId: parameter.id, value: "3200" })
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(writeGateway.writeNode).not.toHaveBeenCalled();
    });

    it("resolves debug node binding for the active session protocol", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession({ protocol: "hdc" });
      const node = await createDebugNode(db, { organizationId: "org-1", name: "Charge current", module: "Battery" });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: node.id,
        protocol: "hdc",
        nodePath: "/sys/node/hdc/current",
        accessMode: "RW",
        enabled: true
      });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      const operation = await service.readNode(readAuth, { sessionId: session.id, nodeId: node.id });

      expect(gateway.readNode).toHaveBeenCalledWith({
        targetRef: "simulator://aurora-1",
        nodePath: "/sys/node/hdc/current",
        preserveExactRead: false
      });
      expect(operation).toMatchObject({ operationType: "read", status: "succeeded", nodePath: "/sys/node/hdc/current" });
      // The operation row carries the node id, not a parameter id.
      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([expect.objectContaining({ parameter_id: null, node_id: node.id })]);
    });

    it("rejects DEBUG_BINDING_NOT_CONFIGURED when the node has no binding for the session protocol", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession({ protocol: "hdc" });
      const node = await createDebugNode(db, { organizationId: "org-1", name: "Charge current" });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(service.readNode(readAuth, { sessionId: session.id, nodeId: node.id })).rejects.toMatchObject(
        new ApiError("DEBUG_BINDING_NOT_CONFIGURED", "Debug node is not configured for the selected protocol.", {
          nodeId: node.id,
          protocol: "hdc"
        })
      );
      expect(gateway.readNode).not.toHaveBeenCalled();
    });

    // #416 regression: parameterId reads used to insert node_id = parameterId,
    // whose FK targets debug_nodes — a 500 for any parameter created through
    // the live admin surface (which never writes a same-id mirror row).
    it("reads a parameterId-addressed admin-created parameter without a debug_nodes mirror row", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession();
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });
      const created = await seedAdminParameter(service);

      const operation = await service.readNode(readAuth, { sessionId: session.id, parameterId: created.id });

      expect(operation).toMatchObject({
        operationType: "read",
        status: "succeeded",
        parameterId: created.id,
        readValue: "3000"
      });
      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([
        expect.objectContaining({ parameter_id: created.id, node_id: null, operation_type: "read", status: "succeeded" })
      ]);
      expect(audit.events.filter((event) => event.kind === "debug-node-read")).toHaveLength(1);
    });

    it("links a parameterId operation to the debug node bound to the same protocol path when one exists", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });
      const created = await seedAdminParameter(service, { nodePath: "/sys/linked/current" });
      const node = await createDebugNode(db, { organizationId: "org-1", name: "Linked node", module: "Battery" });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: node.id,
        protocol: "hdc",
        nodePath: "/sys/linked/current",
        accessMode: "RW",
        enabled: true
      });

      await service.readNode(readAuth, { sessionId: session.id, parameterId: created.id });

      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([expect.objectContaining({ parameter_id: created.id, node_id: node.id })]);
    });
  });

  describe("writeNode", () => {
    it("requires debugging:write and rejects inactive sessions before gateway call", async () => {
      const permissionGateway = makeGateway();
      const permissionService = createDebuggingService({ db, gateway: permissionGateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        permissionService.writeNode(readAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })
      ).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Missing permission: debugging:write.", { permission: "debugging:write" })
      );
      expect(permissionGateway.writeNode).not.toHaveBeenCalled();

      const { parameter, session } = await seedRuntime();
      await db.query(`update debugging_sessions set status = 'closed' where id = $1`, [session.id]);
      const inactiveGateway = makeGateway();
      const inactiveService = createDebuggingService({ db, gateway: inactiveGateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        inactiveService.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Debug session is not active."));
      expect(inactiveGateway.writeNode).not.toHaveBeenCalled();
    });

    it("rejects RO parameters before gateway call", async () => {
      const { parameter, session } = await seedRuntime({ bindingAccessMode: "RO" });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Parameter is read-only."));
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("rejects disabled parameters before gateway call", async () => {
      const { parameter, session } = await seedRuntime({ parameter: { enabled: false } });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Debug parameter is archived or disabled."));
      expect(gateway.readNode).not.toHaveBeenCalled();
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("rejects numeric values outside minValue/maxValue", async () => {
      const { parameter, session } = await seedRuntime();
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "6000" })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Value is outside the allowed range."));
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("rejects non-numeric values when a parameter has a numeric range", async () => {
      const { parameter, session } = await seedRuntime();
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "not-a-number" })
      ).rejects.toMatchObject(
        new ApiError("VALIDATION_FAILED", "Value must be numeric for ranged parameters.", { minValue: 0, maxValue: 5000 })
      );
      expect(gateway.readNode).not.toHaveBeenCalled();
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("rejects High-risk parameters without confirmation token or approval", async () => {
      const { parameter, session } = await seedRuntime({ parameter: { risk: "High" } });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "High-risk write requires confirmation or approval."));
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("accepts standalone High-risk writes with the confirmation token and no approval id", async () => {
      const { parameter, session } = await seedRuntime({ parameter: { risk: "High" } });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      const operation = await service.writeNode(writeAuth, {
        sessionId: session.id,
        parameterId: parameter.id,
        value: "3200",
        confirmationToken: "confirm-high-risk-write"
      });

      expect(operation).toMatchObject({ status: "succeeded", approvalId: null });
      expect(gateway.writeNode).toHaveBeenCalledOnce();
    });

    it("rejects an arbitrary approvalId string that is not an approved matching agent_approvals row", async () => {
      const { parameter, session } = await seedRuntime({ parameter: { risk: "High" } });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.writeNode(writeAuth, {
          sessionId: session.id,
          parameterId: parameter.id,
          value: "3200",
          approvalId: "not-a-real-approval"
        })
      ).rejects.toMatchObject(
        new ApiError("VALIDATION_FAILED", "Device write approval is not valid for this write.", {
          approvalId: "not-a-real-approval",
          reason: "not-found"
        })
      );
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("rejects pending, rejected, wrong-tool, and payload-mismatched device-write approvals", async () => {
      const { parameter, session } = await seedRuntime({ parameter: { risk: "High" } });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });
      const matchingPayload = { sessionId: session.id, parameterId: parameter.id, value: "3200" };

      const pending = await seedAgentDeviceApproval({ status: "pending", payload: matchingPayload });
      await expect(
        service.writeNode(writeAuth, {
          sessionId: session.id,
          parameterId: parameter.id,
          value: "3200",
          approvalId: pending.approvalId
        })
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "not-approved" } });

      const rejected = await seedAgentDeviceApproval({ status: "rejected", payload: matchingPayload });
      await expect(
        service.writeNode(writeAuth, {
          sessionId: session.id,
          parameterId: parameter.id,
          value: "3200",
          approvalId: rejected.approvalId
        })
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "not-approved" } });

      const wrongTool = await seedAgentDeviceApproval({
        toolName: "action.submitParameterChange",
        payload: matchingPayload
      });
      await expect(
        service.writeNode(writeAuth, {
          sessionId: session.id,
          parameterId: parameter.id,
          value: "3200",
          approvalId: wrongTool.approvalId
        })
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "tool-mismatch" } });

      const wrongValue = await seedAgentDeviceApproval({
        payload: { sessionId: session.id, parameterId: parameter.id, value: "9999" }
      });
      await expect(
        service.writeNode(writeAuth, {
          sessionId: session.id,
          parameterId: parameter.id,
          value: "3200",
          approvalId: wrongValue.approvalId
        })
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "write-mismatch" } });

      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("accepts a High-risk write when approvalId is an approved agent_approvals row matching this write", async () => {
      const { parameter, session } = await seedRuntime({ parameter: { risk: "High" } });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });
      const { approvalId } = await seedAgentDeviceApproval({
        payload: { sessionId: session.id, parameterId: parameter.id, value: "3200" }
      });

      const operation = await service.writeNode(writeAuth, {
        sessionId: session.id,
        parameterId: parameter.id,
        value: "3200",
        approvalId
      });

      expect(operation).toMatchObject({ status: "succeeded", approvalId });
      expect(gateway.writeNode).toHaveBeenCalledOnce();
    });

    it("writes an org-scoped writable parameter through the active session binding", async () => {
      await seedDevice();
      await seedTarget({ protocol: "adb", target_ref: "emulator-5554" });
      const parameter = await seedParameter({ risk: "Medium" });
      await seedBinding(parameter.id, { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RW" });
      const session = await seedSession({ protocol: "adb" });
      const audit = createAuditSpy();
      const service = createDebuggingService({
        db,
        gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: makeGateway() }),
        createAuditEvent: audit.createAuditEvent
      });

      await service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" });

      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([
        expect.objectContaining({
          session_id: session.id,
          operation_type: "write",
          status: "succeeded",
          node_path: "/sys/adb/current"
        })
      ]);
      expect(audit.events.at(-1)).toMatchObject({ targetId: parameter.id });
    });

    it("writes bridge-backed sessions through the bridge rpc client", async () => {
      await seedDevice({ id: "bridge:br-1", name: "Laptop Bridge", transport: "adb" });
      await seedTarget({
        id: "bridge:br-1:adb:serial-1",
        device_id: "bridge:br-1",
        bridge_id: "br-1",
        protocol: "adb",
        target_ref: "serial-1"
      });
      const parameter = await seedParameter({ minValue: null, maxValue: null });
      await seedBinding(parameter.id, { protocol: "adb", nodePath: "/sys/adb/current" });
      const session = await seedSession({
        protocol: "adb",
        executionMode: "bridge",
        bridgeId: "br-1",
        deviceId: "bridge:br-1",
        targetId: "bridge:br-1:adb:serial-1"
      });
      const bridgeRpcClient = {
        call: vi
          .fn()
          .mockResolvedValueOnce({ ok: true, value: "3000", stdout: "3000", durationMs: 4 })
          .mockResolvedValueOnce({
            ok: true,
            verified: true,
            value: "3200",
            writeResult: { ok: true, value: "3200", durationMs: 5 },
            readResult: { ok: true, value: "3200", stdout: "3200", durationMs: 6 }
          })
      };
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, bridgeRpcClient, createAuditEvent: createAuditSpy().createAuditEvent });

      const operation = await service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" });

      expect(bridgeRpcClient.call).toHaveBeenNthCalledWith(
        1,
        "br-1",
        "debug.readNode",
        expect.objectContaining({ targetRef: "serial-1", nodePath: "/sys/adb/current", protocol: "adb" }),
        { timeoutMs: 10000 }
      );
      expect(bridgeRpcClient.call).toHaveBeenNthCalledWith(
        2,
        "br-1",
        "debug.writeNode",
        expect.objectContaining({ targetRef: "serial-1", nodePath: "/sys/adb/current", value: "3200", protocol: "adb" }),
        { timeoutMs: 10000 }
      );
      expect(operation).toMatchObject({ status: "succeeded", verified: true });
      expect(gateway.readNode).not.toHaveBeenCalled();
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("rejects writes when the session protocol binding is missing", async () => {
      await seedDevice();
      await seedTarget({ protocol: "adb", target_ref: "emulator-5554" });
      const parameter = await seedParameter();
      const session = await seedSession({ protocol: "adb" });
      const gateway = makeGateway();
      const service = createDebuggingService({
        db,
        gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: gateway }),
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" })
      ).rejects.toMatchObject({ code: "DEBUG_BINDING_NOT_CONFIGURED" });
      expect(gateway.readNode).not.toHaveBeenCalled();
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("rejects writes when the session protocol binding is disabled", async () => {
      await seedDevice();
      await seedTarget({ protocol: "adb", target_ref: "emulator-5554" });
      const parameter = await seedParameter();
      await seedBinding(parameter.id, { protocol: "adb", nodePath: "/sys/adb/current", enabled: false });
      const session = await seedSession({ protocol: "adb" });
      const gateway = makeGateway();
      const service = createDebuggingService({
        db,
        gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: gateway }),
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" })
      ).rejects.toMatchObject({ code: "DEBUG_BINDING_DISABLED" });
      expect(gateway.readNode).not.toHaveBeenCalled();
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("creates a pre-write snapshot with the previous value before calling the gateway", async () => {
      const { parameter, session } = await seedRuntime();
      const snapshotsSeenAtRead: number[] = [];
      const snapshotsSeenAtWrite: Array<{ status: string; entries: unknown }> = [];
      const gateway = makeGateway({
        readNode: vi.fn(async () => {
          const rows = await snapshotRows();
          snapshotsSeenAtRead.push(rows.length);
          return { ok: true, value: "3000", stdout: "3000", durationMs: 5 };
        }),
        writeNode: vi.fn(async () => {
          snapshotsSeenAtWrite.push(...(await snapshotRows()));
          return {
            ok: true,
            value: "3200",
            verified: true,
            writeResult: { ok: true, value: "3200", stdout: "3200", durationMs: 7 },
            readResult: { ok: true, value: "3200", stdout: "3200", durationMs: 8 }
          };
        })
      });
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      const operation = await service.writeNode(
        writeAuth,
        { sessionId: session.id, parameterId: parameter.id, value: "3200" },
        { requestId: "request-debug-write-1" }
      );

      // No snapshot exists at pre-read time; exactly one valid snapshot exists by write time.
      expect(snapshotsSeenAtRead).toEqual([0]);
      expect(snapshotsSeenAtWrite).toEqual([
        expect.objectContaining({
          status: "valid",
          entries: [
            expect.objectContaining({
              parameterId: parameter.id,
              protocol: "hdc",
              nodePath: "/sys/current",
              previousValue: "3000",
              targetValue: "3200",
              valueKind: "scalar",
              valueFormat: "raw",
              normalizationMode: "trim",
              previousDigest: expect.any(String),
              targetDigest: expect.any(String)
            })
          ]
        })
      ]);
      expect(operation).toMatchObject({ status: "succeeded", previousValue: "3000", snapshotId: expect.any(String) });
    });

    it("rejects a device lease held by another active session before gateway calls", async () => {
      const { parameter, session } = await seedRuntime();
      const rivalSession = await seedSession();
      const lease = await acquireDebugDeviceLease(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        sessionId: rivalSession.id,
        actorUserId: "user-1",
        leaseTtlMs: 60_000
      });
      expect(lease?.sessionId).toBe(rivalSession.id);
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" })
      ).rejects.toMatchObject(new ApiError("CONFLICT", "Debug device is leased by another active session."));

      expect(gateway.readNode).not.toHaveBeenCalled();
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("stores readback_mismatch when gateway verified=false", async () => {
      const { parameter, session } = await seedRuntime();
      const gatewayResult: GatewayWriteResult = {
        ok: true,
        value: "3200",
        verified: false,
        error: "Readback mismatch.",
        writeResult: { ok: true, value: "3200", stdout: "3200", durationMs: 7 },
        readResult: { ok: true, value: "3100", stdout: "3100", durationMs: 8 }
      };
      const service = createDebuggingService({
        db,
        gateway: makeGateway({ writeNode: vi.fn(async () => gatewayResult) }),
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      const operation = await service.writeNode(
        writeAuth,
        { sessionId: session.id, parameterId: parameter.id, value: "3200" },
        { requestId: "request-debug-write-1" }
      );

      expect(operation).toMatchObject({
        operationType: "write",
        status: "readback_mismatch",
        readbackValue: "3100",
        verified: false,
        failureReason: "Readback mismatch."
      });
      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([expect.objectContaining({ status: "readback_mismatch" })]);
    });

    it("stores failed status when gateway write fails", async () => {
      const { parameter, session } = await seedRuntime();
      const gatewayResult: GatewayWriteResult = {
        ok: false,
        verified: false,
        error: "Write failed.",
        writeResult: { ok: false, stderr: "permission denied", error: "permission denied", durationMs: 7 }
      };
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

      const operation = await service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" });

      expect(operation).toMatchObject({
        operationType: "write",
        status: "failed",
        readbackValue: null,
        verified: false,
        failureReason: "Write failed."
      });
      expect(metrics.recordDeviceGatewayOperation).toHaveBeenCalledWith({ mode: "hdc", action: "read", status: "succeeded" });
      expect(metrics.recordDeviceGatewayOperation).toHaveBeenCalledWith({ mode: "hdc", action: "write", status: "failed" });
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

    it("updates parameter current and target values after a verified write", async () => {
      const { parameter, session } = await seedRuntime();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" });

      const stored = await db.query<{ current_value: string; target_value: string }>(
        `select current_value, target_value from debugging_parameters where id = $1`,
        [parameter.id]
      );
      expect(stored.rows).toEqual([{ current_value: "3200", target_value: "3200" }]);
    });

    it("writes audit metadata for successful writes", async () => {
      const { parameter, session } = await seedRuntime();
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

      const operation = await service.writeNode(
        writeAuth,
        { sessionId: session.id, parameterId: parameter.id, value: "3200" },
        { requestId: "request-debug-write-1" }
      );

      expect(audit.events[0]).toMatchObject({
        kind: "debug-node-write",
        action: "write",
        severity: "Medium",
        targetType: "debug-node",
        targetId: parameter.id,
        metadata: expect.objectContaining({
          sessionId: session.id,
          operationId: operation.id,
          nodePath: "/sys/current",
          digest: expect.any(String),
          preview: "3200",
          bytes: 4,
          verified: true,
          snapshotId: expect.any(String)
        })
      });
      expect(audit.events[0].metadata).not.toHaveProperty("requestedValue");
      expect(audit.events[0].traceId).toBe("request-debug-write-1");
    });

    it("treats audit write failure as operation failure and transaction failure", async () => {
      const { parameter, session } = await seedRuntime();
      const createAuditEvent = vi.fn(async () => {
        throw new Error("audit unavailable");
      });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" })
      ).rejects.toThrow("audit unavailable");

      // The operation, snapshot, and value update all rolled back together.
      await expect(nodeOperationRows(session.id)).resolves.toEqual([]);
      await expect(snapshotRows()).resolves.toEqual([]);
      const stored = await db.query<{ current_value: string }>(
        `select current_value from debugging_parameters where id = $1`,
        [parameter.id]
      );
      expect(stored.rows).toEqual([{ current_value: "3000" }]);
    });

    it("rejects invalid JSON for complex json-format parameters", async () => {
      const { parameter, session } = await seedRuntime({
        parameter: { valueKind: "complex", valueFormat: "json", key: "complex_config", nodePath: "/sys/complex" }
      });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "{not-json" })
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400, message: expect.stringContaining("valid JSON") });
      expect(gateway.readNode).not.toHaveBeenCalled();
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("succeeds for complex JSON with metadata-aware readback comparison", async () => {
      const jsonValue = '{"enabled":true,"limit":42}';
      const { parameter, session } = await seedRuntime({
        parameter: {
          valueKind: "complex",
          valueFormat: "json",
          normalizationMode: "json-canonical",
          minValue: null,
          maxValue: null,
          key: "complex_config",
          nodePath: "/sys/complex"
        }
      });
      const gateway = makeGateway({
        readNode: vi.fn(async () => ({ ok: true, value: '{"limit":42,"enabled":true}', stdout: '{"limit":42,"enabled":true}', durationMs: 5 })),
        writeNode: vi.fn(async () => ({
          ok: true,
          value: jsonValue,
          verified: true,
          writeResult: { ok: true, value: jsonValue, durationMs: 7 },
          readResult: { ok: true, value: '{"limit":42,"enabled":true}', stdout: '{"limit":42,"enabled":true}', durationMs: 8 }
        }))
      });
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent });

      const operation = await service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: jsonValue });

      expect(gateway.writeNode).toHaveBeenCalledWith(
        expect.objectContaining({
          value: jsonValue,
          preserveExactRead: false,
          compareReadback: expect.any(Function)
        })
      );
      expect(operation).toMatchObject({ status: "succeeded", verified: true, valueKind: "complex", valueFormat: "json" });
      const stored = await db.query<{ current_value: string }>(
        `select current_value from debugging_parameters where id = $1`,
        [parameter.id]
      );
      expect(stored.rows).toEqual([{ current_value: jsonValue }]);
      expect(audit.events[0].metadata).toMatchObject({
        valueKind: "complex",
        valueFormat: "json",
        digest: expect.any(String),
        preview: jsonValue
      });
    });

    it("stores readback_mismatch for complex values after normalization-aware comparison", async () => {
      const jsonValue = '{"enabled":true}';
      const { parameter, session } = await seedRuntime({
        parameter: {
          valueKind: "complex",
          valueFormat: "json",
          normalizationMode: "json-canonical",
          minValue: null,
          maxValue: null,
          key: "complex_config",
          nodePath: "/sys/complex"
        }
      });
      const gatewayResult: GatewayWriteResult = {
        ok: true,
        value: jsonValue,
        verified: false,
        error: "Read-back mismatch after HDC write.",
        writeResult: { ok: true, value: jsonValue, durationMs: 7 },
        readResult: { ok: true, value: '{"enabled":false}', stdout: '{"enabled":false}', durationMs: 8 }
      };
      const service = createDebuggingService({
        db,
        gateway: makeGateway({ writeNode: vi.fn(async () => gatewayResult) }),
        createAuditEvent: createAuditSpy().createAuditEvent
      });

      const operation = await service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: jsonValue });

      expect(operation).toMatchObject({ status: "readback_mismatch", verified: false, valueKind: "complex" });
    });

    it("audit metadata uses digest and preview instead of full raw payload for large complex values", async () => {
      const largeValue = `{"payload":"${"x".repeat(300)}"}`;
      const { parameter, session } = await seedRuntime({
        parameter: { valueKind: "complex", valueFormat: "json", minValue: null, maxValue: null, key: "complex_config", nodePath: "/sys/complex" }
      });
      const gateway = makeGateway({
        readNode: vi.fn(async () => ({ ok: true, value: "{}", stdout: "{}", durationMs: 5 })),
        writeNode: vi.fn(async () => ({
          ok: true,
          value: largeValue,
          verified: true,
          writeResult: { ok: true, value: largeValue, durationMs: 7 },
          readResult: { ok: true, value: largeValue, stdout: largeValue, durationMs: 8 }
        }))
      });
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent });

      await service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: largeValue });

      expect(JSON.stringify(audit.events[0].metadata)).not.toContain(largeValue);
      expect(audit.events[0].metadata).toMatchObject({
        digest: expect.any(String),
        preview: expect.stringMatching(/…$/),
        bytes: expect.any(Number)
      });
    });

    it("uses the debug node binding path for the active session protocol", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession({ protocol: "hdc" });
      const node = await createDebugNode(db, { organizationId: "org-1", name: "Charge current" });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: node.id,
        protocol: "hdc",
        nodePath: "/sys/node/hdc/write",
        accessMode: "RW",
        enabled: true
      });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      const operation = await service.writeNode(writeAuth, { sessionId: session.id, nodeId: node.id, value: "3200" });

      expect(gateway.readNode).toHaveBeenCalledWith({
        targetRef: "simulator://aurora-1",
        nodePath: "/sys/node/hdc/write",
        preserveExactRead: false
      });
      expect(gateway.writeNode).toHaveBeenCalledWith(
        expect.objectContaining({ targetRef: "simulator://aurora-1", nodePath: "/sys/node/hdc/write", value: "3200" })
      );
      expect(operation).toMatchObject({ operationType: "write", status: "succeeded", nodePath: "/sys/node/hdc/write" });
      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([expect.objectContaining({ parameter_id: null, node_id: node.id })]);
    });

    // #416 regression, severe half: the operation insert runs after the
    // physical device write, so an FK fault there rolled back the snapshot,
    // operation, and audit rows of a write that already mutated the device.
    it("keeps operation, snapshot, and audit evidence for a parameterId write without a debug_nodes mirror row", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession();
      const audit = createAuditSpy();
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });
      const created = await seedAdminParameter(service);

      const operation = await service.writeNode(
        writeAuth,
        { sessionId: session.id, parameterId: created.id, value: "3200" },
        { requestId: "request-debug-write-416" }
      );

      expect(operation).toMatchObject({
        operationType: "write",
        status: "succeeded",
        parameterId: created.id,
        snapshotId: expect.any(String)
      });
      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([
        expect.objectContaining({ parameter_id: created.id, node_id: null, operation_type: "write", status: "succeeded" })
      ]);
      const snapshots = await snapshotRows();
      expect(snapshots).toEqual([expect.objectContaining({ id: operation.snapshotId, status: "valid" })]);
      expect(audit.events.filter((event) => event.kind === "debug-node-write")).toEqual([
        expect.objectContaining({
          targetId: created.id,
          metadata: expect.objectContaining({ operationId: operation.id, snapshotId: operation.snapshotId })
        })
      ]);
    });

    // #420: snapshot entries record identity honestly. A nodeId-mode write
    // must not smuggle the debug_nodes id through the parameterId key —
    // rollback used to bind that value into node_operations.parameter_id and
    // FK-fault after the physical write-back.
    it("records self-describing snapshot-entry identity for nodeId-mode and parameterId-mode writes", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession();
      const node = await createDebugNode(db, { organizationId: "org-1", name: "Charge current" });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: node.id,
        protocol: "hdc",
        nodePath: "/sys/node/hdc/write",
        accessMode: "RW",
        enabled: true
      });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });
      const parameter = await seedAdminParameter(service);
      // A node-catalog binding covering the parameter's protocol + path, so
      // the parameterId-mode write resolves its node identity (#419).
      const coveringNode = await createDebugNode(db, { organizationId: "org-1", name: "Covering node" });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: coveringNode.id,
        protocol: "hdc",
        nodePath: "/sys/current",
        accessMode: "RW",
        enabled: true
      });

      const nodeWrite = await service.writeNode(writeAuth, { sessionId: session.id, nodeId: node.id, value: "3200" });
      const parameterWrite = await service.writeNode(writeAuth, { sessionId: session.id, parameterId: parameter.id, value: "3200" });

      const entriesOf = async (snapshotId: string) => {
        const rows = await db.query<{ entries: Array<Record<string, unknown>> }>(
          `select entries from debugging_snapshots where id = $1`,
          [snapshotId]
        );
        return rows.rows[0].entries;
      };
      const nodeEntries = await entriesOf(nodeWrite.snapshotId as string);
      expect(nodeEntries).toEqual([expect.objectContaining({ nodeId: node.id, nodePath: "/sys/node/hdc/write" })]);
      expect(nodeEntries[0]).not.toHaveProperty("parameterId");
      const parameterEntries = await entriesOf(parameterWrite.snapshotId as string);
      expect(parameterEntries).toEqual([
        expect.objectContaining({ parameterId: parameter.id, nodeId: coveringNode.id, nodePath: "/sys/current" })
      ]);
    });
  });

  describe("rollbackSnapshot", () => {
    async function seedRollbackReady(entries?: Array<Record<string, unknown>>) {
      const { parameter, session } = await seedRuntime();
      const snapshot = await createDebugSnapshot(db, {
        organizationId: "org-1",
        sessionId: session.id,
        risk: "Medium",
        entries: (entries ?? [
          { parameterId: parameter.id, nodePath: "/sys/current", previousValue: "3000", targetValue: "3200" }
        ]) as never,
        createdByUserId: "user-1"
      });
      return { parameter, session, snapshot };
    }

    it("requires debugging:rollback and confirmation token before gateway call", async () => {
      const permissionGateway = makeGateway();
      const permissionService = createDebuggingService({ db, gateway: permissionGateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        permissionService.rollbackSnapshot(writeAuth, { snapshotId: "snapshot-1", confirmationToken: "confirm-rollback" })
      ).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Missing permission: debugging:rollback.", { permission: "debugging:rollback" })
      );
      expect(permissionGateway.writeNode).not.toHaveBeenCalled();

      const tokenGateway = makeGateway();
      const tokenService = createDebuggingService({ db, gateway: tokenGateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        tokenService.rollbackSnapshot(rollbackAuth, { snapshotId: "snapshot-1", confirmationToken: "wrong-token" })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Rollback confirmation is required."));
      expect(tokenGateway.writeNode).not.toHaveBeenCalled();
    });

    it("rejects an arbitrary rollback approvalId that is not an approved matching agent_approvals row", async () => {
      const { snapshot } = await seedRollbackReady();
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.rollbackSnapshot(rollbackAuth, { snapshotId: snapshot.id, approvalId: "not-a-real-approval" })
      ).rejects.toMatchObject(
        new ApiError("VALIDATION_FAILED", "Device rollback approval is not valid for this snapshot.", {
          approvalId: "not-a-real-approval",
          reason: "not-found"
        })
      );
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("accepts rollback when approvalId is an approved agent_approvals row matching this snapshot", async () => {
      const { snapshot } = await seedRollbackReady();
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });
      const { approvalId } = await seedAgentDeviceApproval({
        toolName: "action.rollbackDebugSnapshot",
        payload: { snapshotId: snapshot.id }
      });

      const result = await service.rollbackSnapshot(rollbackAuth, { snapshotId: snapshot.id, approvalId });

      expect(result.snapshot).toMatchObject({ id: snapshot.id, status: "consumed" });
      expect(result.operations[0]).toMatchObject({ operationType: "rollback", approvalId });
      expect(gateway.writeNode).toHaveBeenCalled();
    });

    it("rejects missing, consumed, and rollback-pending snapshots", async () => {
      // (The old fake also staged a snapshot whose session_id differed from the row the
      // session lookup returned — a state a real database cannot produce, since the
      // session is loaded by the snapshot's own session id. That defensive branch is
      // covered by the not-valid check below.)
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.rollbackSnapshot(rollbackAuth, { snapshotId: "missing-snapshot", confirmationToken: "confirm-rollback" })
      ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Snapshot was not found."));

      const { snapshot } = await seedRollbackReady();
      for (const status of ["consumed", "rollback_pending"]) {
        await db.query(`update debugging_snapshots set status = $1 where id = $2`, [status, snapshot.id]);
        await expect(
          service.rollbackSnapshot(rollbackAuth, { snapshotId: snapshot.id, confirmationToken: "confirm-rollback" })
        ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Snapshot is not valid for this session."));
      }
    });

    it("rejects a device lease held by another active session before gateway writes", async () => {
      const { snapshot } = await seedRollbackReady();
      const rivalSession = await seedSession();
      await acquireDebugDeviceLease(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        sessionId: rivalSession.id,
        actorUserId: "user-1",
        leaseTtlMs: 60_000
      });
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await expect(
        service.rollbackSnapshot(rollbackAuth, { snapshotId: snapshot.id, confirmationToken: "confirm-rollback" })
      ).rejects.toMatchObject(new ApiError("CONFLICT", "Debug device is leased by another active session."));

      expect(gateway.writeNode).not.toHaveBeenCalled();
      // The failed transaction rolled the claim back: the snapshot is still valid.
      const stored = await db.query<{ status: string }>(`select status from debugging_snapshots where id = $1`, [snapshot.id]);
      expect(stored.rows).toEqual([{ status: "valid" }]);
    });

    it("keeps the snapshot valid and inserts a failed event on partial failure", async () => {
      const { parameter, session } = await seedRuntime();
      const voltage = await seedParameter({ key: "voltage", name: "Voltage", nodePath: "/sys/voltage" });
      const snapshot = await createDebugSnapshot(db, {
        organizationId: "org-1",
        sessionId: session.id,
        risk: "Medium",
        entries: [
          { parameterId: parameter.id, nodePath: "/sys/current", previousValue: "3000", targetValue: "3200" },
          { parameterId: voltage.id, nodePath: "/sys/voltage", previousValue: "12", targetValue: "14" }
        ] as never,
        createdByUserId: "user-1"
      });
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
        snapshotId: snapshot.id,
        confirmationToken: "confirm-rollback"
      });

      expect(result.snapshot).toMatchObject({ id: snapshot.id, status: "valid" });
      expect(result.operations).toEqual([
        expect.objectContaining({ status: "succeeded", requestedValue: "3000" }),
        expect.objectContaining({ status: "failed", requestedValue: "12" })
      ]);
      // The snapshot survives for a retry, and the failure event is durable.
      const stored = await db.query<{ status: string }>(`select status from debugging_snapshots where id = $1`, [snapshot.id]);
      expect(stored.rows).toEqual([{ status: "valid" }]);
      const events = await db.query<{ kind: string; severity: string; message: string; metadata: { snapshotId?: string } }>(
        `select kind, severity, message, metadata from debugging_events where session_id = $1 and kind like 'rollback%'`,
        [session.id]
      );
      expect(events.rows).toEqual([
        expect.objectContaining({
          kind: "rollback-failed",
          severity: "error",
          message: "Snapshot rollback failed.",
          metadata: expect.objectContaining({ snapshotId: snapshot.id })
        })
      ]);
    });

    it("writes previous values, records rollback operations, marks snapshot consumed", async () => {
      const { session, snapshot } = await seedRollbackReady();
      const statusSeenAtWrite: string[] = [];
      const gateway = makeGateway({
        writeNode: vi.fn(async () => {
          // The snapshot must be claimed (rollback_pending) before any gateway write.
          const rows = await db.query<{ status: string }>(`select status from debugging_snapshots where id = $1`, [snapshot.id]);
          statusSeenAtWrite.push(rows.rows[0].status);
          return {
            ok: true,
            value: "3000",
            verified: true,
            writeResult: { ok: true, value: "3000", stdout: "3000", durationMs: 7 },
            readResult: { ok: true, value: "3000", stdout: "3000", durationMs: 8 }
          };
        })
      });
      const audit = createAuditSpy();
      const metrics = createDeviceMetricsSpy();
      const { spans, tracing } = createTraceRecorder();
      const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent, metrics, gatewayMode: "simulator", tracing });

      const result = await service.rollbackSnapshot(rollbackAuth, {
        snapshotId: snapshot.id,
        confirmationToken: "confirm-rollback"
      });

      expect(gateway.writeNode).toHaveBeenCalledWith(
        expect.objectContaining({
          targetRef: "simulator://aurora-1",
          nodePath: "/sys/current",
          value: "3000",
          readBack: true,
          preserveExactRead: false,
          compareReadback: expect.any(Function)
        })
      );
      expect(statusSeenAtWrite).toEqual(["rollback_pending"]);
      expect(result.operations).toEqual([
        expect.objectContaining({ operationType: "rollback", status: "succeeded", requestedValue: "3000" })
      ]);
      expect(result.snapshot).toEqual(expect.objectContaining({ id: snapshot.id, status: "consumed" }));
      const storedOperations = await nodeOperationRows(session.id);
      expect(storedOperations).toEqual([expect.objectContaining({ operation_type: "rollback", status: "succeeded" })]);
      const storedSnapshot = await db.query<{ status: string }>(`select status from debugging_snapshots where id = $1`, [snapshot.id]);
      expect(storedSnapshot.rows).toEqual([{ status: "consumed" }]);
      expect(audit.events[0]).toMatchObject({
        kind: "debug-snapshot-rollback",
        action: "rollback",
        targetId: snapshot.id,
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

    it("routes bridge-backed sessions through the bridge rpc client", async () => {
      await seedDevice({ id: "bridge:br-1", name: "Laptop Bridge", transport: "adb" });
      await seedTarget({
        id: "bridge:br-1:adb:serial-1",
        device_id: "bridge:br-1",
        bridge_id: "br-1",
        protocol: "adb",
        target_ref: "serial-1"
      });
      const parameter = await seedParameter();
      const session = await seedSession({
        protocol: "adb",
        executionMode: "bridge",
        bridgeId: "br-1",
        deviceId: "bridge:br-1",
        targetId: "bridge:br-1:adb:serial-1"
      });
      const snapshot = await createDebugSnapshot(db, {
        organizationId: "org-1",
        sessionId: session.id,
        risk: "Medium",
        entries: [
          {
            parameterId: parameter.id,
            protocol: "adb",
            nodePath: "/sys/adb/current",
            previousValue: "3000",
            targetValue: "3200"
          }
        ] as never,
        createdByUserId: "user-1"
      });
      const bridgeRpcClient = {
        call: vi.fn().mockResolvedValue({
          ok: true,
          verified: true,
          value: "3000",
          writeResult: { ok: true, value: "3000", durationMs: 3 },
          readResult: { ok: true, value: "3000", stdout: "3000", durationMs: 4 }
        })
      };
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, bridgeRpcClient, createAuditEvent: createAuditSpy().createAuditEvent });

      await service.rollbackSnapshot(rollbackAuth, { snapshotId: snapshot.id, confirmationToken: "confirm-rollback" });

      expect(bridgeRpcClient.call).toHaveBeenCalledWith(
        "br-1",
        "debug.writeNode",
        expect.objectContaining({ targetRef: "serial-1", nodePath: "/sys/adb/current", value: "3000", protocol: "adb" }),
        { timeoutMs: 10000 }
      );
      expect(gateway.writeNode).not.toHaveBeenCalled();
    });

    it("inserts a succeeded event after successful rollback", async () => {
      const { session, snapshot } = await seedRollbackReady();
      const gateway = makeGateway({
        writeNode: vi.fn(async () => ({
          ok: true,
          value: "3000",
          verified: true,
          writeResult: { ok: true, value: "3000", stdout: "3000", durationMs: 7 },
          readResult: { ok: true, value: "3000", stdout: "3000", durationMs: 8 }
        }))
      });
      const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

      await service.rollbackSnapshot(rollbackAuth, { snapshotId: snapshot.id, confirmationToken: "confirm-rollback" });

      const events = await db.query<{ kind: string; severity: string; message: string; metadata: unknown }>(
        `select kind, severity, message, metadata from debugging_events where session_id = $1 and kind like 'rollback%'`,
        [session.id]
      );
      expect(events.rows).toEqual([
        {
          kind: "rollback-succeeded",
          severity: "info",
          message: "Snapshot rollback succeeded.",
          metadata: expect.objectContaining({ snapshotId: snapshot.id, operationCount: 1, protocol: "hdc" })
        }
      ]);
    });

    // #420 regression, severe half: the rollback operation insert runs after
    // the physical write-back. The pre-fix entry smuggled the debug_nodes id
    // through parameterId, the insert bound it into
    // node_operations.parameter_id, and the FK fault rolled back the
    // operation, event, audit, and snapshot claim of a rollback that had
    // already mutated the device — permanently, on every retry.
    it("keeps operation, event, audit, and snapshot evidence when rolling back a nodeId-mode write on a non-mirrored node", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession();
      // Admin node-catalog surface only: a debug_nodes row plus its protocol
      // binding, never a same-id debugging_parameters mirror row.
      const node = await createDebugNode(db, { organizationId: "org-1", name: "Charge current" });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: node.id,
        protocol: "hdc",
        nodePath: "/sys/node/hdc/write",
        accessMode: "RW",
        enabled: true
      });
      const audit = createAuditSpy();
      const gateway = makeGateway();
      const service = createDebuggingService({ db, gateway, createAuditEvent: audit.createAuditEvent });
      const write = await service.writeNode(writeAuth, { sessionId: session.id, nodeId: node.id, value: "3200" });
      expect(write).toMatchObject({ status: "succeeded", snapshotId: expect.any(String) });

      const result = await service.rollbackSnapshot(
        rollbackAuth,
        { snapshotId: write.snapshotId as string, confirmationToken: "confirm-rollback" },
        { requestId: "request-rollback-420" }
      );

      // The physical write-back reached the device with the snapshot value…
      expect(gateway.writeNode).toHaveBeenLastCalledWith(
        expect.objectContaining({ nodePath: "/sys/node/hdc/write", value: "3000" })
      );
      // …and every evidence row survived, with honest node identity.
      expect(result.operations).toEqual([
        expect.objectContaining({ operationType: "rollback", status: "succeeded", requestedValue: "3000" })
      ]);
      expect(result.snapshot).toMatchObject({ id: write.snapshotId, status: "consumed" });
      const stored = await nodeOperationRows(session.id);
      expect(stored).toHaveLength(2);
      expect(stored).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation_type: "write", status: "succeeded", parameter_id: null, node_id: node.id }),
          expect.objectContaining({ operation_type: "rollback", status: "succeeded", parameter_id: null, node_id: node.id })
        ])
      );
      const storedSnapshot = await db.query<{ status: string }>(`select status from debugging_snapshots where id = $1`, [
        write.snapshotId
      ]);
      expect(storedSnapshot.rows).toEqual([{ status: "consumed" }]);
      const events = await db.query<{ kind: string }>(
        `select kind from debugging_events where session_id = $1 and kind like 'rollback%'`,
        [session.id]
      );
      expect(events.rows).toEqual([{ kind: "rollback-succeeded" }]);
      expect(audit.events.filter((event) => event.kind === "debug-snapshot-rollback")).toEqual([
        expect.objectContaining({ targetId: write.snapshotId, traceId: "request-rollback-420" })
      ]);
    });

    // Legacy probe case 1: an already-persisted parameter-identity entry
    // keeps its catalog linkage, and node_id is binding-resolved per entry
    // exactly like #419 forward writes — before any device I/O.
    it("resolves legacy parameter-identity entries with binding-resolved node identity", async () => {
      const { parameter, session } = await seedRuntime();
      const voltage = await seedParameter({ key: "voltage", name: "Voltage", nodePath: "/sys/voltage" });
      const coveringNode = await createDebugNode(db, { organizationId: "org-1", name: "Covering node" });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: coveringNode.id,
        protocol: "hdc",
        nodePath: "/sys/current",
        accessMode: "RW",
        enabled: true
      });
      const snapshot = await createDebugSnapshot(db, {
        organizationId: "org-1",
        sessionId: session.id,
        risk: "Medium",
        // Verbatim pre-#420 persisted shape: parameterId only, no nodeId key.
        entries: [
          { parameterId: parameter.id, nodePath: "/sys/current", previousValue: "3000", targetValue: "3200" },
          { parameterId: voltage.id, nodePath: "/sys/voltage", previousValue: "12", targetValue: "14" }
        ] as never,
        createdByUserId: "user-1"
      });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      const result = await service.rollbackSnapshot(rollbackAuth, { snapshotId: snapshot.id, confirmationToken: "confirm-rollback" });

      expect(result.operations).toHaveLength(2);
      const stored = await nodeOperationRows(session.id);
      expect(stored).toHaveLength(2);
      expect(stored).toEqual(
        expect.arrayContaining([
          // Covered path: catalog linkage plus the binding-resolved node id.
          expect.objectContaining({ node_path: "/sys/current", parameter_id: parameter.id, node_id: coveringNode.id }),
          // Uncovered path: catalog linkage only; node_id stays honestly null.
          expect.objectContaining({ node_path: "/sys/voltage", parameter_id: voltage.id, node_id: null })
        ])
      );
      const storedSnapshot = await db.query<{ status: string }>(`select status from debugging_snapshots where id = $1`, [snapshot.id]);
      expect(storedSnapshot.rows).toEqual([{ status: "consumed" }]);
    });

    // Legacy probe case 2: a node-identity entry written by the pre-#420
    // writer stored the debug_nodes id under parameterId. The probe finds no
    // catalog parameter with that id, finds the debug node, and binds
    // node_id — parameter_id stays null instead of FK-faulting.
    it("rolls back a legacy entry whose parameterId holds a debug_nodes id", async () => {
      await seedDevice();
      await seedTarget();
      const session = await seedSession();
      const node = await createDebugNode(db, { organizationId: "org-1", name: "Legacy node" });
      await upsertDebugNodeBinding(db, {
        organizationId: "org-1",
        nodeId: node.id,
        protocol: "hdc",
        nodePath: "/sys/node/hdc/write",
        accessMode: "RW",
        enabled: true
      });
      const snapshot = await createDebugSnapshot(db, {
        organizationId: "org-1",
        sessionId: session.id,
        risk: "Medium",
        // Verbatim pre-#420 persisted shape: node id smuggled through parameterId.
        entries: [
          { parameterId: node.id, protocol: "hdc", nodePath: "/sys/node/hdc/write", previousValue: "3000", targetValue: "3200" }
        ] as never,
        createdByUserId: "user-1"
      });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

      const result = await service.rollbackSnapshot(rollbackAuth, { snapshotId: snapshot.id, confirmationToken: "confirm-rollback" });

      expect(result.operations).toEqual([expect.objectContaining({ operationType: "rollback", status: "succeeded" })]);
      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([expect.objectContaining({ operation_type: "rollback", parameter_id: null, node_id: node.id })]);
      const storedSnapshot = await db.query<{ status: string }>(`select status from debugging_snapshots where id = $1`, [snapshot.id]);
      expect(storedSnapshot.rows).toEqual([{ status: "consumed" }]);
    });

    // Legacy probe case 3: an orphan entry whose id exists in neither table
    // must not block the rollback — the physical write-back proceeds by
    // nodePath and the evidence rows persist with both identity columns null.
    it("rolls back an orphan legacy entry with evidence intact and both identities null", async () => {
      const { session } = await seedRuntime();
      const audit = createAuditSpy();
      const snapshot = await createDebugSnapshot(db, {
        organizationId: "org-1",
        sessionId: session.id,
        risk: "Medium",
        entries: [{ parameterId: "ghost-parameter", nodePath: "/sys/ghost", previousValue: "3000", targetValue: "3200" }] as never,
        createdByUserId: "user-1"
      });
      const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: audit.createAuditEvent });

      const result = await service.rollbackSnapshot(rollbackAuth, { snapshotId: snapshot.id, confirmationToken: "confirm-rollback" });

      expect(result.operations).toEqual([expect.objectContaining({ operationType: "rollback", status: "succeeded" })]);
      const stored = await nodeOperationRows(session.id);
      expect(stored).toEqual([
        expect.objectContaining({ operation_type: "rollback", parameter_id: null, node_id: null, node_path: "/sys/ghost" })
      ]);
      const storedSnapshot = await db.query<{ status: string }>(`select status from debugging_snapshots where id = $1`, [snapshot.id]);
      expect(storedSnapshot.rows).toEqual([{ status: "consumed" }]);
      expect(audit.events.filter((event) => event.kind === "debug-snapshot-rollback")).toHaveLength(1);
    });
  });
});
