import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import type {
  DebugDeviceRecord,
  DebugDeviceLeaseRecord,
  DebugParameterNodeBindingRecord,
  DebugParameterRecord,
  DebugSessionRecord,
  DebugSnapshotEntry,
  DebugSnapshotRecord,
  DebugTargetRecord,
  NodeOperationRecord
} from "./types";
import { defaultDebugConnectionProtocol, type DebugConnectionProtocol } from "./protocol";
import type {
  DebugAccessMode,
  DebugDeviceStatus,
  DebugOperationStatus,
  DebugOperationType,
  DebugRiskLevel,
  DebugSessionStatus,
  DebugSnapshotStatus,
  DebugTargetStatus
} from "./status";

type DebugDeviceRow = {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  transport: "simulator" | "hdc" | "adb" | "multi";
  status: DebugDeviceStatus;
  firmware: string;
  last_seen_at: string | Date | null;
};

type DebugDeviceLeaseRow = {
  organization_id: string;
  project_id: string;
  device_id: string;
  session_id: string;
  lease_owner_user_id: string;
  expires_at: string | Date;
  acquired_at: string | Date;
  updated_at: string | Date;
};

type DebugTargetRow = {
  id: string;
  organization_id: string;
  project_id: string;
  device_id: string;
  protocol?: DebugConnectionProtocol;
  target_ref: string;
  label: string;
  status: DebugTargetStatus;
  detected_at: string | Date;
};

type DebugParameterRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  node_path: string;
  access_mode: DebugAccessMode;
  unit: string;
  range_label: string;
  min_value: number | string | null;
  max_value: number | string | null;
  risk: DebugRiskLevel;
  current_value: string;
  target_value: string;
  sort_order: number | string;
  enabled: boolean;
  archived_at: string | Date | null;
  archived_by: string | null;
  archive_reason: string | null;
};

type DebugSessionRow = {
  id: string;
  organization_id: string;
  project_id: string;
  device_id: string;
  target_id: string;
  protocol?: DebugConnectionProtocol;
  actor_user_id: string;
  status: DebugSessionStatus;
  started_at: string | Date;
  ended_at: string | Date | null;
};

type DebugParameterNodeBindingRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  parameter_id: string;
  protocol: DebugConnectionProtocol;
  node_path: string;
  access_mode: DebugAccessMode;
  enabled: boolean;
  is_smoke_default: boolean;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type DebugSnapshotRow = {
  id: string;
  organization_id: string;
  project_id: string;
  session_id: string;
  operation_id: string | null;
  status: DebugSnapshotStatus;
  risk: DebugRiskLevel;
  entries: DebugSnapshotEntry[] | string;
  created_at: string | Date;
};

type NodeOperationRow = {
  id: string;
  organization_id: string;
  project_id: string;
  session_id: string;
  parameter_id: string | null;
  protocol?: DebugConnectionProtocol;
  node_path: string;
  operation_type: DebugOperationType;
  status: DebugOperationStatus;
  requested_value: string | null;
  previous_value: string | null;
  read_value: string | null;
  readback_value: string | null;
  verified: boolean;
  failure_reason: string | null;
  duration_ms: number | string;
  approval_id: string | null;
  snapshot_id: string | null;
  created_at: string | Date;
};

function dateTimeToIso(value: string | Date | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toNumberOrNull(value: number | string | null) {
  return value === null ? null : Number(value);
}

function parseEntries(value: DebugSnapshotEntry[] | string): DebugSnapshotEntry[] {
  return typeof value === "string" ? (JSON.parse(value) as DebugSnapshotEntry[]) : value;
}

function toDebugDeviceRecord(row: DebugDeviceRow): DebugDeviceRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    transport: row.transport,
    status: row.status,
    firmware: row.firmware,
    lastSeenAt: dateTimeToIso(row.last_seen_at)
  };
}

