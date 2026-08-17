# Agent 日志分析系统

> Status: **Active — 实现已在 `main` 上完成；剩余工作仅外部输入**（P1–P3b 已合并，含 `feat/log-analysis-p3b-callbacks-calibration`。待落地：每域 20–50 条专家标注真实案例、第二个试点域、人工 judge 校准记录。见 P2/P3 状态注记。当前没有开放 PR。）
> Date: 2026-08-12
> 规划分支：`plan/agent-log-analysis`（本文档、词汇表、ADR-0022）
> 实施分支：`feat/log-analysis-p1-domains-and-llm`、`feat/log-analysis-p2-agent-loop-and-golden-set`、`feat/log-analysis-p3-eval-maturation`（每阶段一支，均从最新 `main` 拉出）
> English: [`docs/exec-plans/active/2026-08-12-agent-log-analysis-system.md`](../../../exec-plans/active/2026-08-12-agent-log-analysis-system.md)
> 决策记录：2026-08-12 拷问会 25 问全部敲定；术语已登记 `CONTEXT.md`；栈决策见 [ADR-0022](../../../adr/0022-log-analysis-agent-runs-outside-the-xiaoze-stack.md)

## 目标

在已上线的 M2 日志分析管线上原地演进：把 `LogAnalysisAdapter` 背后的 4 条正则规则内核替换为**证据接地的日志分析 Agent**；新增组织作用域的**日志业务域**（格式画像 + 领域知识 + 分析侧重），支持多业务接入；建设**两层评测体系**（行为层进 CI、效果层跑金标准案例集）为每次提示词/模型变更设门禁。上传 → 对象存储 → 任务/阶段 → 证据 → 报告 → 反馈的管线、四阶段词表（`parse/pattern/rootcause/report`）与现有输出契约保持不变（仅一处经批准的 additive 例外）。

## 已定决策要点（拷问会 Q1–Q25）

- **定位**：原地演进，不建平行系统；内核是多步自主循环，与小泽严格分离（ADR-0022）。
- **日志业务域**：`/log-admin` 内治理（新权限 `logs:admin-domains`）；上传经可选选择器/API 字段绑定；未指定落**未分类域**（通用分析，绝不阻塞上传）。试点域：充电/电源子系统 kernel log + 未分类域；第二个真实域在 P2 启动前由产品负责人点名（标准：能找到专家做 20–50 条标注）。
- **接入**：MVP = 现有 `/logs` UI + REST API 加 `logDomainId` 字段；SDK/结果回调推迟到 P3。
- **效果判据**（优先级）：证据接地 > 根因正确 > 不编造 > 回答 `analysisQuestion` > 建议可执行。
- **输出契约**：除"分析器来源/降级标记"（`analysisSource` 等 additive 字段）外维持现状；**降级分析绝不冒充完整分析**。
- **Provider**：OpenAI 兼容端点，独立 `LOG_ANALYSIS_*` 环境变量族（全局配置；按域覆盖等真实需求出现再加）。证据纪律：记 model/延迟/token/trace id，不记原始 prompt 与 provider payload。
- **兼容性**：MVP 用声明式格式画像兼容各业务方言（UTF-8 文本、稳定行号）；压缩包解包进 P3 待办；二进制与 100MB+ 继续排除。
- **性能**：≤10MB 文本日志 p95 ≤ 3 分钟；确定性预筛限定模型阅读量；每次分析 token 预算；队列并发沿用现状；租户限流不做。
- **规则引擎**：保留且仅三个角色——预筛信号源、降级回退、评测基线。
- **评测**：建设顺序 = 回归门禁 → 选型 benchmark → 线上监控，共享一套金标准案例集（真实日志 + 专家认定根因/证据/动作；合成日志只算格式覆盖）。冷启动每域 20–50 条专家标注；P2 首任务盘点存量标注数据。两层：行为层（确定性假模型，进 CI）+ 效果层（真模型，提示词/模型变更与发布前跑，门禁 = 上一基线 − 声明容差）。判定：证据行重叠率确定性计算 + 根因正确性用 rubric + LLM-as-judge（抽样人工复核）；根因分类枚举仅评测用，不进产品契约。案例脱敏后入库 git；无法脱敏的不进集。

