# T2.2-CGH 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t22-cgh-catalog-governance-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
结论：**PASS with P2**（FAIL 之后的复审）

独立 Spec 评审 [设计](t22-cgh-catalog-governance-design.md) 与 [威胁矩阵](t22-cgh-catalog-governance-threat-matrix.md)。评审者未写设计。评审本身不改生产代码、不 commit、不把 T2.2-CGH 标完成。中英双胞胎：每条 410／保留决策一致。

首次评审 `01a0aeec-4759-7333-9c1f-517ee277ca54` **FAIL**（P1：详情 `view=governance` 410 与 T2.1 按 id 读草稿冲突）。复审 `01a0aef7-2256-7960-a145-498f19d9830c` **PASS with P2**。生产改动前已把 P2 收进设计／矩阵。

## P1

无未关闭项。先前 P1 已关闭：获胜路由详情 `?view=governance` 保持 canonical-current-dts-spec。不发明 `lifecycle=draft`。不改 T2.1 `semanticBindingFixture.ts`。

## P2（实施前已收口）

1. T22C-01「三类」与四个标签。已收口：四个标签；不变量里的三类指 current／历史／归档。
2. POST 铸定义 410 与鉴权／body 顺序。已收口：**先 gone**（未认证和非法 body 的 POST 是 410，不是 401／400）。
3. `OrganizationSpecGovernancePanel.createParameterSpec` mock 回退。已收口：API 模式注入 catalog 端口；默认不做 UI 扫描。

## 已核对

- 裸 `POST /api/v2/parameter-specs` 不是 spec-review `createSpec`（`/resolve`）。
- 列表 `view=governance` 保留到 T2.2-MOD。
- PATCH／deprecate／restore／reattribute／cutover 保留到 T2.2-TOP。
- Overlay 保留。CGH 无 mock 端口工作。
- catalog-api 隔离 410 不是获胜的 `registerParameterSpecRoutes`。

**可以开始实施**（P2 已收口）。不开 T2.2-TOP。本评审不把 T2.2-CGH 标完成。
