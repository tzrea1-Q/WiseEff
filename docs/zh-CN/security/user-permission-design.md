# 用户权限设计

> English: [English](../../security/user-permission-design.md)

这是安全文档，说明身份、授权、审计、数据分级、密钥和权限设计。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：security。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 知识库权限速览

- `knowledge:view`:读取已发布条目与检索;组织成员（Guest 及以上）默认具备。
- `knowledge:edit`:创建条目;编辑/发布/归档**自己的**条目;Hardware/Software User 及以上默认具备。
- `knowledge:manage`:治理任意条目（编辑、归档、恢复、彻底删除）;Admin 档位。
- 发布者问责:`knowledge:edit` 不能发布或修改他人条目;草稿仅对拥有者与 manage 可见;彻底删除必须 `knowledge:manage` 并留 `High` 级审计。完整规则见英文版。
- Phase 3 蒸馏与 Agent 草稿沿用同一模型,不新增权限:日志蒸馏(`POST /api/v1/knowledge/distill-from-log`)需要 `knowledge:edit` 创建草稿,且对来源分析记录需要 `logs:view` 加组织隔离;审批门控 Agent 工具 `action.createKnowledgeDraft` 在调用用户的 AuthContext 下执行(执行时强制 `knowledge:edit`),任何写入前必经人工批准,且只创建新草稿;Agent 草稿的创建者即会话用户,因此 `knowledge:edit` 可发布/拒绝归档本人会话沉淀的草稿,`knowledge:manage` 可在 `/knowledge-admin` 队列处理任意 Agent 草稿,拒绝归档端点(`POST /api/v1/knowledge/entries/:entryId/reject`)只接受 Agent 来源草稿。

## 组织管理

`/organization` 是组织档案，`/organization/members` 是人员管理。两者都是本组织租户运营。`GET /api/v1/organization` 对任意已启用已认证成员开放。`PATCH /api/v1/organization` 需要 `users:manage`，只接受 `{ name }`，同一事务写 `organization-update`。名称是标签，不做全局唯一。这与 `/parameter-admin` 的 Organization-scoped governance 不同。

## 同类中文文档

- [docs/zh-CN/security/README.md](README.md)
- [docs/zh-CN/security/threat-model.md](threat-model.md)
- [docs/zh-CN/security/data-classification.md](data-classification.md)
- [docs/zh-CN/security/secrets-management.md](secrets-management.md)
- [docs/zh-CN/security/audit-retention.md](audit-retention.md)
- [docs/zh-CN/security/user-permission-design.md](user-permission-design.md)
