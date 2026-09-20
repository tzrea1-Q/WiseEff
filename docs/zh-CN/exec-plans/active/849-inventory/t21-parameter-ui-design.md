# T2.1 canonical 数据上的参数 UI — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t21-parameter-ui-design.md)

配合[威胁矩阵](t21-parameter-ui-threat-matrix.md)。复用 #847、B5 接线与既有 Playwright 所有者。ADR-0046 与 T1.3 已关闭的产品问题不再讨论。

状态：**设计 Spec PASS with P2（grok-4.6）。** 实现本地候选完成：[回执](t21-parameter-ui-acceptance.md)。无 commit。

## 1. T2.1 是什么

T2.1 是 canonical Catalog 数据上参数 UI 的 **集成与现场证据**，外加两处诚实修复（B5 现场托盘、未匹配导入预览）。它不是新工作台，也不是 T2.2。

| 缝 | 今日所有者 | T2.1 变更 |
| --- | --- | --- |
| 定义工作区 | #847 `/parameter-admin/specs` 上的 `CatalogPage` | 复用；不建第二套 |
| 草稿托盘列出／删除 | `createCanonicalDraftTraySource` | 类型化保存 + 重载后证明 **现场**；保留单测 |
| 类型化编辑／提交／审批 | `ApiProjectTopologyWorkspace`、`ParameterReviewPage`、`CanonicalProjectValueReviewPanel` | 在一次性 post-cutover canonical fixture 上行使；补发现的缺口 |
| 导入预览 | `matchToLibrary` + 向导 | 未匹配行不合格，不是「pending new」 |
| FRONTEND.md | 过时的 v1 托盘 DELETE | 写 canonical v2 列出／删除 |
| 浏览器 | 既有 `e2e/acceptance/parameter-*.spec.ts` | 扩展，不替换 Gate0 |

## 2. 数据面

使用 **既有一次性 post-cutover 验收运行时**（canonical 身份、真实 API、真实 PostgreSQL、1440x900）。这就是 T2.1 的 canonical 数据。

**不要**要求在 Gate0 里跑 T1.3 的 124×3 物化。T1.3 仍是种子证据。若一次性 fixture 没有 JSON ConfigurationSchema binding，T21-10 的 JSON 由既有 JSON 源／文件路径（parameter-files + Pointer 编辑）证明，而不是发明一个 372 行 UI 库。

Mock 模式不是 T2.1 验收。

## 3. 未匹配导入（T21-12）

今日 `matchToLibrary` 把未匹配行设为没有 `existingParameter` 的 `status: "pending"`，测试称之为「pending new candidates」。在 canonical Catalog 上，导入不能铸造 Definition。

规定行为：

- 未匹配行有明确不合格状态（例如 `unmatched`／不可选），文案说明它们不会被应用，且 `isEligibleImportItem` 返回 false。
- 只含未匹配行的选择去应用时，暂存 **零** 草稿，创建 **零** Definition。
- 把用户指向受治理的 observation／authoring 路径（对已匹配 binding 的工作台类型化编辑，或 Admin 定义工作区），而不是「导入会创建该参数」。

不要从预览表里默默丢掉未匹配行；隐藏同样误导。显示为禁用。

## 4. B5 现场托盘（T21-02）

保留 `createCanonicalDraftTraySource`。增加（或扩展 topology／parameters）一条 Playwright 用例：

1. 以参数编辑者在 1440x900 登录。
2. 打开一次性项目的 `/parameters`。
3. 创建带理由的类型化 canonical 草稿。
4. 重载页面。
5. 断言托盘列出该草稿（看得到 `reason`；没有发明的 `parameterId`）。
6. 从托盘删除；重载；它消失。
7. 网络：`GET`／`DELETE` `/api/v2/projects/.../parameter-value-drafts`；无 `/api/v1/parameter-drafts`。

若某 spec 已有该路径，把它对准 canonical URL 并记录操作 ID。不要加第二个托盘。

## 5. 操作覆盖

把 T2.1 动词映射到 `e2e/acceptance/operationMatrix.ts`／覆盖地图里 **既有** 操作 ID。在本候选的一次性运行时上跑所有者 spec：

- topology：创建／编辑、源 diff、历史、比较、DTS 写回
- parameters：提交、驳回、撤回、重提、角色分离
- catalog：#847 搜索／过滤／分页／计数
- files：基线、导出、重导入
- 导入向导：T21-12 之后
- negative：归档提示、404

只补缺失的 B5 现场用例和未匹配导入断言。不复制完整 S1 套件（T3.1）。

## 6. 文档

把中英 `FRONTEND.md` 托盘删除那句改成 canonical v2 路由。不重写工作台章节。

## 7. 证据

- `matchToLibrary`／向导资格的聚焦前端测试
- 既有 + 扩展的 Playwright，1440x900，真实 API（Gate0 一次性运行时）
- 改过的 UI 文件跑 `npm test`，`npm run build`，样式／文案则 `npm run ui:check`，`git diff --check`
- 仅当外观／布局变化时截图；纯交互的 B5 可用操作证据，不必图库
- spec diagnostics helper 里的 console／network
- 独立 Standards + Spec 实现复审
- 中英验收回执

仅在需要额外服务端测试时用 helper PG 55438。不用 `wiseeff_lane_849`。

## 8. 实施顺序（Spec PASS 之后）

1. 未匹配导入状态 + 向导文案 + 测试。
2. FRONTEND.md B5 URL 诚实。
3. B5 现场 Playwright 用例。
4. 在 1440x900 跑所有者参数验收 spec；修复发现的回归。
5. 独立实现复审；中英回执；停止。

## PR 计划

本 todo 不开 PR。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | 未匹配导入诚实 | `matchToLibrary`、向导、测试 | Spec PASS |
| B | FRONTEND.md B5 URL | FRONTEND.md + 中文 | Spec PASS |
| C | B5 现场托盘验收 | e2e parameter topology／parameters | A |
| D | 跑所有者 spec；回执 | 验收 + T2.1 文档 | C |
