# DTS 参数管理结构化重构 · 主计划（Program Plan）

> 本文是**程序级主计划**，统筹 DTS 参数管理的整体重构：目标架构、分期边界、排序与依赖、跨期锁定决策、风险登记。每个阶段的**可执行任务级计划是独立文档**（见下方「阶段计划」）。
>
> 现状评估与问题清单见 [DTS 参数管理现状评估](../../design-docs/2026-07-14-dts-parameter-management-assessment.md)。

**角色约定：** 架构师智能体（本会话/父智能体）负责撰写并维护本主计划与阶段计划、评审开发智能体产物、开 PR、合并、同步 `main`。开发智能体（子智能体）按阶段计划**逐任务**实现，仅在特性分支提交，不开/合 PR。

---

## Goal

把 WiseEff 从「扁平键值同步器」升级为**能作为 DTS 配置权威源的结构化配置管理平台**：真实解析、结构化建模、类型化值、兼容性完整性、可构建性校验门禁、无损导出，以及配置集/发布基线的顶层管理。

## Positioning Decisions（已锁定，全期适用）

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 事实来源 | WiseEff 为 DTS 参数**权威源**；所有合入经过它；始终维护最新 DTS。发布由软件人员**手动 Git 提交**（Git 集成后续，当前不做）。当前必须能**无损导出**权威 DTS。 |
| 2 | 校验门禁 | 合入前**强制 dtc 编译 / schema 校验**通过。 |
| 3 | 顶层粒度 | **项目 → 板级配置集（可构建单元）+ 发布基线**。 |
| 4 | include | 当前**不支持** `/include/`；上传时**显式拒绝并提示**，不静默忽略。 |
| 5 | 建模方向 | **完整结构化建模**（真解析器 + CST/AST + 节点树 + 类型化值 + 无损回写）。 |

---

## Target Architecture（目标架构）

顶层实体链（各阶段逐步落地）：

```
项目 (project)
  └── 板级配置集 (dts_config_set)          ← P2：可构建单元 + 变体关系；dtc/schema 校验门禁挂此层
        ├── 文件 (dts_file) + 文件版本 (dts_file_version, 保留 CST 以无损回写)   ← P1
        │     └── 节点 (dts_node: parent_id, name, unit_address, labels[], compatible, status, order)   ← P1
        │           └── 属性 (dts_property: value_type, raw_text, normalized_value)   ← P1
        │                 └── phandle 引用 (dts_phandle_ref: from_property → target_node/label)   ← P1
        └── 发布基线 (dts_release_baseline)   ← P2：横切配置集的全量冻结快照；对比/原子回滚/发布标记
```

配套原则：

- **结构归属 `(文件版本)`，不再由 org 级全局定义承担结构与身份。** 现有 `parameter_definitions` / `parameter_modules` 降级为**可选的跨项目归类/对齐视图**（节点/属性多对一映射），保持 M1 参数审阅流的向后兼容。
- **值分层类型化：** `u32-array | bytes | string-list | phandle-list | bool | mixed`；diff 用类型感知的规范化比较（十六进制、空白、分组归一）。可借鉴 debug 侧 `valueFormat` / `normalizationMode`（见 [domain-model](../../design-docs/domain-model.md) §Debug Value Metadata）。
- **无损回写基于 CST**（保留注释/空白/顺序），替换正则文本 patch。
- **契约类属性一等语义**：`compatible` / phandle / `-supply` / `#address-cells`，提供引用存在性与变更影响检查。
- **兼容性策略**：全程与现有 `project_parameter_files` / M1 参数流并存，新结构以**新表 + 特性开关**引入，旧的 `parsed_index` 作为**派生兼容视图**保留至过渡结束（TD 记账）。

---

## Phases（分期）

每期一份独立、可执行的任务级计划；每期一个特性分支；每期结束由架构师评审、开 PR、合并。

| 阶段 | 计划文档 | 目标 | Schema 变更 | 前置依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| **P0** 解析止血 | [dts-p0-parser-safety](2026-07-14-dts-p0-parser-safety.md) | 让解析器「诚实」：剥注释（真修）、对无法忠实表达的构造**检测并拦截/告警**（不再静默产错）、回写多行/多组值**安全失败**而非损坏 | 无 | 无 | ✅ 已评审通过，合并本地 `main`（待 push） |
| **P1** 结构化核心 | [dts-p1-structural-model](2026-07-14-dts-p1-structural-model.md) | 真 DTS 解析器（CST）+ 节点树/类型化属性/phandle schema + 迁移 + 结构化同步/无损回写 + 身份解耦 | 新表 | P0 合并 | ✅ 已评审通过，合并本地 `main`（待 push） |
| **P2** 配置集·基线·校验门禁 | [dts-p2-config-set-baseline-gate](2026-07-14-dts-p2-config-set-baseline-gate.md) | 板级配置集 + 发布基线 + dtc/schema 校验沙箱 + 无损导出 | 新表 | P1 合并 | 计划就绪，可执行 |
| **P3** 产品功能闭环 | 待撰写（P2 合并后由架构师产出） | 结构化值编辑器 + 结构化变更集/差异 + 路径/label/compatible 检索 + 影响分析 + 节点级 RBAC | 少量 | P2 合并 | 边界见下 |

> **为何 P2/P3 暂不细化到任务级：** 它们的任务细节强依赖 P1 落地后的实际 schema 与解析器契约，提前细化会大概率返工。架构师将在前一阶段合并后，基于真实产物撰写下一阶段的任务级计划。本主计划锁定其**范围边界**，避免范围漂移。

