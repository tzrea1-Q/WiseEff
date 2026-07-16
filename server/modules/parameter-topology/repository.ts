import { randomUUID } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import type {
  ConfigRevisionManifestMember,
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
  created_by_user_id: string | null;
  created_at: string | Date;
  resolved_at: string | Date | null;
};

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
  },
): Promise<DtsConfigRevisionDto> {
  const result = await db.query<RevisionRow>(
    `
    insert into dts_config_revisions (
      id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
    ) values ($1, $2, $3, $4, $5, $6, $7)
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
    ],
  );
  return toRevisionDto(result.rows[0]);
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
    ) values ($1, $2, $3, $4, $5, $6, $7, null, $8)
    `,
    [
      revision.id,
      revision.logicalNodeId,
      configRevisionId,
      revision.nodeLocator,
      revision.name,
      revision.unitAddress ?? null,
      revision.compatible ?? null,
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
  },
): Promise<void> {
  await db.query(
    `
    insert into dts_validation_runs (
      id, organization_id, config_revision_id, stage, status, toolchain, artifact_hashes
    ) values ($1, $2, $3, $4, $5, '{}'::jsonb, '{}'::jsonb)
    `,
    [input.id, input.organizationId, input.configRevisionId, input.stage, input.status],
  );
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

export async function listSourceTopology(
  db: Queryable,
  configRevisionId: string,
): Promise<{
  nodes: Array<{
    id: string;
    fileVersionId: string;
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
    db.query<SourceNodeRow>(
      `
      select id, file_version_id, parent_occurrence_id, name, unit_address, labels, ref_target,
             is_overlay_root, node_path, start_line, start_column, end_line, end_column,
             content_hash, source_order
      from dts_node_occurrences
      where config_revision_id = $1
      order by source_order asc
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
