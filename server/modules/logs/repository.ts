import { loadLogFiles, fileInventory } from "./filesRepository";
import type { AuthContext } from "../auth/types";
import type { IntegrationPrincipal } from "../auth/integrationPrincipal";
import { enqueueTerminalLogWebhook } from "./webhookOutbox";
import { completeJob, createLogAnalysisJob, updateJobProgress } from "../jobs/repository";
import type { LogAnalysisJobDto } from "../jobs/types";
import type { Database, Queryable } from "../../shared/database/client";
import type {
  AnalyzeLogEvidence,
  AnalyzeLogInput,
  LogAnalysisDegradedReason,
  LogAnalysisSeverity,
  LogAnalysisSource
} from "./analyzer";
import type { LogFormatProfile } from "./formatProfile";
import type { LogSkillSpec } from "./skillSpec";
import { currentSkillRevisionId } from "./skillsRepository";
import { readableKnowledgeEntryIds } from "./skillKnowledge";
import type { LogArchiveState, LogFeedbackRating, LogRecordDto } from "./types";
import type { LogRecordStatus, LogRunStatus, LogStage } from "./status";
import type { RelatedParameterRunSnapshot } from "./relatedParameter";

type LogFileObjectRow = {
  id: string;
  organization_id: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  file_size_bytes: number | string;
  checksum_sha256: string;
  uploaded_by_user_id: string | null;
  created_by_credential_id?: string | null;
  created_at: string | Date;
};

type RevisionRow = {
  skill_revision_id?: string | null; skill_revision_number?: number | null;
  source_snapshot_id?: string | null;
  source_snapshot_version_label?: string | null;
  source_snapshot_status?: NonNullable<AnalyzeLogInput["sourceSnapshot"]>["status"] | null;
  source_snapshot_selection?: "matched_version" | "default" | "none" | null;
  requested_source_version?: string | null;
  knowledge_revisions?: Array<{ entryId: string; revisionId: string }>;
};

type LogRecordRow = RevisionRow & {
  skill_selection?: LogRecordDto["skillSelection"] | null;
  signal_summary?: import("./genericSignals").LogSignalSummary | null;
  id: string;
  current_run_id?: string | null;
  report_id: string | null;
  file_name: string;
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
  created_by_credential_id?: string | null;
  created_by_credential_name?: string | null;
  related_parameter_id: string | null;
  related_parameter_project_id?: string | null;
  failure_reason: string | null;
  analysis_question: string | null;
  log_domain_id?: string | null;
  log_domain_name?: string | null;
  analysis_source?: LogAnalysisSource | null;
  degraded_reason?: LogAnalysisDegradedReason | null;
};

type EvidenceRow = {
  source_snapshot_id?: string | null;
  source_path?: string | null;
  source_line?: number | null;
  source_version_label?: string | null;
  decoded_fields?: import("./parsing/spec").DecodedEvent[] | null;
  id: string;
  stage: LogStage;
  line_numbers: number[];
  inference: string;
  suggested_action: string;
  rule_hit: string | null;
  file_path: string | null;
};

type RunRow = RevisionRow & {
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
  related_parameter_id: string | null;
  related_parameter_project_id: string | null;
  related_parameter_snapshot: unknown;
  submitted_by_user_id: string | null;
  job_status: LogRunStatus;
  run_status: LogRunStatus;
  record_status: LogRecordStatus;
  log_domain_id: string | null;
  log_domain_name: string | null;
  log_domain_description: string | null;
  skill_revision_id: string | null;
  skill_revision_spec: LogSkillSpec | null;
  legacy_knowledge_entry_ids: string[] | null;
  source_snapshot_id: string | null;
  source_snapshot_version_label: string | null;
  source_snapshot_status: NonNullable<AnalyzeLogInput["sourceSnapshot"]>["status"] | null;
  source_snapshot_selection: "matched_version" | "default" | "none";
  requested_source_version: string | null;
};

export type LogFileObjectDto = {
  id: string;
  organizationId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  uploadedByUserId: string | null;
  createdByCredentialId?: string;
  createdAt: string;
};

export type LogRunDto = {
  knowledgeRevisions: Array<{ entryId: string; revisionId?: string }>;
  sourceSnapshot?: AnalyzeLogInput["sourceSnapshot"];
  sourceSnapshotSelection?: "matched_version" | "default" | "none";
  requestedSourceVersion?: string;
  skillRevision: { id: string; number: number } | null;
  id: string;
  logId: string;
  status: LogRunStatus;
  currentStage: LogStage;
  progress: number;
  error: string | null;
  updatedAt: string;
};

export type CreateLogRecordWithRunAndJobInput = {
  /** Internal recommendation snapshot; never accepted from an HTTP request. */
  recommendedSkillRevisionId?: string;
  skillSelection?: LogRecordDto["skillSelection"];
  sourceVersion?: string;
  logId: string;
  runId: string;
  jobId: string;
  organizationId: string;
  fileObjectId: string;
  fileName: string;
  source: string;
  submittedByUserId: string | null;
  createdByCredentialId?: string;
  analysisQuestion?: string;
  relatedParameterId?: string;
  relatedParameterProjectId?: string;
  relatedParameterSnapshot?: RelatedParameterRunSnapshot;
  logDomainId?: string;
};

