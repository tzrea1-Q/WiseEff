# DTS Topology Pointer Expand/Collapse

> Chinese: [中文](../../zh-CN/superpowers/specs/2026-07-20-dts-topology-expand-collapse-design.md)

Date: 2026-07-20
Status: Confirmed

## Context

`DtsTopologyNavigator` already stores per-node expansion state, exposes
`aria-expanded`, hides collapsed descendants, and implements the WAI-ARIA tree
keyboard pattern with Left/Right arrows. Its pointer behavior is incomplete:
the chevron is decorative and clicking the row only selects the node and
filters the parameter list.

## Decision

Parent nodes receive a dedicated disclosure control. Clicking or tapping that
control only toggles the node's children. Clicking the rest of the tree item
continues to select the node and filter the parameter list. Leaf nodes render
no disclosure control.

The tree item remains the single roving-focus target. The disclosure control
does not add a second Tab stop; keyboard users continue to use Left/Right on
the focused tree item. Pointer activation returns focus to the tree item after
toggling so subsequent arrow-key navigation remains predictable.

## Behavior

- Expanded parent: the disclosure control announces `Collapse <node>` and its
  descendants are rendered.
- Collapsed parent: the control announces `Expand <node>` and all descendants
  are absent from the rendered tree.
- Disclosure activation does not call `onSelectNode` and does not change the
  parameter-list filter.
- Tree-item activation does not toggle expansion.
- Collapsing an ancestor does not discard the selected descendant identity.
  The descendant is hidden until the ancestor is expanded again.
- Left/Right, Up/Down, Home/End, Enter, and Space behavior remains unchanged.
- The disclosure target is at least 44×44 CSS pixels on touch layouts and has
  a visible hover/focus affordance.

## Component design

The native row button becomes a focusable `role="treeitem"` container so it can
own a separate native disclosure button without nesting one button inside
another. The disclosure button stops pointer event propagation and calls the
existing `setExpanded` state transition. The row container keeps the existing
roving `tabIndex`, selection, `aria-level`, `aria-expanded`, keyboard handlers,
and node-selection handler.

No API, DTS identity, tree-building, database, or submission-flow changes are
required.

## Verification

Component tests must prove that:

1. Clicking a parent disclosure hides and restores descendants.
2. Disclosure clicks do not select the parent.
3. Clicking the tree item still selects without toggling.
4. Leaf nodes expose no disclosure button.
5. Existing keyboard and roving-focus tests remain green.

Browser verification covers `/parameters` at 1440×900, 768×1024, and 390×844,
including pointer expand/collapse, parameter filtering, console errors, and
page-level horizontal overflow.

## Documentation impact

This interaction completes the per-node disclosure behavior already described
by the DTS parameter workbench design. It does not alter API or domain
contracts, so no API, schema, or runbook update is required.