## 非目标

- 小泽参与日志分析，或共享 LangGraph/ToolRegistry/审批链（ADR-0022）。
- Agent 的任何写路径：不碰设备、不改参数；输出永远是建议性报告。
- 二进制日志、100MB+ 日志、分片上传；P3 之前不做压缩包。
- P3 之前不做按域模型覆盖、租户限流、SDK/回调接入。
- 不改四阶段词表、不改 mock 运行时的静态日志种子、不依赖知识库工作流（领域知识文档是 MVP 知识源，日后迁移）。

## Git 与 PR

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在阶段分支上提交；不打开或合并 GitHub PR |
| 父代理 | 审查、验证、开/合 PR，并同步本地 `main` |

一阶段 → 一分支 → 一 PR。规划分支 `plan/agent-log-analysis` 只承载文档。

## 架构与阶段

- **P1（业务域 + LLM 单次分析 + 诚实降级 + 行为评测）**：`log_domains` 表与治理面；格式画像感知的解析；`llmAnalyzer.ts`（单次预算调用、接地校验拒绝引用不存在的行、注入 `analysisQuestion`、版本化提示词）；降级链（provider 故障 → 重试 → 规则回退并标注；预算耗尽 → 提前收敛低置信）；`LOG_ANALYSIS_*` 配置 + 就绪检查 + 指标；前端业务域选择器、降级徽标、自适应轮询上限；`logs:eval` 行为评测进 CI（含"脚本化幻觉模型必须被 harness 抓住"的元自检）。
- **P2（agent 循环 + 工具 + 领域知识 + 金标准 v1 + 效果评测）**：首任务盘点存量标注；有界循环内核（映射 `rootcause` 阶段进度）+ 5 个只读工具（`search_log_lines`、`read_line_range`、`get_prefilter_findings`、`read_domain_knowledge`、`get_related_parameter_context`）；领域知识检索；金标准集 v1（`eval-cases/logs/`，脱敏 + YAML 标注）；效果层评测（真模型、基线对照、`logs:eval:quality`、容差门禁）。

**P2 状态注记（2026-08-13，`feat/log-analysis-p2-agent-loop-and-golden-set`）：**

- 已交付：`agentLoop.ts` 有界循环成为默认内核（`LOG_ANALYSIS_KERNEL=loop`、`LOG_ANALYSIS_MAX_STEPS` 默认 6；单发内核保留为配置回退）；`analyzer/tools/` 五个只读组织级工具（zod 校验、结果截断）；循环进度映射 `rootcause` 65→80 区间；确定性循环协议桩模型；迁移 `0107_log_domain_knowledge_links` + 关联治理（`GET`/`PUT /api/v1/log-domains/:domainId/knowledge-links`，仅已发布条目，审计）+ `/log-admin` 知识条目编辑器（`LOG-DOMAIN-KNOWLEDGE-001` 自动化）；`read_domain_knowledge` 走知识模块混合检索（RRF、SQL 层 published-only、测试用确定性假嵌入）；金标准案例集 v1 机制（schema/loader/README 中英，六条 `realLog: false` 合成格式覆盖种子）；效果层 runner（`logs:eval:quality`，证据重叠/幻觉率/拒答恰当率 + rubric judge 接缝 + 基线门禁，当前如实输出 `quality baseline pending real cases`）；行为层新增 8 个循环场景 + 2 个循环 meta 自检。
- **迁移重编号（P2 修复）**：P1 与知识蒸馏两个 PR 在 main 上各自落了 `0105_*` 迁移，破坏了迁移前缀唯一性不变量。P2 将 `0105_log_domains.sql` 重命名为 `0106_log_domains.sql`（内容不变且完全幂等，旧名下已应用的库可安全重放），关联表以 `0107_log_domain_knowledge_links.sql` 落地并带可重放的约束守卫。
- **适配（已批准）**：未建计划原文的 `log_domain_knowledge_docs` 平行表——知识库先落地 main，业务域改为关联已发布知识条目，`CONTEXT.md`「Domain knowledge document」词条已同步更新。
- **未决外部依赖（不阻塞、如实跟踪）**：(1) 与领域专家盘点存量标注数据——无法在仓库内完成，归属产品负责人 + 领域专家；(2) 第二个真实试点域由产品负责人点名；(3) 每域 20–50 条脱敏真实标注案例——落地前质量分只覆盖合成格式案例，基线门禁保持不激活。
- **P3（评测进阶 + 接入扩展）**：judge 校准与门禁自动化；`log_feedback` 线上看板进 `/log-admin`；线上案例一键转标注草稿；SDK/回调、压缩包解包、按域模型覆盖（仅当真实需求出现）。

