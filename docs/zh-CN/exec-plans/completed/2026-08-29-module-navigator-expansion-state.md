# 保留共享模块导航各分支的展开状态

英文原文：[English](../../../exec-plans/completed/2026-08-29-module-navigator-expansion-state.md)

**状态：** 实施中的计划

**基线：** `main@8bb53fdee7d87405d5ac1ba93d113a77464ea057`

**分支：** `fix/module-navigator-expansion-20260829`

## 目标

用户在任意共享 `DtsTopologyNavigator` 中选择模块时，只自动展开选中节点所在的祖先路径；用户此前手动折叠的其他根节点或分支必须保持折叠。现有首次加载默认展开策略、键盘行为和展开/折叠按钮行为不能改变。

## 现象与根因

当前共享导航组件把 `expansionPath` 同时用于首次展开和选中状态同步。`expansionPath` 一开始就加入所有拥有子节点的根节点，再加入选中节点的祖先。选中状态变化时，effect 将这个结果合并进当前展开集合，因此任意选中操作都会重新加入所有可展开根节点，把用户刚刚折叠的其他分支也全部展开。

缺陷位于共享前端状态同步边界，不在 API、树构建逻辑、独立的模块选择器或归属树组件中。直接消费者包括参数工作台、`/dts-reload`、`/node-debugging` 和 `/parameter-admin/specs`。

## 完成标准

- 折叠全部根节点、只打开一个根节点并选择其后代后，选中路径可见，所有无关根节点仍然折叠。
- 首次 `expandAllByDefault`、`defaultExpandDepth`、仅根节点默认展开、异步树数据到达、选中隐藏后代等现有行为保持不变。
- 展开按钮仍然只改变展开状态，行点击仍然只负责选中，不直接切换展开状态。
- 不引入 API、持久化、路由或后端改动。
- 回归测试在实现前先 Red，实现后 Green。

## 范围与非目标

范围：

- `src/components/parameter-topology/DtsTopologyNavigator.tsx`
- `src/components/parameter-topology/DtsTopologyNavigator.test.tsx`
- 本计划及其英文对应文件。

非目标：

- `ModuleTreeSelect`、`TreeFilterOptions`、`ModuleAttributionTree`。它们使用不同的状态模型，不在本次缺陷路径上。
- 树数据排序、模块筛选、URL 状态、API 契约、CSS 和无关导航行为。

## 设计

1. 保持首次展开策略独立。首次状态仍可根据全展开配置、深度配置、根节点默认策略和选中路径生成，与现在的行为一致。
2. 新增只服务于选中同步的路径辅助函数，从选中节点沿父级向上遍历，只返回该路径上拥有子节点的节点，不能加入无关根节点。
3. 同步 effect 只清理已经不存在的节点 ID；异步数据第一次出现时才补入首次展开状态，后续只合并选中路径。其他分支已有的 ID 必须保留，使用户的手动折叠继续生效。
4. 保持行与展开按钮的事件契约：展开按钮调用 `setExpanded`，行调用 `onSelectNode`。选中节点可以通过状态同步使自身路径可见，但不能重置整棵树。
5. 在公开组件边界增加两个可展开根节点的受控回归测试，执行复现用户问题的操作序列，并同时断言选中路径和无关根节点的折叠状态。

## 实施任务

- [x] 在源代码变更前添加本计划及双语文档影响记录。
- [x] 添加多根节点回归测试，运行聚焦测试并记录当前失败行为。
- [x] 拆分首次展开与选中路径辅助逻辑，以最小范围调整状态同步。
- [x] 修复后运行聚焦测试，再运行前端、静态检查、构建和文档门禁。
- [x] 在桌面、平板、移动端真实浏览器中验证 `/dts-reload` 和 `/node-debugging` 的交互，并复核其他共享消费者。
- [x] 执行独立 Standards/Spec 审查，记录结论并在交付前解决可执行意见。
- [x] 只有在验证完成后归档本计划及英文对应文件，再创建、检查、合并并核验 GitHub PR。

## 交互与验收覆盖

本次修复的是已有交互不变量，不新增业务操作。已复核并继续由以下覆盖负责受影响的工作流：

