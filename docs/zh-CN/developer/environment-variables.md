# 环境变量

> English: [English](../../developer/environment-variables.md)

使用 `.env.example` 作为本地 non-HDC staging profile。复制为 `.env` 后，通常只需要填写 live Agent 的 model 和 API key。若测试 URL-backed `wiseeff` 或 `openai` provider，再填写 `AGENT_API_BASE_URL`。

## 核心运行时

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | API 启动 | `production` 会启用更严格的配置检查。 |
| `HOST` | `127.0.0.1` | API 启动 | 自托管容器通常设为 `0.0.0.0`，便于反向代理访问。 |
| `PORT` | `8787` | API 启动 | API mode 前端默认访问 `127.0.0.1:8787`。 |
| `DATABASE_URL` | 本地 PostgreSQL URL | migrations、seeds、API mode、E2E | PostgreSQL 是产品化数据源。 |
| `WISEEFF_API_BASE_URL` | `http://127.0.0.1:8787` | smoke clients | M5/M6 smoke 脚本使用。 |
| `VITE_WISEEFF_RUNTIME_MODE` | `api`（代码默认与 `.env.example`） | 前端 runtime | `npm run dev` / `npm run dev:all` 也会注入 `api`。前端-only demo/test 可设为 `mock`。 |
| `VITE_WISEEFF_API_BASE_URL` | `http://127.0.0.1:8787` | 前端 API runtime | 必须指向 API 进程。 |

## 认证

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `AUTH_MODE` | `.env.example` 中为 `production` | production-mode smoke | 只有本地开发用户流才使用 `development`。 |
| `AUTH_PROVIDER` | 本地 `.env.example` 为 `local`，自托管示例为 `oidc` | 生产认证 | `local` 是默认本地账号和 session provider，`oidc` 用于目标自托管 SSO，`hmac` 仅用于显式本地 smoke/test。 |
| `AUTH_TOKEN_ISSUER` | `wiseeff-local` | 可选本地 HMAC smoke | `AUTH_PROVIDER=hmac` 时必须与签名 token 的 issuer 一致。 |
| `AUTH_TOKEN_HMAC_SECRET` | 本地示例 secret | 可选本地 HMAC smoke | 只用于本地 smoke/test profile。 |
| `AUTH_OIDC_ISSUER` | 本地未设置 | 自托管 OIDC | 例如 `https://id.example.com/realms/wiseeff`。 |
| `AUTH_OIDC_AUDIENCE` | 本地未设置 | 自托管 OIDC | 例如 `wiseeff-api`。 |
| `AUTH_OIDC_JWKS_URI` | 本地未设置 | 自托管 OIDC override | discovery 不可用或需要固定 JWKS endpoint 时设置。 |
| `M5_SMOKE_AUTHORIZATION` | 本地 Admin bearer token | M5 smoke | 用于 pilot-readiness smoke 的 `admin:access` token。 |
| `WISEEFF_SMOKE_AUTHORIZATION` | 本地 Admin bearer token | M5 smoke | smoke 脚本接受的备用变量名。 |
| `M6_SELFHOSTED_SMOKE_AUTHORIZATION` | 本地未设置 | 自托管 smoke | 目标环境优先使用 Admin OIDC bearer token。 |
| `M6_IDENTITY_*` | 本地未设置 | M6.2 身份证据 | 目标 OIDC 正向和负向 token evidence。 |

若要验证产品化的本地登录/注册 UI，保持默认 `AUTH_MODE=production` 和 `AUTH_PROVIDER=local`，先运行数据库迁移，确保存在 `user_password_credentials` 和 `auth_sessions`，再启动 API 和 API-mode 前端。本地账号不需要 `AUTH_TOKEN_*` 或 `AUTH_OIDC_*`。注册使用用户名、固定组织选项和所选平台角色；当前暂不支持邮箱验证。本地开发默认 `NODE_ENV=development` 时，自助注册账号会加入已 seed 的 `org-chargelab` / `ChargeLab` 演示组织，登录后可以看到本地种子数据。只有在需要验证部门组织隔离时，才把 `NODE_ENV` 设为非 development 值。

