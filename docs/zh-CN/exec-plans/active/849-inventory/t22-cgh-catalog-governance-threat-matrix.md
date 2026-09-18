# T2.2-CGH 目录／治理消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-cgh-catalog-governance-threat-matrix.md)

契约：#849/#853 T2.2-CGH、已关闭 [#847](https://github.com/tzrea1-Q/WiseEff/issues/847)、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md)、[ADR-0046](../../../design-docs/adr-0046-source-occurrence-identity-spans-dts-and-software-configuration.md)、T2.1 [回执](t21-parameter-ui-acceptance.md)。产品方向（十一族、每条引用归类、先修行为再收 ratchet、相对 3513 实测减少）已经决定。本矩阵冻结 CGH 实施边界。

状态：**独立 Spec 复审 PASS with P2。** P2 已收口。配套：[可实现设计](t22-cgh-catalog-governance-design.md)。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- 继承 HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`；已接受 main `46b6068693942b95f7cba28ee5de6748a97170fa`。T1.1–T2.1 仍是未提交脏候选，不重写。
- 风险 **R2**（公开 Catalog／治理 HTTP、授权、身份）。独立 Spec 评审通过后才改生产代码。
- T2.2-CGH 本地交付后停止。不做 T2.2-TOP 及之后、T1.4 清零 allowance、T3.x、commit、PR、合并或 Issue 变更。
- 仅当 Catalog／后台可见表面变化时才做 1440x900。POST 铸定义 410 预期不改 CatalogPage。
- 评审模型 grok-4.6（要求的 gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。不用 `wiseeff_lane_849`，不用 compose `5432/wiseeff`。

## 受保护不变量

S12-CGH 的每条运行时读／写／引用归为 **canonical current**、**精确 canonical 历史** 或 **授权归档通知**。产品定义库、登记、生命周期、搜索／详情／计数和发布向引用，不得把 `parameter_specs` 当成当前 Catalog Definition。先修行为再删 allowance。共享 checker 记录族与总数；3513 是复测基线。比较适配器不是已切换的运行时消费者。

## 接收（2026-09-17 实测）

分片合计 **3513**。S12-CGH **1804** 条：

| 种类 | 计数 | 说明 |
| --- | --- | --- |
| 生产 `server/modules/parameter-specs/**` | 1193 | 主要是 `driverSchemaOverlayRepository.ts`（208）、`service.ts`（167）、`repository.ts`（114） |
| 测试 | 609 | cutover／对账／overlay 集成 |
| E2E | 2 | `parameter-import-wizard.acceptance.spec.ts` |
| `parameterAdminClient.ts` | 0 | 定义／登记／审核已走 Catalog；`invokeRetiredLegacyWrite` 是 410 助手 |

规则：`legacy-parameter-spec-identifier` 670、`legacy-catalog-raw-read` 399、`legacy-overlay-catalog-contract` 312、`legacy-catalog-sql-write` 310、`legacy-effective-governance-contract` 65、`legacy-catalog-route` 36、`unresolved-boundary-expression` 11、`legacy-catalog-table-name` 1。

#847 CatalogPage 在注入 catalog 端口时是 `/parameter-admin/specs` 的定义工作区。`parameter-catalog-api` 拥有 Catalog 读／治理／发布／遗留查找。现场 `registerParameterSpecRoutes` 先注册；该获胜路由上 `GET/POST /api/v2/parameter-specs*` 仍 200／201。catalog-api 隔离测试已对列表 `view=governance` 和 POST 铸定义 410；那些 410 **不是** 组合应用表面。

过渡文档要求 `view=governance` 和若干变更立即 410。T2.2-CGH 不得 410 T2.1 拓扑依赖的 DTS spec-review／activate／**详情 governance**（`semanticBindingFixture.ts` 先 GET 详情 `?view=governance` 再 POST activate）。草稿不在 effective GET／详情里。

## 归类冻结

| 类 | CGH 含义 | 本 todo |
| --- | --- | --- |
| Canonical current — Catalog | Catalog API + CatalogPage：定义、主体、登记、放置、审核项、发布 | 证明；不建第二套库 |
| Canonical current — DTS spec | ingest／匹配用的 `parameter_specs`／review／overlay；**列表和详情 `view=governance` HTTP**；直到 TOP 的 PATCH／deprecate／restore／reattribute／cutover | **保留**。不是 Catalog Definition。T1.4 才退役表 |
| 精确 canonical 历史 | 测试、cutover、比较贡献 | 保留 allowance |
| 归档通知 | 获胜路由上退役的 **管理端 POST 铸定义** | **410** `legacy-surface-retired`，不泄漏载荷 |

## 行

| ID | 维 | 预期观察 | 证据所有者 |
| --- | --- | --- | --- |
| T22C-01 | 清单 | 1804 条按 file×rule 归入 **四个标签**：canonical-current-catalog、canonical-current-dts-spec、exact-canonical-history、archived-notice。不变量里的「三类」指 current／历史／归档；current 再拆 Catalog 与 DTS。没有未解释的分片行 | 回执表（分组，不抄 1804 行） |
| T22C-02 | Catalog 当前面 | 登记、定义搜索／详情／计数、发布向读取留在 `/api/v2/catalog*` 和 CatalogPage。不新建定义表 | 现有 catalog 客户端 + 不新页面 |
| T22C-03 | DTS spec 当前 | `GET /api/v2/parameter-specs` 默认／effective、**列表 `view=governance`**、**详情 `view=governance`**、ingest 用的 spec-review resolve／activate 保持 2xx。不当成 Catalog Definitions 宣传 | 拓扑／spec-review 测试；不改 T2.1 fixture |
| T22C-04 | 治理视图 | **列表** `view=governance` 保持 2xx 直到 T2.2-MOD（现场 `OrganizationModuleGovernancePanel`）。**详情** `view=governance` 作为 DTS 按 id 读草稿保持 2xx（T2.1）。catalog-api 隔离 410 不是获胜路由。本 todo 不在 `registerParameterSpecRoutes` 上 410 任一查询 | 定向路由测试：governance 列表／详情 **不是** 410 |
| T22C-05 | 竞争铸定义 | 获胜路由上管理端 `POST /api/v2/parameter-specs` 退役（410 `legacy-surface-retired`，successor `/api/v2/catalog`）。**先 gone**（鉴权和 body 解析之前）：未认证和非法 body 的 POST 是 410，不是 401／400。spec-review `createSpec` 留在 `/resolve` | 路由测试区分 POST 铸定义与 `/resolve`；未认证 POST 410 |
| T22C-06 | Overlay | 组织 driver-schema overlay 仍是 DTS coverage 编写（直到 T2.2-MOD／T1.4）。本轮不 410 | 不改写 overlay |
| T22C-07 | 比较 | `parameterCatalogComparisonContribution.ts` 仍是比较适配器，不是已切换运行时消费者 | 生产读取不经它 |
| T22C-08 | Ratchet | 先修再删 allowance，记录相对 1804／3513 的 delta。禁止削弱 checker、增长 allowance。410 落地后若同文件仍有遗留 SQL，允许诚实的零 delta | `parameter-catalog-boundaries:check` + 分片 diff |
| T22C-09 | 归档诚实 | 410／404／409 遵循过渡：归档 410 不带载荷；未知 404；体中无归档 id | POST 铸定义路由测试 |
| T22C-10 | 测试 | 更新仍把管理端 create 当当前面的 CGH 测试。不靠 skip 删覆盖。不改写仍把 governance 列表／详情当 DTS 当前的测试 | 定向 `test:server` |
| T22C-11 | UI | 仅当 410 出现在可见 Catalog／后台时才 1440x900。Mock ≠ 验收。**API 模式会注入 catalog 端口**，因此 CatalogPage 是定义库；`OrganizationSpecGovernancePanel.createParameterSpec` 是 mock／无 catalog 回退。默认：POST 铸定义 410 不做 UI 扫描 | 仅当 UI 变化才跑 catalog／admin specs |
| T22C-12 | 环境 | 55438 一次性库或带 HMAC 的 catalog lane 847。不用 `wiseeff_lane_849`，不用 `5432/wiseeff` | 回执 |
| T22C-13 | 非目标 | T2.2-TOP…OPS、T1.4 清零 allowance、退役 `parameter_specs` 表、Hosted、target、commit | 回执 |
| T22C-14 | 生命周期变更 | PATCH／deprecate／restore／reattribute／rename-property-key／cutover 保持 2xx 直到 T2.2-TOP（`parameterTopologyClient` 仍调用）。CGH 不 410 | 不改那些处理器 |
| T22C-15 | Mock 端口 | CGH 无 mock 端口工作。Topology mock 属 T2.2-TOP。管理端客户端分片保持 0 行 | 不改 mock |

## 非目标

本 todo 不清零 1804 条；不 410 ingest 用的 spec-review；不在获胜路由上 410 列表或详情 `view=governance`；不 410 PATCH／deprecate／restore／reattribute／cutover；不重写 overlay、`OrganizationModuleGovernancePanel` 或 #847；不 T1.4；不 commit。

## 自评限制

实现者自写。生产改动前必须独立 Spec 评审。
