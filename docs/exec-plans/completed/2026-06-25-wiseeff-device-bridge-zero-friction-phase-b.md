# WiseEff Device Bridge Zero-Friction — Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan step-by-step in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Phase A (install → connect → USB detect), eliminate the remaining “I installed Bridge but detect still fails” confusion by surfacing **missing ADB/HDC** clearly and letting users **one-click install tools into a private WiseEff directory** without terminal or system PATH changes.

**Architecture:** Extend local health + RPC tool resolution so Bridge probes `adb`/`hdc` at startup and on demand, exposes results on `GET /127.0.0.1:18787/health`, and wires `createRpcHandlers()` to prefer managed binaries under `%LOCALAPPDATA%\WiseEff\tools\` (Windows) or `~/Library/Application Support/WiseEff/tools/` (macOS). Ship same-origin **tool release manifests** (like bridge artifacts) and a Bridge `tools install` command invoked from the web via URL scheme. Frontend wizard Step ③ gains a **tools readiness** sub-state before detect.

**Tech Stack:** TypeScript, Node 22, esbuild, React/Vite, Vitest, existing `@wiseeff/device-command-core` runners, optional Playwright acceptance extension.

**Prerequisite:** Phase A + Phase A fixes merged on `main` (PR #100, #103).

---

## Source Spec

- `docs/zh-CN/superpowers/specs/2026-06-24-device-bridge-zero-friction-design.md` — § Phase B (B1/B2)
- Baseline: `packages/device-bridge` RPC (`bridge.getCapabilities`), health server, `/node-debugging` wizard

## Scope

### In scope (Phase B = B1 + B2)

| Sub-phase | Deliverable |
| --- | --- |
| **B1** | Health exposes `tools.adb` / `tools.hdc`; frontend distinguishes “Bridge OK, tools missing” from “no device”; detect errors mapped to tool-missing |
| **B2** | Same-origin tool artifact manifest + download/extract to private dir; `wiseeff-bridge tools install`; web **一键安装调试工具** via URL scheme; RPC uses managed binaries |
| **Docs/tests** | Runbook, frontend docs, unit tests, browser acceptance ID update |

### Out of scope (Phase C / later)

- Bundling adb/hdc inside Bridge installer (design B3)
- Auto-update for Bridge or tools
- Linux graphical tool installer UX (CLI `tools install` OK)
- Code signing / notarization automation
- Changing pairing/token security model
- Server-side adb/hdc execution changes

---

## Git & PR Workflow

| Role | Responsibility |
| --- | --- |
| Implementation agent (subagent) | Checkout feature branch from latest `main`, implement Steps 1–10 in order, test, **commit on branch only** |
| Parent agent (architect) | Review diff + verification, open GitHub PR, merge, sync local `main` |

**Branch:** `feat/device-bridge-zero-friction-phase-b` (from `origin/main`).

**Subagent must not:** push to `main`, open/merge GitHub PRs, or fast-forward local `main`.

```bash
git fetch origin main
git checkout main && git pull origin main
git checkout -b feat/device-bridge-zero-friction-phase-b
```

---

## Design Decisions (locked for Phase B)

### 1. Tool directory layout (private, not system PATH)

| OS | Root |
| --- | --- |
| Windows | `%LOCALAPPDATA%\WiseEff\tools\` |
| macOS | `~/Library/Application Support/WiseEff/tools/` |
| Linux | `~/.wiseeff/tools/` |

Example layout after install:

```text
tools/
  adb/0.1.0/platform-tools/adb(.exe)
  hdc/0.1.0/hdc(.exe)
  state.json          # installed versions + sha256
```

Bridge resolves executable paths in order: **managed** → **system PATH** (current behavior). Managed wins when present and executable.

### 2. Health schema extension (B1)

Extend `BridgeHealthState` / `LocalBridgeHealthState`:

```typescript
tools?: {
  adb: ToolProbeState;
  hdc: ToolProbeState;
};
toolsInstall?: {
  status: "idle" | "running" | "succeeded" | "failed";
  protocol?: "adb" | "hdc" | "all";
  error?: string;
  updatedAt: string;
};

