import type { Queryable } from "../../shared/database/client";
import type {
  ChangeRequestDto,
  ParameterDraftDto,
  ParameterImportBatchDto,
  ParameterImportSummaryDto,
  ParameterHistoryEntryDto,
  ParameterRecordDto,
  ParameterSubmissionItemDto,
  ParameterSubmissionRoundDto,
  ParameterWorkflowAssigneesDto,
  ProjectAdminDetailDto,
  ProjectAdminSummaryDto,
  ProjectDto,
  ProjectModuleDto
} from "./types";
import {
  buildParameterModuleSubtreeFilter
} from "./parameterModuleRepository";

export {
  buildParameterModuleSubtreeFilter,
  countParameterModuleChildren,
  countParametersForModule,
  createParameterModule,
  deleteParameterModule,
  getParameterModuleById,
  getParameterModuleByName,
  listParameterModules,
  moveParameterModule,
  resolveParameterModulePathNames,
  updateParameterModule
} from "./parameterModuleRepository";
import type { BackendRoleId } from "../auth/types";
import {
  getMostAdvancedActiveParameterStatus,
  type ParameterChangeRequestStatus,
  type ParameterReviewDecision,
  type ParameterRiskLevel,
  type ParameterSubmissionRoundStatus
} from "./status";
import { buildChangeRequestImpact } from "./impact";

export type ImportPreviewClassification = "added" | "updated" | "unchanged" | "conflict";

export type PersistedImportBatchItem = {
  id: string;
  name: string;
  module: string;
  risk: ParameterRiskLevel;
  unit: string;
  range: string;
  currentValue?: string;
  recommendedValue?: string;
  description?: string;
  explanation?: string;
  configFormat?: string;
  classification: ImportPreviewClassification;
  definitionId?: string;
  projectParameterValueId?: string;
  riskFlag: boolean;
};

export type PersistedImportBatchDto = Omit<ParameterImportBatchDto, "items"> & {
  items: PersistedImportBatchItem[];
};

type ProjectRow = {
  id: string;
  name: string;
  code: string;
  status?: string;
  updated_at?: string | Date;
  module_count?: number | string;
  parameter_count?: number | string;
};

type ProjectModuleRow = {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  parent_id?: string | null;
  path?: string | null;
  depth?: number | string | null;
  parameter_module_id?: string | null;
};

type ParameterRow = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  explanation: string;
  config_format: string;
  value_kind?: string | null;
  module: string;
  parameter_module_id?: string | null;
  module_path?: string | null;
  default_range: string;
  unit: string;
  risk: ParameterRiskLevel;
  current_value: string;
  recommended_value: string;
  source_file_name?: string | null;
  source_node_path?: string | null;
  updated_at: string | Date;
};

type ParameterDefinitionImportRow = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  config_format: string;
  module: string;
  default_range: string;
  unit: string;
  risk: ParameterRiskLevel;
  project_parameter_value_id: string | null;
  current_value: string | null;
  recommended_value: string | null;
  value_version: number | string | null;
};

export type ProjectParameterForUpdate = {
  id: string;
  projectId: string;
  parameterDefinitionId: string;
  name: string;
  module: string;
  unit: string;
  risk: ParameterRiskLevel;
  currentValue: string;
  recommendedValue: string;
  valueVersion: number;
};

export type ProjectParameterValueMatch = {
  id: string;
  projectId: string;
  parameterDefinitionId: string;
  name: string;
  module: string;
  currentValue: string;
};

type ProjectParameterForUpdateRow = {
  id: string;
  project_id: string;
  parameter_definition_id: string;
  name: string;
  module: string;
  unit: string;
  risk: ParameterRiskLevel;
  current_value: string;
  recommended_value: string;
  value_version: number | string;
};

type ProjectParameterValueMatchRow = {
  id: string;
  project_id: string;
  parameter_definition_id: string;
  name: string;
  module: string;
  current_value: string;
};

type ParameterHistoryRow = {
  version: number | string;
  value: string;
  changed_at: string | Date;
  changed_by: string | null;
  request_id: string | null;
};

type DraftRow = {
  id: string;
  project_id: string;
  project_parameter_value_id: string;
  user_id?: string;
  target_value: string;
  reason: string;
  origin?: "manual" | "file_sync";
  origin_file_version_id?: string | null;
  updated_at: string | Date;
};

export type ParameterDraftWithOrigin = {
  id: string;
  userId: string;
  projectId: string;
  projectParameterValueId: string;
  targetValue: string;
  origin: "manual" | "file_sync";
  originFileVersionId?: string;
  updatedAt: string;
};

type FileSyncConflictRow = {
  id: string;
  organization_id: string;
  project_id: string;
  project_parameter_value_id: string;
  parameter_definition_id: string;
  file_version_id: string;
  file_draft_id: string;
  ui_draft_id: string;
  file_value: string;
  ui_draft_value: string;
  status: "open" | "resolved_file" | "resolved_ui";
  resolved_by_user_id: string | null;
  resolved_at: string | Date | null;
  created_at: string | Date;
};

export type FileSyncConflictRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  projectParameterValueId: string;
  parameterDefinitionId: string;
  fileVersionId: string;
  fileDraftId: string;
  uiDraftId: string;
  fileValue: string;
  uiDraftValue: string;
  status: "open" | "resolved_file" | "resolved_ui";
  resolvedByUserId?: string;
  resolvedAt?: string;
  createdAt: string;
};

type SubmissionRoundRow = {
  id: string;
  project_id: string;
  project_name: string;
  submitter: string;
  status: ParameterSubmissionRoundStatus;
  summary: string;
  created_at: string | Date;
};

type ChangeRequestRow = {
  id: string;
  submission_round_id: string | null;
  project_id: string;
  project_parameter_value_id: string;
  parameter_definition_id?: string;
  base_version?: number | string;
  module: string;
  title: string;
  current_value: string;
  target_value: string;
  submitter: string;
  submitter_user_id?: string;
  status: ParameterChangeRequestStatus;
  risk: ParameterRiskLevel;
  created_at: string | Date;
  updated_at: string | Date;
  assigned_to: string | null;
  assigned_to_user_id?: string | null;
  workflow_hardware_committer_user_id?: string | null;
  workflow_software_committer_user_id?: string | null;
  workflow_software_user_id?: string | null;
  reviewer_note: string | null;
  reject_reason: string | null;
  fast_track: boolean;
  value_kind?: string | null;
  config_format?: string;
  source_file_name?: string | null;
  source_node_path?: string | null;
};

type WorkflowAssigneesRow = {
  submission_round_id: string;
  workflow_hardware_committer_user_id: string | null;
  workflow_software_committer_user_id: string | null;
  workflow_software_user_id: string | null;
};

export type ReviewDecisionDto = {
  id: string;
  requestId: string;
  reviewerUserId: string;
  decision: ParameterReviewDecision;
  fromStatus: ParameterChangeRequestStatus;
  toStatus: ParameterChangeRequestStatus;
  note?: string;
  createdAt: string;
};

type ReviewDecisionRow = {
  id: string;
  request_id: string;
  reviewer_user_id: string;
  decision: ParameterReviewDecision;
  from_status: ParameterChangeRequestStatus;
  to_status: ParameterChangeRequestStatus;
  note: string | null;
  created_at: string | Date;
};

export type ChangeRequestMergeResult = {
  id: string;
  projectParameterValueId: string;
  parameterDefinitionId: string;
  projectId: string;
  targetValue: string;
  baseVersion: number;
  newVersion: number;
};

type ChangeRequestMergeRow = {
  id: string;
  project_parameter_value_id: string;
  parameter_definition_id: string;
  project_id: string;
  target_value: string;
  base_version: number | string;
  new_version: number | string;
};

type SubmissionItemRow = {
  change_request_id: string;
  project_parameter_value_id: string;
  name: string;
  module: string;
  current_value: string;
  target_value: string;
  unit: string;
  risk: ParameterRiskLevel;
  reason: string;
  value_kind?: string | null;
  config_format?: string;
};

type ImportBatchRow = {
  id: string;
  project_id: string;
  source_name: string;
  status: "previewed" | "applied";
  summary: ParameterImportSummaryDto;
  items: PersistedImportBatchItem[];
  created_at: string | Date;
  applied_at: string | Date | null;
};

