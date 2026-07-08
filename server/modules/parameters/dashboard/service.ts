import type { AuthContext } from "../../auth/types";
import type { Database } from "../../../shared/database/client";
import type {
  DashboardHotspot,
  DashboardSummary,
  DashboardWindow,
  HotspotDimension,
  TrendPoint
} from "../../../../src/domain/parameters/dashboardTypes";
import {
  aggregateRiskDistribution,
  aggregateTrend,
  aggregateWorkbenchSignals,
  countKpis
} from "./repository";
import { aggregateHotspotGroups, type HotspotGroupAggregate } from "./hotspotRepository";
import { mapStatus, scoreHotspotGroup, WINDOW_PROFILES } from "./scoring";

const windowLabels: Record<DashboardWindow, string> = {
  "7d": "近 7 天",
  "30d": "近 30 天",
  "180d": "近 180 天"
};

type ServiceInput = {
  auth: AuthContext;
  projectId?: string;
  window: DashboardWindow;
};

type HotspotServiceInput = ServiceInput & {
  dimension: HotspotDimension;
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function resolveWindowBounds(window: DashboardWindow, now = new Date()) {
  const windowEnd = startOfUtcDay(now);
  const windowStart = new Date(windowEnd);
  const days = window === "7d" ? 7 : window === "30d" ? 30 : 180;
  windowStart.setUTCDate(windowStart.getUTCDate() - days);
  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    granularity: window === "180d" ? ("week" as const) : ("day" as const),
    days
  };
}

function formatDayLabel(bucketStart: string) {
  const date = new Date(bucketStart);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function formatWeekLabel(index: number) {
  return `第${index + 1}周`;
}

function labelTrendPoints(points: Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>, granularity: "day" | "week"): TrendPoint[] {
  return points.map((point, index) => ({
    bucketStart: point.bucketStart,
    label: granularity === "week" ? formatWeekLabel(index) : formatDayLabel(point.bucketStart),
    changeCount: point.changeCount,
    workflowEventCount: point.workflowEventCount
  }));
}

function buildHotspotPath(
  kind: HotspotGroupAggregate["kind"],
  groupId: string,
  projectId: string | undefined,
  module: string,
  relatedRequestCount: number
) {
  if (kind === "module") {
    return relatedRequestCount > 0
      ? `/parameter-review?module=${encodeURIComponent(module)}`
      : `/parameters?module=${encodeURIComponent(module)}`;
  }
  if (kind === "project") {
    return relatedRequestCount > 0
      ? `/parameter-review?project=${encodeURIComponent(groupId)}`
      : `/parameters?project=${encodeURIComponent(groupId)}`;
  }

  return relatedRequestCount > 0
    ? `/parameter-review?project=${encodeURIComponent(projectId ?? "")}&parameter=${encodeURIComponent(groupId)}`
    : `/parameters?project=${encodeURIComponent(projectId ?? "")}&parameter=${encodeURIComponent(groupId)}`;
}

function buildEvidence(group: HotspotGroupAggregate) {
  return [
    `${group.highRiskCount} 个高风险参数`,
    `${Math.round(group.driftSum)}% 累计推荐偏离`,
    `${group.relatedRequestCount} 个审核或变更请求`
  ];
}

function computeTrend(current: number, previous: number): Pick<DashboardHotspot, "trendDelta" | "trendDirection"> {
  if (previous === 0) {
    return { trendDelta: current > 0 ? 100 : 0, trendDirection: current > 0 ? "up" : "flat" };
  }
  const delta = Math.round(((current - previous) / previous) * 100);
  return {
    trendDelta: Math.abs(delta),
    trendDirection: delta > 0 ? "up" : delta < 0 ? "down" : "flat"
  };
}

function mapGroupToHotspot(
  group: HotspotGroupAggregate,
  window: DashboardWindow,
  previousGroup?: HotspotGroupAggregate
): DashboardHotspot {
  const profile = WINDOW_PROFILES[window];
  const scored = scoreHotspotGroup(
    {
      parameterCount: group.parameterCount,
      relatedRequestCount: group.relatedRequestCount,
      definitionCount: group.definitionCount,
      logSignalCount: group.logSignalCount,
      highRiskCount: group.highRiskCount,
      riskWeightSum: group.riskWeightSum,
      driftSum: group.driftSum
    },
    profile
  );
  const status = mapStatus(group.highRiskCount, scored.score);
  const trend = computeTrend(group.relatedRequestCount, previousGroup?.relatedRequestCount ?? 0);

  return {
    id: `${group.kind}:${group.groupId}`,
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
    evidence: buildEvidence(group),
    ...trend,
    lastChangedAt: group.lastChangedAt,
    suggestedPath: buildHotspotPath(group.kind, group.groupId, group.projectId, group.module, group.relatedRequestCount)
  };
}

function pickOverallHotspots(hotspots: DashboardHotspot[], limit = 5) {
  const sorted = [...hotspots].sort((first, second) => second.score - first.score);
  const requiredKinds: Array<DashboardHotspot["kind"]> = ["module", "project", "parameter"];
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
    if (picked.length >= limit) break;
    if (!pickedIds.has(candidate.id)) {
      picked.push(candidate);
      pickedIds.add(candidate.id);
    }
  }

  return picked.sort((first, second) => second.score - first.score).slice(0, limit);
}

