# WiseEff Local Device Bridge — Phase 1 (Windows + ADB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Windows users debug a USB-connected phone on their own PC through a remotely hosted WiseEff `/node-debugging` page, with full server-side governance and same-origin bridge downloads.

**Architecture:** Add a `device-bridge` server module (pairing, scoped tokens, WebSocket RPC pool, release manifest) and extend debugging sessions with `execution_mode=bridge`. Ship a Windows AMD64 `wiseeff-bridge` CLI that maintains outbound WSS and executes local `adb` using shared command-runner logic extracted from `adbGateway`. Phase 1 implements ADB only on the bridge; HDC stays in Phase 2.

**Tech Stack:** TypeScript, Node `spawn`, `ws`, PostgreSQL migrations, Zod, WiseEff modular API router, React/Vite, Vitest, Playwright.

---

## Source Spec

- `docs/superpowers/specs/2026-06-23-local-device-bridge-design.md`
- `docs/zh-CN/superpowers/specs/2026-06-23-local-device-bridge-design.md`

## Scope Notes

- Phase 1 delivers **Windows AMD64** bridge packaging and install UX first.
- Phase 1 bridge RPC supports **ADB only**; server HDC/server-hosted paths remain unchanged.
- Do not reuse browser bearer tokens in the bridge.
- Do not add arbitrary shell RPC.
- macOS/Linux bridge artifacts may appear in manifest scaffolding but are not release blockers.
- Commit steps are included for normal writable environments.

## File Structure

Create:

- `packages/device-bridge/package.json`
- `packages/device-bridge/tsconfig.json`
- `packages/device-bridge/src/cli.ts`
- `packages/device-bridge/src/config.ts`
- `packages/device-bridge/src/healthServer.ts`
- `packages/device-bridge/src/wsClient.ts`
- `packages/device-bridge/src/rpcHandlers.ts`
- `packages/device-bridge/src/cli.test.ts`
- `packages/device-command-core/package.json`
- `packages/device-command-core/src/adbRunner.ts`
- `packages/device-command-core/src/adbTargets.ts`
- `packages/device-command-core/src/remoteNodeWrite.ts`
- `packages/device-command-core/src/adbRunner.test.ts`
- `server/migrations/0022_local_device_bridge.sql`
- `server/modules/deviceBridge/types.ts`
- `server/modules/deviceBridge/protocol.ts`
- `server/modules/deviceBridge/schemas.ts`
- `server/modules/deviceBridge/schemas.test.ts`
- `server/modules/deviceBridge/repository.ts`
- `server/modules/deviceBridge/repository.test.ts`
- `server/modules/deviceBridge/token.ts`
- `server/modules/deviceBridge/token.test.ts`
- `server/modules/deviceBridge/pairingService.ts`
- `server/modules/deviceBridge/pairingService.test.ts`
- `server/modules/deviceBridge/connectionPool.ts`
- `server/modules/deviceBridge/connectionPool.test.ts`
- `server/modules/deviceBridge/rpc.ts`
- `server/modules/deviceBridge/rpc.test.ts`
- `server/modules/deviceBridge/releaseManifest.ts`
- `server/modules/deviceBridge/releaseManifest.test.ts`
- `server/modules/deviceBridge/routes.ts`
- `server/modules/deviceBridge/routes.test.ts`
- `server/modules/deviceBridge/wsHandler.ts`
- `server/modules/debugging/bridgeExecution.ts`
- `server/modules/debugging/bridgeExecution.test.ts`
- `ops/self-hosted/bridge-artifacts/0.1.0/manifest.json`
- `ops/self-hosted/bridge-artifacts/README.md`
- `ops/self-hosted/bridge-artifacts/README.zh-CN.md`
- `scripts/build-device-bridge.ts`
- `docs/runbooks/local-device-bridge.md`
- `docs/zh-CN/runbooks/local-device-bridge.md`
- `e2e/acceptance/local-device-bridge.acceptance.spec.ts`

