# Project configuration workbench defect repair

> Status: **Active** — findings recorded 2026-08-08; implementation not started
> Date: 2026-08-08
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-08-project-configuration-workbench-defect-repair.md`](../../zh-CN/exec-plans/active/2026-08-08-project-configuration-workbench-defect-repair.md)
> Locked design: [`docs/design-docs/2026-08-06-project-configuration-workbench-design.md`](../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> Cutover that shipped the surface: [`docs/exec-plans/completed/2026-08-08-project-configuration-workbench-cutover.md`](../completed/2026-08-08-project-configuration-workbench-cutover.md)

## Context

The configuration workbench (`/parameter-admin/projects/:projectId/configuration`) shipped its Phase 1–6 scope and became the canonical project configuration surface after the 2026-08-08 cutover. A 2026-08-08 walkthrough as Admin (`xu.yun`, API mode, seeded `atlas`) at 1440×900 / 768×1024 / 390×844 found that the surface is visually broken at every viewport **and** that its release path is dead.

Measurements were taken in-page with `getBoundingClientRect`, not by eye. Two facts reframe the work:

1. **The release path is blocked by a schema drift, not by product state.** `listOpenConflicts` still queries the pre-cutover table `project_parameter_values`, which the parameter-identity cutover renamed to `legacy_project_parameter_values`. Every call throws. `releaseReadinessService` catches the throw and converts the raw database error into a product-language blocker, so the workbench reports `1 阻断` with the message `relation "project_parameter_values" does not exist`, sets `canCreateBaseline: false` / `canRelease: false`, and tells the operator to go resolve a conflict — while `parameter_file_sync_conflicts` holds **0 rows**. The operator cannot escape this state by any product action.

2. **The command bar is over-subscribed, and that single cause produces most of the visible layout damage.** It is a `flex-wrap: nowrap` row whose six children need roughly 1660px of natural width inside a 1126px container. The overflow does not scroll or clip; it paints on top of neighbours.

This plan records the findings and sequences the repair. It does not reopen the locked workbench design.

## Goal

1. **Batch 0 (blocking)** — restore the release path by fixing the conflict-query schema drift, stop leaking database errors as product language, and close the test gap that let this ship.
2. **Batch 1 (command bar)** — reduce what the command bar carries, then make it degrade by wrapping/collapsing instead of by overlapping.
3. **Batch 2 (responsive)** — fix the mobile action row, the source-tree ordering fault, and mobile occlusion.
4. **Batch 3 (source tree)** — make the left panel's search block proportionate and give the node list real hierarchy.
5. **Cross-cutting** — strengthen the layout assertion that passed while 15 element overlaps were on screen.

## Non-goals

- Reopening the locked configuration workbench design or the ADR-0001 governance-scope IA.
- The wider parameter-identity cutover backlog (`2026-07-16-parameter-topology-*` plans) beyond the single conflict query named in CW-B1.
- Redesigning the DTS source viewer, the inspector's information model, or the task dock's contents.
- Xiaoze agent behaviour; only its launcher's placement on small viewports is in scope (CW-D8).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `fix/project-configuration-workbench-defects`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `fix/project-configuration-workbench-defects`, checked out from the latest `main`. Batch 0 should merge on its own because it is a correctness fix with a small diff; Batches 1–3 may be resequenced onto follow-up branches from `main`.

## Findings

### Batch 0 — blocking defects

| ID | Finding | Location |
| --- | --- | --- |
| CW-B1 | `listOpenConflicts` joins `project_parameter_values` and reads `ppv.current_value` / `ppv.source_node_path`. That table was renamed to `legacy_project_parameter_values` by the identity cutover; the live table is `project_parameter_bindings`, and `parameter_file_sync_conflicts` already carries `project_parameter_binding_id` (not `project_parameter_value_id`). Every invocation throws `relation "project_parameter_values" does not exist`. The function has **six production call sites**: the conflicts list route, release readiness, conflict resolve, bulk resolve, and two candidate-activation paths. | `server/modules/parameters/repository.ts:2819-2889` (join at 2862); callers in `server/modules/parameter-files/routes.ts:442`, `releaseReadinessService.ts:282`, `conflictService.ts:34,137,209`, `candidateService.ts:395,607` |
| CW-B2 | `releaseReadinessService` catches any failure from the conflict lookup and pushes `error.message` verbatim into a `blocker` shown in the command bar, with a remediation pointing at an empty Conflicts dock. An infrastructure fault is presented as a product state the operator is asked to clear, and it silently disables baseline create/release. | `server/modules/parameter-files/releaseReadinessService.ts:286-295` |
| CW-T2 | Every unit test that touches `listOpenConflicts` replaces it with `vi.mock`, so no test executes its SQL. The drift was invisible to `npm run test:server`. | `routes.test.ts:27`, `releaseReadinessService.test.ts:22`, `conflictService`-adjacent suites, `dtsSearchRoutes.test.ts:24`, `structuralReadRoutes.test.ts:25`, `configSetBaselineRoutes.test.ts:29` |

Evidence for CW-B1/CW-B2, taken live against the seeded local database:

```json
{ "level": "blocked", "canCreateBaseline": false, "canRelease": false,
  "blockers": [ { "code": "open-conflict",
    "message": "relation \"project_parameter_values\" does not exist",
    "remediation": { "label": "Resolve conflict in the Conflicts task dock" } } ] }
