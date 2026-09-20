# T2.2-KNW 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t22-knw-knowledge-consumers-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
结论：**PASS with P2**

独立 Spec 评审。P2 已收口：彻底删除 `interceptKnowledgeReferenceSql`；mapping 仅在 load 查询之后；picker／resolve 不注入合成行；孤儿 `propertyKey`→spec id 仅 notice-only。留下 wrap 即 Spec 失败。

**可以开始实施。** 不开 T2.2-MOD。
