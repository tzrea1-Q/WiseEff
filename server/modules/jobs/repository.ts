import type { Queryable } from "../../shared/database/client";
import type { LogAnalysisJobDto } from "./types";

type JobRow = {
  id: string;
  kind: "log-analysis";
  target_id: string;
  status: LogAnalysisJobDto["status"];
  progress: number | string;
  current_stage: LogAnalysisJobDto["currentStage"] | null;
  error_message: string | null;
  updated_at: string | Date;
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
