# Merge Link Visibility After Software Merge — Design

> Date: 2026-07-24  
> Status: Design approved; awaiting implementation plan  
> Chinese: [`docs/zh-CN/superpowers/specs/2026-07-24-merge-link-visibility-design.md`](../../zh-CN/superpowers/specs/2026-07-24-merge-link-visibility-design.md)  
> Related: `ParameterReviewPage` / `VerticalTimeline` (`src/App.tsx`), `isValidMergeLink`, `ChangeRequest.reviewerNote`

## 1. Context

Software merge already requires an http(s) merge link in `note`. The server persists that value on the change request as `reviewerNote` (and in audit). The review detail UI only surfaces the link while status is still `软件User合入`, and only as plain text in the workflow timeline body. After merge, status becomes `已合入`; history detail has no dedicated place and no timeline body that shows the stored link.

Users cannot re-open or verify the merge URL from the parameter review workbench after confirmation.

## 2. Goals / Non-goals

### Goals

- When a change request is **已合入** and `reviewerNote` is a valid merge link, show that link in **two** places on the review detail aside:
  1. A dedicated **合入链接** card (same visual family as the rejection-reason card).
  2. The **软件User合入** step body in the workflow / 变更历史 `VerticalTimeline`, as a clickable external link.
- Links open in a new tab with `rel="noopener noreferrer"`.
- Frontend-only; reuse existing `reviewerNote` + `isValidMergeLink`.

### Non-goals

- Showing the link while status is still `软件User合入` (input field remains the only UI there).
- New API fields, audit APIs, or list-table columns.
- Copy-to-clipboard control.
- Changing merge validation or write paths.

## 3. Product rules

1. **Visibility gate:** `status === "已合入"` **and** `isValidMergeLink(reviewerNote)`.
2. If the gate fails, neither the card nor the timeline link block is rendered.
3. Card label: `合入链接`. Card body: one anchor whose `href` and visible text are `reviewerNote.trim()`.
4. Timeline: for the `软件User合入` workflow item when the gate passes, body includes assignee context plus the same clickable URL (not a bare string that users must copy manually).
5. Pending merge input (`#review-merge-link`) behavior is unchanged.

## 4. UI / components

Primary surface: `ParameterReviewPage` review-detail aside in `src/App.tsx`.

### 4.1 Dedicated card

- Place above the 「变更历史」 / workflow timeline block, parallel to `rejection-reason-card` when `rejectReason` is set.
- Prefer a small dedicated class (e.g. `merge-link-card`) or reuse rejection-card layout with a distinct section label; keep existing detail styling tokens.
- Anchor: `target="_blank"`, `rel="noopener noreferrer"`.

### 4.2 VerticalTimeline

- Extend `VerticalTimelineItem.body` from `string` to `ReactNode` (or `string | ReactNode`) so the merge step can render an `<a>`.
- Keep `formatWorkflowDisplayText` for string bodies; do not run string replace on React nodes.
- When gate passes, set the `软件User合入` item body to a short fragment: assignee line + link (Chinese copy consistent with existing timeline tone).

### 4.3 Remove stale pending-only link text

- Drop or narrow the existing branch that injects plain-text `合入链接：…` only while status is `软件User合入`, so pending and merged behaviors do not conflict.

## 5. Data

No schema or DTO changes. Source of truth remains `ChangeRequest.reviewerNote` already returned by mock/API list/detail paths used by the review page.

## 6. Testing

- Unit/component: after merge to `已合入` with a valid `reviewerNote` URL, review detail (history mode) shows the card link and timeline anchor with correct `href`.
- Negative: `已合入` without a valid merge link → neither surface.
- Pending `软件User合入` → input remains; no post-merge card.
- Existing merge-link-required test remains green.
- Browser check on `/parameter-review` → 历史审阅 → merged row: both surfaces, desktop/tablet/mobile snapshot/screenshot, console error clean.

## 7. Documentation

- One-line update in EN + ZH `prototype-functional-spec.md`: after software merge, the merge link is visible on the review detail card and workflow timeline.
- Run `npm run docs:check` before calling the work done.

## 8. Success criteria

- Merged request in 历史审阅: card + timeline both show a working external link to the stored merge URL.
- No backend changes required for the happy path.
- No regressions to merge-link input gating on `软件User合入`.
