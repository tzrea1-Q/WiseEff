# Parameter Home Production Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design spec (Chinese):** [2026-07-07-parameter-home-production-redesign-design.md](../../zh-CN/superpowers/specs/2026-07-07-parameter-home-production-redesign-design.md) (approved)

**Goal:** Lift `/parameter-home` to production standard — real backend aggregation data (trend, risk, hotspots, workbench signals), server-side explainable hotspot scoring, a new frontend dashboard data layer with partitioned async states, and a role-adaptive command-center redesign using Recharts.

**Architecture:** New `server/modules/parameters/dashboard/` sub-module exposes two aggregation endpoints (`summary`, `hotspots`) computed with SQL over `parameter_history_entries`, `parameter_change_requests`, `parameter_definitions`, `project_parameter_values`, and governance tables. A dedicated `ParameterDashboardRepository` port with HTTP + mock adapters feeds a `parameterDashboardRuntime` that dispatches into a partitioned dashboard state slice (each section: `idle|loading|ready|empty|error`). A new `src/features/parameter-home/` component tree renders the situation strip, role-adaptive workbench, and Recharts-based insight section, replacing the synthetic-data `ParameterManagementHomePage`.

**Tech Stack:** PostgreSQL aggregation SQL, Node/TypeScript server modules, Zod schemas, React 19 + Vite, Recharts, shadcn/ui + Tailwind v4, Vitest, Playwright acceptance.

---

## Git & PR Workflow

| Item | Value |
| --- | --- |
| Base branch | `main` |
| Feature branch | `feat/parameter-home-production-redesign` |
| Subagent | Implement + commit on feature branch only |
| Parent agent | Review, open PR, merge, sync `main` |

Branch is created once from latest `main` before Task 1. One plan → one branch.

---

## Shared Contracts (referenced by all tasks)

These types are defined in Task 1 and reused verbatim by later tasks. Do not rename fields between tasks.

```ts
// src/domain/parameters/dashboardTypes.ts
export type DashboardWindow = "7d" | "30d" | "180d";
export type HotspotDimension = "overall" | "module" | "project" | "parameter";

export type DashboardKpis = {
  totalParameters: number;
  managedProjects: number;
  changeFrequency: number;      // change + workflow events within window
  activeContributors: number;   // distinct changed_by users within window
  highRiskParameters: number;
};

export type TrendPoint = {
  bucketStart: string;          // ISO timestamp of bucket start
  label: string;                // "7/1" (day) or "第3周" (week)
  changeCount: number;          // parameter_history_entries in bucket
  workflowEventCount: number;   // parameter_change_requests created in bucket
};

export type ProjectRiskBucket = {
  projectId: string;
  projectCode: string;
  projectName: string;
  high: number;
  medium: number;
  low: number;
  total: number;
};

export type WorkbenchSignals = {
  reviewQueue: number;            // open change requests reviewable by role
  myDrafts: number;               // caller's drafts
  returnedChanges: number;        // caller's rejected/returned change requests
  waitingMerge: number;           // change requests in software_merge
  unappliedImportBatches: number; // import batches with applied_at IS NULL
  inactiveAccounts: number;       // org users with is_active = false
};

export type DashboardSummary = {
  window: DashboardWindow;
  windowLabel: string;            // "近 30 天"
  projectId: string | null;       // null = all projects in org
  kpis: DashboardKpis;
  trend: TrendPoint[];
  riskBuckets: ProjectRiskBucket[];
  workbenchSignals: WorkbenchSignals;
};

export type HotspotScoreBreakdown = {
  frequency: number;
  risk: number;
  impact: number;
  workflow: number;
  drift: number;
};

export type DashboardHotspot = {
  id: string;                     // `${kind}:${groupId}`
  kind: "module" | "project" | "parameter";
  title: string;
  projectId?: string;
  projectCode: string;
  module: string;
  statusLabel: string;            // "需要关注" | "偏高" | "正常"
  statusLevel: "watch" | "elevated" | "normal";
  score: number;                  // sum of scoreBreakdown, rounded to 0.1
  scoreBreakdown: HotspotScoreBreakdown;
  evidence: string[];
  trendDelta: number;             // integer percent vs previous equal window
  trendDirection: "up" | "down" | "flat";
  lastChangedAt?: string;
  suggestedPath: string;          // deep link with context query
};
```

```ts
// src/application/ports/ParameterDashboardRepository.ts
import type {
  DashboardHotspot,
  DashboardSummary,
  DashboardWindow,
  HotspotDimension
} from "@/domain/parameters/dashboardTypes";

export interface ParameterDashboardRepository {
  listDashboardSummary(input: { projectId?: string; window: DashboardWindow }): Promise<DashboardSummary>;
  listDashboardHotspots(input: {
    projectId?: string;
    window: DashboardWindow;
    dimension: HotspotDimension;
  }): Promise<DashboardHotspot[]>;
}
```

**Endpoints (envelope conventions `{ item }` / `{ items }`):**

- `GET /api/v1/parameters/dashboard/summary?projectId=&window=` → `{ item: DashboardSummaryDto }`, permission `parameter:view`
- `GET /api/v1/parameters/dashboard/hotspots?projectId=&window=&dimension=` → `{ items: DashboardHotspotDto[] }`, permission `parameter:view`

**Scoring (server, deterministic — no random):** reuse the existing five-dimension formula from `parameterHomepageAnalytics.ts` but compute inputs from real SQL aggregates. Fixed per-window weight profiles (from `timeWindowProfiles`, random removed). `score = frequency + risk + impact + workflow + drift`, rounded to 0.1. Risk weights: High=3, Medium=2, Low=1.

**Trend buckets:** `7d`/`30d` → `date_trunc('day', changed_at)`; `180d` → `date_trunc('week', changed_at)`. `changeCount` from `parameter_history_entries`; `workflowEventCount` from `parameter_change_requests.created_at`. Buckets with no data are zero-filled across the whole window.

**Risk distribution:** `COUNT(*) GROUP BY project, parameter_definitions.risk` — no scaling, no jitter.

---

## File Map (high level)

| Area | Primary files |
| --- | --- |
| Shared types | `src/domain/parameters/dashboardTypes.ts` |
| Port | `src/application/ports/ParameterDashboardRepository.ts` |
| Backend module | `server/modules/parameters/dashboard/{repository,scoring,service,schemas,routes,policy}.ts` + `*.test.ts` |
| Backend wiring | `server/modules/parameters/index.ts` or app route registration, `server/app.ts` |
| Contracts | `server/modules/contracts/routeManifest.ts`, `schemaRegistry.ts`, `docs/generated/openapi.json` |
| HTTP adapter | `src/infrastructure/http/parameterDashboardClient.ts`, `parameterDashboardDtos.ts` + tests |
| Mock adapter | `src/infrastructure/mock/mockParameterDashboardRepository.ts` + tests |
| Runtime + state | `src/application/parameters/parameterDashboardRuntime.ts`, dashboard state slice in `src/App.tsx` reducer + tests |
| Feature UI | `src/features/parameter-home/*` (container + sections + charts + state primitives) + `*.css` + tests |
| Route wiring | `src/app/routes.tsx`, `src/appConfig.ts` |
| Removed | `src/ParameterManagementHomePage.tsx`, synthetic parts of `src/parameterHomepageAnalytics.ts`, old `.parameter-homepage*` styles in `src/styles.css` |
| Docs | `docs/FRONTEND.md`, `docs/design-docs/api-contract.md`, `docs/generated/openapi.json` |
| E2E | `e2e/acceptance/*`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` |

---

# Phase 0 — Foundation

## Task 1: Dependency, shared types, and port interface

**Files:**
- Modify: `package.json` (add `recharts`)
- Create: `src/domain/parameters/dashboardTypes.ts`
- Create: `src/application/ports/ParameterDashboardRepository.ts`
- Create: `src/domain/parameters/dashboardTypes.test.ts`

- [ ] **Step 1: Add Recharts**

```bash
npm install recharts@^2.15.0
```

Expected: `recharts` appears under `dependencies` in `package.json`; lockfile updated.

- [ ] **Step 2: Create shared view-model types**

Create `src/domain/parameters/dashboardTypes.ts` with the exact contents from the "Shared Contracts" section above (all exported types through `DashboardHotspot`).

- [ ] **Step 3: Create the port interface**

Create `src/application/ports/ParameterDashboardRepository.ts` with the exact `ParameterDashboardRepository` interface from "Shared Contracts".

- [ ] **Step 4: Write a compile-time contract test**

```ts
// src/domain/parameters/dashboardTypes.test.ts
import { describe, expect, it } from "vitest";
import type { DashboardSummary, DashboardHotspot } from "./dashboardTypes";

