# TD-068 可信调用上下文 seam（#610）

> English: [English](../../../exec-plans/active/2026-08-24-td-068-trusted-invocation-context-seam.md)

状态：#610 已在 `codex/td-068-trusted-invocation-context` 完成实现，但仍被下述必需的本地 acceptance-quality 门禁阻断合入；本文件继续作为共享迁移记录保持 active。本切片建立服务端内部上下文及其策略/审计 seam；#611–#615 完成前，TD-068 仍保持 Open。

## 目标

建立一个带 brand、仅由服务端构造的 `user` / `agent` / `system` 判别联合调用上下文，不修改旧调用点，也不改变公开请求契约。

## 范围与实现

- `server/modules/auth/trustedInvocation.ts`：判别上下文、不可变认证主体快照、严格构造器、运行时 brand 校验，以及 Agent 审批关联。
- `server/modules/auth/trustedInvocationPolicy.ts`：要求上下文的人类必需策略 seam，返回稳定的 `403` 拒绝详情。
- `server/modules/audit/trustedAudit.ts` 与 `server/modules/audit/auditedWrite.ts`：actor/审计投影，以及保留 system null-user 语义的事务内与 pool 拒绝写入器。
- 聚焦测试覆盖构造不变量、策略结果、actor/审计投影、system 平台范围审计，以及查询前的 malformed-context 失败。
- 现有可选 `actorType` 调用点留给后续迁移票据；不修改 request DTO、header、body、`/me` 或 OpenAPI 契约。

## 验证

- 可信上下文聚焦测试：3 个文件、15 个测试通过。
- 最终树的完整矩阵未跳过任何套件并全部通过：前端 407 个文件 / 3019 个测试（`npm test -- --maxWorkers=4`，保留原始单测超时）；scripts 69 个文件 / 811 个通过 / 5 个跳过；bridge 21 个文件 / 138 个通过；server 354 个文件 / 2735 个通过 / 8 个跳过（另有 2 个文件跳过）。
- 早先默认并发运行未被宣称为绿色：一次到达 server 后，生成的 session UUID 随机包含 `9999`，触发无关随机断言；另一次在前端因 3 条无关的 5 秒 UI 超时而停止。相关文件定向重跑通过；限制前端 worker 消除了资源争用，没有跳过测试或延长超时。
- `npm run build`、`npm run contract:check`、`npm run docs:check` 与 `npm run acceptance:ci` 通过。数据库 schema 文档子检查仍提示本机缺 pgvector 扩展而跳过；本变更无 schema 影响。
- `npm run lint` 完成，0 errors，保留前端基线 299 warnings。`git diff --check origin/main...HEAD` 通过。
- `npm run ui:check` 通过，全部 ratchet 与 baseline 相等。`npm run logs:eval` 的 16/16 场景与 4/4 meta checks 通过，生成时间戳未纳入提交。`npm run acceptance:quality` 通过；`npm run acceptance:smoke` 在干净 detached worktree、独立 pgvector 数据库和 CI production-HMAC seed 配置下 4/4 通过。
- `npm run acceptance:quality-run` **尚未绿色**，因此 owner-approved 完整本地 CI 例外仍被阻断。干净 MCR Playwright Linux 运行 94/97 通过；综合交互 a11y 超时在定向重跑后通过，但 project-configuration-workbench 与 Xiaoze-popup 两张 Linux 快照仍分别约有 3% 和 4% 像素差。未改动的 `origin/main` 在 arm64 上以完全相同像素数复现两项差异，feature 分支在 amd64 上也复现。仓库规定只能采用 GitHub runner artifact 作为快照权威，因此没有更新快照。在门禁修复或 owner 明确记录更窄例外前，不得 push/merge #610。

## 后续边界

#611–#615 负责在 HTTP/Xiaoze/system 入口构造上下文，并迁移 DTS 重载五条写路径和参数敏感生产写。本计划不关闭 TD-068，不重构无关审计，也不声称 target/device readiness。

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
- [x] 已如实记录第一次全量失败与同树完整重跑通过，没有把失败运行宣称为绿色。
- [ ] 解决两项继承的 acceptance-quality visual 失败，在最终树上重跑全部必需本地 CI，并取得零 finding 的 Standards 复审后方可合入。
- [ ] 只有完整 TD-068 迁移和收口证据落地后，才能将本计划移入 `completed/`。

## Git & PR Workflow

实现与 review 修复和本次文档记录在 `codex/td-068-trusted-invocation-context` 上保持独立提交。PR、owner-approved 完整本地 CI 例外、合入和 main 同步由 parent/session owner 负责。
