# DTS Reload Run Session — page decomposition + mock-mode parity (TD-069, ADR-0002)

- **Status:** **Completed 2026-08-13** — PR [#372](https://github.com/tzrea1-Q/WiseEff/pull/372) merged; TD-069 closed in the tracker.
- **Branch:** `refactor/dts-reload-run-session` (from `main` @ `ccefe11b`)
- **Owner:** Frontend / Debugging platform
- **Scope source:** 2026-08-12 architecture review **candidate 5**, aligned with **TD-069** (tracked split of `src/features/dts-reload/DtsReloadPage.tsx`) and **ADR-0002** (mock runtime serves the same semantic model through the same ports — previously violated because `DtsReloadRepository` had no mock adapter and mock mode rendered a static "unavailable" page).

## Goal

Split the 2,597-line `DtsReloadPage.tsx` along the repo's deep-module session precedent (`docs/FRONTEND.md` § Workbench sessions; `structuredEditSession.ts`) without changing any API-mode behavior, and restore ADR-0002 for the parameter-debugging surface by giving `DtsReloadRepository` a mock adapter plus runtime selection.

## Deliverables (one branch, separate commits)

1. **Domain extraction — `src/domain/dtsReload/debugValue.ts`** (`4fd22a06`)
   - Moves the pure validation logic out of the page: cell-integer parsing (angle-bracket, bare, `[..]` byte-string forms), phandle-cell-group parsing, quoted-string/string-list detection, and the constraint check, exported as `validateDebugValue(raw, candidate)`. `hasMeaningfulDebugChange` joins the module (re-exported from the edit dialog for existing import sites).
   - Table-driven unit tests (`debugValue.test.ts`, 63 cases) cover every supported value shape (u32 / `/bits/ 8` / `/bits/ 16` cells, single strings, string lists, GPIO-style phandle cells), malformed inputs, and boundary widths — this code guards values written to physical hardware and previously had zero direct coverage.

2. **Session extraction — `src/application/dts-reload/`** (`8a9071f4`)
   - `dtsReloadRunSession.ts`: framework-free `createDtsReloadRunSession()` (snapshot + `subscribe`/`getSnapshot` + command verbs, narrow `Pick<DtsReloadRepository, …>` per method, injectable URL seams). Owns candidate loading, run-id-in-URL rehydration, reload-batch editing/validation, run start, the deploy confirmation flow, restore-baseline, deploy-target state (bridge/target/protocol/device), and run/history/residue loading with pagination.
   - Token invariants: `confirm-dts-reload` is attached in exactly one place — the explicit `confirmDeploy` command; `confirm-sensitive-reload` only after the explicit critical confirmations (`setCriticalConfirmed` / `setRestoreCriticalConfirmed`). `dtsReloadRunSession.test.ts` asserts both against exact repository payloads (including that no `startRun`/`restoreBaseline` payload ever carries the deploy token and non-sensitive payloads omit the `confirmationToken` key entirely).
   - `useDtsReloadRunSession.ts`: thin `useSyncExternalStore` adapter. The page becomes a rendering layer (2,597 → 917 lines); presentation-only helpers and display components move to colocated `dtsReloadPresentation.tsx`. The quarantined `uiPreview` DEV fixtures are deleted (the mock adapter replaces them).

3. **Mock adapter + runtime selection** (`1a08893f`, `5821cc0e`)
   - `src/infrastructure/mock/mockDtsReloadRepository.ts`: full `DtsReloadRepository` port with a seeded, stateful device story — candidates across all supported value shapes plus honest blocked rows and both sensitive tiers, a completable run lifecycle (validated → deploy → verified with reload-snapshot evidence), keyset-cursor run history that paginates past 10 items, and residue bookkeeping that restore-baseline deploys clear. The mock mirrors the server gates (deploy refuses without `confirm-dts-reload`; critical-sensitive start/restore refuse without `confirm-sensitive-reload`). Contract test follows `mockDtsStructuredRepository.test.ts` and cross-checks every seeded baseline against `validateDebugValue`.
   - `src/application/dts-reload/dtsReloadRuntime.ts`: `resolveDtsReloadRepository(mode)` on the `dtsStructuredRuntime` pattern; App's existing dts-reload `useMemo` now resolves it for both runtimes and mock mode may start runs.
   - The page's `repository` prop drops its `| null` arm and the mock-unavailable branch is deleted; `/dts-reload` in mock mode gets stable mock bridge/target/pairing-code seams so the deploy flow is walkable without hardware. **Mock-mode behavior gain is intentional (ADR-0002 restoration).**

## Constraints honored

- API-mode pixel-and-payload identical: no HTTP payload or call-sequence change (ADR-0019/0020 untouched); all 90 pre-existing `DtsReloadPage.test.tsx` tests pass with unweakened assertions (the only removed test asserted the deleted mock-unavailable branch).
- No changes under `server/**` or `packages/**`. The only shared-component edit is an additive optional `createPairingCode` seam on `LocalDeviceBridgePanel` (default = HTTP client; API mode unchanged) so mock mode does not hit the absent API.
- TD-069 spirit: dedicated refactor; no bundled behavior changes beyond the documented mock-mode restoration.

## UI Interaction Automation review

API-mode interaction behavior is unchanged, so existing browser acceptance automation still covers this surface: requirement/operation IDs `DTS-RELOAD-DEPLOY-001`, `DTS-RELOAD-KERNEL-001`, `DTS-RELOAD-VERIFY-001`, `DTS-RELOAD-RESIDUE-001`, `DTS-RELOAD-DEPLOY-HW-001` in `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts` (see `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md`); the suite runs in API mode and its evidence generation is untouched. The mock-mode gain is a runtime data-source substitution (ADR-0002), covered by the mock contract test, the session unit tests, and the manual playwright-cli verification below; no new requirement ID is needed because no API-mode operation changed.

## Verification evidence

- `npx tsc -b` → exit 0; `npm run build` → exit 0.
- `npm test -- run src/features/dts-reload src/application/dts-reload src/domain/dtsReload src/App.test src/infrastructure/mock/mockDtsReloadRepository.test.ts src/permissionRouting.test.tsx` → green (machine-load note: one long page test needs `--testTimeout` above the 5s default under parallel agent load; it also times out on unmodified `main`).
- Browser verification (mock mode, `playwright-cli`, `VITE_WISEEFF_RUNTIME_MODE=mock`): `/dts-reload` at 1440×900 / 768×1024 / 390×844, snapshot + screenshot each (`work/ui-checks/dts-reload-session-*.png`); exercised candidate selection, invalid (`<99999>` → max-constraint alert) and valid (`<7000>`) debug values, run start, the deploy confirm dialog (payload token via explicit confirm), restore-baseline chain, edit sheet, history open + load-more. `console error` clean at every checkpoint.
- Findings fixed during verification (`5821cc0e`): bridge-panel pairing-code prefetch hitting the absent API in mock mode; mock history offset-cursor duplicating rows across pages.
- Pre-existing defects found, out of scope here: `ConfirmDialog`/`ModalDialog` content taller than the viewport leaves the footer unreachable by mouse at 1440×900 (restore-purpose deploy confirmation with residue + overlay source) — recorded as **TD-084** (drafted here as TD-083 before the knowledge-base program claimed that number on `main`); minor mobile card overflow on the candidates table (aesthetics program owns page-defect waves).

## Documentation Impact Matrix

| Area | Path | Action | Notes |
| --- | --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md` | No change | Directory shape unchanged; new modules follow existing layer map. |
| Planning docs | `docs/PLANS.md` | Update | Active-plan entry added. |
| Planning docs | `docs/exec-plans/tech-debt-tracker.md` | Update | TD-069 progress note (row kept); TD-083 added (confirm-dialog overflow). |
| Planning docs (zh) | `docs/zh-CN/exec-plans/tech-debt-tracker.md` | Update | Same TD-069 note + TD-083 in Chinese. |
| Product specs | `docs/product-specs/**` | No change | Product behavior of the API surface unchanged; mock mode is a runtime substitution, not a product variant (ADR-0002). |
| Architecture docs | `docs/design-docs/**`, `docs/adr/**` | No change | ADR-0002 already states the decision this restores; ADR-0019/0020 constraints untouched. `CONTEXT.md` terms unchanged. |
| Quality/testing docs | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md` | No change | New tests follow the documented session/contract-test patterns. |
| Reliability/runbooks | `docs/RELIABILITY.md`, `docs/runbooks/**` | No change | No deploy/ops behavior change. |
| Security/governance | `docs/SECURITY.md`, `docs/security/**` | No change | Token gates unchanged server-side; client attaches them in the same requests (now asserted by session tests). |
| Frontend/design docs | `docs/FRONTEND.md` | Update | `/dts-reload` section: mock parity, session/domain/mock module pointers, TD-069 progress. |
| Frontend/design docs (zh) | `docs/zh-CN/frontend.md` | Update | Same section in Chinese. |
| Generated artifacts | `docs/generated/**` | No change | No schema change. |
| References | `docs/references/**` | No change | API contract unchanged. |
| Acceptance/coverage docs | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` | No change | IDs and automation unchanged (see UI Interaction Automation review). |

## Documentation Update Gate

- [x] `docs/PLANS.md` active entry added.
- [x] `docs/exec-plans/tech-debt-tracker.md` TD-069 progress note + TD-083.
- [x] `docs/zh-CN/exec-plans/tech-debt-tracker.md` TD-069 progress note + TD-083.
- [x] `docs/FRONTEND.md` `/dts-reload` section updated.
- [x] `docs/zh-CN/frontend.md` `/dts-reload` section updated.
- [x] All `No change` rows reviewed with reasons recorded above.
- [x] `npm run docs:check` green after updates.

## Git & PR Workflow

Feature branch `refactor/dts-reload-run-session` from `main`. Implementation agent commits on the branch only; the parent agent reviews, opens the PR, merges, and syncs local `main` (see `docs/PLANS.md` § Git Branch & PR Workflow). Commits:

1. `refactor(dts-reload): extract debug-value validation into domain module`
2. `refactor(dts-reload): extract run-session state machine from DtsReloadPage`
3. `feat(dts-reload): mock repository adapter restores mock-mode parity (ADR-0002)`
4. `fix(dts-reload): repair two mock-mode findings from browser verification`
5. `docs(dts-reload): …` (this plan + tracker + frontend docs)
