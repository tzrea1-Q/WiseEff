# T2.2-MOD 模块消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-mod-module-consumers-design.md)

配套[威胁矩阵](t22-mod-module-consumers-threat-matrix.md)。placement 与 subject kind 是 canonical current。registration／capacity 保持。模块搜索／计数保持。driver 身份是 attribution subject，不是 spec-key 尾段。locator 钉住当前 binding revision。overlay 仍是 DTS coverage。不能留下扫描可见的 `specification_key` 切段或 latest-revision 回退。

状态：**Spec PASS with P2 已收口。** 独立评审 `01a0b05c-8e4a-7c21-9f3d-2a1b6e90c4d7`。可以实施。

## 1. 本 todo 做什么

给 S12-MOD（283）归类。修：`repository.ts` 仍切 `ps.specification_key` 当 `driver_module`，并从最新 logical-node revision 取观察；现场 overlay picker 仍列 `view=governance` spec。Fail closed。不抢 OPS。不 410 overlay 或 parameter-specs governance 处理器。

| 缝 | 今日所有者 | T2.2-MOD |
| --- | --- | --- |
| 重算 driver 字符串 | `string_to_array`／`split_part(ps.specification_key)` | **`asub.source_key`，经 `ps.attribution_subject_id`。身份是 `asub.id`。不切 spec-key，不按 `display_name` 查找** |
| 重算／发现 locator | `order by config_revision_id desc limit 1` | **钉 `config_revision_id = br.config_revision_id`（当前 binding revision）。缺失则省略** |
| subject kind／placement／capacity | placement 与 `attributionSubjects.ts` | 保持 |
| 注册表搜索／计数 | `readRegistry` + `subtreeCounts` | 保持（bindings／去重 spec id） |
| Overlay HTTP | parameter-specs overlay 路由（CGH 保持 2xx） | **保持 2xx。** 模块 client 仍是 facade |
| Overlay port／client 方法 | 模块仓库 overlay CRUD | 保持为 **DTS coverage adapter**，不是模块身份 |
| Overlay spec picker | `listSpecs({ view: "governance" })` | **改目标**（catalog definitions，否则 effective 列表）。永不 governance view |
| `service.ts` overlay import | `listDriverRegistry` 的 parse coverage | 保持为 DTS coverage 注解直到 T1.4。不 410 |
| 比较 | 已打 PG | 断言执行 SQL；无 intercept helper |
| Client／mock | 模块路由 + overlay facade | 保持路由；改 picker 调用方 |
| Jobs／scripts | 分片路径无 | 回执写明无 |

## 2. 归类方法

按 `file`×`rule`。标签：canonical-current-subject-placement、canonical-current-registration-capacity、canonical-current-search-counts、canonical-current-dts-overlay-adapter、canonical-current-picker、exact-canonical-history、archived-notice（specification_key driver 切段、latest-revision locator、governance 列表 picker）。

## 3. Spec PASS 后的修复

**A. 精确 driver／subject 钉（`repository.ts` `listBindingsForModuleRecompute`）**

用

```sql
left join attribution_subjects asub
  on asub.id = ps.attribution_subject_id
 and (asub.organization_id is null or asub.organization_id = b.organization_id)
```

替换对 `ps.specification_key` 的 CASE。投影 `asub.source_key` 为 `driver_module`（仅 scaffolding 启发式）。重映射身份是经 `ps.attribution_subject_id` 的 `asub.id`。禁止 `string_to_array`／`split_part`／`coalesce(..., ps.specification_key)`。禁止按 `display_name` join／查找 subject。缺 subject 则 `driver_module` 为空；`resolveAttributionModuleForBinding` 已有 fail-closed 路径，保持。

**B. Locator 钉（重算 + 两条 discovery）**

与 T2.2-DTS 候选 SQL 同形：

- 当前 binding revision `br`：`project_parameter_binding_revisions` 且 `binding_id = b.id`（只允许作为该 binding 自己的 tip，不是 node-revision 回退）。
- logical-node revision：`logical_node_id = b.logical_node_id and config_revision_id = br.config_revision_id`。
- **删除** 这三条查询里的 `order by config_revision_id desc limit 1`。

Fail closed：缺 `br` 或匹配 `lnr` 时，discovery 聚合不计入该行；重算看到空 compatible／locator，不得猜测其他 revision。

**C. Picker 改目标（`OrganizationModuleGovernancePanel.tsx`）**

`listLibrarySpecs` 不得调用 `application.listSpecs({ view: "governance" })`。

