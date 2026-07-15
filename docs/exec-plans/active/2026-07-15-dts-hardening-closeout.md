# DTS 硬化收口（B / TD-039 · TD-040）Implementation Plan

> **For agentic workers:** 逐任务执行「写失败测试 → FAIL → 实现 → PASS → 提交」。仅在特性分支提交，不开/合 PR。前端可见改动须按 `AGENTS.md` 做 playwright-cli 三视口验证。
>
> 方案概要：[DTS 程序后续方案](../../design-docs/2026-07-15-dts-followup-scheme.md)。前置：DTS 程序 P0–P3.1 已归档。姊妹计划：[导入向导 TD-035](2026-07-15-parameter-import-wizard-td035.md)。

**Goal:** 收口 TD-039 / TD-040 残余：新建项目自动默认配置集；参数文件/冲突面板 Port 化（含 mock）；身份 fallback 可观测可收紧；dt-schema 可选接线；容器沙箱明确不做并记账。

**Architecture:** 在现有 `ensureDefaultConfigSet` / `ParameterFileRepository` / `syncService.identityFallbackUses` / `DtcValidator` 上补调用链与前端注入，不重做结构化核心。无新迁移。

**Tech Stack:** Node/tsx, Vitest, React/Vite, Playwright acceptance。

**Branch:** `feat/dts-hardening-closeout`（从最新 `main`）。

**Schema:** 无迁移。

---

## Locked Decisions（方案锁定）

| # | 结论 |
| --- | --- |
| B1 | `createProject` 成功后事务内（或同请求内）调用 `ensureDefaultConfigSet`；导入向导建项走同一 `createProject` 路径则自动受益 |
| B2 | 旧面板只接受 `ParameterFileRepository`（props 或 runtime resolve）；补 `mockParameterFileRepository` + `resolveParameterFileRepository` |
| B3 | `DTS_IDENTITY_FALLBACK_MODE=allow\|warn\|deny`（默认 `allow`）；sync / structured-edit 解析在 fallback 时计数；`deny` → 不绑定并 409/`VALIDATION_FAILED` |
| B4 | `enableDtSchema`：实现可选调用（env `DTS_ENABLE_DT_SCHEMA=1`）；工具缺失时降级，不阻断 `mode=warn/off` |
| B5 | 容器化 dtc：**不实现**；更新 SECURITY + TD-040 为「评估维持子进程」 |

---

## File Map

| File | Responsibility |
| --- | --- |
| `server/modules/parameters/repository.ts` 或新建 `projectService.ts` | `createProject` 后调 `ensureDefaultConfigSet`（避免 routes 直耦合时抽薄 service） |
| `server/modules/parameters/routes.ts` | 若仍直调 repository：改为经 service，保证默认集 |
| `server/modules/parameter-files/syncService.ts` | 读 fallback mode；deny 时拒绝；warn 写审计/日志 |
| `server/modules/parameters/service.ts` | `resolveStructuredEditToParameter` 同样尊重 deny |
| `server/modules/parameter-files/dtcValidator.ts` | 可选 dt-schema 钩子 |
| `src/application/ports/ParameterFileRepository.ts` | 补 `identityFallbackUses?` 到 sync 摘要（若缺） |
| `src/infrastructure/mock/mockParameterFileRepository.ts` | 新建 |
| `src/application/parameters/parameterFileRuntime.ts` | `resolveParameterFileRepository` |
| `src/components/admin/ProjectParameterFilesPanel.tsx` | 注入 port |
| `src/components/admin/ParameterFileConflictPanel.tsx` | 注入 port |
| `.env.example` / env docs（中英） | 新 env 键 |
| `docs/SECURITY.md`（中英） | 容器评估结论 |
| `docs/exec-plans/tech-debt-tracker.md` | 更新 TD-039/040 |

---

## Git & PR Workflow

- Branch from latest `main`；仅分支提交；架构师评审 / PR / 合并。

---

## Task 1: 新建项目 → 默认配置集

**Files:** parameters create path + tests

- [ ] **Step 1: 失败测试** — `createProject` 后存在 `dts_config_set` 名 `default`（`ensureDefaultConfigSet` 幂等）；二次创建同项目不重复；无 admin 仍不能建项。
- [ ] **Step 2: FAIL** → **Step 3: 实现** — route/service 在 insert 成功后调用 `ensureDefaultConfigSet`（同 org/project）；失败则整请求失败（事务优先）。→ **Step 4: PASS** → 提交。

---

## Task 2: ParameterFileRepository mock + runtime

