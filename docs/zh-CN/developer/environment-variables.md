# 环境变量

> English: [English](../../developer/environment-variables.md)

使用 `.env.example` 作为本地 non-HDC staging profile。复制为 `.env` 后，测试 live 小泽 LLM 时填写 `XIAOZE_LLM_API_BASE_URL`、`XIAOZE_LLM_MODEL`、`XIAOZE_LLM_API_KEY`。

## 核心运行时

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | API 启动 | `production` 会启用更严格的配置检查。 |
| `HOST` | `127.0.0.1` | API 启动 | 自托管容器通常设为 `0.0.0.0`，便于反向代理访问。 |
| `PORT` | `8787` | API 启动 | API mode 前端默认访问 `127.0.0.1:8787`。 |
| `DATABASE_URL` | 本地 PostgreSQL URL | migrations、seeds、API mode、E2E | PostgreSQL 是产品化数据源。Catalog launch lane 不得使用默认 compose URL `postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff`；应使用 `npm run catalog:lane:env -- provision --issue <n>`（`wiseeff_lane_<n>`，`127.0.0.1:55438`）。 |
| `TEST_DATABASE_URL` | 未设置 | Catalog/server 集成测试 | 设置后 catalog harness 与 `catalog:lane:accept` 优先于 `DATABASE_URL`。必须仍是真实 pgvector PostgreSQL，不能是共享 compose 应用库。 |
| `CATALOG_BASELINE_READONLY_DATABASE_URL` | 未设置 | Catalog 发布基线只读采集 | 仅供 `scripts/inspect-catalog-publication-baseline.ts` 使用的只读 DSN。采集器拒绝 `DATABASE_URL`，要求 `SET TRANSACTION READ ONLY`，若角色对 Catalog/publication 有 INSERT/UPDATE/DELETE 则失败，绝不打印 DSN，也不插入 Artifact。 |
| `WISEEFF_CATALOG_PUBLICATION_DATA_MODE` | `new-empty` | Catalog 双事实就绪 | Catalog HTTP 与 `/health/ready` catalogPublication 的组合边界 data mode。`populated` 要求真实已批准 runtime pin 且绑定当前 Catalog，不伪造 P13。默认 `new-empty` 不声称 P13 已退役。 |
| `WISEEFF_CATALOG_ARCHIVE_ROOT` | 未设置 | 参数定义彻底删除 | 历史加密迁移归档的原目录。有此类归档时须与 `WISEEFF_CATALOG_ARCHIVE_KEY_HEX` 配套设置；不猜测默认目录。 |
| `WISEEFF_CATALOG_ARCHIVE_KEY_HEX` | 未设置 | 参数定义彻底删除 | 原始 32 字节归档密钥，以 64 位十六进制字符表示。须与归档目录配套设置，不打印密钥，也不替换成新密钥。 |
| `WISEEFF_PUBLICATION_MANAGER_ENV_FILE` | `.env.publication-manager` | 自托管 Compose | 仅 `publication-manager` 服务加载的私有 env 文件。 |
| `WISEEFF_PUBLICATION_MANAGER` | 未设置 | publication manager 进程 | `npm run publication:manager` 必须为 `1`。 |
| `WISEEFF_API_PROCESS` | 未设置 | API 容器 | API 服务设为 `1`，使 manager 入口拒绝在该进程启动。 |
| `WISEEFF_PUBLICATION_MANAGER_DATABASE_URL` | 公共 `.env` 中不设置 | publication manager | 只写在 `.env.publication-manager`。LOGIN 必须能 `SET ROLE` `catalog_publication_coordinator_role` 和 `catalog_synchronizer_role`。绝不是数据库超级用户。不得复制普通 API `DATABASE_URL`。缺此键时 manager 保持未配置（`503 { configured: false }`）。旧栈已经跑过 `publication-manager` 时，升级 freeze 失败闭合；首次引入且没有 manager LOGIN 时跳过 freeze，也不启动 manager。 |
| `WISEEFF_WORKER_DATABASE_URL` | 未设置 | 日志 worker / `inspect-login worker` | 日志 worker 专用 LOGIN。隔离交付设为 `wiseeff_worker`。`inspect-login worker` 拒绝回退到 `DATABASE_URL`。 |
| `WISEEFF_PUBLICATION_MANAGER_LEASE_MS` | `30000` | publication manager | Job 租约时长（毫秒）。认领使用 PostgreSQL `now()`，不用 manager 墙上时钟。 |
| `WISEEFF_PUBLICATION_MANAGER_RETRY_BUDGET` | `5` | publication manager | 锁竞争与可恢复连接错误的有界自动重试。权限、篡改、能力、不完整前驱、基线漂移为终止或 blocked。 |
| `WISEEFF_PUBLICATION_MANAGER_POLL_INTERVAL_MS` | `1000` | publication manager | 队列为空时的空闲轮询间隔。 |
| `WISEEFF_PUBLICATION_MANAGER_ACTIVATION_TIMEOUT_MS` | `60000` | publication manager | 持有执行锁的激活超时。丢失的 commit 响应从 Receipt 对账，不宣告终止失败。 |
| `WISEEFF_PUBLICATION_MANAGER_HEALTH_PORT` | `8791` | publication manager | 回环存活端口（`/health/live`），报告最老 queued 年龄、attempt 与 rebase 计数。API `/health/ready` 不得仅因该进程停止而变为 503。 |
| `WISEEFF_API_BASE_URL` | `http://127.0.0.1:8787` | smoke clients | M5/M6 smoke 脚本使用。 |
| `VITE_WISEEFF_RUNTIME_MODE` | `api`（代码默认与 `.env.example`） | 前端 runtime | `npm run dev` / `npm run dev:all` 也会注入 `api`。前端-only demo/test 可设为 `mock`。 |
| `VITE_WISEEFF_API_BASE_URL` | `http://127.0.0.1:8787` | 前端 API runtime | 必须指向 API 进程。 |
| `VITE_WISEEFF_FOOTER_COPYRIGHT_OWNER` | `雷泽（WiseEff）` | 公开页脚元数据 | 构建时去除首尾空格；空值回退默认值。明确部署主体后应填写其法定名称。 |
| `VITE_WISEEFF_APP_VERSION` | 根目录 `package.json` 版本 | 公开页脚元数据 | 可选发布标签覆盖值；界面规范化为恰好一个前导 `v`。 |
| `VITE_WISEEFF_CONTACT_HREF` | 空 | 可选公开联系方式 | 只接受绝对 `https:` 或 `mailto:`；空值或非法值隐藏联系方式。 |
| `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED` | 已忽略（已废弃） | — | 在 #240 退役。项目配置工作台始终为规范项目运营路由；设置此环境变量无效。 |