export async function getDashboardSummary(db: Database, input: ServiceInput): Promise<DashboardSummary> {
  const organizationId = input.auth.organization.id;
  const { windowStart, windowEnd, granularity } = resolveWindowBounds(input.window);
  const projectId = input.projectId ?? null;

  const [kpis, trendRaw, riskBuckets, workbenchSignals] = await Promise.all([
    countKpis(db, { organizationId, projectId, windowStart }),
    aggregateTrend(db, { organizationId, projectId, windowStart, windowEnd, granularity }),
    aggregateRiskDistribution(db, { organizationId, projectId }),
    aggregateWorkbenchSignals(db, { organizationId, projectId, userId: input.auth.user.id })
  ]);

  return {
    window: input.window,
    windowLabel: windowLabels[input.window],
    projectId,
    kpis,
    trend: labelTrendPoints(trendRaw, granularity),
    personalKpis: {
      contributionCount: 0,
      workflowCount: 0,
      openItemCount: 0,
      pendingTodoCount: 0,
      highRiskTouchCount: 0
    },
    personalTrend: [],
    riskBuckets,
    workbenchSignals
  };
}

export async function getDashboardHotspots(db: Database, input: HotspotServiceInput): Promise<DashboardHotspot[]> {
  const organizationId = input.auth.organization.id;
  const { windowStart, windowEnd, days } = resolveWindowBounds(input.window);
  const previousEnd = windowStart;
  const previousStart = new Date(windowStart);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);
  const projectId = input.projectId ?? null;

  const [currentGroups, previousGroups] = await Promise.all([
    aggregateHotspotGroups(db, {
      organizationId,
      projectId,
      dimension: input.dimension === "overall" ? "overall" : input.dimension,
      windowStart,
      windowEnd
    }),
    aggregateHotspotGroups(db, {
      organizationId,
      projectId,
      dimension: input.dimension === "overall" ? "overall" : input.dimension,
      windowStart: previousStart.toISOString(),
      windowEnd: previousEnd
    })
  ]);

  const previousById = new Map(previousGroups.map((group) => [`${group.kind}:${group.groupId}`, group]));
  const hotspots = currentGroups
    .map((group) => mapGroupToHotspot(group, input.window, previousById.get(`${group.kind}:${group.groupId}`)))
    .sort((first, second) => second.score - first.score);

  if (input.dimension === "overall") {
    return pickOverallHotspots(hotspots);
  }

  return hotspots;
}
