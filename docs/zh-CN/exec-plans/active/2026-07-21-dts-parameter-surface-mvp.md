# DTS 可管参数面 MVP — 执行计划（中文摘要）

> English: [English](../../../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md)  
> RFC：[产品边界](../../design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md) · [裁剪矩阵](../../design-docs/2026-07-21-dts-capability-cut-matrix.md)  
> 分步实现：[superpowers plan](../../../superpowers/plans/2026-07-21-dts-parameter-surface-mvp.md)

- 日期：2026-07-21
- 状态：**Active**（D4 合入/写回与工作台去噪已在 `feat/parameter-maintenance-retire-dtc` 落地；可管表面过滤等其余 MVP 项仍开放）
- 分支：`feat/parameter-maintenance-retire-dtc`（D4 合入/写回工作取代原 `feat/dts-parameter-surface-mvp`）

## 目标

最小闭环：

1. **可管参数面**过滤（默认隐藏总线骨架参数）
2. 默认 UX：**模块 → 参数**（驱动不作必选导航层）
3. 改参后写回 **项目维护的 DTS 文本**
4. **`dtc` / `fdtoverlay` / `dt-validate` 离开编辑与合入/写回热路径**（仅 L2 导出/Admin 发布检查）。本计划在 **`applyLockedOverlayWriteback` 上落实 D4：移除 L2 fail-closed**。

## 任务一览

| ID | 交付 |
| --- | --- |
| A | 参数面纯函数分类器 + 单测 |
| B | 工作台行默认过滤到参数面 |
| C | 模块树去掉必选驱动层；主表弱化驱动列 |
| D | `createBindingDraft` 不再 L2 fail-closed |
| E | 空态/FRONTEND 文案改为「项目 DTS」故事 |
| F | 无 schema 匹配时面内参数仍可出现（临时 binding） |
| G | 窄测 + build + docs:check + 浏览器核验 |

细节与代码步骤见英文 exec plan 与 superpowers plan。Documentation Impact Matrix / Update Gate 以英文 exec plan 为准。
