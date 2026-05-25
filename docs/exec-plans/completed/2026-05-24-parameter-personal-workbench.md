# Parameter Personal Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/parameter-home` into a role-aware personal workbench that tells users their next action first while preserving the existing dashboard as supporting evidence.

**Architecture:** Add a pure `derivePersonalWorkbench` view-model module that composes the existing homepage analytics with role and permission rules. Update `ParameterManagementHomePage` to render a compact command-center hero, role-filtered scenario entries, and the existing metrics/charts/hotspot leaderboard as a “recommendation evidence” section. Keep navigation through existing `onNavigate` paths and query-string context.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, existing shadcn/Radix UI primitives, lucide-react icons, existing CSS in `src/styles.css`.

---

## File Structure

- Create `src/parameterPersonalWorkbench.ts`
  - Owns `derivePersonalWorkbench` and all workbench-specific view model types.
  - Imports existing `PrototypeState`, `ParameterHomepageAnalytics`, role helpers, and permission helpers.
  - Has no React dependency.

- Create `src/parameterPersonalWorkbench.test.ts`
  - Unit tests for role grouping, action priority, scenario filtering, bad-reference filtering, and empty/recommendation states.

- Modify `src/ParameterManagementHomePage.tsx`
  - Imports `derivePersonalWorkbench`.
  - Replaces the current headline-first layout with `PersonalWorkbenchHero`, `NextActionList`, `ScenarioEntryPanel`, and `DashboardEvidenceSection` local components.
  - Removes or neutralizes the old topbar quick-entry nav so the page does not expose two competing entry systems.
  - Accepts an optional `onNewProject` callback so the Admin “新建项目” entry opens the existing initialization wizard instead of navigating to a fake URL.
  - Reuses `MetricCard`, `HotspotLeaderboard`, `ProjectRiskBarChart`, and `UpdateTrendChart`.

- Modify `src/app/routes.tsx`
  - Adds `onNewProject` to `PageRouterProps`.
  - Passes the callback to `ParameterManagementHomePage`.

- Modify `src/App.tsx`
  - Passes `() => setProjectInitOpen(true)` to each `PageRouter` instance.

- Modify `src/ParameterManagementHomePage.test.tsx`
  - Updates current homepage expectations from manager-facing dashboard to personal workbench.
  - Keeps coverage proving metrics, charts, hot ranking tabs, and AI detail panel still exist.
  - Adds role-specific assertions for Guest, User, Committer, and Admin.

- Modify `src/permissionRouting.test.tsx`
  - Keeps navigation permission expectations aligned with the new filtered workbench entries.

- Modify `src/styles.css`
  - Adds command-center hero, next-action list, scenario-entry, and evidence-section styles near the existing “Parameter management homepage” block.
  - Keeps card radius at 8px or less and uses responsive grid constraints.

---

### Task 1: Add Personal Workbench View Model

**Files:**
- Create: `src/parameterPersonalWorkbench.ts`
- Create: `src/parameterPersonalWorkbench.test.ts`

- [ ] **Step 1: Write failing tests for role-specific action priority and scenario filtering**

