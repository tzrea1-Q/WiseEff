import { randomUUID } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import type {
  ConfigRevisionManifestMember,
  ConfigRevisionManifestState,
  ConfigRevisionStatus,
  DtsConfigRevisionDto,
  PersistedLogicalNodeRevision,
  PersistedNodeOccurrence,
  PersistedOccurrenceEffect,
  PersistedPropertyOccurrence,
  PersistedValidationDiagnostic,
} from "./types";

type RevisionRow = {
  id: string;
  organization_id: string;
  project_id: string;
  config_set_id: string;
  revision_number: number | string;
  status: ConfigRevisionStatus;
  entry_file: string | null;
  include_search_paths: unknown;
  overlay_order: unknown;
  manifest_state: ConfigRevisionManifestState;
  created_by_user_id: string | null;
  created_at: string | Date;
  resolved_at: string | Date | null;
};

function parseStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toRevisionDto(row: RevisionRow): DtsConfigRevisionDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    configSetId: row.config_set_id,
    revisionNumber: Number(row.revision_number),
    status: row.status,
    entryFile: row.entry_file ?? undefined,
    includeSearchPaths: parseStringArray(row.include_search_paths),
    overlayOrder: parseStringArray(row.overlay_order),
    manifestState: row.manifest_state ?? "complete",
    createdByUserId: row.created_by_user_id ?? undefined,
    createdAt: dateTimeToIso(row.created_at),
    resolvedAt: row.resolved_at ? dateTimeToIso(row.resolved_at) : undefined,
  };
}

export async function nextConfigRevisionNumber(db: Queryable, configSetId: string): Promise<number> {
  const result = await db.query<{ next: string }>(
    `
    select coalesce(max(revision_number), 0) + 1 as next
    from dts_config_revisions
    where config_set_id = $1
    `,
    [configSetId],
  );
  return Number(result.rows[0]?.next ?? 1);
}

export async function insertConfigRevision(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    configSetId: string;
    revisionNumber: number;
    status: ConfigRevisionStatus;
    createdByUserId?: string;
    entryFile?: string;
    includeSearchPaths?: string[];
    overlayOrder?: string[];
  },
): Promise<DtsConfigRevisionDto> {
  const result = await db.query<RevisionRow>(
    `
    insert into dts_config_revisions (
      id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id,
      entry_file, include_search_paths, overlay_order, manifest_state
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, 'complete')
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.configSetId,
      input.revisionNumber,
      input.status,
      input.createdByUserId ?? null,
      input.entryFile ?? null,
      JSON.stringify(input.includeSearchPaths ?? []),
      JSON.stringify(input.overlayOrder ?? []),
    ],
  );
  return toRevisionDto(result.rows[0]);
}

export async function updateConfigRevisionManifest(
  db: Queryable,
  input: {
    id: string;
    entryFile: string;
    includeSearchPaths: string[];
    overlayOrder: string[];
  },
): Promise<void> {
  await db.query(
    `
    update dts_config_revisions
    set entry_file = $2,
        include_search_paths = $3::jsonb,
        overlay_order = $4::jsonb
    where id = $1
    `,
    [
      input.id,
      input.entryFile,
      JSON.stringify(input.includeSearchPaths),
      JSON.stringify(input.overlayOrder),
    ],
  );
}

export async function updateConfigRevisionStatus(
  db: Queryable,
  input: { id: string; status: ConfigRevisionStatus; resolvedAt?: string | null },
): Promise<DtsConfigRevisionDto> {
  const result = await db.query<RevisionRow>(
    `
    update dts_config_revisions
    set status = $2,
        resolved_at = $3
    where id = $1
    returning *
    `,
    [input.id, input.status, input.resolvedAt ?? null],
  );
  return toRevisionDto(result.rows[0]);
}

export async function insertConfigRevisionMembers(
  db: Queryable,
  configRevisionId: string,
  members: ConfigRevisionManifestMember[],
): Promise<void> {
  for (const member of members) {
    await db.query(
      `
      insert into dts_config_revision_members (
        id, config_revision_id, file_id, file_version_id, role, sort_order
      ) values ($1, $2, $3, $4, $5, $6)
      `,
      [
        cryptoRandomId(),
        configRevisionId,
        member.fileId,
        member.fileVersionId,
        member.role,
        member.sortOrder,
      ],
    );
  }
}

export async function insertLogicalNode(
  db: Queryable,
  input: { id: string; organizationId: string; projectId: string; configSetId: string },
): Promise<void> {
  await db.query(
    `
    insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
    values ($1, $2, $3, $4)
    `,
    [input.id, input.organizationId, input.projectId, input.configSetId],
  );
}

export async function insertLogicalNodeRevision(
  db: Queryable,
  configRevisionId: string,
  revision: PersistedLogicalNodeRevision,
): Promise<void> {
  await db.query(
    `
    insert into dts_logical_node_revisions (
      id, logical_node_id, config_revision_id, node_locator, name, unit_address,
      compatible, driver_schema_version_id, parent_logical_node_id
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      revision.id,
      revision.logicalNodeId,
      configRevisionId,
      revision.nodeLocator,
      revision.name,
      revision.unitAddress ?? null,
      revision.compatible ?? null,
      revision.driverSchemaVersionId ?? null,
      revision.parentLogicalNodeId,
    ],
  );
}

