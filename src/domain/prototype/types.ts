/**
 * Prototype-era domain types shared by the mock runtime, reducer, and pages.
 * Moved verbatim out of `src/mockData.ts` so that domain code no longer
 * depends on a fixture module; `src/mockData.ts` keeps fixtures only.
 */
import type { PageKey } from "@/appConfig";
import type {
  PowerManagementConfig,
  PowerManagementDebugParameter,
  PowerManagementProjectId,
  ParameterValueKind
} from "@/powerManagementConfig";
import type {
  ProjectInitializationStatus,
  ProjectParameterInitializationDraft,
  ProjectParameterInitializationReview,
  ParameterWorkflowAssignees
} from "@/domain/parameters/types";
import type { ParameterDraftDto } from "@/application/ports/ParameterRepository";
import type { NotificationItem } from "@/domain/notifications/types";
import type { PlatformRole, UserAccount } from "@/domain/users/types";

export type RiskLevel = "High" | "Medium" | "Low";
export type AIConfidence = "high" | "mid" | "low";
export type AIRecommendation = "advance" | "needs-review" | "reject";

export type AIReviewSuggestion = {
  recommendation: AIRecommendation;
  confidence: AIConfidence;
  summary: string;
  reasons: string[];
  similarRequests: string[];
};

export type ParameterHistoryEntry = {
  version: string;
  value: string;
  changedAt: string;
  changedBy: string;
  requestId?: string;
};

export type ImpactItem = {
  kind: "module" | "test" | "parameter" | "phandle" | "compatible" | "config-set";
  name: string;
  note: string;
  risk: RiskLevel;
};

export type RequestStatus =
  | "硬件Committer检视"
  | "软件Committer检视"
  | "软件User合入"
  | "待审阅"
  | "自动检查通过"
  | "等待合入"
  | "已合入"
  | "已打回";
export type LogStageId = "parse" | "pattern" | "rootcause" | "report";
export type LogStatus = "Processing" | "Complete" | "Failed";
export type LogSeverity = "Critical" | "Warning" | "Info";
export type LogArchiveState = "active" | "archived";
export type DeviceStatus = "未连接" | "连接中" | "已连接" | "连接失败";
export type DebugDeviceTransport = "simulator" | "hdc" | "adb" | "multi";
export type LogAdminRole = "Admin" | "Editor" | "Viewer";
export type LogAdminUserAvatarTone = "blue" | "teal" | "violet" | "slate";
export type TimeWindow = "today" | "7d" | "30d";

export type LogAdminUser = {
  id: string;
  name: string;
  title: string;
  role: LogAdminRole;
  avatarInitials: string;
  avatarTone: LogAdminUserAvatarTone;
  lastActive: string;
  lastActiveIso: string;
};

export type LogEvidence = {
  id: string;
  stageId: LogStageId;
  lineNumbers: number[];
  inference: string;
  suggestedAction: string;
  ruleHit?: string;
};

export const STAGE_LABELS: Record<LogStageId, string> = {
  parse: "日志解析",
  pattern: "模式匹配",
  rootcause: "根因推断",
  report: "报告生成"
};

export const SEVERITY_LABELS: Record<LogSeverity, string> = {
  Critical: "严重",
  Warning: "警告",
  Info: "提示"
};

export type Project = {
  id: PowerManagementProjectId;
  name: string;
  code: string;
};

export type Role = PlatformRole;
export type RoleCapability = PlatformRole["permissions"][number];
export type User = UserAccount;

export type ParameterRecord = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  moduleId?: string;
  modulePath?: string[];
  projectId: string;
  currentValue: string;
  recommendedValue: string;
  range: string;
  unit: string;
  risk: RiskLevel;
  valueKind: ParameterValueKind;
  sourceFileName?: string;
  sourceNodePath?: string;
  updatedAt: string;
  updatedAtTs: string;
  history: ParameterHistoryEntry[];
};

export type ChangeRequest = {
  id: string;
  submissionRoundId?: string;
  projectId?: string;
  parameterId: string;
  baseVersion?: number;
  module: string;
  /** Business-module introduction shown on admin review detail. */
  moduleDescription?: string;
  /** Parameter meaning shown on admin review detail. */
  parameterDescription?: string;
  title: string;
  currentValue: string;
  targetValue: string;
  submitter: string;
  valueKind?: ParameterValueKind;
  createdAt: string;
  createdAtTs: string;
  updatedAt: string;
  status: RequestStatus;
  aiSummary: string;
  rejectReason?: string;
  waitingHours: number;
  aiSuggestion: AIReviewSuggestion;
  impact: ImpactItem[];
  assignedTo?: string;
  workflowAssignees?: ParameterWorkflowAssignees;
  fastTrack?: boolean;
  reviewerNote?: string;
};

export type ParameterSubmissionItem = {
  requestId: string;
  parameterId: string;
  name: string;
  module: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  risk: RiskLevel;
  valueKind?: ParameterValueKind;
  reason: string;
};

export type ParameterReviewDecisionRecord = {
  id: string;
  requestId: string;
  reviewerUserId: string;
  decision: "advance" | "reject";
  fromStatus: string;
  toStatus: string;
  createdAt: string;
};

