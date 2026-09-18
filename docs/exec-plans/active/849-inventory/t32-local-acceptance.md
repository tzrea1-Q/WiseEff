# T3.2 local acceptance — progress receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t32-local-acceptance.md)

Status: **local candidate, not green for the full T3.2 row.** Missing required Playwright scenarios are implemented and focused-run. Smoke, coverage, and operations passed on a dedicated helper-PG database. Gate0 did not provision: first retry failed on Chinese `ps -o lstart=` identity parsing; with `LANG=C` identity capture succeeded, then Gate0 refused the dirty Scratch (`git status --porcelain` has 523 paths). Target-synthetic and minimal-upgrade were not executed. Not SEALED. No commit, PR, Hosted, target, or Issue update. T3.4a remains the seal point.

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e` plus uncommitted Scratch through T3.1 and this T3.2 work.

## Environment

- Helper PG **55438** / disposable `wiseeff_t32` (created, migrated 0001–0159, seeded M0+M1). Not `wiseeff_lane_849`. Not compose `5432/wiseeff`. Not `wiseeff_t23b`.
- Owned smoke/browser ports **127.0.0.1:5174** (frontend, inside CORS 5173–5199) and **127.0.0.1:18787** (API). Did not reuse host 5173/8787.
- Object store for promote: worktree `.wiseeff-object-store` (M1 seed bytes). `/tmp/wiseeff-t32-objects` was used only for smoke.

## Missing required scenarios implemented

| ID | Spec | Notes |
| --- | --- | --- |
| `PROJ-REVIEW-ROLES-001` | `e2e/acceptance/project-review-roles.acceptance.spec.ts` | Deep-link, search, ConfirmDialog, PUT. `required: false`. |
| `PROJ-REVIEW-READINESS-001` | same file | Initialized custom project, staged drafts, missing 3-pool roles, non-admin contact copy, Admin config link, drafts retained. `required: true`. |
| `PARAM-INIT-LOCK-001` | `e2e/acceptance/parameter-initialization-lock.acceptance.spec.ts` | 409 submission-round lock + workbench `初始化待审阅` copy. App now hydrates initialization from the `/parameters?project=` URL. |
| `DTS-RELOAD-HANDOFF-001` | `e2e/acceptance/dts-reload-handoff.acceptance.spec.ts` | Deep-link banner, no auto-fill of `本轮重载`. Does not restore the omitted workbench button. |
| `DTS-RELOAD-PROMOTE-001` | `e2e/acceptance/dts-reload-promote.acceptance.spec.ts` | Verified ordinary run promotes; unverifiable run requires ConfirmDialog acknowledgement; no change request. |

Canonical value drafts now load workflow-role candidates and block submit when pools are missing (tray still omits assignee dropdowns). Coverage-map orphans `PROJ-REVIEW-*` are reconciled (`coverageMapOrphanIds: []`).

## Verification (do not sum)

| Command | Result |
| --- | --- |
| `npm test -- DtsBindingDraftTray.test.tsx ApiProjectTopologyWorkspace.test.tsx` | **53 passed** |
| `npm test -- src/App.test.tsx` | **143 passed** |
| `npm run ui:check` | **passed** |
| `npm run acceptance:quality` | **passed** (metadata only: scripts + spec files present) |
| `npm run acceptance:coverage` | **passed**; `missingRequiredIds: []`; `coverageMapOrphanIds: []`; `skippedRequiredIds: []` |
| `npm run acceptance:operations` | **passed**; `missingAutomatedOperationIds: []` |
| `acceptance:smoke` on :5174/:18787 / `wiseeff_t32` | **4 passed** (warmup + auth + parameter-home + shell) |
| focused Playwright (handoff, roles, readiness, lock, promote) | **all passed** on the same owned runtime after the lock/promote fixes |
| `npm run dts:toolchain:check -- --required` | **passed** (dtc 1.8.1, fdtoverlay 1.8.1, dtschema 2026.6) |
| `LANG=C LC_ALL=C npm run acceptance:gate0` | **failed at source inspection, after DTS prerequisite passed.** `readProcessStartIdentity` works under `LANG=C` (`Fri Sep 18 15:06:13 2026`). Provision then threw `Owned runtime requires a clean source worktree before provisioning.` HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`, porcelain **523** paths. Gate0 has no dirty-tree bypass. Not a skip-as-pass. |
| First Gate0 attempt (session locale) | **failed before provision**: Chinese `ps -o lstart=` (`五  9月/18 …`) does not match `process-start-identity.ts`. Not a toolchain absence. |
| target-synthetic-acceptance | **not run**. No target frontend/API URLs or auth secrets in this session. |
| minimal-upgrade | **not run**. Driver needs a sealed candidate SHA and Docker daemon id; T3.4a has not sealed this Scratch. |

## Remaining program boundary

T3.2 is not a complete local-acceptance row until Gate0/local-non-HDC, operation-evidence/artifact-safety on that owned run, and an honest target/minimal-upgrade record exist. Gate0 cannot provision this Scratch until the tree is clean; that needs a **separate commit authorization** (this program still forbids commit/PR/seal here). Do not stash/reset/checkout to fake cleanliness. Do not weaken `readCleanSource`. T3.3a Docker/S2, T3.3b target, T3.4a seal, T3.4b PR/Hosted/merge, T3.5 Issue close are unchanged.
