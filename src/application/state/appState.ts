import type {
  HydrateDebugRuntimeAction,
  SetDebugActiveSessionAction,
  UpsertDebugNodeOperationAction,
  UpsertDebugSnapshotAction
} from "@/application/debugging/debuggingRuntime";
import type { HydrateLogRuntimeAction } from "@/application/logs/logRuntime";
import type { HydrateParameterRuntimeAction } from "@/application/parameters/parameterRuntime";
import type { LogJobSnapshot } from "@/application/ports/LogAnalysisRepository";
import { derivePowerManagementRuntimeState } from "@/application/state/derivePowerManagementRuntimeState";
import { canPerform } from "@/app/permissions";
import { buildDraftSubmissionRounds } from "@/domain/parameters/buildDraftSubmissionRounds";
import { submitParameterRound } from "@/domain/parameters/commands";
import {
  applyInitializationDraftToConfig,
  buildInitializationDraft,
  canSubmitInitializationDraft,
  resolveInitializationConfig
} from "@/domain/parameters/initialization";
import { requestStatusToBackend } from "@/domain/parameters/submissionWorkflowTrail";
import type {
  ProjectInitializationStatus,
  ProjectParameterInitializationDraft,
  ProjectParameterInitializationReview,
  RiskLevel
} from "@/domain/parameters/types";
import type {
  AuditEvent,
  ChangeRequest,
  DebugParameter,
  DebugSnapshot,
  LogRecord,
  LogStageId,
  ParameterRecord,
  ParameterSubmissionItem,
  ParameterSubmissionRound,
  PrototypeState,
  RequestStatus,
  TimeWindow,
  User
} from "@/domain/prototype/types";
import {
  migrateLegacyRoleId,
  platformRoles,
  roleCanBeAssignedToWorkflowSlot,
  roleSupportsWorkflowSlot,
  type PlatformRoleId
} from "@/domain/users/types";
import { prependMockNotificationMessage } from "@/infrastructure/mock/mockNotificationsGateway";
import { buildAuditEvent } from "@/parameterAdminAnalytics";
import { buildParameterLibraryFromRecords, buildParameterModulesFromRecords } from "@/parameterAdminLibrary";
import {
  addDebugParameter,
  addDebugParameterFromDraft,
  addParameterModule,
  clonePowerManagementConfig,
  deleteAdminProject,
  deleteDebugParameter,
  deleteParameterModule,
  syncConfigDraftDebugParameterModuleMetadata,
  updateDebugParameter,
  updateParameterModule
} from "@/powerManagementConfig";
import { buildAISuggestion, buildImpactItems, REVIEW_MOCK_NOW } from "@/reviewMockData";

type DebugParameterEditorDraft = {
  name: string;
  key: string;
  description: string;
  detailedDescription?: string;
  writeFormatExample?: string;
  writeFormatHint?: string;
  module: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  range: string;
  risk: DebugParameter["risk"];
  status: DebugParameter["status"];
  nodePath: string;
  accessMode: DebugParameter["accessMode"];
};

type ParameterDraftItem = {
  parameterId: string;
  targetValue: string;
  reason: string;
};

/** API-mode data domains refreshed by refreshApiRuntimeData. */
export type ApiRuntimeDataDomain = "parameters" | "logs" | "debugging";