Modify:

- `server/modules/debugging/adbGateway.ts` — import shared runner/helpers from `device-command-core`
- `server/modules/debugging/types.ts` — add `executionMode`, `bridgeId`, `bridgeMachineLabel`
- `server/modules/debugging/repository.ts` — persist session bridge fields
- `server/modules/debugging/schemas.ts` — optional `bridgeId` on create session; detect body unchanged
- `server/modules/debugging/service.ts` — parallel bridge detect + bridge execution path
- `server/modules/debugging/service.test.ts` — bridge routing tests with fake pool
- `server/modules/debugging/routes.ts` — pass bridge dependencies into service factory
- `server/app.ts` — register device-bridge routes and WS upgrade
- `server/index.ts` — wire connection pool and release manifest paths
- `server/config/env.ts` — `DEVICE_BRIDGE_ARTIFACT_ROOT`, `DEVICE_BRIDGE_WS_PATH`, token TTL envs
- `server/config/env.test.ts`
- `.env.example`, `ops/self-hosted/.env.example`
- `ops/self-hosted/Caddyfile.example` — `/downloads/device-bridge/*` static route
- `ops/self-hosted/compose.yaml` — mount `bridge-artifacts`
- `package.json` — workspace/scripts: `bridge:build`, `bridge:test`
- `src/NodeDebuggingPage.tsx` — connect-local-device panel (Windows-first)
- `src/NodeDebuggingPage.test.tsx`
- `src/infrastructure/http/debuggingClient.ts` — bridge list + pairing endpoints
- `src/infrastructure/http/debuggingDtos.ts`
- `src/styles.css`
- `e2e/debugging.api.spec.ts`
- `e2e/acceptance/operationMatrix.ts`
- `docs/developer/browser-acceptance-coverage-map.md`
- `docs/zh-CN/developer/browser-acceptance-coverage-map.md`
- `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`
- `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`
- `docs/developer/environment-variables.md`, `docs/zh-CN/developer/environment-variables.md`
- `docs/generated/db-schema.md`

## Acceptance Coverage Impact

- New requirement ID: `BRIDGE-WIN-001`
- New operation ID: `BRIDGE-WIN-001`
- Affected specs:
  - `e2e/acceptance/local-device-bridge.acceptance.spec.ts` (conditional Windows hardware)
  - `e2e/acceptance/debugging-simulator.acceptance.spec.ts` (must keep passing unchanged)
- Existing simulator and server-hosted debugging evidence must remain green.

## Documentation Impact Matrix