**P3a 状态注记（2026-08-13，`feat/log-analysis-p3a-monitoring-annotation-intake`）**——P3 中不依赖外部输入的子集已交付：

- [x] **线上监控（评测建设顺序第三步起步）**：组织隔离的 `GET /api/v1/logs/feedback-insights`（`logs:view`）按业务域 × `analysisSource` × `promptVersion` 聚合 `log_feedback` 有帮助率（支持 today/7d/30d 时间窗口，归因到日志当前 run 的报告）；`/log-admin` 新增只读「分析质量」DataTable 区，空数据诚实显示「暂无反馈」。验收 `LOG-FEEDBACK-INSIGHTS-001`。
- [x] **标注草稿工具（金标准集冷启动入口）**：`LogRecordDrawer`「导出评测案例草稿」把已完成记录组装为 `eval-cases/logs` 的 `case.yaml` 草稿（realLog: true、**deIdentified: false**、rootCauseCategory TODO、证据行号/根因要点/建议动作预填）+ `log.txt`，纯前端双文件下载，弹层展示 README 脱敏清单；刻意不做自动入库/自动提交——必须人工脱敏并把 deIdentified 改为 true。验收 `LOG-EVAL-DRAFT-001`。
- [x] **压缩包解包（第 4 项的解包部分）**：上传入库前解压单文件 gzip 与单条目 zip（多条目/加密/损坏/超限 → 既有"不支持格式"失败路径 + 明确原因）；解压后 ≤ 100MB 绝对上限且 ≤ 压缩体 200 倍（1MB 下限）；对象存储保持纯文本，证据行号不受影响。验收 `LOG-ARCHIVE-UPLOAD-001`。同阶段关闭 TD-088（`check-operation-evidence.ts --run <dir>` focused 运行一等校验）。
**P3b 状态注记（2026-08-13，`feat/log-analysis-p3b-callbacks-calibration`）**——先前挂起的 P3 项按产品负责人的形态决策落地（结果回调 = 域级签名 Webhook，打包 SDK 以集成指南替代；按域覆盖 = 仅模型名；校准 = 机制先行）：

