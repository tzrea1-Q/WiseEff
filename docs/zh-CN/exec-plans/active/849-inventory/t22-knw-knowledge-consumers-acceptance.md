# T2.2-KNW 知识消费者 — 本地实施回执

> English: [English](../../../../exec-plans/active/849-inventory/t22-knw-knowledge-consumers-acceptance.md)

状态：**T2.2-KNW 本地候选完成。** 设计 Spec PASS with P2；实现 Standards PASS with P2；实现 Spec PASS with P2。不做 SEALED、commit、PR、合并、Hosted、target 或 Issue 更新。

契约：[威胁矩阵](t22-knw-knowledge-consumers-threat-matrix.md)、[设计](t22-knw-knowledge-consumers-design.md)、[设计 Spec 评审](t22-knw-knowledge-consumers-spec-review.md)、[实现复审](t22-knw-knowledge-consumers-impl-review.md)。

## 已交付

load 源 SQL **LEFT JOIN** `parameter_specs`。投影只用 `coalesce(ps.property_key, dps.property_key)`。已删 `pinK` intercept 与空结果注入。mapping 仅在 load 之后。picker 他租户 404。不改写已存引用行。未 410 知识路由。

## 归类

50 条、15 组，表见 [英文分类](../../../../exec-plans/active/849-inventory/t22-knw-knowledge-consumers-classification.md)。picker 4、stored-ref 16、knowledge 4、history 26、archived-notice 0。

## Ratchet

50→50，3513→3513。wrap 已删。checker 未跑完（T2.2-TOP `editService.ts` relocation blob）。

## 验证

parameterReferences+comparison **18 passed**；routes **17 passed**；`tsc -b` 通过；`git diff --check` 通过。无 UI 扫描。

## 剩余

mapping 仍动态 import `lookupLegacyIdentifier`。checker 未收 KNW 分片。无 T2.2-MOD，无 commit。
