# 后端与运行环境

WiseEff 后端是 TypeScript 模块化单体。M0-M5 已包括 auth、audit、parameters、logs、jobs、debugging、agent、contracts、operations 等模块，并通过 PostgreSQL、对象存储、worker、设备网关和 Agent provider 形成产品化 runtime seam。

## 本地启动

常用命令：

```bash
npm ci
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
npm run dev:api
```

API 默认监听：

```text
http://127.0.0.1:8787
```

前端 API mode：

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

## 环境变量

本地开发推荐从 `.env.example` 复制为 `.env`，默认使用 Pi-backed live Agent provider。测试默认 Pi 路径时只需要填写模型和 key；只有测试 URL-backed `openai` 或 `wiseeff` provider 时才需要填写 `AGENT_API_BASE_URL`。

关键变量：

- `DATABASE_URL`：PostgreSQL 连接。
- `AUTH_MODE`：`development` 或 `production`。
- `AUTH_PROVIDER`：本地 smoke 使用 `hmac`，目标自托管环境使用 `oidc`。
- `AUTH_TOKEN_ISSUER` / `AUTH_TOKEN_HMAC_SECRET`：仅用于本地 HMAC smoke/test。
- `AUTH_OIDC_ISSUER` / `AUTH_OIDC_AUDIENCE` / `AUTH_OIDC_JWKS_URI`：M6.2 OIDC issuer、audience 和可选 JWKS 覆盖。
- `OBJECT_STORE_MODE`：`local` 或 `s3`。
- `OBJECT_STORE_ROOT`：local object store 目录。
- `DEBUG_DEVICE_GATEWAY_MODE`：`simulator` 或 `hdc`。
- `AGENT_PROVIDER`：`deterministic` 或 `live`。
- `AGENT_API_FORMAT`：`pi`、`wiseeff` 或 `openai`。
- `AGENT_PI_PROVIDER`：`AGENT_API_FORMAT=pi` 时的 Pi provider id，例如 `minimax`。
- `WISEEFF_API_BASE_URL` / `VITE_WISEEFF_API_BASE_URL`：smoke 和前端 API base URL。
- `LOG_ANALYSIS_QUEUE_MODE`：`polling` 或 `durable`。
- `REDIS_URL`：durable queue 模式下的 Redis 连接。
- `LOG_ANALYSIS_QUEUE_PREFIX` / `LOG_ANALYSIS_QUEUE_ATTEMPTS` / `LOG_ANALYSIS_QUEUE_BACKOFF_MS` / `LOG_ANALYSIS_QUEUE_CONCURRENCY`：BullMQ 命名空间、重试和并发配置。

## 数据库

迁移在 `server/migrations/`，执行入口是：

```bash
npm run db:migrate
```

seed 命令按阶段组织：

- `db:seed:m0`：基础组织、用户、项目。
- `db:seed:m1`：参数管理样例数据。
- `db:seed:m2`：日志分析样例数据。
- `db:seed:m3`：调试设备和参数 catalog。

生成的 schema 摘要在 [docs/generated/db-schema.md](../generated/db-schema.md)。

## 日志 worker 和对象存储

日志上传会写入对象存储 seam，并创建 analysis job。worker runner：

```bash
npm run worker:logs
```

M6.4 增加 Redis/BullMQ durable queue 模式。PostgreSQL 仍然是 job state、retry、dead-letter、audit 和 evidence 的 source of truth；Redis/BullMQ 只负责投递和重试触发。API 会在 PostgreSQL job 创建成功后 enqueue `jobId`，worker 消费后必须先 claim PostgreSQL job，再写入进度或终态。

本地默认仍使用 polling：

```text
LOG_ANALYSIS_QUEUE_MODE=polling
```

自托管 durable queue：

```text
LOG_ANALYSIS_QUEUE_MODE=durable
REDIS_URL=redis://redis:6379
```

验收命令：

```bash
npm run queue:check -- --base-url https://<host>
```

本地对象存储：

```text
OBJECT_STORE_MODE=local
OBJECT_STORE_ROOT=.wiseeff-object-store
```

S3/OSS-compatible 对象存储：

```text
OBJECT_STORE_MODE=s3
OBJECT_STORAGE_ENDPOINT=...
OBJECT_STORAGE_BUCKET=...
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_REGION=...
```

当前 S3/OSS adapter 是 WiseEff seam，不是完整云厂商 SDK/IaC。生产环境仍需要供应商级 bucket、KMS、生命周期、复制和凭据轮换策略。

## 设备网关

