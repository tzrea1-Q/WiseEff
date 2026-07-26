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
| Unit tests | `src/components/ColumnFilter.test.tsx` |
| Reference consumers | `ParametersTable`, `DtsParameterWorkbenchTable` (所属模块), `ParameterSpecLibrary` / `ProjectAdminTable` (parameter admin), log/admin/debug tables, review headers |

Do not fork a second funnel-menu component. Extend `ColumnFilter` if a shared gap appears (search-in-menu, virtualization, etc.).

## When To Use

Use `ColumnFilter` when all of the following hold:

- The control lives in a **table / grid column header** (or an equivalent dense header cell).
- Values are a **finite categorical set** (module name, status, risk, role, …).
- Operators need **zero, one, or many** selected values (OR semantics within the column).
- The idle state must stay **quiet** — label text plus a small icon, not a permanent dropdown that dominates the header.

Do **not** use `ColumnFilter` for:

- Global search (use the page search field).
- Hierarchical module tree navigation (use `ModuleTreeSelect` / the workbench module navigator).
- Exclusive single-choice settings that are not column filters (use a normal form `<select>` or radio group).
- Sort-only headers (use the existing sort button + arrows; optionally place `ColumnFilter` beside sort when both are needed).

## Visual Contract

Idle header cell:

1. Column title text (plain, not a fake select).
2. Compact funnel trigger (`Funnel`, ~13px) via `aria-label={`筛选${label}`}`.
3. When `selectedValues.length > 0`, the trigger shows the count badge and the `.active` surface (primary soft fill).

Open menu:

1. Fixed-position panel (`.parameters-column-filter__menu--fixed`) so horizontal table scroll does not clip it.
2. Head row: filter title + **清除** (disabled when nothing selected).
3. Checkbox list; each option has an accessible name equal to the display label.
4. Empty set copy: `暂无选项`.

Default alignment is `left`; use `align="right"` only when the column sits near the right edge and the menu would otherwise overflow the viewport.

## Interaction Semantics

| Action | Result |
| --- | --- |
| No values selected | Column filter is inactive; rows are not narrowed by this column. |
| Toggle checkbox | Add or remove that value (multi-select). |
| Clear | Reset to `[]` (inactive). |
| Outside click / close | Menu closes; selection is preserved. |

Filtering rule for a column:

```text
selectedValues.length === 0
  || selectedValues.includes(rowValue)
```

Parent pages own the selected-value state (`string[]`). Derive option lists from the **pre-column-filter** row scope (search / tree / other filters), then apply column filters so counts and export stay consistent with the visible list.

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

- Unit: open menu, toggle, clear (`ColumnFilter.test.tsx`).
- Integration: table/page tests assert `getByRole("button", { name: "筛选…" })`, checkbox multi-select, and result counts.
- Browser: desktop / tablet / mobile — menu stays usable under horizontal scroll; focus and outside-click close work; no console errors.

## Change Control

Updates to this UX require updating this doc and its Chinese twin in the same change. Prefer extending `ColumnFilter` over adding a parallel control.