describe("dashboard types", () => {
  it("summary carries all sections", () => {
    const summary: DashboardSummary = {
      window: "30d",
      windowLabel: "近 30 天",
      projectId: null,
      kpis: { totalParameters: 0, managedProjects: 0, changeFrequency: 0, activeContributors: 0, highRiskParameters: 0 },
      trend: [],
      riskBuckets: [],
      workbenchSignals: { reviewQueue: 0, myDrafts: 0, returnedChanges: 0, waitingMerge: 0, unappliedImportBatches: 0, inactiveAccounts: 0 }
    };
    expect(summary.window).toBe("30d");
  });

  it("hotspot carries score breakdown", () => {
    const hotspot: DashboardHotspot = {
      id: "project:aurora",
      kind: "project",
      title: "AUR-Prod",
      projectCode: "AUR-Prod",
      module: "项目参数",
      statusLabel: "需要关注",
      statusLevel: "watch",
      score: 100,
      scoreBreakdown: { frequency: 20, risk: 20, impact: 20, workflow: 20, drift: 20 },
      evidence: [],
      trendDelta: 0,
      trendDirection: "flat",
      suggestedPath: "/parameters?project=aurora"
    };
    expect(hotspot.scoreBreakdown.frequency).toBe(20);
  });
});
```

- [ ] **Step 5: Run test**

Run: `npm test -- src/domain/parameters/dashboardTypes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/domain/parameters/dashboardTypes.ts src/application/ports/ParameterDashboardRepository.ts src/domain/parameters/dashboardTypes.test.ts
git commit -m "feat(parameter-home): add recharts, dashboard view-model types, and repository port"
```

---

# Phase 1 — Backend Aggregation API

## Task 2: Dashboard repository — summary aggregation SQL

**Files:**
- Create: `server/modules/parameters/dashboard/repository.ts`
- Create: `server/modules/parameters/dashboard/repository.test.ts`

The repository exposes pure DB functions returning plain aggregates; the service (Task 4) assembles the `DashboardSummary`. Organization id is always passed by the caller from auth; `projectId` is optional.

- [ ] **Step 1: Write failing repository test**

```ts
// server/modules/parameters/dashboard/repository.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { createInMemoryTestDatabase } from "../../../testing/testDatabase"; // follow existing repository.test.ts import
import { seedParameterDashboardFixture } from "../../../testing/parameterDashboardFixture"; // created in Step 2
import {
  countKpis,
  aggregateTrend,
  aggregateRiskDistribution,
  aggregateWorkbenchSignals
} from "./repository";

