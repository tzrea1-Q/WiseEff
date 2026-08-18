import type { Queryable } from "../../shared/database/client";
import type {
  ClaimedLogAnalysisJobDto,
  ClaimedOverlayArtifactGcJobDto,
  LogAnalysisJobDto,
  LogAnalysisJobKind,
  LogAnalysisJobSnapshotDto,
  OverlayArtifactGcJobDto
} from "./types";

type JobRow = {
  id: string;
  organization_id?: string;
  kind: "log-analysis";
  target_id: string;
  status: LogAnalysisJobDto["status"];
  progress: number | string;
  current_stage: LogAnalysisJobDto["currentStage"] | null;
  error_message: string | null;
  updated_at: string | Date;
  lease_owner?: string | null;
  lease_expires_at?: string | Date | null;
  attempt_count?: number | string;
};

type JobSnapshotRow = JobRow & {
  organization_id: string;
  log_id: string;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableDateTimeToIso(value: string | Date | null | undefined) {
  if (!value) return null;
  return dateTimeToIso(value);
}

function toLogAnalysisJobDto(row: JobRow, logId: string, runId: string): LogAnalysisJobDto {
  return {
    id: row.id,
    kind: row.kind,
    logId,
    runId,
    status: row.status,
    progress: Number(row.progress),
    currentStage: row.current_stage ?? "parse",
    error: row.error_message,
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toClaimedLogAnalysisJobDto(row: JobRow & { organization_id: string }): ClaimedLogAnalysisJobDto {
  return {
    ...toLogAnalysisJobDto(row, "", row.target_id),
    organizationId: row.organization_id,
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: nullableDateTimeToIso(row.lease_expires_at),
    attemptCount: Number(row.attempt_count ?? 0)
  };
}

function toLogAnalysisJobSnapshotDto(row: JobSnapshotRow): LogAnalysisJobSnapshotDto {
  return {
    ...toLogAnalysisJobDto(row, row.log_id, row.target_id),
    organizationId: row.organization_id
  };
}

export async function createLogAnalysisJob(
  db: Queryable,
  input: { id: string; organizationId: string; logId: string; runId: string }
) {
  const result = await db.query<JobRow>(
    `
    insert into jobs (
      id, organization_id, kind, target_type, target_id, status, progress, current_stage
    )
    values ($1, $2, 'log-analysis', 'log-analysis-run', $3, 'queued', 0, 'parse')
    returning id, kind, target_id, status, progress, current_stage, error_message, updated_at
    `,
    [input.id, input.organizationId, input.runId]
  );

  return toLogAnalysisJobDto(result.rows[0], input.logId, input.runId);
}

export async function claimNextJob(
  db: Queryable,
  input: { kind: LogAnalysisJobKind; leaseOwner?: string; leaseTtlMs?: number }
) {
  const leaseOwner = input.leaseOwner ?? "wiseeff-log-worker";
  const leaseTtlMs = input.leaseTtlMs ?? 60_000;
  const result = await db.query<JobRow & { organization_id: string }>(
    `
    update jobs
    set status = 'processing',
      lease_owner = $2,
      lease_expires_at = now() + ($3 * interval '1 millisecond'),
      attempt_count = coalesce(attempt_count, 0) + 1,
      error_message = null,
      updated_at = now()
    where id = (
      select id
      from jobs
      where kind = $1
        and (
          status = 'queued'
          or (
            status = 'processing'
            and lease_expires_at is not null
            and lease_expires_at <= now()
          )
        )
        and (next_run_at is null or next_run_at <= now())
      order by created_at asc, id asc
      for update skip locked
      limit 1
    )
    returning id, organization_id, kind, target_id, status, progress, current_stage, error_message, updated_at,
      lease_owner, lease_expires_at, attempt_count
    `,
    [input.kind, leaseOwner, leaseTtlMs]
  );

  return result.rows[0] ? toClaimedLogAnalysisJobDto(result.rows[0]) : null;
}

export async function claimJobById(
  db: Queryable,
  input: { kind: LogAnalysisJobKind; jobId: string; leaseOwner?: string; leaseTtlMs?: number }
) {
  const leaseOwner = input.leaseOwner ?? "wiseeff-log-worker";
  const leaseTtlMs = input.leaseTtlMs ?? 60_000;
  const result = await db.query<JobRow & { organization_id: string }>(
    `
    update jobs
    set status = 'processing',
      lease_owner = $2,
      lease_expires_at = now() + ($3 * interval '1 millisecond'),
      attempt_count = coalesce(attempt_count, 0) + 1,
      error_message = null,
      updated_at = now()
    where id = (
      select id
      from jobs
      where kind = $1
        and id = $4
        and (
          status = 'queued'
          or (
            status = 'processing'
            and lease_expires_at is not null
            and lease_expires_at <= now()
          )
        )
        and (next_run_at is null or next_run_at <= now())
      for update skip locked
      limit 1
    )
    returning id, organization_id, kind, target_id, status, progress, current_stage, error_message, updated_at,
      lease_owner, lease_expires_at, attempt_count
    `,
    [input.kind, leaseOwner, leaseTtlMs, input.jobId]
  );

  return result.rows[0] ? toClaimedLogAnalysisJobDto(result.rows[0]) : null;
}

export async function markJobRetryScheduled(
  db: Queryable,
  input: {
    organizationId: string;
    jobId: string;
    error: string;
    currentStage?: string;
    nextRunAt: string;
    reason: string;
    leaseOwner: string;
  }
) {
  const result = await db.query(
    `
    update jobs
    set status = 'queued',
      error_message = $3,
      current_stage = $4,
      next_run_at = $5,
      dead_letter_reason = $6,
      dead_lettered_at = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
      and lease_owner = $7
      and lease_expires_at > now()
    `,
    [input.organizationId, input.jobId, input.error, input.currentStage ?? "parse", input.nextRunAt, input.reason, input.leaseOwner]
  );

  return result.rowCount === 1;
}

export async function markJobDeadLettered(
  db: Queryable,
  input: { organizationId: string; jobId: string; error: string; reason: string; currentStage?: string; leaseOwner: string }
) {
  const result = await db.query(
    `
    update jobs
    set status = 'failed',
      error_message = $3,
      current_stage = $4,
      dead_letter_reason = $5,
      dead_lettered_at = now(),
      next_run_at = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
      and lease_owner = $6
      and lease_expires_at > now()
    `,
    [input.organizationId, input.jobId, input.error, input.currentStage ?? "parse", input.reason, input.leaseOwner]
  );

  return result.rowCount === 1;
}

export async function getJobSnapshot(db: Queryable, jobId: string) {
  const result = await db.query<JobSnapshotRow>(
    `
    select
      job.id,
      job.organization_id,
      job.kind,
      job.target_id,
      job.status,
      job.progress,
      job.current_stage,
      job.error_message,
      job.updated_at,
      run.log_record_id as log_id
    from jobs job
    inner join log_analysis_runs run
      on run.id = job.target_id
      and run.organization_id = job.organization_id
    inner join log_records log
      on log.id = run.log_record_id
      and log.organization_id = job.organization_id
    where job.id = $1
    limit 1
    `,
    [jobId]
  );

  return result.rows[0] ? toLogAnalysisJobSnapshotDto(result.rows[0]) : null;
}

export async function updateJobProgress(
  db: Queryable,
  input: { organizationId: string; jobId: string; progress: number; currentStage: string; leaseOwner: string }
) {
  const result = await db.query(
    `
    update jobs
    set progress = $3,
      current_stage = $4,
      error_message = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
      and lease_owner = $5
      and lease_expires_at > now()
    `,
    [input.organizationId, input.jobId, input.progress, input.currentStage, input.leaseOwner]
  );

  return result.rowCount === 1;
}

export async function completeJob(
  db: Queryable,
  input: { organizationId: string; jobId: string; currentStage?: string; leaseOwner: string }
) {
  const result = await db.query(
    `
    update jobs
    set status = 'complete',
      progress = 100,
      current_stage = $3,
      error_message = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
      and lease_owner = $4
      and lease_expires_at > now()
    `,
    [input.organizationId, input.jobId, input.currentStage ?? "report", input.leaseOwner]
  );

  return result.rowCount === 1;
}

export async function failJob(
  db: Queryable,
  input: { organizationId: string; jobId: string; error: string; currentStage?: string; leaseOwner: string }
) {
  const result = await db.query(
    `
    update jobs
    set status = 'failed',
      error_message = $3,
      current_stage = $4,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
      and lease_owner = $5
      and lease_expires_at > now()
    `,
    [input.organizationId, input.jobId, input.error, input.currentStage ?? "parse", input.leaseOwner]
  );

  return result.rowCount === 1;
}

type OverlayArtifactGcJobRow = {
  id: string;
  organization_id: string;
  kind: OverlayArtifactGcJobDto["kind"];
  status: OverlayArtifactGcJobDto["status"];
  progress: number | string;
  error_message: string | null;
  updated_at: string | Date;
  lease_owner?: string | null;
  lease_expires_at?: string | Date | null;
  attempt_count?: number | string;
};

function toOverlayArtifactGcJobDto(row: OverlayArtifactGcJobRow): OverlayArtifactGcJobDto {
  return {
    id: row.id,
    kind: "overlay-artifact-gc",
    organizationId: row.organization_id,
    status: row.status,
    progress: Number(row.progress),
    error: row.error_message,
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toClaimedOverlayArtifactGcJobDto(row: OverlayArtifactGcJobRow): ClaimedOverlayArtifactGcJobDto {
  return {
    ...toOverlayArtifactGcJobDto(row),
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: nullableDateTimeToIso(row.lease_expires_at),
    attemptCount: Number(row.attempt_count ?? 0)
  };
}

export async function findLiveOverlayArtifactGcJob(db: Queryable, organizationId: string) {
  const result = await db.query<OverlayArtifactGcJobRow>(
    `
    select id, organization_id, kind, status, progress, error_message, updated_at,
      lease_owner, lease_expires_at, attempt_count
    from jobs
    where organization_id = $1
      and kind = 'overlay-artifact-gc'
      and status in ('queued', 'processing')
      and dead_lettered_at is null
    order by created_at asc, id asc
    limit 1
    `,
    [organizationId]
  );

  return result.rows[0] ? toOverlayArtifactGcJobDto(result.rows[0]) : null;
}

export async function createOverlayArtifactGcJob(
  db: Queryable,
  input: { id: string; organizationId: string }
) {
  const result = await db.query<OverlayArtifactGcJobRow>(
    `
    insert into jobs (
      id, organization_id, kind, target_type, target_id, status, progress, current_stage
    )
    values ($1, $2, 'overlay-artifact-gc', 'organization', $2, 'queued', 0, 'sweep')
    returning id, organization_id, kind, status, progress, error_message, updated_at,
      lease_owner, lease_expires_at, attempt_count
    `,
    [input.id, input.organizationId]
  );

  return toOverlayArtifactGcJobDto(result.rows[0]);
}

export async function claimNextOverlayArtifactGcJob(
  db: Queryable,
  input: { leaseOwner?: string; leaseTtlMs?: number } = {}
) {
  const leaseOwner = input.leaseOwner ?? "overlay-artifact-gc-worker";
  const leaseTtlMs = input.leaseTtlMs ?? 60_000;
  const result = await db.query<OverlayArtifactGcJobRow>(
    `
    update jobs
    set status = 'processing',
      lease_owner = $1,
      lease_expires_at = now() + ($2 * interval '1 millisecond'),
      attempt_count = coalesce(attempt_count, 0) + 1,
      error_message = null,
      updated_at = now()
    where id = (
      select id
      from jobs
      where kind = 'overlay-artifact-gc'
        and (
          status = 'queued'
          or (
            status = 'processing'
            and lease_expires_at is not null
            and lease_expires_at <= now()
          )
        )
        and (next_run_at is null or next_run_at <= now())
      order by created_at asc, id asc
      for update skip locked
      limit 1
    )
    returning id, organization_id, kind, status, progress, error_message, updated_at,
      lease_owner, lease_expires_at, attempt_count
    `,
    [leaseOwner, leaseTtlMs]
  );

  return result.rows[0] ? toClaimedOverlayArtifactGcJobDto(result.rows[0]) : null;
}
