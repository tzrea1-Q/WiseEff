# UI Design System

> Chinese: [Chinese](../zh-CN/design-docs/ui-design-system.md)

Status: **Current** · Date: 2026-08-24

This is the operational visual and interaction standard for every WiseEff product surface. It turns the principles in [`docs/DESIGN.md`](../DESIGN.md) into enforceable rules: tokens, component contracts, interaction states, motion, layout, and content language. The completion gate that enforces this document is [`docs/developer/ui-quality-checklist.md`](../developer/ui-quality-checklist.md). The migration of existing code toward this standard was delivered by [`docs/exec-plans/completed/2026-08-12-frontend-aesthetics-uplift.md`](../exec-plans/completed/2026-08-12-frontend-aesthetics-uplift.md); residual stock is tracked as TD-111–TD-115 in the tech-debt tracker.

Quality benchmark: a focused, dense, fast workbench in the spirit of Linear — restrained color, strict type and spacing scales, strict elevation, subtle and consistent motion, and zero leaked internals.

## Non-Negotiables

1. **Tokens are the only source of visual values.** Components and page CSS must not contain raw hex/rgb/oklch colors, raw `z-index` numbers, ad-hoc font sizes, or one-off shadows. New values enter through the token layer or do not enter at all.
2. **One accent.** The product has exactly one interactive accent (brand blue). Black-filled buttons, teal step indicators, and off-palette one-offs are defects.
3. **Five states or it does not ship.** Every interactive element defines rest, hover, active, focus-visible, and disabled. Async actions also define a loading state. Removing a focus outline without an equivalent visible replacement is forbidden.
4. **One primitive per job.** One Button, one Dialog (`ModalDialog` contract), one Table basis, one Toast pipeline, one Empty/Loading/Error vocabulary. Building a local variant of an existing primitive requires deleting or wrapping the old one, not adding a parallel one.
5. **Chinese-first product language.** No raw English fragments, error strings, event slugs, ISO timestamps, milestone codenames, or debug copy in the UI. Everything user-visible goes through product language and shared formatters.
6. **The shell owns the page title.** Pages must not repeat their own `h1`/`h2` page title below the TopBar. Page headings start at section level.
7. **Density is a feature.** Primary tables must fit their columns inside a 1280px content area without horizontal scrolling; overflow detail belongs in inspectors/dialogs, not in more columns.
8. **Motion is tokenized and subtle.** Durations and easings come from motion tokens; the `ease` keyword and >400ms UI transitions are not allowed; infinite loops must respect `prefers-reduced-motion`.
9. **Demo data is product data.** Seeded environments must never show test residue (`FoldRegistryTestDG`, `probe-edit-*.dts`, acceptance fixture accounts) in user-facing surfaces.
10. **Every visible change is verified in a real browser** per the checklist, at 1440/768/390 widths, before it is called done.

## Canonical Implementation

| Piece | Canonical location | Notes |
| --- | --- | --- |
| Token layer | `src/styles.css` `:root` block + `.dark` overrides | Single source; raw literals live only in these two blocks; shadcn `@theme inline` keys must map to the same semantic tokens, never a second palette |
| Button | `.button` base layer in `src/styles.css` + `src/components/ui/button.tsx` (cva) on the same tokens | One geometry: sizes sm 28 / md 32 / lg 36; variants `primary`/`subtle`/`ghost`/`danger`; scopes may only add layout, never geometry or color |
| Dialog | `src/components/common/ModalDialog.tsx` + `ConfirmDialog` | Portal, focus trap, `inert` background, top-most Escape, paired backdrop dismissal, declared z-index scale, tokenized backdrop dim + enter motion |
| Toast | `src/components/common/toast/ToastProvider.tsx` (`useToast()`) | Single portal queue, tones success/info/danger, bottom-right, 4s auto-dismiss with hover pause, `--z-toast` |
| Table | `src/components/admin/DataTable.tsx` | Standard list shell: pagination, `aria-sort`, keyboard row navigation, filter empty state, `ColumnFilter` integration |
| Column filter | `src/components/ColumnFilter.tsx` | Spec: [Table Column Multi-Select Filter UX](ux-table-column-filter.md) |
| Loading/Empty/Error | `src/components/common/SectionState.tsx` (+ `AppShellSkeleton` for auth bootstrap) | Skeleton + empty + error-with-retry trio; parameter-home re-exports the same components |
| Local token derivation | `src/features/parameter-home/parameter-home.css` | Derive scoped tokens from global tokens via `color-mix()`; never invent new literals |
| Icons | `lucide-react` | No emoji glyphs, no `✓`/`↗` text characters as icons |

## Design Tokens

Exact values are ratified in the P0 token PR of the uplift plan. The semantic vocabulary below is binding now.

### Color

Semantic roles (light theme; dark theme derives from the same roles):

