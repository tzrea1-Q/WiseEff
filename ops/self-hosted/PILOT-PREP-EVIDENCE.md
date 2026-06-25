# Device Bridge Pilot Prep — Evidence (2026-06-25)

Local prep on macOS arm64 dev machine before Win/Mac VM pilot. Services: `npm run dev:all` (`http://127.0.0.1:5173`, API `http://127.0.0.1:8787`).

## 1. Real tool artifacts + manifest SHA256

| Artifact | Platform | SHA256 (real) | Status |
| --- | --- | --- | --- |
| `adb-platform-tools.zip` | darwin/arm64, darwin/amd64 | `094a1395683c509fd4d48667da0d8b5ef4d42b2abfcd29f2e8149e2f989357c7` | Built via `npm run bridge-tool-artifacts:prepare` (Google platform-tools) |
| `adb-platform-tools.zip` | windows/amd64 | `4fe305812db074cea32903a489d061eb4454cbc90a49e8fea677f4b7af764918` | Same script |
| `hdc.zip` | darwin/arm64, darwin/amd64 | `43a1730815598d44b7c4c7ae21224d6cbaf6b545065cfbda329f998b80c6856f` | Packed from local `hdc` |
| `hdc.zip` | windows/amd64 | placeholder | **Pending** — build on Windows with `HDC_WINDOWS_SOURCE=...` |

Commands:

```bash
npm run bridge-tool-artifacts:prepare
npm run bridge-tool-artifacts:hash
```

## 2. Bridge installer / portable SHA256

| Artifact | Status |
| --- | --- |
| macOS `.pkg` arm64/amd64 | Rebuilt; real SHA256 in `bridge-artifacts/0.1.0/manifest.json` |
| macOS/darwin portable `.tar.gz` | Rebuilt with latest Phase B CLI |
| Windows portable `.zip` | Rebuilt |
| Windows `WiseEffBridgeSetup_0.1.0.exe` | **Still placeholder** — requires Windows + Inno Setup (`pwsh` + `iscc`) |

```bash
npm run bridge:build
npm run build:bridge-installers
```

## 3. Local API download routes (dev fix)

`npm run dev:all` previously returned **404** for `/downloads/device-bridge-tools/...` (Caddy-only in self-hosted). Added `server/modules/deviceBridge/downloadRoutes.ts` so local pilot matches production paths.

Verified:

```bash
curl -o /tmp/adb.zip http://127.0.0.1:8787/downloads/device-bridge-tools/0.1.0/darwin/arm64/adb-platform-tools.zip
# HTTP 200, sha256 matches manifest
```

## 4. B2 install smoke (local, not VM)

```bash
npx tsx scripts/run-bridge-pilot-tool-install-check.ts
# WISEEFF_PILOT_TOOLS_ROOT=/tmp/wiseeff-pilot-test for repeat runs
```

Results:

- Download + SHA256 verify + extract → managed path `.../adb/0.1.0/platform-tools/adb`
- `adb version` → `Android Debug Bridge version 1.0.41`
- `probeTools` → `available=true`, `source=managed`

## 5. Manual VM checklist (Phase B plan)

| # | Scenario | Local macOS | VM required |
| --- | --- | --- | --- |
| 1 | Connected, no adb on PATH → Step ③ 缺少 ADB | **Not run** (needs PATH-isolated VM) | Yes |
| 2 | Click 安装调试工具 → private dir + health tools | **Partial** — CLI install smoke above | Yes — URL scheme + wizard |
| 3 | USB + 重新检测 → bridge target | Not run | Yes |
| 4 | HDC path repeat | Not run | HDC lab VM |
| 5 | Idempotent re-install | Install skips re-download when `state.json` matches (fast second run) | Confirm in VM |

## 6. Next actions before pilot

1. **Windows build machine:** `npm run build:bridge-installers` → update Windows installer SHA256; `HDC_WINDOWS_SOURCE=... npm run bridge-tool-artifacts:prepare`.
2. **VM:** Run checklist §5 on clean Win 10/11 and macOS without adb/hdc on PATH.
3. **Optional:** `playwright-cli` on `/node-debugging` Step ③ (desktop/tablet/mobile) per AGENTS.md.
