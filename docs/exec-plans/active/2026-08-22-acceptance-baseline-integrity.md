# Acceptance Baseline Integrity Closeout

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-22-acceptance-baseline-integrity.md)
>
> Status: **Active**
>
> Tracker: TD-122

## Goal

Restore a reproducible repository-wide local acceptance baseline without hiding failures under unrelated feature closures. The fixed diagnostic starting inventory has two different evidence qualities:

- Darwin `npm run acceptance:visual` ran against a task-specific isolated database: 9 passed / 11 failed, split into 4 stale and 7 missing snapshots.
- `npm run acceptance:browser -- --mode local-non-hdc` ran from the TD-112 implementation worktree while it contained test-generated changes and used the existing shared local acceptance database: 109 passed / 29 planned skips / 18 failed across toolchain, permissions, knowledge, Xiaoze, and other shared-state fixtures.
- The failed full browser run had no publishable full evidence manifest. It is an inventory source, not proof that the 18 failures reproduce on a fresh database.

All 29 failures belong to TD-122. Wave 3 did not claim these commands as green; its four scoped operation/visual gates and implementation CI passed independently.

## Historical diagnostic inventory

This inventory is persisted so the first clean/fresh run has a fixed comparison set. It does not classify root causes or claim reproduction.

Visual stale snapshots (`e2e/quality/visual.quality.spec.ts:38`):

- `/` → `home-shell.png`
- `/parameter-review` → `parameter-review-workbench.png`
- `/logs` → `logs-workbench.png`
- `/debugging` → `debugging-simulator.png`

Visual missing snapshots:

- `/organization` → `organization.png`
- `/organization/members` → `organization-members.png`
- `captures the primary button hover state` → `state-button-primary-hover.png`
- `captures the primary button keyboard focus-visible state` → `state-button-primary-focus-visible.png`
- `captures the ModalDialog open state with backdrop` → `state-dialog-modal-open.png`
- `captures the data-table row hover state` → `state-table-row-hover.png`
- `captures the data-table sort header keyboard focus state` → `state-table-sort-header-focus.png`

Full browser failures from the historical Playwright result started at `2026-08-22T08:50:17.791Z`:

1. `debugging-simulator.acceptance.spec.ts` — `blocks node writes for non-writer roles in UI and forced API calls`
2. `knowledge.acceptance.spec.ts` — `uploads a file entry and sees its extraction status`
3. `log-analysis.acceptance.spec.ts` — `configures a domain result webhook and delivers a signed payload after a domain-bound analysis`
4. `parameter-topology.acceptance.spec.ts` — `governs specs, browses real topology, edits, maps identity, and gates publish`
5. `permissions-matrix.acceptance.spec.ts` — `enforces visible route permissions for Guest`
6. `permissions-matrix.acceptance.spec.ts` — `enforces visible route permissions for Hardware User`
7. `permissions-matrix.acceptance.spec.ts` — `enforces visible route permissions for Software User`
8. `permissions-matrix.acceptance.spec.ts` — `enforces visible route permissions for Hardware Committer`
9. `permissions-matrix.acceptance.spec.ts` — `enforces visible route permissions for Software Committer`
10. `permissions-matrix.acceptance.spec.ts` — `enforces visible route permissions for Admin`
11. `permissions.acceptance.spec.ts` — `loads users, shows role/status, and gates user governance to Admin`
12. `permissions.acceptance.spec.ts` — `lets Admin manage a non-self user in UI while denying non-Admin access`
13. `permissions.acceptance.spec.ts` — `protects API-mode user context with production bearer authentication`
14. `product-feedback.acceptance.spec.ts` — `blocks non-Admin feedback admin APIs and page access`
15. `project-configuration-workbench.acceptance.spec.ts` — `creates, compares, releases, and restores baselines in source context`
16. `xiaoze-action.acceptance.spec.ts` — `denies out-of-permission approval execution with a safe message`
17. `xiaoze-perception.acceptance.spec.ts` — `does not leak data for an out-of-scope project question`
18. `xiaoze-perception.acceptance.spec.ts` — `rejects unauthenticated xiaoze requests`

Ownership before fresh reproduction is deliberately narrow:

