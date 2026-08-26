# UX Spec: Table Column Multi-Select Filter

> Chinese: [Chinese](../zh-CN/design-docs/ux-table-column-filter.md)

Status: **Current** · Date: 2026-07-26

## Purpose

Define the standard UX for filtering a data table by one categorical column when the operator may select **one or many** values. New and refactored tables must reuse this pattern instead of inventing a visible `<select>`, sort-only affordance, or ad-hoc popover.

## Canonical Implementation

| Piece | Location |
| --- | --- |
| Component | `src/components/ColumnFilter.tsx` |
| Styles | `.parameters-column-filter*` in `src/styles.css` |
| Shared tree model | `src/domain/tree-filter/treeFilter.ts` |
| Shared tree options | `src/components/common/TreeFilterOptions.tsx` |
| Unit tests | `src/components/ColumnFilter.test.tsx`, `src/components/common/TreeFilterOptions.test.tsx`, `src/domain/tree-filter/treeFilter.test.ts` |
| Reference consumers | `ParametersTable`, `DtsParameterWorkbenchTable` (所属模块), `ParameterSpecLibrary` / `ProjectAdminTable` (parameter admin), log/admin/debug tables, review headers |

Do not fork a second funnel-menu component. Extend `ColumnFilter` if a shared gap appears (search-in-menu, virtualization, etc.). Hierarchical column filters use `ColumnFilter` with `mode="tree"`; the shared tree model and `TreeFilterOptions` are also reused by `ModuleTreeSelect`.

## When To Use

Use `ColumnFilter` when all of the following hold:

- The control lives in a **table / grid column header** (or an equivalent dense header cell).
- Values are a **finite categorical set** (module name, status, risk, role, …).
- Operators need **zero, one, or many** selected values (OR semantics within the column).
- The idle state must stay **quiet** — label text plus a small icon, not a permanent dropdown that dominates the header.

Do **not** use `ColumnFilter` for:

- Global search (use the page search field).
- Non-column hierarchical module navigation (use `ModuleTreeSelect` / the workbench module navigator). A hierarchical **column filter** uses `ColumnFilter` tree mode.
- Exclusive single-choice settings that are not column filters (use a normal form `<select>` or radio group).
- Sort-only headers (use the existing sort button + arrows; optionally place `ColumnFilter` beside sort when both are needed).

## Visual Contract

Idle header cell:

1. Column title text (plain, not a fake select).
2. Compact funnel trigger (`Funnel`, ~13px) via `aria-label={`筛选${label}`}`.
3. When selected values are non-empty, the trigger shows the logical-root count badge and the `.active` surface (primary soft fill). Tree mode counts roots, not every descendant row.

Open menu:

1. Fixed-position panel (`.parameters-column-filter__menu--fixed`) so horizontal table scroll does not clip it.
2. Head row: filter title + **清除** (disabled when nothing selected).
3. Flat mode renders a checkbox list; tree mode renders an expandable tree with checked / mixed / unchecked parent state, optional counts, and optional search by label/path.
4. Each option has an accessible name equal to the display label.
5. Empty set copy: `暂无选项`.

Default alignment is `left`; use `align="right"` only when the column sits near the right edge and the menu would otherwise overflow the viewport.

## Interaction Semantics

| Action | Result |
| --- | --- |
| No values selected | Column filter is inactive; rows are not narrowed by this column. |
| Toggle checkbox | Add or remove a value (multi-select); tree mode stores canonical root IDs and applies the selection to the complete subtree. |
| Clear | Reset to `[]` (inactive). |
| Outside click / close | Menu closes; selection is preserved. |
| Escape | Close the menu and return focus to its trigger. |
| Arrow keys / Home / End | Move through visible tree items; Right expands or enters a branch, Left collapses or returns to its parent. |
| Space / Enter | Toggle the focused tree item using the same selection semantics as a pointer click. |

Filtering rule for a column:

```text
selectedRoots.length === 0
  || rowModuleId is covered by one of selectedRoots
```

Parent pages own the selected-value state (`string[]`). Flat mode stores values; tree mode stores stable module IDs, canonicalized so selecting a parent removes redundant selected descendants. Multiple roots use OR semantics. Derive option lists from the **pre-column-filter** row scope (search / tree / other filters), include connected ancestors, and count only rows in that scope. A scope change must not reinterpret an out-of-scope ID as a same-named module.

Tree search only changes the visible option tree: it retains matching ancestors, auto-expands matching branches, and does not clear the selected roots. Parent state is computed from selectable descendants; a partially covered branch exposes the mixed state.

Tree mode uses a roving focus model: only the active visible `treeitem` is in the tab order, while its `aria-level`, `aria-expanded`, `aria-checked`, and mixed state remain exposed to assistive technology. Disabled structural ancestors stay visible for context but cannot be selected.

## Composition With Sort

When a column is sortable **and** filterable:

- Keep sort on the title control (arrow affordance).
- Keep filter on the funnel beside it (see `ParametersTable` head cell).
- Do **not** replace sort with a native `<select>` “because filtering is needed”.

Workbench example: `所属模块` is filter-only (`ColumnFilter`); `参数名` / `重要性` remain sort-only.

## Anti-Patterns (Do Not Ship)

- Full-width or header-embedded `<select>` / `LibrarySelectFilter` as the primary column filter.
- Single-select-only menus when multi-select is a natural need (statuses, modules, sources).
- Reusing sort arrows (`ArrowUpDown`) to mean “open a filter”.
- Re-implementing funnel + checkbox menus with one-off CSS in feature folders.

## Verification

- Unit: build/sort/orphan/cycle guards and canonical-selection behavior (`treeFilter.test.ts`); open menu, toggle, mixed state, search, clear, Escape, and focus (`ColumnFilter.test.tsx`, `TreeFilterOptions.test.tsx`).
- Integration: table/page tests assert `getByRole("button", { name: "筛选…" })`, checkbox multi-select, and result counts.
- Regression: `ModuleTreeSelect` single-select, multi-filter, portal, and selectable-id behavior; `/parameters` and `/dts-reload` use their own module registries while sharing the tree control.
- Browser: desktop / tablet / mobile — menu stays usable under horizontal scroll; search, expand/collapse, selection, clear, Escape, focus return, and outside-click close work; no console errors.

## Change Control

Updates to this UX require updating this doc and its Chinese twin in the same change. Prefer extending `ColumnFilter` over adding a parallel control.
