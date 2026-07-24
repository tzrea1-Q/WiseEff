# RFC：DTS 可管参数面边界

> English: [English](../../design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md)

- 日期：2026-07-21
- 状态：**规划已接受**（产品边界决策；尚未实现）
- 修订：[`2026-07-14-dts-parameter-management-assessment.md`](../../design-docs/2026-07-14-dts-parameter-management-assessment.md) §2 中与本 RFC 冲突的锁定项（见 §6）
- 配套：能力裁剪矩阵 [`2026-07-21-dts-capability-cut-matrix.md`](2026-07-21-dts-capability-cut-matrix.md)；项目主 DTS / 退役平台基 [`2026-07-21-project-primary-dts-contract-rfc.md`](2026-07-21-project-primary-dts-contract-rfc.md)
- 实现计划：[`../../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`](../../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md)

## 1. 问题陈述

参数管理的初衷是搭建 **标准化、数字化、人类治理的参数平台**：

- 硬件工程师可在平台上看懂、修改、追溯参数，而不是邮件传参。
- 软件工程师从 WiseEff 拿到维护好的权威 DTS 文本再合入 Git。
- 用户按 **业务模块 / 子模块 → 可调参数** 工作，而不是学习设备树专家视图。

2026-07 的 DTS 拓扑 / schema / 工具链建设，使产品叠加成 **Config Set 语义编译子集**：多文件 resolve、logical node 连续性、schema 匹配、binding 身份元组，以及编辑路径上 fail-closed 的 `dtc` / `fdtoverlay` / `dt-validate`。后续虽补了「模块优先」导航，但未定义一等的 **可管参数面**。

结果：系统在管整棵有效树（含 `&spmi`、`pmic@0`、`#address-cells` 等骨架），而用户真正需要的是 `hi6xxx_coul` / `batt` 内部业务参数。

## 2. 决策摘要

| # | 决策项 | 选择 |
| --- | --- | --- |
| D1 | 用户主对象 | **可管参数面**（过滤后的参数台账），不是整棵设备树 |
| D2 | 主 UX 维度 | **模块 / 子模块 → 参数**；驱动仅作归类输入 |
| D3 | DTS 角色 | 参数变更后维护项目 **权威 DTS 文本**；可供人导出到 Git |
| D4 | 工具链 | **可选 / 延后门禁**（导出或发布辅助）；**不**挡日常改参→草稿→提交 **或语义合入/写回** |
| D5 | Config Set / base+overlay | 需要时作为 **内部实现细节**；不是默认「上传项目 DTS」心智 |
| D6 | Schema / vendor YAML | 辅助类型与文档；**缺 schema 不得隐藏**面内参数 |
| D7 | logical node / identity mapping | 可作为后端连续性；**不得**作为浏览/编辑前置条件 |

## 3. 可管参数面

### 3.1 定义

**参数面条目**须同时满足：

1. **业务相关**：所属节点是「受管节点」（§3.2），不是纯总线骨架。
2. **属性相关**：属性是「受管属性」（§3.3），不是设备树结构机械字段。
3. **身份足以支撑台账与写回**：能在项目维护的 DTS 文本中定位该属性并完成往返编辑。

`/parameters` 默认只列参数面。非面内容可为写回/解析保留，但默认不得出现在工作台主表与模块导航叶子中（技术诊断视图除外）。

### 3.2 受管节点（v1）

满足任一即可：

- 节点 `compatible`（或实例）可通过映射归入业务模块；或
- 是上述节点的子孙且承载业务属性（如 `hi6xxx_coul` 下的 `batt`）；或
- Admin 按 locator/label 显式标记为受管。

默认 **不受管**：`#address-cells` / `#size-cells` 所在纯骨架、仅作层级的总线容器、仅作 phandle 目标的中断/GPIO 控制器（除非 Admin 纳入模块）等。

### 3.3 受管属性（v1）

**默认排除：** `compatible`、`reg`、`status`（除非模块策略另开）、`#*-cells`、`ranges`、`interrupt-controller`、`gpio-controller`、纯结构布尔占位。

