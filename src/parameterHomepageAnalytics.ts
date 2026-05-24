import type { ParameterRecord, PrototypeState, RequestStatus, RiskLevel } from "./mockData";
import { deriveHotspotTrend, mapHotspotStatus, type HotspotStatusLevel, type HotspotTrend } from "./hotspotPresentation";

export type HomepageTimeWindow = "7d" | "30d" | "180d";
export type HotspotKind = "module" | "project" | "parameter";
export type HotspotDimension = "overall" | HotspotKind;

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
  kind: HotspotKind;
  title: string;
  parameterId?: string;
  projectId?: string;
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

export type ParameterHomepageAnalytics = {
  timeWindow: HomepageTimeWindow;
  timeWindowLabel: string;
  hotspotDimension: HotspotDimension;
  summary: HomepageSummary;
  flowHealth: HomepageFlowHealth;
  entryCards: HomepageEntryCard[];
  hotspots: ParameterHotspot[];
  updateTrend: UpdateTrendPoint[];
  riskBuckets: ProjectRiskBucket[];
  opsHeadline: string;
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
  hotspotDimension: HotspotDimension = "overall"
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

  const analytics: ParameterHomepageAnalytics = {
    timeWindow,
    timeWindowLabel,
    hotspotDimension,
    summary,
    flowHealth,
    entryCards: deriveEntryCards(state, summary, flowHealth),
    hotspots,
    updateTrend: deriveUpdateTrendSeries(timeWindow),
    riskBuckets: deriveProjectRiskDistribution(state, timeWindow),
    opsHeadline: ""
  };

  analytics.opsHeadline = generateOpsHeadline(analytics);
  return analytics;
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
      description: "在工作台定位跨项目参数漂移与异常差异",
      path: "/parameters",
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
  if (hotspotDimension === "overall") {
    return deriveOverallHotspots(state, projectCodes, timeWindow, timeWindowLabel, profile, windowedChangeRequests);
  }

  const groups = new Map<string, ParameterRecord[]>();

  for (const parameter of state.parameters) {
    const id = groupIdForHotspotKind(parameter, hotspotDimension);
    groups.set(id, [...(groups.get(id) ?? []), parameter]);
  }

  return rankHotspots(
    Array.from(groups.entries()).map(([id, parameters]) =>
      buildHotspotForGroup(
        state,
        projectCodes,
        timeWindow,
        timeWindowLabel,
        profile,
        windowedChangeRequests,
        hotspotDimension,
        id,
        parameters
      )
    )
  ).slice(0, Math.max(3, Math.min(profile.hotspotLimit, groups.size)));
}

function deriveOverallHotspots(
  state: PrototypeState,
  projectCodes: Map<string, string>,
  timeWindow: HomepageTimeWindow,
  timeWindowLabel: string,
  profile: (typeof timeWindowProfiles)[HomepageTimeWindow],
  windowedChangeRequests: PrototypeState["changeRequests"]
): ParameterHotspot[] {
  const candidatePools = (["module", "project", "parameter"] as const).map((kind) =>
    deriveHotspots(state, projectCodes, timeWindow, timeWindowLabel, profile, windowedChangeRequests, kind)
  );
  const limit = Math.max(3, profile.hotspotLimit);
  const requiredKinds = new Set<HotspotKind>(["module", "project", "parameter"]);
  const picked: ParameterHotspot[] = [];
  const pickedIds = new Set<string>();

  for (const kind of requiredKinds) {
    const bestInKind = candidatePools.flat().find((hotspot) => hotspot.kind === kind);

    if (bestInKind) {
      picked.push(bestInKind);
      pickedIds.add(bestInKind.id);
    }
  }

  for (const candidate of rankHotspots(candidatePools.flat())) {
    if (picked.length >= limit) break;
    if (!pickedIds.has(candidate.id)) {
      picked.push(candidate);
      pickedIds.add(candidate.id);
    }
  }

  return rankHotspots(picked).slice(0, limit);
}

function groupIdForHotspotKind(parameter: ParameterRecord, hotspotKind: HotspotKind) {
  switch (hotspotKind) {
    case "module":
      return parameter.module;
    case "project":
      return parameter.projectId;
    case "parameter":
      return parameter.id;
  }
}

