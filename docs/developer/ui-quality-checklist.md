# UI Quality Checklist

> Chinese: [Chinese](../zh-CN/developer/ui-quality-checklist.md)

This is the completion gate for every frontend-visible change. It operationalizes [`docs/design-docs/ui-design-system.md`](../design-docs/ui-design-system.md) and the browser-verification rule in `AGENTS.md`. A frontend-visible change is **not done** until every gate below passes or a blocker is explicitly reported.

Applies to changes in: UI, layout, styling, interactions, routes, components, forms, dialogs, tables, animation, responsive behavior, design tokens, public assets, or visible UI copy.

## 1. Before You Code

- [ ] Read [`docs/design-docs/ui-design-system.md`](../design-docs/ui-design-system.md) (tokens, component standards, anti-patterns) and [`docs/FRONTEND.md`](../FRONTEND.md) for the affected surface.
- [ ] Inventory existing primitives first: `ModalDialog`/`ConfirmDialog`, `src/components/ui/*`, `ColumnFilter`, `DataTable`, `SectionState`, `ModuleTreeSelect`, `WorkbenchSheet`. Do not build a new primitive when one exists; extend the canonical one.
- [ ] Plan all states up front: loading, empty, error (with retry), disabled (with reason), and the five interaction states for anything clickable.
- [ ] If the change alters user-facing interaction behavior, identify the affected `e2e/acceptance/` spec, requirement IDs in [`browser-acceptance-coverage-map.md`](browser-acceptance-coverage-map.md), and operation IDs in [`user-operation-coverage-matrix.md`](user-operation-coverage-matrix.md).

## 2. While You Build — Hard Rules

| Rule | Quick self-test |
| --- | --- |
| Visual values come from tokens only | `git diff` shows no new hex/rgb/oklch, no raw `z-index`, no raw `font-size`, no invented `box-shadow` outside the token block |
| One accent | No new black/teal/off-palette filled controls; one primary button per view |
| Five interaction states | rest / hover / active / focus-visible / disabled all defined; async actions have a loading state with stable dimensions |
| Focus is never destroyed | No `outline: none` without a visible ring replacement; hover and focus-visible are distinguishable |
| Dialogs use the shared contract | `ModalDialog`/`ConfirmDialog` (or existing `ui/dialog` wrapper); no hand-rolled backdrop `div`, no `window.confirm`; backdrop + Escape + focus trap verified |
| Tables follow the table standard | Sticky header, `ColumnFilter` for categorical filters, `aria-sort`, keyboard-activatable rows, no horizontal scroll at 1440 caused by chrome |
| Product language is Chinese-first | No raw English fragments, error strings, slugs, ISO timestamps, or internal codenames; errors mapped to product copy; dates and percentages go through shared formatters |
| Spacing on the 4px grid | New paddings/gaps/margins are 4, 8, 12, 16, 20, 24, 32, 40, 48, or 64 |
| Motion uses tokens | Durations/easings from `--duration-*`/`--ease-*`; no `ease` keyword; loops guarded by `prefers-reduced-motion` |
| Accessibility basics | Labels on all inputs; errors linked with `aria-describedby`; interactive rows/cards keyboard-reachable; contrast at or above 4.5:1 |

## 3. Definition-of-Done Gates

Run all of these before claiming completion:

```bash
npm test -- <targeted test files>
npm run ui:check
npm run build
```

Then the real-browser walkthrough with `playwright-cli` (mandatory; if it cannot run, stop and report the blocker):

1. Start the app (usually `npm run dev`) and visit every affected page or route.
2. Verify at least three viewports: `1440x900`, `768x1024`, `390x844`.
3. For every relevant page run both `snapshot` and `screenshot`; store screenshots under `work/ui-checks/<topic>/`.
4. Check `console error` on every visited page; inspect network requests when the change affects loading, data flow, submission, or error handling.
5. Exercise the real interactions: click, type, submit, open/close dialogs and menus, hover and focus controls with the keyboard, and trigger loading, empty, and error states where reachable.

Layout inspection on every screenshot:

- [ ] No element overlap, text overflow, truncated button labels, or squeezed controls.
- [ ] No unintended horizontal scrolling at any tested viewport.
- [ ] No vertically wrapped single-character text in narrow columns.
- [ ] Floating layers (assistant bubble, toasts, dialogs) do not cover primary actions or content being read.
- [ ] Visual hierarchy reads correctly: one page title (from the TopBar), section titles below it, one primary action.

## 4. Self-Review Rubric

Score every row pass/fail against the final screenshots. Any fail means the change is not done.

| # | Check |
| --- | --- |
| 1 | Every visual value traces to a token (spot-check the diff) |
| 2 | Interactive elements show visible hover AND pressed feedback |
| 3 | Keyboard focus ring is visible on every interactive element touched |
| 4 | Disabled controls expose why they are disabled |
| 5 | Loading, empty, and error states exist and match the shared vocabulary |
| 6 | No raw English, slugs, ISO timestamps, or debug text anywhere on the page |
| 7 | Numbers, dates, and percentages formatted by the shared formatters |
| 8 | Dialogs: backdrop dims, Escape closes top-most, focus returns to trigger |
| 9 | 390px: sidebar behaves as drawer/rail per spec, user menu reachable, no broken columns |
| 10 | No new one-off component variant duplicating an existing primitive |
| 11 | Card nesting at most two visible levels; no double page titles |
| 12 | Console shows zero errors on all visited pages |

## 5. Evidence To Attach

Final responses and PR descriptions for frontend-visible work must include:

- Local URL or routes tested, and the runtime mode used.
- Viewports tested and interactions exercised.
- Screenshot paths under `work/ui-checks/<topic>/`.
- Console/network check results.
- Issues found and fixed, or an explicit note that none were found.
- For interaction-behavior changes: the acceptance spec, requirement IDs, and operation IDs reviewed, per the UI Interaction Automation Rule in [`docs/PLANS.md`](../PLANS.md).

## 6. Reviewer Checklist

Reviewers reject frontend changes that:

- Introduce raw visual literals, a parallel primitive, or a new z-index number.
- Ship any interactive element missing hover/active/focus-visible/disabled.
- Render raw errors or English fragments in the product UI.
- Lack browser-walkthrough evidence for the three viewports.
- Regress the quality gates: `npm run acceptance:a11y`, `npm run acceptance:visual`, `npm run acceptance:responsive` for covered routes.
