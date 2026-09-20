# T1.2 catalog-capability/v4 — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/capability-v4-acceptance.md)

Status: **T1.2 local candidate complete.** Independent design Spec PASS, then implementation Standards PASS and Spec PASS (grok-4.6; requested gpt-5.6-luna unavailable). Formal SEALED, commit, PR, merge, Hosted, target and Issue updates are not performed.

Contract: [threat matrix](capability-v4-threat-matrix.md), [design](capability-v4-design.md), ADR-0046, ADR-0016, #849/#853 T1.2.

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- Accepted main: `46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1 remains uncommitted dirty work. T1.2 is additional dirty/untracked work on the same tree. No commit.

## Behaviour delivered

1. Current capability revision is `catalog-capability/v4`. Frozen `CATALOG_CAPABILITY_V3_ALLOW_LIST` keeps v3 array meaning (no nested arrays, no `minItems`/`description` on arrays).
2. v4 admits recursive arrays, mixed item `{description}`, array-level `description`, metadata `minItems`/`maxItems`, with depth 4 / 256 container nodes / `maxItemsBound` 4096. Unknown keywords fail closed.
3. `gpio_int` vendor YAML is unchanged. `foldConstraints` maps `cells: 3` + `description` to a nested array (outer unconstrained groups, inner `minItems=maxItems=3`, items `{description:"mixed"}`). Scalar `cells` still `cells-require-array-or-mixed`.
4. `charging_core` is a listed NodeType YAML (`nodename-charging-core.yaml`). D1 and production importer emit `node-type:charging_core`, distinct from `driver:huawei,charging_core`. Nested property schemas have no example-derived cardinality.
5. Installer: `verifyAuthorizationForActivation` admits candidate `capability_contract.revision` by exact set membership. After compile, every definition schema is walked with the consumer allow-list before materialize. New reason `unsupported-consumer-capability-revision`. Frozen v3 injection exists only on `installPublishedReleaseForTests`.
6. D1 vendor successor digest is now `sha256:3d5c70fb5e0aad4bb7c3c063ca3283a81fb39ec25c471669a0500dd410a48f97` (49 subjects / 116 definitions). Operator pin in `ops/self-hosted/upgrade.md` updated.
7. Seed recon: gpio_int is no longer a blocker. Vendor inputs 115 (was 113) because of the two charging_core properties. Planned 124/372 bindings unchanged; T1.3 must merge those two vendor properties with the two DTS compatibility locators rather than adding bindings.

## Verification (do not sum)

Helper PostgreSQL: port 55438, disposable database `wiseeff_t12_capv4` (not `wiseeff_lane_849`). Persistent lane untouched.

| Command | Result |
| --- | --- |
| `test:server` capabilities + runtime capabilities + vendorAdapter + completeSuccessor | 4 files, **57 passed** / 0 failed / 0 skipped |
| `test:server` capabilityV4.integration | **2/2 passed** (online-publication v3 refuse-before-write + production NodeType install; advance of nested-array vendor successor refused for frozen v3) |
| `test:server` vendorSuccessor.integration | **1/1 passed** (116 property keys; both Huawei driver and charging_core NodeType) |
| `test:server` onlinePublication.integration | **14/14 passed** |
| `test:server` authorization.integration | **15/15 passed** |
| `test:server` nodeTypeSubjectBinding.integration | **1/1 passed** |
| `test:server` failures + parameterCatalog DTO | **18 passed** |
| `test:scripts` compile-vendor-catalog-release | **3/3 passed** |
| `test:scripts` seed-reconciliation-manifest | **14/14 passed** |
| `test:scripts` check-contract-schemas + install-catalog-release | **10/10 passed** |
| `npm test` parameterCatalogClient + publicationState | **24/24 passed** |
| `seed:reconcile:check` | current |
| `contract:check` | OpenAPI current |
| `docs:check` | passed including pgvector schema comparison on helper DB |
| `git diff --check` | passed |
| `npm run build` | recorded in the completion report |

Not a full `test:server` suite. Not S1/S2, Hosted, or target. T1.1 171-file result is not this candidate.

## Remaining limits

- Complete vendor successor through the production importer still hits `maxChangeSetOps` 32; that is T1.3.
- Seed inventory conservation is 127 inputs; T1.3 binding plan remains 124×3.
- No commit/PR/seal.
