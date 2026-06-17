import { canAccessPage } from "@/app/permissions";
import {
  getPlatformRole,
  migrateLegacyRoleId,
  type PlatformRoleId
} from "@/domain/users/types";
import type { PageKey } from "./appConfig";
import type { ParameterSubmissionRound, PrototypeState } from "./mockData";
import { canActOnReviewRequest } from "@/domain/parameters/reviewQueue";
import type { ParameterHomepageAnalytics, ParameterHotspot } from "./parameterHomepageAnalytics";

export type WorkbenchRoleView = "guest" | "user" | "committer" | "admin";
export type WorkbenchActionKind = "todo" | "recommendation" | "readonly";
export type WorkbenchActionPriority = "primary" | "secondary";
export type WorkbenchEmptyState = "has-todos" | "recommendations" | "quiet";

export type WorkbenchAction = {
  id: string;
  kind: WorkbenchActionKind;
  priority: WorkbenchActionPriority;
  title: string;
  description: string;
  meta: string;
  path: string;
  source: "submission" | "review" | "initialization" | "admin" | "hotspot" | "readonly";
};

export type WorkbenchScenarioEntry = {
  id: string;
  title: string;
  description: string;
  path: string;
  action?: "new-project";
  pageKey: PageKey;
  metricLabel: string;
  metricValue: string;
};

export type PersonalWorkbenchViewModel = {
  roleView: WorkbenchRoleView;
  roleLabel: string;
  summary: string;
  emptyState: WorkbenchEmptyState;
  nextActions: WorkbenchAction[];
  scenarioEntries: WorkbenchScenarioEntry[];
};

export function derivePersonalWorkbench(
  state: PrototypeState,
  analytics: ParameterHomepageAnalytics
): PersonalWorkbenchViewModel {
  const roleId = migrateLegacyRoleId(state.activeRoleId);
  const role = getPlatformRole(roleId);
  const roleView = getWorkbenchRoleView(roleId);
  const realActions = buildRealActions(state, analytics, roleId, roleView);
  const recommendationActions = buildRecommendationActions(analytics, roleView);
  const quietActions = buildQuietActions(roleView);
  const hasTodos = realActions.length > 0;
  const nextActions = markPriorities(
    hasTodos
      ? [...realActions, ...recommendationActions].slice(0, 5)
      : [...recommendationActions, ...quietActions].slice(0, 5)
  );

  return {
    roleView,
    roleLabel: role.name,
    summary: buildSummary(roleView, hasTodos, nextActions, analytics),
    emptyState: hasTodos ? "has-todos" : recommendationActions.length > 0 ? "recommendations" : "quiet",
    nextActions,
    scenarioEntries: buildScenarioEntries(state, analytics, roleId, roleView)
  };
}

function getWorkbenchRoleView(roleId: PlatformRoleId): WorkbenchRoleView {
  const role = getPlatformRole(roleId);

  if (role.level === "admin") return "admin";
  if (role.level === "committer") return "committer";
  if (role.level === "user") return "user";
  return "guest";
}

function buildRealActions(
  state: PrototypeState,
  analytics: ParameterHomepageAnalytics,
  roleId: PlatformRoleId,
  roleView: WorkbenchRoleView
): WorkbenchAction[] {
  if (roleView === "guest") return [];
  if (roleView === "admin") return buildAdminActions(state, analytics);
  if (roleView === "committer") return buildCommitterActions(state, roleId);
  return buildUserActions(state, roleId);
}

function buildUserActions(state: PrototypeState, roleId: PlatformRoleId): WorkbenchAction[] {
  const submitter = getPlatformRole(roleId).name;
  const userRounds = state.parameterSubmissionRounds.filter(
    (round) => roundHasValidReferences(state, round) && round.submitter === submitter
  );
  const stashedRound = userRounds.find((round) => round.status === "已暂存");
  const rejectedRound = userRounds.find((round) => round.status === "已打回");
  const actions: WorkbenchAction[] = [];

  if (stashedRound) {
    actions.push({
      id: `user-draft-${stashedRound.id}`,
      kind: "todo",
      priority: "secondary",
      title: "继续未提交的参数草稿",
      description: stashedRound.summary,
      meta: `${stashedRound.items.length} 项参数 · ${stashedRound.projectName}`,
      path: "/parameters",
      source: "submission"
    });
  }

  if (rejectedRound) {
    actions.push({
      id: `user-rejected-${rejectedRound.id}`,
      kind: "todo",
      priority: "secondary",
      title: "补充被退回的参数修改",
      description: rejectedRound.summary,
      meta: `${rejectedRound.items.length} 项参数 · ${rejectedRound.createdAt}`,
      path: "/parameter-submissions",
      source: "submission"
    });
  }

  const mergeRequests = getReviewRequests(state, roleId);
  if (mergeRequests.length > 0 && canAccessPage(roleId, "parameter-review")) {
    actions.push({
      id: "user-merge-queue",
      kind: "todo",
      priority: "secondary",
      title: "处理待合入参数变更",
      description: "参数变更已进入软件开发人员合入节点，请在参数审阅页完成最后一步推进。",
      meta: `${mergeRequests.length} 项待合入`,
      path: "/parameter-review",
      source: "review"
    });
  }

  return actions;
}

