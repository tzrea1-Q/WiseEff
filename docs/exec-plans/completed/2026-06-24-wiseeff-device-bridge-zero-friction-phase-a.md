# WiseEff Device Bridge Zero-Friction — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Windows and macOS users install Bridge once via a no-options graphical installer, then connect from `/node-debugging` with a single browser button (URL scheme + health polling) instead of terminal pair/start commands.

**Architecture:** Extend the existing `packages/device-bridge` CLI with a `connect` command and OS protocol-handler entrypoints. Ship Windows `.exe` and macOS `.pkg`/`.app` installers that bundle the current esbuild CLI bundle plus a pinned Node runtime, register `wiseeff-bridge://connect`, and start tray/service on install. Refactor `LocalDeviceBridgePanel` into a 3-step wizard that shows one platform-matched install CTA, launches the scheme URL, polls `127.0.0.1:18787/health`, and collapses CLI commands into an advanced section.

**Tech Stack:** TypeScript, Node 22, esbuild, Inno Setup (Windows), macOS `pkgbuild`/`productbuild`, React/Vite, Vitest, Playwright.

---

## Source Spec

- `docs/zh-CN/superpowers/specs/2026-06-24-device-bridge-zero-friction-design.md`
- Prerequisite baseline: Phase 1–3 local device bridge (CLI, pairing API, `/node-debugging` panel)

## Scope

### In scope (Phase A)

- `wiseeff-bridge connect --server <url> [--code <code>]`
- URL scheme: `wiseeff-bridge://connect?server=<origin>&code=<6-digit>`
- Graphical installers for **Windows x64** and **macOS arm64 + x64**
- Frontend 3-step wizard + scheme launch + 30s health polling
- Release manifest entries for installer artifacts (same-origin download)
- Runbook + frontend doc updates
- Unit tests and targeted browser acceptance updates

### Out of scope (defer to Phase B/C plans)

- Bundled `adb`/`hdc` in installer
- One-click dependency download to private tools directory
- Linux graphical installer
- Auto-update channel
- Code signing/notarization automation in CI (document manual steps; unsigned builds OK for pilot)

## File Structure

### Create

- `packages/device-bridge/src/connectCommand.ts` — pair-if-needed + start orchestration
- `packages/device-bridge/src/connectCommand.test.ts`
- `packages/device-bridge/src/urlScheme.ts` — parse/build `wiseeff-bridge://connect?...`
- `packages/device-bridge/src/urlScheme.test.ts`
- `src/infrastructure/http/bridgeConnectLauncher.ts` — browser scheme launch + polling helpers
- `src/infrastructure/http/bridgeConnectLauncher.test.ts`
- `src/components/LocalDeviceBridgeWizard.tsx` — extracted wizard UI (keep panel thin)
- `ops/self-hosted/bridge-installer/windows/WiseEffBridge.iss` — Inno Setup script
- `ops/self-hosted/bridge-installer/windows/build.ps1`
- `ops/self-hosted/bridge-installer/macos/Info.plist.template`
- `ops/self-hosted/bridge-installer/macos/build-macos-installer.sh`
- `ops/self-hosted/bridge-installer/README.md`
- `ops/self-hosted/bridge-installer/README.zh-CN.md`
- `scripts/build-bridge-installers.ts` — orchestrates portable bundle + platform installers
- `docs/exec-plans/active/2026-06-24-wiseeff-device-bridge-zero-friction-phase-b.md` — stub follow-up for B1/B2 (optional, create when Phase A completes)

### Modify

