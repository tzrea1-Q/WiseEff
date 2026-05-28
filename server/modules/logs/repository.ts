import type { AuthContext } from "../auth/types";
import { completeJob, createLogAnalysisJob, updateJobProgress } from "../jobs/repository";
import type { LogAnalysisJobDto } from "../jobs/types";
import type { Database, Queryable } from "../../shared/database/client";
import type { AnalyzeLogEvidence, LogAnalysisSeverity } from "./analyzer";
import type { LogArchiveState, LogFeedbackRating, LogRecordDto } from "./types";
import type { LogRecordStatus, LogRunStatus, LogStage } from "./status";

type LogFileObjectRow = {
  id: string;
  organization_id: string;
  project_id: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  file_size_bytes: number | string;
  checksum_sha256: string;
  uploaded_by_user_id: string | null;
  created_at: string | Date;
};

type LogRecordRow = {
  id: string;
  current_run_id?: string | null;
  report_id: string | null;
  file_name: string;
  project_id: string;
  source: string;
  file_size_bytes: number | string;
  status: LogRecordStatus;
  archive_state: LogArchiveState;
  stage: LogStage | null;
  confidence: number | string | null;
  conclusion: string | null;
  impact: string | null;
  suggested_actions: string[] | null;
  severity: LogRecordDto["severity"] | null;
  raw_lines: string[] | null;
  captured_at: string | Date;
  updated_at: string | Date;
  submitted_by: string | null;
  related_parameter_id: string | null;
  failure_reason: string | null;
  analysis_question: string | null;
};

type EvidenceRow = {
  id: string;
  stage: LogStage;
  line_numbers: number[];
  inference: string;
  suggested_action: string;
  rule_hit: string | null;
};

type RunRow = {
  id: string;
  log_record_id: string;
  status: LogRunStatus;
  current_stage: LogStage;
  progress: number | string;
  error_message: string | null;
  updated_at: string | Date;
};

type WorkerLogRunSnapshotRow = {
  job_id: string;
  organization_id: string;
  run_id: string;
  log_id: string;
  file_object_id: string;
  file_name: string;
  storage_key: string;
  analysis_question: string | null;
  job_status: LogRunStatus;
  run_status: LogRunStatus;
  record_status: LogRecordStatus;
};

export type LogFileObjectDto = {
  id: string;
  organizationId: string;
  projectId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  uploadedByUserId: string | null;
  createdAt: string;
};

export type LogRunDto = {
  id: string;
  logId: string;
  status: LogRunStatus;
  currentStage: LogStage;
  progress: number;
  error: string | null;
  updatedAt: string;
};

export type CreateLogRecordWithRunAndJobInput = {
  logId: string;
  runId: string;
  jobId: string;
  organizationId: string;
  projectId: string;
  fileObjectId: string;
  fileName: string;
  source: string;
  submittedByUserId: string;
  analysisQuestion?: string;
  relatedParameterId?: string;
};

export type LogWorkerRunSnapshot = {
  jobId: string;
  organizationId: string;
  runId: string;
  logId: string;
  fileObjectId: string;
  fileName: string;
  storageKey: string;
  analysisQuestion: string | null;
  jobStatus: LogRunStatus;
  runStatus: LogRunStatus;
  recordStatus: LogRecordStatus;
};

export type PersistLogAnalysisReportInput = {
  organizationId: string;
  logId: string;
  runId: string;
  report: {
    confidence: number;
    conclusion: string;
    impact: string;
    severity: LogAnalysisSeverity;
    suggestedActions: string[];
    rawLines: string[];
  };
  evidence: AnalyzeLogEvidence[];
};

type CompleteLogAnalysisJobWithReportInput = PersistLogAnalysisReportInput & {
  jobId: string;
  leaseOwner: string;
};

class LogJobLeaseLostError extends Error {
  constructor() {
    super("Log analysis job lease was lost before final report persistence completed.");
  }
}

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toFileObjectDto(row: LogFileObjectRow): LogFileObjectDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    storageKey: row.storage_key,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSizeBytes: Number(row.file_size_bytes),
    checksumSha256: row.checksum_sha256,
    uploadedByUserId: row.uploaded_by_user_id,
    createdAt: dateTimeToIso(row.created_at)
  };
}