| Token | Role | Starting value |
| --- | --- | --- |
| `--bg` | App background | `#f7f8fc` family (one value) |
| `--surface` | Cards, panels, table rows | `#ffffff` |
| `--surface-raised` | Popovers, dialogs | `#ffffff` + elevation |
| `--surface-sunken` | Wells, code canvases, input backgrounds | one muted tint |
| `--border` | Default hairline | one value (replaces the ~10 near-identical grays) |
| `--border-strong` | Emphasized dividers, focused inputs | one value |
| `--text` | Primary text | one near-black |
| `--text-secondary` | Secondary text | one gray |
| `--text-muted` | Tertiary/meta text | one gray (currently referenced but undefined — must be defined) |
| `--accent` | Interactive primary (buttons, links, active nav, selection) | brand blue `#0052cc` family |
| `--accent-hover` / `--accent-pressed` | Interaction shades | derived |
| `--accent-soft` | Selected/active backgrounds, badges | derived tint |
| `--success` / `--warning` / `--danger` / `--info` | Status colors + matching `-soft` tints | one family each |
| `--ring` | Focus ring | accent-based, one value |

Rules:

- Raw color literals are allowed **only** inside the token block. Everything else uses `var()` or `color-mix()` over tokens (follow the `parameter-home.css` pattern).
- The shadcn `--primary`/`--muted`/`--border` oklch keys must alias the semantic tokens above. Two palettes answering the same question is a defect.
- Neutral chrome carries the interface; color appears only for interaction and status. Charts consume a tokenized categorical ramp (`--chart-1..5`) aligned with the accent, not library defaults.

### Typography

Font stacks:

```css
--font-sans: "Geist Variable", -apple-system, BlinkMacSystemFont, "PingFang SC",
  "HarmonyOS Sans SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas,
  "Liberation Mono", monospace;
```

- Geist Variable is already bundled and self-hosted; the remote Google Fonts `@import` (unreachable in self-hosted deployments) must be removed, not replaced with another remote font.
- A CJK fallback chain is mandatory: the UI is Chinese-first and the Latin webfont carries no CJK glyphs.
- Weights: **400, 500, 600, 700 only.** Values like 650/720/750/760/850 render as neighbor weights and are forbidden.

Type scale (px values; one `rem` basis is acceptable, but no mixing per surface):

| Token | Size / line-height | Use |
| --- | --- | --- |
| `--text-xs` | 11/16 | Eyebrows, dense meta |
| `--text-sm` | 12/18 | Table meta, captions, badges |
| `--text-base` | 13/20 | Body, table cells, inputs, buttons |
| `--text-md` | 14/22 | Emphasized body, dialog body |
| `--text-lg` | 16/24 | Section titles, dialog titles |
| `--text-xl` | 20/28 | Page-level headings (TopBar title) |
| `--text-2xl` | 24/32 | Display numbers on dashboards |

No other `font-size` values. `letter-spacing` is limited to `0` (body) and `0.04em` (uppercase eyebrows only).

### Spacing

4px grid. Tokens `--space-1..-16` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Defaults:

- Page content padding: 24px (desktop), 16px (mobile).
- Card padding: 16–20px. Section gap: 24px. Control gap in toolbars: 8px.
- Values off the 4px grid (e.g. 6px, 10px, 14px gaps) are migrated, not multiplied.

### Content Widths

| Token | Value | Use |
| --- | --- | --- |
| `--xiaoze-welcome-copy-width` | `270px` | Font-independent maximum width for the Xiaoze welcome subtitle; keeps the committed Linux visual baseline stable across CJK fallback metrics |

Content-width tokens describe deliberate wrapping constraints, not general container geometry. The Xiaoze welcome-copy width must remain tokenized and fixed in pixels: character-relative `ch` units make the Chinese line breaks depend on the active fallback font.

### Radius

| Token | Value | Use |
| --- | --- | --- |
| `--radius-sm` | 6px | Inputs, chips, menu items |
| `--radius-md` | 8px | Buttons, cards, popovers |
| `--radius-lg` | 12px | Dialogs, sheets, page-level panels |
| `--radius-full` | 999px | Pills, avatars |

No 7/9/10/14px one-offs.

### Elevation

Exactly four levels; shadows are never invented inline:

| Token | Use |
| --- | --- |
| `--shadow-1` | Rest cards, sticky headers (hairline + faint ambient) |
| `--shadow-2` | Popovers, dropdowns, hover-raised cards |
| `--shadow-3` | Dialogs, sheets |
| `--ring` | Focus ring: `0 0 0 2px` accent at fixed alpha, optionally offset by surface color |

### Motion

