# 前端运行时后续（TD-110 / TD-109 / C7）

> English: [English](../../../exec-plans/active/2026-08-16-frontend-runtime-follow-up.md)

- **状态：** 进行中 — A/B/C 三轨已于 2026-08-16 合入 `main`（#474、#475、#476）。余量：TD-110 快照/分区/播种、TD-109 第二波、C7 第二波、C5 仍推迟。
- **负责人：** Frontend
- **核对日期：** 2026-08-16（GitHub `main` @ `c3b6a7a1`，#476 合入后）
- **前序：** `docs/exec-plans/completed/2026-08-12-app-shell-decomposition.md`

## 目标

把架构审查仍开放的后续做成三个可并行 PR。第一批已完成：

- API 模式启动态不再夹带演示人名、日志后台用户或演示审计事件。**已完成**（#474）。
- Mock 适配器抛 `WiseEffApiError`，应用层 `error.code` 分支在 mock 模式可用。**已完成**（#475）。
- 日志分析 CSS 与 `src/features/log-analysis/` 同目录。**已完成**（#476）。

## 非目标

- **C5 `BridgeGateway`：** 继续推迟。DTS 重载已有 `dtsReloadRunSession`。等 `NodeDebuggingPage` session 化后再看。
- **TD-109 第二波（共享状态机）：** 本计划已写明设计，不在第一批并行实现。信封对齐（第一波）已合入。
- **C7 第二波（参数评审 CSS）：** 与第一波抢 `src/styles.css`，等第一波合入后再开（现可开新分支）。
- TD-110 余量：`persistedConfigSnapshot`、mock 播种下沉、分区状态推广。Track A 不吸收。
- 不把 `AppProps` 收成 `runtime?: Partial<AppRuntime>`（#375 已否决）。

## 已合入（2026-08-16）

| 轨道 | PR | `main` 合入提交 |
| --- | --- | --- |
| A TD-110 退役演示切片 | [#474](https://github.com/tzrea1-Q/WiseEff/pull/474) | `171ec4f8` |
| B TD-109 第一波信封 | [#475](https://github.com/tzrea1-Q/WiseEff/pull/475) | `1df5bbc5` |
| C C7 日志 CSS 同目录 | [#476](https://github.com/tzrea1-Q/WiseEff/pull/476) | `c3b6a7a1` |

下列「做法」是已执行清单，不要再实现一遍。

## Track A — 退役无 hydrate 的演示切片

**已合入 #474。**

合入前：`createApiInitialState()` 仍从完整 mock 状态带入 `auditEvents`、`developers`、`logAdminUsers`。后两者没有页面读取。审计页已用 `isApiMode` 隔离 mock 事件。

已做：api 初始态清空 `auditEvents`；从 `PrototypeState` 删除 `developers` 与 `logAdminUsers`；删除三支用户目录 action 及测试；保留归档/再分析等日志后台 action。`users` / 配置 schema / `persistedConfigSnapshot` 不动。`src/domain/logs/types.ts` 的 `LogAdminUser` 仍无引用，留给余量清理。

## Track B — mock 错误信封（第一波）

**已合入 #475。**

合入前：`src/infrastructure/mock/` 零引用 `WiseEffApiError`。债表里「五组文案逐字相同」已过时（mock 会拼 `taskId`，候选过期文案是短句），但规则仍手抄、信封仍分叉。

已做：新增 `mockApiError(code, message, details?)`；非测试 mock 文件的 `throw new Error` 全部改为该助手。**保留现有 message**，按 not-found / conflict / validation / forbidden 启发式填 `code`。未抽取状态机。

第二波（另开分支）：状态机留在前端 `src/domain/`，不把 `server/` 迁进 `src/`，也不在本程序引入 `packages/` 共享包。优先身份映射开闭、候选激活过期基、定义生命周期。服务端仍是 HTTP 事实来源。文案对齐服务端或停止断言英文 message（优先 `code` + `details`）。

## Track C — 日志分析 CSS 同目录

**已合入 #476。**

合入前：`src/styles.css` 约 28732 行。日志 v2 块从第 6935 行注释开始。

已做：新建 `src/features/log-analysis/log-analysis.css`，迁 `.logs-v2*`、`.log-dashboard-*` 及仅包裹它们的媒体查询；全局 `.button` / `.sr-only` / 共享 loading-empty 三件套留下。像素级等价。`LogsPage.tsx` 与 `LogDashboardPage.tsx` 引入该文件；`App.test.tsx` 拼接两份样式表。参数评审 CSS 仍在 `src/styles.css`。

## 推迟项

C5 共享桥接 session：DTS 侧重载已 session 化，节点调试仍把桥接候选写在页面里。现在抽取会改写刚落地的 session。

## 后续顺序

```
已合入: A #474 │ B #475 │ C #476
下一步: TD-109 第二波（领域守卫）— 从 main 新开分支
下一步: C7 第二波参数评审 CSS — 从 main 新开分支
更后:   NodeDebuggingPage session → 再考虑 C5
更后:   TD-110 余量（persistedConfigSnapshot / mock 播种 / 分区状态）
```

## Git 与 PR

本计划明确使用 **三个功能分支**（相对 `docs/PLANS.md` 默认「一计划一分支」的例外）。实现子智能体只在指定 worktree 提交，不开 PR。父会话审查、开 PR、合入，再更新债表与 FRONTEND。

切勿在共享脏工作树 `/Users/tzrea1/Develop/WiseEff` 里实现。

## 文档影响矩阵与门禁

见英文版同名两节。第一批已在 `main`。计划保持 **进行中**，直到 TD-109 第二波与 C7 第二波落地或改挂；C5 仍推迟。本 docs PR 改写债表余量并更新中英 FRONTEND / PLANS。`npm run docs:check` 已通过。