Create `src/parameterPersonalWorkbench.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveParameterHomepageAnalytics } from "./parameterHomepageAnalytics";
import { derivePersonalWorkbench } from "./parameterPersonalWorkbench";
import { initialState, type PrototypeState } from "./mockData";

function analyticsFor(state: PrototypeState = initialState) {
  return deriveParameterHomepageAnalytics(state, "30d", "overall");
}

describe("derivePersonalWorkbench", () => {
  it("puts real workflow actions before hotspot recommendations for a user", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "software-user",
      parameterSubmissionRounds: [
        {
          ...initialState.parameterSubmissionRounds[0],
          id: "PRS-user-draft",
          submitter: "Software User",
          status: "已暂存",
          summary: "还有 1 个参数修改草稿未提交。"
        },
        ...initialState.parameterSubmissionRounds
      ]
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("user");
    expect(workbench.nextActions[0]).toMatchObject({
      kind: "todo",
      priority: "primary",
      title: "继续未提交的参数草稿"
    });
    expect(workbench.nextActions[0].path).toBe("/parameters");
    expect(workbench.nextActions.some((action) => action.kind === "recommendation")).toBe(true);
    expect(workbench.nextActions.findIndex((action) => action.kind === "todo")).toBeLessThan(
      workbench.nextActions.findIndex((action) => action.kind === "recommendation")
    );
  });

  it("generates hotspot recommendations when a user has no workflow todo", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "hardware-user",
      parameterSubmissionRounds: [],
      changeRequests: []
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("user");
    expect(workbench.emptyState).toBe("recommendations");
    expect(workbench.nextActions[0]).toMatchObject({
      kind: "recommendation",
      priority: "primary"
    });
    expect(workbench.nextActions[0].path).toMatch(/^\/parameters/);
  });

  it("shows review actions for committers", () => {
    const state: PrototypeState = { ...initialState, activeRoleId: "hardware-committer" };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("committer");
    expect(workbench.nextActions[0]).toMatchObject({
      kind: "todo",
      priority: "primary",
      title: "处理待审阅参数变更"
    });
    expect(workbench.nextActions[0].path).toBe("/parameter-review");
    expect(workbench.scenarioEntries.map((entry) => entry.title)).toContain("处理审阅");
  });

  it("shows direct management actions for admins without beginner governance copy", () => {
    const state: PrototypeState = { ...initialState, activeRoleId: "admin" };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("admin");
    expect(workbench.scenarioEntries.map((entry) => entry.title)).toEqual([
      "管理后台",
      "新建项目",
      "用户管理"
    ]);
    expect(JSON.stringify(workbench)).not.toContain("我要治理");
  });

  it("keeps guests read-only and avoids review or admin destinations", () => {
    const state: PrototypeState = { ...initialState, activeRoleId: "guest" };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("guest");
    expect(workbench.nextActions.every((action) => action.kind !== "todo")).toBe(true);
    expect(workbench.scenarioEntries.map((entry) => entry.path)).toEqual([
      "/parameters",
      "/parameter-home"
    ]);
    expect(JSON.stringify(workbench)).not.toContain("/parameter-review");
    expect(JSON.stringify(workbench)).not.toContain("/parameter-admin");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/parameterPersonalWorkbench.test.ts
```

Expected: FAIL with an import error because `src/parameterPersonalWorkbench.ts` does not exist.

- [ ] **Step 3: Implement `derivePersonalWorkbench`**

Create `src/parameterPersonalWorkbench.ts`:

```ts
import { canAccessPage } from "@/app/permissions";
import { getPlatformRole, migrateLegacyRoleId, roleSupportsWorkflowSlot, type PlatformRoleId } from "@/domain/users/types";
import type { PageKey } from "./appConfig";
import type { ChangeRequest, ParameterSubmissionRound, PrototypeState, RequestStatus } from "./mockData";
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

const activeStatuses = new Set<RequestStatus>([
  "硬件Committer检视",
  "软件Committer检视",
  "软件User合入",
  "待审阅",
  "自动检查通过",
  "等待合入",
  "已打回"
]);

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
    hasTodos ? [...realActions, ...recommendationActions].slice(0, 5) : [...recommendationActions, ...quietActions].slice(0, 5)
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
    (round) => round.submitter === submitter || round.submitter.includes(submitter.replace(" User", ""))
  );
  const stashedRound = userRounds.find((round) => round.status === "已暂存");
  const rejectedRound = userRounds.find((round) => round.status === "已打回");
  const softwareMergeCount = roleSupportsWorkflowSlot(roleId, "softwareUser")
    ? state.changeRequests.filter((request) => request.status === "软件User合入").length
    : 0;
  const actions: WorkbenchAction[] = [];

  if (stashedRound) {
    actions.push({
      id: `user-draft-${stashedRound.id}`,
      kind: "todo",
      priority: "secondary",
      title: "继续未提交的参数草稿",
      description: stashedRound.summary,
      meta: `${stashedRound.items.length} 项参数 · ${stashedRound.projectName}`,
      path: `/parameters?project=${encodeURIComponent(stashedRound.projectId)}`,
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

  if (softwareMergeCount > 0) {
    actions.push({
      id: "user-software-merge",
      kind: "todo",
      priority: "secondary",
      title: "确认软件侧待合入事项",
      description: "有参数变更已完成审阅，等待软件侧合入确认。",
      meta: `${softwareMergeCount} 项待合入`,
      path: "/parameter-review",
      source: "review"
    });
  }

  return actions;
}

function buildCommitterActions(state: PrototypeState, roleId: PlatformRoleId): WorkbenchAction[] {
  const reviewRequests = state.changeRequests.filter((request) => canReviewRequest(roleId, request));
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

function canReviewRequest(roleId: PlatformRoleId, request: ChangeRequest) {
  if (request.status === "硬件Committer检视") return roleSupportsWorkflowSlot(roleId, "hardwareCommitter");
  if (request.status === "软件Committer检视") return roleSupportsWorkflowSlot(roleId, "softwareCommitter");
  if (request.status === "软件User合入") return roleSupportsWorkflowSlot(roleId, "softwareUser");
  return activeStatuses.has(request.status) && getWorkbenchRoleView(roleId) === "committer";
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
  return actions.map((action, index) => ({ ...action, priority: index === 0 ? "primary" : "secondary" as WorkbenchActionPriority }));
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
          { ...entry("new-project", "新建项目", "启动项目参数初始化流程。", "/parameter-home", "parameter-home", "项目", state.configDraft.projects.length), action: "new-project" as const },
          entry("users", "用户管理", "管理角色和访问权限。", "/user-permissions", "user-permissions", "用户", state.users.length)
        ]
      : roleView === "committer"
        ? [
            entry("review", "处理审阅", "进入参数审阅队列处理待办。", "/parameter-review", "parameter-review", "待审阅", analytics.flowHealth.reviewQueue),
            entry("history", "历史提交", "查看已合入和历史提交。", "/parameter-review?view=history", "parameter-review", "已合入", analytics.flowHealth.merged),
            entry("hotspots", "高风险专项", "从热区创建专项审阅。", "/parameter-review", "parameter-review", "热区", analytics.hotspots.length)
          ]
        : roleView === "user"
          ? [
              entry("edit", "修改参数", "进入项目参数工作台提交修改。", "/parameters", "parameters", "参数", analytics.summary.totalParameters),
              entry("submissions", "我的提交", "查看个人提交和流程进度。", "/parameter-submissions", "parameter-submissions", "提交", state.parameterSubmissionRounds.length),
              entry("risk", "查看风险热区", "先看系统推荐关注的项目和参数。", "/parameter-home", "parameter-home", "热区", analytics.hotspots.length)
            ]
          : [
              entry("view", "查看参数", "浏览参数目录和推荐值。", "/parameters", "parameters", "参数", analytics.summary.totalParameters),
              entry("overview", "查看态势", "查看参数治理整体态势。", "/parameter-home", "parameter-home", "热区", analytics.hotspots.length)
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
  metricValue: number
): WorkbenchScenarioEntry {
  return { id, title, description, path, pageKey, metricLabel, metricValue: String(metricValue) };
}

function buildSummary(
  roleView: WorkbenchRoleView,
  hasTodos: boolean,
  actions: WorkbenchAction[],
  analytics: ParameterHomepageAnalytics
) {
  if (roleView === "admin") return `管理视角 · ${analytics.summary.highRiskParameters} 项高风险参数 · ${analytics.flowHealth.reviewQueue} 项审阅流转中`;
  if (hasTodos) return `今天优先处理 ${actions.filter((action) => action.kind === "todo").length} 项流程待办`;
  if (actions.some((action) => action.kind === "recommendation")) return "今天没有必须处理的流程待办，建议从风险热区开始";
  return "今天没有必须处理的事项";
}
```

- [ ] **Step 4: Run view-model tests**

Run:

```bash
npm test -- src/parameterPersonalWorkbench.test.ts
```

Expected: PASS for all `derivePersonalWorkbench` tests.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/parameterPersonalWorkbench.ts src/parameterPersonalWorkbench.test.ts
git commit -m "feat: derive parameter personal workbench model"
```

---

### Task 2: Render Command-Center Workbench Hero

**Files:**
- Modify: `src/ParameterManagementHomePage.tsx`
- Modify: `src/ParameterManagementHomePage.test.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing page tests for the new hero**

In `src/ParameterManagementHomePage.test.tsx`, add these tests inside `describe("ParameterManagementHomePage", () => { ... })`:

