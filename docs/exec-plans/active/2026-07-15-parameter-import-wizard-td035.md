# 参数批导向导对齐 TD-035（C）Implementation Plan

> **For agentic workers:** 逐任务执行「写失败测试 → FAIL → 实现 → PASS → 提交」。仅在特性分支提交，不开/合 PR。前端可见改动须按 `AGENTS.md` 做 playwright-cli 三视口验证。
>
> 方案概要：[DTS 程序后续方案](../../design-docs/2026-07-15-dts-followup-scheme.md)。消化原批导计划 P2/P3 与 **TD-035**。姊妹计划：[DTS 硬化收口](2026-07-15-dts-hardening-closeout.md)。原 P1 计划：`2026-07-06-parameter-batch-import-wizard.md`（仍可参考 Step 结构）。

**Goal:** 完整 `.dts` 导入使用服务端真解析（`parseDts`/`resolveDts`）产出带 `@address` 的 nodePath 与 module 建议；跳过原因进入服务端 `reviewMetadata` 审计；大文件走服务端 parse 端点——前端**禁止** import `server/`。

**Architecture:** 新增 import 专用 HTTP：`POST /api/v1/parameter-import/parse-dts` 内部复用 `server/modules/dts/`；前端 `parseDtsFull` / `detectImportFormat` 对 `dts-full` 调该 API（mock 实现）；扩展 `createImportPreview` body 可选 `reviewMetadata`。无新迁移。

**Tech Stack:** Node/tsx, Vitest, React wizard, Playwright acceptance。

**Branch:** `feat/parameter-import-wizard-td035`（从最新 `main`；若 B 已合则基于含 B 的 main）。

**Schema:** 无迁移。

---

## Locked Decisions（方案锁定）

| # | 结论 |
| --- | --- |
| C1 | 完整 DTS 权威在服务端 CST；不抽 `packages/dts-core` |
| C2 | `dts-full` **不得**再 silently 调用 `parseDtsFragment`；统一经 parse-dts API（或 mock） |
| C3 | 含 `/include/` 的源 → 显式失败（与程序决策 #4 一致），返回可展示错误 |
| C4 | `reviewMetadata`：`{ skippedRows?: [{ rowKey, reason }], notes?: string }` 可选挂 create preview；apply 时可再带最终快照；写入 `audit_events.metadata` |
| C5 | 大小：默认阈值 2MB；超过必须服务端（前端禁止本地伪解析）；低于阈值也**推荐/默认**走 API 保持一致 |
| C6 | module 建议：由 `nodePath` 推导（父路径为 module、末段为 name），复用/对齐 `nodePathToParameterIdentity` 语义，在**服务端**算好返回，前端不猜 |

---

## Contracts

### Parse DTS（import）
```
POST /api/v1/parameter-import/parse-dts
Body: { sourceName: string, content: string }  // 或 multipart 后续；本期 JSON UTF-8 文本足够
→ {
  format: "dts-full",
  rows: [{
    name: string,
    module: string,           // from nodePath identity
    sourceNodePath: string,   // nodePath + "/" + prop
    value: string,            // prefer rawText or normalizedValue — 锁定：返回 rawText + normalizedValue 双字段
    valueType: string,
    skipSuggested?: boolean
  }],
  diagnostics?: [{ severity, message }]
}
```
Auth: `canAdminParameters`（与 import batch 一致）。

### reviewMetadata
```
createImportPreview body += reviewMetadata?: {
  skippedRows?: Array<{ name?: string; module?: string; reason: string }>;
  notes?: string;
}
```
Audit kind 保持现有 import 事件，metadata 合并 `reviewMetadata`。

---

## File Map

| File | Responsibility |
| --- | --- |
| `server/modules/parameters/importDtsParse.ts` | content → resolveDts → import rows |
| `server/modules/parameters/service.ts` + `routes.ts` + `schemas.ts` | parse-dts 端点；preview/apply 扩 schema |
| `src/application/parameters/import/parseDtsFull.ts` | 调 repository/API；单元测契约 |
| `src/application/parameters/import/detectImportFormat.ts` | `dts-full` 改走 parseDtsFull |
| `src/application/ports/ParameterRepository.ts` | `parseDtsImport` + preview metadata |
| `src/infrastructure/http/parameterClient.ts` / mock | 实现 |
| `src/components/ParameterImportWizard/**` | 接线 skipReason → reviewMetadata；大文件提示 |
| `e2e/acceptance/*` | 扩展 import / 新 PARAM-IMPORT-DTS-* |
| tech-debt-tracker | 关闭或收敛 TD-035 |

