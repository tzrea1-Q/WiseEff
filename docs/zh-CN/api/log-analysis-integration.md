# 日志分析 API 集成指南

> English: [English](../../api/log-analysis-integration.md)

外部系统如何把日志推入 WiseEff 分析并消费结果——轮询或订阅域级**结果 Webhook**。我们有意用内联示例替代打包 SDK:集成面只有三个 REST 调用加一个签名校验,在真实消费方提出更多诉求之前,本指南就是唯一事实来源。

前置阅读:[认证](authentication.md)(Bearer Token)、[错误](errors.md)(错误信封)。端点契约见 [API Contract](../../design-docs/api-contract.md) 与 [openapi.json](../../generated/openapi.json)。

## 1. 推送日志

`POST /api/v1/log-files`,内容 base64 编码。通过 `logDomainId` 绑定已注册业务域(`GET /api/v1/log-domains` 可列出);不传则回落到内置未分类域——域选择永远不会阻塞上传。

```bash
curl -sS -X POST "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg content "$(base64 < charging-foldback.log)" \
    --arg domain "$LOG_DOMAIN_ID" \
    '{fileName: "charging-foldback.log", contentType: "text/plain",
      contentBase64: $content, logDomainId: $domain,
      analysisQuestion: "Why did fast charging fold back?"}')"
```

`201` 响应带回 `log.id`(记录)与 `job.id`(分析任务)。

支持格式:UTF-8 文本日志,扩展名 `.log`、`.txt`、`.csv`、`.json`;压缩上传支持单文件 `.gz` 与单条目 `.zip`(内含一个上述文本日志)。解压后大小上限 100MB,且不超过压缩体积的 200 倍(下限 1MB);二进制内容、多条目或加密压缩包会以可读的 `failureReason` 失败。

## 2. 轮询任务

`GET /api/v1/jobs/{jobId}` 直到 `status` 为 `complete` 或 `failed`。建议节奏:前 ~30 秒每 1s,之后退避到 2–5s;分析目标 p95 ≤ 3 分钟(≤ 10MB 日志)。`GET /api/v1/jobs/{jobId}/events` 以 Server-Sent Events 提供相同快照。

## 3. 获取结果

`GET /api/v1/logs/{logId}` 返回结论、影响、严重级别、置信度、证据(含行号锚点)、建议动作,以及溯源字段 `analysisSource` / `degradedReason`——`rules-fallback` 是降级分析,绝不冒充完整 Agent 分析。

记录另有当前运行的可选 `signalSummary: { signals, templates, truncatedSignals, truncatedTemplates }`。不选择技能也生成通用信号，钉住的技能另提供自身信号命中。信号带种类、严重度、来源、出现次数和有界的 `file:line` 锚点及摘录；模板带归一化文本、次数和首末锚点。判断摘要是否完整前，先检查截断标记；旧记录可以没有该字段。规则回退同时使用通用和所钉技能的信号，保留降级标记与置信度上限。字段和内部 Agent 工具见 [API 合同](../design-docs/api-contract.md)；这些工具不新增 REST 端点。

可选的 `signalSummary.truncated` 与 `reason` 说明提取不完整：`time_cap` 保留已完成结果，`line_cap` 仅按行首内容匹配，`extraction_error` 返回空摘要并继续分析。判断空摘要是否意味着没有异常前，还须同时检查这些字段和数量截断标记。

## 4. 或消费结果 Webhook

Admin 在 `/log-admin`(业务域治理 → 结果回调)按域配置:HTTPS URL、签名密钥、启用开关。该域的分析到达终态(完成——含降级——或失败)后,WiseEff 会 POST 一份精简 JSON 摘要。**绝不外发**原始日志内容或证据全文;需要细节时用 `recordId` 走 API 获取。

```json
{
  "event": "log-analysis.completed",
  "eventId": "log-result:run-...",
  "recordId": "log-...",
  "runId": "run-...",
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

### 投递语义

- 有界重试下的至少一次投递：终态事务在确认完成前持久化 outbox 事件。worker 通过租约和 `FOR UPDATE SKIP LOCKED` 领取到期事件；发送或退避期间崩溃后，可在租约过期后恢复。失败按指数退避重试（默认 3 次），耗尽后保留失败状态；已记录的每次尝试都在 `/log-admin` → 最近投递中可见，REST API 仍是事实来源。
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
- `401 / 403`:令牌或权限问题(`logs:upload`);见[认证](authentication.md)。
- 上传遇 `5xx`:可带退避重试;每次成功上传都会新建记录(服务端不去重),激进重试请自备幂等保护。
- `failed` 记录带可读 `failureReason`(格式不支持、压缩包超限、重试耗尽);修正输入后可用 `POST /api/v1/logs/{logId}/rerun` 重新分析。