function toDebugDeviceLeaseRecord(row: DebugDeviceLeaseRow): DebugDeviceLeaseRecord {
  return {
    organizationId: row.organization_id,
    projectId: row.project_id,
    deviceId: row.device_id,
    sessionId: row.session_id,
    leaseOwnerUserId: row.lease_owner_user_id,
    expiresAt: dateTimeToIso(row.expires_at) ?? "",
    acquiredAt: dateTimeToIso(row.acquired_at) ?? "",
    updatedAt: dateTimeToIso(row.updated_at) ?? ""
  };
}

function toDebugTargetRecord(row: DebugTargetRow): DebugTargetRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    deviceId: row.device_id,
    protocol: row.protocol ?? defaultDebugConnectionProtocol,
    targetRef: row.target_ref,
    label: row.label,
    status: row.status,
    detectedAt: dateTimeToIso(row.detected_at) ?? ""
  };
}

function toDebugParameterRecord(row: DebugParameterRow): DebugParameterRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    key: row.key,
    description: row.description,
    module: row.module,
    nodePath: row.node_path,
    accessMode: row.access_mode,
    unit: row.unit,
    range: row.range_label,
    minValue: toNumberOrNull(row.min_value),
    maxValue: toNumberOrNull(row.max_value),
    risk: row.risk,
    currentValue: row.current_value,
    targetValue: row.target_value,
    sortOrder: Number(row.sort_order),
    enabled: row.enabled,
    archivedAt: dateTimeToIso(row.archived_at),
    archivedBy: row.archived_by,
    archiveReason: row.archive_reason
  };
}

function toDebugParameterNodeBindingRecord(row: DebugParameterNodeBindingRow): DebugParameterNodeBindingRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    parameterId: row.parameter_id,
    protocol: row.protocol,
    nodePath: row.node_path,
    accessMode: row.access_mode,
    enabled: row.enabled,
    isSmokeDefault: row.is_smoke_default,
    notes: row.notes,
    createdAt: dateTimeToIso(row.created_at) ?? "",
    updatedAt: dateTimeToIso(row.updated_at) ?? ""
  };
}

function toDebugSessionRecord(row: DebugSessionRow): DebugSessionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    deviceId: row.device_id,
    targetId: row.target_id,
    protocol: row.protocol ?? defaultDebugConnectionProtocol,
    actorUserId: row.actor_user_id,
    status: row.status,
    startedAt: dateTimeToIso(row.started_at) ?? "",
    endedAt: dateTimeToIso(row.ended_at)
  };
}

function toDebugSnapshotRecord(row: DebugSnapshotRow): DebugSnapshotRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    operationId: row.operation_id,
    status: row.status,
    risk: row.risk,
    entries: parseEntries(row.entries),
    createdAt: dateTimeToIso(row.created_at) ?? ""
  };
}

function toNodeOperationRecord(row: NodeOperationRow): NodeOperationRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    parameterId: row.parameter_id,
    protocol: row.protocol ?? defaultDebugConnectionProtocol,
    nodePath: row.node_path,
    operationType: row.operation_type,
    status: row.status,
    requestedValue: row.requested_value,
    previousValue: row.previous_value,
    readValue: row.read_value,
    readbackValue: row.readback_value,
    verified: row.verified,
    failureReason: row.failure_reason,
    durationMs: Number(row.duration_ms),
    approvalId: row.approval_id,
    snapshotId: row.snapshot_id,
    createdAt: dateTimeToIso(row.created_at) ?? ""
  };
}

function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}

function addNullableProjectCondition(parts: string[], values: unknown[], projectId?: string, projectIds?: string[]) {
  if (projectId) {
    addCondition(parts, values, (placeholder) => `(project_id is null or project_id = ${placeholder})`, projectId);
  } else if (projectIds?.length) {
    addCondition(parts, values, (placeholder) => `(project_id is null or project_id = any(${placeholder}::text[]))`, projectIds);
  }
}

