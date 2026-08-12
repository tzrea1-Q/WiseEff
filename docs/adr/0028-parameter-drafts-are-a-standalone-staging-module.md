# ADR-0028: Parameter drafts are a standalone staging module

- Status: Accepted
- Date: 2026-08-12

## Context

`parameter_drafts` is the staging area between the two parameter workflows: editing (`parameter-topology/editService`) writes drafts, upserts enablement drafts, and rebases sibling candidate tips, while submission/review (`parameters/service`) reads drafts for submission, promotes candidates, and deletes drafts after merge. After the repository split (slices 1–2, PRs #321/#340) the aggregate sat in `parameters/draftRepository.ts`, which kept two module-cycle edge groups alive: `parameter-topology/editService.ts` imported the draft repository from `parameters` (topology → parameters), and `parameters/draftRepository.ts` / `reviewWorkflowRepository.ts` imported the persisted write-lock field types from `parameter-topology/writeLock.ts` (parameters → topology). The slice-2 plan explicitly deferred the ownership decision: which module owns `parameter_drafts` and the write-lock vocabulary.

## Decision

Parameter drafts are a standalone staging module, `server/modules/parameter-drafts/`, owned by neither workflow module: editing writes drafts and submission/review reads them, so both depend downward on the drafts module and it depends on neither. The module owns the `parameter_drafts` read/write surface (`repository.ts`, `semanticDraftUpsert.ts`) and the staging vocabulary (`types.ts`: `ParameterChangeAction`, `ParameterDraftDto`, and the persisted write-lock field shapes `BindingWriteLockFields` / `EnablementWriteLockFields`). Generic SQL helpers (`dateTimeToIso`, `addCondition`) move to `server/shared/database/sqlUtil.ts` so repositories in any module use them without importing from `parameters`. All moves are verbatim; there are no compatibility re-exports. Write-lock *resolution and verification* (the `*WriteLockContext` types, `resolveBindingWriteLock`, `verifyBindingWriteLock`, …) stays in `parameter-topology/writeLock.ts` — only the field shapes that drafts and change requests persist moved.

## Consequences

- The draft edge (parameter-topology → parameters) and the lock-type edges (parameters → parameter-topology) are removed: `editService`, `writeLock`, `parameters/service`, `reviewWorkflowRepository`, `parameter-files` writeback/sync/conflict services, and the Xiaoze action tools now import drafts and lock-field types from `parameter-drafts`.
- `server/modules/parameter-drafts/` imports nothing from `parameter-topology`. Its single import from `parameters` is `parameterIdentityMode` — part of the deferred shared-kernel seam (`policy`, `parameterIdentityMode`, `sensitiveNode`, `legacyParameterIdentityAdapter`), left in place by design.
- The parameters↔parameter-topology cycle itself still closes through that kernel seam (topology → parameters) and through write-lock verification, initialization-suggestion, and migration `LEGACY_SQL` imports (parameters → topology). Breaking it is a separate shared-kernel slice; this ADR does not preempt where the kernel finally lives.
- `parameters/types.ts` now imports `ParameterChangeAction` from the drafts module for its change-request DTOs: the staging module defines the action vocabulary (`set` / `delete`) that the workflow DTOs inherit.
