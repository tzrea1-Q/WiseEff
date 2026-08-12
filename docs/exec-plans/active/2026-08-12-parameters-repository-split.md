# Parameters Repository Split — Slice 1 (Architecture Review Candidate 3)

- **Status:** Active (slice 1 implemented)
- **Branch:** `refactor/parameters-repository-split-1` (created from `main` @ `faa6cc19`)
- **Owner:** Backend
- **Scope source:** 2026-08-12 architecture review, Candidate 3: `server/modules/parameters/repository.ts` is a god module — 5,435 lines, 68 exported functions touching ~35 tables in one flat namespace, imported by 40+ files including 12+ other backend modules. Candidates 1–2 (frontend shell) are owned by `2026-08-12-app-shell-decomposition.md`.

## Goal

Carve the two most separable aggregates out of `repository.ts` as pure verbatim function moves — zero behavior change, no renames, no signature changes, no dedup, no new interfaces:

1. **`server/modules/parameters/projectRepository.ts`** — the project CRUD / project admin cluster (`projects`, `project_modules` tables): `listProjects`, `getProjectById`, `listProjectAdminSummaries`, `getProjectAdminDetail`, `createProject`, `updateProject`, `deleteProject`, `listProjectModules`, plus their private row types (`ProjectRow`, `ProjectModuleRow`) and mappers (`toProjectDto`, `toProjectAdminSummaryDto`, `toProjectModuleDto`).
2. **`server/modules/parameters/reviewWorkflowRepository.ts`** — the review-workflow cluster (`parameter_submission_rounds`, `parameter_submission_items`, `parameter_change_requests`, `parameter_review_decisions` tables): submission rounds, change-request creation, review decisions, status transitions, and `mergeChangeRequest` with its private helpers (`mergeEnablementChangeRequest`, `listSubmissionItemsByRoundIds`, `listWorkflowAssigneesByRoundIds`), the change-request row types/mappers, and the `CR_*` SQL fragment constants. `findOpenEnablementChangeRequest` moves with its twin `findOpenChangeRequest` even though it sat in the top section of the file — it is a pure `parameter_change_requests` query.

No compatibility re-exports: every import site is repointed to the new module paths. The parameters directory already carries the precedent for this shape (`initializationRepository.ts`, `parameterModuleRepository.ts`, `dashboard/repository.ts`).

Shared private helpers used by both moved and remaining code stay in `repository.ts` and are now exported for internal reuse: `dateTimeToIso`, `resolveParameterValueKind`, `addCondition`.

Test coverage moves with the code: `repository.test.ts` blocks covering moved functions move verbatim (import paths only) to `projectRepository.test.ts` / `reviewWorkflowRepository.test.ts`, duplicating the small `createFakeDb` fixture rather than introducing a shared test helper.

## Non-goals (deferred by design)

- **The draft cluster stays in `repository.ts`** (`upsertDraft`, `upsertEnablementDraft`, `upsertFileSyncDraft`, `listOpenBindingDraftsForUser`, `rebaseOpenBindingDraftCandidates`, write-lock getters, draft-for-submission readers, file-sync conflicts, parameter reads, imports, and project parameter values). `parameter-topology/editService.ts` imports the draft functions and is deliberately untouched by this slice to avoid conflicting with parallel work.
- **No port interface.** A formal repository port is deferred to the test-foundation follow-up (`2026-08-12-test-foundation-deepening.md` stream), when a second adapter exists to justify it.
- **No parameters↔parameter-topology cycle break.** `repository.ts` still imports `LEGACY_SQL` from `parameter-topology/migration` and the write-lock types from `parameter-topology/editService`, while parameter-topology services import parameters repositories. Breaking the cycle needs a drafts-ownership design decision (which module owns `parameter_drafts` and the write-lock vocabulary) that this slice does not preempt.
- No frontend, agent-logic, packages, or dts-reload changes beyond import-path updates.

## Import sites repointed

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

## UI Interaction Automation Review

Behavior-preserving backend refactor: no route, endpoint, DTO, permission, or UI behavior changes. No acceptance requirement IDs or operation IDs are added or modified; existing browser acceptance specs are unaffected.

## Git & PR Workflow

- One branch: `refactor/parameters-repository-split-1` from `main`. Logical commits: project cluster extraction, review-workflow cluster extraction, plan doc.
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
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Update at closeout — record follow-up slices (draft cluster, port interface, cycle break) if not planned elsewhere |
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

- `repository.ts` shrinks from 5,435 to ~2,690 lines; `projectRepository.ts` ~456 lines (8 exported functions); `reviewWorkflowRepository.ts` ~2,317 lines (24 exported functions + 3 private helpers).
- Zero behavior change: moved bodies are byte-identical to the originals; full server suite green.
- `editService.ts` untouched; draft cluster intact for the follow-up slice.
