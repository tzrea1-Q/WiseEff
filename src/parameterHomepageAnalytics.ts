import type { ParameterRecord, PrototypeState, RequestStatus, RiskLevel } from "./mockData";
import { deriveHotspotTrend, mapHotspotStatus, type HotspotStatusLevel, type HotspotTrend } from "./hotspotPresentation";

export type HomepageTimeWindow = "7d" | "30d" | "180d";
export type HotspotDimension = "module" | "project";

export type HomepageSummary = {
  totalParameters: number;
  parameterDefinitions: number;
  debugParameters: number;
  highRiskParameters: number;
  changeEvents: number;
  activeHotspots: number;
};

export type HomepageFlowHealth = {
  reviewQueue: number;
  autoChecked: number;
  waitingMerge: number;
  merged: number;
  needsHumanConfirmation: number;
};

export type HomepageEntryCard = {
  title: string;
  description: string;
  path: string;
  statusLabel: string;
  statusValue: string;
};

export type HotspotScoreBreakdown = {
  frequency: number;
  risk: number;
  impact: number;
  workflow: number;
  drift: number;
};

export type ParameterHotspot = {
  id: string;
  title: string;
  projectCode: string;
  module: string;
  status: string;
  statusLevel: HotspotStatusLevel;
  trend: HotspotTrend;
  lastChangedAt?: string;
  changeCount: number;
  highRiskCount: number;
  score: number;
  scoreBreakdown: HotspotScoreBreakdown;
  explanation: string;
  evidence: string[];
  suggestedAction: string;
  suggestedPath: string;
};

export type KeyParameterChange = {
  id: string;
  parameterName: string;
  module: string;
  projectCode: string;
  currentValue: string;
  recommendedValue: string;
  driftLabel: string;
  reason: string;
  risk: RiskLevel;
  status: string;
  suggestedPath: string;
};

export type ParameterHomepageAnalytics = {
  timeWindow: HomepageTimeWindow;
  timeWindowLabel: string;
  hotspotDimension: HotspotDimension;
  summary: HomepageSummary;
  flowHealth: HomepageFlowHealth;
  entryCards: HomepageEntryCard[];
  hotspots: ParameterHotspot[];
  keyChanges: KeyParameterChange[];
  aiSummary: {
    title: string;
    body: string;
    dimensions: Array<{ label: string; value: string }>;
  };
};

const timeWindowLabels: Record<HomepageTimeWindow, string> = {
  "7d": "近 7 天",
  "30d": "近 30 天",
  "180d": "近 180 天"
};

const riskWeight: Record<RiskLevel, number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

const timeWindowProfiles: Record<
  HomepageTimeWindow,
  {
    auditRatio: number;
    requestRatio: number;
    requestWeight: number;
    auditWeight: number;
    logWeight: number;
    parameterWeight: number;
    hotspotLimit: number;
    keyChangeLimit: number;
    cycleSignals: boolean;
  }
> = {
  "7d": {
    auditRatio: 0.5,
    requestRatio: 0.5,
    requestWeight: 1.25,
    auditWeight: 0.75,
    logWeight: 0.65,
    parameterWeight: 0.75,
    hotspotLimit: 4,
    keyChangeLimit: 3,
    cycleSignals: false
  },
  "30d": {
    auditRatio: 1,
    requestRatio: 1,
    requestWeight: 1,
    auditWeight: 1,
    logWeight: 1,
    parameterWeight: 1,
    hotspotLimit: 5,
    keyChangeLimit: 4,
    cycleSignals: false
  },
  "180d": {
    auditRatio: 1,
    requestRatio: 1,
    requestWeight: 0.9,
    auditWeight: 1,
    logWeight: 1.2,
    parameterWeight: 1.15,
    hotspotLimit: 6,
    keyChangeLimit: 5,
    cycleSignals: true
  }
};