describe("dashboard repository", () => {
  let db;
  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedParameterDashboardFixture(db);
  });

  it("counts KPIs scoped to org and window", async () => {
    const kpis = await countKpis(db, { organizationId: "org-chargelab", projectId: null, windowStart: "2026-06-07T00:00:00Z" });
    expect(kpis.totalParameters).toBeGreaterThan(0);
    expect(kpis.managedProjects).toBeGreaterThan(0);
    expect(kpis.highRiskParameters).toBeGreaterThanOrEqual(1);
  });

  it("aggregates trend into zero-filled day buckets", async () => {
    const points = await aggregateTrend(db, {
      organizationId: "org-chargelab", projectId: null,
      windowStart: "2026-06-07T00:00:00Z", windowEnd: "2026-07-07T00:00:00Z", granularity: "day"
    });
    expect(points.length).toBe(30);
    expect(points.every((p) => typeof p.changeCount === "number")).toBe(true);
  });

  it("aggregates risk distribution by project without scaling", async () => {
    const buckets = await aggregateRiskDistribution(db, { organizationId: "org-chargelab", projectId: null });
    const aurora = buckets.find((b) => b.projectId === "aurora");
    expect(aurora).toBeDefined();
    expect(aurora.high + aurora.medium + aurora.low).toBe(aurora.total);
  });

  it("aggregates workbench signals", async () => {
    const signals = await aggregateWorkbenchSignals(db, {
      organizationId: "org-chargelab", userId: "u-xu-yun", projectId: null
    });
    expect(signals.reviewQueue).toBeGreaterThanOrEqual(0);
    expect(signals.inactiveAccounts).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Add a shared test fixture seeder**

Create `server/testing/parameterDashboardFixture.ts` that inserts one org, 3 projects, parameter definitions across risk levels, `project_parameter_values`, dated `parameter_history_entries` (spread across the last 30 days), a few `parameter_change_requests` (mixed statuses incl. `rejected`, `software_merge`), one unapplied `parameter_import_batches`, and one inactive user. Reuse column shapes from `0002_m1_parameters.sql`.

- [ ] **Step 3: Run test to confirm it fails**

Run: `npm run test:server -- server/modules/parameters/dashboard/repository.test.ts`
Expected: FAIL with "countKpis is not a function" / module not found.

- [ ] **Step 4: Implement repository**

```ts
// server/modules/parameters/dashboard/repository.ts
import type { Database } from "../../../shared/database/client";

type OrgScope = { organizationId: string; projectId: string | null };

export async function countKpis(
  db: Database,
  input: OrgScope & { windowStart: string }
) {
  const params = [input.organizationId, input.windowStart, input.projectId];
  const projectFilter = input.projectId ? "and ppv.project_id = $3" : "";
  const rows = await db.query(
    `
    select
      (select count(*) from project_parameter_values ppv
         join projects p on p.id = ppv.project_id
        where p.organization_id = $1 ${projectFilter}) as total_parameters,
      (select count(*) from projects p where p.organization_id = $1
        ${input.projectId ? "and p.id = $3" : ""}) as managed_projects,
      (select count(*) from parameter_history_entries h
        where h.organization_id = $1 and h.changed_at >= $2
        ${input.projectId ? "and h.project_id = $3" : ""}) as change_frequency,
      (select count(distinct h.changed_by_user_id) from parameter_history_entries h
        where h.organization_id = $1 and h.changed_at >= $2
        ${input.projectId ? "and h.project_id = $3" : ""}) as active_contributors,
      (select count(*) from project_parameter_values ppv
         join projects p on p.id = ppv.project_id
         join parameter_definitions d on d.id = ppv.parameter_definition_id
        where p.organization_id = $1 and d.risk = 'High' ${projectFilter}) as high_risk_parameters
    `,
    input.projectId ? params : [input.organizationId, input.windowStart]
  );
  const r = rows[0];
  return {
    totalParameters: Number(r.total_parameters),
    managedProjects: Number(r.managed_projects),
    changeFrequency: Number(r.change_frequency),
    activeContributors: Number(r.active_contributors),
    highRiskParameters: Number(r.high_risk_parameters)
  };
}

export async function aggregateTrend(
  db: Database,
  input: OrgScope & { windowStart: string; windowEnd: string; granularity: "day" | "week" }
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  const trunc = input.granularity === "week" ? "week" : "day";
  const step = input.granularity === "week" ? "1 week" : "1 day";
  const projectFilter = input.projectId ? "and t.project_id = $4" : "";
  const args = input.projectId
    ? [input.windowStart, input.windowEnd, input.organizationId, input.projectId]
    : [input.windowStart, input.windowEnd, input.organizationId];
  const rows = await db.query(
    `
    with buckets as (
      select generate_series(date_trunc('${trunc}', $1::timestamptz),
                             date_trunc('${trunc}', $2::timestamptz),
                             interval '${step}') as bucket_start
    ),
    changes as (
      select date_trunc('${trunc}', t.changed_at) as bucket_start, count(*) as c
        from parameter_history_entries t
       where t.organization_id = $3 and t.changed_at >= $1 and t.changed_at < $2 ${projectFilter}
       group by 1
    ),
    workflow as (
      select date_trunc('${trunc}', t.created_at) as bucket_start, count(*) as c
        from parameter_change_requests t
       where t.organization_id = $3 and t.created_at >= $1 and t.created_at < $2 ${projectFilter}
       group by 1
    )
    select b.bucket_start,
           coalesce(changes.c, 0) as change_count,
           coalesce(workflow.c, 0) as workflow_event_count
      from buckets b
      left join changes on changes.bucket_start = b.bucket_start
      left join workflow on workflow.bucket_start = b.bucket_start
     order by b.bucket_start asc
    `,
    args
  );
  return rows.map((r) => ({
    bucketStart: new Date(r.bucket_start).toISOString(),
    changeCount: Number(r.change_count),
    workflowEventCount: Number(r.workflow_event_count)
  }));
}

export async function aggregateRiskDistribution(
  db: Database,
  input: OrgScope
): Promise<Array<{ projectId: string; projectCode: string; projectName: string; high: number; medium: number; low: number; total: number }>> {
  const projectFilter = input.projectId ? "and p.id = $2" : "";
  const args = input.projectId ? [input.organizationId, input.projectId] : [input.organizationId];
  const rows = await db.query(
    `
    select p.id as project_id, p.code as project_code, p.name as project_name,
           count(*) filter (where d.risk = 'High') as high,
           count(*) filter (where d.risk = 'Medium') as medium,
           count(*) filter (where d.risk = 'Low') as low
      from projects p
      join project_parameter_values ppv on ppv.project_id = p.id
      join parameter_definitions d on d.id = ppv.parameter_definition_id
     where p.organization_id = $1 ${projectFilter}
     group by p.id, p.code, p.name
     order by p.code asc
    `,
    args
  );
  return rows.map((r) => {
    const high = Number(r.high), medium = Number(r.medium), low = Number(r.low);
    return { projectId: r.project_id, projectCode: r.project_code, projectName: r.project_name, high, medium, low, total: high + medium + low };
  });
}

export async function aggregateWorkbenchSignals(
  db: Database,
  input: OrgScope & { userId: string }
) {
  const projectFilter = input.projectId ? "and cr.project_id = $3" : "";
  const args = input.projectId ? [input.organizationId, input.userId, input.projectId] : [input.organizationId, input.userId];
  const rows = await db.query(
    `
    select
      (select count(*) from parameter_change_requests cr
        where cr.organization_id = $1 and cr.status not in ('merged','rejected','withdrawn') ${projectFilter}) as review_queue,
      (select count(*) from parameter_drafts d
        where d.organization_id = $1 and d.user_id = $2 ${input.projectId ? "and d.project_id = $3" : ""}) as my_drafts,
      (select count(*) from parameter_change_requests cr
        where cr.organization_id = $1 and cr.submitter_user_id = $2 and cr.status = 'rejected' ${projectFilter}) as returned_changes,
      (select count(*) from parameter_change_requests cr
        where cr.organization_id = $1 and cr.status = 'software_merge' ${projectFilter}) as waiting_merge,
      (select count(*) from parameter_import_batches b
        where b.organization_id = $1 and b.applied_at is null ${input.projectId ? "and b.project_id = $3" : ""}) as unapplied_import_batches,
      (select count(*) from users u
        where u.organization_id = $1 and u.is_active = false) as inactive_accounts
    `,
    args
  );
  const r = rows[0];
  return {
    reviewQueue: Number(r.review_queue),
    myDrafts: Number(r.my_drafts),
    returnedChanges: Number(r.returned_changes),
    waitingMerge: Number(r.waiting_merge),
    unappliedImportBatches: Number(r.unapplied_import_batches),
    inactiveAccounts: Number(r.inactive_accounts)
  };
}
```

> Note: change-request status values stored in DB are the DTO forms (`submitted`, `hardware_review`, `software_review`, `software_merge`, `merged`, `rejected`, `withdrawn`) per `parameterClient.ts`. Confirm exact stored strings in `server/modules/parameters/status.ts` and adjust the `status` literals if they differ.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:server -- server/modules/parameters/dashboard/repository.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/modules/parameters/dashboard/repository.ts server/modules/parameters/dashboard/repository.test.ts server/testing/parameterDashboardFixture.ts
git commit -m "feat(parameter-home): dashboard summary aggregation repository"
```

---

## Task 3: Hotspot aggregation + deterministic scoring

**Files:**
- Create: `server/modules/parameters/dashboard/scoring.ts`
- Create: `server/modules/parameters/dashboard/hotspotRepository.ts`
- Create: `server/modules/parameters/dashboard/scoring.test.ts`
- Create: `server/modules/parameters/dashboard/hotspotRepository.test.ts`

- [ ] **Step 1: Write failing scoring test**

```ts
// server/modules/parameters/dashboard/scoring.test.ts
import { describe, expect, it } from "vitest";
import { scoreHotspotGroup, WINDOW_PROFILES } from "./scoring";

describe("hotspot scoring", () => {
  it("is deterministic and sums breakdown", () => {
    const input = {
      parameterCount: 4, relatedRequestCount: 3, definitionCount: 3,
      logSignalCount: 2, highRiskCount: 2, riskWeightSum: 12, driftSum: 96
    };
    const a = scoreHotspotGroup(input, WINDOW_PROFILES["30d"]);
    const b = scoreHotspotGroup(input, WINDOW_PROFILES["30d"]);
    expect(a).toEqual(b); // no randomness
    const total = a.frequency + a.risk + a.impact + a.workflow + a.drift;
    expect(a.score).toBeCloseTo(Math.round(total * 10) / 10);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npm run test:server -- server/modules/parameters/dashboard/scoring.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement scoring (port formula from `parameterHomepageAnalytics.ts`, remove randomness)**

```ts
// server/modules/parameters/dashboard/scoring.ts
import type { HotspotScoreBreakdown } from "../../../../src/domain/parameters/dashboardTypes";

export type WindowProfile = {
  requestWeight: number; parameterWeight: number; logWeight: number;
};

export const WINDOW_PROFILES: Record<"7d" | "30d" | "180d", WindowProfile> = {
  "7d": { requestWeight: 1.25, parameterWeight: 0.75, logWeight: 0.65 },
  "30d": { requestWeight: 1, parameterWeight: 1, logWeight: 1 },
  "180d": { requestWeight: 0.9, parameterWeight: 1.15, logWeight: 1.2 }
};

export type ScoreInput = {
  parameterCount: number;
  relatedRequestCount: number;
  definitionCount: number;
  logSignalCount: number;
  highRiskCount: number;
  riskWeightSum: number; // sum over params of {High:3,Medium:2,Low:1}
  driftSum: number;      // sum of |current-recommended|/baseline*100
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreHotspotGroup(input: ScoreInput, profile: WindowProfile): HotspotScoreBreakdown & { score: number } {
  const frequency = round1(input.parameterCount * 4 * profile.parameterWeight + input.relatedRequestCount * 10 * profile.requestWeight);
  const risk = input.riskWeightSum * 6;
  const impact = round1(input.definitionCount * 5 + input.logSignalCount * 8 * profile.logWeight);
  const workflow = round1(input.relatedRequestCount * 14 * profile.requestWeight + input.highRiskCount * 3);
  const drift = round1(input.driftSum);
  const score = round1(frequency + risk + impact + workflow + drift);
  return { frequency, risk, impact, workflow, drift, score };
}

export function mapStatus(highRiskCount: number, score: number): { label: string; level: "watch" | "elevated" | "normal" } {
  if (highRiskCount > 0 && score >= 200) return { label: "需要关注", level: "watch" };
  if (score >= 140) return { label: "偏高", level: "elevated" };
  return { label: "正常", level: "normal" };
}
```

- [ ] **Step 4: Run scoring test — PASS**

Run: `npm run test:server -- server/modules/parameters/dashboard/scoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing hotspot repository test**

```ts
// server/modules/parameters/dashboard/hotspotRepository.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { createInMemoryTestDatabase } from "../../../testing/testDatabase";
import { seedParameterDashboardFixture } from "../../../testing/parameterDashboardFixture";
import { aggregateHotspotGroups } from "./hotspotRepository";

describe("hotspot repository", () => {
  let db;
  beforeEach(async () => { db = await createInMemoryTestDatabase(); await seedParameterDashboardFixture(db); });

  it("aggregates project-dimension groups with real counts", async () => {
    const groups = await aggregateHotspotGroups(db, {
      organizationId: "org-chargelab", projectId: null, dimension: "project",
      windowStart: "2026-06-07T00:00:00Z", windowEnd: "2026-07-07T00:00:00Z"
    });
    expect(groups.length).toBeGreaterThan(0);
    const first = groups[0];
    expect(first).toHaveProperty("groupId");
    expect(first).toHaveProperty("riskWeightSum");
    expect(first).toHaveProperty("relatedRequestCount");
  });
});
```

- [ ] **Step 6: Implement `aggregateHotspotGroups`**

Implement SQL that, given `dimension`, groups by module / project.id / parameter_definition and returns per group: `groupId`, `title`, `projectId`, `projectCode`, `module`, `parameterCount`, `definitionCount`, `relatedRequestCount` (change requests in window joined by parameter), `highRiskCount`, `riskWeightSum` (`sum(case d.risk when 'High' then 3 when 'Medium' then 2 else 1 end)`), `driftSum` (`sum(abs(current-recommended)/greatest(abs(current),abs(recommended),1)*100)` with numeric cast guarded by `~ '^-?[0-9.]+$'`), `logSignalCount` (0 for now; logs are org-scoped post-0037, so set 0 and document), and `lastChangedAt` (`max(h.changed_at)`). For `overall`, run the three dimension queries and pick top-by-score with at least one of each kind (mirror `deriveOverallHotspots`).

- [ ] **Step 7: Run hotspot repository test — PASS**

Run: `npm run test:server -- server/modules/parameters/dashboard/hotspotRepository.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/modules/parameters/dashboard/scoring.ts server/modules/parameters/dashboard/scoring.test.ts server/modules/parameters/dashboard/hotspotRepository.ts server/modules/parameters/dashboard/hotspotRepository.test.ts
git commit -m "feat(parameter-home): server-side hotspot aggregation and deterministic scoring"
```

---

## Task 4: Dashboard service, schemas, routes, and app wiring

**Files:**
- Create: `server/modules/parameters/dashboard/service.ts`
- Create: `server/modules/parameters/dashboard/schemas.ts`
- Create: `server/modules/parameters/dashboard/routes.ts`
- Create: `server/modules/parameters/dashboard/service.test.ts`
- Create: `server/modules/parameters/dashboard/routes.test.ts`
- Modify: `server/modules/parameters/routes.ts` (or app registration) to also register dashboard routes
- Modify: `server/app.ts` / route wiring as needed

- [ ] **Step 1: Schemas (Zod) for query validation**

```ts
// server/modules/parameters/dashboard/schemas.ts
import { z } from "zod";
export const dashboardWindowSchema = z.enum(["7d", "30d", "180d"]);
export const hotspotDimensionSchema = z.enum(["overall", "module", "project", "parameter"]);
export const dashboardSummaryQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  window: dashboardWindowSchema.default("30d")
});
export const dashboardHotspotsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  window: dashboardWindowSchema.default("30d"),
  dimension: hotspotDimensionSchema.default("overall")
});
```

- [ ] **Step 2: Service assembles view-model**

`service.ts` exports `getDashboardSummary(db, { auth, projectId, window })` and `getDashboardHotspots(db, { auth, projectId, window, dimension })`. It computes `windowStart`/`windowEnd` from `window` relative to `now` (7d/30d days; 180d weeks), builds `windowLabel` (`近 7/30/180 天`), zero-fills trend labels (`M/D` for day, `第N周` for week), calls repository + scoring, maps groups to `DashboardHotspot` (including `trendDelta`/`trendDirection` from comparing current vs previous equal window change counts, `suggestedPath` per kind following `buildHotspotPath` logic). Org id comes from `auth.organization.id`; caller user id from `auth.user.id`.

- [ ] **Step 3: Write failing service test**

```ts
// server/modules/parameters/dashboard/service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { createInMemoryTestDatabase } from "../../../testing/testDatabase";
import { seedParameterDashboardFixture } from "../../../testing/parameterDashboardFixture";
import { getDashboardSummary, getDashboardHotspots } from "./service";

const auth = { organization: { id: "org-chargelab" }, user: { id: "u-xu-yun" } } as any;

describe("dashboard service", () => {
  let db;
  beforeEach(async () => { db = await createInMemoryTestDatabase(); await seedParameterDashboardFixture(db); });

  it("builds a full summary with zero-filled trend", async () => {
    const summary = await getDashboardSummary(db, { auth, window: "30d" });
    expect(summary.window).toBe("30d");
    expect(summary.windowLabel).toBe("近 30 天");
    expect(summary.trend).toHaveLength(30);
    expect(summary.riskBuckets.length).toBeGreaterThan(0);
  });

  it("returns ranked hotspots with explainable score", async () => {
    const hotspots = await getDashboardHotspots(db, { auth, window: "30d", dimension: "project" });
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0].score).toBeGreaterThanOrEqual(hotspots[hotspots.length - 1].score);
    expect(hotspots[0].scoreBreakdown).toHaveProperty("frequency");
  });
});
```

- [ ] **Step 4: Run service test — PASS after implementing service**

Run: `npm run test:server -- server/modules/parameters/dashboard/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Routes**

