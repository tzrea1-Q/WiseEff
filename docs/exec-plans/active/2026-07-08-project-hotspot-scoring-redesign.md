# Project Hotspot Scoring Redesign

> **Status:** In progress  
> **Scope:** Project, module, and parameter leaderboards (`dimension=project|module|parameter`). All three use the shared four-dimension behavioral scorer; parameter scope counts **projects** that modified the definition, not parameter instances.

**Goal:** Replace static-inventory scoring (risk, definition count, recommended drift) with behavioral governance scoring for all hotspot dimensions.

**Design rationale:** Projects share roughly the same parameter library; ranking should reflect change activity, modification breadth, workflow pressure, and collaboration—not risk labels or recommended-value drift.

---

## Git & PR Workflow

| Item | Value |
| --- | --- |
| Base branch | `main` |
| Feature branch | `feat/project-hotspot-scoring-redesign` |

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
| `src/domain/parameters/dashboardTypes.ts` | `usesBehavioralHotspotScoring` includes `parameter` |
| `server/modules/parameters/dashboard/hotspotRepository.ts` | Behavioral SQL for project, module, parameter |
| `server/modules/parameters/dashboard/service.ts` | Behavioral mapping for all kinds |
| `src/features/parameter-home/components/HotspotScorePanel.tsx` | Parameter scope label「项目修改范围」 |
| `src/infrastructure/mock/mockParameterDashboardRepository.ts` | Cross-project parameter grouping + project scope |
| Tests under `server/modules/parameters/dashboard/` and `src/features/parameter-home/` | Updated expectations |

Legacy five-dimension scorer retained in `scoring.ts` for reference; no hotspot dimension uses it after this plan.

---

## Verification

```bash
npm run test:server -- --run server/modules/parameters/dashboard/
npm run test -- --run src/domain/parameters/ src/features/parameter-home/components/HotspotScorePanel.test.tsx src/infrastructure/mock/mockParameterDashboardRepository.test.ts
npm run build
```

---

## Documentation Impact Matrix

| Doc | Action |
| --- | --- |
| `docs/design-docs/api-contract.md` | Review — hotspot breakdown shape differs by `kind` |
| `docs/zh-CN/design-docs/api-contract.md` | Review — same |
| Other docs | No change (behavioral scoring now covers all hotspot dimensions) |

## Documentation Update Gate

- [ ] API contract review row resolved before plan completion

---

## Follow-up (tech debt)

- Remove legacy five-dimension scorer (`scoring.ts`) when no callers remain