export type SubmissionWorkflowStageDetail = {
  key: "hardware_review" | "software_review" | "software_merge";
  stepIndex: number;
  label: string;
  assigneeName: string;
  executorName?: string;
  executorLabel: "执行人" | "当前处理";
  state: "pending" | "active" | "completed" | "skipped";
};

export type ParameterSubmissionRound = {
  id: string;
  projectId: string;
  projectName: string;
  submitter: string;
  createdAt: string;
  status: RequestStatus | "已撤回" | "已暂存";
  summary: string;
  workflowAssignees?: ParameterWorkflowAssignees;
  workflowTrail?: SubmissionWorkflowStageDetail[];
  items: ParameterSubmissionItem[];
};

export type LogRecord = {
  id: string;
  reportId: string;
  fileName: string;
  source: string;
  fileSizeMB: number;
  status: LogStatus;
  stage: LogStageId;
  confidence: number;
  conclusion: string;
  impact: string;
  evidence: LogEvidence[];
  suggestedActions: string[];
  severity: LogSeverity;
  rawLines: string[];
  capturedAt: string;
  updatedAt: string;
  updatedAtIso: string;
  submittedBy: string;
  relatedParameterId?: string;
  device?: string;
  failureReason?: string;
  analysisQuestion?: string;
  archiveState?: LogArchiveState;
  logDomainId?: string;
  logDomainName?: string;
  analysisSource?: "agent" | "rules-fallback";
  degradedReason?: "provider-unavailable" | "token-budget-exhausted";
};

export type Device = {
  id: string;
  name: string;
  transport?: DebugDeviceTransport;
  firmware: string;
  status: DeviceStatus;
  lastSeen: string;
};

export type DebugParameter = PowerManagementDebugParameter;

export type AuditEventKind =
  | "parameter-add"
  | "parameter-update"
  | "parameter-delete"
  | "batch-import"
  | "bulk-risk-change"
  | "bulk-module-change"
  | "bulk-delete"
  | "user-add"
  | "user-role-change"
  | "user-toggle"
  | "export"
  | "rollback-undo"
  | "agent-action";

export type ImportBatch = {
  id: string;
  source: "file" | "paste" | "demo";
  demoSourceId?: string;
  submittedAt: string;
  summary: { added: number; updated: number; deleted: number };
  affectedIds: string[];
  aiFlaggedIds: string[];
};

export type UndoEntry = {
  id: string;
  actionKind: AuditEventKind;
  message: string;
  snapshot: Partial<PrototypeState>;
  createdAt: string;
  expiresAt: string;
  originalAuditEventId: string;
};

export type AuditEvent = {
  id: string;
  kind?: AuditEventKind;
  app: PageKey;
  actor: string;
  action: string;
  time: string;
  severity: RiskLevel;
  parameterId?: string;
  batchId?: string;
  userId?: string;
  metadata?: {
    previousValue?: string;
    newValue?: string;
    previousRole?: string;
    newRole?: string;
    isActive?: boolean;
    affectedIds?: string[];
    diffSummary?: { added: number; updated: number; deleted: number };
    snapshotName?: string;
    aiActionId?: string;
    foundOrphans?: number;
  };
  viaAgent?: boolean;
  traceId?: string;
};

export type DebugSnapshotEntry = {
  parameterId: string;
  previousValue: string;
  nextValue: string;
};

export type DebugSnapshot = {
  id: string;
  createdAt: string;
  entries: DebugSnapshotEntry[];
  risk: RiskLevel;
};

export type DebugEvent =
  | { kind: "connect"; deviceId: string; at: string }
  | { kind: "disconnect"; deviceId: string; at: string }
  | { kind: "push"; snapshotId: string; parameterIds: string[]; at: string; risk: RiskLevel }
  | { kind: "rollback"; snapshotId: string; parameterIds: string[]; at: string }
  | { kind: "rollback-undo"; snapshotId: string; at: string };

export type DeveloperRole =
  | "参数工程师"
  | "电池架构师"
  | "充电方案工程师"
  | "固件工程师";

export type Developer = {
  id: string;
  name: string;
  projectId: string;
  role: DeveloperRole;
};

export type PrototypeState = {
  activeProjectId: string;
  activeRoleId: string;
  configDraft: PowerManagementConfig;
  parameters: ParameterRecord[];
  changeRequests: ChangeRequest[];
  parameterDrafts: ParameterDraftDto[];
  parameterSubmissionRounds: ParameterSubmissionRound[];
  parameterReviewDecisions: ParameterReviewDecisionRecord[];
  parameterInitializationDrafts: ProjectParameterInitializationDraft[];
  parameterInitializationReviews: ProjectParameterInitializationReview[];
  projectInitializationStatuses: Record<string, ProjectInitializationStatus>;
  logs: LogRecord[];
  logAdminUsers: LogAdminUser[];
  archivedLogIds: string[];
  devices: Device[];
  debugParameters: DebugParameter[];
  auditEvents: AuditEvent[];
  developers: Developer[];
  notifications: string[];
  notificationInbox: NotificationItem[];
  lastDebugSnapshot: DebugSnapshot | null;
  debugEvents: DebugEvent[];
  pushedDebugIds: string[];
  debuggingSessionStartedAt: string | null;
  debuggingActiveSessionId: string | null;
  persistedConfigSnapshot: PowerManagementConfig;
  users: User[];
  currentUserId: string;
};
