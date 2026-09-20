# T2.1 设计 Spec 评审

> English: [English](../../../../exec-plans/active/849-inventory/t21-parameter-ui-spec-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna / max 不可用）
结论：**PASS with P2**

独立评审 [t21-parameter-ui-design.md](t21-parameter-ui-design.md) 与 [t21-parameter-ui-threat-matrix.md](t21-parameter-ui-threat-matrix.md)。评审者不是设计作者。不改生产代码、不 commit、不把 T2.1 标为完成。中英孪生已抽查：决策对等。

## P1

无未决项。可以开始实现；下列 P2 随首次提交收口即可。

## P2

1. **初始化证据所有者。** Todolist T2.1：「注册、初始化、诚实空态／错误态」。T21-09 写成「既有 negative／init spec」。独立检查：`operationMatrix.ts` 中 `PARAM-INIT-*` 均为 `coverage: "future"`（覆盖地图 Blocking: No），没有 Playwright 所有者。设计 §5「只补缺失的 B5 现场用例和未匹配导入断言」会跳过它们。要么给 T2.1 一个 Playwright 所有者，要么明确延期到 T2.2-PRJ／T3.2。不要声称已有 init spec。

2. **未匹配导入定位。** Todolist：「通过既有 observation/authoring 流程修复未知导入行的误导预览」。抽查：`matchToLibrary` 把未匹配行标成没有 `existingParameter` 的 `status: "pending"`（测试称「pending new candidates」）。真正铸造 UI 是 `ImportReviewCard`（`pending && !existingParameter` →「预填并创建」）、`new-confirmed`、`toSourceItems`（发送 approved／new-confirmed）、StepParseReport「新增候选」、StepRowReview `RESOLVED_STATUSES`。`isEligibleImportItem` 看的是批次 `added`／`updated`，不是行 status。新 `unmatched` 若落入卡片 `default` 会显示「通过」。把向导文案对准这些缝；未匹配行保持可见且禁用。`reconcileReviewedRows` 目前会把未决议行重新标成 `pending`。

3. **T21-02 `updatedAt`。** 矩阵：重载后托盘显示 `reason` 和 `updatedAt`。设计 §4 步骤 5：看得到 `reason`；没有发明的 `parameterId`。把 Playwright 用例与矩阵对齐。既有 `PARAM-DRAFT-REMOVE-001` 在 canonical POST 草稿之后仍等待 `DELETE /api/v1/parameter-drafts/` — 按设计改瞄准即可。

## 已核对并接受

- #847 已关闭。`/parameter-admin/specs` 上的 `CatalogPage` 即工作区。decision-6 剩余编辑器字段（`schemaDefault`、可编辑约束、编辑器 examples）不是 T2.1，除非挡住操作清单。
- B5：`createCanonicalDraftTraySource` 列出／删除 `GET|DELETE /api/v2/projects/:projectId/parameter-value-drafts`。`ParametersPage` 在 API 模式注入。单测禁止 `/api/v1/parameter-drafts`。现场浏览器证明是点名缺口。
- `docs/FRONTEND.md` 与 `docs/zh-CN/frontend.md` 仍把托盘删除写成 `DELETE /api/v1/parameter-drafts/:draftId`。
- 数据面：既有一次性 post-cutover 运行时；Gate0 不跑 T1.3 124×3；mock ≠ 验收；1440x900；helper PG 55438，不用 `wiseeff_lane_849`。
- 复用既有 Playwright 所有者；不建第二套工作台；不做 T2.2／T1.4／T3.x；本 todo 不开 PR。
- T21-10：一次性 fixture 没有 ConfigurationSchema binding 时，用 parameter-files + Pointer 编辑证明 JSON，可接受。
- 中英决策对等（未匹配不合格、B5 现场托盘、复用 #847、T21 行、停止边界）。

按设计 §3–§5 与矩阵 T21-01…T21-18 开始实现。P2 在同一次文档修订或首次实现提交中收口。