function buildHotspotForGroup(
  state: PrototypeState,
  projectCodes: Map<string, string>,
  timeWindow: HomepageTimeWindow,
  timeWindowLabel: string,
  profile: (typeof timeWindowProfiles)[HomepageTimeWindow],
  windowedChangeRequests: PrototypeState["changeRequests"],
  hotspotKind: HotspotKind,
  id: string,
  parameters: ParameterRecord[]
): ParameterHotspot {
  const firstParameter = parameters[0];
  const projectId = hotspotKind === "project" ? id : firstParameter?.projectId ?? "";
  const module = hotspotKind === "module" ? id : hotspotKind === "parameter" ? firstParameter?.module ?? "" : "项目参数";
  const projectCode =
    hotspotKind === "project"
      ? projectCodes.get(projectId) ?? projectId
      : hotspotKind === "parameter"
        ? projectCodes.get(projectId) ?? projectId
        : `${new Set(parameters.map((parameter) => parameter.projectId)).size} 个项目`;
  const relatedRequests = windowedChangeRequests.filter(
    (request) => parameters.some((parameter) => parameter.id === request.parameterId)
  );
  const lastChangedAt = relatedRequests[0]?.createdAt;
  const highRiskCount = parameters.filter((parameter) => parameter.risk === "High").length;
  const driftValue = parameters.reduce((total, parameter) => total + driftScore(parameter), 0);
  const logSignals =
    hotspotKind === "project" || hotspotKind === "parameter"
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
  const title = hotspotKind === "module" ? module : hotspotKind === "project" ? projectCode : firstParameter?.name ?? id;
  const explanation = buildHotspotExplanation(timeWindowLabel, hotspotKind, title, module, projectCode, parameters.length, relatedRequests.length);
  const suggestedPath = buildHotspotPath(hotspotKind, id, projectId, module, relatedRequests.length);
  const roundedScore = Math.round(score * 10) / 10;
  const status = mapHotspotStatus({ highRiskCount, score: roundedScore });

  return {
    id: `${hotspotKind}:${id}`,
    kind: hotspotKind,
    title,
    parameterId: hotspotKind === "parameter" ? id : undefined,
    projectId: projectId || undefined,
    projectCode,
    module,
    status: status.label,
    statusLevel: status.level,
    trend: deriveHotspotTrend({ id: `${hotspotKind}:${id}` }, timeWindow),
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
}

function rankHotspots(hotspots: ParameterHotspot[]) {
  return [...hotspots].sort((first, second) => second.score - first.score);
}

function buildHotspotExplanation(
  timeWindowLabel: string,
  hotspotKind: HotspotKind,
  title: string,
  module: string,
  projectCode: string,
  parameterCount: number,
  requestCount: number
) {
  if (hotspotKind === "module") {
    return `${timeWindowLabel}内，${module} 跨 ${projectCode}累计 ${parameterCount} 个参数信号、${requestCount} 个流程事件。`;
  }
  if (hotspotKind === "project") {
    return `${timeWindowLabel}内，${projectCode} 累计 ${parameterCount} 个参数信号、${requestCount} 个流程事件。`;
  }

  return `${timeWindowLabel}内，${title} 在 ${projectCode} · ${module} 累计 ${parameterCount} 个参数信号、${requestCount} 个流程事件。`;
}

function buildHotspotPath(
  hotspotKind: HotspotKind,
  id: string,
  projectId: string,
  module: string,
  requestCount: number
) {
  if (hotspotKind === "module") {
    return requestCount > 0
      ? `/parameter-review?module=${encodeURIComponent(module)}`
      : `/parameters?module=${encodeURIComponent(module)}`;
  }
  if (hotspotKind === "project") {
    return requestCount > 0
      ? `/parameter-review?project=${encodeURIComponent(projectId)}`
      : `/parameters?project=${encodeURIComponent(projectId)}`;
  }

  return requestCount > 0
    ? `/parameter-review?project=${encodeURIComponent(projectId)}&parameter=${encodeURIComponent(id)}`
    : `/parameters?project=${encodeURIComponent(projectId)}&parameter=${encodeURIComponent(id)}`;
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

function driftScore(parameter: ParameterRecord) {
  const current = Number.parseFloat(parameter.currentValue);
  const recommended = Number.parseFloat(parameter.recommendedValue);

  if (!Number.isFinite(current) || !Number.isFinite(recommended)) {
    return parameter.currentValue === parameter.recommendedValue ? 0 : 25;
  }

  const baseline = Math.max(Math.abs(current), Math.abs(recommended), 1);
  return (Math.abs(current - recommended) / baseline) * 100;
}

export type UpdateTrendPoint = {
  label: string;
  value: number;
  date: string;
};

const TREND_REFERENCE_DATE = new Date(Date.UTC(2026, 4, 10));

const TREND_CONFIG: Record<
  HomepageTimeWindow,
  { count: number; granularity: "day" | "week"; seed: number }
> = {
  "7d": { count: 7, granularity: "day", seed: 70071 },
  "30d": { count: 30, granularity: "day", seed: 300301 },
  "180d": { count: 26, granularity: "week", seed: 1801801 }
};

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function deriveUpdateTrendSeries(
  timeWindow: HomepageTimeWindow,
  referenceDate: Date = TREND_REFERENCE_DATE
): UpdateTrendPoint[] {
  const { count, granularity, seed } = TREND_CONFIG[timeWindow];
  const rand = lcg(seed);
  const peakIndex = Math.floor(count * 0.55);
  const upwardStart = Math.floor((count * 2) / 3);
  const series: UpdateTrendPoint[] = [];

  for (let index = 0; index < count; index += 1) {
    let value = Math.floor(rand() * 6);
    if (index >= upwardStart) value += 1;
    if (index === peakIndex) value = 7 + Math.floor(rand() * 2);
    value = Math.max(0, Math.min(8, value));

    const offset = count - 1 - index;
    const date = new Date(referenceDate);
    if (granularity === "day") {
      date.setUTCDate(date.getUTCDate() - offset);
    } else {
      date.setUTCDate(date.getUTCDate() - offset * 7);
    }

    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const label = granularity === "day" ? `${month}/${day}` : `第${index + 1}周`;

    series.push({ label, value, date: date.toISOString() });
  }

  return series;
}

export type ProjectRiskBucket = {
  projectId: string;
  projectCode: string;
  projectName: string;
  high: number;
  medium: number;
  low: number;
  total: number;
};

const RISK_WINDOW_SCALE: Record<HomepageTimeWindow, number> = {
  "7d": 0.35,
  "30d": 1,
  "180d": 1.6
};

const RISK_MULTIPLIERS = { high: 2, medium: 3, low: 2 } as const;

function projectSeedFromId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash ^ id.charCodeAt(index)) >>> 0;
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

export function deriveProjectRiskDistribution(
  state: PrototypeState,
  timeWindow: HomepageTimeWindow
): ProjectRiskBucket[] {
  const windowScale = RISK_WINDOW_SCALE[timeWindow];
  const windowSeed = TREND_CONFIG[timeWindow].seed;

  return state.configDraft.projects.map((project) => {
    const parameters = state.parameters.filter(
      (parameter) => parameter.projectId === project.id
    );
    const rand = lcg(projectSeedFromId(project.id) ^ windowSeed);
    const jitter = () => 0.9 + rand() * 0.3;

    const highSource = parameters.filter((parameter) => parameter.risk === "High").length;
    const mediumSource = parameters.filter((parameter) => parameter.risk === "Medium").length;
    const lowSource = parameters.filter((parameter) => parameter.risk === "Low").length;

    const high = Math.max(
      0,
      Math.round(highSource * RISK_MULTIPLIERS.high * windowScale * jitter())
    );
    const medium = Math.max(
      0,
      Math.round(mediumSource * RISK_MULTIPLIERS.medium * windowScale * jitter())
    );
    const low = Math.max(
      0,
      Math.round(lowSource * RISK_MULTIPLIERS.low * windowScale * jitter())
    );

    return {
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      high,
      medium,
      low,
      total: high + medium + low
    };
  });
}

export function generateOpsHeadline(analytics: ParameterHomepageAnalytics): string {
  const { timeWindowLabel, hotspots, riskBuckets, hotspotDimension } = analytics;
  const topHotspot = hotspots[0];
  const highRiskLeader = [...riskBuckets].sort((first, second) => second.high - first.high)[0];

  if (!topHotspot || !highRiskLeader || highRiskLeader.high === 0) {
    return `${timeWindowLabel}参数库运行平稳，暂无需优先处理的高风险热点。`;
  }

  if (hotspotDimension === "module") {
    return `${timeWindowLabel}参数修改集中在 ${topHotspot.title}，${highRiskLeader.projectCode} 待治理高风险参数最多（${highRiskLeader.high} 项），建议优先关注。`;
  }

  return `${timeWindowLabel}${topHotspot.title} 修改最活跃，待治理高风险参数 ${highRiskLeader.high} 项，建议优先关注。`;
}
