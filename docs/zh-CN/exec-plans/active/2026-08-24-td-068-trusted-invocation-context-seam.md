# TD-068 可信调用上下文 seam（#610）

> English: [English](../../../exec-plans/active/2026-08-24-td-068-trusted-invocation-context-seam.md)

状态：#610 已在 `codex/td-068-trusted-invocation-context` 完成实现与最终树本地 CI；GitHub Actions 本月额度耗尽期间，按 owner 已记录的完整本地 CI 例外进入可合入状态。本文件继续作为共享迁移记录保持 active：本切片建立服务端内部上下文及策略/审计 seam，#611–#615 完成前 TD-068 仍保持 Open。

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
- 重基到已修复的 main `a57a88806` 后，最终树完整矩阵通过：前端 408 个文件 / 3022 个测试；scripts 69 个文件 / 830 个通过 / 5 个跳过；bridge 21 个文件 / 138 个测试；server 355 个文件通过 / 1 个跳过，2739 个测试通过 / 4 个跳过。
- `npm run build`、`npm run contract:check`、`npm run docs:check`、`npm run acceptance:ci`、必需 DTS 工具链检查（dtc/fdtoverlay 1.8.1、dtschema 2026.6）及三个项目的 DTS seed 编译均在独立 pgvector 数据库下通过。
- `npm run lint` 完成，0 errors，保留前端基线 299 warnings。`git diff --check origin/main...HEAD` 通过。
- `npm run ui:check` 通过，全部 ratchet 保持 baseline。`npm run logs:eval` 的 16/16 场景与 4/4 meta checks 通过；生成时间戳已还原，未纳入提交。
- 继承的 main-red 视觉失败已由 #617 / PR #619 独立修复，未改动任何已提交 PNG。在当前 #610 最终树上，workflow-equivalent MCR Playwright 从空 pgvector 数据库和独立对象根运行，`acceptance:quality` 及 97/97 质量测试全部通过；另一个空数据库和对象根按 CI production-HMAC 配置通过 `acceptance:smoke` 4/4。
- 已针对 `origin/main...HEAD` 分别执行最终 Standards 与 Spec 复审，两者均为零 finding。因额度耗尽而无法运行的 GitHub checks 不被描述为绿色；owner 已明确批准用最终树完整本地矩阵作为合入依据。

## 后续边界

#611–#615 负责在 HTTP/Xiaoze/system 入口构造上下文，并迁移 DTS 重载五条写路径和参数敏感生产写。本计划不关闭 TD-068，不重构无关审计，也不声称 target/device readiness。

## #611 实现检查点

- [x] Xiaoze 只读与审批工具调用均获得服务端生成的 durable tool-call id，并通过 orchestrator/tool-registry seam 持久化。
- [x] 执行上下文由当前认证主体及持久化的 session、tool-call、approval 记录重建为 `AgentInvocationContext`。
- [x] 审批恢复在执行前校验 session/tool-call/approval 关联；编辑参数在同一事务内替换持久化 payload 并重新授权。
- [x] 请求级 auth、invocation、approval 数据不进入 checkpoint channel state；缺失 durable resume 关联会在执行前失败。
- [ ] #612–#615 仍是后续开放迁移。

## #611 验证

- Xiaoze/orchestrator/AG-UI 聚焦测试通过：5 个文件、57 个测试。
- 本分支全量 server 套件通过：354 个文件通过、2 个跳过；2738 个测试通过、8 个跳过。
- `npm run build`、`npm run contract:check`、`npm run docs:check` 与 `git diff --check` 通过。本机因没有 pgvector，`docs:check` 的数据库 schema 子检查跳过。

## #611 repair 补充记录（最终 rebase 前的历史检查点）

#611 repair 保留上方 #610 的历史与验证原文，不改写其事实。以下是最终 rebase 前的历史检查点：

- 分支：`codex/td-068-durable-agent-provenance`
- 基线：`origin/main@f52038848`
- repair commit：`0dd0b39c6`（`fix(agent): close durable Xiaoze execution gaps (#611)`）
- 实现边界：复用 #610 trusted invocation context seam；`createXiaozeAgentFactory` 要求持久化 `AgentOrchestrator`；主动只读 perception 也通过同一个 durable orchestrator；公开 `ToolRegistry.run` seam 传递一次事务授权证明。不新增 provenance 基础层、临时 UUID 或测试专用执行 fallback。
- 所有实际执行的 Xiaoze tool（包括只读 perception）都通过 orchestrator 获取已持久化的 session/tool-call 记录。只读上下文带有持久化 `sessionId` 与 `toolCallId`，`approvalId: null`。

