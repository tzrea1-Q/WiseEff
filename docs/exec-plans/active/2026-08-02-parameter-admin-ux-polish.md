# Parameter admin UX polish

> Status: **Active** — Batches 1–3 implemented on `feat/parameter-admin-ux-polish`; awaiting parent review / PR
> Date: 2026-08-02
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-02-parameter-admin-ux-polish.md`](../../zh-CN/exec-plans/active/2026-08-02-parameter-admin-ux-polish.md)
> Information architecture: [ADR-0001](../../adr/0001-parameter-admin-organized-by-governance-scope.md)
> Table filter convention: [`docs/design-docs/ux-table-column-filter.md`](../../design-docs/ux-table-column-filter.md)
> Prior redesign (merged): [`docs/exec-plans/completed/2026-07-25-parameter-admin-redesign.md`](../completed/2026-07-25-parameter-admin-redesign.md)

> **2026-08-06 product direction:** the project-list and defect fixes in this plan remain valid, but the four-view/dialog presentation is no longer the target information architecture. The locked [project configuration workbench design](../../design-docs/2026-08-06-project-configuration-workbench-design.md) replaces it with one full-screen config-set/source-centered workspace. Do not treat Batches 2–3 as the future project-operations presentation contract.

## Context

The governance-scope information architecture from ADR-0001 has landed: organization and project areas are peers, project work is deep-linkable, and admin state lives in `ParameterAdminProvider`. A 2026-08-02 walkthrough of all six views as Admin (`xu.yun`, API mode) at 1440×900 / 768×1024 / 390×844 found no console errors but did find one hard mobile layout failure, a column filter attached to the wrong column, a broken overlay on the structure browser, and four different visual languages across the four project tabs.

This plan records those findings and sequences the repair. It does not reopen the ADR-0001 architecture.

## Goal

1. **Batch 1 (defects)** — fix the mobile table breakage, the misplaced column filter, the structure-browser overlay, and the ARIA/consistency gaps that make the surface unreliable.
2. **Batch 2 (visual language)** — give the four project tabs one container/grouping language, one empty-state pattern, and a real hierarchy between the two navigation levels.
3. **Batch 3 (information architecture)** — remove the four-fold title repetition, put governance signals on the project list, and fix the parameter-files page ordering.

## Non-goals

- Reopening the governance-scope IA (organization vs project peers) from ADR-0001.
- Parameter-governance deferred D1–D8 and attribution deferred D-AG-* (owned by their own plans).
- The batch import wizard backlog (`2026-07-06-parameter-batch-import-wizard.md`).
- Audit center M2/M3 (`2026-06-17-audit-center-design.md`).
- TD-042 topology cutover rehearsal.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/parameter-admin-ux-polish`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `feat/parameter-admin-ux-polish`. Batches 2 and 3 may be resequenced onto follow-up branches from `main` after Batch 1 merges.

## Findings

### Batch 1 — defects with direct evidence