1. 从 `ParameterAdminNextPage` 把 `runtime.parameterCatalogRepository` 传入面板（Catalog 不在 `useParameterAdmin()` 上）。NextPage／Provider 透传属本家族。
2. 有该端口（API 模式）时，把 `listDefinitions()` 按 definition id／`propertyKey` 映射到 `ParameterSpecLibraryRow`。面板内不另造 Catalog HTTP client。
3. 否则（仅 mock／无 catalog）调用 default／effective 的 `application.listSpecs()`。该回退不是 Catalog current。
4. DTS spec 形行继续用 `mapParameterSpecToLibraryRow`。Catalog 映射不得从 `specificationKey` 尾段恢复身份。

本家族 **不** 410 `GET /api/v2/parameter-specs?view=governance`（处理器属 parameter-specs／CGH 遗留）。改目标后 MOD 不再是该列表的现场调用方。

**不** 410 overlay HTTP。模块 port 上的 overlay 创建／激活／弃用仍是 DTS coverage adapter。

**D. 测试**

- 比较与 `service.test.ts`：执行的重算 SQL 无 `specification_key` driver 切段，且含 `config_revision_id = br.config_revision_id`；discovery 同样。不要新增 intercept helper。
- Fail-closed：另一 config revision 上更新的 logical-node revision 不得胜出。
- 面板／单元：`listLibrarySpecs` 不请求 `view: "governance"`。
- 保持既有 registration／placement／capacity／kind 测试。
- `hierarchical-modules.acceptance.spec.ts` 保持历史，除非 token 消失；不扩成 T3.2。

**E. 家族外**

不开 T2.2-OPS。不 410 parameter-modules 路由。不 410 overlay 或 parameter-specs governance 处理器。不改 T2.1 fixture 或 TOP relocation。不改写未发布 Scratch 0151–0153。

## 4. Ratchet

1. 实施 A–D。
2. Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` 若能跑完。若 T2.2-TOP `editService.ts` relocation 仍挡住，记录该错误；不改那些 fixture。
3. 只删已消失的 **MOD** 分片条目。不分片增长，不削弱 checker。
4. 回执：MOD 前 **283**，合计前 **3513**，之后计数与 delta。

修完仍留 `specification_key` driver 切段、latest-revision locator 回退、或 `listSpecs({ view: "governance" })` picker，即 Spec 失败，即使 delta ≠ 0。诚实零增量仅当这些泄漏已消失且 checker 被挡住。

port／client 上的 overlay-catalog-contract token 可以留下（DTS coverage adapter）。parse coverage 的 module-import token 可以留到 T1.4。A–C 落地则不算作弊。

## 5. 证据

- `test:server --` 比较贡献 + 若触及的 `service.test.ts`／`driverRegistration.test.ts`／`driverPlacement.test.ts`。`DATABASE_URL` 指向 55438 一次性库。
- picker retarget 的面板／单元测试。
- `git diff --check`。类型变化则 `tsc -b`。
- 浏览器：若 retarget 落地，模块映射 overlay spec picker 1440x900。默认不做其他 UI 扫描。
- 独立 Standards + Spec 实现复审。
- 中英回执与归类组。

Helper PG 55438。

## 6. Spec PASS 后的顺序

1. `repository.ts` 精确 subject 钉 + locator 钉（A–B）。
2. Picker 改目标（C）+ 测试（D）。
3. 可跑则 checker／MOD 分片 ratchet。
4. 回执；评审；停止。不开 T2.2-OPS。不 commit。

## 关键决策

1. **Subject 优于 spec-key。** 重映射身份是 `asub.id`。只把 `asub.source_key` 投影为 scaffolding 用的 `driver_module`。永不 `display_name`。spec-key 切段是 archived notice。
2. **Locator 是 binding tip 的 config revision。** 与 T2.2-DTS 相同。跨 revision 取最新不是钉。
3. **Overlay HTTP 保持。** CGH／DTS coverage。模块 port overlay 方法是 adapter，不是注册表对 Organization-schema 的结构所有权。
4. **Governance 列表不由本家族 410。** 改 picker 调用方。处理器 410 属 T1.4／CGH 遗留。
5. **Picker 优先 catalog definitions；无 catalog 时用 effective 列表。** 永不 `view=governance`。
6. **kind／registration／capacity／counts 保持。** 本家族产品。
7. **允许诚实零增量**，若泄漏已消失且 checker 被 T2.2-TOP relocation fixture 挡住。

## 未决问题

无。overlay-port 删除 vs adapter 已定：adapter 直到 T1.4。Governance 列表 410 在家族外。

## PR 计划

本 todo 不开 PR。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | 精确 subject + locator 钉 | `repository.ts`、测试 | Spec PASS |
| B | Picker 改目标 | `OrganizationModuleGovernancePanel.tsx`、测试 | Spec PASS |
| C | 分片 ratchet | `s12-mod.json`（若 token 消失） | A、B |
| D | 回执 | T2.2-MOD 文档 | C |
