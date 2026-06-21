# WiseEff 完整人工验收手册

日期：2026-05-30

本文用于一次完整的人工验收。验收人员可以按顺序检查本地或目标环境中的产品体验、API 联调、数据库持久化、运维门禁和证据记录。

配套文档：

- [M5 商用试点 readiness runbook](../runbooks/m5-commercial-pilot-readiness.md)
- [人工验收 runbook](../runbooks/manual-acceptance.md)
- [staging 部署手册](../runbooks/staging-deployment.md)
- [备份恢复手册](../runbooks/backup-restore.md)
- [回滚手册](../runbooks/rollback.md)
- [HDC 设备实验室手册](../runbooks/hdc-device-lab.md)
- [ADB Device Lab 运行手册](runbooks/adb-device-lab.md)
- [Agent Provider 手册](../runbooks/agent-provider.md)
- [M5 验收证据](../generated/m5-pilot-acceptance.md)

## 1. 验收结论类型

| 结论 | 含义 |
| --- | --- |
| 本地人工验收通过 | 本地前端、API、PostgreSQL、本地对象存储、模拟设备网关和可选 live Agent 检查通过。只能作为本地开发/演示证据。 |
| 非 HDC 目标环境验收通过 | 目标环境中的 live API、PostgreSQL、worker/object-store、Agent、备份恢复和回滚通过，HDC 明确排除。不能宣称完整 pilot-ready。 |
| 完整 pilot-ready 验收通过 | 目标环境所有 M5 门禁都通过，包括 HDC device-lab、backup/restore、rollback、live Agent、严格 M5 smoke。 |
| No-Go | 任一阻塞项失败，或存在未获批准的跳过项。 |

禁止把 mock runtime、本地 simulator、或 `M5_SMOKE_ALLOW_NO_API=true` 的结果当作完整商用试点证据。

## 2. 验收记录

开始前填写：

| 字段 | 值 |
| --- | --- |
| 验收人 |  |
| 时间与时区 |  |
| 分支 |  |
| Commit SHA |  |
| 环境 | local / staging / pilot |
| 前端 URL |  |
| API URL |  |
| 前端 runtime | mock / api |
| Auth mode | development / production |
| 数据库 | local PostgreSQL / staging PostgreSQL |
| 对象存储 | local / S3-compatible / other |
| 设备网关 | simulator / HDC / ADB |
| Agent provider | deterministic / live |
| 证据位置 | `docs/generated/m5-pilot-acceptance.md` 或外部验收记录链接 |

## 3. 验收范围

本次验收覆盖：

- 仓库与文档门禁。
- 环境变量、数据库、对象存储、worker、设备网关、Agent provider。
- 浏览器中的核心产品路径。
- API-mode 全链路联调。
- M5 smoke、backup/restore、rollback、HDC、可选本机 ADB、Agent provider 证据。
- 最终 Go/No-Go 判断。

本次验收不替代：

- 自动化测试本身。
- 生产密钥安全审查。
- 客户数据治理审批。
- 未接入真实硬件时的 HDC 签收。本机 ADB 证据可补充调试覆盖，但不能替代 HDC full-pilot 签核。

## 4. 验收前准备

前 6 步可以通过本地非 HDC preflight 自动化：

```bash
npm run acceptance:preflight
```

该命令会加载 `.env`，记录 branch/commit/worktree 状态，为 localhost URL 自动启动缺失的本地 API/frontend runtime，并保留这些服务供后续浏览器验收使用；随后运行仓库门禁，检查 API health、`/api/v1/me` 和 pilot-readiness。本地非 HDC 验收允许 `deviceGateway` 是唯一 blocker；如果脚本自动启动本地 deterministic Agent provider，也允许 `deviceGateway` 加 `agentProvider` 同时 blocked。目标环境和完整 pilot 模式仍保持严格。门禁已经通过后，如需快速重跑 API 检查，可以使用 `npm run acceptance:preflight -- --skip-gates`。

`--` 之后可追加参数：