function defaultConclusion(status: LogRecordStatus, failureReason: string | null) {
  if (status === "failed") return failureReason ?? "Log analysis failed before a report was generated.";
  if (status === "complete") return "Log analysis completed.";
  return "Log analysis is queued or processing.";
}

function defaultImpact(status: LogRecordStatus) {
  if (status === "failed") return "No operational impact was inferred because analysis did not complete.";
  if (status === "complete") return "Review the generated evidence and suggested actions.";
  return "Analysis results will be available after processing completes.";
}

function toLogDto(row: LogRecordRow, evidence = [] as LogRecordDto["evidence"]): LogRecordDto {
  const status = row.status;

  return {
    id: row.id,
    reportId: row.report_id ?? "",
    fileName: row.file_name,
    projectId: row.project_id,
    source: row.source,
    fileSizeBytes: Number(row.file_size_bytes),
    status,
    archiveState: row.archive_state,
    stage: row.stage ?? "parse",
    confidence: row.confidence === null ? 0 : Number(row.confidence),
    conclusion: row.conclusion ?? defaultConclusion(status, row.failure_reason),
    impact: row.impact ?? defaultImpact(status),
    evidence,
    suggestedActions: row.suggested_actions ?? [],
    severity: row.severity ?? (status === "failed" ? "Warning" : "Info"),
    rawLines: row.raw_lines ?? [],
    capturedAt: dateTimeToIso(row.captured_at),
    updatedAt: dateTimeToIso(row.updated_at),
    submittedBy: row.submitted_by ?? "",
    relatedParameterId: row.related_parameter_id ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    analysisQuestion: row.analysis_question ?? undefined
  };
}

function toEvidenceDto(row: EvidenceRow): LogRecordDto["evidence"][number] {
  return {
    id: row.id,
    stageId: row.stage,
    lineNumbers: row.line_numbers,
    inference: row.inference,
    suggestedAction: row.suggested_action,
    ruleHit: row.rule_hit ?? undefined
  };
}

function toRunDto(row: RunRow): LogRunDto {
  return {
    id: row.id,
    logId: row.log_record_id,
    status: row.status,
    currentStage: row.current_stage,
    progress: Number(row.progress),
    error: row.error_message,
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toWorkerLogRunSnapshot(row: WorkerLogRunSnapshotRow): LogWorkerRunSnapshot {
  return {
    jobId: row.job_id,
    organizationId: row.organization_id,
    runId: row.run_id,
    logId: row.log_id,
    fileObjectId: row.file_object_id,
    fileName: row.file_name,
    storageKey: row.storage_key,
    analysisQuestion: row.analysis_question,
    jobStatus: row.job_status,
    runStatus: row.run_status,
    recordStatus: row.record_status
  };
}

const logSelect = `
  select
    lr.id,
    lr.current_run_id,
    report.id as report_id,
    lr.file_name,
    lr.project_id,
    lr.source,
    lfo.file_size_bytes,
    lr.status,
    lr.archive_state,
    coalesce(lar.current_stage, 'parse') as stage,
    report.confidence,
    report.conclusion,
    report.impact,
    report.suggested_actions,
    report.severity,
    report.raw_lines,
    lr.captured_at,
    lr.updated_at,
    users.name as submitted_by,
    lr.related_parameter_id,
    lr.failure_reason,
    lr.analysis_question
  from log_records lr
  inner join log_file_objects lfo on lfo.id = lr.file_object_id
  left join log_analysis_runs lar on lar.id = lr.current_run_id
  left join log_analysis_reports report on report.run_id = lr.current_run_id
  left join users on users.id = lr.submitted_by_user_id
`;

function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}

export async function createFileObject(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    storageKey: string;
    fileName: string;
    contentType: string;
    fileSizeBytes: number;
    checksumSha256: string;
    uploadedByUserId: string;
  }
) {
  const result = await db.query<LogFileObjectRow>(
    `
    insert into log_file_objects (
      id, organization_id, project_id, storage_key, file_name, content_type,
      file_size_bytes, checksum_sha256, uploaded_by_user_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.storageKey,
      input.fileName,
      input.contentType,
      input.fileSizeBytes,
      input.checksumSha256,
      input.uploadedByUserId
    ]
  );

  return toFileObjectDto(result.rows[0]);
}

export async function getFileObjectById(
  db: Queryable,
  query: {
    organizationId: string;
    fileObjectId: string;
  }
) {
  const result = await db.query<LogFileObjectRow>(
    `
    select *
    from log_file_objects
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.fileObjectId]
  );

  return result.rows[0] ? toFileObjectDto(result.rows[0]) : null;
}