所有 `VITE_*` 值都会公开并固化进前端 bundle。自托管部署修改页脚元数据后必须重新构建应用镜像；只重启旧镜像不会生效。不要在这些变量中放置 secret。

### 配置应用页脚

本地开发时，在仓库根目录的 `.env` 中增加公开元数据；自托管部署则编辑 `ops/self-hosted/.env`：

```dotenv
VITE_WISEEFF_FOOTER_COPYRIGHT_OWNER=示例科技有限公司
VITE_WISEEFF_APP_VERSION=1.4.0
VITE_WISEEFF_CONTACT_HREF=https://support.example.com/contact
```

需要使用邮箱时，把联系方式写成 `mailto:support@example.com`。当前只支持一个可选联系地址，界面文字固定使用本地化后的“联系我们”。将 `VITE_WISEEFF_CONTACT_HREF` 留空即可隐藏。不要填写电话号码、相对路径、JavaScript URL、凭据或 secret。

修改仓库根目录 `.env` 后需要重启 Vite 开发服务器；生产构建需要重新执行 `npm run build`。自托管首次安装时，将[配置向导](../../../ops/self-hosted/setup.zh-CN.md)拆成以下步骤，以便在第一次构建镜像前编辑向导生成的环境文件：

```bash
cd ops/self-hosted
./scripts/setup.sh init
# 编辑 .env 中的三个页脚配置键。
./scripts/setup.sh up
./scripts/setup.sh provision
```

