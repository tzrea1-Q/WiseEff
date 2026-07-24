# 合入 merged schema 不再显示「待处理」— 实现计划摘要

> English plan: [`docs/superpowers/plans/2026-07-24-merged-schema-state-not-attention.md`](../../../superpowers/plans/2026-07-24-merged-schema-state-not-attention.md)  
> 设计：[`docs/zh-CN/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md`](../specs/2026-07-24-merged-schema-state-not-attention-design.md)  
> 分支：`fix/merged-schema-state-not-attention`

## 目标

消除合入写回 `schema_state=merged` 经 API 失败闭合为 `unreviewed` 后，工作台误亮「待处理」的问题。

## 做法

1. **读路径**：`normalizeBindingSchemaState("merged") → "valid"`（TDD）。
2. **写路径**：合入写回改为持久化 `schemaState: "valid"`、`policyState: "not_applicable"`（TDD）。
3. **文档**：`domain-model` EN/ZH 各补一句；`docs:check`。
4. **不做**：DB 迁移、改徽章文案、改工作台治理逻辑、强制 `policyState: "pass"`。

## 验证

- `npm test -- server/modules/parameter-topology/schemaState.test.ts`（及 Task 2 写回测例）
- `npm run docs:check`
- 可选：本地 Aurora `gpio_int` 行不再显示「待处理」

## 协作

实现子代理只在功能分支提交；由父代理开 PR / 合并。