export async function createLogRecordWithRunAndJob(db: Database, input: CreateLogRecordWithRunAndJobInput) {
  return db.transaction(async (tx) => {
    await tx.query<LogRecordRow>(
      `
      insert into log_records (
        id, organization_id, project_id, file_object_id, file_name, source, status,
        analysis_question, related_parameter_id, submitted_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6, 'processing', $7, $8, $9)
      returning id
      `,
      [
        input.logId,
        input.organizationId,
        input.projectId,
        input.fileObjectId,
        input.fileName,
        input.source,
        input.analysisQuestion ?? null,
        input.relatedParameterId ?? null,
        input.submittedByUserId
      ]
    );
    await tx.query<RunRow>(
      `
      insert into log_analysis_runs (
        id, organization_id, log_record_id, status, current_stage, progress
      )
      values ($1, $2, $3, 'queued', 'parse', 0)
      returning id, log_record_id, status, current_stage, progress, error_message, updated_at
      `,
      [input.runId, input.organizationId, input.logId]
    );
    const job = await createLogAnalysisJob(tx, {
      id: input.jobId,
      organizationId: input.organizationId,
      logId: input.logId,
      runId: input.runId
    });
    const updated = await tx.query<LogRecordRow>(
      `
      update log_records
      set current_run_id = $3,
        updated_at = now()
      where organization_id = $1
        and id = $2
      returning
        id,
        current_run_id,
        null::text as report_id,
        file_name,
        project_id,
        source,
        (select file_size_bytes from log_file_objects where id = log_records.file_object_id) as file_size_bytes,
        status,
        archive_state,
        'parse'::text as stage,
        null::numeric as confidence,
        null::text as conclusion,
        null::text as impact,
        null::jsonb as suggested_actions,
        null::text as severity,
        null::jsonb as raw_lines,
        captured_at,
        updated_at,
        (select name from users where id = log_records.submitted_by_user_id) as submitted_by,
        related_parameter_id,
        failure_reason,
        analysis_question
      `,
      [input.organizationId, input.logId, input.runId]
    );

    return { log: toLogDto(updated.rows[0]), job };
  });
}

