# 小泽线协议:一份契约,两侧适配

> 状态:**已完成 2026-08-13**(单 PR 变更;计划在完成时记录)
> 日期:2026-08-13
> 分支:`refactor/xiaoze-protocol-package`
> English: [`docs/exec-plans/completed/2026-08-13-xiaoze-protocol-package.md`](../../../exec-plans/completed/2026-08-13-xiaoze-protocol-package.md)
> 来源:2026-08-12 架构审查候选 5;ADR-0031

## 变更内容

- **新建 workspace 包 `@wiseeff/xiaoze-protocol`**(`packages/xiaoze-protocol`):五个 CUSTOM 事件名(`xiaoze_turn_state`、`xiaoze_turn_reply`、`xiaoze_run_timing`、`xiaoze_prompt_debug`、`on_interrupt`)及其载荷形状——`XiaozeRunStep`、`XiaozeCitation`(含 type 枚举)、`XiaozeTurnStatePayload`、`XiaozeTurnReplyPayload`、`XiaozeRunTimingPayload`、`XiaozePromptDebugSnapshot/Payload`、`XiaozeTurnPhase`。只放形状;启发式与渲染留在各自一侧(ADR-0031)。
- **服务端**:删除 `xiaozeTurnState.ts` 与 `xiaozeTurnReply.ts`(仅存的辅助 `turnStateCustomEvent` 内联进 `xiaozeTurnStream`);`runEventSink` / `modelTypes` / `promptDebug` / `types.ts` 改为引用或转发契约;步骤记录全线统一为 `XiaozeRunStep`(`XiaozeRunStepRecord` 名字消失);`AgentCitation` 成为契约别名。
- **前端**:删除四个手抄镜像文件(`xiaozeTurnStateTypes.ts`、`xiaozeTurnReplyTypes.ts`、`xiaozeRunTimingTypes.ts`、`xiaozePromptDebugTypes.ts`);约 20 个消费文件改引包;`XiaozeRunStepSnapshot` 更名为 `XiaozeRunStep`。
- 合并时发现并裁决的漂移:契约保留服务端的 `promptVersion?`(前端镜像曾丢失)与服务端的引用 `type` 枚举(前端曾放宽为 `string?`)。
- 范围外、保持不变:`xiaozeToolLabels.ts` 作为前端回退标签表保留(标签目前不是线上载荷;见工具元数据计划);`splitAssistantContent` 与推理启发式仍为两侧各自的行为。

## 验证

- `npx tsc -b --force` 绿(两侧对同一份契约编译);`vite build` 绿;`npm run docs:check` 绿。
- `server/modules/agent` 179 测试绿;`src/features/agent` 109 测试绿。
- 线上行为不变:事件名与载荷字段集与服务端既有发出内容逐字节一致。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 领域 / ADR | Add | `docs/adr/0031-xiaoze-wire-contract-is-a-shared-package.md`;`CONTEXT.md` 与 `docs/adr/README.md` 索引 |
| 计划 | Update | 本计划 + 中文伴页;`docs/PLANS.md` + 中文版 |
| 其他 | No change | 线上载荷不变;无产品行为变化 |

## 文档更新门禁

- [x] ADR-0031 已记录并入索引(`CONTEXT.md`、`docs/adr/README.md`)
- [x] `docs/PLANS.md` 中英文列出本计划
- [x] `npm run docs:check` 全绿