- `--skip-gates`：跳过 docs、contract、unit、build 和 whitespace gates。
- `--skip-frontend`：跳过前端 URL 检查。
- `--no-start-runtime`：只探测已经运行的服务，适用于 staging 或外部托管 runtime。
- `--require-pilot-ready`：要求 pilot-readiness 必须返回 `pilot_ready`。
- `--evidence-out <path>`：将 preflight 证据 markdown 写入指定文件。

脚本同时兼容 Windows/npm 的 `npm_config_*` 参数映射；即使 npm 将 `--skip-gates` 转成 `npm_config_skip_gates=true`，上述命令仍会生效。

### 4.1 仓库状态

运行：

```bash
git status --short --branch
git rev-parse HEAD
npm ci
```

通过标准：

- 分支和 commit 与验收候选版本一致。
- 工作区状态已记录。
- 依赖安装成功。

### 4.2 环境变量

本地非 HDC 验收：

```bash
copy .env.example .env
```

如果要测试默认 Pi-backed live Agent，只填写以下留空项：

```text
AGENT_MODEL=
AGENT_API_KEY=
```

本地 profile 默认 `AGENT_API_FORMAT=pi` 和 `AGENT_PI_PROVIDER=minimax`；只有测试 URL-backed `wiseeff` 或 `openai` provider 时才需要填写 `AGENT_API_BASE_URL`。

目标环境或 staging 验收需要准备：

- `DATABASE_URL`
- `WISEEFF_API_BASE_URL`
- `AUTH_MODE=production`
- `AUTH_TOKEN_ISSUER`
- `AUTH_TOKEN_HMAC_SECRET`
- `M5_SMOKE_AUTHORIZATION` 或 `WISEEFF_SMOKE_AUTHORIZATION`
- S3/OSS-compatible 对象存储 endpoint、bucket、access key、secret
- live Agent provider base URL、model、API key
- HDC smoke 变量，若要验收真实设备
- backup/restore 目标位置
- rollback 演练窗口

通过标准：

- `.env` 或 `.env.staging.local` 不进入 Git。
- live Agent 所需字段已填好。
- `M5_BACKUP_RESTORE_DRILL_AT` 只在真实 restore drill 通过后设置。

### 4.3 数据库初始化

运行：

```bash
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

通过标准：

- 迁移已到 `0010_m5_agent_provider_traces.sql`。
- 非客户环境 seed 成功。
- 如果使用受治理的 pilot 数据而不是 seed，需要在验收记录中说明。

### 4.4 自动化门禁

运行：

```bash
npm run docs:check
npm run contract:check
npm run test:all
npm run build
git diff --check
```

通过标准：

- 全部通过。
- `npm run build` 的既有 chunk-size warning 可以记录为非阻塞项。

## 5. 启动本地验收环境

本地 API-mode 验收建议开三个终端。

终端 1：

```bash
npm run dev:api
```

终端 2：

```bash
npm run worker:logs
```

终端 3：

```bash
npm run dev
```

打开前端地址，通常是：

```text
http://127.0.0.1:5173/
```

通过标准：

- API 在 `http://127.0.0.1:8787` 可访问。
- worker 启动且无数据库/对象存储连接错误。
- 前端 API runtime 可以访问后端。

## 6. 运行时健康检查

手工 PowerShell 会话不会自动加载 `.env`。直接探测 API 前，先把 `.env` 加载到当前进程：

```powershell
Get-Content .env | Where-Object { $_ -and $_ -notmatch '^\s*#' -and $_ -match '=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}

$env:WISEEFF_API_BASE_URL
```

最后一行必须输出类似 `http://127.0.0.1:8787` 的 URL。如果为空，健康检查 URL 会无效。

PowerShell 中运行：

```powershell
$headers = @{ Authorization = $env:M5_SMOKE_AUTHORIZATION }

Invoke-RestMethod -Uri "$env:WISEEFF_API_BASE_URL/health/live"
Invoke-RestMethod -Uri "$env:WISEEFF_API_BASE_URL/health/ready"
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/me"
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/operations/pilot-readiness"
```

也可以显式调用 Windows 自带的真实 curl。注意 PowerShell 中单独输入 `curl` 会调用 `Invoke-WebRequest` 别名，因此不能直接使用 Unix 风格的 `-fsS` 和 `-H "Header: value"`：