export async function markUnsupportedLog(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    fileObjectId: string;
    fileName: string;
    source: string;
    submittedByUserId: string;
    failureReason: string;
    analysisQuestion?: string;
    relatedParameterId?: string;
  }
) {
  const result = await db.query<LogRecordRow>(
    `
    insert into log_records (
      id, organization_id, project_id, file_object_id, file_name, source, status,
      failure_reason, analysis_question, related_parameter_id, submitted_by_user_id
    )
    values ($1, $2, $3, $4, $5, $6, 'failed', $7, $8, $9, $10)
    returning
      id,
      current_run_id,
      null::text as report_id,
      file_name,
      project_id,
      source,
      (select file_size_bytes from log_file_objects where id = log_records.file_object_id) as file_size_bytes,
      status,
      archive_state,
      'parse'::text as stage,
      null::numeric as confidence,
      null::text as conclusion,
      null::text as impact,
      null::jsonb as suggested_actions,
      null::text as severity,
      null::jsonb as raw_lines,
      captured_at,
      updated_at,
      (select name from users where id = log_records.submitted_by_user_id) as submitted_by,
      related_parameter_id,
      failure_reason,
      analysis_question
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.fileObjectId,
      input.fileName,
      input.source,
      input.failureReason,
      input.analysisQuestion ?? null,
      input.relatedParameterId ?? null,
      input.submittedByUserId
    ]
  );

  return result.rows[0] ? toLogDto(result.rows[0]) : null;
}

export async function listLogs(
  db: Queryable,
  auth: AuthContext,
  query: {
    projectId?: string;
    status?: LogRecordStatus;
    timeWindow?: "today" | "7d" | "30d";
    includeArchived?: boolean;
    allowedProjectIds?: string[] | null;
  }
) {
  const values: unknown[] = [auth.organization.id];
  const where = ["lr.organization_id = $1"];

  if (!query.includeArchived) {
    where.push("lr.archive_state = 'active'");
  }
  if (query.allowedProjectIds !== undefined && query.allowedProjectIds !== null) {
    addCondition(where, values, (placeholder) => `lr.project_id = any(${placeholder}::text[])`, query.allowedProjectIds);
  }
  if (query.projectId) {
    addCondition(where, values, (placeholder) => `lr.project_id = ${placeholder}`, query.projectId);
  }
  if (query.status) {
    addCondition(where, values, (placeholder) => `lr.status = ${placeholder}`, query.status);
  }
  if (query.timeWindow) {
    const interval = query.timeWindow === "today" ? "1 day" : query.timeWindow === "7d" ? "7 days" : "30 days";
    where.push(`lr.captured_at >= now() - interval '${interval}'`);
  }

  const result = await db.query<LogRecordRow>(
    `
    ${logSelect}
    where ${where.join("\n      and ")}
    order by lr.captured_at desc, lr.id asc
    `,
    values
  );

  return result.rows.map((row) => toLogDto(row));
}

export async function getLogDetail(db: Queryable, auth: AuthContext, logId: string) {
  const result = await db.query<LogRecordRow>(
    `
    ${logSelect}
    where lr.organization_id = $1
      and lr.id = $2
    limit 1
    `,
    [auth.organization.id, logId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const evidenceResult = await db.query<EvidenceRow>(
    `
    select id, stage, line_numbers, inference, suggested_action, rule_hit
    from log_evidence
    where organization_id = $1
      and log_record_id = $2
      and ($3::text is null or run_id = $3)
    order by created_at asc, id asc
    `,
    [auth.organization.id, logId, row.current_run_id ?? null]
  );

  return toLogDto(row, evidenceResult.rows.map(toEvidenceDto));
}

export async function listRuns(db: Queryable, auth: AuthContext, logId: string) {
  const result = await db.query<RunRow>(
    `
    select lar.id, lar.log_record_id, lar.status, lar.current_stage, lar.progress, lar.error_message, lar.updated_at
    from log_analysis_runs lar
    inner join log_records lr on lr.id = lar.log_record_id
    where lar.organization_id = $1
      and lr.organization_id = $1
      and lar.log_record_id = $2
    order by lar.created_at desc, lar.id desc
    `,
    [auth.organization.id, logId]
  );

  return result.rows.map(toRunDto);
}

export async function updateRunProgress(
  db: Queryable,
  input: { organizationId: string; runId: string; status: LogRunStatus; currentStage: LogStage; progress: number }
) {
  await db.query(
    `
    update log_analysis_runs
    set status = $3,
      current_stage = $4,
      progress = $5,
      updated_at = now(),
      started_at = coalesce(started_at, now())
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.runId, input.status, input.currentStage, input.progress]
  );
}

export async function updateRunStageProgress(
  db: Queryable,
  input: {
    organizationId: string;
    runId: string;
    status: LogRunStatus;
    stageStatus?: LogRunStatus;
    stage: LogStage;
    progress: number;
    message: string;
  }
) {
  await updateRunProgress(db, {
    organizationId: input.organizationId,
    runId: input.runId,
    status: input.status,
    currentStage: input.stage,
    progress: input.progress
  });
  await db.query(
    `
    insert into log_analysis_stages (
      id, organization_id, run_id, stage, status, progress, message, started_at, completed_at
    )
    values (
      $1, $2, $3, $4, $5, $6, $7,
      case when $5 = 'processing' then now() else null end,
      case when $5 in ('complete', 'failed') then now() else null end
    )
    on conflict (run_id, stage) do update
    set status = excluded.status,
      progress = excluded.progress,
      message = excluded.message,
      started_at = coalesce(log_analysis_stages.started_at, excluded.started_at),
      completed_at = excluded.completed_at
    `,
    [
      `stage-${input.runId}-${input.stage}`,
      input.organizationId,
      input.runId,
      input.stage,
      input.stageStatus ?? input.status,
      input.progress,
      input.message
    ]
  );
}

