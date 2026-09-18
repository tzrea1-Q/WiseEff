# T2.2-DBG debug consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-dbg-debug-consumers-acceptance.md)

Status: **T2.2-DBG local candidate complete.** Design Spec PASS with P2; implementation Standards PASS with P2; implementation Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). No SEALED, commit, PR, merge, Hosted, target, or Issue update.

Contract: [threat matrix](t22-dbg-debug-consumers-threat-matrix.md), [design](t22-dbg-debug-consumers-design.md), [design Spec review](t22-dbg-debug-consumers-spec-review.md), [implementation review](t22-dbg-debug-consumers-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- T1.1–T2.2-LOG remain uncommitted. No commit.

## Behaviour delivered

1. `exactDebugOperationValues` removed. Live list/insert pins do not call `readProtectedReference(binding: null)`.
2. `listDebugParameters` SELECTs `project_parameter_binding_id`. `attachDebugPins` is per-record: stored binding → `canonical-pin`; else typed-block `missing-binding`.
3. `insertPinnedNodeOperation` persists caller/stored binding only (no unbound pin copy). `writeNode` reload via `parameterDefinitionId` stays GONE. Debug-node admin catalog stays 2xx. Device write approval unchanged. No DBG-owned DTS promotion.

## Classification (T22D-01)

S12-DBG **17** entries, **5** file×rule groups, 0 unexplained. Table: [t22-dbg-debug-consumers-classification.md](t22-dbg-debug-consumers-classification.md).

| Class | Count |
| --- | --- |
| canonical-current-debug-overlay | 13 |
| canonical-current-exact-pin | 3 |
| exact-canonical-history | 1 |
| archived-notice | 0 |

## Ratchet (T22D-10)

DBG 17→17, total 3513→3513, delta 0. Helper gone. Honest zero: checker **did not complete** (`editService.ts` relocation blob from T2.2-TOP; fixtures not rewritten).

## Verification (do not sum)

Helper PG **55438** / `wiseeff_t22_cgh`. No UI sweep.

| Command | Result |
| --- | --- |
| `test:server -- parameterCatalogComparisonContribution.test.ts service.test.ts routes.test.ts valueCodec.test.ts` | **135 passed** (5+86+35+9) |
| `test:server -- repository.integration.test.ts` | **21 passed** |
| `npx tsc -b` | **passed** |
| `git diff --check` on DBG code files | **passed** |
| grep `exactDebugOperationValues` in `*.ts` | **no matches** |
| boundary checker | **did not complete** (T2.2-TOP `editService.ts` blob) |
| browser 1440x900 | **not run** (no visible debug UI change) |

## Remaining limits

- Comparison contribution `observeCanonical` still uses unbound snapshot (not the live list/insert path).
- No dedicated `writeNode` 410 unit test found (production still GONE).
- Rollback insert omits `projectParameterBindingId` (fail-closed null).
- Checker blocked; DBG shard not ratcheted.
- No T2.2-DTS, no commit.
