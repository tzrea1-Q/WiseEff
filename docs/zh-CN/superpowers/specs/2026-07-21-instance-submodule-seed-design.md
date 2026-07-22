# 实例子模块 + 驱动发现 — 设计摘要

> 日期：2026-07-21  
> 状态：进入实现计划  
> 英文完整版：[`docs/superpowers/specs/2026-07-21-instance-submodule-seed-design.md`](../../../superpowers/specs/2026-07-21-instance-submodule-seed-design.md)  
> 实现计划：[`docs/superpowers/plans/2026-07-21-instance-submodule-seed.md`](../../../superpowers/plans/2026-07-21-instance-submodule-seed.md)

## 问题

业务大模块混多驱动；同驱动多地址跨项目不稳；无 compatible 子节点需父子挂接；未配置驱动需可发现。

## 锁定决策

- 保留业务大类；可管实例至少一子模块；DTS 父子则模块父子（A）。
- **多实例三分法 Type U / N / C**（勿混用一套规则）。
- U/N：compatible → 驱动组 → 实例子模块；C：无驱动组，挂父实例。
- Board → `board`；不建 Power Bus；脚手架不进发现必配队列。
- `scharger_v800*` 整树挂 Charger IC。
- 未映射：未分类 + 发现队列（与规格审核分流）。

## Type U / N / C（aurora 审计）

| 类型 | 信号 | 驱动组 | 示例 |
|------|------|--------|------|
| **U** | 同名 + 不同 `@addr` + 同 compatible | 有 | `hl7603@75/@77`；`mt5788@*` 同型 |
| **N** | 同 compatible + 不同节点名 | 有 | `fm1230`/`fm1230_1`；`t91407`/`_1` |
| **C** | 无 compatible | 无 | `battery0`/`1`；`battery_checker@*`；`scharger_v800_*`；`batt` |

脚手架同 compatible 多实例（`hisilicon,gpio`×6、`spmi`/`spmi1`、`i2c@*`）**排除**。  
`fm1230_swi` 与 `fm1230` 为不同 compatible → 不同驱动组。

## 上传 / 后台

稳定映射只绑 compatible/driver；实例 ingest ensure。  
后台：模块树｜稳定映射｜发现队列｜重算。

## 成功标准

见英文 §9。
