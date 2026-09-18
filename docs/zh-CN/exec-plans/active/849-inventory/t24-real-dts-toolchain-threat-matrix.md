# T2.4 真实 DTS 工具链 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t24-real-dts-toolchain-threat-matrix.md)

契约：#849、#853 T2.4、[ADR-0046](../../../design-docs/adr-0046-source-occurrence-identity-spans-dts-and-software-configuration.md)、T1.3 [设计](t13-complete-successor-design.md)／[回执](t13-complete-successor-acceptance.md)。产品方向（对最终 demo 基底使用真实 `dtc` + `fdtoverlay`、不持久化 dangling-anchor 桩、保留演示标识、证明源／主体归属、在后续 UI／目标前修复生产源缺陷）已经决定。本矩阵冻结剩余实施边界。

状态：**设计 Spec PASS with P2。实现本地候选：Standards PASS with P2，Spec PASS with P2。** 配套：[可实现设计](t24-real-dts-toolchain-design.md)、[回执](t24-real-dts-toolchain-acceptance.md)。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- 继承 HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`；已接受 main `46b6068693942b95f7cba28ee5de6748a97170fa`。T1.1–T1.3 仍是未提交脏候选，不重写。
- 风险 **R3**。生产修改前须对本矩阵和设计做独立 Spec 评审。本地转绿后再做独立 Standards 与 Spec 实现复审。
- T2.4 本地交付后停止。不做 T2.1 UI、T2.2 消费者、commit、PR、合并、Hosted、目标或 Issue 变更。
- 要求的独立评审模型 `gpt-5.6-luna`／`max` 不可用；评审者使用 `grok-4.6` 并必须披露替换。

## 受保护不变量

Atlas／Aurora／Nebula 的每一份最终 demo DTS 基底都用钉扎的真实 `dtc` 1.8.1 与 `fdtoverlay` 1.8.1 编译。`charging-thermal.dts` 作为真实 overlay 应用，不是字符串拼接，也不是空操作 DTBO。临时 dangling-anchor 桩仍只是编译伴侣：绝不进入 Git 成员、config-set 成员、写回或导出。Overlay 片段保持 T1.3 已审源／主体归属。未解析 `&label` 保持实测并铸造零绑定。演示头保留。导致 overlay 应用或编译失败的生产源缺陷要修。T1.3 Binding 身份 **124×3=372** 不变。

## 接收（实测，2026-09-17）

`npm run dts:toolchain:bootstrap` 之后钉扎工具：`dtc` 1.8.1、`fdtoverlay` 1.8.1、`dtschema` 2026.6。仅板级文件的 `npm run dtc:seed:compile` 为 `ok: true`，使用临时桩且 **`overlayOrder` 为空**。仅板级有效 DTB SHA-256：aurora `69b3fcdd…`、nebula `c9b09708…`、atlas `e78751d4…`。

Atlas 板：**29** 个唯一 overlay `&label` 目标（30 个片段，`amba` 出现两次），**37** 个缺失 `&name` 引用，一个已定义标签（`batt`）。与清单 `danglingOverlayTargetsPerBoard: 29`／`missingReferencedLabelsPerBoard: 37` 一致。已提交文件不含临时桩头。

`charging-thermal.dts` 为 `/plugin/; / { wiseeff_node_type_demo { charging_core { … } } }`。用 `dtc -@` 编译得到 324 字节常规 DTB，**没有** `__overlay__`／`fragment`／`target-path`。`fdtoverlay` 退出码 0，有效哈希与仅板级 **相同**（atlas 为 `e78751d4…`）。把该本体 **临时** 包装为 `fragment@0`／`target-path = "/"` 后 DTBO 含 `__overlay__`，新哈希（`a0deb6cb…`）反编译含 `fast-charge-profile-matrix`。禁止把 `&{/}` 写入仓库：`parseDts` 会抛 `Expected label after &`。写入 `fragment@0` 会回退 locator。该空操作是 **工具链 overlay 编译缺陷**，不是改提交语法。

空的临时 `gpioN` 节点产生 `dtc` **警告**（`#gpio-cells`），不是错误。`danglingAnchorStub.ts` 已声明不保证 phandle-cell 形状。

## 行