export async function insertNodeOccurrence(
  db: Queryable,
  configRevisionId: string,
  occurrence: PersistedNodeOccurrence,
): Promise<void> {
  await db.query(
    `
    insert into dts_node_occurrences (
      id, config_revision_id, file_version_id, parent_occurrence_id, name, unit_address,
      labels, ref_target, is_overlay_root, node_path, start_offset, end_offset,
      start_line, start_column, end_line, end_column, raw_text, ast_json, source_order, content_hash
    ) values (
      $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20
    )
    `,
    [
      occurrence.id,
      configRevisionId,
      occurrence.fileVersionId,
      occurrence.parentOccurrenceId,
      occurrence.name,
      occurrence.unitAddress ?? null,
      JSON.stringify(occurrence.labels),
      occurrence.refTarget ?? null,
      occurrence.isOverlayRoot,
      occurrence.nodePath,
      occurrence.startOffset,
      occurrence.endOffset,
      occurrence.startLine,
      occurrence.startColumn,
      occurrence.endLine,
      occurrence.endColumn,
      occurrence.rawText,
      JSON.stringify(occurrence.astJson),
      occurrence.sourceOrder,
      occurrence.contentHash,
    ],
  );
}

export async function insertPropertyOccurrence(
  db: Queryable,
  configRevisionId: string,
  occurrence: PersistedPropertyOccurrence,
): Promise<void> {
  await db.query(
    `
    insert into dts_property_occurrences (
      id, config_revision_id, node_occurrence_id, file_version_id, property_name,
      start_offset, end_offset, start_line, start_column, end_line, end_column,
      raw_text, ast_json, source_order, content_hash
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15
    )
    `,
    [
      occurrence.id,
      configRevisionId,
      occurrence.nodeOccurrenceId,
      occurrence.fileVersionId,
      occurrence.propertyName,
      occurrence.startOffset,
      occurrence.endOffset,
      occurrence.startLine,
      occurrence.startColumn,
      occurrence.endLine,
      occurrence.endColumn,
      occurrence.rawText,
      JSON.stringify(occurrence.astJson),
      occurrence.sourceOrder,
      occurrence.contentHash,
    ],
  );
}

