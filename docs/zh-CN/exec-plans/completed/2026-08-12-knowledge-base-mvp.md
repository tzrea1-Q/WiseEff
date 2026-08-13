# 知识库 MVP

> English: [English](../../../exec-plans/completed/2026-08-12-knowledge-base-mvp.md)
> 状态：**已完成 2026-08-13**——Phase 1 经 #330 合并、Phase 2 经 #370 合并、Phase 3 经 #385 合并（分支 `feat/knowledge-base-foundation`、`feat/knowledge-base-rag`、`feat/knowledge-base-distillation`）
> 日期：2026-08-12
> 设计文档：[`docs/zh-CN/design-docs/2026-08-12-knowledge-base-design.md`](../../design-docs/2026-08-12-knowledge-base-design.md)
> ADR：ADR-0025（`docs/adr/0025-knowledge-retrieval-lives-in-postgres.md`，英文）

## 目标

交付设计文档锁定的组织级 agentic 知识库 MVP：扁平、多标签的 markdown/文件知识条目，wiki 式轻治理生命周期与不可变版本；仅已发布内容进入 pgvector + 全文检索的混合检索，缺配置时优雅降级为纯全文检索；小泽知识工具带引用负载；审批门控的 Agent 草稿工具；日志结论一键沉淀。

## 非目标

不做第二个聊天座席、不做层级/空间、人写不设审批队列、不做外链条目、不做实时协同编辑、不做 MCP 接入面、不做参数与知识的结构化引用、不做重载运行沉淀（均延后；见设计文档路线）。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现 agent | 在阶段特性分支上提交；不开、不合 GitHub PR |
| 父 agent | 评审、执行验证、开/合 PR，然后同步本地 `main` |

每阶段一个分支，均在上一阶段合并后从最新 `main` 检出：`feat/knowledge-base-foundation`、`feat/knowledge-base-rag`、`feat/knowledge-base-distillation`。

## Phase 1——知识库基座（`feat/knowledge-base-foundation`）

1. 迁移：`knowledge_entries`（组织范围、内容形态、状态、标签、来源归属）、`knowledge_revisions`（不可变快照、头指针）、文件元数据（对象存储 key、抽取状态/文本）。重新生成 `docs/generated/db-schema.md`。
2. `server/modules/knowledge/`（routes、service、repository、schemas、types、tests）：CRUD；发布/归档/恢复；硬删除（manage）；版本列表 + 恢复为新版本；乐观并发冲突；经对象存储接缝的文件上传与异步文本抽取状态；仅对已发布条目的 FTS + trigram 搜索；每个变更强制 `knowledge:view|edit|manage` 并写审计；OpenAPI 工件与合同检查更新。
3. 前端：`src/domain/knowledge/` 类型；`KnowledgeRepository` port；同形态 mock 实现与 fixtures；HTTP 客户端；`/knowledge` 页面（列表、标签/项目过滤、搜索、编辑/预览分屏 markdown 编辑器、带抽取状态的文件上传、版本历史/恢复）；`/knowledge-admin` 骨架（归档管理、硬删除）；路由/导航/权限接线。
4. 验收：实现前把 KB-READ-001、KB-EDIT-001、KB-FILE-001 需求与操作 ID 加入覆盖图与操作矩阵（英文 + 中文）；新建 `e2e/acceptance/knowledge.acceptance.spec.ts`。

## Phase 2——检索与小泽（`feat/knowledge-base-rag`）