- The 11 visual items have no precise existing Open TD; TD-122 owns them. They do not expand TD-113 or TD-097 and do not reopen completed TD-095.
- The parameter-topology and project-configuration baseline failures are the two toolchain candidates. Their documented local `dts:toolchain:bootstrap` / `dts:toolchain:check` prerequisite fails closed; this inventory does not reopen TD-040, TD-043, or TD-042.
- The 15 debugging/knowledge/permission/product-feedback/Xiaoze failures may overlap TD-076's fixture/auth/runtime seams, but they remain TD-122 diagnostics until a fresh run proves that root cause.
- The one log-webhook failure used a root local environment without `.env.example`'s `LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true`; treat it as an acceptance-runner/environment parity candidate, not TD-116's crash-retry/outbox debt.

## Boundaries

- Use a task-specific PostgreSQL database whose name and absence are checked before creation. Never clean or mutate the shared developer database to make acceptance green.
- The first fresh run must persist the exact failed test titles, projects, routes, error classes, screenshots/traces, and whether each failure reproduces on `origin/main`.
- Review visual diffs. Do not bulk-update snapshots merely to obtain green output; each accepted image needs route/state/viewport evidence and console/network checks.
- Separate deterministic fixture/runtime defects from hardware, target-environment, live-provider, or deliberately skipped cases. Planned skips stay explicit and are not failures.
- Do not broaden TD-075 registry unification, TD-076 fixture consolidation, TD-100 HDC evidence, or TD-118 L2 latency into this plan. Link a failure to those rows only when evidence proves ownership; TD-122 remains responsible for the green baseline.

## Git & PR Workflow

- Branch from refreshed `main` as `codex/td-122-acceptance-baseline-integrity` in an isolated worktree.
- Implement and commit on the feature branch. The parent reviews, opens the PR, waits for every applicable CI job and Merge bar, merges, and refreshes local `main`.
- Keep snapshot changes, fixture/runtime repairs, and documentation evidence reviewable; split into multiple PRs if one review surface becomes too large, but keep TD-122 Open until the final merged-main run is green.

## Work

1. Run visual and full local non-HDC acceptance from a fresh isolated database and archive machine-readable Playwright results plus human-readable failure inventory.
2. Classify every one of the 11 + 18 starting failures as snapshot drift, deterministic fixture/runtime defect, product regression, or an incorrectly unplanned external dependency. Map overlaps to existing TDs without removing TD-122 ownership.
3. Fix one deterministic group at a time with a failing focused contract first. Preserve authz, audit, DB, toolchain, and evidence semantics; do not relax assertions to green a baseline.
4. Review and update only accepted visual snapshots on the supported platform. Prove the route, state, and viewport before and after each update.
5. Re-run both repository-wide suites on final merged main and validate the full evidence manifest. Remove the task database only after confirming its exact name and no active connections.

## Success criteria

- `npm run acceptance:visual` has zero failures on the documented supported platform, with every changed snapshot reviewed.
- `npm run acceptance:browser -- --mode local-non-hdc` has zero unplanned failures; only declared planned skips remain.
- `npm run acceptance:evidence -- --run <runDir>` validates the full run and every required operation ID.
- Focused tests for each repaired group, `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:quality`, `npm run docs:check`, and `git diff --check` pass.
- CI and Merge bar pass for every implementation PR; final merged-main rerun remains green before TD-122 moves to Completed.

## Documentation Impact Matrix

