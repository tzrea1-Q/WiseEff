# 小泽审批执行失败恢复（TD-102 / TD-094）

> 状态：**进行中**
> 日期：2026-08-17
> 跟踪：**TD-102**、**TD-094**
> 分支：`fix/td102-approval-execution-dead-end`
> English: [`docs/exec-plans/active/2026-08-17-xiaoze-approval-failure-recovery.md`](../../../exec-plans/active/2026-08-17-xiaoze-approval-failure-recovery.md)

## 目标

人类批准小泽变更工具后，若执行失败（工作版本陈旧、overlay 目标无法解析等），聊天必须仍可使用：

- 图以中文 assistant `text` **停住**（前缀 `操作未能完成` + 映射后的原因）。
- `actNode` **不得再抛出**。像拒绝路径一样清掉 `pendingMutatingCall` / `interrupt`，使同一线程后续不带 `resume` 的 `run` 不再是 LangGraph pending interrupt。
- AG-UI 端点必须 **落库** 该 assistant 文本（`finalize` + persist + `complete()`），而不是 `stream.fail` / 英文 `RUN_ERROR`。
- 「新对话」（以及切换其他线程）必须清掉共享 default HttpAgent 上的 CopilotKit `pendingInterrupts`。仅 `setMessages([])` 不够。
- **批准成功**时停止在 `approveToolCall` 里 `appendAgentMessage`。可见回复由 `persistTurn` 拥有（TD-094）。

## 非目标

- 新的 i18n 框架。用服务端小助手映射 `ApiError` 码/原因；禁止 `server/` 引用 `src/`。
- 改动既有 AG-UI `FORBIDDEN` 路径，除非落在同一 catch。
- 改拒绝路径的双写，除非同一次编辑自然带出并有测试。
- 用脆弱浏览器夹具冒充 `XIAOZE-APPROVAL-EXEC-FAIL-001` 全绿。图与端点测试是本切片阻断门禁；浏览器 ID 用诚实的 `@acceptance-planned` 桩且 `required: false`。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在 `fix/td102-approval-execution-dead-end` 上提交；不开、不合 GitHub PR |
| 父代理 | 评审、跑验证、开/合 PR，然后同步本地 `main` |

分支：`fix/td102-approval-execution-dead-end`，从最新 `origin/main` 在隔离 worktree 检出。不要快进本地 `main`。

## 架构

执行失败是一次 **halted turn**，不是流错误。orchestrator 仍把工具标为 `failed` 并审计 `approval-execution-failed`，然后抛给图去接住。成功批准的可见回复由 `persistTurn`（observe 节点文本）拥有，而不是 `approveToolCall` 写入的 `agent-msg-*`。

## 任务

- [x] 批次 1：`actNode` 接住非 FORBIDDEN 的 `resolveApproval` 失败，发出中文 halt 文本，清 interrupt，checkpoint 可在无 `resume` 时继续。
- [x] 批次 1：`agUiEndpoint` 对本案 persist + `complete()`，不发 `RUN_ERROR`。
- [x] 批次 1：「新对话」/切线程经 `clearXiaozeAgentPendingTurn` 清掉 `HttpAgent.pendingInterrupts`。
- [x] 批次 2：`approveToolCall` 成功时不再 `appendAgentMessage`；`resolveApproval` 读工具摘要；更新 `orchestrator.test.ts`。
- [x] 登记 `XIAOZE-APPROVAL-EXEC-FAIL-001` 为 `required: false` + `@acceptance-planned` 桩。
- [x] 更新 TD-102 / TD-094 追踪行（英文 Open 表 + 中文进行中/近期关闭）。
- [x] 父代理：在 `docs/PLANS.md` / `docs/zh-CN/PLANS.md` 增加 Current Active 条目。

## UI 交互自动化审查

受影响 spec：`e2e/acceptance/xiaoze-action.acceptance.spec.ts`。

| ID | 行为 | 自动化 |
| --- | --- | --- |
| `XIAOZE-APPROVAL-EXEC-FAIL-001` | 批准后工具执行失败时，聊天出现中文 assistant 气泡（`操作未能完成` + 原因），线程仍可用，「新对话」不被 pending interrupt 卡住。 | 诚实 `@acceptance-planned` / `@operation-planned` 桩，`required: false`，coverage `future`。阻断证明是图与 AG-UI 装配测试。真浏览器路径需要陈旧工作版本 / overlay 夹具，本切片过脆。 |

## 验证

```bash
npx vitest run server/modules/agent/xiaoze/planningGraph.test.ts server/modules/agent/orchestrator.test.ts server/modules/agent/xiaoze/agUiEndpoint.test.ts server/modules/agent/xiaoze/agUiEndpoint.assembly.test.ts --config vitest.server.config.ts
npx vitest run src/features/agent/xiaozeHttpAgent.test.ts src/features/agent/XiaozeThreadController.test.tsx
npx tsc -b
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
```

除非成本很低，否则不跑完整浏览器验收。

## 成功标准

- 批准后执行失败：中文聊天气泡、interrupt 已清、同一线程后续消息不是 LangGraph pending-interrupt、AG-UI `RUN_FINISHED` 成功且 assistant 文本已落库。
- 「新对话」/切线程：`HttpAgent.pendingInterrupts` 为空，下一条用户消息不被 CopilotKit pending-interrupt 检查拦住。
- 批准成功：只有 `persistTurn` 的一条可见 assistant，没有重复的 `agent-msg-*` 摘要。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | 无变更 | `AGENTS.md`、`ARCHITECTURE.md` — 审批链接缝未改 |
| 计划 | 更新 | 本计划 + 英文对应。`docs/PLANS.md` / `docs/zh-CN/PLANS.md` Current Active 条目。 |
| 产品规格 | 无变更 | 失败文案是恢复 UX，不是新工作流 |
| 领域术语 | 无变更 | Agent 审批链已有文档 |
| 设计文档 | 无变更 | 无 API/schema 变更 |
| API | 无变更 | 同一 AG-UI 信封；恢复回合走既有成功帧 |
| 前端 | 复查 | `docs/FRONTEND.md` — 线程切换已有文档；interrupt 重置是 `XiaozeHttpAgent` 实现细节 |
| 安全 | 无变更 | 批准时的 authz/审计不变（仍写 `approval-execution-failed`） |
| 可靠性 / 运维手册 | 无变更 | |
| 开发环境 | 无变更 | |
| 质量 / 验收 | 更新 | 覆盖图与操作矩阵中英；`requirements.ts`；`operationMatrix.ts`；`xiaoze-action.acceptance.spec.ts` 中的计划桩 |
| 生成产物 | 无变更 | 无迁移 |
| 参考资料 | 无变更 | |
| 技术债 | 更新 | `docs/exec-plans/tech-debt-tracker.md` 及其中文对应：关闭 TD-102 与 TD-094 |

## 文档更新门禁

- [x] 覆盖图与操作矩阵中英登记 `XIAOZE-APPROVAL-EXEC-FAIL-001`。
- [x] TD-102 与 TD-094 在两份追踪文件中更新。
- [x] 本计划与英文对应包含影响矩阵、更新门禁、Git 与 PR 工作流、UI 自动化审查。
- [x] `docs/PLANS.md` Current Active 条目。
- [x] 合并前 `npm run docs:check` 为绿。
- [ ] 父代理合并后把本计划移入 `completed/`。
