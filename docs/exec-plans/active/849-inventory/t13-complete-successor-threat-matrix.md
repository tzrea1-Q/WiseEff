# T1.3 complete successor and B2 materialization — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t13-complete-successor-threat-matrix.md)

Contract: #849, #853 T1.3, [ADR-0045](../../../adr/0045-configuration-schema-subject-and-seed-rebuild.md), [ADR-0046](../../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md), T1.1 source-occurrence identity, T1.2 `catalog-capability/v4` + `charging_core` NodeType. Product direction (DTS+JSON this round, TD-124 YAML/TOML/ENV deferred, ConfigurationSchema for software configuration, 124 bindings per Atlas/Aurora/Nebula, B6 fail-closed without placement) is already decided. This matrix freezes the remaining implementation and security boundary.

Status: **design Spec PASS with P2 (grok-4.6 re-review).** P1-1/P1-2/P1-3 closed. Companion: [implementable design](t13-complete-successor-design.md). Implementation may start. No commit, PR, or seal in this todo.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- Inherited HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1 and T1.2 remain uncommitted dirty candidates and are not rewritten.
- Risk **R3**. Independent Spec review of this matrix and the [implementable design](t13-complete-successor-design.md) precedes production edits. Independent Standards and Spec review of the resulting candidate follows local green.
- Stop after T1.3 local delivery. No T2.4 toolchain, T2.1 UI, T2.2 consumer families, commit, PR, merge, Hosted, target, or Issue mutation.
- Helper PostgreSQL only: disposable pgvector database on port **55438**, never compose `5432/wiseeff` and never the persistent lane `wiseeff_lane_849`.
- Requested independent-review model `gpt-5.6-luna` / `max` is unavailable in this runtime; reviewers use `grok-4.6` and must disclose that substitution.

## Invariant under protection

A complete Catalog successor, installed through the real publisher/installer, plus reviewed DTS and JSON project sources, produces the exact Binding identity set **124 per Atlas/Aurora/Nebula, 372 total**. Every current-scope input has a recorded digest, locator, old/formal identity, preserve/transform/merge/exclude disposition and predecessor lineage. TD-124 items create no active bindings or values. Structural and ambiguity fixtures stay excluded. Missing placement capacity still fail-closes with zero bindings. Initialization uses existing review/authorization, one-in-flight, and archive-before-rebuild; it never uses direct SQL or invented approvals. Completed replay is a no-op. Custom projects and non-parameter identities are preserved.

## Inventory honesty (125 vs 127)

The todolist still says “125 inputs: 113 vendor plus four current DTS/JSON and eight TD-124”. T1.2 added two reviewed `charging_core` NodeType properties. Conservation and the binding plan are:

| Figure | Meaning |
| --- | --- |
| 127 | Conservation: 115 vendor + 12 compatibility |
| 119 | Current-round: 115 vendor + 4 DTS/JSON compatibility |
| 8 | TD-124 YAML/TOML/ENV deferrals; no seeded binding or value |
| 124 | Bindings per project = 120 board business occurrences + 2 charging-thermal DTS occurrences + 2 JSON |
| 372 | 124 × 3 projects |
| Merge | The two new vendor properties (`fast-charge-profile-matrix`, `battery-thermal-derate-curve`) are the **formal subject** for the two DTS compatibility locators. They do not add bindings |

