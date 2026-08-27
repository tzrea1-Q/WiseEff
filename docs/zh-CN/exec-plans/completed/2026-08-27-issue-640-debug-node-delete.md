# Issue #640 调试节点受保护永久删除

> English: [English](../../../exec-plans/completed/2026-08-27-issue-640-debug-node-delete.md)

**目标：** 为调试节点增加仅管理员可用的永久删除流程，同时保留可恢复的禁用能力，并保护所有被 `node_operations` 引用的节点。

**分支：** `codex/issue-640-debug-node-delete`，从最新 `main`（`8b6a2ad2d80e6bdd24af150863ef1c7293039dbe`）创建。主工作区中与本计划无关的 `App.tsx`、`App.test.tsx` 修改不属于本计划。

**状态：** 已于 2026-08-27 在特性分支完成本地实现与验证。父代理创建/合并/推送 PR 属于单独流程。

## 范围与验收覆盖

- 范围内：`DELETE /api/v1/debugging/admin/nodes/:nodeId`、组织范围与权限/不存在处理、带历史操作保护及受限外键并发保护、binding 级联、带请求关联且脱敏的审计、后台 UI 确认/加载/错误/并发刷新状态、mock runtime 状态收敛、契约产物、文档和验收证据更新。
- 范围外：强制/墓碑删除、批量或模块删除、设备 I/O 变更、历史操作迁移，以及禁用/重新启用语义变更。
- 已审查并更新的验收覆盖：`e2e/acceptance/debugging-admin.acceptance.spec.ts`、`docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md`、`e2e/acceptance/requirements.ts`、`e2e/acceptance/operationMatrix.ts` 中的 `DEBUG-ADMIN-001`。

## 架构与安全契约

服务端要求 `debugging:admin`，并从认证上下文取得组织范围。删除前锁定组织范围内的节点行，统计历史操作；存在历史时返回带 `reason=node-history-protection` 与 `operationCount` 的结构化 `409`。数据库中受限的 `node_operations.node_id` 外键继续作为并发插入时的最终保护，且只将明确命名的节点操作外键错误翻译为该 409。成功删除通过现有 `on delete cascade` 关系清除 HDC/ADB binding，并写入一条 `debug-node-admin-delete` 审计事件，仅保留节点身份/状态/模块/binding 数量等元数据，不写入原始路径、值、描述或备注。

UI 保留禁用作为可逆操作，单独提供危险删除操作，要求显式确认，防止重复提交；历史冲突时保留弹窗，并发 `404` 时刷新列表；删除成功后从目录、KPI 和模块计数的派生数据中移除。mock 删除同时派发共享状态 action 并更新页面本地乐观视图，确保导航及 runtime 派生列表收敛。

## 实施任务

- [x] 增加带行锁、binding 级联和历史保护的 repository 删除/统计 seam。
- [x] 增加带权限、组织范围、稳定 `204`/`404`/`409`、审计脱敏及指定外键并发错误翻译的 admin service/route。
- [x] 增加前端 client、危险操作、复用标准 `ConfirmDialog` 的确认弹窗、加载/错误/不存在刷新及 mock 状态收敛。
- [x] 增加 repository/service/route/client/page/table 测试，覆盖级联、历史保护、精确响应状态、编码 ID、404 刷新和重复提交保护。
- [x] 更新 OpenAPI/route parity 产物、中英文 API/domain/验收文档及自动化验收覆盖/证据。
- [x] 执行最终定向/完整质量门禁，完成独立 Standards/Spec 审查，修复 P0/P1，并提交特性分支。

## 验证

最终本地证据：定向前端测试 3 个文件 / 27 项通过；debugging/contracts 服务端定向测试 4 个文件 / 135 项通过；完整 `npm run test:server` 通过 361 个文件 / 2,776 项测试，1 个文件、4 项跳过；完整 `npm run test:scripts` 通过 69 个文件 / 948 项测试，5 项跳过；`npm run build`、`npm run contract:check`、`npm run acceptance:coverage`、`npm run acceptance:operations` 通过；`npm run ui:check` 通过；`npm run lint` 以 0 errors 退出（299 个既有 warning）。普通前端全量套件此前在并发负载下有 44 个无关导航/超时失败，所有变更相关前端测试均通过。

