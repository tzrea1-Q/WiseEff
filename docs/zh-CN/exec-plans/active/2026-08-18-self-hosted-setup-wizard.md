# 自托管配置向导

> English: [English](../../../exec-plans/active/2026-08-18-self-hosted-setup-wizard.md)

**目标：** 给自托管操作员一条终端向导：只问人必须决定的项，其余自动生成；之后可以只改其中一段，而不重写整份 `.env`。同一套答案必须能用 flag 表达，供脚本和 CI 使用。

**状态：** 正在 `cursor/selfhost-setup-wizard-24de` 上实现。叠在 IP 实验室 profile（PR #534，tip `64e12237`）之上。

**架构：** 只借鉴 OpenClaw / Hermes 的**向导架构**，不照搬它们的个人 Agent 产品。WiseEff 仍然是 Docker Compose 栈。把安装（宿主机前置）、配置（答案 → 渲染 `.env` → 启动前校验 → 拉起 → provision）、诊断（修复）分开。TypeScript 渲染器是唯一真相。bash 入口负责提问和编排，以便服务器不必装 Node。

**技术栈：** bash 终端提问、现有 Compose / Caddy profile、TypeScript 答案模型 + env 渲染 + Vitest；Ubuntu 上自动装 Docker 留到更后阶段。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在 IP 实验室 profile 可用之后，从最新 `main` 检出 `cursor/selfhost-setup-wizard-24de` 并提交 |
| 实现代理 | 不得 push `main`、合并或改写已发布历史 |
| 父代理 / cloud 会话 | 评审、开/更新 GitHub PR，批准后合并 |

本次仅设计，分支为 `cursor/selfhost-setup-wizard-plan-24de`。实现阶段一计划一支。

## 前置条件

实现分支上必须已有无域名 IP 实验室 profile：

- `ops/self-hosted/scripts/deploy-ip-lab.sh`
- `ops/self-hosted/scripts/ip-lab-profile.ts`（`render` / `evaluate`）
- `Caddyfile.ip-lab`、`Caddyfile.ip-lab-tls`、能把管理员挂到 ChargeLab 的 provision

若 #534 尚未合入，先 rebase 或 cherry-pick 再写向导。不要在向导里重做密钥生成或种子挂载。

## 调研：OpenClaw 与 Hermes 怎么做

2026-08-18 审阅的来源：

