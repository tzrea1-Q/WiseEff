# T2.2-CGH 目录／治理消费者 — 本地实施回执

> English: [English](../../../../exec-plans/active/849-inventory/t22-cgh-catalog-governance-acceptance.md)

状态：**T2.2-CGH 本地候选完成。** 设计 Spec 先 FAIL 后 PASS with P2；实现 Standards PASS with P2；实现 Spec PASS with P2（grok-4.6；要求的 gpt-5.6-luna 不可用）。不做 SEALED、commit、PR、合并、Hosted、target 或 Issue 更新。

契约：[威胁矩阵](t22-cgh-catalog-governance-threat-matrix.md)、[设计](t22-cgh-catalog-governance-design.md)、[设计 Spec 评审](t22-cgh-catalog-governance-spec-review.md)、[实现复审](t22-cgh-catalog-governance-impl-review.md)。

## 候选

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- 分支：`codex/849-853-t11-source-identity`
- HEAD（未变）：`f9c710f6a90d67462965a06abd47e33aa200e75e`
- 已接受 main：`46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1–T2.1 仍是同树未提交脏工作。无 commit。

## 已交付行为

获胜 `registerParameterSpecRoutes` 的 `POST /api/v2/parameter-specs`（管理端定义库铸定义）返回 **410** `CatalogLegacyGoneResponse` `reason: "legacy-surface-retired"` successor `/api/v2/catalog`，**先 gone**（不碰 db、鉴权、body）。spec-review `createSpec` 仍在 `POST /api/v2/parameter-spec-review-tasks/:taskId/resolve`。列表和详情 `view=governance`、activate、overlay、PATCH／deprecate／restore／reattribute／cutover 保持 2xx。

定义库仍是 #847 CatalogPage + `parameter-catalog-api`。`parameterAdminClient.invokeRetiredLegacyWrite` 未改。

## 归类（T22C-01）

S12-CGH 分片仍 **1804** 条，**123** 个 file×rule 组。**0 条未解释。** 四个标签：

| 类 | 计数 | 说明 |
| --- | --- | --- |
| canonical-current-catalog | 0 | `parameterAdminClient.ts` 分片已是 0 行 |
| canonical-current-dts-spec | 1193 | 生产 `parameter-specs/**`，含列表／详情 governance HTTP 与 overlay |
| exact-canonical-history | 611 | 609 测试 + 2 条 e2e import-wizard |
| archived-notice | 0 | POST 路径 token 仍在；`createParameterSpec` 仍在 `service.ts` |

完整 123 个 file×rule 组表与[英文回执](../../../../exec-plans/active/849-inventory/t22-cgh-catalog-governance-acceptance.md)相同（路径与 rule 标识符不翻译）。

## Ratchet（T22C-08）

| 度量 | 之前 | 之后 | Delta |
| --- | --- | --- | --- |
| S12-CGH | 1804 | 1804 | 0 |
| 全部分片 | 3513 | 3513 | 0 |

诚实的零 delta：410 已落地；同族文件里 token 仍在（`service.ts` 的 `createParameterSpec`、`schemas.ts`、GET `/api/v2/parameter-specs*`）。未改分片。未削弱 checker、未增长、未改写 fixture。

完整 `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` **未跑完**：`Runtime topology relocation rejected: destination whole-file blob for e2e/acceptance/parameter-import-wizard.acceptance.spec.ts`（既有 T2.1 脏文件；不是 CGH 改动）。

## 验证（不要加总）

Helper PG：`postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t22_cgh`（本 todo 新建；不用 `wiseeff_lane_849`，不用 compose `5432/wiseeff`）。无 UI 扫描（API 模式 CatalogPage 不 POST 铸定义）。

| 命令 | 结果 |
| --- | --- |
| `DATABASE_URL=…55438/wiseeff_t22_cgh npm run test:server -- parameterSpecHttpAdapter.test.ts` | **5 passed** |
| 同环境 `test:server -- routes.test.ts parameterSpecHttpAdapter.test.ts` | **27 文件，292 passed** |
| `npx tsc -b` | **通过** |
| `git diff --check`（CGH 代码） | **通过** |
| `parameter-catalog-boundaries:check --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` | **未完成**（T2.1 import-wizard relocation blob） |

## 剩余限制

- 列表 `view=governance` 仍 2xx，直到 T2.2-MOD。
- 详情 `view=governance` 仍 2xx，直到 T1.4。
- PATCH／生命周期／cutover 仍 2xx，直到 T2.2-TOP。
- Topology HTTP `createParameterSpec` 在 API 模式会 410；注入 catalog 端口时 CatalogPage 是定义库。
- 完整 boundary checker 被 T2.1 脏 import-wizard relocation 挡住（实现 Spec P2；1804／3513 来自分片现状，不是跑完的 checker）。
- 适配器测试：未认证铸定义 410 与 gone-first 非法 body 重叠（Standards P2）；keep-2xx 只断言不是 410 且无 db（与原有 GET 适配器测试相同）。
- 无 T2.2-TOP，无 commit。

## 保持的非目标

不改 overlay、不改 CatalogPage、不清零 T1.4 allowance、不 Hosted／target／Issue。