**默认纳入：** 受管节点上其余属性（含业务用 phandle 列表等）。

### 3.4 抽取与 binding

v1 可继续用现有解析 / resolve / binding 管线，再 **过滤** 成参数面供浏览/编辑。长期应将「参数面抽取」做成带测试的显式步骤。

## 4. DTS 维护契约

### 4.1 权威产物

每个项目维护一份或多份命名的 DTS 源文件，作为 **项目参数 DTS 交付物**（交给 Git 的文本）。产品文案说「项目 DTS」，而不是「config revision 工具链」。

### 4.2 参数变更时

1. 台账 + 草稿/评审/审计按既有治理意图保留。
2. **把新值精确写回**项目维护的 DTS 文本对应属性位置。
3. 产生新文件版本，保证导出始终是最新权威文本。

### 4.3 热路径不要求

- 创建草稿前跑完整 `dtc` + `fdtoverlay` + `dt-validate`
- 每个项目都必须提供合成共享 base 才能用
- 因缺 vendor schema YAML 而无法浏览面内参数

### 4.4 可选校验级别

| 级别 | 时机 | 行为 |
| --- | --- | --- |
| L0 | 写回时 | 解析往返 / CST 完整性 |
| L1 | 按需 / 导出 | 多文件 resolve 诊断 |
| L2 | 导出 / 发布 / Admin「发布校验」 | `dtc` / `fdtoverlay` / `dt-validate` 辅助门 |

日常改参→草稿→提交以及**治理合入/写回**使用 **L0**（L1 可软警告）。**L2 不对编辑或合入热路径 fail-closed。** 产品**不**把 `dtc` / `fdtoverlay` / `dt-validate` 规则当作参数维护门禁；工具链输出仅用于 Admin / 基线发布辅助。`/parameters` 工作台默认**不得**把工具链编译噪声（如 `ranges_format`、`unit_address_vs_reg`、空 `ranges` / `#address-cells` 不匹配警告）当作主要治理错误——默认 UI 只展示产品阻断项（拓扑未就绪、binding/schema/映射门禁、仍相关的 base 不完整等）。

## 5. 模块与驱动

用户模型：

```
模块 / 子模块
  └── 参数（名称 + 当前值 + 治理）
```

驱动仅用于 Admin 映射与详情「归类证据」，不是必选导航层。映射优先级仍为 instance > compatible > driver；未映射面内参数进「未分类」。

## 6. 对 2026-07-14 锁定项的修订

| 原锁定 | 2026-07-21 修订 |
| --- | --- |
| WiseEff 权威源；Git 人工 | **保留** |
| 合入强制 dtc/schema fail-closed | **修订** → L2 仅导出/发布与 Admin 校验；**不**挡编辑或合入/写回热路径 |
| 顶层粒度 = 板级配置集 + 基线 | **修订** → 用户粒度 = 项目 + 维护中的 DTS 文本；Config Set 内部化 |
| 完整结构化建模为产品中心 | **修订** → 结构化解析/写回仍是引擎；**产品中心 = 参数面 + 模块** |
| include 暂不支持 | **不变**（另开计划前） |

## 7. 非目标

- 一次改完整个 topology 库表
- 做成完整设备树 IDE
- WiseEff 自动 Git push/PR
- 覆盖全部 SoC vendor 的 dtschema

## 8. 成功标准

- 硬件用户可：打开项目 → 选模块 → 只见可调业务参数 → 编辑提交；无需学习 Config Set / base / overlay / 工具链词汇。
- 合入（或治理接受）后，导出的 DTS 含新值。
- 总线骨架属性默认不出现在工作台行。
- 工具链失败不挡草稿创建；可挡「发布校验」/ L2 导出。

## 9. 参考

- 英文 RFC 全文与对照表以 English 页为准。
- 裁剪矩阵：[`2026-07-21-dts-capability-cut-matrix.md`](2026-07-21-dts-capability-cut-matrix.md)
