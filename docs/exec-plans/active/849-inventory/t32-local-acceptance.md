# T3.2 local acceptance — progress receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t32-local-acceptance.md)

Status: **local-non-HDC Gate0 and smoke are green. T3.2 as a whole row is not complete.** Gate0 `beab90bc9` / run `full-20260918t224937833z-beab90bc9cec-5f49a8e9` / helper PG **55438**: visual **passed**, browser **passed**, inventoried failures **0**, operation-evidence **passed**. Smoke on `58dab25a4` / :5174/:18787 / `wiseeff_t32`: **4 passed**. `acceptance:quality`, `acceptance:coverage`, and `acceptance:operations` **passed** (`missingRequiredIds: []`, `coverageMapOrphanIds: []`, `missingAutomatedOperationIds: []`). target-synthetic-acceptance and minimal-upgrade remain unavailable (recorded below). Not SEALED. Not pushed. No PR/Hosted. T3.4a remains the seal point. Do not start T3.3a from this receipt.

HEAD: `58dab25a4` on `codex/849-853-t11-source-identity`. Ingest-on-add stays reverted. Hotspots page is inset from the Xiaoze launcher so PARAM-HOME-001 does not sit under the FAB.

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
| `npm run acceptance:quality` | **passed** on current HEAD (metadata: scripts + spec files present) |
| `npm run acceptance:coverage` | **passed**; `missingRequiredIds: []`; `coverageMapOrphanIds: []`; `skippedRequiredIds: []` |
| `npm run acceptance:operations` | **passed**; `missingAutomatedOperationIds: []` |
| `acceptance:smoke` on :5174/:18787 / `wiseeff_t32` / `58dab25a4` | **4 passed** (warmup + auth + parameter-home + shell). Owned ports, HMAC from committed `.env.example`, not host 5173/8787. First smoke failed because the last hotspot row sat under the Xiaoze launcher; hotspots page inset in `f96d85af4`/`58dab25a4`. |
| focused Playwright (handoff, roles, readiness, lock, promote) | **all passed** on the same owned runtime after the lock/promote fixes |
| `npm run dts:toolchain:check -- --required` | **passed** (dtc 1.8.1, fdtoverlay 1.8.1, dtschema 2026.6) |
| Local commit `8b517b930` | **done.** 523 files. Message: `feat(parameters): snapshot 849/853 Scratch for local Gate0`. Not pushed. |
| `LANG=C LC_ALL=C npm run acceptance:gate0` on `8b517b930` / PG **55438** | **failed after full provision.** Run `full-20260918t071307751z-8b517b9303de-7afcdd88`, DB `wiseeff_acceptance_full_20260918t07130775_8b517b93_7afcdd88`. Visual **7 failed / 13 passed**. Browser **32 failed / 33 skipped / 141 passed**. Inventory **39** failures. Artifacts retained. Not a skip-as-pass. |
| T3.2 specs inside that Gate0 browser phase | HANDOFF, verified PROMOTE, LOCK, ROLES, READINESS **passed**. Unverifiable PROMOTE **failed** (`reload-promote-node-drift`, recorded `/td079_cell` vs current `null`). Picker now requires a non-empty node locator (uncommitted follow-up). |
| Gate0 visual triage | **reviewed.** 7 darwin baselines updated from that run's actuals: `/parameters` (omitted 带到参数调试 + SearchField icon), `/parameter-review` (canonical review copy), `/parameter-admin` (catalog page + inspect/adopt banner), `/organization/members` (组织角色 / 项目职责 / 注销 / username), Xiaoze popup (same workbench behind it), members row hover and sort-header focus. Magenta regions are Playwright `mask`. Linux snapshots **not** copied from darwin actuals. |
| Local commit `5975f0cce` | **done.** Visual darwin baselines + shared locator/FK/diagnostics repairs. Not pushed. |
| `LANG=C LC_ALL=C npm run acceptance:gate0` on `beab90bc9` / PG **55438** | **passed.** Run `full-20260918t224937833z-beab90bc9cec-5f49a8e9`. Visual **passed**. Browser **passed**. Inventory **0**. Operation-evidence **passed**. Runtime cleanup completed. Not a skip-as-pass. |
| `LANG=C LC_ALL=C npm run acceptance:gate0` on `5975f0cce` / PG **55438** | **failed after provision.** Run `full-20260918t083648303z-5975f0cceec4-679690ef`. Visual **passed**. Browser **14 inventoried failures**. Artifacts retained. Not a skip-as-pass. |
| Mis-aimed Gate0 on `/Users/tzrea1/Develop/WiseEff` `46b60686` | **killed.** Not worktree evidence. WiseEff porcelain stayed 0. |
| Catalog view-only follow-up (dirty) | `DefinitionEditorBody` now shows subject/definition ids, documentation, usage, and 查看历史 without authoring. `DefinitionEditorBody.test.tsx` **4 passed**. |
| Local commit `4ddac4c15` | Catalog view-only history + ingest-on-add + Xiaoze locator. |
| `LANG=C` Gate0 on `4ddac4c15` / PG **55438** | **failed.** Run `full-20260918t091649761z-4ddac4c158b4-2d0378a7`. Visual **passed**. Browser **41** failures. Config-set file add returned INTERNAL_ERROR 500. |
| Local commit `66cae3c0b` | **Reverted ingest-on-add.** Membership POST is membership-only again. |
| First Gate0 attempt (session locale) | **failed before provision**: Chinese `ps -o lstart=` (`五  9月/18 …`) vs `process-start-identity.ts`. |
| Second Gate0 attempt (LANG=C, dirty tree) | **failed at source inspection**: `Owned runtime requires a clean source worktree`. |
| target-synthetic-acceptance | **unavailable, not skipped-as-pass.** No target frontend/API URLs or auth secrets in this session (`WISEEFF_ACCEPTANCE_FRONTEND_URL` and target URL env names unset). CI `target-synthetic-acceptance` is workflow_dispatch against a live target with `--no-start-runtime`. |
| minimal-upgrade | **unavailable, not skipped-as-pass.** `scripts/run-minimal-upgrade-acceptance.ts` requires a sealed HEAD, native Docker `linux/x86_64`, and the daemon id. This host is `linux/aarch64` / arm64; T3.4a has not sealed this Scratch; no `workflow_dispatch` `acceptance_mode=minimal-upgrade` was authorized. |

## Remaining program boundary

T3.2 is not a complete local-acceptance row. Local-non-HDC Gate0 on `beab90bc9` is green; smoke/quality/coverage/operations on later HEAD `58dab25a4` are green. Pickup list for later environments: [t32-remaining-verification.md](t32-remaining-verification.md) (target-synthetic-acceptance and minimal-upgrade). Those rows are not pass. T3.3a Docker/S2 started separately; T3.3b target, T3.4a seal, T3.4b PR/Hosted/merge, T3.5 Issue close are unchanged.