浏览器证据存放在 `work/ui-checks/issue-640/`，针对 mock runtime 下的 `/debugging-admin/nodes` 覆盖 `1440x900`、`768x1024`、`390x844`，包含 snapshot、截图、删除弹窗警告/取消/Escape 焦点恢复、console 错误检查和 mock network 行为。最终代表截图为 `cli-desktop-1440x900.png`、`cli-delete-dialog-1440x900.png`、`cli-tablet-768x1024.png`、`cli-mobile-390x844.png`；干净 mock 走查记录 0 个 console error。API 模式数据库行为、精确 204/409、保护态无副作用、级联删除和请求关联审计由真实 PostgreSQL/service/route 测试及验收 spec 断言覆盖。本机缺少仓库数据库环境，独立 API 浏览器进程只能得到已记录的缺少 DB/权限边界，因此不作为 API 验收证据，也不作产品结论。

浏览器证据存放在 `work/ui-checks/issue-640/`，针对 mock runtime 下的 `/debugging-admin/nodes` 覆盖 `1440x900`、`768x1024`、`390x844`，包含 snapshot、截图、删除确认提示/取消交互、console 错误检查和网络行为记录。API 模式数据库行为由真实 PostgreSQL 集成测试覆盖；缺少仓库数据库环境的独立 API 浏览器进程不作为 API 验收证据。

## Git 与 PR 流程

| 角色 | 允许操作 |
| --- | --- |
| 实现代理 | 在 `codex/issue-640-debug-node-delete` 提交任务修改；不得推送、创建 GitHub PR、合并或快进 `main`。 |
| 父代理 | 审查本分支，批准后创建/合并 GitHub PR，再同步本地 `main`。 |

## 文档影响矩阵

| 范围 | 状态 | 文件 | 说明 |
| --- | --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | 既有职责与前端 seam 仍然有效，无需重写地图。 |
| 计划文档 | Update | 本计划及中文伴随文件 | 记录范围、分支、门禁和证据。 |
| 产品规格 | Review | `docs/product-specs/prototype-functional-spec.md` | 已有模块受保护删除行为保持一致；节点后台删除是新增治理路径。 |
| 架构文档 | Update | `docs/design-docs/domain-model.md`、`docs/zh-CN/design-docs/domain-model.md` | 记录生命周期/删除保护、锁、级联和外键并发语义。 |
| API 契约 | Update | `docs/design-docs/api-contract.md`、`docs/zh-CN/design-docs/api-contract.md`、`docs/generated/openapi.json` | 记录 DELETE 响应及稳定冲突详情。 |
| 质量/测试文档 | Review | `docs/developer/verification-matrix.md`、`docs/developer/ui-quality-checklist.md` | 使用既有门禁，不新增命令或豁免。 |
| 可靠性/运行手册 | Review | `docs/RELIABILITY.md`、`docs/runbooks/` | 无部署或恢复流程变化，删除是应用事务。 |
| 安全/治理文档 | Review | `docs/SECURITY.md`、`docs/security/` | 沿用管理员授权和审计规则，审计元数据主动脱敏。 |
| 前端/设计文档 | Review | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、`docs/design-docs/ui-design-system.md` | 复用既有 table/modal 原语。 |
| 生成产物 | Update | `docs/generated/openapi.json` | 从 route/schema registry 重新生成。 |
| 参考资料 | No change | `docs/references/` | 不需要外部契约参考。 |
| 浏览器验收 | Update | `e2e/acceptance/debugging-admin.acceptance.spec.ts`、`docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md`、`scripts/check-acceptance-operation-matrix.ts` | 在 DEBUG-ADMIN-001 中扩展受保护删除和操作证据；生成的英文矩阵显示操作描述。 |

## 文档更新门禁

- [x] 中英文 API/domain 文档描述永久删除、binding 级联、历史保护和稳定错误。
- [x] 验收与操作覆盖标记 `DEBUG-ADMIN-001`；验收 spec 记录 `204` 成功和 `409` 历史保护。
- [x] OpenAPI/契约产物已重新生成并检查。
- [x] `npm run docs:check` 通过，并保留仓库文档说明的本地 pgvector 验证跳过记录。
- [x] 已完成最终审查和验证，两个语言版本均移入 `completed/`。