```ts
  it("renders a personal workbench hero with next actions and scenario entries", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} onNewProject={vi.fn()} />);

    expect(screen.getByRole("region", { name: "个人工作台" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "我的下一步" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "我想做" })).toBeInTheDocument();
    expect(screen.getByText("管理视角")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 管理后台/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 新建项目/ })).toBeInTheDocument();
    expect(screen.queryByText("我要治理")).not.toBeInTheDocument();
  });

  it("renders user-focused scenario entries for a normal user", () => {
    render(<ParameterManagementHomePage state={{ ...initialState, activeRoleId: "hardware-user" }} onNavigate={vi.fn()} onNewProject={vi.fn()} />);

    expect(screen.getByRole("button", { name: /打开 修改参数/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 我的提交/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 处理审阅/ })).not.toBeInTheDocument();
  });

  it("renders committer review entries without admin actions", () => {
    render(<ParameterManagementHomePage state={{ ...initialState, activeRoleId: "hardware-committer" }} onNavigate={vi.fn()} onNewProject={vi.fn()} />);

    expect(screen.getByRole("button", { name: /打开 处理审阅/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 高风险专项/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();
  });

  it("navigates from next actions and scenario entries with context", () => {
    const onNavigate = vi.fn();

    render(<ParameterManagementHomePage state={{ ...initialState, activeRoleId: "hardware-committer" }} onNavigate={onNavigate} onNewProject={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /处理待审阅参数变更/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/parameter-review");

    fireEvent.click(screen.getByRole("button", { name: /打开 高风险专项/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/parameter-review");
  });

  it("opens the project initialization wizard from the Admin scenario entry", () => {
    const onNewProject = vi.fn();

    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} onNewProject={onNewProject} />);

    fireEvent.click(screen.getByRole("button", { name: /打开 新建项目/ }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run page tests to verify they fail**

Run:

```bash
npm test -- src/ParameterManagementHomePage.test.tsx
```

Expected: FAIL because the page does not yet render “个人工作台”, “我的下一步”, or “我想做”.

- [ ] **Step 3: Update `ParameterManagementHomePage.tsx` imports**

Modify the imports at the top of `src/ParameterManagementHomePage.tsx`:

```ts
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, ChevronRight, Layers3, ListChecks, ShieldCheck, Sparkles, TrendingUp, Users } from "lucide-react";
import { derivePersonalWorkbench, type PersonalWorkbenchViewModel, type WorkbenchAction, type WorkbenchScenarioEntry } from "./parameterPersonalWorkbench";
```

Keep the existing imports that are still used.

- [ ] **Step 4: Pass `onNewProject` through routing**

In `src/app/routes.tsx`, add `onNewProject?: () => void;` to `PageRouterProps`, destructure it in `PageRouter`, and pass it to the parameter homepage:

```tsx
    case "parameter-home":
      return (
        <ParameterManagementHomePage
          state={state}
          onNavigate={onNavigate}
          onNewProject={onNewProject}
          timeWindow={parameterHomeTimeWindow}
        />
      );
```

In both `PageRouter` calls in `src/App.tsx`, add:

```tsx
                onNewProject={() => setProjectInitOpen(true)}
```

- [ ] **Step 5: Remove the old topbar quick-entry nav**

In `src/ParameterManagementHomePage.tsx`, delete `parameterHomeQuickEntries` and replace the current `useTopBarActions(...)` call with:

```tsx
  useTopBarActions(null, []);
```

This prevents duplicate “参数修改 / 参数审阅 / 管理后台” entry systems.

- [ ] **Step 6: Derive the workbench view model**

Inside `ParameterManagementHomePage`, after `analytics`:

```tsx
  const workbench = useMemo(
    () => derivePersonalWorkbench(state, analytics),
    [state, analytics]
  );
```

- [ ] **Step 7: Replace the old headline with `PersonalWorkbenchHero`**

Replace:

```tsx
      <p className="parameter-homepage-headline homepage-panel" data-testid="parameter-home-headline">
        <span>{analytics.opsHeadline}</span>
      </p>
```

with:

```tsx
      <PersonalWorkbenchHero workbench={workbench} onNavigate={onNavigate} onNewProject={onNewProject} />
