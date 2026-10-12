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
| Search field | `src/components/common/SearchField.tsx` | One search-input chrome; filtering lives in `src/lib/search/` profiles, not in the input |
| View switch | `src/components/ui/view-switch.tsx` + `view-switch.css` | Three tokenized styles: `section` navigation (40px / full radius / 14px, selected `--nav-selected`), `tabs` content tabs (32px / md radius / 13px, selected `--accent-soft`), `toggle` radio options (28px / sm radius / 12px, selected `--surface`) |
| Bridge installation stepper | `src/components/LocalDeviceBridgeWizard.tsx` + `.local-device-bridge-wizard__steps` in `src/styles.css` | Ordered installation/connection progress, not tabs or a view switch; its own tokenized step styling is the exception to the shared switch contract |
| Loading/Empty/Error | `src/components/common/SectionState.tsx` (+ `AppShellSkeleton` for auth bootstrap) | Skeleton + empty + error-with-retry trio; parameter-home re-exports the same components |
| Local token derivation | `src/features/parameter-home/parameter-home.css` | Derive scoped tokens from global tokens via `color-mix()`; never invent new literals |
| Icons | `lucide-react` | No emoji glyphs, no `✓`/`↗` text characters as icons |

**View-switch contract (UIA-016):** all switches on the 23 audited pathnames use the shared primitive; no local switch styling or overrides remain on these surfaces. `/organization` and `/organization/members` use section navigation; the members account/registration workspace uses content tabs. Section arrows/Home/End move focus without navigating; Enter/Space activate. Content tabs use manual activation, roving focus and required item `id`/`panelId` pairs; callers render the active `role="tabpanel"` with that panel ID, `aria-labelledby` pointing to the item ID, and a keyboard entry point only when the panel has no focusable content. Panels containing focusable controls omit `tabIndex`; use the shared `TabPanel` for loading, empty or read-only states so focusability follows the rendered content. Radio options select with arrows or Space. All styles share tokenized focus-visible and disabled states. The consistency project checks every visible switch against exactly one root-token style signature at `1440x900` in light and dark themes. `viewSwitchStyleExpectations` in `e2e/quality/consistency-routes.ts` names all 23 paths and their required tiers, including `/user-permissions`, whose redirect must show both section navigation and account tabs.

Debugging and parameter administration use section navigation, including the nested definition-library/identity-mapping routes. Node debugging and DTS reload use local content tabs for HDC/ADB, associated with the selected protocol’s workbench panel. Canonical value/member-removal review (also used on submissions) and legacy review use content tabs with associated pending/history panels. The consistency style assertion also covers these routes and parameter-admin redirects; it checks all visible switches while leaving Bridge installation progress separate. Existing route/query, protocol-session reset, request selection and disabled-action contracts are unchanged.

Inactive tab panels remain mounted and hidden so every `aria-controls` target exists; inactive panel contents may be unmounted.

### Local Device Bridge Installation Stepper

Node debugging and DTS reload share a compact readiness bar with one “Connect this computer” action and an “Installation guide” entry, both labelled in Chinese. Any unrevoked record in the server's Bridge list makes the user returning, regardless of platform; returning users do not see inline setup. An empty active list shows setup inline once per page visit, until dismissed or a connection is attempted. Browser storage does not decide this. The guide opens on demand as a right-side drawer using `ModalDialog` focus containment, Escape dismissal and focus return. It keeps the workbench visible. Connected users see a quiet chip showing the Chinese connected label and machine name; device detection stays in the existing topbar. Ordinary disconnected probes are not alerts; failed connection attempts retain Chinese local-Bridge advice and technical details in the bar. Pairing, protocol and device-write approval gates do not change.

