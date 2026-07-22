# DTS 参数管理现状评估与问题清单

> 本文是一份**现状评估 / 问题清单**，作为后续「DTS 参数管理重构」实施计划的正式输入。它只描述问题、定位决策与目标模型草图，**不包含实施步骤**（实施细节见后续 `docs/exec-plans/active/` 计划）。

- 日期：2026-07-14
- 范围：参数管理（M1）+ 项目参数文件（`server/modules/parameter-files/`）子域对 DTS/JSON 树状配置的管理能力
- 触发：对「WiseEff 能否胜任真实 DTS 文件管理」的深度审查，输入为一份覆盖 31 类 DTS 格式的教学范例

> **2026-07-21 产品边界修订：** §2「定位决策」中关于「合入强制 dtc/schema fail-closed」「顶层粒度=板级配置集」「完整结构化建模为产品中心」等锁定项，已被 [`2026-07-21-dts-parameter-surface-boundary-rfc.md`](2026-07-21-dts-parameter-surface-boundary-rfc.md) §6 修订。本文保留为历史问题清单；**现行产品边界以该 RFC 与裁剪矩阵为准**。实现见 [`../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`](../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md)。

---

## 1. 背景与结论

WiseEff 的一个核心目标是管理各项目的配置参数，其中最主要的一部分是 **DTS 文件**。经过对领域模型、参数数据模型、参数文件子域、解析器与同步/回写逻辑的检查，结论是：

**当前设计无法满足真实 DTS 文件管理的诉求。** 现有实现本质上是一个「组织级、二级（module → 参数）、参数=单值原子」的扁平键值目录，加上一个把文件解析成 `nodePath → 字符串值` 的浅解析器。它对「JSON 全量文件」和「结构极简的 DTS 片段」够用，但对真实 DTS（带地址节点、overlay 引用、include、类型化值、跨节点引用）会**静默丢弃、错误解析，或在回写时损坏文件**。

问题分三层，且**层层独立**：即使上一层修好，下一层的问题依然存在。

1. **解析层**：读不对。
2. **数据模型 + 兼容性层**：即使读对了也存不下、对不齐。
3. **产品功能层**：即使存对了，作为「DTS 配置管理产品」的关键功能闭环仍缺失。

团队已在技术债 `TD-035` / `TD-039` 中承认「完整 `.dts` 解析 + AST 写回」未实现；本评估认为问题的**严重性被低估**——不仅是功能不全，而是会**产生错误数据且用户无从察觉**。

---

## 2. 定位决策（已锁定）

制定计划前，以下产品定位问题已确认：

| # | 决策项 | 结论 |
| --- | --- | --- |
| 1 | 事实来源 | WiseEff 为 **DTS 参数的权威源**：开发人员在此公开、显性地管理各项目 DTS 参数；**所有合入必须经过 WiseEff**；WiseEff 始终维护「最新的一份 DTS」。真正的发布由软件人员通过 **Git 手动提交**（Git 提交集成为后续功能，当前不做）。因此当前必须能**无损导出**权威 DTS 供提交。 |
| 2 | 校验门禁 | 合入前**强制通过 dtc 编译 / schema 校验**。 |
| 3 | 顶层管理粒度 | **项目 → 板级配置集（可构建单元）+ 发布基线**。 |
| 4 | include 支持 | **当前暂不支持** `/include/`；上传含 `/include/` 的文件应**明确标记为「暂不支持」并拒绝进入同步**，而非静默忽略。 |
| 5 | 建模方向 | 采用**完整结构化建模**（真解析器 + AST/CST + 节点树 + 类型化值 + 无损回写），而非继续扁平键值方案。 |

### 名词说明

- **板级配置集（board config set）**：一份可编译出 DTB、可运行的板级配置通常不是单个文件，而是**一组相关文件的组合**（base + 多个 `.dtsi` + overlay）。配置集是「能否编译」「跨文件引用」「变体管理」的最小单元。dtc 校验门禁必须建立在配置集层面。
- **发布基线（release baseline）**：对整套配置在某时间点冻结的、带标签的**全量参数快照**（对应一次 Git 提交/一个里程碑）。支持：与当前工作区对比、原子整体回滚、发布标记与可追溯。

---

## 3. 第一层：解析问题

