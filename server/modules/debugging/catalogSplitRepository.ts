import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import type { DebugConnectionProtocol } from "./protocol";
import type { DebugAccessMode } from "./status";
import type {
  DebugNodeBindingRecord,
  DebugNodeRecord,
  DebugNormalizationMode,
  DebugRuntimeNodeRecord,
  DebugValueFormat,
  DebugValueKind,
  ParameterReloadBindingRecord,
  ParameterReloadTargetRecord
} from "./types";
import {
  DEBUG_NORMALIZATION_MODE_TRIM,
  DEBUG_VALUE_FORMAT_RAW,
  DEBUG_VALUE_KIND_SCALAR
} from "./types";

type DebugNodeRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  name: string;
  description: string;
  detailed_description: string;
  module: string;
  value_kind: DebugValueKind;
  value_format: DebugValueFormat;
  normalization_mode: DebugNormalizationMode;
  max_value_bytes: number | string | null;
  enabled: boolean;
  archived_at: string | Date | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type DebugRuntimeNodeRow = DebugNodeRow & {
  protocol: DebugConnectionProtocol;
  node_path: string;
  access_mode: DebugAccessMode;
};

type DebugNodeBindingRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  node_id: string;
  protocol: DebugConnectionProtocol;
  node_path: string;
  access_mode: DebugAccessMode;
  enabled: boolean;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type ParameterReloadBindingRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  parameter_definition_id: string;
  protocol: DebugConnectionProtocol;
  node_path: string;
  access_mode: DebugAccessMode;
  enabled: boolean;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function dateTimeToIso(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function debugNodeBindingId(nodeId: string, protocol: DebugConnectionProtocol) {
  return `${nodeId}:${protocol}`;
}

function toDebugNodeRecord(row: DebugNodeRow): DebugNodeRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    detailedDescription: row.detailed_description,
    module: row.module,
    valueKind: row.value_kind,
    valueFormat: row.value_format,
    normalizationMode: row.normalization_mode,
    maxValueBytes: row.max_value_bytes === null || row.max_value_bytes === undefined ? null : Number(row.max_value_bytes),
    enabled: row.enabled,
    archivedAt: dateTimeToIso(row.archived_at),
    archivedBy: row.archived_by,
    archiveReason: row.archive_reason,
    createdAt: dateTimeToIso(row.created_at) ?? "",
    updatedAt: dateTimeToIso(row.updated_at) ?? ""
  };
}

function toDebugRuntimeNodeRecord(row: DebugRuntimeNodeRow): DebugRuntimeNodeRecord {
  return {
    ...toDebugNodeRecord(row),
    protocol: row.protocol,
    nodePath: row.node_path,
    accessMode: row.access_mode
  };
}

function toDebugNodeBindingRecord(row: DebugNodeBindingRow): DebugNodeBindingRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    nodeId: row.node_id,
    protocol: row.protocol,
    nodePath: row.node_path,
    accessMode: row.access_mode,
    enabled: row.enabled,
    notes: row.notes,
    createdAt: dateTimeToIso(row.created_at) ?? "",
    updatedAt: dateTimeToIso(row.updated_at) ?? ""
  };
}

function toParameterReloadBindingRecord(row: ParameterReloadBindingRow): ParameterReloadBindingRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    parameterDefinitionId: row.parameter_definition_id,
    protocol: row.protocol,
    nodePath: row.node_path,
    accessMode: row.access_mode,
    enabled: row.enabled,
    notes: row.notes,
    createdAt: dateTimeToIso(row.created_at) ?? "",
    updatedAt: dateTimeToIso(row.updated_at) ?? ""
  };
}

const debugNodeColumns = `
  n.id,
  n.organization_id,
  n.project_id,
  n.name,
  n.description,
  n.detailed_description,
  n.module,
  n.value_kind,
  n.value_format,
  n.normalization_mode,
  n.max_value_bytes,
  n.enabled,
  n.archived_at,
  n.archived_by,
  n.archive_reason,
  n.created_at,
  n.updated_at
`;

