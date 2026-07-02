import type { ProjectInitializationStatus } from "@/domain/parameters/types";
import type { ProjectAdminSummaryDto } from "@/infrastructure/http/parameterAdminClient";
import type { Project, PrototypeState } from "@/mockData";

export type ParameterAdminProjectRow = {
  id: string;
  name: string;
  code: string;
  status: ProjectInitializationStatus | "initialized";
  statusLabel: string;
  moduleCount: number;
  parameterCount: number;
  updatedAt: string;
  updatedAtLabel: string;
};

const statusLabels: Record<string, string> = {
  initialized: "在研",
  maintenance: "维护",
  initialization_pending_review: "待审阅",
  initialization_rejected: "已驳回",
  initialization_draft: "草稿",
  not_initialized: "未初始化"
};

export const PROJECT_ADMIN_STATUS_LABELS = statusLabels;

/** Lifecycle statuses an admin may switch a live project between. */
export const EDITABLE_PROJECT_STATUSES = ["initialized", "maintenance"] as const;

export type EditableProjectStatus = (typeof EDITABLE_PROJECT_STATUSES)[number];

export function isEditableProjectStatus(status: string): status is EditableProjectStatus {
  return (EDITABLE_PROJECT_STATUSES as readonly string[]).includes(status);
}

function resolveProjectStatus(
  projectId: string,
  initializationStatuses: PrototypeState["projectInitializationStatuses"]
): ProjectInitializationStatus | "initialized" {
  return initializationStatuses[projectId] ?? "initialized";
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function buildParameterAdminProjectsFromState(state: PrototypeState): ParameterAdminProjectRow[] {
  const moduleCountByProject = new Map<string, Set<string>>();
  const parameterCountByProject = new Map<string, number>();

  for (const parameter of state.parameters) {
    parameterCountByProject.set(parameter.projectId, (parameterCountByProject.get(parameter.projectId) ?? 0) + 1);
    const modules = moduleCountByProject.get(parameter.projectId) ?? new Set<string>();
    modules.add(parameter.module);
    moduleCountByProject.set(parameter.projectId, modules);
  }

  return state.configDraft.projects.map((project) => {
    const status = resolveProjectStatus(project.id, state.projectInitializationStatuses);
    const updatedAt = findLatestProjectActivity(state, project.id);
    return {
      id: project.id,
      name: project.name,
      code: project.code,
      status,
      statusLabel: statusLabels[status] ?? status,
      moduleCount: moduleCountByProject.get(project.id)?.size ?? 0,
      parameterCount: parameterCountByProject.get(project.id) ?? 0,
      updatedAt,
      updatedAtLabel: formatUpdatedAt(updatedAt)
    };
  });
}

export function mapProjectAdminSummaryDto(item: ProjectAdminSummaryDto): ParameterAdminProjectRow {
  return {
    id: item.id,
    name: item.name,
    code: item.code,
    status: (item.status as ParameterAdminProjectRow["status"]) ?? "initialized",
    statusLabel: statusLabels[item.status] ?? item.status,
    moduleCount: item.moduleCount,
    parameterCount: item.parameterCount,
    updatedAt: item.updatedAt,
    updatedAtLabel: formatUpdatedAt(item.updatedAt)
  };
}

function findLatestProjectActivity(state: PrototypeState, projectId: string) {
  return (
    state.parameters
      .filter((parameter) => parameter.projectId === projectId)
      .map((parameter) => parameter.updatedAtTs)
      .sort()
      .at(-1) ?? new Date(0).toISOString()
  );
}

export function summarizeParameterAdminProjects(rows: ParameterAdminProjectRow[]) {
  return {
    total: rows.length,
    initialized: rows.filter((row) => row.status === "initialized").length,
    pendingReview: rows.filter((row) => row.status === "initialization_pending_review").length,
    moduleTotal: rows.reduce((sum, row) => sum + row.moduleCount, 0)
  };
}

export function findProjectById(projects: readonly Project[], projectId: string) {
  return projects.find((project) => project.id === projectId) ?? null;
}
