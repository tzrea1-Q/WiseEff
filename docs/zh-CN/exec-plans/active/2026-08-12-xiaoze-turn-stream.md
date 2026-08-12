# 小泽回合流:一个模块拥有"已经流出了什么"

> 状态:**进行中**
> 日期:2026-08-12
> 分支:`refactor/xiaoze-turn-stream`
> English: [`docs/exec-plans/active/2026-08-12-xiaoze-turn-stream.md`](../../../exec-plans/active/2026-08-12-xiaoze-turn-stream.md)
> 来源:2026-08-12 架构审查候选 2(Strong)

## 目标

把小泽回合流式管线深化为一个模块 `xiaozeTurnStream.ts`,接口是同步 reducer:`open() / ingest(sink事件) / interrupt(审批开始) / finalize(运行结果) / forbidden(消息) / fail(错误)`,各自返回 AG-UI 帧。现状:一条助手回复穿 14 个文件;"已流出文本"存在三个互不知情的镜像(`TurnStreamFlags`、`XiaozeTurnStateTracker`、classifier 的记账),由 `finalizeTurnReply` 用 90% 相似度容差事后和解;`agUiEndpoint.ts` 藏着 23 处内联帧字面量和两段重复的 FORBIDDEN 回复块。改后模块持有唯一一份流式进度,端点缩回传输职责(认证、解析、泵送、持久化、SSE),所有帧都由模块产出。

## 非目标

- 线协议变更:CUSTOM 事件名与载荷形状(`xiaoze_turn_state`、`xiaoze_turn_reply`、`xiaoze_run_timing`、`xiaoze_prompt_debug`、`on_interrupt`)不变;前端零改动。
- 移除 90% resync 容差(保留为内部实现细节;改它是独立的行为决定)。
- 触碰模型侧分类(`reasoningClassifier` 流路由、`splitAssistantContent`)——它们保留属性测试接缝,不被吞并。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在 `refactor/xiaoze-turn-stream` 上提交;不开、不合 GitHub PR |
| 父代理 | 评审、跑验证、开/合 PR,然后同步本地 `main` |

## 设计决定(2026-08-12 敲定)

- **D1 接口:**同步 reducer、无 IO。泵送(`pumpAgentRun`)留在端点;`beginApproval`(IO)留在端点,模块只渲染其结果。
- **D2 边界:**模块吸收 `runTimelineEvents.ts`(帧构造)、`streamAssistantReply.ts`(reasoning 帧 + `AgUiStreamEvent`)、`XiaozeTurnStateTracker` 实现、`TurnStreamFlags` 与 `finalizeTurnReply` 的 resync 算术。`runEventSink.ts` 保留为传输队列并接收 `serializeTurnSteps` / `createToolCallId`(步骤记录词汇,被图侧引用)。`xiaozeTurnState.ts` 只留线协议类型(`XIAOZE_TURN_STATE_EVENT`、phase/step/payload 类型、`turnStateCustomEvent`)。
- **D3 唯一进度真相:**一份内部记录取代三镜像。处理器侧的 `reasoningClassifier` 选项删除:其 `normalizeSinkEvent` 对事件零变换(只把 delta 记进本模块现在拥有的 flags);模型侧分类不动。
- **D4 行为红线:**帧序列保持不变(现有 `agUiEndpoint.test.ts` 断言必须原样通过),唯一有意的增强见 D5。另有一处有意清理:旧 `finalizeTurnReply` 在 reasoning 未曾流出时会重复发送一个 `REASONING_MESSAGE_END`;新模块只 END 一次(前端本就把重复 END 当空操作)。
- **D5 关闭 TD-070:**resume 分支并入同一 open/ingest/finalize 路径——批准回合像普通回合一样流出步骤与回合状态;且 resume 之后计划链中的第二个 interrupt 将被正确处理(现状 resume 分支静默忽略 `result.interrupt`)。批准后的执行本身成为时间线步骤:`planningGraph` actNode 把 `resolveApproval` 包进一个工具运行步骤(仅 approve;reject 未执行任何东西,不记步骤)。resume 回合仍不持久化"approve"用户消息。
- **D6 死导出随宿主文件删除:**`yieldAssistantReply`、`yieldReasoningTurn`(resume 统一后无调用方)、重复的 FORBIDDEN 块、`buildInterruptValue`、`turnReplyCustomEvent`。

## 任务

1. 新建 `server/modules/agent/xiaoze/xiaozeTurnStream.ts`(reducer + 全部帧构造 + 单一进度记录 + resync 算术 + 回合状态快照;`finalize` 返回 `{ events, reply }` 供端点持久化)。
2. `serializeTurnSteps` / `createToolCallId` 移入 `runEventSink.ts`;更新 `planningGraph.ts` 与端点的 import。
3. 重写 `agUiEndpoint.ts` 的 `streamEvents` 为单一路径(初始与 resume 回合同构);删除被吸收的辅助与处理器 `reasoningClassifier` 选项;删除 `runTimelineEvents.ts` 与 `streamAssistantReply.ts`;`xiaozeTurnState.ts` 缩至线协议类型。
4. 测试:新建 `xiaozeTurnStream.test.ts`(golden 帧序:纯回复、带 resync 的流式回复、工具步骤、interrupt、forbidden、error、回合状态快照;吸收 `runTimelineEvents.test.ts`、`streamAssistantReply.test.ts`、`xiaozeTurnState.test.ts` 的断言后删除这三个文件)。现有 `agUiEndpoint.test.ts` 原样通过,另加一个 resume 带步骤的新用例(TD-070 行为)。
5. 文档:追踪器关闭 TD-070;`docs/PLANS.md` 中英条目;本计划 + 中文伴页。
6. 验证:agent 模块测试、`tsc -b`、`npm run docs:check`、隔离 API(deterministic 模型)手工走一轮:流式只读回合、审批回合、带步骤帧的 resume 回合。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | No change | 模块清单不变 |
| 计划 | Update | 本计划 + 中文伴页;`docs/PLANS.md` + `docs/zh-CN/PLANS.md` |
| 领域 / ADR | No change | 无新的持久决定;线协议不变 |
| 产品规格 | No change | 批准回合的步骤时间线是既有行为承诺内的呈现增强 |
| 架构 | No change | `ARCHITECTURE.md` 不描述流式内部结构 |
| 质量 / 测试 | No change | 验收 ID 面无变化(SSE 帧集合不变;resume 回合的新帧为增量) |
| 可靠性 / 运行手册 | No change | — |
| 安全 / 治理 | No change | — |
| 前端 / 设计文档 | Review | `docs/FRONTEND.md`——线协议不变;预期"无变更"并留证据 |
| 技术债 | Update | 关闭 TD-070 |

## 文档更新门禁

- [x] TD-070 移入 Completed 并附证据
- [x] `docs/PLANS.md` 中英文列出本计划
- [x] `docs/FRONTEND.md` 已复核——线协议未动,无需变更(无文档引用被吸收的文件)
- [ ] 移入 `completed/` 前 `npm run docs:check` 全绿
