/**
 * Deterministic historical migration from flat parameter identity to semantic
 * specs/bindings. Dry-run by default; apply requires maintenance gates.
 * Does not dual-write or promote recommended_value into schema_default/policy.
 */


/** Pre-cutover SQL column names. Allowed only via this migrator module; production must not literalize them. */
export const LEGACY_SQL = {
  recommendedValueColumn: "recommended_value",
} as const;

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Database, Queryable } from "../../shared/database/client";

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
  /** Expected token for apply; required via this field or env PARAMETER_IDENTITY_MAINTENANCE_TOKEN. */
  expectedMaintenanceToken?: string;
  /** Optional org scope (tests / staged drills). Full cutover omits this. */
  organizationId?: string;
  /** Test-only: throw after some apply writes inside the transaction. */
  injectFailure?: boolean;
};

export type ApplyCutoverOptions = {
  migrationRunId: string;
  /** Test-only: throw after partial cutover writes inside the transaction. */
  injectFailure?: boolean;
  cutoverSqlPath?: string;
};

/** Marker comment inside cutover SQL; apply splits here for mid-tx failure injection. */
export const CUTOVER_FAILURE_INJECT_POINT = "-- CUTOVER_FAILURE_INJECT_POINT";

function requireTransactionalDb(db: Queryable): Database {
  if (typeof (db as Database).transaction === "function") {
    return db as Database;
  }
  throw new Error("parameter identity apply/cutover requires Database.transaction()");
}

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

/** Dry-run must never CREATE/ALTER; formal migration 0049 pre-creates these. */
async function requireMigrationInfrastructure(db: Queryable): Promise<void> {
  const result = await db.query<{ name: string }>(
    `
    select table_name as name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'parameter_identity_migration_runs',
        'parameter_identity_cutovers'
      )
    `
  );
  const present = new Set(result.rows.map((row) => row.name));
  const missing: string[] = [];
  if (!present.has("parameter_identity_migration_runs")) {
    missing.push("parameter_identity_migration_runs");
  }
  if (!present.has("parameter_identity_cutovers")) {
    missing.push("parameter_identity_cutovers");
  }
  if (missing.length > 0) {
    throw new Error(
      `parameter identity migration infrastructure missing: ${missing.join(", ")}. Run db:migrate (0049) first.`
    );
  }
}