The Bridge wizard on node debugging and DTS reload presents three sequential steps: install Bridge, connect this computer, and attach a USB device. It uses an `ol` labelled `Bridge 连接步骤` with `li` progress items; `data-active` marks the displayed step and `data-done` marks completed steps. Only a reachable, non-current step becomes a button for revisiting it. Unreached steps remain non-interactive, and prerequisite checks continue to determine progress. This is not a `tablist`, `radiogroup`, or free view selection: it has no tab-panel associations or arrow-key tab activation. Its `.local-device-bridge-wizard__steps` styles stay separate; the consistency assertion exempts only these list items, never the HDC/ADB protocol tabs beside the wizard.

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
| `--text-muted` | Tertiary/meta text | slate `#536277` (light), `#8b99b3` (dark) |
| `--accent` | Brand accent (links and interactive emphasis) | brand blue `#0052cc` family |
| `--primary` / `--app-primary` | One resting-primary action color; both alias `--accent` | light `#0052cc`, dark `#4c8dff` |
| `--accent-hover` / `--accent-pressed` | Interaction shades | derived |
| `--nav-selected` | Selected filled navigation, not an action or pressed state | light `#003d9b`, dark `#4c8dff` |
| `--accent-soft` | Selected/active backgrounds, badges | derived tint |
| `--success` / `--warning` / `--danger` / `--info` | Status colors + matching `-soft` tints | one family each |
| `--ring` | Focus ring | accent-based, one value |

Rules:

- Raw color literals are allowed **only** inside the token block. Everything else uses `var()` or `color-mix()` over tokens (follow the `parameter-home.css` pattern).
- The shadcn `--primary`/`--muted`/`--border` oklch keys must alias the semantic tokens above. Two palettes answering the same question is a defect.
- **Primary-color contract (UIA-017):** every enabled primary action's computed resting background equals the resolved `--primary`, including Local Device Bridge installation and connection actions on node debugging and DTS reload. The CSS `.button.primary` and shared Button default use this same token; Bridge scopes only add layout, never primary colors. Light and dark use the same aliases, including legacy `--app-primary` → `--primary` → `--accent`. Hover and pressed shades are `--accent-hover` and `--accent-pressed`; selected filled navigation uses the separately named `--nav-selected`. A selected navigation pill is not a primary CTA. The quality consistency project checks visible enabled primary actions against the root token at `1440x900` in both themes, so a scoped override cannot redefine the expected color. Native-disabled and `aria-disabled="true"` controls remain measured but use their separate disabled visual state, not the enabled resting-primary assertion.
- Primary-action measurement uses shared button markers, not route-specific class allowlists. Existing shared actions outside `.button.primary` or the shared Button default/primary variants declare `data-primary-action="true"`. Every consistency route rendering an enabled primary action requires its measurement; disabled actions stay collected but excluded from the color rule.
- Neutral chrome carries the interface; color appears only for interaction and status. Charts consume a tokenized categorical ramp (`--chart-1..5`) aligned with the accent, not library defaults.

#### Tested Contrast Pairs (UIA-001)

Small text, including bold chips and visible line numbers hidden from assistive technology, requires **at least 4.5:1**. These pairs preserve the existing hue families. Their definitions live in the `src/styles.css` token blocks; component styles consume them rather than inventing foreground/background combinations.

| Foreground | Background | Contrast (light / dark) | Consumers |
| --- | --- | --- | --- |
| `--text-muted` | `--bg`, `--surface`, `--surface-raised`, `--surface-sunken`, `--surface-low/mid/high`, `--accent-soft` | minimum 4.81 / 4.58 | Metadata, log trend note, debug coverage badge, unselected hotspot toggle |
| `--success` (`#0d714d` / `#10b981`) | `--success-soft` | 5.06 / 5.26 | Success status text and badges |
| `--warning` (`#965500` / `#f59e0b`) | `--warning-soft` | 4.92 / 6.08 | Warning status text and badges |
| `--danger` | `--danger-soft` | 5.00 / 4.99 | Danger status text and badges |
| `--info` (`#036b9f` / `#38bdf8`) | `--info-soft` | 4.89 / 5.92 | Informational status text and chips |
| `--success` | `color-mix(in srgb, var(--success) 14%, var(--surface))` | 4.91 / at least 4.5 | “工作配置” chip |
| `--configuration-source-text` | `--configuration-source-surface` | 13.69 in both themes | Dark source canvas and unified diff |
| `--configuration-source-line-number` (aliases `--configuration-source-text-muted`) | `--configuration-source-surface` | 6.66; 5.25 on focused rows | Both source-viewer gutters, including hovered and focused rows |
| `--configuration-source-text-muted/secondary/strong` | `--configuration-source-surface`, `--configuration-source-surface-raised` | at least 4.5 in both themes | Source metadata and header |
| `--configuration-source-surface` | `--configuration-source-find`, `--configuration-source-find-active` | 11.16 default; 7.96 active, in both themes | Search matches: explicit dark ink on opaque yellow/amber fills |

