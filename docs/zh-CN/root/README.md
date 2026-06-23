# WiseEff 项目入口

> English: [English](../../../README.md)

WiseEff 是一个面向企业工程效率的 AI 辅助平台原型。当前仓库包含前端原型、API 运行时、模块化后端、数据库迁移、合同检查、身份与审计边界、日志 worker、对象存储、持久队列、设备网关、Agent provider 和试点/发布就绪门禁。

## 当前状态

- 本仓库适合本地开发、API 模式验证、自托管基线验证，以及受控 staging / pilot evidence collection。
- 不能仅凭本地检查宣称生产就绪、试点就绪或发布就绪。
- 真实目标环境结论必须有对应证据，例如 live API、PostgreSQL-backed E2E、HDC device-lab、backup/restore、rollback、identity、queue、observability、capacity 和 live Agent provider evidence。

## 环境要求

### 开发机 / CI

- Node.js 22 LTS，或满足 Vite 7 要求的 Node 版本。
- npm 11，或兼容版本。
- Docker Engine（用于 `npm run dev:all` 本地 PostgreSQL）。

Node.js 22 官方 Linux 二进制需要 glibc 2.28 及以上。Ubuntu 18.04 等旧系统**不能**在宿主机上直接运行本仓库的 npm 脚本。

### Linux 运行服务器

服务器可以**只跑 Docker 容器**，不必安装 Node.js。应用镜像基于 `node:22-alpine` 构建。

服务器前置条件：

- Docker Engine 20.10 及以上。
- Docker Compose v2 插件，或独立 `docker-compose` 1.28 及以上。
- 反向代理开放 `80` / `443`。
- `WISEEFF_SITE_HOST` 对应 DNS 已就绪。

在服务器上使用 `ops/self-hosted/scripts/compose`；它会自动兼容 `docker compose` / `docker-compose`，并在 standalone 模式下附加 `-f compose.yaml`。

详细步骤见 [`docs/runbooks/self-hosted-runtime.md`](../../runbooks/self-hosted-runtime.md)。

## 开发机命令

在本机安装依赖并启动完整本地栈：

```bash
npm ci
copy .env.example .env
npm run dev:all
```

常用开发与验证命令：

```bash
npm run dev
npm run dev:api
npm test
npm run test:server
npm run test:all
npm run build
npm run docs:check
npm run selfhost:check
npm run observability:check
npm run queue:check -- --base-url http://127.0.0.1:8787
```

## Linux 服务器部署命令

在服务器上运行服务；开发、单测、E2E、smoke 留在另一台有 Node.js 22 的机器上执行。

```bash
cd ops/self-hosted
cp .env.example .env
chmod 600 .env
# 填写 .env 中所有 secret、OIDC、对象存储和对外 URL。
./scripts/compose --env-file .env up -d --build
./scripts/compose --env-file .env ps
./scripts/compose --env-file .env logs --tail=100 api worker proxy
```

部署注意：

- 首次 build 前把 `VITE_WISEEFF_API_BASE_URL` 设为最终对外 URL；URL 变更后需重新 `./scripts/compose ... up -d --build`。
- 不要对客户或生产数据执行 `db:seed:*`。
- 不要提交 `ops/self-hosted/.env`。

升级：

```bash
git fetch origin
git checkout <release-commit>
cd ops/self-hosted
./scripts/compose --env-file .env up -d --build
```

## 从开发机验证已部署服务器

在已有 Node.js 22 的开发机或 CI 上，对部署 URL 执行：

```bash
npm ci
npm run selfhost:check

npm run selfhost:smoke \
  -- --env-file ops/self-hosted/.env \
  --base-url https://wiseeff.example.com \
  --allow-only-blocked=deviceGateway

npm run queue:check \
  -- --env-file ops/self-hosted/.env \
  --base-url https://wiseeff.example.com
```

## 运行模式

前端默认使用 **API mode** 进行本地开发。`npm run dev` 与 `npm run dev:all` 会注入 API runtime；复制 `.env.example` 到 `.env` 可保持一致。

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

仅在需要纯前端演示、且不连接后端 API 时显式使用 mock mode：

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

生产构建不能把 mock data 当作业务数据源。后端写入必须在服务端执行 authz、validation、transaction 和 audit。

## 阅读入口

- 贡献与本地开发：[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) 和 [`docs/developer/README.md`](../../developer/README.md)
- 架构：[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) 和 [`docs/design-docs/index.md`](../../design-docs/index.md)
- API：[`docs/api/README.md`](../../api/README.md)
- 安全：[`docs/security/README.md`](../../security/README.md)
- 运行手册：[`docs/runbooks/README.md`](../../runbooks/README.md)
- 中文文档入口：[`docs/zh-CN/README.md`](../README.md)

## 双语维护规则

开发者需要人工阅读的文档必须维护为相互链接的英文版和中文版。不要把中文和英文说明混在同一篇文档中作为双语策略；命令、路径、环境变量、API 路径、角色名和状态名可以保留英文原样。
