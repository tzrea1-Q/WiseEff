# 小泽审批链:单一接缝、状态入库、请求级上下文

> 状态:**已完成**(2026-08-12 经 PR #319 合并)
> 日期:2026-08-12
> 分支:`fix/xiaoze-approval-chain-single-seam`
> English: [`docs/exec-plans/completed/2026-08-12-xiaoze-approval-chain-single-seam.md`](../../../exec-plans/completed/2026-08-12-xiaoze-approval-chain-single-seam.md)

## 目标

把重复构造的小泽审批桥收拢为 orchestrator 自有的 **Agent 审批链**(`beginApproval` / `resolveApproval`),其唯一状态载体是 `agent_tool_calls` + `agent_approvals` 数据行;请求级 `{auth, requestId, sessionId, projectId}` 与运行事件 sink 改经 LangGraph `config.configurable` 随每次调用传递,不再驻留进程级可变槽。

本计划修复两处已上线缺陷:

1. **批准时的 `editedArgs` 被静默丢弃。** `registerXiaozeRoutes` 给端点造了一个桥(`agUiEndpoint.ts:1046`,`begin` 写它的内存 `pendingToolCalls`),`createXiaozeAgentFactory` 给图另造了一个(`agUiEndpoint.ts:963`,`resume` 读的是这份永远为空的 map),导致"修改参数后批准"实际执行原始载荷——违背 SPIKE-P1 的"全量替换"契约。前端确实会发送 `editedArgs`(`src/features/agent/xiaozeResumeBridge.ts`)。
2. **并发请求互相覆盖执行上下文。** 规划代理是注册期单例;`executionContextRef`(`agUiEndpoint.ts:964`)与 `activeSink`(`planningGraph.ts:170`)是进程级单槽,重叠请求可能以对方的 auth 执行工具、把事件写进对方的 sink。

附带加固:`Command({resume})` 载荷不再携带完整 `AuthContext`(现状在 `XIAOZE_CHECKPOINTER=postgres` 时会被序列化进 checkpoint 待写记录)。

## 非目标

- resume 分支的步骤时间线流式(批准回合仍只回文本;记为 **TD-070**)。
- 回合流收拢、工具单一定义、共享线协议包、审批接缝以外的死代码清理(属架构审查其他候选)。
- 小泽路径的 metrics/tracing 接线变更(桥从未接线;维持不变)。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在 `fix/xiaoze-approval-chain-single-seam` 上提交;不开、不合 GitHub PR |
| 父代理 | 评审、跑验证、开/合 PR,然后同步本地 `main` |

分支:`fix/xiaoze-approval-chain-single-seam`,自最新 `main` 检出。

## 设计决定(2026-08-12 敲定)

- **D1 状态位置:**`resolveApproval` 经 `getAgentApproval` 从 `agent_approvals` 查回 `toolCallId`;删除内存 `pendingToolCalls`。这是正确性要求:生产/自托管使用 `XIAOZE_CHECKPOINTER=postgres`,begin 与 resume 本就可能落在不同进程。
- **D2 接缝位置:**`beginApproval` 留在 AG-UI 端点(图返回 interrupt 之后),`resolveApproval` 留在 `actNode`;两者打同一个 orchestrator 接口。否决"begin 进节点":LangGraph 恢复时会重跑节点体,会给接口强加隐藏的幂等要求。
- **D3 上下文通道:**请求上下文与 sink 经 `config.configurable` 随每次 `graph.invoke` 传入。已对照 `@langchain/langgraph@1.4.5` 核实:checkpoint 元数据仅 `{source, step, parents}`,`configurable` 不会被序列化。auth 绝不进图状态(会被 checkpoint)也不进 resume 载荷(会作为待写记录持久化)。
- **D4 模块形状:**删除 `approvalBridge.ts`;orchestrator 长出 `beginApproval`(会话兜底 + 记录工具请求 + 取回审批 id)与 `resolveApproval`(拒绝 → `rejectToolCall`;批准 → 可选载荷替换 → `approveToolCall`,使批准时重鉴权覆盖改后载荷)。`recordToolRequestForTest` 更名 `recordToolRequest` 并保持导出,作为一等入口(只读工具立即执行;变更工具开启审批链)——它在生产路径上,测试经它播种也是正当接缝。
- **D5 命名:**`CONTEXT.md` 术语表收录 **Agent approval chain(Agent 审批链)**;ADR-0024 记录"审批状态以数据库为载体;请求上下文经调用配置传递,不驻留模块状态"。

## 任务

1. `server/modules/agent/orchestrator.ts`:更名 `recordToolRequestForTest` → `recordToolRequest`;新增 `beginApproval` / `resolveApproval`(类型 `ApprovalBeginInput/Result`、`ApprovalResolveInput/Result`);`editedArgs` 在 `approveToolCall` 重鉴权执行之前经 `updateAgentToolCall` 全量替换载荷。
2. 删除 `server/modules/agent/xiaoze/approvalBridge.ts` 与 `approvalBridge.test.ts`(行为并入 orchestrator 测试)。
3. `server/modules/agent/xiaoze/planningGraph.ts`:`PlanningResumeDecision` 去掉 `auth`/`requestId`;节点签名 `(state, config)`;`actNode` 从 `config.configurable` 读请求上下文并调 `resolveApproval`;删除 `activeSink` 槽(sink 走 config;`run()` 直接用 `input.sink` 取 `runSteps`);run 输入新增 `requestContext`。
4. `server/modules/agent/xiaoze/agUiEndpoint.ts`:工厂删除 `executionContextRef`(上下文随每次 `run` 传递);`registerXiaozeRoutes` 构造**一个**工具注册表与**一个** orchestrator,由工厂、处理器(`approvalChain.beginApproval`)与 suggest 路由共享;处理器 resume 输入最小化为 `{approvalId, decision, editedArgs, reason}`。
5. 测试:
   - 把 `orchestrator.test.ts` 的 SQL 分发内存库提取到 `server/modules/agent/testing/memoryAgentDb.ts`,扩展支持工具调用载荷更新与线程持久化语句。
   - **装配级回归**(`registerXiaozeRoutes` 接缝,真实路由器 + 确定性模型 + mock parameters 模块):第一次 POST → interrupt,第二次 POST 携 `editedArgs` resume → 断言执行载荷与落库的 `agent_tool_calls.payload` 均为改后值。
   - **并发**:同一工厂两个不同 auth 的交错 run;各自工具调用以各自 auth 执行、事件写进各自 sink。
   - **双实例**:实例 A `beginApproval`、实例 B 携 `editedArgs` `resolveApproval`,共享同一库——把多副本主张编码成测试。
   - 按新形状更新 `planningGraph*.test.ts`、`agUiEndpoint.test.ts`、`eval/*`(场景 resume 形状 + `requestContext`)、`durableCheckpointer.integration.test.ts`。
6. 验收:`e2e/acceptance/xiaoze-action.acceptance.spec.ts` 批准流程增加 `editedArgs` 用例,断言产生的变更请求携带改后值;`docs/developer/browser-acceptance-coverage-map.md` 与 `docs/developer/user-operation-coverage-matrix.md` 增列 `XIAOZE-ACTION-EDITEDARGS-001`。
7. 文档:ADR-0024;`CONTEXT.md` 术语 + ADR 索引(补列 0012/0020/0021);`ARCHITECTURE.md` 审批段 + `docs/zh-CN/root/ARCHITECTURE.md`;`docs/SECURITY.md` 小泽 P1/P2 措辞(+ 中文伴页,如在清单内);`docs/PLANS.md` + `docs/zh-CN/PLANS.md` 活动计划条目;`docs/exec-plans/tech-debt-tracker.md` 记 TD-070。
8. 验证(见下),然后把本计划移入 `completed/`。

## 成功标准

- 携 `editedArgs` 批准执行的是改后载荷——在装配接缝、双 orchestrator 实例接缝、以及活 API 验收三处证明。
- 两个不同 auth 的并发 run 各自以自己的 auth 执行工具。
- `rg -n "pendingToolCalls|executionContextRef|activeSink|recordToolRequestForTest" server/ src/` 无结果。
- resume `Command` 载荷不含 `AuthContext`。
- `npm run test:server`(agent 模块)、`npm run build`、`npm run docs:check` 全绿。

## 验证命令

```bash
npx vitest run server/modules/agent --config vitest.server.config.ts
npm run build
npm run docs:check
# 具备活 DB + API 时(验收证据):
npx playwright test e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

## 验证结果(2026-08-12)

- `npx vitest run server/modules/agent --config vitest.server.config.ts`:干净分支 worktree 中 33 个测试文件全绿(含装配级 editedArgs 回归、并发隔离、双 orchestrator 多副本测试)。存在 `DATABASE_URL` 时,活 postgres checkpointer 持久化集成测试也真实运行并通过(新 resolver 路径上的跨实例 resume)。
- `npm run build` 与 `npm run docs:check`:干净分支 worktree 中全绿(共享开发工作区还载有无关的并行 WIP,自带类型错误与文档草稿破链;故以干净树为准验证)。
- 活 API 证据(隔离库 `wiseeff_acceptance_xiaoze`、确定性模型、端口 8799):第一次 POST 正常产生 interrupt;携 `editedArgs targetValue=3600` 的 resume **落库了编辑后的载荷**(`agent_tool_calls.payload → 3600`;修复前执行的是原始载荷),审批行 `approved`,审计 `approval-requested` + `approval-execution-failed`(`actor_type=agent`)。
- 工具执行本身失败:"Legacy parameter submission is retired after semantic identity cutover"——`action.submitParameterChange` 仍在提交已退役的扁平形状,语义切换以来任何被批准的小泽写入都会在执行阶段失败;主干既有缺陷,记为 **TD-078**(超出本计划范围;单元测试 mock 了 parameters 服务所以从未暴露)。
- `xiaoze-action.acceptance.spec.ts` 无法在切换后 schema 上运行(其 `beforeAll` 过滤已删除的 `project_parameter_value_id` 列)——与 TD-078 同源漂移;新用例 `XIAOZE-ACTION-EDITEDARGS-001` 沿用文件模式但不引用退役列,待 spec 漂移修复后即可激活。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md` 模块清单——模块集合不变;审批措辞见"架构"行 |
| 计划 | Update | 本计划;`docs/PLANS.md` + `docs/zh-CN/PLANS.md`;中文伴页 |
| 领域 / ADR | Update | `CONTEXT.md`(Agent 审批链术语、ADR 索引补列);新增 `docs/adr/0024-agent-approval-state-is-db-backed.md` |
| 产品规格 | No change | 规格所述审批 UX 与产品行为不变(修复后编辑值真正生效,与规格契约一致) |
| 架构 | Update | `ARCHITECTURE.md`(审批链命名、无单例上下文槽)+ `docs/zh-CN/root/ARCHITECTURE.md` |
| 质量 / 测试 | Update | `docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md`(`XIAOZE-ACTION-EDITEDARGS-001`) |
| 可靠性 / 运行手册 | Review | `docs/runbooks/agent-provider.md`——提供方配置不变;预期"无变更"并留证据 |
| 安全 / 治理 | Update | `docs/SECURITY.md` 小泽 P1/P2(begin/resolve 命名;resume 载荷不含 AuthContext)+ 中文伴页(如在清单内) |
| 前端 / 设计文档 | Review | `docs/FRONTEND.md`——客户端 resume 契约(`forwardedProps.command` / `resume[]`)不变;预期"无变更"并留证据 |
| 生成产物 | Review | OpenAPI / 路由清单——无路由或 schema 变更;预期"无变更" |
| 参考资料 | No change | `docs/references/` 无审批链笔记 |

## 文档更新门禁

- [x] ADR-0024 已提交(`docs/adr/0024-agent-approval-state-is-db-backed.md`)并从 `CONTEXT.md` 与 `docs/adr/README.md` 链接(并行工作占用 0022/0023 后由草案的 0022 改号)
- [x] `CONTEXT.md` 术语表载明 Agent 审批链;ADR 索引补列 0012/0020/0021 并列出 0024
- [x] `ARCHITECTURE.md` 描述 begin/resolve 与状态入库;中文证据:`docs/zh-CN/root/ARCHITECTURE.md` 为精简地图、本无审批链语句(无陈旧文本),中文细节在已更新的 `docs/zh-CN/design-docs/full-stack-architecture.md`
- [x] `docs/SECURITY.md` 与 `docs/zh-CN/SECURITY.md` 已更新 begin/resolve 与 resume 载荷加固(Xiaoze P1/P2)
- [x] 覆盖矩阵与操作矩阵列出 `XIAOZE-ACTION-EDITEDARGS-001`;验收用例已更新(执行被既有 spec/工具漂移阻塞——TD-078)
- [x] TD-070 已记录(resume 分支绕过步骤 sink);TD-078 已记录(活体验证发现的退役形状工具提交)
- [x] `docs/PLANS.md` 中英文列出本计划
- [x] 干净分支 worktree 中 `npm run docs:check` 全绿(2026-08-12);PR 评审后移入 `completed/`
