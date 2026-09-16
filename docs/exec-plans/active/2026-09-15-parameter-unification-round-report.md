# Parameter unification round report (Issue #849)

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-15-parameter-unification-round-report.md)

2026-09-16 execution amendment: the [complete #849/#853 todo list](2026-09-16-849-853-closure-todolist.md) records the current order and per-todo user confirmation. The user explicitly replaced this program's prospective three-viewport acceptance with one PC viewport, `1440x900`; all operation and S1/S2 gates remain. Historical viewport results remain historical evidence; T0.6 reconciles older status narratives.

Round: 2026-09-15 Scratch implementation round.
Branch: `feat/849-parameter-unification`, worktree `/Users/tzrea1/Develop/WiseEff-worktrees/issue-849-parameter-unification`.
Base: `origin/main` at `8f03cfa4302aebbe3bc3c37ef2197c082c2a3e2e` (fetched 2026-09-15).
Plan: [2026-09-14-parameter-unification-and-seed-parity.md](2026-09-14-parameter-unification-and-seed-parity.md). Accepted decision: [ADR-0045](../../adr/0045-configuration-schema-subject-and-seed-rebuild.md).
Status: **partial**. This report separates what is delivered and proven from what is not started, so a small happy path cannot be mistaken for Issue completion. The Issue remains OPEN.

## 1. Delivered and verified

### 1.1 Legacy coexistence removed; one canonical read/write owner

`server/modules/parameter-bindings/catalogProjectValueRoutes.ts` contained the four coexistence defects named in the Issue's problem statement. All four are removed:

| Defect (Issue text) | Before | After |
| --- | --- | --- |
| "Some transitional routes merge both sources" | `GET /api/v2/projects/:projectId/parameter-bindings` merged canonical rows with legacy `listProjectBindings` rows | Canonical-only list. Unknown/foreign project still returns 404; an empty canonical Catalog returns an honest empty list |
| "fall back to legacy data when the canonical collection is empty" | The same list returned `original.items` whenever the canonical list was empty | No fallback exists. Archived legacy rows are never presented as current data |
| "A route named as draft creation can directly save a canonical current value" | `POST .../parameter-bindings/:bindingId/drafts` called `saveCanonicalProjectValue` and returned the new **current value id** as `draftId` | A real pending draft is written to the new `project_parameter_value_drafts` owner (migration `0145_canonical_project_value_drafts.sql`) and the current value, its tip and the active source revision are untouched |
| "mixed import batches can fall back to the old apply service" | `POST /api/v1/parameter-import-batches/:batchId/apply` called the legacy `applyImportBatch` when no canonical match was found or when only some rows matched | Canonical-only apply. An unmatched/unbound row produces a truthful `409 CONFLICT` (`reason: "unbound-canonical-binding"`, `unbound[]`, `applied: 0`); the legacy apply service is never used as a fallback. The empty-catalog preview fallback is also removed |

New canonical draft owner: `server/modules/parameter-bindings/drafts/` (repository + service + barrel), plus HTTP `GET /api/v2/projects/:projectId/parameter-value-drafts` and `DELETE /api/v2/projects/:projectId/parameter-value-drafts/:draftId`, registered in `routeManifest.ts`/`schemaRegistry.ts` and regenerated into `docs/generated/openapi.json`.

Enforced invariants (real PostgreSQL, `drafts.integration.test.ts`): creating a draft does not change `current_value_id`, does not append a `project_parameter_values` row, does not change `config_revision_id`; the draft persists across a reload and can be removed; a stale base revision, an unknown binding and a cross-project editor are all rejected with the correct status. A binding whose `source_ref` is `canonical-binding-identity` (no concrete config-set source) is refused.

Governance audit gained `value-drafted` / `value-draft-removed` actions.

### 1.2 DTS/JSON only; YAML, TOML and ENV refused explicitly

- `server/modules/parameter-files/service.ts` now has one shared deferred-format decision: `.yaml`, `.yml`, `.toml`, `.env` are refused with `ApiError("UNSUPPORTED_FORMAT", ...)` and details `{ fileName, format, deferredTo: "TD-124", supportedExtensions }`. `.json`, `.dts`, `.dtsi` still work; genuinely unknown extensions (`.txt`, `.ini`) keep the generic `VALIDATION_FAILED`.
- `server/shared/http/errors.ts` gained `UNSUPPORTED_FORMAT` → HTTP 400.
- The refusal happens in `detectFormat`, the single pre-staging choke point shared by every byte-accepting route, **before** any `objectStore.put` or database row. Tests assert zero object-store writes and zero rows.
- `POST /api/v1/parameter-import/parse-dts` now refuses a deferred `sourceName` before parsing instead of attempt-parsing it as DTS.
- The frontend silent fallback in `src/application/parameters/import/detectImportFormat.ts` (which turned YAML/TOML/ENV text into a "spreadsheet") is replaced by an explicit `"unsupported"` outcome and an `UnsupportedImportFormatError` raised in `parseImportSource` before any parser runs. A test proves `parseSpreadsheetImport` is never reached.
- Vendor YAML **Catalog definition metadata** import is untouched and still green (`vendorAdapter.test.ts`, `vendorCoexistence.integration.test.ts`).

### 1.3 Seed reconciliation manifest

`src/config/seed-reconciliation/manifest.json` plus `docs/generated/seed-reconciliation-report.md`, generated by `scripts/seed-reconciliation-manifest.ts` and gated by `npm run seed:reconcile` / `npm run seed:reconcile:check`. Measured counts match the Issue's expected counts exactly: **125 inputs = 113 vendor + 12 compatibility; 117 current (113 vendor + 2 JSON + 2 DTS); 8 deferred**. Each of the three boards measures 50 nodes / 176 raw occurrences / 120 business / 56 structural. Planned inventory 124 bindings per project / 372 total is labelled PLANNED, not achieved. The two blocked `gpio_int` vendor inputs are recorded as `transform` with the exact blocker (`…#gpio_int.constraints.cells`, `unhandled-constraint:cells,description`) and the required transformation — `cells`/`description` are **not** dropped and the importer was not modified.

### 1.4 Documentation

- ADR-0045 (EN + ZH) and the planning pair (plan, CONTEXT, `docs/PLANS.md`, domain model, API-transition and cutover docs, `docs/adr/README.md`) landed.
- TD-124 added to both the English and Chinese technical-debt trackers.
- Scratch reconnaissance evidence kept under `docs/exec-plans/active/849-inventory/` with an index README.

### 1.5 Canonical submit → review → apply

`server/modules/parameter-bindings/drafts/changeService.ts` + `changeRepository.ts` and the new `project_parameter_value_change_requests` owner (migration `0145`) add the reviewed apply unit that was missing:

| Step | Behaviour |
| --- | --- |
| Submit (`POST /api/v2/projects/:projectId/parameter-value-drafts/:draftId/submit`) | Freezes the canonical identity (binding, definition revision, catalog release) and the base pins (current value, config revision, source reference) plus the target value and reason. The current value, its tip and the active source revision are untouched. One open request per draft. |
| Approve (`POST .../parameter-value-change-requests/:requestId/review`, `decision: "approve"`) | The single authorized apply unit. Re-resolves the protected references and rejects stale base value / base revision / definition revision; refuses self-approval; then writes the value and its protected source writeback through the existing canonical value owner and commits workflow status, `binding_history_events` history and the caller's audit in the same owned transaction. The applied draft leaves the tray. |
| Replay | An already-`approved` request returns its recorded `appliedValueId` and `applyOutcome` and never appends a second value. |
| Reject / Withdraw | No value is written; the request closes and the draft stays pending for revision. Only the submitter may withdraw. |
| Authorization | Submit requires project edit; approve requires `parameter:review` **and** the existing `software_review` stage role (`software-committer` scoped to the project, or admin); the sensitive-node write check still runs on approve. |

Real-PostgreSQL evidence is in `drafts.integration.test.ts` (9 tests): submission does not move the current value; self-approval and non-reviewer approval are refused; approval appends exactly one canonical value and one history event and advances the tip; replay appends nothing; a concurrent tip advance makes approval fail with `stale-base-value` and leaves the request pending; rejection and withdrawal write nothing.

### 1.6 Real source files for the four current compatibility seeds

`src/config/seed-sources/<project>/{power-config.json,charging-thermal.dts}` now supply reviewed, per-project real sources for the four current-scope compatibility items, and `scripts/lib/seedReconciliation.ts` registers them (SHA-256 digest, exact locator, per-project current/recommended value) on the four `realSource` entries in `src/config/seed-reconciliation/manifest.json`.

| Seed | Format | File | Exact locator |
| --- | --- | --- | --- |
| `charge_voltage_limit_mv` | JSON | `power-config.json` | `charger.cv.limitMv` (literal dotted key) |
| `battery_temp_target_c` | JSON | `power-config.json` | `battery.thermal.targetTempC` (literal dotted key) |
| `dts_fast_charge_profile_matrix` | DTS | `charging-thermal.dts` | `charging_core/fast-charge-profile-matrix` |
| `battery_thermal_derate_curve` | DTS | `charging-thermal.dts` | `charging_core/battery-thermal-derate-curve` |

Deliberate boundaries recorded in the files and the manifest, not silently assumed:

- The JSON settings keep their **literal dotted keys**. A slash-separated path (`charger/cv/limitMv`) is refused by the JSON writeback rather than silently creating or redirecting a nested structure, so a similar-looking path cannot redirect the change.
- The DTS files declare their own node ownership and record the retired underscore name → source property key mapping. They declare **no `compatible`**: the formal subject identity for these two seeds is a reviewed decision and is not inferred from a label (`subjectSelection: "pending-reviewed-subject-selection"`). The two JSON settings record `requires-configuration-schema-subject`.
- Every file carries a demonstration disclaimer: these are demonstrations, not validated real-device firmware and not device-deployment input.
- Deferred items own no active source this round and carry no `realSource`.

Fidelity evidence: `server/modules/parameter-files/seedSources.fidelity.test.ts` (18 tests) proves both indexes expose exactly the expected locators, the per-project values match the seed inventory oracle, patching changes only the intended value, the DTS comments and unrelated property survive the patch, no `compatible =` property is invented, and the recorded manifest digests match the bytes on disk.

### 1.7 Canonical binding change history read surface

`parameter_catalog.binding_history_events` is written by the canonical value owner on every committed tip/revision change, including the reviewed apply path, but had **no read surface at all** before this round. `readCanonicalBindingChangeHistory` and `GET /api/v2/projects/:projectId/parameter-bindings/:bindingId/change-history` now expose, per binding: the old/new current value ids, the old/new definition revision ids, the recorded reason, the success audit reference and the catalog release — never archived legacy payloads. An unknown or foreign-organization binding returns `404`, not an empty history. A typed client method mirrors the route.

### 1.8 PU-01 ConfigurationSchema — Slice A landed

An independent adversarial Spec review (`849-inventory/configurationschema-spec-review.md`) returned **FAIL** with 3 P0 / 6 P1 / 3 P2 findings and a three-slice plan. Two findings corrected the original plan materially: the claim that the two long projection-completeness functions "under-validate rather than mis-validate" is **false** (a `configuration-schema-id` alias owned by a driver subject can reach the current pointer), and the model-id parser as first written accepted real filenames (`charge.dts`, `model.yaml`, `fw_v1.bin`), leaving identity forgery open.

**Slice A (contract + authoring closure) is landed and green.** It adds no database state and no capability revision, so it cannot admit a release on its own:

| Change | Evidence |
| --- | --- |
| Third subject kind and third selector kind in the closed registries | contract suite 64/64 (26 new parser fixtures) |
| `parseCanonicalConfigurationSchemaId` with a filename/extension deny-list plus `,`/`@`/`*` exclusion, so the three selector namespaces stay disjoint by construction | `normalization.test.ts` accepts namespaced ids and refuses all 15 filename shapes, a driver compatible list, unit addresses and wildcards |
| Three-way subject `if/then` in `catalog-release.schema.json` with a rejecting `else`, and all four selector enums widened | schema suite green |
| Exhaustive per-kind selector mapping in compiler validation (unknown kind yields a violation, never node-type) | compiler + publication suites 204/204 |
| `stable-id-rules.json` closed enums, mapping and the recomputed S0-ID golden pin (blob OID / byte length / SHA-256 over the now three-kind golden fixture) | `serialization.test.ts` green |
| Re-pinned compiler contract golden (contract fingerprint, compiled digest, toolchain digest — all three change because the pinned contract input now declares three kinds) | `compileCatalogRelease.test.ts` green |
| Regenerated `docs/generated/openapi.json` | `contract:check` current |

Still failing on `origin/main` in this environment and therefore not attributable to this change: `catalogRoles.integration.test.ts > application, agent, and verifier logins are not members of Catalog writer roles` (proved on a pristine worktree with its own lane database).

**Slice B (storage closure) is landed and green.** Migration `0147_configuration_schema_subject.sql` is generated from a script that reads the six trigger bodies out of `0137` and applies the three-way transformation textually, so the redefinition is byte-faithful rather than retyped:

| Change | Evidence |
| --- | --- |
| `catalog_configuration_schemas` subtype relation, owned by `catalog_migration_owner` and granted to `catalog_synchronizer_role` | schema suite: the frozen canonical relation count is now **45** |
| All six kind-dispatching trigger functions redefined with a third arm, including the two long projection-completeness and current-release-completeness functions (the review's P1-1 finding) | `catalogSchema.integration.test.ts` 136/136; the alias-kind-disagreement case still raises the **original** constraint name |
| Widened `catalog_subjects.kind`, subject canonical-key, alias selector-kind and alias selector CHECKs | schema suite green |
| Placement decision: a configuration-schema subject places into a **`business`** module, so the immutable `0080` module-kind CHECK is untouched | `assert_subject_placement_kind` / `assert_parameter_module_placement_kind` third arm |
| Cross-root collision guard extended to `UPDATE of kind, canonical_key` / `UPDATE of selector_kind, normalized_selector` | security suite T3 idempotency green |
| Recomputed frozen `S2_SCH_CONTRACT_FINGERPRINT` = `cdd07caa405f8ed8f9403324f8d61d75cab6966c37b8e06ae65768b34fbcfa87` | `catalog-kernel/schema` + `runtime` 174/174 |

Two design corrections were forced by the environment and are recorded because they are the reason this slice is deliverable at all:

1. **SQL `OR` does not short-circuit.** An `OR`-form CHECK that consults a configuration-schema predicate makes *every* insert — including existing driver and node-type ones — require EXECUTE on that predicate, which broke `synchronizer INSERT catalog_subjects succeeds through CHECK function execute`.
2. **`0138` is not idempotent with respect to new function grants.** It ends with a loop revoking EXECUTE on every function in `parameter_catalog` from `catalog_synchronizer_role`, so granting the new predicate to that role made re-running `0138` change the ACL (`T3` failed).

Both are resolved by the same change: the predicate is **inlined** into the CHECK expressions and both CHECKs use an explicit `CASE` (which evaluates only the matching branch) instead of `OR`. No helper function or new grant exists, so 0138's re-run stays a no-op and ordinary inserts never touch the new predicate. The `configuration-schema` install path obtains whatever EXECUTE it needs with Slice C. A side effect is that the CHECK text is longer, and the schema fingerprint changed a second time when the form changed.

**Slice C (install / runtime / admission) is landed and green.** No migration and no DB state change; it makes a published configuration-schema subject actually installable, cacheable and matchable:

| Change | Evidence |
| --- | --- |
| `materializeRelease` selector snapshot and subtype dispatch are three-way; a configuration-schema subject inserts into `catalog_configuration_schemas`, and an unrecognized kind now **throws** instead of being written as a node type | install suite green |
| `currentSnapshot` reconstructs the third selector kind from `selector_snapshot` and from aliases; the kernel brand `NormalizedConfigurationSchemaId` is defined alongside `NormalizedNodeTypeName`; `DefinitionMatchingMetadata.selectorKind` and `SubjectAliasSnapshot.selector` are widened | `catalog-kernel/runtime` 174/174 with Slice B |
| `rebuildCatalogCache` includes the third kind in its subject query, so a published configuration-schema subject is no longer silently dropped from the cache payload | cache tests green |
| `subjectMatch` gains a three-way alias mapping and a configuration-schema resolution step **between** the driver compatible match and the node-type fallback; an unrecognised kind yields no match rather than defaulting | matcher tests green |
| Capability revision becomes `catalog-capability/v3` with `v1` and `v2` still admitted, `preview` uses the constant instead of a hardcoded `v2`, and the successor test asserts the constant rather than a literal | compiler + publication suites 306/307 (the one failure was a timer flake that passes on re-run) |
| The V05 count gate now requires a configuration-schema placement to be a `business` module, matching the Slice B placement guard | count-gate tests green |

**The review's Slice C exit evidence is now closed.** `server/modules/catalog-kernel/install/configurationSchemaPublish.integration.test.ts` publishes a configuration-schema release end to end on real PostgreSQL: it clones the canonical bundle's first release, swaps in a `configuration-schema` subject with canonical key `wiseeff.charger.cv` plus its alias and a definition whose `matching.selectorKind` is `configuration-schema-id`, re-encodes the authoritative YAML source and re-links digests, compiles it, installs it with `installPublishedRelease`, and then asserts the materialized facts: `catalog_subjects.kind = 'configuration-schema'`, exactly one row in `catalog_configuration_schemas` and zero in `catalog_drivers` / `catalog_node_types`, `selector_snapshot->>'kind' = 'configuration-schema-id'` on the release membership, and `selector_kind = 'configuration-schema-id'` on the alias. A second case proves the matcher resolves the subject by explicit governed model id and returns `unknown` for a node-type fallback, i.e. a configuration-schema subject never consumes the device fallback. Both pass. The fixture's `refreshAuthoritativeSource` was exported so a suite can author a third-kind release without duplicating the source-encoding logic.

### 1.9 Canonical export with exact revision pins

The Item-1 list ("history and export") had history but no export. `exportCanonicalBindingSource` and `GET /api/v2/projects/:projectId/parameter-bindings/:bindingId/export` now return, per binding, the exact stored project-source bytes for its pinned config revision together with the canonical identity pins — `bindingId`, `definitionId`, `definitionRevisionId`, `catalogReleaseId`, `configRevisionId`, `currentValueId`, `configSetId` and `sourceRef` — so a reimport can be verified against the same value and revision rather than against whatever is current later. The export reads the stored bytes; it does not re-render the value. An unknown or foreign binding returns `404`, and a binding without a concrete config-set source fails closed with `409`.

Evidence: `drafts.integration.test.ts` is now 11 tests. The export case asserts the returned content is byte-identical to the stored DTS, that the pins match the binding's actual `current_value_id`, `config_revision_id`, `effective_revision_id` and `config-set:` source reference, that the exported bytes reparse to a `charger` node carrying `iin_max` (reimport fidelity), and that an unknown binding yields `null` rather than an empty export.

### 1.10 Archived old links: one archived outcome instead of two

The canonical Catalog answers an archived old link with the `legacy-id-archived` diagnostic (HTTP 410 `GONE`), but the legacy parameter client only recognized `legacy-parameter-id-retired`, so the canonical diagnostic fell through as a generic error. `parameterClient.ts` now normalizes both diagnostics to a single archived outcome and leaves every other 410 untouched. Three cases in `parameterClient.test.ts` prove it: canonical archived, pre-cutover archived, and an unrelated 410 that must not be relabelled.

**Finding recorded, not fixed:** no component in `src/` consumes `getParameter`, so there is currently **no old-link detail surface that renders an archived notice**. The server contract, the archived outcome and the retrieval-procedure data are all in place; the visible notice would be a new page, which is a larger piece of work than this change and belongs with the PU-05 frontend slice. This is why this round carries no browser evidence: the change is client-internal and renders nothing.

### 1.11 PU-04: seed initialization target plan, blocking guard and run journal

The first deliverable of the seed rebuild is the scope guard the rest of it depends on. `server/modules/parameter-bindings/seedInitialization/plan.ts` plus migration `0148_seed_initialization_runs.sql` implement Issue decision 17:

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Resolve Atlas/Aurora/Nebula by stable id, verifying organization ownership | `resolveSeedInitializationPlan` looks up each reviewed id, checks organization and the stored project code against the reviewed identity | plan test 1-2 |
| Missing or ambiguous identities **block** instead of silently creating projects | `missing-project`, `organization-mismatch` and `identity-ambiguous` blocks; `assertSeedInitializationPlanApplicable` throws `SeedInitializationBlockedError` | plan tests 3-5, including an assertion that nothing was created |
| Only the three may be seeded | every other project in the organization is returned as `excludedProjectIds` and is never a target | plan test 2 |
| The same completed run is a no-op | `seed_initialization_runs` keyed `(organization_id, seed_digest)`; `seedInitializationRunIsComplete` gates the work and re-recording is idempotent | plan test 6 |
| Ordinary startup/upgrade/publication cannot reset values | nothing outside this module reads or writes the journal; the plan itself writes no parameter data | by construction |

The reviewed seed identities are a checked-in constant that a test asserts is **identical** to `src/config/power-management.json#projects`, so the copy cannot drift into a second source of truth.

**Architectural correction found by the boundary gate:** the module was first written under `server/modules/parameters/`, where reading `parameter_catalog.project_parameter_bindings` trips the S12-PRJ `canonical-catalog-raw-access` rule. The boundary check failed with two unallowlisted violations. The module and its test were moved to `parameter-bindings` (outside the scanned S12 families), which is the same ownership choice the existing canonical readers make, and the check returned to zero unallowlisted violations.

**Not delivered here:** this is the plan, the guard and the journal. The materialization of seed definitions, bindings and project values, the publication successor and the acme retirement are still open.

### 1.12 PU-04: seed source materialization

`server/modules/parameter-bindings/seedInitialization/materialize.ts` materializes the reviewed seed sources into the three target projects' **source plane** through the existing owners — it creates no project, invents no approval and adds no parallel writer:

1. refuses to run when the same seed digest already completed (read from the run journal);
2. resolves and asserts the target plan, so a missing or ambiguous project still blocks;
3. per project: ensures the default config set, uploads each reviewed DTS source as a real file version with its bytes in the object store, makes it a config-set member, and ingests a **resolved** config revision;
4. asks the canonical project-value owner to sync bindings and values, and reports how many it wrote;
5. records the run as completed.

Evidence, `materialize.test.ts` (3 tests, real PostgreSQL): all three projects end with a config set, one member file, a file version and a `resolved` config revision, and the run journal records the three target ids; re-running the same digest returns `already-complete` and adds **no** new file versions; a JSON seed source is refused.

**BLOCKER FOUND AND RECORDED, NOT SILENTLY SKIPPED:** a JSON project source cannot enter this path. `ingestConfigRevision` is a DTS/config-revision resolver and there is no JSON semantic ingest path, so a JSON seed source is refused with `UNSUPPORTED_FORMAT` (details carry `deferredTo`) rather than uploaded as a non-resolving member or dropped from the manifest. **The two JSON compatibility seeds therefore remain unmaterialized.** This is a genuine gap against scope item 2, which expects JSON import/review/writeback/export to work, and it is now precisely located: the canonical value owner has a JSON value path, but the config-revision/ingest path does not.

**Also not delivered here:** the publication successor, acme retirement, and the canonical binding/value materialization that depends on published seed definitions (the sync step runs and currently writes zero bindings because no seed definitions are published yet).

### 1.13 PU-04: acme retirement in the publication successor

> **Correction (round 21).** An earlier revision of this report claimed 1.13 and 1.14 as delivered, citing
> tests ("retires the acme subject and alias without claiming a false successor", "keeps the real vendor
> subject distinct") that do not exist anywhere in the tree, and digests (`sha256:298b5d48…`,
> `sha256:94d6f172…`, `sha256:0ff88ec0…`) that no code produces. Those changes were reverted in a later round
> and the claims were not withdrawn at the time. They are withdrawn here. What follows is the verified state.

`scripts/compile-vendor-catalog-release.ts` retires the distinct acme bootstrap example in the successor it
already generates, satisfying Issue D07 and user story 44:

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Retire acme's subject and alias | `csub_acme_power` and `cali_acme_power_v1` carry `lifecycle: "retired"` and a tombstone with `reason` and `withdrawnByReleaseId` = `crel_vendor_catalog_1`, the release that withdrew them | `completeSuccessor.test.ts` -> "carries the retired acme subject and alias forward with their tombstones" |
| Do not claim a false merge | The tombstone names **no** `successorId`, and the stored `tombstone_provenance` is exactly `{"reason":"acme-sample-retired"}`. Acme is never claimed to have evolved into the real vendor subject that also owns an `iin_max` property | same test asserts `successorId` is `undefined`; the real-PostgreSQL assertion in `vendorSuccessor.integration.test.ts` pins the stored provenance |
| Preserve release history and activation receipts | Only the successor's copy of the documents changes. `crel_acme_1`, its digest and its document lifecycles are untouched, and acme stays `active` in that release | `vendorSuccessor.integration.test.ts` asserts the predecessor membership is still `active` after the advance |
| Keep the successor compilable and deterministic | `VENDOR_SUCCESSOR_AGGREGATE_DIGEST` is `sha256:5f0e7bcd6c537f3a0574dc5541e1199f5537061bef4ad5551ec4f5e9565bec64`; counts are unchanged at 48 subjects / 1 alias / 114 definitions because a retired member is still a retained member | `compile-vendor-catalog-release.test.ts` 3/3 including determinism; `vendorCoexistence.integration.test.ts` 6/6; `vendorSuccessor.integration.test.ts` 1/1 |

**Why the earlier attempt failed, and what "B3" actually was.** A later round recorded this as blocked on a
carry-forward defect in `buildCompleteSuccessor` (B3). That diagnosis was wrong. A probe that retired only the
subject and alias reproduced the failure, and the failure was at `expect(result.ok).toBe(true)` — not at the
carry-forward comparison. The build error was `{kind: "subject-not-active", subjectId: "csub_acme_power"}`:
the failing test minted a definition under the acme subject, and `applyCreateDefinition` correctly refuses to
mint under a retired subject. A direct probe then confirmed the carry-forward is sound — building from the
retired-acme successor produced 163 -> 164 documents with **no** predecessor identity missing, and both the
retired subject and alias carried through with their tombstones intact. The only real change needed was to
move that one test's change set onto a subject that stays active; its carry-forward assertions are unchanged.
Two tests were added for the new behaviour (carry-forward of the retired pair; refusal to mint under it).

The retirement also moves a pinned digest, which is recorded honestly rather than silently:
`docs/references/catalog-publication-baseline-verification.md` keeps its historical R-F4 value and gains a
dated forward note, while both `ops/self-hosted/upgrade.md` runbooks — the live operator pins — carry the new
value and the sentence explaining that `acme,power` now resolves as `retired`.

**Acme's definition is not retired.** `pdef_acme_power_iin_max` remains `active` under the retired subject. It
is not needed for the acceptance outcome: `subjectMatch` and `currentSnapshot` gate on the *subject*
membership lifecycle, so a retired acme subject already never resolves as a live match. Retiring the
definition as well would need a further, separate change, and it is recorded as remaining work, not claimed.

### 1.13a The archived old-link notice, and real authentication behind it

Scope item 4 requires "archived notice on old links", and testing decision 10 recorded that no consumer
surface rendered it. It does now, and the work exposed three defects between the API and the screen:

| # | Defect | Fix |
| --- | --- | --- |
| 1 | A deep link whose parameter id is not in the current project list did nothing at all - `contextQuery.parameterId` was only used to select a row that already existed | A new effect asks the Catalog about the absent id and renders a banner when the answer is "archived" |
| 2 | `parameterClient` read the diagnostic only from `details.diagnostic` and an exact `message`, but the operator Catalog route carries it in `details.reason` | All three carriers are read, with a regression test that uses the real `details.reason` body |
| 3 | `createParameterRuntimeActions().getParameter` flattened **every** rejection into a plain `Error`, discarding the archived classification before any surface could see it | An archived old link is rethrown unchanged and no failure notification is dispatched, because an archived record is a documented outcome rather than a runtime failure |

Files: `src/domain/parameters/archivedLink.ts` (new, +7 tests), `src/ParametersPage.tsx`, the parameter runtime,
and `src/styles.css`. The banner reports the parameter id, the diagnostic and the migration evidence id, and the
archived record is not offered for drafting or submission.

**Real authentication had to be established first, and doing so corrected an earlier claim.** The earlier
browser evidence was captured against `npx tsx server/index.ts` with default settings, which selects
`AUTH_MODE=development`. `createAuthContextResolver` consults the local auth service only when the mode is
`production`, so that server ignored every bearer token and every API call returned 401. An earlier note in this
report attributed those 29 console errors to "the bare lane DB". The real cause was the auth mode, and the
practical consequence is that the earlier browser session exercised **no** authentication. Running the API with
`AUTH_MODE=production AUTH_PROVIDER=local` plus a bootstrapped local admin yields `GET /api/v1/me` = 200 and the
archived lookup = 410 for the same session, which is what S1 asks for.

Evidence: `npx vitest run src/` **444 files / 3432 passed**; the notice verified in a real browser through the
real login form at 1440x900, 768x1024 and 390x844, including the dismiss control
(`work/ui-checks/849/*-archived-notice.png`). The remaining console errors in that session are the expected
pre-login 401 on `/api/v1/me` and the 410s for the archived id itself.

### 1.13b S2: the operator cutover path executed against a real database

The acceptance matrix recorded S2 as "Not run". That was too coarse in one direction and too generous in
another, and this round settles it with evidence.

**What already existed.** `server/modules/catalog-cutover` implements the pre-activation state machine (P0-P10),
the archive adapter, the classifier, the mapping writer, the checkpoint ledger and recovery, with a frozen
seven-row threat matrix. Its suites pass on real PostgreSQL. What had never run was the **operator path** - the
four `scripts/wayfinder/*-parameter-catalog-cutover.ts` entry points that an operator actually invokes.

**What this round added.** `scripts/wayfinder/parameter-catalog-cutover-cli.integration.test.ts` drives those
four real entry points (argument parsing, file loading, archive-root and key wiring included) through one
interrupted-then-resumed run against a disposable catalog database:

| Step | Result |
| --- | --- |
| `plan` | ok; the plan covers every pre-activation phase |
| `execute --fail-before-phase P7` | `PCAT-ORC-CRASH` - the injected interruption |
| `inspect --plan-digest` | checkpoints exactly `P0..P6`, no phantom phases |
| `execute` (resume) | `resumed: true`, `state: completed`, `liveRun: false`, all P0-P10 checkpoints; mapping and archive residue present |
| `inspect --run-id` | same plan digest |
| `recover --action drop-everything` | refused (no ad-hoc action) |
| `recover --action whole-state-restore` with a wrong token | `PCAT-ORC-INVALID-TOKEN` |
| `recover --action whole-state-restore` with the run-bound token | ok, `state: recovery-required`; live mapping **heads** rolled back to the P3 point, append-only mapping **versions** retained |

The last row is worth stating precisely, because it is the archive/recovery disposition: the restore returns
the inventory to the P3 baseline (the recovery path itself refuses on any dump drift with
`PCAT-ORC-ROLLBACK-DRIFT`), while `legacy_mapping_versions` stays as immutable evidence. The first version of
this test asserted the version rows were deleted and failed; the assertion was corrected to the real contract
rather than the contract being bent to the assertion.

The duplicated populated-cutover fixture (`populatedCutoverGraph` plus `seedPopulatedCutover`, ~135 lines
copied verbatim in two suites) was moved to `server/testing/parameterCatalog/cutoverPopulatedFixture.ts`, so the
CLI test and the orchestrator tests now share one populated-catalog definition.

**Still not run, and why.** The Docker-based rehearsal artifact scripts
(`export-`/`import-parameter-catalog-rehearsal.sh`) need a `wiseeff-postgres-1` compose container and a host
`psql`. Neither exists here: `parameter-catalog-rehearsal.integration.test.ts` fails 15 cases with
`psql: ... database "wiseeff_wayfinder671_*" does not exist`, i.e. an environment failure before any assertion,
not a product defect. Quiescence and a target-host rehearsal therefore remain unproven, and this report does not
claim them.

Evidence: `server/modules/catalog-cutover` **9 files / 54 passed**; `scripts/wayfinder` CLI **5 files / 11
passed**, including the new case, green on three consecutive runs.

### 1.13c The frontend draft tray was a legacy mixed read; the contract gap is closed

Auditing scope item 1's "remove legacy fallback and mixed reads" against the frontend turned up a verified
defect rather than a tidy state. The workbench draft tray **wrote canonical and read legacy**:

| Direction | Endpoint | Table |
| --- | --- | --- |
| Create | `POST /api/v2/projects/:id/parameter-bindings/:bindingId/drafts` | `project_parameter_value_drafts` |
| List | `GET /api/v1/parameter-drafts/mine` | `parameter_drafts` |
| Remove | `DELETE /api/v1/parameter-drafts/:draftId` | `parameter_drafts` |

Two consequences followed from the server side. `saveDraft` refuses in `semantic` identity mode (`CONFLICT`,
"Legacy parameter drafts are retired..."), which is the mode the API server runs, so the legacy table is never
populated; and the legacy delete matched nothing, so removing a canonical draft from the tray was a silent no-op
while the canonical row stayed alive. Meanwhile `GET /api/v2/projects/:id/parameter-value-drafts` and
`DELETE /api/v2/projects/:id/parameter-value-drafts/:draftId` had **no consumer and, for the delete, no client
method at all**.

Closed this round:

1. `catalogBindingDraftDtoSchema` and the canonical draft DTO now carry `reason`. The tray shows the author's
   reason, and without it in the list response the tray could only render an empty reason after a reload -
   the canonical owner stored it and never exposed it.
2. `deleteProjectValueDraft` was added to the catalog client, addressing the canonical DELETE route, together
   with the exported `projectValueDraftRemovedResponseSchema`.

Evidence: `drafts.integration.test.ts` asserts the reason survives the reload against real PostgreSQL
(11 tests); `parameterCatalogClient.test.ts` asserts both canonical URLs and methods (10 tests); the OpenAPI
artefact was regenerated and the contract check is current.

**What was deliberately not started.** Wiring `ApiProjectTopologyWorkspace` off `createHttpParameterRepository()`
needs a canonical-to-tray adapter, and the tray's `ParameterDraftDto` requires `updatedAt` and `parameterId`,
which the canonical list DTO does not expose - so it is a further additive contract step plus plumbing. It also
cannot be verified end to end until canonical bindings exist on a database (B2). It is recorded as gap **B5**
rather than half-applied.

### 1.13d Frontend suite flakiness, stated precisely

The full `src/` suite is green at **444 files / 3433 tests** when run with `--maxWorkers=2`. Under the default
worker count, two timing-sensitive suites fail nondeterministically and the failing pair changes between runs
(knowledge reference picker and feedback admin on one run; two debugging suites on the next), and each suite
passes in isolation. This is reported as load-induced flakiness with the reproducible green command, not as a
pass.

### 1.13e B2 measured: the real DTS slice materializes, the gate is subject registration

B2 was recorded as "canonical binding/value materialization awaits a published seed release". The vendor
successor is now published and acme is retired, so this round replaced that framing with the measured cause.

Two additions:

1. **A real project source slice.** `src/config/seed-sources/{atlas,aurora,nebula}/vendor-drivers.dts` declare
   three vendor drivers (`huawei,wireless_charger`, `huawei,wireless_sc`, `sc8562`) with five of the 113 vendor
   properties and concrete values, matching the value schemas the installed release actually publishes
   (`pmax`: `array<integer>=0`, `init_para_col`, `fcp_support`, `ic_role`, `sense_r_config`). The header states
   plainly that it is a demonstration source, that it covers 5 of 113 properties, and that the 8
   YAML/TOML/ENV items stay deferred to TD-124 rather than being converted to look complete.
2. **An integration test on real PostgreSQL** that installs `crel_acme_1`, advances the real vendor successor,
   reads those files from disk, and runs the seed materializer. The source plane completes: a config set, a
   `resolved` revision, and 8 observed properties per project (`compatible` plus the 5 declarations), attributed
   to the vendor subjects and never to acme. The definitions the slice names are present in the installed
   release. Bindings written: **0**.

The zero is the finding, and it is one line in `catalogProjectValueSync.ts` - a binding needs an **active
organization-subject registration**, and seed initialization creates none. Registration is a governed command
(method, proof, module placement, idempotency key, expected release), and having seed initialization register
subjects on an operator's behalf is a reviewed decision, so it is recorded as **B6** rather than invented here.
The test asserts the zero *and* the absence of registrations, so landing seed-time registration will fail it
loudly and force the count to be updated.

Also corrected in the matrix: `recovery.integration.test.ts` and `orchestrator.test.ts` had each carried a
verbatim copy of `populatedCutoverGraph` and `seedPopulatedCutover` (about 135 lines); both now import
`server/testing/parameterCatalog/cutoverPopulatedFixture.ts`.

### 1.13f The vendor source slice grows from 5 to 25 properties, and one recorded gap is withdrawn

Two things happened here: real content progress on scope item 2, and the withdrawal of a gap entry that would
have led a later round to do the wrong work.

**The slice.** `src/config/seed-sources/{atlas,aurora,nebula}/vendor-drivers.dts` now declares **25 of the 113
vendor properties** across the four driver subjects the vendor successor publishes - `huawei,wireless_charger`
(5), `huawei,wireless_sc` (5), `mt,mt5788` (7), `sc8562` (8) - each with a concrete value that satisfies the
value schema the installed release actually publishes for that definition (`array<integer>=0`, `array<string>`
or `string`). The file header records the exclusions rather than hiding them: `gpio_en` (mt,mt5788) and
`gpio_int` (mt,mt5788 and sc8562) are **not** declared because their published definitions carry
`{"description":"mixed"}` with no type, so there is no schema to satisfy and declaring them would be guessing;
the remaining 88 properties are unconverted; and the 8 YAML/TOML/ENV items stay deferred to TD-124 instead of
being converted to look complete.

The materialization test asserts the source plane exactly: **29 occurrence effects per project** - the 25
properties plus each node's own `compatible` declaration - all attributed to the vendor subjects and never to
acme, with every one of the 25 property names present and its definition confirmed in the installed release.
It still writes **0** bindings, which is B6, unchanged.

**The withdrawn gap.** "Complete demo DTS baselines with the 29 dangling overlay targets resolved" was listed
as remaining work. It should not have been. `server/modules/dts/danglingAnchorStub.ts` documents the contract:
at L1 an unresolved `&label` is a `dangling-reference` **warning** that self-anchors ("Not fail-closed"), and at
L2 an **ephemeral** stub may be prepended for `dtc` - a stub that "MUST NOT be persisted as a config-set
member, exported to Git, or written back". `goldenPowerFixture.test.ts` locks the same model over a 50-node,
176-property board and says so in a comment: "Overlay-only board (synthetic base tree retired): `&label` targets
self-anchor."

Committing a base tree defining all 29 labels would fabricate authoritative nodes for external drivers, and the
`vendor-drivers.dts` header above now states the overlay-only intent so the mistake is harder to repeat. The
genuine remaining item in that area is narrower: the L2 ephemeral-stub path is proven against the in-repo
resolver (`danglingAnchorStub.test.ts`), not against a real `dtc`/`fdtoverlay` toolchain.

### 1.13g The first canonical bindings materialize, after two hidden defects are fixed

Until this round the statement "canonical binding materialization writes 0 bindings" was true for a reason the
matrix attributed to registration alone. Building a test that registers subjects exposed **two** defects behind
that zero, and both are now fixed.

**Defect 1 - node-type subjects were unresolvable.** `catalogProjectValueSync` passed
`nodeTypeFallback: { kind: "absent" }` unconditionally. The published vendor successor carries 33 driver subjects
and 15 node-type subjects, and **33 of the 113 vendor properties belong to node-type subjects**, so a third of
the seed could never bind regardless of what the source declared. A new shared `resolveObservedSubject` keeps the
existing rule - a declared `compatible` wins - and consults the node-name fallback only when the source declares
none, taking the name from the observed node revision.

**Defect 2 - the sync was called outside a transaction.** `materializeSeedSources` handed the sync a bare client,
so the binding unit of work's `SAVEPOINT` failed with *"SAVEPOINT can only be used in transaction blocks"*. Every
binding write was doomed, but the failure was unreachable while registration blocked the loop first. The
per-project sync now runs inside `root.transaction(...)`, which also makes a half-materialized project impossible
to record as complete.

**The result.** `nodeTypeSubjectBinding.integration.test.ts` installs the real release lineage, registers two
node-type subjects (as a test fixture - *whether* seed initialization should register is B6), materializes the
real DTS slice, and asserts **30 canonical bindings with values**: 10 per project, 5 per node-type subject, and a
current value on every binding. The driver properties stay unbound there because no driver registration exists,
which is the same evidence read in the other direction: the fallback fires only for node-name identity.

**The source slice also grew, from 25 to 35 of the 113 vendor properties** - the 25 typed driver properties plus
10 typed node-type properties (`batt_l_v800`, `batt`) declared without a `compatible`, so the node-type path is
exercised by real source rather than a synthetic fixture.

**One correction to B4.** B4 claimed `charging_core` is not a canonical node name because "the canonical grammar
excludes `_`". That is false: `parseCanonicalNodeName` accepts `/^[A-Za-z][A-Za-z0-9,._+-]{0,30}$/`, underscores
included, and the vendor successor publishes 15 underscore-bearing node-type names. The naming half of B4 never
existed and needs no human decision; only the nested-array capability blocker remains.

### 1.13h The complete example DTS baseline, generated from the reviewed manifest

Scope item 2 asks for "real source files" and a "complete example DTS baseline". The hand-written slice covered 35
of the 113 vendor inputs; this round replaces it with a generated baseline covering **96 of the 113**.

**Why generating from the manifest is not circular.** The seed reconciliation manifest is the reviewed
semantic-alignment artifact, so it is legitimate input for a source file. The generated file is then resolved
*against* the published Catalog release by the integration tests, which is the independent check. Deriving the
source from the release instead would make every catalog/vendor mismatch invisible, so the generator reads the
manifest and never the release. Values come from the reviewed `valueShape`, not from the release schema.

**What it emits, and what it refuses to.** 96 inputs across 26 driver subjects and 11 node-type subjects, grouped
into one DTS node per subject: driver nodes declare `compatible`, node-type nodes declare none so that node-name
identity is what resolves them. **17 inputs are deliberately not expressed** - `mixed` (10) because the reviewed
shape carries no type, and `bytes` (5) and `bool` (2) because a DTS literal for them would have to be guessed, and
a file that parses but means something else is worse than an honest gap. The header states the coverage and the
exclusions, and the 8 YAML/TOML/ENV compatibility items stay deferred to TD-124.

`npm run vendor-source:generate` writes the three files and `npm run vendor-source:check` fails on drift, so the
baseline cannot silently rot.

**Verification.** The materialization test no longer hardcodes a property count. It derives the expectation from
the reviewed manifest - which inputs exist, which shapes are expressible, how many driver nodes contribute a
`compatible` row - and then asserts the whole source plane against it: **122 observed occurrence effects per
project**, every manifest property key present, node-type rows carrying no `compatible`, and every definition
present in the installed release. Node-type binding materialization still passes unchanged.

**B6 got sharper, and smaller.** An earlier revision asked whether seed initialization may register subjects.
Reading the contract answers that: it may - `validateRegistrationCommand` pre-authorizes `method: "automatic"` for
`actorKind: "trusted-system"` with `placement.mode: "use-default"`, gives it `origin: "auto"`, and only forbids
auto-restoring a retired registration. The undecided part is the **module**: a registration still needs a
`destinationModuleId`, a `node-type`/`driver-group` module must carry an `attribution_subject_id`, and nothing
provisions modules automatically because the module tree is curated, user-visible structure. So the open question
is whether seed initialization may create modules named after the seed's subjects or must resolve to curated
ones - narrower, and answerable.

### 1.13i The example DTS baseline reaches all 113 vendor inputs

The previous round left 17 inputs unexpressed because a literal representation for `mixed`, `bytes` and `bool`
looked like a guess. It was not: the reviewed vendor metadata carries an `exampleValue` in DTS syntax for every
property, so the generator now emits that value instead of inventing one.

| Shape | Vendor `exampleValue` | Emitted as |
| --- | --- | --- |
| `bytes` | `/bits/ 8 <0 1 1 5 6>` | the byte-string form, verbatim |
| `mixed` (GPIO) | `<&gpio2 26 0>` | the phandle-array form, verbatim |
| `bool` | `""` | the DTS presence form, `prop;` |
| `u32-array` / `string-list` / `phandle-list` | the reviewed example | verbatim |

All three forms parse (`resolveDts`) and survive the writeback path, so the baseline is now **113 of 113** across
27 driver subjects and 12 node-type subjects, with **zero** inputs omitted and nothing read from the published
Catalog schema. The materialization test asserts **140 observed occurrence effects per project** (113 properties
plus one `compatible` row per driver node), derived from the manifest rather than from the file.

A new `scripts/generate-vendor-project-source.test.ts` (5 tests) covers what the `--check` script did manually:
every reviewed input is expressed and none skipped, generation is deterministic, the committed files equal the
generated text, driver nodes declare `compatible` while node-type nodes declare none, and the emitted literals
really come from the vendor metadata (`/bits/ 8 <`, phandle arrays and a presence-form property are all present,
and the earlier placeholder `demo-a` is gone).

### 1.13j B5: the draft contract and the tray seam, without shipping an unverified switch

B5 is the verified frontend mixed read: the tray **wrote canonical and read legacy**. Closing it needs three
things, and this round finished the first two - the ones that are provable - and deliberately stopped before the
third.

1. **The list contract gained `updatedAt`.** The tray orders and labels drafts by recency, so the timestamp
   belongs in the canonical pending-draft response rather than being inferred from request order. `reason` had
   already been added; the OpenAPI artefact was regenerated and is current.
2. **The tray seam now accepts canonical-shaped drafts.** `TrayHydrationDraft` is the port DTO with
   `parameterId` optional, `PendingBindingDraftCore` no longer requires it, and the workspace's draft state and
   `resolveSharedWorkingTip` were narrowed to match. For a canonical draft `parameterId` is **absent**, not
   fabricated: the canonical model has no parameter record, the tray never reads the field (it keys off `draftId`
   and `projectParameterBindingId`), and inventing an id from another entity would be exactly the kind of
   silent mixed identity this issue is about. `canonicalDraftsToTrayDrafts` maps the canonical list onto the
   seam, with 4 tests.

**What was not started, and why that is the honest call.** The last step is switching the two call sites
(`ApiProjectTopologyWorkspace`'s `listDrafts`/`deleteDraft`, fed from `ParametersPage`) off
`createHttpParameterRepository()`. The canonical `DELETE` needs a `CatalogWriteContext` - the current catalog
release id and an idempotency key - which the parameter workbench does not assemble today. Adding that plumbing
and flipping a live read path without being able to exercise it against real canonical drafts (impossible until
B6 is decided) would ship an unverified behavioural change. So the seam is in place, the legacy read is
unchanged, and the remainder is recorded with its missing prerequisite.

### 1.13k Scope item 4: the legacy parameter plane is archived offline before a rebuild

The seed rebuild replaces a project's parameters. Scope item 4 requires the previous plane to be preserved
offline first, and nothing did that.

**What was added.** `0149_project_parameter_plane_archives.sql` is a ledger of archives, and
`server/modules/parameter-bindings/seedInitialization/archive.ts` captures the plane itself:

| Element | Behaviour |
| --- | --- |
| Archived plane | 32 declared per-Project relations - legacy and canonical drafts/history/reviews, config sets/baselines/revisions, stable logical identities, bindings/revisions, source files/candidates/versions, canonical values, and project-local governance records |
| Child scoping | `parameter_review_decisions`, `parameter_submission_items`, `project_parameter_binding_revisions` and `project_parameter_file_versions` carry no `project_id`, so they are reached through their parent instead of being silently skipped |
| Artifact | One v2 JSON document written to the object store, carrying provenance, `truncated`, stable-primary-key-ordered rows, and checksum-verified bytes for every referenced file version or unactivated candidate; relation JSON and aggregate source bytes each have a 64 MiB bound |
| Idempotency | `archive_digest` covers the scope, the counts and the content digest, so re-capturing an unchanged plane reuses the object rather than writing a second one |
| Bound | Relation JSON size is preflighted before rows are returned; source objects, archive reuse and the rebuild guard use bounded local/S3 reads; S3 error detail is bounded too. Each relation also has a 5,000-row cap whose overflow sets `truncated` |
| Guard | `assertProjectParameterPlaneArchived` validates the exact archive ID/digest returned by capture and refuses missing, truncated, torn or byte-incomplete artifacts |
| Ordering | `materializeSeedSources` archives each target and then requires the guard to pass, before it uploads a single seed source |

**Capture only, on purpose.** Nothing in this change deletes, truncates or rewrites the archived rows, and the
ledger deliberately has no column that could imply disposal happened. Removing the archived plane needs its own
reviewed decision, and the run report records it as remaining work rather than quietly implementing it.

**Verification.** `archive.integration.test.ts` (14 tests, real PostgreSQL) asserts the 32-relation graph, exact
external FK/trigger/view closure, non-zero preserved observations/matches, embedded version/candidate bytes,
parent scoping and cross-Project isolation, idempotent reuse, missing or over-cap source/document refusal,
and fail-closed handling for missing, truncated, torn, tampered or substituted archives, plus authorization and
schema-retention constraints.
`materialize.test.ts` and both binding-materialization tests still pass with the archive step in place.

### 1.13l B5 closed: the tray reads and removes canonical drafts

The last two call sites are switched, and an earlier assumption in my own notes turned out to be wrong.

**The assumption.** I had recorded the remaining work as needing a `CatalogWriteContext` (catalog release id
plus idempotency key) for the canonical `DELETE`, and stopped a round short of it rather than ship an unverified
switch. Testing the route showed the requirement does not exist: `DELETE /api/v2/projects/:projectId/parameter-value-drafts/:draftId`
enforces auth and project edit permission and reads **no** catalog-release or idempotency header, unlike the
publication routes. The demand came from the client method's own signature, so the fix was to make the context
optional - the request layer already omits absent headers.

**The wiring.**

| Change | Effect |
| --- | --- |
| `createCanonicalDraftTraySource()` (new) | Reads the canonical pending-draft list through the adapter and deletes through the canonical route; `ParametersPage` injects it as the tray's `listDrafts`/`deleteDraft` in API mode |
| `ApiProjectTopologyWorkspace` builds no draft client | Both internal fallbacks are gone. A missing prop now means "no server drafts" with a typed refusal on removal, instead of an implicit legacy read |
| `parameterCatalogClient.deleteProjectValueDraft` | Optional context, with the reason recorded next to the signature |

Removing the workspace's fallbacks was not optional: its own suite asserts the default seam performs no fetch,
and the only way to satisfy both that invariant and the canonical read is for the component to stop constructing
clients. The suite now asserts the opposite of what it used to - that **no** parameter-repository factory is
called - so the legacy read cannot creep back as a fallback.

**Evidence, and its limit.** `canonicalDraftTraySource.test.ts` asserts both canonical URLs and that no
`/api/v1/parameter-drafts` call is made in either direction; the adapter has 4 tests and the tray seam is
covered by the workspace's existing hydration test; the full frontend suite is **446 files / 3438 tests** green.
The live path is still unverified with real data, because canonical pending drafts cannot exist until canonical
bindings do (B6) - so the tray has not been exercised against a real canonical draft, in a browser or otherwise.

### 1.13m B6 resolved: registration is automatic and completion fails closed

Two rounds ago I recorded B6 as "may seed initialization register subjects?" and last round narrowed it to "may it
provision modules?". The registration path is pre-authorised, but the reviewed real slice proves that placement
capacity is not automatically sufficient: `csub_drv_sc8562` is one free driver module short. ADR-0046 leaves that
user-visible structure under operator control.

`seedInitialization/registration.ts` resolves the subjects a materialized revision actually references - only those
owning a published definition, so an unrelated `compatible` cannot drag one in - and registers each through the
contract's pre-authorised path (`automatic`, `trusted-system`, `use-default`, idempotency keyed on the seed digest,
with the seed digest, project and subject kind as proof). `materializeSeedSources` runs it between ingest and the
value sync, and module resolution takes an existing module of the kind the placement guard requires that does not
already host a placement, preferring curated over auto-provisioned.

**What my earlier analysis got wrong.** DTS ingest provisions most of the modules, not necessarily all required
placement capacity. The successful `nodeTypeSubjectBinding` fixture now supplies one explicitly operator-curated
driver module; the seed itself creates none.

**Follow-up (2026-09-16): fail-closed completion is implemented.** ADR-0046 rejected automatic module creation.
Materialization now stages and preflights every target before any canonical value sync. When
`unregisteredSubjectIds` is non-empty, it journals the run as `failed` with one `missing-placement-module` blocker
per project and subject, then throws `SeedInitializationBlockedError`. `getSeedInitializationRun` returns those
blockers; a retry preserves them while `running` and only successful completion clears them. The adversarial real-
PostgreSQL case puts the blocker on the last target: the prior per-project flow wrote two bindings before failing,
while the two-phase flow writes zero.

**Observed boundary.** The unmodified real slice records three `csub_drv_sc8562` blockers, one per project, and zero
bindings. With the missing capacity explicitly curated, the success fixture proves registrations, bindings and
current values can complete. The exact reviewed seed oracle remains unfinished, so this local fixture is not a
target-environment readiness claim.

**One correction to the documentation itself.** While writing this up I found that the B6 entry had been
accidentally deleted from the acceptance matrix a few rounds earlier, when a neighbouring block was rewritten; two
places still referenced it. It is restored with the outcome, and the stale B2 forward reference is corrected. The
lesson is recorded rather than quietly fixed: block-slicing edits on a long document need an anchor check after
every replacement, not only before.

### 1.14 The JSON and DTS compatibility seeds are not in the successor

Withdrawn: an earlier revision claimed the two JSON compatibility seeds entered the successor as a formal
`configuration-schema` subject (`csub_wiseeff_power_config`). No such subject exists in the tree, and the
successor carries **0** `configuration-schema` subjects. The JSON seeds have no semantic ingest path (B1), and
the two DTS compatibility seeds cannot be published as-is (B4: a nested 3x4 cell array outside the capability
allow-list, and a `charging_core` node name that the canonical grammar excludes). Both are carried in the
acceptance matrix.

## 2. Per-item result against this round's stated scope

| # | Requested scope | Result | Evidence |
| --- | --- | --- | --- |
| 1 | All parameter entry points and direct cross-module references on the new Catalog; remove legacy fallback, mixed reads and dual writes; connect import, view, draft, submit, approve, apply, source writeback, history and export | **Delivered for the canonical path.** The four named coexistence defects are removed; view, draft, submit, review, apply, source writeback, canonical binding history and canonical export now run on the canonical owners. Cross-module consumer rewiring remains | §1.1, §1.5, §1.7, §1.9; remaining work in §4 |
| 2 | DTS and JSON only; semantic alignment of the 113 vendor inputs and the four current compatibility seeds; real source files; complete example DTS baselines; JSON software configuration uses ConfigurationSchema | **Partial.** The 125-input inventory and the four real compatibility source files with exact locators are delivered and fidelity-tested. The 113 vendor inputs are reconciled but not semantically converted; the complete demo DTS baselines are not authored; the **acme retirement is delivered**, and ConfigurationSchema slices A-C (subject kind, storage closure, install/runtime/capability) are implemented — what is missing is the JSON source-identity ingest path (B1) | §1.3, §1.6 |
| 3 | YAML/TOML/ENV project sources and their 8 seeds to TD-124; refuse these formats explicitly; keep vendor YAML Catalog metadata reading and publication | **Delivered** for the refusal and the TD-124 record; vendor YAML metadata import verified unchanged | §1.2, §1.4 |
| 4 | Rebuild by seed: preserve non-parameter data; archive legacy parameter data, drafts, history and source files offline; initialize only Atlas/Aurora/Nebula; archived notice on old links; retire acme but keep release history | **Partial.** The acme retirement and the archived old-link notice are delivered (see 1.13 and 1.13a). No offline archive and no project initialization was executed. Reconnaissance (`cutover-consumers-recon.md`) confirms the reusable seams and what is genuinely missing | §4 |
| 5 | S1/S2 acceptance: real auth, PostgreSQL, source store, publication manager, archive rebuild, interruption/resume, whole-state recovery; frontend real-browser verification at three sizes | **Partial.** Real PostgreSQL and real-browser verification were exercised for the delivered slice, and real authentication is now genuinely established (see 1.13a). S2 archive-rebuild, interruption/resume and whole-state recovery were **not** run. The three-viewport check covered the import wizard only, not the full operation matrix | §3 |

## 3. Verification evidence

All commands were run in the Scratch worktree with a dedicated lane database
(`postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_lane_849`, provisioned with
`npm run catalog:lane:env -- provision --issue 849`); the shared compose database was not used.

| Command | Result |
| --- | --- |
| `npx tsc -b` | exit 0 |
| `npm run build` | exit 0 (production build) |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-bindings` | 17 files / **74 passed** (baseline 16 files / 68) |
| `npx vitest run --config vitest.server.config.ts server/modules/contracts` | 7 files / **51 passed** |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-bindings/drafts/drafts.integration.test.ts` | 1 file / **10 passed**, three consecutive runs (draft invariant + submit/review/apply + canonical change history, real PostgreSQL) |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-bindings server/modules/contracts server/modules/parameter-drafts server/modules/parameters` | 69 files / **397 passed** |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-files server/modules/parameter-topology` | 60 files / **509 passed** |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-files` | 41 files / **316 passed**, twice in a row |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-bindings server/modules/contracts server/modules/parameter-drafts server/modules/parameters server/modules/parameter-files server/modules/parameter-topology` (consolidated affected set, no overlapping DB process) | 130 files / **934 passed** |
| `npx vitest run src/application/parameters src/components/ParameterImportWizard` | 38 files / **197 passed** |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-files/seedSources.fidelity.test.ts` | 1 file / **18 passed** (real compatibility sources: locators, literals, byte-preserving patch, manifest digests) |
| `npx vitest run --config vitest.scripts.config.ts scripts/seed-reconciliation-manifest.test.ts` | 1 file / **14 passed** |
| vendor Catalog YAML import (`vendorAdapter`, `vendorCoexistence.integration`) | **25 passed** |
| `npm run seed:reconcile:check` | exit 0 (drift detected in a temp copy) |
| `npm run contract:openapi` then OpenAPI check | exit 0, artifact current |
| `npm run db:schema-doc` then `docs:check` | exit 0, artifact current, governance passed |
| `tsx scripts/check-parameter-catalog-boundaries.ts --trusted-base-sha 8f03cfa4…` | **passed**: 3513 violations, 3513 allow-listed, **0 unallowlisted, 0 stale** |
| `npx vitest run --config vitest.server.config.ts server/modules/catalog-publication server/modules/catalog-kernel` (**round 21**) | 50 files / **492 passed, 1 failed** — the single failure is the pre-existing `catalogRoles.integration.test.ts > application, agent, and verifier logins are not members of Catalog writer roles`, which also fails on pristine `origin/main` |
| `npx vitest run --config vitest.scripts.config.ts scripts/compile-vendor-catalog-release.test.ts scripts/install-catalog-release.test.ts` (**round 21**) | 2 files / **10 passed** |
| `npm run catalog:compile-vendor` (**round 21**) | prints `digest=sha256:5f0e7bcd…`, `counts=48 subjects / 1 alias / 114 definitions`, predecessor `crel_acme_1` unchanged |
| `npm run docs:check` | passed |

Browser verification (real browser via `playwright-cli`, API-mode frontend on `127.0.0.1:5173` against the real API on `127.0.0.1:8787`, local account on the lane database):

- Route `/parameter-admin` → "批量参数导入" wizard step 1, both the paste path and a real `.yaml` file upload.
- **YAML refusal observed**: "暂不支持 YAML 格式的参数文件导入，请改用 xlsx、csv、json、dts 或 dtsi 文件。" at step 2, for both the pasted YAML and the uploaded `params.yaml`.
- **Positive control**: uploading `config.json` produced no unsupported-format message, i.e. no silent broad refusal.
- Viewports 1440×900, 768×1024, 390×844: `document.documentElement.scrollWidth - clientWidth === 0` at all three (no horizontal overflow); snapshots and screenshots captured.
- Console: 29 errors, **all** HTTP 401 from the bare local lane database (no seeded projects/threads for this account). No JavaScript exception and no layout error was observed.
- Screenshots: `work/ui-checks/849/desktop-1440x900-yaml-refusal.png`, `tablet-768x1024-import-wizard.png`, `mobile-390x844-import-wizard.png`.

## 4. Not delivered, skipped and failed

Nothing in this round is reported as delivered that is not listed in §1.

**PU-01 attempt record (this round).** The R3 threat matrix was written first (`849-inventory/configurationschema-threat-matrix.md`, 16 rows). The extension was then implemented across the contract enums and the new `parseCanonicalConfigurationSchemaId` parser, the kernel compiler types/rules/validation, the runtime matcher (a third resolution step that never consumes the node-type fallback), the three-way JSON-Schema branch, the capability revision bump to `catalog-capability/v3` with v1/v2 still admitted, the pinned S0-ID serialization golden and its blob/length/SHA pins, append-only migration `0146`, and the DTO/API unions. Reaching a consistent state required deliberate updates to **five frozen security fingerprints** (the S2-SCH schema fingerprint, the ACL fingerprint, the frozen canonical relation count 44 → 45, the compiler contract golden, and the capability contract digest) plus role-manifest grants and ownership for the new table and predicate. Those gates exist precisely so a schema/ACL change cannot be absorbed silently, and updating them is not a mechanical act. Rather than leave those gates failing or write observed values into security pins without independent review, **the entire PU-01 change set was reverted**; the delivered artifact for this attempt is the threat matrix and the recorded file map. A dedicated round with a Spec reviewer should land it.

**Not started (largest remaining risk):**

1. **PU-01 ConfigurationSchema (Slice A landed; Slices B and C open — see §1.8).** Reconnaissance found the change surface is not local: a new migration must alter five closed CHECK constraints and six trigger functions in `0137`, the subject/selector enums and normalization, `schemas/dts/catalog-release/*` including a **byte-pinned serialization golden**, the compiler strict schema and its compiled-release golden, the installer, runtime matching and snapshot, the catalog cache and verification, the publication capability revision (with its admission list), the API DTOs and generated OpenAPI, the registration/placement guard, the release-verification count gates, the frontend presentation layer, and `catalogRoleManifest.ts`. This is an R3 change that needs a threat matrix before implementation; it was not attempted rather than half-applied.
3. **Reviewed real source files** for `charge_voltage_limit_mv`, `battery_temp_target_c`, `dts_fast_charge_profile_matrix` and `battery_thermal_derate_curve`, and the complete self-consistent demo DTS baselines with the dangling overlay targets resolved. The manifest records the dispositions; the files do not exist yet.
4. **Seed publication and three-project initialization.** The acme retirement is done, but no seed release carrying the seed definitions was published, so canonical binding/value materialization still writes zero bindings, and no project was initialized.
5. **Archive-rebuild profile and S2.** No archive, no quiescence proof, no interrupted resume, no whole-state restore rehearsal. Reconnaissance confirmed the archive adapter, classifier, mapping lookup, checkpoints and the self-hosted controller are real and reusable, and that the genuine gaps are the reviewed rebuild-disposition contract, the missing operator surface for the four cutover operations, the local-filesystem-only archive destination, and the P11–P16 phases that remain declared unavailable.
6. **Cross-domain consumer switch** (Agent, logs, knowledge, debugging, DTS reload) and the **full browser operation matrix**. The wizard check is not a substitute for the Issue's operation matrix.

**Known gaps in what was delivered, stated plainly:**

- The canonical import **preview** still classifies an unmatched row as `added` (inherited from `createImportPreview`). Applying such a row is now impossible through this route — `apply` refuses unbound rows — but the preview is still misleading. Fixing it properly needs a new classification value, which touches the DTO, the summary counters, `status.ts` and the frontend.
- The `GET` canonical binding list does not surface pending drafts inline; the tray must call the new drafts route.
- The **draft creation** route still returns a legacy-shaped response (with the real draft id and canonical pins added) so the existing workbench keeps working; the canonical `catalogBindingDraftDtoSchema` contract is not yet the wire shape of that one route. The new submit/review/withdraw routes do use the canonical contract.
- `server/modules/parameters/service.test.ts` was reverted to `origin/main` after an added test changed the catalog-boundary allow-list fingerprint for that file; the equivalent refusal coverage lives in `importDtsParse.test.ts`.

**Harness limitation found this round (not a product failure):** running the whole 129-file affected set with default file parallelism repeatedly produces transient failures with `database "wiseeff_test_*" does not exist`, `terminating connection due to administrator command` and `Connection terminated unexpectedly`. Each suite provisions and drops its own ephemeral database, and a drop force-terminates connections that sibling workers still hold. The same suites pass in isolation and in two consecutive full-directory runs, so the consolidated set is re-run serially for a trustworthy signal. This is an existing local test-harness characteristic, recorded here because it was mis-reported as an unexplained single flake in the previous round.

**Failures:** none in the final state. No test, typecheck, build, contract, documentation, or boundary gate failed. Two intermediate failures were fixed and are not being reported as passing skips: the routes unit test initially asserted the old direct-save behaviour, and the seed-reconciliation test initially measured the wrong value count.

**Reported, not fixed (out of this round's authority):**

- The plan's "24 dangling overlay targets" figure is **not reproducible**. Two independent measurements found **29** distinct unresolved `&label` overlay targets and **37** missing `&name` references per board. The manifest stores 29 and records the discrepancy instead of fabricating 24.
- The two `gpio_int` vendor inputs still block the production importer. The manifest documents the exact required transformation; the importer was deliberately not changed this round.

## 5. Evidence levels and what they do not prove

- **Local real PostgreSQL** (dedicated lane database): yes, for the draft owner, the route boundary, the format refusal and the seed manifest.
- **Browser-real**: yes, for the import wizard at three viewports.
- **Hosted/CI**: not run (no PR was opened).
- **Target-host and hardware**: not run, not authorized.
- No claim is made that the canonical workflow, the seeds, the archive rebuild or ConfigurationSchema are product-ready. The Issue stays OPEN and `ready-for-agent`.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Updated | `docs/exec-plans/active/2026-09-14-parameter-unification-and-seed-parity.md` status, this round report, `849-inventory/README.md`, bilingual TD-124 rows |
| Architecture/domain | Updated | `docs/adr/0045-configuration-schema-subject-and-seed-rebuild.md` + Chinese companion, `docs/adr/README.md`, `CONTEXT.md`, `docs/design-docs/domain-model.md` + Chinese, API-transition and cutover-archive-rollback docs + Chinese, `docs/PLANS.md` + Chinese |
| Product specs | Review — no change claimed | Schema subject kinds are not yet implemented, so product-spec text is unchanged this round |
| Quality/testing | Review | The affected suites and the boundary/contract/schema-doc gates were run; the Issue's full operation matrix is not yet covered |
| Operations | Review — no change | No archive-rebuild operator change was made this round |
| Security/governance | Review | New `UNSUPPORTED_FORMAT` error code; canonical draft writes still pass the trusted sensitive-node check and audited write |
| Generated artifacts | Updated | `docs/generated/openapi.json`, `docs/generated/db-schema.md`, `docs/generated/seed-reconciliation-report.md` |

## Documentation Update Gate

The plan status, ADR-0045 pair, TD-124 pair and this report pair are updated and pass `npm run docs:check` plus `git diff --check`. Generated artifacts are regenerated and current. Nothing in this round claims target execution, deployment, Hosted CI, or completion of the deferred packages.

## 6. Later T0.3 addendum: retrospective R3 correction for migrations 0148/0149

#853 T0.3 later audited the already-delivered migrations rather than pretending the review happened before
implementation. The [retrospective threat matrix](849-inventory/migrations-0148-0149-r3-threat-matrix.md)
records the boundary. The correction candidate binds the requested Organization to authentication, authorizes all
targets before journaling or completed replay, serializes the fixed Organization scope across processes and seed
digests, makes `completed` terminal, and verifies the exact v2 archived object, 32 per-Project relations, source
bytes, and separately bounded relation/object paths before rebuilding. Real-PostgreSQL evidence is now 7 plan,
14 archive and 7 materialization tests. Capture still does not mean disposal; target quiescence, recovery and any
deletion remain #853 T2.3/T3.3 obligations.
