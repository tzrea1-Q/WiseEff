# Device Bridge 零摩擦安装与连接设计

> English: [English](../../../superpowers/specs/2026-06-24-device-bridge-zero-friction-design.md)

日期：2026-06-24  
状态：已认可，可进入实施计划  
前置：[本地设备代理（Device Bridge）设计](./2026-06-23-local-device-bridge-design.md)

## 背景

Phase 1–3 已实现 CLI Bridge、同源下载、配对码与 `/node-debugging` 连接面板，但零基础用户仍需：

1. 在多个平台下载按钮中选择正确制品；
2. 手动解压、`chmod +x`（macOS）；
3. 复制并执行 `pair` 与 `start` 两条终端命令；
4. 自行安装并配置 `adb` / `hdc`。

本设计在 **允许一次性安装本地程序** 的前提下，将上手路径压缩为：**安装一次 → 网页点「连接」→ 插 USB 调试**，终端与复制命令不再是主路径。

## 决策摘要

| 决策 | 选择 |
| --- | --- |
| 本地程序 | 允许一次性图形化安装包（Windows + macOS 同步交付） |
| 安装选项 | 无选项：按平台/架构自动匹配唯一下载链接 |
| 连接主路径 | 网页驱动：点「连接本地设备」通过 URL scheme 唤起本地 Bridge |
| 连接兜底 | 支持先开托盘/菜单栏 Bridge，再回到网页连接 |
| adb/hdc | v1 不内置；缺失时分阶段引导「一键安装依赖」（尽量无终端） |
| 安全模型 | 沿用现有配对码 + Bridge token；不将浏览器 Bearer 写入 Bridge |

## 目标

- 新用户在 Windows 或 macOS 上 **无需打开终端** 即可完成 Bridge 安装与配对。
- 网页 `/node-debugging` 以 **3 步向导**（安装 → 连接 → 插 USB）替代多条 CLI 命令。
- 已安装用户打开页面即可看到 Bridge 在线状态，跳过安装/连接步骤。
- Phase B 起，Bridge 与网页对缺失的 `adb`/`hdc` 给出明确、可操作的引导。

## 非目标

- Linux 图形安装包（本轮）。
- 安装包自动更新（留后续迭代）。
- v1 在安装包中内置 `adb`/`hdc`（留 Phase C）。
- 修改后端 pairing/token 安全模型或 debugging 治理边界。

## 用户旅程

### 首次使用

| 步骤 | 用户操作 | 系统行为 |
| --- | --- | --- |
| 1 | 打开 `/node-debugging` | 探测 `http://127.0.0.1:18787/health`：Bridge 未安装 |
| 2 | 点击「安装 Bridge」 | 按浏览器平台展示 **唯一** 安装包下载（不再并列多个平台按钮） |
| 3 | 运行安装包，默认选项完成安装 | 注册 URL scheme；安装 Bridge 运行时；注册后台服务/托盘；首次启动 Bridge |
| 4 | 回到网页，点击「连接本地设备」 | 前端创建配对码 → 打开 `wiseeff-bridge://connect?...` |
| 5 | （无需操作） | 本地应用执行 pair（若需要）+ start；health 变为 online；WSS 连接建立 |
| 6 | 插入 USB 并授权设备 | 页面自动进入 HDC/ADB detect |

### 老用户

- Bridge 已配对且 WSS 在线：跳过步骤 1–5，直接进入设备检测或参数调试。
- Bridge 已安装但未运行：主按钮文案为「启动 Bridge 并连接」。

### 兜底路径

- **URL scheme 被浏览器或策略拦截**：提示从托盘/菜单栏打开 WiseEff Bridge；Bridge 可读取剪贴板配对码或提供 6 位码输入。
- **10 秒内 health 未上线**：展示兜底说明，保留「高级 · 命令行方式」折叠区。

## 安装包与本地架构

### 制品

| 平台 | 制品 | 安装位置 | 后台运行 |
| --- | --- | --- | --- |
| Windows x64 | `WiseEffBridgeSetup.exe` | `%LOCALAPPDATA%\WiseEff\Bridge\` | Windows Service（默认开启，复用现有 `service` 命令能力） |
| macOS arm64 / x64 | `WiseEffBridge.pkg` 或 notarized DMG | `/Applications/WiseEff Bridge.app` | LaunchAgent 开机自启 |

原则：

- 服务端 manifest 仍列出多平台条目；**前端只展示一个主 CTA**，由 `pickBridgeReleaseForHost()` 选择。
- 安装包内嵌 Node 运行时与 `wiseeff-bridge` CLI，用户无需单独安装 Node。
- 安装完成后自动启动 Bridge；托盘/菜单栏显示「已就绪，等待连接」。

### 进程模型

```text
┌─────────────────────────────────────┐
│  WiseEff Bridge (tray / service)    │
│  ├─ URL scheme handler              │
│  ├─ Health server :18787/health     │
│  ├─ WSS client → server             │
│  └─ adb/hdc subprocess (Phase B+)   │
└─────────────────────────────────────┘
         ▲                    │
         │ wiseeff-bridge://  │ RPC
         │                    ▼
   Browser (/node-debugging)  Server
