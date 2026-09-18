# T2.2-MOD 模块消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-mod-module-consumers-threat-matrix.md)

契约：#849/#853 T2.2-MOD、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) Module/driver registry 行、[清单](../../../references/parameter-catalog-contract-inventory.md) Module registry 行、T2.2-CGH [设计](t22-cgh-catalog-governance-design.md) 对 governance 列表的冻结、T2.2-KNW [回执](t22-knw-knowledge-consumers-acceptance.md)。产品方向已定。本矩阵冻结 MOD 实施边界。

状态：**Spec PASS with P2 已收口。** 配套：[可实现设计](t22-mod-module-consumers-design.md)。独立评审 `01a0b05c-8e4a-7c21-9f3d-2a1b6e90c4d7`。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`；已接受 main `46b6068693942b95f7cba28ee5de6748a97170fa`。T1.1–T2.2-KNW 脏候选除 MOD 路径外不重写。
- 允许路径：`server/modules/parameter-modules/**`、`ParameterModuleRegistryRepository.ts`、`parameterModuleRegistryClient.ts`（含测试）、`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`、`s12-mod.json`。现场 picker 适配器 `OrganizationModuleGovernancePanel.tsx` 虽不在分片路径，仍属本家族（CGH 把 `view=governance` 调用方推到这里）。不抢 OPS，不改 parameter-specs overlay／governance 处理器。
- T2.2-MOD 后停止。不开 T2.2-OPS 及之后、T1.4。不 commit。
- 仅当模块映射 overlay 选择器文案／空态／选择面变化时做 1440x900。默认：若 retarget 落地，对该选择器做一次 PC 核对。
- 评审 grok-4.6（gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。永不 `wiseeff_lane_849`，永不 `5432/wiseeff`。

## 受保护不变量

S12-MOD 运行时读写归为 **canonical current**（subject kind、声明 placement、registration／capacity、模块搜索／计数）、**exact canonical history** 或 **authorized archived notice**。重算／发现用的 driver／subject 来自 **`attribution_subjects`**，不是 `specification_key` 切段。观察 locator 钉住 **当前 binding revision 的 `config_revision_id`**，不是最新 revision 回退。缺 subject 或缺 locator **fail closed**（省略该行，不臆造）。Overlay HTTP 仍是 DTS coverage；模块注册表不宣称 Organization-schema 结构所有权。现场 overlay spec picker **不得**调用 `listSpecs({ view: "governance" })`。不新增 `db.query` intercept／wrap。先修源 SQL 与 picker 调用方，再删 allowance。

## 接收（2026-09-18 实测）

分片合计仍 **3513**。S12-MOD `s12-mod.json` **283** 条，**51** 个 file×rule 组。

生产泄漏：

- `listBindingsForModuleRecompute` 用 `string_to_array(ps.specification_key)`／`split_part` 推导 `driver_module`，并用 `dts_logical_node_revisions order by config_revision_id desc limit 1` 取 compatible／instance（无钉）。
- 两条 discovery 查询重复 latest-revision 回退。
- `service.ts` 仍 import `parameter-specs` 的 schemaRegistry／overlay／parseCoverage（CGH 把 overlay 留作 DTS coverage，本家族不 410）。
- 现场 picker：`OrganizationModuleGovernancePanel.listLibrarySpecs` 调用 `application.listSpecs({ view: "governance" })`。

已有：placement 路径 inner join `attribution_subjects` 且带 subject_kind 与组织隔离。比较贡献已打真实 PostgreSQL（无 `pinM`）。Overlay HTTP 不由 `parameter-modules/routes.ts` 拥有；模块 client 是 overlay 路由的 facade。

不存在 `pinM`／intercept helper。不要新增。

## 归类冻结

| 类 | MOD 含义 | 本 todo |
| --- | --- | --- |
| Canonical current — subject／placement | `attribution_subjects`、placements、模块 kind | 保持；重算 driver 从 subject 取 |
| Canonical current — registration／capacity | nature、cardinality、默认业务类、replay | 保持 |
| Canonical current — search／counts | `readRegistry` + `subtreeCounts` | 保持 |
| Canonical current — DTS overlay adapter | port／client overlay CRUD | 保持为 **DTS coverage**，不是模块身份。不 410 overlay HTTP |
| Canonical current — picker | overlay 属性链接用的 spec 库 | **改目标**，离开 `view=governance` |
| Exact canonical history | 测试、e2e、比较 | 保持／改断言执行 SQL |
| Archived notice | specification_key 切段；latest-revision locator；governance 列表 picker | **删除** |

## 行

| ID | 维 | 期望观察 | 证据所有者 |
| --- | --- | --- | --- |
| T22M-01 | 清单 | 283 条按 file×rule 归类 | 回执表 |
| T22M-02 | 精确 driver／subject 钉 | 重算 SQL 不切 `ps.specification_key`。按 `ps.attribution_subject_id` join `attribution_subjects`；投影 `asub.source_key` 为 `driver_module`（仅 scaffolding）。身份是 `asub.id`。永不 `display_name`。缺 subject 则空并 fail closed | `repository.ts` + 测试 |
| T22M-03 | Locator 钉 | 重算与 discovery 用 `config_revision_id = br.config_revision_id`。无 `order by config_revision_id desc limit 1` | `repository.ts` + 测试 |
| T22M-04 | Fail closed | 无当前 revision 或无匹配 logical-node revision 的行被省略，不猜测 | 测试 |
| T22M-05 | 无 intercept | 无 `pinM`／`db.query` wrap | grep + 比较测试 |
| T22M-06 | Picker 改目标 | 把 `runtime.parameterCatalogRepository` 传入面板。API 模式：`listDefinitions()`。仅 mock／无 catalog：default／effective `listSpecs()`。永不 `view: "governance"`。回退不是 Catalog current | 面板 + 测试 |
| T22M-07 | Overlay HTTP | **不** 410 overlay 路由或 parameter-specs governance 列表／详情 | 不改 overlay 路由 |
| T22M-08 | 模块身份 | kind、registration、capacity、声明 placement、搜索／计数保持 canonical current | 既有 registration 测试 |
| T22M-09 | 跨组织 | placement／subject 读取保持本组织或平台全局；不泄露他租户 | 既有 placement 测试 |
| T22M-10 | Ratchet | 先修行为；相对 283／3513。修完仍留 spec-key 切段或 latest-revision 回退即 Spec 失败，即使 delta ≠ 0。诚实零增量仅当泄漏已消失且 checker 被挡住 | 分片 + 可跑则 checker |
| T22M-11 | UI | 若 retarget 落地，overlay spec picker 1440x900 | 回执 |
| T22M-12 | 环境 | 55438 一次性库 | 回执 |
| T22M-13 | 非目标 | T2.2-OPS、T1.4、T2.1 fixture、TOP relocation、Hosted、commit；parameter-modules 路由 410；overlay／governance 处理器 410 | 回执 |

## 非目标

- 把 283 条 MOD allowance 清零。
- 410 `/api/v2/parameter-modules` 读／导航或 mapping 写（T1.4 终态）。
- 410 overlay HTTP 或 `GET /api/v2/parameter-specs?view=governance` 列表／详情。
- 本 todo 从 `ParameterModuleRegistryRepository` 删除 overlay CRUD（DTS coverage adapter 保留；它不定义模块身份）。
- 改写已存 `project_parameter_bindings.parameter_spec_id` 或 T2.1／TOP fixture。
- 开始 T2.2-OPS。
- Commit、PR、合并、Hosted、目标机、Issue 变更。

## 自审限度

由协调实施者撰写。生产改动前必须独立 Spec 评审。