| Area | Status | Exact files / evidence |
| --- | --- | --- |
| Repository maps | No change | `AGENTS.md`; `docs/zh-CN/root/AGENTS.md`; `ARCHITECTURE.md`; `docs/zh-CN/root/ARCHITECTURE.md`; `docs/README.md`; `docs/zh-CN/README.md`. Acceptance baseline ownership does not move a repository entry point. |
| Planning / debt | Update | `docs/exec-plans/active/2026-08-22-acceptance-baseline-integrity.md`; `docs/zh-CN/exec-plans/active/2026-08-22-acceptance-baseline-integrity.md`; `docs/exec-plans/tech-debt-tracker.md`; `docs/zh-CN/exec-plans/tech-debt-tracker.md`; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`. |
| Product specs | Review | `docs/product-specs/index.md`; `docs/product-specs/product-spec.md`; `docs/zh-CN/product-specs/index.md`; `docs/zh-CN/product-specs/product-spec.md`. Record unchanged unless a reproduced failure proves a product-contract defect. |
| Architecture / domain | Review | `CONTEXT.md`; `docs/adr/README.md`; `docs/design-docs/full-stack-architecture.md`; `docs/zh-CN/design-docs/full-stack-architecture.md`. Record unchanged unless a repaired runtime/fixture seam changes a durable boundary. |
| Quality/testing | Update | `docs/QUALITY_SCORE.md`; `docs/zh-CN/QUALITY_SCORE.md`; `docs/design-docs/testing-strategy.md`; `docs/zh-CN/design-docs/testing-strategy.md`; `docs/developer/verification-matrix.md`; `docs/zh-CN/developer/verification-matrix.md`; `playwright.quality.config.ts`; `playwright.acceptance.config.ts`. Update only when platform, baseline, or runtime-gate semantics change. |
| Acceptance registry/evidence | Review | `e2e/acceptance/requirements.ts`; `e2e/acceptance/operationMatrix.ts`; `docs/developer/browser-acceptance-coverage-map.md`; `docs/zh-CN/developer/browser-acceptance-coverage-map.md`; `docs/developer/user-operation-coverage-matrix.md`; `docs/zh-CN/developer/user-operation-coverage-matrix.md`; `e2e/acceptance/helpers/evidence.ts`; `e2e/acceptance/helpers/evidenceRun.ts`; `docs/generated/acceptance-browser-evidence.md`; `docs/generated/acceptance-operation-evidence.md`; `docs/generated/acceptance-operation-evidence/index.json`. |
| Fixtures/runtime | Review | `e2e/acceptance/debugging-simulator.acceptance.spec.ts`; `e2e/acceptance/knowledge.acceptance.spec.ts`; `e2e/acceptance/log-analysis.acceptance.spec.ts`; `e2e/acceptance/parameter-topology.acceptance.spec.ts`; `e2e/acceptance/permissions-matrix.acceptance.spec.ts`; `e2e/acceptance/permissions.acceptance.spec.ts`; `e2e/acceptance/product-feedback.acceptance.spec.ts`; `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`; `e2e/acceptance/xiaoze-action.acceptance.spec.ts`; `e2e/acceptance/xiaoze-perception.acceptance.spec.ts`; `e2e/acceptance/helpers/database.ts`; `playwright.acceptance.config.ts`. Change only evidence-owned seams after the fresh inventory proves ownership. |
| Visual baselines | Review | `e2e/quality/visual.quality.spec.ts`; `e2e/quality/visual.quality.spec.ts-snapshots/darwin/`; `e2e/quality/visual.quality.spec.ts-snapshots/linux/`; `e2e/quality/visual.quality.spec.ts-snapshots/win32/`. Change only reviewed route/state/viewport snapshots. |
| Reliability / runbooks | Review | `docs/RELIABILITY.md`; `docs/zh-CN/RELIABILITY.md`; `docs/runbooks/manual-acceptance.md`; `docs/zh-CN/runbooks/manual-acceptance.md`. Record unchanged unless a reproduced failure changes an operator prerequisite or runtime gate. |
| Security / governance | Review | `docs/SECURITY.md`; `docs/zh-CN/SECURITY.md`; `docs/security/README.md`; `docs/zh-CN/security/README.md`; `scripts/check-doc-governance.ts`; `scripts/check-doc-governance.test.ts`. Preserve authz and evidence-redaction semantics. |
| Frontend / design | Review | `docs/FRONTEND.md`; `docs/zh-CN/frontend.md`; `docs/design-docs/ui-design-system.md`; `docs/zh-CN/design-docs/ui-design-system.md`; `docs/developer/ui-quality-checklist.md`; `docs/zh-CN/developer/ui-quality-checklist.md`. Update only for an accepted visible/interaction contract change. |
| API / generated artifacts | No change | `docs/api/README.md`; `docs/zh-CN/api/README.md`; `docs/design-docs/api-contract.md`; `docs/zh-CN/design-docs/api-contract.md`; `docs/generated/openapi.json`. A baseline repair must not silently change HTTP contracts. |
| References | Review | `docs/references/productization-api-contract-draft.md`; `docs/references/pi-agent-provider-evidence.md`. Record unchanged unless a reproduced failure exposes a stale current-runtime reference. |

## Documentation Update Gate

- Persist the exact per-test failure inventory from a fresh run before editing product or snapshots.
- Every changed snapshot has explicit review evidence; no bulk acceptance.
- Every deferred/external item remains linked to an Open tracker row and is not counted as green.
- Both full suites and the full evidence manifest pass on final merged main.
- Every Update/Review row is changed or explicitly recorded unchanged; EN/ZH companions stay aligned; `npm run docs:check` and `git diff --check` pass before this plan moves to `completed/`.
