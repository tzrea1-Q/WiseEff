# 日志分析 LLM 运行手册

> English: [English](../../runbooks/log-analysis-llm.md)

在 staging 或试点环境验证日志分析 LLM 路径时使用本运行手册。内核在日志 worker 内、`LogAnalysisAdapter` 之后运行（ADR-0022），使用独立 `LOG_ANALYSIS_*` 环境变量家族，不用 LangGraph、不进 ToolRegistry、没有任何写路径——全部输出是仅供参考、证据接地的报告。默认内核是**有界 agent 循环**（`LOG_ANALYSIS_KERNEL=loop`）：一个至多 `LOG_ANALYSIS_MAX_STEPS` 步的普通 for 循环，驱动按运行组合的只读工具，在 `rootcause` 阶段内运行并按步推进进度条。文件、信号、模板、时间线、知识与关联参数工具属于平台能力；解码事件工具要求版本含抽取器。P1 单发内核保留为配置回退（`LOG_ANALYSIS_KERNEL=single-shot`）。

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

- 内核没有写路径：不接触设备、不改参数、不进 ToolRegistry、无 approval 链。循环工具是 worker 内部只读函数，组织隔离在仓储查询层强制。
- 日志内容、检索到的领域知识与参数上下文都是不可信模型输入；接地校验约束虚构引用，嵌入其中的指令不得改变输出契约。`read_domain_knowledge` 只见已发布知识条目（published-only 不变量），域有关联时限定在关联条目集合内。
- 降级分析绝不冒充完整分析；来源标注保留在报告行与 UI 上。
- 提示词变更必须递增 `LOG_ANALYSIS_PROMPT_VERSION`（单发）或 `LOG_ANALYSIS_LOOP_PROMPT_VERSION`（循环）并通过 `npm run logs:eval`（行为层评测，CI 门禁）；模型或提示词变更还应在发布前运行 `npm run logs:eval:quality`。

## 通用信号与工具

每次分析均提取平台信号，不选技能也适用：崩溃特征（kernel panic、Oops、`BUG:`、watchdog、ANR、`FATAL EXCEPTION`、segfault、assert）、至少 60 秒的时间戳间隔、启动或时间重置、十秒内至少五条错误，以及每文件首个错误。模板将变化的数字、十六进制、标识符和路径归一化，保留次数与首末锚点。模式使用 `compileLogPattern`（RE2）；提取两类来源合计最多保存 200 个信号、200 个模板、每信号五个锚点、每证据行 400 字符，并显式标记截断。所钉技能的信号命中加入有界摘要；未选技能的信号摘要只包含通用信号。

技能或领域发现驱动结论、置信度与根因证据；通用信号只作补充，不能提高技能发现的置信度。为保持兼容，未固定技能的上传保留既有充电预筛，因此充电样例仍结论为 thermal foldback。没有领域命中时，由通用信号驱动规则结论。显式固定的技能若没有信号规则，则保持空集，不继承充电规则。确定性模型保留既有优先级与置信度，跨文件选择最强发现，并将引用接地到对应文件。

突发阈值保持为每文件滚动十秒内至少五条错误，用于发现重复故障；孤立错误仍可通过首个错误信号查看。解析后的 error 级别，或独立且不区分大小写的 `ERROR`、`ERR`、`FATAL` 单词均计为错误，无需正式级别字段，因此 `usb 1-1: error -71 while reading descriptor` 计入。无需技能即可用内核 `[秒.小数]` 前缀（前面可有数字 `<priority>`）计算同文件的突发、间隔和时间重置。时钟类型变化会清空突发窗口，不比较或跨文件合并启动时钟与绝对时间；这些前缀也不构成跨文件时间线工具的绝对时间。崩溃行按文件及匹配签名分组，保留稳定的 `kind: crash` 并新增可选 `signature`；报告使用中文类型与通用标题，保留技术签名名称。

模板只保留最先遇到的 200 种归一化结果，再在该集合中按次数排序。已保留模板继续累计次数，并按文件扫描顺序更新首末锚点。达到上限后出现的新种类即使后来很频繁也不会纳入，因此不是全部输入上的精确高频排名。需要更广覆盖时，检查 `truncatedTemplates` 并查阅原始日志。

