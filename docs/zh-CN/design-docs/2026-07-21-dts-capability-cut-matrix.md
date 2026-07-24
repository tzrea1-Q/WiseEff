# DTS 能力裁剪矩阵

> English: [English](../../design-docs/2026-07-21-dts-capability-cut-matrix.md)

- 日期：2026-07-21
- 状态：供 [`../../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`](../../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md) 使用的规划输入
- 约束来源：[`2026-07-21-dts-parameter-surface-boundary-rfc.md`](2026-07-21-dts-parameter-surface-boundary-rfc.md)

图例：

| 动作 | 含义 |
| --- | --- |
| **Keep** | 继续作为产品能力或必需后端能力 |
| **Keep-internal** | 代码保留为引擎细节；默认 UX / 热路径门禁中隐藏 |
| **Demote** | 仍可用，但降为次要（Admin、技术视图、导出/发布） |
| **Remove-from-hot-path** | 不得再阻断日常浏览/编辑/草稿/提交 |
| **Defer** | 本 MVP 不动，以后再议 |
| **Retire** | 迁移稳定后停止投入或删除 |

## 1. Ingest / resolve / 身份

| 能力 | 现状 | 动作 | 说明 |
| --- | --- | --- | --- |
| 多文件 `resolveDtsConfigSet` | 语义 ingest 必需 | **Keep-internal** | 保证 overlay 正确；非用户词汇 |
| `dts_config_revisions` 链 | 每次 ingest | **Keep-internal** | MVP 保留，可后瘦身 |
| occurrence / effects | 全树 | **Keep-internal** | 服务写回；UI 前过滤 |
| logical nodes / 连续性 | 跨 revision | **Keep-internal** | 弱化 `needs_mapping` 浏览阻断 |
| identity mapping 任务 | 可挡 validate/edit | **Remove-from-hot-path** | 仅 Admin 技术队列 |
| structural ingest | 上传可选 | **Demote** | 搜索/调试用，不作双产品叙事 |
| 必须完整 Config Set 才出 binding | 硬空态 | **Demote** | MVP 目标：尽量从项目主 DTS 出参数面 |

## 2. Schema / spec / matcher

| 能力 | 现状 | 动作 | 说明 |
| --- | --- | --- | --- |
| vendor/linux schema 库 | matcher 真相源 | **Demote** | 辅助类型文档；不决定是否进面 |
| `matchProperty` / `matchDriver` | 创建 binding | **Keep-internal** | 有则用 |
| 未匹配 → review → 无 binding | 挡编辑 | **Remove-from-hot-path** | 面内参数可 **临时台账行** |
| Spec review / 激活 | Admin | **Keep**（Admin） | 共享规格治理 |
| 推断 draft spec | 切over 遗留 | **Defer** | 不扩张 |

## 3. Binding 与模块

| 能力 | 现状 | 动作 | 说明 |
| --- | --- | --- | --- |
| `project_parameter_bindings` | 台账核心 | **Keep** | 默认列表 API 过滤到参数面 |
| 唯一键含 `module_id` | Phase 2 | **Keep-internal** | 不新增用户可见身份层 |
| 模块注册表 + 映射 | Admin | **Keep** | 主归类输入 |
| 模块优先导航 | 默认 UI | **Keep** | MVP 去掉导航必选「驱动」层 |
| 主表「器件/驱动」列 | 突出 | **Demote** | 详情/可选列 |
| 未映射兜底 | 未分类 | **Keep** | 仅对面内行 |
| 历史 / 跨项目对比 | Phase 2 | **Keep** | 限定参数面 |

## 4. 编辑 / 写回 / 工具链

| 能力 | 现状 | 动作 | 说明 |
| --- | --- | --- | --- |
| typed draft + 提交流程 | 成熟路径 | **Keep** | 产品核心 |
| 只写 overlay、base 不可变 | 硬规则 | **Demote** | 优先写 **项目主 DTS** |
| 每次草稿全量重 ingest | 总是 | 短期 **Keep-internal** | MVP 可保留但去掉 L2 门 |
| 草稿创建时 dtc/fdtoverlay/dt-validate | fail-closed | **Remove-from-hot-path** | 迁到 L2 导出/发布 |
| 合入/写回 dtc 工具链 fail-closed | `applyLockedOverlayWriteback` 上 fail-closed | **Remove-from-hot-path** | 语义合并在 L0 完成；工具链仅 L2 Admin/基线 |
| Admin validate → `validated` | 存在 | **Demote** | 文案改为「发布检查」 |
| legacy writeback | 双轨 | **Retire**（跟进） | 主 DTS 路径稳定后 |
| 导出 DTS | 存在 | **Keep** | 默认=维护中的项目 DTS |

## 5. 前端

| 能力 | 现状 | 动作 | 说明 |
| --- | --- | --- | --- |
| 模块树工作台 | 默认 | **Keep** | 模块下直接参数 |
| DTS 拓扑技术视图 | 开关 | **Demote** | 诊断用 |
| 主表 provenance/路径 | 已多在详情 | **Keep** 仅详情 | 不回主表 |
| Mock 扁平表双轨 | 仍在 | **Defer** 退役 | API 模式为真相 |
| 「请上传完整 Config Set」空态 | 阻断文案 | **Remove-from-hot-path** | 改为「上传项目 DTS」 |

## 6. Seed / Demo

| 能力 | 现状 | 动作 | 说明 |
| --- | --- | --- | --- |
| 合成 `wiseeff-power-base.dts` | overlay seed 依赖 | **Retire** | 产品契约：每项目一份**项目主 DTS**；管理员永不维护平台基。见 [`2026-07-21-project-primary-dts-contract-rfc.md`](2026-07-21-project-primary-dts-contract-rfc.md)。过渡夹具将在 [`2026-07-21-retire-synthetic-base-dts.md`](../../exec-plans/active/2026-07-21-retire-synthetic-base-dts.md) 中移除。 |
| 项目 overlay | 差异演示 | **Keep** | 参数面过滤须去掉骨架噪声 |
| 从 seed 再生 vendor schema | 耦合 | **Demote** | 服务 L2，不决定是否进面 |

## 7. MVP 实施优先级

1. **参数面过滤**  
2. **默认仅模块 UX**  
3. **工具链离开编辑热路径**  
4. **项目主 DTS 写回契约**  
5. **无 schema 也可编面内参数（临时行）**

**Retire** 与大幅度 Config Set UX 简化放在上述闭环之后。

完整英文表与交叉引用以 English 页为准。