export type LogWorkerRunSnapshot = {
  files?: LogSkillSpec["files"];
  knowledgeEntryIds: string[];
  sourceSnapshotSelection: "matched_version" | "default" | "none";
  requestedSourceVersion?: string;
  procedure?: LogSkillSpec["procedure"];
  parsing?: LogSkillSpec["parsing"];
  sourceSnapshot: AnalyzeLogInput["sourceSnapshot"];
  jobId: string;
  organizationId: string;
  skillRevisionId: string | null;
  signalRules?: LogSkillSpec["signalRules"];
  runId: string;
  logId: string;
  fileObjectId: string;
  fileName: string;
  storageKey: string;
  analysisQuestion: string | null;
  /** Parameter binding the log was uploaded against; feeds get_related_parameter_context (P2). */
  relatedParameterId: string | null;
  relatedParameterProjectId: string | null;
  relatedParameterSnapshot: unknown;
  submittedByUserId: string | null;
  jobStatus: LogRunStatus;
  runStatus: LogRunStatus;
  recordStatus: LogRecordStatus;
  /** Bound log domain (glossary: Log domain); null = uncategorized log domain. */
  logDomain: {
    id: string;
    name: string;
    description: string | null;
    formatProfile: LogFormatProfile | null;
    /** Per-domain model-name override (P3b); null = global model. */
    modelOverride: string | null;
    stepBudget?: number;
    tokenBudget?: number;
  } | null;
};

export type PersistLogAnalysisReportInput = {
  organizationId: string;
  logId: string;
  runId: string;
  report: {
    knowledgeRevisions?: Array<{ entryId: string; revisionId: string }>;
    signalSummary?: import("./genericSignals").LogSignalSummary;
    confidence: number;
    conclusion: string;
    impact: string;
    severity: LogAnalysisSeverity;
    suggestedActions: string[];
    rawLines: string[];
    analysisSource?: LogAnalysisSource;
    degradedReason?: LogAnalysisDegradedReason;
    promptVersion?: string;
    model?: string;
  };
  evidence: AnalyzeLogEvidence[];
};

type CompleteLogAnalysisJobWithReportInput = PersistLogAnalysisReportInput & {
  files?: AnalyzeLogInput["files"];
  signal?: AbortSignal;
  sourceSnapshotSelection?: "matched_version" | "default" | "none";
  jobId: string;
  leaseOwner: string;
  sourceSnapshot?: AnalyzeLogInput["sourceSnapshot"];
};

function jsonb(value: unknown) {
  return JSON.stringify(value);
}

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
    storageKey: row.storage_key,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSizeBytes: Number(row.file_size_bytes),
    checksumSha256: row.checksum_sha256,
    uploadedByUserId: row.uploaded_by_user_id,
    createdByCredentialId: row.created_by_credential_id ?? undefined,
    createdAt: dateTimeToIso(row.created_at)
  };
}

function defaultConclusion(status: LogRecordStatus, failureReason: string | null) {
  if (status === "failed") return failureReason ?? "日志分析失败，未生成报告。";
  if (status === "complete") return "日志分析已完成。";
  return "日志正在排队或分析中。";
}

function defaultImpact(status: LogRecordStatus) {
  if (status === "failed") return "分析未完成，暂时无法判断影响。";
  if (status === "complete") return "请查看分析证据与建议操作。";
  return "处理完成后即可查看分析结果。";
}

function toLogDto(row: LogRecordRow, evidence = [] as LogRecordDto["evidence"], readableKnowledgeIds = new Set<string>()): LogRecordDto {
  const status = row.status;

  return {
    ...sourceProvenance(row),
    files: [],
    skillSelection: row.skill_selection ?? undefined,
    signalSummary: row.signal_summary ?? undefined,
    id: row.id,
    reportId: row.report_id ?? "",
    fileName: row.file_name,
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
    submittedBy: row.submitted_by ?? "已注销用户",
    createdByCredentialId: row.created_by_credential_id ?? undefined,
    createdByCredentialName: row.created_by_credential_name ?? undefined,
    relatedParameterId: row.related_parameter_id ?? undefined,
    relatedParameterProjectId: row.related_parameter_project_id ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    analysisQuestion: row.analysis_question ?? undefined,
    skillRevision: row.skill_revision_id && row.skill_revision_number ? { id: row.skill_revision_id, number: row.skill_revision_number } : null,
    knowledgeRevisions: (row.knowledge_revisions ?? []).map(({ entryId, revisionId }) => ({ entryId, ...(readableKnowledgeIds.has(entryId) ? { revisionId } : {}) })),
    logDomainId: row.log_domain_id ?? undefined,
    logDomainName: row.log_domain_name ?? undefined,
    analysisSource: row.analysis_source ?? undefined,
    degradedReason: row.degraded_reason ?? undefined
  };
}

