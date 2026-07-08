# Parameter Home Personal vs Overall Overview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design spec:** [2026-07-08-parameter-home-personal-overview-design.md](../../design-docs/2026-07-08-parameter-home-personal-overview-design.md) (approved)

## Status

**Implemented** on branch `feat/parameter-home-personal-overview`.

**Goal:** Add a personal/org-wide toggle to the parameter home overview panel so non-guest users default to personal KPIs and personal trend, while guest users default to org-wide metrics, with time-window and project-scope filters applied to both views.

**Architecture:** Extend `DashboardSummary` with `personalKpis` and `personalTrend` computed server-side (and mirrored in mock). Add `overviewScope` to `dashboardState`. Render toggle in `SituationStrip` via `Panel.actions`; map role-specific KPI labels in `deriveOverviewPresentation`. Reuse existing trend chart with different `points` and legend labels.

**Tech Stack:** PostgreSQL aggregation SQL, Node/TypeScript server modules, React 19 + Vite, Recharts, shadcn/ui ToggleGroup, Vitest, Playwright acceptance.

---

## Git & PR Workflow

| Item | Value |
| --- | --- |
| Base branch | `main` |
| Feature branch | `feat/parameter-home-personal-overview` |
| Subagent | Implement + commit on feature branch only |
| Parent agent | Review, open PR, merge, sync `main` |

Create the feature branch from latest `main` before Task 1.

---

## File Map

| File | Responsibility |
| --- | --- |
| `src/domain/parameters/dashboardTypes.ts` | Add `OverviewScope`, `PersonalDashboardKpis`; extend `DashboardSummary` |
| `src/application/parameters/dashboardState.ts` | Add `overviewScope` + `DASHBOARD_SET_OVERVIEW_SCOPE` |
| `server/modules/parameters/dashboard/repository.ts` | `countPersonalKpis`, `aggregatePersonalTrend` |
| `server/modules/parameters/dashboard/repository.test.ts` | SQL aggregation tests |
| `server/modules/parameters/dashboard/service.ts` | Parallel fetch personal fields |
| `server/modules/parameters/dashboard/service.test.ts` | Service returns personal fields |
| `server/modules/parameters/dashboard/routes.test.ts` | Contract includes personal fields |
| `src/infrastructure/mock/mockParameterDashboardRepository.ts` | Derive personal KPIs/trend from state |
| `src/infrastructure/mock/mockParameterDashboardRepository.test.ts` | Mock personal summary |
| `src/features/parameter-home/overview/deriveOverviewPresentation.ts` | Role → KPI label mapping |
| `src/features/parameter-home/overview/deriveOverviewPresentation.test.ts` | Label mapping tests |
| `src/features/parameter-home/components/OverviewScopeToggle.tsx` | Personal/overall segmented control |
| `src/features/parameter-home/components/OverviewScopeToggle.test.tsx` | Toggle emits scope |
| `src/features/parameter-home/components/SituationStrip.tsx` | Scope-aware KPI grid + toggle in actions |
| `src/features/parameter-home/components/OverviewRow.tsx` | Wire scope, personal data, trend title |
| `src/features/parameter-home/components/UpdateTrendChart.tsx` | Optional legend label props |
| `src/features/parameter-home/ParameterHomePage.tsx` | Default scope by role, pass props |
| `src/App.tsx` | Dispatch overview scope, reset on role change |
| `src/app/routes.tsx` | Pass `onDashboardOverviewScopeChange` |
| `src/features/parameter-home/parameter-home.css` | Toggle in panel head, responsive |

---

## Shared Contracts (Task 1 — do not rename later)

```ts
// src/domain/parameters/dashboardTypes.ts
export type OverviewScope = "personal" | "overall";

export type PersonalDashboardKpis = {
  contributionCount: number;
  workflowCount: number;
  openItemCount: number;
  pendingTodoCount: number;
  highRiskTouchCount: number;
};

export type DashboardSummary = {
  window: DashboardWindow;
  windowLabel: string;
  projectId: string | null;
  kpis: DashboardKpis;
  trend: TrendPoint[];
  riskBuckets: ProjectRiskBucket[];
  workbenchSignals: WorkbenchSignals;
  personalKpis: PersonalDashboardKpis;
  personalTrend: TrendPoint[];
};
```