已有部署应保留当前 `.env`，只修改上述键，然后使用正常的[升级 `plan` 与 `apply` 入口](../../../ops/self-hosted/upgrade.zh-CN.md)；不要使用 `setup.sh --force`，因为它会替换部署环境并轮换自动生成的 secret。

重新构建后，登录系统并滚动到普通页面底部，核对版权所有者、规范化后的 `v` 版本和可选联系方式，同时检查首页的信息行。全高项目配置工作台按设计不显示紧凑页脚。如果已配置的联系方式没有出现，先确认它是绝对 `https:` 或 `mailto:` URL，并确认执行的是镜像重建而不是只重启旧镜像。

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
| `WISEEFF_SEED_LEGACY_FLAT_IDENTITY` | 未设置（`0`） | 已弃用，仅用于 API 启动兼容 | M1 忽略此旧 seed 开关：`db:seed:m1` / `db:seed:all` 为 canonical-only，没有 legacy flat 选项，也不运行旧语义身份迁移。`1` 仍为 legacy operator 工作流关闭 API 启动期本地 post-cutover；不会种 legacy 数据，也不等于完成 cutover。显式启动控制优先使用 `WISEEFF_LOCAL_POST_CUTOVER`。 |
| `WISEEFF_LOCAL_POST_CUTOVER` | 未设置（development 下等同开启） | `dev:api` 启动，legacy cohorts | 干净且所有来源 pin 完整的 canonical 安装跳过 legacy finalize，不运行旧语义身份迁移；全新 canonical 种子不需要 cutover。legacy cohorts 可设为 `0`/`false`/`off` 跳过 listen 前本地 post-cutover。production 永不执行。test 仅显式开启（`1`/`true`/`on`）时执行。 |

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
| `LOG_ANALYSIS_MODEL` | 空 | live 日志分析 LLM | 全局模型名，写入报告与指标。所钉技能版本的 `modelOverride` 只替换模型名；端点、key 和单次请求超时仍用全局配置，版本预算受下方全局上限约束。 |
| `LOG_ANALYSIS_API_KEY` | 空 | live 日志分析 LLM | secret。 |
| `LOG_ANALYSIS_API_TIMEOUT_MS` | `30000` | live 日志分析 LLM | 单次 `ChatOpenAI` 调用超时（循环内核每步一次调用）。 |
| `LOG_ANALYSIS_TOKEN_BUDGET` | `8000` | 单次分析成本上界 | 版本 `tokenBudget` 的默认值与平台上限。单发内核：限定提示词摘录（约 4 字符/token 折算）与响应 `maxTokens`。循环内核：跨步累计输入+输出 token；耗尽触发显式标注的提前收敛。 |
| `LOG_ANALYSIS_DETERMINISTIC` | `.env.example` 为 `true`，代码默认 `false` | 离线开发/测试/评测 | 使用确定性桩模型（`model` 记 `deterministic`），无需 provider 且就绪检查通过。生产必须配置真实 provider 并保持 `false`。 |
| `LOG_ANALYSIS_KERNEL` | `loop` | 分析内核选择 | `loop` = 有界多步 agent，按运行组合只读工具（默认）；`single-shot` = P1 单发内核，保留为配置回退。 |
| `LOG_ANALYSIS_MAX_STEPS` | `6` | 循环步数上界 | 版本 `stepBudget` 的默认值与平台上限；耗尽触发标注为 `token-budget-exhausted` 的提前收敛。 |
| `LOG_ANALYSIS_JOB_MAX_MS` | `600000` | worker 尝试时限 | 从任务认领开始，覆盖预处理、分析与持久化的总墙钟时限；续租不会重置截止时间。须为不超过 `2147483647` 的正整数；中央环境校验拒绝无效值，直接独立调用 worker 时回退默认值。 |
| `LOG_ANALYSIS_PREPROCESS_MAX_MS` | `20000` | 信号与解码共享时限 | 从信号提取开始的固定合计额度，并受本次尝试剩余墙钟时限约束。续租不补充额度；`LOG_SIGNAL_MAX_MS` 和 `LOG_DECODE_MAX_MS` 仍分别约束各阶段。校验与独立调用回退规则同 `LOG_ANALYSIS_JOB_MAX_MS`。 |
| `LOG_DRY_RUN_MAX_CONCURRENT` | `2` | 技能试运行并发接收 | 整数 1–4，无效值回退为 2。PostgreSQL 原子地执行此跨 API 实例的保守总量上限，每组织最多一个执行。各实例应使用相同值。直到执行实际结束才释放容量，包括超时后仍在退出的工作。容量已满时，在读取样例或调用分析器前返回 `429 RATE_LIMITED`，提示「试运行繁忙，请稍后重试」。 |
| `LOG_BUNDLE_MAX_COMPRESSED_BYTES` | `104857600` | 日志包接入 | 上传总字节数（含普通文件），multipart 默认 100 MiB；JSON/base64 另受解码文件 32 MiB 上限约束。 |
| `LOG_BUNDLE_MAX_UNPACKED_BYTES` | `104857600` | 日志包接入 | 文件原始字节及规范化 UTF-8 文本总量；中间解压容器也受限，默认 100 MiB。 |
| `LOG_BUNDLE_MAX_FILES` | `2000` | 日志包接入 | 非目录叶文件数上限，包含跳过文件。 |
| `LOG_BUNDLE_MAX_FILE_BYTES` | `104857600` | 日志包接入 | 单文件原始及规范化 UTF-8 字节上限，默认 100 MiB；解压还受 200 倍压缩比及 1 MiB 最低预算限制。 |
| `LOG_DECODE_MAX_EVENTS` | `50000` | worker 解码 | 每运行跨文件、抽取器保留的事件上限，超出匹配计 `event_cap`。须为正安全整数；格式错误、零或负值使用默认值。 |
| `LOG_SIGNAL_MAX_MS` | `5000` | worker 信号提取 | 信号提取耗时预算（毫秒），最大取 `10000`；仅接受正安全整数，否则使用默认值。每行最多扫描前 6144 个 UTF-16 代码单元，每行前检查截止时间，约每 8 ms 或 64 个检查点让出调度。部分摘要标记 `time_cap` 或 `line_cap`；提取失败返回带 `extraction_error` 的空摘要，分析继续。还受 `LOG_ANALYSIS_PREPROCESS_MAX_MS` 共享剩余额度与本次尝试剩余墙钟时限约束。 |
| `LOG_DECODE_MAX_MS` | `15000` | worker 解码 | 解码耗时预算（毫秒），大于 `20000` 时取上限；还受信号阶段用时后的 `LOG_ANALYSIS_PREPROCESS_MAX_MS` 共享剩余额度与本次尝试剩余墙钟时限约束。解码在每行、组提交和编译前检查，约每 8 ms 或 2000 个检查点让出调度。超时保留已完成事件、丢弃未完成组、计一次 `time_cap` 并继续。须为正安全整数；格式错误、零或负值使用默认值。 |
| `LOG_SOURCE_MAX_COMPRESSED_BYTES` | `104857600` | 源码快照上传/索引 | 压缩包上限 100 MiB；multipart 路由请求体预算为该上限加 64 KiB，过大的 `Content-Length` 在缓冲前拒绝。 |
| `LOG_SOURCE_MAX_UNPACKED_BYTES` | `1073741824` | 源码快照索引 | 累计解包字节上限，包含跳过条目，默认 1 GiB。 |
| `LOG_SOURCE_MAX_FILE_BYTES` | `2097152` | 源码快照索引 | 大于 2 MiB 的文件跳过并记录原因。 |
| `LOG_SOURCE_MAX_FILES` | `20000` | 源码快照索引 | 非目录文件数上限，包含跳过文件；压缩包条目另有该值两倍的上限。 |
| `LOG_SOURCE_MAX_STATEMENTS` | `20000` | 源码语句索引 | 每快照最多索引的输出语句数；达到上限时标记语句索引已截断。 |
| `LOG_SOURCE_MAX_STATEMENTS_PER_FILE` | `500` | 源码语句索引 | 每文件最多索引的输出语句数；达到上限时标记语句索引已截断。 |
| `LOG_ANALYSIS_JUDGE_API_BASE_URL` | 空 | 效果层评测 judge | `npm run logs:eval:quality` 真模型模式下 LLM-as-judge 的 OpenAI-compatible 端点；未配置时使用确定性 rubric 桩。 |
| `LOG_ANALYSIS_JUDGE_MODEL` | 空 | 效果层评测 judge | judge 模型名，写入质量报告。 |
| `LOG_ANALYSIS_JUDGE_API_KEY` | 空 | 效果层评测 judge | secret。 |
| `LOG_ANALYSIS_JUDGE_API_TIMEOUT_MS` | `30000` | 效果层评测 judge | judge 请求超时。 |
| `LOG_ANALYSIS_JUDGE_SAMPLE_RATE` | `0.2` | judge 校准 | `docs/generated/log-analysis-judge-sample.md` 人工复核清单的确定性抽样率（0..1）；至少抽 1 条已评分案例。 |

