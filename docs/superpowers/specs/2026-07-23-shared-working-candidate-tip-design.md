# Shared Working Candidate Tip for Draft Round — Design

> Date: 2026-07-23  
> Status: Design approved; awaiting implementation plan  
> Chinese: [`docs/zh-CN/superpowers/specs/2026-07-23-shared-working-candidate-tip-design.md`](../../zh-CN/superpowers/specs/2026-07-23-shared-working-candidate-tip-design.md)  
> Related: `DtsBindingDraftTray`, `createBindingDraft` (`editService.ts`), `ApiProjectTopologyWorkspace`, binding-draft submit path

## 1. Context

Typed binding edits each create a new **candidate config revision** tip. The workbench advances `preferredRevision` to that tip so the next edit stacks correctly, but each draft row keeps the `candidateRevisionId` from the moment it was created.

Result after editing parameter A then B:

| Draft | `candidateRevisionId` |
|---|---|
| A | candidate₁ |
| B | candidate₂ (built on candidate₁, content includes A+B) |

`DtsBindingDraftTray.candidateBlocker` requires all tray drafts to share one candidate id, so batch submit fails with:

> 本轮修改属于不同 candidate revision，当前不能批量提交；请仅保留同一 candidate 的草稿。

Users experience “本轮修改” as one bag; the system treats each edit as its own tip pointer. The blocker also exposes internal jargon (`candidate revision`).

Server `submitParameterChanges` loads each draft’s persisted candidate separately and does not currently enforce a shared tip — the tray gate is the primary UX failure. Correctness for a single review round still requires all open drafts in the round to point at the **same tip** that contains every change.

## 2. Goals / Non-goals

### Goals

- One **working tip** per **user × project** covering **all unsubmitted typed drafts** (including drafts hydrated after reload).
- Subsequent edits must stack on that tip; after each successful create, sibling open drafts are **rebased** (pointer advanced) to the new tip.
- Batch submit of the round succeeds without asking the user to drop drafts or understand candidates.
- UI copy uses business language (“本轮 / 工作版本”); never `candidate revision` in user-facing blockers.
- Clear 409 when the client uses a stale `baseRevisionId` (not the current working tip).

### Non-goals

- Parallel multi-round draft batches (A/B tray cards).
- Changes to review roles, merge/writeback, or identity mapping.
- Restoring mock-mode local draft → modified-table as a parallel product path.
- Cross-user shared rounds (tip is per actor user × project only).
- Full three-way merge for unhealable dirty multi-tip history (block + prompt clear/restart only).

## 3. Product rules

1. **Round scope** = all unsubmitted typed binding drafts for `(organization, project, user)`.
2. **First edit in a round**: `baseRevisionId` = current published/workspace tip; creates working tip `T₁`; draft points at `T₁`.
3. **Later edits**: `baseRevisionId` **must equal** the current working tip `Tₙ₋₁`; create `Tₙ` stacked on it; new draft points at `Tₙ`.
4. **Rebase siblings**: on successful create of `Tₙ`, update every other open draft in the round so `candidate_config_revision_id = Tₙ`. Content already includes prior edits because base was `Tₙ₋₁`.
5. **Same binding re-edit**: keep existing upsert-same-`draftId` behavior; tip advances; siblings rebase.
6. **Empty round**: removing/clearing the last open draft clears the working tip; next edit starts a new round.
7. **Submit success**: drafts leave the open set; working tip is no longer the draft tip (review/candidate promotion continues on existing paths).
8. **Dirty multi-tip data**: before create, if open drafts do not share one tip lineage that can be healed by rebasing to the latest tip in-chain, reject with actionable Chinese copy (keep one group or clear and restart). Prefer auto-heal when all drafts already sit on a single linear tip chain.

## 4. Backend

Primary change surface: `createBindingDraft` in `server/modules/parameter-topology/editService.ts` (wired via `service.ts` / routes / schemas).

### 4.1 Resolve working tip

Before ingest:

- Load open typed drafts for auth user + project (same origin/filter as list drafts / submission eligibility).
- Working tip = the latest tip among those drafts’ `candidate_config_revision_id` values when they form one linear chain; if none, working tip is absent.

### 4.2 Base revision gate

