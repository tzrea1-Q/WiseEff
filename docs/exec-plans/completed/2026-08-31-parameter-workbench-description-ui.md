# Parameter workbench description UI

Chinese: [中文](../../zh-CN/exec-plans/completed/2026-08-31-parameter-workbench-description-ui.md)

**Status:** completed

**Baseline:** `main@e895bedefa90c2d00c0dcc9e1f6e7496c060534d`

**Branch:** `codex/parameter-workbench-description-ui-20260831`

## Goal and success criteria

Improve the API-mode Project Parameter User Workbench at `/parameters` without changing its search, module navigation, DTS source view, export, draft, review, or writeback workflows.

- Remove the `显示 x / y 个参数` result-count copy beside parameter search while retaining DTS-source find status when it is useful.
- Remove the `带到参数调试` action and its navigation behavior from this workbench.
- Add a `展示描述` column to the semantic parameter list. Empty descriptions render as `—`.
- Show a separately labelled `参数说明` field in both the parameter view dialog and every parameter card in the edit dialog. Empty documentation renders as `暂无参数说明`.
- Preserve version correctness: display description and documentation come from the exact `parameter_spec_version_id` pinned by each binding revision, not from an unbounded current-spec lookup.
- Add Red→Green regression coverage before implementation and verify the real route at desktop, tablet, and mobile sizes.

## Root cause and design

`DtsParameterWorkbench` renders the obsolete count and debugging handoff directly. The semantic row contract contains binding and topology data only, so the main table and edit dialog cannot render spec copy. The view dialog loads current spec detail and collapses `documentation` and `description` into one `参数含义`, losing the distinction between the display description and the fuller parameter documentation.

The binding-list read already joins the pinned binding revision. Extend that single query and DTO with nullable `displayName`, `description`, and `documentation` from the pinned `parameter_spec_versions` row. The version join remains optional so legacy bindings without a pinned version stay visible with nullable copy fields. Carry those fields through the HTTP mapper and workbench row builder, including search text. Render `description` in the table and render `documentation` as `参数说明` in view/edit surfaces. The view dialog may still load the richer current detail for constraints and comparison metadata, but its copy fields prefer the pinned row projection so the user sees content consistent with the binding revision.

## Scope

- Binding-list projection and API DTO: `server/modules/parameter-topology/bindingService.ts`, `server/modules/parameter-topology/service.ts`, `server/modules/parameter-topology/schemas.ts`, matching tests, HTTP mapper and tests.
- Row model/building: `src/domain/parameter-topology/workbenchTypes.ts`, `src/application/parameters/buildDtsWorkbenchRows.ts`, matching tests and fixtures.
- UI: `src/components/parameter-topology/DtsParameterWorkbench.tsx`, `DtsParameterWorkbenchTable.tsx`, `DtsBindingDetailDialog.tsx`, `DtsBindingDraftDialog.tsx`, styles, and component tests.
- Acceptance/doc evidence only where the existing `/parameters` coverage contract needs an assertion or generated contract refresh.

Non-goals: changing permissions, draft submission semantics, device debugging, DTS reload, database schema, parameter-definition governance, or legacy mock-mode `ParametersTable`.

## Implementation tasks

- [x] Inspect the current worktree, preserve inherited changes, fetch `origin/main`, create an isolated feature worktree, and record this plan.
- [x] Add failing public-boundary tests for toolbar removals, table description, pinned DTO mapping, and view/edit parameter documentation.
- [x] Extend the pinned binding-list projection and row model with nullable presentation fields.
- [x] Implement the toolbar, table, view-dialog, edit-dialog, responsive, and empty-state changes.
- [x] Run focused tests, server/client contract tests, related frontend tests, build, lint, UI and documentation gates.
- [x] Verify `/parameters` in the real browser at `1440x900`, `768x1024`, and `390x844`, including search, view, edit, console errors, data loading, overflow, snapshots, and screenshots.
- [x] Record verification evidence and archive both plan files, with the unrelated acceptance-suite failure kept explicit below.

## Interaction and acceptance coverage

This change refines existing workbench read/edit presentation and removes one obsolete navigation action. It creates no new business operation ID.

| Workflow | Acceptance requirement | Operation ID | Existing spec | Plan |
| --- | --- | --- | --- | --- |
| Semantic parameter browse/search/detail | `PARAM-TOPOLOGY-BROWSE-001` | `PARAM-TOPOLOGY-BROWSE-001` | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | Preserve the route flow; add assertions for description/documentation where the seeded data supports them. |
| Mature parameter draft editing | `PARAM-DRAFT-EDIT-001` | `PARAM-DRAFT-EDIT-001` | `e2e/acceptance/parameters-negative.acceptance.spec.ts` | Preserve edit/remove behavior and lock the documentation field at the component boundary. |
| End-to-end parameter submission | `PARAM-HAPPY-001` | `PARAM-HAPPY-001` | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | Confirm toolbar cleanup does not affect search, draft, submit, review, or writeback. |

## Verification matrix

- Red/Green: focused Vitest files for `DtsParameterWorkbench`, table, detail dialog, draft dialog, row builder, HTTP client, and topology service/repository.
- Related frontend/server: `ApiProjectTopologyWorkspace`, parameter-topology route/service/schema tests, and relevant acceptance spec where locally runnable.
- Static/build: `npm run lint -- --no-cache`, `npm run build`, `npm run ui:check`, `git diff --check`.
- Docs/coverage: `npm run docs:check`, `npm run acceptance:coverage`, `npm run acceptance:operations`.
- Browser: API-mode `/parameters` at `1440x900`, `768x1024`, and `390x844`; snapshot and screenshot each size; exercise search, view, close, edit, documentation, table/card responsiveness; check console errors, failed network requests, and page-level horizontal overflow. Evidence goes under `work/ui-checks/parameter-workbench-description-ui-20260831/`.