`LOG_SIGNAL_MAX_MS` 默认 `5000` ms，最大取 `10000`；仅接受正安全整数，格式错误、零、负值或非安全整数均使用默认值。模式匹配与模板归一化每行最多扫描前 6144 个 UTF-16 代码单元。提取在每行前检查截止时间，约每 8 ms 或 64 个检查点让出调度。超时保留已完成结果并标记 `truncated: true, reason: "time_cap"`；缩短行首扫描范围标记 `line_cap`。提取出错时返回带 `extraction_error` 的空摘要，分析继续。这些可选字段保存在既有报告 JSON 中，并在「信号」页提示；数量上限仍由 `truncatedSignals` 和 `truncatedTemplates` 表示。

运行 `npx tsx scripts/log-signals-memory-probe.ts` 检查病理输入：1600 条实际分配的数字词元行约 100 MiB，前置一条崩溃日志。脚本指定 250 ms 预算，断言在 1250 ms 内返回、事件循环得到调度、崩溃证据被保留且标记 `time_cap`，并输出耗时与进程峰值 RSS。耗时不含输入构造，峰值 RSS 包含输入构造。这只检查信号提取，不代表整个 worker 管线。

信号提取与解码共享最多四分之一的剩余租约预算，从信号提取开始时计算；信号提取已用时间会扣减解码额度。worker 不续租，其余预算留给压缩、存储与分析。不能中途抢占单次 RE2 调用，因此行首长度限制也约束单次模式操作。

迁移 `0192_log_signal_summary.sql` 后，运行报告保存 `signal_summary`，记录详情暴露可选 `signalSummary`。每次重新分析保留自身摘要。在 `/logs` 的「信号」页检查来源、种类、严重度、次数和模板首末锚点，点击 `file:line` 标签定位可用的原始行；既有报告内容保留在旁边。

- `get_signals` 返回通用及所钉技能信号，可按 `kind` 或 `severity` 筛选，接受 `offset` 与 1–20 的 `limit`。
- `get_line_templates` 接受 `offset` 与 1–20 的 `limit` 分页，返回模板次数及首末锚点。
- `get_timeline` 仅接受 ISO `time` 或 `file` + 正整数 `line` 之一；`before` 和 `after` 各为 0–20。跨文件窗口按时间戳排序。

三种工具始终可用，输出均有上限。只有实际返回的锚点或行才算已读，与 `read_line_range` 相同；未返回的分页或相邻行不算。规则回退合并通用信号与所钉版本规则，保留既有降级标记和置信度上限。运行 `npm run logs:eval` 重新生成行为评测工件，覆盖合法调用、仅通过新工具获得的接地证据及未读行拒绝。PostgreSQL 运行级集成通过不选技能的多文件上传，检查已保存的崩溃、间隔或重启、错误突发及接地报告。

## 技能诊断流程

- 技能作者在工作区的「诊断流程」分区编辑和预览 Markdown。`skill/v1.procedure` 可选，上限 20,000 字符。保存只更新草稿；发布创建不可变版本。Worker 从运行钉住的 `skill_revision_id` 读取流程，因此后续草稿修改不会改变排队中的运行或显式指定版本的重新分析。新上传使用当前已发布版本。
- 提示词顺序是平台协议 → 分隔、低优先级的技能流程 → 用户任务。流程以 JSON 字符串置于 `<skill_diagnostic_procedure>` 中；换行和分隔符字符经过转义，使结束标签或伪造协议标题保持为数据。提示中明确说明流程不能覆盖接地、拒绝规则或禁止写操作的约束。证据必须来自工具结果；旧单发内核使用平台提供的摘录。工具白名单和既有证据校验仍独立执行。
- 当前版本：循环 `2026-10-19.loop.procedure.signals.1`、关联参数循环 `2026-10-19.loop.procedure.signals.related-parameter.1`；单发 `2026-10-19.procedure.signals.1`、关联参数单发 `2026-10-19.procedure.signals.related-parameter.1`。报告保留对应的 `prompt_version`。无流程时省略流程段，平台信号工具仍可用。确定性规则回退忽略流程。
- 运行 `npm run logs:eval` 检查提示词顺序、对抗性流程、分隔符注入、接地和非法写工具场景。PostgreSQL 运行级测试位于 `server/modules/logs/procedure.integration.test.ts`，通过捕获脚本模型收到的提示词验证发布、草稿隔离和显式钉住版本的重新分析。这些检查不能证明真实模型能抵抗所有提示词注入。

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

