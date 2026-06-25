# WiseEff Bridge 安装包构建

图形化安装包（Windows x64、macOS arm64/amd64）构建说明。

## 前置条件

- Node.js 22+ 与 `npm ci`
- `npm run bridge:build`
- **Windows：** Inno Setup 6（`iscc` 在 PATH）、PowerShell
- **macOS：** `pkgbuild`、`bash`

## 命令

```bash
npm run bridge:build
npm run build:bridge-installers
```

产物写入 `ops/self-hosted/bridge-artifacts/0.1.0/`，并在 `manifest.json` 中追加 `artifactKind: "installer"` 条目。

## URL scheme

- Windows 注册表：`wiseeff-bridge://` → `wiseeff-bridge.exe --handle-url "%1"`
- macOS `Info.plist`：`CFBundleURLSchemes` = `wiseeff-bridge`
- macOS `.pkg` postinstall 为安装用户注册 `~/Library/LaunchAgents/com.wiseeff.bridge.plist` 并通过 `launchctl` 加载

## 说明

- 安装包内嵌固定版本 Node 与 esbuild CLI 包。
- 当前未签名；试点阶段 Gatekeeper / SmartScreen 提示属预期。
- 未内置 `adb` / `hdc`（Phase B/C）。

> English: [README.md](./README.md)