```ts
// src/application/parameters/dashboardState.ts
export type DashboardState = {
  window: DashboardWindow;
  dimension: HotspotDimension;
  projectScope: string | null;
  overviewScope: OverviewScope;
  summary: { status: SectionStatus; data: DashboardSummary | null; error: string | null };
  hotspots: { status: SectionStatus; data: DashboardHotspot[]; error: string | null };
};

export type DashboardAction =
  | { type: "DASHBOARD_SET_OVERVIEW_SCOPE"; scope: OverviewScope }
  // ...existing actions
```

**V1 backend aggregation semantics (all roles, same SQL shape):**

| Field | SQL / source |
| --- | --- |
| `contributionCount` | `parameter_history_entries` where `changed_by_user_id = userId` and `changed_at >= windowStart` |
| `workflowCount` | `parameter_change_requests` where `submitter_user_id = userId` and `created_at >= windowStart` |
| `openItemCount` | From `aggregateWorkbenchSignals`: user→`myDrafts`, committer→`reviewQueue`, admin→`unappliedImportBatches` |
| `pendingTodoCount` | From signals: user→`returnedChanges + waitingMerge`, committer→ high-risk open reviews (subquery), admin→`inactiveAccounts` |
| `highRiskTouchCount` | Personal history entries in window joined to `parameter_definitions` where `risk = 'High'` |

Role-specific **labels** are frontend-only via `deriveOverviewPresentation`.

---

### Task 1: Domain types and dashboard state

**Files:**
- Modify: `src/domain/parameters/dashboardTypes.ts`
- Modify: `src/application/parameters/dashboardState.ts`
- Test: existing tests that construct `DashboardSummary` / `DashboardState` (fix compile errors)

- [ ] **Step 1: Add types to dashboardTypes.ts**

Add after `DashboardKpis`:

```ts
export type OverviewScope = "personal" | "overall";

export type PersonalDashboardKpis = {
  contributionCount: number;
  workflowCount: number;
  openItemCount: number;
  pendingTodoCount: number;
  highRiskTouchCount: number;
};
```

Extend `DashboardSummary` with:

```ts
  personalKpis: PersonalDashboardKpis;
  personalTrend: TrendPoint[];
```

- [ ] **Step 2: Extend dashboardState**

In `initialDashboardState`, add `overviewScope: "personal"` (runtime will override for guest).

Add action:

```ts
  | { type: "DASHBOARD_SET_OVERVIEW_SCOPE"; scope: OverviewScope }
```

Reducer case:

```ts
    case "DASHBOARD_SET_OVERVIEW_SCOPE":
      return { ...state, overviewScope: action.scope };
```

- [ ] **Step 3: Fix compile errors in tests/fixtures**

Grep for `DashboardSummary` literals and add stub personal fields:

```ts
personalKpis: {
  contributionCount: 0,
  workflowCount: 0,
  openItemCount: 0,
  pendingTodoCount: 0,
  highRiskTouchCount: 0
},
personalTrend: []
```

Run: `npx tsc -b 2>&1 | head -30` — expect 0 errors after fixes.

- [ ] **Step 4: Commit**

```bash
git add src/domain/parameters/dashboardTypes.ts src/application/parameters/dashboardState.ts
git add -u  # test fixtures touched by tsc fixes
git commit -m "feat(dashboard): add overview scope and personal summary types"
```

---

### Task 2: Backend personal KPI and trend repository

**Files:**
- Modify: `server/modules/parameters/dashboard/repository.ts`
- Test: `server/modules/parameters/dashboard/repository.test.ts`

- [ ] **Step 1: Write failing test for countPersonalKpis**

Add to `repository.test.ts`:

```ts
import { countPersonalKpis, aggregatePersonalTrend } from "./repository";

it("countPersonalKpis scopes by user, project, and window", async () => {
  const db = {
    query: vi.fn().mockResolvedValue({
      rows: [{
        contribution_count: "3",
        workflow_count: "2",
        open_item_count: "1",
        pending_todo_count: "4",
        high_risk_touch_count: "1"
      }]
    })
  } as unknown as Database;

  const result = await countPersonalKpis(db, {
    organizationId: "org-1",
    projectId: "aurora",
    userId: "user-1",
    windowStart: "2026-01-01T00:00:00.000Z",
    workbenchSignals: {
      reviewQueue: 5,
      myDrafts: 1,
      returnedChanges: 2,
      waitingMerge: 2,
      unappliedImportBatches: 3,
      inactiveAccounts: 4
    },
    roleLevel: "user"
  });

  expect(result).toEqual({
    contributionCount: 3,
    workflowCount: 2,
    openItemCount: 1,
    pendingTodoCount: 4,
    highRiskTouchCount: 1
  });
  expect(db.query).toHaveBeenCalledOnce();
  const sql = vi.mocked(db.query).mock.calls[0][0] as string;
  expect(sql).toContain("changed_by_user_id");
  expect(sql).toContain("submitter_user_id");
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test:server -- server/modules/parameters/dashboard/repository.test.ts -t countPersonalKpis`