const debugParameterColumns = `
  id,
  organization_id,
  project_id,
  name,
  key,
  description,
  module,
  node_path,
  access_mode,
  unit,
  range_label,
  min_value,
  max_value,
  risk,
  current_value,
  target_value,
  sort_order,
  enabled,
  archived_at,
  archived_by,
  archive_reason
`;

const debugParameterNodeBindingColumns = `
  id,
  organization_id,
  project_id,
  parameter_id,
  protocol,
  node_path,
  access_mode,
  enabled,
  is_smoke_default,
  notes,
  created_at,
  updated_at
`;

const nodeOperationColumns = `
  id,
  organization_id,
  project_id,
  session_id,
  parameter_id,
  protocol,
  node_path,
  operation_type,
  status,
  requested_value,
  previous_value,
  read_value,
  readback_value,
  verified,
  failure_reason,
  duration_ms,
  approval_id,
  snapshot_id,
  created_at
`;

export type WriteDebugParameterInput = {
  organizationId: string;
  projectId: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath: string;
  accessMode: DebugAccessMode;
  unit: string;
  range: string;
  minValue: number | null;
  maxValue: number | null;
  risk: DebugRiskLevel;
  currentValue: string;
  targetValue: string;
  sortOrder: number;
  enabled: boolean;
};

export async function listDebugDevices(
  db: Queryable,
  input: { organizationId: string; projectId?: string; projectIds?: string[] }
): Promise<DebugDeviceRecord[]> {
  const values: unknown[] = [input.organizationId];
  const where = ["organization_id = $1"];

  if (input.projectId) {
    addCondition(where, values, (placeholder) => `project_id = ${placeholder}`, input.projectId);
  } else if (input.projectIds?.length) {
    addCondition(where, values, (placeholder) => `project_id = any(${placeholder}::text[])`, input.projectIds);
  }

  const result = await db.query<DebugDeviceRow>(
    `
    select id, organization_id, project_id, name, transport, status, firmware, last_seen_at
    from debugging_devices
    where ${where.join("\n      and ")}
    order by last_seen_at desc nulls last, name asc, id asc
    `,
    values
  );

  return result.rows.map(toDebugDeviceRecord);
}

export async function getDebugDevice(
  db: Queryable,
  input: { organizationId: string; deviceId: string }
): Promise<DebugDeviceRecord | null> {
  const result = await db.query<DebugDeviceRow>(
    `
    select id, organization_id, project_id, name, transport, status, firmware, last_seen_at
    from debugging_devices
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [input.organizationId, input.deviceId]
  );

  return result.rows[0] ? toDebugDeviceRecord(result.rows[0]) : null;
}

export async function listDebugParameters(
  db: Queryable,
  input: { organizationId: string; projectId?: string; projectIds?: string[]; module?: string; risk?: string[]; includeArchived?: boolean }
): Promise<DebugParameterRecord[]> {
  const values: unknown[] = [input.organizationId];
  const where = ["organization_id = $1"];

  addNullableProjectCondition(where, values, input.projectId, input.projectIds);
  if (input.module) {
    addCondition(where, values, (placeholder) => `module = ${placeholder}`, input.module);
  }
  if (input.risk?.length) {
    addCondition(where, values, (placeholder) => `risk = any(${placeholder}::text[])`, input.risk);
  }
  if (!input.includeArchived) {
    where.push("enabled = true");
    where.push("archived_at is null");
  }

  const result = await db.query<DebugParameterRow>(
    `
    select ${debugParameterColumns}
    from debugging_parameters
    where ${where.join("\n      and ")}
    order by sort_order asc, name asc, id asc
    `,
    values
  );

  return result.rows.map(toDebugParameterRecord).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export async function getDebugParameter(
  db: Queryable,
  input: { organizationId: string; parameterId: string }
): Promise<DebugParameterRecord | null> {
  const result = await db.query<DebugParameterRow>(
    `
    select ${debugParameterColumns}
    from debugging_parameters
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [input.organizationId, input.parameterId]
  );

  return result.rows[0] ? toDebugParameterRecord(result.rows[0]) : null;
}