```

### Batch 1 — command bar

The command bar `.configuration-workbench__command` is 1126px wide at 1440×900 and holds six children whose natural widths total roughly 1660px. Because it is `flex-wrap: nowrap` with `overflow: visible`, the deficit is absorbed by whichever child is allowed to shrink, and the rest paints over its neighbours.

| ID | Finding | Location |
| --- | --- | --- |
| CW-A1 | Root cause: the command bar carries six unrelated jobs at once — back navigation, project identity, config-set selection, a **config-set creation form**, three version-identity chips, and six action buttons. No arrangement of flex rules makes that fit; the set itself has to shrink. | `src/styles.css:25915-25923`; `ProjectConfigurationWorkbench.tsx` command-bar render |
| CW-D1 | `.configuration-workbench__identities` combines `min-width: 0`, `white-space: nowrap` and `overflow: visible`. Compressed to 123px while needing 386px, its content neither wraps nor clips: **15 measured overlaps**, with all three version chips painting over the 已阻断 / 活动 / 检查器 controls, and `发布基线：seed-v1` covering button glyphs. | `src/styles.css:25978-25987` |
| CW-D2 | `.configuration-workbench__project` is compressed to 36px against 114px of content. Its `<strong>` has `text-overflow: ellipsis` and degrades acceptably to `Atla…`, but the two `<span>` children (`ATL-Intl`, `在研`) have no truncation and collapse into vertical character stacks that spill onto the config-set select. | `src/styles.css:25932-25953` |
| CW-D4 | At ≤768px the media query assigns `order` to back / project / config-select / identities / unavailable-actions but **omits `__create-config`**, which keeps `order: 0` and jumps ahead of everything. Measured at 390×844: the creation form sits at `y=80` while 项目清单 is pushed to `y=133`. | `src/styles.css:26958+` versus `26307-26313` |
| CW-D5 | `.configuration-workbench__project` uses `grid-template-columns: auto auto`, which collapses in narrow containers and disperses in wide ones. At 768×1024 `在研` is pushed to x≈450, far from `ATL-Intl`, so the three identity fragments no longer read as one unit. | `src/styles.css:25932-25939` |

### Batch 2 — responsive

| ID | Finding | Location |
| --- | --- | --- |
| CW-D3 | At 390×844 the action row gives five buttons `flex: 1 1 0` inside 282px. Measured: 上传候选 / 导出配置集 / 创建基线 render at **43px wide by 69–82px tall**, one character per line. | `src/styles.css:27050-27052` |
| CW-D8 | At 390×844 the Xiaoze launcher hint floats over the source canvas and occludes code, its own label wrapping to four lines; the source header breaks `工作配 置` mid-word and splits `atlas-board.dts` across two lines. | `src/styles.css` Xiaoze toggle rules; workbench source header |

### Batch 3 — source tree

| ID | Finding | Location |
| --- | --- | --- |
| CW-D6 | `.configuration-workbench__search` is a single-column grid, so the query field, 搜索, 下一个 and the line-jump each take a full row. Measured height 187px — 30% of the 630px tree panel — before any result is shown. | `src/styles.css:26145-26158` |
| CW-D7 | The node list renders full paths (`amba/i2c@FF24E000/hl7603@…`) as a flat sequence with no indentation, then ellipsises them, so parent/child structure is unreadable and the panel scrolls to 1847px. This is what reads as a column of centred pills. | `src/styles.css:26184-26221`; member/node tree render |

### Cross-cutting — verification gap

| ID | Finding | Location |
| --- | --- | --- |
| CW-T1 | `PROJ-CONFIG-READ-001` claims "three-viewport workbench layout without clipping or page-level horizontal overflow", but its only layout assertion is `document.documentElement.scrollWidth <= clientWidth`. Measured live: `1440 <= 1440` **passes** while 15 element overlaps are on screen, because children that overflow with `overflow: visible` inside a constrained flex row never grow the document scroll width. The assertion gives false assurance. | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts:159-166,198-202` |

