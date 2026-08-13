# Frontend aesthetics uplift program

> Status: **Completed 2026-08-13** (P0 #332, P1 primitives, P2 page sweep, P3 #447, P4 #444/#446 + FA-25 interaction-state closeout; deferred residue tracked as TD-111–TD-115)
> Date: 2026-08-12 → 2026-08-13
> Branch: program plan — one branch per phase: `fix/ui-foundation-tokens` (P0), `feat/ui-primitives-consolidation` (P1), `fix/ui-page-defects-wave-1` (P2), `feat/ui-motion-and-theme` (P3), `feat/ui-quality-gates` (P4), `feat/ui-aesthetics-closeout` (closeout)
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-12-frontend-aesthetics-uplift.md`](../../zh-CN/exec-plans/completed/2026-08-12-frontend-aesthetics-uplift.md)
> Standard: [`docs/design-docs/ui-design-system.md`](../../design-docs/ui-design-system.md) · Gate: [`docs/developer/ui-quality-checklist.md`](../../developer/ui-quality-checklist.md)

## Context

A full frontend aesthetics audit (2026-08-12) combined a live browser walkthrough of all 25 routes in API mode (evidence: `work/ui-checks/*.png`, desktop 1440 plus 390 mobile spot checks) with four parallel static audits of styling/tokens, component architecture, pages/interaction flows, and quality-process docs. Benchmark: Linear-grade visual quality.

Headline numbers: `src/styles.css` is a 28,556-line monolith (4,715 selectors); token penetration is 10.8% of declarations; 669 distinct color literals (2,230 uses); 60 font sizes; 40 radii; 113 shadow variants (91 used once); 36 motion durations with `ease` dominating (65 uses); 84/90 `z-index` declarations hardcoded; 42 CSS scopes each redefine `.button` geometry; 9 parallel table implementations; ~30 hand-rolled dialogs bypass `ModalDialog`; 3/21 button scopes define `focus-visible`; the Chinese-first UI ships no CJK font stack and imports Inter from Google Fonts (unreachable when self-hosted); 47 CSS-source regex assertions across 18 test files freeze the monolith against refactoring.

## Goal

Converge every product surface on one design language (tokens, primitives, states, motion, content rules) as specified by the UI Design System, and make regressions structurally hard through automated gates — so that any developer or agent produces Linear-grade UI by default.

## Non-goals

- Visual redesign of information architecture or product flows (IA stays; this program fixes execution quality).
- Dark mode shipping (P3 prepares wiring; shipping is a separate decision).
- Migrating every legacy page to Tailwind/shadcn (the target is one token layer and shared primitives; CSS technology per page may vary during migration).
- Mock-mode-only demo polish beyond what shared components fix for free.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent (subagent) | `git fetch` / checkout phase branch from latest `main`, implement, test, commit on the feature branch |
| Implementation agent (subagent) | Must not push to `main`, open GitHub PRs, merge PRs, or fast-forward local `main` |
| Parent agent (architect / session owner) | Review subagent output, run or spot-check verification, create GitHub PR, merge when approved, then `git pull origin main` |

One phase → one branch → one PR. Later phases rebase on the merged result of earlier phases.

## Findings

Severity: P0 = foundation defect that blocks convergence; P1 = product-visible quality failure; P2 = systemic polish debt.

### Foundation (styling and tokens)

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| FA-01 | P0 | Two disconnected design systems: shadcn/Tailwind primitives (`src/components/ui/*`, 17 components, near-zero adoption) vs 28,556-line handwritten `src/styles.css`; `--primary: oklch(0.205 0 0)` (near-black) coexists with `--app-primary: #003d9b` (brand blue), so the two button systems render different primary colors | `src/styles.css:37-44`, `src/styles.css:13492-13533`, `components.json` |
| FA-02 | P0 | Token layer bypassed by ~89% of declarations: 1,786 `var()` refs vs 16,578 declarations; 669 distinct color literals; no spacing/font-size/line-height/weight/motion tokens at all; radius tokens used 3.8%, z-index tokens 6.7% | Audit counts over `src/styles.css`; e.g. `--outline` defined at `src/styles.css:35` but 9 near-identical border grays used 107 times |
| FA-03 | P0 | Font system triple conflict and no CJK stack: remote Google Fonts `@import` survives into `dist` (fails on self-hosted intranet); Geist bundled but only reaches dialog/card headings via `font-heading`; `lang="zh-CN"` UI has no PingFang/YaHei/Noto fallback chain; 114 declarations use nonexistent weights (850/750/650/760/720) | `src/styles.css:1`, `src/styles.css:11`, `src/styles.css:13493-13494`, `src/components/ui/dialog.tsx:138`, `src/components/ui/card.tsx:41` |
| FA-04 | P1 | 26 `var()` references to never-defined tokens silently break rendering: `--text-muted` (14 refs), `--xiaoze-radius-sm` (4, radius collapses to 0), `--app-border` (2, whole `color-mix()` invalid), `--app-text`, `--ink`, `--font-mono` | `src/styles.css:3974`, `:4291`, `:15060`, `:10130` |
| FA-05 | P1 | 47 CSS-source regex assertions in 18 test files freeze `styles.css` against refactoring | `src/App.test.tsx` (12), `src/components/ParametersTable.test.tsx` (8), `src/topbarStyles.test.ts`, `src/components/common/ModalDialog.styles.test.ts` |
| FA-06 | P1 | z-index anarchy despite documented scale: 84/90 hardcoded, 30 distinct layers, +1 escape hatches (40/41, 30/31, 60/61), `zIndex: 60` in TSX | `src/styles.css:690,700,14536,14632,23823,23827`, `src/components/ColumnFilter.tsx:34,44` |
| FA-07 | P2 | No type/spacing scale: 60 font sizes (mixed px/rem), 25 line-heights, 68 gap values, 215 padding values, 91 `!important` | Audit counts; `docs/design-docs/ui-design-system.md` defines the target scales |
| FA-08 | P2 | 113 shadow variants (91 single-use); focus ring alpha inconsistent (0.10/0.12/0.14) | Audit counts over `src/styles.css` |
| FA-09 | P2 | Motion: 36 durations, 7 easings, 65 uses of default `ease`; good curves exist only in Xiaoze popup; several infinite loops unguarded by `prefers-reduced-motion` | `src/styles.css:13900-13919` (good), `logPulse`/`confidenceShimmer`/`dirty-pulse` (unguarded) |

### Components

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| FA-10 | P0 | No button base layer: `.button` has no base rule; 42 scopes redefine geometry (9 heights 24–44px, 5 font sizes, 6 weights, 3 radii); 504 raw `<button>` vs 66 `<Button>` | `src/styles.css:458,924,1202,4776,7552,10910,22829,25401,27707` |
| FA-11 | P0 | Interaction states missing at scale: 18/21 button scopes lack `focus-visible`, 14/21 lack `active`; 6 spots merge hover+focus then `outline: none`; 38 `outline: none` total; zero in-button spinners | `src/styles.css:762-766,2885,4244,6626,13406,19816` |
| FA-12 | P0 | Dialog fragmentation: `ModalDialog` (correct contract) has 4 consumers; ~30 hand-rolled `modal-backdrop` dialogs without focus trap/Escape (observed live: add-user dialog has no backdrop dimming, Escape does not close, stacks freely under the Xiaoze panel); 4 uses of `window.confirm` | `src/components/RollbackConfirmDialog.tsx:28`, `src/components/LocalDeviceBridgePanel.tsx:314`, `src/components/ParameterImportWizard/ParameterImportWizard.tsx:214`, `src/components/admin/ModuleEditDialog.tsx:460`; screenshots `work/ui-checks/17-add-user-dialog.png`, `18-xiaoze-panel.png` |
| FA-13 | P1 | 9 parallel table implementations; only `admin/DataTable` has pagination/`aria-sort`/keyboard rows (2 consumers); duplicate `DataTable` name in `src/workbenchUi.tsx:41` | `src/components/admin/DataTable.tsx`, `src/components/parameter-topology/DtsParameterWorkbenchTable.tsx:262` |
| FA-14 | P1 | Feedback fragmentation: toast copies ×3 without queue/portal; 6 confirm paths; 26 error class names; `aria-describedby` on only 5 fields; loading/empty/error trio complete only in `parameter-home` | `src/App.tsx:5227,5232`, `src/components/parameter-admin-next/useGovernanceToast.tsx:24`, `src/features/parameter-home/components/SectionState.tsx` |
| FA-15 | P2 | `App.tsx` (6,089 lines) is a shadow component library: byte-identical duplicates of `WorkbenchLayout`/`SectionLabel`/`EmptyState`; dead components (`RadioDropdownFilter`, `FilterChipGroup`, `ProjectValueMatrix`, `ui/avatar`, `ui/toggle`, `.undo-toast` CSS); dead `WorkspaceHeader`/`PageToolbar` layout layer | `src/App.tsx:5997,6039,6075` vs `src/workbenchUi.tsx:24,67,89` |
| FA-16 | P2 | Variant vocabulary split: `variant`/`tone`/`severity`/`kind` express the same axis six ways; 19 `<Button className=...>` overrides reinvent existing variants | `src/components/AgentInsightBar.tsx:8`, `src/components/common/ConfirmDialog.tsx:11`, `src/components/admin/ArchiveDebugParameterDialog.tsx:53` |

### Pages, content, and flows (browser-verified)

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| FA-17 | P0 | Raw internals leak to users: ISO timestamp + English debug copy on review page; duplicated raw English error with internal codename on logs page; raw slugs in audit center; raw English release-readiness error in workbench command bar; `Failed to fetch` on the auth screen | `work/ui-checks/07-review-1440.png`, `13-logs.png`, `14-audit.png`, `12-config-workbench.png`; `e2e` conflict API 500 |
| FA-18 | P0 | Mixed-language chrome: `Showing X of Y` hardcoded in 4 components (tests assert the English); `never`/`2h ago`/`just now` from `userGovernanceClient`; `Report ID` header; English permission-denied card; English eyebrows | `src/components/ParametersTable.tsx:355,372`, `src/NodeDebuggingPage.tsx:1109`, `src/features/dts-reload/DtsReloadPage.tsx:2139`, `src/infrastructure/http/userGovernanceClient.ts:64`, `src/app/routes.tsx:152-163` |
| FA-19 | P1 | Off-palette one-offs observed on 6+ pages: black filled buttons (`#111827`), black KPI bars, black-top dashboard cards, teal submission steps, navy auth button — two design generations coexist | `src/styles.css:496,8054,8088,8105,20481`; screenshots `07/08/09/13-log-dashboard/14-*` |
| FA-20 | P1 | Layout budget failures: `/parameters` table needs 1100px but gets 782px at 1440 (horizontal scroll); project list also overflows at 1440; at 390px the persistent 76px rail eats 18% width, `.topbar-user-switcher` is display:none below 900px (logout unreachable), and tray text wraps one-character-per-line | Live measurement `dts-workbench-list__scroll-x` sw=1100 cw=782; `src/styles.css:13075-13081`; `work/ui-checks/20-mobile-*.png` |
| FA-21 | P1 | State-coverage holes: blank white screen during auth bootstrap; transient API failure drops users to login with raw error; `/node-debugging` and `/user-permissions` lack loading/empty/error; confidence renders `0.91%` (0–1 fraction concatenated with `%`) | `src/App.tsx:1369,4403`; live observation during API restart |
| FA-22 | P2 | Zero transition vocabulary at page level: no dialog open/close animation for raw-backdrop dialogs, no scroll reset on navigation, landing-page links full-page reload; double page titles (`/parameters`, `/platform-console`) contradict shell-owns-title rule | `src/App.tsx:2519-2537`, `src/linear-template/LinearTemplateHome.tsx:99-110`, `work/ui-checks/05-parameters-1440.png` |
| FA-23 | P2 | Seeded demo shows test residue: `FoldRegistryTestDG`, `测试` driver group, `probe-edit-*.dts`, acceptance fixture accounts in user directory; raw version ids in workbench tree | `work/ui-checks/10-param-admin-modules.png`, `12-config-workbench.png`, `14-user-permissions.png` |

### Process gap

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| FA-24 | P1 | No lint of any kind (ESLint/Stylelint/Prettier absent); nothing prevents new hardcoded values; style rules exist only as prose + 3 point-fix `*.styles.test.ts` files | `package.json` (no lint script), `.github/workflows/ci.yml` |
| FA-25 | P2 | Visual/a11y/responsive gates cover only 6–7 routes at desktop-first; `/parameter-home`, configuration workbench, `/dts-reload`, `/feedback-admin`, `/node-debugging` uncovered; `work/ui-checks/` evidence not machine-checked | `playwright.quality.config.ts`, `e2e/quality/*.quality.spec.ts` |

## Delivery phases

### P0 — Foundation: tokens, fonts, unfreeze (branch `fix/ui-foundation-tokens`)

- [x] Migrate the 47 CSS-source regex assertions (18 test files) to behavioral/DOM assertions or scoped fixtures so the monolith can be refactored (FA-05; shared helper `src/test/cssAssertions.ts`).
- [x] Ratify the token block per the design system: semantic colors (single palette; shadcn keys aliased), type scale, spacing, radius, elevation, motion, extended z-index ladder (FA-01, FA-02, FA-07, FA-08, FA-09 foundations).
- [x] Define the 16 missing-but-referenced tokens; remove ~29 dead tokens (FA-04; 25 removed after triple-verification, remainder listed in the P0 report).
- [x] Fonts: delete the Google Fonts import; promote Geist Variable + CJK fallback chain as `--font-sans`; single `--font-mono`; clamp weights to 400/500/600/700 (FA-03).
- [x] Record the token decision as an ADR (ADR-0026) and update `CONTEXT.md` vocabulary (design token, elevation, accent).
- [x] Global `:focus-visible` baseline using `--ring`; remove the 6 hover+focus merges (FA-11 baseline).

### P1 — Primitive consolidation (branch `feat/ui-primitives-consolidation`)

- [x] One Button: base geometry + variants/sizes per spec; collapse the 42 scope overrides (145 rule blocks → base layer + ~50 layout/functional-only blocks); migrate black/navy/teal one-offs to tokens (FA-10, FA-19 named spots; `#111827` zeroed).
- [x] One Dialog: 35 hand-rolled backdrops across 24 files migrated to `ModalDialog`/`ConfirmDialog` (zero kept); `window.confirm` zeroed; unified backdrop dim + tokenized enter motion with reduced-motion fallback (FA-12).
- [x] One Toast pipeline (`src/components/common/toast/`, portal + queue + success/info/danger + hover pause, `--z-toast: 1180`); `.logs-feedback-toast` copies and `useGovernanceToast` retired (FA-14).
- [x] Shared `SectionSkeleton`/`SectionEmpty`/`SectionError` promoted to `src/components/common/SectionState.tsx` (parameter-home re-exports); `AppShellSkeleton` replaces the white screen during API auth bootstrap (FA-14, FA-21 partial).
- [x] Table convergence step 1: `admin/DataTable` is the standard list shell; adopted on `/user-permissions` (sorting, pagination, keyboard rows, filter empty state); duplicate `workbenchUi.DataTable` had zero remaining consumers and was deleted outright (FA-13).
- [x] Delete dead components and `App.tsx` byte-duplicates (`SectionLabel`/`EmptyState`/`WorkbenchLayout` deduped; `MetricCard` kept — `MetricBentoCard` is a chart card, replacement would be a redesign). Variant vocabulary standardized to `variant` on shared components (`KpiStrip`, `PageInsightBar`, `AgentInsightBar`, `workbenchUi.Badge`); deferred: `MetricBentoCard.severity` (its `variant` axis is taken by the visualization kind), `ConfirmDialog.tone` retained by design (FA-15, FA-16).

### P2 — Page defect wave 1 (branch `fix/ui-page-defects-wave-1`)

- [x] Content localization sweep: shared datetime formatter (relative/absolute), percent formatter (fixes `0.91%`), error-mapping layer so no raw `error.message`/slug/ISO/codename renders; replace `Showing X of Y`, `never`, `Report ID`, English permission card and eyebrows (FA-17, FA-18, FA-21 percent). Delivered as P2a: `src/domain/format/` (`formatRelativeOrAbsolute`/`formatAbsolute`, `formatPercent`/`normalizePercentValue`, `formatLastActive`), `src/infrastructure/http/presentError.ts`, and audit slug labels in `src/domain/audit/auditSlugLabels.ts` (unknown slugs render in code style). Remaining raw `error.message` render points outside the high-frequency pages (knowledge, product-feedback admin, parameter-admin-next governance panels, parameter-topology dialogs) ride with their owning waves.
- [x] Layout budget: fix `/parameters` and project-list horizontal overflow at 1440 (reduce chrome padding, move secondary columns to inspector); enforce nesting ≤ 2 (FA-20 desktop, FA-22 double titles). Delivered as P2b: workbench h2 block and `/platform-console` h1 removed (shell owns titles); workbench outer card stripped to one visible card level (nesting ≤ 2); table budget 1100→680 (≤1200: 920→640) matching surface-mvp column mins; `.param-admin-shell` double padding removed so the 1080px project list fits; measured at 1440 `.dts-workbench-list__scroll-x` scrollWidth 866 == clientWidth (was 1100/782) and project list 1100 == 1100.
- [x] Mobile: sidebar becomes an overlay drawer below 768px; restore user menu access; fix one-character-per-line wraps; scroll reset on navigation; SPA links on the landing page (FA-20 mobile, FA-22). Delivered as P2b: drawer (translateX + backdrop on `--z-drawer-backdrop`, Escape/backdrop/nav-click close, motion tokens + reduced-motion fallback); 769–900px rail now owned solely by `.sidebar-collapsed` (verbatim media duplicates removed); avatar-only user trigger ≤900px; nowrap on tray/table counts; `.main-content` scroll reset on route change; landing-page anchors keep href but route through the SPA on plain left-click.
- [x] State coverage: loading/empty/error for `/node-debugging` and `/user-permissions`; auth-failure path shows a product-language retry state instead of dropping to login (FA-21). Delivered as P2c: both pages render the shared `SectionSkeleton` while API data hydrates and `SectionError` with retry on failure (`debuggingRuntimeStatus`/`userDirectoryStatus` wired through the shell); the node table distinguishes no-nodes vs filtered-empty and demo-mode detect failures surface a toast instead of staying silent; the `/me` probe routes network-level failures to a full-screen `AppShellConnectionError` retry state (session token kept) and only auth rejections (401 family) to the login form.
- [x] Seed hygiene: remove/rename test-residue entities from demo seeds; hide raw version ids behind labels in the workbench tree (FA-23). Delivered as P2c: recon (`FoldRegistryTestDG|fold_registry_test|probe-edit`) found no committed seed/fixture residue — the audited entities are runtime writes to the shared dev database (schema-promotion runbook demo, historical probe sessions, e2e acceptance casts), so no seed rename/regeneration was needed; `reset-quality-runtime.ts` covers the acceptance accounts but not runtime-created driver-group modules or uploaded file versions (reported, no behavior change). Workbench source tree, canvas header, and inspector now render 「版本 v{n}」 labels with raw version ids demoted to tooltips or a code-style secondary line.
- [x] Dashboard unification: `/log-dashboard` cards adopt token colors/typography; remove black bars/borders (FA-19 remainder). Delivered as P2c: every hex/rgba literal in the log-dashboard block now consumes semantic tokens (teal quality accents → `--info` family; status bars `--success`/`--accent`/`--danger`; card top borders semantic status colors or `--border-strong`); display numbers and eyebrows use `--text-2xl`/`--text-xs..sm`; sparkline/progress fills derive from `--accent`; `#0f766e/#11a3a3/#0d9488/#14b8a6` zeroed across `styles.css` (`module-tone-5` → `--app-secondary`). Full chart theming (`--chart-*` on recharts) stays in P3.

### P3 — Motion and theme readiness (branch `feat/ui-motion-and-theme`)

- [x] Apply motion tokens across dialogs/menus/hover/press; complete `prefers-reduced-motion` coverage (FA-09). Delivered as P3a: every transition/animation literal in `styles.css`, `linear-template.css` and `parameter-home.css` consumes `--duration-fast/base/slow` + `--ease-out`/`--ease-in-out` (hover/press feedback on fast+ease-out, expand/collapse micro-state on base+ease-in-out, panel/layout moves on slow); the bare `ease` keyword is zeroed; Xiaoze popup open compresses 440→400ms (motion rule: no UI transition above 400ms) with its bespoke cubic-beziers mapped onto the shared tokens; every infinite loop is reduced-motion-guarded (api-runtime-sync spinner, logs analyzing pulse, both Xiaoze streaming carets, `.dts-status-icon--spin` outside the workbench subtree) and the dead `xiaoze-reasoning-glow`/`xiaoze-icon-pulse` keyframes were removed.
- [x] Chart theming: recharts consume `--chart-*`/`--border`/`--text-muted` tokens. Delivered as P3a: the categorical ramp is ratified in the token layer (`--chart-1` anchors on `--accent`; `--chart-2..5` teal/violet/sky/slate, all ≥3:1 on white, four of five ≥4.5:1) and the new `src/domain/format/chartTheme.ts` exports series/status colors, grid stroke, axis ticks and popover-spec tooltip styles as `var()` references so charts follow the active theme; `UpdateTrendChart` + `ProjectRiskChart` dropped the legacy palette vars for the helper (risk keeps its semantic danger/warning axis), `MetricBentoCard`'s SVG spark shed its hardcoded grays, and the `--risk-*` aliases now derive from status/chart tokens; the ratified ramp values are recorded in the design system §Charts.
- [x] Dark-theme wiring behind the semantic token layer (class strategy + persistence), shipping decision deferred. Delivered as P3b: the `.dark` block was rewritten from the shadcn legacy grayscale overrides into a complete dark derivation of the semantic roles (slate-family neutrals inverted; accent brightened one step to `#4c8dff` with a near-black `--primary-foreground` on accent/danger fills; status colors + soft tints remixed over `--surface`; deepened shadows; legacy palette, Xiaoze and chart tokens covered; raw literals only in `:root`/`.dark`); new `src/application/theme/themeController.ts` toggles the `dark` class + element `color-scheme`, persists light|dark|system under `localStorage["wiseeff.theme"]`, follows `prefers-color-scheme` while in `system` mode, defaults to light until the shipping decision, and exposes the `window.__wiseeffSetTheme` dev probe (no user-visible switch; 9 unit tests lock toggle/persistence/system-follow/dispose). A five-surface dark walkthrough (/parameter-home, /parameters, /log-dashboard, /user-permissions, add-user ModalDialog; light/dark evidence in `work/ui-checks/aesthetics-uplift-p3/`) drove tokenizing the walked surfaces' light-literal residue — shell chrome via scoped `--shell-*`/`--feedback-entry-*` tokens, the workbench table + module-tone badges, and the shared dialog dim via the new `--backdrop-dim` (the old `var(--text)`-derived dim flipped white in dark) — with light mode visually unchanged.

### P4 — Gates that make it stick (branch `feat/ui-quality-gates`)

- [x] `npm run ui:check` script: fails on raw color literals, raw `z-index`, raw `font-size`, `window.confirm`, and new `modal-backdrop` divs outside allowed files; wire into CI (FA-24). Delivered as P4 wave 1: `scripts/check-ui-standards.ts` + `scripts/ui-standards-baseline.json` + `scripts/check-ui-standards.test.ts` (run via `npm run test:scripts`). Eight independent ratchet rules; because P3 keeps reducing the literal stock on a parallel branch, the gate locks honest counts instead of assuming zero: raw-color 1852, raw-font-size 977, raw-shadow 147, ease-keyword 105, raw-z-index 76 (74 CSS + 2 `ColumnFilter.tsx`), while window-confirm / hand-rolled-backdrop / english-chrome are hard-forbidden at 0. Count > baseline fails with file:line plus design-system guidance; count < baseline hints `--update-baseline`; full scan ~0.5s (line-by-line state machines, token blocks `:root`/`.dark`/`@theme` exempt). Wired into `build-and-test` next to docs:check.
- [x] ESLint with `jsx-a11y` + `react-hooks` (scoped to prevent new debt; existing violations burn down incrementally). Delivered as P4 wave 1: eslint 9 flat config (`eslint.config.js`) over `src/**/*.{ts,tsx}` including tests, both recommended sets; zero-violation rules run at error, the 19 rules with stock run at warn with the 2026-08-13 census counts recorded inline (297 warnings; largest: `react-hooks/set-state-in-effect` 135, `react-hooks/refs` 32, `jsx-a11y/label-has-associated-control` 27). `npm run lint` (~10s full run, `--cache` enabled) added to CI; errors block, warnings do not.
- [x] Extend visual/a11y/responsive quality specs to `/parameter-home`, configuration workbench, `/dts-reload`, `/feedback-admin`, `/node-debugging`; add hover/focus state snapshots for Button/Dialog/Table (FA-25). Delivered in two waves: #446 extended all three gates to the five routes (12-route visual matrix with route-specific settle waits and masks, axe scans with named color-contrast excludes, responsive/layout budgets); the closeout branch added five interaction-state snapshots to the visual gate — primary Button hover and keyboard focus-visible (toolbar strip so the 2px/2px-offset `--ring` outline is not clipped), add-user `ModalDialog` open with backdrop (full page), `DataTable` row hover and sort-header keyboard focus — staged on `/user-permissions` (every primitive on seeded data) via the new `focusViaKeyboard` helper, because script `focus()` does not trigger `:focus-visible`. Linux baselines are the only authoritative ones and are adopted from CI artifacts.
- [x] Update `docs/QUALITY_SCORE.md` and `docs/developer/verification-matrix.md` (+ zh mirrors) with the new gates. Verified at closeout: both QUALITY_SCORE pages document `ui:check` (ratchet semantics + `--update-baseline`) and `lint` (error blocks, warn stock recorded in `eslint.config.js`); the EN verification matrix carries rows for `ui:check`, `lint`, and `acceptance:{a11y,visual,responsive,quality}` (the visual row now names the interaction-state snapshots), and the condensed zh matrix carries the `ui:check`/`lint` rows.

## Success criteria

- Token penetration in `src/styles.css` ≥ 70% of color/radius/shadow/z-index declarations after P1; 100% for new code via `ui:check`.
- Distinct color literals outside the token block: 0 (P4 gate enforced).
- One button implementation; 0 scope-level `.button` geometry overrides.
- 0 hand-rolled dialog backdrops; 0 `window.confirm`.
- 100% of interactive primitives define the five states; global focus ring visible.
- 0 raw-English/slug/ISO/debug strings on any walked route (re-run the 25-route walkthrough as evidence).
- No horizontal scroll on primary tables at 1440; drawer sidebar and reachable user menu at 390.
- CI runs `ui:check` + expanded quality specs green.

Closeout note (2026-08-13): the structural criteria hold (one button base, zero hand-rolled backdrops/`window.confirm`, global focus ring, layout budgets, CI gates green). Two criteria are honestly not at zero and are tracked instead of claimed: the literal-stock criterion is enforced as a no-growth ratchet with the remaining stock recorded in TD-113, and the 25-route zero-raw-string re-walkthrough was not re-run — known residue is pinned by TD-111 (raw `error.message` sites) and TD-115 (`formatLastActive` pg-text passthrough, found during FA-25 verification).

## Key seams

- Token block: `src/styles.css` `:root` (single block after P0) + `@theme inline` aliases.
- Primitives: `src/components/ui/button.tsx`, `src/components/common/ModalDialog.tsx`, `src/components/admin/DataTable.tsx`, new `src/components/common/toast/*`, promoted `SectionState`.
- Formatters: new `src/domain/format/` (datetime, percent) + error mapping in `src/infrastructure/http/` clients.
- Gate script: `scripts/check-ui-standards.ts` + `scripts/ui-standards-baseline.json` + `.github/workflows/ci.yml`.

## UI interaction coverage

This program changes visible chrome but must not change workflow semantics. Per the UI Interaction Automation Rule: each phase PR reviews `docs/developer/browser-acceptance-coverage-map.md` requirement IDs and `docs/developer/user-operation-coverage-matrix.md` operation IDs for the routes it touches, and keeps `npm run acceptance:browser` / `npm run acceptance:evidence` green. Known specs affected by chrome changes: `e2e/quality/visual.quality.spec.ts` (snapshot refresh expected and reviewed per phase), `e2e/quality/a11y.quality.spec.ts`, `e2e/quality/responsive.quality.spec.ts`, plus dialog-related acceptance specs when P1 migrates dialogs (e.g. `PROJ-CONFIG-*`, `PARAM-*` dialog flows). Visual snapshot refreshes require before/after review in the PR, not blind regeneration. New requirement/operation IDs are added before implementation where a changed behavior lacks one (e.g. mobile drawer navigation).

## Verification

```bash
npm test
npm run build
npm run docs:check
npm run acceptance:a11y
npm run acceptance:visual
npm run acceptance:responsive
# Browser evidence per phase under work/ui-checks/aesthetics-uplift-p{N}/
```

Audit baseline evidence: `work/ui-checks/01-*.png` … `21-*.png` (2026-08-12 walkthrough).

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Update | `AGENTS.md` + `docs/zh-CN/root/AGENTS.md` (routing to design system + checklist — done with this plan) |
| Planning | Update | `docs/PLANS.md` + `docs/zh-CN/PLANS.md` (active plan entry — done); this plan + zh companion |
| Product specs | No change | Visual execution only; product behavior unchanged |
| Architecture / ADR | Update | New ADR for token single-source (P0); `CONTEXT.md` vocabulary; `docs/adr/README.md` |
| Frontend / design docs | Update | `docs/design-docs/ui-design-system.md` + zh (new, done); `docs/design-docs/index.md` + zh (row added — done); `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` (section added — done); `docs/DESIGN.md` (pointer added — done) |
| Quality / testing | Update | `docs/developer/ui-quality-checklist.md` + zh (new, done); `docs/QUALITY_SCORE.md` + zh and `docs/developer/verification-matrix.md` + zh (P4, when gates land) |
| Security / governance | No change | No authz/audit surface change |
| Reliability / runbooks | No change | No runtime/ops change |
| Generated artifacts | No change | No schema/contract change |
| References | Review | `docs/references/design-system-reference-llms.txt` (align with the ratified tokens during P0) |
| Tech debt | Update | `docs/exec-plans/tech-debt-tracker.md` + zh for any deferred finding |

## Documentation Update Gate

- [x] `docs/design-docs/ui-design-system.md` + zh companion created and linked from `docs/design-docs/index.md` (+ zh), `docs/FRONTEND.md` (+ zh), `docs/DESIGN.md`, `AGENTS.md` (+ zh)
- [x] `docs/developer/ui-quality-checklist.md` + zh companion created and registered in `scripts/bilingual-docs.ts`
- [x] `docs/PLANS.md` + `docs/zh-CN/PLANS.md` list this plan
- [x] P0: ADR-0026 recorded; `CONTEXT.md` + `docs/adr/README.md` updated; `design-system-reference-llms.txt` aligned; TD-080/TD-081 filed
- [x] P4: `docs/QUALITY_SCORE.md` + zh and `docs/developer/verification-matrix.md` + zh describe `ui:check` and expanded quality specs (verified at closeout; the EN visual-gate row also names the FA-25 interaction states)
- [x] Deferred findings recorded in `docs/exec-plans/tech-debt-tracker.md` + zh: TD-111 (raw `error.message` residue outside high-frequency pages, P2a deferral), TD-112 (table convergence beyond step 1, FA-13), TD-113 (`ui:check`/eslint honest stocks vs the zero-literal success criterion), TD-114 (dead `WorkspaceHeader`/`PageToolbar` layer, `MetricBentoCard.severity`, two `ParameterReviewPage` Button overrides), TD-115 (`formatLastActive` renders pg-text timestamps raw — found during FA-25 verification); earlier phases already filed TD-080/081, TD-084, TD-091, TD-095, TD-106, TD-107, TD-110
- [x] `npm run docs:check` green before moving this plan to `completed/` (run at closeout on `feat/ui-aesthetics-closeout`)
