# 日志分析 API 集成指南

> English: [English](../../api/log-analysis-integration.md)

外部系统如何把日志推入 WiseEff 分析并通过轮询或技能的**结果 Webhook** 消费结果。本指南通过内联示例说明上传、任务、报告、文件行窗口和 Webhook 签名校验，不提供打包 SDK。

前置条件：管理员签发的集成凭据。前置阅读：[认证](authentication.md)、[错误](errors.md)（错误信封）。端点契约见 [API Contract](../../design-docs/api-contract.md) 与 [openapi.json](../../generated/openapi.json)。

## 1. 推送日志

### 集成凭据

有 `logs:admin-domains` 的管理员在技能工作区「集成 → 集成凭据」签发凭据。签发和轮换时密钥仅显示一次；复制到安全的密钥管理工具，勾选已保存后才能关闭。通过 TLS 发送 `Authorization: Bearer <集成凭据>`。下文的 `$WISEEFF_INTEGRATION_CREDENTIAL` 从密钥管理工具提供，绝不把值写入代码或日志。

凭据是本组织内独立的机器身份，没有用户账号、角色或权限。固定范围仅为 `POST /api/v1/log-files`、`POST /api/v1/logs` 上传，以及读取它自己创建的记录、报告和文件。不能列出记录或技能，不能读取其他凭据或用户的记录，也不能访问 jobs/SSE、运行历史、轨迹、源码管理、`/me` 或凭据管理。技能选择字段由用户在工作区复制。绑定凭据不传选择字段时，显式使用其绑定技能；指定其他技能返回 `403`。未绑定凭据不传选择字段时，对本组织已发布技能进行自动推荐。仅未绑定凭据可发送 `skillSelection: "generic"`，要求通用分析。绑定凭据发送此请求返回 `403`，即使同时传入匹配绑定技能的选择字段。大小、速率、分析限制与用户上传一致。

轮换后旧密钥立即失效；撤销在下一请求生效。归档技能会撤销其绑定凭据。服务器只存哈希，列表不返回密钥。记录携带 `createdByCredentialId` / `createdByCredentialName`，上传用户为空；有 `logs:view` 的组织用户照常可见。上传审计标识集成凭据，最近使用时间至多每分钟更新一次。

### 通过 skillKey 选择分析技能

在分析技能工作区的「集成」分区复制 `skillKey`、上传地址及 JSON/base64 或 multipart 示例。执行前替换集成凭据占位符；示例不会包含真实凭据。`skillKey` 在组织内唯一，满足 `^[a-z0-9][a-z0-9-]{1,62}$`，重命名和发布不会改变它。管理员可在此编辑 key，修改会审计；集成方之后需使用新 key。创建时从名称生成 slug，非 ASCII 名称或碰撞时补充短 id 后缀；迁移 0202 为已有身份回填。

`POST /api/v1/log-files`（JSON 或 multipart）和 `POST /api/v1/logs`（已有文件）均接受 `skillKey`，继续支持 `skillId` 及兼容别名 `logDomainId`。同时提供多个选择字段时必须指向同一技能；冲突返回 `400 VALIDATION_FAILED`。key 只在调用方组织内解析，未知或跨组织 key 会被拒绝。上传成功后钉住技能当前已发布版本，包含模型和预算；后续修改、发布不影响该运行。

```bash
curl --fail-with-body -X POST "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $WISEEFF_INTEGRATION_CREDENTIAL" \
  -H 'Content-Type: application/json' \
  --data '{"skillKey":"charging","fileName":"example.log","contentType":"text/plain","contentBase64":"SU5GTyBib290Cg=="}'

curl --fail-with-body -X POST "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $WISEEFF_INTEGRATION_CREDENTIAL" \
  --form-string 'skillKey=charging' \
  -F 'file=@device.log;type=text/plain' -F 'file=@kernel.log;type=text/plain'
```

将 `charging` 替换为复制的 key；multipart 示例要求对应本地文件已存在。模型覆盖及可选步数/token 预算保存在草稿，发布后影响新运行；省略预算使用平台默认值。超过 `LOG_ANALYSIS_MAX_STEPS` / `LOG_ANALYSIS_TOKEN_BUDGET` 的值以字段错误拒绝。Webhook 配置和 key 仍为即时生效的身份设置，不依赖发布。

