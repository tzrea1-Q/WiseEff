import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  createDebugSession,
  createDebugSnapshot,
  insertDebugEvent,
  insertNodeOperation,
  linkOperationSnapshot,
  listDebugDevices,
  listDebugParameters,
  listDebugSessionEvents,
  markSnapshotConsumed,
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

describe("debugging repository", () => {
  it("listDebugDevices filters by organization and project", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "device-1",
          organization_id: "org-1",
          project_id: "aurora",
          name: "Aurora Simulator",
          transport: "simulator",
          status: "online",
          firmware: "sim-1.0",
          last_seen_at: timestamp
        }
      ]
    ]);

    const devices = await listDebugDevices(db, { organizationId: "org-1", projectId: "aurora" });

    expect(calls[0].text).toContain("from debugging_devices");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("project_id = $2");
    expect(calls[0].values).toEqual(["org-1", "aurora"]);
    expect(devices).toEqual([
      {
        id: "device-1",
        organizationId: "org-1",
        projectId: "aurora",
        name: "Aurora Simulator",
        transport: "simulator",
        status: "online",
        firmware: "sim-1.0",
        lastSeenAt: timestamp
      }
    ]);
  });

  it("upsertDetectedTargets updates target status and device last_seen_at", async () => {
    const { db, calls } = createFakeDb([
      (call) => [
        {
          id: call.values[3],
          organization_id: call.values[0],
          project_id: call.values[1],
          device_id: call.values[2],
          target_ref: call.values[4],
          label: call.values[5],
          status: call.values[6],
          detected_at: timestamp
        }
      ],
      []
    ]);

    const targets = await upsertDetectedTargets(db, {
      organizationId: "org-1",
      projectId: "aurora",
      deviceId: "device-1",
      targets: [{ id: "target-1", targetRef: "simulator://aurora-1", label: "Aurora Target", online: true }]
    });

    expect(calls[0].text).toContain("insert into debugging_targets");
    expect(calls[0].text).toContain("on conflict (device_id, target_ref) do update");
    expect(calls[0].values).toEqual(["org-1", "aurora", "device-1", "target-1", "simulator://aurora-1", "Aurora Target", "detected"]);
    expect(calls[1].text).toContain("update debugging_devices");
    expect(calls[1].text).toContain("last_seen_at = now()");
    expect(calls[1].values).toEqual(["org-1", "device-1", "online"]);
    expect(targets[0]).toMatchObject({ id: "target-1", status: "detected", targetRef: "simulator://aurora-1" });
  });

  it("listDebugParameters returns sorted parameters by sort_order", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "param-fast-charge",
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
          risk: "High",
          current_value: "3000",
          target_value: "3200",
          sort_order: 20
        },
        {
          id: "param-temp-limit",
          organization_id: "org-1",
          project_id: "aurora",
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
      projectId: "aurora",
      module: "Battery",
      risk: ["High"]
    });

    expect(calls[0].text).toContain("from debugging_parameters");
    expect(calls[0].text).toContain("project_id = $2");
    expect(calls[0].text).toContain("module = $3");
    expect(calls[0].text).toContain("risk = any($4::text[])");
    expect(calls[0].text).toContain("order by sort_order asc");
    expect(calls[0].values).toEqual(["org-1", "aurora", "Battery", ["High"]]);
    expect(parameters.map((parameter) => parameter.id)).toEqual(["param-temp-limit", "param-fast-charge"]);
    expect(parameters[0]).toMatchObject({ minValue: 0, maxValue: 70, sortOrder: 10 });
  });

  it("createDebugSession persists an active session for actor", async () => {
    const { db, calls } = createFakeDb([
      (call) => [
        {
          id: call.values[0],
          organization_id: "org-1",
          project_id: "aurora",
          device_id: "device-1",
          target_id: "target-1",
          actor_user_id: "user-1",
          status: "active",
          started_at: timestamp,
          ended_at: null
        }
      ]
    ]);

    const session = await createDebugSession(db, {
      organizationId: "org-1",
      projectId: "aurora",
      deviceId: "device-1",
      targetId: "target-1",
      actorUserId: "user-1"
    });

    expect(calls[0].text).toContain("insert into debugging_sessions");
    expect(calls[0].values.slice(1)).toEqual(["org-1", "aurora", "device-1", "target-1", "user-1", "active"]);
    expect(session).toMatchObject({ organizationId: "org-1", projectId: "aurora", actorUserId: "user-1", status: "active" });
    expect(session.id).toEqual(expect.any(String));
  });

  it("insertNodeOperation stores read/write status, values, failure reason, duration", async () => {
    const { db, calls } = createFakeDb([
      (call) => [
        {
          id: call.values[0],
          organization_id: call.values[1],
          project_id: call.values[2],
          session_id: call.values[3],
          parameter_id: call.values[4],
          node_path: call.values[5],
          operation_type: call.values[6],
          status: call.values[7],
          requested_value: call.values[8],
          previous_value: call.values[9],
          read_value: call.values[10],
          readback_value: call.values[11],
          verified: call.values[12],
          failure_reason: call.values[13],
          duration_ms: call.values[14],
          approval_id: call.values[15],
          snapshot_id: call.values[16],
          created_at: timestamp
        }
      ]
    ]);

    const operation = await insertNodeOperation(db, {
      organizationId: "org-1",
      projectId: "aurora",
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
      actorUserId: "user-1"
    });

    expect(calls[0].text).toContain("insert into node_operations");
    expect(calls[0].values.slice(1)).toEqual([
      "org-1",
      "aurora",
      "session-1",
      "param-1",
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
      "user-1"
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
          project_id: call.values[2],
          session_id: call.values[3],
          operation_id: call.values[4],
          status: call.values[5],
          risk: call.values[6],
          entries: JSON.parse(String(call.values[7])),
          created_by_user_id: call.values[8],
          created_at: timestamp,
          consumed_at: null
        }
      ]
    ]);

    const snapshot = await createDebugSnapshot(db, {
      organizationId: "org-1",
      projectId: "aurora",
      sessionId: "session-1",
      operationId: "operation-1",
      risk: "High",
      entries,
      createdByUserId: "user-1"
    });

    expect(calls[0].text).toContain("insert into debugging_snapshots");
    expect(calls[0].text).toContain("$8::jsonb");
    expect(calls[0].values.slice(1)).toEqual(["org-1", "aurora", "session-1", "operation-1", "valid", "High", JSON.stringify(entries), "user-1"]);
    expect(snapshot).toMatchObject({ status: "valid", risk: "High", entries });
  });

  it("markSnapshotConsumed prevents reuse / marks consumed", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "snapshot-1",
          organization_id: "org-1",
          project_id: "aurora",
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

    const snapshot = await markSnapshotConsumed(db, { snapshotId: "snapshot-1" });

    expect(calls[0].text).toContain("update debugging_snapshots");
    expect(calls[0].text).toContain("status = 'consumed'");
    expect(calls[0].text).toContain("status = 'valid'");
    expect(calls[0].values).toEqual(["snapshot-1"]);
    expect(snapshot.status).toBe("consumed");
  });

  it("listDebugSessionEvents returns operations newest-last for UI history", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "operation-old",
          organization_id: "org-1",
          project_id: "aurora",
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
          project_id: "aurora",
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

    await linkOperationSnapshot(db, { operationId: "operation-1", snapshotId: "snapshot-1" });
    await insertDebugEvent(db, {
      id: "event-1",
      organizationId: "org-1",
      projectId: "aurora",
      sessionId: "session-1",
      operationId: "operation-1",
      kind: "write",
      severity: "warning",
      message: "Write completed with readback evidence.",
      metadata: { verified: true }
    });

    expect(calls[0].text).toContain("update node_operations");
    expect(calls[0].values).toEqual(["operation-1", "snapshot-1"]);
    expect(calls[1].text).toContain("insert into debugging_events");
    expect(calls[1].text).toContain("$9::jsonb");
    expect(calls[1].values).toEqual([
      "event-1",
      "org-1",
      "aurora",
      "session-1",
      "operation-1",
      "write",
      "warning",
      "Write completed with readback evidence.",
      JSON.stringify({ verified: true })
    ]);
  });
});