export async function updateDebugParameterValues(
  db: Queryable,
  input: { organizationId: string; parameterId: string; currentValue: string; targetValue: string }
): Promise<void> {
  await db.query(
    `
    update debugging_parameters
    set current_value = $3,
      target_value = $4,
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.parameterId, input.currentValue, input.targetValue]
  );
}

export async function createDebugParameter(db: Queryable, input: WriteDebugParameterInput): Promise<DebugParameterRecord> {
  const result = await db.query<DebugParameterRow>(
    `
    insert into debugging_parameters (
      id,
      organization_id,
      project_id,
      name,
      key,
      description,
      module,
      node_path,
      access_mode,
      unit,
      range_label,
      min_value,
      max_value,
      risk,
      current_value,
      target_value,
      sort_order,
      enabled
    )
    values (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13,
      $14,
      $15,
      $16,
      $17,
      $18
    )
    returning ${debugParameterColumns}
    `,
    [
      randomUUID(),
      input.organizationId,
      input.projectId,
      input.name,
      input.key,
      input.description,
      input.module,
      input.nodePath,
      input.accessMode,
      input.unit,
      input.range,
      input.minValue,
      input.maxValue,
      input.risk,
      input.currentValue,
      input.targetValue,
      input.sortOrder,
      input.enabled
    ]
  );

  return toDebugParameterRecord(result.rows[0]);
}

export async function updateDebugParameter(
  db: Queryable,
  input: WriteDebugParameterInput & { parameterId: string }
): Promise<DebugParameterRecord | null> {
  const result = await db.query<DebugParameterRow>(
    `
    update debugging_parameters
    set project_id = $3,
      name = $4,
      key = $5,
      description = $6,
      module = $7,
      node_path = $8,
      access_mode = $9,
      unit = $10,
      range_label = $11,
      min_value = $12,
      max_value = $13,
      risk = $14,
      current_value = $15,
      target_value = $16,
      sort_order = $17,
      enabled = $18,
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning ${debugParameterColumns}
    `,
    [
      input.organizationId,
      input.parameterId,
      input.projectId,
      input.name,
      input.key,
      input.description,
      input.module,
      input.nodePath,
      input.accessMode,
      input.unit,
      input.range,
      input.minValue,
      input.maxValue,
      input.risk,
      input.currentValue,
      input.targetValue,
      input.sortOrder,
      input.enabled
    ]
  );

  return result.rows[0] ? toDebugParameterRecord(result.rows[0]) : null;
}

export async function archiveDebugParameter(
  db: Queryable,
  input: { organizationId: string; parameterId: string; actorUserId: string; reason?: string | null }
): Promise<DebugParameterRecord | null> {
  const result = await db.query<DebugParameterRow>(
    `
    update debugging_parameters
    set archived_at = now(),
      archived_by = $3,
      archive_reason = $4,
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning ${debugParameterColumns}
    `,
    [input.organizationId, input.parameterId, input.actorUserId, input.reason ?? null]
  );

  return result.rows[0] ? toDebugParameterRecord(result.rows[0]) : null;
}

export async function restoreDebugParameter(
  db: Queryable,
  input: { organizationId: string; parameterId: string }
): Promise<DebugParameterRecord | null> {
  const result = await db.query<DebugParameterRow>(
    `
    update debugging_parameters
    set archived_at = null,
      archived_by = null,
      archive_reason = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning ${debugParameterColumns}
    `,
    [input.organizationId, input.parameterId]
  );

  return result.rows[0] ? toDebugParameterRecord(result.rows[0]) : null;
}

export async function getDebugParameterNodeBinding(
  db: Queryable,
  input: { organizationId: string; parameterId: string; protocol: DebugConnectionProtocol; includeDisabled?: boolean }
): Promise<DebugParameterNodeBindingRecord | null> {
  const result = await db.query<DebugParameterNodeBindingRow>(
    `
    select ${debugParameterNodeBindingColumns}
    from debugging_parameter_node_bindings
    where organization_id = $1
      and parameter_id = $2
      and protocol = $3
      ${input.includeDisabled ? "" : "and enabled = true"}
    limit 1
    `,
    [input.organizationId, input.parameterId, input.protocol]
  );

  return result.rows[0] ? toDebugParameterNodeBindingRecord(result.rows[0]) : null;
}

export async function listDebugParameterNodeBindings(
  db: Queryable,
  input: { organizationId: string; projectId?: string; parameterIds?: string[]; protocol?: DebugConnectionProtocol }
): Promise<DebugParameterNodeBindingRecord[]> {
  const values: unknown[] = [input.organizationId];
  const where = ["organization_id = $1"];

  addNullableProjectCondition(where, values, input.projectId);
  if (input.parameterIds?.length) {
    addCondition(where, values, (placeholder) => `parameter_id = any(${placeholder}::text[])`, input.parameterIds);
  }
  if (input.protocol) {
    addCondition(where, values, (placeholder) => `protocol = ${placeholder}`, input.protocol);
  }

  const result = await db.query<DebugParameterNodeBindingRow>(
    `
    select ${debugParameterNodeBindingColumns}
    from debugging_parameter_node_bindings
    where ${where.join("\n      and ")}
    order by parameter_id asc, protocol asc
    `,
    values
  );

  return result.rows.map(toDebugParameterNodeBindingRecord);
}

export async function upsertDebugParameterNodeBinding(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string | null;
    parameterId: string;
    protocol: DebugConnectionProtocol;
    nodePath: string;
    accessMode: DebugAccessMode;
    enabled: boolean;
    notes?: string | null;
  }
): Promise<DebugParameterNodeBindingRecord | null> {
  const result = await db.query<DebugParameterNodeBindingRow>(
    `
    insert into debugging_parameter_node_bindings (
      id,
      organization_id,
      project_id,
      parameter_id,
      protocol,
      node_path,
      access_mode,
      enabled,
      notes
    )
    select
      $1,
      p.organization_id,
      p.project_id,
      p.id,
      $5,
      $6,
      $7,
      $8,
      $9
    from debugging_parameters p
    where p.id = $4
      and p.organization_id = $2
      and ($3::text is null or p.project_id is null or p.project_id = $3)
    on conflict (parameter_id, protocol) do update
    set node_path = excluded.node_path,
      access_mode = excluded.access_mode,
      enabled = excluded.enabled,
      notes = excluded.notes,
      project_id = excluded.project_id,
      updated_at = now()
    where debugging_parameter_node_bindings.organization_id = excluded.organization_id
    returning ${debugParameterNodeBindingColumns}
    `,
    [
      randomUUID(),
      input.organizationId,
      input.projectId,
      input.parameterId,
      input.protocol,
      input.nodePath,
      input.accessMode,
      input.enabled,
      input.notes ?? null
    ]
  );

  return result.rows[0] ? toDebugParameterNodeBindingRecord(result.rows[0]) : null;
}

export async function archiveDebugParameterNodeBinding(
  db: Queryable,
  input: { organizationId: string; parameterId: string; protocol: DebugConnectionProtocol }
): Promise<DebugParameterNodeBindingRecord | null> {
  const result = await db.query<DebugParameterNodeBindingRow>(
    `
    update debugging_parameter_node_bindings
    set enabled = false,
      updated_at = now()
    where organization_id = $1
      and parameter_id = $2
      and protocol = $3
    returning ${debugParameterNodeBindingColumns}
    `,
    [input.organizationId, input.parameterId, input.protocol]
  );

  return result.rows[0] ? toDebugParameterNodeBindingRecord(result.rows[0]) : null;
}

export async function getDefaultAdbSmokeParameterNodeBinding(
  db: Queryable,
  input: { organizationId: string; includeDisabled?: boolean }
): Promise<DebugParameterNodeBindingRecord | null> {
  const result = await db.query<DebugParameterNodeBindingRow>(
    `
    select ${debugParameterNodeBindingColumns}
    from debugging_parameter_node_bindings
    where organization_id = $1
      and project_id is null
      and protocol = 'adb'
      and is_smoke_default = true
      ${input.includeDisabled ? "" : "and enabled = true"}
    order by id asc
    limit 1
    `,
    [input.organizationId]
  );

  return result.rows[0] ? toDebugParameterNodeBindingRecord(result.rows[0]) : null;
}

export async function getDebugSession(
  db: Queryable,
  input: { organizationId: string; sessionId: string }
): Promise<DebugSessionRecord | null> {
  const result = await db.query<DebugSessionRow>(
    `
    select id, organization_id, project_id, device_id, target_id, protocol, actor_user_id, status, started_at, ended_at
    from debugging_sessions
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [input.organizationId, input.sessionId]
  );

  return result.rows[0] ? toDebugSessionRecord(result.rows[0]) : null;
}

