# T2.2-OPS 运维消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-ops-operations-consumers-threat-matrix.md)

契约：#849/#853 T2.2-OPS、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) Operations 行、[清单](../../../../references/parameter-catalog-contract-inventory.md) Release/operations 行、T2.2-MOD [回执](t22-mod-module-consumers-acceptance.md)。产品方向已定。本矩阵冻结 OPS 实施边界。

状态：**Spec PASS with P2 已收口。** 配套：[可实现设计](t22-ops-operations-consumers-design.md)。独立评审 `01a0b06f-3a18-7c44-9e2d-8f1b47c0a5e6`。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。T1.1–T2.2-MOD 脏候选除 OPS 路径外不重写。
- 允许路径：`server/modules/operations/**`、`scripts/reconcile-parameter-definitions.ts`、其测试、`s12-ops.json`。不抢 T1.4。
- 用户已解除逐项「确认」；本家族完成后可开 T1.4。仍不 commit／PR／目标机／破坏性删除／Issue。
- 不做 UI 扫描。
- 评审 grok-4.6（gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。

## 受保护不变量

本家族调度／后台／脚本／重启路径使用 **canonical 所有者**（S7-ORC inspect、S10-PER `readReport`、S8-LEG 类型化 lookup）。**不能 reseed** 项目 binding，也**不能把归档状态写成当前**。`--apply`／结构 reconcile 写是 **410 gone**。操作 CLI **不得** import `parameter-specs` 的 definitionReconciliation／definitionVerification。诊断只做类型化读；不调用公开 raw／governance HTTP，不重分类 R6／R8。

## 接收（2026-09-18 实测）

分片合计仍 **3513**。S12-OPS **4** 条、**2** 组，全在 `scripts/reconcile-parameter-definitions.ts`（module-import 2 + effective-governance-contract 2）。

现场泄漏：CLI 仍 import `reconcileDriverParameterDefinitions` 与 `verifyEffectiveDriverParameterDefinitions`。`--verify` 用未调用的函数当 truthy 门。`--apply` 已 410。inspect／legacy 已走类型化 OPS 读者。

`seedInitialization`／publication installer 的重启重装属 **T1.4**。

## 归类冻结

| 类 | OPS 含义 | 本 todo |
| --- | --- | --- |
| Canonical current — inspect／verify／legacy／apply-gone／health | 类型化读与 410 | 保持；删死 import |
| Exact canonical history | CLI／比较测试 | 保持／改 import 断言 |
| Archived notice | `parameter-specs` reconcile／verify import | **删除** |

## 行

T22O-01 清单 4 条。T22O-02 无 parameter-specs import。T22O-03 永不调用 `reconcileDriverParameterDefinitions`，`--apply` 保持 410。T22O-04 `--verify` 只用 `readTypedVerificationReport`。T22O-05 legacy lookup 不把归档写成当前。T22O-06 health 不 materialize／seed。T22O-07 ratchet 相对 4／3513；修完仍留 parameter-specs import 即 Spec 失败。T22O-08 无 UI。T22O-09 55438。T22O-10 非目标：T1.4、T2.1／TOP fixture、commit。

## 非目标

- checker 不能完成时清零 4 条。
- 410 overlay／governance／parameter-modules。
- 改写 `seedInitialization`／installer（T1.4）。
- Commit、PR、Hosted、目标机、Issue。

## 自审限度

由协调实施者撰写。生产改动前必须独立 Spec 评审。
