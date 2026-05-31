# WiseEff 安全与治理设计

日期：2026-05-25

## 1. 安全目标

WiseEff 处理参数、日志、设备调试和 AI 工具调用，所有这些都可能影响真实工程流程。安全设计必须把权限、审计、确认和隔离作为默认能力。

目标：

- 用户身份可信。
- 权限在后端强制执行。
- 生产变更有人工确认和审计。
- Agent 不能绕过业务权限。
- 设备写入必须受控。
- 日志和敏感数据必须脱敏和隔离。

## 2. 身份认证

推荐：

- 企业环境使用 OIDC/SSO。
- 本地开发可使用开发账号。
- API 使用短期访问令牌。
- 前端不保存长期密钥。

会话规则：

- 用户停用后令牌失效。
- 高风险动作可要求重新认证或二次确认。
- 管理后台访问必须记录审计。

## 3. 授权模型

权限分两层：

1. 页面访问权限：决定用户能否进入某页面。
2. 动作权限：决定用户能否执行业务动作。

当前用户权限设计见 [User Permission Design](../security/user-permission-design.md)。平台角色包括 Guest、Hardware User、Software User、Hardware Committer、Software Committer 和 Admin。动作权限继承与工作流槽位可分配性必须分开判断：Hardware Committer、Software Committer 和 Software User 都包含 Hardware User 的动作权限，但这不代表这些角色自动可被分配到每一个具体工作流槽位。

动作权限示例：

- `parameter.view`
- `parameter.edit`
- `parameter.review`
- `logs.upload`
- `debugging.use`
- `admin.access`
- `users.manage`

规则：

- 前端权限裁剪只提升体验，不作为安全边界。
- 前端下拉框必须过滤掉权限或槽位资格不匹配的选项和用户；后端仍是最终权限来源。
- 后端每个写 API 必须检查动作权限。
- 项目级数据必须检查项目成员或组织边界。
- Admin 权限不等于绕过审计。

## 4. 审计治理

必须审计：

- 登录和关键身份事件。
- 用户和角色变更。
- 参数新增、更新、删除、导入、合入。
- 审阅推进和打回。
- 日志上传、重跑、归档。
- 设备读取、写入、回滚。
- Agent 工具调用、审批和执行结果。
- 配置变更和导出。

审计要求：

- 业务写入与审计写入保持一致。
- 审计记录包含 actor、target、action、severity、metadata、traceId。
- 审计查询按权限过滤。
- 普通业务 API 不允许修改审计记录。

## 5. Agent 安全

Agent 只能通过工具调用访问系统。

工具分级：

| 类型 | 示例 | 审批 |
| --- | --- | --- |
| 只读 | 查询参数、总结日志、汇总审计 | 可自动执行，仍需权限 |
| 准备型 | 生成草稿、生成导入预览、生成排查清单 | 可自动创建草稿或预览 |
| 变更型 | 提交参数、推进审阅、归档日志、设备写入 | 必须人工批准 |

规则：

- 模型输出不能直接成为业务写入。
- 工具输入必须 schema 校验。
- 批准时必须重新校验权限和业务状态。
- 工具执行结果必须写入审计。
- Agent 不应接收超出当前上下文权限的数据。

## 6. 设备安全

设备写入是高风险操作。

要求：

- 设备网关不暴露公网。
- 写入前检查用户权限、设备状态、节点访问模式、参数范围和风险级别。
- 高风险写入必须人工确认。
- 写入前创建快照。
- 写入后可回读校验。
- 超时、stderr、回读不一致必须展示给用户并记录审计。
- 回滚必须引用有效快照。

## 7. 数据安全

日志和参数可能包含敏感信息。

要求：

- 文件上传限制大小、类型和扫描结果。
- 原始日志按项目和组织隔离。
- 日志展示前对敏感 token、路径、序列号等做脱敏策略。
- 对象存储访问使用短期签名 URL。
- 导出文件有访问权限和过期策略。
- 生产数据库备份加密。

## 8. 输入校验

所有 API 输入必须校验：

- ID 格式。
- 参数目标值范围。
- 文件类型和大小。
- 角色和权限枚举。
- Agent 工具 payload schema。
- 设备节点路径白名单。

禁止：

- 由前端传入任意节点路径并直接写入。
- 由 Agent 生成未经 schema 校验的数据库查询。
- 由用户上传文件名直接拼接存储路径。

## 9. 治理验收清单

上线前必须确认：

- 生产环境禁用 mock runtime。
- 所有写 API 有权限测试和审计测试。
- Agent 变更工具无法绕过审批。
- 设备写入必须带快照和审计。
- Admin 操作可追溯。
- 审计查询可按时间、用户、项目、对象过滤。
- 备份和恢复流程经过演练。

## M5 Security Baseline Note

- Production auth is implemented as a pilot HMAC verifier boundary, not final enterprise SSO/OIDC.
- HDC and live Agent provider seams are implemented, but real pilot readiness depends on target-environment evidence.
- Provider outages and device failures must leave audit/readiness evidence rather than silently passing.
