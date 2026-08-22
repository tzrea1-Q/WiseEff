# 环境变量

> English: [English](../../developer/environment-variables.md)

使用 `.env.example` 作为本地 non-HDC staging profile。复制为 `.env` 后，测试 live 小泽 LLM 时填写 `XIAOZE_LLM_API_BASE_URL`、`XIAOZE_LLM_MODEL`、`XIAOZE_LLM_API_KEY`。

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
| `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED` | 已忽略（已废弃） | — | 在 #240 退役。项目配置工作台始终为规范项目运营路由；设置此环境变量无效。 |

## 认证

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `AUTH_MODE` | `.env.example` 中为 `production` | production-mode smoke | 只有本地开发用户流才使用 `development`。 |
| `AUTH_PROVIDER` | 本地 `.env.example` 为 `local`，自托管示例为 `oidc` | 生产认证 | `local` 是默认本地账号和 session provider，`oidc` 用于目标自托管 SSO，`hmac` 仅用于显式本地 smoke/test。 |
| `AUTH_LOCAL_SELF_REGISTER` | `true` | 本地评估账号 | 设为 `false` 时拒绝 `POST /api/v1/auth/register`，认证页隐藏「注册」。 |
| `AUTH_LOCAL_AUTH_MAX_ATTEMPTS` | `10` | 本地评估账号 | 登录/注册滑动窗口次数上限，键为客户端 IP + 用户名。超出返回 `RATE_LIMITED`（429）。 |
| `AUTH_LOCAL_AUTH_WINDOW_MS` | `60000` | 本地评估账号 | 本地认证限流窗口长度（毫秒）。 |
| `AUTH_TOKEN_ISSUER` | `wiseeff-local` | 可选本地 HMAC smoke | `AUTH_PROVIDER=hmac` 时必须与签名 token 的 issuer 一致。 |
| `AUTH_TOKEN_HMAC_SECRET` | 本地示例 secret | 可选本地 HMAC smoke | 只用于本地 smoke/test profile。 |
| `AUTH_OIDC_ISSUER` | 本地未设置 | 自托管 OIDC | 例如 `https://id.example.com/realms/wiseeff`。 |
| `AUTH_OIDC_AUDIENCE` | 本地未设置 | 自托管 OIDC | 例如 `wiseeff-api`。 |
| `AUTH_OIDC_JWKS_URI` | 本地未设置 | 自托管 OIDC override | discovery 不可用或需要固定 JWKS endpoint 时设置。 |
| `M5_SMOKE_AUTHORIZATION` | 本地 Admin bearer token | M5 smoke | 用于 pilot-readiness smoke 的 `admin:access` token。 |
| `WISEEFF_SMOKE_AUTHORIZATION` | 本地 Admin bearer token | M5 smoke | smoke 脚本接受的备用变量名。 |
| `M6_SELFHOSTED_SMOKE_AUTHORIZATION` | 本地未设置 | 自托管 smoke | 目标环境优先使用 Admin OIDC bearer token。 |
| `M6_IDENTITY_*` | 本地未设置 | M6.2 身份证据 | 目标 OIDC 正向和负向 token evidence。 |