export async function getDebugTarget(
  db: Queryable,
  input: { organizationId: string; targetId: string }
): Promise<DebugTargetRecord | null> {
  const result = await db.query<DebugTargetRow>(
    `
    select id, organization_id, project_id, device_id, protocol, target_ref, label, status, detected_at
    from debugging_targets
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [input.organizationId, input.targetId]
  );

  return result.rows[0] ? toDebugTargetRecord(result.rows[0]) : null;
}

export async function getDebugSnapshot(
  db: Queryable,
  input: { organizationId: string; snapshotId: string }
): Promise<DebugSnapshotRecord | null> {
  const result = await db.query<DebugSnapshotRow>(
    `
    select id, organization_id, project_id, session_id, operation_id, status, risk, entries, created_at
    from debugging_snapshots
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [input.organizationId, input.snapshotId]
  );

  return result.rows[0] ? toDebugSnapshotRecord(result.rows[0]) : null;
}

export async function listDebugSessionEvents(
  db: Queryable,
  input: { organizationId: string; sessionId: string }
): Promise<NodeOperationRecord[]> {
  const result = await db.query<NodeOperationRow>(
    `
    select ${nodeOperationColumns}
    from node_operations
    where organization_id = $1
      and session_id = $2
    order by created_at asc, id asc
    `,
    [input.organizationId, input.sessionId]
  );

  return result.rows.map(toNodeOperationRecord);
}

