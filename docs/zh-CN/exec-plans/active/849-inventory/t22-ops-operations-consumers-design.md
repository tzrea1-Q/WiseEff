# T2.2-OPS 运维消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-ops-operations-consumers-design.md)

配套[威胁矩阵](t22-ops-operations-consumers-threat-matrix.md)。操作 CLI 与 operations HTTP 使用类型化 inspect／verify／legacy-lookup。`--apply` 保持 410。无 parameter-specs reconcile／verify import。不 reseed，不把归档复活为当前。

状态：**Spec PASS with P2 已收口。** 独立评审 `01a0b06f-3a18-7c44-9e2d-8f1b47c0a5e6`。可以实施。

## 1. 本 todo 做什么

给 S12-OPS（4）归类。修：`scripts/reconcile-parameter-definitions.ts` 仍 import `parameter-specs` 并把未调用的 verifier 当 `--verify` 的 truthy 门。Apply fail closed。不抢 T1.4。

| 缝 | 今日所有者 | T2.2-OPS |
| --- | --- | --- |
| CLI `--apply` | 已 `catalogLegacyGoneResult` | 保持 410 |
| CLI `--verify` | 未调用的 `verifyEffectiveDriverParameterDefinitions` && typed report | **只用 S10-PER `readTypedVerificationReport`** |
| CLI inspect／`--legacy-*` | 类型化 OPS 读者 | 保持 |
| `parameter-specs` import | 死 import | **删除** |
| Operations HTTP | health／ready | 保持；不 seed |
| 分片外 jobs | seedInitialization、installer | **T1.4** |

## 2. 归类方法

按 `file`×`rule`。标签：canonical-current-inspect／verify／legacy-lookup／apply-gone／health、exact-canonical-history、archived-notice（parameter-specs import）。

## 3. Spec PASS 后的修复

**A.** 删除 `definitionReconciliation`／`definitionVerification` import。`--verify` **只用** `readTypedVerificationReport`。S10-PER 在编译期缺失则 fail closed（不回退 `definitionVerification`，不造 fake adapter）。运行时缺失／未批准报告是 S10-PER 带标记的 absent（`kind: "absent"`，`missing`／`unapproved`），永不 stub `ready`。`DATABASE_URL` 仍必需。`--catalog-only` 只是 `--verify` 的解析约束，不选择旧 catalog-only verifier。`--dry-run` 保持 inspect，不是 reconcile dry-run。不要保留 `await verifyEffectiveDriverParameterDefinitions &&`。不要调用 `reconcileDriverParameterDefinitions`。永不调用公开 raw／governance HTTP。

**B.** 保持 `--apply` 410 测试。断言生产脚本源不含 `parameter-specs`、`reconcileDriverParameterDefinitions`、`verifyEffectiveDriverParameterDefinitions`。

**C.** 不 410 overlay／governance／module 路由。不改 T2.1／TOP fixture。不改写 Scratch 0151–0153。本家族成为本地候选后再开 T1.4。

## 4. Ratchet

实施 A–B。Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` 若能跑完。若 T2.2-TOP `editService.ts` relocation 仍挡住，记录错误，不改那些 fixture。只删已消失的 **OPS** 分片。回执：OPS 前 **4**，合计前 **3513**。

修完仍留 `parameter-specs` import 即 Spec 失败，即使 delta ≠ 0。诚实零增量仅当 import 已消失且 checker 被挡住。

## 5. 证据

`test:scripts` 针对 reconcile CLI 测试；比较贡献若未改也跑一次。`git diff --check`。无 UI 扫描。独立 Standards + Spec 实现复审。Helper PG 55438。

## 6. Spec PASS 后的顺序

1. 删 import + 修 `--verify`。
2. 源 import 测试。
3. 可跑则 checker／OPS 分片 ratchet。
4. 回执；评审；然后 T1.4。不 commit。

## 关键决策

1. 只做类型化读。
2. Apply 是 410，不是 reconcile dry-run。
3. 死 import 就是泄漏。
4. Reseed 若在 `seedInitialization`／installer 则属 T1.4。
5. 允许诚实零增量。

## 未决问题

无。

## PR 计划

本 todo 不开 PR。