PostgreSQL durable-resume 证明通过公开 AG-UI 输入由实例 A 创建 session、action tool call、approval 与 interrupt。随后实例 B 使用新的 PostgreSQL 连接、checkpointer、registry、orchestrator，以及同一个认证主体，仅从持久化 checkpoint 恢复。公开 registry 执行 seam 捕获并断言 `initiator: agent`、未变化的 user/organization principal，以及持久化的 session/tool-call/approval id。同时断言 `editedArgs` 是完整的持久化 payload replacement，在事务内只重新授权一次，并在 domain-write seam 前将授权证明传入执行。

同一个公开 resume 路径还拒绝其他 approval id、其他 body thread、approval/tool-call 不匹配、tool-call/checkpoint 不匹配、组织内其他用户以及其他组织。每种替换都会在 `ToolRegistry.run` 之前失败；集成 seam 观察不到额外执行或领域写入，pending 持久化记录保持 pending。

### #611 repair 精确验证

- TDD red 证据：factory/orchestrator 聚焦命令首先报告 2 个失败测试（缺少持久化 orchestrator 约束，以及重复授权断言）；suggest-route 测试在旧的 direct registry fallback 临时存在时首先报告 1 个持久化/context 断言失败。
- 聚焦 green 命令通过：`npm run test:server -- server/modules/agent/orchestrator.test.ts server/modules/agent/toolRegistry.test.ts server/modules/agent/xiaoze/agUiEndpoint.test.ts server/modules/agent/xiaoze/agUiEndpoint.concurrency.test.ts server/modules/agent/xiaoze/agUiEndpoint.assembly.test.ts server/modules/agent/xiaoze/planningGraph.test.ts server/modules/agent/xiaoze/durableAgentResume.integration.test.ts server/modules/agent/xiaoze/suggestRoutes.test.ts` —— 8 个文件、73 个测试通过。
- PostgreSQL durable-resume 命令通过：`npm run test:server -- server/modules/agent/xiaoze/durableAgentResume.integration.test.ts server/modules/agent/xiaoze/suggestRoutes.test.ts` —— 2 个文件、8 个测试通过。
- 全量 server 命令通过：`npm run test:server` —— 355 个文件通过、2 个跳过；2743 个测试通过、8 个跳过。
- `npm run build` 通过（`tsc -b` 与 Vite build）；Vite 保留既有 large-chunk warning。
- `npm run contract:check` 通过：OpenAPI contract artifact 当前有效。
- `npm run docs:check` 通过。本机没有 pgvector extension，因此 database-schema/pgvector 子检查跳过；CI 仍以 pgvector/pgvector:pg16 作为该项验证边界。
- `npm run lint` 通过，0 errors，保留既有 299 个前端 warnings。
- verification matrix 的两个 acceptance spec 已使用独立端口与对象目录运行，没有复用运行中的 5173/8787 服务。`xiaoze-perception.acceptance.spec.ts` 使用前端 `5175` / API `18787` 与 `/tmp/wiseeff-611-perception.47mXaE`，包含 warmup 共 4/4 通过。`xiaoze-action.acceptance.spec.ts` 使用前端 `5176` / API `18788` 与 `/tmp/wiseeff-611-action.73LvlO`，结果为 6 passed、1 skipped、1 failed；唯一失败是已知 main-red 浏览器 approval-card 在 60 秒后超时，位置为 `e2e/acceptance/xiaoze-action.acceptance.spec.ts:776`。其余 action 流程通过，该 UI 基线问题不属于 #611 durable provenance repair。
- 计划更新及文档提交后，`git diff --check origin/main...HEAD` 通过。

### #611 cleanup repair 续记（最终 rebase 前的历史检查点）

本续记只修改测试资源清理边界，不改变 production 行为、trusted invocation 模型、ToolRegistry 授权证明或 AG-UI 接口。

