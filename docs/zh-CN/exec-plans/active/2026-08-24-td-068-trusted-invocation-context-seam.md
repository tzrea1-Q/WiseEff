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
- HTTP route 在服务端内部创建 `createUserInvocation(auth)`，并传入由服务端拥有的 PostgreSQL pool root 支撑的 `TrustedRefusalAuditSink`。request body、query、header、DTO 字段及任意 `actorType` 字符串都不能选择 provenance；route 回归测试在五个 route 上覆盖 body/header spoof。
- 每个领域入口在任何 mutation 前校验 brand 与认证主体匹配。User 保留既有 permission、敏感操作 token、lease、snapshot、bridge capability、transaction 与审计行为；Agent/System 在领域或设备写入前 fail closed。
- mutation context 要求带品牌的服务端 refusal sink；sink 缺失或 malformed 时按内部不变量失败，拒绝写入器绝不回退到调用者事务。
- Agent 拒绝继续使用 `dts-reload-agent-refused`。System 拒绝固定为 `dts-reload-system-refused`；System 拒绝审计使用 platform path，`actorUserId: null`、`organizationId: null`，并记录构造出的 service/job identity。Agent 拒绝保留 principal、session、tool-call、approval、action、target、request、`requireHuman` correlation。
- 拒绝证据复用现有 trusted audit writer，并通过带品牌的 sink 写入。真实 PostgreSQL 矩阵把 25 个 operation/context cell 分别放入外层事务，随后回滚该事务，再验证拒绝审计仍持久、领域表无变化、没有 lease/snapshot/device side effect，也没有 success audit。

### #612 TDD 与验证证据

- Red：`npm run test:server -- server/modules/dts-reload/routes.test.ts --run` 在迁移前实现上 1 个测试失败，原因是 configuration route 只传 `{ requestId: "test-request" }`；测试要求正式构造的服务端 user invocation，且客户端 `actorType: "agent"` 不得影响它。
- 聚焦 Green：`npm run test:server -- --run server/modules/dts-reload` 通过 18 个文件 / 219 个测试，包含 service、deploy、restore-baseline、configuration、promote、routes 及真实 PostgreSQL provenance matrix。
- provenance matrix 为五个操作 × user/agent/system/missing/malformed。User case 进入原有业务校验路径；Agent/System 返回稳定 403 并留下真实 durable refusal audit；missing/malformed 抛出 `INVALID_TRUSTED_INVOCATION_CONTEXT`；所有拒绝 cell 均无 mutation、success audit、lease、snapshot 或 device call。
- 硬件/HDC 验证明确不在本 Issue 范围内。deploy 矩阵用 adapter spy 证明拒绝发生在 bridge/device seam 之前；该证据不等同硬件验证。
- #613–#615 仍是开放的后续迁移。本共享计划保持 active，#612 不把它移入 `completed/`。

### #612 repair 前验证边界（历史记录）

- 在独立审查 repair 之前，`npm run test:server` 曾在 4 个未修改的 parameter/parameter-topology PostgreSQL 集成测试上超时，其余为 353 个文件通过 / 2 个跳过、2750 个测试通过 / 8 个跳过。repair 前 DTS 聚焦命令为 18 个文件 / 217 个测试通过。这里保留该历史结果用于追溯，不把它当作下方 repair 结果。
- 在独立审查 repair 之前，`npm run test:all` 曾在 frontend 阶段 5 个既有 UI 测试上失败；同一命令在干净 `origin/main` worktree 上复现出另外 3 个既有 frontend 失败。#612 未混入任何无关 frontend 修复。
- 之前 focused corpus 的 `npm run acceptance:evidence` 结果不作为 #612 门禁。#612 没有改变 operation-evidence coverage，因此本 repair 仍有意不运行该命令；没有要求或宣称 HDC/硬件验收。

## #612 独立审查 repair 检查点

- repair worktree 是 `/Users/tzrea1/Develop/WiseEff-td612`，分支为 `codex/td-068-dts-reload-user-provenance`；已无冲突地从 `49ddd3925` rebase 到 `origin/main@537e932ce101a76606347ce8ab0f67303ace1068`。下文 #611 分支/worktree 引用均为历史记录，不是当前 #612 分支。
- P1 Red：`npm run test:server -- --run server/modules/dts-reload/provenance.integration.test.ts` 在调用者 transaction 被当作旧 `refusalDb: tx` 时失败：旧路径返回 Agent 403，但 rollback 后拒绝审计消失（期望 1 行，实际 0 行）。repair 把裸数据库字段替换为私有品牌 `TrustedRefusalAuditSink`；只有 `createPostgresDatabase` root 能创建它，root-owned closure 通过独立 pool 写入。
- P2 Red：精确 configuration audit 断言发现旧实现得到 `targetId: "org-1"`，而既有公开 contract 要求稳定的 `"dts-reload"`。repair 恢复该 target，同时保留 Agent kind/code、`reason`、`requireHuman`、action、principal、session、tool-call、approval 和 trace correlation。
- P2 假绿 Red：在旧 fixture 仍遗漏 refusal handle 时加入精确 reason/message 断言，malformed 与 principal-mismatch 都先在 refusal-database guard 失败。现在两个 fixture 都携带正式合法 sink，因此 malformed 实际命中 `context must come from a server-owned constructor`，mismatch 实际命中 `DTS reload invocation principal does not match the authenticated principal`；两者都不写 refusal 或 success audit。
- P2 HTTP 覆盖：真实 PostgreSQL matrix 现在经由公开 HTTP router 和五个真实 DTS domain，五条 route 都覆盖 body/header `actorType` spoof，configuration 另覆盖 query spoof。它比较无 spoof 与 spoof 的业务结果，验证 user success audit projection、状态行为、无 Agent/System refusal 以及 deploy bridge 调用为 0。只在 device 前 seam 使用隔离 object-store fake；这不是 HDC 证据。
- 共享 root/sink runtime 测试证明 session wrapper、savepoint/transaction handle 或普通 `{ write() }` 对象都不是可信 sink，并以 `INVALID_TRUSTED_INVOCATION_CONTEXT` 失败。DTS 测试 helper 使用正式 root/sink 构造器，不把测试 transaction 包装成 sink。

### #612 repair 验证结果

- 在基于 `origin/main@537e932ce101a76606347ce8ab0f67303ace1068` 的最终 repair 代码树上，`npx tsc -b --pretty false` 通过；`npm run test:server` 通过 358 个文件 / 2759 个测试，另有 2 个文件 / 8 个测试跳过；第二次 exact `npm run test:all` 通过 frontend 418 个文件 / 3096 个测试、scripts 69 个文件 / 948 个测试（5 个跳过）、bridge 21 个文件 / 138 个测试、server 358 个文件 / 2759 个测试（2 个文件 / 8 个测试跳过）。
- 聚焦证据通过：provenance 1 个文件 / 4 个测试、routes 1 个文件 / 5 个测试、全部 DTS reload 18 个文件 / 219 个测试、audit 6 个文件 / 26 个测试、shared database 4 个文件 / 47 个测试，以及 promote cleanup 1 个文件 / 9 个测试。
- 第一次 exact `npm run test:all` 仅在 scripts 阶段的 `scripts/finalize-gate0-upload.test.ts` 失败（1 failed / 947 passed / 5 skipped），原因是读取不完整的 `ready.json` 时 JSON 解析失败。repair 分支上的直接单文件命令连续 5 次 23/23 通过，干净 `origin/main` worktree 上连续 3 次通过；没有为此无关失败修改源码。重复运行的完整命令通过。既有 warning 包括 `Not implemented: navigation to another Document` 与 `ps: process id too large: 999999999`。
- `npm run build`、`npm run contract:check`、`TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run docs:check`、`npm run selfhost:check` 和 `git diff --check origin/main...HEAD` 通过。build 保留既有 Vite externalized-module 与 large-chunk warnings；lint 通过，0 errors、299 个既有 warnings。因 operation-evidence coverage 未改变，`npm run acceptance:evidence` 仍未运行；GitHub Actions 因本月额度耗尽不可用。
- 不宣称 HDC 或硬件验证。deploy adapter spy 仅证明拒绝/validation seam 先于 device invocation；#613–#615 仍开放，因此英中文共享计划保持 active。

## #613 实现检查点

- 范围：parameter submission 在 binding draft、node-enablement draft、structured DTS edit，以及 semantic / 保留的 legacy Xiaoze action 路径上，都必须携带同一个 branded `TrustedInvocationContext` 与 root-owned branded refusal sink。直接 HTTP route 在认证后构造 `createUserInvocation(auth)`；request `actorType`、`initiator`、header 与 query 都不属于 provenance contract。
- Domain 在 permission、query、transaction、draft consumption、candidate 变化、submission row 或 success audit 之前，校验 context、refusal sink、request correlation 以及 User/Agent principal 一致性。structured nested submission 传播同一个 context。missing、malformed 或 principal substitution 均 fail closed，不再默认成 user。
- Xiaoze action 要求 orchestrator-owned Agent invocation 与持久化 session、tool-call、approval id 精确一致。approval 只是 correlation evidence，绝不把 `initiator: agent` 转成 user。semantic 与 retained-legacy identity 两条路径都把同一 invocation 传入 domain。
- critical sensitive-node submission 继续允许具备原 capability 的直接 user，但对 Agent 与 System 返回稳定 `403`。high-tier 与 non-sensitive Agent 保持既有 capability/approval 行为。Agent refusal audit 记录 accountable user、organization、session、tool-call、approval 与 trace；System refusal 记录 service/job identity，且 actor user 为 null。拒绝通过独立 root sink 写入，可跨 caller transaction rollback 持久化；成功 submission 与 trusted success audit 保持同一事务原子性。
- #614 topology/writeback governance、#615 全局 legacy actor-label 清理、TD-123 device-write audit、公共 API/DTO 变化、前端工作以及 HDC/硬件/live-provider readiness 都不在范围内。TD-068 与父 Issue #609 仍为 Open，本计划继续保持 active。