type ImportApplyResultRow = {
  id: string;
  definition_id: string;
  project_parameter_value_id: string;
  new_version: number | string;
};

export type ParameterDefinitionImportCandidate = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  range: string;
  unit: string;
  risk: ParameterRiskLevel;
  projectParameterValueId?: string;
  currentValue?: string;
  recommendedValue?: string;
  valueVersion?: number;
};

export type ImportApplyResult = {
  id: string;
  definitionId: string;
  projectParameterValueId: string;
  newVersion: number;
};

export type ListParametersQuery = {
  organizationId: string;
  projectId?: string;
  module?: string;
  moduleId?: string;
  includeDescendants?: boolean;
  risk?: ParameterRiskLevel | ParameterRiskLevel[];
  q?: string;
  limit?: number;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function resolveParameterValueKind(row: { value_kind?: string | null; config_format: string }) {
  if (row.value_kind === "complex" || row.value_kind === "scalar") {
    return row.value_kind;
  }

  const format = row.config_format.trim();
  if (format.startsWith("DTS:") || format.toLowerCase().includes("string-list")) {
    return "complex";
  }

  return "scalar";
}

function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code
  };
}

function toProjectAdminSummaryDto(row: ProjectRow): ProjectAdminSummaryDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status ?? "initialized",
    moduleCount: Number(row.module_count ?? 0),
    parameterCount: Number(row.parameter_count ?? 0),
    updatedAt: row.updated_at ? dateTimeToIso(row.updated_at) : new Date(0).toISOString()
  };
}

function toProjectModuleDto(row: ProjectModuleRow): ProjectModuleDto {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sortOrder: row.sort_order,
    parentId: row.parent_id ?? null,
    path: row.path ?? undefined,
    depth: row.depth === null || row.depth === undefined ? undefined : Number(row.depth),
    parameterModuleId: row.parameter_module_id ?? null
  };
}

function parseModulePathNames(modulePath: string | null | undefined): string[] | undefined {
  if (!modulePath) {
    return undefined;
  }
  const trimmed = modulePath.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.split("/").filter(Boolean);
}

function toParameterDto(row: ParameterRow, history: ParameterHistoryEntryDto[] = []): ParameterRecordDto {
  const updatedAt = dateTimeToIso(row.updated_at);
  const modulePath = parseModulePathNames(row.module_path);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    explanation: row.explanation,
    configFormat: row.config_format,
    valueKind: resolveParameterValueKind(row),
    module: row.module,
    moduleId: row.parameter_module_id ?? undefined,
    modulePath,
    projectId: row.project_id,
    currentValue: row.current_value,
    recommendedValue: row.recommended_value,
    range: row.default_range,
    unit: row.unit,
    risk: row.risk,
    sourceFileName: row.source_file_name ?? undefined,
    sourceNodePath: row.source_node_path ?? undefined,
    updatedAt,
    updatedAtTs: updatedAt,
    history
  };
}

function toHistoryDto(row: ParameterHistoryRow): ParameterHistoryEntryDto {
  return {
    version: String(row.version),
    value: row.value,
    changedAt: dateTimeToIso(row.changed_at),
    changedBy: row.changed_by ?? "",
    requestId: row.request_id ?? undefined
  };
}

function toDraftDto(row: DraftRow): ParameterDraftDto {
  return {
    id: row.id,
    projectId: row.project_id,
    parameterId: row.project_parameter_value_id,
    targetValue: row.target_value,
    reason: row.reason,
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toDraftWithOrigin(row: DraftRow): ParameterDraftWithOrigin {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    projectId: row.project_id,
    projectParameterValueId: row.project_parameter_value_id,
    targetValue: row.target_value,
    origin: row.origin ?? "manual",
    originFileVersionId: row.origin_file_version_id ?? undefined,
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toFileSyncConflictRecord(row: FileSyncConflictRow): FileSyncConflictRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    projectParameterValueId: row.project_parameter_value_id,
    parameterDefinitionId: row.parameter_definition_id,
    fileVersionId: row.file_version_id,
    fileDraftId: row.file_draft_id,
    uiDraftId: row.ui_draft_id,
    fileValue: row.file_value,
    uiDraftValue: row.ui_draft_value,
    status: row.status,
    resolvedByUserId: row.resolved_by_user_id ?? undefined,
    resolvedAt: row.resolved_at ? dateTimeToIso(row.resolved_at) : undefined,
    createdAt: dateTimeToIso(row.created_at)
  };
}

function toProjectParameterForUpdate(row: ProjectParameterForUpdateRow): ProjectParameterForUpdate {
  return {
    id: row.id,
    projectId: row.project_id,
    parameterDefinitionId: row.parameter_definition_id,
    name: row.name,
    module: row.module,
    unit: row.unit,
    risk: row.risk,
    currentValue: row.current_value,
    recommendedValue: row.recommended_value,
    valueVersion: Number(row.value_version)
  };
}

function toProjectParameterValueMatch(row: ProjectParameterValueMatchRow): ProjectParameterValueMatch {
  return {
    id: row.id,
    projectId: row.project_id,
    parameterDefinitionId: row.parameter_definition_id,
    name: row.name,
    module: row.module,
    currentValue: row.current_value
  };
}

function toSubmissionItemDto(row: SubmissionItemRow): ParameterSubmissionItemDto {
  return {
    requestId: row.change_request_id,
    parameterId: row.project_parameter_value_id,
    name: row.name,
    module: row.module,
    currentValue: row.current_value,
    targetValue: row.target_value,
    unit: row.unit,
    risk: row.risk,
    reason: row.reason,
    valueKind: resolveParameterValueKind({
      value_kind: row.value_kind ?? null,
      config_format: row.config_format ?? ""
    })
  };
}

function toSubmissionRoundDto(row: SubmissionRoundRow, items: ParameterSubmissionItemDto[] = []): ParameterSubmissionRoundDto {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    submitter: row.submitter,
    createdAt: dateTimeToIso(row.created_at),
    status: row.status,
    summary: row.summary,
    items
  };
}

function workflowAssigneesFromRow(row: {
  workflow_hardware_committer_user_id?: string | null;
  workflow_software_committer_user_id?: string | null;
  workflow_software_user_id?: string | null;
}): ParameterWorkflowAssigneesDto | undefined {
  if (
    !row.workflow_hardware_committer_user_id ||
    !row.workflow_software_committer_user_id ||
    !row.workflow_software_user_id
  ) {
    return undefined;
  }

  return {
    hardwareCommitterId: row.workflow_hardware_committer_user_id,
    softwareCommitterId: row.workflow_software_committer_user_id,
    softwareUserId: row.workflow_software_user_id
  };
}

function waitingHoursSince(value: string | Date) {
  const createdAt = new Date(dateTimeToIso(value)).getTime();
  if (Number.isNaN(createdAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt) / (60 * 60 * 1000)));
}

function buildChangeRequestSummary(row: ChangeRequestRow): string {
  const valueKind = resolveParameterValueKind({
    value_kind: row.value_kind ?? null,
    config_format: row.config_format ?? ""
  });

  if (valueKind === "complex") {
    const lineCount = Math.max(
      row.current_value.split(/\r?\n/).filter((line) => line.trim()).length,
      row.target_value.split(/\r?\n/).filter((line) => line.trim()).length,
      1
    );
    const differenceLabel = row.current_value === row.target_value ? "当前与目标一致" : "当前与目标不同";
    return `${row.title} 为复杂配置（${lineCount} 行），${differenceLabel}。`;
  }

  return `${row.title} 从 ${row.current_value.trim()} 调整为 ${row.target_value.trim()}。`;
}