const knownWorkflowStatuses = {
  reviewPending: "待审阅",
  autoChecked: "自动检查通过",
  waitingMerge: "等待合入",
  merged: "已合入",
  rejected: "已打回"
} satisfies Record<string, RequestStatus>;

export function deriveParameterHomepageAnalytics(
  state: PrototypeState,
  timeWindow: HomepageTimeWindow = "30d",
  hotspotDimension: HotspotDimension = "module"
): ParameterHomepageAnalytics {
  const timeWindowLabel = timeWindowLabels[timeWindow];
  const profile = timeWindowProfiles[timeWindow];
  const projectCodes = createProjectCodeMap(state);
  const windowedChangeRequests = takeWindowedItems(state.changeRequests, profile.requestRatio);
  const windowedAuditEvents = takeWindowedItems(state.auditEvents, profile.auditRatio);
  const cycleSignalCount = profile.cycleSignals ? state.logs.length : 0;
  const changeEvents = Math.max(1, Math.round(windowedChangeRequests.length * profile.requestWeight + windowedAuditEvents.length * profile.auditWeight)) + cycleSignalCount;
  const hotspots = deriveHotspots(state, projectCodes, timeWindow, timeWindowLabel, profile, windowedChangeRequests, hotspotDimension);
  const flowHealth = deriveFlowHealth(state);
  const summary: HomepageSummary = {
    totalParameters: state.parameters.length,
    parameterDefinitions: new Set(state.parameters.map((parameter) => parameter.name)).size,
    debugParameters: state.debugParameters.length,
    highRiskParameters: state.parameters.filter((parameter) => parameter.risk === "High").length,
    changeEvents,
    activeHotspots: hotspots.length
  };

  return {
    timeWindow,
    timeWindowLabel,
    hotspotDimension,
    summary,
    flowHealth,
    entryCards: deriveEntryCards(state, summary, flowHealth),
    hotspots,
    keyChanges: deriveKeyChanges(state, projectCodes, profile),
    aiSummary: {
      title: "AI 参数治理摘要",
      body: "系统按变更频次、风险权重、影响范围、流程堆积与异常偏离识别参数管理优先级。",
      dimensions: [
        { label: "变更频次", value: `${summary.changeEvents} 个事件` },
        { label: "风险权重", value: `${summary.highRiskParameters} 个高风险参数` },
        { label: "影响范围", value: `${summary.parameterDefinitions} 类参数定义` },
        { label: "流程堆积", value: `${flowHealth.reviewQueue} 个待处理请求` },
        { label: "异常偏离", value: `${Math.round(averageDrift(state.parameters))}% 平均偏离` }
      ]
    }
  };
}

function takeWindowedItems<T>(items: T[], ratio: number) {
  return items.slice(0, Math.max(1, Math.ceil(items.length * ratio)));
}

function createProjectCodeMap(state: PrototypeState) {
  return new Map(state.configDraft.projects.map((project) => [project.id, project.code]));
}

function deriveFlowHealth(state: PrototypeState): HomepageFlowHealth {
  return {
    reviewQueue: state.changeRequests.length,
    autoChecked: countByStatus(state, knownWorkflowStatuses.autoChecked),
    waitingMerge: countByStatus(state, knownWorkflowStatuses.waitingMerge),
    merged: countByStatus(state, knownWorkflowStatuses.merged),
    needsHumanConfirmation: state.changeRequests.filter((request) => request.status !== knownWorkflowStatuses.merged).length
  };
}

function countByStatus(state: PrototypeState, status: RequestStatus) {
  return state.changeRequests.filter((request) => request.status === status).length;
}

