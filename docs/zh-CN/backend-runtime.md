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

本地开发推荐从 `.env.example` 复制为 `.env`，然后填写 OpenAI-compatible Agent 的 API 地址、模型和 key。

关键变量：

- `DATABASE_URL`：PostgreSQL 连接。
- `AUTH_MODE`：`development` 或 `production`。
- `AUTH_TOKEN_ISSUER` / `AUTH_TOKEN_HMAC_SECRET`：production-mode HMAC auth。
- `OBJECT_STORE_MODE`：`local` 或 `s3`。
- `OBJECT_STORE_ROOT`：local object store 目录。
- `DEBUG_DEVICE_GATEWAY_MODE`：`simulator` 或 `hdc`。
- `AGENT_PROVIDER`：`deterministic` 或 `live`。
- `AGENT_API_FORMAT`：`wiseeff` 或 `openai`。
- `WISEEFF_API_BASE_URL` / `VITE_WISEEFF_API_BASE_URL`：smoke 和前端 API base URL。

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

OpenAI-compatible live provider：

```text
AGENT_PROVIDER=live
AGENT_API_FORMAT=openai
AGENT_API_BASE_URL=...
AGENT_MODEL=...
AGENT_API_KEY=...
AGENT_API_TIMEOUT_MS=30000
```

`/health/ready` 会检查 provider health。真实 chat completion 还需要通过 Agent API 请求验证，并检查 trace 中的 provider、model、usage、safety 和 fallback 信息。

## Self-hosted runtime / 自托管运行

M6.1 在 `ops/self-hosted/` 下新增 Linux 自托管基线。它把 PostgreSQL、API、web、worker 和 Caddy proxy 拆成独立服务。

关键命令：

```bash
npm run selfhost:check
npm run selfhost:smoke -- --base-url https://<host>
```

本地开发继续使用 `HOST=127.0.0.1`。自托管 API 容器使用 `HOST=0.0.0.0`，这样 Caddy 才能通过 compose 网络访问 API；API 容器设置 `LOG_WORKER_ENABLED=false`，由独立 worker 容器运行 `npm run worker:logs`。

这只是 M6.1 baseline。OIDC、自托管对象存储备份、durable queue、observability、rollback 和 capacity gates 属于后续 M6 阶段。
