import type { ParameterDashboardRepository } from "@/application/ports/ParameterDashboardRepository";
import type {
  DashboardHotspot,
  DashboardSummary,
  DashboardWindow,
  HotspotDimension,
  ProjectRiskBucket,
  TrendPoint
} from "@/domain/parameters/dashboardTypes";
import { mapHotspotStatus, scoreHotspotGroup, WINDOW_PROFILES } from "@/domain/parameters/hotspotScoring";
import type { ChangeRequest, ParameterRecord, PrototypeState, RiskLevel } from "@/mockData";

const windowLabels: Record<DashboardWindow, string> = {
  "7d": "近 7 天",
  "30d": "近 30 天",
  "180d": "近 180 天"
};

const riskWeight: Record<RiskLevel, number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

function resolveWindowBounds(window: DashboardWindow, now = new Date()) {
  const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowStart = new Date(windowEnd);
  const days = window === "7d" ? 7 : window === "30d" ? 30 : 180;
  windowStart.setUTCDate(windowStart.getUTCDate() - days);
  return {
    windowStart,
    windowEnd,
    granularity: window === "180d" ? ("week" as const) : ("day" as const),
    days
  };
}

function inWindow(isoTimestamp: string | undefined, start: Date, end: Date) {
  if (!isoTimestamp) return false;
  const value = Date.parse(isoTimestamp);
  return Number.isFinite(value) && value >= start.getTime() && value < end.getTime();
}

function filterParameters(state: PrototypeState, projectId?: string) {
  return state.parameters.filter((parameter) => !projectId || parameter.projectId === projectId);
}

