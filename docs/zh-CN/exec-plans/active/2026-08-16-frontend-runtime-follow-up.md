# 前端运行时后续（TD-110 / TD-109 / C7）

> English: [English](../../../exec-plans/active/2026-08-16-frontend-runtime-follow-up.md)

- **状态：** 进行中 — 三条互不抢文件的实现轨道，基线 `origin/main` @ `fcef9758`
- **负责人：** Frontend
- **核对日期：** 2026-08-16（GitHub `main`，#473 合入后；当时无开放 PR）
- **前序：** `docs/exec-plans/completed/2026-08-12-app-shell-decomposition.md`

## 目标

把架构审查仍开放的后续做成三个可并行 PR：API 模式启动态不再夹带演示审计/人名切片；mock 适配器抛 `WiseEffApiError`；日志分析 CSS 与 `src/features/log-analysis/` 同目录。

## 非目标

- **C5 `BridgeGateway`：** 继续推迟。DTS 重载已有 `dtsReloadRunSession`。等 `NodeDebuggingPage` session 化后再看。
- **TD-109 第二波（共享状态机）：** 本计划已写明设计，不在第一批并行实现。
- **C7 第二波（参数评审 CSS）：** 与第一波抢 `src/styles.css`，等第一波合入后再开。
- TD-110 余量：`persistedConfigSnapshot`、mock 播种下沉、分区状态推广。Track A 不吸收。
- 不把 `AppProps` 收成 `runtime?: Partial<AppRuntime>`（#375 已否决）。

## 并行切分

| 轨道 | 分支 | 允许改动 | 禁止改动 |
| --- | --- | --- | --- |
| A TD-110 | `fix/td110-api-legacy-slices` | `mockData.ts`、`prototype/types.ts`、`appState.ts`、`reducer.logAdmin.test.ts`、新建 api 初始态测试 | mock 适配器、`styles.css`、功能页、计划索引与债表 |
| B TD-109 信封 | `fix/td109-mock-error-envelopes` | `src/infrastructure/mock/**`（含 `mockApiError` 助手） | `mockData.ts`、`appState.ts`、`styles.css`、计划索引与债表 |
| C C7 日志 CSS | `refactor/log-analysis-css-colocation` | `styles.css`（只删迁走的规则）、`src/features/log-analysis/**`、`App.test.tsx` 中 `.logs-v2` 样式断言 | mock 数据、mock 适配器、reducer、债表 |

实现子智能体不改 `docs/PLANS.md`、债表、FRONTEND、本计划。文档由父会话在合入后更新。

## Track A — 退役无 hydrate 的演示切片

`createApiInitialState()` 仍从完整 mock 状态带入 `auditEvents`、`developers`、`logAdminUsers`。后两者没有页面读取：`developers` 全仓无生产消费者；`logAdminUsers` 与 `LOG_ADMIN_ADD/UPDATE/REMOVE_USER` 只出现在 reducer 测试。审计页已用 `isApiMode` 隔离 mock 事件。

做法：api 初始态清空 `auditEvents`；从 `PrototypeState` 删除 `developers` 与 `logAdminUsers`；删除三支用户目录 action 及测试；保留归档/再分析等日志后台 action。`users` / 配置 schema / `persistedConfigSnapshot` 不动。

## Track B — mock 错误信封（第一波）

`src/infrastructure/mock/` 零引用 `WiseEffApiError`。债表里「五组文案逐字相同」已过时（mock 会拼 `taskId`，候选过期文案是短句），但规则仍手抄、信封仍分叉。

做法：新增 `mockApiError(code, message, details?)`；非测试 mock 文件的 `throw new Error` 全部改为该助手。**保留现有 message**，按 not-found / conflict / validation / forbidden 启发式填 `code`。不在本波抽取状态机。

第二波（合入后另开分支）：状态机留在前端 `src/domain/`，不把 `server/` 迁进 `src/`，也不在本程序引入 `packages/` 共享包。优先身份映射开闭、候选激活过期基、定义生命周期。服务端仍是 HTTP 事实来源。

## Track C — 日志分析 CSS 同目录

`src/styles.css` 约 28732 行。日志 v2 块从第 6935 行注释开始。参照 `parameter-home.css`：新建 `src/features/log-analysis/log-analysis.css`，迁 `.logs-v2*`、`.log-dashboard-*` 及仅包裹它们的媒体查询；全局 `.button` / `.sr-only` / 共享 loading-empty 三件套留下。像素级等价，不改视觉值。更新 `App.test.tsx` 对 `.logs-v2` 的 `readStylesheet` 断言。

## 推迟项

C5 共享桥接 session：DTS 侧重载已 session 化，节点调试仍把桥接候选写在页面里。现在抽取会改写刚落地的 session。

## Git 与 PR

本计划明确使用 **三个功能分支**（相对 `docs/PLANS.md` 默认「一计划一分支」的例外）。实现子智能体只在指定 worktree 提交，不开 PR。父会话审查、开 PR、合入。

切勿在共享脏工作树 `/Users/tzrea1/Develop/WiseEff` 里实现。

## 文档影响矩阵与门禁

见英文版同名两节。计划完成前须：三轨合入、债表改写余量、中英 FRONTEND 更新、`npm run docs:check` 通过。
