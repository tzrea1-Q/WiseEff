# Device Bridge CORS Bootstrap Fix

**Status:** Active (2026-06-27)

**Goal:** Eliminate the CORS bootstrap dead-loop that prevents a deployed web UI (non-loopback origin) from detecting a running-but-unpaired local Bridge, so install → connect → detect works reliably in production self-hosted deployments. Add network diagnostics and `webOrigin` hardening so the same flow survives restricted-network deployments.

**Source review:** Production incident on `https://tzrea1.com` (2026-06-26 → 2026-06-27). A standby Bridge returns `200 OK` from `http://127.0.0.1:18787/health` but emits no `Access-Control-Allow-Origin` header because `allowedOrigin` is sourced from `bridge.json`, which only exists after pairing. The browser blocks the read, the wizard stays on Step 1 ("未检测到本地 Bridge"), Step 1 renders no pairing entry point, and the user cannot obtain a pairing code through the UI. Local development never hit this because `http://localhost:5173` matches `isLoopbackOrigin` and is always allowed.

## Root Causes

| # | Defect | File | Impact |
| --- | --- | --- | --- |
| C1 | `resolveCorsOrigin` only allows loopback or entries in `allowedOrigin`; standby Bridge has no `allowedOrigin` | `packages/device-bridge/src/healthServer.ts` | Production web UI can never detect an unpaired Bridge |
| C2 | Step 1 renders only install downloads; `showPrimaryAction = viewStep === 2 \|\| viewStep === 3` | `src/components/LocalDeviceBridgeWizard.tsx` | Even when `createPairingCode()` runs under `missing_bridge`, the user cannot see or use it |
| C3 | `missing_bridge` collapses "fetch failed (CORS/network)" and "process not running" into one state | `src/components/bridgePanelStatus.ts` | Users who already installed Bridge get the same "请先安装" guidance |
| C4 | Bridge CLI `fetch` ignores `HTTPS_PROXY`/`HTTP_PROXY` and has no `--proxy` flag | `packages/device-bridge/src/connectCommand.ts`, `cli.ts` | In ICP-blocked / restricted networks the CLI cannot reach `serverUrl` and pairing fails opaquely |
| C5 | `webOrigin` is optional in `BridgeConfig` and `buildBridgeConnectUrl`; CLI `pair` without `--webOrigin` writes no `webOrigin` | `packages/device-bridge/src/config.ts`, `connectCommand.ts` | Silent CORS failure after a successful pair |
| C6 | `ensureBridgeRunning` returns early when `health.connected === true`; does not restart when `webOrigin` changes and health listener was already stopped | `packages/device-bridge/src/ensureBridgeRunning.ts` | Updated `webOrigin` may not take effect without manual kill |

## Git & PR Workflow

All implementation for this plan follows the repository branch → review → PR → merge rule (see `docs/PLANS.md`).

| Role | Responsibility |
| --- | --- |
| Implementation agent (subagent) | Checkout feature branch from latest `main`, implement Steps 1–7, run verification, **local commits on branch only** |
| Parent agent (architect) | Review diff and verification output, create GitHub PR, merge PR, fast-forward **local** `main` |

**Branch for this plan:** `fix/device-bridge-cors-bootstrap` (from `origin/main`).

**Subagent must not:** push to `main`, open GitHub PRs, merge PRs, or update local `main`.

**Subagent start commands:**

```bash
git fetch origin main
git checkout main && git pull origin main
git checkout -b fix/device-bridge-cors-bootstrap
```

**Parent agent after review:**

```bash
gh pr create … && gh pr merge …
git checkout main && git pull origin main
```

## Task Sequence