| ID | 维度 | 预期观察 | 证据所有者 |
| --- | --- | --- | --- |
| T24-01 | 真实工具 | 钉扎 `dtc` 1.8.1 与 `fdtoverlay` 1.8.1 编译每一份最终 demo DTS 基底。`dts:toolchain:check -- --required` 当前。T2.4 证据不用桩校验器 | `dts:toolchain:check`、`dtc:seed:compile` |
| T24-02 | Overlay 应用 | 每项目 entry 为 `board.dts`，`overlayOrder` 为 `[charging-thermal.dts]`，不含 JSON。有效 DTB SHA-256 ≠ 仅板级哈希。反编译含 `wiseeff_node_type_demo`／`fast-charge-profile-matrix`／`battery-thermal-derate-curve` | `compileDtsSeedEffectiveTrees` |
| T24-03 | Overlay 编译包装 | 已提交 charging-thermal **保持** `/plugin/; / { wiseeff_node_type_demo { charging_core { … } } }`（T1.3 locator）。工具链 overlay DTBO 步骤在临时输入里把该本体包装为 `fragment@0`／`target-path = "/"`／`__overlay__`。此处禁止把 `&{/}` 或 `fragment@0` 写入仓库（`parseDts` 拒绝 `&{/}`；`fragment@0` 回退 locator）。临时 DTBO 有 overlay token；Git 源没有 | runner 包装 + 解析器 locator + DTBO token 检查 |
| T24-04 | 仅临时 | `EPHEMERAL toolchain stub`／合成的 `label: label { };` 伴侣永不出现在 `src/config/**/*.dts`、config-set 成员、写回或导出。Runner 仍只给 **entry** 加桩 | grep + `danglingAnchorStub`／工具链测试 |
| T24-05 | 不伪造基底 | T2.4 **不**提交 29 标签空权威基底。回合报告的撤回仍然有效。SoC gpio／总线脚手架不升为业务身份 | diff 审查 |
| T24-06 | 悬空诚实 | 每板唯一 overlay 目标保持 **29**，缺失 `&name` 引用保持 **37**，除非有记录的源修复改变它们；新计数要记下。它们铸造零 canonical 绑定 | 清单 + 既有 124 oracle |
| T24-07 | 源／主体归属 | 板级 overlay 片段保持 T1.3 已审 compatible。NodeType `charging_core` 仍嵌在 `wiseeff_node_type_demo` 下，与 `&charging_core`／`huawei,charging_core` 不同。两个热属性 locator 不回退 | 种子保真 + overlay 反编译 |
| T24-08 | 演示标识 | 板级与 charging-thermal 头仍是演示源，不是真实设备固件 | 源文件头 |
| T24-09 | JSON 不进 dtc | `power-config.json` 不是 dtc／fdtoverlay 输入 | compile seed 加载器 |
| T24-10 | 绑定守恒 | T1.3 的 124／372 不变。Overlay 语法修复不得把热节点改挂到板级 driver | 仅当 DTS 业务字节变化时跑 t13 oracle |
| T24-11 | 产物证据 | 回执记录精确工具版本、每项目 `effectiveDtbSha256`，以及 overlay 应用改变了哈希 | `dtc:seed:compile` JSON |
| T24-12 | 警告对缺陷 | 空桩 `#gpio-cells`／默认 `#address-cells` 警告不持久化为 SoC 节点。可选的临时 gpio-controller 增强仍只在临时伴侣里。已提交字节中的 `dtc` **错误**是缺陷，要修 | 编译诊断 |
| T24-13 | Golden | T1.3 给 24 个板级片段加了 `compatible`（176→200／528→600）。T2.4 在门禁包含这些测试时，更新仍断言 176／528 的锁定 golden | `goldenPowerFixture`、`dtsPowerSeed`、`seedM1DtsFiles` |
| T24-14 | 本地 ≠ 目标 | 本地编译不是目标机资格、Hosted 或 `wiseeff_lane_849` | 回执 |
| T24-15 | L1 不变 | 未解析 `&label` 仍是 L1 `dangling-reference` **警告**（自锚）。T2.4 不因这些警告让普通 ingest 失败关闭 | 保留 `configSetResolver` 测试 |
| T24-16 | 板级基底 | T2.4 板级输入是 `src/config/dts-seed/<project>-board.dts`，不是生成的 `vendor-drivers.dts` | compile 加载器 |
| T24-17 | 既有 runner | 使用 `createDtsToolchainRunner`（dtc → DTBO → fdtoverlay → dt-validate）。引导 `dtschema` 2026.6，不另开只跑 dtc 的路径。种子有效树模式可保持 schema 咨询（`failOnSchema: false`） | runner + bootstrap |
| T24-18 | 注释引用 | charging-thermal 注释里的 `&charging_core` 不得铸造 overlay 桩节点。overlay 文件绝不是被加桩的 entry；不对 overlay 成员跑 `missingReferencedLabels` | overlay 绝不是被加桩的 entry |

## 非目标

- T2.1 UI、T2.2 消费者、T2.3 处置、T3.x S1／S2／Hosted／目标。
- 让 L1 ingest 对悬空 overlay 目标失败关闭。
- 把临时桩持久化为 config-set 成员。
- TD-124 YAML／TOML／ENV。
- 新 SQL 迁移或重写 0151。
- Commit、PR、合并、Hosted、目标、Issue 变更。

## 自审限度

本矩阵由协调实现者撰写。生产修改前必须独立 Spec 评审；本文件不是那次评审。