- `packages/device-bridge/src/cli.ts` — add `connect` command; optional `--handle-url` for protocol activation
- `packages/device-bridge/src/cli.test.ts`
- `packages/device-bridge/src/healthServer.ts` — expose `paired` accurately before WSS connect completes
- `server/modules/deviceBridge/releaseManifest.ts` — support `artifactKind: "portable" | "installer"`
- `server/modules/deviceBridge/schemas.ts` + tests — expose optional `artifactKind` in API
- `src/infrastructure/http/bridgeReleaseSelection.ts` — prefer installer items for primary CTA
- `src/infrastructure/http/bridgeReleaseSelection.test.ts`
- `src/NodeDebuggingPage.tsx` — use wizard component; remove multi-button download row as primary UX
- `src/NodeDebuggingPage.test.tsx`
- `src/styles.css` — wizard step styles
- `scripts/build-device-bridge.ts` — emit portable artifacts used by installer build
- `ops/self-hosted/bridge-artifacts/0.1.0/manifest.json` — add installer items after first build
- `docs/runbooks/local-device-bridge.md` + `docs/zh-CN/runbooks/local-device-bridge.md`
- `docs/FRONTEND.md` + `docs/zh-CN/frontend.md`
- `e2e/acceptance/local-device-bridge.acceptance.spec.ts` — wizard + advanced CLI collapse coverage

---

## Task 1: `connect` Command and URL Scheme Parsing

**Files:**
- Create: `packages/device-bridge/src/urlScheme.ts`, `urlScheme.test.ts`, `connectCommand.ts`, `connectCommand.test.ts`
- Modify: `packages/device-bridge/src/cli.ts`, `cli.test.ts`

- [x] **Step 1: Write failing URL scheme tests**

```typescript
// packages/device-bridge/src/urlScheme.test.ts
import { describe, expect, it } from "vitest";
import { buildConnectUrl, parseConnectUrl } from "./urlScheme";

describe("urlScheme", () => {
  it("builds connect URL with encoded params", () => {
    expect(buildConnectUrl({
      server: "https://tzrea1.com",
      code: "840021"
    })).toBe("wiseeff-bridge://connect?server=https%3A%2F%2Ftzrea1.com&code=840021");
  });

  it("parses connect URL", () => {
    expect(parseConnectUrl("wiseeff-bridge://connect?server=https%3A%2F%2Ftzrea1.com&code=840021")).toEqual({
      server: "https://tzrea1.com",
      code: "840021"
    });
  });
});
```

- [x] **Step 2: Run tests (expect FAIL)**

Run: `npm test -- packages/device-bridge/src/urlScheme.test.ts`

- [x] **Step 3: Implement `urlScheme.ts`**

```typescript
export function buildConnectUrl(input: { server: string; code?: string }) {
  const url = new URL("wiseeff-bridge://connect");
  url.searchParams.set("server", input.server);
  if (input.code) url.searchParams.set("code", input.code);
  return url.toString();
}

export function parseConnectUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "wiseeff-bridge:" || url.hostname !== "connect") {
    throw new Error("Unsupported bridge URL");
  }
  const server = url.searchParams.get("server");
  const code = url.searchParams.get("code") ?? undefined;
  if (!server) throw new Error("Missing server");
  return { server, code };
}
```

Note: use `wiseeff-bridge://connect?...` with `hostname=connect` (standard URL parser shape).

- [x] **Step 4: Write failing connect command tests**

```typescript
// packages/device-bridge/src/connectCommand.test.ts
it("pairs when code provided and config missing, then starts", async () => {
  // mock deps.fetchImpl pair endpoint + ws client start
  // assert saveConfig called and health server started
});

it("starts without re-pair when config server matches and token valid", async () => {
  // load existing config, no POST /pair
});
```

- [x] **Step 5: Implement `runConnectCommand`**

Extract pair/start orchestration from `cli.ts` into `connectCommand.ts`:

```typescript
export async function runConnectCommand(deps: CliDependencies, input: {
  server: string;
  code?: string;
}): Promise<{ exitCode: number }> {
  const existing = await deps.loadConfig();
  const serverMatches = existing?.serverUrl === normalizeServerUrl(input.server);
  if (!existing || !serverMatches) {
    if (!input.code) return { exitCode: 1 };
    const pairResult = await runPairCommand({ command: "pair", flags: new Map([
      ["server", input.server],
      ["code", input.code]
    ]) }, deps);
    if (pairResult.exitCode !== 0) return pairResult;
  }
  const config = await deps.loadConfig();
  if (!config) return { exitCode: 1 };
  await runStartCommand(deps, config);
  return { exitCode: 0 };
}
```

Adjust `runStartCommand` to return after background start when invoked from protocol handler (see Task 2).

- [x] **Step 6: Wire CLI**

Add to `parseArgs` / `runCli`:

```typescript
if (parsed.command === "connect") {
  const server = parsed.flags.get("server");
  const code = parsed.flags.get("code");
  if (!server) { /* usage */ return 1; }
  return (await runConnectCommand(deps, { server, code })).exitCode;
}

if (parsed.flags.get("handle-url")) {
  const parsedUrl = parseConnectUrl(parsed.flags.get("handle-url")!);
  return (await runConnectCommand(deps, parsedUrl)).exitCode;
}
```

- [x] **Step 7: Run package tests**

Run: `npm test -- packages/device-bridge/src/cli.test.ts packages/device-bridge/src/urlScheme.test.ts packages/device-bridge/src/connectCommand.test.ts`

- [x] **Step 8: Commit**

```bash
git add packages/device-bridge/src/urlScheme.ts packages/device-bridge/src/urlScheme.test.ts \
  packages/device-bridge/src/connectCommand.ts packages/device-bridge/src/connectCommand.test.ts \
  packages/device-bridge/src/cli.ts packages/device-bridge/src/cli.test.ts
git commit -m "feat(device-bridge): add connect command and URL scheme parsing"
```

---

## Task 2: Protocol Handler Entry and Long-Running Start

**Files:**
- Modify: `packages/device-bridge/src/cli.ts`, `connectCommand.ts`, `healthServer.ts`
- Modify: `ops/self-hosted/bridge-installer/windows/WiseEffBridge.iss` (stub registry)
- Modify: `ops/self-hosted/bridge-installer/macos/Info.plist.template`

- [x] **Step 1: Add `--handle-url` integration test in `cli.test.ts`**

Expect `runConnectCommand` invoked with parsed `{ server, code }`.

- [x] **Step 2: Ensure protocol activation keeps process alive**

When `--handle-url` is used, after `runStartCommand` begins WSS + health server, CLI must **not exit** until signal. Reuse existing `waitForTerminationSignal()` path from `start`.

- [x] **Step 3: Windows registry in Inno Setup**

Register URL protocol:

```ini
[Registry]
Root: HKCU; Subkey: "Software\\Classes\\wiseeff-bridge"; ValueType: string; ValueData: "URL:WiseEff Bridge Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\\Classes\\wiseeff-bridge\\URL Protocol"; ValueType: string; ValueData: ""
Root: HKCU; Subkey: "Software\\Classes\\wiseeff-bridge\\shell\\open\\command"; ValueType: string; ValueData: "\"{app}\\wiseeff-bridge.exe\" --handle-url \"%1\""
```

- [x] **Step 4: macOS `CFBundleURLTypes`**

In app bundle `Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key><string>com.wiseeff.bridge</string>
    <key>CFBundleURLSchemes</key><array><string>wiseeff-bridge</string></array>
  </dict>
</array>
```

App executable forwards open URL to bundled CLI `--handle-url`.

- [x] **Step 5: Run CLI tests + commit**

```bash
git commit -m "feat(device-bridge): support protocol handler entry via --handle-url"
```

---

## Task 3: Release Manifest Installer Kind

**Files:**
- Modify: `server/modules/deviceBridge/releaseManifest.ts`, `schemas.ts`, `schemas.test.ts`
- Modify: `src/infrastructure/http/deviceBridgeClient.ts` (type)
- Modify: `src/infrastructure/http/bridgeReleaseSelection.ts`, `.test.ts`