Unresolved current-scope fields/identities or unexplained omissions block release. The checklist wording is updated to this honesty in T1.3 docs; product questions are not reopened.

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| B2-01 | Conservation | Manifest records 127 inputs exactly once. 115 vendor, 12 compatibility, 119 current, 8 deferred. Structural vendor keys and ambiguity fixtures (`common-status.yaml`, `test-ambiguous-*.yaml`) stay excluded. Dangling overlay targets remain the measured **29** unresolved `&label` and **37** missing `&name` refs per board; they mint no canonical bindings (T2.4 owns stub removal). 120 board business occurrences stays the binding addend | `seed:reconcile:check` |
| B2-02 | Merge, not extra bindings | Compatibility DTS items `/parameterLibrary/9` and `/parameterLibrary/10` merge onto `node-type:charging_core` properties `fast-charge-profile-matrix` and `battery-thermal-derate-curve`. Old power-management slugs remain `oldIdentity`. No second definition and no 126th/127th binding | Manifest dispositions + identity oracle |
| B2-03 | JSON formal subject | JSON items `/parameterLibrary/1` and `/parameterLibrary/2` keep content and per-project values, and take formal subject `configuration-schema:wiseeff.power-config` with property keys `charger.cv.limitMv` and `battery.thermal.targetTempC`. Locator is JSON Pointer `/charger.cv.limitMv` and `/battery.thermal.targetTempC`. `subjectSelection` is no longer `requires-configuration-schema-subject` | Manifest + ConfigurationSchema successor |
| B2-04 | TD-124 leak | YAML/TOML/ENV compatibility items remain `defer` / `TD-124`. Seed materialize still refuses those formats with `UNSUPPORTED_FORMAT` and `deferredTo: "TD-124"`. They create zero bindings and zero ProjectValues. Evidence is a **seed** materialize test, not only T1.1 `unsupportedFormat.test.ts` | seed `materialize.test.ts` + `unsupportedFormat.test.ts` |
| B2-05 | Change-set budget | v4 `maxChangeSetOps` is 128 by overriding **only** `CATALOG_CAPABILITY_ALLOW_LIST`. `SHARED_BUDGETS` and frozen v3 stay 32. Production `importVendorCatalog` of the full vendor tree succeeds (not `resource-budget-exceeded`). ConfigurationSchema is a second one-op successor. Over-budget change sets still fail closed | capabilities + `importVendorCatalog` PG |
| B2-06 | Vendor successor completeness | `importVendorCatalog` emits one successor covering all 115 current vendor definitions, including `node-type:charging_core` and gpio_int nested arrays, retiring acme from new selection without `successorId` or identity reuse. Predecessor release and receipts stay | vendor import + installer PG |
| B2-07 | ConfigurationSchema through builder | A composer next to `importVendorCatalog` calls `buildCompleteSuccessor` with `productPath: "m2-core"`, `kind: "configuration-schema"` / `configuration-schema-id`, required `documentation`, frozen identity, and two integer definitions on `wiseeff.power-config`. `completeSuccessor.test.ts` covers this path. Vendor importer does not ingest `power-management.json` | builder unit + PG install |
| B2-08 | Publication path | Both successors reach the database only through compile → admit → persist candidate → **original-approver** authorize → `installPublishedRelease`. Publisher cannot authorize its own candidate. Direct SQL insert of subjects/definitions/releases/bindings is absent from evidence | authorization + installer PG |
| B2-09 | JSON ingest owner | JSON seed files are config-set members with role **`misc`** (never `overlay`). They **are** passed to `ingestConfigRevision` as revision **members** (so mixed membership is complete) and **are not** in the DTS parse set, `entryFile`, or `overlayOrder`. Bindings are created only by `registerCanonicalJsonSource` (parameter-files owner), **after** the all-project placement barrier. The T1.1 `deferredTo: "TD-124-json-project-source-semantics"` refuse is removed | `materialize.ts` + mixed-set JSON registration tests |
| B2-10 | DTS ingest owner | DTS seed files (`vendor-drivers.dts` base, `charging-thermal.dts` overlay) stay on `ingestConfigRevision` parse. The ingested revision’s member list includes the JSON `misc` file. JSON registration reuses that unique complete mixed revision and never manufactures a DTS revision. Ingesting DTS-only then adding JSON afterwards is forbidden (reuse would `CONFLICT`) | `canonicalJsonSource.ts` + `ingestService.ts` + materialize |
| B2-11 | Exact binding oracle | After successful materialize with reviewed placement, each of Atlas/Aurora/Nebula has **exactly 124** canonical bindings (120 board business + 2 charging-thermal + 2 JSON), 372 total. Oracle keys are `(projectId, occurrenceKind, locator, subjectKind, subjectCanonicalKey, propertyKey)` plus allocated binding IDs. JSON locators are JSON Pointers with a leading slash. Unexplained extra or missing rows fail | new identity-oracle integration test |
| B2-12 | Placement capacity | Reviewed extra free `driver-group` for `csub_drv_sc8562` is applied through `createParameterModule` (`kind: "driver-group"`, `origin: "curated"`, **no** compatible mapping), never `registerOrClaimDriver`, never inside `materializeSeedSources`, never invented SQL. ConfigurationSchema needs a free `business` module; measure and curate the same way if short. Stage registration input is DTS-observed subjects **union** the published `wiseeff.power-config` subject. Curator is idempotent on completed replay | placement curation + B6 tests |
| B2-13 | B6 fail-closed | Without the extra driver-group (and without a free business module if required), or if ConfigurationSchema is omitted from the registration list, materialize records `failed`, journals `missing-placement-module` per project/subject, throws `SeedInitializationBlockedError`, and writes **zero** bindings (no DTS sync, no JSON register). It cannot fall through to `completed` | `canonicalBindingMaterialization` + `materialize.test.ts` |
| B2-14 | Authorization and locks | Seed init requires parameter-edit on every target, uses the 0148 one-in-flight advisory lock, archives before rebuild, and refuses missing/ambiguous/organization-mismatched project identity. No invented approvals. Completed `(organization_id, seed_digest)` replay returns `already-complete` with no writes | plan + materialize tests |
| B2-15 | Determinism / order | Same inputs in different change-set order produce the same successor digest. Per the 2026-09-21 owner clarification in design §8, permuted project/file replay of the same completed instance preserves binding IDs and the oracle set; independent fresh databases need not allocate equal random IDs. `buildCompleteSuccessor` already sorts the change set; completed replay must not mint identity | builder determinism + completed-instance replay oracle |
| B2-16 | Replay and ordinary startup | A completed run is a no-op, including curator, ingest, JSON register, and binding writes. `seed_digest` covers all three per-project files. Ordinary process start, upgrade helper, or publication of an unrelated release does not reset or re-materialize Atlas/Aurora/Nebula. Custom projects outside the three targets are untouched | plan test 6 + preservation capture |
| B2-17 | Non-parameter preservation | Before/after capture of non-parameter identities, fields, relationships, and shared-object checksums is exact. Archive v2 guard still refuses truncated/tampered artifacts. Disposal is out of scope | archive integration + new before/after probe |
| B2-18 | Cross-tenant / role | A foreign organization or a reviewer without `parameter:edit` / `parameter:file-admin` cannot materialize, register JSON, or curate placement. Catalog install still requires the original approver | existing auth tests extended |
| B2-19 | Partial failure | Stage loop writes no bindings. JSON parse/mapping is preflighted for all three projects **after** the placement barrier and **before** DTS sync and before the first `registerCanonicalJsonSource`. A JSON mapping/parse failure at that preflight yields **zero bindings total** (no DTS sync, no JSON register) and does not mark the run `completed`. Completed replay skips JSON register. A later-project DTS sync failure after a passing preflight still does not complete the run (existing class) | materialize two-phase + JSON preflight |
| B2-20 | Historical / capability | v1–v3 meaning and frozen v3 consumer refuse-before-write stay. Raising v4 `maxChangeSetOps` changes the v4 allow-list digest only; it is not a new capability revision and does not widen v3 | capabilities tests + T1.2 installer proofs kept |
| B2-21 | Acme retirement | Acme subject/alias stay retired without `successorId`. Releases and activation receipts of `crel_acme_1` are unchanged. New selection does not offer acme | successor documents + PG |
| B2-22 | Local ≠ target | Helper PG evidence is not target-host execution, not Hosted, and not lane `wiseeff_lane_849`. Persistent 0151 checksum is not rewritten | diff review + DB name assertions |

## Non-goals

- Real `dtc` / `fdtoverlay` (T2.4), parameter UI (T2.1), eleven consumer families (T2.2), archive disposal (T2.3).
- TD-124 YAML/TOML/ENV project sources as active seeds.
- New SQL migration. T1.1 unpublished 0151–0153 stay untouched.
- Rewriting D1 slug allocation (`compile-vendor-catalog-release.ts`) into official production IDs.
- Commit, PR, merge, Hosted, target, Issue mutation, or persistent-lane writes.

## Self-review limit

This matrix was written by the coordinating implementer. Independent Spec review is required before production edits; this file is not that review.
