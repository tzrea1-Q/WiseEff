# T2.2-TOP 拓扑消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-top-topology-consumers-design.md)

配套[威胁矩阵](t22-top-topology-consumers-threat-matrix.md)。拓扑 HTTP 已拥有 binding、occurrence 写锁、值草稿和节点启用草稿。Catalog Definition 留在 #847 CatalogPage。T2.2-CGH 已在获胜 spec 路由上 410 管理端铸定义。

状态：**独立 Spec 评审 PASS with P2。** P2 已收口。随后按本冻结改生产代码。

## 1. 本 todo 做什么

给 S12-TOP 归类并收口：(a) 仍经拓扑端口／mock 铸 ParameterSpec；(b) 值草稿表达结构／`status` 启用。保留 DTS spec-review／activate 和 binding occurrence 锁。不重键 `ProjectPropertyBindingKey`。不抢 T2.2-PRJ 工作台 `parameterSpecId` 删除。

| 缝 | 今日所有者 | T2.2-TOP |
| --- | --- | --- |
| Binding／拓扑／历史／比较／校验 HTTP | `parameter-topology/routes.ts` | 保持 2xx |
| 值草稿 | `POST .../parameter-bindings/:bindingId/drafts` | 保留；拒绝结构键 |
| 节点启用草稿 | `POST .../node-enablement-drafts` | 保留；只写 `status` |
| 拓扑客户端铸定义 | `createParameterSpec` → POST `/api/v2/parameter-specs` | **类型化 GONE**（服务端已 410） |
| Mock 铸定义 | mock 插入 spec | **GONE**；禁止 mock 独有铸定义 |
| 拓扑客户端 list/get/review/activate | T2.1 ingest | 保留 |
| 拓扑客户端 PATCH／deprecate／restore／reattribute／cutover | CGH 路由仍 2xx | **canonical-current-dts-spec 直到 T1.4**，本族不做归档通知。保留端口签名（`adapterParity`）。不改 CGH 路由 |
| Binding 身份元组 | `project × node × parameterSpecId × module` | 归为 DTS current；**不重键** |
| 比较贡献 | 适配器 | 不切换 |

## 2. 归类方法

按 `file`×`rule` 写入回执，不抄 783 个 ID。四类：canonical-current-topology、canonical-current-dts-spec、exact-canonical-history、archived-notice。

## 3. Spec PASS 后的修复

**A. 值 vs 节点启用（editService）**

`createBindingDraft` 在加载 binding 上下文后，若 `isStructuralPropertyKey(binding.property_key)`：

- `status` → CONFLICT，`reason: "structural-status-use-node-enablement"`，指向 `POST /api/v2/projects/:projectId/node-enablement-drafts`。不写草稿行。
- 其它结构键 → CONFLICT，`reason: "structural-property-not-value-draft"`。不写草稿行。

复用 `src/domain/parameter-topology/parameterSurface.ts` 的 `isStructuralPropertyKey`（ADR-0003）。不另造结构键表。

`createNodeEnablementDraft` 保持 `propertyKey: "status"` + `editSubjectKind: "node-enablement"`。不以 `bindingId` 为主人。

**B. 拓扑 HTTP 铸定义（客户端）**

`createHttpParameterTopologyRepository.createParameterSpec` 抛类型化 `WiseEffApiError` GONE（`legacy-surface-retired`，successor `/api/v2/catalog`，`retryable: false`），**不解析 201 spec body**，也不做 POST-or-map 分叉。保留端口方法（抛错；`adapterParity`）。不删 `listSpecs`／`activate`／`resolve`。PATCH／deprecate／restore／reattribute／cutover 方法留在端口直到 T1.4。

**C. Mock 端口**

`createMockParameterTopologyRepository.createParameterSpec` 抛 GONE，不 `store.specs.set`。用 mock store 里已有草稿（如 `spec-draft-mystery`）给 `activateParameterSpec` 做夹具，禁止再调 `createParameterSpec` 铸定义。`OrganizationSpecGovernancePanel` mock 回退会显示归档错误；本 todo 不改写该面板（API 模式是 CatalogPage）。

**D. 族外**

不改 `server/modules/parameter-specs/routes.ts`。不 410 列表／详情 governance。不改 T2.1 `semanticBindingFixture.ts`。

## 4. Ratchet

先做 A–C 和测试，再跑现有 `parameter-catalog-boundaries:check -- --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246`（若能跑完）。若 T2.1 import-wizard relocation 仍挡住，记录精确错误，不改写 T2.1 relocation。只删 token 已消失的 TOP 条目。禁止增长、削弱 checker、改写 fixture。回执记录 TOP 783、总计 3513 及之后的数。

410／GONE 落地后若同族文件仍有遗留 SQL／标识符，**允许零 delta**。零 delta **且** 修复未落地则 Spec 失败。

## 5. 证据

定向 `test:server`：结构值草稿 409；节点启用仍 201；业务值草稿仍 201。客户端 `createParameterSpec` GONE。Mock 铸定义 GONE。既有 binding／enablement 路由测试仍过。端口／客户端变化则 `tsc -b`。`git diff --check`。仅当可见控件露出 GONE 时才 1440x900；默认 **不做 UI 扫描**。独立 Standards+Spec 实现复审。中英回执含归类组与计数。55438。Catalog lane 847 的 401 不是本 todo 验收。

## 6. 顺序

Spec PASS → editService 拒绝结构键 → 客户端铸定义 GONE → mock GONE → checker／分片 → 回执 → 复审 → 停止。不开 T2.2-PRJ。不 commit。

## PR 计划

本 todo 不开 PR。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | 结构 vs 值草稿 | `editService.ts`、测试 | Spec PASS |
| B | 拓扑客户端铸定义 GONE | `parameterTopologyClient.ts`、测试 | Spec PASS |
| C | Mock 铸定义 GONE | mock 与测试 | Spec PASS |
| D | 分片 ratchet | 仅当 token 消失时改 `s12-top.json` | A–C |
| E | 回执 | T2.2-TOP 文档 | D |
