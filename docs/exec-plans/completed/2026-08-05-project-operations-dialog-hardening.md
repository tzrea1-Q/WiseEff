# Project operations surface hardening

> Status: **Completed 2026-08-05** — all five batches delivered on `feat/project-operations-dialog-hardening`; **POD-D1 settled as Option A (return to full-page routes)**; residual scope re-filed as TD-056 – TD-059
> Date: 2026-08-05
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-05-project-operations-dialog-hardening.md`](../../zh-CN/exec-plans/completed/2026-08-05-project-operations-dialog-hardening.md)
> Information architecture: [ADR-0001](../../adr/0001-parameter-admin-organized-by-governance-scope.md) — **reaffirmed, not amended; see POD-D1**
> Shares modal faults with: [`2026-08-03-parameter-spec-editor-fidelity.md`](./2026-08-03-parameter-spec-editor-fidelity.md) (SE-17 – SE-21, SE-R5, SE-R6)
> Preceded by: [`2026-08-02-parameter-admin-ux-polish.md`](./2026-08-02-parameter-admin-ux-polish.md) (Batches 1–3 merged as `59f8d23c`)

## Context

`3b18433e` ("Fix project admin table scroll and open file ops in a modal.", PR #224, merged into `main`) moved the four project-scoped views — 参数文件 / 配置集 / 基线 / 结构浏览 / 冲突裁决 — out of the page body and into a new `ProjectOperationsDialog` modal. The commit added the modal container but did not carry over a modal contract: no focus management, no background inertness, no unsaved-change guard, and no layout budget for content that previously had a full page.

A 2026-08-05 review walked all four tabs in a real browser at 1440×900 / 768×1024 / 390×844 in mock mode, with runtime measurement of focus order, stacking, scroll containers, and overflow. Console was clean (0 errors, 0 warnings). Evidence: `work/ui-checks/01-13-*.png`, `tablet-*.png`, `mobile-*.png`.

Three things make this more than a polish backlog:

1. **The modal contradicts ADR-0001.** The ADR states project-scoped work is "addressable by route rather than nested inside a modal", and lists deep-linkability as the reason. PR #224 preserved deep-linking (the URL still changes and reload still works) but reverted the presentation. The ADR text and the code now disagree, and most layout findings below are direct consequences of fitting a four-tab workspace into a `min(980px, 100vw-48px)` × `min(88vh, 920px)` box.
2. **The framework faults are shared, not local.** `2026-08-03-parameter-spec-editor-fidelity.md` already records the same faults for `ParameterSpecDetailDialog` (SE-17 stacking below the Xiaoze FAB, SE-18 scroll boundary, SE-19 no focus trap, SE-20 `aria-modal` on the backdrop, SE-21 Escape closing the wrong dialog). Fixing them twice would leave two divergent modal implementations. This plan owns the shared primitive; see POD-D4.
3. **One component has no styling at all.** Every `structured-value-*` class emitted by `StructuredValueEditor` is absent from `src/styles.css` and from every other stylesheet, so the structured attribute editor — the highest-risk write path in the dialog — renders as unstyled HTML.

## Goal

1. **Batch 1 (framework)** — one shared modal primitive with correct focus, inertness, stacking, Escape, and dismissal semantics, for the dialogs that remain after Batch 2 (project edit, project delete, and the Batch 4 confirmations) and for `2026-08-03-parameter-spec-editor-fidelity.md` to consume.
2. **Batch 2 (retire the modal)** — return the four views to full-page routes per POD-D1 Option A, preserving PR #224's project-list horizontal-scroll fix and the existing deep links.
3. **Batch 3 (structured editor)** — style `StructuredValueEditor` and make the structure browser usable at all three viewports.
4. **Batch 4 (governance safety)** — confirmations and enforcement for irreversible operations; no silent no-ops; no silent data loss.
5. **Batch 5 (data & copy honesty)** — remove teaching/mock affordances and raw internals from user-facing surfaces; make the two DTS tabs agree.

## Non-goals

- Reopening the organization-vs-project peer structure of ADR-0001. POD-D1 reaffirms its modal-versus-route clause rather than changing it.
- The parameter definition editor's write-contract work (`2026-08-03-parameter-spec-editor-fidelity.md` owns SE-1 – SE-16 and SE-22 – SE-23).
- Baseline/config-set backend semantics. This plan changes presentation, confirmation, and enforcement of the existing API, not the API contract.
- Parameter-governance deferred D1–D8 and attribution deferred D-AG-*.
- TD-042 topology cutover rehearsal.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/project-operations-dialog-hardening`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `feat/project-operations-dialog-hardening`, from latest `main`. Batches 3–5 may be resequenced onto follow-up branches from `main` after Batch 1 and 2 merge. Batch 1 must merge before `2026-08-03-parameter-spec-editor-fidelity.md` items 19–21 are implemented, or those items must be dropped in favour of adopting the primitive.

