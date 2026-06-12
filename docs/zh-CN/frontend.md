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

API runtime 现在从空的 API bootstrap state 启动，不再从 `src/mockData.ts` 读取业务初始数据。认证或当前路由必需的参数、日志、调试、用户 API hydrate 失败时，页面必须显示 API 不可用和重试状态，不能保留 Aurora、demo 日志、mock 调试节点或 mock 用户等本地演示数据。

mock reducer action 只属于 mock runtime。API runtime 的参数、日志和调试操作必须走 HTTP repository/gateway；如果后端不可用，应暴露 API 失败状态，而不是回退到本地 reducer。

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