The configuration source canvas stays dark in both themes. Standalone source viewers use `--text-secondary` and `--text-muted` on `--surface-sunken`. `src/contrast.styles.test.ts` checks the actual stylesheet declarations, resolving token derivations and compositing translucent row backgrounds before applying the WCAG threshold. The accessibility quality gate scans all ten UIA-001 pathnames at 1440×900 without the hotspot, working-chip, or line-number exclusions. Token-pair tests do not replace the live API-runtime accessibility scan or before/after screenshots.

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

The TopBar uses `--text-xl` / `--leading-xl` (20/28). App headings and button labels consume this scale, including legacy controls and portalled confirmations. The consistency collector checks every visible heading and button, requires one TopBar title, and rejects missing or off-scale measurements on every consistency route in light and dark at 1440×900. Public marketing typography stays outside this app-shell contract.

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

Status rails (`--shadow-status-warning`, `--shadow-status-accent`, `--shadow-status-accent-light`) and outline/focus/pulse recipes (`--ring-soft`, `--ring-outline`, `--ring-secondary`, `--ring-accent`, `--ring-pulse-start`, `--ring-pulse-end`) live in the same root token block. These are semantic strokes, not additional elevation levels; page CSS must not invent their geometry or colors inline. The bottom-anchored configuration task sheet uses the directional `--shadow-sheet-above` recipe so its shadow falls onto the content above it, not below the viewport.

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

Within page content, the named sub-ladder is `--z-content-base` (0), `--z-content` (1), `--z-content-sticky` (2), `--z-content-panel` (3), `--z-content-toolbar` (4), `--z-content-menu` (5), and `--z-content-overlay` (10). This preserves existing workbench/tree/inspector/dock stacking below the app-level sticky tier (20).

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

Legacy `.button` and shared `Button` use one CSS size table over the existing spacing and typography tokens, not separate Tailwind and CSS sizes:

| Size | Height | Font / line-height | Horizontal padding |
| --- | --- | --- | --- |
| `xs` (shared auxiliary controls) | 24px | 11/16 | 4px |
| `sm` (row actions) | 28px | 12/18 | 8px |
| `md` (shared `default`) | 32px | 13/20 | 12px |
| `lg` | 36px | 13/20 | 16px |

The table is declared once by the shared `.button-size-*` rules alongside their legacy selectors. Icon variants use the corresponding square side with zero padding; their icons are 16px, except the 12px `xs` icon. Small controls have a 4px content gap; default and large controls have an 8px gap. Both implementations use the medium radius and weight 600. Page scopes must not redefine this geometry.

### Row actions

`src/components/common/RowActionMenu.tsx` is the shared row-action contract for subsequent list migrations. Each row has at most one visible text action (`primaryAction`) plus a labelled overflow trigger. The visible action and trigger use `Button size="sm" variant="ghost"`; overflow items use the same small geometry. Existing callers are not migrated by the contract-only ticket.

