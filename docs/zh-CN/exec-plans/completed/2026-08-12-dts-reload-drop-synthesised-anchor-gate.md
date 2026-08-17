# 废除 synthesised-anchor 重载候选不对称门禁

> Status: **Completed**（经 PR #311 于 2026-08-12 合入）。文档门禁于 2026-08-17 关闭。
> Date: 2026-08-12
> Branch: `fix/dts-reload-drop-synthesised-anchor-gate`
> English: [`docs/exec-plans/completed/2026-08-12-dts-reload-drop-synthesised-anchor-gate.md`](../../../exec-plans/completed/2026-08-12-dts-reload-drop-synthesised-anchor-gate.md)
> 取代 [`docs/exec-plans/completed/2026-08-10-dts-reload-debugging.md`](../../../exec-plans/completed/2026-08-10-dts-reload-debugging.md) 中「降级定位器 / 合成 `/label` 拒绝」锁定决策

## 目标

废除「参数自身 locator 为单段合成 `/label` 时挡、其子孙放行」的不对称候选规则。父子绝对路径一视同仁：非空 `nodePath` + 支持的值形态 + 基线值 ⇒ 可调试。路径是否适用于项目基树，仍由 preflight / `fdtoverlay`（含 ephemeral 悬空 label stub）判定。

## 非目标

- 重写 L1 悬空 `&label` 自锚或 overlay-only 板的 ephemeral stub。
- 保证设备 live FDT 与项目树一致（子节点路径已接受同一风险）。
- 扩大未支持值形态（TD-065）。

## Git 与 PR

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在 `fix/dts-reload-drop-synthesised-anchor-gate` 上提交；不打开或合并 GitHub PR |
| 父代理 | 审查、验证、开/合 PR，并同步本地 `main` |

## 成功标准

- 代码与类型中不再存在 `synthesised-anchor` / `isSynthesisedAnchorLocator`。
- 现行文档不再把「合成根挡、子孙放行」表述为现行规则。
- Aurora `battery_tbl`（`nodePath=/battery_cccv`）在形态与基线满足时为 `debuggable: true`。

## 文档影响矩阵与更新门禁

见英文版同名计划；中英文配套同步更新。
