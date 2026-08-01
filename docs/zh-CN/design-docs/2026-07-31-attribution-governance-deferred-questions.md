# 归属治理 — 待讨论问题

> 英文：[English](../../design-docs/2026-07-31-attribution-governance-deferred-questions.md)  
> 日期：2026-07-31  
> 状态：**已于 2026-08-01 锁定**（grilling 完成）  
> 实现计划：[`docs/exec-plans/active/2026-08-01-attribution-deferred-implementation.md`](../../exec-plans/active/2026-08-01-attribution-deferred-implementation.md)  
> 已锁定前期工作见：[follow-up 计划](../../exec-plans/completed/2026-07-31-attribution-governance-follow-up.md)

2026-07-31 grill-with-docs 已审阅；**2026-08-01 锁定答案**。实现 PR 不得自行改语义；按实现计划的 PR 拆分交付。

## 锁定决策表

| ID | 决策 |
| --- | --- |
| **D-AG-01** | 组织 Admin 改**组织**注册；**platform-admin** 改**平台与组织**注册。组织侧审计/历史**必须**能看到 platform-admin 的修改。 |
| **D-AG-01** | 改为 `singleton-per-project` → **仅阻断发布**（打开/刷新 singleton 任务；**不**强制改拓扑）。 |
| **D-AG-01** | 保存 = **同一事务**：更新注册 + 审计 + 重同步 singleton 任务。 |
| **D-AG-01** | nature 与 taxonomy `node-type` 正交（ADR-0013 已定）。 |
| **D-AG-02** | **不做** `pinned-schema-property`；coverage claim **仅** `overlay-property`（文档/合同诚实收口）。 |
| **D-AG-03** | **删除 `driverModule` 列**（独立 PR）。主体无法解析则迁移 **fail-closed**。种子/overlay/导入一律 subject-only。合入后关闭 **TD-047**。 |
| **D-AG-04** | 自动放置跟驱动注册的**默认业务分类**（真实分类 C，非临时 A）。**人工 curated** 冻结；**auto** 随注册默认变更回放；提供显式「从注册回放」操作。合入后关闭 **TD-046**。 |

## 建议 PR 拆分（由实现计划承接）

1. **PR1** — 可编辑 nature/cardinality + singleton 同事务门禁（D-AG-01）；D-AG-02 仅文档/合同。
2. **PR2** — 单独删除 `driverModule`（D-AG-03）。
3. **PR3** — 按注册放置 + auto 回放（D-AG-04）。

## D-AG-01 — 编辑驱动性质与实例基数

**背景：** `DriverRegistration` 已有 `driverNature` / `instanceCardinality`；Follow-up PR9 只做**只读**展示。

**锁定：** 谁可改见上表；改为 singleton 仅阻断发布；更新/审计/任务重算同事务；与 `node-type` 正交，文案不得混为一谈。

## D-AG-02 — 第二种 coverage claim（`pinned-schema-property`）

**背景：** 运行时只接受 `overlay-property`。

**锁定：** 不实现 pinned；公开合同与文档保持仅 overlay；残留提及删除或标为不支持。

## D-AG-03 — `driverModule` 字符串 vs 归属主体（TD-047）

**背景：** PR9 仅 UI 主体主展示，未和解存储。

**锁定：** 删列；无法解析主体则迁移失败；种子/overlay/导入 subject-only。PR2 合入后关 TD-047。**已在 PR2 实现**（`feat/drop-parameter-spec-driver-module`，迁移 `0088`）：无物理列；subject-only 写入；fail-closed 回填。

## D-AG-04 — 业务分类启发式（TD-046）

**背景：** `businessCategoryForNodePath` 关键词路由。

**锁定：** 以注册默认业务分类为准；curated 冻结、auto 回放；显式回放操作。PR3 合入后关 TD-046。

## 明确不是领域待讨论

- 实现 PR 的 GitHub 开合与 acceptance 证据：发布流程。  
- 仅为减肥拆 `parameter-specs/service.ts`：工程债，除非批次碰到该文件。  
- 参数治理 deferred D1–D8：另一条 grilling 轨道。
