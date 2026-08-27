# 调试节点级联删除与模块一致性

> English: [English](../../../exec-plans/completed/2026-08-27-debug-node-cascade-delete-module-consistency.md)

## 目标

调整调试节点永久删除语义：Admin 明确确认后，在同一事务内删除节点、协议 binding，以及所有引用该节点的 `node_operations`。当旧节点仍仅按模块名称引用模块时，禁止删除该模块；API 模式下即使模块 API 返回空列表，树形筛选器也只以 API 注册表为准。

## 分支与边界

- 分支：`codex/frontend-ui-optimization-20260827`，工作区 `/Users/tzrea1/Develop/WiseEff-worktrees/frontend-ui-optimization-20260827`。
- 保留有未提交修改的主工作区和已有服务。
- 保留 `debugging:admin`、组织范围、显式危险操作确认，以及脱敏且关联 request 的审计。
- 只删除已锁定目标节点对应的操作记录；共享调试 session 与其它节点/操作保持不变。
- 模块删除仍只允许空叶子模块。仅按名称引用的旧节点也算引用，不允许连节点一起级联删除模块。
- 本实现会话不创建或合并 PR。

## 验收与反馈环

- `npm run test:server -- server/modules/debugging/catalogSplitRepository.test.ts --run`：一个带一条 binding 和一条 operation 的节点删除后，三类数据均消失。
- `npm test -- src/DebuggingAdminPage.test.tsx --run`：仅有旧模块名称的节点不得让真实 API 模块被删除并随后重新出现在树形筛选器。
- 将 `e2e/acceptance/debugging-admin.acceptance.spec.ts`、`docs/developer/browser-acceptance-coverage-map.md` 和 `docs/developer/user-operation-coverage-matrix.md` 中的 `DEBUG-ADMIN-001` 从“受历史保护删除”改为“带审计的级联删除”。
- 在 `1440x900`、`768x1024`、`390x844` 验证 `/debugging-admin/nodes`，覆盖筛选器、删除确认、截图、snapshot、控制台错误与相关网络响应。

## 实施任务

- [x] 用确定性失败测试复现两个反馈。
- [x] 确认历史保护/外键契约，以及模块 ID 与旧名称引用不一致。
- [x] 在实现前补齐仓储、服务和 UI 回归覆盖。
- [x] 原子删除操作历史与节点，并在删除审计记录 operation/binding 数量。
- [x] 后端与前端删除保护都计入旧名称引用。
- [x] 移除 API 空模块注册表向 mock 参数模块的回退。
- [x] 更新用户确认文案、API/领域文档、OpenAPI 和验收元数据。
- [x] 运行聚焦测试、构建、文档/契约门禁与真实浏览器验证。

## Git 与 PR 工作流

| 角色 | 允许操作 |
| --- | --- |
| 实现 Agent | 在 `codex/frontend-ui-optimization-20260827` 完成有界编辑、测试与 commit；不得 push、创建 PR、合并或修改 `main`。 |
| 父 Agent | 后续 review，并决定 PR/merge 交付。 |

## 文档影响矩阵

| 区域 | 状态 | 文件 | 决定 |
| --- | --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md` | 不变：现有仓库路由和组件边界仍然正确。 |
| 计划文档 | Update | 本计划、中英文 `PLANS.md` | 记录新的数据语义与证据。 |
| 产品规格 | Review | `docs/product-specs/prototype-functional-spec.md` | 不变：未发现独立的节点历史保护产品承诺。 |
| 架构/领域 | Update | 中英文 `docs/design-docs/domain-model.md` | 改为事务内 operation 级联，并说明模块引用完整性。 |
| API 契约 | Update | 中英文 `docs/design-docs/api-contract.md`、`docs/generated/openapi.json` | 移除历史保护 `409`，保留 `204`、权限、not-found 与模块冲突。 |
| 质量/测试 | Update | `e2e/acceptance/debugging-admin.acceptance.spec.ts`、验收覆盖/操作矩阵 | 保留 `DEBUG-ADMIN-001` 的 UI/API/DB/审计证据。 |
| 可靠性/runbook | Review | `docs/RELIABILITY.md`、`docs/runbooks/` | 不变：本次仅调整有界应用事务语义，不改变运维流程。 |
| 安全/治理 | Review | `docs/SECURITY.md`、`docs/security/` | 不变：现有 Admin 授权与 High 严重度脱敏审计继续适用。 |
| 前端/设计 | Review | `docs/FRONTEND.md`、`docs/developer/ui-quality-checklist.md` | 不变：沿用模块删除保护与响应式视觉门禁，无设计系统变更。 |
| 生成物 | Update | `docs/generated/openapi.json` | 通过仓库契约源更新。 |
| 引用文档 | Review | `docs/references/` | 不变：未发现陈旧的历史保护删除契约。 |

## 文档更新门禁

计划移入 `completed/` 前，所有 Update 行必须完成、Review 行必须记录明确的 unchanged 结论；中英文配对通过 `npm run docs:check`，契约通过 `npm run contract:check`，且 `DEBUG-ADMIN-001` 继续具备自动化 UI/API/DB/审计证据。若历史孤儿模块数据无法安全自动修复，必须登记技术债，不能仅靠筛选器隐藏。

门禁已于 2026-08-27 满足。没有遗留孤儿数据修复债：唯一的旧名称引用会解析到注册模块；同名歧义引用会保守地阻止所有匹配注册模块被删除；无匹配名称则继续作为旧式条目存在。

## 验证证据

- 前端聚焦测试：模块 helper、后台页面和节点表共 35/35 通过。
- 服务端/契约聚焦测试：143/143 通过；PostgreSQL 删除回归另外证明 operation、snapshot、event、binding 和 node 均被清理，并保留一条删除审计。
- 服务端全量：361 个文件通过、1 个跳过；2777 个测试通过、4 个跳过。
- `npm run build`、`npm run contract:check`、`npm run docs:check`、`npm run acceptance:coverage`、`npm run acceptance:operations`、`npm run acceptance:models`、`npm run ui:check` 通过。数据库 schema 文档子检查因本地没有 pgvector 按规则跳过，CI 仍负责 canonical pgvector 检查。
- `npm run lint` 为 0 error、300 个既有 warning；本次涉及前端文件为 0 error、6 个既有 React Compiler warning。
- 使用隔离前端/API 端口 `5192`/`8792`，在 `1440x900`、`768x1024`、`390x844` 对 API 模式 `/debugging-admin/nodes` 完成 Playwright 验证，操作覆盖删除确认、模块树筛选、被引用模块删除保护；控制台 0 error，相关后台请求均为 200。
