# 安全基线

> English: [English](../SECURITY.md)

WiseEff 安全边界围绕身份、授权、审计、Agent tool governance、设备安全和数据隔离展开。

## 不可谈判项

- 前端权限检查只是 UX；后端写入必须执行权限校验。
- 生产写入必须产生审计证据。
- Agent 模型输出不能直接修改生产状态。
- 设备写入必须经过权限、校验、确认、快照和审计。
- 生产不能把 mock runtime 当业务数据源。

## 当前认证基线

- `AUTH_MODE=development` 只用于本地开发和测试，`x-wiseeff-user` 不是生产身份边界。
- `AUTH_PROVIDER=oidc` 是目标自托管生产身份推荐路径。API 通过 discovery/JWKS 校验 OIDC token，再从 WiseEff PostgreSQL 加载有效用户、角色和权限。
- `AUTH_PROVIDER=local` 是 WiseEff 自有本地账号路径。密码只保存 salted `scrypt` 哈希；`auth_sessions` 只保存不透明 session token 的 SHA-256 哈希；`/api/v1/me` 仍从 PostgreSQL 重新加载激活状态、角色和权限。
- `AUTH_PROVIDER=hmac` 只用于本地 smoke/test，不是目标环境身份验收证据。
- 生产路由不能回退到 development user，也不能把 token role claim 当作最终授权来源。

OIDC token 必须包含身份和组织声明。只有当 token 包含 `email_verified=true` 时，WiseEff 才允许用 email 作为迁移期 fallback 绑定；否则只按稳定 `sub` 匹配。错误 issuer、错误 audience、过期 token、not-yet-valid token、无签名 token、签名错误或不支持的角色 id 都应被拒绝。

本地账号注册会按所选组织和允许自助选择的平台角色创建基于用户名的账号。服务端会拒绝 Admin 自助注册；Hardware/Software Committer 注册申请会创建 inactive 账号、对应基础 User 角色和待审批申请，但不会发放 session token，也不能在 Admin 审批前登录。Admin 在用户治理后台批准后，服务端才会激活账号并授予申请的 Committer 角色。当前暂不支持邮箱验证，因此注册不能被当作邮箱域名归属证明或邀请接受流程。浏览器本地账号 token 当前保存在 `localStorage` 的 `wiseeff.localAuthToken`；需要 SSO、MFA、refresh-token rotation 或更强浏览器会话隔离的部署应使用 OIDC 或经过加固的反向代理/session 集成。

## 权限模型

当前前端权限包括：

- `parameter:view`
- `parameter:edit`
- `debugging:use`
- `logs:upload`
- `parameter:review`
- `admin:access`
- `users:manage`

新增后端业务路由时，必须把前端 capability 映射到服务端授权检查，并补 forbidden 用户的负向测试。

参数管理写入需要服务端权限和审计：草稿、提交、审阅、merge 和 import 不能只依赖前端禁用按钮。日志上传、重跑、归档、反馈也必须由后端校验权限并记录审计。`debugging:admin` 只管理调试 catalog metadata 和 HDC/ADB node bindings；调试节点写入仍必须走 runtime path，并具备调试写权限、项目访问、有效 session、可写 access mode、范围校验、设备 lease、写前快照和必要的高风险确认。

Bridge-backed 调试会话还要求 bridge 属于当前用户、未撤销且在线；后端会持久化 `execution_mode=bridge` 与 `bridge_id`，保证审计、回滚和冲突检查与服务端执行路径一致。

## 审计要求

审计记录应包含 actor、target、action、severity、metadata、trace/request id、timestamp，以及项目或组织 scope。

必须覆盖的事件包括登录/安全事件、参数写入、审阅决策、日志上传/重跑/归档、设备读写、Agent tool、管理员变更和导出。调试 catalog metadata 与 binding 变更必须写审计；binding audit metadata 不应暴露 raw node path，除非部署策略明确允许。复杂调试写入还会在审计与操作记录中附加格式感知元数据：`valueKind`、`valueFormat`、`normalizationMode`、字节长度、digest，以及有大小上限的 `valuePreview`；大 payload 不得重复写入审计或验收 evidence，digest 与 preview 才是可比较的持久证据。`maxValueBytes` 与服务端默认值会在服务端限制写入 payload 大小；设备写入审批、lease、snapshot 与确认边界不变。本地账号路径会写 registration、login、logout 和当前用户 profile update 审计事件；用户治理后台还会记录本地 Committer 注册申请的 approve/reject 审计事件。退出登录必须服务端撤销当前 session token；当前用户资料更新不能修改 email、角色、激活状态或组织。

