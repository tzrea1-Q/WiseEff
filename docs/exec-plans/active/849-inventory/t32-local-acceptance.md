# T3.2 local acceptance — progress receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t32-local-acceptance.md)

Status: **local candidate, not green for the full T3.2 row.** Missing required Playwright scenarios are implemented. Smoke/coverage/operations passed earlier on `wiseeff_t32`. A **local-only** commit `8b517b9303ded564edd57c3ca31ede06b5c5cf51` was made so Gate0 could see a clean tree. Gate0 then ran and **failed** (visual 7, browser 32, 39 inventoried failures). Visual darwin baselines for those 7 shots are now updated after review. Shared browser locator/FK/diagnostics repairs are in the dirty tree and **not yet re-run through Gate0**. Not SEALED. Not pushed. No PR/Hosted/target/Issue update. T3.4a remains the seal point.

HEAD at Gate0 provision: `8b517b9303ded564edd57c3ca31ede06b5c5cf51` on `codex/849-853-t11-source-identity`. Tree is dirty again with snapshot/test repairs.

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
| Local commit `8b517b930` | **done.** 523 files. Message: `feat(parameters): snapshot 849/853 Scratch for local Gate0`. Not pushed. |
| `LANG=C LC_ALL=C npm run acceptance:gate0` on `8b517b930` / PG **55438** | **failed after full provision.** Run `full-20260918t071307751z-8b517b9303de-7afcdd88`, DB `wiseeff_acceptance_full_20260918t07130775_8b517b93_7afcdd88`. Visual **7 failed / 13 passed**. Browser **32 failed / 33 skipped / 141 passed**. Inventory **39** failures. Artifacts retained. Not a skip-as-pass. |
| T3.2 specs inside that Gate0 browser phase | HANDOFF, verified PROMOTE, LOCK, ROLES, READINESS **passed**. Unverifiable PROMOTE **failed** (`reload-promote-node-drift`, recorded `/td079_cell` vs current `null`). Picker now requires a non-empty node locator (uncommitted follow-up). |
| Gate0 visual triage | **reviewed.** 7 darwin baselines updated from that run's actuals: `/parameters` (omitted 带到参数调试 + SearchField icon), `/parameter-review` (canonical review copy), `/parameter-admin` (catalog page + inspect/adopt banner), `/organization/members` (组织角色 / 项目职责 / 注销 / username), Xiaoze popup (same workbench behind it), members row hover and sort-header focus. Magenta regions are Playwright `mask`. Linux snapshots **not** copied from darwin actuals. |
| Shared browser repairs (dirty, not Gate0-rerun) | SearchField clear `aria-label` is `清空输入`; catalog clear copy is `清空筛选`; 搜索 locators use `exact: true`; knowledge picker uses `searchbox`; permissions filter uses `searchbox`; candidate rows deleted before `project_parameter_files`; isolated delivery M1 skipped unless `WISEEFF_CATALOG_DELIVERY_EVIDENCE` is set; shell/debugging/import expect GET `parameter-review-items` 403/410; catalog user without Admin sees `无权访问`; unadopted publication dialog asserts the inspect/adopt blocker instead of the subject picker; debugging non-writer API user is `guest`; catalog rewrite import audit keeps `reviewMetadata`; isolated binding seed and Xiaoze wait require a non-empty node locator; `/parameter-admin` topology UI asserts Catalog not `参数定义库`. `SearchField.test.tsx` + `CatalogPage.test.tsx` **22 passed**. |
| First Gate0 attempt (session locale) | **failed before provision**: Chinese `ps -o lstart=` (`五  9月/18 …`) vs `process-start-identity.ts`. |
| Second Gate0 attempt (LANG=C, dirty tree) | **failed at source inspection**: `Owned runtime requires a clean source worktree`. |
| target-synthetic-acceptance | **not run**. No target frontend/API URLs or auth secrets in this session. |
| minimal-upgrade | **not run**. Driver needs a sealed candidate SHA and Docker daemon id; T3.4a has not sealed this Scratch. |

## Remaining program boundary

T3.2 is not a complete local-acceptance row. Gate0 provisioned and executed; visual baselines are updated locally, and shared browser locator/FK/diagnostics repairs are uncommitted. Remaining Gate0 browser clusters still include catalog not-adopted / missing `catalog:author` on the publication dialog, `/parameter-admin` catalog replacing `参数定义库`, overlay ingest timeouts (`enable_*`, Xiaoze `iin_max`), `missing-logical-node-revision`, dts-structured writeback/RBAC, knowledge/catalog 90s timeouts, and PARAM-IMPORT `skippedRows`. Do not treat 141 browser passes as a Gate0 pass. A later Gate0 retry needs another clean commit after remaining repairs. No push/PR/Hosted. T3.3a Docker/S2, T3.3b target, T3.4a seal, T3.4b PR/Hosted/merge, T3.5 Issue close are unchanged.