```ts
// server/modules/parameters/dashboard/routes.ts
import type { Database } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import type { WiseEffRouter } from "../../../shared/http/router";
import { canViewParameters } from "../policy";
import { dashboardSummaryQuerySchema, dashboardHotspotsQuerySchema } from "./schemas";
import { getDashboardSummary, getDashboardHotspots } from "./service";

export function registerParameterDashboardRoutes(router: WiseEffRouter, db: Database | undefined) {
  router.get("/api/v1/parameters/dashboard/summary", async (request) => {
    if (!canViewParameters(request.auth)) throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
    const query = dashboardSummaryQuerySchema.parse(request.query);
    const item = await getDashboardSummary(requireDb(db), { auth: request.auth, projectId: query.projectId, window: query.window });
    return { item };
  });
  router.get("/api/v1/parameters/dashboard/hotspots", async (request) => {
    if (!canViewParameters(request.auth)) throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
    const query = dashboardHotspotsQuerySchema.parse(request.query);
    const items = await getDashboardHotspots(requireDb(db), { auth: request.auth, projectId: query.projectId, window: query.window, dimension: query.dimension });
    return { items };
  });
}

function requireDb(db: Database | undefined): Database {
  if (!db) throw new ApiError("INTERNAL_ERROR", "Database adapter is required for dashboard routes.", 500);
  return db;
}
```

Match the exact `router.get` handler signature and `request.query` parsing used by `registerParameterRoutes` (it may use `parseWithSchema` and `request.auth`); adapt accordingly.

- [ ] **Step 6: Wire registration**

In the same place `registerParameterRoutes` is called (search `registerParameterRoutes` in `server/app.ts`), also call `registerParameterDashboardRoutes(router, db)`.

- [ ] **Step 7: Write failing routes test**

```ts
// server/modules/parameters/dashboard/routes.test.ts — follow existing routes.test.ts harness
// assert 200 + envelope for a viewer; 403 for a principal lacking parameter:view
```

Model it on `server/modules/parameters/routes.test.ts` (same app/test-request helpers). Cover: viewer gets `{ item }` for summary and `{ items }` for hotspots; a no-permission auth gets 403.

- [ ] **Step 8: Run all dashboard module tests — PASS**

Run: `npm run test:server -- server/modules/parameters/dashboard/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/modules/parameters/dashboard/ server/app.ts server/modules/parameters/routes.ts
git commit -m "feat(parameter-home): dashboard summary/hotspots service and routes"
```

---

## Task 5: OpenAPI contract entries

**Files:**
- Modify: `server/modules/contracts/routeManifest.ts`
- Modify: `server/modules/contracts/schemaRegistry.ts`
- Modify: `docs/generated/openapi.json` (regenerated)

- [ ] **Step 1: Add route manifest entries**

Add two entries mirroring existing parameter routes:

```ts
{ id: "parameters-dashboard-summary", method: "GET", path: "/api/v1/parameters/dashboard/summary" },
{ id: "parameters-dashboard-hotspots", method: "GET", path: "/api/v1/parameters/dashboard/hotspots" }
```

- [ ] **Step 2: Add schema registry entries**

```ts
"parameters-dashboard-summary": { summary: "Parameter dashboard summary", tags: ["parameters"], responseBody: "ParameterDashboardSummaryResponse" },
"parameters-dashboard-hotspots": { summary: "Parameter dashboard hotspots", tags: ["parameters"], responseBody: "ParameterDashboardHotspotsResponse" }
```

Follow the exact `schemaRegistry` entry shape already in the file.

- [ ] **Step 3: Regenerate and validate contract**

```bash
npm run contract:openapi
npm run contract:check
```

Expected: `docs/generated/openapi.json` updated; contract check PASS.

- [ ] **Step 4: Run contract module tests**

```bash
npm run test:server -- server/modules/contracts/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modules/contracts/ docs/generated/openapi.json
git commit -m "feat(parameter-home): register dashboard endpoints in OpenAPI contract"
```

---

# Phase 2 — Frontend Data Layer

## Task 6: HTTP adapter + DTO mappers

**Files:**
- Create: `src/infrastructure/http/parameterDashboardDtos.ts`
- Create: `src/infrastructure/http/parameterDashboardClient.ts`
- Create: `src/infrastructure/http/parameterDashboardClient.test.ts`

- [ ] **Step 1: DTO types + mappers**

Create `parameterDashboardDtos.ts` mirroring the domain types (the server returns them already in view-model shape, so DTOs equal domain types; mappers are identity-with-validation). Export `dashboardSummaryFromDto` and `dashboardHotspotFromDto` returning `DashboardSummary` / `DashboardHotspot`.

- [ ] **Step 2: Write failing client test**

```ts
// src/infrastructure/http/parameterDashboardClient.test.ts
import { describe, expect, it, vi } from "vitest";
import { createHttpParameterDashboardRepository } from "./parameterDashboardClient";

function stubClient(responses: Record<string, unknown>) {
  return { get: vi.fn(async (path: string) => responses[path]) } as any;
}

describe("http parameter dashboard repository", () => {
  it("requests summary with window + projectId query", async () => {
    const client = stubClient({
      "/api/v1/parameters/dashboard/summary?projectId=aurora&window=30d": {
        item: { window: "30d", windowLabel: "近 30 天", projectId: "aurora", kpis: { totalParameters: 1, managedProjects: 1, changeFrequency: 1, activeContributors: 1, highRiskParameters: 1 }, trend: [], riskBuckets: [], workbenchSignals: { reviewQueue: 0, myDrafts: 0, returnedChanges: 0, waitingMerge: 0, unappliedImportBatches: 0, inactiveAccounts: 0 } }
      }
    });
    const repo = createHttpParameterDashboardRepository(client);
    const summary = await repo.listDashboardSummary({ projectId: "aurora", window: "30d" });
    expect(summary.kpis.totalParameters).toBe(1);
    expect(client.get).toHaveBeenCalledWith("/api/v1/parameters/dashboard/summary?projectId=aurora&window=30d");
  });

  it("requests hotspots with dimension query", async () => {
    const client = stubClient({
      "/api/v1/parameters/dashboard/hotspots?window=30d&dimension=project": { items: [] }
    });
    const repo = createHttpParameterDashboardRepository(client);
    const items = await repo.listDashboardHotspots({ window: "30d", dimension: "project" });
    expect(items).toEqual([]);
    expect(client.get).toHaveBeenCalledWith("/api/v1/parameters/dashboard/hotspots?window=30d&dimension=project");
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `npm test -- src/infrastructure/http/parameterDashboardClient.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement HTTP adapter**

```ts
// src/infrastructure/http/parameterDashboardClient.ts
import type { ParameterDashboardRepository } from "@/application/ports/ParameterDashboardRepository";
import type { DashboardWindow, HotspotDimension } from "@/domain/parameters/dashboardTypes";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import { dashboardSummaryFromDto, dashboardHotspotFromDto, type DashboardSummaryDto, type DashboardHotspotDto } from "./parameterDashboardDtos";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemEnvelope<T> = { item: T };
type ItemsEnvelope<T> = { items: T[] };

function summaryPath(input: { projectId?: string; window: DashboardWindow }) {
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", input.projectId);
  params.set("window", input.window);
  return `/api/v1/parameters/dashboard/summary?${params.toString()}`;
}

function hotspotsPath(input: { projectId?: string; window: DashboardWindow; dimension: HotspotDimension }) {
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", input.projectId);
  params.set("window", input.window);
  params.set("dimension", input.dimension);
  return `/api/v1/parameters/dashboard/hotspots?${params.toString()}`;
}

export function createHttpParameterDashboardRepository(apiClient: ApiClient = createDefaultApiClient()): ParameterDashboardRepository {
  return {
    async listDashboardSummary(input) {
      const response = await apiClient.get<ItemEnvelope<DashboardSummaryDto>>(summaryPath(input));
      return dashboardSummaryFromDto(response.item);
    },
    async listDashboardHotspots(input) {
      const response = await apiClient.get<ItemsEnvelope<DashboardHotspotDto>>(hotspotsPath(input));
      return response.items.map(dashboardHotspotFromDto);
    }
  };
}
```

