import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Copy,
  Download,
  FileText,
  History,
  Info,
  ListChecks,
  MessageSquareText,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode
} from "react";
import { WiseEffIcon } from "./components/WiseEffIcon";
import { ProjectParameterInitializationWizard } from "./ProjectParameterInitializationWizard";
import { PageRouter, type PageProps } from "@/app/routes";
import {
  createLogRuntimeActions,
  type HydrateLogRuntimeAction,
  type LogRuntimeActions
} from "@/application/logs/logRuntime";
import type { LogAnalysisRepository, LogJobSnapshot } from "@/application/ports/LogAnalysisRepository";
import { createHttpLogAnalysisRepository } from "@/infrastructure/http/logClient";
import {
  createParameterRuntimeActions,
  type HydrateParameterRuntimeAction,
  type ParameterRuntimeActions
} from "@/application/parameters/parameterRuntime";
import type { ParameterDraftDto, ParameterRepository, ProjectSummary } from "@/application/ports/ParameterRepository";
import { canAccessPage, canPerform } from "@/app/permissions";
import {
  applyInitializationDraftToConfig,
  buildInitializationDraft,
  canSubmitInitializationDraft
} from "@/domain/parameters/initialization";
import { submitParameterRound } from "@/domain/parameters/commands";
import type {
  ProjectParameterInitializationDraft,
  ProjectParameterInitializationReview,
  RiskLevel
} from "@/domain/parameters/types";
import { migrateLegacyRoleId, roleSupportsWorkflowSlot, type PlatformRoleId } from "@/domain/users/types";
import { UnifiedAgent } from "@/features/agent/UnifiedAgent";
import { createAgentPlan, getPageByPath, navigationItems, PageConfig, utilityItems } from "./appConfig";
import type { HomepageTimeWindow } from "./parameterHomepageAnalytics";
import { TopBarActionsContext, useTopBarActions } from "./components/layout";
import { applyTimeWindow, deriveMetrics } from "./logAdminAnalytics";
import { ColumnFilter } from "./components/ColumnFilter";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "./components/tableFilterUtils";
import { deriveSubmissionTimeline } from "./parameterSubmissionTimeline";
import { LinearTemplateHome } from "./linear-template/LinearTemplateHome";
import {
  AuditEvent,
  ChangeRequest,
  derivePowerManagementRuntimeState,
  DebugParameter,
  DebugSnapshot,
  initialState,
  LogAdminRole,
  LogAdminUserAvatarTone,
  LogEvidence,
  LogStageId,
  TimeWindow,
  mockDataFingerprint,
  LogRecord,
  ParameterRecord,
  ParameterSubmissionRound,
  ParameterSubmissionItem,
  REVIEW_MOCK_NOW,
  projects,
  PrototypeState,
  RequestStatus,
  roles,
  SEVERITY_LABELS,
  STAGE_LABELS,
  type UndoEntry,
  type User
} from "./mockData";
import { buildAISuggestion, buildImpactItems } from "./reviewMockData";
import { buildAuditEvent } from "./parameterAdminAnalytics";
import {
  addDebugParameter,
  addDebugParameterFromDraft,
  addProjectParameter,
  addProjectParameterFromDraft,
  deleteDebugParameter,
  deleteProjectParameter,
  serializePowerManagementConfig,
  updateDebugParameter,
  updateProjectParameter,
  updateProjectParameterMetadata,
  type PowerManagementRisk
} from "./powerManagementConfig";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { createAuthClient, type AuthContextDto } from "@/infrastructure/http/authClient";
import { createHttpParameterRepository } from "@/infrastructure/http/parameterClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

type WiseEffAuthClient = {
  getCurrentAuthContext(): Promise<AuthContextDto>;
};

export type AppAction =
  | { type: "SET_PROJECT"; projectId: string }
  | { type: "SET_ROLE"; roleId: string }
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
  | { type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND"; roundId: string }
  | { type: "ADVANCE_REVIEW"; requestId: string; fastTrack?: boolean; note?: string }
  | { type: "REJECT_REVIEW"; requestId: string; reason: string; fastTrack?: boolean }
  | { type: "TRANSFER_REVIEW"; requestId: string; to: string; note?: string }
  | { type: "UNDO_REVIEW_ACTION"; requestId: string; previousStatus: RequestStatus }
  | { type: "AI_FEEDBACK"; requestId: string; feedback: "up" | "down"; note?: string }
  | { type: "ADVANCE_LOG"; logId: string }
  | { type: "SIMULATE_LOG_UPLOAD"; fileName: string; supported: boolean; question?: string }
  | { type: "UPSERT_LOG_RECORD"; log: LogRecord }
  | { type: "LOG_JOB_PROGRESS"; job: LogJobSnapshot }
  | { type: "CONNECT_DEVICE"; deviceId: string }
  | { type: "PUSH_DEBUG_VALUE"; parameterId: string }
  | { type: "PUSH_DEBUG_VALUES"; parameterIds: string[] }
  | { type: "ROLLBACK_LAST_SNAPSHOT" }
  | { type: "ROLLBACK_UNDO_PUSH" }
  | { type: "CLEAR_PUSHED_DEBUG_IDS"; parameterIds: string[] }
  | { type: "IMPORT_PARAMETERS" }
  | { type: "ADD_NOTIFICATION"; message: string }
  | { type: "UPDATE_PROJECT_PARAMETER_METADATA"; projectId: string; parameterId: string; patch: Partial<ParameterEditorDraft> }
  | { type: "UPDATE_PROJECT_PARAMETER_VALUE"; projectId: string; parameterId: string; patch: Partial<ParameterValueDraft> }
  | { type: "UPDATE_DEBUG_PARAMETER"; parameterId: string; patch: Partial<DebugParameterEditorDraft> }
  | { type: "COMMIT_DEBUG_PARAMETER_DRAFT"; parameterId: string; draft: DebugParameterEditorDraft }
  | { type: "DISCARD_ALL_DEBUG_DIRTY" }
  | { type: "ADD_PROJECT_PARAMETER" }
  | { type: "ADD_PROJECT_PARAMETER_FROM_DRAFT"; draft: { name: string; module: string; unit: string; risk: PowerManagementRisk; description: string } }
  | { type: "DELETE_PROJECT_PARAMETER"; parameterId: string }
  | { type: "ADD_DEBUG_PARAMETER"; initialDraft?: DebugParameterEditorDraft }
  | { type: "DELETE_DEBUG_PARAMETER"; parameterId: string }
  | { type: "ASSIGN_USER_ROLE"; userId: string; roleId: PlatformRoleId }
  | { type: "TOGGLE_USER_ACTIVE"; userId: string; isActive: boolean }
  | { type: "ADD_USER"; name: string; email: string; title: string; roleId: PlatformRoleId }
  | { type: "MARK_EXPORTED"; snapshotName: string; timestamp: string }
  | { type: "DISMISS_INSIGHT"; insightId: string }
  | { type: "SET_AI_FLAGGED_IMPORT_IDS"; ids: string[] }
  | { type: "AGENT_ACTION_EXECUTED"; actionId: string; metadata?: Record<string, unknown> }
  | { type: "UNDO_LAST_DESTRUCTIVE" }
  | { type: "CLEAR_UNDO" }
  | { type: "MARK_CONFIG_PERSISTED" }
  | { type: "LOG_ADMIN_REANALYZE_LOG"; logId: string }
  | { type: "LOG_ADMIN_ARCHIVE_LOG"; logId: string }
  | { type: "LOG_ADMIN_UNARCHIVE_LOG"; logId: string }
  | { type: "LOG_ADMIN_ADD_USER"; input: { name: string; title: string; role: LogAdminRole } }
  | { type: "LOG_ADMIN_UPDATE_USER_ROLE"; userId: string; role: LogAdminRole }
  | { type: "LOG_ADMIN_REMOVE_USER"; userId: string }
  | { type: "LOG_ADMIN_SYNC_LOGS" }
  | { type: "LOG_ADMIN_EXPORT_REPORT"; timeWindow: TimeWindow }
  | { type: "OPEN_AGENT_WITH_PRESET"; preset: string };

const homepageTimeWindowOptions: Array<{ value: HomepageTimeWindow; label: string }> = [
  { value: "7d", label: "7天" },
  { value: "30d", label: "30天" },
  { value: "180d", label: "180天" }
];

type SelectOption<Value extends string = string> = {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
};

function SelectControl<Value extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  id,
  className,
  placeholder
}: {
  value: Value;
  onValueChange: (value: Value) => void;
  options: SelectOption<Value>[];
  ariaLabel?: string;
  id?: string;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as Value)}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className} data-value={value}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type ParameterValueDraft = {
  currentValue: string;
  recommendedValue: string;
  updatedAt: string;
};

export type ParameterEditorDraft = {
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  range: string;
  unit: string;
  risk: DebugParameter["risk"];
};

type DebugParameterEditorDraft = {
  name: string;
  key: string;
  description: string;
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

const riskLabels: Record<"High" | "Medium" | "Low", string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};

const logStatusLabels: Record<LogRecord["status"], string> = {
  Processing: "处理中",
  Complete: "已完成",
  Failed: "失败"
};

const LOG_LINE_RE = /^(\S+)\s+(\w+)\s+\[([^\]]+)\]\s*(.*)/;

