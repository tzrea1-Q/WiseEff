# Parameter Management Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parameter-management homepage that works as a manager-facing operations hub with entry shortcuts, dashboard metrics, key parameter changes, and an explainable AI hotspot ranking.

**Architecture:** Keep the new homepage isolated from the existing workbench pages. Add a pure analytics module that derives homepage metrics from `PrototypeState`, then render those derived values in a dedicated `ParameterManagementHomePage` component wired into the existing `/` route.

**Tech Stack:** Vite, React 19, TypeScript, Vitest, Testing Library, existing CSS in `src/styles.css`, lucide-react icons.

---

## File Structure

- Create `src/parameterHomepageAnalytics.ts`: pure derivation functions for totals, change frequency, key changes, flow health, entry status counts, AI hotspot scores, and time-window labels.
- Create `src/parameterHomepageAnalytics.test.ts`: unit tests for the analytics module.
- Create `src/ParameterManagementHomePage.tsx`: homepage component that receives `PrototypeState` and `onNavigate`, owns the time-window switcher, and renders the manager-facing hub.
- Create `src/ParameterManagementHomePage.test.tsx`: component-level tests for metrics, entries, hotspot drilldown, time-window switching, and contextual navigation callbacks.
- Modify `src/App.tsx`: route `/` to `ParameterManagementHomePage`, preserve query strings in navigation, and remove the old `LinearTemplateHome` route usage.
- Modify `src/App.test.tsx`: replace old Linear-style homepage assertions with parameter-management homepage assertions.
- Modify `src/styles.css`: add the homepage layout and responsive styles.

---

### Task 1: Analytics Model

**Files:**
- Create: `src/parameterHomepageAnalytics.ts`
- Create: `src/parameterHomepageAnalytics.test.ts`

- [ ] **Step 1: Write the failing analytics tests**

Create `src/parameterHomepageAnalytics.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { deriveParameterHomepageAnalytics } from "./parameterHomepageAnalytics";
import { initialState } from "./mockData";

describe("parameter homepage analytics", () => {
  it("derives manager dashboard metrics from the prototype state", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d");

    expect(analytics.timeWindowLabel).toBe("近 30 天");
    expect(analytics.summary.totalParameters).toBe(30);
    expect(analytics.summary.parameterDefinitions).toBe(10);
    expect(analytics.summary.debugParameters).toBe(8);
    expect(analytics.summary.highRiskParameters).toBe(12);
    expect(analytics.summary.changeEvents).toBeGreaterThanOrEqual(initialState.changeRequests.length);
    expect(analytics.flowHealth.reviewQueue).toBe(initialState.changeRequests.length);
    expect(analytics.entryCards.map((entry) => entry.path)).toEqual([
      "/parameters",
      "/parameter-comparison",
      "/parameter-review",
      "/parameter-admin"
    ]);
  });

  it("ranks AI hotspots with explainable score dimensions", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d");

    expect(analytics.hotspots.length).toBeGreaterThanOrEqual(3);
    expect(analytics.hotspots[0].score).toBeGreaterThanOrEqual(analytics.hotspots[1].score);
    expect(analytics.hotspots[0].scoreBreakdown).toEqual(
      expect.objectContaining({
        frequency: expect.any(Number),
        risk: expect.any(Number),
        impact: expect.any(Number),
        workflow: expect.any(Number),
        drift: expect.any(Number)
      })
    );
    expect(analytics.hotspots[0].explanation).toContain("近 30 天");
    expect(analytics.hotspots[0].suggestedPath).toMatch(/^\\/(parameters|parameter-comparison|parameter-review|parameter-admin)/);
  });

  it("returns key parameter changes sorted by drift and risk", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d");

    expect(analytics.keyChanges).toHaveLength(4);
    expect(analytics.keyChanges[0]).toEqual(
      expect.objectContaining({
        parameterName: expect.any(String),
        projectCode: expect.any(String),
        currentValue: expect.any(String),
        recommendedValue: expect.any(String),
        risk: expect.stringMatching(/High|Medium|Low/),
        suggestedPath: expect.stringContaining("/parameters")
      })
    );
  });

  it("keeps alternate time windows explicit for the UI", () => {
    expect(deriveParameterHomepageAnalytics(initialState, "7d").timeWindowLabel).toBe("近 7 天");
    expect(deriveParameterHomepageAnalytics(initialState, "cycle").timeWindowLabel).toBe("当前版本周期");
  });
});
```