- [ ] **Step 3: Implement countPersonalKpis**

Add to `repository.ts`:

```ts
type PersonalKpiInput = OrgScope & {
  userId: string;
  windowStart: string;
  workbenchSignals: {
    reviewQueue: number;
    myDrafts: number;
    returnedChanges: number;
    waitingMerge: number;
    unappliedImportBatches: number;
    inactiveAccounts: number;
  };
  roleLevel: "user" | "committer" | "admin" | "guest";
};

export async function countPersonalKpis(db: Database, input: PersonalKpiInput) {
  const projectFilter = input.projectId ? "and h.project_id = $4" : "";
  const crProjectFilter = input.projectId ? "and cr.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.userId, input.windowStart, input.projectId]
    : [input.organizationId, input.userId, input.windowStart];

  const rows = await db.query<{
    contribution_count: string;
    workflow_count: string;
    high_risk_touch_count: string;
  }>(
    `
    select
      (select count(*) from parameter_history_entries h
        where h.organization_id = $1 and h.changed_by_user_id = $2
          and h.changed_at >= $3 ${projectFilter}) as contribution_count,
      (select count(*) from parameter_change_requests cr
        where cr.organization_id = $1 and cr.submitter_user_id = $2
          and cr.created_at >= $3 ${crProjectFilter}) as workflow_count,
      (select count(*) from parameter_history_entries h
        join project_parameter_values ppv on ppv.id = h.project_parameter_value_id
        join parameter_definitions d on d.id = ppv.parameter_definition_id
       where h.organization_id = $1 and h.changed_by_user_id = $2
         and h.changed_at >= $3 and d.risk = 'High' ${projectFilter}) as high_risk_touch_count
    `,
    args
  );
  const r = rows.rows[0];
  const signals = input.workbenchSignals;

  const openItemCount =
    input.roleLevel === "committer"
      ? signals.reviewQueue
      : input.roleLevel === "admin"
        ? signals.unappliedImportBatches
        : signals.myDrafts;

  const pendingTodoCount =
    input.roleLevel === "admin"
      ? signals.inactiveAccounts
      : input.roleLevel === "committer"
        ? signals.reviewQueue // v1: reuse queue count; high-risk subquery optional follow-up
        : signals.returnedChanges + signals.waitingMerge;

  return {
    contributionCount: Number(r.contribution_count),
    workflowCount: Number(r.workflow_count),
    openItemCount,
    pendingTodoCount,
    highRiskTouchCount: Number(r.high_risk_touch_count)
  };
}
```

- [ ] **Step 4: Implement aggregatePersonalTrend**

Mirror `aggregateTrend` SQL but add `and t.changed_by_user_id = $N` / `and t.submitter_user_id = $N`:

```ts
export async function aggregatePersonalTrend(
  db: Database,
  input: OrgScope & { userId: string; windowStart: string; windowEnd: string; granularity: "day" | "week" }
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  // Copy aggregateTrend structure; filter changes by changed_by_user_id = userId
  // and workflow by submitter_user_id = userId
}
```

Add matching test `aggregatePersonalTrend buckets personal changes only`.

- [ ] **Step 5: Run repository tests — expect PASS**

Run: `npm run test:server -- server/modules/parameters/dashboard/repository.test.ts`

- [ ] **Step 6: Commit**

```bash
git add server/modules/parameters/dashboard/repository.ts server/modules/parameters/dashboard/repository.test.ts
git commit -m "feat(dashboard): add personal KPI and trend repository queries"
```

---

### Task 3: Wire personal fields into dashboard service and routes

**Files:**
- Modify: `server/modules/parameters/dashboard/service.ts`
- Modify: `server/modules/parameters/dashboard/service.test.ts`
- Modify: `server/modules/parameters/dashboard/routes.test.ts`

- [ ] **Step 1: Write failing service test**

