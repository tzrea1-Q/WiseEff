# 确定性技术债并行收口

> 状态：**进行中**  
> 日期：2026-08-22  
> 计划分支：`docs/deterministic-td-parallel-closeout-plan`  
> English: [English](../../../exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout.md)  
> 追踪表：[技术债追踪表](../tech-debt-tracker.md)

## 目标

并行关闭三条不需要硬件、目标环境证据、专家标注日志或未决产品决策的技术债：

- **TD-059**：把范围内最后两个参数弹窗迁到统一 `ModalDialog` 契约。
- **TD-071**：把两套旧 M1 seed 集成测试迁到当前 per-worker 测试基座，删除失真的共享库清理和超时特例。
- **TD-073**：在真实应用/Port 接缝完成前端测试 harness 收口，不把合理的组件 props 测试强行改成整 App 测试。

本批次强调独立归属和完整关闭。单条实现只有在聚焦门禁、全量门禁和最终文档收口都合入后才算关闭。

## 假设与锁定决策

- 规划时 `origin/main` 为 `cc2779e5`。
- 本计划合入后，三条实现分支从同一个最新 `origin/main` 创建。
- 实现子智能体只负责代码和本轨测试；共享 tracker 与计划由父流程在实现 PR 合入后统一收口。
- TD-059 是弹窗原语迁移，不重做产品流程；`DtsReloadCandidateEditDialog` 不在范围内。
- TD-071 以现有四个 PostgreSQL 集成行为为 characterization 接缝；性能靠重复运行证明，不加脆弱的墙钟断言。
- TD-073 关闭 adapter 和装配重复；`DtsParameterWorkbench.test.tsx` 没有重复 IO repository，因此保留组件 props 接缝。

## 非目标

- 硬件、HDC/ADB、桥接路由、设备写入或目标环境证据。
- TD-077 样式/源码文本断言清理、TD-112 表格收敛、TD-113 token burn 或邻近生产重构。
- 因 TD-059 修改服务端契约、数据库迁移、OpenAPI 或验收登记表。
- 因 TD-071 修改生产 seed pipeline 或测试数据库 harness。
- 因 TD-073 把所有页面/组件测试改为 App 集成测试。

## Git 与 PR 工作流

这是明确允许并行兄弟分支的组合计划。每个实现子智能体只在指定分支提交，不开、不合 PR。父智能体负责评审、开 PR、绿灯合入、刷新余下分支，最后合入共享文档收口。

| 轨道 | 分支 | 归属文件 | 明确排除 |
| --- | --- | --- | --- |
| TD-059 | `fix/td-059-dialog-contract` | `DtsBindingHistoryDiffDialog*`、`DtsNodeEnablementDialog*`、少量相关 `DtsBindingDetailDialog*`、范围内弹窗 CSS | 不改 tracker/计划；不碰 reload sheet；不碰页面 harness |
| TD-071 | `test/td-071-seed-test-harness` | `seedM1BindingRevisionHistory.integration.test.ts`、`seedM1SemanticTopology.integration.test.ts` | 不改生产 seed/harness；不改 tracker/计划 |
| TD-073 | `test/td-073-render-harness-closeout` | `src/test/harness/**` 与六个审计过的页面/工作台测试 | 不改生产行为；不碰 TD-059 组件；不改 tracker/计划 |
| 共享收口 | `docs/deterministic-td-parallel-closeout` | 中英 tracker、本计划与 PLANS 索引 | 不改实现代码 |

每次合入前 fetch `origin/main`、rebase，并执行 `npx tsc -b` 和受影响测试，同时复核共享 TD/计划状态。合入顺序：TD-071、TD-073、TD-059、共享文档；前两条先合入可减少浏览器验证前的 UI 漂移。

## TDD 接缝

实现前锁定以下接缝：

1. **TD-059 弹窗 DOM/交互接缝**：可访问名称/描述、统一遮罩/卡片结构、焦点进入/环/归还、顶层 Escape、安全遮罩关闭、busy 时不可关闭。既有节点启停领域断言保持不变。
2. **TD-071 PostgreSQL 集成接缝**：通过现有公开 seed 入口验证语义拓扑归属/幂等，以及绑定修订历史/对象字节/幂等。
3. **TD-073 应用与 Port 接缝**：App 路由使用 `renderApp`；页面测试使用 props + 稳定 TopBar context；测试 repository 基于全新生产 mock adapter，并可观察、可 override；`DtsParameterWorkbench` 使用 typed props。

