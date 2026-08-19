# 架构总览

> English: [English](../../../ARCHITECTURE.md)

这是核心入口文档，帮助开发者理解仓库地图、运行模式、治理规则和下一步阅读路径。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：core。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 组织管理（ADR-0037）是本组织租户运营：`server/modules/users/` 提供 `GET`/`PATCH /api/v1/organization`，产品入口为 `/organization`。硬件/软件是 Role 学科，不是 Organizations。
- 参数身份已从路径派生模型转向 `parameter-topology` / `parameter-specs`（源树 vs 生效树、稳定 binding、版本化规格）；生产切换见 `docs/runbooks/parameter-identity-cutover.md`。
- 模块归属 v2 后端在 `server/modules/parameter-modules/`：注册表、发现 hints、compatible 忽略、映射预览/范围应用、binding 重算（`dryRun`）与驱动组解散；工作台与 `/parameter-admin/modules`（**模块归属**）共用该边界。
- DTS 重载调试在 `server/modules/dts-reload/`：调试 overlay 生成与预检、重载配置、进程内桥接部署（ADR-0020）、重载快照（ADR-0021）、残留 / 恢复基线与运行历史。权限 `debugging:dts-reload`；UI 为 `/dts-reload`，配置在 `/debugging-admin`（节点目录对等页为 `/debugging-admin/nodes`）。
- 知识库在 `server/modules/knowledge/`：组织级知识条目与不可变修订、经对象存储的文件上传与正文提取 seam（pdf-parse/mammoth）、仅 `published` 的混合检索,以及 `knowledge:view|edit|manage` 服务端强制。`knowledge/indexing/` 是异步分块索引 worker seam（默认轮询,镜像 logs worker）：发布/编辑/归档把逐条目刷新入队 `knowledge_index_status`,chunk 经 `EMBEDDING_API_*` seam 携带可选 pgvector 嵌入,检索用 RRF 融合向量与 FTS/trigram 排名,扩展或端点缺失时诚实降级为 FTS-only（ADR-0025）。小泽新增只读工具 `knowledge.search` / `knowledge.getDocument`（组织级、`knowledge:view`、仅 published、返回引用负载）。UI 为 `/knowledge`（检索、API 模式下的问小泽入口）,已归档治理与索引健康/重建在 `/knowledge-admin`;Agent 草稿在蒸馏阶段接入。
- 日志分析内核在 `server/modules/logs/analyzer/`（ADR-0022,小泽栈之外、零写路径）：P2 默认有界 agent 循环（`agentLoop.ts`,`LOG_ANALYSIS_KERNEL=loop`,至多 `LOG_ANALYSIS_MAX_STEPS` 步严格 JSON,五个只读组织级工具,含经 `log_domain_knowledge_links` 关联的已发布知识条目检索）,P1 单发内核保留为 `single-shot` 回退;两层评测在 `server/modules/logs/eval/`（行为层 `logs:eval` CI 门禁、效果层 `logs:eval:quality` + `eval-cases/logs/` 金标准案例集与基线门禁）。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。
- 只有 IP、没有域名的自托管实验室走 [配置向导](../../../ops/self-hosted/setup.zh-CN.md) / [IP 实验室 profile](../../../ops/self-hosted/ip-lab.zh-CN.md)，不走 Let's Encrypt Caddyfile。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](AGENTS.md)
- [docs/zh-CN/root/README.md](README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/zh-CN/README.md](../README.md)
- [docs/zh-CN/frontend.md](../frontend.md)
- [docs/zh-CN/PLANS.md](../PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](../QUALITY_SCORE.md)