In `service.test.ts`, assert `getDashboardSummary` result includes `personalKpis` and `personalTrend` (mock db + auth).

- [ ] **Step 2: Update getDashboardSummary**

```ts
import { getPlatformRole, migrateLegacyRoleId } from "../../../../src/domain/users/types";

// Inside getDashboardSummary, after resolving bounds:
const roleId = migrateLegacyRoleId(input.auth.roles[0]?.roleId ?? "guest");
const role = getPlatformRole(roleId);
const roleLevel = role.level === "admin" ? "admin" : role.level === "committer" ? "committer" : role.level === "user" ? "user" : "guest";

const workbenchSignals = await aggregateWorkbenchSignals(db, { organizationId, projectId, userId: input.auth.user.id });

const [kpis, trendRaw, riskBuckets, personalKpis, personalTrendRaw] = await Promise.all([
  countKpis(db, { organizationId, projectId, windowStart }),
  aggregateTrend(db, { organizationId, projectId, windowStart, windowEnd, granularity }),
  aggregateRiskDistribution(db, { organizationId, projectId }),
  countPersonalKpis(db, { organizationId, projectId, userId: input.auth.user.id, windowStart, workbenchSignals, roleLevel }),
  aggregatePersonalTrend(db, { organizationId, projectId, userId: input.auth.user.id, windowStart, windowEnd, granularity })
]);

return {
  // ...existing
  workbenchSignals,
  personalKpis,
  personalTrend: labelTrendPoints(personalTrendRaw, granularity)
};
```

- [ ] **Step 3: Update routes.test.ts summary fixture**

Add `personalKpis` and `personalTrend: []` to mocked summary object.

- [ ] **Step 4: Run server dashboard tests**

Run: `npm run test:server -- server/modules/parameters/dashboard`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(dashboard): return personal KPIs and trend in summary"
```

---

### Task 4: Mock repository personal summary

**Files:**
- Modify: `src/infrastructure/mock/mockParameterDashboardRepository.ts`
- Modify: `src/infrastructure/mock/mockParameterDashboardRepository.test.ts`
- Modify: `src/infrastructure/http/parameterDashboardClient.test.ts` (if response parsing asserts shape)

- [ ] **Step 1: Add buildPersonalTrend helper**

Copy `buildTrend` but filter history by `entry.changedBy === currentUserName` (or user id if available on history entries) and change requests by `submitter === currentUser.name`.

- [ ] **Step 2: Add buildPersonalKpis**

```ts
function buildPersonalKpis(
  state: PrototypeState,
  window: DashboardWindow,
  projectId: string | undefined,
  roleLevel: "user" | "committer" | "admin" | "guest"
): PersonalDashboardKpis {
  const user = state.users.find((u) => u.id === state.currentUserId);
  const { windowStart } = resolveWindowBounds(window);
  const signals = buildWorkbenchSignals(state, state.currentUserId, projectId);
  // contributionCount: history entries in window by user
  // workflowCount: change requests in window by submitter
  // openItemCount / pendingTodoCount: same mapping as backend countPersonalKpis
  // highRiskTouchCount: personal history on High risk parameters
}
```

- [ ] **Step 3: Extend listDashboardSummary return**

```ts
personalKpis: buildPersonalKpis(state, input.window, input.projectId, roleLevel),
personalTrend: buildPersonalTrend(state, input.window, input.projectId)
```

- [ ] **Step 4: Write mock test**

Assert `listDashboardSummary` returns non-zero `personalKpis.contributionCount` when seeded history exists for current user.

Run: `npx vitest run src/infrastructure/mock/mockParameterDashboardRepository.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(mock): derive personal dashboard summary fields"
```

---

### Task 5: deriveOverviewPresentation and OverviewScopeToggle

**Files:**
- Create: `src/features/parameter-home/overview/deriveOverviewPresentation.ts`
- Create: `src/features/parameter-home/overview/deriveOverviewPresentation.test.ts`
- Create: `src/features/parameter-home/components/OverviewScopeToggle.tsx`
- Create: `src/features/parameter-home/components/OverviewScopeToggle.test.tsx`

- [ ] **Step 1: Write failing presentation test**

```ts
import { describe, expect, it } from "vitest";
import { deriveOverviewPresentation } from "./deriveOverviewPresentation";