每条轨道先写会失败的契约/敏感性测试，再按纵向切片实现，禁止真实 sleep。

## 任务

### 轨道 A — TD-059

1. 先加统一弹窗结构、嵌套 Escape/焦点归还、busy 关闭保护的红测试。
2. 把历史差异和节点启停迁到 `ModalDialog`，保留业务文案与动作。
3. 删除 Radix 专用 z-index/overlay 假设，只增加范围内响应式/chrome CSS。
4. 跑聚焦/全量前端门禁、既有 `PARAM-ENABLE-TOGGLE-001` / `PARAM-ENABLE-GUARD-001` 验收，并用 `playwright-cli` 在 1440×900、768×1024、390×844 做 QA。

### 轨道 B — TD-071

1. Characterize 当前四个集成行为。
2. 用 `seedCoreGraph` 和 `createMemoryObjectStore` 替换本地 minimal graph / object-store double。
3. 删除过时的跨域清理、共享库注释和 60 秒单测覆盖。
4. 以四 worker 重复聚焦套件，再跑全量服务端测试。

### 轨道 C — TD-073

1. 给新 harness factory 写契约测试：默认生产 mock adapter、全新状态、方法可观察、override 优先。
2. 在公开接缝迁移 App 路由和共享 log/debug runtime actions。
3. 增加 structured/file repository factory，逐步迁移项目配置/API topology 测试。
4. 记录 `DtsParameterWorkbench` 为审计保留的组件 props 接缝，保留原场景覆盖。
5. 先跑六文件+harness，再跑全量前端测试/build/lint。

### 共享收口

1. 三个实现 PR 都合入后，在中英 tracker 把 TD-059、TD-071、TD-073 从 Open 移到 Completed，并记录精确证据和 PR。
2. 更新旧上线收口计划中仍把这些条目列为 Open 的位置。
3. 把本计划中英文件从 `active/` 移到 `completed/`，并更新中英 PLANS 索引。
4. 从刷新后的 `main` 按合入范围运行文档、契约、UI、build、全量前后端和 diff 门禁。

## 成功标准

- 三个可独立评审的实现 PR 合入，代码文件不发生跨轨冲突。
- TD-059 范围内不再导入 `@/components/ui/dialog`，并通过真实浏览器焦点、层叠、响应式检查。
- TD-071 使用共享服务端测试 factory，没有专用拓扑 reset 或超时特例，多 worker 重复运行稳定。
- TD-073 的完整 App render 全部经过 `renderApp`；六个审计文件不再复制完整 IO adapter；合理组件 props 接缝有明确记录。
- 每个实现 diff 的 Standards / Spec 复审均为 0 个遗留问题。
- 中英 tracker 都把三条放入 Completed，且全部文档门禁通过后才归档本计划。

## 验证

```bash
npx tsc -b
npm test
npm run test:server
npm run build
npm run lint
npm run ui:check
npm run docs:check
npm run contract:check
git diff --check
```

每条轨道的专用命令和浏览器证据路径记录在实现 PR 与最终 tracker 行。

## 文档影响矩阵

| 区域 | 状态 | 文件/证据 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md`、`docs/README.md`；预计无需改导航 |
| 计划 | Update | 本中英计划、`docs/PLANS.md`、`docs/zh-CN/PLANS.md`、旧上线收口计划 |
| 技术债 | Update | 中英 `tech-debt-tracker.md` 的 TD-059/071/073 |
| 产品规格 | No change | 不改用户流程或产品决策 |
| 架构/领域 | Review | 只收敛弹窗/测试接缝；预计不改生产架构 |
| 质量/测试 | Review | tracker/计划证据；只有 harness 契约实质变化时才更新长期测试文档 |
| 可靠性/runbook | No change | 不改运行时或运维流程 |
| 安全/治理 | No change | 不改 authz、审计、secret 或设备写入 |
| 前端/设计 | Update | TD-059 若移除最后例外，则更新中英 `FRONTEND`；PR 记录 UI checklist 证据 |
| API/生成物 | No change | 不改 API 或 schema |
| references | Review | 预计无需更新 |

## 文档更新门禁

只有满足以下条件才能完成本批次：

- 上述每个 Update/Review 行都已更新，或有证据说明无需改；
- 中英 tracker 与计划状态一致；
- 完成后本计划文件只存在于 `completed/`；
- 共享收口分支的 `npm run docs:check` 与 `git diff --check` 通过；
- TD-059 前端证据记录路由、视口、交互、截图、console/network 检查以及发现/修复的问题。