若要验证产品化的本地登录/注册 UI，保持默认 `AUTH_MODE=production` 和 `AUTH_PROVIDER=local`，先运行数据库迁移，确保存在 `user_password_credentials` 和 `auth_sessions`，再启动 API 和 API-mode 前端。本地账号不需要 `AUTH_TOKEN_*` 或 `AUTH_OIDC_*`。注册使用用户名和所选平台角色，没有组织下拉。新账号加入评估组织：有 ChargeLab（`org-chargelab`）就加入它，否则加入唯一的 bootstrap Organization。这是 `AUTH_PROVIDER=local` 的产品规则，不是 `NODE_ENV` 例外。首位 Admin 就绪后，评估主机可设 `AUTH_LOCAL_SELF_REGISTER=false` 关闭公开注册。当前暂不支持邮箱验证。

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
| `DTS_VALIDATION_MODE` | `block`（代码默认；`.env.example` 未设置） | 仅 P2 配置集**基线发布**门禁 | **语义合入与类型化写回不读取此开关**（`applyLockedOverlayWriteback` / `createBindingDraft`）。`block`：`dtc` 报错或 `dtc` 二进制不可用时，`releaseBaseline` 返回 `409` 阻断发布。`warn`：始终放行，但标记 `requiresConfirmation: true`。`off`：完全跳过校验（不会调用 `dtc`）。本地开发除非演练基线发布，建议在 `.env` 使用 `warn` 或 `off`。自托管目标未安装 `dtc` 时可设为 `warn`。 |
| `WISEEFF_DTS_TOOLCHAIN_DIR` | `<repo>/.wiseeff-tools/dts-toolchain` | DTS release 校验 | 可选受控工具链目录；API 与 CLI check 优先解析其 `bin`（Windows 为 `Scripts`），再查 PATH。 |
| `WISEEFF_DTC_PATH` / `WISEEFF_FDTOVERLAY_PATH` / `WISEEFF_DT_VALIDATE_PATH` | 未设置 | DTS release 校验 | 受管部署可指定精确二进制；无效 override 失败关闭，不静默回退。 |
| `DTS_IDENTITY_FALLBACK_MODE` | `allow`（代码默认） | 文件同步 / 结构化编辑身份解析 | 无 `source_*` 绑定时可回退 `(name, module)`。`allow` 保留回退并累计 `identityFallbackUses`；`warn` 允许回退并写 `parameter-file-identity-fallback` 审计；`deny` 时 sync 回退路径 `409 VALIDATION_FAILED`，结构化编辑仍可 insert 新 PPV+source（新绑定≠ fallback）。 |
| `DTS_ENABLE_DT_SCHEMA` | 关闭（`0` / 未设置） | `dtc` 之后的可选 dt-schema 绑定校验 | 设为 `1`/`true`/`on` 启用可选 schema 钩子（`enableDtSchema` / 可注入 `schemaRunner`）。 |
| `DTS_DT_SCHEMA_MODE` | `warn` | schema 工具缺失 / 失败策略 | `warn`：缺工具只记 warning，不硬失败；`block`：在外层校验模式非 `warn` 时把不可用抬升为硬错误。 |
| `PARAMETER_IDENTITY_MAINTENANCE_TOKEN` | 未设置 | `parameter-identities:migrate --apply` | 语义身份维护窗口与 `--maintenance-token` 对齐的共享密钥。dry-run 不需要。切勿提交真实 token。 |
| `WISEEFF_SEED_LEGACY_FLAT_IDENTITY` | 未设置（`0`） | `db:seed:m1` / `dev:api` 启动 | 设为 `1` 时种双轨 flat defs/PPV 且不做本地 post-cutover（typed 提交仍会拦截）；同时关闭 API 启动期本地 post-cutover。默认未设置/语义-only 会执行本地 post-cutover finalize。 |
| `WISEEFF_LOCAL_POST_CUTOVER` | 未设置（development 下等同开启） | `dev:api` 启动 | 设为 `0`/`false`/`off` 可跳过 listen 前本地 post-cutover。production 永不执行。test 仅在显式设为 `1` 时执行。 |

`DtcValidator`（`server/modules/parameter-files/dtcValidator.ts`）在受限子进程中运行系统 `dtc` 编译器：独立临时目录、最小环境变量（`PATH` 以及已存在的用户身份变量 `HOME` / `USER` / `LOGNAME`，不含 secret），以及到期即杀进程的硬超时。当 `dtc` 不在 `PATH` 上时校验器会降级而不是挂起：`block` 返回 `ok:false`（发布保持阻断，直到人工决定切到 `warn`），`warn` 返回 `ok:true` 并附带「校验已跳过」诊断，`off` 完全不调用 `dtc`。每次门禁运行——通过、失败或降级——都会写入 `validation.gate` 审计事件。容器/`gVisor` 沙箱**本期不做**；见 `docs/zh-CN/SECURITY.md`。

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
| `XIAOZE_LLM_API_BASE_URL` | 空 | live 小泽 LLM | OpenAI-compatible 端点。 |
| `XIAOZE_LLM_MODEL` | 空（默认 `gpt-4o-mini`） | live 小泽 LLM | canonical 模式下空值或缺省均使用默认模型。 |
| `XIAOZE_LLM_API_KEY` | 空 | live 小泽 LLM | secret。 |
| `AGENT_API_TIMEOUT_MS` | `30000` | 单独 wiring debt | 不属于 canonical 小泽组三键，当前没有小泽运行时消费者。 |
| `XIAOZE_CHECKPOINTER` | `memory` | 生产小泽规划 resume | 生产/自托管使用 `postgres`，使 LangGraph checkpoint 跨重启与多副本可用；表由 `npm run db:migrate` 确保。本地开发与测试可用 `memory`。 |
| `XIAOZE_REASONING_FALLBACK_HEURISTIC` | `false` | live 小泽 LLM | 可选旧版语言启发式，仅在无结构化 `reasoning_content` / `<think>` 标签时拆分 reasoning 与 answer。生产环境保持 `false`。 |
| `XIAOZE_PROACTIVE_ENABLED` | `false` | 主动 suggest API | 设为 `true` 注册只读 `POST /api/v1/agent/xiaoze/suggest`。默认关闭。 |
| `VITE_XIAOZE_PROACTIVE_ENABLED` | `false` | 主动建议 UI | 在 `AgentInsightBar` 挂载 `useXiaozeSuggestions`。须 API `XIAOZE_PROACTIVE_ENABLED=true`。 |
| `VITE_XIAOZE_PROMPT_DEBUG` | `false` | 前端开发工具 | opt-in 提示词/调试展示。 |
| `VITE_XIAOZE_INSPECTOR` | `false` | 前端开发工具 | opt-in 管理员 CopilotKit AG-UI inspector（仅限非生产构建）。默认关闭：inspector 自带 CDN 推广横幅且上游无独立开关。 |