## Agent 安全

Agent tool 分为：

- Read-only：权限检查后可自动运行。
- Preparation：可创建草稿或预览，但不提交生产状态。
- Mutating：必须创建 approval record，等待人工批准后执行。

批准时必须重新检查权限和业务状态。Provider 故障不能静默执行工具；降级回答允许存在，但必须跳过 tool execution 并留下可审计证据。

**Xiaoze P0 感知：** `perception.*` 工具为只读（`kind: read`，`requiresApproval: false`），必须通过与其他 Agent 工具相同的 `ToolRegistry.authorize` 边界。跨页面读取受调用方项目 scope 与权限限制；越权 tool call 返回 `FORBIDDEN`，Agent 必须给出安全的非数据回答。AG-UI 端点在流式事件前拒绝未认证请求。

**Xiaoze P1 行动：** `action.submitParameterChange` 为 mutating 且 approval-gated。AG-UI runtime 持久化 orchestrator tool-call + approval 记录、发出 interrupt，且仅通过 `approveToolCall` / `rejectToolCall` 恢复，并在事务内重新鉴权、审计 `actorType=agent`。`editedArgs` 在批准前完整替换 tool payload。设备写闸门在 P1 仍由调试界面与后端拥有，不在小泽内执行。

**Xiaoze P2 规划：** 多步计划使用 LangGraph `StateGraph` 与按 `threadId` 的 checkpointer，使 mutating 步骤在批准后能从计划中途恢复而不丢失已感知上下文。当 `XIAOZE_CHECKPOINTER=postgres` 时，checkpoint 载荷（含 tool 参数与感知上下文）静态保存在 PostgreSQL 中，须与 Agent 业务表一样受数据库访问控制保护；与用户可见聊天历史（TD-030）分离。主动建议为只读、受 authz 限制且 opt-in（`XIAOZE_PROACTIVE_ENABLED` / `VITE_XIAOZE_PROACTIVE_ENABLED`，默认关闭）。suggest 通道仅通过 `POST /api/v1/agent/xiaoze/suggest` 调用 `perception.*` 工具，不写库且不提出调用方权限外的数据。计划中的 mutating 写入仍须逐步经 orchestrator approval 链人工批准；拒绝某步则安全终止计划且不产生 mutation。

## 设备安全

设备访问必须经过 gateway boundary。写请求需要 request id、用户和权限上下文、设备和 node target、access mode、目标值、风险等级、确认或 approval id、写前快照，以及 readback 结果或失败原因。

Simulator-backed path 只用于本地验证。ADB/HDC 都必须经过同一个后端 gateway、权限、lease、snapshot、rollback 和 audit 边界。真实 pilot readiness 需要 HDC/device-lab 目标证据；本机 ADB lab 证据只能作为补充：不能有前端直接设备写入，不能无 lease 和 snapshot 写入，不能无确认 rollback，也不能绕过审计。

本地 Device Bridge 连接采用短时配对码和带 scope 的 bridge token（`device-bridge:connect`、`device-bridge:execute`）。这些 token 仅在服务端校验通过后用于 WebSocket 注册与 RPC 执行；浏览器中的 bridge 健康探测或配对 UI 本身不授予设备写入权限。

Bridge 重命名（`PATCH /api/v1/device-bridges/:bridgeId`）与撤销（`POST /api/v1/device-bridges/:bridgeId/revoke`）需要 `debugging:use`，且只能操作当前用户拥有的 Bridge；撤销会立即使 bridge token 失效，阻止新的 WebSocket 连接。重命名只更新展示用机器标签，不轮换凭据，也不扩展 scope。

## Secret 和备份安全

- S3-compatible 对象存储凭据、signed URL、带密码的数据库 URL、bearer token、Agent API key 都不能提交。
- 备份/恢复证据只能提交脱敏后的摘要、计数、对象 key/prefix 和命令状态，不能提交数据库 dump 或对象内容。
- Restore drill 必须使用隔离数据库和对象存储目标。恢复到 live production database、live bucket 或 live prefix 是安全违规。
- `/metrics` 是运维证据，不是公开 API；pilot/production 必须通过私有网络、VPN、allowlist、mTLS 或更强控制保护。

## 参考

- [docs/design-docs/security-governance.md](design-docs/security-governance.md)
- [docs/design-docs/domain-model.md](design-docs/domain-model.md)
- [docs/design-docs/api-contract.md](design-docs/api-contract.md)
- [docs/security/README.md](security/README.md)
- [docs/runbooks/identity-provider.md](runbooks/identity-provider.md)