1. pgvector 迁移（受保护的 `CREATE EXTENSION`；带 embedding 列与 FTS/trigram 索引的切块表）；扩展或端点缺失时进入纯全文检索模式。
2. 索引管线：标题感知的 markdown 切块（带重叠）、抽取文本按段落窗口；基于 `EMBEDDING_API_*` 的 embedding 客户端；发布/编辑/归档触发的异步 worker 接缝（默认轮询）；`/knowledge-admin` 呈现按条目索引状态、失败与重建。
3. 混合检索（向量 + 全文融合）挂在既有搜索端点之后；引用负载携带条目 id、标题、版本、摘录。
4. 小泽：注册 `knowledge.search` / `knowledge.getDocument` 只读工具（工具注册表、目录标签/描述/schema）；小泽 UI 将引用渲染为来源链接；`/knowledge` 的"问知识库"入口（仅 API 模式）；新增知识锚定 eval 场景。
5. 环境与文档：`.env.example` 新增 `EMBEDDING_API_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_API_KEY`、`EMBEDDING_API_TIMEOUT_MS`；环境变量文档（英文 + 中文）；自托管 runbook 说明 pgvector 要求与降级。
6. 验收：实现前加入 KB-ASK-001（及索引健康操作 ID）。

**Phase 2 状态说明（2026-08-12,`feat/knowledge-base-rag`）：**

- 按计划交付：迁移 `0104_knowledge_retrieval.sql`（受保护扩展安装,缺 pgvector 时不失败;`knowledge_chunks` 的 embedding 列为**条件列**——仅在迁移时扩展已存在才创建;`knowledge_index_status` 兼作轮询队列）;`server/modules/knowledge/indexing/`（分块、嵌入客户端 + `EMBEDDING_DETERMINISTIC` 确定性假实现、SKIP LOCKED 领用与过期回收 worker）;发布/编辑已发布/归档/恢复/提取完成触发入队;混合 RRF 检索与诚实的 `retrieval` 上报;`knowledge.search` / `knowledge.getDocument` 组织级只读工具 + `knowledge-grounding` eval 场景;小泽引用来源链接（实时 + 持久化线程）;问知识库入口（仅 API 模式）;`/knowledge-admin` 索引健康与重试/重建;`KNOWLEDGE_INDEX_WORKER_ENABLED`（默认开,进程内轮询）。
- 诚实边界：本地开发与 CI 的 PostgreSQL（postgres:16）**均无 pgvector**,FTS-only 是被完整测试的默认模式;向量路径逻辑由确定性嵌入客户端 + 脚本化 SQL 单测覆盖,真实 pgvector 集成测试（`vectorSearch.integration.test.ts`）在扩展缺失时带原因跳过。在无 pgvector 迁移过的部署上启用语义检索需按自托管 runbook 手动补列。KB-ASK-001 的小泽落地循环在 SSE API 层（确定性模式）+ eval 断言,而非浏览器聊天循环——已记录在覆盖图。
- 延后至 Phase 3（计划不变）：`action.createKnowledgeDraft`、沉淀、Agent 草稿发布队列。

## Phase 3——沉淀回路（`feat/knowledge-base-distillation`）

1. 沉淀 API：从日志分析记录（结论、证据引用、建议动作）创建预填知识草稿，来源链接存于条目。
2. 日志分析结果页动作，衔接进预填草稿编辑器。
3. `action.createKnowledgeDraft` 变更工具：AG-UI interrupt、编排器审批链、审计 `actorType=agent`、仅草稿语义。
4. `/knowledge-admin` Agent 草稿发布队列：列表、审阅、发布（edit 权限者发布自己会话的草稿；manage 发布任意）、归档拒绝。
5. 验收：实现前加入 KB-DISTILL-001、KB-ADMIN-001。

**Phase 3 状态说明（2026-08-13,`feat/knowledge-base-distillation`）：**

