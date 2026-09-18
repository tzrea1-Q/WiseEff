# T3.2 本地验收 — 进度回执

> English: [English](../../../exec-plans/active/849-inventory/t32-local-acceptance.md)

状态：**本地候选，T3.2 整行尚未绿。** 缺失场景已实现。为让 Gate0 看到干净树，做了**仅本地** commit `8b517b9303ded564edd57c3ca31ede06b5c5cf51`。Gate0 已供给并跑完，**失败**（visual 7、browser 32、清单 39）。那 7 张 darwin 视觉基线已按审查后的 actual 更新。共享浏览器定位/FK/诊断修复在脏树中，**尚未再跑 Gate0**。未 SEALED。未 push。无 PR/Hosted/目标/Issue。封印点仍是 T3.4a。

Gate0 供给时 HEAD：`8b517b9303ded564edd57c3ca31ede06b5c5cf51`（`codex/849-853-t11-source-identity`）。快照与用例修复再次把树弄脏。

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
| 本地 commit `8b517b930` | **已做。** 523 文件。说明：`feat(parameters): snapshot 849/853 Scratch for local Gate0`。未 push。 |
| `LANG=C LC_ALL=C npm run acceptance:gate0`（`8b517b930` / PG **55438**） | **供给后失败。** 运行 `full-20260918t071307751z-8b517b9303de-7afcdd88`，库 `wiseeff_acceptance_full_20260918t07130775_8b517b93_7afcdd88`。Visual **7 失败 / 13 通过**。Browser **32 失败 / 33 跳过 / 141 通过**。清单 **39**。产物保留。不是把 skip 当通过。 |
| 该次 Gate0 浏览器中的 T3.2 spec | HANDOFF、已验证 PROMOTE、LOCK、ROLES、READINESS **通过**。不可验证 PROMOTE **失败**（`reload-promote-node-drift`）。选择器后续要求非空 node locator（未再 commit）。 |
| Gate0 视觉分诊 | **已审查。** 7 张 darwin 基线按该次 actual 更新：`/parameters`（省略「带到参数调试」+ SearchField 图标）、`/parameter-review`（canonical 审阅文案）、`/parameter-admin`（目录页 + inspect/adopt 横幅）、`/organization/members`（组织角色 / 项目职责 / 注销 / 用户名）、小泽弹层（背后同一工作台）、成员表行悬停与排序表头焦点。品红区域是 Playwright `mask`。Linux 基线**没有**从 darwin actual 拷贝。 |
| 共享浏览器修复（脏树，未再跑 Gate0） | SearchField 清除 `aria-label` 为「清空输入」；目录清除文案为「清空筛选」；「搜索」定位使用 `exact: true`；知识检索用 `searchbox`；权限筛选用 `searchbox`；删除 `project_parameter_files` 前先删 candidate；隔离交付 M1 仅在设置 `WISEEFF_CATALOG_DELIVERY_EVIDENCE` 时运行；shell/debugging/import 期望 GET `parameter-review-items` 403/410；无 Admin 的目录用户看到「无权访问」；未接管的发布对话框断言 inspect/adopt 阻塞而不是主体选择器；debugging 非写入 API 用户为 `guest`；catalog rewrite 导入审计保留 `reviewMetadata`；隔离 binding seed 与小泽等待要求非空 node locator；`/parameter-admin` 拓扑 UI 断言目录而不是「参数定义库」。`SearchField.test.tsx` + `CatalogPage.test.tsx` **22 通过**。 |
| 第一次 Gate0（会话 locale） | **供给前失败**：中文 `ps -o lstart=`。 |
| 第二次 Gate0（LANG=C，脏树） | **源检查失败**：需要干净工作树。 |
| target-synthetic-acceptance | **未跑**。本会话没有目标前端/API URL 或鉴权。 |
| minimal-upgrade | **未跑**。驱动需要已封印候选 SHA 与 Docker daemon id；T3.4a 尚未封印此 Scratch。 |

## 程序边界

T3.2 整行仍未完成。Gate0 已供给并执行；darwin 视觉基线已在本地更新，共享浏览器定位/FK/诊断修复尚未 commit。剩余 Gate0 浏览器簇仍包括：目录未接管 / 发布对话框缺 `catalog:author`、`/parameter-admin` 目录取代「参数定义库」、overlay ingest 超时（`enable_*`、小泽 `iin_max`）、`missing-logical-node-revision`、dts-structured writeback/RBAC、knowledge/catalog 90s 超时、PARAM-IMPORT `skippedRows`。不得把 141 个浏览器通过当成 Gate0 通过。下次重试 Gate0 需要在剩余修复后再做一次干净 commit。不 push、不开 PR。T3.3a Docker/S2、T3.3b 目标、T3.4a 封印、T3.4b PR/Hosted/merge、T3.5 Issue 关闭不变。
