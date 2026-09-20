# T2.2-FIL file consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-fil-file-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-FIL, [API transition](../../../design-docs/parameter-catalog-api-transition.md) file sync/writeback row, T2.2-PRJ [acceptance](t22-prj-project-consumers-acceptance.md). Product direction (eleven families, classify, repair then ratchet, vs 3513) is decided. This matrix freezes the FIL implementation boundary.

Status: **Spec PASS with P2 folded.** Companion: [implementable design](t22-fil-file-consumers-design.md). Independent review `01a0afa4-6152-77c2-947b-87f66c9304aa`.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-PRJ remain uncommitted; do not rewrite except FIL-owned paths.
- Allowed paths: `server/modules/parameter-files/**` (including `syncService.ts`, `schemas.ts`, `candidateRepository.ts`), `ParameterFileRepository.ts`, `parameterFileClient.ts`, `parameterFileClient.test.ts`, `e2e/acceptance/parameter-files.acceptance.spec.ts`, in-family mock `mockParameterFileRepository.ts`, and `scripts/parameter-catalog-allowlist/shards/s12-fil.json` for ratchet. Classify in-family; do not steal AGT.
- Stop after T2.2-FIL. No T2.2-AGT or later, T1.4, commit, PR, merge, Issue mutation.
- Viewport 1440x900 only if a visible files/sync surface changes. Default: no UI sweep (backend pin repair).
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable only. Never `wiseeff_lane_849`, never `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or `wiseeff_t22_fil`.

## Invariant under protection

Every S12-FIL runtime read, write and reference is classified as **canonical current**, **exact canonical history**, or **authorized archived notice**. File sync/writeback matches **canonical binding + occurrence/source pin**. Unresolved identity **fails closed**. There is **no property-key-only fallback** and **no `parameterDefinitionId` used as `parameterSpecId`**. Candidate/source/version/config-set membership, baseline, comparison and export stay file-owned. Repair source SQL before deleting an allowance. Do not keep scanner-visible fallback SQL that runtime rewrites. Comparison adapters are not switched consumers.

## Intake (measured 2026-09-17)

Shards still total **3513**. S12-FIL `s12-fil.json` has **56** entries:

| Kind | Count | Notes |
| --- | --- | --- |
| Production `parameter-files/**` | 35 | `writebackService.ts` 21, `syncIdentity.ts` 8, `conflictService.ts` 3 |
| Tests | 17 | syncIdentity/conflict/writeback/integration |
| E2E | 2 | `parameter-files.acceptance.spec.ts` |
| `parameterFileClient.ts` | 2 | |
| Port / mock | 0 shard rows | Mock still in-family |

Rules: `legacy-parameter-spec-identifier` 34, `legacy-catalog-sql-write` 9, `legacy-catalog-raw-read` 8, `unresolved-boundary-expression` 5.

`findBindingBySource` **source SQL** still uses `coalesce(dps.property_key, split_part(ps.specification_key, '/', 2))`. Runtime `pinP` monkey-patches `db.query` via `interceptExactPropertyPinSql` so executed SQL drops the fallback while the scanner still sees it. That is not an honest pin. Writeback overlay apply uses `parameterSpecId ?? parameterDefinitionId`. Conflict insert uses the same coerce in semantic mode.

Candidate/config-set/baseline/export services exist and are mostly off the 56-row hotspot.

## Classification freeze

| Class | Meaning in FIL | This todo |
| --- | --- | --- |
| Canonical current — files | config-set membership, versions, candidates, baseline, export, structural ingest, writeback **with lock** | Keep |
| Canonical current — exact pin | `findBindingBySource` locator + `dps.property_key` | **Repair SQL in source** |
| Exact canonical history | tests, comparison contribution, e2e | Keep / retarget intercept tests |
| Archived notice | property-key `split_part` fallback; intercept helper | **Remove**; ratchet vanished tokens |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22F-01 | Inventory | 56 entries classified by file×rule | receipt table |
| T22F-02 | Exact pin | `findBindingBySource` SQL uses `dps.property_key` only; no `split_part` fallback in source | `syncIdentity.ts` + tests |
| T22F-03 | Fail closed | Missing `dts_property_specs.property_key` → no binding match | new `syncIdentity` test |
| T22F-04 | No intercept | `pinP` / `pinW` / `interceptExactPropertyPinSql` / `interceptExactWritebackSourceSql` / `db.query` wraps **gone**; writeback source SQL uses inner join `dts_property_specs` | grep + comparison test retarget |
| T22F-05 | Writeback identity | Overlay requires spec id from the locked binding; never `parameterDefinitionId` | `writebackService.ts` + tests |
| T22F-06 | Conflict identity | Semantic conflict insert does not coerce definition id into spec id | `conflictService.ts` + tests |
| T22F-07 | Membership | candidate/source/version/config-set/baseline/export stay 2xx | no rewrite unless a pin leak |
| T22F-08 | Client/mock | File client stays file routes; mock has no spec-as-definition mint | no UI rewrite |
| T22F-09 | Comparison | comparison contribution stays an adapter; intercept tests do not preserve the hack | contribution test |
| T22F-10 | Ratchet | Repair first; delete vanished FIL tokens vs 56/3513. Honest zero only if tokens remain after repair | shard + checker if runnable |
| T22F-11 | UI | 1440x900 only if files UI changes. Default no sweep | receipt |
| T22F-12 | Environment | 55438 disposable | receipt |
| T22F-13 | Non-goals | T2.2-AGT…OPS, T1.4, T2.1 fixture churn, Hosted, commit | receipt |

## Non-goals

- Zeroing 56 FIL allowances.
- 410 of file upload/sync/candidate routes.
- Churning T2.1 `semanticBindingFixture.ts`.
- Agent tools (T2.2-AGT).
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits.
