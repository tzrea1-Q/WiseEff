# 本地 Device Bridge 运行手册

> English: [English](../../runbooks/local-device-bridge.md)

本手册用于 WiseEff Local Device Bridge Phase 1–2（本地/自托管）操作，包括配对、HDC/ADB RPC、Windows 服务生命周期、连通性检查与条件验收执行。

## 适用范围

- Phase 1–2 以 Windows 与 macOS 的 Bridge 配对、运行时为主；Windows 另支持可选服务安装。
- Bridge RPC 在工程师本机同时支持 `adb` 与 `hdc`；服务端治理边界不变。
- Bridge-backed 会话仍受后端调试权限、lease、确认 token、快照回滚与审计约束。
- 本文关注本地/自托管操作流程，不覆盖托管云发布流程。

## 必需环境变量

服务端运行变量：

```text
DEVICE_BRIDGE_ARTIFACT_ROOT=ops/self-hosted/bridge-artifacts
DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT=ops/self-hosted/bridge-tool-artifacts
DEVICE_BRIDGE_PAIRING_TTL_SECONDS=300
DEVICE_BRIDGE_TOKEN_TTL_DAYS=90
DEVICE_BRIDGE_WS_PATH=/api/v1/device-bridges/ws
```

条件验收变量：

```text
DEVICE_BRIDGE_LAB_AVAILABLE=true
DEVICE_BRIDGE_SERVER_URL=https://<你的-wiseeff-域名>
```

可选验收辅助变量：

```text
DEVICE_BRIDGE_LAB_USER_ID=u-xu-yun
DEVICE_BRIDGE_LAB_ENABLE_WRITE=false
DEVICE_BRIDGE_LAB_WRITE_VALUE=3150
DEVICE_BRIDGE_LAB_CONFIRM_WRITE=confirm-high-risk-write
```

可选 HDC 设备实验室验收（需要已配对的真实 Bridge、`hdc` 在 PATH 中且设备已连接）：

```text
DEVICE_BRIDGE_HDC_AVAILABLE=true
```

## 制品与 Manifest 检查

1. 确认 `DEVICE_BRIDGE_ARTIFACT_ROOT` 下存在 Bridge 制品。
2. 验证 manifest 接口：
   - `GET /api/v1/device-bridges/releases`
3. 确认 manifest 包含当前运维平台制品，且下载地址为同源相对路径：
   - Windows 安装包（主路径）：`/downloads/device-bridge/<version>/windows/amd64/WiseEffBridgeSetup_<version>.exe`
   - macOS 安装包（主路径）：`/downloads/device-bridge/<version>/darwin/<arch>/WiseEffBridge_<version>_darwin_<arch>.pkg`
   - 便携包仍可用于高级/命令行流程（`artifactKind: "portable"`）。

## 主路径（Phase A — 零摩擦）

1. 登录后打开 `/node-debugging`。
2. 点击 **安装 Bridge**，下载与浏览器平台匹配的安装包。
3. 以默认选项运行安装包；会注册 `wiseeff-bridge://`、安装 Bridge，并启动 Windows 后台服务或 macOS `.pkg` postinstall 注册的 LaunchAgent。
4. 回到 `/node-debugging`，点击 **连接本地设备**；页面生成配对码并打开 `wiseeff-bridge://connect?server=<origin>&code=<6位码>`。
5. Bridge 本地执行 `connect`（必要时 pair，然后非阻塞启动）；30 秒内 `http://127.0.0.1:18787/health` 应出现 `connected: true`。
6. 插入 USB 设备、授权调试，点击 **重新检测设备**。

兜底：展开 **高级 · 命令行方式** 使用 `wiseeff-bridge connect` / `pair` / `start`，或从托盘/菜单栏启动 Bridge。

构建机生成安装包：

```bash
npm run bridge:build
npm run build:bridge-installers
```

详见 `ops/self-hosted/bridge-installer/README.zh-CN.md`。

### macOS `.pkg` 安装失败排查

若安装器在「摘要」步骤报「安装失败」，先查日志：

```bash
sudo tail -80 /var/log/install.log | rg -i 'wiseeff|postinstall|error'
sudo cat /var/log/wiseeff-bridge-install.log
```

安装器内也可打开 **窗口 → 安装日志**（`Cmd+L`）。`postinstall` 失败时，应用可能已复制到 `/Applications/WiseEff Bridge.app`，但 LaunchAgent 未注册。

## macOS 安装（便携包 — 高级）

1. 从 `/node-debugging` 或 `GET /api/v1/device-bridges/releases` 下载匹配的 macOS 制品。
2. 解压：

```bash
tar -xzf wiseeff-bridge_<version>_darwin_arm64.tar.gz
chmod +x wiseeff-bridge
```

3. 配对并启动：

```bash
./wiseeff-bridge pair --server https://<你的-wiseeff-域名> --code <6位配对码>
./wiseeff-bridge start
```

说明：