const debugNodeOnlyColumns = debugNodeColumns.replace(/\bn\./g, "");

const debugRuntimeNodeColumns = `
  ${debugNodeColumns},
  b.protocol,
  b.node_path,
  b.access_mode
`;

const debugNodeBindingColumns = `
  id,
  organization_id,
  project_id,
  node_id,
  protocol,
  node_path,
  access_mode,
  enabled,
  notes,
  created_at,
  updated_at
`;

const reloadBindingColumns = `
  id,
  organization_id,
  project_id,
  parameter_definition_id,
  protocol,
  node_path,
  access_mode,
  enabled,
  notes,
  created_at,
  updated_at
`;

export async function listDebugNodes(
  db: Queryable,
  input: { organizationId: string; projectId?: string; includeArchived?: boolean }
): Promise<DebugNodeRecord[]> {
  const conditions = ["organization_id = $1"];
  const values: unknown[] = [input.organizationId];
  let index = 2;

  if (input.projectId) {
    conditions.push(`(project_id is null or project_id = $${index})`);
    values.push(input.projectId);
    index += 1;
  }
  if (!input.includeArchived) {
    conditions.push("archived_at is null");
  }

  const result = await db.query<DebugNodeRow>(
    `
    select ${debugNodeOnlyColumns}
    from debug_nodes
    where ${conditions.join(" and ")}
    order by name asc
    `,
    values
  );

  return result.rows.map(toDebugNodeRecord);
}

export async function getDebugNode(
  db: Queryable,
  input: { organizationId: string; nodeId: string; includeArchived?: boolean }
): Promise<DebugNodeRecord | null> {
  const result = await db.query<DebugNodeRow>(
    `
    select ${debugNodeOnlyColumns}
    from debug_nodes
    where organization_id = $1
      and id = $2
      ${input.includeArchived ? "" : "and archived_at is null"}
    limit 1
    `,
    [input.organizationId, input.nodeId]
  );

  return result.rows[0] ? toDebugNodeRecord(result.rows[0]) : null;
}

export async function listRuntimeDebugNodes(
  db: Queryable,
  input: { organizationId: string; projectId: string; protocol?: DebugConnectionProtocol }
): Promise<DebugRuntimeNodeRecord[]> {
  const conditions = [
    "n.organization_id = $1",
    "n.enabled = true",
    "n.archived_at is null",
    "(n.project_id is null or n.project_id = $2)",
    "b.enabled = true",
    "b.organization_id = n.organization_id"
  ];
  const values: unknown[] = [input.organizationId, input.projectId];
  let index = 3;

  if (input.protocol) {
    conditions.push(`b.protocol = $${index}`);
    values.push(input.protocol);
  }

  const result = await db.query<DebugRuntimeNodeRow>(
    `
    select ${debugRuntimeNodeColumns}
    from debug_nodes n
    inner join debug_node_bindings b on b.node_id = n.id
    where ${conditions.join(" and ")}
    order by n.name asc
    `,
    values
  );

  return result.rows.map(toDebugRuntimeNodeRecord);
}

export async function createDebugNode(
  db: Queryable,
  input: {
    organizationId: string;
    projectId?: string | null;
    name: string;
    description?: string;
    detailedDescription?: string;
    module?: string;
    valueKind?: DebugValueKind;
    valueFormat?: DebugValueFormat;
    normalizationMode?: DebugNormalizationMode;
    maxValueBytes?: number | null;
    enabled?: boolean;
  }
): Promise<DebugNodeRecord> {
  const result = await db.query<DebugNodeRow>(
    `
    insert into debug_nodes (
      id, organization_id, project_id, name, description, detailed_description, module,
      value_kind, value_format, normalization_mode, max_value_bytes, enabled
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    returning ${debugNodeOnlyColumns}
    `,
    [
      randomUUID(),
      input.organizationId,
      input.projectId ?? null,
      input.name,
      input.description ?? "",
      input.detailedDescription ?? "",
      input.module ?? "",
      input.valueKind ?? DEBUG_VALUE_KIND_SCALAR,
      input.valueFormat ?? DEBUG_VALUE_FORMAT_RAW,
      input.normalizationMode ?? DEBUG_NORMALIZATION_MODE_TRIM,
      input.maxValueBytes ?? null,
      input.enabled ?? true
    ]
  );

  return toDebugNodeRecord(result.rows[0]);
}

