# T2.2-CGH 目录／治理消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-cgh-catalog-governance-design.md)

配套[威胁矩阵](t22-cgh-catalog-governance-threat-matrix.md)。复用 #847 与 `parameter-catalog-api`。不把 DTS `parameter_specs` 重新当成 Catalog Definition 库。

状态：**独立 Spec 复审 PASS with P2。** P2 已收口。随后按本冻结改生产代码。

## 0. Spec FAIL 收口（不得再做成 410）

独立 Spec 评审 `01a0aeec-4759-7333-9c1f-517ee277ca54` **FAIL**。P1：把 **详情** `GET /api/v2/parameter-specs/:specId?view=governance` 做成 410，会打断 T2.1 `semanticBindingFixture.ts`（spec-review `createSpec` 之后按 id 读草稿，再 activate）。effective 详情对草稿返回 404。本修订冻结后继读取：**详情 governance 保留为 canonical-current-dts-spec**。不发明 `lifecycle=draft`，不改 T2.1。

本树已确认：裸 `POST /api/v2/parameter-specs` **不是** spec-review 的 `createSpec`。`createSpec` 在 `POST /api/v2/parameter-spec-review-tasks/:taskId/resolve`。裸 POST 410 仍是铸定义切口。

## 1. 本 todo 做什么

给 S12-CGH 归类并收口仍把 spec 表身份当成当前 Catalog Definition 的产品缝。出现匹配仍走 DTS spec-review，直到 T1.4。只删除消失的 token。记录实测计数。

| 缝 | 今日所有者 | T2.2-CGH |
| --- | --- | --- |
| 定义库 UI | #847 CatalogPage（注入 catalog 端口时经 `CatalogOrganizationSurface`） | 复用。`OrganizationSpecGovernancePanel` 只是 mock／无 catalog 回退 |
| Catalog HTTP | `parameter-catalog-api` | 复用 |
| 管理端 Catalog 调用 | `parameterAdminClient`（分片 0 行） | 复用；证明 `invokeRetiredLegacyWrite` 仍 410 |
| `GET /api/v2/parameter-specs` effective／列表 | DTS 匹配 | 保留 |
| `GET /api/v2/parameter-specs?view=governance` **列表** | 竞争产品列表 **且** 仍被 MOD 使用 | **保持 2xx**，归为 canonical-current-dts-spec，直到 T2.2-MOD。现场 API 调用者：`OrganizationModuleGovernancePanel.listLibrarySpecs`。catalog-api 隔离测试已对此 shape 410；获胜的 `registerParameterSpecRoutes` 仍 200。CGH 不 410 获胜列表处理器 |
| `GET /api/v2/parameter-specs/:specId?view=governance` **详情** | T2.1 ingest 按 id 读草稿 | **保持 2xx**，归为 canonical-current-dts-spec。不是 Catalog Definition 详情 |
| 未文档化的列表 `view=raw`／`mode=raw` | catalog-api 隔离已 410 | 仅当获胜列表解析器真正接受这些查询时才 410。`listParameterSpecsQuerySchema` 目前只允许 `effective\|governance`；多余键被丢掉。不为了 410 去加 raw 解析 |
| 管理端 `POST /api/v2/parameter-specs` 铸定义 | 获胜路由仍 201 | **410** `legacy-surface-retired`，successor `/api/v2/catalog` |
| Spec-review `createSpec` | `POST .../parameter-spec-review-tasks/:taskId/resolve` | 保留 |
| Activate | T2.1 ingest | 保留 |
| PATCH／deprecate／restore／reattribute／rename-property-key／版本 cutover／property-key cutover | `parameterTopologyClient`（T2.2-TOP） | **保持 2xx** 直到 T2.2-TOP。过渡文档「立即 410」本轮推迟；套上去会打断 T2.1／TOP。不是第二套 Catalog 铸定义 |
| Overlay GET/POST | DTS coverage | 保留并归类（T22C-06） |
| 比较贡献 | 适配器 | 不切换 |
| Topology／Catalog mock | T2.2-TOP | **CGH 无 mock 端口工作。** 管理端客户端分片已是 0 行 |

## 2. 归类方法

按 `file`×`rule` 分组写入回执，不逐条抄 1804 个 ID。四类：canonical-current-catalog、canonical-current-dts-spec、exact-canonical-history、archived-notice。