## Open decisions

### POD-D1 — Is this surface a modal or a route? — **settled 2026-08-05: Option A, return to full-page routes**

ADR-0001 chose routes; PR #224 shipped a modal that keeps the URL. The four tabs hold a file manager, a config-set/baseline governance console, a two-pane structure browser with an editor, and a conflict arbitration queue. Measured consequences of the 980 × 88vh box: dialog top edge moves between 62px, 126px and 240px depending on tab; the node tree is confined to a hardcoded 360px scroller inside an already-scrolling body; at 390px wide the tree rows overflow the dialog by 26px and are clipped.

Options considered:

| Option | Consequence |
| --- | --- |
| **A. Return to full-page routes** — **chosen** | Restores the ADR-0001 decision. POD-L1, POD-L4, POD-L6, POD-L7, POD-F6 and POD-F7 dissolve for this surface rather than needing per-item fixes. Requires preserving whatever PR #224 fixed (project-list horizontal scroll). |
| B. Keep the modal, give it a real budget | Fixed height, sticky header/tab strip, single scroll region, full-screen sheet ≤768px. Every layout item must be fixed individually and re-verified at three viewports, and ADR-0001 would have to be amended. |
| C. Split — list-adjacent quick actions in a modal, structure browser and baseline console on routes | Matches the weight of each tab, but introduces two navigation models for one project context and needs its own IA note. |

**Reasoning.** The four views are a workspace, not a confirmation. Three of them (baseline console, structure browser plus editor, conflict queue) are destinations a user stays in and returns to, which is exactly what ADR-0001 meant by addressable by route. Option B would have spent Batch 2 re-deriving a page's worth of layout budget inside a box, and would still leave the tab strip, the node tree height, and the mobile treatment as permanent constraints rather than solved problems. Option A also removes the reason POD-F6's Xiaoze-FAB collision and POD-F7's scroll boundary exist on this surface at all.

**Consequences for this plan.**

- Batch 2 becomes *retire the modal*, not *fix the modal*. `ProjectOperationsDialog` is deleted rather than hardened.
- POD-L1, POD-L4, POD-L6, POD-L7, POD-F6 (for this surface) and POD-F7 are resolved by removal. POD-L6's hardcoded `max-height: 360px` and POD-L7's mobile overflow must still be verified on the page, because a fixed 360px scroller is wrong on a route too — they move to Batch 3 rather than disappearing.
- Batch 1 is still required, but its adoption target changes: the primitive serves the dialogs that legitimately remain (project edit, project delete, the Batch 4 confirmations) and the spec editor. POD-F1 – POD-F5 stop being about this surface and become the contract those dialogs must meet.
- ADR-0001 is **reaffirmed**, not amended. The doc row for it becomes "record that the code returned to the ADR" instead of "amend the clause".
- POD-R3 is now load-bearing: PR #224's horizontal-scroll fix must survive the revert.
- Deep links must keep working exactly as they do today; the URL contract is the one thing PR #224 got right and it is not in scope to change.

Batches 1, 3, 4 and 5 were scoped to be independent of this decision and remain so.

### POD-D2 — Tab semantics — **resolved by POD-D1**

`PA-D4` (merged) deliberately settled on `role="navigation"` + buttons + `aria-current="page"` so the project views match the organization sub-nav, rather than `role="tablist"`. That choice was only questionable because the views had been put inside a dialog. Back on routes, `aria-current="page"` is the correct semantic and PA-D4 stands unchanged — no third re-litigation. The remaining gap is keyboard traversal: add left/right arrow-key movement across the view links. Nothing else to decide.

### POD-D3 — Unsaved-change policy

Measured: typing 配置集名称 then switching views and back discards the value; the structure browser's `drafts`, filter, selected node, and search results reset on every switch; Escape and backdrop click close with pending `drafts` and no prompt. Under POD-D1 the dismissal paths change — Escape and backdrop click disappear, and "leaving" becomes navigating away from the project — but the unmount-on-view-switch loss does not, because each view is still mounted per route.

Recommendation, unchanged in substance: make per-view state survive view switches (lift it above the view boundary or keep panels mounted), and prompt only when leaving the project with unsubmitted `drafts`. Prompting on every view switch would be the wrong trade for a surface whose whole point is moving between the four views.

### POD-D4 — Who owns the shared modal primitive

Recommendation: this plan builds it, `2026-08-03-parameter-spec-editor-fidelity.md` consumes it. That plan's items 19–21 (stacking, scroll boundary, focus trap) then become "adopt the primitive" instead of three independent fixes, and SE-R5's warning about adding "a fourth ad-hoc number" to the z-index scale is satisfied by construction. Requires a note in that plan when this one merges.