## Documentation Impact Matrix

| Area | Status | Exact paths | Rationale |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md` | No map or ownership change. |
| Planning docs | Update | this file and its Chinese companion; archive after verification | Required implementation/evidence record. |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md`, `docs/zh-CN/product-specs/prototype-functional-spec.md` | Existing workbench workflow remains; no product-spec rewrite expected. |
| Architecture/API docs | Review | `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`, `docs/api/README.md` | Binding-list response gains nullable presentation fields; generated OpenAPI must be refreshed if contract tooling requires it. |
| Quality/testing docs | Review | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, Chinese companions | Existing gates remain sufficient. |
| Reliability/runbooks | No change | `docs/RELIABILITY.md`, `docs/runbooks/README.md`, Chinese companions | No runtime or operational change. |
| Security/governance | No change | `docs/SECURITY.md`, `docs/security/README.md`, Chinese companions | No authz, audit, or mutation-policy change. |
| Frontend/design | Review | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, `docs/design-docs/ui-design-system.md`, Chinese companion | Existing table, responsive, copy, and modal rules apply. |
| Generated artifacts | Review | `docs/generated/openapi.json`, acceptance operation evidence | Refresh only mechanically affected contract output; do not fabricate acceptance evidence. |
| References | Review | `docs/references/productization-api-contract-draft.md` | No manual update unless the response shape is explicitly duplicated there. |
| Browser acceptance | Review | coverage and operation matrices in English and Chinese | Existing operation IDs remain; assertions may be strengthened. |

## Documentation Update Gate

- English and Chinese plan files stay semantically aligned and link to each other.
- Every `Update` or `Review` row is either updated or recorded unchanged with evidence.
- Any generated OpenAPI drift is resolved through repository generators, not manual JSON edits.
- `npm run docs:check`, acceptance coverage, and operation coverage pass before archival.
- No same-name plan remains in both `active/` and `completed/`.

## Git & PR Workflow

All implementation stays on `codex/parameter-workbench-description-ui-20260831`, created from the exact latest `origin/main` baseline above. The inherited dirty worktree at `/Users/tzrea1/Develop/WiseEff` remains untouched. This request does not currently authorize opening or merging a PR; commits and GitHub delivery will only be performed if the user asks for them.

## Verification record

### Red to Green

- Toolbar regression: the new focused test first failed because the legacy `显示 4 / 4 个参数` status remained, then passed after the count and debugging handoff were removed.
- Presentation projection: four focused tests first failed for missing pinned DTO fields, the `展示描述` column, split detail labels, and edit-card documentation; all four passed after implementation.
- Legacy compatibility: CI visual review exposed that an inner version join hid bindings without `parameter_spec_version_id`; the query now uses an optional version join, and the server regression test covers the retained row with nullable presentation copy.
- Related frontend: 8 files / 178 tests passed; the final workspace/component rerun passed 2 files / 53 tests.
- PostgreSQL-focused server tests used a disposable clean database and passed 2 files / 21 tests. The database was dropped after verification.
- Full frontend regression passed 421 files / 3,171 tests.

### Static and governance gates

- `npm run build`, `npm run contract:check`, `npm run ui:check`, `npm run docs:check`, `npm run acceptance:coverage`, `npm run acceptance:operations`, and `git diff --check` passed.
- `npm run lint -- --no-cache` passed with 0 errors and 301 pre-existing warnings.
- `docs:check` reported its documented local limitation: pgvector is unavailable, so the canonical pgvector schema artifact is left to CI.
- Documentation review found no map, product-flow, architecture, security, runbook, quality-matrix, or reference contract change. OpenAPI was current, and no new acceptance/operation ID was required.

### Real browser

- Temporary API-mode URL: `http://127.0.0.1:5194/parameters?project=aurora`, backed by a freshly migrated and M0/M1-seeded disposable PostgreSQL database.
- Viewports: `1440x900`, `768x1024`, and `390x844`; Browser control and `playwright-cli` each captured snapshots/screenshots.
- Interactions: searched `gpio_int`, confirmed two matching binding rows, opened/closed parameter detail, opened/closed edit, and verified `展示描述` plus `参数说明` content. The legacy count and debugging handoff each resolved to zero elements.
- Layout: page scroll width equalled viewport width at all three sizes; no overlap, clipping, or page-level horizontal overflow was found in the target states.
- Console/data loading: 0 browser errors; seeded binding-list/detail/history/compare data loaded successfully. Two existing CopilotKit local-license warnings remained. No target API failure surfaced during the checked interactions.
- Screenshots: `work/ui-checks/parameter-workbench-description-ui-20260831/` includes desktop list/detail/edit, tablet list, mobile list/detail/edit, and independent `playwright-cli` captures.
- The temporary API process, Vite process, and browser database were stopped and removed after verification.

### Acceptance-suite boundary

`parameter-topology.acceptance.spec.ts` reached the existing review-task flow but failed while creating an occurrence-derived draft spec (`create draft spec for review ...`), outside the binding-list/presentation paths changed here. The run also exposed a macOS `/var` versus `/private/var` temporary-path guard and retained two test resources after process cleanup. Both exact disposable databases were verified by their `parameter-topology` marker and matching cutover run before removal; the orphaned test process was terminated, and its exact temporary object-store root was moved to Trash. This acceptance run is not claimed as passing.
