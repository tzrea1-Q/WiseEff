# 项目配置工作台候选激活（#232）

> 状态：**已完成**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-candidate-activation`
> Issue：[#232](https://github.com/tzrea1-Q/WiseEff/issues/232)，父级 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> 阻塞于：[#231](https://github.com/tzrea1-Q/WiseEff/issues/231)（已合入 `4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`）
> English: [English](../../../exec-plans/completed/2026-08-07-project-configuration-workbench-candidate-activation.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md) · [ADR-0018](../../../adr/0018-uploaded-file-versions-are-staged-before-activation.md)
> 起点：`4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`

## 目标

以明确激活完成候选文件版本生命周期。管理员审查 ready 候选，在需要时提供配置集与成员角色意图，确认影响范围，并对照审查时的活跃版本执行激活。并发源码变更会使候选变为 stale，需重算影响后才能再次就绪，而不得覆盖工作配置。

## 范围与成功标准

1. 激活接受 expected-current-version 身份；活跃基变更时原子失败（CAS）。
2. 过期激活保留工作配置，将候选标为 `stale`，并要求重算影响后才能再次成为 `ready`。
3. 激活新文件必须显式指定目标配置集与合法成员角色；不得隐式创建成员关系。
4. 激活在同一事务中校验租户/项目作用域、能力、解析状态、硬阻断、相关冲突、成员意图与当前基。
5. 成功激活原子更新活跃成员/版本，保留先前活跃版本于历史，并写入持久审计证据。
6. UI 展示源码定位的影响确认；永不将 blocked / failed / abandoned / stale 呈现为可激活。
7. 权限不足时激活失败关闭，同时保留允许的只读上下文。
8. 激活后刷新工作源码、树计数、文件历史、候选身份与下游状态，且不做整页重置。
9. 真实数据库集成覆盖成功、过期 CAS、阻断、授权与原子回滚；浏览器验收 `PROJ-CONFIG-ACTIVATE-001` 覆盖既有文件与新文件激活。

## 非目标

- 结构化属性编辑提交（#233）、超出候选证据的冲突仲裁 UI（#236）、发布就绪度（#239）。
- 自由文本 DTS 编辑。
- 对 `ProjectConfigurationWorkbench.tsx` 做大范围重构；仅做候选激活相关的外科式改动，以降低与并行兄弟 PR 的冲突。

## 架构与测试接缝

| 接缝 | 行为 | TDD 证据 |
| --- | --- | --- |
| 持久化 | 增加 `stale` + `active`；激活/过期转换不留下半应用工作配置 | migration + repository |
| 应用服务 | `activateCandidate` 事务 CAS + 成员意图 + 审计；过期保留工作配置 | service + integration |
| HTTP / 契约 | `POST .../activate`，含 `expectedCurrentVersionId` 与可选 `configSetId`/`role` | route |
| 端口 | `ParameterFileRepository.activateCandidate`；mock + HTTP 对等 | port + mock + client |
| 工作台 UI | 影响确认；仅 `ready` 可激活；无整页重置刷新；权限失败关闭 | component |
| 浏览器验收 | `PROJ-CONFIG-ACTIVATE-001` | EN/ZH maps + requirements + operationMatrix + e2e |

## 任务

### 0. 登记计划

- [x] 创建双语活跃计划并写入 EN/ZH `PLANS.md`。
- [x] 认领 #232。
- [x] 锁定上述 TDD 接缝。

### A–E

与英文计划任务清单一致（持久化 → 服务/路由 → 端口 → UI → 验收/文档/收口）。

## 浏览器验收映射

| 需求 | 操作 | 验收行为 | 证据 |
| --- | --- | --- | --- |
| `PROJ-CONFIG-ACTIVATE-001` | `PROJ-CONFIG-ACTIVATE-001` | Admin 对既有/新文件 ready 候选做影响确认后激活；过期 CAS 保留工作配置并要求重算；blocked/failed/abandoned/stale 不可激活；权限不足失败关闭 | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-candidate-activation/` |

## 验证

与英文计划相同的 targeted / completion gates 命令。

## 文档影响矩阵与更新门禁

与英文计划相同；中英文成对交付。

## 结果 / 残余风险

已交付候选激活（`0094` 的 `stale`/`active`）、带 expected-current-version CAS 的事务性 `activateCandidate`、新文件配置集/角色意图、工作台影响确认、`PROJ-CONFIG-ACTIVATE-001` 与文档。结构化编辑（#233）、冲突仲裁 UI（#236）与发布后续仍属范围外。