---

## Git & PR Workflow

- Branch from latest `main`；仅分支提交；架构师评审 / PR / 合并。

---

## Task 1: 服务端 importDtsParse + HTTP

**Files:** `importDtsParse.ts`, routes, schemas, tests（教学 fixture 去掉 include 的副本）

- [ ] **Step 1: 失败测试** — fixture：`@address` 路径不碰撞；属性行含 `sourceNodePath`；`/include/` → 400 `dts-include-unsupported`；布尔属性可见；hex raw/normalized 双字段。
- [ ] **Step 2: FAIL** → **Step 3: 实现**（`parseDts`→`resolveDts`→rows；复用 `detectUnsupported`/`strip` 语义）→ **Step 4: PASS** → 提交。

---

## Task 2: reviewMetadata 进 preview/apply 审计

**Files:** schemas, service createImportPreview/applyImportBatch, tests

- [ ] **Step 1: 失败测试** — 带 `reviewMetadata.skippedRows` 创建 preview → audit metadata 含该结构；无字段时行为不变。
- [ ] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。

---

## Task 3: 前端 Port + parseDtsFull + detectImportFormat

**Files:** ParameterRepository, client, mock, parseDtsFull, detectImportFormat, tests

- [ ] **Step 1: 失败测试** — `dts-full` 样本不再产生 fragment 级错误路径；mock parse 返回带 `@` 的 nodePath；api 打真实端点。
- [ ] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。

---

## Task 4: Wizard UX 接线

**Files:** ParameterImportWizard steps + ImportReviewCard

- [ ] **Step 1: 失败测试** — 跳过行汇总进 `createImportPreview.reviewMetadata`；>2MB 显示「将使用服务端解析」且走 API；include 错误可读。
- [ ] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。**（前端可见：playwright-cli 三视口）**

---

## Task 5: 验收 + 文档 + 关闭 TD-035

- [ ] 登记/扩展 acceptance（建议 `PARAM-IMPORT-DTS-FULL-001`、`PARAM-IMPORT-REVIEW-META-001`）。
- [ ] 更新 api-contract（中英）、FRONTEND/导入相关、tech-debt（**Close TD-035** 或标记 P2/P3 done）。
- [ ] 更新原批导计划 follow-up 表或归档说明「P2/P3 由本期消化」。
- [ ] `npm run test:server` + `npm test` + `npm run build` + `npm run docs:check` + 定向 acceptance。
- [ ] 提交。

---

## Verification Matrix

| Check | Command |
| --- | --- |
| 服务端 parse | `npm run test:server -- server/modules/parameters --run` |
| 前端 import | `npm test`（parseDtsFull / wizard） |
| 浏览器 | playwright-cli `/parameter-admin` 导入向导，三视口 |
| Docs | `npm run docs:check` |

---

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| 方案 | `docs/design-docs/2026-07-15-dts-followup-scheme.md` | No change |
| API 契约（中英） | `docs/design-docs/api-contract.md` | **Update**（parse-dts + reviewMetadata） |
| 批导计划 | `docs/exec-plans/active/2026-07-06-parameter-batch-import-wizard.md` | **Update**（P2/P3 指向本期） |
| tech-debt | `docs/exec-plans/tech-debt-tracker.md` | **Update**（关闭 TD-035） |
| FRONTEND / zh | 导入相关段落 | **Update** |
| PLANS（中英） | | **Update** |
| design-docs index | `docs/design-docs/index.md` | Review（链到 followup scheme） |

## Documentation Update Gate

- [ ] api-contract（中英）已更新
- [ ] TD-035 关闭
- [ ] 批导计划 P2/P3 指向已更新
- [ ] playwright-cli 证据已附
- [ ] `docs:check` 通过

---

## Spec Coverage Self-Review（对 TD-035 / 原 P2·P3）

| 项 | 本期 | Task |
| --- | --- | --- |
| P2-a 完整 `.dts` + node-path module 建议 | ✅ | 1,3 |
| P2-b parseDtsFull + fixture | ✅（服务端权威 + 前端 API 封装） | 1,3 |
| P3-a reviewMetadata | ✅ | 2,4 |
| P3-b 服务端大文件 parse | ✅ | 1,4 |
| 不破坏 `/include/` 拒绝 | ✅ | 1 |