- 按计划交付：迁移 `0105_knowledge_distillation_source.sql`（增量列 `knowledge_entries.source_log_id`——Phase 1 归因列回答"谁写的",本列回答"从哪条分析来"）;`POST /api/v1/knowledge/distill-from-log`（`knowledge:edit` + 对来源记录的 `logs:view`/组织隔离,仅接受已完成分析,预填只耦合已存储的分析记录 DTO 且排除规则 ID）;日志结果页「沉淀为知识」经 `/knowledge?entryId=…` 深链交接草稿详情;`action.createKnowledgeDraft` 按 `action.submitParameterChange` 模式注册（requiresApproval、组织范围、执行时强制 `knowledge:edit`、会话记录于 `source_session_id`、目录标签「创建知识草稿」、确定性模型路由、`knowledge-agent-draft` eval 场景断言中断与批准落草稿）;`/knowledge-admin` Agent 草稿发布队列（创建人、会话来源、来源分析链接、审阅深链、发布、经 `POST /api/v1/knowledge/entries/:entryId/reject` 拒绝归档）;mock 端口模拟同样的沉淀/队列行为;KB-DISTILL-001 与 KB-ADMIN-001 先注册后实现,并已在 `knowledge.acceptance.spec.ts` 自动化。
- 设计说明：发布权无需新策略——Agent 草稿的 `created_by_user_id` 即批准会话的用户,既有"拥有者或 manage"治理规则天然实现"edit 发布本人会话草稿;manage 发布任意"。拒绝归档复用 `archived` 状态（被拒草稿的恢复是拥有者/manage 的自觉行为,按标准生命周期回到 `published`）。拒绝从未发布的草稿时跳过索引刷新入队（草稿没有 chunk）。

## 新增面汇总

- 权限：`knowledge:view`、`knowledge:edit`、`knowledge:manage`（角色种子 + 权限文档）。
- 环境变量（Phase 2）：`EMBEDDING_API_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_API_KEY`、`EMBEDDING_API_TIMEOUT_MS`。
- 路由：`/knowledge`、`/knowledge-admin`；API 命名空间 `/api/v1/knowledge/*`。
- Agent 工具：`knowledge.search`、`knowledge.getDocument`（只读）、`action.createKnowledgeDraft`（审批门控）。

## UI 交互自动化

受影响用例：`e2e/acceptance/knowledge.acceptance.spec.ts`（新建）。当前不存在任何 KB 需求/操作 ID；按自动化规则，各阶段在实现前把各自 ID 加入 `docs/developer/browser-acceptance-coverage-map.md` 与 `docs/developer/user-operation-coverage-matrix.md`（英文 + 中文）：KB-READ-001、KB-EDIT-001、KB-FILE-001（Phase 1）；KB-ASK-001（Phase 2）；KB-DISTILL-001、KB-ADMIN-001（Phase 3）。操作证据仍由 `npm run acceptance:browser` / `npm run acceptance:evidence` 产出。

## 验证

每阶段：`server/modules/knowledge/` 与知识组件的定向 vitest；`npm run test:server`；`npm run build`；`npm run docs:check`；针对 KB 需求 ID 的 `npm run acceptance:browser`；对 `/knowledge` 与 `/knowledge-admin` 的 playwright-cli 视口检查（1440x900 / 768x1024 / 390x844）。Phase 2 合并前额外运行小泽 eval 场景与 `npm run test:all`。

## 成功标准

- Phase 1：持有 `knowledge:edit` 的组织成员创建、发布、修订、恢复 markdown 条目；PDF 上传成为可检索的文件条目且抽取状态可见；搜索只返回已发布条目；每个变更都有审计；mock 运行时提供同形态 port。
- Phase 2：配置 `EMBEDDING_API_*` 后，混合检索返回语义相关的已发布切块并带引用；未配置时所有界面在纯全文检索模式下保持可用；小泽在调用者权限内以来源链接锚定回答，且永远看不到草稿。
- Phase 3：日志分析结论可经 UI 和审批门控工具变成预填草稿；Agent 草稿在 `/knowledge-admin` 或条目归属工程师发布前不进入检索。