> URLSearchParams orders keys by insertion, so the test's expected order (`projectId`, then `window`, then `dimension`) matches. Keep insertion order consistent with the tests.

- [ ] **Step 5: Run client test — PASS**

Run: `npm test -- src/infrastructure/http/parameterDashboardClient.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/http/parameterDashboardDtos.ts src/infrastructure/http/parameterDashboardClient.ts src/infrastructure/http/parameterDashboardClient.test.ts
git commit -m "feat(parameter-home): http dashboard adapter and dto mappers"
```

---

## Task 7: Mock adapter (real derivation, no LCG/jitter) + parity test

**Files:**
- Create: `src/infrastructure/mock/mockParameterDashboardRepository.ts`
- Create: `src/infrastructure/mock/mockParameterDashboardRepository.test.ts`

The mock adapter derives the same view-model from `MockRuntimeState`, using **real** mock timestamps/counts. No LCG trend, no jitter.

- [ ] **Step 1: Write failing mock adapter test**

```ts
// src/infrastructure/mock/mockParameterDashboardRepository.test.ts
import { describe, expect, it } from "vitest";
import { createMockRuntimeState } from "./mockRuntimeState"; // follow existing mock repo test import
import { createMockParameterDashboardRepository } from "./mockParameterDashboardRepository";

describe("mock parameter dashboard repository", () => {
  it("derives summary from mock state without randomness", async () => {
    const state = createMockRuntimeState();
    const repo = createMockParameterDashboardRepository(() => state);
    const a = await repo.listDashboardSummary({ window: "30d" });
    const b = await repo.listDashboardSummary({ window: "30d" });
    expect(a).toEqual(b); // deterministic
    expect(a.kpis.totalParameters).toBe(state.parameters.length);
    expect(a.trend.length).toBe(30);
  });

  it("ranks hotspots deterministically", async () => {
    const state = createMockRuntimeState();
    const repo = createMockParameterDashboardRepository(() => state);
    const hotspots = await repo.listDashboardHotspots({ window: "30d", dimension: "project" });
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0].score).toBeGreaterThanOrEqual(hotspots[hotspots.length - 1].score);
  });
});
```

Match the actual mock-state accessor used by `mockParameterRepository.ts` (it likely takes a `getState` function or a `MockRuntimeState` instance). Follow that exact pattern.

- [ ] **Step 2: Run to confirm fail**

Run: `npm test -- src/infrastructure/mock/mockParameterDashboardRepository.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement mock adapter**

Compute from mock state:
- KPIs: `parameters.length`, distinct project count, change events = change requests + history-like events within window, distinct contributors, high-risk count.
- Trend: zero-filled 30/7 day (or 26 week) buckets counting mock change-request `createdAt` (and any mock history timestamps) per bucket — **derive from real mock timestamps**, drop `deriveUpdateTrendSeries` LCG.
- Risk buckets: real counts per project by risk (`deriveProjectRiskDistribution` minus jitter/scaling).
- Workbench signals: counts from mock change requests / drafts / users.
- Hotspots: reuse the group derivation shape (module/project/parameter) and `scoreHotspotGroup`-equivalent formula on the frontend mock side (import a shared pure scorer, see note below), returning identical `DashboardHotspot` shape.

> To avoid duplicating the scoring formula, extract the pure scorer into a shared frontend util `src/domain/parameters/hotspotScoring.ts` mirroring `server/.../scoring.ts` (same numbers), and unit-test that both produce equal output for the same input in Task 7 Step 4. This keeps mock/api parity.

- [ ] **Step 4: Add scorer parity assertion**

Add to the mock test a case asserting the shared frontend scorer returns the same breakdown as the documented formula for a fixed input (the same fixture used in `server/.../scoring.test.ts`).

- [ ] **Step 5: Run mock adapter test — PASS**

Run: `npm test -- src/infrastructure/mock/mockParameterDashboardRepository.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/mock/mockParameterDashboardRepository.ts src/infrastructure/mock/mockParameterDashboardRepository.test.ts src/domain/parameters/hotspotScoring.ts
git commit -m "feat(parameter-home): mock dashboard adapter with real derivation and shared scorer"
```

---

## Task 8: Dashboard runtime + partitioned state slice + app wiring

**Files:**
- Create: `src/application/parameters/parameterDashboardRuntime.ts`
- Create: `src/application/parameters/parameterDashboardRuntime.test.ts`
- Create: `src/application/parameters/dashboardState.ts` (reducer + types for the partitioned slice)
- Create: `src/application/parameters/dashboardState.test.ts`
- Modify: `src/App.tsx` (instantiate repository, actions, hold dashboard state, pass to page)

- [ ] **Step 1: Partitioned state model + reducer**

```ts
// src/application/parameters/dashboardState.ts
import type { DashboardSummary, DashboardHotspot, DashboardWindow, HotspotDimension } from "@/domain/parameters/dashboardTypes";

export type SectionStatus = "idle" | "loading" | "ready" | "empty" | "error";

export type DashboardState = {
  window: DashboardWindow;
  dimension: HotspotDimension;
  summary: { status: SectionStatus; data: DashboardSummary | null; error: string | null };
  hotspots: { status: SectionStatus; data: DashboardHotspot[]; error: string | null };
};

export const initialDashboardState: DashboardState = {
  window: "30d",
  dimension: "overall",
  summary: { status: "idle", data: null, error: null },
  hotspots: { status: "idle", data: [], error: null }
};

export type DashboardAction =
  | { type: "DASHBOARD_SET_WINDOW"; window: DashboardWindow }
  | { type: "DASHBOARD_SET_DIMENSION"; dimension: HotspotDimension }
  | { type: "DASHBOARD_SUMMARY_LOADING" }
  | { type: "DASHBOARD_SUMMARY_READY"; data: DashboardSummary }
  | { type: "DASHBOARD_SUMMARY_ERROR"; error: string }
  | { type: "DASHBOARD_HOTSPOTS_LOADING" }
  | { type: "DASHBOARD_HOTSPOTS_READY"; data: DashboardHotspot[] }
  | { type: "DASHBOARD_HOTSPOTS_ERROR"; error: string };

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "DASHBOARD_SET_WINDOW": return { ...state, window: action.window };
    case "DASHBOARD_SET_DIMENSION": return { ...state, dimension: action.dimension };
    case "DASHBOARD_SUMMARY_LOADING": return { ...state, summary: { ...state.summary, status: "loading", error: null } };
    case "DASHBOARD_SUMMARY_READY": {
      const empty = action.data.kpis.totalParameters === 0 && action.data.trend.every((p) => p.changeCount === 0);
      return { ...state, summary: { status: empty ? "empty" : "ready", data: action.data, error: null } };
    }
    case "DASHBOARD_SUMMARY_ERROR": return { ...state, summary: { ...state.summary, status: "error", error: action.error } };
    case "DASHBOARD_HOTSPOTS_LOADING": return { ...state, hotspots: { ...state.hotspots, status: "loading", error: null } };
    case "DASHBOARD_HOTSPOTS_READY": return { ...state, hotspots: { status: action.data.length === 0 ? "empty" : "ready", data: action.data, error: null } };
    case "DASHBOARD_HOTSPOTS_ERROR": return { ...state, hotspots: { ...state.hotspots, status: "error", error: action.error } };
    default: return state;
  }
}
```

- [ ] **Step 2: Reducer test**

```ts
// src/application/parameters/dashboardState.test.ts
import { describe, expect, it } from "vitest";
import { dashboardReducer, initialDashboardState } from "./dashboardState";

describe("dashboardReducer", () => {
  it("marks summary empty when no data", () => {
    const next = dashboardReducer(initialDashboardState, {
      type: "DASHBOARD_SUMMARY_READY",
      data: { window: "30d", windowLabel: "近 30 天", projectId: null, kpis: { totalParameters: 0, managedProjects: 0, changeFrequency: 0, activeContributors: 0, highRiskParameters: 0 }, trend: [], riskBuckets: [], workbenchSignals: { reviewQueue: 0, myDrafts: 0, returnedChanges: 0, waitingMerge: 0, unappliedImportBatches: 0, inactiveAccounts: 0 } }
    });
    expect(next.summary.status).toBe("empty");
  });
  it("captures summary errors without dropping stale data", () => {
    const next = dashboardReducer({ ...initialDashboardState, summary: { status: "ready", data: {} as any, error: null } }, { type: "DASHBOARD_SUMMARY_ERROR", error: "boom" });
    expect(next.summary.status).toBe("error");
    expect(next.summary.error).toBe("boom");
  });
});
```

- [ ] **Step 3: Runtime orchestration**

```ts
// src/application/parameters/parameterDashboardRuntime.ts
import type { ParameterDashboardRepository } from "@/application/ports/ParameterDashboardRepository";
import type { DashboardWindow, HotspotDimension } from "@/domain/parameters/dashboardTypes";
import type { DashboardAction } from "./dashboardState";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

export const dashboardFailureNotification = "参数看板数据加载失败，请稍后重试。";

type Options = {
  repository: ParameterDashboardRepository;
  dispatch: (action: DashboardAction) => void;
};