步骤预算须为至少 1 的整数；版本 token 预算须为至少 `min(4096, LOG_ANALYSIS_TOKEN_BUDGET)` 的整数。保存和发布均校验上下限，并返回对应字段错误。显式版本 token 预算约束模型服务报告的累计用量，每次模型调用前检查，包含提前收敛调用；不做 token 估算，也不承诺单次调用的严格限额。单次完成可能使累计用量超过预算，但耗尽后不再发起调用。没有得到已接地最终报告时，耗尽运行沿用 `rules-fallback` 结果及 `degradedReason: "token-budget-exhausted"`。省略 `tokenBudget` 时，保留既有平台全局预算计量及提前收敛行为。

`POST /api/v1/log-files`，内容 base64 编码。JSON 上传的解码文件最多 32 MiB；更大的日志包使用 multipart，遵循配置的上传限制（默认 100 MiB）。传输请求体过大时在解析前返回 `413`。用 `skillKey`、`skillId` 或兼容别名 `logDomainId` 指定已发布技能（用户可通过 `GET /api/v1/log-skills` 列举）。任何显式选择字段及凭据绑定技能都优先于推荐。不传技能选择字段且凭据未绑定技能时，服务端根据已存储日志包，仅对本组织有效、已发布的技能评分。最高分唯一且至少为 8 时使用该技能；并列、低分或推荐预算耗尽时走通用分析。要固定使用通用分析，请使用用户会话或未绑定凭据，不传技能选择字段，并发送 `skillSelection: "generic"`。绑定凭据不能请求通用分析：发送 `skillSelection: "generic"` 返回 `403`，即使同时传入匹配的技能选择字段；与凭据绑定技能冲突的选择也返回 `403`。multipart 上传和从已有文件创建记录的 `POST /api/v1/logs` 遵循相同规则。

### 预览技能推荐