```powershell
curl.exe -fsS "$env:WISEEFF_API_BASE_URL/health/live"
curl.exe -fsS "$env:WISEEFF_API_BASE_URL/health/ready"
curl.exe -fsS -H "Authorization: $env:M5_SMOKE_AUTHORIZATION" "$env:WISEEFF_API_BASE_URL/api/v1/me"
curl.exe -fsS -H "Authorization: $env:M5_SMOKE_AUTHORIZATION" "$env:WISEEFF_API_BASE_URL/api/v1/operations/pilot-readiness"
```

通过标准：

- `/health/live` 成功。
- `/health/ready` 返回 database、object store、worker、Agent provider 状态。
- production-auth 下 `/api/v1/me` 返回预期 admin 身份。
- `/api/v1/operations/pilot-readiness` 返回 `pilot_ready` 或诚实的 `blocked` 原因。

本地非 HDC 验收中，`deviceGateway` 可以是唯一 blocker；如果 preflight 自动启动本地 deterministic Agent provider，`agentProvider` 也可以同时 blocked。这两种情况都不能算完整 pilot-ready。

如果要验证严格的目标环境 pilot-ready，运行：

```bash
npm run acceptance:preflight -- --require-pilot-ready
```

只要 `/api/v1/operations/pilot-readiness` 不是 `pilot_ready`，该命令就会失败。

## 6.5 自动化浏览器验收

下面的浏览器工作流可以先通过确定性的 Playwright 验收套件自动执行：

```bash
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:models
npm run acceptance:browser
npm run acceptance:evidence
npm run acceptance:quality
npm run acceptance:a11y
npm run acceptance:visual
npm run acceptance:responsive
npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime
npm run acceptance:browser -- --mode full-pilot --no-start-runtime
```

`npm run acceptance:models` 是浏览器工作流背后的确定性状态模型门禁。它用固定 `fast-check` seed 检查参数审批、日志分析、调试回滚和权限可见性等 API/domain 不变量；失败时会输出可复现的 seed、path 和步骤列表。

`npm run acceptance:browser` 会运行 preflight、执行 `npm run acceptance:e2e`、检查需求级覆盖、检查操作级证据，并把证据写入 `docs/generated/acceptance-browser-evidence.md`。证据表会按 A-H 对应人工验收流程，并引用 `playwright-report/acceptance/index.html`、`test-results/acceptance/results.json` 和 `test-results/acceptance/`。非 HDC 模式要求 A-E、G、H 通过；只有 HDC 明确不在范围内时，F 才可以 skipped。

需求级覆盖定义在 `docs/developer/browser-acceptance-coverage-map.md`。操作级覆盖定义在 `docs/developer/user-operation-coverage-matrix.md`。缺少必需 ID、出现未知 `@acceptance` 或 `@operation` marker、缺少必需的自动化 operation 证据，或 operation 证据缺少角色/路由/断言元数据，都是阻塞项。M5.10 之后，如果 operation matrix 声明了 `api`、`db` 或 `audit` 断言，对应的 API 请求/响应摘要、数据库断言摘要、审计事件摘要也都是阻塞项。浏览器套件也会把非预期的 page error、console error、request failure 和关键 WiseEff API `4xx/5xx` 响应判为失败；因此页面视觉上能打开但后台出现未授权 API 失败时，不能算验收通过。

M5.11 之后，工作流门禁旁边还增加确定性的质量门禁。修改 quality scripts、Playwright quality config 或 quality spec 路径时运行 `npm run acceptance:quality`；修改页面结构、弹窗、表单、导航、label、heading、focus 或 Agent 面板时运行 `npm run acceptance:a11y`；修改 CSS、布局、稳定页面区域、截图 mask 或视觉层级时运行 `npm run acceptance:visual`；修改表格、工具栏、导航、弹窗或 viewport-dependent UI 时运行 `npm run acceptance:responsive`。视觉快照只能有意更新：先运行 `npm run acceptance:visual -- --update-snapshots`，再不带 `--update-snapshots` 复跑通过后再接受结果。

