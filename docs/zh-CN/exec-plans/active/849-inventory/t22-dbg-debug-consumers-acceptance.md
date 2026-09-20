# T2.2-DBG 调试消费者 — 本地实施回执

> English: [English](../../../../exec-plans/active/849-inventory/t22-dbg-debug-consumers-acceptance.md)

状态：**T2.2-DBG 本地候选完成。** 设计 Spec PASS with P2；实现 Standards PASS with P2；实现 Spec PASS with P2。不做 SEALED、commit、PR、合并、Hosted、target 或 Issue 更新。

契约：[威胁矩阵](t22-dbg-debug-consumers-threat-matrix.md)、[设计](t22-dbg-debug-consumers-design.md)、[设计 Spec 评审](t22-dbg-debug-consumers-spec-review.md)、[实现复审](t22-dbg-debug-consumers-impl-review.md)。

## 已交付

已删 `exactDebugOperationValues`。列表 SELECT 存储的 binding id；有则 canonical-pin，否则 typed-block。insert 不拷未绑定 pin。reload 仍 410。debug-node catalog 仍 2xx。设备写审批未改。无 DBG 内 DTS 晋升。

## 归类

17 条、5 组，表见 [英文分类](../../../../exec-plans/active/849-inventory/t22-dbg-debug-consumers-classification.md)。overlay 13、exact-pin 3、history 1、archived-notice 0。

## Ratchet

17→17，3513→3513。helper 已删。checker 未跑完（T2.2-TOP `editService.ts` relocation blob）。

## 验证

comparison+service+routes+valueCodec **135 passed**；repository.integration **21 passed**；`tsc -b` 通过；`git diff --check` 通过。无 UI 扫描。

## 剩余

比较贡献仍用未绑定 snapshot（非活路径）。rollback insert 不带 binding id。checker 未收 DBG 分片。无 T2.2-DTS，无 commit。
