# T2.2-LOG log consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-log-log-consumers-acceptance.md)

Status: **T2.2-LOG local candidate complete.** Design Spec PASS with P2; implementation Standards FAIL then PASS; implementation Spec PASS (grok-4.6; requested gpt-5.6-luna unavailable). No SEALED, commit, PR, merge, Hosted, target, or Issue update.

Contract: [threat matrix](t22-log-log-consumers-threat-matrix.md), [design](t22-log-log-consumers-design.md), [design Spec review](t22-log-log-consumers-spec-review.md), [implementation review](t22-log-log-consumers-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- T1.1–T2.2-AGT remain uncommitted. No commit.

## Behaviour delivered

1. `loadRelatedParameter` source SQL is `coalesce(psv.display_name, dps.property_key)` (no `ps.specification_key` name fallback).
2. `pinLogRelatedParameterQuery` / `interceptExactRelatedParameterSql` removed. `createDbLogAnalysisToolBackends` uses `input.db` unwrapped for related-parameter **and** knowledge search.
3. Missing binding still returns `null`. `related_parameter_id` remains a binding id. Historical analysis JSON not rewritten. Log routes not 410'd.

## Classification (T22L-01)

S12-LOG **10** entries, **3** file×rule groups, 0 unexplained. Table: [t22-log-log-consumers-classification.md](t22-log-log-consumers-classification.md).

| Class | Count |
| --- | --- |
| canonical-current-logs | 3 |
| canonical-current-exact-pin | 7 |
| exact-canonical-history | 0 |
| archived-notice | 0 |

## Ratchet (T22L-09)

LOG 10→10, total 3513→3513, delta 0. Intercept gone. Honest zero: checker **did not complete** (`editService.ts` relocation blob from T2.2-TOP; fixtures not rewritten).

## Verification (do not sum)

Helper PG **55438** / `wiseeff_t22_cgh`. No UI sweep.

| Command | Result |
| --- | --- |
| `DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t22_cgh npm run test:server -- dbToolBackends.test.ts parameterCatalogComparisonContribution.test.ts` | **5 passed** (1+4); after Standards FAIL, `dbToolBackends.test.ts` re-run **1 passed** |
| `npx tsc -b` | **passed** |
| `git diff --check` on LOG code files | **passed** |
| grep `interceptExactRelatedParameterSql` in `*.ts` | **no matches** |
| boundary checker | **did not complete** (T2.2-TOP `editService.ts` blob) |
| browser 1440x900 | **not run** (no visible log UI change) |

## Remaining limits

- Checker blocked; LOG shard not ratcheted.
- First Standards review FAIL (knowledge query not separately proven); test folded and re-review PASS.
- No T2.2-DBG, no commit.
