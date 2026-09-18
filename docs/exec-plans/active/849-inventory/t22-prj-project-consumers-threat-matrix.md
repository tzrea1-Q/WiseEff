# T2.2-PRJ project consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-prj-project-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-PRJ, [API transition](../../../design-docs/parameter-catalog-api-transition.md) workbench row, T2.1 [acceptance](t21-parameter-ui-acceptance.md), T2.2-TOP [acceptance](t22-top-topology-consumers-acceptance.md). Product direction (eleven families, classify, repair then ratchet, vs 3513) is decided. This matrix freezes the PRJ implementation boundary.

Status: **independent Spec review PASS with P2.** P2s folded here. Companion: [implementable design](t22-prj-project-consumers-design.md).

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-TOP remain uncommitted dirty candidates; do not rewrite except PRJ-owned paths.
- Allowed paths: `server/modules/parameters/**`, `server/modules/parameter-drafts/**`, `ParameterRepository.ts`, `parameterClient.ts`, `parameterDtos.ts`, their tests, `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`, in-family mock `mockParameterRepository.ts`.
- Stop after T2.2-PRJ. No T2.2-FIL or later, T1.4, T3.x, commit, PR, merge, Issue mutation.
- Viewport 1440x900 only if a visible workbench/init surface changes. Default: no sweep if only hydration URLs change and `/parameters` tray already uses v2.
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable only. Never `wiseeff_lane_849`, never `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or `wiseeff_t22_prj`.

## Invariant under protection

Every S12-PRJ runtime read, write and reference is classified as **canonical current**, **exact canonical history**, or **authorized archived notice**. Project workbench current values and pending drafts are identified by **binding / `currentValueId` / v2 project-value-drafts**, not `parameterSpecId` as definition identity and not v1 `/parameter-drafts/mine` as the live tray owner. Initialized / uninitialized / custom (empty-library) project states stay the initialization HTTP. Repair before deleting an allowance. PARAM-INIT Playwright remains **future** (T3.2); this todo does not claim those e2e owners. Comparison adapters are not switched consumers.

## Intake (measured 2026-09-17)

Shards still total **3513**. S12-PRJ `s12-prj.json` has **422** entries:

| Kind | Count | Notes |
| --- | --- | --- |
| `server/modules/parameters/**` production | 225 | `reviewWorkflowRepository.ts` 50, `service.ts` 29, `parameterModuleRepository.ts` 24 |
| `server/modules/parameter-drafts/**` | 43 | `repository.ts` 36 |
| Tests | 152 | lifecycle/init/import/dashboard |
| Port `ParameterRepository.ts` | 2 | `parameterSpecId` on draft/submit types |
| `parameterClient.ts` / `parameterDtos.ts` / e2e workbench | 0 shard rows | Client still calls v1 drafts; workbench e2e has no catalog tokens |
| Mock `mockParameterRepository.ts` | 0 shard rows | In-family mock port |

Rules: `legacy-parameter-spec-identifier` 138, `legacy-catalog-raw-read` 130, `unresolved-boundary-expression` 71, `legacy-catalog-sql-write` 70, `legacy-catalog-table-name` 10, `legacy-catalog-module-import` 3.

T2.1 B5 tray already lists/deletes `GET|DELETE /api/v2/projects/:projectId/parameter-value-drafts`. `parameterRuntime.refresh` still `listDrafts()` → `GET /api/v1/parameter-drafts/mine` with no projectId. `saveDraft` in semantic mode already 409 (“create a typed binding draft”). T2.1 helper still `DELETE /api/v1/parameter-drafts/:id`; do not 410 that this todo. `semanticParameterReads` already lists `b.id` (binding id) as the workbench parameter id. Initialization HTTP (`/api/v1/parameters/projects/:projectId/initialization*`) is live; PARAM-INIT-* coverage is `future`.

## Classification freeze

| Class | Meaning in PRJ | This todo |
| --- | --- | --- |
| Canonical current — workbench | List/get parameters by binding id; v2 project-value-drafts list/delete; change-requests/submit | **Keep / retarget client to v2 drafts** |
| Canonical current — initialization | Init draft/preview/submit/approve/reject/empty-library | **Keep 2xx**. Spec ids inside init are DTS until T1.4 |
| Canonical current — DTS spec field | `parameterSpecId` on submit/init snapshots | Keep field; not Catalog Definition identity |
| Exact canonical history | tests, dashboard adapters, comparison contribution | Keep allowances |
| Archived notice | Workbench **live** owner of pending drafts is not v1 `/mine` | Client/runtime stop using v1 mine when `projectId` is known. Do **not** 410 v1 GET/DELETE this todo (T2.1 helper) |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22P-01 | Inventory | 422 entries classified by file×rule into four labels | receipt table |
| T22P-02 | Canonical values | Workbench list/get uses binding id (`semanticParameterReads.b.id`), not spec-as-parameter | no identity rewrite of `b.id` |
| T22P-03 | Draft hydration | `parameterClient.listDrafts(projectId)` and `refresh` after projects load hit v2 `parameter-value-drafts`, not v1 `/mine` | client + runtime tests |
| T22P-04 | Draft delete | `discardDrafts` / `deleteDraft` with projectId uses v2 DELETE (server already unions topology) | client tests |
| T22P-05 | v1 saveDraft | Semantic mode stays CONFLICT (typed binding draft successor). Do not 410 v1 GET/DELETE | existing service tests |
| T22P-06 | Init states | uninitialized / pending-review / initialized / empty-library (custom) stay on init HTTP | existing `initializationService.test.ts` |
| T22P-07 | PARAM-INIT e2e | Remain `coverage: "future"` (T3.2). Do not claim Playwright this todo | receipt |
| T22P-08 | Submit `parameterSpecId` | Stay allowed on binding submit items (T2.1 still sends it). Do not make it the workbench row id | no T2.1 fixture churn |
| T22P-09 | Mock | `mockParameterRepository` keeps in-memory drafts; no mock-only spec-as-definition | no mock mint |
| T22P-10 | Comparison | `parameterCatalogComparisonContribution.ts` stays an adapter | no production read through it |
| T22P-11 | Ratchet | Repair first; delete only vanished PRJ tokens. vs 422/3513. Honest zero delta allowed | shard + checker if runnable |
| T22P-12 | UI | 1440x900 only if visible workbench draft table changes. `/parameters` tray already v2 | optional |
| T22P-13 | Environment | 55438 disposable | receipt |
| T22P-14 | Non-goals | T2.2-FIL…OPS, T1.4, PARAM-INIT Playwright, Hosted, commit | receipt |

## Non-goals

- Zeroing 422 PRJ allowances.
- 410 on v1 `/parameter-drafts/mine` or v1 DELETE (T2.1 helper).
- PARAM-INIT Playwright owners (T3.2).
- Removing `parameterSpecId` from submit schema (T2.1 still sends it).
- File sync/writeback (T2.2-FIL).
- Rekeying topology binding tuple (T2.2-TOP/T1.4).
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits.
