# DTS Workbench View / Edit Dialog Split — Design

> Date: 2026-07-21  
> Status: Design approved; awaiting implementation plan  
> Chinese: [`docs/zh-CN/superpowers/specs/2026-07-21-dts-view-edit-dialog-split-design.md`](../../zh-CN/superpowers/specs/2026-07-21-dts-view-edit-dialog-split-design.md)  
> Related: mature workbench `ParameterDetailDialog` + `ParameterDraftDialog`; current `DtsBindingDetailDialog` + `DtsBindingDraftTray`

## 1. Context

After the DTS parameter-workbench redesign, table **View** and **Edit** both open the same `DtsBindingDetailDialog`, differing only by `focusEditorOnOpen`. That collapses two previously distinct jobs:

| Legacy action | Legacy surface | Job |
|---|---|---|
| View | `ParameterDetailDialog` | Read-only understanding; optional “add to draft” |
| Edit | `ParameterDraftDialog` | Author target value + reason; multi-card round drafts; submit into the modified/pending area |

The merged dialog also drifted in **content**: heavy internal IDs first, weak value/definition block, no true draft-card workflow. Width was separately fixed (`sm:max-w-5xl` + CSS); this design restores **content and interaction split**.

API mode still forbids `recommendedValue` / drift. Existing typed draft + `DtsBindingDraftTray` submission path stays the server truth after “加入本轮”.

## 2. Goals / Non-goals

### Goals

- Split View vs Edit into two dialogs again (Approach A).
- View content follows legacy **参数定义 / 历史 / 跨项目对比** skeleton, plus necessary DTS location context.
- Edit content follows legacy **修改草稿** multi-card skeleton, wired to current `onCreateDraft` → pending tray.
- Fold technical identity (UUIDs, spec IDs, topology node IDs) and provenance behind collapsed sections on View only.
- Keep dialogs wide enough for long DTS paths and values (`max-w-5xl` / existing CSS).

### Non-goals

- Restore mock-only `recommendedValue`, recommended draft seeding, or flat Excel export.
- Full legacy cross-project diff selector + “use other project value as draft” in this slice (keep list-level compare; enhance later).
- Change draft / submission HTTP contracts or review workflow.
- Rebuild mock `ParametersPage` draft→modified-table dual stage as a parallel product path.

## 3. Interaction

```
查看 → DtsBindingDetailDialog (read-only)
编辑 → add/focus local draft bag → DtsBindingDraftDialog
详情页脚「加入草稿」 → close detail → same as 编辑
校验并加入本轮 → onCreateDraft (existing) → DtsBindingDraftTray
```

`DtsParameterWorkbench` must open **different** components for `view` vs `edit` (no shared `focusEditorOnOpen` as the only difference).

## 4. View dialog — `DtsBindingDetailDialog`

### Header

- Title: `{propertyKey}` (or `{propertyKey} 参数详情`)
- Eyebrow: `模块 · 实例 · 重要性` (instance/driver as available; no recommended value)

### Sections (order)

1. **参数定义** (core)
   - 当前值 (raw)
   - 生效值
   - 值形态
   - 治理状态 (`schema` / `policy` / `governance` / `mapping`)
   - Spec description / constraints **only if** the API later provides them; otherwise omit (no “接口未提供规格详情” noise)

2. **DTS 位置** (required DTS addition)
   - Compatible
   - Unit address
   - 完整路径
   - 源文件 · 行号

3. **近期历史**
   - Binding revision entries (existing history loader)
   - Empty: `暂无历史记录。`

4. **跨项目对比**
   - List of other projects’ raw values (existing `compareEntries` shape)
   - Empty: honest empty copy
   - Out of scope this slice: target-project select, side-by-side diff, “use as draft”

5. **Collapsed**
   - 来源链
   - 技术身份 (Binding ID, Parameter Spec ID, Spec Version ID, Logical Node ID, Topology node ID, 源出现 ID)

### Footer

- 关闭
- If `canEdit`: primary **加入草稿** (does not edit in-place)

### Must not include

- Target-value / reason editors
- “校验并创建草稿” inside the view dialog

## 5. Edit dialog — new `DtsBindingDraftDialog`

Modeled on legacy `ParameterDraftDialog`, data from `DtsParameterWorkbenchRow` + local draft bag.

### Header

- Eyebrow / title: **修改草稿**
- Short description: editing adds a draft; after validation it enters the current-edits tray

### Round summary strip

- `本轮草稿 N 项`
- **全部清空** — clears the **local** draft bag only (pending tray items remain managed by the tray)

### Cards (one per local draft; focus the binding that opened the dialog)

Each card:

- Name; `模块 · 实例 · 重要性`
- Current → target preview (simple arrow or compact diff for long values)
- One-line DTS context: path · Compatible (not a full detail dump)
- 目标值 raw (textarea)
- 修改原因 (textarea)
- Server diagnostics / client hints when present
- **移除本项**

### Footer

- 关闭
- Primary: **校验并加入本轮** — for each submittable card (non-empty reason + target), call existing `onCreateDraft`; on success, remove from local bag and leave items in `DtsBindingDraftTray`. Dialog may close when the bag is empty, or stay open if cards remain.

### Must not include

- Recommended-value / drift copy
- Full identity UUID grids or expanded provenance lists

## 6. State & wiring

| Piece | Responsibility |
|---|---|
| Local draft bag | `bindingId → { rawValue, reason }` owned by workbench or API workspace coordinator |
| `DtsBindingDetailDialog` | Read-only; `onAddToDraft(bindingId)` |
| `DtsBindingDraftDialog` | Edit bag; `onCreateDraft` / clear / remove |
| `DtsBindingDraftTray` | Unchanged: server-validated pending drafts + submit-for-review |
| `DtsParameterWorkbench` | `detailIntent` opens the matching dialog; stop using edit-as-focused-detail |

Prefer keeping bag state next to where `pendingDrafts` already lives (`ApiProjectTopologyWorkspace`) if that avoids prop drilling; unit-test dialogs in isolation with bag props.

## 7. Testing

- View dialog: no target/reason controls; shows 参数定义 + DTS 位置; technical IDs only under 技术身份; 加入草稿 callback.
- Edit dialog: multi-card local bag; remove/clear; submit calls `onCreateDraft` with binding identity; success empties submitted cards.
- Workbench: View vs Edit open different dialogs; read-only users get View only (no Edit / no 加入草稿).
- Keep existing tray / submission tests green.
- Frontend-visible: playwright-cli on `/parameters` for view + edit at desktop / tablet / mobile; confirm width and section order.

## 8. Documentation impact

- Update `docs/FRONTEND.md` + `docs/zh-CN/frontend.md`: View = detail dialog; Edit = draft dialog; tray remains post-validation.
- No API contract change expected; skip OpenAPI regen unless wiring discovers a missing compare field (out of scope).

## 9. Self-review

- No placeholders left for core sections.
- Non-goals explicitly defer recommended value and full compare UX.
- Scope is UI split + content; does not reopen module identity or seed work.