- [ ] **Step 2: Run the failing analytics tests**

Run:

```bash
npm test -- src/parameterHomepageAnalytics.test.ts
```

Expected: fail because `src/parameterHomepageAnalytics.ts` does not exist.

- [ ] **Step 3: Add the analytics implementation**

Create `src/parameterHomepageAnalytics.ts` with:

```ts
import type { ChangeRequest, ParameterRecord, PrototypeState, RiskLevel } from "./mockData";
import { projects } from "./mockData";

export type HomepageTimeWindow = "7d" | "30d" | "cycle";

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
  title: string;
  projectCode: string;
  module: string;
  status: string;
  changeCount: number;
  highRiskCount: number;
  score: number;
  scoreBreakdown: HotspotScoreBreakdown;
  explanation: string;
  evidence: string[];
  suggestedAction: string;
  suggestedPath: string;
};

export type KeyParameterChange = {
  id: string;
  parameterName: string;
  module: string;
  projectCode: string;
  currentValue: string;
  recommendedValue: string;
  driftLabel: string;
  reason: string;
  risk: RiskLevel;
  status: string;
  suggestedPath: string;
};

export type ParameterHomepageAnalytics = {
  timeWindow: HomepageTimeWindow;
  timeWindowLabel: string;
  summary: HomepageSummary;
  flowHealth: HomepageFlowHealth;
  entryCards: HomepageEntryCard[];
  hotspots: ParameterHotspot[];
  keyChanges: KeyParameterChange[];
  aiSummary: {
    title: string;
    body: string;
    dimensions: Array<{ label: string; value: string }>;
  };
};

const timeWindowLabels: Record<HomepageTimeWindow, string> = {
  "7d": "近 7 天",
  "30d": "近 30 天",
  cycle: "当前版本周期"
};

const riskScore: Record<RiskLevel, number> = {
  High: 18,
  Medium: 10,
  Low: 4
};

export function deriveParameterHomepageAnalytics(
  state: PrototypeState,
  timeWindow: HomepageTimeWindow = "30d"
): ParameterHomepageAnalytics {
  const timeWindowLabel = timeWindowLabels[timeWindow];
  const libraryParameterNames = new Set(state.parameters.map((parameter) => parameter.name));
  const highRiskParameters = state.parameters.filter((parameter) => parameter.risk === "High");
  const hotspots = deriveHotspots(state, timeWindowLabel);
  const flowHealth = deriveFlowHealth(state.changeRequests);
  const keyChanges = deriveKeyChanges(state.parameters);

  return {
    timeWindow,
    timeWindowLabel,
    summary: {
      totalParameters: state.parameters.length,
      parameterDefinitions: libraryParameterNames.size,
      debugParameters: state.debugParameters.length,
      highRiskParameters: highRiskParameters.length,
      changeEvents: state.changeRequests.length + countRecentlyUpdatedParameters(state.parameters, timeWindow),
      activeHotspots: hotspots.length
    },
    flowHealth,
    entryCards: deriveEntryCards(flowHealth, highRiskParameters.length),
    hotspots,
    keyChanges,
    aiSummary: {
      title: `${timeWindowLabel} AI 综合变更热区`,
      body: `WiseAgent 已综合变更频次、风险权重、影响范围、流程堆积和异常偏离，识别出 ${hotspots.length} 个需要管理者关注的参数热区。`,
      dimensions: [
        { label: "变更频次", value: "近 30 天变更次数、环比、峰值日期" },
        { label: "风险权重", value: "高风险参数与安全关键模块占比" },
        { label: "影响范围", value: "项目、设备、日志和共用定义覆盖面" },
        { label: "流程堆积", value: "待审阅、等待合入和停留时间" },
        { label: "异常偏离", value: "当前值相对推荐值和范围的偏离" }
      ]
    }
  };
}

function deriveFlowHealth(changeRequests: ChangeRequest[]): HomepageFlowHealth {
  return {
    reviewQueue: changeRequests.length,
    autoChecked: changeRequests.filter((request) => request.status === "自动检查通过").length,
    waitingMerge: changeRequests.filter((request) => request.status === "等待合入").length,
    merged: changeRequests.filter((request) => request.status === "已合入").length,
    needsHumanConfirmation: changeRequests.filter((request) => request.status !== "已合入").length
  };
}

function deriveEntryCards(flowHealth: HomepageFlowHealth, highRiskCount: number): HomepageEntryCard[] {
  return [
    {
      title: "参数工作台",
      description: "查询、筛选、提交参数修改请求",
      path: "/parameters",
      statusLabel: "高风险参数",
      statusValue: `${highRiskCount}`
    },
    {
      title: "参数对比分析",
      description: "查看跨项目差异和漂移",
      path: "/parameter-comparison",
      statusLabel: "推荐对比",
      statusValue: "Aurora vs Nebula"
    },
    {
      title: "参数审阅队列",
      description: "推进待审阅、待合入流程",
      path: "/parameter-review",
      statusLabel: "待处理",
      statusValue: `${flowHealth.needsHumanConfirmation}`
    },
    {
      title: "参数管理后台",
      description: "维护参数库、权限和审计",
      path: "/parameter-admin",
      statusLabel: "治理事项",
      statusValue: `${flowHealth.reviewQueue}`
    }
  ];
}

function deriveHotspots(state: PrototypeState, timeWindowLabel: string): ParameterHotspot[] {
  const groups = new Map<string, { projectId: string; module: string; parameters: ParameterRecord[]; requests: ChangeRequest[] }>();

  for (const parameter of state.parameters) {
    const key = `${parameter.projectId}:${parameter.module}`;
    const current = groups.get(key) ?? { projectId: parameter.projectId, module: parameter.module, parameters: [], requests: [] };
    current.parameters.push(parameter);
    groups.set(key, current);
  }

  for (const request of state.changeRequests) {
    const parameter = state.parameters.find((item) => item.id === request.parameterId);
    if (!parameter) {
      continue;
    }
    const key = `${parameter.projectId}:${request.module}`;
    const current = groups.get(key) ?? { projectId: parameter.projectId, module: request.module, parameters: [], requests: [] };
    current.requests.push(request);
    groups.set(key, current);
  }

  return Array.from(groups.values())
    .map((group) => {
      const project = projects.find((item) => item.id === group.projectId) ?? projects[0];
      const highRiskCount = group.parameters.filter((parameter) => parameter.risk === "High").length;
      const workflowCount = group.requests.filter((request) => request.status !== "已合入").length;
      const drift = Math.round(group.parameters.reduce((sum, parameter) => sum + getDriftScore(parameter), 0));
      const breakdown: HotspotScoreBreakdown = {
        frequency: group.requests.length * 16 + group.parameters.length * 3,
        risk: highRiskCount * 18,
        impact: countProjectsWithModule(group.module, state.parameters) * 8,
        workflow: workflowCount * 14,
        drift
      };
      const score = breakdown.frequency + breakdown.risk + breakdown.impact + breakdown.workflow + breakdown.drift;
      const status = group.requests[0]?.status ?? (highRiskCount > 0 ? "高风险关注" : "趋势观察");

      return {
        id: `${group.projectId}-${group.module}`,
        title: `${project.code} / ${group.module}`,
        projectCode: project.code,
        module: group.module,
        status,
        changeCount: group.requests.length + group.parameters.length,
        highRiskCount,
        score,
        scoreBreakdown: breakdown,
        explanation: `${timeWindowLabel} ${project.code} 的 ${group.module} 出现 ${group.requests.length} 条流程变更和 ${highRiskCount} 个高风险参数，建议优先复核。`,
        evidence: group.parameters.slice(0, 3).map((parameter) => `${parameter.name}: ${parameter.currentValue} -> ${parameter.recommendedValue}`),
        suggestedAction: workflowCount > 0 ? "进入审阅队列" : "查看参数工作台",
        suggestedPath:
          workflowCount > 0
            ? `/parameter-review?project=${group.projectId}&module=${encodeURIComponent(group.module)}&status=${encodeURIComponent(status)}`
            : `/parameters?project=${group.projectId}&module=${encodeURIComponent(group.module)}`
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function deriveKeyChanges(parameters: ParameterRecord[]): KeyParameterChange[] {
  return parameters
    .map((parameter) => {
      const project = projects.find((item) => item.id === parameter.projectId) ?? projects[0];
      const drift = getDriftScore(parameter);

      return {
        id: parameter.id,
        parameterName: parameter.name,
        module: parameter.module,
        projectCode: project.code,
        currentValue: `${parameter.currentValue} ${parameter.unit}`.trim(),
        recommendedValue: `${parameter.recommendedValue} ${parameter.unit}`.trim(),
        driftLabel: drift > 0 ? `偏离 ${Math.round(drift)} 分` : "与示例值一致",
        reason: `${parameter.module} 参数与示例值存在差异，建议结合日志与审阅记录确认。`,
        risk: parameter.risk,
        status: parameter.risk === "High" ? "需要人工确认" : "建议观察",
        suggestedPath: `/parameters?project=${parameter.projectId}&module=${encodeURIComponent(parameter.module)}&parameter=${parameter.id}`
      };
    })
    .sort((left, right) => {
      const riskDelta = riskScore[right.risk] - riskScore[left.risk];
      return riskDelta !== 0 ? riskDelta : right.driftLabel.localeCompare(left.driftLabel);
    })
    .slice(0, 4);
}

function getDriftScore(parameter: ParameterRecord) {
  const current = Number.parseFloat(parameter.currentValue);
  const recommended = Number.parseFloat(parameter.recommendedValue);

  if (!Number.isFinite(current) || !Number.isFinite(recommended)) {
    return parameter.currentValue === parameter.recommendedValue ? 0 : 8;
  }

  const delta = Math.abs(current - recommended);
  const base = Math.max(Math.abs(recommended), 1);
  return Math.min(30, Math.round((delta / base) * 100));
}

function countProjectsWithModule(module: string, parameters: ParameterRecord[]) {
  return new Set(parameters.filter((parameter) => parameter.module === module).map((parameter) => parameter.projectId)).size;
}

function countRecentlyUpdatedParameters(parameters: ParameterRecord[], timeWindow: HomepageTimeWindow) {
  if (timeWindow === "30d" || timeWindow === "cycle") {
    return parameters.length;
  }

  return Math.max(1, Math.ceil(parameters.length * 0.45));
}
```

