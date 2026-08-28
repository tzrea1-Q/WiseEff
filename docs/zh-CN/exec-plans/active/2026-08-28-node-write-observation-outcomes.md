# 节点写命令执行与写后观测结果拆分

英文原文：[English](../../../exec-plans/active/2026-08-28-node-write-observation-outcomes.md)

## 目标

把普通节点写命令的执行结果与可选的写后回读观测拆开。写命令成功后，即使回读得到与输入表示不同的值（例如写入 `1`，回读 `0x1`），写入仍算成功；WiseEff 只展示观测值，不做相等性判定。

分支：`codex/node-write-observation-outcomes-20260828`，基线为 `main@246730efe`。

## 边界

- 覆盖 HDC、ADB、Device Bridge、simulator 和 mock 下的普通单条、批量及 Agent 审批后节点写入。
- 只要写命令可能已经执行，就保留写前快照与回滚准备。
- 不改变回滚的严格校验，也不改变 DTS reload 的行为校验。
- 真正的只写节点无法取得安全写前快照，因此拒绝写入。
- 历史 `status`、`verified` 与 `readback_mismatch` 继续作为旧策略证据保留；新写入使用显式结果字段。
- 本地测试不能替代真实 HDC/ADB 目标设备证据。

## 已确认的公开测试缝

1. `createDebuggingService().writeNode/readNode/listSessionEvents`。
2. `createRpcHandlers().handle("debug.writeNode")` 与 `writeNodeViaBridge`。
3. 调试写入、读取、会话事件的公开 HTTP 契约。
4. 节点调试应用会话的公开状态与动作。
5. `NodeDebuggingPage` 用户交互。
6. API 模式 `/node-debugging` 在 1440x900、768x1024、390x844 的浏览器验收。

数据库变更通过正式迁移及服务/API 读取验证，不测试私有迁移辅助函数。

## 结果模型

- `writeOutcome`：`executed | failed | unknown`。
- `readbackOutcome`：`observed | failed | unsupported | not_requested | unknown`。
- `targetValue` 保留请求写入值；`currentValue` 表示最近一次成功观测值。
- 回读失败时保留旧 `currentValue`，并在会话 UI 标记为可能过期。
- 写命令失败显示错误；写命令已执行但回读失败显示警告；任何成功观测值都不显示 mismatch 警告。
- “重新回读”只创建关联原写操作的新读取操作，不改写原事件，也不再次写入。

## 验收与反馈循环

- 将 `DEBUG-SIM-001` 从相等性校验调整为独立的执行/观测结果。
- 覆盖写 `1` 回读 `0x1`、写失败、回读失败、不支持回读、批量混合结果、旧值保留及只读重试。
- `HDC-LAB-001` 与 `ADB-LAB-001` 保持条件目标环境证据，覆盖同类场景。
- 每个 Red/Green 切片运行窄测试，最后运行受影响服务/前端测试、构建、文档检查及浏览器质量门禁。

## 实现任务

- [x] 新增兼容迁移和面向结果的操作契约。
- [x] 让 HDC、ADB、Bridge、simulator、mock 独立报告写命令与回读结果。
- [x] 在服务/API 中持久化两类结果、数值、技术失败、快照有效性及回读重试关联。
- [x] 更新应用会话和页面 UI，展示独立状态、批量汇总、过期旧值和只读重试。
- [x] 更新审计/历史展示与通知，不改写历史记录。
- [x] 更新当前中英文产品、API、安全、运维与验收文档。
- [x] 记录精确自动化与浏览器证据；没有真实设备时明确保留 readiness 边界。

## 文档影响矩阵

| 范围 | 影响 | 计划更新 |
| --- | --- | --- |
| 产品/调试行为 | 写成功不再依赖回读相等 | 更新中英文产品与原型说明 |
| API 与 DTO | 增加写/回读结果及重试关联 | 更新 API/设计参考与 schema |
| 安全/审计 | 分别持久化命令和观测证据 | 更新安全与审计文档 |
| Device Bridge | 增加结果能力版本与旧版推断 | 更新 Bridge/运行手册 |
| 验收 | 新普通写入不再期待 mismatch | 更新 simulator 与条件设备矩阵 |
| 历史设计 | 旧 mismatch 决策保留历史属性 | 添加被取代说明，不重写历史 |

