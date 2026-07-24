# 退役平台合成基 DTS — 执行计划（中文摘要）

> English: [English](../../../exec-plans/active/2026-07-21-retire-synthetic-base-dts.md)  
> RFC：[项目主 DTS 契约](../../design-docs/2026-07-21-project-primary-dts-contract-rfc.md)  
> 分步实现：[superpowers plan](../../../superpowers/plans/2026-07-21-retire-synthetic-base-dts.md)

- 日期：2026-07-21
- 状态：**Active**（Phase 3 seed 门禁在 `feat/parameter-maintenance-retire-dtc`：已提交 `*-board.dts` 为 SoT；`db:seed:m1` 仅 parse 完整性；CI 中 `dtc:seed:compile` 为 advisory）
- 分支：`feat/retire-synthetic-base-dts` 或 `feat/parameter-maintenance-retire-dtc`

## 范围外

- 不重开 surface RFC 的 L0/L2 决策——与 parameter-maintenance 程序对齐：**L2 离开合入热路径**；工具链仅 Admin/基线辅助

## 目标

1. 用户上传**一份**项目 DTS；后续改参合并只更新该**项目主 DTS**。
2. 管理员只维护**模块 ↔ 驱动**映射，不维护 DTS。
3. 从 seed / demo / 产品路径**退役** `wiseeff-power-base.dts`。
4. 每个 demo 项目一份**自洽主 DTS**。

## 任务一览

| ID | 交付 |
| --- | --- |
| A | 裁剪矩阵 §6 改为 Retire + 链到 RFC |
| B | 锁定写回目标 = 项目主 DTS 成员规则 + 测试 |
| C | 编写/生成各 demo 自洽主 DTS |
| D | 重接 `db:seed:m1` / compile / validate，去掉共享基 | **进行中** — seed 门禁已在 `feat/parameter-maintenance-retire-dtc` 落地（parse-only；过渡夹具从 seed 路径退役） |
| E | 重接 vendor 生成与 golden / e2e 夹具 |
| F | 产品 seed 路径移除或隔离合成基；更新锁定计数 |
| G | seed + 窄测 + build + docs:check + 浏览器核验 |

Documentation Impact Matrix / Update Gate 以英文 exec plan 为准。