- **canonical-current-catalog** — 仅 Catalog API／CatalogPage（分片内预期为空）。
- **canonical-current-dts-spec** — ingest 用的 `parameter-specs` service／repository／routes／overlay／matcher／reviewApply；**列表和详情 `view=governance` HTTP**；直到 TOP 的生命周期／cutover 变更。
- **exact-canonical-history** — `*.test.ts`、cutover／对账、比较贡献。
- **archived-notice** — 因获胜 **POST 铸定义** 已 410 而消失的 token。

E2E import-wizard 两行保持历史／测试，除非 T2.1 相关字符串本身消失（不改 T2.1）。

## 3. HTTP

复用已有 `catalogLegacyGoneResult`／`CatalogLegacyGoneResponse`／`reason: "legacy-surface-retired"`／successor `/api/v2/catalog`（`parameter-catalog-api/legacy/gone.ts`）。不另造错误体。`registerParameterSpecRoutes` 注册在 catalog-api 之前；同等静态路径先匹配，catalog-api 隔离 410 **不是**本表面。T2.2-CGH 410 的是获胜的 POST 铸定义处理器。

**本轮 410**

- 获胜的 `POST /api/v2/parameter-specs`（管理端定义库铸定义）。**先 gone：** 在 `requireDb`、`getCurrentAuthContext`／`requireCanAdmin`、`createParameterSpecBodySchema` 之前返回 `catalogLegacyGoneResult(request.requestId, LEGACY_WRITE_GONE_MESSAGE)`。未认证和非法 body 的 POST 是 410，不是 401／400。catalog-api 隔离 410 已是此行为。
- 仅当获胜列表处理器实际接受 `view=raw` 或 `mode=raw` 时才 410 这些查询（今天不接受；不要为了 410 去加解析器）。

**保持 2xx**

- `GET /api/v2/parameter-specs` 默认／effective **以及** `view=governance` 列表。
- `GET /api/v2/parameter-specs/:specId` 默认／effective **以及** `view=governance` 详情。
- spec-review 任务列表／resolve（`createSpec: true` 留在 `/resolve`）。
- ingest 用的 spec activate。
- Overlay GET/POST（T22C-06）。
- PATCH、deprecate、restore、reattribute、rename-property-key、版本 cutover、property-key cutover。

本 todo 不改写 `OrganizationModuleGovernancePanel` 或 `OrganizationSpecGovernancePanel`。把 Catalog definitions 映射成 `ParameterSpecLibraryRow` 是 T2.2-MOD 适配器，不是 CGH 铸定义切口。

## 4. Ratchet

先做 POST 铸定义 410 和测试，再跑现有 `parameter-catalog-boundaries:check`（不发明旗标）。只删 token 已消失的 CGH 条目。禁止增长、削弱 checker、改写 fixture。回执记录 CGH 1804、总计 3513 及之后的数。

410 落地后，若同一文件仍有其它诚实的遗留 SQL／标识符，**允许零 delta**。零 delta **且** 410 未落地则 Spec 失败。预期只在 `routes.ts`／铸定义 POST 测试上有小 delta，不是 1804。

## 5. 证据

定向 `test:server`（parameter-specs 路由或等价）：POST 铸定义 410；effective 列表、governance 列表、governance 详情、review resolve、activate 保持 2xx。Catalog 客户端 `invokeRetiredLegacyWrite` 仍 410。checker 计数。`git diff --check`。类型／路由变化则 `build`。仅当 UI 露出 410 时才 1440x900。**API 模式会注入 catalog 端口**，因此 `/parameter-admin/specs` 是 CatalogPage，不会 POST 铸定义。`OrganizationSpecGovernancePanel.createParameterSpec` 是 mock／无 catalog 回退；若在无 catalog 端口时打到该回退，POST 铸定义 410 是归档通知，不是 CatalogPage 变化。默认 **不做 UI 扫描**。独立 Standards+Spec 实现复审。中英回执含归类组与计数。55438。Catalog lane 847 的 401 不是本 todo 验收。

## 6. 顺序

Spec PASS → 获胜 POST 铸定义 410+测试 → 更新仍把管理端 create 当当前面的测试（不动 review `createSpec`）→ checker／分片 → 回执归类表 → 复审 → 停止。不开 T2.2-TOP。不 410 列表／详情 governance。不 410 overlay。不开 PR。不 commit。

## PR 计划

本 todo 不开 PR。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | 管理端铸定义 POST 410 | `parameter-specs/routes.ts`、测试（`parameterSpecHttpAdapter.test.ts` 及任何 create-201 所有者） | Spec PASS |
| B | 分片 ratchet | 仅当 token 消失时改 `s12-cgh.json` | A |
| C | 回执 + 归类 | T2.2-CGH 文档 | B |