describe("deriveOverviewPresentation", () => {
  it("maps user personal KPI labels", () => {
    const view = deriveOverviewPresentation("user", "personal");
    expect(view.kpiItems.map((i) => i.label)).toEqual([
      "我的变更",
      "我的提交",
      "我的草稿",
      "待处理事项",
      "高风险经手"
    ]);
    expect(view.panelSubtitle).toBe("我的关键指标");
    expect(view.trendTitle).toBe("我的变更趋势");
  });

  it("maps overall labels for any role", () => {
    const view = deriveOverviewPresentation("admin", "overall");
    expect(view.panelSubtitle).toBe("参数库关键指标");
    expect(view.trendTitle).toBe("参数更新趋势");
  });
});
```

- [ ] **Step 2: Implement deriveOverviewPresentation**

```ts
import type { OverviewScope, PersonalDashboardKpis, DashboardKpis } from "@/domain/parameters/dashboardTypes";
import type { WorkbenchRoleView } from "../workbench/derivePersonalWorkbench";

type KpiItem = { key: string; label: string; value: number };

const PERSONAL_LABELS: Record<WorkbenchRoleView, [string, string, string, string, string]> = {
  user: ["我的变更", "我的提交", "我的草稿", "待处理事项", "高风险经手"],
  committer: ["我的审阅完成", "我处理的流程", "待我审阅", "队列高风险", "高风险审阅"],
  admin: ["我的治理操作", "我发起的导入", "待应用导入", "待复核账号", "高风险治理"],
  guest: ["我的变更", "我的提交", "我的草稿", "待处理事项", "高风险经手"]
};

const PERSONAL_KEYS: Array<keyof PersonalDashboardKpis> = [
  "contributionCount",
  "workflowCount",
  "openItemCount",
  "pendingTodoCount",
  "highRiskTouchCount"
];

const OVERALL_KEYS: Array<keyof DashboardKpis> = [
  "totalParameters",
  "managedProjects",
  "changeFrequency",
  "activeContributors",
  "highRiskParameters"
];

const OVERALL_LABELS = ["参数总量", "管理项目", "变更频次", "活跃贡献者", "高风险参数"];

export function deriveOverviewPresentation(
  roleView: WorkbenchRoleView,
  scope: OverviewScope,
  kpis?: DashboardKpis | null,
  personalKpis?: PersonalDashboardKpis | null
) {
  if (scope === "overall") {
    return {
      panelSubtitle: "参数库关键指标",
      trendTitle: "参数更新趋势",
      changeSeriesName: "参数变更",
      workflowSeriesName: "流程事件",
      kpiItems: OVERALL_KEYS.map((key, index) => ({
        key,
        label: OVERALL_LABELS[index],
        value: kpis?.[key] ?? 0
      }))
    };
  }

  const labels = PERSONAL_LABELS[roleView];
  return {
    panelSubtitle: "我的关键指标",
    trendTitle: "我的变更趋势",
    changeSeriesName: "我的变更",
    workflowSeriesName: "我的流程",
    kpiItems: PERSONAL_KEYS.map((key, index) => ({
      key,
      label: labels[index],
      value: personalKpis?.[key] ?? 0
    }))
  };
}
```

- [ ] **Step 3: Implement OverviewScopeToggle**

```tsx
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OverviewScope } from "@/domain/parameters/dashboardTypes";

type Props = {
  scope: OverviewScope;
  onScopeChange: (scope: OverviewScope) => void;
};