### #613 TDD 与验证证据

- 迁移前 Red：`actionTools.test.ts` 有 2 个失败，semantic 与 legacy submission 只收到手写 `{ actorType: "agent" }`；`routes.test.ts` 有 1 个失败，HTTP route 未提供 branded user invocation；`submissionProvenance.test.ts` 有 2 个失败，missing/malformed context 在 transaction 前未被拒绝。
- 最终聚焦树：14 个文件 / 185 个测试通过，覆盖 route、binding/enablement/structured submission、semantic/legacy Xiaoze、orchestrator、registry、critical policy 与 PostgreSQL provenance。owned PostgreSQL matrix 覆盖 user/Agent/System/missing/malformed 和 critical/high/non-sensitive；断言拒绝后领域残留与 success audit 均为零、refusal 跨外层 rollback 持久、correlation 真实、organization substitution 被拒绝，以及成功领域行与 success audit 共同 rollback。
- 独立 Standards review 发现 non-sensitive System 成功提交最初会被投影到 platform scope。新增 PostgreSQL 断言以“tenant audit row 不存在”失败；structured 与普通 success writer 现都为 System 显式传入认证租户 scope，同时保持 `actor_type: system`、`actor_user_id: null`。聚焦 repair 命令 3 个文件 / 37 个测试通过，随后 `npx tsc -b` 通过。
- `npx tsc -b` 通过。`npm run test:all` 通过：frontend 418 个文件 / 3096 个测试；scripts 69 个文件 / 948 passed / 5 skipped；bridge 21 个文件 / 138 个测试；server 361 个文件 / 2766 passed / 4 skipped。第一次独立全量 server 仅有一个已迁移测试 fixture 失败（`parameter-files/integration.test.ts`，期望 201、实际 500）；注入正式 test refusal sink 后该文件 3/3 通过，随后 `test:all` 的完整 server phase 通过。
- `npm run build`、`npm run contract:check`、pgvector-backed `npm run docs:check`、`npm run lint`（0 errors；继承的 299 warnings）、`npm run selfhost:check` 与 `npm run acceptance:ci` 通过。build 保留既有 browser externalization 与 large-chunk warning；测试保留 jsdom navigation、`ps: process id too large` 与 planned skip 输出。
- owned-runtime perception acceptance 在前端 `5174` 和自动分配 API 端口上 4/4 通过，没有触碰既有 5173/8787 listener。action acceptance 为 3 passed / 1 planned skip / 4 failed：approved-write case 选择到没有 source text 的 seeded semantic binding，在 `submitParameterChanges` 前以 `Config set source text unavailable for typed edit` 停止。干净 detached `origin/main@b676a1e32` 复现了同一聚焦 approval 失败与相同错误，因此未吸收无关 fixture 修复。所有生成的 database、object root、API/frontend process 与 browser run 都独占且已清理；仓库 helper 的 undefined `stopRuntime` 失败有一次需要恢复处理，在删除 marker-proven database 后，将精确 object root 移入 Trash。
- 未创建或合并 PR，也未关闭任何 Issue。最终验收、PR、合入与 Issue 更新仍由 parent/session owner 负责。

## #613 独立 review repair 检查点

- repair 保持在 `/Users/tzrea1/Develop/WiseEff-td613` 的 `codex/td-068-parameter-submission-provenance` 上。起点为基于 `origin/main@b676a1e320f1d7fcc1c5e9baaba78c3510c97b14` 的 feature HEAD `cbbe13fce16097e5fdd5f3ee6d4a127e3411364f`；production 与 PostgreSQL repair commit `8bd4eb844` 以追加方式提交，没有 amend 历史。
- P1 根因：semantic Xiaoze early guard 使用 `loadBindingContext.node_locator`，其子查询按字符串 id 排序选取 latest logical-node revision；central binding-draft guard 则使用 flat parameter source projection。两者都没有传入 exact revision 的 `compatible`，因此 compatible-only critical rule 可被绕过。
- 两个 binding guard 现共用 `loadLogicalNodeSubmissionContext`。输入是 organization、project、stable logical-node id 与 exact server-owned config revision；没有 latest 或 client fallback，并把持久化 DTS compatible 的第一个 token 规范化为 sensitive-rule matcher 使用的同一单 compatible 匹配输入。
- Xiaoze 按数值 `dts_config_revisions.revision_number` 解析最新 binding revision，并要求该 revision 同时携带 binding 的 stable logical node；guard 发生在 value parse、draft 和 candidate 创建之前。central seam 只使用已锁定 draft 持久化的 `base_config_revision_id` 与 binding logical-node id；不会替换成 candidate、current head、请求数据或 flat source projection。
- 修复前 PostgreSQL Red：新增 compatible-only critical action 测试期望 Agent 403，但旧行为实际成功 resolve 并创建 change request。Green 证明 early Agent refusal 发生在 draft/candidate/round/change-request/item/success-audit 之前，refusal correlation 可跨外层 rollback 持久化；central 对预先存在的有效 draft/candidate 拒绝后不消费 draft、不 promote candidate。相同 central draft 还证明 System refusal 的 actor user 为 null、无 capability 的直接 user 403 且状态不变，以及有 capability 的直接 user 成功。
- 既有 path-critical、high-tier Agent、non-sensitive Agent、missing/malformed trusted context、route-owned user context、structured submission 及 success/refusal 原子性 matrix 继续作为回归门禁。本 repair 不改 frontend、route、DTO、公共 API、migration 或 schema，也没有实施 #614/#615 的 trusted-provenance 工作，未改变这些 Issue 的接口或验收状态；但 shared enablement loader 的 quoted-compatible normalization 确实窄幅收紧了下文所述 topology enablement edit caller 的 compatible-rule matching。本 repair 不声称 HDC/device readiness。

### #613 独立 repair 验证结果

- `npx tsc -b --pretty false` 通过。独立 review repair 后的 exact focused 命令通过 9 个文件 / 83 个测试，覆盖 compatible PostgreSQL action、binding-central 与 enablement-central 检查、submission provenance、structured submission、action unit/sensitive、Xiaoze assembly、parameter routes、sensitive-node policy 及 post-cutover workflow。
- 第一次完整 server 运行发现 2 个 Xiaoze assembly fixture 失败，原因是其 module mock 未暴露新增的 exact-node loader/trusted guard。没有增加 production fallback；追加 test commit `3326d8eec` 按真实 production dependency shape 接线，该文件 5/5 通过，完整 server 复跑为 361 个文件 / 2768 个测试通过，1 个文件 / 4 个测试跳过。
- `npm run test:all` 在 review-repaired code tip 上通过：frontend 418 个文件 / 3096 个测试；scripts 69 个文件 / 948 passed / 5 skipped；bridge 21 个文件 / 138 个测试；server 361 个文件 / 2770 passed / 4 skipped。独立完整 server 复跑同样为 2770 passed / 4 skipped。测试输出保留继承的 jsdom navigation 与 `ps: process id too large` warning。
- `npm run build`、`npm run contract:check`、pgvector-backed `npm run docs:check`、`npm run lint`（0 errors / 继承的 299 warnings）、`npm run selfhost:check` 与 `npm run acceptance:ci` 通过。build 保留继承的 browser-externalization 与 large-chunk warning。
- owned-runtime Xiaoze acceptance 在 review-repaired code tip `6652a1286` 上再次通过 10 tests / 1 planned skip：action 的 6 个可执行 case 全部通过，perception 3/3，runtime warmup 通过。run `full-20260826t151950508z-6652a128651f-dbb0f41f` 使用 API `18800`、frontend `5180`；两个进程均停止，精确 database/object root 均删除。既有 `8787`/`5173` 端口没有被使用或发送 signal。
- 此前一次 controller 调用在 Playwright 启动前失败，因为 wrapper 在缺少必需 process-start identity 时尝试把 browser phase 标记为 `running`。其 owned API/frontend 当时已停止；marker-bound orphan recovery 只删除 run `full-20260826t150116846z-3326d8eec622-b675ae8d` 的精确 database/object root，并验证两个端口未监听、数据库不存在。该 harness retry 不计作产品测试通过或失败。
- 新 Standards review 发现一项 P1 不一致：enablement 返回持久化的带引号 compatible，而新 binding loader 会 canonicalize。commit `6652a1286` 统一两个 exact-revision loader 的 compatible token canonicalization，并增加 owned-PostgreSQL enablement Agent/System durable refusal、draft/candidate 状态不变、真实 audit 及 capable-user success 覆盖。
- 新 Spec review 发现两项 P2 证据缺口。PostgreSQL central 测试现创建数值 revision 更高、compatible 不同且安全的 binding/logical-node revision，证明 persisted draft base 优先于 latest/head；独立 semantic compatible-only high rule 证明 approved capable Agent 仍成功且 Agent audit 真实。双语 workflow 记录现列出完整追加 repair chain。此文档记录后将以固定最终点再次复审 P1/P2。