type ToolProbeState = {
  available: boolean;
  source?: "managed" | "system";
  version?: string;
  reason?: string;
};
```

Probe cadence: on Bridge `start`, after successful `tools install`, and at most every **60s** on health reads (cache in memory to avoid spawning `version` on every 2s browser poll).

### 3. Web-driven install (B2)

Primary UX (no terminal):

1. User on Step ③ sees “缺少 ADB/HDC 调试工具”.
2. CTA **安装调试工具** opens:

```text
wiseeff-bridge://install-tools?server=<origin>&protocol=adb|hdc|all
```

3. Bridge validates `server` like `connect` URL scheme; downloads artifacts listed in server manifest using paired `serverUrl` origin; extracts to private dir; re-probes; updates health.
4. Frontend polls health every 2s (max 120s for large zip) until `tools.*.available` or `toolsInstall.status === "failed"`.

Fallback: advanced section shows `wiseeff-bridge tools install --protocol all`.

### 4. Same-origin tool artifacts

Mirror bridge artifact pattern:

```text
ops/self-hosted/bridge-tool-artifacts/
  0.1.0/
    manifest.json
    windows/amd64/adb-platform-tools.zip
    darwin/arm64/adb-platform-tools.zip
    darwin/amd64/adb-platform-tools.zip
    windows/amd64/hdc.zip
    ...
