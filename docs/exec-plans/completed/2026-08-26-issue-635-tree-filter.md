# Issue #635 Reusable Hierarchical Tree Filter

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-26-issue-635-tree-filter.md)

**Goal:** Add one data-agnostic hierarchical filter seam that can be reused by table-column filters and existing module selectors, then migrate the `/parameters` and `/dts-reload` module filters without changing API or database contracts.

**Branch:** `codex/issue-635-tree-filter`, checked out from `main` at the start of this implementation. The primary worktree's unrelated `App.tsx` and `App.test.tsx` edits are outside this plan.

**Status:** Implementation and local verification complete; parent-agent PR/merge handoff remains separate.

**Architecture:** Callers adapt registry rows into stable-ID flat nodes. The shared tree-filter domain builds a deterministic tree, promotes malformed or orphaned nodes safely, canonicalizes selected roots, derives checked/mixed state, and expands selected roots for row filtering. `ColumnFilter` keeps the existing funnel and fixed-position shell; `ModuleTreeSelect` reuses the shared option renderer. Parameter and debugging registries remain separate and no server seam is added.

## Scope and Acceptance Coverage

- In scope: shared tree model/selection/search/keyboard behavior, tree-mode `ColumnFilter`, `ModuleTreeSelect` reuse, parameter and DTS reload module-column migration, focused tests, design-system CSS, and bilingual developer documentation.
- Out of scope: API/database/persistence changes, taxonomy CRUD, server-side option loading, topology navigator replacement, and URL/saved-filter state.
- Existing acceptance coverage reviewed: `PARAM-HAPPY-001`, `DTS-RELOAD-HANDOFF-001`, `MOD-TREE-PARAM-001`, `MOD-TREE-DEBUG-001`, and `SHELL-DIAG-001`. The implementation adds component/integration coverage and manual three-viewport evidence because the shared filter interaction is not currently a blocking browser acceptance operation.

## Follow-up rollout (2026-08-26)

The same shared tree filter is now rolled out to `/parameter-review`, `/parameter-admin/specs` (definition library and embedded review queue), `/node-debugging`, and `/debugging-admin/nodes`. The two existing debug selectors continue to reuse `ModuleTreeSelect`; review/admin table columns use `ColumnFilter mode="tree"`. All consumers keep scoped stable IDs, ancestor/subtree OR semantics, path-aware search, collapsed column-filter defaults, and sole-structural-root promotion. No API or database contract changes were introduced.

## Implementation Tasks

- [x] Define the normalized node model, deterministic tree construction, malformed-node guards, canonical root selection, subtree expansion, counts, and path-aware search.
- [x] Add the reusable `TreeFilterOptions` renderer with mixed-state checkboxes, roving tree focus, keyboard expansion/navigation, disabled structural nodes, empty state, and Escape-compatible composition.
- [x] Extend `ColumnFilter` with tree mode while preserving flat mode, fixed placement, outside click, clear, selected-root badge count, and focus return.
- [x] Refactor `ModuleTreeSelect` to the shared seam while preserving its trigger, single-select behavior, multi-filter behavior, portal placement, and selectable-ID contract.
- [x] Migrate `/parameters` and `/dts-reload` module columns using current pre-column-filter scope, connected registry ancestors, subtree counts, stable IDs, and independent registries.
- [x] Update English/Chinese UX and frontend documentation, add shared/consumer tests, and record browser evidence under `work/ui-checks/issue-635/`.
- [x] Run final focused/full quality gates, independent Standards/Spec review, and parent-agent PR/merge workflow.

## Verification

```bash
npm test -- --run src/ParametersPage.test.tsx src/components/ParametersTable.test.tsx src/components/parameter-topology/DtsParameterWorkbench.test.tsx src/features/dts-reload/DtsReloadPage.test.tsx src/features/dts-reload/DtsReloadCandidateTable.test.tsx src/components/common/ModuleTreeSelect.test.tsx src/components/common/TreeFilterOptions.test.tsx src/components/ColumnFilter.test.tsx src/domain/tree-filter/treeFilter.test.ts src/application/parameters/buildModuleFilterNodes.test.ts
npm test -- --run --maxWorkers=4
npm run build
npm run lint
npm run ui:check
npm run docs:check
```

Browser evidence covers `/parameters` and `/dts-reload` in mock runtime at `1440x900`, `768x1024`, and `390x844`, including tree search, ancestor retention, expansion/collapse, parent selection, clear, Escape, outside click, horizontal-overflow checks, and console/network inspection. API-mode loading remains separately checked on the existing local service; no API contract changes are expected.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit ticket changes on `codex/issue-635-tree-filter`; do not push `main`, open a PR, or merge. |
| Parent agent | Review this branch, open/merge the GitHub PR, then sync local `main`. |

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Shared frontend seam and routing remain unchanged; frontend reference updated. |
| Planning docs | Update | this plan and Chinese companion | Record branch, scope, gates, and evidence. |
| Product specs | No change | `docs/product-specs/` | No product workflow or business rule change. |
| Architecture docs | Review | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | No API, persistence, or domain-registry ownership change. |
| Quality/testing docs | Review | `docs/developer/verification-matrix.md`, `docs/developer/ui-quality-checklist.md` | Existing frontend gates apply; no new command. |
| Reliability/runbooks | No change | `docs/reliability*`, `docs/runbooks/` | No runtime or deployment behavior change. |
| Security/governance docs | No change | `docs/SECURITY.md`, `docs/security/` | Stable IDs are presentation filtering only; no authorization or write path. |
| Frontend/design docs | Update | `docs/design-docs/ux-table-column-filter.md`, `docs/zh-CN/design-docs/ux-table-column-filter.md`, `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Document tree mode, stable IDs, keyboard, scope, and shared seam. |
| Generated artifacts | No change | `docs/generated/` | No schema or generated runtime artifact changed. |
| References | No change | `docs/references/` | No external contract reference needed. |
| Browser acceptance | Review | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` | Existing parameter/module/reload coverage IDs reviewed; local manual evidence supplements pending tree-filter automation. |

## Documentation Update Gate

- [x] English and Chinese frontend/UX documentation describe the shared hierarchical filter contract.
- [x] Existing acceptance and operation coverage IDs are named above; no existing API or database contract is changed.
- [x] `npm run docs:check` passes, with the repository-documented pgvector verification skip when the extension is unavailable locally.
- [x] Final focused/full quality gates and independent Standards/Spec review completed; parent-agent PR/merge remains a separate handoff step.
