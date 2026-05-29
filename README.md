# WiseEff

WiseEff（智效）是一个本地运行的前端原型项目，用于演示 AI 辅助的企业业务效率平台。当前项目基于 Vite、React、TypeScript 构建，采用单页应用形态，通过 mock 数据和交互状态展示参数管理、日志分析、参数调试等业务场景。

## 环境要求

- Node.js 22 LTS，或其它满足 Vite 7 要求的 Node.js 版本
- npm 11，或兼容的 npm 版本

Vite 7 要求 Node.js `^20.19.0 || >=22.12.0`。仓库中提供了 `.nvmrc`，推荐新开发机器使用 Node 22。

## 快速启动

```bash
npm ci
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
npm run dev
```

The database commands require `DATABASE_URL` to point at a local PostgreSQL database. They create the M0 foundation rows, M1 parameter-management seed data, M2 log-analysis sample records, and M3 simulator debugging catalog used by API mode and acceptance tests.

开发服务绑定到 `127.0.0.1`。启动后 Vite 会在终端输出实际访问地址，通常是：

```text
http://127.0.0.1:5173/
```

## 常用命令

```bash
npm run dev
```

启动本地 Vite 开发服务。

```bash
npm test
```

运行一次 Vitest 测试套件。

```bash
npm run test:server
```

运行 M0 后端 Node 环境测试。

```bash
npm run test:all
```

连续运行前端与后端测试。

```bash
npm run build
```

执行 TypeScript 项目检查，并将生产构建产物输出到 `dist/`。

```bash
npm run dev:api
```

启动 M0 后端 API，默认监听 `http://127.0.0.1:8787`。

```bash
npm run db:seed:m2
```

Seed the M2 log-analysis sample data. Run this after `npm run db:migrate`, `npm run db:seed:m0`, and `npm run db:seed:m1`.

```bash
npm run db:seed:m3
```

Seed the M3 simulator debugging device, detected target, and Aurora debugging parameter catalog. Run this after `npm run db:migrate`, `npm run db:seed:m0`, and `npm run db:seed:m1`.

```bash
npm run test:e2e
```

Run the API-mode Playwright smokes for M1 parameter management and M2 log analysis. This requires `DATABASE_URL`; the Playwright config starts `npm run dev:api` on port `8787` and `npm run dev` with `VITE_WISEEFF_RUNTIME_MODE=api`, `VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787`, and `OBJECT_STORE_ROOT=.wiseeff-object-store`.

```bash
npm run test:m1
```

Run the M1 verification gate: frontend tests, backend tests, production build, then the API-mode E2E smoke.

```bash
npm run test:m2
```

Run the M2 verification gate: frontend tests, backend tests, production build, then all API-mode E2E smokes. Use this before landing log-analysis MVP changes when a local PostgreSQL `DATABASE_URL` is available.

```bash
npm run test:m3
```

Run the M3 verification gate: frontend tests, backend tests, production build, then `e2e/debugging.api.spec.ts`. The smoke requires `DATABASE_URL`, seeds `db:seed:m3`, starts the API in simulator mode, reads `Aurora Simulator 1`, writes fast charge current with readback, verifies the read-only and readback-mismatch paths, rolls back the snapshot, and checks debugging audit events.

```bash
npm run test:m3-5
```

Run the M3.5 commercial-readiness gate: frontend tests, backend tests, production build, then the simulator debugging API smoke. Use this before starting M4 Agent work in an environment with `DATABASE_URL`, `OBJECT_STORE_ROOT=.wiseeff-object-store`, and `DEBUG_DEVICE_GATEWAY_MODE=simulator`.

```bash
npm run test:m4
```

Run the M4 Agent acceptance gate: frontend tests, backend tests, production build, then `e2e/agent.api.spec.ts`. The smoke requires `DATABASE_URL`, seeds M0/M1 data, starts API mode, opens WiseAgent on `/parameters`, sends a prompt through `AgentGateway`, and verifies a persisted approval-required parameter draft tool call.

```bash
npm run smoke:m5
```

Run the M5 operations smoke: `npm run contract:check`, `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness`. Set `WISEEFF_API_BASE_URL` or `VITE_WISEEFF_API_BASE_URL` to point at a live API; set `M5_SMOKE_AUTHORIZATION` or `WISEEFF_SMOKE_AUTHORIZATION` to a bearer token with `admin:access` for staging/prod pilot checks; otherwise the route will 403. The script fails unless `M5_SMOKE_ALLOW_NO_API=true` is set for a local skip.

