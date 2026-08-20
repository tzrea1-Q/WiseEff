# 自托管 IP 实验室 Profile

> English: [English](ip-lab.md)

这个 profile 面向**只有 IP、没有域名**的单台 Ubuntu（或同类）主机。它会生成密钥、用 HTTP（或 Caddy 自签证书）对外提供 WiseEff、创建本地管理员，并导入 ChargeLab 演示数据，且让该管理员能直接看到这些数据。

这是 **实验室 / 演示** 路径。它不取代 `.env.example` 里的 DNS + Let's Encrypt profile，也不能当作商业试点或发布就绪证据。

## 前置条件

- Docker Engine 20.10+，以及 Compose v2 或独立 `docker-compose` 1.28+。
- 浏览器能访问主机的 `80` 端口（若使用 `--tls-mode internal`，还需要 `443`）。
- 首次构建镜像建议约 4 GB 内存。镜像存在后可以更紧，但 1–2 GB 主机很容易在 `vite build` 时 OOM。
- 服务器上有本仓库的 git checkout。宿主机**不必**安装 Node.js。

若这是一台干净的 Ubuntu，先安装 Docker：https://docs.docker.com/engine/install/ubuntu/

## 一条命令

优先使用 [配置向导](setup.zh-CN.md)。IP 实验室的 flag 路径在 `ops/self-hosted/` 下仍然可用：

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh --non-interactive --ip <server-ip>
```

`deploy-ip-lab.sh --ip <server-ip>` 仍是同一命令的兼容包装。

示例：

```bash
./scripts/deploy-ip-lab.sh --ip 203.0.113.10
./scripts/deploy-ip-lab.sh --ip 203.0.113.10 --tls-mode internal
./scripts/deploy-ip-lab.sh --ip 203.0.113.10 --admin-username admin.ops --admin-password 'ReplaceWithAStrongPassword'
```

脚本会：

1. 写入 `ops/self-hosted/.env`（权限 `600`），密钥已展开，URL 为 `http://<ip>`（或 `https://<ip>`）。
2. 检查 Docker、必填项、Caddyfile 选择和内存。
3. 执行 `./scripts/compose --env-file .env up -d --build`。
4. 等待 `http://127.0.0.1/health/live`。
5. 导入 M0–M3 演示数据，并把实验室管理员放到 `org-chargelab` / ChargeLab，绑定 `admin` 与 `platform-admin`。

打开 `http://<server-ip>`，用 `.env` 里的 `WISEEFF_LAB_ADMIN_USERNAME` / `WISEEFF_LAB_ADMIN_PASSWORD` 登录。

`--tls-mode internal` 使用 Caddy 自签证书。浏览器会告警；只在你控制的主机上继续。

## 拆开执行

```bash
./scripts/deploy-ip-lab.sh --ip <server-ip> init
./scripts/deploy-ip-lab.sh preflight
./scripts/deploy-ip-lab.sh up
./scripts/deploy-ip-lab.sh provision
```

若本机已有 Node.js 22 和 `npm ci`：

```bash
npm run selfhost:ip-lab:init -- --ip <server-ip> --env-file ops/self-hosted/.env
npm run selfhost:ip-lab:preflight -- --env-file ops/self-hosted/.env
npm run selfhost:check
```

## 和 DNS / ACME Profile 的差别

| 项 | IP 实验室 | DNS / ACME profile |
| --- | --- | --- |
| 对外 URL | `http://<ip>` 或 Caddy `tls internal` | `https://<dns>` + Let's Encrypt |
| Caddyfile | `Caddyfile.ip-lab` 或 `Caddyfile.ip-lab-tls` | `Caddyfile.example` |
| 认证 | `AUTH_PROVIDER=local` | local 或 OIDC |
| LLM | 默认 `XIAOZE_DETERMINISTIC=true` 与 `LOG_ANALYSIS_DETERMINISTIC=true` | 未填 live key 时 `/health/ready` 会 503 |
| 演示数据 | 自动导入并挂到实验室管理员 | 需手工 `seed-demo-data.sh` 再迁组织 |
| 密钥 | 自动生成、URL 安全，并展开进 `DATABASE_URL` | 手工填写，且依赖 `${POSTGRES_PASSWORD}` 插值 |

若 `VITE_WISEEFF_API_BASE_URL` 变了，仍需重新构建。第一次 `up --build` 之前就把 `--ip` 设成浏览器会输入的地址。

## 范围外

- 不会替你安装 Docker。
- 没有 Let's Encrypt，也不需要公网域名。
- 没有 OIDC / Keycloak。
- 不含备份演练、自动启动可选 observability profile，或试点就绪证据。监控需另行执行 `./scripts/observability up`。
- 不会在 `NODE_ENV=production` 主机上写入众所周知的演示密码（`WiseEff-Dev!`）。
