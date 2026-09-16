# UI quality checklist

> Chinese: [UI quality checklist](../zh-CN/developer/ui-quality-checklist.md)

WiseEff primarily serves PC users. This policy replaces the former repository-wide mandatory desktop/tablet/mobile walkthrough. Older general three-viewport instructions do not add a second gate. Explicit device-specific requirements in an accepted release or feature contract still apply to that work.

## Build on the existing design system

Read the relevant sections of `docs/design-docs/ui-design-system.md` and nearby component tests. Reuse `ModalDialog`/`ConfirmDialog`, `ColumnFilter`, `DataTable`, and `src/components/ui/` rather than creating parallel primitives.

Preserve design tokens, Chinese-first copy, shared formatters, keyboard focus, accessible labels and errors, dialog focus handling, and reduced-motion support. Exercise loading, empty, error, disabled, and interaction states affected by the change, not every unrelated state on the page.

## One PC check by default

| Change | Minimum browser observation |
| --- | --- |
| Local copy, icon, or isolated visual fix | Affected route/state at `1440x900`; inspect wrapping and the changed element. |
| Form, search, filtering, navigation, dialog, or other interaction | Relevant success, failure, and keyboard flow at `1440x900` in the real runtime. |
| Layout, dense tables, shared chrome, or resizing | Same desktop check; add a single compact PC window such as `1280x800` only where the changed layout could fail. Check the affected route or boundary, not the entire site again. |
| Explicit mobile/tablet support or a device-specific release contract | Opt into the required extra viewport checks for that scope. |

Use existing focused Playwright tests or an available real-browser tool. `playwright-cli` is optional unless the accepted contract explicitly names it. Existing equivalent evidence for the current candidate need not be repeated manually. A DOM snapshot alone is not visual evidence: capture and inspect a screenshot for appearance or layout changes. Routine interaction-only changes do not require an unrelated screenshot gallery.

Check relevant console and network failures. Distinguish pre-existing problems from regressions. Missing browser capability blocks browser acceptance, not independent safe implementation; report the gap without claiming verification passed.

## Automated quality profiles

`npm run acceptance:responsive` and the responsive project within `npm run acceptance:quality-run` use the desktop-only profile by default. All existing routes and desktop layout assertions remain. Accessibility and visual projects, native CI receipts, and the Merge bar are unchanged.

```bash
# Normal PC layout gate (1440x900).
npm run acceptance:responsive
# Optional compact PC check: select only the affected tests.
WISEEFF_QUALITY_VIEWPORT_PROFILE=compact npm run acceptance:responsive -- --grep '/parameter-admin'
# Explicit compatibility check (desktop, tablet, mobile).
WISEEFF_QUALITY_VIEWPORT_PROFILE=extended npm run acceptance:responsive
```

The profiles are `desktop`, `compact`, and `extended`; an invalid value fails rather than silently reducing coverage. Test titles identify the actual viewport. A default PC run does not prove tablet/mobile compatibility. Specialized viewport tests outside this shared responsive suite are not removed or relabeled by the profile.

## Native checks and evidence

Run focused component/behavior tests, `npm run build` for TypeScript/Vite/routing/shared-type changes, `npm run lint` for affected frontend code, and `npm run ui:check` for styling, tokens, dialogs, motion, or visible copy. For interaction changes, review relevant acceptance specs, requirement IDs, operation IDs, and operation-evidence impact under `docs/PLANS.md`.

Provide one compact summary: candidate, routes/runtime, actual viewport and interactions, command outcomes, inspected screenshots when relevant, console/network findings, and missing evidence. Keep artifacts sanitized. Do not repeat the entire checklist in the skill, PR, and final response.