function parseLogLine(line: string) {
  const m = LOG_LINE_RE.exec(line);
  if (m) {
    return { time: m[1], module: `${m[2]} [${m[3]}]`, content: m[4] };
  }
  return { time: "", module: "", content: line };
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

function activeRoleLabel(activeRoleId: string) {
  return roles.find((role) => role.id === activeRoleId)?.name ?? "平台用户";
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

function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function pickAvatarTone(index: number): LogAdminUserAvatarTone {
  const tones: LogAdminUserAvatarTone[] = ["blue", "teal", "violet", "slate"];
  return tones[index % tones.length];
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function wouldHaveActiveAdmin(_state: PrototypeState, nextUsers: User[]) {
  return nextUsers.some((user) => user.isActive && user.roleId === "admin");
}

function canSubmitParameterChangesForProject(state: PrototypeState, projectId: string) {
  return (state.projectInitializationStatuses[projectId] ?? "initialized") === "initialized";
}

function buildDraftSubmissionRounds(
  drafts: ParameterDraftDto[] | undefined,
  parameters: ParameterRecord[],
  apiProjects: ProjectSummary[],
  submitter: string
): ParameterSubmissionRound[] {
  if (!drafts?.length) {
    return [];
  }

  const parameterById = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  const projectById = new Map(apiProjects.map((project) => [project.id, project]));

  return drafts.map((draft) => {
    const parameter = parameterById.get(draft.parameterId);
    const project = projectById.get(draft.projectId);
    const item: ParameterSubmissionItem = {
      requestId: "",
      parameterId: draft.parameterId,
      name: parameter?.name ?? draft.parameterId,
      module: parameter?.module ?? "",
      currentValue: parameter?.currentValue ?? "",
      targetValue: draft.targetValue,
      unit: parameter?.unit ?? "",
      risk: parameter?.risk ?? "Medium",
      reason: draft.reason
    };

    return {
      id: `draft-${draft.id}`,
      projectId: draft.projectId,
      projectName: project?.name ?? draft.projectId,
      submitter,
      createdAt: draft.updatedAt,
      status: "\u5df2\u6682\u5b58",
      summary: `API draft contains 1 parameter change`,
      items: [item]
    };
  });
}

export function reducer(state: PrototypeState, action: AppAction): PrototypeState {
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const auditActor = currentUser?.name ?? "system";
  const activeRoleId = migrateLegacyRoleId(state.activeRoleId);

  switch (action.type) {
    case "SET_PROJECT":
      return { ...state, activeProjectId: action.projectId };
    case "SET_ROLE":
      return { ...state, activeRoleId: action.roleId };
    case "HYDRATE_AUTH_CONTEXT": {
      const existingUsers = state.users.filter((user) => user.id !== action.user.id);
      return {
        ...state,
        users: [action.user, ...existingUsers],
        currentUserId: action.user.id,
        activeRoleId: action.roleId
      };
    }
    case "HYDRATE_PARAMETER_RUNTIME": {
      const draftSubmissionRounds = buildDraftSubmissionRounds(
        action.parameterDrafts,
        action.parameters,
        action.projects,
        currentUser?.name ?? "API draft"
      );
      return {
        ...state,
        parameters: action.parameters,
        changeRequests: action.changeRequests,
        parameterSubmissionRounds: [...draftSubmissionRounds, ...action.parameterSubmissionRounds],
        configDraft: {
          ...state.configDraft,
          projects: action.projects.map((project) => ({ ...project }))
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
      const draft = buildInitializationDraft(state.configDraft, {
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
        notifications: [`参数初始化 ${review.id} 已驳回：${reason}`, ...state.notifications]
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
      const project = projects.find((item) => item.id === parameter.projectId);
      const submitter = roles.find((role) => role.id === state.activeRoleId)?.name ?? "平台用户";
      const roundId = `PRS-${2406 + state.parameterSubmissionRounds.length}`;
      const summary = action.reason || "WiseAgent 已生成影响摘要，建议参数管理员审阅后推进。";
      const workflowAssignees = {
        hardwareCommitterId: state.users.find((user) => user.isActive && roleSupportsWorkflowSlot(user.roleId, "hardwareCommitter"))?.id ?? "",
        softwareCommitterId: state.users.find((user) => user.isActive && roleSupportsWorkflowSlot(user.roleId, "softwareCommitter"))?.id ?? "",
        softwareUserId: state.users.find((user) => user.isActive && roleSupportsWorkflowSlot(user.roleId, "softwareUser"))?.id ?? ""
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
        notifications: [`已提交 ${request.id}，等待参数管理员审阅`, ...state.notifications]
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
        projects,
        roles,
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

      const project = projects.find((item) => item.id === draftItems[0].parameter.projectId);
      const submitter = roles.find((role) => role.id === state.activeRoleId)?.name ?? "平台用户";
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
        notifications: [`已暂存 ${roundId}，包含 ${submissionItems.length} 个参数修改`, ...state.notifications]
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
        notifications: [`${action.roundId} 已撤回`, ...state.notifications]
      };
    case "ADVANCE_REVIEW": {
      const target = state.changeRequests.find((request) => request.id === action.requestId);
      if (!target || !canAdvanceReviewRequest(activeRoleId, target)) return state;
      const nextStep = getNextReviewStep(target);
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
        notifications: [
          `${action.requestId} 已推进到下一流程节点${action.fastTrack ? "（快速通道）" : ""}`,
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
          `${action.requestId} 已打回修改${action.fastTrack ? "（快速通道）" : ""}：${action.reason}`,
          ...state.notifications
        ]
      };
      }
    case "TRANSFER_REVIEW": {
      if (!canPerform(activeRoleId, "parameter.review")) return state;
      const exists = state.changeRequests.some((request) => request.id === action.requestId);
      if (!exists) {
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
        notifications: [`${action.requestId} 已转交给 ${action.to}`, ...state.notifications]
      };
    }
    case "UNDO_REVIEW_ACTION": {
      if (!canPerform(activeRoleId, "parameter.review")) return state;
      const exists = state.changeRequests.some((request) => request.id === action.requestId);
      if (!exists) {
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
        notifications: [`${action.requestId} 已撤销上一步操作`, ...state.notifications]
      };
    }
    case "AI_FEEDBACK": {
      const nextId = `AF-${state.aiFeedback.length + 1}`;

      return {
        ...state,
        aiFeedback: [
          ...state.aiFeedback,
          {
            id: nextId,
            requestId: action.requestId,
            feedback: action.feedback,
            note: action.note,
            recordedAt: new Date().toISOString()
          }
        ]
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
        projectId: state.activeProjectId,
        status: supportedLog ? "Processing" : "Failed",
        stage: "parse",
        confidence: supportedLog ? 24 : 0,
        conclusion: supportedLog ? "新日志已进入解析队列，等待模式匹配。" : "格式不支持，无法解析为文本日志。",
        impact: supportedLog ? "待识别" : "N/A",
        evidence: [],
        suggestedActions: supportedLog ? ["等待解析完成", "保留原始日志"] : ["请上传 .log / .txt / .json 文本日志。"],
        severity: supportedLog ? "Info" : "Critical",
        rawLines: supportedLog ? [`刚刚 INFO [UPLOAD] ${action.fileName} accepted for analysis`] : [],
        capturedAt: "刚刚",
        reportId: `RPT-UP-${String(state.logs.length + 1).padStart(3, "0")}`,
        source: supportedLog ? "Manual Upload" : "Unsupported Upload",
        fileSizeMB: supportedLog ? 1.8 : 0,
        updatedAt: "刚刚",
        updatedAtIso: new Date().toISOString(),
        submittedBy: activeRoleLabel(state.activeRoleId),
        failureReason: supportedLog ? undefined : "格式不支持。请上传 .log / .txt / .json 文本日志。",
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
        logs: action.logs
      };
    case "UPSERT_LOG_RECORD": {
      const existingIndex = state.logs.findIndex((log) => log.id === action.log.id);
      if (existingIndex === -1) {
        return {
          ...state,
          logs: [action.log, ...state.logs]
        };
      }

      return {
        ...state,
        logs: state.logs.map((log) => (log.id === action.log.id ? action.log : log))
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
    case "UPDATE_PROJECT_PARAMETER_METADATA": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const configDraft = updateProjectParameterMetadata(state.configDraft, action.projectId as never, action.parameterId, action.patch);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "UPDATE_PROJECT_PARAMETER_VALUE": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const configDraft = updateProjectParameter(state.configDraft, action.projectId as never, action.parameterId, action.patch);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
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
    case "ADD_PROJECT_PARAMETER": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const configDraft = addProjectParameter(state.configDraft);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "ADD_PROJECT_PARAMETER_FROM_DRAFT": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const configDraft = addProjectParameterFromDraft(state.configDraft, action.draft);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "DELETE_PROJECT_PARAMETER": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const removed = state.configDraft.parameterLibrary.find((parameter) => parameter.id === action.parameterId);
      if (!removed) {
        return state;
      }
      const configDraft = deleteProjectParameter(state.configDraft, action.parameterId);
      const event = buildAuditEvent({
        kind: "parameter-delete",
        actor: auditActor,
        action: `删除 ${removed.name}`,
        severity: "High",
        parameterId: removed.id
      });
      const now = new Date();
      const undo: UndoEntry = {
        id: `undo-${now.getTime()}`,
        actionKind: "parameter-delete",
        message: `已删除 ${removed.name}`,
        snapshot: { configDraft: state.configDraft },
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10_000).toISOString(),
        originalAuditEventId: event.id
      };
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft),
        _undoStack: undo,
        auditEvents: [event, ...state.auditEvents]
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
        persistedConfigSnapshot: JSON.parse(JSON.stringify(state.configDraft)) as typeof state.configDraft,
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
      if (action.userId === state.currentUserId && nextRoleId !== "admin") {
        return state;
      }

      const user = state.users.find((item) => item.id === action.userId);
      if (!user || migrateLegacyRoleId(user.roleId) === nextRoleId || !roles.some((role) => role.id === nextRoleId)) {
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

      const email = action.email.trim().toLowerCase();
      const name = action.name.trim();
      if (!name || !isValidEmail(email) || state.users.some((user) => user.email.toLowerCase() === email)) {
        return state;
      }

      const roleId = migrateLegacyRoleId(action.roleId);
      const role = roles.find((item) => item.id === roleId);
      if (!role) {
        return state;
      }

      const newUser: User = {
        id: `user-${state.users.length + 1}`,
        name,
        email,
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
    case "MARK_EXPORTED": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const event = buildAuditEvent({
        kind: "export",
        actor: auditActor,
        action: `导出 ${action.snapshotName}`,
        severity: "Low",
        time: action.timestamp,
        metadata: { snapshotName: action.snapshotName }
      });

      return {
        ...state,
        lastExportedSnapshot: JSON.stringify(state.configDraft),
        auditEvents: [event, ...state.auditEvents]
      };
    }
    case "DISMISS_INSIGHT":
      if (state.insightDismissedIds.includes(action.insightId)) {
        return state;
      }
      return {
        ...state,
        insightDismissedIds: [...state.insightDismissedIds, action.insightId]
      };
    case "SET_AI_FLAGGED_IMPORT_IDS":
      if (!canPerform(activeRoleId, "admin.access")) return state;
      return {
        ...state,
        aiFlaggedImportIds: [...action.ids]
      };
    case "AGENT_ACTION_EXECUTED": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const event = buildAuditEvent({
        kind: "agent-action",
        actor: auditActor,
        action: `Agent 执行 ${action.actionId}`,
        severity: "Low",
        viaAgent: true,
        metadata: { aiActionId: action.actionId, ...(action.metadata ?? {}) }
      });

      return {
        ...state,
        auditEvents: [event, ...state.auditEvents]
      };
    }
    case "UNDO_LAST_DESTRUCTIVE": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const entry = state._undoStack;
      if (!entry || Date.now() > new Date(entry.expiresAt).getTime()) {
        return state;
      }
      const event = buildAuditEvent({
        kind: "rollback-undo",
        actor: auditActor,
        action: `撤销 ${entry.actionKind}：${entry.message}`,
        severity: "Low",
        metadata: { aiActionId: entry.originalAuditEventId }
      });
      const nextConfigDraft = entry.snapshot.configDraft ?? state.configDraft;

      return {
        ...state,
        ...entry.snapshot,
        ...derivePowerManagementRuntimeState(nextConfigDraft),
        _undoStack: null,
        auditEvents: [event, ...state.auditEvents]
      };
    }
    case "CLEAR_UNDO":
      if (!canPerform(activeRoleId, "admin.access")) return state;
      return { ...state, _undoStack: null };
    case "IMPORT_PARAMETERS":
      if (!canPerform(activeRoleId, "admin.access")) return state;
      return {
        ...state,
        notifications: ["批量参数导入完成：新增 24 项，冲突 2 项已进入审计队列", ...state.notifications]
      };
    case "ADD_NOTIFICATION":
      return { ...state, notifications: [action.message, ...state.notifications] };
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
    case "LOG_ADMIN_ADD_USER": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const userIndex = state.logAdminUsers.length;
      const newUser = {
        id: `log-admin-user-${userIndex + 1}`,
        name: action.input.name,
        title: action.input.title || "Log Admin User",
        role: action.input.role,
        avatarInitials: initialsOf(action.input.name),
        avatarTone: pickAvatarTone(userIndex),
        lastActive: "刚刚",
        lastActiveIso: new Date().toISOString()
      };

      return {
        ...state,
        logAdminUsers: [...state.logAdminUsers, newUser],
        auditEvents: addAuditEvent(state, {
          app: "log-admin",
          action: `新增用户 ${newUser.name}`,
          severity: "Medium"
        }),
        notifications: [`已新增 ${newUser.name} 为 ${newUser.role}`, ...state.notifications]
      };
    }
    case "LOG_ADMIN_UPDATE_USER_ROLE": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const target = state.logAdminUsers.find((user) => user.id === action.userId);
      if (!target || target.role === action.role) {
        return state;
      }

      return {
        ...state,
        logAdminUsers: state.logAdminUsers.map((user) =>
          user.id === action.userId ? { ...user, role: action.role, lastActive: "刚刚", lastActiveIso: new Date().toISOString() } : user
        ),
        auditEvents: addAuditEvent(state, {
          app: "log-admin",
          action: `更新 ${target.name} 权限为 ${action.role}`,
          severity: action.role === "Admin" ? "High" : "Medium"
        }),
        notifications: [`${target.name} 权限已更新为 ${action.role}`, ...state.notifications]
      };
    }
    case "LOG_ADMIN_REMOVE_USER": {
      if (!canPerform(activeRoleId, "admin.access")) return state;
      const target = state.logAdminUsers.find((user) => user.id === action.userId);
      if (!target) {
        return state;
      }

      return {
        ...state,
        logAdminUsers: state.logAdminUsers.filter((user) => user.id !== action.userId),
        auditEvents: addAuditEvent(state, {
          app: "log-admin",
          action: `移除用户 ${target.name}`,
          severity: "Medium"
        }),
        notifications: [`${target.name} 已移出日志后台`, ...state.notifications]
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
    case "OPEN_AGENT_WITH_PRESET":
      return {
        ...state,
        notifications: [`Agent 已打开预设：${action.preset}`, ...state.notifications]
      };
    default:
      return state;
  }
}

export const appReducer = reducer;

type AppProps = {
  authClient?: WiseEffAuthClient;
  initialAppState?: PrototypeState;
  logAnalysisRepository?: LogAnalysisRepository;
  parameterRepository?: ParameterRepository;
  runtimeMode?: WiseEffRuntimeMode;
};

function App({
  authClient,
  initialAppState = initialState,
  logAnalysisRepository,
  parameterRepository,
  runtimeMode = wiseEffRuntimeMode
}: AppProps = {}) {
  return (
    <TooltipProvider delayDuration={0}>
      <AppShell
        authClient={authClient}
        initialAppState={initialAppState}
        key={mockDataFingerprint}
        logAnalysisRepository={logAnalysisRepository}
        parameterRepository={parameterRepository}
        runtimeMode={runtimeMode}
      />
    </TooltipProvider>
  );
}

function AppShell({
  authClient,
  initialAppState,
  logAnalysisRepository,
  parameterRepository,
  runtimeMode
}: {
  authClient?: WiseEffAuthClient;
  initialAppState: PrototypeState;
  logAnalysisRepository?: LogAnalysisRepository;
  parameterRepository?: ParameterRepository;
  runtimeMode: WiseEffRuntimeMode;
}) {
  const [state, dispatch] = useReducer(reducer, initialAppState);
  const stateRef = useRef(state);
  const [path, setPath] = useState(() => getPageByPath(window.location.pathname).path);
  const [search, setSearch] = useState(() => window.location.search);
  const [parameterHomeTimeWindow, setParameterHomeTimeWindow] = useState<HomepageTimeWindow>("30d");
  const [topBarActions, setTopBarActions] = useState<ReactNode | null>(null);
  const [projectInitOpen, setProjectInitOpen] = useState(false);
  const page = getPageByPath(path);
  const agentPlan = useMemo(() => createAgentPlan(path), [path]);
  const topBarActionsContextValue = useMemo(() => ({ setActions: setTopBarActions }), []);
  const isPlatformHome = page.key === "home";
  const isParameterHome = page.key === "parameter-home";
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  const canAccessCurrentPage = canAccessPage(currentRoleId, page.key);
  const parameterRepositoryClient = useMemo(
    () => parameterRepository ?? (runtimeMode === "api" ? createHttpParameterRepository() : undefined),
    [parameterRepository, runtimeMode]
  );
  const logAnalysisRepositoryClient = useMemo(
    () => logAnalysisRepository ?? (runtimeMode === "api" ? createHttpLogAnalysisRepository() : undefined),
    [logAnalysisRepository, runtimeMode]
  );
  const parameterActions = useMemo<ParameterRuntimeActions>(
    () =>
      createParameterRuntimeActions({
        runtimeMode,
        repository: parameterRepositoryClient,
        dispatch,
        getParameterProjectId: (parameterId) => stateRef.current.parameters.find((parameter) => parameter.id === parameterId)?.projectId
      }),
    [parameterRepositoryClient, runtimeMode]
  );
  const logActions = useMemo<LogRuntimeActions>(
    () =>
      createLogRuntimeActions({
        mode: runtimeMode,
        repository: logAnalysisRepositoryClient,
        dispatch,
        getState: () => stateRef.current
      }),
    [logAnalysisRepositoryClient, runtimeMode]
  );
  const DebuggingAdminPageWithRuntime = useCallback(
    (props: PageProps) => <DebuggingAdminPage {...props} runtimeMode={runtimeMode} />,
    [runtimeMode]
  );
  const LogsPageWithRuntime = useCallback(
    (props: PageProps) => <LogsPage {...props} logActions={runtimeMode === "api" ? props.logActions : undefined} />,
    [runtimeMode]
  );
  const parameterRuntimeConnectedRef = useRef(false);
  const logRuntimeConnectedRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (runtimeMode !== "api") {
      return;
    }

    let cancelled = false;
    const client = authClient ?? createAuthClient();

    client
      .getCurrentAuthContext()
      .then(async (context) => {
        if (cancelled) return;
        const primaryRole = context.roles[0]?.roleId ?? "guest";
        dispatch({
          type: "HYDRATE_AUTH_CONTEXT",
          roleId: primaryRole,
          user: {
            id: context.user.id,
            name: context.user.name,
            email: context.user.email,
            title: context.user.title,
            roleId: migrateLegacyRoleId(primaryRole),
            isActive: context.user.isActive,
            createdAt: new Date().toISOString(),
            lastActive: "just now"
          }
        });
        const [parameterRefreshResult, logRefreshResult] = await Promise.allSettled([
          parameterActions.refresh({ notifyOnFailure: false }),
          logActions.refresh()
        ]);
        if (cancelled) return;
        if (
          parameterRefreshResult.status === "rejected" ||
          (parameterRefreshResult.value && "notification" in parameterRefreshResult.value)
        ) {
          dispatch({ type: "ADD_NOTIFICATION", message: "无法连接 WiseEff API，已保留本地演示数据" });
          return;
        }
        if (logRefreshResult.status === "rejected") {
          if (!(logRefreshResult.reason instanceof Error && "alreadyNotified" in logRefreshResult.reason)) {
            dispatch({ type: "ADD_NOTIFICATION", message: "无法加载 WiseEff 日志 API，已保留本地演示数据" });
          }
        } else if (!logRuntimeConnectedRef.current) {
          logRuntimeConnectedRef.current = true;
          dispatch({ type: "ADD_NOTIFICATION", message: "已连接 WiseEff 日志 API" });
        }
        if (!parameterRuntimeConnectedRef.current) {
          parameterRuntimeConnectedRef.current = true;
          dispatch({ type: "ADD_NOTIFICATION", message: "已连接 WiseEff 参数 API" });
        }
      })
      .catch(() => {
        dispatch({ type: "ADD_NOTIFICATION", message: "无法连接 WiseEff API，已保留本地演示数据" });
      });

    return () => {
      cancelled = true;
    };
  }, [authClient, logActions, parameterActions, runtimeMode]);

  useEffect(() => {
    const syncPathFromHistory = () => {
      const nextPage = getPageByPath(window.location.pathname);
      if (nextPage.path !== window.location.pathname) {
        window.history.replaceState(null, "", nextPage.path);
      }
      setPath(nextPage.path);
      setSearch(window.location.search);
    };

    syncPathFromHistory();
    window.addEventListener("popstate", syncPathFromHistory);
    return () => {
      window.removeEventListener("popstate", syncPathFromHistory);
    };
  }, []);

  const navigate = useCallback((nextPath: string) => {
    const url = new URL(nextPath, window.location.origin);
    const nextPage = getPageByPath(url.pathname);
    const nextUrl = `${nextPage.path}${url.search}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (nextUrl === currentUrl) {
      setPath(nextPage.path);
      return;
    }

    window.history.pushState(null, "", nextUrl);
    setPath(nextPage.path);
    setSearch(url.search);
  }, []);

  return (
    <div className={isPlatformHome ? "app-shell home-shell" : "app-shell"}>
      {!isPlatformHome ? <Sidebar activePath={page.path} currentRoleId={currentRoleId} onNavigate={navigate} /> : null}
      <div className={isPlatformHome ? "main-shell home-main-shell" : "main-shell"}>
        {!isPlatformHome ? (
          <TopBar
            state={state}
            dispatch={dispatch}
            page={page}
            search={search}
            onNavigate={navigate}
            pageActions={topBarActions}
            parameterHomeTimeWindow={parameterHomeTimeWindow}
            onParameterHomeTimeWindowChange={setParameterHomeTimeWindow}
            onNewProject={() => setProjectInitOpen(true)}
          />
        ) : null}
        <TopBarActionsContext.Provider value={topBarActionsContextValue}>
          {isPlatformHome ? (
            <div className="main-content home-content">
              <PageRouter
                page={page}
                state={state}
                dispatch={dispatch}
                onNavigate={navigate}
                onNewProject={() => setProjectInitOpen(true)}
                logActions={logActions}
                parameterActions={parameterActions}
                runtimeMode={runtimeMode}
                search={search}
                parameterHomeTimeWindow={parameterHomeTimeWindow}
                HomePage={HomePage}
                ParameterSubmissionsPage={ParameterSubmissionsPage}
                ParameterReviewPage={ParameterReviewPage}
                LogDashboardPage={LogDashboardPage}
                LogsPage={LogsPageWithRuntime}
                DebuggingAdminPage={DebuggingAdminPageWithRuntime}
              />
            </div>
          ) : (
            <main className="main-content" aria-label={isParameterHome ? "参数管理首页" : undefined}>
              <PageRouter
                page={page}
                state={state}
                dispatch={dispatch}
                onNavigate={navigate}
                onNewProject={() => setProjectInitOpen(true)}
                logActions={logActions}
                parameterActions={parameterActions}
                runtimeMode={runtimeMode}
                search={search}
                parameterHomeTimeWindow={parameterHomeTimeWindow}
                HomePage={HomePage}
                ParameterSubmissionsPage={ParameterSubmissionsPage}
                ParameterReviewPage={ParameterReviewPage}
                LogDashboardPage={LogDashboardPage}
                LogsPage={LogsPageWithRuntime}
                DebuggingAdminPage={DebuggingAdminPageWithRuntime}
              />
            </main>
          )}
        </TopBarActionsContext.Provider>
      </div>
      {!isPlatformHome && canAccessCurrentPage ? (
        <UnifiedAgent path={path} plan={agentPlan} state={state} dispatch={dispatch} />
      ) : null}
      {projectInitOpen ? (
        <ProjectParameterInitializationWizard
          state={state}
          dispatch={dispatch}
          onClose={() => setProjectInitOpen(false)}
        />
      ) : null}
    </div>
  );
}

function LogDashboardPage({ state, onNavigate }: { state: PrototypeState; onNavigate: (path: string) => void }) {
  const visibleLogs = useMemo(
    () => state.logs.filter((log) => !state.archivedLogIds.includes(log.id)),
    [state.archivedLogIds, state.logs]
  );
  const todayLogs = useMemo(() => applyTimeWindow(visibleLogs, "today"), [visibleLogs]);
  const metrics = useMemo(() => deriveMetrics(todayLogs, "today", visibleLogs), [todayLogs, visibleLogs]);
  const sortedByUpdate = useMemo(
    () => [...todayLogs].sort((a, b) => Date.parse(b.updatedAtIso) - Date.parse(a.updatedAtIso)),
    [todayLogs]
  );
  const sortedBySize = useMemo(() => [...todayLogs].sort((a, b) => b.fileSizeMB - a.fileSizeMB), [todayLogs]);
  const completeCount = todayLogs.filter((log) => log.status === "Complete").length;
  const processingCount = todayLogs.filter((log) => log.status === "Processing").length;
  const failedLogs = todayLogs.filter((log) => log.status === "Failed");
  const lowConfidenceLogs = todayLogs.filter((log) => log.status !== "Failed" && log.confidence > 0 && log.confidence < 90);
  const confidenceLogs = todayLogs.filter((log) => log.status !== "Failed" && log.confidence > 0);
  const totalCount = Math.max(todayLogs.length, 1);
  const statusSegments = [
    { label: "完成", value: completeCount, percent: Math.round((completeCount / totalCount) * 100), className: "is-complete" },
    { label: "处理中", value: processingCount, percent: Math.round((processingCount / totalCount) * 100), className: "is-processing" },
    { label: "失败", value: failedLogs.length, percent: Math.round((failedLogs.length / totalCount) * 100), className: "is-failed" }
  ];
  const qualityBands = [
    { label: "高置信", value: confidenceLogs.filter((log) => log.confidence >= 90).length, className: "is-strong" },
    { label: "需复核", value: confidenceLogs.filter((log) => log.confidence >= 80 && log.confidence < 90).length, className: "is-watch" },
    { label: "低置信", value: confidenceLogs.filter((log) => log.confidence > 0 && log.confidence < 80).length, className: "is-risk" }
  ];
  const totalFileSize = todayLogs.reduce((sum, log) => sum + log.fileSizeMB, 0);
  const latestLog = sortedByUpdate[0];
  const qualityFloor = confidenceLogs.length > 0 ? Math.min(...confidenceLogs.map((log) => log.confidence)) : 0;
  const peakShare = totalFileSize > 0 ? Math.round((metrics.throughputPeak.sizeMB / totalFileSize) * 100) : 0;
  const formatSize = (sizeMB: number) => (sizeMB >= 100 ? `${(sizeMB / 1024).toFixed(1)}GB` : `${sizeMB.toFixed(1)}MB`);
  const compactLogLabel = (log?: LogRecord) => (log ? `${log.reportId} · ${log.source}` : "暂无样本");
  const reviewQueue = (lowConfidenceLogs.length > 0 ? lowConfidenceLogs : confidenceLogs).slice(0, 2);
  const peakLog = sortedBySize[0];
  const trendDateLabels = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  });
  const topActions = Array.from(
    new Set(
      [...failedLogs, ...lowConfidenceLogs, ...sortedByUpdate]
        .flatMap((log) => log.suggestedActions)
        .filter(Boolean)
    )
  ).slice(0, 3);
  useTopBarActions(
    <>
      <button className="button subtle" type="button" onClick={() => onNavigate("/log-admin")}>
        查看管理后台
      </button>
      <button className="button primary" type="button" onClick={() => onNavigate("/logs")}>
        进入智能分析
      </button>
    </>,
    [onNavigate]
  );

  return (
    <div className="log-dashboard-page">
      <section className="log-dashboard-topic-grid" aria-label="日志分析核心指标">
        <article className="log-dashboard-topic-card topic-throughput" aria-label="今日分析">
          <div className="topic-card-head">
            <div>
              <span>处理节奏</span>
              <h2>今日分析</h2>
            </div>
            <div className="topic-primary-metric">
              <strong>{metrics.todayCount.value}</strong>
              <span>份</span>
            </div>
          </div>

          <div className="topic-decision-panel">
            <CheckCircle2 size={18} />
            <div>
              <span>关键判断</span>
              <strong>处理队列稳定</strong>
              <p>今日覆盖 {totalCount} 份日志，最新样本 {compactLogLabel(latestLog)} 已进入看板监控。</p>
            </div>
          </div>

          <div className="topic-evidence-grid">
            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>趋势洞察</strong>
                <span>较昨日 {metrics.todayCount.trendPct >= 0 ? "+" : ""}{metrics.todayCount.trendPct}%</span>
              </div>
              <div className="topic-line-chart" aria-hidden="true">
                {metrics.todayCount.sparkline.map((value, index) => (
                  <span className="topic-line-chart__bar" key={`${value}-${index}`}>
                    <strong className="topic-line-chart__value">{value}</strong>
                    <i style={{ height: `${Math.max(8, value * 10)}px` }} />
                    <small className="topic-line-chart__time">{trendDateLabels[index] ?? ""}</small>
                  </span>
                ))}
              </div>
            </section>

            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>状态构成</strong>
                <span>{completeCount} 完成 / {processingCount} 处理中 / {failedLogs.length} 失败</span>
              </div>
              <div className="topic-stack-bar" aria-hidden="true">
                {statusSegments.map((item) => (
                  <i key={item.label} className={item.className} style={{ width: `${Math.max(8, item.percent)}%` }} />
                ))}
              </div>
              <div className="topic-segmented-summary" aria-label="今日状态拆分">
                {statusSegments.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>

        </article>

        <article className="log-dashboard-topic-card topic-confidence" aria-label="平均置信度">
          <div className="topic-card-head">
            <div>
              <span>完成质量</span>
              <h2>平均置信度</h2>
            </div>
            <div className="topic-primary-metric">
              <strong>{metrics.avgConfidence.value}</strong>
              <span>%</span>
            </div>
          </div>

          <div className="topic-decision-panel is-quality">
            <Info size={18} />
            <div>
              <span>关键判断</span>
              <strong>{lowConfidenceLogs.length > 0 ? "存在复核样本" : "质量表现稳定"}</strong>
              <p>平均置信度 {metrics.avgConfidence.value}%，最低样本 {qualityFloor}%，较昨日 {metrics.avgConfidence.trendPct >= 0 ? "+" : ""}{metrics.avgConfidence.trendPct} pts。</p>
            </div>
          </div>

          <div className="topic-evidence-grid">
            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>质量分布</strong>
                <span>{lowConfidenceLogs.length} 份需关注</span>
              </div>
              <div className="topic-quality-panel">
                <div className="topic-score-meter" style={{ "--score": `${metrics.avgConfidence.value}%` } as CSSProperties}>
                  <span />
                  <strong>{metrics.avgConfidence.value}%</strong>
                </div>
                <div className="topic-quality-bands">
                  {qualityBands.map((band) => (
                    <div key={band.label}>
                      <span>{band.label}</span>
                      <i className={band.className} style={{ width: `${Math.max(8, (band.value / Math.max(confidenceLogs.length, 1)) * 100)}%` }} />
                      <strong>{band.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>复核队列</strong>
                <span>{reviewQueue.length} 份样本</span>
              </div>
              <div className="topic-review-queue" aria-label="置信度复核队列">
                {reviewQueue.map((log) => (
                  <div key={log.id}>
                    <span>{compactLogLabel(log)}</span>
                    <strong>{log.confidence}%</strong>
                    <p>{log.conclusion}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

        </article>

        <article className="log-dashboard-topic-card topic-failures" aria-label="失败文件">
          <div className="topic-card-head">
            <div>
              <span>失败影响</span>
              <h2>失败文件</h2>
            </div>
            <div className="topic-primary-metric">
              <strong>{metrics.failedCount.value}</strong>
              <span>份</span>
            </div>
          </div>

          <div className="topic-decision-panel is-risk">
            <AlertTriangle size={18} />
            <div>
              <span>关键判断</span>
              <strong>{failedLogs.length > 0 ? "需要人工介入" : "无需人工介入"}</strong>
              <p>{failedLogs[0]?.failureReason ?? "所有日志均进入正常分析流程。"}</p>
            </div>
          </div>

          <div className="topic-evidence-grid">
            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>失败记录</strong>
                <span>{failedLogs[0]?.reportId ?? "无失败记录"}</span>
              </div>
              <div className="topic-failure-record">
                <span>{compactLogLabel(failedLogs[0])}</span>
                <strong>{failedLogs[0]?.stage ? STAGE_LABELS[failedLogs[0].stage] : "当前队列正常"}</strong>
                <p>{failedLogs[0]?.source ?? "解析流程未发现阻断项"}</p>
              </div>
            </section>

            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>建议动作</strong>
                <span>按优先级处理</span>
              </div>
              <ol className="topic-action-list" aria-label="失败处理建议">
                {(topActions.length > 0 ? topActions : ["继续监控上传格式", "保留失败原件以便复查"]).map((action, index) => (
                  <li key={action}>
                    <span>{index + 1}</span>
                    {action}
                  </li>
                ))}
              </ol>
            </section>
          </div>

        </article>

        <article className="log-dashboard-topic-card topic-capacity" aria-label="吞吐峰值">
          <div className="topic-card-head">
            <div>
              <span>大文件压力</span>
              <h2>吞吐峰值</h2>
            </div>
            <div className="topic-primary-metric">
              <strong>{formatSize(metrics.throughputPeak.sizeMB)}</strong>
            </div>
          </div>

          <div className="topic-decision-panel is-capacity">
            <FileText size={18} />
            <div>
              <span>关键判断</span>
              <strong>峰值占比 {peakShare}%</strong>
              <p>今日总解析容量 {formatSize(totalFileSize)}，峰值样本来自 {compactLogLabel(peakLog)}。</p>
            </div>
          </div>

          <div className="topic-evidence-grid">
            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>容量结构</strong>
                <span>峰值 / 总量</span>
              </div>
              <div className="topic-capacity-structure">
                <div>
                  <span>峰值占比</span>
                  <strong>{peakShare}%</strong>
                </div>
                <i>
                  <span style={{ width: `${Math.max(8, peakShare)}%` }} />
                </i>
                <p>{formatSize(metrics.throughputPeak.sizeMB)} / {formatSize(totalFileSize)}</p>
              </div>
            </section>

            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>容量排行</strong>
                <span>Top {Math.min(sortedBySize.length, 3)}</span>
              </div>
              <div className="topic-capacity-rank" aria-label="文件容量排行">
                {sortedBySize.slice(0, 3).map((log) => (
                  <div key={log.id}>
                    <span title={compactLogLabel(log)}>{compactLogLabel(log)}</span>
                    <strong>{formatSize(log.fileSizeMB)}</strong>
                    <i style={{ width: `${Math.max(10, (log.fileSizeMB / Math.max(metrics.throughputPeak.sizeMB, 1)) * 100)}%` }} />
                  </div>
                ))}
              </div>
            </section>
          </div>

        </article>
      </section>

    </div>
  );
}

function Sidebar({
  activePath,
  currentRoleId,
  onNavigate
}: {
  activePath: string;
  currentRoleId: string;
  onNavigate: (path: string) => void;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const pageTitle = getPageByPath(activePath).title;
  const visibleNavigationItems = navigationItems.filter((item) => canAccessPage(currentRoleId, item.key));
  const groups = visibleNavigationItems.reduce<Record<string, PageConfig[]>>((acc, item) => {
    acc[item.group] = [...(acc[item.group] ?? []), item];
    return acc;
  }, {});

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">
          <WiseEffIcon decorative />
        </div>
        <div>
          <div className="brand-title">智效 WiseEff</div>
          <div className="brand-subtitle">Driven by AI</div>
        </div>
      </div>
      <ScrollArea className="nav-scroll">
        <nav aria-label="主导航">
          {Object.entries(groups).map(([group, items]) => (
            <div className="nav-group" key={group}>
              <div className="nav-group-label">{group}</div>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    className={item.path === activePath ? "nav-item active" : "nav-item"}
                    key={item.path}
                    type="button"
                    variant="ghost"
                    onClick={() => onNavigate(item.path)}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Button>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>
      <div className="utility-nav">
        <Button
          aria-label="问题反馈"
          className="nav-item compact feedback-entry"
          type="button"
          variant="ghost"
          onClick={() => setFeedbackOpen(true)}
        >
          <MessageSquareText size={18} />
          <span>
            <strong>问题反馈</strong>
            <small>内测收集 · 当前页</small>
          </span>
        </Button>
        {utilityItems
          .filter((item) => !item.path || canAccessPage(currentRoleId, getPageByPath(item.path).key))
          .map((item) => {
            const Icon = item.icon;
            const button = (
              <Button
                className={item.path === activePath ? "nav-item compact active" : "nav-item compact"}
                disabled={!item.path}
                type="button"
                variant="ghost"
                onClick={() => item.path && onNavigate(item.path)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Button>
            );

            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
      </div>
      <FeedbackDialog open={feedbackOpen} pagePath={activePath} pageTitle={pageTitle} onOpenChange={setFeedbackOpen} />
    </aside>
  );
}

function FeedbackDialog({
  open,
  pagePath,
  pageTitle,
  onOpenChange
}: {
  open: boolean;
  pagePath: string;
  pageTitle: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [description, setDescription] = useState("");
  const [feedbackType, setFeedbackType] = useState("体验问题");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotStatus, setScreenshotStatus] = useState<"idle" | "ready" | "invalid">("idle");
  const [submitted, setSubmitted] = useState(false);
  const screenshotUrlRef = useRef<string | null>(null);
  const trimmedDescription = description.trim();

  useEffect(() => {
    return () => {
      if (screenshotUrlRef.current) {
        URL.revokeObjectURL(screenshotUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setSubmitted(false);
    }
  }, [open]);

  const handleScreenshotPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const image = getPastedImage(event.clipboardData);
    if (!image) {
      setScreenshotStatus("invalid");
      return;
    }
    event.preventDefault();
    updateScreenshotUrl(URL.createObjectURL(image));
    setScreenshotStatus("ready");
  };

  const updateScreenshotUrl = (nextUrl: string) => {
    if (screenshotUrlRef.current) {
      URL.revokeObjectURL(screenshotUrlRef.current);
    }
    screenshotUrlRef.current = nextUrl;
    setScreenshotUrl(nextUrl);
  };

  const removeScreenshot = () => {
    if (screenshotUrlRef.current) {
      URL.revokeObjectURL(screenshotUrlRef.current);
    }
    screenshotUrlRef.current = null;
    setScreenshotUrl(null);
    setScreenshotStatus("idle");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="feedback-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedDescription) {
            return;
          }
          setSubmitted(true);
        }}
      >
        <DialogHeader className="feedback-dialog-header">
          <div>
            <span className="eyebrow">Internal Beta Feedback</span>
            <DialogTitle>问题反馈</DialogTitle>
            <DialogDescription>反馈会携带页面路径、类型、描述和可选截图，方便内测团队定位问题。</DialogDescription>
          </div>
        </DialogHeader>
        <div className="feedback-context">
          <div>
            <span>当前页面</span>
            <strong>{pageTitle}</strong>
          </div>
          <code>{pagePath}</code>
        </div>
        <div className="feedback-layout">
          <section className="feedback-section" aria-labelledby="feedback-info-title">
            <div className="feedback-section-title">
              <span id="feedback-info-title">问题信息</span>
              <small>必填</small>
            </div>
            <Label htmlFor="feedback-type">反馈类型</Label>
            <SelectControl
              id="feedback-type"
              ariaLabel="反馈类型"
              value={feedbackType}
              onValueChange={setFeedbackType}
              options={["体验问题", "数据问题", "导出/提交异常", "功能建议"].map((label) => ({ value: label, label }))}
            />
            <Label htmlFor="feedback-description">问题描述</Label>
            <Textarea
              id="feedback-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              placeholder="描述复现步骤、期望结果或你看到的异常现象"
            />
          </section>
          <section
            className="feedback-section feedback-capture-panel"
            aria-labelledby="feedback-capture-title"
            onPaste={handleScreenshotPaste}
            tabIndex={0}
          >
            <div className="feedback-section-title">
              <span id="feedback-capture-title">粘贴上传截图</span>
              <small>可选</small>
            </div>
            <div className={screenshotUrl ? "feedback-screenshot-preview has-image" : "feedback-screenshot-preview"}>
              {screenshotUrl ? (
                <img src={screenshotUrl} alt="问题反馈截图预览" />
              ) : (
                <div>
                  <Upload size={28} />
                  <strong>粘贴截图</strong>
                  <span>复制截图后点击此区域，按 Ctrl/⌘ + V 粘贴，支持 PNG、JPG、WebP。</span>
                </div>
              )}
            </div>
            {screenshotUrl ? (
              <div className="feedback-capture-actions">
                <Button className="feedback-remove-shot" type="button" variant="outline" onClick={removeScreenshot}>
                  <Trash2 size={16} />
                  移除
                </Button>
              </div>
            ) : null}
            {screenshotStatus === "ready" ? <p className="feedback-capture-status success">截图已粘贴，可随反馈一起提交。</p> : null}
            {screenshotStatus === "invalid" ? <p className="feedback-capture-status">请粘贴 PNG、JPG 或 WebP 格式截图。</p> : null}
          </section>
        </div>
        {submitted ? (
          <p className="feedback-success">
            {screenshotUrl ? "反馈已记录，并附带粘贴截图。" : "反馈已记录，内测团队会结合页面路径和问题类型跟进。"}
          </p>
        ) : null}
        <DialogFooter className="dialog-actions">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button type="submit" disabled={!trimmedDescription}>
            提交反馈
          </Button>
        </DialogFooter>
      </form>
      </DialogContent>
    </Dialog>
  );
}

function getPastedImage(clipboardData: DataTransfer) {
  const file = Array.from(clipboardData.files ?? []).find(isSupportedScreenshotImage);
  if (file) {
    return file;
  }

  const item = Array.from(clipboardData.items ?? []).find(
    (clipboardItem) => clipboardItem.kind === "file" && isSupportedScreenshotMimeType(clipboardItem.type)
  );
  return item?.getAsFile() ?? null;
}

function isSupportedScreenshotImage(file: File) {
  return isSupportedScreenshotMimeType(file.type);
}

function isSupportedScreenshotMimeType(type: string) {
  return /^image\/(png|jpe?g|webp)$/i.test(type);
}

function TopBar({
  state,
  dispatch,
  page,
  search,
  onNavigate,
  pageActions,
  parameterHomeTimeWindow,
  onParameterHomeTimeWindowChange,
  onNewProject
}: {
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  page: PageConfig;
  search: string;
  onNavigate: (path: string) => void;
  pageActions?: ReactNode;
  parameterHomeTimeWindow: HomepageTimeWindow;
  onParameterHomeTimeWindowChange: (value: HomepageTimeWindow) => void;
  onNewProject: () => void;
}) {
  const [roleSwitcherOpen, setRoleSwitcherOpen] = useState(false);
  const showProjectInitAction = page.key.startsWith("parameter");
  const showProjectSelector =
    page.group === "参数管理" &&
    page.key !== "parameter-home" &&
    page.key !== "parameter-comparison" &&
    page.key !== "parameter-review" &&
    page.key !== "parameter-admin";
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  const currentRole = roles.find((role) => role.id === currentRoleId);
  const projectOptions = state.configDraft.projects.map((project) => ({ value: project.id, label: project.name }));
  const selectedProjectId =
    page.key === "parameters" ? new URLSearchParams(search).get("project") || state.activeProjectId : state.activeProjectId;
  const handleProjectChange = (projectId: string) => {
    dispatch({ type: "SET_PROJECT", projectId });

    if (page.key === "parameters") {
      onNavigate(`/parameters?project=${encodeURIComponent(projectId)}`);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-page">
        <div className="topbar-title">{page.title}</div>
        <div className="topbar-subtitle">{page.subtitle}</div>
      </div>
      <div className="topbar-actions">
        {showProjectInitAction || pageActions ? (
          <div className="topbar-page-actions" role="toolbar" aria-label={`${page.title}页面操作`}>
            {showProjectInitAction ? (
              <button className="button subtle" type="button" onClick={onNewProject}>
                <FileText size={16} />
                新建项目
              </button>
            ) : null}
            {pageActions}
          </div>
        ) : null}
        {page.key === "parameter-home" ? (
          <label className="topbar-time-window-control">
            <span>时间范围</span>
            <SelectControl
              ariaLabel="时间范围"
              value={parameterHomeTimeWindow}
              onValueChange={onParameterHomeTimeWindowChange}
              options={homepageTimeWindowOptions}
            />
          </label>
        ) : null}
        {showProjectSelector ? (
          <SelectControl
            ariaLabel="项目"
            value={selectedProjectId}
            onValueChange={handleProjectChange}
            options={projectOptions}
          />
        ) : null}
        <Button className="icon-button" type="button" aria-label="通知" variant="outline" size="icon">
          <MessageSquareText size={18} />
          <span className="notification-dot" />
        </Button>
        <div className="topbar-user-switcher">
          <button
            aria-expanded={roleSwitcherOpen}
            aria-haspopup="dialog"
            aria-label="Open user role switcher"
            className="topbar-user-trigger"
            type="button"
            onClick={() => setRoleSwitcherOpen((open) => !open)}
          >
            <span className="avatar topbar-user-avatar" aria-hidden="true">
              <UserRound size={17} />
            </span>
            <span className="topbar-user-summary">
              <strong>{currentUser?.name ?? "Prototype user"}</strong>
              <small>{currentRole?.name ?? "Guest"}</small>
            </span>
            <ChevronDown size={14} />
          </button>
          {roleSwitcherOpen ? (
            <div className="topbar-user-menu" aria-label="User role switcher">
              <div className="topbar-user-menu__identity">
                <strong>{currentUser?.name ?? "Prototype user"}</strong>
                <span>{currentUser?.email ?? "No user selected"}</span>
              </div>
              <label className="topbar-user-menu__field">
                Role
                <select
                  aria-label="Prototype role"
                  value={currentRoleId}
                  onChange={(event) => dispatch({ type: "SET_ROLE", roleId: event.target.value })}
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function HomePage() {
  return <LinearTemplateHome />;
}

type LogsAuxTab = "history" | "metadata" | "related";
type UploadDialogPhase = "idle" | "validating" | "confirm" | "unsupported";
type ParameterReviewMode = "pending" | "history";
type ParameterInitializationReviewRow = {
  kind: "initialization";
  review: ProjectParameterInitializationReview;
  draft: ProjectParameterInitializationDraft;
};
type ParameterReviewRow =
  | ParameterInitializationReviewRow
  | { kind: "change"; request: ChangeRequest };

function getParameterInitializationReviewStatusLabel(status: ProjectParameterInitializationReview["status"]) {
  return {
    pending: "待审阅",
    approved: "已通过",
    rejected: "已驳回"
  }[status];
}

type VerticalTimelineItem = {
  body: string;
  isCurrent?: boolean;
  marker?: string;
  time: string;
  title: string;
};

function getUserName(users: PrototypeState["users"], userId?: string) {
  if (!userId) {
    return "未指派";
  }
  return users.find((user) => user.id === userId)?.name ?? userId;
}

function formatWorkflowDisplayText(text: string) {
  return text
    .replaceAll("Committer", "MDE")
    .replaceAll("User", "开发人员");
}

export function getContextQuery(search: string) {
  const params = new URLSearchParams(search);
  return {
    projectId: params.get("project") ?? "",
    module: params.get("module") ?? "",
    parameterId: params.get("parameter") ?? "",
    logId: params.get("logId") ?? ""
  };
}

function isComplexSubmissionHistoryValue(value: string) {
  return value.includes("\n") || value.length > 80;
}

function isComplexSubmissionHistoryItem(item: ParameterSubmissionItem) {
  return isComplexSubmissionHistoryValue(item.currentValue) || isComplexSubmissionHistoryValue(item.targetValue);
}

function getSubmissionHistoryLineCount(value: string) {
  return value ? value.split(/\r?\n/).length : 0;
}

function formatSubmissionHistoryValue(value: string, unit: string, isComplexItem: boolean) {
  if (isComplexItem) {
    return value || "-";
  }
  return `${value || "-"} ${unit}`.trim();
}

type SubmissionHistoryDiffLineKind = "equal" | "remove" | "add";

type SubmissionHistoryDiffLine = {
  kind: SubmissionHistoryDiffLineKind;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  value: string;
};

function splitSubmissionHistoryDiffLines(value: string) {
  const lines = value.split(/\r?\n/);
  return lines.length === 0 ? [""] : lines;
}

function buildSubmissionHistoryDiffLines(baseValue: string, targetValue: string): SubmissionHistoryDiffLine[] {
  const baseLines = splitSubmissionHistoryDiffLines(baseValue);
  const targetLines = splitSubmissionHistoryDiffLines(targetValue);
  const lineCount = Math.max(baseLines.length, targetLines.length);
  const diffLines: SubmissionHistoryDiffLine[] = [];

  for (let index = 0; index < lineCount; index += 1) {
    const baseLine = baseLines[index];
    const targetLine = targetLines[index];
    const baseLineNumber = baseLine === undefined ? null : index + 1;
    const targetLineNumber = targetLine === undefined ? null : index + 1;

    if (baseLine === targetLine) {
      diffLines.push({
        kind: "equal",
        leftLineNumber: baseLineNumber,
        rightLineNumber: targetLineNumber,
        value: baseLine ?? ""
      });
      continue;
    }

    if (baseLine !== undefined) {
      diffLines.push({
        kind: "remove",
        leftLineNumber: baseLineNumber,
        rightLineNumber: null,
        value: baseLine
      });
    }

    if (targetLine !== undefined) {
      diffLines.push({
        kind: "add",
        leftLineNumber: null,
        rightLineNumber: targetLineNumber,
        value: targetLine
      });
    }
  }

  return diffLines;
}

function SubmissionHistoryDiff({ baseValue, targetValue }: { baseValue: string; targetValue: string }) {
  const diffLines = buildSubmissionHistoryDiffLines(baseValue, targetValue);

  return (
    <div className="submission-preview-diff history-submission-diff" role="list">
      {diffLines.map((line, index) => (
        <div
          className="submission-preview-diff-row"
          data-kind={line.kind}
          key={`${line.kind}-${line.leftLineNumber ?? "-"}-${line.rightLineNumber ?? "-"}-${index}`}
          role="listitem"
        >
          <span className="submission-preview-diff-row__marker" aria-hidden="true">
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
          </span>
          <span className="submission-preview-diff-row__line-number">{line.leftLineNumber ?? ""}</span>
          <span className="submission-preview-diff-row__line-number">{line.rightLineNumber ?? ""}</span>
          <code>{line.value || " "}</code>
        </div>
      ))}
    </div>
  );
}

function SubmissionHistoryDiffCard({ item }: { item: ParameterSubmissionItem }) {
  const isComplexItem = isComplexSubmissionHistoryItem(item);
  const sourceLabel = isComplexItem ? "DTS / 多行参数" : "数值配置";
  const currentDisplayValue = formatSubmissionHistoryValue(item.currentValue, item.unit, isComplexItem);
  const targetDisplayValue = formatSubmissionHistoryValue(item.targetValue, item.unit, isComplexItem);

  return (
    <article
      className={["submission-diff-card", "submission-diff-card--history", isComplexItem ? "submission-diff-card--history-complex" : ""]
        .filter(Boolean)
        .join(" ")}
      key={item.requestId}
    >
      <div className="submission-diff-card__head">
        <div>
          <strong>{item.name}</strong>
          <small>{item.module} · {riskLabels[item.risk]} · {item.requestId}</small>
        </div>
        <span>{isComplexItem ? "复杂配置" : "数值配置"}</span>
      </div>
      <div className="history-submission-meta-row" aria-label={`${item.name} 历史提交摘要`}>
        <span>{sourceLabel}</span>
        <span>当前 {getSubmissionHistoryLineCount(item.currentValue)} 行</span>
        <span>目标 {getSubmissionHistoryLineCount(item.targetValue)} 行</span>
      </div>
      <SubmissionHistoryDiff baseValue={currentDisplayValue} targetValue={targetDisplayValue} />
      <p>{item.reason}</p>
    </article>
  );
}

function shouldShowSubmissionRoundSummary(round: ParameterSubmissionRound) {
  const summary = round.summary.trim();
  if (!summary) {
    return false;
  }
  return !/本轮提交包含\s*\d+\s*个参数/.test(summary);
}

function ParameterSubmissionsPage({ state, dispatch, onNavigate }: PageProps) {
  const myName = roles.find((role) => role.id === state.activeRoleId)?.name ?? "平台用户";
  const myRounds = state.parameterSubmissionRounds.filter((round) => round.submitter === myName);
  const [selectedRoundId, setSelectedRoundId] = useState(myRounds[0]?.id ?? "");
  const selectedRound = myRounds.find((round) => round.id === selectedRoundId) ?? myRounds[0];
  const timelineView = deriveSubmissionTimeline(selectedRound ?? null);

  useEffect(() => {
    if (!myRounds.some((round) => round.id === selectedRoundId)) {
      setSelectedRoundId(myRounds[0]?.id ?? "");
    }
  }, [myRounds, selectedRoundId]);
  useTopBarActions(
    <Button variant="outline" type="button" onClick={() => onNavigate("/parameters")}>
      <ArrowRight size={16} />
      返回工作台
    </Button>,
    [onNavigate]
  );

  return (
    <div className="submission-history-page">
      <section className="comparison-summary submission-history-summary">
        <MetricCard title="我的提交轮次" value={`${myRounds.length}`} trend="按轮次归档" tone="blue" />
        <MetricCard title="待审阅轮次" value={`${myRounds.filter((round) => round.status === "待审阅").length}`} trend="可撤回或等待处理" tone="teal" />
        <MetricCard title="参数项总数" value={`${myRounds.reduce((total, round) => total + round.items.length, 0)}`} trend="包含单参数和多参数提交" tone="purple" />
      </section>
      <section className="submission-history-layout">
        <aside className="history-panel" aria-label="我的提交轮次">
          <PanelHeader title="提交轮次" meta={`${myRounds.length} 轮`} />
          {myRounds.map((round) => (
            <Button
              aria-pressed={round.id === selectedRound?.id}
              className={round.id === selectedRound?.id ? "history-item active" : "history-item"}
              key={round.id}
              type="button"
              variant="ghost"
              onClick={() => setSelectedRoundId(round.id)}
            >
              <strong>{round.id}</strong>
              <span>{formatWorkflowDisplayText(round.status)} · {round.items.length} 项 · {round.createdAt}</span>
            </Button>
          ))}
          {myRounds.length === 0 ? <EmptyState text="当前还没有你的历史提交。" /> : null}
        </aside>
        <section className="submission-round-detail" aria-label="提交轮次详情">
          {selectedRound ? (
            <>
              <div className="detail-card">
                <div className="detail-heading">
                  <div>
                    <span className="eyebrow">{selectedRound.id}</span>
                    <h2>{selectedRound.projectName}</h2>
                  </div>
                  <StatusBadge status={selectedRound.status} />
                </div>
                <p>本轮提交包含 {selectedRound.items.length} 个参数，由 {selectedRound.submitter} 在 {selectedRound.createdAt} 提交。</p>
                <Timeline className="submission-timeline" steps={[...timelineView.steps]} activeIndex={timelineView.activeIndex} />
              </div>
              <div className="submission-diff-list history-diff-list">
                {selectedRound.items.map((item) => <SubmissionHistoryDiffCard item={item} key={item.requestId} />)}
              </div>
              <div className="action-panel">
                <Button
                  className="full"
                  type="button"
                  variant="destructive"
                  disabled={selectedRound.status !== "待审阅"}
                  onClick={() => dispatch({ type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND", roundId: selectedRound.id })}
                >
                  <RotateCcw size={16} />
                  撤回本轮提交
                </Button>
              </div>
            </>
          ) : (
            <EmptyState text="请选择一个提交轮次查看详情。" />
          )}
        </section>
      </section>
    </div>
  );
}


function ReviewMultiFilter({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="filter-multi">
      <button className="filter-multi__trigger" type="button" onClick={() => setOpen((c) => !c)}>
        {label}
        {selected.length > 0 ? <span className="filter-multi__count">{selected.length}</span> : null}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <ul className="filter-multi__list" role="listbox" aria-label={`${label}筛选`}>
          {options.map((opt) => (
            <li key={opt} role="option" aria-selected={selected.includes(opt)} className="filter-multi__option" onClick={() => onChange(toggleFilterValue(selected, opt))}>
              <input type="checkbox" checked={selected.includes(opt)} readOnly tabIndex={-1} />
              {opt}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ParameterReviewPage({ state, dispatch, search, parameterActions }: PageProps) {
  const [selectedId, setSelectedId] = useState(
    state.parameterInitializationReviews[0]?.id ?? state.changeRequests[0]?.id ?? ""
  );
  const [rejectOpen, setRejectOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState<ParameterReviewMode>("pending");
  const [filterModules, setFilterModules] = useState<string[]>([]);
  const [filterSubmitters, setFilterSubmitters] = useState<string[]>([]);
  const [filterProjects, setFilterProjects] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
  const pendingRequests = useMemo(() => state.changeRequests.filter((request) => request.status !== "已合入"), [state.changeRequests]);
  const mergedRequests = useMemo(() => state.changeRequests.filter((request) => request.status === "已合入"), [state.changeRequests]);
  const pendingInitializationRows = useMemo(
    () =>
      state.parameterInitializationReviews
        .filter((review) => review.status === "pending")
        .flatMap((review): ParameterInitializationReviewRow[] => {
          const draft = state.parameterInitializationDrafts.find((item) => item.id === review.draftId);
          return draft ? [{ kind: "initialization", review, draft }] : [];
        }),
    [state.parameterInitializationDrafts, state.parameterInitializationReviews]
  );
  const historyInitializationRows = useMemo(
    () =>
      state.parameterInitializationReviews
        .filter((review) => review.status !== "pending")
        .flatMap((review): ParameterInitializationReviewRow[] => {
          const draft = state.parameterInitializationDrafts.find((item) => item.id === review.draftId);
          return draft ? [{ kind: "initialization", review, draft }] : [];
        }),
    [state.parameterInitializationDrafts, state.parameterInitializationReviews]
  );
  const visibleRequests = reviewMode === "history" ? mergedRequests : pendingRequests;
  const visibleInitializationRows = reviewMode === "history" ? historyInitializationRows : pendingInitializationRows;

  const unfilteredReviewRows = useMemo<ParameterReviewRow[]>(
    () => [...visibleInitializationRows, ...visibleRequests.map((request) => ({ kind: "change" as const, request }))],
    [visibleInitializationRows, visibleRequests]
  );
  const getReviewRowField = useCallback((row: ParameterReviewRow, field: "id" | "project" | "module" | "submitter" | "change" | "status") => {
    if (row.kind === "initialization") {
      const submitter = state.users.find((user) => user.id === row.review.submittedBy)?.name ?? row.review.submittedBy;
      const modules = row.draft.parameterSnapshots.map((snapshot) => snapshot.module);
      const primaryModule = modules[0] ?? "参数初始化";
      const moduleText = modules.length > 1 ? `${primaryModule} 等 ${modules.length} 个模块` : primaryModule;
      const values = {
        id: row.review.id,
        project: row.draft.projectName,
        module: moduleText,
        submitter,
        change: `${row.draft.projectName} → ${row.draft.parameterSnapshots.length} 项参数`,
        status: getParameterInitializationReviewStatusLabel(row.review.status)
      };
      return values[field];
    }

    const { request } = row;
    const parameter = state.parameters.find((item) => item.id === request.parameterId);
    const project = state.configDraft.projects.find((item) => item.id === (request.projectId ?? parameter?.projectId));
    const values = {
      id: request.id,
      project: project?.name ?? request.projectId ?? parameter?.projectId ?? "未关联项目",
      module: request.module,
      submitter: request.submitter,
      change: `${request.currentValue} → ${request.targetValue}`,
      status: request.status
    };
    return values[field];
  }, [state.configDraft.projects, state.parameters, state.users]);
  const reviewRows = useMemo<ParameterReviewRow[]>(
    () =>
      unfilteredReviewRows.filter((row) => {
        if (filterProjects.length && !filterProjects.includes(getReviewRowField(row, "project"))) return false;
        if (filterModules.length) {
          if (row.kind === "initialization") {
            if (!row.draft.parameterSnapshots.some((snapshot) => filterModules.includes(snapshot.module))) return false;
          } else if (!filterModules.includes(getReviewRowField(row, "module"))) {
            return false;
          }
        }
        if (filterSubmitters.length && !filterSubmitters.includes(getReviewRowField(row, "submitter"))) return false;
        if (filterStatuses.length && !filterStatuses.includes(getReviewRowField(row, "status"))) return false;
        return true;
      }),
    [filterModules, filterProjects, filterStatuses, filterSubmitters, getReviewRowField, unfilteredReviewRows]
  );
  const selectedRow = reviewRows.find((row) => (row.kind === "initialization" ? row.review.id : row.request.id) === selectedId) ?? reviewRows[0] ?? null;
  const selected = selectedRow?.kind === "change" ? selectedRow.request : null;
  const selectedInitialization = selectedRow?.kind === "initialization" ? selectedRow : null;

  const modules = useMemo(
    () =>
      Array.from(
        new Set([
          ...visibleInitializationRows.flatMap((row) => row.draft.parameterSnapshots.map((snapshot) => snapshot.module)),
          ...visibleRequests.map((r) => r.module)
        ])
      ),
    [visibleInitializationRows, visibleRequests]
  );
  const submitters = useMemo(
    () =>
      Array.from(
        new Set([
          ...visibleInitializationRows.map((row) => state.users.find((user) => user.id === row.review.submittedBy)?.name ?? row.review.submittedBy),
          ...visibleRequests.map((r) => r.submitter)
        ])
      ),
    [visibleInitializationRows, visibleRequests, state.users]
  );
  const projectOptions = useMemo(() => {
    const ids = new Set(visibleRequests.map((r) => state.parameters.find((p) => p.id === r.parameterId)?.projectId).filter(Boolean));
    const changeProjects = state.configDraft.projects.filter((p) => ids.has(p.id));
    const initializationProjects = visibleInitializationRows.map((row) => ({ id: row.draft.projectId, name: row.draft.projectName, code: row.draft.projectCode }));
    return [...initializationProjects, ...changeProjects].filter(
      (project, index, allProjects) => allProjects.findIndex((item) => item.name === project.name) === index
    );
  }, [visibleInitializationRows, visibleRequests, state.parameters, state.configDraft.projects]);
  const statusOptions = useMemo(() => uniqueFilterValues(unfilteredReviewRows, (row) => getReviewRowField(row, "status")), [getReviewRowField, unfilteredReviewRows]);

  const selectedRound = useMemo(() => {
    if (!selected?.submissionRoundId) return null;
    return state.parameterSubmissionRounds.find((r) => r.id === selected.submissionRoundId) ?? null;
  }, [selected, state.parameterSubmissionRounds]);
  const selectedDetailRound = useMemo((): ParameterSubmissionRound | null => {
    if (!selected) return null;
    if (selectedRound) return selectedRound;

    const parameter = state.parameters.find((item) => item.id === selected.parameterId);
    const project = state.configDraft.projects.find((item) => item.id === (selected.projectId ?? parameter?.projectId));

    return {
      id: selected.submissionRoundId ?? selected.id,
      projectId: selected.projectId ?? parameter?.projectId ?? "unknown",
      projectName: project?.name ?? selected.projectId ?? "未关联项目",
      submitter: selected.submitter,
      createdAt: selected.createdAt,
      status: selected.status,
      summary: selected.title,
      items: [
        {
          requestId: selected.id,
          parameterId: selected.parameterId,
          name: parameter?.name ?? selected.title,
          module: selected.module,
          currentValue: selected.currentValue,
          targetValue: selected.targetValue,
          unit: parameter?.unit ?? "",
          risk: parameter?.risk ?? "Medium",
          reason: selected.aiSummary
        }
      ]
    };
  }, [selected, selectedRound, state.parameters, state.configDraft.projects]);
  const selectedInitializationSubmitter = selectedInitialization
    ? state.users.find((user) => user.id === selectedInitialization.review.submittedBy)?.name ?? selectedInitialization.review.submittedBy
    : "";
  const selectedInitializationPrimarySource = selectedInitialization
    ? state.configDraft.projects.find((project) => project.id === selectedInitialization.draft.primarySourceProjectId)
    : null;
  const selectedInitializationSupplementCount =
    selectedInitialization?.draft.parameterSnapshots.filter((snapshot) => snapshot.sourceRole === "supplement").length ?? 0;
  const selectedInitializationConfirmationCount =
    selectedInitialization?.draft.parameterSnapshots.filter((snapshot) => snapshot.needsRecommendedValueConfirmation).length ?? 0;

  useEffect(() => {
    if (!contextQuery.module && !contextQuery.projectId) {
      return;
    }

    const matchingRequest = state.changeRequests.find((request) => {
      const parameter = state.parameters.find((item) => item.id === request.parameterId);
      const projectMatches = !contextQuery.projectId || parameter?.projectId === contextQuery.projectId;
      const moduleMatches = !contextQuery.module || request.module === contextQuery.module;

      return projectMatches && moduleMatches;
    });

    if (matchingRequest) {
      setReviewMode(matchingRequest.status === "已合入" ? "history" : "pending");
      setSelectedId(matchingRequest.id);
    }
  }, [contextQuery.module, contextQuery.projectId, state.changeRequests, state.parameters]);

  useEffect(() => {
    if (reviewRows.length && !reviewRows.some((row) => (row.kind === "initialization" ? row.review.id : row.request.id) === selectedId)) {
      const firstRow = reviewRows[0];
      setSelectedId(firstRow.kind === "initialization" ? firstRow.review.id : firstRow.request.id);
    }
  }, [reviewRows, selectedId]);

  const dispatchParameterActionFailure = (result: Awaited<ReturnType<NonNullable<PageProps["parameterActions"]>["reviewChange"]>>) => {
    if (result && "notification" in result) {
      if (!result.alreadyNotified) {
        dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
      }
      return true;
    }
    return false;
  };

  const rejectSelected = async (reason: string) => {
    if (selectedInitialization) {
      dispatch({ type: "REJECT_PARAMETER_INITIALIZATION", reviewId: selectedInitialization.review.id, reason });
      setRejectOpen(false);
      return;
    }
    if (!selected) {
      return;
    }
    const result = parameterActions
      ? await parameterActions.reviewChange({ requestId: selected.id, decision: "reject", note: reason })
      : await Promise.resolve(dispatch({ type: "REJECT_REVIEW", requestId: selected.id, reason }));
    if (dispatchParameterActionFailure(result)) {
      return;
    }
    setRejectOpen(false);
  };
  const advanceSelected = async () => {
    if (!selected) {
      return;
    }
    const input = {
      requestId: selected.id,
      decision: "advance" as const,
      ...(selected.baseVersion !== undefined ? { expectedVersion: selected.baseVersion } : {})
    };
    const result = parameterActions
      ? await parameterActions.reviewChange(input)
      : await Promise.resolve(dispatch({ type: "ADVANCE_REVIEW", requestId: selected.id }));
    dispatchParameterActionFailure(result);
  };
  const openSubmissionDetail = (request: ChangeRequest) => {
    setSelectedId(request.id);
    setDetailOpen(true);
  };
  const selectReviewMode = (mode: ParameterReviewMode) => {
    setReviewMode(mode);
    setFilterModules([]);
    setFilterSubmitters([]);
    setFilterProjects([]);
    setFilterStatuses([]);
    setDetailOpen(false);
  };
  const reviewMeta = reviewMode === "history" ? `${reviewRows.length} 项已合入` : `${reviewRows.length} 项操作`;
  const selectedWorkflowItems: VerticalTimelineItem[] = selected
    ? (() => {
        const workflowItems: VerticalTimelineItem[] = [
          {
            time: "流程 1",
            title: "硬件Committer检视",
            body: `硬件 MDE：${getUserName(state.users, selected.workflowAssignees?.hardwareCommitterId)}。`
          },
          {
            time: "流程 2",
            title: "软件Committer检视",
            body: `软件 MDE：${getUserName(state.users, selected.workflowAssignees?.softwareCommitterId)}。`
          },
          {
            time: "流程 3",
            title: "软件User合入",
            body: `软件开发人员：${getUserName(state.users, selected.workflowAssignees?.softwareUserId)}。`
          }
        ];
        const currentWorkflowIndex = workflowItems.findIndex((item) => item.title === selected.status);
        if (currentWorkflowIndex === -1) {
          return [
            {
              time: "当前",
              title: selected.status,
              body: selected.rejectReason ?? `当前处理人：${getUserName(state.users, selected.assignedTo)}。`,
              isCurrent: true,
              marker: "当前流程"
            },
            ...workflowItems
          ];
        }

        return workflowItems.map((item, index) =>
          index === currentWorkflowIndex
            ? {
                ...item,
                body: `当前处理人：${getUserName(state.users, selected.assignedTo)}。`,
                isCurrent: true,
                marker: "当前流程"
              }
            : item
        );
      })()
    : [];

  return (
    <WorkbenchLayout
      title="参数管理员工作台"
      hideHeader
    >
      <section className="review-queue">
        <div className="review-queue-header">
          <PanelHeader
            title={
              <div className="review-view-tabs" role="tablist" aria-label="审阅视角">
                {[
                  { mode: "pending" as const, label: "待审阅", count: pendingRequests.length + pendingInitializationRows.length },
                  { mode: "history" as const, label: "历史提交", count: mergedRequests.length + historyInitializationRows.length }
                ].map((item) => (
                  <button
                    className={reviewMode === item.mode ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-label={item.label}
                    aria-selected={reviewMode === item.mode}
                    key={item.mode}
                    onClick={() => selectReviewMode(item.mode)}
                  >
                    {item.label}
                    <span>{item.count}</span>
                  </button>
                ))}
              </div>
            }
            meta={reviewMeta}
          />
        </div>
        <div className="table-wrap review-table-wrap">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>请求编号</span>
                  </div>
                </TableHead>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>项目</span>
                    <ColumnFilter
                      label="项目"
                      groupLabel="项目筛选"
                      values={projectOptions.map((project) => project.name)}
                      selectedValues={filterProjects}
                      onToggle={(project) => setFilterProjects((current) => toggleFilterValue(current, project))}
                      onClear={() => setFilterProjects([])}
                    />
                  </div>
                </TableHead>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>模块</span>
                    <ColumnFilter
                      label="模块"
                      groupLabel="模块筛选"
                      values={modules}
                      selectedValues={filterModules}
                      onToggle={(module) => setFilterModules((current) => toggleFilterValue(current, module))}
                      onClear={() => setFilterModules([])}
                    />
                  </div>
                </TableHead>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>提交人</span>
                    <ColumnFilter
                      label="提交人"
                      groupLabel="提交人筛选"
                      values={submitters}
                      selectedValues={filterSubmitters}
                      onToggle={(submitter) => setFilterSubmitters((current) => toggleFilterValue(current, submitter))}
                      onClear={() => setFilterSubmitters([])}
                    />
                  </div>
                </TableHead>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>变更</span>
                  </div>
                </TableHead>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>状态</span>
                    <ColumnFilter
                      label="状态"
                      groupLabel="状态筛选"
                      values={statusOptions}
                      selectedValues={filterStatuses}
                      onToggle={(status) => setFilterStatuses((current) => toggleFilterValue(current, status))}
                      onClear={() => setFilterStatuses([])}
                    />
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviewRows.map((row) => {
                if (row.kind === "initialization") {
                  return (
                    <TableRow
                      className={row.review.id === selectedInitialization?.review.id ? "selected-row" : ""}
                      key={row.review.id}
                      onClick={() => setSelectedId(row.review.id)}
                    >
                      <TableCell className="mono">{row.review.id}</TableCell>
                      <TableCell>{row.draft.projectName}</TableCell>
                      <TableCell>参数初始化</TableCell>
                      <TableCell>{state.users.find((user) => user.id === row.review.submittedBy)?.name ?? row.review.submittedBy}</TableCell>
                      <TableCell className="change-cell">
                        <button
                          className="value-change value-change-button"
                          type="button"
                          aria-label={`查看 ${row.review.id} 初始化详情`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(row.review.id);
                          }}
                        >
                          <strong>{row.draft.projectName}</strong>
                          <ArrowRight size={14} />
                          <span>{row.draft.parameterSnapshots.length} 项参数</span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={getParameterInitializationReviewStatusLabel(row.review.status)} />
                      </TableCell>
                    </TableRow>
                  );
                }

                const { request } = row;
                const parameter = state.parameters.find((item) => item.id === request.parameterId);
                const project = state.configDraft.projects.find((item) => item.id === (request.projectId ?? parameter?.projectId));

                return (
                  <TableRow
                    className={request.id === selected?.id ? "selected-row" : ""}
                    key={request.id}
                    onClick={() => setSelectedId(request.id)}
                  >
                    <TableCell className="mono">{request.id}</TableCell>
                    <TableCell>{project?.name ?? request.projectId ?? parameter?.projectId ?? "未关联项目"}</TableCell>
                    <TableCell>{request.module}</TableCell>
                    <TableCell>{request.submitter}</TableCell>
                    <TableCell className="change-cell">
                      <button
                        className="value-change value-change-button"
                        type="button"
                        aria-label={`查看 ${request.id} 提交详情`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openSubmissionDetail(request);
                        }}
                      >
                        <span className="strike">{request.currentValue}</span>
                        <ArrowRight size={14} />
                        <strong>{request.targetValue}</strong>
                      </button>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={request.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {reviewRows.length === 0 ? <EmptyState text="当前筛选条件下没有数据。" /> : null}
        </div>
      </section>
      <aside className="review-detail" aria-label="审阅详情">
        {selectedInitialization ? (
          <>
            <div className="detail-card">
              <span className="eyebrow">{selectedInitialization.review.id}</span>
              <h2>参数初始化</h2>
              <p>
                {selectedInitialization.draft.projectName} 初始化由 {selectedInitializationSubmitter} 提交。
              </p>
            </div>
            <div className="ai-summary-card">
              <SectionLabel icon={<Sparkles size={16} />} label="初始化摘要" />
              <p>项目：{selectedInitialization.draft.projectName}</p>
              <p>
                主来源：{selectedInitializationPrimarySource?.name ?? selectedInitialization.draft.primarySourceProjectId}
              </p>
              <p>已选参数：{selectedInitialization.draft.parameterSnapshots.length}</p>
              <p>补充来源填充：{selectedInitializationSupplementCount}</p>
              <p>需确认推荐值：{selectedInitializationConfirmationCount}</p>
            </div>
            {selectedInitialization.review.rejectionReason ? (
              <div className="rejection-reason-card">
                <SectionLabel icon={<CircleOff size={16} />} label="驳回原因" />
                <p>{selectedInitialization.review.rejectionReason}</p>
              </div>
            ) : null}
            <div className="detail-card grow">
              <SectionLabel icon={<History size={16} />} label="初始化状态" />
              <VerticalTimeline
                items={[
                  {
                    time: "当前",
                    title: getParameterInitializationReviewStatusLabel(selectedInitialization.review.status),
                    body: selectedInitialization.review.rejectionReason ?? "等待参数管理员处理。",
                    isCurrent: selectedInitialization.review.status === "pending",
                    marker: selectedInitialization.review.status === "pending" ? "当前流程" : undefined
                  },
                  {
                    time: "已提交",
                    title: selectedInitialization.review.submittedAt,
                    body: selectedInitialization.draft.notes || "已从来源项目推荐值生成初始化快照。"
                  }
                ]}
              />
            </div>
            {selectedInitialization.review.status === "pending" ? (
              <div className="action-panel">
                <Button
                  className="full"
                  type="button"
                  onClick={() => dispatch({ type: "APPROVE_PARAMETER_INITIALIZATION", reviewId: selectedInitialization.review.id })}
                >
                  <CheckCircle2 size={17} />
                  通过初始化
                </Button>
                <Button className="full" type="button" variant="destructive" onClick={() => setRejectOpen(true)}>
                  <CircleOff size={17} />
                  驳回初始化
                </Button>
              </div>
            ) : null}
          </>
        ) : selected ? (
          <>
            <div className="detail-card">
              <span className="eyebrow">{selected.id}</span>
              <h2>{selected.title}</h2>
              <p>
                目标模块为 <strong>{selected.module}</strong>，由 {selected.submitter} 提交。
              </p>
            </div>
            {selectedDetailRound ? (
              <div className="detail-card">
                <Button variant="outline" type="button" className="full" onClick={() => openSubmissionDetail(selected)}>
                  <FileText size={16} />
                  查看提交详情（{selectedDetailRound.items.length} 项变更）
                </Button>
              </div>
            ) : null}
            <div className="ai-summary-card">
              <SectionLabel icon={<Sparkles size={16} />} label="审阅摘要" />
              <p>{selected.aiSummary}</p>
            </div>
            {selected.rejectReason ? (
              <div className="rejection-reason-card">
                <SectionLabel icon={<CircleOff size={16} />} label="打回原因" />
                <p>{selected.rejectReason}</p>
              </div>
            ) : null}
            <div className="detail-card grow">
              <SectionLabel icon={<History size={16} />} label="变更历史" />
              <VerticalTimeline items={selectedWorkflowItems} />
            </div>
            <div className="action-panel">
              <Button className="full" type="button" onClick={advanceSelected}>
                <CheckCircle2 size={17} />
                推进流程
              </Button>
              <Button className="full" type="button" variant="destructive" onClick={() => setRejectOpen(true)}>
                <CircleOff size={17} />
                打回修改
              </Button>
            </div>
          </>
        ) : (
          <EmptyState text={reviewMode === "history" ? "当前没有历史提交。" : "当前没有待审阅请求。"} />
        )}
      </aside>
      {rejectOpen && (selected || selectedInitialization) ? (
        <RejectReviewDialog
          reviewId={selectedInitialization?.review.id ?? selected?.id ?? ""}
          onCancel={() => setRejectOpen(false)}
          onSubmit={rejectSelected}
        />
      ) : null}
      {detailOpen && selectedDetailRound ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="submission-detail-title">
          <div
            className={[
              "submission-dialog",
              selectedDetailRound.items.some(isComplexSubmissionHistoryItem) ? "submission-dialog--wide" : "",
              "submission-detail-dialog"
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="submission-dialog-head">
              <div>
                <span className="eyebrow">{selectedDetailRound.id} · {selectedDetailRound.projectName}</span>
                <h2 id="submission-detail-title">提交详情</h2>
                <p>本轮提交包含 {selectedDetailRound.items.length} 个参数修改，由 {selectedDetailRound.submitter} 提交。</p>
                {shouldShowSubmissionRoundSummary(selectedDetailRound) ? <p>{selectedDetailRound.summary}</p> : null}
              </div>
            </div>
            <div className="submission-diff-list">
              {selectedDetailRound.items.map((item) => <SubmissionHistoryDiffCard item={item} key={item.requestId} />)}
            </div>
            <div className="dialog-actions">
              <button className="button subtle" type="button" onClick={() => setDetailOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </WorkbenchLayout>
  );
}

function RejectReviewDialog({
  reviewId,
  onCancel,
  onSubmit
}: {
  reviewId: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmedReason = reason.trim();
  const submitRejection = () => {
    if (trimmedReason) {
      onSubmit(trimmedReason);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <AlertDialogContent className="rejection-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>打回修改</AlertDialogTitle>
          <AlertDialogDescription>
            将 {reviewId} 打回给提交人，管理员需要填写明确原因，方便项目侧补充测试数据或重新调整目标值。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Label htmlFor="reject-reason">打回原因</Label>
        <Textarea
          id="reject-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={5}
          placeholder="说明需要补充的测试数据、风险依据或参数调整方向"
        />
        <AlertDialogFooter className="dialog-actions">
          <AlertDialogCancel type="button" onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction type="button" variant="destructive" disabled={!trimmedReason} onClick={submitRejection}>
            提交打回
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfigExportActions({ configJson, runtimeMode }: { configJson: string; runtimeMode: WiseEffRuntimeMode }) {
  const [syncMessage, setSyncMessage] = useState("导出后可手动替换 src/config/power-management.json。");
  const [saving, setSaving] = useState(false);
  const exportConfig = () => {
    const blob = new Blob([configJson], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "power-management.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setSyncMessage("JSON 已导出，可手动同步回代码配置源。");
  };
  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(configJson);
      setSyncMessage("JSON 已复制，可手动同步回代码配置源。");
    } catch {
      setSyncMessage("当前浏览器限制剪贴板写入，可直接从预览区复制 JSON。");
    }
  };
  const saveConfig = async () => {
    if (runtimeMode === "api") {
      setSyncMessage("API 模式下参数库修改通过导入批次或审阅流程写入。");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/power-management-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: configJson
      });
      if (!response.ok) {
        throw new Error("保存失败");
      }
      setSyncMessage("已写入 src/config/power-management.json，刷新项目后会读取最新配置。");
    } catch {
      setSyncMessage("写入失败：当前环境不支持本地保存时，请导出 JSON 后手动替换。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="config-admin-actions">
      <div className="config-actions">
        <Button type="button" onClick={saveConfig} disabled={saving}>
          <FileText size={16} />
          {saving ? "保存中" : "保存到 JSON 文件"}
        </Button>
        <Button variant="outline" type="button" onClick={exportConfig}>
          <Upload size={16} />
          导出 JSON
        </Button>
        <Button variant="outline" type="button" onClick={copyConfig}>
          <FileText size={16} />
          复制 JSON
        </Button>
      </div>
      <small className="config-sync-note">{syncMessage}</small>
    </div>
  );
}


function LogsPage({ state, dispatch, onNavigate, logActions }: PageProps) {
  const [selectedLogId, setSelectedLogId] = useState(state.logs[0]?.id ?? "");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{ fileName: string; previousLogIds: Set<string> } | null>(null);
  const [feedbackLogId, setFeedbackLogId] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState("");
  const [auxTab, setAuxTab] = useState<LogsAuxTab>("history");
  const [hoveredEvidenceId, setHoveredEvidenceId] = useState<string | null>(null);
  const [focusedEvidenceId, setFocusedEvidenceId] = useState<string | null>(null);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [liveMessage, setLiveMessage] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const prevLogCount = useRef(state.logs.length);
  const activeLog = state.logs.find((log) => log.id === selectedLogId) ?? state.logs[0];
  const evidenceByLine = useMemo(() => {
    const map = new Map<number, LogEvidence[]>();

    for (const evidence of activeLog.evidence) {
      for (const lineNumber of evidence.lineNumbers) {
        map.set(lineNumber, [...(map.get(lineNumber) ?? []), evidence]);
      }
    }

    return map;
  }, [activeLog]);
  const matchLines = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return activeLog.rawLines.reduce<number[]>((items, line, index) => {
      if (line.toLowerCase().includes(query)) {
        items.push(index + 1);
      }
      return items;
    }, []);
  }, [activeLog.rawLines, searchQuery]);

  useEffect(() => {
    if (state.logs.length > prevLogCount.current) {
      setSelectedLogId(state.logs[0].id);
    }
    prevLogCount.current = state.logs.length;
  }, [state.logs]);

  useEffect(() => {
    setSearchQuery("");
    setActiveMatchIndex(0);
    setHoveredEvidenceId(null);
    setFocusedEvidenceId(null);
    setHoveredLine(null);
  }, [activeLog.id]);

  useEffect(() => {
    setLiveMessage(`已切换到 ${activeLog.fileName}，${logStatusLabels[activeLog.status]}，置信度 ${activeLog.confidence}%`);
  }, [activeLog.confidence, activeLog.fileName, activeLog.id, activeLog.status]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (activeMatchIndex > Math.max(matchLines.length - 1, 0)) {
      setActiveMatchIndex(Math.max(matchLines.length - 1, 0));
    }
  }, [activeMatchIndex, matchLines.length]);

  useEffect(() => {
    if (!pendingUpload) {
      return;
    }

    const createdLog = state.logs.find((log) => !pendingUpload.previousLogIds.has(log.id));
    if (createdLog) {
      setPendingUpload(null);
      setUploadDialogOpen(false);
    }
  }, [pendingUpload, state.logs]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const focusEvidence = (id: string) => {
    setFocusedEvidenceId(id);
    const evidence = activeLog.evidence.find((item) => item.id === id);
    const firstLine = evidence?.lineNumbers[0];
    if (!firstLine) {
      return;
    }

    document.querySelector(`[data-testid="rawlog-line-${firstLine}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const focusLineEvidence = (lineNumber: number) => {
    const evidence = evidenceByLine.get(lineNumber)?.[0];
    if (!evidence) {
      return;
    }

    setFocusedEvidenceId(evidence.id);
    document.getElementById(`evidence-card-${evidence.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const onPrimary = () => {
    const params = new URLSearchParams();

    if (activeLog.relatedParameterId) {
      params.set("parameter", activeLog.relatedParameterId);
    }
    if (activeLog.projectId) {
      params.set("project", activeLog.projectId);
    }
    params.set("logId", activeLog.id);

    onNavigate(`/parameters?${params.toString()}`);
  };

  const onExport = () => {
    const markdown = [
      `# ${activeLog.fileName}`,
      "",
      `- 状态：${logStatusLabels[activeLog.status]}`,
      `- 严重度：${SEVERITY_LABELS[activeLog.severity]}`,
      `- 置信度：${activeLog.confidence}%`,
      `- 采集时间：${activeLog.capturedAt}`,
      "",
      "## 结论",
      activeLog.conclusion,
      "",
      "## 影响",
      activeLog.impact,
      "",
      "## 证据链",
      ...activeLog.evidence.flatMap((evidence, index) => [
        `### 证据 ${String(index + 1).padStart(2, "0")} · ${STAGE_LABELS[evidence.stageId]}`,
        ...evidence.lineNumbers.map((lineNumber) => `> \`${activeLog.rawLines[lineNumber - 1] ?? ""}\``),
        "",
        `**推断**：${evidence.inference}`,
        "",
        `**处置**：${evidence.suggestedAction}`,
        ""
      ])
    ].join("\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = `${activeLog.fileName}-analysis.md`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    dispatch({ type: "ADD_NOTIFICATION", message: "报告已导出" });
  };

  const onCopyLink = async () => {
    const link = new URL("/logs", window.location.origin);

    link.searchParams.set("logId", activeLog.id);

    try {
      await navigator.clipboard.writeText(link.toString());
      dispatch({ type: "ADD_NOTIFICATION", message: "分析链接已复制" });
    } catch {
      dispatch({ type: "ADD_NOTIFICATION", message: "浏览器不支持剪贴板写入" });
    }
  };

  const onAskAgent = () => {
    document.querySelector<HTMLButtonElement>(".agent-fab")?.click();
    dispatch({ type: "ADD_NOTIFICATION", message: "WiseAgent 已展开" });
  };

  const selectedFeedbackLog = feedbackLogId ? state.logs.find((log) => log.id === feedbackLogId) ?? null : null;
  const openUploadDialog = useCallback(() => setUploadDialogOpen(true), []);
  const handleUploadLog = useCallback(
    async (file: File, supported: boolean, question?: string) => {
      if (!logActions) {
        dispatch({ type: "SIMULATE_LOG_UPLOAD", fileName: file.name, supported, question });
        setUploadDialogOpen(false);
        return;
      }

      const beforeLogIds = new Set(state.logs.map((log) => log.id));
      setPendingUpload({ fileName: file.name, previousLogIds: beforeLogIds });

      await logActions.upload({ projectId: state.activeProjectId, file, analysisQuestion: question });
    },
    [dispatch, logActions, state.activeProjectId, state.logs]
  );
  const handleRetryLog = useCallback(() => {
    if (!logActions) {
      setUploadDialogOpen(true);
      return;
    }

    void logActions.rerun({ logId: activeLog.id, analysisQuestion: activeLog.analysisQuestion });
  }, [activeLog.analysisQuestion, activeLog.id, logActions]);

  return (
    <div className="logs-v2">
      <div role="status" aria-live="polite" aria-label="日志切换状态" className="sr-only" data-testid="log-live-region">
        {liveMessage}
      </div>
      <div className="logs-v2-main">
        <LogsPageHeader onNavigate={onNavigate} onUpload={openUploadDialog} />
        <LogConclusionCard
          log={activeLog}
          onAskAgent={onAskAgent}
          onCopyLink={onCopyLink}
          onExport={onExport}
          onFeedback={() => setFeedbackLogId(activeLog.id)}
          onPrimary={onPrimary}
          onRetry={handleRetryLog}
        />
        <LogStageTimeline stage={activeLog.stage} status={activeLog.status} />
        <section className="analysis-card logs-v2-analysis" aria-label="分析结果">
          <PanelHeader title="分析结果" meta={logStatusLabels[activeLog.status]} />
          <div className="logs-v2-split">
            <RawLogViewer
              activeMatchIndex={activeMatchIndex}
              evidenceByLine={evidenceByLine}
              focusedEvidenceId={focusedEvidenceId}
              hoveredEvidenceId={hoveredEvidenceId}
              hoveredLine={hoveredLine}
              matchLines={matchLines}
              rawLines={activeLog.rawLines}
              searchInputRef={searchInputRef}
              searchQuery={searchQuery}
              onActiveMatchIndexChange={setActiveMatchIndex}
              onClickLine={focusLineEvidence}
              onHoverLine={setHoveredLine}
              onSearchQueryChange={setSearchQuery}
            />
            <EvidenceChainPanel
              evidence={activeLog.evidence}
              focusedEvidenceId={focusedEvidenceId}
              hoveredLine={hoveredLine}
              rawLines={activeLog.rawLines}
              onClickEvidence={focusEvidence}
              onHoverEvidence={setHoveredEvidenceId}
            />
          </div>
        </section>
      </div>
      <LogsAuxPanel
        activeLog={activeLog}
        auxTab={auxTab}
        logs={state.logs}
        onSelectLog={setSelectedLogId}
        onTabChange={setAuxTab}
      />
      {uploadDialogOpen ? (
        <UploadLogDialog
          accept={logActions ? null : ".log,.txt,.json"}
          onClose={() => setUploadDialogOpen(false)}
          onUpload={handleUploadLog}
        />
      ) : null}
      {selectedFeedbackLog ? (
        <LogAnalysisFeedbackDialog
          log={selectedFeedbackLog}
          onClose={() => setFeedbackLogId(null)}
          onSubmit={(confidence, issue) => {
            dispatch({
              type: "ADD_NOTIFICATION",
              message: `已记录 ${selectedFeedbackLog.reportId} 的分析反馈：${confidence}${issue ? `，${issue}` : ""}`
            });
            setFeedbackToast("反馈已记录，感谢补充分析质量线索。");
            setFeedbackLogId(null);
          }}
        />
      ) : null}
      {feedbackToast ? (
        <div className="logs-feedback-toast" role="status" aria-live="polite">
          {feedbackToast}
        </div>
      ) : null}
      {state.notifications[0] ? (
        <div className="logs-feedback-toast" role="status" aria-live="polite">
          {state.notifications[0]}
        </div>
      ) : null}
    </div>
  );
}

function isSupportedLogFile(fileName: string) {
  return /\.(log|txt|json)$/i.test(fileName);
}

function UploadLogDialog({
  accept = ".log,.txt,.json",
  onClose,
  onUpload
}: {
  accept?: string | null;
  onClose: () => void;
  onUpload: (file: File, supported: boolean, question?: string) => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<UploadDialogPhase>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [question, setQuestion] = useState("");
  const [supported, setSupported] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    fileInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const validateFile = (file: File) => {
    const nextSupported = isSupportedLogFile(file.name);

    setSelectedFile(file);
    setSelectedFileName(file.name);
    setSupported(nextSupported);
    setPhase("validating");

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setPhase(nextSupported ? "confirm" : "unsupported");
      timerRef.current = null;
    }, 200);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      setSelectedFile(null);
      setSelectedFileName("");
      setSupported(false);
      setPhase("idle");
      return;
    }
    if (files.length > 1) {
      for (let i = 0; i < files.length; i++) {
        void onUpload(files[i], isSupportedLogFile(files[i].name), question);
      }
      return;
    }
    validateFile(files[0]);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = event.dataTransfer.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      for (let i = 0; i < files.length; i++) {
        void onUpload(files[i], isSupportedLogFile(files[i].name), question);
      }
      return;
    }
    validateFile(files[0]);
  };

  const resetSelection = () => {
    setPhase("idle");
    setSelectedFile(null);
    setSelectedFileName("");
    setSupported(false);
    setQuestion("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.focus();
    }
  };

  const uploadSelected = () => {
    if (!selectedFile || uploading) {
      return;
    }
    setUploading(true);
    void Promise.resolve(onUpload(selectedFile, supported, question)).finally(() => setUploading(false));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="upload-dialog-title">
      <div className="confirm-dialog upload-dialog">
        <div className="upload-dialog__header">
          <div>
            <h2 id="upload-dialog-title"><strong>上传日志</strong></h2>
            <p>选择 .log、.txt 或 .json 文本日志，WiseEff 会模拟创建分析任务。</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭上传日志" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label
          className={classNames("upload-file-field", dragging && "upload-file-field--dragging")}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span>选择日志文件（支持拖放多份）</span>
          <input aria-label="选择日志文件" ref={fileInputRef} type="file" accept={accept ?? undefined} multiple onChange={handleFileChange} />
        </label>
        <label className="upload-question-field" htmlFor="upload-analysis-question">
          <span>分析问题（可选）</span>
          <textarea
            id="upload-analysis-question"
            value={question}
            placeholder="例如：为什么充电后段降频？"
            rows={3}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <div className={classNames("upload-dialog__state", phase === "unsupported" && "upload-dialog__state--error")}>
          {phase === "idle" ? (
            <p>等待选择日志文件。</p>
          ) : phase === "validating" ? (
            <p>正在读取 {selectedFileName}...</p>
          ) : phase === "confirm" ? (
            <p><strong>{selectedFileName}</strong> 已通过格式检查，可以进入分析队列。</p>
          ) : (
            <p><strong>{selectedFileName}</strong> 格式不支持。请优先上传 .log / .txt / .json 文本日志。</p>
          )}
        </div>
        <div className="upload-dialog__actions">
          {phase === "unsupported" ? (
            <button className="button subtle" type="button" onClick={resetSelection}>
              知道了
            </button>
          ) : (
            <button className="button subtle" type="button" disabled={uploading} onClick={onClose}>
              取消
            </button>
          )}
          {phase === "confirm" ? (
            <button className="button primary" type="button" aria-busy={uploading ? "true" : undefined} disabled={uploading} onClick={uploadSelected}>
              确认上传
            </button>
          ) : null}
          {phase === "unsupported" ? (
            <button className="button danger" type="button" aria-busy={uploading ? "true" : undefined} disabled={uploading} onClick={uploadSelected}>
              仍然上传
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LogsPageHeader({ onNavigate, onUpload }: { onNavigate: (path: string) => void; onUpload: () => void }) {
  useTopBarActions(
    <>
      <button className="button subtle" type="button" onClick={() => onNavigate("/")}>
        首页
      </button>
      <button className="button primary" type="button" onClick={onUpload}>
        <Upload size={16} />
        上传新日志
      </button>
    </>,
    [onNavigate, onUpload]
  );

  return null;
}

function SeverityBadge({ severity, processing }: { severity: LogRecord["severity"]; processing: boolean }) {
  return (
    <span className={classNames("severity-badge", `severity-badge--${severity.toLowerCase()}`, processing && "severity-badge--processing")}>
      {processing ? "分析中" : SEVERITY_LABELS[severity]}
    </span>
  );
}

function ConfidenceBar({ value, status }: { value: number; status: LogRecord["status"] }) {
  const tone = status === "Processing" ? "indeterminate" : value >= 90 ? "high" : value >= 70 ? "mid" : "low";

  return (
    <div className={classNames("confidence-bar", `confidence-bar--${tone}`)}>
      <div>
        <span>AI置信度</span>
        <strong>{value}%</strong>
      </div>
      <div aria-label="分析置信度" aria-valuemax={100} aria-valuemin={0} aria-valuenow={value} role="progressbar">
        <i style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
      </div>
    </div>
  );
}

function LogConclusionCard({
  log,
  onAskAgent,
  onPrimary,
  onExport,
  onCopyLink,
  onFeedback,
  onRetry
}: {
  log: LogRecord;
  onAskAgent: () => void;
  onPrimary: () => void;
  onExport: () => void;
  onCopyLink: () => void;
  onFeedback: () => void;
  onRetry: () => void;
}) {
  if (log.status === "Failed") {
    return <LogErrorAlert log={log} onRetry={onRetry} />;
  }

  return (
    <section className="logs-conclusion-card" aria-labelledby="log-conclusion-title">
      <div className="logs-conclusion-head">
        <SeverityBadge severity={log.severity} processing={log.status === "Processing"} />
        <div>
          <h2 id="log-conclusion-title" className={log.status === "Processing" ? "logs-analyzing-anim" : undefined}>{log.status === "Processing" ? "AI 正在分析..." : log.conclusion}</h2>
          <p>{log.status === "Complete" ? log.impact : log.conclusion}</p>
        </div>
      </div>
      {log.analysisQuestion ? (
        <div className="logs-analysis-question">
          <strong>用户问题</strong>
          <span>{log.analysisQuestion}</span>
        </div>
      ) : null}
      <ConfidenceBar value={log.confidence} status={log.status} />
      <div className="logs-conclusion-actions">
        <button className="button primary" disabled={log.status !== "Complete"} type="button" onClick={onPrimary}>
          <Sparkles size={16} />
          生成参数修改请求
        </button>
        <button className="button subtle" disabled={log.status !== "Complete"} type="button" onClick={onExport}>
          <Download size={16} />
          导出报告
        </button>
        <button className="button danger" disabled={log.status !== "Complete"} type="button" onClick={onRetry}>
          <RotateCcw size={16} />
          重新分析
        </button>
        <button className="button subtle" type="button" onClick={onCopyLink}>
          <Copy size={16} />
          复制链接
        </button>
        <button className="button subtle" type="button" onClick={onAskAgent}>
          <Bot size={16} />
          问 Agent 关于此结论
        </button>
        <button className="button subtle" type="button" onClick={onFeedback}>
          <MessageSquareText size={16} />
          反馈分析质量
        </button>
      </div>
    </section>
  );
}

function LogAnalysisFeedbackDialog({
  log,
  onClose,
  onSubmit
}: {
  log: LogRecord;
  onClose: () => void;
  onSubmit: (confidence: string, issue: string) => void;
}) {
  const [confidence, setConfidence] = useState("medium");
  const [issue, setIssue] = useState("");

  const submitFeedback = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(confidence, issue.trim());
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="log-feedback-title">
      <form className="confirm-dialog log-feedback-dialog" onSubmit={submitFeedback}>
        <div className="upload-dialog__header">
          <div>
            <h2 id="log-feedback-title">
              <strong>反馈分析质量</strong>
            </h2>
            <p>{log.fileName}</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭反馈分析质量" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="upload-question-field" htmlFor="log-feedback-confidence">
          <span>置信度反馈</span>
          <select id="log-feedback-confidence" value={confidence} onChange={(event) => setConfidence(event.target.value)}>
            <option value="high">高：判断可信</option>
            <option value="medium">中：需要复核</option>
            <option value="low">低：可能误判</option>
          </select>
        </label>
        <label className="upload-question-field" htmlFor="log-feedback-issue">
          <span>可能存在的问题</span>
          <textarea
            id="log-feedback-issue"
            value={issue}
            placeholder="例如：证据链不足、根因误判、缺少关键日志片段"
            rows={4}
            onChange={(event) => setIssue(event.target.value)}
          />
        </label>
        <div className="upload-dialog__actions">
          <button className="button subtle" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit">
            提交反馈
          </button>
        </div>
      </form>
    </div>
  );
}

function LogErrorAlert({ log, onRetry }: { log: LogRecord; onRetry: () => void }) {
  return (
    <section className="log-error-alert" role="alert">
      <AlertTriangle size={22} />
      <div>
        <strong>{log.conclusion}</strong>
        <p>{log.failureReason ?? "格式不支持，请上传 .log / .txt / .json 文本日志。"}</p>
        <button className="button danger" type="button" onClick={onRetry}>
          重新上传
        </button>
      </div>
    </section>
  );
}

function LogStageTimeline({ stage, status }: { stage: LogStageId; status: LogRecord["status"] }) {
  const order: LogStageId[] = ["parse", "pattern", "rootcause", "report"];
  const currentIndex = Math.max(0, order.indexOf(stage));

  return (
    <ol className="log-timeline" aria-label="分析流程">
      {order.map((id, index) => {
        const done = index < currentIndex || (index === currentIndex && status === "Complete");
        const current = index === currentIndex && status === "Processing";
        const failed = index === currentIndex && status === "Failed";
        const aborted = index > currentIndex && status === "Failed";
        const className = classNames(
          "log-timeline__step",
          done && "log-timeline__step--done",
          current && "log-timeline__step--current",
          failed && "log-timeline__step--failed",
          aborted && "log-timeline__step--aborted"
        );

        return (
          <li aria-current={current ? "step" : undefined} aria-disabled={aborted || undefined} className={className} key={id}>
            <span>{failed ? "!" : done ? <Check size={14} /> : index + 1}</span>
            <small>{STAGE_LABELS[id]}{aborted ? " · 已中止" : ""}</small>
          </li>
        );
      })}
    </ol>
  );
}

function RawLogViewer({
  rawLines,
  evidenceByLine,
  hoveredEvidenceId,
  focusedEvidenceId,
  hoveredLine,
  searchQuery,
  matchLines,
  activeMatchIndex,
  searchInputRef,
  onSearchQueryChange,
  onActiveMatchIndexChange,
  onHoverLine,
  onClickLine
}: {
  rawLines: string[];
  evidenceByLine: Map<number, LogEvidence[]>;
  hoveredEvidenceId: string | null;
  focusedEvidenceId: string | null;
  hoveredLine: number | null;
  searchQuery: string;
  matchLines: number[];
  activeMatchIndex: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchQueryChange: (value: string) => void;
  onActiveMatchIndexChange: React.Dispatch<React.SetStateAction<number>>;
  onHoverLine: (line: number | null) => void;
  onClickLine: (line: number) => void;
}) {
  const activeMatchLine = matchLines[activeMatchIndex];
  const matchLineSet = useMemo(() => new Set(matchLines), [matchLines]);
  const [rawLogColumnFilters, setRawLogColumnFilters] = useState<HeaderFilterState>({});
  const rawLogRows = useMemo(
    () =>
      rawLines.map((line, index) => ({
        line,
        lineNumber: index + 1,
        parsed: parseLogLine(line)
      })),
    [rawLines]
  );
  const visibleRawLogRows = useMemo(
    () =>
      rawLogRows.filter((row) =>
        (["time", "module", "content"] as const).every((key) => {
          const selectedValues = rawLogColumnFilters[key] ?? [];
          return selectedValues.length === 0 || selectedValues.includes(row.parsed[key]);
        })
      ),
    [rawLogColumnFilters, rawLogRows]
  );
  const toggleRawLogColumnFilter = (key: "time" | "module" | "content", value: string) => {
    setRawLogColumnFilters((current) => ({
      ...current,
      [key]: toggleFilterValue(current[key] ?? [], value)
    }));
  };
  const clearRawLogColumnFilter = (key: "time" | "module" | "content") => {
    setRawLogColumnFilters((current) => ({ ...current, [key]: [] }));
  };
  const renderRawLogHeader = (key: "time" | "module" | "content", label: string) => (
    <div className="rawlog-table__head-cell">
      <span>{label}</span>
      <ColumnFilter
        label={label}
        groupLabel={`${label}筛选`}
        values={uniqueFilterValues(rawLogRows, (row) => row.parsed[key])}
        selectedValues={rawLogColumnFilters[key] ?? []}
        onToggle={(value) => toggleRawLogColumnFilter(key, value)}
        onClear={() => clearRawLogColumnFilter(key)}
      />
    </div>
  );
  const moveMatch = (delta: number) => {
    if (matchLines.length === 0) {
      return;
    }
    onActiveMatchIndexChange((index) => Math.min(matchLines.length - 1, Math.max(0, index + delta)));
  };
  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      onSearchQueryChange("");
      event.currentTarget.blur();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveMatch(1);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveMatch(-1);
    }
  };

  return (
    <section className="rawlog-viewer" aria-label="原始日志">
      <SectionLabel icon={<FileText size={16} />} label="原始日志" />
      <div className="rawlog-toolbar">
        <label>
          <Search size={15} />
          <input
            aria-controls="rawlog-content"
            aria-label="在日志中搜索"
            onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchQueryChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="在日志中搜索..."
            ref={searchInputRef}
            type="search"
            value={searchQuery}
          />
        </label>
        <button aria-label="上一个匹配" disabled={matchLines.length === 0} type="button" onClick={() => moveMatch(-1)}>
          ↑
        </button>
        <button aria-label="下一个匹配" disabled={matchLines.length === 0} type="button" onClick={() => moveMatch(1)}>
          ↓
        </button>
        <output aria-live="polite" role="status">
          {searchQuery.trim() === "" ? "" : matchLines.length === 0 ? "无匹配。按 Esc 清空" : `${activeMatchIndex + 1} / ${matchLines.length} 匹配`}
        </output>
        {searchQuery ? (
          <button aria-label="清空搜索" type="button" onClick={() => onSearchQueryChange("")}>
            <X size={15} />
          </button>
        ) : null}
      </div>
      <div className="rawlog-viewer__body" id="rawlog-content">
        <table className="rawlog-table" role="grid">
          <thead>
            <tr>
              <th className="rawlog-table__th-num">#</th>
              <th className="rawlog-table__th-time">{renderRawLogHeader("time", "时间")}</th>
              <th className="rawlog-table__th-module">{renderRawLogHeader("module", "模块")}</th>
              <th className="rawlog-table__th-content">{renderRawLogHeader("content", "内容")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRawLogRows.map(({ line, lineNumber, parsed }) => {
              const evidence = evidenceByLine.get(lineNumber) ?? [];
              const isHoverAnchor = evidence.some((item) => item.id === hoveredEvidenceId);
              const isFocusAnchor = evidence.some((item) => item.id === focusedEvidenceId);
              const isHoveredLine = hoveredLine === lineNumber && evidence.length > 0;
              const isMatch = matchLineSet.has(lineNumber);
              const isCurrentMatch = activeMatchLine === lineNumber;

              return (
                <tr
                  className={classNames(
                    "rawlog-line",
                    isHoverAnchor && "rawlog-line--anchor-hover",
                    isFocusAnchor && "rawlog-line--anchor-focus",
                    isHoveredLine && "rawlog-line--line-hover",
                    isMatch && "rawlog-line--match",
                    isCurrentMatch && "rawlog-line--match-current"
                  )}
                  data-testid={`rawlog-line-${lineNumber}`}
                  key={`${lineNumber}-${line}`}
                >
                  <td>
                    <button
                      aria-label={evidence.length ? `跳转到第 ${lineNumber} 行对应证据` : undefined}
                      className="rawlog-line__num"
                      disabled={evidence.length === 0}
                      type="button"
                      onClick={() => onClickLine(lineNumber)}
                      onMouseEnter={() => onHoverLine(lineNumber)}
                      onMouseLeave={() => onHoverLine(null)}
                    >
                      {lineNumber}
                    </button>
                  </td>
                  <td className="rawlog-table__time"><code>{parsed.time}</code></td>
                  <td className="rawlog-table__module"><code>{parsed.module}</code></td>
                  <td className="rawlog-table__content"><code>{parsed.content}</code></td>
                </tr>
              );
            })}
            {visibleRawLogRows.length === 0 ? (
              <tr className="rawlog-line">
                <td colSpan={4}>当前筛选条件下没有日志行。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EvidenceChainPanel({
  evidence,
  rawLines,
  focusedEvidenceId,
  hoveredLine,
  onHoverEvidence,
  onClickEvidence
}: {
  evidence: LogEvidence[];
  rawLines: string[];
  focusedEvidenceId: string | null;
  hoveredLine: number | null;
  onHoverEvidence: (id: string | null) => void;
  onClickEvidence: (id: string) => void;
}) {
  return (
    <section className="evidence-chain" aria-label="日志分析证据链">
      <SectionLabel icon={<ListChecks size={16} />} label="日志分析证据链" />
      <div className="evidence-chain-list">
        {evidence.map((item, index) => {
          const focused = item.id === focusedEvidenceId;
          const relatedToHoveredLine = hoveredLine !== null && item.lineNumbers.includes(hoveredLine);

          return (
            <EvidenceCard
              evidence={item}
              focused={focused || relatedToHoveredLine}
              index={index}
              key={item.id}
              rawLines={rawLines}
              onClick={() => onClickEvidence(item.id)}
              onHover={(id) => onHoverEvidence(id)}
            />
          );
        })}
      </div>
    </section>
  );
}

function EvidenceCard({
  evidence,
  index,
  rawLines,
  focused,
  onHover,
  onClick
}: {
  evidence: LogEvidence;
  index: number;
  rawLines: string[];
  focused: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
}) {
  const title = `证据 ${String(index + 1).padStart(2, "0")}`;

  return (
    <article
      aria-label={`${title} ${STAGE_LABELS[evidence.stageId]}`}
      aria-pressed={focused}
      className={classNames("evidence-card", focused && "evidence-card--focused", `evidence-card--${evidence.stageId}`)}
      id={`evidence-card-${evidence.id}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => onHover(evidence.id)}
      onMouseLeave={() => onHover(null)}
    >
      <header>
        <span>{title}</span>
        <strong>{STAGE_LABELS[evidence.stageId]}</strong>
      </header>
      <div className="evidence-card__body">
        <code>{evidence.lineNumbers.map((lineNumber) => `#${lineNumber} ${rawLines[lineNumber - 1] ?? ""}`).join("\n")}</code>
        <p>{evidence.inference}</p>
        {evidence.ruleHit ? <small>命中规则：{evidence.ruleHit}</small> : null}
      </div>
      <footer>
        <small>建议处置</small>
        <p>关联处置：{evidence.suggestedAction}</p>
      </footer>
    </article>
  );
}

function LogsAuxPanel({
  logs,
  activeLog,
  auxTab,
  onTabChange,
  onSelectLog
}: {
  logs: LogRecord[];
  activeLog: LogRecord;
  auxTab: LogsAuxTab;
  onTabChange: (tab: LogsAuxTab) => void;
  onSelectLog: (id: string) => void;
}) {
  const tabs: Array<[LogsAuxTab, string]> = [
    ["history", "历史"],
    ["metadata", "元数据"],
    ["related", "相关"]
  ];

  return (
    <aside className="logs-aux-panel" aria-label="历史日志记录">
      <div className="logs-aux-tabs" role="tablist" aria-label="日志辅助信息">
        {tabs.map(([id, label]) => (
          <button
            aria-controls={`logs-aux-${id}`}
            aria-selected={auxTab === id}
            id={`logs-aux-tab-${id}`}
            key={id}
            role="tab"
            type="button"
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div aria-labelledby={`logs-aux-tab-${auxTab}`} className="logs-aux-panel__body" id={`logs-aux-${auxTab}`} role="tabpanel">
        {auxTab === "history" ? (
          <div className="history-panel">
            {logs.map((log) => (
              <button
                aria-pressed={log.id === activeLog.id}
                className={log.id === activeLog.id ? "history-item active" : "history-item"}
                key={log.id}
                type="button"
                onClick={() => onSelectLog(log.id)}
              >
                <strong>{log.fileName}</strong>
                <span>{logStatusLabels[log.status]} · {log.confidence}%</span>
              </button>
            ))}
          </div>
        ) : null}
        {auxTab === "metadata" ? (
          <dl className="logs-metadata-list">
            <div>
              <dt>文件名</dt>
              <dd>{activeLog.fileName}</dd>
            </div>
            <div>
              <dt>项目</dt>
              <dd>{activeLog.projectId}</dd>
            </div>
            <div>
              <dt>设备</dt>
              <dd>{activeLog.device ?? "未记录"}</dd>
            </div>
            <div>
              <dt>采集时间</dt>
              <dd>{activeLog.capturedAt}</dd>
            </div>
          </dl>
        ) : null}
        {auxTab === "related" ? <EmptyState text="没有找到关联日志。" /> : null}
      </div>
    </aside>
  );
}

function DebuggingAdminPage({
  state,
  dispatch,
  runtimeMode = wiseEffRuntimeMode
}: PageProps & { runtimeMode?: WiseEffRuntimeMode }) {
  const [selectedParameterId, setSelectedParameterId] = useState(state.configDraft.debugParameters[0]?.id ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRisk, setFilterRisk] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterModule, setFilterModule] = useState<string[]>([]);
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const selectedParameter =
    state.configDraft.debugParameters.find((parameter) => parameter.id === selectedParameterId) ?? state.configDraft.debugParameters[0];
  const configJson = useMemo(() => serializePowerManagementConfig(state.configDraft), [state.configDraft]);

  useEffect(() => {
    if (!state.configDraft.debugParameters.some((parameter) => parameter.id === selectedParameterId)) {
      setSelectedParameterId(state.configDraft.debugParameters[0]?.id ?? "");
    }
  }, [selectedParameterId, state.configDraft.debugParameters]);

  const filteredParameters = useMemo(() => {
    return state.configDraft.debugParameters.filter((p) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.key.toLowerCase().includes(q)) return false;
      }
      if (filterRisk.length && !filterRisk.includes(p.risk)) return false;
      if (filterStatus.length && !filterStatus.includes(p.status)) return false;
      if (filterModule.length && !filterModule.includes(p.module)) return false;
      return true;
    });
  }, [state.configDraft.debugParameters, searchQuery, filterRisk, filterStatus, filterModule]);

  const moduleOptions = useMemo(
    () => Array.from(new Set(state.configDraft.debugParameters.map((p) => p.module).filter(Boolean))),
    [state.configDraft.debugParameters]
  );

  const updateDebug = (patch: Partial<DebugParameterEditorDraft>) => {
    if (!selectedParameter) return;
    dispatch({ type: "UPDATE_DEBUG_PARAMETER", parameterId: selectedParameter.id, patch });
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1500);
  };

  const highRiskCount = state.debugParameters.filter((p) => p.risk === "High").length;
  useTopBarActions(
    <div className="debug-admin-strip debug-admin-strip--topbar">
      <span className="debug-admin-stat">可调参数 <strong>{state.debugParameters.length}</strong></span>
      <span className="debug-admin-stat">高风险 <strong>{highRiskCount}</strong></span>
      <span className="debug-admin-stat">在线设备 <strong>{state.devices.filter((d) => d.status === "已连接").length}/{state.devices.length}</strong></span>
      <span className={`debug-admin-save-indicator${saveFlash ? " visible" : ""}`}>✓ 已自动保存</span>
    </div>,
    [highRiskCount, saveFlash, state.debugParameters.length, state.devices]
  );

  return (
    <div className="debug-admin-page">
      <section className="debug-admin-grid">
        <div className="debug-admin-list">
          <div className="debug-admin-list-title-row">
            <strong>可调参数目录</strong>
            <small>{filteredParameters.length} 项</small>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                dispatch({ type: "ADD_DEBUG_PARAMETER" });
                setSelectedParameterId(`dbg-new-parameter-${state.configDraft.debugParameters.length + 1}`);
              }}
            >
              + 新增
            </Button>
          </div>
          <div className="debug-admin-list-filters">
            <div className="debug-admin-list-search">
              <Search size={14} aria-hidden />
              <input
                type="search"
                placeholder="搜索参数名 / key"
                aria-label="搜索可调参数"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <ReviewMultiFilter label="风险" options={["High", "Medium", "Low"]} selected={filterRisk} onChange={setFilterRisk} />
            <ReviewMultiFilter label="状态" options={["已同步", "待下发", "下发成功"]} selected={filterStatus} onChange={setFilterStatus} />
            <ReviewMultiFilter label="模块" options={moduleOptions} selected={filterModule} onChange={setFilterModule} />
          </div>
          <ul className="debug-admin-param-list" role="listbox" aria-label="可调参数目录">
            {filteredParameters.map((parameter) => (
              <li
                key={parameter.id}
                role="option"
                aria-selected={parameter.id === selectedParameter?.id}
                className={`debug-admin-param-row${parameter.id === selectedParameter?.id ? " selected" : ""}`}
                onClick={() => setSelectedParameterId(parameter.id)}
              >
                <span className="debug-admin-param-row-main">
                  <strong>{parameter.name}</strong>
                  <small>{parameter.key}</small>
                </span>
                <span className="debug-admin-param-row-meta">
                  <span className={`debug-status-tag ${parameter.status === "待下发" ? "pending" : parameter.status === "下发成功" ? "success" : ""}`}>{parameter.status}</span>
                  <RiskBadge risk={parameter.risk} />
                </span>
                <button
                  type="button"
                  className="debug-admin-row-delete"
                  aria-label={`删除 ${parameter.name}`}
                  disabled={state.configDraft.debugParameters.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: "DELETE_DEBUG_PARAMETER", parameterId: parameter.id });
                    if (parameter.id === selectedParameterId) {
                      setSelectedParameterId(state.configDraft.debugParameters.find((p) => p.id !== parameter.id)?.id ?? "");
                    }
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="debug-admin-editor">
          {selectedParameter ? (
            <>
              <div className="debug-admin-form-section">
                <h3 className="debug-admin-form-group-title">标识信息</h3>
                <div className="debug-admin-form-fields">
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">参数名称</span>
                    <Input value={selectedParameter.name} onChange={(e) => updateDebug({ name: e.target.value })} />
                  </label>
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">参数 key</span>
                    <Input value={selectedParameter.key} onChange={(e) => updateDebug({ key: e.target.value })} />
                  </label>
                </div>
              </div>
              <div className="debug-admin-form-section">
                <h3 className="debug-admin-form-group-title">值与范围</h3>
                <div className="debug-admin-form-fields">
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">当前值</span>
                    <Input value={selectedParameter.currentValue} onChange={(e) => updateDebug({ currentValue: e.target.value })} />
                  </label>
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">目标值</span>
                    <Input aria-label="调试目标值" value={selectedParameter.targetValue} onChange={(e) => updateDebug({ targetValue: e.target.value })} />
                  </label>
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">范围</span>
                    <Input value={selectedParameter.range} onChange={(e) => updateDebug({ range: e.target.value })} />
                  </label>
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">单位</span>
                    <Input value={selectedParameter.unit} onChange={(e) => updateDebug({ unit: e.target.value })} />
                  </label>
                </div>
              </div>
              <div className="debug-admin-form-section">
                <h3 className="debug-admin-form-group-title">分类与状态</h3>
                <div className="debug-admin-form-fields">
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">重要性</span>
                    <SelectControl
                      value={selectedParameter.risk}
                      onValueChange={(risk) => updateDebug({ risk })}
                      options={[
                        { value: "High", label: "高" },
                        { value: "Medium", label: "中" },
                        { value: "Low", label: "低" }
                      ]}
                    />
                  </label>
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">状态</span>
                    <SelectControl
                      value={selectedParameter.status}
                      onValueChange={(status) => updateDebug({ status })}
                      options={[
                        { value: "已同步", label: "已同步" },
                        { value: "待下发", label: "待下发" },
                        { value: "下发成功", label: "下发成功" }
                      ]}
                    />
                  </label>
                </div>
              </div>
              <div className="debug-admin-form-section">
                <h3 className="debug-admin-form-group-title">节点调试</h3>
                <div className="debug-admin-form-fields">
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">节点路径</span>
                    <Input
                      aria-label="节点路径"
                      value={selectedParameter.nodePath}
                      onChange={(e) => updateDebug({ nodePath: e.target.value })}
                    />
                  </label>
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">访问模式</span>
                    <SelectControl
                      ariaLabel="访问模式"
                      value={selectedParameter.accessMode}
                      onValueChange={(accessMode) => updateDebug({ accessMode })}
                      options={[
                        { value: "RO", label: "RO · 只读" },
                        { value: "WO", label: "WO · 只写" },
                        { value: "RW", label: "RW · 读写" }
                      ]}
                    />
                  </label>
                </div>
              </div>
            </>
          ) : (
            <EmptyState text="请选择一个调试参数。" />
          )}
        </div>
      </section>

      <section className="debug-admin-json-section">
        <button
          type="button"
          className="debug-admin-json-toggle"
          aria-expanded={jsonExpanded}
          onClick={() => setJsonExpanded((v) => !v)}
        >
          <span>{jsonExpanded ? "▾" : "▸"} 配置源预览</span>
          <small>src/config/power-management.json</small>
        </button>
        {jsonExpanded ? (
          <div className="debug-admin-json-content">
            <pre>{configJson}</pre>
            <ConfigExportActions configJson={configJson} runtimeMode={runtimeMode} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function WorkbenchLayout({
  children
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  hideHeader?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="workbench-page">
      <div className="workbench-grid">{children}</div>
    </div>
  );
}

function MetricCard({ title, value, trend, tone }: { title: string; value: string; trend: string; tone: "blue" | "teal" | "purple" }) {
  return (
    <Card className={`metric-card ${tone}`} size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{trend}</p>
        <div className="metric-bar">
          <i />
        </div>
      </CardContent>
    </Card>
  );
}

function RiskBadge({ risk }: { risk: "High" | "Medium" | "Low" }) {
  return <UiBadge className={`risk-badge ${risk.toLowerCase()}`} variant="outline">{riskLabels[risk]}</UiBadge>;
}

function StatusBadge({ status }: { status: string }) {
  return <UiBadge className="status-badge" variant="secondary"><span />{formatWorkflowDisplayText(status)}</UiBadge>;
}

function SectionLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="section-label">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function PanelHeader({ title, meta }: { title: ReactNode; meta?: string }) {
  return (
    <div className="panel-header">
      <strong>{title}</strong>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function Timeline({
  steps,
  activeIndex,
  className
}: {
  steps: string[];
  activeIndex: number;
  className?: string;
}) {
  return (
    <div className={["timeline", className].filter(Boolean).join(" ")}>
      {steps.map((step, index) => (
        <div className={index <= activeIndex ? "done" : ""} key={step}>
          <span>{index < activeIndex ? <Check size={14} /> : index + 1}</span>
          <small>{formatWorkflowDisplayText(step)}</small>
        </div>
      ))}
    </div>
  );
}

function VerticalTimeline({ items }: { items: VerticalTimelineItem[] }) {
  return (
    <div className="vertical-timeline">
      {items.map(({ body, isCurrent, marker, time, title }) => (
        <div className={`vertical-timeline-item${isCurrent ? " vertical-timeline-item--current" : ""}`} key={`${time}-${title}`}>
          <span className="timeline-dot" />
          <div className="vertical-timeline-meta">
            <small>{time}</small>
            {marker ? <span className="vertical-timeline-current-badge">{marker}</span> : null}
          </div>
          <strong>{formatWorkflowDisplayText(title)}</strong>
          <p>{formatWorkflowDisplayText(body)}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Empty className="empty-state">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Info size={20} />
        </EmptyMedia>
        <EmptyTitle>暂无内容</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export default App;
