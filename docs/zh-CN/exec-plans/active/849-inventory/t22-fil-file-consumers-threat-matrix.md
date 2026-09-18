# T2.2-FIL 文件消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-fil-file-consumers-threat-matrix.md)

契约：#849/#853 T2.2-FIL、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) 文件同步／写回行、T2.2-PRJ [回执](t22-prj-project-consumers-acceptance.md)。产品方向已定。本矩阵冻结 FIL 实施边界。

状态：**Spec PASS with P2 已收口。** 配套：[可实现设计](t22-fil-file-consumers-design.md)。独立评审 `01a0afa4-6152-77c2-947b-87f66c9304aa`。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。T1.1–T2.2-PRJ 脏候选除 FIL 路径外不重写。
- 允许路径：`parameter-files/**`（含 `syncService.ts`、`schemas.ts`、`candidateRepository.ts`）、`ParameterFileRepository.ts`、`parameterFileClient.ts`、其测试、`parameter-files.acceptance.spec.ts`、`mockParameterFileRepository.ts`、分片 `s12-fil.json`。不抢 AGT。
- T2.2-FIL 后停止。不开 T2.2-AGT 及之后。不 commit。
- 默认不做 UI 扫描（后端 pin 修复）。
- 评审 grok-4.6（gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。不用 `wiseeff_lane_849`，不用 `5432/wiseeff`。

## 受保护不变量

S12-FIL 每条运行时引用归为 canonical current、精确 canonical 历史或授权归档通知。文件同步／写回匹配 **canonical binding + occurrence/source pin**。未解析身份 **fail closed**。**禁止仅凭 property-key 回退**，**禁止把 `parameterDefinitionId` 当成 `parameterSpecId`**。candidate／source／version／config-set／baseline／export 仍归文件模块。先修源 SQL 再删 allowance。不得保留扫描器可见、运行时再改写的回退 SQL。比较适配器不切换。

## 接收（2026-09-17）

分片合计 **3513**。S12-FIL **56** 条：生产 35（`writebackService.ts` 21、`syncIdentity.ts` 8、`conflictService.ts` 3）、测试 17、E2E 2、客户端 2。规则：identifier 34、sql-write 9、raw-read 8、unresolved 5。

`findBindingBySource` **源 SQL** 仍 `coalesce(dps.property_key, split_part(ps.specification_key, '/', 2))`。运行时 `pinP` 给 `db.query` 打补丁，执行时去掉回退，扫描器仍看见回退。这不是诚实 pin。写回 overlay 用 `parameterSpecId ?? parameterDefinitionId`。冲突插入在 semantic 模式同样强转。

## 归类冻结

文件 membership／带锁写回为 canonical current；精确 pin 为 `dps.property_key`；测试／e2e 为历史；`split_part` 回退与 intercept 为归档（删除）。

## 行

T22F-01 56 按 file×rule；T22F-02 源 SQL 只用 `dps.property_key`；T22F-03 缺 property_key fail closed；T22F-04 删除 `pinP`／`pinW` intercept，写回源 SQL inner join；T22F-05 写回从锁定 binding 取 spec id；T22F-06 冲突不强转，语义同步传 `parameterSpecId`；T22F-07 membership 保持 2xx；T22F-08 客户端／mock；T22F-09 比较测试改断言精确 SQL；T22F-10 ratchet 相对 56／3513，源 SQL 仍含 split_part 则 Spec 失败；T22F-11 默认无 UI；T22F-12 55438；T22F-13 非目标。

## 非目标

不清零 56；不 410 文件路由；不改 T2.1 fixture；不抢 AGT；不 commit。

## 自评限制

实现者自写。生产改动前必须独立 Spec 评审。
