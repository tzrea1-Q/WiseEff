# T2.2-DTS reload consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-dts-reload-consumers-acceptance.md)

Status: **T2.2-DTS local candidate complete.** Design Spec PASS with P2; implementation Standards PASS with P2; implementation Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). No SEALED, commit, PR, merge, Hosted, target, or Issue update.

Contract: [threat matrix](t22-dts-reload-consumers-threat-matrix.md), [design](t22-dts-reload-consumers-design.md), [design Spec review](t22-dts-reload-consumers-spec-review.md), [implementation review](t22-dts-reload-consumers-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- T1.1–T2.2-DBG remain uncommitted. No commit.

## Behaviour delivered

1. `listReloadCandidateRows` / `getReloadCandidateRow` inner-join `dts_property_specs`; `property_key` is `dps.property_key`; `display_name` has no `specification_key`; locator requires `config_revision_id = br.config_revision_id`.
2. `interceptExactReloadPinSql` / `pinDtsReloadQueryable` / `__dtsExactPin` removed. `service` / `deploy` / `promote` use unwrapped `db`.
3. Behavioural verify matches `debugging_parameters.project_parameter_binding_id` only. Overlay members stay `format = 'dts'`. Promote still `createBindingDraft`. Structural `status` candidates without `dts_property_specs` are omitted (fail closed). HANDOFF/PROMOTE Playwright stay planned skip (T3.2).

## Classification (T22R-01)

S12-DTS **54** entries, **12** file×rule groups, 0 unexplained. Table: [t22-dts-reload-consumers-classification.md](t22-dts-reload-consumers-classification.md).

| Class | Count |
| --- | --- |
| canonical-current-reload | 1 |
| canonical-current-exact-pin | 20 |
| canonical-current-promote | 0 |
| exact-canonical-history | 33 |
| archived-notice | 0 |

## Ratchet (T22R-09)

DTS 54→54, total 3513→3513, delta 0. Intercept gone. Honest zero: checker **did not complete** (`editService.ts` relocation blob from T2.2-TOP; fixtures not rewritten).

## Verification (do not sum)

Helper PG **55438** / `wiseeff_t22_cgh`. No UI sweep.

| Command | Result |
| --- | --- |
| `test:server -- parameterCatalogComparisonContribution.test.ts promote.test.ts service.test.ts deploy.test.ts` | **70 passed** (4+9+34+23) |
| `npx tsc -b` | **passed** |
| `git diff --check` on DTS code files | **passed** |
| grep `interceptExactReloadPinSql` / `pinDtsReloadQueryable` in `*.ts` | **no matches** |
| boundary checker | **did not complete** (T2.2-TOP `editService.ts` blob) |
| browser 1440x900 | **not run** (no visible `/dts-reload` UI change) |

## Remaining limits

- HANDOFF/PROMOTE Playwright remain `test.skip(true)` (T3.2). `skip(true)` is not proof of those cases.
- Comparison test wraps `listReloadCandidateRows` only (`getReloadCandidateRow` shares the same SQL shape).
- Checker blocked; DTS shard not ratcheted.
- No T2.2-KNW, no commit.