M5.12 之后，GitHub Actions 也会归档这些自动化验收产物。PR 和 push 会运行 `acceptance-local-non-hdc`，上传 `wiseeff-acceptance-local-non-hdc` artifact；手动 `workflow_dispatch` 可以选择 `target-non-hdc` 或 `full-pilot`，使用目标环境 URL、GitHub Secrets 和 `--no-start-runtime` 运行，并上传 `wiseeff-acceptance-<mode>` artifact。artifact 应包含 Playwright acceptance report、`test-results/acceptance`、浏览器证据、operation evidence，以及 quality report。PR artifact 只能证明本地非 HDC readiness；完整 full-pilot 仍必须有真实目标环境、HDC、backup/restore、rollback、object-store、worker 和 live Agent 证据。

`npm run acceptance:ci` 用来检查 CI workflow 是否仍然包含本地非 HDC job、target synthetic job、full-pilot 手动门禁和 artifact 路径。修改 `.github/workflows/ci.yml` 或验收 artifact 路径后必须运行该命令。Target synthetic 测的是已经部署好的目标前端；该前端必须已经通过部署配置好 API base URL 和 production-auth bearer-token 注入路径，否则浏览器验收会真实失败。

### 6.6 操作级证据复核

运行 `npm run acceptance:browser` 后，查看 `docs/generated/acceptance-operation-evidence.md` 和 `docs/generated/acceptance-operation-evidence/index.json`。每个自动化 operation 都应包含角色、路由、断言类型、状态、artifact 路径、runtime、trace/report 路径和复现步骤。声明 `api` 断言的 operation 必须包含 method、path、status 和可用 requestId；声明 `db` 断言的 operation 必须包含 table、predicate、observed state 和可用 row count；声明 `audit` 断言的 operation 必须包含 event id、kind、action、targetId 和可用 request/trace 关联。P0/P1 自动化 operation 缺少证据、证据缺少复核元数据、缺少必需 API/DB/audit 摘要，或证据中出现未脱敏 secret/token/authorization 内容时，验收不得通过。

仍然需要人工复核的内容包括：存在主观判断的视觉问题、真实 HDC 安全审批、backup/restore、rollback rehearsal、外部证据附件，以及尚未被自动化证据覆盖的流程。

## 7. 浏览器人工验收

建议先运行自动化浏览器验收，再使用 Codex in-app browser 或 Chromium 处理剩余的人工判断。每个失败项都要记录截图、URL、操作步骤和期望/实际结果。

### 7.1 应用外壳与导航

打开：

```text
/
```

检查：

- [ ] 首页加载正常，没有空白或崩溃。
- [ ] 侧边导航包含平台总览、参数管理、调试平台、日志分析。
- [ ] 项目和角色上下文可见。
- [ ] `/parameters`、`/parameter-review`、`/parameter-admin`、`/logs`、`/log-admin`、`/debugging`、`/node-debugging`、`/debugging-admin`、`/user-permissions` 可以打开。
- [ ] 当前角色不能访问的页面显示受控无权限状态，而不是崩溃。

通过标准：

- 核心路由可用。
- 路由切换和刷新后页面仍可操作。

### 7.2 参数管理闭环

打开：

```text
/parameters?project=aurora
```

检查：

- [ ] 参数表加载并包含 `fast_charge_current_limit_ma`。
- [ ] 搜索、风险筛选、模块筛选可用。
- [ ] 打开 `fast_charge_current_limit_ma` 参数详情。
- [ ] 详情弹窗显示近期历史和跨项目上下文。
- [ ] 加入修改草稿。
- [ ] 输入安全目标值和修改原因。
- [ ] 提交到本轮修改。
- [ ] 选择硬件 MDE、软件 MDE、软件开发并确认提交。
- [ ] 打开 `/parameter-review`。
- [ ] 找到该请求，依次推进硬件 MDE、软件 MDE、软件开发合入。
- [ ] 回到 `/parameters?project=aurora` 并刷新，确认新值持久化。
- [ ] 打开 `/parameter-admin?audit=open`，确认审计记录存在。

通过标准：

- 参数变更刷新后仍存在。
- 审批流按步骤推进。
- 合入产生审计证据。
- 高风险或写入类操作需要确认或审批。