export async function updateDebugNode(
  db: Queryable,
  input: {
    organizationId: string;
    nodeId: string;
    name?: string;
    description?: string;
    detailedDescription?: string;
    module?: string;
    valueKind?: DebugValueKind;
    valueFormat?: DebugValueFormat;
    normalizationMode?: DebugNormalizationMode;
    maxValueBytes?: number | null;
    enabled?: boolean;
    archivedAt?: string | null;
    archivedBy?: string | null;
    archiveReason?: string | null;
  }
): Promise<DebugNodeRecord | null> {
  const result = await db.query<DebugNodeRow>(
    `
    update debug_nodes
    set
      name = coalesce($3, name),
      description = coalesce($4, description),
      detailed_description = coalesce($5, detailed_description),
      module = coalesce($6, module),
      value_kind = coalesce($7, value_kind),
      value_format = coalesce($8, value_format),
      normalization_mode = coalesce($9, normalization_mode),
      max_value_bytes = coalesce($10, max_value_bytes),
      enabled = coalesce($11, enabled),
      archived_at = coalesce($12, archived_at),
      archived_by = coalesce($13, archived_by),
      archive_reason = coalesce($14, archive_reason),
      updated_at = now()
    where organization_id = $1 and id = $2
    returning ${debugNodeOnlyColumns}
    `,
    [
      input.organizationId,
      input.nodeId,
      input.name ?? null,
      input.description ?? null,
      input.detailedDescription ?? null,
      input.module ?? null,
      input.valueKind ?? null,
      input.valueFormat ?? null,
      input.normalizationMode ?? null,
      input.maxValueBytes ?? null,
      input.enabled ?? null,
      input.archivedAt ?? null,
      input.archivedBy ?? null,
      input.archiveReason ?? null
    ]
  );

  return result.rows[0] ? toDebugNodeRecord(result.rows[0]) : null;
}

export async function listDebugNodeBindings(
  db: Queryable,
  input: { organizationId: string; nodeId: string }
): Promise<DebugNodeBindingRecord[]> {
  const result = await db.query<DebugNodeBindingRow>(
    `
    select ${debugNodeBindingColumns}
    from debug_node_bindings
    where organization_id = $1
      and node_id = $2
    order by protocol asc
    `,
    [input.organizationId, input.nodeId]
  );

  return result.rows.map(toDebugNodeBindingRecord);
}

export async function getDebugNodeBinding(
  db: Queryable,
  input: {
    organizationId: string;
    nodeId: string;
    protocol: DebugConnectionProtocol;
    includeDisabled?: boolean;
  }
): Promise<DebugNodeBindingRecord | null> {
  const result = await db.query<DebugNodeBindingRow>(
    `
    select ${debugNodeBindingColumns}
    from debug_node_bindings
    where organization_id = $1
      and node_id = $2
      and protocol = $3
      ${input.includeDisabled ? "" : "and enabled = true"}
    limit 1
    `,
    [input.organizationId, input.nodeId, input.protocol]
  );

  return result.rows[0] ? toDebugNodeBindingRecord(result.rows[0]) : null;
}

