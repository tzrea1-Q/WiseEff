import type { Queryable } from "../../shared/database/client";
import type {
  PreflightDiagnostic,
  PreflightStep
} from "./preflight";
import { parseKernelSignal } from "./kernelSignal";
import { parseBehaviouralVerification } from "./behaviouralVerify";
import type {
  IntegrityCheckStrength,
  ReloadCandidateDto,
  ReloadRunDto,
  ReloadRunPurpose,
  ReloadRunStatus,
  ReloadRunTargetDto,
  ReloadSnapshotDto,
  ReloadStep
} from "./types";

export type ReloadCandidateRow = {
  binding_id: string;
  project_id: string;
  property_key: string;
  display_name: string;
  module_name: string;
  node_path: string | null;
  compatible: string | null;
  /** Config revision the baseline binding revision and node locator were taken from. */
  config_revision_id: string | null;
  baseline_value: string | null;
  value_shape: unknown;
  unit: string | null;
  constraints: unknown;
};

export type InsertReloadRunInput = {
  id: string;
  organizationId: string;
  projectId: string;
  configRevisionId: string | null;
  status: ReloadRunStatus;
  purpose?: ReloadRunPurpose;
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
  bindingId: string;
  nodePath: string;
  propertyKey: string;
  baselineValue: string | null;
  debugValue: string;
  sortOrder: number;
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
  binding_id: string;
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
    bindingId: row.binding_id,
    nodePath: row.node_path,
    propertyKey: row.property_key,
    baselineValue: row.baseline_value,
    debugValue: row.debug_value
  };
}

export function toReloadRunDto(
  row: ReloadRunRow,
  targets: ReloadRunTargetDto[],
  overlaySource: string | null
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
    createdAt: dateTimeToIso(row.created_at),
    completedAt: row.completed_at ? dateTimeToIso(row.completed_at) : null
  };
}

/**
 * List project bindings enriched with value shape, constraints, and locator for reload candidacy.
 */
export async function listReloadCandidateRows(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<ReloadCandidateRow[]> {
  const result = await db.query<ReloadCandidateRow>(
    `
    select
      b.id as binding_id,
      b.project_id as project_id,
      coalesce(
        dps.property_key,
        nullif(
          (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))],
          ''
        ),
        ''
      ) as property_key,
      coalesce(psv.display_name, dps.property_key, ps.specification_key) as display_name,
      coalesce(asub.display_name, pm.name, '') as module_name,
      lnr.node_locator as node_path,
      lnr.compatible as compatible,
      br.config_revision_id as config_revision_id,
      br.raw_value as baseline_value,
      psv.value_shape as value_shape,
      psv.units as unit,
      coalesce(dps.constraints, '{}'::jsonb) as constraints
    from project_parameter_bindings b
    join parameter_specs ps on ps.id = b.parameter_spec_id
    left join attribution_subjects asub on asub.id = ps.attribution_subject_id
    left join parameter_modules pm on pm.id = b.module_id
    left join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
    left join lateral (
      select *
      from project_parameter_binding_revisions
      where binding_id = b.id
      order by created_at desc
      limit 1
    ) br on true
    left join parameter_spec_versions psv on psv.id = br.parameter_spec_version_id
    left join lateral (
      select node_locator, compatible
      from dts_logical_node_revisions
      where logical_node_id = b.logical_node_id
        and config_revision_id = br.config_revision_id
      limit 1
    ) lnr on true
    where b.organization_id = $1
      and b.project_id = $2
      and br.parameter_spec_version_id is not null
    order by coalesce(lnr.node_locator, ''), coalesce(dps.property_key, ps.specification_key)
    `,
    [input.organizationId, input.projectId]
  );

  return result.rows;
}

export async function getReloadCandidateRow(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string }
): Promise<ReloadCandidateRow | null> {
  const result = await db.query<ReloadCandidateRow>(
    `
    select
      b.id as binding_id,
      b.project_id as project_id,
      coalesce(
        dps.property_key,
        nullif(
          (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))],
          ''
        ),
        ''
      ) as property_key,
      coalesce(psv.display_name, dps.property_key, ps.specification_key) as display_name,
      coalesce(asub.display_name, pm.name, '') as module_name,
      lnr.node_locator as node_path,
      lnr.compatible as compatible,
      br.config_revision_id as config_revision_id,
      br.raw_value as baseline_value,
      psv.value_shape as value_shape,
      psv.units as unit,
      coalesce(dps.constraints, '{}'::jsonb) as constraints
    from project_parameter_bindings b
    join parameter_specs ps on ps.id = b.parameter_spec_id
    left join attribution_subjects asub on asub.id = ps.attribution_subject_id
    left join parameter_modules pm on pm.id = b.module_id
    left join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
    left join lateral (
      select *
      from project_parameter_binding_revisions
      where binding_id = b.id
      order by created_at desc
      limit 1
    ) br on true
    left join parameter_spec_versions psv on psv.id = br.parameter_spec_version_id
    left join lateral (
      select node_locator, compatible
      from dts_logical_node_revisions
      where logical_node_id = b.logical_node_id
        and config_revision_id = br.config_revision_id
      limit 1
    ) lnr on true
    where b.organization_id = $1
      and b.project_id = $2
      and b.id = $3
      and br.parameter_spec_version_id is not null
    limit 1
    `,
    [input.organizationId, input.projectId, input.bindingId]
  );

  return result.rows[0] ?? null;
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
      created_by_user_id, completed_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7,
      $8::jsonb, $9::jsonb, $10::jsonb,
      $11, $12,
      $13, $14, $15,
      $16, $17
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
      input.completedAt
    ]
  );

  return result.rows[0];
}

