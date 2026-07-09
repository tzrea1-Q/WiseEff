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
  DebugValueKind
} from "./types";
import {
  DEBUG_NORMALIZATION_MODE_TRIM,
  DEBUG_VALUE_FORMAT_RAW,
  DEBUG_VALUE_KIND_SCALAR
} from "./types";
import {
  buildDebugNodeModuleSubtreeFilter,
  createDebugNodeModule as createDebugNodeModuleRecord,
  deleteDebugNodeModuleById,
  getDebugNodeModuleByName,
  listDebugNodeModules as listDebugNodeModuleRecords,
  updateDebugNodeModule as updateDebugNodeModuleRecord
} from "./debugNodeModuleRepository";

type DebugNodeRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  detailed_description: string;
  write_format_example: string;
  write_format_hint: string;
  module: string;
  debug_node_module_id: string | null;
  module_path: string | null;
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
  node_id: string;
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

function parseModulePathNames(modulePath: string | null | undefined): string[] | undefined {
  if (!modulePath) {
    return undefined;
  }
  const trimmed = modulePath.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.split("/").filter(Boolean);
}

function toDebugNodeRecord(row: DebugNodeRow): DebugNodeRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    detailedDescription: row.detailed_description,
    writeFormatExample: row.write_format_example,
    writeFormatHint: row.write_format_hint,
    module: row.module,
    moduleId: row.debug_node_module_id ?? undefined,
    modulePath: parseModulePathNames(row.module_path),
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