- cleanup repair commit：`79d059635`（`test(agent): guarantee durable resume cleanup (#611)`）。
- 整个 `withTempDatabase` callback 都由外层 `try/finally` 覆盖。实例 A/B 的 saver 在构造完成后、可能失败的 saver setup 之前立即登记；实例 B database connection 在创建后立即登记。cleanup 按实例 B connection、实例 A saver、实例 B saver、shared checkpointer/probe saver 的顺序关闭；可选句柄与重复 cleanup 都安全处理。
- shared saver 状态的 reset 同时位于 callback `finally` 和外层 test `finally`。每个 cleanup 操作分别捕获自己的错误，因此 cleanup 不会替换最先发生的 setup、interrupt、resume 或断言错误。
- 聚焦回归测试在实例 A 就绪、实例 B 创建前主动抛出 sentinel error，断言原始错误保持不变且实例 A saver 已关闭。这覆盖要求的 A setup/interrupt 到 B 创建前失败边界；同一个外层边界也覆盖 B connection、B setup 以及所有正向/负向 resume 断言。
- TDD red：修复前执行 `npm run test:server -- server/modules/agent/xiaoze/durableAgentResume.integration.test.ts` 时报告 1 个失败测试（A saver end 次数为 0），并出现未处理 PostgreSQL `57P01` connection error。Green：同一文件 3/3 测试通过。
- 要求的聚焦命令通过：`npm run test:server -- server/modules/agent/xiaoze/durableAgentResume.integration.test.ts server/modules/agent/orchestrator.test.ts server/modules/agent/toolRegistry.test.ts server/modules/agent/xiaoze/agUiEndpoint.test.ts server/modules/agent/xiaoze/planningGraph.test.ts` —— 5 个文件、60 个测试通过。
- 重跑全量 server 通过：`npm run test:server` —— 355 个文件通过、2 个跳过；2744 个测试通过、8 个跳过。
- 重跑 `npm run build` 通过，保留既有 Vite large-chunk warning。`npm run contract:check` 通过，OpenAPI contract artifact 当前有效。`npm run lint` 通过，0 errors，保留 299 个既有 warnings。
- parent/当前 pgvector 复验使用 `TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run docs:check`，目标为本地 `pgvector/pgvector:pg16` 容器。Documentation governance 通过，且 `db-schema artifact is current`；本次没有跳过 schema 检查。
- 本次计划更新及独立文档提交后，`git diff --check origin/main...HEAD` 通过。

#611 repair 的前述证据保留其原始主机边界，即当时 pgvector 检查跳过；本 cleanup 续记已在上方记录后续 pgvector 复验。该检查点未创建或合并 PR，也没有宣称完整本地 CI 全绿，因为当时 action UI 基线失败仍在。

## #611 最终 rebase 与合入验证

- 最终分支/worktree：`codex/td-068-durable-agent-provenance-final`，路径 `/Users/tzrea1/Develop/WiseEff-td611-final`。
- 最终 rebase 基线：`origin/main@c9abd61c7bcf1508c7728f330cb6b2e40f4534ba`。重写后的五个提交为 `8284fc8e0`、`a13550b73`、`be77cd27d`、`9977885a2` 及 production/test tip `68d76d88e`；`git range-diff` 显示它们与 rebase 前的对应 patch 逐一完全等价。
- 最终 diff 只包含双语 active plan 以及相关 `server/modules/agent/**` 实现/测试。#625 的 `XiaozeProvider` repair 从 `main` 继承，#611 没有把它重新带入 diff。
- 精确树 PostgreSQL 验证通过：durable-resume 文件 3/3；五文件 Agent 聚焦测试 60/60；全量 server 为 356 个文件通过、2747 个测试通过、5 个测试跳过。
- `npm run test:all` 通过：前端 411 个文件/3048 个测试，scripts 69 个文件/926 passed/5 skipped，bridge 21 个文件/138 个测试，server 356 个文件/2747 passed/5 skipped。`npm run build`、`npm run contract:check`、带 pgvector 的 `npm run docs:check`、`npm run lint`（0 errors；既有 299 warnings）、`npm run selfhost:check`、`npm run acceptance:ci`、`npm run acceptance:models`、`npm run acceptance:coverage`、`npm run acceptance:operations` 与 `git diff --check` 均通过。
- source-clean production/test tip `68d76d88e` 上的 owned-runtime Xiaoze 验收通过：action 7 passed/1 planned skip，perception 4 passed，approval-card 连续两轮各 2/2（含 warmup），planning 3/3（含 warmup）。Planning run `full-20260825t013501071z-68d76d88e58d-880ccd19` 完成后两个进程均停止，精确数据库与对象目录均已删除。
- 先前 approval-card main-red 已由 #625 在本次最终 rebase 前独立修复。最终 action 证据确认 card 可见且可批准、聊天保持打开、批准前没有领域写入、resume 携带 Agent provenance 完成，open change-request 数量从 0 变为 1。
- 已运行 `npm run acceptance:evidence`，但因本次 focused Xiaoze run 不包含全量 P0/P1 operation records，该命令未通过。只有 operation-evidence coverage 发生变化时才要求该命令；#611 未修改 operation matrix 或 evidence helper，因此如实记录该 focused-corpus 失败，不将其宣称为通过，也不把它用作 #611 合入门禁。
- GitHub Actions 因月度额度耗尽仍不可用。Owner 已授权以精确树完整本地矩阵作为合入依据。最终 review、PR 创建、合入、Issue 关闭与本地 `main` 同步仍由 parent/session owner 负责。

