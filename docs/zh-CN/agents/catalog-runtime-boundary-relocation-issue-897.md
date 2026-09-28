# Issue #897 T14 Catalog 边界后继记录

> English: [English](../../agents/catalog-runtime-boundary-relocation-issue-897.md)

Issue #897 修改了 `server/modules/parameter-modules/repository.ts` 和 `service.test.ts`。原 T14 记录是固定的历史证据，不能刷新：265 对 family 记录的 SHA256 仍为 `6e55b1378acf6f4439392ae53971092a996c12b41fe358fa31622f052e7f4cf2`，57 对改写片段记录仍为 `56216b0d2463f74a764159e86caf5fa3ab50d3f0e957b66362a840d2294b86a7`。当前别名生效前，必须在已验收 commit `097ad35625cc8ca2401f2cd028404f16a18a75ba`、tree `74b3df3635590d34738896e550e31eb9c8db0948` 上完整证明这两份记录。原 fixture、可信基线 `9b3ba7df7e21f5589684bc92c872da593ad4c246` 和历史记录字节均不改变。

两个改动文件共有 49 个历史源 ID；其中恰好 45 个仍存在并有经复核的后继，以下 4 个已退役 ID 从 `s12-mod.json` 精确移除，当前扫描也不得重新出现：

```text
S12-MOD:legacy-catalog-table-name:860a2404dfe5c6b4:8cd263657607ec3e
S12-MOD:legacy-parameter-spec-identifier:59ee771a428f0978:7d4a0c6f2bb42f1c
S12-MOD:legacy-parameter-spec-identifier:59ee771a428f0978:95f694f205d9301b
S12-MOD:legacy-parameter-spec-identifier:59ee771a428f0978:0302adf87a58e40f
```

| 当前后继记录 | 配对数 | 记录 SHA256 | 保留的约束 |
| --- | ---: | --- | --- |
| [Repository 未改写片段](../../../scripts/fixtures/parameter-catalog-allowlist/issue-913-t14-successor-relocation.json) | 13 | `a0f5d0caa2b6e5248441f8843a53c1143ac96d62227221775ae5d471ab308a0b` | 元数据精确、源/目标片段相同、结构锚点和字节顺序稳定 |
| [Repository 改写片段](../../../scripts/fixtures/parameter-catalog-allowlist/issue-913-t14-rewritten-repo-successor-relocation.json) | 7 | `947ed35426467b1aadd1f7dc634830f20748d0163448a5421e0c4b0ed424a4d4` | 源/目标摘要精确、结构锚点和字节顺序稳定；其中 2 对的 evidence 变化 |
| [Service 测试未改写片段](../../../scripts/fixtures/parameter-catalog-allowlist/issue-913-t14-service-successor-relocation.json) | 25 | `ed511587dcca81969d4ebbefbe8ef043f36daedf8e8de0edf0c02c6ed9fa8077` | 元数据精确、片段相同、结构锚点稳定；3 组同锚点出现次序调整 |

Repository 后继将源 blob `317be751e3dc08d55a6ae13bd9d65cd10aab48fb` 精确绑定到当前 blob `204e51efd0a3fb30a50bb9280d1eae2f72f50e3d`；Service 测试将源 blob `446feecddef52b95c724121bff44a28f5e82cb8e` 绑定到当前 blob `ff6bd61fc8e9fcca54123066f078fb2eb0cff48a`。复核扫描在每个固定的 `file + line + token` 上都找到唯一目标；column、byte span、evidence、reason 和结构锚点不变，仅 occurrence ID 与可信整文件 blob 随文件身份变化。每一对还必须匹配固定的旧观察项和当前 scanner 的目标观察项。不新增 allowance。

独立的 stale allowance 后继记录覆盖80个旧ID中的63对精确匹配：S12-MOD 33对，S12-PRJ 30对。记录保留精确源/目标片段、元数据、结构锚点和字节顺序。其余17个ID已退役并从所属 shard 移除：`s12-mod.json` 15个、`s12-prj.json` 2个。旧 `repository.ts:66` 的 `BindingCountRow.parameter_spec_id` 已随类型删除而退役；旧331行的 `RecomputeBindingDbRow.parameter_spec_id` 是不同所有者，映射到当前386行字段。两个退役的 S12-PRJ 观察项分别是已迁入 Governance current-binding 查询 owner 的旧 `project_parameter_bindings` 读取，以及已删除的旧表名 unresolved 表达式。固定 ID 和分区定义见[后继 helper](../../../scripts/parameter-catalog-allowlist/issue913StaleSuccessorRelocation.ts)。

| 后继记录 | 配对数 | 记录 SHA256 | 保留约束 |
| --- | ---: | --- | --- |
| [Stale allowance 后继](../../../scripts/fixtures/parameter-catalog-allowlist/issue-913-stale-successor-relocation.json) | 63 | `6051c3bddfe35eae74d38f01c05661a3353bb330bdbe921f02cbfdf7eb95c2d3` | 元数据与片段精确、结构锚点和字节顺序稳定 |

Checker 中，未改写 family 228 对、原改写记录45对及 T14 新后继45对共贡献318个 T14 别名；独立 stale allowance 阶段再增加63个，全链共817个活动 relocation。缺失、重复、跨记录或重新出现的端点，记录或整文件 blob 变化，allowance 增长，以及两个固定分区不成立（T14 为49 = 45 + 4，stale allowance 为80 = 63 + 17）均拒绝。无关的当前观察项不会被隐式映射。这些记录只证明观察项身份；模块管理行为和权限仍由独立的 PostgreSQL 与浏览器测试证明。
