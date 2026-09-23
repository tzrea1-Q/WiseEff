import { canAccessPage } from "@/app/permissions";
import type { PageKey } from "@/appConfig";
import type { ChangeRequest } from "@/domain/parameters/types";
import type { DashboardHotspot, WorkbenchSignals } from "@/domain/parameters/dashboardTypes";
import {
  getPlatformRole,
  migrateLegacyRoleId,
  type PlatformRoleId
} from "@/domain/users/types";

export type WorkbenchRoleView = "guest" | "user" | "committer" | "admin";
export type WorkbenchActionKind = "todo" | "recommendation" | "readonly";
export type WorkbenchActionPriority = "primary" | "secondary";
export type WorkbenchEmphasis = "action-first" | "insight-first";
type HotspotsStatus = "idle" | "loading" | "ready" | "empty" | "error";

export type WorkbenchAction = {
  id: string;
  kind: WorkbenchActionKind;
  priority: WorkbenchActionPriority;
  title: string;
  description: string;
  meta: string;
  path: string;
  source: "submission" | "review" | "initialization" | "admin" | "hotspot" | "readonly";
  visualKey?: string;
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
  /** The dashboard's explicit project context; null means all projects. */
  projectScope?: string | null;
  /** Active source-backed Binding count from the canonical summary. */
  activeBindingCount?: number;
  /** The fetch state prevents stale or failed hotspot data becoming a zero. */
  hotspotsStatus?: HotspotsStatus;
  /** Kept for callers during the canonical cutover; dashboard actions use signals only. */
  changeRequests?: ChangeRequest[];
  drafts?: unknown[];
  projects: Array<{ id: string; name: string; code: string }>;
  hotspots: DashboardHotspot[];
};

