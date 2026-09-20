# T1.3 implementation review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t13-complete-successor-impl-review.md)

Model: grok-4.6 (requested gpt-5.6-luna / max unavailable). Independent of the implementer. No edits, no commit, T1.3 left unchecked by the reviewers.

Two-axis review of the T1.3 working tree against HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`. T1.1 source-occurrence schema/UI and T1.2 array-schema semantics were out of scope except the v4 `maxChangeSetOps` override.

## Standards

**PASS with P2** — worst: production placement curator write with no authz/audit.

Hard — `placementCapacity.ts`. `curateReviewedSeedPlacementCapacity` is a production module write (driver-group / business) with no `AuthContext`, no `requireParameterAdmin` / `canAdminParameters`, no transaction, and no audit. It takes a raw `organizationId` and calls `createParameterModule` (repository). That breaches docs/SECURITY.md (“All production writes must produce audit evidence”), CONTRIBUTING.md (production paths: authz, validation, transaction, audit), AGENTS.md (preserve authorization, tenant isolation, audit), and the catalog-change skill. The accepted design may skip `registerOrClaimDriver` / `createParameterModuleForAuth` (those inject compatibles); it does not waive auth or audit. Design §6.1 still asks for “Seed admin’s real auth.”

Not a breach (overrides baseline): v4 `maxChangeSetOps: 128` with `SHARED_BUDGETS` left at 32. Composer next to `importVendorCatalog` uses `buildCompleteSuccessor` + `productPath: "m2-core"`. JSON uses `createUserInvocation(auth)` and `registerCanonicalJsonSource`. Manifest `unhandledVendorConstraints` duplication is the design-recorded importer mirror. Ephemeral PG + memory object store in tests is the existing harness, not a fake Catalog adapter.

Baseline smells (judgement): Duplicated Code — `completeSuccessor.test.ts` inlines the ConfigurationSchema change set instead of `powerConfigChangeSet`; thermal `documentation` drifted. Feature Envy — `configurationSchemaSuccessor.ts` imports `SEED_POWER_CONFIG_SCHEMA_ID` from `seedInitialization/powerConfig.ts`. Mysterious Name — digest/file identity is hardcoded `board.dts` while the default helper still emits `vendor-drivers.dts` unless `{ board: true }`.

## Spec

**PASS with P2** — worst: B2-11 oracle is count-only, not the specified natural-key tuple.

Core path matches the design: v4 `maxChangeSetOps` 128 with `SHARED_BUDGETS`/v3 still 32; two successors (`importVendorCatalog` then `buildPowerConfigSuccessor` / `productPath: "m2-core"`); JSON `misc` not overlay; register after the placement barrier; ConfigurationSchema unioned onto B6; curator outside `materializeSeedSources`; B6 vendor-drivers fail-closed on a separate DB from the 124 run.

Board vs `vendor-drivers.dts`: §5 table / B2-10 name `vendor-drivers.dts` as base, but §8 arithmetic is `120 board business occurrences + 2 charging-thermal + 2 JSON = 124`, and §5.2 digest is `<projectId>/board.dts`. Unique vendor nodes cannot yield 120 board rows. Loading `src/config/dts-seed/<project>-board.dts` as `board.dts` is the 124 addend, not a spec miss. Nesting overlay `charging_core` under `wiseeff_node_type_demo` is required once that board (with `&charging_core` / `huawei,charging_core`) is the base.

Missing / partial: B2-11 / §8 oracle asserts 124/372 counts, 6 JSON rows, and replay count — not keys, JSON Pointers, NodeType vs driver for charging-thermal, `logicalNodeId: null`, or stable allocated IDs. §5.3 JSON invert of `sha256:seed-materialize-json` was dropped; YAML TD-124 exists, TOML/ENV seed tests do not. §8 / B2-17 / B2-15 / B2-19 tests missing for non-parameter + custom-project capture, file-order permutation, and JSON mapping preflight → zero bindings total. §3 allow-list digest is not pinned beyond 32 vs 128. §6.1 / B2-18 curator takes `organizationId` only. §9 helper 55438 / `wiseeff_t13_successor` is an operator pin, not hardcoded in the suite (ephemeral clones of `TEST_DATABASE_URL`).

Not asked for: board overlay `compatible` additions; nebula `rx_mod_cm_cfg` `0xfffffffa` → `0xfa`. JSON `sortOrder` is `100 + dtsSeen` vs §5 “misc (sort 2)”.

Looks done, looks wrong: `completeSuccessor.test.ts` thermal `documentation` is not the reviewed `power-management.json` `description`+`explanation` (§4.1); the composer is. If ConfigurationSchema is missing from the snapshot it is omitted from the B6 union, then `CONFLICT`, not `missing-placement-module` (§6.2 / B2-13).

## Summary

Standards: PASS with P2 (worst: curator write without authz/audit). Spec: PASS with P2 (worst: B2-11 oracle is count-only).
