# 小泽 run timeline / streaming metadata 收口

> 状态：**已完成（2026-08-22）**
> 历史编号：本计划曾误用 `TD-031`；timeline/streaming 实现已并入 completed `2026-08-12-xiaoze-turn-stream`，TD-070 已关闭。当前 TD-031 只指小泽 LLM 环境变量命名，并已由 #591 关闭。
> English: [English](../../../exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md)

## 目标

通过 AG-UI SSE 展示回合中的工具步骤、流式 delta 与准确 thinking duration，并把最终回合步骤持久化到 assistant message。

## 范围

- P0：服务端 `RUN_STARTED` 与 `xiaoze_run_timing` custom event 的 `startedAt` / `durationMs`。
- P2：planning graph 的 `RunEventSink`、`agUiEndpoint` SSE pump、可选 LLM `.stream()`、`XiaozeTurnTimeline` 与 `agent_messages.metadata`。

## 文档影响矩阵

| 文档 | 动作 |
| --- | --- |
| `docs/design-docs/xiaoze-thread-persistence.md` | 说明 assistant message 的 run-step metadata |
| `docs/zh-CN/design-docs/xiaoze-thread-persistence.md` | 同步 metadata 说明 |

## 文档更新门禁

- [x] 中英文 persistence 设计文档均说明：finalized assistant message 写入 `metadata: { runSteps, runId }`，hydration 通过 `metadata.runSteps` 恢复时间线，且只在成功回合结束时持久化，不逐 SSE token 写入。

本计划没有剩余产品/代码工作。metadata 说明与 `server/modules/agent/xiaoze/threadPersistence.ts`、`src/features/agent/XiaozeTurnTimeline.tsx` 一致；计划只存在于 `completed/`，并有中英文 companion。

## 验证

```bash
npm run test:server -- runEventSink runTimelineEvents planningGraph agUiEndpoint threadPersistence
npm test -- XiaozeReasoningMessage XiaozeProvider
npm run build
```

浏览器历史证据：发送需要工具 grounding 的 prompt；工具步骤先于最终答案流式出现，结束后 reasoning label 使用服务端 duration。