### P2 范围边界（锁定，任务待细化）
- 新增 `dts_config_set`（项目下的可构建单元，聚合一组 `dts_file`）+ 变体/派生关系。
- 新增 `dts_release_baseline`（配置集全量快照）+ 与当前工作区对比 + 原子整体回滚 + 发布标记。
- **dtc/schema 校验沙箱**：合入配置集前调用 dtc 编译（含 overlay/`&label` 解析检查）与可选 dt-schema 绑定校验，作为**阻断式门禁**；沙箱选型（容器/子进程/受限执行）为 P2 的开放技术决策。
- **无损导出**：从 CST 导出与权威源等价的 `.dts`/`.dtsi` 供软件人员提交 Git。
- 非目标：Git 提交集成（后续独立立项）。

### P3 范围边界（锁定，任务待细化）
- 按 `value_type` 渲染的**结构化值编辑器**（表/字节数组/phandle/布尔/枚举/字符串列表）。
- **结构化变更集**：把横跨多节点/多文件的一次逻辑改动聚成一个可审阅单元；**结构化差异**（节点增删、行/列级）替换纯文本 diff。
- **检索**：按节点路径 / `@address` / label / `compatible` / 值检索。
- **影响分析**：沿 phandle / compatible / 配置集变体推导影响面，接入 `ChangeRequest.impact`。
- **节点级 / 风险分层 RBAC**：安全关键节点（regulator/thermal/限流）的编辑门禁；约束 AI（小择）对安全关键节点的写操作。

---

## Sequencing & Branching

- 一期一分支，严格串行合并：`feat/dts-parser-safety`（P0）→ `feat/dts-structural-model`（P1）→ P2 → P3。
- 每期分支从最新 `main` 拉出；开发智能体仅在分支提交；架构师评审后开 PR、合并、`git pull origin main` 同步本地 `main`，再拉下一期分支。
- P0 与 P1 可在 P0 合并后立即衔接；P1 是关键路径，最重。

## Cross-Phase Locked Decisions

1. **不破坏现有 M1 参数流**：新结构以新表并存引入，旧 `parsed_index` 保留为派生兼容视图；现有 `project_parameter_files` 上传/同步/回写/冲突 API 在 P1 期间保持可用，切换以特性开关控制。
2. **include 一律显式拒绝**（决策 #4），全期不做静默展开。
3. **值比较一律类型感知**（P1 起），杜绝等价重排造成的假 diff。
4. **权限对齐**：新增结构化写操作沿用现有 `canAdminParameters` / 审阅权限，节点级细化留到 P3。
5. **审计**：所有结构化写（上传解析、同步草稿、回写、基线创建/回滚、校验门禁结果）必须写 `audit_events`。

## Risk Register

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 真 DTS 解析器复杂度高（overlay/label/类型） | P1 工期与正确性 | 优先选用成熟 devicetree 解析库或移植 dtc 文法；用范例 31 类格式建 fixture 全覆盖测试 |
| 无损回写难保证 | 导出与 Git diff 噪声 | 采用 CST（保留注释/空白/顺序），回写=最小节点替换；导出用「解析→序列化」往返测试保证幂等 |
| dtc 沙箱在自托管环境的可用性 | P2 校验门禁落地 | P2 独立评估沙箱选型；门禁可降级为「警告 + 人工确认」的可配置模式 |
| 数据迁移与旧流并存 | 过渡期数据一致性 | 新表并存 + 特性开关 + 迁移可回滚；每期迁移含 smoke 测试 |
| 范围漂移（P2/P3 提前铺开） | 交付节奏 | 主计划锁定边界；任务级计划仅在前置合并后撰写 |

---

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| 现状评估 | `docs/design-docs/2026-07-14-dts-parameter-management-assessment.md` | No change（本计划输入） |
| 主计划 | `docs/exec-plans/active/2026-07-14-dts-management-program.md` | Update（分期状态随进展维护） |
| P0 计划 | `docs/exec-plans/active/2026-07-14-dts-p0-parser-safety.md` | Update（执行期勾选） |
| P1 计划 | `docs/exec-plans/active/2026-07-14-dts-p1-structural-model.md` | Update（执行期勾选） |
| 领域模型 | `docs/design-docs/domain-model.md` | Review（P1 落地后新增结构化实体） |
| 计划登记 | `docs/PLANS.md` | Update（新增本期计划到活跃列表） |
| 计划登记（中文） | `docs/zh-CN/PLANS.md` | Update |
| 技术债 | `docs/exec-plans/tech-debt-tracker.md` | Review（TD-035/038/039 归并，过渡期兼容视图记账） |
| 架构总览 | `ARCHITECTURE.md` | Review（P2 顶层实体链落地后） |

## Documentation Update Gate

本主计划移入 `completed/` 的前提（在 P0-P3 全部完成后）：

- [ ] P0-P3 阶段计划均已完成并移入 `completed/`
- [ ] `domain-model.md` 已更新结构化实体（节点树/类型化值/配置集/基线）
- [ ] TD-035 / TD-038 / TD-039 已在 tech-debt-tracker 中标记归并或关闭
- [ ] `docs/PLANS.md` 与 `docs/zh-CN/PLANS.md` 活跃/完成列表一致
- [ ] `npm run docs:check` 通过

---

## Handoff to Implementation Agents

- 开发智能体从 **P0 计划**开始，逐任务执行；每任务遵循「写失败测试 → 实现 → 测试通过 → 提交」。
- 每期完成后回交架构师**评审**（对照该期 Spec Coverage Self-Review 与验证矩阵），架构师负责 PR/合并/同步与下一期计划撰写。