function propertyKeyFromPath(sourceNodePath: string | null, fallbackName: string): string {
  if (!sourceNodePath?.trim()) return fallbackName;
  const segments = sourceNodePath.replace(/^\/+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  return segments[segments.length - 1] || fallbackName;
}

function sanitizeSpecSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.@+-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

async function loadSpecCandidates(
  db: Queryable,
  input: {
    organizationId: string;
    propertyKey: string;
    module: string;
    schemaNamespace?: string | null;
    driverName?: string | null;
  }
): Promise<SpecCandidate[]> {
  const moduleKey = `${input.module}/${input.propertyKey}`;
  const driverKey = input.driverName
    ? `${input.driverName}/${input.propertyKey}`
    : null;
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
     and psv.lifecycle in ('active', 'draft')
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    where (ps.organization_id is null or ps.organization_id = $1)
      and (
        ps.specification_key = $2
        or ($3::text is not null and ps.specification_key = $3)
        or dps.property_key = $4
        or split_part(ps.specification_key, '/', 2) = $4
        or (
          dps.property_key = $4
          and (
            ($5::text is not null and dps.schema_namespace = $5)
            or ($6::text is not null and split_part(ps.specification_key, '/', 1) = $6)
            or split_part(ps.specification_key, '/', 1) = $7
          )
        )
      )
    order by
      case
        when ps.specification_key = $2 then 0
        when $3::text is not null and ps.specification_key = $3 then 1
        when $5::text is not null and dps.schema_namespace = $5 then 2
        when $6::text is not null and split_part(ps.specification_key, '/', 1) = $6 then 3
        else 4
      end,
      ps.specification_key asc,
      psv.version desc
    `,
    [
      input.organizationId,
      moduleKey,
      driverKey,
      input.propertyKey,
      input.schemaNamespace ?? null,
      input.driverName ?? null,
      input.module
    ]
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

type LogicalNodeResolveResult =
  | { kind: "none" }
  | {
      kind: "one";
      logicalNodeId: string;
      compatible: string | null;
      driverSchemaVersionId: string | null;
      nodeName: string | null;
      configRevisionId: string | null;
    }
  | { kind: "ambiguous"; logicalNodeIds: string[] };

async function resolveLogicalNodeId(
  db: Queryable,
  input: {
    projectId: string;
    sourceNodePath: string | null;
    sourceFileName: string | null;
  }
): Promise<LogicalNodeResolveResult> {
  if (!input.sourceNodePath?.trim()) return { kind: "none" };
  const locator = locatorFromSourceNodePath(input.sourceNodePath);
  const result = await db.query<{
    logical_node_id: string;
    compatible: string | null;
    driver_schema_version_id: string | null;
    name: string | null;
    config_revision_id: string;
  }>(
    `
    select
      lnr.logical_node_id,
      lnr.compatible,
      lnr.driver_schema_version_id,
      lnr.name,
      lnr.config_revision_id
    from dts_logical_node_revisions lnr
    inner join dts_logical_nodes ln on ln.id = lnr.logical_node_id
    inner join dts_config_revisions cr on cr.id = lnr.config_revision_id
    left join dts_config_revision_members crm on crm.config_revision_id = cr.id
    left join project_parameter_files ppf on ppf.id = crm.file_id
    where ln.project_id = $1
      and (
        lnr.node_locator = $2
        or lnr.node_locator = $3
        or ltrim(lnr.node_locator, '/') = ltrim($2, '/')
      )
      and (
        $4::text is null
        or ppf.file_name = $4
        or ppf.file_name is null
      )
    order by
      case when $4::text is not null and ppf.file_name = $4 then 0 else 1 end,
      cr.revision_number desc,
      lnr.logical_node_id asc
    `,
    [
      input.projectId,
      locator,
      locator.replace(/^\//, ""),
      input.sourceFileName?.trim() || null
    ]
  );

  const unique = new Map<string, (typeof result.rows)[number]>();
  for (const row of result.rows) {
    if (!unique.has(row.logical_node_id)) unique.set(row.logical_node_id, row);
  }
  const rows = [...unique.values()];
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) {
    const row = rows[0]!;
    return {
      kind: "one",
      logicalNodeId: row.logical_node_id,
      compatible: row.compatible,
      driverSchemaVersionId: row.driver_schema_version_id,
      nodeName: row.name,
      configRevisionId: row.config_revision_id
    };
  }
  return {
    kind: "ambiguous",
    logicalNodeIds: rows.map((row) => row.logical_node_id)
  };
}

function planInferredSpec(input: {
  organizationId: string;
  module: string;
  propertyKey: string;
  schemaNamespace?: string | null;
  driverName?: string | null;
}): SpecCandidate {
  const namespace =
    sanitizeSpecSegment(input.schemaNamespace || input.driverName || input.module);
  const propertyKey = sanitizeSpecSegment(input.propertyKey);
  const specificationKey = `${namespace}/${propertyKey}`;
  const parameterSpecId = stableSemanticId("parameter_spec", [
    input.organizationId,
    "dts",
    namespace,
    propertyKey
  ]);
  const parameterSpecVersionId = stableSemanticId("parameter_spec_version", [
    parameterSpecId,
    "1"
  ]);
  return {
    parameterSpecId,
    parameterSpecVersionId,
    schemaNamespace: namespace,
    propertyKey: input.propertyKey,
    specificationKey
  };
}

async function ensureInferredSpec(
  db: Queryable,
  spec: SpecCandidate,
  organizationId: string,
  apply: boolean
): Promise<void> {
  if (!apply) return;
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'dts', $3)
    on conflict (id) do nothing
    `,
    [spec.parameterSpecId, organizationId, spec.specificationKey]
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values (
      $1, $2, 1, $3, 'Inferred during identity migration',
      '{"kind":"legacy-text"}'::jsonb,
      null, null, 'draft'
    )
    on conflict (id) do nothing
    `,
    [spec.parameterSpecVersionId, spec.parameterSpecId, spec.propertyKey ?? "property"]
  );
  const propertySpecId = stableSemanticId("dts_property_spec", [
    spec.parameterSpecId,
    spec.propertyKey ?? "property"
  ]);
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, property_key, schema_namespace, constraints
    ) values ($1, $2, $3, $4, '{}'::jsonb)
    on conflict (id) do nothing
    `,
    [
      propertySpecId,
      spec.parameterSpecId,
      spec.propertyKey ?? "property",
      spec.schemaNamespace ?? "unknown"
    ]
  );
}

