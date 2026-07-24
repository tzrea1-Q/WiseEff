# 合入后 merged schema 状态不得显示「待处理」— 设计

> 日期：2026-07-24  
> 状态：已批准实现  
> English: [`docs/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md`](../../../superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md)  
> 分支：`fix/merged-schema-state-not-attention`

## 问题

锁定合入写回会把 `project_parameter_binding_revisions` 写成 `schema_state = "merged"`（历史上还有 `policy_state = "merged"`）。列表 API 经 `normalizeBindingSchemaState` 规范化时，只把 `valid` / `matched` / `reviewed` 视为健康，其余（含 `merged`）**失败闭合**为 `unreviewed`。

工作台把 `schemaState === "unreviewed"` 映射为 `governanceState: "attention"`，并显示「待处理」。合入成功后，运维会看到与真实「身份映射未决 / 规格未审阅」无法区分的误报。

本地 Aurora 已复现：`sc8562@6E` / `gpio_int` 在 DB 为 `merged`，API 返回 `unreviewed`，列表显示「待处理」；开放身份映射任务为空。

## 目标

- 成功合入不得仅因存储了 `merged` 而亮「待处理」。
- 历史 `schema_state=merged` 行通过读路径立即变健康（不做强制 SQL 回填）。
- 新写回持久化产品枚举，不再写入伪枚举 `merged`。
- 真正的 `unreviewed`、开放身份映射、`invalid` / policy `fail` 行为不变。

## 非目标

- 改徽章文案，或新增「已合入」治理标签。
- 合入后强制 `policyState = pass`（未跑政策则保持 `not_applicable`）。
- DB migration / 批量 UPDATE 历史 `merged` 行。
- 仅前端隐藏徽章而不修 API 规范化。
- 扩大规格校验产品流程改造。

## 设计

### 读路径

在 `server/modules/parameter-topology/schemaState.ts` 将 `merged` 视为健康的遗留/写回标记：

- `normalizeBindingSchemaState("merged") === "valid"`
- 未知 / null / 空 仍失败闭合为 `unreviewed`
- `invalid` 与字面量 `unreviewed` 不变

### 写路径

锁定合入写回（`editService` 中 action `"set"` 的候选修订 upsert）：

- 持久化 `schemaState: "valid"`（不再写 `"merged"`）
- 持久化 `policyState: "not_applicable"`（不再写 `"merged"`），与当前 API 对未知 policy 的规范化一致，且此处合入并不重新跑政策评估

### 工作台（不变）

`resolveGovernanceState` 与 `ImportanceCell` 保持原样。规范化返回 `valid` 后，仅在 `mappingOpen` 或真正的未审阅/阻断态出现 attention。

### 数据流

```text
合入写回
  → DB schema_state = valid（新）| merged（历史）
  → normalizeBindingSchemaState → valid
  → resolveGovernanceState → 非 attention（除非 mappingOpen）
  → UI：无「待处理」徽章
```

## 测试

- 单测：`normalizeBindingSchemaState("merged") === "valid"`；既有健康/遗留/失败闭合用例仍通过。
- 写回/编辑测例对持久化字段断言：期望 `valid` + `not_applicable`，不再写 `merged`。
- 不削弱证明真实 `unreviewed` 仍产生 `attention` 的 `buildDtsWorkbenchRows` 测例。

## 文档影响（简表）

| 区域 | 动作 |
| --- | --- |
| 本设计双语对 | Update（本次） |
| Domain / FRONTEND 若写死「仅 ingest 的 unreviewed 才 attention」 | Review；必要时补一句 |
| API 契约产品枚举 | Review；DTO 仍为 `valid \| invalid \| unreviewed` |
| Exec-plan / tech-debt | 无变更（除非后续单独记回填债） |

## 成功标准

1. 当前修订为 `merged` 或合入后新写 `valid` 的 binding，API 返回 `schemaState: "valid"`。
2. 映射任务已关闭且非真正未审阅/无效时，工作台不显示「待处理」。
3. 相关服务端单测通过；真实 attention/blocked 路径无回归。