### #613 shared enablement-loader 边界 repair

- Parent review 指出，`loadLogicalNodeEnablementContext` 同时由 #613 enablement-submission central guard 和未来 #614 所属的 topology enablement edit path 使用。因此保留 commit `6652a1286` 的 normalization，也会让 `createNodeEnablementDraft` 中持久化的 `"wiseeff,charging_core"` compatible 匹配 compatible-only `wiseeff,charging_core` rule。这是刻意保留的窄幅安全修正，不表示 #614 已实现。
- Test commit `f661fbcfd` 在 `postCutoverWorkflow.integration.test.ts` 增加 owned temporary PostgreSQL 回归。测试通过公开 `createNodeEnablementDraft` service seam，绑定 organization、project、exact config revision 与 stable logical-node identity；证明无 capability 的直接 user 在 draft/candidate 创建前收到 403，并证明具备 `parameter:edit-critical` 的直接 user 仍只创建一个 draft/candidate。该测试不对 legacy path 声称 Agent/System provenance。
- 敏感性 Red 临时且未提交地让 enablement loader 只返回 raw `row.compatible`。同一个 exact focused 命令随后失败：无 capability user 的 promise 没有拒绝，而是成功创建 enablement draft/candidate。随后用 `apply_patch` 恢复 `canonicalizeLogicalNodeCompatible(row.compatible)`；恢复后的 `writeLock.ts` blob `e5d3d3b3a7524ca01a95e018d8f60bc697e14816` 与 SHA-256 `5dd686210d8fed05040e068a1a5f09065896a63dd22ac0792f9dbd629312c4e8` 均和 mutation 前一致，production diff 为空。
- 最终 Green：聚焦文件 15/15、`npx tsc -b --pretty false`、用户指定 9-file matrix 75/75 全部通过。`npm run test:all` 通过：frontend 3096/3096；scripts 948 passed / 5 skipped；bridge 138/138；server 361 files / 2771 passed / 4 skipped，另有一个 planned-skipped file。`npm run build` 与 `npm run contract:check` 通过，保留继承的 browser-externalization 和 large-chunk warning。
- Pgvector-backed `npm run docs:check`、`npm run lint`（0 errors / 继承的 299 warnings）、`npm run selfhost:check`、`npm run acceptance:ci` 与 `git diff --check origin/main...HEAD` 均在 exact repair tree 上通过。测试输出保留继承的 jsdom navigation 和 `ps: process id too large` 提示；任何 skip 或 warning 都没有被当作 pass 报告。
- #614 保持 Open，继续负责 topology/writeback 从 legacy `actorType` 到 `TrustedInvocationContext` 的迁移，包括 Agent/System provenance、refusal-audit durability、接口及完整 acceptance matrix。本次只有 test/docs repair，未重跑也未声称 Xiaoze owned-browser、viewport、Hosted、HDC、硬件或 live-provider 验证；此前 `6652a1286` 的 Xiaoze acceptance 仅作为历史证据。

## #614 实现检查点

- 范围：把 topology node-enablement draft、property-key cutover prepare、semantic parameter writeback、保留的 legacy parameter writeback 与 enablement writeback 迁移到同一个必填 branded `TrustedInvocationContext`，并使用由服务端 PostgreSQL root 创建的 branded refusal sink。review/software-merge route 在服务端构造 User invocation，并原样传给三种 writeback；内部 Agent/System caller 可以显式传入原始 invocation。
- 共享 sensitive-write guard 在策略或写入前校验冻结的 invocation brand、非空 request id、root-owned branded sink，以及 User/Agent principal 与 organization 的精确一致性。具备 capability 的直接 User 仍可通过 critical rule；Agent 与 System 稳定收到 `parameter-sensitive-node-human-required`。high/no-match 行为不变，成功审计不会把 Agent/System 降级成 User。
- HTTP route 是 User provenance 的构造边界。body、query 与 header 中伪造的 `actorType`/provenance 均被忽略，DTO 和 OpenAPI 没有增加 selector。嵌套 service 不自行构造 User invocation，也不接受裸 transaction/database 作为 refusal sink。
- property-key cutover 在第一次 candidate、source version 或 object put 前，对全部 would-rewrite location 做完整预检。PostgreSQL 回归将 critical location 放在第二项，证明 Agent/System 拒绝后 run/items、candidate、current/source version、object store 与 success audit 均不变，而独立 refusal audit 仍持久存在。
- topology、cutover 与 writeback success audit 都从同一个 invocation 和 trace 做可信投影，并与数据库领域变化处于同一事务。audit-failure 注入会回滚 draft、candidate、current version、binding revision、review decision 与 merged change-request 状态。若 immutable blob put 先于数据库 audit failure，物理对象本身不可事务化；测试证明它没有数据库行或 current-version 引用，并如实记录为不可达对象，不宣称 object store 具备数据库原子性。
- owned PostgreSQL provenance 覆盖五类 operation，以及 User、Agent、System、missing、malformed/unbranded、空 request id、伪造 sink、cross-user 与 cross-organization context。独立风险场景覆盖 critical/high/no-match、capable/incapable User、完整 Agent approval provenance、System service/job identity、caller rollback 后 refusal 仍持久，以及 success-audit failure rollback。object-store spy 证明 validation/policy 拒绝单元不会 put。
- 唯一窄幅 shared audit 改动，是 candidate creation 可选接收 trusted invocation。原有 candidate audit 输入只能投影 legacy User auth，无法在 property-cutover 的 System/Agent high/no-match 成功路径中如实保留 initiator metadata；既有 caller 保持兼容，#610-#613 行为不变。
- TDD Red：`npm run test:server -- --run server/modules/parameter-kernel/sensitiveNode.test.ts` 为 1 个失败、11 个通过，原因是 `assertTrustedSensitiveNodeWriteAllowed` 尚不存在。Green 引入共享 guard。review repair 后，扩展的 affected PostgreSQL 命令通过 14 个文件 / 177 个测试，其中包含使用正式 root-owned sink fixture 的既有 #613 exact-compatible enablement 回归。
- 无冲突 rebase 到 `origin/main@e9d29dc293c377e48a89f3f94e6e8bb8f45a9807` 后的最终 exact-tree 验证：`npx tsc -b --pretty false` 与 14-file / 177-test affected PostgreSQL matrix 通过；完整 server 通过 363 个文件 / 2784 个测试，1 个跳过；scripts 通过 69 个文件 / 948 个测试，5 个跳过；bridge 通过 21 个文件 / 138 个测试。build、contract、pgvector-backed docs（schema artifact current，未 skip）、lint（0 errors / 继承的 299 个 frontend warnings）、selfhost、acceptance CI 与 diff check 通过。build 保留既有 5 个 Node module browser-externalization warning 和 large-chunk warning；测试保留 jsdom navigation 与 oversized-process-id informational stderr。
- 最终一次 `npm run test:all` 不宣称 green：frontend phase 因 `NodeDebuggingPage.test.tsx` 的一个 5 秒 timeout 停止 shell chain（417 个文件 / 3105 个测试通过；1 个文件 / 1 个测试失败）。直接单文件复跑 60/60 通过，且 `git diff origin/main...HEAD -- src` 为空，因此实际测试的 frontend tree 与最终基线一致。更早尝试也出现相同的波动 timeout 类别，其中干净 detached `origin/main@5d5e35cff` 对照曾复现。没有吸收 frontend 修复；后续 phase 使用独立命令取得上面的通过计数。
- 首轮双轴审查共报告 6 项 finding。Spec：P1 internal Agent/System merge audit 仍走 legacy User 投影；P1 capability denial 可能被误记为 human-required；P2 cutover second-location 证据缺少 exact source/current identity 与 refusal rows。Standards：P1 candidate creation 接受 cross-principal trusted invocation；P2 新 PostgreSQL cleanup 可能隐藏独立 cleanup failure；P2 unit refusal sink 指向共享 configured database。repair 在 candidate put 前复用 invocation/auth matcher，调整为 capability-before-initiator 次序，使用 trusted merge audit projection，补齐 cutover 状态/refusal 精确断言，采用保留 primary error 的 cleanup，并把 unit test 改为 owned temporary database。PostgreSQL 现显式断言 Agent/System merge 成功审计，以及 incapable Agent/System 不产生 human-required refusal。repair 后完整 server 再次通过 363 个文件 / 2784 个测试，1 个跳过。
- 第二轮 Standards review 仍发现 2 项：System merge metadata 把 authenticated user 写成 executor；共享 candidate context 未在 abandon/recompute/activate 中 normalize。后续 repair 按 User、Agent tool 或 System job/service identity 投影 execution participant，并在每个导出 candidate mutation 入口校验 trusted context。新增 non-create cross-user 回归证明 abandon 状态不变。repair 后 14-file / 177-test affected matrix 与完整 363-file / 2784-test server suite 再次通过。
- 最终固定 rebase HEAD 上的独立 Standards 与 Spec 复审均为 0 findings（P0-P3）。stable patch ID 与 `git range-diff` 证明最终无关 main rebase 前后 8 个实现/repair commit 保持 patch-equivalent。
- 明确排除：#615 legacy API/type ratchet 与 TD-068 关闭、TD-123 device-write audit、前端/public DTO/schema/migration、cutover preview/start/finalize 迁移、Xiaoze #611、DTS reload #612、HDC、硬件、live provider 与 Hosted CI。GitHub Actions 月度额度仍已耗尽，不宣称 Hosted 通过。本计划保持 active，等待 #615 完成 TD-068。

