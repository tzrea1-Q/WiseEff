# Parameter-Topology editService Decomposition: writeLock + overlayWriteback (Architecture Review Candidate 6)

> Status: **Active**
> Date: 2026-08-12
> Branch: `refactor/topology-writelock-writeback` (created from `main` @ `8ab19113`)
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-12-topology-writelock-writeback.md`](../../zh-CN/exec-plans/active/2026-08-12-topology-writelock-writeback.md)

## Background

The 2026-08-12 architecture review flagged `server/modules/parameter-topology/editService.ts` (candidate 6) as a grab-bag: 2,912 lines and 15 exports mixing draft creation, four near-duplicate write-lock functions, two copied binding/enablement writeback pipelines, DTS text manipulation, and object-store I/O in one file. Candidates 1–2 are owned by `2026-08-12-app-shell-decomposition.md`; candidates 3–4 by the database-layer deepening plan; this plan executes candidate 6 as a verbatim, zero-behavior-change extraction.

## Goal

Extract two cohesive modules from `editService.ts`, keeping every moved function body byte-identical (the only permitted delta is adding `export` to previously module-private shared helpers):

- `server/modules/parameter-topology/writeLock.ts` — write-lock resolution/verification (`resolveBindingWriteLock`, `verifyBindingWriteLock`, `resolveEnablementWriteLock`, `verifyEnablementWriteLock`), the `BindingWriteLockFields` / `BindingWriteLockContext` / `EnablementWriteLockFields` / `EnablementWriteLockContext` types, and the shared write-target resolution helpers those functions depend on (`loadBindingContext`, `loadRevisionMembers`, `resolveWriteTarget`, `resolveTargetRef`, `firstLabel`, `locatorLeafLabel`, `loadLogicalNodeEnablementContext`, plus the `BindingContextRow` / `RevisionMemberRow` / `EffectRow` row types).
- `server/modules/parameter-topology/overlayWriteback.ts` — the locked writeback pipeline (`applyLockedOverlayWriteback`, `applyLockedEnablementWriteback` and their Input/Result types), `ensureOverlayProperty` with its private CST span helpers (`findAllOverlayNodesByRef`, `findPropertyByExactSpan`, `findNodeByExactSpan`, `propertyStatementSpan`, `insertAfterNodeOpenBrace`, `resolveInsertTargetNode`), `loadFileContentFromVersion`, and the shared candidate-gate helpers (`checksumOf`, `throwIfManifestNeedsReview`, `loadCandidateSemanticGateCounts`, `ensureCandidateKeepStatus`, `candidateGateError`).

`editService.ts` keeps draft creation (`createBindingDraft`, `createNodeEnablementDraft`), the draft DTO types, `resolveInitializationSuggestion`, `unchangedSourceBytes` (a draft-result assertion helper used only by tests — verified not part of the writeback pipeline), `assertCandidateToolchainRelease`, and draft-only private helpers. It imports the moved pieces from the two new modules.

Shared helpers were sunk into the new modules (rather than left behind) so runtime dependencies stay acyclic: `editService → overlayWriteback → writeLock → (repository, shared)`. The only references back into `editService.ts` are compile-time-erased `import type` lines (`BindingDraftWriteTarget`, `BindingEditAction`, `CreateBindingDraftDeps`), which is why `loadLogicalNodeEnablementContext` had to move to `writeLock.ts` instead of staying behind.

No compatibility re-exports: every importer was repointed. Updated import sites:

- `server/modules/parameters/service.ts` — `verifyBindingWriteLock`, `verifyEnablementWriteLock`, and `loadLogicalNodeEnablementContext` now import from `writeLock`; `resolveInitializationSuggestion` still from `editService` (import statement lines only).
- `server/modules/parameters/repository.ts` — the `BindingWriteLockFields` / `EnablementWriteLockFields` type import repointed to `writeLock` (single import line; no other change).
- `server/modules/parameter-files/writebackService.ts` — `applyLocked*` from `overlayWriteback`; `resolve*WriteLock` and the four lock types from `writeLock`; `BindingEditAction` still from `editService`.
- `server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts` and `server/modules/parameter-topology/editService.test.ts` — import paths only.

Test strategy: the moved functions' test blocks stay in `editService.test.ts` with retargeted imports. The `applyLockedOverlayWriteback` describe block (46 lines) and the `resolveBindingWriteLock` call sites are entangled with ~490 lines of shared fixtures (`seedGraph`, `seedConfigAndBinding`, `makeAuth`, toolchain doubles) used by all four describes; moving them would have required duplicating or restructuring fixtures, a larger diff for zero coverage gain.

## Non-Goals

- **No binding/enablement dedup.** The near-duplication between the binding and enablement variants (locks, writebacks, draft pipelines) is explicitly deferred; collapsing it needs its own equivalence proof.
- **No shared-kernel relocation.** The `../../../src/domain/*` imports from backend files (12 files import `src/domain`) stay exactly as they are; re-homing the shared kernel is a separate deferred task.
- **No behavior change.** No renames, no signature changes, no logic edits, no new interfaces or dependency-injection types.

## Verification

- Mechanical verbatim check: all 58 top-level declarations of the pre-move `editService.ts` compared byte-for-byte against their post-move locations (only `export ` prefix additions allowed) — all identical.
- `npx tsc -b` green at each commit.
- `npm run test:server` scope run: `server/modules/parameter-topology/*` 19/20 files green (238 passed); `server/modules/parameters/service.test.ts` green; `server/modules/parameter-files/*` 32/37 files green. The failures — `parameter-topology/migration.test.ts` (9 tests, `relation "parameter_definitions" does not exist`) and 13 `parameter-files/*.integration.test.ts` tests — fail identically on clean `main` (verified by stash/detached-HEAD runs); they are environment schema issues unrelated to this change.
- `npm run docs:check` green.

## UI Interaction Automation Review

Backend-only verbatim refactor: no route, form, table, upload, modal, approval, navigation, client, permission, or device behavior changes. No acceptance requirement IDs or operation IDs are affected; existing browser acceptance specs continue to cover the affected flows unchanged.

## Git & PR Workflow

- One branch: `refactor/topology-writelock-writeback` from `main` @ `8ab19113`. Commits: writeLock extraction, overlayWriteback extraction (each `tsc -b`-green), then this plan.
- Implementation agent commits on the feature branch only; the parent agent reviews, opens the GitHub PR, merges when green, and syncs local `main`.

## Documentation Impact Matrix

| Doc | Path | Impact |
| --- | --- | --- |
| Repository map | `AGENTS.md` | No change (module layout within `server/modules/parameter-topology/` is below map granularity) |
| Architecture | `ARCHITECTURE.md` | No change (module boundaries and dataflow unchanged; file split is within one module) |
| Architecture (zh) | `docs/zh-CN/architecture.md` | No change (mirror of the above) |
| Full-stack architecture | `docs/design-docs/full-stack-architecture.md` | No change (no seam or layer change) |
| Domain model | `docs/design-docs/domain-model.md` | No change (no entity or state-machine change) |
| Plans index | `docs/PLANS.md` | No change (index lists themes, not per-plan rows; this plan lives in `active/`) |
| Plans index (zh) | `docs/zh-CN/PLANS.md` | No change (mirror of the above) |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | No change now — the deferred binding/enablement dedup and `src/domain` shared-kernel re-homing are follow-ups owned by the 2026-08-12 architecture review, to be registered when that review's tracker rows land |
| Product specs | `docs/product-specs/*` | No change (no product behavior change) |
| API docs | `docs/api/*` | No change (no endpoint/DTO change) |
| Quality/testing | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md` | No change (tests keep their file and coverage; only import lines changed) |
| Reliability/runbooks | `docs/RELIABILITY.md`, `docs/runbooks/*` | No change |
| Security | `docs/SECURITY.md`, `docs/security/*` | No change (authz/audit paths untouched) |
| Frontend | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | No change (backend-only) |
| Generated | `docs/generated/*` | No change (no schema change) |
| References | `docs/references/*` | No change |

## Documentation Update Gate

This plan cannot move to `completed/` until every row above is either applied or explicitly recorded as unchanged with evidence, and `npm run docs:check` passes. All rows are `No change` with the evidence stated inline; `npm run docs:check` passes on this branch. Deferred work (binding/enablement dedup; shared-kernel relocation) is tracked by the 2026-08-12 architecture review follow-ups rather than this plan.

## Expected Outcomes

- `editService.ts` 1,242 lines (from 2,912): draft creation and draft-facing helpers only.
- `writeLock.ts` 796 lines: lock resolution/verification plus shared write-target resolution.
- `overlayWriteback.ts` 930 lines: locked writeback pipeline, CST patch helpers, object-store file loading, candidate gates.
- Zero behavior change: moved bodies byte-identical; all importers repointed; no compatibility re-exports; runtime module graph acyclic.
