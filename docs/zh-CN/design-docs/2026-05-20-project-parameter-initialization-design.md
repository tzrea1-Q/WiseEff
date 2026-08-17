# 项目参数初始化设计

> 2026-08-05 修订：对齐拓扑 cutover 后的**语义 binding**（C1 / TD-060）。  
> English: [`docs/design-docs/2026-05-20-project-parameter-initialization-design.md`](../../design-docs/2026-05-20-project-parameter-initialization-design.md)  
> 计划：[`docs/zh-CN/exec-plans/completed/2026-08-05-project-parameter-initialization.md`](../exec-plans/completed/2026-08-05-project-parameter-initialization.md)

## 摘要

在新建项目向导中增加参数库初始化：从源项目选取 **binding 语义快照**（一次性），提交初始化审阅，Admin 批准后才解锁常规 typed binding 工作流。批准后不与源项目保持同步。

## 目标

- 从既有项目经验初始化新项目参数库。  
- 支持多源继承与主源优先。  
- 按模块、风险、单条 **binding** 选择（不以扁平 `parameterId` 为 SSOT）。  
- 草稿 + 审阅可审计。  
- 不把源项目设备测量值当作新项目已测得。

## 非目标

- 批准后与源项目持续同步。  
- 完整模板市场。  
- 超出主源优先的自动冲突合并。  
- 为新项目直接采集设备当前值。  
- 以扁平 `recommendedValue` 作为 API 写模型。

## 已废弃（API 模式禁止实现）

| 废弃 | 替代 |
| --- | --- |
| `selectedParameterIds` / 快照 `parameterId` 为 SSOT | 源 `projectParameterBindingId` + 目标项目物化新 binding |
| 快照 `recommendedValue: string` 为写载荷 | 快照 `parameterSpecId` / `parameterSpecVersionId` / `effectiveValue`（或 `rawValue`） |
| 「批准时激活共享定义值」 | 事务内在**目标项目**物化 bindings |
| 原型 reducer 为 SSOT | Port + HTTP + DB；mock 实现同一 Port |

## 入口与流程

向导步骤：项目基础 → 团队/负责人 → **初始化参数库** → 摘要 → 提交。须显式提供「从空库开始」。

流程要点：选源（或空库）→ 主源/补充源 → 筛选与勾选 binding → 服务端预览快照 → 提交 → `initialization_pending_review` → Admin 通过（物化并 `initialized`）或驳回（保留草稿与原因）。

## 项目初始化状态

- `not_initialized` / `initialization_draft` / `initialization_pending_review` / `initialization_rejected` / `initialized`  
- 未 `initialized` 前锁定常规 typed binding / 变更请求提交；只读查看仍可用。

## 冲突与值规则

语义冲突键（v1）：同组织内 `parameter_spec_id` + `module_id`（与现有跨项目 compare 对齐）。主源优先；补充源仅填补主源缺失。物化时创建目标项目新 binding；测量确认态为 `pending_project_confirmation`（待项目确认）。不复制源设备「当前测得」为已确认。

## 空库路径

显式「从空库开始」→ 零快照项 → 仍走审阅（审计对称）→ 批准后 `initialized` 且零 binding。

## 数据模型（要点）

草稿含 `selectedSourceBindingIds`、`bindingSnapshots[]`（含 `sourceProjectParameterBindingId`、`parameterSpecId`、`parameterSpecVersionId`、`effectiveValue`、`rawValue`、`moduleId` 等）。审阅含 pending/approved/rejected。迁移 id **≥ 0091**。默认落在 `server/modules/parameters/`。

## 权限与审计

创建者编辑自有草稿；Admin 批准/驳回。审计 kind：`project-initialization-submitted` / `approved` / `rejected`。

## 验收意图

`PARAM-INIT-WIZARD-001`、`PARAM-INIT-EMPTY-001`、`PARAM-INIT-REVIEW-001`、`PARAM-INIT-REJECT-001`、`PARAM-INIT-LOCK-001`。细节以英文设计与英文计划为准。