## Findings

### Batch 1 — framework (shared modal contract)

| ID | Finding | Location |
| --- | --- | --- |
| POD-F1 | **Focus never enters the dialog and never returns.** After opening, `document.activeElement` is still the 管理文件 trigger; on deep-link load it is the sidebar logo. No initial focus, no trap, no restore on close. | `src/components/admin/ProjectOperationsDialog.tsx:43-60` |
| POD-F2 | **`role="dialog" aria-modal="true"` sits on the full-screen backdrop, not the dialog card.** `aria-labelledby` points at a hardcoded `project-operations-dialog-title`, and the subtitle is not referenced by `aria-describedby`. | `ProjectOperationsDialog.tsx:66-81` |
| POD-F3 | **Background is neither `inert` nor `aria-hidden`, so `aria-modal` is a claim the DOM does not honour.** Measured 43 focusable elements with only 11 inside the dialog; Tab reaches the sidebar, top bar, and the table rows behind the backdrop. Reproduced: tabbing to a background 编辑 button opens a second modal at the same `z-index: 1000`, and the two backdrops double-dim each other. | `ProjectOperationsDialog.tsx`; `src/styles.css:9426-9435` |
| POD-F4 | **Escape closes the bottom-most dialog.** With the operations dialog and 编辑项目详情 both open, one Escape closed the operations dialog and navigated to the project list, leaving the edit dialog orphaned over it. The listener is an unconditional `window` keydown with no top-most check. | `ProjectOperationsDialog.tsx:48-55`; same fault as SE-21 |
| POD-F5 | **Backdrop dismissal fires on pointer-up alone.** `onClick={onClose}` on the backdrop means pressing inside the dialog and releasing outside it — an ordinary text selection of a node path — closes the dialog and navigates away. Reproduced with mousedown at (700,400) and mouseup at (1350,400). | `ProjectOperationsDialog.tsx:71` |
| POD-F6 | **Stacking scale is wrong in three ways.** (a) `.xiaoze-chat-toggle-anchor` is `z-index: 1100` against the backdrop's `1000`, so the Xiaoze FAB and its tooltip render over the dialog's bottom-right corner. (b) `.param-admin-shell > .modal-backdrop` (`z-index: 120`, `backdrop-filter: blur(6px)`) never matches this dialog, because the backdrop is a child of `section.param-admin-main`; measured `backdropFilter: "none"`, `zIndex: "1000"`, so it looks unlike sibling param-admin dialogs. (c) That rule block is duplicated verbatim at `styles.css:12350-12359` and `12361-12370`. | `src/styles.css:9426, 12350, 12361, 12732-12736`; same fault as SE-17 / SE-R5 |
| POD-F7 | **The scroll region has no boundary affordance.** Content is cut mid-row at both the tab strip and the dialog's bottom edge with no separator, shadow, or fade. | `.project-parameter-files-dialog-body` at `src/styles.css:14977-14980`; same fault as SE-18 |

### Batch 2 — shell & layout (scope depends on POD-D1)

| ID | Finding | Location |
| --- | --- | --- |
| POD-L1 | **The dialog collapses to content height, so the tab strip jumps.** Measured top edge at 1440×900: 结构浏览 62px, 参数文件 126px, 配置集 240px — the shared navigation moves over 170px when switching between views that are supposed to be peers. | `.project-parameter-files-dialog` at `src/styles.css:14921-14927` |
| POD-L2 | **The governance audit hint is injected between the title and the tab strip**, pushing the whole surface down when any audit event fires. It has no timestamp, cannot be dismissed, and persists indefinitely. | `ProjectsOperationsPanel.tsx:403-410`; `.project-parameter-files-dialog-audit` at `styles.css:14929-14931` |
| POD-L3 | **Title repetition returned after PA-A1 fixed it.** The surface now shows 项目运营 as the dialog eyebrow, as the scope pill, and as the top-bar subtitle, then repeats the view name as both `<h2>` and the panel's own heading. `ParameterFileConflictPanel` uses `<h2>` — the same level as the dialog title, and visibly larger than the `<h3>` the other three tabs use. | `ProjectOperationsDialog.tsx:77-91`; `ParameterFileConflictPanel.tsx:120`; `ProjectParameterFilesPanel.tsx:191` |
| POD-L4 | **Mobile is a cramped floating card, not a sheet.** At 390×844 the eyebrow, wrapped title, three-line subtitle and two rows of tabs consume roughly 250px before any content. The close button is 32×32 and other actions are 34px tall, below the 44px touch target this product uses elsewhere. | `styles.css:14921-14927`; `.audit-dialog-close-icon` |
| POD-L5 | **The tab strip is two designs at once.** Base `.project-parameter-files-tab` is an underline tab (`border-radius: 8px 8px 0 0`, `margin-bottom: -1px`) while `.param-admin-main .project-parameter-files-tab` overrides it into a pill and zeroes the container's `border-bottom`, so the strip floats with no boundary. | `src/styles.css:14933-14975` |
| POD-L6 | **The node tree is locked to a hardcoded `max-height: 360px`** inside an already-scrolling dialog body, producing nested scroll and a final row (`demo_regulator`) cut through the glyphs. The dialog had 775px of height available. | `.dts-node-tree-view__list` at `src/styles.css:15120-15128`; `DtsStructureBrowserPanel.tsx:245-254` |
| POD-L7 | **Mobile structure rows overflow the dialog and are clipped.** At 390px the dialog's right edge is x=366 while every `.dts-node-tree-view__item` extends to x=392; `overflow: hidden` removes the difference. The list also carries its own horizontal scroll (`scrollWidth 308` vs `clientWidth 222`), so one region has three scroll axes. | `DtsNodeTreeView` styles |
| POD-L8 | **The 参数文件 tab ends with a separator followed by dead space**, because `.dts-search-panel` carries `border-bottom` plus `padding-bottom: 16px` while being the last element in the tab. The rule is written for a panel that has something after it. | `src/styles.css:14982-14988` |