### 7.3 参数管理后台

打开：

```text
/parameter-admin
```

检查：

- [ ] 参数库列表和治理指标加载。
- [ ] 搜索、分组、风险筛选、孤儿/未使用视图可用。
- [ ] 导入/预览入口有校验和 diff 风格反馈。
- [ ] 用户权限或治理入口可达。
- [ ] `?audit=open` 可以打开审计抽屉。
- [ ] 删除、清理或导入类操作有确认、撤销或恢复反馈。

通过标准：

- 管理后台可以完成查看、扫描、导入预览、审计和治理检查。

### 7.4 日志分析闭环

打开：

```text
/logs?project=aurora
```

使用测试文件：

```text
test-fixtures/logs/charging-foldback.log
test-fixtures/logs/unsupported.bin
```

检查：

- [ ] 上传 `charging-foldback.log`。
- [ ] 输入问题 `Why did fast charging fold back?`。
- [ ] 分析过程展示阶段进度，并最终到达 `Complete`。
- [ ] 结论包含 thermal/foldback 证据。
- [ ] 证据卡片可以定位并高亮原始日志行。
- [ ] 打开 `/log-dashboard` 和 `/log-admin`。
- [ ] 在 admin 视图找到该日志。
- [ ] 提交 helpful feedback，并确认反馈/审计证据。
- [ ] 归档该日志，确认默认 `/logs` 历史中不再显示。
- [ ] 上传 `unsupported.bin`。
- [ ] 不支持格式进入 `Failed`，并显示可读失败原因。

通过标准：

- 支持格式能完成分析并展示证据链。
- 不支持格式失败明确。
- 反馈和归档可追踪。

### 7.5 调试模拟器闭环

打开：

```text
/node-debugging?project=aurora
```

检查：

- [ ] `Aurora Simulator 1` 在线。
- [ ] `Fast charge current` 读数为 `3000`。
- [ ] 写入安全目标值，例如 `3100`。
- [ ] 回读确认新值。
- [ ] `Cycle count` 为只读，UI 不允许写入。
- [ ] 对 `Readback mismatch probe` 写入 `2`。
- [ ] UI 报告 readback mismatch。
- [ ] 通过 `/debugging` 的回滚入口回滚；如果 UI 未暴露快照，则通过后端 rollback API 验证，并记录 UI gap。
- [ ] 重新打开 `/node-debugging?project=aurora`，确认 `Fast charge current` 恢复到 `3000`。
- [ ] 在 `/parameter-admin?audit=open` 确认调试写入和回滚审计。

通过标准：

- simulator 的读、写、回读、mismatch、rollback 全部可追踪。
- 只读参数不能写。
- 写入和回滚产生审计证据。

### 7.6 HDC 真实设备验收

只有接入真实 HDC 设备并获得安全写入值后才执行。

需要变量：

```text
DEBUG_DEVICE_GATEWAY_MODE=hdc
HDC_DEVICE_LAB_AVAILABLE=true
HDC_SMOKE_PROJECT_ID=
HDC_SMOKE_DEVICE_ID=
HDC_SMOKE_TARGET_REF=
HDC_SMOKE_PARAMETER_ID=
HDC_SMOKE_NODE_PATH=
HDC_SMOKE_WRITE_VALUE=
HDC_SMOKE_EXPECT_READ_PATTERN=
```

运行：

```bash
npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts
```

检查：

- [ ] HDC target detection 成功。
- [ ] 节点读取成功。
- [ ] 节点写入成功，并回读验证。
- [ ] 快照回滚恢复旧值。
- [ ] timeout/offline、stderr/nonzero、readback mismatch 行为已验证，或明确记录为仍待设备实验室补证。

通过标准：

- 真实硬件读写和回滚成功。
- 写入节点被恢复。
- 没有真实硬件证据时，不勾选 HDC 完成项。

### 7.7 ADB 真实设备验收