export async function upsertDebugNodeBinding(
  db: Queryable,
  input: {
    organizationId: string;
    projectId?: string | null;
    nodeId: string;
    protocol: DebugConnectionProtocol;
    nodePath: string;
    accessMode?: DebugAccessMode;
    enabled?: boolean;
    notes?: string | null;
  }
): Promise<DebugNodeBindingRecord | null> {
  const result = await db.query<DebugNodeBindingRow>(
    `
    insert into debug_node_bindings (
      id,
      organization_id,
      project_id,
      node_id,
      protocol,
      node_path,
      access_mode,
      enabled,
      notes
    )
    select
      $1,
      n.organization_id,
      coalesce($3, n.project_id),
      n.id,
      $5,
      $6,
      $7,
      $8,
      $9
    from debug_nodes n
    where n.id = $4
      and n.organization_id = $2
    on conflict (node_id, protocol) do update
    set node_path = excluded.node_path,
      access_mode = excluded.access_mode,
      enabled = excluded.enabled,
      notes = excluded.notes,
      project_id = excluded.project_id,
      updated_at = now()
    where debug_node_bindings.organization_id = excluded.organization_id
    returning ${debugNodeBindingColumns}
    `,
    [
      debugNodeBindingId(input.nodeId, input.protocol),
      input.organizationId,
      input.projectId ?? null,
      input.nodeId,
      input.protocol,
      input.nodePath,
      input.accessMode ?? "RW",
      input.enabled ?? true,
      input.notes ?? null
    ]
  );

  return result.rows[0] ? toDebugNodeBindingRecord(result.rows[0]) : null;
}

export async function archiveDebugNodeBinding(
  db: Queryable,
  input: { organizationId: string; nodeId: string; protocol: DebugConnectionProtocol }
): Promise<DebugNodeBindingRecord | null> {
  const result = await db.query<DebugNodeBindingRow>(
    `
    update debug_node_bindings
    set enabled = false,
      updated_at = now()
    where organization_id = $1
      and node_id = $2
      and protocol = $3
    returning ${debugNodeBindingColumns}
    `,
    [input.organizationId, input.nodeId, input.protocol]
  );

  return result.rows[0] ? toDebugNodeBindingRecord(result.rows[0]) : null;
}

export async function getParameterReloadBinding(
  db: Queryable,
  input: { organizationId: string; parameterDefinitionId: string; protocol: DebugConnectionProtocol }
): Promise<ParameterReloadBindingRecord | null> {
  const result = await db.query<ParameterReloadBindingRow>(
    `
    select ${reloadBindingColumns}
    from parameter_reload_bindings
    where organization_id = $1
      and parameter_definition_id = $2
      and protocol = $3
      and enabled = true
    limit 1
    `,
    [input.organizationId, input.parameterDefinitionId, input.protocol]
  );

  return result.rows[0] ? toParameterReloadBindingRecord(result.rows[0]) : null;
}

export async function upsertParameterReloadBinding(
  db: Queryable,
  input: {
    organizationId: string;
    projectId?: string | null;
    parameterDefinitionId: string;
    protocol: DebugConnectionProtocol;
    nodePath: string;
    accessMode?: DebugAccessMode;
    enabled?: boolean;
    notes?: string | null;
  }
): Promise<ParameterReloadBindingRecord> {
  const result = await db.query<ParameterReloadBindingRow>(
    `
    insert into parameter_reload_bindings (
      id, organization_id, project_id, parameter_definition_id, protocol, node_path, access_mode, enabled, notes
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    on conflict (parameter_definition_id, protocol)
    do update set
      project_id = excluded.project_id,
      node_path = excluded.node_path,
      access_mode = excluded.access_mode,
      enabled = excluded.enabled,
      notes = excluded.notes,
      updated_at = now()
    returning ${reloadBindingColumns}
    `,
    [
      randomUUID(),
      input.organizationId,
      input.projectId ?? null,
      input.parameterDefinitionId,
      input.protocol,
      input.nodePath,
      input.accessMode ?? "RW",
      input.enabled ?? true,
      input.notes ?? null
    ]
  );

  return toParameterReloadBindingRecord(result.rows[0]);
}