- [x] **Step 1: Write failing selection test**

```typescript
it("prefers installer artifact over portable zip for primary CTA", () => {
  const items = [
    { platform: "darwin", arch: "arm64", version: "0.1.0", downloadUrl: "/downloads/.../portable.tar.gz", artifactKind: "portable" },
    { platform: "darwin", arch: "arm64", version: "0.1.0", downloadUrl: "/downloads/.../WiseEffBridge.pkg", artifactKind: "installer" }
  ];
  expect(pickBridgeReleaseForHost(items, { platform: "darwin", arch: "arm64" })?.downloadUrl).toContain(".pkg");
});
```

- [x] **Step 2: Extend manifest schema**

Add optional `artifactKind?: "portable" | "installer"` defaulting to `"portable"` for backward compatibility.

- [x] **Step 3: Update `bridgeReleaseDownloadLabel`**

Return **安装 Bridge（Windows）** / **安装 Bridge（macOS Apple Silicon）** when `artifactKind === "installer"`.

- [x] **Step 4: Run tests**

Run: `npm test -- src/infrastructure/http/bridgeReleaseSelection.test.ts server/modules/deviceBridge/schemas.test.ts server/modules/deviceBridge/releaseManifest.test.ts`

- [x] **Step 5: Commit**

---

## Task 4: Installer Build Pipeline

**Files:**
- Create: `scripts/build-bridge-installers.ts`, `ops/self-hosted/bridge-installer/**`
- Modify: `scripts/build-device-bridge.ts`, `package.json` scripts

- [x] **Step 1: Add npm script**

```json
"build:bridge-installers": "tsx scripts/build-bridge-installers.ts"
```

- [x] **Step 2: Build portable baseline**

Reuse `npm run build:device-bridge` output (`cli.js` + launchers) into `bridge-installer/staging/`.

- [x] **Step 3: Windows installer**

`build.ps1` invokes Inno Setup CLI (`iscc`) when available; output:

`ops/self-hosted/bridge-artifacts/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe`

Bundle a **portable Node win-x64** zip downloaded at build time (pin version in script constants).

- [x] **Step 4: macOS installer**

`build-macos-installer.sh` creates `WiseEff Bridge.app` with launcher script + `Info.plist`, then `productbuild` pkg:

`ops/self-hosted/bridge-artifacts/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg`

Repeat for amd64 when building on Intel or universal script branch.

- [x] **Step 5: Regenerate manifest.json**

Append installer items with sha256 + `artifactKind: "installer"`. Keep portable items for advanced section.

- [x] **Step 6: Document manual build prerequisites**

In `ops/self-hosted/bridge-installer/README.md`: Inno Setup 6, macOS pkgbuild, Node redistributable download URLs.

- [x] **Step 7: Commit**

```bash
git commit -m "feat: add Windows and macOS bridge installer build pipeline"
```

---

## Task 5: Browser Connect Launcher Utility

**Files:**
- Create: `src/infrastructure/http/bridgeConnectLauncher.ts`, `.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import { buildBridgeConnectUrl, launchBridgeConnect, pollLocalBridgeHealth } from "./bridgeConnectLauncher";

describe("bridgeConnectLauncher", () => {
  it("builds scheme URL from origin and pairing code", () => {
    expect(buildBridgeConnectUrl("https://tzrea1.com", "123456"))
      .toBe("wiseeff-bridge://connect?server=https%3A%2F%2Ftzrea1.com&code=123456");
  });

  it("polls health until connected or timeout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, connected: false, updatedAt: "t" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, connected: true, updatedAt: "t" })));
    const result = await pollLocalBridgeHealth({ fetchImpl: fetchMock, intervalMs: 1, timeoutMs: 50 });
    expect(result?.connected).toBe(true);
  });
});
```