function deriveEntryCards(state: PrototypeState, summary: HomepageSummary, flowHealth: HomepageFlowHealth): HomepageEntryCard[] {
  return [
    {
      title: "项目参数工作台",
      description: "查看项目参数、风险和修改建议",
      path: "/parameters",
      statusLabel: "参数总量",
      statusValue: String(summary.totalParameters)
    },
    {
      title: "项目参数对比分析",
      description: "定位跨项目参数漂移与异常差异",
      path: "/parameter-comparison",
      statusLabel: "定义数量",
      statusValue: String(summary.parameterDefinitions)
    },
    {
      title: "参数合入审核",
      description: "处理待审核、自动检查和合入流程",
      path: "/parameter-review",
      statusLabel: "合入审核",
      statusValue: String(flowHealth.reviewQueue)
    },
    {
      title: "项目参数管理后台",
      description: "维护参数库、权限、导入和审计",
      path: "/parameter-admin",
      statusLabel: "调试参数",
      statusValue: String(state.debugParameters.length)
    }
  ];
}

function deriveHotspots(
  state: PrototypeState,
  projectCodes: Map<string, string>,
  timeWindow: HomepageTimeWindow,
  timeWindowLabel: string,
  profile: (typeof timeWindowProfiles)[HomepageTimeWindow],
  windowedChangeRequests: PrototypeState["changeRequests"],
  hotspotDimension: HotspotDimension
): ParameterHotspot[] {
  const groups = new Map<string, ParameterRecord[]>();

  for (const parameter of state.parameters) {
    const id = hotspotDimension === "module" ? parameter.module : parameter.projectId;
    groups.set(id, [...(groups.get(id) ?? []), parameter]);
  }

  return Array.from(groups.entries())
    .map(([id, parameters]) => {
      const firstParameter = parameters[0];
      const projectId = hotspotDimension === "project" ? id : firstParameter?.projectId ?? "";
      const module = hotspotDimension === "module" ? id : "项目参数";
      const projectCode = hotspotDimension === "project" ? projectCodes.get(projectId) ?? projectId : `${new Set(parameters.map((parameter) => parameter.projectId)).size} 个项目`;
      const relatedRequests = windowedChangeRequests.filter(
        (request) => parameters.some((parameter) => parameter.id === request.parameterId)
      );
      const lastChangedAt = relatedRequests[0]?.createdAt;
      const highRiskCount = parameters.filter((parameter) => parameter.risk === "High").length;
      const driftValue = parameters.reduce((total, parameter) => total + driftScore(parameter), 0);
      const logSignals =
        hotspotDimension === "project"
          ? state.logs.filter((log) => log.projectId === projectId).length
          : state.logs.filter((log) => mentionsModule(log, module)).length;
      const scoreBreakdown: HotspotScoreBreakdown = {
        frequency: Math.round((parameters.length * 4 * profile.parameterWeight + relatedRequests.length * 10 * profile.requestWeight) * 10) / 10,
        risk: parameters.reduce((total, parameter) => total + riskWeight[parameter.risk] * 6, 0),
        impact: Math.round((new Set(parameters.map((parameter) => parameter.name)).size * 5 + logSignals * 8 * profile.logWeight) * 10) / 10,
        workflow: Math.round((relatedRequests.length * 14 * profile.requestWeight + highRiskCount * 3) * 10) / 10,
        drift: Math.round(driftValue * 10) / 10
      };
      const score = Object.values(scoreBreakdown).reduce((total, value) => total + value, 0);
      const title = hotspotDimension === "module" ? module : projectCode;
      const explanation =
        hotspotDimension === "module"
          ? `${timeWindowLabel}内，${module} 跨 ${projectCode}累计 ${parameters.length} 个参数信号、${relatedRequests.length} 个流程事件。`
          : `${timeWindowLabel}内，${projectCode} 累计 ${parameters.length} 个参数信号、${relatedRequests.length} 个流程事件。`;
      const suggestedPath =
        hotspotDimension === "module"
          ? relatedRequests.length > 0
            ? `/parameter-review?module=${encodeURIComponent(module)}`
            : `/parameter-comparison?module=${encodeURIComponent(module)}`
          : relatedRequests.length > 0
            ? `/parameter-review?project=${encodeURIComponent(projectId)}`
            : `/parameter-comparison?project=${encodeURIComponent(projectId)}`;

      const roundedScore = Math.round(score * 10) / 10;
      const status = mapHotspotStatus({ highRiskCount, score: roundedScore });

      return {
        id,
        title,
        projectCode,
        module,
        status: status.label,
        statusLevel: status.level,
        trend: deriveHotspotTrend({ id }, timeWindow),
        lastChangedAt,
        changeCount: relatedRequests.length,
        highRiskCount,
        score: roundedScore,
        scoreBreakdown,
        explanation,
        evidence: [
          `${highRiskCount} 个高风险参数`,
          `${Math.round(driftValue)}% 累计推荐偏离`,
          `${relatedRequests.length} 个审核或变更请求`
        ],
        suggestedAction: relatedRequests.length > 0 ? "优先推进审核并回写参数库" : "复核参数偏离并生成对比分析",
        suggestedPath
      };
    })
    .sort((first, second) => second.score - first.score)
    .slice(0, Math.max(3, Math.min(profile.hotspotLimit, groups.size)));
}

