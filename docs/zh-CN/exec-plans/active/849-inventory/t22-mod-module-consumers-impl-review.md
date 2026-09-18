# T2.2-MOD 实现复审

> English: [English](../../../../exec-plans/active/849-inventory/t22-mod-module-consumers-impl-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
对未提交 T2.2-MOD subject／locator／picker 修复的独立 Standards 与 Spec。评审者未写代码。本评审不改生产代码、不 commit、不开 T2.2-OPS。

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。

Standards `01a0b071-c8e4-7b29-9d5a-4f6e1a82b7c3`。Spec `01a0b069-719c-7a0f-a969-8e4b1edf977c`。

## Standards

结论：**PASS with P2**

无硬性文档标准违规。port 上的 overlay adapter 与诚实零增量 ratchet 按设计冻结不记。P2：三条 `repository.ts` 查询复制了 `br` + `lnr` locator lateral（家族 inline SQL 风格，非硬违规）。

## Spec

结论：**PASS with P2**

对照[设计](t22-mod-module-consumers-design.md) A–C／§4 与[矩阵](t22-mod-module-consumers-threat-matrix.md) T22M-02–07／10，核对该命名生产文件与测试。

P1：无。现场泄漏已删。

- **A / T22M-02.** `listBindingsForModuleRecompute` 投影 `asub.source_key as driver_module`，join `asub.id = ps.attribution_subject_id`。重映射身份仍是 `ps.attribution_subject_id`。引用：「禁止 spec-key 切段，禁止 `display_name` 查找。」生产 SQL 无 `string_to_array`／`split_part`／`specification_key` CASE，无 `display_name` join。
- **B / T22M-03–04.** 三条查询均取 binding tip `br`（`binding_id = b.id order by created_at desc limit 1`），再 `config_revision_id = br.config_revision_id`。引用：「**删除** 这三条查询里的 `order by config_revision_id desc limit 1`。」已删。缺 `lnr` 则 compatible／locator 为空；discovery 以 `lnr.compatible is not null` 省略。
- **C / T22M-06.** 引用：「`listLibrarySpecs` 不得调用 `application.listSpecs({ view: "governance" })`。」`listModuleOverlayLibrarySpecs` 在 catalog 端口存在时用 `listDefinitions()`，按 definition id／`propertyKey` 映射（不传 `specificationKey` 尾段）。否则默认无 view 的 `listSpecs()`。`ParameterAdminNextPage` 传入 `runtime?.parameterCatalogRepository`。
- **T22M-07.** Overlay `/api/v2/organization-driver-schemas*` 仍 2xx。未 410 governance 列表处理器。剩余 `OrganizationSpecGovernancePanel` governance 列表属 CGH 遗留，在家族外。
- **T22M-10.** 51 组／283；archived-notice 0；delta 0。引用：修完仍留 spec-key 切段／latest-revision／governance picker「即 Spec 失败，即使 delta ≠ 0。诚实零仅当泄漏已删且 checker 被挡住。」泄漏已删；checker 被 T2.2-TOP `editService.ts` 挡住。允许。

P2：设计 D 要求 fail-closed 用例——另一 config 上更新的 logical-node revision「不得胜出」；测试只断言执行 SQL 形状（dry-run 种子补了 binding revision，没有竞争 LNR）。Overlay picker 1440x900（T22M-11）未观察。

可以报告本地候选。不把 T2.2-MOD 标 SEALED／已提交。