- If working tip exists and `input.baseRevisionId !== workingTip` → `409 CONFLICT` with structured reason (e.g. `stale-working-tip` / reuse existing stale-revision shape) and message suitable for UI: ask to refresh and continue from the round’s latest working version.
- If no working tip → existing base-revision validity checks only.

### 4.3 After ingest of new candidate `Tₙ`

- Persist the new/updated draft as today (including same-binding upsert).
- `UPDATE parameter_drafts SET candidate_config_revision_id = Tₙ` for all other open drafts in the round (same org/project/user, unsubmitted).
- Optionally verify tip still matches each sibling draft’s target action/value (existing `candidateValueMatchesDraft` / action-proven gates used at submit); if a sibling no longer matches, fail closed with conflict rather than silent wrong submit.

### 4.4 Response DTO (additive)

Extend create-draft response (and frontend `BindingDraftResult`):

| Field | Meaning |
|---|---|
| `candidateRevisionId` | New tip `Tₙ` (unchanged meaning for the edited draft) |
| `workingCandidateRevisionId` | Same as tip (explicit alias for clients) |
| `rebasedDraftIds` | Sibling draft ids whose candidate pointer was advanced |

OpenAPI / contract registry updated in the same change if the route is registered there.

### 4.5 Submit assertion

In `submitParameterChanges`, for a batch of exact binding drafts: all loaded `candidateConfigRevisionId` values must be identical and non-null; else `409` with business Chinese message (no English jargon). Prefer trusting DB after rebase over reintroducing a harsh tray-only gate.

## 5. Frontend

| Area | Change |
|---|---|
| `ApiProjectTopologyWorkspace` | Keep setting `preferredRevision` from returned tip; after create, align local tray `candidateRevisionId` for `rebasedDraftIds` (and prefer server hydrate as source of truth). |
| `DtsBindingDraftTray` | Remove or demote `candidateBlocker` that shows `candidate revision`; if multi-tip still observed, show actionable Chinese copy. Header/status: `本轮 N 项 · 同一工作版本`. |
| Ports / HTTP client / tests | Accept new optional response fields; assert multi-binding create yields one tip and submit enabled. |

No change to submit wire item shape (`draftId`, binding, spec, action, value, reason, assignees).

## 6. UX copy

| Situation | Copy direction |
|---|---|
| Healthy tray | `本轮 N 项 · 同一工作版本` |
| Stale base / not on tip | `请刷新后基于本轮最新工作版本继续编辑。` |
| Unhealable multi-tip | `本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。` |
| Forbidden | User-visible `candidate revision` / raw revision UUIDs as the primary explanation |

## 7. Acceptance criteria

1. Same user, same project: edit **≥2 different bindings** in sequence → tray can「提交审核」without multi-candidate blocker.
2. Reload → hydrated open drafts still one round; edit a third parameter → all three share one tip and can batch-submit.
3. Same-binding re-edit still upserts one `draftId`; siblings advance with the tip.
4. Create with `baseRevisionId ≠` working tip → `409` + refresh guidance.
5. No user-facing `candidate revision` string in the tray blocker path; healthy state shows shared working-version language.
6. Targeted unit tests + one critical integration/acceptance path pass.

## 8. Test plan (design-level)

- `editService.test.ts`: two different bindings → equal `candidateRevisionId`; third edit still equal; base≠tip → 409; same-binding replacement still one row.
- `submitParameterChanges` / service tests: mixed candidate ids rejected; shared tip accepted.
- Frontend workspace/tray tests: sequential creates update sibling tip ids; submit not blocked by legacy copy.
- Optional acceptance: multi-parameter edit → submit round (existing topology acceptance helpers).

## 9. Documentation impact

- Update developer-facing notes that describe “one edit → one isolated candidate for submit” if any (e.g. `docs/FRONTEND.md` tray/submit paragraph, zh-CN mirror).
- Spec lives here; implementation plan under `docs/superpowers/plans/` (and zh-CN if mirrored) after this file is approved for planning.

## 10. Decision summary

| Decision | Choice |
|---|---|
| Approach | Shared working tip (product option A) |
| Round scope | All unsubmitted drafts for user × project (scope option A) |
| Base rule | Must equal current working tip when tip exists |
| Sibling update | Server rebase of candidate pointers after each create |
| Tray multi-candidate gate | Remove/replace; server enforces shared tip at submit |
| Jargon | Hidden from users |