export async function upsertDetectedTargets(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    deviceId: string;
    targets: Array<{ id: string; protocol?: DebugConnectionProtocol; targetRef: string; label: string; online: boolean }>;
  }
): Promise<DebugTargetRecord[]> {
  const records: DebugTargetRecord[] = [];

  for (const target of input.targets) {
    const status: DebugTargetStatus = target.online ? "detected" : "lost";
    const result = await db.query<DebugTargetRow>(
      `
      insert into debugging_targets (
        organization_id, project_id, device_id, id, protocol, target_ref, label, status
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (device_id, protocol, target_ref) do update
      set label = excluded.label,
        status = excluded.status,
        detected_at = now()
      returning id, organization_id, project_id, device_id, protocol, target_ref, label, status, detected_at
      `,
      [
        input.organizationId,
        input.projectId,
        input.deviceId,
        target.id,
        target.protocol ?? defaultDebugConnectionProtocol,
        target.targetRef,
        target.label,
        status
      ]
    );

    if (result.rows[0]) {
      records.push(toDebugTargetRecord(result.rows[0]));
    }
  }

  const deviceStatus: DebugDeviceStatus = input.targets.some((target) => target.online) ? "online" : "offline";
  await db.query(
    `
    update debugging_devices
    set status = $3,
      last_seen_at = now(),
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.deviceId, deviceStatus]
  );

  return records;
}

export async function createDebugSession(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    deviceId: string;
    targetId: string;
    protocol?: DebugConnectionProtocol;
    actorUserId: string;
  }
): Promise<DebugSessionRecord> {
  const result = await db.query<DebugSessionRow>(
    `
    insert into debugging_sessions (
      id, organization_id, project_id, device_id, target_id, protocol, actor_user_id, status
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    returning id, organization_id, project_id, device_id, target_id, protocol, actor_user_id, status, started_at, ended_at
    `,
    [
      randomUUID(),
      input.organizationId,
      input.projectId,
      input.deviceId,
      input.targetId,
      input.protocol ?? defaultDebugConnectionProtocol,
      input.actorUserId,
      "active"
    ]
  );

  return toDebugSessionRecord(result.rows[0]);
}

export async function acquireDebugDeviceLease(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    deviceId: string;
    sessionId: string;
    actorUserId: string;
    leaseTtlMs: number;
  }
): Promise<DebugDeviceLeaseRecord | null> {
  const result = await db.query<DebugDeviceLeaseRow>(
    `
    insert into debug_device_leases (
      organization_id, project_id, device_id, session_id, lease_owner_user_id, expires_at
    )
    values ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'))
    on conflict (organization_id, project_id, device_id) do update
    set session_id = excluded.session_id,
      lease_owner_user_id = excluded.lease_owner_user_id,
      expires_at = excluded.expires_at,
      acquired_at = case
        when debug_device_leases.session_id = excluded.session_id then debug_device_leases.acquired_at
        else now()
      end,
      updated_at = now()
    where debug_device_leases.session_id = excluded.session_id
      or debug_device_leases.expires_at <= now()
    returning organization_id, project_id, device_id, session_id, lease_owner_user_id, expires_at, acquired_at, updated_at
    `,
    [input.organizationId, input.projectId, input.deviceId, input.sessionId, input.actorUserId, input.leaseTtlMs]
  );

  return result.rows[0] ? toDebugDeviceLeaseRecord(result.rows[0]) : null;
}

export async function releaseDebugDeviceLease(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    deviceId: string;
    sessionId: string;
  }
): Promise<DebugDeviceLeaseRecord | null> {
  const result = await db.query<DebugDeviceLeaseRow>(
    `
    update debug_device_leases
    set expires_at = now(),
      updated_at = now()
    where organization_id = $1
      and project_id = $2
      and device_id = $3
      and session_id = $4
    returning organization_id, project_id, device_id, session_id, lease_owner_user_id, expires_at, acquired_at, updated_at
    `,
    [input.organizationId, input.projectId, input.deviceId, input.sessionId]
  );

  return result.rows[0] ? toDebugDeviceLeaseRecord(result.rows[0]) : null;
}

export async function insertNodeOperation(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    sessionId: string;
    parameterId: string | null;
    protocol?: DebugConnectionProtocol;
    nodePath: string;
    operationType: DebugOperationType;
    status: DebugOperationStatus;
    requestedValue?: string;
    previousValue?: string;
    readValue?: string;
    readbackValue?: string;
    verified?: boolean;
    failureReason?: string;
    durationMs: number;
    approvalId?: string;
    snapshotId?: string;
    actorUserId: string;
  }
): Promise<NodeOperationRecord> {
  const result = await db.query<NodeOperationRow>(
    `
    insert into node_operations (
      id, organization_id, project_id, session_id, parameter_id, protocol, node_path, operation_type,
      status, requested_value, previous_value, read_value, readback_value, verified,
      failure_reason, duration_ms, approval_id, snapshot_id, actor_user_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    returning ${nodeOperationColumns}
    `,
    [
      randomUUID(),
      input.organizationId,
      input.projectId,
      input.sessionId,
      input.parameterId,
      input.protocol ?? defaultDebugConnectionProtocol,
      input.nodePath,
      input.operationType,
      input.status,
      input.requestedValue ?? null,
      input.previousValue ?? null,
      input.readValue ?? null,
      input.readbackValue ?? null,
      input.verified ?? false,
      input.failureReason ?? null,
      input.durationMs,
      input.approvalId ?? null,
      input.snapshotId ?? null,
      input.actorUserId
    ]
  );

  return toNodeOperationRecord(result.rows[0]);
}

export async function createDebugSnapshot(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    sessionId: string;
    operationId?: string | null;
    risk: DebugRiskLevel;
    entries: DebugSnapshotEntry[];
    createdByUserId: string;
  }
): Promise<DebugSnapshotRecord> {
  const result = await db.query<DebugSnapshotRow>(
    `
    insert into debugging_snapshots (
      id, organization_id, project_id, session_id, operation_id, status, risk, entries, created_by_user_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
    returning id, organization_id, project_id, session_id, operation_id, status, risk, entries, created_at
    `,
    [
      randomUUID(),
      input.organizationId,
      input.projectId,
      input.sessionId,
      input.operationId ?? null,
      "valid",
      input.risk,
      JSON.stringify(input.entries),
      input.createdByUserId
    ]
  );

  return toDebugSnapshotRecord(result.rows[0]);
}

export async function linkOperationSnapshot(
  db: Queryable,
  input: { organizationId: string; operationId: string; snapshotId: string }
): Promise<void> {
  await db.query(
    `
    update node_operations
    set snapshot_id = $3
    from debugging_snapshots
    where node_operations.id = $2
      and debugging_snapshots.id = $3
      and node_operations.organization_id = $1
      and debugging_snapshots.organization_id = $1
      and node_operations.project_id = debugging_snapshots.project_id
      and node_operations.session_id = debugging_snapshots.session_id
    `,
    [input.organizationId, input.operationId, input.snapshotId]
  );
}

export async function markSnapshotConsumed(
  db: Queryable,
  input: { organizationId: string; snapshotId: string }
): Promise<DebugSnapshotRecord | null> {
  const result = await db.query<DebugSnapshotRow>(
    `
    update debugging_snapshots
    set status = 'consumed',
      consumed_at = now()
    where organization_id = $1
      and id = $2
      and status in ('valid', 'rollback_pending')
    returning id, organization_id, project_id, session_id, operation_id, status, risk, entries, created_at
    `,
    [input.organizationId, input.snapshotId]
  );

  return result.rows[0] ? toDebugSnapshotRecord(result.rows[0]) : null;
}

export async function claimSnapshotForRollback(
  db: Queryable,
  input: { organizationId: string; snapshotId: string }
): Promise<DebugSnapshotRecord | null> {
  const result = await db.query<DebugSnapshotRow>(
    `
    update debugging_snapshots
    set status = 'rollback_pending'
    where organization_id = $1
      and id = $2
      and status = 'valid'
    returning id, organization_id, project_id, session_id, operation_id, status, risk, entries, created_at
    `,
    [input.organizationId, input.snapshotId]
  );

  return result.rows[0] ? toDebugSnapshotRecord(result.rows[0]) : null;
}

export async function restoreSnapshotValid(
  db: Queryable,
  input: { organizationId: string; snapshotId: string }
): Promise<DebugSnapshotRecord | null> {
  const result = await db.query<DebugSnapshotRow>(
    `
    update debugging_snapshots
    set status = 'valid'
    where organization_id = $1
      and id = $2
      and status = 'rollback_pending'
    returning id, organization_id, project_id, session_id, operation_id, status, risk, entries, created_at
    `,
    [input.organizationId, input.snapshotId]
  );

  return result.rows[0] ? toDebugSnapshotRecord(result.rows[0]) : null;
}

export async function insertDebugEvent(
  db: Queryable,
  input: {
    id?: string;
    organizationId: string;
    projectId: string;
    sessionId?: string;
    operationId?: string;
    kind: string;
    severity: string;
    message: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `
    insert into debugging_events (
      id, organization_id, project_id, session_id, operation_id, kind, severity, message, metadata
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    [
      input.id ?? randomUUID(),
      input.organizationId,
      input.projectId,
      input.sessionId ?? null,
      input.operationId ?? null,
      input.kind,
      input.severity,
      input.message,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}