- 压缩包内含 `cli.js` 与 `wiseeff-bridge` 启动脚本（内部执行 `node cli.js`）。
- 配置保存在 `~/.wiseeff/bridge.json`。
- macOS `.pkg` 安装包通过 postinstall 注册 `~/Library/LaunchAgents/com.wiseeff.bridge.plist`；便携包需手动用 `launchd` 或终端保持运行。
- macOS 不使用 Windows 的 `service` 子命令。
- 在 Mac 上安装 `adb` 和/或 `hdc`，并完成 USB 授权后，再在 `/node-debugging` 中检测设备。

## 配对流程

1. 已认证用户申请配对码：
   - `POST /api/v1/device-bridges/pairing-codes`
2. Bridge CLI 交换配对码：
   - `POST /api/v1/device-bridges/pair`
3. Bridge 保存 `bridgeToken` 并发起：
   - `WSS /api/v1/device-bridges/ws`，请求头 `Authorization: Bridge <token>`
4. 运维校验 Bridge 归属与列表：
   - `GET /api/v1/device-bridges/mine`

## HDC 与 ADB Bridge RPC

Bridge CLI 在本机执行 `adb` 与 `hdc`，argv、超时与 shell 转义规则与服务端 gateway adapter 一致。

- `bridge.getCapabilities` 报告 Bridge 主机上 `adb` / `hdc` 是否可用。
- `debug.detectTargets` 接受 `protocol=adb` 或 `protocol=hdc`，并返回对应协议的目标列表。
- `debug.readNode` / `debug.writeNode` 使用与会话相同的协议与 target ref。

运维检查：

1. 在启动 Bridge 的同一 shell 上下文中确认 `hdc` 或 `adb` 在 PATH 中。
2. 完成配对并启动 Bridge，确认 `GET /api/v1/device-bridges/mine` 显示 Bridge 在线。
3. 调用 `POST /api/v1/debugging/targets/detect`（`protocol=hdc` 或 `protocol=adb`），确认返回 `bridge:<bridgeId>:...` 目标 id。

## 调试执行检查

通过 `/api/v1/debugging/*` 验证 bridge-backed 行为：

- detect 返回包含 `bridge:<bridgeId>:...` 目标 id
- 创建 session 后持久化 `execution_mode=bridge`
- 高风险写入缺少确认 token 时返回校验失败
- 带 `confirm-high-risk-write` 的高风险写入成功并生成快照元数据
- 多个在线 Bridge 同时返回目标时，前端要求显式选择目标后再创建 session

## 条件验收执行

仅在本地 Bridge lab 可用时执行：

```bash
DEVICE_BRIDGE_LAB_AVAILABLE=true \
DEVICE_BRIDGE_SERVER_URL=https://<你的-wiseeff-域名> \
npm run acceptance:e2e -- e2e/acceptance/local-device-bridge.acceptance.spec.ts
```

未设置 `DEVICE_BRIDGE_LAB_AVAILABLE=true` 时，该验收默认 skip。

同一文件中的 HDC 设备实验室 stub 仅在 `DEVICE_BRIDGE_HDC_AVAILABLE=true` 且存在已配对、具备 HDC 的真实 Bridge 时运行；CI 保持 skip，供手工硬件实验室取证。

## Windows 服务（Phase 2）

在 Windows 上以提升权限终端执行以下命令（需先完成 Bridge 配对）。

安装会通过 `sc.exe` 注册名为 `WiseEffBridge` 的后台服务。CLI 会在 `%LOCALAPPDATA%\\WiseEff\\device-bridge\\start-service.cmd` 写入包装脚本，用于执行 `node <cli.js> start`。

```powershell
wiseeff-bridge service install
wiseeff-bridge service start
wiseeff-bridge service stop
wiseeff-bridge service uninstall
```

说明：

- 启动服务前先完成配对（`wiseeff-bridge pair ...`）。
- `service install|start|stop|uninstall` 仅支持 Windows；其他平台会返回明确的不支持提示。
- `uninstall` 会停止服务、删除 Windows 服务项，并在存在时移除包装脚本。

## 排障建议

- **Scheme 本地 connect 被拒绝**：`wiseeff-bridge` 仅接受 `https` 服务端 URL（本地开发可用 `http://localhost` / `127.0.0.1`）及 6 位配对码。
- **Manifest 缺少 Windows 制品**：检查 `DEVICE_BRIDGE_ARTIFACT_ROOT` 与制品目录结构。
- **Bridge WebSocket 被拒绝**：检查 token TTL/scope 与服务器时间偏差。
- **detect 只有服务端目标**：确认 Bridge 在线（`/device-bridges/mine`）且已连接 WS 路径。
- **HDC detect 为空但设备已连接**：在 Bridge 主机 shell 中确认 `hdc list targets` 可用，并在修改 PATH 后重启 Bridge。
- **Bridge 健康检查显示 ADB/HDC 不可用**：在 Bridge 主机安装平台工具并重启 Bridge 进程或 Windows 服务。
- **多个 Bridge 选错机器**：在 `/node-debugging` 的设备代理管理中设置机器名，并通过多 Bridge 目标选择器确认后再创建 session。
- **写入被拒绝**：确认角色具备 `debugging:write`，高风险参数需 `confirm-high-risk-write`。
- **回滚冲突或拒绝**：检查 lease/session 归属与 snapshot 状态。
