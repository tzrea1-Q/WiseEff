# 日志分析 LLM 运行手册

> English: [English](../../runbooks/log-analysis-llm.md)

在 staging 或试点环境验证日志分析 LLM 路径时使用本运行手册。内核在日志 worker 内、`LogAnalysisAdapter` 之后运行（ADR-0022），使用独立 `LOG_ANALYSIS_*` 环境变量家族，不用 LangGraph、不进 ToolRegistry、没有任何写路径——全部输出是仅供参考、证据接地的报告。自 P2 起默认内核是**有界 agent 循环**（`LOG_ANALYSIS_KERNEL=loop`）：一个至多 `LOG_ANALYSIS_MAX_STEPS` 步的普通 for 循环，驱动五个只读工具（`search_log_lines`、`read_line_range`、`get_prefilter_findings`、`read_domain_knowledge`、`get_related_parameter_context`），在 `rootcause` 阶段内运行并按步推进进度条。P1 单发内核保留为配置回退（`LOG_ANALYSIS_KERNEL=single-shot`）。

## 必需配置

- `LOG_ANALYSIS_API_BASE_URL`
- `LOG_ANALYSIS_MODEL`
- `LOG_ANALYSIS_API_KEY`
- `LOG_ANALYSIS_API_TIMEOUT_MS`
- `LOG_ANALYSIS_TOKEN_BUDGET`（循环模式：跨步累计 token）
- `LOG_ANALYSIS_KERNEL`（默认 `loop`；回退 `single-shot`）
- `LOG_ANALYSIS_MAX_STEPS`（循环步数上界，默认 6）

验收或离线演练可设 `LOG_ANALYSIS_DETERMINISTIC=true`，无需填写 `LOG_ANALYSIS_API_*`；此时报告的 `model` 记为 `deterministic`。确定性桩模型同时支持两种内核的协议。

未配置且未开确定性模式的部署等同于 provider 宕机：每次分析先重试、最终以显式标注的规则回退报告完成，`/health/ready` 的 `logAnalysisLlm` 报告 missing。该状态可见、不算故障——但生产环境应配置真实 provider，或明确接受降级决策。

## 就绪检查

1. 使用日志分析 LLM 配置启动 API（API 容器 `LOG_WORKER_ENABLED=false` 时还需启动 worker 服务）。
2. 检查 `/health/ready`，确认 `dependencies.logAnalysisLlm` 为 `ready` 且 details 只含安全证据（`baseUrlConfigured`、可选 `model`），绝无密钥或原始 payload。
3. 从私有运维网络检查 `/metrics`：`wiseeff_log_analysis_llm_ready` 反映依赖状态；有流量后 `wiseeff_log_analysis_llm_calls_total`、`wiseeff_log_analysis_llm_latency_ms_*`、`wiseeff_log_analysis_llm_tokens_total`、`wiseeff_log_analysis_degraded_total` 仅带 model/outcome/reason 标签。
4. 在 API mode 上传一份小文本日志，确认报告完成且 `analysisSource = "agent"`、证据行号接地、`prompt_version` 已记录。

## 降级链

- provider 瞬时故障 → job 走既有重试/退避（`LOG_ANALYSIS_QUEUE_ATTEMPTS` / `LOG_ANALYSIS_QUEUE_BACKOFF_MS`）。
- 重试将耗尽的最后一次尝试 → 确定性规则引擎回退，`analysis_source = 'rules-fallback'`、`degraded_reason = 'provider-unavailable'`，job 正常完成（不进死信）。
- 预算内输出无法接地（JSON 非法或引用行全部被接地校验剔除）→ 立即回退并记 `degraded_reason = 'token-budget-exhausted'`。
- 循环内核额外规则：步数或 token 预算耗尽仍无接地结论 → 进行一次提前收敛尝试；收敛成功返回 `analysis_source = 'agent'` + `degraded_reason = 'token-budget-exhausted'`，置信度封顶 0.5；仍失败则同因走规则回退。连续协议违规（非法工具名/参数、非 JSON 输出，连续 3 次）同样按此降级，不再烧预算。
- 连回退也失败才走既有 job 失败/死信路径。

按可见性验证降级路径：关闭或错误配置 provider 后上传日志，确认记录以降级徽标（降级分析 · 规则回退）完成，而不是静默成功；`/logs` 与 `/log-admin` 均应可见。确定性模式下可通过上传含 `WISEEFF_SIMULATE_LLM_PROVIDER_DOWN` 标记行的日志演练同一链路。

## 安全预期

- 内核没有写路径：不接触设备、不改参数、不进 ToolRegistry、无 approval 链。五个循环工具是 worker 内部只读函数，组织隔离在仓储查询层强制。
- 日志内容、检索到的领域知识与参数上下文都是不可信模型输入；接地校验约束虚构引用，嵌入其中的指令不得改变输出契约。`read_domain_knowledge` 只见已发布知识条目（published-only 不变量），域有关联时限定在关联条目集合内。
- 降级分析绝不冒充完整分析；来源标注保留在报告行与 UI 上。
- 提示词变更必须递增 `LOG_ANALYSIS_PROMPT_VERSION`（单发）或 `LOG_ANALYSIS_LOOP_PROMPT_VERSION`（循环）并通过 `npm run logs:eval`（行为层评测，CI 门禁）；模型或提示词变更还应在发布前运行 `npm run logs:eval:quality`。

## 效果层评测（`logs:eval:quality`）

- 确定性演示（零 API 成本）：`LOG_ANALYSIS_DETERMINISTIC=true npm run logs:eval:quality`——用确定性内核 + 确定性 rubric judge 跑金标准案例集。
- 真模型运行：配置 `LOG_ANALYSIS_API_*`（可选 `LOG_ANALYSIS_JUDGE_*` 启用 LLM-as-judge）后运行 `npm run logs:eval:quality`。
- 报告输出到 `docs/generated/log-analysis-quality.{json,md}`，含内核、模型、prompt version 与 judge 标签。基线门禁（`eval-cases/logs/baseline.json`）将 realLog 案例分数与已提交基线减容差比较；案例集尚无真实案例时报告如实输出 `quality baseline pending real cases`，门禁不激活。

## 证据

记录：

- model 标签，
- prompt version，
- request/trace id，
- latency 与 token 数，
- 降级原因（如适用），
- 分析来源（`agent` / `rules-fallback`）。

不得向仓库文档提交 API key、原始 prompt、原始 provider payload、Authorization 头或原始客户日志内容。

## Smoke 命令

```bash
npm run logs:eval
npm run logs:eval:quality
npm run acceptance:e2e -- e2e/acceptance/log-analysis.acceptance.spec.ts
```

行为层评测报告输出到 `docs/generated/log-analysis-eval.{json,md}`，效果层报告输出到 `docs/generated/log-analysis-quality.{json,md}`；验收 ID `LOG-DOMAIN-001`、`LOG-DEGRADED-001` 与 `LOG-DOMAIN-KNOWLEDGE-001` 覆盖业务域治理、降级可见性与知识条目关联。