async function toChangeRequestDto(db: Queryable, row: ChangeRequestRow): Promise<ChangeRequestDto> {
  const createdAt = dateTimeToIso(row.created_at);
  const updatedAt = dateTimeToIso(row.updated_at);
  const summary = buildChangeRequestSummary(row);
  const impact = await buildChangeRequestImpact(db, {
    projectId: row.project_id,
    projectParameterValueId: row.project_parameter_value_id,
    title: row.title,
    module: row.module,
    currentValue: row.current_value,
    targetValue: row.target_value,
    risk: row.risk,
    sourceFileName: row.source_file_name,
    sourceNodePath: row.source_node_path
  });

  return {
    id: row.id,
    submissionRoundId: row.submission_round_id ?? undefined,
    projectId: row.project_id,
    parameterId: row.project_parameter_value_id,
    baseVersion: row.base_version === undefined ? undefined : Number(row.base_version),
    module: row.module,
    title: row.title,
    currentValue: row.current_value,
    targetValue: row.target_value,
    submitter: row.submitter,
    submitterUserId: row.submitter_user_id,
    createdAt,
    createdAtTs: createdAt,
    updatedAt,
    status: row.status,
    aiSummary: summary,
    rejectReason: row.reject_reason ?? undefined,
    waitingHours: waitingHoursSince(row.created_at),
    aiSuggestion: {
      recommendation: row.risk === "High" ? "needs-review" : "advance",
      confidence: row.risk === "Low" ? "high" : "mid",
      summary,
      reasons: [`Risk level: ${row.risk}`, `Module: ${row.module}`],
      similarRequests: []
    },
    impact,
    assignedTo: row.assigned_to_user_id ?? row.assigned_to ?? undefined,
    workflowAssignees: workflowAssigneesFromRow(row),
    fastTrack: row.fast_track,
    reviewerNote: row.reviewer_note ?? undefined,
    valueKind: resolveParameterValueKind({
      value_kind: row.value_kind ?? null,
      config_format: row.config_format ?? ""
    })
  };
}

function toReviewDecisionDto(row: ReviewDecisionRow): ReviewDecisionDto {
  return {
    id: row.id,
    requestId: row.request_id,
    reviewerUserId: row.reviewer_user_id,
    decision: row.decision,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note ?? undefined,
    createdAt: dateTimeToIso(row.created_at)
  };
}

function toChangeRequestMergeResult(row: ChangeRequestMergeRow): ChangeRequestMergeResult {
  return {
    id: row.id,
    projectParameterValueId: row.project_parameter_value_id,
    parameterDefinitionId: row.parameter_definition_id,
    projectId: row.project_id,
    targetValue: row.target_value,
    baseVersion: Number(row.base_version),
    newVersion: Number(row.new_version)
  };
}

function toParameterDefinitionImportCandidate(row: ParameterDefinitionImportRow): ParameterDefinitionImportCandidate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    explanation: row.explanation,
    configFormat: row.config_format,
    module: row.module,
    range: row.default_range,
    unit: row.unit,
    risk: row.risk,
    projectParameterValueId: row.project_parameter_value_id ?? undefined,
    currentValue: row.current_value ?? undefined,
    recommendedValue: row.recommended_value ?? undefined,
    valueVersion: row.value_version === null ? undefined : Number(row.value_version)
  };
}

function toImportBatchDto(row: ImportBatchRow): PersistedImportBatchDto {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceName: row.source_name,
    status: row.status,
    createdAt: dateTimeToIso(row.created_at),
    appliedAt: row.applied_at ? dateTimeToIso(row.applied_at) : undefined,
    summary: row.summary,
    items: row.items
  };
}

function toImportApplyResult(row: ImportApplyResultRow): ImportApplyResult {
  return {
    id: row.id,
    definitionId: row.definition_id,
    projectParameterValueId: row.project_parameter_value_id,
    newVersion: Number(row.new_version)
  };
}

function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}

export async function listProjects(db: Queryable, query: { organizationId: string }) {
  const result = await db.query<ProjectRow>(
    `
    select id, name, code
    from projects
    where organization_id = $1
    order by name asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toProjectDto);
}

export async function getProjectById(db: Queryable, query: { organizationId: string; projectId: string }) {
  const result = await db.query<ProjectRow>(
    `
    select id, name, code
    from projects
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.projectId]
  );

  return result.rows[0] ? toProjectDto(result.rows[0]) : null;
}

export async function listProjectAdminSummaries(db: Queryable, query: { organizationId: string }) {
  const result = await db.query<ProjectRow>(
    `
    select
      p.id,
      p.name,
      p.code,
      p.status,
      p.updated_at,
      coalesce(module_counts.module_count, 0) as module_count,
      coalesce(param_counts.parameter_count, 0) as parameter_count
    from projects p
    left join (
      select project_id, count(*)::int as module_count
      from project_modules
      where organization_id = $1
      group by project_id
    ) module_counts on module_counts.project_id = p.id
    left join (
      select project_id, count(*)::int as parameter_count
      from project_parameter_values
      where organization_id = $1
      group by project_id
    ) param_counts on param_counts.project_id = p.id
    where p.organization_id = $1
    order by p.name asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toProjectAdminSummaryDto);
}

export async function getProjectAdminDetail(
  db: Queryable,
  query: { organizationId: string; projectId: string }
): Promise<ProjectAdminDetailDto | null> {
  const summaries = await listProjectAdminSummaries(db, { organizationId: query.organizationId });
  const summary = summaries.find((item) => item.id === query.projectId);
  if (!summary) {
    return null;
  }

  const modules = await listProjectModules(db, query);
  return { ...summary, modules };
}

export async function createProject(
  db: Queryable,
  input: { organizationId: string; id: string; name: string; code: string; status?: string }
) {
  const result = await db.query<ProjectRow>(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, $3, $4, $5)
    returning id, name, code, status, updated_at
    `,
    [input.id, input.organizationId, input.name, input.code, input.status ?? "initialized"]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create project.");
  }

  return toProjectAdminSummaryDto({ ...row, module_count: 0, parameter_count: 0 });
}

export async function updateProject(
  db: Queryable,
  input: { organizationId: string; projectId: string; name?: string; code?: string; status?: string }
) {
  const assignments: string[] = [];
  const values: unknown[] = [input.organizationId, input.projectId];

  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }
  if (input.code !== undefined) {
    values.push(input.code);
    assignments.push(`code = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }

  if (assignments.length === 0) {
    return getProjectAdminDetail(db, { organizationId: input.organizationId, projectId: input.projectId });
  }

  assignments.push("updated_at = now()");

  const result = await db.query<ProjectRow>(
    `
    update projects
    set ${assignments.join(", ")}
    where organization_id = $1
      and id = $2
    returning id, name, code, status, updated_at
    `,
    values
  );

  if (!result.rows[0]) {
    return null;
  }

  return getProjectAdminDetail(db, { organizationId: input.organizationId, projectId: input.projectId });
}

export async function deleteProject(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<{ deleted: boolean; reason?: "not_found" }> {
  const exists = await db.query<{ id: string }>(
    `
    select id
    from projects
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.projectId]
  );

  if (!exists.rows[0]) {
    return { deleted: false, reason: "not_found" };
  }

  const { organizationId, projectId } = input;

  await db.query(
    `
    delete from parameter_review_decisions
    where organization_id = $1
      and request_id in (
        select id
        from parameter_change_requests
        where organization_id = $1
          and project_id = $2
      )
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_submission_items
    where organization_id = $1
      and (
        change_request_id in (
          select id
          from parameter_change_requests
          where organization_id = $1
            and project_id = $2
        )
        or submission_round_id in (
          select id
          from parameter_submission_rounds
          where organization_id = $1
            and project_id = $2
        )
      )
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_history_entries
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_change_requests
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_drafts
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_submission_rounds
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_import_batches
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from project_parameter_values
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from project_modules
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  const result = await db.query<{ id: string }>(
    `
    delete from projects
    where organization_id = $1
      and id = $2
    returning id
    `,
    [organizationId, projectId]
  );

  return result.rows[0] ? { deleted: true } : { deleted: false, reason: "not_found" };
}

export async function listProjectModules(db: Queryable, query: { organizationId: string; projectId: string }) {
  const result = await db.query<ProjectModuleRow>(
    `
    select id, project_id, name, sort_order, parent_id, path, depth, parameter_module_id
    from project_modules
    where organization_id = $1
      and project_id = $2
    order by sort_order asc, name asc
    `,
    [query.organizationId, query.projectId]
  );

  return result.rows.map(toProjectModuleDto);
}

export async function listParameters(db: Queryable, query: ListParametersQuery) {
  const values: unknown[] = [query.organizationId];
  const where = ["ppv.organization_id = $1", "pd.organization_id = $1"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `ppv.project_id = ${placeholder}`, query.projectId);
  }

  if (query.module) {
    addCondition(where, values, (placeholder) => `pd.module = ${placeholder}`, query.module);
  }

  if (query.moduleId) {
    where.push(
      buildParameterModuleSubtreeFilter(values, query.moduleId, query.includeDescendants !== false)
    );
  }

  if (query.risk) {
    const risks = Array.isArray(query.risk) ? query.risk : [query.risk];
    addCondition(where, values, (placeholder) => `pd.risk = any(${placeholder}::text[])`, risks);
  }

  if (query.q) {
    const term = `%${query.q}%`;
    addCondition(
      where,
      values,
      (placeholder) => `(pd.name ilike ${placeholder} or pd.description ilike ${placeholder} or pd.explanation ilike ${placeholder})`,
      term
    );
  }

  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  values.push(limit);

  const result = await db.query<ParameterRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.value_kind,
      pd.module,
      pd.parameter_module_id,
      (
        select string_agg(pm_seg.name, '/' order by pm_seg.depth)
        from parameter_modules pm_seg
        where pm_seg.organization_id = pd.organization_id
          and pm_seg.id = any(string_to_array(coalesce(pm.path, ''), '/'))
      ) as module_path,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.recommended_value,
      ppv.source_file_name,
      ppv.source_node_path,
      ppv.updated_at
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    left join parameter_modules pm on pm.id = pd.parameter_module_id and pm.organization_id = pd.organization_id
    where ${where.join("\n      and ")}
    order by ppv.updated_at desc, pd.name asc
    limit $${values.length}
    `,
    values
  );

  return result.rows.map((row) => toParameterDto(row));
}