### Batch 3 — structured editor

| ID | Finding | Location |
| --- | --- | --- |
| POD-E1 | **`StructuredValueEditor` has no CSS anywhere in the repository.** `structured-value-editor`, `structured-value-string-row`, `structured-value-cell`, `structured-value-bytes`, `structured-value-phandle-list`, `structured-value-bool`, `structured-value-mixed`, `structured-value-normalized-preview`, `structured-value-empty-note` — none are defined. Text inputs have no border, 移除 / 添加字符串 render as bare text, and the normalized preview is loose body text. | `src/components/parameters/StructuredValueEditor.tsx:75-461`; absent from `src/styles.css` |
| POD-E2 | **提交变更请求 is a non-primary button at the bottom of the nested scroll region**, below the diff, with the pending count as plain prose. On the highest-risk action in the dialog there is no persistent action bar. | `DtsStructureBrowserPanel.tsx:331-347` |
| POD-E3 | **Permission failures expose internal slugs.** 「需要 parameter:edit 权限」 and 「需要 parameter:edit-critical 权限」 are shown to end users, and the editor still renders below the error in a disabled state rather than explaining the state once. | `DtsStructureBrowserPanel.tsx:303-312` |
| POD-E4 | **The safety-critical node warning is under-weighted.** 「安全关键节点（regulator / thermal）」 is grey `role="note"` prose on a path that writes regulator and thermal values. | `DtsStructureBrowserPanel.tsx:262-266` |

### Batch 4 — governance safety

| ID | Finding | Location |
| --- | --- | --- |
| POD-G1 | **No irreversible operation has a confirmation step.** 发布基线, 回滚基线 (which restores N parameters), 移除成员, and both conflict arbitration buttons execute straight from `onClick`. `DeleteProjectDialog` is the established confirmation pattern in this same file and is not used. | `ConfigSetBaselinePanel.tsx:477-552`; `ParameterFileConflictPanel.tsx:160-185` |
| POD-G2 | **`requiresConfirmation` from the revision gate is printed, never enforced.** No branch consumes it to block or gate an operation. | `ConfigSetBaselinePanel.tsx:568-577` |
| POD-G3 | **The gate result is raw debug output, rendered below the fold.** It emits `mode: warn` / `requiresConfirmation: false` / `ok: true` as three untranslated camelCase lines, and it renders at the bottom of the scroll region, so clicking 校验修订 produces no visible feedback without scrolling. | `ConfigSetBaselinePanel.tsx:568-577` |
| POD-G4 | **No action has a pending or disabled state**, so 创建配置集 / 添加成员 / 创建基线 / 发布 can be double-submitted. `loading` only swaps a text line. | `ConfigSetBaselinePanel.tsx:387, 408-415` |
| POD-G5 | **Submitting an empty 配置集名称 is a silent no-op** — no validation message, no disabled button, no feedback of any kind. | `ConfigSetBaselinePanel.tsx:398-416` |
| POD-G6 | **Conflict arbitration recommends a side and withholds the evidence.** 保留界面值 is `button primary` while 保留文件值 is `button subtle`, although both discard data irreversibly. There is no author, timestamp, or source version; no diff emphasis; no reason field even though the audit model carries `reason`; and no count or bulk action for multi-conflict queues. | `ParameterFileConflictPanel.tsx:160-185`; `parameterAdminState.ts` audit hint shape |
| POD-G7 | **Unsaved work is discarded silently on three paths** — tab switch (unmount), Escape, and backdrop dismissal — including the structure browser's pending `drafts`. See POD-D3. | `ProjectsOperationsPanel.tsx:412-461`; `ProjectOperationsDialog.tsx:48-71` |

