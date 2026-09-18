# T3.2 本地验收 — 进度回执

> English: [English](../../../exec-plans/active/849-inventory/t32-local-acceptance.md)

状态：**本地候选，T3.2 整行尚未绿。** 目前最好的 worktree Gate0 是 `5975f0cce`：视觉 **通过**，浏览器 **14** 条失败（从 39 降下来）。后续 `4ddac4c15` 加了目录只读历史和 ingest-on-add；该 SHA 的 Gate0 视觉 **通过**，浏览器 **41** 条失败，加入 config-set 文件返回 500。ingest-on-add 已在 `66cae3c0b` 撤回。未 SEALED。未 push。无 PR/Hosted。封印点仍是 T3.4a。

HEAD：`66cae3c0b4921300039da8e98a4338099aa65e91`（`codex/849-853-t11-source-identity`）。后续（脏树）：知识检索用 `view=governance`；enable 等待可用拓扑节点；数值 cell 对优先选带 locator 的 default binding。ingest-on-add 保持撤回。

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
| 本地 commit `5975f0cce` | **已做。** darwin 视觉基线 + 共享定位/FK/诊断修复。未 push。 |
| `LANG=C LC_ALL=C npm run acceptance:gate0`（`5975f0cce` / PG **55438**） | **供给后失败。** 运行 `full-20260918t083648303z-5975f0cceec4-679690ef`。Visual **通过**。Browser **14 条清单失败**。产物保留。不是把 skip 当通过。 |
| 误打到 `/Users/tzrea1/Develop/WiseEff` `46b60686` 的 Gate0 | **已杀掉。** 不是 worktree 证据。WiseEff porcelain 仍为 0。 |
| 目录只读后续（脏树） | `DefinitionEditorBody` 在无编写权限时仍展示主体/定义编号、说明、使用与「查看历史」。`DefinitionEditorBody.test.tsx` **4 通过**。 |
| 本地 commit `4ddac4c15` | 目录只读历史 + ingest-on-add + 小泽 locator。 |
| `LANG=C` Gate0（`4ddac4c15` / PG **55438**） | **失败。** 运行 `full-20260918t091649761z-4ddac4c158b4-2d0378a7`。Visual **通过**。Browser **41** 条失败。加入 config-set 文件返回 INTERNAL_ERROR 500。 |
| 本地 commit `66cae3c0b` | **已撤回 ingest-on-add。** 成员 POST 再次只做成员关系。 |
| 第一次 Gate0（会话 locale） | **供给前失败**：中文 `ps -o lstart=`。 |
| 第二次 Gate0（LANG=C，脏树） | **源检查失败**：需要干净工作树。 |
| target-synthetic-acceptance | **未跑**。本会话没有目标前端/API URL 或鉴权。 |
| minimal-upgrade | **未跑**。驱动需要已封印候选 SHA 与 Docker daemon id；T3.4a 尚未封印此 Scratch。 |

## 程序边界

T3.2 整行仍未完成。worktree Gate0（`5975f0cce`）视觉已过，浏览器失败从 39 降到 14。剩余：overlay ingest 超时（`enable_*`、小泽 `iin_max`）、`missing-logical-node-revision`、dts-structured writeback、拓扑 `data-project-id=nebula`、工作台 candidate POST 400、知识检索「关联」、以及目录详情/历史（只读身份/历史已实现但未进入该次 Gate0）。不得把视觉通过当成 Gate0 通过。不 push、不开 PR。T3.3a Docker/S2、T3.3b 目标、T3.4a 封印、T3.4b PR/Hosted/merge、T3.5 Issue 关闭不变。
