# T2.2-PRJ project consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-prj-project-consumers-acceptance.md)

Status: **T2.2-PRJ local candidate complete.** Design Spec PASS with P2; implementation Standards PASS with P2; implementation Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). No SEALED, commit, PR, merge, Hosted, target, or Issue update.

Contract: [threat matrix](t22-prj-project-consumers-threat-matrix.md), [design](t22-prj-project-consumers-design.md), [design Spec review](t22-prj-project-consumers-spec-review.md), [implementation review](t22-prj-project-consumers-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- T1.1–T2.2-TOP remain uncommitted. No commit.

## Behaviour delivered

1. `parameterClient.listDrafts(projectId)` → `GET /api/v2/projects/:projectId/parameter-value-drafts`, parsed with `projectValueDraftListResponseSchema`. `parameterId` ← `bindingId`.
2. `deleteDraft(draftId, projectId?)` uses v2 DELETE when `projectId` is present; otherwise v1 DELETE (T2.1 helper).
3. `parameterRuntime.refresh` lists drafts per project after `listProjects()`. `discardDrafts` passes `projectId` into `deleteDraft`.
4. v1 `saveDraft` still CONFLICT in semantic mode. Initialization HTTP unchanged. PARAM-INIT Playwright still future. No jobs/scripts in S12-PRJ paths.

## Classification (T22P-01)

S12-PRJ **422** entries, **88** file×rule groups, 0 unexplained. Table: [t22-prj-project-consumers-classification.md](t22-prj-project-consumers-classification.md).

| Class | Count |
| --- | --- |
| canonical-current-workbench | 212 |
| canonical-current-initialization | 27 |
| canonical-current-dts-spec | 2 |
| exact-canonical-history | 181 |
| archived-notice | 0 |

## Ratchet (T22P-11)

PRJ 422→422, total 3513→3513, delta 0. Honest zero: v1 route strings remain in `parameters/routes.ts`. Checker **did not complete** (`editService.ts` relocation blob from T2.2-TOP; fixtures not rewritten).

## Verification (do not sum)

Helper PG not required for these unit tests. No UI sweep (`/parameters` tray already v2).

| Command | Result |
| --- | --- |
| `npm test -- parameterClient.test.ts parameterRuntime.test.ts` | **33 passed** (15+18) |
| `npm test -- mockParameterRepository.test.ts` | **25 passed** (earlier same run) |
| `npx tsc -b` | **passed** |
| `git diff --check` on PRJ code files | **passed** |
| boundary checker | **did not complete** (T2.2-TOP `editService.ts` blob) |

## Remaining limits

- v1 `/mine` and v1 DELETE still mounted (T2.1 helper).
- Submit `parameterSpecId` still required on binding items.
- PARAM-INIT Playwright remains T3.2.
- No focused client test that no-arg `listDrafts()` still hits v1 `/mine`; two-project refresh test does not assert `listDrafts` fan-out (implementation does).
- Mock `applyImportBatch` still hydrates via `listDrafts()` with no projectId (not the API refresh path).
- `fileSyncConflictRepository.ts` production rows labeled workbench; no FIL edits.
- No T2.2-FIL, no commit.
