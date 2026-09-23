import type { Queryable } from "../../shared/database/client";
import { canonicalizeLogicalNodeCompatible } from "../parameter-topology/writeLock";
import type {
  PreflightDiagnostic,
  PreflightStep
} from "./preflight";
import { parseKernelSignal } from "./kernelSignal";
import { parseBehaviouralVerification } from "./behaviouralVerify";
import type {
  IntegrityCheckStrength,
  ReloadCandidateDto,
  ReloadCandidateLastReloadDto,
  ReloadRunDto,
  ReloadRunListCursor,
  ReloadRunListItemDto,
  ReloadRunPurpose,
  ReloadRunStatus,
  ReloadRunTargetDto,
  ReloadSnapshotDto,
  ReloadStep
} from "./types";

export type ReloadCandidateRow = {
  binding_id: string;
  project_id: string;
  definition_id: string;
  definition_revision_id: string;
  current_value_id: string;
  catalog_release_id: string;
  source_pin_id: string;
  source_occurrence_id: string;
  source_format: "dts" | "json";
  source_ref: string;
  source_locator: unknown;
  value_kind: "string" | "number" | "boolean" | "string-array" | "number-array" | "json";
  value_payload: unknown;
  definition_content: unknown;
  value_schema: unknown;
  property_key: string;
  display_name: string;
  /** Binding module id when assigned; used by the UI module navigator hierarchy. */
  module_id: string | null;
  module_name: string;
  node_path: string | null;
  compatible: string | null;
  /** Config revision the baseline binding revision and node locator were taken from. */
  config_revision_id: string | null;
  baseline_value: string | null;
  /** Resolved parameter meaning: documentation, else description. */
  description: unknown;
  value_shape: unknown;
  unit: unknown;
  constraints: unknown;
};

export type InsertReloadRunInput = {
  id: string;
  organizationId: string;
  projectId: string;
  configRevisionId: string | null;
  status: ReloadRunStatus;
  purpose?: ReloadRunPurpose;
  /** Pinned at start for restore-baseline; ordinary runs leave null until deploy. */
  deviceId?: string | null;
  /** Residue source run this restore compensates; required for restore-baseline clears. */
  restoresSourceRunId?: string | null;
  failureCode: string | null;
  steps: Array<PreflightStep | ReloadStep>;
  diagnostics: PreflightDiagnostic[];
  toolVersions: { dtc: string | null; fdtoverlay: string | null };
  overlaySourceStorageKey: string | null;
  overlaySourceSha256: string | null;
  overlayArtifactStorageKey: string | null;
  overlayArtifactSha256: string | null;
  overlayArtifactBytes: number | null;
  createdByUserId: string | null;
  completedAt: string | null;
};

export type InsertReloadRunTargetInput = {
  id: string;
  reloadRunId: string;
  /** Legacy binding_id is retained for old history and must stay null for canonical rows. */
  bindingId?: string | null;
  nodePath: string;
  propertyKey: string;
  baselineValue: string | null;
  debugValue: string;
  sortOrder: number;
  canonicalBindingId?: string;
  canonicalDefinitionId?: string;
  canonicalDefinitionRevisionId?: string;
  canonicalCurrentValueId?: string;
  canonicalCatalogReleaseId?: string;
  canonicalSourcePinId?: string;
  canonicalSourceOccurrenceId?: string;
  canonicalConfigRevisionId?: string;
  canonicalSourceRef?: string;
  canonicalSourceFormat?: "dts" | "json";
  canonicalSourceLocator?: unknown;
};

export type UpdateReloadRunDeployInput = {
  runId: string;
  organizationId: string;
  status: ReloadRunStatus;
  failureCode: string | null;
  steps: Array<PreflightStep | ReloadStep>;
  deviceId: string | null;
  bridgeId: string | null;
  bridgeMachineLabel: string | null;
  targetRef: string | null;
  protocol: string | null;
  integrityCheck: IntegrityCheckStrength | null;
  reloadSnapshot: ReloadSnapshotDto;
  completedAt: string | null;
};

