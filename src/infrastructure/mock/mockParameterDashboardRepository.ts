import type { ParameterDashboardRepository } from "@/application/ports/ParameterDashboardRepository";
import type {
  DashboardHotspot,
  DashboardSummary,
  DashboardWindow,
  HotspotDimension,
  PersonalDashboardKpis,
  ProjectRiskBucket,
  TrendPoint
} from "@/domain/parameters/dashboardTypes";
import {
  buildBehavioralHotspotEvidence,
  mapBehavioralHotspotStatus,
  BEHAVIORAL_WINDOW_PROFILES,
  scoreBehavioralHotspot,
  type BehavioralScoreInput
} from "@/domain/parameters/projectHotspotScoring";
import { canActOnReviewRequest } from "@/domain/parameters/reviewQueue";
import { getPlatformRole, migrateLegacyRoleId } from "@/domain/users/types";
import type { ChangeRequest, ParameterRecord, PrototypeState } from "@/mockData";

const windowLabels: Record<DashboardWindow, string> = {
  "7d": "近 7 天",
  "30d": "近 30 天",
  "180d": "近 180 天"
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

function matchesCurrentUser(actor: string, userId: string, userName?: string) {
  return actor === userId || actor === userName;
}

function buildPersonalTrend(
  state: PrototypeState,
  window: DashboardWindow,
  projectId: string | undefined,
  userId: string,
  roleLevel: "guest" | "user" | "committer" | "admin"
): TrendPoint[] {
  if (roleLevel === "guest") {
    return [];
  }

  const user = state.users.find((entry) => entry.id === userId);
  const { windowStart, granularity, days } = resolveWindowBounds(window);
  const bucketCount = granularity === "week" ? Math.ceil(days / 7) : days;
  const stepMs = granularity === "week" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const buckets: TrendPoint[] = [];

  for (let index = 0; index < bucketCount; index += 1) {
    const bucketStart = new Date(windowStart.getTime() + index * stepMs);
    const bucketEnd = new Date(bucketStart.getTime() + stepMs);
    let changeCount = 0;
    let workflowEventCount = 0;

    if (roleLevel === "committer") {
      const decisions = state.parameterReviewDecisions.filter(
        (decision) =>
          decision.reviewerUserId === userId &&
          inWindow(decision.createdAt, bucketStart, bucketEnd) &&
          (!projectId ||
            state.changeRequests.some(
              (request) => request.id === decision.requestId && request.projectId === projectId
            ))
      );
      changeCount = new Set(decisions.map((decision) => decision.requestId)).size;
      workflowEventCount = decisions.length;
    } else if (roleLevel === "admin") {
      changeCount = state.auditEvents.filter(
        (event) =>
          event.userId === userId &&
          (event.app === "parameter-admin" || event.app === "user-permissions" || event.kind === "batch-import")
      ).length;
      workflowEventCount = 0;
    } else {
      changeCount = state.parameters.reduce((total, parameter) => {
        if (projectId && parameter.projectId !== projectId) return total;
        return (
          total +
          parameter.history.filter(
            (entry) =>
              matchesCurrentUser(entry.changedBy, userId, user?.name) &&
              inWindow(entry.changedAt, bucketStart, bucketEnd)
          ).length
        );
      }, 0);
      workflowEventCount = state.changeRequests.filter(
        (request) =>
          (!projectId || request.projectId === projectId) &&
          matchesCurrentUser(request.submitter, userId, user?.name) &&
          inWindow(request.createdAtTs, bucketStart, bucketEnd)
      ).length;
    }

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

function buildPersonalKpis(
  state: PrototypeState,
  window: DashboardWindow,
  projectId: string | undefined,
  roleLevel: "guest" | "user" | "committer" | "admin",
  perspectiveRoleId: string
): PersonalDashboardKpis {
  if (roleLevel === "guest") {
    return {
      contributionCount: 0,
      workflowCount: 0,
      openItemCount: 0,
      pendingTodoCount: 0,
      highRiskTouchCount: 0
    };
  }

  const user = state.users.find((entry) => entry.id === state.currentUserId);
  const { windowStart } = resolveWindowBounds(window);
  const windowEnd = new Date();
  const signals = buildWorkbenchSignals(state, state.currentUserId, projectId);
  const parameters = filterParameters(state, projectId);
  const scopedRequests = state.changeRequests.filter((request) => !projectId || request.projectId === projectId);
  const roleId = migrateLegacyRoleId(perspectiveRoleId);

  if (roleLevel === "committer") {
    const windowDecisions = state.parameterReviewDecisions.filter(
      (decision) =>
        decision.reviewerUserId === state.currentUserId &&
        inWindow(decision.createdAt, windowStart, windowEnd) &&
        scopedRequests.some((request) => request.id === decision.requestId)
    );
    const pendingReviews = scopedRequests.filter(
      (request) => !["已合入", "已打回"].includes(request.status) && canActOnReviewRequest(roleId, request)
    );
    const requestRisk = (requestId: string) =>
      parameters.find((parameter) => parameter.id === scopedRequests.find((entry) => entry.id === requestId)?.parameterId)?.risk;
    const highRiskPending = pendingReviews.filter((request) => requestRisk(request.id) === "High");
    const highRiskReviewRequestIds = new Set(
      windowDecisions.filter((decision) => requestRisk(decision.requestId) === "High").map((decision) => decision.requestId)
    );

    return {
      contributionCount: new Set(windowDecisions.map((decision) => decision.requestId)).size,
      workflowCount: windowDecisions.length,
      openItemCount: pendingReviews.length,
      pendingTodoCount: highRiskPending.length,
      highRiskTouchCount: highRiskReviewRequestIds.size
    };
  }

  if (roleLevel === "admin") {
    const governanceEvents = state.auditEvents.filter(
      (event) =>
        event.userId === state.currentUserId &&
        (event.app === "parameter-admin" || event.app === "user-permissions" || event.kind === "batch-import")
    );
    return {
      contributionCount: governanceEvents.length,
      workflowCount: 0,
      openItemCount: signals.unappliedImportBatches,
      pendingTodoCount: signals.inactiveAccounts,
      highRiskTouchCount: governanceEvents.filter((event) => event.severity === "High").length
    };
  }

  const contributionCount = parameters.reduce(
    (total, parameter) =>
      total +
      parameter.history.filter(
        (entry) =>
          matchesCurrentUser(entry.changedBy, state.currentUserId, user?.name) &&
          inWindow(entry.changedAt, windowStart, windowEnd)
      ).length,
    0
  );
  const workflowCount = state.changeRequests.filter(
    (request) =>
      (!projectId || request.projectId === projectId) &&
      matchesCurrentUser(request.submitter, state.currentUserId, user?.name) &&
      inWindow(request.createdAtTs, windowStart, windowEnd)
  ).length;
  const highRiskTouchCount = parameters.reduce((total, parameter) => {
    if (parameter.risk !== "High") return total;
    return (
      total +
      parameter.history.filter(
        (entry) =>
          matchesCurrentUser(entry.changedBy, state.currentUserId, user?.name) &&
          inWindow(entry.changedAt, windowStart, windowEnd)
      ).length
    );
  }, 0);

  return {
    contributionCount,
    workflowCount,
    highRiskTouchCount,
    openItemCount: signals.myDrafts,
    pendingTodoCount: signals.returnedChanges + signals.waitingMerge
  };
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
    ? `/parameter-review?parameter=${encodeURIComponent(group.id)}`
    : `/parameters?parameter=${encodeURIComponent(group.id)}`;
}

function groupHotspots(
  state: PrototypeState,
  dimension: HotspotDimension,
  windowedRequests: ChangeRequest[],
  projectId?: string
): HotspotGroup[] {
  const parameters = filterParameters(state, projectId);
  const projectCodes = new Map(state.configDraft.projects.map((project) => [project.id, project.code]));

  const groups = new Map<string, HotspotGroup>();
  for (const parameter of parameters) {
    const groupId =
      dimension === "module"
        ? parameter.module
        : dimension === "project"
          ? parameter.projectId
          : parameter.name;
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
        projectId: kind === "project" ? groupId : kind === "parameter" ? undefined : parameter.projectId,
        projectCode:
          kind === "project"
            ? projectCodes.get(groupId) ?? groupId
            : kind === "parameter"
              ? ""
              : `${new Set(parameters.filter((item) => item.module === parameter.module).map((item) => item.projectId)).size} 个项目`,
        module: kind === "module" ? groupId : kind === "parameter" ? parameter.module : "项目参数",
        parameters: [parameter],
        relatedRequests: [...relatedRequests]
      });
    }
  }

  return Array.from(groups.values()).map((group) => {
    if (dimension === "parameter") {
      const projectCount = new Set(group.parameters.map((parameter) => parameter.projectId)).size;
      return { ...group, projectId: undefined, projectCode: `${projectCount} 个项目` };
    }
    return group;
  });
}

