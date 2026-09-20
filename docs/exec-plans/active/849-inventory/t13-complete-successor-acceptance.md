# T1.3 complete successor and B2 materialization — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t13-complete-successor-acceptance.md)

Status: **T1.3 local candidate complete.** Independent design Spec PASS with P2, then implementation Standards PASS with P2 and Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). Formal SEALED, commit, PR, merge, Hosted, target and Issue updates are not performed.

Contract: [threat matrix](t13-complete-successor-threat-matrix.md), [design](t13-complete-successor-design.md), [design Spec review](t13-complete-successor-spec-review.md), [implementation review](t13-complete-successor-impl-review.md), #849/#853 T1.3.

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- Accepted main: `46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1 remains uncommitted dirty work. T1.2 and T1.3 are additional dirty/untracked work on the same tree. No commit.

## Behaviour delivered

1. v4 `CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxChangeSetOps` is 128. `SHARED_BUDGETS` and frozen v3 stay 32. Revision string remains `catalog-capability/v4`.
2. Two successors on helper PG through the real publisher/installer: `importVendorCatalog` (vendor YAML only, 115 property keys) then `buildPowerConfigSuccessor` (`wiseeff.power-config`, `productPath: "m2-core"`, original REVIEWER). acme stays retired without a reassigned identity.
3. Mixed config-set membership: DTS `base`/`overlay`, JSON `misc` (never overlay). `ingestConfigRevision` receives all members; JSON is filtered out of the DTS parse set. JSON bindings go through `registerCanonicalJsonSource` after the all-project placement barrier, with `createUserInvocation(auth)`.
4. JSON preflight (parse, pointer read, published definition resolve) runs after the placement barrier and before DTS value sync. YAML seed sources remain `UNSUPPORTED_FORMAT` / `deferredTo: "TD-124"`.
5. Placement curator `curateReviewedSeedPlacementCapacity` uses `createParameterModule` (`origin: "curated"`, no compatible mapping) and is not called from `materializeSeedSources`. B6 still fail-closes with zero bindings when a free driver-group is missing.
6. B6 registration list is DTS-observed subjects union the published ConfigurationSchema subject. `materializeSeedSources` requires a `RootDatabase` (`isRootDatabase`) for the JSON refusal sink.
7. Oracle sources: `src/config/dts-seed/<project>-board.dts` as `board.dts` plus `charging-thermal.dts` plus `power-config.json`. Board overlay fragments that lacked `compatible` now declare reviewed vendor driver compatibles. NodeType `charging_core` is nested under `wiseeff_node_type_demo` so it does not overlay-merge onto board `&charging_core` / `huawei,charging_core`. nebula `rx_mod_cm_cfg` 8-bit cell is `0xfa`.
8. Seed digest owner `canonicalSeedInitializationDigest` hashes `wiseeff.seed-initialization.digest.v1` + org + sorted targets + per-project `board.dts` / `charging-thermal.dts` / `power-config.json` sha256 hex. Completed replay returns `{ status: "already-complete" }` with no further writes.
9. Inventory honesty: conservation 127 (115 vendor + 12 compat); current-round 119; 8 TD-124; planned 124×3=372. Vendor `charging_core` properties **merge** with the two DTS compatibility locators; JSON items take `configuration-schema:wiseeff.power-config` with Pointers `/charger.cv.limitMv` and `/battery.thermal.targetTempC`.

## Verification (do not sum)

Helper PostgreSQL: port 55438 (`wiseeff-g668-pg`), disposable database `wiseeff_t13_successor` with `vector` (not `wiseeff_lane_849`, not compose `5432/wiseeff`). Persistent lane untouched. `TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t13_successor`. Tests create ephemeral clones from that server.

| Command | Result |
| --- | --- |
| `test:server` T1.3 core (capabilities, completeSuccessor, vendorAdapter, configurationSchemaSuccessor, digest, materialize, B6, nodeType, t13, seedSources.fidelity) | 10 files, **86 passed** / 0 failed / 0 skipped |
| of which `t13CompleteSuccessor.integration.test.ts` | **1/1 passed** (124 per Atlas/Aurora/Nebula, 372 total, 6 JSON bindings, replay `already-complete` still 372) |
| of which `canonicalBindingMaterialization.integration.test.ts` | **1/1 passed** (B6 zero bindings without extra driver-group) |
| `test:scripts` seed-reconciliation-manifest | **14/14 passed** |
| `seed:reconcile:check` | current |
| `git diff --check` | passed |
| `docs:check` | passed (governance + db-schema artifact current) |
| `npm run build` | passed (after `isRootDatabase` narrowing in `materialize.ts`) |

Not a full `test:server` suite. Not S1/S2, Hosted, or target. Local initialization is not target execution. T1.1 171-file result is not this candidate.

## Remaining limits (implementation review P2)

- Identity oracle asserts 124/372 counts, 6 JSON rows, and replay no-op; it does not yet assert the full B2-11 natural-key tuple `(projectId, occurrenceKind, locator, subjectKind, subjectCanonicalKey, propertyKey)`, JSON Pointers, NodeType vs driver for charging-thermal, `logicalNodeId: null`, file-order permutation, or custom-project/non-parameter checksums.
- Placement curator still takes `organizationId` rather than seed-admin `AuthContext`; it does not call `createParameterModuleForAuth` because that path uses `registerOrClaimDriver` and would invent compatibles.
- The dropped `sha256:seed-materialize-json` refuse case was not inverted as a named mixed-membership test; YAML TD-124 exists, dedicated TOML/ENV seed cases do not.
- `completeSuccessor.test.ts` inlines ConfigurationSchema documentation that drifted from `powerConfigChangeSet`.
- JSON `sortOrder` is `100 + dtsSeen` rather than the sketch's literal sort 2.

No commit/PR/seal.
