# DTS 重载运行沉淀为知识草稿

> 状态：**进行中**
> 日期：2026-08-13
> 分支：`feat/knowledge-reload-distillation`
> English: [`docs/exec-plans/active/2026-08-13-knowledge-reload-distillation.md`](../../../exec-plans/active/2026-08-13-knowledge-reload-distillation.md)
> 设计：[`docs/design-docs/2026-08-12-knowledge-base-design.md`](../../../design-docs/2026-08-12-knowledge-base-design.md) —— 延后路线图第 3 项
> 前置：[`2026-08-12-knowledge-base-mvp.md`](../../../exec-plans/completed/2026-08-12-knowledge-base-mvp.md)（Phase 3 日志蒸馏是模板）、[`2026-08-13-knowledge-log-recommendations.md`](../../../exec-plans/completed/2026-08-13-knowledge-log-recommendations.md)

## 目标

任意设备写入后的终态 DTS 重载运行——行为已验证、不可验证、行为矛盾或部署失败（诚实结局本身就是知识价值的一部分）——可以从 `/dts-reload` 运行历史/详情面沉淀为预填知识草稿，与 Phase 3 的日志结论蒸馏完全同构：标题/标签/markdown 只从存储的运行/快照 DTO 组装，经 `?entryId=` 深链交接到 `/knowledge` 草稿编辑器，条目上保存持久的 `source_reload_run_id` 来源关联并在展示日志来源链接的位置同样展示，且遵守全部草稿规则（修订 1、审计、发布前对检索不可见）。

## 非目标

- 不耦合 bridge 内部、部署步骤或内核信号采集代码——预填只读存储的 `ReloadRunDto` / `ReloadSnapshotDto`。
- 不把整段内核日志内联进草稿：至多每参数摘录行，并以运行记录为证据主体。
- 不蒸馏非终态运行（`pending`、`blocked`、`validated`、`deploying`）——设备上尚未发生任何事情，没有可沉淀的调试结局。
- 不改动重载运行生命周期、残留记账或重载权限模型；原样复用重载读取门（`requireDtsReloadView`：`debugging:view` 或 `debugging:dts-reload`，组织隔离）。
- 不做结构化参数-知识引用与集合（仍是延后路线图第 2、4 项）。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实施代理 | 在 `feat/knowledge-reload-distillation` 上提交；不 push、不开、不合并 GitHub PR |
| 父代理 | 评审、跑验证、开/合 PR，然后同步本地 `main` |

分支：`feat/knowledge-reload-distillation`，从最新 `origin/main` 检出（worktree 隔离）。姊妹知识分支（`feat/knowledge-parameter-references`）并行进行；迁移编号在开始与最终提交前均对照 `origin/main` 检查，若冲突由父代理在合并时重新编号。

## 任务

1. **验收先登记**：在实现 UI 之前，把 `KB-DISTILL-002`（终态重载运行 → 带诚实结局措辞的预填草稿 → 发布）登记进 `docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md`（EN + zh）、`e2e/acceptance/requirements.ts` 与 `e2e/acceptance/operationMatrix.ts`。
2. **迁移**（对照 `origin/main` 检查编号；计划时为 `0109`,最终提交前因 main 已用 `0109` 做模块父级修复而重编号为 `0110`）：一个增量迁移，在 Phase 3 的 `source_log_id` 旁新增 `knowledge_entries.source_reload_run_id`（可空，`references dts_reload_runs(id) on delete set null`）加部分索引。
3. **后端**（`server/modules/knowledge/` + `server/modules/dts-reload/` 一个读取缝）：
   - `server/modules/dts-reload/service.ts` 新增 `getReloadRunRecord(db, auth, runId)`——与 `getReloadRun` 相同的 `requireDtsReloadView` + 组织隔离门，但不做对象存储 overlay 源码读取（预填不需要 overlay 源码）。
   - `server/modules/knowledge/reloadDistillation.ts`：终态集合 + `buildReloadDistillationDraft(run: ReloadRunDto)`——标题取运行目的 + 板卡/设备上下文；markdown 正文组装参数集（基线 → 调试值）、每参数行为验证结局、诚实陈述的运行终态（不可验证 ≠ 成功；矛盾与失败照实陈述）、产物摘要，以及内核日志摘录引用（绝不内联整段日志；运行是证据主体）；标签 `参数调试`、`DTS重载`，外加终态标签。
   - `service.ts` 中 `distillKnowledgeFromReloadRun`：服务端强制 `knowledge:edit` + 可读运行（重载读取门 + 组织隔离）；拒绝非终态运行；通过共享的 `createMarkdownDraftWithSource` 路径创建草稿（修订 1、ADR-0027 审计写入并携带 `reloadRunId` 元数据、发布前对检索不可见）。
   - `source_reload_run_id` 贯通 repository 插入/读取、`KnowledgeEntryDto` 与拒绝审计元数据。
   - 路由 `POST /api/v1/knowledge/distill-from-reload-run`（`{ runId }`）；`routeManifest` + `schemaRegistry` 登记；重新生成 `docs/generated/openapi.json`。
