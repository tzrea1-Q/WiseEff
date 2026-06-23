# 本地设备代理（Device Bridge）设计

> English: [English](../../../superpowers/specs/2026-06-23-local-device-bridge-design.md)

日期：2026-06-23
状态：已认可，可进入实施计划

## 背景

WiseEff 当前的设备调试会在 **API 服务器所在机器** 上执行 `adb` 和 `hdc`。用户从浏览器访问远端部署的 WiseEff 时，无法调试 **USB 连接在自己电脑上** 的手机。

项目已具备：

- 带治理的调试 API（检测、会话、读写、快照、回滚、审计），
- 服务端 HDC/ADB 协议路由 gateway，
- 仅用于非 API 本地开发的 Vite HDC bridge，
- 以及独立的 **AI Agent** 能力（本设计中的 Device Bridge **不是** AI 智能体）。

本设计新增 **本地设备代理（Device Bridge）**：工程师在自有电脑上安装 CLI 守护进程，通过 **出站 WebSocket** 连接已部署的 WiseEff 服务器，在本地执行 `adb`/`hdc`，同时由服务器继续承担完整治理。

## 术语

| 术语 | 含义 |
| --- | --- |
| **Device Bridge** | 用户电脑上的 CLI 守护进程，执行本地 `adb`/`hdc` |
| **远端调试服务** | 现有 WiseEff debugging API 与治理层 |
| **AI Agent** | 现有对话/工具能力，不在本设计范围内 |

## 决策

- 保持 **远端完整治理**：鉴权、权限、session、设备租约、写前快照、回滚确认、审计仍在服务器。
- Bridge RPC 同时支持 **ADB 与 HDC**。
- Bridge 使用 **出站 WebSocket** 连接部署中的 WiseEff 服务器。
- Bridge 以 **CLI 守护进程** 交付，尽量减少用户配置。
- **每台机器每个用户一个 Bridge**；同一用户可注册多台电脑。
- 通过 **并行 detect** 选择 Bridge，只展示 **确实扫到设备** 的 Bridge。
- 使用 **独立 Bridge 凭证**（短时配对码兑换），不在 Bridge 中复用浏览器登录 token。
- Bridge 安装包由 **同一 WiseEff 部署域名** 提供下载，终端用户不依赖 GitHub 等外部下载源。
- v1 **优先兼容 Windows** 的安装包、守护进程生命周期和前端安装引导。

## 目标

- Windows 用户打开远端托管的 `/node-debugging`，可从同一域名下载 Bridge、完成配对，并调试 USB 连接在本机的手机。
- 读写/回滚仍走现有 debugging API，并保留租约、快照、审计与权限校验。
- 支持同一用户多台 Bridge 同时在线；UI 自动发现真正连着设备的那台机器。
- 运维可将 Bridge 制品纳入自托管发布，无需外部下载基础设施。

## 非目标

- 浏览器直接执行设备命令。
- Bridge 执行任意 shell。
- 前端或 Admin 配置 `adb`/`hdc` 路径。
- 替换服务端 HDC lab 或 simulator gateway。
- v1 不做 Bridge 内置自动更新。
- Windows v1 稳定前，不以 macOS/Linux 打包完成为首发门槛。

## 架构

推荐方案：**服务端 Gateway 委托**。

调试 service 保持相同业务流程。当 session 标记为 `execution_mode = bridge` 时，服务器不再本地 spawn `adb`/`hdc`，而是通过该用户 Bridge 的 WebSocket 发送 RPC，收到结果后再写入 operation、快照和审计。

```text
浏览器 -> HTTPS -> Debugging API（治理）
Device Bridge -> WSS -> Bridge 连接池 -> RPC -> 用户电脑上的 adb/hdc
```

### 组件

1. **Device Bridge CLI**
   - 子命令：`pair`、`start`、`status`
   - 本地执行 `adb`/`hdc`，复用从服务端 gateway 抽出的 argv/超时/引号规则
   - 维持出站 WSS、心跳与 RPC 处理
   - 仅暴露 localhost 健康检查，供前端检测安装/配对状态

2. **Bridge Registry（服务端）**
   - 持久化 Bridge 注册信息与哈希后的 Bridge token
   - 内存维护在线连接：`bridgeId -> WebSocket`
   - 发布同源 Bridge 制品 manifest

3. **Debugging Service 扩展**
   - session 增加 `execution_mode`、`bridge_id`
   - 对当前用户所有在线 Bridge 并行 detect
   - 当 execution mode 为 bridge 时，读写/回滚委托给 Bridge RPC

4. **前端配对与安装 UX**
   - 探测 `127.0.0.1` 上的 Bridge 健康状态
   - 展示同源下载与 **Windows 优先** 安装命令
   - 生成配对码并完成「连接本地设备」流程

## Windows 优先交付

v1 打包与 UX 必须以 Windows 为主要支持平台。

### Windows v1 要求

- 主要制品：`wiseeff-bridge_<version>_windows_amd64.zip`
- 可选后续制品：签名 Windows 安装包（`.msi` 或 `.exe`），首版不强制
- 配置路径：`%LOCALAPPDATA%\WiseEff\bridge.json`
- 本地健康检查默认：`http://127.0.0.1:18787/health`
- `start` 支持：
  - 前台控制台模式，便于首次验证
  - `--service install` / `--service start`，在 Windows 上后台常驻
