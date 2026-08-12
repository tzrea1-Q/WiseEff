# Agent 日志分析系统

> Status: **Active（P1 已在 `feat/log-analysis-p1-domains-and-llm` 分支实现，评审中；P2/P3 未开始）**
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
- **P2（agent 循环 + 工具 + 领域知识 + 金标准 v1 + 效果评测）**：首任务盘点存量标注；有界循环内核（映射 `rootcause` 阶段进度）+ 5 个只读工具（`search_log_lines`、`read_line_range`、`get_prefilter_findings`、`read_domain_knowledge`、`get_related_parameter_context`）；领域知识文档表与检索；金标准集 v1（`eval-cases/logs/`，脱敏 + YAML 标注）；效果层评测（真模型、基线对照、`logs:eval:quality`、容差门禁）。
- **P3（评测进阶 + 接入扩展）**：judge 校准与门禁自动化；`log_feedback` 线上看板进 `/log-admin`；线上案例一键转标注草稿；SDK/回调、压缩包解包、按域模型覆盖（仅当真实需求出现）。

## 安全与隐私

内核只读、按组织隔离、无审批链（ADR-0022），TD-068 不适用（无写路径）。日志内容与知识文档按不可信模型输入对待：工具只读、输出建议性且证据接地。Provider 证据纪律沿用 `docs/runbooks/agent-provider.md` 模式。金标准案例入 git 前必须通过脱敏清单。P1 交付的同一变更内更新 `docs/SECURITY.md`。

## 验证

每阶段：定向 vitest、`npm run build`、`npm run docs:check`；`npm run logs:eval`（P1 起进 CI）、`npm run logs:eval:quality`（P2 起）；前端可见阶段用 playwright-cli 检查 `/logs` 与 `/log-admin`（1440x900 / 768x1024 / 390x844，snapshot + screenshot + console error）。验收 ID:现有 `LOG-HAPPY-001`、`LOG-REANALYZE-001`;P1 实施前新增 `LOG-DOMAIN-001`、`LOG-DEGRADED-001` 并扩展 `e2e/acceptance/log-analysis.acceptance.spec.ts`。

## 文档影响矩阵与更新门禁

见英文版同名计划；中英文配套同步更新。P1 行已勾选完成：domain-model、api-contract + OpenAPI、FRONTEND、SECURITY、environment-variables、runbook（`docs/runbooks/log-analysis-llm.md`）、ARCHITECTURE、product-spec、验收覆盖图与操作矩阵（LOG-DOMAIN-001 / LOG-DEGRADED-001）均已中英同步更新，db-schema 经 `npm run db:schema-doc` 再生成（迁移 `0104_log_domains.sql`）。