## #614 parent review repair 检查点

- Parent review 在 feature HEAD `43549fd0976e40f0c73eb6a527d4310c1016d417` 发现两个 P1：compatible-only 策略通过文件可变的 `current_version_id` 读取 compatible，而不是使用 cutover location/write lock 固定的版本；Agent/System 成功操作仍把 `auth.user` 复制到领域 creator/reviewer/history 字段和合入通知。
- exact-version Red 使用 owned PostgreSQL：第二个 cutover location 的 pinned version 命中 critical compatible，而 current head 为 safe。修复前 promise 错误 resolve 并进入 staging，没有返回 403。Green 增加 server-owned `sourceFileVersionId` seam，resolver 同时约束 Organization、project、file name、file version 与 node locator。版本不属于该 scope 时 fail closed；结构模型中没有该 node 时仍保持 compatible no-match。semantic/enablement write lock 现传递 pinned version 与 logical-node locator；retained legacy writeback 显式传递它实际 patch 的 current version。反向 locked-safe/current-critical System 用例成功，证明不会因可变 head 产生错误拒绝。
- domain-attribution Red 要求成功的 System semantic writeback 持久化 `created_by_user_id = null`；修复前 PostgreSQL 实际写入无关的 authenticated user id。Green 只从 trusted invocation 投影 accountable user：User/Agent 使用 `invocation.principal.user`，System 对 nullable candidate、file-version、config-revision、history/value creator/changer 字段写 null。Agent 通知使用 `Agent tool:<toolCallId> (session:<sessionId>)`，不会把 principal 描述成 direct executor。
- `parameter_drafts.user_id` 与 `parameter_review_decisions.reviewer_user_id` 在 owner 授权的 migration 后是可空的 accountable-principal 字段。不创建 synthetic user。User/Agent 行写入经过校验的 principal user；System 行写入 null user attribution，并由数据库约束要求真实 service/job identity。critical System 仍先经过 sensitive preflight，保持 `parameter-sensitive-node-human-required`；high/no-match System topology draft 与 software merge 保持原有成功行为。独立 root sink 为 critical refusal 保存真实 service/job identity，actor user 为 null。Agent 继续使用已校验 principal 负责问责，同时 audit、history 与 notification 保持 Agent execution identity。
- PostgreSQL 回归覆盖 cutover/semantic/enablement 分叉版本、critical Agent/System 零 staging、反向版本 System 成功、System nullable creator、Agent principal-owned draft/review/history row、真实 notification body/metadata、cross-principal 拒绝、durable domain-model refusal，以及 audit-failure rollback 后无 merge notification。若 immutable object put 先于注入的数据库 audit failure，物理对象仍不可事务化，但没有已提交数据库状态可达它。
- final fetch 前的 repair 验证已通过 `npx tsc -b --pretty false` 与 7-file focused matrix（84/84），包含 owned PostgreSQL cutover 与五路径 provenance workflow。完整 server 为 362 个文件通过、1 个 planned-skipped file，2784 passed / 4 skipped；一次 fetch 前 `npm run test:all` 全阶段通过：frontend 418 个文件 / 3106 tests，scripts 69 个文件 / 948 passed / 5 skipped，bridge 21 个文件 / 138 tests，server 再次得到同一 362-file / 2784-test 结果。final fetch 确认 `origin/main@e9d29dc293c377e48a89f3f94e6e8bb8f45a9807` 未前进后，typecheck、focused 84/84、standalone server、scripts、bridge、build、contract、pgvector-backed docs/schema（未 skip）、lint（0 errors / 299 个继承 frontend warnings）、selfhost、acceptance CI 与 diff check 再次通过。但两次 final-HEAD `test:all` 都在 frontend 停止：第一次为 DTS reload 与 Node debugging 各一个 5 秒 timeout（416 files / 3104 passed），精确两文件复跑 100/100；第二次为 App auth-config assertion 与同一 Node timeout（416 files / 3104 passed），精确两文件复跑 199/199。`git diff origin/main...HEAD -- src` 为空；“不得创建新 worktree”规则阻止本次新建 clean-main 对照。这两次不宣称 green。输出保留继承的 Vite 5-module browser externalization 与 large-chunk warning、jsdom navigation stderr 及 oversized process-id stderr。Hosted CI 仍不可用；#615、TD-123、schema、frontend、HDC、硬件与 live-provider 均排除。本计划保持 active。
- 后续 fixed-HEAD 审查发现 semantic/enablement 策略仍从物理 overlay row 读取 compatible，而不是从 `baseConfigRevisionId` 固定的精确 logical-node revision 读取。owned-PostgreSQL Red 删除测试中合成的 overlay `dts_nodes` row 后，Agent/System critical writeback 均错误成功。write lock 现按 `organization + project + base config revision + logical node` 解析 locator 与 canonical compatible，把两者作为 authoritative lock context 传递；这两条路径不再查询较新的未绑定 logical-node revision，也不再回退到物理文件 compatible。
- 同轮审查把 trusted candidate provenance 收窄到 candidate creation，即 #614 唯一共享 mutation。abandon、recompute 与 activate 保留 legacy correlation-only 合同；若运行时传入 trusted invocation，会在首次读取/写入前拒绝，因为这些路径的 nullable/non-null user attribution 与嵌套 DTS sync audit 尚未迁移。这样不会在真实 trusted candidate audit 旁留下伪造 User 的领域记录，也不吸收 #615 或平台级 candidate actor 迁移。
- Spec 审查还发现 nested cutover lookup 歧义：exact-version resolver 优先选择截短后的父 locator，而不是调用方传入的完整 node locator。safe parent、critical 第二位置 child 的真实 PostgreSQL Red 错误进入 candidate staging。resolver 现优先 exact full locator，仅为传入 property path 的 caller 回退到 parent。反向 critical-parent/safe-child System guard 成功，且无 audit、object put 或领域变化。
- final fetch 后的修复树通过 typecheck、owned-PostgreSQL 8-file / 84-test focused matrix 与完整 server（363 files；2787 passed / 1 skipped）。第一次完整 server 在一次 typed-draft exact-loader 扩展后暴露 `editService.test.ts` 四个失败；该扩展超出必需 write-lock seam，且不兼容 candidate working-tip revision，因此追加 commit `85257b8b3` 恢复既有 typed-draft 边界，同时保留 exact write-lock 解析。随后精确两文件回归 43/43 与完整 server 复跑均通过。
- final `test:all` 不宣称 green：未修改 frontend 在既有 `NodeDebuggingPage.test.tsx` 5 秒 timeout 停止（417 files / 3105 passed；1 file / 1 failed），精确单文件复跑 60/60，且分支没有 `src/**` diff。final-tree 独立命令通过 scripts（69 files / 948 passed / 5 skipped）、bridge（21/138）、build、contract、pgvector-backed docs/schema（未 skip）、lint（0 errors / 299 inherited warnings）、selfhost、acceptance CI 与 diff check。输出保留 jsdom navigation、oversized-process-id、5 个 browser-externalization 与 large-chunk warnings；Hosted CI 未运行。

## 文档影响矩阵

| 范围 | 状态 | 证据 |
| --- | --- | --- |
| 仓库地图与 Agent 指引 | Review | `AGENTS.md`；已将安全/auth/审计工作路由到相关文档。 |
| 计划与技术债台账 | Review | `docs/PLANS.md`、`docs/exec-plans/tech-debt-tracker.md`；已保留 TD-068 Open 及迁移边界。 |
| 产品与 API 契约 | Review | `docs/design-docs/api-contract.md`、`server/modules/contracts/`；route path 与 request contract 不变，服务端 provenance 与 actor 字段剥离由 route 测试覆盖。 |
| 架构与领域模型 | Review | `docs/adr/0038-trusted-invocation-provenance-separates-principal-and-initiator.md`、`docs/design-docs/full-stack-architecture.md`、`docs/design-docs/domain-model.md`。 |
| 安全与审计指引 | Review | `docs/SECURITY.md`、`server/modules/audit/auditedWrite.ts`；可信上下文及禁止 default-user 仍是部分迁移。 |
| 质量与验证文档 | Review | `docs/QUALITY_SCORE.md`、`docs/developer/verification-matrix.md`；#614 增加五类 operation trusted-provenance、second-location preflight 与 audit-rollback PostgreSQL 覆盖，并明确 HDC 不在本证据边界内。 |
| 中文开发文档 | Review | `docs/zh-CN/SECURITY.md`、`docs/zh-CN/design-docs/full-stack-architecture.md`、`docs/zh-CN/design-docs/domain-model.md`、`docs/zh-CN/PLANS.md`。 |
| 生成物、runbook、前端/设计、references | Updated generated artifact | `docs/generated/db-schema.md` 记录 owner 授权的 0129-0135 字段/约束、0136 tombstone 投影及 enablement binding 可空身份；`docs/runbooks/`、`src/` 与 `docs/references/` 保持不变。 |