function formatError(error: unknown): string {
  if (error instanceof WiseEffApiError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) {
    return "当前账号无权查看参数看板，请重新登录或切换角色。";
  }
  return dashboardFailureNotification;
}

export function createParameterDashboardRuntime({ repository, dispatch }: Options) {
  return {
    async loadSummary(input: { projectId?: string; window: DashboardWindow }) {
      dispatch({ type: "DASHBOARD_SUMMARY_LOADING" });
      try {
        const data = await repository.listDashboardSummary(input);
        dispatch({ type: "DASHBOARD_SUMMARY_READY", data });
      } catch (error) {
        dispatch({ type: "DASHBOARD_SUMMARY_ERROR", error: formatError(error) });
      }
    },
    async loadHotspots(input: { projectId?: string; window: DashboardWindow; dimension: HotspotDimension }) {
      dispatch({ type: "DASHBOARD_HOTSPOTS_LOADING" });
      try {
        const data = await repository.listDashboardHotspots(input);
        dispatch({ type: "DASHBOARD_HOTSPOTS_READY", data });
      } catch (error) {
        dispatch({ type: "DASHBOARD_HOTSPOTS_ERROR", error: formatError(error) });
      }
    }
  };
}
```

- [ ] **Step 4: Runtime test with a stub repository**

```ts
// src/application/parameters/parameterDashboardRuntime.test.ts
import { describe, expect, it, vi } from "vitest";
import { createParameterDashboardRuntime } from "./parameterDashboardRuntime";

describe("parameterDashboardRuntime", () => {
  it("dispatches loading then ready for summary", async () => {
    const dispatch = vi.fn();
    const repository = { listDashboardSummary: vi.fn(async () => ({ window: "30d" } as any)), listDashboardHotspots: vi.fn() } as any;
    const runtime = createParameterDashboardRuntime({ repository, dispatch });
    await runtime.loadSummary({ window: "30d" });
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "DASHBOARD_SUMMARY_LOADING" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "DASHBOARD_SUMMARY_READY", data: { window: "30d" } });
  });

  it("dispatches error on failure", async () => {
    const dispatch = vi.fn();
    const repository = { listDashboardSummary: vi.fn(async () => { throw new Error("x"); }), listDashboardHotspots: vi.fn() } as any;
    const runtime = createParameterDashboardRuntime({ repository, dispatch });
    await runtime.loadSummary({ window: "30d" });
    expect(dispatch).toHaveBeenLastCalledWith({ type: "DASHBOARD_SUMMARY_ERROR", error: expect.any(String) });
  });
});
```

- [ ] **Step 5: Run runtime + reducer tests — PASS**

Run: `npm test -- src/application/parameters/parameterDashboardRuntime.test.ts src/application/parameters/dashboardState.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire into App.tsx**

Near the existing `parameterRepositoryClient` useMemo (~2178), add:

```ts
const dashboardRepository = useMemo(
  () => (runtimeMode === "api" ? createHttpParameterDashboardRepository() : createMockParameterDashboardRepository(() => mockRuntimeStateRef.current)),
  [runtimeMode]
);
const [dashboardState, dashboardDispatch] = useReducer(dashboardReducer, initialDashboardState);
const dashboardRuntime = useMemo(() => createParameterDashboardRuntime({ repository: dashboardRepository, dispatch: dashboardDispatch }), [dashboardRepository]);
```

Trigger `dashboardRuntime.loadSummary({ projectId, window })` on mount / project / window change, and `loadHotspots({ projectId, window, dimension })` on mount / dimension change, via `useEffect`. Pass `dashboardState`, `dashboardRuntime`, and setters (`DASHBOARD_SET_WINDOW`/`DASHBOARD_SET_DIMENSION`) down to the parameter-home route. Use the exact mock-state accessor pattern the file already uses for other mock repositories.

- [ ] **Step 7: Typecheck**

```bash
npx tsc -b
```

Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/application/parameters/parameterDashboardRuntime.ts src/application/parameters/parameterDashboardRuntime.test.ts src/application/parameters/dashboardState.ts src/application/parameters/dashboardState.test.ts src/App.tsx
git commit -m "feat(parameter-home): dashboard runtime, partitioned state slice, and app wiring"
```

---

# Phase 3 — Visual / Interaction Redesign

All new UI lives under `src/features/parameter-home/`. New components use Tailwind utilities + shadcn primitives; bespoke rules go in co-located `*.css` files, never `src/styles.css`.

## Task 9: Section state primitives, Panel, and design tokens

**Files:**
- Create: `src/features/parameter-home/components/Panel.tsx`
- Create: `src/features/parameter-home/components/SectionState.tsx` (`SectionSkeleton`, `SectionEmpty`, `SectionError`)
- Create: `src/features/parameter-home/parameter-home.css` (page-level tokens + panel styles)
- Create: `src/features/parameter-home/components/SectionState.test.tsx`

- [ ] **Step 1: Define tokens + Panel**

`parameter-home.css` defines CSS variables scoped to `.parameter-home` (panel radius/border/elevation, spacing rhythm, risk colors `--risk-high/medium/low`, score tones). `Panel.tsx` renders a titled card (`<section>` with heading slot + children + optional actions slot).

- [ ] **Step 2: Write failing SectionState test**

```tsx
// src/features/parameter-home/components/SectionState.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SectionError, SectionEmpty, SectionSkeleton } from "./SectionState";