<!-- xiaoze-llm-legacy-fallback:start -->
### 旧键迁移回退（仅 canonical 三键全部缺席）

三个 canonical 键按组原子解析：任一 `XIAOZE_LLM_API_BASE_URL`、`XIAOZE_LLM_MODEL`、`XIAOZE_LLM_API_KEY` 原始键出现（包括空值）即选择 canonical 模式，空值不会回退。只有 canonical 三键全部未出现时，才在一个迁移窗口内读取 `AGENT_API_BASE_URL`、`AGENT_API_KEY`，模型按 `XIAOZE_MODEL > AGENT_MODEL > gpt-4o-mini` 选择。诊断只包含 code 与键名，不包含端点、模型值或 secret；当前模板和 setup 只写 canonical 键。
<!-- xiaoze-llm-legacy-fallback:end -->

## 日志分析 LLM

独立的 `LOG_ANALYSIS_*` 家族，使日志分析与小泽可指向不同 provider（ADR-0022）。未配置且未开确定性模式时按 provider 不可用处理：`/health/ready` 的 `logAnalysisLlm` 报告 missing，分析降级到规则引擎并显式标注。详见 `docs/runbooks/log-analysis-llm.md`。自托管模板 `ops/self-hosted/.env.example` 与本地 `.env.example` 必须声明这一家族——`npm run selfhost:check` 与 `npm run docs:check` 检查键是否出现，不要求填值。模板里 `LOG_ANALYSIS_API_KEY` 留空仍然合法；运行时失败关闭闸门仍是 `/health/ready` 的 `logAnalysisLlm`，并在 `LOG_ANALYSIS_DETERMINISTIC=true` 时已经放宽 API key。

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `LOG_ANALYSIS_API_BASE_URL` | 空 | live 日志分析 LLM | OpenAI-compatible 端点；不得提交 secret 或私有端点。 |
| `LOG_ANALYSIS_MODEL` | 空 | live 日志分析 LLM | **全局**模型名，写入报告 `model` 列并作为指标标签。业务域的 `modelOverride`（P3b，`/log-admin` 治理）只对绑定该域的分析替换这个模型名——端点、key、超时与 token 预算仍用全局配置。 |
| `LOG_ANALYSIS_API_KEY` | 空 | live 日志分析 LLM | secret。 |
| `LOG_ANALYSIS_API_TIMEOUT_MS` | `30000` | live 日志分析 LLM | 单次 `ChatOpenAI` 调用超时（循环内核每步一次调用）。 |
| `LOG_ANALYSIS_TOKEN_BUDGET` | `8000` | 单次分析成本上界 | 单发内核：限定提示词摘录（约 4 字符/token 折算）与响应 `maxTokens`。循环内核：跨步累计输入+输出 token；耗尽触发显式标注的提前收敛。 |
| `LOG_ANALYSIS_DETERMINISTIC` | `.env.example` 为 `true`，代码默认 `false` | 离线开发/测试/评测 | 使用确定性桩模型（`model` 记 `deterministic`），无需 provider 且就绪检查通过。生产必须配置真实 provider 并保持 `false`。 |
| `LOG_ANALYSIS_KERNEL` | `loop` | 分析内核选择 | `loop` = P2 有界多步 agent（五个只读工具，默认）；`single-shot` = P1 单发内核，保留为配置回退。 |
| `LOG_ANALYSIS_MAX_STEPS` | `6` | 循环步数上界 | 每次分析的最大模型步数；超出触发标注为 `token-budget-exhausted` 的提前收敛。 |
| `LOG_ANALYSIS_JUDGE_API_BASE_URL` | 空 | 效果层评测 judge | `npm run logs:eval:quality` 真模型模式下 LLM-as-judge 的 OpenAI-compatible 端点；未配置时使用确定性 rubric 桩。 |
| `LOG_ANALYSIS_JUDGE_MODEL` | 空 | 效果层评测 judge | judge 模型名，写入质量报告。 |
| `LOG_ANALYSIS_JUDGE_API_KEY` | 空 | 效果层评测 judge | secret。 |
| `LOG_ANALYSIS_JUDGE_API_TIMEOUT_MS` | `30000` | 效果层评测 judge | judge 请求超时。 |
| `LOG_ANALYSIS_JUDGE_SAMPLE_RATE` | `0.2` | judge 校准 | `docs/generated/log-analysis-judge-sample.md` 人工复核清单的确定性抽样率（0..1）；至少抽 1 条已评分案例。 |

