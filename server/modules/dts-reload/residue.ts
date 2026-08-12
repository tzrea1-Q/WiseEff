import type { Queryable } from "../../shared/database/client";
import type { ReloadRunPurpose, ReloadRunStatus, ReloadRunTargetDto, ReloadResidueDto } from "./types";
import { TRIGGER_RELOAD_UNCONFIRMED_FAILURE_CODE } from "./types";

/** Terminal statuses that mean debug values were written to the device. */
export const RESIDUE_LEAVING_STATUSES: ReadonlySet<ReloadRunStatus> = new Set([
  "unverifiable",
  "verified",
  "contradicted"
]);

/**
 * Failure codes on a `failed` run that still mean the device may carry debug values.
 * A trigger whose RPC did not confirm (timeout / transport drop) may have applied the overlay.
 */
export const RESIDUE_POSSIBLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  TRIGGER_RELOAD_UNCONFIRMED_FAILURE_CODE
]);

export type ResidueParameterRecord = {
  bindingId: string;
  propertyKey: string;
  nodePath: string;
  baselineValue: string | null;
  debugValue: string;
};

type ResidueRow = {
  organization_id: string;
  device_id: string;
  project_id: string;
  source_run_id: string;
  parameters: unknown;
  recorded_at: string | Date;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function asParameters(value: unknown): ResidueParameterRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      bindingId: typeof entry.bindingId === "string" ? entry.bindingId : "",
      propertyKey: typeof entry.propertyKey === "string" ? entry.propertyKey : "",
      nodePath: typeof entry.nodePath === "string" ? entry.nodePath : "",
      baselineValue: typeof entry.baselineValue === "string" ? entry.baselineValue : null,
      debugValue: typeof entry.debugValue === "string" ? entry.debugValue : ""
    }))
    .filter((entry) => entry.bindingId.length > 0 && entry.propertyKey.length > 0);
}

export function toResidueDto(row: ResidueRow): ReloadResidueDto {
  return {
    deviceId: row.device_id,
    projectId: row.project_id,
    sourceRunId: row.source_run_id,
    parameters: asParameters(row.parameters),
    recordedAt: dateTimeToIso(row.recorded_at)
  };
}

export function parametersFromTargets(targets: ReloadRunTargetDto[]): ResidueParameterRecord[] {
  return targets.map((target) => ({
    bindingId: target.bindingId,
    propertyKey: target.propertyKey,
    nodePath: target.nodePath,
    baselineValue: target.baselineValue,
    debugValue: target.debugValue
  }));
}

/**
 * Decide whether a finished deploy should set or clear residue for the device.
 *
 * - Ordinary run + post-write terminal → set residue naming that run + parameters.
 * - Restore run + post-write terminal → clear residue for the device.
 * - Ordinary run + failed-but-unconfirmed trigger → set residue defensively (device may be dirty).
 * - Other failed / blocked / non-terminal → no residue mutation.
 */
export function residueActionForTerminal(input: {
  purpose: ReloadRunPurpose;
  status: ReloadRunStatus;
  failureCode?: string | null;
}): "set" | "clear" | "none" {
  if (RESIDUE_LEAVING_STATUSES.has(input.status)) {
    return input.purpose === "restore-baseline" ? "clear" : "set";
  }
  if (
    input.status === "failed" &&
    input.purpose !== "restore-baseline" &&
    input.failureCode != null &&
    RESIDUE_POSSIBLE_FAILURE_CODES.has(input.failureCode)
  ) {
    return "set";
  }
  return "none";
}

export async function getDeviceResidue(
  db: Queryable,
  input: { organizationId: string; deviceId: string }
): Promise<ReloadResidueDto | null> {
  const result = await db.query<ResidueRow>(
    `
    select organization_id, device_id, project_id, source_run_id, parameters, recorded_at
    from dts_reload_device_residue
    where organization_id = $1 and device_id = $2
    limit 1
    `,
    [input.organizationId, input.deviceId]
  );
  const row = result.rows[0];
  return row ? toResidueDto(row) : null;
}

export async function upsertDeviceResidue(
  db: Queryable,
  input: {
    organizationId: string;
    deviceId: string;
    projectId: string;
    sourceRunId: string;
    parameters: ResidueParameterRecord[];
    recordedAt?: string;
  }
): Promise<ReloadResidueDto> {
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const result = await db.query<ResidueRow>(
    `
    insert into dts_reload_device_residue (
      organization_id, device_id, project_id, source_run_id, parameters, recorded_at
    ) values ($1, $2, $3, $4, $5::jsonb, $6)
    on conflict (organization_id, device_id) do update set
      project_id = excluded.project_id,
      source_run_id = excluded.source_run_id,
      parameters = excluded.parameters,
      recorded_at = excluded.recorded_at
    returning organization_id, device_id, project_id, source_run_id, parameters, recorded_at
    `,
    [
      input.organizationId,
      input.deviceId,
      input.projectId,
      input.sourceRunId,
      JSON.stringify(input.parameters),
      recordedAt
    ]
  );
  return toResidueDto(result.rows[0]!);
}

export async function clearDeviceResidue(
  db: Queryable,
  input: { organizationId: string; deviceId: string }
): Promise<boolean> {
  const result = await db.query(
    `
    delete from dts_reload_device_residue
    where organization_id = $1 and device_id = $2
    `,
    [input.organizationId, input.deviceId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Clear residue only when it still names the source run this restore targeted.
 * Prevents a stale restore deploy from wiping bookkeeping refreshed by a newer ordinary reload.
 */
export async function clearDeviceResidueIfSource(
  db: Queryable,
  input: { organizationId: string; deviceId: string; sourceRunId: string }
): Promise<boolean> {
  const result = await db.query(
    `
    delete from dts_reload_device_residue
    where organization_id = $1
      and device_id = $2
      and source_run_id = $3
    `,
    [input.organizationId, input.deviceId, input.sourceRunId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function applyResidueForDeployTerminal(
  db: Queryable,
  input: {
    organizationId: string;
    deviceId: string;
    projectId: string;
    runId: string;
    purpose: ReloadRunPurpose;
    status: ReloadRunStatus;
    failureCode?: string | null;
    targets: ReloadRunTargetDto[];
    restoresSourceRunId?: string | null;
  }
): Promise<"set" | "clear" | "none"> {
  const action = residueActionForTerminal({
    purpose: input.purpose,
    status: input.status,
    failureCode: input.failureCode
  });
  if (action === "set") {
    await upsertDeviceResidue(db, {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      projectId: input.projectId,
      sourceRunId: input.runId,
      parameters: parametersFromTargets(input.targets)
    });
    return "set";
  }
  if (action === "clear") {
    const sourceRunId = input.restoresSourceRunId?.trim();
    if (!sourceRunId) {
      return "none";
    }
    const cleared = await clearDeviceResidueIfSource(db, {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      sourceRunId
    });
    return cleared ? "clear" : "none";
  }
  return "none";
}
