# Agent Provider

> English: [English](../../runbooks/agent-provider.md)

在 staging 或试点环境验证 live Agent provider 时使用本运行手册。

## 必需配置

- `AGENT_PROVIDER=live`
- `AGENT_API_FORMAT=wiseeff` 或 `openai`
- `AGENT_API_BASE_URL`
- `AGENT_MODEL`
- `AGENT_API_KEY`
- `AGENT_API_TIMEOUT_MS`
- `AGENT_PROMPT_VERSION=m5-agent-v1`

P1（TD-027）已移除 `AGENT_API_FORMAT=pi` 与 `@earendil-works/pi-ai`。遗留 `.env` 中若仍为 `pi`，服务端启动时会迁移为 `wiseeff`。

## 就绪检查

1. 使用 live provider 配置启动 API。
2. 检查 `/health/ready`。
3. 确认 `dependencies.agentProvider.details` 包含安全的 provider 证据（`provider`、`format`、`model`、`promptVersion` 等）。
4. 使用 admin smoke token 检查 `/api/v1/operations/pilot-readiness`，确认 Agent provider gate 包含相同安全细节。
5. 从私有运维网络检查 `/metrics`，确认存在 `wiseeff_agent_provider_ready`，且低基数标签为 `provider="live"`、`format="wiseeff"` 或 `format="openai"`。模型与 prompt 版本不得进入 metric 标签。
6. 通过 API 发送最小 Agent 请求。
7. 确认 trace metadata 包含 provider、model、prompt version、request/trace id、latency、token 用量、估算成本、safety status，以及适用的 fallback reason。

## 安全预期

- 未知 tool 名称必须被拒绝。
- Mutating tool 请求必须创建 approval，不得直接执行。
- Provider 故障可产生降级回答，但必须跳过 tool execution。
- 不安全或未 ground 的 mutating 输出不得绕过 tool registry。

## 证据

记录：provider 与 model 名称、format（`wiseeff` 或 `openai`）、prompt version、request id、session id、trace id、latency 与 token/cost metadata、fallback 或 safety status、mutating tool 请求的 approval id。

不要把 API key、原始敏感 prompt、原始 provider payload、Authorization header 或客户数据提交到仓库文档。

## Smoke 命令

```bash
npm run smoke:m5
npm run test:server -- providerRegistry
```

`providerRegistry.test.ts` 会拒绝 `AGENT_API_FORMAT=pi`。小泽 mutating 行动走 orchestrator approval 链；见 `docs/SECURITY.md` 与 `e2e/acceptance/xiaoze-action.acceptance.spec.ts`。
