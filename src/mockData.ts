import { PageKey } from "./appConfig";
import {
  bundledPowerManagementConfig,
  clonePowerManagementConfig,
  flattenDebugParameters,
  flattenProjectParameters,
  PowerManagementConfig,
  PowerManagementDebugParameter,
  PowerManagementProjectId,
  type ParameterValueKind
} from "./powerManagementConfig";
import { buildParameterHistory, buildReviewMockRequests, REVIEW_MOCK_NOW } from "./reviewMockData";
import type {
  ProjectInitializationStatus,
  ProjectParameterInitializationDraft,
  ProjectParameterInitializationReview,
  ParameterWorkflowAssignees
} from "@/domain/parameters/types";
import type { ParameterDraftDto } from "@/application/ports/ParameterRepository";
import type { PlatformRole, UserAccount } from "@/domain/users/types";
import { migrateLegacyRoleId, platformRoles } from "@/domain/users/types";

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
  kind: "module" | "test" | "parameter";
  name: string;
  note: string;
  risk: RiskLevel;
};

export type AIFeedbackEntry = {
  id: string;
  requestId: string;
  feedback: "up" | "down";
  note?: string;
  recordedAt: string;
};

export { REVIEW_MOCK_NOW };
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
  projectId: string;
  currentValue: string;
  recommendedValue: string;
  range: string;
  unit: string;
  risk: RiskLevel;
  valueKind: ParameterValueKind;
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
  projectId: string;
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
};

export type Device = {
  id: string;
  name: string;
  projectId: string;
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
  aiFeedback: AIFeedbackEntry[];
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
  lastDebugSnapshot: DebugSnapshot | null;
  debugEvents: DebugEvent[];
  pushedDebugIds: string[];
  debuggingSessionStartedAt: string | null;
  debuggingActiveSessionId: string | null;
  persistedConfigSnapshot: PowerManagementConfig;
  users: User[];
  currentUserId: string;
  lastExportedSnapshot: string;
  _undoStack: UndoEntry | null;
  insightDismissedIds: string[];
  aiFlaggedImportIds: string[];
};

function createMockDataFingerprint(state: PrototypeState) {
  const json = JSON.stringify(state);
  let hash = 0;

  for (let index = 0; index < json.length; index += 1) {
    hash = (hash * 31 + json.charCodeAt(index)) >>> 0;
  }

  return `mock-data-${hash.toString(16)}`;
}

export const projects: Project[] = bundledPowerManagementConfig.projects.map((project) => ({
  id: project.id,
  name: project.name,
  code: project.code
}));

export const roles: Role[] = [...platformRoles];

export const users: User[] = [
  { id: "u-xu-yun", name: "Xu Yun", email: "xu@chargelab.cn", username: "xu.yun", title: "Platform Owner", roleId: "admin", isActive: true, createdAt: "2024-11-02T09:30:00.000Z", lastActive: "just now" },
  { id: "u-zhao-heng", name: "Zhao Heng", email: "zhao@chargelab.cn", username: "zhao.heng", title: "Hardware Engineer", roleId: "hardware-user", isActive: true, createdAt: "2025-01-14T03:12:00.000Z", lastActive: "2h ago" },
  { id: "u-liu-min", name: "Liu Min", email: "liu@chargelab.cn", username: "liu.min", title: "Software Engineer", roleId: "software-user", isActive: true, createdAt: "2025-02-03T08:04:00.000Z", lastActive: "today 09:12" },
  { id: "u-wang-jie", name: "Wang Jie", email: "wang@chargelab.cn", username: "wang.jie", title: "Hardware Reviewer", roleId: "hardware-committer", isActive: true, createdAt: "2024-12-20T12:00:00.000Z", lastActive: "yesterday" },
  { id: "u-chen-na", name: "Chen Na", email: "chen@chargelab.cn", username: "chen.na", title: "Software Integrator", roleId: "software-user", isActive: true, createdAt: "2025-03-10T10:00:00.000Z", lastActive: "today 10:00" },
  { id: "u-li-peng", name: "Li Peng", email: "lipeng@chargelab.cn", username: "li.peng", title: "Hardware Committer", roleId: "hardware-committer", isActive: true, createdAt: "2025-03-22T11:00:00.000Z", lastActive: "3d ago" },
  { id: "u-sun-mei", name: "Sun Mei", email: "sun@chargelab.cn", username: "sun.mei", title: "Software Reviewer", roleId: "software-committer", isActive: true, createdAt: "2025-04-01T09:00:00.000Z", lastActive: "5h ago" },
  { id: "u-tao-lin", name: "Tao Lin", email: "tao@chargelab.cn", username: "tao.lin", title: "External Viewer", roleId: "guest", isActive: false, createdAt: "2025-04-15T14:00:00.000Z", lastActive: "disabled" }
];