| ID | Finding | Location |
| --- | --- | --- |
| PA-D1 | Project list desktop column rules are not wrapped in a media query, so `white-space: nowrap` and `td:last-child { width: 80px }` leak into the shared ≤960px card layout. The status badge is clipped, and the 模块 / 最近更新 / 操作 values do not render. | `src/styles.css` §`.project-admin-library-grid` (from line 14421) versus the card rules at line 11614 |
| PA-D2 | The 归属模块 column filter sits on the 参数定义 header while the attribution content renders in the next column (驱动模块), which has no filter. This contradicts the funnel-next-to-its-column rule. | `src/components/parameter-topology/ParameterSpecLibrary.tsx:458-471` |
| PA-D3 | Structure browser has a layered rendering fault: the subtitle is covered by a white overlay, the right-hand detail card overlaps the left node list, and the card's `u32-array · <…>` metadata is near-invisible. | `src/components/parameters/DtsStructureBrowserPanel.tsx` and its styles |
| PA-D4 | Project views declare `role="tablist"` / `role="tab"` with no `role="tabpanel"` and no `aria-controls`. These controls are route navigations, and the organization sub-nav next to them uses `role="navigation"` with buttons — two patterns for the same job. | `src/components/parameter-admin-next/ProjectsOperationsPanel.tsx:352-365` |
| PA-D5 | The spec library `<table>` has no accessible name while `ProjectAdminTable` has 项目管理列表. | `src/components/parameter-topology/ParameterSpecLibrary.tsx:446` |
| PA-D6 | The 待审核 counter reuses `.parameters-table-toolbar` to hold a single number and carries an inline `style` in a codebase that otherwise uses CSS classes. | `src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:555-560` |
| PA-D7 | `title` / `subtitle` / `regionLabel` are three nested ternaries over the same view enum that already has a `PROJECT_VIEW_LABELS` lookup table. | `src/components/parameter-admin-next/ProjectsOperationsPanel.tsx:305-330` |
| PA-D8 | A fabricated fallback state is cast with `as PrototypeState`, hiding the optionality in the props contract. | `src/ParameterAdminNextPage.tsx:153` |

### Batch 2 — visual language

| ID | Finding |
| --- | --- |
| PA-V1 | The four project tabs use four visual languages: files is card-based, config-sets is bare labels and inputs with no grouping container, structure is two-column, conflicts is unwrapped text. |
| PA-V2 | Empty states are unfinished: identity-mapping is two lines of text inside a 280px blank card, conflicts has no card at all, and neither offers a next action. |
| PA-V3 | The scope pills (组织配置 / 项目运营) and the sub-nav pills (参数定义库 / 定义匹配审核 / 模块归属 / 节点对应确认) have near-identical visual weight, so the containment relationship is not readable. |
| PA-V4 | At 768×1024 the TopBar 批量参数导入 button wraps to a second line and inflates the header, and the 审核状态 column header is squeezed onto two lines, which misaligns its funnel. |

### Batch 3 — information architecture

| ID | Finding |
| --- | --- |
| PA-A1 | Entering project operations shows 项目运营 three times (TopBar subtitle, scope pill, `<h2>`) before 项目清单. |
| PA-A2 | The project list carries module count, parameter count, and last-updated only. It answers "how big is this project" but not "which project needs me". Pending review, file conflicts, and baseline state are absent even though `adminState.queueCounts.fileConflicts` is already tracked. |
| PA-A3 | The parameter-files page puts 结构化检索 above 参数文件 although search presupposes an uploaded file, and it overlaps conceptually with the 结构浏览 tab. |
| PA-A4 | At 1440×900 the project list occupies only the upper half of the viewport; density can be raised once PA-A2 adds columns. |

## Delivery batches

### Batch 1 — defects

1. [x] PA-D1: scope the `.project-admin-library-grid` desktop column rules to the desktop breakpoint so the ≤960px card layout is not overridden; verify the status badge, counts, timestamp, and row actions all render at 390×844.
2. [x] PA-D2: move the attribution `ColumnFilter` onto the 驱动模块 header (the column that renders attribution modules) and keep the funnel `aria-label` aligned with the column title.
3. [x] PA-D3: repair the structure-browser stacking so the subtitle is legible, the detail card does not overlap the node list, and the value-kind metadata meets contrast.
4. [x] PA-D4: complete or replace the tab semantics — either add `role="tabpanel"` plus `aria-controls`, or express the route switch as navigation to match the organization sub-nav.
5. [x] PA-D5: give the spec library table an accessible name.
6. [x] PA-D6: replace the toolbar-wrapped 待审核 counter and its inline style with a dedicated class.
7. [x] PA-D7: fold `title` / `subtitle` / `regionLabel` into the existing view metadata table.
8. [x] PA-D8: remove the `as PrototypeState` cast by tightening the props contract or handling the absent state explicitly.
9. [x] Focused component tests for the changed panels plus `npm run build`.
10. [x] playwright-cli evidence at three viewports with 0 console errors.

