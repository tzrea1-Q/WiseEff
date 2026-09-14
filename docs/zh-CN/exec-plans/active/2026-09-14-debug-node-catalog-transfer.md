# 调试节点目录全量传输（#846）

> English: [English](../../../exec-plans/active/2026-09-14-debug-node-catalog-transfer.md)

状态：**Active —— Scratch 分支上的可评审候选**。本计划不授权 PR、合并或部署。

基线：`origin/main` `6d72e17cb`（PR #845 合并）。Scratch 分支：`feat/846-full-node-catalog-transfer`。

## 目标

组织管理员可以把当前组织**全部**已保存调试节点导出为一个文件，上传该文件，查看服务端分类的合并预览，
确认后得到原子合并结果——全程沿真实浏览器 → 真实 HTTP API → 真实 PostgreSQL → 文件/重新读取边界验证。

## 停止边界

本轮不授权：生产数据操作、部署、PR 合并、跨组织读写、设备连接、设备写入、分片或后台队列、新增依赖，
或通用备份恢复框架。原部署报告的现场漏项**未在本轮复现**；导入容量不一致是另一个已确认缺陷，
本轮不把它当作现场漏项的根因。

## 交付范围

| Area | Change |
| --- | --- |
| 格式 | `wiseeff.debug-node-catalog.v2`（source/counts/对象集合，可选字段带存在性语义）；v1 继续可导入并沿用其默认值 |
| 导出 | 一次组织级快照覆盖全部模块、节点（含归档/禁用/无绑定）与 binding；响应携带计数、组织与字节数；20 MiB 约定下超限整次失败并返回 `413` |
| 预览 | 新增 `POST …/catalog/import-preview`：分类、冲突、提示、逐对象字段差异与 `previewDigest`；只读 |
| 导入 | `POST …/catalog/import` 必须携带摘要，在组织级 advisory lock 下复核已审阅目标，并在同一事务应用全部变更与审计事件 |
| 容量 | 移除 500 模块 / 2,000 节点上限；有界 HTTP 请求体收集返回 `413 PAYLOAD_TOO_LARGE` |
| 界面 | `导出全部节点` / `导入节点`，带计数、冲突、提示与逐字段差异的预览弹窗，摘要确认提交，结构化错误展示 |
| 错误 | 共享错误表新增 `PAYLOAD_TOO_LARGE`（413） |

## 证据

| Level | Evidence |
| --- | --- |
| 真实本地 PostgreSQL | `server/modules/debugging/catalogTransfer.test.ts`（22 个用例：全量导出、v1/v2 语义、冲突、摘要保护、归档规则、幂等、回滚、2,001/501 容量、20 MiB 边界） |
| 路由合同 | `server/modules/debugging/routes.test.ts`、`schemas.test.ts`、`server/shared/http/server.test.ts`、`server/modules/contracts/routeParity.test.ts` |
| 真实浏览器 | `e2e/acceptance/debugging-admin.acceptance.spec.ts` → `DEBUG-ADMIN-001`、`DEBUG-ADMIN-846-CAPACITY`、`DEBUG-ADMIN-846-GUARD`（4 个通过，真实 API + PostgreSQL） |
| 浏览器界面 | `work/846-ui-checks/*`（1440×900、768×1024、390×844）配合 `work/846-ui-check.mts`：下载、上传、预览、取消、确认、错误路径、焦点、控制台/网络 |

## 文档影响矩阵

| Area | Paths | Action |
| --- | --- | --- |
| 仓库地图 | `AGENTS.md` | Review —— 无新增顶层地图或命令 |
| 计划 | 本计划 + 中文对照 | Update |
| 产品规格 | `docs/product-specs/*` | No change —— 节点库传输属于治理面，不是新工作流 |
| 架构 / ADR | `docs/design-docs/debug-node-catalog-transfer.md` + 中文、`docs/design-docs/index.md` + 中文 | Update |
| API 合同 | `docs/design-docs/api-contract.md` + 中文、`server/modules/contracts/routeManifest.ts`、`schemaRegistry.ts` | Update |
| 质量 / 测试 | `docs/developer/browser-acceptance-coverage-map.md` + 中文、`docs/developer/user-operation-coverage-matrix.md` + 中文、`e2e/acceptance/requirements.ts`、`e2e/acceptance/operationMatrix.ts` | Update |
| 可靠性 / runbook | `docs/runbooks/*` | No change —— 无新增运维流程 |
| 安全 | `docs/SECURITY.md`、`docs/security/*` | Review —— 权限、审计与脱敏行为沿用既有规则 |
| 前端 / 设计 | `docs/design-docs/ui-design-system.md`、`docs/developer/ui-quality-checklist.md` | Review —— 复用 `ModalDialog` 尺寸层级与设计令牌 |
| 生成物 | `docs/generated/openapi.json` | Review —— 路由/schema registry 已更新；重新生成属于发布产物步骤 |
| 参考 | `docs/references/*` | No change |

## 文档更新门

阻断项：双语 `debug-node-catalog-transfer` 设计页、两版 API 合同页、两版验收覆盖图、两版操作矩阵、
`scripts/bilingual-docs.ts` 以及 `npm run docs:check`。

## 验证

```bash
DATABASE_URL=<scratch pg> npx vitest run --config vitest.server.config.ts \
  server/modules/debugging/catalogTransfer.test.ts server/modules/debugging/routes.test.ts \
  server/modules/debugging/schemas.test.ts server/shared/http/server.test.ts \
  server/modules/contracts/routeParity.test.ts
npx vitest run src/DebuggingAdminPage.test.tsx src/components/admin/DebugNodeCatalogImportDialog.test.tsx
npx playwright test --config playwright.acceptance.config.ts e2e/acceptance/debugging-admin.acceptance.spec.ts
npx tsx work/846-ui-check.mts
npm run typecheck && npm run build && npm run docs:check
```

## 完成标准

当聚焦测试套件、`npm run build`、`npm run docs:check` 与四个验收用例在记录的 SHA 上全部通过，
且三尺寸浏览器证据显示无溢出、无被阻断操作、无控制台错误时，候选进入可评审状态。

## 未结事项

- 原部署的条目缺失报告**未复现**；本轮不声明根因。
- `docs/generated/openapi.json` 仍保留变更前的 catalog schema 名称；应在发布产物步骤重新生成，而不是手工修改生成文件。
