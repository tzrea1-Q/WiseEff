import type { Database, Queryable } from "../../shared/database/client";
import type { ClaimedLogAnalysisJobDto } from "../jobs/types";
import { ApiError } from "../../shared/http/errors";
import { JobLeaseLostError } from "./jobLease";

/** A worker's already-held lease permits results for this run, never a new claim or another asset. */
export function admittedLogCompletionDatabase(db: Database, job: ClaimedLogAnalysisJobDto): Database {
  async function transaction<T>(write: (tx: Database) => Promise<T>): Promise<T> {
    return db.transaction(async tx => {
      const row = (await tx.query<{ target_id: string; log_record_id: string }>(`select j.target_id,r.log_record_id
        from public.jobs j join public.log_analysis_runs r on r.id=j.target_id and r.organization_id=j.organization_id
        where j.id=$1 and j.organization_id=$2 and j.status='processing' and j.lease_owner=$3
          and j.lease_expires_at>clock_timestamp() for update of j`, [job.id, job.organizationId, job.leaseOwner])).rows[0];
      if (!row) throw new JobLeaseLostError();
      await tx.query("select set_config('wiseeff.lifecycle_completion',$1,true)", [JSON.stringify({ kind: "log-analysis", organizationId: job.organizationId, jobId: job.id, runId: row.target_id, logId: row.log_record_id })]);
      return write(tx);
    });
  }
  const query: Queryable["query"] = (sql, values) => /^\s*(select|show)\b/i.test(sql)
    ? db.query(sql, values) : transaction(tx => tx.query(sql, values));
  return { query, transaction };
}

/** Existing bounded test-run owners are checked on every result transaction. */
export function admittedLogTestDatabase(db: Database, input: { kind: "dry-run" | "analysis-cases"; organizationId: string; id: string; ownerKey: number }): Database {
  async function transaction<T>(write: (tx: Database) => Promise<T>): Promise<T> {
    return db.transaction(async tx => {
      const args = [input.organizationId, input.id, input.ownerKey];
      const owned = input.kind === "dry-run"
        ? await tx.query("select id from public.log_skill_dry_runs where organization_id=$1 and id=$2 and owner_key=$3 and status='processing' for update", args)
        : await tx.query("select id from public.log_skill_analysis_case_runs where organization_id=$1 and id=$2 and owner_key=$3 and status='processing' for update", args);
      if (!owned.rowCount) throw new ApiError("CONFLICT", "分析执行权已失效，不能保存结果。");
      await tx.query("select set_config('wiseeff.lifecycle_completion',$1,true)", [JSON.stringify(input)]);
      return write(tx);
    });
  }
  const query: Queryable["query"] = (sql, values) => /^\s*(select|show)\b/i.test(sql) ? db.query(sql, values) : transaction(tx => tx.query(sql, values));
  return { query, transaction };
}
