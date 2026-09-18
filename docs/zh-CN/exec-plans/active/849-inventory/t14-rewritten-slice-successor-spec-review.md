# T1.4 Repair B2 改写切片 successor — Spec 再评审

> English: [English](../../../../exec-plans/active/849-inventory/t14-rewritten-slice-successor-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
结论：**PASS with P2**

独立 Spec 再评审修订后的 [t14-rewritten-slice-successor.md](t14-rewritten-slice-successor.md) 与中文双胞胎（针对 FAIL `14b8dc20-270b-43f3-b1fa-5c401da78239`）。评审者未写该补丁。评审本身不改生产代码、不 commit、不开 Repair C、不开 PR、不把 T1.4 标完成。

本次再评审 `9e09e874-cae5-4e98-af76-c5f6cd638731` **PASS with P2**。先前 FAIL `14b8dc20-270b-43f3-b1fa-5c401da78239` 的 P1（序与 51／stale 0／剩余 48+1 不能同时成立）**已关闭**。先前设计复审 `01a0b0a8-0492-434d-6fbb-ac1520d36674` PASS with P2 保持关闭，不重开。可以开始 B2 生产改动。下面的 P2 应在同一轮设计修补或首批实现提交中一并写入。本评审不把 T1.4 标完成。

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。独立复读 B1 后 checker JSON `/tmp/t14-ratch.json`：unallowlisted **100**，stale **51**，growth **0**，relocations **476**，分片 **3503**（allowlisted 3452 + stale 51）。今日校验器（`runtimeTopologyRelocation.ts`）的 unchanged-key 循环与 `identical raw slice` 仍是无条件的。尚无 `requireIdenticalSlice`／`requireUnchangedEvidence`。`requireStableByteOrder` 为可选，其 key 仍是前三段 + `token` + `evidence` + `column`，dest `byteStart` 严格大于。共享 pair schema 仍是只有 `sliceSha256` 的 `.strict()`。这是当前代码，不是未决设计 P1。

独立 dry-pair 这 51 条（同一 file／family／rule／token／reason／前三段；允许 evidence、column 变；顺序键为前三段 + `token`；按 `old.byteStart` 处理）：

- **14 组／51 中 30** 共享该键。
- 没有并列例外：**50** 对、**1** 条未配 stale（`parameterReferences.ts` `read:parameter_specs` 4253），剩余 unallowlisted **50** = 48 个新 base-id + 2 条同锚多余 dest。
- dest `byteStart` **仅当** `old.byteStart` 也并列时才允许相等：**51** 对、未配 stale **0**，剩余 unallowlisted **49** = **48 个新 base-id + 1 条同锚点多余 dest**。
- 多余 dest 是 `writebackService.ts` `read:project_parameter_bindings` dest **26362**（stale **8334** 映射到 dest **7432**）。不得为 26362 臆造 dest span。
- 同键上不同位置 dest 对调被拒绝（KNW 2737↔4195 失败；DTS `dts_property_specs` 8790↔10936 失败）。同一 dest 范围上两个 2737 的对调不是位置对调：occurrence 第 4 段哈希 `evidence`，它们是同一范围上的不同 id。

## P1

无未决项。

## P2

在同一轮设计修补或首批 B2 提交中写入。不要重开已关闭的 P1。

1. **较粗的 byte-order key 与并列例外必须绑到 `requireUnchangedEvidence === false`。** 带 `requireStableByteOrder: true` 的历史／B1 记录仍在现行 key 里保留 `evidence` 与 `column`，dest 仍严格大于。不要只要开了 byte-order 就全局丢掉它们，也不要把相等 dest 例外装到那些记录上。独立核 136 对 B1 文件在前三段 + token 下有 **2** 处 dest 序失败（`parameter-modules/service.test.ts`，dest 序列非单调，不是 old／dest 并列）。consumer 202 对文件有 **5** 组同范围相等 dest，只有 B2 例外才能通过。英文对顺序键写「evidence 可变时」，对 unchanged-key 循环绑了 flag；顺序键用同一 flag。中文仍缺 unchanged-key 循环那句。

2. **中文 T14-01 例外与 dest 对调测试。** 中文写了默认 true、禁止在 B2 以外设 false，但没有点名 T14-01 例外（英文有）。中文已有 dest 严格递增 + 并列例外，以及「仍拒绝不同位置 dest 对调」，但没写按 `old.byteStart` 处理，也没写测试必须拒绝同键上不同 `byteStart` dest 对调。中文补上同一例外、同一处理顺序和同一测试。

3. **Why A/B1 的 15／36 与「49 个新前三段」只是说明。** 独立非贪心划分是 **18** 条 token／evidence／column 全匹配、**33** 条只差 evidence／column，不是 15／36。配对前带**新**前三段的 unallowlisted 是 **48**，不是 49。B2 操作剩余 **48+1 多余 dest = 49** 才是配对计数。不是第二条配对规则。

`requireIdenticalSlice` 为 false 时，B2 pair 仍须**存储并证明**两个摘要（这些 pair 上 `sourceSliceSha256` 必填，即使共享 `.strict()` 字段可选）。中文已写存储两份摘要；保留「对文件证明两份」这句。

## 已关闭的先前 P1（不要重开）

- **P1-1 序的文本**（FAIL `01a0b21c-f9d5-42b3-a08f-3ffa5821c3e5`）。`requireStableByteOrder: true`；evidence 可变时顺序键只有前三段 + `token`（不含 evidence／column）；测试拒绝同锚点同 token dest 对调。中英 twin 都有这段文字。

- **P1-2 序与 51／stale 0／剩余 48+1**（FAIL `14b8dc20-270b-43f3-b1fa-5c401da78239`）。中英现都允许 dest `byteStart` **仅当** `old.byteStart` 也并列时与上一条相等（同范围双重观测：`parameterReferences.ts` `read:parameter_specs` 2857→2737 两次）。用该例外映射全部 **51** 条 stale。剩余是 **48 个新 base-id + 1 条同锚点多余 dest**（writeback）。仍拒绝不同位置 dest 对调。不得臆造 dest span。独立 dry-pair 确认这四项可以同时成立。

## 被要求决定的 P1（保持关闭）

1. **在点名的 B2 当前记录上允许 evidence＋切片改写、flag 在别处默认 true，并不弱化历史记录的 checker。** T14-04 的弱化是删 pair、`--skip`、丢掉 mapping 的 fixture 改写、改历史 dest、孤立改 dest OID。仅点名的 B2 文件把 flag 设为 false，并用双切片摘要分别证明 source `git show` 与工作区 dest，就是授权的改写切片 successor，**不是**全局跳过。历史／source-workflow／consumer／136 对 family 记录保持 identical-slice。

2. **剩余仅 unallowlisted 的命中仍必须挡住 T1.4 清零。** 补丁同意。B2 后诚实剩余 **≈49**，T1.4 保持开放。Repair C 仍等待。

3. **历史记录必须保持 identical-slice。** 补丁同意。未设置视为 `!== false`。不要把新 flag 接到 `exactRelocation.ts`。

## 已关闭的先前 P2（已随 P1 修补写入）

- 共享 `.strict()` schema 上 `sourceSliceSha256` 可选（英文）。中文已写可选 `sourceSliceSha256`；若为 P2-2 改中文，补上 `.strict()`。
- leftover 是 **48+1 多余 dest**，不是 49 个新前三段（中英 B2 正文）。
- T14-01「发明 checker flag」不适用于这些点名、默认 true 的 B2 flag（英文；中文见 P2-2）。
- 中文 dest 序现已含并列例外与不同位置 dest 对调拒绝（测试／按 `old.byteStart` 处理见 P2-2）。

## 已核对（不要重开为 P1）

- 禁止涨 allowlist。禁止删扫描规则。禁止拆 T2.2 pin。dest `new` 必须是当前扫描；找不到 dest span 则 fail closed。不得为 writeback 多余 dest 26362 臆造 dest span。
- 应用顺序在 136 对 family 记录**之后**。
- 关闭 identical-slice 时用双切片摘要；历史记录仍拒绝切片不一致。
- Repair C 的 overlay 保持／governance **详情** 2xx 不变。不 commit。
- 前三段 + token 不唯一（14／30）。唯一不是位置对调的同键 dest 碰撞是 KNW 相等 `byteStart` 那一对；occurrence id 构造（第 4 段哈希 `evidence`）区分它们。byte 序仍必须拒绝不同位置 dest 对调。
- writeback `read:project_parameter_bindings` 确是同锚多余 dest（stale 8334 → dest 7432；剩余 dest 26362）。

只对点名的当前 successor 文件开工 B2。写入 P2，避免校验器把历史／B1 的 byte-order key 变粗。不要声称 T1.4 清零。