function roundHasValidReferences(state: PrototypeState, round: ParameterSubmissionRound) {
  const projectExists = state.configDraft.projects.some((project) => project.id === round.projectId);
  const parameterIds = new Set(state.parameters.map((parameter) => parameter.id));
  return projectExists && round.items.every((item) => parameterIds.has(item.parameterId));
}

function buildCommitterActions(state: PrototypeState, roleId: PlatformRoleId): WorkbenchAction[] {
  const reviewRequests = getReviewRequests(state, roleId);
  const initializationCount = state.parameterInitializationReviews.filter((review) => review.status === "pending").length;
  const actions: WorkbenchAction[] = [];

  if (reviewRequests.length > 0) {
    const highRiskCount = reviewRequests.filter((request) => request.impact.some((item) => item.risk === "High")).length;

    actions.push({
      id: "committer-review-queue",
      kind: "todo",
      priority: "secondary",
      title: "处理待审阅参数变更",
      description: "优先处理已进入当前角色审阅节点的参数修改。",
      meta: `${reviewRequests.length} 项待审阅 · ${highRiskCount} 项高风险`,
      path: "/parameter-review",
      source: "review"
    });
  }

  if (initializationCount > 0) {
    actions.push({
      id: "committer-initialization-review",
      kind: "todo",
      priority: "secondary",
      title: "审阅项目初始化申请",
      description: "新项目参数初始化正在等待 Committer 检视。",
      meta: `${initializationCount} 个项目`,
      path: "/parameter-review",
      source: "initialization"
    });
  }

  return actions;
}

function buildAdminActions(state: PrototypeState, analytics: ParameterHomepageAnalytics): WorkbenchAction[] {
  const actions: WorkbenchAction[] = [];
  const hasUnexportedConfig = JSON.stringify(state.configDraft) !== state.lastExportedSnapshot;
  const inactiveUsers = state.users.filter((user) => !user.isActive).length;

  if (hasUnexportedConfig) {
    actions.push({
      id: "admin-export-config",
      kind: "todo",
      priority: "secondary",
      title: "导出未保存的参数配置",
      description: "参数库配置已有本地修改，需要进入管理后台导出或保存。",
      meta: "配置待导出",
      path: "/parameter-admin",
      source: "admin"
    });
  }

  if (inactiveUsers > 0) {
    actions.push({
      id: "admin-user-review",
      kind: "todo",
      priority: "secondary",
      title: "检查用户与权限状态",
      description: "存在停用或需复核的用户账号。",
      meta: `${inactiveUsers} 个账号需关注`,
      path: "/user-permissions",
      source: "admin"
    });
  }

  if (analytics.summary.highRiskParameters > 0) {
    actions.push({
      id: "admin-high-risk-library",
      kind: "todo",
      priority: "secondary",
      title: "打开管理后台查看高风险参数",
      description: "参数库中仍有高风险定义，建议复核治理配置。",
      meta: `${analytics.summary.highRiskParameters} 项高风险`,
      path: "/parameter-admin",
      source: "admin"
    });
  }

  return actions;
}

function getReviewRequests(state: PrototypeState, roleId: PlatformRoleId) {
  return state.changeRequests.filter((request) => canActOnReviewRequest(roleId, request));
}

function buildRecommendationActions(
  analytics: ParameterHomepageAnalytics,
  roleView: WorkbenchRoleView
): WorkbenchAction[] {
  if (roleView === "guest") {
    return [
      {
        id: "guest-readonly-hotspots",
        kind: "readonly",
        priority: "secondary",
        title: "查看当前参数风险热区",
        description: analytics.opsHeadline,
        meta: `${analytics.hotspots.length} 个热区`,
        path: "/parameter-home",
        source: "readonly"
      }
    ];
  }

  return analytics.hotspots.slice(0, 3).map((hotspot) => ({
    id: `hotspot-${hotspot.id}`,
    kind: "recommendation",
    priority: "secondary",
    title: recommendationTitleFor(roleView, hotspot),
    description: hotspot.explanation,
    meta: `${hotspot.status} · 热度 ${hotspot.score.toFixed(1)}`,
    path: recommendationPathFor(roleView, hotspot),
    source: "hotspot"
  }));
}

function recommendationTitleFor(roleView: WorkbenchRoleView, hotspot: ParameterHotspot) {
  if (roleView === "committer") return `创建高风险专项审阅：${hotspot.title}`;
  if (roleView === "admin") return `复核管理后台风险配置：${hotspot.title}`;
  return `从高风险参数开始修改：${hotspot.title}`;
}

