# Parameters Service & Repository Behavior-Test Migration

- Status: Completed (Slice 4, 2026-08-13) — scope closed; residual fake-db files outside this
  program are listed with owners/reasons in the Slice 4 sweep table
- Owner: test-foundation stream
- Created: 2026-08-12
- Updated: 2026-08-13 (Slice 4)

## Background

The 2026-08-12 architecture review (candidate 4) found the backend's service tests welded to SQL text: roughly 458 SQL-text assertions repo-wide drive hand-rolled fake databases with positional row queues and SQL-substring guards. The worst file was `server/modules/parameters/service.test.ts`, where `createFakeDb` fixtures asserted on query text and positional values. Query refactors break these tests while behavior regressions that preserve query text pass them.

The test-foundation stream has since landed `server/testing/testDatabase.ts` (`createInMemoryTestDatabase()`): a real-Postgres connection wrapped in an outer BEGIN with rollback-per-test isolation, savepoint-mapped `transaction()` semantics, an advisory fixture lock, `ensureMigrations()`, and `isTestDatabaseAvailable()` for skip-guarding.

This slice proves the migration pattern on the highest-value block: the review workflow (`submitParameterChanges` → `reviewChange` → merge state machine).

## Scope (Slice 1: review workflow)

1. New `server/modules/parameters/serviceReviewWorkflow.integration.test.ts` covering the review workflow at behavior level: returned DTOs, subsequent reads through service/repository functions, and audit/history rows. Never SQL text.
2. Delete the migrated fake-db blocks from `server/modules/parameters/service.test.ts` and the scaffolding they exclusively used (`reviewDecisionRow`, the `readConflictChecksFromQueue` fake option, the `listWorkflowAssignees` import).
3. No production code changes.

Result: `service.test.ts` shrank from 2561 to 1640 lines (56 → 30 tests); the new integration file adds 26 behavior tests, including one new `reject` scenario that fake-db coverage never had.

## Old → new test mapping (Slice 1)

All old tests below lived in `server/modules/parameters/service.test.ts`; all new tests live in `server/modules/parameters/serviceReviewWorkflow.integration.test.ts`.

