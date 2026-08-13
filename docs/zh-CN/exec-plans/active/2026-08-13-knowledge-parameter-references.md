# 参数定义与知识条目的结构化引用

> 状态：**进行中**
> 日期：2026-08-13
> 分支：`feat/knowledge-parameter-references`
> English: [`docs/exec-plans/active/2026-08-13-knowledge-parameter-references.md`](../../../exec-plans/active/2026-08-13-knowledge-parameter-references.md)
> 设计：[`docs/zh-CN/design-docs/2026-08-12-knowledge-base-design.md`](../../design-docs/2026-08-12-knowledge-base-design.md) — 延期路线图第 2 项
> 前置：知识库 MVP、日志相关知识推荐（均已合并）
> 完整性 ADR：ADR-0011（定义废弃是软退役）、ADR-0013（归属主体是稳定目录实体）、ADR-0017（`parameter_specs.id` 是代理键）

## 目标

知识条目可以声明对参数定义的结构化引用，两侧如实呈现：

- **引用实体**：`knowledge_parameter_references` 行把知识条目绑定到 `parameter_specs.id`——稳定代理键（ADR-0017），绝不绑定项目绑定或逻辑节点 id——带组织隔离、创建者归属、(条目, 定义) 唯一约束、双侧外键。条目硬删除级联删除引用行，既有删除审计的 metadata 记录被删除的引用数。
- **编辑**：引用从知识条目侧编辑，权限与条目编辑一致（`knowledge:edit` 管自己 / `knowledge:manage` 管任意）：条目编辑器内的参数定义选择器（搜索走调用者本就可用的参数定义读取 API；搜索需要 `parameter:view`）。添加/移除通过 ADR-0027 审计缝写证据。
- **知识侧**：条目详情以 chips 展示被引用定义（名称、模块、生命周期徽章——已废弃定义按 ADR-0011 如实显示「已废弃」，且引用在废弃后**存续**），深链到 `/parameter-admin?spec=…`。
- **参数侧**：定义详情对话框新增「相关知识」列表，只显示引用该定义的**已发布**条目（published-only 不变量：草稿/已归档对任何人都不出现；需要 `knowledge:view`，否则整个区块隐藏）。每次读取都在服务端强制组织隔离。
- **小泽**：现有 `knowledge.getDocument` 读工具的 payload 附带条目引用的定义（id + 名称 + 生命周期），让 grounding 回答能点名参数；不新增工具。

## 非目标

- 不做反向编辑：引用永远不从参数侧编辑。
- 不引用项目绑定、逻辑节点、配置集或定义*版本*——主体只有定义（`parameter_specs.id`）。
- 不改检索索引或向量：引用不影响搜索排序。
- 不新增权限：现有 `knowledge:view` / `knowledge:edit` / `knowledge:manage` / `parameter:view` 组合即可。
- 不做 DTS 重载沉淀、集合、MCP 面（延期路线图第 3-5 项）。

## 完整性规则（本特性的核心）

| 事件 | 行为 |
| --- | --- |
| 定义身份纠错（ADR-0017 重归属 / 属性键改名） | 引用绑定代理键 `parameter_specs.id`，纠错时 id 不变——引用原样存续。 |
| 定义废弃（ADR-0011 软退役） | 引用行保留；两侧继续显示并如实呈现「已废弃」徽章。 |
| 定义硬删除 | **目录没有定义硬删除路径**（无删除路由或服务函数；废弃是唯一退役方式，ADR-0011）。因此外键采用默认限制行为：未来任何删除路径必须显式决定引用去向，而非静默丢行。 |
| 条目归档 | 引用行保留；条目从参数侧「相关知识」消失（该列表 published-only）。恢复后回来。 |
| 条目硬删除 | 引用行随条目级联删除；既有 `knowledge-entry-delete` 审计 metadata 增加 `parameterReferenceCount`。 |
| 跨组织 | 只能引用调用者组织可读的定义（本组织所有或平台全局，与定义详情 API 同规则）；读取服务端组织隔离。 |

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实施代理 | 在 `feat/knowledge-parameter-references` 上提交；不推送、不开/合 GitHub PR |
| 父代理 | 审查、跑验证、开/合 PR，然后同步本地 `main` |