function recommendationPathFor(roleView: WorkbenchRoleView, hotspot: ParameterHotspot) {
  if (roleView === "committer") return hotspot.suggestedPath.startsWith("/parameter-review") ? hotspot.suggestedPath : "/parameter-review";
  if (roleView === "admin") return "/parameter-admin";
  return hotspot.suggestedPath.startsWith("/parameters") ? hotspot.suggestedPath : "/parameters";
}

function buildQuietActions(roleView: WorkbenchRoleView): WorkbenchAction[] {
  if (roleView === "guest") {
    return [
      {
        id: "guest-view-parameters",
        kind: "readonly",
        priority: "secondary",
        title: "查看参数目录",
        description: "当前角色可浏览参数信息，但不能提交或审阅变更。",
        meta: "只读",
        path: "/parameters",
        source: "readonly"
      }
    ];
  }

  return [
    {
      id: "quiet-view-parameters",
      kind: "readonly",
      priority: "secondary",
      title: "查看参数目录",
      description: "今天没有必须处理的事项，可以从参数目录开始查看。",
      meta: "空闲状态",
      path: "/parameters",
      source: "readonly"
    }
  ];
}

function markPriorities(actions: WorkbenchAction[]) {
  return actions.map((action, index) => ({
    ...action,
    priority: (index === 0 ? "primary" : "secondary") as WorkbenchActionPriority
  }));
}

function buildScenarioEntries(
  state: PrototypeState,
  analytics: ParameterHomepageAnalytics,
  roleId: PlatformRoleId,
  roleView: WorkbenchRoleView
): WorkbenchScenarioEntry[] {
  const candidates: WorkbenchScenarioEntry[] =
    roleView === "admin"
      ? [
          entry("admin", "管理后台", "维护参数库、导入导出与审计记录。", "/parameter-admin", "parameter-admin", "高风险", analytics.summary.highRiskParameters),
          {
            ...entry("new-project", "新建项目", "启动项目参数初始化流程。", "/parameter-home", "parameter-home", "项目", state.configDraft.projects.length),
            action: "new-project" as const
          },
          entry("users", "用户管理", "维护平台角色与账号权限。", "/user-permissions", "user-permissions", "账号", state.users.length)
        ]
      : roleView === "committer"
        ? [
            entry("review", "处理审阅", "进入当前角色的参数审阅队列。", "/parameter-review", "parameter-review", "待审", getReviewRequests(state, roleId).length),
            entry("risk", "高风险专项", "按风险热区聚焦审阅对象。", "/parameter-review", "parameter-review", "热区", analytics.hotspots.length),
            entry("library", "查看参数库", "回到参数目录核对上下文。", "/parameters", "parameters", "参数", state.parameters.length)
          ]
        : roleView === "user"
          ? [
              entry("edit", "修改参数", "从参数目录选择可维护参数。", "/parameters", "parameters", "参数", state.parameters.length),
              entry("submissions", "我的提交", "查看草稿、退回与合入状态。", "/parameter-submissions", "parameter-submissions", "流程", state.parameterSubmissionRounds.length),
              ...(getReviewRequests(state, roleId).length > 0 && canAccessPage(roleId, "parameter-review")
                ? [
                    entry(
                      "merge",
                      "参数合入",
                      "处理已进入软件开发人员合入节点的变更。",
                      "/parameter-review",
                      "parameter-review",
                      "待合入",
                      getReviewRequests(state, roleId).length
                    )
                  ]
                : []),
              entry("hotspots", "风险热区", "按风险建议选择下一次修改对象。", "/parameter-home", "parameter-home", "热区", analytics.hotspots.length)
            ]
          : [
              entry("read-parameters", "查看参数", "浏览参数目录与当前配置。", "/parameters", "parameters", "参数", state.parameters.length),
              entry("read-hotspots", "查看风险热区", "了解近期高风险参数变化。", "/parameter-home", "parameter-home", "热区", analytics.hotspots.length)
            ];

  return candidates.filter((candidate) => canAccessPage(roleId, candidate.pageKey));
}

function entry(
  id: string,
  title: string,
  description: string,
  path: string,
  pageKey: PageKey,
  metricLabel: string,
  metricValue: number | string
): WorkbenchScenarioEntry {
  return {
    id,
    title,
    description,
    path,
    pageKey,
    metricLabel,
    metricValue: String(metricValue)
  };
}

function buildSummary(
  roleView: WorkbenchRoleView,
  hasTodos: boolean,
  actions: WorkbenchAction[],
  analytics: ParameterHomepageAnalytics
) {
  if (roleView === "admin") return hasTodos ? "管理项已按影响范围排序，直接进入后台处理。" : "当前没有必须处理的管理事项，可从后台或项目初始化入口开始。";
  if (roleView === "committer") return hasTodos ? "待审阅事项已排在最前，优先处理流程节点。" : "当前没有审阅待办，工作台按风险热区推荐检查方向。";
  if (roleView === "user") return hasTodos ? "未提交或被退回的流程事项排在最前。" : "当前没有流程待办，建议从风险热区开始选择参数。";
  return actions.length > 0 ? "当前为只读视角，可先查看参数目录和风险热区。" : analytics.opsHeadline;
}
