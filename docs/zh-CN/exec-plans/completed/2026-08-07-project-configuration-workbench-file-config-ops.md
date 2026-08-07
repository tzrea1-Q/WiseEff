# 项目配置工作台文件与配置集操作（#236）

> 状态：**已完成**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-file-config-ops`
> Worktree：`/Users/tzrea1/Develop/_codex_worktrees/WiseEff-file-config-ops`
> Issue：[#236](https://github.com/tzrea1-Q/WiseEff/issues/236)，父议题 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> 阻塞项：[#230](https://github.com/tzrea1-Q/WiseEff/issues/230)（已合入；检查器/历史可用）
> English：[English](../../../exec-plans/completed/2026-08-07-project-configuration-workbench-file-config-ops.md)
> 设计：[项目配置工作台](../../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> 起点：`4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`

## 目标

将剩余的项目文件与配置集操作迁入上下文工作台区域。Admin 可在不回到旧页面的情况下创建/配置配置集、以明确角色与顺序增删成员、理解未编组文件、触发手动同步，并导出当前配置集。

## 范围与成功标准

1. 配置集选择器与检查器支持创建/配置，校验与重名处理可见。
2. 可添加成员并指定合法角色与顺序，或通过明确影响面确认后移除。
3. 未编组项目文件在显式分配前保持在工作配置与发布就绪之外可见。
4. 文件检查提供手动同步；结果进入上下文任务证据，并按需刷新相关冲突/草稿。
5. 命令上下文可导出配置集，返回成员、角色、排序与校验元数据。
6. 空配置集提供一条聚焦的候选上传/分配路径，并说明上传不会自动激活。
7. 变更、导出与移除保留 Admin 授权与持久审计；拒绝时仍可见允许的只读上下文。
8. API 与 mock 模式经 application ports 暴露相同语义操作（禁止页面级 HTTP）。
9. 定向集成/组件测试与 API 模式浏览器验收 `PROJ-CONFIG-OPS-001` 证明成员、角色、同步、导出、空态、确认与权限行为。

## 非目标

- 激活（#232）、结构化 EDIT 提交（#233）、活动时间线（#239）、超出同步刷新的冲突仲裁、发布就绪、切换。
- 自由文本 DTS 编辑。
- 整页嵌套旧 `ConfigSetBaselinePanel` / `ProjectParameterFilesPanel`。
- 触碰并行史诗分支（`structured-edit`、`candidate-activation`、`activity-timeline`）。

## 架构与接缝

| 接缝 | 行为 | TDD 证据 |
| --- | --- | --- |
| 工作台命令栏 | 创建配置集（校验+重名）；导出当前配置集 | `ProjectConfigurationWorkbench` 测试 |
| 配置集检查器 | 加成员（文件+角色+sortOrder）；列成员；ConfirmDialog 影响面移除 | 组件测试 |
| 未编组树 | 在工作配置/发布外可见；分配进当前配置集 | 组件测试 |
| 文件检查器 | 经 `ParameterFileRepository.syncFile` 手动同步；任务坞证据；按需刷新草稿/冲突 | 组件测试 |
| 空配置集 | 一条聚焦候选上传/分配路径；上传不自动激活 | 组件 + 验收 |
| Ports | `DtsStructuredRepository` create/add/remove/export；`syncFile`；mock+HTTP 已对等则只接线 UI | 既有 port 测试 + 工作台 |
| 授权 | Admin 门控写操作；非 Admin 保留只读上下文 + 拒绝说明 | `canAdmin=false` 组件测试 |
| 浏览器验收 | `PROJ-CONFIG-OPS-001` | EN/ZH 地图 + requirements + operationMatrix + e2e + playwright-cli |

复用 `ConfigSetBaselinePanel` 的校验/导出模式，但不嵌旧面板。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现智能体 | 在专用 worktree 的 `feat/project-configuration-workbench-file-config-ops` 上实现与提交；按 #236 端到端流程 push/PR/merge/close |
| 并行智能体 | 不得编辑本 worktree 或对本分支强推 |

## 任务

### 0. 注册计划

- [x] 创建双语 active plan，并写入 EN/ZH `PLANS.md`。
- [x] 认领 #236。
- [x] 锁定上述 TDD 接缝。

### A–F

与英文版任务 A–F 一一对应（创建/配置、成员增删、手动同步、导出、空态、授权与验收文档）。完成后将计划移入 `completed/`。

## 浏览器验收映射

| 需求 | 操作 | 验收行为 | 证据 |
| --- | --- | --- | --- |
| `PROJ-CONFIG-OPS-001` | `PROJ-CONFIG-OPS-001` | Admin 创建配置集、成员增删（角色/顺序+确认）、未编组隔离、手动同步入任务证据、命令栏导出、空集聚焦上传/分配且不自动激活；非 Admin 拒绝仍可见只读上下文 | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-file-config-ops/` |

## 验证

与英文版 Verification 命令相同。

## 结果

- Spec 评审修复（`cae59213`）：`canAdmin` 经 `canPerform` 真实接线；导出包含 manifest；OPS-001 e2e 加强空态与非 Admin 拒绝；验收 **5/5** 通过；三视口 UI 证据在 `work/ui-checks/project-configuration-workbench-file-config-ops/`（gitignore）。
- 计划已移入 `exec-plans/completed/`。

## 文档影响矩阵 / 更新门禁

与英文版 Documentation Impact Matrix 与 Documentation Update Gate 相同，且门禁项均已勾选。

审阅结论（未改行）：API 契约 / OpenAPI / db-schema 未变——ports 已覆盖创建/配置、成员、同步与导出，本变更为工作台接线；`AGENTS.md`、`ARCHITECTURE.md` 等仓库地图未因 #236 改变；FRONTEND（+ ZH）与验收地图已登记 `PROJ-CONFIG-OPS-001`。环境文档仍只用既有工作台开关。

浏览器证据保留在本地忽略目录 `work/ui-checks/project-configuration-workbench-file-config-ops/`。
