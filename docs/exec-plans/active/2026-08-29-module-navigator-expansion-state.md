# Preserve Per-Branch Expansion State in the Shared Module Navigator

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-08-29-module-navigator-expansion-state.md)

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

- [ ] Add the plan and bilingual documentation impact record before source changes.
- [ ] Add the multi-root regression test and run the focused test to capture the failing behavior.
- [ ] Split initial expansion and selection-path helpers with the smallest state-sync change.
- [ ] Run focused tests after the fix, then the frontend/static/build/documentation gates.
- [ ] Verify `/dts-reload` and `/node-debugging` with the real browser interaction at desktop, tablet, and mobile viewports; review the other shared consumers for regressions.
- [ ] Run independent Standards and Spec review, record findings, and resolve actionable findings before delivery.
- [ ] Archive this plan and its Chinese companion only after verification is complete, then create, check, merge, and verify the GitHub PR.

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
- Frontend regression: `npm test`.
- Static/build: `npm run lint -- --no-cache`, `npm run build`, and `git diff --check`.
- Documentation and coverage metadata: `npm run docs:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations`.
- Browser runtime: mock mode on `/dts-reload` and `/node-debugging`; snapshot and screenshot at `1440x900`, `768x1024`, and `390x844`; collapse/open/select interaction; console error check; layout/overflow review. Screenshots belong under `work/ui-checks/module-navigator-expansion-20260829/`.
- Server, database, and bridge suites are not changed by this frontend-only fix; PR CI remains the final repository-wide gate.

## Documentation Impact Matrix

| Surface | Impact | Planned action |
| --- | --- | --- |
| Active/completed execution plan | Update | Add this English plan and its Chinese companion while work is active; archive both after completion. |
| Frontend architecture map | Review | Review `docs/FRONTEND.md` and `docs/zh-CN/frontend.md` for the shared navigator consumer list; no product/API text change is expected. |
| Expansion/collapse design | Review | Review `docs/design-docs/2026-07-20-dts-topology-expand-collapse-design.md` and `docs/zh-CN/design-docs/2026-07-20-dts-topology-expand-collapse-design.md`; the fix restores the documented per-node model. |
| UI standards and quality | Review | Review `docs/design-docs/ui-design-system.md` and `docs/developer/ui-quality-checklist.md`; apply the existing interaction and browser gates. |
| Product/prototype behavior | No change | Review `docs/product-specs/prototype-functional-spec.md` and its Chinese counterpart; no user-facing workflow or terminology change. |
| Architecture/API | No change | Review `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, and API docs; no server seam or contract changes. |
| Quality/acceptance | Update via evidence only | Review the acceptance maps and matrices for the listed IDs; no new ID or operation evidence schema is needed. |
| Reliability, security, governance, operations | No change | No changes to `docs/RELIABILITY.md`, `docs/SECURITY.md`, `docs/runbooks/`, or governance contracts. |
| Generated artifacts and references | No change | No database/schema/generated-doc/reference artifact is affected. |

## Documentation Update Gate

- The English and Chinese plans remain semantically aligned and link to each other.
- The shared-consumer documentation and expansion/collapse design are reviewed before completion.
- The four existing acceptance/operation pairs above are recorded and the component regression is present.
- `npm run docs:check` passes after the active plans are archived; no same-name file remains in both `active/` and `completed/`.

## Git and PR workflow

Implementation is isolated on `fix/module-navigator-expansion-20260829`, based on the exact latest `main` SHA above. The feature branch owns source, tests, and plan evidence. After local verification and independent review, the parent agent creates the PR, waits for required checks, merges it with branch deletion, verifies the merge SHA and remote `main`, and fast-forwards the clean main worktree. The unrelated dirty worktree at `/Users/tzrea1/Develop/WiseEff` is preserved.

## Completion record

To be filled only after implementation, browser evidence, CI, merge, and clean-main synchronization are complete: PR number/URL, merge SHA, final verification commands, screenshot paths, console/network result, and any explicitly skipped target-environment evidence.