export async function getParameterById(db: Queryable, query: { organizationId: string; parameterId: string }) {
  const result = await db.query<ParameterRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.value_kind,
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.recommended_value,
      ppv.source_file_name,
      ppv.source_node_path,
      ppv.updated_at
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.id = $2
    limit 1
    `,
    [query.organizationId, query.parameterId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const history = await listParameterHistory(db, query);
  return toParameterDto(row, history);
}

export async function listParameterHistory(db: Queryable, query: { organizationId: string; parameterId: string }) {
  const result = await db.query<ParameterHistoryRow>(
    `
    select
      phe.version,
      phe.value,
      phe.changed_at,
      users.name as changed_by,
      phe.request_id
    from parameter_history_entries phe
    inner join project_parameter_values ppv on ppv.id = phe.project_parameter_value_id
    inner join parameter_definitions pd on pd.id = phe.parameter_definition_id
    left join users on users.id = phe.changed_by_user_id
    where phe.organization_id = $1
      and ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.id = $2
    order by phe.changed_at desc
    `,
    [query.organizationId, query.parameterId]
  );

  return result.rows.map(toHistoryDto);
}

export async function listDraftsForUser(
  db: Queryable,
  query: { organizationId: string; userId: string; projectId?: string }
) {
  const values: unknown[] = [query.organizationId, query.userId];
  const where = ["organization_id = $1", "user_id = $2"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `project_id = ${placeholder}`, query.projectId);
  }

  const result = await db.query<DraftRow>(
    `
    select id, project_id, project_parameter_value_id, target_value, reason, updated_at
    from parameter_drafts
    where ${where.join("\n      and ")}
    order by updated_at desc
    `,
    values
  );

  return result.rows.map(toDraftDto);
}

export async function listDraftsForParameterValue(
  db: Queryable,
  query: { projectParameterValueId: string }
) {
  const result = await db.query<DraftRow>(
    `
    select id, user_id, project_id, project_parameter_value_id, target_value, origin, origin_file_version_id, updated_at
    from parameter_drafts
    where project_parameter_value_id = $1
    order by updated_at desc, id asc
    `,
    [query.projectParameterValueId]
  );

  return result.rows.map(toDraftWithOrigin);
}

export async function upsertDraft(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    parameterId: string;
    userId: string;
    targetValue: string;
    reason: string;
    origin?: "manual" | "file_sync";
    originFileVersionId?: string;
  }
) {
  const result = await db.query<DraftRow>(
    `
    insert into parameter_drafts (
      id, organization_id, project_id, project_parameter_value_id, user_id,
      target_value, reason, origin, origin_file_version_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    on conflict (project_id, project_parameter_value_id, user_id)
    do update set
      target_value = excluded.target_value,
      reason = excluded.reason,
      origin = excluded.origin,
      origin_file_version_id = excluded.origin_file_version_id,
      updated_at = now()
    returning id, project_id, project_parameter_value_id, target_value, reason, updated_at
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.parameterId,
      input.userId,
      input.targetValue,
      input.reason,
      input.origin ?? "manual",
      input.originFileVersionId ?? null
    ]
  );

  return toDraftDto(result.rows[0]);
}

export async function upsertFileSyncDraft(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    projectParameterValueId: string;
    userId: string;
    targetValue: string;
    reason: string;
    originFileVersionId: string;
  }
) {
  return upsertDraft(db, {
    id: `${input.projectParameterValueId}-${input.userId}-file-sync`,
    organizationId: input.organizationId,
    projectId: input.projectId,
    parameterId: input.projectParameterValueId,
    userId: input.userId,
    targetValue: input.targetValue,
    reason: input.reason,
    origin: "file_sync",
    originFileVersionId: input.originFileVersionId
  });
}

export async function deleteDraft(
  db: Queryable,
  input: { organizationId: string; userId: string; draftId: string }
) {
  await db.query(
    `
    delete from parameter_drafts
    where organization_id = $1
      and user_id = $2
      and id = $3
    `,
    [input.organizationId, input.userId, input.draftId]
  );
}

export async function deleteDraftForParameter(
  db: Queryable,
  input: { organizationId: string; userId: string; projectId: string; parameterId: string }
) {
  await db.query(
    `
    delete from parameter_drafts
    where organization_id = $1
      and user_id = $2
      and project_id = $3
      and project_parameter_value_id = $4
    `,
    [input.organizationId, input.userId, input.projectId, input.parameterId]
  );
}

export async function hasOpenFileSyncConflict(
  db: Queryable,
  query: { projectParameterValueId: string }
) {
  const result = await db.query<{ id: string }>(
    `
    select id
    from parameter_file_sync_conflicts
    where project_parameter_value_id = $1
      and status = 'open'
    limit 1
    `,
    [query.projectParameterValueId]
  );

  return result.rows.length > 0;
}

