# 归属 deferred 实现（D-AG-01–04）

> Status: **进行中** — 决策已锁定；按序从 `main` 开分支实现  
> Date: 2026-08-01  
> English: [`docs/exec-plans/active/2026-08-01-attribution-deferred-implementation.md`](../../../exec-plans/active/2026-08-01-attribution-deferred-implementation.md)  
> 锁定决策：[`docs/zh-CN/design-docs/2026-07-31-attribution-governance-deferred-questions.md`](../../design-docs/2026-07-31-attribution-governance-deferred-questions.md)

## 目标

按 2026-08-01 锁定答案交付 D-AG-01–04，不重开 grilling：

1. **PR1** — 可编辑 nature/cardinality（同事务审计+任务）+ D-AG-02 文档/合同收口  
2. **PR2** — 删除 `driverModule`（TD-047，迁移 fail-closed）  
3. **PR3** — 按注册默认业务分类放置 + auto 回放（TD-046）

## 非目标

- 改锁定表语义；夹带 D1–D8；把 PR2/PR3 捆进 PR1。

## Git & PR

三连串分支（本计划明确例外于「一计划一支」）：

| PR | 分支 |
| --- | --- |
| PR1 | `feat/attribution-editable-nature-cardinality` |
| PR2 | `feat/drop-parameter-spec-driver-module` |
| PR3 | `feat/attribution-registration-placement` |

实现子代理只在当前分支提交；父代理开/合 PR，并在下一分支前同步 `main`。

## 成功标准（摘要）

- [x] PR1（#218 已合入）：权限/审计/同事务/仅阻断发布；去掉 pinned claim 宣传；验收 ID `DRV-REG-004` 已登记（e2e 仍为 future）
- [x] PR2：subject-only 写入 + 迁移 `0088` fail-closed；关 TD-047
- [x] PR3：注册默认分类；curated 冻结、auto 回放；关 TD-046（迁移 `0089`）
- 每 PR：聚焦测试 + `build`；收口前 `docs:check`；UI 变更需 playwright-cli 三视口证据

完整任务、文档影响矩阵与验证命令以英文计划为准。