```

Served at:

```text
GET /downloads/device-bridge-tools/<version>/<platform>/<arch>/<artifact>
GET /api/v1/device-bridges/tool-releases
```

**Licensing note (implementer must document in manifest README):** Pin Google `platform-tools` and HarmonyOS `hdc` versions approved for redistribution in your deployment; do not fetch arbitrary URLs at runtime.

### 5. Frontend panel status (B1)

Add `BridgePanelStatus`:

```text
tools_missing   — connected, Step ③, required protocol tool unavailable
```

Wizard Step ③ sub-copy:

| State | Hint |
| --- | --- |
| `online_no_device` + tools OK | 插入 USB… |
| `tools_missing` | 缺少 ADB/HDC，请先安装调试工具 |
| detect failed + tool reason | 映射 server/bridge 返回的 tool error，不误报「Bridge 未安装」 |

Protocol-aware: if UI protocol toggle is `hdc`, emphasize hdc tool state first (adb still shown in details).

---

## File Structure

### Create

| Path | Purpose |
| --- | --- |
| `packages/device-bridge/src/toolPaths.ts` | Resolve managed vs system binary paths |
| `packages/device-bridge/src/toolPaths.test.ts` | |
| `packages/device-bridge/src/toolProbe.ts` | Shared probe + cache used by health + RPC |
| `packages/device-bridge/src/toolProbe.test.ts` | |
| `packages/device-bridge/src/toolsInstallCommand.ts` | Download, verify sha256, extract zip/tar.gz |
| `packages/device-bridge/src/toolsInstallCommand.test.ts` | |
| `packages/device-bridge/src/toolInstallState.ts` | Read/write `tools/state.json` |
| `packages/device-bridge/src/urlScheme.ts` (extend) | `parseInstallToolsUrl` / `buildInstallToolsUrl` |
| `server/modules/deviceBridge/toolReleaseManifest.ts` | Load + validate tool manifest |
| `server/modules/deviceBridge/toolReleaseManifest.test.ts` | |
| `server/modules/deviceBridge/toolRoutes.ts` | `GET /api/v1/device-bridges/tool-releases` |
| `server/modules/deviceBridge/toolRoutes.test.ts` | |
| `ops/self-hosted/bridge-tool-artifacts/0.1.0/manifest.json` | Pinned artifacts + sha256 |
| `ops/self-hosted/bridge-tool-artifacts/README.md` + `README.zh-CN.md` | Build/publish instructions |
| `scripts/build-bridge-tool-artifacts.ts` | Optional: fetch/pack pinned upstream zips into artifact dir |
| `src/infrastructure/http/bridgeToolReleasesClient.ts` | Frontend API client |
| `src/infrastructure/http/bridgeToolInstallLauncher.ts` | Scheme URL + install polling |
| `src/infrastructure/http/bridgeToolInstallLauncher.test.ts` | |
| `src/components/LocalDeviceBridgeToolsPanel.tsx` | Step ③ tools missing / installing UI |
| `src/components/LocalDeviceBridgeToolsPanel.test.tsx` | |

### Modify

| Path | Change |
| --- | --- |
| `packages/device-bridge/src/healthServer.ts` | Optional `POST /tools/install` (localhost); CORS allow paired origin only |
| `packages/device-bridge/src/cli.ts` | `tools install` subcommand; `--handle-url` for install-tools |
| `packages/device-bridge/src/rpcHandlers.ts` | Inject resolved adb/hdc command paths from `toolPaths` |
| `packages/device-bridge/src/cli.ts` `runStartCommand` | Periodic tool probe into health state |
| `server/modules/deviceBridge/routes.ts` | Register tool-releases route |
| `server/app.ts` or static downloads mount | Serve `/downloads/device-bridge-tools/...` |
| `ops/self-hosted/compose.yaml` / Caddy | Mount tool artifacts volume (mirror bridge-artifacts) |
| `src/infrastructure/http/deviceBridgeClient.ts` | Extend `LocalBridgeHealthState` |
| `src/components/LocalDeviceBridgeWizard.tsx` | Integrate tools panel; new status |
| `src/NodeDebuggingPage.tsx` | `deriveBridgePanelStatus` + detect error mapping |
| `src/styles.css` | Tools panel styles |
| `docs/runbooks/local-device-bridge.md` + zh-CN | Tool install path |
| `docs/FRONTEND.md` + zh-CN | Wizard Step ③ tools UX |
| `e2e/acceptance/local-device-bridge.acceptance.spec.ts` | Extend `BRIDGE-WIN-001` or add `BRIDGE-TOOLS-001` |
| `docs/developer/browser-acceptance-coverage-map.md` + zh-CN | New requirement row if added |

---

## Task Sequence

Execute **in order**. Do not start Step N+1 until Step N verification passes.

---

## Step 1 — Tool path resolution (foundation)

**Problem:** RPC always uses `"adb"` / `"hdc"` on PATH.

**Tasks:**

- [ ] Add `resolveToolBinary(protocol, platform)` → `{ command, source }`
- [ ] Add `toolInstallState` persistence under tools root
- [ ] Unit tests: managed path preferred; falls back to system command name

**Verification:**

```bash
npm run bridge:test -- packages/device-bridge/src/toolPaths.test.ts packages/device-bridge/src/toolInstallState.test.ts
```

---

## Step 2 — Shared tool probe + RPC wiring

**Tasks:**

- [ ] Extract `probeTools({ adbRunner, hdcRunner })` matching `bridge.getCapabilities` shape
- [ ] Update `createRpcHandlers` to accept `adbCommand` / `hdcCommand` from `toolPaths`
- [ ] `cli.ts` `runStartCommand`: build handlers with resolved paths

**Verification:**

```bash
npm run bridge:test -- packages/device-bridge/src/toolProbe.test.ts packages/device-bridge/src/rpcHandlers.test.ts
```

---

## Step 3 — Health exposes `tools` (B1 core)

**Tasks:**

- [ ] Extend `BridgeHealthState` with `tools` + probe cache (60s TTL)
- [ ] Update `probeLocalBridgeHealth` parsers in `deviceBridgeClient.ts` and `bridgeConnectLauncher.ts`
- [ ] Tests: health JSON includes `tools.adb.available` false when mock runner fails

**Verification:**

```bash
npm run bridge:test -- packages/device-bridge/src/healthServer.test.ts  # create if missing
npm test -- src/infrastructure/http/bridgeConnectLauncher.test.ts
```

---

## Step 4 — Frontend B1: `tools_missing` status

**Tasks:**

- [ ] Add `tools_missing` to `BridgePanelStatus`; update `deriveBridgePanelStatus`:
  - `connected && !tools[protocol].available` → `tools_missing`
  - `connected && tools OK && !target` → `online_no_device`
- [ ] Wizard Step ③ copy + `LocalDeviceBridgeToolsPanel` read-only hints (versions, source)
- [ ] Map detect failures: if bridge session errors mention adb/hdc not found → show tools CTA not “Bridge 未安装”

**Verification:**

```bash
npm test -- src/components/LocalDeviceBridgeWizard.test.tsx src/components/LocalDeviceBridgeToolsPanel.test.tsx
```

---

## Step 5 — Server tool release manifest + API

**Tasks:**

- [ ] Implement `loadBridgeToolReleaseManifest` (zod schema: platform, arch, protocol, artifact, sha256, version)
- [ ] `GET /api/v1/device-bridges/tool-releases` (same auth as bridge releases — public or session? **Match** `/device-bridges/releases`: unauthenticated GET for download metadata)
- [ ] Static route `/downloads/device-bridge-tools/...` in self-hosted Caddy template
- [ ] Seed `ops/self-hosted/bridge-tool-artifacts/0.1.0/manifest.json` with placeholder sha256 until built

**Verification:**

```bash
npm run test:server -- server/modules/deviceBridge/toolReleaseManifest.test.ts server/modules/deviceBridge/toolRoutes.test.ts
```

---

## Step 6 — Bridge `tools install` command (B2 core)

**Tasks:**

- [ ] `toolsInstallCommand.ts`: fetch `${serverUrl}/downloads/device-bridge-tools/...`, verify sha256, extract, chmod +x on Unix
- [ ] CLI: `wiseeff-bridge tools install --server <url> --protocol adb|hdc|all`
- [ ] Use paired `serverUrl` from config when `--server` omitted
- [ ] Update health `toolsInstall` status during run; set `tools` after success
- [ ] Idempotent: skip download if same version+sha256 already installed

**Verification:**

```bash
npm run bridge:test -- packages/device-bridge/src/toolsInstallCommand.test.ts packages/device-bridge/src/cli.test.ts
```

Use temp dirs + mock `fetch` in tests; no network in CI.

---

## Step 7 — URL scheme `install-tools` + health install endpoint

**Tasks:**

- [ ] Extend `urlScheme.ts`:

```text
wiseeff-bridge://install-tools?server=<origin>&protocol=adb|hdc|all
```

- [ ] `--handle-url` dispatches to non-blocking `tools install` (same pattern as `connect` / `ensureBridgeRunning`)
- [ ] Optional: `POST http://127.0.0.1:18787/tools/install` with `{ protocol }` for future; if added, set `Access-Control-Allow-Origin` to paired server origin only

