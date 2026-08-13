# HCI interaction trust repair (Waves 0–1)

> Status: **Completed — merged to `main` 2026-08-13 via PR #331 (wave 1 was squashed into the same branch as PR #369 before the final merge)**
> Date: 2026-08-12 (implementation completed 2026-08-13)
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-12-hci-interaction-trust-repair.md`](../../zh-CN/exec-plans/completed/2026-08-12-hci-interaction-trust-repair.md)

## Context

A full HCI audit (2026-08-12) combined seven parallel static code-review agents (shell/navigation, parameter core flow, parameter admin, logs+feedback, debugging, governance+Agent, cross-cutting consistency; 200+ files read) with a live browser walkthrough (API mode, 15 routes, Admin account, 1440/768/390 viewports, evidence in `work/ui-checks/hci-audit/`). It found ~130 deduplicated issues (10+ P0, ~60 P1).

This plan was **complementary** to `2026-08-12-frontend-aesthetics-uplift.md`: that program owns visual execution quality (tokens, primitives, styles); this plan owned **behavioral trust**: feedback visibility, data honesty, destructive-action protection, and the Xiaoze approval gate.

## What shipped

### Wave 0 — stop the bleeding (PR #331 base commits)

| ID | Fix |
| --- | --- |
| HT-01 | Global toast layer `AppToastLayer` renders `state.notifications` in **both** runtimes (`role="status"`, ~4s auto-dismiss, manual close labeled 关闭提示); the mock-only gated render was deleted. `DISMISS_NOTIFICATION` action actually consumes the queue. |
| HT-02 | Approval-card layering hardened (`--z` token above the chat popup; pointer/scrim exemption for the card). Live repro showed the true blocker was backend SSE (issue #333) — see "Cross-workstream findings". |
| HT-03 | `UPSERT_DEBUG_SNAPSHOT` now materializes `lastDebugSnapshot` from the write operation (before/after values), re-arming rollback in API mode. |
| HT-04 | Confidence normalized to percent at the DTO seam (0–1 → 0–100, already-percent tolerated). |
| HT-05 | `/api/v1/me` probe failures split: 401/403 clears the token; network/5xx keeps the token and shows a retry screen (`unreachable` state). |
| HT-06 | CopilotKit dev banner/inspector gated behind `VITE_XIAOZE_INSPECTOR`. |

### Wave 1 — trust repair (PR #369, squashed into the same branch)

| ID | Fix |
| --- | --- |
| HT-07 | Draft tray: remove deletes on the server; submit success clears and re-hydrates; WYSIWYG semantics (checked = submitted, default all checked, button shows 提交审核（N 项）). |
| HT-08 | API mode never falls back to mock business data: `createApiInitialState()` boots empty slices; failed domain refresh purges the domain (`CLEAR_API_RUNTIME_DOMAIN`) and raises a persistent banner with retry. |
| HT-09 | Baseline/spec/module server failures project into the owning dialog (`actionError`, gate-changed vs generic); dialogs await success before closing and keep user input on failure. |
| HT-10 | Data honesty: fake sparkline branch deleted (sparse buckets render truthfully + 样本不足 note); dashboard queue verdict is earned from failure/stalled counts; `/logs` quality feedback actually calls `submitFeedback` with pending/inline-error states; unconsumed `prefillParameterValue` tool removed. |
| HT-11 | Destructive-action confirm matrix via shared `ConfirmDialog`: module delete/disband, withdraw round, archive log (+ archived view with restore, undo window 10s), close feedback, role change/deactivate (with platform-admin lock + self-lockout preflight), batch high-risk writes (single aggregated confirm, accurate written/skipped accounting); dirty-state guards on feedback dialog and both wizards (`unsavedParameterWorkCount` + `beforeunload`). |
| HT-12 | Approval card informed consent: renders AI reason, localized buttons (批准/拒绝), optional reject reason routed back; payload extension (current value/risk) remains coordinated with the approval-chain plan. |

## Merge history (for future archaeology)

`main` advanced ~240 commits across four sync merges while this branch was in review; the app-shell decomposition, app-runtime composition root, and the aesthetics dialog/toast/DataTable waves all landed mid-flight. Conflict-resolution policy was **main's structure + this plan's behavior**:

- Reducer fixes were re-applied in `src/application/state/appState.ts` after the reducer left `App.tsx`; `/logs` fixes were re-applied in `src/features/log-analysis/`.
- The wave-1 governance confirms were re-wired into main's `DataTable` columns on `/user-permissions`; the wave-1 dirty-close guards were re-wired through main's `ModalDialog` migration (`onDismiss → requestClose`), dropping duplicate window Escape listeners.
- `ModalDialog`'s Escape in-flight guard now uses **event identity** instead of timestamps (jsdom stamps epoch time while `performance.now()` is page-relative, which let one keydown dismiss the confirmation it had just opened).
- Single `--z-toast: 1350` and single approval token `--z-xiaoze-approval` (both branches had declared their own tiers).
- main's checking-state `AppShellSkeleton` replaced the wave-0 `ApiAuthCheckingScreen` (dead code removed); the wave-0 `unreachable` retry screen stays.
- main's mock-only notification bridge in `LogsPage` was removed in favor of the dual-runtime `AppToastLayer`.
- The duplicated migration prefix `0105` (two parallel workstreams) was resolved by renaming to `0106_log_domains.sql` (idempotent file), unblocking CI for every branch.

## Cross-workstream findings

- **Issue #333** (agent SSE emits `TEXT_MESSAGE_START` without `END` before `RUN_FINISHED`, so the approval card never renders): root cause was fixed on main by the approval-chain workstream (`fix(xiaoze): make the browser approval interrupt flow actually usable`), which independently confirmed the GOV-01 stacking diagnosis ("the scrim swallowed every Approve/Reject click"). End-to-end verification of the approval flow post-merge is tracked in the debt tracker.
- Visual quality baselines: the global toast is timing-dependent and must never enter a screenshot — `settleAppToasts()` now drains the queue before every visual snapshot; the linux `/parameter-admin` baseline was regenerated from the CI runner after main's seed drift (195 → 193 definitions).
- Browser acceptance: role change / feedback close now require explicit confirmation, and the toast close button was renamed 关闭提示 to avoid `getByRole(/通知/)` ambiguity; the topology acceptance stopped pinning a stale binding id (drafts re-target the binding's current id after the working tip advances).

## Documentation Impact Matrix — resolution

| Area | Files | Resolution |
| --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md` | No change (no architecture shift) |
| Planning docs | `docs/PLANS.md` | Updated (registered; moved to completed in the closeout PR) |
| Product specs | `docs/product-specs/prototype-functional-spec.md` | Reviewed — no change: the spec describes intended behavior; these fixes restore it (mock-mode contract unchanged) |
| Frontend docs | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Updated in the feature PR (toast layer, no-mock-fallback, draft-tray semantics, feedback persistence, archived view) |
| Design docs | `docs/design-docs/ui-design-system.md` | Reviewed — no change here: the `Toast` primitive is owned by aesthetics-uplift (`ToastProvider`); convergence of `ADD_NOTIFICATION` onto it is registered as debt |
| Quality/testing | `docs/design-docs/testing-strategy.md`, coverage maps | Deferred — new acceptance requirement ids for the approval-card flow were not added (adaptations only); registered as debt |
| Security/governance | `docs/SECURITY.md` | Reviewed — no change: the Agent write model (explicit human approval) is unchanged; this plan made the existing gate usable and informative |
| Reliability/runbooks | `docs/RELIABILITY.md` | Reviewed — no change: probe-retry behavior is a frontend resilience fix; backend health semantics unchanged |
| Generated artifacts | `docs/generated/db-schema.md` | Regenerated after the `0106` migration rename |
| Chinese companions | zh-CN plan + frontend docs | Updated |

## Deferred scope → `exec-plans/tech-debt-tracker.md`

Waves 2–3 (language/terminology sweep incl. AI Chinese output and audit-center productization, review batching, macOS shortcuts, deep links, a11y systemics, responsive convergence) plus the merge-produced items (toast convergence, approval z-token rule duplication, jsdom escape-guard test skip, approval-flow end-to-end verification, HDC hardware manual pass) are registered in the debt tracker.

## Verification evidence

- `npm test`: 2537 passed, 1 skipped (jsdom-specific escape-guard case, documented in-file) at merge time; `npm run build` green; `npm run docs:check` green.
- CI: Build and test green on the merge commit; the browser-acceptance failures remaining at merge time reproduce identically on `main`'s own CI (owned by the parallel workstream) and are tracked there.
- Live browser verification during implementation: toast visibility on forced API failure, rollback enablement after a simulator write, destructive confirms, wizard dirty-guards (evidence under `work/ui-checks/`).
