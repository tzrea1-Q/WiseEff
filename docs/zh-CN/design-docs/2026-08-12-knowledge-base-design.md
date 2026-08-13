# 知识库设计

> English: [English](../../design-docs/2026-08-12-knowledge-base-design.md)
> 状态：**锁定设计**——D1–D20 于 2026-08-12 经拷问式设计会话敲定
> 日期：2026-08-12
> 执行计划：[`docs/zh-CN/exec-plans/completed/2026-08-12-knowledge-base-mvp.md`](../exec-plans/completed/2026-08-12-knowledge-base-mvp.md)
> 相关文档：[`ARCHITECTURE.md`](../root/ARCHITECTURE.md)、[`docs/SECURITY.md`](../SECURITY.md)、ADR-0025（`docs/adr/0025-knowledge-retrieval-lives-in-postgres.md`，英文）

## 定位

知识库是产品的第四个工作流，与参数管理、日志分析、调试并列。它是组织级的企业工程知识之家：调参经验、故障案例、硬件手册、流程规范。它永远不指仓库里的 `docs/` 开发文档——那是开发资产，不是产品面。

MVP 中的 "agentic" 指两层含义，第三层显式保留演进空间：

1. **Agent 可读**——小泽通过注册的检索工具将回答锚定在已发布知识上，并给出引用来源。
2. **Agent 可写**——小泽可以通过审批门控的工具把对话结论沉淀为知识草稿；发布永远由人完成。
3. **Agent 自主维护（延后）**——自动整理（去重、过期标记、知识空洞发现）是后续演进；领域模型不得堵死这条路。

### 非目标（MVP）

- 不造第二个聊天系统。小泽仍是唯一 Agent 座席；知识库页面只是新增一个进入小泽的入口，不是新助手。
- 不做层级。扁平条目 + 多标签；不引入空间/目录树及其治理负担。单层合集（Collection）概念留待以后。
- 人写知识不设评审/审批队列。仅 wiki 式轻治理。
- 不做外链型条目、不做实时协同编辑、不做 MCP/外部 Agent 接入面。
- 暂不做参数与知识的结构化引用（需要引用完整性规则；与日志页相关知识推荐、重载运行沉淀一起延后）。

## 领域模型

| 概念 | 规则 |
| --- | --- |
| 知识条目（Knowledge entry） | 知识的最小单元。内容形态二选一：`markdown`（产品内创建和编辑）或 `file`（上传的二进制存对象存储；抽取文本可检索；二进制只能替换、永不在线编辑）。组织级、扁平、多标签（含项目标签）。 |
| 生命周期 | `draft → published → archived`。已发布条目就地编辑；归档条目退出检索索引但保留历史；恢复后回到 `published`。硬删除是 manage 级动作并留审计证据。 |
| 知识版本（Knowledge revision） | 每次保存产生一个不可变版本。回滚是把历史版本的内容恢复为一个新版本。乐观并发：保存携带预期最新版本号，过期则冲突失败。 |
| Agent 知识草稿（Agent knowledge draft） | 经审批门控工具创建，天生是 `draft`。MVP 中 Agent 永不修改已有条目。发布前对检索不可见；发布者对内容负责。 |
| 仅发布可检索（Published-only retrieval） | 搜索、RAG、小泽只看得到 `published` 条目。发布是唯一的信任门。 |
| 知识切块（Knowledge chunk） | 已发布版本的派生检索投影：文本片段 + 全文检索状态 + 可选 embedding。永不由人撰写，永远可重建。 |
| 知识沉淀（Knowledge distillation） | 把结构化分析结果变成带证据引用的预填草稿。MVP 来源：日志分析结论。 |

模型必须满足的场景校验：

- **批量导入**：上传 30 份 PDF 手册直接生成 30 个文件型条目，无需壳文档。
- **Agent 草稿**：某工程师会话中沉淀的草稿只对该工程师和 manage 级管理员可见，可由该工程师（edit 权限）或管理员发布。
- **冲突**：两位编辑者保存同一条目；后保存者收到版本冲突，查看差异后重试。不静默覆盖，不做实时合并。

## 检索与 RAG

- **存储**：切块行存于 PostgreSQL，带 pgvector embedding 列及全文/trigram 索引（ADR-0025）。不引入独立向量数据库。
- **Embedding**：OpenAI 兼容的 `EMBEDDING_API_*` 端点，镜像 `AGENT_API_*` 的接缝。自托管部署可指向本地 OpenAI 兼容推理服务。未配置时知识库以纯全文检索模式运行：功能完整可用，仅无语义检索。
- **索引管线**：异步 worker 接缝，镜像日志分析模块（默认轮询、可接队列）。发布、编辑、归档动作入队索引刷新；失败在 `/knowledge-admin` 按条目呈现状态并提供重建动作。索引永远可从已发布版本重建。
- **切块**：markdown 按标题结构感知切分并带重叠；抽取文本按段落窗口切分。切块携带条目与版本标识，引用可深链接。
- **混合检索**：有 embedding 时向量相似度与全文排名融合；否则仅全文。CJK 注意事项：PostgreSQL 默认 FTS 不分词 CJK 文本，Phase 1 用 trigram 匹配覆盖 CJK、标准 FTS 覆盖拉丁文本；专用中文分词器留作未来选项。
- **抽取**：文件型条目做服务端文本抽取（PDF、Word 优先）；抽取状态在条目上可见。

## 小泽集成

