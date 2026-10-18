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

产物写入 `ops/self-hosted/bridge-artifacts/<BRIDGE_CLIENT_VERSION>/`，并在 `manifest.json` 中追加 `artifactKind: "installer"` 条目。打包后的 CLI 报告的 `clientVersion` 必须与 `packages/device-bridge/src/version.ts` 一致。运行时源码变更后需重建制品，使 `npm run bridge:package:check` 保持通过。

仅重建一个平台时会保留其他已发布的安装包。Windows 构建脚本默认读取 Bridge 包版本；直接调用 Inno Setup 编译器时，必须传入 `/DMyAppVersion=<version>`。

## URL scheme

- Windows 注册表：`wiseeff-bridge://` → `wiseeff-bridge.cmd --handle-url "%1"`
- macOS `Info.plist`：`CFBundleURLSchemes` = `wiseeff-bridge`
- macOS `.pkg` postinstall 为安装用户注册 `~/Library/LaunchAgents/com.wiseeff.bridge.plist` 并通过 `launchctl` 加载
- macOS **portable**（`.tar.gz`）：解压后运行 `wiseeff-bridge register` 注册 `wiseeff-bridge://`（wrapper 位于 `~/.wiseeff/WiseEffBridgeLauncher.app`）；`wiseeff-bridge unregister` 可移除

## macOS 安装失败排查

安装器报错时，按顺序查看：

1. **系统安装日志：** `sudo tail -100 /var/log/install.log | rg -i wiseeff`
2. **Bridge 安装日志（0.1.0+）：** `sudo cat /var/log/wiseeff-bridge-install.log`
3. **安装器内日志：** 安装器菜单 **窗口 → 安装日志**（或 `Cmd+L`）

常见原因：`postinstall` 脚本失败（例如 bash 保留变量 `UID` 被误赋值，已在后续版本修复为 `CONSOLE_UID`）。

## 说明

- 安装包内嵌固定版本 Node 与 esbuild CLI 包。
- Windows 后台服务通过 `sc create` 注册为 `node.exe` + `cli.js start`（**不能**把 `start-service.cmd` 作为服务 `binPath`，否则会 `sc start` 错误 87）。
- `npm run build:bridge-installers` 会**强制**先跑 `bridge:build`，并校验 bundle 含 `POST /connect` HTTP 路由后再打安装包。
- Windows 无 `zip` 命令时，`bridge:build` 使用 PowerShell `Compress-Archive` 生成 portable zip。
- Windows 升级时，安装器通过 Windows Restart Manager 关闭占用所选安装目录文件的进程，包括独立启动的 Bridge。出现关闭应用提示时，请同意后继续。安装器会启动更新后的后台服务，Restart Manager 不会重新拉起旧进程。若仍出现 `DeleteFile failed; code 5`，关闭从该目录运行的 Bridge 进程后重试。
- 当前未签名；试点阶段 Gatekeeper / SmartScreen 提示属预期。
- 未内置 `adb` / `hdc`（Phase B/C）。

> English: [README.md](./README.md)
