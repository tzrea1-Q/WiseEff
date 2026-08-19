# Property-key cutover remainder is an accepted residual

> Status: **Completed 2026-08-19** — option 1 accepted. TD-117 closed as accepted residual. The cross-page human merge is the ADR-correct leftover, not a missing cutover machine.  
> Date: 2026-08-19  
> Branch: `feat/td-117-remainder-plan` (merged #558)  
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-19-property-key-cutover-remainder.md`](../../zh-CN/exec-plans/completed/2026-08-19-property-key-cutover-remainder.md)  
> Parent: [`2026-08-18-property-key-source-cutover.md`](2026-08-18-property-key-source-cutover.md)  
> Governing decision: [ADR-0034](../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md)  
> Tracker: [TD-117](../tech-debt-tracker.md) (closed as accepted residual)

## Goal

Record the remainder decision for TD-117 after the workbench-handoff slice (#555).

The cutover machine is on `main`: preview, start, prepare (file-candidate only), workbench deep-link, re-preview gate, finalize. Operators still leave the spec editor to activate, then return to re-preview before finalize. That loop is **navigation**, not an incomplete migration. After this plan is accepted, session 0 closes TD-117 as an accepted residual and archives the parent plus this remainder.

This PR ships only the decision record and a one-line parent pointer. It does not change product code, ADR-0034, the tracker, or `docs/PLANS.md`.

## Locked decision

**Option 1 — close TD-117 as accepted residual.**

ADR-0034 already names the human merge: items become ready as mergeable candidates; humans merge on the existing review / activate path; the cutover job must not auto-merge or write live source. Finalize rewrites the catalog triple only after live source already has the new key.

#555 made that path findable. `PropertyKeyCutoverPanel` lists each staged `file-candidate` with live status and an SPA deep-link from `formatPropertyKeyCutoverWorkbenchHref` (`configSet` + `file` + `node` + `sourceMode=candidate` + `candidate` + `inspector=file`) via `handleSpaLinkClick`. The workbench still owns activate (`POST /api/v1/projects/:projectId/parameter-file-candidates/:candidateId/activate`, impact ConfirmDialog, `configSetId`, fail-closed status). The panel resumes via `GET .../property-key-cutover` / `loadOpenRun`. Finalize stays disabled until a re-preview is all `already-new-key`. Inline 「修正属性键」 stays disabled while `referenceCount > 0`.

The tracker already framed the leftover as same-page activate (out of ADR-0034 scope) **or** accepting the cross-page loop as the product. After inspecting the panel and the existing activate seam, there is no product gap that blocks completing the job. Mock `FORBIDDEN` on start / prepare / finalize is a demo leftover, not a reason to change the architecture.

## Rejected alternative

**Option 2 — human-in-editor merge, no auto-activate.** Keep the existing activate API and workbench invariants. From the spec-editor panel, the operator would explicitly confirm activate of a staged `file-candidate` without hunting, still a human click, still no job-written live source, catalog still only on finalize after live source is already-new-key. Rejected because #555 already removed the hunt; remaining pain is leaving `ParameterSpecDetailDialog` and coming back. That is convenience, not a missing machine. Session 0 may reverse this if a later product review shows operators cannot finish merge + finalize on the existing path (lost context that `loadOpenRun` cannot restore). Reversal would be one optional UX slice on the existing activate seam — not a new cutover job.

## Refused (do not implement)

- Auto-activate or auto-merge live source from prepare, finalize, or the panel.
- Enabling inline 「修正属性键」 while `referenceCount > 0`.
- Parameter-value change requests for a property **name**.
- Catalog-only alias, deprecate+recreate, or folding this into version cutover.
- New ADR. ADR-0034 stays locked.

Leftovers that are **not** this plan: mock start / prepare / finalize still `FORBIDDEN`; `.dts` only. They do not block this closeout.

## What session 0 records after accept

Session 0, not this branch:

1. Close TD-117 in both tracker twins as **accepted residual**: the everyday loop is editor → workbench activate → return → re-preview → finalize; same-page activate was declined.
2. Update `docs/PLANS.md` and `docs/zh-CN/PLANS.md` so this remainder owns the leftover, then archive both the 2026-08-18 parent and this file to `completed/` (same filename must not remain in `active/`).
3. Do not reopen ADR-0017 or ADR-0034. Do not enable inline rename.

## Non-goals

- Any product, API, or schema change.
- Same-page activate (option 2) unless session 0 reverses the lock above.
- Editing `docs/PLANS.md`, either tracker twin, `.github/workflows/ci.yml`, or ADR-0034 on this branch.
- Mock cutover writes, non-`.dts` files, new acceptance IDs.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Isolated worktree from latest `origin/main`; commit on `feat/td-117-remainder-plan`; `git push -u origin HEAD`; do not open a PR; do not merge |
| Parent / session owner | Review, open the GitHub PR, merge only after review, then sync local `main`. Session 0 updates the PLANS index and tracker after accept. |

One plan → one branch. Do not push `main`, do not `--no-verify`, do not amend published history.

## Batches

### Batch 0 — Decision record (this PR)

1. Add this plan EN+ZH with the locked option, rejected alternative, Impact Matrix, Update Gate, and verification.
2. Add one remainder sentence on the parent EN+ZH headers. Do not rewrite the parent.
3. Do not list this plan from `docs/PLANS.md` in this PR (session 0).

### Batch 1 — Session 0 closeout (not this branch)

Tracker close, PLANS index, archive parent + this remainder.

## Success criteria

- The remainder decision is option 1, with option 2 written so it can be reversed.
- Parent headers point here; parent architecture text is otherwise unchanged.
- TD-117 stays **Open** on this branch.
- `npm run docs:check` is green.
- No product files change.

## Risk

Closing the tracker as residual must not be read as a license to enable inline rename or to auto-activate. If operators later cannot finish on the existing path, reverse to option 2 — still a human click on the existing activate API.

## Verification

```bash
npm run docs:check
```

No app build. No new tests. No browser acceptance and no playwright-cli — this slice is docs-only.

## UI Interaction Automation Review

No user-facing interaction change. No new acceptance requirement ID or operation ID. Existing panel and workbench activate coverage stay as shipped in #553 / #555.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | No change | `AGENTS.md`, `ARCHITECTURE.md` — no runtime-mode or map change. |
| Planning | Update | This plan + ZH twin. One status sentence on the 2026-08-18 parent EN+ZH headers. **`docs/PLANS.md` / `docs/zh-CN/PLANS.md` left to session 0.** Tracker twins not edited. |
| Product specs | Review | `docs/product-specs/product-spec.md` (+ ZH) — inline identity correction remains zero-ref. Unchanged. |
| Domain / glossary | Review | `CONTEXT.md`, `docs/design-docs/domain-model.md` (+ ZH) — inline rename still only while `referenceCount = 0`. Unchanged. |
| Design docs / ADR | Review | [ADR-0034](../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md) Locked text unchanged. No Chinese ADR twin. |
| API | No change | Preview / start / prepare / GET / finalize already documented. No new route. |
| Frontend / design system | Review | `docs/FRONTEND.md` (+ ZH) already describe the cross-page handoff and SPA links. No UI change this slice. |
| Security | No change | No new write path or secret. |
| Reliability / runbooks | No change | No target-environment or ops procedure. |
| Developer env | No change | No new env keys. |
| Quality / acceptance | Review | No new interaction. Browser-acceptance map unchanged. |
| Generated artifacts | No change | No OpenAPI or schema change. |
| References | Review | Productization API draft is not the live contract. Unchanged. |
| Tech debt | No change | TD-117 stays **Open** on this branch. Session 0 closes it after accept. |

## Documentation Update Gate

A batch cannot be called complete until:

1. Every Impact Matrix `Update` / `Review` row for that batch is updated or recorded unchanged with evidence.
2. EN+ZH tracker rows are **not** silently closed on this branch. Session 0 closes TD-117 only after this plan is accepted.
3. `npm run docs:check` is green. PLANS index listing is session 0's duty; missing index is expected on this branch.
4. UI-interaction coverage is reviewed (this slice: no new interaction).
5. Moving this plan to `completed/` does not leave the same filename in `active/` (EN or ZH). Archive the 2026-08-18 parent in the same session-0 pass.

Deferred work stays in `tech-debt-tracker.md` until session 0 records the close; do not delete that row from this branch.