describe("SectionState", () => {
  it("skeleton exposes busy status", () => {
    render(<SectionSkeleton label="加载趋势" />);
    expect(screen.getByRole("status")).toHaveTextContent("加载趋势");
  });
  it("empty shows guidance", () => {
    render(<SectionEmpty message="暂无数据" />);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });
  it("error triggers retry", () => {
    const onRetry = vi.fn();
    render(<SectionError message="加载失败" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Implement primitives**

`SectionSkeleton` renders `role="status" aria-live="polite"` with shimmer placeholders and the label (visually hidden text ok). `SectionEmpty` renders message + optional CTA. `SectionError` renders message + a `重试` button calling `onRetry`.

- [ ] **Step 4: Run test — PASS**

Run: `npm test -- src/features/parameter-home/components/SectionState.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/parameter-home/components/Panel.tsx src/features/parameter-home/components/SectionState.tsx src/features/parameter-home/components/SectionState.test.tsx src/features/parameter-home/parameter-home.css
git commit -m "feat(parameter-home): panel primitive, section state components, and design tokens"
```

---

## Task 10: Recharts trend and risk charts

**Files:**
- Create: `src/features/parameter-home/components/UpdateTrendChart.tsx`
- Create: `src/features/parameter-home/components/ProjectRiskChart.tsx`
- Create: `src/features/parameter-home/components/charts.test.tsx`

- [ ] **Step 1: Write failing chart tests (data + a11y, not pixels)**

```tsx
// src/features/parameter-home/components/charts.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpdateTrendChart } from "./UpdateTrendChart";
import { ProjectRiskChart } from "./ProjectRiskChart";

describe("charts", () => {
  it("trend chart renders an accessible data table fallback", () => {
    render(<UpdateTrendChart points={[{ bucketStart: "2026-07-01T00:00:00Z", label: "7/1", changeCount: 3, workflowEventCount: 1 }]} />);
    expect(screen.getByRole("img", { name: /参数更新趋势/ })).toBeInTheDocument();
    expect(screen.getByText("7/1")).toBeInTheDocument();
  });
  it("risk chart labels risk levels", () => {
    render(<ProjectRiskChart buckets={[{ projectId: "aurora", projectCode: "AUR-Prod", projectName: "Aurora", high: 2, medium: 3, low: 1, total: 6 }]} />);
    expect(screen.getByRole("img", { name: /各项目参数更新情况|风险分布/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement charts with Recharts + a11y wrapper**

Each chart wraps the Recharts `ResponsiveContainer` in a `<figure role="img" aria-label="...">` and includes a visually-hidden `<table>` mirroring the data (so tests and screen readers get labels/values without relying on SVG internals). `UpdateTrendChart` = `LineChart`/`AreaChart` over `label`→`changeCount`. `ProjectRiskChart` = stacked `BarChart` with three `Bar`s using `--risk-high/medium/low` colors.

> Recharts renders width 0 in jsdom; render the chart inside a fixed-size wrapper and rely on the hidden table for assertions. Do not assert on SVG paths.

- [ ] **Step 3: Run chart tests — PASS**

Run: `npm test -- src/features/parameter-home/components/charts.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/parameter-home/components/UpdateTrendChart.tsx src/features/parameter-home/components/ProjectRiskChart.tsx src/features/parameter-home/components/charts.test.tsx
git commit -m "feat(parameter-home): recharts trend and stacked risk charts with a11y fallback"
```

---

## Task 11: Situation strip + analysis-context controls

**Files:**
- Create: `src/features/parameter-home/components/SituationStrip.tsx`
- Create: `src/features/parameter-home/components/AnalysisContextControls.tsx`
- Create: `src/features/parameter-home/components/SituationStrip.test.tsx`
- Create: `src/features/parameter-home/components/AnalysisContextControls.test.tsx`

- [ ] **Step 1: SituationStrip test**

```tsx
// SituationStrip.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SituationStrip } from "./SituationStrip";

describe("SituationStrip", () => {
  it("renders KPIs when ready", () => {
    render(<SituationStrip status="ready" kpis={{ totalParameters: 51, managedProjects: 3, changeFrequency: 19, activeContributors: 5, highRiskParameters: 12 }} />);
    expect(screen.getByText("51")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
  it("shows skeleton while loading", () => {
    render(<SituationStrip status="loading" kpis={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: AnalysisContextControls test**

```tsx
// AnalysisContextControls.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnalysisContextControls } from "./AnalysisContextControls";

describe("AnalysisContextControls", () => {
  it("emits window + dimension changes", () => {
    const onWindow = vi.fn(); const onDimension = vi.fn();
    render(<AnalysisContextControls window="30d" dimension="overall" onWindowChange={onWindow} onDimensionChange={onDimension} />);
    fireEvent.click(screen.getByRole("radio", { name: "模块榜" }));
    expect(onDimension).toHaveBeenCalledWith("module");
  });
});
```

- [ ] **Step 3: Implement both**

`SituationStrip` renders 5 KPI tiles inside a `Panel`; `status==="loading"`→`SectionSkeleton`, `error`→`SectionError`. `AnalysisContextControls` renders a window selector (7d/30d/180d) and the hotspot dimension `ToggleGroup` (总/模块/项目/参数), calling callbacks that dispatch `DASHBOARD_SET_WINDOW` / `DASHBOARD_SET_DIMENSION`.

- [ ] **Step 4: Run tests — PASS**

Run: `npm test -- src/features/parameter-home/components/SituationStrip.test.tsx src/features/parameter-home/components/AnalysisContextControls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/parameter-home/components/SituationStrip.tsx src/features/parameter-home/components/AnalysisContextControls.tsx src/features/parameter-home/components/SituationStrip.test.tsx src/features/parameter-home/components/AnalysisContextControls.test.tsx
git commit -m "feat(parameter-home): situation strip and unified analysis-context controls"
```

---

## Task 12: Role-adaptive workbench primary + workbench view-model refactor

**Files:**
- Create: `src/features/parameter-home/workbench/derivePersonalWorkbench.ts` (refactor from `src/parameterPersonalWorkbench.ts` to consume `WorkbenchSignals`)
- Create: `src/features/parameter-home/workbench/derivePersonalWorkbench.test.ts`
- Create: `src/features/parameter-home/components/WorkbenchPrimary.tsx`
- Create: `src/features/parameter-home/components/WorkbenchPrimary.test.tsx`

- [ ] **Step 1: Refactor view-model to take real signals**

New `derivePersonalWorkbench({ roleId, signals, changeRequests, drafts, projects, hotspots })` returns `{ roleView, nextActions, scenarioEntries, emphasis }` where `emphasis` is `"action-first"` for User/Committer and `"insight-first"` for Admin/Guest. Todo counts come from `WorkbenchSignals` (real backend), not mock-only state fields. Keep permission filtering of actions/entries via `canAccessPage`.

- [ ] **Step 2: Write failing view-model test**

```ts
// derivePersonalWorkbench.test.ts
import { describe, expect, it } from "vitest";
import { derivePersonalWorkbench } from "./derivePersonalWorkbench";

const signals = { reviewQueue: 4, myDrafts: 2, returnedChanges: 1, waitingMerge: 3, unappliedImportBatches: 1, inactiveAccounts: 1 };

describe("derivePersonalWorkbench", () => {
  it("committer sees review-queue action first, insight second", () => {
    const vm = derivePersonalWorkbench({ roleId: "hardware-committer", signals, changeRequests: [], drafts: [], projects: [], hotspots: [] });
    expect(vm.emphasis).toBe("action-first");
    expect(vm.nextActions[0].title).toMatch(/审阅/);
  });
  it("admin emphasis is insight-first and has no beginner governance entry", () => {
    const vm = derivePersonalWorkbench({ roleId: "admin", signals, changeRequests: [], drafts: [], projects: [], hotspots: [] });
    expect(vm.emphasis).toBe("insight-first");
    expect(vm.scenarioEntries.some((e) => /我要治理/.test(e.title))).toBe(false);
  });
  it("guest gets read-only entries only", () => {
    const vm = derivePersonalWorkbench({ roleId: "guest", signals, changeRequests: [], drafts: [], projects: [], hotspots: [] });
    expect(vm.nextActions.every((a) => a.kind !== "todo")).toBe(true);
  });
});
```

- [ ] **Step 3: Implement view-model; run test — PASS**

Run: `npm test -- src/features/parameter-home/workbench/derivePersonalWorkbench.test.ts`
Expected: PASS.

- [ ] **Step 4: WorkbenchPrimary component + test**

`WorkbenchPrimary` renders `NextActionQueue` + `ScenarioEntries` and orders them per `emphasis`. Test asserts action queue present, entries permission-filtered, and navigation callbacks fire with context paths. Model DOM structure on the current `PersonalWorkbenchHero` but role-adaptive.

- [ ] **Step 5: Run WorkbenchPrimary test — PASS**

Run: `npm test -- src/features/parameter-home/components/WorkbenchPrimary.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/parameter-home/workbench/ src/features/parameter-home/components/WorkbenchPrimary.tsx src/features/parameter-home/components/WorkbenchPrimary.test.tsx
git commit -m "feat(parameter-home): role-adaptive workbench primary from real signals"
```

---

## Task 13: Hotspot leaderboard + score panel + insight section

**Files:**
- Create: `src/features/parameter-home/components/HotspotLeaderboard.tsx`
- Create: `src/features/parameter-home/components/HotspotScorePanel.tsx`
- Create: `src/features/parameter-home/components/InsightSection.tsx`
- Create: `src/features/parameter-home/components/HotspotLeaderboard.test.tsx`
- Create: `src/features/parameter-home/components/InsightSection.test.tsx`

- [ ] **Step 1: Port leaderboard from `ParameterManagementHomePage`**

Reuse the existing keyboard-nav + accordion behavior, but consume `DashboardHotspot[]` from state (no in-component scoring). Rename the panel heading from "AI 评分拆解" to "热度评分构成"; keep evidence list, dimension bars (`progressbar`), and recommended actions (permission-filtered via `canAccessPage`).

- [ ] **Step 2: Leaderboard test (keyboard nav + rename + a11y)**

```tsx
// HotspotLeaderboard.test.tsx — assert:
// - renders rows for provided hotspots
// - ArrowDown moves focus (preserve existing behavior)
// - detail panel heading is "热度评分构成 · <title>" (NOT "AI 评分拆解")
// - dimension bars expose role=progressbar with aria-valuenow
```

- [ ] **Step 3: InsightSection assembly + emphasis test**

`InsightSection` composes `UpdateTrendChart`, `ProjectRiskChart`, `AnalysisContextControls`, and `HotspotLeaderboard`, each guarded by its section status. It is default-expanded for `insight-first` and collapsed-first for `action-first` (progressive disclosure). Test asserts: collapsed by default for a User role prop; expanded for Admin; each sub-section renders its skeleton/empty/error per status.

- [ ] **Step 4: Run tests — PASS**

Run: `npm test -- src/features/parameter-home/components/HotspotLeaderboard.test.tsx src/features/parameter-home/components/InsightSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/parameter-home/components/HotspotLeaderboard.tsx src/features/parameter-home/components/HotspotScorePanel.tsx src/features/parameter-home/components/InsightSection.tsx src/features/parameter-home/components/HotspotLeaderboard.test.tsx src/features/parameter-home/components/InsightSection.test.tsx
git commit -m "feat(parameter-home): hotspot leaderboard, explainable score panel, insight section"
```

---

## Task 14: Assemble container, route wiring, remove old page

**Files:**
- Create: `src/features/parameter-home/ParameterHomePage.tsx`
- Create: `src/features/parameter-home/ParameterHomePage.test.tsx`
- Modify: `src/app/routes.tsx` (render new page)
- Modify: `src/appConfig.ts` (labels/subtitle if changed)
- Delete: `src/ParameterManagementHomePage.tsx`

- [ ] **Step 1: Build container**

`ParameterHomePage` receives `state` (for role + hydrated change requests/drafts/projects), `dashboardState`, `dashboardRuntime`, window/dimension setters, and `onNavigate`/`onNewProject`. It renders: `SituationStrip` (from `dashboardState.summary`), `WorkbenchPrimary` (from `derivePersonalWorkbench` fed by `summary.workbenchSignals` + hydrated state), and `InsightSection` (trend/risk from summary; hotspots from `dashboardState.hotspots`). Order + emphasis follow the role's `emphasis`.

- [ ] **Step 2: Container test (role variants × section states)**

```tsx
// ParameterHomePage.test.tsx — assert:
// - User role: workbench renders first (action-first), insight collapsed
// - Admin role: situation + insight prominent (insight-first)
// - summary.status==="loading" → situation skeleton; "error" → SectionError with retry that calls runtime.loadSummary
// - hotspots.status==="error" → hotspot SectionError independent of summary
// - Guest: no review/admin actions
```

Use a stubbed `dashboardRuntime` (`vi.fn()` loaders) and hand-built `dashboardState` variants.

- [ ] **Step 3: Route wiring**

In `src/app/routes.tsx`, replace the `case "parameter-home"` block to render `<ParameterHomePage .../>` with the new props (dashboard state/runtime + setters). Remove import of `ParameterManagementHomePage`.

- [ ] **Step 4: Delete old page**

```bash
git rm src/ParameterManagementHomePage.tsx
```

Move the still-needed `HotspotLeaderboard` consumers (e.g. `components/hotspots/HotspotLeaderboard.test.tsx`) to import from the new location, or keep a thin re-export if other pages import it (grep first).

- [ ] **Step 5: Run container + route tests + typecheck**

Run: `npm test -- src/features/parameter-home/ParameterHomePage.test.tsx src/app` then `npx tsc -b`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/parameter-home/ParameterHomePage.tsx src/features/parameter-home/ParameterHomePage.test.tsx src/app/routes.tsx src/appConfig.ts
git rm src/ParameterManagementHomePage.tsx
git commit -m "feat(parameter-home): assemble adaptive command-center page and wire route"
```

---

# Phase 4 — Cleanup, Docs, Verification

## Task 15: Remove synthetic analytics and obsolete tests; migrate CSS

**Files:**
- Modify/Delete: `src/parameterHomepageAnalytics.ts` (remove `deriveUpdateTrendSeries` LCG, `deriveProjectRiskDistribution` jitter, and any now-unused derivations)
- Modify: `src/parameterHomepageAnalytics.test.ts`
- Delete: `src/parameterPersonalWorkbench.ts` + `.test.ts` if fully superseded by the new view-model (grep for other importers first)
- Modify: `src/styles.css` (remove `.parameter-homepage*`, `.personal-workbench*`, `.hotspot-*` blocks now owned by `parameter-home.css`)
- Modify: `src/App.test.tsx` (parameter-home shortcut assertions), any CSS-contract tests referencing removed classes

- [ ] **Step 1: Grep for importers before deleting**

```bash
rg "parameterHomepageAnalytics|parameterPersonalWorkbench|deriveUpdateTrendSeries|deriveProjectRiskDistribution" src
```

Only remove symbols with no remaining importers; keep any still used by other pages.

- [ ] **Step 2: Remove synthetic functions + their tests**

Delete `deriveUpdateTrendSeries`, `deriveProjectRiskDistribution`, `lcg`, `projectSeedFromId`, `TREND_*`, `RISK_*` and the tests asserting synthetic output.

- [ ] **Step 3: Remove old CSS blocks**

Delete the `.parameter-homepage*` / `.personal-workbench*` / `.hotspot-*` rule blocks from `src/styles.css` (now provided by `parameter-home.css`).

- [ ] **Step 4: Fix regression tests**

Update `src/App.test.tsx` and any tests asserting removed classes / old headings so they reflect the new structure.

- [ ] **Step 5: Full frontend test + build**

```bash
npm test
npx tsc -b
npm run build
```

Expected: all PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/parameterHomepageAnalytics.ts src/parameterHomepageAnalytics.test.ts src/styles.css src/App.test.tsx
git commit -m "refactor(parameter-home): remove synthetic analytics and migrate styles off global stylesheet"
```

---

## Task 16: Docs, acceptance coverage, and final verification gate

**Files:**
- Modify: `docs/FRONTEND.md` (+ Chinese companion `docs/zh-CN/...` if the pair exists)
- Modify: `docs/design-docs/api-contract.md`
- Modify: `docs/zh-CN/superpowers/specs/2026-07-07-parameter-home-production-redesign-design.md` (status → Implemented)
- Modify: `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`
- Modify/Create: `e2e/acceptance/*` spec covering parameter-home real-data path

- [ ] **Step 1: Update FRONTEND.md**

Document the new `src/features/parameter-home/` tree, the `ParameterDashboardRepository` seam, partitioned dashboard state, and unified analysis-context controls (window in-page, TopBar keeps project selector).

- [ ] **Step 2: Update API contract doc**

Add the two dashboard endpoints (permission, query params, response shape) to `docs/design-docs/api-contract.md`.

- [ ] **Step 3: Acceptance coverage**

Add/adjust a requirement ID in `browser-acceptance-coverage-map.md` and operation ID(s) in `user-operation-coverage-matrix.md` for: viewing parameter-home real dashboard data, switching time window, switching hotspot dimension, and role-adaptive workbench. Add or extend an `e2e/acceptance/` spec that logs in per role and asserts the situation strip, charts, and hotspots render from API data.

- [ ] **Step 4: Browser verification (AGENTS.md mandatory)**

With `npm run dev:all` running, use `playwright-cli` for each affected role at viewports `1440x900`, `768x1024`, `390x844`:

```bash
playwright-cli -s=param-home open http://127.0.0.1:5173/parameter-home
playwright-cli -s=param-home resize 1440 900
playwright-cli -s=param-home snapshot
playwright-cli -s=param-home screenshot --filename=work/ui-checks/param-home-desktop.png
playwright-cli -s=param-home console error
```

Verify: no overlap/overflow, charts render with real data, loading→ready transitions, empty/error states, hotspot keyboard nav, no console errors, network calls hit the two dashboard endpoints.

- [ ] **Step 5: Run docs governance + full gates**

```bash
npm run docs:check
npm run test:all
npm run build
npm run contract:check
```

Expected: all PASS.

- [ ] **Step 6: Mark spec implemented + commit**

```bash
git add docs/ e2e/ work/ui-checks/
git commit -m "docs+test(parameter-home): contract, frontend, and acceptance coverage for redesign"
```

---

## Documentation Impact Matrix

| Document | Action | Task |
| --- | --- | --- |
| `docs/design-docs/api-contract.md` | Update — add dashboard endpoints | 16 |
| `docs/FRONTEND.md` | Update — feature tree + dashboard seam | 16 |
| `docs/generated/openapi.json` | Regenerate | 5 |
| `docs/zh-CN/superpowers/specs/2026-07-07-parameter-home-production-redesign-design.md` | Update — status → Implemented | 16 |
| `docs/developer/browser-acceptance-coverage-map.md` | Update — new requirement id | 16 |
| `docs/developer/user-operation-coverage-matrix.md` | Update — new operation id | 16 |
| `docs/design-docs/2026-05-24-parameter-personal-workbench-design.md` | Review — mark evolved-by-this-plan | 16 |
| `docs/design-docs/2026-05-07-parameter-management-homepage-design.md` | Review — historical | 16 |
| `docs/zh-CN/FRONTEND` companion (if paired) | Update — mirror FRONTEND.md change | 16 |
| `ARCHITECTURE.md` | No change | — |
| `AGENTS.md` | No change | — |
| `docs/product-specs/product-spec.md` | Review — confirm no per-page contradiction | 16 |

## Documentation Update Gate

Plan cannot move to `completed/` until:

- [ ] Every **Update** row is edited or explicitly deferred in `docs/exec-plans/tech-debt-tracker.md` with reason
- [ ] Every **Review** row is confirmed unchanged (with evidence) or updated
- [ ] `npm run docs:check` passes
- [ ] Bilingual FRONTEND pair (if present) stays linked

## UI Interaction Automation Rule

| Changed behavior | Spec / requirement |
| --- | --- |
| Parameter-home renders real dashboard data (KPIs, trend, risk, hotspots) | New requirement id in `browser-acceptance-coverage-map.md`; e2e in `e2e/acceptance/` (Task 16) |
| In-page time-window control (moved off TopBar for this page) | Operation id in `user-operation-coverage-matrix.md` (Task 16) |
| Hotspot dimension switch refetches hotspots | Same acceptance spec (Task 16) |
| Role-adaptive workbench emphasis + permission-filtered entries | Assert per-role in acceptance spec (Task 16) |
| Section loading/empty/error states with retry | Component tests (Tasks 9,14) + browser check (Task 16 Step 4) |

Operation evidence is preserved via `npm run acceptance:browser` / `npm run acceptance:evidence` for any automated operation id added.

---

## Spec self-review (plan vs design)

| Spec requirement | Task |
| --- | --- |
| New backend dashboard aggregation API (summary + hotspots) | 2, 3, 4 |
| Real trend time-series (no LCG) | 2 (aggregateTrend), 15 (remove LCG) |
| Real risk distribution (no jitter) | 2 (aggregateRiskDistribution), 15 |
| Server-side explainable scoring (not "AI") | 3 (scoring), 13 (rename to 热度评分构成) |
| Real workbench signals (not mock residue) | 2 (aggregateWorkbenchSignals), 12 |
| Dedicated `ParameterDashboardRepository` port | 1 |
| HTTP + mock adapters, parity | 6, 7 |
| Partitioned async section states | 8 (dashboardState), 9, 14 |
| Recharts charts | 1 (dep), 10 |
| Role-adaptive command-center IA | 11, 12, 13, 14 |
| Unified analysis-context controls (window in-page) | 11, 14 |
| CSS off styles.css monolith | 9, 15 |
| Component decomposition (feature folder) | 9–14 |
| A11y (keyboard nav, progressbar, aria-live, chart fallback) | 9, 10, 13 |
| Responsive 1440/768/390 | 16 (browser verification) |
| OpenAPI contract + tests | 5 |
| Docs (FRONTEND, api-contract) + governance | 16 |
| Four roles production-grade | 12, 13, 14, 16 |
| Remove old page + obsolete tests | 14, 15 |

No placeholder gaps identified. Types/signatures (`DashboardSummary`, `DashboardHotspot`, `ParameterDashboardRepository`, `dashboardReducer`, `createParameterDashboardRuntime`) are consistent across Tasks 1–14.

---

## Execution handoff

Plan saved to `docs/exec-plans/active/2026-07-07-parameter-home-production-redesign.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — one subagent per task (1–16), two-stage review between tasks, fast iteration
2. **Inline Execution** — implement tasks sequentially in this session with checkpoints

Which approach do you want?
