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

## judge 校准（P3b）

- 每次效果评测按确定性规则抽样已评分案例（case id 哈希，抽样率 `LOG_ANALYSIS_JUDGE_SAMPLE_RATE`，默认 0.2，至少 1 条），产出人工复核清单 `docs/generated/log-analysis-judge-sample.md`：含 agent 结论、judge 打分与理由，以及可直接填写的 YAML 模板。
- 复核人把填好的模板提交为 `eval-cases/logs/reviews/<run-id>.yaml`（`runId`、`reviewer`、`reviewedAt`，每案例 `humanRootCauseScore` 0..1 + 可选 `humanCategoryMatch`/`notes`）。损坏的复核文件会让效果评测直接失败——必须修复，绝不静默丢弃。
- 存在复核文件时，报告固定的「Judge calibration」段落计算 judge-human 一致性：精确一致率（分数完全相同）、均差（平均绝对差）与类别一致率；没有复核时如实输出 "no human reviews yet"。judge 漂移（均差上升）意味着在让它的分数参与门禁之前需要先调 judge 提示词/rubric。

## 质量门禁工作流（发布检查单）

- 发布前若改动过提示词、模型、内核或金标准案例：手动触发 GitHub Actions 的 **Log analysis quality gate** 工作流（`log-analysis-quality-gate.yml` 的 `workflow_dispatch`）；它同时每周定时跑一次作为漂移监控。CI 无真实 key，以确定性模式运行；工作流注释说明配置 secrets 后切换真模型的方法。
- 读工件（`log-analysis-quality-report`）：先看 `Baseline gate`——真实专家标注案例落地前 `inactive-pending-real-cases` 是预期；`failed` 阻断发布（真实案例质量跌破基线减容差）。再看 `Judge calibration` 的抽样与一致性状态，以及 `Problems` 的加载/复核文件错误。带 `pending` 标注的绿色运行是诚实,不是质量通过——合成案例只覆盖格式面。

## 结果 Webhook（P3b）

- 按域配置在 `/log-admin` → 业务域治理 → 结果回调（URL、只写密钥、启用开关）；发送端调参用 `LOG_WEBHOOK_TIMEOUT_MS` / `LOG_WEBHOOK_MAX_ATTEMPTS` / `LOG_WEBHOOK_RETRY_BASE_DELAY_MS`。终态事务持久化 outbox，轮询及 Redis 模式的日志 worker 都负责排空；HTTP 故障不影响分析，入队失败则回滚终态事务。崩溃后租约到期可恢复；接收方按稳定 `eventId` 去重，耗尽重试后状态为 `failed`。该通道仍不进入 `/health/ready`。
- 升级前向 API 与日志 worker 提供同一个 `LOG_WEBHOOK_SECRET_ENCRYPTION_KEY`（`openssl rand -base64 32`），跨重启保存并独立备份。先运行 migration `0185`；启动会幂等加密现有明文行。生产环境已有回调配置而缺少密钥时拒绝启动；开发/测试才可使用确定性默认值。 migration 同时向已有 `log_domains` INSERT 权限的非 owner、非 PUBLIC 角色授予 outbox DML，无需重新配置运行时 LOGIN。回填只处理 `webhook_secret_encrypted=false` 的行，密钥以 `logwh:` 开头也仍作为明文处理；写入信封时将标记设为 true。已标记密文不在启动时解密；密钥 ID 不匹配或完整性校验失败只使该域投递立即失败，原因写入投递记录，其它域及进程启动不受影响。
- 轮换：停止所有 API 与日志 worker，备份数据库及旧密钥。使用下方离线调用，将旧密钥放在 `LOG_WEBHOOK_SECRET_ENCRYPTION_KEY`，新密钥放在临时环境变量 `LOG_WEBHOOK_SECRET_ENCRYPTION_KEY_NEXT`；脚本在单一事务中重新加密，并写入新密钥指纹。成功后将所有进程配置切换到新密钥再启动；保留旧密钥以恢复旧备份，切勿仅替换环境变量。 离线轮换只重加密已标记且密钥 ID/版本不同的行；旧密钥错误时整个轮换事务回滚。

```bash
node --import tsx --input-type=module <<'JS'
import { createPostgresDatabase } from './server/shared/database/client.ts';
import { ensureLogWebhookSecretsEncrypted } from './server/modules/logs/webhookSecrets.ts';
import { resolveLogWebhookSecretKey } from './server/config/logWebhookSecretKey.ts';
const db = createPostgresDatabase(process.env.DATABASE_URL);
try {
  await ensureLogWebhookSecretsEncrypted(db, {
    previousKey: resolveLogWebhookSecretKey(),
    key: resolveLogWebhookSecretKey({
      NODE_ENV: 'production',
      LOG_WEBHOOK_SECRET_ENCRYPTION_KEY: process.env.LOG_WEBHOOK_SECRET_ENCRYPTION_KEY_NEXT
    })
  });
} finally { await db.close(); }
JS
```

