import type { AuthContext } from "../../auth/types";
import type { Database } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import { getProjectById } from "../../projects/repository";
import type {
  DashboardHotspot,
  DashboardSummary,
  DashboardWindow,
  HotspotDimension,
  TrendPoint
} from "../../../../src/domain/parameters/dashboardTypes";
import { getPlatformRole, migrateLegacyRoleId } from "../../../../src/domain/users/types";
import { canReviewParameterStage, canReviewParameters } from "../../parameter-kernel/policy";
import { hasCurrentCanonicalReviewRole } from "../reviewWorkflowRepository";
import {
  aggregatePersonalTrend,
  aggregateRiskDistribution,
  aggregateTrend,
  aggregateWorkbenchSignals,
  countPersonalKpis,
  countKpis
} from "./repository";
import { aggregateHotspotGroups, type HotspotGroupAggregate } from "./hotspotRepository";
import {
  buildBehavioralHotspotEvidence,
  mapBehavioralHotspotStatus,
  BEHAVIORAL_WINDOW_PROFILES,
  scoreBehavioralHotspot,
  toBehavioralScoreInput
} from "../../../../src/domain/parameters/projectHotspotScoring";

const windowLabels: Record<DashboardWindow, string> = {
  "7d": "近 7 天 · 完整 UTC 日（不含今天）",
  "30d": "近 30 天 · 完整 UTC 日（不含今天）",
  "180d": "近 180 天 · 完整 UTC 日（不含今天）"
};

type ServiceInput = {
  auth: AuthContext;
  projectId?: string;
  window: DashboardWindow;
  perspectiveRoleId?: string;
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

function resolveRoleLevel(input: ServiceInput): "guest" | "user" | "committer" | "admin" {
  return getPlatformRole(resolvePerspectiveRoleId(input)).level;
}

function resolvePerspectiveRoleId(input: ServiceInput) {
  const roles = input.auth.roles.filter(
    (role) => role.projectId === null || input.projectId === undefined || role.projectId === input.projectId
  );
  const requested = input.perspectiveRoleId?.trim();
  const heldPerspective = requested && roles.find(
    (role) => migrateLegacyRoleId(role.roleId) === migrateLegacyRoleId(requested)
  );
  if (heldPerspective) return migrateLegacyRoleId(heldPerspective.roleId);
  const levelRank = { guest: 0, user: 1, committer: 2, admin: 3 } as const;
  return roles.reduce<ReturnType<typeof migrateLegacyRoleId>>((selected, role) => {
    const candidate = migrateLegacyRoleId(role.roleId);
    return levelRank[getPlatformRole(candidate).level] > levelRank[getPlatformRole(selected).level] ? candidate : selected;
  }, "guest");
}

function resolveAuthorizedProjectIds(input: ServiceInput): readonly string[] | null {
  if (input.auth.roles.some((role) => role.projectId === null)) return null;
  return [...new Set(input.auth.roles.map((role) => role.projectId).filter((id): id is string => Boolean(id)))];
}

async function assertProjectScope(db: Database, input: ServiceInput) {
  if (!input.projectId) return;
  const project = await getProjectById(db, {
    organizationId: input.auth.organization.id,
    projectId: input.projectId
  });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
      projectId: input.projectId
    });
  }
  const allowed = input.auth.roles.some((role) => role.projectId === null || role.projectId === input.projectId);
  if (!allowed) {
    throw new ApiError("FORBIDDEN", "Parameter dashboard project scope is not allowed.", {
      projectId: input.projectId
    });
  }
}

async function resolveReviewableProjectIds(
  db: Database,
  input: ServiceInput,
  authorizedProjectIds: readonly string[] | null
): Promise<string[]> {
  if (!canReviewParameters(input.auth)) return [];
  const projects = await db.query<{ id: string }>(
    `
      select id
        from public.projects
       where organization_id = $1
         and ($2::text is null or id = $2)
         and ($3::text[] is null or id = any($3::text[]))
       order by id asc
    `,
    [input.auth.organization.id, input.projectId ?? null, authorizedProjectIds]
  );
  const reviewable: string[] = [];
  for (const project of projects.rows) {
    if (!canReviewParameterStage(input.auth, project.id, "software_review")) continue;
    if (await hasCurrentCanonicalReviewRole(db, {
      organizationId: input.auth.organization.id,
      projectId: project.id,
      userId: input.auth.user.id
    })) {
      reviewable.push(project.id);
    }
  }
  return reviewable;
}

