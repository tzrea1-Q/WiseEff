# TD-068 可信调用上下文 seam（#610）

> English: [English](../../../exec-plans/active/2026-08-24-td-068-trusted-invocation-context-seam.md)

状态：`codex/td-068-trusted-invocation-context` 分支上的前置 seam，进行中。本切片建立服务端内部上下文及其策略/审计 seam；DTS 重载与参数敏感迁移完成前，TD-068 仍保持 Open。

## 目标

建立一个带 brand、仅由服务端构造的 `user` / `agent` / `system` 判别联合调用上下文，不修改旧调用点，也不改变公开请求契约。

## 范围与实现

- `server/modules/auth/trustedInvocation.ts`：判别上下文、不可变认证主体快照、严格构造器、运行时 brand 校验，以及 Agent 审批关联。
- `server/modules/auth/trustedInvocationPolicy.ts`：要求上下文的人类必需策略 seam，返回稳定的 `403` 拒绝详情。
- `server/modules/audit/trustedAudit.ts` 与 `server/modules/audit/auditedWrite.ts`：actor/审计投影，以及保留 system null-user 语义的事务内与 pool 拒绝写入器。
- 聚焦测试覆盖构造不变量、策略结果、actor/审计投影、system 平台范围审计，以及查询前的 malformed-context 失败。
- 现有可选 `actorType` 调用点留给后续迁移票据；不修改 request DTO、header、body、`/me` 或 OpenAPI 契约。

## 验证

- 可信上下文聚焦测试。
- `npm run test:server`。
- `npm run test:scripts`。
- `npm run bridge:test`。
- `npm run build`。
- `npm run contract:check`。
- `npm run docs:check`。
- `git diff --check`。
- 已尝试仓库前端全量测试；4 个无关既有 UI 测试超时，已记录为失败，未宣称通过。

## 后续边界

后续票据负责在 HTTP/Xiaoze/system 入口构造上下文，并迁移 DTS 重载五条写路径和参数敏感生产写。本计划不关闭 TD-068，不重构无关审计，也不声称 target/device readiness。

## 文档影响矩阵

| 范围 | 状态 | 证据 |
| --- | --- | --- |
| 仓库地图与 Agent 指引 | Review | `AGENTS.md`；已将安全/auth/审计工作路由到相关文档。 |
| 计划与技术债台账 | Review | `docs/PLANS.md`、`docs/exec-plans/tech-debt-tracker.md`；已保留 TD-068 Open 及迁移边界。 |
| 产品与 API 契约 | No change | `docs/design-docs/api-contract.md`、`server/modules/contracts/`；未修改 route、request DTO、`/me`、header、body 或 OpenAPI 表面。 |
| 架构与领域模型 | Review | `docs/adr/0038-trusted-invocation-provenance-separates-principal-and-initiator.md`、`docs/design-docs/full-stack-architecture.md`、`docs/design-docs/domain-model.md`。 |
| 安全与审计指引 | Review | `docs/SECURITY.md`、`server/modules/audit/auditedWrite.ts`；可信上下文及禁止 default-user 仍是部分迁移。 |
| 质量与验证文档 | No change | `docs/QUALITY_SCORE.md`、`docs/developer/verification-matrix.md`；使用现有 server、contract、docs、build、diff 门禁。 |
| 中文开发文档 | Review | `docs/zh-CN/SECURITY.md`、`docs/zh-CN/design-docs/full-stack-architecture.md`、`docs/zh-CN/design-docs/domain-model.md`、`docs/zh-CN/PLANS.md`。 |
| 生成物、runbook、前端/设计、references | No change | `docs/generated/`、`docs/runbooks/`、`src/`、`docs/references/`；没有生成 schema、operation、运行时、UI 或运维流程变化。 |

## 文档影响矩阵与更新门禁

- [x] 已按实现 seam 复核 ADR-0038 及英中文安全/架构/领域/API/计划引用。
- [x] 没有公开契约或前端文档因此变陈旧。
- [x] 已记录验证命令及前端全量超时边界。
- [ ] 只有完整 TD-068 迁移和收口证据落地后，才能将本计划移入 `completed/`。

## Git & PR Workflow

本实现提交在 `codex/td-068-trusted-invocation-context`；继承的用户文档改动保持 unstaged 且不触碰。任何 PR、CI 例外、合入和 main 同步由 parent/session owner 负责。