export async function listParameterReloadBindingsAdmin(
  db: Queryable,
  input: { organizationId: string; projectId?: string }
): Promise<Array<ParameterReloadBindingRecord & { parameterName: string; module: string; unit: string; risk: string }>> {
  const result = await db.query<
    ParameterReloadBindingRow & { parameter_name: string; module: string; unit: string; risk: string }
  >(
    `
    select
      b.id,
      b.organization_id,
      b.project_id,
      b.parameter_definition_id,
      b.protocol,
      b.node_path,
      b.access_mode,
      b.enabled,
      b.notes,
      b.created_at,
      b.updated_at,
      d.name as parameter_name,
      d.module,
      d.unit,
      d.risk
    from parameter_reload_bindings b
    inner join parameter_definitions d on d.id = b.parameter_definition_id
    where b.organization_id = $1
      ${input.projectId ? "and (b.project_id is null or b.project_id = $2)" : ""}
    order by d.name asc, b.protocol asc
    `,
    input.projectId ? [input.organizationId, input.projectId] : [input.organizationId]
  );

  return result.rows.map((row) => ({
    ...toParameterReloadBindingRecord(row),
    parameterName: row.parameter_name,
    module: row.module,
    unit: row.unit,
    risk: row.risk
  }));
}

export async function listParameterReloadTargets(
  db: Queryable,
  input: { organizationId: string; projectId: string; protocol: DebugConnectionProtocol }
): Promise<ParameterReloadTargetRecord[]> {
  const result = await db.query<{
    parameter_definition_id: string;
    name: string;
    module: string;
    unit: string;
    default_range: string;
    risk: string;
    current_value: string | null;
    recommended_value: string | null;
    binding_id: string | null;
    node_path: string | null;
    access_mode: DebugAccessMode | null;
    binding_enabled: boolean | null;
  }>(
    `
    select
      d.id as parameter_definition_id,
      d.name,
      d.module,
      d.unit,
      d.default_range,
      d.risk,
      v.current_value,
      v.recommended_value,
      b.id as binding_id,
      b.node_path,
      b.access_mode,
      b.enabled as binding_enabled
    from parameter_definitions d
    inner join project_parameter_values v
      on v.parameter_definition_id = d.id
      and v.project_id = $2
      and v.organization_id = $1
    left join parameter_reload_bindings b
      on b.parameter_definition_id = d.id
      and b.protocol = $3
      and b.organization_id = $1
      and (b.project_id is null or b.project_id = $2)
    where d.organization_id = $1
    order by d.module asc, d.name asc
    `,
    [input.organizationId, input.projectId, input.protocol]
  );

  return result.rows.map((row) => ({
    parameterDefinitionId: row.parameter_definition_id,
    name: row.name,
    module: row.module,
    unit: row.unit,
    range: row.default_range,
    risk: row.risk as ParameterReloadTargetRecord["risk"],
    currentValue: row.current_value ?? "",
    recommendedValue: row.recommended_value ?? "",
    binding: row.binding_id
      ? {
          id: row.binding_id,
          protocol: input.protocol,
          nodePath: row.node_path ?? "",
          accessMode: row.access_mode ?? "RW",
          enabled: row.binding_enabled ?? false
        }
      : null
  }));
}

export async function updateProjectParameterCurrentValue(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    parameterDefinitionId: string;
    currentValue: string;
    actorUserId: string;
  }
): Promise<boolean> {
  const result = await db.query(
    `
    update project_parameter_values
    set current_value = $4,
      value_version = value_version + 1,
      updated_by_user_id = $5,
      updated_at = now()
    where organization_id = $1
      and project_id = $2
      and parameter_definition_id = $3
    `,
    [input.organizationId, input.projectId, input.parameterDefinitionId, input.currentValue, input.actorUserId]
  );

  return (result.rowCount ?? 0) > 0;
}