- 安装文档与前端文案必须包含：
  - 基于部署域名的 PowerShell 下载/解压示例
  - Windows 下 `adb`/`hdc` PATH 配置说明
  - USB 驱动、设备授权排障说明

### v1 次要平台

- manifest 可同时列出 macOS/Linux 制品，但不作为首发验收门槛。
- 前端在非 Windows 制品存在时仍可展示，但不放在主 CTA 位置。

## 配对与 Bridge Token 安全

### 配对流程

1. 用户打开 `/node-debugging`，点击 **连接本地设备**。
2. 前端检查 `http://127.0.0.1:18787/health`。
3. 若未安装 Bridge，调用 `GET /api/v1/device-bridges/releases`，展示同源 Windows 下载按钮与可复制安装命令。
4. 前端调用 `POST /api/v1/device-bridges/pairing-codes` 生成配对码。
5. 用户执行 `wiseeff-bridge pair --server https://<同域> --code <code>`，或通过自定义 URL scheme 唤起。
6. Bridge 用配对码换取 `bridgeId` 与 bridge token，并写入本地配置。
7. 用户执行 `wiseeff-bridge start`，Bridge 与服务器建立 WSS。
8. 前端刷新 `GET /api/v1/device-bridges/mine`，进入 detect 流程。

### 配对码规则

- 6 位数字
- 有效期 5 分钟
- 一次性使用
- 绑定创建者 `userId`

### Bridge token 规则

- 仅能通过配对码兑换获得
- 数据库只存哈希
- Scope：`device-bridge:connect`、`device-bridge:execute`
- 不能调用普通管理/业务 API
- 默认有效期 90 天；重新配对时轮换
- 可在用户设置中按 Bridge 撤销

### 安全边界

- 浏览器用户 Bearer token **不得**写入 Bridge 配置。
- 写操作仍要求用户正常 API 鉴权与 `debugging:write`。
- Bridge 仅在服务端完成租约与快照检查后执行 RPC。
- 审计同时记录用户 actor 与执行 Bridge。

## 同源 Bridge 分发

终端用户必须从正在使用的 WiseEff 部署域名下载 Bridge。

### 下载入口

- 元数据 API：`GET /api/v1/device-bridges/releases`
- 静态文件：`GET /downloads/device-bridge/<version>/<platform>/<arch>/<artifact>`

API 返回相对路径 `downloadUrl`，保证浏览器始终停留在同一域名。

### 运维打包

```text
ops/self-hosted/bridge-artifacts/
  0.1.0/
    manifest.json
    windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip
    darwin/arm64/...
    linux/amd64/...
```

v1 推荐托管方式：

- 将 `bridge-artifacts` 挂载到反向代理
- 以只读静态文件方式提供 `/downloads/device-bridge/*`
- 以 `manifest.json` 作为版本与 SHA-256 的权威来源

多节点场景可后续改为对象存储托管。

### 版本兼容

- Bridge 在 WSS hello 时上报 `clientVersion`
- 服务端暴露 `recommendedVersion` 与 `minCompatibleVersion`
- 版本过旧时返回 `BRIDGE_VERSION_UNSUPPORTED`，前端引导用户回到同源下载页

## WebSocket RPC 协议

### 连接

```text
WSS /api/v1/device-bridges/ws
Authorization: Bridge <bridgeToken>
```

服务端 hello：

```json
{
  "type": "bridge.hello",
  "bridgeId": "br_...",
  "serverTime": "2026-06-23T12:00:00.000Z",
  "heartbeatIntervalMs": 15000
}
```

### RPC 方法（v1）

| 方法 | 用途 |
| --- | --- |
| `bridge.getCapabilities` | 上报 adb/hdc 可用性与版本 |
| `debug.detectTargets` | 执行 `adb devices` 或 `hdc list targets` |
| `debug.readNode` | 读取绑定节点 |
| `debug.writeNode` | 写入绑定节点，可选回读 |

服务端根据参数 binding 解析 `nodePath` 后再下发 RPC。Bridge 不得执行服务端未授权的任意路径写入。

### 执行规则

- 默认超时：detect 5s，read/write 10s
- 同一 `bridgeId` 上设备命令串行执行
- 允许跨 Bridge 并行 detect，不允许同一 Bridge 并发写
- 写操作中 Bridge 断线则 operation 失败；有效快照仍可重试

## Session 与 Target 模型

### `debugging_sessions` 新增字段

```text
execution_mode text not null default 'server'  -- 'server' | 'bridge'
bridge_id text null
bridge_machine_label text null
```

规则：

- `execution_mode = bridge` 时必须有 `bridge_id`
- 一个 session 生命周期内 Bridge 不可更换
- 换电脑需结束 session 后重新 detect

### 并行 Bridge detect

`POST /api/v1/debugging/targets/detect`：