export async function insertFileSyncConflict(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    projectParameterValueId: string;
    parameterDefinitionId: string;
    fileVersionId: string;
    fileDraftId: string;
    uiDraftId: string;
    fileValue: string;
    uiDraftValue: string;
  }
) {
  const result = await db.query<FileSyncConflictRow>(
    `
    insert into parameter_file_sync_conflicts (
      id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
      file_version_id, file_draft_id, ui_draft_id, file_value, ui_draft_value, status
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.projectParameterValueId,
      input.parameterDefinitionId,
      input.fileVersionId,
      input.fileDraftId,
      input.uiDraftId,
      input.fileValue,
      input.uiDraftValue
    ]
  );

  return toFileSyncConflictRecord(result.rows[0]);
}

export async function listOpenConflicts(
  db: Queryable,
  query: { organizationId: string; projectParameterValueId?: string; projectId?: string; conflictId?: string }
) {
  const values: unknown[] = [query.organizationId];
  const where = ["organization_id = $1", "status = 'open'"];
  if (query.projectParameterValueId) {
    addCondition(
      where,
      values,
      (placeholder) => `project_parameter_value_id = ${placeholder}`,
      query.projectParameterValueId
    );
  }
  if (query.projectId) {
    addCondition(where, values, (placeholder) => `project_id = ${placeholder}`, query.projectId);
  }
  if (query.conflictId) {
    addCondition(where, values, (placeholder) => `id = ${placeholder}`, query.conflictId);
  }

  const result = await db.query<FileSyncConflictRow>(
    `
    select *
    from parameter_file_sync_conflicts
    where ${where.join("\n      and ")}
    order by created_at desc, id desc
    `,
    values
  );

  return result.rows.map(toFileSyncConflictRecord);
}

export async function resolveConflict(
  db: Queryable,
  input: {
    organizationId: string;
    conflictId: string;
    status: "resolved_file" | "resolved_ui";
    resolvedByUserId: string;
  }
) {
  const result = await db.query<FileSyncConflictRow>(
    `
    update parameter_file_sync_conflicts
    set status = $3,
      resolved_by_user_id = $4,
      resolved_at = now()
    where organization_id = $1
      and id = $2
      and status = 'open'
    returning *
    `,
    [input.organizationId, input.conflictId, input.status, input.resolvedByUserId]
  );

  const row = result.rows[0];
  return row ? toFileSyncConflictRecord(row) : null;
}

export async function createSubmissionRound(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    submitterUserId: string;
    status: ParameterSubmissionRoundStatus;
    summary: string;
  }
) {
  const result = await db.query<SubmissionRoundRow>(
    `
    with inserted as (
      insert into parameter_submission_rounds (
        id, organization_id, project_id, submitter_user_id, status, summary
      )
      values ($1, $2, $3, $4, $5, $6)
      returning id, project_id, submitter_user_id, status, summary, created_at
    )
    select
      inserted.id,
      inserted.project_id,
      projects.name as project_name,
      users.name as submitter,
      inserted.status,
      inserted.summary,
      inserted.created_at
    from inserted
    inner join projects on projects.id = inserted.project_id
    inner join users on users.id = inserted.submitter_user_id
    `,
    [input.id, input.organizationId, input.projectId, input.submitterUserId, input.status, input.summary]
  );

  return toSubmissionRoundDto(result.rows[0]);
}

export async function createChangeRequest(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    submissionRoundId: string;
    projectId: string;
    parameterId: string;
    parameterDefinitionId: string;
    baseVersion: number;
    currentValue: string;
    targetValue: string;
    status: ParameterChangeRequestStatus;
    submitterUserId: string;
    assignedToUserId?: string;
    workflowAssignees?: Partial<ParameterWorkflowAssigneesDto>;
  }
) {
  const result = await db.query<ChangeRequestRow>(
    `
    with inserted as (
      insert into parameter_change_requests (
        id, organization_id, submission_round_id, project_id, project_parameter_value_id,
        parameter_definition_id, base_version, current_value, target_value, status, submitter_user_id,
        assigned_to_user_id, workflow_hardware_committer_user_id, workflow_software_committer_user_id,
        workflow_software_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      returning *
    )
    select
      inserted.id,
      inserted.submission_round_id,
      inserted.project_id,
      inserted.project_parameter_value_id,
      pd.module,
      pd.name as title,
      inserted.current_value,
      inserted.target_value,
      users.name as submitter,
      inserted.status,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      inserted.created_at,
      inserted.updated_at,
      inserted.assigned_to_user_id,
      inserted.workflow_hardware_committer_user_id,
      inserted.workflow_software_committer_user_id,
      inserted.workflow_software_user_id,
      assignee.name as assigned_to,
      inserted.reviewer_note,
      inserted.reject_reason,
      inserted.fast_track,
      ppv.source_file_name,
      ppv.source_node_path
    from inserted
    inner join parameter_definitions pd on pd.id = inserted.parameter_definition_id
    inner join users on users.id = inserted.submitter_user_id
    left join users assignee on assignee.id = inserted.assigned_to_user_id
    left join project_parameter_values ppv on ppv.id = inserted.project_parameter_value_id
    `,
    [
      input.id,
      input.organizationId,
      input.submissionRoundId,
      input.projectId,
      input.parameterId,
      input.parameterDefinitionId,
      input.baseVersion,
      input.currentValue,
      input.targetValue,
      input.status,
      input.submitterUserId,
      input.assignedToUserId ?? null,
      input.workflowAssignees?.hardwareCommitterId ?? null,
      input.workflowAssignees?.softwareCommitterId ?? null,
      input.workflowAssignees?.softwareUserId ?? null
    ]
  );

  return toChangeRequestDto(db, result.rows[0]);
}

export async function hasEligibleWorkflowAssignee(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    userId: string;
    roleId: BackendRoleId | readonly BackendRoleId[];
  }
) {
  const roleIds = Array.isArray(input.roleId) ? input.roleId : [input.roleId];
  const result = await db.query<{ id: string }>(
    `
    select users.id
    from users
    inner join user_role_bindings urb on urb.user_id = users.id
    where users.organization_id = $1
      and users.id = $2
      and users.is_active = true
      and urb.organization_id = $1
      and urb.project_id = $3
      and urb.role_id = any($4::text[])
    limit 1
    `,
    [input.organizationId, input.userId, input.projectId, roleIds]
  );

  return result.rows.length > 0;
}

export async function createSubmissionItem(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    submissionRoundId: string;
    changeRequestId: string;
    parameterId: string;
    currentValue: string;
    targetValue: string;
    reason: string;
  }
) {
  const result = await db.query<SubmissionItemRow>(
    `
    with inserted as (
      insert into parameter_submission_items (
        id, organization_id, submission_round_id, change_request_id, project_parameter_value_id,
        current_value, target_value, reason
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
    )
    select
      inserted.change_request_id,
      inserted.project_parameter_value_id,
      pd.name,
      pd.module,
      inserted.current_value,
      inserted.target_value,
      pd.unit,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      inserted.reason
    from inserted
    inner join project_parameter_values ppv on ppv.id = inserted.project_parameter_value_id
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    `,
    [
      input.id,
      input.organizationId,
      input.submissionRoundId,
      input.changeRequestId,
      input.parameterId,
      input.currentValue,
      input.targetValue,
      input.reason
    ]
  );

  return toSubmissionItemDto(result.rows[0]);
}

export async function listSubmissionRounds(
  db: Queryable,
  query: { organizationId: string; projectId?: string; status?: ParameterSubmissionRoundStatus[] }
) {
  const values: unknown[] = [query.organizationId];
  const where = ["psr.organization_id = $1"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `psr.project_id = ${placeholder}`, query.projectId);
  }

  if (query.status?.length) {
    addCondition(where, values, (placeholder) => `psr.status = any(${placeholder}::text[])`, query.status);
  }

  const result = await db.query<SubmissionRoundRow>(
    `
    select psr.id, psr.project_id, projects.name as project_name, users.name as submitter,
      psr.status, psr.summary, psr.created_at
    from parameter_submission_rounds psr
    inner join projects on projects.id = psr.project_id
    inner join users on users.id = psr.submitter_user_id
    where ${where.join("\n      and ")}
    order by psr.created_at desc
    `,
    values
  );

  const rounds = result.rows.map((row) => toSubmissionRoundDto(row));
  if (rounds.length === 0) return rounds;

  const itemsByRound = await listSubmissionItemsByRoundIds(db, {
    organizationId: query.organizationId,
    roundIds: rounds.map((round) => round.id)
  });
  const assigneesByRound = await listWorkflowAssigneesByRoundIds(db, {
    organizationId: query.organizationId,
    roundIds: rounds.map((round) => round.id)
  });

  return rounds.map((round) => ({
    ...round,
    workflowAssignees: assigneesByRound.get(round.id),
    items: itemsByRound.get(round.id) ?? []
  }));
}

export async function getSubmissionRoundById(
  db: Queryable,
  query: { organizationId: string; roundId: string }
) {
  const result = await db.query<SubmissionRoundRow>(
    `
    select psr.id, psr.project_id, projects.name as project_name, users.name as submitter,
      psr.status, psr.summary, psr.created_at
    from parameter_submission_rounds psr
    inner join projects on projects.id = psr.project_id
    inner join users on users.id = psr.submitter_user_id
    where psr.organization_id = $1
      and psr.id = $2
    `,
    [query.organizationId, query.roundId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const round = toSubmissionRoundDto(row);
  const itemsByRound = await listSubmissionItemsByRoundIds(db, {
    organizationId: query.organizationId,
    roundIds: [round.id]
  });
  const assigneesByRound = await listWorkflowAssigneesByRoundIds(db, {
    organizationId: query.organizationId,
    roundIds: [round.id]
  });

  return {
    ...round,
    workflowAssignees: assigneesByRound.get(round.id),
    items: itemsByRound.get(round.id) ?? []
  };
}

export async function getSubmissionRoundSubmitterUserId(
  db: Queryable,
  query: { organizationId: string; roundId: string }
) {
  const result = await db.query<{ submitter_user_id: string; status: ParameterSubmissionRoundStatus }>(
    `
    select submitter_user_id, status
    from parameter_submission_rounds
    where organization_id = $1
      and id = $2
    `,
    [query.organizationId, query.roundId]
  );

  return result.rows[0] ?? null;
}

export async function withdrawOpenChangeRequestsForRound(
  db: Queryable,
  input: { organizationId: string; roundId: string; note: string }
) {
  await db.query(
    `
    update parameter_change_requests
    set status = 'rejected',
      reject_reason = $3,
      assigned_to_user_id = null,
      updated_at = now()
    where organization_id = $1
      and submission_round_id = $2
      and status not in ('merged', 'rejected', 'withdrawn')
    `,
    [input.organizationId, input.roundId, input.note]
  );
}

export async function updateSubmissionRoundStatus(
  db: Queryable,
  input: {
    organizationId: string;
    roundId: string;
    status: ParameterSubmissionRoundStatus;
    summary?: string;
  }
) {
  await db.query(
    `
    update parameter_submission_rounds
    set status = $3,
      summary = coalesce($4, summary),
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.roundId, input.status, input.summary ?? null]
  );
}

export async function listChangeRequests(
  db: Queryable,
  query: { organizationId: string; projectId?: string; status?: ParameterChangeRequestStatus[]; assignedTo?: string }
) {
  const values: unknown[] = [query.organizationId];
  const where = ["pcr.organization_id = $1"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `pcr.project_id = ${placeholder}`, query.projectId);
  }

  if (query.status?.length) {
    addCondition(where, values, (placeholder) => `pcr.status = any(${placeholder}::text[])`, query.status);
  }

  if (query.assignedTo) {
    addCondition(where, values, (placeholder) => `pcr.assigned_to_user_id = ${placeholder}`, query.assignedTo);
  }

  const result = await db.query<ChangeRequestRow>(
    `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      pcr.project_parameter_value_id,
      pcr.base_version,
      pd.module,
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      users.name as submitter,
      pcr.submitter_user_id,
      pcr.status,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      pcr.created_at,
      pcr.updated_at,
      pcr.assigned_to_user_id,
      pcr.workflow_hardware_committer_user_id,
      pcr.workflow_software_committer_user_id,
      pcr.workflow_software_user_id,
      assignee.name as assigned_to,
      pcr.reviewer_note,
      pcr.reject_reason,
      pcr.fast_track,
      ppv.source_file_name,
      ppv.source_node_path
    from parameter_change_requests pcr
    inner join parameter_definitions pd on pd.id = pcr.parameter_definition_id
    inner join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    left join project_parameter_values ppv on ppv.id = pcr.project_parameter_value_id
    where ${where.join("\n      and ")}
    order by pcr.updated_at desc
    `,
    values
  );

  const items: ChangeRequestDto[] = [];
  for (const row of result.rows) {
    items.push(await toChangeRequestDto(db, row));
  }
  return items;
}