export function derivePersonalWorkbench(input: DerivePersonalWorkbenchInput): PersonalWorkbenchViewModel {
  const roleId = migrateLegacyRoleId(input.roleId);
  const roleView = getWorkbenchRoleView(roleId);
  const usableHotspots =
    input.hotspotsStatus === undefined || input.hotspotsStatus === "ready" || input.hotspotsStatus === "empty"
      ? input.hotspots
      : [];
  const workbenchInput = { ...input, hotspots: usableHotspots };
  const realActions = buildRealActions(workbenchInput, roleView);
  const recommendationActions = buildRecommendationActions(
    usableHotspots,
    roleView,
    input.projectScope,
    input.hotspotsStatus ?? "ready"
  );
  const quietActions = buildQuietActions(roleView, input.projectScope);
  const hasTodos = realActions.length > 0;
  const nextActions = markPriorities(
    hasTodos
      ? [...realActions, ...recommendationActions].slice(0, 5)
      : [...recommendationActions, ...quietActions].slice(0, 5)
  );

  return {
    roleView,
    nextActions,
    scenarioEntries: buildScenarioEntries({ ...input, hotspots: usableHotspots }, roleId, roleView),
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
  roleView: WorkbenchRoleView
): WorkbenchAction[] {
  if (roleView === "guest") return [];
  if (roleView === "admin") return buildAdminActions(input);
  if (roleView === "committer") return buildCommitterActions(input);
  return buildUserActions(input);
}

function buildUserActions(input: DerivePersonalWorkbenchInput): WorkbenchAction[] {
  const actions: WorkbenchAction[] = [];

  if (input.signals.myDrafts > 0) {
    actions.push({
      id: "user-drafts",
      kind: "todo",
      priority: "secondary",
      title: "继续未提交的参数草稿",
      description: "仍有草稿尚未提交审阅，请回到参数工作台继续编辑。",
      meta: `${input.signals.myDrafts} 份草稿`,
      path: withProjectScope("/parameters", input.projectScope),
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
      path: withProjectScope("/parameter-submissions", input.projectScope),
      source: "submission"
    });
  }

  return actions;
}

function buildCommitterActions(input: DerivePersonalWorkbenchInput): WorkbenchAction[] {
  const actions: WorkbenchAction[] = [];

  if (input.signals.reviewQueue > 0) {
    actions.push({
      id: "committer-review-queue",
      kind: "todo",
      priority: "secondary",
      title: "处理待审阅参数变更",
      description: "优先处理已进入当前角色审阅节点的参数修改。",
      meta: `${input.signals.reviewQueue} 项待审阅 · 风险分类不可用`,
      path: withProjectScope("/parameter-review", input.projectScope),
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
      path: "/organization/members",
      source: "admin"
    });
  }

  const watchHotspots = input.hotspots.filter((hotspot) => hotspot.statusLevel === "watch").length;
  if (watchHotspots > 0) {
    actions.push({
      id: "admin-watch-library",
      kind: "todo",
      priority: "secondary",
      title: "打开管理后台查看关注热区",
      description: "参数库中仍有需要关注的热区，建议复核治理配置。",
      meta: `${watchHotspots} 个热区需关注`,
      path: "/parameter-admin",
      source: "admin"
    });
  }

  return actions;
}

function buildRecommendationActions(
  hotspots: DashboardHotspot[],
  roleView: WorkbenchRoleView,
  projectScope: string | null | undefined,
  hotspotsStatus: HotspotsStatus
): WorkbenchAction[] {
  if (roleView === "guest") {
    const countLabel = hotspotCountLabel(hotspots, hotspotsStatus);
    return [
      {
        id: "guest-readonly-hotspots",
        kind: "readonly",
        priority: "secondary",
        title: "查看当前参数关注热区",
        description: "当前为只读视角，可先浏览热榜了解近期变化。",
        meta: typeof countLabel === "number" ? `${countLabel} 个热区` : countLabel,
        path: withProjectScope("/parameter-home", projectScope),
        source: "readonly"
      }
    ];
  }

  return hotspots.slice(0, 3).map((hotspot, index) => ({
    id: `hotspot-${hotspot.id}`,
    kind: "recommendation" as const,
    priority: "secondary" as const,
    title: recommendationTitleFor(roleView, hotspot),
    description: hotspot.evidence[0] ?? hotspot.statusLabel,
    meta: `${hotspot.statusLabel} · 热度 ${hotspot.score.toFixed(1)}`,
    path: withProjectScope(recommendationPathFor(roleView, hotspot), projectScope),
    source: "hotspot" as const,
    visualKey: `hotspot-variant-${index % 3}`
  }));
}

function recommendationTitleFor(roleView: WorkbenchRoleView, hotspot: DashboardHotspot) {
  if (roleView === "committer") return `查看项目审阅队列：${hotspot.title}`;
  if (roleView === "admin") return `复核管理后台关注配置：${hotspot.title}`;
  return `查看热区所在项目：${hotspot.title}`;
}

function recommendationPathFor(roleView: WorkbenchRoleView, hotspot: DashboardHotspot) {
  const projectId = new URLSearchParams(hotspot.suggestedPath.split("?")[1] ?? "").get("project");
  if (roleView === "committer") {
    if (hotspot.suggestedPath.startsWith("/parameter-review")) return hotspot.suggestedPath;
    return projectId ? `/parameter-review?project=${encodeURIComponent(projectId)}` : "/parameter-review";
  }
  if (roleView === "admin") return "/parameter-admin";
  if (hotspot.suggestedPath.startsWith("/parameters")) return hotspot.suggestedPath;
  return projectId ? `/parameters?project=${encodeURIComponent(projectId)}` : "/parameters";
}

function withProjectScope(path: string, projectScope: string | null | undefined) {
  if (!projectScope) return path;
  const [pathname, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("project", projectScope);
  return `${pathname}?${params.toString()}`;
}

function hotspotCountLabel(hotspots: DashboardHotspot[], status: HotspotsStatus): number | string {
  if (status === "ready" || status === "empty") return hotspots.length;
  return status === "loading" || status === "idle" ? "加载中" : "不可用";
}

function buildQuietActions(roleView: WorkbenchRoleView, projectScope: string | null | undefined): WorkbenchAction[] {
  if (roleView === "guest") {
    return [
      {
        id: "guest-view-parameters",
        kind: "readonly",
        priority: "secondary",
        title: "查看参数目录",
        description: "当前角色可浏览参数信息，但不能提交或审阅变更。",
        meta: "只读",
        path: withProjectScope("/parameters", projectScope),
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
      path: withProjectScope("/parameters", projectScope),
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
  const hotspotMetric = hotspotCountLabel(input.hotspots, input.hotspotsStatus ?? "ready");
  const candidates: WorkbenchScenarioEntry[] =
    roleView === "admin"
      ? [
          entry("admin", "管理后台", "维护参数定义库、驱动归属、批量导入与项目运营。", "/parameter-admin", "parameter-admin", "导入批次", input.signals.unappliedImportBatches),
          {
            ...entry("new-project", "新建项目", "启动项目参数初始化流程。", "/parameter-home", "parameter-home", "项目", input.projects.length),
            action: "new-project" as const
          },
          entry("users", "组织管理", "维护本组织档案、成员和角色权限。", "/organization", "user-permissions", "账号", input.signals.inactiveAccounts)
        ]
      : roleView === "committer"
        ? [
            entry("review", "处理审阅", "进入当前角色的变更审阅队列。", withProjectScope("/parameter-review", input.projectScope), "parameter-review", "待审", input.signals.reviewQueue),
            entry("changes", "关注变更", "按近期变更热度聚焦审阅对象。", withProjectScope("/parameter-review", input.projectScope), "parameter-review", "热区", hotspotMetric),
            entry("library", "查看参数库", "回到参数目录核对当前项目上下文。", withProjectScope("/parameters", input.projectScope), "parameters", "参数", activeBindingMetric(input.activeBindingCount))
          ]
        : roleView === "user"
          ? [
              entry("edit", "修改参数", "从当前项目参数目录选择可维护参数。", withProjectScope("/parameters", input.projectScope), "parameters", "参数", activeBindingMetric(input.activeBindingCount)),
              entry("submissions", "我的草稿", "在当前项目参数工作台继续编辑未提交的草稿。", withProjectScope("/parameters", input.projectScope), "parameters", "草稿", input.signals.myDrafts),
              entry("hotspots", "关注热区", "按近期变更热度选择下一次修改对象。", withProjectScope("/parameter-home", input.projectScope), "parameter-home", "热区", hotspotMetric)
            ]
          : [
              entry("read-parameters", "查看参数", "浏览当前项目参数目录与当前配置。", withProjectScope("/parameters", input.projectScope), "parameters", "参数", activeBindingMetric(input.activeBindingCount)),
              entry("read-hotspots", "查看关注热区", "了解近期参数变更热度。", withProjectScope("/parameter-home", input.projectScope), "parameter-home", "热区", hotspotMetric)
          ];

  return candidates.filter((candidate) => canAccessPage(roleId, candidate.pageKey));
}

function activeBindingMetric(value: number | undefined): number | string {
  return value === undefined ? "不可用" : value;
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