async function ensureAmbiguityTasks(
  db: Queryable,
  input: {
    apply: boolean;
    organizationId: string;
    projectId: string;
    configRevisionId: string | null;
    reason: string;
    candidateLogicalNodeIds?: string[];
    parameterSpecIds?: string[];
    evidence: Record<string, unknown>;
  }
): Promise<void> {
  if (!input.apply) return;

  if (input.configRevisionId && (input.candidateLogicalNodeIds?.length ?? 0) > 0) {
    const taskId = stableSemanticId("identity_mapping_task", [
      input.organizationId,
      input.projectId,
      input.configRevisionId,
      input.reason,
      ...(input.candidateLogicalNodeIds ?? [])
    ]);
    await db.query(
      `
      insert into identity_mapping_tasks (
        id, organization_id, project_id, config_revision_id,
        candidate_logical_node_ids, evidence, status, reason
      ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'open', $7)
      on conflict (id) do nothing
      `,
      [
        taskId,
        input.organizationId,
        input.projectId,
        input.configRevisionId,
        JSON.stringify(input.candidateLogicalNodeIds ?? []),
        JSON.stringify(input.evidence),
        input.reason
      ]
    );
  }

  if ((input.parameterSpecIds?.length ?? 0) > 1) {
    const taskId = stableSemanticId("parameter_spec_review_task", [
      input.organizationId,
      input.reason,
      ...(input.parameterSpecIds ?? [])
    ]);
    await db.query(
      `
      insert into parameter_spec_review_tasks (
        id, organization_id, parameter_spec_id, source_evidence,
        candidate_schemas, project_count, status, reason
      ) values ($1, $2, null, $3::jsonb, $4::jsonb, 1, 'open', $5)
      on conflict (id) do nothing
      `,
      [
        taskId,
        input.organizationId,
        JSON.stringify(input.evidence),
        JSON.stringify(input.parameterSpecIds ?? []),
        input.reason
      ]
    );
  }
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
    options.expectedMaintenanceToken?.trim() ||
    process.env[EXPECTED_MAINTENANCE_TOKEN_ENV]?.trim() ||
    "";
  if (!expected) {
    throw new Error(
      `apply requires ${EXPECTED_MAINTENANCE_TOKEN_ENV} or expectedMaintenanceToken`
    );
  }
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
  await requireMigrationInfrastructure(db);

  if (options.mode === "apply") {
    return requireTransactionalDb(db).transaction((tx) =>
      runParameterIdentityMigration(tx, options)
    );
  }

  // Dry-run is read-only: never CREATE/ALTER/INSERT/UPDATE. If a helper
  // accidentally writes, roll the whole transaction back on exit.
  const database = requireTransactionalDb(db);
  return database.transaction(async (tx) => {
    const report = await runParameterIdentityMigration(tx, options);
    throw Object.assign(new Error("DRY_RUN_ROLLBACK"), { report });
  }).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "report" in error &&
      (error as { message?: string }).message === "DRY_RUN_ROLLBACK"
    ) {
      return (error as { report: ParameterIdentityMigrationReport }).report;
    }
    throw error;
  });
}