- [x] **第 4 项（回调部分）——域级结果 Webhook**：迁移 `0108` 给 `log_domains` 加 Webhook 配置列，并新增按次记录的 `log_webhook_deliveries` 表（沿用 0107 复合组织外键）。worker 在两类终态（完成含降级、死信失败）后发出尽力而为、不阻塞的签名投递（对 `timestamp.rawBody` 的 HMAC-SHA256 + 时间戳头）；硬性反 SSRF（仅 https,私网/环回/链路本地/元数据段在保存时与连接自带的校验型 DNS lookup 双重拒绝,不跟随重定向,短超时,丢弃响应体）；治理走 `logs:admin-domains` + `withAuditedWrite`,密钥只写不读（显示末四位）,`/log-admin` 配置编辑器 + 最近投递列表 + 带审计的测试投递；指标 `wiseeff_log_webhook_deliveries_total{domain,outcome}` 与时延；有意不进 `/health/ready`。验收 `LOG-DOMAIN-WEBHOOK-001`。打包 SDK 明确**不做**——`docs/api/log-analysis-integration.md`（中英）覆盖推送 → 轮询 → 取结果 → Webhook 验签（Node 与 openssl 示例、重放窗口、重试语义）；等真实消费方点名 SDK 需求再议。
- [x] **按域模型覆盖（仅模型名）**：`log_domains.model_override` 可空列（同一 `0108` 迁移）；analyzer env 工厂按次分析解析生效模型名（覆盖只替换模型**名**——端点/key/超时/预算仍全局），自然流入报告 `model` 溯源与指标标签；`/log-admin` 域表单新增字段（placeholder 留空使用全局模型）；`logs:eval` 新增覆盖生效行为断言（确定性模式）。验收 `LOG-DOMAIN-MODEL-001`。按域端点/key 覆盖仍**不做**——无真实需求。
- [x] **第 1 项——judge 校准机制 + 门禁自动化（机制先行）**：效果评测按确定性规则抽样已评分案例（id 哈希,`LOG_ANALYSIS_JUDGE_SAMPLE_RATE` 默认 0.2,至少 1 条）产出 `docs/generated/log-analysis-judge-sample.md` 复核清单（含可填写模板）；提交的复核记录（`eval-cases/logs/reviews/<run-id>.yaml`,schema 校验 loader,损坏文件使运行失败）激活报告固定的 judge-human 一致性段落（精确一致率 + 均差 + 类别一致率）——在此之前如实输出 "no human reviews yet"。新增 `log-analysis-quality-gate.yml` 工作流（workflow_dispatch + 每周定时）跑带门禁的确定性评测并上传报告工件；runbook 补「发布前手动触发 + 如何读报告」。真实专家标注案例未到位时全链路今天即可跑通（基线门禁 `inactive-pending-real-cases`,不伪造复核）。
- **仍挂起——只剩真正的外部输入**：每域 20–50 条真实专家标注案例 + 第二个试点域（P2 外部依赖）；judge 校准的真实人工复核记录（机制已就绪,记录必须来自真实专家对真实案例的复核）。

## 安全与隐私

内核只读、按组织隔离、无审批链（ADR-0022），TD-068 不适用（无写路径）。日志内容与知识文档按不可信模型输入对待：工具只读、输出建议性且证据接地。Provider 证据纪律沿用 `docs/runbooks/agent-provider.md` 模式。金标准案例入 git 前必须通过脱敏清单。P1 交付的同一变更内更新 `docs/SECURITY.md`。

## 验证

每阶段：定向 vitest、`npm run build`、`npm run docs:check`；`npm run logs:eval`（P1 起进 CI）、`npm run logs:eval:quality`（P2 起）；前端可见阶段用 playwright-cli 检查 `/logs` 与 `/log-admin`（1440x900 / 768x1024 / 390x844，snapshot + screenshot + console error）。验收 ID:现有 `LOG-HAPPY-001`、`LOG-REANALYZE-001`;P1 新增 `LOG-DOMAIN-001`、`LOG-DEGRADED-001`;P2 新增 `LOG-DOMAIN-KNOWLEDGE-001`;P3a 新增 `LOG-FEEDBACK-INSIGHTS-001`、`LOG-EVAL-DRAFT-001`、`LOG-ARCHIVE-UPLOAD-001`;P3b 新增 `LOG-DOMAIN-WEBHOOK-001`（治理区配置 Webhook,域绑定分析向本地接收端投递签名载荷,最近投递 + 审计）与 `LOG-DOMAIN-MODEL-001`（域表单保存模型覆盖,API/DB 持久化,报告 `model` 溯源生效）,均在 `e2e/acceptance/log-analysis.acceptance.spec.ts`;focused 运行可用 `npm run acceptance:evidence -- --run <dir>` 做一等证据校验（TD-088）。