分支：`feat/knowledge-parameter-references`，自最新 `main` 检出（worktree 隔离）。

## 任务

1. **验收先注册**：在实现 UI 之前把 `KB-XREF-001`（在条目上编辑引用；在定义详情看到已发布条目；草稿永不出现；废弃后 chip 存续并带如实徽章）登记到覆盖图、操作矩阵（EN + zh）、`e2e/acceptance/requirements.ts`、`e2e/acceptance/operationMatrix.ts`。
2. **迁移** `0110_knowledge_parameter_references.sql`：引用表（uuid 主键、`organization_id` 外键、`entry_id` 外键 `on delete cascade`、`parameter_spec_id` text 外键指向 `parameter_specs(id)` 且删除保持默认限制行为、`created_by_user_id` 外键、`created_at`、唯一 `(entry_id, parameter_spec_id)`），加 `(organization_id, parameter_spec_id)` 索引服务参数侧读取。
3. **后端**（`server/modules/knowledge/`）：`parameterReferences.ts` 仓库/服务切片——`PUT /api/v1/knowledge/entries/:entryId/parameter-references/:specId`（幂等添加）与 `DELETE …/:specId`，权限与条目编辑同一 `requireKnowledgeGovern` 规则，归档条目与内容编辑一样拒绝，校验定义在调用者可读范围（本组织或平台全局），通过 ADR-0027 缝审计（`knowledge-parameter-reference-add`/`-remove`）；条目 DTO 增加 `parameterReferences`（定义 id、属性键、显示名、驱动模块、生命周期），list + detail 均加载；`GET /api/v1/knowledge/related-to-spec?specId=…` 返回 published-only 引用条目（`knowledge:view`、组织隔离、范围外定义 404）；硬删除审计 metadata 记录 `parameterReferenceCount`；`getPublishedKnowledgeDocument` 与 `knowledge.getDocument` 工具 payload 增加 `referencedParameters`（id + 名称 + 生命周期）；routeManifest + schemaRegistry 登记；重新生成 `docs/generated/openapi.json`。
4. **前端**：领域类型 `KnowledgeParameterReference` + `KnowledgeEntry.parameterReferences`；`KnowledgeRepository` 端口方法 `addParameterReference` / `removeParameterReference` / `relatedToSpec`；HTTP 客户端 + mock 实现（mock 保持同样的 published-only 与生命周期徽章语义，种子一条被引用定义）；知识条目详情渲染引用 chips（名称、模块、生命周期徽章、深链 `/parameter-admin?spec=…`）；条目编辑器对既有条目提供选择器区（搜索走 `ParameterTopologyRepository.listSpecs`，添加/移除即时生效，无 `parameter:view` 或无拓扑仓库时隐藏）；定义详情对话框（`ParameterSpecDetail`）新增「相关知识」区（已发布条目，深链 `/knowledge?entryId=…`），仅当调用者持有 `knowledge:view` 时由参数后台页注入。
5. **验收 spec**：扩展 `e2e/acceptance/knowledge.acceptance.spec.ts` 的 KB-XREF-001 场景（种子一个定义；从一条已发布条目和一条草稿条目引用它；断言参数侧只出现已发布条目；废弃定义后断言 chip 存续并带「已废弃」徽章；断言审计行与数据库状态）。
6. **文档**：api-contract EN + zh（三个端点 + 条目 DTO 变化）；FRONTEND EN + zh（chips、选择器、「相关知识」区、端口方法）；domain-model EN + zh 实体注记（知识参数引用 + 完整性规则）；设计文档 EN + zh 标记延期路线图第 2 项已交付；重新生成 `docs/generated/db-schema.md`（按 TD-091 规则用 pgvector 容器）；PLANS EN + zh。

## 验证