核心解析逻辑位于 `server/modules/parameter-files/parseIndex.ts`（以及前端 `src/application/parameters/import/parseDtsFragment.ts`），标识符字符集为 `[a-zA-Z0-9_-]+`。已确认的缺陷：

| 问题 | 说明 | 影响 |
| --- | --- | --- |
| 注释不剥离 | `/* */`、`//` 未被去除 | 注释内的 `prop = <..>;`、速查表、示例被当作**真实属性**抽取，凭空造出错误参数（最严重） |
| 布尔/空属性不可见 | 解析器强制标识符后必须有 `=`（`parseIndex.ts` 中 `if (source[cursor] !== "=") continue`） | `weak_source_sleep_enabled;`、`ranges;` 等**永远无法被管理**（范例 #9、#20） |
| `/include/` 不展开 | 被当噪声跳过 | 被包含 `.dtsi` 的参数完全不可见（范例 #2；已决定当前不支持，但需显式拒绝） |
| `@address` 不在标识符集 | `chip@6E` 中 `@` 不匹配 → `chip` 被跳过、`6E` 被当作节点名 | 节点名/地址丢失且碰撞：`battery_checker@0/@1`→`0`/`1`，`bypass_chip@77/@75`→`77`/`75`（范例 #10/#11/#31，致命） |
| `&label` 前缀丢失 | `&` 不匹配，靠巧合解析 | overlay 引用身份丢失 `&`（范例 #4） |
| 内联 label `label:name` | `my_batt:batt_cell` 记为 `batt_cell`，而 `&my_batt` 记为 `my_batt` | **同一物理节点分裂成两个身份**，破坏 overlay 合并语义（范例 #26/#27） |
| 多 `<>` 逗号组丢数据 | `<1 2600>,<2 2800>` 只读到第一个 `>` 即返回 | `,<2 2800>` 丢失，后续游标错乱（范例 #25，数据丢失） |
| 多行值回写损坏 | 回写正则 `([^;\n\r]*)`（`writebackService.ts` 的 `patchDtsProperty`）不允许换行 | 多行矩阵/字符串表回写失败或写坏文件（范例 #5/#6/#18） |
| `/bits/` 前缀污染值 | `readPropertyValue` 对 `/bits/ 8 <..>` 走 `readUntilSemicolon` | 值内含 `/bits/ 8`（范例 #7） |
| `vendor,prop` 截断 | `,` 不在标识符集 | `vendor,led-type` 被截成 `vendor`（范例 #28） |

---

## 4. 第二层：数据模型与兼容性问题

即使解析正确，目标模型的**形状也不是树**。相关实体：

- `parameter_definitions`（org 级共享，身份实际为 `(name, module)`，见 `server/migrations/0002_m1_parameters.sql`）
- `project_parameter_values`（`(project_id, parameter_definition_id)` 唯一，单个 `current_value` 字符串 + 单个 `source_node_path`，见 `server/migrations/0041_project_parameter_files.sql`）
- `parameter_modules`（org 级分类树，`server/migrations/0039_parameter_modules_tree.sql`）
- 匹配逻辑 `findProjectValueByDefinition` / `findProjectValueBySource` 均为 `limit 1`（`server/modules/parameters/repository.ts`）

### 4.1 结构性错配

| 问题 | 说明 |
| --- | --- |
| 二级 vs 任意深度 | 身份是 `(name=叶子, module=路径拼接)`；`amba/i2c@../chip@6E/sub_module/param_a` 被压成两级。`parameter_modules` 是人工治理树，与文件结构语义/深度均不同 |
| 值是单串 | 自描述表（#18）、间接引用组（#17）、多行矩阵（#5）退化为不透明 blob，无法按行/列/元素寻址、diff、校验 |
| JSON 数组不透明 | `parseIndex.ts` 的 `walkJson` 只递归纯对象，数组/标量都 `JSON.stringify` 成叶子 → 数组元素不可单独管理，重排即假 diff |
| 基数假设错误 | 「一个定义 ↔ 一个值 ↔ 一个节点路径」无法表达编号序列（`volt_para0..31`，#19）与多实例（`@0/@1`、`@77/@75`）；`(name, module)` + `limit 1` 会**碰撞/串数据** |
| 无「节点」一等实体 | 无法表达 `@address`、`label`、`compatible`、父子边、兄弟顺序，以及节点级 `status=disabled` 启停 |