| Step | Task | Priority | Primary files |
| --- | --- | --- | --- |
| 1 | Health endpoint allows any browser origin for read-only `/health` | P0 | `packages/device-bridge/src/healthServer.ts`, tests |
| 2 | Step 1 exposes a "已安装？点这里配对" entry point | P0 | `src/components/LocalDeviceBridgeWizard.tsx`, `src/NodeDebuggingPage.tsx`, tests |
| 3 | Distinguish "fetch failed" from "process absent" in panel status | P1 | `src/components/bridgePanelStatus.ts`, `src/infrastructure/http/bridgeConnectLauncher.ts`, tests |
| 4 | Bridge CLI honors `HTTPS_PROXY`/`HTTP_PROXY` and adds `--proxy` | P1 | `packages/device-bridge/src/connectCommand.ts`, `cli.ts`, `wsClient.ts`, tests |
| 5 | `webOrigin` defaults to `serverUrl` origin when not explicitly provided | P2 | `packages/device-bridge/src/connectCommand.ts`, `config.ts`, tests |
| 6 | `ensureBridgeRunning` restarts Bridge when `webOrigin` changes | P2 | `packages/device-bridge/src/ensureBridgeRunning.ts`, `connectCommand.ts`, tests |
| 7 | Acceptance + docs + runbook + manifest rebuild | P3 | `e2e/acceptance/local-device-bridge.acceptance.spec.ts`, `docs/runbooks/local-device-bridge.md`, `packages/device-bridge/bridge-artifacts`, tests |

**Execution rule:** Run tasks in order. Do not start the next task until the current task's verification passes. Steps 1 and 2 may be implemented together because they are tightly coupled and share the same verification scenario.

---

## Step 1 — Health endpoint CORS for any browser origin

**Problem:** `resolveCorsOrigin` requires either a loopback origin or a match against `allowedOrigin`. The standby (unpaired) Bridge has no `allowedOrigin`, so any non-loopback web origin is blocked. This makes "detect whether a Bridge is running" depend on "Bridge is already paired", which is a paradox.

**Security note:** `/health` is a public, unauthenticated endpoint. Its payload contains only `paired`, `connected`, `bridgeId`, `serverUrl`, `tokenExpiresAt`, `lastError`, `tools`, `toolsInstall`, and `updatedAt`. It does not contain `bridgeToken`, secrets, or device data. Allowing any browser origin to read it does not widen the trust boundary: the same information is already readable by any local process, and the WebSocket + RPC path still requires the bridge token. The existing `allowedOrigin` mechanism stays in place for `/tools/install` (the only mutating endpoint on the health server).

**Done when:**

- `resolveCorsOrigin` returns the request `Origin` for `GET /health` and `OPTIONS /health` regardless of `allowedOrigin`, while `/tools/install` continues to enforce `allowedOrigin`.
- Implementation approach: split CORS policy by path. `/health` uses an open CORS policy (reflect origin, `Vary: Origin`); `/tools/install` keeps the current `allowedOrigin` check.
- `Access-Control-Allow-Methods: GET, OPTIONS` and `Access-Control-Allow-Headers` remain minimal.
- New unit tests in `packages/device-bridge/src/healthServer.test.ts`:
  - `standby Bridge (no allowedOrigin) returns ACAO for https://example.com origin`
  - `paired Bridge still returns ACAO for arbitrary origin on /health`
  - `/tools/install POST without matching allowedOrigin has no ACAO`
  - `/tools/install OPTIONS without matching allowedOrigin has no ACAO`
- Existing tests for loopback and `allowedOrigin` matching continue to pass.

**Verification:**

```bash
npm run test:bridge -- healthServer
```

---

## Step 2 — Step 1 pairing entry point

**Problem:** `LocalDeviceBridgeWizard` renders the primary action button only when `viewStep === 2 || viewStep === 3`. When `panelStatus === "missing_bridge"` the wizard forces `viewStep = 1` and shows only installer downloads, so a user who already installed Bridge and started it in standby cannot reach the pairing flow.

**Done when:**

- Step 1 shows a secondary entry point: "已安装 Bridge？点这里继续配对" when `panelStatus === "missing_bridge"` and either `bridges.length > 0` or the user clicks the entry. Clicking it sets `viewStep = 2` without requiring `naturalStep` to advance (bypasses `goToStep` guard).
- The entry point is rendered below the install catalog and is keyboard-accessible (`<button type="button">`).
- When the user navigates to Step 2 from this entry, the existing pairing-code generation (`createPairingCode()` in `NodeDebuggingPage.tsx`) is already triggered because `panelStatus` is `missing_bridge` or `not_paired`, so the code is ready.
- The connect button on Step 2 works for `missing_bridge` by issuing a `wiseeff-bridge://connect?server=...&webOrigin=...&code=...` URL (same as `not_paired`), since the Bridge is running in standby and the URL scheme will invoke `runConnectCommand` with the pairing code.
- New tests in `src/components/LocalDeviceBridgeWizard.test.tsx`:
  - `Step 1 renders "已安装 Bridge" entry when panelStatus is missing_bridge`
  - `Clicking the entry advances to Step 2 without requiring naturalStep > 1`
  - `Step 2 connect button invokes onConnect with a pairing code URL when panelStatus is missing_bridge`

