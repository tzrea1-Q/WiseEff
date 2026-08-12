# 小泽行动工具改经类型化绑定草稿提交(TD-078)

> 状态:**已完成**(2026-08-12 经 PR #326 与 #338 合并)
> 日期:2026-08-12
> 分支:`fix/xiaoze-action-semantic-submit`(叠在 `fix/xiaoze-approval-chain-single-seam` 之上)
> English: [`docs/exec-plans/completed/2026-08-12-xiaoze-action-semantic-submit.md`](../../../exec-plans/completed/2026-08-12-xiaoze-action-semantic-submit.md)

## 目标

关闭 **TD-078**:`action.submitParameterChange` 一直在提交已退役的扁平形状(`items: [{parameterId, targetValue, reason}]`),语义身份切换后所有被批准的小泽写入都在执行阶段失败("Legacy parameter submission is retired")。工具现在走切换后的正当路径——解析绑定 head 修订、创建类型化绑定草稿(`createBindingDraft`:schema 校验、写锁、候选修订、fail-closed 工具链),再以草稿身份 + `actorType: "agent"` 调 `submitParameterChanges`;`xiaoze-action` 验收文件同步去除退役的 `project_parameter_value_id` 谓词。

## 非目标

- 工具能力不超出 `action: "set"`(不给 Agent 暴露删除/使能面)。
- 不在本计划内整修更广的验收治理漂移(TD-075)。
- 不改造 CI 验收数据库为 post-cutover(记为 TD-079)。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在 `fix/xiaoze-action-semantic-submit` 上提交;不开、不合 GitHub PR |
| 父代理 | 评审、跑验证、开/合 PR,然后同步本地 `main` |

## 设计决定

- **两步语义路径、同一 actor。**草稿按 `user_id` 归属;Agent 没有独立主体,以调用方 `AuthContext` 建的草稿可在同一请求内提交。提交失败时尽力删除 Agent 建的草稿,避免滞留在用户工作台。
- **保留前置敏感节点守卫。**`assertSensitiveNodeWriteAllowed(actorType: "agent")` 在任何草稿/候选创建之前执行(critical 命中零残留);`submitParameterChanges` 在事务内复检。
- **`targetValue` 是 DTS 源文本。**`parseDtsValue` 拒绝裸字面量;工具返回带格式指引的 `VALIDATION_FAILED`,工具目录写明格式(模型可模仿 `perception.searchParameters` 的 `current_value`,其 `id` 恰是工具所需的绑定 id)。
- **不静默猜编码**(TD-065 精神):解析不了就明确失败,不做强转。
- **`resolveBindingHeadRevisionId`** 从 `editService` 的 `resolveBindingWriteLock` 抽出并双方复用,不在工具里复制 head 修订 SQL。
- 退役的裸 INSERT 兜底(无目标值的假变更请求)替换为显式 `INTERNAL_ERROR`(数据库不支持事务时)。

## 任务

1. `server/modules/agent/tools/actionTools.ts` 语义提交(见上);`server/modules/parameter-topology/editService.ts` 导出 `resolveBindingHeadRevisionId`。
2. `objectStore`(与仅测试用的 `toolchain`)穿透 `createAgentToolRegistry`、`createXiaozeAgentFactory`、`registerXiaozeRoutes`、`server/app.ts`。
3. `toolCatalog.ts`:工具描述与 schema 写明"绑定 id + DTS 文本"契约。
4. 测试:重写 `actionTools.test.ts`;扩展 `actionTools.sensitiveNode.test.ts` 与 `agUiEndpoint.assembly.test.ts`;新增**非 mock** `actionTools.integration.test.ts`(真实 pglite schema:草稿 → 变更请求、critical 敏感拒绝零残留、404 零残留)。
5. `e2e/acceptance/xiaoze-action.acceptance.spec.ts`:运行时解析种子绑定(移除退役扁平 id),谓词改 `project_parameter_binding_id`,值改为由绑定当前值派生的 DTS cell 文本。
6. 文档:追踪器 TD-078 移入 Completed、新增 TD-079(CI 验收库为 pre-cutover);`docs/SECURITY.md` 及中文伴页的小泽 P1 一句;`docs/PLANS.md` 中英条目。

## 验证结果(2026-08-12)

- `npx vitest run server/modules/agent --config vitest.server.config.ts`:34 个文件全绿,含新集成文件(真实 schema、零 parameters 模块 mock),证明草稿 → 变更请求、`target_value` 等于工具 raw text、提交后草稿删除。
- `npx vitest run server/modules/parameter-topology/editService.test.ts`:28 全绿(抽取保持行为)。
- `acceptance:coverage` / `acceptance:operations`:配合基底分支上登记的需求/操作条目全绿。
- 本地全量验收被 pinned 工具链阻塞(本机未装 `dt-validate`);CI 验收 job 安装 pinned 工具链并覆盖全链路。注意 CI 验收数据库为 **pre-cutover**(legacy 形状在那里仍被接受),这正是 TD-078 从未在 CI 暴露的原因——记为 TD-079。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | No change | 模块集合与接缝不变 |
| 计划 | Update | 本计划 + 中文伴页;`docs/PLANS.md` + `docs/zh-CN/PLANS.md` |
| 领域 / ADR | No change | ADR-0024 不受影响;除已文档化的工具契约外无新的持久决定 |
| 产品规格 | No change | 审批 UX 不变;工具现在真正完成规格早已承诺的事 |
| 架构 | No change | `ARCHITECTURE.md` 描述审批链,不涉及提交形状 |
| 质量 / 测试 | Update | 验收 spec(schema 漂移修复);registry 条目已落在基底分支 |
| 可靠性 / 运行手册 | No change | 无运维流程变化 |
| 安全 / 治理 | Update | `docs/SECURITY.md` + `docs/zh-CN/SECURITY.md` 小泽 P1(类型化绑定草稿提交措辞) |
| 生成产物 | No change | 无路由或 schema 变化 |
| 技术债 | Update | TD-078 关闭;TD-079 新增(CI 验收库 pre-cutover 漂移) |

## 文档更新门禁

- [x] TD-078 移入 Completed(含分支与证据);TD-079 已记录
- [x] `docs/SECURITY.md` 及中文伴页载明小泽 P1 的类型化绑定草稿提交路径
- [x] `docs/PLANS.md` 中英文列出本计划
- [x] 移入 `completed/` 前 `npm run docs:check` 全绿