4. **小泽**：`action.createKnowledgeDraft` schema 新增可选 `sourceReloadRunId`（审批语义不变）；执行前以同一重载读取门 + 组织隔离校验运行可读；确定性模型接受 `来源重载:<runId>` 以便验收可复现；复核确定性 eval 场景。
5. **前端**：`KnowledgeRepository` 端口方法 `distillFromReloadRun(runId)`；HTTP 客户端；mock 仓库经 `getReloadRun` 缝对接运行时的同一 mock `DtsReloadRepository` 实例、用同一 DTO 镜像组装器（端口对等，ADR-0002）；前端条目类型增加 `sourceReloadRunId`；`/dts-reload` 运行结果区新增「沉淀为知识」按钮（仅终态运行、`knowledge:edit` 持有者可见），经 `/knowledge?entryId=…` 交接；`/dts-reload?runId=…` 深链打开历史运行以便来源链接回跳；`/knowledge-admin` Agent 草稿队列与条目详情对话框以与日志来源链接完全相同的方式展示重载运行来源链接。
6. **验收 spec**：扩展 `e2e/acceptance/knowledge.acceptance.spec.ts` 增加 KB-DISTILL-002——在隔离栈直接 seed 一个带快照证据的终态（`unverifiable`）重载运行（沿用 dts-reload 验收的 seed 模式），以 Hardware Committer 从 `/dts-reload` 沉淀，断言预填草稿的诚实结局措辞，发布，并断言 `source_reload_run_id` + 审计证据。
7. **文档（双语）**：api-contract EN + zh；FRONTEND EN + zh；domain-model EN + zh 注明蒸馏现在有两个来源；更新 `CONTEXT.md` 术语表行；设计文档路线图第 3 项标记为已交付并给出诚实链接；对着 pgvector 容器重新生成 db-schema。

## 验证

- 定向 vitest：`server/modules/knowledge/reloadDistillation.test.ts`（组装器措辞钉死、终态诚实陈述）、`server/modules/knowledge/reloadDistillationService.test.ts`（`knowledge:edit` 与重载读取门的权限负例、组织隔离、非终态拒绝、审计证据、发布前检索不可见）、`server/modules/knowledge/routes.test.ts`、`server/modules/agent/tools/actionTools.knowledgeDraft.test.ts`（sourceReloadRunId 校验）、`src/features/dts-reload/DtsReloadPage.test.tsx`（affordance 可见性/权限/终态门控 + 交接）、`src/infrastructure/mock/mockKnowledgeRepository.test.ts`、`src/infrastructure/http/knowledgeClient.test.ts`。
- `npm run test:server`；`npm test`；`npm run build`；`npm run docs:check`；`npm run contract:openapi` + `npm run contract:check`；`npm run acceptance:coverage` + `npm run acceptance:operations`。
- 在隔离栈上运行 `npm run acceptance:e2e -- knowledge.acceptance.spec.ts`（专用预迁移数据库 `wiseeff_kb_reload`，前端端口取 CORS 白名单内且与姊妹分支不同的端口）。
- 若工具 schema 变更触及场景，跑小泽确定性 eval。
- playwright-cli 三视口检查 `/dts-reload`（历史 → 运行详情 → 沉淀 affordance）与 `/knowledge` 草稿交接：1440x900 / 768x1024 / 390x844（snapshot + screenshot 存 `work/ui-checks/`，`console error` = 0）。