- [x] **Step 2: Implement launcher**

```typescript
export function buildBridgeConnectUrl(origin: string, code: string) {
  const url = new URL("wiseeff-bridge://connect");
  url.searchParams.set("server", origin);
  url.searchParams.set("code", code);
  return url.toString();
}

export function launchBridgeConnect(url: string) {
  window.location.href = url;
}

export async function pollLocalBridgeHealth(options: {
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<LocalBridgeHealthState | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 30000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await probeLocalBridgeHealth(fetchImpl);
    if (health?.connected) return health;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return probeLocalBridgeHealth(fetchImpl);
}
```

- [x] **Step 3: Run tests + commit**

---

## Task 6: 3-Step Wizard UI Refactor

**Files:**
- Create: `src/components/LocalDeviceBridgeWizard.tsx`
- Modify: `src/NodeDebuggingPage.tsx`, `src/styles.css`, `src/NodeDebuggingPage.test.tsx`

- [x] **Step 1: Write failing wizard tests in `NodeDebuggingPage.test.tsx`**

Cases:
- missing bridge → step ① active, **single** install link, alternate platforms hidden behind `<details>其他平台</details>`
- connect click → `launchBridgeConnect` called with scheme URL
- connected health → step ③ or auto-detect path
- pair/start commands only visible when advanced `<details open>` toggled

- [x] **Step 2: Implement wizard component**

Props:

```typescript
type LocalDeviceBridgeWizardProps = {
  panelStatus: BridgePanelStatus;
  hostRelease: DeviceBridgeReleaseItem | null;
  pairingCode: DeviceBridgePairingCode | null;
  onConnect: () => Promise<void>;
  onDetect: () => void;
  advancedCommands: { pair: string; start: string };
};
```

Render step indicator:

```tsx
<ol className="local-device-bridge-wizard__steps">
  <li data-active={step === 1} data-done={step > 1}>安装 Bridge</li>
  <li data-active={step === 2} data-done={step > 2}>连接本机</li>
  <li data-active={step === 3}>插入 USB 设备</li>
</ol>
```

Primary CTA mapping per spec state table.

First-time scheme confirmation:

```typescript
const skipConfirm = localStorage.getItem("wiseeff.bridgeSchemeConfirm") === "1";
if (!skipConfirm && !window.confirm("即将打开 WiseEff Bridge 以完成连接。是否继续？")) return;
localStorage.setItem("wiseeff.bridgeSchemeConfirm", "1");
launchBridgeConnect(buildBridgeConnectUrl(window.location.origin, pairingCode.code));
await pollLocalBridgeHealth({});
onDetect();
```

- [x] **Step 3: Slim `LocalDeviceBridgePanel` to compose wizard + bridge management**

Keep rename/revoke list for paired bridges.

- [x] **Step 4: CSS for steps and collapsed advanced section**

- [x] **Step 5: Run tests**

Run: `npm test -- src/NodeDebuggingPage.test.tsx src/infrastructure/http/bridgeConnectLauncher.test.ts`

Run: `npm run build`

- [x] **Step 6: Commit**

```bash
git commit -m "feat: add Device Bridge 3-step wizard with URL scheme connect flow"
```

---

## Task 7: Browser Acceptance and Manual Pilot Checks

**Files:**
- Modify: `e2e/acceptance/local-device-bridge.acceptance.spec.ts`
- Modify: `docs/developer/browser-acceptance-coverage-map.md` (if BRIDGE-WIN-001 text needs wizard wording)

- [x] **Step 1: Update acceptance spec assertions**

Verify:
- Primary CTA label **安装 Bridge** when health unreachable
- Advanced section contains CLI commands
- **连接本地设备** button present at step ②

Keep `test.skip` guards when Windows/macOS installer runtime unavailable; document skip reason.

- [x] **Step 2: Run targeted e2e**

