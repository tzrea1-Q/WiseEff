# 自托管配置向导

> English: [English](setup.md)

这是自托管 WiseEff 主机的操作员入口。它只问人必须决定的项，自动生成密钥，并且之后可以只改一段，而不轮换数据库密码。

它**不**声称商用试点或发布就绪。

本页只负责首次安装和配置。已经运行的 checkout 请使用[自托管升级](upgrade.zh-CN.md)；不要把 `setup.sh --force` 当成升级命令，因为它会按设计轮换数据存储密钥。

## 一条命令

在 `ops/self-hosted/` 下，有终端时：

```bash
chmod +x scripts/setup.sh scripts/doctor.sh
./scripts/setup.sh
```

全新主机上的 Quick 模式会写入 IP 实验室 HTTP profile、生成管理员密码、导入 ChargeLab 演示种子，并打开确定性 LLM 开关，这样即使没有 live key，`/health/ready` 也能通过。

Full 模式还会问 TLS（HTTP、Caddy `tls internal`、或 Let's Encrypt）、是否跳过种子，以及可选的小泽 / 日志分析密钥。

## Flag（同一套答案，不提问）

```bash
./scripts/setup.sh --non-interactive \
  --profile ip-lab \
  --tls-mode http \
  --ip 203.0.113.10 \
  --admin-username admin.ops \
  --seed chargelab \
  --llm skip
```

域名 + Let's Encrypt：

```bash
./scripts/setup.sh --non-interactive \
  --profile acme \
  --host wiseeff.example.com \
  --tls-email ops@example.com \
  --seed chargelab \
  --llm skip
```

`--json` 只打印摘要，不会关闭提问。脚本必须传 `--non-interactive`。

## 以后只改一段

```bash
./scripts/setup.sh access
./scripts/setup.sh llm
./scripts/doctor.sh
```

分段更新会保留 `POSTGRES_PASSWORD` 和 MinIO 密钥。对整份配置使用 `--force` 会轮换这些密钥，当前数据库 volume 将对不上新密码。

## 兼容

`./scripts/deploy-ip-lab.sh --ip <addr>` 仍然可用。它会调用本向导并带上 `--non-interactive --profile ip-lab`。

已经 `npm ci` 的机器：

```bash
npm run selfhost:setup -- --profile ip-lab --ip <addr> --print-env
npm run selfhost:doctor -- --env-file ops/self-hosted/.env
```

向导文案跟随 `WISEEFF_SETUP_LOCALE` 或 `LANG`（`en`、`zh-CN`）。命令名、环境变量和 profile id 保持英文。

## 前置

- Docker Engine 20.10+，以及 Compose v2 或独立 `docker-compose` 1.28+。
- 本仓库的一份 git checkout。服务器不必装 Node.js。
- 首次镜像构建大约需要 4 GB 内存。

安装 Docker 仍是单独步骤：https://docs.docker.com/engine/install/ubuntu/

## 范围外

- 公开的 `curl | bash` 安装器。
- 在 Ubuntu 上代装 Docker。
- OIDC / Keycloak。
- 备份挂载、可观测 compose 服务，或试点就绪声明。
