import type {
  AIReviewSuggestion,
  ChangeRequest,
  ImpactItem,
  ParameterHistoryEntry,
  RequestStatus
} from "./mockData";
import { bundledPowerManagementConfig, flattenProjectParameters } from "./powerManagementConfig";

const parameterValueKindById = new Map(
  flattenProjectParameters(bundledPowerManagementConfig).map((parameter) => [parameter.id, parameter.valueKind])
);

export const REVIEW_MOCK_NOW = "2026-05-10T12:00:00.000Z";

export function buildAISuggestion(input: AIReviewSuggestion): AIReviewSuggestion {
  return {
    recommendation: input.recommendation,
    confidence: input.confidence,
    summary: input.summary,
    reasons: [...input.reasons],
    similarRequests: [...input.similarRequests]
  };
}

const MODULE_IMPACT_TEMPLATES: Record<string, ImpactItem[]> = {
  charging: [
    { kind: "module", name: "Thermal Controller", note: "调整会影响温控预测模型输入", risk: "Medium" },
    { kind: "module", name: "Battery Health Monitor", note: "充电曲线变更触发健康度重新评估", risk: "Low" },
    { kind: "module", name: "Charging UI Display", note: "显示端需刷新快充档位文案", risk: "Low" },
    { kind: "test", name: "test_charging_policy_fast_mode", note: "自动回归已通过", risk: "Low" },
    { kind: "test", name: "test_thermal_throttle_activation", note: "压力测试已通过", risk: "Low" },
    { kind: "parameter", name: "thermal.predicted_load_offset", note: "建议同步评估 +/-5% 变化", risk: "Medium" }
  ],
  "battery-safety": [
    { kind: "module", name: "Battery Health Monitor", note: "电池安全阈值变更影响健康度判定", risk: "High" },
    { kind: "module", name: "Thermal Controller", note: "热保护策略需重新校准", risk: "Medium" },
    { kind: "test", name: "test_battery_overheat_cutoff", note: "关键安全测试", risk: "High" },
    { kind: "parameter", name: "battery.cutoff_voltage", note: "安全链参数联动", risk: "Medium" }
  ],
  thermal: [
    { kind: "module", name: "Charging Policy", note: "温控阈值变更会影响充电降频触发点", risk: "Medium" },
    { kind: "module", name: "System Fan Controller", note: "需重新标定风扇曲线", risk: "Low" },
    { kind: "test", name: "test_thermal_throttle_activation", note: "自动回归已通过", risk: "Low" },
    { kind: "parameter", name: "charging.max_input_current", note: "建议同步评估", risk: "Medium" }
  ],
  estimation: [
    { kind: "module", name: "SOC Estimator", note: "平滑参数会影响剩余电量收敛速度", risk: "Medium" },
    { kind: "test", name: "test_soc_smoothing_stability", note: "覆盖低电量边界", risk: "Medium" },
    { kind: "parameter", name: "battery.health_reserve_pct", note: "建议与健康度预留比例联合评估", risk: "Low" }
  ]
};

export function buildImpactItems(kind: keyof typeof MODULE_IMPACT_TEMPLATES | string): ImpactItem[] {
  const template = MODULE_IMPACT_TEMPLATES[kind];

  if (template) {
    return template.map((item) => ({ ...item }));
  }

  return [
    { kind: "module", name: "Generic Module A", note: "通用依赖模块，待细化", risk: "Low" },
    { kind: "test", name: "test_generic_integration", note: "通用集成测试", risk: "Low" },
    { kind: "parameter", name: "generic.related_parameter", note: "建议同步评估", risk: "Low" }
  ];
}

export function buildParameterHistory(parameterId: string): ParameterHistoryEntry[] {
  const now = new Date(REVIEW_MOCK_NOW).getTime();
  const seed = parameterId.length;
  const versions = ["v2.4.0", "v2.4.1", "v2.4.2", "v2.5.0", "v2.5.1", "v2.6.0"];
  const actors = ["H. Zhao", "L. Chen", "M. Kross", "A. Singh", "Y. Park", "R. Ito"];
  const baseValue = 3200 + (seed % 9) * 75;

  return versions.map((version, index) => {
    const daysAgo = (versions.length - index) * (20 + (seed % 10));
    const changedAt = new Date(now - daysAgo * 86_400_000).toISOString();

    return {
      version,
      value: String(baseValue + index * 50 - (index % 3) * 100),
      changedAt,
      changedBy: actors[index % actors.length],
      requestId: index >= 3 ? `PRQ-${8800 + seed + index}` : undefined
    };
  });
}

