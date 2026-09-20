# T2.2-LOG log consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-log-log-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-LOG, [API transition](../../../design-docs/parameter-catalog-api-transition.md) Log analysis row, [inventory](../../../references/parameter-catalog-contract-inventory.md) Log analysis row, T2.2-AGT [acceptance](t22-agt-agent-consumers-acceptance.md). Product direction (eleven families, classify, repair then ratchet, vs 3513) is decided. This matrix freezes the LOG implementation boundary.

Status: **Spec PASS with P2 folded.** Companion: [implementable design](t22-log-log-consumers-design.md). Independent review `01a0afdf-99dd-7840-956c-d3c054c84433`.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-AGT remain uncommitted; do not rewrite except LOG-owned paths.
- Allowed paths: `server/modules/logs/**`, `LogAnalysisRepository.ts`, `logClient.ts`, `logDtos.ts`, matching tests, `e2e/acceptance/log-analysis.acceptance.spec.ts`, and `scripts/parameter-catalog-allowlist/shards/s12-log.json` for ratchet. Classify in-family; do not steal DBG/DTS/KNW/AGT/xiaoze.
- Stop after T2.2-LOG. No T2.2-DBG or later, T1.4, commit, PR, merge, Issue mutation.
- Viewport 1440x900 only if a visible log-analysis citation surface changes. Default: no UI sweep (SQL pin repair).
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable only. Never `wiseeff_lane_849`, never `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or `wiseeff_t22_log`.

## Invariant under protection

Every S12-LOG runtime read, write and reference is classified as **canonical current**, **exact canonical history**, or **authorized archived notice**. Related-parameter recommendations use **canonical current binding pins**. Historical analysis records stay immutable. Unresolved related ids **fail closed** and **do not create definitions**. There is **no `specification_key` name fallback** and **no scanner-visible SQL that runtime rewrites**. Repair source SQL before deleting an allowance. Comparison adapters are not switched consumers.

## Intake (measured 2026-09-17)

Shards still total **3513**. S12-LOG `s12-log.json` has **10** entries:

| Kind | Count | Notes |
| --- | --- | --- |
| Production `dbToolBackends.ts` | 7 | `legacy-catalog-raw-read` (related-parameter SQL) |
| `repository.ts` | 2 | `unresolved-boundary-expression` |
| `domainsRepository.ts` | 1 | `unresolved-boundary-expression` |
| Client / e2e / comparison | 0 shard rows | Port/DTO/e2e still in-family |

Rules: `legacy-catalog-raw-read` 7, `unresolved-boundary-expression` 3.

Live leak: `loadRelatedParameter` **source SQL** still `coalesce(psv.display_name, dps.property_key, ps.specification_key)`. Runtime `pinLogRelatedParameterQuery` wraps `db.query` via `interceptExactRelatedParameterSql` so executed SQL drops `ps.specification_key` while the scanner still sees it. That is not an honest pin (same shape as T2.2-FIL `pinP`). `related_parameter_id` is already documented as a **binding id**. Missing binding → `null` (no definition mint). Historical log records/citations stay.

`repository.ts` / `domainsRepository.ts` unresolved expressions are not the name-fallback leak; classify, do not invent a rewrite.

## Classification freeze

| Class | Meaning in LOG | This todo |
| --- | --- | --- |
| Canonical current — logs | upload/run/record/domain membership, related_parameter as binding id | Keep |
| Canonical current — exact pin | `loadRelatedParameter` name/property pin | **Repair SQL in source** |
| Exact canonical history | tests, comparison, e2e, DTO fixtures | Keep / retarget intercept tests |
| Archived notice | `specification_key` name fallback; intercept helper | **Remove**; ratchet vanished tokens |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22L-01 | Inventory | 10 entries classified by file×rule | receipt table |
| T22L-02 | Exact pin | `loadRelatedParameter` SQL uses `coalesce(psv.display_name, dps.property_key)` only; no `ps.specification_key` name fallback in source | `dbToolBackends.ts` + tests |
| T22L-03 | Fail closed | Missing binding / unresolved related id → `null`; no definition create | existing `dbToolBackends.test.ts` + SQL |
| T22L-04 | No intercept | `pinLogRelatedParameterQuery` / `interceptExactRelatedParameterSql` / `db.query` wrap **gone** (related-parameter **and** knowledge search) | grep + `dbToolBackends.test.ts` + comparison test |
| T22L-05 | Binding id | `related_parameter_id` remains binding id; do not coerce definition id | repository comment + no rewrite unless leak |
| T22L-06 | History | stored analysis records/citations not bulk-rewritten | no historical JSON rewrite |
| T22L-07 | Client/mock | log client/DTO stay log routes; mock does not mint specs | no UI rewrite |
| T22L-08 | Comparison | contribution stays an adapter; intercept tests do not preserve the hack | contribution test |
| T22L-09 | Ratchet | Repair first; delete vanished LOG tokens vs 10/3513. Honest zero only if function/SQL intercept gone and checker blocked | shard + checker if runnable |
| T22L-10 | UI | 1440x900 only if log citation UI changes. Default no sweep | receipt |
| T22L-11 | Environment | 55438 disposable | receipt |
| T22L-12 | Non-goals | T2.2-DBG…OPS, T1.4, T2.1 fixture churn, Hosted, commit | receipt |

## Non-goals

- Zeroing 10 LOG allowances.
- 410 of log upload/analyze routes.
- Creating definitions from unresolved log evidence.
- Rewriting historical analysis payloads.
- Churning T2.1 `semanticBindingFixture.ts` or T2.2-TOP relocation fixtures.
- Debug/reload/knowledge families.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits.
