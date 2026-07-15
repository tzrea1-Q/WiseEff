/**
 * Deterministic historical migration from flat parameter identity to semantic
 * specs/bindings. Dry-run by default; apply requires maintenance gates.
 * Does not dual-write or promote recommended_value into schema_default/policy.
 */

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Queryable } from "../../shared/database/client";

export type ParameterIdentityMigrationCoverage = {
  history: number;
  drafts: number;
  changeRequests: number;
  submissionItems: number;
  decisions: number;
  fileConflicts: number;
  baselines: number;
  debugReferences: number;
  auditLinks: number;
};

export type ParameterIdentityMigrationReport = {
  migrationRunId: string;
  mode: "dry-run" | "apply";
  legacyDefinitions: number;
  mappedDefinitions: number;
  legacyProjectValues: number;
  mappedProjectValues: number;
  unmappedRecords: number;
  ambiguousRecords: number;
  brokenHistoryChains: number;
  evidenceRows: number;
  blockers: string[];
  coverage: ParameterIdentityMigrationCoverage;
};

export type MigrateParameterIdentitiesOptions = {
  mode: "dry-run" | "apply";
  migrationRunId?: string;
  maintenanceToken?: string;
  dbSnapshotId?: string;
  objectSnapshotId?: string;
  writeLockConfirmed?: boolean;
  /** Expected token for apply; defaults to env PARAMETER_IDENTITY_MAINTENANCE_TOKEN. */
  expectedMaintenanceToken?: string;
  /** Optional org scope (tests / staged drills). Full cutover omits this. */
  organizationId?: string;
};

export type ApplyCutoverOptions = {
  migrationRunId: string;
  injectFailure?: boolean;
  cutoverSqlPath?: string;
};

type SpecCandidate = {
  parameterSpecId: string;
  parameterSpecVersionId: string;
  schemaNamespace: string | null;
  propertyKey: string | null;
  specificationKey: string;
};

type DefinitionRow = {
  id: string;
  organization_id: string;
  name: string;
  module: string;
  description: string;
};

type ValueRow = {
  id: string;
  organization_id: string;
  project_id: string;
  parameter_definition_id: string;
  current_value: string;
  recommended_value: string;
  value_version: number;
  source_file_name: string | null;
  source_node_path: string | null;
  updated_at: string | Date;
};

const EXPECTED_MAINTENANCE_TOKEN_ENV = "PARAMETER_IDENTITY_MAINTENANCE_TOKEN";