1. 枚举当前用户所有在线 Bridge。
2. 对每个 Bridge 发起 `debug.detectTargets` RPC，使用 `allSettled`。
3. 丢弃离线、超时、无目标的 Bridge。
4. 仅返回确实发现设备的 Bridge 对应 target。

建议 target id 格式：

```text
bridge:{bridgeId}:{protocol}:{targetRef}
```

### 与服务端托管模式共存

| 场景 | `execution_mode` |
| --- | --- |
| 自托管/机房 USB lab | `server` |
| 工程师 Windows 本机 USB | `bridge` |
| Simulator | `server` + simulator gateway |

## 前端 UX

### 「连接本地设备」状态

| 状态 | 界面 |
| --- | --- |
| 未安装 Bridge | Windows 下载按钮 + PowerShell 安装片段 |
| 已安装未配对 | 配对码 + `wiseeff-bridge pair ...` |
| 已配对未启动 | `wiseeff-bridge start` 引导 |
| Bridge 在线但无设备 | 「代理已连接，未发现设备」排障 |
| 单 Bridge 单 target | 自动创建 session |
| 多 Bridge 有 target | 展示机器名 + target，用户确认 |

### Windows 优先文案

`/node-debugging` 主安装面板默认展示 Windows 下载与命令；macOS/Linux 说明放在折叠区。

### Bridge 管理

提供轻量设置页：

- 查看已注册 Bridge
- 修改机器名
- 撤销 Bridge token
- 查看最后在线时间与支持协议

## 数据模型

### `device_bridges`

```text
id text primary key
organization_id text not null
user_id text not null
machine_label text not null
platform text not null            -- windows | darwin | linux
arch text not null
client_version text null
capabilities jsonb not null default '{}'::jsonb
created_at timestamptz not null default now()
last_seen_at timestamptz null
revoked_at timestamptz null
```

### `device_bridge_tokens`

```text
id text primary key
bridge_id text not null references device_bridges(id)
token_hash text not null
scopes text[] not null
expires_at timestamptz not null
revoked_at timestamptz null
created_at timestamptz not null default now()
last_used_at timestamptz null
```

### `device_bridge_pairing_codes`

```text
id text primary key
organization_id text not null
user_id text not null
code_hash text not null
expires_at timestamptz not null
consumed_at timestamptz null
created_at timestamptz not null default now()
```

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 无在线 Bridge | 展示安装/启动指引 |
| Bridge 在线但无设备 | 展示 USB/驱动/HDC 或 ADB 授权排障 |
| 某个 Bridge detect 超时 | 忽略该 Bridge，继续处理其他结果 |
| 写操作中 Bridge 断线 | operation 失败；快照仍可用于重试 |
| Bridge token 过期 | 拒绝 WSS；前端提示重新配对 |
| Bridge 被撤销 | 断开连接并使相关 session 失败 |
| Windows 未安装 `adb`/`hdc` | capabilities 标记不可用；禁用协议并说明原因 |
| 公司网络拦截 WSS | 文档说明放行域名；v1 不做 HTTP 轮询降级 |

## 测试策略

### 自动化

- 配对码签发/消费、token 哈希、RPC 超时归一化单元测试
- debugging service 对并行 detect 聚合与 `execution_mode = bridge` 路由测试
- `/device-bridges/releases` manifest 契约测试
- Bridge 与服务端 gateway 共享 command-runner 测试

### 人工 / lab

- Windows 10/11 AMD64 验收：
  - 从部署域名下载
  - 配对
  - 前台启动
  - ADB detect/read/write 与治理确认
  - 安装 `hdc` 后执行 HDC detect/read
- 多 Bridge：两台 Windows 同时在线，仅 USB 连着设备的那台出现在 detect 结果中
- 撤销 token 后，活跃 session 失败且可审计

## 分阶段交付

### 阶段 1 — Windows Bridge MVP

- Windows AMD64 Bridge CLI
- 同源制品 manifest + 静态下载
- 配对、WSS RPC、Bridge registry
- `/node-debugging` Windows 安装面板
- ADB 全治理闭环

### 阶段 2 — HDC 与加固

- Windows Bridge 支持 HDC RPC
- Windows 服务安装/启动命令
- Bridge 管理 UI（改名/撤销）
- 多 Bridge 并行 detect 打磨

### 阶段 3 — 次要平台

- macOS/Linux Bridge 制品
- 可选签名 Windows 安装包
- 可选对象存储托管制品

## 文档影响

- `docs/FRONTEND.md` 及中文 companion：本地 Bridge 连接流程
- `docs/SECURITY.md` 及中文 companion：Bridge token 边界
- `docs/developer/environment-variables.md`：Bridge 制品路径与 Windows 服务说明
- `ops/self-hosted/README.md`：Bridge 制品打包与 Caddy `/downloads` 路由
- `docs/design-docs/domain-model.md`：`device_bridges` 与 bridge-backed session

## 参考

- `docs/superpowers/specs/2026-06-21-adb-hdc-debugging-protocol-design.md`
- `docs/design-docs/2026-05-15-node-debugging-design.md`
- `docs/zh-CN/design-docs/deployment-operations.md`
- `server/modules/debugging/adbGateway.ts`
- `server/modules/debugging/hdcGateway.ts`