export async function findOpenChangeRequest(
  db: Queryable,
  query: { organizationId: string; projectId: string; parameterId: string }
) {
  const result = await db.query<ChangeRequestRow>(
    `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      pcr.project_parameter_value_id,
      pcr.base_version,
      pd.module,
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      users.name as submitter,
      pcr.submitter_user_id,
      pcr.status,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      pcr.created_at,
      pcr.updated_at,
      pcr.assigned_to_user_id,
      pcr.workflow_hardware_committer_user_id,
      pcr.workflow_software_committer_user_id,
      pcr.workflow_software_user_id,
      assignee.name as assigned_to,
      pcr.reviewer_note,
      pcr.reject_reason,
      pcr.fast_track,
      ppv.source_file_name,
      ppv.source_node_path
    from parameter_change_requests pcr
    inner join parameter_definitions pd on pd.id = pcr.parameter_definition_id
    inner join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    left join project_parameter_values ppv on ppv.id = pcr.project_parameter_value_id
    where pcr.organization_id = $1
      and pcr.project_id = $2
      and pcr.project_parameter_value_id = $3
      and pcr.status not in ('merged', 'rejected', 'withdrawn')
    limit 1
    `,
    [query.organizationId, query.projectId, query.parameterId]
  );

  return result.rows[0] ? toChangeRequestDto(db, result.rows[0]) : null;
}

export async function getChangeRequestById(
  db: Queryable,
  query: { organizationId: string; requestId: string }
) {
  const result = await db.query<ChangeRequestRow>(
    `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      pcr.project_parameter_value_id,
      pcr.parameter_definition_id,
      pcr.base_version,
      pd.module,
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      users.name as submitter,
      pcr.submitter_user_id,
      pcr.status,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      pcr.created_at,
      pcr.updated_at,
      pcr.assigned_to_user_id,
      pcr.workflow_hardware_committer_user_id,
      pcr.workflow_software_committer_user_id,
      pcr.workflow_software_user_id,
      assignee.name as assigned_to,
      pcr.reviewer_note,
      pcr.reject_reason,
      pcr.fast_track,
      ppv.source_file_name,
      ppv.source_node_path
    from parameter_change_requests pcr
    inner join parameter_definitions pd on pd.id = pcr.parameter_definition_id
    inner join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    left join project_parameter_values ppv on ppv.id = pcr.project_parameter_value_id
    where pcr.organization_id = $1
      and pcr.id = $2
    for update of pcr
    `,
    [query.organizationId, query.requestId]
  );

  return result.rows[0] ? toChangeRequestDto(db, result.rows[0]) : null;
}

export async function listReviewDecisions(
  db: Queryable,
  query: { organizationId: string; requestId: string }
) {
  const result = await db.query<ReviewDecisionRow>(
    `
    select id, request_id, reviewer_user_id, decision, from_status, to_status, note, created_at
    from parameter_review_decisions
    where organization_id = $1
      and request_id = $2
    order by created_at asc, id asc
    `,
    [query.organizationId, query.requestId]
  );

  return result.rows.map(toReviewDecisionDto);
}

export async function listReviewDecisionsForRequestIds(
  db: Queryable,
  query: { organizationId: string; requestIds: string[] }
) {
  if (query.requestIds.length === 0) {
    return [] as ReviewDecisionDto[];
  }

  const result = await db.query<ReviewDecisionRow>(
    `
    select id, request_id, reviewer_user_id, decision, from_status, to_status, note, created_at
    from parameter_review_decisions
    where organization_id = $1
      and request_id = any($2::text[])
    order by created_at asc, id asc
    `,
    [query.organizationId, query.requestIds]
  );

  return result.rows.map(toReviewDecisionDto);
}

export async function listChangeRequestWorkflowStateByIds(
  db: Queryable,
  query: { organizationId: string; requestIds: string[] }
) {
  if (query.requestIds.length === 0) {
    return [] as Array<{ id: string; status: ParameterChangeRequestStatus; assignedTo?: string }>;
  }

  const result = await db.query<{
    id: string;
    status: ParameterChangeRequestStatus;
    assigned_to_user_id: string | null;
  }>(
    `
    select id, status, assigned_to_user_id
    from parameter_change_requests
    where organization_id = $1
      and id = any($2::text[])
    `,
    [query.organizationId, query.requestIds]
  );

  return result.rows.map((row) => ({
    id: row.id,
    status: row.status,
    assignedTo: row.assigned_to_user_id ?? undefined
  }));
}

export async function listUserNamesByIds(
  db: Queryable,
  query: { organizationId: string; userIds: string[] }
) {
  if (query.userIds.length === 0) {
    return new Map<string, string>();
  }

  const result = await db.query<{ id: string; name: string }>(
    `
    select id, name
    from users
    where organization_id = $1
      and id = any($2::text[])
    `,
    [query.organizationId, query.userIds]
  );

  return new Map(result.rows.map((row) => [row.id, row.name]));
}

export async function insertReviewDecision(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    requestId: string;
    reviewerUserId: string;
    decision: ParameterReviewDecision;
    fromStatus: ParameterChangeRequestStatus;
    toStatus: ParameterChangeRequestStatus;
    note?: string;
  }
) {
  const result = await db.query<ReviewDecisionRow>(
    `
    insert into parameter_review_decisions (
      id, organization_id, request_id, reviewer_user_id, decision, from_status, to_status, note
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    returning id, request_id, reviewer_user_id, decision, from_status, to_status, note, created_at
    `,
    [
      input.id,
      input.organizationId,
      input.requestId,
      input.reviewerUserId,
      input.decision,
      input.fromStatus,
      input.toStatus,
      input.note ?? null
    ]
  );

  return toReviewDecisionDto(result.rows[0]);
}