仅当本机 ADB 设备连接在 API 主机上，且所选节点已按目标模式审批后运行。默认模式为只读。只能使用已有且启用的 ADB 参数绑定；本 lab 不得创建或变更参数绑定。生成的 operation evidence 会脱敏并记录 shape、状态和一致性摘要；原始 target、node 和 value 输入只保留在操作者 shell。

只读模式必需变量：

```text
DEBUG_DEVICE_GATEWAY_MODE=adb
ADB_DEVICE_LAB_AVAILABLE=true
ADB_SMOKE_PROJECT_ID=
ADB_SMOKE_DEVICE_ID=
ADB_SMOKE_TARGET_REF=
ADB_SMOKE_PARAMETER_ID=
ADB_SMOKE_NODE_PATH=
ADB_SMOKE_EXPECT_READ_PATTERN=
```

运行：

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

检查：

- [ ] ADB target detection 通过后端 gateway 成功。
- [ ] `/node-debugging` 在 API 模式下可以切换到 ADB。
- [ ] 节点读取通过 WiseEff API 成功。
- [ ] 可选写入模式要么明确跳过，要么记录写入、回读、回滚和最终恢复证据。
- [ ] 生成的 operation evidence 只记录 shape、状态和一致性摘要，不记录原始 node path 或原始读写值。

通过标准：

- 本机 ADB 证据已采集并保持只读默认安全边界。
- 写入模式只在明确审批后运行，并验证回读、回滚和最终恢复。
- 本机 ADB 证据只作为 HDC 和目标环境证据的补充，不能替代完整 pilot-ready HDC 签核。

### 7.8 Agent 协同闭环

打开：

```text
/parameters
```

检查：

- [ ] 打开 WiseAgent。
- [ ] Agent 面板显示当前业务上下文。
- [ ] 触发只读建议或总结。
- [ ] 触发需要审批的操作，例如创建参数草稿。
- [ ] 写入类工具执行前出现审批弹窗。
- [ ] 拒绝审批后状态不变。
- [ ] 批准审批后工具执行，并有 trace/audit 证据。
- [ ] live provider 模式下，provider trace 包含 provider、model/prompt version、latency、token usage 或等价元数据、safety status、fallback reason。

通过标准：

- Agent 能基于真实上下文总结或建议。
- 变更类工具必须经人工批准。
- provider 和 tool-call 可追踪。

### 7.9 权限与用户治理

打开：

```text
/user-permissions
```

检查：

- [ ] 用户列表加载。
- [ ] 角色和启用状态可见。
- [ ] 角色变化影响受保护页面访问。
- [ ] inactive user 不能执行受保护操作。
- [ ] 系统不会被操作成没有 active admin。
- [ ] 权限变化有审计证据，若当前实现提供该路径。

通过标准：

- UI 和 API mode 权限表现一致。
- 未授权角色无法执行特权操作。

## 8. API 与 smoke 验收

浏览器检查后运行：

```bash
npm run test:e2e -- e2e/parameter-management.api.spec.ts
npm run test:e2e -- e2e/log-analysis.api.spec.ts
npm run test:e2e -- e2e/debugging.api.spec.ts
npm run test:e2e -- e2e/agent.api.spec.ts
npm run acceptance:browser
npm run acceptance:a11y
npm run acceptance:visual
npm run acceptance:responsive
npm run smoke:m5
```

通过标准：

- API-mode E2E 通过。
- HDC 项只有在明确不在范围内时才允许 skip。
- UI-facing 候选版本的 accessibility、visual 和 responsive 质量门禁通过。
- 严格 `npm run smoke:m5` 只有在 live API 和所有 pilot gate 就绪时才应通过。
- 非 HDC 目标环境验收必须明确 HDC skipped 或 absent，并记录“不能宣称完整 pilot-ready”。

## 9. 备份恢复验收

按 [备份恢复手册](../runbooks/backup-restore.md) 执行。

检查：

- [ ] PostgreSQL backup 完成。
- [ ] 对象存储 backup/snapshot 完成。
- [ ] restore 到干净环境完成。
- [ ] restore 后 API 和 worker 可启动。
- [ ] restore 环境健康检查通过。
- [ ] `npm run smoke:m5` 通过，或非 HDC smoke 仅剩 HDC blocker。
- [ ] `M5_BACKUP_RESTORE_DRILL_AT` 只在 restore 验证通过后设置。
- [ ] 证据写入 [M5 验收证据](../generated/m5-pilot-acceptance.md)。

