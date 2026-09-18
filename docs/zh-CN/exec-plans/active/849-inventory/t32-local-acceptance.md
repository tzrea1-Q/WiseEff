# T3.2 本地验收 — 进度回执

> English: [English](../../../exec-plans/active/849-inventory/t32-local-acceptance.md)

状态：**本地候选，T3.2 整行尚未绿。** 缺失的必需 Playwright 场景已实现并在专注运行中通过。Smoke、覆盖与操作矩阵在专用 helper PG 库上通过。Gate0 未完成供给：第一次因中文 `ps -o lstart=` 无法解析进程身份；`LANG=C` 后身份捕获成功，但 Gate0 拒绝脏 Scratch（`git status --porcelain` 523 条）。target-synthetic 与 minimal-upgrade 未执行。未 SEALED。无 commit / PR / Hosted / 目标 / Issue 变更。封印点仍是 T3.4a。

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e` 加上未提交 Scratch（含 T3.1 与本项 T3.2）。

## 环境

- Helper PG **55438** / 一次性库 `wiseeff_t32`（已建库，迁移 0001–0159，M0+M1 种子）。不是 `wiseeff_lane_849`。不是 compose `5432/wiseeff`。不是 `wiseeff_t23b`。
- 自有 smoke/浏览器端口 **127.0.0.1:5174**（前端，CORS 允许的 5173–5199）与 **127.0.0.1:18787**（API）。未复用主机 5173/8787。
- 晋升用例对象存储：工作树 `.wiseeff-object-store`（M1 种子字节）。`/tmp/wiseeff-t32-objects` 仅用于 smoke。

## 已补的缺失场景

| ID | Spec | 说明 |
| --- | --- | --- |
| `PROJ-REVIEW-ROLES-001` | `e2e/acceptance/project-review-roles.acceptance.spec.ts` | 深链、搜索、ConfirmDialog、PUT。`required: false`。 |
| `PROJ-REVIEW-READINESS-001` | 同上 | 已初始化自定义项目、已暂存草稿、缺三池角色、非 Admin 联系文案、Admin 配置入口、草稿保留。`required: true`。 |
| `PARAM-INIT-LOCK-001` | `e2e/acceptance/parameter-initialization-lock.acceptance.spec.ts` | 提交轮次 409 锁 + 工作台「初始化待审阅」。App 现从 `/parameters?project=` URL 水合初始化状态。 |
| `DTS-RELOAD-HANDOFF-001` | `e2e/acceptance/dts-reload-handoff.acceptance.spec.ts` | 深链横幅，不自动填「本轮重载」。不恢复已省略的工作台按钮。 |
| `DTS-RELOAD-PROMOTE-001` | `e2e/acceptance/dts-reload-promote.acceptance.spec.ts` | 已验证普通运行晋升；不可验证运行需 ConfirmDialog 确认；不创建变更请求。 |

Canonical 值草稿现在会加载审核角色候选人，角色池缺失时阻止提交（托盘仍不渲染处理人下拉）。覆盖图孤立 ID `PROJ-REVIEW-*` 已对齐（`coverageMapOrphanIds: []`）。

## 验证（不要加总）

| 命令 | 结果 |
| --- | --- |
| `npm test -- DtsBindingDraftTray.test.tsx ApiProjectTopologyWorkspace.test.tsx` | **53 通过** |
| `npm test -- src/App.test.tsx` | **143 通过** |
| `npm run ui:check` | **通过** |
| `npm run acceptance:quality` | **通过**（仅元数据：脚本与 spec 文件存在） |
| `npm run acceptance:coverage` | **通过**；`missingRequiredIds: []`；`coverageMapOrphanIds: []`；`skippedRequiredIds: []` |
| `npm run acceptance:operations` | **通过**；`missingAutomatedOperationIds: []` |
| `:5174/:18787` / `wiseeff_t32` 上的 `acceptance:smoke` | **4 通过** |
| 专注 Playwright（handoff / roles / readiness / lock / promote） | 同一自有运行时上 **全部通过** |
| `npm run dts:toolchain:check -- --required` | **通过** |
| `LANG=C LC_ALL=C npm run acceptance:gate0` | **DTS 前置通过后，在源检查失败。** `LANG=C` 下 `readProcessStartIdentity` 可用。供给抛出 `Owned runtime requires a clean source worktree before provisioning.` HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`，porcelain **523** 条。Gate0 没有脏树旁路。不是把 skip 当通过。 |
| 第一次 Gate0（会话 locale） | **供给前失败**：中文 `ps -o lstart=`（`五  9月/18 …`）与 `process-start-identity.ts` 不匹配。不是工具链缺失。 |
| target-synthetic-acceptance | **未跑**。本会话没有目标前端/API URL 或鉴权。 |
| minimal-upgrade | **未跑**。驱动需要已封印候选 SHA 与 Docker daemon id；T3.4a 尚未封印此 Scratch。 |

## 程序边界

在 Gate0/local-non-HDC、该自有运行上的 operation-evidence/artifact-safety，以及诚实的 target/minimal-upgrade 记录齐备之前，T3.2 不能算整行完成。Gate0 不能在脏树上供给；要跑通需要**单独的 commit 授权**（本程序此处仍禁止 commit/PR/封印）。不得 stash/reset/checkout 假装干净，也不得削弱 `readCleanSource`。T3.3a Docker/S2、T3.3b 目标、T3.4a 封印、T3.4b PR/Hosted/merge、T3.5 Issue 关闭不变。
