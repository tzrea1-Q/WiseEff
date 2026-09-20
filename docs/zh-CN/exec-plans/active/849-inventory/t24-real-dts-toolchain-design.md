# T2.4 真实 DTS 工具链 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t24-real-dts-toolchain-design.md)

配合[威胁矩阵](t24-real-dts-toolchain-threat-matrix.md)。T1.3 与 2026-09-15 回合报告撤回（不提交 29 标签空权威基底）已关闭的产品问题不再讨论。

状态：**设计 Spec PASS with P2（grok-4.6 复审）。** 实现本地候选：Standards PASS with P2，Spec PASS with P2。回执：[t24-real-dts-toolchain-acceptance.md](t24-real-dts-toolchain-acceptance.md)。

## 1. 改什么

复用既有 L2 runner（`createDtsToolchainRunner`：`dtc -@` → overlay DTBO → `fdtoverlay` → `dt-validate`）和临时桩所有者（`danglingAnchorStub.ts`）。不另加编译器。

| 缝 | 文件 | 变更 |
| --- | --- | --- |
| Overlay 编译包装 | `server/modules/parameter-files/dtsToolchain.ts`（overlay DTBO 路径） | **仅临时**：`/plugin/;` 且本体是根 `/ { … }`、没有 `fragment`／`__overlay__` 的 overlay，在隔离编译树里改写成指向 `/` 的可应用 fragment（`fragment@0` + `target-path = "/"` + `__overlay__`；`&{/}` **只允许出现在临时输入**）。已提交 charging-thermal 字节保持 `/ { wiseeff_node_type_demo { charging_core { … } } }`，L1 locator 仍是 `wiseeff_node_type_demo/charging_core/…`。与 entry 悬空桩同类：不进 Git、不进 config-set、不写回 |
| 有效树编译 | `scripts/compile-dts-seed.ts` | 以 `board.dts` 为 entry，`charging-thermal.dts` 为唯一 overlay。JSON 不进入。记录工具版本和 `effectiveDtbSha256` |
| 持久化证明 | dangling-stub／compile 测试 | 断言已提交 DTS 永不包含临时桩头；runner 仍只给 **entry** 加桩 |
| Golden | `goldenPowerFixture.test.ts`、`dtsPowerSeed.test.ts`、`seedM1DtsFiles.test.ts` | 若这些测试在 T2.4 门禁内，把仍锁 176／528 的断言对齐到 T1.3 实测的 200／600 |

无新 ADR。无新 SQL 迁移。不重写 T1.1 的 0151–0153。不改 T1.3 materialize／JSON／B6。

## 2. 最终 demo DTS 集合

每项目：

| 角色 | 路径 | 工具链 |
| --- | --- | --- |
| entry／base | `src/config/dts-seed/<project>-board.dts` | 临时 entry 桩之后 `dtc -I dts -O dtb -@` |
| overlay | `src/config/seed-sources/<project>/charging-thermal.dts` | `dtc -@` 成 DTBO，再 `fdtoverlay` |
| 非 DTS | `src/config/seed-sources/<project>/power-config.json` | 排除 |
| 不是 T2.4 板级 | `src/config/seed-sources/<project>/vendor-drivers.dts` | 排除（T1.3 板级加数是 `board.dts`） |

`compileDtsSeedEffectiveTrees` 今天传 `overlayOrder: []`，所以 `fdtoverlay` 从不跑第二个文件。T2.4 设 `overlayOrder: ["charging-thermal.dts"]` 并把该文件放进 `files`。

## 3. Overlay 应用（生产源缺陷）

接收：钉扎 `dtc` 1.8.1 下，已提交的 `/plugin/; / { wiseeff_node_type_demo { charging_core { … } } }` 编成无 fragment 的 DTB。`fdtoverlay` 退出码 0，有效哈希等于仅板级。热节点不存在。

初稿独立 Spec FAIL：把 `&{/}` 写入仓库会使 `parseDts` 抛出 `Expected label after &`（解析器只接受 `&` + ident），ingest 会丢掉 overlay。写入 `fragment@0` 能解析，但 locator 变成 `fragment@0/__overlay__/wiseeff_node_type_demo/charging_core/…`（T24-07 回退）。两种已提交改写都不能同时满足 T24-02 与 T24-07／T24-10。

**规定修复：** 已提交 overlay 本体保持根 `/ { wiseeff_node_type_demo { charging_core { … } } }`（T1.3 locator）。在工具链 overlay DTBO 步骤里，把该本体包装进 **临时** 编译输入：

```dts
/dts-v1/;
/plugin/;

/ {
	fragment@0 {
		target-path = "/";
		__overlay__ {
			wiseeff_node_type_demo { charging_core { /* 属性字节不变 */ } };
		};
	};
};
```