function buildHotspotPath(
  kind: HotspotGroupAggregate["kind"],
  groupId: string,
  projectId: string | undefined,
  relatedRequestCount: number
) {
  if (kind === "project") {
    return relatedRequestCount > 0
      ? `/parameter-review?project=${encodeURIComponent(groupId)}`
      : `/parameters?project=${encodeURIComponent(groupId)}`;
  }

  return relatedRequestCount > 0
    ? projectId
      ? `/parameter-review?project=${encodeURIComponent(projectId)}`
      : "/parameter-review"
    : projectId
      ? `/parameters?project=${encodeURIComponent(projectId)}`
      : "/parameters";
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

function computeBehavioralScore(group: HotspotGroupAggregate, window: DashboardWindow) {
  return scoreBehavioralHotspot(toBehavioralScoreInput(group), BEHAVIORAL_WINDOW_PROFILES[window]).score;
}

function mapBehavioralGroupToHotspot(
  group: HotspotGroupAggregate,
  window: DashboardWindow,
  previousGroup?: HotspotGroupAggregate
): DashboardHotspot {
  const scoreInput = toBehavioralScoreInput(group);
  const scored = scoreBehavioralHotspot(scoreInput, BEHAVIORAL_WINDOW_PROFILES[window]);
  const status = mapBehavioralHotspotStatus({ ...scoreInput, score: scored.score });
  const previousScore = previousGroup ? computeBehavioralScore(previousGroup, window) : 0;
  const trend = computeTrend(scored.score, previousScore);

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
      scope: scored.scope,
      workflow: scored.workflow,
      collaboration: scored.collaboration
    },
    evidence: buildBehavioralHotspotEvidence(scoreInput, group.kind),
    ...trend,
    lastChangedAt: group.lastChangedAt,
    suggestedPath: buildHotspotPath(group.kind, group.groupId, group.projectId, group.relatedRequestCount)
  };
}

export async function getDashboardSummary(db: Database, input: ServiceInput): Promise<DashboardSummary> {
  await assertProjectScope(db, input);
  const organizationId = input.auth.organization.id;
  const { windowStart, windowEnd, granularity } = resolveWindowBounds(input.window);
  const projectId = input.projectId ?? null;
  const authorizedProjectIds = resolveAuthorizedProjectIds(input);
  const reviewableProjectIds = await resolveReviewableProjectIds(db, input, authorizedProjectIds);
  const workbenchSignalsPromise = aggregateWorkbenchSignals(db, {
    organizationId,
    projectId,
    authorizedProjectIds,
    reviewableProjectIds,
    userId: input.auth.user.id
  });

  const [kpis, trendRaw, riskBuckets, workbenchSignals] = await Promise.all([
    countKpis(db, { organizationId, projectId, authorizedProjectIds, windowStart, windowEnd }),
    aggregateTrend(db, { organizationId, projectId, authorizedProjectIds, windowStart, windowEnd, granularity }),
    aggregateRiskDistribution(db, { organizationId, projectId, authorizedProjectIds }),
    workbenchSignalsPromise
  ]);
  const roleLevel = resolveRoleLevel(input);
  const perspectiveRoleId = resolvePerspectiveRoleId(input);
  const [personalKpis, personalTrendRaw] = await Promise.all([
    countPersonalKpis(db, {
      organizationId,
      projectId,
      authorizedProjectIds,
      userId: input.auth.user.id,
      windowStart,
      windowEnd,
      perspectiveRoleId,
      workbenchSignals,
      roleLevel
    }),
    aggregatePersonalTrend(db, {
      organizationId,
      projectId,
      authorizedProjectIds,
      userId: input.auth.user.id,
      windowStart,
      windowEnd,
      granularity,
      roleLevel
    })
  ]);

  return {
    window: input.window,
    windowLabel: windowLabels[input.window],
    projectId,
    kpis,
    trend: labelTrendPoints(trendRaw, granularity),
    personalKpis,
    personalTrend: labelTrendPoints(personalTrendRaw, granularity),
    riskBuckets,
    workbenchSignals
  };
}

export async function getDashboardHotspots(db: Database, input: HotspotServiceInput): Promise<DashboardHotspot[]> {
  await assertProjectScope(db, input);
  const organizationId = input.auth.organization.id;
  const { windowStart, windowEnd, days } = resolveWindowBounds(input.window);
  const previousEnd = windowStart;
  const previousStart = new Date(windowStart);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);
  const projectId = input.projectId ?? null;
  const authorizedProjectIds = resolveAuthorizedProjectIds(input);

  const [currentGroups, previousGroups] = await Promise.all([
    aggregateHotspotGroups(db, {
      organizationId,
      projectId,
      authorizedProjectIds,
      dimension: input.dimension,
      windowStart,
      windowEnd
    }),
    aggregateHotspotGroups(db, {
      organizationId,
      projectId,
      authorizedProjectIds,
      dimension: input.dimension,
      windowStart: previousStart.toISOString(),
      windowEnd: previousEnd
    })
  ]);

  const previousById = new Map(previousGroups.map((group) => [`${group.kind}:${group.groupId}`, group]));
  return currentGroups
    .map((group) => mapBehavioralGroupToHotspot(group, input.window, previousById.get(`${group.kind}:${group.groupId}`)))
    .sort((first, second) => second.score - first.score);
}
