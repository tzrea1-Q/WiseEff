import type { Database, Queryable } from "../../shared/database/client";
import { logTraceStepSchema } from "../contracts/dtoSchemas/logs";
import type { LogAnalysisTraceStep } from "./traceTypes";

export async function persistLogTraceStep(db: Database, input: {
  organizationId: string; runId: string; step: LogAnalysisTraceStep;
  jobId: string; leaseOwner: string;
}) {
  const step = logTraceStepSchema.parse(input.step);
  return db.transaction(async (tx) => {
    // Lock the job before deleting/replacing any attempt, including after model IO.
    const lease = await tx.query(`select job.id from jobs job
      where job.organization_id = $1 and job.id = $2 and job.target_id = $3
        and job.status = 'processing' and job.lease_owner = $4 and job.lease_expires_at > clock_timestamp()
        and exists (select 1 from log_analysis_runs run join log_records record
          on record.id = run.log_record_id and record.organization_id = run.organization_id
          where run.organization_id = $1 and run.id = $3 and record.current_run_id = run.id)
      for update of job`, [input.organizationId, input.jobId, input.runId, input.leaseOwner]);
    if (!lease.rows.length) return false;
    // A retried attempt replaces the previous attempt, including any longer tail.
    if (step.index === 1) await tx.query("delete from log_analysis_trace_steps where organization_id = $1 and run_id = $2", [input.organizationId, input.runId]);
    await tx.query(`insert into log_analysis_trace_steps (organization_id, run_id, step_index, step)
      values ($1, $2, $3, $4::jsonb)
      on conflict (organization_id, run_id, step_index) where run_id is not null do update set step = excluded.step`,
    [input.organizationId, input.runId, step.index, JSON.stringify(step)]);
    return true;
  });
}

export async function readLogTraceSteps(db: Queryable, organizationId: string, parent: { runId: string } | { dryRunId: string }) {
  const result = await db.query<{ step: LogAnalysisTraceStep }>(`select step from log_analysis_trace_steps
    where organization_id = $1 and (run_id = $2 or dry_run_id = $3) order by step_index limit 200`,
  [organizationId, "runId" in parent ? parent.runId : null, "dryRunId" in parent ? parent.dryRunId : null]);
  return result.rows.map(({ step }) => logTraceStepSchema.parse(step));
}