## Decisions — settled 2026-08-08

| ID | Decision | Rationale |
| --- | --- | --- |
| CW-DEC-1 | Config-set creation leaves the command bar. The config-set select gains a `+ 新建` entry that opens a dialog built on the shared `ModalDialog` primitive. | Creation is discovered where config sets are already being chosen, so no permanent width is spent on a low-frequency action. Reusing `ModalDialog` inherits the focus-trap/inertness contract instead of adding another hand-rolled surface (see TD-059). |
| CW-DEC-2 | Keep the Working-configuration chip visible; fold the candidate and baseline identities behind it. | Working configuration answers "what am I looking at", which must stay legible at every width. Candidate and baseline are reference facts that the inspector already owns. |
| CW-DEC-3 | Primary: readiness summary, 检查器, 上传候选. Secondary behind a 更多 menu: 活动, 导出配置集, 创建基线. | Readiness carries blocking state and cannot be hidden. The inspector is the main navigation partner of the source canvas. Upload is the daily entry point into the configuration flow, whereas baseline creation is an end-of-cycle action reached deliberately. |
| CW-DEC-4 | Project identity shows the name only, with code and status in a tooltip. | Once inside the workbench the project is stable context, not a fact that needs continuous restatement. A single ellipsised line cannot produce the vertical character stacks in CW-D2. |

### Width budget after these decisions

Measured natural widths, recomputed against the same 1126px container that currently carries ~1660px:

| Element | Before | After | Note |
| --- | --- | --- | --- |
| 项目清单 back | 96 | 96 | unchanged |
| Project identity | 114 | ~140 cap | single ellipsised line (CW-DEC-4) |
| Config-set select | 188 | 188 | now also hosts `+ 新建` (CW-DEC-1) |
| Create-config form | ~280 | 0 | removed from the bar (CW-DEC-1) |
| Version identities | 386 | ~100 | Working chip plus one fold control (CW-DEC-2) |
| Action cluster | 537 | ~360 | three primary controls plus 更多 (CW-DEC-3) |
| Gaps | 60 | 48 | one fewer child |
| **Total** | **~1660** | **~932** | ~194px headroom inside 1126px |

The headroom matters as much as the fit: it is what lets a longer project name or a wider readiness label absorb space without reintroducing overlap. Batch 1 must re-measure after implementation rather than trust this estimate, and CW-T1's element-level assertion is what holds the margin over time.

## Delivery batches

### Batch 0 — blocking

1. [ ] CW-B1: repoint the `listOpenConflicts` query at the post-cutover schema (`project_parameter_bindings` via `parameter_file_sync_conflicts.project_parameter_binding_id`), and confirm the `base_value` / `source_node_path` enrichment has a real post-cutover source or is removed from the DTO with its consumers updated.
2. [ ] CW-T2: add a repository test that executes the real SQL against the migrated schema (no `vi.mock`) so the query cannot drift from the tables again; verify all six call sites still resolve.
3. [ ] CW-B2: stop surfacing raw exception text as a product blocker. Infrastructure failure should be reported as an unavailable readiness signal, distinct from "there are open conflicts", and must not offer a remediation that leads to an empty dock.
4. [ ] Verify end to end that `release-readiness` returns an unblocked level for a seeded project with no conflicts, and that 创建基线 becomes enabled.

### Batch 1 — command bar

5. [x] Settle CW-DEC-1 – CW-DEC-4 and record them in this plan (2026-08-08).
6. [ ] CW-A1 / CW-D4: move config-set creation into a `+ 新建` entry on the config-set select backed by a `ModalDialog`, and delete `__create-config` from the command bar. This also removes CW-D4 at its source, because the element carrying the missing `order` no longer exists in the bar.
7. [ ] CW-D1: keep the Working-configuration chip and fold candidate/baseline behind it; `__identities` must never combine `overflow: visible` with `nowrap` under a shrinkable width.
8. [ ] CW-D2 / CW-D5: render project identity as one ellipsised line with code and status in a tooltip, replacing the `grid-template-columns: auto auto` that collapses when narrow and disperses when wide.
9. [ ] CW-D3 groundwork: split the action cluster into primary (readiness, 检查器, 上传候选) and a 更多 menu (活动, 导出配置集, 创建基线).
10. [ ] Re-measure the command bar against the width budget above at 1440/1024/768/390 and confirm the headroom is real, not estimated.

### Batch 2 — responsive

11. [ ] CW-D3: stop equal-flex distribution of the action row below the width where labels stay on one line; adopt the Batch 1 primary/secondary split.
12. [ ] CW-D8: keep the Xiaoze launcher clear of the source canvas at 390px and fix the source-header wrapping.

### Batch 3 — source tree