Run: `npm run test:e2e -- e2e/acceptance/local-device-bridge.acceptance.spec.ts` (or project equivalent)

- [x] **Step 3: Manual pilot checklist (self-hosted)**

1. Build installers on a build machine; upload artifacts to `bridge-artifacts/`
2. Fresh VM: install → open `/node-debugging` → connect without terminal
3. Confirm detect finds USB device when adb/hdc preinstalled

- [x] **Step 4: Commit**

---

## Task 8: Documentation and Governance Gate

**Files:**
- Modify runbooks + FRONTEND docs (EN + zh-CN)
- Modify `docs/PLANS.md` active plan list

- [x] **Step 1: Update runbooks primary path**

Replace terminal-first instructions with: install → browser connect → USB.

- [x] **Step 2: Update FRONTEND.md bridge panel section**

Document wizard steps, scheme launch, advanced CLI collapse, installer vs portable artifacts.

- [x] **Step 3: Run docs check**

Run: `npm run docs:check`

- [x] **Step 4: Commit**

```bash
git commit -m "docs: document zero-friction Device Bridge install and connect flow"
```

---

## Documentation Impact Matrix

| Area | File(s) | Action |
| --- | --- | --- |
| Repository maps | `docs/PLANS.md` | Update — add this active plan |
| Product specs | `docs/product-specs/*` | No change |
| Architecture | `ARCHITECTURE.md` | Review — no change unless installer hosting called out |
| Runbooks | `docs/runbooks/local-device-bridge.md`, `docs/zh-CN/runbooks/local-device-bridge.md` | Update |
| Frontend docs | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Update |
| Design spec | `docs/zh-CN/superpowers/specs/2026-06-24-device-bridge-zero-friction-design.md` | Review — mark Phase A implemented when done |
| Env examples | `.env.example`, `ops/self-hosted/.env.example` | No change |
| Generated artifacts | `ops/self-hosted/bridge-artifacts/0.1.0/manifest.json` | Update — installer entries |
| References | `docs/developer/browser-acceptance-coverage-map.md` | Review — BRIDGE-WIN-001 wording |
| Security | `docs/SECURITY.md` | Review — confirm scheme does not weaken token model |

## Documentation Update Gate

Plan cannot move to `completed/` until:

- [x] All `Update` rows above are committed or explicitly recorded unchanged with reason in plan PR notes
- [x] `npm run docs:check` passes
- [x] Browser acceptance impact recorded for wizard UI (`BRIDGE-WIN-001` or successor ID)

## Browser Acceptance Coverage

| Requirement ID | Spec | Notes |
| --- | --- | --- |
| `BRIDGE-WIN-001` | `e2e/acceptance/local-device-bridge.acceptance.spec.ts` | Extend for wizard + advanced CLI collapse |

## Verification Matrix (Phase A exit)

```bash
npm test -- packages/device-bridge/src/cli.test.ts packages/device-bridge/src/urlScheme.test.ts packages/device-bridge/src/connectCommand.test.ts
npm test -- src/infrastructure/http/bridgeReleaseSelection.test.ts src/infrastructure/http/bridgeConnectLauncher.test.ts
npm test -- src/NodeDebuggingPage.test.tsx
npm test -- server/modules/deviceBridge/releaseManifest.test.ts server/modules/deviceBridge/schemas.test.ts
npm run build
npm run docs:check
```

Manual: install WiseEffBridgeSetup / WiseEffBridge.pkg on clean Win/Mac VM → `/node-debugging` → **连接本地设备** → health online ≤30s.

## Follow-Up Plans

- **Phase B1/B2:** `docs/exec-plans/active/2026-06-24-wiseeff-device-bridge-zero-friction-phase-b.md` — health `tools.adb/hdc` + one-click private dependency install
- **Phase C:** bundled adb/hdc, auto-update, enterprise silent deploy

---

**Plan complete.** Execute with subagent-driven-development (recommended) or executing-plans inline.
