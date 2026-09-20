# T2.2-MOD 模块消费者 — 本地实施回执

> English: [English](../../../../exec-plans/active/849-inventory/t22-mod-module-consumers-acceptance.md)

状态：**T2.2-MOD 本地候选完成。** 设计 Spec PASS with P2；实现 Standards PASS with P2；实现 Spec PASS with P2（grok-4.6；要求的 gpt-5.6-luna 不可用）。无 SEALED、commit、PR、合并、Hosted、目标机或 Issue 更新。

契约：[威胁矩阵](t22-mod-module-consumers-threat-matrix.md)、[设计](t22-mod-module-consumers-design.md)、[设计 Spec 评审](t22-mod-module-consumers-spec-review.md)、[实现复审](t22-mod-module-consumers-impl-review.md)。

## 候选

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- 分支：`codex/849-853-t11-source-identity`
- HEAD（未变）：`f9c710f6a90d67462965a06abd47e33aa200e75e`
- T1.1–T2.2-KNW 仍未提交。无 commit。

## 已交付行为

1. `listBindingsForModuleRecompute` 按 `ps.attribution_subject_id` join `attribution_subjects`，投影 `asub.source_key` 为 `driver_module`。重映射身份仍是 `attributionSubjectId`（`asub.id`）。无 `specification_key` 切段，无 `display_name` 查找。
2. 重算与两条 discovery 查询把 `dts_logical_node_revisions.config_revision_id` 钉在 `br.config_revision_id`；`br` 是该 binding 自己的 tip。`order by config_revision_id desc` 已删除。缺 tip／locator 则省略 compatible／instance。
3. Overlay spec picker：`ParameterAdminNextPage` 把 `runtime.parameterCatalogRepository` 传入 `OrganizationModuleGovernancePanel`。API 模式用 `listDefinitions()`。mock／无 catalog 用默认 `listSpecs()`（永不 `view: "governance"`）。不 410 overlay HTTP 或 parameter-specs governance 处理器。kind／registration／capacity／搜索／计数保持。

## 归类（T22M-01）

S12-MOD **283** 条，**51** 个 file×rule 组，0 未解释。表：[t22-mod-module-consumers-classification.md](../../../../exec-plans/active/849-inventory/t22-mod-module-consumers-classification.md)。

| 类 | 计数 |
| --- | --- |
| exact-canonical-history | 90 |
| canonical-current-subject-placement | 88 |
| canonical-current-dts-overlay-adapter | 56 |
| canonical-current-registration-capacity | 32 |
| canonical-current-search-counts | 17 |
| archived-notice | 0 |

## Ratchet（T22M-10）

MOD 283→283，合计 3513→3513，delta 0。源 SQL 中 spec-key 切段与 latest-revision 回退已消失。诚实零增量：checker **未完成**（T2.2-TOP `editService.ts` relocation blob；不改那些 fixture）。修完仍留 spec-key 切段／latest-revision／governance picker 即 Spec 失败；这些泄漏已消失。

## 验证（不要加总）

Helper PG **55438**／`wiseeff_t22_cgh`。overlay picker 有单元测试；现场 1440x900 overlay 对话框 **未跑**（本会话无 browser MCP）。

| 命令 | 结果 |
| --- | --- |
| `test:server -- service.test.ts driverRegistration.test.ts driverPlacement.test.ts parameterCatalogComparisonContribution.test.ts` | **29 passed**（14+8+4+3） |
| `npm test -- OrganizationModuleGovernancePanel.test.tsx ParameterAdminNextPage.test.tsx` | **47 passed**（2+45） |
| `npx tsc -b` | **passed** |
| `git diff --check` | **passed** |
| grep `string_to_array`／`split_part` | **仅测试断言** |
| grep `order by config_revision_id desc` | **仅测试断言** |
| grep `view: "governance"` in `OrganizationModuleGovernancePanel.tsx` | **无匹配** |
| boundary checker | **未完成**（T2.2-TOP `editService.ts` blob） |
| 浏览器 1440x900 overlay picker | **未跑** |

## 剩余限度

- Overlay CRUD 仍在模块 port 上，作为直到 T1.4 的 DTS coverage adapter。
- Checker 被挡住；MOD 分片未 ratchet。
- Overlay picker 1440x900 未现场观察。
- Fail-closed「另一 config 上更新的 LNR 不得胜出」只断言 SQL 形状，没有竞争 revision 种子。
- 三条查询复制了 `br`／`lnr` locator lateral（Standards P2）。
- 不开 T2.2-OPS，不 commit。
