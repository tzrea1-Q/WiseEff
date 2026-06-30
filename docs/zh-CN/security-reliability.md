# 安全与可靠性

安全和可靠性是 WiseEff 从原型走向 pilot 的关键边界。详细英文文档见 [SECURITY.md](../SECURITY.md)、[RELIABILITY.md](../RELIABILITY.md) 和 [deployment-operations.md](../design-docs/deployment-operations.md)。

## Auth 和 RBAC

开发模式可以使用 `x-wiseeff-user` 和 seed 用户，方便本地测试。M6.2 目标自托管 production auth 使用 OIDC bearer token：

```text
AUTH_MODE=production
AUTH_PROVIDER=oidc
AUTH_OIDC_ISSUER=https://id.example.com/realms/wiseeff
AUTH_OIDC_AUDIENCE=wiseeff-api
Authorization: Bearer <oidc-access-token>
```

production mode 不允许回退到 development user。OIDC token 必须通过 issuer、audience、expiration、not-before 和 signature 校验；token 只证明身份，最终 active 状态、角色和权限从 WiseEff PostgreSQL 用户/角色表读取。`wiseeff_roles` 可以作为兼容或 bootstrap 诊断 claim，但不是 M6.2 之后的生产授权源。HMAC bearer token 只保留给本地 smoke/test，不能作为目标环境 identity evidence。

当前用户权限设计见 [user-permission-design.md](../security/user-permission-design.md)。平台角色包括 Guest、Hardware User、Software User、Hardware Committer、Software Committer 和 Admin。Hardware Committer、Software Committer、Software User 都包含 Hardware User 的操作权限；但操作权限继承不等于工作流槽位可分配性。硬件 MDE 只显示具体 Hardware Committer 用户，软件 MDE 只显示具体 Software Committer 用户，软件开发人只显示 Software User 或 Software Committer 用户。Guest、Admin 和普通/base 用户不应出现在具体 assignee 下拉框中，除非该槽位明确允许。

## 服务端写入规则

所有生产写入必须服务端执行：

1. 认证。
2. 授权。
3. 输入校验。
4. 事务写入。
5. 审计证据。
6. 结构化响应或结构化错误。

前端权限显示不是安全边界。UI 可以隐藏按钮，但后端必须拒绝无权限写入。

前端下拉框也必须先过滤权限或槽位资格不匹配的选项和用户；这只是 UX，最终仍以后端认证、授权、槽位资格、校验和审计为准。

## 审计

M1-M5 的写入路径都会产生审计事件：

- 参数：submit、review、reject、merge、import。
- 日志：upload、upload failed、rerun、archive、unarchive、feedback。
- 调试：detect、session、node read/write、snapshot rollback。
- Agent：session、tool requested、approval requested、approval executed/rejected、tool failed。

`X-Request-Id` 会用于请求和审计关联。排查生产问题时优先追踪 request id、audit event、job id、session id、snapshot id。

## Agent 安全

Agent 工具只能通过后端 registry 执行。mutating tool 必须先创建 approval record，再在 approval-time 重新校验 authz 和状态。

Xiaoze 使用 LangChain `ChatOpenAI` 连接 OpenAI-compatible `AGENT_API_*` endpoint。模型输出在 WiseEff registry、authz、approval 和 audit 接受前都是 advisory。

Provider evidence 可以记录 model id、trace id、usage、cost、safety 和 fallback；不能记录 `AGENT_API_KEY`、Authorization header、raw prompt、raw provider payload 或客户数据。离线验收使用 `XIAOZE_DETERMINISTIC=true`；live-key staging/pilot 证据使用 `npm run smoke:m5` 和 Xiaoze acceptance specs。

Provider 不可用时允许降级 assistant response，但不能静默执行工具。provider outage、unsafe response、fallback reason 都应该留下 readiness 或 trace 证据。

## Telemetry / 观测性安全

M6.5 的 `/metrics`、结构化日志和 trace 边界属于运维证据，不是公开 API。`/metrics` 可能暴露路由名、依赖状态、队列数量、provider 状态和高风险操作计数，因此生产和 pilot 环境必须通过 private network、VPN、反向代理 allowlist、mTLS 或更强控制访问。

telemetry 中不要记录 bearer token、provider key、原始上传日志内容、原始参数值、原始设备写入 payload 或凭据。`npm run observability:check` 会检查 Prometheus、alerts 和 Grafana dashboard 文件是否存在明显 secret 泄露，并要求每条 alert 带 `runbook_url`。

## 设备写入安全

设备写入属于高风险路径。写入前需要：

- 权限检查。
- device lease 或等价互斥。
- 参数访问模式和范围校验。
- 写前快照。
- 写后 readback。
- 失败原因和审计。
- rollback 路径。

本地 simulator 只能证明流程结构。真实 pilot signoff 需要 HDC device-lab evidence。HDC lab 默认自动准备 lab-only 临时文件节点；执行写入和 snapshot rollback 前仍必须显式设置 `HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write` 和 `HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback`。客户或生产节点路径需要单独审批，不能用默认 lab 配置替代。

## Health 和 pilot-readiness

基础 health：

```text
GET /health/live
GET /health/ready
```

pilot gate：

```text
GET /api/v1/operations/pilot-readiness
```

`pilot-readiness` 聚合：

- contract evidence
- admin auth
- database
- object store
- worker queue
- durable queue transport
- device gateway
- Agent provider
- backup/restore evidence

任何 gate 不 ready 时，状态必须是 `blocked`，不能把本地 skip 当作 pilot-ready 证据。

M6.4 中 `/health/ready` 在 durable queue 模式下还需要报告 `dependencies.durableQueue.transport` 和 `dependencies.durableQueue.database`。`transport` 代表 Redis/BullMQ 可用，`database` 代表 PostgreSQL job-state 可用。两者都 ready 才能把队列通道视为可用。

## Backup、restore 和 rollback

backup/restore drill 必须真实跑过，才能设置：

```text
M5_BACKUP_RESTORE_DRILL_AT=<timestamp>
```

本地 restore drill 可以验证数据库和 local object store 机制，但不能替代目标环境部署 rollback rehearsal。

rollback rehearsal 至少要记录：

1. 触发条件。
2. 停止新写入。
3. drain 或停止 worker。
4. 流量切回或候选部署下线。
5. 数据库和对象存储恢复步骤。
6. 重新运行 smoke。
7. 更新 evidence artifact。

## Self-hosted smoke / 自托管 smoke

M6.1 自托管运行时使用：

```bash
npm run selfhost:check
npm run selfhost:smoke -- --base-url https://<host>
```

`selfhost:smoke` 会探测 `/health/live`、`/health/ready`、`/api/v1/me` 和 `/api/v1/operations/pilot-readiness`，并写入脱敏 evidence。`--allow-only-blocked=deviceGateway` 只适用于非 HDC staging，且其他 readiness gate 必须真实完成，包括 backup/restore drill 后设置 `M5_BACKUP_RESTORE_DRILL_AT`，以及 durable queue 模式下通过 `npm run queue:check -- --base-url <target-url>`。完整 pilot readiness 仍然需要真实 HDC、backup/restore、rollback、object store、worker、Redis/BullMQ queue、Agent provider 和 identity evidence。