type ReloadRunRow = {
  id: string;
  organization_id: string;
  project_id: string;
  config_revision_id: string | null;
  status: ReloadRunStatus;
  purpose?: ReloadRunPurpose | null;
  restores_source_run_id?: string | null;
  failure_code: string | null;
  steps: unknown;
  diagnostics: unknown;
  tool_versions: unknown;
  overlay_source_storage_key: string | null;
  overlay_source_sha256: string | null;
  overlay_artifact_storage_key: string | null;
  overlay_artifact_sha256: string | null;
  overlay_artifact_bytes: number | string | null;
  created_by_user_id: string | null;
  created_at: string | Date;
  completed_at: string | Date | null;
  device_id?: string | null;
  bridge_id?: string | null;
  bridge_machine_label?: string | null;
  target_ref?: string | null;
  protocol?: string | null;
  integrity_check?: string | null;
  reload_snapshot?: unknown;
};

type ReloadRunTargetRow = {
  binding_id: string | null;
  canonical_binding_id: string | null;
  canonical_definition_id: string | null;
  canonical_definition_revision_id: string | null;
  canonical_current_value_id: string | null;
  canonical_catalog_release_id: string | null;
  canonical_source_pin_id: string | null;
  canonical_source_occurrence_id: string | null;
  canonical_config_revision_id: string | null;
  canonical_source_ref: string | null;
  canonical_source_format: "dts" | "json" | null;
  canonical_source_locator: unknown;
  node_path: string;
  property_key: string;
  baseline_value: string | null;
  debug_value: string;
  sort_order: number | string;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function asJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asToolVersions(value: unknown): { dtc: string | null; fdtoverlay: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { dtc: null, fdtoverlay: null };
  }
  const record = value as Record<string, unknown>;
  return {
    dtc: typeof record.dtc === "string" ? record.dtc : null,
    fdtoverlay: typeof record.fdtoverlay === "string" ? record.fdtoverlay : null
  };
}

function asIntegrityCheck(value: unknown): IntegrityCheckStrength | null {
  if (value === "sha256" || value === "md5" || value === "byte-length") return value;
  return null;
}

function asReloadPurpose(value: unknown): ReloadRunPurpose {
  return value === "restore-baseline" ? "restore-baseline" : "ordinary";
}

function asReloadSnapshot(value: unknown): ReloadSnapshotDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const baselines = Array.isArray(record.libraryBaselines) ? record.libraryBaselines : [];
  const artifactDigest =
    record.artifactDigest && typeof record.artifactDigest === "object" && !Array.isArray(record.artifactDigest)
      ? (record.artifactDigest as Record<string, unknown>)
      : null;
  return {
    libraryBaselines: baselines
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        bindingId: typeof entry.bindingId === "string" ? entry.bindingId : "",
        propertyKey: typeof entry.propertyKey === "string" ? entry.propertyKey : "",
        nodePath: typeof entry.nodePath === "string" ? entry.nodePath : "",
        baselineValue: typeof entry.baselineValue === "string" ? entry.baselineValue : null
      })),
    artifactDigest: artifactDigest
      ? {
          sha256: typeof artifactDigest.sha256 === "string" ? artifactDigest.sha256 : "",
          onDeviceDigest: typeof artifactDigest.onDeviceDigest === "string" ? artifactDigest.onDeviceDigest : null,
          integrityCheck: asIntegrityCheck(artifactDigest.integrityCheck)
        }
      : null,
    kernelSignal: parseKernelSignal(record.kernelSignal),
    behaviouralVerification: parseBehaviouralVerification(record.behaviouralVerification)
  };
}

function toTargetDto(row: ReloadRunTargetRow): ReloadRunTargetDto {
  return {
    bindingId: row.canonical_binding_id ?? row.binding_id ?? "",
    nodePath: row.node_path,
    propertyKey: row.property_key,
    baselineValue: row.baseline_value,
    debugValue: row.debug_value,
    ...(row.canonical_binding_id
      ? {
          canonicalBindingId: row.canonical_binding_id,
          canonicalDefinitionId: row.canonical_definition_id,
          canonicalDefinitionRevisionId: row.canonical_definition_revision_id,
          canonicalCurrentValueId: row.canonical_current_value_id,
          canonicalCatalogReleaseId: row.canonical_catalog_release_id,
          canonicalSourcePinId: row.canonical_source_pin_id,
          canonicalSourceOccurrenceId: row.canonical_source_occurrence_id,
          canonicalConfigRevisionId: row.canonical_config_revision_id,
          canonicalSourceRef: row.canonical_source_ref,
          canonicalSourceFormat: row.canonical_source_format,
          canonicalSourceLocator: row.canonical_source_locator
        }
      : {})
  };
}

