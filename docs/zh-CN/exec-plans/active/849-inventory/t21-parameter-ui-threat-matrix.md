# T2.1 canonical 数据上的参数 UI — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t21-parameter-ui-threat-matrix.md)

契约：#849、#853 T2.1、已关闭的 [#847](https://github.com/tzrea1-Q/WiseEff/issues/847)、[ADR-0046](../../../design-docs/adr-0046-source-occurrence-identity-spans-dts-and-software-configuration.md)、T1.3 [回执](t13-complete-successor-acceptance.md)。产品方向（canonical 数据上的完整参数 UI、集成 #847、B5 canonical pending-draft 适配器、PC 1440x900、真实服务）已经决定。本矩阵冻结剩余实施与证据边界。

状态：**设计 Spec PASS with P2；实现本地候选完成。** 配套：[可实现设计](t21-parameter-ui-design.md)、[回执](t21-parameter-ui-acceptance.md)。无 commit、PR、封板。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- 继承 HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`；已接受 main `46b6068693942b95f7cba28ee5de6748a97170fa`。T1.1–T2.4 仍是未提交脏候选，不重写。
- 风险 **R2**（公开 UI 流程、鉴权、真实 API）。生产修改前须对本矩阵和设计做独立 Spec 评审。本地转绿后再做独立 Standards 与 Spec 实现复审。
- T2.1 本地交付后停止。不做 T2.2 消费者族、T1.4 切换、T3.x S1／S2／Hosted／目标、commit、PR、合并或 Issue 变更。
- 浏览器验收为 **单 PC 视口 1440x900**。历史平板／手机产物保留为历史证据。
- 要求的独立评审模型 `gpt-5.6-luna`／`max` 不可用；评审者使用 `grok-4.6` 并必须披露替换。

## 受保护不变量

在 canonical Catalog 数据上（不是 mock，当前所有者也不是遗留 `parameter_drafts`），用户可以创建、编辑、删除并重载参数草稿；选择理由和合格处理人；在角色分离下驳回、撤回、重提；审批并生效；查看源 diff、历史、比较、基线、导出和重导入。定义／模块导航、搜索、过滤、分页、计数、登记、初始化以及诚实空态／错误态保持真实。DTS 与 JSON 操作可用。归档链接提示可关闭且目标不可编辑；授权 gone 与跨组织隐藏 404 不泄漏归档载荷。未匹配导入预览看起来不会像一次成功的新参数应用。证据是 1440x900 下的真实 API + PostgreSQL，并记录键盘／焦点与 console／network。

## 接收（2026-09-17）

- #847 **已关闭**。CatalogPage（模块导航 + 定义表 + 生命周期／纠错对话框）已存在。T2.1 集成该工作区，不另建一套。#847 剩余 decision-6 编辑器字段（`schemaDefault`、可编辑约束、编辑器 examples）**不是** T2.1，除非它们挡住 T2.1 操作清单。
- B5 代码已存在：`createCanonicalDraftTraySource` 列出／删除 `GET|DELETE /api/v2/projects/:projectId/parameter-value-drafts`。`ParametersPage` 在 API 模式注入它。单测证明不调用 `/api/v1/parameter-drafts`。**针对真实 canonical 草稿的浏览器现场证明仍缺**（回合报告／验收矩阵）。
- `docs/FRONTEND.md` 仍把托盘删除写成 `DELETE /api/v1/parameter-drafts/:draftId` — 相对 B5 已过时。
- 既有 Playwright 所有者已在 1440x900 的 post-cutover 一次性运行时上覆盖操作清单的大部分：`parameter-topology.acceptance.spec.ts`、`parameters.acceptance.spec.ts`、`parameter-catalog*.acceptance.spec.ts`、`parameter-files.acceptance.spec.ts`、`parameter-import-wizard.acceptance.spec.ts`、#876 的归档链接验收。T2.1 复用它们，不替换 Gate0。
- `matchToLibrary` 把未匹配导入行标成没有 `existingParameter` 的 `status: "pending"`（「pending new candidates」）。这就是 T2.1 点名的误导性未匹配导入预览。canonical Catalog 不能从一行未匹配导入铸造新 Definition。
- T1.3 的 124／372 是种子／物化证据，不是 T2.1 UI fixture。T2.1 数据面是 **canonical 身份模式**（既有一次性 post-cutover 运行时）。在 Gate0 里再跑一遍 T1.3 厂商导入 + 372 绑定超出范围。
- Mock 模式不能构成 T2.1 验收。
- 额外服务端测试的 helper PG：55438 一次性库，绝不用 `wiseeff_lane_849`，绝不用 compose `5432/wiseeff` 当验收。

## 行

| ID | 维度 | 预期观察 | 证据所有者 |
| --- | --- | --- | --- |
| T21-01 | #847 集成 | `/parameter-admin/specs` 仍是 #847 工作区。T2.1 不加并行定义表。Catalog 列表仍带 `totalCount`／`hasMore` | 既有 catalog 验收 + 无新页面 |
| T21-02 | B5 现场托盘 | 类型化 canonical 草稿保存后，重载托盘仍显示该草稿，带 `reason` 和 `updatedAt`。托盘删除走 canonical DELETE，草稿不复活。无 `/api/v1/parameter-drafts` | 新增／扩展 topology 或 parameters 验收 + `canonicalDraftTraySource` 测试 |
| T21-03 | 创建／编辑／删除／重载 | Binding 类型化编辑 → 草稿 → 托盘；编辑；删除；重载。键盘：理由字段与对话框焦点 | 既有 topology spec + T21-02 |
| T21-04 | 理由／处理人 | 提交需要理由；合格处理人角色忠实；禁止自我审批 | 既有 parameters／review spec |
| T21-05 | 角色分离 | 作者不能批准自己的请求。驳回／撤回／重提保持不同角色 | `parameters.acceptance.spec.ts` |
| T21-06 | 审批／生效 | `/parameter-review` 在请求为 canonical 时通过 `CanonicalProjectValueReviewPanel` 生效 | 既有 review UI + 聚焦用例 |
| T21-07 | Diff／历史／比较／基线／导出／重导入 | Binding 详情历史与比较；文件基线／导出；重导入暂存草稿而不是当前值 | 既有 topology + files spec |
| T21-08 | 导航 | `/parameters` 与 `/parameter-admin/specs` 上的模块导航、搜索、过滤、分页、诚实计数 | 既有 spec |
| T21-09 | 登记／初始化／空态／错误 | `/parameters` 上的诚实空态和 API 错误态走既有 negative spec。`PARAM-INIT-*` 仍是 `coverage: "future"`；初始化 Playwright **延期到 T2.2-PRJ／T3.2**，不声称已有 T2.1 所有者 | parameters-negative；明确延期 |
| T21-10 | DTS 与 JSON | 对 canonical binding 做 DTS 类型化编辑；fixture 有 ConfigurationSchema binding 时做 JSON Pointer 编辑。YAML／TOML／ENV 继续拒绝 | topology + import + unsupported-format |
| T21-11 | 归档／404 | 归档链接横幅可关闭、目标不可编辑；授权 gone；跨组织 404 无归档正文 | #876 + parameters-negative |
| T21-12 | 未匹配导入 | 未匹配行 **不是** `pending` 新候选。预览表明它们不会被应用；应用不创建 Definition。路径是 observation／authoring 或明确不合格 | `matchToLibrary` + 导入向导 |
| T21-13 | Mock ≠ 验收 | 仅 API 运行时。组件测试不证明 T21-02／T21-05 | 回执 |
| T21-14 | 视口 | 仅 1440x900。仅在发现布局缺陷时才加紧凑 1280x800 | checklist |
| T21-15 | 环境 | 既有 Gate0 所有者的一次性 post-cutover 验收运行时。额外服务端测试用 55438 一次性库。不是 `wiseeff_lane_849`，不是 compose `5432/wiseeff` | 运行时 helper |
| T21-16 | 文档诚实 | FRONTEND.md 托盘删除写 canonical v2 路由 | FRONTEND.md + 中文孪生 |
| T21-17 | 非目标 | T2.2 十一族、T1.4 零遗留 allowance、T3.1 完整 `test:server`、Hosted、目标 | 回执 |
| T21-18 | 键盘／控制台 | 改过的对话框保持焦点陷阱／恢复。Console／network：把预期 4xx 与回归分开 | UI checklist + diagnostics |

## 非目标

- 重写 #847，或在不挡住 T2.1 操作时重开 decision-6 剩余编辑器字段。
- 把 T1.3 的 124×3 物化跑进 Gate0 当 UI fixture。
- T2.2 消费者族 allowance ratchet、T1.4 切换、T2.3 处置。
- 三视口扫场。
- Commit、PR、合并、Hosted、目标、Issue 变更。

## 自审限度

本矩阵由协调实现者撰写。生产修改前必须独立 Spec 评审；本文件不是那次评审。
