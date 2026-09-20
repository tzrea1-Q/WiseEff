# T2.2-MOD module consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-mod-module-consumers-acceptance.md)

Status: **T2.2-MOD local candidate complete.** Design Spec PASS with P2; implementation Standards PASS with P2; implementation Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). No SEALED, commit, PR, merge, Hosted, target, or Issue update.

Contract: [threat matrix](t22-mod-module-consumers-threat-matrix.md), [design](t22-mod-module-consumers-design.md), [design Spec review](t22-mod-module-consumers-spec-review.md), [implementation review](t22-mod-module-consumers-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- T1.1–T2.2-KNW remain uncommitted. No commit.

## Behaviour delivered

1. `listBindingsForModuleRecompute` joins `attribution_subjects` on `ps.attribution_subject_id` and projects `asub.source_key` as `driver_module`. Remap identity remains `attributionSubjectId` (`asub.id`). No `specification_key` split, no `display_name` lookup.
2. Recompute and both discovery queries pin `dts_logical_node_revisions.config_revision_id = br.config_revision_id` where `br` is the binding's own tip (`project_parameter_binding_revisions order by created_at desc limit 1`). Latest-revision `order by config_revision_id desc` is gone. Missing tip/locator omits compatible/instance.
3. Overlay spec picker: `ParameterAdminNextPage` passes `runtime.parameterCatalogRepository` into `OrganizationModuleGovernancePanel`. API mode uses `listDefinitions()`. Mock/no-catalog uses default `listSpecs()` (never `view: "governance"`). Overlay HTTP and parameter-specs governance handlers are not 410'd. Kind/registration/capacity/search/counts stay.

## Classification (T22M-01)

S12-MOD **283** entries, **51** file×rule groups, 0 unexplained. Table: [t22-mod-module-consumers-classification.md](t22-mod-module-consumers-classification.md).

| Class | Count |
| --- | --- |
| exact-canonical-history | 90 |
| canonical-current-subject-placement | 88 |
| canonical-current-dts-overlay-adapter | 56 |
| canonical-current-registration-capacity | 32 |
| canonical-current-search-counts | 17 |
| archived-notice | 0 |

## Ratchet (T22M-10)

MOD 283→283, total 3513→3513, delta 0. Spec-key split and latest-revision fallback gone from source SQL. Honest zero: checker **did not complete** (`editService.ts` relocation blob from T2.2-TOP; fixtures not rewritten). Leftover spec-key split / latest-revision / governance picker after repair would be Spec fail even if delta ≠ 0; those leaks are gone.

## Verification (do not sum)

Helper PG **55438** / `wiseeff_t22_cgh`. Overlay picker unit-tested; live 1440x900 overlay dialog **not run** (no browser MCP in this session).

| Command | Result |
| --- | --- |
| `test:server -- service.test.ts driverRegistration.test.ts driverPlacement.test.ts parameterCatalogComparisonContribution.test.ts` | **29 passed** (14+8+4+3) |
| `npm test -- OrganizationModuleGovernancePanel.test.tsx ParameterAdminNextPage.test.tsx` | **47 passed** (2+45) |
| `npx tsc -b` | **passed** |
| `git diff --check` | **passed** |
| grep `string_to_array` / `split_part` in `parameter-modules/*.ts` | **test assertions only** |
| grep `order by config_revision_id desc` in `parameter-modules/*.ts` | **test assertions only** |
| grep `view: "governance"` in `OrganizationModuleGovernancePanel.tsx` | **no matches** |
| boundary checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` | **did not complete** (T2.2-TOP `editService.ts` blob) |
| browser 1440x900 overlay picker | **not run** |

## Remaining limits

- Overlay CRUD remains on the module port as DTS coverage adapter until T1.4.
- Checker blocked; MOD shard not ratcheted.
- Overlay picker 1440x900 not observed live.
- Fail-closed “newer LNR on another config does not win” is asserted as SQL shape, not a competing-revision seed.
- Locator `br`/`lnr` laterals are duplicated across three queries (Standards P2).
- No T2.2-OPS, no commit.