export async function updateChangeRequestStatus(
  db: Queryable,
  input: {
    organizationId: string;
    requestId: string;
    status: ParameterChangeRequestStatus;
    note?: string;
  }
) {
  const rejectReason = input.status === "rejected" ? input.note ?? null : null;
  const result = await db.query<ChangeRequestRow>(
    `
    update parameter_change_requests
    set status = $3,
      reviewer_note = $4,
      reject_reason = coalesce($5, reject_reason),
      assigned_to_user_id = case
        when $3 in ('submitted', 'hardware_review') then coalesce(workflow_hardware_committer_user_id, assigned_to_user_id)
        when $3 = 'software_review' then coalesce(workflow_software_committer_user_id, assigned_to_user_id)
        when $3 = 'software_merge' then coalesce(workflow_software_user_id, assigned_to_user_id)
        when $3 in ('merged', 'rejected') then null
        else assigned_to_user_id
      end,
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning
      id,
      submission_round_id,
      project_id,
      project_parameter_value_id,
      parameter_definition_id,
      base_version,
      (select module from parameter_definitions where id = parameter_change_requests.parameter_definition_id) as module,
      (select name from parameter_definitions where id = parameter_change_requests.parameter_definition_id) as title,
      current_value,
      target_value,
      (select name from users where id = parameter_change_requests.submitter_user_id) as submitter,
      status,
      (select risk from parameter_definitions where id = parameter_change_requests.parameter_definition_id) as risk,
      (select value_kind from parameter_definitions where id = parameter_change_requests.parameter_definition_id) as value_kind,
      (select config_format from parameter_definitions where id = parameter_change_requests.parameter_definition_id) as config_format,
      created_at,
      updated_at,
      assigned_to_user_id,
      workflow_hardware_committer_user_id,
      workflow_software_committer_user_id,
      workflow_software_user_id,
      (select name from users where id = parameter_change_requests.assigned_to_user_id) as assigned_to,
      reviewer_note,
      reject_reason,
      fast_track,
      (select source_file_name from project_parameter_values where id = parameter_change_requests.project_parameter_value_id) as source_file_name,
      (select source_node_path from project_parameter_values where id = parameter_change_requests.project_parameter_value_id) as source_node_path
    `,
    [input.organizationId, input.requestId, input.status, input.note ?? null, rejectReason]
  );

  return result.rows[0] ? toChangeRequestDto(db, result.rows[0]) : null;
}

export async function mergeChangeRequest(
  db: Queryable,
  input: {
    historyId: string;
    organizationId: string;
    requestId: string;
    expectedVersion?: number;
    actorUserId: string;
  }
) {
  const result = await db.query<ChangeRequestMergeRow>(
    `
    with request_to_merge as (
      select
        id,
        organization_id,
        project_id,
        project_parameter_value_id,
        parameter_definition_id,
        base_version,
        target_value
      from parameter_change_requests
      where organization_id = $1
        and id = $2
        and status = 'software_merge'
      for update
    ),
    updated_value as (
      update project_parameter_values ppv
      set current_value = request_to_merge.target_value,
        value_version = ppv.value_version + 1,
        updated_by_user_id = $4,
        updated_at = now()
      from request_to_merge
      where ppv.organization_id = $1
        and ppv.id = request_to_merge.project_parameter_value_id
        and ppv.value_version = coalesce($3, request_to_merge.base_version)
      returning
        request_to_merge.id,
        request_to_merge.project_parameter_value_id,
        request_to_merge.parameter_definition_id,
        request_to_merge.project_id,
        request_to_merge.target_value,
        request_to_merge.base_version,
        ppv.value_version as new_version
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
        version, value, changed_by_user_id, request_id
      )
      select
        $5,
        $1,
        project_id,
        parameter_definition_id,
        project_parameter_value_id,
        new_version,
        target_value,
        $4,
        id
      from updated_value
      returning id
    )
    select updated_value.*
    from updated_value
    inner join inserted_history on true
    `,
    [input.organizationId, input.requestId, input.expectedVersion ?? null, input.actorUserId, input.historyId]
  );

  const merged = result.rows[0];
  if (!merged) return null;

  return toChangeRequestMergeResult(merged);
}

export async function updateSubmissionRoundStatusFromRequests(
  db: Queryable,
  input: { organizationId: string; submissionRoundId: string }
) {
  const result = await db.query<{ status: ParameterChangeRequestStatus }>(
    `
    select status
    from parameter_change_requests
    where organization_id = $1
      and submission_round_id = $2
    `,
    [input.organizationId, input.submissionRoundId]
  );
  const status = getMostAdvancedActiveParameterStatus(result.rows.map((row) => row.status));

  await db.query(
    `
    update parameter_submission_rounds
    set status = $3,
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.submissionRoundId, status]
  );

  return status;
}

export async function getProjectParameterForUpdate(
  db: Queryable,
  query: { organizationId: string; projectId: string; parameterId: string }
) {
  const result = await db.query<ProjectParameterForUpdateRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      ppv.parameter_definition_id,
      pd.name,
      pd.module,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.recommended_value,
      ppv.value_version
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.project_id = $2
      and ppv.id = $3
    for update
    `,
    [query.organizationId, query.projectId, query.parameterId]
  );

  return result.rows[0] ? toProjectParameterForUpdate(result.rows[0]) : null;
}

export async function findProjectValueBySource(
  db: Queryable,
  query: {
    organizationId: string;
    projectId: string;
    sourceFileName: string;
    sourceNodePath: string;
  }
) {
  const result = await db.query<ProjectParameterValueMatchRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      ppv.parameter_definition_id,
      pd.name,
      pd.module,
      ppv.current_value
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.project_id = $2
      and ppv.source_file_name = $3
      and ppv.source_node_path = $4
    limit 1
    `,
    [query.organizationId, query.projectId, query.sourceFileName, query.sourceNodePath]
  );

  return result.rows[0] ? toProjectParameterValueMatch(result.rows[0]) : null;
}

export async function findProjectValueByDefinition(
  db: Queryable,
  query: {
    organizationId: string;
    projectId: string;
    name: string;
    module: string;
  }
) {
  const result = await db.query<ProjectParameterValueMatchRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      ppv.parameter_definition_id,
      pd.name,
      pd.module,
      ppv.current_value
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.project_id = $2
      and pd.name = $3
      and pd.module = $4
    limit 1
    `,
    [query.organizationId, query.projectId, query.name, query.module]
  );

  return result.rows[0] ? toProjectParameterValueMatch(result.rows[0]) : null;
}

export async function bindParameterSource(
  db: Queryable,
  input: {
    projectParameterValueId: string;
    sourceFileName: string;
    sourceNodePath: string;
  }
) {
  await db.query(
    `
    update project_parameter_values
    set source_file_name = $2,
      source_node_path = $3,
      updated_at = now()
    where id = $1
    `,
    [input.projectParameterValueId, input.sourceFileName, input.sourceNodePath]
  );
}

export async function listParameterDefinitionsForImport(
  db: Queryable,
  query: { organizationId: string; projectId: string; names: string[]; definitionIds: string[] }
) {
  const result = await db.query<ParameterDefinitionImportRow>(
    `
    select
      pd.id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.value_kind,
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.id as project_parameter_value_id,
      ppv.current_value,
      ppv.recommended_value,
      ppv.value_version
    from parameter_definitions pd
    left join project_parameter_values ppv on ppv.parameter_definition_id = pd.id
      and ppv.organization_id = $1
      and ppv.project_id = $2
    where pd.organization_id = $1
      and (pd.name = any($3::text[]) or pd.id = any($4::text[]))
    order by pd.name asc
    `,
    [query.organizationId, query.projectId, query.names, query.definitionIds]
  );

  return result.rows.map(toParameterDefinitionImportCandidate);
}

