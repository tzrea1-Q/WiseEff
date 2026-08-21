# Deterministic tech-debt parallel closeout

> Status: **Active**  
> Date: 2026-08-22  
> Planning branch: `docs/deterministic-td-parallel-closeout-plan`  
> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout.md)  
> Tracker: [Technical Debt Tracker](../tech-debt-tracker.md)

## Goal

Close three independent tracker rows that need neither hardware, target-environment evidence, expert-labelled logs, nor an unresolved product decision:

- **TD-059** — migrate the final two in-scope parameter dialogs to the shared `ModalDialog` contract.
- **TD-071** — move the two legacy M1 seed integration suites onto the current per-worker test harness and remove stale shared-database cleanup/timeout exceptions.
- **TD-073** — complete the shared frontend test-harness adoption at real application/port seams without converting valid component-props tests into full-App tests.

The batch optimizes for independent ownership and complete closure. A track does not close its TD until its focused and full gates pass and the final documentation closeout has landed.

## Assumptions and fixed decisions

- `origin/main` at planning time is `cc2779e5`.
- The three implementation branches start from the same refreshed `origin/main` after this plan merges.
- Implementation agents own code and track-specific tests only. Shared tracker and plan files are owned by the parent closeout branch after the implementation PRs merge.
- TD-059 is a modal-primitive migration, not a product-flow redesign. `DtsReloadCandidateEditDialog` remains outside its scope.
- TD-071 keeps the existing four PostgreSQL integration behaviours as characterization seams. Performance is proven by repeated runs, not a flaky wall-clock assertion.
- TD-073 closes adapter and assembly duplication. `DtsParameterWorkbench.test.tsx` remains a component-props seam because it has no duplicated IO repository.

## Non-goals

- Hardware, HDC/ADB, bridge routing, device writes, or target-environment evidence.
- TD-077 stylesheet/source-text assertion cleanup, TD-112 table convergence, TD-113 token burns, or adjacent production refactors.
- Changes to server contracts, database migrations, OpenAPI, or acceptance registries for TD-059.
- Production seed-pipeline or test-database-harness changes for TD-071.
- Converting every page/component test into an App integration test for TD-073.

## Git & PR Workflow

This portfolio plan deliberately has parallel sibling branches. Each implementation agent commits only on its assigned branch and does not open or merge a PR. The parent reviews, opens each PR, merges it after green CI, refreshes the remaining branches, then lands the shared documentation closeout.

| Track | Branch | Owner files | Explicit exclusions |
| --- | --- | --- | --- |
| TD-059 | `fix/td-059-dialog-contract` | `DtsBindingHistoryDiffDialog*`, `DtsNodeEnablementDialog*`, narrowly related `DtsBindingDetailDialog*`, scoped dialog CSS | No tracker/plan edits; no reload sheet; no page-harness files |
| TD-071 | `test/td-071-seed-test-harness` | `seedM1BindingRevisionHistory.integration.test.ts`, `seedM1SemanticTopology.integration.test.ts` | No production seed/harness files; no tracker/plan edits |
| TD-073 | `test/td-073-render-harness-closeout` | `src/test/harness/**` and the six audited page/workbench test files | No production behaviour; no TD-059 component files; no tracker/plan edits |
| Shared closeout | `docs/deterministic-td-parallel-closeout` | EN/ZH tracker, this plan and PLANS indexes | No implementation changes |

Before each merge, fetch `origin/main`, rebase, run `npx tsc -b` plus affected tests, and re-check shared TD/plan state. Merge order is TD-071, TD-073, TD-059, then shared documentation closeout; the first two minimize UI drift before browser verification.

## TDD seams

These seams are fixed before implementation:

1. **TD-059 modal DOM/interaction seam** — accessible dialog name/description, shared backdrop/card structure, focus entry/trap/return, topmost Escape, safe backdrop dismissal, and busy-state non-dismissability. Existing node enablement domain assertions remain unchanged.
2. **TD-071 PostgreSQL integration seam** — semantic topology attribution/idempotency and binding revision history/object-byte/idempotency through the existing public seed entrypoint.
3. **TD-073 application and port seams** — `renderApp` for App routes; page props plus stable TopBar context for page tests; fresh production mock adapters wrapped by observable/overrideable test repositories; typed component props for `DtsParameterWorkbench`.

