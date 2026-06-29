# 小泽 LLM 运行手册

> English: [English](../../runbooks/agent-provider.md)

在 staging 或试点环境验证 live 小泽 LLM 配置时使用本运行手册。小泽是 WiseEff 唯一 Agent 表面；API mode 始终通过 CopilotKit 对接 `POST /api/v1/agent/xiaoze`；mock mode 无 Agent UI。

## 必需配置

- `AGENT_API_BASE_URL`
- `AGENT_MODEL`
- `AGENT_API_KEY`
- `AGENT_API_TIMEOUT_MS`
- 可选：`XIAOZE_MODEL` 覆盖默认模型选择

验收或离线演练可设 `XIAOZE_DETERMINISTIC=true`，无需填写 `AGENT_API_*`。

生产与自托管部署须设 `XIAOZE_CHECKPOINTER=postgres`（除非 `XIAOZE_DETERMINISTIC=true`）。部署或配置变更后运行 `npm run db:migrate`，确保 LangGraph checkpoint 表已创建再对外服务。

## 就绪检查

1. 当 `XIAOZE_CHECKPOINTER=postgres` 时运行 `npm run db:migrate`，确认 checkpoint 表存在（`checkpoints`、`checkpoint_blobs`、`checkpoint_writes`、`checkpoint_migrations`）。
2. 使用 live 小泽 LLM 配置（或 `XIAOZE_DETERMINISTIC=true` 做离线验收）启动 API。
3. 检查 `/health/ready`。
4. 确认 `dependencies.xiaozeLlm.details` 包含安全证据（如 `baseUrlConfigured`，以及可用的 `model`）。
5. 使用 admin smoke token 检查 `/api/v1/operations/pilot-readiness`，确认 `xiaozeLlm` gate 为 ready。
6. 从私有运维网络检查 `/metrics`，确认就绪指标反映小泽 LLM 依赖且标签不暴露 secret。
7. 运行最小小泽 acceptance spec，或在 API mode 打开 CopilotKit 弹窗发送只读 prompt。
8. 确认 mutating tool 提案创建 approval，且仅通过 orchestrator approval 链恢复，审计 `actorType=agent`。

## 安全预期

- 未知 tool 名称必须被拒绝。
- Mutating tool 请求必须创建 approval，不得直接执行。
- LLM 故障可产生降级回答，但必须跳过 tool execution。
- 不安全或未 ground 的 mutating 输出不得绕过 tool registry。

## 证据

记录：model 名称、request id、适用的 thread id、trace id、latency 与 token/cost metadata（如有）、fallback 或 safety status、mutating tool 请求的 approval id。

不要把 API key、原始敏感 prompt、原始 provider payload、Authorization header 或客户数据提交到仓库文档。

## Smoke 命令

```bash
npm run smoke:m5
npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

小泽 mutating 行动走 orchestrator approval 链；见 `docs/SECURITY.md` 与 `e2e/acceptance/xiaoze-action.acceptance.spec.ts`。