async function runParameterIdentityMigration(
  db: Queryable,
  options: MigrateParameterIdentitiesOptions
): Promise<ParameterIdentityMigrationReport> {
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
    const propertyKey = def.name;
    const candidates = await loadSpecCandidates(db, {
      organizationId: def.organization_id,
      propertyKey,
      module: def.module
    });

    let spec: SpecCandidate | null = null;
    let inferred = false;

    if (candidates.length === 1) {
      spec = candidates[0]!;
    } else if (candidates.length > 1) {
      // Prefer exact module/name or unique property-key after namespace filter.
      const exact = candidates.filter(
        (c) =>
          c.specificationKey === `${def.module}/${propertyKey}` ||
          c.specificationKey === `${sanitizeSpecSegment(def.module)}/${sanitizeSpecSegment(propertyKey)}`
      );
      if (exact.length === 1) {
        spec = exact[0]!;
      } else {
        ambiguousRecords += 1;
        blockers.push(
          `ambiguous definition ${def.id}: ${candidates.map((c) => c.parameterSpecId).join(",")}`
        );
        await ensureAmbiguityTasks(db, {
          apply,
          organizationId: def.organization_id,
          projectId: values.rows.find((v) => v.parameter_definition_id === def.id)?.project_id ?? "unknown",
          configRevisionId: null,
          reason: `ambiguous parameter spec for ${def.module}/${propertyKey}`,
          parameterSpecIds: candidates.map((c) => c.parameterSpecId),
          evidence: {
            definitionId: def.id,
            module: def.module,
            propertyKey,
            candidateSpecificationKeys: candidates.map((c) => c.specificationKey)
          }
        });
        continue;
      }
    } else {
      // Deterministic inferred draft: module + property key (never a project path).
      spec = planInferredSpec({
        organizationId: def.organization_id,
        module: def.module,
        propertyKey
      });
      inferred = true;
      await ensureInferredSpec(db, spec, def.organization_id, apply);
    }

    // Spec identity must never be derived from a project path.
    if (spec.specificationKey.includes("@") || /i2c@/i.test(spec.specificationKey)) {
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
        propertyKey: spec.propertyKey ?? def.name,
        inferred
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

    const propertyKey = propertyKeyFromPath(value.source_node_path, mappedDef.spec.propertyKey ?? "");
    const resolvedNode = await resolveLogicalNodeId(db, {
      projectId: value.project_id,
      sourceNodePath: value.source_node_path,
      sourceFileName: value.source_file_name
    });
    if (resolvedNode.kind === "ambiguous") {
      ambiguousRecords += 1;
      blockers.push(
        `ambiguous logical node for value ${value.id} path=${value.source_node_path}: ${resolvedNode.logicalNodeIds.join(",")}`
      );
      await ensureAmbiguityTasks(db, {
        apply,
        organizationId: value.organization_id,
        projectId: value.project_id,
        configRevisionId: null,
        reason: `ambiguous logical node for ${value.source_node_path}`,
        candidateLogicalNodeIds: resolvedNode.logicalNodeIds,
        evidence: {
          projectParameterValueId: value.id,
          sourceFileName: value.source_file_name,
          sourceNodePath: value.source_node_path
        }
      });
      continue;
    }

    let logicalNodeId: string | null = null;
    let driverName: string | null = null;
    let schemaNamespace: string | null = mappedDef.spec.schemaNamespace;
    let configRevisionId: string | null = null;

    if (resolvedNode.kind === "one") {
      logicalNodeId = resolvedNode.logicalNodeId;
      driverName = resolvedNode.nodeName;
      configRevisionId = resolvedNode.configRevisionId;
      if (resolvedNode.compatible) {
        const compat = resolvedNode.compatible.replace(/^"+|"+$/g, "");
        const vendorDriver = compat.split(",").pop()?.trim() ?? null;
        if (vendorDriver) driverName = vendorDriver;
      }
      if (resolvedNode.driverSchemaVersionId) {
        const driver = await db.query<{ schema_namespace: string | null }>(
          `
          select ds.schema_namespace
          from driver_schema_versions dsv
          inner join driver_schemas ds on ds.id = dsv.driver_schema_id
          where dsv.id = $1
          limit 1
          `,
          [resolvedNode.driverSchemaVersionId]
        );
        schemaNamespace = driver.rows[0]?.schema_namespace ?? schemaNamespace;
      }
    } else if (value.source_node_path) {
      // Path present but no effective logical node yet — still bind with null node
      // when the Parameter Spec is uniquely determined; record soft blocker only when
      // the project already has logical nodes that should have matched.
      const projectNodes = await db.query<{ c: string }>(
        `select count(*)::text as c from dts_logical_nodes where project_id = $1`,
        [value.project_id]
      );
      if (Number(projectNodes.rows[0]?.c ?? 0) > 0) {
        // Soft: keep mapping via inferred/catalog spec; history chain still preserved.
        // Explicit mapping task only when apply and a config revision exists.
        const latestRevision = await db.query<{ id: string }>(
          `
          select id from dts_config_revisions
          where project_id = $1
          order by revision_number desc
          limit 1
          `,
          [value.project_id]
        );
        if (latestRevision.rows[0]?.id) {
          await ensureAmbiguityTasks(db, {
            apply,
            organizationId: value.organization_id,
            projectId: value.project_id,
            configRevisionId: latestRevision.rows[0].id,
            reason: `unmapped logical node for ${value.source_node_path}`,
            candidateLogicalNodeIds: [],
            evidence: {
              projectParameterValueId: value.id,
              sourceFileName: value.source_file_name,
              sourceNodePath: value.source_node_path,
              propertyKey
            }
          });
        }
      }
    }

    // Re-resolve catalog match with driver/compatible evidence when available.
    let valueSpec = mappedDef.spec;
    if (driverName || schemaNamespace) {
      const refined = await loadSpecCandidates(db, {
        organizationId: value.organization_id,
        propertyKey: propertyKey || mappedDef.spec.propertyKey || "",
        module: mappedDef.spec.schemaNamespace || driverName || "unknown",
        schemaNamespace,
        driverName
      });
      if (refined.length === 1) {
        valueSpec = refined[0]!;
      } else if (refined.length > 1) {
        const exactDriver = refined.filter(
          (c) =>
            driverName &&
            (c.specificationKey.startsWith(`${driverName}/`) ||
              c.specificationKey.startsWith(`${sanitizeSpecSegment(driverName)}/`))
        );
        if (exactDriver.length === 1) {
          valueSpec = exactDriver[0]!;
        } else if (exactDriver.length > 1) {
          ambiguousRecords += 1;
          blockers.push(
            `ambiguous driver spec for value ${value.id}: ${exactDriver.map((c) => c.parameterSpecId).join(",")}`
          );
          await ensureAmbiguityTasks(db, {
            apply,
            organizationId: value.organization_id,
            projectId: value.project_id,
            configRevisionId,
            reason: `ambiguous driver property spec for ${propertyKey}`,
            parameterSpecIds: exactDriver.map((c) => c.parameterSpecId),
            evidence: {
              projectParameterValueId: value.id,
              driverName,
              schemaNamespace,
              propertyKey,
              sourceFileName: value.source_file_name,
              sourceNodePath: value.source_node_path,
              configRevisionId
            }
          });
          continue;
        }
      }
    }

    const bindingId = await ensureBinding(db, {
      organizationId: value.organization_id,
      projectId: value.project_id,
      logicalNodeId,
      parameterSpecId: valueSpec.parameterSpecId,
      apply
    });

    await ensureBindingRevision(db, {
      bindingId,
      projectId: value.project_id,
      parameterSpecVersionId: valueSpec.parameterSpecVersionId,
      currentValue: value.current_value,
      apply
    });

    if (apply && options.injectFailure && mappedProjectValues === 0) {
      throw new Error("injected apply failure");
    }

    // Never promote recommended_value into schema_default or policy_target.
    const evidenceId = await insertEvidence(db, {
      apply,
      organizationId: value.organization_id,
      legacyKind: "project_parameter_value",
      legacyId: value.id,
      legacyName: valueSpec.specificationKey,
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
      parameterSpecId: valueSpec.parameterSpecId,
      parameterSpecVersionId: valueSpec.parameterSpecVersionId,
      bindingId,
      migrationRunId,
      evidence: {
        note: "recommended_value preserved as evidence only",
        logicalNodeId,
        sourceFileName: value.source_file_name,
        sourceNodePath: value.source_node_path,
        propertyKey,
        driverName,
        schemaNamespace,
        configRevisionId
      }
    });
    evidenceRows += 1;
    mappedProjectValues += 1;
    valueMap.set(value.id, {
      bindingId,
      spec: valueSpec,
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
  const database = requireTransactionalDb(db);
  await requireMigrationInfrastructure(db);

  const run = await db.query<{ status: string; report: unknown }>(
    `select status, report from parameter_identity_migration_runs where id = $1`,
    [options.migrationRunId]
  );
  if (!run.rows[0] || run.rows[0].status !== "completed") {
    throw new Error(`cutover requires completed migration run ${options.migrationRunId}`);
  }

  const sqlPath = options.cutoverSqlPath ?? defaultCutoverSqlPath();
  let sql = await fs.readFile(sqlPath, "utf8");
  sql = sql.replaceAll("{{MIGRATION_RUN_ID}}", options.migrationRunId);
  sql = sql.replaceAll("{{CUTOVER_ID}}", randomUUID());
  sql = sql
    .replace(/^\s*begin\s*;/im, "")
    .replace(/\bcommit\s*;\s*$/im, "")
    .trim();

  const parts = sql.split(CUTOVER_FAILURE_INJECT_POINT);
  const beforeInject = parts[0]?.trim() ?? "";
  const afterInject = parts.slice(1).join(CUTOVER_FAILURE_INJECT_POINT).trim();

  await database.transaction(async (tx) => {
    if (beforeInject) {
      await tx.query(beforeInject);
    }
    if (options.injectFailure) {
      throw new Error("injected cutover failure");
    }
    if (afterInject) {
      await tx.query(afterInject);
    }
  });
}

export async function checkParameterIdentityCutover(db: Queryable): Promise<{
  ok: boolean;
  blockers: string[];
  cutoverComplete: boolean;
  migrationRuns: number;
}> {
  await requireMigrationInfrastructure(db);
  const blockers: string[] = [];

  let unmappedDefCount = 0;
  try {
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
    );
    unmappedDefCount = Number(unmappedDefs.rows[0]?.c ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Missing table after cutover is expected; any other SQL error is a real blocker.
    if (!/parameter_definitions/i.test(message) || !/does not exist|undefined_table|42P01/i.test(message)) {
      blockers.push(`cutover check SQL failed (definitions): ${message}`);
    }
  }

  const openMapping = await db.query<{ c: string }>(
    `select count(*)::text as c from identity_mapping_tasks where status = 'open'`
  );
  if (Number(openMapping.rows[0]?.c ?? 0) > 0) {
    blockers.push("open identity mapping tasks remain");
  }

  let nullHistoryCount = 0;
  try {
    const nullHistory = await db.query<{ c: string }>(
      `
      select count(*)::text as c from parameter_history_entries
      where project_parameter_binding_id is null
      `
    );
    nullHistoryCount = Number(nullHistory.rows[0]?.c ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    blockers.push(`cutover check SQL failed (history): ${message}`);
  }
  if (nullHistoryCount > 0) {
    blockers.push("history rows missing binding ids");
  }

  if (unmappedDefCount > 0) {
    blockers.push("definitions without migration evidence");
  }

  const cutovers = await db.query<{ c: string }>(
    `select count(*)::text as c from parameter_identity_cutovers`
  );
  const runs = await db.query<{ c: string }>(
    `select count(*)::text as c from parameter_identity_migration_runs where status = 'completed'`
  );

  // After cutover, active workflow tables must not retain FKs to archived PPV tables.
  try {
    const legacyPpvFks = await db.query<{ c: string }>(
      `
      select count(*)::text as c
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
        and con.contype = 'f'
        and pg_get_constraintdef(con.oid) ilike '%legacy_project_parameter_values%'
        and rel.relname in (
          'parameter_history_entries',
          'parameter_drafts',
          'parameter_change_requests',
          'parameter_submission_items',
          'parameter_file_sync_conflicts'
        )
      `
    );
    if (Number(legacyPpvFks.rows[0]?.c ?? 0) > 0) {
      blockers.push("active workflow tables still depend on legacy PPV foreign keys");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    blockers.push(`cutover check SQL failed (legacy PPV FK scan): ${message}`);
  }

  return {
    ok: blockers.length === 0,
    blockers,
    cutoverComplete: Number(cutovers.rows[0]?.c ?? 0) > 0,
    migrationRuns: Number(runs.rows[0]?.c ?? 0)
  };
}