## 日志分析结果 Webhook

按域结果 Webhook（P3b）在 `/log-admin` 配置（URL、只写签名密钥、启用开关）；本组环境变量只调节共享发送端。投递尽力而为、绝不阻塞分析；SSRF 约束见 `docs/zh-CN/SECURITY.md`。

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `LOG_WEBHOOK_TIMEOUT_MS` | `5000` | webhook 发送端 | 单次尝试请求超时；响应体一律丢弃。 |
| `LOG_WEBHOOK_MAX_ATTEMPTS` | `3` | webhook 发送端 | 每次投递的尝试上限，超过后标记失败（尝试间指数退避）。 |
| `LOG_WEBHOOK_RETRY_BASE_DELAY_MS` | `1000` | webhook 发送端 | 退避基数：第 n 次尝试前等待 `base * 2^(n-1)` 毫秒。 |
| `LOG_WEBHOOK_DELIVERY_RETENTION_ENABLED` | `true` | Webhook 投递历史维护 | polling 与 durable 队列模式均由活动日志 worker 运行一个 fail-open 清理循环。设为 `false` 只停止未来删除，不能恢复已经裁剪的行。 |
| `LOG_WEBHOOK_DELIVERY_RETENTION_PER_DOMAIN` | `10000` | Webhook 投递历史维护 | 对每个组织域内的日志业务域分别保留最近 N 条尝试记录；合法范围为整数 `1..1000000`，排序固定为 `created_at DESC, id DESC`。 |
| `LOG_WEBHOOK_ALLOW_INSECURE_LOCAL` | `.env.example` 为 `true`，代码默认 `false` | 本地 webhook 联调 | 放行明文 http 环回接收端（`http://127.0.0.1`），便于本地集成测试与验收运行。生产环境由 env 校验直接拒绝。 |

## 知识库嵌入与索引

知识库语义检索镜像 OpenAI-compatible 小泽 LLM 接缝，使用独立的 `/v1/embeddings` 端点。整组留空即为 FTS-only 模式：知识库所有功能保持可用，只是没有语义检索。语义检索还额外要求 PostgreSQL 服务器安装 pgvector 扩展（见自托管 runbook）；端点或扩展缺失时，检索响应会诚实上报 `fts_only`。

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `EMBEDDING_API_BASE_URL` | 空 | 知识库语义检索 | OpenAI-compatible 端点;带或不带末尾 `/v1` 均可。不要提交 secret 或私有端点。 |
| `EMBEDDING_MODEL` | 空 | 知识库语义检索 | 发送给端点的嵌入模型名。更换模型后需在 `/knowledge-admin` 执行全量重建。 |
| `EMBEDDING_API_KEY` | 空 | 知识库语义检索 | secret;端点无鉴权时可留空。 |
| `EMBEDDING_API_TIMEOUT_MS` | `10000` | 知识库语义检索 | 单请求超时;超时的检索会对该次查询降级为 FTS-only 并如实上报。 |
| `KNOWLEDGE_INDEX_WORKER_ENABLED` | `true` | 知识索引新鲜度 | 本地 API 进程内运行轮询索引 worker。自托管 API 容器可设为 `false` 并单独运行 worker 进程。 |

