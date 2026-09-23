# 项目参数初始化设计

> 2026-08-05 修订：对齐拓扑 cutover 后的**语义 binding**（C1 / TD-060）。  
> English: [`docs/design-docs/2026-05-20-project-parameter-initialization-design.md`](../../design-docs/2026-05-20-project-parameter-initialization-design.md)  
> 计划：[`docs/zh-CN/exec-plans/completed/2026-08-05-project-parameter-initialization.md`](../exec-plans/completed/2026-08-05-project-parameter-initialization.md)

## Canonical 来源修订（#902，2026-09-23）

当前 API 继承的是 canonical Binding 及其不可变 ProjectValue/source pin。下文语义表实现保留为历史说明，不得作为回退读取或物化目标。

- 向导从 API 加载候选，逐 Binding/来源实例选择，同名或同 Definition 的不同实例不合并。主/辅来源决定显示顺序；不同来源复制到独立的目标配置集，冲突值明确展示供审阅，不静默覆盖。
- 预览固定 `sourceProjectValueId` 与 Definition 修订。保存时重读服务端候选，客户端展示值不能替代来源证据。缺少来源，或值、Definition、来源清单、Catalog 选择漂移时，阻止批准。
- 批准复制完整的 pinned DTS/JSON 成员字节，创建目标拥有的文件、版本与配置集。DTS 重解析得到目标自己的 logical node，仅通过既有 canonical owner 物化选中的属性；JSON 使用显式 ConfigurationSchema/root/pointer 映射。两条路径均不复制来源 logical node 身份，不创建无 pin 的值。
- 目标和来源后续分别走自己的 canonical 草稿、审核和来源写回。初始化仍在审计事务内完成，重复批准返回已记录结果。从零开始不创建参数 Binding 或来源副本。
- YAML/TOML/ENV 仍不支持。初始化不执行迁移、不补旧语义行、不改来源项目、不重建生产数据。

聚焦证据由 `initializationHttp.integration.test.ts`、初始化 service/source 测试与向导测试维护。真实 API 浏览器证据和精确候选在 Issue/PR 中记录；这些测试不证明 publication manager 或部署就绪。

## 摘要（历史语义设计）

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
