import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CircleOff,
  Download,
  FileSearch,
  FileText,
  Filter,
  History,
  Info,
  Lightbulb,
  ListChecks,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Play,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { WiseEffIcon } from "./components/WiseEffIcon";
import { createAgentPlan, getPageByPath, navigationItems, PageConfig, utilityItems } from "./appConfig";
import { ParameterManagementHomePage } from "./ParameterManagementHomePage";
import { ParameterComparisonPage } from "./ParameterComparison";
import type { HomepageTimeWindow } from "./parameterHomepageAnalytics";
import { DebuggingPage } from "./DebuggingPage";
import { LinearTemplateHome } from "./linear-template/LinearTemplateHome";
import {
  AuditEvent,
  ChangeRequest,
  derivePowerManagementRuntimeState,
  DebugParameter,
  DebugSnapshot,
  initialState,
  LogStageId,
  mockDataFingerprint,
  LogRecord,
  ParameterRecord,
  ParameterSubmissionItem,
  REVIEW_MOCK_NOW,
  projects,
  PrototypeState,
  RequestStatus,
  roles,
  STAGE_LABELS
} from "./mockData";
import { buildAISuggestion, buildImpactItems } from "./reviewMockData";
import {
  addDebugParameter,
  addProjectParameter,
  deleteDebugParameter,
  deleteProjectParameter,
  serializePowerManagementConfig,
  updateDebugParameter,
  updateProjectParameter,
  updateProjectParameterMetadata
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export type AppAction =
  | { type: "SET_PROJECT"; projectId: string }
  | { type: "SET_ROLE"; roleId: string }
  | { type: "ADD_CHANGE_REQUEST"; parameterId: string; targetValue: string; reason: string }
  | { type: "ADD_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[]; reason: string }
  | { type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND"; roundId: string }
  | { type: "ADVANCE_REVIEW"; requestId: string; fastTrack?: boolean; note?: string }
  | { type: "REJECT_REVIEW"; requestId: string; reason: string; fastTrack?: boolean }
  | { type: "TRANSFER_REVIEW"; requestId: string; to: string; note?: string }
  | { type: "UNDO_REVIEW_ACTION"; requestId: string; previousStatus: RequestStatus }
  | { type: "AI_FEEDBACK"; requestId: string; feedback: "up" | "down"; note?: string }
  | { type: "ADVANCE_LOG"; logId: string }
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
  | { type: "ADD_PROJECT_PARAMETER" }
  | { type: "DELETE_PROJECT_PARAMETER"; parameterId: string }
  | { type: "ADD_DEBUG_PARAMETER" }
  | { type: "DELETE_DEBUG_PARAMETER"; parameterId: string };

const homepageTimeWindowOptions: Array<{ value: HomepageTimeWindow; label: string }> = [
  { value: "7d", label: "7天" },
  { value: "30d", label: "30天" },
  { value: "180d", label: "180天" }
];

const parameterHomeQuickEntries = [
  { title: "项目参数工作台", path: "/parameters" },
  { title: "项目参数对比分析", path: "/parameter-comparison" },
  { title: "参数合入审核", path: "/parameter-review" },
  { title: "项目参数管理后台", path: "/parameter-admin" }
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

type ParameterValueDraft = {
  currentValue: string;
  recommendedValue: string;
  updatedAt: string;
};

type ParameterEditorDraft = {
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
  currentValue: string;
  targetValue: string;
  unit: string;
  range: string;
  risk: DebugParameter["risk"];
  status: DebugParameter["status"];
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

function displayTag(text: string) {
  if (text in riskLabels) {
    return riskLabels[text as keyof typeof riskLabels];
  }
  if (text in logStatusLabels) {
    return logStatusLabels[text as keyof typeof logStatusLabels];
  }
  return text;
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

export function reducer(state: PrototypeState, action: AppAction): PrototypeState {
  switch (action.type) {
    case "SET_PROJECT":
      return { ...state, activeProjectId: action.projectId };
    case "SET_ROLE":
      return { ...state, activeRoleId: action.roleId };
    case "ADD_CHANGE_REQUEST": {
      const parameter = state.parameters.find((item) => item.id === action.parameterId);
      if (!parameter) {
        return state;
      }
      const project = projects.find((item) => item.id === parameter.projectId);
      const submitter = roles.find((role) => role.id === state.activeRoleId)?.name ?? "平台用户";
      const roundId = `PRS-${2406 + state.parameterSubmissionRounds.length}`;
      const summary = action.reason || "WiseAgent 已生成影响摘要，建议参数管理员审阅后推进。";

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
        status: "待审阅",
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
            status: "待审阅",
            summary: `${parameter.name} 提交审阅。`,
            items: [submissionItem]
          },
          ...state.parameterSubmissionRounds
        ],
        notifications: [`已提交 ${request.id}，等待参数管理员审阅`, ...state.notifications]
      };
    }
    case "ADD_PARAMETER_SUBMISSION_ROUND": {
      const draftItems = action.items
        .map((item) => {
          const parameter = state.parameters.find((candidate) => candidate.id === item.parameterId);
          return parameter ? { parameter, item } : null;
        })
        .filter((item): item is { parameter: ParameterRecord; item: ParameterDraftItem } => Boolean(item));

      if (draftItems.length === 0) {
        return state;
      }

      const project = projects.find((item) => item.id === draftItems[0].parameter.projectId);
      const submitter = roles.find((role) => role.id === state.activeRoleId)?.name ?? "平台用户";
      const roundId = `PRS-${2406 + state.parameterSubmissionRounds.length}`;
      const requestSeed = 8910 + state.changeRequests.length;
      const requests = draftItems.map(({ parameter, item }, index): ChangeRequest => {
        const summary = item.reason || action.reason || "本轮参数修改已生成影响摘要，建议参数管理员按轮次审阅。";

        return {
          id: `PRQ-${requestSeed + index}`,
          submissionRoundId: roundId,
          projectId: parameter.projectId,
          parameterId: parameter.id,
          module: parameter.module,
          title: parameter.name,
          currentValue: parameter.currentValue,
          targetValue: item.targetValue,
          submitter,
          createdAt: "刚刚",
          status: "待审阅",
          ...buildRuntimeReviewFields(summary, parameter.module)
        };
      });
      const submissionItems = draftItems.map(({ parameter, item }, index): ParameterSubmissionItem => ({
        requestId: requests[index].id,
        parameterId: parameter.id,
        name: parameter.name,
        module: parameter.module,
        currentValue: parameter.currentValue,
        targetValue: item.targetValue,
        unit: parameter.unit,
        risk: parameter.risk,
        reason: item.reason || action.reason || "本轮参数修改已生成影响摘要，建议参数管理员按轮次审阅。"
      }));

      return {
        ...state,
        changeRequests: [...requests, ...state.changeRequests],
        parameterSubmissionRounds: [
          {
            id: roundId,
            projectId: draftItems[0].parameter.projectId,
            projectName: project?.name ?? draftItems[0].parameter.projectId,
            submitter,
            createdAt: "刚刚",
            status: "待审阅",
            summary: `本轮提交包含 ${submissionItems.length} 个参数修改。`,
            items: submissionItems
          },
          ...state.parameterSubmissionRounds
        ],
        notifications: [`已提交 ${roundId}，包含 ${submissionItems.length} 个参数修改`, ...state.notifications]
      };
    }
    case "WITHDRAW_PARAMETER_SUBMISSION_ROUND":
      return {
        ...state,
        parameterSubmissionRounds: state.parameterSubmissionRounds.map((round) =>
          round.id === action.roundId ? { ...round, status: "已撤回", summary: `${round.summary} 已由提交人撤回。` } : round
        ),
        changeRequests: state.changeRequests.map((request) =>
          request.submissionRoundId === action.roundId && request.status === "待审阅"
            ? { ...request, status: "已打回", rejectReason: "提交人已撤回本轮提交。" }
            : request
        ),
        notifications: [`${action.roundId} 已撤回`, ...state.notifications]
      };
    case "ADVANCE_REVIEW":
      return {
        ...state,
        changeRequests: state.changeRequests.map((request) =>
          request.id === action.requestId
            ? {
                ...request,
                status:
                  request.status === "待审阅"
                    ? "自动检查通过"
                    : request.status === "自动检查通过"
                      ? "等待合入"
                      : "已合入",
                fastTrack: action.fastTrack ?? request.fastTrack,
                reviewerNote: action.note ?? request.reviewerNote,
                updatedAt: new Date().toISOString()
              }
            : request
        ),
        notifications: [
          `${action.requestId} 已推进到下一流程节点${action.fastTrack ? "（快速通道）" : ""}`,
          ...state.notifications
        ]
      };
    case "REJECT_REVIEW":
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
        notifications: [
          `${action.requestId} 已打回修改${action.fastTrack ? "（快速通道）" : ""}：${action.reason}`,
          ...state.notifications
        ]
      };
    case "TRANSFER_REVIEW": {
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
    case "CONNECT_DEVICE": {
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
      return reducer(state, { type: "PUSH_DEBUG_VALUES", parameterIds: [action.parameterId] });
    case "PUSH_DEBUG_VALUES": {
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
      const removeIds = new Set(action.parameterIds);
      return {
        ...state,
        pushedDebugIds: state.pushedDebugIds.filter((id) => !removeIds.has(id))
      };
    }
    case "UPDATE_PROJECT_PARAMETER_METADATA": {
      const configDraft = updateProjectParameterMetadata(state.configDraft, action.projectId as never, action.parameterId, action.patch);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "UPDATE_PROJECT_PARAMETER_VALUE": {
      const configDraft = updateProjectParameter(state.configDraft, action.projectId as never, action.parameterId, action.patch);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "UPDATE_DEBUG_PARAMETER": {
      const configDraft = updateDebugParameter(state.configDraft, action.parameterId, action.patch);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "ADD_PROJECT_PARAMETER": {
      const configDraft = addProjectParameter(state.configDraft);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "DELETE_PROJECT_PARAMETER": {
      const configDraft = deleteProjectParameter(state.configDraft, action.parameterId);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "ADD_DEBUG_PARAMETER": {
      const configDraft = addDebugParameter(state.configDraft);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "DELETE_DEBUG_PARAMETER": {
      const configDraft = deleteDebugParameter(state.configDraft, action.parameterId);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "IMPORT_PARAMETERS":
      return {
        ...state,
        notifications: ["批量参数导入完成：新增 24 项，冲突 2 项已进入审计队列", ...state.notifications]
      };
    case "ADD_NOTIFICATION":
      return { ...state, notifications: [action.message, ...state.notifications] };
    default:
      return state;
  }
}

function App() {
  return (
    <TooltipProvider delayDuration={0}>
      <AppShell key={mockDataFingerprint} />
    </TooltipProvider>
  );
}

function AppShell() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [path, setPath] = useState(() => getPageByPath(window.location.pathname).path);
  const [search, setSearch] = useState(() => window.location.search);
  const [parameterHomeTimeWindow, setParameterHomeTimeWindow] = useState<HomepageTimeWindow>("30d");
  const [comparisonSelection, setComparisonSelection] = useState<ComparisonProjectSelection>(() => {
    const contextProjectId =
      getPageByPath(window.location.pathname).key === "parameter-comparison" ? getContextQuery(window.location.search).projectId : "";
    const baseProjectId = projects.some((project) => project.id === contextProjectId) ? contextProjectId : state.activeProjectId;

    return {
      baseProjectId,
      targetProjectId: getFallbackComparisonProjectId(baseProjectId)
    };
  });
  const page = getPageByPath(path);
  const agentPlan = useMemo(() => createAgentPlan(path), [path]);
  const isPlatformHome = page.key === "home";
  const isParameterHome = page.key === "parameter-home";

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

  useEffect(() => {
    const contextProjectId = page.key === "parameter-comparison" ? getContextQuery(search).projectId : "";
    if (contextProjectId && projects.some((project) => project.id === contextProjectId)) {
      return;
    }

    setComparisonSelection((current) => {
      const nextTargetProjectId =
        current.targetProjectId === state.activeProjectId
          ? getFallbackComparisonProjectId(state.activeProjectId)
          : current.targetProjectId;

      if (current.baseProjectId === state.activeProjectId && current.targetProjectId === nextTargetProjectId) {
        return current;
      }

      return {
        baseProjectId: state.activeProjectId,
        targetProjectId: nextTargetProjectId
      };
    });
  }, [page.key, search, state.activeProjectId]);

  const navigate = (nextPath: string) => {
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
  };

  const updateSearch = (nextSearch: string) => {
    const nextUrl = `${page.path}${nextSearch}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (nextUrl !== currentUrl) {
      window.history.pushState(null, "", nextUrl);
    }

    setSearch(nextSearch);
  };

  return (
    <div className={isPlatformHome ? "app-shell home-shell" : "app-shell"}>
      {!isPlatformHome ? <Sidebar activePath={page.path} onNavigate={navigate} /> : null}
      <div className={isPlatformHome ? "main-shell home-main-shell" : "main-shell"}>
        {!isPlatformHome ? (
          <TopBar
            state={state}
            dispatch={dispatch}
            page={page}
            parameterHomeTimeWindow={parameterHomeTimeWindow}
            onParameterHomeTimeWindowChange={setParameterHomeTimeWindow}
            onNavigate={navigate}
          />
        ) : null}
        {isPlatformHome ? (
          <div className="main-content home-content">
            <PageRouter
              page={page}
              state={state}
              dispatch={dispatch}
              onNavigate={navigate}
              search={search}
              parameterHomeTimeWindow={parameterHomeTimeWindow}
              comparisonSelection={comparisonSelection}
              onComparisonSelectionChange={setComparisonSelection}
              onSearchChange={updateSearch}
            />
          </div>
        ) : (
          <main className="main-content" aria-label={isParameterHome ? "参数管理首页" : undefined}>
            <PageRouter
              page={page}
              state={state}
              dispatch={dispatch}
              onNavigate={navigate}
              search={search}
              parameterHomeTimeWindow={parameterHomeTimeWindow}
              comparisonSelection={comparisonSelection}
              onComparisonSelectionChange={setComparisonSelection}
              onSearchChange={updateSearch}
            />
          </main>
        )}
      </div>
      {!isPlatformHome ? (
        <UnifiedAgent path={path} plan={agentPlan} state={state} dispatch={dispatch} comparisonSelection={comparisonSelection} />
      ) : null}
    </div>
  );
}

type ComparisonProjectSelection = {
  baseProjectId: string;
  targetProjectId: string;
};

type PageProps = {
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
  parameterHomeTimeWindow?: HomepageTimeWindow;
};

function PageRouter({
  page,
  state,
  dispatch,
  onNavigate,
  search,
  parameterHomeTimeWindow,
  comparisonSelection,
  onComparisonSelectionChange,
  onSearchChange
}: PageProps & {
  page: PageConfig;
  comparisonSelection: ComparisonProjectSelection;
  onComparisonSelectionChange: React.Dispatch<React.SetStateAction<ComparisonProjectSelection>>;
  onSearchChange: (search: string) => void;
}) {
  switch (page.key) {
    case "parameters":
      return <ParametersPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "parameter-submissions":
      return <ParameterSubmissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "parameter-home":
      return <ParameterManagementHomePage state={state} onNavigate={onNavigate} timeWindow={parameterHomeTimeWindow} />;
    case "parameter-comparison":
      return (
        <ParameterComparisonPage
          state={state}
          onNavigate={onNavigate}
          search={search}
          comparisonSelection={comparisonSelection}
          onComparisonSelectionChange={onComparisonSelectionChange}
          onSearchChange={onSearchChange}
        />
      );
    case "parameter-review":
      return <ParameterReviewPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "parameter-admin":
      return <ParameterAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "logs":
      return <LogsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "log-admin":
      return <LogAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "debugging":
      return <DebuggingPage state={state} dispatch={dispatch} />;
    case "debugging-admin":
      return <DebuggingAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    default:
      return <HomePage />;
  }
}

function Sidebar({ activePath, onNavigate }: { activePath: string; onNavigate: (path: string) => void }) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const pageTitle = getPageByPath(activePath).title;
  const groups = navigationItems.reduce<Record<string, PageConfig[]>>((acc, item) => {
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
          <div className="brand-subtitle">AI 驱动的企业业务效率平台</div>
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
        {utilityItems.map((item) => {
          const Icon = item.icon;
          return (
            <Tooltip key={item.label}>
              <TooltipTrigger asChild>
                <Button className="nav-item compact" type="button" variant="ghost">
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Button>
              </TooltipTrigger>
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
  parameterHomeTimeWindow,
  onParameterHomeTimeWindowChange,
  onNavigate
}: {
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  page: PageConfig;
  parameterHomeTimeWindow: HomepageTimeWindow;
  onParameterHomeTimeWindowChange: (value: HomepageTimeWindow) => void;
  onNavigate: (path: string) => void;
}) {
  const showProjectSelector =
    page.group === "参数管理" &&
    page.key !== "parameter-home" &&
    page.key !== "parameters" &&
    page.key !== "parameter-comparison" &&
    page.key !== "parameter-review" &&
    page.key !== "parameter-admin";

  return (
    <header className="topbar">
      <div className="topbar-page">
        <div className="topbar-title">{page.title}</div>
        <div className="topbar-subtitle">{page.subtitle}</div>
      </div>
      <div className="topbar-actions">
        {page.key === "parameter-home" ? (
          <>
            <nav className="parameter-homepage-topbar-nav" aria-label="参数管理快捷入口">
              {parameterHomeQuickEntries.map((entry) => (
                <Button key={entry.path} type="button" variant="outline" onClick={() => onNavigate(entry.path)}>
                  {entry.title}
                </Button>
              ))}
            </nav>
            <label className="topbar-time-window-control">
              <span>时间范围</span>
              <SelectControl
                ariaLabel="时间范围"
                value={parameterHomeTimeWindow}
                onValueChange={onParameterHomeTimeWindowChange}
                options={homepageTimeWindowOptions}
              />
            </label>
          </>
        ) : null}
        <div className="searchbox">
          <Search size={17} />
          <Input aria-label="搜索" placeholder="搜索..." />
        </div>
        {showProjectSelector ? (
          <SelectControl
            ariaLabel="项目"
            value={state.activeProjectId}
            onValueChange={(projectId) => dispatch({ type: "SET_PROJECT", projectId })}
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
          />
        ) : null}
        <Button className="icon-button" type="button" aria-label="通知" variant="outline" size="icon">
          <MessageSquareText size={18} />
          <span className="notification-dot" />
        </Button>
        <Avatar className="avatar">
          <AvatarFallback>
            <UserRound size={17} />
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}

function HomePage() {
  return <LinearTemplateHome />;
}

type ParameterRiskFilter = "All" | "High" | "Medium" | "Low";

function getFallbackComparisonProjectId(projectId: string) {
  return projects.find((project) => project.id !== projectId)?.id ?? projectId;
}

function getContextQuery(search: string) {
  const params = new URLSearchParams(search);
  return {
    projectId: params.get("project") ?? "",
    module: params.get("module") ?? "",
    parameterId: params.get("parameter") ?? ""
  };
}

function createComparisonInsights(state: PrototypeState, selection: ComparisonProjectSelection) {
  const baseProject = projects.find((project) => project.id === selection.baseProjectId) ?? projects[0];
  const targetProject = projects.find((project) => project.id === selection.targetProjectId) ?? projects[1] ?? projects[0];
  const baseParameters = state.parameters.filter((parameter) => parameter.projectId === baseProject.id);
  const targetParameters = state.parameters.filter((parameter) => parameter.projectId === targetProject.id);
  const targetByName = new Map(targetParameters.map((parameter) => [parameter.name, parameter]));
  const comparisonRows = baseParameters.map((baseParameter) => {
    const targetParameter = targetByName.get(baseParameter.name);

    return {
      key: baseParameter.name,
      risk: baseParameter.risk,
      status: targetParameter && targetParameter.currentValue === baseParameter.currentValue ? "synced" : "drift"
    };
  });
  const driftRows = comparisonRows.filter((row) => row.status === "drift");
  const primaryInsight = driftRows.find((row) => row.risk === "High") ?? driftRows[0] ?? comparisonRows[0];
  const secondaryInsight = driftRows.find((row) => row.key !== primaryInsight?.key) ?? comparisonRows[1] ?? primaryInsight;

  return {
    baseProject,
    targetProject,
    primaryInsight,
    secondaryInsight
  };
}

function escapeExcelCell(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function exportProjectParametersAsExcel(rows: ParameterRecord[], projectCode: string) {
  const headers = ["参数名称", "模块", "当前值", "示例", "范围 / 单位", "重要性", "更新时间"];
  const tableRows = rows
    .map(
      (parameter) => `
        <tr>
          <td>${escapeExcelCell(parameter.name)}</td>
          <td>${escapeExcelCell(parameter.module)}</td>
          <td>${escapeExcelCell(parameter.currentValue)}</td>
          <td>${escapeExcelCell(parameter.recommendedValue)}</td>
          <td>${escapeExcelCell(`${parameter.range} ${parameter.unit}`.trim())}</td>
          <td>${riskLabels[parameter.risk]}</td>
          <td>${escapeExcelCell(parameter.updatedAt)}</td>
        </tr>`
    )
    .join("");
  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectCode}-project-parameters.xls`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ParametersPage({ state, dispatch, onNavigate, search }: PageProps) {
  const [riskFilter, setRiskFilter] = useState<ParameterRiskFilter>("All");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(state.parameters[0]?.id ?? "");
  const [targetValue, setTargetValue] = useState("80");
  const [reason, setReason] = useState("参考 Agent 巡检建议，将高风险参数回落到安全阈值内。");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [draftItems, setDraftItems] = useState<ParameterDraftItem[]>([]);
  const projectParameters = useMemo(
    () => state.parameters.filter((parameter) => parameter.projectId === state.activeProjectId),
    [state.activeProjectId, state.parameters]
  );
  const moduleOptions = useMemo(
    () => Array.from(new Set(projectParameters.map((parameter) => parameter.module))),
    [projectParameters]
  );
  const parameters = projectParameters.filter(
    (parameter) =>
      (riskFilter === "All" || parameter.risk === riskFilter) && (moduleFilter === "All" || parameter.module === moduleFilter)
  );
  const selected = parameters.find((parameter) => parameter.id === selectedId) ?? parameters[0];
  const activeProject = projects.find((project) => project.id === state.activeProjectId) ?? projects[0];
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
  const pendingSubmissionItems = useMemo(
    () =>
      draftItems
        .map((item) => {
          const parameter = state.parameters.find((candidate) => candidate.id === item.parameterId);
          return parameter ? { ...item, parameter } : null;
        })
        .filter((item): item is ParameterDraftItem & { parameter: ParameterRecord } => Boolean(item)),
    [draftItems, state.parameters]
  );

  useEffect(() => {
    if (contextQuery.projectId) {
      return;
    }
    setModuleFilter("All");
  }, [contextQuery.projectId, state.activeProjectId]);

  useEffect(() => {
    if (contextQuery.projectId && projects.some((project) => project.id === contextQuery.projectId) && contextQuery.projectId !== state.activeProjectId) {
      dispatch({ type: "SET_PROJECT", projectId: contextQuery.projectId });
    }
  }, [contextQuery.projectId, dispatch, state.activeProjectId]);

  useEffect(() => {
    if (!contextQuery.module) {
      return;
    }
    if (moduleOptions.includes(contextQuery.module)) {
      setModuleFilter(contextQuery.module);
    }
  }, [contextQuery.module, moduleOptions]);

  useEffect(() => {
    if (!contextQuery.parameterId) {
      return;
    }
    const requestedParameter = projectParameters.find((parameter) => parameter.id === contextQuery.parameterId);
    if (requestedParameter) {
      setSelectedId(requestedParameter.id);
      setTargetValue(requestedParameter.recommendedValue);
    }
  }, [contextQuery.parameterId, projectParameters]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    setSelectedId(selected.id);
    setTargetValue(draftItems.find((item) => item.parameterId === selected.id)?.targetValue ?? selected.recommendedValue);
  }, [draftItems, selected?.id, selected?.recommendedValue]);

  useEffect(() => {
    setDraftItems((items) => items.filter((item) => projectParameters.some((parameter) => parameter.id === item.parameterId)));
  }, [projectParameters]);

  const addSelectedToRound = () => {
    if (!selected) {
      return;
    }
    setDraftItems((items) => {
      const draftItem = { parameterId: selected.id, targetValue, reason };
      return items.some((item) => item.parameterId === selected.id)
        ? items.map((item) => (item.parameterId === selected.id ? draftItem : item))
        : [...items, draftItem];
    });
  };

  const openSubmitPreview = () => {
    if (draftItems.length === 0) {
      addSelectedToRound();
    }
    setConfirmOpen(true);
  };

  const submitRound = () => {
    const itemsToSubmit = draftItems.length > 0 ? draftItems : selected ? [{ parameterId: selected.id, targetValue, reason }] : [];
    if (itemsToSubmit.length === 0) {
      return;
    }
    dispatch({ type: "ADD_PARAMETER_SUBMISSION_ROUND", items: itemsToSubmit, reason });
    setDraftItems([]);
    setConfirmOpen(false);
  };
  const previewItems =
    pendingSubmissionItems.length > 0
      ? pendingSubmissionItems
      : selected
        ? [{ parameterId: selected.id, targetValue, reason, parameter: selected }]
        : [];

  return (
    <WorkbenchLayout
      title="项目参数用户工作台"
      actions={
        <>
          <Button variant="outline" type="button" onClick={() => exportProjectParametersAsExcel(parameters, activeProject.code)}>
            <Download size={16} />
            导出 Excel
          </Button>
          <Button variant="outline" type="button" onClick={() => onNavigate("/parameter-submissions")}>
            <History size={16} />
            历史提交
          </Button>
          <Button variant="outline" type="button" onClick={() => onNavigate("/parameter-comparison")}>
            <ArrowRight size={16} />
            跨项目对比
          </Button>
        </>
      }
    >
      <aside className="filter-panel" aria-label="参数筛选">
        <SectionLabel icon={<Filter size={16} />} label="筛选条件" />
        <Label className="field-label" htmlFor="parameter-project-filter">
          项目
        </Label>
        <SelectControl
          id="parameter-project-filter"
          className="filter-select"
          value={state.activeProjectId}
          onValueChange={(projectId) => dispatch({ type: "SET_PROJECT", projectId })}
          options={projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))}
        />
        <Label className="field-label" htmlFor="parameter-risk-filter">
          重要性
        </Label>
        <SelectControl
          id="parameter-risk-filter"
          className="filter-select"
          value={riskFilter}
          onValueChange={setRiskFilter}
          options={([
            ["All", "全部"],
            ["High", "高"],
            ["Medium", "中"],
            ["Low", "低"]
          ] as const).map(([value, label]) => ({ value, label }))}
        />
        <Label className="field-label" htmlFor="parameter-module-filter">
          模块
        </Label>
        <SelectControl
          id="parameter-module-filter"
          className="filter-select"
          value={moduleFilter}
          onValueChange={setModuleFilter}
          options={["All", ...moduleOptions].map((module) => ({ value: module, label: module === "All" ? "全部" : module }))}
        />
      </aside>
      <section className="workbench-main">
        <DataTable
          headers={["参数名称", "模块", "当前值", "示例", "范围 / 单位", "重要性", "更新时间"]}
          rows={parameters}
          renderRow={(parameter) => (
            <TableRow
              className={selected?.id === parameter.id ? "selected-row" : ""}
              key={parameter.id}
              onClick={() => {
                setSelectedId(parameter.id);
                setTargetValue(parameter.recommendedValue);
              }}
            >
              <TableCell>
                <strong>{parameter.name}</strong>
                <small>{parameter.description}</small>
              </TableCell>
              <TableCell>
                <Badge tone="tertiary">{parameter.module}</Badge>
              </TableCell>
              <TableCell className="mono">{parameter.currentValue}</TableCell>
              <TableCell className="mono recommended">
                <span className="value-change">
                  <ArrowRight size={14} />
                  <span>{parameter.recommendedValue}</span>
                </span>
              </TableCell>
              <TableCell>
                <span>{parameter.range}</span>
                <small>{parameter.unit}</small>
              </TableCell>
              <TableCell>
                <RiskBadge risk={parameter.risk} />
              </TableCell>
              <TableCell>{parameter.updatedAt}</TableCell>
            </TableRow>
          )}
        />
      </section>
      <aside className="detail-panel">
        <SectionLabel icon={<Sparkles size={16} />} label="修改草稿" />
        {selected ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              openSubmitPreview();
            }}
          >
            <div className="detail-heading">
              <strong>{selected.name}</strong>
              <RiskBadge risk={selected.risk} />
            </div>
            <div className="parameter-info-card">
              <SectionLabel icon={<Info size={15} />} label="参数说明" />
              <p>{selected.explanation}</p>
            </div>
            <div className="parameter-info-card">
              <SectionLabel icon={<FileText size={15} />} label="参数配置格式" />
              <code>{selected.configFormat}</code>
            </div>
            <Label className="field-label" htmlFor="target-value">
              目标值
            </Label>
            <Input id="target-value" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} />
            <Label className="field-label" htmlFor="reason">
              修改原因
            </Label>
            <Textarea id="reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={5} />
            <div className="round-draft-panel" aria-label="本轮提交草稿">
              <div>
                <strong>本轮提交 {draftItems.length} 项</strong>
                <span>可先收集多个参数，再统一提交审阅。</span>
              </div>
              {pendingSubmissionItems.length > 0 ? (
                <ul>
                  {pendingSubmissionItems.map((item) => (
                    <li key={item.parameterId}>
                      <span>{item.parameter.name}</span>
                      <strong>{item.parameter.currentValue} → {item.targetValue}</strong>
                      <Button
                        className="link-button"
                        type="button"
                        variant="link"
                        onClick={() => setDraftItems((items) => items.filter((draftItem) => draftItem.parameterId !== item.parameterId))}
                      >
                        移除
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Timeline steps={["选择参数", "填写目标值", "提交审阅", "管理员合入"]} activeIndex={1} />
            <Button className="full" type="button" variant="outline" onClick={addSelectedToRound}>
              <ListChecks size={16} />
              加入本轮
            </Button>
            <Button className="full" type="submit">
              提交参数修改请求
            </Button>
          </form>
        ) : (
          <EmptyState text="请选择一条参数后提交修改。" />
        )}
      </aside>
      {confirmOpen && selected ? (
        <ParameterSubmissionDialog
          items={previewItems}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={submitRound}
        />
      ) : null}
    </WorkbenchLayout>
  );
}

function ParameterSubmissionDialog({
  items,
  onCancel,
  onConfirm
}: {
  items: Array<ParameterDraftItem & { parameter: ParameterRecord }>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <DialogContent className="submission-dialog">
        <DialogHeader className="submission-dialog-head">
          <div>
            <span className="eyebrow">参数提交预览</span>
            <DialogTitle>提交本轮参数</DialogTitle>
            <DialogDescription>本轮提交包含 {items.length} 个参数修改，确认后会按一轮提交进入历史记录，并拆分为管理员审阅队列中的参数项。</DialogDescription>
          </div>
          <Badge tone="secondary">Diff 预览</Badge>
        </DialogHeader>
        <div className="submission-diff-list">
          {items.map((item) => (
            <Card className="submission-diff-card" key={item.parameterId} size="sm">
              <CardHeader>
                <CardTitle>{item.parameter.name}</CardTitle>
                <CardDescription>{item.parameter.module} · {riskLabels[item.parameter.risk]}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="diff-values">
                  <span className="diff-before">{item.parameter.currentValue}{item.parameter.unit}</span>
                  <ArrowRight size={16} />
                  <span className="diff-after">{item.targetValue}{item.parameter.unit}</span>
                </div>
                <p>{item.reason}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <DialogFooter className="dialog-actions">
          <Button variant="outline" type="button" onClick={onCancel}>
            返回修改
          </Button>
          <Button type="button" onClick={onConfirm}>
            确认提交本轮
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ParameterSubmissionsPage({ state, dispatch, onNavigate }: PageProps) {
  const myName = roles.find((role) => role.id === state.activeRoleId)?.name ?? "平台用户";
  const myRounds = state.parameterSubmissionRounds.filter((round) => round.submitter === myName);
  const [selectedRoundId, setSelectedRoundId] = useState(myRounds[0]?.id ?? "");
  const selectedRound = myRounds.find((round) => round.id === selectedRoundId) ?? myRounds[0];

  useEffect(() => {
    if (!myRounds.some((round) => round.id === selectedRoundId)) {
      setSelectedRoundId(myRounds[0]?.id ?? "");
    }
  }, [myRounds, selectedRoundId]);

  return (
    <div className="submission-history-page">
      <header className="page-header">
        <div>
          <Breadcrumb className="breadcrumb" aria-label="历史提交路径">
            <BreadcrumbList>
              <BreadcrumbItem>
                <Button type="button" variant="link" onClick={() => onNavigate("/parameters")}>参数工作台</Button>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>历史提交</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1>我的历史提交</h1>
          <p>以“一轮提交”为单位查看你发起的参数修改，待审阅轮次可模拟撤回。</p>
        </div>
        <div className="page-actions">
          <Button variant="outline" type="button" onClick={() => onNavigate("/parameters")}>
            <ArrowRight size={16} />
            返回工作台
          </Button>
        </div>
      </header>
      <section className="comparison-summary">
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
              <span>{round.status} · {round.items.length} 项 · {round.createdAt}</span>
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
                <p>{selectedRound.summary}</p>
              </div>
              <div className="submission-diff-list history-diff-list">
                {selectedRound.items.map((item) => (
                  <article className="submission-diff-card" key={item.requestId}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.module} · {riskLabels[item.risk]} · {item.requestId}</small>
                    </div>
                    <div className="diff-values">
                      <span className="diff-before">{item.currentValue}{item.unit}</span>
                      <ArrowRight size={16} />
                      <span className="diff-after">{item.targetValue}{item.unit}</span>
                    </div>
                    <p>{item.reason}</p>
                  </article>
                ))}
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


function ParameterReviewPage({ state, dispatch, search }: PageProps) {
  const [selectedId, setSelectedId] = useState(state.changeRequests[0]?.id ?? "");
  const [rejectOpen, setRejectOpen] = useState(false);
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
  const selected = state.changeRequests.find((request) => request.id === selectedId) ?? state.changeRequests[0];

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
      setSelectedId(matchingRequest.id);
    }
  }, [contextQuery.module, contextQuery.projectId, state.changeRequests, state.parameters]);

  const rejectSelected = (reason: string) => {
    if (!selected) {
      return;
    }
    dispatch({ type: "REJECT_REVIEW", requestId: selected.id, reason });
    setRejectOpen(false);
  };

  return (
    <WorkbenchLayout
      title="参数管理员工作台"
      subtitle="审阅参数变更队列，结合 AI 摘要和时间线推进合入上库流程。"
      actions={
        <Button variant="outline" type="button">
          <Filter size={16} />
          筛选队列
        </Button>
      }
    >
      <section className="review-queue">
        <PanelHeader title="待审阅请求" meta={`${state.changeRequests.length} 项操作`} />
        <DataTable
          headers={["请求编号", "模块", "提交人", "变更", "状态"]}
          rows={state.changeRequests}
          renderRow={(request) => (
            <TableRow
              className={request.id === selected?.id ? "selected-row" : ""}
              key={request.id}
              onClick={() => setSelectedId(request.id)}
            >
              <TableCell className="mono">{request.id}</TableCell>
              <TableCell>{request.module}</TableCell>
              <TableCell>{request.submitter}</TableCell>
              <TableCell className="change-cell">
                <span className="value-change">
                  <span className="strike">{request.currentValue}</span>
                  <ArrowRight size={14} />
                  <strong>{request.targetValue}</strong>
                </span>
              </TableCell>
              <TableCell>
                <StatusBadge status={request.status} />
              </TableCell>
            </TableRow>
          )}
        />
      </section>
      <aside className="review-detail" aria-label="审阅详情">
        {selected ? (
          <>
            <div className="detail-card">
              <span className="eyebrow">{selected.id}</span>
              <h2>{selected.title}</h2>
              <p>
                目标模块为 <strong>{selected.module}</strong>，由 {selected.submitter} 提交。
              </p>
            </div>
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
              <VerticalTimeline
                items={[
                  ["现在", selected.status, selected.rejectReason ?? "等待管理员确认和流程推进。"],
                  ["2 小时前", "自动检查通过", "回归检查与阈值校验通过。"],
                  ["昨天", "请求已提交", `提交人：${selected.submitter}。`]
                ]}
              />
            </div>
            <div className="action-panel">
              <Button className="full" type="button" onClick={() => dispatch({ type: "ADVANCE_REVIEW", requestId: selected.id })}>
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
          <EmptyState text="当前没有待审阅请求。" />
        )}
      </aside>
      {rejectOpen && selected ? (
        <RejectReviewDialog request={selected} onCancel={() => setRejectOpen(false)} onSubmit={rejectSelected} />
      ) : null}
    </WorkbenchLayout>
  );
}

function RejectReviewDialog({
  request,
  onCancel,
  onSubmit
}: {
  request: ChangeRequest;
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
            将 {request.id} 打回给提交人，管理员需要填写明确原因，方便项目侧补充测试数据或重新调整目标值。
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

function ConfigExportActions({ configJson }: { configJson: string }) {
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

function ConfigExportPanel({ configJson }: { configJson: string }) {
  return (
    <div className="config-preview-panel">
      <PanelHeader title="配置源预览" meta="src/config/power-management.json" />
      <pre>{configJson}</pre>
      <ConfigExportActions configJson={configJson} />
    </div>
  );
}

function ParameterAdminPage({ state, dispatch }: PageProps) {
  const [selectedParameterId, setSelectedParameterId] = useState(state.configDraft.parameterLibrary[0]?.id ?? "");
  const selectedParameter =
    state.configDraft.parameterLibrary.find((parameter) => parameter.id === selectedParameterId) ?? state.configDraft.parameterLibrary[0];
  const configJson = useMemo(() => serializePowerManagementConfig(state.configDraft), [state.configDraft]);
  const actionControls = (
    <div className="config-toolbar-actions">
      <Button type="button" onClick={() => dispatch({ type: "IMPORT_PARAMETERS" })}>
        <Upload size={16} />
        批量参数导入
      </Button>
      <ConfigExportActions configJson={configJson} />
    </div>
  );

  useEffect(() => {
    if (!state.configDraft.parameterLibrary.some((parameter) => parameter.id === selectedParameterId)) {
      setSelectedParameterId(state.configDraft.parameterLibrary[0]?.id ?? "");
    }
  }, [selectedParameterId, state.configDraft.parameterLibrary]);

  const updateMetadata = (patch: Partial<ParameterEditorDraft>) => {
    if (!selectedParameter) {
      return;
    }
    dispatch({
      type: "UPDATE_PROJECT_PARAMETER_METADATA",
      projectId: state.configDraft.projects[0]?.id ?? state.activeProjectId,
      parameterId: selectedParameter.id,
      patch
    });
  };

  const updateValue = (projectId: string, patch: Partial<ParameterValueDraft>) => {
    if (!selectedParameter) {
      return;
    }
    dispatch({
      type: "UPDATE_PROJECT_PARAMETER_VALUE",
      projectId,
      parameterId: selectedParameter.id,
      patch
    });
  };

  const updateRecommendedValue = (recommendedValue: string) => {
    if (!selectedParameter) {
      return;
    }
    state.configDraft.projects.forEach((project) => {
      dispatch({
        type: "UPDATE_PROJECT_PARAMETER_VALUE",
        projectId: project.id,
        parameterId: selectedParameter.id,
        patch: { recommendedValue }
      });
    });
  };

  return (
    <AdminPageScaffold
      title="项目参数管理后台"
      subtitle="编辑项目内配置源，参数工作台和对比分析页会同步读取当前草稿。"
      metrics={[
        ["共享参数", `${state.configDraft.parameterLibrary.length}`, "所有项目共用一份参数库"],
        ["项目值", `${state.configDraft.projects.length} 组`, "只维护每个项目的实际取值"],
        ["配置草稿", "可写入", "可直接保存到 JSON 文件"],
        ["高重要性", `${state.configDraft.parameterLibrary.filter((parameter) => parameter.risk === "High").length}`, "需要管理员复核"]
      ]}
      action={actionControls}
    >
      <section className="config-admin-grid">
        <div className="library-panel config-list-panel">
          <PanelHeader title="项目共享参数库" meta={`${state.configDraft.parameterLibrary.length} 项`} />
          <div className="config-list-actions">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                dispatch({ type: "ADD_PROJECT_PARAMETER" });
                setSelectedParameterId(`new-power-parameter-${state.configDraft.parameterLibrary.length + 1}`);
              }}
            >
              新增参数
            </Button>
            <Button
              variant="destructive"
              type="button"
              disabled={!selectedParameter || state.configDraft.parameterLibrary.length <= 1}
              onClick={() => {
                if (!selectedParameter) {
                  return;
                }
                dispatch({ type: "DELETE_PROJECT_PARAMETER", parameterId: selectedParameter.id });
                setSelectedParameterId(state.configDraft.parameterLibrary.find((parameter) => parameter.id !== selectedParameter.id)?.id ?? "");
              }}
            >
              删除参数
            </Button>
          </div>
          <div className="library-list project-parameter-library-list">
            {state.configDraft.parameterLibrary.map((parameter) => (
              <Button
                className={
                  parameter.id === selectedParameter?.id
                    ? "config-list-row project-parameter-list-row selected"
                    : "config-list-row project-parameter-list-row"
                }
                key={parameter.id}
                type="button"
                variant="ghost"
                onClick={() => setSelectedParameterId(parameter.id)}
              >
                <span className="project-parameter-list-row-main">
                  <strong>{parameter.name}</strong>
                  <small>{parameter.module}</small>
                </span>
                <RiskBadge risk={parameter.risk} />
              </Button>
            ))}
          </div>
        </div>

        <div className="config-editor-panel project-config-editor">
          {selectedParameter ? (
            <>
              <section className="shared-definition-panel" aria-label="共享参数定义">
                <PanelHeader title="共享参数定义" meta="所有项目共用" />
                <div className="config-form-grid">
                  <Label>
                    参数名称
                    <Input value={selectedParameter.name} onChange={(event) => updateMetadata({ name: event.target.value })} />
                  </Label>
                  <Label>
                    模块
                    <Input value={selectedParameter.module} onChange={(event) => updateMetadata({ module: event.target.value })} />
                  </Label>
                  <Label>
                    推荐值
                    <Input
                      aria-label="参数推荐值"
                      value={selectedParameter.values[state.configDraft.projects[0]?.id ?? state.activeProjectId]?.recommendedValue ?? ""}
                      onChange={(event) => updateRecommendedValue(event.target.value)}
                    />
                  </Label>
                  <Label>
                    范围
                    <Input value={selectedParameter.range} onChange={(event) => updateMetadata({ range: event.target.value })} />
                  </Label>
                  <Label>
                    单位
                    <Input value={selectedParameter.unit} onChange={(event) => updateMetadata({ unit: event.target.value })} />
                  </Label>
                  <Label>
                    重要性
                    <SelectControl
                      value={selectedParameter.risk}
                      onValueChange={(risk) => updateMetadata({ risk })}
                      options={[
                        { value: "High", label: "高" },
                        { value: "Medium", label: "中" },
                        { value: "Low", label: "低" }
                      ]}
                    />
                  </Label>
                  <Label className="wide">
                    展示描述
                    <Textarea value={selectedParameter.description} onChange={(event) => updateMetadata({ description: event.target.value })} rows={3} />
                  </Label>
                  <Label className="wide">
                    参数解释
                    <Textarea value={selectedParameter.explanation} onChange={(event) => updateMetadata({ explanation: event.target.value })} rows={4} />
                  </Label>
                  <Label className="wide">
                    配置格式
                    <Textarea value={selectedParameter.configFormat} onChange={(event) => updateMetadata({ configFormat: event.target.value })} rows={3} />
                  </Label>
                </div>
              </section>

              <section className="project-value-matrix" aria-label="项目参数值矩阵">
                <PanelHeader title="项目参数值矩阵" meta="每个项目独立取值" />
                <p>所有项目共用同一条参数定义，只在这里维护各项目的实际值。</p>
                <div className="project-value-table">
                  <div className="project-value-head">
                    <span>项目</span>
                    <span>当前值</span>
                    <span>更新时间</span>
                  </div>
                  {state.configDraft.projects.map((project) => {
                    const value = selectedParameter.values[project.id];
                    return (
                      <div className="project-value-row" key={project.id}>
                        <div>
                          <strong>{project.code}</strong>
                          <small>{project.name}</small>
                        </div>
                        <Label>
                          <span>{project.code} 当前值</span>
                          <Input
                            aria-label={`${project.code} 当前值`}
                            value={value.currentValue}
                            onChange={(event) => updateValue(project.id, { currentValue: event.target.value })}
                          />
                        </Label>
                        <Label>
                          <span>{project.code} 更新时间</span>
                          <Input
                            aria-label={`${project.code} 更新时间`}
                            value={value.updatedAt}
                            onChange={(event) => updateValue(project.id, { updatedAt: event.target.value })}
                          />
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <EmptyState text="请选择一个项目参数。" />
          )}
        </div>

      </section>
    </AdminPageScaffold>
  );
}

function LogsPage({ state }: PageProps) {
  const [selectedLogId, setSelectedLogId] = useState(state.logs[0]?.id ?? "");
  const [unsupportedDialogOpen, setUnsupportedDialogOpen] = useState(false);
  const activeLog = state.logs.find((log) => log.id === selectedLogId) ?? state.logs[0];
  const stages: LogStageId[] = ["parse", "pattern", "rootcause", "report"];
  const stageIndex = stages.indexOf(activeLog.stage);
  const evidenceInsights = activeLog.evidence.map((evidence, index) => ({
    id: evidence.id,
    label: `证据 ${String(index + 1).padStart(2, "0")}`,
    stage: STAGE_LABELS[evidence.stageId],
    source: activeLog.rawLines[evidence.lineNumbers[0] - 1] ?? "",
    inferred: evidence.inference,
    action: evidence.suggestedAction
  }));

  return (
    <WorkbenchLayout title="日志智能分析" subtitle="上传日志并观察 AI 自动化分析过程、证据链和处置线索。">
      <section className="logs-left">
        <Button className="upload-zone" type="button" variant="outline" onClick={() => setUnsupportedDialogOpen(true)}>
          <Upload size={34} />
          <strong>拖放日志文件到此处</strong>
          <span>点击模拟上传不支持格式日志</span>
        </Button>
        <div className="detail-card">
          <SectionLabel
            icon={<Loader2 size={16} className={activeLog.status === "Processing" ? "spin" : ""} />}
            label={`${logStatusLabels[activeLog.status]}：${activeLog.fileName}`}
          />
          <Timeline steps={stages.map((stage) => STAGE_LABELS[stage])} activeIndex={stageIndex} />
        </div>
        <section className="analysis-card" aria-label="分析结果">
          <PanelHeader title="分析结果" meta={logStatusLabels[activeLog.status]} />
          <div className="analysis-grid">
            <div className="raw-log-panel">
              <SectionLabel icon={<FileSearch size={16} />} label="结论摘要" />
              <p className="result-copy">{activeLog.conclusion}</p>
              <SectionLabel icon={<FileText size={16} />} label="原始日志内容" />
              <div className="evidence-box">
                {activeLog.evidence.map((evidence, index) => (
                  <div className="raw-log-line" key={evidence.id}>
                    <span>{String(evidence.lineNumbers[0] ?? index + 1).padStart(2, "0")}</span>
                    <code>{activeLog.rawLines[evidence.lineNumbers[0] - 1] ?? ""}</code>
                  </div>
                ))}
              </div>
            </div>
            <div className="evidence-chain">
              <SectionLabel icon={<ListChecks size={16} />} label="日志分析证据链" />
              <div className="evidence-chain-list">
                {evidenceInsights.map((item) => (
                  <article className="evidence-chain-item" key={item.id}>
                    <div className="evidence-chain-marker">
                      <span>{item.label}</span>
                      <strong>{item.stage}</strong>
                    </div>
                    <div className="evidence-chain-body">
                      <code>{item.source}</code>
                      <p>{item.inferred}</p>
                      <small>关联处置：{item.action}</small>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      </section>
      <aside className="history-panel" aria-label="历史日志记录">
        <PanelHeader title="历史日志记录" />
        {state.logs.map((log) => (
          <Button
            aria-pressed={log.id === activeLog.id}
            className={log.id === activeLog.id ? "history-item active" : "history-item"}
            key={log.id}
            type="button"
            variant="ghost"
            onClick={() => setSelectedLogId(log.id)}
          >
            <strong>{log.fileName}</strong>
            <span>{logStatusLabels[log.status]} · {log.confidence}%</span>
          </Button>
        ))}
      </aside>
      {unsupportedDialogOpen ? (
        <ConfirmDialog
          title="不支持的日志格式"
          message="system_dump.bin 无法处理，请上传 .log、.txt 或 .json。"
          cancelLabel="关闭"
          confirmLabel="知道了"
          onCancel={() => setUnsupportedDialogOpen(false)}
          onConfirm={() => setUnsupportedDialogOpen(false)}
        />
      ) : null}
    </WorkbenchLayout>
  );
}

function LogAdminPage({ state }: PageProps) {
  return (
    <AdminPageScaffold
      title="日志分析管理后台"
      subtitle="查看日志分析应用指标、处理记录、失败文件和后台权限配置。"
      metrics={[
        ["今日分析", "42", "较昨日 +18%"],
        ["平均置信度", "91%", "完成记录均值"],
        ["失败文件", `${state.logs.filter((log) => log.status === "Failed").length}`, "格式或大小异常"],
        ["吞吐峰值", "1.2GB", "nginx_access.log.gz"]
      ]}
    >
      <section className="admin-grid two">
        <LibraryPanel title="分析记录概览" items={state.logs.map((log) => [log.fileName, STAGE_LABELS[log.stage], log.status])} />
        <AuditPanel events={state.auditEvents.filter((event) => event.app === "logs" || event.app === "log-admin")} />
      </section>
    </AdminPageScaffold>
  );
}

function DebuggingAdminPage({ state, dispatch }: PageProps) {
  const [selectedParameterId, setSelectedParameterId] = useState(state.configDraft.debugParameters[0]?.id ?? "");
  const selectedParameter =
    state.configDraft.debugParameters.find((parameter) => parameter.id === selectedParameterId) ?? state.configDraft.debugParameters[0];
  const configJson = useMemo(() => serializePowerManagementConfig(state.configDraft), [state.configDraft]);

  useEffect(() => {
    if (!state.configDraft.debugParameters.some((parameter) => parameter.id === selectedParameterId)) {
      setSelectedParameterId(state.configDraft.debugParameters[0]?.id ?? "");
    }
  }, [selectedParameterId, state.configDraft.debugParameters]);

  const updateDebug = (patch: Partial<DebugParameterEditorDraft>) => {
    if (!selectedParameter) {
      return;
    }
    dispatch({ type: "UPDATE_DEBUG_PARAMETER", parameterId: selectedParameter.id, patch });
  };

  return (
    <AdminPageScaffold
      title="参数调试管理后台"
      subtitle="编辑可调参数配置源，调试平台会同步读取当前草稿。"
      metrics={[
        ["在线设备", `${state.devices.filter((device) => device.status === "已连接").length}/${state.devices.length}`, "演示样机池"],
        ["可调参数", `${state.debugParameters.length}`, "由配置源生成"],
        ["高风险策略", `${state.debugParameters.filter((parameter) => parameter.risk === "High").length}`, "需要二次确认"],
        ["配置草稿", "可写入", "可直接保存到 JSON 文件"]
      ]}
    >
      <section className="config-admin-grid">
        <div className="library-panel config-list-panel">
          <PanelHeader title="可调参数目录" meta={`${state.configDraft.debugParameters.length} 项`} />
          <div className="config-list-actions">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                dispatch({ type: "ADD_DEBUG_PARAMETER" });
                setSelectedParameterId(`dbg-new-parameter-${state.configDraft.debugParameters.length + 1}`);
              }}
            >
              新增可调参数
            </Button>
            <Button
              variant="destructive"
              type="button"
              disabled={!selectedParameter || state.configDraft.debugParameters.length <= 1}
              onClick={() => {
                if (!selectedParameter) {
                  return;
                }
                dispatch({ type: "DELETE_DEBUG_PARAMETER", parameterId: selectedParameter.id });
                setSelectedParameterId(state.configDraft.debugParameters.find((parameter) => parameter.id !== selectedParameter.id)?.id ?? "");
              }}
            >
              删除可调参数
            </Button>
          </div>
          <div className="library-list">
            {state.configDraft.debugParameters.map((parameter) => (
              <Button
                className={parameter.id === selectedParameter?.id ? "config-list-row selected" : "config-list-row"}
                key={parameter.id}
                type="button"
                variant="ghost"
                onClick={() => setSelectedParameterId(parameter.id)}
              >
                <span>
                  <strong>{parameter.name}</strong>
                  <small>{parameter.key}</small>
                </span>
                <RiskBadge risk={parameter.risk} />
              </Button>
            ))}
          </div>
        </div>

        <div className="config-editor-panel">
          <PanelHeader title="调试参数编辑" meta="实时下发目录" />
          {selectedParameter ? (
            <div className="config-form-grid">
              <Label>
                参数名称
                <Input value={selectedParameter.name} onChange={(event) => updateDebug({ name: event.target.value })} />
              </Label>
              <Label>
                参数 key
                <Input value={selectedParameter.key} onChange={(event) => updateDebug({ key: event.target.value })} />
              </Label>
              <Label>
                当前值
                <Input value={selectedParameter.currentValue} onChange={(event) => updateDebug({ currentValue: event.target.value })} />
              </Label>
              <Label>
                目标值
                <Input
                  aria-label="调试目标值"
                  value={selectedParameter.targetValue}
                  onChange={(event) => updateDebug({ targetValue: event.target.value })}
                />
              </Label>
              <Label>
                范围
                <Input value={selectedParameter.range} onChange={(event) => updateDebug({ range: event.target.value })} />
              </Label>
              <Label>
                单位
                <Input value={selectedParameter.unit} onChange={(event) => updateDebug({ unit: event.target.value })} />
              </Label>
              <Label>
                重要性
                <SelectControl
                  value={selectedParameter.risk}
                  onValueChange={(risk) => updateDebug({ risk })}
                  options={[
                    { value: "High", label: "高" },
                    { value: "Medium", label: "中" },
                    { value: "Low", label: "低" }
                  ]}
                />
              </Label>
              <Label>
                状态
                <SelectControl
                  value={selectedParameter.status}
                  onValueChange={(status) => updateDebug({ status })}
                  options={[
                    { value: "已同步", label: "已同步" },
                    { value: "待下发", label: "待下发" },
                    { value: "下发成功", label: "下发成功" }
                  ]}
                />
              </Label>
            </div>
          ) : (
            <EmptyState text="请选择一个调试参数。" />
          )}
        </div>

        <ConfigExportPanel
          configJson={configJson}
        />
      </section>
    </AdminPageScaffold>
  );
}

function WorkbenchLayout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="workbench-page">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      <div className="workbench-grid">{children}</div>
    </div>
  );
}

function AdminPageScaffold({
  title,
  subtitle,
  metrics,
  action,
  children
}: {
  title: string;
  subtitle: string;
  metrics: [string, string, string][];
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="admin-page">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {action ? <div className="page-actions">{action}</div> : null}
      </header>
      <section className="metric-grid admin-metrics">
        {metrics.map(([label, value, trend]) => (
          <MetricCard key={label} title={label} value={value} trend={trend} tone="blue" />
        ))}
      </section>
      {children}
    </div>
  );
}

const agentFabSize = 56;
const agentPanelDesktopWidth = 430;
const agentDragInset = 14;
const agentDragThreshold = 4;

type AgentPosition = {
  right: number;
  bottom: number;
};

type AgentDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startRight: number;
  startBottom: number;
  moved: boolean;
};

function clampAgentOffset(value: number, viewportSize: number) {
  return Math.min(Math.max(value, agentDragInset), Math.max(agentDragInset, viewportSize - agentFabSize - agentDragInset));
}

function clampAgentPanelOffset(value: number, viewportSize: number) {
  return Math.min(Math.max(value, agentDragInset), Math.max(agentDragInset, viewportSize - agentPanelDesktopWidth - agentDragInset));
}

function UnifiedAgent({
  path,
  plan,
  state,
  dispatch,
  comparisonSelection
}: {
  path: string;
  plan: ReturnType<typeof createAgentPlan>;
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  comparisonSelection: ComparisonProjectSelection;
}) {
  const [open, setOpen] = useState(false);
  const [agentPosition, setAgentPosition] = useState<AgentPosition>({ right: 24, bottom: 24 });
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<string[]>(["我会根据当前页面上下文给出建议。涉及状态变更的动作会先请求确认。"]);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const dragStateRef = useRef<AgentDragState | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    if (!dragging) {
      return undefined;
    }

    const moveAgent = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      dragState.moved = dragState.moved || Math.hypot(deltaX, deltaY) > agentDragThreshold;

      setAgentPosition({
        right: clampAgentOffset(dragState.startRight - deltaX, window.innerWidth),
        bottom: clampAgentOffset(dragState.startBottom - deltaY, window.innerHeight)
      });
    };

    const stopDragging = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      suppressNextClickRef.current = dragState.moved;
      dragStateRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", moveAgent);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", moveAgent);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging]);

  const executeAction = (id: string) => {
    switch (id) {
      case "filter-high-risk":
        setMessages((items) => ["已标记高风险参数：max_concurrent_sessions、risk_score_threshold。", ...items]);
        break;
      case "draft-parameter-change":
        dispatch({
          type: "ADD_CHANGE_REQUEST",
          parameterId: "p-max-session",
          targetValue: "80",
          reason: "WiseAgent 建议将会话上限调整到安全阈值内。"
        });
        setMessages((items) => ["已生成并提交参数修改草稿，进入审阅队列。", ...items]);
        break;
      case "advance-review":
        dispatch({ type: "ADVANCE_REVIEW", requestId: state.changeRequests[0]?.id ?? "PRQ-8902" });
        setMessages((items) => ["当前审阅请求已推进到下一流程节点。", ...items]);
        break;
      case "advance-log":
        dispatch({ type: "ADVANCE_LOG", logId: "log-active" });
        setMessages((items) => ["日志分析阶段已推进，证据链同步刷新。", ...items]);
        break;
      case "connect-device":
        dispatch({ type: "CONNECT_DEVICE", deviceId: state.devices[0]?.id ?? "device-x01" });
        setMessages((items) => ["推荐样机已连接，调试动作现在可用。", ...items]);
        break;
      case "push-debug-value":
        dispatch({ type: "CONNECT_DEVICE", deviceId: state.devices[0]?.id ?? "device-x01" });
        dispatch({ type: "PUSH_DEBUG_VALUE", parameterId: "dbg-pid-p" });
        setMessages((items) => ["PID 比例系数调试值已下发，已准备回滚快照。", ...items]);
        break;
      case "import-parameters":
        dispatch({ type: "IMPORT_PARAMETERS" });
        setMessages((items) => ["批量参数导入已模拟完成，冲突项进入审计队列。", ...items]);
        break;
      default:
        setMessages((items) => ["已生成当前页面治理摘要，可用于正式汇报。", ...items]);
    }
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = String(form.get("agentPrompt") ?? "").trim();
    if (!value) {
      return;
    }
    setMessages((items) => [`你问：${value}`, `WiseAgent：我已结合 ${plan.contextTitle} 上下文生成一组可执行建议。`, ...items]);
    event.currentTarget.reset();
  };

  const agentPositionStyle: CSSProperties = {
    right: `${agentPosition.right}px`,
    bottom: `${agentPosition.bottom}px`
  };
  const agentPanelPositionStyle: CSSProperties = {
    right: `${clampAgentPanelOffset(agentPosition.right, window.innerWidth)}px`,
    bottom: `${agentPosition.bottom}px`
  };
  const comparisonInsights = path === "/parameter-comparison" ? createComparisonInsights(state, comparisonSelection) : null;

  const startDraggingAgent = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight: agentPosition.right,
      startBottom: agentPosition.bottom,
      moved: false
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const openAgent = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setOpen(true);
  };

  if (!open) {
    return (
      <button
        className={dragging ? "agent-fab dragging" : "agent-fab"}
        type="button"
        onClick={openAgent}
        onPointerDown={startDraggingAgent}
        style={agentPositionStyle}
        aria-label="打开 WiseAgent"
      >
        <Bot size={24} />
      </button>
    );
  }

  return (
    <div className="agent-panel" data-path={path} style={agentPanelPositionStyle}>
      <div className="agent-header">
        <div className="agent-avatar">
          <Bot size={19} />
        </div>
        <div>
          <strong>WiseAgent</strong>
          <span>{plan.contextTitle}</span>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="最小化 WiseAgent">
          <X size={18} />
        </Button>
      </div>
      <div className="agent-body">
        <div className="agent-context">
          <SectionLabel icon={<Lightbulb size={15} />} label="上下文洞察" />
          <p>{plan.contextSummary}</p>
        </div>
        {comparisonInsights ? (
          <div className="agent-insight-stack" aria-label="WiseAgent 洞察">
            <div className="agent-insight-heading">
              <Bot size={16} />
              <strong>WiseAgent 洞察</strong>
            </div>
            <div className="agent-insight-card accent-secondary">
              <SectionLabel icon={<Info size={15} />} label="项目差异风险" />
              <p>
                <code>{comparisonInsights.primaryInsight?.key}</code> 在 {comparisonInsights.baseProject.code} 与 {comparisonInsights.targetProject.code} 间存在差异，
                建议结合充电温升与降额日志判断是否同步。
              </p>
              <Button className="link-button" type="button" variant="link">查看历史延迟</Button>
            </div>
            <div className="agent-insight-card accent-tertiary">
              <SectionLabel icon={<ListChecks size={15} />} label="参数值对照" />
              <p>
                <code>{comparisonInsights.secondaryInsight?.key}</code> 的项目配置需要按机型定位、电池规格和区域电源策略一起复核。
              </p>
            </div>
            <div className="agent-insight-card accent-danger">
              <SectionLabel icon={<AlertTriangle size={15} />} label="风险阈值漂移" />
              <p>
                高重要性参数会直接影响充电安全、电量估算或热管理表现，同步前需要先完成参数审阅。
              </p>
            </div>
          </div>
        ) : null}
        <div className="agent-steps">
          {plan.steps.map((step, index) => (
            <div key={step}>
              <span>{index + 1}</span>
              {step}
            </div>
          ))}
        </div>
        <div className="quick-prompts">
          {plan.prompts.map((prompt) => (
            <Button key={prompt} type="button" variant="outline" size="sm" onClick={() => setMessages((items) => [`已选择建议问题：${prompt}`, ...items])}>
              {prompt}
            </Button>
          ))}
        </div>
        <div className="agent-messages">
          {messages.slice(0, 4).map((message, index) => (
            <div className={index % 2 === 0 ? "agent-message" : "agent-message user"} key={`${message}-${index}`}>
              {message}
            </div>
          ))}
        </div>
        <div className="agent-actions">
          {plan.actions.map((action) => (
            <Button
              className={action.requiresConfirm ? "requires-confirm" : ""}
              key={action.id}
              type="button"
              variant={action.requiresConfirm ? "default" : "outline"}
              onClick={() => {
                if (action.requiresConfirm) {
                  setConfirmAction(action.id);
                } else {
                  executeAction(action.id);
                }
              }}
            >
              {action.requiresConfirm ? <LockKeyhole size={14} /> : <Play size={14} />}
              {action.label}
            </Button>
          ))}
        </div>
      </div>
      <form className="agent-input" onSubmit={submitPrompt}>
        <Input name="agentPrompt" placeholder="询问 WiseAgent..." />
        <Button type="submit" aria-label="发送" size="icon">
          <Send size={17} />
        </Button>
      </form>
      {confirmAction ? (
        <ConfirmDialog
          title="确认执行 Agent 动作"
          message="该动作会改变当前原型状态。为体现治理闭环，AI 不会绕过人工确认。"
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            executeAction(confirmAction);
            setConfirmAction(null);
          }}
        />
      ) : null}
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

function DataTable<T>({ headers, rows, renderRow }: { headers: string[]; rows: T[]; renderRow: (row: T) => ReactNode }) {
  return (
    <div className="table-wrap">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{rows.map(renderRow)}</TableBody>
      </Table>
      {rows.length === 0 ? <EmptyState text="当前筛选条件下没有数据。" /> : null}
    </div>
  );
}

function RiskBadge({ risk }: { risk: "High" | "Medium" | "Low" }) {
  return <UiBadge className={`risk-badge ${risk.toLowerCase()}`} variant="outline">{riskLabels[risk]}</UiBadge>;
}

function StatusBadge({ status }: { status: string }) {
  return <UiBadge className="status-badge" variant="secondary"><span />{status}</UiBadge>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "tertiary" | "secondary" }) {
  return <UiBadge className={`badge ${tone}`} variant={tone === "secondary" ? "secondary" : "outline"}>{children}</UiBadge>;
}

function SectionLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="section-label">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function PanelHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="panel-header">
      <strong>{title}</strong>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function Timeline({ steps, activeIndex }: { steps: string[]; activeIndex: number }) {
  return (
    <div className="timeline">
      {steps.map((step, index) => (
        <div className={index <= activeIndex ? "done" : ""} key={step}>
          <span>{index < activeIndex ? <Check size={14} /> : index + 1}</span>
          <small>{step}</small>
        </div>
      ))}
    </div>
  );
}

function VerticalTimeline({ items }: { items: [string, string, string][] }) {
  return (
    <div className="vertical-timeline">
      {items.map(([time, title, body]) => (
        <div key={`${time}-${title}`}>
          <span className="timeline-dot" />
          <small>{time}</small>
          <strong>{title}</strong>
          <p>{body}</p>
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

function ConfirmDialog({
  title,
  message,
  cancelLabel = "取消",
  confirmLabel = "确认执行",
  onCancel,
  onConfirm
}: {
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <AlertDialogContent className="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button" onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LibraryPanel({ title, items }: { title: string; items: string[][] }) {
  return (
    <div className="library-panel">
      <PanelHeader title={title} meta={`${items.length} 项`} />
      <div className="library-list">
        {items.map(([main, sub, meta]) => (
          <div className="library-row" key={`${main}-${sub}`}>
            <div>
              <strong>{main}</strong>
              <span>{sub}</span>
            </div>
            <Badge tone={meta === "High" ? "secondary" : "neutral"}>{displayTag(meta)}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditPanel({ events }: { events: AuditEvent[] }) {
  return (
    <div className="library-panel">
      <PanelHeader title="审计事件" meta={`${events.length} 条事件`} />
      {events.map((event) => (
        <div className="audit-row" key={event.id}>
          <RiskBadge risk={event.severity} />
          <div>
            <strong>{event.action}</strong>
            <span>{event.actor} · {event.time}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default App;
