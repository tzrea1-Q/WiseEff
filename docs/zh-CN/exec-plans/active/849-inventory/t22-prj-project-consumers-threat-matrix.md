# T2.2-PRJ 项目消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-prj-project-consumers-threat-matrix.md)

契约：#849/#853 T2.2-PRJ、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) 工作台行、T2.1 [回执](t21-parameter-ui-acceptance.md)、T2.2-TOP [回执](t22-top-topology-consumers-acceptance.md)。产品方向已定。本矩阵冻结 PRJ 实施边界。

状态：**独立 Spec 评审 PASS with P2。** P2 已收口。配套：[可实现设计](t22-prj-project-consumers-design.md)。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。T1.1–T2.2-TOP 脏候选除 PRJ 归属路径外不重写。
- 允许路径：`parameters/**`、`parameter-drafts/**`、`ParameterRepository.ts`、`parameterClient.ts`、`parameterDtos.ts`、其测试、`project-configuration-workbench.acceptance.spec.ts`、`mockParameterRepository.ts`。
- T2.2-PRJ 后停止。不开 T2.2-FIL 及之后。不 commit。
- 仅当可见工作台／初始化表面变化时才 1440x900。默认：只改 hydration URL 且 `/parameters` tray 已走 v2 则不做 UI 扫描。
- 评审 grok-4.6（gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。不用 `wiseeff_lane_849`，不用 `5432/wiseeff`。

## 受保护不变量

S12-PRJ 每条运行时引用归为 canonical current、精确 canonical 历史或授权归档通知。工作台当前值与待处理草稿以 **binding／`currentValueId`／v2 project-value-drafts** 为身份，不以 `parameterSpecId` 当定义身份，不以 v1 `/parameter-drafts/mine` 当活 tray 主人。已初始化／未初始化／自定义（空库）状态仍走初始化 HTTP。先修再删 allowance。PARAM-INIT Playwright 仍是 **future**（T3.2）。比较适配器不切换。

## 接收（2026-09-17）

分片合计 **3513**。S12-PRJ **422** 条：parameters 生产 225、parameter-drafts 43、测试 152、端口 2、客户端／DTO／e2e 工作台分片 0 行（客户端仍调 v1 drafts）。规则：identifier 138、raw-read 130、unresolved 71、sql-write 70、table-name 10、module-import 3。

T2.1 B5 tray 已走 v2。`parameterRuntime.refresh` 仍 `listDrafts()` → v1 `/mine`。semantic `saveDraft` 已 409。T2.1 helper 仍 v1 DELETE，本 todo 不 410。`semanticParameterReads` 已用 `b.id`。初始化 HTTP 仍在；PARAM-INIT-* 覆盖为 future。

## 归类冻结

工作台 list/get 与 v2 草稿为 canonical current；初始化 HTTP 为 canonical current；submit/init 上的 `parameterSpecId` 为 DTS spec 字段；测试为历史。归档：活草稿主人不再是 v1 `/mine`（客户端在已知 projectId 时离开）；**不** 410 v1 GET/DELETE。

## 行

T22P-01 422 按 file×rule 四标签；T22P-02 工作台行用 binding id；T22P-03 `listDrafts(projectId)` 与 refresh 走 v2；T22P-04 带 projectId 的删除走 v2；T22P-05 v1 saveDraft 保持 CONFLICT；T22P-06 初始化状态保持 2xx；T22P-07 PARAM-INIT e2e 仍 future；T22P-08 submit 仍允许 `parameterSpecId`（T2.1）；T22P-09 mock 不铸定义；T22P-10 比较适配器；T22P-11 ratchet 相对 422／3513；T22P-12 默认无 UI 扫描；T22P-13 55438；T22P-14 非目标。

## 非目标

不清零 422；不 410 v1 mine／DELETE；不做 PARAM-INIT Playwright；不从 submit schema 删除 `parameterSpecId`；不抢 FIL；不 commit。

## 自评限制

实现者自写。生产改动前必须独立 Spec 评审。