- OpenClaw：[install](https://docs.openclaw.ai/install)、[CLI onboarding](https://docs.openclaw.ai/start/wizard)、[`openclaw setup`](https://docs.openclaw.ai/cli/setup)、[CLI automation](https://docs.openclaw.ai/start/wizard-cli-automation)
- Hermes：[quickstart](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart)、[installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation)、托管 `install.sh`、`main` 上的 `hermes_cli/setup.py`

### 共同模式

两者都把**安装**、**配置**、**修复**拆开：

| 层 | OpenClaw | Hermes | 含义 |
| --- | --- | --- | --- |
| 安装 | `curl …/install.sh` 装 Node + CLI；`--no-onboard` 到此为止 | `curl …/install.sh` 装 uv/Python/Node/ripgrep、clone、写入 `hermes`；`--skip-setup` 到此为止 | 只处理宿主机前置 |
| 配置 | `openclaw onboard`（全新机器上裸 `openclaw setup` 会落到这里） | `hermes setup` | 收集选择、落盘、启动运行时 |
| 修复 | `openclaw doctor`、`openclaw configure --section …` | `hermes doctor`、`hermes setup <section>`、`hermes config get/set` | 改一段或诊断，不整份擦除 |

交互规则也一致：

1. **首次用模式，而不是一张超长表单。** OpenClaw 有 Guided（探测 + 真实补全）和 classic 的 QuickStart / Manual / Import。Hermes 有 Quick（Nous Portal）/ Full / Blank Slate。
2. **分段可独立跑，函数同一套。** Hermes 的 `SETUP_SECTIONS` 是 `(key, label, fn)` 列表。`hermes setup model` 调用的就是 Full Setup 里的 `setup_model_provider`。OpenClaw 事后改配置走 `configure --section` 或对话里的 `configure …`，不另写一套。
3. **已有配置默认保留。** 重跑不 wipe。OpenClaw 清除要用 `--reset` / `--reset-scope full`，不是菜单默认项。Hermes 对已有安装重跑 Full，当前值当默认；`--reset` 显式，且先备份 `.yaml.bak.<timestamp>`。
4. **TTY 与自动化是两份契约。** 没有 TTY 就不要 `read`。`--json` 只是输出格式，不等于非交互。脚本必须传 `--non-interactive`（OpenClaw 还要 `--accept-risk`）。每个问题都有对应 flag。
5. **密钥掩码输入，其余尽量生成。** 交互式 API key 用隐藏输入。回环 token、端口、workspace、工具默认值自动填。Hermes 把密钥放 `~/.hermes/.env`，非密钥放 `config.yaml`。
6. **先 doctor 再加功能。** Hermes 恢复顺序是 doctor → model → setup。OpenClaw 遇到无效配置会停，先让跑 `doctor`。
7. **文案可本地化，键名不行。** OpenClaw 用 `OPENCLAW_LOCALE` / `LANG` 本地化向导句子（`en`、`zh-CN`、`zh-TW`）。命令、配置键、URL、ID 保持英文。

OpenClaw 值得留下的点：

- Guided 用**真实补全**验证推理，只持久化验证过的路由。复查失败时绝不悄悄换掉已保存的模型。
- Classic 最后一步启动 Gateway 并做可达性检查。
- 探测到其他产品时，Import / migrate 是一等公民。

Hermes 值得留下的点：

- 安装器能识别 `curl | bash`（stdin 不是 TTY），避免 `read -p`，防止 `set -e` 遇到 EOF 直接退出。
- Linux 以 root 安装时走 FHS（`/usr/local/lib/…` + `/usr/local/bin/hermes`）；数据仍在 `$HERMES_HOME`。
- `hermes update` 能区分 git / Docker / Nix，并打印对应更新命令。
- Blank Slate **钉死**最小表面，后续更新不会把功能偷偷加回来。这对 WiseEff 的实验室 / ACME / 日后 OIDC 也成立：要显式 profile，而不是「复制 100 行示例再碰运气」。

### 不要照搬的部分

WiseEff 是多容器企业应用，不是个人 Agent CLI。不要复制：

- 频道、skills、守护进程安装、Tailscale、OAuth 门户，或推理门禁之后的对话式配置。
- 把公开 `curl | bash` CDN 安装器当第一交付（没有签名发布地址；操作员本来就会 clone 本仓库）。
- 仅仅为了跑向导，就要求 Ubuntu 宿主机装全局 Node/Python。WiseEff 的运行时是 Docker。
- 让操作员手填 postgres / minio / redis / compose 内部地址。

## 当前 WiseEff 缺口

现在操作员仍是下面两条路之一：

- 手改 `ops/self-hosted/.env.example`（ACME / DNS，100 多行，`DATABASE_URL` 还靠插值）。
- 调用 `deploy-ip-lab.sh --ip …`（几乎全靠 flag，几乎无 TTY，只覆盖 IP 实验室）。

相对 OpenClaw / Hermes 缺的是：

- 有 TTY 时会提问的单一入口。
- Quick / Full / 保留已有配置。
- 分段重配（`setup access`、`setup llm`），不重写密钥。
- 用操作员语言说话的 `doctor`（profile、URL、管理员、LLM、compose 健康、`/health/ready`）。
- 与向导同一代码路径的非交互契约。
- 更后阶段可选：在裸 Ubuntu 上安装 Docker。

## 设计

### 命令形态

服务器路径（宿主机不必有 Node）：

```bash
cd ops/self-hosted
./scripts/setup.sh                 # TTY 向导，或使用 flag
./scripts/setup.sh access          # 只跑一段
./scripts/setup.sh llm
./scripts/doctor.sh
```

无提示的同一套答案：

```bash
./scripts/setup.sh --non-interactive \
  --profile ip-lab \
  --tls-mode http \
  --ip 203.0.113.10 \
  --admin-username admin.ops \
  --seed chargelab \
  --llm skip
```

已经 `npm ci` 的机器：

```bash
npm run selfhost:setup
npm run selfhost:doctor
```

`deploy-ip-lab.sh` 保留为兼容包装，内部调用 `setup.sh --non-interactive --profile ip-lab …`。不要再养第二套 env 渲染器。

`--json` 打印机器可读摘要。它**不会**关闭提问。

### 首次运行模式

| 模式 | 默认出现时机 | 做什么 |
| --- | --- | --- |
| **Quick（推荐）** | 没有 `.env`，且有 TTY | IP 实验室 + HTTP + 探测到的主机 + 生成管理员密码 + ChargeLab 种子 + 确定性 LLM |
| **Full** | 操作员主动选 | 与 Quick 相同的各段，再加上 TLS 选择（HTTP / `tls internal` / ACME）、可选 live LLM 密钥、可选跳过种子 |
| **Keep existing** | 已有 `.env` | 默认。展示 profile、公网 URL、管理员用户名（不展示密码）。继续做启动前校验 / 拉起 / provision。 |
| **只跑一段** | `setup.sh <section>` | 重跑一段；保留已生成密钥。 |

没有「关掉产品模块」的 Blank Slate。WiseEff 的 profile 已经在钉表面（`ip-lab` 对 ACME）。不要再发明第三种空 compose。

只有 `--force` / `--reset` 可以重新生成 postgres/minio 密码。对已有文件跑交互式 Full 时必须说明：这会让当前数据库 volume 对不上新密码。

### 分段（Quick、Full、以及之后的 `setup.sh <section>` 共用函数）

| 段 | 键 | 询问 | 写入 / 推导 |
| --- | --- | --- | --- |
| `profile` | 部署 profile | IP 实验室，或域名 + Let's Encrypt | `WISEEFF_DEPLOY_PROFILE`，以及默认 TLS/Caddyfile |
| `access` | 对外入口 | IP 或主机名；TLS 模式；仅 Let's Encrypt 时要 ACME 邮箱 | `WISEEFF_SITE_HOST`、`WISEEFF_TLS_MODE`、`WISEEFF_TLS_EMAIL`、`WISEEFF_PUBLIC_URL`、`WISEEFF_CADDYFILE`、API/VITE/bridge 公网 URL |
| `admin` | 首位操作员 | 用户名；密码（空则生成）；显示名 | `WISEEFF_LAB_ADMIN_*`；`AUTH_PROVIDER=local` |
| `seed` | 演示数据 | ChargeLab 种子或空库 | provision 开关，不是一大段 env |
| `llm` | 模型接入 | 跳过 / 小泽 / 小泽 + 日志分析 | `XIAOZE_LLM_API_BASE_URL` / `XIAOZE_LLM_MODEL` / `XIAOZE_LLM_API_KEY`、`LOG_ANALYSIS_*`、确定性开关 |

OIDC、备份挂载、可观测 compose、Device Bridge 配对不进 v1。Full Setup 可以把它们标成「以后再做，本向导不管」。

### 问什么、生成什么

**要问（人必须决定）：**

- profile、主机、TLS 模式、ACME 邮箱。
- 管理员用户名 / 密码 / 显示名。
- 是否导入种子。
- LLM 跳过，或 OpenAI 兼容的 base URL + model + API key（小泽，可选日志分析）。

**生成，且永远不问：**

- `POSTGRES_PASSWORD`、`MINIO_ROOT_PASSWORD`、已展开的 `DATABASE_URL`（不要留下 `${POSTGRES_PASSWORD}`）。
- Redis URL、队列前缀、内部 MinIO 地址、对象存储 path-style 开关。
- smoke / identity bearer 占位（留空）。
- 备份/恢复模板路径（保留示例，不要提问）。
- 跳过 LLM 时写 `XIAOZE_DETERMINISTIC=true` 和 `LOG_ANALYSIS_DETERMINISTIC=true`，避免 `/health/ready` 直接 503。

**探测后当作默认值：**

- `hostname -I` 或 `ip route get` 得到的第一块 IPv4。
- 重跑时已有 `.env` 的值。
- 是否已有 Docker / Compose（doctor 与 setup 启动前校验）。没有 Docker 时不要去问 postgres；打印安装提示后退出。

### 三层实现

```text
TTY / flags / 答案文件
        │
        ▼
 SelfHostAnswers   （只有人做的决定）
        │
        ▼
 renderSelfHostEnv （推广 ip-lab-profile.ts）
        │
        ▼
 ops/self-hosted/.env  →  evaluate  →  compose up  →  provision
```

1. **答案模型**用 TypeScript（`SelfHostAnswers`）。bash 可以写一份很小的 `ops/self-hosted/.setup-answers.env`（除操作员亲手输入的密钥外不要放秘密）。答案文件不是运行时配置。
2. **渲染器 + 校验器**留在 TypeScript。把 `ip-lab-profile.ts` 扩成按 profile 分支的模块，不要再写第二份 bash `cat > .env`。ACME profile 必须像 IP 实验室一样展开 `DATABASE_URL`。
3. **向导 / doctor** 要薄。服务器上优先 bash `select` / `read -s`。若已有 Node，`npm run selfhost:setup` 复用同一答案类型。不要把提问逻辑叉成两套互不兼容的 UI；Ubuntu 宿主机以 bash 为准，TypeScript 测试 answers→env 映射。

宿主机有 Docker 但没有 Node 时，渲染应走一次性容器（`node:22-alpine`，或镜像构建完成后的 API 镜像）读答案并写 `.env`。happy path 不要求服务器上 `npm ci`。

### 交互流程（Quick）

1. 确认这是实验室 / 自托管主机，不声称商用试点就绪。
2. 探测 Docker、磁盘、候选 IP。没有 Docker 则失败并给出安装提示（P1 不负责安装 Docker）。
3. 若已有 `.env` → 默认保留；或进入分段菜单；或 `--force` 重新生成。
4. 否则 Quick 默认：`ip-lab` + `http` + 探测到的 IP + `admin.ops` + 生成密码 + ChargeLab 种子 + 跳过 LLM。
5. 复核屏（profile、URL、用户名、密码只显示一次、种子、LLM 模式）。确认。
6. 渲染 `.env`、启动前校验、`compose up`、provision，打印登录 URL 和 doctor 提示。

Full 在复核屏之前插入 TLS 和 LLM 问题。对 `XIAOZE_LLM_API_BASE_URL`、`XIAOZE_LLM_MODEL`、`XIAOZE_LLM_API_KEY` 做真实补全探测属于 P2，且不得挡住跳过路径。

### 非交互契约

- 缺必填 flag 且没有 TTY → 以退出码 2 打印 flag 列表。绝不卡在 `read`。
- `--non-interactive` 不等于 `--force`。
- 重新生成密钥必须带 `--force`。
- `--json` 可与两种模式组合。

### Doctor

`./scripts/doctor.sh`（以及 `npm run selfhost:doctor`）只报告，不默默修复：

- profile / Caddyfile / 公网 URL 是否一致。
- 密钥是否已展开（`DATABASE_URL` 仍含 `${…}` 则失败）。
- 实验室要求 `AUTH_PROVIDER=local`；v1 的 ACME 仍可以是 local。
- 密钥为空时确定性 LLM 开关是否打开。
- `docker compose ps` 与 HTTP `/health/live`。
- `/health/ready` 作为信息项（跳过 LLM 必须 ready；live LLM 配错时要指出缺的是哪一族变量）。

v1 除「改完 `access` 后重写派生 URL」外不做 `--fix`。修复走 `setup.sh <section>`。

### 语言

向导句子可以跟 `WISEEFF_SETUP_LOCALE` / `LANG`（`en`、`zh-CN`）。命令名、环境变量、URL、profile id 保持英文。这与 OpenClaw 以及本仓库 bilingual-docs 规则一致。

## 范围

实现范围内（本设计被接受之后）：

- P1：TTY `setup.sh` + IP 实验室 Quick/Full 与 ACME Full 的 flag 路径；复核屏；保留已有配置；复用 ChargeLab provision；answers→env 测试；中英操作入口。
- P2：`setup.sh <section>`、`doctor.sh`、可选 live LLM 探测、把 `deploy-ip-lab.sh` 收成包装。
- 文档 + 新脚本的 `selfhost:check` token。

范围外：

- 公开托管的 `curl | bash` 安装器。
- Ubuntu Docker 安装器（P3 / 更后；裸机仍有缺口，但不挡向导落地）。
- OIDC / Keycloak 向导（M6.2）。
- 备份卷挂载、可观测 compose、预构建镜像、试点就绪声明。
- 对话式 LLM 配置。
- 在 `NODE_ENV=production` 写入共享的 `WiseEff-Dev!`。

## 成功标准

- 有 TTY 时 `./scripts/setup.sh` 能生成可工作的 IP 实验室 `.env`，操作员不用手改密钥。
- `--non-interactive --profile ip-lab --ip <addr>` 的结果与今天的 `deploy-ip-lab.sh` 一致（已展开密钥、ChargeLab 管理员、确定性 LLM）。
- 不带 `--force` 重跑时保留 postgres/minio 密码。
- ACME 路径询问主机名和邮箱，并且同样展开密钥。
- `setup.sh llm` 可以后补密钥，而不重新生成数据库密码。
- `npm run test:scripts` 覆盖答案解析、渲染和 evaluate。
- `npm run selfhost:check` 与 `npm run docs:check` 通过。
- 现有 ACME `Caddyfile.example` 路径仍然可用。

## 实现任务

设计（本次变更）：

- [x] 调研 OpenClaw 与 Hermes 的安装 / 配置 / doctor 行为。
- [x] 写本计划及英文对照页。
- [x] 从 `docs/PLANS.md` 与路线图挂上本计划。

实现（本分支）：

- [x] `SelfHostAnswers` + 按 profile 分支的渲染 / 校验测试。
- [x] `ops/self-hosted/scripts/setup.sh` 的 TTY 与 `--non-interactive`。
- [x] 带已展开 `DATABASE_URL` 的 ACME 渲染路径。
- [x] 分段命令 + doctor。
- [x] `deploy-ip-lab.sh` 兼容包装。
- [x] 中英操作文档与 metadata 门禁。

## 验证

仅设计：

```bash
npm run docs:check
```

实现之后：

```bash
npm run test:scripts -- ops/self-hosted/scripts/
npm run selfhost:check
npm run docs:check
```

P1 建议补目标 Ubuntu TTY 证据，但不是合入阻断项——只要单元测试覆盖 answers→env，且 IP 实验室 provision 测试仍通过。

## 文档影响矩阵

| 区域 | 状态 | 文件 | 说明 |
| --- | --- | --- | --- |
| 仓库地图 | Review | `README.md`、`docs/README.md`、`AGENTS.md` | 实现阶段会把操作员指到 `setup.sh`。仅设计：不改。 |
| 计划文档 | Update | 本计划、`docs/PLANS.md`、`docs/exec-plans/active/development-roadmap.md` | 活跃计划 + 索引。 |
| 产品规格 | No change | `docs/product-specs/` | 操作员工具，不是产品工作流。 |
| 架构文档 | Review | `ARCHITECTURE.md`、`docs/design-docs/deployment-operations.md` | 实现阶段把向导记成自托管入口。 |
| 质量 / 测试 | Review | `docs/developer/verification-matrix.md`、`docs/developer/environment-variables.md` | 新命令；除 profile 答案外无新业务 env。 |
| 可靠性 / runbook | Review | `docs/RELIABILITY.md`、`docs/runbooks/self-hosted-runtime.md` | 实现阶段更新启动路径。 |
| 安全 / 治理 | Review | `docs/SECURITY.md`、`docs/security/secrets-management.md` | 生成密钥 + 掩码输入；无新授权模型。 |
| 前端 / 设计 | No change | `docs/FRONTEND.md` | 无 UI 变更。 |
| 生成物 | No change | | |
| 参考页 | No change | | |
| 自托管运维 | Review | `ops/self-hosted/README.md`、`ops/self-hosted/ip-lab.md` | 实现阶段增加向导入口；IP 实验室文档仍是 profile 契约。 |
| 中文开发者文档 | Update | 本计划改过的每一份英文页的 `docs/zh-CN/**` 对照页 | 必填双语对。 |

## 文档更新门禁

- 仅设计合入：`npm run docs:check` 必须通过；计划索引与中英计划文件必须存在。
- 本计划在 P1 成功标准通过、且上表每条 Update/Review 已更新或有「未改」证据之前，不得移入 `completed/`。
- 推迟：Ubuntu Docker 安装器（P3）、真实目标机 TTY 记录（TD-022 一类）、OIDC 段（M6.2）。

## UI 交互自动化审查

无面向用户的产品交互变更。登录、种子可见性、API origin 解析仍走现有本地账号与生产 origin 回退。不新增验收需求或操作 ID。
