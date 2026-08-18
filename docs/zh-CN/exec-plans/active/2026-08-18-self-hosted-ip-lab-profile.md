# 自托管 IP 实验室 Profile

> English: [English](../../../exec-plans/active/2026-08-18-self-hosted-ip-lab-profile.md)

**目标：** 让操作员能在只有 IP、没有域名的基础 Ubuntu 主机上部署 WiseEff，而不用手填一份 ACME `.env`，也不再猜测如何让种子数据对管理员可见。

**架构：** 在现有 M6 DNS/ACME compose 栈旁增加可叠加的 `ip-lab` profile。复用 postgres、redis、minio、api、worker、web、proxy。通过 `WISEEFF_CADDYFILE` 选择 Caddyfile。生成 URL 安全且已展开的密钥。默认 HTTP，可选 Caddy `tls internal`。provision 导入 M0–M3，并把实验室管理员放到 `org-chargelab`。确定性 LLM 开关避免未填 live key 时 `/health/ready` 直接 503。

**技术栈：** Docker Compose、Caddy、bash 部署脚本（服务器不必装 Node）、TypeScript init/preflight/provision 与 Vitest。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在从最新 `main` 检出的 `cursor/selfhost-ip-lab-profile-24de` 上提交 |
| 实现代理 | 不得 push `main`、合并或改写已发布历史 |
| 父代理 / cloud 会话 | 评审、开/更新 GitHub PR，批准后合并 |

分支：`cursor/selfhost-ip-lab-profile-24de`。一计划一支。

## 范围

范围内：

- 仅 HTTP 的 Caddyfile，以及可选 `tls internal` Caddyfile。
- 生成已展开 `DATABASE_URL` / 对象存储密钥的 `.env`。
- 实验室 profile 启动前校验。
- 一键 `deploy-ip-lab.sh`，以及已有 `npm ci` 机器上的 Node 辅助命令。
- 导入种子并把实验室管理员挂到 ChargeLab（`admin` + `platform-admin`）。
- 中英操作文档与 metadata 门禁。

范围外：

- 为干净 Ubuntu 安装 Docker。
- Let's Encrypt / 公网域名。
- OIDC / Keycloak。
- 备份演练挂载、可观测性 compose 服务，或试点就绪宣称。
- 在 `NODE_ENV=production` 上写入共享演示密码 `WiseEff-Dev!`。

## 成功标准

- 服务器文档入口是 `./scripts/deploy-ip-lab.sh --ip <addr>`。
- 预检会挡住未展开密钥、ACME Caddyfile、缺失确定性 LLM 开关，或 `AUTH_PROVIDER!=local`。
- 即使 M0 种子已经创建了另一个 admin，仍能创建 ChargeLab 实验室管理员。
- `npm run selfhost:check` 与 IP lab 单测通过。
- 现有 DNS/ACME `.env.example` + `Caddyfile.example` 路径仍然可用。

## 文档影响矩阵

| 区域 | 状态 | 文件 | 说明 |
| --- | --- | --- | --- |
| 仓库地图 | Update | `README.md`、`docs/runbooks/README.md` | 把无域名主机指到实验室 profile。 |
| 规划文档 | Update | 本计划、`docs/PLANS.md`、路线图 | 活跃计划与索引。 |
| 产品规格 | No change | `docs/product-specs/` | 无产品工作流变化。 |
| 架构文档 | Update | `ARCHITECTURE.md`、`deployment-operations.md` | 记录实验室环境。 |
| 质量/测试 | Update | 验证矩阵、环境变量 | 新命令与新变量。 |
| 可靠性/runbook | Update | `RELIABILITY.md`、`self-hosted-runtime.md` | 实验室启动路径。 |
| 安全 | Review | `SECURITY.md` | 本地账号模型未改。 |
| 前端 | Review | `FRONTEND.md` | 现有 origin 回退仍适用。 |
| 自托管操作 | Update | `ops/self-hosted/README.md`、`ip-lab.md` | 操作入口。 |
| 中文文档 | Update | 对应 `docs/zh-CN/**` 与 `*.zh-CN.md` | 双语成对。 |

## 文档更新门禁

- 本计划移入 `completed/` 前必须 `npm run docs:check` 通过。
- 上述 Update/Review 行已在本分支更新，或在此记录为不变：`SECURITY.md` 与 `FRONTEND.md` 因鉴权模型和 UI 行为未变而不改；`AGENTS.md` 因已指向 `ops/self-hosted/` 而不改。
- 延期：真实 Ubuntu 目标机 smoke（既有 TD-022）。Docker 安装自动化仍属范围外。

## UI 交互自动化审查

无用户可见交互行为变化。登录、种子可见性和 API origin 仍走既有本地账号与 production origin 回退路径。不新增验收需求或操作 ID。
