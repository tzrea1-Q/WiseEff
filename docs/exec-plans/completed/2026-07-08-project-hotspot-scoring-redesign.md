# Project Hotspot Scoring Redesign

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md)
>
> **Status:** Completed on 2026-08-23 in `codex/wave4-hotspot-contract-closeout`; parent PR/merge makes this a `main` fact.

> **Scope:** Project, module, and parameter leaderboards (`dimension=project|module|parameter`). All three use the shared four-dimension behavioral scorer; parameter scope counts **projects** that modified the definition, not parameter instances.

**Goal:** Replace static-inventory scoring (risk, definition count, recommended drift) with behavioral governance scoring for all hotspot dimensions.

**Design rationale:** Projects share roughly the same parameter library; ranking should reflect change activity, modification breadth, workflow pressure, and collaboration—not risk labels or recommended-value drift.

---

## Git & PR Workflow

| Item | Value |
| --- | --- |
| Base branch | `main` |
| Closeout branch | `codex/wave4-hotspot-contract-closeout` |

---

## Scoring Model (All Behavioral Dimensions)

### Removed from score

- Risk weight / high-risk parameter count
- Parameter definition count
- Recommended-value drift (`driftSum`)

### Four dimensions

| Dimension | Key | Formula (30d baseline) |
| --- | --- | --- |
| 窗口变更频次 | `frequency` | `historyEventsInWindow × 3 + changeRequestsInWindow × 10 × requestWeight` |
| 累计修改范围 / 项目修改范围 | `scope` | `modifiedParamCount × 2 + modificationRate × 100 × 4` |
| 流程压力 | `workflow` | `changeRequestsInWindow × 8 × requestWeight + openRequestCount × 5 + returnedInWindow × 12` |
| 协作广度 | `collaboration` | `contributorsInWindow × 15 + contributorsAllTime × 3` |

`modificationRate = modifiedParamCount / max(totalParamCount, 1)`

For **project** and **module**, scope counts modified **parameter instances** vs total instances. For **parameter**, scope counts **projects** that modified the definition vs total projects that have the definition.

**Total:** `score = round1(frequency + scope + workflow + collaboration)`

### Window weights

Same profiles as legacy scorer:

| Window | requestWeight |
| --- | --- |
| 7d | 1.25 |
| 30d | 1.00 |
| 180d | 0.90 |

(`parameterWeight` / `logWeight` unused in project scorer.)

### Modified parameter definition

A parameter counts as **modified** when its `project_parameter_value` has at least one history row with `version > 1` (excludes initial import/bootstrap).

### Status labels

| Label | Condition |
| --- | --- |
| 需要关注 | `score ≥ 180` **or** `openRequestCount ≥ 10` **or** `modificationRate ≥ 0.15` |
| 偏高 | `score ≥ 100` **or** `changeRequestsInWindow ≥ 5` |
| 正常 | otherwise |

### Trend

Compare **total score** between current window and the previous equal-length window (not change-request count alone).

### Evidence strings

**Project / module:**

1. `累计修改 {modified} / {total} 个参数（{pct}%）`
2. `窗口内 {historyEvents} 次参数变更`
3. `待处理流程 {open} 项 · 窗口内 {requests} 项请求`

**Parameter:**

1. `已在 {modified} / {total} 个项目中修改（{pct}%）`
2. `窗口内 {historyEvents} 次参数变更`
3. `待处理流程 {open} 项 · 窗口内 {requests} 项请求`

---

## SQL Aggregates (project dimension)

Per `projects.id`:

| Field | Source |
| --- | --- |
| `totalParamCount` | `count(distinct ppv.id)` |
| `modifiedParamCount` | distinct `d.id` where `exists history version > 1` for ppv |
| `historyEventsInWindow` | history rows with `changed_at` in `[windowStart, windowEnd)` |
| `changeRequestsInWindow` | distinct CR created in window |
| `openRequestCount` | CR with status in `submitted`, `hardware_review`, `software_review`, `software_merge` |
| `returnedInWindow` | CR with `status = rejected` and `updated_at` in window |
| `contributorsInWindow` | distinct `changed_by_user_id` in window history |
| `contributorsAllTime` | distinct `changed_by_user_id` in all project history |
| `lastChangedAt` | `max(h.changed_at)` |

---

## SQL Aggregates (parameter dimension)

Per `parameter_definitions.id` (grouped across all projects):

| Field | Source |
| --- | --- |
| `totalParamCount` | `count(distinct ppv.project_id)` — projects that have this definition |
| `modifiedParamCount` | distinct `ppv.project_id` where `exists history version > 1` for that ppv |
| Other behavioral fields | Same window/open/return/contributor logic scoped to the definition across projects |

Suggested path: `/parameters?parameter={definitionId}` (no single `projectId` on the row).

---

## Files

| File | Change |
| --- | --- |
| `src/domain/parameters/projectHotspotScoring.ts` | Shared pure scorer + kind-aware evidence |
| `src/domain/parameters/dashboardTypes.ts` | One exact four-dimension `HotspotScoreBreakdown` public type |
| `server/modules/parameters/dashboard/hotspotRepository.ts` | Behavioral SQL for project, module, parameter |
| `server/modules/parameters/dashboard/service.ts` | Behavioral mapping for all kinds |
| `src/features/parameter-home/components/HotspotScorePanel.tsx` | Parameter scope label「项目修改范围」 |
| `src/infrastructure/mock/mockParameterDashboardRepository.ts` | Cross-project parameter grouping + project scope |
| Tests under `server/modules/parameters/dashboard/` and `src/features/parameter-home/` | Updated expectations |