### Batch 5 — data & copy honesty

| ID | Finding | Location |
| --- | --- | --- |
| POD-C1 | **Teaching fixtures are exposed as product affordances.** A 加载教学结构 button hardcodes `DTS_TEACHING_FILE_ID` / `DTS_TEACHING_VERSION_ID`; the empty state reads 「可点击「加载教学结构」拉取 **mock** 教学样例（上次：`file-teaching-dts` / `version-teaching-1`）」; and `revisionId` falls back to `"revision-teaching-1"`, which then appears in the audit hint as 「已校验修订 revision-teaching-1（passed）」. | `DtsStructureBrowserPanel.tsx:20-21, 222-243`; `ProjectsOperationsPanel.tsx:426`; `ConfigSetBaselinePanel.tsx:82` |
| POD-C2 | **The two DTS tabs contradict each other by construction.** `mockDtsStructuredRepository.getStructure` ignores `projectId` "for teaching convenience" and returns the fixture for any project, while `search` returns `{ hits: [] }` unless `requestedProjectId === projectId`. 结构浏览 lists `amba/i2c@XXXX0000/chip@6E` while searching `chip` in the same dialog reports 无命中结果. Mock mode is the demo path, so this is demo-visible. | `src/infrastructure/mock/mockDtsStructuredRepository.ts:262-280` |
| POD-C3 | **Search hits are dead buttons.** `DtsSearchPanel` is mounted without `onSelectHit`, so every result is a focusable button that does nothing, on a panel whose copy promises 定位节点. It should select the node in 结构浏览. | `ProjectsOperationsPanel.tsx:416`; `DtsSearchPanel.tsx:103-115` |
| POD-C4 | **Raw enum values reach the UI.** 成员角色 options are `base` / `overlay` / `charging` / `thermal` / `misc`; baseline status renders as `draft` / `released`. | `ConfigSetBaselinePanel.tsx:456-468, 518-519` |
| POD-C5 | **Implementation notes are shipped as product copy.** All three tab subtitles carry 「页面可通过 URL 深链与刷新保持」; the structure browser says 「回写载荷使用 rawText」 and 「本地预览规范化值」. | `ProjectsOperationsPanel.tsx:77-103`; `DtsStructureBrowserPanel.tsx:220, 322-324` |
| POD-C6 | **Version history is too thin to govern with.** An expanded version reads 「版本 1 · upload · 64 bytes」 — no timestamp, no author, no per-version download, no rollback-to-version. | `ProjectParameterFilesPanel.tsx` version list |
| POD-C7 | **A nonexistent project id opens a working dialog.** `/parameter-admin/projects/does-not-exist-999/files` renders 「参数文件 · does-not-exist-999」 with the raw id as the project name and a populated file list. No not-found state, no redirect. | `ProjectsOperationsPanel.tsx:332` (`projectName` fallback chain) |
| POD-C8 | **Config-set empty states are missing**, so the 配置集 / 基线 tab looks broken on first open: 配置集列表, 配置集成员 and 基线列表 all render as empty `<ul>`s with no message and no next action. PA-V2 established the pattern for identity-mapping, spec-review and conflicts but did not cover these three. | `ConfigSetBaselinePanel.tsx:418-432, 477-494, 515-552` |

## Delivery batches

### Batch 1 — framework

Under POD-D1 this batch no longer serves `ProjectOperationsDialog` (Batch 2 deletes it). It defines the contract for the dialogs that legitimately remain — project edit, project delete, and the Batch 4 confirmations — and for `2026-08-03-parameter-spec-editor-fidelity.md` to consume.

1. [x] Extract a shared dialog primitive (component plus hook) that owns: `role="dialog"` + `aria-modal` on the card, generated `aria-labelledby` / `aria-describedby` ids, initial focus, focus trap, focus restore to the trigger, background `inert`, top-most-only Escape, and paired pointer-down/pointer-up backdrop dismissal (POD-F1, F2, F3, F4, F5).
2. [x] Replace the ad-hoc z-index numbers with one declared scale that puts param-admin dialogs above `.xiaoze-chat-toggle-anchor` (1100) and below `.xiaoze-popup-layer` (1200); fix the `.param-admin-shell > .modal-backdrop` descendant selector and delete the duplicated block at `styles.css:12361-12370` (POD-F6, SE-R5).
3. [x] Adopt the primitive in `ProjectAdminFormDialog` and `DeleteProjectDialog`, which are the two dialogs on this surface that survive Batch 2.
4. [x] Tests: focus enters on open and returns to the trigger on close; Tab cannot leave the dialog; Escape closes only the top-most dialog; press-inside/release-outside does not dismiss. The stacked-dialog case from POD-F4 is the regression test.
5. [x] Record in `2026-08-03-parameter-spec-editor-fidelity.md` that its items 19–23 become "adopt the primitive" (POD-D4) — done 2026-08-05.

