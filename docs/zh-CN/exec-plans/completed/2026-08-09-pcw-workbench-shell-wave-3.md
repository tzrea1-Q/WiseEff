# PCW 工作台壳层 wave-3 — 导航 / 加载 / 画布历史 / 活动会话

> 状态：**Complete** — 壳 `wc -l` = **1496**（≤ ~1500 软门禁）；stretch 800–1000 为残余债；经 #273–#278 关闭 #258
> 日期：2026-08-09
> English: [`docs/exec-plans/completed/2026-08-09-pcw-workbench-shell-wave-3.md`](../../../exec-plans/completed/2026-08-09-pcw-workbench-shell-wave-3.md)
> 父程序：[#258](https://github.com/tzrea1-Q/WiseEff/issues/258)（wave-1 PR #266；wave-2 PR #272；wave-3 #273–#278）
> 锁定设计：[`docs/zh-CN/design-docs/2026-08-06-project-configuration-workbench-design.md`](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §16

## 背景

Wave-1 抽出领域 Workbench session；wave-2 抽出展示适配器与 `ConfigSetOpsSession`。PR #272 后壳层约 **2407** 行。剩余主要是编排：URL/选区、工作区加载、画布历史/对比源、Activity 加载与事件定位——不是更多坞 JSX。

Grill 决策（2026-08-09，wave-3）见英文计划同名表（W3-D1–W3-D12）。摘要：软门禁壳 ≤ ~1500 可关 #258；抽 Navigation（含搜索）/ WorkspaceLoad / CanvasHistory / Activity；挂 #258 新父票；不做审核 C2–C5；单分支单 PR。

## 目标

1. 抽出 **WorkbenchNavigationSession**
2. 抽出 **WorkbenchWorkspaceLoadSession**
3. 抽出 **WorkbenchCanvasHistorySession**
4. 抽出 **WorkbenchActivitySession**
5. 验收壳 ≤ ~1500 且以编排为主；更新模块图；**关闭 #258**

## 非目标

- 硬性要求壳 ≤ 1000（仅为 stretch）
- 审核 C2–C5（ReleaseUnit、WorkingConfiguration tip、宽 port、Candidate 词汇/冲突仓合并）
- 产品行为变更
- 把 versions 加载或 readiness/baselines 刷新并入 WorkspaceLoad

## 绞杀顺序

1. Navigation  
2. WorkspaceLoad  
3. CanvasHistory  
4. Activity  
5. Slim verify + docs（关 #258）

## Git & PR

实现分支：`feat/pcw-workbench-shell-wave-3`（#272 合入后的 `origin/main`）。实现子代理只提交、不开/合 PR；父代理开 PR、合并并同步 `main`。

## 文档

见英文计划 Documentation Impact Matrix 与 Update Gate；完成前须更新 EN/ZH FRONTEND 与 design §16，并跑通 `npm run docs:check`。