The Wave 4 closeout removed the unreachable five-dimension server scorer, legacy DTO union, presentation branch, and test-only legacy scorer. Current project, module, and parameter rows all expose the same four-dimension behavioral contract. The final API-mode browser gate also found and fixed one independent mobile obstruction: on Parameter Home at `390x844`, the fixed Xiaoze launcher covered the final hotspot row. At widths up to 640px on this route, the launcher now follows the page content instead of covering the leaderboard.

---

## Verification

```bash
npm run test:server -- --run server/modules/parameters/dashboard/
npm run test -- --run src/domain/parameters/ src/features/parameter-home/components/HotspotScorePanel.test.tsx src/infrastructure/mock/mockParameterDashboardRepository.test.ts
npm run contract:check
npx tsc -b
npm run build
npm run docs:check

# Fresh API-mode runtime, production HMAC, deterministic Xiaoze
npx playwright test --config playwright.acceptance.config.ts \
  --project='Desktop Chrome' e2e/acceptance/parameter-home.acceptance.spec.ts
npm run acceptance:evidence -- --run <focused-run-dir> --require PARAM-HOME-001
```

In the restricted local sandbox, the standard `tsx` CLI entry can fail while
creating its IPC socket with `EPERM`. The equivalent
`node --import tsx scripts/<gate>.ts` entry generated and checked the same
OpenAPI and documentation artifacts; parent/CI should still run the standard
npm scripts in an unrestricted environment.

---

## Documentation Impact Matrix

| Category | Status | Exact file / evidence |
| --- | --- | --- |
| API contract | Update | `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`, `docs/generated/openapi.json`, `server/modules/contracts/dtoSchemas/parameters.ts`, and `server/modules/contracts/dtoSchemas/catalog.ts` |
| Plan | Update | This English plan moved to `docs/exec-plans/completed/`; its Chinese companion was added under `docs/zh-CN/exec-plans/completed/`; `docs/PLANS.md` and `docs/zh-CN/PLANS.md` now reference the completed path |
| Product specification | Review | `docs/product-specs/product-spec.md` and `docs/zh-CN/product-specs/product-spec.md` do not define hotspot dimension keys or formulas; unchanged |
| Architecture / domain | Review | `CONTEXT.md`, `ARCHITECTURE.md`, and `docs/design-docs/full-stack-architecture.md` need no update because the module seam and route did not move |
| Quality / testing | Review | Existing verification matrix and testing strategy are unchanged; new OpenAPI, DTO, focused server/frontend tests, and `e2e/acceptance/parameter-home.acceptance.spec.ts` use existing gates |
| Reliability / security | No change | No runtime mode, write path, permission, audit, queue, or operations behavior changed |
| Frontend / design | Update | `docs/design-docs/2026-07-07-parameter-home-production-redesign-design.md` and `docs/zh-CN/design-docs/2026-07-07-parameter-home-production-redesign-design.md` record the four-dimension successor, the mobile Xiaoze-launcher safe-flow rule, and link to each other; `scripts/bilingual-docs.ts` makes the pair required. `HotspotScorePanel` drops an unreachable legacy branch while the mobile browser fix prevents the launcher from covering the last leaderboard row |
| Generated artifacts | Update | `docs/generated/openapi.json` publishes the concrete four-dimension response structure |
| References | No change | No current reference document defines this DTO |

## Documentation Update Gate

- [x] API contract review row resolved in EN/ZH and generated OpenAPI.
- [x] All valid hotspot kinds are pinned to the four-dimension public DTO/service seam.
- [x] Unreachable legacy scorer/projection/presentation code is removed.
- [x] Parameter Home design history, bilingual governance, and both PLANS indexes point to the current contract and completed archive.
- [x] Fresh API-mode `PARAM-HOME-001` evidence passes with production HMAC, deterministic Xiaoze, an owned PostgreSQL database, and the evidence validator.
- [x] `playwright-cli` snapshots/screenshots at `1440x900`, `768x1024`, and `390x844` show the first hotspot expanded, 0 console errors, dashboard APIs returning 2xx, and no horizontal overflow; the mobile launcher obstruction found during the gate is covered by the focused acceptance test.
- [x] Focused server/frontend/contract tests, typecheck, build, docs governance, and diff checks pass before parent handoff.

---

## Completion evidence

- The initial contract RED proved `ParameterDashboardHotspotsResponse` was an opaque OpenAPI object with no `items` or `scoreBreakdown` properties.
- `server/modules/contracts/dtoSchemas/parameters.ts` now realizes the response and rejects the retired `risk` / `impact` / `drift` shape.
- `DashboardHotspot.scoreBreakdown` has one behavioral type, and `getDashboardHotspots` maps every schema-valid kind directly through the behavioral scorer.
- Existing score formulas, ranking, status labels, evidence, and route remain unchanged. The closeout is contract alignment and dead-code removal, not another scoring redesign; its only interaction change is the bounded mobile launcher placement fix found by the final browser gate.
- The owned acceptance runtime used PostgreSQL on `127.0.0.1:55494`, API on `127.0.0.1:8794`, and Vite API mode on `127.0.0.1:5194`, with a run marker and local object-store namespace. `PARAM-HOME-001` and its evidence validator passed; local evidence is under `work/ui-checks/wave4-hotspot/`.
- Parent-owned tracker, Wave 4 plan, PR, CI, merge, and merged-main evidence remain outside this implementation branch.
