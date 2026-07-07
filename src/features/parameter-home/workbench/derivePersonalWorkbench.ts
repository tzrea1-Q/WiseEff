import { canAccessPage } from "@/app/permissions";
import type { PageKey } from "@/appConfig";
import { canActOnReviewRequest } from "@/domain/parameters/reviewQueue";
import type { ChangeRequest } from "@/domain/parameters/types";
import type { DashboardHotspot, WorkbenchSignals } from "@/domain/parameters/dashboardTypes";
import {
  getPlatformRole,
  migrateLegacyRoleId,
  type PlatformRoleId
} from "@/domain/users/types";
import type { ParameterDraftDto } from "@/application/ports/ParameterRepository";

export type WorkbenchRoleView = "guest" | "user" | "committer" | "admin";
export type WorkbenchActionKind = "todo" | "recommendation" | "readonly";
export type WorkbenchActionPriority = "primary" | "secondary";
export type WorkbenchEmphasis = "action-first" | "insight-first";

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
  nextActions: WorkbenchAction[];
  scenarioEntries: WorkbenchScenarioEntry[];
  emphasis: WorkbenchEmphasis;
};

export type DerivePersonalWorkbenchInput = {
  roleId: string;
  signals: WorkbenchSignals;
  changeRequests: ChangeRequest[];
  drafts: ParameterDraftDto[];
  projects: Array<{ id: string; name: string; code: string }>;
  hotspots: DashboardHotspot[];
};