### Batch 2 — retire the modal (POD-D1 Option A)

6. [x] Return the four views to full-page routes and delete `ProjectOperationsDialog`, keeping every existing deep link working unchanged. POD-L1, POD-L4, POD-F6 and POD-F7 are resolved by this step rather than fixed individually.
7. [x] Preserve PR #224's project-list horizontal-scroll fix; read `3b18433e` first and confirm the fix is independent of the modal (POD-R3).
8. [x] Move the audit hint out of the title/navigation flow; add a timestamp and a dismiss affordance (POD-L2).
9. [x] Restore PA-A1: one authoritative title per view, and one heading level for all four panels (POD-L3).
10. [x] Resolve the view navigation into one design language, and add left/right arrow-key traversal per POD-D2 (POD-L5).
11. [x] Scope `.dts-search-panel`'s trailing `border-bottom` so the last element in a view has no dangling separator (POD-L8).
12. [x] Re-verify all four views at 1440×900 / 768×1024 / 390×844, including that the shared navigation no longer moves between views.

### Batch 3 — structured editor and structure browser

13. [x] Write the `structured-value-*` styles for every value type the editor emits: string-list, u32 matrix, bytes, phandle-list, bool, mixed, plus the normalized preview and empty note (POD-E1).
14. [x] Give 提交变更请求 primary emphasis in a persistent action position with the pending count as a real counter (POD-E2).
15. [x] Replace permission slugs with product language and render one authoritative state instead of an error above a disabled editor (POD-E3).
16. [x] Raise the safety-critical node treatment to match the risk of the write (POD-E4).
17. [x] Replace the node tree's hardcoded `max-height: 360px` with a height that follows the page, and remove the nested scroll container. A fixed 360px scroller is wrong on a route too, so POD-L6 moves here rather than dissolving with the modal.
18. [x] Verify the mobile node rows no longer overflow their container and that one region has one scroll axis (POD-L7).
19. [x] Component tests per value type, including the disabled and critical-locked states.

### Batch 4 — governance safety

20. [x] Add confirmation to 发布基线, 回滚基线, 移除成员 and both arbitration actions, built on the Batch 1 primitive and following the `DeleteProjectDialog` pattern; state the blast radius in each (POD-G1).
21. [x] Make `requiresConfirmation` block the operation it describes (POD-G2).
22. [x] Render the gate result as product language with a real severity treatment, and surface it where the user clicked (POD-G3).
23. [x] Add pending/disabled states to every mutating action (POD-G4).
24. [x] Validate 配置集名称 and 基线名称 with a visible message; no silent no-ops (POD-G5).
25. [x] Rebuild conflict arbitration: symmetric emphasis, provenance (author, time, source version), diff emphasis, optional reason captured into the audit hint, count and bulk handling (POD-G6).
26. [x] Implement POD-D3: per-view state survives view switches; confirm when leaving the project with unsubmitted drafts (POD-G7).

### Batch 5 — data & copy honesty

27. [x] Remove 加载教学结构 and the teaching ids from the product surface; replace the empty state with one that names a real next action; remove the `"revision-teaching-1"` fallback so no teaching id can reach an audit record (POD-C1).
28. [x] Make `getStructure` and `search` agree on project scoping in the mock repository, and add a parity test that browse and search see the same nodes (POD-C2).
29. [x] Wire `onSelectHit` so a search hit selects that node in 结构浏览 (POD-C3).
30. [x] Add display labels for member roles and baseline statuses (POD-C4).
31. [x] Rewrite the subtitles and editor notes as product copy. Under POD-D1 the 「页面可通过 URL 深链与刷新保持」 line should simply be deleted — it described an implementation property that is now the plain behavior of a route (POD-C5).
32. [x] Extend version history with timestamp, author, per-version download, and rollback-to-version, or file the gap as debt if the API cannot supply it (POD-C6).
33. [x] Add a not-found state for unknown project ids instead of titling the page with the raw id (POD-C7).
34. [x] Apply the PA-V2 empty-state pattern to 配置集列表, 配置集成员 and 基线列表 (POD-C8).

## Key seams (starting points)

