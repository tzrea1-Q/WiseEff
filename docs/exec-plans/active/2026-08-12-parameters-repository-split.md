# Parameters Repository Split — Slices 1–2 (Architecture Review Candidate 3)

- **Status:** Active (slice 1 merged as PR #321; slice 2 implemented)
- **Branch:** slice 1 `refactor/parameters-repository-split-1` (from `main` @ `faa6cc19`); slice 2 `refactor/parameters-repository-split-2` (from `main` @ `5826b2b2`, after PR #328's identity-mode single seam)
- **Owner:** Backend
- **Scope source:** 2026-08-12 architecture review, Candidate 3: `server/modules/parameters/repository.ts` is a god module — 5,435 lines, 68 exported functions touching ~35 tables in one flat namespace, imported by 40+ files including 12+ other backend modules. Candidates 1–2 (frontend shell) are owned by `2026-08-12-app-shell-decomposition.md`.

## Goal

Carve the two most separable aggregates out of `repository.ts` as pure verbatim function moves — zero behavior change, no renames, no signature changes, no dedup, no new interfaces:

1. **`server/modules/parameters/projectRepository.ts`** — the project CRUD / project admin cluster (`projects`, `project_modules` tables): `listProjects`, `getProjectById`, `listProjectAdminSummaries`, `getProjectAdminDetail`, `createProject`, `updateProject`, `deleteProject`, `listProjectModules`, plus their private row types (`ProjectRow`, `ProjectModuleRow`) and mappers (`toProjectDto`, `toProjectAdminSummaryDto`, `toProjectModuleDto`).
2. **`server/modules/parameters/reviewWorkflowRepository.ts`** — the review-workflow cluster (`parameter_submission_rounds`, `parameter_submission_items`, `parameter_change_requests`, `parameter_review_decisions` tables): submission rounds, change-request creation, review decisions, status transitions, and `mergeChangeRequest` with its private helpers (`mergeEnablementChangeRequest`, `listSubmissionItemsByRoundIds`, `listWorkflowAssigneesByRoundIds`), the change-request row types/mappers, and the `CR_*` SQL fragment constants. `findOpenEnablementChangeRequest` moves with its twin `findOpenChangeRequest` even though it sat in the top section of the file — it is a pure `parameter_change_requests` query.

No compatibility re-exports: every import site is repointed to the new module paths. The parameters directory already carries the precedent for this shape (`initializationRepository.ts`, `parameterModuleRepository.ts`, `dashboard/repository.ts`).

Shared private helpers used by both moved and remaining code stay in `repository.ts` and are now exported for internal reuse: `dateTimeToIso`, `resolveParameterValueKind`, `addCondition`.

Test coverage moves with the code: `repository.test.ts` blocks covering moved functions move verbatim (import paths only) to `projectRepository.test.ts` / `reviewWorkflowRepository.test.ts`, duplicating the small `createFakeDb` fixture rather than introducing a shared test helper.

## Slice 2 — finish the aggregate split (implemented)

Slice 2 completes the extraction with the same verbatim rules (no renames, no signature/logic changes, no new interfaces, no compatibility re-exports; every import site repointed):

1. **`server/modules/parameters/draftRepository.ts`** — the draft-lifecycle cluster (`parameter_drafts`): `ParameterWriteLockRow` + `toWriteLockFields` / `toEnablementWriteLockFields`, `getDraftWriteLock`, `getBindingDraftForSubmission` / `getEnablementDraftForSubmission` (+ their DTO types), `promoteBindingDraftCandidateForReview`, `listDraftsForUser`, `listDraftsForParameterValue`, `listOpenBindingDraftsForUser`, `rebaseOpenBindingDraftCandidates`, `upsertDraft`, `upsertEnablementDraft`, `upsertFileSyncDraft`, `deleteDraft`, `deleteDraftForParameter`, the private `DraftRow` type and `toDraftDto` / `toDraftWithOrigin` mappers, and `ParameterDraftWithOrigin`. The change-request write-lock getters (`getChangeRequestWriteLock`, `getChangeRequestEnablementWriteLock`) move here too: they are thin reads over the same `ParameterWriteLockRow` mapping helpers, so they cohere with the write-lock row cluster rather than the review workflow.
2. **`server/modules/parameters/fileSyncConflictRepository.ts`** — the `parameter_file_sync_conflicts` cluster: `hasOpenFileSyncConflict`, `insertFileSyncConflict`, `listOpenConflicts`, `listFileSyncConflictsByIds`, `resolveConflict`, the `FILE_SYNC_CONFLICT_SELECT` enrichment fragment, `FileSyncConflictRecord`, and the private row/locator types and mappers.
3. **`server/modules/parameters/importBatchRepository.ts`** — the DTS import batch cluster (`parameter_import_batches`): `listParameterDefinitionsForImport`, `insertImportBatch`, `getImportBatchForUpdate`, `applyAddedImportItem`, `applyUpdatedImportItem`, `markImportBatchApplied`, plus `ImportPreviewClassification`, `PersistedImportBatchItem`, `PersistedImportBatchDto`, `ParameterDefinitionImportCandidate`, `ImportApplyResult`, and their private row types/mappers.
4. **`server/modules/parameters/repositoryShared.ts`** — the slice-1 shared-helper carry-over (`dateTimeToIso`, `resolveParameterValueKind`, `addCondition`) re-homed; `repository.ts`, `projectRepository.ts`, `reviewWorkflowRepository.ts`, and the three new modules all import from it, so **no extracted module imports from `./repository` anymore**.
5. The unused `EnablementWriteLockFields` re-export from `repository.ts` is dropped (all consumers already import it from `parameter-topology/writeLock`).

`repository.ts` shrinks from 2,674 to 660 lines and keeps one responsibility: parameter listing/detail/history (`listParameters`, `getParameterById`, `listParameterHistory`) plus project-parameter-value/source binding resolution (`getProjectParameterForUpdate`, `findProjectValueBySource`, `findProjectValueByDefinition`, `bindParameterSource`, `insertProjectParameterValueWithSource`) and the pre-existing `parameterModuleRepository` re-export block.

Slice 2 import sites repointed: `parameters/service.ts`, `parameters/listOpenConflicts.postCutover.integration.test.ts`, `parameter-files/{candidateService,conflictService,releaseReadinessService,routes,syncService,writebackService}.ts`, the `parameter-files` route/service test mocks (`routes`, `configSetBaselineRoutes`, `dtsSearchRoutes`, `structuralReadRoutes`, `releaseReadinessService`, `syncService`, `integration`), `parameter-topology/editService.ts` (+ `editService.test.ts`, `postCutoverWorkflow.integration.test.ts`), and the `legacyDependencyGuard` allowlist (the pre-cutover legacy-table literals moved with the draft and conflict clusters). Test blocks moved verbatim from `repository.test.ts` into `draftRepository.test.ts`, `fileSyncConflictRepository.test.ts`, and `importBatchRepository.test.ts`, duplicating the `createFakeDb` fixture per slice-1 precedent.

Slice 2 also closes the PR #327 type residue in `parameter-topology`: `BindingDraftWriteTarget` now lives in `writeLock.ts` (its producer), `BindingEditAction` and `CreateBindingDraftDeps` in `overlayWriteback.ts` (their primary consumer); `writeLock.ts` and `overlayWriteback.ts` no longer import anything from `editService.ts`, making the runtime and type graphs both acyclic (`editService → overlayWriteback → writeLock`).

## Non-goals (deferred by design)

- ~~**The draft cluster stays in `repository.ts`**~~ — done in slice 2 (see above).
- **No port interface.** A formal repository port is deferred to the test-foundation follow-up (`2026-08-12-test-foundation-deepening.md` stream), when a second adapter exists to justify it.
- **No parameters↔parameter-topology cycle break.** After slice 2 the cross-module edges are: `repository.ts`/`importBatchRepository.ts` import `LEGACY_SQL` from `parameter-topology/migration`, `draftRepository.ts`/`reviewWorkflowRepository.ts` import the write-lock types from `parameter-topology/writeLock`, while parameter-topology services import parameters repositories. Breaking the module-level cycle needs a drafts-ownership design decision (which module owns `parameter_drafts` and the write-lock vocabulary) that these slices do not preempt.
- No frontend, agent-logic, packages, or dts-reload changes beyond import-path updates.

## Import sites repointed (slice 1)

- `server/modules/parameters/service.ts` — review-workflow symbols → `./reviewWorkflowRepository`; `getProjectById` → `./projectRepository`.
- `server/modules/parameters/routes.ts` — project admin/list reads → `./projectRepository`.
- `server/modules/parameters/projectService.ts` — `createProject`/`updateProject`/`deleteProject` → `./projectRepository`.
- `server/modules/parameters/routes.test.ts`, `projectAdminMutations.test.ts` — mocks and namespaces split/repointed accordingly.
- `server/modules/parameter-topology/service.ts` + `service.test.ts` — `getProjectById` → `../parameters/projectRepository`.
- `server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts`, `migration.test.ts` — mixed imports split across the three modules.

## Verification

- `npx tsc -b` clean.
- `npm run test:server` (full suite); at minimum all `server/modules/parameters/*.test.ts`, `server/modules/parameter-files/*.test.ts`, `server/modules/parameter-topology/service.test.ts`, and every edited test file.
- `npm run docs:check`.
- Slice 2: `npx tsc -b` exit 0 (pipestatus-verified); `npm run test:server -- parameters parameter-topology parameter-files` — 651 passed / 45 failed, with the failing files and counts byte-identical to a detached `main` checkout run (pre-existing local-DB schema issue: `relation "project_parameter_values" does not exist` in integration/dashboard suites); mechanical multiset line-diff of old vs. new files confirms all moved bodies verbatim (only import lines and the dropped re-export differ); `npm run docs:check` green.

## UI Interaction Automation Review

Behavior-preserving backend refactor: no route, endpoint, DTO, permission, or UI behavior changes. No acceptance requirement IDs or operation IDs are added or modified; existing browser acceptance specs are unaffected.

## Git & PR Workflow

- Slice 1: branch `refactor/parameters-repository-split-1` from `main`. Logical commits: project cluster extraction, review-workflow cluster extraction, plan doc.
- Slice 2: branch `refactor/parameters-repository-split-2` from `main` @ `5826b2b2`. Logical commits: repository split (draft/fileSyncConflict/importBatch + shared helpers), edit-type re-home, plan docs.
- Implementation agent commits on the feature branch only; the parent agent reviews, opens the GitHub PR, merges, and syncs local `main`.

## Documentation Impact Matrix

| Doc | Path | Impact |
| --- | --- | --- |
| Repository map | `AGENTS.md` | No change (module map lists directories, not files) |
| Architecture | `ARCHITECTURE.md` | No change (documents the `server/modules/*` boundary, not intra-module file layout) |
| Architecture (zh) | `docs/zh-CN/architecture.md` | No change |
| Full-stack architecture | `docs/design-docs/full-stack-architecture.md` | Review — mentions module repository files generically; no row names `parameters/repository.ts` explicitly (verified via search; unchanged) |
| Domain model | `docs/design-docs/domain-model.md` | No change (entities and state machines unchanged) |
| Plans index | `docs/PLANS.md` | Update at closeout — add this plan to Current Active Plan when the parent merges |
| Plans index (zh) | `docs/zh-CN/PLANS.md` | Review — mirror the English row if added |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Update at closeout — record remaining follow-ups (port interface, cycle break; the draft-cluster slice is done) if not planned elsewhere |
| Product specs | `docs/product-specs/*` | No change (no product behavior change) |
| Quality/testing | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md` | No change (tests move verbatim; counts and strategy unchanged) |
| Reliability/runbooks | `docs/RELIABILITY.md`, `docs/runbooks/*` | No change |
| Security | `docs/SECURITY.md`, `docs/security/*` | No change (authz/audit enforcement untouched) |
| API docs | `docs/api/*` | No change (no endpoint/DTO change) |
| Generated | `docs/generated/*` | No change (schema unchanged) |
| References | `docs/references/*` | No change |

## Documentation Update Gate

This plan cannot move to `completed/` until every Update/Review row above is either applied or explicitly recorded as unchanged with evidence, and `npm run docs:check` passes. Deferred work goes to `docs/exec-plans/tech-debt-tracker.md`.

## Expected Outcomes

- Slice 1: `repository.ts` shrinks from 5,435 to ~2,690 lines; `projectRepository.ts` ~456 lines (8 exported functions); `reviewWorkflowRepository.ts` ~2,317 lines (24 exported functions + 3 private helpers).
- Slice 2: `repository.ts` 2,674 → 660 lines (listing/detail/history + value/source binding only); `draftRepository.ts` 1,160 lines; `fileSyncConflictRepository.ts` 432 lines; `importBatchRepository.ts` 426 lines; `repositoryShared.ts` 27 lines; `editService.ts` 1,241 → 1,217 lines with `writeLock.ts`/`overlayWriteback.ts` importing nothing from it.
- Zero behavior change: moved bodies are byte-identical to the originals; no extracted module imports from `./repository`; no compatibility re-exports.
