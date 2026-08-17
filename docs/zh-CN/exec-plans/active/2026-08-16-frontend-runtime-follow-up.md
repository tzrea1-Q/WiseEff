# 前端运行时后续（TD-110 / TD-109 / C7）

> English: [English](../../../exec-plans/active/2026-08-16-frontend-runtime-follow-up.md)

- **状态：** 进行中 — 收口。D/E/F/H 已在 `main`（#483–#486）。剩余：Track G C5 共享 bridge/target/protocol 类型（`refactor/bridge-target-session`）。
- **负责人：** Frontend
- **核对日期：** 2026-08-17（GitHub `main` @ `bf6b99ca`，#482 合入后）
- **前序：** `docs/exec-plans/completed/2026-08-12-app-shell-decomposition.md`

## 目标

把架构审查仍开放的后续做成三个可并行 PR。第一批已完成：

- API 模式启动态不再夹带演示人名、日志后台用户或演示审计事件。**已完成**（#474）。
- Mock 适配器抛 `WiseEffApiError`，应用层 `error.code` 分支在 mock 模式可用。**已完成**（#475）。
- 日志分析 CSS 与 `src/features/log-analysis/` 同目录。**已完成**（#476）。

## 非目标

- 不把 `AppProps` 收成 `runtime?: Partial<AppRuntime>`（#375 已否决）。
- 不让 `src/` 引用 `server/`，本程序不引入 `packages/` 共享包。
- TD-112 / TD-113 / TD-114（美观提升余量）不属于本轮架构审查。
- 不把分区状态铺到未改动的页面；触及某页时再推广。
- 参数管理后台 M1 CSS 与 `.dts-parameter-workbench*` 不和配置工作台 CSS 同 PR。

C5 不再无限推迟：本收口先把 `NodeDebuggingPage` session 化（Track F），再抽共享 `BridgeGateway`（Track G）。

## 已合入（2026-08-16）

| 轨道 | PR | `main` 合入提交 |
| --- | --- | --- |
| A TD-110 退役演示切片 | [#474](https://github.com/tzrea1-Q/WiseEff/pull/474) | `171ec4f8` |
| B TD-109 第一波信封 | [#475](https://github.com/tzrea1-Q/WiseEff/pull/475) | `1df5bbc5` |
| C C7 日志 CSS 同目录 | [#476](https://github.com/tzrea1-Q/WiseEff/pull/476) | `c3b6a7a1` |
| 文档第一批余量 | [#477](https://github.com/tzrea1-Q/WiseEff/pull/477) | `17294ffa` |
| TD-109 第二波领域守卫 | [#478](https://github.com/tzrea1-Q/WiseEff/pull/478) | `76b573de` |
| C7 第二波评审 CSS | [#479](https://github.com/tzrea1-Q/WiseEff/pull/479) | `00f18d0a` |
| TD-109 DTS `/include/` 信封 | [#481](https://github.com/tzrea1-Q/WiseEff/pull/481) | `4fc6a127` |
| TD-110 API 目录诚实 | [#480](https://github.com/tzrea1-Q/WiseEff/pull/480) | `d99823df` |

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

已做：新建 `src/features/log-analysis/log-analysis.css`，迁 `.logs-v2*`、`.log-dashboard-*` 及仅包裹它们的媒体查询；全局 `.button` / `.sr-only` / 共享 loading-empty 三件套留下。像素级等价。`LogsPage.tsx` 与 `LogDashboardPage.tsx` 引入该文件；`App.test.tsx` 拼接两份样式表。参数评审 CSS 已在 #479 迁到 `src/features/parameter-review/parameter-review.css`。

## 推迟项（已改）

C5 共享桥接类型改为收口轨道：F（#485 节点调试 session）已合入，G（共享 protocol/bridge/target 类型）进行中。不要重写 reload 部署确认或节点调试 I/O。

## 后续顺序

```
已合入: A–C #474–#476 │ 守卫 #478 │ 评审 CSS #479 │ dts-parse #481 │ 目录 #480
        文档 #482 │ Object.assign #483 │ 工作台 CSS #484 │ node session #485 │ 播种 #486
开放:   G  C5 共享 bridge/target/protocol 类型
```

做法、验证命令与文件地图见英文计划 Closeout tracks。

## Git 与 PR

本计划明确使用 **多个功能分支**（相对 `docs/PLANS.md` 默认「一计划一分支」的例外）。实现子智能体只在指定 worktree 提交，不开 PR。父会话审查、开 PR、合入，再更新债表与 FRONTEND。

切勿在共享脏工作树 `/Users/tzrea1/Develop/WiseEff` 里实现。

## 文档影响矩阵与门禁

见英文版同名两节。计划保持 **进行中**，直到收口轨道落地或改挂债表。
