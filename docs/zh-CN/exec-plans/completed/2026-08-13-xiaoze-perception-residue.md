# 小泽感知残影:删除死掉的兼容层,打断 import 环

> 状态:**已完成 2026-08-13**(单 PR 变更;计划在完成时记录)
> 日期:2026-08-13
> 分支:`refactor/xiaoze-perception-residue`
> English: [`docs/exec-plans/completed/2026-08-13-xiaoze-perception-residue.md`](../../../exec-plans/completed/2026-08-13-xiaoze-perception-residue.md)
> 来源:2026-08-12 架构审查候选 6

## 变更内容

- **删除死代码**(已对审查之后的 main 重新验证——#358/#363 加固没有复活其中任何一项):`createPerceptionAgent`(26 行、无生产调用方的适配器;其包装层测试与 `planningGraph.test.ts` 平行覆盖,唯一未覆盖的 forbidden 安全回答行为已移植到图级测试)、宿主转发的 `looksLikeInternalReasoning` re-export、`threadRepository.ts` 中无人使用的 `toAgentContext` / `isOwnedXiaozeSession`。
- **新建 `modelTypes.ts`**:纯模型/代理形状词汇(`Perception*` 类型 + `XiaozePromptDebugSnapshot`),零实现依赖。`perceptionAgent.ts` 缩为模型包装(`wrapLangChainChatModel`、`invokeModel*`、`normalizeModelResponse`、`appendStreamText`);`perceptionAgent ⇄ planningGraph`、`perceptionAgent ⇄ promptDebug`、`toolCatalog → perceptionAgent` 三处环消失——类型消费方(`planningGraph`、`toolCatalog`、`promptDebug`、`agUiEndpoint`、`xiaozeTurnStream`、eval)直接引 `modelTypes`。
- **测试/演示助手迁出生产文件**:`fakeModelSequence` / `toolCall` 从 `planningGraph.ts` 移到 `xiaoze/testing/fakeModel.ts`(四个测试文件与 `eval/scenarios.ts` 改指);`createDeterministicPerceptionModel` 从 `agUiEndpoint.ts` 移到 `deterministicModel.ts`(`XIAOZE_DETERMINISTIC` 下仍可达生产,但不再寄宿端点)。

## 验证

- `npx tsc -b --force` 绿;`server/modules/agent` 套件绿(32 文件、179 测试,含新移植的 forbidden 安全回答图级测试)。
- 删除测试成立:没有调用方重新实现被删适配器;端点工厂一如既往直接调用规划图。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 计划 | Update | 本计划 + 中文伴页;`docs/PLANS.md` + 中文版 |
| 其他 | No change | 未触碰线协议、行为、安全或运维面 |

## 文档更新门禁

- [x] `docs/PLANS.md` 中英文列出本计划
- [x] `npm run docs:check` 全绿