export async function getLogWorkerRunSnapshot(db: Queryable, jobId: string) {
  const result = await db.query<WorkerLogRunSnapshotRow>(
    `
    select
      job.id as job_id,
      job.organization_id,
      run.id as run_id,
      lr.id as log_id,
      lr.file_object_id,
      lr.file_name,
      lfo.storage_key,
      lr.analysis_question,
      job.status as job_status,
      run.status as run_status,
      lr.status as record_status
    from jobs job
    inner join log_analysis_runs run
      on run.id = job.target_id
      and run.organization_id = job.organization_id
    inner join log_records lr
      on lr.id = run.log_record_id
      and lr.organization_id = job.organization_id
      and lr.current_run_id = run.id
    inner join log_file_objects lfo
      on lfo.id = lr.file_object_id
      and lfo.organization_id = job.organization_id
    where job.id = $1
    limit 1
    `,
    [jobId]
  );

  return result.rows[0] ? toWorkerLogRunSnapshot(result.rows[0]) : null;
}

export async function persistLogAnalysisReport(db: Database, input: PersistLogAnalysisReportInput) {
  await db.transaction(async (tx) => {
    await tx.query(
      `
      insert into log_analysis_reports (
        id, organization_id, log_record_id, run_id, confidence, conclusion, impact,
        severity, suggested_actions, raw_lines
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (id) do update
      set confidence = excluded.confidence,
        conclusion = excluded.conclusion,
        impact = excluded.impact,
        severity = excluded.severity,
        suggested_actions = excluded.suggested_actions,
        raw_lines = excluded.raw_lines
      `,
      [
        `report-${input.runId}`,
        input.organizationId,
        input.logId,
        input.runId,
        input.report.confidence,
        input.report.conclusion,
        input.report.impact,
        input.report.severity,
        input.report.suggestedActions,
        input.report.rawLines
      ]
    );
    await tx.query(
      `
      delete from log_evidence
      where organization_id = $1
        and run_id = $2
      `,
      [input.organizationId, input.runId]
    );

    for (const [index, evidence] of input.evidence.entries()) {
      await tx.query(
        `
        insert into log_evidence (
          id, organization_id, log_record_id, run_id, stage, line_numbers,
          inference, suggested_action, rule_hit
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          `evidence-${input.runId}-${index}`,
          input.organizationId,
          input.logId,
          input.runId,
          evidence.stageId,
          evidence.lineNumbers,
          evidence.inference,
          evidence.suggestedAction,
          evidence.ruleHit
        ]
      );
    }
  });
}

export async function completeLogAnalysisJobWithReport(db: Database, input: CompleteLogAnalysisJobWithReportInput) {
  try {
    await db.transaction(async (tx) => {
      const progressUpdated = await updateJobProgress(tx, {
        organizationId: input.organizationId,
        jobId: input.jobId,
        progress: 100,
        currentStage: "report",
        leaseOwner: input.leaseOwner
      });
      if (!progressUpdated) {
        throw new LogJobLeaseLostError();
      }

      await tx.query(
        `
        insert into log_analysis_reports (
          id, organization_id, log_record_id, run_id, confidence, conclusion, impact,
          severity, suggested_actions, raw_lines
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (id) do update
        set confidence = excluded.confidence,
          conclusion = excluded.conclusion,
          impact = excluded.impact,
          severity = excluded.severity,
          suggested_actions = excluded.suggested_actions,
          raw_lines = excluded.raw_lines
        `,
        [
          `report-${input.runId}`,
          input.organizationId,
          input.logId,
          input.runId,
          input.report.confidence,
          input.report.conclusion,
          input.report.impact,
          input.report.severity,
          input.report.suggestedActions,
          input.report.rawLines
        ]
      );
      await tx.query(
        `
        delete from log_evidence
        where organization_id = $1
          and run_id = $2
        `,
        [input.organizationId, input.runId]
      );

      for (const [index, evidence] of input.evidence.entries()) {
        await tx.query(
          `
          insert into log_evidence (
            id, organization_id, log_record_id, run_id, stage, line_numbers,
            inference, suggested_action, rule_hit
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            `evidence-${input.runId}-${index}`,
            input.organizationId,
            input.logId,
            input.runId,
            evidence.stageId,
            evidence.lineNumbers,
            evidence.inference,
            evidence.suggestedAction,
            evidence.ruleHit
          ]
        );
      }

      await updateRunStageProgress(tx, {
        organizationId: input.organizationId,
        runId: input.runId,
        status: "complete",
        stageStatus: "complete",
        stage: "report",
        progress: 100,
        message: "Report generation complete."
      });

      const completedJob = await completeJob(tx, {
        organizationId: input.organizationId,
        jobId: input.jobId,
        currentStage: "report",
        leaseOwner: input.leaseOwner
      });
      if (!completedJob) {
        throw new LogJobLeaseLostError();
      }

      await tx.query(
        `
        update log_analysis_runs
        set status = 'complete',
          current_stage = $4,
          progress = 100,
          completed_at = now(),
          updated_at = now()
        where organization_id = $1
          and id = $2
          and log_record_id = $3
        `,
        [input.organizationId, input.runId, input.logId, "report"]
      );
      await tx.query(
        `
        update log_records
        set status = 'complete',
          updated_at = now()
        where organization_id = $1
          and id = $2
          and current_run_id = $3
        `,
        [input.organizationId, input.logId, input.runId]
      );
    });

    return true;
  } catch (error) {
    if (error instanceof LogJobLeaseLostError) {
      return false;
    }
    throw error;
  }
}