### Batch 2 — visual language

1. [x] Define one container/grouping pattern for project tab content and apply it to all four views.
2. [x] Define one empty-state pattern (card, message, next action) and apply it to identity-mapping, spec-review, and conflicts.
3. [x] Differentiate the two navigation levels so scope reads as the parent of sub-view.
4. [x] Fix the 768px TopBar wrap and the squeezed 审核状态 header.

### Batch 3 — information architecture

1. [x] Remove the duplicated 项目运营 headings, keeping one authoritative title per view.
2. [x] Add governance signal columns to the project list (pending review, file conflicts, baseline state) sourced from existing admin state and APIs.
3. [x] Reorder the parameter-files page and clarify 结构化检索 versus the 结构浏览 tab.
4. [x] Re-check desktop density after the new columns land.

## Key seams (starting points)

- Project list table and its column rules: `src/components/admin/ProjectAdminTable.tsx`, `src/styles.css` §`.project-admin-library-grid`.
- Shared responsive card layout: `src/styles.css` `@media (max-width: 960px)` from line 11614.
- Spec library table and filters: `src/components/parameter-topology/ParameterSpecLibrary.tsx`.
- Project routed views: `src/components/parameter-admin-next/ProjectsOperationsPanel.tsx`.
- Organization views and sub-nav: `src/components/parameter-admin-next/Organization*.tsx`, `ParameterAdminOrganizationSubNav.tsx`, `ParameterAdminNextScopeNav.tsx`.
- Admin state and queue counts: `src/application/parameters/parameterAdminState.ts`.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | No change | `AGENTS.md`, `ARCHITECTURE.md` — IA unchanged |
| Planning | Update | this plan; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; ZH companion plan |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` if admin view copy changes in Batch 3 |
| Architecture / ADR | Review | ADR-0001 — confirm the batches stay inside the governance-scope IA |
| Frontend / design | Update | `docs/FRONTEND.md` (+ ZH) for the project-tab container pattern, empty-state pattern, and any project-list column change; `docs/design-docs/ux-table-column-filter.md` if PA-D2 clarifies the funnel placement rule |
| Quality / testing | Update | `docs/developer/browser-acceptance-coverage-map.md` (+ ZH) and `docs/developer/user-operation-coverage-matrix.md` (+ ZH) for the responsive project-list requirement |
| Security / governance | No change | expected — no authz or audit behavior changes |
| Reliability / runbooks | No change | expected |
| Generated artifacts | No change | expected — no migrations |
| References | Review | `docs/references/*` only if admin copy changes are quoted there |

## Documentation Update Gate

Before moving this plan to `completed/`:

1. Every Impact Matrix `Update` / `Review` row is updated or recorded unchanged with evidence.
2. All three batches are delivered, or the remainder is re-filed in `exec-plans/tech-debt-tracker.md`.
3. Browser acceptance coverage for the responsive project list is registered with automation or supplemental evidence.
4. `npm run docs:check` is green.

## UI interaction coverage

Every batch changes user-facing interaction behavior, so the UI Interaction Automation Rule applies.

- Existing IDs: `PARAM-ADMIN-001` (import preview and audit drawer) and `PARAM-ADMIN-002` (import wizard) do not cover the project list, its responsive rendering, or the project tabs.
- Batch 1 must add a requirement ID for the project list rendering its status, counts, timestamp, and row actions at mobile width, registered in `docs/developer/browser-acceptance-coverage-map.md` before implementation is claimed complete.
- Batches 2 and 3 must review whether the empty-state and governance-signal changes need their own IDs.

## Verification

```bash
npm test -- src/ParameterAdminNextPage.test.tsx src/ParameterAdminNextPage.a11y.test.tsx
npm run build
npm run docs:check
# Browser evidence under work/ui-checks/param-admin-ux-polish-batch{N}/
```