function toEvidenceDto(row: EvidenceRow): LogRecordDto["evidence"][number] {
  return {
    ...(row.source_snapshot_id && row.source_path && row.source_line ? {
      sourceLocation: { snapshotId: row.source_snapshot_id, path: row.source_path, line: row.source_line },
      ...(row.source_version_label ? { sourceVersionLabel: row.source_version_label } : {})
    } : {}),
    ...(row.decoded_fields ? { decodedFields: row.decoded_fields } : {}),
    id: row.id,
    stageId: row.stage,
    lineNumbers: row.line_numbers,
    inference: row.inference,
    suggestedAction: row.suggested_action,
    filePath: row.file_path ?? null,
    ruleHit: row.rule_hit ?? undefined
  };
}

function sourceProvenance(row: RevisionRow) {
  return {
    sourceSnapshot: row.source_snapshot_id && row.source_snapshot_status
      ? { id: row.source_snapshot_id, status: row.source_snapshot_status,
        ...(row.source_snapshot_version_label ? { versionLabel: row.source_snapshot_version_label } : {}) } : undefined,
    sourceSnapshotSelection: row.source_snapshot_selection ?? undefined,
    requestedSourceVersion: row.requested_source_version ?? undefined
  };
}

function toRunDto(row: RunRow, readableKnowledgeIds: Set<string>): LogRunDto {
  return {
    knowledgeRevisions: (row.knowledge_revisions ?? []).map(({ entryId, revisionId }) => ({ entryId, ...(readableKnowledgeIds.has(entryId) ? { revisionId } : {}) })),
    ...sourceProvenance(row),
    id: row.id,
    logId: row.log_record_id,
    skillRevision: row.skill_revision_id && row.skill_revision_number ? { id: row.skill_revision_id, number: row.skill_revision_number } : null,
    status: row.status,
    currentStage: row.current_stage,
    progress: Number(row.progress),
    error: row.error_message,
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toWorkerLogRunSnapshot(row: WorkerLogRunSnapshotRow): LogWorkerRunSnapshot {
  return {
    knowledgeEntryIds: row.legacy_knowledge_entry_ids ?? row.skill_revision_spec?.knowledgeEntryIds ?? [],
    sourceSnapshotSelection: row.source_snapshot_selection,
    requestedSourceVersion: row.requested_source_version ?? undefined,
    sourceSnapshot: row.source_snapshot_id && row.source_snapshot_status
      ? { id: row.source_snapshot_id, status: row.source_snapshot_status,
        ...(row.source_snapshot_version_label ? { versionLabel: row.source_snapshot_version_label } : {}) } : null,
    jobId: row.job_id,
    skillRevisionId: row.skill_revision_id,
    procedure: row.skill_revision_spec?.procedure,
    signalRules: row.skill_revision_spec?.signalRules,
    files: row.skill_revision_spec?.files,
    parsing: row.skill_revision_spec?.parsing,
    organizationId: row.organization_id,
    runId: row.run_id,
    logId: row.log_id,
    fileObjectId: row.file_object_id,
    fileName: row.file_name,
    storageKey: row.storage_key,
    analysisQuestion: row.analysis_question,
    relatedParameterId: row.related_parameter_id,
    relatedParameterProjectId: row.related_parameter_project_id,
    relatedParameterSnapshot: row.related_parameter_snapshot,
    submittedByUserId: row.submitted_by_user_id,
    jobStatus: row.job_status,
    runStatus: row.run_status,
    recordStatus: row.record_status,
    logDomain: row.log_domain_id
      ? {
          id: row.log_domain_id,
          name: row.log_domain_name ?? row.log_domain_id,
          description: row.log_domain_description,
          formatProfile: row.skill_revision_spec?.formatProfile ?? null,
          modelOverride: row.skill_revision_spec?.modelOverride ?? null,
          stepBudget: row.skill_revision_spec?.stepBudget,
          tokenBudget: row.skill_revision_spec?.tokenBudget
        }
      : null
  };
}

const logSelect = `
  select
    lr.id,
    lr.current_run_id,
    report.id as report_id,
    lr.file_name,
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
    report.analysis_source,
    report.degraded_reason,
    report.signal_summary,
    lr.captured_at,
    lr.updated_at,
    users.name as submitted_by,
    lr.created_by_credential_id,
    credential.name as created_by_credential_name,
    lr.related_parameter_id,
    lr.related_parameter_project_id,
    lr.failure_reason,
    lr.analysis_question,
    lr.log_domain_id,
    lr.skill_selection,
    ld.name as log_domain_name,
    lar.skill_revision_id, sr.revision_number as skill_revision_number,
    lar.source_snapshot_id, lar.source_snapshot_status, lar.source_snapshot_selection, lar.requested_source_version,
    source.version_label as source_snapshot_version_label, lar.knowledge_revisions
  from log_records lr
  inner join log_file_objects lfo on lfo.id = lr.file_object_id
  left join log_analysis_runs lar on lar.id = lr.current_run_id
  left join log_skill_revisions sr on sr.id = lar.skill_revision_id and sr.organization_id = lr.organization_id
  left join log_source_snapshots source on source.id = lar.source_snapshot_id and source.organization_id = lr.organization_id
  left join log_analysis_reports report on report.run_id = lr.current_run_id
  left join users on users.id = lr.submitted_by_user_id
  left join log_integration_credentials credential on credential.id = lr.created_by_credential_id and credential.organization_id = lr.organization_id
  left join log_domains ld on ld.id = lr.log_domain_id
`;

export function relatedParameterVisibilityValues(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("parameter:view")) {
    return { organizationWide: false, projectIds: [] as string[] };
  }
  const organizationWide = auth.roles.some((role) => role.projectId === null);
  const projectIds = [...new Set(auth.roles.flatMap((role) => role.projectId ? [role.projectId] : []))];
  return { organizationWide, projectIds };
}

export async function createFileObject(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    storageKey: string;
    fileName: string;
    contentType: string;
    fileSizeBytes: number;
    checksumSha256: string;
    uploadedByUserId: string | null;
    createdByCredentialId?: string;
  }
) {
  const result = await db.query<LogFileObjectRow>(
    `
    insert into log_file_objects (
      id, organization_id, storage_key, file_name, content_type,
      file_size_bytes, checksum_sha256, uploaded_by_user_id, created_by_credential_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.storageKey,
      input.fileName,
      input.contentType,
      input.fileSizeBytes,
      input.checksumSha256,
      input.uploadedByUserId,
      input.createdByCredentialId ?? null
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
    const skillRevisionId = input.recommendedSkillRevisionId ?? await currentSkillRevisionId(tx, input.organizationId, input.logDomainId);
    await tx.query<LogRecordRow>(
      `
      insert into log_records (
        id, organization_id, file_object_id, file_name, source, status,
        analysis_question, related_parameter_id, related_parameter_project_id, submitted_by_user_id, log_domain_id, created_by_credential_id, skill_selection
      )
      values ($1, $2, $3, $4, $5, 'processing', $6, $7, $8, $9, $10, $11, $12::jsonb)
      returning id
      `,
      [
        input.logId,
        input.organizationId,
        input.fileObjectId,
        input.fileName,
        input.source,
        input.analysisQuestion ?? null,
        input.relatedParameterId ?? null,
        input.relatedParameterProjectId ?? null,
        input.submittedByUserId,
        input.logDomainId ?? null,
        input.createdByCredentialId ?? null,
        input.skillSelection ? jsonb(input.skillSelection) : null
      ]
    );
    await tx.query<RunRow>(
      `
      insert into log_analysis_runs (
        id, organization_id, log_record_id, status, current_stage, progress, related_parameter_snapshot, skill_revision_id, requested_source_version
      )
      values ($1, $2, $3, 'queued', 'parse', 0, $4::jsonb, $5, $6)
      returning id, log_record_id, status, current_stage, progress, error_message, updated_at
      `,
      [input.runId, input.organizationId, input.logId, input.relatedParameterSnapshot ? jsonb(input.relatedParameterSnapshot) : null, skillRevisionId, input.sourceVersion ?? null]
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
        null::text as analysis_source,
        null::text as degraded_reason,
        captured_at,
        updated_at,
        (select name from users where id = log_records.submitted_by_user_id) as submitted_by,
        created_by_credential_id,
        (select name from log_integration_credentials where id = log_records.created_by_credential_id and organization_id = log_records.organization_id) as created_by_credential_name,
        related_parameter_id,
        related_parameter_project_id,
        failure_reason,
        analysis_question,
        log_domain_id,
        skill_selection,
        (select name from log_domains where id = log_records.log_domain_id) as log_domain_name,
        (select skill_revision_id from log_analysis_runs where id = log_records.current_run_id) as skill_revision_id,
        (select revision_number from log_skill_revisions where id = (select skill_revision_id from log_analysis_runs where id = log_records.current_run_id)) as skill_revision_number
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
    fileObjectId: string;
    fileName: string;
    source: string;
    submittedByUserId: string | null;
    createdByCredentialId?: string;
    failureReason: string;
    analysisQuestion?: string;
    relatedParameterId?: string;
    relatedParameterProjectId?: string;
    logDomainId?: string;
    skillSelection?: LogRecordDto["skillSelection"];
  }
) {
  const result = await db.query<LogRecordRow>(
    `
    insert into log_records (
      id, organization_id, file_object_id, file_name, source, status,
      failure_reason, analysis_question, related_parameter_id, submitted_by_user_id, log_domain_id,
      related_parameter_project_id, created_by_credential_id, skill_selection
    )
    values ($1, $2, $3, $4, $5, 'failed', $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
    returning
      id,
      current_run_id,
      null::text as report_id,
      file_name,
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
      null::text as analysis_source,
      null::text as degraded_reason,
      captured_at,
      updated_at,
      (select name from users where id = log_records.submitted_by_user_id) as submitted_by,
      created_by_credential_id,
      (select name from log_integration_credentials where id = log_records.created_by_credential_id and organization_id = log_records.organization_id) as created_by_credential_name,
      related_parameter_id,
      related_parameter_project_id,
      failure_reason,
      analysis_question,
      log_domain_id,
      skill_selection,
      (select name from log_domains where id = log_records.log_domain_id) as log_domain_name
    `,
    [
      input.id,
      input.organizationId,
      input.fileObjectId,
      input.fileName,
      input.source,
      input.failureReason,
      input.analysisQuestion ?? null,
      input.relatedParameterId ?? null,
      input.submittedByUserId,
      input.logDomainId ?? null,
      input.relatedParameterProjectId ?? null,
      input.createdByCredentialId ?? null,
      input.skillSelection ? jsonb(input.skillSelection) : null
    ]
  );

  return result.rows[0] ? toLogDto(result.rows[0]) : null;
}

export async function listLogs(
  db: Queryable,
  auth: AuthContext,
  query: {
    status?: LogRecordStatus;
    timeWindow?: "today" | "7d" | "30d";
    includeArchived?: boolean;
  }
) {
  const interval = query.timeWindow
    ? query.timeWindow === "today" ? "1 day" : query.timeWindow === "7d" ? "7 days" : "30 days"
    : null;
  const { organizationWide, projectIds } = relatedParameterVisibilityValues(auth);
  const values: unknown[] = [
    auth.organization.id,
    query.status || null,
    interval,
    Boolean(query.includeArchived),
    organizationWide,
    projectIds
  ];

  const result = await db.query<LogRecordRow>(
    `
    ${logSelect}
    where lr.organization_id = $1
      and ($2::text is null or lr.status = $2)
      and ($3::interval is null or lr.captured_at >= now() - $3::interval)
      and ($4::boolean or lr.archive_state = 'active')
      and (
        lr.related_parameter_id is null
        or (
          lr.related_parameter_project_id is not null
          and exists (
            select 1 from public.projects related_project
            where related_project.id = lr.related_parameter_project_id
              and related_project.organization_id = lr.organization_id
          )
          and ($5::boolean or lr.related_parameter_project_id = any($6::text[]))
        )
      )
    order by lr.captured_at desc, lr.id asc
    `,
    values
  );

  const readableKnowledgeIds = await readableKnowledgeEntryIds(db, auth, result.rows.flatMap((row) => (row.knowledge_revisions ?? []).map((revision) => revision.entryId)));
  return Promise.all(result.rows.map(async (row) => ({ ...toLogDto(row, [], readableKnowledgeIds), files: fileInventory(await loadLogFiles(db, auth.organization.id, row.id)) })));
}

export async function getLogDetail(db: Queryable, auth: AuthContext | IntegrationPrincipal, logId: string) {
  const integration = "kind" in auth;
  const organizationId = integration ? auth.organizationId : auth.organization.id;
  const { organizationWide, projectIds } = integration ? { organizationWide: false, projectIds: [] } : relatedParameterVisibilityValues(auth);
  const result = await db.query<LogRecordRow>(
    `
    ${logSelect}
    where lr.organization_id = $1
      and lr.id = $2
      and ($5::text is null or lr.created_by_credential_id = $5)
      and (
        lr.related_parameter_id is null
        or (
          lr.related_parameter_project_id is not null
          and exists (
            select 1 from public.projects related_project
            where related_project.id = lr.related_parameter_project_id
              and related_project.organization_id = lr.organization_id
          )
          and ($3::boolean or lr.related_parameter_project_id = any($4::text[]))
        )
      )
    limit 1
    `,
    [organizationId, logId, organizationWide, projectIds, integration ? auth.credentialId : null]
  );
  const row = result.rows[0];
  if (!row) return null;

  const evidenceResult = await db.query<EvidenceRow>(
    `
    select e.id, e.stage, e.line_numbers, e.inference, e.suggested_action, e.rule_hit, e.file_path, e.decoded_fields,
      e.source_snapshot_id, e.source_path, e.source_line, s.version_label as source_version_label
    from log_evidence e
    left join log_source_snapshots s on s.id = e.source_snapshot_id and s.organization_id = e.organization_id
    where e.organization_id = $1
      and e.log_record_id = $2
      and ($3::text is null or e.run_id = $3)
    order by e.created_at asc, e.id asc
    `,
    [organizationId, logId, row.current_run_id ?? null]
  );

  const readableKnowledgeIds = integration ? new Set<string>() : await readableKnowledgeEntryIds(db, auth, (row.knowledge_revisions ?? []).map((revision) => revision.entryId));
  return { ...toLogDto(row, evidenceResult.rows.map(toEvidenceDto), readableKnowledgeIds), files: fileInventory(await loadLogFiles(db, organizationId, logId)) };
}

export async function listRuns(db: Queryable, auth: AuthContext, logId: string) {
  const result = await db.query<RunRow>(
    `
    select lar.id, lar.log_record_id, lar.status, lar.current_stage, lar.progress, lar.error_message, lar.updated_at, lar.skill_revision_id, sr.revision_number as skill_revision_number,
      lar.source_snapshot_id, lar.source_snapshot_status, lar.source_snapshot_selection, lar.requested_source_version,
      source.version_label as source_snapshot_version_label, lar.knowledge_revisions
    from log_analysis_runs lar
    left join log_skill_revisions sr on sr.id = lar.skill_revision_id and sr.organization_id = lar.organization_id
    left join log_source_snapshots source on source.id = lar.source_snapshot_id and source.organization_id = lar.organization_id
    inner join log_records lr on lr.id = lar.log_record_id
    where lar.organization_id = $1
      and lr.organization_id = $1
      and lar.log_record_id = $2
    order by lar.created_at desc, lar.id desc
    `,
    [auth.organization.id, logId]
  );

  const readableKnowledgeIds = await readableKnowledgeEntryIds(db, auth, result.rows.flatMap((row) => (row.knowledge_revisions ?? []).map((revision) => revision.entryId)));
  return result.rows.map((row) => toRunDto(row, readableKnowledgeIds));
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
      lr.related_parameter_id,
      lr.related_parameter_project_id,
      run.related_parameter_snapshot,
      lr.submitted_by_user_id,
      job.status as job_status,
      run.status as run_status,
      lr.status as record_status,
      lr.log_domain_id,
      ld.name as log_domain_name,
      ld.description as log_domain_description,
      run.skill_revision_id, sr.spec as skill_revision_spec, run.legacy_knowledge_entry_ids,
      source.id as source_snapshot_id, source.status as source_snapshot_status, source.version_label as source_snapshot_version_label,
      run.requested_source_version,
      case when matched.id is not null then 'matched_version' when source.id is not null then 'default' else 'none' end as source_snapshot_selection
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
    left join log_skill_revisions sr on sr.id = run.skill_revision_id and sr.organization_id = run.organization_id
    left join lateral (
      select s.id from log_source_snapshots s
      where s.organization_id = run.organization_id and s.skill_id = sr.skill_id
        and s.version_label = run.requested_source_version and s.status <> 'archived'
      limit 1
    ) matched on true
    left join log_source_snapshots source on source.id = coalesce(matched.id, sr.spec->>'defaultSourceSnapshotId')
      and source.organization_id = run.organization_id and source.skill_id = sr.skill_id
    left join log_domains ld
      on ld.id = lr.log_domain_id
      and ld.organization_id = job.organization_id
    where job.id = $1
    limit 1
    `,
    [jobId]
  );

  return result.rows[0] ? toWorkerLogRunSnapshot(result.rows[0]) : null;
}

export async function persistLogDecodedArtifact(db: Database, input: {
  organizationId: string; runId: string; jobId: string; leaseOwner: string;
  objectKey: string | null; counts: import("./parsing/spec").DecodeCounts;
}) {
  return db.transaction(async (tx) => {
    // Lock the current lease before touching run metadata, as report completion does.
    if (!await updateJobProgress(tx, { ...input, progress: 10, currentStage: "parse" })) return false;
    const result = await tx.query(`update log_analysis_runs run
      set decoded_events_object_key = $3, decoded_event_counts = $4::jsonb
      where run.organization_id = $1 and run.id = $2
        and exists (select 1 from jobs job where job.organization_id = run.organization_id
          and job.id = $5 and job.target_id = run.id)
        and exists (select 1 from log_records lr where lr.id = run.log_record_id
          and lr.organization_id = run.organization_id and lr.current_run_id = run.id)`,
    [input.organizationId, input.runId, input.objectKey, jsonb(input.counts), input.jobId]);
    return result.rowCount === 1;
  });
}

export async function persistLogAnalysisReport(db: Database, input: PersistLogAnalysisReportInput) {
  await db.transaction(async (tx) => {
    await tx.query(`update log_analysis_runs set knowledge_revisions = $3::jsonb where organization_id = $1 and id = $2`,
      [input.organizationId, input.runId, jsonb(input.report.knowledgeRevisions ?? [])]);
    await tx.query(
      `
      insert into log_analysis_reports (
        id, organization_id, log_record_id, run_id, confidence, conclusion, impact,
        severity, suggested_actions, raw_lines, analysis_source, degraded_reason, prompt_version, model, signal_summary
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      on conflict (id) do update
      set confidence = excluded.confidence,
        conclusion = excluded.conclusion,
        impact = excluded.impact,
        severity = excluded.severity,
        suggested_actions = excluded.suggested_actions,
        raw_lines = excluded.raw_lines,
        analysis_source = excluded.analysis_source,
        degraded_reason = excluded.degraded_reason,
        prompt_version = excluded.prompt_version,
        model = excluded.model,
        signal_summary = excluded.signal_summary
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
        jsonb(input.report.suggestedActions),
        jsonb(input.report.rawLines),
        input.report.analysisSource ?? null,
        input.report.degradedReason ?? null,
        input.report.promptVersion ?? null,
        input.report.model ?? null,
        input.report.signalSummary ? jsonb(input.report.signalSummary) : null
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
          inference, suggested_action, rule_hit, file_path, decoded_fields, source_snapshot_id, source_path, source_line
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
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
          evidence.ruleHit ?? null,
          evidence.filePath ?? null,
          evidence.decodedFields ? jsonb(evidence.decodedFields) : null,
          evidence.sourceLocation?.snapshotId ?? null,
          evidence.sourceLocation?.path ?? null,
          evidence.sourceLocation?.line ?? null
        ]
      );
    }
  });
}

export async function completeLogAnalysisJobWithReport(db: Database, input: CompleteLogAnalysisJobWithReportInput) {
  try {
    await db.transaction(async (tx) => {
      input.signal?.throwIfAborted();
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

      await tx.query(`update log_analysis_runs set knowledge_revisions = $3::jsonb where organization_id = $1 and id = $2`,
        [input.organizationId, input.runId, jsonb(input.report.knowledgeRevisions ?? [])]);

      await tx.query(
        `
        insert into log_analysis_reports (
          id, organization_id, log_record_id, run_id, confidence, conclusion, impact,
          severity, suggested_actions, raw_lines, analysis_source, degraded_reason, prompt_version, model, signal_summary
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        on conflict (id) do update
        set confidence = excluded.confidence,
          conclusion = excluded.conclusion,
          impact = excluded.impact,
          severity = excluded.severity,
          suggested_actions = excluded.suggested_actions,
          raw_lines = excluded.raw_lines,
          analysis_source = excluded.analysis_source,
          degraded_reason = excluded.degraded_reason,
          prompt_version = excluded.prompt_version,
          model = excluded.model,
          signal_summary = excluded.signal_summary
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
          jsonb(input.report.suggestedActions),
          jsonb(input.report.rawLines),
          input.report.analysisSource ?? null,
          input.report.degradedReason ?? null,
          input.report.promptVersion ?? null,
          input.report.model ?? null,
          input.report.signalSummary ? jsonb(input.report.signalSummary) : null
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
        input.signal?.throwIfAborted();
        await tx.query(
          `
          insert into log_evidence (
            id, organization_id, log_record_id, run_id, stage, line_numbers,
            inference, suggested_action, rule_hit, file_path, decoded_fields, source_snapshot_id, source_path, source_line
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
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
            evidence.ruleHit ?? null,
            evidence.filePath ?? null,
            evidence.decodedFields ? jsonb(evidence.decodedFields) : null,
            evidence.sourceLocation?.snapshotId ?? null,
            evidence.sourceLocation?.path ?? null,
            evidence.sourceLocation?.line ?? null
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
        message: "分析报告已生成。"
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
          source_snapshot_id = $5,
          source_snapshot_status = $6,
          source_snapshot_selection = $7,
          progress = 100,
          completed_at = now(),
          updated_at = now()
        where organization_id = $1
          and id = $2
          and log_record_id = $3
        `,
        [input.organizationId, input.runId, input.logId, "report", input.sourceSnapshot?.id ?? null, input.sourceSnapshot?.status ?? null,
          input.sourceSnapshotSelection ?? (input.sourceSnapshot ? "default" : "none")]
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
      if (input.files) await tx.query(`update log_files lf set role = assigned.role, skill_matched = assigned.skill_matched
        from jsonb_to_recordset($4::jsonb) as assigned(path text, role text, skill_matched boolean)
        where lf.organization_id=$1 and lf.record_id=$2 and lf.path=assigned.path
          and exists (select 1 from log_records r where r.organization_id=$1 and r.id=$2 and r.current_run_id=$3)`,
      [input.organizationId, input.logId, input.runId, jsonb(input.files.map((file) =>
        ({ path: file.path, role: file.role ?? null, skill_matched: file.skillMatched ?? null })))]);
      await enqueueTerminalLogWebhook(tx, input);
      input.signal?.throwIfAborted();
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
    await enqueueTerminalLogWebhook(tx, input);
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
    await enqueueTerminalLogWebhook(tx, input);
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
      id, organization_id, log_record_id, user_id, rating, note, run_id
    )
    values (
      $1, $2, $3, $4, $5, $6,
      (select current_run_id from log_records where organization_id = $2 and id = $3)
    )
    `,
    [input.id, auth.organization.id, input.logId, auth.user.id, input.rating, input.note ?? null]
  );
}

type FeedbackInsightRow = {
  log_domain_id: string | null;
  log_domain_name: string | null;
  analysis_source: LogAnalysisSource | null;
  prompt_version: string | null;
  total_count: number | string;
  helpful_count: number | string;
  last_feedback_at: string | Date;
};

export type LogFeedbackInsightDto = {
  /** null = uncategorized log domain. */
  logDomainId: string | null;
  logDomainName: string | null;
  /** null = report predates analyzer provenance (legacy rule reports). */
  analysisSource: LogAnalysisSource | null;
  promptVersion: string | null;
  totalCount: number;
  helpfulCount: number;
  /** helpfulCount / totalCount, in [0, 1]. */
  helpfulRate: number;
  lastFeedbackAt: string;
};

/**
 * Online-monitoring aggregation (P3): helpful rate per log domain ×
 * analysis source × prompt version. Feedback is attributed to the analysis
 * run stamped on the row (`log_feedback.run_id`); rows that predate the
 * column fall back to the log's current run so leftovers still group.
 */
export async function aggregateFeedbackInsights(
  db: Queryable,
  auth: AuthContext,
  query: { timeWindow?: "today" | "7d" | "30d" } = {}
): Promise<LogFeedbackInsightDto[]> {
  const interval = query.timeWindow
    ? query.timeWindow === "today" ? "1 day" : query.timeWindow === "7d" ? "7 days" : "30 days"
    : null;
  const { organizationWide, projectIds } = relatedParameterVisibilityValues(auth);
  const values: unknown[] = [auth.organization.id, interval, organizationWide, projectIds];

  const result = await db.query<FeedbackInsightRow>(
    `
    select
      lr.log_domain_id,
      ld.name as log_domain_name,
      report.analysis_source,
      report.prompt_version,
      count(*) as total_count,
      count(*) filter (where lf.rating = 'helpful') as helpful_count,
      max(lf.created_at) as last_feedback_at
    from log_feedback lf
    inner join log_records lr
      on lr.id = lf.log_record_id
      and lr.organization_id = lf.organization_id
    left join log_analysis_reports report
      on report.run_id = coalesce(lf.run_id, lr.current_run_id)
    left join log_domains ld on ld.id = lr.log_domain_id
    where lf.organization_id = $1
      and ($2::interval is null or lf.created_at >= now() - $2::interval)
      and (
        lr.related_parameter_id is null
        or (
          lr.related_parameter_project_id is not null
          and exists (
            select 1 from public.projects related_project
            where related_project.id = lr.related_parameter_project_id
              and related_project.organization_id = lr.organization_id
          )
          and ($3::boolean or lr.related_parameter_project_id = any($4::text[]))
        )
      )
    group by lr.log_domain_id, ld.name, report.analysis_source, report.prompt_version
    order by total_count desc, log_domain_name asc nulls first, prompt_version desc nulls last
    `,
    values
  );

  return result.rows.map((row) => {
    const totalCount = Number(row.total_count);
    const helpfulCount = Number(row.helpful_count);
    return {
      logDomainId: row.log_domain_id,
      logDomainName: row.log_domain_name,
      analysisSource: row.analysis_source,
      promptVersion: row.prompt_version,
      totalCount,
      helpfulCount,
      helpfulRate: totalCount > 0 ? helpfulCount / totalCount : 0,
      lastFeedbackAt: dateTimeToIso(row.last_feedback_at)
    };
  });
}

export async function createRerunWithJob(
  db: Queryable,
  input: {
    runId: string;
    jobId: string;
    organizationId: string;
    logId: string;
    analysisQuestion?: string;
    logDomainId?: string;
    skillRevisionId: string | null;
    preserveLegacyKnowledgeScope?: boolean;
    relatedParameterSnapshot?: RelatedParameterRunSnapshot;
  }
): Promise<LogAnalysisJobDto> {
  await db.query<RunRow>(
    `
    insert into log_analysis_runs (
      id, organization_id, log_record_id, status, current_stage, progress, related_parameter_snapshot, skill_revision_id, legacy_knowledge_entry_ids, requested_source_version
    )
    values ($1, $2, $3, 'queued', 'parse', 0, $4::jsonb, $5,
      case when $6::boolean then (select old.legacy_knowledge_entry_ids from log_records record
        join log_analysis_runs old on old.id = record.current_run_id and old.organization_id = record.organization_id
        where record.organization_id = $2 and record.id = $3) end,
      (select prior.requested_source_version from log_records lr join log_analysis_runs prior
        on prior.id = lr.current_run_id and prior.organization_id = lr.organization_id
        where lr.id = $3 and lr.organization_id = $2))
    returning id, log_record_id, status, current_stage, progress, error_message, updated_at
    `,
    [input.runId, input.organizationId, input.logId, input.relatedParameterSnapshot ? jsonb(input.relatedParameterSnapshot) : null, input.skillRevisionId,
      Boolean(input.preserveLegacyKnowledgeScope)]
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
      log_domain_id = coalesce($5, log_domain_id),
      skill_selection = case when $5::text is not null then '{"mode":"explicit","reasons":[]}'::jsonb else skill_selection end,
      failure_reason = null,
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.logId, input.runId, input.analysisQuestion ?? null, input.logDomainId ?? null]
  );
  await db.query("update log_files set role=null, skill_matched=null where organization_id=$1 and record_id=$2",
    [input.organizationId, input.logId]);

  return job;
}