## Worker 解码限制

- `LOG_DECODE_MAX_EVENTS` 默认 `50000`，为整个运行保留的事件上限；额外匹配计入 `decoded_event_counts.errors.event_cap`，分析仍使用已保留事件继续执行。
- `LOG_DECODE_MAX_MS` 默认 `15000` ms，最大取 `20000`；信号提取与解码合计最多使用信号提取开始时剩余任务租约的四分之一。worker 不续租，其余预算供压缩、存储和分析使用。解码在每行、组提交和编译前检查截止时间，约每 8 ms 或 2000 个检查点让出调度；超时保留已完成事件、丢弃未完成组、计一次 `time_cap`，保存部分产物与计数后继续分析。worker 不能抢占单次受限 RE2 调用。
- 解析模式最多 512 个 UTF-16 单元，计数重复上限 100，多行控制同样受限；匹配输入每行最多 6144 个单元、每组最多 16,384，超长行/组记录 `match_input_cap`，不执行截断前缀匹配。预览使用固定 100 ms 校验/解码硬超时，最多处理 5000 行、返回 500 事件，以 `truncated` 和 `reason` 标识部分结果，不受 worker 环境变量调整。`query_events` 最多返回 50 事件/16 KiB，字段预览最多 1 KiB，缩短时返回 `truncated: true`。
- 压缩/上传失败计入 `decoded_event_counts.errors.artifact_error`，产物键置空，继续分析且不提供解码事件；按本地/S3 内容寻址键尽力清理部分对象，清理失败也不使分析失败。
- 旧钉住版本若超出新模式限制，记录 `decode_error`，继续分析且不解码；新保存/发布则以问题路径拒绝。
- 两项配置须为正安全整数，格式错误、零、负值回退至默认值。默认值面向 `ops/self-hosted/compose.yaml` 中标准 384 MiB worker 容器；与提高日志包限制需要增加内存相同，提高解码上限前须检查内存与任务租约预算。解析输入与事件对象仍占用内存，并非硬堆内存限制。
- JSONL 逐事件经 `createGzip()` 流式压缩并处理背压，只收集压缩块供对象存储 Buffer 使用。顺序事件数组保留既有抽取器/组完成顺序与游标偏移；文件/行证据索引引用同一批对象，不复制字段或 raw 值。把索引直接展平会在多个抽取器重访同一行时改变查询顺序。
- 协调者可在测试之外运行 `npx tsx scripts/log-decode-memory-probe.ts`。探针构造三个总计 95 MiB 的内核式日志文件，约 20% 行匹配，使用 worker 的解码、压缩与索引函数及显式默认上限，输出耗时毫秒、保留事件数/错误、进程峰值 RSS、最终与采样峰值 heapUsed，以及由 10 ms `setInterval` 漂移测得的最长停顿。耗时/停顿不含输入构造，进程峰值 RSS 包含构造；它只隔离验证解码路径，不代表完整解析/分析流程。本次变更尚无实测结果。

## 源码快照（#1243）

跳过文件单元格显示总数和简短的原因统计；点击「查看」打开可分页的路径与原因表格。明细列表被截断时，原因统计明确只覆盖已列出的路径。目录条目和 macOS 元数据（`._*`、`__MACOSX/`、`.DS_Store`）不会进入文件清单、进度或跳过计数，但仍受压缩包条目数、路径/类型校验和累计解压安全预算限制。

技能管理员在工作区「源码」分区上传单个 `.tar.gz`、`.tgz` 或 `.zip` 压缩包，并填写必填版本标签。同一技能的未归档快照中标签唯一。上传后进入 `queued`，索引器依次置为 `indexing` 和 `ready` 或 `failed`，失败保留原因。`filesProcessed / filesTotal` 显示进度；tar 在索引前先流式校验并计数，确定稳定的总文件数。表格只在存在排队或索引中的快照时轮询，最多显示 200 个跳过路径及原因，同时保留完整跳过总数。`logs:view` 可读元数据；上传、设为默认和归档需要 `logs:admin-domains`，写入带审计。

源码索引器随日志 worker 启动：由独立 `npm run worker:logs` 进程处理时，API 保持 `LOG_WORKER_ENABLED=false`。最后进度更新超过五分钟的索引尝试可被重新领取；尝试令牌阻止旧 worker 覆盖已归档或被重新领取的快照。失败快照保留原因；需要复用标签时先归档，再上传替代快照。