- 只读工具 `knowledge.search` 与 `knowledge.getDocument` 加入感知工具目录：自动执行、按调用用户的 AuthContext 做权限校验、返回引用负载（条目 id、标题、版本、摘录），UI 渲染为来源链接。
- 写工具 `action.createKnowledgeDraft` 遵循标准变更工具契约：AG-UI interrupt、编排器审批链、审计 `actorType=agent`。只能创建新草稿。"Agent 任何写操作必须暂停等审批"这条不变式保持不破——草稿虽然无害也不豁免，因为一条统一规则胜过一张需要记忆的例外清单。
- `/knowledge` 页面提供"问知识库"入口，打开预置知识上下文的小泽会话。mock 模式没有 Agent UI，因此该入口仅 API 模式可见，与现有小泽规则一致。

## 权限与审计

| 权限 | 授予 |
| --- | --- |
| `knowledge:view` | 阅读已发布条目、搜索、被小泽知识锚定服务覆盖。组织全员默认拥有。 |
| `knowledge:edit` | 创建条目；编辑、发布、归档自己的条目；发布自己会话中沉淀的 Agent 草稿。 |
| `knowledge:manage` | 治理任意条目（编辑、归档、硬删除）、发布任意 Agent 草稿、索引管理。管理员级。 |

- 发布者负责制：`edit` 永不发布他人作品；跨人治理集中在 `manage`。
- 组织隔离同等适用于条目、版本、切块与 embedding；检索 API 在服务端强制 `knowledge:view` + 组织范围。
- 所有写操作按平台审计信封记录；Agent 发起的写携带 `actorType=agent`。

## 产品界面

- `/knowledge`：条目列表（标签/项目过滤 + 搜索）；markdown 编辑器（编辑 + 预览分屏）；文件条目上传及抽取状态；版本历史与恢复；"问知识库"入口。
- `/knowledge-admin`：Agent 草稿发布队列（治理面，不是通知）、归档条目管理、硬删除、索引健康与重建。
- 日志分析结果页：一键沉淀动作，用结论、证据、建议动作预填草稿（Phase 3）。

## 部署与运维

- 自托管 PostgreSQL 需提供 pgvector 扩展才有语义检索；没有扩展时进入纯全文检索模式（与缺少 `EMBEDDING_API_*` 端点同样的降级）。
- 新环境变量组：`EMBEDDING_API_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_API_KEY`、`EMBEDDING_API_TIMEOUT_MS`。
- 备份/恢复继承现有 PostgreSQL 与对象存储演练；切块和 embedding 是派生数据，可重建而非必须恢复。
- 更换 embedding 模型是一次重建索引的维护操作，在 `/knowledge-admin` 呈现。

## 延后路线

MVP 之后的候选项（按序），均与本模型兼容：

1. 日志分析结果页的相关知识推荐（用结论文本做相似检索）。——**已于 2026-08-13 交付**（计划 [`2026-08-13-knowledge-log-recommendations.md`](../exec-plans/completed/2026-08-13-knowledge-log-recommendations.md)）：`GET /api/v1/knowledge/related-to-log` + 日志结果页「相关知识」区块。
2. 参数与知识的结构化引用及完整性规则（定义废弃、条目归档时的行为）。
3. DTS 重载运行沉淀。——**已于 2026-08-13 交付**（计划 [`2026-08-13-knowledge-reload-distillation.md`](../exec-plans/completed/2026-08-13-knowledge-reload-distillation.md)）：终态重载运行（已验证 / 不可验证 / 矛盾 / 失败）经 `POST /api/v1/knowledge/distill-from-reload-run` 沉淀为预填草稿,`source_reload_run_id` 记录来源,结局诚实陈述。
4. 单层合集（若标签导航被证明不够用）。
5. 外部 Agent 接入面（HTTP API 之上的 MCP 包装）。
6. Agent 自主维护：去重、过期标记、知识空洞发现。

## 决策记录

| # | 决策 |
| --- | --- |
| D1 | 产品内第四工作流，承载企业工程知识；永远不指仓库文档 |
| D2 | Agentic = Agent 可读 + Agent 可写（仅草稿）；自主维护延后 |
| D3 | 组织级 + 项目标签；不做项目私有知识库 |
| D4 | markdown 一等公民 + 文件型条目；外链延后 |
| D5 | 小泽是唯一对话座席；知识库加的是工具，不是第二个聊天 |
| D6 | PostgreSQL 内 pgvector；OpenAI 兼容 embedding 端点；纯全文检索降级（ADR-0025） |
| D7 | 人写走 wiki 式轻治理；Agent 写落草稿由人发布；不设审批队列 |
| D8 | MVP 联动：小泽引用锚定 + 日志结论沉淀 |
| D9 | 仅产品内访问；MVP 不做 MCP 接入面 |
| D10 | 扁平 + 多标签；不做层级 |
| D11 | `draft → published → archived`；就地编辑 + 不可变版本 + 回滚；Agent 永不编辑已有条目 |
| D12 | 文件上传直接生成文件型条目 |
| D13 | 检索索引只含已发布条目 |
| D14 | Agent 建草稿保留 HITL 审批中断 |
| D15 | 沉淀 MVP 来源：仅日志分析结论 |
| D16 | `/knowledge` + `/knowledge-admin`；Agent 草稿队列放治理面 |
| D17 | 单人编辑乐观锁；编辑/预览分屏；不做实时协同 |
| D18 | `knowledge:view` / `knowledge:edit` / `knowledge:manage`，发布者负责制 |
| D19 | 三阶段交付：基座、RAG 与小泽、沉淀回路 |
| D20 | 本次会话交付物为文档；实现从执行计划启动 |
