# T2.2-KNW knowledge consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-knw-knowledge-consumers-acceptance.md)

Status: **T2.2-KNW local candidate complete.** Design Spec PASS with P2; implementation Standards PASS with P2; implementation Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). No SEALED, commit, PR, merge, Hosted, target, or Issue update.

Contract: [threat matrix](t22-knw-knowledge-consumers-threat-matrix.md), [design](t22-knw-knowledge-consumers-design.md), [design Spec review](t22-knw-knowledge-consumers-spec-review.md), [implementation review](t22-knw-knowledge-consumers-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- T1.1–T2.2-DTS remain uncommitted. No commit.

## Behaviour delivered

1. `loadParameterReferencesByEntryIds` **LEFT JOIN**s `parameter_specs` in source SQL. Projection is `coalesce(ps.property_key, dps.property_key)` only.
2. `pinK` / `interceptKnowledgeReferenceSql` / `__knwPin` / empty-result inject **gone**. `lookupLegacyIdentifier` runs only after the load query.
3. `resolveReferenceableSpec` stays org or platform-global; other tenants 404. Stored `knowledge_parameter_references` not rewritten. Orphan chips may use spec id as notice-only `propertyKey`. Knowledge routes not 410'd.

## Classification (T22K-01)

S12-KNW **50** entries, **15** file×rule groups, 0 unexplained. Table: [t22-knw-knowledge-consumers-classification.md](t22-knw-knowledge-consumers-classification.md).

| Class | Count |
| --- | --- |
| canonical-current-picker | 4 |
| canonical-current-stored-ref | 16 |
| canonical-current-knowledge | 4 |
| exact-canonical-history | 26 |
| archived-notice | 0 |

## Ratchet (T22K-09)

KNW 50→50, total 3513→3513, delta 0. Wrap gone. Honest zero: checker **did not complete** (`editService.ts` relocation blob from T2.2-TOP; fixtures not rewritten).

## Verification (do not sum)

Helper PG **55438** / `wiseeff_t22_cgh`. No UI sweep.

| Command | Result |
| --- | --- |
| `test:server -- parameterReferences.test.ts parameterCatalogComparisonContribution.test.ts` | **18 passed** (14+4) |
| `test:server -- routes.test.ts` | **17 passed** |
| `npx tsc -b` | **passed** |
| `git diff --check` on KNW code files | **passed** |
| grep `interceptKnowledgeReferenceSql` / `pinK` in `*.ts` | **no matches** |
| boundary checker | **did not complete** (T2.2-TOP `editService.ts` blob) |
| browser 1440x900 | **not run** (no visible knowledge UI change) |

## Remaining limits

- Mapping uses a dynamic `import()` of `lookupLegacyIdentifier`.
- Checker blocked; KNW shard not ratcheted.
- No T2.2-MOD, no commit.
