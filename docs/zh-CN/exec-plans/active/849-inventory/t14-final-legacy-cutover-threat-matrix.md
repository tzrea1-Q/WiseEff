# T1.4 最终 legacy cutover — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t14-final-legacy-cutover-threat-matrix.md)

契约：#849/#853 T1.4。十一族 T2.2 已是本地候选。本矩阵冻结汇总 cutover 边界。

状态：**独立 Spec FAIL 后已修订。** 配套：[可实现设计](t14-final-legacy-cutover-design.md)。等待 Spec 再评审。不 commit／PR／封印／目标机／破坏性归档／Issue。

## 车道

工作树 `849-853-t11-source-identity`。用户已解除逐项确认。Helper PG 仅 55438。评审 grok-4.6。

## 不变量

T1.4 后 **当前** legacy catalog allowance 为零，不弱化 checker，无隐藏引用。fallback／mixed read／dual-write／TD-125 仅在继任契约满足后离开。生产角色 HTTP／worker 拒绝旧**当前**读写。重建 epoch 只围栏受影响的旧草稿；无关历史保留；重启拒绝旧重放。

## 接收

分片合计仍 **3513**（诚实零增量未删 token）。Checker 因 `editService.ts` destination whole-file blob 失败。冻结 dst `0d87d79a…`，当前 `git hash-object` `0052e18d…`。T2.2 禁止改这些 fixture；**T1.4 拥有用已评审 destination 继任记录解锁 checker**，不得删 pair 或允许 allowance 增长。

## 行

T14-01 checker 可跑完。T14-02 **只**重绑当前 successor（`source-workflow-relocation.json` + consumer 记录）的 dest OID 与 pair `new`；历史 version-index／runtime-topology dest OID 与 provenance **不变**。T14-03 扫描命中为零；checker 不区分 history；点名所有者不算零。T14-04 不弱化。T14-05 延迟 410 仅当无现场调用方；governance **详情**保持 2xx。T14-06 不 reseed。T14-07 dual-write。T14-08 拒绝。T14-09 围栏。T14-10 非目标：T2.3 删除、目标机、PR。

## 自审限度

生产改动前必须独立 Spec。