- 排障「消费方什么都没收到」：打开该域的最近投递列表（或 `GET /api/v1/log-domains/:domainId/webhook-deliveries`）——按次行显示已送达/重试中/投递失败与 HTTP 码或错误。`webhook-url-private-address` 错误表示 URL 被 SSRF 拦截（见 `docs/zh-CN/SECURITY.md`）；未分类日志永远不触发 Webhook；未配置/未启用按设计静默跳过。
- 用带审计的「发送测试投递」按钮沿生产同路径探测接收端。指标：`wiseeff_log_webhook_deliveries_total{domain,outcome}` 与 `wiseeff_log_webhook_delivery_duration_ms_*`——某个域的 `failed`/`blocked` 上升是接收端或配置问题,不是分析问题。
- 接收端校验（签名、重放窗口）见 `docs/zh-CN/api/log-analysis-integration.md`。

## 线上反馈监控（P3）

- `/log-admin` →「分析质量」区读取 `GET /api/v1/logs/feedback-insights`（`logs:view`）：按业务域 × 分析来源 × Prompt 版本聚合 today/7d/30d 的有帮助率，监控两次效果评测之间的线上反馈漂移；金标准案例集仍是质量锚点。
- 运维读法：有帮助率下跌集中在某个 `promptVersion` → 指向 prompt/模型回归（对比上一版本行并重跑 `logs:eval:quality`）；下跌集中在某个业务域而 prompt 版本稳定 → 指向领域知识/格式画像缺口；`analysisSource = rules-fallback` 行占比上升 → 降级链在触发，先查 provider 健康（`/health/ready`、降级计数器）。
- 反馈稀疏时比率噪声大；`totalCount` 个位数的格子当轶事看，不当信号用。

## 压缩包接入（P3）

- 支持多个普通文件或单个 `.tar/.tar.gz/.tgz/.zip/.gz` 压缩包，内层压缩条目最多展开一次。所有安全校验发生在对象存储写入前；拒绝时仍返回 `201` 及失败记录（`failureReason`、`inline/` 伪存储键），不写对象、不创建任务，并写入 `log-upload-failed` 审计及 `{ fileName, failureReason }` 元数据。日志包及压缩包原因使用中文；不支持扩展名的单个普通文件保留原英文提示。非预期异常统一返回压缩包完整性提示。没有可分析文件时保存跳过原因及失败记录，不创建任务。
- 默认限制为上传 100 MiB、解包文件总量 100 MiB、2000 个文件、单文件 100 MiB，由 `LOG_BUNDLE_MAX_COMPRESSED_BYTES`、`LOG_BUNDLE_MAX_UNPACKED_BYTES`、`LOG_BUNDLE_MAX_FILES`、`LOG_BUNDLE_MAX_FILE_BYTES` 配置；每次解压保留 200 倍比例及 1 MiB 最低预算，超限提前终止。普通文件也受上传总量限制。tar.gz 中间 tar（含头及填充）受剩余总量限制。
- 默认值按标准自托管 512 MiB API / 384 MiB worker 容器的内存预算设置，沿用原单文件 100 MiB 上限。流式接入（#1234）落地前，提高限制必须同时增加容器内存。下方探针对 95 MiB 日志包在独立进程中测得峰值 RSS 357 MiB。
- 排障先读上传对话框的规则原因，再读报告「文件」清单：二进制或不支持扩展名显示已跳过；有损解码有标记。证据按文件及行号定位。对象存储逐文件保存解码后的 UTF-8；旧记录没有 `log_files` 时继续读单对象。
- 可单独运行 `npx tsx scripts/log-bundle-memory-probe.ts` 探测接近上限的接入内存；不要加入测试。探针处理三个文件、总计 95 MiB，执行接入及逐文件 UTF-8 存储/复制到临时丢弃接收端，输出进程峰值 RSS 及存储后的堆内存；RSS 峰值包含压缩包构造阶段。
- 当前 worker 在一次分析内保留逐文件解析行及条目，尚未实现流式行偏移索引；大包可能产生较高峰值内存。

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

行为层评测报告输出到 `docs/generated/log-analysis-eval.{json,md}`，效果层报告输出到 `docs/generated/log-analysis-quality.{json,md}`；验收 ID `LOG-DOMAIN-001`、`LOG-DEGRADED-001` 与 `LOG-DOMAIN-KNOWLEDGE-001` 覆盖业务域治理、降级可见性与知识条目关联，P3a 的 `LOG-FEEDBACK-INSIGHTS-001`、`LOG-EVAL-DRAFT-001` 与 `LOG-ARCHIVE-UPLOAD-001` 覆盖反馈质量看板、标注草稿导出与压缩包上传。
