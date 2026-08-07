# 项目配置工作台结构化 DTS 编辑会话（#233）

> 状态：**进行中**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-structured-edit`
> Issue：[#233](https://github.com/tzrea1-Q/WiseEff/issues/233)，父议题 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> 阻塞项：[#230](https://github.com/tzrea1-Q/WiseEff/issues/230)（已合并）
> English：[English](../../../exec-plans/active/2026-08-07-project-configuration-workbench-structured-edit.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> 起点：`4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`

## 目标

在源码上下文中交付受治理的结构化 DTS 编辑会话。授权编辑者从树、源码或搜索选择属性，经类型化检查器编辑，在任务坞审阅一项或多项更改，校验全部或所选编辑，并通过既有变更请求流程提交；源码画布保持只读。

## 范围与成功标准

1. 选择可编辑属性后打开类型化编辑器，展示取值类型、原始/规范化值、约束、风险、原因要求、权限状态与源码位置。
2. 源码画布永不成为自由文本编辑器；整文件替换仍走候选文件版本路径。
3. 类型化编辑进入本轮更改任务坞，并在树与源码 gutter 上用同一属性身份打标。
4. 编辑者可校验并提交全部或所选子集的本轮更改，而不强制纳入无关更改。
5. 提交保持既有原始值保真与受治理变更请求行为。
6. 成功提交仅清除已提交的本轮更改并刷新活跃源码/版本映射；失败保留草稿与证据。
7. 缺少参数编辑或敏感/关键能力时，以产品语言禁用写操作，同时保留可读上下文。
8. 任务坞焦点、源码选择、确认与键盘行为满足无障碍约定。
9. Port/组件测试与 API 模式浏览器验收覆盖编辑、部分提交、权限拒绝与失败恢复；登记 `PROJ-CONFIG-EDIT-001`。

## 非目标

- 候选激活（#232）、活动时间线（#239）、冲突仲裁（#236）。
- 可恢复会话草稿 / 过期基线（#234）。
- 画布上的自由文本 DTS 编辑。
- 平行的变更请求体系；复用 `submitStructuredEdits` / `aggregateLocalStructuredEdits`。
- 对 `ProjectConfigurationWorkbench` 做超出编辑会话 seam 的大范围重构。

## 架构与测试缝

| Seam | 行为 | TDD 证据 |
| --- | --- | --- |
| 工作台组件 | 属性检查器承载 `StructuredValueEditor`；会话草稿 → 任务坞；子集选择/校验/提交；产品语言权限锁定；画布只读 | `ProjectConfigurationWorkbench` 测试 |
| 会话更改标记 | 树节点与源码 gutter 与任务坞条目共享属性身份 | 工作台组件测试 |
| Ports | 复用 `DtsStructuredRepository.submitStructuredEdits`；除非必需否则不加新公共 HTTP 字段 | 既有 port 测试 + 工作台提交测试 |
| 聚合 | 复用 `aggregateLocalStructuredEdits` 保证原始值保真 | `structuredChangeSet` + 工作台 |
| API 模式浏览器 | `PROJ-CONFIG-EDIT-001` | 验收覆盖 + e2e |

测试只观察公开行为（不测私有 reducer / effect 顺序 / CSS 内部）。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在 `feat/project-configuration-workbench-structured-edit` 上工作与提交；推送功能分支；按父工作流要求开/合 PR 并关闭 #233 |
| 并行代理 | 不触碰其他代理分支；仅对外科式编辑 seam 动手 |

分支起点：`4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`（含 #231 的最新 `main`）。

## 任务

### 0. 登记计划

- [x] 创建双语活跃计划并写入 EN/ZH `PLANS.md` 当前活跃清单。
- [x] 认领 #233。
- [x] 锁定上方 TDD seams。

### A. 类型化检查器编辑 + 权限锁定

- [x] Red：选择属性打开类型化编辑字段。
- [x] Red：缺少编辑/关键能力时以产品语言禁用写入，保留只读上下文。
- [x] Green：在属性检查器接入 `StructuredValueEditor`；从父组件传入 `canEdit` / `canEditCritical`。

### B. 本轮更改任务坞 + 标记

- [x] Red：类型化编辑进入任务坞并计数；树与 gutter 共享属性身份。
- [x] Green：替换任务坞占位为会话草稿列表、选择与标记。
- [x] 确认画布永不成为自由文本编辑器。

### C. 经既有 CR 流程校验 / 子集提交

- [x] Red：全部或子集校验提交；成功仅清已提交项并刷新映射；失败保留草稿。
- [x] Green：以过滤后的聚合调用 `submitStructuredEdits`；保持原始值保真。

### D. 验收 + 文档 + 收尾

- [x] 登记 `PROJ-CONFIG-EDIT-001`。
- [x] 更新 FRONTEND（及中文）；仅在有新公共字段时改契约。
- [ ] 跑验证矩阵、三视口 UI 证据、Standards/Spec 审查并修复。
- [ ] 门禁通过后将计划移入 `completed/`。

## 浏览器验收映射

| 需求 | 操作 | 验收行为 | 证据 |
| --- | --- | --- | --- |
| `PROJ-CONFIG-EDIT-001` | `PROJ-CONFIG-EDIT-001` | Admin 打开开关后的工作台；选择可编辑属性 → 类型化编辑器；任务坞 + 标记；经 CR 部分提交；权限拒绝仍可读；提交失败保留草稿 | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-structured-edit/` |

## 验证

开发循环（定向）：

```bash
npm test -- src/components/project-configuration-workbench
npm test -- src/application/parameters/structuredChangeSet.test.ts
```

完成门禁：

```bash
npm test
npm run acceptance:coverage && npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
```

## 文档影响矩阵

| 区域 | 动作 | 确切路径 / 证据 |
| --- | --- | --- |
| 规划 | Update | 本计划 + ZH 同伴；`docs/PLANS.md`；`docs/zh-CN/PLANS.md` |
| 前端 / 设计 | Update | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` |
| API 契约 | Review | 仅在出现新公共 API 字段时更新 |
| 质量 / 测试 | Update | EN/ZH 浏览器验收图与操作矩阵；`requirements.ts`、`operationMatrix.ts`、e2e |
| 生成物 | Review | 仅在契约变更时更新 OpenAPI/db-schema |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md` |
| 产品规格 | Review | 仅在已交付工作流过时时更新 |
| 架构 / 领域 / ADR | Review | `CONTEXT.md`、相关 ADR、锁定设计 |
| 可靠性 / 安全 | Review | `docs/RELIABILITY.md`、`docs/SECURITY.md` |
| 环境 | Review | 仅在超出既有工作台开关时更新 |

## 文档更新门禁

- [x] 每个 `Update` 行在适用处已交付英文与中文。
- [x] 每个 `Review` 行已更新或在此记录为未变更并附具体证据。（API 契约 / AGENTS / ARCHITECTURE / product-spec / CONTEXT / RELIABILITY / SECURITY / env 未变——无新公共字段或超出既有工作台 flag 的环境变量。）
- [x] 完成前已登记验收需求/操作覆盖与证据归属。
- [x] `npm run docs:check` 通过。
- [ ] 无遗留 #233 验收；后续项归属 #227 后续子议题（如 #234）。