**Files:** mock + runtime + port 小补 + tests

- [ ] **Step 1: 失败测试** — mock 可 list/upload/sync/conflicts；`runtimeMode=mock` 解析到 mock，`api` 到 http。
- [ ] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。

---

## Task 3: 旧面板 Port 化

**Files:** `ProjectParameterFilesPanel` / `ParameterFileConflictPanel` + 挂载页 + tests

- [ ] **Step 1: 失败测试** — 组件接收 repository；mock 下不发起 HTTP；api 下行为不变。
- [ ] **Step 2: FAIL** → **Step 3: 实现** — 删除组件内 `createParameterFileClient()`；`ParameterAdminPage` / `ParameterAdminProjectsPage` 注入。→ **Step 4: PASS** → 提交。**（前端可见：playwright-cli 三视口）**

---

## Task 4: 身份 fallback 模式

**Files:** `syncService.ts`, structured edit resolve, env + tests

- [ ] **Step 1: 失败测试**
  - `allow`：现有回退行为 + `identityFallbackUses` 递增。
  - `warn`：回退成功但审计/日志含 fallback。
  - `deny`：无 `source_*` 命中时不同步该键 / 结构化编辑 409，**不** invent PPV via definition（或明确仅 sync deny、structured-edit 仍 create——**锁定：deny 时两边都不走 `(name,module)` 命中既有行；structured-edit 仍可 insert 新 PPV+source，因那是新绑定不是 fallback**）。
- [ ] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。

---

## Task 5: 可选 dt-schema + 容器评估记账

**Files:** `dtcValidator.ts` + SECURITY + TD-040

- [ ] **Step 1: 失败测试** — `DTS_ENABLE_DT_SCHEMA=1` 且注入假 schema runner → diagnostics 合并；工具 unavailable → 不抬升为硬错误（除非 mode=block 且产品要求——**锁定：schema 失败仅 warning，除非显式 `DTS_DT_SCHEMA_MODE=block`**，默认 warning）。
- [ ] **Step 2: FAIL** → **Step 3: 最小钩子实现**（可空实现：找不到二进制则 skip）→ SECURITY 写明容器不做 → TD-040 更新。→ **Step 4: PASS** → 提交。

---

## Task 6: 文档 + 验收 + 债关闭

- [ ] 更新 FRONTEND（中英）、environment-variables（中英）、SECURITY（中英）、tech-debt-tracker（TD-039 残余勾选；TD-040(1) 关闭；(2)(3) 按实现更新）。
- [ ] 如有可见 Admin 行为变化：登记/扩展 acceptance operation ID。
- [ ] `npm run test:server` 全量 + `npm test` + `npm run build` + `npm run docs:check`。
- [ ] 提交。

---

## Verification Matrix

| Check | Command |
| --- | --- |
| 默认配置集 | `npm run test:server -- server/modules/parameters server/modules/parameter-files --run` |
| Fallback 模式 | 定向 sync / structured edit 测 |
| 前端 Port | `npm test`（面板 + mock） |
| 浏览器 | playwright-cli Admin 文件/冲突面板，三视口 |
| Docs | `npm run docs:check` |

---

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| 方案 | `docs/design-docs/2026-07-15-dts-followup-scheme.md` | No change（输入） |
| FRONTEND（中英） | `docs/FRONTEND.md` / zh | **Update**（Port 化旧面板） |
| env（中英） | `docs/developer/environment-variables.md` | **Update**（fallback / dt-schema flags） |
| SECURITY（中英） | `docs/SECURITY.md` | **Update**（容器评估结论） |
| tech-debt | `docs/exec-plans/tech-debt-tracker.md` | **Update** |
| PLANS（中英） | `docs/PLANS.md` / zh | **Update** |
| domain-model | — | Review（无实体变更则记 unchanged） |

## Documentation Update Gate

- [ ] FRONTEND / env / SECURITY（中英）已更新
- [ ] TD-039 / TD-040 状态与实现一致
- [ ] `docs:check` 通过
- [ ] 前端可见改动有 playwright-cli 证据

---

## Spec Coverage Self-Review

| 债项 | 本期 | Task |
| --- | --- | --- |
| TD-040(1) 新建项目无默认集 | ✅ | 1 |
| TD-039 旧面板直连 client | ✅ | 2,3 |
| TD-039 `(name,module)` fallback | ✅ 可收紧，非强删 | 4 |
| TD-040(2) dt-schema | ✅ 可选钩子 | 5 |
| TD-040(3) 容器沙箱 | ✅ 评估不做 | 5 |