type DebugNodeModuleRow = {
  name: string;
  description: string;
  owner: string;
  scope: string;
  created_at: string | Date;
  updated_at: string | Date;
};

function toDebugNodeModuleRecord(row: DebugNodeModuleRow) {
  return {
    name: row.name,
    description: row.description,
    owner: row.owner,
    scope: row.scope,
    createdAt: dateTimeToIso(row.created_at) ?? "",
    updatedAt: dateTimeToIso(row.updated_at) ?? ""
  };
}

export async function listDebugNodeModules(db: Queryable, input: { organizationId: string }) {
  const result = await db.query<DebugNodeModuleRow>(
    `
    select name, description, owner, scope, created_at, updated_at
    from debug_node_modules
    where organization_id = $1
    order by name asc
    `,
    [input.organizationId]
  );

  return result.rows.map(toDebugNodeModuleRecord);
}

export async function getDebugNodeModule(db: Queryable, input: { organizationId: string; name: string }) {
  const result = await db.query<DebugNodeModuleRow>(
    `
    select name, description, owner, scope, created_at, updated_at
    from debug_node_modules
    where organization_id = $1
      and name = $2
    limit 1
    `,
    [input.organizationId, input.name]
  );

  return result.rows[0] ? toDebugNodeModuleRecord(result.rows[0]) : null;
}

export async function countDebugNodesForModule(db: Queryable, input: { organizationId: string; moduleName: string }) {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from debug_nodes
    where organization_id = $1
      and module = $2
    `,
    [input.organizationId, input.moduleName]
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function createDebugNodeModule(
  db: Queryable,
  input: {
    organizationId: string;
    name: string;
    description?: string;
    owner?: string;
    scope?: string;
  }
) {
  const result = await db.query<DebugNodeModuleRow>(
    `
    insert into debug_node_modules (id, organization_id, name, description, owner, scope)
    values ($1, $2, $3, $4, $5, $6)
    returning name, description, owner, scope, created_at, updated_at
    `,
    [
      randomUUID(),
      input.organizationId,
      input.name,
      input.description ?? "",
      input.owner ?? "",
      input.scope ?? ""
    ]
  );

  return toDebugNodeModuleRecord(result.rows[0]);
}

export async function updateDebugNodeModule(
  db: Queryable,
  input: {
    organizationId: string;
    moduleName: string;
    name?: string;
    description?: string;
    owner?: string;
    scope?: string;
  }
) {
  const nextName = input.name?.trim();
  const result = await db.query<DebugNodeModuleRow>(
    `
    update debug_node_modules
    set
      name = coalesce($3, name),
      description = coalesce($4, description),
      owner = coalesce($5, owner),
      scope = coalesce($6, scope),
      updated_at = now()
    where organization_id = $1
      and name = $2
    returning name, description, owner, scope, created_at, updated_at
    `,
    [
      input.organizationId,
      input.moduleName,
      nextName ?? null,
      input.description ?? null,
      input.owner ?? null,
      input.scope ?? null
    ]
  );

  return result.rows[0] ? toDebugNodeModuleRecord(result.rows[0]) : null;
}

export async function renameDebugNodeModuleReferences(
  db: Queryable,
  input: { organizationId: string; fromModule: string; toModule: string }
) {
  await db.query(
    `
    update debug_nodes
    set module = $3,
      updated_at = now()
    where organization_id = $1
      and module = $2
    `,
    [input.organizationId, input.fromModule, input.toModule]
  );
}

export async function deleteDebugNodeModule(db: Queryable, input: { organizationId: string; moduleName: string }) {
  const result = await db.query(
    `
    delete from debug_node_modules
    where organization_id = $1
      and name = $2
    `,
    [input.organizationId, input.moduleName]
  );

  return (result.rowCount ?? 0) > 0;
}