function buildParameterScopeCounts(group: HotspotGroup, allScopedRequests: ChangeRequest[]) {
  const projectIds = new Set(group.parameters.map((parameter) => parameter.projectId));
  const modifiedProjectIds = new Set<string>();

  for (const parameter of group.parameters) {
    const hasModification =
      allScopedRequests.some((request) => request.parameterId === parameter.id) || parameter.history.length > 1;
    if (hasModification) {
      modifiedProjectIds.add(parameter.projectId);
    }
  }

  return { total: projectIds.size, modified: modifiedProjectIds.size };
}

function buildParameterBehavioralScoreInput(
  group: HotspotGroup,
  windowedRequests: ChangeRequest[],
  allScopedRequests: ChangeRequest[]
): BehavioralScoreInput {
  const openStatuses = new Set([
    "待审阅",
    "硬件Committer检视",
    "软件Committer检视",
    "软件User合入",
    "等待合入",
    "自动检查通过"
  ]);
  const { total, modified } = buildParameterScopeCounts(group, allScopedRequests);

  return {
    historyEventsInWindow: windowedRequests.length * 2,
    changeRequestsInWindow: windowedRequests.length,
    modifiedParamCount: modified,
    totalParamCount: total,
    openRequestCount: allScopedRequests.filter((request) => openStatuses.has(request.status)).length,
    returnedInWindow: windowedRequests.filter((request) => request.status === "已打回").length,
    contributorsInWindow: new Set(windowedRequests.map((request) => request.submitter).filter(Boolean)).size,
    contributorsAllTime: new Set(allScopedRequests.map((request) => request.submitter).filter(Boolean)).size
  };
}

