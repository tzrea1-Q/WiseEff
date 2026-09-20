# T1.4 Repair B2 — 改写切片的当前 successor

> English: [English](../../../../exec-plans/active/849-inventory/t14-rewritten-slice-successor.md)

对 [t14-final-legacy-cutover-design.md](t14-final-legacy-cutover-design.md) 的补丁。生产改动前必须独立 Spec。不 commit。

状态：**Spec 再评审 PASS with P2 已折入。** 独立评审 `9e09e874-cae5-4e98-af76-c5f6cd638731`。B2 生产已开始。T1.4 仍未清零。

## 为什么 A/B1 不够

A + 136 对相同切片 + 10 条消失 ratchet 之后：unallowlisted 100，stale 51。51 条 stale 都与某条 unallowlisted 共享 `family:rule:base`。独立非贪心配对把 51 拆成 **18** 条 token/evidence/column 全同与 **33** 条仅 evidence/column 不同（正文 15/36 只是说明，不是第二套配对规则）。相同原始切片 relocation 无法映射那 33 条。禁止涨 allowlist。不能拆掉 T2.2 pin。本补丁不改扫描器规则。配对前带**新**前三段的 unallowlisted 是 **48**，不是 49。B2 操作剩余是 **48+1 多余 dest = 49**。

## B2 做什么

在 136 对 family 记录之后增加一份当前 successor：`t14-rewritten-slice-successor-relocation.json`。

仅当：前三段 id 相同；同一 file／family／rule／token／reason；old 为 stale；new 为 unallowlisted；无交叉记录。**允许 evidence、column、原始切片变化。**

**必须 `requireStableByteOrder: true`。** 更粗顺序键与 dest-`byteStart` 并列例外**仅当 `requireUnchangedEvidence === false`** 才生效，以免把 B1 变粗。此时按 `old.byteStart` 处理；顺序键只有前三段 + `token`（不含 evidence/column）。dest `byteStart` 必须严格大于该键上一条 dest，**除非** dest `byteStart` 相等且 `old.byteStart` 也并列（同一源范围、同一 dest 范围上的两条 detector，例如 `parameterReferences.ts` `read:parameter_specs` 2857→2737 两次）。B1 记录保持含 evidence 的顺序键和严格 dest 递增。测试必须拒绝同一键下不同 `byteStart` 的 dest 对调。用该并列例外映射全部 **51** 条 stale。unallowlisted 剩余 **48 新 base-id + 1 条同锚点多余 dest**（writeback）。不要为多余 dest 臆造 span。

`RelocationConfig` 新增默认 true 的 `requireIdenticalSlice` 与 `requireUnchangedEvidence`（未设置视为 `!== false`，仍要求相同切片）。仅 B2 设为 false。历史／source-workflow／consumer／136 对 family 记录不得设 false。不要把 flag 接到 `exactRelocation.ts`。T14-01「发明 checker flag」不适用于这些**具名、默认 true** 的 B2 flag。共享 `.strict()` pair schema 上 `sourceSliceSha256` 可选；B2 在 `requireIdenticalSlice === false` 时仍必须存储并对照源 `git show` 与工作区 dest **证明** `sourceSliceSha256` 与 dest `sliceSha256`。不要求 oldBytes 等于 nextBytes。

预期约 51 对。unallowlisted 剩余是 **48 个新 base-id + 1 条同锚点多余 dest**（writeback `read:project_parameter_bindings`），不是 49 个新前三段。T1.4 **仍未清零**。

## 禁止

不同前三段 id；涨 allowlist；删扫描规则；臆造 dest span。

## 证据

B2 后 stale 0；unallowlisted **49**；growth 0。新 flag 的测试：历史记录仍拒绝切片不一致；B2 记录接受 evidence/切片改写，仍拒绝交叉记录／涨 allowlist／缺失 dest；同一键下不同位置 dest 对调必须抛错。不 commit。