- Dialog container and its keydown/dismiss logic: `src/components/admin/ProjectOperationsDialog.tsx`.
- Tab wiring, view metadata, audit hint, panel mounting: `src/components/parameter-admin-next/ProjectsOperationsPanel.tsx`.
- Modal/backdrop/z-index rules: `src/styles.css:9426-9435`, `12350-12370`, `12732-12736`, `14921-14980`.
- Structured editing: `src/components/parameters/StructuredValueEditor.tsx`, `DtsStructureBrowserPanel.tsx`, `DtsNodeTreeView`.
- Config sets and baselines: `src/components/admin/ConfigSetBaselinePanel.tsx`.
- Conflicts: `src/components/admin/ParameterFileConflictPanel.tsx`.
- Mock parity: `src/infrastructure/mock/mockDtsStructuredRepository.ts`.
- Existing confirmation pattern to reuse: `src/components/admin/DeleteProjectDialog.tsx`.

## Risks

| ID | Risk | Handling |
| --- | --- | --- |
| POD-R1 | Raising the param-admin dialog above the Xiaoze FAB must not put it above the Xiaoze popup (1200) or the two sibling backdrops that already claim 1300/1400. | Declare the full scale once as tokens and assert the order in a test, rather than adding a fifth ad-hoc number (mirrors SE-R5). |
| POD-R2 | Background `inert` has partial older-browser support and can break existing tests that query background nodes while a dialog is open. | Pair `inert` with an `aria-hidden` fallback and audit the affected tests in the same batch. |
| POD-R3 | **Now load-bearing under POD-D1 Option A.** Reverting PR #224's presentation must not regress what it fixed, and must not break the deep links it introduced. | Read `3b18433e` before starting Batch 2 and confirm the project-list horizontal-scroll fix is independent of the modal; keep every existing `/parameter-admin/projects/:id/:view` URL working, with a route test per view. |
| POD-R4 | Batch 1 changes a primitive used by other dialogs once adopted. | Adopt only in `ProjectAdminFormDialog`, `DeleteProjectDialog` and the Batch 4 confirmations in this plan; migrate other dialogs through their own plans. |
| POD-R5 | Fixing POD-C2 in the mock may expose that API mode has the same or the opposite scoping asymmetry. | Verify both runtimes; if API mode disagrees, file it rather than making mock match a broken API. |
| POD-R6 | Batches 4 and 5 change audit hint text and payloads that tests and docs may assert on. | Grep audit summary strings before editing; update `docs/references/*` quotes in the same change. |

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` — confirm the routing description matches the post-Batch-2 shape |
| Planning | Update | this plan; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; the ZH companion plan; a cross-reference note in `2026-08-03-parameter-spec-editor-fidelity.md` |
| Architecture / ADR | Update | `docs/adr/0001-parameter-admin-organized-by-governance-scope.md` — record that PR #224 departed from the modal-versus-route clause and that Batch 2 returns to it, so the next reader does not repeat the round trip |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` — the presentation change from Batch 2 plus copy and confirmation-step changes from Batches 4–5 |
| Frontend / design | Update | `docs/FRONTEND.md` (+ ZH) for the shared dialog primitive, the z-index scale, the project view routing shape, and the empty-state application; `docs/design-docs/full-stack-architecture.md` for the routing shape |
| Domain glossary | Review | `CONTEXT.md` — 配置集 / 基线 / 冲突裁决 wording if Batch 5 renames anything user-visible |
| Quality / testing | Update | `docs/developer/browser-acceptance-coverage-map.md` (+ ZH) and `docs/developer/user-operation-coverage-matrix.md` (+ ZH) for the new requirement IDs below |
| Security / governance | Update | `docs/SECURITY.md` — Batch 4 adds human confirmation to baseline release/rollback and conflict arbitration, which is an approval-model statement |
| Reliability / runbooks | No change | expected — no deployment or job behavior changes |
| Generated artifacts | No change | expected — no migrations, no API contract change |
| References | Review | `docs/references/*` if audit hint or gate-result copy is quoted there |

## Documentation Update Gate

Before moving this plan to `completed/`:

1. Every Impact Matrix `Update` / `Review` row is updated or recorded unchanged with evidence.
2. POD-D1 through POD-D4 are recorded with their reasoning — D1 and D2 settled 2026-08-05; D3 and D4 have recommendations and must be confirmed at implementation — and ADR-0001 agrees with the shipped code.
3. All five batches are delivered, or the remainder is re-filed in `exec-plans/tech-debt-tracker.md`.
4. Browser acceptance coverage for the new requirement IDs is registered with automation or supplemental evidence.
5. `npm run docs:check` is green.

## UI interaction coverage