该包装是一次性编译伴侣（与 entry 悬空桩同类）。证明：临时 DTBO 含 `__overlay__`；有效 DTB 反编译在 `wiseeff_node_type_demo/charging_core` 含 `fast-charge-profile-matrix`；SHA-256 ≠ 仅板级接收哈希；已提交 charging-thermal 仍解析为两条 T1.3 locator。

不要改挂到 `&charging_core`。不要把 `&{/}` 或 `fragment@0` 作为 Git 源持久化。不要对 overlay 文件跑 `missingReferencedLabels`（注释里的 `&charging_core` 不得铸造桩节点 — T24-18）。

本 todo 拒绝全面给解析器加 `&{/}`（额外 ingest 面；有编译包装就不需要）。拒绝已提交 `fragment@0`（locator 回退）。

## 4. 临时桩保持临时

L1：未解析 `&label` 仍是 `dangling-reference` 警告并自锚。不失败关闭。

L2：`withEphemeralEntryCompileStub` 预置空节点标签，让 `dtc` 能链接仅 overlay 的板。桩 **不得** 写入 Git、config-set 成员、写回或导出。

T2.4「消除持久 dangling-anchor 桩」的意思是：证明没有已持久化的桩，并且不新增提交的 29 标签空基底。实测唯一 overlay 目标保持 **29**；缺失 `&name` 引用保持 **37**，除非有记录的源修复改变它们。

空的临时 `gpioN` 节点产生 `#gpio-cells` **警告**。它们不是生产错误，也不靠提交 SoC gpio-controller 节点来修。可选的 gpio-controller 文本只属于临时伴侣。

## 5. 源／主体归属与演示标识

保留 T1.3 板级 overlay 片段上已审的 `compatible`。NodeType `charging_core` 仍在 `wiseeff_node_type_demo` 下。板级与 charging-thermal 文件保留演示头。

不为 `amba`、`spmi`、`gpioN`、`gic` 推断新的 Driver 身份。

## 6. Golden

T1.3 给 24 个 overlay 片段加了 `compatible`。清单已记录 200 条原始属性／80 条结构／三板合计 600。仍锁定 **176** 属性和 **528** 行 `dts_properties` 的测试相对该板已过时。这些测试在门禁内时由 T2.4 更新。不要为了回到 176 而撤掉 24 个已审 compatible。

## 7. 授权、工具、环境

- 工具：既有解析器 + `npm run dts:toolchain:bootstrap` 安装钉扎 `dtschema` 2026.6。不另开只跑 dtc 的路径。
- 种子有效树模式可保持 `mode: "warn"`／`failOnSchema: false`（厂商绑定并不描述每个子节点）。Overlay **应用** 仍必须改变 DTB。
- 除非 overlay 语法意外改变业务 locator，否则不需要 helper PostgreSQL；若需要，在 55438／一次性库上重跑 T1.3 oracle，绝不用 `wiseeff_lane_849` 或 compose `5432/wiseeff`。
- 本地编译不是目标资格。

## 8. 证据

交付前必需：

- `npm run dts:toolchain:check -- --required`（dtc 1.8.1、fdtoverlay 1.8.1、dtschema 2026.6）
- 带 overlay 的 `npm run dtc:seed:compile`；JSON 输出记录三个与接收时仅板级哈希不同的有效哈希
- 测试：临时 overlay DTBO 有 overlay token；已提交 DTS 无桩头、无持久化的 `fragment@0`／`&{/}` 包装；ingest locator 仍是 `wiseeff_node_type_demo/charging_core/…`；注释 `&charging_core` 不铸造桩节点
- 门禁内的受影响 golden
- DTS 字节变化时 `seed:reconcile:check`
- `git diff --check`
- 独立 Standards + Spec 实现复审
- 中英验收回执

不是 S1／S2、Hosted 或目标。

## 9. 实施顺序（Spec PASS 之后）

1. 在工具链 runner 里做临时 overlay-fragment 包装；证明 fdtoverlay 应用热节点；已提交 overlay 字节和 L1 locator 不变。
2. 接通 `compileDtsSeedEffectiveTrees` 混合成员（board + overlay）。
3. 持久化／归属测试。
4. 若跑这些测试，对齐 golden 200／600。
5. 独立实现复审；中英回执；停止。

## PR 计划

本 todo 不开 PR。本地候选留在 `codex/849-853-t11-source-identity`，与 T1.1–T1.3 脏工作共存。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | 临时 overlay-fragment 包装 | `dtsToolchain.ts` + 测试 | Spec PASS |
| B | 有效树 overlay 接线 | `compile-dts-seed.ts` + 测试 | A |
| C | 持久化与归属证明 | stub／compile 测试 | B |
| D | Golden + 中英回执 | golden 测试、T2.4 回执 | C |