## Documentation Impact Matrix

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | Update | `ARCHITECTURE.md` + `docs/zh-CN/root/ARCHITECTURE.md`（知识模块、工具、运行时形态）——Phase 1/2 |
| 规划 | Update | 本计划 + 英文对应页；`docs/PLANS.md` + `docs/zh-CN/PLANS.md`（规划期已完成） |
| 产品规格 | Update | `docs/product-specs/product-spec.md`、`docs/product-specs/index.md` + 中文（第四工作流）——Phase 1 |
| 领域/词汇 | Update | `docs/design-docs/domain-model.md` + 中文（知识实体）；`CONTEXT.md` 词汇与 ADR 索引（已完成） |
| 设计文档 | Update | `docs/design-docs/2026-08-12-knowledge-base-design.md` + 中文（已完成）；`docs/design-docs/index.md` + 中文（已完成） |
| API | Update | `docs/design-docs/api-contract.md` + 中文；`docs/api/examples.md`；OpenAPI 工件——Phase 1 |
| 前端 | Update | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md`（路由、port、编辑器）——Phase 1 |
| 安全 | Update | `docs/SECURITY.md` + 中文；`docs/security/user-permission-design.md` + 中文（知识权限、Agent 草稿工具）——Phase 1/3 |
| 可靠性/runbook | Update | `docs/RELIABILITY.md` + 中文；`docs/runbooks/self-hosted-runtime.md` + 中文（pgvector、embedding 端点、重建索引）——Phase 2 |
| 开发环境 | Update | `docs/developer/environment-variables.md` + 中文；`.env.example`（`EMBEDDING_API_*`）——Phase 2 |
| 质量/验收 | Update | `docs/developer/browser-acceptance-coverage-map.md` + 中文；`docs/developer/user-operation-coverage-matrix.md` + 中文；`e2e/acceptance/knowledge.acceptance.spec.ts`——各阶段 |
| 生成工件 | Update | 每次迁移后重新生成 `docs/generated/db-schema.md` |
| 参考资料 | No change | `docs/references/`——不受影响 |
| 技术债 | Review | `docs/exec-plans/tech-debt-tracker.md`——记录任何离开本计划的延期项 |

## Documentation Update Gate

- [x] 产品规格英文 + 中文描述知识工作流（Phase 1）
- [x] 领域模型英文 + 中文记录知识实体、生命周期与仅发布可检索（Phase 1）
- [x] API 合同英文 + 中文及 OpenAPI 工件包含 `/api/v1/knowledge/*`（Phase 1）
- [x] FRONTEND 英文 + 中文记录 `/knowledge`、`/knowledge-admin`、port 与 mock 对等（Phase 1）
- [x] SECURITY 与 user-permission-design 英文 + 中文记录 `knowledge:*` 权限与 Agent 草稿工具（Phase 1/3——`knowledge:*` 权限已在 Phase 1 完成;Agent 草稿工具、蒸馏门控与发布权规则已在 Phase 3 完成）
- [x] environment-variables 英文 + 中文与 `.env.example` 记录 `EMBEDDING_API_*`（Phase 2——另含 `KNOWLEDGE_INDEX_WORKER_ENABLED`）
- [x] 自托管 runbook 英文 + 中文记录 pgvector 要求与纯全文检索降级（Phase 2）
- [x] ARCHITECTURE 英文 + 中文标注知识模块与小泽知识工具（Phase 1/2——知识模块已在 Phase 1 标注;索引 worker seam 与小泽知识工具已在 Phase 2 标注）
- [x] 覆盖图与操作矩阵英文 + 中文在各阶段实现前获得 KB-* ID（全部 ID 已注册——KB-READ/EDIT/FILE-001、KB-ASK-001、KB-INDEX-001、KB-DISTILL-001、KB-ADMIN-001）
- [x] 迁移后重新生成 `docs/generated/db-schema.md`（Phase 1、Phase 2（0104）与 Phase 3（0105）均已重新生成）
- [x] 延期工作记入 `docs/exec-plans/tech-debt-tracker.md`（TD-090:pgvector 后装手动补列 + CI 缺 pgvector 覆盖；本计划无其他延期项）
- [x] 本计划移入 `completed/` 前 `npm run docs:check` 通过（收尾变更中验证）
