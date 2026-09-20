# T2.4 真实 DTS 工具链 — 本地实现回执

> English: [English](../../../../exec-plans/active/849-inventory/t24-real-dts-toolchain-acceptance.md)

状态：**T2.4 本地候选完成。** 独立设计 Spec 先 FAIL 后 PASS with P2；实现 Standards PASS with P2 与 Spec PASS with P2（grok-4.6；要求的 gpt-5.6-luna 不可用）。不执行正式 SEALED、commit、PR、合并、Hosted、目标环境或 Issue 更新。

契约：[威胁矩阵](t24-real-dts-toolchain-threat-matrix.md)、[设计](t24-real-dts-toolchain-design.md)、[设计 Spec 评审](t24-real-dts-toolchain-spec-review.md)、[实现复审](t24-real-dts-toolchain-impl-review.md)、#849／#853 T2.4。

## 候选

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- 分支：`codex/849-853-t11-source-identity`
- HEAD（未改）：`f9c710f6a90d67462965a06abd47e33aa200e75e`
- 已接受 main：`46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1–T1.3 仍是同一树上的未提交脏工作。无 commit。

## 已交付行为

1. 钉扎真实工具：`dtc` 1.8.1、`fdtoverlay` 1.8.1、`dtschema` 2026.6（项目 venv 经 `npm run dts:toolchain:bootstrap`）。
2. `compileDtsSeedEffectiveTrees` 以 `board.dts` 为 entry，`charging-thermal.dts` 为唯一 overlay。JSON 与 `vendor-drivers.dts` 不进入。
3. dtc 1.8.1 对已提交的 `/plugin/; / { … }` 不发出 overlay fragment。Runner 只在 overlay 成员的临时输入里包装为 `fragment@0`／`target-path = "/"`／`__overlay__`。Git 源不变；L1 locator 仍是 `wiseeff_node_type_demo/charging_core/…`。
4. 临时 dangling-anchor 桩仍只作用于 **entry**。overlay 文件绝不是被加桩的 entry（注释 `&charging_core` 不铸造桩）。无已提交桩头，无持久化的 29 标签空基底。
5. Overlay 应用后的有效 DTB SHA-256（≠ 仅板级接收哈希）：
   - aurora `cacbf2c931f33ade9fba124b911f82908c2ce76756cd5a2dba1c740d063ee468`（仅板级曾为 `69b3fcdd…`）
   - nebula `aaaeea4b5ebff841a6df50e0e8344fcfed5806d8adac4cfc99b54c16f0207c82`（仅板级曾为 `c9b09708…`）
   - atlas `a0deb6cb64dd5d9b062bce02568c190a2b6ff599eed1ad13e813bd6602b72f59`（仅板级曾为 `e78751d4…`）
6. 生产源缺陷：生成器对 `/bits/ 8` 的十六进制 bump 按声明位宽掩码，nebula `rx_mod_cm_cfg` 保持 `0xfa` 而不是 `0xfffffffa`。空桩 `#gpio-cells` 警告仍是警告，不持久化为 SoC 节点。
7. Golden 对齐 T1.3 板级 `compatible` 增量：200 个属性／600 行 `dts_properties`。演示头未改。

## 验证（不可相加）

测试用 helper PG：`TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t13_successor`。不是 `wiseeff_lane_849`，不是 compose `5432/wiseeff`。

| 命令 | 结果 |
| --- | --- |
| `dts:toolchain:check -- --required` | dtc 1.8.1、fdtoverlay 1.8.1、dtschema 2026.6，versionsMatch true |
| `dtc:seed:compile` | ok；上面三个互不相同的有效哈希 |
| T2.4 核心 `test:server`（dtsToolchain、goldenPowerFixture、dtsPowerSeed、seedM1DtsFiles、seedM1DtsIntegrity、danglingAnchorStub、dtc-toolchain） | 7 文件，**48 passed** |
| `seedSources.fidelity` | **18/18 passed** |
| `seed:reconcile:check` | 当前 |
| `git diff --check` | 通过 |
| `docs:check` | 通过 |
| `npm run build` | 通过 |

不是完整 `test:server` 套件。不是 S1／S2、Hosted 或目标。本地编译不是目标资格。未重跑 T1.3 的 124／372：已提交 charging-thermal 字节和 locator 未改。

## 剩余限制（实现复审 P2）

- `compileDtsSeedEffectiveTrees` 的 overlay 成员关系由 `dtc:seed:compile` 证明，没有对该函数的专门单测。测试锁定的是 **源** 包装（临时文本里的 `fragment@0`），不是反编译 DTBO token。
- `/bits/` 掩码作用于十六进制 cell；十进制 `/bits/ 8` 仍使用已提交 nebula 中的有符号 `(-n)`。
- 空桩 `#gpio-cells`／默认 `#address-cells` 警告仍在。

无 commit／PR／seal。