## 队列和 Worker

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `LOG_WORKER_ENABLED` | `true` | 日志 worker 启动 | 自托管 API 容器设为 `false`，worker 容器运行 `npm run worker:logs`。 |
| `LOG_ANALYSIS_QUEUE_MODE` | `polling` | 日志 worker dispatch | 自托管 Redis/BullMQ 使用 `durable`。 |
| `REDIS_URL` | `redis://127.0.0.1:6379` | durable queue mode | `LOG_ANALYSIS_QUEUE_MODE=durable` 时必填。 |
| `LOG_ANALYSIS_QUEUE_PREFIX` | `wiseeff` | BullMQ namespace | Redis 共享时应按环境区分。 |
| `LOG_ANALYSIS_QUEUE_ATTEMPTS` | `4` | retry/dead-letter policy | 与 PostgreSQL job retry 状态对齐。 |
| `LOG_WORKER_OBSERVABILITY_HOST` | `127.0.0.1` | 独立 worker 健康与指标 | 自托管 Compose 只在私网内覆盖为 `0.0.0.0`。 |
| `LOG_WORKER_OBSERVABILITY_PORT` | `8788` | 独立 worker 健康与指标 | 私网提供 `GET /health/live` 和 `GET /metrics`，禁止发布该端口。 |

## 自托管运行时

M6.1 在 `ops/self-hosted/.env.example` 提供 Linux 部署 profile。M6.2 默认目标身份 provider 为 OIDC；如果部署明确选择 WiseEff 本地账号，可以把 `AUTH_PROVIDER` 设为 `local`，但需要接受没有外部 SSO/MFA 联邦的边界。`AUTH_PROVIDER=hmac` 仍只适合本地 smoke/test，不是目标环境身份验收证据。

构建传输与 runtime `.env` 明确分离。受限网络主机通过 `./scripts/build-network.sh init` 创建被 Git 忽略、权限为 `0600` 的 `ops/self-hosted/.build-network.env`。allowlist 只包含 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`（及对应小写变量）、`WISEEFF_NPM_REGISTRY`、`WISEEFF_BUILD_CA_CERT_FILE`、`WISEEFF_BUILD_TLS_POLICY` 和 `WISEEFF_RUNTIME_PROXY`。setup/upgrade 只按数据解析。`WISEEFF_BUILD_TLS_POLICY` 默认是 `verify`；`insecure` 是仅构建期的应急值，每次真正执行 setup/upgrade 构建时还必须传 `--allow-insecure-build`，不会改变 runtime TLS。完整说明见[受限网络运行手册](../../../ops/self-hosted/upgrade.zh-CN.md#受限网络构建配置)。不要把这些值加入运行时 `.env.example`，也不要提交真实私有文件。

不要手填 `.env.example`。使用 [配置向导](../../../ops/self-hosted/setup.zh-CN.md) 或 [IP 实验室 profile](../../../ops/self-hosted/ip-lab.zh-CN.md)：`WISEEFF_DEPLOY_PROFILE=ip-lab|acme`、`WISEEFF_TLS_MODE=http|internal|acme`、`WISEEFF_CADDYFILE`、`WISEEFF_PUBLIC_URL`、`WISEEFF_LAB_ADMIN_*`、`WISEEFF_LAB_SEED`，以及未填 live key 时的 `XIAOZE_DETERMINISTIC=true` / `LOG_ANALYSIS_DETERMINISTIC=true`。完整命令见向导页。

目标环境不要提交真实 bearer token、API key、数据库密码或对象存储 secret。所有 target-ready、pilot-ready、release-ready 结论都必须引用真实目标证据，而不是本地 skip 或示例值。

图形化监控 profile 使用以下非 secret 设置：

| 变量 | 自托管默认值 | 说明 |
| --- | --- | --- |
| `WISEEFF_GRAFANA_PORT` | `3000` | Grafana 仅绑定 loopback 的宿主机端口。 |
| `WISEEFF_PROMETHEUS_PORT` | `9090` | Prometheus 仅绑定 loopback 的宿主机端口。 |
| `WISEEFF_ALERTMANAGER_PORT` | `9093` | Alertmanager 仅绑定 loopback 的宿主机端口。 |
| `WISEEFF_PROMETHEUS_RETENTION` | `15d` | Prometheus named volume 的 TSDB 保留期。 |

使用 `./scripts/observability up|down|restart|status|logs` 管理可选监控 profile。Grafana 数据源和 Dashboard 自动 provisioning；监控 UI 不增加 Caddy 公网路由，应通过 SSH 隧道、VPN 或同等级受控运维路径访问。