Every track starts with a red contract/sensitivity test, implements one vertical slice at a time, and avoids real sleeps.

## Tasks

### Track A — TD-059

1. Add red component tests for the shared modal structure, nested Escape/focus return, and busy-state dismissal guard.
2. Migrate history diff and node enablement to `ModalDialog` while preserving business copy and actions.
3. Remove Radix-specific z-index/overlay assumptions; add only scoped responsive/chrome CSS.
4. Run focused/full frontend gates, existing `PARAM-ENABLE-TOGGLE-001` / `PARAM-ENABLE-GUARD-001` acceptance, and `playwright-cli` QA at 1440×900, 768×1024, and 390×844.

### Track B — TD-071

1. Characterize the four current integration behaviours.
2. Replace local minimal graph/object-store doubles with `seedCoreGraph` and `createMemoryObjectStore`.
3. Remove stale cross-domain cleanup, shared-database comments, and 60-second per-test overrides.
4. Repeat the focused suite with four workers, then run the full server suite.

### Track C — TD-073

1. Add contract tests for new harness factories: production mock adapter by default, fresh state, observable methods, and winning overrides.
2. Migrate App routes and shared log/debug runtime actions at their public seams.
3. Add structured/file repository factories and migrate the project-configuration/API-topology tests incrementally.
4. Record `DtsParameterWorkbench` as an audited component-props seam; retain its scenario coverage.
5. Run the six-file set, harness tests, then full frontend test/build/lint gates.

### Shared closeout

1. After all implementation PRs merge, move TD-059, TD-071, and TD-073 from Open to Completed in both tracker languages with exact evidence and PR links.
2. Update the older launch closeout plan where it still lists these rows as open.
3. Move this plan from `active/` to `completed/` in both languages and update both PLANS indexes.
4. Run documentation, contract, UI, build, full frontend/server, and diff gates from refreshed `main` as proportionate to the merged changes.

## Success criteria

- Three independently reviewable implementation PRs merge without cross-track code conflicts.
- TD-059 has no in-scope imports from `@/components/ui/dialog` and passes real browser focus/stack/responsive checks.
- TD-071 uses the shared server test factories, has no bespoke topology reset or timeout exception, and remains stable under repeated multi-worker execution.
- TD-073 has no remaining full App render outside `renderApp`, no duplicated complete IO adapter in the six audited files, and documents the valid component-props seam.
- Standards and Spec reviews report zero remaining findings for each implementation diff.
- Both tracker languages list all three rows under Completed, and this plan is archived only after every documentation gate passes.

## Verification

```bash
npx tsc -b
npm test
npm run test:server
npm run build
npm run lint
npm run ui:check
npm run docs:check
npm run contract:check
git diff --check
```

Track-specific commands and browser evidence paths are recorded in the implementation PRs and the final tracker rows.

## Documentation Impact Matrix

| Area | Status | Files / evidence |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`; no navigation change expected |
| Planning | Update | this EN/ZH plan, `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, older launch closeout plan |
| Technical debt | Update | EN/ZH `tech-debt-tracker.md` rows TD-059/071/073 |
| Product specs | No change | no user workflow or product decision changes |
| Architecture/domain | Review | modal/test seams only; no production architecture change expected |
| Quality/testing | Review | tracker/plan evidence; update durable testing docs only if the harness contract changes materially |
| Reliability/runbooks | No change | no runtime or operator workflow change |
| Security/governance | No change | no authz, audit, secret, or device-write change |
| Frontend/design | Update | EN/ZH `FRONTEND` only if TD-059 removes the final documented exception; UI checklist evidence in PR |
| API/generated artifacts | No change | no API or schema changes |
| References | Review | no reference update expected |

## Documentation Update Gate

The batch cannot be marked complete until:

- every Update/Review row above is either updated or recorded unchanged with evidence;
- EN/ZH tracker and plan state agree;
- this plan filename exists only under `completed/` after closure;
- `npm run docs:check` and `git diff --check` pass on the closeout branch;
- frontend-visible TD-059 evidence records route, viewports, interactions, screenshots, console/network checks, and issues found/fixed.
