# Preserve Per-Branch Expansion State in the Shared Module Navigator

> Chinese: [中文](../../zh-CN/exec-plans/completed/2026-08-29-module-navigator-expansion-state.md)

**Status:** Active implementation plan

**Baseline:** `main@8bb53fdee7d87405d5ac1ba93d113a77464ea057`

**Branch:** `fix/module-navigator-expansion-20260829`

## Goal

When a user selects a module in any shared `DtsTopologyNavigator`, only the selected node's ancestor path should be opened. Roots or branches that the user previously collapsed must remain collapsed. The existing first-load defaults and keyboard/disclosure behavior must remain unchanged.

## Incident and root cause

The shared navigator currently uses `expansionPath` both for initial expansion and for synchronizing selection changes. `expansionPath` starts with every root that has children, then adds the selected node's ancestors. The selection effect merges that result into the current expansion set. Consequently, selecting any node re-adds every expandable root and turns the whole module tree back on, including roots the user intentionally collapsed.

The defect is in the shared frontend state seam, not in the API, tree construction, or the separate module selector/attribution tree components. Direct consumers are the parameter workbench, `/dts-reload`, `/node-debugging`, and `/parameter-admin/specs`.

## Success criteria

- After collapsing all roots, opening one root, and selecting a descendant, the selected path is visible while every unrelated root remains collapsed.
- Initial `expandAllByDefault`, `defaultExpandDepth`, root-only defaults, asynchronous tree arrival, and selection of a hidden descendant retain their current behavior.
- Disclosure buttons still only change expansion, and row clicks still select without directly toggling expansion.
- No API, persistence, routing, or backend changes are introduced.
- The focused regression is red before the implementation and green after it.

## Scope and non-goals

In scope:

- `src/components/parameter-topology/DtsTopologyNavigator.tsx`
- `src/components/parameter-topology/DtsTopologyNavigator.test.tsx`
- This active plan and its Chinese companion.

Out of scope:

- `ModuleTreeSelect`, `TreeFilterOptions`, and `ModuleAttributionTree`, which have different state models and are not on this defect path.
- Tree data ordering, module filtering, URL state, API contracts, CSS, and unrelated navigation behavior.

## Design

1. Keep initial expansion policy explicit. Initial state may use all expandable nodes, the configured depth, root-only defaults, and the selected path exactly as it does today.
2. Introduce a selection-only path helper that walks from the selected node through its ancestors and returns only expandable nodes on that path. It must not include unrelated roots.
3. In the synchronization effect, prune IDs that no longer exist, seed initial expansion only when asynchronous data first becomes available, and merge only the selection-only path thereafter. Existing IDs for unrelated branches must be preserved so manual collapse remains authoritative.
4. Preserve the existing row/disclosure event contract: the disclosure control calls `setExpanded`; the row calls `onSelectNode`. Selecting a node may make its own path visible through state synchronization, but must not reset the rest of the tree.
5. Add a public component-level regression with two expandable roots and a controlled selection harness. Exercise the user sequence that reproduces the bug and assert both the selected path and the unrelated collapsed root.

## Implementation tasks

- [x] Add the plan and bilingual documentation impact record before source changes.
- [x] Add the multi-root regression test and run the focused test to capture the failing behavior.
- [x] Split initial expansion and selection-path helpers with the smallest state-sync change.
- [x] Run focused tests after the fix, then the frontend/static/build/documentation gates.
- [x] Verify `/dts-reload` and `/node-debugging` with the real browser interaction at desktop, tablet, and mobile viewports; review the other shared consumers for regressions.
- [x] Run independent Standards and Spec review, record findings, and resolve actionable findings before delivery.
- [x] Archive this plan and its Chinese companion only after verification is complete, then create, check, merge, and verify the GitHub PR.

## Interaction and acceptance coverage

This is an existing interaction invariant, not a new business operation. The following coverage was reviewed and remains the owner of the affected workflows:

