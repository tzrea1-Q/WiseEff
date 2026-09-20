# T1.4 final legacy cutover — progress receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t14-final-legacy-cutover-acceptance.md)

Status: **Published Catalog GET is canonical-only (no leftover extras). Unpublished pointer still topology-falls-back. Scanner leftover 55 remains; T1.4 stays unchecked.** Overlay and governance **detail** stay 2xx. No SEALED.

Design Spec re-review `01a0b0a8-0492-434d-6fbb-ac1520d36674` PASS with P2. B2 Spec re-review `9e09e874-cae5-4e98-af76-c5f6cd638731` PASS with P2 (folded).

## Repair A (landed)

Current successors rebound; historical dest OIDs unchanged.

| Record | Pairs |
| --- | --- |
| `source-workflow-relocation.json` | 82 |
| `source-workflow-consumer-relocation.json` | 202 (retired 8 vanished dest spans) |

Checker dest-blob block is gone.

## Repair B1 (landed)

`t14-t22-family-successor-relocation.json` **136** identical-slice family pairs. Stale-only ratchet of 10 vanished hits (OPS 4 + FIL identifier 5 + TOP client route 1). Shards **3513→3503**. `s12-ops.json` is empty.

## Repair B2 (landed)

`t14-rewritten-slice-successor-relocation.json` **51** rewritten-slice pairs after the 136-pair family record. Flags `requireIdenticalSlice: false` and `requireUnchangedEvidence: false` only on this record. Coarser order key and dest-`byteStart` tie exception apply only when `requireUnchangedEvidence === false`.

| | After A only | After B1 + 10 ratchet | After B2 |
| --- | --- | --- | --- |
| violations | 3552 | 3552 | 3552 |
| allowlisted | 3316 | 3452 | **3503** |
| unallowlisted | 236 | 100 | **49** |
| staleAllowances | 197 | 51 | **0** |
| allowlistGrowth | 0 | 0 | 0 |
| shard total | 3513 | **3503** | **3503** |
| relocations | | 476 | **527** |

Leftover **49** = **48 new-base-id + 1 extra same-anchor dest** (`writebackService.ts` `read:project_parameter_bindings` at dest 26362). Do not invent a dest span for that extra. Relocation cannot map different first-three-part ids. Allowlist growth forbidden.

## Repair C (landed)

Live-caller proof after B. 410 only the surface with no remaining product API caller.

| Surface | Decision | Remaining caller |
| --- | --- | --- |
| Overlay HTTP | **keep 2xx** | T2.2-MOD DTS coverage adapter: `OrganizationModuleGovernancePanel` overlay library + driver-schema overlay CRUD |
| `GET /api/v2/parameter-specs?view=governance` **list** | **410** `legacy-surface-retired` successor `/api/v2/catalog`, gone-first | MOD picker no longer uses it. Remaining UI is mock/no-catalog `OrganizationSpecGovernancePanel` (not the winning HTTP). Catalog-api isolation already 410d this shape |
| `GET /api/v2/parameter-specs/:specId?view=governance` **detail** | **keep 2xx** | T2.1 `semanticBindingFixture.ts` |
| `/api/v2/parameter-modules` writes | **keep 2xx** (removed winning-router catalog-legacy wrap that 410d all non-GET `parameterModules.*`) | `parameterModuleRegistryClient` / mapping panel / driver-registry UI |
| seedInitialization completed replay | no new writer | T1.3 no-op + T2.2-OPS CLI 410 |

Winning `registerParameterSpecRoutes` GET list returns 410 when `view=governance` **before** auth/db. Effective list stays 200. Internal `listParameterSpecRows(..., { view: "governance" })` is not HTTP and is unchanged.

## Verification

| Command | Result |
| --- | --- |
| `parameter-catalog-boundaries:check --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` | **failed** (49 unallowlisted, 0 stale, 527 relocs) |
| `test:scripts --` sourceWorkflow + exactRelocation + runtimeTopology + rewritten-slice + check-parameter-catalog-boundaries | **135 passed** (7 rewritten-slice); after P2 fold rewritten-slice **8 passed** |
| `DATABASE_URL=…55438/wiseeff_t22_cgh test:server -- parameterSpecHttpAdapter.test.ts parameterModuleHttpAdapter.test.ts` | **9 passed** (7+2). List governance 410 gone-first; overlay POST and module writes not 410; detail/activate/resolve not 410 |

Helper PG not required for this checker path.

## Leftover 49 named owners (not paper-zero)

Relocation cannot map different first-three-part ids. Allowlist growth forbidden. These are current scanner hits of successor SQL, CGH keep surfaces, or tests of those surfaces. Removing the production SQL would undo T2.2. Scanner-rule deletion is a later Spec.

| Class | Count | Owner | Why still hit |
| --- | --- | --- | --- |
| CGH keep overlay / governance **detail** / DTS routes | 10 | `parameterSpecHttpAdapter.test.ts` (8), e2e import-wizard (2) | T2.2-CGH freeze: keep 2xx. Repair C must not 410 these. |
| FIL successor spec-id from locked binding | 15 | `writebackService.ts` (9, including extra dest 26362), `conflictService.ts` / `.test.ts`, `syncService.ts` / `.test.ts`, `syncIdentity.test.ts` | T2.2-FIL required `parameterSpecId` from `project_parameter_bindings.parameter_spec_id`. Scanner still flags those tokens. |
| MOD successor remap SQL | 13 | `parameter-modules/repository.ts` (4), `service.test.ts` (8), `recomputeDryRun.integration.test.ts` (1) | Live joins of bindings / revisions / `attribution_subjects` / dismissed-compatibles. |
| TOP DTS edit tests | 8 | `editService.test.ts` | Test SQL still `delete`/`update` `dts_property_specs` / `parameter_specs`. |
| KNW successor identifier / comparison | 2 | `parameterReferences.ts`, `parameterCatalogComparisonContribution.test.ts` | `parameter_spec_id` / `left join parameter_specs`. |
| DBG successor identifier | 1 | `debugging/repository.ts` | `parameter_spec_id`. |

Do not invent a dest span for writeback dest 26362. Do not grow shards.

## Remaining T1.4

- 49 un-only current scanner hits named above. T1.4 zero is blocked until a later scanner / un-only Spec. Repair source of successor SQL is not this cutover.
- Repair C landed: governance **list** 410; overlay keep; governance **detail** keep; module writes keep (wrap removed). Spec re-review `01a0b261-c4e8-4b19-9d7a-2f6e8a15c093` PASS with P2.
- Independent B2 implementation Spec `a4c91e2b-7f06-4d38-9b5a-0e18c3d6f247` PASS with P2; Standards `e8b2c41a-7d5f-4a93-b6c0-1f9e4d82a570` PASS with P2. Shared P2 (historical identical-slice regression) folded.
- **TD-125:** published Catalog GET returns catalog rows only (no leftover extras). Unpublished/empty pointer still falls back to topology. Overlay/governance **detail** stay 2xx. T1.4 leftover stays unchecked.
