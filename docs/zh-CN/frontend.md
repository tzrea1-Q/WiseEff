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
- `src/features/agent/`：统一 Agent 面板。
- `src/test/setup.ts`：Vitest DOM 初始化。

## Runtime 模式

默认是 `mock`：

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

API runtime：

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

生产构建不能把 mock data 当业务数据源。组件测试和演示可以继续使用 mock。

API mode 启动时会先调用 `/api/v1/me`。如果当前 token 缺失或被拒绝，前端显示 WiseEff 认证页，支持本地账号登录和注册。本地登录使用用户名和密码；注册会选择组织（`硬件部` / `软件部`）、姓名、允许自助选择的平台角色、用户名和密码。注册角色下拉不包含 Admin；申请 Hardware/Software Committer 时，账号会先获得对应基础 User 角色，等待 Admin 在 `/user-permissions` 审批后才授予 Committer 权限。登录或注册成功后，前端把不透明的 `we_local_*` session token 存到 `localStorage` 的 `wiseeff.localAuthToken`；默认 API client 会优先使用 OIDC runtime token，若没有 OIDC token 再回退到本地 token。

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

Agent：

- `UnifiedAgent` 根据当前 path、pageKey、project、role 和 auth context 创建 API session。
- mutating tool 必须走后端 approval 和 audit。
- Pi-backed live provider 只是后端 `AGENT_API_FORMAT=pi` 选项；`AgentGateway` 前端契约不变，不引入 Pi client、Pi filesystem/shell tools 或 streaming UI。

用户和身份：

- `/api/v1/me` 在 OIDC、HMAC smoke 和本地账号下返回同一类 `AuthContext`。
- `/user-permissions` 在 API mode 下通过 `/api/v1/users` 读取和写入用户治理数据，并通过 `/api/v1/users/registration-role-requests` 处理待审批的 Committer 注册申请。
- 前端权限检查只是 UX，后端仍必须执行 authz、self-lockout 防护和 audit。

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
