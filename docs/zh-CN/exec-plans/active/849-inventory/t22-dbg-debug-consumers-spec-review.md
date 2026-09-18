# T2.2-DBG 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t22-dbg-debug-consumers-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
结论：**PASS with P2**

独立 Spec 评审。P2 已收口：禁止 `binding: null` 的未绑定 snapshot；列表必须 SELECT 存储的 `project_parameter_binding_id`；中英补 Client/mock、Jobs/scripts、不抢 FIL、默认无 UI。留下 `exactDebugOperationValues` 即 Spec 失败。

**可以开始实施。** 不开 T2.2-DTS。
