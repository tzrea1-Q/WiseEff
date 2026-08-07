# 项目配置工作台候选文件上传（#231）

> 状态：**进行中**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-candidate-upload`
> Issue：[#231](https://github.com/tzrea1-Q/WiseEff/issues/231)，父级 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> 阻塞于：[#230](https://github.com/tzrea1-Q/WiseEff/issues/230)（已合入 `24aabb4c5c824c9b871cc16194b3c1aebda6917d`）
> English: [English](../../../exec-plans/active/2026-08-07-project-configuration-workbench-candidate-upload.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md) · [ADR-0018](../../../adr/0018-uploaded-file-versions-are-staged-before-activation.md)
> 起点：`24aabb4c5c824c9b871cc16194b3c1aebda6917d`

## 目标

交付候选文件版本生命周期：上传 → 解析 → 影响审查 → 放弃。创建或检查候选不得改变活跃文件版本或配置集组成。激活留给 #232。

## 范围与成功标准

1. 候选持久化与公开契约表示 `uploading`、`parsing`、`ready`、`blocked`、`failed`、`abandoned`，不以活跃版本指针作为暂存。
2. 上传替换既有文件或新建项目文件会创建候选，且工作配置不变。
3. 候选影响包含文本/源码 diff、结构 diff、校验诊断、覆盖/映射影响、冲突与显式阻断。
4. 候选源码模式与检查器能区分候选与文件历史、活跃版本、工作配置、发布基线。
5. 解析失败不触碰活跃源码，并提供可操作诊断与放弃路径。
6. 被阻断的候选仍可检查，并在外部阻断变化时可重算。
7. ready / blocked / failed 候选可放弃，且不改变配置集成员或活跃源码。
8. 读写保持组织/项目作用域、权限检查，并按策略审计。
9. API/数据库集成证明非激活不变量；API 浏览器验收 `PROJ-CONFIG-CANDIDATE-001` 覆盖上传、影响、失败与放弃。

## 非目标

- 激活（#232）、结构化属性编辑提交（#233）、超出候选冲突证据展示的仲裁 UI、发布就绪度、切换。
- 自由文本 DTS 编辑。
- 从原型 `e941f236` 复制。
- 由实现代理关闭 #231 或开/合 PR。

## 架构与测试接缝

| 接缝 | 行为 | TDD 证据 |
| --- | --- | --- |
| 持久化 + HTTP/契约 | `project_parameter_file_candidates`；上述状态；create/inspect/abandon 不写 `current_version_id` / 配置集成员 | migration + repository + route + integration |
| 应用端口 | `createCandidate` / `getCandidate` / `getCandidateImpact` / `abandonCandidate`（及 list/recompute）；mock + HTTP 对等 | port + mock + client |
| 非激活不变量 | 上传/检查影响/放弃不改变活跃版本与配置集成员 | server integration |
| 工作台 UI | 启用「上传候选」；`sourceMode=candidate`；影响证据；失败诊断；阻断重算；放弃；独立身份标注 | 组件测试 |
| 授权 + 审计 | 组织/项目作用域；写需 Admin；读可 view；写路径审计 | route/service |
| 浏览器验收 | `PROJ-CONFIG-CANDIDATE-001` | EN/ZH maps + requirements + operationMatrix + e2e + playwright-cli |

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在功能分支提交；**不得** push/merge `main`、开 PR、关闭 #231 |
| 父代理 | 审查提交、开/合 PR、同步 `main`、接受后关闭 #231 |

## 任务

### 0. 注册计划

- [ ] 创建双语活跃计划并写入 EN/ZH `PLANS.md`。
- [ ] 认领 #231。
- [ ] 锁定上述 TDD 接缝。

### A–F

与英文计划相同的垂直切片：持久化 → 服务/路由 → 端口对等 → 非激活不变量 → 工作台 UI → 验收/文档/双轴审查。

## 验证

与英文计划相同的开发循环与完成门禁命令。

## 文档影响矩阵与更新门禁

与英文计划一致；完成前所有 `Update` 行双语交付，`Review` 行更新或记录未变证据，`docs:check` 通过。

## 结果 / 残留风险

_完成时填写。_
