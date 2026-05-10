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
import { buildParameterHistory, buildReviewMockRequests, REVIEW_MOCK_NOW } from "./reviewMockData";

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
export type RequestStatus = "待审阅" | "自动检查通过" | "等待合入" | "已合入" | "已打回";
export type LogStageId = "parse" | "pattern" | "rootcause" | "report";
export type LogSeverity = "Critical" | "Warning" | "Info";
export type DeviceStatus = "未连接" | "连接中" | "已连接" | "连接失败";

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

export type Role = {
  id: string;
  name: string;
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
  history: ParameterHistoryEntry[];
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
  createdAtTs: string;
  updatedAt: string;
  status: RequestStatus;
  aiSummary: string;
  rejectReason?: string;
  waitingHours: number;
  aiSuggestion: AIReviewSuggestion;
  impact: ImpactItem[];
  assignedTo?: string;
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
  stage: LogStageId;
  confidence: number;
  conclusion: string;
  impact: string;
  evidence: LogEvidence[];
  suggestedActions: string[];
  severity: LogSeverity;
  rawLines: string[];
  capturedAt: string;
  relatedParameterId?: string;
  device?: string;
  failureReason?: string;
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

export type AuditEvent = {
  id: string;
  app: PageKey;
  actor: string;
  action: string;
  time: string;
  severity: RiskLevel;
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

export type PrototypeState = {
  activeProjectId: string;
  activeRoleId: string;
  configDraft: PowerManagementConfig;
  parameters: ParameterRecord[];
  changeRequests: ChangeRequest[];
  aiFeedback: AIFeedbackEntry[];
  parameterSubmissionRounds: ParameterSubmissionRound[];
  logs: LogRecord[];
  devices: Device[];
  debugParameters: DebugParameter[];
  auditEvents: AuditEvent[];
  notifications: string[];
  lastDebugSnapshot: DebugSnapshot | null;
  debugEvents: DebugEvent[];
  pushedDebugIds: string[];
  debuggingSessionStartedAt: string | null;
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
  { id: "hardware", name: "硬件开发" },
  { id: "project", name: "项目开发" },
  { id: "parameter-admin", name: "参数管理员" },
  { id: "admin", name: "平台管理员" }
];

export function derivePowerManagementRuntimeState(configDraft: PowerManagementConfig) {
  return {
    parameters: flattenProjectParameters(configDraft).map((parameter) => ({
      ...parameter,
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

export function createPrototypeState(configDraft: PowerManagementConfig = clonePowerManagementConfig(bundledPowerManagementConfig)): PrototypeState {
  const runtime = derivePowerManagementRuntimeState(configDraft);

  return {
    activeProjectId: "aurora",
    activeRoleId: "hardware",
    configDraft: clonePowerManagementConfig(configDraft),
    parameters: runtime.parameters,
    changeRequests: buildReviewMockRequests(),
    aiFeedback: [],
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
        relatedParameterId: "aurora-battery-temp-target",
        device: "ChargeLab_X01"
      },
      {
        id: "log-auth",
        fileName: "usb_pd_negotiation_20260503.log",
        projectId: "aurora",
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
        device: "ChargeLab_X01"
      },
      {
        id: "log-failed",
        fileName: "thermal_snapshot.bin",
        projectId: "nebula",
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
        failureReason: "二进制格式不支持。请导出 .log / .txt / .json 文本日志。"
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
    auditEvents: [
      {
        id: "audit-1",
        app: "parameters",
        actor: "H. Zhao",
        action: "提交快充输入电流变更 PRQ-9102",
        time: "36 分钟前",
        severity: "High"
      },
      {
        id: "audit-2",
        app: "logs",
        actor: "WiseAgent",
        action: "生成充电温升根因证据链",
        time: "18 分钟前",
        severity: "Medium"
      },
      {
        id: "audit-3",
        app: "debugging",
        actor: "硬件开发",
        action: "尝试下发 charger.input_current_limit_ma 进入确认队列",
        time: "12 分钟前",
        severity: "High"
      },
      {
        id: "audit-4",
        app: "parameter-admin",
        actor: "平台管理员",
        action: "同步电池保护参数目录版本 5.2.0",
        time: "刚刚",
        severity: "Low"
      }
    ],
    notifications: ["手机电源管理演示模式已启动"],
    lastDebugSnapshot: null,
    debugEvents: [],
    pushedDebugIds: [],
    debuggingSessionStartedAt: null
  };
}

export const initialState = createPrototypeState();
export const mockDataFingerprint = createMockDataFingerprint(initialState);