`POST /api/v1/log-skills/recommend` 要求用户账号有效且具备 `logs:upload`，集成凭据不能访问。请求示例为 `{ "files": [{ "path": "kernel.log", "head": ["charging current reduced"] }] }`。返回 `{ "recommendations": [{ "skillId": "...", "score": 8, "reasons": [{ "kind": "pattern", "file": "kernel.log", "detail": "..." }] }], "recommendedSkillId": "..." }`。没有达到阈值的唯一候选时省略 `recommendedSkillId`。排名最多包含 100 个技能，每技能最多 24 条理由。`kind` 为 `file` 或 `pattern`；分数用于排序，不是分析正确的概率。此端点只预览选择；上传时省略技能选择字段且没有凭据绑定技能时，服务端才会根据已存储内容独立评分。权重和限制见[推荐契约](../design-docs/api-contract.md#技能推荐与上传路由-1247)。

可选字段 `sourceVersion` 为源码快照版本标签（去除首尾空白后 1–200 字符），用于选择钉住技能所属的匹配快照。匹配快照即使仍在排队、索引中或索引失败，也会被选中；只有快照就绪时才向 Agent 提供源码工具。没有匹配标签或未传标签时，使用钉住版本的默认快照。未知标签会记录在报告来源中，并在该处附上简短回退说明。JSON 上传、multipart 上传以及从已有文件创建记录的 `POST /api/v1/logs` 均接受此字段。`GET /api/v1/log-skills` 返回 `hasSourceSnapshots` 和 `readySourceVersions`；后者是就绪快照版本标签数组，不含快照元数据。上传对话框提供这些标签及默认快照选项；集成 API 仍接受自由填写的版本标签。

`GET /api/v1/log-skills/{skillId}/source-versions` 仅返回技能所属组织内就绪快照的标签，如 `{ "items": ["v2.4.0"] }`。持有 `logs:view`，或账号有效且持有 `logs:upload` 的用户均可访问，包含仅有上传权限的客户端；其他组织的技能返回 `404`。此接口不暴露快照 id、状态、文件清单或源码内容。

```bash
curl -sS -X POST "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $WISEEFF_INTEGRATION_CREDENTIAL" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg content "$(base64 < charging-foldback.log)" \
    --arg domain "$LOG_DOMAIN_ID" \
    '{fileName: "charging-foldback.log", contentType: "text/plain",
      contentBase64: $content, logDomainId: $domain, sourceVersion: "firmware-v7",
      analysisQuestion: "Why did fast charging fold back?"}')"
```

`201` 响应带回 `log.id`(记录)与 `job.id`(分析任务)。

支持的文本扩展名为 `.log`、`.txt`、`.csv` 和 `.json`；日志包接收支持 UTF-8 及带 BOM 的 UTF-16 文本。压缩包可包含多份文件，支持 `.gz`、`.zip`、`.tar`、`.tar.gz` 和 `.tgz`。若要将多份独立文本文件合并为一条记录，使用 `multipart/form-data` 并重复传入 `file` 字段。记录的 `files` 清单列出已分析和已跳过的条目。上传受压缩体积、解包体积、文件数和单文件大小的配置限制，参见[环境变量](../developer/environment-variables.md)。解包另有 200 倍压缩比上限，最低预算为 1 MiB。被拒绝的输入保留可读的失败原因。

## 2. 轮询记录

使用上传该记录的凭据轮询 `GET /api/v1/logs/{logId}`，直到 `status` 为 `complete` 或 `failed`。建议节奏：前约 30 秒每秒一次，之后退避到 2–5 秒；分析目标 p95 ≤ 3 分钟（≤ 10MB 日志）。任务轮询 `GET /api/v1/jobs/{jobId}` 与任务 SSE `GET /api/v1/jobs/{jobId}/events` 仅供用户会话使用，不在集成凭据范围内。

## 3. 获取结果

`GET /api/v1/logs/{logId}` 返回结论、影响、严重级别、置信度、证据(含行号锚点)、建议动作,以及溯源字段 `analysisSource` / `degradedReason`——`rules-fallback` 是降级分析,绝不冒充完整 Agent 分析。

新记录的报告元数据还包含 `skillSelection: { mode: "recommended" | "explicit" | "generic", reasons: [{ kind, file, detail }] }`。推荐选择保存获胜技能的评分理由；手动指定与通用选择没有匹配理由。旧记录可能省略该字段。所选发布版本另由 `skillRevision` 记录。

记录及运行列表（`GET /api/v1/logs/{logId}/runs`）显示源码溯源：`sourceSnapshot: { id, versionLabel, status }` 标识所用快照，`sourceSnapshotSelection` 为 `matched_version`（版本匹配）、`default`（默认快照）或 `none`（无快照），`requestedSourceVersion` 保留传入的标签。传入标签但结果为 `default` 或 `none` 表示未找到该标签。选择说明仅出现在来源区域，不写入报告结论。源码证据位置必须出现于工具结果；`search_source` 返回有界的排序摘录，`read_source_range` 返回所选快照中最多 80 行带行号的源码。

记录另有当前运行的可选 `signalSummary: { signals, templates, truncatedSignals, truncatedTemplates }`。不选择技能也生成通用信号，钉住的技能另提供自身信号命中。信号带种类、严重度、来源、出现次数和有界的 `file:line` 锚点及摘录；模板带归一化文本、次数和首末锚点。判断摘要是否完整前，先检查截断标记；旧记录可以没有该字段。规则回退同时使用通用和所钉技能的信号，保留降级标记与置信度上限。字段和内部 Agent 工具见 [API 合同](../design-docs/api-contract.md)；这些工具不新增 REST 端点。

可选的 `signalSummary.truncated` 与 `reason` 说明提取不完整：`time_cap` 保留已完成结果，`line_cap` 仅按行首内容匹配，`extraction_error` 返回空摘要并继续分析。判断空摘要是否意味着没有异常前，还须同时检查这些字段和数量截断标记。

### 管理员轨迹与草稿试运行

`GET /api/v1/logs/{logId}/trace` 返回记录当前运行按序排列的 `{ steps }`。需要 `logs:admin-domains`，只有 `logs:view` 时返回 `403`，不可访问的记录返回 `404`。步骤包含有界工具参数摘要、结果字节数、返回行引用、结果状态及可用 token 数，绝不包含原始提示词或模型服务载荷。存储上限与仅管理员可用的草稿试运行端点见[轨迹与试运行契约](../design-docs/api-contract.md#分析轨迹与草稿试运行1230)。试运行使用已保存草稿与已存样例，不创建 `/logs` 记录或结果 Webhook。

### 技能分析用例

所有分析用例接口需要 `logs:admin-domains` 及组织内访问权限。用例归属技能身份，跨版本保留。CRUD、运行、轨迹、报告预填及 ZIP 接口见[分析用例 API 契约](../design-docs/api-contract.md#技能分析用例1246)。新上传在规范化分析文件之外单独保留原始输入字节，因此报告另存用例可携带原日志包。未保留原始上传的历史报告无法还原这些字节，另存时会明确报错。

用例运行使用已配置分析器，比较已保存草稿与上一已发布版本，并独立保存测试结果。它与草稿试运行共享准入，不产生用户可见日志记录或结果 Webhook，始终不阻止发布。导入、导出使用 [`eval-cases/logs` 布局](../../../eval-cases/logs/README.zh-CN.md)，保留日志文件原字节，并提供精确到路径的校验错误。

### 获取单文件的行窗口

`GET /api/v1/logs/{logId}/lines?file=...&startLine=...&endLine=...` 返回一份已分析文件的指定行窗口。接受创建记录的集成凭据，或同组织有 `logs:view` 的用户。`file` 使用记录 `files` 清单中的准确 `path`；这是日志包内路径，不是对象存储键。

两个行号参数均必填，必须为正整数，从 1 开始计数，且包含首尾行。一次最多请求 400 行。`endLine` 超过文件末尾时，服务端会裁剪到末行；`startLine` 越界、首尾颠倒或请求超过 400 行时，返回 `400 VALIDATION_FAILED`。末尾换行符不会额外增加一行，实际空行仍可读取。空文件返回 `startLine: 1`、`endLine: 0`、`totalLines: 0` 和 `lines: []`。旧索引会在访问时延迟重建。文件不存在或已跳过时，返回 `404 NOT_FOUND`。

```bash
curl -sS --get "$WISEEFF_API/api/v1/logs/$LOG_ID/lines" \
  -H "Authorization: Bearer $WISEEFF_INTEGRATION_CREDENTIAL" \
  --data-urlencode "file=device/kernel.log" \
  --data-urlencode "startLine=40" \
  --data-urlencode "endLine=42"
```

```json
{
  "item": {
    "file": "device/kernel.log",
    "startLine": 40,
    "endLine": 42,
    "totalLines": 850,
    "lines": [
      { "lineNumber": 40, "content": "Starting diagnostic task" },
      { "lineNumber": 41, "content": "ERROR device unavailable" },
      { "lineNumber": 42, "content": "Retry scheduled" }
    ]
  }
}
```

读取器使用每文件的 UTF-8 文本对象和行偏移索引；UTF-16 上传也会在接收时转换后按此方式读取。CRLF 计为一个换行，末行没有换行符时也可定位。每行最多返回 64 KiB 行首内容；更长的行以 `… [line truncated at 64 KiB]` 结尾。展示或复制截断行时，应保留此标记。

记录原有的原始日志面板继续作为预览：每文件最多保留前 400 行，整次运行共用 128 KiB 文本预算。在 `/logs` 点击证据的 `file:line` 标签或信号、模板锚点，会打开共用的文件抽屉，滚动到引用行并高亮，提供加载上方、下方上下文和逐行复制操作。超出预览的位置应通过行窗口端点读取，不能将 `rawLines` 当作完整文件。

## 4. 或消费结果 Webhook

管理员在技能工作区的「集成」分区配置 HTTPS URL、只写签名密钥（设置或轮换）及启用开关，也可发送测试投递、查看近期投递尝试。旧管理页链接到此工作区。技能分析到达终态（完成，含降级，或失败）后，WiseEff 会 POST 精简 JSON 摘要。**绝不外发**原始日志内容或证据全文；需要细节时用 `recordId` 走 API 获取。

```json
{
  "event": "log-analysis.completed",
  "eventId": "log-result:run-...",
  "recordId": "log-...",
  "runId": "run-...",
  "skillRevisionId": "revision-...",
  "skillRevisionNumber": 2,
  "skill": { "id": "domain-...", "key": "charging", "revisionId": "revision-...", "revisionNumber": 2 },
  "degraded": false,
  "fileName": "charging-foldback.log",
  "logDomainId": "domain-...",
  "status": "complete",
  "analysisSource": "agent",
  "degradedReason": null,
  "severity": "Warning",
  "confidence": 0.82,
  "conclusionSummary": "Charging behavior is consistent with thermal foldback protection…",
  "occurredAt": "2026-08-13T02:00:00.000Z",
  "productPath": "/logs?id=report-run-..."
}
```

`event` 取值:`log-analysis.completed`、`log-analysis.failed`、`log-analysis.test`(管理员测试按钮)。

结果事件在保留旧字段的基础上增加 `skill: { id, key, revisionId, revisionNumber }` 和 `degraded: boolean`。旧未钉住运行的版本字段可为 null。规则回退或存在降级原因时 `degraded` 为 true；有原因时保留 `degradedReason`。key 在终态事件入队时快照保存，重试保持相同载荷。同步测试事件维持原格式。

### 投递语义

- 有界重试下的至少一次投递：终态事务在确认完成前持久化 outbox 事件。worker 通过租约和 `FOR UPDATE SKIP LOCKED` 领取到期事件；发送或退避期间崩溃后，可在租约过期后恢复。失败按指数退避重试（默认 3 次），耗尽后保留失败状态；已记录的每次尝试都在技能工作区的「集成」分区可见，REST API 仍是事实来源。
- 投递尝试历史按日志业务域分别设上界。worker 默认按 `created_at DESC, id DESC` 保留最近 10,000 行；清理失败只记录脱敏 warning，并在下一个 60 秒周期重试，不会中断投递。运维方可通过 `LOG_WEBHOOK_DELIVERY_RETENTION_*` 调整上界或停止未来裁剪，但已删除记录只能从数据库备份恢复。 投递尝试历史与终态 outbox（`delivered` / `failed`）分别按同一设置、同一排序独立保留最近 N 行；每张表每周期最多清理十批、每批 1,000 行。`pending`、`processing`、`retry` 事件不参与裁剪。
- 尽快返回 `2xx`(耗时处理请异步化)。发送端不跟随重定向、丢弃响应体。
- 接收方可能已接受请求，而发送方在记录成功前崩溃。结果事件请按稳定的 `eventId`（或现有 `runId`）去重；重试保留原 payload 与事件 ID。管理员测试端点仍同步发送一次。

### 校验签名

每个请求携带:

| Header | 内容 |
| --- | --- |
| `X-WiseEff-Timestamp` | 签名时的 Unix 秒 |
| `X-WiseEff-Signature` | `sha256=<hex>` —— 用该域签名密钥对 `` `${timestamp}.${rawBody}` `` 计算的 HMAC-SHA256 |

时间戳参与签名输入,这正是防重放成立的前提。请用常量时间比较校验,并拒绝时间戳超出重放窗口的投递(建议 300 秒)。

Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWiseEffWebhook({ secret, rawBody, headers, toleranceSeconds = 300 }) {
  const timestamp = Number(headers["x-wiseeff-timestamp"]);
  const signature = headers["x-wiseeff-signature"] ?? "";
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false; // 时间戳缺失或过期——可能是重放
  }
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

curl / openssl(对抓包请求重算签名):

```bash
TIMESTAMP=1755050000            # X-WiseEff-Timestamp 头
SECRET=your-domain-signing-secret
BODY_FILE=payload.json          # 原始请求体,逐字节一致

printf '%s.' "$TIMESTAMP" | cat - "$BODY_FILE" \
  | openssl dgst -sha256 -hmac "$SECRET" -hex \
  | sed 's/^.*= /sha256=/'
# 与 X-WiseEff-Signature 比较(真实代码中用常量时间比较)
```

### 接收端检查清单

- 先校验签名与重放窗口,再解析请求体。
- 快速返回 `2xx`;`5xx` 与超时会消耗发送端有限的重试次数。
- 需要时在 `/log-admin` 轮换密钥;API 绝不回显密钥(只显示已配置状态与末四位)。
- 本地联调:发送端默认拒绝明文 HTTP 与私网/环回地址;只有服务端以 `LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true` 运行时,`http://127.0.0.1:9999` 这类本地接收端才可用(生产环境禁止)。

## 推送侧错误处理与重试

- `400 VALIDATION_FAILED`:base64 或字段错误——修正请求,不要原样重试。
- `401 / 403`：无效或已撤销的凭据、不在白名单的路由或技能绑定问题；用户上传仍需 `logs:upload`。见[认证](authentication.md)。
- 上传遇 `5xx`:可带退避重试;每次成功上传都会新建记录(服务端不去重),激进重试请自备幂等保护。
- `failed` 记录带可读 `failureReason`（格式不支持、压缩包超限、重试耗尽）。有权限的用户可用 `POST /api/v1/logs/{logId}/rerun` 重跑；集成凭据需修正输入后重新上传。