const debugNodeColumns = `
  n.id,
  n.organization_id,
  n.name,
  n.description,
  n.detailed_description,
  n.write_format_example,
  n.write_format_hint,
  n.module,
  n.debug_node_module_id,
  (
    select string_agg(dm_seg.name, '/' order by dm_seg.depth)
    from debug_node_modules dm_seg
    where dm_seg.organization_id = n.organization_id
      and dm_seg.id = any(string_to_array(coalesce(dm.path, ''), '/'))
  ) as module_path,
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
  node_id,
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
  input: {
    organizationId: string;
    includeArchived?: boolean;
    module?: string;
    moduleId?: string;
    includeDescendants?: boolean;
  }
): Promise<DebugNodeRecord[]> {
  const conditions = ["n.organization_id = $1"];
  const values: unknown[] = [input.organizationId];

  if (!input.includeArchived) {
    conditions.push("n.archived_at is null");
  }

  if (input.module) {
    values.push(input.module);
    conditions.push(`n.module = $${values.length}`);
  }

  if (input.moduleId) {
    conditions.push(
      buildDebugNodeModuleSubtreeFilter(values, input.moduleId, input.includeDescendants !== false)
    );
  }

  const result = await db.query<DebugNodeRow>(
    `
    select ${debugNodeColumns}
    from debug_nodes n
    left join debug_node_modules dm on dm.id = n.debug_node_module_id and dm.organization_id = n.organization_id
    where ${conditions.join(" and ")}
    order by n.name asc
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
    select ${debugNodeColumns}
    from debug_nodes n
    left join debug_node_modules dm on dm.id = n.debug_node_module_id and dm.organization_id = n.organization_id
    where n.organization_id = $1
      and n.id = $2
      ${input.includeArchived ? "" : "and n.archived_at is null"}
    limit 1
    `,
    [input.organizationId, input.nodeId]
  );

  return result.rows[0] ? toDebugNodeRecord(result.rows[0]) : null;
}

export async function listRuntimeDebugNodes(
  db: Queryable,
  input: {
    organizationId: string;
    protocol?: DebugConnectionProtocol;
    moduleId?: string;
    includeDescendants?: boolean;
  }
): Promise<DebugRuntimeNodeRecord[]> {
  const conditions = [
    "n.organization_id = $1",
    "n.enabled = true",
    "n.archived_at is null",
    "b.enabled = true",
    "b.organization_id = n.organization_id"
  ];
  const values: unknown[] = [input.organizationId];
  let index = 2;

  if (input.protocol) {
    conditions.push(`b.protocol = $${index}`);
    values.push(input.protocol);
    index += 1;
  }

  if (input.moduleId) {
    conditions.push(
      buildDebugNodeModuleSubtreeFilter(values, input.moduleId, input.includeDescendants !== false)
    );
  }

  const result = await db.query<DebugRuntimeNodeRow>(
    `
    select ${debugRuntimeNodeColumns}
    from debug_nodes n
    inner join debug_node_bindings b on b.node_id = n.id
    left join debug_node_modules dm on dm.id = n.debug_node_module_id and dm.organization_id = n.organization_id
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
    name: string;
    description?: string;
    detailedDescription?: string;
    writeFormatExample?: string;
    writeFormatHint?: string;
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
      id, organization_id, name, description, detailed_description,
      write_format_example, write_format_hint, module,
      value_kind, value_format, normalization_mode, max_value_bytes, enabled
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    returning ${debugNodeOnlyColumns}
    `,
    [
      randomUUID(),
      input.organizationId,
      input.name,
      input.description ?? "",
      input.detailedDescription ?? "",
      input.writeFormatExample ?? "",
      input.writeFormatHint ?? "",
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
    writeFormatExample?: string;
    writeFormatHint?: string;
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
      write_format_example = coalesce($6, write_format_example),
      write_format_hint = coalesce($7, write_format_hint),
      module = coalesce($8, module),
      value_kind = coalesce($9, value_kind),
      value_format = coalesce($10, value_format),
      normalization_mode = coalesce($11, normalization_mode),
      max_value_bytes = coalesce($12, max_value_bytes),
      enabled = coalesce($13, enabled),
      archived_at = coalesce($14, archived_at),
      archived_by = coalesce($15, archived_by),
      archive_reason = coalesce($16, archive_reason),
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
      input.writeFormatExample ?? null,
      input.writeFormatHint ?? null,
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
      n.id,
      $4,
      $5,
      $6,
      $7,
      $8
    from debug_nodes n
    where n.id = $3
      and n.organization_id = $2
    on conflict (node_id, protocol) do update
    set node_path = excluded.node_path,
      access_mode = excluded.access_mode,
      enabled = excluded.enabled,
      notes = excluded.notes,
      updated_at = now()
    where debug_node_bindings.organization_id = excluded.organization_id
    returning ${debugNodeBindingColumns}
    `,
    [
      debugNodeBindingId(input.nodeId, input.protocol),
      input.organizationId,
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

export async function listDebugNodeModules(db: Queryable, input: { organizationId: string }) {
  return listDebugNodeModuleRecords(db, input);
}

export async function getDebugNodeModule(db: Queryable, input: { organizationId: string; name: string }) {
  return getDebugNodeModuleByName(db, { organizationId: input.organizationId, name: input.name });
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
    scope?: string;
    parentId?: string | null;
  }
) {
  return createDebugNodeModuleRecord(db, input);
}

export async function updateDebugNodeModule(
  db: Queryable,
  input: {
    organizationId: string;
    moduleName: string;
    name?: string;
    description?: string;
    scope?: string;
  }
) {
  const current = await getDebugNodeModuleByName(db, {
    organizationId: input.organizationId,
    name: input.moduleName
  });
  if (!current) {
    return null;
  }

  return updateDebugNodeModuleRecord(db, {
    organizationId: input.organizationId,
    moduleId: current.id,
    name: input.name,
    description: input.description,
    scope: input.scope
  });
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
  const current = await getDebugNodeModuleByName(db, {
    organizationId: input.organizationId,
    name: input.moduleName
  });
  if (!current) {
    return false;
  }

  return deleteDebugNodeModuleById(db, {
    organizationId: input.organizationId,
    moduleId: current.id
  });
}

export {
  countDebugNodesForModuleId,
  deleteDebugNodeModuleById,
  getDebugNodeModuleById,
  getDebugNodeModuleByName,
  moveDebugNodeModule
} from "./debugNodeModuleRepository";