export type AppAction =
  | { type: "SET_PROJECT"; projectId: string }
  | { type: "UPDATE_PROJECT"; projectId: string; patch: { name?: string; code?: string; status?: ProjectInitializationStatus } }
  | { type: "ADD_PARAMETER_ADMIN_PROJECT"; project: { id: string; name: string; code: string } }
  | { type: "DELETE_PARAMETER_ADMIN_PROJECT"; projectId: string }
  | {
      type: "HYDRATE_AUTH_CONTEXT";
      user: User;
      roleId: string;
    }
  | HydrateParameterRuntimeAction
  | HydrateLogRuntimeAction
  | {
      type: "SUBMIT_PARAMETER_INITIALIZATION";
      draft: {
        projectName: string;
        projectCode: string;
        ownerUserId: string;
        sourceProjectIds: string[];
        primarySourceProjectId: string;
        supplementSourceProjectIds: string[];
        selectedModules: string[];
        selectedRisks: RiskLevel[];
        selectedParameterIds: string[];
        notes: string;
      };
    }
  | { type: "APPROVE_PARAMETER_INITIALIZATION"; reviewId: string }
  | { type: "REJECT_PARAMETER_INITIALIZATION"; reviewId: string; reason: string }
  | {
      type: "HYDRATE_PROJECT_INITIALIZATION_STATUS";
      projectId: string;
      status: ProjectInitializationStatus;
    }
  | {
      type: "HYDRATE_PARAMETER_INITIALIZATION";
      drafts?: ProjectParameterInitializationDraft[];
      reviews?: ProjectParameterInitializationReview[];
      statuses?: Record<string, ProjectInitializationStatus>;
    }
  | { type: "ADD_CHANGE_REQUEST"; parameterId: string; targetValue: string; reason: string }
  | {
      type: "ADD_PARAMETER_SUBMISSION_ROUND";
      items: ParameterDraftItem[];
      reason?: string;
      assignees?: {
        hardwareCommitterId: string;
        softwareCommitterId: string;
        softwareUserId: string;
      };
    }
  | { type: "STASH_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[] }
  | { type: "DISCARD_STASHED_PARAMETER_DRAFTS"; projectId: string; parameterIds: string[] }
  | { type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND"; roundId: string }
  | { type: "ADVANCE_REVIEW"; requestId: string; fastTrack?: boolean; note?: string }
  | { type: "REJECT_REVIEW"; requestId: string; reason: string; fastTrack?: boolean }
  | { type: "TRANSFER_REVIEW"; requestId: string; to: string; note?: string }
  | { type: "UNDO_REVIEW_ACTION"; requestId: string; previousStatus: RequestStatus }
  | { type: "ADVANCE_LOG"; logId: string }
  | { type: "SIMULATE_LOG_UPLOAD"; fileName: string; supported: boolean; question?: string }
  | { type: "UPSERT_LOG_RECORD"; log: LogRecord }
  | { type: "LOG_JOB_PROGRESS"; job: LogJobSnapshot }
  | { type: "CONNECT_DEVICE"; deviceId: string }
  | { type: "PUSH_DEBUG_VALUE"; parameterId: string }
  | { type: "PUSH_DEBUG_VALUES"; parameterIds: string[] }
  | { type: "ROLLBACK_LAST_SNAPSHOT" }
  | { type: "ROLLBACK_UNDO_PUSH" }
  | HydrateDebugRuntimeAction
  | SetDebugActiveSessionAction
  | UpsertDebugNodeOperationAction
  | UpsertDebugSnapshotAction
  | { type: "CLEAR_PUSHED_DEBUG_IDS"; parameterIds: string[] }
  | { type: "CLEAR_API_RUNTIME_DOMAIN"; domain: ApiRuntimeDataDomain }
  | { type: "ADD_NOTIFICATION"; message: string }
  | { type: "DISMISS_NOTIFICATION" }
  | { type: "SET_NOTIFICATION_INBOX"; items: import("@/domain/notifications/types").NotificationItem[] }
  | { type: "UPDATE_DEBUG_PARAMETER"; parameterId: string; patch: Partial<DebugParameterEditorDraft> }
  | { type: "COMMIT_DEBUG_PARAMETER_DRAFT"; parameterId: string; draft: DebugParameterEditorDraft }
  | { type: "DISCARD_ALL_DEBUG_DIRTY" }
  | { type: "ADD_PARAMETER_MODULE"; module: import("@/powerManagementConfig").ParameterModuleDraft }
  | { type: "UPDATE_PARAMETER_MODULE"; moduleName: string; patch: import("@/powerManagementConfig").ParameterModuleDraft }
  | { type: "DELETE_PARAMETER_MODULE"; moduleName: string }
  | { type: "ADD_DEBUG_PARAMETER"; initialDraft?: DebugParameterEditorDraft }
  | { type: "DELETE_DEBUG_PARAMETER"; parameterId: string }
  | { type: "ASSIGN_USER_ROLE"; userId: string; roleId: PlatformRoleId }
  | { type: "TOGGLE_USER_ACTIVE"; userId: string; isActive: boolean }
  | { type: "ADD_USER"; id?: string; name: string; username: string; title: string; roleId: PlatformRoleId }
  | { type: "HYDRATE_USERS"; users: User[] }
  | { type: "MARK_CONFIG_PERSISTED" }
  | { type: "LOG_ADMIN_REANALYZE_LOG"; logId: string }
  | { type: "LOG_ADMIN_ARCHIVE_LOG"; logId: string }
  | { type: "LOG_ADMIN_UNARCHIVE_LOG"; logId: string }
  | { type: "LOG_ADMIN_SYNC_LOGS" }
  | { type: "LOG_ADMIN_EXPORT_REPORT"; timeWindow: TimeWindow }
  | { type: "PUSH_NOTIFICATION"; message: string };

function updateArchivedLogIdsForLog(archivedLogIds: string[], log: LogRecord): string[] {
  if (log.archiveState === "archived") {
    return archivedLogIds.includes(log.id) ? archivedLogIds : [...archivedLogIds, log.id];
  }

  if (log.archiveState === "active") {
    return archivedLogIds.filter((id) => id !== log.id);
  }

  return archivedLogIds;
}

function archivedLogIdsFromHydratedLogs(archivedLogIds: string[], logs: LogRecord[]): string[] {
  const hydratedIds = new Set(logs.map((log) => log.id));
  const next = archivedLogIds.filter((id) => !hydratedIds.has(id));

  for (const log of logs) {
    if (log.archiveState === "archived" && !next.includes(log.id)) {
      next.push(log.id);
    }
  }

  return next;
}

function buildRuntimeReviewFields(summary: string, module: string) {
  const suggestion = buildAISuggestion({
    recommendation: "needs-review",
    confidence: "mid",
    summary,
    reasons: ["运行时提交需要管理员复核", "AI 尚未拿到完整审阅证据", "建议结合参数历史与影响范围确认"],
    similarRequests: []
  });

  return {
    createdAtTs: REVIEW_MOCK_NOW,
    updatedAt: REVIEW_MOCK_NOW,
    waitingHours: 0,
    aiSummary: suggestion.summary,
    aiSuggestion: suggestion,
    impact: buildImpactItems(module)
  };
}

export function activeRoleLabel(activeRoleId: string) {
  return platformRoles.find((role) => role.id === activeRoleId)?.name ?? "平台用户";
}

function addAuditEvent(
  state: PrototypeState,
  event: Omit<AuditEvent, "id" | "actor" | "time" | "kind"> & { actor?: string; kind?: AuditEvent["kind"] }
): AuditEvent[] {
  return [
    ...state.auditEvents,
    {
      id: `audit-log-admin-${state.auditEvents.length + 1}`,
      kind: event.kind ?? "agent-action",
      actor: event.actor ?? activeRoleLabel(state.activeRoleId),
      time: "刚刚",
      ...event
    }
  ];
}

function canManageUsers(state: PrototypeState) {
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  if (!currentUser?.isActive) {
    return false;
  }
  return canPerform(migrateLegacyRoleId(currentUser.roleId), "users.manage");
}

function getNextReviewStep(request: ChangeRequest): Pick<ChangeRequest, "status" | "assignedTo"> {
  switch (request.status) {
    case "硬件Committer检视":
    case "待审阅":
      return {
        status: "软件Committer检视",
        assignedTo: request.workflowAssignees?.softwareCommitterId ?? request.assignedTo
      };
    case "软件Committer检视":
    case "自动检查通过":
      return {
        status: "软件User合入",
        assignedTo: request.workflowAssignees?.softwareUserId ?? request.assignedTo
      };
    default:
      return {
        status: "已合入",
        assignedTo: request.assignedTo
      };
  }
}

function updateRoundStatusAfterRequest(
  rounds: ParameterSubmissionRound[],
  request: ChangeRequest,
  status: RequestStatus
) {
  if (!request.submissionRoundId) {
    return rounds;
  }

  return rounds.map((round) => (round.id === request.submissionRoundId ? { ...round, status } : round));
}

function canAdvanceReviewRequest(activeRoleId: string, request: ChangeRequest) {
  if (request.status === "软件User合入") {
    return roleSupportsWorkflowSlot(activeRoleId, "softwareUser");
  }

  return canPerform(activeRoleId, "parameter.review");
}

function isAdminCapabilityRole(roleId: PlatformRoleId) {
  return roleId === "admin" || roleId === "platform-admin";
}

function wouldHaveActiveAdmin(_state: PrototypeState, nextUsers: User[]) {
  return nextUsers.some((user) => user.isActive && isAdminCapabilityRole(migrateLegacyRoleId(user.roleId)));
}

export function isEditableProjectLifecycleStatus(status: ProjectInitializationStatus) {
  return status === "initialized" || status === "maintenance";
}

function canSubmitParameterChangesForProject(state: PrototypeState, projectId: string) {
  return isEditableProjectLifecycleStatus(state.projectInitializationStatuses[projectId] ?? "initialized");
}

export function reducer(state: PrototypeState, action: AppAction): PrototypeState {
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const auditActor = currentUser?.name ?? "system";
  const activeRoleId = migrateLegacyRoleId(state.activeRoleId);

  switch (action.type) {
    case "SET_PROJECT":
      return { ...state, activeProjectId: action.projectId };
    case "UPDATE_PROJECT": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const configDraft = {
        ...state.configDraft,
        projects: state.configDraft.projects.map((project) =>
          project.id === action.projectId
            ? {
                ...project,
                ...(action.patch.name !== undefined ? { name: action.patch.name } : {}),
                ...(action.patch.code !== undefined ? { code: action.patch.code } : {})
              }
            : project
        )
      };
      const projectInitializationStatuses =
        action.patch.status !== undefined
          ? { ...state.projectInitializationStatuses, [action.projectId]: action.patch.status }
          : state.projectInitializationStatuses;
      return {
        ...state,
        configDraft,
        projectInitializationStatuses,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "ADD_PARAMETER_ADMIN_PROJECT": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      if (state.configDraft.projects.some((project) => project.id === action.project.id)) {
        return state;
      }
      const configDraft = {
        ...state.configDraft,
        projects: [...state.configDraft.projects, action.project]
      };
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "DELETE_PARAMETER_ADMIN_PROJECT": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const projectExists = state.configDraft.projects.some((project) => project.id === action.projectId);
      if (!projectExists) {
        return state;
      }

      const configDraft = deleteAdminProject(state.configDraft, action.projectId);
      const nextActiveProjectId =
        state.activeProjectId === action.projectId
          ? configDraft.projects[0]?.id ?? state.activeProjectId
          : state.activeProjectId;
      const { [action.projectId]: _removedStatus, ...projectInitializationStatuses } = state.projectInitializationStatuses;

      return {
        ...state,
        activeProjectId: nextActiveProjectId,
        configDraft,
        projectInitializationStatuses,
        parameterInitializationDrafts: state.parameterInitializationDrafts.filter(
          (draft) => draft.projectId !== action.projectId
        ),
        parameterInitializationReviews: state.parameterInitializationReviews.filter((review) => {
          const draft = state.parameterInitializationDrafts.find((item) => item.id === review.draftId);
          return draft?.projectId !== action.projectId;
        }),
        changeRequests: state.changeRequests.filter((request) => request.projectId !== action.projectId),
        parameterSubmissionRounds: state.parameterSubmissionRounds.filter((round) => round.projectId !== action.projectId),
        parameterDrafts: state.parameterDrafts.filter((draft) => draft.projectId !== action.projectId),
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "HYDRATE_AUTH_CONTEXT": {
      const existingUsers = state.users.filter((user) => user.id !== action.user.id);
      const isDifferentUser = action.user.id !== state.currentUserId;
      return {
        ...state,
        users: [action.user, ...existingUsers],
        currentUserId: action.user.id,
        activeRoleId: action.roleId,
        parameterDrafts: isDifferentUser ? [] : state.parameterDrafts,
        parameterSubmissionRounds: isDifferentUser
          ? state.parameterSubmissionRounds.filter((round) => round.status !== "已暂存")
          : state.parameterSubmissionRounds
      };
    }
    case "HYDRATE_USERS": {
      const nextUsers = action.users.some((user) => user.id === state.currentUserId)
        ? action.users
        : state.users.filter((user) => user.id === state.currentUserId).concat(action.users);

      return {
        ...state,
        users: nextUsers
      };
    }
    case "HYDRATE_PARAMETER_RUNTIME": {
      const draftSubmissionRounds = buildDraftSubmissionRounds(
        action.parameterDrafts,
        action.parameters,
        action.projects,
        currentUser?.name ?? "API draft"
      );
      const projects = action.projects.map((project) => ({ ...project }));
      const parameterLibrary = buildParameterLibraryFromRecords(action.parameters, projects);
      const parameterModules = buildParameterModulesFromRecords(action.parameters, state.configDraft.parameterModules);
      // Keep the active project pointed at real server data, never at a stale demo id.
      const activeProjectId =
        projects.length > 0 && !projects.some((project) => project.id === state.activeProjectId)
          ? projects[0].id
          : state.activeProjectId;
      return {
        ...state,
        activeProjectId,
        parameters: action.parameters,
        changeRequests: action.changeRequests,
        parameterDrafts: action.parameterDrafts ?? [],
        parameterSubmissionRounds: [...draftSubmissionRounds, ...action.parameterSubmissionRounds],
        parameterReviewDecisions: [],
        configDraft: {
          ...state.configDraft,
          projects,
          parameterLibrary,
          parameterModules
        }
      };
    }
    case "CLEAR_API_RUNTIME_DOMAIN": {
      // API refresh failed: purge the domain's business data instead of showing
      // demo records as if they were live (mock data must never look real).
      if (action.domain === "parameters") {
        return {
          ...state,
          parameters: [],
          changeRequests: [],
          parameterDrafts: [],
          parameterSubmissionRounds: [],
          parameterReviewDecisions: [],
          configDraft: {
            ...state.configDraft,
            projects: [],
            parameterLibrary: [],
            parameterModules: []
          }
        };
      }
      if (action.domain === "logs") {
        return {
          ...state,
          logs: [],
          archivedLogIds: []
        };
      }
      return {
        ...state,
        devices: [],
        debugParameters: [],
        configDraft: {
          ...state.configDraft,
          debugParameters: []
        }
      };
    }
    case "SUBMIT_PARAMETER_INITIALIZATION": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const projectCode = action.draft.projectCode.trim().toUpperCase();
      const projectId = action.draft.projectCode
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const hasActiveInitialization =
        state.parameterInitializationReviews.some(
          (review) => review.projectId === projectId && review.status === "pending"
        ) ||
        state.parameterInitializationReviews.some(
          (review) => review.projectId === projectId && review.status === "approved"
        ) ||
        state.projectInitializationStatuses[projectId] === "initialized" ||
        state.configDraft.projects.some(
          (project) =>
            project.id === projectId || project.code.trim().toUpperCase() === projectCode
        );
      const duplicateProjectId = hasActiveInitialization;
      if (!projectId || duplicateProjectId) {
        return state;
      }
      const now = new Date().toISOString();
      const draft = buildInitializationDraft(resolveInitializationConfig(state.configDraft, state.parameters), {
        ...action.draft,
        selectedModules: [],
        selectedRisks: [],
        id: `init-${state.parameterInitializationDrafts.length + 1}`,
        projectId,
        projectName: action.draft.projectName.trim(),
        projectCode,
        ownerUserId: action.draft.ownerUserId,
        createdBy: state.currentUserId,
        now
      });
      const validation = canSubmitInitializationDraft(draft);
      if (!validation.ok) {
        return state;
      }
      const review = {
        id: `PIR-${2401 + state.parameterInitializationReviews.length}`,
        draftId: draft.id,
        projectId: draft.projectId,
        status: "pending" as const,
        submittedBy: state.currentUserId,
        submittedAt: now
      };

      return {
        ...state,
        parameterInitializationDrafts: [draft, ...state.parameterInitializationDrafts],
        parameterInitializationReviews: [review, ...state.parameterInitializationReviews],
        projectInitializationStatuses: {
          ...state.projectInitializationStatuses,
          [draft.projectId]: "initialization_pending_review"
        },
        notifications: [`${draft.projectName} 参数初始化已提交审阅。`, ...state.notifications]
      };
    }
    case "APPROVE_PARAMETER_INITIALIZATION": {
      if (!canPerform(activeRoleId, "parameter.review")) return state;
      const review = state.parameterInitializationReviews.find((item) => item.id === action.reviewId);
      if (!review || review.status !== "pending") {
        return state;
      }
      const draft = state.parameterInitializationDrafts.find((item) => item.id === review.draftId);
      if (!draft) {
        return state;
      }
      const now = new Date().toISOString();
      const configDraft = applyInitializationDraftToConfig(state.configDraft, draft);

      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft),
        parameterInitializationReviews: state.parameterInitializationReviews.map((item) =>
          item.id === review.id
            ? { ...item, status: "approved", reviewedBy: state.currentUserId, reviewedAt: now }
            : item
        ),
        projectInitializationStatuses: {
          ...state.projectInitializationStatuses,
          [draft.projectId]: "initialized"
        },
        notifications: [`${draft.projectName} 参数初始化已通过。`, ...state.notifications]
      };
    }
    case "REJECT_PARAMETER_INITIALIZATION": {
      if (!canPerform(activeRoleId, "parameter.review")) return state;
      const reason = action.reason.trim();
      if (!reason) {
        return state;
      }
      const review = state.parameterInitializationReviews.find((item) => item.id === action.reviewId);
      if (!review || review.status !== "pending") {
        return state;
      }
      const now = new Date().toISOString();

      return {
        ...state,
        parameterInitializationReviews: state.parameterInitializationReviews.map((item) =>
          item.id === review.id
            ? {
                ...item,
                status: "rejected",
                reviewedBy: state.currentUserId,
                reviewedAt: now,
                rejectionReason: reason
              }
            : item
        ),
        projectInitializationStatuses: {
          ...state.projectInitializationStatuses,
          [review.projectId]: "initialization_rejected"
        },
        notifications: [`参数初始化已驳回：${reason}`, ...state.notifications]
      };
    }
    case "HYDRATE_PROJECT_INITIALIZATION_STATUS": {
      return {
        ...state,
        projectInitializationStatuses: {
          ...state.projectInitializationStatuses,
          [action.projectId]: action.status
        }
      };
    }
    case "HYDRATE_PARAMETER_INITIALIZATION": {
      return {
        ...state,
        ...(action.drafts ? { parameterInitializationDrafts: action.drafts } : {}),
        ...(action.reviews ? { parameterInitializationReviews: action.reviews } : {}),
        ...(action.statuses
          ? {
              projectInitializationStatuses: {
                ...state.projectInitializationStatuses,
                ...action.statuses
              }
            }
          : {})
      };
    }
    case "ADD_CHANGE_REQUEST": {
      if (!canPerform(activeRoleId, "parameter.edit")) return state;
      const parameter = state.parameters.find((item) => item.id === action.parameterId);
      if (!parameter) {
        return state;
      }
      if (!canSubmitParameterChangesForProject(state, parameter.projectId)) {
        return state;
      }
      const project = state.configDraft.projects.find((item) => item.id === parameter.projectId);
      const submitter = state.users.find((user) => user.id === state.currentUserId)?.name ?? activeRoleLabel(state.activeRoleId);
      const roundId = `PRS-${2406 + state.parameterSubmissionRounds.length}`;
      const summary = action.reason || "小泽已生成影响摘要，建议参数管理员审阅后推进。";
      const workflowAssignees = {
        hardwareCommitterId: state.users.find((user) => user.isActive && roleCanBeAssignedToWorkflowSlot(user.roleId, "hardwareCommitter"))?.id ?? "",
        softwareCommitterId: state.users.find((user) => user.isActive && roleCanBeAssignedToWorkflowSlot(user.roleId, "softwareCommitter"))?.id ?? "",
        softwareUserId: state.users.find((user) => user.isActive && roleCanBeAssignedToWorkflowSlot(user.roleId, "softwareUser"))?.id ?? ""
      };

      const request: ChangeRequest = {
        id: `PRQ-${8910 + state.changeRequests.length}`,
        submissionRoundId: roundId,
        projectId: parameter.projectId,
        parameterId: parameter.id,
        module: parameter.module,
        title: parameter.name,
        currentValue: parameter.currentValue,
        targetValue: action.targetValue,
        submitter,
        valueKind: parameter.valueKind,
        createdAt: "刚刚",
        status: "硬件Committer检视",
        assignedTo: workflowAssignees.hardwareCommitterId,
        workflowAssignees,
        ...buildRuntimeReviewFields(summary, parameter.module)
      };
      const submissionItem: ParameterSubmissionItem = {
        requestId: request.id,
        parameterId: parameter.id,
        name: parameter.name,
        module: parameter.module,
        currentValue: parameter.currentValue,
        targetValue: action.targetValue,
        unit: parameter.unit,
        risk: parameter.risk,
        valueKind: parameter.valueKind,
        reason: summary
      };

      return {
        ...state,
        changeRequests: [request, ...state.changeRequests],
        parameterSubmissionRounds: [
          {
            id: roundId,
            projectId: parameter.projectId,
            projectName: project?.name ?? parameter.projectId,
            submitter,
            createdAt: "刚刚",
            status: "硬件Committer检视",
            summary: `${parameter.name} 提交审阅。`,
            workflowAssignees,
            items: [submissionItem]
          },
          ...state.parameterSubmissionRounds
        ],
        notifications: [`已提交 ${parameter.name}，等待参数管理员审阅`, ...state.notifications]
      };
    }
    case "ADD_PARAMETER_SUBMISSION_ROUND": {
      if (!canPerform(activeRoleId, "parameter.edit")) return state;
      const targetProjectIds = new Set(
        action.items
          .map((item) => state.parameters.find((parameter) => parameter.id === item.parameterId)?.projectId)
          .filter((projectId): projectId is string => Boolean(projectId))
      );
      if (targetProjectIds.size !== 1 || Array.from(targetProjectIds).some((projectId) => !canSubmitParameterChangesForProject(state, projectId))) {
        return state;
      }
      return submitParameterRound(state, {
        items: action.items,
        reason: action.reason,
        assignees: action.assignees,
        projects: state.configDraft.projects,
        roles: [
          {
            id: state.activeRoleId,
            name: state.users.find((user) => user.id === state.currentUserId)?.name ?? activeRoleLabel(state.activeRoleId)
          },
          ...platformRoles.filter((role) => role.id !== state.activeRoleId)
        ],
        buildRuntimeReviewFields
      });
    }
    case "STASH_PARAMETER_SUBMISSION_ROUND": {
      if (!canPerform(activeRoleId, "parameter.edit")) return state;
      const draftItems = action.items
        .map((item) => {
          const parameter = state.parameters.find((candidate) => candidate.id === item.parameterId);
          return parameter ? { parameter, item } : null;
        })
        .filter((item): item is { parameter: ParameterRecord; item: ParameterDraftItem } => Boolean(item));

      if (draftItems.length === 0) {
        return state;
      }
      const targetProjectIds = new Set(draftItems.map(({ parameter }) => parameter.projectId));
      if (targetProjectIds.size !== 1 || Array.from(targetProjectIds).some((projectId) => !canSubmitParameterChangesForProject(state, projectId))) {
        return state;
      }

      const project = state.configDraft.projects.find((item) => item.id === draftItems[0].parameter.projectId);
      const submitter = state.users.find((user) => user.id === state.currentUserId)?.name ?? activeRoleLabel(state.activeRoleId);
      const roundId = `PRS-${2406 + state.parameterSubmissionRounds.length}`;
      const submissionItems = draftItems.map(({ parameter, item }): ParameterSubmissionItem => ({
        requestId: "",
        parameterId: parameter.id,
        name: parameter.name,
        module: parameter.module,
        currentValue: parameter.currentValue,
        targetValue: item.targetValue,
        unit: parameter.unit,
        risk: parameter.risk,
        valueKind: parameter.valueKind,
        reason: item.reason || ""
      }));

      return {
        ...state,
        parameterSubmissionRounds: [
          {
            id: roundId,
            projectId: draftItems[0].parameter.projectId,
            projectName: project?.name ?? draftItems[0].parameter.projectId,
            submitter,
            createdAt: "刚刚",
            status: "已暂存",
            summary: `本轮暂存包含 ${submissionItems.length} 个参数修改。`,
            items: submissionItems
          },
          ...state.parameterSubmissionRounds
        ],
        notifications: [`已暂存本轮，包含 ${submissionItems.length} 个参数修改`, ...state.notifications]
      };
    }
    case "DISCARD_STASHED_PARAMETER_DRAFTS": {
      if (!canPerform(activeRoleId, "parameter.edit")) return state;
      const parameterIds = new Set(action.parameterIds);
      if (parameterIds.size === 0) {
        return state;
      }

      return {
        ...state,
        parameterDrafts: state.parameterDrafts.filter(
          (draft) => !(draft.projectId === action.projectId && parameterIds.has(draft.parameterId))
        ),
        parameterSubmissionRounds: state.parameterSubmissionRounds.flatMap((round) => {
          if (round.status !== "已暂存" || round.projectId !== action.projectId) {
            return [round];
          }

          const remainingItems = round.items.filter((item) => !parameterIds.has(item.parameterId));
          if (remainingItems.length === 0) {
            return [];
          }

          return [
            {
              ...round,
              items: remainingItems,
              summary: `本轮暂存包含 ${remainingItems.length} 个参数修改。`
            }
          ];
        })
      };
    }
    case "WITHDRAW_PARAMETER_SUBMISSION_ROUND":
      return {
        ...state,
        parameterSubmissionRounds: state.parameterSubmissionRounds.map((round) =>
          round.id === action.roundId ? { ...round, status: "已撤回", summary: `${round.summary} 已由提交人撤回。` } : round
        ),
        changeRequests: state.changeRequests.map((request) =>
          request.submissionRoundId === action.roundId && request.status !== "已合入"
            ? { ...request, status: "已打回", rejectReason: "提交人已撤回本轮提交。" }
            : request
        ),
        notifications: ["本轮提交已撤回", ...state.notifications]
      };
    case "ADVANCE_REVIEW": {
      const target = state.changeRequests.find((request) => request.id === action.requestId);
      if (!target || !canAdvanceReviewRequest(activeRoleId, target)) return state;
      const nextStep = getNextReviewStep(target);
      const fromStatus = requestStatusToBackend(target.status);
      const toStatus = requestStatusToBackend(nextStep.status);
      return {
        ...state,
        changeRequests: state.changeRequests.map((request) =>
          request.id === action.requestId
            ? {
                ...request,
                ...nextStep,
                fastTrack: action.fastTrack ?? request.fastTrack,
                reviewerNote: action.note ?? request.reviewerNote,
                updatedAt: new Date().toISOString()
              }
            : request
        ),
        parameterSubmissionRounds: updateRoundStatusAfterRequest(state.parameterSubmissionRounds, target, nextStep.status),
        parameterReviewDecisions:
          fromStatus && toStatus
            ? [
                ...state.parameterReviewDecisions,
                {
                  id: `prd-${action.requestId}-${state.parameterReviewDecisions.length + 1}`,
                  requestId: action.requestId,
                  reviewerUserId: state.currentUserId,
                  decision: "advance",
                  fromStatus,
                  toStatus,
                  createdAt: new Date().toISOString()
                }
              ]
            : state.parameterReviewDecisions,
        notifications: [
          `${target.title} 已推进到下一流程节点${action.fastTrack ? "（快速通道）" : ""}`,
          ...state.notifications
        ]
      };
    }
    case "REJECT_REVIEW":
      if (!canPerform(activeRoleId, "parameter.review")) return state;
      {
      const target = state.changeRequests.find((request) => request.id === action.requestId);
      if (!target) return state;
      return {
        ...state,
        changeRequests: state.changeRequests.map((request) =>
          request.id === action.requestId
            ? {
                ...request,
                status: "已打回",
                rejectReason: action.reason,
                fastTrack: action.fastTrack ?? request.fastTrack,
                updatedAt: new Date().toISOString()
              }
            : request
        ),
        parameterSubmissionRounds: updateRoundStatusAfterRequest(state.parameterSubmissionRounds, target, "已打回"),
        notifications: [
          `${target.title} 已打回修改${action.fastTrack ? "（快速通道）" : ""}：${action.reason}`,
          ...state.notifications
        ]
      };
      }
    case "TRANSFER_REVIEW": {
      if (!canPerform(activeRoleId, "parameter.review")) return state;
      const target = state.changeRequests.find((request) => request.id === action.requestId);
      if (!target) {
        return state;
      }

      return {
        ...state,
        changeRequests: state.changeRequests.map((request) =>
          request.id === action.requestId
            ? {
                ...request,
                assignedTo: action.to,
                reviewerNote: action.note ?? request.reviewerNote,
                updatedAt: new Date().toISOString()
              }
            : request
        ),
        notifications: [`${target.title} 已转交给 ${action.to}`, ...state.notifications]
      };
    }
    case "UNDO_REVIEW_ACTION": {
      if (!canPerform(activeRoleId, "parameter.review")) return state;
      const target = state.changeRequests.find((request) => request.id === action.requestId);
      if (!target) {
        return state;
      }

      return {
        ...state,
        changeRequests: state.changeRequests.map((request) =>
          request.id === action.requestId
            ? {
                ...request,
                status: action.previousStatus,
                rejectReason: action.previousStatus === "已打回" ? request.rejectReason : undefined,
                updatedAt: new Date().toISOString()
              }
            : request
        ),
        notifications: [`${target.title} 已撤销上一步操作`, ...state.notifications]
      };
    }
    case "ADVANCE_LOG": {
      if (!canPerform(activeRoleId, "logs.upload")) return state;
      const order: LogStageId[] = ["parse", "pattern", "rootcause", "report"];
      return {
        ...state,
        logs: state.logs.map((log) => {
          if (log.id !== action.logId) {
            return log;
          }
          const index = order.indexOf(log.stage);
          const nextStage = order[Math.min(index + 1, order.length - 1)];
          return {
            ...log,
            stage: nextStage,
            status: nextStage === "report" ? "Complete" : "Processing",
            confidence: nextStage === "report" ? 96 : Math.max(log.confidence, 92)
          };
        }),
        notifications: ["日志分析阶段已更新", ...state.notifications]
      };
    }
    case "SIMULATE_LOG_UPLOAD": {
      if (!canPerform(activeRoleId, "logs.upload")) return state;
      const supportedLog = action.supported;
      const analysisQuestion = action.question?.trim();
      const newLog: LogRecord = {
        id: `log-upload-${Date.now()}`,
        fileName: action.fileName,
        status: supportedLog ? "Processing" : "Failed",
        stage: "parse",
        confidence: supportedLog ? 24 : 0,
        conclusion: supportedLog ? "新日志已进入解析队列，等待模式匹配。" : "格式不支持，无法解析为文本日志。",
        impact: supportedLog ? "待识别" : "N/A",
        evidence: [],
        suggestedActions: supportedLog ? ["等待解析完成", "保留原始日志"] : ["请上传 .log / .txt / .csv / .json 文本日志。"],
        severity: supportedLog ? "Info" : "Critical",
        rawLines: supportedLog ? [`刚刚 INFO [UPLOAD] ${action.fileName} accepted for analysis`] : [],
        capturedAt: "刚刚",
        reportId: `RPT-UP-${String(state.logs.length + 1).padStart(3, "0")}`,
        source: supportedLog ? "Manual Upload" : "Unsupported Upload",
        fileSizeMB: supportedLog ? 1.8 : 0,
        updatedAt: "刚刚",
        updatedAtIso: new Date().toISOString(),
        submittedBy: activeRoleLabel(state.activeRoleId),
        failureReason: supportedLog ? undefined : "格式不支持。请上传 .log / .txt / .csv / .json 文本日志。",
        analysisQuestion: analysisQuestion || undefined
      };

      return {
        ...state,
        logs: [newLog, ...state.logs],
        notifications: [
          supportedLog ? `${action.fileName} 已加入日志分析队列` : `${action.fileName} 格式不支持，已标记失败`,
          ...state.notifications
        ]
      };
    }
    case "HYDRATE_LOG_RUNTIME":
      return {
        ...state,
        logs: action.logs,
        archivedLogIds: archivedLogIdsFromHydratedLogs(state.archivedLogIds, action.logs)
      };
    case "HYDRATE_DEBUG_RUNTIME":
      return {
        ...state,
        devices: action.devices,
        debugParameters: action.debugParameters,
        configDraft: {
          ...state.configDraft,
          debugParameters: action.debugParameters
        }
      };
    case "SET_DEBUG_ACTIVE_SESSION":
      return {
        ...state,
        debuggingSessionStartedAt: action.session?.startedAt ?? null,
        debuggingActiveSessionId: action.session?.id ?? null
      };
    case "UPSERT_DEBUG_NODE_OPERATION": {
      const event =
        action.operation.operationType === "rollback"
          ? {
              kind: "rollback" as const,
              snapshotId: action.operation.snapshotId ?? action.operation.id,
              parameterIds: action.operation.parameterId ? [action.operation.parameterId] : [],
              at: action.operation.createdAt
            }
          : action.operation.operationType === "write"
            ? {
                kind: "push" as const,
                snapshotId: action.operation.snapshotId ?? action.operation.id,
                parameterIds: action.operation.parameterId ? [action.operation.parameterId] : [],
                at: action.operation.createdAt,
                risk: state.debugParameters.find((parameter) => parameter.id === action.operation.parameterId)?.risk ?? "Low"
              }
            : {
                kind: "connect" as const,
                deviceId: action.operation.nodePath,
                at: action.operation.createdAt
              };
      return {
        ...state,
        debugEvents: [...state.debugEvents, event]
      };
    }
    case "UPSERT_DEBUG_SNAPSHOT": {
      if (action.snapshot.status !== "valid") {
        return state;
      }
      // Convert the API snapshot summary into the page-facing DebugSnapshot so
      // the rollback safety net activates after API writes. The before/after
      // values live on the write operation, not the summary.
      const operation = action.operation;
      const operationParameterId = operation?.parameterId ?? operation?.nodeId;
      const entries =
        operation && operation.operationType === "write" && operationParameterId
          ? [
              {
                parameterId: operationParameterId,
                previousValue: operation.previousValue ?? "",
                nextValue: operation.readbackValue ?? operation.requestedValue ?? ""
              }
            ]
          : [];
      return {
        ...state,
        lastDebugSnapshot: {
          id: action.snapshot.id,
          createdAt: action.snapshot.createdAt,
          entries,
          risk: action.snapshot.risk
        }
      };
    }
    case "UPSERT_LOG_RECORD": {
      const existingIndex = state.logs.findIndex((log) => log.id === action.log.id);
      const archivedLogIds = updateArchivedLogIdsForLog(state.archivedLogIds, action.log);
      if (existingIndex === -1) {
        return {
          ...state,
          logs: [action.log, ...state.logs],
          archivedLogIds
        };
      }

      return {
        ...state,
        logs: state.logs.map((log) => (log.id === action.log.id ? action.log : log)),
        archivedLogIds
      };
    }
    case "LOG_JOB_PROGRESS":
      return {
        ...state,
        logs: state.logs.map((log) =>
          log.id === action.job.logId
            ? {
                ...log,
                stage: action.job.currentStage
              }
            : log
        )
      };
    case "CONNECT_DEVICE": {
      if (!canPerform(activeRoleId, "debugging.use")) return state;
      const now = new Date().toISOString();
      return {
        ...state,
        devices: state.devices.map((device) =>
          device.id === action.deviceId ? { ...device, status: "已连接", lastSeen: "刚刚" } : device
        ),
        debuggingSessionStartedAt: state.debuggingSessionStartedAt ?? now,
        debugEvents: [
          ...state.debugEvents,
          { kind: "connect", deviceId: action.deviceId, at: now }
        ],
        notifications: ["调试样机连接成功", ...state.notifications]
      };
    }
    case "PUSH_DEBUG_VALUE":
      if (!canPerform(activeRoleId, "debugging.use")) return state;
      return reducer(state, { type: "PUSH_DEBUG_VALUES", parameterIds: [action.parameterId] });
    case "PUSH_DEBUG_VALUES": {
      if (!canPerform(activeRoleId, "debugging.use")) return state;
      const pushIds = new Set(action.parameterIds);
      if (pushIds.size === 0) {
        return state;
      }

      const now = new Date().toISOString();
      const entries = state.debugParameters
        .filter((parameter) => pushIds.has(parameter.id))
        .map((parameter) => ({
          parameterId: parameter.id,
          previousValue: parameter.currentValue,
          nextValue: parameter.targetValue
        }));
      const riskPriority: Record<DebugParameter["risk"], number> = { Low: 0, Medium: 1, High: 2 };
      const batchRisk = state.debugParameters
        .filter((parameter) => pushIds.has(parameter.id))
        .reduce<DebugParameter["risk"]>(
          (max, parameter) => (riskPriority[parameter.risk] > riskPriority[max] ? parameter.risk : max),
          "Low"
        );
      const snapshotId = `snap-${String(state.debugEvents.filter((event) => event.kind === "push").length + 1).padStart(4, "0")}`;
      const snapshot: DebugSnapshot = {
        id: snapshotId,
        createdAt: now,
        entries,
        risk: batchRisk
      };
      const nextDebugParameters = state.debugParameters.map((parameter) =>
        pushIds.has(parameter.id) ? { ...parameter, currentValue: parameter.targetValue } : parameter
      );

      return {
        ...state,
        debugParameters: nextDebugParameters,
        lastDebugSnapshot: snapshot,
        pushedDebugIds: [...action.parameterIds],
        debugEvents: [
          ...state.debugEvents,
          { kind: "push", snapshotId, parameterIds: [...action.parameterIds], at: now, risk: batchRisk }
        ],
        notifications: [`${action.parameterIds.length} 项调试值已下发，快照 ${snapshotId} 已保存`, ...state.notifications]
      };
    }
    case "ROLLBACK_LAST_SNAPSHOT":
    case "ROLLBACK_UNDO_PUSH": {
      if (!canPerform(activeRoleId, "debugging.use")) return state;
      if (!state.lastDebugSnapshot) {
        return state;
      }

      const now = new Date().toISOString();
      const restoreMap = new Map(
        state.lastDebugSnapshot.entries.map((entry) => [entry.parameterId, entry.previousValue])
      );
      const nextDebugParameters = state.debugParameters.map((parameter) =>
        restoreMap.has(parameter.id)
          ? { ...parameter, currentValue: restoreMap.get(parameter.id)! }
          : parameter
      );
      const eventKind = action.type === "ROLLBACK_LAST_SNAPSHOT" ? "rollback" : "rollback-undo";

      return {
        ...state,
        debugParameters: nextDebugParameters,
        lastDebugSnapshot: null,
        pushedDebugIds: [],
        debugEvents: [
          ...state.debugEvents,
          eventKind === "rollback"
            ? {
                kind: "rollback",
                snapshotId: state.lastDebugSnapshot.id,
                parameterIds: state.lastDebugSnapshot.entries.map((entry) => entry.parameterId),
                at: now
              }
            : { kind: "rollback-undo", snapshotId: state.lastDebugSnapshot.id, at: now }
        ],
        notifications: [
          eventKind === "rollback"
            ? `回滚到 ${state.lastDebugSnapshot.id} 完成，${state.lastDebugSnapshot.entries.length} 项已恢复`
            : `已撤销 ${state.lastDebugSnapshot.id} 的下发`,
          ...state.notifications
        ]
      };
    }
    case "CLEAR_PUSHED_DEBUG_IDS": {
      if (!canPerform(activeRoleId, "debugging.use")) return state;
      const removeIds = new Set(action.parameterIds);
      return {
        ...state,
        pushedDebugIds: state.pushedDebugIds.filter((id) => !removeIds.has(id))
      };
    }
    case "UPDATE_DEBUG_PARAMETER": {
      if (!canPerform(activeRoleId, "debugging.use")) return state;
      const configDraft = updateDebugParameter(state.configDraft, action.parameterId, action.patch);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "COMMIT_DEBUG_PARAMETER_DRAFT": {
      if (!canPerform(activeRoleId, "debugging.use")) return state;
      const exists = state.configDraft.debugParameters.some(
        (parameter) => parameter.id === action.parameterId
      );
      if (!exists) {
        return state;
      }

      const { status: _ignoredStatus, ...committable } = action.draft;
      void _ignoredStatus;
      const configDraft = updateDebugParameter(state.configDraft, action.parameterId, committable);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "DISCARD_ALL_DEBUG_DIRTY": {
      if (!canPerform(activeRoleId, "debugging.use")) return state;
      const restoredDebugParameters = state.persistedConfigSnapshot.debugParameters.map(
        (parameter) => ({ ...parameter })
      );
      const configDraft = {
        ...state.configDraft,
        debugParameters: restoredDebugParameters
      };
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "ADD_PARAMETER_MODULE": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const configDraft = addParameterModule(state.configDraft, action.module);
      if (configDraft === state.configDraft) {
        return state;
      }
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "UPDATE_PARAMETER_MODULE": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const configDraft = updateParameterModule(state.configDraft, action.moduleName, action.patch);
      if (configDraft === state.configDraft) {
        return state;
      }
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "DELETE_PARAMETER_MODULE": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const configDraft = deleteParameterModule(state.configDraft, action.moduleName);
      if (configDraft === state.configDraft) {
        return state;
      }
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "ADD_DEBUG_PARAMETER": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      if (action.initialDraft) {
        const configDraft = addDebugParameterFromDraft(
          state.configDraft,
          action.initialDraft,
          new Date()
        );
        return {
          ...state,
          configDraft,
          ...derivePowerManagementRuntimeState(configDraft)
        };
      }
      const configDraft = addDebugParameter(state.configDraft);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "DELETE_DEBUG_PARAMETER": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const configDraft = deleteDebugParameter(state.configDraft, action.parameterId);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "MARK_CONFIG_PERSISTED": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      return {
        ...state,
        persistedConfigSnapshot: clonePowerManagementConfig(
          syncConfigDraftDebugParameterModuleMetadata(state.configDraft)
        ),
        notifications: [
          `已持久化 ${state.configDraft.debugParameters.length} 项调试参数到配置文件`,
          ...state.notifications
        ]
      };
    }
    case "ASSIGN_USER_ROLE": {
      if (!canManageUsers(state)) {
        return state;
      }
      const nextRoleId = migrateLegacyRoleId(action.roleId);
      if (
        nextRoleId === "platform-admin" &&
        migrateLegacyRoleId(state.activeRoleId) !== "platform-admin"
      ) {
        return state;
      }
      if (action.userId === state.currentUserId && !isAdminCapabilityRole(nextRoleId)) {
        return state;
      }

      const user = state.users.find((item) => item.id === action.userId);
      if (!user || migrateLegacyRoleId(user.roleId) === nextRoleId || !platformRoles.some((role) => role.id === nextRoleId)) {
        return state;
      }

      const nextUsers = state.users.map((item) => (item.id === user.id ? { ...item, roleId: nextRoleId } : item));
      if (!wouldHaveActiveAdmin(state, nextUsers)) {
        return state;
      }

      const event = buildAuditEvent({
        kind: "user-role-change",
        actor: auditActor,
        action: `${user.name} role changed from ${user.roleId} to ${nextRoleId}`,
        severity: "Medium",
        userId: user.id,
        metadata: { previousRole: user.roleId, newRole: nextRoleId }
      });

      return {
        ...state,
        users: nextUsers,
        auditEvents: [event, ...state.auditEvents]
      };
    }
    case "TOGGLE_USER_ACTIVE": {
      if (!canManageUsers(state)) {
        return state;
      }
      if (action.userId === state.currentUserId && !action.isActive) {
        return state;
      }

      const user = state.users.find((item) => item.id === action.userId);
      if (!user || user.isActive === action.isActive) {
        return state;
      }

      const nextUsers = state.users.map((item) => (item.id === user.id ? { ...item, isActive: action.isActive } : item));
      if (!wouldHaveActiveAdmin(state, nextUsers)) {
        return state;
      }

      const event = buildAuditEvent({
        kind: "user-toggle",
        actor: auditActor,
        action: `${action.isActive ? "Enabled" : "Disabled"} user ${user.name}`,
        severity: "Medium",
        userId: user.id,
        metadata: { isActive: action.isActive }
      });

      return {
        ...state,
        users: nextUsers,
        auditEvents: [event, ...state.auditEvents]
      };
    }
    case "ADD_USER": {
      if (!canManageUsers(state)) {
        return state;
      }

      const username = action.username.trim().toLowerCase();
      const name = action.name.trim();
      if (!name || username.length < 3 || state.users.some((user) => user.username?.toLowerCase() === username)) {
        return state;
      }

      const roleId = migrateLegacyRoleId(action.roleId);
      const role = platformRoles.find((item) => item.id === roleId);
      if (!role) {
        return state;
      }

      const newUser: User = {
        id: action.id?.trim() || `user-${state.users.length + 1}`,
        name,
        username,
        title: action.title.trim() || "Platform user",
        roleId,
        isActive: true,
        createdAt: new Date().toISOString(),
        lastActive: "just now"
      };
      const event = buildAuditEvent({
        kind: "user-add",
        actor: auditActor,
        action: `Added user ${newUser.name} (${role.name})`,
        severity: "Low",
        userId: newUser.id
      });

      return {
        ...state,
        users: [...state.users, newUser],
        auditEvents: [event, ...state.auditEvents]
      };
    }
    case "ADD_NOTIFICATION":
      return {
        ...state,
        notifications: [action.message, ...state.notifications],
        notificationInbox: prependMockNotificationMessage(state.notificationInbox, action.message)
      };
    case "DISMISS_NOTIFICATION":
      if (state.notifications.length === 0) {
        return state;
      }
      return { ...state, notifications: state.notifications.slice(1) };
    case "SET_NOTIFICATION_INBOX":
      return { ...state, notificationInbox: action.items };
    case "LOG_ADMIN_REANALYZE_LOG": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const target = state.logs.find((log) => log.id === action.logId);
      if (!target) {
        return state;
      }

      return {
        ...state,
        logs: state.logs.map((log) =>
          log.id === action.logId
            ? {
                ...log,
                status: "Processing",
                stage: "parse",
                confidence: Math.max(log.confidence, 24),
                updatedAt: "刚刚",
                updatedAtIso: new Date().toISOString()
              }
            : log
        ),
        auditEvents: addAuditEvent(state, {
          app: "log-admin",
          action: `重新分析 ${target.reportId}`,
          severity: "Medium"
        }),
        notifications: [`${target.fileName} 已重新加入分析队列`, ...state.notifications]
      };
    }
    case "LOG_ADMIN_ARCHIVE_LOG": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const target = state.logs.find((log) => log.id === action.logId);
      if (!target) {
        return state;
      }
      const alreadyArchived = state.archivedLogIds.includes(action.logId);

      return {
        ...state,
        archivedLogIds: alreadyArchived ? state.archivedLogIds : [...state.archivedLogIds, action.logId],
        auditEvents: alreadyArchived
          ? state.auditEvents
          : addAuditEvent(state, {
              app: "log-admin",
              action: `归档 ${target.reportId}`,
              severity: "Low"
            }),
        notifications: alreadyArchived ? state.notifications : [`${target.fileName} 已归档`, ...state.notifications]
      };
    }
    case "LOG_ADMIN_UNARCHIVE_LOG": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const target = state.logs.find((log) => log.id === action.logId);
      if (!target || !state.archivedLogIds.includes(action.logId)) {
        return state;
      }

      return {
        ...state,
        archivedLogIds: state.archivedLogIds.filter((id) => id !== action.logId),
        auditEvents: addAuditEvent(state, {
          app: "log-admin",
          action: `撤销归档 ${target.reportId}`,
          severity: "Low"
        }),
        notifications: [`${target.fileName} 已恢复`, ...state.notifications]
      };
    }
    case "LOG_ADMIN_SYNC_LOGS": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const now = new Date();
      let promoted = false;

      return {
        ...state,
        logs: state.logs.map((log, index) => {
          const shouldPromote = !promoted && log.status === "Processing";
          if (shouldPromote) {
            promoted = true;
          }
          const updatedAtMs = Math.max(Date.parse(log.updatedAtIso), now.getTime() - index * 60_000);
          return {
            ...log,
            updatedAt: index === 0 ? "刚刚" : log.updatedAt,
            updatedAtIso: new Date(updatedAtMs).toISOString(),
            status: shouldPromote ? "Complete" : log.status,
            stage: shouldPromote ? "report" : log.stage,
            confidence: shouldPromote ? Math.max(log.confidence, 94) : log.confidence
          };
        }),
        auditEvents: addAuditEvent(state, {
          app: "log-admin",
          action: "同步日志分析记录",
          severity: "Low"
        }),
        notifications: ["日志分析记录已同步", ...state.notifications]
      };
    }
    case "LOG_ADMIN_EXPORT_REPORT":
      if (!canPerform(activeRoleId, "admin.access")) return state;
      return {
        ...state,
        auditEvents: addAuditEvent(state, {
          app: "log-admin",
          action: `导出日志后台报表 ${action.timeWindow}`,
          severity: "Low"
        }),
        notifications: [`已生成 ${action.timeWindow} 日志后台报表`, ...state.notifications]
      };
    case "PUSH_NOTIFICATION":
      return {
        ...state,
        notifications: [action.message, ...state.notifications]
      };
    default:
      return state;
  }
}

export const appReducer = reducer;