13. [ ] CW-D6: compact the search block so the tree keeps the majority of the panel.
14. [ ] CW-D7: render the node list as an indented hierarchy showing each node's own segment, with the full path available on demand.

### Cross-cutting

15. [ ] CW-T1: replace the page-level overflow assertion with an element-level check that fails on intersecting sibling rectangles and on children exceeding their container, then confirm it fails against current `main` and passes after Batches 1–3.
16. [ ] playwright-cli evidence at 1440×900 / 768×1024 / 390×844 with 0 console errors.

## Key seams (starting points)

- Command bar markup: `src/components/project-configuration-workbench/ProjectConfigurationWorkbench.tsx`.
- Command bar styles: `src/styles.css:25915-26030`; responsive rules at `26914` (≤900px), `26933` (≤1024px), `26958` (≤768px).
- Source tree styles: `src/styles.css:26145-26280`.
- Conflict query: `server/modules/parameters/repository.ts:2819`.
- Readiness assembly: `server/modules/parameter-files/releaseReadinessService.ts`.
- Acceptance spec: `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | No change | `AGENTS.md`, `ARCHITECTURE.md` — no IA or module boundary change |
| Planning | Update | this plan; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; ZH companion plan |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` if CW-DEC-1/CW-DEC-3 move where config-set creation and secondary actions are invoked |
| Architecture / ADR | Review | `docs/design-docs/2026-08-06-project-configuration-workbench-design.md` (+ ZH) — confirm the command-bar reduction stays inside the locked design, or amend it if CW-DEC-1/3 change the surface contract |
| Frontend / design | Update | `docs/FRONTEND.md` (+ ZH) for the command-bar degradation pattern and the source-tree hierarchy pattern |
| Quality / testing | Update | `docs/developer/browser-acceptance-coverage-map.md` (+ ZH) for the strengthened `PROJ-CONFIG-READ-001` layout assertion; `docs/developer/user-operation-coverage-matrix.md` (+ ZH) if operation coverage changes |
| Security / governance | No change | expected — no authz or audit behaviour change |
| Reliability / runbooks | Review | whether a readiness signal that is *unavailable* rather than *blocked* needs runbook guidance |
| Generated artifacts | Review | `docs/generated/` schema summary if CW-B1 needs a migration rather than a query change |
| References | Review | `docs/references/productization-api-contract-draft.md` if the readiness DTO gains an unavailable state |

## Documentation Update Gate

Before moving this plan to `completed/`:

1. Every Impact Matrix `Update` / `Review` row is updated or recorded unchanged with evidence.
2. CW-DEC-1 – CW-DEC-4 are recorded with their chosen option and rationale.
3. All batches are delivered, or the remainder is re-filed in `docs/exec-plans/tech-debt-tracker.md` (next free id: **TD-062**).
4. `npm run docs:check` is green.

## UI interaction coverage

Every batch changes user-facing interaction behaviour, so the UI Interaction Automation Rule applies.

- `PROJ-CONFIG-READ-001` already owns the three-viewport layout claim; CW-T1 must strengthen its assertion rather than add a new id, because the existing id already promises what was not being checked.
- `PROJ-CONFIG-READINESS-001` covers fail-closed create/release. Batch 0 must extend it to distinguish *blocked by open conflicts* from *readiness unavailable*, so a future infrastructure fault cannot masquerade as a product blocker again.
- `PROJ-CONFIG-CONFLICT-001` exercises conflict arbitration through mocked repository seams; Batch 0 must confirm it still covers the post-cutover query, or add real-schema coverage.
- Batches 1–3 change command-bar and tree presentation, not capability, so they extend existing ids rather than introduce new ones. Operation evidence must still be regenerated through `npm run acceptance:browser` or `npm run acceptance:evidence`.

## Verification

```bash
npm run test:server -- server/modules/parameters/repository.test.ts
npm run test:server -- server/modules/parameter-files
npm test -- src/components/project-configuration-workbench
npm run build
npm run docs:check
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
# Browser evidence under work/ui-checks/project-configuration-workbench-defect-repair/
```

Batch 0 additionally requires a live check against a migrated database:

```bash
curl -s -H "Authorization: $WISEEFF_SMOKE_AUTHORIZATION" \
  "http://127.0.0.1:8787/api/v1/projects/atlas/parameter-file-conflicts"
curl -s -H "Authorization: $WISEEFF_SMOKE_AUTHORIZATION" \
  "http://127.0.0.1:8787/api/v1/projects/atlas/config-sets/dcs-default-atlas/release-readiness"
```

Expected after Batch 0: the first returns `200` with an items array; the second reports no `open-conflict` blocker and enables baseline creation for a project with zero conflict rows.