function filterChangeRequests(state: PrototypeState, start: Date, end: Date, projectId?: string) {
  return state.changeRequests.filter(
    (request) =>
      (!projectId || request.projectId === projectId) && inWindow(request.createdAtTs, start, end)
  );
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

function buildTrend(state: PrototypeState, window: DashboardWindow, projectId?: string): TrendPoint[] {
  const { windowStart, granularity, days } = resolveWindowBounds(window);
  const bucketCount = granularity === "week" ? Math.ceil(days / 7) : days;
  const stepMs = granularity === "week" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const buckets: TrendPoint[] = [];

  for (let index = 0; index < bucketCount; index += 1) {
    const bucketStart = new Date(windowStart.getTime() + index * stepMs);
    const bucketEnd = new Date(bucketStart.getTime() + stepMs);
    const changeCount = state.parameters.reduce((total, parameter) => {
      if (projectId && parameter.projectId !== projectId) return total;
      return (
        total +
        parameter.history.filter((entry) => inWindow(entry.changedAt, bucketStart, bucketEnd)).length
      );
    }, 0);
    const workflowEventCount = state.changeRequests.filter(
      (request) =>
        (!projectId || request.projectId === projectId) &&
        inWindow(request.createdAtTs, bucketStart, bucketEnd)
    ).length;
    const label =
      granularity === "week"
        ? `第${index + 1}周`
        : `${bucketStart.getUTCMonth() + 1}/${bucketStart.getUTCDate()}`;
    buckets.push({
      bucketStart: bucketStart.toISOString(),
      label,
      changeCount,
      workflowEventCount
    });
  }

  return buckets;
}

function buildRiskBuckets(state: PrototypeState, projectId?: string): ProjectRiskBucket[] {
  return state.configDraft.projects
    .filter((project) => !projectId || project.id === projectId)
    .map((project) => {
      const parameters = state.parameters.filter((parameter) => parameter.projectId === project.id);
      const high = parameters.filter((parameter) => parameter.risk === "High").length;
      const medium = parameters.filter((parameter) => parameter.risk === "Medium").length;
      const low = parameters.filter((parameter) => parameter.risk === "Low").length;
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

function buildWorkbenchSignals(state: PrototypeState, _userId: string, projectId?: string) {
  const openStatuses = new Set(["待审阅", "硬件Committer检视", "软件Committer检视", "软件User合入", "等待合入", "自动检查通过"]);
  const reviewQueue = state.changeRequests.filter(
    (request) =>
      (!projectId || request.projectId === projectId) && openStatuses.has(request.status)
  ).length;
  const myDrafts = state.parameterDrafts.filter((draft) => !projectId || draft.projectId === projectId).length;
  const returnedChanges = state.changeRequests.filter(
    (request) =>
      request.submitter === state.users.find((user) => user.id === _userId)?.name &&
      request.status === "已打回" &&
      (!projectId || request.projectId === projectId)
  ).length;
  const waitingMerge = state.changeRequests.filter(
    (request) =>
      request.status === "软件User合入" && (!projectId || request.projectId === projectId)
  ).length;

  return {
    reviewQueue,
    myDrafts,
    returnedChanges,
    waitingMerge,
    unappliedImportBatches: 0,
    inactiveAccounts: state.users.filter((user) => !user.isActive).length
  };
}

type HotspotGroup = {
  id: string;
  kind: DashboardHotspot["kind"];
  title: string;
  projectId?: string;
  projectCode: string;
  module: string;
  parameters: ParameterRecord[];
  relatedRequests: ChangeRequest[];
};

function buildHotspotPath(group: HotspotGroup) {
  if (group.kind === "module") {
    return group.relatedRequests.length > 0
      ? `/parameter-review?module=${encodeURIComponent(group.module)}`
      : `/parameters?module=${encodeURIComponent(group.module)}`;
  }
  if (group.kind === "project") {
    return group.relatedRequests.length > 0
      ? `/parameter-review?project=${encodeURIComponent(group.projectId ?? group.id)}`
      : `/parameters?project=${encodeURIComponent(group.projectId ?? group.id)}`;
  }
  return group.relatedRequests.length > 0
    ? `/parameter-review?project=${encodeURIComponent(group.projectId ?? "")}&parameter=${encodeURIComponent(group.id)}`
    : `/parameters?project=${encodeURIComponent(group.projectId ?? "")}&parameter=${encodeURIComponent(group.id)}`;
}

function groupHotspots(
  state: PrototypeState,
  dimension: HotspotDimension,
  windowedRequests: ChangeRequest[],
  projectId?: string
): HotspotGroup[] {
  const parameters = filterParameters(state, projectId);
  const projectCodes = new Map(state.configDraft.projects.map((project) => [project.id, project.code]));

  if (dimension === "overall") {
    return [
      ...groupHotspots(state, "module", windowedRequests, projectId),
      ...groupHotspots(state, "project", windowedRequests, projectId),
      ...groupHotspots(state, "parameter", windowedRequests, projectId)
    ];
  }

  const groups = new Map<string, HotspotGroup>();
  for (const parameter of parameters) {
    const groupId =
      dimension === "module" ? parameter.module : dimension === "project" ? parameter.projectId : parameter.id;
    const kind = dimension;
    const key = `${kind}:${groupId}`;
    const existing = groups.get(key);
    const relatedRequests = windowedRequests.filter((request) => request.parameterId === parameter.id);
    if (existing) {
      existing.parameters.push(parameter);
      existing.relatedRequests.push(...relatedRequests);
    } else {
      groups.set(key, {
        id: groupId,
        kind,
        title:
          kind === "module"
            ? parameter.module
            : kind === "project"
              ? projectCodes.get(parameter.projectId) ?? parameter.projectId
              : parameter.name,
        projectId: kind === "project" ? groupId : parameter.projectId,
        projectCode:
          kind === "project"
            ? projectCodes.get(groupId) ?? groupId
            : kind === "parameter"
              ? projectCodes.get(parameter.projectId) ?? parameter.projectId
              : `${new Set(parameters.filter((item) => item.module === parameter.module).map((item) => item.projectId)).size} 个项目`,
        module: kind === "module" ? groupId : kind === "parameter" ? parameter.module : "项目参数",
        parameters: [parameter],
        relatedRequests: [...relatedRequests]
      });
    }
  }

  return Array.from(groups.values());
}

function mapGroupToHotspot(group: HotspotGroup, window: DashboardWindow): DashboardHotspot {
  const highRiskCount = group.parameters.filter((parameter) => parameter.risk === "High").length;
  const riskWeightSum = group.parameters.reduce((total, parameter) => total + riskWeight[parameter.risk], 0);
  const driftSum = group.parameters.reduce((total, parameter) => total + driftScore(parameter), 0);
  const scored = scoreHotspotGroup(
    {
      parameterCount: group.parameters.length,
      relatedRequestCount: group.relatedRequests.length,
      definitionCount: new Set(group.parameters.map((parameter) => parameter.name)).size,
      logSignalCount: 0,
      highRiskCount,
      riskWeightSum,
      driftSum
    },
    WINDOW_PROFILES[window]
  );
  const status = mapHotspotStatus(highRiskCount, scored.score);
  return {
    id: `${group.kind}:${group.id}`,
    kind: group.kind,
    title: group.title,
    projectId: group.projectId,
    projectCode: group.projectCode,
    module: group.module,
    statusLabel: status.label,
    statusLevel: status.level,
    score: scored.score,
    scoreBreakdown: {
      frequency: scored.frequency,
      risk: scored.risk,
      impact: scored.impact,
      workflow: scored.workflow,
      drift: scored.drift
    },
    evidence: [
      `${highRiskCount} 个高风险参数`,
      `${Math.round(driftSum)}% 累计推荐偏离`,
      `${group.relatedRequests.length} 个审核或变更请求`
    ],
    trendDelta: 0,
    trendDirection: "flat",
    lastChangedAt: group.relatedRequests[0]?.createdAtTs,
    suggestedPath: buildHotspotPath(group)
  };
}

function pickOverallHotspots(hotspots: DashboardHotspot[]) {
  const sorted = [...hotspots].sort((first, second) => second.score - first.score);
  const requiredKinds: DashboardHotspot["kind"][] = ["module", "project", "parameter"];
  const picked: DashboardHotspot[] = [];
  const pickedIds = new Set<string>();
  for (const kind of requiredKinds) {
    const best = sorted.find((hotspot) => hotspot.kind === kind);
    if (best) {
      picked.push(best);
      pickedIds.add(best.id);
    }
  }
  for (const candidate of sorted) {
    if (picked.length >= 5) break;
    if (!pickedIds.has(candidate.id)) {
      picked.push(candidate);
      pickedIds.add(candidate.id);
    }
  }
  return picked.sort((first, second) => second.score - first.score).slice(0, 5);
}

export function createMockParameterDashboardRepository(getState: () => PrototypeState): ParameterDashboardRepository {
  return {
    async listDashboardSummary(input) {
      const state = getState();
      const { windowStart } = resolveWindowBounds(input.window);
      const parameters = filterParameters(state, input.projectId);
      const windowedRequests = filterChangeRequests(state, windowStart, new Date(), input.projectId);
      const contributors = new Set(
        windowedRequests.map((request) => request.submitter).filter(Boolean)
      );

      const summary: DashboardSummary = {
        window: input.window,
        windowLabel: windowLabels[input.window],
        projectId: input.projectId ?? null,
        kpis: {
          totalParameters: parameters.length,
          managedProjects: input.projectId
            ? 1
            : new Set(parameters.map((parameter) => parameter.projectId)).size,
          changeFrequency: windowedRequests.length,
          activeContributors: contributors.size,
          highRiskParameters: parameters.filter((parameter) => parameter.risk === "High").length
        },
        trend: buildTrend(state, input.window, input.projectId),
        riskBuckets: buildRiskBuckets(state, input.projectId),
        workbenchSignals: buildWorkbenchSignals(state, state.currentUserId, input.projectId)
      };
      return summary;
    },
    async listDashboardHotspots(input) {
      const state = getState();
      const { windowStart, windowEnd } = resolveWindowBounds(input.window);
      const windowedRequests = filterChangeRequests(state, windowStart, windowEnd, input.projectId);
      const groups = groupHotspots(state, input.dimension, windowedRequests, input.projectId);
      const hotspots = groups.map((group) => mapGroupToHotspot(group, input.window)).sort((a, b) => b.score - a.score);
      return input.dimension === "overall" ? pickOverallHotspots(hotspots) : hotspots;
    }
  };
}