```

### CLI 扩展（向后兼容）

新增统一入口：

```bash
wiseeff-bridge connect --server <url> --code <code>
```

行为：若未配对则 pair → 始终 start WSS 与 health server。现有 `pair`、`start`、`status`、`service` 命令保留，供运维与高级用户使用。URL scheme handler 内部调用同一 `connect` 逻辑。

## URL Scheme 协议

```text
wiseeff-bridge://connect?server=https://<wiseeff-origin>&code=<6-digit>
```

| 参数 | 规则 |
| --- | --- |
| `server` | 必须与浏览器 `window.location.origin` 一致（HTTPS 部署使用 https） |
| `code` | 6 位数字；一次性；TTL 30 分钟；绑定创建者 `userId` |

处理流程：

1. 本地应用解析 URL，校验 `server` 格式与 scheme。
2. 若本地已有有效 token 且 `server` 匹配 → 直接 `start`。
3. 否则用 `code` 调用 `POST /api/v1/device-bridges/pair` → 写入本地配置 → `start`。
4. 更新 `127.0.0.1:18787/health` 状态。

## 安全边界

| 层级 | 规则 |
| --- | --- |
| 配对码 | 仍由已登录用户 `POST /api/v1/device-bridges/pairing-codes` 生成 |
| Bridge token | 数据库只存哈希；scope 不变；不可调用普通业务 API |
| 浏览器 token | **不得**写入 Bridge 配置 |
| URL scheme | `code` 仅用于本地兑换；兑换后立即失效；避免在服务端 access log 中记录完整 scheme URL |
| 同源 | `server` 参数必须与当前 WiseEff 部署域名一致 |
| 写操作 | 设备读写仍走后端 session、权限、快照、审计 |

新增 UX 约束：

- 首次唤起 scheme 前，浏览器显示「即将打开 WiseEff Bridge」确认（可勾选「不再提示」）。
- 连接超时（30s）时降级为兜底路径，不无限轮询。

## 前端改造（`/node-debugging`）

### 面板状态机

用户可见三步向导：

```text
① 安装 Bridge  →  ② 连接本机  →  ③ 插入 USB 设备
```

| 检测条件 | 向导步骤 | 主按钮 |
| --- | --- | --- |
| health 不可达 | ① | 「安装 Bridge」→ 唯一下载链接 |
| health 可达但未 paired | ② | 「连接本地设备」→ 唤起 scheme |
| paired 但 WSS 未连接 | ② | 「重新连接」 |
| connected 但无 USB 目标 | ③ | 「重新检测设备」 |
| 全流程 OK | 全部完成 | 进入参数调试区 |

### 连接流程

1. `POST /api/v1/device-bridges/pairing-codes` 生成配对码。
2. 构造 `wiseeff-bridge://connect?...` 并唤起（首次带确认对话框）。
3. 每 2s 探测 `127.0.0.1:18787/health`，最多 30s；并行刷新 `GET /api/v1/device-bridges/mine`。
4. health `connected: true` 后自动触发 debugging detect。

### UI 收敛

| 现状 | 目标 |
| --- | --- |
| 多个平台下载按钮 | 单一「安装 Bridge」CTA |
| 配对 + 启动两条 CLI | 收至「高级 · 命令行方式」折叠区 |
| 「连接本地设备」仅刷新 | 主 CTA：scheme 唤起 + 轮询 |

## Phase B：`adb` / `hdc` 依赖（分阶段）

v1 安装包 **不内置** `adb`/`hdc`。缺失时分阶段补齐：

### B1 — 检测与提示

- Bridge `getCapabilities` / health 扩展 `tools.adb` / `tools.hdc` 字段。
- 网页与托盘一致展示「缺少 ADB/HDC 调试工具」，避免误报「Bridge 未安装」。

### B2 — 一键安装到私有目录

- 用户点击「一键安装调试工具」。
- Bridge 下载最小 SDK zip 到 `%LOCALAPPDATA%\WiseEff\tools\`（macOS：`~/Library/Application Support/WiseEff/tools/`）。
- **仅 Bridge 子进程**使用该 PATH；不要求用户开终端、不修改系统 PATH。

### B3（可选）— 安装包内置

- 图形安装包捆绑 `adb`/`hdc`，实现真正开箱即用。

## 测试与验收

| 场景 | 验收标准 |
| --- | --- |
| Windows 全新机 | 安装 → 网页连接 → 30s 内 health online；无终端操作 |
| macOS 全新机 | 同上；Gatekeeper 提示可预期 |
| URL scheme 被拦截 | 兜底文案可用；托盘手动连接成功 |
| 已配对老用户 | 打开页面即显示已连接 |
| 缺 adb（Phase B1+） | 明确提示缺工具，不误报 Bridge 缺失 |
| 安全回归 | 配对码一次性；Browser Bearer 未写入 Bridge；写操作仍审计 |

## 实施分期建议

| 阶段 | 交付物 |
| --- | --- |
| **A — MVP** | 图形安装包（Win+Mac）；URL scheme；`connect` 命令；前端 3 步向导；CLI 收至高级区 |
| **B1** | health/capabilities 工具检测 + 网页提示 |
| **B2** | 一键下载依赖到私有目录 |
| **C** | 内置 adb/hdc；自动更新；企业静默部署 |

## 文档影响

| 文档 | 动作 |
| --- | --- |
| `docs/runbooks/local-device-bridge.md` | 更新安装与连接主路径 |
| `docs/zh-CN/runbooks/local-device-bridge.md` | 同上（中文） |
| `docs/FRONTEND.md` | 更新 `/node-debugging` Bridge 面板说明 |
| `docs/zh-CN/frontend.md` | 同上（中文） |