export async function completeRun(
  db: Database,
  input: { organizationId: string; logId: string; runId: string; currentStage?: LogStage }
) {
  await db.transaction(async (tx) => {
    await tx.query(
      `
      update log_analysis_runs
      set status = 'complete',
        current_stage = $4,
        progress = 100,
        completed_at = now(),
        updated_at = now()
      where organization_id = $1
        and id = $2
        and log_record_id = $3
      `,
      [input.organizationId, input.runId, input.logId, input.currentStage ?? "report"]
    );
    await tx.query(
      `
      update log_records
      set status = 'complete',
        updated_at = now()
      where organization_id = $1
        and id = $2
        and current_run_id = $3
      `,
      [input.organizationId, input.logId, input.runId]
    );
  });
}

export async function failRun(
  db: Database,
  input: { organizationId: string; logId: string; runId: string; currentStage?: LogStage; error: string }
) {
  await db.transaction(async (tx) => {
    await tx.query(
      `
      update log_analysis_runs
      set status = 'failed',
        current_stage = $4,
        error_message = $5,
        completed_at = now(),
        updated_at = now()
      where organization_id = $1
        and id = $2
        and log_record_id = $3
      `,
      [input.organizationId, input.runId, input.logId, input.currentStage ?? "parse", input.error]
    );
    await tx.query(
      `
      update log_records
      set status = 'failed',
        failure_reason = $4,
        updated_at = now()
      where organization_id = $1
        and id = $2
        and current_run_id = $3
      `,
      [input.organizationId, input.logId, input.runId, input.error]
    );
  });
}

async function setArchiveState(db: Queryable, auth: AuthContext, logId: string, archiveState: LogArchiveState) {
  await db.query(
    `
    update log_records
    set archive_state = $3,
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [auth.organization.id, logId, archiveState]
  );

  return getLogDetail(db, auth, logId);
}

export async function archiveLog(db: Queryable, auth: AuthContext, logId: string) {
  return setArchiveState(db, auth, logId, "archived");
}

export async function unarchiveLog(db: Queryable, auth: AuthContext, logId: string) {
  return setArchiveState(db, auth, logId, "active");
}

export async function appendFeedback(
  db: Queryable,
  auth: AuthContext,
  input: { id: string; logId: string; rating: LogFeedbackRating; note?: string }
) {
  await db.query(
    `
    insert into log_feedback (
      id, organization_id, log_record_id, user_id, rating, note
    )
    values ($1, $2, $3, $4, $5, $6)
    `,
    [input.id, auth.organization.id, input.logId, auth.user.id, input.rating, input.note ?? null]
  );
}

export async function createRerunWithJob(
  db: Queryable,
  input: { runId: string; jobId: string; organizationId: string; logId: string; analysisQuestion?: string }
): Promise<LogAnalysisJobDto> {
  await db.query<RunRow>(
    `
    insert into log_analysis_runs (
      id, organization_id, log_record_id, status, current_stage, progress
    )
    values ($1, $2, $3, 'queued', 'parse', 0)
    returning id, log_record_id, status, current_stage, progress, error_message, updated_at
    `,
    [input.runId, input.organizationId, input.logId]
  );
  const job = await createLogAnalysisJob(db, {
    id: input.jobId,
    organizationId: input.organizationId,
    logId: input.logId,
    runId: input.runId
  });
  await db.query(
    `
    update log_records
    set status = 'processing',
      current_run_id = $3,
      analysis_question = coalesce($4, analysis_question),
      failure_reason = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.logId, input.runId, input.analysisQuestion ?? null]
  );

  return job;
}