| Token | Value | Use |
| --- | --- | --- |
| `--duration-fast` | 120ms | Hover/press feedback, small fades |
| `--duration-base` | 160ms | Menus, tooltips, list feedback |
| `--duration-slow` | 240ms | Dialogs, sheets, panel slides |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances |
| `--ease-in-out` | `cubic-bezier(0.45, 0, 0.25, 1)` | Moves, exits |

Rules: no `ease` keyword; no UI transition above 400ms; entrances animate opacity/transform only; every infinite animation has a `prefers-reduced-motion: reduce` fallback.

### Z-Index

One declared ladder in `:root`; raw numbers in component CSS or TSX are forbidden. The overlay scale is `--z-xiaoze-fab: 1100`, `--z-xiaoze-popup: 1140`, `--z-modal-backdrop: 1150`, `--z-modal-backdrop-nested: 1160`, `--z-xiaoze-approval: 1250`, and `--z-toast: 1350`, with app-layer tokens below it (sticky header, sidebar, dropdown/popover). The modeless Xiaoze popup deliberately sits below business dialogs; its approval surface and toasts deliberately sit above them. "+1 escape hatches" (40 vs 41, 60 vs 61) are defects.

## Interaction States

Every interactive element defines all of:

| State | Requirement |
| --- | --- |
| Rest | Explicit surface, border, text color from tokens |
| Hover | Visible but subtle shift (background tint or border shift), `--duration-fast` |
| Active | Pressed feedback (darker tint and/or 1px translate) — mandatory, this is where cheapness shows |
| Focus-visible | `--ring` focus ring, visible on light surfaces and on dimmed modal backdrops; never `outline: none` without replacement |
| Disabled | Reduced opacity + `cursor: not-allowed`; disabled buttons that gate on validation must expose the reason (tooltip or inline hint) |
| Loading (async) | Inline spinner + label, element keeps its dimensions, `aria-busy="true"` |

Hover and focus-visible must remain visually distinguishable (do not merge them into one rule that clears the outline).

## Component Standards

### Buttons

- One implementation. Variants: `primary` (accent fill), `secondary` (surface + border), `ghost` (transparent), `danger` (danger fill or outline), `link` (text). Sizes: `sm` 28px, `md` 32px (default), `lg` 36px; icon-only buttons are square with centered 16px icons.
- The full visual contract in `docs/FRONTEND.md` § Button And Action Styling applies. Per-scope geometry overrides of `.button` (42 scopes today) are defects to migrate.
- Primary actions per view: exactly one.

### Inputs and selects

- Min-height 32px, `--radius-sm`, tokenized border, focus ring per above, visible label or `aria-label`, error text linked via `aria-describedby`.
- Native `<select>` is a transitional allowance in existing surfaces; new surfaces use the styled Select primitive once P1 lands. Native date/file inputs keep native pickers but styled triggers.

### Dialogs

- All dialogs go through `ModalDialog`/`ConfirmDialog` (or the Radix `ui/dialog` wrapper where already in place) — never hand-rolled `<div className="modal-backdrop">` and never `window.confirm`.
- A dimmed backdrop is mandatory; card enters with `--duration-slow` + `--ease-out` fade/scale; Escape closes the top-most layer; focus is trapped and restored.
- Widths: `sm` 400px, `md` 560px, `lg` 720px; content scrolls, chrome does not.

### Tables

- Header row 36–40px with `--text-sm` 600 labels; body rows 40–44px (dense 36px) with `--text-base` cells; hover row tint; selected row uses `--accent-soft`.
- Sticky header inside the table scroll container; column filters via `ColumnFilter`; sortable columns expose `aria-sort`; clickable rows are keyboard-activatable.
- Column budget: primary tables fit within 1280px content width; secondary metadata (raw ids, long provenance) lives in the row inspector. Repeated per-row action buttons prefer hover/focus reveal or a single overflow menu.
- Numeric columns are right-aligned with `font-variant-numeric: tabular-nums`; identifiers/values use `--font-mono`.

### Feedback

- One toast pipeline (`useToast()` from `src/components/common/toast`): single portal, queue, three tones (success/info/danger), auto-dismiss 4s with hover pause + optional action, stacked bottom-right product-wide.
- Banners are reserved for persistent context (degraded mode, permission scope), not action results.
- Errors shown to users are mapped to product language; raw `error.message`, HTTP payloads, and stack fragments never render. Field errors sit under the field, linked with `aria-describedby` and `aria-invalid`.

### Loading, empty, error

- Loading: skeletons for content regions (lists, cards, canvases) reserving real layout; spinners only for inline/button-level waits. The auth/bootstrap phase shows an app-shell skeleton, never a blank white screen.
- Empty: icon (lucide) + one-line state + optional one-line guidance + optional primary next action. No bare "no data" table rows.
- Error: message in product language + retry action. Transient API failure must not silently log the user out or strand the page.

### Charts