**Verification:**

```bash
npm run bridge:test -- packages/device-bridge/src/urlScheme.test.ts packages/device-bridge/src/cli.test.ts
```

---

## Step 8 — Frontend B2: one-click install

**Tasks:**

- [ ] `bridgeToolInstallLauncher.ts`: build scheme URL, poll `toolsInstall` + `tools.*.available` (120s timeout)
- [ ] Wizard CTA **安装调试工具** when `tools_missing`; show progress “正在下载…”
- [ ] First-click confirm dialog (reuse `wiseeff.bridgeSchemeConfirm` or separate key)
- [ ] Advanced CLI: `wiseeff-bridge tools install --protocol all`

**Verification:**

```bash
npm test -- src/infrastructure/http/bridgeToolInstallLauncher.test.tsx src/components/LocalDeviceBridgeToolsPanel.test.tsx
npm run build
```

---

## Step 9 — Ops artifacts + self-hosted wiring

**Tasks:**

- [ ] Document how to populate `bridge-tool-artifacts` (pinned platform-tools + hdc zips)
- [ ] `scripts/build-bridge-tool-artifacts.ts` (optional but recommended): verify upstream versions, compute sha256
- [ ] Update `ops/self-hosted/compose.yaml` volume mount
- [ ] Env: `DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT` (mirror `DEVICE_BRIDGE_ARTIFACT_ROOT`)

**Verification:**

```bash
npm run selfhost:check   # if template references updated
```

Manual: place real zips, hit `GET /api/v1/device-bridges/tool-releases` locally.

---

## Step 10 — Docs, acceptance, closeout

**Tasks:**