## #612 实现检查点

- 范围：将 DTS 重载五个领域 mutation 入口——start-run、restore-baseline、deploy、configuration update、promote-to-drafts——及其五个 HTTP mutation route 全部迁移到 branded `TrustedInvocationContext` seam。
- HTTP route 在服务端内部创建 `createUserInvocation(auth)`，并传入服务端拥有的拒绝审计 pool handle。request body、query、header、DTO 字段及任意 `actorType` 字符串都不能选择 provenance；route 回归测试在五个 route 上覆盖 body/header spoof。
- 每个领域入口在任何 mutation 前校验 brand 与认证主体匹配。User 保留既有 permission、敏感操作 token、lease、snapshot、bridge capability、transaction 与审计行为；Agent/System 在领域或设备写入前 fail closed。
- mutation context 要求服务端拥有的 refusal pool handle；handle 缺失或 malformed 时按内部不变量失败，拒绝写入器绝不回退到调用者事务。
- Agent 拒绝继续使用 `dts-reload-agent-refused`。System 拒绝固定为 `dts-reload-system-refused`；System 拒绝审计使用 platform path，`actorUserId: null`、`organizationId: null`，并记录构造出的 service/job identity。Agent 拒绝保留 principal、session、tool-call、approval、action、target、request、`requireHuman` correlation。
- 拒绝证据复用现有 trusted audit writer，并通过服务端拥有的 refusal handle 写入。真实 PostgreSQL 矩阵把 25 个 operation/context cell 分别放入外层事务，随后回滚该事务，再验证拒绝审计仍持久、领域表无变化、没有 lease/snapshot/device side effect，也没有 success audit。

### #612 TDD 与验证证据

- Red：`npm run test:server -- server/modules/dts-reload/routes.test.ts --run` 在迁移前实现上 1 个测试失败，原因是 configuration route 只传 `{ requestId: "test-request" }`；测试要求正式构造的服务端 user invocation，且客户端 `actorType: "agent"` 不得影响它。
- 聚焦 Green：`npm run test:server -- server/modules/dts-reload --run` 通过 18 个文件 / 217 个测试，包含 service、deploy、restore-baseline、configuration、promote、routes 及真实 PostgreSQL provenance matrix。
- provenance matrix 为五个操作 × user/agent/system/missing/malformed。User case 进入原有业务校验路径；Agent/System 返回稳定 403 并留下真实 durable refusal audit；missing/malformed 抛出 `INVALID_TRUSTED_INVOCATION_CONTEXT`；所有拒绝 cell 均无 mutation、success audit、lease、snapshot 或 device call。
- 硬件/HDC 验证明确不在本 Issue 范围内。deploy 矩阵用 adapter spy 证明拒绝发生在 bridge/device seam 之前；该证据不等同硬件验证。
- #613–#615 仍是开放的后续迁移。本共享计划保持 active，#612 不把它移入 `completed/`。

### #612 最终验证边界