export async function insertOccurrenceEffect(
  db: Queryable,
  configRevisionId: string,
  effect: PersistedOccurrenceEffect,
): Promise<void> {
  await db.query(
    `
    insert into dts_occurrence_effects (
      id, config_revision_id, logical_node_revision_id, property_name, effect_kind,
      node_occurrence_id, property_occurrence_id, source_order
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      effect.id,
      configRevisionId,
      effect.logicalNodeRevisionId,
      effect.propertyName,
      effect.effectKind,
      effect.nodeOccurrenceId,
      effect.propertyOccurrenceId,
      effect.sourceOrder,
    ],
  );
}

export async function insertValidationRun(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    configRevisionId: string;
    stage: string;
    status: "pending" | "passed" | "failed";
    toolchain?: Record<string, unknown>;
    artifactHashes?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `
    insert into dts_validation_runs (
      id, organization_id, config_revision_id, stage, status, toolchain, artifact_hashes
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
    `,
    [
      input.id,
      input.organizationId,
      input.configRevisionId,
      input.stage,
      input.status,
      JSON.stringify(input.toolchain ?? {}),
      JSON.stringify(input.artifactHashes ?? {}),
    ],
  );
}

export type ConfigRevisionMemberRow = {
  fileId: string;
  fileVersionId: string;
  role: string;
  sortOrder: number;
  fileName: string;
  checksum: string;
  storageKey: string;
  parsedIndex: unknown;
};

export async function listConfigRevisionMembers(
  db: Queryable,
  configRevisionId: string,
): Promise<ConfigRevisionMemberRow[]> {
  const result = await db.query<{
    file_id: string;
    file_version_id: string;
    role: string;
    sort_order: number | string;
    file_name: string;
    checksum: string;
    storage_key: string;
    parsed_index: unknown;
  }>(
    `
    select
      m.file_id,
      m.file_version_id,
      m.role,
      m.sort_order,
      f.file_name,
      v.checksum,
      v.storage_key,
      v.parsed_index
    from dts_config_revision_members m
    join project_parameter_files f on f.id = m.file_id
    join project_parameter_file_versions v on v.id = m.file_version_id
    where m.config_revision_id = $1
    order by m.sort_order asc, f.file_name asc
    `,
    [configRevisionId],
  );
  return result.rows.map((row) => ({
    fileId: row.file_id,
    fileVersionId: row.file_version_id,
    role: row.role,
    sortOrder: Number(row.sort_order),
    fileName: row.file_name,
    checksum: row.checksum,
    storageKey: row.storage_key,
    parsedIndex: row.parsed_index,
  }));
}

export async function insertValidationDiagnostics(
  db: Queryable,
  validationRunId: string,
  diagnostics: PersistedValidationDiagnostic[],
): Promise<void> {
  for (const diagnostic of diagnostics) {
    await db.query(
      `
      insert into dts_validation_diagnostics (
        id, validation_run_id, code, severity, stage, message, file_name,
        start_line, start_column, logical_node_id, property_name, guidance
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, null, $10)
      `,
      [
        diagnostic.id,
        validationRunId,
        diagnostic.code,
        diagnostic.severity,
        diagnostic.stage,
        diagnostic.message,
        diagnostic.fileName,
        diagnostic.startLine ?? null,
        diagnostic.startColumn ?? null,
        diagnostic.guidance ?? null,
      ],
    );
  }
}

function cryptoRandomId(): string {
  return randomUUID();
}

export async function getConfigRevisionById(
  db: Queryable,
  input: { organizationId: string; revisionId: string; projectId?: string; configSetId?: string },
): Promise<DtsConfigRevisionDto | null> {
  const values: unknown[] = [input.organizationId, input.revisionId];
  const conditions = ["organization_id = $1", "id = $2"];
  if (input.projectId) {
    values.push(input.projectId);
    conditions.push(`project_id = $${values.length}`);
  }
  if (input.configSetId) {
    values.push(input.configSetId);
    conditions.push(`config_set_id = $${values.length}`);
  }
  const result = await db.query<RevisionRow>(
    `
    select *
    from dts_config_revisions
    where ${conditions.join(" and ")}
    limit 1
    `,
    values,
  );
  const row = result.rows[0];
  return row ? toRevisionDto(row) : null;
}

/** Latest non-resolving revision for a config set (head for UI/API consumers). */
export async function getLatestConfigRevision(
  db: Queryable,
  input: { organizationId: string; projectId: string; configSetId: string },
): Promise<DtsConfigRevisionDto | null> {
  const result = await db.query<RevisionRow>(
    `
    select *
    from dts_config_revisions
    where organization_id = $1
      and project_id = $2
      and config_set_id = $3
      and status <> 'resolving'
    order by revision_number desc
    limit 1
    `,
    [input.organizationId, input.projectId, input.configSetId],
  );
  const row = result.rows[0];
  return row ? toRevisionDto(row) : null;
}

export async function listRevisionDiagnostics(
  db: Queryable,
  configRevisionId: string,
): Promise<
  Array<{
    code: string;
    severity: string;
    stage: string;
    message: string;
    fileName: string | null;
    path?: string;
    startLine?: number;
    startColumn?: number;
    guidance?: string;
  }>
> {
  const result = await db.query<{
    code: string;
    severity: string;
    stage: string;
    message: string;
    file_name: string | null;
    start_line: number | string | null;
    start_column: number | string | null;
    guidance: string | null;
  }>(
    `
    select d.code, d.severity, d.stage, d.message, d.file_name,
           d.start_line, d.start_column, d.guidance
    from dts_validation_diagnostics d
    inner join dts_validation_runs r on r.id = d.validation_run_id
    where r.config_revision_id = $1
    order by d.created_at asc
    `,
    [configRevisionId],
  );
  return result.rows.map((row) => ({
    code: row.code,
    severity: row.severity,
    stage: row.stage,
    message: row.message,
    fileName: row.file_name,
    ...(row.file_name ? { path: row.file_name } : {}),
    ...(row.start_line != null ? { startLine: Number(row.start_line) } : {}),
    ...(row.start_column != null ? { startColumn: Number(row.start_column) } : {}),
    ...(row.guidance ? { guidance: row.guidance } : {}),
  }));
}

type SourceNodeRow = {
  id: string;
  file_version_id: string;
  parent_occurrence_id: string | null;
  name: string;
  unit_address: string | null;
  labels: unknown;
  ref_target: string | null;
  is_overlay_root: boolean;
  node_path: string;
  start_line: number | string;
  start_column: number | string;
  end_line: number | string;
  end_column: number | string;
  content_hash: string;
  source_order: number | string;
};

type SourcePropertyRow = {
  id: string;
  node_occurrence_id: string;
  property_name: string;
  start_line: number | string;
  start_column: number | string;
  end_line: number | string;
  end_column: number | string;
  content_hash: string;
  source_order: number | string;
};

type SourceNodeRowWithFile = SourceNodeRow & { file_name: string | null };

export async function listSourceTopology(
  db: Queryable,
  configRevisionId: string,
): Promise<{
  nodes: Array<{
    id: string;
    fileVersionId: string;
    fileName?: string;
    parentOccurrenceId: string | null;
    name: string;
    unitAddress?: string;
    labels: string[];
    refTarget?: string;
    isOverlayRoot: boolean;
    nodePath: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    contentHash: string;
    sourceOrder: number;
    properties: Array<{
      id: string;
      propertyName: string;
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
      contentHash: string;
      sourceOrder: number;
    }>;
  }>;
}> {
  const [nodesResult, propsResult] = await Promise.all([
    db.query<SourceNodeRowWithFile>(
      `
      select n.id, n.file_version_id, f.file_name, n.parent_occurrence_id, n.name, n.unit_address,
             n.labels, n.ref_target, n.is_overlay_root, n.node_path, n.start_line, n.start_column,
             n.end_line, n.end_column, n.content_hash, n.source_order
      from dts_node_occurrences n
      left join dts_config_revision_members m
        on m.file_version_id = n.file_version_id and m.config_revision_id = n.config_revision_id
      left join project_parameter_files f on f.id = m.file_id
      where n.config_revision_id = $1
      order by n.source_order asc
      `,
      [configRevisionId],
    ),
    db.query<SourcePropertyRow>(
      `
      select id, node_occurrence_id, property_name, start_line, start_column, end_line, end_column,
             content_hash, source_order
      from dts_property_occurrences
      where config_revision_id = $1
      order by source_order asc
      `,
      [configRevisionId],
    ),
  ]);

  const propertiesByNode = new Map<string, SourcePropertyRow[]>();
  for (const prop of propsResult.rows) {
    const list = propertiesByNode.get(prop.node_occurrence_id) ?? [];
    list.push(prop);
    propertiesByNode.set(prop.node_occurrence_id, list);
  }

  return {
    nodes: nodesResult.rows.map((node) => ({
      id: node.id,
      fileVersionId: node.file_version_id,
      ...(node.file_name ? { fileName: node.file_name } : {}),
      parentOccurrenceId: node.parent_occurrence_id,
      name: node.name,
      unitAddress: node.unit_address ?? undefined,
      labels: Array.isArray(node.labels) ? node.labels.map(String) : [],
      refTarget: node.ref_target ?? undefined,
      isOverlayRoot: node.is_overlay_root,
      nodePath: node.node_path,
      startLine: Number(node.start_line),
      startColumn: Number(node.start_column),
      endLine: Number(node.end_line),
      endColumn: Number(node.end_column),
      contentHash: node.content_hash,
      sourceOrder: Number(node.source_order),
      properties: (propertiesByNode.get(node.id) ?? []).map((prop) => ({
        id: prop.id,
        propertyName: prop.property_name,
        startLine: Number(prop.start_line),
        startColumn: Number(prop.start_column),
        endLine: Number(prop.end_line),
        endColumn: Number(prop.end_column),
        contentHash: prop.content_hash,
        sourceOrder: Number(prop.source_order),
      })),
    })),
  };
}

type EffectiveNodeRow = {
  id: string;
  logical_node_id: string;
  node_locator: string;
  name: string;
  unit_address: string | null;
  compatible: string | null;
  parent_logical_node_id: string | null;
};

type EffectRow = {
  id: string;
  logical_node_revision_id: string;
  property_name: string | null;
  effect_kind: "set" | "override" | "delete";
  node_occurrence_id: string | null;
  property_occurrence_id: string | null;
  source_order: number | string;
};

export async function listEffectiveTopology(
  db: Queryable,
  configRevisionId: string,
): Promise<{
  nodes: Array<{
    id: string;
    logicalNodeId: string;
    locator: string;
    name: string;
    unitAddress?: string;
    compatible?: string;
    parentLogicalNodeId: string | null;
    effects: Array<{
      id: string;
      propertyName: string | null;
      effectKind: "set" | "override" | "delete";
      nodeOccurrenceId: string | null;
      propertyOccurrenceId: string | null;
      sourceOrder: number;
    }>;
  }>;
}> {
  const [nodesResult, effectsResult] = await Promise.all([
    db.query<EffectiveNodeRow>(
      `
      select id, logical_node_id, node_locator, name, unit_address, compatible, parent_logical_node_id
      from dts_logical_node_revisions
      where config_revision_id = $1
      order by node_locator asc
      `,
      [configRevisionId],
    ),
    db.query<EffectRow>(
      `
      select id, logical_node_revision_id, property_name, effect_kind,
             node_occurrence_id, property_occurrence_id, source_order
      from dts_occurrence_effects
      where config_revision_id = $1
      order by source_order asc
      `,
      [configRevisionId],
    ),
  ]);

  const effectsByNode = new Map<string, EffectRow[]>();
  for (const effect of effectsResult.rows) {
    const list = effectsByNode.get(effect.logical_node_revision_id) ?? [];
    list.push(effect);
    effectsByNode.set(effect.logical_node_revision_id, list);
  }

  return {
    nodes: nodesResult.rows.map((node) => ({
      id: node.id,
      logicalNodeId: node.logical_node_id,
      locator: node.node_locator,
      name: node.name,
      unitAddress: node.unit_address ?? undefined,
      compatible: node.compatible ?? undefined,
      parentLogicalNodeId: node.parent_logical_node_id,
      effects: (effectsByNode.get(node.id) ?? []).map((effect) => ({
        id: effect.id,
        propertyName: effect.property_name,
        effectKind: effect.effect_kind,
        nodeOccurrenceId: effect.node_occurrence_id,
        propertyOccurrenceId: effect.property_occurrence_id,
        sourceOrder: Number(effect.source_order),
      })),
    })),
  };
}

/** Config revision statuses that may serve as identity continuity baselines. */
export const CONTINUITY_BASELINE_STATUSES = [
  "resolved",
  "validated",
  "compiled",
  "pending_approval",
  "published",
] as const;

export type PreviousLogicalNodeRow = {
  logicalNodeId: string;
  nodeLocator: string;
  name: string;
  unitAddress?: string;
  compatible?: string;
  driverSchemaVersionId?: string | null;
  parentLogicalNodeId: string | null;
  reg?: string;
};

/**
 * Load logical-node snapshots from the latest prior *stable* revision of a config set.
 * needs_mapping / invalid / resolving / draft / validation_failed are never baselines.
 */
export async function listPreviousLogicalNodeSnapshots(
  db: Queryable,
  input: { configSetId: string; beforeRevisionNumber: number },
): Promise<PreviousLogicalNodeRow[]> {
  const revisionResult = await db.query<{ id: string }>(
    `
    select id
    from dts_config_revisions
    where config_set_id = $1
      and revision_number < $2
      and status = any($3::text[])
    order by revision_number desc
    limit 1
    `,
    [input.configSetId, input.beforeRevisionNumber, [...CONTINUITY_BASELINE_STATUSES]],
  );
  const previousRevisionId = revisionResult.rows[0]?.id;
  if (!previousRevisionId) return [];

  const result = await db.query<{
    logical_node_id: string;
    node_locator: string;
    name: string;
    unit_address: string | null;
    compatible: string | null;
    driver_schema_version_id: string | null;
    parent_logical_node_id: string | null;
    reg_raw: string | null;
  }>(
    `
    select
      lnr.logical_node_id,
      lnr.node_locator,
      lnr.name,
      lnr.unit_address,
      lnr.compatible,
      lnr.driver_schema_version_id,
      lnr.parent_logical_node_id,
      (
        select po.raw_text
        from dts_occurrence_effects oe
        inner join dts_property_occurrences po on po.id = oe.property_occurrence_id
        where oe.logical_node_revision_id = lnr.id
          and oe.property_name = 'reg'
          and oe.effect_kind in ('set', 'override')
        order by oe.source_order desc
        limit 1
      ) as reg_raw
    from dts_logical_node_revisions lnr
    where lnr.config_revision_id = $1
    order by lnr.node_locator asc
    `,
    [previousRevisionId],
  );

  return result.rows.map((row) => ({
    logicalNodeId: row.logical_node_id,
    nodeLocator: row.node_locator,
    name: row.name,
    unitAddress: row.unit_address ?? undefined,
    compatible: row.compatible ?? undefined,
    driverSchemaVersionId: row.driver_schema_version_id,
    parentLogicalNodeId: row.parent_logical_node_id,
    reg: row.reg_raw ?? undefined,
  }));
}