## 文档影响矩阵与更新门禁

见英文版同名计划；中英文配套同步更新。P1 行已勾选完成：domain-model、api-contract + OpenAPI、FRONTEND、SECURITY、environment-variables、runbook（`docs/runbooks/log-analysis-llm.md`）、ARCHITECTURE、product-spec、验收覆盖图与操作矩阵（LOG-DOMAIN-001 / LOG-DEGRADED-001）均已中英同步更新，db-schema 经 `npm run db:schema-doc` 再生成（迁移 `0105_log_domains.sql`）。P2 行已勾选完成：testing-strategy（两层评测）、verification-matrix（`logs:eval` / `logs:eval:quality`）、QUALITY_SCORE 验证门、domain-model（循环内核、知识关联）、api-contract + OpenAPI（knowledge-links 路由）、FRONTEND（关联编辑器）、SECURITY（知识文本按不可信提示词输入、published-only）、environment-variables + `.env.example`（`LOG_ANALYSIS_KERNEL`/`MAX_STEPS`/`JUDGE_*`）、runbook（循环参数、quality eval）、ARCHITECTURE、`CONTEXT.md` 词条迁移、覆盖图与操作矩阵（LOG-DOMAIN-KNOWLEDGE-001）均中英同步，db-schema 经 `npm run db:schema-doc` 再生成（迁移 `0107_log_domain_knowledge_links.sql`；`0105_log_domains.sql` 重编号为 `0106` 以修复继承自 main 的前缀撞号），评测报告与 `eval-cases/logs/baseline.json` 已提交。如实例外：真实标注案例落地前，质量分与门禁只覆盖合成案例。P3a 行已勾选完成：api-contract 中英 + OpenAPI（`logs.feedbackInsights`、压缩包上传）、FRONTEND 中英（分析质量区、草稿导出、上传文案）、runbook 中英（线上反馈监控 + 压缩包接入）、verification-matrix 中英（`acceptance:evidence -- --run`）、eval-cases README 中英（标注草稿导出指南）、覆盖图与操作矩阵中英（`LOG-FEEDBACK-INSIGHTS-001` / `LOG-EVAL-DRAFT-001` / `LOG-ARCHIVE-UPLOAD-001`）、tech-debt tracker 中英（TD-088 关闭）、本计划 Status 与 P3 注记中英；本子集无迁移（看板是聚合查询），故不需 db-schema 再生成。P3b 行已勾选完成：SECURITY 中英（结果 Webhook 的 SSRF 约束、签名方案、密钥处理）、api-contract 中英 + OpenAPI（`logs.setDomainWebhook` / `listDomainWebhookDeliveries` / `sendDomainWebhookTest`、`modelOverride`）、新增 `docs/api/log-analysis-integration.md` 中英 + API README 索引、FRONTEND 中英（Webhook 编辑器、模型覆盖字段）、domain-model 中英（Webhook 配置、投递记录、覆盖字段）、environment-variables 中英 + `.env.example`（`LOG_WEBHOOK_*`、`LOG_ANALYSIS_JUDGE_SAMPLE_RATE`）、runbook 中英（Webhook 运维、judge 校准、质量门禁工作流）、verification-matrix 中英（质量门禁工作流行）、eval-cases README 中英（复核记录约定）、`CONTEXT.md`（Result webhook / Webhook delivery record / Judge-human agreement 词条）、覆盖图与操作矩阵中英（`LOG-DOMAIN-WEBHOOK-001` / `LOG-DOMAIN-MODEL-001`）、db-schema 再生成（迁移 `0108_log_domain_webhooks_and_model_override.sql`）、本计划 Status 与 P3 注记中英。