**Verification:**

```bash
npm test -- LocalDeviceBridgeWizard
npm run build
```

---

## Step 3 — Distinguish fetch-failed from process-absent

**Problem:** `probeLocalBridgeHealth` catches all errors and returns `null`, which `deriveBridgePanelStatus` maps to `missing_bridge` (when `bridgeCount === 0`) or `not_running`. A CORS-blocked standby Bridge and a truly absent Bridge are indistinguishable, so the user always sees "请先安装".

**Done when:**

- `probeLocalBridgeHealth` returns a discriminated result: `{ kind: "reachable"; health } | { kind: "cors-blocked"; status: number } | { kind: "unreachable" }` instead of `null`.
- `deriveBridgePanelStatus` consumes the new result:
  - `reachable` + `paired: false` → `not_paired`
  - `cors-blocked` → new status `bridge_blocked` (status hint: "检测到 Bridge 但浏览器被阻止读取，请确认 Bridge 已配对到此站点，或点击下方按钮重新配对")
  - `unreachable` → `missing_bridge` or `not_running` (as before)
- `LocalDeviceBridgeWizard` renders the `bridge_blocked` hint on Step 1 with the same "已安装？点这里配对" entry from Step 2.
- `BridgePanelStatus` type adds `bridge_blocked`; `deriveWizardStep` maps it to `1`; `bridgePanelStatusHint` returns the new copy.
- Tests updated in `src/components/bridgePanelStatus.test.ts` and `src/infrastructure/http/bridgeConnectLauncher.test.ts`.

**Verification:**

```bash
npm test -- bridgePanelStatus bridgeConnectLauncher
npm run build
```

---

## Step 4 — Bridge CLI proxy support

**Problem:** Node `fetch` does not honor `HTTPS_PROXY`/`HTTP_PROXY` by default, and the CLI has no `--proxy` flag. In ICP-blocked or restricted networks the Bridge CLI cannot reach `serverUrl` and pairing fails with an opaque network error.

**Done when:**