## 文档影响矩阵与更新门禁

- [x] 已按实现 seam 复核 ADR-0038 及英中文安全/架构/领域/API/计划引用。
- [x] 没有公开契约或前端文档因此变陈旧。
- [x] 已在本文件及同步的英文计划中记录 #614 范围、TDD Red/Green、五条 trusted write 路径、durable refusal、success-audit rollback、object-store 边界及 HDC/Hosted 排除项。
- [x] #614 没有吸收或修改原工作树中无关的 `src/App.tsx` 与 `src/App.test.tsx` 改动。
- [x] repair 前的 frontend/完整 server 失败及干净 `origin/main` 复现仍与当前 repair 结果分开记录；当前 exact-tree server 与 `test:all` 重跑结果连同 warning 和 skip 已记录。
- [x] 已通过 #617 / PR #619 修复继承的 acceptance-quality 失败，并在重基后的最终树上重跑全部必需本地 CI。
- [x] #610 在自身合入前取得 Standards 与 Spec 最终复审零 finding；#611 在本合入记录后由 parent 独立进行最终复审。
- [ ] 只有完整 TD-068 迁移和收口证据落地后，才能将本计划移入 `completed/`。

## Git & PR Workflow

上文 #610-#613 的 branch/worktree 引用均为历史记录。#614 实现位于 `/Users/tzrea1/Develop/WiseEff-td614` 的 `codex/td-068-parameter-governance-provenance`。它从 fetch 后的 `origin/main@8b6a2ad2d80e6bdd24af150863ef1c7293039dbe` 开始；main 前进后多次无冲突 rebase，最终基线为 `origin/main@e9d29dc293c377e48a89f3f94e6e8bb8f45a9807`。本 session 不创建或合并 PR，不关闭 #614/#609，也不修改 Issue label。TD-068 保持 active，因为 #615 负责最终 legacy ratchet 与关闭证据。最终 PR、合入、Issue 与 main 同步权限仍归 parent/session owner。

## #614 owner-authorized repair continuation（exact node identity 与 System domain execution）

本节记录父审查后两个 P1 的修复，并取代此前把所有 System high/no-match 操作视为 user-owned domain 拒绝的限制。Owner 已确认 Issue 要求的 lower-tier/no-match 公开行为保持不变：System invocation 可以完成这些操作；critical sensitive rule 仍要求直接 User，并返回稳定的 human-required 拒绝。修复范围仍限定为 #614 五条生产路径及其直接领域消费者。

- 修复从 feature HEAD `43549fd0976e40f0c73eb6a527d4310c1016d417` 开始。fetch 到 `origin/main@948f6fedd57bd13a2ee8b880fc500ef8b5917466` 后无冲突 rebase 到 `b083ad453294560c524923e93a55af85248b2a0f`；追加 Red commit 为 `510da3f1c70ce9f4deaeb54b040f91aea661821f`。后续 fetch 观察到 `origin/main@e87d7d23d6c9e442839527b0bc9879ce27d83b37`；最终 rebase 与固定 HEAD 证据会在 repair commits 后补记。
- 第二个父审查 P1 是 exact-node fail-open：left-lateral compatible 查询把 `dts_nodes` 缺失与 `compatible` 为 SQL NULL 混为同一结果，路径 helper 还把完整 node locator 静默剥成父节点。新的判别式 source-path seam 区分 `node-locator` 与 `property-path`。exact version 查询先约束 Organization、project、file name、file version，再要求完整 locator 的 DTS node；节点缺失返回 `CONFLICT` 和 `parameter-sensitive-node-identity-mismatch`，节点存在但 `compatible IS NULL` 仍是合法 no-compatible 结果。只有显式 property-path caller 才能删除末尾 property；node-locator 不会继承父节点。
- Cutover preflight、semantic/enablement writeback 使用锁定的 exact source file version。提供 source file/version 时忽略非权威 caller compatible；topology revision compatible 仅在从服务端 exact revision 读取后才具有权威性。不使用 mutable `current_version_id`、latest revision、客户端 compatible 或隐式 parent fallback；目标 Organization 不匹配也会在 rule lookup 前拒绝。
- TDD Red 来自旧实现的真实公开 seam：聚焦 cutover 测试显示缺失 child 仍 resolve 并 staging（`ApiError expected rejection, promise resolved`）；System topology high 与 System software merge 均从旧 `requireTrustedAccountableUser` 抛出 `ApiError: This workflow requires an accountable user principal.`。Green 使用 owned PostgreSQL 的 cutover、semantic、enablement、merge 测试覆盖。
- Owner 授权的领域模型使用 nullable user attribution 与显式 initiator metadata。`0128_parameter_execution_provenance.sql` 为 drafts、review decisions、history/value、file versions/candidates、config revisions、binding revisions 加入 initiator type、service/job identity 和 Agent correlation 字段，并使 `parameter_drafts.user_id`、`parameter_review_decisions.reviewer_user_id` 可空。后续 `0129_parameter_system_user_attribution_guard.sql` 禁止 System 行携带 user id；`0130_parameter_governance_execution_identity.sql` 为 submission round/change request 增加同样的真实 nullable submitter/initiator 合同，并允许 logical-node enablement 行没有 binding id；`0131_parameter_draft_enablement_owner_index.sql` 移除过时的 user-only enablement index。不创建 synthetic user。
- 语义明确区分：User/Agent 只把经过 trusted context 校验的 principal 用作 accountable user；Agent 仍是 initiator，session/tool-call/approval 只留在内部领域/审计投影；System 的 user attribution 为 null，使用真实 service/job identity。history、file/version/candidate/config/binding、review decision、workflow trail 和 merge notification 都使用同一 trusted projection。System high/no-match topology draft 与 software merge 成功；公共用户可见 projection 仅展示 `WiseEff System service|job` 或 `WiseEff Agent` 粗粒度标签，不返回 raw correlation 或内部 System name。critical Agent/System 仍使用 `parameter-sensitive-node-human-required` 和 durable root-sink evidence。
- PostgreSQL 覆盖 operation × User/Agent/System × critical/high/no-match，以及 missing/malformed/empty trace、forged sink、cross-user/cross-Organization、locked/current compatible 分叉、safe parent + missing child、exact compatible NULL、safe-locked/critical-current 反向场景。断言 rows、status、versions、locks、revisions、notification、success/refusal audit 和 object-store put；cutover 将 critical location 放在第二项并证明拒绝前无 candidate/item/source/current/object/success-audit 变化。
- success audit 与领域写入在同一事务；注入 audit failure 会回滚 draft/candidate/current-version/file-version/binding-revision/history/value/review/change-request，且不留下 notification。若 immutable blob 在数据库错误前已 put，只报告为无已提交引用的 orphan，不宣称 object storage 具备事务原子性；refusal evidence 通过独立 root pool 持久化并跨 caller rollback 保留。

### exact-node 与 System execution findings 后的最终 owner repair 证据

- 最终 repair rebase 在 worktree 干净时完成，基于 `origin/main@fabd2a52f299418d69c22b3656079a487cdb5923`，无冲突。追加 repair commit 为 `854cc3da5`（生产 exact identity/domain attribution）、`2c5fad47e`（PostgreSQL 与 resolver 回归）、`6a0fc8907`（前一轮双语 repair 记录）和 `df3203beb`（typed-draft caller provenance 与 legacy source-version 精确兼容）；rebase 只因 Git 要求改变 commit id，没有重排、squash、drop 或 amend 既有链。
- 在 execution-label 修复前先新增真实 Red：`TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run test:server -- --run server/modules/parameters/serviceReviewWorkflow.integration.test.ts` 失败 1/29，因为 Agent high-risk merge 的 workflow trail 暴露为 `SRW Editor`，而不是 Agent tool/session 标签。Green 后为 29/29；`reviewDecisionExecutionLabel` 与 participant projection 现在优先可信 initiator，Agent 显示 `Agent tool:<toolCallId> (session:<sessionId>)`，accountable principal 仍是已校验 user。
- exact-node Red 仍记录在上方：旧 lateral compatible 查询在 safe parent + 缺失 critical child 的公开 cutover seam 上 resolve 并 staging（`ApiError expected rejection, promise resolved`）。Green 区分缺失 exact identity（`CONFLICT`、`parameter-sensitive-node-identity-mismatch`）与节点存在但 compatible 为 SQL NULL；只有显式 property-path 输入才可解析所属 node。不使用可变 current-version 或客户端 compatible fallback。
- rebase 后 Green：owned PostgreSQL 八文件 affected matrix 为 8 files / 118 tests；Agent/structured/JSON 精确回归为 4 files / 23 tests；完整 server 为 363 files / 2,801 tests，通过并有 1 个 skip。`npm run test:all` 通过：frontend 420 files / 3,137 tests，scripts 69 files / 948 passed、5 skipped，bridge 21 files / 138 tests，server 363 files / 2,801 passed、1 skipped。首次不带 `TEST_DATABASE_URL` 的 server 尝试在 global setup 使用未迁移默认数据库失败（`relation "project_parameter_values" does not exist`）；要求的 5433 端口重跑才是权威结果。
- 内部 Agent typed-draft caller 现在把原始 trusted invocation 传入 candidate/file-version/draft/rebase/governance projection。显式同 principal 的 Agent/System preflight 可以读取 legacy user-owned draft 以产生真实 sensitive refusal；owner mismatch 在任何 submission write 前由 service 拒绝。legacy structured submission 先从服务端文件解析 current version，再进入 exact compatible guard，保持 #613 行为且不接受客户端 version 数据。
- owner 授权的 nullable user-attribution 模型仍限定在五条 #614 路径及其直接消费者：System 行使用 null user id 和带约束的 service/job identity；User/Agent 行使用已校验 principal，同时保留 Agent execution label/metadata。不包含 synthetic user、公开 selector、frontend、无关 legacy ratchet、#615、TD-123、范围外 schema 或 Hosted CI 声明。#615 完成更广 TD-068 清理前，本计划继续保持 active。
- 本 checkpoint 记录有界 schema/domain 变化与生成的 `docs/generated/db-schema.md` 更新；不吸收 #615 legacy ratchet、不关闭 TD-068，也不触及 TD-123、frontend/public selector、HDC、硬件、live provider 或 Hosted CI。计划继续保持 active，直到 #615 完成更广义 TD。