export function toReloadRunDto(
  row: ReloadRunRow,
  targets: ReloadRunTargetDto[],
  overlaySource: string | null,
  options: { artifactRetentionExpired?: boolean } = {}
): ReloadRunDto {
  const artifactSha = row.overlay_artifact_sha256;
  const artifactBytes = row.overlay_artifact_bytes;
  const snapshot = asReloadSnapshot(row.reload_snapshot);
  return {
    id: row.id,
    projectId: row.project_id,
    configRevisionId: row.config_revision_id,
    status: row.status,
    purpose: asReloadPurpose(row.purpose),
    restoresSourceRunId:
      typeof row.restores_source_run_id === "string" && row.restores_source_run_id.trim()
        ? row.restores_source_run_id
        : null,
    failureCode: row.failure_code,
    targets,
    steps: asJsonArray<PreflightStep | ReloadStep>(row.steps),
    diagnostics: asJsonArray<PreflightDiagnostic>(row.diagnostics),
    toolVersions: asToolVersions(row.tool_versions),
    overlaySource,
    overlaySourceSha256: row.overlay_source_sha256,
    artifact:
      artifactSha && artifactBytes !== null && artifactBytes !== undefined
        ? {
            fileName: `debug-overlay-${row.id}.dtbo`,
            sha256: artifactSha,
            sizeBytes: Number(artifactBytes)
          }
        : null,
    deviceId: row.device_id ?? null,
    bridgeId: row.bridge_id ?? null,
    bridgeMachineLabel: row.bridge_machine_label ?? null,
    targetRef: row.target_ref ?? null,
    protocol: row.protocol ?? null,
    integrityCheck: asIntegrityCheck(row.integrity_check),
    reloadSnapshot: snapshot &&
    (snapshot.libraryBaselines.length > 0 ||
      snapshot.artifactDigest ||
      snapshot.kernelSignal ||
      snapshot.behaviouralVerification)
      ? snapshot
      : null,
    artifactRetentionExpired: options.artifactRetentionExpired === true,
    createdAt: dateTimeToIso(row.created_at),
    completedAt: row.completed_at ? dateTimeToIso(row.completed_at) : null
  };
}

const canonicalReloadCandidateSelect = [
  "select",
  "  binding.id as binding_id,",
  "  binding.project_id as project_id,",
  "  binding.definition_id as definition_id,",
  "  binding.effective_revision_id as definition_revision_id,",
  "  binding.current_value_id as current_value_id,",
  "  binding.catalog_release_id as catalog_release_id,",
  "  definition.property_key as property_key,",
  "  coalesce(nullif(revision.content ->> 'displayName', ''), definition.property_key) as display_name,",
  "  placement.module_id as module_id,",
  "  coalesce(module.name, '') as module_name,",
  "  coalesce(nullif(logical_revision.node_locator, ''), nullif(node.ref_target, ''), nullif(node.node_path, '')) as node_path,",
  "  logical_revision.compatible as compatible,",
  "  pin.config_revision_id as config_revision_id,",
  "  value.source_ref as source_ref,",
  "  value.value_kind as value_kind,",
  "  value.value as value_payload,",
  "  revision.content as definition_content,",
  "  pin.id as source_pin_id,",
  "  pin.source_occurrence_id as source_occurrence_id,",
  "  pin.format as source_format,",
  "  pin.locator as source_locator,",
  "  coalesce(revision.content -> 'valueShape', 'null'::jsonb) as value_shape,",
  "  coalesce(revision.content -> 'constraints', '{}'::jsonb) as constraints,",
  "  revision.content -> 'valueSchema' as value_schema,",
  "  revision.content -> 'unit' as unit,",
  "  revision.content -> 'documentation' as documentation,",
  "  revision.content -> 'description' as definition_description,",
  "  null::text as baseline_value,",
  "  null::text as description",
  "from parameter_catalog.current_project_parameter_bindings binding",
  "join parameter_catalog.parameter_definitions definition on definition.id = binding.definition_id",
  "join parameter_catalog.definition_revisions revision",
  "  on revision.id = binding.effective_revision_id",
  " and revision.definition_id = binding.definition_id",
  " and revision.catalog_release_id = binding.catalog_release_id",
  "join parameter_catalog.project_parameter_values value",
  "  on value.id = binding.current_value_id",
  " and value.binding_id = binding.id",
  " and value.definition_id = binding.definition_id",
  "join parameter_catalog.project_value_source_pins pin",
  "  on pin.project_value_id = value.id",
  " and pin.binding_id = binding.id",
  " and pin.definition_id = binding.definition_id",
  " and pin.organization_id = binding.organization_id",
  " and pin.project_id = binding.project_id",
  " and pin.source_occurrence_id = binding.source_occurrence_id",
  " and pin.config_revision_id = value.config_revision_id",
  "left join parameter_catalog.project_parameter_source_occurrences occurrence",
  "  on occurrence.id = pin.source_occurrence_id",
  " and occurrence.organization_id = binding.organization_id",
  " and occurrence.project_id = binding.project_id",
  " and occurrence.file_id = pin.file_id",
  "left join dts_logical_node_revisions logical_revision",
  "  on logical_revision.logical_node_id = occurrence.logical_node_id",
  " and logical_revision.config_revision_id = pin.config_revision_id",
  "left join dts_property_occurrences property",
  "  on property.id = pin.property_occurrence_id",
  " and property.config_revision_id = pin.config_revision_id",
  " and property.file_version_id = pin.file_version_id",
  "left join dts_node_occurrences node",
  "  on node.id = property.node_occurrence_id",
  " and node.config_revision_id = property.config_revision_id",
  " and node.file_version_id = property.file_version_id",
  "left join parameter_catalog.organization_subject_registrations registration",
  "  on registration.id = binding.registration_id",
  "left join parameter_catalog.subject_placements placement",
  "  on placement.id = registration.current_placement_id",
  "left join public.parameter_modules module",
  "  on module.id = placement.module_id",
  "where binding.organization_id = $1",
  "  and binding.project_id = $2",
  "  and pin.format = 'dts'"
].join("\n");

