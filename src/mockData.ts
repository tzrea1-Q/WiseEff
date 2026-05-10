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

export type AuditEvent = {
  id: string;
  app: PageKey;
  actor: string;
  action: string;
  time: string;
  severity: RiskLevel;
};

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
  parameterSubmissionRounds: ParameterSubmissionRound[];
  logs: LogRecord[];
  devices: Device[];
  debugParameters: DebugParameter[];
  auditEvents: AuditEvent[];
  developers: Developer[];
  notifications: string[];
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
      ...parameter
    })),
    debugParameters: flattenDebugParameters(configDraft).map((parameter) => ({
      ...parameter
    }))
  };
}

export function createPrototypeState(configDraft: PowerManagementConfig = clonePowerManagementConfig(bundledPowerManagementConfig)): PrototypeState {
  const runtime = derivePowerManagementRuntimeState(configDraft);

  return {
    activeProjectId: "aurora",
    activeRoleId: "hardware",
    configDraft: clonePowerManagementConfig(configDraft),
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
    notifications: ["手机电源管理演示模式已启动"]
  };
}

export const initialState = createPrototypeState();
export const mockDataFingerprint = createMockDataFingerprint(initialState);