## 文档更新门禁

- 当前行为的中英文文档保持同一结果模型。
- 公开 DTO 示例及生成/人工维护参考与代码字段一致。
- 完成前更新验收 ID 与证据预期。
- `npm run docs:check` 通过。

## Git 与 PR 流程

在明确的交付请求完成前，实现只留在 feature branch。提交、创建 PR、合入及同步本地 `main` 现在作为本次请求的交付后续执行。

## 验证证据

证据是在交付提交前从分支 `codex/node-write-observation-outcomes-20260828` 获取的，精确基线 SHA 为 `246730efefb97336428618a20bbc809334bc6fce`；提交、PR 与合入现作为本次请求的交付后续执行。

- 迁移/schema：在全新的临时 `pgvector/pgvector:pg16` 数据库中应用全部 114 个迁移（含 `0116_node_write_observation_outcomes.sql`），随后 `npm run db:schema-doc:check` 通过；临时容器已移除。
- 服务端：`npm run test:server -- --run server/modules/debugging server/modules/notifications/producers.test.ts server/modules/contracts/openapi.test.ts`，17 个文件、261 项测试通过。
- 前端：`npm test -- --run src/NodeDebuggingPage.test.tsx src/application/debugging src/infrastructure/http/debuggingDtos.test.ts src/infrastructure/http/debuggingClient.test.ts src/infrastructure/mock/mockDebuggingGateway.test.ts src/components/admin/AuditEventDetail.test.tsx`，7 个文件、138 项测试通过。
- Device Bridge：`npm run bridge:test`，21 个文件、138 项测试通过。
- 静态/构建/契约/文档：`npx tsc -b --pretty false`、`npm run build`、`npm run contract:check`、`npm run docs:check`、`npm run acceptance:coverage`、`npm run acceptance:operations` 均通过。`docs:check` 的治理检查通过，仅因当前服务缺少 pgvector 而跳过本地 schema 对比；上面的独立标准 pgvector 容器检查已通过。
- 浏览器路由/运行态：API 模式 `http://127.0.0.1:5173/node-debugging`，后端为 simulator 模式 `http://127.0.0.1:8787`；两个监听进程的 cwd 都是 `/Users/tzrea1/Develop/WiseEff-worktrees/node-write-observation-outcomes-20260828`。
- 浏览器交互：向 simulator 表示差异探针写入目标值 `2`，HTTP 200 返回 `requestedValue=2`、`readbackValue=1`、`verified=null`、`writeOutcome=executed`、`readbackOutcome=observed`；弹窗显示“写入已执行”“回读值：1”，没有 mismatch 判定。
- 浏览器视口：在 1440x900、768x1024、390x844 分别执行 snapshot 与 screenshot。移动端测得 `innerWidth=390`、`scrollWidth=390`，弹窗位于视口内（`left=28`、`right=370`、`width=342`、`bottom=832`）；未发现遮挡、裁切或横向溢出。
- 截图：`work/ui-checks/node-write-observation-outcomes-20260828/desktop-1440x900-final.png`、`tablet-768x1024-final.png`、`mobile-390x844-final.png`。
- console/network：WiseEff API 读取及写请求均成功。console 中重复 500 仅来自可选 `/local-bridge/health`，原因是 127.0.0.1:18787 没有本地 Bridge 进程；不影响 API/simulator 证据。
- 未执行的条件证据：当前无真实 HDC 目标、真实 ADB 目标或运行中的本地 Device Bridge，因此 `HDC-LAB-001`、`ADB-LAB-001` 继续标记为目标环境待验证；对应 spec 已改为断言普通写入独立结果，并保留严格回滚检查。
