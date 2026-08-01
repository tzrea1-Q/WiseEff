# 治理 + 平台收口（归档、证据、验收面）

> Status: **已完成（实现已合入）**。#216（`feat/governance-platform-closeout`）。归属 deferred D-AG-01–04 已锁定，实现见 [`2026-08-01-attribution-deferred-implementation.md`](../active/2026-08-01-attribution-deferred-implementation.md)。  
> Date: 2026-08-01  
> English: [`docs/exec-plans/completed/2026-08-01-governance-platform-closeout.md`](../../../exec-plans/completed/2026-08-01-governance-platform-closeout.md)  
> 承接以下已合入计划的残留收口：
> - [`2026-07-30-parameter-governance-state-machine-completion.md`](../../../exec-plans/completed/2026-07-30-parameter-governance-state-machine-completion.md)（#212–#214）
> - [`2026-07-31-attribution-governance-follow-up.md`](../completed/2026-07-31-attribution-governance-follow-up.md)（#215）
> - [`2026-07-30-platform-tier-and-super-admin.md`](../../../exec-plans/completed/2026-07-30-platform-tier-and-super-admin.md)（#209–#210）

## 目标

在不引入新的产品语义的前提下，收口三条已合入的治理/平台工作流：

1. **Housekeeping** — 归档三份源计划（诚实 Status + 残留清单）；在 OpenAPI schema 已补齐时关闭 TD-054。
2. **Platform 跨租户证据** — 将 `PLAT-ROLE-*` / `DRV-PROMOTE-*` 从「已登记、无自动化」推进到可跑验收和/或归档 Playwright 证据。
3. **参数治理验收面** — 登记并落地计划中的 Admin 验收 ID；浏览器冒烟 Admin 路径；**未 grilling 前不实现** D1–D8 / D-AG-*。

## 非目标

- 不 grilling / 不实现两份 deferred-questions 文档中的设计题。
- 不新增治理能力、schema 迁移或角色模型变更。
- 不做完整 M6 目标环境证据（OIDC / 备份 / 容量）。

## Git & PR 工作流

实现仅在 `feat/governance-platform-closeout` 提交；由父代理开/合 GitHub PR 并同步本地 `main`。

## 成功标准

- 三份源计划移入 `completed/`，Status = 已合入 + 残留指向本计划。
- TD-054 在 EN/ZH tech-debt 中关闭，或用可复现失败重新打开。
- `PLAT-ROLE-001..003` 与 `DRV-PROMOTE-001..005` 均有自动化 `@acceptance` 或 `work/ui-checks/` 手动证据索引。
- 九个治理验收 ID 已写入 coverage map / requirements / operation matrix。
- `playwright-cli` 三视口证据覆盖 `/platform-console`、`/user-permissions`、`/parameter-admin/modules`、`/parameter-admin/identity-mapping`，以及 specs / spec-review / modules 各一条 Admin 路径。
- `npm run docs:check`、相关测试、`npm run build` 通过。

## 交付批次

### Batch A — Housekeeping

归档三份计划；核对并关闭 TD-054；更新 `docs/PLANS.md` 与中文对照。

### Batch B — Platform 证据与自动化

重点回归：org Admin 不能自授 `platform-admin`；platform-admin 不能读他租户业务数据；promote/revert 冲击半径确认。扩展 permissions-matrix，补 PLAT-ROLE-002/003，DRV-PROMOTE 能自动化则自动化，否则归档手动证据。

### Batch C — 治理验收面

登记 `SPEC-DEPRECATE-001`、`SPEC-RESTORE-001`、`SPEC-EDIT-DIFF-001`、`IDMAP-NEWID-001`、`IDMAP-HISTORY-001`、`IDMAP-REOPEN-001`、`MOD-QUEUE-RESTORE-001`、`OVERLAY-RETIRE-001`、`MOD-ATTR-SORT-001`；能复用既有 Admin 验收则挂标记，否则诚实 `future`/`Blocking: No`；浏览器冒烟；不动 deferred 设计题。

### Batch D — 文档门与验证

完成 Documentation Impact Matrix；截图归档；全部成功标准勾选后才可将本计划移入 `completed/`。

## Documentation Impact Matrix / Update Gate

与英文计划同表同门禁。`npm run docs:check` 通过前不得归档本计划。

## 本计划结束后仍故意开放

- 参数治理 D1–D8、Attribution D-AG-01–04（TD-046/047）。
- 因种子缺少多租户晋升数据而仍为手动的 `DRV-PROMOTE-*`。
- M6 目标证据 / TD-042 cutover 演练（独立程序）。