### 4.2 兼容性维度（DTS 特有，全缺）

| 维度 | DTS 含义 | 现状 |
| --- | --- | --- |
| 板级/变体 | 不同板结构不同；同芯片不同地址；同名不同义 | ❌ 全局定义 + 跨项目复制初始化（`src/domain/parameters/initialization.ts`），假设参数可移植 |
| 驱动绑定 | `compatible`/phandle/`-supply`/`#address-cells` 是 DTS↔驱动契约 | ❌ 全当普通字符串；无引用存在性/绑定影响/cell 数匹配校验 |
| 引用可解析 | overlay `&label` 指向不在文件内的基线树 | ❌ 无基线树/目标内核模型，悬空引用无法发现 |
| 结构演进 | 节点增删/改名/迁址 | ❌ 只有值历史（`parameter_history_entries`），无结构/schema 历史 |
| 类型/约束 | 节点级类型/范围；`init_para_col=<14>` 约束列数 | ❌ `unit`/`default_range`/`config_format` 为全局自由文本，跨字段不变量无法表达 |
| 编码等价 | 多写法等价（`0xb`/`0x4B`、`<1 2>,<3 4>`、`ok`/`okay`） | ❌ 无类型 → 等价重排被判为变更（假 diff），真正不兼容反而抓不到 |

> 附：`project_parameter_files.module_hint` 只能指向单个模块，但一个 DTS 文件横跨多个子系统（文件↔模块本应多对多）。

---

## 5. 第三层：最终产品功能问题

即使存储正确，作为「管理 DTS 配置的权威源产品」，以下功能闭环缺失（已确认参数模块无 `dtc`/`validate`/`compile`/`baseline`/`release` 逻辑）：

| # | 功能方向 | 现状 | 影响 |
| --- | --- | --- | --- |
| 1 | 可构建性/校验门禁 | 无 dtc 编译 / schema 校验，非法值照单全收并回写 | 可能产出编译不过/跑挂设备的配置，合入前无人拦截（**权威源定位下最致命**） |
| 2 | 复杂值结构化编辑器 | 值统一为文本框 | 表/字节数组/phandle/布尔/枚举只能手敲，极易出错、无字段级校验 |
| 3 | 结构化变更集 + 差异 | 差异为标量/行级（`comparison.ts` 的 `baseNumeric/targetNumeric`、`textDiff`） | 横跨多节点多文件的逻辑变更无法聚成一个可审阅单元；审阅者看不出改了哪行/哪节点 |
| 4 | 检索 + 影响分析 | 仅按 `name/description/explanation` 模糊；`impact` 为人工/占位 | 重名参数检索无区分度；无法沿 phandle/compatible/变体推导影响面 |
| 5 | 节点级/安全权限 | 仅项目 + 模块级 RBAC | 无对安全关键节点（regulator/thermal/限流）的分层门禁；AI（小择）可写参数，误改风险放大 |
| 6 | 事实来源/无损导出 | 内部对象存储副本，Git 集成为非目标 | 权威源必须能无损导出（保注释/格式/顺序）供软件人员提交 Git；否则导出噪声 diff 甚至编译不过 |
| 7 | 配置集/发布基线/回滚 | 无；版本历史为每文件/每值粒度 | 无可构建单元、无里程碑快照、无一键整体回滚 |
| 8 | 规模/并发 | 2MB 上限、`parsed_index` 单 JSONB blob、整文件版本 + 二选一裁决 | 真实板级 DTS（含 include 展开）可达数万属性；粗粒度并发冲突 |

---

## 6. 目标顶层模型草图

基于第 2 节决策，目标实体链（细节留待实施计划）：

```
项目 (project)
  └── 板级配置集 (board config set)   ← 可构建单元；变体关系；dtc/schema 校验门禁挂此层
        ├── 文件 (file) + 文件版本 (file version, 保留 CST 以无损回写)
        │     └── 节点树 (dts_node: parent, name, unit_address, labels[], compatible, status, order)
        │           └── 类型化属性 (dts_property: value_type, raw_text, normalized_value)
        │                 └── phandle 引用 (节点间引用, 供完整性检查)
        └── 发布基线 (release baseline)  ← 横切配置集的全量冻结快照；对比/原子回滚/发布标记
```

配套要点：