## 成功标准

- 调用者可读的终态重载运行沉淀出的 markdown 草稿，其标题/标签/正文只来自存储的运行/快照 DTO，诚实陈述结局（不可验证、矛盾、失败绝不读作成功），以运行为内核日志证据主体而不内联整段日志，并携带 `source_reload_run_id`。
- 无 `knowledge:edit` 的调用者得到 403；不能读取该运行的调用者（无 `debugging:view`/`debugging:dts-reload`，或属于其他组织）得到 403/404；非终态运行为 400。
- `/dts-reload` 的 affordance 在 API 与 mock 两种模式下都只对终态运行与 `knowledge:edit` 持有者出现，并交接进 `/knowledge` 草稿编辑器；管理队列与条目详情展示重载运行来源链接。
- `action.createKnowledgeDraft` 接受 `sourceReloadRunId`，审批语义不变，服务端校验来源关联。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 规划 | 更新 | 本计划 + 英文对照；`docs/PLANS.md` + `docs/zh-CN/PLANS.md` |
| 设计文档 | 更新 | `docs/design-docs/2026-08-12-knowledge-base-design.md` + zh（延后路线图第 3 项标记为已交付） |
| API | 更新 | `docs/design-docs/api-contract.md` + zh；`docs/generated/openapi.json` |
| 前端 | 更新 | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md`（沉淀 affordance、端口方法、来源链接） |
| 领域/术语表 | 更新 | `docs/design-docs/domain-model.md` + zh（蒸馏现在有两个来源）；`CONTEXT.md` 知识蒸馏行 |
| 质量/验收 | 更新 | `docs/developer/browser-acceptance-coverage-map.md` + zh；`docs/developer/user-operation-coverage-matrix.md` + zh；`e2e/acceptance/knowledge.acceptance.spec.ts` |
| 生成物 | 更新 | `docs/generated/openapi.json`；`docs/generated/db-schema.md`（新列；对 pgvector 容器再生成） |
| 产品规格 | 复核 | `docs/product-specs/product-spec.md` + zh——仅在工作流措辞需要时提及 |
| 安全 | 不变 | `docs/SECURITY.md`——无新权限；服务端复用 `knowledge:edit` + 重载读取门 |
| 可靠性/runbook | 不变 | 无新环境变量、作业或运维流程 |
| 仓库地图 | 不变 | `ARCHITECTURE.md`——无新模块或运行时缝 |
| 开发环境 | 不变 | `.env.example`、`docs/developer/environment-variables.md` |
| 参考 | 不变 | `docs/references/` |
| 技术债 | 复核 | `docs/exec-plans/tech-debt-tracker.md`——记录任何离开本计划的延后项 |

## 文档更新门

- [x] KB-DISTILL-002 在 UI 实现之前登记进覆盖图 + 操作矩阵（EN + zh）（提交 `docs(acceptance): register KB-DISTILL-002…` 先于后端/前端提交）
- [x] api-contract EN + zh 与 `docs/generated/openapi.json` 包含 `POST /api/v1/knowledge/distill-from-reload-run`
- [x] FRONTEND EN + zh 记录重载沉淀 affordance、`distillFromReloadRun` 端口方法与重载运行来源链接
- [x] domain-model EN + zh + `CONTEXT.md` 术语表陈述蒸馏的两个来源
- [x] 设计文档 EN + zh 将延后路线图第 3 项标记为已交付
- [x] `docs/generated/db-schema.md` 重新生成并包含 `source_reload_run_id`（pgvector/pgvector:pg16 容器）
- [x] 产品规格已复核——已更新:EN + zh 蒸馏闭环语句补充终态重载运行来源
- [x] PLANS EN + zh 列出本活跃计划
- [x] 技术债跟踪器已复核——无延后项离开本计划,无需登记
- [x] `npm run docs:check` 通过
