# 项目配置工作台检查器与文件历史（#230）

> 状态：**进行中**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-inspector-history`
> Issue：[#230](https://github.com/tzrea1-Q/WiseEff/issues/230)，父议题 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> 阻塞项：[#229](https://github.com/tzrea1-Q/WiseEff/issues/229)（已合入 `b12166b003094b31093675f1f65ab255c26d990f`）
> English：[English](../../../exec-plans/active/2026-08-07-project-configuration-workbench-inspector-history.md)
> 设计：[项目配置工作台](../../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> 起点：`b12166b003094b31093675f1f65ab255c26d990f`

## 目标

在已具备源码定位导航的只读配置工作台上，补齐上下文检查模型：Admin 可检查所选配置集、文件、DTS 节点或属性；沿对象上下文回退；浏览不可变文件版本历史并下载选定版本；临时进入历史或对比源码模式且不丢失先前工作配置源码位置。

## 范围与成功标准

1. 选择配置集 / 文件 / 节点 / 属性时打开对应检查器内容，且不意外改变源码身份。
2. 检查器回退遵循 属性 → 节点 → 文件 → 配置集，并保留源码选择。
3. 文件检查展示格式、成员角色、活跃版本、不可变版本历史、来源、创建者/时间（若已知）及按版本下载。
4. 节点/属性检查展示源码路径/span、labels/compatible、类型化 raw/normalized 值、风险、来源链与读权限状态。
5. 历史与已发布源码明显只读，不会被误认为工作配置。
6. 进入/离开历史、unified diff、side-by-side diff 后恢复先前源码目标与滚动位置。
7. 文件版本、工作配置、候选文件版本占位、发布基线身份各自独立标注。
8. 检查器默认以桌面叠层呈现；仅当源码画布仍 ≥640px 时变为常驻（按工作台可用宽度测量——PCW-D15）。
9. 检查器导航、历史、下载、源码模式、无障碍与浏览器布局测试在 mock+API 通过；注册 `PROJ-CONFIG-INSPECT-001`。

## 非目标

- 候选上传/激活（#231+）、结构化 EDIT 提交（#233）、冲突、发布就绪度、切换。
- 自由文本 DTS 编辑（画布保持只读）。
- 从 `codex/prototype-config-workbench` / `e941f236` 合并或抄袭实现。
- 由实现智能体关闭 #230 或开/合 PR。

## 架构与接缝

| 接缝 | 行为 | TDD 证据 |
| --- | --- | --- |
| 工作台组件 | 按选择层级的检查器内容；回退栈；源码模式切换；身份标签；宽度常驻规则（源码 ≥640px） | `ProjectConfigurationWorkbench` 测试 |
| Ports | 经既有 `ParameterFileRepository` 列出版本 / 下载历史版本（必要时用 `DtsStructuredRepository`）；页面不直连 HTTP | 工作台 + mock/HTTP port 测试 |
| Mock + HTTP 对等 | 历史列表/下载对等 | mock / client 测试 |
| 源码画布模式 | `working` \| `history` \| `unified-diff` \| `side-by-side`（满足 AC 的最小实现）；退出时恢复滚动/选择 | 工作台组件测试 |
| 契约/文档 | 仅当出现新公共 API 字段时更新 | 契约/文档门禁 |
| API 浏览器验收 | `PROJ-CONFIG-INSPECT-001` | acceptance + e2e + playwright-cli 证据 |

遗留 URL `sourceMode=structured|raw` 视为工作配置画布模式的别名，以保持 #229 深链可用。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现智能体 | 仅在 `feat/project-configuration-workbench-inspector-history` 上开发并本地 commit；**不得** push/合并 `main`、开 PR 或关闭 #230 |
| 父智能体 | Review commits、开/合 PR、同步本地 `main`，验收后关闭 #230 |

分支起点为 `b12166b003094b31093675f1f65ab255c26d990f`（PR #243 / 源码定位导航合入）。

## 任务

### 0. 注册计划

- [x] 创建双语活跃计划并写入 EN/ZH `PLANS.md` 当前活跃计划列表。
- [x] 认领 #230。
- [x] 锁定上述 TDD 接缝。

### A–F

与英文计划任务一一对应：检查器层级与回退、文件历史与下载、节点/属性字段、源码模式与恢复、叠层/常驻检查器、验收与文档收口。细节以英文计划为准。

## 浏览器验收映射

| 需求 | 操作 | 验收行为 | 证据 |
| --- | --- | --- | --- |
| `PROJ-CONFIG-INSPECT-001` | `PROJ-CONFIG-INSPECT-001` | Admin 打开开关后的工作台；选择配置集/文件/节点/属性 → 对应检查器；回退保留源码；文件历史与下载；历史/unified/side-by-side 模式恢复目标与滚动；身份标注；叠层 vs 源码 ≥640px 常驻 | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-inspector-history/` |

## 验证

与英文计划相同的 targeted 与 completion 命令矩阵；三视口证据目录为 `work/ui-checks/project-configuration-workbench-inspector-history/`；相对固定点 `b12166b0` 做 Standards/Spec 双轴审查。

## 文档影响矩阵与更新门禁

与英文计划相同的 Update/Review 行与门禁清单；中英文需同步交付 Update 行。