export async function insertImportBatch(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    createdByUserId: string;
    sourceName: string;
    summary: ParameterImportSummaryDto;
    items: PersistedImportBatchItem[];
  }
) {
  const result = await db.query<ImportBatchRow>(
    `
    insert into parameter_import_batches (
      id, organization_id, project_id, created_by_user_id, source_name, status, summary, items
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
    returning id, project_id, source_name, status, summary, items, created_at, applied_at
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.createdByUserId,
      input.sourceName,
      "previewed",
      JSON.stringify(input.summary),
      JSON.stringify(input.items)
    ]
  );

  return toImportBatchDto(result.rows[0]);
}

export async function getImportBatchForUpdate(
  db: Queryable,
  query: { organizationId: string; batchId: string }
) {
  const result = await db.query<ImportBatchRow>(
    `
    select id, project_id, source_name, status, summary, items, created_at, applied_at
    from parameter_import_batches
    where organization_id = $1
      and id = $2
    for update
    `,
    [query.organizationId, query.batchId]
  );

  return result.rows[0] ? toImportBatchDto(result.rows[0]) : null;
}

export async function applyAddedImportItem(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    actorUserId: string;
    historyId: string;
    item: PersistedImportBatchItem & { definitionId: string; projectParameterValueId: string };
  }
) {
  const result = await db.query<ImportApplyResultRow>(
    `
    with inserted_definition as (
      insert into parameter_definitions (
        id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
      )
      values ($5, $1, $6, $13, $14, $15, $7, $10, $9, $8)
      on conflict (id) do nothing
      returning id
    ),
    inserted_value as (
      insert into project_parameter_values (
        id, organization_id, project_id, parameter_definition_id, current_value, recommended_value, updated_by_user_id
      )
      select $4, $1, $2, inserted_definition.id, $11, $12, $3
      from inserted_definition
      on conflict (project_id, parameter_definition_id) do update set
        current_value = excluded.current_value,
        recommended_value = excluded.recommended_value,
        value_version = project_parameter_values.value_version + 1,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
      returning id, parameter_definition_id, value_version
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
        version, value, changed_by_user_id, request_id
      )
      select $16, $1, $2, parameter_definition_id, id, value_version, $11, $3, null
      from inserted_value
      returning id
    )
    select $4 as id, parameter_definition_id as definition_id, id as project_parameter_value_id, value_version as new_version
    from inserted_value
    `,
    [
      input.organizationId,
      input.projectId,
      input.actorUserId,
      input.item.projectParameterValueId,
      input.item.definitionId,
      input.item.name,
      input.item.module,
      input.item.risk,
      input.item.unit,
      input.item.range,
      input.item.currentValue ?? input.item.recommendedValue ?? "",
      input.item.recommendedValue ?? input.item.currentValue ?? "",
      input.item.description ?? "",
      input.item.explanation ?? "",
      input.item.configFormat ?? "",
      input.historyId
    ]
  );

  return result.rows[0] ? toImportApplyResult(result.rows[0]) : null;
}

export async function applyUpdatedImportItem(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    actorUserId: string;
    historyId: string;
    item: PersistedImportBatchItem & { definitionId: string; projectParameterValueId: string };
  }
) {
  const result = await db.query<ImportApplyResultRow>(
    `
    with upserted_definition as (
      insert into parameter_definitions (
        id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
      )
      values ($5, $1, $6, $13, $14, $15, $7, $10, $9, $8)
      on conflict (id) do update set
        name = excluded.name,
        description = excluded.description,
        explanation = excluded.explanation,
        config_format = excluded.config_format,
        module = excluded.module,
        default_range = excluded.default_range,
        unit = excluded.unit,
        risk = excluded.risk,
        updated_at = now()
      where parameter_definitions.organization_id = $1
      returning id
    ),
    existing_value as (
      select
        ppv.id,
        ppv.project_id,
        ppv.parameter_definition_id,
        ppv.current_value,
        ppv.recommended_value,
        ppv.value_version
      from project_parameter_values ppv
      inner join upserted_definition on upserted_definition.id = ppv.parameter_definition_id
      where ppv.organization_id = $1
        and ppv.project_id = $2
    ),
    inserted_value as (
      insert into project_parameter_values (
        id, organization_id, project_id, parameter_definition_id, current_value, recommended_value, updated_by_user_id
      )
      select $4, $1, $2, upserted_definition.id, $11, $12, $3
      from upserted_definition
      where not exists (select 1 from existing_value)
      returning id, project_id, parameter_definition_id, current_value, value_version
    ),
    updated_value as (
      update project_parameter_values ppv
      set current_value = $11,
        recommended_value = $12,
        value_version = ppv.value_version + 1,
        updated_by_user_id = $3,
        updated_at = now()
      from upserted_definition
      where ppv.organization_id = $1
        and ppv.project_id = $2
        and ppv.parameter_definition_id = upserted_definition.id
        and (
          ppv.current_value is distinct from $11
          or ppv.recommended_value is distinct from $12
        )
      returning ppv.id, ppv.project_id, ppv.parameter_definition_id, ppv.current_value, ppv.value_version
    ),
    changed_value as (
      select id, project_id, parameter_definition_id, current_value, value_version from inserted_value
      union all
      select id, project_id, parameter_definition_id, current_value, value_version from updated_value
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
        version, value, changed_by_user_id, request_id
      )
      select $16, $1, project_id, parameter_definition_id, id, value_version, current_value, $3, null
      from changed_value
      returning id
    )
    select $4 as id, parameter_definition_id as definition_id, id as project_parameter_value_id, value_version as new_version
    from changed_value
    union all
    select $4 as id, upserted_definition.id as definition_id, existing_value.id as project_parameter_value_id, existing_value.value_version as new_version
    from upserted_definition
    inner join existing_value on existing_value.parameter_definition_id = upserted_definition.id
    where not exists (select 1 from changed_value)
    `,
    [
      input.organizationId,
      input.projectId,
      input.actorUserId,
      input.item.projectParameterValueId,
      input.item.definitionId,
      input.item.name,
      input.item.module,
      input.item.risk,
      input.item.unit,
      input.item.range,
      input.item.currentValue ?? input.item.recommendedValue ?? "",
      input.item.recommendedValue ?? input.item.currentValue ?? "",
      input.item.description ?? "",
      input.item.explanation ?? "",
      input.item.configFormat ?? "",
      input.historyId
    ]
  );

  return result.rows[0] ? toImportApplyResult(result.rows[0]) : null;
}

export async function markImportBatchApplied(
  db: Queryable,
  input: { organizationId: string; batchId: string }
) {
  const result = await db.query<ImportBatchRow>(
    `
    update parameter_import_batches
    set status = 'applied',
      applied_at = now()
    where organization_id = $1
      and id = $2
    returning id, project_id, source_name, status, summary, items, created_at, applied_at
    `,
    [input.organizationId, input.batchId]
  );

  return result.rows[0] ? toImportBatchDto(result.rows[0]) : null;
}

async function listSubmissionItemsByRoundIds(
  db: Queryable,
  query: { organizationId: string; roundIds: string[] }
) {
  const result = await db.query<SubmissionItemRow & { submission_round_id: string }>(
    `
    select
      psi.submission_round_id,
      psi.change_request_id,
      psi.project_parameter_value_id,
      pd.name,
      pd.module,
      psi.current_value,
      psi.target_value,
      pd.unit,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      psi.reason
    from parameter_submission_items psi
    inner join project_parameter_values ppv on ppv.id = psi.project_parameter_value_id
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where psi.organization_id = $1
      and psi.submission_round_id = any($2::text[])
    order by psi.id asc
    `,
    [query.organizationId, query.roundIds]
  );

  const byRound = new Map<string, ParameterSubmissionItemDto[]>();
  for (const row of result.rows) {
    const items = byRound.get(row.submission_round_id) ?? [];
    items.push(toSubmissionItemDto(row));
    byRound.set(row.submission_round_id, items);
  }

  return byRound;
}

async function listWorkflowAssigneesByRoundIds(
  db: Queryable,
  query: { organizationId: string; roundIds: string[] }
) {
  const result = await db.query<WorkflowAssigneesRow>(
    `
    select distinct on (submission_round_id)
      submission_round_id,
      workflow_hardware_committer_user_id,
      workflow_software_committer_user_id,
      workflow_software_user_id
    from parameter_change_requests
    where organization_id = $1
      and submission_round_id = any($2::text[])
      and workflow_hardware_committer_user_id is not null
      and workflow_software_committer_user_id is not null
      and workflow_software_user_id is not null
    order by submission_round_id, created_at asc, id asc
    `,
    [query.organizationId, query.roundIds]
  );

  const byRound = new Map<string, ParameterWorkflowAssigneesDto>();
  for (const row of result.rows) {
    const assignees = workflowAssigneesFromRow(row);
    if (assignees) {
      byRound.set(row.submission_round_id, assignees);
    }
  }

  return byRound;
}
