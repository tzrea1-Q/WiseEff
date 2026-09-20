# T2.2-OPS 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t22-ops-operations-consumers-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
结论：**PASS with P2**

独立 Spec 评审 [设计](t22-ops-operations-consumers-design.md) 与 [威胁矩阵](t22-ops-operations-consumers-threat-matrix.md)。评审者未写设计。评审本身不改生产代码、不 commit、不开 T1.4、不碰目标机或 Issue。

评审 `01a0b06f-3a18-7c44-9e2d-8f1b47c0a5e6` **PASS with P2**。生产改动前须把 P2 收进设计／矩阵。

## P1

无未关闭项。死 `parameter-specs` import 在源码删除，不 wrap。`--apply` 保持 410。overlay／governance／module 路由 410 属 T1.4。`seedInitialization`／publication installer 属 T1.4。不改 T2.1／TOP fixture。修完仍留 `parameter-specs` import、调用 `reconcileDriverParameterDefinitions`，或 `verifyEffectiveDriverParameterDefinitions` 的 truthy 门，即 Spec 失败，即使 delta ≠ 0。

## P2（实施前收口）

1. **S10-PER 缺失须 fail closed。** 删除死 import 是分片泄漏修复，不是给 verify 加桩的许可。收口：`--verify` 体只调用 `readTypedVerificationReport`。编译期若 S10-PER 缺失则 fail closed（不回退 `definitionVerification`，不加假 adapter）。运行时缺失／未批准报告是 S10-PER 带标记的缺席（`kind: "absent"`，`missing`／`unapproved`），绝不是桩 `ready`。`DATABASE_URL` 仍必需。`--catalog-only` 只是 `--verify` 的解析约束，不选择旧 catalog-only verifier。

2. **中英对齐。** 中文矩阵／设计与英文对齐：`--dry-run` 保持 inspect；comparison 保持；T22O-01–10 表；永不调用公开 raw／governance HTTP；无假 S10-PER adapter；修完仍留 `parameter-specs` import 即 Spec 失败，即使 delta ≠ 0；列出 T1.4 内容（overlay／governance／module 410、seedInitialization 写入、installer）。

## 已核对

- **(a) 死 import vs S10-PER 缺失。** 现场泄漏是 CLI 仍 import `reconcileDriverParameterDefinitions`／`verifyEffectiveDriverParameterDefinitions`，并把未调用的 verifier 当 `await verifyEffectiveDriverParameterDefinitions &&`。`--verify` 已调用 `readTypedVerificationReport`。删 import 是 allowance 修复。S10-PER 缺失的 fail-closed 是：不回退、不加假 adapter（P2-1）。带标记缺席是 S10-PER 缺报告契约，不是桩 ready。不是 P1。

- **(b) 重启不能 reseed vs T1.4。** 产品：调度／后台／脚本和重启路径使用 canonical 所有者，不能 reseed 或把归档写成当前。本家族重启是 operations health／ready／pilot-readiness：dual-fact **读** + `createStartupRuntimePin` reader；无 `seedInitialization` import。分片 4 条全在 CLI；`server/modules/operations/**` 为 0。`seedInitialization` 与 publication installer 在分片外。T1.3 已证明普通启动／升级／发布不重置。T1.4 拥有剩余写入与重启后拒绝旧重放。留给 T1.4 正确；本家族改写会抢 T1.4。不是 P1。

- **(c) `--apply` 410。** 已是 `catalogLegacyGoneResult("ops-reconcile-apply")` 且有测试。保持 410 对写路径足够。不调用 `reconcileDriverParameterDefinitions`。`--dry-run` 保持 inspect，不是 reconcile dry-run。删 import 属 A，不是第二次 apply 修复。

- **(d) 中英对齐。** 修复意图一致。中文压缩了 T22O 行、省略 `--dry-run`／comparison 保持、无假 adapter／DATABASE_URL、以及公开 raw／governance 非目标条。实施前收口 P2-2。不是 P1 分裂。

产品与 todolist 行一致。清单 Release/operations 与过渡 Operations tooling（永不公开 raw／governance；类型化 mapping head；诊断需 operator authority）由类型化 S7-ORC／S10-PER／S8-LEG 诊断消费。CLI 是带 `DATABASE_URL` 的 operator 作业。S8-LEG lookup 不重分类 R6／R8，不把归档写成当前。

**可以开始实施**（P2 已收口）。不开 T1.4。本评审不把 T2.2-OPS 标完成。
