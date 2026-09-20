# T2.2-MOD 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t22-mod-module-consumers-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
结论：**PASS with P2**

独立 Spec 评审 [设计](t22-mod-module-consumers-design.md) 与 [威胁矩阵](t22-mod-module-consumers-threat-matrix.md)。评审者未写设计。评审本身不改生产代码、不 commit、不开 T2.2-OPS。

评审 `01a0b05c-8e4a-7c21-9f3d-2a1b6e90c4d7` **PASS with P2**。生产改动前须把 P2 收进设计／矩阵。

## P1

无未关闭项。spec-key 切段与 latest-revision locator 在源 SQL 修，不 wrap。本家族不 410 overlay 或 parameter-specs governance HTTP。不改 T2.1／TOP fixture。修完仍留 `specification_key` driver 切段、`order by config_revision_id desc limit 1`，或 picker 仍调用 `listSpecs({ view: "governance" })`，即 Spec 失败，即使 delta ≠ 0。

## P2（实施前收口）

1. **Subject 投影。** 重映射身份是经 `ps.attribution_subject_id` 的 `asub.id`，不是 `driver_module` 字符串。`display_name` 不唯一（仅 `unique (organization_id, source_key)`；ADR-0004 名称仅展示）。收口：把 `asub.source_key` 投影为 `driver_module`（仅 scaffolding 启发式）。禁止按 `display_name` join／查找 subject。缺 subject → 空并 fail closed。locator 的 `br` 是该 binding 自己的 tip（`order by created_at desc limit 1` 且 `binding_id = b.id`），然后 `lnr.config_revision_id = br.config_revision_id`（与 DTS 同形）。删除三条 latest-revision 回退。

2. **Picker 接线。** Catalog 在 `ParameterAdminNextPage` 的 `runtime.parameterCatalogRepository`，不在 `useParameterAdmin()`。收口：把该端口传入 `OrganizationModuleGovernancePanel`（NextPage／Provider 透传属本家族；CGH 把 `view=governance` 调用方推到此面板，即使它不在 `s12-mod.json` 路径）。API 模式用 `listDefinitions()` 按 definition id／propertyKey 映射到 `ParameterSpecLibraryRow`。effective `application.listSpecs()` 仅 mock／无 catalog。永不 `view=governance`。回退不是 Catalog current。

3. **CGH「直到 T2.2-MOD」。** 指改目标本现场调用方，不是把获胜的 `GET /api/v2/parameter-specs?view=governance`（`registerParameterSpecRoutes`）做成 410。剩余 governance 列表是 `OrganizationSpecGovernancePanel` 的 mock／无 catalog（CGH 遗留）。不 410 overlay HTTP，也不 410 `/api/v2/parameter-modules` 路由。

4. **中英对齐。** picker 永不 governance；insert／delete intercept 不适用（不存在，勿新增）；引用清单 Module 行；T2.1／TOP 在家族外；修完仍留 spec-key 切段／latest-revision／governance picker 即 Spec 失败，即使 delta ≠ 0。中文 A. 与 `source_key` 投影对齐。

## 已核对

- **(a) Overlay adapter vs 结构所有权。** 过渡要求退役 module／Organization-schema 结构所有权；overlay HTTP 410 属终态／T1.4。CGH 把 overlay GET／POST 冻为 DTS coverage（CGH 不 410）。模块 port 上的 overlay CRUD 仍是 `/api/v2/organization-driver-schemas*` 的 facade，不铸模块身份（kind、声明 placement、registration／capacity、搜索／计数保持 canonical current）。本家族 410 overlay HTTP 会抢 parameter-specs／CGH。接受为直到 T1.4 的 DTS coverage adapter；不是 P1。

- **(b) Governance 列表。** CGH：因现场调用方是 `OrganizationModuleGovernancePanel.listLibrarySpecs`，列表 `GET /api/v2/parameter-specs?view=governance` **保持 2xx 直到 T2.2-MOD**。只改目标即可。410 获胜列表处理器会抢 parameter-specs／CGH。

- **(c) Locator。** 最新创建的 binding tip 仅作为该 binding 自己的 tip 才诚实。把 `lnr` 钉在 `br.config_revision_id` 不会像 `order by config_revision_id desc limit 1` 那样跨 config 取最新 node revision。Fail closed：省略该行。不是 P1。

- **(d) Driver 钉。** 现场泄漏是 `listBindingsForModuleRecompute` 的 `string_to_array`／`split_part(ps.specification_key)`。下游重映射已用 `attributionSubjectId` + placement；`driverModule` 仅 scaffolding。若收口 P2-1，`display_name` 碰撞不是不诚实的 subject 钉。

- **(e–f)** 产品与 todolist（placement／subject kind、registration／capacity、搜索／计数）及清单 Module 行一致。无 intercept，勿新增。T2.1／TOP 在家族外。改面板属本家族。

**可以开始实施**（P2 已收口）。不开 T2.2-OPS。本评审不把 T2.2-MOD 标完成。
