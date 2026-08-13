# 日志分析结果的相关知识推荐

> Status: **Completed 2026-08-13**——经 #400 合并
> Date: 2026-08-13
> Branch: `feat/knowledge-log-recommendations`
> English: [`docs/exec-plans/completed/2026-08-13-knowledge-log-recommendations.md`](../../../exec-plans/completed/2026-08-13-knowledge-log-recommendations.md)
> 设计: [`docs/zh-CN/design-docs/2026-08-12-knowledge-base-design.md`](../../design-docs/2026-08-12-knowledge-base-design.md) — 延后路线图第 1 项(评审决策 D8 将其列为 MVP 后第一个增量)

## 目标

已完成的日志分析记录展示与其结论最相关的已发布知识条目:后端从存储的分析记录 DTO(结论/影响文本)推导相似度查询,经现有混合检索(有向量时向量 + 全文融合,否则仅全文/trigram)并施加相关度截断;日志结果页渲染「相关知识」区块,含 `/knowledge?entryId=…` 引用深链、诚实的检索模式说明与「暂无相关知识」空态。

## 非目标

- 不耦合分析器内部或规则 ID——相似度查询只读存储的分析记录 DTO(结论、影响);`LogAnalysisAdapter` 背后的并行内核重写不受影响。
- 不改动 worker 侧 `read_domain_knowledge` 检索缝隙(`logDomainRetrieval.ts`)。
- 无新迁移、无嵌入配置或索引管线变更;纯读端点不写审计(与 `knowledge.search` 一致)。
- 参数-知识结构化引用、重载运行沉淀、集合等仍属延后路线图。

## Git 与 PR

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在 `feat/knowledge-log-recommendations` 上提交;不 push、不开或合并 GitHub PR |
| 父代理 | 审查、验证、开/合 PR,并同步本地 `main` |

## 任务概要

1. 先注册验收 ID `KB-REC-001`(覆盖图 + 操作矩阵,中英文)再实现 UI。
2. 后端:`GET /api/v1/knowledge/related-to-log`,`knowledge:view` + `logs:view` + 组织隔离服务端强制;仅已发布条目;相关度截断;诚实 `retrieval.mode`;OpenAPI 工件与契约检查更新。
3. 前端:`KnowledgeRepository.relatedToLog` 端口(API/mock 对等)、`KnowledgeCapability.canView`、日志结果页「相关知识」区块(加载/错误/空态、引用深链、检索模式说明,无 `knowledge:view` 则隐藏)。
4. 验收:扩展 `e2e/acceptance/knowledge.acceptance.spec.ts`(草稿/归档永不出现;深链进入 `/knowledge`)。
5. 文档:api-contract 中英、FRONTEND 中英、设计文档路线图第 1 项标记已交付、product-spec 复查。

## 成功标准

- 对调用者可读的已完成分析,端点返回 top-N 相关**已发布**条目(引用字段齐全、按相似度诚实排序、不相关条目被截断而非凑数);草稿与归档条目永不出现。
- 无 `knowledge:view` 或 `logs:view` 返回 403;跨组织记录 404;未完成分析 400。
- API 与 mock 两种模式下,持有 `knowledge:view` 的用户在日志结果页看到可用的「相关知识」区块;无权限用户看不到该区块。

## 文档影响矩阵与更新门禁

见英文版同名计划;中英文配套同步更新。