- `npx tsc -b`、`npm run build`、`npm run contract:check`、`TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run docs:check`、`npm run selfhost:check` 和 `git diff --check` 在实现树上通过。build 保留既有 Vite large-chunk warnings；lint 通过，0 errors、300 个既有 warnings。
- `npm run test:server` 通过 357 个文件 / 2 个跳过、2754 个测试 / 8 个跳过。`npm run test:scripts` 通过 69 个文件 / 948 个测试，5 个跳过；`npm run bridge:test` 通过 21 个文件 / 138 个测试。
- `npm run test:all` 未全绿：其 frontend 阶段有 5 个既有 UI 测试触发仓库 5 秒超时（410/415 文件、3067/3072 测试通过）。同一命令在干净 `origin/main` worktree 复现出 3 个不同的既有 frontend 失败（412/415 文件、3069/3072 测试通过）。#612 未混入任何无关 frontend 修复。
- 因 #612 没有改变 operation-evidence coverage，未运行 `npm run acceptance:evidence`；没有要求或宣称 HDC/硬件验收。GitHub Actions 因本月额度耗尽仍不可用。

## 文档影响矩阵

| 范围 | 状态 | 证据 |
| --- | --- | --- |
| 仓库地图与 Agent 指引 | Review | `AGENTS.md`；已将安全/auth/审计工作路由到相关文档。 |
| 计划与技术债台账 | Review | `docs/PLANS.md`、`docs/exec-plans/tech-debt-tracker.md`；已保留 TD-068 Open 及迁移边界。 |
| 产品与 API 契约 | Review | `docs/design-docs/api-contract.md`、`server/modules/contracts/`；route path 与 request contract 不变，服务端 provenance 与 actor 字段剥离由 route 测试覆盖。 |
| 架构与领域模型 | Review | `docs/adr/0038-trusted-invocation-provenance-separates-principal-and-initiator.md`、`docs/design-docs/full-stack-architecture.md`、`docs/design-docs/domain-model.md`。 |
| 安全与审计指引 | Review | `docs/SECURITY.md`、`server/modules/audit/auditedWrite.ts`；可信上下文及禁止 default-user 仍是部分迁移。 |
| 质量与验证文档 | Review | `docs/QUALITY_SCORE.md`、`docs/developer/verification-matrix.md`；#612 增加真实 PostgreSQL 五操作 provenance matrix，并明确 HDC 不在本证据边界内。 |
| 中文开发文档 | Review | `docs/zh-CN/SECURITY.md`、`docs/zh-CN/design-docs/full-stack-architecture.md`、`docs/zh-CN/design-docs/domain-model.md`、`docs/zh-CN/PLANS.md`。 |
| 生成物、runbook、前端/设计、references | No change | `docs/generated/`、`docs/runbooks/`、`src/`、`docs/references/`；没有生成 schema、operation、运行时、UI 或运维流程变化。 |

## 文档影响矩阵与更新门禁

- [x] 已按实现 seam 复核 ADR-0038 及英中文安全/架构/领域/API/计划引用。
- [x] 没有公开契约或前端文档因此变陈旧。
- [x] 已在本文件及同步的英文计划中记录 #612 范围、Red、25-cell PostgreSQL matrix、拒绝 code、rollback audit 边界及 HDC 证据边界。
- [x] #612 没有吸收或修改原脏工作树中的 compact-footer 文档改动。
- [x] 已如实记录 #612 的 frontend 阶段失败、干净 `origin/main` 复现及独立 server/scripts/bridge 门禁通过，没有把 `npm run test:all` 失败运行宣称为绿色。
- [x] 已通过 #617 / PR #619 修复继承的 acceptance-quality 失败，并在重基后的最终树上重跑全部必需本地 CI。
- [x] #610 在自身合入前取得 Standards 与 Spec 最终复审零 finding；#611 在本合入记录后由 parent 独立进行最终复审。
- [ ] 只有完整 TD-068 迁移和收口证据落地后，才能将本计划移入 `completed/`。

## Git & PR Workflow

#610 的历史实现与 review 修复和其文档记录在 `codex/td-068-trusted-invocation-context` 上保持独立提交。当前 #611 最终分支为 `codex/td-068-durable-agent-provenance-final`；PR、owner-approved 完整本地 CI 例外、合入、Issue 关闭与 main 同步由 parent/session owner 负责。