| Shared consumer / workflow | Acceptance requirement | Operation ID | Existing spec | Planned treatment |
| --- | --- | --- | --- | --- |
| Parameter workbench topology browsing | `PARAM-TOPOLOGY-BROWSE-001` | `PARAM-TOPOLOGY-BROWSE-001` | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | Keep the existing end-to-end workflow; lock the cross-root expansion invariant at the shared component seam. |
| Spec governance catalog navigation | `PARAM-SPEC-GOVERN-001` | `PARAM-SPEC-GOVERN-001` | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | Review the shared-consumer path; no new operation is required. |
| Node debugging module browsing | `DEBUG-SIM-001` | `DEBUG-SIM-001` | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` | Keep the existing module-subtree browse flow; the deterministic multi-root regression is added to `DtsTopologyNavigator.test.tsx`. |
| Parameter debugging reload workflow | `DTS-RELOAD-DEPLOY-001` | `DTS-RELOAD-DEPLOY-001` | `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts` | Review the shared navigator consumer; no API or operation evidence contract changes. |

The acceptance suites exercise route-level workflows and existing operation evidence. The reported defect is a reusable local state invariant that is most reliably asserted at the public component boundary with a controlled multi-root fixture; adding a second route-specific acceptance flow would duplicate the same contract. Browser verification will still exercise the real `/dts-reload` and `/node-debugging` interactions after the fix.

## Verification matrix

- Red/Green: `npx vitest run src/components/parameter-topology/DtsTopologyNavigator.test.tsx`.
- Frontend regression: `npm test -- --maxWorkers=4` (the default unconstrained run is also observed for baseline flakiness), plus the focused component and direct-consumer suites.
- Static/build: `npm run lint -- --no-cache`, `npm run build`, `npm run ui:check`, and `git diff --check`.
- Documentation, coverage, and operation evidence: `npm run docs:check`, `npm run acceptance:coverage`, `npm run acceptance:operations`, and `npm run acceptance:evidence`.
- Browser runtime: mock mode on `/parameters`, `/dts-reload`, `/node-debugging`, and `/parameter-admin/specs`; snapshot and screenshot at `1440x900`, `768x1024`, and `390x844`; collapse/open/select interaction on shared navigator consumers; console error check; layout/overflow review. Screenshots belong under `work/ui-checks/module-navigator-expansion-20260829/`.
- Server, database, and bridge suites are not changed by this frontend-only fix; PR CI remains the final repository-wide gate.

## Documentation Impact Matrix

| Area | Status | Exact paths / evidence | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Shared consumer list and repository routing reviewed; no map change is needed. |
| Planning docs | Update | `docs/PLANS.md`, `docs/exec-plans/active/2026-08-29-module-navigator-expansion-state.md`, `docs/zh-CN/exec-plans/active/2026-08-29-module-navigator-expansion-state.md` | Record the branch, scope, gates, review findings, and final evidence; archive both plan files after delivery. |
| Product specs | No change | `docs/product-specs/prototype-functional-spec.md`, `docs/zh-CN/product-specs/prototype-functional-spec.md` | The fix restores the existing per-node interaction and changes no workflow or terminology. |
| Architecture docs | Review | `CONTEXT.md`, `docs/design-docs/full-stack-architecture.md`, `docs/zh-CN/design-docs/full-stack-architecture.md` | No API, persistence, or domain ownership change. |
| Quality/testing docs | Review | `docs/developer/verification-matrix.md`, `docs/developer/ui-quality-checklist.md`, `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md` | Existing focused, full, build, UI, and browser gates were applied. |
| Reliability/runbooks | No change | `docs/RELIABILITY.md`, `docs/zh-CN/RELIABILITY.md`, `docs/runbooks/README.md`, `docs/zh-CN/runbooks/README.md` | No runtime, deployment, or operational behavior change. |
| Security/governance docs | No change | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`, `docs/security/README.md`, `docs/zh-CN/security/README.md` | No authorization, audit, device-write, or governance contract change. |
| Frontend/design docs | Review | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, `docs/design-docs/ui-design-system.md`, `docs/zh-CN/design-docs/ui-design-system.md`, `docs/design-docs/2026-07-20-dts-topology-expand-collapse-design.md`, `docs/zh-CN/design-docs/2026-07-20-dts-topology-expand-collapse-design.md` | Shared consumers, UI gates, and the documented per-node expansion model were reviewed; no design-doc update is needed. |
| Generated artifacts | No change | `docs/generated/acceptance-operation-evidence.md`, `docs/generated/acceptance-operation-evidence/index.json`, `docs/generated/db-schema.md` | No schema or generated runtime artifact is affected. |
| References | No change | `docs/references/productization-api-contract-draft.md` | No external contract reference is affected. |
| Browser acceptance | Review | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/zh-CN/developer/browser-acceptance-coverage-map.md`, `docs/zh-CN/developer/user-operation-coverage-matrix.md` | Existing `PARAM-TOPOLOGY-BROWSE-001`, `PARAM-SPEC-GOVERN-001`, `DEBUG-SIM-001`, and `DTS-RELOAD-DEPLOY-001` coverage was reviewed; component regression and local browser evidence supplement the route-level flows. |
| Governance scripts | No change | `scripts/bilingual-docs.ts`, `scripts/check-doc-governance.ts`, `scripts/check-operation-evidence.ts` | Existing governance and evidence checks are sufficient. |

## Documentation Update Gate

- The English and Chinese plans remain semantically aligned and link to each other.
- The shared-consumer documentation and expansion/collapse design are reviewed; no current behavior docs require an update.
- The four existing acceptance/operation pairs above are recorded, the component regression is present, and `npm run acceptance:evidence` is run before archival.
- `npm run ui:check` and browser evidence cover all four identified shared consumers; `/parameters` is recorded as the current mock-mode workbench variant without a navigator.
- `npm run docs:check` passes after the active plans are archived; no same-name file remains in both `active/` and `completed/`.

## Git & PR Workflow

Implementation is isolated on `fix/module-navigator-expansion-20260829`, based on the exact latest `main` SHA above. The feature branch owns source, tests, and plan evidence. After local verification and independent review, the parent agent creates the PR, waits for required checks, merges it with branch deletion, verifies the merge SHA and remote `main`, and fast-forwards the clean main worktree. The unrelated dirty worktree at `/Users/tzrea1/Develop/WiseEff` is preserved.

## Review record

- Standards review: the plan heading, exact-path impact matrix, operation-evidence command, UI gate, all-consumer browser scope, and semantic test harness naming were corrected; the reviewer found no remaining hard standard violation. The repeated local harness shape is a small test-only judgement call and is intentionally kept local to avoid introducing a broader test abstraction for one regression.
- Spec review: pass. Initial defaults, hidden-descendant path expansion, async arrival, unrelated manual collapse, shared-consumer scope, and no-API boundary match this plan. Browser evidence is recorded below.

## Verification record

- `npx vitest run src/components/parameter-topology/DtsTopologyNavigator.test.tsx` — Red before the fix (the new multi-root test failed because the unrelated root reopened), then Green: 15/15.
- `npx vitest run src/components/parameter-topology src/features/dts-reload/DtsReloadPage.test.tsx src/NodeDebuggingPage.test.tsx` — 35 files, 393 tests passed.
- `npm test -- --maxWorkers=4` — 421 files, 3168 tests passed. Unconstrained local runs separately timed out existing unrelated tests (`NodeDebuggingPage.test.tsx:915`, and once `SpecCreateDialog.test.tsx:102`); each affected test passed when run in isolation and the controlled full run passed.
- `npm run lint -- --no-cache` — exit 0, 0 errors and 301 pre-existing warnings. `npm run build`, `npm run ui:check`, `git diff --check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` passed. `npm run docs:check` passed governance and reported the known local pgvector comparison skip because the host lacks pgvector.
- Browser runtime: mock Vite at `http://127.0.0.1:5193`; `/parameters`, `/dts-reload`, `/node-debugging`, and `/parameter-admin/specs` each received snapshot and screenshot checks at `1440x900`, `768x1024`, and `390x844`. All measured `scrollWidth` equaled `innerWidth`; console error logs were empty.
- Browser interaction: `/dts-reload` reproduced the user sequence and ended with `充电管理=true`, while `传感器=false`, `电源=false`, `温控=false`, `系统=false`, and `总线=false` after selecting `charger@6E`. `/node-debugging` selected `Charging` while its sibling `Battery` remained collapsed. Screenshots are under `work/ui-checks/module-navigator-expansion-20260829/`.
- `npm run acceptance:evidence` was executed as required by the interaction gate. It returned the repository's existing baseline failure (`coveredOperationIds: []`, all automated operation IDs missing) because no acceptance run has produced records in this local checkout; the generated evidence files were restored unchanged, and no evidence was fabricated. This frontend-only change adds no operation ID and does not alter operation evidence generation.

## Completion record

To be filled only after implementation, browser evidence, CI, merge, and clean-main synchronization are complete: PR number/URL, merge SHA, final verification commands, screenshot paths, console/network result, and any explicitly skipped target-environment evidence.
