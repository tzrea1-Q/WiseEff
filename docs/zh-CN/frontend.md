# 前端开发

> English: [English](../FRONTEND.md)

WiseEff 前端是 Vite、React、TypeScript 单页应用。它同时支持 mock runtime 和 API runtime：mock 用于演示和组件测试，API runtime 用于产品化路径和全链路验收。

英文详细文档见 [FRONTEND.md](../FRONTEND.md)。

## 关键目录

- `src/app/`：路由、导航、权限和页面装配。
- `src/domain/`：角色、参数、日志、调试、审计、Agent 的类型和纯规则。
- `src/application/ports/`：前端调用业务能力的接口。
- `src/infrastructure/mock/`：mock state 和 mock repository/gateway。
- `src/infrastructure/http/`：HTTP API client、DTO、auth client、runtime mode。
- `src/components/`：复用 UI、表格、弹窗、过滤器、图表。
- `src/features/agent/`：统一 Agent 面板与 Xiaoze（小泽）CopilotKit 感知层（`XiaozeProvider`、`useXiaozePageContext`）。
- `src/test/setup.ts`：Vitest DOM 初始化。

## Runtime 模式

默认是 **API mode**。`npm run dev` 与 `npm run dev:all` 会注入 API runtime；`.env.example` 与之一致。

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

仅在纯前端演示或组件测试、且不需要调用后端时显式使用 mock：

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

生产构建不能把 mock data 当业务数据源。组件测试默认仍通过 `npm test` 覆盖为 mock，避免本地 `.env` 的 API 设置污染单测。

API mode 启动时会先调用 `/api/v1/me`。如果当前 token 缺失或被拒绝，前端显示 WiseEff 认证页，支持本地账号登录和注册。本地登录使用用户名和密码；注册会选择组织（`硬件部` / `软件部`）、姓名、允许自助选择的平台角色、用户名和密码。注册角色下拉不包含 Admin；申请 Hardware/Software Committer 时，后端会创建 inactive 账号、对应基础 User 角色和待审批申请，`/api/v1/auth/register` 返回 `202 pending_approval` 且不返回 session token，前端继续停留在认证页，展示待审批结果态且不再保留可编辑注册表单。只有登录或非 Committer 注册成功后，前端才把不透明的 `we_local_*` session token 存到 `localStorage` 的 `wiseeff.localAuthToken`；默认 API client 会优先使用 OIDC runtime token，若没有 OIDC token 再回退到本地 token。

顶部用户菜单提供“个人资料”和“退出登录”。个人资料保存调用 `PATCH /api/v1/me/profile`，退出登录调用 `POST /api/v1/auth/logout` 并清除本地 token。注册按所选组织和允许自助选择的平台角色创建本地账号；当前暂不支持邮箱验证。

本地账号注册的组织下拉固定为 `硬件部` 和 `软件部`。自助注册角色下拉使用：`guest`、`hardware-user`、`software-user`、`hardware-committer`、`software-committer`。`admin` 只能通过后台用户治理分配，不能在注册页自助选择。

## 端口和实现

前端页面不要直接拼业务写入逻辑，而是调用 application ports：

- 参数管理：`ParameterRepository`
- 日志分析：`LogAnalysisRepository`
- 设备调试：`DebuggingGateway`
- WiseAgent：`AgentGateway`

每个 port 通常有两类实现：

- `src/infrastructure/mock/*`：本地演示和单测。
- `src/infrastructure/http/*`：API runtime，负责 `/api/v1` 请求和 DTO 映射。

## 主要页面流

参数管理：

- `/parameters`：筛选参数、查看详情和历史、创建草稿、提交本轮修改。
- `/parameter-review`：查看待审请求、推进或拒绝流程。
- `/parameter-admin`：mock mode 下保留直接管理体验；API mode 下写入应走 import/review 流程。

日志分析：

- `/logs`：上传日志、轮询任务、展示报告和证据。
- `/log-admin`：反馈、归档、重跑、治理操作。

设备调试：

- `/node-debugging`：通过 API mode gateway 读写节点、生成快照和审计。
- `/debugging`：保留参数调试工作台和 rollback 入口。
- `/debugging-admin`：API mode 下通过 `src/infrastructure/http/debuggingAdminClient.ts` 管理调试 catalog，可查询、新增、更新、归档、恢复并维护 HDC/ADB bindings；mock mode 保留本地 `configDraft` 和 JSON 编辑路径，用于演示和组件测试。

### 本地 Device Bridge（Phase 1–2）

`/node-debugging` 现已提供 Windows 优先的本地 Bridge 连接面板（自托管 API mode）。前端通过 `src/infrastructure/http/deviceBridgeClient.ts` 调用 `/api/v1/device-bridges/releases` 获取同源下载信息，调用 `/api/v1/device-bridges/pairing-codes` 生成配对码，并调用 `/api/v1/device-bridges/mine` 列出当前用户 Bridge。浏览器侧 `http://127.0.0.1:18787/health` 仅用于 UI 引导，不构成写入安全边界；Bridge 设备执行仍由后端 debugging session、授权和审计控制。

Phase 2 在同一面板增加设备代理管理：可重命名机器标签（`PATCH /api/v1/device-bridges/:bridgeId`）、撤销 Bridge token（`POST /api/v1/device-bridges/:bridgeId/revoke`），并查看最近在线/在线状态。重命名与撤销需要 `debugging:use`，且只能操作当前认证用户拥有的 Bridge。

当 detect 从多个在线 Bridge 返回目标时，`/node-debugging` 会展示 `机器名 · targetRef` 格式的目标选择器，要求用户显式选择后再调用 `detectAndStartSession` 创建调试 session；单 Bridge detect 仍自动建 session。Bridge RPC 同时支持 `adb` 与 `hdc`；连接面板与多 Bridge 选择器在页面协议为 `adb` 时显示（API mode 下默认的 bridge-backed 路径）。

