# T2.2-TOP 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t22-top-topology-consumers-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
结论：**PASS with P2**

独立 Spec 评审 [设计](t22-top-topology-consumers-design.md) 与 [威胁矩阵](t22-top-topology-consumers-threat-matrix.md)。评审者未写设计。中英 410／保留一致。生产改动前已收口 P2。

## P1

无。可以开始实施。

## P2（已收口）

1. 拓扑客户端 PATCH／deprecate／restore／reattribute／cutover 仍是 **canonical-current-dts-spec 直到 T1.4**，本族不做归档通知。保留端口签名。
2. 客户端 GONE：无 POST-or-map 分叉；不解析 201 spec body。
3. Mock activate 测试不用 `createParameterSpec` 铸定义做夹具。

## 已核对

值 vs 启用已规定；铸定义 GONE 只在客户端／mock；不改 CGH 路由；不重键 binding 元组；不改 T2.1 fixture；分片 783／3513。

**可以开始实施**（P2 已收口）。不开 T2.2-PRJ。
