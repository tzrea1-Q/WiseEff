# 安全与可靠性

安全和可靠性是 WiseEff 从原型走向 pilot 的关键边界。详细英文文档见 [SECURITY.md](../SECURITY.md)、[RELIABILITY.md](../RELIABILITY.md) 和 [deployment-operations.md](../design-docs/deployment-operations.md)。

## Auth 和 RBAC

开发模式可以使用 `x-wiseeff-user` 和 seed 用户，方便本地测试。production auth 使用 HMAC bearer token：

```text
Authorization: Bearer <base64url-json-payload>.<hmac-sha256-signature>
```

production mode 不允许回退到 development user。签名 payload 至少需要 issuer、subject、organization，可携带 roles 和 permissions。

## 服务端写入规则

所有生产写入必须服务端执行：

1. 认证。
2. 授权。
3. 输入校验。
4. 事务写入。
5. 审计证据。
6. 结构化响应或结构化错误。

前端权限显示不是安全边界。UI 可以隐藏按钮，但后端必须拒绝无权限写入。

## 审计

M1-M5 的写入路径都会产生审计事件：

- 参数：submit、review、reject、merge、import。
- 日志：upload、upload failed、rerun、archive、unarchive、feedback。
- 调试：detect、session、node read/write、snapshot rollback。
- Agent：session、tool requested、approval requested、approval executed/rejected、tool failed。

`X-Request-Id` 会用于请求和审计关联。排查生产问题时优先追踪 request id、audit event、job id、session id、snapshot id。

## Agent 安全

Agent 工具只能通过后端 registry 执行。mutating tool 必须先创建 approval record，再在 approval-time 重新校验 authz 和状态。

Provider 不可用时允许降级 assistant response，但不能静默执行工具。provider outage、unsafe response、fallback reason 都应该留下 readiness 或 trace 证据。

## 设备写入安全

设备写入属于高风险路径。写入前需要：

- 权限检查。
- device lease 或等价互斥。
- 参数访问模式和范围校验。
- 写前快照。
- 写后 readback。
- 失败原因和审计。
- rollback 路径。

本地 simulator 只能证明流程结构。真实 pilot signoff 需要 HDC device-lab evidence。

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
- device gateway
- Agent provider
- backup/restore evidence

任何 gate 不 ready 时，状态必须是 `blocked`，不能把本地 skip 当作 pilot-ready 证据。

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