type ReviewMockSeed = {
  id: string;
  submissionRoundId?: string;
  projectId: string;
  parameterId: string;
  module: string;
  title: string;
  currentValue: string;
  targetValue: string;
  submitter: string;
  createdAt: string;
  createdAtTs: string;
  status: RequestStatus;
  suggestion: AIReviewSuggestion;
  impactKey: string;
  assignedTo?: string;
  rejectReason?: string;
  reviewerNote?: string;
  workflowAssignees?: ChangeRequest["workflowAssignees"];
};

const DEFAULT_WORKFLOW_ASSIGNEES = {
  hardwareCommitterId: "u-wang-jie",
  softwareCommitterId: "u-sun-mei",
  softwareUserId: "u-chen-na"
};

const SEEDS: ReviewMockSeed[] = [
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
    createdAtTs: "2026-05-10T11:24:00.000Z",
    status: "硬件Committer检视",
    suggestion: {
      recommendation: "advance",
      confidence: "high",
      summary: "建议推进：将快充电流从 3800mA 回落到 3200mA，可明显降低背部温升。",
      reasons: [
        "历史相似 3 条全部成功合入",
        "当前值 3800mA 在高温段曾触发 2 次降频",
        "目标值 3200mA 处于安全阈值中位"
      ],
      similarRequests: ["PRQ-7801", "PRQ-7654", "PRQ-7530"]
    },
    impactKey: "charging",
    assignedTo: "u-wang-jie",
    workflowAssignees: DEFAULT_WORKFLOW_ASSIGNEES
  },
  {
    id: "PRQ-9098",
    submissionRoundId: "PRS-2401",
    projectId: "aurora",
    parameterId: "aurora-charge-voltage-limit",
    module: "Charging Policy",
    title: "预充阶段电压上限微调",
    currentValue: "9200",
    targetValue: "9000",
    submitter: "M. Kross",
    createdAt: "2 小时前",
    createdAtTs: "2026-05-10T10:00:00.000Z",
    status: "硬件Committer检视",
    suggestion: {
      recommendation: "advance",
      confidence: "high",
      summary: "建议推进：预充电压微调在推荐区间内，自动化回归已覆盖。",
      reasons: ["目标值在推荐区间内", "历史相似 2 条全部成功", "自动化回归全部通过"],
      similarRequests: ["PRQ-7200", "PRQ-7180"]
    },
    impactKey: "charging",
    assignedTo: "u-wang-jie",
    workflowAssignees: DEFAULT_WORKFLOW_ASSIGNEES
  },
  {
    id: "PRQ-9096",
    projectId: "nebula",
    parameterId: "nebula-battery-health-reserve",
    module: "Battery Health",
    title: "电池健康度预留比例调整",
    currentValue: "8",
    targetValue: "10",
    submitter: "A. Singh",
    createdAt: "6 小时前",
    createdAtTs: "2026-05-10T06:00:00.000Z",
    status: "软件Committer检视",
    suggestion: {
      recommendation: "advance",
      confidence: "high",
      summary: "建议推进：预留比例上调能降低老化机型误报，风险集中在展示口径。",
      reasons: ["目标值高于现有值但未越界", "老化模型回放误报率下降", "关联展示模块影响较低"],
      similarRequests: ["PRQ-8011", "PRQ-8024", "PRQ-8048"]
    },
    impactKey: "estimation",
    assignedTo: "u-sun-mei",
    workflowAssignees: {
      hardwareCommitterId: "u-li-peng",
      softwareCommitterId: "u-sun-mei",
      softwareUserId: "u-liu-min"
    }
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
    createdAt: "18 小时前",
    createdAtTs: "2026-05-09T18:00:00.000Z",
    status: "硬件Committer检视",
    suggestion: {
      recommendation: "reject",
      confidence: "high",
      summary: "建议打回：目标温度会触发过早降频，缺少低温续航影响评估。",
      reasons: ["低温场景回归缺失", "与 Nebula 上一版阈值偏差超过 20%", "影响电池安全链参数"],
      similarRequests: ["PRQ-7019", "PRQ-7042"]
    },
    impactKey: "battery-safety",
    assignedTo: "u-wang-jie",
    workflowAssignees: DEFAULT_WORKFLOW_ASSIGNEES
  },
  {
    id: "PRQ-9091",
    projectId: "atlas",
    parameterId: "atlas-low-battery-shutdown",
    module: "Battery Safety",
    title: "低电量关机阈值下调",
    currentValue: "5",
    targetValue: "2",
    submitter: "R. Ito",
    createdAt: "24 小时前",
    createdAtTs: "2026-05-09T12:00:00.000Z",
    status: "硬件Committer检视",
    suggestion: {
      recommendation: "reject",
      confidence: "high",
      summary: "建议打回：目标值低于安全建议区间，可能导致电池保护动作滞后。",
      reasons: ["目标值接近硬件保护下限", "缺少极端温度放电验证", "相似请求曾因保护滞后被回滚"],
      similarRequests: ["PRQ-6930", "PRQ-6888"]
    },
    impactKey: "battery-safety",
    assignedTo: "u-li-peng",
    workflowAssignees: {
      hardwareCommitterId: "u-li-peng",
      softwareCommitterId: "u-sun-mei",
      softwareUserId: "u-liu-min"
    }
  },
  {
    id: "PRQ-9089",
    projectId: "aurora",
    parameterId: "aurora-wireless-thermal-derate",
    module: "Thermal Management",
    title: "无线充热降额比例调整",
    currentValue: "18",
    targetValue: "15",
    submitter: "Y. Park",
    createdAt: "3 天前",
    createdAtTs: "2026-05-07T12:00:00.000Z",
    status: "软件Committer检视",
    suggestion: {
      recommendation: "advance",
      confidence: "mid",
      summary: "建议谨慎推进：收益明确，但无线充热堆积测试样本偏少。",
      reasons: ["目标值仍在推荐范围内", "无线充热堆积样本不足", "需要关注充电完成时间变化"],
      similarRequests: ["PRQ-6751"]
    },
    impactKey: "thermal",
    assignedTo: "u-sun-mei",
    workflowAssignees: DEFAULT_WORKFLOW_ASSIGNEES,
    reviewerNote: "等待补充无线充长测摘要。"
  },
  {
    id: "PRQ-9087",
    projectId: "atlas",
    parameterId: "atlas-pmic-boost-voltage",
    module: "Power IC",
    title: "PMIC Boost 电压上调",
    currentValue: "5100",
    targetValue: "5300",
    submitter: "N. Patel",
    createdAt: "4 天前",
    createdAtTs: "2026-05-06T12:00:00.000Z",
    status: "软件User合入",
    suggestion: {
      recommendation: "needs-review",
      confidence: "mid",
      summary: "需人工复核：电压上调影响跨模块，AI 无法确认硬件余量。",
      reasons: ["硬件余量数据未结构化", "历史相似请求结果分化", "合入前需确认 PMIC 版本"],
      similarRequests: ["PRQ-6608", "PRQ-6501"]
    },
    impactKey: "thermal",
    assignedTo: "u-chen-na",
    workflowAssignees: {
      hardwareCommitterId: "u-li-peng",
      softwareCommitterId: "u-sun-mei",
      softwareUserId: "u-chen-na"
    }
  },
  {
    id: "PRQ-9085",
    projectId: "nebula",
    parameterId: "nebula-soc-smoothing",
    module: "Battery Estimation",
    title: "SOC 平滑窗口调整",
    currentValue: "7",
    targetValue: "9",
    submitter: "Q. Wu",
    createdAt: "5 天前",
    createdAtTs: "2026-05-05T12:00:00.000Z",
    status: "已合入",
    suggestion: {
      recommendation: "needs-review",
      confidence: "low",
      summary: "需人工复核：SOC 平滑收益依赖用户画像，历史结果不一致。",
      reasons: ["不同项目回放结果分化", "用户体感指标缺失", "已合入请求用于展示处理后状态"],
      similarRequests: ["PRQ-6404", "PRQ-6377"]
    },
    impactKey: "estimation"
  },
  {
    id: "PRQ-9083",
    projectId: "atlas",
    parameterId: "atlas-usb-pd-profile",
    module: "Charging Protocol",
    title: "USB PD 档位功率限制调整",
    currentValue: "45",
    targetValue: "60",
    submitter: "C. Meyer",
    createdAt: "5 天前",
    createdAtTs: "2026-05-05T08:00:00.000Z",
    status: "已打回",
    suggestion: {
      recommendation: "reject",
      confidence: "mid",
      summary: "建议打回：目标功率提升缺少适配器白名单验证。",
      reasons: ["适配器兼容数据不足", "海外批次 PD 握手样本缺失", "目标值变化影响协议模块"],
      similarRequests: ["PRQ-6321"]
    },
    impactKey: "charging",
    rejectReason: "请补充 60W 档位适配器白名单和海外批次握手验证。"
  },
  {
    id: "PRQ-9081",
    projectId: "aurora",
    parameterId: "aurora-standby-drain-limit",
    module: "Standby Power",
    title: "待机漏电上限收紧",
    currentValue: "22",
    targetValue: "18",
    submitter: "S. Garcia",
    createdAt: "72 小时前",
    createdAtTs: "2026-05-07T12:00:00.000Z",
    status: "硬件Committer检视",
    suggestion: {
      recommendation: "needs-review",
      confidence: "low",
      summary: "需人工复核：待机漏电改善明确，但可能压缩后台保活余量。",
      reasons: ["后台保活指标缺少项目拆分", "目标值低于 Aurora 近 3 版均值", "需要与体验团队确认"],
      similarRequests: ["PRQ-6208", "PRQ-6191"]
    },
    impactKey: "thermal",
    assignedTo: "u-wang-jie",
    workflowAssignees: DEFAULT_WORKFLOW_ASSIGNEES
  },
  {
    id: "PRQ-9079",
    projectId: "nebula",
    parameterId: "nebula-fast-charge-current",
    module: "Charging Policy",
    title: "快充峰值电流短窗提升",
    currentValue: "3400",
    targetValue: "3600",
    submitter: "D. Novak",
    createdAt: "96 小时前",
    createdAtTs: "2026-05-06T12:00:00.000Z",
    status: "硬件Committer检视",
    suggestion: {
      recommendation: "needs-review",
      confidence: "mid",
      summary: "需人工复核：短窗提升可能改善充电首段，但热模型置信度不足。",
      reasons: ["热模型对 Nebula 新壳料样本不足", "目标值未越界但接近上沿", "建议补充 30 分钟热曲线"],
      similarRequests: ["PRQ-6120", "PRQ-6089"]
    },
    impactKey: "charging",
    assignedTo: "u-li-peng",
    workflowAssignees: {
      hardwareCommitterId: "u-li-peng",
      softwareCommitterId: "u-sun-mei",
      softwareUserId: "u-liu-min"
    }
  }
];

export function buildReviewMockRequests(): ChangeRequest[] {
  const now = new Date(REVIEW_MOCK_NOW).getTime();

  return SEEDS.map((seed) => {
    const suggestion = buildAISuggestion(seed.suggestion);
    const createdAt = new Date(seed.createdAtTs).getTime();

    return {
      id: seed.id,
      submissionRoundId: seed.submissionRoundId,
      projectId: seed.projectId,
      parameterId: seed.parameterId,
      module: seed.module,
      title: seed.title,
      currentValue: seed.currentValue,
      targetValue: seed.targetValue,
      submitter: seed.submitter,
      createdAt: seed.createdAt,
      createdAtTs: seed.createdAtTs,
      updatedAt: seed.createdAtTs,
      status: seed.status,
      aiSummary: suggestion.summary,
      rejectReason: seed.rejectReason,
      waitingHours: Math.floor((now - createdAt) / 3_600_000),
      aiSuggestion: suggestion,
      impact: buildImpactItems(seed.impactKey),
      assignedTo: seed.assignedTo,
      workflowAssignees: seed.workflowAssignees,
      reviewerNote: seed.reviewerNote,
      valueKind: parameterValueKindById.get(seed.parameterId) ?? "scalar"
    };
  });
}