本地和非客户 staging 可使用 simulator：

```text
DEBUG_DEVICE_GATEWAY_MODE=simulator
DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true
```

客户 pilot 或生产 signoff 需要 HDC：

```text
DEBUG_DEVICE_GATEWAY_MODE=hdc
HDC_DEVICE_LAB_AVAILABLE=true
HDC_SMOKE_PROJECT_ID=...
HDC_SMOKE_DEVICE_ID=...
HDC_SMOKE_TARGET_REF=...
HDC_SMOKE_PARAMETER_ID=...
HDC_SMOKE_NODE_PATH=...
HDC_SMOKE_WRITE_VALUE=...
```

没有 HDC evidence 时，`pilot-readiness` 必须保持 blocked。

## Agent provider

本地 deterministic provider 用于稳定测试。live provider 用于目标环境和真实 provider 证据。

Pi-backed live provider：

```text
AGENT_PROVIDER=live
AGENT_API_FORMAT=pi
AGENT_PI_PROVIDER=minimax
AGENT_MODEL=...
AGENT_API_KEY=...
AGENT_API_TIMEOUT_MS=30000
AGENT_PROMPT_VERSION=m7-pi-agent-v1
```

OpenAI-compatible live provider 仍保留为 URL-backed legacy path：

```text
AGENT_PROVIDER=live
AGENT_API_FORMAT=openai
AGENT_API_BASE_URL=...
AGENT_MODEL=...
AGENT_API_KEY=...
AGENT_API_TIMEOUT_MS=30000
```

Pi 路径只使用后端 `@earendil-works/pi-ai` adapter；不加载 Pi Coding Agent CLI、filesystem tools、shell tools 或 `.pi` runtime extensions。工具执行仍由 WiseEff registry、approval、authz 和 audit 控制。

`/health/ready` 会检查 provider health。真实 chat completion 还需要通过 Agent API 请求验证，并检查 trace 中的 provider、model、usage、safety 和 fallback 信息。

Pi provider evidence commands：

```bash
npm run agent:pi-eval
npm test -- scripts/run-pi-agent-smoke.test.ts
npm run agent:pi-smoke
```

`agent:pi-eval` 是离线 adapter gate，不需要真实 key。`agent:pi-smoke` 只在已配置 live Pi key 时运行，使用 synthetic no-tool prompt，并要求 `toolRequests: 0`。`/health/ready` 和 `pilot-readiness` 的 Agent provider details 可以记录 provider format、Pi provider id、model 和 prompt version；`/metrics` 只使用低基数 label，例如 provider、format 和 Pi provider id。

## Self-hosted runtime / 自托管运行

M6.1 在 `ops/self-hosted/` 下新增 Linux 自托管基线。它把 PostgreSQL、API、web、worker 和 Caddy proxy 拆成独立服务。

关键命令：

```bash
npm run selfhost:check
npm run selfhost:smoke -- --base-url https://<host>
```

本地开发继续使用 `HOST=127.0.0.1`。自托管 API 容器使用 `HOST=0.0.0.0`，这样 Caddy 才能通过 compose 网络访问 API；API 容器设置 `LOG_WORKER_ENABLED=false`，由独立 worker 容器运行 `npm run worker:logs`。

M6.2 增加 OIDC 身份边界和后端用户治理 API。目标自托管环境应使用 `AUTH_PROVIDER=oidc`、`AUTH_OIDC_ISSUER` 和 `AUTH_OIDC_AUDIENCE`，并使用 OIDC access token 运行 smoke。HMAC token 只保留给本地 smoke/test；目标环境证据必须来自真实 OIDC/JWKS。M6.3 增加自托管 S3-compatible 对象存储和备份/恢复证据。M6.4 已经补入 Redis/BullMQ durable queue wiring；真实自托管目标仍需要 `queue:check` 和 `selfhost:smoke` 证据。M6.5 增加自托管观测性基线。rollback 和 capacity gates 属于后续 M6 阶段或目标环境验收。

## Observability / 观测性

M6.5 新增自托管观测性基线：

```text
GET /metrics
```

`/metrics` 返回 Prometheus text，并在返回前刷新 readiness、database、object store、Agent provider 和 worker queue 指标。Prometheus/Grafana/alert 配置位于：

```text
ops/self-hosted/observability/
```

本地配置校验：

```bash
npm run observability:check
```

`/metrics` 是内部运维数据，生产和 pilot 环境必须通过 private network、VPN、反向代理 allowlist、mTLS 或更强控制访问，不能直接公开到公网。
