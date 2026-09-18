# T2.4 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t24-real-dts-toolchain-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna / max 不可用）
结论：**PASS with P2**

针对上次 FAIL（P1 overlay 语法对 T1.3 解析器／locator）的独立复审。中英对照已抽查决策对等。`parser.ts` 仍只接受 `&` + ident。已复核钉扎 `dtc`／`fdtoverlay` 1.8.1。不改生产代码；不把 T2.4 标为完成。先前 P1 **已关闭**。可以开始实现；下面 P2 随首次提交收口即可。

## P1

无未决项。

## P2

1. **T24-18 证据所有者与测试。** 设计 §3／§8 禁止对 overlay 跑 `missingReferencedLabels`，并要求测试注释 `&charging_core` 不铸造桩节点。矩阵 T24-18 仍把证据写成「单独编译 overlay 文件」。独立检查：对 atlas `charging-thermal.dts` 跑 `missingReferencedLabels` 会因注释得到 `charging_core`。若把该文件当加桩 **entry** 编译，会铸桩。把 T24-18 指到「overlay 从不是加桩 entry」，与 §8 一致。

2. **Golden 176／528。** 未变：T24-13／设计 §6 在门禁包含这些测试时更新 T1.3 遗留的 176／528 锁。待办 T2.4 并不要求 golden 身份。只用于门禁解阻；不是 124／372 变化。

这些不重开身份、124／372 或 B6。

## 已关闭的先前 P1（勿再打开）

提交 `&{/}` 会使 `parseDts` 抛 `Expected label after &`；提交 `fragment@0` 会把 locator 回退成 `fragment@0/__overlay__/wiseeff_node_type_demo/charging_core/…`。修订把 Git 源保持为 `/plugin/; / { wiseeff_node_type_demo { charging_core { … } } }`，只在工具链临时 overlay DTBO 输入里包装 `fragment@0`／`target-path = "/"`／`__overlay__`（与 entry 临时桩同类）。独立包装：atlas 有效 SHA-256 `a0deb6cb…` ≠ 仅板级 `e78751d4…`；反编译在 `wiseeff_node_type_demo/charging_core` 含 `fast-charge-profile-matrix`。解析器看不到临时输入。T24-03 禁止持久化两种改写。

## 已核对并接受

- 仅板级 `overlayOrder: []`；29 个唯一片段（`amba` 两次）、37 个缺失 `&name`、已定义 `batt`；无已提交桩头。
- 回合报告撤回：不提交 29 标签空基底。
- 演示头、NodeType 嵌套、JSON 排除、`vendor-drivers.dts` 不是 T2.4 板级、L1 不对悬空警告失败关闭、本地 ≠ 目标。
- 中英决策对等（临时包装、保持已提交 `/ { }`、`&{/}`／`fragment@0` 不进 Git、T24-18：不对 overlay 加桩）。共享这些 P2。

按设计 §3 在 `dtsToolchain.ts` overlay DTBO 路径做包装，并按 §8 证明 locator／桩。把 T24-18 证据所有者对齐到该测试。