- [ ] **Step 4: Run the analytics tests**

Run:

```bash
npm test -- src/parameterHomepageAnalytics.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit analytics model**

```bash
git add src/parameterHomepageAnalytics.ts src/parameterHomepageAnalytics.test.ts
git commit -m "feat: derive parameter homepage analytics"
```

---

### Task 2: Homepage Component

**Files:**
- Create: `src/ParameterManagementHomePage.tsx`
- Create: `src/ParameterManagementHomePage.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/ParameterManagementHomePage.test.tsx` with:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ParameterManagementHomePage } from "./ParameterManagementHomePage";
import { initialState } from "./mockData";

describe("ParameterManagementHomePage", () => {
  it("renders the manager-facing operations hub", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(screen.getByRole("main", { name: "参数管理首页" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "参数运营中枢" })).toBeInTheDocument();
    expect(screen.getByText("近 30 天")).toBeInTheDocument();
    expect(screen.getByText("参数总量")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("共享参数定义")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("AI 综合变更热区榜")).toBeInTheDocument();
    expect(screen.getByText("关键参数变化")).toBeInTheDocument();
  });

  it("renders entry cards and calls navigation with contextual paths", () => {
    const onNavigate = vi.fn();
    render(<ParameterManagementHomePage state={initialState} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: /参数审阅队列/ }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-review");

    const hotspotRegion = screen.getByRole("region", { name: "AI 综合变更热区榜" });
    fireEvent.click(within(hotspotRegion).getAllByRole("button", { name: /进入/ })[0]);

    expect(onNavigate).toHaveBeenLastCalledWith(expect.stringMatching(/^\\/(parameters|parameter-review)/));
  });

  it("switches time windows and expands hotspot explanations", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "近 7 天" }));
    expect(screen.getByText("近 7 天参数变化态势")).toBeInTheDocument();

    const hotspotRegion = screen.getByRole("region", { name: "AI 综合变更热区榜" });
    fireEvent.click(within(hotspotRegion).getAllByRole("button", { name: /查看评分/ })[0]);

    expect(screen.getByText("评分拆解")).toBeInTheDocument();
    expect(screen.getByText("变更频次")).toBeInTheDocument();
    expect(screen.getByText("风险权重")).toBeInTheDocument();
    expect(screen.getByText("影响范围")).toBeInTheDocument();
    expect(screen.getByText("流程堆积")).toBeInTheDocument();
    expect(screen.getByText("异常偏离")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing component tests**

Run:

```bash
npm test -- src/ParameterManagementHomePage.test.tsx
```

Expected: fail because `src/ParameterManagementHomePage.tsx` does not exist.

- [ ] **Step 3: Add the homepage component**

Create `src/ParameterManagementHomePage.tsx` with:

```tsx
import { ArrowRight, Bot, Database, GitCompare, LayoutDashboard, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { PrototypeState } from "./mockData";
import {
  deriveParameterHomepageAnalytics,
  HomepageTimeWindow,
  ParameterHotspot
} from "./parameterHomepageAnalytics";

const timeWindowOptions: Array<{ value: HomepageTimeWindow; label: string }> = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "cycle", label: "当前版本周期" }
];