function buildMockBehavioralScoreInput(
  group: HotspotGroup,
  windowedRequests: ChangeRequest[],
  allRequests: ChangeRequest[]
): BehavioralScoreInput {
  const openStatuses = new Set([
    "待审阅",
    "硬件Committer检视",
    "软件Committer检视",
    "软件User合入",
    "等待合入",
    "自动检查通过"
  ]);
  const modifiedParameterIds = new Set(allRequests.map((request) => request.parameterId));

  return {
    historyEventsInWindow: windowedRequests.length * 2,
    changeRequestsInWindow: windowedRequests.length,
    modifiedParamCount: modifiedParameterIds.size,
    totalParamCount: group.parameters.length,
    openRequestCount: allRequests.filter((request) => openStatuses.has(request.status)).length,
    returnedInWindow: windowedRequests.filter((request) => request.status === "已打回").length,
    contributorsInWindow: new Set(windowedRequests.map((request) => request.submitter).filter(Boolean)).size,
    contributorsAllTime: new Set(allRequests.map((request) => request.submitter).filter(Boolean)).size
  };
}

function mapBehavioralHotspotFromGroup(
  group: HotspotGroup,
  window: DashboardWindow,
  scoreInput: BehavioralScoreInput
): DashboardHotspot {
  const scored = scoreBehavioralHotspot(scoreInput, BEHAVIORAL_WINDOW_PROFILES[window]);
  const status = mapBehavioralHotspotStatus({ ...scoreInput, score: scored.score });

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
      scope: scored.scope,
      workflow: scored.workflow,
      collaboration: scored.collaboration
    },
    evidence: buildBehavioralHotspotEvidence(scoreInput, group.kind),
    trendDelta: 0,
    trendDirection: "flat",
    lastChangedAt: group.relatedRequests[0]?.createdAtTs,
    suggestedPath: buildHotspotPath(group)
  };
}

function mapGroupToHotspot(group: HotspotGroup, window: DashboardWindow, state: PrototypeState): DashboardHotspot {
  if (group.kind === "project") {
    const projectId = group.projectId ?? group.id;
    const allProjectRequests = state.changeRequests.filter((request) => request.projectId === projectId);
    return mapBehavioralHotspotFromGroup(
      group,
      window,
      buildMockBehavioralScoreInput(group, group.relatedRequests, allProjectRequests)
    );
  }

  if (group.kind === "module") {
    const parameterIds = new Set(group.parameters.map((parameter) => parameter.id));
    const allModuleRequests = state.changeRequests.filter((request) => parameterIds.has(request.parameterId));
    return mapBehavioralHotspotFromGroup(
      group,
      window,
      buildMockBehavioralScoreInput(group, group.relatedRequests, allModuleRequests)
    );
  }

  const parameterIds = new Set(group.parameters.map((parameter) => parameter.id));
  const allParameterRequests = state.changeRequests.filter((request) => parameterIds.has(request.parameterId));
  return mapBehavioralHotspotFromGroup(
    group,
    window,
    buildParameterBehavioralScoreInput(group, group.relatedRequests, allParameterRequests)
  );
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

      const roleLevel = getPlatformRole(migrateLegacyRoleId(state.activeRoleId)).level;
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
        personalKpis: buildPersonalKpis(
          state,
          input.window,
          input.projectId,
          roleLevel,
          input.perspectiveRoleId ?? state.activeRoleId
        ),
        personalTrend: buildPersonalTrend(
          state,
          input.window,
          input.projectId,
          state.currentUserId,
          roleLevel
        ),
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
      return groups.map((group) => mapGroupToHotspot(group, input.window, state)).sort((a, b) => b.score - a.score);
    }
  };
}