### 调试管理后台 UI

页面壳在 `src/DebuggingAdminPage.tsx`，交互节奏对齐 `/parameter-admin`：主区域是全宽目录表，新增/编辑/归档走弹窗，不再使用左侧列表 + 右侧内联编辑器分栏。

- `DebugParameterLibraryTable` — 工具栏搜索、风险 chips、模块多选、覆盖/状态筛选，以及行内操作。
- `DebugParameterDefinitionDialog` — **修改** 打开的元数据编辑弹窗（保存；已归档时可恢复）。
- `DebugParameterBindingsDialog` — **路径绑定** 打开的 HDC / ADB binding 面板。
- `CreateDebugParameterDialog` — 表格 **新增参数** 打开的空草稿创建弹窗（含默认 binding）。
- `ArchiveDebugParameterDialog` — 行操作或定义弹窗触发的归档确认弹窗。

复杂调试参数通过 `src/debugValueKind.ts` 在管理端与运行时共享辅助逻辑。`DebugParameterDefinitionDialog` 提供值类型、格式、规范化模式，以及复杂当前值/目标值的多行代码编辑器。`DebugParameterLibraryTable` 显示紧凑格式徽章。`/node-debugging` 以紧凑预览和格式徽章展示复杂值，在宽 sheet 中打开查看/编辑，并在操作历史中显示 preview 与 digest，而不是完整 payload。

筛选与弹窗深链由 `useDebugAdminSearch` 同步 URL。mock mode 在表格下方保留可折叠的 **配置源预览**（`power-management.json` 导出/同步）。

Agent：

- `UnifiedAgent` 根据当前 path、pageKey、project、role 和 auth context 创建 API session。
- mutating tool 必须走后端 approval 和 audit。
- live provider 使用 `AGENT_API_FORMAT=wiseeff` 或 `openai`（URL-backed transport）；Pi provider 已在 P1 移除（TD-027）。

Xiaoze（P0 感知 + P1 行动）：

- `VITE_XIAOZE_ENABLED=true` 时挂载 `XiaozeProvider`（CopilotKit V2 + `HttpAgent`），SSE 对接 `POST /api/v1/agent/xiaoze`。
- `UnifiedAgent` 在启用 Xiaoze 时隐藏旧 FAB，通过 `XiaozePageContextRegistrar` 声明 `wiseeff.page` 上下文。
- P0：`perception.*` 只读工具。
- P1：`XiaozeApprovalCard`（`useInterrupt`）处理 mutating `action.submitParameterChange` 提案（批准 / 拒绝 / 改值）；低风险前端工具 `navigateTo`、`prefillParameterValue`（`useFrontendTool`，不写库）。

用户和身份：

- `/api/v1/me` 在 OIDC、HMAC smoke 和本地账号下返回同一类 `AuthContext`。
- `/user-permissions` 在 API mode 下通过 `/api/v1/users` 读取和写入用户治理数据，并通过 `/api/v1/users/registration-role-requests` 处理待审批的 Committer 注册申请。管理员在“添加用户”中创建的是本地账号：表单使用姓名、用户名、可选职务、初始密码和初始角色，不再把邮箱作为账号标识。该账号会加入当前管理员所在组织并立即启用；密码只提交给后端创建凭据，前端用户状态不会保存明文密码。
- 前端权限检查只是 UX，后端仍必须执行 authz、self-lockout 防护和 audit。

## 按钮和操作样式

按钮必须看起来就是按钮。不要依赖裸 `.button` class、浏览器默认 `<button>` 样式，或把会写入状态、提交表单、关闭弹窗、推进流程、打开菜单的操作做成纯文字。优先复用已有 Button 组件或本地已有变体；如果某个区域需要局部按钮变体，必须在该作用域内补齐完整视觉契约：

- 布局：使用居中对齐的 `inline-flex`，并设置稳定的 `min-height`，以及稳定的 `min-width` 或 icon-only 方形尺寸。
- 表面：显式定义 `background`、`border`、`border-radius`、文字颜色、禁用态透明度和 cursor。
- 层级：区分 primary、secondary/subtle、destructive、ghost 等层级，不能让两个关键操作看起来只是两段等权重文字。
- 交互：提供 hover 和 focus-visible 状态；在浅色页面和带遮罩的弹窗上，焦点环都必须可见。
- 响应式：桌面、平板、手机下按钮不能退化成裸文字，不能互相重叠，不能溢出容器，也不能因为文字或状态变化导致布局跳动。

弹窗底部、表格行操作、顶部栏操作、卡片操作和 toast 操作是高频回归点。修改这些区域时，单测应加入目标按钮变体或 class 的 DOM 断言；浏览器验收应截取对应状态，并明确检查主/次按钮有可见表面样式、尺寸稳定且页面无水平溢出。低强调的内联跳转或辅助操作可以使用文本式样式，但应使用 link/text-action class，不要伪装成普通按钮。

## 测试建议

开发时优先跑目标测试：

```bash
npm test -- src/path/to/test.tsx
```

前端影响较大时跑：

```bash
npm test
npm run build
```

API-mode E2E 依赖 PostgreSQL 和 seed data：

```bash
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
npm run test:e2e
```

如果本地 `.env` 设置了 `VITE_WISEEFF_RUNTIME_MODE=api`，运行前端单测时建议显式覆盖为 mock，避免组件测试被真实 API 环境污染：

```bash
VITE_WISEEFF_RUNTIME_MODE=mock npm test
```
