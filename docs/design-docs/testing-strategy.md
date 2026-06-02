# WiseEff 测试策略

日期：2026-05-25

## 1. 测试目标

WiseEff 需要从“原型测试”升级为“产品质量门禁”。测试体系必须覆盖领域规则、API 合同、关键 UI 流程、权限边界、异步任务、Agent 工具治理和设备网关。

## 2. 测试分层

| 层级 | 目标 | 工具方向 |
| --- | --- | --- |
| 领域单元测试 | 纯函数、状态机、权限规则、数据派生 | Vitest |
| 组件测试 | 页面和组件交互、无障碍、边界状态 | Testing Library |
| API 集成测试 | 后端路由、数据库、事务、错误模型 | 后端测试框架 + 测试数据库 |
| 契约测试 | OpenAPI、DTO、前后端类型一致 | schema 校验 |
| 状态模型测试 | 工作流状态转移、权限可见性、审计不变量 | fast-check + Vitest |
| E2E 测试 | 登录、参数提交、审阅、日志上传、设备调试 | Playwright |
| 任务测试 | worker、重试、失败、幂等 | 队列测试环境 |
| Agent 测试 | 工具权限、审批、输出结构 | 模型 mock + golden cases |
| 设备测试 | 网关读写、错误、回读、模拟器 | 设备模拟器 |
| 安全测试 | RBAC、越权、审计、输入校验 | 自动化安全用例 |

## 3. 前端测试

保留现有测试资产，并在 API 化时做以下调整：

- 页面测试不直接依赖 `initialState`，改用端口 mock。
- 保留领域派生逻辑的纯单元测试。
- 对权限隐藏和禁用状态保持覆盖。
- 对表格筛选、排序、分页、弹窗、键盘操作保留覆盖。
- 对生产模式禁用 mock runtime 增加测试。

关键命令：

```bash
npm test
npm run build
```

## 4. 后端测试

后端每个模块至少包含：

- service 单元测试。
- repository 集成测试。
- controller/API 集成测试。
- 权限负向测试。
- 审计写入测试。

参数管理必须测试：

- 重复未完成变更请求被拒绝。
- 高风险参数缺少审阅不能合入。
- 过期版本合入返回 `CONFLICT`。
- 合入成功写入历史和审计。

日志分析必须测试：

- 不支持文件失败。
- 任务失败可重试。
- 阶段进度顺序正确。
- 证据行号与原始日志绑定。

调试平台必须测试：

- 只读节点写入被拒绝。
- 设备离线写入被拒绝。
- 高风险写入缺少确认被拒绝。
- 回读不一致返回明确结果。

## 5. E2E 场景

MVP 必须覆盖：

1. 参数变更闭环：登录、进入参数页、筛选、创建草稿、提交、审阅、合入、查看历史和审计。
2. 参数权限边界：Guest 不能提交，普通用户不能审阅，Committer 不能进入 Admin。
3. 日志分析闭环：上传支持文件、查看进度、查看证据、关联参数。
4. 日志失败路径：上传不支持文件、查看失败原因、重新上传。
5. 设备调试闭环：检测模拟设备、读取节点、写入、回读、查看调试历史。
6. Agent 审批边界：Agent 可以生成写操作申请，但不能绕过批准。

M5.10 之后，浏览器 E2E 还承担审计级证据生成职责。每个自动化 operation 必须写入 `docs/generated/acceptance-operation-evidence.md` 和 `docs/generated/acceptance-operation-evidence/index.json` 可复核记录；当 operation matrix 声明 `api`、`db` 或 `audit` 断言时，证据必须包含对应的 API 请求/响应、数据库状态和审计事件摘要。缺少这些摘要时，`npm run acceptance:evidence` 应失败。

M5.11 之后，浏览器质量门禁还包括无障碍、视觉回归和响应式可用性检查。脚本入口包括 `npm run acceptance:quality`、`npm run acceptance:a11y`、`npm run acceptance:visual` 和 `npm run acceptance:responsive`，分别覆盖脚本/spec wiring、WCAG A/AA 扫描、稳定区域截图和 desktop/tablet/mobile overflow/usable state。这些门禁补充 A-H browser acceptance，不替代 operation evidence 或人工视觉判断。

M5.9 在浏览器验收背后新增确定性的状态模型门禁：

```bash
npm run acceptance:models
```

该命令使用固定 seed 的 `fast-check` 模型测试覆盖参数审批、日志任务、调试会话和权限可见性。它不替代 Playwright；它先在 API/domain 层检查“乱点、乱提交、回头操作”仍满足不变量，例如未授权角色不能写入、终态请求不能再次合入或拒绝、回滚必须基于有效快照、生产写入必须有审计、UI 可见权限不能强于 API eligibility。模型失败时必须输出 seed、path 和最小复现步骤，便于把问题再转化成更具体的单元、API 或浏览器用例。