| 共享消费者/工作流 | 验收需求 | 操作 ID | 现有 spec | 计划处理 |
| --- | --- | --- | --- | --- |
| 参数工作台拓扑浏览 | `PARAM-TOPOLOGY-BROWSE-001` | `PARAM-TOPOLOGY-BROWSE-001` | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | 保留现有端到端流程，在共享组件边界锁定跨根展开不变量。 |
| 规格治理目录导航 | `PARAM-SPEC-GOVERN-001` | `PARAM-SPEC-GOVERN-001` | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | 复核共享消费者路径，不新增操作。 |
| 节点调试模块浏览 | `DEBUG-SIM-001` | `DEBUG-SIM-001` | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` | 保留既有模块子树浏览流程，多根回归放入 `DtsTopologyNavigator.test.tsx`。 |
| 参数调试重载流程 | `DTS-RELOAD-DEPLOY-001` | `DTS-RELOAD-DEPLOY-001` | `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts` | 复核共享导航消费者，不改变 API 或操作证据契约。 |

上述验收套件负责路由级工作流和既有操作证据；本缺陷是可复用的局部状态不变量，最适合在带受控选中的公开组件边界上用多根 fixture 稳定断言。为同一契约增加多个路由验收会造成重复。修复后仍会在真实 `/dts-reload` 和 `/node-debugging` 页面执行浏览器交互验证。

## 验证矩阵

- Red/Green：`npx vitest run src/components/parameter-topology/DtsTopologyNavigator.test.tsx`。
- 前端回归：`npm test -- --maxWorkers=4`（同时记录默认无限制并发运行的基线不稳定性），以及聚焦组件和直接消费者套件。
- 静态/构建：`npm run lint -- --no-cache`、`npm run build`、`npm run ui:check`、`git diff --check`。
- 文档、覆盖和操作证据：`npm run docs:check`、`npm run acceptance:coverage`、`npm run acceptance:operations`、`npm run acceptance:evidence`。
- 浏览器运行态：mock 模式下验证 `/parameters`、`/dts-reload`、`/node-debugging` 和 `/parameter-admin/specs`；在 `1440x900`、`768x1024`、`390x844` 执行 snapshot、screenshot、共享导航折叠/打开/选中交互、console error 检查和布局/溢出检查。截图放在 `work/ui-checks/module-navigator-expansion-20260829/`。
- 本次不改服务端、数据库或 Bridge；PR CI 仍是仓库级最终门禁。

## 文档影响矩阵

| 范围 | 状态 | 精确路径/证据 | 说明 |
| --- | --- | --- | --- |
| 仓库索引 | Review | `AGENTS.md`、`ARCHITECTURE.md`、`docs/README.md`、`docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | 已复核共享消费者和仓库路由；不需要更新索引。 |
| 计划文档 | Update | `docs/PLANS.md`、`docs/exec-plans/active/2026-08-29-module-navigator-expansion-state.md`、`docs/zh-CN/exec-plans/active/2026-08-29-module-navigator-expansion-state.md` | 记录分支、范围、门禁、审查结论和最终证据；交付后归档两份计划。 |
| 产品规格 | No change | `docs/product-specs/prototype-functional-spec.md`、`docs/zh-CN/product-specs/prototype-functional-spec.md` | 修复恢复已有逐节点交互，不改变工作流和术语。 |
| 架构文档 | Review | `CONTEXT.md`、`docs/design-docs/full-stack-architecture.md`、`docs/zh-CN/design-docs/full-stack-architecture.md` | 不改变 API、持久化或领域所有权。 |
| 质量/测试文档 | Review | `docs/developer/verification-matrix.md`、`docs/developer/ui-quality-checklist.md`、`docs/design-docs/testing-strategy.md`、`docs/zh-CN/design-docs/testing-strategy.md` | 已执行现有聚焦、全量、构建、UI 和浏览器门禁。 |
| 可靠性/运行手册 | No change | `docs/RELIABILITY.md`、`docs/zh-CN/RELIABILITY.md`、`docs/runbooks/README.md`、`docs/zh-CN/runbooks/README.md` | 不改变运行时、部署或运维行为。 |
| 安全/治理文档 | No change | `docs/SECURITY.md`、`docs/zh-CN/SECURITY.md`、`docs/security/README.md`、`docs/zh-CN/security/README.md` | 不改变授权、审计、设备写入或治理契约。 |
| 前端/设计文档 | Review | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、`docs/design-docs/ui-design-system.md`、`docs/zh-CN/design-docs/ui-design-system.md`、`docs/design-docs/2026-07-20-dts-topology-expand-collapse-design.md`、`docs/zh-CN/design-docs/2026-07-20-dts-topology-expand-collapse-design.md` | 已复核共享消费者、UI 门禁和逐节点展开设计；不需要更新设计文档。 |
| 生成产物 | No change | `docs/generated/acceptance-operation-evidence.md`、`docs/generated/acceptance-operation-evidence/index.json`、`docs/generated/db-schema.md` | 不涉及 schema 或生成运行时产物。 |
| 参考资料 | No change | `docs/references/productization-api-contract-draft.md` | 不影响外部契约参考。 |
| 浏览器验收 | Review | `docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md`、`docs/zh-CN/developer/browser-acceptance-coverage-map.md`、`docs/zh-CN/developer/user-operation-coverage-matrix.md` | 已复核 `PARAM-TOPOLOGY-BROWSE-001`、`PARAM-SPEC-GOVERN-001`、`DEBUG-SIM-001`、`DTS-RELOAD-DEPLOY-001`；组件回归和本地浏览器证据补充路由级流程。 |
| 治理脚本 | No change | `scripts/bilingual-docs.ts`、`scripts/check-doc-governance.ts`、`scripts/check-operation-evidence.ts` | 现有治理和证据检查已足够。 |

