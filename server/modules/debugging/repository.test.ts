import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  acquireDebugDeviceLease,
  claimSnapshotForRollback,
  archiveDebugParameter,
  archiveDebugParameterNodeBinding,
  createDebugParameter,
  createDebugSession,
  createDebugSnapshot,
  insertDebugEvent,
  insertNodeOperation,
  linkOperationSnapshot,
  getDefaultAdbSmokeParameterNodeBinding,
  getDebugDevice,
  getDebugParameterNodeBinding,
  getDebugSession,
  getDebugTarget,
  listDebugDevices,
  listDebugParameterNodeBindings,
  listDebugParameters,
  listDebugSessionEvents,
  markSnapshotConsumed,
  releaseDebugDeviceLease,
  restoreSnapshotValid,
  restoreDebugParameter,
  updateDebugParameter,
  updateDebugParameterValues,
  upsertDebugParameterNodeBinding,
  upsertDetectedTargets
} from "./repository";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      const call = { text, values };
      calls.push(call);
      const next = results.shift() ?? [];
      const rows = typeof next === "function" ? next(call) : next;
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };

  return { calls, db };
}

const timestamp = "2026-05-27T10:00:00.000Z";

function debugParameterRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "param-1",
    organization_id: "org-1",
    name: "Fast charge current",
    key: "debug.fast_charge.current",
    description: "Parameter",
    module: "Charging",
    node_path: "/sys/current",
    access_mode: "RW",
    unit: "mA",
    range_label: "0-5000",
    min_value: 0,
    max_value: 5000,
    risk: "Medium",
    current_value: "3000",
    target_value: "3000",
    sort_order: 10,
    enabled: true,
    archived_at: null,
    archived_by: null,
    archive_reason: null,
    value_kind: "scalar",
    value_format: "raw",
    normalization_mode: "trim",
    max_value_bytes: null,
    ...overrides
  };
}

function debugParameterNodeBindingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "binding-1",
    organization_id: "org-1",
    parameter_id: "param-1",
    protocol: "hdc",
    node_path: "/sys/current",
    access_mode: "RW",
    enabled: true,
    is_smoke_default: false,
    notes: null,
    created_at: "2026-06-22T12:00:00.000Z",
    updated_at: "2026-06-22T12:00:00.000Z",
    ...overrides
  };
}