function deriveKeyChanges(
  state: PrototypeState,
  projectCodes: Map<string, string>,
  profile: (typeof timeWindowProfiles)[HomepageTimeWindow]
): KeyParameterChange[] {
  return [...state.parameters]
    .sort((first, second) => {
      const priorityDelta = riskWeight[second.risk] - riskWeight[first.risk];
      return priorityDelta === 0 ? driftScore(second) - driftScore(first) : priorityDelta;
    })
    .slice(0, profile.keyChangeLimit)
    .map((parameter) => {
      const drift = driftScore(parameter);

      return {
        id: parameter.id,
        parameterName: parameter.name,
        module: parameter.module,
        projectCode: projectCodes.get(parameter.projectId) ?? parameter.projectId,
        currentValue: formatParameterValue(parameter.currentValue, parameter.unit),
        recommendedValue: formatParameterValue(parameter.recommendedValue, parameter.unit),
        driftLabel: `${Math.round(drift)}% 偏离`,
        reason: parameter.explanation || parameter.description,
        risk: parameter.risk,
        status: drift > 10 || parameter.risk === "High" ? "建议优先处理" : "建议复核",
        suggestedPath: `/parameters?project=${encodeURIComponent(parameter.projectId)}&module=${encodeURIComponent(parameter.module)}&parameter=${encodeURIComponent(parameter.id)}`
      };
    });
}

function mentionsModule(log: PrototypeState["logs"][number], module: string) {
  const evidenceText = log.evidence.flatMap((evidence) => [
    evidence.inference,
    evidence.suggestedAction,
    ...evidence.lineNumbers.map((lineNumber) => log.rawLines[lineNumber - 1] ?? "")
  ]);
  const haystack = [log.conclusion, log.impact, ...evidenceText, ...log.suggestedActions].join(" ").toLowerCase();
  return module
    .toLowerCase()
    .split(/\s+/)
    .some((part) => part.length > 2 && haystack.includes(part));
}

function averageDrift(parameters: ParameterRecord[]) {
  return parameters.length === 0 ? 0 : parameters.reduce((total, parameter) => total + driftScore(parameter), 0) / parameters.length;
}

function driftScore(parameter: ParameterRecord) {
  const current = Number.parseFloat(parameter.currentValue);
  const recommended = Number.parseFloat(parameter.recommendedValue);

  if (!Number.isFinite(current) || !Number.isFinite(recommended)) {
    return parameter.currentValue === parameter.recommendedValue ? 0 : 25;
  }

  const baseline = Math.max(Math.abs(current), Math.abs(recommended), 1);
  return (Math.abs(current - recommended) / baseline) * 100;
}

function formatParameterValue(value: string, unit: string) {
  return unit ? `${value}${unit}` : value;
}