Every batch changes user-facing interaction behavior, so the UI Interaction Automation Rule applies.

- Existing IDs: `PARAM-ADMIN-001` / `PARAM-ADMIN-002` cover import flows; `PARAM-ADMIN-003` covers the project list at mobile width. None cover the project operations surface, its four views, or dialog behavior.
- Add before implementation is claimed complete:
  - `PROJ-OPS-001` — every `/parameter-admin/projects/:id/:view` deep link resolves to its view on load and after reload, for all four views, and back/forward navigation between views works. This is the guard on POD-R3.
  - `PROJ-OPS-002` — all four views render without clipped content or horizontal overflow at 1440×900 / 768×1024 / 390×844, and the shared view navigation does not shift position between views.
  - `PROJ-OPS-003` — baseline release, baseline rollback, member removal and conflict arbitration each require an explicit confirmation and produce an audit record.
  - `PARAM-ADMIN-DIALOG-001` — for the dialogs that remain (project edit, project delete, Batch 4 confirmations): focus enters on open, Tab cannot leave, Escape closes only the top-most dialog, focus returns to the trigger on close, and press-inside/release-outside does not dismiss.
- Preserve operation evidence generation through `npm run acceptance:browser` or `npm run acceptance:evidence` for any automated operation IDs touched.

## Verification

```bash
npm test -- src/ParameterAdminNextPage.test.tsx src/ParameterAdminNextPage.a11y.test.tsx
npm test -- src/components/admin/ParameterFileConflictPanel.test.tsx
npm run test:server
npm run build
npm run docs:check
# Browser evidence under work/ui-checks/project-operations-dialog/batch{N}/
# at 1440x900, 768x1024, 390x844 for all four views, with console error checks
```

## Delivery record (2026-08-05)

All five batches shipped on `feat/project-operations-dialog-hardening`.

| Batch | Shipped as | Notes |
| --- | --- | --- |
| 1 — framework | `e571ac74` | `ModalDialog` + `ConfirmDialog` in `src/components/common/`; one z-index scale in `:root`; adopted in `ProjectAdminFormDialog` and `DeleteProjectDialog`. Because the primitive portals to `document.body`, param-admin dialog styling gained backdrop-scoped selectors and `ModalDialog.styles.test.ts` guards the pairing. |
| 2 — retire the modal | `c6744573` | `ProjectOperationsDialog` deleted; `ProjectOperationsView` renders the four views on their routes with arrow-key traversal, one authoritative title per view, `<h3>` panels, and a dismissible timestamped audit notice. PR #224's project-list scroll fix is untouched. |
| 3 — structured editor | `4b2e96c1` | Every `structured-value-*` class is styled; submit is primary with a real counter in a persistent action bar; permission and safety-critical states use product language; the node tree follows page height with a single scroll axis. |
| 4 — governance safety | `85cfda67` | Confirmations on release / rollback / member removal / both arbitration sides; `requiresConfirmation` blocks release behind an acknowledgement; gate results render as product language with severity; pending states and name validation on every mutating action; per-view state survives view switches and leaving with drafts prompts. |
| 5 — data & copy honesty | `b0511a32` | Teaching fixtures and the `revision-teaching-1` audit fallback removed; mock `getStructure` / `search` agree; search hits select their node; enum display labels; version history with time/author/size/download; not-found state for unknown project ids. |
| Follow-ups | this change | Portal styling regression fixed for all three dialogs; the audit notice exposes its kind as `data-audit-kind` instead of reading a raw slug to screen readers; the change-set list shows the node path instead of the provisional `pending:` key; mock display file name is no longer `teaching-sample.dts`. |

Verification run: targeted panel/page tests, `npm test` (356 files), `npm run build`, `npm run acceptance:operations`, `npm run docs:check`, plus playwright-cli evidence for all four views at 1440×900 / 768×1024 / 390×844 under `work/ui-checks/project-operations-dialog/final/` with 0 console errors and `documentElement.scrollWidth == clientWidth` at every viewport. `npm run test:server` fails on this machine with `relation "project_parameter_values" does not exist` on `main` as well — a local database template that predates the TD-042 cutover, not a regression from this change.

## Deferred / debt candidates

Filed in `exec-plans/tech-debt-tracker.md`:

- **TD-056** — rollback-to-version and resolving the version author to a display name (POD-C6 partially shipped: number, origin, time, operator id, size, per-version download).
- **TD-057** — a real configuration revision source for the config-set view, so the revision gate can be exercised where baselines are published.
- **TD-058** — bulk conflict arbitration and a human version label on conflict provenance (POD-G6 shipped single-conflict handling).
- **TD-059** — migrating the remaining dialogs onto the Batch 1 primitive, starting with `ParameterSpecDetailDialog`.
