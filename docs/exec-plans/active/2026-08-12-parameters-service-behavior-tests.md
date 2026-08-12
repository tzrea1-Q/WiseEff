# Parameters Service Behavior-Test Migration (Slice 1: Review Workflow)

- Status: Active
- Owner: test-foundation stream
- Created: 2026-08-12

## Background

The 2026-08-12 architecture review (candidate 4) found the backend's service tests welded to SQL text: roughly 458 SQL-text assertions repo-wide drive hand-rolled fake databases with positional row queues and SQL-substring guards. The worst file was `server/modules/parameters/service.test.ts`, where `createFakeDb` fixtures asserted on query text and positional values. Query refactors break these tests while behavior regressions that preserve query text pass them.

The test-foundation stream has since landed `server/testing/testDatabase.ts` (`createInMemoryTestDatabase()`): a real-Postgres connection wrapped in an outer BEGIN with rollback-per-test isolation, savepoint-mapped `transaction()` semantics, an advisory fixture lock, `ensureMigrations()`, and `isTestDatabaseAvailable()` for skip-guarding.

This slice proves the migration pattern on the highest-value block: the review workflow (`submitParameterChanges` → `reviewChange` → merge state machine).

## Scope (this slice)

1. New `server/modules/parameters/serviceReviewWorkflow.integration.test.ts` covering the review workflow at behavior level: returned DTOs, subsequent reads through service/repository functions, and audit/history rows. Never SQL text.
2. Delete the migrated fake-db blocks from `server/modules/parameters/service.test.ts` and the scaffolding they exclusively used (`reviewDecisionRow`, the `readConflictChecksFromQueue` fake option, the `listWorkflowAssignees` import).
3. No production code changes.

Result: `service.test.ts` shrank from 2561 to 1640 lines (56 → 30 tests); the new integration file adds 26 behavior tests, including one new `reject` scenario that fake-db coverage never had.

## Old → new test mapping

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

1. Migrate the remaining `service.test.ts` fake-db blocks: import preview/apply (`createImportPreview`, `applyImportBatch`), draft save/list, and the two semantic submit tests noted above.
2. `server/modules/dts-reload/service.test.ts` — next-worst SQL-text-welded file.
3. `server/modules/debugging/repository.test.ts`.
4. Re-measure repo-wide SQL-text assertion count after each slice against the 458 baseline.

## Verification

- `npx tsc -b` → exit 0.
- `npm run test:server -- serviceReviewWorkflow` → 26 passed (against a freshly-migrated scratch database via `TEST_DATABASE_URL`; the default local `wiseeff` database is post-cutover and cannot exercise legacy-path flows — CI provisions a fresh database and is unaffected).
- `npm run test:server -- parameters/service.test` → 30 passed.
- `npm run docs:check` → pass.

## Documentation Impact Matrix

| Area | Files | Impact |
| --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md` | No change — test-only migration, no structure or commands changed |
| Planning docs | `docs/PLANS.md`, `docs/exec-plans/tech-debt-tracker.md` | No change — this plan file is the planning artifact; no new debt deferred |
| Product specs | `docs/product-specs/` | No change — no product behavior changed |
| Architecture docs | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md` | No change — no production code changed |
| Quality/testing docs | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md` | Review — behavior-level integration tests replace fake-db tests for the review workflow; existing strategy text already prescribes this direction, no edits required in this slice |
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