| Area | Action | Files |
| --- | --- | --- |
| Spec / plan | Update | `docs/superpowers/specs/2026-06-23-local-device-bridge-design.md`, this plan |
| Architecture / domain | Update | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md` |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` |
| Security | Update | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md` |
| Environment | Update | `.env.example`, `docs/developer/environment-variables.md`, Chinese companion |
| Self-hosted ops | Update | `ops/self-hosted/README.md`, `Caddyfile.example`, `compose.yaml` |
| Runbooks | Update | new `docs/runbooks/local-device-bridge.md` + zh-CN |
| Generated schema | Update | `docs/generated/db-schema.md` |
| API contract | Review | `docs/design-docs/api-contract.md`, Chinese companion |
| Product specs | Review | `docs/product-specs/mvp-scope.md` |
| References | No change | `docs/references/*` |

## Documentation Update Gate

- [ ] `npm run docs:check` passes after doc updates.
- [ ] Every `Update` row above is either changed or explicitly recorded unchanged in the plan completion note.
- [ ] Browser acceptance coverage map lists `BRIDGE-WIN-001`.

---

## Task 1: Shared ADB Command Core

**Files:**
- Create: `packages/device-command-core/package.json`
- Create: `packages/device-command-core/src/adbRunner.ts`
- Create: `packages/device-command-core/src/adbTargets.ts`
- Create: `packages/device-command-core/src/remoteNodeWrite.ts`
- Create: `packages/device-command-core/src/adbRunner.test.ts`
- Modify: `server/modules/debugging/adbGateway.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing parser/runner tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { createAdbCommandRunner, parseAdbDevices } from "./adbRunner";

describe("device-command-core adb", () => {
  it("parses adb devices output", () => {
    expect(parseAdbDevices("List of devices attached\nemulator-5554\tdevice\n")).toEqual([
      { targetRef: "emulator-5554", online: true }
    ]);
  });

  it("runs adb with argv arrays", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => event === "close" && cb(0))
    });
    const run = createAdbCommandRunner({ spawnImpl: spawn as never, command: "adb" });
    await run(["devices"], { timeoutMs: 1000 });
    expect(spawn).toHaveBeenCalledWith("adb", ["devices"], expect.objectContaining({ windowsHide: true }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run bridge:test -- packages/device-command-core/src/adbRunner.test.ts`
Expected: FAIL because package does not exist.

- [ ] **Step 3: Implement minimal shared package**

Move `buildRemoteWriteShellCommand`, `normalizeRemoteReadValue`, `shellQuote` usage and adb spawn runner from `server/modules/debugging/adbGateway.ts` into `packages/device-command-core`. Re-export thin wrappers from `adbGateway.ts` so existing server tests stay green.

- [ ] **Step 4: Run server and package tests**

Run: `npm run test:server -- server/modules/debugging/adbGateway.test.ts packages/device-command-core/src/adbRunner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/device-command-core server/modules/debugging/adbGateway.ts package.json
git commit -m "refactor: extract shared adb command core for bridge reuse"
```

---

## Task 2: Database Migration

**Files:**
- Create: `server/migrations/0022_local_device_bridge.sql`

- [ ] **Step 1: Add migration SQL**

```sql
create table if not exists device_bridges (
  id text primary key,
  organization_id text not null,
  user_id text not null,
  machine_label text not null,
  platform text not null,
  arch text not null,
  client_version text,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table if not exists device_bridge_tokens (
  id text primary key,
  bridge_id text not null references device_bridges(id),
  token_hash text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists device_bridge_pairing_codes (
  id text primary key,
  organization_id text not null,
  user_id text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table debugging_sessions
  add column if not exists execution_mode text not null default 'server',
  add column if not exists bridge_id text,
  add column if not exists bridge_machine_label text;

alter table debugging_targets
  add column if not exists bridge_id text;
```

- [ ] **Step 2: Apply migration locally**

Run: `npm run db:migrate`
Expected: migration `0022_local_device_bridge` applied.

- [ ] **Step 3: Regenerate schema doc**

Run: `npm run db:schema:docs`
Expected: `docs/generated/db-schema.md` includes new tables.

- [ ] **Step 4: Commit**

```bash
git add server/migrations/0022_local_device_bridge.sql docs/generated/db-schema.md
git commit -m "feat: add local device bridge persistence tables"
```

---

## Task 3: Bridge Token And Pairing Service

**Files:**
- Create: `server/modules/deviceBridge/token.ts`
- Create: `server/modules/deviceBridge/token.test.ts`
- Create: `server/modules/deviceBridge/pairingService.ts`
- Create: `server/modules/deviceBridge/pairingService.test.ts`
- Create: `server/modules/deviceBridge/types.ts`
- Create: `server/modules/deviceBridge/schemas.ts`
- Create: `server/modules/deviceBridge/schemas.test.ts`
- Create: `server/modules/deviceBridge/repository.ts`
- Create: `server/modules/deviceBridge/repository.test.ts`

- [ ] **Step 1: Write failing pairing tests**

```ts
import { describe, expect, it } from "vitest";
import { createPairingService } from "./pairingService";

describe("pairingService", () => {
  it("issues a 6-digit code and rejects reuse", async () => {
    const repo = {
      createPairingCode: vi.fn().mockResolvedValue(undefined),
      consumePairingCode: vi.fn()
        .mockResolvedValueOnce({ userId: "u-1", organizationId: "org-1" })
        .mockResolvedValueOnce(null)
    };
    const service = createPairingService({ repo: repo as never, now: () => new Date("2026-06-23T00:00:00Z") });
    const issued = await service.issuePairingCode({ userId: "u-1", organizationId: "org-1" });
    expect(issued.code).toMatch(/^\d{6}$/);
    const paired = await service.pairWithCode({ code: issued.code, machineLabel: "WIN-PC", platform: "windows", arch: "amd64" });
    expect(paired.bridgeToken).toMatch(/^wb_/);
    await expect(service.pairWithCode({ code: issued.code, machineLabel: "WIN-PC", platform: "windows", arch: "amd64" })).rejects.toThrow(/consumed/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- server/modules/deviceBridge/pairingService.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement token hashing + pairing service**

Use SHA-256 for pairing-code and bridge-token hashes. Issue bridge token prefix `wb_`. Scopes: `device-bridge:connect`, `device-bridge:execute`.

- [ ] **Step 4: Run tests**

Run: `npm run test:server -- server/modules/deviceBridge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/modules/deviceBridge
git commit -m "feat: add device bridge pairing and scoped tokens"
```

---

## Task 4: WebSocket Connection Pool And RPC

**Files:**
- Create: `server/modules/deviceBridge/protocol.ts`
- Create: `server/modules/deviceBridge/rpc.ts`
- Create: `server/modules/deviceBridge/rpc.test.ts`
- Create: `server/modules/deviceBridge/connectionPool.ts`
- Create: `server/modules/deviceBridge/connectionPool.test.ts`
- Create: `server/modules/deviceBridge/wsHandler.ts`

- [ ] **Step 1: Write failing RPC timeout test**

```ts
import { describe, expect, it } from "vitest";
import { createBridgeRpcClient } from "./rpc";

describe("bridge rpc", () => {
  it("times out when bridge does not answer", async () => {
    const pool = {
      send: vi.fn(() => new Promise(() => undefined))
    };
    const rpc = createBridgeRpcClient({ pool: pool as never, now: () => Date.now() });
    await expect(rpc.call("br-1", "debug.detectTargets", { protocol: "adb", timeoutMs: 10 }, { timeoutMs: 20 }))
      .rejects.toThrow(/timed out/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- server/modules/deviceBridge/rpc.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement pool + RPC envelope**

Message types:

```ts
export type BridgeRpcRequest = {
  type: "rpc.request";
  id: string;
  method: "bridge.getCapabilities" | "debug.detectTargets" | "debug.readNode" | "debug.writeNode";
  params: Record<string, unknown>;
  deadlineAt: string;
};
```

Serialize commands per `bridgeId`. Track `lastSeenAt` on ping.

- [ ] **Step 4: Implement `wsHandler` auth**

Parse `Authorization: Bridge <token>`, validate hash + expiry, attach `bridgeId` to socket, register in pool.

- [ ] **Step 5: Run pool/rpc tests**

Run: `npm run test:server -- server/modules/deviceBridge/connectionPool.test.ts server/modules/deviceBridge/rpc.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/modules/deviceBridge/protocol.ts server/modules/deviceBridge/rpc.ts server/modules/deviceBridge/connectionPool.ts server/modules/deviceBridge/wsHandler.ts
git commit -m "feat: add device bridge websocket pool and rpc client"
```

---

## Task 5: Bridge HTTP Routes And Release Manifest

**Files:**
- Create: `server/modules/deviceBridge/releaseManifest.ts`
- Create: `server/modules/deviceBridge/releaseManifest.test.ts`
- Create: `server/modules/deviceBridge/routes.ts`
- Create: `server/modules/deviceBridge/routes.test.ts`
- Create: `ops/self-hosted/bridge-artifacts/0.1.0/manifest.json`
- Modify: `server/app.ts`
- Modify: `server/config/env.ts`

- [ ] **Step 1: Write manifest test**

```ts
import { describe, expect, it } from "vitest";
import { loadBridgeReleaseManifest } from "./releaseManifest";

describe("bridge release manifest", () => {
  it("returns windows-first same-origin download urls", async () => {
    const manifest = await loadBridgeReleaseManifest("ops/self-hosted/bridge-artifacts/0.1.0/manifest.json");
    expect(manifest.recommendedVersion).toBe("0.1.0");
    expect(manifest.items.find((item) => item.platform === "windows")?.downloadUrl)
      .toBe("/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- server/modules/deviceBridge/releaseManifest.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement routes**

```text
POST /api/v1/device-bridges/pairing-codes          user auth
POST /api/v1/device-bridges/pair                     public + code
GET  /api/v1/device-bridges/mine                     user auth
POST /api/v1/device-bridges/:bridgeId/revoke         user auth
GET  /api/v1/device-bridges/releases                 public
WSS  /api/v1/device-bridges/ws                       bridge auth
```

- [ ] **Step 4: Wire routes in `server/app.ts`**

Attach WS upgrade handler only when `server` instance supports it; keep existing app tests injectable with fake pool.

- [ ] **Step 5: Run route tests**

Run: `npm run test:server -- server/modules/deviceBridge/routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/modules/deviceBridge/routes.ts server/modules/deviceBridge/releaseManifest.ts server/app.ts server/config/env.ts ops/self-hosted/bridge-artifacts/0.1.0/manifest.json
git commit -m "feat: add device bridge http routes and release manifest"
```

---

## Task 6: Debugging Service Bridge Execution

**Files:**
- Create: `server/modules/debugging/bridgeExecution.ts`
- Create: `server/modules/debugging/bridgeExecution.test.ts`
- Modify: `server/modules/debugging/service.ts`
- Modify: `server/modules/debugging/repository.ts`
- Modify: `server/modules/debugging/types.ts`
- Modify: `server/modules/debugging/schemas.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write failing parallel detect test**

```ts
import { describe, expect, it, vi } from "vitest";
import { detectTargetsAcrossBridges } from "./bridgeExecution";

describe("bridgeExecution", () => {
  it("returns only bridges that found adb targets", async () => {
    const rpc = {
      call: vi.fn()
        .mockResolvedValueOnce({ targets: [{ targetRef: "serial-1", online: true, label: "serial-1" }] })
        .mockResolvedValueOnce({ targets: [] })
    };
    const result = await detectTargetsAcrossBridges({
      rpc: rpc as never,
      bridges: [
        { id: "br-1", machineLabel: "Laptop" },
        { id: "br-2", machineLabel: "Desktop" }
      ],
      protocol: "adb",
      timeoutMs: 1000
    });
    expect(result).toEqual([
      expect.objectContaining({ bridgeId: "br-1", targetRef: "serial-1", id: "bridge:br-1:adb:serial-1" })
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- server/modules/debugging/bridgeExecution.test.ts`
Expected: FAIL

- [ ] **Step 3: Integrate into `service.detectTargets`**

When request is user-initiated and online bridges exist for the user, run bridge detect path before/alongside server gateway detect. Persist `bridge_id` on `debugging_targets`.

- [ ] **Step 4: Integrate read/write path**

If active session has `execution_mode=bridge`, resolve binding node path on server, then RPC `debug.readNode` / `debug.writeNode` to `session.bridge_id`. Preserve lease, snapshot, audit ordering exactly as server path.

- [ ] **Step 5: Extend `createSession`**

Require `bridgeId` when selected target id starts with `bridge:`.

- [ ] **Step 6: Run debugging service tests**

Run: `npm run test:server -- server/modules/debugging/bridgeExecution.test.ts server/modules/debugging/service.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/modules/debugging/bridgeExecution.ts server/modules/debugging/service.ts server/modules/debugging/repository.ts server/modules/debugging/types.ts server/index.ts
git commit -m "feat: route debugging operations through connected device bridges"
```

---

## Task 7: Windows Device Bridge CLI

**Files:**
- Create: `packages/device-bridge/*`
- Create: `scripts/build-device-bridge.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing config test**

```ts
import { describe, expect, it } from "vitest";
import { loadBridgeConfig, saveBridgeConfig } from "./config";

describe("bridge config", () => {
  it("stores windows-local config under LOCALAPPDATA", () => {
    const path = resolveBridgeConfigPath({ platform: "win32", localAppData: "C:/Users/test/AppData/Local" });
    expect(path).toBe("C:/Users/test/AppData/Local/WiseEff/bridge.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run bridge:test -- packages/device-bridge/src/config.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement CLI commands**

```bash
wiseeff-bridge pair --server https://wiseeff.example.com --code 123456
wiseeff-bridge start
wiseeff-bridge status
```

`start` must:

- open localhost health server on `127.0.0.1:18787`
- connect WSS with bridge token
- handle RPC methods for phase 1: `bridge.getCapabilities`, `debug.detectTargets`, `debug.readNode`, `debug.writeNode`
- use `device-command-core` for adb only

- [ ] **Step 4: Add Windows build script**

`npm run bridge:build` produces:

```text
ops/self-hosted/bridge-artifacts/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip
```

Use `pkg` or `esbuild` + bundled runtime; pick one tool and pin version in script.

- [ ] **Step 5: Run bridge tests**

Run: `npm run bridge:test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/device-bridge scripts/build-device-bridge.ts package.json ops/self-hosted/bridge-artifacts
git commit -m "feat: add windows device bridge cli and build script"
```

---

## Task 8: Self-Hosted Same-Origin Downloads

**Files:**
- Modify: `ops/self-hosted/Caddyfile.example`
- Modify: `ops/self-hosted/compose.yaml`
- Create: `ops/self-hosted/bridge-artifacts/README.md`
- Create: `ops/self-hosted/bridge-artifacts/README.zh-CN.md`

- [ ] **Step 1: Add Caddy static route**

```caddyfile
handle /downloads/device-bridge/* {
  root * /bridge-artifacts
  file_server
}
```

- [ ] **Step 2: Mount artifacts volume in compose**

Mount `./bridge-artifacts` into proxy container at `/bridge-artifacts`.

- [ ] **Step 3: Verify manifest endpoint and static path locally**

Run:

```bash
npm run dev:api
curl -s http://127.0.0.1:8787/api/v1/device-bridges/releases | jq .
```

Expected: Windows item with relative `downloadUrl`.

- [ ] **Step 4: Commit**

```bash
git add ops/self-hosted/Caddyfile.example ops/self-hosted/compose.yaml ops/self-hosted/bridge-artifacts/README.md ops/self-hosted/bridge-artifacts/README.zh-CN.md
git commit -m "ops: serve device bridge artifacts from self-hosted origin"
```

---

## Task 9: Frontend Connect-Local-Device Panel (Windows-first)

**Files:**
- Modify: `src/NodeDebuggingPage.tsx`
- Modify: `src/NodeDebuggingPage.test.tsx`
- Modify: `src/infrastructure/http/debuggingClient.ts`
- Modify: `src/infrastructure/http/debuggingDtos.ts`
- Modify: `src/styles.css`
- Modify: `e2e/acceptance/operationMatrix.ts`
- Modify: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/zh-CN/developer/browser-acceptance-coverage-map.md`

- [ ] **Step 1: Write failing UI test**

```tsx
it("shows windows download CTA when local bridge is missing", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 404 })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ recommendedVersion: "0.1.0", items: [{ platform: "windows", downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip" }] }) }));
  render(<NodeDebuggingPage ... />);
  await user.click(screen.getByRole("button", { name: /连接本地设备/i }));
  expect(screen.getByText(/windows/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /下载设备代理/i })).toHaveAttribute("href", "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/NodeDebuggingPage.test.tsx -t "windows download"`
Expected: FAIL

- [ ] **Step 3: Implement panel states**

States from spec:

1. bridge missing
2. installed not paired
3. paired not running
4. online no device
5. bridge(s) with targets

Use new API client helpers:

```ts
createDeviceBridgeClient().createPairingCode()
createDeviceBridgeClient().listMyBridges()
createDeviceBridgeClient().listReleases()
probeLocalBridgeHealth()
```

- [ ] **Step 4: Run component tests and build**

Run: `npm test -- src/NodeDebuggingPage.test.tsx && npm run build`
Expected: PASS

- [ ] **Step 5: Add operation matrix row `BRIDGE-WIN-001`**

- [ ] **Step 6: Commit**

```bash
git add src/NodeDebuggingPage.tsx src/NodeDebuggingPage.test.tsx src/infrastructure/http src/styles.css e2e/acceptance/operationMatrix.ts docs/developer/browser-acceptance-coverage-map.md docs/zh-CN/developer/browser-acceptance-coverage-map.md
git commit -m "feat: add windows-first local device bridge connect panel"
```

---

## Task 10: API And Conditional Acceptance

**Files:**
- Create: `e2e/acceptance/local-device-bridge.acceptance.spec.ts`
- Modify: `e2e/debugging.api.spec.ts`
- Create: `docs/runbooks/local-device-bridge.md`
- Create: `docs/zh-CN/runbooks/local-device-bridge.md`

- [ ] **Step 1: Add API integration test with fake bridge pool**

Extend `e2e/debugging.api.spec.ts` with an in-process fake bridge connection that returns one adb target and verify:

- detect returns `bridge:*` target id
- create session stores `execution_mode=bridge`
- governed write still requires confirmation token

- [ ] **Step 2: Add conditional Windows acceptance spec**

Gate with:

```bash
DEVICE_BRIDGE_LAB_AVAILABLE=true
DEVICE_BRIDGE_SERVER_URL=https://<same-origin>
```

Flow: download manifest, pair, start bridge, detect, read, optional write with confirmations.

- [ ] **Step 3: Run automated gates**

Run:

```bash
npm run test:server -- server/modules/deviceBridge server/modules/debugging/bridgeExecution.test.ts
npm run test:all
npm run build
npm run test:e2e -- e2e/debugging.api.spec.ts
```

Expected: PASS; Windows acceptance skipped unless lab env set.

- [ ] **Step 4: Update docs and env examples**

Document:

```text
DEVICE_BRIDGE_ARTIFACT_ROOT=ops/self-hosted/bridge-artifacts
DEVICE_BRIDGE_PAIRING_TTL_SECONDS=300
DEVICE_BRIDGE_TOKEN_TTL_DAYS=90
DEVICE_BRIDGE_LAB_AVAILABLE=false
```

- [ ] **Step 5: Run docs check**

Run: `npm run docs:check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add e2e docs/runbooks/local-device-bridge.md docs/zh-CN/runbooks/local-device-bridge.md .env.example ops/self-hosted/.env.example docs/FRONTEND.md docs/zh-CN/frontend.md docs/SECURITY.md docs/zh-CN/SECURITY.md
git commit -m "test: add local device bridge api coverage and runbook"
```

---

## Final Verification Gate

Run:

```bash
npm run docs:check
npm run test:all
npm run build
npm run test:e2e -- e2e/debugging.api.spec.ts
npm run acceptance:coverage
npm run acceptance:operations
```

Manual Windows validation:

1. Build and place Windows zip in `ops/self-hosted/bridge-artifacts/0.1.0/windows/amd64/`
2. Open remote `/node-debugging`
3. Download from same origin
4. `wiseeff-bridge pair` + `start`
5. Detect phone, read node, write with confirmation, verify audit entry shows `executorType=device_bridge`

## Phase 2 Handoff (Not In This Plan)

- HDC RPC in bridge
- Windows service install/start
- Bridge management settings page
- macOS/Linux release artifacts