## #614 后续 repair：执行身份约束与夹带 provenance

- 本轮从父审查的 `43549fd0976e40f0c73eb6a527d4310c1016d417` 链继续，并在 fetch 后无冲突 rebase 到 `origin/main@fabd2a52f299418d69c22b3656079a487cdb5923`。本轮修复剩余 Standards P1：User/Agent/System 领域身份双向约束、夹带 binding-revision provenance，以及 Agent draft 清理的精确 owner。既有 commits 保持追加式，不重写。
- 迁移 `0132_parameter_execution_identity_checks.sql` 以 `NOT VALID` 建立上述严格约束：可信 User/Agent 行必须携带已校验 principal 且不能携带 System 字段；System 行不能携带用户归属，并必须有非空 `service`/`job` 身份。PostgreSQL 仍会在所有新行和更新行上执行谓词，同时允许没有历史归属的 #614 前旧行安全升级。追加迁移 `0133_parameter_execution_identity_legacy_compatibility.sql` 重新声明同一严格谓词，不再打开可写的 legacy-null 逃逸口；`0134_parameter_execution_identity_discriminated_constraints.sql` 完成 User/Agent/System/legacy 的前向联合约束。不创建 synthetic user，也不借用 auth.user。生成 schema 文档现记录 132 个迁移及 `NOT VALID` 约束。
- `carryForwardBindingRevisions` 现在接收与 candidate/config revision 相同的 trusted domain attribution，并在复制行写入 initiator type、System 身份和 Agent correlation。Agent action 清理改为使用精确 trusted owner 投影，不再只传 principal `userId`，避免失败提交删除另一执行者的 draft。
- exact-node P1 的 Red 仍由真实 PostgreSQL cutover 测试给出：修复前缺失 exact child 被当成 compatible no-match，进入 staging，输出 `ApiError expected rejection, promise resolved`。更早的 System high/no-match Red 是敏感策略通过后 topology/merge 抛出 `This workflow requires an accountable user principal.`。Green 保持 System high/no-match 成功、critical Agent/System 403 与 durable refusal，并区分缺失 exact node 和持久化 `compatible IS NULL`。
- migration-upgrade Red 在 0132 前植入带历史 `user` 默认和空 creator 的 history 行；旧 0132 在 0133 之前直接失败（`check constraint "parameter_history_entries_execution_identity_check" ... is violated`）。Green 将 0132 改为严格 `NOT VALID`、0133 改为严格重申，并由 0134 完成联合约束：旧行可保留并完成升级，而同形的新 legacy-null insert 以 PostgreSQL `23514` 被拒绝。完整 server 随后通过 363 files / 2,805 tests、1 个 skip；当前 #614 affected PostgreSQL matrix 还包括此升级回归，以及 exact-node、cutover 第二位置、semantic/legacy/enablement writeback、merge notification、migration 与 Agent cleanup 覆盖。
- 领域语义保持：User/Agent 的 accountable 字段来自已校验 invocation principal；Agent execution label 保留 tool-call/session/approval；System 用户归属为 NULL，并可查询真实 service/job identity。success audit、领域行和 notification 使用同一 invocation 投影。audit 失败回滚可达数据库状态；若数据库失败前已写 immutable blob，只报告为不可达 orphan。计划继续 active，排除 #615、TD-123、frontend、HDC、硬件、live provider 与 Hosted CI。
- 在最后 fetch/rebase 前，固定代码 `fa40de204` 已通过 7 文件 / 114 测试的 focused PostgreSQL matrix、`npm run test:server`（363 files / 2,805 tests、1 skip）和 `npm run test:all`（frontend 420 / 3,137；scripts 69 / 948、5 skips；bridge 21 / 138；server 363 / 2,805、1 skip）。`npx tsc -b --pretty false`、build、contract、pgvector-backed 且实际执行 schema 检查的 `docs:check`、self-host、acceptance 与 `git diff --check` 均通过。lint 为 0 errors、301 个继承 frontend warnings。build 保留 5 个 browser-externalization warnings 和 1 个 large-chunk warning；测试 stderr 有 3 条既有 jsdom navigation 信息，scripts 有 `ps: process id too large: 999999999` informational 行。没有 frontend timeout。最后 fetch 观察到 `origin/main@d7be22aeee662ddcf9c807a3945db9a0deb672c3`；干净 rebase 与 rebase 后证据在下一 checkpoint 记录。GitHub Actions 月度额度耗尽，Hosted CI 未运行且不声称通过。

## #614 最终复审修复：迁移升级安全

- 针对 `fd2e1db73` 的两项固定 HEAD 复审 finding 已用追加方式修复：`24070ca23` 清理本分支新增 0130/0131 文件的 diff 空行，并将 0132/0133 身份约束改为 `NOT VALID`，同时加入真实 PostgreSQL 升级 Red/Green；`fa40de204` 增加非 TD-068 writer 所需的显式 `legacy` 标记，并让公开 trusted initiator projection 隐藏该内部状态。没有 amend、删除、重排或 squash 任何既有 commit。
- TDD Red 命令为 `TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run test:server -- --run server/modules/parameter-topology/migration.test.ts -t 'preserves legacy null rows'`，针对修复前 0132/0133 SQL。0131 后植入历史空 attribution 行再应用 0132 时，在到达 0133 之前真实失败：`check constraint "parameter_history_entries_execution_identity_check" of relation "parameter_history_entries" is violated by some row`。Green 后 0132/0133/0134 可完成升级：旧无投影行被标记为 `initiator_type = 'legacy'`，带 creator 的旧行保持 `user`，新的显式 `initiator_type = 'user'` + 空 creator 以 PostgreSQL `23514` 拒绝。
- 有界领域模型仍保持真实：#614 trusted User/Agent/System 写入只使用三个 branded initiator type，并受严格 principal/System metadata 约束。显式 `legacy` 是非 TD-068 旧 writer 的临时、可查询状态，由 #615 后续 ratchet 负责；它不能携带 System metadata。窄范围数据库 trigger 会把带非空 creator 的 legacy-default 行转成 `user`，保留旧 accountable-user 语义且不创建 synthetic principal。DTO mapper 隐藏内部 marker，不向 public actor selector 暴露不支持的值。
- migration upgrade 测试使用 owned temporary PostgreSQL 数据库，先 replay 到 0131，再应用 0132/0133/0134；验证升级成功、legacy marker 转换、creator-bearing User 保留、严格新行拒绝，并由既有 `try/finally` temporary-database helper 清理。生成的 `docs/generated/db-schema.md` 记录 `legacy` default 与 `NOT VALID` 约束。当前 repair focused slice 为 7 文件 / 114 测试，完整 server 为 363 files / 2,805 tests 并有 1 个 skip；最终固定 HEAD 门禁计数将在最后重跑后写入。
- 本修复不迁移 #615 legacy API/type ratchet、DTS reload #612、TD-123、frontend/public contract 或平台级 audit architecture；不声称 Hosted CI、HDC、硬件或 live-provider 证据。计划继续 active，直到 TD-068 后续 legacy cleanup 完成。

## #614 rebase 后最终固定 HEAD 证据

