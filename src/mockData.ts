import { PageKey } from "./appConfig";
import {
  bundledPowerManagementConfig,
  clonePowerManagementConfig,
  flattenDebugParameters,
  flattenProjectParameters,
  PowerManagementConfig,
  PowerManagementDebugParameter,
  PowerManagementProjectId
} from "./powerManagementConfig";

export type RiskLevel = "High" | "Medium" | "Low";
export type RequestStatus = "待审阅" | "自动检查通过" | "等待合入" | "已合入" | "已打回";
export type LogStage = "日志解析" | "模式匹配" | "根因推断" | "报告生成";
export type DeviceStatus = "未连接" | "连接中" | "已连接" | "连接失败";

export type Project = {
  id: PowerManagementProjectId;
  name: string;
  code: string;
};

export type RoleCapability = "view" | "edit" | "publish" | "manage-permissions";

export type User = {
  id: string;
  name: string;
  email: string;
  roleId: string;
  isActive: boolean;
  createdAt: string;
};

export type Role = {
  id: string;
  name: string;
  capabilities: RoleCapability[];
  description: string;
};

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
  updatedAt: string;
};

export type ChangeRequest = {
  id: string;
  submissionRoundId?: string;
  projectId?: string;
  parameterId: string;
  module: string;
  title: string;
  currentValue: string;
  targetValue: string;
  submitter: string;
  createdAt: string;
  status: RequestStatus;
  aiSummary: string;
  rejectReason?: string;
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
  reason: string;
};

export type ParameterSubmissionRound = {
  id: string;
  projectId: string;
  projectName: string;
  submitter: string;
  createdAt: string;
  status: RequestStatus | "已撤回";
  summary: string;
  items: ParameterSubmissionItem[];
};

export type LogRecord = {
  id: string;
  fileName: string;
  projectId: string;
  status: "Processing" | "Complete" | "Failed";
  stage: LogStage;
  confidence: number;
  conclusion: string;
  impact: string;
  evidence: string[];
  suggestedActions: string[];
};

export type Device = {
  id: string;
  name: string;
  projectId: string;
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
  kind: AuditEventKind;
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
    affectedIds?: string[];
    diffSummary?: { added: number; updated: number; deleted: number };
    snapshotName?: string;
    aiActionId?: string;
    foundOrphans?: number;
  };
  viaAgent?: boolean;
};

export type PrototypeState = {
  activeProjectId: string;
  activeRoleId: string;
  configDraft: PowerManagementConfig;
  parameters: ParameterRecord[];
  changeRequests: ChangeRequest[];
  parameterSubmissionRounds: ParameterSubmissionRound[];
  logs: LogRecord[];
  devices: Device[];
  debugParameters: DebugParameter[];
  auditEvents: AuditEvent[];
  notifications: string[];
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

export const roles: Role[] = [
  {
    id: "hardware",
    name: "硬件开发",
    capabilities: ["view"],
    description: "只读参数库，用于研发阶段查阅和对比。"
  },
  {
    id: "project",
    name: "项目开发",
    capabilities: ["view", "edit"],
    description: "可编辑参数与项目取值，发起修改提交。"
  },
  {
    id: "parameter-admin",
    name: "参数管理员",
    capabilities: ["view", "edit", "publish"],
    description: "负责审阅和发布变更，管理参数库。"
  },
  {
    id: "admin",
    name: "平台管理员",
    capabilities: ["view", "edit", "publish", "manage-permissions"],
    description: "全部权限，可管理他人权限与全平台配置。"
  }
];

export const users: User[] = [
  { id: "u-xu-yun", name: "Xu Yun", email: "xu@chargelab.cn", roleId: "admin", isActive: true, createdAt: "2024-11-02T09:30:00.000Z" },
  { id: "u-zhao-heng", name: "Zhao Heng", email: "zhao@chargelab.cn", roleId: "hardware", isActive: true, createdAt: "2025-01-14T03:12:00.000Z" },
  { id: "u-liu-min", name: "Liu Min", email: "liu@chargelab.cn", roleId: "project", isActive: true, createdAt: "2025-02-03T08:04:00.000Z" },
  { id: "u-wang-jie", name: "Wang Jie", email: "wang@chargelab.cn", roleId: "parameter-admin", isActive: true, createdAt: "2024-12-20T12:00:00.000Z" },
  { id: "u-chen-na", name: "Chen Na", email: "chen@chargelab.cn", roleId: "project", isActive: true, createdAt: "2025-03-10T10:00:00.000Z" },
  { id: "u-li-peng", name: "Li Peng", email: "lipeng@chargelab.cn", roleId: "hardware", isActive: true, createdAt: "2025-03-22T11:00:00.000Z" },
  { id: "u-sun-mei", name: "Sun Mei", email: "sun@chargelab.cn", roleId: "parameter-admin", isActive: true, createdAt: "2025-04-01T09:00:00.000Z" },
  { id: "u-tao-lin", name: "Tao Lin", email: "tao@chargelab.cn", roleId: "hardware", isActive: false, createdAt: "2025-04-15T14:00:00.000Z" }
];

export const auditEvents: AuditEvent[] = [
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
    metadata: { previousValue: "3800", newValue: "3200" }
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
    metadata: { affectedIds: ["fast-charge-current", "battery-temp-target"], diffSummary: { added: 3, updated: 5, deleted: 0 } }
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
    action: "批量清理 2 个孤儿参数",
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
    metadata: { previousRole: "project", newRole: "parameter-admin" }
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
    action: "扫描孤儿参数并生成建议",
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
    metadata: { snapshotName: "power-management-5.2.0.json" }
  },
  {
    id: "ae-019",
    kind: "batch-import",
    app: "parameter-admin",
    actor: "Chen Na",
    action: "提交供应商阈值导入预览",
    time: "5 天前",
    severity: "Medium",
    batchId: "BI-20260505-004",
    userId: "u-chen-na",
    metadata: { diffSummary: { added: 1, updated: 4, deleted: 0 } }
  },
  {
    id: "ae-020",
    kind: "agent-action",
    app: "parameter-admin",
    actor: "WiseAgent",
    action: "生成孤儿参数清理建议",
    time: "5 天前",
    severity: "Low",
    viaAgent: true,
    metadata: { aiActionId: "draft-cleanup" }
  }
];