describe("debugging repository", () => {
  it("creates debugging parameters for admin catalog writes", async () => {
    const { db, calls } = createFakeDb([[debugParameterRow({ id: "param-created" })]]);

    const created = await createDebugParameter(db, {
      organizationId: "org-1",
      name: "Created",
      key: "debug.created",
      description: "",
      module: "Diagnostics",
      nodePath: "/sys/created",
      accessMode: "RO",
      unit: "",
      range: "",
      minValue: null,
      maxValue: null,
      risk: "Low",
      currentValue: "",
      targetValue: "",
      sortOrder: 1,
      enabled: true
    });

    expect(calls[0].text).toContain("insert into debugging_parameters");
    expect(calls[0].values).toEqual([
      expect.any(String),
      "org-1",
      "Created",
      "debug.created",
      "",
      "Diagnostics",
      "/sys/created",
      "RO",
      "",
      "",
      null,
      null,
      "Low",
      "",
      "",
      1,
      true,
      "scalar",
      "raw",
      "trim",
      null
    ]);
    expect(created).toMatchObject({ id: "param-created",  enabled: true });
  });

  it("updates debugging parameter mutable metadata for admin catalog writes", async () => {
    const { db, calls } = createFakeDb([
      [
        debugParameterRow({
          id: "param-updated",
                name: "Updated",
          key: "debug.updated",
          description: "Updated description",
          module: "Diagnostics",
          node_path: "/sys/updated",
          access_mode: "RW",
          unit: "mV",
          range_label: "0-9000",
          min_value: 0,
          max_value: 9000,
          risk: "High",
          current_value: "4500",
          target_value: "4600",
          sort_order: 22,
          enabled: false
        })
      ]
    ]);

    const updated = await updateDebugParameter(db, {
      organizationId: "org-1",
      parameterId: "param-updated",
      name: "Updated",
      key: "debug.updated",
      description: "Updated description",
      module: "Diagnostics",
      nodePath: "/sys/updated",
      accessMode: "RW",
      unit: "mV",
      range: "0-9000",
      minValue: 0,
      maxValue: 9000,
      risk: "High",
      currentValue: "4500",
      targetValue: "4600",
      sortOrder: 22,
      enabled: false
    });

    expect(calls[0].text).toContain("update debugging_parameters");
    expect(calls[0].text).toContain("where organization_id = $1");
    expect(calls[0].text).toContain("and id = $2");
    expect(calls[0].values).toEqual([
      "org-1",
      "param-updated",
      "Updated",
      "debug.updated",
      "Updated description",
      "Diagnostics",
      "/sys/updated",
      "RW",
      "mV",
      "0-9000",
      0,
      9000,
      "High",
      "4500",
      "4600",
      22,
      false,
      "scalar",
      "raw",
      "trim",
      null
    ]);
    expect(updated).toMatchObject({
      id: "param-updated",
      name: "Updated",
      enabled: false
    });
  });

  it("archives and restores debugging parameters without deleting rows", async () => {
    const { db, calls } = createFakeDb([
      [debugParameterRow({ id: "param-1", enabled: false, archived_at: "2026-06-22T12:00:00.000Z" })],
      [debugParameterRow({ id: "param-1", enabled: true, archived_at: null })]
    ]);

    await archiveDebugParameter(db, {
      organizationId: "org-1",
      parameterId: "param-1",
      actorUserId: "user-1",
      reason: "Deprecated"
    });
    await restoreDebugParameter(db, { organizationId: "org-1", parameterId: "param-1" });

    expect(calls[0].text).toContain("update debugging_parameters");
    expect(calls[0].text).toContain("archived_at = now()");
    expect(calls[0].values).toEqual(["org-1", "param-1", "user-1", "Deprecated"]);
    expect(calls[1].text).toContain("archived_at = null");
    expect(calls[1].values).toEqual(["org-1", "param-1"]);
  });

  it("preserves catalog enabled state when archiving and restoring debugging parameters", async () => {
    const { db, calls } = createFakeDb([
      [debugParameterRow({ id: "param-disabled", enabled: false, archived_at: "2026-06-22T12:00:00.000Z" })],
      [debugParameterRow({ id: "param-disabled", enabled: false, archived_at: null })]
    ]);

    await archiveDebugParameter(db, {
      organizationId: "org-1",
      parameterId: "param-disabled",
      actorUserId: "user-1",
      reason: "Temporarily retired"
    });
    await restoreDebugParameter(db, { organizationId: "org-1", parameterId: "param-disabled" });

    expect(calls[0].text).not.toContain("enabled = false");
    expect(calls[1].text).not.toContain("enabled = true");
  });

  it("upserts and archives protocol bindings", async () => {
    const { db, calls } = createFakeDb([
      [debugParameterNodeBindingRow({ protocol: "adb", enabled: true })],
      [debugParameterNodeBindingRow({ protocol: "adb", enabled: false })]
    ]);

    await upsertDebugParameterNodeBinding(db, {
      organizationId: "org-1",
      parameterId: "param-1",
      protocol: "adb",
      nodePath: "/sys/adb/path",
      accessMode: "RO",
      enabled: true,
      notes: "ADB read"
    });
    await archiveDebugParameterNodeBinding(db, {
      organizationId: "org-1",
      parameterId: "param-1",
      protocol: "adb"
    });

    expect(calls[0].text).toContain("insert into debugging_parameter_node_bindings");
    expect(calls[0].text).toContain("from debugging_parameters p");
    expect(calls[0].text).toContain("p.id = $3");
    expect(calls[0].text).toContain("p.organization_id = $2");
    expect(calls[0].text).toContain("on conflict (parameter_id, protocol) do update");
    expect(calls[0].text).toContain("where debugging_parameter_node_bindings.organization_id = excluded.organization_id");
    expect(calls[0].values).toEqual([
      expect.any(String),
      "org-1",
      "param-1",
      "adb",
      "/sys/adb/path",
      "RO",
      true,
      "ADB read"
    ]);
    expect(calls[1].text).toContain("enabled = false");
    expect(calls[1].values).toEqual(["org-1", "param-1", "adb"]);
  });

  it("returns null when upserting a binding for a parameter outside the organization scope", async () => {
    const { db, calls } = createFakeDb([[]]);

    const binding = await upsertDebugParameterNodeBinding(db, {
      organizationId: "org-1",
      parameterId: "param-other-org",
      protocol: "adb",
      nodePath: "/sys/adb/path",
      accessMode: "RO",
      enabled: true,
      notes: "ADB read"
    });

    expect(calls[0].text).toContain("insert into debugging_parameter_node_bindings");
    expect(calls[0].text).toContain("from debugging_parameters p");
    expect(calls[0].text).toContain("p.id = $3");
    expect(calls[0].text).toContain("p.organization_id = $2");
    expect(binding).toBeNull();
  });

  it("maps target, session, and operation protocol fields", async () => {
    const { db } = createFakeDb([
      [
        {
          id: "target-1",
          organization_id: "org-1",
                device_id: "device-1",
          protocol: "adb",
          target_ref: "emulator-5554",
          label: "ADB target emulator-5554",
          status: "detected",
          detected_at: timestamp
        }
      ],
      [
        {
          id: "session-1",
          organization_id: "org-1",
                device_id: "device-1",
          target_id: "target-1",
          protocol: "adb",
          actor_user_id: "user-1",
          status: "active",
          started_at: timestamp,
          ended_at: null
        }
      ],
      [
        {
          id: "operation-1",
          organization_id: "org-1",
                session_id: "session-1",
          parameter_id: "param-1",
          protocol: "adb",
          node_path: "/sys/adb/current",
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

    await expect(getDebugTarget(db, { organizationId: "org-1", targetId: "target-1" })).resolves.toMatchObject({ protocol: "adb" });
    await expect(getDebugSession(db, { organizationId: "org-1", sessionId: "session-1" })).resolves.toMatchObject({ protocol: "adb" });
    await expect(listDebugSessionEvents(db, { organizationId: "org-1", sessionId: "session-1" })).resolves.toEqual([
      expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/current" })
    ]);
  });

  it("returns parameter node bindings by parameter and protocol", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "binding-param-1-adb",
          organization_id: "org-1",
                parameter_id: "param-1",
          protocol: "adb",
          node_path: "/sys/adb/current",
          access_mode: "RW",
          enabled: true,
          notes: "ADB lab node",
          created_at: timestamp,
          updated_at: timestamp
        }
      ]
    ]);

    const binding = await getDebugParameterNodeBinding(db, {
      organizationId: "org-1",
      parameterId: "param-1",
      protocol: "adb"
    });

    expect(calls[0].text).toContain("from debugging_parameter_node_bindings");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("parameter_id = $2");
    expect(calls[0].text).toContain("protocol = $3");
    expect(calls[0].text).toContain("enabled = true");
    expect(calls[0].values).toEqual(["org-1", "param-1", "adb"]);
    expect(binding).toMatchObject({
      parameterId: "param-1",
      protocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RW",
      enabled: true,
      notes: "ADB lab node"
    });
  });

  it("can return disabled parameter node bindings when explicitly requested", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "binding-param-1-adb",
          organization_id: "org-1",
                parameter_id: "param-1",
          protocol: "adb",
          node_path: "/sys/adb/current",
          access_mode: "RW",
          enabled: false,
          notes: "temporarily disabled",
          created_at: timestamp,
          updated_at: timestamp
        }
      ]
    ]);

    const binding = await getDebugParameterNodeBinding(db, {
      organizationId: "org-1",
      parameterId: "param-1",
      protocol: "adb",
      includeDisabled: true
    });

    expect(calls[0].text).not.toContain("enabled = true");
    expect(binding).toMatchObject({
      parameterId: "param-1",
      protocol: "adb",
      enabled: false
    });
  });

  it("keeps parameter node binding lookup enabled-only by default", async () => {
    const { db, calls } = createFakeDb([[]]);

    await getDebugParameterNodeBinding(db, {
      organizationId: "org-1",
      parameterId: "param-1",
      protocol: "adb"
    });

    expect(calls[0].text).toContain("enabled = true");
  });

  it("listDebugDevices filters by organization", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "device-1",
          organization_id: "org-1",
                name: "Aurora Simulator",
          transport: "simulator",
          status: "online",
          firmware: "sim-1.0",
          last_seen_at: timestamp
        }
      ]
    ]);

    const devices = await listDebugDevices(db, { organizationId: "org-1" });

    expect(calls[0].text).toContain("from debugging_devices");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].values).toEqual(["org-1"]);
    expect(devices).toEqual([
      {
        id: "device-1",
        organizationId: "org-1",
          name: "Aurora Simulator",
        transport: "simulator",
        status: "online",
        firmware: "sim-1.0",
        lastSeenAt: timestamp
      }
    ]);
  });

  it("getDebugDevice scopes device lookup by organization", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "device-1",
          organization_id: "org-1",
                name: "Aurora Simulator",
          transport: "simulator",
          status: "online",
          firmware: "sim-1.0",
          last_seen_at: timestamp
        }
      ]
    ]);

    const device = await getDebugDevice(db, { organizationId: "org-1", deviceId: "device-1" });

    expect(calls[0].text).toContain("from debugging_devices");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("id = $2");
    expect(calls[0].values).toEqual(["org-1", "device-1"]);
    expect(device).toMatchObject({ id: "device-1", organizationId: "org-1",  status: "online" });
  });

  it("upsertDetectedTargets updates target status and device last_seen_at", async () => {
    const { db, calls } = createFakeDb([
      (call) => [
        {
          id: call.values[2],
          organization_id: call.values[0],
          device_id: call.values[1],
          bridge_id: call.values[3],
          protocol: call.values[4],
          target_ref: call.values[5],
          label: call.values[6],
          status: call.values[7],
          detected_at: timestamp
        }
      ],
      []
    ]);

    const targets = await upsertDetectedTargets(db, {
      organizationId: "org-1",
      targets: [{ id: "target-1", deviceId: "device-1", targetRef: "simulator://aurora-1", label: "Aurora Target", online: true }]
    });

    expect(calls[0].text).toContain("insert into debugging_targets");
    expect(calls[0].text).toContain("on conflict (device_id, protocol, target_ref) do update");
    expect(calls[0].values).toEqual(["org-1", "device-1", "target-1", null, "hdc", "simulator://aurora-1", "Aurora Target", "detected"]);
    expect(calls[1].text).toContain("update debugging_devices");
    expect(calls[1].text).toContain("last_seen_at = now()");
    expect(calls[1].values).toEqual(["org-1", "device-1", "online"]);
    expect(targets[0]).toMatchObject({ id: "target-1", bridgeId: null, status: "detected", targetRef: "simulator://aurora-1" });
  });

  it("upsertDetectedTargets creates bridge-backed debug devices before persisting targets", async () => {
    const { db, calls } = createFakeDb([
      [],
      (call) => [
        {
          id: call.values[3],
          organization_id: call.values[0],
          project_id: call.values[1],
          device_id: call.values[2],
          bridge_id: call.values[4],
          protocol: call.values[5],
          target_ref: call.values[6],
          label: call.values[7],
          status: call.values[8],
          detected_at: timestamp
        }
      ],
      []
    ]);

    await upsertDetectedTargets(db, {
      organizationId: "org-1",
      targets: [
        {
          id: "bridge:br-1:hdc:serial-1",
          deviceId: "bridge:br-1",
          bridgeId: "br-1",
          bridgeMachineLabel: "Tzrea1deMacBook-Air.local",
          protocol: "hdc",
          targetRef: "serial-1",
          label: "serial-1",
          online: true
        }
      ]
    });

    expect(calls[0].text).toContain("insert into debugging_devices");
    expect(calls[0].values).toEqual([
      "bridge:br-1",
      "org-1",
      "Tzrea1deMacBook-Air.local",
      "hdc",
      "online",
      "bridge"
    ]);
    expect(calls[1].text).toContain("insert into debugging_targets");
    expect(calls[2].text).toContain("update debugging_devices");
  });

  it("listDebugParameters returns sorted parameters by sort_order", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "param-fast-charge",
          organization_id: "org-1",
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
          risk: "High",
          current_value: "3000",
          target_value: "3200",
          sort_order: 20
        },
        {
          id: "param-temp-limit",
          organization_id: "org-1",
                name: "Temperature limit",
          key: "temperature_limit",
          description: "Controls charge temperature limit.",
          module: "Thermal",
          node_path: "/sys/temp",
          access_mode: "RW",
          unit: "C",
          range_label: "0-70",
          min_value: "0",
          max_value: "70",
          risk: "Medium",
          current_value: "45",
          target_value: "48",
          sort_order: 10
        }
      ]
    ]);

    const parameters = await listDebugParameters(db, {
      organizationId: "org-1",
      module: "Battery",
      risk: ["High"]
    });

    expect(calls[0].text).toContain("from debugging_parameters");
    expect(calls[0].text).toContain("module = $2");
    expect(calls[0].text).toContain("risk = any($3::text[])");
    expect(calls[0].text).toContain("order by sort_order asc");
    expect(calls[0].values).toEqual(["org-1", "Battery", ["High"]]);
    expect(parameters.map((parameter) => parameter.id)).toEqual(["param-temp-limit", "param-fast-charge"]);
    expect(parameters[0]).toMatchObject({ minValue: 0, maxValue: 70, sortOrder: 10 });
  });

  it("maps debugging parameter archive fields", async () => {
    const { db } = createFakeDb([
      [
        {
          id: "param-archived",
          organization_id: "org-1",
                name: "Archived parameter",
          key: "debug.archived",
          description: "Archived catalog row.",
          module: "Diagnostics",
          node_path: "/sys/archived",
          access_mode: "RO",
          unit: "",
          range_label: "",
          min_value: null,
          max_value: null,
          risk: "Low",
          current_value: "",
          target_value: "",
          sort_order: 99,
          enabled: false,
          archived_at: "2026-06-22T12:00:00.000Z",
          archived_by: "user-1",
          archive_reason: "No longer supported."
        }
      ]
    ]);

    const parameters = await listDebugParameters(db, {
      organizationId: "org-1",
      includeArchived: true
    });

    expect(parameters[0]).toMatchObject({
      id: "param-archived",
      enabled: false,
      archivedAt: "2026-06-22T12:00:00.000Z",
      archivedBy: "user-1",
      archiveReason: "No longer supported."
    });
  });

  it("excludes archived debugging parameters from runtime lists by default", async () => {
    const { db, calls } = createFakeDb([[]]);

    await listDebugParameters(db, { organizationId: "org-1" });

    expect(calls[0].text).toContain("enabled = true");
    expect(calls[0].text).toContain("archived_at is null");
  });

  it("includes archived debugging parameters for admin lists when requested", async () => {
    const { db, calls } = createFakeDb([[]]);

    await listDebugParameters(db, {
      organizationId: "org-1",
      includeArchived: true
    });

    expect(calls[0].text).not.toContain("enabled = true");
    expect(calls[0].text).not.toContain("archived_at is null");
  });

  it("lists shared protocol bindings for selected parameters", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "binding-shared-adb",
          organization_id: "org-1",
                parameter_id: "shared-param-1",
          protocol: "adb",
          node_path: "/sys/adb/smoke",
          access_mode: "RO",
          enabled: true,
          is_smoke_default: true,
          notes: "Default ADB smoke binding.",
          created_at: timestamp,
          updated_at: timestamp
        }
      ]
    ]);

    const bindings = await listDebugParameterNodeBindings(db, {
      organizationId: "org-1",
      parameterIds: ["shared-param-1"],
      protocol: "adb"
    });

    expect(calls[0].text).toContain("parameter_id = any($2::text[])");
    expect(calls[0].text).toContain("protocol = $3");
    expect(bindings).toEqual([
      expect.objectContaining({
          parameterId: "shared-param-1",
        protocol: "adb",
        isSmokeDefault: true
      })
    ]);
  });

  it("returns the enabled default ADB smoke binding for an organization", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "binding-shared-adb",
          organization_id: "org-1",
                parameter_id: "shared-param-1",
          protocol: "adb",
          node_path: "/sys/adb/smoke",
          access_mode: "RO",
          enabled: true,
          is_smoke_default: true,
          notes: "Default ADB smoke binding.",
          created_at: timestamp,
          updated_at: timestamp
        }
      ]
    ]);

    const binding = await getDefaultAdbSmokeParameterNodeBinding(db, { organizationId: "org-1" });

    expect(calls[0].text).toContain("is_smoke_default = true");
    expect(calls[0].text).toContain("protocol = 'adb'");
    expect(binding).toMatchObject({
      parameterId: "shared-param-1",
      protocol: "adb",
      accessMode: "RO",
      enabled: true,
      isSmokeDefault: true
    });
  });

  it("updateDebugParameterValues stores current and target values for a scoped parameter", async () => {
    const { db, calls } = createFakeDb([[]]);

    await updateDebugParameterValues(db, {
      organizationId: "org-1",
      parameterId: "param-1",
      currentValue: "3200",
      targetValue: "3200"
    });

    expect(calls[0].text).toContain("update debugging_parameters");
    expect(calls[0].text).toContain("current_value = $3");
    expect(calls[0].text).toContain("target_value = $4");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("id = $2");
    expect(calls[0].values).toEqual(["org-1", "param-1", "3200", "3200"]);
  });

  it("createDebugSession persists an active session for actor", async () => {
    const { db, calls } = createFakeDb([
      (call) => [
        {
          id: call.values[0],
          organization_id: "org-1",
                device_id: "device-1",
          target_id: "target-1",
          protocol: call.values[4],
          execution_mode: call.values[5],
          bridge_id: call.values[6],
          bridge_machine_label: call.values[7],
          session_kind: call.values[8],
          actor_user_id: call.values[9],
          status: call.values[10],
          started_at: timestamp,
          ended_at: null
        }
      ]
    ]);

    const session = await createDebugSession(db, {
      organizationId: "org-1",
      deviceId: "device-1",
      targetId: "target-1",
      actorUserId: "user-1"
    });

    expect(calls[0].text).toContain("insert into debugging_sessions");
    expect(calls[0].values.slice(1)).toEqual(["org-1", "device-1", "target-1", "hdc", "server", null, null, "node", "user-1", "active"]);
    expect(session).toMatchObject({
      organizationId: "org-1",
      actorUserId: "user-1",
      status: "active",
      sessionKind: "node",
      executionMode: "server",
      bridgeId: null,
      bridgeMachineLabel: null
    });
    expect(session.id).toEqual(expect.any(String));
  });

  it("acquireDebugDeviceLease returns the lease when the device is claimable", async () => {
    const { db, calls } = createFakeDb([
      (call) => [
        {
          organization_id: call.values[0],
          device_id: call.values[1],
          session_id: call.values[2],
          lease_owner_user_id: call.values[3],
          expires_at: "2026-05-27T10:05:00.000Z",
          acquired_at: timestamp,
          updated_at: timestamp
        }
      ]
    ]);

    const lease = await acquireDebugDeviceLease(db, {
      organizationId: "org-1",
      deviceId: "device-1",
      sessionId: "session-1",
      actorUserId: "user-1",
      leaseTtlMs: 300_000
    });

    expect(calls[0].text).toContain("insert into debug_device_leases");
    expect(calls[0].text).toContain("on conflict (organization_id, device_id) do update");
    expect(calls[0].text).toContain("debug_device_leases.session_id = excluded.session_id");
    expect(calls[0].text).toContain("debug_device_leases.expires_at <= now()");
    expect(calls[0].values).toEqual(["org-1", "device-1", "session-1", "user-1", 300000]);
    expect(lease).toMatchObject({ deviceId: "device-1", sessionId: "session-1", leaseOwnerUserId: "user-1" });
  });

  it("acquireDebugDeviceLease resets acquired_at when a different session takes over", async () => {
    const { db, calls } = createFakeDb([
      (call) => [
        {
          organization_id: call.values[0],
          project_id: call.values[1],
          device_id: call.values[2],
          session_id: call.values[3],
          lease_owner_user_id: call.values[4],
          expires_at: "2026-05-27T10:05:00.000Z",
          acquired_at: "2026-05-27T10:01:00.000Z",
          updated_at: "2026-05-27T10:01:00.000Z"
        }
      ]
    ]);

    await acquireDebugDeviceLease(db, {
      organizationId: "org-1",
      deviceId: "device-1",
      sessionId: "session-2",
      actorUserId: "user-2",
      leaseTtlMs: 300_000
    });

    expect(calls[0].text).toContain("acquired_at = case");
    expect(calls[0].text).toContain("when debug_device_leases.session_id = excluded.session_id");
    expect(calls[0].text).toContain("then debug_device_leases.acquired_at");
    expect(calls[0].text).toContain("else now()");
  });

  it("releaseDebugDeviceLease expires only the owning session lease", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          organization_id: "org-1",
                device_id: "device-1",
          session_id: "session-1",
          lease_owner_user_id: "user-1",
          expires_at: timestamp,
          acquired_at: timestamp,
          updated_at: timestamp
        }
      ]
    ]);

    const lease = await releaseDebugDeviceLease(db, {
      organizationId: "org-1",
      deviceId: "device-1",
      sessionId: "session-1"
    });

    expect(calls[0].text).toContain("update debug_device_leases");
    expect(calls[0].text).toContain("expires_at = now()");
    expect(calls[0].text).toContain("session_id = $3");
    expect(calls[0].values).toEqual(["org-1", "device-1", "session-1"]);
    expect(lease).toMatchObject({ deviceId: "device-1", sessionId: "session-1" });
  });

  it("maps debugging parameter value metadata with scalar defaults", async () => {
    const { db } = createFakeDb([
      [
        debugParameterRow({
          value_kind: undefined,
          value_format: undefined,
          normalization_mode: undefined,
          max_value_bytes: null
        })
      ]
    ]);

    const parameters = await listDebugParameters(db, { organizationId: "org-1" });

    expect(parameters[0]).toMatchObject({
      valueKind: "scalar",
      valueFormat: "raw",
      normalizationMode: "trim",
      maxValueBytes: null
    });
  });

  it("insertNodeOperation stores read/write status, values, failure reason, duration", async () => {
    const { db, calls } = createFakeDb([
      (call) => [
        {
          id: call.values[0],
          organization_id: call.values[1],
          session_id: call.values[2],
          parameter_id: call.values[3],
          node_id: call.values[4],
          parameter_definition_id: call.values[5],
          protocol: call.values[6],
          node_path: call.values[7],
          operation_type: call.values[8],
          status: call.values[9],
          requested_value: call.values[10],
          previous_value: call.values[11],
          read_value: call.values[12],
          readback_value: call.values[13],
          verified: call.values[14],
          failure_reason: call.values[15],
          duration_ms: call.values[16],
          approval_id: call.values[17],
          snapshot_id: call.values[18],
          created_at: timestamp,
          value_kind: call.values[19],
          value_format: call.values[20],
          normalization_mode: call.values[21],
          requested_value_digest: call.values[22],
          previous_value_digest: call.values[23],
          readback_value_digest: call.values[24],
          value_preview: call.values[25]
        }
      ]
    ]);

    const operation = await insertNodeOperation(db, {
      organizationId: "org-1",
      sessionId: "session-1",
      parameterId: "param-1",
      nodePath: "/sys/current",
      operationType: "write",
      status: "readback_mismatch",
      requestedValue: "3200",
      previousValue: "3000",
      readValue: "3000",
      readbackValue: "3100",
      verified: false,
      failureReason: "Readback mismatch.",
      durationMs: 23,
      approvalId: "approval-1",
      snapshotId: "snapshot-1",
      valueKind: "complex",
      valueFormat: "json",
      normalizationMode: "json-canonical",
      requestedValueDigest: "req-digest",
      previousValueDigest: "prev-digest",
      readbackValueDigest: "read-digest",
      valuePreview: "3200",
      actorUserId: "user-1"
    });

    expect(calls[0].text).toContain("insert into node_operations");
    expect(calls[0].values.slice(1)).toEqual([
      "org-1",
      "session-1",
      "param-1",
      "param-1",
      null,
      "hdc",
      "/sys/current",
      "write",
      "readback_mismatch",
      "3200",
      "3000",
      "3000",
      "3100",
      false,
      "Readback mismatch.",
      23,
      "approval-1",
      "snapshot-1",
      "complex",
      "json",
      "json-canonical",
      "req-digest",
      "prev-digest",
      "read-digest",
      "3200",
      "user-1",
      null,
      null
    ]);
    expect(operation).toMatchObject({
      operationType: "write",
      status: "readback_mismatch",
      requestedValue: "3200",
      previousValue: "3000",
      readValue: "3000",
      readbackValue: "3100",
      failureReason: "Readback mismatch.",
      durationMs: 23,
      approvalId: "approval-1",
      snapshotId: "snapshot-1"
    });
  });

  it("createDebugSnapshot stores JSON entries and valid status", async () => {
    const entries = [
      { parameterId: "param-1", nodePath: "/sys/current", previousValue: "3000", targetValue: "3200" }
    ];
    const { db, calls } = createFakeDb([
      (call) => [
        {
          id: call.values[0],
          organization_id: call.values[1],
          session_id: call.values[2],
          operation_id: call.values[3],
          status: call.values[4],
          risk: call.values[5],
          entries: JSON.parse(String(call.values[6])),
          created_by_user_id: call.values[7],
          created_at: timestamp,
          consumed_at: null
        }
      ]
    ]);

    const snapshot = await createDebugSnapshot(db, {
      organizationId: "org-1",
      sessionId: "session-1",
      operationId: "operation-1",
      risk: "High",
      entries,
      createdByUserId: "user-1"
    });

    expect(calls[0].text).toContain("insert into debugging_snapshots");
    expect(calls[0].text).toContain("$7::jsonb");
    expect(calls[0].values.slice(1)).toEqual(["org-1", "session-1", "operation-1", "valid", "High", JSON.stringify(entries), "user-1"]);
    expect(snapshot).toMatchObject({ status: "valid", risk: "High", entries });
  });

  it("markSnapshotConsumed prevents reuse / marks consumed", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "snapshot-1",
          organization_id: "org-1",
                session_id: "session-1",
          operation_id: null,
          status: "consumed",
          risk: "High",
          entries: [],
          created_at: timestamp,
          consumed_at: timestamp
        }
      ]
    ]);

    const snapshot = await markSnapshotConsumed(db, { organizationId: "org-1", snapshotId: "snapshot-1" });

    expect(calls[0].text).toContain("update debugging_snapshots");
    expect(calls[0].text).toContain("status = 'consumed'");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("status in ('valid', 'rollback_pending')");
    expect(calls[0].values).toEqual(["org-1", "snapshot-1"]);
    expect(snapshot?.status).toBe("consumed");
  });

  it("markSnapshotConsumed returns null when no valid scoped snapshot is updated", async () => {
    const { db } = createFakeDb([[]]);

    const snapshot = await markSnapshotConsumed(db, { organizationId: "org-1", snapshotId: "snapshot-1" });

    expect(snapshot).toBeNull();
  });

  it("claimSnapshotForRollback atomically moves only valid scoped snapshots to rollback_pending", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "snapshot-1",
          organization_id: "org-1",
                session_id: "session-1",
          operation_id: null,
          status: "rollback_pending",
          risk: "High",
          entries: [],
          created_at: timestamp,
          consumed_at: null
        }
      ]
    ]);

    const snapshot = await claimSnapshotForRollback(db, { organizationId: "org-1", snapshotId: "snapshot-1" });

    expect(calls[0].text).toContain("update debugging_snapshots");
    expect(calls[0].text).toContain("status = 'rollback_pending'");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("id = $2");
    expect(calls[0].text).toContain("status = 'valid'");
    expect(calls[0].values).toEqual(["org-1", "snapshot-1"]);
    expect(snapshot).toMatchObject({ id: "snapshot-1", organizationId: "org-1", status: "rollback_pending" });
  });

  it("claimSnapshotForRollback returns null when no valid scoped snapshot is updated", async () => {
    const { db } = createFakeDb([[]]);

    const snapshot = await claimSnapshotForRollback(db, { organizationId: "org-1", snapshotId: "snapshot-1" });

    expect(snapshot).toBeNull();
  });

  it("restoreSnapshotValid moves only rollback_pending scoped snapshots back to valid", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "snapshot-1",
          organization_id: "org-1",
                session_id: "session-1",
          operation_id: null,
          status: "valid",
          risk: "High",
          entries: [],
          created_at: timestamp,
          consumed_at: null
        }
      ]
    ]);

    const snapshot = await restoreSnapshotValid(db, { organizationId: "org-1", snapshotId: "snapshot-1" });

    expect(calls[0].text).toContain("update debugging_snapshots");
    expect(calls[0].text).toContain("status = 'valid'");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("id = $2");
    expect(calls[0].text).toContain("status = 'rollback_pending'");
    expect(calls[0].values).toEqual(["org-1", "snapshot-1"]);
    expect(snapshot).toMatchObject({ id: "snapshot-1", status: "valid" });
  });

  it("listDebugSessionEvents returns operations newest-last for UI history", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "operation-old",
          organization_id: "org-1",
                session_id: "session-1",
          parameter_id: "param-1",
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
          actor_user_id: "user-1",
          created_at: "2026-05-27T09:59:00.000Z"
        },
        {
          id: "operation-new",
          organization_id: "org-1",
                session_id: "session-1",
          parameter_id: "param-1",
          node_path: "/sys/current",
          operation_type: "write",
          status: "succeeded",
          requested_value: "3200",
          previous_value: "3000",
          read_value: null,
          readback_value: "3200",
          verified: true,
          failure_reason: null,
          duration_ms: 8,
          approval_id: null,
          snapshot_id: "snapshot-1",
          actor_user_id: "user-1",
          created_at: timestamp
        }
      ]
    ]);

    const events = await listDebugSessionEvents(db, { organizationId: "org-1", sessionId: "session-1" });

    expect(calls[0].text).toContain("from node_operations");
    expect(calls[0].text).toContain("order by created_at asc");
    expect(calls[0].values).toEqual(["org-1", "session-1"]);
    expect(events.map((event) => event.id)).toEqual(["operation-old", "operation-new"]);
  });

  it("links operation snapshots and inserts debug events with metadata", async () => {
    const { db, calls } = createFakeDb([[], []]);

    await linkOperationSnapshot(db, { organizationId: "org-1", operationId: "operation-1", snapshotId: "snapshot-1" });
    await insertDebugEvent(db, {
      id: "event-1",
      organizationId: "org-1",
      sessionId: "session-1",
      operationId: "operation-1",
      kind: "write",
      severity: "warning",
      message: "Write completed with readback evidence.",
      metadata: { verified: true }
    });

    expect(calls[0].text).toContain("update node_operations");
    expect(calls[0].text).toContain("from debugging_snapshots");
    expect(calls[0].text).toContain("node_operations.id = $2");
    expect(calls[0].text).toContain("debugging_snapshots.id = $3");
    expect(calls[0].text).toContain("node_operations.organization_id = $1");
    expect(calls[0].text).toContain("debugging_snapshots.organization_id = $1");
    expect(calls[0].text).toContain("node_operations.session_id = debugging_snapshots.session_id");
    expect(calls[0].values).toEqual(["org-1", "operation-1", "snapshot-1"]);
    expect(calls[1].text).toContain("insert into debugging_events");
    expect(calls[1].text).toContain("$8::jsonb");
    expect(calls[1].values).toEqual([
      "event-1",
      "org-1",
      "session-1",
      "operation-1",
      "write",
      "warning",
      "Write completed with readback evidence.",
      JSON.stringify({ verified: true })
    ]);
  });
});