- `label` identifies the row's action group and overflow menu for assistive technology. `items` have stable IDs, labels, optional disabled state and `onSelect` callbacks. An empty item collection renders no overflow trigger.
- Radix DropdownMenu supplies menu/menuitem semantics, roving keyboard focus, arrows, Home/End, typeahead, Escape, outside dismissal and focus return. The menu is portalled so table scrollports do not clip it.
- A destructive item must declare `destructive: true` and `confirmation` with a title, blast-radius description and confirm label; optional acknowledgement uses the existing ConfirmDialog contract. Destructive actions cannot be the visible action. They are red text in the menu, never solid red row buttons, and selection only opens `ConfirmDialog`.
- The destructive callback runs only after confirmation. Pending confirmation disables repeat submission and dismissal. Rejections remain in the dialog as localized errors for retry; cancellation and success return focus to the overflow trigger. Ordinary action callbacks retain caller-owned outcome handling.

### Inputs and selects

- Min-height 32px, `--radius-sm`, tokenized border, focus ring per above, visible label or `aria-label`, error text linked via `aria-describedby`.
- PC filter and sort selects, plus pagination page-size selects, opt into `.compact-filter-control` (native) or `SelectTrigger size="filter"` (custom): one 32px border-box height (`--space-8`), border, radius, font and chevron contract. Pagination actions use the existing default 32px `.button` primitive, not its `sm` variant. Mark only these controls with `data-compact-control="filter"`, `"sort"` or `"pagination"` for consistency measurements. Search comboboxes, module navigation, table-header sort buttons, form fields and dialogs keep their own primitives; page-local rules may add layout, not redefine compact geometry or appearance.
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

### Shell gutter and navigation

The app shell owns `--page-gutter` (24px on PC). `.main-content` and `.topbar` consume it; `.page-content` wraps routed app content without an inset, and the app footer remains its shell sibling. Page roots add no outer padding or margin. Cards and workbench panes retain their internal padding; do not remove those interior insets or replace page-local CSS with global overrides. The configuration workbench keeps its existing omitted footer.

The configuration content wrapper preserves the full-height chain into the bounded panes. Its source canvas keeps the existing `--font-code` stack at `--text-sm` with a 1.75 line-height ratio (12/21px); token migration must not change source-line geometry. Compact shell bottom clearance is 120px on the 4px grid, not a single 64px spacing step. Screen-reader-only chart fallback text uses a negative `--stroke-hairline` margin, not negative content spacing.

Expanded and collapsed shared navigation use the 4px spacing tokens; ordinary items have a 40px minimum height, 8px vertical / 12px horizontal padding and a 12px icon-label gap. Active items use the named `--shadow-1` tier in both themes. No custom active shadows or off-grid navigation spacing are permitted.

The consistency harness compares the shell's token-defined left edge with routed content, page-root content, TopBar and footer edges (±1px) on every consistency route. Missing regions or non-finite measurements fail. The footer is optional only when no shell footer exists in the DOM (including legacy project links redirected to the configuration workbench); every present footer is measured and checked, even if hidden. Runtime screenshots and quality/acceptance runs remain required, not replaced by static tests.

### Overview and retired-page templates

`OverviewPage` in `src/components/layout/` owns a summary strip, a responsive content grid, and optional quick actions, in that order. Pages supply `summary`, `children`, and `quickActions`, with an accessible `label`; they do not recreate the grid in page-local CSS. The template inherits the shell gutter, uses the existing spacing and typography scale, and defines only tile/content minimum-width layout tokens. Tiles live in a description list and use `OverviewTile` for a value, label and optional trend. Measured zero values and zero trends remain visible.

The caller supplies `hasSamples` for each tile or `OverviewVerdict` from that metric's actual source. With no observations, the shared policy replaces values and verdicts with the canonical no-sample message and suppresses trends; it never substitutes a success verdict or a fabricated percentage. Loading, error and unavailable-risk states retain their existing meanings. `/parameter-home` uses the selected overview scope and retains project selection, window controls, quick actions and the hotspot tab. `/log-dashboard` uses today's non-archived logs, with completed confidence observations for quality metrics; its existing navigation actions stay in the TopBar. The public home stays outside the shell.

`RetiredNotice` replaces obsolete comparison and simulator pages with one title, one explanatory sentence and a primary replacement link. `/parameter-comparison` links to `/parameters`; `/debugging` links to `/node-debugging`. Links have real `href` destinations, use app navigation on an ordinary activation, and preserve native modified-click navigation. They do not render a misleading not-found error.

