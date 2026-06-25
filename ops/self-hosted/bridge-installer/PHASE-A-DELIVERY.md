# Device Bridge Phase A — Delivery Notes

Date: 2026-06-24  
Branch: `feat/device-bridge-dev`

## Summary

Phase A delivers zero-friction Bridge install/connect on Windows and macOS:

- CLI: `wiseeff-bridge connect --server <url> [--code <code]` and `--handle-url` for OS protocol activation (non-blocking; skips start when health already `connected: true`)
- Token expiry triggers re-pair when `--code` is supplied
- URL scheme: `wiseeff-bridge://connect?server=<origin>&code=<6-digit>` with https/local-http and 6-digit code validation
- Frontend 3-step wizard on `/node-debugging` with installer-first download, scheme launch, 30s health polling, and explicit timeout errors
- macOS `.pkg` postinstall registers LaunchAgent for end users (not on build machine)
- Release manifest `artifactKind: "installer" | "portable"` with installer build pipeline scripts

## Build installers (build machine)

```bash
npm ci
npm run bridge:build
npm run build:bridge-installers
```

Prerequisites: see [README.md](./README.md) (Inno Setup 6 on Windows, `pkgbuild` on macOS). On Linux CI, portable artifacts build; installer steps skip gracefully and manifest keeps placeholder installer SHA256 until built on Win/Mac.

## Manual VM validation (no terminal on main path)

1. Fresh Windows 10/11 x64 or macOS VM.
2. Deploy WiseEff with updated `bridge-artifacts/` (including installer entries).
3. Sign in, open `/node-debugging`, click **Install Bridge**, run the installer.
4. Click **Connect local device** (accept browser/scheme prompt once).
5. Within 30s, health should show connected; insert USB with `adb`/`hdc` preinstalled, then **Re-detect devices**.

Fallback: expand **Advanced · CLI** or launch Bridge from the tray/menu bar.

## Known limitations

- Installers are **unsigned** (SmartScreen / Gatekeeper warnings expected).
- `adb` / `hdc` are **not bundled**; operators must install tools until Phase B/C.
- Linux has no graphical installer (portable CLI only).
- No auto-update channel in Phase A.

## Verification run

```bash
npm run bridge:test -- packages/device-bridge/src/cli.test.ts packages/device-bridge/src/urlScheme.test.ts packages/device-bridge/src/connectCommand.test.ts
npm test -- src/infrastructure/http/bridgeReleaseSelection.test.ts src/infrastructure/http/bridgeConnectLauncher.test.ts
npm test -- src/NodeDebuggingPage.test.tsx
npm run test:server -- server/modules/deviceBridge/releaseManifest.test.ts server/modules/deviceBridge/schemas.test.ts
npm run build
npm run docs:check
```

Playwright-cli on `/node-debugging`: not run in this Linux agent environment; use manual VM steps above or run playwright-cli locally per `AGENTS.md`.

## PR readiness

Branch is ready for PR after CI passes on `feat/device-bridge-dev`.
