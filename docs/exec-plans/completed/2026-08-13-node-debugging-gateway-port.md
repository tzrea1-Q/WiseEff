# Route NodeDebuggingPage through the DebuggingGateway port

> Status: **Completed** (merged via PR #423 on 2026-08-13). Documentation gate closed 2026-08-17.
> Date: 2026-08-13
> Branch: `refactor/node-debugging-gateway-port`

## Goal

Remove the last page-level seam that bypasses both the application port and the shared HTTP client: `src/NodeDebuggingPage.tsx` imported behavior from `src/hdcClient.ts` (three raw `fetch("/api/hdc/…")` calls — no auth header, no error envelope, no runtime-mode seam, and a hardcoded "ADB requires API mode" throw) while importing only types from `src/application/ports/DebuggingGateway.ts`. Apply the merged dts-reload precedent (PR #372): port + `resolve*` runtime helper + mock adapter restoring ADR-0002 parity.

## Non-goals

- `server/**`, `packages/**`, other pages/features, and dialog primitives (TD-084 belongs to the ui-primitives stream).
- Productizing the Vite local-HDC dev middleware (`viteHdcApi.ts`). It stays as a curl-level experiment tool without a frontend consumer (the mock-gap program already ruled it out as a production seam); deleting it is a possible follow-up, not this plan.
- Changing API-mode payloads or behavior. The HTTP adapter (`createHttpDebuggingGateway`) is untouched.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `refactor/node-debugging-gateway-port`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `refactor/node-debugging-gateway-port`, checked out from `origin/main`.

## Tasks

1. **Mock adapter** `src/infrastructure/mock/mockDebuggingGateway.ts`: full `DebuggingGateway` port with one seeded device story (paired Mock Bridge, multi-protocol Aurora device, device-side value drifts, honest read/write/readback, write snapshots feeding rollback, `confirm-high-risk-write` / `confirm-rollback` token gates mirroring the server), plus `createMockDebuggingBridgeSeams()` so the bridge panel is walkable without HTTP. Contract test per the `mockDtsReloadRepository` precedent.
2. **Resolver** `src/application/debugging/debuggingGatewayRuntime.ts`: `resolveDebuggingGateway(runtimeMode)` following the existing `resolve*` pattern; wired once in `createAppRuntime` (mock mode passes the live prototype-state debug-parameter accessor).
3. **Runtime seam**: `createDebuggingRuntimeActions` branches `detectAndStartSession` / `readNode` / `writeNode` / `rollbackSnapshot` on gateway presence instead of runtime mode (legacy reducer verbs for the unrouted `DebuggingPage` unchanged).
4. **Page**: delete the `hdcClient.ts` fallback branches and the "ADB requires API mode" throw; `debuggingActions` becomes required; bridge-panel/health-probe seams become injectable props (`bridges`, `probeBridgeHealth`, `createBridgePairingCode`) with HTTP defaults.
5. **Shell**: `routes.tsx` passes `debuggingActions` unconditionally and injects cached mock bridge seams in mock mode (same pattern as `/dts-reload`).
6. Delete `src/hdcClient.ts` + `src/hdcClient.test.ts`; adapt `NodeDebuggingPage.test.tsx` / `App.test.tsx` / `appRuntime.test.ts` setup and injection.
7. Documentation: FRONTEND EN/zh Debugging Gateway section; this plan; PLANS index row.

## Success criteria

- `rg "hdcClient" src/` returns nothing; no `fetch("/api/hdc/…")` in `src/`.
- `/node-debugging` in mock mode walks detect → auto-read → stash/write (with high-risk confirmation) → rollback against the seeded story, browser-verified at 1440x900 / 768x1024 / 390x844 with a clean console.
- API-mode wire behavior unchanged: `createHttpDebuggingGateway` and its tests untouched; page test assertions preserved (setup/injection adapted only).
- `npx tsc -b` clean, `npm run build` exit 0, targeted suites green, `npm run docs:check` green.

## UI Interaction Automation Review

Mock-mode-only behavior gain; API-mode interaction behavior is unchanged. Existing coverage stays authoritative:

- `DEBUG-SIM-001` / `DEBUG-PERM-001` (`e2e/acceptance/debugging-simulator.acceptance.spec.ts`) cover the API-mode read/write/mismatch/rollback/permission paths and still pass unchanged semantics.
- `BRIDGE-TOOLS-001` stays mapped to `src/NodeDebuggingPage.test.tsx` (test retained).
- The new mock story is component-test covered (`mockDebuggingGateway.test.ts`, adapted `NodeDebuggingPage.test.tsx` mock-mode suite); no new acceptance requirement ID is needed because no API-mode user operation changed.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | No change | `AGENTS.md`, `ARCHITECTURE.md` — seam names unchanged at map granularity |
| Planning | Update | This plan; `docs/PLANS.md` active index row (zh plan companion not created — refactor plan per `2026-08-12-app-shell-decomposition` precedent; the Chinese developer-facing change lands in `docs/zh-CN/frontend.md`) |
| Product specs | No change | No product wording references the local-HDC fallback |
| Architecture | No change | Port/adapter layering already documented; this change conforms to it |
| Frontend / design | Update | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` Debugging Gateway runtime split (mock adapter, resolver, hdcClient deletion, ADR-0002 restoration note) |
| Domain / ADR | No change | ADR-0002 already states the decision; FRONTEND cites "restored 2026-08-13" like the dts-reload precedent — no new ADR |
| Quality / testing | Review | `docs/developer/browser-acceptance-coverage-map.md` — `BRIDGE-TOOLS-001` still maps to the retained test; no ID retarget needed |
| Reliability / runbooks | No change | No operational procedure references `/api/hdc/*` |
| Security | No change | Confirmation-token gates unchanged; mock now mirrors them |
| Generated artifacts | No change | No schema or OpenAPI impact |
| References | No change | No reference note covers the hdc fallback |
| Tech debt | Review | `docs/exec-plans/tech-debt-tracker.md` + zh twin — searched: no TD row covers the hdcClient bypass (TD-015 closed, TD-100 is hardware-evidence debt); no row added or edited |

## Documentation Update Gate

- [x] FRONTEND EN + zh describe the resolver, mock adapter story, bridge seams, and hdcClient deletion
- [x] `docs/PLANS.md` lists this completed plan
- [x] Tech-debt tracker searched for a covering TD row — none exists; recorded above with evidence
- [x] Acceptance coverage map reviewed — `BRIDGE-TOOLS-001` mapping still valid, no retarget
- [x] `npm run docs:check` green before moving this plan to `completed/`
