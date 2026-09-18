# T1.4 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t14-final-legacy-cutover-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
结论：**PASS with P2**

独立 Spec 复审 [设计](t14-final-legacy-cutover-design.md) 与 [威胁矩阵](t14-final-legacy-cutover-threat-matrix.md)，并对照英文双胞胎与 todolist T1.4 段。评审者未写设计。评审本身不改生产代码、不 commit、不执行 T2.3 删除、不开 PR、不把 T1.4 标完成。

先前 FAIL `01a0b09b-727a-7128-9ec2-9e13c8668c97`。本次复审 `01a0b0a8-0492-434d-6fbb-ac1520d36674` **PASS with P2**。先前 P1-1、P1-2 **已关闭**，不再列为未决 P1。可以开始修复 A 的生产实现。下面的 P2 应在同一轮设计修补或首批实现提交中一并处理。本评审不把 T1.4 标完成。

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。已独立复测工作区 `git hash-object` 与冻结 dest。Checker 顺序仍是 exact → post-cutover → debugging-transfer → source-workflow（先历史证明，再当前扫描）→ consumer。共享 `requireMatch` 前缀 `Runtime topology relocation rejected` 是 runner，不能当作历史 runtime-topology 正在对照工作区失败的证据。

## P1

无未决项。

## P2

1. **关键决策 5 与修复 B／T14-03。** 门禁以修复 B 与 T14-03 为准：B 之后残留分片行仍是 remaining current；点名所有者不算零；扫描命中仍在则 T1.4 未完成；exact-canonical-history 是回执分类，不是纸面清零。关键决策 5 仍写「诚实的残留 history 必须点名」。单独读会重现先前 P1-2。把关键决策 5 收到 B 的句子：点名只用于回执。

2. **`recordSha256` 时序。** A 必须同时改两份当前 JSON 与 `sourceWorkflowRelocation.ts` 里对应的 `recordSha256`，否则 integrity 失败。本次设计 PASS 授权按当前扫描生成那些字节。「新字节的 Spec 再评审 PASS」是 A 的**实现** Spec，不是阻止开工 A 的第二道设计门。

这些不重开当前／历史划分、pair `new` 重绑、或零当前诚实门。

## 已关闭的先前 P1（不要重开）

- **P1-1 Destination 继任范围 vs 历史证明（T14-01／T14-02／T14-04）。** 修复 A／T14-02 现已点名只改 `source-workflow-relocation.json` 与 `source-workflow-consumer-relocation.json`（及那两处 `recordSha256`）。允许：重算当前 dest OID；把每对 `new` 绑到扫描器的 exact destination occurrence（`requireStableStructuralAnchor` = id 前三段；第 4 段 fingerprint、`trustedBlobOid`、行列、字节偏移 = 当前扫描）。禁止：孤立改 dest OID、删 pair、allowance 增长、跳过、改 source 库存、改历史 JSON dest OID 或 provenance。历史保持 `runtime-topology-relocation.json`／`edit-service-version-index-relocation.json`，钉在 `e31226b6…`／`8ef8f251…`／tree `38f9040e…`。找不到 span 则 fail closed。下一 dest-blob 若出在历史记录上则停。

  独立 dest 哈希：当前漂移正是上述文件——source-workflow 的 `editService.ts` 26（`0d87d79a…` → `0052e18d…`）与 `editService.test.ts` 28（`22cd4709…` → `edcd0ff5…`）；consumer 的 import-wizard 2、topology e2e 83、`writebackService.ts` 21、`parameterTopologyClient.test.ts` 22、`parameterTopologyClient.ts` 33。`overlayWriteback.ts` 已与 `2c568b87…` 一致。其余当前扫描记录 MATCH，保持钉住：`post-cutover-test-relocation.json`、`debugging-transfer-relocation.json`、`property-key-cutover-relocation.json`，以及两份 successor 内已 MATCH 的文件。历史 dest OID 与工作区哈希不同（预期如此），不得改向工作区。

- **P1-2 中文修复 B 与残留 history token。** 中文修复 B 现已与英文对齐：剩余扫描命中必须为 0；checker 不区分 history／test；残留分片行是 remaining current；点名所有者不算零；分片行仍在则 T1.4 未完成；exact-canonical-history 是回执分类，不是纸面清零。T14-03 中英同义。

## 已关闭的先前 P2（已纳入）

- pair **old** id 全保留。pair **new** 只保留稳定结构锚（前三段）。第 4 段、`trustedBlobOid`、行／列、字节偏移必须等于当前扫描。整段 `new.id` 字面不变已禁止（英文修复 A／T14-02 与中文修复 A）。
- 中文修复 C 保留：模块 picker 仍是 DTS adapter 时 overlay 保持 2xx；governance **列表**仅在无现场调用方后 410；**详情**保持 2xx（CGH P1，T2.1 `semanticBindingFixture`）；不改该 fixture；dual-write／TD-125 仅在有具名继任时删除；T2.3 删除／PR／目标机仍是非目标。

## 已核对（不要重开为 P1）

- **Governance 详情保持 2xx（CGH P1）。** 获胜 `GET /api/v2/parameter-specs/:specId` 与列表 `GET /api/v2/parameter-specs` 是不同路由。T2.1 `semanticBindingFixture.ts` 用详情 `?view=governance`。API 模式挂 `CatalogOrganizationSurface`；`OrganizationSpecGovernancePanel` 是 mock／无 catalog。保持**详情** 2xx；列表仅在无现场调用方后才 410。不 410 详情。
- 孤立改 dest OID 已禁止。pair `new` 必须重绑当前扫描。历史 dest OID 保持。这不是弱化 checker。
- Overlay 在仍有现场产品调用方时保持（MOD picker 仍是 DTS adapter）正确。
- 不删 T2.3 归档表，不开 PR，Helper PG 仅 55438。
- 围栏／旧重放若本 todo 不是 epoch 写入方可记为 T2.3／T3.1 契约；重启拒绝复用 T1.3 + OPS CLI 410。

只对点名的两份当前 successor 开工修复 A。不要改历史 dest OID。分片行仍被扫描时不得声称 T1.4 清零。