export function derivePowerManagementRuntimeState(configDraft: PowerManagementConfig) {
  return {
    parameters: flattenProjectParameters(configDraft).map((parameter) => ({
      ...parameter
    })),
    debugParameters: flattenDebugParameters(configDraft).map((parameter) => ({
      ...parameter
    }))
  };
}

export function createPrototypeState(configDraft: PowerManagementConfig = clonePowerManagementConfig(bundledPowerManagementConfig)): PrototypeState {
  const runtime = derivePowerManagementRuntimeState(configDraft);
  const nextConfigDraft = clonePowerManagementConfig(configDraft);

  return {
    activeProjectId: "aurora",
    activeRoleId: "hardware",
    configDraft: nextConfigDraft,
    parameters: runtime.parameters,
    changeRequests: [
      {
        id: "PRQ-9102",
        submissionRoundId: "PRS-2405",
        projectId: "aurora",
        parameterId: "aurora-fast-charge-current",
        module: "Charging Policy",
        title: "快充输入电流调整",
        currentValue: "3800",
        targetValue: "3200",
        submitter: "H. Zhao",
        createdAt: "36 分钟前",
        status: "待审阅",
        aiSummary: "将快充电流从 3800mA 回落到 3200mA，可以明显降低背部温升并延长高温段时长。"
      },
      {
        id: "PRQ-9101",
        submissionRoundId: "PRS-2404",
        projectId: "aurora",
        parameterId: "aurora-battery-temp-target",
        module: "Battery Safety",
        title: "电池目标温度下调",
        currentValue: "38",
        targetValue: "35",
        submitter: "L. Chen",
        createdAt: "昨天",
        status: "自动检查通过",
        aiSummary: "结合热像图，电池目标温度下调 3°C 有助于减少快充后段降额频率。"
      }
    ],
    parameterSubmissionRounds: [
      {
        id: "PRS-2405",
        projectId: "aurora",
        projectName: "Aurora 量产平台",
        submitter: "H. Zhao",
        createdAt: "36 分钟前",
        status: "待审阅",
        summary: "快充输入电流调整，等待参数管理员审阅。",
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
        status: "自动检查通过",
        summary: "电池目标温度下调，自动检查已通过。",
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
            reason: "减少快充后段降额频率。"
          }
        ]
      }
    ],
    logs: [
      {
        id: "log-active",
        fileName: "charging_thermal_trace_20260504.log",
        projectId: "aurora",
        status: "Processing",
        stage: "根因推断",
        confidence: 92,
        conclusion: "快充阶段电池包温升过快，触发热降额链路。",
        impact: "battery-pack-lab-a",
        evidence: [
          "10:24:01 WARN [CHG_THERMAL] battery_pack_temp=46.8C over soft_limit=45C",
          "10:24:03 INFO [CHG_POLICY] fast_current_limit_ma 3800 -> 2800",
          "10:24:05 WARN [BATTERY_GAUGE] soc_rise_slope drop after thermal foldback"
        ],
        suggestedActions: ["下调快充电流上限", "复核电池温控阈值", "关联 thermal_trace 与充电电流曲线"]
      },
      {
        id: "log-auth",
        fileName: "usb_pd_negotiation_20260503.log",
        projectId: "aurora",
        status: "Complete",
        stage: "报告生成",
        confidence: 88,
        conclusion: "PD 协商在 9V/3A 档位稳定完成，未出现握手重试。",
        impact: "charger-adapter-b",
        evidence: [
          "09:18:11 INFO [PD_CTRL] SourceCap includes 5V/3A, 9V/3A, 12V/2.25A",
          "09:18:12 INFO PD_CTRL Accept profile 9V/3A",
          "09:18:19 INFO [CHARGER] input_voltage_mv=9020 input_current_ma=2980 stable"
        ],
        suggestedActions: ["保留 9V/3A 充电档位", "同步适配器白名单", "跟踪海外批次 PD 兼容性"]
      },
      {
        id: "log-failed",
        fileName: "thermal_snapshot.bin",
        projectId: "nebula",
        status: "Failed",
        stage: "日志解析",
        confidence: 0,
        conclusion: "不支持的二进制热快照格式。",
        impact: "N/A",
        evidence: [
          "00:00:00 ERROR [PARSER] binary thermal snapshot cannot be decoded",
          "00:00:00 INFO [PARSER] accepted suffix: .log, .txt, .json"
        ],
        suggestedActions: ["请重新上传 .log、.txt 或 .json 文本日志。", "从温控工具导出文本链路日志", "保留原始热快照用于离线分析"]
      }
    ],
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
    auditEvents,
    notifications: ["手机电源管理演示模式已启动"],
    users,
    currentUserId: "u-xu-yun",
    lastExportedSnapshot: JSON.stringify(nextConfigDraft),
    _undoStack: null,
    insightDismissedIds: [],
    aiFlaggedImportIds: []
  };
}

export const initialState = createPrototypeState();
export const mockDataFingerprint = createMockDataFingerprint(initialState);
