# T2.2-FIL 文件消费者 — 本地实施回执

> English: [English](../../../../exec-plans/active/849-inventory/t22-fil-file-consumers-acceptance.md)

状态：**T2.2-FIL 本地候选完成。** 设计 Spec PASS with P2；实现 Standards PASS with P2；实现 Spec PASS with P2。不做 SEALED、commit、PR、合并、Hosted、target 或 Issue 更新。

契约：[威胁矩阵](t22-fil-file-consumers-threat-matrix.md)、[设计](t22-fil-file-consumers-design.md)、[设计 Spec 评审](t22-fil-file-consumers-spec-review.md)、[实现复审](t22-fil-file-consumers-impl-review.md)。

## 已交付

`findBindingBySource` 源 SQL 只用 `dps.property_key`，已删 intercept。缺 property occurrence 不匹配。写回 inner join，overlay spec id 从锁定 binding 读取，不把 definitionId 当 specId。语义同步从匹配结果传 `parameterSpecId`。未 410 文件路由。未改 T2.1 fixture。

## 归类

56 条、23 组，表见 [英文分类](../../../../exec-plans/active/849-inventory/t22-fil-file-consumers-classification.md)。files 29、exact-pin 8、history 19、archived-notice 0。

## Ratchet

56→56，3513→3513。源 SQL 已无 split_part 回退。checker 未跑完（T2.2-TOP `editService.ts` relocation blob）。

## 验证

Helper PG 55438。`syncIdentity`+conflict+sync+comparison+writeback **31 passed**；`tsc -b` 通过；`git diff --check` 通过。无 UI 扫描。

## 剩余

写回缺锁定 spec 的测试未加；fail-closed 测的是删行而非 null property_key。`fileSyncConflictRepository` 无 legacy 列路径仍强转（族外）。checker 未收 FIL 分片。无 T2.2-AGT，无 commit。
