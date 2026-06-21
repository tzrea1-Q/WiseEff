# WiseEff 项目入口

> English: [English](../../../README.md)

WiseEff 是一个面向企业工程效率的 AI 辅助平台原型。当前仓库包含前端原型、API 运行时、模块化后端、数据库迁移、合同检查、身份与审计边界、日志 worker、对象存储、持久队列、设备网关、Agent provider 和试点/发布就绪门禁。

## 当前状态

- 本仓库适合本地开发、API 模式验证、自托管基线验证，以及受控 staging / pilot evidence collection。
- 不能仅凭本地检查宣称生产就绪、试点就绪或发布就绪。
- 真实目标环境结论必须有对应证据，例如 live API、PostgreSQL-backed E2E、HDC device-lab、backup/restore、rollback、identity、queue、observability、capacity 和 live Agent provider evidence。

## 快速启动

```bash
npm ci
copy .env.example .env
npm run dev:all
```

常用命令：

```bash
npm run dev
npm run dev:api
npm test
npm run test:server
npm run test:all
npm run build
npm run docs:check
npm run queue:check -- --base-url http://127.0.0.1:8787
npm run selfhost:check
npm run observability:check
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