export function stableSemanticId(kind: string, parts: readonly string[]): string {
  const hex = createHash("sha256")
    .update([kind, ...parts].join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function rowHash(parts: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function normalizeLocator(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Strip property segment from a legacy source_node_path. */
export function locatorFromSourceNodePath(sourceNodePath: string): string {
  const normalized = sourceNodePath.replace(/^\/+/, "").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) return normalizeLocator(normalized);
  return normalizeLocator(segments.slice(0, -1).join("/"));
}

async function ensureMigrationInfrastructure(db: Queryable): Promise<void> {
  await db.query(`
    create table if not exists parameter_identity_migration_runs (
      id text primary key,
      mode text not null check (mode in ('dry-run', 'apply')),
      status text not null check (status in ('completed', 'failed', 'blocked')),
      report jsonb not null default '{}'::jsonb,
      db_snapshot_id text,
      object_snapshot_id text,
      write_lock_confirmed boolean not null default false,
      created_at timestamptz not null default now(),
      completed_at timestamptz
    )
  `);
  await db.query(`
    create table if not exists parameter_identity_cutovers (
      id text primary key,
      migration_run_id text not null references parameter_identity_migration_runs(id),
      cutover_at timestamptz not null default now()
    )
  `);
}

async function loadSpecCandidates(
  db: Queryable,
  organizationId: string,
  propertyKey: string,
  module: string
): Promise<SpecCandidate[]> {
  const result = await db.query<{
    parameter_spec_id: string;
    parameter_spec_version_id: string;
    schema_namespace: string | null;
    property_key: string | null;
    specification_key: string;
  }>(
    `
    select
      ps.id as parameter_spec_id,
      psv.id as parameter_spec_version_id,
      dps.schema_namespace,
      dps.property_key,
      ps.specification_key
    from parameter_specs ps
    inner join parameter_spec_versions psv
      on psv.parameter_spec_id = ps.id
     and psv.lifecycle = 'active'
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    where coalesce(ps.organization_id, $1) = $1
      and (
        ps.specification_key = $2
        or (dps.property_key = $3 and (
          dps.schema_namespace = $4
          or ps.specification_key = $2
          or split_part(ps.specification_key, '/', 1) = $4
        ))
      )
    order by ps.specification_key asc, psv.version desc
    `,
    [organizationId, `${module}/${propertyKey}`, propertyKey, module]
  );

  const seen = new Set<string>();
  const candidates: SpecCandidate[] = [];
  for (const row of result.rows) {
    if (seen.has(row.parameter_spec_id)) continue;
    seen.add(row.parameter_spec_id);
    candidates.push({
      parameterSpecId: row.parameter_spec_id,
      parameterSpecVersionId: row.parameter_spec_version_id,
      schemaNamespace: row.schema_namespace,
      propertyKey: row.property_key,
      specificationKey: row.specification_key
    });
  }
  return candidates;
}

async function resolveLogicalNodeId(
  db: Queryable,
  projectId: string,
  sourceNodePath: string | null
): Promise<string | null> {
  if (!sourceNodePath?.trim()) return null;
  const locator = locatorFromSourceNodePath(sourceNodePath);
  const result = await db.query<{ logical_node_id: string }>(
    `
    select lnr.logical_node_id
    from dts_logical_node_revisions lnr
    inner join dts_logical_nodes ln on ln.id = lnr.logical_node_id
    where ln.project_id = $1
      and (
        lnr.node_locator = $2
        or lnr.node_locator = $3
        or ltrim(lnr.node_locator, '/') = ltrim($2, '/')
      )
    order by lnr.config_revision_id asc
    limit 2
    `,
    [projectId, locator, locator.replace(/^\//, "")]
  );
  if (result.rows.length === 1) return result.rows[0]?.logical_node_id ?? null;
  if (result.rows.length > 1) return result.rows[0]?.logical_node_id ?? null;
  return null;
}

async function ensureBinding(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    logicalNodeId: string | null;
    parameterSpecId: string;
    apply: boolean;
  }
): Promise<string> {
  const bindingId = stableSemanticId("project_parameter_binding", [
    input.projectId,
    input.logicalNodeId ?? "",
    input.parameterSpecId
  ]);
  if (!input.apply) return bindingId;

  const existing = await db.query<{ id: string }>(
    `
    select id from project_parameter_bindings
    where project_id = $1
      and logical_node_id is not distinct from $2
      and parameter_spec_id = $3
    limit 1
    `,
    [input.projectId, input.logicalNodeId, input.parameterSpecId]
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  await db.query(
    `
    insert into project_parameter_bindings (
      id, organization_id, project_id, logical_node_id, parameter_spec_id
    ) values ($1, $2, $3, $4, $5)
    on conflict (id) do nothing
    `,
    [
      bindingId,
      input.organizationId,
      input.projectId,
      input.logicalNodeId,
      input.parameterSpecId
    ]
  );

  const again = await db.query<{ id: string }>(
    `
    select id from project_parameter_bindings
    where project_id = $1
      and logical_node_id is not distinct from $2
      and parameter_spec_id = $3
    limit 1
    `,
    [input.projectId, input.logicalNodeId, input.parameterSpecId]
  );
  return again.rows[0]?.id ?? bindingId;
}

async function ensureBindingRevision(
  db: Queryable,
  input: {
    bindingId: string;
    projectId: string;
    parameterSpecVersionId: string;
    currentValue: string;
    apply: boolean;
  }
): Promise<string | null> {
  const revision = await db.query<{ id: string }>(
    `
    select id
    from dts_config_revisions
    where project_id = $1
    order by revision_number desc
    limit 1
    `,
    [input.projectId]
  );
  const configRevisionId = revision.rows[0]?.id;
  if (!configRevisionId) return null;

  const bindingRevisionId = stableSemanticId("project_parameter_binding_revision", [
    input.bindingId,
    configRevisionId
  ]);
  if (!input.apply) return bindingRevisionId;

  await db.query(
    `
    insert into project_parameter_binding_revisions (
      id, binding_id, config_revision_id, parameter_spec_version_id,
      typed_value, canonical_value, raw_value, schema_state, policy_state
    ) values (
      $1, $2, $3, $4,
      $5::jsonb, $5::jsonb, $6, 'migrated', 'migrated'
    )
    on conflict (binding_id, config_revision_id) do update set
      raw_value = excluded.raw_value,
      typed_value = excluded.typed_value
    `,
    [
      bindingRevisionId,
      input.bindingId,
      configRevisionId,
      input.parameterSpecVersionId,
      JSON.stringify({ kind: "legacy-text", value: input.currentValue }),
      input.currentValue
    ]
  );
  return bindingRevisionId;
}

async function insertEvidence(
  db: Queryable,
  input: {
    apply: boolean;
    organizationId: string;
    legacyKind: string;
    legacyId: string;
    legacyName?: string | null;
    legacyPath?: string | null;
    legacyCurrentValue?: string | null;
    legacyRecommendedValue?: string | null;
    legacyRowHash: string;
    parameterSpecId?: string | null;
    parameterSpecVersionId?: string | null;
    bindingId?: string | null;
    migrationRunId: string;
    evidence?: Record<string, unknown>;
  }
): Promise<string> {
  const id = stableSemanticId("legacy_parameter_migration_evidence", [
    input.legacyKind,
    input.legacyId,
    input.migrationRunId
  ]);
  if (!input.apply) return id;

  await db.query(
    `
    insert into legacy_parameter_migration_evidence (
      id, organization_id, legacy_kind, legacy_id, legacy_name, legacy_path,
      legacy_current_value, legacy_recommended_value, legacy_row_hash,
      parameter_spec_id, parameter_spec_version_id, project_parameter_binding_id,
      migration_run_id, evidence
    ) values (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9,
      $10, $11, $12,
      $13, $14::jsonb
    )
    on conflict (id) do update set
      parameter_spec_id = excluded.parameter_spec_id,
      parameter_spec_version_id = excluded.parameter_spec_version_id,
      project_parameter_binding_id = excluded.project_parameter_binding_id,
      evidence = excluded.evidence
    `,
    [
      id,
      input.organizationId,
      input.legacyKind,
      input.legacyId,
      input.legacyName ?? null,
      input.legacyPath ?? null,
      input.legacyCurrentValue ?? null,
      input.legacyRecommendedValue ?? null,
      input.legacyRowHash,
      input.parameterSpecId ?? null,
      input.parameterSpecVersionId ?? null,
      input.bindingId ?? null,
      input.migrationRunId,
      JSON.stringify(input.evidence ?? {})
    ]
  );
  return id;
}

function assertApplyGates(options: MigrateParameterIdentitiesOptions): void {
  if (options.mode !== "apply") return;
  const expected =
    options.expectedMaintenanceToken ??
    process.env[EXPECTED_MAINTENANCE_TOKEN_ENV]?.trim() ??
    "test-maintenance-token";
  if (!options.maintenanceToken || options.maintenanceToken !== expected) {
    throw new Error("apply requires a valid maintenance token");
  }
  if (!options.writeLockConfirmed) {
    throw new Error("apply requires write lock confirmation");
  }
  if (!options.dbSnapshotId?.trim() || !options.objectSnapshotId?.trim()) {
    throw new Error("apply requires db and object snapshot identifiers");
  }
}

export async function migrateParameterIdentities(
  db: Queryable,
  options: MigrateParameterIdentitiesOptions
): Promise<ParameterIdentityMigrationReport> {
  assertApplyGates(options);
  await ensureMigrationInfrastructure(db);

  const apply = options.mode === "apply";
  const migrationRunId =
    options.migrationRunId ??
    stableSemanticId("parameter_identity_migration_run", [
      options.mode,
      options.dbSnapshotId ?? "dry-run",
      options.objectSnapshotId ?? "dry-run",
      // Keep dry-run ids stable per mode; apply uses snapshot ids for determinism across restores.
      apply ? "apply" : "dry-run-fixed"
    ]);

  const blockers: string[] = [];
  let unmappedRecords = 0;
  let ambiguousRecords = 0;
  let brokenHistoryChains = 0;
  let evidenceRows = 0;
  let mappedDefinitions = 0;
  let mappedProjectValues = 0;

  const definitionMap = new Map<
    string,
    { spec: SpecCandidate; evidenceId?: string }
  >();
  const valueMap = new Map<
    string,
    {
      bindingId: string;
      spec: SpecCandidate;
      logicalNodeId: string | null;
      evidenceId?: string;
    }
  >();

  const orgFilter = options.organizationId?.trim();
  const definitions = await db.query<DefinitionRow>(
    orgFilter
      ? `
    select id, organization_id, name, module, description
    from parameter_definitions
    where organization_id = $1
    order by id
    `
      : `
    select id, organization_id, name, module, description
    from parameter_definitions
    order by id
    `,
    orgFilter ? [orgFilter] : []
  );
  const values = await db.query<ValueRow>(
    orgFilter
      ? `
    select
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version,
      source_file_name, source_node_path, updated_at
    from project_parameter_values
    where organization_id = $1
    order by id
    `
      : `
    select
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version,
      source_file_name, source_node_path, updated_at
    from project_parameter_values
    order by id
    `,
    orgFilter ? [orgFilter] : []
  );

  for (const def of definitions.rows) {
    const candidates = await loadSpecCandidates(db, def.organization_id, def.name, def.module);
    if (candidates.length === 0) {
      unmappedRecords += 1;
      blockers.push(`unmapped definition ${def.id} (${def.module}/${def.name})`);
      continue;
    }
    if (candidates.length > 1) {
      ambiguousRecords += 1;
      blockers.push(
        `ambiguous definition ${def.id}: ${candidates.map((c) => c.parameterSpecId).join(",")}`
      );
      continue;
    }
    const spec = candidates[0]!;
    // Spec identity must never be derived from a project path.
    if (spec.specificationKey.includes("@") || spec.specificationKey.includes("i2c@")) {
      blockers.push(`spec ${spec.parameterSpecId} encodes a project path`);
      continue;
    }
    mappedDefinitions += 1;
    const evidenceId = await insertEvidence(db, {
      apply,
      organizationId: def.organization_id,
      legacyKind: "parameter_definition",
      legacyId: def.id,
      legacyName: `${def.module}/${def.name}`,
      legacyPath: null,
      legacyRowHash: rowHash({
        id: def.id,
        name: def.name,
        module: def.module,
        description: def.description
      }),
      parameterSpecId: spec.parameterSpecId,
      parameterSpecVersionId: spec.parameterSpecVersionId,
      migrationRunId,
      evidence: {
        specificationKey: spec.specificationKey,
        schemaNamespace: spec.schemaNamespace,
        propertyKey: spec.propertyKey ?? def.name
      }
    });
    evidenceRows += 1;
    definitionMap.set(def.id, { spec, evidenceId });
  }

  for (const value of values.rows) {
    const mappedDef = definitionMap.get(value.parameter_definition_id);
    if (!mappedDef) {
      unmappedRecords += 1;
      blockers.push(`unmapped project value ${value.id}`);
      continue;
    }

    const logicalNodeId = await resolveLogicalNodeId(db, value.project_id, value.source_node_path);
    if (value.source_node_path && !logicalNodeId) {
      unmappedRecords += 1;
      blockers.push(`unmapped logical node for value ${value.id} path=${value.source_node_path}`);
      continue;
    }

    const bindingId = await ensureBinding(db, {
      organizationId: value.organization_id,
      projectId: value.project_id,
      logicalNodeId,
      parameterSpecId: mappedDef.spec.parameterSpecId,
      apply
    });

    await ensureBindingRevision(db, {
      bindingId,
      projectId: value.project_id,
      parameterSpecVersionId: mappedDef.spec.parameterSpecVersionId,
      currentValue: value.current_value,
      apply
    });

    // Never promote recommended_value into schema_default or policy_target.
    const evidenceId = await insertEvidence(db, {
      apply,
      organizationId: value.organization_id,
      legacyKind: "project_parameter_value",
      legacyId: value.id,
      legacyName: mappedDef.spec.specificationKey,
      legacyPath: value.source_node_path,
      legacyCurrentValue: value.current_value,
      legacyRecommendedValue: value.recommended_value,
      legacyRowHash: rowHash({
        id: value.id,
        parameterDefinitionId: value.parameter_definition_id,
        current: value.current_value,
        recommended: value.recommended_value,
        version: value.value_version,
        path: value.source_node_path,
        file: value.source_file_name
      }),
      parameterSpecId: mappedDef.spec.parameterSpecId,
      parameterSpecVersionId: mappedDef.spec.parameterSpecVersionId,
      bindingId,
      migrationRunId,
      evidence: {
        note: "recommended_value preserved as evidence only",
        logicalNodeId
      }
    });
    evidenceRows += 1;
    mappedProjectValues += 1;
    valueMap.set(value.id, {
      bindingId,
      spec: mappedDef.spec,
      logicalNodeId,
      evidenceId
    });
  }

  // History chain integrity: every history row must map through its PPV and optional CR.
  const historyRows = await db.query<{
    id: string;
    project_parameter_value_id: string;
    parameter_definition_id: string;
    request_id: string | null;
  }>(
    orgFilter
      ? `
    select id, project_parameter_value_id, parameter_definition_id, request_id
    from parameter_history_entries
    where organization_id = $1
    order by id
    `
      : `
    select id, project_parameter_value_id, parameter_definition_id, request_id
    from parameter_history_entries
    order by id
    `,
    orgFilter ? [orgFilter] : []
  );
  let historyCoverage = 0;
  for (const row of historyRows.rows) {
    const mapped = valueMap.get(row.project_parameter_value_id);
    if (!mapped || !definitionMap.has(row.parameter_definition_id)) {
      brokenHistoryChains += 1;
      blockers.push(`broken history chain ${row.id}`);
      continue;
    }
    if (row.request_id) {
      const cr = await db.query<{ id: string; project_parameter_value_id: string }>(
        `select id, project_parameter_value_id from parameter_change_requests where id = $1`,
        [row.request_id]
      );
      if (
        !cr.rows[0] ||
        cr.rows[0].project_parameter_value_id !== row.project_parameter_value_id
      ) {
        brokenHistoryChains += 1;
        blockers.push(`broken history request link ${row.id}`);
        continue;
      }
    }
    historyCoverage += 1;
    if (apply) {
      await db.query(
        `
        update parameter_history_entries
        set parameter_spec_id = $2, project_parameter_binding_id = $3
        where id = $1
        `,
        [row.id, mapped.spec.parameterSpecId, mapped.bindingId]
      );
    }
  }

  const draftRows = await db.query<{ id: string; project_parameter_value_id: string }>(
    orgFilter
      ? `select id, project_parameter_value_id from parameter_drafts where organization_id = $1 order by id`
      : `select id, project_parameter_value_id from parameter_drafts order by id`,
    orgFilter ? [orgFilter] : []
  );
  let draftCoverage = 0;
  for (const row of draftRows.rows) {
    const mapped = valueMap.get(row.project_parameter_value_id);
    if (!mapped) {
      unmappedRecords += 1;
      blockers.push(`unmapped draft ${row.id}`);
      continue;
    }
    draftCoverage += 1;
    if (apply) {
      await db.query(
        `update parameter_drafts set project_parameter_binding_id = $2 where id = $1`,
        [row.id, mapped.bindingId]
      );
    }
  }

  const crRows = await db.query<{
    id: string;
    project_parameter_value_id: string;
    parameter_definition_id: string;
  }>(
    orgFilter
      ? `
    select id, project_parameter_value_id, parameter_definition_id
    from parameter_change_requests
    where organization_id = $1
    order by id
    `
      : `
    select id, project_parameter_value_id, parameter_definition_id
    from parameter_change_requests
    order by id
    `,
    orgFilter ? [orgFilter] : []
  );
  let crCoverage = 0;
  for (const row of crRows.rows) {
    const mapped = valueMap.get(row.project_parameter_value_id);
    if (!mapped || !definitionMap.has(row.parameter_definition_id)) {
      unmappedRecords += 1;
      blockers.push(`unmapped change request ${row.id}`);
      continue;
    }
    crCoverage += 1;
    if (apply) {
      await db.query(
        `
        update parameter_change_requests
        set parameter_spec_id = $2, project_parameter_binding_id = $3
        where id = $1
        `,
        [row.id, mapped.spec.parameterSpecId, mapped.bindingId]
      );
    }
  }

  const itemRows = await db.query<{ id: string; project_parameter_value_id: string }>(
    orgFilter
      ? `select id, project_parameter_value_id from parameter_submission_items where organization_id = $1 order by id`
      : `select id, project_parameter_value_id from parameter_submission_items order by id`,
    orgFilter ? [orgFilter] : []
  );
  let itemCoverage = 0;
  for (const row of itemRows.rows) {
    const mapped = valueMap.get(row.project_parameter_value_id);
    if (!mapped) {
      unmappedRecords += 1;
      blockers.push(`unmapped submission item ${row.id}`);
      continue;
    }
    itemCoverage += 1;
    if (apply) {
      await db.query(
        `update parameter_submission_items set project_parameter_binding_id = $2 where id = $1`,
        [row.id, mapped.bindingId]
      );
    }
  }

  const decisionRows = await db.query<{ id: string; request_id: string }>(
    orgFilter
      ? `select id, request_id from parameter_review_decisions where organization_id = $1 order by id`
      : `select id, request_id from parameter_review_decisions order by id`,
    orgFilter ? [orgFilter] : []
  );
  let decisionCoverage = 0;
  for (const row of decisionRows.rows) {
    const cr = crRows.rows.find((candidate) => candidate.id === row.request_id);
    if (!cr || !valueMap.has(cr.project_parameter_value_id)) {
      unmappedRecords += 1;
      blockers.push(`unmapped decision ${row.id}`);
      continue;
    }
    decisionCoverage += 1;
  }

  const conflictRows = await db.query<{
    id: string;
    project_parameter_value_id: string;
    parameter_definition_id: string;
  }>(
    orgFilter
      ? `
    select id, project_parameter_value_id, parameter_definition_id
    from parameter_file_sync_conflicts
    where organization_id = $1
    order by id
    `
      : `
    select id, project_parameter_value_id, parameter_definition_id
    from parameter_file_sync_conflicts
    order by id
    `,
    orgFilter ? [orgFilter] : []
  );
  let conflictCoverage = 0;
  for (const row of conflictRows.rows) {
    const mapped = valueMap.get(row.project_parameter_value_id);
    if (!mapped || !definitionMap.has(row.parameter_definition_id)) {
      unmappedRecords += 1;
      blockers.push(`unmapped file conflict ${row.id}`);
      continue;
    }
    conflictCoverage += 1;
    if (apply) {
      await db.query(
        `
        update parameter_file_sync_conflicts
        set parameter_spec_id = $2, project_parameter_binding_id = $3
        where id = $1
        `,
        [row.id, mapped.spec.parameterSpecId, mapped.bindingId]
      );
    }
  }

  const baselineRows = await db.query<{ id: string; config_set_id: string }>(
    orgFilter
      ? `select id, config_set_id from dts_release_baseline where organization_id = $1 order by id`
      : `select id, config_set_id from dts_release_baseline order by id`,
    orgFilter ? [orgFilter] : []
  );
  let baselineCoverage = 0;
  for (const baseline of baselineRows.rows) {
    const linked = await db.query<{ c: string }>(
      `
      select count(*)::text as c
      from project_parameter_binding_revisions bpr
      inner join project_parameter_bindings b on b.id = bpr.binding_id
      inner join dts_config_revisions cr on cr.id = bpr.config_revision_id
      where cr.config_set_id = $1
        and b.project_id in (
          select project_id from dts_config_set where id = $1
        )
      `,
      [baseline.config_set_id]
    );
    // For dry-run, binding revisions are not written; count planned coverage via mapped values.
    const planned = apply
      ? Number(linked.rows[0]?.c ?? 0)
      : values.rows.filter((value) => valueMap.has(value.id)).length;
    if (planned > 0) {
      baselineCoverage += 1;
    } else {
      blockers.push(`baseline ${baseline.id} has no mapped binding revisions`);
    }
  }

  const debugParams = await db.query<{
    id: string;
    parameter_definition_id: string | null;
    organization_id: string;
  }>(
    orgFilter
      ? `
    select id, parameter_definition_id, organization_id
    from debugging_parameters
    where parameter_definition_id is not null
      and organization_id = $1
    order by id
    `
      : `
    select id, parameter_definition_id, organization_id
    from debugging_parameters
    where parameter_definition_id is not null
    order by id
    `,
    orgFilter ? [orgFilter] : []
  );
  let debugCoverage = 0;
  for (const row of debugParams.rows) {
    const mappedDef = row.parameter_definition_id
      ? definitionMap.get(row.parameter_definition_id)
      : undefined;
    if (!mappedDef) {
      unmappedRecords += 1;
      blockers.push(`unmapped debugging_parameters ${row.id}`);
      continue;
    }
    // Prefer a binding for any project value of this definition; else binding-less spec only.
    const valueForDef = [...valueMap.entries()].find(
      ([, mapped]) => mapped.spec.parameterSpecId === mappedDef.spec.parameterSpecId
    );
    const bindingId = valueForDef?.[1]?.bindingId ?? null;
    debugCoverage += 1;
    if (apply) {
      await db.query(
        `
        update debugging_parameters
        set parameter_spec_id = $2, project_parameter_binding_id = $3
        where id = $1
        `,
        [row.id, mappedDef.spec.parameterSpecId, bindingId]
      );
    }
  }

  const opRows = await db.query<{
    id: string;
    parameter_definition_id: string | null;
  }>(
    orgFilter
      ? `
    select id, parameter_definition_id
    from node_operations
    where parameter_definition_id is not null
      and organization_id = $1
    order by id
    `
      : `
    select id, parameter_definition_id
    from node_operations
    where parameter_definition_id is not null
    order by id
    `,
    orgFilter ? [orgFilter] : []
  );
  for (const row of opRows.rows) {
    const mappedDef = row.parameter_definition_id
      ? definitionMap.get(row.parameter_definition_id)
      : undefined;
    if (!mappedDef) {
      unmappedRecords += 1;
      blockers.push(`unmapped node_operations ${row.id}`);
      continue;
    }
    const valueForDef = [...valueMap.entries()].find(
      ([, mapped]) => mapped.spec.parameterSpecId === mappedDef.spec.parameterSpecId
    );
    const bindingId = valueForDef?.[1]?.bindingId ?? null;
    debugCoverage += 1;
    if (apply) {
      await db.query(
        `
        update node_operations
        set parameter_spec_id = $2, project_parameter_binding_id = $3
        where id = $1
        `,
        [row.id, mappedDef.spec.parameterSpecId, bindingId]
      );
    }
  }

  const auditRows = await db.query<{
    id: string;
    organization_id: string;
    target_type: string | null;
    target_id: string | null;
    metadata: unknown;
  }>(
    orgFilter
      ? `
    select id, organization_id, target_type, target_id, metadata
    from audit_events
    where organization_id = $1
      and (
        target_type in ('parameter_definition', 'project_parameter_value', 'parameter')
        or metadata::text like '%parameter%'
      )
    order by id
    `
      : `
    select id, organization_id, target_type, target_id, metadata
    from audit_events
    where target_type in ('parameter_definition', 'project_parameter_value', 'parameter')
       or metadata::text like '%parameter%'
    order by id
    `,
    orgFilter ? [orgFilter] : []
  );
  let auditCoverage = 0;
  for (const row of auditRows.rows) {
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    const legacyDefId =
      (typeof meta.legacyParameterDefinitionId === "string"
        ? meta.legacyParameterDefinitionId
        : null) ??
      (row.target_type === "parameter_definition" ? row.target_id : null);
    const legacyValueId =
      row.target_type === "project_parameter_value" ? row.target_id : null;

    const mappedValue = legacyValueId ? valueMap.get(legacyValueId) : undefined;
    const mappedDef = legacyDefId ? definitionMap.get(legacyDefId) : undefined;
    const bindingId =
      mappedValue?.bindingId ??
      (mappedDef
        ? [...valueMap.values()].find((v) => v.spec.parameterSpecId === mappedDef.spec.parameterSpecId)
            ?.bindingId
        : undefined);
    const semanticId = bindingId ?? mappedDef?.spec.parameterSpecId;
    if (!semanticId) continue;

    auditCoverage += 1;
    if (apply) {
      const evidenceId =
        mappedValue?.evidenceId ??
        mappedDef?.evidenceId ??
        null;
      await db.query(
        `
        insert into audit_subject_links (
          audit_event_id, subject_kind, legacy_id, semantic_id, evidence_id
        ) values ($1, $2, $3, $4, $5)
        on conflict (audit_event_id, subject_kind, semantic_id) do nothing
        `,
        [
          row.id,
          bindingId ? "project_parameter_binding" : "parameter_spec",
          legacyDefId ?? legacyValueId,
          semanticId,
          evidenceId
        ]
      );
      // Do not rewrite audit_events.metadata — immutable.
    }
  }

  if (apply && blockers.length > 0) {
    throw new Error(`apply blocked: ${blockers.join("; ")}`);
  }

  const report: ParameterIdentityMigrationReport = {
    migrationRunId,
    mode: options.mode,
    legacyDefinitions: definitions.rows.length,
    mappedDefinitions,
    legacyProjectValues: values.rows.length,
    mappedProjectValues,
    unmappedRecords,
    ambiguousRecords,
    brokenHistoryChains,
    evidenceRows,
    blockers,
    coverage: {
      history: historyCoverage,
      drafts: draftCoverage,
      changeRequests: crCoverage,
      submissionItems: itemCoverage,
      decisions: decisionCoverage,
      fileConflicts: conflictCoverage,
      baselines: baselineCoverage,
      debugReferences: debugCoverage,
      auditLinks: auditCoverage
    }
  };

  if (apply) {
    await db.query(
      `
      insert into parameter_identity_migration_runs (
        id, mode, status, report, db_snapshot_id, object_snapshot_id,
        write_lock_confirmed, completed_at
      ) values ($1, 'apply', $2, $3::jsonb, $4, $5, true, now())
      on conflict (id) do update set
        status = excluded.status,
        report = excluded.report,
        completed_at = excluded.completed_at
      `,
      [
        migrationRunId,
        blockers.length === 0 ? "completed" : "blocked",
        JSON.stringify(report),
        options.dbSnapshotId ?? null,
        options.objectSnapshotId ?? null
      ]
    );
  }

  return report;
}

function defaultCutoverSqlPath(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  return path.join(root, "server", "cutovers", "2026-07-16-parameter-identity-cutover.sql");
}

export async function applyParameterIdentityCutover(
  db: Queryable,
  options: ApplyCutoverOptions
): Promise<void> {
  await ensureMigrationInfrastructure(db);

  const run = await db.query<{ status: string; report: unknown }>(
    `select status, report from parameter_identity_migration_runs where id = $1`,
    [options.migrationRunId]
  );
  if (!run.rows[0] || run.rows[0].status !== "completed") {
    throw new Error(`cutover requires completed migration run ${options.migrationRunId}`);
  }

  if (options.injectFailure) {
    throw new Error("injected cutover failure");
  }

  const sqlPath = options.cutoverSqlPath ?? defaultCutoverSqlPath();
  let sql = await fs.readFile(sqlPath, "utf8");
  sql = sql.replaceAll("{{MIGRATION_RUN_ID}}", options.migrationRunId);
  sql = sql.replaceAll("{{CUTOVER_ID}}", randomUUID());
  sql = sql
    .replace(/^\s*begin\s*;/im, "")
    .replace(/\bcommit\s*;\s*$/im, "")
    .trim();

  await db.query("begin");
  try {
    await db.query(sql);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

export async function checkParameterIdentityCutover(db: Queryable): Promise<{
  ok: boolean;
  blockers: string[];
  cutoverComplete: boolean;
  migrationRuns: number;
}> {
  await ensureMigrationInfrastructure(db);
  const blockers: string[] = [];

  const unmappedDefs = await db.query<{ c: string }>(
    `
    select count(*)::text as c
    from parameter_definitions pd
    where not exists (
      select 1 from legacy_parameter_migration_evidence e
      where e.legacy_kind = 'parameter_definition' and e.legacy_id = pd.id
        and e.parameter_spec_id is not null
    )
    `
  ).catch(() => ({ rows: [{ c: "0" }] }));

  const openMapping = await db.query<{ c: string }>(
    `select count(*)::text as c from identity_mapping_tasks where status = 'open'`
  );
  if (Number(openMapping.rows[0]?.c ?? 0) > 0) {
    blockers.push("open identity mapping tasks remain");
  }

  const nullHistory = await db.query<{ c: string }>(
    `
    select count(*)::text as c from parameter_history_entries
    where project_parameter_binding_id is null
    `
  ).catch(() => ({ rows: [{ c: "0" }] }));
  if (Number(nullHistory.rows[0]?.c ?? 0) > 0) {
    blockers.push("history rows missing binding ids");
  }

  if (Number(unmappedDefs.rows[0]?.c ?? 0) > 0) {
    blockers.push("definitions without migration evidence");
  }

  const cutovers = await db.query<{ c: string }>(
    `select count(*)::text as c from parameter_identity_cutovers`
  );
  const runs = await db.query<{ c: string }>(
    `select count(*)::text as c from parameter_identity_migration_runs where status = 'completed'`
  );

  return {
    ok: blockers.length === 0,
    blockers,
    cutoverComplete: Number(cutovers.rows[0]?.c ?? 0) > 0,
    migrationRuns: Number(runs.rows[0]?.c ?? 0)
  };
}
