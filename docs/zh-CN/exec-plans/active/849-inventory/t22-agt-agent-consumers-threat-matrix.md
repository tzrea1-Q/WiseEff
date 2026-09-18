# T2.2-AGT Agent 消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-agt-agent-consumers-threat-matrix.md)

契约：#849/#853 T2.2-AGT、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) Agent 工具行、T2.2-FIL [回执](t22-fil-file-consumers-acceptance.md)。产品方向已定。本矩阵冻结 AGT 实施边界。

状态：**Spec PASS with P2 已收口。** 配套：[可实现设计](t22-agt-agent-consumers-design.md)。独立评审 `01a0afc7-92e3-7393-af5a-442594f0cc6c`。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。T1.1–T2.2-FIL 脏候选除 AGT 路径外不重写。
- 允许路径：`actionTools.ts`、`toolRegistry.ts`、`toolMetadata.ts`、`perceptionTools.ts`、比较贡献、其测试、`xiaoze-action.acceptance.spec.ts`、分片 `s12-agt.json`。不抢 LOG／xiaoze／`orchestrator.ts`。
- T2.2-AGT 后停止。不开 T2.2-LOG 及之后。不 commit。
- 默认不做 UI 扫描。
- 评审 grok-4.6（gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。

## 受保护不变量

S12-AGT 每条运行时引用归为 canonical current、精确 canonical 历史或授权归档通知。Agent catalog 读在调用主体范围内。参数变更是 **binding 上的受批草稿**。未解析或过期工具参数 **fail closed**。**过期 checkpoint／工具参数不得复活 legacy PPV／定义写。** Agent 不能铸 spec、改 placement、做 review 决议。

## 接收（2026-09-17）

分片合计 **3513**。S12-AGT **30** 条：生产 `actionTools.ts` 2（submit 上的 `parameterSpecId`）、integration 23、unit 3、e2e 2。规则：sql-write 14、identifier 11、raw-read 3、overlay-catalog 2。

活泄漏：identity mode 为 `legacy` 时仍走 `submitLegacyParameterChange`（`getProjectParameterForUpdate` + 扁平 submit）。单元测试还期望这条 TD-079 路径。语义路径已是 binding + `createBindingDraft`。Perception 已返回 binding id。无铸 spec 工具。xiaoze checkpointer 在分片外；工具层是 AGT 的 fail-closed 闸门。

## 归类冻结

读工具／比较为 canonical-current-agent-read；受批 binding 草稿为 canonical-current-agent-draft；测试／e2e 为历史；legacy 扁平提交为归档（删除）。

## 行

T22A-01 30 按 file×rule；T22A-02 语义 submit 用 binding，不发明 spec id；T22A-03 删除 `submitLegacyParameterChange`（留下即 Spec 失败，不论 delta）；T22A-04 过期／非 binding id 不写 PPV；T22A-05 仍要 durable invocation+approval；T22A-06 无结构写工具；T22A-07 perception 保持 binding 引用；T22A-08 checkpoint 在分片外，工具层拒绝 legacy 写；T22A-09 比较适配器；T22A-10 ratchet 相对 30／3513，诚实零仅当函数已删且 checker 被挡住；T22A-11 默认无 UI；T22A-12 55438；T22A-13 非目标。e2e 保持 binding id。

## 非目标

不清零 30；不 410 Agent 工具；不删 submit `parameterSpecId`；不改 xiaoze／orchestrator／T2.1 fixture／TOP writeLock；不 commit。

## 自评限制

实现者自写。生产改动前必须独立 Spec 评审。
