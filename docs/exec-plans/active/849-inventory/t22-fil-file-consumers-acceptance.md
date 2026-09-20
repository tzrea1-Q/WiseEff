# T2.2-FIL file consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-fil-file-consumers-acceptance.md)

Status: **T2.2-FIL local candidate complete.** Design Spec PASS with P2; implementation Standards PASS with P2; implementation Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). No SEALED, commit, PR, merge, Hosted, target, or Issue update.

Contract: [threat matrix](t22-fil-file-consumers-threat-matrix.md), [design](t22-fil-file-consumers-design.md), [design Spec review](t22-fil-file-consumers-spec-review.md), [implementation review](t22-fil-file-consumers-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- T1.1–T2.2-PRJ remain uncommitted. No commit.

## Behaviour delivered

1. `findBindingBySource` source SQL uses `dps.property_key` only (inner join `dts_property_specs`). `pinP` / `interceptExactPropertyPinSql` / `__filExactPin` removed. Missing property occurrence → no match.
2. Writeback `pinW` / `interceptExactWritebackSourceSql` removed. `loadSemanticWritebackSource` inner-joins `dts_property_specs`. Overlay spec id is loaded from the locked binding, never from `parameterDefinitionId`.
3. `detectFileUiDraftConflict` does not coerce `parameterDefinitionId` into `parameterSpecId`. Semantic `syncFileVersion` passes `parameterSpecId` and binding id from the match.
4. Comparison tests assert executed SQL has no `split_part(ps.specification_key` fallback. File membership/baseline/export routes not 410'd. T2.1 `semanticBindingFixture.ts` unchurned.

## Classification (T22F-01)

S12-FIL **56** entries, **23** file×rule groups, 0 unexplained. Table: [t22-fil-file-consumers-classification.md](t22-fil-file-consumers-classification.md).

| Class | Count |
| --- | --- |
| canonical-current-files | 29 |
| canonical-current-exact-pin | 8 |
| exact-canonical-history | 19 |
| archived-notice | 0 |

## Ratchet (T22F-10)

FIL 56→56, total 3513→3513, delta 0. Source SQL no longer contains `split_part` fallback. Honest zero: remaining tokens are spec identifiers / table reads / tests; vanished intercept IDs not deleted because checker **did not complete** (`editService.ts` relocation blob from T2.2-TOP; fixtures not rewritten).

## Verification (do not sum)

Helper PG **55438** / `wiseeff_t22_cgh`. No UI sweep.

| Command | Result |
| --- | --- |
| `DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t22_cgh npm run test:server -- syncIdentity.test.ts conflictService.test.ts syncService.test.ts parameterCatalogComparisonContribution.test.ts writebackService.test.ts` | **31 passed** (5+9+6+4+7) |
| `npx tsc -b` | **passed** |
| `git diff --check` on FIL code files | **passed** |
| boundary checker | **did not complete** (T2.2-TOP `editService.ts` blob) |
| browser 1440x900 | **not run** (no visible files UI change) |

## Remaining limits

- No writeback test that overlay spec id is loaded from the locked binding or that missing spec fail-closes.
- Fail-closed sync test deletes the `dts_property_specs` row (absent), not a null `property_key` column.
- `parameters/fileSyncConflictRepository.ts` still coerces spec id on the no-legacy-columns insert (out of family). Live FIL caller passes spec id.
- Semantic sync still copies spec id into the legacy `parameterDefinitionId` field as well as `parameterSpecId`.
- Checker blocked; FIL shard not ratcheted.
- No T2.2-AGT, no commit.