Component tests cover slots, sample policy and replacement navigation. The consistency harness requires non-empty template measurements on all four routes in light and dark at 1440x900, checks gutter-aligned slots, tile containment, page overflow, first-section visibility and no-sample values/verdicts, and verifies each retired notice's primary destination. Runtime quality/acceptance checks and before/after screenshots remain separate evidence; stylesheet guards enforce token-only visual declarations, and `ui:check` is ratcheted down when counts drop.

### Navigator workbench

`NavigatorWorkbench` in `src/components/layout/` owns the fixed order: toolbar (primary action at the right end), optional compact context, at most one notice slot, then named navigator, task and optional inspector regions. Page code fills slots; it does not redefine the grid, pane widths or scroll budget. `/parameters` uses this template for both DTS and JSON. Catalog definitions (`/parameter-admin`, `/parameter-admin/specs` and its definition aliases, `/parameters/definitions`) put the release strip in context and governance guidance in the notice slot, retaining the existing definition dialog. Catalog admin aliases share the `catalog-definitions` collapse key; the read-only `/parameters/definitions` uses `parameter-definitions`. Mock-mode flat parameter tables and other routes retain their existing layouts until separately migrated.

| Slot | Contract |
| --- | --- |
| `toolbar` / `primaryAction` | Search, view switches, filters and secondary actions occupy the controls group; the optional primary action stays at its right end. |
| `context` | Optional compact release, project or status strip below the toolbar. |
| `notice` | At most one compact notice slot below context; use shared alert styling and retain the page's existing dismissal behaviour. |
| `navigator` | Named, collapsible module/object region; content scrolls inside the pane. |
| `children` / `taskState` | Named task region owns its scrollport. Loading, empty and retryable error states delegate to `SectionState`; search with no matches keeps the table header and filters available. |
| `inspector` | Optional named detail region after the task; the page decides when to open it. Definition details and history remain in the existing dialog, not a permanent inspector. |

Layout constants are defined once in the `src/styles.css` root token block: `--navigator-workbench-navigator-width` (18rem, reserving room for module counts), `--navigator-workbench-navigator-cap` (aliases `--module-navigator-max-width`, `min(32.5rem, 42vw)`), `--navigator-workbench-collapsed-width` (`--space-10`, 40px), `--navigator-workbench-inspector-width` (20rem), `--navigator-workbench-gap` and `--navigator-workbench-toolbar-padding` (`--space-3`, 12px), `--navigator-workbench-pane-height` (`min(670px, calc(100vh - 230px))`) and `--navigator-workbench-scroll-rail-height` (14px). The body grid uses the smaller of navigator width and cap, a `minmax(0, 1fr)` task track and, when present, the inspector width. At 1440×900, the navigator starts at the template's left edge; the task starts one bounded navigator width plus one gap to its right. Labels stay on one line with ellipsis; the intrinsic-width count column never shrinks or clips. Overflow stays inside the navigation/task scrollports, never on the page. Toolbar, pane, tree and parameter-table colors consume semantic theme tokens, including the Phase 2 contrast pairs in dark mode. Migrated pages must not wrap the template in a second padded card or retain local grid, pane-width or scroll-height rules.

Collapse uses `wiseeff.navigator-workbench.collapsed:<pageKey>` in browser local storage; when storage is unavailable, the choice lasts only for the current mount. `/parameters` shares its page key across projects and DTS/JSON formats. Collapse replaces the navigator track with the 40px rail, keeps navigator content mounted but hidden, and preserves module selection and URL state (`project`, `moduleNode`; Catalog retains `moduleNodeId`). The toggle names its controlled content with `aria-controls` and exposes `aria-expanded`. Navigator, task and inspector are labelled `section` regions, not additional `main` landmarks; retain the app shell's main landmark and skip link. DOM and keyboard order is toolbar controls → primary action → context → notice → navigator toggle/tree → task → inspector, omitting absent or hidden content. Optional result tabs label the body `tabpanel`; format switching restores focus to the active format tab.