| # | Old fake-db test (deleted) | New behavior test |
| --- | --- | --- |
| 1 | workflow assignee discovery › returns only project-scoped candidates for parameter editors | workflow assignee discovery › returns only project-scoped candidates grouped by workflow role |
| 2 | workflow assignee discovery › rejects callers without parameter edit permission before querying candidates | workflow assignee discovery › rejects callers without parameter edit permission |
| 3 | submitting two items creates one round and two change requests | submitParameterChanges › creates one round with a change request per item, consumes drafts, and audits the round |
| 4 | submitting with assignees persists the initial reviewer and workflow assignee ids | submitParameterChanges › routes to hardware review and persists reviewer plus workflow assignee state when assignees are given |
| 5 | accepts a software committer as the software developer workflow assignee | submitParameterChanges › accepts a software committer as the software developer workflow assignee |
| 6 | submitting with an assignee lacking the project workflow role rejects before writes | submitParameterChanges › rejects an assignee lacking the project workflow role before any writes |
| 7 | submitting with partial workflow assignees rejects before writes | submitParameterChanges › rejects partial workflow assignees before any writes |
| 8 | submitting a parameter with an existing open request throws conflict | submitParameterChanges › conflicts when the parameter already has an open change request |
| 9 | submitParameterChanges blocks when file sync conflict is open | submitParameterChanges › conflicts when the parameter has an open file sync conflict |
| 10 | submitting duplicate parameter ids rejects before write inserts | submitParameterChanges › rejects duplicate parameter ids before any writes |
| 11 | submit uses the current value_version as baseVersion | submitParameterChanges › records the current value_version as the change request baseVersion |
| 12 | ordinary user cannot advance review | reviewChange advance › ordinary user cannot advance review |
| 13 | cross-project committer cannot advance review | reviewChange advance › cross-project committer cannot advance review |
| 14 | wrong-stage committer cannot advance review | reviewChange advance › wrong-stage committer cannot advance review |
| 15 | committer advances hardware review to software review | reviewChange advance › hardware committer advances hardware review to software review with decision, round status, and audit |
| 16 | committer advances software review to software merge | reviewChange advance › software committer advances software review to software merge |
| 17 | software user can merge software merge request | merge › software user merges a medium-risk request and the value, history, and audit reflect it |
| 18 | rejects merge without an http(s) merge link note | merge › rejects merge without an http(s) merge link note |
| 19 | cross-project software user cannot merge software merge request | merge › cross-project software user cannot merge |
| 20 | high-risk request cannot merge unless prior hardware and software decisions exist | merge › high-risk request cannot merge unless prior hardware and software decisions exist |
| 21 | merge with stale expectedVersion throws conflict | merge › merge with a stale expectedVersion conflicts without recording a merge decision |
| 22 | merge updates parameter value, inserts history, inserts decision, writes audit | merge › high-risk request advances through hardware and software review before merging end-to-end |
| 23 | high-risk submitted request advances through hardware and software review before merge | merge › high-risk request advances through hardware and software review before merging end-to-end (same test as #22) |
| 24 | post-cutover semantic merge fail-closed preflight › rejects semantic merge when objectStore is missing | post-cutover semantic merge fail-closed preflight › rejects semantic merge when objectStore is missing |
| 25 | post-cutover semantic merge fail-closed preflight › rejects semantic merge when binding identity is missing | post-cutover semantic merge fail-closed preflight › rejects semantic merge when binding write-lock identity is missing |
| 26 | post-cutover semantic merge fail-closed preflight › does not honor WISEEFF_WRITEBACK_SKIP_TOOLCHAIN env bypass | post-cutover semantic merge fail-closed preflight › does not honor WISEEFF_WRITEBACK_SKIP_TOOLCHAIN env bypass |
| — | (no fake-db coverage existed) | reviewChange advance › reject moves the request to rejected and records the reject reason (new coverage) |

Notes:

- Mapping rows 12–13 previously staged the request at `hardware_review`; the new tests exercise the same policy branch at `submitted` (both statuses require the hardware-committer role, and the structured FORBIDDEN error is identical).
- Mapping row 17 exposed a fake-fixture fiction: the old test queued a row claiming the merged request DTO's `currentValue` becomes the target value. Real behavior keeps the submit-time snapshot on the change request while `project_parameter_values` updates; the new test asserts the real behavior.
- The migration marker for the semantic preflight tests is seeded with raw SQL (`parameter_identity_migration_runs` + `parameter_identity_cutovers`) because no public writer exists short of the full cutover tooling.

### Kept in service.test.ts (not migrated)

- `rejects semantic merge when projectId is missing`: `parameter_change_requests.project_id` is NOT NULL, so a project-less request cannot exist in a real database. The check is defensive-only; testing it requires the fake db.
- `submitParameterChanges rejects mixed working tips in one batch` and `submitParameterChanges creates enablement change requests from node-enablement drafts`: post-cutover semantic submit paths that need full topology graphs; `server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts` already covers the merged behavior on a temp DB. Migrating these two is a follow-up slice.
- All import-batch, draft, and parse blocks: out of this slice's scope (follow-up slices below).
- Withdrawal/re-submission was not covered in `service.test.ts` (it is exercised via routes tests), so nothing was ported for it.

## Follow-up slices

1. ~~Migrate the remaining `service.test.ts` fake-db blocks: import preview/apply (`createImportPreview`, `applyImportBatch`), draft save/list~~ — done in Slice 3 below. The two semantic submit tests remain fake-db (re-evaluated and kept in Slice 4, see below).
2. ~~`server/modules/dts-reload/service.test.ts`~~ — already migrated on `main` by the test-foundation deepening commit (`772f7cd0`, per-worker template DBs); nothing left for this program.
3. ~~`server/modules/debugging/repository.test.ts`~~ — migrated by the sibling TD-079 slice-2 stream (`5e7e134f`, now `repository.integration.test.ts`).
4. Re-measure repo-wide SQL-text assertion count after each slice against the 458 baseline — final numbers in Slice 4.

## Verification (Slice 1)

- `npx tsc -b` → exit 0.
- `npm run test:server -- serviceReviewWorkflow` → 26 passed (against a freshly-migrated scratch database via `TEST_DATABASE_URL`; the default local `wiseeff` database is post-cutover and cannot exercise legacy-path flows — CI provisions a fresh database and is unaffected).
- `npm run test:server -- parameters/service.test` → 30 passed.
- `npm run docs:check` → pass.

## Slice 3 (2026-08-13): split repository files + residual service blocks

Branch `test/parameters-repository-behavior-tests`. Converts the remaining fake-db/SQL-text
test files in `parameters` and `parameter-drafts` to behavior-level tests against
`createInMemoryTestDatabase()` (per-worker template-cloned Postgres, rollback-per-test),
seeding via `seedCoreGraph` plus module-local raw-SQL fixtures, following the
`parameter-files/conflictService.test.ts` exemplar (`describe.skipIf(!databaseAvailable)`,
`setParameterIdentityMode(null)` hygiene, no rename). No production code changed.

### SQL-text assertion counts (`rg -c "calls\[|\.text\)\.toContain"`)

| File | Before | After |
| --- | --- | --- |
| `server/modules/parameters/reviewWorkflowRepository.test.ts` | 49 | 0 |
| `server/modules/parameters/importBatchRepository.test.ts` | 32 | 0 |
| `server/modules/parameter-drafts/repository.test.ts` | 29 | 0 |
| `server/modules/parameters/repository.test.ts` | 17 | 0 |
| `server/modules/parameters/fileSyncConflictRepository.test.ts` | 13 | 0 |
| `server/modules/parameters/service.test.ts` | 12 | 0 |

Every per-file `createFakeDb` positional-queue harness was deleted except the trimmed copy
in `service.test.ts` that hosts the three kept tests below.

### Old → new mapping: `parameters/repository.test.ts` (4 → 5)

| Old fake-db test | New behavior test |
| --- | --- |
| listParameters accepts project, module, risk, query, and limit filters | listParameters applies project, module, risk, and query filters together (each filter now excludes a seeded decoy row) |
| — (limit/order was an SQL-text assertion) | listParameters orders by updated_at descending and honors the limit |
| getParameterById maps source fields and loads history | getParameterById maps source fields and loads history |
| getParameterById returns null when no rows match | getParameterById returns null for missing and cross-organization ids (org scoping now behavioral) |
| listParameterHistory orders entries by changed time descending | listParameterHistory orders entries by changed time descending and maps fallbacks (newer row inserted first to prove DB ordering) |

### Old → new mapping: `parameters/fileSyncConflictRepository.test.ts` (2 → 3)

| Old fake-db test | New behavior test |
| --- | --- |
| handles file sync conflict repository CRUD | inserts, lists, reports, and resolves a conflict end to end (adds: double-resolve returns null; resolution removes row from open reads) |
| — (org filter was an SQL-text assertion) | resolveConflict is organization-scoped |
| listOpenConflicts maps enrichment joins for arbitration DTO | listOpenConflicts enriches binding-identified conflicts for the arbitration DTO (real spec/binding/occurrence graph seeded; also covers the binding-id filter under the legacy parameter name) |

### Old → new mapping: `parameter-drafts/repository.test.ts` (6 → 6)

| Old fake-db test | New behavior test |
| --- | --- |
| upsertDraft inserts or updates a user draft within an organization | upsertDraft inserts a draft and updates it in place on the same (project, parameter, user) key |
| listDraftsForUser and deleteDraft scope drafts by organization and user | listDraftsForUser and deleteDraft scope drafts by organization and user (wrong-user delete proven a no-op) |
| listDraftsForUser returns candidateConfigRevisionId when the column is set | listDraftsForUser maps binding identity, candidate revision, and locked base value (real binding + binding-revision graph) |
| lists drafts by parameter value with origin metadata | lists drafts by parameter value with origin metadata ordered by recency (fake asserted insertion order; DB order is `updated_at desc`) |
| listOpenBindingDraftsForUser returns open drafts ordered by updated_at desc then id asc | listOpenBindingDraftsForUser returns binding and enablement drafts ordered by updated_at desc then id asc (the “no binding-not-null filter” SQL assertion became: an enablement draft is returned) |
| rebaseOpenBindingDraftCandidates updates sibling drafts and returns rebased ids | rebaseOpenBindingDraftCandidates moves stale sibling drafts (including enablement) to the shared tip (excluded draft, already-shared draft, and other-user draft proven untouched) |

### Old → new mapping: `parameters/importBatchRepository.test.ts` (5 → 6)

| Old fake-db test | New behavior test |
| --- | --- |
| lists import match candidates by definition id or name | lists import match candidates by definition id or name within the organization and project (cross-org and cross-project value scoping now behavioral) |
| inserts and loads import preview batches as jsonb payloads | inserts and reloads import preview batches with jsonb payload fidelity (plus cross-org load returns null) |
| applies added and updated import items with history rows | applies added and updated items with history rows and marks the batch applied (value/history rows read back from the DB) |
| updated import items upsert definition metadata and missing project values | updated items upsert definition metadata and create missing project values |
| — (the `changed_value`/`not exists` CTE shape) | updated items with unchanged values report the existing version without new history (the no-op branch as behavior) |
| import item definition upserts do not bind cross-organization id conflicts | definition upserts do not bind cross-organization id conflicts (foreign definition proven unmodified) |

### Old → new mapping: `parameters/reviewWorkflowRepository.test.ts` (14 → 15)

| Old fake-db test | New behavior test |
| --- | --- |
| lists active workflow assignees only from the requested organization and project | same name (inactive user, other-project, and other-org bindings seeded and excluded) |
| creates submission rounds, change requests, and submission items with parameterized SQL | creates submission rounds, change requests, and submission items that read back consistently (“parameterized SQL” assertions became DTO + list read-back; baseVersion asserted on the by-id read because the create DTO does not carry it) |
| persists and maps workflow assignees on created change requests | same name (plus reload via getChangeRequestById) |
| lists submission rounds and change requests with project and status filters | same name (other-project/other-status rows seeded and excluded) |
| lists submission rounds with workflow assignees reconstructed from linked requests | same name |
| lists post-cutover submission items without retired flat identity tables | lists post-cutover submission items without the retired flat identity tables (post-cutover schema emulated inside the test transaction with the same DDL as `server/cutovers/2026-07-16-parameter-identity-cutover.sql` — legacy columns dropped, flat tables renamed — so any residual flat-table reference would fail loudly; the old `not.toContain("project_parameter_values")` string check is thereby strictly subsumed) |
| findOpenChangeRequest and getProjectParameterForUpdate use organization scoped parameter ids | split: findOpenChangeRequest sees only open requests within the organization; getProjectParameterForUpdate scopes by organization and project. The old `for update` string check is dropped-with-reason: lock acquisition is not observable from a single connection; row selection is asserted instead |
| gets change request by id and lists review decisions by organization | gets change request by id and lists review decisions in stage order (decision ordering proven by out-of-order inserts; also absorbs insertReviewDecision DTO assertions from the row below) |
| updates request status and inserts review decisions | updates request status with reviewer note and persists it for later reads (adds reject-reason persistence); the insertReviewDecision half moved into the row above |
| advances assigned user from workflow assignees when updating review status | same name (extended through software_merge and terminal-state clearing) |
| checks workflow assignee eligibility against active project role bindings | same name (one positive, four behavioral negatives) |
| merges change request with expected version and inserts history | merges a software_merge request with the expected version and inserts history atomically (value/history rows read back) |
| mergeChangeRequest returns null when the version guard does not update a row | mergeChangeRequest returns null and writes nothing when the version guard misses |
| updates submission round status from child requests | updates submission round status from the most advanced child request |

### Old → new mapping: `parameters/service.test.ts` residual blocks (33 → 32)

Import preview/apply and draft/submission-guard blocks moved onto the real database inside
the same file; pure parse/schema tests unchanged. Notable rows:

| Old fake-db test | New behavior test |
| --- | --- |
| non-admin cannot create or apply import batches | same, plus batch-count read-back |
| invalid import item shape returns validation failed | invalid import item shape returns validation failed before any writes |
| preview rejects projects outside the organization | preview rejects projects outside the organization without persisting a batch |
| preview classifies added updated unchanged conflict and flags high-risk value deltas | same (conflict precondition is a real open change request row) |
| createImportPreview with/without reviewMetadata audit tests | same, reading `audit_events` rows (kind `batch-import`, trace id, metadata) |
| applyImportBatch merges reviewMetadata into apply audit metadata | same |
| preview flags high-risk recommended value deltas without over-flagging zero or nonnumeric baselines | same |
| preview mints import-owned definition ids for added items with unmatched supplied ids | same |
| apply creates added values, updates selected values, skips unselected items, and writes audit | apply creates added values, updates selected values, and writes audit. The fake lock→recheck→update call-order indexes are dropped-with-reason: call ordering on one connection has no behavioral surface; the recheck outcome lives in “apply rechecks open requests created after preview” and skip behavior in “apply skips unselected items” |
| apply defaults to eligible added and updated items without selecting conflicts | same (untouched conflict/unchanged values read back) |
| apply rejects batches whose project is outside the organization | same (batch row seeded raw under a foreign project id) |
| apply rejects unknown selected item ids | apply rejects unknown selected item ids without consuming the batch |
| apply rejects an empty selected item list without consuming the batch | same |
| apply rejects when selected items contain no eligible import changes | same |
| apply rejects added definition id collisions | apply rejects added definition id collisions discovered after preview (the minted definition id is occupied between preview and apply) |
| apply rejects open requests found after locking target values | merged into “apply rechecks open requests created after preview” — the found-after-locking vs created-after-preview distinction was fake-db call-order, not behavior; the durable contract (conflict at apply time, nothing written, batch stays previewed) is one scenario |
| apply rechecks open requests created after preview | apply rechecks open requests created after preview |
| apply skips unselected items | same (absent definition proven by DB read) |
| apply updates definition metadata for selected updated items | same (adds: identical values leave version and history untouched) |
| apply creates a project value when an updated definition has no project row | same |
| apply rejects selected conflict items | same |
| guest cannot save draft | same, plus zero-draft read-back |
| rejects saving a draft for a project the editor is not bound to | same |
| accepts an organization-wide (null-project) editor binding for any project | same — now asserts the positive NOT_FOUND domain error, proving the call passed the role gate |
| rejects submitting a change round for a project the editor is not bound to | same, plus zero-round read-back |
| user can save and list own draft | same (list view enrichment — name/module/currentValue — asserted instead of bare equality) |
| saveDraft rejects when parameter is not in the project before upserting | same (parameter seeded in the other project) |

### Kept on the fake db (flagged)

- `service.test.ts` › “rejects semantic merge when projectId is missing”: unchanged Slice 1 rationale — `parameter_change_requests.project_id` is NOT NULL, so the guarded state cannot exist in a real database.
- `service.test.ts` › “submitParameterChanges rejects mixed working tips in one batch” and “… creates enablement change requests from node-enablement drafts”: post-cutover semantic submit paths needing full topology graphs; the merged behavior runs on a temp database in `parameter-topology/postCutoverWorkflow.integration.test.ts`. Migrating them is still the open follow-up. These tests use `text.includes` probes on the fake transaction log (not counted by the assertion regex) and are annotated in-file.

### Adjacent repair

`parameters/dashboard/{repository,hotspotRepository,service}.test.ts` ran `createInMemoryTestDatabase()` without a skip guard, so an unavailable test database failed the suite instead of skipping it. Added the standard `describe.skipIf(!databaseAvailable)` guard (no other changes) so `npm run test:server -- parameters parameter-drafts` skips cleanly without Postgres.

### Verification (Slice 3)

- `npx tsc -b` → no output; `npx tsc -b 2>&1 | rg "error TS"` → no matches.
- `npm run test:server -- parameters parameter-drafts` → 37 files / 233 tests passed.
- Skip path (`TEST_DATABASE_URL` at an unreachable port) → 20 files passed / 17 skipped, 0 failures (129 tests skipped).
- Post-migration `rg -c "calls\[|\.text\)\.toContain"` over the six files → no matches.
- `npm run docs:check` → pass.

## Slice 4 (2026-08-13): shared spec+binding fixture, remaining parameters family, debugging service, sweep

Branch `test/behavior-tests-slice-4`. Final slice: extracts the shared semantic-graph
fixture Slice 3 asked for, migrates every remaining `createFakeDb`/SQL-text file this
program owns, and disposes of the sweep leftovers explicitly. No production code changed.

### Shared fixture decision

`seedSpecBindingGraph` (named alongside `seedCoreGraph`) now lives in
`server/testing/fixtures.ts` and seeds the semantic identity spine:
`parameter_specs` (+`parameter_spec_versions`, +`dts_property_specs`), `parameter_modules`,
`dts_config_set` (+`dts_config_revisions`, +`dts_logical_nodes` with node revisions), and
`project_parameter_bindings` (+binding revisions). One helper serves all three
near-duplicate seeds without contortions; the three suites
(`parameter-drafts/repository.test.ts`, `parameters/fileSyncConflictRepository.test.ts`,
`parameters/reviewWorkflowRepository.test.ts`) were refactored onto it with behavior
assertions unchanged (24 tests green before and after). Two deliberate boundaries:
occurrence rows (`dts_node_occurrences`/`dts_property_occurrences`/`dts_occurrence_effects`)
stay in the suites because they encode test-specific source positions, and
`dts-reload/service.test.ts`'s `seedCandidate` was left alone — it is already
behavior-level and its per-candidate parameterization (structural-key skip, compatible,
revision-number arithmetic) is reload-specific, not shared identity.

### SQL-text assertion counts (`rg -c "calls\[|\.text\)\.toContain"`)

| File | Before | After |
| --- | --- | --- |
| `server/modules/debugging/catalogSplitRepository.test.ts` | 26 | 0 |
| `server/modules/debugging/service.test.ts` | 20 | 0 |
| `server/modules/parameters/parameterModuleRepository.test.ts` | 8 | 0 |
| `server/modules/deviceBridge/repository.test.ts` | 8 | 0 |
| `server/modules/projects/repository.test.ts` | 7 | 0 |
| `server/modules/parameters/impact.test.ts` | 0 (guards were `text.includes` handlers) | 0 |
| `server/modules/parameters/initializationService.test.ts` | 0 (fake db + `vi.mock`'d repositories) | 0 |
| `server/modules/auth/bootstrapLocalAdmin.test.ts` | 0 (`text.includes` handlers) | 0 |
| `server/modules/auth/seedLocalDemoCredentials.test.ts` | 0 (call-list assertions) | 0 |

Every per-file `createFakeDb` harness in these files was deleted; the only remaining
`createFakeDb` in the parameters family is the trimmed host for the three kept tests in
`parameters/service.test.ts`.

### Old → new mapping: `parameters/impact.test.ts` (5 → 5)

| Old fake-db test | New behavior test |
| --- | --- |
| buildTemplateImpact returns the exact legacy two-item template | unchanged (pure function) |
| falls back to template when source binding is missing | same (the “issues no queries” call-count assertion became: template returned on a real db) |
| falls back to template when source file/node has no dts rows | falls back to template when the source file and node have no dts rows (file + current version seeded, no matching node) |
| includes phandle, compatible, and config-set impact kinds for structural changes | same — full structural graph seeded; asserts the exact five-item impact. Decoys: same-named file in another project, different-compatible node, other-config-set file, phandle ref resolved to a different node. Config-set peers inserted out of sort order to prove DB ordering |
| falls back to template when structural queries all return empty | same (bound node with no compatible/config set/phandles) |

### Old → new mapping: `parameters/initializationService.test.ts` (6 → 6)

All `vi.mock`'d repositories/binding services dropped; the real service runs its real
repositories, and audit rows are read from `audit_events`.

| Old mocked-repo test | New behavior test |
| --- | --- |
| empty submit then approve reaches initialized without materializing bindings | same — project status read back per step; zero `project_parameter_bindings`/`dts_config_revisions` rows instead of “mock not called” |
| reject keeps draft and sets initialization_rejected | reject keeps the draft and sets initialization_rejected (draft row read back) |
| forbids double-approve of a non-pending review | same (real approved review, second approve conflicts) |
| forbids non-admin approve | same |
| assertProjectAllowsParameterSubmit blocks when pending review | assertProjectAllowsParameterSubmit blocks while initialization review is pending (pending state produced by a real submit) |
| upsertDraft sets initialization_draft for empty library | upsertDraft sets initialization_draft for an empty library and persists the draft (adds: second save updates the same row) |

### Old → new mapping: `parameters/parameterModuleRepository.test.ts` (6 → 6)

| Old fake-db test | New behavior test |
| --- | --- |
| listParameterModules returns tree rows | listParameterModules returns the organization's tree rows ordered by path (later-path root inserted first; cross-org module excluded) |
| createParameterModule computes path from parent | createParameterModule computes path and depth from the parent (read-back; missing parent refused) |
| moveParameterModule recomputes descendant paths | moveParameterModule recomputes descendant paths and depths (real grandchild; cycle move refused). Found: the UPDATE also cascades the new `parent_id` onto every descendant — pm-c ends up claiming the move target as its parent while its path still nests under pm-b. Looks like a latent repository bug (noted in-test); the test pins only the path/depth contract |
| reparentAutoParameterModule does not promote auto to curated | same (real 0082 constraint required seeding the attribution subject; adds: curated module reparent is skipped) |
| listParameters uses subtree filter when includeDescendants is true | returns the module and its descendants when includeDescendants is true (parent+child parameters returned, unrelated root excluded) |
| listParameters uses exact module id filter when includeDescendants is false | returns only the exact module when includeDescendants is false (child-only, then parent-only) |

### Old → new mapping: `debugging/catalogSplitRepository.test.ts` (8 → 8)

| Old fake-db test | New behavior test |
| --- | --- |
| creates logical debug nodes without protocol columns | creates logical debug nodes carrying metadata only, with no protocol binding attached (the “no protocol columns in SQL” checks became: fresh node has zero bindings and is invisible to runtime protocol lists) |
| upserts and archives debug node bindings scoped to the logical node | same (second upsert proven to update the same row id; archive hides from enabled-only reads) |
| returns null when upserting a binding for a node outside the organization scope | same (plus: no row written for either org) |
| lists bindings for a logical node | lists bindings for a logical node ordered by protocol (hdc inserted before adb; other node's binding excluded) |
| returns enabled debug node bindings by node and protocol | returns enabled debug node bindings by node and protocol, hiding disabled ones unless asked |
| listRuntimeDebugNodes inner-joins enabled bindings and filters by protocol | listRuntimeDebugNodes returns only enabled nodes with an enabled binding for the protocol (decoys: disabled binding, wrong protocol, unbound node, foreign org) |
| listRuntimeDebugNodes omits nodes without an enabled binding for the requested protocol | same |
| creates, lists, updates, renames references, and deletes debug node modules | same flow, plus a contract the fake's zero-count queue hid: deleting a module still referenced by debug nodes is refused; an empty module deletes cleanly |

### Old → new mapping: `debugging/service.test.ts` (64 → 63)

The gateway, bridge-RPC client, audit writer, metrics, and tracing stay as
dependency-injected mocks (they are ports, not the database). Every database effect —
operations, snapshots, events, targets, parameter values — is asserted by reading rows
back. Group-level mapping, with by-name changes called out:

- Admin catalog (7 tests): unchanged names; positional `values[N]` assertions became
  read-backs of `debugging_parameters`/`debugging_parameter_node_bindings`; audit
  metadata/no-node-path-leak assertions unchanged against the audit port.
- Runtime listings (4): org scoping now proven with seeded org-2 decoys. “lists
  selected-protocol parameter bindings” corrected a fake-fixture fiction: a
  protocol-scoped listing loads only that protocol's bindings — the fake returned both
  protocols, which the real query never did.
- detectTargets (7, includes “requires an explicit registry for non-default protocols”):
  persisted targets read from `debugging_targets` (including the requested-protocol
  override and bridge-backed rows); the failed-detect event read from `debugging_events`.
- createSession (4): offline/lost/mismatch preconditions staged as real rows; the
  bridge-metadata and session-created-event assertions read their rows back.
- readNode (9): binding-path resolution asserted through the gateway port; operations
  read from `node_operations`; “treats audit write failure as transaction failure”
  asserts zero surviving rows (savepoint rollback) instead of replaying a fake rollback
  log. Old “reads a parameter through the active session protocol binding” became
  “reads a parameter through a read-only session protocol binding” (its distinct bit —
  RO is readable — kept; the rest duplicated the ADB-binding test).
- writeNode (17): snapshot-before-write ordering proven by querying
  `debugging_snapshots` from inside the gateway mocks (empty at pre-read, one valid
  snapshot with previous/target values and digests at write time); the
  lease-conflict test acquires a real rival-session lease; verified-write value
  updates, complex-JSON validation/readback, and audit digest/preview behavior
  unchanged in intent.
- rollbackSnapshot (6): claim-before-write proven by reading the snapshot status
  (`rollback_pending`) from inside the gateway write mock; partial failure restores
  `valid` and writes the rollback-failed event; success consumes the snapshot and writes
  the succeeded event. “rejects missing, consumed, invalid, or cross-session snapshots”
  became “rejects missing, consumed, and rollback-pending snapshots”: the cross-session
  variant staged a fake state (snapshot.session_id disagreeing with the row returned by
  the session lookup keyed on that same id) that a real database cannot produce.
- Dropped with reason (1): “rollbackSnapshot claims snapshot before gateway writes and
  conflicts when claim fails” — the CONFLICT branch needs a concurrent claimer between
  the read and the claim on one connection, which the single-connection fixture cannot
  produce; the claim-ordering half survives via the status probe above.

Found while migrating (flagged, not fixed — test-only change): `insertNodeOperation`
falls `node_id` back to the parameter id, and that column's FK references
`debug_nodes` — so the API-reachable `parameterId` read/write path can only record an
operation when a same-id `debug_nodes` row exists, which no migration maintains. The
suite seeds that mirror row (documented in-code) so the rest of the path stays testable.

### Old → new mapping: sweep migrations

`projects/repository.test.ts` (3 → 3): listProjects org filter (foreign org seeded and
excluded); getProjectById org scoping (foreign project id resolves to null); delete
cascade — real parameter data on the doomed and a sibling project, sibling rows and the
shared `parameter_definitions` row proven to survive, not-found unchanged.

`deviceBridge/repository.test.ts` (4 → 4): pairing-code insert read back; one-shot
consume (second consume and unknown hash both null); bridge + scoped token rows read
back; revoked-bridge filtering behavioral (revoked and other-user bridges seeded and
excluded).

`auth/bootstrapLocalAdmin.test.ts` (3 → 3): first bootstrap reads back user, scrypt
credential, org-wide admin binding, and the audit event; second bootstrap conflicts and
writes no second credential; `countLocalAdminBindings` counts a real binding.

`auth/seedLocalDemoCredentials.test.ts` (4 → 4): roster/gate tests unchanged (pure);
development seed reads seven scrypt credentials back and re-seeding stays at seven
(upsert proven); production seed leaves zero rows.

### Kept on the fake db (Slice 4 evaluation)

- `parameters/service.test.ts` › “rejects semantic merge when projectId is missing”:
  unchanged rationale — the guarded state cannot exist in a real database (NOT NULL).
- `parameters/service.test.ts` › the two semantic submit tests (“mixed working tips”,
  “enablement change requests”): re-evaluated against `seedSpecBindingGraph`. The
  fixture covers the spec/binding/config-revision spine, but these paths additionally
  need the candidate-proof graph `getBindingDraftForSubmission` computes from write-lock
  rows — binding revisions on both base and candidate revisions, file versions with
  matching checksums, and (for enablement) logical-node `status` occurrence effects.
  That is exactly the per-test graph `parameter-topology/postCutoverWorkflow.integration.test.ts`
  already builds on a temp database where the merged behavior is covered end to end, so
  duplicating it here buys no coverage. Kept with updated in-file annotations.

### Sweep: remaining `createFakeDb` files (out of this program's scope)

`rg -l "createFakeDb" server/modules -g '*.test.ts'` after this slice:

| File | Disposition |
| --- | --- |
| `parameters/service.test.ts` | The three kept tests above (annotated in-file). |
| `debugging/debugNodeModuleRepository.test.ts` | Same tree-repository shape as the migrated `parameterModuleRepository`; owned by the debugging follow-up under TD-096's remaining-files bucket, not this program's file list. |
| `dts-reload/deploy.test.ts` | 1,482 lines of bridge-RPC deploy orchestration; the DB surface is thin next to its RPC fakes, and the dts-reload service suite is already behavioral. Deserves its own slice. |
| `logs/domainsService.test.ts` | logs family — outside the parameters/debugging scope of this plan (TD-072/TD-096 note logs repositories already converted; this service file remains). |
| `parameter-files/releaseReadinessService.test.ts` | parameter-files family; readiness aggregation over many fake counts — needs its own seed design. |
| `parameter-modules/ensureAttributionModuleForBinding.test.ts`, `parameter-modules/resolveModuleForBinding.test.ts` | parameter-modules family (attribution/driver-registry graph); not in this plan's file list. |
| `parameter-specs/driverSchemaOverlayRepository.test.ts` | parameter-specs family; 2 tests over overlay jsonb round-trips. |
| `auth/…`, `projects/…`, `deviceBridge/…` | Migrated in this slice (tables above). |

Repo-wide `rg -c "calls\[|\.text\)\.toContain" server/modules -g '*.test.ts'` now
matches 108 lines across 36 files (down from the 458-assertion baseline the review
measured), the large majority of which are vitest mock-call inspections against DI
ports (gateways, RPC clients, fetch/embedding stubs — e.g. `agent/`, `knowledge/`,
`logs/analyzer/`), not SQL-text assertions; the largest genuinely SQL-flavored counts
left are `audit/repository.test.ts` (11) and `debugging/debugNodeModuleRepository.test.ts`
(7), both outside this program's file list.

### Verification (Slice 4)

- `npx tsc -b 2>&1 | rg "error TS"` → no matches.
- `npm run test:server -- parameters parameter-drafts dts-reload debugging parameter-files auth/bootstrapLocalAdmin auth/seedLocalDemoCredentials projects/repository deviceBridge/repository` → all files green (counts in the final report).
- Skip path (`TEST_DATABASE_URL` at an unreachable port) → skips, not failures.
- Post-migration `rg -c "calls\[|\.text\)\.toContain"` over the nine migrated files → no matches.
- `npm run docs:check` → pass.

## Documentation Impact Matrix

| Area | Files | Impact |
| --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md` | No change — test-only migration, no structure or commands changed |
| Planning docs | `docs/PLANS.md`, `docs/exec-plans/tech-debt-tracker.md` | No change — this plan file is the planning artifact; no new debt deferred |
| Product specs | `docs/product-specs/` | No change — no product behavior changed |
| Architecture docs | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md` | No change — no production code changed |
| Quality/testing docs | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md` | Review — behavior-level integration tests replace fake-db tests for the review workflow (Slice 1) and the parameters/parameter-drafts repository + residual service files (Slice 3); existing strategy text already prescribes this direction, no edits required |
| Reliability/runbooks | `docs/RELIABILITY.md`, `docs/runbooks/` | No change |
| Security/governance docs | `docs/SECURITY.md`, `docs/security/` | No change — permission checks only moved test layers, semantics untouched |
| Frontend/design docs | `docs/FRONTEND.md`, `docs/design-docs/ui-design-system.md` | No change — backend tests only, no UI-visible behavior |
| Generated artifacts | `docs/generated/` | No change — schema and API untouched |
| References | `docs/references/` | No change |

UI Interaction Automation Rule: not applicable — no user-facing interaction behavior changed; no `e2e/acceptance/` spec, requirement ID, or operation ID is affected.

## Documentation Update Gate

- [x] Impact matrix reviewed; all rows `No change` except quality/testing docs marked `Review` with evidence: `docs/design-docs/testing-strategy.md` already documents the shared-Postgres transactional fixture as the standard for module integration tests, so no edit is needed for this slice.
- [x] No deferred documentation work; nothing added to `docs/exec-plans/tech-debt-tracker.md`.
- [x] No Chinese developer-doc update needed: no architecture, runtime, environment, API, security, reliability, or quality-gate semantics changed; this plan is a stream-internal execution artifact.
- [x] `npm run docs:check` run before completing this slice.
- [x] Slice 3 re-reviewed the matrix (still accurate — test-only change, no production code) and re-ran `npm run docs:check`.
- [x] Slice 4 re-reviewed the matrix (still accurate — test-only change; the two latent-defect findings are flagged in the plan/tests for follow-up, not doc-bearing changes), updated the TD-096 progress note in `docs/exec-plans/tech-debt-tracker.md`, and re-ran `npm run docs:check`.
