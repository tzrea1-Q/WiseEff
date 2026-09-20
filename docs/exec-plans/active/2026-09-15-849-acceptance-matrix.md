# Issue #849 acceptance matrix and operating instructions

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-15-849-acceptance-matrix.md)

2026-09-16 execution amendment: the [complete #849/#853 todo list](2026-09-16-849-853-closure-todolist.md) records the current order and per-todo user confirmation. The user explicitly replaced this program's prospective three-viewport acceptance with one PC viewport, `1440x900`; all operation and S1/S2 gates remain. Historical viewport results remain historical evidence; T0.6 reconciles older status narratives.

Current reconciliation: 2026-09-16, `origin/main@4010a600f`; #849/#853 remain OPEN. #858 and T0.1–T0.5 are merged; [report section 0](2026-09-15-parameter-unification-round-report.md#0-current-reconciliation--2026-09-16-t06) owns current facts. Older test counts below belong to the original Scratch candidates (base `8f03cfa4…`), not a rerun here or final candidate qualification.

Narrative and per-section detail: [round report](2026-09-15-parameter-unification-round-report.md). Requirement-to-implementation mapping for the deferred subject-kind work: [ConfigurationSchema extension recon](849-inventory/configurationschema-extension-recon.md) and its [independent Spec review](849-inventory/configurationschema-spec-review.md).

Migration 0148/0149 R3 evidence: [retrospective threat matrix](849-inventory/migrations-0148-0149-r3-threat-matrix.md). It records the post-delivery correction honestly and keeps disposal, quiescence and restore as successor gates.

## 1. Status against the five scope items

| # | Scope item | Status | Principal evidence | Gap |
| --- | --- | --- | --- | --- |
| 1 | All parameter entry points and directly related cross-module references on the new Catalog; remove legacy fallback, mixed reads and dual writes; connect import, view, draft, submit, approve, apply, source writeback, history and export | **Delivered for the canonical server path; the frontend draft tray now reads and removes canonical pending drafts (B5 closed in code, live-data path pending complete seed publication/materialization)** | `drafts.integration.test.ts` (11 tests), `catalogProjectValueRoutes.test.ts` (16), `parameter-bindings` suite 74 tests, `parameter-files` 316 | TD-125 legacy read fallback remains; eleven consumer families and final cutover need T2.2/T1.4 |
| 2 | DTS and JSON only; semantic alignment of the 113 vendor inputs and the four current compatibility seeds; real source files; complete example DTS baselines; JSON software configuration uses ConfigurationSchema | **Partial** | `src/config/seed-reconciliation/manifest.json` (125 inputs), `src/config/seed-sources/**` (9 files, including the generated `vendor-drivers.dts` baseline: **all 113** vendor inputs (27 driver subjects, 12 node-type subjects), every value taken from the reviewed vendor metadata's own DTS-syntax `exampleValue`; regenerable with `npm run vendor-source:generate`, drift-checked by `npm run vendor-source:check` and by `generate-vendor-project-source.test.ts` (5 tests)), `seedSources.fidelity.test.ts` (18), `canonicalBindingMaterialization.integration.test.ts`, ConfigurationSchema slices A–C plus `configurationSchemaPublish.integration.test.ts` (2) | JSON software-configuration project sources (B1); the example baseline is a demonstration source, not validated device firmware |
| 3 | YAML/TOML/ENV project sources and the eight associated seeds recorded in TD-124; those formats refused explicitly; vendor YAML Catalog metadata still read and published | **Delivered** | `unsupportedFormat.test.ts` (19), `importDtsParse.test.ts` (10), frontend `unsupportedImportFormat.test.ts` (10), bilingual TD-124 rows | — |
| 4 | Rebuild by seed: preserve non-parameter data; archive legacy parameter data, drafts, history and source versions offline; initialize only Atlas, Aurora and Nebula; archived notice on old links; retire acme but keep release history | **Partial** | **Offline archive delivered (capture)**: `0149_project_parameter_plane_archives.sql` + `seedInitialization/archive.ts` capture 32 declared per-Project relations and every referenced file-version or candidate byte to archive v2 with per-relation counts and digests. The R3 matrix classifies captured, preserved/shared, regenerable and absent relations plus the direct external FK/trigger/view closure. Capture uses one repeatable-read snapshot, stable primary-key ordering, 64 MiB relation/source bounds, and bounded archive-document reads for local/S3 stores; the rebuild guard validates the exact returned archive ID/digest, relation closure and embedded byte integrity. `archive.integration.test.ts` (14 tests) covers the non-zero graph and preserved observation/match, dependency inventory, child scoping, cross-project isolation, source-row retention, over-cap refusal, idempotent reuse, missing/truncated/torn/tampered/exact-artifact refusal, authorization and schema retention constraints. Migration 0148 evidence additionally proves authenticated-Organization binding, authorization before journaling and completed replay, one in-flight fixed-scope run even across different digests, and immutable `completed` state (`plan.test.ts` 7; `materialize.test.ts` 7). **Disposal is deliberately not implemented** - the ledger has no column that could imply deletion happened, and removing archived rows needs its own reviewed decision. **Archived old-link notice and acme retirement remain delivered** with historical evidence retained | JSON seed materialization (B1), operator curation of the missing `csub_drv_sc8562` capacity, the acme *definition* lifecycle, archived-plane **disposal**, target quiescence/restore, remaining canonical bindings (B2); archived-notice acceptance delivered in #876 |
| 5 | S1/S2: real auth, PostgreSQL, source store, publisher, archive rebuild, interruption/resume and whole-state recovery; PC 1440x900 browser checks | **Partial** | Historical PostgreSQL/browser slices and CLI P0–P10 interruption/mapping recovery exist; #875/#876 add operation registration and old-link acceptance | Full S1, Docker multi-store recovery and actual quiescence, target execution and full PC operation matrix remain T3 work; historical CLI is not whole-deployment restoration |

## 1a. Two blockers and one contract finding discovered while implementing PU-04

These reshape the remaining plan; each is recorded rather than worked around.

**Decision status (2026-09-15).** B1, B4 and B6 are no longer open questions. [ADR-0046](../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md) records the decision for all three and the entries below carry their outcomes; what remains is implementation, not a decision. B3 was withdrawn and B5 is closed for its scope item 1 half.

**B1 - JSON project sources have no semantic ingest path.** `ingestConfigRevision` is a DTS/config-revision resolver. The canonical value owner has a JSON *value* path, but there is no JSON path that turns a project source file into a config revision, so a JSON seed source cannot be materialized. `materialize.ts` refuses it with `UNSUPPORTED_FORMAT` (details carry `deferredTo`) instead of uploading a non-resolving member or dropping it from the manifest. **Consequence: the two JSON compatibility seeds remain unmaterialized, which is a gap against scope item 2 and testing decision 6.** Closing it is not a local fix: per implementation decision 3 it requires the ConfigurationSchema *source-identity* extension at the Binding boundary (distinguishing a DTS logical-node occurrence from a software configuration instance, with config-set, instance, immutable source-file identity and a format-specific locator). **Decided (ADR-0046): schedule that extension; do not renegotiate scope item 2.** The decision introduces one `project_parameter_source_occurrences` layer keyed at least by organization + project + config-set + occurrence-kind + instance-id, plus immutable source-file identity and a JSON Pointer locator; Binding uniqueness becomes `(project_id, source_occurrence_id, definition_id)`; existing DTS bindings are backfilled in place and never re-derive their IDs; and the file-version/config-revision pin stays a ProjectValue concern rather than part of Binding identity. The two JSON compatibility seeds therefore remain in scope and stay unmaterialized until that implementation lands.

**B2 - Canonical binding/value materialization works when registration and placement capacity exist; two defects were fixed to get there.** The success path is proven on real PostgreSQL: `nodeTypeSubjectBinding.integration.test.ts` installs the real release lineage, supplies the one explicitly operator-curated driver module the reviewed slice lacks, materializes the real DTS slice, and proves the node-type bindings and their current values. Two defects had to be fixed first, and both were invisible while nothing reached the write:

| # | Defect | Fix |
| --- | --- | --- |
| 1 | `catalogProjectValueSync` passed `nodeTypeFallback: { kind: "absent" }`, so the **33 node-type vendor properties** (of the 113) could never resolve no matter what the source declared | New shared `resolveObservedSubject`: a declared `compatible` still wins, and the node-type fallback is used only when the source declares none, with the name taken from the observed node |
| 2 | `materializeSeedSources` called the sync with a bare client, so the binding unit of work's `SAVEPOINT` failed with "SAVEPOINT can only be used in transaction blocks" - every write was doomed | The per-project sync now runs inside `root.transaction(...)` |

B2 is therefore proven only for a fixture with sufficient operator-curated capacity. Registration itself is no longer a manual prerequisite (B6), but the unmodified 113-input slice currently fails closed because `csub_drv_sc8562` has no free driver module; it writes zero bindings. The exact reviewed identity set remains unfinished, and the plan's 124-per-project target has never been measured against a complete seed.

**C1 - Acme retirement is legal without a false merge, but it moves a pinned digest.** The retirement contract requires a retired document to carry `tombstone.reason`, `tombstone.withdrawnByReleaseId` equal to the successor release id, and `tombstone.previousSelector` matching the predecessor; `tombstone.successorId` is **optional**, so acme can be retired without claiming it evolved into the real vendor's same-named subject, which the Issue forbids. Implementing it changes the successor's documents, therefore the checked-in `schemas/dts/catalog-release/vendor-catalog-1.yaml` and the `VENDOR_SUCCESSOR_AGGREGATE_DIGEST` constant, and it must preserve the predecessor release and its activation receipts untouched.

**B3 - WITHDRAWN: there was no carry-forward defect.** A previous round recorded B3 as "the publication authoring path does not carry every predecessor member", inferred from `completeSuccessor.test.ts` failing after acme retirement. That inference was wrong. The failure was `expect(result.ok).toBe(true)`, and the underlying build error was `{kind: "subject-not-active", subjectId: "csub_acme_power"}`: the test minted a definition under the acme subject, which `applyCreateDefinition` correctly refuses once acme is retired. A direct probe confirmed the carry-forward itself is sound — building a successor from the retired-acme predecessor produced 163 -> 164 documents, with **no** predecessor identity missing and both the retired subject and alias carried through with their tombstones. The real work was therefore only to move that test's change set onto a subject that stays active. **Acme retirement is now delivered** (subject + alias, with tombstones and no `successorId`), verified at the builder level and end-to-end on real PostgreSQL; see scope item 4 below and round report 1.13. The half of the original B3 note about change-set validation accepting only `driver` and `node-type` was genuine and was fixed separately (it now accepts `configuration-schema`).

**B5 - The workbench draft tray reads the legacy draft surface (verified, partially closed).** Scope item 1
requires removing legacy fallback and mixed reads, and the frontend draft tray violated it:

| Direction | Endpoint | Owner |
| --- | --- | --- |
| Create (write) | `POST /api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts` | canonical `project_parameter_value_drafts` |
| List (read) | `GET /api/v1/parameter-drafts/mine` | legacy `parameter_drafts` |
| Remove (write) | `DELETE /api/v1/parameter-drafts/:draftId` | legacy `parameter_drafts` |

`saveDraft` throws `CONFLICT` in `semantic` identity mode (the mode the API server runs), so the legacy table is
never written, and the legacy delete silently matched nothing. The consequence was that a persisted canonical
draft disappeared from the tray on reload and could not be removed through the UI, while the canonical list
endpoint `GET /api/v2/projects/:projectId/parameter-value-drafts` had **no consumer at all**.

Closed this round: the canonical list DTO now carries `reason` (the tray displays the author's reason, which the
canonical owner previously never exposed), and the client gained `deleteProjectValueDraft` for the canonical
`DELETE /api/v2/projects/:projectId/parameter-value-drafts/:draftId` route, which had no client method at all.
Evidence: `drafts.integration.test.ts` asserts the reason survives the reload on real PostgreSQL;
`parameterCatalogClient.test.ts` asserts both canonical URLs and methods.

**Closed this round (contract and seam):**

1. `catalogBindingDraftDtoSchema` and the canonical draft DTO now carry `updatedAt` as well as `reason`. The tray orders and labels drafts by recency, so the timestamp belongs in the list contract instead of being inferred from request order.
2. The tray seam accepts canonical-shaped drafts. `TrayHydrationDraft` is the port DTO with `parameterId` optional, `PendingBindingDraftCore` no longer requires it, and `serverDrafts`/`resolveSharedWorkingTip` take the narrowed type. `parameterId` is **absent** for a canonical draft rather than invented: the canonical model has no parameter record, and the tray keys off `draftId` and `projectParameterBindingId`. `canonicalDraftsToTrayDrafts` maps the canonical list onto that seam, with 4 tests covering the mapping, the absent identity, reason/recency preservation and the empty case.

**Closed this round (the wiring):** both directions now address the canonical owner, and the component that used to build its own client no longer does.

| Change | Effect |
| --- | --- |
| `deleteProjectValueDraft` takes an optional context | The canonical `DELETE` route enforces auth and project edit permission but **no** catalog-release or idempotency header (unlike the publication routes), so requiring a `CatalogWriteContext` was a signature that demanded something the route never reads |
| New `createCanonicalDraftTraySource()` | Reads `GET /api/v2/projects/:projectId/parameter-value-drafts` through `canonicalDraftsToTrayDrafts`, and deletes through the canonical route; `ParametersPage` injects it as the tray's `listDrafts`/`deleteDraft` in API mode |
| `ApiProjectTopologyWorkspace` builds no draft client | Its two internal fallbacks are gone. A missing prop now means "no server drafts" (and a typed refusal on removal) instead of an implicit legacy read, and the workspace no longer constructs an HTTP repository at all |

This also corrects an earlier claim in this matrix: the remaining work was described as needing a `CatalogWriteContext` for the canonical DELETE. Testing the route showed it does not - the requirement came from the client's own signature. The `ApiProjectTopologyWorkspace` suite now asserts the component calls **no** parameter-repository factory, so the legacy read cannot reappear as a fallback.

**Verification and its honest limit.** `canonicalDraftTraySource.test.ts` proves both directions use the canonical URLs and that no `/api/v1/parameter-drafts` call is made; the adapter and the tray seam carry 4 + 4 tests; the full frontend suite is green (446 files / 3438 tests). What is **not** verified is the live path with real data: canonical pending drafts cannot exist on a database until canonical bindings do (B6), so the tray has not been exercised against a real canonical draft in a browser.

**B6 - RESOLVED: seed-time automatic registration and fail-closed completion are implemented.** An earlier revision of this
entry asked whether seed initialization may register subjects at all; a later one narrowed it to module
provisioning, and then the entry was accidentally dropped when a neighbouring block was rewritten. It is restored
here with the outcome, because the resolution is that neither question was the real obstacle.

**Registration is implemented.** `seedInitialization/registration.ts` resolves the subjects a materialized revision
actually references - only those that own a published definition, so an unrelated `compatible` cannot drag one in -
and registers each through the contract's pre-authorised path: `method: "automatic"`,
`actorKind: "trusted-system"`, `placement: { mode: "use-default" }`, an idempotency key derived from the seed digest,
and a proof recording the seed digest, project and subject kind. `materializeSeedSources` runs it between ingest
and the value sync.

**Module capacity remains operator-owned.** DTS ingest provisions most of the `node-type`/`driver-group` modules the
placement guard needs, but the real reviewed slice is one free driver module short for `csub_drv_sc8562`. The seed
does not invent that user-visible structure. `nodeTypeSubjectBinding.integration.test.ts` supplies one explicitly
operator-curated module and proves the success path; the unmodified real-slice fixture proves the shortage is real.

**Fail-closed completion is implemented.** Materialization first stages and preflights all three targets, then starts
canonical value sync only if every target is placeable. A subject with no available module is neither bound nor
silently dropped. Before any value sync, `materializeSeedSources` records the run as `failed`, journals one
`missing-placement-module` blocker per subject with both `projectId` and `subjectId`, and throws
`SeedInitializationBlockedError`; it can no longer fall through to `completed`. `getSeedInitializationRun` returns
those blockers for operator diagnosis; a retry preserves them while running and clears them only after successful
completion. No migration or automatic module creation was added. The real-PostgreSQL case in `materialize.test.ts`
puts a blocker on the final target: the old flow wrote two earlier bindings before failing, while the two-phase flow
writes zero. The real reviewed slice records three `csub_drv_sc8562` blockers, one per project, and zero bindings.

**Boundary.** B6's failure semantics are resolved; completing the real seed still requires operator curation of the
missing driver-module capacity and then an exact reviewed binding-set oracle. A fixture with that explicit capacity
proves registrations, bindings and current values can complete, but it is not target-environment evidence.

**B4 - The two DTS compatibility seeds cannot be published as-is.** Their reviewed sources declare a `charging_core` node and carry a 3x5 string matrix and a 3x4 cell array. Two independent blockers: the cell array is a **nested array**, which the definition capability allow-list does not accept (only `array<integer>`, `array<number>` and `array<string>` are supported, so this needs a capability revision, the same R3 class as the earlier subject-kind extension); **CORRECTION:** this entry also claimed `charging_core` is not a canonical node name. That is **false**. `parseCanonicalNodeName` accepts `/^[A-Za-z][A-Za-z0-9,._+-]{0,30}$/`, which explicitly allows `_`, and it parses `charging_core`, `batt_l_v800` and `cccv_para0` as valid. The vendor successor itself publishes 15 underscore-bearing node-type names. So the naming half of B4 never existed, no human naming decision is needed for it, and only the nested-array capability blocker remains.

**Decided (ADR-0046): one `catalog-capability/v4`.** It covers recursive/nested arrays, `minItems`/`maxItems`, description-only mixed item schemas and array-level `description`; `v1`/`v2`/`v3` keep their meaning, and a v3 consumer must reject v4 content before install rather than tolerate it. Cardinality may only come from authoritative vendor metadata — the `gpio_int` cell count is the declared `constraints.cells: 3` in `schemas/dts/vendor/wiseeff/mt-mt5788.yaml` and `sc8562.yaml`, whereas the 3 rows of the complex fixtures are observations and must not become a schema bound; the 4/5 columns of those fixtures need reviewed source evidence before they can be invariants, and flattening a cell matrix is not acceptable. The formal subject for `charging_core` is a reviewed NodeType publication decision, not a name-similarity match against the existing `huawei,charging_core` Driver.

## 2. Status against the Issue's testing decisions

| Testing decision | Status | Note |
| --- | --- | --- |
| 1 Externally observable behaviour | Followed | Every added test drives a service, route or installed release, not a private helper |
| 2 S1 production parameter/API boundary | **Partial** | Definition → registration → draft → review → apply → source writeback → history → export is proven on real PostgreSQL with real authentication. Initialization, browser-driven review and export are not |
| 3 S2 self-hosted operational boundary with archive-rebuild | **Partial** | The operator path now runs end to end on real PostgreSQL: `parameter-catalog-cutover-cli.integration.test.ts` drives the four real CLI entry points through plan -> interrupted execute (`PCAT-ORC-CRASH` before P7) -> inspect (P0-P6 checkpoints) -> resume (`resumed: true`, `liveRun: false`) -> inspect -> ad-hoc-action and wrong-token refusals -> whole-state restore (`recovery-required`, live mapping heads rolled back, append-only mapping versions retained). Core state machine: `server/modules/catalog-cutover` **54 tests** green, including rollback-dump equality. **Still not run:** the Docker-based rehearsal artifact scripts (`export-`/`import-parameter-catalog-rehearsal.sh`), which require a `wiseeff-postgres-1` compose container plus a host `psql`; neither is available in this environment, so 15 cases of `parameter-catalog-rehearsal.integration.test.ts` fail on `database ... does not exist` rather than on an assertion. Quiescence and a target-host rehearsal remain unproven |
| 4 Prior art | Extended | Canonical workflow, source fidelity, seed manifest, cutover/classification suites |
| 5 Seed oracle | **Partial** | Inventory, dispositions, digests and the initialization plan are covered; exact expected Binding sets per project are not, because the seed release is not published |
| 6 DTS/JSON matrix | **Partial** | Import refusal, candidate/staging refusal, DTS byte-preserving writeback, JSON literal-key handling, export/reimport fidelity are covered. A full import → draft → review → apply → reimport loop per format is not |
| 7 Workflow and concurrency matrix | **Partial** | Draft does not move the current value; submit pins; approve applies once; replay is idempotent; stale pins are rejected; self-approval and non-reviewer approval are refused. Independently authenticated sessions, response-loss reconciliation and partial batch outcomes are not |
| 8 Commit-boundary matrix | **Partial** | The apply unit commits value, source, history, workflow status and audit in one owned transaction; object-preparation failure and missing referenced objects are not injected |
| 9 Initialization and preservation matrix | **Partial** | #869/#872 prove placement fail-closed, Organization auth, one-in-flight and completed replay; complete seed materialization, initialization workflow integration and exact non-parameter preservation snapshots remain |
| 10 Consumer and legacy matrix | **Partial** | Archived diagnostics normalise to one outcome, the server returns 410 vs 404 correctly, and the parameter workbench now **renders** the notice for an archived old link: `archivedLink.test.ts` (7), `parameterRuntime.test.ts` (+2), `parameterClient.test.ts` (+1), `ParametersPage.test.tsx` (+6), verified in a real browser at three viewports with real authentication. The other consumer families are still not inventoried end to end |
| 11 Operational failure matrix | **Not run** | Target/seed/release/schema drift, backup failure and publication-exclusivity refusal are untested |
| 12 Browser evidence | **Partial** | Import wizard (three viewports) plus the archived old-link notice at 1440x900 / 768x1024 / 390x844 (`work/ui-checks/849/*-archived-notice.png`), the latter against the real API with real bearer authentication. The full PC 1440x900 operation matrix for draft/review/export is still not run |
| 13 Completion evidence | Followed | Candidate, digests, environment, commands, pass/fail/skip counts and artefacts are recorded in the round report |

## 3. Evidence levels actually reached

| Level | Reached | Where |
| --- | --- | --- |
| Documentation / static | Yes | Bilingual reports, ADR-0045, TD-124, threat matrix, Spec review, this matrix |
| Local pure / fake | Yes | Contract, compiler, schema, seed-manifest and matcher suites |
| Real local PostgreSQL | Yes | Every `*.integration.test.ts` cited above, on a dedicated lane database |
| Real local authentication | Yes (established this round) | The API must run with `AUTH_MODE=production AUTH_PROVIDER=local`; a local admin is bootstrapped with `npm run admin:bootstrap`. `GET /api/v1/me` returns 200 only for a real session, and the archived lookup returns 410 for that session. **Correction:** earlier browser evidence was captured against a server in the default `AUTH_MODE=development`, where the resolver ignores `Authorization` entirely and every API call returned 401, so that session proved no authentication at all |
| Browser-real | Partial | Import wizard and the archived old-link notice, three viewports each. The notice was exercised through a real login form, a real 410 from the API, and the dismiss control |
| Hosted / CI | **Historical slices ran; final candidate pending** | #858 had failures; #876 L1/quality/smoke/merge-bar succeeded, but local-non-HDC/target-synthetic/minimal-upgrade skipped. See report section 0; no inherited final acceptance |
| Target host / hardware / release / production | **No** | Not authorized |

## 4. Operating instructions

### 4.1 Reproduce the verification locally

```bash
# Run from the recorded current candidate's repository root, not the historical worktree
npm run catalog:lane:env -- provision --issue 849
export DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_lane_849
export TEST_DATABASE_URL="$DATABASE_URL"
```

Always export the lane database. Without it the server test harness falls back to the shared compose database and fails on immutable-migration drift. The default compose database is not acceptable evidence.

```bash
# Canonical workflow, history and export (real PostgreSQL)
npx vitest run --config vitest.server.config.ts server/modules/parameter-bindings

# Contracts and generated artefacts
npx vitest run --config vitest.server.config.ts server/modules/contracts
npx tsx scripts/check-openapi-contract.ts

# S2 operator path: plan, interrupted execute, inspect, resume, whole-state restore
npx vitest run --config vitest.server.config.ts server/modules/catalog-cutover
npx vitest run --config vitest.scripts.config.ts \
  scripts/wayfinder/parameter-catalog-cutover-cli.integration.test.ts

# ConfigurationSchema end to end
npx vitest run --config vitest.server.config.ts \
  server/modules/catalog-kernel/install/configurationSchemaPublish.integration.test.ts

# Real compatibility sources and the seed manifest
npm run vendor-source:check
npx vitest run --config vitest.server.config.ts \
  server/modules/parameter-files/seedSources.fidelity.test.ts
npx vitest run --config vitest.server.config.ts \
  server/modules/parameter-bindings/seedInitialization
npx vitest run --config vitest.scripts.config.ts scripts/seed-reconciliation-manifest.test.ts
npm run seed:reconcile:check

# Seed initialization plan, guard and journal
npx vitest run --config vitest.server.config.ts \
  server/modules/parameter-bindings/seedInitialization/plan.test.ts

# Repository gates
npm run build
npm run docs:check
npx tsx scripts/check-parameter-catalog-boundaries.ts \
  --trusted-base-sha "$(git rev-parse origin/main)"
git diff --check
```

Known environmental characteristics, so a red run is not misread:

- `server/testing/testDatabase.ts` force-drops stale worker databases. Two database-touching processes running at the same time destroy each other's ephemeral databases, producing `database "wiseeff_test_*" does not exist` or `Connection terminated unexpectedly`. Run one database-touching command at a time.
- The historical `catalogRoles.integration.test.ts` role assertion failure was repaired by #870; do not reuse it as a current baseline-red exemption. Attribute any later failure on its actual candidate.
- `catalog-publication/jobs/manager.integration.test.ts` has a timer race in one case that passes on re-run.

### 4.2 Reproduce the browser evidence

```bash
# Real authentication: the default development resolver ignores Authorization.
DATABASE_URL=<lane dsn> AUTH_MODE=production AUTH_PROVIDER=local npx tsx server/index.ts
npm run admin:bootstrap -- --username <user> --password <pass> --name "<Name>" --organization WiseEff
npx vite --host 127.0.0.1 --port 5173 --strictPort   # port must be 5173-5199 for CORS
playwright-cli -s=wiseeff849 open http://127.0.0.1:5173/parameter-admin
```

Sign in with the local account created against the lane database, open 批量参数导入, then paste or upload `work/ui-checks/849/params.yaml`. The wizard must show the explicit unsupported-format message at step 2, and `config.json` must not. Capture snapshots and screenshots at PC 1440×900 only and check `console error`.

**Archived old link.** Insert one `legacy_parameter_migration_evidence` row for the local organization, then open
`http://127.0.0.1:5173/parameters?parameter=<that legacy id>`. The API answers `410 GONE` with
`details.diagnostic=legacy-parameter-id-retired` and `details.migrationEvidenceId=<row id>`, and the workbench
must render the archived banner with both values. The control case is a random id, which answers 404 and must
render no banner. Historical screenshots (not required extra viewport runs): `work/ui-checks/849/desktop-archived-notice.png`,
`tablet-archived-notice.png`, `mobile-archived-notice.png`.

### 4.3 Next steps, in dependency order

Use the 28 confirmation checkpoints in the [complete closure list](2026-09-16-849-853-closure-todolist.md) as the single execution order, rather than a conflicting second sequence. B5 wiring and B6 fail-closed behavior already exist; do not recreate them. T1.1/T1.2 implement B1/B4, followed by seeds/real sources and consumers, then disposal, full S1/S2, final integration and closure. Wait for user confirmation after each item; do not start the next one in parallel. Disposal and target execution retain separate concrete authorization.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Added | This matrix and its Chinese pair; the round report and its Chinese pair |
| Architecture/domain | No change | ADR-0045 and the design docs landed in an earlier round and are unchanged here |
| Quality/testing | Updated | Testing decisions 1–13 reconciled; only prospective viewports change to PC per user amendment; all other gates remain |
| Operations | Updated | `ops/self-hosted/upgrade.md` and `upgrade.zh-CN.md`: the pinned vendor-successor digest moved to `sha256:5f0e7bcd…` because the advance now retires acme, with the runtime consequence (`acme,power` resolves as `retired`) documented in both |
| Reference | Updated | `docs/references/catalog-publication-baseline-verification.md` and its Chinese pair keep the historical R-F4 digest and gain a dated forward note, so the record at `063b12c49` is not rewritten |
| Generated artefacts | No change | No generated artefact is produced or consumed by this document |

## Documentation Update Gate

T0.6 reconciles current status and program-owned PC acceptance definitions; historical results are not relabeled as new tests. Run `npm run docs:check` and `git diff --check` for maintained docs and record skips; script verification belongs to the closure-list receipt. This does not claim product, full S1/S2, final Hosted or target completion.