export function OverviewScopeToggle({ scope, onScopeChange }: Props) {
  return (
    <ToggleGroup
      aria-label="概览视角"
      className="parameter-home__toggle-group parameter-home__overview-scope-toggle"
      type="single"
      value={scope}
      onValueChange={(next) => {
        if (next) onScopeChange(next as OverviewScope);
      }}
    >
      <ToggleGroupItem className="parameter-home__toggle-item" value="personal">
        个人
      </ToggleGroupItem>
      <ToggleGroupItem className="parameter-home__toggle-item" value="overall">
        整体
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
```

- [ ] **Step 4: Toggle test**

```ts
fireEvent.click(screen.getByRole("radio", { name: "整体" }));
expect(onScopeChange).toHaveBeenCalledWith("overall");
```

- [ ] **Step 5: Run tests — PASS**

Run: `npx vitest run src/features/parameter-home/overview src/features/parameter-home/components/OverviewScopeToggle.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/features/parameter-home/overview src/features/parameter-home/components/OverviewScopeToggle*
git commit -m "feat(parameter-home): add overview presentation mapping and scope toggle"
```

---

### Task 6: SituationStrip and OverviewRow scope wiring

**Files:**
- Modify: `src/features/parameter-home/components/SituationStrip.tsx`
- Modify: `src/features/parameter-home/components/SituationStrip.test.tsx`
- Modify: `src/features/parameter-home/components/OverviewRow.tsx`

- [ ] **Step 1: Write failing SituationStrip test for personal scope**

```ts
render(
  <SituationStrip
    status="ready"
    scope="personal"
    roleView="user"
    kpis={null}
    personalKpis={{
      contributionCount: 4,
      workflowCount: 2,
      openItemCount: 1,
      pendingTodoCount: 3,
      highRiskTouchCount: 1
    }}
    onScopeChange={vi.fn()}
  />
);
expect(screen.getByText("我的变更")).toBeInTheDocument();
expect(screen.getByText("4")).toBeInTheDocument();
```

- [ ] **Step 2: Refactor SituationStrip**

Replace static `KPI_ITEMS` with `deriveOverviewPresentation(roleView, scope, kpis, personalKpis).kpiItems`.

Pass `actions={<OverviewScopeToggle scope={scope} onScopeChange={onScopeChange} />}` to `Panel`.

Empty state for personal all-zero:

```tsx
{status === "ready" && allZero && scope === "personal" ? (
  <p className="parameter-home__section-empty">
    当前时间窗口暂无个人活动
    {roleView === "guest" ? "。当前为只读视角，暂无个人贡献数据" : null}
  </p>
) : null}
```

- [ ] **Step 3: Update OverviewRow**

```tsx
<SituationStrip
  scope={overviewScope}
  roleView={roleView}
  status={summaryStatus}
  kpis={kpis}
  personalKpis={summary?.personalKpis ?? null}
  onScopeChange={onOverviewScopeChange}
  ...
/>
<Panel title={presentation.trendTitle} subtitle={summary?.windowLabel} ...>
  <UpdateTrendChart
    points={overviewScope === "personal" ? summary.personalTrend : summary.trend}
    changeSeriesName={presentation.changeSeriesName}
    workflowSeriesName={presentation.workflowSeriesName}
  />
</Panel>
```

- [ ] **Step 4: Run SituationStrip + OverviewRow tests**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(parameter-home): scope-aware situation strip and overview row"
```

---

### Task 7: UpdateTrendChart legend props

**Files:**
- Modify: `src/features/parameter-home/components/UpdateTrendChart.tsx`

- [ ] **Step 1: Add optional props with defaults**

```tsx
type UpdateTrendChartProps = {
  points: TrendPoint[];
  changeSeriesName?: string;
  workflowSeriesName?: string;
};

export function UpdateTrendChart({
  points,
  changeSeriesName = "参数变更",
  workflowSeriesName = "流程事件"
}: UpdateTrendChartProps) {
  // use changeSeriesName / workflowSeriesName in <Area name=...> and <Line name=...>
}
```

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(parameter-home): parameterize trend chart series labels"
```

---

### Task 8: ParameterHomePage and App state wiring

**Files:**
- Modify: `src/features/parameter-home/ParameterHomePage.tsx`
- Modify: `src/features/parameter-home/ParameterHomePage.test.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Default overviewScope by role in ParameterHomePage**

```tsx
import { getWorkbenchRoleView } from "./workbench/derivePersonalWorkbench";

const roleView = useMemo(
  () => getWorkbenchRoleView(migrateLegacyRoleId(state.activeRoleId)),
  [state.activeRoleId]
);

useEffect(() => {
  const defaultScope = roleView === "guest" ? "overall" : "personal";
  if (dashboardState.overviewScope !== defaultScope) {
    onDashboardOverviewScopeChange(defaultScope);
  }
}, [roleView]); // only reset when role changes — use ref to detect role change vs mount
```

**Note:** Implement role-change detection with `useRef(previousRoleView)` to avoid fighting user toggles on unrelated re-renders.

- [ ] **Step 2: Pass props through routes and App**

```tsx
onDashboardOverviewScopeChange={(scope) =>
  dashboardDispatch({ type: "DASHBOARD_SET_OVERVIEW_SCOPE", scope })
}
```

- [ ] **Step 3: ParameterHomePage tests**

- hardware-user defaults to personal labels visible
- guest renders overall KPI labels by default
- toggling scope changes visible KPI labels

- [ ] **Step 4: App.test.tsx**

On `/parameter-home`, expect `getByRole("group", { name: "概览视角" })` or radio buttons `个人`/`整体`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/features/parameter-home src/App.test.tsx`

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(parameter-home): wire overview scope state and role defaults"
```

---

### Task 9: CSS and browser verification

**Files:**
- Modify: `src/features/parameter-home/parameter-home.css`

- [ ] **Step 1: Panel head layout for toggle**

```css
.parameter-home__panel--situation .parameter-home__panel-head {
  align-items: flex-start;
}

.parameter-home__overview-scope-toggle {
  flex-shrink: 0;
}

@media (max-width: 900px) {
  .parameter-home__panel--situation .parameter-home__panel-head {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
}
```

- [ ] **Step 2: Browser verification**

```bash
npm run dev
```

Visit `http://127.0.0.1:5173/parameter-home`:

| Viewport | Checks |
| --- | --- |
| 1440×900 | Default personal for admin; toggle to overall; KPI + trend switch |
| 390×844 | Toggle not overlapping; no horizontal scroll |
| guest role | Default overall |

Save screenshots to `work/ui-checks/parameter-home-personal-overview-{desktop,mobile}.png`.

Console: `playwright-cli ... console error` — expect 0 errors.

- [ ] **Step 3: Build gate**

```bash
NODE_OPTIONS='--max-old-space-size=4096' npx tsc -b && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git commit -am "style(parameter-home): overview scope toggle layout"
```

---

### Task 10: Documentation gate

**Files:**
- Modify: `docs/design-docs/2026-07-08-parameter-home-personal-overview-design.md` (status → implemented)
- Modify: `docs/zh-CN/design-docs/api-contract.md` (if dashboard summary documented — add `personalKpis`, `personalTrend`)

- [ ] **Step 1: Update design doc status**

```markdown
**状态**：已实现 — 见 [2026-07-08-parameter-home-personal-overview.md](../exec-plans/active/2026-07-08-parameter-home-personal-overview.md)
```

- [ ] **Step 2: Move plan to completed after PR merge**

Per `docs/PLANS.md`, move plan file to `docs/exec-plans/completed/` when done.

- [ ] **Step 3: Run docs check if API contract touched**

```bash
npm run docs:check
```

- [ ] **Step 4: Commit**

```bash
git commit -am "docs(parameter-home): mark personal overview design implemented"
```

---

## Spec Coverage Self-Review

| Spec requirement | Task |
| --- | --- |
| Default personal for non-guest | Task 8 |
| Guest default overall | Task 8 |
| Toggle in overview panel (方案 A) | Task 5–6 |
| KPI + trend switch together | Task 6–7 |
| Time window + project scope filter | Task 2–4 (backend/mock) |
| Hotspot unaffected | No change (verify in browser) |
| Session-only scope state | Task 1, 8 |
| Guest personal empty state | Task 6 |
| API + mock parity | Task 2–4 |
| Role-specific KPI labels | Task 5 |
| Tests | Tasks 2–8 |
| Browser verification | Task 9 |

No TBD/TODO placeholders in this plan.

---

## Documentation Impact Matrix

| Document | Impact | Required update |
| --- | --- | --- |
| `docs/design-docs/api-contract.md` | Dashboard summary DTO adds personal KPI/trend fields. | Update if the English contract documents dashboard response fields in detail. |
| `docs/zh-CN/design-docs/api-contract.md` | Chinese API contract already documents `personalKpis`, `personalTrend`, and `perspectiveRoleId`. | Keep in sync with any future English contract expansion. |
| `docs/FRONTEND.md` / `docs/zh-CN/FRONTEND.md` | Frontend dashboard behavior adds overview-scope state and UI. | Update if the feature becomes a durable frontend behavior beyond the plan/spec. |
| `docs/generated/openapi.json` | Route shape is unchanged; response schemas are governed by contract generation if schema registry changes. | Run `npm run contract:check` when backend contract files change. |

## Documentation Update Gate

- Run `npm run docs:check` before marking this plan complete.
- Run `npm run contract:check` if dashboard route metadata, schemas, or OpenAPI artifacts change.
- Do not move this plan to `docs/exec-plans/completed/` until the parent PR merge/sync step confirms documentation gates passed.

---

## Execution Handoff

Plan saved to `docs/exec-plans/active/2026-07-08-parameter-home-personal-overview.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — implement tasks in this session with checkpoints

Which approach do you want?