The logs workbench (`/logs`, page key `logs`) keeps history in the collapsible navigator. Report, metadata and related-content tabs share the task area; successful and processing records show the analysis, while failed records show only the failure summary. Related knowledge retains its existing capability check. The upload action occupies the toolbar's primary slot; upload and re-upload return to the selected record's report. Selection remains shareable through `logId`, independently of tabs and navigator collapse. The shared pane geometry and scrollports replace the page-local grid.

Next migrations, outside this first slice: module governance, project configuration, node debugging and DTS reload after #1110 (Bridge readiness). Until those tickets migrate their callers, retain the legacy `.dts-parameter-workbench__body` / `.dts-workbench-topology` rules used by node debugging and DTS reload. They are not pane overrides on the migrated `/parameters` or Catalog surfaces. No palette, typography, density, URL, permission, server or Agent/device-write changes are part of this contract; tablet/mobile redesign remains out of scope.

The consistency quality project checks expanded and collapsed geometry (±1px), toolbar/action placement, one notice, first-row visibility, page overflow, count text clipping, and the existing row-action/module-tree contracts in light and dark at 1440×900. The dark `/parameters` pass also runs axe color-contrast without exclusions. Its screenshot attachments are the review gate before any Catalog migration; Linux visual baselines are never regenerated locally.

- Xiaoze's launcher and first-run hint occupy a reserved bottom shell gutter outside the main scrollport, never covering visible table scrollports or sticky action areas. Desktop launcher dragging and Left/Right keys move only within that gutter; the hint flips inward at the left edge. Resizing keeps the launcher reachable, with visible keyboard focus; Home restores the lower-right anchor. Hint dismissal persists per user across SPA navigation and reload (page-lifetime fallback when storage is unavailable). Popup interaction, Agent behavior and human approvals are unchanged. The consistency quality project asserts non-intersection on every target route at 1440×900, including the visible first-run hint.

- The TopBar renders the page title and subtitle from `appConfig`; page bodies must not repeat them (no double titles, no competing `h1`).
- Card nesting is limited to two levels of visible rounded borders; deeper grouping uses spacing and dividers instead of more boxes.
- Content max nesting and width budgets are part of review: at 1440px viewport no primary workbench table may require horizontal scrolling caused by chrome padding.
- Sidebar: 256px expanded / 76px rail on desktop; below 768px it becomes an overlay drawer (a persistent rail consuming ~18% of a phone screen is a defect). The user menu must remain reachable at all widths.
- Navigation preserves SPA behavior (no full-page reloads from in-app links), resets main scroll position on route change, and keeps exactly one visual hierarchy of active states.

### Settings forms

`SettingsFormPage` and `SettingsFormSection` in `src/components/layout/` own configuration-form layout. Organization settings (`/organization`), DTS reload defaults (`/debugging-admin`) and project review roles (`/parameter-admin/projects/:projectId/review-roles`) use one column capped by `--settings-form-max-width` (960px). The shell owns the outer gutter; only section cards add padding. Each section has a heading and short help text; the review-role matrix scrolls horizontally inside its section, not on the page.

The JSON-compatible saved and draft snapshots drive `useDirtyState`; returning to saved values removes the save bar. Dirty forms show a sticky bar with one primary 保存 and a 放弃 action. Discard restores the last saved snapshot without a server write. Save failures retain drafts and display a labelled error summary; field validation is inline and linked to the affected controls. During a save, fields, save/discard and navigation are blocked. Shell navigation, browser back/forward and reload warn about unsaved work; refresh on review roles uses the same guard.

Project-role saves keep the existing human confirmation, including each changed member's before/after roles. Writes remain individual optimistic updates using `expectedRoles`, not an atomic batch: if one fails, already saved members stay saved and remaining drafts can be retried or discarded. A stale-role conflict refreshes the affected member before retry. The consistency suite measures clean and dirty states in light/dark at 1440×900 and attaches screenshots without submitting writes.

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