- 最后一次 fetch 观察到 `origin/main@d7be22aeee662ddcf9c807a3945db9a0deb672c3`。clean 分支已无冲突 rebase 到该提交；没有需要冲突处理的文件。rebase 后代码/证据 checkpoint 为 `1420f47a808fea9adb38edf803b7872581de83bc`（下一条仅记录该 checkpoint 的 docs-only commit，不改变生产行为）。分支 ahead 34、behind 0。
- rebase 后 TDD/Green 证据保持绿色：focused owned-PostgreSQL matrix（`sensitiveNode`、cutover、writeback provenance、post-cutover workflow、writeback service、review workflow、migration）为 7 files / 114 tests；`npm run test:server` 为 363 files / 2,805 tests、1 skip。`npm run test:all` 通过 frontend 420 files / 3,138 tests、scripts 69 files / 948 passed、5 skips、bridge 21 files / 138 tests、server 363 files / 2,805 passed、1 skip。
- rebase 后全部静态门禁通过：`npx tsc -b --pretty false`、`npm run build`、`npm run contract:check`、使用 pgvector 且实际执行 schema 检查的 `TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run docs:check`、`npm run lint`、`npm run selfhost:check`、`npm run acceptance:ci` 以及 `git diff --check origin/main...HEAD`。lint 为 0 errors、301 个继承 frontend warnings。build 报告既有 5 个 browser externalization warnings（`stream`、`http`、`url`、`https`、`zlib`）和既有 large-chunk warning。测试有 3 条既有 jsdom navigation informational 信息，scripts suite 有 `ps: process id too large: 999999999`。没有 frontend timeout。
- 最终复审修复继续使用有界 migration 模型：0132/0133 以及前向 0134 对 trusted User/Agent/System 行施加严格 `NOT VALID` 约束，同时用明确的无 metadata `legacy` 标记保留非 TD-068 旧 writer，待 #615 ratchet。migration-upgrade 测试证明旧行可升级、带 creator 的旧行仍是 User，新的显式 User+空归属以 `23514` 拒绝；DTO mapper 不向 public 暴露 `legacy` initiator。此处不宣称 TD-068 完成；GitHub Actions 月度额度耗尽，Hosted CI 仍不可用。

## #614 Standards P1 修复：有数据 binding-revision 升级

- 针对固定 HEAD `d7be22aeee...c312756ee` 的新一轮 Standards 复审发现两项：P1 是 migration 顺序缺陷——0120 在替换旧 User/Agent/System-only type check 之前就把有数据的 binding revision 回填为 `legacy`；P2 要求在只记录证据的 plan commit 之后，对 exact-final HEAD 再跑一次 pgvector-backed `docs:check`。两个轴没有其他 P0-P3 finding。
- TDD Red 在升级测试中加入真实的 `project_parameter_bindings` 与 0132 前 `project_parameter_binding_revisions`（历史 User 默认、空 attribution）后复现。旧 migration 在 backfill 处真实失败：`new row for relation "project_parameter_binding_revisions" violates check constraint "project_parameter_binding_revisions_initiator_type_check"`；这不是伪造断言，而是生产升级失败。
- Green 为 `409136b8871b785226e6893e7d577eb485aa0200`：0120 先替换 binding-revision type check 使其允许 `legacy`，再设置 default 并转换历史行。升级测试现在断言 binding revision 变成无 metadata 的 `legacy`、带 creator 的旧行仍是 User，新的显式 User+空归属仍以 `23514` 拒绝。focused 七文件矩阵 114/114 通过，完整 server 为 363 files / 2,805 tests、1 skip。
- `TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run docs:check` 已在修复代码 HEAD（plan 更新前）通过；本条最终 evidence-only plan commit 后又在 exact-final HEAD 重新运行并通过（`Documentation governance check passed`；`db-schema artifact is current`）。生成 schema 保持最新并记录 legacy marker 与 `NOT VALID` 约束。计划继续 active；排除 #615、TD-123、frontend、Hosted CI、HDC、硬件和 live-provider 证据。

## #614 最终固定 HEAD 修复续记（父级审查 findings）

本节记录固定 #614 HEAD 经父级审查后的修复。本计划继续保持 active：#615
仍负责 legacy ratchet 与更广义 TD-068 收口。

- 起点为 clean 的 feature HEAD `f29bf4956c76688b76467b01ba1b81e903a63b36`（review base `e9d29dc293c377e48a89f3f94e6e8bb8f45a9807`，fixed base `d7be22aeee662ddcf9c807a3945db9a0deb672c3`）。按要求 fetch 得到 `origin/main@246730efefb97336428618a20bbc809334bc6fce`；既有提交链无冲突 rebase 到 `793ac0b192c78104f02f9cc21ed92e2544c20833`，随后只追加 repair commit，没有 amend、删除、重排或 squash 旧提交。
- Green 前记录了四组真实 Red：0122 之前数据库约束接受缺失 Agent correlation；可信 System typed binding draft 借用了 `auth.user.id`；无 capability 的 critical Agent/System 只有普通 capability 拒绝且没有 durable human-required refusal；merge notification/public projection 暴露了原始 System/correlation 身份。Red 均来自 owned PostgreSQL 生产 seam 与公共 repository/notification 投影，不是人为制造的断言失败。
- 前向迁移 `0134_parameter_execution_identity_discriminated_constraints.sql` 是数据库边界：在 drafts、review decisions、history、values、file versions、file candidates、config revisions、submission rounds、change requests、binding revisions 上重建完整 User/Agent/System/legacy 判别联合。旧行使用 `NOT VALID` 保留，但每个新建/更新行都会执行约束。User 和仍有 live principal 的 Agent 需要 user 列；Agent 要求非空 session/tool-call/approval；System 要求 `service|job` 与非空 name，user/correlation 必须为空；legacy 必须完全无 metadata。后续迁移 `0135_parameter_execution_principal_tombstones.sql` 为永久删除用户后的保留 Agent 行增加不透明、按 Organization 约束的 principal tombstone，使其仍保持 Agent 和完整 correlation，不伪造用户。窄 trigger 只把带 creator 的历史 legacy-default 行保留为 User，只有嵌套账户删除转换才能创建 tombstone-backed Agent；不会把 malformed 的显式 User/Agent/System 行改成 legacy。#615 负责最终 legacy 回填与验证 ratchet。
- trusted sensitive resolver 现在把 compatible-only 规则绑定到服务端解析的 exact file/version 与完整 node locator，并同时约束 Organization、project、file name、file version、node identity。exact node 缺失返回稳定 `409 parameter-sensitive-node-identity-mismatch`；节点存在但 `compatible IS NULL` 仍是合法 no-match。只有显式 `property-path` 才能解析所属 node；不明确的 trusted caller 采用更严格的 `node-locator` 语义。没有 mutable current/head/client-compatible fallback。
- 按 Issue #614，System high/no-match 保持成功。System 的 nullable domain user attribution 为 NULL，service/job kind 单独持久化。User 与 Agent 的 accountable 字段来自 trusted invocation principal；Agent 仍保持 Agent initiator 与内部 correlation。candidate/file-version/config-revision/draft/history/value/review/binding、audit、workflow participant、notification 都从同一个 invocation 派生。公共 DTO 保持原有 lifecycle 字段，不返回 session/tool-call/approval 或原始 System name；通知与 workflow participant 使用 `WiseEff Agent` 或 `WiseEff System service|job` 粗粒度 label，完整 correlation 仅留在内部领域/审计证据。
- critical sensitive refusal 在 exact identity/rule matching 之后、capability 检查及任何领域/对象写入之前执行。具备或不具备 capability 的 Agent/System 都得到 `403 parameter-sensitive-node-human-required`、`requireHuman: true` 与 root-owned durable refusal；无 capability 的 User 保持原 missing-capability 错误且不写 human-required refusal。拒绝证据可跨外层事务 rollback 保留。success audit 与领域行同一数据库事务；注入 audit failure 会回滚。若数据库错误前已 put immutable blob，只报告为无可达引用的 orphan，不宣称跨存储原子回滚。
- owned PostgreSQL Green 矩阵覆盖 topology enablement、property-key cutover（critical 第二 location）、semantic writeback、retained legacy writeback、enablement writeback 与 software merge，覆盖 User/Agent/System、missing/malformed/empty trace/伪 sink/cross-user/cross-Organization、locked/current compatible 分叉、missing exact child、持久化 `compatible NULL`、safe locked/critical current 反向场景、notification projection、refusal 持久化与 audit rollback。修复后的 focused 验证在文档更新前为 15 files / 216 tests；最终精确计数与静态门禁将在交付记录中列明。
- 本轮同时删除未使用的 accountable-user helper，并以 `TrustedInvocationDomainAttributionRow` / `trustedDomainAttributionFromRow` 集中内部 row attribution shape；公共 projection 独立维护。当前 generated schema 已更新至 0135，并记录 tombstone-backed Agent projection。本修复不修改原始 dirty worktree、公共 actor selector、frontend、#615、TD-123、DTS reload、HDC、硬件、live-provider 或 Hosted CI。GitHub Actions 配额耗尽，不声称 Hosted 结果。

### 最终 rebase blocker，已由 owner 授权重编号解决（历史记录，2026-08-28）

- 最终 fetch 得到 `origin/main@551eec66c9ffacca668ba8c579857dddadf71e5d`。干净分支完成 rebase，没有生产语义冲突（仅合并 generated-schema 头部及一个无关 notification helper），最终为 `ebfbb2d61574f4dbeea58748655661ada04ef714`，`ahead 41 / behind 0`。
- 该 main 提交新增 `server/migrations/0116_node_write_observation_outcomes.sql`，而既有 branch-only #614 历史保留 `0116_parameter_execution_provenance.sql`。rebase 后真实 migration 编号测试因前缀 `0116` 重复失败（1 failed / 3 passed）；失败与 `src/**` 无关且可稳定复现。
- owner 随后确认七个 #614 identity migration 仅存在于本分支，没有 PR 或共享/生产应用证据，并授权仅对这七个文件追加式重编号。唯一性不变量和 origin/main migration 均不变；七个文件现在接在主线 0127 之后成为 0128–0134。没有 checksum alias，也没有重写共享数据库历史。

