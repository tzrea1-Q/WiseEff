# 本地开发与验证

本页是中文开发者的本地执行入口。英文详细来源见 [docs/developer/README.md](../developer/README.md)。

## 第一次启动

```bash
npm ci
copy .env.example .env
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

`.env.example` 已经准备好本地 PostgreSQL、local object store、simulator device gateway 和 production-mode smoke auth。只有 OpenAI-compatible live Agent provider 的三个值需要你填写：

```text
AGENT_API_BASE_URL=
AGENT_MODEL=
AGENT_API_KEY=
```

如果当前不验证 live provider，可以把：

```text
AGENT_PROVIDER=deterministic
```

用于稳定本地测试。

## 启动服务

API：

```bash
npm run dev:api
```

日志 worker：

```bash
npm run worker:logs
```

前端：

```bash
npm run dev
```

默认地址：

```text
API: http://127.0.0.1:8787
Web: http://127.0.0.1:5173
```

## 常用验证

文档：

```bash
npm run docs:check
git diff --check
```

前后端：

```bash
npm test
npm run test:server
npm run build
```

阶段门禁：

```bash
npm run test:m1
npm run test:m2
npm run test:m3
npm run test:m3-5
npm run test:m4
npm run smoke:m5
npm run test:m5
```

选择命令前先看 [验证矩阵](../developer/verification-matrix.md)。不要把本地 simulator、local smoke skip 或未运行的外部检查说成 pilot-ready 证据。