- 结构归属 `(配置集/文件版本)`，**不再**由 org 级全局定义充当结构与身份来源；`parameter_modules`/`parameter_definitions` 降级为**可选的跨项目归类/对齐视图**（多对一映射）。
- 值分层类型化：`u32-array | bytes | string-list | phandle-list | bool | mixed`；diff 用类型感知的规范化比较（可借鉴 debug 侧 `valueFormat`/`normalizationMode`，见 `docs/design-docs/domain-model.md` §Debug Value Metadata）。
- 「一个逻辑参数 ↔ 多处结构占位」通过序列/实例模板表达（编号序列、多实例）。
- 契约类属性（`compatible`/phandle/`-supply`/cells）设为一等语义，提供引用存在性与变更影响检查。
- 文件版本升级产出**结构变更集**（增/删/改名/迁址），而非一堆 `unmatched`。
- 无损导出（CST）作为权威源硬性要求；dtc/schema 校验需要工具链沙箱。

---

## 7. 范例 31 类格式覆盖矩阵（当前实现）

| # | 格式 | 现状 | # | 格式 | 现状 |
| --- | --- | --- | --- | --- | --- |
| 1 | `/dts-v1/` `/plugin/` | 忽略（可接受） | 17 | 间接属性名引用 | ❌ 无语义 |
| 2 | `/include/` | ❌ 不展开（决定不支持，需显式拒绝） | 18 | 自描述表列数 | ❌ 无校验 |
| 3 | 根节点 `/ {}` | ⚠️ 勉强 | 19 | 编号属性序列 | ⚠️ 无「序列」概念 |
| 4 | `&label` 覆盖 | ⚠️ 靠巧合，`&` 丢失 | 20 | `#address-cells`/`ranges` | ❌ `ranges` 空属性不可见 |
| 5 | 整数/多行矩阵 | ⚠️ 读可，回写❌ | 21 | 负数 | ⚠️ 裸串 |
| 6 | 字符串数组/多行 | ⚠️ 读可，回写❌ | 22 | 十六进制大小写 | ❌ 假 diff |
| 7 | `/bits/ 8 <>` | ⚠️ 值含 `/bits/` | 23 | 多 phandle 列表 | ⚠️ 裸串 |
| 8 | phandle `<&x>` | ⚠️ 裸串，无完整性 | 24 | 注释 | ❌ 不剥离，污染索引 |
| 9 | 布尔/空属性 | ❌ 完全不可见 | 25 | 多 `<>` 逗号拼接 | ❌ 丢数据 |
| 10 | `name@address` | ❌ 名/址丢失 | 26 | 同节点多次覆盖 | ❌ 无合并语义 |
| 11 | 同名多节点 `@0/@1` | ❌ 碰撞覆盖 | 27 | 内联 `label:name` | ❌ 身份分裂 |
| 12 | 标签变体 `_1/_swi` | ⚠️ 部分 | 28 | `vendor,prop` | ❌ 逗号截断 |
| 13 | 多层嵌套 | ✅ | 29 | 浮点字符串 | ⚠️ 裸串无校验 |
| 14 | `compatible` | ⚠️ 裸串 | 30 | `"6\|9\|10"` | ❌ 无语义 |
| 15 | `-supply` | ⚠️ 裸串 phandle | 31 | 同 compatible 多实例 | ❌ 地址碰撞 |
| 16 | kebab/snake | ✅ | | | |

---

## 8. 关联技术债

- `TD-035`（参数导入）：P2 完整 `.dts` 解析 + 节点路径模块建议。
- `TD-038`（模块）：过渡期扁平 `module` 文本列与 `project_modules` 对账残留。
- `TD-039`（参数文件）：P2 完整 DTS 解析 + AST 写回。

本评估建议将上述债项**并入统一的结构化重构计划**，而非零散偿还。

---

## 9. 后续

- 下一步：基于本评估在 `docs/exec-plans/active/` 制定分阶段实施计划（含新表设计、迁移与回滚、与现有 M1 参数流/审阅流衔接、dtc 校验沙箱、验证矩阵、文档影响矩阵）。
- 分阶段建议顺序（供计划参考，非承诺）：P0 解析止血（剥注释、拒不支持构造、多行回写保护）→ P1 真解析器 + 节点树 + 类型化值 → P2 配置集 + 发布基线 + dtc 校验门禁 → P3 结构化编辑/差异/影响分析 + 无损导出。
