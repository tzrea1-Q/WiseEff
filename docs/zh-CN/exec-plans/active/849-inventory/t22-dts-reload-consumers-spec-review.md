# T2.2-DTS 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t22-dts-reload-consumers-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
结论：**PASS with P2**

独立 Spec 评审。P2 已收口：完成门是源 SQL 精确 pin + binding-only verify + 删 intercept；Playwright unskip 归 T3.2；`dts_property_specs` **必须** inner join；比较测试禁止 display_name／order by 的 specification_key。留下 intercept 即 Spec 失败。

**可以开始实施。** 不开 T2.2-KNW。