Recharts surfaces consume tokens: categorical ramp `--chart-1..5`, gridlines `--border`, axis text `--text-muted` at `--text-sm`, tooltips styled like popovers (`--surface-raised`, `--shadow-2`). Library default palettes are not acceptable.

Ratified ramp (P3): `--chart-1` aliases `--accent`; `--chart-2` teal `#0e7490`, `--chart-3` violet `#7c3aed`, `--chart-4` sky `#0284c7` (the `--info` hue), `--chart-5` slate `#64748b` — all ≥3:1 against `--surface` in light, four of five ≥4.5:1. The dark theme brightens `--chart-2..5` one step (`#22b8cf` / `#a78bfa` / `#38bdf8` / `#94a3b8`) while `--chart-1` follows the dark accent. Consume the ramp through `src/domain/format/chartTheme.ts` (series/status colors, grid stroke, axis ticks, tooltip styles exported as `var()` references) instead of hardcoding values, so charts follow the active theme.

## Layout and Page Structure

- The TopBar renders the page title and subtitle from `appConfig`; page bodies must not repeat them (no double titles, no competing `h1`).
- Card nesting is limited to two levels of visible rounded borders; deeper grouping uses spacing and dividers instead of more boxes.
- Content max nesting and width budgets are part of review: at 1440px viewport no primary workbench table may require horizontal scrolling caused by chrome padding.
- Sidebar: 256px expanded / 76px rail on desktop; below 768px it becomes an overlay drawer (a persistent rail consuming ~18% of a phone screen is a defect). The user menu must remain reachable at all widths.
- Navigation preserves SPA behavior (no full-page reloads from in-app links), resets main scroll position on route change, and keeps exactly one visual hierarchy of active states.

## Content and Language

- UI copy is Simplified Chinese. English is allowed only for product names, code/identifiers rendered as code, and legally required text.
- Forbidden in user-visible surfaces: raw event slugs (`recompute`, `auth-event`), internal codenames (M2, PPV), raw ISO timestamps, English relative times ("2h ago", "never", "just now"), untranslated library/table chrome ("Showing X of Y", "Report ID"), debug placeholders ("empty init UI evidence").
- One shared datetime formatter: relative within 7 days ("3 分钟前"), absolute beyond ("2026-08-05 12:52"); tooltips may show the precise timestamp.
- Percentages come from one formatter that normalizes 0–1 fractions vs 0–100 integers (a confidence of 0.91 renders as 91%).
- Subtitles and helper copy: one line, no mechanism essays; interaction rules belong in tooltips or docs, not paragraphs above tables.

## Accessibility Baseline

- Text contrast ≥ 4.5:1 (≥ 3:1 for large text and icons); status colors are paired with text or icons, never color alone.
- All interactive elements are reachable and operable by keyboard; clickable table rows and cards implement `tabIndex` + Enter/Space activation.
- Dialog semantics follow `ModalDialog` (role on the card, labelled title, focus trap/restore).
- Every form control has a programmatic label; every error is programmatically associated.
- `npm run acceptance:a11y` must stay green for covered routes; new primary routes join the covered list.

## Anti-Patterns (Do Not Ship)

- Raw hex/rgb/oklch, raw `z-index`, raw `font-size`, or invented `box-shadow` in component/page CSS.
- A second visual language for the same primitive (new button geometry scope, new dialog base, new table shell, new toast class).
- Black or off-accent filled buttons; more than one primary button per view.
- `window.confirm` / `window.alert`; dialogs without backdrop, Escape handling, or focus trap; stacking uncoordinated floating layers.
- `outline: none` without a visible focus replacement; hover and focus-visible merged into one style.
- The `ease` keyword, >400ms UI transitions, unguarded infinite animations.
- English fragments, raw errors, slugs, ISO timestamps, or milestone codenames in the UI.
- Blank-white app bootstrap, bare "no rows" empty states, tables that horizontally scroll at 1440px due to chrome padding.
- Test fixtures or probe data visible in seeded demo environments.
- Static inline `style={{...}}` for anything other than data-driven values or CSS-variable injection.

## Verification

Every frontend-visible change runs the completion gate in [`docs/developer/ui-quality-checklist.md`](../developer/ui-quality-checklist.md): targeted tests, `npm run build`, and a real-browser walkthrough (1440×900, 768×1024, 390×844) with screenshots, console checks, and interaction evidence under `work/ui-checks/<topic>/`. Quality gates: `npm run acceptance:a11y`, `npm run acceptance:visual`, `npm run acceptance:responsive`.

## Change Control

- Token values and scales change only through a PR that updates this document and the token block together, with before/after screenshots of at least three affected surfaces.
- New component variants require: no existing variant fits, the variant is added to the canonical primitive (not a local fork), and this document's component section is updated in the same change.
- Deviations discovered in code are defects: file them against the uplift plan or `docs/exec-plans/tech-debt-tracker.md` rather than copying them.