- 针对性 vitest：`server/modules/knowledge/parameterReferences.test.ts`（引用 CRUD、幂等添加、归档条目拒绝、草稿不出现在参数侧、废弃存续、条目删除级联 + 审计计数、组织隔离、权限负例、定义范围负例）、`server/modules/knowledge/routes.test.ts`、`server/modules/agent/tools/knowledgeTools.test.ts`、`src/infrastructure/mock/mockKnowledgeRepository.test.ts`、`src/infrastructure/http/knowledgeClient.test.ts`、知识页面/对话框组件测试。
- `npm run test:server`；`npm test`；`npm run build`；`npm run docs:check`；`npm run contract:openapi` + `npm run contract:check`；`npm run acceptance:coverage` + `npm run acceptance:operations`。
- `npm run acceptance:e2e -- knowledge.acceptance.spec.ts` 在隔离栈上（专用已迁移数据库 `wiseeff_kb_xref`，前端端口在 5173-5199 CORS 白名单内）。
- playwright-cli 检查 `/knowledge` 条目编辑器选择器 + `/parameter-admin` 定义详情「相关知识」区，视口 1440x900 / 768x1024 / 390x844（snapshot + screenshot 存 `work/ui-checks/`，`console error` 干净）。

## 成功标准

- 编辑者可在自己的条目上添加/移除定义引用；管理者可在任意条目上；仅查看者与非所有者得到 403；归档条目与内容编辑一样拒绝引用编辑。
- 引用绑定 `parameter_specs.id`，身份纠错与废弃后存续；已废弃定义在知识侧显示如实的「已废弃」徽章而引用保留。
- 定义详情「相关知识」只显示已发布的引用条目——草稿与已归档对任何调用者都不出现；无 `knowledge:view` 时区块隐藏；服务端强制组织隔离。
- 硬删除条目移除其引用行，删除审计记录被移除的数量。
- `knowledge.getDocument` 报告条目引用的定义（id + 名称 + 生命周期）。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 计划 | 更新 | 本计划 + 英文对照；`docs/PLANS.md` + `docs/zh-CN/PLANS.md` |
| 设计文档 | 更新 | `docs/design-docs/2026-08-12-knowledge-base-design.md` + zh（标记延期路线图第 2 项已交付） |
| 领域 / 术语 | 更新 | `docs/design-docs/domain-model.md` + zh（知识参数引用实体 + 完整性规则）；`CONTEXT.md` 不变 |
| API | 更新 | `docs/design-docs/api-contract.md` + zh；`docs/generated/openapi.json` |
| 前端 | 更新 | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md`（chips、选择器、「相关知识」区、端口方法） |
| 质量 / 验收 | 更新 | 覆盖图 + zh；操作矩阵 + zh；`e2e/acceptance/knowledge.acceptance.spec.ts` |
| 生成物 | 更新 | `docs/generated/openapi.json`；`docs/generated/db-schema.md`（迁移 0110） |
| 安全 | 不变 | `docs/SECURITY.md` — 现有权限组合；无新权限或信任边界 |
| 产品规格 | 复查 | `docs/product-specs/product-spec.md` + zh — 仅在措辞需要时更新 |
| 仓库地图 | 不变 | `ARCHITECTURE.md` — 无新模块或运行时缝 |
| 可靠性 / 运行手册 | 不变 | 无新环境变量、作业或运维流程 |
| 开发环境 | 不变 | `.env.example`、`docs/developer/environment-variables.md` — 无新键 |
| 参考 | 不变 | `docs/references/` — 不受影响 |
| 技术债 | 复查 | `docs/exec-plans/tech-debt-tracker.md` — 记录本计划遗留的延期项 |

## 文档更新门

- [x] KB-XREF-001 在 UI 实现之前登记到覆盖图 + 操作矩阵（EN + zh）
- [x] api-contract EN + zh 与 `docs/generated/openapi.json` 包含两个引用编辑端点、条目 DTO 变化与 `GET /api/v1/knowledge/related-to-spec`
- [x] FRONTEND EN + zh 记录引用 chips、编辑器选择器、「相关知识」区与端口方法
- [x] domain-model EN + zh 记录引用实体及其完整性规则
- [x] 设计文档 EN + zh 标记延期路线图第 2 项已交付
- [x] `docs/generated/db-schema.md` 已随迁移 0110 重新生成
- [x] PLANS EN + zh 列出本活跃计划
- [x] 技术债跟踪器已复查——本计划无遗留延期项,无需记录
- [x] `npm run docs:check` 通过