- `runPairCommand` and the WebSocket client accept an optional `proxyAgent` injected via CLI dependencies.
- `cli.ts` reads `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` from `process.env` and constructs a proxy agent (use `undici`'s `ProxyAgent` or equivalent already in the dependency tree; do not add a new dependency unless required).
- `--proxy <url>` flag overrides env vars for `pair` and `connect` commands.
- WebSocket connection (`createBridgeWsClient`) uses the same proxy agent for `wss://` connections.
- New tests cover: env-var proxy, `--proxy` override, and no-proxy baseline.
- Runbook documents the env vars and `--proxy` flag.

**Verification:**

```bash
npm run test:bridge -- connectCommand wsClient cli
```

---

## Step 5 — `webOrigin` defaults to `serverUrl` origin

**Problem:** `webOrigin` is optional in `BridgeConfig` and `buildBridgeConnectUrl`. If the caller omits it (CLI `pair` without `--webOrigin`, or a URL scheme without the `webOrigin` query param), the Bridge writes no `webOrigin` and CORS will never match the deployed web origin even after a successful pair.

**Done when:**

- `runPairCommand` and `runConnectCommand`: when `webOrigin` is not provided, default it to the origin of `normalizedServerUrl` (e.g. `https://tzrea1.com` for `serverUrl = https://tzrea1.com`).
- `buildBridgeConnectUrl` (frontend) already derives `webOrigin` from `resolveBridgeWebOrigin()`; keep that behavior but document that the CLI default mirrors it.
- `BridgeConfig.webOrigin` stays optional for backward compatibility with existing configs, but new pairs always write it.
- A migration helper reads existing `bridge.json` files lacking `webOrigin` and back-fills from `serverUrl` origin on `start`.
- Tests cover: pair without `--webOrigin` writes derived origin; connect without `webOrigin` writes derived origin; start back-fills missing `webOrigin`.

**Verification:**

```bash
npm run test:bridge -- connectCommand config
```

---

## Step 6 — Restart Bridge when `webOrigin` changes

**Problem:** `ensureBridgeRunning` returns early when `health.connected === true`. `runConnectCommand` calls `stopLocalBridgeHealthListener` when `webOrigin` changes, but that only stops the health listener, not the WebSocket client. The Bridge may keep running with the old `webOrigin` and never pick up the new CORS policy.

**Done when:**

- `runConnectCommand` tracks the previous `webOrigin` and, when it changes, fully restarts the Bridge process (stop health listener + stop WS client + spawn a new `start`) instead of relying on `ensureBridgeRunning`'s early return.
- `ensureBridgeRunning` accepts an optional `forceRestart` flag used by `connect` when config changed.
- Tests cover: `webOrigin` change triggers full restart; no change does not restart; token-only refresh does not restart.

**Verification:**

```bash
npm run test:bridge -- ensureBridgeRunning connectCommand
```

---

## Step 7 — Acceptance, docs, runbook, manifest

**Done when:**

- `e2e/acceptance/local-device-bridge.acceptance.spec.ts` adds a scenario that serves the health server with a non-loopback `Origin` header (e.g. `https://wiseeff.example.com`) and asserts `Access-Control-Allow-Origin` is present for `/health` while absent for `/tools/install` without matching `allowedOrigin`.
- `docs/runbooks/local-device-bridge.md` and `docs/zh-CN/runbooks/local-device-bridge.md` updated with:
  - The CORS bootstrap behavior and why `/health` is open.
  - Proxy env vars and `--proxy` flag for restricted networks.
  - The "已安装？点这里配对" entry point on Step 1.
  - `webOrigin` defaulting behavior.
- `docs/design-docs/full-stack-architecture.md` and `docs/zh-CN/design-docs/full-stack-architecture.md` note the open CORS policy on the Bridge health endpoint and the security rationale (health is public read-only; mutating endpoints still require `allowedOrigin`).
- Bridge portable artifacts and installers rebuilt via `npm run bridge:build` and `npm run build:bridge:installers`; `ops/self-hosted/bridge-artifacts/0.1.0/manifest.json` SHA256 updated; version bumped to `0.1.1` (or next patch) because the Bridge binary changes.
- `npm run docs:check` passes.
- `npm run build` passes.
- `npm run test:bridge` passes.
- `npm test -- LocalDeviceBridgeWizard bridgePanelStatus bridgeConnectLauncher` passes.
- `npm run acceptance:coverage` passes (or explicitly documents the new non-blocking `BRIDGE-CORS-001` marker as deferred when no real bridge runtime is available in CI).

**Verification:**

```bash
npm run test:bridge
npm test -- LocalDeviceBridgeWizard bridgePanelStatus bridgeConnectLauncher
npm run build
npm run docs:check
npm run acceptance:coverage
```

---

## Acceptance Coverage Impact

| ID | Status | Change |
| --- | --- | --- |
| `BRIDGE-WIN-001` | Existing (non-blocking) | Review: the Windows-first bridge panel scenario is unaffected; add a sibling non-blocking marker `BRIDGE-CORS-001` for the non-loopback CORS acceptance scenario in Step 7. |
| `BRIDGE-TOOLS-001` | Existing (non-blocking) | No change: tools-missing copy path is unaffected. |
| `BRIDGE-CORS-001` | New (non-blocking) | Add to `docs/developer/browser-acceptance-coverage-map.md`: "Deployed-origin web UI can detect a standby Bridge via `/health` CORS; `/tools/install` still requires matched `allowedOrigin`." Spec: `e2e/acceptance/local-device-bridge.acceptance.spec.ts`. |

Operation matrix entries in `e2e/acceptance/operationMatrix.ts` for `/node-debugging` are reviewed and unchanged unless Step 2 changes the operation action text, in which case the operation ID notes are updated.

---

## Documentation Impact Matrix

| Area | File | Mark | Notes |
| --- | --- | --- | --- |
| Repository map | `AGENTS.md` | No change | No new top-level map entry. |
| Architecture | `ARCHITECTURE.md` | Review | Confirm Bridge health CORS is not described as origin-restricted; no edit expected. |
| Architecture | `docs/design-docs/full-stack-architecture.md` | Update | Add note: Bridge `/health` uses open CORS; `/tools/install` keeps `allowedOrigin`. |
| Architecture (zh) | `docs/zh-CN/design-docs/full-stack-architecture.md` | Update | Mirror English change. |
| Frontend | `docs/FRONTEND.md` | Review | Confirm no origin-restriction claim for Bridge health; no edit expected. |
| Frontend (zh) | `docs/zh-CN/frontend.md` | Review | Mirror English review. |
| Runbooks | `docs/runbooks/local-device-bridge.md` | Update | Add CORS rationale, proxy env vars, `--proxy`, Step 1 entry point, `webOrigin` default. |
| Runbooks (zh) | `docs/zh-CN/runbooks/local-device-bridge.md` | Update | Mirror English change. |
| Security | `docs/SECURITY.md` | Review | Confirm `/health` payload classification is unchanged and open CORS does not expose secrets; add one line if the open CORS policy is a security-relevant decision. |
| Security (zh) | `docs/zh-CN/SECURITY.md` | Review | Mirror English review. |
| API contract | `docs/design-docs/api-contract.md` | No change | Bridge health is not part of the HTTP API contract. |
| Quality | `docs/QUALITY_SCORE.md` | Review | Update score note if Bridge CORS coverage improves the score; no edit expected. |
| Coverage map | `docs/developer/browser-acceptance-coverage-map.md` | Update | Add `BRIDGE-CORS-001`. |
| Coverage map (zh) | `docs/zh-CN/developer/browser-acceptance-coverage-map.md` | Update | Add `BRIDGE-CORS-001`. |
| Operation matrix | `docs/developer/user-operation-coverage-matrix.md` | Review | Confirm `/node-debugging` operation entries still match; update only if Step 2 changes action text. |
| Operation matrix (zh) | `docs/zh-CN/developer/user-operation-coverage-matrix.md` | Review | Mirror English review. |
| Env vars | `docs/developer/environment-variables.md` | No change | Bridge CLI proxy uses standard env vars; no new WiseEff env var. |
| Self-hosted | `ops/self-hosted/README.md` | Review | Confirm no Caddy change needed; no edit expected. |
| Self-hosted (zh) | `ops/self-hosted/README.zh-CN.md` | Review | Mirror English review. |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Update | Add `TD-032` for "Bridge CLI proxy support is env-var based; no PAC file support" if Step 4 does not cover PAC. |
| Tech debt (zh) | `docs/zh-CN/exec-plans/tech-debt-tracker.md` | Update | Mirror English change. |
| Plan index | `docs/PLANS.md` | Update | Add this plan to Current Active Plan. |
| Plan index (zh) | `docs/zh-CN/PLANS.md` | Update | Mirror English change. |

## Documentation Update Gate

This plan cannot be moved to `completed/` until every `Update` or `Review` row above has either been updated or explicitly recorded as unchanged with evidence. Any deferred work must be added to `docs/exec-plans/tech-debt-tracker.md`. Run `npm run docs:check` before marking the plan complete.

---

## Out of Scope

- ICP filing / DNSPod blocking of the production domain (operational, not code).
- Replacing the `wiseeff-bridge://` URL scheme with a more reliable IPC mechanism.
- Auto-detecting the system proxy via macOS system configuration (Step 4 covers env vars + `--proxy` only).
- Back-filling `webOrigin` for Bridge configs created before this fix on remote user machines without user interaction (Step 5 back-fills on `start`).
- Changing the `Bridge` token auth model or the WebSocket protocol.

## Risks

| Risk | Mitigation |
| --- | --- |
| Open CORS on `/health` is seen as a security regression | Document that `/health` is public read-only and mutating endpoints still enforce `allowedOrigin`; coordinate with `docs/SECURITY.md` review. |
| Step 2 entry point lets users trigger pairing before Bridge is installed | Entry point only advances `viewStep`; it does not bypass Bridge detection. If Bridge is truly absent, `pollLocalBridgeHealth` will time out and show the existing 30s error. |
| Proxy agent dependency bloat | Prefer `undici` (already in Node 18+ global fetch) over a new dependency. |
| `webOrigin` default from `serverUrl` is wrong when API and web UI origins differ | Keep explicit `--webOrigin` and URL-scheme `webOrigin` param as override; default is a fallback, not a replacement. |
| Manifest/SHA bump requires installer rebuild on all platforms | Scope Step 7 to rebuild Mac + Windows; note Linux portable if present. |