Current M2 acceptance command:

```bash
DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff OBJECT_STORE_ROOT=.wiseeff-object-store npm run test:m2
```

`npm run test:m2` runs `npm run test:all`, `npm run build`, and `npm run test:e2e`. The M2 Playwright smoke in `e2e/log-analysis.api.spec.ts` runs migrations and seeds `db:seed:m0`, `db:seed:m1`, and `db:seed:m2` in `beforeAll`, then uses `test-fixtures/logs/charging-foldback.log` and `test-fixtures/logs/unsupported.bin`.

The smoke proves the supported upload reaches `Complete`, the conclusion/evidence mention thermal foldback, raw line 3 or 4 highlights from the evidence card, helpful feedback audits, admin archive hides the log from default `/logs`, and unsupported upload creates a readable `Failed` record.

Current M3 acceptance command:

```bash
DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff DEBUG_DEVICE_GATEWAY_MODE=simulator OBJECT_STORE_ROOT=.wiseeff-object-store npm run test:m3
```

`npm run test:m3` runs `npm run test:all`, `npm run build`, and `npm run test:e2e -- e2e/debugging.api.spec.ts`. The M3 Playwright smoke runs migrations and seeds `db:seed:m0`, `db:seed:m1`, and `db:seed:m3` in `beforeAll`, then uses the built-in simulator fixture exposed as `Aurora Simulator 1`.

The smoke proves the simulator target is detected, fast charge current reads `3000`, writing `3100` succeeds with readback, `Cycle count` is not writable from the UI, `Readback mismatch probe` reports mismatch text, rollback returns fast charge current to `3000`, and debugging write/rollback audit events exist. If `/debugging` has no enabled rollback card for an API write snapshot, the test records that UI-state gap and verifies rollback through the backend API rather than faking the UI path.

Current M4 acceptance command:

```bash
DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff OBJECT_STORE_ROOT=.wiseeff-object-store npm run test:m4
```

`npm run test:m4` runs `npm run test:all`, `npm run build`, and `npm run test:e2e -- e2e/agent.api.spec.ts`. The M4 Playwright smoke runs migrations and seeds `db:seed:m0` and `db:seed:m1`, opens `/parameters` in API mode, starts WiseAgent, sends a prompt through `sendMessage`, and verifies the deterministic provider returns confidence plus an approval-required `Create parameter draft` tool call.

Agent test coverage must include route envelopes, schema validation, deterministic provider planning, tool registry permission checks, approval creation, approval approve/reject transitions, stale approval rejection, and UnifiedAgent runtime rendering. Negative tests should cover `APPROVAL_REQUIRED`, `INVALID_APPROVAL_STATE`, `FORBIDDEN`, `VALIDATION_FAILED`, wrong-session approvals, inactive users, missing permissions, and tool execution failures.

## 6. 契约测试

每次 API 合同变更必须：

- 更新 OpenAPI schema。
- 更新前端 DTO 映射。
- 运行 schema 兼容检查。
- 检查错误码、分页结构和字段命名一致性。

前后端类型不应通过手写重复定义长期分叉。M1 后建议把合同放入共享 `contracts` 包或使用 OpenAPI 生成客户端类型。

## 7. 性能与可靠性测试

关键指标：

- 参数列表 1000 条内 P95 小于 800ms。
- 日志上传 100MB 以内有进度反馈。
- 日志分析任务失败可重试且不重复创建结果。
- 设备写入超时有明确错误。
- Agent 工具调用失败不破坏会话。

测试方式：

- API 压测覆盖列表、搜索和审计查询。
- worker 压测覆盖日志任务并发。
- 设备网关模拟超时、断连、stderr 和回读不一致。
## 8. M5 Release Operations

M5 adds the release smoke and pilot gate on top of the existing API-mode checks:

```bash
npm run smoke:m5
npm run test:m5
```

`npm run smoke:m5` checks the committed OpenAPI artifact, `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness`. It requires a live API base URL by default and only skips with `M5_SMOKE_ALLOW_NO_API=true` for local documentation runs. `npm run test:m5` is the intended end-to-end pilot baseline, but it still depends on PostgreSQL and any external backup, device-lab, or staging evidence that is not fully simulated in-repo.

## 9. Documentation Governance

Documentation-impacting work must run `npm run docs:check` plus `git diff --check`. The docs check enforces that active implementation plans carry a documentation impact matrix and update gate.
