# Design

WiseEff design should feel like an enterprise productivity system: dense enough for real work, clear enough for demos, and governed enough for risky engineering workflows.

## Product Design Principles

- Workspaces first, marketing second. The app should open into usable workflows, not a landing-page shell.
- AI is a capability layer across domains, not a standalone chat page.
- Risk and governance must be visible near the action they affect.
- Users should always understand current project, role, state, and next available action.
- Confirmation, audit, and permission cues should feel integrated rather than bolted on.

## Visual Direction

- Workbench surfaces use restrained layout, readable tables, compact metrics, and stable spacing.
- Home and capability sections can be more expressive, but should still point toward actual workflows.
- Status, risk, and workflow phases should use consistent badges and labels.
- Avoid one-note palettes. Do not let the interface collapse into a single hue family.
- Keep text at practical workbench scale inside cards, tables, dialogs, and toolbars.

## Current Design Sources

- Historical feature designs live in `design-docs/`.
- UI implementation lives in `src/components/`, page files, and `src/styles.css`.
- Product behavior and user roles live in `product-specs/`.

## Design Verification

For visual or interaction changes:

- Run focused component/page tests.
- Use browser verification for layout-heavy changes.
- Check desktop and narrow viewport behavior.
- Confirm buttons, labels, badges, and table cells do not resize or overlap unexpectedly.
