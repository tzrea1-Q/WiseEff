import type { Queryable } from "../../shared/database/client";
import type { LogStage } from "../logs/status";
import type { ClaimedLogAnalysisJobDto, LogAnalysisJobDto, LogAnalysisJobKind, LogAnalysisJobSnapshotDto } from "./types";

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
};

type JobSnapshotRow = JobRow & {
  organization_id: string;
  project_id: string;
  log_id: string;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
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
    organizationId: row.organization_id
  };
}

function toLogAnalysisJobSnapshotDto(row: JobSnapshotRow): LogAnalysisJobSnapshotDto {
  return {
    ...toLogAnalysisJobDto(row, row.log_id, row.target_id),
    organizationId: row.organization_id,
    projectId: row.project_id
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

export async function claimNextJob(db: Queryable, input: { kind: LogAnalysisJobKind }) {
  // Distributed-safe locking with SKIP LOCKED is intentionally deferred until M5+.
  const result = await db.query<JobRow & { organization_id: string }>(
    `
    update jobs
    set status = 'processing',
      updated_at = now()
    where id = (
      select id
      from jobs
      where kind = $1
        and status = 'queued'
      order by created_at asc, id asc
      limit 1
    )
    returning id, organization_id, kind, target_id, status, progress, current_stage, error_message, updated_at
    `,
    [input.kind]
  );

  return result.rows[0] ? toClaimedLogAnalysisJobDto(result.rows[0]) : null;
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
      log.project_id,
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
  input: { organizationId: string; jobId: string; progress: number; currentStage: LogStage }
) {
  await db.query(
    `
    update jobs
    set progress = $3,
      current_stage = $4,
      error_message = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.jobId, input.progress, input.currentStage]
  );
}

export async function completeJob(
  db: Queryable,
  input: { organizationId: string; jobId: string; currentStage?: LogStage }
) {
  await db.query(
    `
    update jobs
    set status = 'complete',
      progress = 100,
      current_stage = $3,
      error_message = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.jobId, input.currentStage ?? "report"]
  );
}

export async function failJob(
  db: Queryable,
  input: { organizationId: string; jobId: string; error: string; currentStage?: LogStage }
) {
  await db.query(
    `
    update jobs
    set status = 'failed',
      error_message = $3,
      current_stage = $4,
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.jobId, input.error, input.currentStage ?? "parse"]
  );
}