### 最终复审修复检查点（2026-08-28）

- Standards 独立复审另发现一个 P3：未使用的 `trustedExecutionLabel` 会暴露 Agent correlation 和 System name，并绕过粗粒度公共 projection 边界。已在 `b0eb24b3c0c0fa4f0335a78fc07d4287e646402d` 以追加 commit 删除该 helper 及专属测试；公共执行标签只保留 `trustedPublicExecutionLabel`。
- 在固定 HEAD `b0eb24b3c0c0fa4f0335a78fc07d4287e646402d` 上，受影响 PostgreSQL focused 矩阵为 15 files / 216 tests 通过，trusted invocation 切片为 1 file / 9 tests 通过，`npx tsc -b --pretty false` 通过，`git diff --check` 通过。直接运行完整 `npm run test:server` 为 363 files / 2,829 tests 通过，唯一失败为 migration 编号不变量（1 test）：两个 0116 文件同时存在。
- 在该固定 HEAD 上重新执行的独立 Standards 与 Spec 复审均为 P0=0、P1=1（同一 0116 冲突）、P2=0、P3=0；未复用此前的 zero-finding 结论。分支仍等待 owner 协调 applied migration history；#615、TD-123、frontend、HDC、硬件、live-provider 与 Hosted CI 继续排除。

## #614 最终迁移编号修复（2026-08-29）

- 修复从 `115051b7a6b4383d933cdf011bb0f5e8370fb240` 开始。按要求首次 fetch 得到 `origin/main@61bc01f74d29cfb7bc6c750bfa60f3519045fb96`；主线最高迁移前缀为 `0127`。分支已无冲突 clean rebase 到该提交，rebase 后代码检查点为 `c87c9b332e8906b8c5ab803231de6ad424cae02e`。原有九个 #614 commit 未 amend、删除、重排、squash 或 force-push。
- `origin/main` 不包含 `0116_parameter_execution_provenance.sql`、`0117_parameter_system_user_attribution_guard.sql`、`0118_parameter_governance_execution_identity.sql`、`0119_parameter_draft_enablement_owner_index.sql`、`0120_parameter_execution_identity_checks.sql`、`0121_parameter_execution_identity_legacy_compatibility.sql` 或 `0122_parameter_execution_identity_discriminated_constraints.sql`。`gh pr list --head codex/td-068-parameter-governance-provenance` 返回 `[]`；没有修改或使用共享/生产数据库迁移历史。owner 已授权的 branch-only 修复只重命名这七个文件，不添加 alias 或重写 checksum。
- 重编号前真实 TDD Red：`TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run test:server -- server/shared/database/migrations.test.ts --run` 失败 `2/9`（`0116` 重复前缀，以及 continuation 仍引用旧分支文件名；`7/9` 通过）。内容保持不变重命名后，同一不变量通过 `9/9`。每个 SQL 文件重命名前后的 SHA-256 完全一致。
- 有序映射为：`0116→0128_parameter_execution_provenance.sql`、`0117→0129_parameter_system_user_attribution_guard.sql`、`0118→0130_parameter_governance_execution_identity.sql`、`0119→0131_parameter_draft_enablement_owner_index.sql`、`0120→0132_parameter_execution_identity_checks.sql`、`0121→0133_parameter_execution_identity_legacy_compatibility.sql`、`0122→0134_parameter_execution_identity_discriminated_constraints.sql`。追加迁移 `0135_parameter_execution_principal_tombstones.sql` 负责保留 Agent principal。拓扑迁移升级通过 `27/27`；在全新 owned PostgreSQL 上使用正式 `npm run db:schema-doc` 生成 133 个迁移至 `0135`，`docs/generated/db-schema.md` 无生成漂移。
- `0134` 中严格 User/Agent/System/legacy 约束保持不变，0135 增加按 Organization 约束的 tombstone FK 与删除 trigger。嵌套 FK 删除适配器只把 live Agent 的 PostgreSQL `SET NULL` 账户删除转换变成 tombstone-backed Agent；User 删除仍变成明确的无 metadata `legacy`，直接应用更新仍拒绝。repository 公共 mapper 保持既有 null/“已注销用户”展示合同。全新 owned PostgreSQL 回归在本次 tombstone 修复前通过 15-file / 182-test 与 20-file / 261-test 切片；本次新增用户删除矩阵通过 `5/5`，migration-upgrade 通过 `27/27`。
- 本检查点未修改 origin/main 迁移、公开 actor selector、frontend、#615 legacy ratchet、TD-123、HDC、硬件、live-provider 或 Hosted CI。计划继续保持 active，等待 #615 完成更广 TD-068 收口；最终 fetch/race、完整本地门禁与双轴复审只在固定最终 HEAD 上追加记录。

## #614 最终复审修复：账户删除后的 Agent 溯源保留

- 固定 HEAD 的新一轮独立 Spec 复审发现 P1：0134 删除适配器把所有被删除的可问责用户都转换成 `legacy`，因此保留的 Agent 行在 live user 外键置空后违反严格 Agent 约束。Standards 还发现迁移注释仍描述重编号前的历史。没有修改 `origin/main` 迁移，也没有重写既有提交。
- TDD Red 通过 owned temporary PostgreSQL 的公开 `deleteUser` seam：带完整 session/tool-call/approval correlation 的 Agent history 行在嵌套外键更新时以 `23514 ... parameter_history_entries_execution_identity_check` 失败；candidate、config revision、submission round、change request、review decision、value、file-version 也得到同样生产约束失败。这不是人为制造的断言失败。
- Green 是迁移 `0135_parameter_execution_principal_tombstones.sql`：创建按 Organization 约束的不透明 principal tombstone，为九个带用户字段的 #614 表增加内部 `initiator_principal_user_id` 快照，并替换删除 trigger，使只有服务端生成的嵌套 `SET NULL` 转换才能创建 tombstone-backed Agent 行。判别约束允许 live Agent user 或 tombstone snapshot 二选一，要求完整且非空的 Agent correlation，并保持 User/System/legacy metadata 互斥。普通客户端/应用更新不能凭空使用 tombstone，仍受严格联合约束和 scoped FK 保护。
- 内部 row attribution 会为已删除 Agent 的历史投影解析不透明 principal snapshot，但 nullable user-owned 字段仍为 NULL。System 仍是 NULL-user 加明确 service/job identity；不创建 synthetic user、不使用特殊 UUID/空字符串、不回填 `auth.user`。公共 DTO 和通知仍只显示 `WiseEff Agent` / `WiseEff System service|job` 粗粒度标签，从不返回 tombstone、session、tool-call、approval 或内部 System name。
- Owned PostgreSQL Green：用户删除集成测试 `5/5`（含八种保留 Agent 行及 tombstone 查询），migration upgrade `27/27`，trusted attribution 单元测试通过。generated schema 当前为 133 个迁移至 0135。计划保持 active，继续排除 #615、TD-123、frontend、HDC、硬件、live-provider 与 Hosted CI。

## #614 最终迁移竞争修复（2026-08-29）

- 在前一轮修复后，最后一次 `git fetch --prune origin main` 观察到 `origin/main@425c041074af0787a14cadee99ca59605b05432c`，主线新增迁移 `0128_repair_driver_placement_subject_cutover.sql`。干净 feature 分支已 rebase 到该提交；只有生成 schema 头部发生冲突，并在最终迁移目录上重新生成。没有重写、重排、squash、删除既有提交，也没有生产 SQL 冲突。
- 由于七个 #614 identity migration 与 0135 tombstone 修复均只存在于本分支，owner 授权在主线新 0128 之后再次进行一次保持内容不变的整体重编号。最终有序文件为 `0129_parameter_execution_provenance.sql`、`0130_parameter_system_user_attribution_guard.sql`、`0131_parameter_governance_execution_identity.sql`、`0132_parameter_draft_enablement_owner_index.sql`、`0133_parameter_execution_identity_checks.sql`、`0134_parameter_execution_identity_legacy_compatibility.sql`、`0135_parameter_execution_identity_discriminated_constraints.sql`、`0136_parameter_execution_principal_tombstones.sql`。主线 0116–0128 完全未修改；没有 alias 或 checksum 重写。
- 重编号前 migration invariant 是真实 Red：分支 0128 与主线 0128 冲突，仓库测试无法接受重复前缀；旧共享数据库在缺少旧分支文件时也按设计拒绝继续（该数据库不作为 Green 证据）。重编号后，在全新 owned PostgreSQL 上唯一前缀不变量通过，完整迁移可应用至 0136；upgrade seam 更新为先 replay 至 0132，再应用严格的 0133–0136 链。
- 最终重命名后，使用 owned pgvector PostgreSQL 正式运行 `npm run db:schema-doc`。`docs/generated/db-schema.md` 现记录实际 134 个迁移至 `0136_parameter_execution_principal_tombstones.sql`；没有手工伪造 schema artifact，也没有修改共享 `schema_migrations` 历史。计划继续保持 active，并继续排除 #615、TD-123、frontend、HDC、硬件、live-provider 与 Hosted CI 证据。
