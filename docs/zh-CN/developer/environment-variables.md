# 环境变量

> English: [English](../../developer/environment-variables.md)

使用 `.env.example` 作为本地 non-HDC staging profile。复制为 `.env` 后，测试 live 小泽 LLM 时填写空白 `AGENT_API_*` 值。

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

## DTS 配置集校验门禁

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `DTS_VALIDATION_MODE` | `block`（代码默认；`.env.example` 未设置） | P2 配置集基线发布门禁 | `block`：`dtc` 报错或 `dtc` 二进制不可用时，`releaseBaseline` 返回 `409` 阻断发布。`warn`：始终放行，但标记 `requiresConfirmation: true`。`off`：完全跳过校验（不会调用 `dtc`）。自托管目标未安装 `dtc` 时可设为 `warn`。 |
| `WISEEFF_DTS_TOOLCHAIN_DIR` | `<repo>/.wiseeff-tools/dts-toolchain` | DTS release 校验 | 可选受控工具链目录；API 与 CLI check 优先解析其 `bin`（Windows 为 `Scripts`），再查 PATH。 |
| `WISEEFF_DTC_PATH` / `WISEEFF_FDTOVERLAY_PATH` / `WISEEFF_DT_VALIDATE_PATH` | 未设置 | DTS release 校验 | 受管部署可指定精确二进制；无效 override 失败关闭，不静默回退。 |
| `DTS_IDENTITY_FALLBACK_MODE` | `allow`（代码默认） | 文件同步 / 结构化编辑身份解析 | 无 `source_*` 绑定时可回退 `(name, module)`。`allow` 保留回退并累计 `identityFallbackUses`；`warn` 允许回退并写 `parameter-file-identity-fallback` 审计；`deny` 时 sync 回退路径 `409 VALIDATION_FAILED`，结构化编辑仍可 insert 新 PPV+source（新绑定≠ fallback）。 |
| `DTS_ENABLE_DT_SCHEMA` | 关闭（`0` / 未设置） | `dtc` 之后的可选 dt-schema 绑定校验 | 设为 `1`/`true`/`on` 启用可选 schema 钩子（`enableDtSchema` / 可注入 `schemaRunner`）。 |
| `DTS_DT_SCHEMA_MODE` | `warn` | schema 工具缺失 / 失败策略 | `warn`：缺工具只记 warning，不硬失败；`block`：在外层校验模式非 `warn` 时把不可用抬升为硬错误。 |
| `PARAMETER_IDENTITY_MAINTENANCE_TOKEN` | 未设置 | `parameter-identities:migrate --apply` | 语义身份维护窗口与 `--maintenance-token` 对齐的共享密钥。dry-run 不需要。切勿提交真实 token。 |
| `WISEEFF_SEED_LEGACY_FLAT_IDENTITY` | 未设置（`0`） | `db:seed:m1` / `dev:api` 启动 | 设为 `1` 时种双轨 flat defs/PPV 且不做本地 post-cutover（typed 提交仍会拦截）；同时关闭 API 启动期本地 post-cutover。默认未设置/语义-only 会执行本地 post-cutover finalize。 |
| `WISEEFF_LOCAL_POST_CUTOVER` | 未设置（development 下等同开启） | `dev:api` 启动 | 设为 `0`/`false`/`off` 可跳过 listen 前本地 post-cutover。production 永不执行。test 仅在显式设为 `1` 时执行。 |

`DtcValidator`（`server/modules/parameter-files/dtcValidator.ts`）在受限子进程中运行系统 `dtc` 编译器：独立临时目录、仅含 `PATH` 的最小环境变量，以及到期即杀进程的硬超时。当 `dtc` 不在 `PATH` 上时校验器会降级而不是挂起：`block` 返回 `ok:false`（发布保持阻断，直到人工决定切到 `warn`），`warn` 返回 `ok:true` 并附带「校验已跳过」诊断，`off` 完全不调用 `dtc`。每次门禁运行——通过、失败或降级——都会写入 `validation.gate` 审计事件。容器/`gVisor` 沙箱**本期不做**；见 `docs/zh-CN/SECURITY.md`。

## 设备调试

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `DEBUG_DEVICE_GATEWAY_MODE` | `multi`（代码默认） | 调试 runtime | 仅针对 device-lab 证据运行时可覆盖为 `hdc`、`adb` 或 `simulator`。 |
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

## 小泽 LLM 与 Agent 开关

API mode 始终包含小泽；mock mode 无 Agent UI。数据库可用时，后端始终注册 AG-UI SSE 端点。

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `AGENT_API_BASE_URL` | 空 | live 小泽 LLM | OpenAI-compatible 端点。 |
| `AGENT_MODEL` | 空 | live 小泽 LLM | 本地填写。 |
| `AGENT_API_KEY` | 空 | live 小泽 LLM | secret。 |
| `AGENT_API_TIMEOUT_MS` | `30000` | live 小泽 LLM | LangChain `ChatOpenAI` 请求超时。 |
| `XIAOZE_MODEL` | 空（回退 `AGENT_MODEL`） | live 小泽 | 可选覆盖 LangGraph agent 模型名。 |
| `XIAOZE_CHECKPOINTER` | `memory` | 生产小泽规划 resume | 生产/自托管使用 `postgres`，使 LangGraph checkpoint 跨重启与多副本可用；表由 `npm run db:migrate` 确保。本地开发与测试可用 `memory`。 |
| `XIAOZE_REASONING_FALLBACK_HEURISTIC` | `false` | live 小泽 LLM | 可选旧版语言启发式，仅在无结构化 `reasoning_content` / `<think>` 标签时拆分 reasoning 与 answer。生产环境保持 `false`。 |
| `XIAOZE_PROACTIVE_ENABLED` | `false` | 主动 suggest API | 设为 `true` 注册只读 `POST /api/v1/agent/xiaoze/suggest`。默认关闭。 |
| `VITE_XIAOZE_PROACTIVE_ENABLED` | `false` | 主动建议 UI | 在 `AgentInsightBar` 挂载 `useXiaozeSuggestions`。须 API `XIAOZE_PROACTIVE_ENABLED=true`。 |
| `VITE_XIAOZE_PROMPT_DEBUG` | `false` | 前端开发工具 | opt-in 提示词/调试展示。 |

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