/**
 * List project bindings enriched with the exact canonical value and DTS source pin.
 * The legacy project_parameter_bindings/specification tables are deliberately absent:
 * an old id cannot make a parameter a reload candidate after the canonical cutover.
 */
export async function listReloadCandidateRows(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<ReloadCandidateRow[]> {
  const result = await db.query<ReloadCandidateRow>(
    canonicalReloadCandidateSelect + "\norder by coalesce(node_path, ''), property_key",
    [input.organizationId, input.projectId]
  );

  return result.rows.map((row) => ({ ...row, compatible: canonicalizeLogicalNodeCompatible(row.compatible) }));
}

export async function getReloadCandidateRow(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string }
): Promise<ReloadCandidateRow | null> {
  const result = await db.query<ReloadCandidateRow>(
    canonicalReloadCandidateSelect + "\nand binding.id = $3\nlimit 1",
    [input.organizationId, input.projectId, input.bindingId]
  );

  const row = result.rows[0];
  return row ? { ...row, compatible: canonicalizeLogicalNodeCompatible(row.compatible) } : null;
}

export async function insertReloadRun(db: Queryable, input: InsertReloadRunInput): Promise<ReloadRunRow> {
  const purpose = input.purpose ?? "ordinary";
  const result = await db.query<ReloadRunRow>(
    `
    insert into dts_reload_runs (
      id, organization_id, project_id, config_revision_id, status, purpose, failure_code,
      steps, diagnostics, tool_versions,
      overlay_source_storage_key, overlay_source_sha256,
      overlay_artifact_storage_key, overlay_artifact_sha256, overlay_artifact_bytes,
      created_by_user_id, completed_at, device_id, restores_source_run_id
    ) values (
      $1, $2, $3, $4, $5, $6, $7,
      $8::jsonb, $9::jsonb, $10::jsonb,
      $11, $12,
      $13, $14, $15,
      $16, $17, $18, $19
    )
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.configRevisionId,
      input.status,
      purpose,
      input.failureCode,
      JSON.stringify(input.steps),
      JSON.stringify(input.diagnostics),
      JSON.stringify(input.toolVersions),
      input.overlaySourceStorageKey,
      input.overlaySourceSha256,
      input.overlayArtifactStorageKey,
      input.overlayArtifactSha256,
      input.overlayArtifactBytes,
      input.createdByUserId,
      input.completedAt,
      input.deviceId ?? null,
      input.restoresSourceRunId ?? null
    ]
  );

  return result.rows[0];
}

export async function insertReloadRunTarget(db: Queryable, input: InsertReloadRunTargetInput): Promise<void> {
  await db.query(
    `
    insert into dts_reload_run_targets (
      id, reload_run_id, binding_id, node_path, property_key, baseline_value, debug_value, sort_order,
      canonical_binding_id, canonical_definition_id, canonical_definition_revision_id,
      canonical_current_value_id, canonical_catalog_release_id, canonical_source_pin_id,
      canonical_source_occurrence_id, canonical_config_revision_id, canonical_source_ref,
      canonical_source_format, canonical_source_locator
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb
    )
    `,
    [
      input.id,
      input.reloadRunId,
      input.bindingId,
      input.nodePath,
      input.propertyKey,
      input.baselineValue,
      input.debugValue,
      input.sortOrder,
      input.canonicalBindingId ?? null,
      input.canonicalDefinitionId ?? null,
      input.canonicalDefinitionRevisionId ?? null,
      input.canonicalCurrentValueId ?? null,
      input.canonicalCatalogReleaseId ?? null,
      input.canonicalSourcePinId ?? null,
      input.canonicalSourceOccurrenceId ?? null,
      input.canonicalConfigRevisionId ?? null,
      input.canonicalSourceRef ?? null,
      input.canonicalSourceFormat ?? null,
      input.canonicalSourceLocator === undefined ? null : JSON.stringify(input.canonicalSourceLocator)
    ]
  );
}

function deployStateUpdateParams(input: UpdateReloadRunDeployInput) {
  return [
    input.organizationId,
    input.runId,
    input.status,
    input.failureCode,
    JSON.stringify(input.steps),
    input.deviceId,
    input.bridgeId,
    input.bridgeMachineLabel,
    input.targetRef,
    input.protocol,
    input.integrityCheck,
    JSON.stringify(input.reloadSnapshot),
    input.completedAt
  ] as const;
}

export async function updateReloadRunDeployState(
  db: Queryable,
  input: UpdateReloadRunDeployInput
): Promise<ReloadRunRow> {
  const result = await db.query<ReloadRunRow>(
    `
    update dts_reload_runs
    set
      status = $3,
      failure_code = $4,
      steps = $5::jsonb,
      device_id = $6,
      bridge_id = $7,
      bridge_machine_label = $8,
      target_ref = $9,
      protocol = $10,
      integrity_check = $11,
      reload_snapshot = $12::jsonb,
      completed_at = $13,
      deploy_claimed_at = case when $3 = 'deploying' then now() else deploy_claimed_at end
    where organization_id = $1 and id = $2
    returning *
    `,
    [...deployStateUpdateParams(input)]
  );
  if (!result.rows[0]) {
    throw new Error(`Reload run ${input.runId} was not found for deploy update.`);
  }
  return result.rows[0];
}

/**
 * Atomically claim a validated/failed run for deploy (`→ deploying`).
 * Returns null when another deployer already claimed the run (or status is not deployable).
 */
export async function claimReloadRunForDeploy(
  db: Queryable,
  input: UpdateReloadRunDeployInput
): Promise<ReloadRunRow | null> {
  if (input.status !== "deploying") {
    throw new Error(`claimReloadRunForDeploy expects status "deploying", got "${input.status}".`);
  }
  const result = await db.query<ReloadRunRow>(
    `
    update dts_reload_runs
    set
      status = $3,
      failure_code = $4,
      steps = $5::jsonb,
      device_id = $6,
      bridge_id = $7,
      bridge_machine_label = $8,
      target_ref = $9,
      protocol = $10,
      integrity_check = $11,
      reload_snapshot = $12::jsonb,
      completed_at = $13,
      deploy_claimed_at = now()
    where organization_id = $1
      and id = $2
      and status = any($14::text[])
    returning *
    `,
    [...deployStateUpdateParams(input), ["validated", "failed"]]
  );
  return result.rows[0] ?? null;
}

export type ReclaimedDeployingRunRow = {
  id: string;
  organization_id: string;
};

/**
 * Reset runs wedged in `deploying` — heartbeat (`deploy_claimed_at`, else `created_at`) older than
 * `olderThanIso` — back to `failed` so they can be deployed again. Cross-organization platform
 * maintenance. The time gate must exceed the worst-case deploy window so a live deployer's run is
 * never reclaimed mid-flight. Batched via a bounded subselect.
 */
export async function reclaimStaleDeployingReloadRunRows(
  db: Queryable,
  input: { olderThanIso: string; failureCode: string; limit: number }
): Promise<ReclaimedDeployingRunRow[]> {
  const result = await db.query<ReclaimedDeployingRunRow>(
    `
    update dts_reload_runs
    set status = 'failed',
        failure_code = $2,
        completed_at = now()
    where id in (
      select id
      from dts_reload_runs
      where status = 'deploying'
        and coalesce(deploy_claimed_at, created_at) < $1::timestamptz
      order by coalesce(deploy_claimed_at, created_at) asc
      limit $3
    )
    returning id, organization_id
    `,
    [input.olderThanIso, input.failureCode, input.limit]
  );
  return result.rows;
}

export type ExpiredReloadArtifactRow = {
  id: string;
  organization_id: string;
  overlay_artifact_storage_key: string | null;
  overlay_source_storage_key: string | null;
};

/**
 * Runs whose retention anchor (completed_at, else created_at) is older than `olderThanIso` and
 * that still hold at least one object-store key. Cross-organization by design — this is a
 * platform maintenance sweep, not a tenant-scoped read.
 */
export async function listExpiredReloadArtifactRuns(
  db: Queryable,
  input: { olderThanIso: string; limit: number; organizationId?: string }
): Promise<ExpiredReloadArtifactRow[]> {
  const result = await db.query<ExpiredReloadArtifactRow>(
    `
    select id, organization_id, overlay_artifact_storage_key, overlay_source_storage_key
    from dts_reload_runs
    where coalesce(completed_at, created_at) < $1::timestamptz
      and (overlay_artifact_storage_key is not null or overlay_source_storage_key is not null)
      and ($3::text is null or organization_id = $3)
    order by coalesce(completed_at, created_at) asc
    limit $2
    `,
    [input.olderThanIso, input.limit, input.organizationId ?? null]
  );
  return result.rows;
}

/**
 * Null the object-store keys after their blobs are physically deleted. Digests, byte sizes, and the
 * reload snapshot stay on the row so history and audit remain intact; retention checks report the
 * artifact as expired by timestamp regardless of key presence.
 */
export async function clearReloadRunStorageKeys(
  db: Queryable,
  input: { organizationId: string; runId: string }
): Promise<void> {
  await db.query(
    `
    update dts_reload_runs
    set overlay_artifact_storage_key = null,
        overlay_source_storage_key = null
    where organization_id = $1 and id = $2
    `,
    [input.organizationId, input.runId]
  );
}

export async function getReloadRunRow(
  db: Queryable,
  input: { organizationId: string; runId: string }
): Promise<ReloadRunRow | null> {
  const result = await db.query<ReloadRunRow>(
    `
    select *
    from dts_reload_runs
    where organization_id = $1 and id = $2
    limit 1
    `,
    [input.organizationId, input.runId]
  );
  return result.rows[0] ?? null;
}

export type ListReloadRunsQuery = {
  organizationId: string;
  projectId?: string;
  deviceId?: string;
  cursor?: ReloadRunListCursor;
  limit: number;
};

type ReloadRunListRow = {
  id: string;
  project_id: string;
  status: ReloadRunStatus;
  purpose?: ReloadRunPurpose | null;
  failure_code: string | null;
  device_id: string | null;
  created_at: string | Date;
  completed_at: string | Date | null;
  overlay_artifact_sha256: string | null;
  overlay_artifact_bytes: number | string | null;
  integrity_check: string | null;
  target_count: string | number;
  property_keys: string[] | null;
};

function toReloadRunListItem(row: ReloadRunListRow): ReloadRunListItemDto {
  const artifactSha = row.overlay_artifact_sha256;
  const artifactBytes = row.overlay_artifact_bytes;
  return {
    id: row.id,
    projectId: row.project_id,
    deviceId: row.device_id,
    status: row.status,
    purpose: asReloadPurpose(row.purpose),
    failureCode: row.failure_code,
    targetCount: Number(row.target_count ?? 0),
    propertyKeys: Array.isArray(row.property_keys) ? row.property_keys.filter((key) => typeof key === "string") : [],
    artifact:
      artifactSha && artifactBytes !== null && artifactBytes !== undefined
        ? {
            fileName: `debug-overlay-${row.id}.dtbo`,
            sha256: artifactSha,
            sizeBytes: Number(artifactBytes)
          }
        : null,
    integrityCheck: asIntegrityCheck(row.integrity_check),
    createdAt: dateTimeToIso(row.created_at),
    completedAt: row.completed_at ? dateTimeToIso(row.completed_at) : null
  };
}

/**
 * Paginated reload run history, most recent first. Includes blocked/failed/restore-baseline.
 */
export async function listReloadRunRows(
  db: Queryable,
  query: ListReloadRunsQuery
): Promise<{ items: ReloadRunListItemDto[]; nextCursor: ReloadRunListCursor | null }> {
  const values: unknown[] = [query.organizationId];
  const where = ["r.organization_id = $1"];

  if (query.projectId) {
    values.push(query.projectId);
    where.push(`r.project_id = $${values.length}`);
  }
  if (query.deviceId) {
    values.push(query.deviceId);
    where.push(`r.device_id = $${values.length}`);
  }
  if (query.cursor) {
    // The cursor carries millisecond-precision timestamps (JS ISO strings), while created_at is
    // microsecond-precision timestamptz. Truncate both sides to milliseconds so same-millisecond
    // rows fall back to the id tie-break instead of being skipped or repeated at the page boundary.
    values.push(query.cursor.createdAt, query.cursor.id);
    where.push(
      `(date_trunc('milliseconds', r.created_at), r.id) < (date_trunc('milliseconds', $${values.length - 1}::timestamptz), $${values.length})`
    );
  }

  values.push(query.limit + 1);
  const result = await db.query<ReloadRunListRow>(
    `
    select
      r.id,
      r.project_id,
      r.status,
      r.purpose,
      r.failure_code,
      r.device_id,
      r.created_at,
      r.completed_at,
      r.overlay_artifact_sha256,
      r.overlay_artifact_bytes,
      r.integrity_check,
      coalesce(t.target_count, 0) as target_count,
      coalesce(t.property_keys, '{}'::text[]) as property_keys
    from dts_reload_runs r
    left join lateral (
      select
        count(*)::int as target_count,
        array_agg(property_key order by sort_order asc, id asc) as property_keys
      from dts_reload_run_targets
      where reload_run_id = r.id
    ) t on true
    where ${where.join("\n      and ")}
    order by date_trunc('milliseconds', r.created_at) desc, r.id desc
    limit $${values.length}
    `,
    values
  );

  const hasMore = result.rows.length > query.limit;
  const items = result.rows.slice(0, query.limit).map(toReloadRunListItem);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null
  };
}

type LastReloadRow = {
  binding_id: string;
  run_id: string;
  debug_value: string;
  status: ReloadRunStatus;
  purpose?: ReloadRunPurpose | null;
  attempted_at: string | Date;
};

/**
 * Most recent reload attempt per binding within a project (for candidate enrichment).
 */
export async function listLastReloadByBindingIds(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingIds: string[] }
): Promise<Map<string, ReloadCandidateLastReloadDto>> {
  const map = new Map<string, ReloadCandidateLastReloadDto>();
  if (input.bindingIds.length === 0) {
    return map;
  }

  const result = await db.query<LastReloadRow>(
    `
    select distinct on (coalesce(t.canonical_binding_id, t.binding_id))
      coalesce(t.canonical_binding_id, t.binding_id) as binding_id,
      r.id as run_id,
      t.debug_value,
      r.status,
      r.purpose,
      coalesce(r.completed_at, r.created_at) as attempted_at
    from dts_reload_run_targets t
    join dts_reload_runs r on r.id = t.reload_run_id
    where r.organization_id = $1
      and r.project_id = $2
      and coalesce(t.canonical_binding_id, t.binding_id) = any($3::text[])
    order by coalesce(t.canonical_binding_id, t.binding_id), r.created_at desc, r.id desc
    `,
    [input.organizationId, input.projectId, input.bindingIds]
  );

  for (const row of result.rows) {
    map.set(row.binding_id, {
      runId: row.run_id,
      debugValue: row.debug_value,
      attemptedAt: dateTimeToIso(row.attempted_at),
      outcome: row.status,
      purpose: asReloadPurpose(row.purpose)
    });
  }
  return map;
}

export async function listReloadRunTargets(db: Queryable, reloadRunId: string): Promise<ReloadRunTargetDto[]> {
  const result = await db.query<ReloadRunTargetRow>(
    `
    select
      binding_id,
      canonical_binding_id,
      canonical_definition_id,
      canonical_definition_revision_id,
      canonical_current_value_id,
      canonical_catalog_release_id,
      canonical_source_pin_id,
      canonical_source_occurrence_id,
      canonical_config_revision_id,
      canonical_source_ref,
      canonical_source_format,
      canonical_source_locator,
      node_path,
      property_key,
      baseline_value,
      debug_value,
      sort_order
    from dts_reload_run_targets
    where reload_run_id = $1
    order by sort_order asc, id asc
    `,
    [reloadRunId]
  );
  return result.rows.map(toTargetDto);
}

export type LibraryFingerprint = {
  bindingRevisionCount: number;
  bindingRevisionChecksum: string;
  draftCount: number;
  baselineCount: number;
  workingFileVersionTip: string;
};

/**
 * Snapshot of library-facing tables so a run can prove it mutated none of them.
 */
export async function readLibraryFingerprint(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<LibraryFingerprint> {
  const revisions = await db.query<{ count: string | number; checksum: string }>(
    `
    select
      count(*)::text as count,
      coalesce(
        md5(string_agg(
          binding.id || value.id || value.definition_revision_id || value.config_revision_id ||
          value.value_digest || value.source_ref || coalesce(pin.id, '') || coalesce(pin.locator::text, ''),
          '|' order by binding.id
        )),
        ''
      ) as checksum
    from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.project_parameter_values value
      on value.id = binding.current_value_id
     and value.binding_id = binding.id
     and value.definition_id = binding.definition_id
    left join parameter_catalog.project_value_source_pins pin
      on pin.project_value_id = value.id
     and pin.binding_id = binding.id
     and pin.organization_id = binding.organization_id
     and pin.project_id = binding.project_id
    where binding.organization_id = $1 and binding.project_id = $2
    `,
    [input.organizationId, input.projectId]
  );

  const drafts = await db.query<{ count: string | number }>(
    `
    select count(*)::text as count
    from project_parameter_value_drafts draft
    where draft.organization_id = $1 and draft.project_id = $2
    `,
    [input.organizationId, input.projectId]
  );

  const baselines = await db.query<{ count: string | number }>(
    `
    select count(*)::text as count
    from dts_release_baseline b
    join dts_config_set cs on cs.id = b.config_set_id
    where b.organization_id = $1 and cs.project_id = $2
    `,
    [input.organizationId, input.projectId]
  );

  const working = await db.query<{ tip: string }>(
    `
    select coalesce(string_agg(ppf.current_version_id, ',' order by ppf.id), '') as tip
    from project_parameter_files ppf
    where ppf.organization_id = $1 and ppf.project_id = $2
    `,
    [input.organizationId, input.projectId]
  );

  return {
    bindingRevisionCount: Number(revisions.rows[0]?.count ?? 0),
    bindingRevisionChecksum: revisions.rows[0]?.checksum ?? "",
    draftCount: Number(drafts.rows[0]?.count ?? 0),
    baselineCount: Number(baselines.rows[0]?.count ?? 0),
    workingFileVersionTip: working.rows[0]?.tip ?? ""
  };
}

export type ConfigSetMemberSourceRow = {
  file_id: string;
  file_version_id: string;
  file_name: string;
  role: string;
  sort_order: number | string;
  storage_key: string;
  format: string;
};

export async function listProjectDtsMemberSources(
  db: Queryable,
  input: { organizationId: string; projectId: string; configRevisionIds: string[] }
): Promise<ConfigSetMemberSourceRow[]> {
  const result = await db.query<ConfigSetMemberSourceRow>(
    `select distinct ppf.id as file_id, v.id as file_version_id,
       member.source_name as file_name, member.role, member.sort_order,
       v.storage_key, ppf.format
     from dts_config_revision_members member
     join dts_config_revisions revision on revision.id=member.config_revision_id
     join project_parameter_files ppf on ppf.id=member.file_id
       and ppf.config_set_id=revision.config_set_id
       and ppf.organization_id=revision.organization_id and ppf.project_id=revision.project_id
     join project_parameter_file_versions v on v.id=member.file_version_id and v.file_id=ppf.id
     where revision.organization_id=$1 and revision.project_id=$2
       and revision.id=any($3::text[]) and ppf.format='dts'
     order by member.sort_order, member.source_name, ppf.id, v.id`,
    [input.organizationId, input.projectId, input.configRevisionIds]
  );
  return result.rows;
}

/** Re-export for service consumers that map rows → DTOs. */
export type { ReloadCandidateDto };