const entryIcons = [SlidersHorizontal, GitCompare, ShieldCheck, Database];

export function ParameterManagementHomePage({
  state,
  onNavigate
}: {
  state: PrototypeState;
  onNavigate: (path: string) => void;
}) {
  const [timeWindow, setTimeWindow] = useState<HomepageTimeWindow>("30d");
  const [expandedHotspotId, setExpandedHotspotId] = useState<string | null>(null);
  const analytics = useMemo(() => deriveParameterHomepageAnalytics(state, timeWindow), [state, timeWindow]);
  const expandedHotspot = analytics.hotspots.find((hotspot) => hotspot.id === expandedHotspotId) ?? analytics.hotspots[0];

  return (
    <main className="parameter-homepage" aria-label="参数管理首页">
      <section className="parameter-homepage-hero">
        <div className="parameter-homepage-copy">
          <span className="eyebrow">Parameter Operations</span>
          <h1>参数运营中枢</h1>
          <p>{analytics.aiSummary.body}</p>
          <div className="homepage-window-switcher" aria-label="时间窗口">
            {timeWindowOptions.map((option) => (
              <button
                className={option.value === timeWindow ? "active" : ""}
                key={option.value}
                type="button"
                onClick={() => setTimeWindow(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="parameter-homepage-status">
          <LayoutDashboard size={24} />
          <strong>{analytics.timeWindowLabel}参数变化态势</strong>
          <span>{analytics.summary.activeHotspots} 个 AI 热区需要关注</span>
        </div>
      </section>

      <section className="homepage-entry-grid" aria-label="参数管理入口集合">
        {analytics.entryCards.map((entry, index) => {
          const Icon = entryIcons[index] ?? SlidersHorizontal;
          return (
            <button className="homepage-entry-card" key={entry.path} type="button" onClick={() => onNavigate(entry.path)}>
              <Icon size={22} />
              <span>{entry.statusLabel}</span>
              <strong>{entry.statusValue}</strong>
              <h2>{entry.title}</h2>
              <p>{entry.description}</p>
              <ArrowRight size={16} />
            </button>
          );
        })}
      </section>

      <section className="homepage-metric-grid" aria-label="应用看板">
        <Metric label="参数总量" value={`${analytics.summary.totalParameters}`} text="跨 Aurora / Nebula / Atlas 的项目参数运行态" />
        <Metric label="共享参数定义" value={`${analytics.summary.parameterDefinitions}`} text="所有项目共用同一套参数定义" />
        <Metric label="修改频次" value={`${analytics.summary.changeEvents}`} text={`${analytics.timeWindowLabel} 变更和更新时间聚合`} />
        <Metric label="关键风险参数" value={`${analytics.summary.highRiskParameters}`} text="高风险参数需要保留人工确认" />
      </section>

      <section className="homepage-main-grid">
        <section className="homepage-panel" aria-label="AI 综合变更热区榜">
          <PanelTitle icon={<Sparkles size={18} />} title="AI 综合变更热区榜" meta={analytics.timeWindowLabel} />
          <div className="hotspot-list">
            {analytics.hotspots.map((hotspot) => (
              <article className="hotspot-card" key={hotspot.id}>
                <div>
                  <span>{hotspot.status}</span>
                  <h3>{hotspot.title}</h3>
                  <p>{hotspot.explanation}</p>
                </div>
                <strong>{hotspot.score}</strong>
                <div className="hotspot-actions">
                  <button type="button" onClick={() => setExpandedHotspotId(hotspot.id)}>
                    查看评分
                  </button>
                  <button type="button" onClick={() => onNavigate(hotspot.suggestedPath)}>
                    进入 {hotspot.suggestedAction}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="homepage-panel ai-explain-panel">
          <PanelTitle icon={<Bot size={18} />} title="AI 分析解释" meta="可解释，不越权" />
          {expandedHotspot ? <HotspotBreakdown hotspot={expandedHotspot} /> : null}
        </aside>
      </section>

      <section className="homepage-main-grid lower">
        <section className="homepage-panel">
          <PanelTitle icon={<SlidersHorizontal size={18} />} title="关键参数变化" meta={`${analytics.keyChanges.length} 项`} />
          <div className="key-change-list">
            {analytics.keyChanges.map((change) => (
              <button className="key-change-row" key={change.id} type="button" onClick={() => onNavigate(change.suggestedPath)}>
                <span>{change.projectCode}</span>
                <strong>{change.parameterName}</strong>
                <small>{change.currentValue} → {change.recommendedValue}</small>
                <em>{change.status}</em>
              </button>
            ))}
          </div>
        </section>
        <section className="homepage-panel governance-panel">
          <PanelTitle icon={<ShieldCheck size={18} />} title="治理闭环" meta="人工确认保留" />
          <div className="flow-health-grid">
            <Metric label="待审阅" value={`${analytics.flowHealth.reviewQueue}`} text="等待管理员确认" />
            <Metric label="自动检查通过" value={`${analytics.flowHealth.autoChecked}`} text="可推进到合入" />
            <Metric label="等待合入" value={`${analytics.flowHealth.waitingMerge}`} text="流程堆积关注" />
            <Metric label="已合入" value={`${analytics.flowHealth.merged}`} text="完成治理留痕" />
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, text }: { label: string; value: string; text: string }) {
  return (
    <div className="homepage-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{text}</p>
    </div>
  );
}

function PanelTitle({ icon, title, meta }: { icon: ReactNode; title: string; meta: string }) {
  return (
    <div className="homepage-panel-title">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
      <span>{meta}</span>
    </div>
  );
}

function HotspotBreakdown({ hotspot }: { hotspot: ParameterHotspot }) {
  const items = [
    ["变更频次", hotspot.scoreBreakdown.frequency],
    ["风险权重", hotspot.scoreBreakdown.risk],
    ["影响范围", hotspot.scoreBreakdown.impact],
    ["流程堆积", hotspot.scoreBreakdown.workflow],
    ["异常偏离", hotspot.scoreBreakdown.drift]
  ] as const;

  return (
    <div className="hotspot-breakdown">
      <h3>评分拆解</h3>
      {items.map(([label, value]) => (
        <div className="breakdown-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      <h3>关联证据</h3>
      <ul>
        {hotspot.evidence.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run the component tests**

Run:

```bash
npm test -- src/ParameterManagementHomePage.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit homepage component**

```bash
git add src/ParameterManagementHomePage.tsx src/ParameterManagementHomePage.test.tsx
git commit -m "feat: add parameter management homepage"
```

---

### Task 3: Route Integration And Contextual Navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Update App tests for the new homepage route**

In `src/App.test.tsx`, replace the old test named `renders the localized WiseEff homepage on the home route` with:

```tsx
it("renders the parameter management operations homepage on the home route", () => {
  window.history.replaceState(null, "", "/");

  render(<App />);

  expect(screen.getByRole("main", { name: "参数管理首页" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "参数运营中枢" })).toBeInTheDocument();
  expect(screen.getByText("AI 综合变更热区榜")).toBeInTheDocument();
  expect(screen.getByText("关键参数变化")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /参数工作台/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /参数审阅队列/ })).toBeInTheDocument();
  expect(document.querySelector(".topbar")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();
});
```

In the same file, replace the old CTA/link test named `links the localized homepage CTAs into the WiseEff workbench` with:

```tsx
it("navigates from homepage entries into parameter management routes", () => {
  window.history.replaceState(null, "", "/");

  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /参数工作台/ }));
  expect(window.location.pathname).toBe("/parameters");

  window.history.replaceState(null, "", "/");
  cleanup();
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /参数审阅队列/ }));
  expect(window.location.pathname).toBe("/parameter-review");
});
```

Delete these old Linear homepage tests because the new homepage intentionally removes that surface:

```tsx
it("organizes the localized homepage around WiseEff workflow sections", () => {});
it("switches the hero stage carousel across WiseEff applications", () => {});
it("pauses the hero stage auto rotation after manual carousel navigation", () => {});
```

Add this new contextual navigation test near the other homepage tests:

```tsx
it("preserves contextual query strings when navigating from homepage hotspots", () => {
  window.history.replaceState(null, "", "/");

  render(<App />);

  const hotspotRegion = screen.getByRole("region", { name: "AI 综合变更热区榜" });
  fireEvent.click(within(hotspotRegion).getAllByRole("button", { name: /进入/ })[0]);

  expect(["/parameters", "/parameter-review"]).toContain(window.location.pathname);
  expect(window.location.search).toMatch(/module=|project=/);
});
```

- [ ] **Step 2: Run App tests to verify they fail before integration**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: fail because `/` still renders `LinearTemplateHome` and navigation currently stores paths without query normalization.

- [ ] **Step 3: Wire the new component into App**

In `src/App.tsx`, replace:

```ts
import { LinearTemplateHome } from "./linear-template/LinearTemplateHome";
```

with:

```ts
import { ParameterManagementHomePage } from "./ParameterManagementHomePage";
```

Replace the existing `navigate` function with:

```ts
  const navigate = (nextPath: string) => {
    const url = new URL(nextPath, window.location.origin);
    const nextPage = getPageByPath(url.pathname);
    const nextUrl = `${nextPage.path}${url.search}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (nextUrl === currentUrl) {
      setPath(nextPage.path);
      return;
    }

    window.history.pushState(null, "", nextUrl);
    setPath(nextPage.path);
  };
```

In `PageRouter`, replace:

```tsx
    default:
      return <HomePage />;
```

with:

```tsx
    default:
      return <HomePage state={state} onNavigate={onNavigate} />;
```

Replace the existing `HomePage` function with:

```tsx
function HomePage({ state, onNavigate }: Pick<PageProps, "state" | "onNavigate">) {
  return <ParameterManagementHomePage state={state} onNavigate={onNavigate} />;
}
```

- [ ] **Step 4: Run App tests**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: pass after removing old Linear homepage assertions and wiring the new route.

- [ ] **Step 5: Commit route integration**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: route home to parameter operations hub"
```

---

### Task 4: Homepage Styling And Responsive Layout

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add style coverage expectations to the component test**

In `src/ParameterManagementHomePage.test.tsx`, add:

```tsx
it("uses stable class hooks for responsive homepage layout", () => {
  render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

  expect(document.querySelector(".parameter-homepage")).toBeInTheDocument();
  expect(document.querySelector(".parameter-homepage-hero")).toBeInTheDocument();
  expect(document.querySelector(".homepage-entry-grid")).toBeInTheDocument();
  expect(document.querySelector(".homepage-main-grid")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the component test**

Run:

```bash
npm test -- src/ParameterManagementHomePage.test.tsx
```

Expected: pass because the component already emits the class hooks.

- [ ] **Step 3: Add homepage CSS**

Append this block to `src/styles.css`:

```css
.parameter-homepage {
  min-height: 100vh;
  padding: 32px clamp(20px, 4vw, 56px) 56px;
  color: var(--text);
  background:
    radial-gradient(circle at 12% 0%, rgba(51, 116, 255, 0.14), transparent 34%),
    linear-gradient(180deg, #fbfcff 0%, #f4f7ff 100%);
}

.parameter-homepage-hero,
.homepage-entry-card,
.homepage-metric-card,
.homepage-panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 16px 42px rgba(58, 76, 118, 0.1);
}

.parameter-homepage-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.7fr);
  gap: 20px;
  align-items: stretch;
  padding: clamp(22px, 4vw, 40px);
}

.parameter-homepage-copy h1 {
  margin: 10px 0;
  font-size: clamp(36px, 5vw, 64px);
  letter-spacing: 0;
}

.parameter-homepage-copy p,
.parameter-homepage-status span,
.homepage-entry-card p,
.homepage-metric-card p,
.hotspot-card p,
.key-change-row small {
  color: var(--muted);
}

.homepage-window-switcher {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
}

.homepage-window-switcher button,
.hotspot-actions button {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 8px 12px;
  color: var(--text);
  background: #fff;
  cursor: pointer;
}

.homepage-window-switcher button.active {
  color: #fff;
  background: var(--primary);
  border-color: var(--primary);
}

.parameter-homepage-status {
  display: grid;
  align-content: center;
  gap: 12px;
  min-height: 180px;
  padding: 22px;
  color: #fff;
  background: linear-gradient(145deg, #22304a, #172033);
  border-radius: 8px;
}

.homepage-entry-grid,
.homepage-metric-grid,
.homepage-main-grid,
.flow-health-grid {
  display: grid;
  gap: 16px;
  margin-top: 18px;
}

.homepage-entry-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.homepage-entry-card {
  display: grid;
  gap: 8px;
  min-height: 178px;
  padding: 18px;
  text-align: left;
  cursor: pointer;
}

.homepage-entry-card strong,
.homepage-metric-card strong {
  font-size: 28px;
  color: var(--primary);
}

.homepage-metric-grid,
.flow-health-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.homepage-metric-card,
.homepage-panel {
  padding: 18px;
}

.homepage-main-grid {
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
  align-items: start;
}

.homepage-main-grid.lower {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.homepage-panel-title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.homepage-panel-title div,
.hotspot-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.homepage-panel-title h2 {
  margin: 0;
  font-size: 18px;
}

.hotspot-list,
.key-change-list,
.hotspot-breakdown {
  display: grid;
  gap: 10px;
}

.hotspot-card,
.key-change-row {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-soft);
}

.hotspot-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 14px;
}

.hotspot-card h3,
.hotspot-card p {
  margin: 4px 0 0;
}

.hotspot-card > strong {
  font-size: 26px;
  color: var(--primary);
}

.hotspot-actions {
  grid-column: 1 / -1;
}

.key-change-row {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr) minmax(160px, auto) 110px;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 12px;
  text-align: left;
}

.key-change-row em {
  justify-self: end;
  color: var(--primary);
  font-style: normal;
}

.breakdown-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
}

@media (max-width: 980px) {
  .parameter-homepage-hero,
  .homepage-main-grid,
  .homepage-main-grid.lower {
    grid-template-columns: 1fr;
  }

  .homepage-entry-grid,
  .homepage-metric-grid,
  .flow-health-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .parameter-homepage {
    padding: 18px 14px 36px;
  }

  .homepage-entry-grid,
  .homepage-metric-grid,
  .flow-health-grid {
    grid-template-columns: 1fr;
  }

  .hotspot-card,
  .key-change-row {
    grid-template-columns: 1fr;
  }

  .key-change-row em {
    justify-self: start;
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- src/ParameterManagementHomePage.test.tsx src/App.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit styling**

```bash
git add src/styles.css src/ParameterManagementHomePage.test.tsx
git commit -m "style: polish parameter homepage layout"
```

---

### Task 5: Final Verification

**Files:**
- Verify: entire project

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript project build and Vite production build complete successfully.

- [ ] **Step 3: Start the local dev server**

Run:

```bash
npm run dev
```

Expected: Vite starts on `http://127.0.0.1:5173/` or the next available port.

- [ ] **Step 4: Browser QA**

Open `/` and verify:

- The first viewport reads as “参数运营中枢”.
- Entry cards for 参数工作台, 参数对比分析, 参数审阅队列, 参数管理后台 are visible.
- The application dashboard shows 参数总量, 共享参数定义, 修改频次, 关键风险参数.
- AI 综合变更热区榜 is visible and can expand scoring details.
- Key parameter changes are visible below the hotspot area.
- Time-window switching updates the displayed time label.
- Clicking a hotspot goes to `/parameters` or `/parameter-review` with query string context.

Open `/parameters`, `/parameter-comparison`, `/parameter-review`, and `/parameter-admin` and verify the existing workbench shell still renders.

- [ ] **Step 5: Commit any verification-only test fixes**

If verification reveals test expectation fixes only, commit them with:

```bash
git add src/App.test.tsx src/ParameterManagementHomePage.test.tsx
git commit -m "test: verify parameter homepage flows"
```

If no files changed during verification, skip this commit.