技能预算可省略，此时使用全局配置。显式步数至少为 1，token 预算至少为 `min(4096, LOG_ANALYSIS_TOKEN_BUDGET)`，二者均不得超过相应全局上限。技能响应通过 `budgetCaps` 向编辑器提供上限；创建、保存、发布、恢复和技能包导入均校验，分析器在运行时再次取上限。API 与 worker 应使用相同配置。

worker 在各耗时阶段每隔租约时长的三分之一续租，默认租约为 60 秒。续租要求任务仍为处理中、持有者匹配且租约未过期，以 PostgreSQL `clock_timestamp()` 检查；续租失败即停止工作。`LOG_ANALYSIS_JOB_MAX_MS` 独立限制整个已认领尝试，续租不会延长总时限。

`ops/self-hosted/compose.yaml` 中标准 512 MiB API / 384 MiB worker 保留上传/解包/单文件 100 MiB 默认限制。worker 文本、工具、解码与信号逐文件流式读取；偏移索引仅在首次范围读取时加载或建立。原始日志面板只保留首个可分析文件最多 400 行、128 KiB 预览；单行/合并条目在 64 KiB 截断。预筛最多预取八个 GET 流，按文件顺序消费，保持共享引用与错误码预算不变。接入仍缓冲压缩包，不能仅凭 worker 的 512 MiB 实测提高 API 限制。