```

- [ ] **Step 8: Add hero components below `MetricCard`**

Add these local components below `MetricCard`:

```tsx
function PersonalWorkbenchHero({
  workbench,
  onNavigate,
  onNewProject
}: {
  workbench: PersonalWorkbenchViewModel;
  onNavigate: (path: string) => void;
  onNewProject?: () => void;
}) {
  return (
    <section className="personal-workbench-hero homepage-panel" aria-label="个人工作台">
      <div className="personal-workbench-hero__summary">
        <span className="personal-workbench-hero__eyebrow">{workbench.roleLabel}</span>
        <h2>我的工作台</h2>
        <p>{workbench.summary}</p>
      </div>
      <NextActionList actions={workbench.nextActions} emptyState={workbench.emptyState} onNavigate={onNavigate} />
      <ScenarioEntryPanel entries={workbench.scenarioEntries} onNavigate={onNavigate} onNewProject={onNewProject} />
    </section>
  );
}

function NextActionList({
  actions,
  emptyState,
  onNavigate
}: {
  actions: WorkbenchAction[];
  emptyState: PersonalWorkbenchViewModel["emptyState"];
  onNavigate: (path: string) => void;
}) {
  return (
    <section className="next-action-panel" aria-label="我的下一步">
      <div className="parameter-homepage-section-head">
        <div>
          <h2>我的下一步</h2>
          <span>{emptyState === "has-todos" ? "流程待办优先" : emptyState === "recommendations" ? "暂无流程待办，按风险推荐" : "暂无必须处理事项"}</span>
        </div>
      </div>
      <div className="next-action-list">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="next-action-card"
            data-priority={action.priority}
            data-kind={action.kind}
            onClick={() => onNavigate(action.path)}
          >
            <span className="next-action-card__icon" aria-hidden="true">
              {action.kind === "todo" ? <ListChecks size={18} /> : action.kind === "recommendation" ? <Sparkles size={18} /> : <ShieldCheck size={18} />}
            </span>
            <span className="next-action-card__body">
              <strong>{action.title}</strong>
              <small>{action.description}</small>
              <em>{action.meta}</em>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function ScenarioEntryPanel({
  entries,
  onNavigate,
  onNewProject
}: {
  entries: WorkbenchScenarioEntry[];
  onNavigate: (path: string) => void;
  onNewProject?: () => void;
}) {
  return (
    <section className="scenario-entry-panel" aria-label="我想做">
      <div className="parameter-homepage-section-head">
        <div>
          <h2>我想做</h2>
          <span>按当前角色过滤入口</span>
        </div>
      </div>
      <div className="scenario-entry-list">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="scenario-entry"
            onClick={() => {
              if (entry.action === "new-project" && onNewProject) {
                onNewProject();
                return;
              }
              onNavigate(entry.path);
            }}
          >
            <span>
              <strong>{entry.title}</strong>
              <small>{entry.description}</small>
            </span>
            <em>
              {entry.metricLabel} <b>{entry.metricValue}</b>
            </em>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 9: Run page tests**

Run:

```bash
npm test -- src/ParameterManagementHomePage.test.tsx
```

Expected: The new hero tests pass. Some older tests may still fail because they assert legacy class hooks; those are fixed in later tasks.

- [ ] **Step 10: Commit Task 2**

```bash
git add src/ParameterManagementHomePage.tsx src/ParameterManagementHomePage.test.tsx src/app/routes.tsx src/App.tsx
git commit -m "feat: render parameter personal workbench hero"
```

---

### Task 3: Preserve Dashboard Evidence and Update Styles

**Files:**
- Modify: `src/ParameterManagementHomePage.tsx`
- Modify: `src/ParameterManagementHomePage.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing tests for evidence section labels and stable class hooks**

In `src/ParameterManagementHomePage.test.tsx`, add:

```ts
  it("keeps the old dashboard as recommendation evidence", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} onNewProject={vi.fn()} />);

    expect(screen.getByRole("region", { name: "推荐依据" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "核心指标" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "参数态势图表" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "风险热区证据" })).toBeInTheDocument();
    expect(document.querySelector(".personal-workbench-hero")).toBeInTheDocument();
    expect(document.querySelector(".next-action-card")).toBeInTheDocument();
    expect(document.querySelector(".scenario-entry")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-headline")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/ParameterManagementHomePage.test.tsx
```

Expected: FAIL because “推荐依据” and “风险热区证据” are not yet rendered.

- [ ] **Step 3: Wrap metrics, charts, and hotspots in `DashboardEvidenceSection`**

In `src/ParameterManagementHomePage.tsx`, replace the metrics/charts/hotspots sections currently returned after the hero with:

```tsx
      <section className="dashboard-evidence-section" aria-label="推荐依据">
        <div className="parameter-homepage-section-head dashboard-evidence-section__head">
          <div>
            <h2>推荐依据</h2>
            <span>保留原看板指标，用来解释工作台行动排序</span>
          </div>
        </div>

        <section className="parameter-homepage-metrics" aria-label="核心指标">
          {metrics.map((metric, index) => {
            const Icon = metricIcons[index];
            return <MetricCard key={metric.title} title={metric.title} value={metric.value} detail={metric.detail} Icon={Icon} />;
          })}
        </section>

        <section className="parameter-homepage-charts" aria-label="参数态势图表">
          <div className="homepage-panel parameter-homepage-chart-card">
            <div className="parameter-homepage-section-head">
              <div>
                <h2>参数更新趋势</h2>
                <span>{analytics.timeWindowLabel}</span>
              </div>
            </div>
            <UpdateTrendChart series={analytics.updateTrend} timeWindow={timeWindow} />
          </div>
          <div className="homepage-panel parameter-homepage-chart-card">
            <div className="parameter-homepage-section-head">
              <div>
                <h2>各项目参数更新情况</h2>
                <ul className="project-risk-legend" aria-label="各项目参数更新情况颜色说明">
                  <li>
                    <span className="project-risk-legend-dot risk-high" aria-hidden="true" />
                    红色 高风险
                  </li>
                  <li>
                    <span className="project-risk-legend-dot risk-medium" aria-hidden="true" />
                    橙色 中风险
                  </li>
                  <li>
                    <span className="project-risk-legend-dot risk-low" aria-hidden="true" />
                    蓝色 低风险
                  </li>
                </ul>
              </div>
            </div>
            <ProjectRiskBarChart buckets={analytics.riskBuckets} onNavigate={onNavigate} />
          </div>
        </section>

        <section className="parameter-homepage-hotspots homepage-panel" aria-label="风险热区证据">
          <div className="parameter-homepage-section-head">
            <div>
              <h2>风险热区证据</h2>
              <span>
                {analytics.timeWindowLabel} · {analytics.hotspots.length} 个热区
              </span>
            </div>
            <HotspotDimensionSelect
              value={hotspotDimension}
              onChange={(nextDimension) => {
                setHotspotDimension(nextDimension);
                setSelectedHotspotId(null);
              }}
            />
          </div>
          <HotspotLeaderboard
            hotspots={analytics.hotspots}
            selectedId={selectedHotspotId}
            sectionId="parameter-home-hotspots"
            state={state}
            isAccordionMode={isAccordionMode}
            onNavigate={onNavigate}
            onSelectionChange={setSelectedHotspotId}
          />
        </section>
      </section>
```

- [ ] **Step 4: Add CSS for the workbench hero and evidence section**

In `src/styles.css`, within the “Parameter management homepage” block after `.homepage-panel`, add:

```css
.personal-workbench-hero {
  display: grid;
  grid-template-columns: minmax(220px, 0.7fr) minmax(0, 1.35fr) minmax(260px, 0.95fr);
  gap: 16px;
  align-items: stretch;
  padding: 18px;
}

.personal-workbench-hero__summary,
.next-action-panel,
.scenario-entry-panel {
  min-width: 0;
}

.personal-workbench-hero__summary {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 4px 4px 0;
}

.personal-workbench-hero__eyebrow {
  color: var(--app-secondary);
  font-size: 12px;
  font-weight: 850;
}

.personal-workbench-hero h2,
.next-action-panel h2,
.scenario-entry-panel h2 {
  margin: 0;
}

.personal-workbench-hero__summary p {
  margin: 0;
  color: var(--app-muted);
  font-size: 14px;
  font-weight: 720;
  line-height: 1.5;
}

.next-action-list,
.scenario-entry-list {
  display: grid;
  gap: 8px;
}

.next-action-card,
.scenario-entry {
  display: grid;
  align-items: center;
  width: 100%;
  min-width: 0;
  color: inherit;
  background: var(--surface-low);
  border: 1px solid var(--outline);
  border-radius: 8px;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.next-action-card {
  grid-template-columns: 36px minmax(0, 1fr) 18px;
  gap: 10px;
  min-height: 66px;
  padding: 10px 12px;
}

.next-action-card[data-priority="primary"] {
  background: #eef4ff;
  border-color: #9bb4ff;
  box-shadow: 0 10px 24px rgba(0, 61, 155, 0.12);
}

.next-action-card__icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--app-primary);
  background: #fff;
  border: 1px solid var(--outline);
  border-radius: 8px;
}

.next-action-card__body,
.scenario-entry span {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.next-action-card strong,
.scenario-entry strong {
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: 14px;
  line-height: 1.25;
}

.next-action-card small,
.scenario-entry small {
  overflow-wrap: anywhere;
  color: var(--app-muted);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.35;
}

.next-action-card em,
.scenario-entry em {
  color: var(--outline-strong);
  font-size: 11px;
  font-style: normal;
  font-weight: 850;
}

.scenario-entry {
  grid-template-columns: minmax(0, 1fr) auto 16px;
  gap: 10px;
  min-height: 62px;
  padding: 10px 12px;
}

.scenario-entry em {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.scenario-entry b {
  color: var(--app-primary);
}

.next-action-card:hover,
.scenario-entry:hover {
  border-color: #9bb4ff;
  background: #f7faff;
}

.next-action-card:focus-visible,
.scenario-entry:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}

.dashboard-evidence-section {
  display: grid;
  gap: 14px;
  margin-top: 14px;
}

.dashboard-evidence-section__head {
  margin-bottom: 0;
}
```

- [ ] **Step 5: Add responsive CSS**

In the existing `@media (max-width: 1040px)` block, add:

```css
  .personal-workbench-hero {
    grid-template-columns: 1fr;
  }
```

In the existing `@media (max-width: 768px)` block, add:

```css
  .personal-workbench-hero {
    padding: 14px;
  }

  .next-action-card,
  .scenario-entry {
    grid-template-columns: minmax(0, 1fr);
  }

  .next-action-card__icon {
    display: none;
  }

  .scenario-entry em {
    white-space: normal;
  }
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
npm test -- src/ParameterManagementHomePage.test.tsx
```

Expected: PASS. If older tests still expect the old “热门模块” region name, update them to query `风险热区证据` while preserving assertions for leaderboard content.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/ParameterManagementHomePage.tsx src/ParameterManagementHomePage.test.tsx src/app/routes.tsx src/App.tsx src/styles.css
git commit -m "feat: preserve dashboard evidence in personal workbench"
```

---

### Task 4: Update Permission and Role Regression Coverage

**Files:**
- Modify: `src/permissionRouting.test.tsx`
- Modify: `src/ParameterManagementHomePage.test.tsx`
- Modify: `src/parameterPersonalWorkbench.ts` when adding bad-reference filtering in Step 4.

- [ ] **Step 1: Add regression tests for no unauthorized workbench entries**

In `src/permissionRouting.test.tsx`, add:

```tsx
  it("filters personal workbench entries by role", () => {
    window.history.replaceState(null, "", "/parameter-home");

    const { rerender } = render(<App initialAppState={{ ...initialState, activeRoleId: "guest" }} />);

    expect(screen.getByRole("region", { name: "我想做" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 处理审阅/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();

    rerender(<App initialAppState={{ ...initialState, activeRoleId: "hardware-user" }} />);

    expect(screen.getByRole("button", { name: /打开 修改参数/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();

    rerender(<App initialAppState={{ ...initialState, activeRoleId: "hardware-committer" }} />);

    expect(screen.getByRole("button", { name: /打开 处理审阅/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();

    rerender(<App initialAppState={{ ...initialState, activeRoleId: "admin" }} />);

    expect(screen.getByRole("button", { name: /打开 管理后台/ })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run permission tests**

Run:

```bash
npm test -- src/permissionRouting.test.tsx
```

Expected: PASS. If rerender retains stale route state, replace `rerender` with separate `cleanup()` calls inside the test.

- [ ] **Step 3: Add a bad-reference unit test**

In `src/parameterPersonalWorkbench.test.ts`, add:

```ts
  it("drops actions that reference missing project or parameter data", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "software-user",
      parameterSubmissionRounds: [
        {
          ...initialState.parameterSubmissionRounds[0],
          id: "PRS-bad-reference",
          submitter: "Software User",
          status: "已暂存",
          projectId: "missing-project",
          items: [
            {
              ...initialState.parameterSubmissionRounds[0].items[0],
              parameterId: "missing-parameter"
            }
          ]
        }
      ]
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.nextActions.some((action) => action.id.includes("PRS-bad-reference"))).toBe(false);
  });
```

- [ ] **Step 4: Update implementation to pass bad-reference test**

In `src/parameterPersonalWorkbench.ts`, add this helper:

```ts
function roundHasValidReferences(state: PrototypeState, round: ParameterSubmissionRound) {
  const projectExists = state.configDraft.projects.some((project) => project.id === round.projectId);
  const parameterIds = new Set(state.parameters.map((parameter) => parameter.id));
  return projectExists && round.items.every((item) => parameterIds.has(item.parameterId));
}
```

Then change `buildUserActions`:

```ts
  const userRounds = state.parameterSubmissionRounds.filter(
    (round) =>
      roundHasValidReferences(state, round) &&
      (round.submitter === submitter || round.submitter.includes(submitter.replace(" User", "")))
  );
```

- [ ] **Step 5: Run all targeted tests**

Run:

```bash
npm test -- src/parameterPersonalWorkbench.test.ts src/ParameterManagementHomePage.test.tsx src/permissionRouting.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/parameterPersonalWorkbench.ts src/parameterPersonalWorkbench.test.ts src/ParameterManagementHomePage.test.tsx src/permissionRouting.test.tsx
git commit -m "test: cover personal workbench role permissions"
```

---

### Task 5: Full Verification and Browser QA

**Files:**
- No planned edits.
- If verification reveals a defect, make a scoped fix in the specific failing file: `src/ParameterManagementHomePage.tsx`, `src/parameterPersonalWorkbench.ts`, `src/styles.css`, `src/app/routes.tsx`, `src/App.tsx`, or the affected test file.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS with TypeScript build and Vite build completing successfully.

- [ ] **Step 3: Start or reuse the local dev server**

If the dev server is not already running:

```bash
npm run dev
```

Expected: Vite serves the app at `http://127.0.0.1:5173/`.

- [ ] **Step 4: Verify desktop browser layout**

Open `http://127.0.0.1:5173/parameter-home` in the in-app browser.

Verify:

- “我的工作台” appears near the top.
- “我的下一步” and “我想做” are visible above the evidence section.
- “推荐依据” is visible below the command-center hero.
- Metrics, trend chart, risk chart, and hotspot leaderboard still render.
- No “我要治理” copy appears for Admin.

- [ ] **Step 5: Verify role switching**

Use the topbar role switcher and verify:

- Guest shows read-only entries and no review/admin entries.
- Hardware User shows “修改参数” and “我的提交”.
- Hardware Committer shows “处理审阅” and “高风险专项”.
- Admin shows “管理后台”, “新建项目”, and “用户管理”.

- [ ] **Step 6: Verify mobile/responsive layout**

Use browser viewport around `390x844`.

Verify:

- “我的下一步” appears before “我想做”.
- Scenario entries do not overflow.
- Metrics collapse to one column.
- Hotspot leaderboard uses the existing accordion behavior.

- [ ] **Step 7: Fix any QA defects**

If any verification step fails, make the smallest scoped fix and rerun:

```bash
npm test -- src/parameterPersonalWorkbench.test.ts src/ParameterManagementHomePage.test.tsx src/permissionRouting.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit verification fixes when files changed**

If Step 7 changed files:

```bash
git add src/ParameterManagementHomePage.tsx src/parameterPersonalWorkbench.ts src/styles.css src/app/routes.tsx src/App.tsx src/ParameterManagementHomePage.test.tsx src/parameterPersonalWorkbench.test.ts src/permissionRouting.test.tsx
git commit -m "fix: polish parameter personal workbench qa issues"
```

If no files changed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: The plan covers role-aware next actions, A+B command-center layout, C priority rule, Admin direct-management treatment, preservation of metrics/charts/hotspots, permission filtering, bad-reference handling, responsive behavior, and browser QA.
- Scope check: The plan stays within `/parameter-home` and supporting view-model/tests/styles. It does not rebuild parameter subpages, add backend services, or introduce new libraries.
- Type consistency: The plan defines `derivePersonalWorkbench(state, analytics)` once and uses the same `PersonalWorkbenchViewModel`, `WorkbenchAction`, and `WorkbenchScenarioEntry` types in both implementation and page components.

