# T1.4 最终 legacy cutover — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t14-final-legacy-cutover-design.md)

配套[威胁矩阵](t14-final-legacy-cutover-threat-matrix.md)。

状态：**独立 Spec FAIL 后已修订（`01a0b09b-727a-7128-9ec2-9e13c8668c97`）。** P1 已收口。仅在 Spec 再评审 PASS 后实施。

## 1. 做什么

十一族之后的汇总门。先让 checker 能跑。再测量并只删已消失 token。仅当无现场调用方时 410 剩余当前面。不弱化 checker。不删归档表。

## 2. 修复 A — 只改当前 successor（阻塞）

历史记录（`runtime-topology-relocation.json`、`edit-service-version-index-relocation.json` 的 dest OID、provenance `e31226b6…`／`8ef8f251…`）**不得**改成工作树 hash，那是弱化 checker。

只改当前 successor：`source-workflow-relocation.json` 与 `source-workflow-consumer-relocation.json`（及 `sourceWorkflowRelocation.ts` 里对应 `recordSha256`）。漂移文件：editService.ts／.test.ts；import-wizard／topology e2e；writebackService.ts；parameterTopologyClient.ts／.test.ts。`overlayWriteback.ts` 已匹配。

对上述当前记录：保持 source blob 与 pair `old` 完整 id；重算当前 dest OID；把 pair `new` 绑到**当前扫描**的 exact occurrence（稳定锚点为 id 前三段；第 4 段 fingerprint、trustedBlobOid、行列、字节偏移必须等于当前扫描）。找不到同锚点扫描命中则不臆造 mapping。实测 T2.2 修复使当前 successor 退役 8 对（writeback 7 + topology client 1）；consumer 210→202。历史记录不变。

## 3. 修复 B — 测量与 ratchet

A 落地后跑 checker。合计前 **3513**。只删已消失条目。剩余扫描命中必须为 0。Checker **不区分** history／test。给 leftover 点名所有者 **不算** 零。T1.4 在分片行仍在时 **未完成**。exact-canonical-history 是回执分类，不是纸面清零。

## 4. 修复 C — 剩余当前面

Overlay：模块 picker 仍是 DTS adapter → 保持 2xx。Governance **列表**仅当无现场调用方才 410；**详情**保持 2xx（CGH P1，T2.1 `semanticBindingFixture` 走详情）。不要改 T2.1 fixture。parameter-modules 写路径按过渡终态，读保持。seed 完成重放已是 no-op。Dual-write／TD-125 仅在有具名继任时删除。围栏／无关历史／T2.3 删除、PR、目标机仍是非目标。

## 关键决策

解锁 checker 属 T1.4，条件是历史记录保持钉住，只重绑当前 successor 的 dest 与 pair `new`。孤立改 dest OID 是弱化。不 commit。

## PR 计划

本 todo 不开 PR。
