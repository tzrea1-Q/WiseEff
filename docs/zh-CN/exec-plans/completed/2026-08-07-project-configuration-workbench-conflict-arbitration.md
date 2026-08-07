# 项目配置工作台 — 源码定位三方冲突仲裁（#235）

> 状态：**已完成**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-conflict-arbitration`
> Issue：[#235](https://github.com/tzrea1-Q/WiseEff/issues/235)，父 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> 阻塞项：[#231](https://github.com/tzrea1-Q/WiseEff/issues/231)、[#233](https://github.com/tzrea1-Q/WiseEff/issues/233)（已关闭）
> 英文：[English](../../../exec-plans/completed/2026-08-07-project-configuration-workbench-conflict-arbitration.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §10.4 / PCW-D9
> 起点：`3b421093f266603d08117c6e6d02f41ff943c7fa`
> 关闭：TD-058（批量裁决 + 冲突载荷人类可读版本标签）

## 目标

将文件同步与候选版本分歧并入同一套**源码定位、三方对比**的冲突仲裁流程。管理员从冲突计数或源码标记打开冲突，对比共享基线值、文件/候选侧值与待处理 UI 草稿值，选择等权结果，确认将保留/丢弃的数据（可选原因写入服务端审计），并在不离开源码上下文的前提下继续处理队列。合格批量裁决需影响预览。未关闭的相关冲突继续阻止候选激活，并暴露给后续基线/发布门禁。

## 范围与成功标准

1. 每条冲突标明受影响的配置集/文件/节点/属性，并在源码中定位证据。
2. 任务坞展示基线、文件同步或候选值、待处理 UI 草稿值，以及来源与版本/时间证据。
3. 「使用文件值」与「保留界面值」视觉权重相等，任一均非默认安全选项。
4. 确认说明草稿/取值效果，并接受可选原因写入服务端审计。
5. 裁决经服务端授权、原子持久化，刷新计数/标记，并前进到下一条冲突且不丢失源码上下文。
6. 合格批量裁决需要影响预览，并排除无法在同一安全决策下处理的冲突。
7. 相关未关闭冲突阻止候选激活，并为后续基线/发布门禁暴露证据（#237）。
8. 空队列保持任务坞折叠，不渲染专用空页面。
9. API/数据库集成与 API 模式浏览器验收 `PROJ-CONFIG-CONFLICT-001` 证明两种结果、审计、授权、连续处理与源码定位。

## 非目标

- 可恢复会话草稿 / stale-base 提交门禁（#234）——不持久化会话草稿，不改离开/登出草稿状态机。
- 发布就绪 / 基线创建门禁 UI（#237）——仅保留激活阻断并暴露列表证据。
- 自由文本 DTS 编辑；将遗留整页 `ParameterFileConflictPanel` 嵌进工作台。
- 对 `ProjectConfigurationWorkbench.tsx` 的大范围重构（控制与 #234 并行冲突）。

## 架构与测试缝

| 缝 | 行为 | TDD 证据 |
| --- | --- | --- |
| 持久化 / DTO | 开放冲突列表 enrichment：baseValue、人类版本标签/时间、参数名/模块、fileId/configSetId、节点/属性、可选 locator | repository + service 测试 |
| 应用服务 | resolve（+ 可选 reason→审计）；批量预览 + 批量裁决；授权失败关闭；原子丢弃草稿 | conflictService + 集成测试 |
| HTTP / 契约 | resolve body `{ resolution, reason? }`；批量预览/裁决端点 | route 测试 |
| Ports | `resolveConflict(..., { resolution, reason? })`；bulk 预览/执行；mock + HTTP 对等 | port + mock + client 测试 |
| 工作台 UI | Conflicts 任务坞三方等权 UI；ConfirmDialog；源码定位；队列前进；空则折叠；批量影响预览 | 组件测试 |
| 激活门禁 | 保留既有 `open-conflict` blockers；验收证明阻断 | candidate + acceptance |
| 浏览器验收 | `PROJ-CONFIG-CONFLICT-001` | EN/ZH 地图 + requirements + operationMatrix + e2e |

## 任务

### 0. 注册计划

- [x] 创建双语活跃计划并写入 EN/ZH `PLANS.md`。
- [x] 认领 #235。
- [x] 锁定上表 TDD 缝。

### A–E

与英文计划同构并已完成：DTO enrichment → resolve/reason/bulk → ports → 工作台 Conflicts 坞 → `PROJ-CONFIG-CONFLICT-001` + 文档 + 完成门禁；关闭 TD-058。

- [x] 验证矩阵 + 三视口 UI 证据：`work/ui-checks/project-configuration-workbench-conflict-arbitration/`。
- [x] 计划移入 `completed/`。

## 浏览器验收映射

| 需求 | 操作 | 行为 | 证据 |
| --- | --- | --- | --- |
| `PROJ-CONFIG-CONFLICT-001` | `PROJ-CONFIG-CONFLICT-001` | 管理员在工作台任务坞打开源码定位三方冲突；等权两种结果 + 确认与可选审计原因；队列在源码上下文前进；合格批量 + 影响预览；开放冲突阻断候选激活；空队列坞折叠 | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-conflict-arbitration/` |

## 文档更新门禁

- [x] Update 行已双语交付（适用处）。
- [x] Review 行已更新或在此记录为未变更（AGENTS / ARCHITECTURE / product-spec / CONTEXT / RELIABILITY / SECURITY / env 无新增变量）。
- [x] 验收覆盖与证据归属已登记。
- [x] 无遗留 #235 验收；后续归属 #234/#237/#240。

## 收尾说明

于 2026-08-07 在 `feat/project-configuration-workbench-conflict-arbitration` 完成。

**本地已通过**

- 专用预 cutover 库 `wiseeff_acceptance`（`WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1` / `WISEEFF_LOCAL_POST_CUTOVER=0`）上 `PROJ-CONFIG-CONFLICT-001` e2e 绿灯。
- `acceptance:coverage` / `acceptance:operations` 含 `PROJ-CONFIG-CONFLICT-001`。
- 三视口 UI 证据 + 空 `console-errors.json`：`work/ui-checks/project-configuration-workbench-conflict-arbitration/`。
- 布局修复：展开任务坞 `z-index: 10`，避免检查器/主体拦截「在源码中定位」。

**残留**

- 默认本地 `wiseeff` 仍为 post-cutover；CONFLICT/EDIT 扁平 PPV fixture 需 CI/验收扁平身份宿主（或按 NOTES 重建 `wiseeff_acceptance`）。cutover 感知的冲突种子超出 #235。