2026-10-19 宿主机的历史探针（延迟索引与租约心跳改动前）测得：worker 处理 512 MiB、2,000 文件、最大单文件 200 MiB 时 RSS **171.64 MiB**、耗时 **55,720.41 ms**；当时实现持久化全部索引与报告，信号为部分结果、解码 `time_cap`（零事件）。API multipart 100 MiB 为 **290.28 MiB** / **8,550.36 ms**；JSON 新上限 32 MiB 为 **394.08 MiB** / **6,577.96 ms**；100 MiB chunked multipart 为 **364.08 MiB** / **6,010.87 ms**，加 `--chunked=true` 可检查没有 Content-Length 的接收路径。100 MiB JSON 消除重复校验复制后仍测得 669.84 MiB，超过 API 512 MiB，因此更大上传须用 multipart。在测试之外显式设置可丢弃 `DATABASE_URL`，运行 `npx tsx scripts/log-bundle-memory-probe.ts --mode=worker --profile=spec` 或 `--mode=api-multipart|api-json --profile=configured`；输入生成/客户端进程不计入测量 RSS。范围与限制见[运行手册](../runbooks/log-analysis-llm.md#压缩包接入p3)。

解码默认值面向同一标准 384 MiB worker：保留 50,000 个事件，解码耗时预算 15,000 ms。提高事件上限前须检查内存；解码受 20,000 ms、预处理共享剩余额度与本次尝试剩余墙钟时限约束。模式最多 512 个 UTF-16 单元、计数重复上限 100；输入每行最多 6144 个单元、每组最多 16,384。预览独立使用 100 ms 校验/解码硬超时，最多处理 5000 行、返回 500 事件，以 `truncated`/`reason` 标识部分结果。worker 流式读取解析输入并执行 gzip，只保留有界事件对象；顺序数组支持游标，证据索引共享对象。产物失败记录 `artifact_error` 和空键，不提供解码事件并继续分析。可在测试之外运行 `npx tsx scripts/log-decode-memory-probe.ts`，对三个总计 95 MiB 的文件执行解码、压缩和索引，输出耗时、事件数、峰值 RSS、堆内存和 interval 漂移停顿。本次变更未运行该探针，不能据此声称标准容器已验收。

`LOG_SOURCE_*` 值必须是正的安全整数；未设置或空值使用默认值。源码索引通过临时磁盘流式处理压缩包，一次最多保留一个符合条件的文件。这些限制独立于 `LOG_BUNDLE_*`；源码索引按累计字节限制，不使用压缩比启发式。可单独运行 `npx tsx scripts/log-source-memory-probe.ts` 探测 1 GiB 源码索引的 RSS。源码索引与日志分析共用 `LOG_WORKER_ENABLED` 和 `npm run worker:logs`，详见[运行手册](../runbooks/log-analysis-llm.md#源码快照1243)。

## 日志分析结果 Webhook

按域结果 Webhook（P3b）在 `/log-admin` 配置（URL、只写签名密钥、启用开关）；本组环境变量只调节共享发送端。投递尽力而为、绝不阻塞分析；SSRF 约束见 `docs/zh-CN/SECURITY.md`。

| 变量 | 本地默认值 | 用途 | 说明 |
| --- | --- | --- | --- |
| `LOG_WEBHOOK_TIMEOUT_MS` | `5000` | webhook 发送端 | 单次尝试请求超时；响应体一律丢弃。 |
| `LOG_WEBHOOK_SECRET_ENCRYPTION_KEY` | 仅开发/测试使用确定性默认值 | 回调签名密钥静态加密 | base64 编码的 32 字节密钥；已有回调配置的生产实例缺失该值时拒绝启动。API 和独立日志 worker 使用同一密钥，跨重启持久保存。启动幂等加密旧明文行；轮换见日志分析 runbook。 |
| `LOG_WEBHOOK_MAX_ATTEMPTS` | `3` | webhook 发送端 | 每次投递的尝试上限，超过后标记失败（尝试间指数退避）。 |
| `LOG_WEBHOOK_RETRY_BASE_DELAY_MS` | `1000` | webhook 发送端 | 退避基数：第 n 次尝试前等待 `base * 2^(n-1)` 毫秒。 |
| `LOG_WEBHOOK_DELIVERY_RETENTION_ENABLED` | `true` | Webhook 投递历史维护 | polling 与 durable 队列模式均由活动日志 worker 运行一个 fail-open 清理循环。设为 `false` 只停止未来删除，不能恢复已经裁剪的行。 |
| `LOG_WEBHOOK_DELIVERY_RETENTION_PER_DOMAIN` | `10000` | Webhook 投递历史维护 | 对每个组织域内的日志业务域，分别保留最近 N 条尝试记录和 N 条终态 outbox（`delivered` / `failed`）；不裁剪待发送、处理中或重试中的事件。合法范围为整数 `1..1000000`，两张表均按 `created_at DESC, id DESC` 排序，每表每周期最多十批、每批 1,000 行。 |
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