- [ ] Runbook: tool install path, private directory, licensing note
- [ ] FRONTEND.md + zh-CN: Step ③ tools states
- [ ] Update design spec § Phase B → “B1/B2 implemented”
- [ ] Browser acceptance: add `BRIDGE-TOOLS-001` **or** extend `BRIDGE-WIN-001` with mocked health `tools.adb.available: false` → CTA visible
- [ ] Move this plan to `docs/exec-plans/completed/` when done
- [ ] `npm run docs:check`

**Verification matrix (Phase B exit):**

```bash
npm run bridge:test -- packages/device-bridge/
npm run test:server -- server/modules/deviceBridge/
npm test -- src/components/LocalDeviceBridgeWizard.test.tsx src/components/LocalDeviceBridgeToolsPanel.test.tsx src/infrastructure/http/bridgeToolInstallLauncher.test.ts
npm run build
npm run docs:check
```

**Manual VM (required before pilot):**

| # | Scenario | Pass |
| --- | --- | --- |
| 1 | Bridge connected, no adb on PATH | Step ③ shows 缺少 ADB，非「Bridge 未安装」 |
| 2 | Click 安装调试工具 | Tools appear under private dir; health `tools.adb.available: true` |
| 3 | USB device + 重新检测 | Detect returns bridge target |
| 4 | HDC path | Repeat 1–3 for `protocol=hdc` on HDC lab machine |
| 5 | Idempotent re-install | Second click skips re-download |

---

## Documentation Impact Matrix

| Area | File(s) | Action |
| --- | --- | --- |
| Repository maps | `docs/PLANS.md` | Update — list this active plan |
| Product specs | `docs/product-specs/*` | No change |
| Architecture | `ARCHITECTURE.md` | Review — optional one-line tool artifacts |
| Runbooks | `docs/runbooks/local-device-bridge.md`, zh-CN | Update |
| Frontend docs | `docs/FRONTEND.md`, zh-CN | Update |
| Design spec | `docs/zh-CN/superpowers/specs/2026-06-24-device-bridge-zero-friction-design.md` | Update — B1/B2 implemented when done |
| Self-hosted ops | `ops/self-hosted/compose.yaml`, `.env.example` | Update — tool artifact root |
| Tool artifacts | `ops/self-hosted/bridge-tool-artifacts/` | Create |
| Browser acceptance | `docs/developer/browser-acceptance-coverage-map.md`, zh-CN | Update — `BRIDGE-TOOLS-001` |
| Security | `docs/SECURITY.md` | Review — localhost install + pinned artifacts |
| Env examples | `.env.example`, `ops/self-hosted/.env.example` | Update — `DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT` |

## Documentation Update Gate

Plan cannot move to `completed/` until:

- [ ] All `Update` rows committed or recorded unchanged with reason
- [ ] `npm run docs:check` passes
- [ ] Browser acceptance impact recorded (`BRIDGE-TOOLS-001` or `BRIDGE-WIN-001` extension)

---

## Follow-Up (Phase C)

- Bundle adb/hdc in Bridge installer (design B3)
- Windows installer real sha256 + signed builds
- Auto-update channel for Bridge and tools
- Enterprise silent deploy

---

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Large SDK zip download timeout | 120s frontend poll; resumable idempotent install; show byte progress in health |
| HDC licensing / platform-specific binaries | Separate manifest entries per OS/arch; document in ops README |
| CORS on localhost POST | Prefer URL scheme; restrict origin if POST added |
| False negative tool probe | Cache 60s; manual `tools install --force` flag in advanced CLI |
| Detect still fails with empty USB | Keep distinct copy: tools OK vs no device vs unauthorized USB |

---

## Single-Agent Dispatch Prompt (copy when ready)

```text
WiseEff Device Bridge Phase B — 单智能体顺序执行

计划：docs/exec-plans/active/2026-06-25-wiseeff-device-bridge-zero-friction-phase-b.md
分支：feat/device-bridge-zero-friction-phase-b（从最新 origin/main 创建）

Git：可在本分支 commit；禁止 push main / 开 PR / 合 PR（父智能体负责）

按 Step 1→10 顺序实现 B1（health tools 检测 + 前端 tools_missing）与 B2（私有目录一键安装 + scheme + manifest）。

交付：改动文件列表、验证命令输出、Manual VM 清单、未做项。
```