function recentIso(minutesAgo: number): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = Math.max(todayStart + 60_000, now.getTime() - minutesAgo * 60_000);
  const d = new Date(target);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const local = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${local}${sign}${pad2(Math.floor(Math.abs(offset) / 60))}:${pad2(Math.abs(offset) % 60)}`;
}

const parameterUpdatedAtBaselineMs = Date.parse("2026-05-10T17:00:00.000Z");

function createParameterUpdatedAtTs(updatedAt: string, index: number) {
  const parsedTimestamp = parseParameterUpdatedAtText(updatedAt);
  return new Date(parsedTimestamp + index).toISOString();
}

function parseParameterUpdatedAtText(updatedAt: string) {
  if (updatedAt === "刚刚") {
    return parameterUpdatedAtBaselineMs;
  }

  const todayMatch = updatedAt.match(/^今天 (\d{2}):(\d{2})$/);
  if (todayMatch) {
    return Date.UTC(2026, 4, 10, Number(todayMatch[1]), Number(todayMatch[2]));
  }

  const yesterdayMatch = updatedAt.match(/^昨天(?: (\d{2}):(\d{2}))?$/);
  if (yesterdayMatch) {
    return Date.UTC(2026, 4, 9, Number(yesterdayMatch[1] ?? 17), Number(yesterdayMatch[2] ?? 0));
  }

  const daysAgoMatch = updatedAt.match(/^(\d+) 天前$/);
  if (daysAgoMatch) {
    return parameterUpdatedAtBaselineMs - Number(daysAgoMatch[1]) * 24 * 60 * 60 * 1000;
  }

  const hoursAgoMatch = updatedAt.match(/^(\d+) 小时前$/);
  if (hoursAgoMatch) {
    return parameterUpdatedAtBaselineMs - Number(hoursAgoMatch[1]) * 60 * 60 * 1000;
  }

  const minutesAgoMatch = updatedAt.match(/^(\d+) 分钟前$/);
  if (minutesAgoMatch) {
    return parameterUpdatedAtBaselineMs - Number(minutesAgoMatch[1]) * 60 * 1000;
  }

  return Date.UTC(2026, 4, 1);
}

export function derivePowerManagementRuntimeState(configDraft: PowerManagementConfig) {
  return {
    parameters: flattenProjectParameters(configDraft).map((parameter, index) => ({
      ...parameter,
      updatedAtTs: createParameterUpdatedAtTs(parameter.updatedAt, index),
      history: buildParameterHistory(parameter.id)
    })),
    debugParameters: flattenDebugParameters(configDraft).map((parameter) => ({
      ...parameter
    }))
  };
}

const activeLogRawLines = [
  "10:23:42.012 INFO [BOOT] session=chg-a17 project=aurora firmware=v5.2.0-powerlab",
  "10:23:42.118 INFO [DEVICE] attach usb_c_port=0 cable=eMarked_5A",
  "10:23:42.315 INFO [PD_CTRL] SinkRequest profile=9V/3A",
  "10:23:42.622 INFO [CHARGER] input_voltage_mv=8990 input_current_ma=0",
  "10:23:43.004 INFO [BATTERY_GAUGE] soc=41 temp_cell_avg=37.2C",
  "10:23:44.218 INFO [THERMAL_MON] skin_temp=36.1C board_temp=38.7C",
  "10:23:45.009 INFO [CHG_POLICY] fast_current_limit_ma=3800 thermal_state=normal",
  "10:23:46.447 INFO [CHARGER] input_current_ma=1520 charge_current_ma=1480",
  "10:23:48.002 INFO [BATTERY_GAUGE] soc=42 rise_slope=0.51",
  "10:23:49.333 INFO [THERMAL_MON] battery_pack_temp=39.2C",
  "10:23:51.004 INFO [CHARGER] input_current_ma=2840 charge_current_ma=2760",
  "10:23:52.106 INFO [CHG_POLICY] fast_current_limit_ma=3800 thermal_state=normal",
  "10:23:54.441 INFO [BATTERY_GAUGE] soc=43 rise_slope=0.49",
  "10:23:55.010 INFO [THERMAL_MON] battery_pack_temp=41.8C",
  "10:23:57.762 INFO [CHARGER] input_current_ma=3620 charge_current_ma=3510",
  "10:23:58.201 INFO [CHG_POLICY] thermal_budget remaining=72%",
  "10:23:59.918 INFO [BATTERY_GAUGE] soc=44 rise_slope=0.47",
  "10:24:00.330 INFO [THERMAL_MON] battery_pack_temp=44.3C",
  "10:24:00.831 WARN [THERMAL_MON] skin_temp=41.7C near comfort_limit=42C",
  "10:24:01 WARN [CHG_THERMAL] battery_pack_temp=46.8C over soft_limit=45C",
  "10:24:01.216 INFO [CHG_POLICY] thermal_foldback request=prepare",
  "10:24:01.812 INFO [PMIC] die_temp=58.1C regulator_state=stable",
  "10:24:02.314 INFO [CHARGER] input_current_ma=3790 charge_current_ma=3660",
  "10:24:02.886 INFO [THERMAL_MON] pack_temp_slope=0.92C/min window=180s",
  "10:24:03 INFO [CHG_POLICY] fast_current_limit_ma 3800 -> 2800",
  "10:24:03.488 INFO [CHARGER] input_current_ma=2790 charge_current_ma=2680",
  "10:24:03.955 INFO [BATTERY_GAUGE] soc=45 rise_slope=0.31",
  "10:24:04.308 INFO [THERMAL_MON] battery_pack_temp=46.4C cooling=slow",
  "10:24:04.650 INFO [CHG_POLICY] display_estimate update=+4min",
  "10:24:05 WARN [BATTERY_GAUGE] soc_rise_slope drop after thermal foldback",
  "10:24:05.420 INFO [PMIC] regulator_state=stable ripple_mv=18",
  "10:24:06.028 INFO [THERMAL_MON] skin_temp=42.2C comfort_limit=42C",
  "10:24:07.117 INFO [CHARGER] input_voltage_mv=8974 input_current_ma=2765",
  "10:24:08.690 INFO [CHG_POLICY] fast_current_limit_ma=2800 thermal_state=restricted",
  "10:24:10.004 INFO [BATTERY_GAUGE] soc=45 rise_slope=0.29",
  "10:24:11.516 INFO [THERMAL_MON] battery_pack_temp=45.9C",
  "10:24:13.228 INFO [CHG_POLICY] thermal_budget remaining=38%",
  "10:24:15.673 INFO [CHARGER] charge_current_ma=2660 vbat_mv=3921",
  "10:24:18.091 INFO [BATTERY_GAUGE] smoothing applied window=5",
  "10:24:20.445 INFO [REPORT] evidence candidates=3 confidence_seed=0.92",
  "10:24:22.008 INFO [REPORT] recommended parameter=battery_temp_target_c",
  "10:24:25.771 INFO [END] session=chg-a17 status=processing"
];

const authLogRawLines = [
  "09:18:04.004 INFO [BOOT] session=pd-b09 project=aurora firmware=v5.2.0-powerlab",
  "09:18:04.331 INFO [USB_C] cc_attach orientation=normal",
  "09:18:04.612 INFO [PD_CTRL] HardReset count=0",
  "09:18:05.041 INFO [PD_CTRL] DiscoverIdentity cable=5A",
  "09:18:05.450 INFO [PD_CTRL] SinkCaps ready",
  "09:18:06.102 INFO [CHARGER] input_voltage_mv=5020 input_current_ma=480",
  "09:18:06.772 INFO [PD_CTRL] Wait SourceCap",
  "09:18:07.058 INFO [PD_CTRL] SourceCap msg_id=2 objects=3",
  "09:18:11 INFO [PD_CTRL] SourceCap includes 5V/3A, 9V/3A, 12V/2.25A",
  "09:18:07.645 INFO [POLICY] prefer_profile=9V/3A reason=thermal_safe",
  "09:18:08.202 INFO [PD_CTRL] Request profile=9V/3A operating_current=3000mA",
  "09:18:08.870 INFO [PD_CTRL] GoodCRC received",
  "09:18:12 INFO PD_CTRL Accept profile 9V/3A",
  "09:18:09.990 INFO [PD_CTRL] PS_RDY received",
  "09:18:10.330 INFO [CHARGER] switch input target=9000mV",
  "09:18:10.904 INFO [CHARGER] input_voltage_mv=8960 input_current_ma=1120",
  "09:18:11.404 INFO [BATTERY_GAUGE] soc=57 temp_cell_avg=34.4C",
  "09:18:11.908 INFO [THERMAL_MON] battery_pack_temp=35.0C",
  "09:18:12.333 INFO [CHARGER] input_voltage_mv=9012 input_current_ma=2360",
  "09:18:12.976 INFO [CHG_POLICY] fast_current_limit_ma=3000 thermal_state=normal",
  "09:18:13.512 INFO [PD_CTRL] retry_count=0",
  "09:18:14.019 INFO [CHARGER] input_voltage_mv=9021 input_current_ma=2910",
  "09:18:14.447 INFO [PMIC] die_temp=44.8C regulator_state=stable",
  "09:18:15.044 INFO [BATTERY_GAUGE] soc=58 rise_slope=0.44",
  "09:18:15.612 INFO [PD_CTRL] KeepAlive ack",
  "09:18:16.021 INFO [CHARGER] input_current_ma=2980 charge_current_ma=2860",
  "09:18:16.774 INFO [THERMAL_MON] skin_temp=35.8C",
  "09:18:17.281 INFO [PD_CTRL] no renegotiation observed",
  "09:18:17.903 INFO [CHARGER] input_voltage_mv=9018 input_current_ma=2974",
  "09:18:18.411 INFO [BATTERY_GAUGE] soc=59 rise_slope=0.43",
  "09:18:19 INFO [CHARGER] input_voltage_mv=9020 input_current_ma=2980 stable",
  "09:18:19.462 INFO [POLICY] adapter_whitelist matched=HW-AUD-93",
  "09:18:20.035 INFO [REPORT] evidence candidates=3 confidence_seed=0.88",
  "09:18:21.110 INFO [REPORT] conclusion=no_pd_retry",
  "09:18:22.008 INFO [END] session=pd-b09 status=complete"
];

const failedLogRawLines = [
  "00:00:00 ERROR [PARSER] binary thermal snapshot cannot be decoded",
  "00:00:00 INFO [PARSER] detected magic=0x5448524d size=12.4MB",
  "00:00:00 INFO [PARSER] accepted suffix: .log, .txt, .json",
  "00:00:00 WARN [PARSER] text stream unavailable; raw snapshot retained",
  "00:00:00 INFO [PARSER] action=export_text_log_required"
];

const logAdminUsers: LogAdminUser[] = [
  {
    id: "js",
    name: "Jane Smith",
    title: "Lead Architect",
    role: "Admin",
    avatarInitials: "JS",
    avatarTone: "blue",
    lastActive: "刚刚",
    lastActiveIso: "2026-05-11T10:28:00+08:00"
  },
  {
    id: "mk",
    name: "Mike Kruger",
    title: "Ops Engineer",
    role: "Editor",
    avatarInitials: "MK",
    avatarTone: "teal",
    lastActive: "2 小时前",
    lastActiveIso: "2026-05-11T08:42:00+08:00"
  },
  {
    id: "al",
    name: "Ana Lin",
    title: "Analyst",
    role: "Viewer",
    avatarInitials: "AL",
    avatarTone: "violet",
    lastActive: "昨天",
    lastActiveIso: "2026-05-10T17:12:00+08:00"
  },
  {
    id: "rp",
    name: "Rui Peng",
    title: "Platform PM",
    role: "Editor",
    avatarInitials: "RP",
    avatarTone: "slate",
    lastActive: "3 天前",
    lastActiveIso: "2026-05-08T13:30:00+08:00"
  },
  {
    id: "xw",
    name: "Xiao Wang",
    title: "QA Owner",
    role: "Viewer",
    avatarInitials: "XW",
    avatarTone: "blue",
    lastActive: "5 天前",
    lastActiveIso: "2026-05-06T09:16:00+08:00"
  }
];

function buildAuditEvents(): AuditEvent[] {
  return [
    {
      id: "ae-001",
      kind: "parameter-update",
      app: "parameter-admin",
      actor: "Wang Jie",
      action: "更新 fast_charge_current_limit_ma 推荐值",
      time: "刚刚",
      severity: "High",
      parameterId: "fast-charge-current",
      userId: "u-wang-jie",
      metadata: { previousValue: "3800", newValue: "3200" },
      traceId: "trace-param-edit-001"
    },
    {
      id: "ae-002",
      kind: "parameter-update",
      app: "parameter-admin",
      actor: "Sun Mei",
      action: "调整 battery_temp_target_c 范围",
      time: "12 分钟前",
      severity: "Medium",
      parameterId: "battery-temp-target",
      userId: "u-sun-mei",
      metadata: { previousValue: "32 - 44", newValue: "30 - 42" }
    },
    {
      id: "ae-003",
      kind: "parameter-delete",
      app: "parameter-admin",
      actor: "Xu Yun",
      action: "删除 legacy_charge_profile",
      time: "24 分钟前",
      severity: "High",
      parameterId: "legacy-charge-profile",
      userId: "u-xu-yun"
    },
    {
      id: "ae-004",
      kind: "batch-import",
      app: "parameter-admin",
      actor: "WiseAgent",
      action: "导入 8 条混合参数草稿",
      time: "38 分钟前",
      severity: "Medium",
      batchId: "BI-20260510-001",
      viaAgent: true,
      metadata: { affectedIds: ["fast-charge-current", "battery-temp-target"], diffSummary: { added: 3, updated: 5, deleted: 0 } },
      traceId: "trace-param-edit-001"
    },
    {
      id: "ae-005",
      kind: "bulk-risk-change",
      app: "parameter-admin",
      actor: "Wang Jie",
      action: "批量标记 3 个热管理参数为中风险",
      time: "1 小时前",
      severity: "Medium",
      userId: "u-wang-jie",
      metadata: { affectedIds: ["thermal-derating-start-c", "thermal-resume-c", "skin-temp-limit-c"] }
    },
    {
      id: "ae-006",
      kind: "bulk-module-change",
      app: "parameter-admin",
      actor: "Sun Mei",
      action: "批量归档电池保护模块参数",
      time: "2 小时前",
      severity: "Low",
      userId: "u-sun-mei",
      metadata: { affectedIds: ["battery-temp-target", "battery-voltage-guard"] }
    },
    {
      id: "ae-007",
      kind: "bulk-delete",
      app: "parameter-admin",
      actor: "Xu Yun",
      action: "批量清理 2 个闲置参数",
      time: "昨天",
      severity: "High",
      userId: "u-xu-yun",
      metadata: { affectedIds: ["legacy-param-a", "legacy-param-b"] }
    },
    {
      id: "ae-008",
      kind: "user-add",
      app: "parameter-admin",
      actor: "Xu Yun",
      action: "添加 Tao Lin 到硬件开发组",
      time: "昨天",
      severity: "Low",
      userId: "u-tao-lin"
    },
    {
      id: "ae-009",
      kind: "user-role-change",
      app: "parameter-admin",
      actor: "Xu Yun",
      action: "将 Wang Jie 设为参数管理员",
      time: "2 天前",
      severity: "Medium",
      userId: "u-wang-jie",
      metadata: { previousRole: migrateLegacyRoleId("project"), newRole: migrateLegacyRoleId("parameter-admin") }
    },
    {
      id: "ae-010",
      kind: "user-toggle",
      app: "parameter-admin",
      actor: "Xu Yun",
      action: "停用 Tao Lin 的访问权限",
      time: "2 天前",
      severity: "Medium",
      userId: "u-tao-lin"
    },
    {
      id: "ae-011",
      kind: "export",
      app: "parameter-admin",
      actor: "Wang Jie",
      action: "导出参数库快照",
      time: "3 天前",
      severity: "Low",
      metadata: { snapshotName: "parameter-admin-20260507.json" }
    },
    {
      id: "ae-012",
      kind: "rollback-undo",
      app: "parameter-admin",
      actor: "Sun Mei",
      action: "撤销删除 thermal_legacy_limit_c",
      time: "3 天前",
      severity: "Medium",
      parameterId: "thermal-legacy-limit"
    },
    {
      id: "ae-013",
      kind: "agent-action",
      app: "parameter-admin",
      actor: "WiseAgent",
      action: "扫描闲置参数并生成建议",
      time: "4 天前",
      severity: "Low",
      viaAgent: true,
      metadata: { aiActionId: "scan-orphans" }
    },
    {
      id: "ae-014",
      kind: "parameter-add",
      app: "parameter-admin",
      actor: "Liu Min",
      action: "新增 wireless_rx_power_limit_w",
      time: "4 天前",
      severity: "Medium",
      parameterId: "wireless-rx-power-limit",
      userId: "u-liu-min"
    },
    {
      id: "ae-015",
      kind: "parameter-update",
      app: "parameters",
      actor: "H. Zhao",
      action: "提交快充输入电流变更 PRQ-9102",
      time: "36 分钟前",
      severity: "High",
      parameterId: "fast-charge-current"
    },
    {
      id: "ae-016",
      kind: "agent-action",
      app: "logs",
      actor: "WiseAgent",
      action: "生成充电温升根因证据链",
      time: "18 分钟前",
      severity: "Medium",
      viaAgent: true,
      metadata: { aiActionId: "summarize-log" }
    },
    {
      id: "ae-017",
      kind: "parameter-update",
      app: "debugging",
      actor: "硬件开发",
      action: "尝试下发 charger.input_current_limit_ma 进入确认队列",
      time: "12 分钟前",
      severity: "High",
      parameterId: "charger.input_current_limit_ma"
    },
    {
      id: "ae-018",
      kind: "export",
      app: "parameter-admin",
      actor: "平台管理员",
      action: "同步电池保护参数目录版本 5.2.0",
      time: "刚刚",
      severity: "Low",
      metadata: { snapshotName: "battery-protection-5.2.0.json" }
    },
    {
      id: "ae-019",
      kind: "parameter-update",
      app: "parameter-admin",
      actor: "Chen Na",
      action: "修订 standby_drain_limit_ma 描述",
      time: "5 天前",
      severity: "Low",
      parameterId: "standby-drain-limit",
      userId: "u-chen-na"
    },
    {
      id: "ae-020",
      kind: "batch-import",
      app: "parameter-admin",
      actor: "Xu Yun",
      action: "导入批次 BI-20260505-002",
      time: "5 天前",
      severity: "Medium",
      batchId: "BI-20260505-002",
      userId: "u-xu-yun"
    }
  ];
}

export function createPrototypeState(configDraft: PowerManagementConfig = clonePowerManagementConfig(bundledPowerManagementConfig)): PrototypeState {
  const runtime = derivePowerManagementRuntimeState(configDraft);
  const currentUserId = "u-xu-yun";
  const currentUser = users.find((user) => user.id === currentUserId);

  return {
    activeProjectId: "aurora",
    activeRoleId: currentUser?.roleId ?? "guest",
    configDraft: clonePowerManagementConfig(configDraft),
    parameters: runtime.parameters,
    changeRequests: buildReviewMockRequests(),
    parameterDrafts: [],
    aiFeedback: [],
    parameterInitializationDrafts: [],
    parameterInitializationReviews: [],
    projectInitializationStatuses: Object.fromEntries(
      configDraft.projects.map((project) => [project.id, "initialized" as const])
    ),
    parameterReviewDecisions: [],
    parameterSubmissionRounds: [
      {
        id: "PRS-2405",
        projectId: "aurora",
        projectName: "Aurora 量产平台",
        submitter: "H. Zhao",
        createdAt: "36 分钟前",
        status: "硬件Committer检视",
        summary: "快充输入电流调整，等待硬件 Committer 检视。",
        workflowAssignees: {
          hardwareCommitterId: "u-wang-jie",
          softwareCommitterId: "u-sun-mei",
          softwareUserId: "u-chen-na"
        },
        items: [
          {
            requestId: "PRQ-9102",
            parameterId: "aurora-fast-charge-current",
            name: "fast_charge_current_limit_ma",
            module: "Charging Policy",
            currentValue: "3800",
            targetValue: "3200",
            unit: "mA",
            risk: "High",
            valueKind: "scalar",
            reason: "将高风险参数回落到安全阈值内。"
          }
        ]
      },
      {
        id: "PRS-2404",
        projectId: "aurora",
        projectName: "Aurora 量产平台",
        submitter: "L. Chen",
        createdAt: "昨天",
        status: "硬件Committer检视",
        summary: "电池目标温度下调，等待硬件 Committer 检视。",
        workflowAssignees: {
          hardwareCommitterId: "u-wang-jie",
          softwareCommitterId: "u-sun-mei",
          softwareUserId: "u-chen-na"
        },
        items: [
          {
            requestId: "PRQ-9101",
            parameterId: "aurora-battery-temp-target",
            name: "battery_temp_target_c",
            module: "Battery Safety",
            currentValue: "38",
            targetValue: "35",
            unit: "°C",
            risk: "Medium",
            valueKind: "scalar",
            reason: "减少快充后段降额频率。"
          }
        ]
      }
    ],
    logs: [
      {
        id: "log-active",
        reportId: "RPT-9092",
        fileName: "charging_thermal_trace_20260504.log",
        projectId: "aurora",
        source: "Battery Thermal",
        fileSizeMB: 48.2,
        status: "Processing",
        stage: "rootcause",
        confidence: 92,
        conclusion: "快充阶段电池包温升过快，触发热降额链路。",
        impact: "battery-pack-lab-a",
        evidence: [
          {
            id: "log-active-ev-thermal",
            stageId: "parse",
            lineNumbers: [20],
            inference: "电池包温度越过 45°C 软阈值，确认热异常触发点。",
            suggestedAction: "复核电池温控阈值",
            ruleHit: "thermal_soft_limit"
          },
          {
            id: "log-active-ev-policy",
            stageId: "pattern",
            lineNumbers: [25],
            inference: "充电策略已主动降低快充电流，说明热保护链路已经介入。",
            suggestedAction: "下调快充电流上限",
            ruleHit: "thermal_foldback_current_limit"
          },
          {
            id: "log-active-ev-gauge",
            stageId: "rootcause",
            lineNumbers: [30],
            inference: "SOC 增长斜率在降额后回落，佐证温升与充电体验波动有关。",
            suggestedAction: "关联 thermal_trace 与充电电流曲线"
          }
        ],
        suggestedActions: ["下调快充电流上限", "复核电池温控阈值", "关联 thermal_trace 与充电电流曲线"],
        severity: "Warning",
        rawLines: activeLogRawLines,
        capturedAt: "10:24:05",
        updatedAt: "18 分钟前",
        updatedAtIso: recentIso(18),
        submittedBy: "H. Zhao",
        relatedParameterId: "aurora-battery-temp-target",
        device: "ChargeLab_X01"
      },
      {
        id: "log-auth",
        reportId: "RPT-9091",
        fileName: "usb_pd_negotiation_20260503.log",
        projectId: "aurora",
        source: "PD Negotiation",
        fileSizeMB: 12.6,
        status: "Complete",
        stage: "report",
        confidence: 88,
        conclusion: "PD 协商在 9V/3A 档位稳定完成，未出现握手重试。",
        impact: "charger-adapter-b",
        evidence: [
          {
            id: "log-auth-ev-sourcecap",
            stageId: "parse",
            lineNumbers: [9],
            inference: "适配器上报的 SourceCap 覆盖目标档位，具备稳定协商基础。",
            suggestedAction: "保留 9V/3A 充电档位",
            ruleHit: "pd_sourcecap_target_profile"
          },
          {
            id: "log-auth-ev-accept",
            stageId: "pattern",
            lineNumbers: [13],
            inference: "设备端接受 9V/3A 档位，确认 PD 协商链路未发生重试。",
            suggestedAction: "同步适配器白名单",
            ruleHit: "pd_accept_no_retry"
          },
          {
            id: "log-auth-ev-stable",
            stageId: "rootcause",
            lineNumbers: [31],
            inference: "输入电压与电流保持在目标窗口内，充电链路进入稳定阶段。",
            suggestedAction: "跟踪海外批次 PD 兼容性"
          }
        ],
        suggestedActions: ["保留 9V/3A 充电档位", "同步适配器白名单", "跟踪海外批次 PD 兼容性"],
        severity: "Info",
        rawLines: authLogRawLines,
        capturedAt: "09:18:19",
        updatedAt: "3 小时前",
        updatedAtIso: recentIso(180),
        submittedBy: "L. Chen",
        device: "ChargeLab_X01"
      },
      {
        id: "log-failed",
        reportId: "RPT-9090",
        fileName: "thermal_snapshot.bin",
        projectId: "nebula",
        source: "Thermal Snapshot",
        fileSizeMB: 12.4,
        status: "Failed",
        stage: "parse",
        confidence: 0,
        conclusion: "不支持的二进制热快照格式。",
        impact: "N/A",
        evidence: [
          {
            id: "log-failed-ev-decode",
            stageId: "parse",
            lineNumbers: [1],
            inference: "解析器识别到当前文件不满足文本日志要求，需要保留原件并重新导出。",
            suggestedAction: "请重新上传 .log、.txt 或 .json 文本日志。",
            ruleHit: "unsupported_binary_snapshot"
          },
          {
            id: "log-failed-ev-suffix",
            stageId: "parse",
            lineNumbers: [3],
            inference: "当前导入入口仅接受文本链路日志，二进制热快照需走离线分析流程。",
            suggestedAction: "从温控工具导出文本链路日志"
          }
        ],
        suggestedActions: ["请重新上传 .log、.txt 或 .json 文本日志。", "从温控工具导出文本链路日志", "保留原始热快照用于离线分析"],
        severity: "Critical",
        rawLines: failedLogRawLines,
        capturedAt: "刚刚",
        updatedAt: "刚刚",
        updatedAtIso: recentIso(5),
        submittedBy: "Xiao Wang",
        failureReason: "二进制格式不支持。请导出 .log / .txt / .json 文本日志。"
      }
    ],
    logAdminUsers,
    archivedLogIds: [],
    devices: [
      {
        id: "device-x01",
        name: "ChargeLab_X01",
        projectId: "aurora",
        firmware: "v5.2.0-powerlab",
        status: "未连接",
        lastSeen: "10 分钟前"
      },
      {
        id: "device-n07",
        name: "BatteryBench_07",
        projectId: "nebula",
        firmware: "v5.2.0-beta",
        status: "已连接",
        lastSeen: "刚刚"
      }
    ],
    debugParameters: runtime.debugParameters,
    auditEvents: buildAuditEvents(),
    developers: [
      { id: "dev-1", name: "赵磊", projectId: "aurora", role: "参数工程师" },
      { id: "dev-2", name: "陈琳", projectId: "aurora", role: "电池架构师" },
      { id: "dev-3", name: "周元", projectId: "aurora", role: "充电方案工程师" },
      { id: "dev-4", name: "吴敏", projectId: "aurora", role: "固件工程师" },
      { id: "dev-5", name: "韩启", projectId: "aurora", role: "参数工程师" },
      { id: "dev-6", name: "柳清", projectId: "nebula", role: "电池架构师" },
      { id: "dev-7", name: "叶铭", projectId: "nebula", role: "固件工程师" },
      { id: "dev-8", name: "钟旸", projectId: "nebula", role: "充电方案工程师" },
      { id: "dev-9", name: "许洋", projectId: "nebula", role: "参数工程师" },
      { id: "dev-10", name: "林溪", projectId: "atlas", role: "参数工程师" },
      { id: "dev-11", name: "尚雯", projectId: "atlas", role: "充电方案工程师" },
      { id: "dev-12", name: "何志", projectId: "atlas", role: "固件工程师" }
    ],
    notifications: ["手机电源管理演示模式已启动"],
    lastDebugSnapshot: null,
    debugEvents: [],
    pushedDebugIds: [],
    debuggingSessionStartedAt: null,
    debuggingActiveSessionId: null,
    persistedConfigSnapshot: clonePowerManagementConfig(configDraft),
    users,
    currentUserId,
    lastExportedSnapshot: JSON.stringify(configDraft),
    _undoStack: null,
    insightDismissedIds: [],
    aiFlaggedImportIds: []
  };
}

export const initialState = createPrototypeState();
export const auditEvents = initialState.auditEvents;
export const mockDataFingerprint = createMockDataFingerprint(initialState);