export function derivePersonalWorkbench(input: DerivePersonalWorkbenchInput): PersonalWorkbenchViewModel {
  const roleId = migrateLegacyRoleId(input.roleId);
  const roleView = getWorkbenchRoleView(roleId);
  const realActions = buildRealActions(input, roleId, roleView);
  const recommendationActions = buildRecommendationActions(input.hotspots, roleView);
  const quietActions = buildQuietActions(roleView);
  const hasTodos = realActions.length > 0;
  const nextActions = markPriorities(
    hasTodos
      ? [...realActions, ...recommendationActions].slice(0, 5)
      : [...recommendationActions, ...quietActions].slice(0, 5)
  );

  return {
    roleView,
    nextActions,
    scenarioEntries: buildScenarioEntries(input, roleId, roleView),
    emphasis: roleView === "admin" || roleView === "guest" ? "insight-first" : "action-first"
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
  input: DerivePersonalWorkbenchInput,
  roleId: PlatformRoleId,
  roleView: WorkbenchRoleView
): WorkbenchAction[] {
  if (roleView === "guest") return [];
  if (roleView === "admin") return buildAdminActions(input);
  if (roleView === "committer") return buildCommitterActions(input, roleId);
  return buildUserActions(input, roleId);
}

function buildUserActions(input: DerivePersonalWorkbenchInput, roleId: PlatformRoleId): WorkbenchAction[] {
  const actions: WorkbenchAction[] = [];

  if (input.signals.myDrafts > 0) {
    actions.push({
      id: "user-drafts",
      kind: "todo",
      priority: "secondary",
      title: "继续未提交的参数草稿",
      description: "仍有草稿尚未提交审阅，请回到参数工作台继续编辑。",
      meta: `${input.signals.myDrafts} 份草稿`,
      path: "/parameters",
      source: "submission"
    });
  }

  if (input.signals.returnedChanges > 0) {
    actions.push({
      id: "user-returned",
      kind: "todo",
      priority: "secondary",
      title: "补充被退回的参数修改",
      description: "有变更申请被审阅打回，请补充说明后重新提交。",
      meta: `${input.signals.returnedChanges} 项退回`,
      path: "/parameter-submissions",
      source: "submission"
    });
  }

  const mergeRequests = getReviewRequests(input.changeRequests, roleId);
  if (input.signals.waitingMerge > 0 && mergeRequests.length > 0 && canAccessPage(roleId, "parameter-review")) {
    actions.push({
      id: "user-merge-queue",
      kind: "todo",
      priority: "secondary",
      title: "处理待合入参数变更",
      description: "参数变更已进入软件开发人员合入节点，请在参数审阅页完成最后一步推进。",
      meta: `${input.signals.waitingMerge} 项待合入`,
      path: "/parameter-review",
      source: "review"
    });
  }

  return actions;
}

function buildCommitterActions(input: DerivePersonalWorkbenchInput, roleId: PlatformRoleId): WorkbenchAction[] {
  const actions: WorkbenchAction[] = [];
  const reviewRequests = getReviewRequests(input.changeRequests, roleId);

  if (input.signals.reviewQueue > 0) {
    const highRiskCount = reviewRequests.filter((request) => request.impact.some((item) => item.risk === "High")).length;
    actions.push({
      id: "committer-review-queue",
      kind: "todo",
      priority: "secondary",
      title: "处理待审阅参数变更",
      description: "优先处理已进入当前角色审阅节点的参数修改。",
      meta: `${input.signals.reviewQueue} 项待审阅 · ${highRiskCount} 项高风险`,
      path: "/parameter-review",
      source: "review"
    });
  }

  return actions;
}

function buildAdminActions(input: DerivePersonalWorkbenchInput): WorkbenchAction[] {
  const actions: WorkbenchAction[] = [];

  if (input.signals.unappliedImportBatches > 0) {
    actions.push({
      id: "admin-import-batches",
      kind: "todo",
      priority: "secondary",
      title: "处理未应用的导入批次",
      description: "存在尚未应用的参数导入批次，请在管理后台确认并应用。",
      meta: `${input.signals.unappliedImportBatches} 个批次`,
      path: "/parameter-admin",
      source: "admin"
    });
  }

  if (input.signals.inactiveAccounts > 0) {
    actions.push({
      id: "admin-user-review",
      kind: "todo",
      priority: "secondary",
      title: "检查用户与权限状态",
      description: "存在停用或需复核的用户账号。",
      meta: `${input.signals.inactiveAccounts} 个账号需关注`,
      path: "/user-permissions",
      source: "admin"
    });
  }

  const watchHotspots = input.hotspots.filter((hotspot) => hotspot.statusLevel === "watch").length;
  if (watchHotspots > 0) {
    actions.push({
      id: "admin-high-risk-library",
      kind: "todo",
      priority: "secondary",
      title: "打开管理后台查看高风险参数",
      description: "参数库中仍有需要关注的热区，建议复核治理配置。",
      meta: `${watchHotspots} 个热区需关注`,
      path: "/parameter-admin",
      source: "admin"
    });
  }

  return actions;
}

function getReviewRequests(changeRequests: ChangeRequest[], roleId: PlatformRoleId) {
  return changeRequests.filter((request) => canActOnReviewRequest(roleId, request));
}

function buildRecommendationActions(hotspots: DashboardHotspot[], roleView: WorkbenchRoleView): WorkbenchAction[] {
  if (roleView === "guest") {
    return [
      {
        id: "guest-readonly-hotspots",
        kind: "readonly",
        priority: "secondary",
        title: "查看当前参数风险热区",
        description: "当前为只读视角，可先浏览热榜了解近期变化。",
        meta: `${hotspots.length} 个热区`,
        path: "/parameter-home",
        source: "readonly"
      }
    ];
  }

  return hotspots.slice(0, 3).map((hotspot) => ({
    id: `hotspot-${hotspot.id}`,
    kind: "recommendation" as const,
    priority: "secondary" as const,
    title: recommendationTitleFor(roleView, hotspot),
    description: hotspot.evidence[0] ?? hotspot.statusLabel,
    meta: `${hotspot.statusLabel} · 热度 ${hotspot.score.toFixed(1)}`,
    path: recommendationPathFor(roleView, hotspot),
    source: "hotspot" as const
  }));
}

function recommendationTitleFor(roleView: WorkbenchRoleView, hotspot: DashboardHotspot) {
  if (roleView === "committer") return `创建高风险专项审阅：${hotspot.title}`;
  if (roleView === "admin") return `复核管理后台风险配置：${hotspot.title}`;
  return `从高风险参数开始修改：${hotspot.title}`;
}

function recommendationPathFor(roleView: WorkbenchRoleView, hotspot: DashboardHotspot) {
  if (roleView === "committer") {
    return hotspot.suggestedPath.startsWith("/parameter-review") ? hotspot.suggestedPath : "/parameter-review";
  }
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
  input: DerivePersonalWorkbenchInput,
  roleId: PlatformRoleId,
  roleView: WorkbenchRoleView
): WorkbenchScenarioEntry[] {
  const candidates: WorkbenchScenarioEntry[] =
    roleView === "admin"
      ? [
          entry("admin", "管理后台", "维护参数库、导入导出与审计记录。", "/parameter-admin", "parameter-admin", "导入批次", input.signals.unappliedImportBatches),
          {
            ...entry("new-project", "新建项目", "启动项目参数初始化流程。", "/parameter-home", "parameter-home", "项目", input.projects.length),
            action: "new-project" as const
          },
          entry("users", "用户管理", "维护平台角色与账号权限。", "/user-permissions", "user-permissions", "账号", input.signals.inactiveAccounts)
        ]
      : roleView === "committer"
        ? [
            entry("review", "处理审阅", "进入当前角色的参数审阅队列。", "/parameter-review", "parameter-review", "待审", input.signals.reviewQueue),
            entry("risk", "高风险专项", "按风险热区聚焦审阅对象。", "/parameter-review", "parameter-review", "热区", input.hotspots.length),
            entry("library", "查看参数库", "回到参数目录核对上下文。", "/parameters", "parameters", "参数", input.projects.length)
          ]
        : roleView === "user"
          ? [
              entry("edit", "修改参数", "从参数目录选择可维护参数。", "/parameters", "parameters", "参数", input.projects.length),
              entry("submissions", "我的提交", "查看草稿、退回与合入状态。", "/parameter-submissions", "parameter-submissions", "流程", input.signals.myDrafts + input.signals.returnedChanges),
              ...(input.signals.waitingMerge > 0 && canAccessPage(roleId, "parameter-review")
                ? [
                    entry(
                      "merge",
                      "参数合入",
                      "处理已进入软件开发人员合入节点的变更。",
                      "/parameter-review",
                      "parameter-review",
                      "待合入",
                      input.signals.waitingMerge
                    )
                  ]
                : []),
              entry("hotspots", "风险热区", "按风险建议选择下一次修改对象。", "/parameter-home", "parameter-home", "热区", input.hotspots.length)
            ]
          : [
              entry("read-parameters", "查看参数", "浏览参数目录与当前配置。", "/parameters", "parameters", "参数", input.projects.length),
              entry("read-hotspots", "查看风险热区", "了解近期高风险参数变化。", "/parameter-home", "parameter-home", "热区", input.hotspots.length)
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