默认限制是压缩上传 100 MiB（`LOG_SOURCE_MAX_COMPRESSED_BYTES=104857600`）、累计解包 1 GiB（`LOG_SOURCE_MAX_UNPACKED_BYTES=1073741824`）、单文件 2 MiB（`LOG_SOURCE_MAX_FILE_BYTES=2097152`）和 20,000 个文件（`LOG_SOURCE_MAX_FILES=20000`）。值必须是正的安全整数。跳过文件仍消耗解包字节和文件数预算；压缩包条目另有文件数上限两倍的限制。上传仅使用 multipart `{ versionLabel, file }`，避免 base64 复制超出标准 API 的 512 MiB 内存预算。路由请求体上限为压缩上限加 64 KiB 表单封装开销，过大的 `Content-Length` 在缓冲前拒绝，实际请求流同样受限；文件字节共享有界请求缓冲。对象存储流式读取、临时压缩文件和逐文件处理避免将整个压缩包或目录树保留在索引器内存；每个活跃尝试需预留一个压缩包的临时磁盘空间。

白名单包括 `.c`、`.h`、`.cc`、`.cpp`、`.cxx`、`.hpp`、`.hh`、`.hxx`、`.S`、`.s`、`.java`、`.kt`、`.kts`、`.py`、`.go`、`.rs`、`.js`、`.jsx`、`.mjs`、`.cjs`、`.ts`、`.tsx`、`.sh`、`.bash`、`.zsh`、`.mk`、`.cmake`、`.dts`、`.dtsi`、`.json`、`.yaml`、`.yml`、`.toml`、`.gradle`、`.xml`、`.properties`、`.cfg`、`.conf`、`.ini`、`.proto`、`.sql`、`.rb`、`.swift`、`.m` 和 `.mm`。构建文件名支持 Makefile、GNUmakefile、CMakeLists.txt、Kconfig 和 Kconfig.*、Dockerfile、meson、meson.build、meson_options.txt、BUILD、BUILD.bazel、WORKSPACE。扩展名和文件名匹配不区分大小写，汇编扩展名在白名单中保留两种拼写。

跳过原因区分不支持类型、超大文件、二进制/非 UTF-8 内容及忽略目录。忽略的目录段为 `third_party`、`third-party`、`thirdparty`、`vendor`、`vendors`、`node_modules`、`external`、`.git`、`.svn`、`.hg`、`__pycache__`、`.venv` 和 `venv`，不区分大小写。拒绝路径穿越、绝对/超长路径、重复路径、链接/设备/特殊文件、损坏压缩包、加密或不支持的 ZIP 条目、ZIP64 和重叠 ZIP 范围。累计限制按实际解压字节计数，包含跳过条目；ZIP 实际大小与 CRC 必须匹配。符合条件的文件保存路径、大小、SHA-256、行数和语言，并生成最多 200 行或 32 KiB 字符的分块，使用 PostgreSQL 全文与 trigram GIN 索引。

「设为默认」更新或创建技能草稿的可选 `defaultSourceSnapshotId`；发布后才影响新运行。已归档快照不能被新选为默认值；已有归档引用可在保存、发布和恢复历史版本时保持不变，保留历史 spec。每次运行解析其固定版本的默认快照，记录观察到的快照 id/状态。排队、索引中、失败或已归档的默认快照不导致分析失败，持久化报告会说明源码不可用，例如「源码快照仍在索引，本次分析未使用源码」。本切片不增加源码工具、公开内容路由，也不将源码文本放入模型提示词。语句索引、检索工具、源码证据及上传 `sourceVersion` 匹配仍由 #1244/#1245 负责。

单独运行 `npx tsx scripts/log-source-memory-probe.ts`，不要加入测试。默认探针流式处理由 512 个达到 2 MiB 上限的文件组成的 1 GiB tar.gz，执行解包与 UTF-8 分块序列化，不保留此前文件；输出峰值 RSS/堆内存，并断言 RSS 低于标准 worker 的 384 MiB 上限。另行运行 `npx tsx scripts/log-source-memory-probe.ts --upload`，通过共享 HTTP 解析器流式上传 100 MiB multipart 请求，断言 RSS 低于标准 API 的 512 MiB 上限。探针不包含 PostgreSQL 持久化或完整生产 API 进程；将实测 RSS 记入本次运行证据。

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
