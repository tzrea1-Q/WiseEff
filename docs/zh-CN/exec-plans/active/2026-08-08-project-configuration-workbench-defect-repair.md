# 项目配置工作台缺陷修复

> 状态：**进行中** — 批次 0–3 与 CW-T1 已在 `fix/project-configuration-workbench-defects` 落地；待父 Agent 评审 / PR
> 日期：2026-08-08
> English: [`docs/exec-plans/active/2026-08-08-project-configuration-workbench-defect-repair.md`](../../../exec-plans/active/2026-08-08-project-configuration-workbench-defect-repair.md)
> 已锁定的设计：[`docs/zh-CN/design-docs/2026-08-06-project-configuration-workbench-design.md`](../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> 交付该界面的切换计划：[`docs/zh-CN/exec-plans/completed/2026-08-08-project-configuration-workbench-cutover.md`](../completed/2026-08-08-project-configuration-workbench-cutover.md)

## 背景

配置工作台（`/parameter-admin/projects/:projectId/configuration`）已完成第 1–6 阶段范围，并在 2026-08-08 切换后成为项目配置的正式入口。2026-08-08 以 Admin 身份（`xu.yun`，API 模式，种子项目 `atlas`）在 1440×900 / 768×1024 / 390×844 三个视口逐项走查后发现：该界面在每个视口都存在视觉破损，**并且它的发布通路已经死锁**。

所有尺寸均通过页面内 `getBoundingClientRect` 实测得出，不是目测。其中两项事实改变了这次工作的定性：

1. **发布通路是被数据库结构漂移阻断的，不是被业务状态阻断的。** `listOpenConflicts` 仍在查询切换前的表 `project_parameter_values`，而参数身份切换已将其更名为 `legacy_project_parameter_values`，现行表是 `project_parameter_bindings`。因此每次调用都会抛错。`releaseReadinessService` 捕获该异常后，把原始数据库错误转成了一条产品语言的阻断项，于是工作台显示 `1 阻断`，内容是 `relation "project_parameter_values" does not exist`，同时把 `canCreateBaseline` 与 `canRelease` 置为 `false`，并提示操作者去解决冲突——而 `parameter_file_sync_conflicts` 表里有 **0 行数据**。操作者无法通过任何产品操作脱离这个状态。

2. **命令栏承载过载，这一个根因产生了绝大部分可见的布局破损。** 它是一行 `flex-wrap: nowrap`，六个子项的自然宽度合计约 1660px，而容器只有 1126px。溢出部分既不滚动也不裁剪，而是直接盖在相邻元素上。

本计划记录这些问题并安排修复顺序，不重开已锁定的工作台设计。

## 目标

1. **批次 0（阻断）** — 修复冲突查询的结构漂移以恢复发布通路，停止把数据库错误当作产品语言暴露，并补上让该缺陷得以上线的测试缺口。
2. **批次 1（命令栏）** — 减少命令栏承载的内容，再让它以换行/折叠的方式降级，而不是以重叠的方式降级。
3. **批次 2（响应式）** — 修复移动端操作行、源结构排序错误与移动端遮挡。
4. **批次 3（源结构树）** — 让左侧面板的搜索区占比合理，并让节点列表具备真实层级。
5. **贯穿项** — 加强那条"在 15 处元素重叠同时存在的情况下依然通过"的布局断言。

## 非目标

- 重开已锁定的配置工作台设计或 ADR-0001 的治理域信息架构。
- CW-B1 所指的这一条冲突查询之外的参数身份切换遗留项（归 `2026-07-16-parameter-topology-*` 系列计划）。
- 重新设计 DTS 源码查看器、检查器的信息模型或任务坞的内容。
- 小泽 Agent 的行为；仅其启动器在小视口下的位置属于本计划范围（CW-D8）。

## Git 与 PR 流程

| 角色 | 允许的操作 |
| --- | --- |
| 实施 Agent | 在 `fix/project-configuration-workbench-defects` 上提交；不得开启或合并 GitHub PR |
| 父 Agent | 评审、运行验证、开启并合并 PR，然后同步本地 `main` |

分支：`fix/project-configuration-workbench-defects`，从最新 `main` 检出。批次 0 应独立合并，因为它是改动面很小的正确性修复；批次 1–3 可以从 `main` 重新排到后续分支上。

## 问题清单

### 批次 0 — 阻断级缺陷

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| CW-B1 | `listOpenConflicts` 关联了 `project_parameter_values` 并读取 `ppv.current_value` / `ppv.source_node_path`。该表已被身份切换更名为 `legacy_project_parameter_values`，现行表是 `project_parameter_bindings`，且 `parameter_file_sync_conflicts` 已经改带 `project_parameter_binding_id`（而非 `project_parameter_value_id`）。每次调用都抛出 `relation "project_parameter_values" does not exist`。该函数有 **六个生产调用点**：冲突列表路由、发布就绪度、冲突解决、批量解决，以及两处候选激活路径。 | `server/modules/parameters/repository.ts:2819-2889`（关联语句在 2862）；调用方见 `server/modules/parameter-files/routes.ts:442`、`releaseReadinessService.ts:282`、`conflictService.ts:34,137,209`、`candidateService.ts:395,607` |
| CW-B2 | `releaseReadinessService` 捕获冲突查询的任何失败后，把 `error.message` 原样塞进命令栏展示的 `blocker`，并给出一个指向空冲突坞的处置建议。基础设施故障被呈现为一个要求操作者去清除的产品状态，同时静默禁用了基线的创建与发布。 | `server/modules/parameter-files/releaseReadinessService.ts:286-295` |
| CW-T2 | 所有涉及 `listOpenConflicts` 的单元测试都用 `vi.mock` 把它替换掉，因此没有任何测试执行过它的 SQL。这次漂移对 `npm run test:server` 完全不可见。 | `routes.test.ts:27`、`releaseReadinessService.test.ts:22`、`conflictService` 相关用例、`dtsSearchRoutes.test.ts:24`、`structuralReadRoutes.test.ts:25`、`configSetBaselineRoutes.test.ts:29` |

CW-B1/CW-B2 的证据，取自本地种子数据库的实时调用：

```json
{ "level": "blocked", "canCreateBaseline": false, "canRelease": false,
  "blockers": [ { "code": "open-conflict",
    "message": "relation \"project_parameter_values\" does not exist",
    "remediation": { "label": "Resolve conflict in the Conflicts task dock" } } ] }
```

### 批次 1 — 命令栏

命令栏 `.configuration-workbench__command` 在 1440×900 下宽 1126px，承载六个子项，其自然宽度合计约 1660px。由于它是 `flex-wrap: nowrap` 且 `overflow: visible`，宽度缺口由"允许收缩"的那个子项吸收，其余部分直接盖到相邻元素上。

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| CW-A1 | 根因：命令栏同时承担六件互不相关的事——返回导航、项目身份、配置集选择、**配置集创建表单**、三个版本身份 chip、六个操作按钮。没有任何 flex 规则组合能装下这些内容；必须缩减集合本身。 | `src/styles.css:25915-25923`；`ProjectConfigurationWorkbench.tsx` 命令栏渲染处 |
| CW-D1 | `.configuration-workbench__identities` 同时设置了 `min-width: 0`、`white-space: nowrap` 与 `overflow: visible`。它被压到 123px 而内容需要 386px，于是内容既不换行也不裁剪：**实测 15 处重叠**，三个版本 chip 全部盖在「已阻断 / 活动 / 检查器」控件上，`发布基线：seed-v1` 甚至盖住了按钮图标。 | `src/styles.css:25978-25987` |
| CW-D2 | `.configuration-workbench__project` 被压到 36px，而内容需要 114px。其中 `<strong>` 有 `text-overflow: ellipsis`，降级为 `Atla…` 尚可接受；但两个 `<span>`（`ATL-Intl`、`在研`）没有任何截断保护，被挤成竖排字符并溢出到配置集下拉框上。 | `src/styles.css:25932-25953` |
| CW-D4 | 在 ≤768px 的媒体查询中，`order` 被分配给了返回 / 项目 / 配置集选择 / identities / unavailable-actions，**唯独漏掉 `__create-config`**，于是它保持 `order: 0` 排到所有元素之前。390×844 实测：创建表单位于 `y=80`，而「项目清单」被挤到 `y=133`。 | `src/styles.css:26958+` 与 `26307-26313` 对照 |
| CW-D5 | `.configuration-workbench__project` 使用 `grid-template-columns: auto auto`，在窄容器中挤成一团，在宽容器中散开。768×1024 下 `在研` 被推到 x≈450，与 `ATL-Intl` 相距很远，三段身份信息不再被读作一个整体。 | `src/styles.css:25932-25939` |

### 批次 2 — 响应式

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| CW-D3 | 390×844 下操作行让五个按钮在 282px 内按 `flex: 1 1 0` 均分。实测：「上传候选 / 导出配置集 / 创建基线」渲染为 **宽 43px、高 69–82px**，每行一个汉字。 | `src/styles.css:27050-27052` |
| CW-D8 | 390×844 下小泽启动器提示浮在源码画布上遮挡代码，自身文案折成四行；源码标题把「工作配 置」从词中断开，`atlas-board.dts` 也被拆成两行。 | `src/styles.css` 小泽 toggle 规则；工作台源码标题 |

### 批次 3 — 源结构树

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| CW-D6 | `.configuration-workbench__search` 是单列 grid，因此查询输入框、「搜索」、「下一个」与行号跳转各占一整行。实测高 187px，占 630px 树面板的 30%，而此时尚未显示任何结果。 | `src/styles.css:26145-26158` |
| CW-D7 | 节点列表把完整路径（`amba/i2c@FF24E000/hl7603@…`）平铺渲染，没有缩进，然后再省略号截断，因此父子结构不可读，面板滚动高度达 1847px。这正是观感上那一列"居中胶囊"的来源。 | `src/styles.css:26184-26221`；成员/节点树渲染处 |

### 贯穿项 — 验证缺口

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| CW-T1 | `PROJ-CONFIG-READ-001` 声称覆盖"三视口工作台布局，无裁切、无页面级横向溢出"，但它唯一的布局断言是 `document.documentElement.scrollWidth <= clientWidth`。实测：在 15 处元素重叠同时存在的情况下，`1440 <= 1440` 依然**通过**——因为在受约束的 flex 行内以 `overflow: visible` 溢出的子元素根本不会增加文档滚动宽度。该断言提供的是虚假的安全感。 | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts:159-166,198-202` |

## 决策 — 2026-08-08 已拍板

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| CW-DEC-1 | 配置集创建移出命令栏。配置集下拉框新增 `+ 新建` 入口，点击打开基于共享 `ModalDialog` 原语构建的对话框。 | 创建入口出现在用户本来就在选配置集的地方，因此不必为低频操作长期占用宽度。复用 `ModalDialog` 可直接继承焦点陷阱与背景惰性契约，避免再增加一个手写弹层（参见 TD-059）。 |
| CW-DEC-2 | 保留「工作配置」chip 常驻，候选与基线身份折叠到它后面。 | 工作配置回答的是"我现在看的是什么"，必须在任何宽度下都可读。候选与基线属于参考信息，检查器本来就承载它们。 |
| CW-DEC-3 | 主操作：就绪度摘要、检查器、上传候选。收进「更多」菜单：活动、导出配置集、创建基线。 | 就绪度承载阻断状态，不能隐藏；检查器是源码画布的主要导航搭档；上传候选是配置流程的日常入口，而创建基线是周期末尾的审慎操作，用户会专门去找。 |
| CW-DEC-4 | 项目身份只显示名称，编号与状态放进 tooltip。 | 进入工作台后项目属于稳定上下文，不需要持续重复陈述。单行省略从根本上不可能产生 CW-D2 里那种竖排字符堆叠。 |

### 决策落地后的宽度预算

以实测自然宽度，对照当前承载约 1660px 的同一个 1126px 容器重新计算：

| 元素 | 修改前 | 修改后 | 说明 |
| --- | --- | --- | --- |
| 项目清单返回 | 96 | 96 | 不变 |
| 项目身份 | 114 | 上限约 140 | 单行省略（CW-DEC-4） |
| 配置集选择 | 188 | 188 | 同时承载 `+ 新建` 入口（CW-DEC-1） |
| 创建配置集表单 | 约 280 | 0 | 移出命令栏（CW-DEC-1） |
| 版本身份 | 386 | 约 100 | 工作配置 chip 加一个折叠控件（CW-DEC-2） |
| 操作组 | 537 | 约 360 | 三个主控件加「更多」（CW-DEC-3） |
| 间距 | 60 | 48 | 少一个子项 |
| **合计** | **约 1660** | **约 932** | 在 1126px 内富余约 194px |

富余量和"装得下"同样重要：正是这 194px 让更长的项目名或更宽的就绪度标签能够被吸收，而不会重新引发重叠。批次 1 必须在实现后重新实测，而不是采信这份估算；长期守住这个余量的是 CW-T1 的元素级断言。

## 交付批次

### 批次 0 — 阻断

1. [x] CW-B1：把 `listOpenConflicts` 的查询指向切换后的结构（经由 `parameter_file_sync_conflicts.project_parameter_binding_id` 关联 `project_parameter_bindings`），并确认 `base_value` / `source_node_path` 这两项富化字段在切换后有真实来源，否则从 DTO 中移除并同步更新其消费方。
2. [x] CW-T2：新增一个针对已迁移结构执行真实 SQL 的仓储测试（不使用 `vi.mock`），使该查询无法再与实际表结构漂移；并验证六个调用点全部可用。
3. [x] CW-B2：停止把原始异常文本作为产品阻断项呈现。基础设施故障应上报为"就绪度不可用"，与"存在未解决冲突"区分开，并且不得给出通向空任务坞的处置建议。
4. [x] 端到端验证：对无冲突的种子项目，`release-readiness` 返回非阻断级别，且「创建基线」变为可用。

### 批次 1 — 命令栏

5. [x] 敲定 CW-DEC-1 – CW-DEC-4 并记录到本文档（2026-08-08）。
6. [x] CW-A1 / CW-D4：把配置集创建改为配置集下拉框上的 `+ 新建` 入口并由 `ModalDialog` 承载，同时从命令栏删除 `__create-config`。这也从源头消除了 CW-D4——那个缺失 `order` 的元素已不在命令栏中。
7. [x] CW-D1：保留「工作配置」chip，将候选与基线折叠到其后；在宽度可被压缩的前提下，`__identities` 绝不允许 `overflow: visible` 与 `nowrap` 并存。
8. [x] CW-D2 / CW-D5：将项目身份渲染为单行省略，编号与状态置于 tooltip，替换掉那个"窄则挤、宽则散"的 `grid-template-columns: auto auto`。
9. [x] CW-D3 前置：将操作组拆分为主操作（就绪度、检查器、上传候选）与「更多」菜单（活动、导出配置集、创建基线）。
10. [x] 在 1440/1024/768/390 下对照上述宽度预算重新实测命令栏，确认富余量是实测结果而非估算。

### 批次 2 — 响应式

11. [x] CW-D3：在标签无法单行显示的宽度以下，停止对操作行做等分 flex 分配；采用批次 1 的主次操作划分。
12. [x] CW-D8：390px 下让小泽启动器避开源码画布，并修复源码标题的折行。

### 批次 3 — 源结构树

13. [x] CW-D6：压缩搜索区，使树列表占据面板的主体部分。
14. [x] CW-D7：将节点列表渲染为带缩进的层级结构，每项显示自身路径段，完整路径按需展示。

### 贯穿项

15. [x] CW-T1：把页面级溢出断言替换为元素级检查——在同级矩形相交、或子元素超出其容器时失败；先确认它在当前 `main` 上会失败，再确认批次 1–3 完成后通过。
16. [x] 在 1440×900 / 768×1024 / 390×844 三视口产出 playwright-cli 证据，且控制台 0 错误。

## 关键接缝（切入点）

- 命令栏标记：`src/components/project-configuration-workbench/ProjectConfigurationWorkbench.tsx`。
- 命令栏样式：`src/styles.css:25915-26030`；响应式规则在 `26914`（≤900px）、`26933`（≤1024px）、`26958`（≤768px）。
- 源结构树样式：`src/styles.css:26145-26280`。
- 冲突查询：`server/modules/parameters/repository.ts:2819`。
- 就绪度组装：`server/modules/parameter-files/releaseReadinessService.ts`。
- 验收用例：`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。

## 文档影响矩阵

| 领域 | 处理 | 路径 |
| --- | --- | --- |
| 仓库地图 | 无变更 | `AGENTS.md`、`ARCHITECTURE.md` — 信息架构与模块边界均未变化 |
| 规划 | 更新 | 本计划；`docs/PLANS.md`；`docs/zh-CN/PLANS.md`；英文对应计划 |
| 产品规格 | 复核 | 若 CW-DEC-1/CW-DEC-3 改变了配置集创建与次要操作的调用位置，需复核 `docs/product-specs/prototype-functional-spec.md` |
| 架构 / ADR | 复核 | `docs/design-docs/2026-08-06-project-configuration-workbench-design.md`（含中文版）— 确认命令栏缩减仍在已锁定设计范围内；若 CW-DEC-1/3 改变界面契约则需修订 |
| 前端 / 设计 | 更新 | `docs/FRONTEND.md`（含中文版），补充命令栏降级模式与源结构树层级模式 |
| 质量 / 测试 | 更新 | `docs/developer/browser-acceptance-coverage-map.md`（含中文版）记录强化后的 `PROJ-CONFIG-READ-001` 布局断言；若操作覆盖变化则同步 `docs/developer/user-operation-coverage-matrix.md`（含中文版） |
| 安全 / 治理 | 无变更 | 预期无鉴权或审计行为变化 |
| 可靠性 / 运行手册 | 复核 | 就绪度信号从"阻断"细分出"不可用"后，是否需要运行手册指引 |
| 生成产物 | 复核 | 若 CW-B1 需要迁移而非仅改查询，需更新 `docs/generated/` 的库结构摘要 |
| 参考资料 | 复核 | 若就绪度 DTO 新增"不可用"状态，需同步 `docs/references/productization-api-contract-draft.md` |

## 文档更新闸门

在把本计划移入 `completed/` 之前：

1. 影响矩阵中每一条 `更新` / `复核` 都已更新，或已附证据记录为无变化。
2. CW-DEC-1 – CW-DEC-4 已记录所选方案及理由。
3. 所有批次均已交付，或剩余部分已重新登记到 `docs/zh-CN/exec-plans/tech-debt-tracker.md`（下一个可用编号：**TD-062**）。
4. `npm run docs:check` 通过。

## UI 交互覆盖

每个批次都改变了面向用户的交互行为，因此适用 UI 交互自动化规则。

- `PROJ-CONFIG-READ-001` 已经承担了三视口布局这一声明；CW-T1 应当强化它的断言，而不是新增编号——因为现有编号已经承诺了它实际并未检查的内容。
- `PROJ-CONFIG-READINESS-001` 覆盖了 fail-closed 的创建/发布。批次 0 必须扩展它，以区分*被未解决冲突阻断*与*就绪度不可用*，使未来的基础设施故障无法再伪装成产品阻断项。
- `PROJ-CONFIG-CONFLICT-001` 通过被 mock 的仓储接缝走查冲突仲裁；批次 0 必须确认它仍覆盖切换后的查询，或补充真实结构的覆盖。
- 批次 1–3 改变的是命令栏与树的呈现而非能力，因此扩展现有编号即可，无需新增。操作证据仍须通过 `npm run acceptance:browser` 或 `npm run acceptance:evidence` 重新生成。

## 验证

```bash
npm run test:server -- server/modules/parameters/repository.test.ts
npm run test:server -- server/modules/parameter-files
npm test -- src/components/project-configuration-workbench
npm run build
npm run docs:check
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
# 浏览器证据存放于 work/ui-checks/project-configuration-workbench-defect-repair/
```

批次 0 另需针对已迁移数据库做实时校验：

```bash
curl -s -H "Authorization: $WISEEFF_SMOKE_AUTHORIZATION" \
  "http://127.0.0.1:8787/api/v1/projects/atlas/parameter-file-conflicts"
curl -s -H "Authorization: $WISEEFF_SMOKE_AUTHORIZATION" \
  "http://127.0.0.1:8787/api/v1/projects/atlas/config-sets/dcs-default-atlas/release-readiness"
```

批次 0 完成后的预期：第一个接口返回 `200` 并带 items 数组；第二个接口对冲突行数为 0 的项目不再报告 `open-conflict` 阻断项，且允许创建基线。