```bash
npm run test:m5
```

Run the full M5 pilot gate: contract check, frontend tests, backend tests, production build, full Playwright E2E, and the M5 operations smoke. It is the intended commercial-pilot baseline, but it still depends on external PostgreSQL and environment-specific evidence for backup, device-lab, and staging checks.

```bash
npm run preview
```

在执行 `npm run build` 后，本地预览生产构建结果。

## 运行模式

默认前端仍运行在 `mock` 模式，适合演示和组件开发。需要连接 M0 API 时，创建本地环境变量：

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

For M2/M3 API mode, use:

```bash
DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff
OBJECT_STORE_MODE=local
OBJECT_STORE_ROOT=.wiseeff-object-store
DEBUG_DEVICE_GATEWAY_MODE=simulator
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
npm run dev:api
VITE_WISEEFF_RUNTIME_MODE=api VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787 npm run dev
```

`OBJECT_STORE_MODE` defaults to `local`, and `OBJECT_STORE_ROOT` defaults to `.wiseeff-object-store`. In local API mode, uploaded log bytes are written under that directory by organization and ignored by Git; seed data uses synthetic storage keys and does not require files to exist in the object store.

For staging or production-like object storage, set `OBJECT_STORE_MODE=s3` with an S3/OSS-compatible endpoint:

```bash
OBJECT_STORE_MODE=s3
OBJECT_STORAGE_ENDPOINT=https://storage.example.com
OBJECT_STORAGE_BUCKET=wiseeff-pilot
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_REGION=ap-southeast-1
```

The S3/OSS adapter stores organization-scoped keys with checksum, size, content type, retention class, and encryption-mode metadata. Readiness checks the configured bucket through the adapter seam. The built-in HTTP transport is an M5 runtime seam with WiseEff signing headers, not a full AWS SigV4 or cloud-vendor SDK implementation.

Commercial production mode fails fast when required runtime dependencies are unsafe or missing:

- `NODE_ENV=production` requires `DATABASE_URL`.
- `NODE_ENV=production` requires `OBJECT_STORE_MODE=s3`.
- `OBJECT_STORE_MODE=s3` requires `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`, and `OBJECT_STORAGE_SECRET_ACCESS_KEY`.
- `NODE_ENV=production` rejects `MOCK_RUNTIME_ENABLED=true`.

M3.5 commercial-readiness checks now include `/health/live`, `/health/ready`, production environment gates, a static M1-M3 route manifest, leased log-analysis jobs, object-store readiness probes, debugging device leases, and request-id-to-audit trace correlation.

M2 log-analysis verification in API mode:

1. Start PostgreSQL and export `DATABASE_URL`.
2. Run `npm run db:migrate`, `npm run db:seed:m0`, `npm run db:seed:m1`, and `npm run db:seed:m2`.
3. Start `npm run dev:api` with `OBJECT_STORE_MODE=local` and `OBJECT_STORE_ROOT=.wiseeff-object-store`.
4. Start the frontend with `VITE_WISEEFF_RUNTIME_MODE=api` and `VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787`.
5. Open `/logs?project=aurora`, upload `test-fixtures/logs/charging-foldback.log`, ask `Why did fast charging fold back?`, and verify the report reaches `Complete` with thermal/foldback evidence. Upload `test-fixtures/logs/unsupported.bin` to verify a `Failed` record with a readable unsupported-format reason.

M3 debugging verification in API mode:

1. Start PostgreSQL and export `DATABASE_URL`.
2. Run `npm run db:migrate`, `npm run db:seed:m0`, `npm run db:seed:m1`, and `npm run db:seed:m3`.
3. Start `npm run dev:api` with `DEBUG_DEVICE_GATEWAY_MODE=simulator`, `OBJECT_STORE_MODE=local`, and `OBJECT_STORE_ROOT=.wiseeff-object-store`.
4. Start the frontend with `VITE_WISEEFF_RUNTIME_MODE=api` and `VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787`.
5. Open `/node-debugging?project=aurora` and verify `Aurora Simulator 1`, `Fast charge current` reads `3000`, a write to `3100` succeeds with readback, `Cycle count` remains read-only, and `Readback mismatch probe` reports a mismatch.
6. Run `npm run test:m3` for the full local M3 gate.

M3.5 commercial-readiness verification:

1. Run `npm run test:all` and `npm run build` on every M3.5 change.
2. When PostgreSQL is available, export `DATABASE_URL`, then run `npm run test:m3-5`.
3. Confirm `/health/ready` reports database and object-store readiness before treating a local/staging API process as pilot-ready.

M5 pilot verification:

1. Run `npm run smoke:m5` against a live API after `npm run contract:check`, or use `M5_SMOKE_ALLOW_NO_API=true` only for local documentation runs.
2. Run `npm run test:m5` in an environment with PostgreSQL and the other pilot dependencies available.
3. Record any skipped external checks in `docs/generated/m5-pilot-acceptance.md` before calling the environment pilot-ready.

M4 Agent verification:

1. Start PostgreSQL and export `DATABASE_URL`.
2. Run `npm run test:m4`.
3. Verify the WiseAgent API-mode smoke shows confidence rendering and an approval-required `Create parameter draft` tool call. Citation rendering remains covered by Agent DTO/runtime/UI tests. M4 uses deterministic provider logic rather than a live LLM provider.

生产构建不允许使用 `mock` 作为业务数据源。

## 项目结构

```text
src/
  App.tsx                         原型主界面和交互逻辑
  styles.css                      应用样式
  mockData.ts                     mock 业务数据
  appConfig.ts                    导航和应用配置
  powerManagementConfig.ts        电源管理配置辅助逻辑
  config/power-management.json    可编辑的原型配置数据
  test/setup.ts                   Vitest DOM 测试初始化
server/
  app.ts                          M0 后端 API 入口
  modules/auth                    当前用户、角色和权限上下文
  modules/audit                   审计事件写入与查询边界
  migrations                      PostgreSQL SQL 迁移

AGENTS.md                         Agent 工作指南和知识库路由
ARCHITECTURE.md                   系统架构总览
docs/                             harness 风格项目知识库
  product-specs/                  产品规格、原型功能说明和 MVP 切分
  design-docs/                    架构、领域模型、API、安全、测试和设计文档
  exec-plans/                     active/completed 执行计划和技术债追踪
  generated/                      由代码或迁移派生的知识库材料
  references/                     面向 LLM/Agent 的紧凑参考资料
```

### 项目参数管理后台（/parameter-admin）

管理员专用工作台：

- **参数库治理**：搜索、风险 / 模块 / 覆盖多维过滤、按模块分组折叠、URL 可分享。
- **“孤儿参数”视角**：列出未被任何项目使用的参数，便于清理。
- **共享定义表单**：`RiskPicker` 色标、`推荐值 ⓘ 对所有项目生效` 提示、范围 min/max 拆分、参数名 snake_case + 重名校验。
- **项目值矩阵**：单位就近 suffix、越界红边、偏差百分比色标、**只读 `updatedAt`** 自动更新。
- **脏态徽章 + 导出 ▾**：`[● N 处未导出]` 按需出现；导出时弹 diff 摘要对话框；`beforeunload` 守护意外关标签页。
- **删除二次确认 + 10s Undo Toast**：统一 `UndoableToast` 通道。
- **Agent 联动**：`扫描孤儿参数` / `生成清理建议` 已接通；`预审导入风险` / `汇总本周审计` 占位（等 m2 审计抽屉与导入向导）。
- **数据契约新增**：`User[]` 8 人、`AuditEvent.kind` 13 档、`UndoEntry` 单条栈、`Role.capabilities` 四档能力。

## 新机器配置流程

1. 克隆本仓库。
2. 使用 Node 22，或安装满足 Vite 7 要求的 Node.js 版本。
3. 在仓库根目录执行 `npm ci`。
4. 执行 `npm test` 和 `npm run build` 验证环境。
5. 执行 `npm run dev`，打开终端输出的本地访问地址。

当前原型默认不依赖外部 API key。连接 M0 API 时需要本地启动后端；后续数据库、设备网关和真实 Agent 接入规划见 `docs/README.md`。

产品化边界草案见 `docs/references/productization-api-contract-draft.md`。完整产品规格、架构和执行计划分别见 `docs/product-specs/`、`docs/design-docs/` 和 `docs/exec-plans/`。

## 仓库规范

`node_modules/`、`dist/`、本地开发日志、Codex/Superpowers 临时状态、视觉 QA 截图等生成内容不会提交到 Git。请提交源码、配置、测试、产品/设计文档和 lockfile。