## 对象存储

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `OBJECT_STORE_MODE` | `local` | 日志上传、readiness | 生产要求 `s3`。 |
| `OBJECT_STORE_ROOT` | `.wiseeff-object-store` | 本地对象存储 | 已被 Git 忽略。 |
| `OBJECT_STORAGE_ENDPOINT` | 空或注释 | S3/OSS mode | 目标环境值。 |
| `OBJECT_STORAGE_BUCKET` | 空或注释 | S3/OSS mode | 目标环境 bucket。 |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | 空或注释 | S3/OSS mode | secret。 |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | 空或注释 | S3/OSS mode | secret。 |
| `OBJECT_STORAGE_TLS_POLICY` | 自托管 profile 为 `required` | M6.3 evidence | 目标证据必须使用 TLS，除非记录明确的本地实验例外。 |
| `OBJECT_STORAGE_PATH_STYLE` | `true` | S3-compatible self-hosting | 自托管 provider 不支持 virtual-host bucket 时使用 path-style。 |

## 设备调试

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `DEBUG_DEVICE_GATEWAY_MODE` | `simulator` | 调试 runtime | 审批过的真实 device-lab evidence 使用 `hdc`、`adb` 或 `multi`。 |
| `DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION` | `.env.example` 为 `true` | non-customer staging simulator mode | 不可用于 customer production signoff。 |
| `HDC_TIMEOUT_MS` | `5000` | HDC adapter | 命令超时预算。 |
| `ADB_TIMEOUT_MS` | `5000` | ADB adapter | 命令超时预算。 |
| `HDC_DEVICE_LAB_AVAILABLE` | 未设置 | HDC smoke | 仅在具备真实目标值时设置。 |
| `HDC_SMOKE_PROJECT_ID` | `aurora` | HDC device-lab | 权限、session、node operation、audit 和 evidence 的运行上下文。 |
| `HDC_SMOKE_DEVICE_ID` | auto lab row | HDC device-lab | 可选校验 override，用于校验 lab-only WiseEff HDC device inventory id。 |
| `HDC_SMOKE_TARGET_REF` | auto | HDC device-lab | 可选校验 override，用于校验唯一 `hdc list targets` target。 |
| `HDC_SMOKE_PARAMETER_ID` | auto lab parameter | HDC device-lab | 可选校验 override，用于校验 lab-only 临时节点参数 id。 |
| `HDC_SMOKE_NODE_PATH` | `/data/local/tmp/wiseeff_hdc_smoke_node` | HDC device-lab | 可选校验 override，用于校验 lab-only 临时文件节点。 |
| `HDC_SMOKE_ORIGINAL_VALUE` | `wiseeff-hdc-original` | HDC device-lab | 可选 lab 临时节点初始化值。 |
| `HDC_SMOKE_WRITE_VALUE` | `wiseeff-hdc-updated` | HDC device-lab | 显式确认后使用的可选 lab 写入值。 |
| `HDC_SMOKE_CONFIRM_WRITE` | 无 | HDC device-lab | HDC write/readback evidence 必填，必须等于 `confirm-high-risk-write`。 |
| `HDC_SMOKE_CONFIRM_ROLLBACK` | 无 | HDC device-lab | HDC snapshot restore 必填，必须等于 `confirm-rollback`。 |
| `HDC_SMOKE_EXPECT_READ_PATTERN` | 未设置 | HDC device-lab | 可选读取证据正则校验。 |
| `HDC_SMOKE_USER_ID` | `u-xu-yun` | HDC device-lab | 可选 smoke actor override。 |
| `ADB_DEVICE_LAB_AVAILABLE` | 未设置 | ADB smoke | 仅在本机 ADB 设备和审批过的读写目标可用时设置。 |
| `ADB_SMOKE_PROJECT_ID` | 无 | ADB device-lab | `DEBUG_DEVICE_GATEWAY_MODE=adb` 且 `ADB_DEVICE_LAB_AVAILABLE=true` 时必需；仅作为运行上下文。 |
| `ADB_SMOKE_DEVICE_ID` | auto | ADB device-lab | 可选校验 override，用于校验自动发现的 WiseEff ADB device inventory id。 |
| `ADB_SMOKE_TARGET_REF` | auto | ADB device-lab | 可选校验 override，用于校验唯一 ready `adb devices` serial。 |
| `ADB_SMOKE_PARAMETER_ID` | auto | ADB device-lab | 可选校验 override，用于校验共享默认 ADB smoke parameter id。 |
| `ADB_SMOKE_NODE_PATH` | auto | ADB device-lab | 可选校验 override，用于校验服务端 binding node path。 |
| `ADB_SMOKE_ENABLE_WRITE` | `false` | ADB device-lab | 启用可选 write/readback/rollback；不会由自动配置推断。 |
| `ADB_SMOKE_WRITE_VALUE` | 无 | ADB device-lab | 仅当 `ADB_SMOKE_ENABLE_WRITE=true` 时必需。 |
| `ADB_SMOKE_CONFIRM_WRITE` | 无 | ADB device-lab | 仅当 `ADB_SMOKE_ENABLE_WRITE=true` 时必需。 |
| `ADB_SMOKE_CONFIRM_ROLLBACK` | 无 | ADB device-lab | 仅当 `ADB_SMOKE_ENABLE_WRITE=true` 时必需。 |