通过标准：

- restore 在干净目标中被真实证明。
- 数据库记录和对象存储对象保持一致。

## 10. 回滚验收

按 [回滚手册](../runbooks/rollback.md) 执行。

检查：

- [ ] 起始 commit 和候选 commit 已记录。
- [ ] 候选部署初始 smoke 通过。
- [ ] 选择安全回滚触发条件。
- [ ] 新写入被停止或阻断。
- [ ] worker 被 drain 或停止。
- [ ] 流量从候选部署移除。
- [ ] 恢复上一版 API/web artifact，或执行平台批准的 rollback。
- [ ] 如数据发生变化，执行数据库/对象存储恢复。
- [ ] 回滚后 smoke 通过。
- [ ] 证据写入 [M5 验收证据](../generated/m5-pilot-acceptance.md)。

通过标准：

- 运维人员能从候选部署回到已知可用状态。
- 回滚后 readiness 和审计行为仍一致。

## 11. 证据记录模板

将以下内容追加到 [M5 验收证据](../generated/m5-pilot-acceptance.md) 或外部验收记录：

```markdown
## Manual Acceptance Evidence

Date:
Reviewer:
Environment:
Branch:
Commit:
Frontend URL:
API URL:

### Commands

- `npm run docs:check`:
- `npm run contract:check`:
- `npm run test:all`:
- `npm run build`:
- `npm run smoke:m5`:

### Browser Workflows

- Shell/navigation:
- Parameter management:
- Parameter admin:
- Log analysis:
- Debugging simulator:
- HDC device lab:
- ADB device lab:
- Agent:
- Permissions:

### Operations

- Health/readiness:
- Backup/restore:
- Rollback:
- Agent provider:
- Object storage:
- Worker:

### Blockers

-

### Final Outcome

- 本地人工验收通过 / 非 HDC 目标环境验收通过 / 完整 pilot-ready 验收通过 / No-Go
```

## 12. Go / No-Go 规则

本地开发或演示 Go：

- 本地 API-mode 工作流通过。
- 本地 PostgreSQL 和对象存储通过。
- simulator 调试明确标注为 simulator evidence。
- 核心浏览器路径没有阻塞级崩溃。

非 HDC 目标环境 Go：

- 目标环境 API、前端、数据库、worker、对象存储、live Agent、backup/restore、rollback 均通过。
- HDC 是唯一明确剩余 blocker。
- 验收记录明确写明不宣称完整 pilot-ready。

完整 pilot-ready Go：

- 严格 `npm run smoke:m5` 在目标 live API 上通过。
- `/api/v1/operations/pilot-readiness` 返回 `status: "pilot_ready"`。
- HDC device-lab 证据已附。
- backup/restore 证据已附。
- rollback rehearsal 证据已附。
- live Agent provider 证据已附。
- 目标环境 object-store 和 worker readiness 已证明。
- [M5 验收证据](../generated/m5-pilot-acceptance.md) 中没有不真实的勾选项。

No-Go：

- 核心产品路径崩溃或丢失持久化状态。
- production-auth 下未带有效 token 的请求能通过。
- Agent 或设备写入绕过审批。
- 日志上传或分析无法到达终态。
- 调试写入没有快照或审计。
- restore 或 rollback 无法演示。
- 被宣称完成的 gate 没有证据。

## 13. 当前已知注意事项

截至 2026-05-30，文档中仍记录以下关键缺口：

- 完整 target/staging evidence 尚未闭环。
- HDC device-lab 证据缺失，除非本次验收接入真实设备并完成检查。
- deployment rollback rehearsal 证据仍需要补齐。
- 前端 production-auth API mode 还需要 bearer-token 注入路径，才能闭合 production-auth UI E2E。
- cloud S3/OSS 证据不同于本地对象存储证据；除非目标环境明确批准本地对象存储策略。

验收记录应保留这些 caveat。准确的 No-Go 和 blocker 清单，比模糊的 Go 更有价值。