## 文档更新门禁

- 中英文计划语义一致，并互相链接。
- 已复核共享消费者文档和展开/折叠设计；当前行为文档无需更新。
- 已登记上述四组既有验收/操作 ID，保留组件回归测试，并在归档前运行 `npm run acceptance:evidence`。
- `npm run ui:check` 和浏览器证据覆盖四个共享消费者；当前 mock `/parameters` 是不带导航树的参数工作台变体，已明确记录该边界。
- 计划归档后 `npm run docs:check` 通过；`active/` 与 `completed/` 中不存在同名文件。

## Git & PR Workflow

实现仅在 `fix/module-navigator-expansion-20260829` 分支进行，基于上述最新 `main` 精确 SHA。feature branch 包含源码、测试和计划证据。完成本地验证及独立审查后，由主代理创建 PR，等待必需检查，通过后合并并删除分支，核验合并 SHA 和远程 `main`，再快进干净的 main 工作区。`/Users/tzrea1/Develop/WiseEff` 中无关的脏工作区保持不动。

## 审查记录

- Standards 审查：已修正计划标题、精确路径影响矩阵、操作证据命令、UI 门禁、全部消费者浏览器范围和测试 harness 语义命名；审查者未发现剩余硬性规范违反。重复的局部 harness 只是测试文件中的小型判断性建议，为避免单个回归引入更大抽象而保留在本地。
- Spec 审查：通过。首次默认展开、隐藏后代路径展开、异步数据、无关手动折叠、共享消费者范围和无 API 边界均符合计划；浏览器证据已记录如下。

## 验证记录

- `npx vitest run src/components/parameter-topology/DtsTopologyNavigator.test.tsx`：修复前新增多根测试因无关根节点重新展开而 Red；修复后 Green，15/15 通过。
- `npx vitest run src/components/parameter-topology src/features/dts-reload/DtsReloadPage.test.tsx src/NodeDebuggingPage.test.tsx`：35 个文件、393 项测试通过。
- `npm test -- --maxWorkers=4`：421 个文件、3168 项测试通过。默认无限制并发的本地运行分别触发了现有无关测试超时（`NodeDebuggingPage.test.tsx:915`，以及一次 `SpecCreateDialog.test.tsx:102`）；相关用例单独运行通过，受控并发全量通过。
- `npm run lint -- --no-cache`：退出码 0，0 errors、301 个既有 warnings。`npm run build`、`npm run ui:check`、`git diff --check`、`npm run acceptance:coverage`、`npm run acceptance:operations` 通过。`npm run docs:check` 的治理检查通过，仅报告本机缺少 pgvector 导致的已知 schema 对比跳过。
- 浏览器运行态：mock Vite `http://127.0.0.1:5193`；`/parameters`、`/dts-reload`、`/node-debugging`、`/parameter-admin/specs` 均在 `1440x900`、`768x1024`、`390x844` 执行 snapshot 和 screenshot。所有页面 `scrollWidth` 等于 `innerWidth`，console error 日志为空。
- 浏览器交互：`/dts-reload` 按用户序列操作后为 `充电管理=true`，`传感器=false`、`电源=false`、`温控=false`、`系统=false`、`总线=false`；`/node-debugging` 选中 `Charging` 后，其兄弟 `Battery` 保持折叠。截图位于 `work/ui-checks/module-navigator-expansion-20260829/`。
- 已按交互门禁执行 `npm run acceptance:evidence`。由于当前 checkout 没有任何验收运行产出的记录，命令返回仓库已有基线失败（`coveredOperationIds: []`，所有 automated operation ID 缺失）；生成证据文件已恢复不变，未伪造证据。本次前端修复不新增 operation ID，也不改变操作证据生成逻辑。

## 完成记录

仅在实现、浏览器证据、CI、合并和干净 main 同步完成后填写：PR 编号/URL、合并 SHA、最终验证命令、截图路径、console/network 结果，以及任何明确跳过的目标环境证据。