## Agent Provider

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `AGENT_PROVIDER` | `.env.example` 为 `live` | live provider path | 无 API key 的稳定本地测试可设 `deterministic`。 |
| `AGENT_API_FORMAT` | `wiseeff` | live provider path | `openai` 和 `wiseeff` 使用 URL-backed legacy transport。P1 已移除 `pi`（TD-027）；遗留 `.env` 中的 `pi` 会在服务端启动时迁移为 `wiseeff`。 |
| `AGENT_API_BASE_URL` | 空 | URL-backed live provider | `AGENT_API_FORMAT=openai` 或 `wiseeff` 时必填。 |
| `AGENT_MODEL` | 空 | live provider path | 本地填写。 |
| `AGENT_API_KEY` | 空 | live provider path | secret。 |
| `AGENT_API_TIMEOUT_MS` | `30000` | live provider path | 请求超时。 |
| `AGENT_PROMPT_VERSION` | `m5-agent-v1` | traces | 写入 provider trace metadata。 |

## Xiaoze（P0 感知 + P1 行动）

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `XIAOZE_RUNTIME_ENABLED` | `false` | Xiaoze AG-UI 端点 | 设为 `true` 注册 `POST /api/v1/agent/xiaoze`。 |
| `XIAOZE_DETERMINISTIC` | `false` | 验收/离线测试 | 注入 fake 模型，不依赖真实 LLM。 |
| `XIAOZE_MODEL` | 空（回退 `AGENT_MODEL`） | live Xiaoze | LangChain `ChatOpenAI` 模型名。 |
| `VITE_XIAOZE_ENABLED` | `false` | 前端 Xiaoze UI | 挂载 CopilotKit 聊天面板。非 deterministic 时复用 `AGENT_API_*`。 |

## 队列和 Worker

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `LOG_WORKER_ENABLED` | `true` | 日志 worker 启动 | 自托管 API 容器设为 `false`，worker 容器运行 `npm run worker:logs`。 |
| `LOG_ANALYSIS_QUEUE_MODE` | `polling` | 日志 worker dispatch | 自托管 Redis/BullMQ 使用 `durable`。 |
| `REDIS_URL` | `redis://127.0.0.1:6379` | durable queue mode | `LOG_ANALYSIS_QUEUE_MODE=durable` 时必填。 |
| `LOG_ANALYSIS_QUEUE_PREFIX` | `wiseeff` | BullMQ namespace | Redis 共享时应按环境区分。 |
| `LOG_ANALYSIS_QUEUE_ATTEMPTS` | `4` | retry/dead-letter policy | 与 PostgreSQL job retry 状态对齐。 |

## 自托管运行时

M6.1 在 `ops/self-hosted/.env.example` 提供 Linux 部署 profile。M6.2 默认目标身份 provider 为 OIDC；如果部署明确选择 WiseEff 本地账号，可以把 `AUTH_PROVIDER` 设为 `local`，但需要接受没有外部 SSO/MFA 联邦的边界。`AUTH_PROVIDER=hmac` 仍只适合本地 smoke/test，不是目标环境身份验收证据。

目标环境不要提交真实 bearer token、API key、数据库密码或对象存储 secret。所有 target-ready、pilot-ready、release-ready 结论都必须引用真实目标证据，而不是本地 skip 或示例值。