export async function insertReloadRunTarget(db: Queryable, input: InsertReloadRunTargetInput): Promise<void> {
  await db.query(
    `
    insert into dts_reload_run_targets (
      id, reload_run_id, binding_id, node_path, property_key, baseline_value, debug_value, sort_order
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      input.id,
      input.reloadRunId,
      input.bindingId,
      input.nodePath,
      input.propertyKey,
      input.baselineValue,
      input.debugValue,
      input.sortOrder
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
      completed_at = $13
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
      completed_at = $13
    where organization_id = $1
      and id = $2
      and status = any($14::text[])
    returning *
    `,
    [...deployStateUpdateParams(input), ["validated", "failed"]]
  );
  return result.rows[0] ?? null;
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

export async function listReloadRunTargets(db: Queryable, reloadRunId: string): Promise<ReloadRunTargetDto[]> {
  const result = await db.query<ReloadRunTargetRow>(
    `
    select binding_id, node_path, property_key, baseline_value, debug_value, sort_order
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
      coalesce(md5(string_agg(br.id || coalesce(br.raw_value, '') || br.created_at::text, '|' order by br.id)), '') as checksum
    from project_parameter_binding_revisions br
    join project_parameter_bindings b on b.id = br.binding_id
    where b.organization_id = $1 and b.project_id = $2
    `,
    [input.organizationId, input.projectId]
  );

  const drafts = await db.query<{ count: string | number }>(
    `
    select count(*)::text as count
    from parameter_drafts d
    join project_parameter_bindings b on b.id = d.project_parameter_binding_id
    where b.organization_id = $1 and b.project_id = $2
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
  file_name: string;
  role: string;
  sort_order: number | string;
  storage_key: string;
  format: string;
};

export async function listProjectDtsMemberSources(
  db: Queryable,
  input: { organizationId: string; projectId: string; configSetId?: string }
): Promise<{ configSetId: string; members: ConfigSetMemberSourceRow[] }> {
  const configSetId = input.configSetId
    ? input.configSetId
    : (
        await db.query<{ id: string }>(
          `
          select id
          from dts_config_set
          where organization_id = $1 and project_id = $2
          order by name asc, id asc
          limit 1
          `,
          [input.organizationId, input.projectId]
        )
      ).rows[0]?.id;

  if (!configSetId) {
    return { configSetId: "", members: [] };
  }

  const result = await db.query<ConfigSetMemberSourceRow>(
    `
    select
      ppf.file_name as file_name,
      coalesce(ppf.config_set_role::text, 'misc') as role,
      ppf.config_set_sort_order as sort_order,
      v.storage_key as storage_key,
      ppf.format as format
    from project_parameter_files ppf
    join project_parameter_file_versions v on v.id = ppf.current_version_id
    where ppf.organization_id = $1
      and ppf.project_id = $2
      and ppf.config_set_id = $3
      and ppf.format = 'dts'
    order by ppf.config_set_sort_order asc, ppf.file_name asc
    `,
    [input.organizationId, input.projectId, configSetId]
  );

  return { configSetId, members: result.rows };
}

/** Re-export for service consumers that map rows → DTOs. */
export type { ReloadCandidateDto };
